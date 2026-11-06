/**
 * dsh-github-radar — 客户端。
 *
 * 注册一个右侧栏标签页（kind "github-radar"）：
 *   · 四个档位 —— 今日冒头 / 本周新星 / 本月新星 / 常青热门；
 *     前三个按「星标增速」排序，把刚起量的项目顶上来；
 *   · 关键词搜索 —— 直接搜 GitHub 仓库，按星标数排序，中文输入法组词期间
 *     不触发请求，避免每敲一个拼音就打一次 API。
 *
 * 不需要登录 GitHub：数据由宿主端匿名调用公开 Search API 取得。
 */
window.__ModuleLoader__.load({
  id: 'dsh-github-radar',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'github-radar';
    const TAB_KIND = 'github-radar';
    const TAB_ID = 'dsh-github-radar';
    const API_TRENDING = 'api/github-radar/trending';
    const API_SEARCH = 'api/github-radar/search';

    const PERIODS = ['day', 'week', 'month', 'all'];
    const SEARCH_DEBOUNCE_MS = 500;
    /** 超过这个年龄的项目，展示「星/天」没有意义。 */
    const VELOCITY_MAX_AGE_DAYS = 90;

    const ZH = {
      tab: 'GitHub 雷达',
      tabShort: '雷达',
      guideDesc: 'GitHub 飙升榜 + 仓库搜索 · 点一行直达',
      refresh: '刷新',
      loading: '正在拉取 GitHub…',
      failed: '拉取失败',
      retry: '重试',
      stale: '离线缓存',
      empty: '这个档位暂时没有结果',
      open: '在 GitHub 打开',
      searchPlaceholder: '搜索仓库…',
      searchClear: '清除搜索',
      searchResults: '找到 {n} 个',
      searchEmpty: '没有匹配的仓库，换个关键词试试',
      searchTooShort: '至少输入 2 个字符',
      perDay: '/天',
      day: '今日',
      week: '本周',
      month: '本月',
      all: '常青',
      dayHint: '最近 2 天新建、已经开始起量的仓库，按星标增速排序',
      weekHint: '最近 7 天新建的仓库，按星标增速排序',
      monthHint: '最近 30 天新建的仓库，按星标增速排序',
      allHint: '两万星以上且近 30 天仍在维护的老牌项目，按星标总数排序'
    };
    const EN = {
      tab: 'GitHub Radar',
      tabShort: 'Radar',
      guideDesc: 'GitHub rising repos + search · click a row to open',
      refresh: 'Refresh',
      loading: 'Fetching from GitHub…',
      failed: 'Failed to load',
      retry: 'Retry',
      stale: 'cached',
      empty: 'Nothing here for this period',
      open: 'Open on GitHub',
      searchPlaceholder: 'Search repositories…',
      searchClear: 'Clear search',
      searchResults: '{n} found',
      searchEmpty: 'No repositories matched — try another keyword',
      searchTooShort: 'Type at least 2 characters',
      perDay: '/day',
      day: 'Today',
      week: 'This week',
      month: 'This month',
      all: 'Giants',
      dayHint: 'Repos created in the last 2 days that are already picking up stars, ranked by stars per day',
      weekHint: 'Repos created in the last 7 days, ranked by stars per day',
      monthHint: 'Repos created in the last 30 days, ranked by stars per day',
      allHint: 'Repos with 20k+ stars still pushed in the last 30 days, ranked by total stars'
    };

    const LANG_COLOR = {
      TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Rust: '#dea584',
      Go: '#00ADD8', Java: '#b07219', 'C++': '#f34b7d', C: '#666666', 'C#': '#178600',
      Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF', Shell: '#89e051',
      HTML: '#e34c26', CSS: '#563d7c', Vue: '#41b883', Dart: '#00B4AB', Zig: '#ec915c',
      Lua: '#000080', Haskell: '#5e5086', Elixir: '#6e4a7e', Scala: '#c22d40', Jupyter: '#DA5B0B'
    };

    const CSS = ''
      + '.ghr-root{display:flex;flex-direction:column;min-height:0;height:100%;font-size:13px;'
      +   'color:var(--dsw-alias-label-primary)}'

      + '.ghr-hd{display:flex;align-items:center;gap:8px;padding:13px 14px 3px;flex:none}'
      + '.ghr-ttl{font-weight:650;font-size:13.5px;letter-spacing:.2px}'
      + '.ghr-grow{flex:1}'
      + '.ghr-meta{font-size:10.5px;color:var(--dsw-alias-label-caption)}'
      + '.ghr-icon{width:23px;height:23px;display:inline-flex;align-items:center;justify-content:center;'
      +   'border-radius:6px;border:1px solid var(--dsw-alias-border-l1);'
      +   'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);'
      +   'cursor:pointer;font-size:12px;line-height:1;padding:0}'
      + '.ghr-icon:hover{color:var(--dsw-alias-label-primary)}'
      + '.ghr-icon:disabled{opacity:.45;cursor:default}'

      // 搜索框
      + '.ghr-searchwrap{position:relative;margin:10px 14px 6px;flex:none}'
      + '.ghr-search{width:100%;box-sizing:border-box;padding:6px 26px 6px 28px;border-radius:8px;'
      +   'border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);'
      +   'color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit;outline:none;'
      +   'transition:border-color .12s}'
      + '.ghr-search:focus{border-color:var(--dsw-alias-brand-primary)}'
      + '.ghr-search::placeholder{color:var(--dsw-alias-label-caption)}'
      + '.ghr-searchIcon{position:absolute;left:9px;top:50%;transform:translateY(-50%);'
      +   'color:var(--dsw-alias-label-caption);font-size:11px;pointer-events:none}'
      + '.ghr-searchClear{position:absolute;right:5px;top:50%;transform:translateY(-50%);'
      +   'width:18px;height:18px;display:flex;align-items:center;justify-content:center;'
      +   'border:none;background:transparent;color:var(--dsw-alias-label-caption);'
      +   'cursor:pointer;font-size:13px;line-height:1;padding:0;border-radius:4px}'
      + '.ghr-searchClear:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}'

      // 档位
      + '.ghr-seg{display:flex;gap:2px;margin:0 14px 8px;padding:2px;'
      +   'background:var(--dsw-alias-bg-layer-3);border-radius:8px;flex:none}'
      + '.ghr-seg button{flex:1;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);'
      +   'font-size:11.5px;padding:5px 0;border-radius:6px;cursor:pointer;font-weight:500;'
      +   'font-family:inherit;transition:background .12s;white-space:nowrap}'
      + '.ghr-seg button[data-on="1"]{background:var(--dsw-alias-bg-layer-1);'
      +   'color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}'
      + '.ghr-seg button:disabled{opacity:.45;cursor:default}'

      + '.ghr-summary{font-size:10.5px;color:var(--dsw-alias-label-caption);'
      +   'padding:0 16px 6px;flex:none}'

      + '.ghr-list{flex:1;overflow-y:auto;min-height:0;padding:0 6px 14px}'
      + '.ghr-row{display:block;text-decoration:none;color:inherit;padding:8px 8px 9px;border-radius:7px;'
      +   'border-bottom:1px solid var(--dsw-alias-border-l1);transition:background .12s}'
      + '.ghr-row:last-child{border-bottom:none}'
      + '.ghr-row:hover{background:var(--dsw-alias-bg-layer-1)}'
      + '.ghr-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}'

      + '.ghr-r1{display:flex;align-items:baseline;gap:8px;min-width:0}'
      + '.ghr-nm{font-size:12.5px;font-weight:600;line-height:1.4;min-width:0;'
      +   'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.ghr-nm em{font-style:normal;font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:11.5px}'
      + '.ghr-slash{color:var(--dsw-alias-label-caption);margin:0 1px;font-weight:400}'
      + '.ghr-st{margin-left:auto;padding-left:10px;flex:none;font-size:10.5px;'
      +   'color:var(--dsw-alias-label-tertiary);font-weight:500;'
      +   'display:inline-flex;align-items:center;gap:3px;letter-spacing:.2px;white-space:nowrap}'
      + '.ghr-star{font-size:10px;color:var(--dsw-alias-label-caption)}'

      + '.ghr-desc{margin-top:3px;font-size:11.5px;line-height:1.45;'
      +   'color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'

      + '.ghr-r3{display:flex;align-items:center;gap:5px;margin-top:5px;font-size:10px;'
      +   'color:var(--dsw-alias-label-tertiary);overflow:hidden;white-space:nowrap}'
      + '.ghr-lang{display:inline-flex;align-items:center;gap:4px;flex:none}'
      + '.ghr-dot{width:7px;height:7px;border-radius:50%;display:inline-block}'
      + '.ghr-topic{background:var(--dsw-alias-bg-layer-3);border-radius:4px;padding:1px 6px;'
      +   'color:var(--dsw-alias-label-tertiary);max-width:100px;flex:none;'
      +   'overflow:hidden;text-overflow:ellipsis}'
      + '.ghr-vel{color:var(--dsw-alias-brand-primary);font-weight:600;flex:none}'

      + '.ghr-center{display:flex;flex-direction:column;align-items:center;justify-content:center;'
      +   'gap:10px;padding:44px 20px;color:var(--dsw-alias-label-tertiary);font-size:12px;'
      +   'text-align:center;flex:1;line-height:1.6}'
      + '.ghr-err{color:var(--dsw-alias-state-warn-primary);word-break:break-word;max-width:100%;'
      +   'line-height:1.5}'
      + '.ghr-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;'
      +   'color:var(--dsw-alias-label-secondary);border-radius:7px;padding:4px 12px;'
      +   'font-size:11.5px;cursor:pointer;font-family:inherit}'
      + '.ghr-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}'
      + '.ghr-banner{font-size:10.5px;color:var(--dsw-alias-state-warn-primary);'
      +   'padding:3px 16px 0;flex:none}';

    function fmtStars(n) {
      if (typeof n !== 'number') return '';
      if (n >= 10000) return Math.round(n / 1000) + 'k';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    }

    function fmtVelocity(n) {
      if (typeof n !== 'number' || n <= 0) return '';
      if (n >= 1000) return '+' + Math.round(n / 100) / 10 + 'k';
      if (n >= 10) return '+' + Math.round(n);
      return '+' + n.toFixed(1);
    }

    function fmtTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function RadarIcon() {
      return h('svg', {
          width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round'
        },
        h('circle', { cx: 8, cy: 8, r: 6.2 }),
        h('circle', { cx: 8, cy: 8, r: 3 }),
        h('circle', { cx: 8, cy: 8, r: .9, fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M8 8l4.4-3.4' })
      );
    }

    function RepoRow({ item, t }) {
      const color = LANG_COLOR[item.language] || '#9aa0a6';
      const topics = (item.topics || []).slice(0, 2);
      const showVelocity = typeof item.stars_per_day === 'number'
        && typeof item.age_days === 'number'
        && item.age_days <= VELOCITY_MAX_AGE_DAYS;
      return h('a', {
          className: 'ghr-row',
          href: item.url,
          target: '_blank',
          rel: 'noreferrer noopener',
          title: t('open') + ': ' + item.url
        },
        h('div', { className: 'ghr-r1' },
          h('span', { className: 'ghr-nm' },
            item.owner ? h('em', null, item.owner) : null,
            item.owner ? h('span', { className: 'ghr-slash' }, '/') : null,
            item.name
          ),
          h('span', { className: 'ghr-st' },
            h('span', { className: 'ghr-star' }, '★'),
            fmtStars(item.stars)
          )
        ),
        item.description ? h('div', { className: 'ghr-desc' }, item.description) : null,
        (item.language || topics.length || showVelocity)
          ? h('div', { className: 'ghr-r3' },
              item.language
                ? h('span', { className: 'ghr-lang' },
                    h('i', { className: 'ghr-dot', style: { background: color } }),
                    item.language
                  )
                : null,
              showVelocity
                ? h('span', { className: 'ghr-vel' },
                    fmtVelocity(item.stars_per_day) + t('perDay'))
                : null,
              topics.map(function (tp) {
                return h('span', { className: 'ghr-topic', key: tp }, tp);
              })
            )
          : null
      );
    }

    function RadarView({ t }) {
      const [period, setPeriod] = React.useState('day');
      const [query, setQuery] = React.useState('');
      const [feed, setFeed] = React.useState({ loading: true, error: null, data: null });
      const [search, setSearch] = React.useState({ active: false, loading: false, error: null, data: null });
      const trendingAbort = React.useRef(null);
      const searchAbort = React.useRef(null);
      const debounce = React.useRef(null);
      /** 中文输入法组词期间不触发请求，否则每敲一个拼音都会打一次 API。 */
      const composing = React.useRef(false);

      const loadTrending = React.useCallback(function (p, force) {
        if (trendingAbort.current) trendingAbort.current.abort();
        const ctl = new AbortController();
        trendingAbort.current = ctl;
        setFeed(function (s) { return { loading: true, error: null, data: s.data }; });
        const url = API_TRENDING + '?period=' + encodeURIComponent(p) + (force ? '&refresh=1' : '');
        fetch(url, { signal: ctl.signal, credentials: 'same-origin' })
          .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
          .then(function (res) {
            if (!res.ok || res.body.error) {
              setFeed({ loading: false, error: res.body.error || 'HTTP error', data: null });
              return;
            }
            setFeed({ loading: false, error: null, data: res.body });
          })
          .catch(function (err) {
            if (err && err.name === 'AbortError') return;
            setFeed({ loading: false, error: String((err && err.message) || err), data: null });
          });
      }, []);

      const runSearch = React.useCallback(function (kw) {
        const q = kw.trim();
        if (q.length < 2) {
          setSearch({ active: false, loading: false, error: null, data: null });
          return;
        }
        if (searchAbort.current) searchAbort.current.abort();
        const ctl = new AbortController();
        searchAbort.current = ctl;
        setSearch({ active: true, loading: true, error: null, data: null });
        fetch(API_SEARCH + '?q=' + encodeURIComponent(q), {
          signal: ctl.signal, credentials: 'same-origin'
        })
          .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
          .then(function (res) {
            if (!res.ok || res.body.error) {
              setSearch({ active: true, loading: false, error: res.body.error || 'HTTP error', data: null });
              return;
            }
            setSearch({ active: true, loading: false, error: null, data: res.body });
          })
          .catch(function (err) {
            if (err && err.name === 'AbortError') return;
            setSearch({ active: true, loading: false, error: String((err && err.message) || err), data: null });
          });
      }, []);

      React.useEffect(function () {
        loadTrending(period, false);
        return function () { if (trendingAbort.current) trendingAbort.current.abort(); };
      }, [period, loadTrending]);

      React.useEffect(function () {
        return function () { if (searchAbort.current) searchAbort.current.abort(); };
      }, []);

      function scheduleSearch(value) {
        if (debounce.current) clearTimeout(debounce.current);
        if (!value.trim()) {
          if (searchAbort.current) searchAbort.current.abort();
          setSearch({ active: false, loading: false, error: null, data: null });
          return;
        }
        debounce.current = setTimeout(function () { runSearch(value); }, SEARCH_DEBOUNCE_MS);
      }

      function onChange(e) {
        const v = e.target.value;
        setQuery(v);
        if (composing.current) return;   // 组词中，等 compositionend 再搜
        scheduleSearch(v);
      }

      function clearSearch() {
        if (debounce.current) clearTimeout(debounce.current);
        if (searchAbort.current) searchAbort.current.abort();
        setQuery('');
        setSearch({ active: false, loading: false, error: null, data: null });
      }

      const searching = search.active;
      const items = searching ? ((search.data && search.data.items) || []) : ((feed.data && feed.data.items) || []);
      const busy = searching ? search.loading : feed.loading;
      const err = searching ? search.error : feed.error;

      let content;
      if (err) {
        content = h('div', { className: 'ghr-center' },
          h('div', { className: 'ghr-err' }, t('failed') + '：' + err),
          h('button', {
            className: 'ghr-btn',
            onClick: function () { searching ? runSearch(query) : loadTrending(period, true); }
          }, t('retry'))
        );
      } else if (!items.length) {
        let msg = busy ? t('loading') : (searching ? t('searchEmpty') : t('empty'));
        if (searching && query.trim().length < 2) msg = t('searchTooShort');
        content = h('div', { className: 'ghr-center' }, h('span', null, msg));
      } else {
        content = h('div', { className: 'ghr-list' },
          items.map(function (it) { return h(RepoRow, { key: it.full_name, item: it, t: t }); })
        );
      }

      const headerMeta = searching
        ? (search.data ? t('searchResults').replace('{n}', search.data.total.toLocaleString()) : '')
        : (feed.data
            ? fmtTime(feed.data.fetchedAt) + (feed.data.stale ? ' ' + t('stale') : '')
            : '');

      return h('div', { className: 'ghr-root' },
        h('style', { key: 'styles' }, CSS),

        h('div', { className: 'ghr-hd' },
          h('span', { className: 'ghr-ttl' }, t('tab')),
          h('span', { className: 'ghr-grow' }),
          headerMeta ? h('span', { className: 'ghr-meta' }, headerMeta) : null,
          h('button', {
            className: 'ghr-icon',
            disabled: busy,
            title: t('refresh'),
            onClick: function () { searching ? runSearch(query) : loadTrending(period, true); }
          }, '⟳')
        ),

        h('div', { className: 'ghr-searchwrap' },
          h('span', { className: 'ghr-searchIcon' }, '⌕'),
          h('input', {
            className: 'ghr-search',
            type: 'text',
            value: query,
            placeholder: t('searchPlaceholder'),
            spellCheck: false,
            onChange: onChange,
            onCompositionStart: function () { composing.current = true; },
            onCompositionEnd: function (e) {
              composing.current = false;
              scheduleSearch(e.target.value);
            },
            onKeyDown: function (e) {
              if (e.key === 'Escape') { e.preventDefault(); clearSearch(); }
              if (e.key === 'Enter' && !composing.current) {
                e.preventDefault();
                if (debounce.current) clearTimeout(debounce.current);
                runSearch(query);
              }
            }
          }),
          query
            ? h('button', {
                className: 'ghr-searchClear',
                title: t('searchClear'),
                onClick: clearSearch
              }, '✕')
            : null
        ),

        h('div', { className: 'ghr-seg' },
          PERIODS.map(function (p) {
            return h('button', {
              key: p,
              'data-on': (!searching && p === period) ? '1' : '0',
              disabled: searching,
              title: t(p + 'Hint'),
              onClick: function () { setPeriod(p); }
            }, t(p));
          })
        ),

        feed.data && feed.data.stale && !searching
          ? h('div', { className: 'ghr-banner' }, t('stale'))
          : null,

        content
      );
    }

    function registerLocales(ctx) {
      const entries = [['zh', ZH], ['zh-CN', ZH], ['en', EN], ['en-US', EN]];
      const disposers = [];
      for (const [lang, dict] of entries) {
        try {
          disposers.push(ctx.locale.register(NS, lang, dict));
        } catch {
          /* 已注册过 */
        }
      }
      return disposers;
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        const disposers = registerLocales(ctx);
        ctx.effect(function () {
          return function () {
            for (let i = 0; i < disposers.length; i += 1) disposers[i]();
          };
        });

        const bindLocale = (ns) => {
          try {
            const bound = ctx.locale.bind(ns);
            if (typeof bound === 'function') return bound;
          } catch {
            /* 退回静态字典 */
          }
          return (key) => (ZH[key] !== undefined ? ZH[key] : key);
        };
        const t = bindLocale(NS);

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => t('tabShort'),
          guide: [{
            id: 'github-radar',
            order: 62,
            title: () => t('tab'),
            description: () => t('guideDesc'),
            icon: RadarIcon
          }]
        }), 'github-radar: tab type');

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
          inject: () => ({})
        }, function GithubRadarPane() {
          return h(RadarView, { t: t });
        })), 'github-radar: pane body');

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID
        }, function GithubRadarTitle() {
          return h('span', null, t('tabShort'));
        })), 'github-radar: pane title');
      }
    };
  }
});
