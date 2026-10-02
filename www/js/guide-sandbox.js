/* ============================================================
   《白日梦》新手引导 —— 沙盒脚本（20261002cj）
   严格沙盒隔离：
     · 不修改任何核心代码（聊天/字卡/API/IndexedDB/路由零触碰）；
     · 不修改 index.html 的 DOM 结构——本脚本动态创建一个全屏 overlay
       浮在页面最上方，结束时从 DOM 彻底移除；
     · 所有代码独立在本文件 + guide-sandbox.css 内，类名统一 bm-guide- 前缀；
     · 一键卸载：localStorage['bm_guide_done'] 记录，点「开始探索」或
       「跳过新手指引」后彻底移除 overlay 且永不再弹。

   两段式结构（20261002cj）：
     · 第一段「初识」：6 张星轨卡片，介绍五大核心功能（点到为止）；
     · 第二段「功能引导」：聚光灯逐个框选主页上的真实按钮
       （记忆宫殿 / 世界树 / 织梦点 / API 接入），AI/字卡开关在聊天页、
       主页无实体按钮，用气泡内的开关示意图说明位置。

   触发时机（20261002cj）：等开屏动画（#splash-v5-canvas）结束，
   且软件声明（#notice-agree）与入梦签等所有弹窗（#modal-mask.show）
   全部关闭后才弹出——连续 2 次轮询（1 秒）都无弹窗才挂载，
   防止「声明刚关、入梦签刚弹」的间隙被误判。
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
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="9.5" r="1" fill="currentColor" stroke="none"/><path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.4 1.1-2 2.5-2s2-.6 2-1.5 1-1.5 2.5-1.5"/>',
    aitoggle: '<rect x="2.5" y="7.2" width="19" height="9.6" rx="4.8"/><circle cx="7.3" cy="12" r="3" fill="currentColor" stroke="none"/>',
    ai: '<rect x="4" y="6" width="16" height="12" rx="3"/><path d="M8 6v12M16 6v12"/><circle cx="12" cy="12" r="2"/><path d="M7.5 9h1M7.5 12h1M7.5 15h1M15.5 9h1M15.5 12h1M15.5 15h1" stroke-width="1.6"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    star: '<path d="M12 3.3l2.5 5.1 5.6.8-4 3.9.9 5.5L12 16.2l-5 2.4.9-5.5-4-3.9 5.6-.8z"/>',
    pin: '<path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    chevright: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>'
  };

  function svg(name, size) {
    var body = IC[name] || IC.sparkle;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  /* ---------- 第一段：初识卡片（5 大核心功能 + 权重记忆） ---------- */
  var SLIDES = [
    {
      ico: 'memory',
      name: '记忆宫殿',
      tag: 'MEMORY PALACE',
      desc: '你和访客之间的每一段回忆，都收在这里。聊天中的约定、说过的话，会自动被记下；点开任意一条，还能看到当时的完整对话。',
      hint: '主页 · 「记忆宫殿」入口',
      hintIco: 'home'
    },
    {
      ico: 'star',
      name: '权重记忆',
      tag: 'WEIGHTED MEMORY',
      desc: '每条记忆旁的<b>星星</b>，是它的「分量」。点亮星星，这条记忆就成了<span class="bm-guide-hl">权重记忆</span>——访客会时刻记住，还会主动提起、送礼物、发朋友圈。',
      hint: '记忆宫殿里 · 每条记忆旁的星星按钮',
      hintIco: 'star'
    },
    {
      ico: 'tree',
      name: '世界树',
      tag: 'WORLD TREE',
      desc: '你的故事设定库。写下人物、地名、世界观，访客聊到相关关键词时会<span class="bm-guide-hl">自动想起并引用</span>，让对话更有代入感。',
      hint: '主页 · 「世界树」入口',
      hintIco: 'home'
    },
    {
      ico: 'aitoggle',
      name: 'AI / 字卡模式',
      tag: 'AI & CARD MODE',
      desc: '聊天页<b>顶栏的开关按钮</b>就是模式切换：<span class="bm-guide-hl">点亮 = AI 模式</span>（由你配置的 API 驱动，回复更灵动）；<span class="bm-guide-hl">熄灭 = 字卡模式</span>（离线抽你导入的字卡回复）。',
      hint: '聊天页顶栏 · AI/字卡开关（亮=AI，暗=字卡）',
      hintIco: 'chat'
    },
    {
      ico: 'ai',
      name: 'API 接入',
      tag: 'API SETUP',
      desc: '想用 AI 模式，先来这里填上你自己的 AI 服务地址、Key 和模型名，点「测试链接」确认连通即可。没配置也不怕，软件会自动回退到字卡模式。',
      hint: '主页 · 「API 接入」入口',
      hintIco: 'home'
    },
    {
      ico: 'palette',
      name: '织梦点',
      tag: 'DREAM STUDIO',
      desc: '给你的梦境换一身衣服：<b>配色、字体、主题风格</b>，还有更多美化选项，都在这里慢慢探索。',
      hint: '主页 · 「织梦点」入口',
      hintIco: 'home'
    }
  ];

  /* ---------- 第二段：功能引导（聚光灯框选主页真实按钮） ----------
     target: 主页上的真实按钮 id；mock: 无实体按钮时用气泡示意图 */
  var SPOTS = [
    {
      target: 'btn-home-memory', ico: 'memory', name: '记忆宫殿',
      desc: '就是这个入口——点它会进入<b>记忆宫殿</b>，你和访客的每一段回忆都收在里面。'
    },
    {
      target: 'btn-home-world', ico: 'tree', name: '世界树',
      desc: '点它进入<b>世界树</b>：你的故事设定库，访客聊到相关关键词会自动引用。'
    },
    {
      target: 'btn-home-theme', ico: 'palette', name: '织梦点',
      desc: '点它进入<b>织梦点</b>：梦境的配色、字体、主题风格都在这里换。'
    },
    {
      target: 'btn-home-ai', ico: 'ai', name: 'API 接入',
      desc: '点它进入 <b>API 接入</b>：填上你的 AI 服务地址和 Key，AI 模式就靠它驱动。'
    },
    {
      mock: true, ico: 'aitoggle', name: 'AI / 字卡开关',
      desc: '进入和访客的<b>聊天页</b>后，顶栏里这颗开关就是模式切换：',
      demo: true
    }
  ];

  var TOTAL = SLIDES.length + SPOTS.length;

  /* ---------- 状态 ---------- */
  var idx = 0;
  var els = {};          // build() 缓存的元素引用
  var repositionTimer = null;
  var doneCallbacks = []; // 20261002cl：引导 finish 时的回调（供 app.js 在引导结束后补弹入梦签等）

  /* ---------- 第二段：聚光灯定位 ---------- */
  function placeSpot(stepIdx) {
    var step = SPOTS[stepIdx];
    if (!step || !els.hole || !els.tip) return;

    /* mock 步骤（AI 开关示意图）：无实体按钮，居中展示 */
    if (step.mock || !step.target) {
      renderTip(step, true);
      els.hole.style.display = 'none';
      els.tip.style.left = '50%';
      els.tip.style.top = '38%';
      els.tip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    var el = document.getElementById(step.target);
    var r = el ? el.getBoundingClientRect() : null;
    /* 防御：目标按钮不存在或不可见（页面未渲染/被隐藏）→ 自动跳到下一步 */
    if (!el || !r || r.width <= 0 || r.height <= 0 || el.offsetParent === null) {
      if (idx + 1 < TOTAL) { go(idx + 1); } else { finish(); }
      return;
    }

    /* 按钮若不在视口内，先滚动到中央再重新测量 */
    if (r.top < 0 || r.bottom > window.innerHeight) {
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      setTimeout(function () { if (idx - SLIDES.length === stepIdx) placeSpot(stepIdx); }, 160);
      return;
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
    var barH = els.spotbar ? els.spotbar.offsetHeight : 48;
    var footH = els.spotfoot ? els.spotfoot.offsetHeight : 90;
    var usableTop = barH + 10;
    var usableBottom = window.innerHeight - footH - 10;
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
    /* 居中模式（无实体按钮）时重置内部布局 */
    els.tip.style.display = '';
  }

  /* spot 阶段的重复校正：窗口尺寸变化 / 页面滚动 / 兜底轮询 */
  function startReposition() {
    stopReposition();
    repositionTimer = setInterval(function () {
      if (idx >= SLIDES.length && els.hole) placeSpot(idx - SLIDES.length);
    }, 800);
    window.addEventListener('resize', onReposition);
    document.addEventListener('scroll', onReposition, true);
  }
  function onReposition() {
    if (idx >= SLIDES.length && els.hole) placeSpot(idx - SLIDES.length);
  }
  function stopReposition() {
    if (repositionTimer) { clearInterval(repositionTimer); repositionTimer = null; }
    window.removeEventListener('resize', onReposition);
    document.removeEventListener('scroll', onReposition, true);
  }

  /* ---------- 构建 overlay ---------- */
  function build() {
    var mask = document.createElement('div');
    mask.className = 'bm-guide-mask';

    /* ===== 第一段：卡片 ===== */
    var card = document.createElement('div');
    card.className = 'bm-guide-card';

    var head = document.createElement('div');
    head.className = 'bm-guide-head';
    var title = document.createElement('div');
    title.className = 'bm-guide-title';
    title.innerHTML = '<span class="bm-guide-logo">' + svg('sparkle', 22) + '</span>初入梦境';
    var skip = document.createElement('button');
    skip.className = 'bm-guide-skip';
    skip.type = 'button';
    skip.textContent = '跳过新手指引';
    head.appendChild(title);
    head.appendChild(skip);
    card.appendChild(head);

    var slides = document.createElement('div');
    slides.className = 'bm-guide-slides';
    var track = document.createElement('div');
    track.className = 'bm-guide-track';
    SLIDES.forEach(function (s) {
      var slide = document.createElement('div');
      slide.className = 'bm-guide-slide';
      slide.innerHTML =
        '<div class="bm-guide-ico">' + svg(s.ico, 38) + '</div>' +
        '<div class="bm-guide-name">' + s.name + '</div>' +
        '<div class="bm-guide-tag">' + s.tag + '</div>' +
        '<div class="bm-guide-desc">' + s.desc + '</div>' +
        '<div class="bm-guide-hint">' + svg(s.hintIco, 14) + '<span>' + s.hint + '</span></div>';
      track.appendChild(slide);
    });
    slides.appendChild(track);
    card.appendChild(slides);

    var foot = document.createElement('div');
    foot.className = 'bm-guide-foot';

    var dots = document.createElement('div');
    dots.className = 'bm-guide-dots';
    for (var di = 0; di < TOTAL; di++) {
      (function (i) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'bm-guide-dot' + (i === 0 ? ' active' : '');
        d.setAttribute('aria-label', '第 ' + (i + 1) + ' 步');
        if (i < SLIDES.length) {
          d.addEventListener('click', function () { go(i); }); // 圆点仅可跳转卡片段
        } else {
          d.disabled = true; // 功能引导段按顺序走
          d.style.cursor = 'default';
        }
        dots.appendChild(d);
      })(di);
    }
    foot.appendChild(dots);

    var btnrow = document.createElement('div');
    btnrow.className = 'bm-guide-btnrow';

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'bm-guide-next';
    next.textContent = '下一项';
    next.addEventListener('click', function () { go(idx + 1); });

    btnrow.appendChild(next);
    foot.appendChild(btnrow);

    var swipe = document.createElement('div');
    swipe.className = 'bm-guide-swipe';
    swipe.textContent = '左右滑动切换';
    foot.appendChild(swipe);

    card.appendChild(foot);
    mask.appendChild(card);

    /* ===== 第二段：聚光灯功能引导（初始隐藏，进入 spot 段时由 CSS 显示） ===== */
    var spotbar = document.createElement('div');
    spotbar.className = 'bm-guide-spotbar';
    spotbar.style.display = 'none';
    spotbar.innerHTML =
      '<span class="bm-guide-spot-step">功能导览</span>';
    var skip2 = document.createElement('button');
    skip2.className = 'bm-guide-skip';
    skip2.type = 'button';
    skip2.textContent = '跳过新手指引';
    skip2.addEventListener('click', finish);
    spotbar.appendChild(skip2);
    mask.appendChild(spotbar);

    var hole = document.createElement('div');
    hole.className = 'bm-guide-spothole';
    hole.style.display = 'none';
    mask.appendChild(hole);

    var tip = document.createElement('div');
    tip.className = 'bm-guide-tip';
    tip.style.display = 'none';
    mask.appendChild(tip);

    var spotfoot = document.createElement('div');
    spotfoot.className = 'bm-guide-spotfoot';
    spotfoot.style.display = 'none';
    var spotnext = document.createElement('button');
    spotnext.type = 'button';
    spotnext.className = 'bm-guide-spotnext';
    spotnext.textContent = '下一步';
    spotnext.addEventListener('click', function () {
      if (idx >= TOTAL - 1) finish(); else go(idx + 1); // 末步=「开始探索」→ 结束并记录
    });
    spotfoot.appendChild(spotnext);
    mask.appendChild(spotfoot);

    /* 左右滑动手势（两段通用） */
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

      var inSpot = idx >= SLIDES.length;
      /* 两段布局切换 */
      mask.classList.toggle('bm-guide-spotting', inSpot);
      spotbar.style.display = inSpot ? '' : 'none';
      spotfoot.style.display = inSpot ? '' : 'none';
      if (inSpot) {
        hole.style.display = 'none';
        tip.style.display = 'none';
        var stepIdx = idx - SLIDES.length;
        var step = SPOTS[stepIdx];
        var isLast = idx === TOTAL - 1;
        spotnext.textContent = isLast ? '开始探索' : '下一步';
        spotnext.className = 'bm-guide-spotnext' + (isLast ? ' bm-guide-start' : '');
        /* 等下一帧布局稳定后再定位（保证气泡测量准确） */
        setTimeout(function () {
          if (idx - SLIDES.length === stepIdx) placeSpot(stepIdx);
          if (step && step.mock) { /* mock 步骤洞保持隐藏 */ }
        }, 60);
        spotbar.querySelector('.bm-guide-spot-step').textContent = '功能导览 · ' + (stepIdx + 1) + '/' + SPOTS.length;
        startReposition();
      } else {
        stopReposition();
        track.style.transform = 'translateX(-' + (idx * 100) + '%)';
        next.style.display = ''; // 卡片段始终「下一项」，末页继续进入功能引导段
      }
    }

    function finish() {
      try { localStorage.setItem(LS_KEY, '1'); } catch (e) {}
      destroy();
      // 20261002cl：引导结束后触发所有注册的回调（如补弹入梦签）
      var cbs = doneCallbacks.slice();
      doneCallbacks.length = 0;
      for (var i = 0; i < cbs.length; i++) {
        try { cbs[i](); } catch (e) {}
      }
    }

    function destroy() {
      stopReposition();
      try {
        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
      } catch (e) {}
    }

    skip.addEventListener('click', finish);
    // 点击遮罩空白处不关闭（避免误触），只通过按钮退出
    return { mask: mask, go: go, finish: finish };
  }

  function mount() {
    var inst = build();
    els.mask = inst.mask;
    els.hole = inst.mask.querySelector('.bm-guide-spothole');
    els.tip = inst.mask.querySelector('.bm-guide-tip');
    els.spotbar = inst.mask.querySelector('.bm-guide-spotbar');
    els.spotfoot = inst.mask.querySelector('.bm-guide-spotfoot');
    document.body.appendChild(inst.mask);
  }

  /* ---------- 触发时机判定 ---------- */
  function isReady() {
    // 开屏 canvas 存在 = 开屏未结束
    if (document.getElementById('splash-v5-canvas')) return false;
    // 任何弹窗开着（声明 / 入梦签 / 其他启动弹窗）都不弹。
    // 注意：closeModal 只移除 show 类、不清理 innerHTML——所以不能用
    // 「#notice-agree 是否存在」判断声明状态，#modal-mask.show 才是权威。
    var m = document.getElementById('modal-mask');
    if (m && m.classList.contains('show')) return false;
    return true;
  }

  /* 挂载后的观察期：声明关闭后入梦签等弹窗可能「迟到」弹出，
     若真弹了就撤下引导、重新排队等待，绝不盖住任何弹窗 */
  function watchLateModals() {
    var checks = 0;
    var wt = setInterval(function () {
      checks++;
      var m = document.getElementById('modal-mask');
      if (m && m.classList.contains('show')) {
        var mk = document.querySelector('.bm-guide-mask');
        if (mk && mk.parentNode) mk.parentNode.removeChild(mk);
        clearInterval(wt);
        armPolling();
        return;
      }
      if (checks > 40) clearInterval(wt); // 20 秒平安无事则放心
    }, 500);
  }

  function armPolling() {
    // 轮询：等开屏结束 + 声明/入梦签等所有弹窗关闭（连续 2 次满足才弹，防弹窗间隙误判）
    var tries = 0;
    var streak = 0;
    var timer = setInterval(function () {
      tries++;
      if (isReady()) {
        streak++;
        if (streak >= 2) {
          clearInterval(timer);
          if (!document.querySelector('.bm-guide-mask')) {
            mount();
            watchLateModals();
          }
        }
      } else {
        streak = 0;
      }
      if (tries > 120) { // 约 1 分钟仍不满足（异常情况），兜底弹出
        clearInterval(timer);
        if (!document.querySelector('.bm-guide-mask')) mount();
      }
    }, 500);
  }

  function init() {
    // 已看过的老用户不再弹
    try { if (localStorage.getItem(LS_KEY) === '1') return; } catch (e) {}

    // 动态注入样式表（同源，只加载一次）
    if (!document.getElementById('bm-guide-style')) {
      var link = document.createElement('link');
      link.id = 'bm-guide-style';
      link.rel = 'stylesheet';
      link.href = STYLE_HREF;
      document.head.appendChild(link);
    }

    armPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ============================================================
     20261002cl：暴露全局 API 供总设置「播放新手引导」按钮调用，
     以及供 app.js 协调首启顺序（引导未完成时入梦签让位）。
     · start()：手动重播（无视 bm_guide_done，用于总设置重看）
     · isDone()：是否已完成引导
     · onDone(cb)：注册引导结束回调（app.js 用它补弹入梦签）
     ============================================================ */
  window.bmGuide = {
    start: function () {
      // 确保样式已注入
      if (!document.getElementById('bm-guide-style')) {
        var link = document.createElement('link');
        link.id = 'bm-guide-style';
        link.rel = 'stylesheet';
        link.href = STYLE_HREF;
        document.head.appendChild(link);
      }
      if (!document.querySelector('.bm-guide-mask')) {
        mount();
        watchLateModals();
      }
    },
    isDone: function () {
      try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return true; }
    },
    /* 20261002cl2：引导 overlay 是否正显示在屏幕上（DOM 里存在 .bm-guide-mask）。
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
