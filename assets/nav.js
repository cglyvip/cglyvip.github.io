/* =========================================================================
 * cglyvip · 工具导航 —— 数据与渲染
 *
 * 要加一个条目：往下面 CATEGORIES 里对应的 items 数组塞一个对象就行。
 * 字段：name / desc / url / tags / meta / note / links / kind
 *   links: [{ label, href, primary?, icon? }]
 * ========================================================================= */

(function () {
  'use strict';

  /* ---------------- 常量：改成你的仓库信息即可 ---------------- */
  const USER = 'cglyvip';
  const REPO = 'cglyvip.github.io';
  const BRANCH = 'main';
  const SCRIPT_PATH = 'scripts/linuxdo-l3-auto-browse.user.js';

  const REPO_URL = 'https://github.com/' + USER + '/' + REPO;
  const SCRIPT_SRC = REPO_URL + '/blob/' + BRANCH + '/' + SCRIPT_PATH;
  // 直接安装：Tampermonkey 会拦截 *.user.js 并弹出安装页
  const SCRIPT_RAW = 'https://raw.githubusercontent.com/' + USER + '/' + REPO + '/' + BRANCH + '/' + SCRIPT_PATH;
  // 大陆直连更稳的镜像（jsDelivr 反代 GitHub）
  const SCRIPT_MIRROR = 'https://cdn.jsdelivr.net/gh/' + USER + '/' + REPO + '@' + BRANCH + '/' + SCRIPT_PATH;

  /* ---------------- 私有仓库：默认不展示 ----------------
   * 本站是公开页面，列私有仓库名会暴露它们的存在。
   * 想在自己的导航页看到，就把 SHOW_PRIVATE 改成 true。
   */
  const SHOW_PRIVATE = false;

  const PRIVATE_PROJECTS = [
    { name: 'CGPlay', desc: '', lang: 'JavaScript', pushed: '2026-10-18' },
    { name: 'xingmu-ai', desc: '星幕 AI 影视搜索与发现应用', lang: 'JavaScript', pushed: '2026-10-01' },
    { name: 'ShortVideoFactory', desc: 'AI 短视频混剪工厂', lang: 'Python', pushed: '2026-09-25' },
    { name: 'boplayer', desc: '', lang: 'JavaScript', pushed: '2026-09-23' }
  ].map(function (p) {
    return {
      name: p.name,
      desc: p.desc,
      url: 'https://github.com/' + USER + '/' + p.name,
      kind: 'private',
      tag: '私有',
      meta: [p.lang, p.pushed].filter(Boolean).join(' · ')
    };
  });

  /* ---------------- 导航数据 ---------------- */
  const CATEGORIES = [
    {
      id: 'scripts',
      name: '浏览器脚本',
      items: [
        {
          name: 'Linux.do L3 自动浏览助手',
          desc: '自动浏览 linux.do 话题、标记已读、点赞、辅助回复，实时显示 Discourse 信任等级 TL3 的各项差距，缺什么补什么；内置「专攻阅读帖子」与「维持 L3」模式。',
          kind: 'script',
          tag: '用户脚本',
          meta: ['v1.3.3', 'JavaScript', 'Tampermonkey'],
          note: '装好后打开 linux.do，右下角会出现一个小圆标，点开即是面板。',
          links: [
            { label: '安装脚本', href: SCRIPT_RAW, primary: true, icon: 'download' },
            { label: '镜像加速', href: SCRIPT_MIRROR, icon: 'link' },
            { label: '查看源码', href: SCRIPT_SRC, icon: 'code' }
          ]
        }
      ]
    },
    {
      id: 'projects',
      name: '开源项目',
      items: [
        {
          name: 'dsh-auto-continue',
          desc: 'DeepSeek Harness 插件：模型请求失败自动注入「继续」并切换兜底模型，免手动干预。',
          url: 'https://github.com/' + USER + '/dsh-auto-continue',
          meta: ['JavaScript', '2026-10-02'],
          tags: ['dsh', '插件']
        },
        {
          name: 'kbcut',
          desc: '使用 L 站大佬 GGgrok 的公益模型编写。',
          url: 'https://github.com/' + USER + '/kbcut',
          meta: ['TypeScript', '2026-10-10', '★ 1']
        },
        {
          name: 'MMplay',
          desc: '',
          url: 'https://github.com/' + USER + '/MMplay',
          meta: ['2026-03-22']
        }
      ].concat(SHOW_PRIVATE ? PRIVATE_PROJECTS : [])
    },
    {
      id: 'sites',
      name: '常用站点',
      items: [
        {
          name: 'linux.do',
          desc: 'Discourse 中文社区。导航里的脚本主要就是为它写的。',
          url: 'https://linux.do/',
          meta: ['linux.do']
        },
        {
          name: '升级要求（connect）',
          desc: '信任等级各项指标的官方口径页面，需要登录后查看。',
          url: 'https://connect.linux.do/',
          meta: ['linux.do']
        },
        {
          name: 'GitHub 仓库列表',
          desc: 'cglyvip 的全部仓库。',
          url: 'https://github.com/' + USER + '?tab=repositories',
          meta: ['github.com']
        }
      ]
    }
  ];

  /* ---------------- 小工具 ---------------- */
  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return node;
  }

  var ICONS = {
    download: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16',
    link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19',
    code: 'M9 18l-6-6 6-6M15 6l6 6-6 6',
    ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'
  };

  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[name] || ICONS.link);
    svg.appendChild(p);
    return svg;
  }

  /** 命中搜索：名称 / 描述 / 标签 / 元信息 */
  function matches(item, q) {
    if (!q) return true;
    var hay = [item.name, item.desc, item.tag, item.meta, item.tags].join(' ').toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
  }

  function card(item, index) {
    var c = h('article', { class: 'card' });
    c.style.setProperty('--i', String(index % 8));

    var title = item.name;
    var nameEl = item.url
      ? h('a', { href: item.url, target: '_blank', rel: 'noopener', text: title })
      : h('span', { text: title });

    c.appendChild(h('div', { class: 'card-top' },
      h('h3', { class: 'card-name' }, nameEl),
      item.tag ? h('span', { class: 'tag ' + (item.kind || ''), text: item.tag }) : null
    ));

    c.appendChild(item.desc
      ? h('p', { class: 'card-desc', text: item.desc })
      : h('p', { class: 'card-desc empty', text: '暂无简介' }));

    if (item.meta) {
      var parts = String(item.meta).split(' · ');
      c.appendChild(h('div', { class: 'card-meta' },
        parts.map(function (t, i) {
          var cls = t.indexOf('★') === 0 ? 'st' : '';
          return [i ? h('span', { text: '·' }) : null, h('span', { class: cls, text: t })];
        }).flat()
      ));
    }

    if (item.note) c.appendChild(h('p', { class: 'card-desc', text: item.note }));

    var links = (item.links || []).slice();
    if (item.url && !links.length) {
      links.push({ label: '打开', href: item.url, icon: 'ext' });
    }
    if (links.length) {
      c.appendChild(h('div', { class: 'card-actions' },
        links.map(function (l) {
          return h('a', {
            class: 'btn' + (l.primary ? ' primary' : ''),
            href: l.href,
            target: '_blank',
            rel: 'noopener'
          }, icon(l.icon || 'ext'), h('span', { text: l.label }));
        })
      ));
    }
    return c;
  }

  /* ---------------- 渲染 ---------------- */
  var state = { cat: 'all', q: '' };
  var sectionsEl = document.getElementById('sections');
  var filtersEl = document.getElementById('filters');
  var countEl = document.getElementById('count');
  var emptyEl = document.getElementById('empty');
  var updatedEl = document.getElementById('updated');

  function visibleItems(cat) {
    return cat.items.filter(function (it) {
      if (!matches(it, state.q)) return false;
      if (state.q) return true;
      // 无搜索词时私有条目按标记过滤（例如后续可加更多条件）
      return !(it.kind === 'private' && !SHOW_PRIVATE);
    });
  }

  function renderFilters() {
    filtersEl.textContent = '';
    var cats = [{ id: 'all', name: '全部' }].concat(CATEGORIES);
    cats.forEach(function (cat) {
      var n = cat.id === 'all'
        ? CATEGORIES.reduce(function (s, c) { return s + visibleItems(c).length; }, 0)
        : visibleItems(cat).length;
      var chip = h('button', {
        class: 'chip',
        type: 'button',
        'aria-selected': String(state.cat === cat.id),
        onclick: function () { state.cat = cat.id; render(); }
      }, h('span', { text: cat.name }), h('span', { class: 'n', text: String(n) }));
      filtersEl.appendChild(chip);
    });
  }

  function render() {
    renderFilters();
    sectionsEl.textContent = '';

    var total = 0;
    CATEGORIES.forEach(function (cat, ci) {
      if (state.cat !== 'all' && state.cat !== cat.id) return;
      var items = visibleItems(cat);
      if (!items.length) return;
      total += items.length;

      var grid = h('div', { class: 'grid' });
      items.forEach(function (it, i) { grid.appendChild(card(it, i)); });

      sectionsEl.appendChild(h('section', { class: 'group' },
        h('div', { class: 'group-head' },
          h('span', { class: 'group-no', text: String(ci + 1).padStart(2, '0') }),
          h('h2', { class: 'group-name', text: cat.name }),
          h('span', { class: 'group-rule' }),
          h('span', { class: 'group-count', text: items.length + ' 项' })
        ),
        grid
      ));
    });

    countEl.textContent = String(total);
    emptyEl.hidden = total > 0;
  }

  /* ---------------- 最新更新时间（取所有条目的日期最大值） ---------------- */
  (function stamp() {
    var dates = [];
    CATEGORIES.forEach(function (c) {
      c.items.forEach(function (it) {
        String(it.meta || '').split(' · ').forEach(function (t) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(t)) dates.push(t);
        });
      });
    });
    dates.sort();
    updatedEl.textContent = dates.length ? dates[dates.length - 1] : '—';
  })();

  /* ---------------- 交互 ---------------- */
  var input = document.getElementById('q');
  input.addEventListener('input', function () {
    state.q = input.value.trim().toLowerCase();
    render();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    } else if (e.key === 'Escape' && document.activeElement === input) {
      input.value = '';
      state.q = '';
      render();
      input.blur();
    }
  });

  render();
})();
