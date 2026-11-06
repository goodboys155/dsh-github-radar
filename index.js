/**
 * dsh-github-radar — 宿主端。
 *
 * 对外提供一个同源路由，让侧栏面板拿到 GitHub 热门仓库：
 *
 *   GET /api/github-radar/trending?period=day|week|all[&refresh=1]
 *
 * 数据来自 GitHub Search API。先直连，直连失败再走本机 HTTP 代理
 * （优先 127.0.0.1:10808，即 v2rayN 默认端口，其次常见 Clash/v2ray 端口），
 * 所以开着代理和不开代理都能用。结果内存缓存 30 分钟，并落盘一份，
 * 断网时仍能显示最近一次成功的结果。
 */
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const name = "github-radar";
const inject = ["webServer"];

const UA = "dsh-github-radar/1.0 (dsh web plugin; personal project discovery)";
const TTL_MS = 30 * 60 * 1000;
const DIRECT_TIMEOUT_MS = 6000;
const PROXY_TIMEOUT_MS = 20000;
/** 直连失败时依次尝试的本机代理端口。10808 是 v2rayN 的默认 http 入口。 */
const PROXY_CANDIDATES = [
  "127.0.0.1:10808",
  "127.0.0.1:10809",
  "127.0.0.1:7890",
  "127.0.0.1:7897",
  "127.0.0.1:1080"
];

let preferredProxy = null;

//#region 出站请求

function requestDirect(target, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const isHttps = url.protocol === "https:";
    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        host: url.hostname,
        port: Number(url.port || (isHttps ? 443 : 80)),
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          "user-agent": UA,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28"
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
        );
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("direct timeout " + timeoutMs + "ms")));
    req.on("error", reject);
    req.end();
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

/** 先直连，再按候选代理逐个试；记住上次成功的那个。 */
async function fetchText(target) {
  const errors = [];
  try {
    const r = await requestDirect(target, DIRECT_TIMEOUT_MS);
    if (r.status >= 200 && r.status < 300) return r.body;
    errors.push("direct HTTP " + r.status);
  } catch (e) {
    errors.push("direct: " + (e instanceof Error ? e.message : String(e)));
  }

  const order = preferredProxy
    ? [preferredProxy, ...PROXY_CANDIDATES.filter((p) => p !== preferredProxy)]
    : PROXY_CANDIDATES;

  for (const proxy of order) {
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

//#region 查询构造

function daysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** 三个档位：最近冒头的新项目 / 本月热门 / 长青大项目。 */
function searchUrl(period, perPage) {
  const base = "https://api.github.com/search/repositories?per_page=" + perPage + "&sort=stars&order=desc";
  if (period === "day") {
    // 最近 7 天新建、已经开始起量的项目
    return base + "&q=" + encodeURIComponent("created:>" + daysAgo(7) + " stars:>10");
  }
  if (period === "week") {
    // 最近 30 天新建、已经破百星的项目
    return base + "&q=" + encodeURIComponent("created:>" + daysAgo(30) + " stars:>100");
  }
  // 长青：高星且仍在维护
  return base + "&q=" + encodeURIComponent("stars:>20000 pushed:>" + daysAgo(30));
}

function normalizeItem(item) {
  return {
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

/** 只接受本机回环来源，避免被局域网里的页面借用。 */
function isLoopback(req) {
  const addr = req.socket?.remoteAddress || "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1"
  );
}

function cacheDirFor(dshHome) {
  return join(dshHome, "github-radar");
}

async function readCache(file) {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text);
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
  const cacheFile = (period) => join(dir, "trending-" + period + ".json");
  const memory = new Map();

  async function load(period, force) {
    const hit = memory.get(period);
    if (!force && hit && Date.now() - hit.fetchedAt < TTL_MS) {
      return { ...hit, fromCache: false };
    }
    const disk = await readCache(cacheFile(period));
    if (!force && disk && Date.now() - disk.fetchedAt < TTL_MS) {
      const entry = { ...disk };
      memory.set(period, entry);
      return { ...entry, fromCache: true };
    }
    try {
      const body = JSON.parse(await fetchText(searchUrl(period, 30)));
      if (body && body.message && !body.items) {
        throw new Error("GitHub API: " + body.message);
      }
      const items = (body.items || []).map(normalizeItem);
      const payload = { fetchedAt: Date.now(), period, total: body.total_count || items.length, items };
      memory.set(period, payload);
      await writeCache(cacheFile(period), payload);
      return { ...payload, fromCache: false };
    } catch (error) {
      logError(period + " fetch failed: " + (error instanceof Error ? error.message : String(error)));
      if (disk) return { ...disk, fromCache: true, stale: true };
      if (hit) return { ...hit, fromCache: true, stale: true };
      throw error;
    }
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
          if (!["day", "week", "all"].includes(period)) {
            return writeJson(res, 400, { error: "period must be day|week|all" });
          }
          const force = url.searchParams.get("refresh") === "1";
          const payload = await load(period, force);
          writeJson(res, 200, payload);
        } catch (error) {
          writeJson(res, 502, {
            error: "github unavailable: " + (error instanceof Error ? error.message : String(error))
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
