# GitHub Radar for DeepSeek Harness

A right-sidebar tab that shows what is hot on GitHub right now: three curated lists, one line of plain-English purpose per repo, one click to open it.

右侧栏标签页，打开即显示 GitHub 当下值得看的项目：三个档位、每个项目一句话说明、点击直达仓库。

![screenshot](assets/screenshot.png)

## What it does

Three lists, each the top 30 by stars:

| List | Query |
| --- | --- |
| **Rising today** 今日冒头 | created in the last 7 days, 10+ stars |
| **New this month** 本月新星 | created in the last 30 days, 100+ stars |
| **All-time giants** 常青热门 | 20,000+ stars, pushed in the last 30 days |

Each row shows the repo name, one line of its own description, the language with a colour dot, up to two topics, and the star count. The whole row is a link — clicking opens `github.com/<owner>/<repo>` in a new tab.

The panel loads on open. There is no search box and no filter: it is a fixed, small reading surface, not a browser.

## Install

```sh
dsh plugin --profile web add github:goodboys155/dsh-github-radar
```

Then restart DSH. The tab appears in the **right** sidebar as 「雷达」/「Radar」.

Restart is required: DSH scans client plugins at startup only. Editing files on disk does not hot-reload the browser half.

## Data source

[GitHub Search REST API](https://docs.github.com/en/rest/search/search), the `repositories` endpoint. No token, no login, no account needed.

Rate limits are those of an unauthenticated client (10 search requests per minute). The plugin therefore caches aggressively:

- **30 minutes** in memory
- **30 minutes** on disk at `$DSH_HOME/github-radar/trending-<period>.json`

The refresh button forces a fetch. If GitHub is unreachable, the last successful result keeps rendering with an `离线缓存` / `cached` marker instead of an empty panel.

## Network behaviour

Outbound requests go direct first. If `api.github.com` is unreachable, the host retries through a local HTTP proxy from this list, in order:

```
127.0.0.1:10808   (v2rayN default)
127.0.0.1:10809
127.0.0.1:7890    (Clash default)
127.0.0.1:7897
127.0.0.1:1080
```

The first proxy that answers is remembered for the rest of the process. So it works whether or not you run a proxy.

The only network endpoints contacted are `api.github.com`. Nothing else is sent anywhere; there is no telemetry.

## Architecture

Two halves, standard DSH plugin shape:

```
index.js          host half   — one route: GET /api/github-radar/trending?period=day|week|all
client.js         browser half — registers the sidebar tab, renders the list
cordis.patch.yml  bundle patch — inserts the plugin into the profile
```

The host half registers a single route on the shared web server, loopback-only, `GET` only. The browser half fetches that route same-origin and renders. Fetching in the browser would hit CORS and expose your proxy configuration to the page, which is why the request lives on the host.

## Permissions

Declared capabilities: **network** only.

- No filesystem writes outside `$DSH_HOME/github-radar/` (the cache)
- No shell, no subprocess, no environment variable reads
- No credentials, no tokens

## Requirements

- DeepSeek Harness 0.2.0 line or newer
- Windows, macOS or Linux (host half is plain Node built-ins)

## Known limits

- 30 entries per list, fixed. No "load more".
- Descriptions are shown as GitHub returns them — mostly English. No translation.
- The `day` list depends on repos being created *and* gaining stars within 7 days; on quiet days it can be thin. `week` is usually the most interesting list.
- Star counts are a point-in-time snapshot, cached up to 30 minutes.
- Unauthenticated Search API is limited to 10 requests/minute; hammering refresh will get you a 403 from GitHub until the window resets. The cache usually prevents this.

## License

MIT — see [LICENSE](LICENSE).
