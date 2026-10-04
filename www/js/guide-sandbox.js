/* ============================================================
   《白日梦》新手引导 —— 沙盒脚本（20261002cn 重构版）
   严格沙盒隔离：
     · 不修改任何核心代码（聊天/字卡/API/IndexedDB/路由零触碰）；
     · 不修改 index.html 的 DOM 结构——本脚本动态创建一个全屏 overlay
       浮在页面最上方，结束时从 DOM 彻底移除；
     · 所有代码独立在本文件 + guide-sandbox.css 内，类名统一 bm-guide- 前缀；
     · 一键卸载：localStorage['bm_guide_done'] 记录，点「开始探索」或
       「跳过新手指引」后彻底移除 overlay 且永不再弹。

   cn 版重构（应用户要求删除卡片式引导）：
     · 删除第一段「初识卡片」，只保留聚光灯功能导览——逐步框选主页上的
       真实按钮（记忆宫殿 / 世界树 / 字卡库 / 织梦点 / API 接入），AI/字卡
       开关无实体按钮，用居中气泡示意图说明；
     · 触发新增「软件声明流程已结束」硬门槛（window.__bmNoticeGateDone）：
       真机上 init 慢、声明弹出晚于开屏结束时，旧版会在窗口期抢跑挂载、
       盖住声明——现在声明未同意/未关闭前引导绝不挂载；
     · 删除 armPolling 的「1 分钟兜底无条件强弹」——它会在弹窗未关时硬弹、
       与重新排队叠加导致引导重复弹出、状态错乱卡死；
     · spot 目标按钮缺失/不可见时改为居中示意展示，不再自动连跳步
       （旧版 60ms 一步狂跳，引导瞬间闪完）；
     · mounted 防重入 + 统一 teardown（轮询/观察/校正计时器全收口），
       修复多实例叠加导致的卡死。
   ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'bm_guide_done';
  var STYLE_HREF = 'css/guide-sandbox.css';

  /* 内联图标（复用软件线性图标路径，独立内嵌，不依赖 icons.js，保证沙盒自包含） */
  var IC = {
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" stroke-width="1.4"/>',
    memory: '<path d="M4 21V9l8-6 8 6v12"/><path d="M2 21h20"/><path d="M9 21v-6h6v6"/><path d="M12 2.5V4"/>',
    tree: '<path d="M12 22v-8"/><path d="M12 13.5c-.2-1.8-1.1-3.1-2.6-4"/><path d="M12 10c.2-1.5 1-2.7 2.3-3.6"/><path d="M12 14c-3.9 0-7-2.3-7-5.7 0-2.9 1.9-4.8 4.4-4.9 1-1.6 4.2-1.6 5.2 0C17.1 3.5 19 5.4 19 8.3c0 3.4-3.1 5.7-7 5.7z"/>',
    cards: '<rect x="7" y="3" width="13" height="15" rx="2.5"/><path d="M4 7v11a3 3 0 0 0 3 3h9"/><path d="M11 8h5M11 12h5"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="9.5" r="1" fill="currentColor" stroke="none"/><path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.4 1.1-2 2.5-2s2-.6 2-1.5 1-1.5 2.5-1.5"/>',
    aitoggle: '<rect x="2.5" y="7.2" width="19" height="9.6" rx="4.8"/><circle cx="7.3" cy="12" r="3" fill="currentColor" stroke="none"/>',
    ai: '<rect x="4" y="6" width="16" height="12" rx="3"/><path d="M8 6v12M16 6v12"/><circle cx="12" cy="12" r="2"/><path d="M7.5 9h1M7.5 12h1M7.5 15h1M15.5 9h1M15.5 12h1M15.5 15h1" stroke-width="1.6"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    star: '<path d="M12 3.3l2.5 5.1 5.6.8-4 3.9.9 5.5L12 16.2l-5 2.4.9-5.5-4-3.9 5.6-.8z"/>',
    pin: '<path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'
  };

  function svg(name, size) {
    var body = IC[name] || IC.sparkle;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  /* ---------- 功能导览步骤（聚光灯框选主页真实按钮） ----------
     target: 主页上的真实按钮 id；mock: 无实体按钮时用气泡示意图 */
  var SPOTS = [
    {
      target: 'btn-home-memory', ico: 'memory', name: '记忆宫殿',
      desc: '你和访客之间的每一段回忆，都收在这里。点这个入口进入<b>记忆宫殿</b>——聊天中的约定、说过的话会自动被记下，点开任意一条还能看到当时的完整对话；每条记忆旁的<b>星星</b>点亮后成为权重记忆，访客会时刻记住、主动提起。'
    },
    {
      target: 'btn-home-world', ico: 'tree', name: '世界树',
      desc: '点它进入<b>世界树</b>：你的故事设定库。写下人物、地名、世界观，访客聊到相关关键词时会<span class="bm-guide-hl">自动想起并引用</span>，让对话更有代入感。'
    },
    {
      target: 'btn-home-cards', ico: 'cards', name: '字卡库',
      desc: '点它进入<b>字卡库</b>——整个软件的内容引擎：访客的回复、打招呼、戳一戳、状态和寄语都是从这里抽取的。你可以<b>新建分组、逐条撰写</b>，也能<span class="bm-guide-hl">一键导入别人分享的字卡</span>；字卡模式（离线）完全由它驱动，内容越丰富，访客越鲜活。'
    },
    {
      target: 'btn-home-theme', ico: 'palette', name: '织梦点',
      desc: '点它进入<b>织梦点</b>：给你的梦境换一身衣服——<b>配色、字体、主题风格</b>，还有更多美化选项都在这里。'
    },
    {
      target: 'btn-home-ai', ico: 'ai', name: 'API 接入',
      desc: '点它进入 <b>API 接入</b>：填上你自己的 AI 服务地址、Key 和模型名，点「测试链接」确认连通即可。没配置也不怕，软件会自动回退到字卡模式。'
    },
    {
      mock: true, ico: 'aitoggle', name: 'AI / 字卡开关',
      desc: '进入和访客的<b>聊天页</b>后，顶栏里这颗开关就是模式切换：<span class="bm-guide-hl">点亮 = AI 模式</span>（由你配置的 API 驱动，回复更灵动）；<span class="bm-guide-hl">熄灭 = 字卡模式</span>（离线抽你导入的字卡回复）。',
      demo: true
    }
  ];

  var TOTAL = SPOTS.length;

  /* ---------- 状态 ---------- */
  var idx = 0;
  var els = {};            // mount() 缓存的元素引用
  var repositionTimer = null;
  var watchTimer = null;   // watchLateModals 计时器（teardown 统一清）
  var pollTimer = null;    // armPolling 计时器（teardown 统一清）
  var mounted = false;     // cn：防重入标志
  var doneCallbacks = [];  // 引导 finish 时的回调（供 app.js 在引导结束后补弹入梦签等）

  /* ---------- 聚光灯定位 ---------- */
  function placeSpot(stepIdx) {
    var step = SPOTS[stepIdx];
    if (!step || !els.hole || !els.tip) return;

    var el = step.target ? document.getElementById(step.target) : null;
    var r = el ? el.getBoundingClientRect() : null;
    var usable = el && r && r.width > 0 && r.height > 0 && el.offsetParent !== null;

    /* cn：目标按钮不存在/不可见（页面未渲染/被隐藏）→ 居中示意展示。
       旧版此处自动 go(idx+1) 连跳，配合 60ms 重入形成狂跳闪完——已废除 */
    if (!usable) {
      renderTip(step, true);
      els.hole.style.display = 'none';
      els.tip.style.left = '50%';
      els.tip.style.top = '38%';
      els.tip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    /* mock 步骤（AI 开关示意图）：无实体按钮，居中展示 */
    if (step.mock) {
      renderTip(step, true);
      els.hole.style.display = 'none';
      els.tip.style.left = '50%';
      els.tip.style.top = '38%';
      els.tip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    /* 20261004dg：每步无条件把按钮滚到安全区几何中心（页面最中央的实际可用区域）。
       旧版只看「是否在视口内」——按钮贴屏底、被引导自己的「下一步」按钮区盖住时仍算
       "可见"不滚动；且首屏本就可见但偏低的按钮（如记忆宫殿）永远不会居中。
       安全区 = 顶部条下缘 ～ 底部按钮区上缘。滚动用 scrollTop 直接赋值并强制
       scrollBehavior=auto（防容器 CSS smooth 让赋值异步生效），赋值即时生效 →
       同步重测、当帧画出，消除旧版「先画错、再靠 160/380ms 二次猜测」的闪烁与漏滚。 */
    var barH = els.spotbar ? els.spotbar.offsetHeight : 48;
    var footH = els.spotfoot ? els.spotfoot.offsetHeight : 90;
    var safeTop = barH + 10;
    var safeBottom = window.innerHeight - footH - 10;
    {
      var idealTop = (safeTop + safeBottom) / 2 - r.height / 2; // 按钮理想 top（视口坐标）
      try {
        var sc = el.closest ? el.closest('.home-scroll') : null;
        if (sc) {
          var prevSB = sc.style.scrollBehavior;
          sc.style.scrollBehavior = 'auto';
          sc.scrollTop += r.top - idealTop; // 把按钮中心滚到安全区中心（scrollTop 封顶自然钳住）
          sc.style.scrollBehavior = prevSB;
        } else {
          try { el.scrollIntoView({ block: 'center' }); } catch (e2) {}
        }
      } catch (e) {}
      r = el.getBoundingClientRect(); // scrollTop 赋值同步生效，直接拿最新位置
      /* 兜底：到不了理想中心（列表滚到顶/底），至少把越出安全区的边压回来 */
      try {
        var sc2 = el.closest ? el.closest('.home-scroll') : null;
        if (sc2) {
          if (r.bottom > safeBottom) sc2.scrollTop += (r.bottom - safeBottom);
          else if (r.top < safeTop) sc2.scrollTop -= (safeTop - r.top);
          r = el.getBoundingClientRect();
        }
      } catch (e) {}
      /* 布局迟到（入场动画等）时再校一次；滚动已即时生效，通常为空跑 */
      setTimeout(function () { if (mounted && idx === stepIdx) placeSpot(stepIdx); }, 260);
    }

    els.hole.style.display = '';
    renderTip(step, false);

    var pad = 6; // 洞外扩
    els.hole.style.left = (r.left - pad) + 'px';
    els.hole.style.top = (r.top - pad) + 'px';
    els.hole.style.width = (r.width + pad * 2) + 'px';
    els.hole.style.height = (r.height + pad * 2) + 'px';

    /* 气泡定位：优先放洞下方，放不下放上方；上下都要避开顶部条与底部按钮区 */
    var tw = els.tip.offsetWidth;
    var th = els.tip.offsetHeight;
    var usableTop = safeTop;
    var usableBottom = safeBottom;
    var spaceBelow = usableBottom - (r.bottom + pad);
    var top;
    if (spaceBelow >= th + 16) top = r.bottom + pad + 12;
    else top = r.top - pad - th - 12;
    /* 夹在可用区间内（上下都挤时取能放下的位置） */
    if (top + th > usableBottom) top = usableBottom - th;
    if (top < usableTop) top = usableTop;
    var left = r.left + r.width / 2 - tw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tw - 12));
    els.tip.style.transform = '';
    els.tip.style.left = left + 'px';
    els.tip.style.top = top + 'px';
  }

  function renderTip(step, centered) {
    var demoHtml = '';
    if (step.demo) {
      demoHtml =
        '<div class="bm-guide-toggle-demo">' +
          '<span class="bm-guide-td-on">' + svg('aitoggle', 26) + '</span>' +
          '<span class="bm-guide-td-off">' + svg('aitoggle', 26) + '</span>' +
          '<span class="bm-guide-td-label">亮 = AI · 暗 = 字卡</span>' +
        '</div>';
    }
    els.tip.innerHTML =
      '<div class="bm-guide-tip-name">' + svg(step.ico || 'pin', 17) + '<span>' + step.name + '</span></div>' +
      '<div class="bm-guide-tip-desc">' + step.desc + '</div>' +
      demoHtml;
    els.tip.style.display = '';
  }

  /* spot 阶段的重复校正：窗口尺寸变化 / 页面滚动 / 兜底轮询 */
  function startReposition() {
    stopReposition();
    repositionTimer = setInterval(function () {
      if (mounted && els.hole) placeSpot(idx);
    }, 800);
    window.addEventListener('resize', onReposition);
    document.addEventListener('scroll', onReposition, true);
  }
  function onReposition() {
    if (mounted && els.hole) placeSpot(idx);
  }
  function stopReposition() {
    if (repositionTimer) { clearInterval(repositionTimer); repositionTimer = null; }
    window.removeEventListener('resize', onReposition);
    document.removeEventListener('scroll', onReposition, true);
  }

  /* ---------- 构建 overlay（cn：仅聚光灯段） ---------- */
  function build() {
    var mask = document.createElement('div');
    mask.className = 'bm-guide-mask bm-guide-spotting'; // 直接进入 spot 模式（星点收起、洞透真实页面）

    /* 顶部悬浮条：标题 + 跳过 */
    var spotbar = document.createElement('div');
    spotbar.className = 'bm-guide-spotbar';
    spotbar.innerHTML =
      '<span class="bm-guide-spot-title">' + svg('sparkle', 18) + '<span>初入梦境 · 功能导览</span><span class="bm-guide-spot-step-text"></span></span>';
    var skip = document.createElement('button');
    skip.className = 'bm-guide-skip';
    skip.type = 'button';
    skip.textContent = '跳过新手指引';
    skip.addEventListener('click', finish);
    spotbar.appendChild(skip);
    mask.appendChild(spotbar);

    /* 聚光洞 */
    var hole = document.createElement('div');
    hole.className = 'bm-guide-spothole';
    hole.style.display = 'none';
    mask.appendChild(hole);

    /* 说明气泡 */
    var tip = document.createElement('div');
    tip.className = 'bm-guide-tip';
    tip.style.display = 'none';
    mask.appendChild(tip);

    /* 底部：进度圆点 + 下一步/开始探索 */
    var spotfoot = document.createElement('div');
    spotfoot.className = 'bm-guide-spotfoot';
    var dots = document.createElement('div');
    dots.className = 'bm-guide-dots';
    for (var di = 0; di < TOTAL; di++) {
      (function (i) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'bm-guide-dot' + (i === 0 ? ' active' : '');
        d.setAttribute('aria-label', '第 ' + (i + 1) + ' 步');
        d.addEventListener('click', function () { go(i); });
        dots.appendChild(d);
      })(di);
    }
    spotfoot.appendChild(dots);
    var spotnext = document.createElement('button');
    spotnext.type = 'button';
    spotnext.className = 'bm-guide-spotnext';
    spotnext.textContent = '下一步';
    spotnext.addEventListener('click', function () {
      if (idx >= TOTAL - 1) finish(); else go(idx + 1); // 末步=「开始探索」→ 结束并记录
    });
    spotfoot.appendChild(spotnext);
    mask.appendChild(spotfoot);

    /* 左右滑动手势：切换步骤 */
    var startX = null, startY = null;
    mask.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    mask.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) go(idx + 1); else go(idx - 1);
      }
      startX = null; startY = null;
    }, { passive: true });

    function go(n) {
      if (n < 0 || n >= TOTAL) return;
      idx = n;
      var ds = dots.querySelectorAll('.bm-guide-dot');
      for (var i = 0; i < ds.length; i++) {
        ds[i].classList.toggle('done', i < idx);
        ds[i].classList.toggle('active', i === idx);
      }
      var stepIdx = idx;
      var isLast = idx === TOTAL - 1;
      spotnext.textContent = isLast ? '开始探索' : '下一步';
      spotnext.className = 'bm-guide-spotnext' + (isLast ? ' bm-guide-start' : '');
      var stepEl = spotbar.querySelector('.bm-guide-spot-step-text');
      if (stepEl) stepEl.textContent = '（' + (idx + 1) + '/' + TOTAL + '）';
      hole.style.display = 'none';
      tip.style.display = 'none';
      /* 等下一帧布局稳定后再定位（保证气泡测量准确） */
      setTimeout(function () { if (mounted && idx === stepIdx) placeSpot(stepIdx); }, 60);
      startReposition();
    }

    function finish() {
      try { localStorage.setItem(LS_KEY, '1'); } catch (e) {}
      teardown();
      // 引导结束后触发所有注册的回调（如补弹入梦签）
      var cbs = doneCallbacks.slice();
      doneCallbacks.length = 0;
      for (var i = 0; i < cbs.length; i++) {
        try { cbs[i](); } catch (e) {}
      }
    }

    // 点击遮罩空白处不关闭（避免误触），只通过按钮退出
    return { mask: mask, go: go, finish: finish };
  }

  /* cn：统一收口——移除 overlay + 清理所有计时器 + 复位状态。
     旧版 watchLateModals 撤 mask 时不清理 repositionTimer、不复位 mounted，
     多路径挂载叠加后状态错乱（卡死根源之一） */
  function teardown() {
    mounted = false;
    stopReposition();
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    try {
      var mk = document.querySelector('.bm-guide-mask');
      if (mk && mk.parentNode) mk.parentNode.removeChild(mk);
    } catch (e) {}
    els = {};
    idx = 0;
  }

  function mount() {
    /* cn：防重入——已有实例在屏上绝不二次挂载 */
    if (mounted || document.querySelector('.bm-guide-mask')) return;
    var inst = build();
    mounted = true;
    els.mask = inst.mask;
    els.hole = inst.mask.querySelector('.bm-guide-spothole');
    els.tip = inst.mask.querySelector('.bm-guide-tip');
    els.spotbar = inst.mask.querySelector('.bm-guide-spotbar');
    els.spotfoot = inst.mask.querySelector('.bm-guide-spotfoot');
    document.body.appendChild(inst.mask);
    inst.go(0); // 直接进入第一步
  }

  /* ---------- 触发时机判定 ---------- */
  function isReady() {
    // 开屏 canvas 存在 = 开屏未结束
    if (document.getElementById('splash-v5-canvas')) return false;
    // cn：软件声明流程未明确结束（未同意/未关闭）绝不挂——
    // 真机 init 慢时声明弹出晚于开屏结束，旧版在这段窗口期抢跑、盖住声明。
    // app.js 在「已同意」与 releaseGate()（同意/关闭声明）时置 true。
    if (window.__bmNoticeGateDone !== true) return false;
    // 任何弹窗开着（声明 / 入梦签 / 其他启动弹窗）都不弹。
    // 注意：closeModal 只移除 show 类、不清理 innerHTML——所以不能用
    // 「#notice-agree 是否存在」判断声明状态，#modal-mask.show 才是权威。
    var m = document.getElementById('modal-mask');
    if (m && m.classList.contains('show')) return false;
    return true;
  }

  /* 挂载后的观察期：万一仍有弹窗「迟到」弹出，撤下引导、重新排队等待，
     绝不盖住任何弹窗（cn：撤下走统一 teardown，计时器/状态全清理） */
  function watchLateModals() {
    var checks = 0;
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = setInterval(function () {
      checks++;
      var m = document.getElementById('modal-mask');
      if (m && m.classList.contains('show')) {
        teardown();
        armPolling();
        return;
      }
      if (checks > 40) { clearInterval(watchTimer); watchTimer = null; } // 20 秒平安无事则放心
    }, 500);
  }

  function armPolling() {
    // 轮询：等开屏结束 + 声明流程结束 + 无任何弹窗（连续 2 次满足才弹，防弹窗间隙误判）
    // cn：删除旧版「1 分钟兜底无条件强弹」——它会在弹窗未关时硬弹引导，
    // 与 watchLateModals 重新排队叠加造成重复弹出/卡死。现在只按条件等待。
    if (pollTimer) clearInterval(pollTimer);
    var tries = 0;
    var streak = 0;
    pollTimer = setInterval(function () {
      tries++;
      if (tries > 2400) { // 约 20 分钟仍未满足（异常情况）→ 放弃本轮等待，绝不强弹
        clearInterval(pollTimer); pollTimer = null;
        return;
      }
      if (isReady()) {
        streak++;
        if (streak >= 2) {
          clearInterval(pollTimer); pollTimer = null;
          if (!mounted && !document.querySelector('.bm-guide-mask')) {
            mount();
            watchLateModals();
          }
        }
      } else {
        streak = 0;
      }
    }, 500);
  }

  function ensureStyle() {
    if (!document.getElementById('bm-guide-style')) {
      var link = document.createElement('link');
      link.id = 'bm-guide-style';
      link.rel = 'stylesheet';
      link.href = STYLE_HREF;
      document.head.appendChild(link);
    }
  }

  function init() {
    // 已看过的老用户不再弹
    try { if (localStorage.getItem(LS_KEY) === '1') return; } catch (e) {}
    ensureStyle();
    armPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ============================================================
     全局 API（供总设置「播放新手引导」按钮调用，以及供 app.js
     协调首启顺序——引导未完成时入梦签让位）：
     · start()：手动重播（无视 bm_guide_done，用于总设置重看）
     · isDone()：是否已完成引导
     · isActive()：引导 overlay 是否正显示在屏幕上
     · onDone(cb)：注册引导结束回调（app.js 用它补弹入梦签）
     ============================================================ */
  window.bmGuide = {
    start: function () {
      ensureStyle();
      if (!mounted && !document.querySelector('.bm-guide-mask')) {
        mount();
        watchLateModals();
      }
    },
    isDone: function () {
      try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return true; }
    },
    /* 引导 overlay 是否正显示在屏幕上（DOM 里存在 .bm-guide-mask）。
       供 app.js 的入梦签让位用——即使 window.bmGuide 因脚本时序尚未就绪，
       只要引导已在屏上，入梦签也绝不抢弹。 */
    isActive: function () {
      return !!document.querySelector('.bm-guide-mask');
    },
    onDone: function (cb) {
      if (typeof cb === 'function') doneCallbacks.push(cb);
    }
  };
})();
