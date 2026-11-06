/**
 * dsh-github-radar — 宿主端。
 *
 * 对外提供两个同源路由，让侧栏面板拿到 GitHub 数据：
 *
 *   GET /api/github-radar/trending?period=day|week|month|all[&refresh=1]
 *   GET /api/github-radar/search?q=<keywords>[&refresh=1]
 *
 * 数据来自 GitHub Search API，**匿名访问**——不需要 token，不需要登录，
 * 不读任何本地账号凭据。直连失败时回退到本机 HTTP 代理（优先
 * 127.0.0.1:10808，即 v2rayN 默认端口，其次常见 Clash/v2ray 端口），
 * 所以开不开代理都能用。
 *
 * 排序口径：day / week / month 三档按「星标增速」排（星标数 ÷ 建成天数），
 * 而不是按星标总数——三天涨 2000 星比半年涨 3000 星更该出现在飙升榜上。
 * all 档是老牌大项目，按星标总数排即可。
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const name = "github-radar";
const inject = ["webServer"];

const UA = "dsh-github-radar/1.1 (dsh web plugin; personal project discovery)";
/**
 * 缓存格式版本。改了字段或排序口径就加一，旧缓存自然失效——
 * 否则升级后前 30 分钟会继续显示没有 stars_per_day 的旧数据。
 */
const CACHE_VERSION = 2;
const TTL_MS = 30 * 60 * 1000;
const SEARCH_TTL_MS = 5 * 60 * 1000;
const DIRECT_TIMEOUT_MS = 6000;
const PROXY_TIMEOUT_MS = 15000;
/** 探活本地代理端口用的超时：连得上就是连得上，300ms 足够。 */
const PORT_PROBE_MS = 300;
const RESULT_LIMIT = 30;
/** 按增速排序要先拿一批候选再本地重排，所以抓满一页。 */
const FETCH_POOL = 100;

const PROXY_CANDIDATES = [
  "127.0.0.1:10808",
  "127.0.0.1:10809",
  "127.0.0.1:7890",
  "127.0.0.1:7897",
  "127.0.0.1:1080"
];

let preferredProxy = null;

//#region 出站请求


/**
 * 快速判断本机某个端口有没有在监听。
 *
 * 作用：直连失败时不要盲目去连 5 个代理端口、每个等十几秒。没装代理的
 * 用户应该几乎立刻收到「取不到数据」，而不是干等一分多钟。
 */
function isPortOpen(host, port, timeoutMs = PORT_PROBE_MS) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

function connectViaProxy(proxyAuthority, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sep = proxyAuthority.lastIndexOf(":");
    const phost = proxyAuthority.slice(0, sep);
    const pport = Number(proxyAuthority.slice(sep + 1));
    const req = http.request({
      host: phost,
      port: pport,
      method: "CONNECT",
      path: host + ":" + port,
      headers: { host: host + ":" + port },
      timeout: timeoutMs
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode === 200) resolve(socket);
      else {
        socket.destroy();
        reject(new Error("proxy CONNECT " + res.statusCode));
      }
    });
    req.on("timeout", () => req.destroy(new Error("proxy connect timeout")));
    req.on("error", reject);
    req.end();
  });
}

function dechunk(buf) {
  const crlf = Buffer.from("\r\n");
  const parts = [];
  let off = 0;
  for (;;) {
    const end = buf.indexOf(crlf, off);
    if (end < 0) break;
    const size = parseInt(buf.slice(off, end).toString("ascii"), 16);
    if (!(size > 0)) break;
    const start = end + 2;
    parts.push(buf.slice(start, start + size));
    off = start + size + 2;
  }
  return Buffer.concat(parts).toString("utf8");
}

async function requestViaProxy(proxyAuthority, target, timeoutMs) {
  const url = new URL(target);
  const port = Number(url.port || 443);
  const socket = await connectViaProxy(proxyAuthority, url.hostname, port, timeoutMs);
  const secure = tls.connect({ socket, servername: url.hostname });
  await new Promise((resolve, reject) => {
    secure.once("secureConnect", resolve);
    secure.once("error", reject);
  });
  const path = url.pathname + url.search;
  secure.write(
    "GET " + path + " HTTP/1.1\r\n" +
    "Host: " + url.hostname + "\r\n" +
    "User-Agent: " + UA + "\r\n" +
    "Accept: application/vnd.github+json\r\n" +
    "X-GitHub-Api-Version: 2022-11-28\r\n" +
    "Connection: close\r\n\r\n"
  );
  const chunks = [];
  await new Promise((resolve, reject) => {
    secure.on("data", (c) => chunks.push(c));
    secure.on("end", resolve);
    secure.on("error", reject);
  });
  const raw = Buffer.concat(chunks);
  const sep = raw.indexOf(Buffer.from("\r\n\r\n"));
  if (sep < 0) throw new Error("malformed proxy response");
  const head = raw.slice(0, sep).toString("latin1");
  const bodyBuf = raw.slice(sep + 4);
  const status = Number((head.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1] || 0);
  const chunked = /transfer-encoding:\s*chunked/i.test(head);
  return { status, body: chunked ? dechunk(bodyBuf) : bodyBuf.toString("utf8") };
}

