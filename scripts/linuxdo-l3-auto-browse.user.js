// ==UserScript==
// @name         Linux.do 自动浏览 · L3 升级助手
// @name:en      Linux.do Auto Browse · TL3 Helper
// @namespace    https://linux.do/
// @version      1.3.3
// @description  自动浏览 linux.do 话题、标记已读、点赞、辅助回复，实时显示信任等级 L3 的差距，缺什么补什么。仅用于自己的账号，请合理设置频率。
// @author       cglyvip
// @homepageURL  https://cglyvip.github.io/
// @updateURL    https://raw.githubusercontent.com/cglyvip/cglyvip.github.io/main/scripts/linuxdo-l3-auto-browse.user.js
// @downloadURL  https://raw.githubusercontent.com/cglyvip/cglyvip.github.io/main/scripts/linuxdo-l3-auto-browse.user.js
// @match        https://linux.do/*
// @match        https://www.linux.do/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      connect.linux.do
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* eslint-disable no-console */
(function () {
  'use strict';

  /* =========================================================================
   * 0. 常量与默认配置
   * ========================================================================= */

  const NS = 'ld_auto_browse_v1';
  const LOG_MAX = 300;
  // 与文件头的 @version 保持一致，改版本时记得同步这里（面板日志会显示它）
  const VERSION = 'v1.3.3';

  // Discourse TL3（信任等级 3 / 活跃用户）默认门槛。
  // linux.do 基本沿用官方默认值，个别项可能有差异，如有出入直接改这里的常量
  //（面板只暴露运行频率等参数，不包含门槛数值）。
  const TL3_REQUIREMENTS = {
    // 最近 100 天内，至少 50% 的天数访问过站点
    daysVisitedRatio: 0.5,
    daysWindow: 100,
    // 最近 100 天内，回复过至少 10 个不同的话题（非私信）
    topicsReplied: 10,
    // 最近 100 天创建的话题中，浏览过 25%（上限 500）
    topicsViewedRatio: 0.25,
    topicsViewedCap: 500,
    // 最近 100 天创建的帖子中，阅读过 25%（上限 20000）
    postsReadRatio: 0.25,
    postsReadCap: 20000,
    // 最近 100 天内，给出至少 30 个赞（至少 6 个不同用户、8 个不同日期）
    likesGiven: 30,
    likesGivenMinUsers: 6,
    likesGivenMinDays: 8,
    // 最近 100 天内，收到至少 20 个赞（至少 4 个不同用户、5 个不同日期）
    likesReceived: 20,
    likesReceivedMinUsers: 4,
    likesReceivedMinDays: 5,
    // 注册满 100 天（硬门槛，脚本无法缩短）
    minAccountAgeDays: 100,
  };

  const DEFAULTS = {
    enabled: false,          // 总开关：是否自动运行
    mode: 'smart',           // smart = 快速浏览(接口级)；browse = 真实浏览(跳页+滚动)
    autoLike: true,          // 自动点赞（补"给出的赞"）
    autoReply: false,        // 自动回复（默认关闭，风险最高，需自行确认）
    autoVisitDaily: true,    // 每天自动访问一次（补"访问天数"）
    // 面板默认收起：每页只在右下角留一个小图标，点它才展开（展开/收起状态会记住）
    panelCollapsed: true,
    // 频率（保守默认，降低被风控/封号的概率）
    readTopicsPerRun: 12,    // 每轮浏览的话题数
    gapMsMin: 2500,          // 请求间隔下限
    gapMsMax: 6000,          // 请求间隔上限
    likesPerDay: 5,          // 每天最多点赞数（30 个赞需跨 8 天，别一天点完）
    repliesPerDay: 2,        // 每天最多自动回复数
    replyIntervalMin: 45,    // 两次自动回复的最小间隔（分钟）
    maxSessionMinutes: 25,   // 单次自动运行最长时间
    replyTemplates: [
      '感谢分享，学到了，收藏一下慢慢看。',
      '很实用的经验，正好解决了我遇到的问题，谢谢楼主。',
      '思路很清晰，按这个方法试了一下确实有效。',
      '这个坑我也踩过，补充一点：注意版本差异，不同环境下表现不太一样。',
      '写得很详细，感谢整理，期待后续更新。',
    ],
    // 真实浏览模式参数
    browseScrollSteps: 14,
    browseScrollWaitMs: 1200,
    browseTopicWaitMs: 9000,
    // 「专攻阅读帖子」快速追赶：只有点面板上的专用按钮才生效
    postRushPerTopic: 200,   // 每个话题一次最多上报多少帖
    postRushGapMsMin: 700,   // 专攻请求间隔下限（比常规快）
    postRushGapMsMax: 1600,  // 专攻请求间隔上限
    // 达标之后的「维持」阶段：TL3 是按最近 100 天滚动计算的，每过一天窗口后沿就掉出一天旧记录，
    // 所以到 L3 不是终点——每天必须补回等量的新记录，否则指标会一天天滑回 2 级。
    autoMaintainDaily: false,  // 达标后每天自动补一次滚动窗口掉出的量
    maintainPostsPerDay: 0,    // 每日维持帖数，0 = 按官方需求自动算（约 240 帖/天）
    maintainSafetyFactor: 1.2, // 每日配额的安全系数（官方需求 ÷ 100 天 × 本值）
  };

  /* =========================================================================
   * 1. 存储层（GM_getValue 优先，失败回退 localStorage）
   * ========================================================================= */

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function readRaw(key, fallback) {
    try {
      if (hasGM) {
        const v = GM_getValue(key, null);
        return v === null || v === undefined ? fallback : v;
      }
      const s = localStorage.getItem(NS + ':' + key);
      return s === null ? fallback : JSON.parse(s);
    } catch (e) {
      return fallback;
    }
  }

  function writeRaw(key, value) {
    try {
      if (hasGM) {
        GM_setValue(key, value);
        return;
      }
      localStorage.setItem(NS + ':' + key, JSON.stringify(value));
    } catch (e) {
      /* 忽略写入失败（隐私模式等） */
    }
  }

  function todayKey(d) {
    const dt = d || new Date();
    return (
      dt.getFullYear() +
      '-' +
      String(dt.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(dt.getDate()).padStart(2, '0')
    );
  }

  /** 运行期状态（跨页面刷新持久化） */
  const state = {
    config: Object.assign({}, DEFAULTS, readRaw('config', {})),
    log: readRaw('log', []),
    visitedDays: readRaw('visitedDays', []),      // 本脚本记录到的访问日期
    readTopics: readRaw('readTopics', {}),        // { 'YYYY-MM-DD': [topicId, ...] }
    likedPosts: readRaw('likedPosts', []),        // 已点赞的 post id
    likeDays: readRaw('likeDays', {}),            // { 'YYYY-MM-DD': 次数 }
    likedUsers: readRaw('likedUsers', {}),        // { username: 次数 }（用于"不同用户"要求）
    replyDays: readRaw('replyDays', {}),          // { 'YYYY-MM-DD': 次数 }
    repliedTopics: readRaw('repliedTopics', []),  // 已回复过的话题 id
    lastReplyAt: readRaw('lastReplyAt', 0),
    queue: readRaw('queue', []),                  // 真实浏览模式的待浏览话题队列
    session: readRaw('session', null),            // { startedAt, topicsDone, likesDone, repliesDone }
    progress: readRaw('progress', null),          // 最近一次抓到的进度快照
    postRush: readRaw('postRush', {}),            // { topicId: 已上报到的帖号 }，供「专攻阅读帖子」跳过重复
    maintainDays: readRaw('maintainDays', {}),    // { 'YYYY-MM-DD': 当天已维持的帖数 }，防止同一天重复补
  };

  function saveConfig() { writeRaw('config', state.config); }
  function save(key) { writeRaw(key, state[key]); }

  function log(msg, level) {
    const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    state.log.push({ t: Date.now(), msg: String(msg), level: level || 'info' });
    if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
    save('log');
    if (level === 'error') console.warn('[LD-L3]', msg);
    else console.log('[LD-L3]', msg);
    if (ui && ui.ready) ui.renderLog();
  }

  /* =========================================================================
   * 2. 网络层：Discourse JSON API
   * ========================================================================= */

  function csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : null;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function randGap() {
    const a = Number(state.config.gapMsMin) || 2500;
    const b = Math.max(a, Number(state.config.gapMsMax) || 6000);
    return a + Math.random() * (b - a);
  }

  /** 数值配置解析：显式写 0 时按 0 处理，只有非法值才回退默认 */
  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** 楼层正文的纯文本长度（去掉 HTML 标签） */
  function plainLength(html) {
    return String(html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().length;
  }

  /**
   * 按楼层正文长度估算阅读停留时长（借鉴本机 ReadBoost / 自动浏览助手的思路）：
   * 让上报时长与内容量挂钩，而不是所有楼层共用同一个随机区间，
   * 服务端看到的更接近"人在读帖"。曲线在 350 字处约 63%，之后渐近趋满。
   */
  function contentReadMs(textLen) {
    const len = Math.max(0, Number(textLen) || 0);
    const sat = 1 - Math.exp(-len / 350);
    const ms = 800 + sat * 2200;                            // 800 ~ 3000ms
    return Math.round(ms * (0.85 + Math.random() * 0.3));    // ±15% 抖动
  }

  /** 统一请求封装：GET/POST json，自动带 CSRF、限速、429 退避重试 */
  async function api(path, opts) {
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    const headers = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    };
    let body = null;

    if (method !== 'GET') {
      const token = csrfToken();
      if (token) headers['X-CSRF-Token'] = token;
      if (opts.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        body = Object.keys(opts.form)
          .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(opts.form[k]))
          .join('&');
      } else if (opts.json) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.json);
      }
    }

    // 429 退避后重试一次；仍被限速才放弃，避免一次限速就中断整个动作
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(path, {
        method: method,
        headers: headers,
        body: body,
        credentials: 'same-origin',
        cache: 'no-store',
      });

      if (res.status === 429) {
        if (attempt >= MAX_ATTEMPTS) throw new Error('rate_limited(429)：限速未解除，稍后再试');
        const wait = 30000 + Math.random() * 30000;
        log('被限速(429)，等待 ' + Math.round(wait / 1000) + ' 秒后重试', 'warn');
        await sleep(wait);
        continue;
      }
      if (res.status === 403) throw new Error('forbidden(403)：可能未登录或触发风控');
      if (!res.ok) throw new Error('HTTP ' + res.status + ' @ ' + path);

      const text = await res.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (e) {
        return { _raw: text };
      }
    }
  }

  async function apiGet(path) { return api(path, { method: 'GET' }); }
  async function apiPost(path, form) { return api(path, { method: 'POST', form: form }); }

  /* =========================================================================
   * 3. 账号与进度探测
   * ========================================================================= */

  let currentUser = null;

  /** force=true 时强制重新拉取，用于实时识别等级变化（页面不刷新也能发现已升 TL3） */
  async function fetchCurrentUser(force) {
    if (currentUser && !force) return currentUser;
    try {
      const data = await apiGet('/session/current.json');
      if (data && data.current_user) {
        currentUser = data.current_user;
        return currentUser;
      }
    } catch (e) { /* 未登录或失败 */ }
    // 回退：从页面里猜
    const meta = document.querySelector('meta[name="current-user"]');
    if (meta) {
      try { currentUser = JSON.parse(meta.getAttribute('content')); } catch (e) { /* noop */ }
    }
    return currentUser;
  }

  /** 抓取用户汇总数据（阅读量/点赞数等） */
  async function fetchSummary(username) {
    const out = { ok: false, raw: null };
    try {
      const data = await apiGet('/u/' + encodeURIComponent(username) + '/summary.json');
      if (data && data.user_summary) {
        out.ok = true;
        out.raw = data.user_summary;
      }
    } catch (e) {
      log('读取用户汇总失败：' + e.message, 'warn');
    }
    return out;
  }

  /** 解析官方「升级要求」页 HTML，返回 [{label, have, need, done}] */
  function parseOfficialHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = [];
    const num = (s) => {
      const m = /([\d.]+)\s*\/\s*([\d.]+)/.exec(s || '');
      return m ? { have: Number(m[1]), need: Number(m[2]) } : null;
    };

    // 活跃程度：进度环 <div class="tl3-ring">
    doc.querySelectorAll('.tl3-ring').forEach((ring) => {
      const circle = ring.querySelector('.tl3-ring-circle');
      const label = (ring.querySelector('.tl3-ring-label') || {}).textContent;
      if (!circle || !label) return;
      const st = circle.getAttribute('style') || '';
      const vm = /--val:\s*([\d.]+)/.exec(st);
      const mm = /--max:\s*([\d.]+)/.exec(st);
      if (!vm || !mm) return;
      items.push({
        label: label.trim(),
        have: Number(vm[1]),
        need: Number(mm[1]),
        done: circle.classList.contains('met'),
      });
    });

    // 互动参与 / 合规记录：进度条 <div class="tl3-bar-item">
    doc.querySelectorAll('.tl3-bar-item').forEach((bar) => {
      const label = (bar.querySelector('.tl3-bar-label') || {}).textContent;
      const nums = bar.querySelector('.tl3-bar-nums');
      if (!label || !nums) return;
      const n = num(nums.textContent);
      if (!n) return;
      items.push({ label: label.trim(), have: n.have, need: n.need, done: nums.classList.contains('met') });
    });

    return items;
  }

  /**
   * 读取官方「升级要求」页（connect.linux.do）。
   * 这是唯一能拿到 L3 真实差额的来源：浏览帖子 10490/20000、获赞 18/20 这类
   * "近 100 天"口径的数字，站在 linux.do 的接口里都拿不到。
   * 该域对跨站子请求可能直接返回 403，所以依次换几组请求头重试，命中即用。
   */
  async function fetchOfficialL3() {
    if (typeof GM_xmlhttpRequest !== 'function') {
      return { ok: false, error: '当前环境没有 GM_xmlhttpRequest 权限' };
    }
    const url = 'https://connect.linux.do/';
    const htmlAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    const configs = [
      { name: '默认', headers: {} },
      {
        name: '带 Referer',
        headers: { Referer: 'https://linux.do/', Accept: htmlAccept, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      },
      {
        name: '模拟导航',
        headers: {
          Accept: htmlAccept, 'Accept-Language': 'zh-CN,zh;q=0.9',
          'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1', 'Upgrade-Insecure-Requests': '1',
        },
      },
    ];

    let lastErr = '未知错误';
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      try {
        const html = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            timeout: 15000,
            headers: cfg.headers,
            onload: (r) => {
              if (r.status >= 200 && r.status < 300) resolve(r.responseText || '');
              else reject(new Error('HTTP ' + r.status + '（' + cfg.name + '）'));
            },
            onerror: () => reject(new Error('请求失败（' + cfg.name + '）')),
            ontimeout: () => reject(new Error('请求超时（' + cfg.name + '）')),
          });
        });
        const items = parseOfficialHtml(html);
        if (items.length) {
          if (i > 0) log('官方升级要求已读取（请求头：' + cfg.name + '）');
          return { ok: true, items: items };
        }
        lastErr = '解析不到要求数据（' + cfg.name + '）';
      } catch (e) {
        lastErr = e.message;
      }
    }
    return { ok: false, error: lastErr };
  }

  /** 抓取用户最近动作，用于统计最近 100 天的回复/点赞 */
  async function fetchUserActions(username, filter, pages) {
    const items = [];
    const n = pages || 2;
    for (let p = 0; p < n; p++) {
      try {
        const data = await apiGet(
          '/user_actions.json?username=' + encodeURIComponent(username) +
          '&filter=' + filter + '&offset=' + p * 30 + '&limit=30'
        );
        const arr = (data && data.user_actions) || [];
        items.push.apply(items, arr);
        if (arr.length < 30) break;
        await sleep(randGap() / 2);
      } catch (e) {
        log('读取用户动作失败(filter=' + filter + ')：' + e.message, 'warn');
        break;
      }
    }
    return items;
  }

  function daysAgo(n) {
    return Date.now() - n * 86400000;
  }

  /**
   * 计算距离 L3 还差什么。
   * 返回 { tl, ageDays, gaps: [{key,label,have,need,done,action}], blocked: [] }
   */
  async function computeProgress() {
    const user = await fetchCurrentUser(true);
    if (!user) {
      return { ok: false, error: '未检测到登录状态，请先登录 linux.do' };
    }

    const username = user.username;
    const tl = typeof user.trust_level === 'number' ? user.trust_level : -1;

    const summary = await fetchSummary(username);
    const s = summary.raw || {};

    // 账号年龄
    let ageDays = null;
    try {
      const u = await apiGet('/u/' + encodeURIComponent(username) + '.json');
      if (u && u.user && u.user.created_at) {
        ageDays = Math.floor((Date.now() - new Date(u.user.created_at).getTime()) / 86400000);
      }
    } catch (e) { /* noop */ }

    // 最近 100 天的回复（filter=5 => replies）
    const replies = await fetchUserActions(username, 5, 3);
    const recentReplies = replies.filter((a) => new Date(a.created_at).getTime() > daysAgo(100));
    const repliedTopicSet = {};
    recentReplies.forEach((a) => {
      if (a.topic_id) repliedTopicSet[a.topic_id] = true;
    });
    const repliedTopicCount = Object.keys(repliedTopicSet).length;

    // 最近 100 天给出的赞（filter=1 => likes given）
    const likes = await fetchUserActions(username, 1, 3);
    const recentLikes = likes.filter((a) => new Date(a.created_at).getTime() > daysAgo(100));
    const likeUserSet = {};
    const likeDaySet = {};
    recentLikes.forEach((a) => {
      const d = todayKey(new Date(a.created_at));
      likeDaySet[d] = true;
      const name = a.username || (a.acting_username || '');
      if (name) likeUserSet[name] = true;
    });

    // 访问天数：优先用站点统计，其次用脚本记录
    const visitedDaysStat = Number(s.days_visited || 0);
    const scriptVisited = state.visitedDays.length;
    const visitedDaysHave = Math.max(visitedDaysStat, scriptVisited);

    const R = TL3_REQUIREMENTS;
    const gaps = [];

    // 1) 访问天数
    const needVisitDays = Math.ceil(R.daysWindow * R.daysVisitedRatio);
    gaps.push({
      key: 'daysVisited',
      label: '访问天数',
      have: visitedDaysHave,
      need: needVisitDays,
      done: visitedDaysHave >= needVisitDays,
      action: 'visit',
      note: '站点统计 ' + visitedDaysStat + ' 天',
    });

    // 2) 回复话题数
    gaps.push({
      key: 'topicsReplied',
      label: '回复话题',
      have: repliedTopicCount,
      need: R.topicsReplied,
      done: repliedTopicCount >= R.topicsReplied,
      action: 'reply',
      note: '需回复不同话题，不能重复',
    });

    // 3) 浏览话题数
    const topicsEntered = Number(s.topics_entered || 0);
    gaps.push({
      key: 'topicsViewed',
      label: '浏览话题',
      have: topicsEntered,
      need: '近100天上限 ' + R.topicsViewedCap,
      done: null,
      action: 'read',
      note: '多浏览即可累积（此处是历史累计值，≠ 近100天口径）',
    });

    // 4) 阅读帖子数
    const postsRead = Number(s.posts_read_count || 0);
    gaps.push({
      key: 'postsRead',
      label: '阅读帖子',
      have: postsRead,
      need: '近100天上限 ' + R.postsReadCap,
      done: null,
      action: 'read',
      note: '补它：设置里调大「每轮浏览话题数」（此处是历史累计值，≠ 近100天口径）',
    });

    // 5) 给出的赞
    const likesGivenHave = Math.max(Number(s.likes_given || 0), recentLikes.length);
    gaps.push({
      key: 'likesGiven',
      label: '给出的赞',
      have: likesGivenHave,
      need: R.likesGiven,
      done: likesGivenHave >= R.likesGiven,
      action: 'like',
      note: '需 ≥' + R.likesGivenMinUsers + ' 个用户、≥' + R.likesGivenMinDays + ' 个日期',
    });

    // 6) 收到的赞
    const likesReceived = Number(s.likes_received || 0);
    gaps.push({
      key: 'likesReceived',
      label: '收到的赞',
      have: likesReceived,
      need: R.likesReceived,
      done: likesReceived >= R.likesReceived,
      action: 'manual',
      note: '只能靠发内容让别人点赞',
    });

    const blocked = [];
    if (ageDays !== null && ageDays < R.minAccountAgeDays) {
      blocked.push('账号注册仅 ' + ageDays + ' 天，L3 要求满 ' + R.minAccountAgeDays + ' 天，只能等。');
    }

    // 官方「升级要求」页能给出真实差额（浏览帖子 10482/20000、获赞 18/20 这类
    // 近 100 天口径都在那里），能读到就优先用它，读不到才退回上面的接口估算值
    const official = await fetchOfficialL3();
    let gapsFinal = gaps;
    if (official.ok) {
      gapsFinal = official.items.map((it) => ({
        key: it.label,
        label: it.label,
        have: it.have,
        need: it.need,
        done: !!it.done,
        action: 'auto',
      }));
    } else {
      log('读不到官方升级要求（' + official.error + '），暂用接口估算值', 'warn');
    }

    const snapshot = {
      at: Date.now(),
      username: username,
      tl: tl,
      ageDays: ageDays,
      visitedDays: visitedDaysHave,
      repliedTopics: repliedTopicCount,
      topicsEntered: topicsEntered,
      postsRead: postsRead,
      likesGiven: likesGivenHave,
      likesReceived: likesReceived,
      likeUsers: Object.keys(likeUserSet).length,
      likeDays: Object.keys(likeDaySet).length,
      gaps: gapsFinal,
      blocked: blocked,
    };
    state.progress = snapshot;
    save('progress');
    return Object.assign({ ok: true }, snapshot);
  }

  /* =========================================================================
   * 4. 动作层：浏览 / 标记已读 / 点赞 / 回复
   * ========================================================================= */

  function markVisitedToday() {
    const k = todayKey();
    if (state.visitedDays.indexOf(k) === -1) {
      state.visitedDays.push(k);
      if (state.visitedDays.length > 400) state.visitedDays = state.visitedDays.slice(-400);
      save('visitedDays');
    }
  }

  function readTopicsToday() {
    const k = todayKey();
    if (!state.readTopics[k]) state.readTopics[k] = [];
    return state.readTopics[k];
  }

  function rememberReadTopic(id) {
    const k = todayKey();
    if (!state.readTopics[k]) state.readTopics[k] = [];
    if (state.readTopics[k].indexOf(id) === -1) state.readTopics[k].push(id);
    // 只保留最近 7 天
    const keys = Object.keys(state.readTopics).sort();
    while (keys.length > 7) {
      delete state.readTopics[keys.shift()];
    }
    save('readTopics');
  }

  async function fetchTopicList(pages) {
    const topics = [];
    const n = pages || 2;
    for (let p = 0; p < n; p++) {
      try {
        const data = await apiGet('/latest.json?order=created&page=' + p);
        const list = (data && data.topic_list && data.topic_list.topics) || [];
        list.forEach((t) => {
          if (t && t.id && !t.pinned) {
            topics.push({ id: t.id, title: t.title, posts_count: t.posts_count });
          }
        });
        if (list.length === 0) break;
      } catch (e) {
        log('获取话题列表失败：' + e.message, 'warn');
        break;
      }
      await sleep(randGap() / 2);
    }
    return topics;
  }

  /**
   * 读取一个话题并上报阅读进度（timings）。
   * track_visit=true 会让服务端记录一次话题浏览。
   */
  async function readTopic(topic) {
    const id = topic.id;
    const data = await apiGet('/t/' + id + '.json?track_visit=true&forceLoad=true&include_raw=false');
    const posts = (data && data.post_stream && data.post_stream.posts) || [];
    if (!posts.length) return { ok: false, posts: 0 };

    // 构造 timings：服务端只认 "timings[楼层号]=毫秒" 这种嵌套键。
    // 写成 "timings=1:ms,2:ms,..." 时服务端只会记下第 1 帖（实测：一次报 60 帖仅记 1 帖）。
    const form = { topic_id: id, topic_time: 0 };
    let totalMs = 0;
    posts.forEach((p) => {
      const ms = contentReadMs(plainLength(p.cooked));
      form['timings[' + p.post_number + ']'] = ms;
      totalMs += ms;
    });
    form.topic_time = totalMs;

    try {
      await apiPost('/topics/timings', form);
    } catch (e) {
      log('上报阅读进度失败 #' + id + '：' + e.message, 'warn');
      return { ok: false, posts: 0 };
    }

    rememberReadTopic(id);
    return { ok: true, posts: posts.length };
  }

  /* ---------- 「专攻阅读帖子」：快速把「浏览帖子」这一项补满 ---------- */

  /** 专攻模式请求间隔（比常规更快，但仍是随机值） */
  function rushGap() {
    const a = num(state.config.postRushGapMsMin, 700);
    const b = Math.max(a, num(state.config.postRushGapMsMax, 1600));
    return a + Math.random() * (b - a);
  }

  /**
   * 挑「帖子最多」的话题：话题帖子越多，一次请求能覆盖的帖号越多。
   * /top.json（常年热帖榜）+ /latest.json（最新帖）合并去重，按"还剩多少帖可上报"排序。
   */
  async function fetchRushTopics() {
    const seen = {};
    const topics = [];
    const push = (list) => {
      (list || []).forEach((t) => {
        if (!t || !t.id || t.pinned || seen[t.id]) return;
        seen[t.id] = true;
        topics.push({ id: t.id, title: t.title, posts_count: Number(t.posts_count) || 0 });
      });
    };
    try {
      const top = await apiGet('/top.json?period=all&page=0');
      push(top && top.topic_list && top.topic_list.topics);
    } catch (e) { /* 拿不到就只用最新列表 */ }
    try {
      const latest = await apiGet('/latest.json?order=created&page=0');
      push(latest && latest.topic_list && latest.topic_list.topics);
    } catch (e) { /* noop */ }

    const remaining = (t) => Math.max(0, t.posts_count - num(state.postRush[t.id], 0));
    topics.sort((a, b) => remaining(b) - remaining(a));
    return topics;
  }

  /** 控制 postRush 记录体积：最多留 800 个话题，超出时先丢已覆盖帖号最少的 */
  function trimPostRush() {
    const keys = Object.keys(state.postRush);
    if (keys.length <= 800) return;
    keys.sort((a, b) => num(state.postRush[a], 0) - num(state.postRush[b], 0));
    keys.slice(0, keys.length - 800).forEach((k) => { delete state.postRush[k]; });
  }

  /**
   * 专攻一轮：对每个话题，把它「还没上报过的帖号」一次性补齐。
   * 常规模式每个请求只能覆盖一个话题首页的 ~20 帖；这里一个请求就能覆盖几十上百帖，
   * 所以补「浏览帖子」快一个数量级。
   */
  async function rushReadPosts(maxTotal) {
    const perTopic = Math.max(1, num(state.config.postRushPerTopic, 200));
    // 预算：维持模式只想补固定帖数，到了就停；不传 / 传 0 表示不限（专攻模式补到差额为零）
    const budget = num(maxTotal, 0) > 0 ? num(maxTotal, 0) : Infinity;
    const topics = await fetchRushTopics();
    if (!topics.length) {
      log('专攻阅读：没取到话题列表，可能被限速或未登录。', 'warn');
      return 0;
    }

    let total = 0;
    let topicsDone = 0;
    for (let i = 0; i < topics.length; i++) {
      if (stopFlag) break;
      if (total >= budget) break;
      // 有会话时按「单轮最长」限时；独立调用（没开会话）不受此限
      if (state.session && !sessionActive()) { log('单轮时间到，专攻阅读自动停止。'); break; }
      const t = topics[i];
      const from = num(state.postRush[t.id], 0);
      const to = Math.min(t.posts_count, from + perTopic, from + (budget - total));
      if (to <= from) continue;

      // 键名必须是 timings[楼层号]，服务端才会逐帖记录（一次 200 帖实测全部生效）
      const form = { topic_id: t.id, topic_time: 0 };
      let totalMs = 0;
      for (let n = from + 1; n <= to; n++) {
        const ms = 900 + Math.floor(Math.random() * 2600);
        form['timings[' + n + ']'] = ms;
        totalMs += ms;
      }
      form.topic_time = totalMs;
      try {
        await apiPost('/topics/timings', form);
      } catch (e) {
        log('专攻阅读：# ' + t.id + ' 上报失败：' + e.message, 'warn');
        await sleep(rushGap());
        continue;
      }

      state.postRush[t.id] = to;
      trimPostRush();
      save('postRush');
      total += to - from;
      topicsDone++;
      log('专攻阅读：# ' + t.id + ' 上报 ' + (to - from) + ' 帖（已覆盖 ' + to + '/' + t.posts_count + '）');
      await sleep(rushGap());
    }
    log('专攻阅读本轮：' + topicsDone + ' 个话题 / 共 ' + total + ' 帖。');
    return total;
  }

  /** 真实浏览模式：滚动当前页模拟阅读，然后跳转到目标话题 */
  function browseTopicInPage(url, waitMs, steps, stepWait) {
    const n = Math.max(1, Number(steps) || 1);
    const gap = Math.max(50, Number(stepWait) || 1200);
    log('真实浏览：即将打开 ' + url);
    let i = 0;
    const timer = setInterval(() => {
      const h = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.floor((h * (i + 1)) / n));
      i++;
      if (i >= n) {
        clearInterval(timer);
        // 跳转会让当前页卸载，之后由新页面的 autoResume 继续
        setTimeout(() => { window.location.href = url; }, Math.max(800, waitMs - n * gap));
      }
    }, gap);
  }

  function likesTodayCount() {
    return state.likeDays[todayKey()] || 0;
  }

  async function likePost(postId, username) {
    if (state.likedPosts.indexOf(postId) !== -1) return false;
    try {
      await apiPost('/post_actions', {
        id: postId,
        post_action_type_id: 2, // 2 = like
        flag_topic: 'false',
      });
      state.likedPosts.push(postId);
      if (state.likedPosts.length > 2000) state.likedPosts = state.likedPosts.slice(-2000);
      const k = todayKey();
      state.likeDays[k] = (state.likeDays[k] || 0) + 1;
      if (username) state.likedUsers[username] = (state.likedUsers[username] || 0) + 1;
      save('likedPosts');
      save('likeDays');
      save('likedUsers');
      return true;
    } catch (e) {
      log('点赞失败 #' + postId + '：' + e.message, 'warn');
      return false;
    }
  }

  /** 从话题列表里挑帖子点赞，控制每日上限与用户分散度 */
  async function autoLikeRound(budget) {
    let done = 0;
    const topics = await fetchTopicList(1);
    for (const t of topics) {
      if (done >= budget || stopFlag) break;
      let data;
      try {
        data = await apiGet('/t/' + t.id + '.json');
      } catch (e) {
        continue;
      }
      const posts = (data && data.post_stream && data.post_stream.posts) || [];
      for (const p of posts) {
        if (done >= budget || stopFlag) break;
        if (!p || !p.id || p.post_number === 1) continue;
        if (state.likedPosts.indexOf(p.id) !== -1) continue;
        const uname = p.username || '';
        // 同一个用户最多点 2 个，保证"不同用户"要求
        if (uname && (state.likedUsers[uname] || 0) >= 2) continue;
        const ok = await likePost(p.id, uname);
        if (ok) {
          done++;
          log('已点赞：' + (uname || '?') + ' 的帖子 #' + p.id);
        }
        await sleep(randGap());
      }
      await sleep(randGap() / 2);
    }
    return done;
  }

  async function replyToTopic(topicId, raw) {
    const now = Date.now();
    const minGap = (Number(state.config.replyIntervalMin) || 45) * 60000;
    if (now - state.lastReplyAt < minGap) {
      const waitMin = Math.ceil((minGap - (now - state.lastReplyAt)) / 60000);
      log('自动回复冷却中，还需 ' + waitMin + ' 分钟', 'warn');
      return false;
    }
    try {
      await apiPost('/posts', {
        topic_id: topicId,
        raw: raw,
        archetype: 'regular',
      });
      state.lastReplyAt = now;
      const k = todayKey();
      state.replyDays[k] = (state.replyDays[k] || 0) + 1;
      if (state.repliedTopics.indexOf(topicId) === -1) state.repliedTopics.push(topicId);
      save('lastReplyAt');
      save('replyDays');
      save('repliedTopics');
      log('已回复话题 #' + topicId);
      return true;
    } catch (e) {
      log('回复失败 #' + topicId + '：' + e.message, 'error');
      return false;
    }
  }

  /* =========================================================================
   * 5. 调度器：缺什么补什么
   * ========================================================================= */

  let running = false;
  let stopFlag = false;
  // 当前正在跑的任务名（显示在状态行），以及"已按停止、正在收尾"的标记
  let currentTask = '';
  let stopping = false;
  // 任何异步动作进行中时为 true：用于把一次性按钮统一置灰，避免"点了没反应"的错觉
  let busyAction = false;
  // 当前被点击的那颗按钮（含它进行中的文案），用于 renderButtons 时保留「…中」提示
  let activeAction = null;

  /** 统一标记"开始跑一个任务"（让状态行/按钮立刻反映出来） */
  function beginTask(label) {
    running = true;
    stopFlag = false;
    stopping = false;
    currentTask = label;
    renderButtons();
  }

  /** 统一标记"任务结束" */
  function finishTask() {
    running = false;
    currentTask = '';
    stopping = false;
    renderButtons();
  }

  /** 一次性动作包装：期间把所有一次性按钮置灰，结束后恢复 */
  function withBusy(fn) {
    busyAction = true;
    renderButtons();
    return Promise.resolve()
      .then(fn)
      .finally(() => { busyAction = false; renderButtons(); });
  }

  function sessionActive() {
    const s = state.session;
    if (!s) return false;
    const maxMs = (Number(state.config.maxSessionMinutes) || 25) * 60000;
    return Date.now() - s.startedAt < maxMs;
  }

  function startSession() {
    state.session = { startedAt: Date.now(), topicsDone: 0, likesDone: 0, repliesDone: 0 };
    save('session');
  }

  function endSession() {
    state.session = null;
    save('session');
  }

  /**
   * 主循环：先看差距，再按缺口执行动作。
   * 顺序：访问打卡 → 回复（最难，优先）→ 点赞 → 阅读/浏览
   */
  async function runOnce() {
    if (running) return;
    beginTask('立即运行一轮');
    if (ui && ui.ready) ui.setBusy(true);

    try {
      if (state.config.autoVisitDaily) markVisitedToday();

      const prog = await computeProgress();
      if (!prog.ok) {
        log(prog.error || '无法获取进度', 'error');
        return;
      }
      log('当前信任等级：TL' + prog.tl + '，开始检查缺口');
      if (ui && ui.ready) ui.renderProgress(prog);

      if (prog.tl >= 3) {
        log('已经是 TL3 了，无需继续刷。', 'info');
        if (typeof GM_notification === 'function') {
          GM_notification({ title: 'Linux.do L3', text: '你已经是 TL3，脚本已停止。' });
        }
        state.config.enabled = false;
        saveConfig();
        return;
      }
      if (prog.blocked && prog.blocked.length) {
        prog.blocked.forEach((b) => log('硬门槛：' + b, 'warn'));
      }

      const gapMap = {};
      (prog.gaps || []).forEach((g) => { gapMap[g.key] = g; });

      if (!sessionActive()) startSession();

      // ---- 1. 回复（缺口最大且最慢，先做） ----
      const replyGap = gapMap.topicsReplied;
      if (replyGap && !replyGap.done) {
        if (!state.config.autoReply) {
          log('还差 ' + (replyGap.need - replyGap.have) + ' 个话题回复；自动回复已关闭，请手动回复或到设置里开启。', 'warn');
        } else if ((state.replyDays[todayKey()] || 0) >= num(state.config.repliesPerDay, 2)) {
          log('今日自动回复已达上限，明天继续。', 'info');
        } else {
          await autoReplyRound();
        }
      }

      // ---- 2. 点赞 ----
      const likeGap = gapMap.likesGiven;
      if (likeGap && !likeGap.done && state.config.autoLike) {
        const remainDay = num(state.config.likesPerDay, 5) - likesTodayCount();
        if (remainDay > 0) {
          const budget = Math.min(remainDay, likeGap.need - likeGap.have);
          if (budget > 0) {
            const n = await autoLikeRound(budget);
            log('本轮点赞 ' + n + ' 个');
          }
        } else {
          log('今日点赞已达上限（' + likesTodayCount() + '），明天继续。', 'info');
        }
      }

      // ---- 3. 阅读 / 浏览 ----
      const needRead =
        (gapMap.postsRead && !gapMap.postsRead.done) ||
        (gapMap.topicsViewed && !gapMap.topicsViewed.done);
      if (needRead && num(state.config.readTopicsPerRun, 12) > 0) {
        if (state.config.mode === 'browse') {
          await browseRound();
        } else {
          await smartReadRound();
        }
      } else if (needRead) {
        log('每轮浏览话题数设为 0，本轮跳过阅读。', 'info');
      } else {
        log('阅读量看起来已达标，跳过阅读。', 'info');
      }

      log('本轮结束。');
    } catch (e) {
      log('运行出错：' + (e && e.message ? e.message : e), 'error');
    } finally {
      if (!state.config.enabled) endSession();
      if (ui && ui.ready) ui.setBusy(false);
      finishTask();
    }
  }

  /**
   * 「立即运行一轮」：跑一轮就停，不改变「自动运行」开关。
   * 阅读循环需要 enabled=true 才会跑，所以这里临时打开、跑完恢复原状。
   */
  function oneShotRun() {
    if (running) { log('正在运行中，先等当前这轮结束。', 'warn'); return; }
    const wasEnabled = state.config.enabled;
    state.config.enabled = true;
    return runOnce().finally(() => {
      if (!wasEnabled) {
        state.config.enabled = false;
        saveConfig();
        endSession();
      }
      renderButtons();
    });
  }

  /** 从进度快照里找「浏览帖子/阅读帖子」这一项（官方页叫「浏览帖子」） */
  function findPostsGap(p) {
    if (!p || !p.gaps) return null;
    return (p.gaps || []).find(
      (g) => g.label === '浏览帖子' || g.label === '阅读帖子' || g.key === 'postsRead'
    ) || null;
  }

  function postsGapLeft(p) {
    const g = findPostsGap(p);
    if (!g) return null;
    if (g.done === true) return 0;
    const have = Number(g.have);
    const need = Number(g.need);
    return Number.isFinite(have) && Number.isFinite(need) ? Math.max(0, need - have) : null;
  }

  /* =========================================================================
   * 3.5 「维持 L3」：达标之后每天要补多少
   *
   * TL3 的所有指标都是「最近 100 天」的滚动窗口：每过一天，窗口后沿就掉出一天
   * 旧记录。所以到 L3 不是终点——每天必须补回等量的新记录，否则指标会一天天
   * 滑回 2 级。每日需求量 ≈ 100 天需求量 ÷ 100 × 安全系数。
   * ========================================================================= */

  /**
   * 算出维持 L3 的每日 / 每周配额。
   * @returns {{posts:number, postsSource:string, topics:number, visits:number,
   *            likesGivenPerWeek:number, repliesPerWeek:number, likesReceivedPerWeek:number}}
   */
  function maintainPlan(p) {
    const factor = Math.max(1, num(state.config.maintainSafetyFactor, 1.2));
    const win = TL3_REQUIREMENTS.daysWindow || 100;

    // 官方页给了逐项 need 时优先用它（那就是 100 天口径的门槛，如「浏览帖子 20000」）
    const gapNeed = (re) => {
      const g = (p && p.gaps ? p.gaps : []).find((x) => re.test(x.label || ''));
      const n = g ? Number(g.need) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const postsNeed = gapNeed(/浏览帖子|阅读帖子/) || TL3_REQUIREMENTS.postsReadCap;
    const topicsNeed = gapNeed(/浏览话题/) || TL3_REQUIREMENTS.topicsViewedCap;

    const manual = num(state.config.maintainPostsPerDay, 0);
    let posts = Math.max(1, Math.ceil((postsNeed / win) * factor));
    let postsSource = '官方需求自动算';
    if (manual > 0) { posts = Math.max(1, manual); postsSource = '手动设定'; }

    return {
      posts: posts,
      postsSource: postsSource,
      topics: Math.max(1, Math.ceil((topicsNeed / win) * factor)),
      visits: 1, // 访问天数 50/100 → 至少隔天一次，实际每天打开最稳妥
      likesGivenPerWeek: Math.max(1, Math.ceil((TL3_REQUIREMENTS.likesGiven / win) * 7 * factor)),
      repliesPerWeek: Math.max(1, Math.ceil((TL3_REQUIREMENTS.topicsReplied / win) * 7 * factor)),
      likesReceivedPerWeek: Math.max(1, Math.ceil((TL3_REQUIREMENTS.likesReceived / win) * 7 * factor)),
    };
  }

  /** 维持配额的一句话摘要（写日志用） */
  function maintainText(p) {
    const m = maintainPlan(p);
    return '维持 L3：每天 ' + m.posts + ' 帖（' + m.postsSource + '） · ' + m.topics +
      ' 话题 · 登录 ' + m.visits + ' 次；每周约 ' + m.likesGivenPerWeek + ' 赞 / ' +
      m.repliesPerWeek + ' 回复，获赞 ' + m.likesReceivedPerWeek + ' 个（只能靠别人点）';
  }

  /** 记录今天已经补了多少维持帖（同一天重复跑时只补差额，只保留最近 200 天） */
  function markMaintained(posts) {
    const k = todayKey();
    state.maintainDays[k] = Math.max(num(state.maintainDays[k], 0), Math.max(0, num(posts, 0)));
    const keys = Object.keys(state.maintainDays);
    if (keys.length > 200) {
      keys.sort();
      keys.slice(0, keys.length - 200).forEach((x) => { delete state.maintainDays[x]; });
    }
    save('maintainDays');
  }

  /** 今天还差多少维持帖没补 */
  function maintainLeftToday(p) {
    const m = maintainPlan(p);
    const doneToday = num(state.maintainDays[todayKey()], 0);
    return Math.max(0, m.posts - doneToday);
  }

  /**
   * 维持一轮：只补「今天还差的维持帖数」，补完记住今天已补的量。
   * @param {object} [prog] 已有的进度快照，避免重复读一次进度
   */
  async function maintainRound(prog) {
    if (running) { log('正在运行中，先等当前这轮结束。', 'warn'); return 0; }
    beginTask('维持 L3');
    if (ui && ui.ready) ui.setBusy(true);

    try {
      let p = prog && prog.ok ? prog : await computeProgress();
      const doneToday = num(state.maintainDays[todayKey()], 0);
      const want = maintainLeftToday(p);
      log(maintainText(p) + '；今天已维持 ' + doneToday + ' 帖，本轮补 ' + want + ' 帖。');
      if (want <= 0) { log('今天已经补够维持量了，无需再跑。'); return 0; }

      const n = await rushReadPosts(want);
      if (n > 0) markMaintained(doneToday + n);
      log('维持本轮共补 ' + n + ' 帖。');

      p = await computeProgress();
      if (p.ok && ui && ui.ready) ui.renderProgress(p);
      return n;
    } catch (e) {
      log('维持出错：' + (e && e.message ? e.message : e), 'error');
      return 0;
    } finally {
      if (ui && ui.ready) ui.setBusy(false);
      finishTask();
    }
  }

  /** 已达标且今天没维持过时，自动跑一轮维持（受 autoMaintainDaily 开关控制） */
  function maybeAutoMaintain(p) {
    if (!state.config.autoMaintainDaily) return;
    if (!p || !p.ok) return;
    // 未达标就先走正常的补差流程；有硬门槛阻塞时维持也没意义
    const reached = num(p.tl, 0) >= 3 || (p.gaps || []).every((g) => g.done === true);
    if (!reached) return;
    if ((p.blocked || []).length) return;
    if (maintainLeftToday(p) <= 0) return;
    maintainRound(p);
  }

  /**
   * 「专攻阅读帖子」按钮：反复跑 rushReadPosts，直到时间到 / 手动停止 /
   * 官方口径的「浏览帖子」差额补齐。它不改动「开启自动」开关，是一次性专项任务。
   */
  async function rushReadSession() {
    if (running) { log('正在运行中，先等当前这轮结束。', 'warn'); return; }
    beginTask('专攻阅读帖子');
    if (ui && ui.ready) ui.setBusy(true);
    if (!sessionActive()) startSession();

    try {
      let p = await computeProgress();
      if (p.ok && ui && ui.ready) ui.renderProgress(p);
      let left = postsGapLeft(p);
      log('专攻阅读开始：官方口径「浏览帖子」还差 ' + (left === null ? '（读不到，按需继续）' : left) + ' 帖');

      while (!stopFlag && sessionActive()) {
        const n = await rushReadPosts();
        if (n <= 0) { log('专攻阅读：已经找不到还能补的帖子了，先停。', 'warn'); break; }
        p = await computeProgress();
        if (p.ok && ui && ui.ready) ui.renderProgress(p);
        left = postsGapLeft(p);
        if (left === 0) { log('「浏览帖子」已达标，专攻阅读结束。'); break; }
        if (left !== null) log('专攻阅读：官方口径「浏览帖子」还差 ' + left + ' 帖');
      }
      if (stopFlag) log('专攻阅读已手动停止。');
    } catch (e) {
      log('专攻阅读出错：' + (e && e.message ? e.message : e), 'error');
    } finally {
      endSession();
      if (ui && ui.ready) ui.setBusy(false);
      finishTask();
    }
  }

  /** 智能浏览：接口级读取 + 上报 timings，不跳页 */
  async function smartReadRound() {
    const max = num(state.config.readTopicsPerRun, 12);
    if (max <= 0) return;
    const topics = await fetchTopicList(2);
    if (!topics.length) {
      log('没取到话题列表，可能被限速或未登录。', 'warn');
      return;
    }
    const doneToday = readTopicsToday();
    let n = 0;
    for (const t of topics) {
      if (stopFlag || !state.config.enabled) break;
      if (!sessionActive()) { log('单次运行时间到，自动停止。'); break; }
      if (doneToday.indexOf(t.id) !== -1) continue;
      if (n >= max) break;
      try {
        const r = await readTopic(t);
        if (r.ok) {
          n++;
          if (state.session) { state.session.topicsDone++; save('session'); }
          log('已读话题 #' + t.id + '（' + r.posts + ' 帖）' + (t.title ? ' · ' + String(t.title).slice(0, 30) : ''));
        }
      } catch (e) {
        log('读取话题 #' + t.id + ' 失败：' + e.message, 'warn');
      }
      await sleep(randGap());
    }
    log('本轮共阅读 ' + n + ' 个话题。');
  }

  /** 真实浏览：跳转到话题页并滚动，模拟真人 */
  async function browseRound() {
    const max = num(state.config.readTopicsPerRun, 12);
    if (max <= 0) return;
    let queue = state.queue.slice();
    if (queue.length < max) {
      const topics = await fetchTopicList(2);
      const doneToday = readTopicsToday();
      const fresh = topics.filter(
        (t) => doneToday.indexOf(t.id) === -1 && !queue.some((q) => q.id === t.id)
      );
      // 追加而不是覆盖，避免把排队中还没读的话题丢掉
      queue = queue.concat(fresh);
      state.queue = queue;
      save('queue');
    }
    if (!queue.length) {
      log('浏览队列为空。', 'warn');
      return;
    }
    const t = queue.shift();
    state.queue = queue;
    save('queue');
    const url = 'https://linux.do/t/' + t.id;
    log('真实浏览模式：打开话题 #' + t.id + '，剩余队列 ' + queue.length);
    browseTopicInPage(
      url,
      Number(state.config.browseTopicWaitMs) || 9000,
      Number(state.config.browseScrollSteps) || 14,
      Number(state.config.browseScrollWaitMs) || 1200
    );
  }

  async function autoReplyRound() {
    const topics = await fetchTopicList(1);
    for (const t of topics) {
      if (stopFlag) return;
      if (state.repliedTopics.indexOf(t.id) !== -1) continue;
      const templates = state.config.replyTemplates || DEFAULTS.replyTemplates;
      const raw = templates[Math.floor(Math.random() * templates.length)];
      const ok = await replyToTopic(t.id, raw);
      if (ok) break;
      await sleep(randGap());
    }
  }

  /* =========================================================================
   * 6. 真实浏览模式的自动续跑
   * ========================================================================= */

  async function autoResume() {
    if (!state.config.enabled) return;
    if (state.config.mode !== 'browse') return;

    const m = window.location.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)/);
    if (m) {
      // 当前就在话题页：滚动 + 上报已读，然后跳下一个
      const id = Number(m[1]);
      log('真实浏览：正在阅读话题 #' + id);
      const steps = Number(state.config.browseScrollSteps) || 14;
      const stepWait = Number(state.config.browseScrollWaitMs) || 1200;
      for (let i = 0; i < steps; i++) {
        if (!state.config.enabled) return;
        const h = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.floor((h * (i + 1)) / steps));
        await sleep(stepWait);
      }
      try {
        await readTopic({ id: id });
        if (state.session) { state.session.topicsDone++; save('session'); }
        log('已读话题 #' + id);
      } catch (e) {
        log('上报失败：' + e.message, 'warn');
      }
      await sleep(1500);
      if (!state.config.enabled) return;
      await browseRound();
    } else {
      await browseRound();
    }
  }

  /* =========================================================================
   * 7. UI 面板
   * ========================================================================= */

  const ui = { ready: false, root: null, busy: false, bubble: null };

  const CSS = [
    '.ld3-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:330px;',
    'display:flex;flex-direction:column;max-height:calc(100vh - 32px);',
    'font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
    'background:#1e1f26;color:#e8e8ef;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.45);',
    'overflow:hidden;border:1px solid #33353f}',
    '.ld3-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#262833;cursor:move}',
    '.ld3-head b{flex:1;font-size:13px}',
    '.ld3-dot{width:9px;height:9px;border-radius:50%;background:#666}',
    '.ld3-dot.on{background:#3ddc84;box-shadow:0 0 8px #3ddc84}',
    '.ld3-dot.busy{background:#ffb020;box-shadow:0 0 8px #ffb020}',
    '.ld3-body{flex:1 1 auto;min-height:0;padding:10px 12px;overflow:auto}',
    '.ld3-row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px dashed #33353f}',
    '.ld3-row span:last-child{color:#9aa0b4;text-align:right}',
    '.ld3-ok{color:#3ddc84!important}.ld3-bad{color:#ff6b6b!important}',
    '.ld3-btns{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;background:#232530}',
    '.ld3-btns button{flex:1 1 46%;padding:7px 8px;border:0;border-radius:7px;background:#3a3d4d;color:#e8e8ef;',
    'cursor:pointer;font-size:12px}',
    '.ld3-btns button:hover{background:#4a4e63}',
    '.ld3-btns button.primary{background:#2f6fed}.ld3-btns button.primary:hover{background:#3d7cf5}',
    '.ld3-btns button.wide{flex:1 1 100%}',
    '.ld3-btns button.danger{background:#b33b3b}',
    '.ld3-btns button:disabled{opacity:.4;cursor:not-allowed}',
    '.ld3-run-state{flex:1 1 100%;display:flex;align-items:center;gap:6px;padding:2px 2px 4px;font-size:12px;color:#9aa0b4}',
    '.ld3-run-state.running{color:#ffb020}',
    '.ld3-run-state.stopping{color:#ff6b6b}',
    '.ld3-log{flex:0 0 auto;margin-top:8px;max-height:150px;overflow:auto;background:#16171c;border-radius:8px;padding:6px 8px;',
    'font:11px/1.5 ui-monospace,Consolas,monospace;color:#9aa0b4;white-space:pre-wrap;word-break:break-all}',
    '.ld3-cfg{flex:0 0 auto;max-height:42vh;overflow:auto;padding:8px 12px;background:#1a1b21;border-top:1px solid #33353f;display:none}',
    '.ld3-cfg.show{display:block}',
    '.ld3-cfg label{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0;font-size:12px}',
    '.ld3-cfg input[type=number],.ld3-cfg select{width:96px;background:#2a2c37;color:#e8e8ef;border:1px solid #3a3d4d;',
    'border-radius:5px;padding:3px 6px}',
    '.ld3-cfg input[type=checkbox]{width:16px;height:16px}',
    // 收起时右下角的小图标：整颗圆球就是按钮，颜色顺便反映状态
    '.ld3-mini{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:40px;height:40px;border-radius:50%;',
    'display:flex;align-items:center;justify-content:center;background:#2f6fed;color:#fff;cursor:pointer;',
    'font:600 12px/1 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.4);',
    'user-select:none;transition:transform .12s ease,background .2s ease}',
    '.ld3-mini:hover{transform:scale(1.08)}',
    '.ld3-mini.on{background:#22a06b}',
    '.ld3-mini.running{background:#ffb020}',
  ].join('');

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buildUI() {
    if (ui.ready) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = el('div', 'ld3-panel');
    const head = el('div', 'ld3-head');
    const dot = el('div', 'ld3-dot');
    const title = el('b', null, 'Linux.do L3 助手');
    const min = el('div', null, '—');
    min.style.cursor = 'pointer';
    min.title = '最小化';
    min.onclick = () => collapsePanel();
    // 点「—」时不要触发标题栏的拖拽
    min.addEventListener('mousedown', (e) => e.stopPropagation());
    head.appendChild(dot); head.appendChild(title); head.appendChild(min);

    const body = el('div', 'ld3-body');
    const summary = el('div', null, '正在读取进度…');
    body.appendChild(summary);

    const logBox = el('div', 'ld3-log');

    const cfg = el('div', 'ld3-cfg');
    const btns = el('div', 'ld3-btns');

    root.appendChild(head);
    root.appendChild(body);
    root.appendChild(logBox);
    root.appendChild(cfg);
    root.appendChild(btns);
    document.body.appendChild(root);

    ui.root = root;
    ui.dot = dot;
    ui.summary = summary;
    ui.logBox = logBox;
    ui.cfg = cfg;
    ui.ready = true;

    // 默认收起：每页只在右下角留个小图标，不自动弹出整个面板
    if (state.config.panelCollapsed) collapsePanel(false);

    // ---- 按钮 ----
    // 设计原则：任何点击都要"立刻有反应"，并且按钮本身要能看出当前能不能点。
    //  - 顶部有一行状态（空闲 / 运行中 / 正在停止），运行中把一次性按钮全部置灰；
    //  - 「停止」只在真的有任务在跑时才可点，空闲时是灰的（避免"点了没反应"）；
    //  - 每个动作点击后立刻换文案 + 写日志，不等 await 的结果。
    const runState = el('div', 'ld3-run-state', '● 空闲');
    btns.appendChild(runState);

    const slowClick = (btn, busyText, fn) => {
      btn.onclick = async () => {
        if (btn.disabled) return;
        // 记录是哪颗按钮在忙：renderButtons 会为它保留「…中」文案，其余按钮显示默认文案
        activeAction = { btn: btn, label: busyText };
        btn.textContent = busyText;
        log(busyText);
        try {
          await withBusy(fn);
        } catch (e) {
          log('操作失败：' + (e && e.message ? e.message : e), 'error');
        } finally {
          activeAction = null;
          renderButtons();
        }
      };
    };

    // 一次性：跑一轮就停，不改变「自动运行」开关
    const bRun = el('button', 'primary', '立即运行一轮');
    slowClick(bRun, '运行中…', () => oneShotRun());

    // 专攻「浏览帖子」：一次请求就能覆盖一个话题里几十上百帖，专门追这一项
    const bRush = el('button', 'primary wide', '专攻阅读帖子');
    slowClick(bRush, '专攻中…', () => rushReadSession());

    // 维持 L3：补今天滚动窗口掉出的量（达标后才有意义）
    const bMaintain = el('button', 'wide', '维持 L3');
    slowClick(bMaintain, '维持中…', () => maintainRound());

    // 自动运行开关（页面打开时自动跑 + 每 10 分钟检查一次）
    const bToggle = el('button', null, '');
    bToggle.onclick = () => {
      state.config.enabled = !state.config.enabled;
      saveConfig();
      log(state.config.enabled ? '已开启自动运行（页面打开时自动跑）' : '已暂停自动运行');
      renderButtons();
      if (state.config.enabled && !running) runOnce();
    };

    // 刷新进度
    const bRefresh = el('button', null, '刷新进度');
    slowClick(bRefresh, '读取中…', async () => {
      const p = await computeProgress();
      if (!p.ok) { log(p.error, 'error'); return; }
      ui.renderProgress(p);
      // 带上结果，否则数字没变时看起来跟没点一样
      const left = postsGapLeft(p);
      log(left === null ? '进度已刷新' : '进度已刷新：浏览帖子还差 ' + left + ' 帖');
    });

    const bCfg = el('button', null, '设置');
    bCfg.onclick = () => { cfg.classList.toggle('show'); clampPanel(); };

    // 停止：只在有任务运行时才能点；点下去立刻变成「正在停止…」。单独占一行，跑起来时最显眼
    const bStop = el('button', 'danger wide', '■ 停止');
    bStop.onclick = () => {
      if (!running) return;
      stopFlag = true;
      stopping = true;
      state.config.enabled = false;
      saveConfig();
      log('正在停止…（当前这一步跑完就停）');
      renderButtons();
    };

    // 排布：两个"即时动作"并排 → 两个"专项长任务"各占一行 → 两个开关并排 → 停止单独一行
    btns.appendChild(bRun);
    btns.appendChild(bRefresh);
    btns.appendChild(bRush);
    btns.appendChild(bMaintain);
    btns.appendChild(bToggle);
    btns.appendChild(bCfg);
    btns.appendChild(bStop);

    ui.status = runState;
    ui.bRun = bRun;
    ui.bToggle = bToggle;
    ui.bRush = bRush;
    ui.bMaintain = bMaintain;
    ui.bStop = bStop;
    ui.bRefresh = bRefresh;
    ui.bCfg = bCfg;
    renderButtons();
    buildConfig(cfg);
    renderLog();
    makeDraggable(root, head);
    window.addEventListener('resize', clampPanel);
  }

  function renderButtons() {
    if (!ui.bToggle) return;
    const isRunning = running;
    const busy = running || busyAction;

    // --- 状态行：一眼看清当前状态 ---
    if (ui.status) {
      let txt;
      let cls = 'ld3-run-state';
      if (isRunning && stopping) { txt = '● 正在停止…'; cls += ' stopping'; }
      else if (isRunning) { txt = '● 运行中：' + (currentTask || '任务'); cls += ' running'; }
      else if (busyAction) { txt = '● 处理中：' + ((activeAction && activeAction.label) || '请稍候…'); cls += ' running'; }
      else { txt = '● 空闲' + (state.config.enabled ? '（自动运行已开启）' : ''); }
      ui.status.textContent = txt;
      ui.status.className = cls;
    }

    // --- 自动运行开关 ---
    ui.bToggle.textContent = state.config.enabled ? '自动运行：已开启' : '自动运行：已暂停';
    ui.bToggle.className = state.config.enabled ? 'primary' : '';
    ui.bToggle.disabled = busy;

    // --- 一次性任务按钮：有任务在跑时统一置灰，避免"点了没反应"的错觉 ---
    // 先恢复默认文案，稍后再把"正在忙的那颗"换成「…中」，避免按钮一直卡在「读取中…」
    if (ui.bRun) { ui.bRun.textContent = '立即运行一轮'; ui.bRun.disabled = busy; }
    if (ui.bRefresh) { ui.bRefresh.textContent = '刷新进度'; ui.bRefresh.disabled = busy; }
    if (ui.bRush) {
      const left = postsGapLeft(state.progress);
      ui.bRush.textContent = left !== null && left > 0
        ? '专攻阅读帖子 · 还差 ' + left
        : '专攻阅读帖子';
      ui.bRush.disabled = busy;
    }
    if (ui.bMaintain) {
      const left = maintainLeftToday(state.progress);
      ui.bMaintain.textContent = state.progress && left <= 0
        ? '维持 L3 · 今天已补够'
        : '维持 L3 · 今天还差 ' + left + ' 帖';
      ui.bMaintain.disabled = busy || (!!state.progress && left <= 0);
    }

    // --- 停止：只在真有任务在跑时可点，空闲时是灰的 ---
    if (ui.bStop) {
      ui.bStop.disabled = !isRunning;
      ui.bStop.textContent = isRunning && stopping ? '正在停止…' : '■ 停止';
    }

    // 正在忙的那颗按钮保留「…中」文案（其余按钮已在上方恢复默认文案）
    if (activeAction && activeAction.btn) activeAction.btn.textContent = activeAction.label;

    if (ui.dot) {
      ui.dot.className = 'ld3-dot' + (ui.busy ? ' busy' : state.config.enabled ? ' on' : '');
    }

    // 收起状态下的小图标也跟着变颜色/提示
    updateMini();
  }

  function buildConfig(cfg) {
    const fields = [
      ['mode', '运行模式', 'select', [['smart', '智能浏览(推荐)'], ['browse', '真实浏览(跳页)']]],
      ['autoVisitDaily', '每日自动访问', 'checkbox'],
      ['autoLike', '自动点赞', 'checkbox'],
      ['autoReply', '自动回复(有风险)', 'checkbox'],
      ['readTopicsPerRun', '每轮浏览话题数', 'number', null, '想补「阅读帖子数」就把这里调大（如 30），并保持自动运行'],
      ['postRushPerTopic', '专攻每话题最多帖数', 'number', null, '「专攻阅读帖子」按钮：每个话题一次最多上报多少帖'],
      ['postRushGapMsMin', '专攻间隔下限(ms)', 'number'],
      ['postRushGapMsMax', '专攻间隔上限(ms)', 'number'],
      ['autoMaintainDaily', '达标后每日维持', 'checkbox', null, '到 L3 后每天自动补一次滚动窗口掉出的量，防止滑回 2 级'],
      ['maintainPostsPerDay', '维持每日帖数(0=自动)', 'number', null, '0 = 按官方需求自动算（约 240 帖/天）'],
      ['maintainSafetyFactor', '维持安全系数', 'number', null, '每日配额 = 官方需求 ÷ 100 × 本值'],
      ['likesPerDay', '每日点赞上限', 'number'],
      ['repliesPerDay', '每日回复上限', 'number'],
      ['replyIntervalMin', '回复最小间隔(分钟)', 'number'],
      ['gapMsMin', '请求间隔下限(ms)', 'number'],
      ['gapMsMax', '请求间隔上限(ms)', 'number'],
      ['maxSessionMinutes', '单轮最长(分钟)', 'number'],
    ];
    fields.forEach((f) => {
      const [key, label, type, opts, hint] = f;
      const row = el('label');
      if (hint) row.title = hint;
      row.appendChild(el('span', null, label));
      let input;
      if (type === 'select') {
        input = document.createElement('select');
        opts.forEach((o) => {
          const op = document.createElement('option');
          op.value = o[0]; op.textContent = o[1];
          input.appendChild(op);
        });
        input.value = state.config[key];
        input.onchange = () => { state.config[key] = input.value; saveConfig(); };
      } else if (type === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!state.config[key];
        input.onchange = () => { state.config[key] = input.checked; saveConfig(); };
      } else {
        input = document.createElement('input');
        input.type = 'number';
        input.value = state.config[key];
        input.onchange = () => {
          state.config[key] = Number(input.value) || DEFAULTS[key];
          saveConfig();
        };
      }
      if (hint) input.title = hint;
      row.appendChild(input);
      cfg.appendChild(row);
    });

    const reset = el('button', null, '恢复默认设置');
    reset.style.marginTop = '6px';
    reset.onclick = () => {
      state.config = Object.assign({}, DEFAULTS);
      // 保留"当前面板是开着的"这个事实，免得点了恢复默认面板自己就收起来了
      state.config.panelCollapsed = false;
      saveConfig();
      // 重建输入控件，让界面立刻显示默认值（否则字段还停留在旧值，看起来没生效）
      while (cfg.firstChild) cfg.removeChild(cfg.firstChild);
      buildConfig(cfg);
      log('已恢复默认设置');
    };
    cfg.appendChild(reset);
  }

  function renderLog() {
    if (!ui.logBox) return;
    const last = state.log.slice(-40).map((l) => l.msg).join('\n');
    ui.logBox.textContent = last;
    ui.logBox.scrollTop = ui.logBox.scrollHeight;
  }

  ui.renderLog = renderLog;

  ui.setBusy = function (b) {
    ui.busy = b;
    renderButtons();
  };

  ui.renderProgress = function (p) {
    if (!ui.summary) return;
    // 用 DOM 逐个创建，避免 innerHTML 注入（用户名/标题都可能含特殊字符）
    while (ui.summary.firstChild) ui.summary.removeChild(ui.summary.firstChild);

    const cls = (done) => (done === true ? 'ld3-ok' : done === false ? 'ld3-bad' : '');
    const addRow = (label, value, clsName, title) => {
      const row = el('div', 'ld3-row');
      if (title) row.title = title;
      row.appendChild(el('span', null, label));
      row.appendChild(el('span', clsName || null, value));
      ui.summary.appendChild(row);
    };

    // 只展示「还差什么」：已达标项不再罗列，避免面板变成一大堆冗余信息
    const unmet = (p.gaps || []).filter((g) => g.done !== true);
    if (unmet.length) {
      unmet.forEach((g) => {
        // 只显示"还差多少"，不显示任何累计值
        const have = Number(g.have);
        const need = Number(g.need);
        const val = Number.isFinite(have) && Number.isFinite(need)
          ? '还差 ' + Math.max(0, need - have)
          : '还需累积';
        addRow(g.label, val, cls(g.done), g.note);
      });
    } else if (!p.blocked || !p.blocked.length) {
      addRow('L3 要求', '已全部满足', 'ld3-ok');
      // 达标后还要维持：TL3 按最近 100 天滚动计算，每天会掉出一天旧记录
      const m = maintainPlan(p);
      addRow(
        '维持·每天',
        m.posts + ' 帖 · ' + m.topics + ' 话题 · 登录 ' + m.visits + ' 次',
        null,
        'TL3 按最近 100 天滚动计算，每天窗口后沿会掉出一天旧记录，需按此量补回（' + m.postsSource + '）'
      );
      addRow(
        '维持·每周',
        m.likesGivenPerWeek + ' 赞 · ' + m.repliesPerWeek + ' 回复 · 获赞 ' + m.likesReceivedPerWeek + ' 个（只能靠别人点）',
        null,
        '赞 / 回复的需求同样按 100 天滚动折算到每周'
      );
    }
    if (p.blocked && p.blocked.length) {
      addRow('硬门槛', p.blocked.join('；'), 'ld3-bad');
    }
    // 快照变了，按钮上的「还差 N」也要跟着更新
    renderButtons();
  };

  /**
   * 把面板整体钳制在视口内：拖动/展开设置/窗口缩放后调用。
   * 面板本身有 max-height:calc(100vh-32px)，只要把左上角拉回可视范围，
   * 底部的按钮（如「停止」）就始终可达，不会再出现"拖到顶部就缩不回去"。
   */
  function clampPanel() {
    const node = ui.root;
    if (!node || node.style.display === 'none') return;
    const margin = 8;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!vw || !vh) return;

    const r = node.getBoundingClientRect();
    const w = r.width || node.offsetWidth || 330;
    const h = r.height || node.offsetHeight || 0;
    let left = r.left;
    let top = r.top;
    if (left < margin) left = margin;
    if (left > vw - w - margin) left = Math.max(margin, vw - w - margin);
    if (top < margin) top = margin;
    if (top > vh - h - margin) top = Math.max(margin, vh - h - margin);

    node.style.right = 'auto';
    node.style.bottom = 'auto';
    node.style.left = Math.round(left) + 'px';
    node.style.top = Math.round(top) + 'px';
  }

  /**
   * 收起面板，只在右下角留一个小圆球图标。
   * persist=false 用于启动时按已保存的偏好还原状态（不必再写一次配置）。
   */
  function collapsePanel(persist) {
    if (!ui.root) return;
    if (persist !== false) { state.config.panelCollapsed = true; saveConfig(); }
    ui.root.style.display = 'none';
    if (!ui.bubble) {
      const bubble = el('div', 'ld3-mini', 'L3');
      bubble.onclick = () => expandPanel();
      document.body.appendChild(bubble);
      ui.bubble = bubble;
    }
    updateMini();
  }

  /** 展开面板：去掉小图标，重新钳制位置，保证标题栏和按钮都在可视范围内 */
  function expandPanel() {
    state.config.panelCollapsed = false;
    saveConfig();
    if (ui.bubble) { ui.bubble.remove(); ui.bubble = null; }
    if (ui.root) { ui.root.style.display = ''; clampPanel(); }
  }

  /** 小图标的颜色/提示跟随运行状态，收起来也能一眼看出在忙还是在跑 */
  function updateMini() {
    if (!ui.bubble) return;
    const busy = running || busyAction;
    let tip = 'L3 助手 · 点击展开面板';
    if (busy) tip = 'L3 助手 · ' + (stopping ? '正在停止…' : (currentTask || '处理中')) + '（点击展开）';
    else if (state.config.enabled) tip = 'L3 助手 · 自动运行已开启（点击展开）';
    ui.bubble.className = 'ld3-mini' + (busy ? ' running' : state.config.enabled ? ' on' : '');
    ui.bubble.title = tip;
  }

  function makeDraggable(node, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = node.getBoundingClientRect();
      ox = r.left; oy = r.top;
      node.style.right = 'auto'; node.style.bottom = 'auto';
      node.style.left = ox + 'px'; node.style.top = oy + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      node.style.left = ox + (e.clientX - sx) + 'px';
      node.style.top = oy + (e.clientY - sy) + 'px';
      clampPanel();
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      clampPanel();
    });
  }

  /* =========================================================================
   * 8. 入口
   * ========================================================================= */

  async function boot() {
    buildUI();
    log('脚本已加载 ' + VERSION);

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('立即运行一轮', () => { oneShotRun(); });
      GM_registerMenuCommand('专攻阅读帖子（快速补「浏览帖子」）', () => { rushReadSession(); });
      GM_registerMenuCommand('维持 L3（补今天的量）', () => { maintainRound(); });
      GM_registerMenuCommand('刷新 L3 进度', async () => {
        const p = await computeProgress();
        if (p.ok) ui.renderProgress(p);
      });
      // 与面板「停止」同一套语义：先让正在跑的任务停下来，同时关掉自动运行
      GM_registerMenuCommand('停止运行', () => {
        if (!running) { log('当前没有正在跑的任务。', 'info'); return; }
        stopFlag = true;
        stopping = true;
        state.config.enabled = false;
        saveConfig();
        log('正在停止…（当前这一步跑完就停）');
        renderButtons();
      });
    }

    // 每日自动访问：页面打开即打卡
    if (state.config.autoVisitDaily) markVisitedToday();

    // 首屏拉一次进度（延迟，避免影响页面加载）
    setTimeout(async () => {
      const p = await computeProgress();
      if (p.ok) ui.renderProgress(p);
      else log(p.error, 'error');
      // 已达标且今天还没维持过时，自动补一次（受 autoMaintainDaily 控制）
      maybeAutoMaintain(p);
    }, 2500);

    // 真实浏览模式：自动续跑
    if (state.config.enabled && state.config.mode === 'browse') {
      setTimeout(autoResume, 3000);
    }

    // 自动运行：页面打开后延迟启动，并周期性检查
    if (state.config.enabled) {
      setTimeout(() => { if (state.config.enabled) runOnce(); }, 6000);
      setInterval(() => {
        if (!state.config.enabled) return;
        if (running) return;
        if (!sessionActive()) { endSession(); }
        runOnce();
      }, 10 * 60 * 1000);
    }

    // 跨天打卡 + 维持检查（本地已补够就不读进度，省一次 10 秒的请求）
    setInterval(async () => {
      if (state.config.autoVisitDaily) markVisitedToday();
      if (!state.config.autoMaintainDaily) return;
      if (maintainLeftToday(state.progress) <= 0) return;
      const p = await computeProgress();
      if (p.ok) ui.renderProgress(p);
      maybeAutoMaintain(p);
    }, 30 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 调试用
  window.__LD3__ = {
    state: state,
    runOnce: runOnce,
    computeProgress: computeProgress,
    readTopic: readTopic,
    rushReadPosts: rushReadPosts,
    rushReadSession: rushReadSession,
    maintainPlan: maintainPlan,
    maintainRound: maintainRound,
    autoLikeRound: autoLikeRound,
    reset: () => {
      ['log', 'visitedDays', 'readTopics', 'likedPosts', 'likeDays', 'likedUsers',
        'replyDays', 'repliedTopics', 'queue', 'session', 'progress', 'postRush', 'maintainDays'].forEach((k) => {
        state[k] = k === 'log' ? [] : (k === 'readTopics' || k === 'likeDays' || k === 'likedUsers' || k === 'replyDays' || k === 'postRush' || k === 'maintainDays') ? {} : [];
        save(k);
      });
      log('已清空本地记录');
    },
  };
})();
