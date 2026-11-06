/**
 * dsh-github-radar — 客户端。
 *
 * 注册一个右侧栏标签页（kind "github-radar"），打开即自动向宿主路由
 * 拉取 GitHub 热门项目。列表式紧凑排版：仓库名 / 一句话说明 / 语言与话题，
 * 整行可点击，直接在新标签打开 GitHub 仓库页。
 */
window.__ModuleLoader__.load({
  id: 'dsh-github-radar',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'github-radar';
    const TAB_KIND = 'github-radar';
    const TAB_ID = 'dsh-github-radar';
    const API = 'api/github-radar/trending';

    const PERIODS = ['day', 'week', 'all'];

    const ZH = {
      tab: 'GitHub 雷达',
      tabShort: '雷达',
      guideDesc: '自动拉取 GitHub 热门项目 · 说明用途 · 点击直达仓库',
      refresh: '刷新',
      loading: '正在拉取 GitHub…',
      failed: '拉取失败',
      retry: '重试',
      stale: '离线缓存',
      empty: '这个档位暂时没有结果',
      open: '在 GitHub 打开',
      day: '今日冒头',
      week: '本月新星',
      all: '常青热门',
      dayHint: '最近 7 天新建、已经开始起量的仓库',
      weekHint: '最近 30 天新建、已经破百星的仓库',
      allHint: '两万星以上且近 30 天仍在维护的仓库'
    };
    const EN = {
      tab: 'GitHub Radar',
      tabShort: 'Radar',
      guideDesc: 'Trending GitHub repos · what they do · click to open',
      refresh: 'Refresh',
      loading: 'Fetching from GitHub…',
      failed: 'Failed to load',
      retry: 'Retry',
      stale: 'cached',
      empty: 'Nothing here for this period',
      open: 'Open on GitHub',
      day: 'Rising',
      week: 'This month',
      all: 'Giants',
      dayHint: 'Repos created in the last 7 days that are picking up stars',
      weekHint: 'Repos created in the last 30 days with 100+ stars',
      allHint: 'Repos with 20k+ stars still pushed in the last 30 days'
    };

    /** 常见语言色点，贴近 GitHub 自己的配色。 */
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

      // 顶栏：标题 + 更新时间 + 刷新
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

      // 档位分段控件
      + '.ghr-seg{display:flex;gap:2px;margin:10px 14px 8px;padding:2px;'
      +   'background:var(--dsw-alias-bg-layer-3);border-radius:8px;flex:none}'
      + '.ghr-seg button{flex:1;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);'
      +   'font-size:11.5px;padding:5px 0;border-radius:6px;cursor:pointer;font-weight:500;'
      +   'font-family:inherit;transition:background .12s}'
      + '.ghr-seg button[data-on="1"]{background:var(--dsw-alias-bg-layer-1);'
      +   'color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}'

      // 列表
      + '.ghr-list{flex:1;overflow-y:auto;min-height:0;padding:0 6px 14px}'
      + '.ghr-row{display:block;text-decoration:none;color:inherit;padding:8px 8px 9px;border-radius:7px;'
      +   'border-bottom:1px solid var(--dsw-alias-border-l1);transition:background .12s}'
      + '.ghr-row:last-child{border-bottom:none}'
      + '.ghr-row:hover{background:var(--dsw-alias-bg-layer-1)}'
      + '.ghr-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}'

      // 第一行：仓库全名 + 星标
      + '.ghr-r1{display:flex;align-items:baseline;gap:8px;min-width:0}'
      + '.ghr-nm{font-size:12.5px;font-weight:600;line-height:1.4;min-width:0;'
      +   'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.ghr-nm em{font-style:normal;font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:11.5px}'
      + '.ghr-slash{color:var(--dsw-alias-label-caption);margin:0 1px;font-weight:400}'
      + '.ghr-st{margin-left:auto;padding-left:10px;flex:none;font-size:10.5px;'
      +   'color:var(--dsw-alias-label-tertiary);font-weight:500;'
      +   'display:inline-flex;align-items:center;gap:3px;letter-spacing:.2px}'
      + '.ghr-star{font-size:10px;color:var(--dsw-alias-label-caption)}'

      // 第二行：一句话说明，单行截断
      + '.ghr-desc{margin-top:3px;font-size:11.5px;line-height:1.45;'
      +   'color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'

      // 第三行：语言 + 话题
      + '.ghr-r3{display:flex;align-items:center;gap:5px;margin-top:5px;font-size:10px;'
      +   'color:var(--dsw-alias-label-tertiary);overflow:hidden;white-space:nowrap}'
      + '.ghr-lang{display:inline-flex;align-items:center;gap:4px;flex:none}'
      + '.ghr-dot{width:7px;height:7px;border-radius:50%;display:inline-block}'
      + '.ghr-topic{background:var(--dsw-alias-bg-layer-3);border-radius:4px;padding:1px 6px;'
      +   'color:var(--dsw-alias-label-tertiary);max-width:100px;flex:none;'
      +   'overflow:hidden;text-overflow:ellipsis}'

      // 状态区
      + '.ghr-center{display:flex;flex-direction:column;align-items:center;justify-content:center;'
      +   'gap:10px;padding:44px 20px;color:var(--dsw-alias-label-tertiary);font-size:12px;'
      +   'text-align:center;flex:1}'
      + '.ghr-err{color:var(--dsw-alias-state-warn-primary);word-break:break-word;max-width:100%;'
      +   'line-height:1.5}'
      + '.ghr-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;'
      +   'color:var(--dsw-alias-label-secondary);border-radius:7px;padding:4px 12px;'
      +   'font-size:11.5px;cursor:pointer;font-family:inherit}'
      + '.ghr-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}'
      + '.ghr-banner{font-size:10.5px;color:var(--dsw-alias-state-warn-primary);'
      +   'padding:3px 10px 0;flex:none}';

    function fmtStars(n) {
      if (typeof n !== 'number') return '';
      if (n >= 10000) return Math.round(n / 1000) + 'k';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
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
        item.description
          ? h('div', { className: 'ghr-desc' }, item.description)
          : null,
        (item.language || topics.length)
          ? h('div', { className: 'ghr-r3' },
              item.language
                ? h('span', { className: 'ghr-lang' },
                    h('i', { className: 'ghr-dot', style: { background: color } }),
                    item.language
                  )
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
      const [state, setState] = React.useState({ loading: true, error: null, data: null });
      const abortRef = React.useRef(null);

      const load = React.useCallback(function (p, force) {
        if (abortRef.current) abortRef.current.abort();
        const ctl = new AbortController();
        abortRef.current = ctl;
        setState(function (s) { return { loading: true, error: null, data: s.data }; });
        const url = API + '?period=' + encodeURIComponent(p) + (force ? '&refresh=1' : '');
        fetch(url, { signal: ctl.signal, credentials: 'same-origin' })
          .then(function (r) {
            return r.json().then(function (body) { return { ok: r.ok, body: body }; });
          })
          .then(function (res) {
            if (!res.ok || res.body.error) {
              setState({ loading: false, error: res.body.error || 'HTTP error', data: null });
              return;
            }
            setState({ loading: false, error: null, data: res.body });
          })
          .catch(function (err) {
            if (err && err.name === 'AbortError') return;
            setState({ loading: false, error: String((err && err.message) || err), data: null });
          });
      }, []);

      React.useEffect(function () {
        load(period, false);
        return function () { if (abortRef.current) abortRef.current.abort(); };
      }, [period, load]);

      const items = (state.data && state.data.items) || [];
      const hint = t(period + 'Hint');

      let content;
      if (state.error) {
        content = h('div', { className: 'ghr-center' },
          h('div', { className: 'ghr-err' }, t('failed') + '：' + state.error),
          h('button', { className: 'ghr-btn', onClick: function () { load(period, true); } }, t('retry'))
        );
      } else if (!items.length) {
        content = h('div', { className: 'ghr-center' },
          h('span', null, state.loading ? t('loading') : t('empty'))
        );
      } else {
        content = h('div', { className: 'ghr-list' },
          items.map(function (it) {
            return h(RepoRow, { key: it.full_name, item: it, t: t });
          })
        );
      }

      return h('div', { className: 'ghr-root' },
        h('style', { key: 'styles' }, CSS),
        h('div', { className: 'ghr-hd' },
          h('span', { className: 'ghr-ttl' }, t('tab')),
          h('span', { className: 'ghr-grow' }),
          state.data && state.data.fetchedAt
            ? h('span', { className: 'ghr-meta' }, fmtTime(state.data.fetchedAt) + ' ' + (state.data.stale ? t('stale') : ''))
            : null,
          h('button', {
            className: 'ghr-icon',
            disabled: state.loading,
            title: t('refresh'),
            onClick: function () { load(period, true); }
          }, '⟳')
        ),
        h('div', { className: 'ghr-seg' },
          PERIODS.map(function (p) {
            return h('button', {
              key: p,
              'data-on': p === period ? '1' : '0',
              title: t(p + 'Hint'),
              onClick: function () { setPeriod(p); }
            }, t(p));
          })
        ),
        state.data && state.data.stale
          ? h('div', { className: 'ghr-banner' }, t('stale'))
          : null,
        content,
        h('div', { style: { display: 'none' } }, hint)
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