/**
 * 先直连，再按候选代理逐个试；记住上次成功的那个。
 *
 * 直连走全局 fetch（undici）：它维护连接池并复用 TLS 会话，实测比裸
 * https.request 快一个数量级（同一请求 0.5–2s vs 3–8s）。代理兜底仍用
 * 手写的 CONNECT 隧道——慢，但只在直连真的不通时才走到。
 */
async function fetchText(target) {
  const errors = [];

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), DIRECT_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(target, {
        headers: {
          "user-agent": UA,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "accept-encoding": "gzip, deflate"
        },
        signal: ctl.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (res.ok) return text;
    // 403/429 多半是未认证的 10 次/分钟配额打满；换个出口 IP 可能就好了，
    // 所以不直接抛，交给代理再试一次。
    errors.push("direct HTTP " + res.status + " " + text.slice(0, 120));
  } catch (e) {
    errors.push("direct: " + (e instanceof Error ? e.message : String(e)));
  }

  const order = preferredProxy
    ? [preferredProxy, ...PROXY_CANDIDATES.filter((p) => p !== preferredProxy)]
    : PROXY_CANDIDATES;

  // 只尝试真正在监听的端口。没装代理的机器上这一步约 1.5 秒全部落空，
  // 然后立刻报错——而不是挨个等满 15 秒超时。
  const live = [];
  for (const p of order) {
    const sep = p.lastIndexOf(":");
    if (await isPortOpen(p.slice(0, sep), Number(p.slice(sep + 1)))) live.push(p);
  }

  if (!live.length) {
    throw new Error(
      "direct failed and no local proxy is listening (" +
      PROXY_CANDIDATES.join(", ") +
      ") -> " + errors.join(" | ")
    );
  }

  for (const proxy of live) {
    try {
      const r = await requestViaProxy(proxy, target, PROXY_TIMEOUT_MS);
      if (r.status >= 200 && r.status < 300) {
        preferredProxy = proxy;
        return r.body;
      }
      errors.push(proxy + " HTTP " + r.status);
    } catch (e) {
      errors.push(proxy + ": " + (e instanceof Error ? e.message : String(e)));
    }
  }
  throw new Error("all routes failed -> " + errors.join(" | "));
}

//#endregion

//#region 查询构造与排序

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 四个档位：时间窗口越短，越能暴露「刚起量」的项目。 */
const PERIODS = {
  day: { created: 2, minStars: 3, byVelocity: true },
  week: { created: 7, minStars: 20, byVelocity: true },
  month: { created: 30, minStars: 100, byVelocity: true },
  all: { created: null, minStars: 20000, byVelocity: false, pushedWithin: 30 }
};

function trendingUrl(period) {
  const cfg = PERIODS[period];
  const parts = [];
  if (cfg.created !== null) parts.push("created:>" + daysAgo(cfg.created));
  parts.push("stars:>" + cfg.minStars);
  if (cfg.pushedWithin) parts.push("pushed:>" + daysAgo(cfg.pushedWithin));
  return (
    "https://api.github.com/search/repositories?per_page=" + FETCH_POOL +
    "&sort=stars&order=desc&q=" + encodeURIComponent(parts.join(" "))
  );
}

/** 关键词搜索：不加星标门槛，让精确匹配的小项目也能露面。 */
function searchUrl(keyword) {
  return (
    "https://api.github.com/search/repositories?per_page=" + RESULT_LIMIT +
    "&sort=stars&order=desc&q=" + encodeURIComponent(keyword.trim())
  );
}

function ageInDays(createdAt) {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return 1;
  return Math.max(1, (Date.now() - t) / 86400000);
}

function normalizeItem(item, withVelocity) {
  const base = {
    full_name: item.full_name,
    name: item.name,
    owner: item.owner ? item.owner.login : "",
    url: item.html_url,
    description: item.description || "",
    stars: item.stargazers_count || 0,
    forks: item.forks_count || 0,
    language: item.language || "",
    topics: Array.isArray(item.topics) ? item.topics.slice(0, 6) : [],
    updated_at: item.pushed_at || item.updated_at || "",
    created_at: item.created_at || "",
    homepage: item.homepage || "",
    archived: Boolean(item.archived)
  };
  if (withVelocity) {
    const days = ageInDays(item.created_at);
    base.age_days = Math.round(days * 10) / 10;
    base.stars_per_day = Math.round(((item.stargazers_count || 0) / days) * 10) / 10;
  }
  return base;
}

/** 按增速降序；速率相同再看星标总数，最后按名字，保证顺序稳定。 */
function sortByVelocity(items) {
  return items.sort((a, b) => {
    if (b.stars_per_day !== a.stars_per_day) return b.stars_per_day - a.stars_per_day;
    if (b.stars !== a.stars) return b.stars - a.stars;
    return a.full_name.localeCompare(b.full_name);
  });
}

//#endregion

//#region 路由

function writeJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function isLoopback(req) {
  const addr = req.socket?.remoteAddress || "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function cacheDirFor(dshHome) {
  return join(dshHome, "github-radar");
}

async function readCache(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeCache(file, payload) {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(payload), "utf8");
  } catch {
    /* 缓存写失败不影响返回 */
  }
}

function makeRoutes(deps) {
  const { dshHome, logError } = deps;
  const dir = cacheDirFor(dshHome);
  const trendingFile = (period) => join(dir, "trending-" + period + ".json");
  const memory = new Map();
  /** 搜索关键词的短期缓存，键为归一化后的关键词。 */
  const searchMemory = new Map();

  async function loadTrending(period, force) {
    const hit = memory.get(period);
    if (!force && hit && Date.now() - hit.fetchedAt < TTL_MS) {
      return { ...hit, fromCache: false };
    }
    const disk = await readCache(trendingFile(period));
    if (!force && disk && disk.v === CACHE_VERSION && Date.now() - disk.fetchedAt < TTL_MS) {
      memory.set(period, disk);
      return { ...disk, fromCache: true };
    }
    try {
      const body = JSON.parse(await fetchText(trendingUrl(period)));
      if (body && body.message && !body.items) throw new Error("GitHub API: " + body.message);
      const cfg = PERIODS[period];
      let items = (body.items || []).map((it) => normalizeItem(it, cfg.byVelocity));
      items = cfg.byVelocity
        ? sortByVelocity(items).slice(0, RESULT_LIMIT)
        : items.slice(0, RESULT_LIMIT);
      const payload = {
        v: CACHE_VERSION,
        fetchedAt: Date.now(),
        period,
        total: body.total_count || items.length,
        sort: cfg.byVelocity ? "stars_per_day" : "stars",
        items
      };
      memory.set(period, payload);
      await writeCache(trendingFile(period), payload);
      return { ...payload, fromCache: false };
    } catch (error) {
      logError(period + " fetch failed: " + (error instanceof Error ? error.message : String(error)));
      if (disk) return { ...disk, fromCache: true, stale: true };
      if (hit) return { ...hit, fromCache: true, stale: true };
      throw error;
    }
  }

  async function search(keyword, force) {
    const key = keyword.trim().toLowerCase();
    const hit = searchMemory.get(key);
    if (!force && hit && Date.now() - hit.fetchedAt < SEARCH_TTL_MS) {
      return { ...hit, fromCache: true };
    }
    const body = JSON.parse(await fetchText(searchUrl(keyword)));
    if (body && body.message && !body.items) throw new Error("GitHub API: " + body.message);
    const items = (body.items || []).map((it) => normalizeItem(it, true)).slice(0, RESULT_LIMIT);
    const payload = {
      fetchedAt: Date.now(),
      query: keyword,
      total: body.total_count || items.length,
      items
    };
    searchMemory.set(key, payload);
    return { ...payload, fromCache: false };
  }

  return [
    {
      kind: "exact",
      path: "/api/github-radar/trending",
      handler: async (req, res) => {
        if (!isLoopback(req)) return writeJson(res, 403, { error: "loopback only" });
        if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
        try {
          const url = new URL(req.url ?? "/", "http://x");
          const period = url.searchParams.get("period") || "day";
          if (!Object.prototype.hasOwnProperty.call(PERIODS, period)) {
            return writeJson(res, 400, { error: "period must be one of day|week|month|all" });
          }
          const payload = await loadTrending(period, url.searchParams.get("refresh") === "1");
          writeJson(res, 200, payload);
        } catch (error) {
          writeJson(res, 502, {
            error: "github unavailable: " + (error instanceof Error ? error.message : String(error))
          });
        }
      }
    },
    {
      kind: "exact",
      path: "/api/github-radar/search",
      handler: async (req, res) => {
        if (!isLoopback(req)) return writeJson(res, 403, { error: "loopback only" });
        if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
        try {
          const url = new URL(req.url ?? "/", "http://x");
          const q = (url.searchParams.get("q") || "").trim();
          if (!q) return writeJson(res, 400, { error: "missing ?q=" });
          if (q.length > 256) return writeJson(res, 400, { error: "query too long" });
          const payload = await search(q, url.searchParams.get("refresh") === "1");
          writeJson(res, 200, payload);
        } catch (error) {
          writeJson(res, 502, {
            error: "search unavailable: " + (error instanceof Error ? error.message : String(error))
          });
        }
      }
    }
  ];
}

//#endregion

function apply(ctx, config) {
  const logError = (message) => {
    try {
      ctx.logger?.warn?.("[github-radar] " + message);
    } catch {
      console.warn("[github-radar]", message);
    }
  };
  const dshHome = config?.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const routes = makeRoutes({ dshHome, logError });
  ctx.effect(() => {
    const disposers = routes.map((r) => ctx.webServer.register(r));
    return () => {
      for (const d of disposers) d();
    };
  }, "github-radar: routes");
}

export { apply, inject, name };
