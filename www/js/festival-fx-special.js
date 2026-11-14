/* ============================================================
 * 白日梦 · 入梦签「冬季三节日」动画（独立模块）
 * 20261115 新增：万圣节 halloween / 平安夜 christmasEve / 圣诞节 christmas
 *
 * 为什么单独一个文件：
 *   dream-fx.js 里那 30 多个都是「氛围粒子」（飘雪、落花、火星），共用一张
 *   统一的 draw 表就够了。但这三个是带状态机、可点击推进的互动场景
 *   （点南瓜灯 → 亮 → 浮起来；手指划刀切苹果 → 装盘 → 进烤箱 → 出炉；
 *    点圣诞树 → 树晃、掉礼物、星星挂饰亮起），塞进那张表会很难维护，
 *   故独立成模块，通过 window.BMFX_SPECIAL[kind].start(canvas) 挂载。
 *
 * 20261115 第二轮（玩家反馈后重做平安夜）：
 *   · 平安夜从一个「切 3 刀 → 点两下」的演示，改成 7 个阶段的真小游戏：
 *     ① 切苹果（手指当刀，一刀一片，片飞到旁边木托上摞起来，擦边只出碎渣）
 *     ② 撒糖（按住撒，松手定格，糖量要落在绿区）
 *     ③ 装盘（片先悬在空中 → 逐片落进派盘 → 网格派皮盖下）
 *     ④ 刷蛋液（按住涂抹，覆盖率决定出炉时的金黄程度）
 *     ⑤ 送炉（派盘抬起 → 炉门下拉打开 → 滑进炉膛 → 关门）
 *     ⑥ 烘烤（火候全靠玩家点停：生 / 刚好 / 焦糖色 / 烤焦 / 炭）
 *     ⑦ 出炉（成品形象 + 四项明细 + 评级）
 *     四项都苛刻达标（正好 10 片、零碎渣、糖停在绿区、蛋液 100%、火候落在 3.9~4.6s）
 *     才是「最完美的苹果派」。
 *   · 修穿模：盘子（瓷白）与派（金黄）现在严格分层——盘壁 → 盘面 → 派侧壁 →
 *     派顶 → 网格条 → 卷边 → 光泽，盘半径比派大一圈，露出来的那圈就是盘沿。
 *   · 修烤色：焦糖色改成琥珀金棕（#d18d34），不再往近黑里叠，与「烤焦」分得开。
 *   · 布局改成主项目入梦签那套（.daily-card.festival-card > canvas + .dream-fx-inner），
 *     三张卡加 .fx-game 类：文字在上半、动画在中下、按钮钉底。
 *
 * 依赖：无。纯 canvas 2D，不加载任何外部图片 / 字体 / 音频。
 * 尺寸：全部按归一化坐标 + 相对尺度 S（= 画布宽 / 380）绘制，卡片多宽都适配。
 * 事件：预览页里 canvas 自己接事件；正式入梦签里 canvas 是 pointer-events:none，
 *       监听会自动挂到外层 .festival-card 上（并放过 button 的点击）。
 * ============================================================ */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // 指数趋近：每帧把 v 拉向 target，k 越大越快（与帧率无关）
  const approach = (v, target, k, dt) => v + (target - v) * (1 - Math.exp(-k * dt));

  /* ---------- 通用场景外壳：尺寸自适应 + rAF + 指针事件 ---------- */
  function createScene(canvas, hooks) {
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let running = false;
    let last = 0;
    let t = 0;
    let W = 1, H = 1, S = 1;
    const st = hooks.init ? hooks.init() : {};

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth || canvas.clientWidth || 320;
      const h = canvas.offsetHeight || canvas.clientHeight || 480;
      W = Math.max(1, Math.round(w * dpr));
      H = Math.max(1, Math.round(h * dpr));
      canvas.width = W;
      canvas.height = H;
      S = W / 380; // 相对尺度基准
    };

    const localPt = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (W / Math.max(1, r.width)),
        y: (e.clientY - r.top) * (H / Math.max(1, r.height)),
      };
    };

    const onDown = (e) => {
      // 20261115：正式入梦签里 canvas 是 pointer-events:none，事件挂在整张卡片上；
      // 所以点「我收到啦」这类按钮时不能当成游戏操作，直接放过。
      if (e.target && e.target.closest && e.target.closest('button')) return;
      if (e.cancelable) e.preventDefault();
      const p = localPt(e);
      st._ptrDown = true;
      st._px = p.x; st._py = p.y;
      if (hooks.down) hooks.down(st, p.x, p.y, t, W, H, S);
    };
    const onMove = (e) => {
      const p = localPt(e);
      const prevX = st._mx == null ? p.x : st._mx;
      const prevY = st._my == null ? p.y : st._my;
      st._mx = p.x; st._my = p.y;
      if (hooks.move) hooks.move(st, p.x, p.y, prevX, prevY, t, W, H, S);
    };
    const onUp = () => { st._ptrDown = false; if (hooks.up) hooks.up(st); };

    const frame = (now) => {
      if (!running) return;
      if (!last) last = now;
      let dt = (now - last) / 1000;
      last = now;
      dt = clamp(dt, 0, 0.05); // 切后台回来时防跳帧
      t += dt;
      if (hooks.step) hooks.step(st, t, dt, W, H, S);
      ctx.clearRect(0, 0, W, H);
      if (hooks.draw) hooks.draw(st, ctx, t, dt, W, H, S);
      raf = requestAnimationFrame(frame);
    };

    /* 20261115：事件目标——预览页里 canvas 自己接事件；正式入梦签里 canvas 是
       pointer-events:none 的背景层，必须把监听挂到外层卡片上（坐标仍按 canvas 的 rect 换算）。 */
    const host = (canvas.closest && canvas.closest('.festival-card')) || canvas;
    /* 20261115：把宿主卡片挂到状态上 —— 小游戏进入「结算」时要给卡片加个 class，
       让底部的寄语淡出，把位置让给画布上的结果文字（不然两行字会叠在一起）。
       重做时再把 class 摘掉。 */
    st.__host = host;

    const api = {
      start() {
        if (running) return;
        resize();
        running = true;
        last = 0;
        host.addEventListener('pointerdown', onDown);
        host.addEventListener('pointermove', onMove);
        // 触屏：部分 WebView 只发 touch 不发 pointer，补一条链路（与 app.js 里风场的处理一致）
        // 20261115：touchmove/touchstart 都改成 passive:false —— 切苹果要「划」，
        // passive:true 时 preventDefault 无效，手指一划页面会跟着滚。
        host.addEventListener('touchmove', onMove, { passive: false });
        host.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('pointerup', onUp);
        window.addEventListener('touchend', onUp);
        raf = requestAnimationFrame(frame);
        if (hooks.resume) hooks.resume();
      },
      stop() {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('touchmove', onMove);
        host.removeEventListener('touchstart', onDown);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('touchend', onUp);
        if (hooks.pause) hooks.pause();
      },
      get running() { return running; },
      get state() { return st; },
    };
    return api;
  }

  /* ============================================================
   * 一、万圣节：南瓜灯（点一下亮 / 再点浮起来）+ 空中白色床单小鬼
   * ============================================================ */

  /* 画一只「床单小鬼」：圆头 + 波浪下摆 + 两个黑眼 + 腮红。ph 控制下摆飘动相位 */
  function drawGhost(ctx, x, y, s, ph, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;

    // 柔光（让它在夜里“浮”出来，而不是贴片）
    const g = ctx.createRadialGradient(0, 0, s * 0.1, 0, 0, s * 0.95);
    g.addColorStop(0, 'rgba(210,215,255,0.28)');
    g.addColorStop(1, 'rgba(210,215,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, s * 0.95, 0, TAU); ctx.fill();

    const top = -s * 0.62;
    const bottom = s * 0.34;
    ctx.beginPath();
    ctx.moveTo(-s * 0.46, bottom);
    ctx.quadraticCurveTo(-s * 0.60, top * 0.55, -s * 0.34, top * 0.78);
    ctx.quadraticCurveTo(0, top - s * 0.06, s * 0.34, top * 0.78);
    ctx.quadraticCurveTo(s * 0.60, top * 0.55, s * 0.46, bottom);
    // 下摆三段波浪，相位随 ph 起伏
    const seg = 3, w = (s * 0.92) / seg;
    for (let i = 0; i < seg; i++) {
      const x0 = s * 0.46 - w * i;
      const wob = Math.sin(ph + i * 1.9) * s * 0.055;
      ctx.quadraticCurveTo(x0 - w * 0.5, bottom + s * 0.16 + wob, x0 - w, bottom - Math.abs(wob) * 0.4);
    }
    ctx.closePath();
    const body = ctx.createLinearGradient(0, top, 0, bottom);
    body.addColorStop(0, 'rgba(255,255,255,0.97)');
    body.addColorStop(1, 'rgba(226,228,246,0.90)');
    ctx.fillStyle = body;
    ctx.fill();

    // 眼睛（跟着飘动轻轻晃）
    const eo = Math.sin(ph * 0.7) * s * 0.02;
    ctx.fillStyle = 'rgba(38,32,52,0.88)';
    ctx.beginPath(); ctx.ellipse(-s * 0.16 + eo, -s * 0.14, s * 0.055, s * 0.075, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.16 + eo, -s * 0.14, s * 0.055, s * 0.075, 0, 0, TAU); ctx.fill();

    // 腮红
    ctx.fillStyle = 'rgba(255,150,170,0.32)';
    ctx.beginPath(); ctx.ellipse(-s * 0.28, s * 0.02, s * 0.075, s * 0.045, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.28, s * 0.02, s * 0.075, s * 0.045, 0, 0, TAU); ctx.fill();

    // 小嘴
    ctx.strokeStyle = 'rgba(60,50,80,0.55)';
    ctx.lineWidth = Math.max(1, s * 0.022);
    ctx.beginPath();
    ctx.arc(eo, s * 0.06, s * 0.055, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  /* 画南瓜灯。lit: 0~1 亮灯程度；r: 半径基准 */
  function drawPumpkin(ctx, cx, cy, r, lit, S) {
    const w = r * 1.55;
    const h = r * 1.18;

    // 亮着时的橙色外光晕
    if (lit > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 3.4);
      g.addColorStop(0, `rgba(255,170,70,${0.34 * lit})`);
      g.addColorStop(0.55, `rgba(255,140,50,${0.13 * lit})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r * 3.4, 0, TAU); ctx.fill();
    }

    // 瓜身：三瓣椭圆叠出立体感
    const lobes = [
      { dx: -0.30, rx: 0.27, fill: '#c85c1c' },
      { dx: 0.30, rx: 0.27, fill: '#c85c1c' },
      { dx: 0, rx: 0.32, fill: '#e5762b' },
      { dx: -0.13, rx: 0.15, fill: '#f08a3c' },
    ];
    for (const L of lobes) {
      ctx.beginPath();
      ctx.ellipse(cx + L.dx * w, cy, L.rx * w, h * 0.5, 0, 0, TAU);
      ctx.fillStyle = L.fill;
      ctx.fill();
    }

    // 顶部蒂
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.045, cy - h * 0.46);
    ctx.quadraticCurveTo(cx, cy - h * 0.60, cx + w * 0.035, cy - h * 0.46);
    ctx.fillStyle = '#4a7a33';
    ctx.fill();

    // 五官：亮灯时透出暖黄并有辉光，熄灭时是暗褐色深坑
    const on = lit > 0.35;
    const faceFill = on ? '#ffd75e' : 'rgba(90,44,14,0.85)';
    ctx.save();
    if (on) {
      ctx.shadowColor = `rgba(255,190,80,${0.9 * lit})`;
      ctx.shadowBlur = 18 * S * lit;
    }
    ctx.fillStyle = faceFill;

    // 两只三角眼
    const eyeY = cy - h * 0.10;
    const eyeDX = w * 0.20;
    const eyeW = w * 0.15;
    const eyeH = h * 0.16;
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(cx + side * eyeDX - eyeW, eyeY + eyeH * 0.5);
      ctx.lineTo(cx + side * eyeDX + eyeW, eyeY + eyeH * 0.5);
      ctx.lineTo(cx + side * eyeDX, eyeY - eyeH * 0.55);
      ctx.closePath();
      ctx.fill();
    });

    // 锯齿嘴
    const mouthY = cy + h * 0.18;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.26, mouthY);
    const teeth = 4;
    const segW = (w * 0.52) / (teeth * 2);
    for (let i = 0; i < teeth * 2; i++) {
      const up = i % 2 === 0;
      ctx.lineTo(cx - w * 0.26 + segW * (i + 1), mouthY + (up ? -h * 0.10 : h * 0.06));
    }
    ctx.lineTo(cx + w * 0.26, mouthY);
    ctx.lineTo(cx + w * 0.26, mouthY + h * 0.10);
    ctx.lineTo(cx - w * 0.26, mouthY + h * 0.10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 高光：一点点湿润感
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.16, cy - h * 0.22, w * 0.07, h * 0.09, -0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,220,170,0.18)';
    ctx.fill();
  }

  /* ---------- 糖果（点南瓜时喷出来一把，四散、落地、淡出） ---------- */
  const CANDY_COLORS = [
    ['#ff5f6d', '#ffc2c6'], // 草莓
    ['#ffd166', '#fff0c0'], // 柠檬
    ['#4fd1a5', '#c8f5e6'], // 青苹果
    ['#79a9ff', '#d3e2ff'], // 蓝莓
    ['#ff9f43', '#ffe2bd'], // 橘子
    ['#c98cff', '#eeddff'], // 葡萄
  ];

  /* 三种糖型：0 扭结糖（两端纸扭）、1 圆糖球、2 拐杖糖 */
  function drawCandy(ctx, x, y, s, rot, type, hue) {
    const c = CANDY_COLORS[hue % CANDY_COLORS.length];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    if (type === 0) {
      // 两端纸扭
      ctx.fillStyle = c[1];
      ctx.beginPath();
      ctx.moveTo(-s * 1.25, 0); ctx.lineTo(-s * 0.52, -s * 0.54); ctx.lineTo(-s * 0.52, s * 0.54);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 1.25, 0); ctx.lineTo(s * 0.52, -s * 0.54); ctx.lineTo(s * 0.52, s * 0.54);
      ctx.closePath(); ctx.fill();
      // 糖体
      const g = ctx.createLinearGradient(0, -s * 0.52, 0, s * 0.52);
      g.addColorStop(0, c[1]); g.addColorStop(0.42, c[0]); g.addColorStop(1, c[0]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62, s * 0.50, 0, 0, TAU); ctx.fill();
      // 螺旋纹
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = Math.max(0.7, s * 0.15);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * s * 0.30, 0, s * 0.34, -1.15, 1.15);
        ctx.stroke();
      }
    } else if (type === 1) {
      // 圆糖球 + 一点高光
      const g = ctx.createRadialGradient(-s * 0.25, -s * 0.28, s * 0.08, 0, 0, s * 0.72);
      g.addColorStop(0, c[1]); g.addColorStop(0.55, c[0]); g.addColorStop(1, c[0]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(0.6, s * 0.13);
      ctx.beginPath(); ctx.arc(0, 0, s * 0.34, -2.4, -1.1); ctx.stroke();
    } else {
      // 拐杖糖：J 形 + 红白斜纹
      ctx.strokeStyle = c[1];
      ctx.lineWidth = Math.max(2, s * 0.42);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, s * 0.85);
      ctx.lineTo(0, -s * 0.20);
      ctx.arc(s * 0.30, -s * 0.20, s * 0.30, Math.PI, TAU, false);
      ctx.stroke();
      // 斜纹（细一点叠在上面）
      ctx.strokeStyle = c[0];
      ctx.lineWidth = Math.max(1, s * 0.14);
      for (let i = 0; i < 4; i++) {
        const yy = s * 0.62 - i * s * 0.30;
        ctx.beginPath();
        ctx.moveTo(-s * 0.20, yy + s * 0.12);
        ctx.lineTo(s * 0.20, yy - s * 0.06);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* 从南瓜中心喷一把糖果：向上散开，重力下坠，落地后停留一会儿淡出 */
  function spawnCandies(st, cx, cy, r, W, H, S) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + rand(-1.30, 1.30);   // 主要以「向上」为主的扇形
      const sp = rand(260, 580) * S;
      st.candies.push({
        x: cx + Math.cos(ang) * r * 1.02,
        y: cy + Math.sin(ang) * r * 0.78,
        vx: Math.cos(ang) * sp * rand(0.75, 1.3),
        vy: Math.sin(ang) * sp * rand(0.75, 1.3),
        rot: rand(0, TAU),
        vr: rand(-9, 9),
        s: rand(6.5, 11) * S,
        type: i % 3,
        hue: Math.floor(Math.random() * CANDY_COLORS.length),
        land: H * rand(0.775, 0.842), // 落在卡片按钮之上（0.90 以下是按钮区域）
        state: 0,                     // 0 飞行中 / 1 已落地
        life: 1,
      });
    }
    // 防止点太多次堆一堆
    if (st.candies.length > 90) st.candies.splice(0, st.candies.length - 90);
  }

  /* 底部操作提示（三个场景共用）
     卡片最下方是「我收到啦」按钮，所以提示固定在 0.868H（按钮之上）；
     底下垫一层半透明药丸，压到雪地 / 糖果 / 礼物上也读得清。 */
  function drawHint(ctx, text, W, H, S, color, yK) {
    if (!text) return;
    const fs = 12 * S;
    ctx.save();
    ctx.font = `${fs}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const ph = fs * 1.95, pw = tw + fs * 2.2;
    /* 提示条基线：平时 0.845（与「我收到啦」留出空隙）；
       结算页要往下让一点，否则会压住结果副标题（见 drawResultText 的 baseY 参数）。 */
    const y = H * (yK || 0.845);
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = 'rgba(10,7,20,0.72)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(W * 0.5 - pw / 2, y - ph / 2, pw, ph, ph / 2);
    else ctx.rect(W * 0.5 - pw / 2, y - ph / 2, pw, ph);
    ctx.fill();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = color || '#f4ebff';
    ctx.fillText(text, W * 0.5, y);
    ctx.restore();
  }

  const halloweenHooks = {
    init() {
      return {
        state: 0,          // 0 未点亮 / 1 点亮 / 2 漂浮
        lit: 0,            // 亮灯插值
        float: 0,          // 漂浮插值
        pressT: 0,         // 点击回弹
        bumps: [],         // 点击涟漪
        stars: Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random() * 0.62, r: rand(0.5, 1.5), ph: rand(0, TAU) })),
        /* 20261115：小鬼避开顶部文字区（文字占到 H*0.30 左右），改到中间那一带飘 */
        ghosts: [
          { x: 0.16, y: 0.46, s: 0.085, ph: rand(0, TAU), vx: 0.012, amp: 0.020, sp: 0.7 },
          { x: 0.80, y: 0.56, s: 0.070, ph: rand(0, TAU), vx: -0.009, amp: 0.026, sp: 0.9 },
          { x: 0.62, y: 0.60, s: 0.055, ph: rand(0, TAU), vx: 0.015, amp: 0.016, sp: 1.1 },
          { x: 0.34, y: 0.50, s: 0.050, ph: rand(0, TAU), vx: -0.013, amp: 0.022, sp: 0.8 },
        ],
        /* 20261115：蝙蝠改到文字下方的低空飞——原来在 0.1~0.45 高度，展翅时正好横穿正文，像给文字划了道黑线 */
        bats: Array.from({ length: 3 }, () => ({ x: rand(0.1, 0.9), y: rand(0.46, 0.60), ph: rand(0, TAU), v: rand(0.03, 0.06) })),
        embers: Array.from({ length: 26 }, () => ({ x: Math.random(), y: rand(0.35, 1), v: rand(0.02, 0.06), ph: rand(0, TAU), r: rand(0.8, 2.2) })),
        mx: 0,
        /* 20261115：南瓜是「在整片空里自由飘」，不只是左右一条线。
           pcx/pcy 是当前位置，pcxT/pcyT 是目标位置（点哪儿去哪儿），
           pvx 只用来算飞行时的侧身倾斜。 */
        pcx: null,
        pcxT: null,
        pcy: null,
        pcyT: null,
        pvx: 0,
        candies: [],      // 点南瓜喷出来的糖果（四散 → 落地 → 淡出消失）
      };
    },
    step(st, t, dt, W, H, S) {
      st.lit = approach(st.lit, st.state >= 1 ? 1 : 0, 6, dt);
      st.float = approach(st.float, st.state >= 2 ? 1 : 0, 4.2, dt);
      st.pressT = Math.max(0, st.pressT - dt * 2.6);
      /* 自由漂浮：横纵两个方向都朝目标点趋近（越到后面越慢，像被气流托住停下）。
         速度用来算倾斜角，飞的时候会明显"侧身"，停稳后自动回正。 */
      if (st.pcx == null) { st.pcx = W * 0.5; st.pcxT = W * 0.5; }
      if (st.pcy == null) { st.pcy = H * 0.62; st.pcyT = H * 0.62; }
      const prevPcx = st.pcx;
      st.pcx = approach(st.pcx, st.pcxT, 4.6, dt);
      st.pcy = approach(st.pcy, st.pcyT, 4.0, dt);
      st.pvx = dt > 0 ? (st.pcx - prevPcx) / dt : 0;
      // 糖果物理：先飞（重力抛物线），落地后停留一小会儿再淡出消失
      for (let i = st.candies.length - 1; i >= 0; i--) {
        const c = st.candies[i];
        if (c.state === 0) {
          c.vy += 1250 * S * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.rot += c.vr * dt;
          if (c.y >= c.land) {
            c.y = c.land;
            c.state = 1;
            c.vx *= 0.35; c.vy = 0; c.vr *= 0.2;
            c.life = 1;
          }
        } else {
          c.life -= dt * 0.85;          // 落地后约 1.2 秒开始收
          c.x += c.vx * dt;
          c.vx *= 0.9;
          if (c.life <= 0) st.candies.splice(i, 1);
        }
      }
      // 小鬼横向漂移，出界回环
      for (const gh of st.ghosts) {
        gh.x += gh.vx * dt;
        if (gh.x > 1.12) gh.x = -0.12;
        if (gh.x < -0.12) gh.x = 1.12;
      }
      for (const b of st.bats) {
        b.x += b.v * dt;
        if (b.x > 1.1) { b.x = -0.1; b.y = rand(0.42, 0.54); }
      }
      for (const e of st.embers) {
        e.y -= e.v * dt;
        if (e.y < 0.30) { e.y = 1.02; e.x = Math.random(); }
      }
      for (let i = st.bumps.length - 1; i >= 0; i--) {
        st.bumps[i].r += dt * 1.6;
        st.bumps[i].a -= dt * 1.5;
        if (st.bumps[i].a <= 0) st.bumps.splice(i, 1);
      }
    },
    down(st, x, y, t, W, H, S) {
      // 南瓜的中心与判定半径（与 draw 中的计算保持同一套公式）
      const cx = st.pcx == null ? W * 0.5 : st.pcx;
      const cy = st.pcy == null ? H * 0.68 : st.pcy;
      const r = W * 0.19;
      const onPumpkin = Math.hypot(x - cx, y - (cy + Math.sin(t * 1.6) * 6 * S * st.float)) < r * 1.75;

      /* 已经在漂浮：点哪儿就飘到哪儿 —— 横纵都跟着手指走（这就是"根据手势位置"）。
         纵向限制在「文字下方 ~ 接近地面但碰不到」这一段，所以上下来回都能飘。
         注：卡片底部被「我收到啦」按钮盖住，这里不会再出现"点地面落下"的手势。 */
      if (st.state === 2) {
        const dir = x < cx ? -1 : 1;
        let tx = clamp(x, W * 0.22, W * 0.78);
        // 点得离中心太近，几乎不动 → 给一个最短行程，手感才明显
        if (Math.abs(tx - cx) < W * 0.14) tx = clamp(cx + dir * W * 0.28, W * 0.22, W * 0.78);
        st.pcxT = tx;
        st.pcyT = clamp(y, H * 0.46, H * 0.70);
        if (onPumpkin) {
          st.pressT = 1;
          st.bumps.push({ x, y, r: r * 0.6, a: 0.55 });
          spawnCandies(st, cx, cy + Math.sin(t * 1.6) * 6 * S * st.float, r, W, H, S);
        } else {
          st.bumps.push({ x, y, r: 6 * S, a: 0.35 });
        }
        return;
      }

      if (onPumpkin) {
        st.pressT = 1;
        st.bumps.push({ x, y, r: r * 0.6, a: 0.55 });
        spawnCandies(st, cx, cy + Math.sin(t * 1.6) * 6 * S * st.float, r, W, H, S);  // 每一下都喷糖
        if (st.state === 0) {
          st.state = 1;                              // 第一下：点亮
        } else {
          st.state = 2;                              // 第二下：浮起来
          st.pcxT = cx;
          st.pcyT = H * 0.50;                        // 先升到画面中部，之后就跟着手指走
        }
      } else {
        st.bumps.push({ x, y, r: 6 * S, a: 0.35 });
      }
    },
    draw(st, ctx, t, dt, W, H, S) {
      // —— 夜空
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#160c26');
      sky.addColorStop(0.55, '#2a1440');
      sky.addColorStop(1, '#3a1c48');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // —— 星星
      for (const s of st.stars) {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.3 + s.ph));
        ctx.globalAlpha = tw * 0.85;
        ctx.fillStyle = '#ffe9c9';
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r * S, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // —— 月亮 + 月晕
      const mx = W * 0.80, my = H * 0.17, mr = W * 0.085;
      const mg = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 3.6);
      mg.addColorStop(0, 'rgba(255,238,200,0.42)');
      mg.addColorStop(0.4, 'rgba(255,225,180,0.14)');
      mg.addColorStop(1, 'rgba(255,220,170,0)');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(mx, my, mr * 3.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffeccb';
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
      // 月面淡斑
      ctx.fillStyle = 'rgba(228,205,170,0.35)';
      ctx.beginPath(); ctx.arc(mx - mr * 0.28, my - mr * 0.18, mr * 0.22, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(mx + mr * 0.30, my + mr * 0.24, mr * 0.15, 0, TAU); ctx.fill();

      // —— 蝙蝠剪影
      for (const b of st.bats) {
        const bx = b.x * W, by = b.y * H + Math.sin(t * 2.2 + b.ph) * 6 * S;
        const flap = Math.sin(t * 9 + b.ph);
        ctx.fillStyle = 'rgba(24,14,34,0.75)';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx - 8 * S, by - 6 * S * flap, bx - 14 * S, by + 2 * S);
        ctx.quadraticCurveTo(bx - 7 * S, by + 1 * S, bx, by + 3 * S);
        ctx.quadraticCurveTo(bx + 7 * S, by + 1 * S, bx + 14 * S, by + 2 * S);
        ctx.quadraticCurveTo(bx + 8 * S, by - 6 * S * flap, bx, by);
        ctx.fill();
      }

      // —— 远处雾
      const fog = ctx.createLinearGradient(0, H * 0.55, 0, H);
      fog.addColorStop(0, 'rgba(120,90,170,0)');
      fog.addColorStop(1, 'rgba(120,90,170,0.24)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, H * 0.55, W, H * 0.45);

      // —— 空中飞舞的小鬼（在半透明层，不抢南瓜）
      for (const gh of st.ghosts) {
        const gy = (gh.y + Math.sin(t * gh.sp + gh.ph) * gh.amp) * H;
        drawGhost(ctx, gh.x * W, gy, gh.s * W, t * gh.sp * 1.6 + gh.ph, 0.92);
      }

      // —— 漂浮的橙色光尘
      for (const e of st.embers) {
        ctx.globalAlpha = (0.15 + 0.35 * Math.abs(Math.sin(t + e.ph))) * (0.5 + st.lit * 0.5);
        ctx.fillStyle = '#ffb457';
        ctx.beginPath(); ctx.arc(e.x * W, e.y * H, e.r * S, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // —— 点击涟漪
      for (const b of st.bumps) {
        ctx.globalAlpha = Math.max(0, b.a);
        ctx.strokeStyle = '#ffcf8a';
        ctx.lineWidth = 1.6 * S;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // —— 地面微光（南瓜亮时地面被照亮，跟着南瓜一起移动）
      const pcx = st.pcx == null ? W * 0.5 : st.pcx;
      if (st.lit > 0.01) {
        const gg = ctx.createRadialGradient(pcx, H * 0.875, 0, pcx, H * 0.875, W * 0.5);
        gg.addColorStop(0, `rgba(255,150,60,${0.20 * st.lit})`);
        gg.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.ellipse(pcx, H * 0.875, W * 0.5, H * 0.085, 0, 0, TAU); ctx.fill();
      }

      // —— 南瓜灯本体（自由漂浮：横纵都走 + 上下轻摆 + 点击回弹 + 飞行侧身）
      const pcy = st.pcy == null ? H * 0.68 : st.pcy;
      const bob = Math.sin(t * 1.6) * 6 * S * st.float;
      const cy = pcy + bob;
      const r = W * 0.19 * (1 + st.pressT * 0.06);
      /* 地面投影：南瓜升得越高，影子越小越淡 —— 这样"在整片空里飘"才读得出来，
         否则上下移动时影子不动，会像贴图在平移。 */
      const lift = clamp((H * 0.68 - pcy) / (H * 0.40), 0, 1);
      const shR = r * (1.05 - lift * 0.46);
      ctx.beginPath();
      ctx.ellipse(pcx, H * 0.90, shR, shR * 0.22, 0, 0, TAU);
      ctx.fillStyle = `rgba(10,4,18,${0.42 - lift * 0.24})`;
      ctx.fill();
      // 飞行倾斜：速度越快歪得越多，停稳自动回正
      const tilt = clamp(-st.pvx * 0.00055, -0.30, 0.30) * st.float;
      ctx.save();
      ctx.translate(pcx, cy);
      ctx.rotate(tilt + Math.sin(t * 1.1) * 0.02 * st.float);
      drawPumpkin(ctx, 0, 0, r, st.lit, S);
      ctx.restore();

      // —— 糖果（画在南瓜之后，落地的那层压在最前面）
      for (const c of st.candies) {
        const a = c.state === 0 ? 1 : clamp(c.life * 1.6, 0, 1);
        if (a <= 0.01) continue;
        const sc = c.state === 0 ? 1 : (0.55 + 0.45 * clamp(c.life * 1.6, 0, 1));
        ctx.globalAlpha = a;
        drawCandy(ctx, c.x, c.y, c.s * sc, c.rot, c.type, c.hue);
      }
      ctx.globalAlpha = 1;

      // —— 底部提示
      drawHint(ctx, st.state === 0 ? '点一下南瓜，让它亮起来'
        : st.state === 1 ? '再点一下，让它浮起来'
          : '点画面里任意位置，它会飘过去', W, H, S);
    },
  };

  /* ============================================================
   * 二、平安夜：做一只苹果派（真·小游戏，7 个阶段）
   *
   * 20261115 重做。上一版只有「切 3 刀 → 点一下装盘 → 点一下烤」，
   * 交互太薄、也没有成品形象。这一版按玩家口述拆成：
   *   ① board  切苹果   手指当刀，一刀切下一片；片会飞到旁边的木托上摞起来
   *   ② sugar  撒糖     按住撒糖，松手定格；糖量停在绿区才算好
   *   ③ plate  装盘     片先悬在空中 → 逐片落进派盘 → 网格派皮盖下（过场）
   *   ④ glaze  刷蛋液   按住涂抹，刷得匀不匀决定出炉时的金黄程度
   *   ⑤ toOven 送炉     派盘抬起 → 炉门下拉打开 → 滑进炉膛 → 关门（过场）
   *   ⑥ baking 烘烤     火候全靠玩家点停：生 / 刚好 / 焦糖色 / 烤焦 / 炭
   *   ⑦ done   出炉     成品形象 + 评级；四项都苛刻达标才是「最完美的苹果派」
   *
   * 失败点：切太短变碎渣、糖太多或太少、蛋液没刷匀、火候早了晚了。
   * ============================================================ */

  /* ---------- 颜色工具：分段插值，让烤色随火候连续变化 ---------- */
  function _hex2rgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  /* 两个 #rrggbb 之间按 t（0~1）混色。返回 #rrggbb（不是 rgb()）——
     因为 bakeColor() 的结果还会被再喂进 mixC，若返回 rgb(...) 解析会得到 NaN。 */
  function mixC(a, b, t) {
    const A = _hex2rgb(a), B = _hex2rgb(b);
    t = clamp(t, 0, 1);
    let out = '#';
    for (let i = 0; i < 3; i++) {
      const v = clamp(Math.round(lerp(A[i], B[i], t)), 0, 255);
      out += ('0' + v.toString(16)).slice(-2);
    }
    return out;
  }
  /* 五档烤色光谱：生（奶白）→ 刚好（金黄）→ 焦糖色（琥珀金棕）→ 烤焦（暗褐）→ 炭（近黑）。
     20261115 修正：上一版"焦糖色"直接叠深褐遮罩，看起来像焦黑；
     真正的焦糖色是 #c8862f 这一带的琥珀金棕，还透着亮。 */
  const BAKE_STOPS = ['#e9cfa0', '#e2ab52', '#d18d34', '#9c6730', '#2b2320'];
  function bakeColor(k) {
    k = clamp(k, 0, 4);
    const i = Math.min(3, Math.floor(k));
    return mixC(BAKE_STOPS[i], BAKE_STOPS[i + 1], k - i);
  }
  /* 已烤秒数 → 烤色刻度 0~4（与五档判定的时间点严格对齐，视觉和文案不会打架） */
  function bakeKOf(sec) {
    if (sec <= 0) return 0;
    if (sec < 3.2) return sec / 3.2;
    if (sec < 5.0) return 1 + (sec - 3.2) / 1.8;
    if (sec < 6.3) return 2 + (sec - 5.0) / 1.3;
    if (sec < 7.6) return 3 + (sec - 6.3) / 1.3;
    return 4;
  }
  /* 20261115 改：不再「必须切够 10 片」。
     一个整苹果 ≈ 10 片（EVE_FULL_SLICES），切完还会出现「半个苹果」，最多能切 15 片。
     玩家随时可以点空白处把当前切好的片送进派里 —— 所以片数本身就是一个判定维度：
     切 3 片是「馅料少得可怜」的派，切 15 片是「塞得满满」的派，都能烤，只是结果不同。 */
  const EVE_FULL_SLICES = 10;      // 一个整苹果切出来的片数（标准量）
  const EVE_MAX_SLICES = 15;       // 再加半个苹果，最多能切这么多
  /* 片数 → 切片分。10 片（正好一整个苹果）满分 30，往两边一路递减：
     9/11 差一片 27，8/12 24，7/13 20，再少就是「只有小半个苹果」。
     这张表就是「10 片最完美」的唯一实现，UI 上不写出来，靠金色计数和文案暗示。 */
  const SLICE_SCORE_TBL = [0, 8, 8, 8, 8, 16, 18, 20, 24, 27, 30, 27, 24, 21, 19, 17];
  const EVE_GOLD_A = 3.9;          // 完美火候窗口（秒）
  const EVE_GOLD_B = 4.6;

  /* ---------- 派里苹果片的「码放」槽位（正好 10 个，一片一个位置） ----------
     20261114 修「片落不进派里」：
       原来装盘的落点是用两组互不相干的系数算的（x 乘 0.36、y 乘 0.055），
       而派盘半径只有 0.235W、短轴只有 0.094W —— 落点半径比盘子本身还大，
       片全掉在盘沿上、甚至飞到盘外（玩家截图里飘在盘子边上那一圈就是这么来的）。
     现在统一在「派面椭圆」的参数空间里排版：u/v ∈ [-1, 1]，1.0 正好是派皮内沿，
     再乘一个 0.78 的收边系数，片就稳稳落在派里、不会压到卷边上。
     槽位是写死的常量（不随帧随机），所以「落下动画的终点」「馅层的绘制」
     「成品透过网格看到的片」用的是同一份坐标 —— 片落下去不会跳位置，
     也不会有两套片叠在一起。 */
  const EVE_FILL_SLOTS = (function () {
    /* 三排十片：远排 3、中间 4、近排 3 —— 像真的把片一片一片铺进派底。
       20261114：先试过「环状排布」（中心+内环+外环），但环的角度凑不出正下方，
       派的下沿总空一块，看着像只码了半边。改成分排铺满之后，前后左右都有片。
       这里 u/v 是「派面椭圆」的比例（1.0 = 派皮内沿），绘制时再乘 1.02 / 1.14
       让片稍微塞到卷边底下（多出来的边被卷边压住，正好是「塞满」的感觉）。 */
    return [
      // 朝向是打乱的（不是镜像对称）：对称排出来像一朵菊花，打散才像手一片片摆进去的
      /* 20261115：槽位从 10 个扩到 15 个。
         前 10 个就是原来那一版（切 10 片时铺得刚刚好，与旧版视觉完全一致），
         后 5 个是「补缝位」——正好塞在三排之间的空档里。这样：
           切 10 片 → 铺满一层；切 12 片 → 多两片叠在缝上；切 15 片 → 塞得满满、片压片。
         片数多少直接决定派看起来「满不满」，不用另外画两套排版。 */
      { u: -0.56, v: -0.56, rot: 0.62, s: 0.96 },
      { u: 0.00, v: -0.58, rot: -0.18, s: 0.97 },
      { u: 0.56, v: -0.56, rot: -0.55, s: 0.96 },
      { u: -0.76, v: -0.02, rot: 0.30, s: 0.94 },
      { u: -0.26, v: -0.04, rot: -0.62, s: 0.96 },
      { u: 0.26, v: -0.04, rot: 0.52, s: 0.96 },
      { u: 0.76, v: -0.02, rot: -0.28, s: 0.94 },
      { u: -0.56, v: 0.54, rot: -0.44, s: 0.96 },
      { u: 0.00, v: 0.57, rot: 0.16, s: 0.98 },
      { u: 0.56, v: 0.54, rot: 0.58, s: 0.96 },
      // —— 以下 5 片是第 11~15 片（补在缝上）
      { u: -0.42, v: -0.30, rot: 1.02, s: 0.90 },
      { u: 0.44, v: -0.32, rot: -0.98, s: 0.90 },
      { u: 0.02, v: 0.24, rot: 0.88, s: 0.92 },
      { u: -0.30, v: 0.80, rot: -0.52, s: 0.92 },
      { u: 0.32, v: 0.82, rot: 0.34, s: 0.92 },
    ];
  })();

  /* ---------- 一片切好的苹果：月牙形，外弧红皮、内弧果肉 ---------- */
  function drawAppleSlice(ctx, x, y, r, rot, peel) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // 片身（果肉）
    ctx.beginPath();
    ctx.arc(0, 0, r, -1.02, 1.02, false);
    ctx.quadraticCurveTo(r * 0.30, 0, r * Math.cos(-1.02), r * Math.sin(-1.02));
    ctx.closePath();
    const g = ctx.createLinearGradient(-r * 0.2, -r, r * 0.5, r);
    g.addColorStop(0, '#fff8e2');
    g.addColorStop(0.58, '#f6e7bb');
    g.addColorStop(1, '#e6cf96');
    ctx.fillStyle = g;
    ctx.fill();
    // 外弧那一条果皮（比整片轮廓更接近真实切面）
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.88, -0.98, 0.98, false);
    ctx.lineWidth = r * 0.24;
    ctx.strokeStyle = peel || '#cf3a2e';
    ctx.lineCap = 'round';
    ctx.stroke();
    // 果肉纤维高光
    ctx.beginPath();
    ctx.arc(r * 0.06, 0, r * 0.50, -0.70, 0.70, false);
    ctx.lineWidth = r * 0.10;
    ctx.strokeStyle = 'rgba(255,255,255,0.40)';
    ctx.stroke();
    ctx.restore();
  }

  /* 苹果轮廓：左右两瓣「肩膀」+ 顶部凹槽 + 底部圆收。
     单独抽出来是因为「填色」和「裁剪高光」都要用同一条路径，
     原来那段贝塞尔画出来更像心形，不像苹果。 */
  function applePath(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.56);                              // 顶部凹槽
    ctx.bezierCurveTo(r * 0.30, -r * 1.02, r * 1.00, -r * 0.92, r * 1.02, -r * 0.10); // 右肩
    ctx.bezierCurveTo(r * 1.05, r * 0.52, r * 0.50, r * 1.00, r * 0.16, r * 0.92);    // 右下
    ctx.bezierCurveTo(r * 0.06, r * 0.98, -r * 0.06, r * 0.98, -r * 0.16, r * 0.92);  // 底部小凹
    ctx.bezierCurveTo(-r * 0.50, r * 1.00, -r * 1.05, r * 0.52, -r * 1.02, -r * 0.10); // 左下
    ctx.bezierCurveTo(-r * 1.00, -r * 0.92, -r * 0.30, -r * 1.02, 0, -r * 0.56);      // 左肩
    ctx.closePath();
  }

  /* 画一个「标准苹果」：红皮 + 上亮下暗 + 顶部凹槽 + 果柄 + 叶子 + 高光 */
  function drawApple(ctx, x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);

    // —— 果身底色（左上光源）
    const g = ctx.createRadialGradient(-r * 0.38, -r * 0.46, r * 0.06, r * 0.05, r * 0.10, r * 1.30);
    g.addColorStop(0, '#ff9a7e');
    g.addColorStop(0.24, '#fa4b36');
    g.addColorStop(0.62, '#d32222');
    g.addColorStop(0.88, '#9d1216');
    g.addColorStop(1, '#7c0e13');
    ctx.fillStyle = g;
    applePath(ctx, r);
    ctx.fill();

    // —— 内阴影：右侧压暗，做出球感（裁剪在果身里，不会溢出）
    ctx.save();
    applePath(ctx, r);
    ctx.clip();
    const sh = ctx.createLinearGradient(r * 0.15, 0, r * 1.05, 0);
    sh.addColorStop(0, 'rgba(90,10,14,0)');
    sh.addColorStop(1, 'rgba(70,6,10,0.55)');
    ctx.fillStyle = sh;
    ctx.fillRect(-r * 1.1, -r * 1.1, r * 2.2, r * 2.2);
    // 底部一点偏黄（真实红苹果下侧会转黄）
    const yl = ctx.createRadialGradient(0, r * 0.88, 0, 0, r * 0.88, r * 0.7);
    yl.addColorStop(0, 'rgba(230,170,60,0.28)');
    yl.addColorStop(1, 'rgba(230,170,60,0)');
    ctx.fillStyle = yl;
    ctx.fillRect(-r * 1.1, -r * 1.1, r * 2.2, r * 2.2);
    // 高光（一大一小，沿着左上弧）
    ctx.fillStyle = 'rgba(255,242,232,0.55)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.42, -r * 0.38, r * 0.20, r * 0.33, -0.52, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.60, r * 0.06, r * 0.09, r * 0.14, -0.35, 0, TAU);
    ctx.fill();
    ctx.restore();

    // —— 顶部凹槽（两肩之间那道深色的窝）
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.60, r * 0.26, r * 0.11, 0, 0, TAU);
    ctx.fillStyle = 'rgba(96,12,16,0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.575, r * 0.20, r * 0.06, 0, Math.PI, TAU);
    ctx.fillStyle = 'rgba(255,190,170,0.28)';
    ctx.fill();

    // —— 果柄
    ctx.strokeStyle = '#6d4526';
    ctx.lineWidth = Math.max(1.6, r * 0.082);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.58);
    ctx.quadraticCurveTo(r * 0.10, -r * 0.98, r * 0.05, -r * 1.20);
    ctx.stroke();

    // —— 叶子（两段贝塞尔拼的尖叶，不是椭圆）
    ctx.save();
    ctx.translate(r * 0.06, -r * 1.06);
    ctx.rotate(-0.42);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(r * 0.26, -r * 0.30, r * 0.62, -r * 0.26, r * 0.72, -r * 0.06);
    ctx.bezierCurveTo(r * 0.56, r * 0.14, r * 0.22, r * 0.14, 0, 0);
    ctx.closePath();
    const lg = ctx.createLinearGradient(0, -r * 0.2, r * 0.7, r * 0.1);
    lg.addColorStop(0, '#6fae4e');
    lg.addColorStop(1, '#356b2c');
    ctx.fillStyle = lg;
    ctx.fill();
    // 叶脉
    ctx.strokeStyle = 'rgba(28,60,22,0.55)';
    ctx.lineWidth = Math.max(0.8, r * 0.032);
    ctx.beginPath();
    ctx.moveTo(r * 0.04, -r * 0.01);
    ctx.quadraticCurveTo(r * 0.34, -r * 0.13, r * 0.66, -r * 0.06);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  /* 被切过的苹果：右边被一片片削掉，留一个竖直的平面。
     20261114 玩家指出「谁家从苹果上片苹果是这样的」——原来是把整只苹果按比例缩小，
     再往果身上贴三块椭圆当作切面，等于「苹果变小了但没少一块」，一眼就假。
     真实情况是：果身被削平了一面。所以这里把果身裁到切面左边，再在切口画切面本身。 */
  function drawCutApple(ctx, x, y, r, cutK, rot) {
    const k = clamp(cutK, 0, 1);
    const fx = r * (1.06 - k * 1.30);          // 切面所在的 x（相对果心）：切得越多越往左退
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);

    // ① 果身：只画切面左边的部分（右侧被削掉了）
    ctx.save();
    ctx.beginPath();
    ctx.rect(-r * 2.2, -r * 2.2, fx + r * 2.2, r * 4.4);
    ctx.clip();
    drawApple(ctx, 0, 0, r, 0);
    // 切口内侧压一道暗边，让平面「陷」进去，不然像剪贴
    const cs = ctx.createLinearGradient(fx - r * 0.22, 0, fx, 0);
    cs.addColorStop(0, 'rgba(70,8,12,0)');
    cs.addColorStop(1, 'rgba(70,8,12,0.42)');
    ctx.fillStyle = cs;
    ctx.fillRect(fx - r * 0.24, -r * 1.1, r * 0.26, r * 2.2);
    ctx.restore();

    // ② 切面：透视下是个竖长的椭圆。高度按「这一刀落在哪儿」算 ——
    //    靠边的刀口只露出一小片，切到中间才是一整面，这样一刀比一刀更明显。
    if (k > 0.004) {
      const u = clamp(fx / (r * 1.04), -0.97, 0.97);
      const halfH = r * Math.sqrt(Math.max(0, 1 - u * u)) * 0.94 + r * 0.05;
      const rx = r * (0.16 - k * 0.055);
      const cxf = fx - rx * 0.42;

      ctx.save();
      // 果肉
      const fg = ctx.createLinearGradient(cxf - rx, 0, cxf + rx, 0);
      fg.addColorStop(0, '#f8ecca');
      fg.addColorStop(0.45, '#f2e0b0');
      fg.addColorStop(1, '#dfc48c');
      ctx.beginPath();
      ctx.ellipse(cxf, 0, rx, halfH, 0, 0, TAU);
      ctx.fillStyle = fg;
      ctx.fill();
      // 果核（靠中间那几刀才有）：一小块偏黄的心 + 两粒籽
      if (Math.abs(u) < 0.55) {
        const coreR = 0.55 + 0.45 * (1 - Math.abs(u) / 0.55);
        ctx.beginPath();
        ctx.ellipse(cxf - rx * 0.10, r * 0.02, rx * 0.42 * coreR, halfH * 0.42 * coreR, 0, 0, TAU);
        ctx.fillStyle = 'rgba(228,204,148,0.9)';
        ctx.fill();
        ctx.fillStyle = '#4a2f16';
        ctx.beginPath();
        ctx.ellipse(cxf - rx * 0.26, -halfH * 0.13, rx * 0.15, halfH * 0.075, -0.55, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cxf + rx * 0.20, halfH * 0.15, rx * 0.15, halfH * 0.075, 0.55, 0, TAU);
        ctx.fill();
      }
      // 红皮边：切口一圈薄薄的暗红，说明这是「皮被削开」而不是白墩墩一块
      ctx.strokeStyle = 'rgba(168,22,26,0.78)';
      ctx.lineWidth = Math.max(1, r * 0.026);
      ctx.beginPath();
      ctx.ellipse(cxf, 0, rx, halfH, 0, 0, TAU);
      ctx.stroke();
      // 汁水高光：一道竖着的淡白
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(cxf - rx * 0.28, -halfH * 0.26, rx * 0.16, halfH * 0.30, 0.06, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else {
      // 还没切：切口处什么也不画（整只苹果）
    }

    ctx.restore();
  }

  /* ---------- 圆木砧板（俯视） ---------- */
  function drawBoard(ctx, cx, cy, rx, ry, S) {
    // 落在台面上的投影
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.30, rx * 1.00, ry * 0.78, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fill();
    // 板身厚度
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.18, rx, ry, 0, 0, TAU);
    ctx.fillStyle = '#4a2c16';
    ctx.fill();
    // 板面
    const wg = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
    wg.addColorStop(0, '#a97243');
    wg.addColorStop(1, '#74452a');
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fillStyle = wg;
    ctx.fill();
    // 同心木纹
    ctx.strokeStyle = 'rgba(70,42,22,0.24)';
    ctx.lineWidth = 1.1 * S;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * (i / 4.6), ry * (i / 4.6), 0, 0, TAU);
      ctx.stroke();
    }
    // 上缘高光
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.99, ry * 0.99, 0, Math.PI * 1.06, Math.PI * 1.94);
    ctx.strokeStyle = 'rgba(255,216,164,0.24)';
    ctx.lineWidth = 2 * S;
    ctx.stroke();
  }

  /* ---------- 旁边的木托盘：切好的片摞在这里 ---------- */
  function drawTray(ctx, cx, cy, rx, ry, S) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.34, rx * 1.02, ry * 0.72, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.20, rx, ry, 0, 0, TAU);
    ctx.fillStyle = '#4f301a';
    ctx.fill();
    const g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
    g.addColorStop(0, '#b07c4c');
    g.addColorStop(1, '#7d4f2d');
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    // 盘沿
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.80, ry * 0.78, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(255,220,170,0.20)';
    ctx.lineWidth = 1.6 * S;
    ctx.stroke();
  }

  /* ---------- 馅里的苹果片：细长月牙，比案板上那片更薄、更有肉感 ----------
     案板阶段的 drawAppleSlice 张角 117°，画的是「一片刚切下来的苹果」，看着饱满；
     可躺进派里的片要细、要长，才像一层层码起来的切片，所以单独画一个：
     外弧 + 内弧收成月牙，径向渐变（果心侧白、果皮侧深），再加两道果肉纤维。 */
  function drawFillingSlice(ctx, sr, flesh, edge) {
    ctx.beginPath();
    ctx.arc(0, 0, sr, -0.92, 0.92, false);
    ctx.quadraticCurveTo(sr * 0.50, 0, sr * Math.cos(-0.92), sr * Math.sin(-0.92));
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, sr * 0.38, 0, 0, sr * 1.02);
    g.addColorStop(0, '#fdf7e6');
    g.addColorStop(0.55, flesh);
    g.addColorStop(1, edge);
    ctx.fillStyle = g;
    ctx.fill();

    // 果肉纤维：沿径向两道细线（切片才有的那种纹路）
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = Math.max(0.6, sr * 0.05);
    for (let i = -1; i <= 1; i++) {
      const a = i * 0.34;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * sr * 0.44, Math.sin(a) * sr * 0.44);
      ctx.lineTo(Math.cos(a) * sr * 0.93, Math.sin(a) * sr * 0.93);
      ctx.stroke();
    }

    // 外弧那道边：削皮之后烤成焦糖色的那一线
    ctx.beginPath();
    ctx.arc(0, 0, sr * 0.955, -0.92, 0.92, false);
    ctx.lineWidth = Math.max(1, sr * 0.10);
    ctx.strokeStyle = edge;
    ctx.stroke();
  }

  /* 一片「躺平」的苹果片：馅层和装盘下落共用同一个入口。
     20261114：之前空中的片用带红皮的 drawAppleSlice、落进派里却换成削皮的，
     落地那一下颜色会突变；统一到这一个函数之后，落下去前后是同一片。 */
  function drawWedge(ctx, sr, rot, flesh, edge) {
    ctx.save();
    ctx.rotate(rot);
    ctx.scale(1, 0.70);                       // 俯视压扁：片是平躺着的
    drawFillingSlice(ctx, sr, flesh, edge);
    ctx.restore();
  }

  /* ---------- 馅：苹果片整整齐齐码在派皮里 ----------
     n = 已经码进去的片数（0~10）。装盘时每落一片 n 加一，所以「落下来」和
     「最后成品的馅」是同一份位置、同一份画法 —— 片不会落到别处，也不会跳。
     画在网格皮下面：网格条之间的空隙就是透过派皮看到的苹果馅。 */
  function drawAppleFilling(ctx, cx, cy, r, ry, n, k, sugared) {
    const cnt = Math.max(0, Math.min(EVE_FILL_SLOTS.length, Math.round(n)));
    if (cnt <= 0) return;
    const baked = clamp(k / 4, 0, 1);          // 烤的程度：片从奶白慢慢烤成琥珀

    // ① 馅底色：熬过的苹果酱（焦糖化），中心受光、边缘压暗
    const fg = ctx.createRadialGradient(cx - r * 0.14, cy - ry * 0.34, r * 0.05, cx, cy, r * 1.00);
    fg.addColorStop(0, mixC('#b3711f', '#77400c', baked * 0.55));
    fg.addColorStop(0.60, mixC('#8f5013', '#4f2406', baked * 0.55));
    fg.addColorStop(1, mixC('#68360c', '#2e1403', baked * 0.55));
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.955, ry * 0.955, 0, 0, TAU);
    ctx.fillStyle = fg;
    ctx.fill();

    // ② 片：按 v（纵向位置）从远到近画 —— 前面的片压住后面的片，才像一层层码上去
    const order = [];
    for (let i = 0; i < cnt; i++) order.push(i);
    order.sort((a, b) => EVE_FILL_SLOTS[a].v - EVE_FILL_SLOTS[b].v);

    for (const i of order) {
      const s = EVE_FILL_SLOTS[i];
      const px = cx + s.u * r * 1.02;
      const py = cy + s.v * ry * 1.14;
      const sr = r * 0.315 * s.s;
      ctx.save();
      ctx.translate(px, py);
      ctx.beginPath();
      ctx.ellipse(sr * 0.06, sr * 0.16, sr * 0.90, sr * 0.46, 0.10, 0, TAU);
      ctx.fillStyle = 'rgba(62,28,4,0.34)';   // 片身下的接触阴影（片与片之间那道缝靠它撑出层次）
      ctx.fill();
      // 果肉：没烤透时奶白，烤过转琥珀；外弧那道边是削皮后烤上的焦糖色
      const flesh = baked <= 0.04 ? '#f8ebc9' : mixC('#f8ebc9', '#e0a457', baked);
      const edge = baked <= 0.04 ? '#e5cd9a' : mixC('#e5cd9a', '#b06b26', baked);
      drawWedge(ctx, sr, s.rot, flesh, edge);
      ctx.restore();
    }

    // ③ 撒过糖 → 馅面上那层细糖粒（用黄金角撒，均匀又不呆板；位置固定不会每帧乱跳）
    if (sugared) {
      for (let i = 0; i < 30; i++) {
        const a = i * 2.399963;                // 黄金角
        const rr = Math.sqrt((i + 0.5) / 30) * 0.86;
        const sx = cx + Math.cos(a) * r * rr;
        const sy = cy + Math.sin(a) * ry * rr;
        ctx.globalAlpha = 0.42 + 0.30 * ((i * 7) % 5) / 5;
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.7, r * 0.011), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ④ 焦糖油光：烤过之后馅表面会亮，沿左上弧带一道
    if (baked > 0.15) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.95, ry * 0.95, 0, 0, TAU);
      ctx.clip();
      const sg = ctx.createRadialGradient(cx - r * 0.34, cy - ry * 0.40, 0, cx - r * 0.20, cy - ry * 0.20, r * 0.85);
      sg.addColorStop(0, 'rgba(255,214,140,' + (0.30 * baked).toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(cx - r, cy - ry, r * 2, ry * 2);
      ctx.restore();
    }
  }

  /* ---------- 盘子 + 派（整段里最要紧的一个函数） ----------
     20261115 修穿模：原来「盘面椭圆」和「派顶椭圆」颜色几乎一样，又没画派侧壁，
     两个半圆叠在一起根本看不出谁托着谁。现在固定分层，且盘半径比派大一圈：
       桌面投影 → 盘壁（底椭圆，暗） → 盘面（瓷白亮） → 派壁（底椭圆，深金）
       → 派顶（金） → 网格条 → 卷边 → 光泽。
     因为先画盘、再画派，派天然坐在盘中央，露出来的那一圈就是盘沿。 */
  function drawDish(ctx, cx, cy, r, opt) {
    opt = opt || {};
    const k = opt.k || 0;                                // 烤色刻度 0~4
    const depth = r * 0.26;                              // 派的高度（侧壁）
    const panRx = r * 1.30, panRy = r * 0.50;
    const panCy = cy + r * 0.17;
    const panDepth = r * 0.09;
    const ry = r * 0.40;

    // ① 桌面投影
    ctx.beginPath();
    ctx.ellipse(cx, panCy + panDepth + r * 0.10, panRx * 1.00, panRy * 0.40, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fill();

    // ② 盘壁：底椭圆（暗瓷）—— 让盘子有厚度，不是一张贴纸
    ctx.beginPath();
    ctx.ellipse(cx, panCy + panDepth, panRx, panRy, 0, 0, TAU);
    const pw = ctx.createLinearGradient(0, panCy - panRy, 0, panCy + panDepth + panRy);
    pw.addColorStop(0, '#d8d1c5');
    pw.addColorStop(1, '#a49a8d');
    ctx.fillStyle = pw;
    ctx.fill();

    // ③ 盘面：顶椭圆（瓷白）
    ctx.beginPath();
    ctx.ellipse(cx, panCy, panRx, panRy, 0, 0, TAU);
    const pf = ctx.createRadialGradient(cx - panRx * 0.30, panCy - panRy * 0.45, r * 0.08, cx, panCy, panRx);
    pf.addColorStop(0, '#fffdf9');
    pf.addColorStop(0.55, '#f3eee4');
    pf.addColorStop(1, '#dcd3c4');
    ctx.fillStyle = pf;
    ctx.fill();
    // 盘沿内圈细线（一眼看出这是个盘子）
    ctx.beginPath();
    ctx.ellipse(cx, panCy, panRx * 0.90, panRy * 0.90, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(168,158,146,0.42)';
    ctx.lineWidth = Math.max(1, r * 0.016);
    ctx.stroke();

    // ④ 派壁：底椭圆（深金）—— 这一层就是修穿模的关键，派是有厚度的
    ctx.beginPath();
    ctx.ellipse(cx, cy + depth, r, ry, 0, 0, TAU);
    ctx.fillStyle = mixC(bakeColor(k), '#6f4218', 0.34);
    ctx.fill();
    // 派壁下缘再压一道更深的边，做出"底的圆角"
    ctx.beginPath();
    ctx.ellipse(cx, cy + depth * 0.92, r * 0.99, ry * 0.99, 0, Math.PI * 0.06, Math.PI * 0.94);
    ctx.strokeStyle = mixC(bakeColor(k), '#4a2808', 0.52);
    ctx.lineWidth = Math.max(1.4, r * 0.05);
    ctx.stroke();

    // ⑤ 派顶：烤色椭圆
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, ry, 0, 0, TAU);
    const tg = ctx.createRadialGradient(cx - r * 0.30, cy - ry * 0.45, r * 0.10, cx, cy, r * 1.05);
    tg.addColorStop(0, mixC(bakeColor(k), '#fff2cf', 0.26));
    tg.addColorStop(0.62, bakeColor(k));
    tg.addColorStop(1, mixC(bakeColor(k), '#5a3208', 0.22));
    ctx.fillStyle = tg;
    ctx.fill();

    // 派顶外缘描一道深色边：生派皮和瓷盘都是浅色，没有这道边就看不出「派」和「盘」的边界
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.995, ry * 0.995, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(120,80,30,0.32)';
    ctx.lineWidth = Math.max(1, r * 0.02);
    ctx.stroke();

    // ⑥ 苹果馅：整整齐齐码好的苹果片（opt.fill 0~1 = 码进去几成）
    if (opt.fill > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.955, ry * 0.955, 0, 0, TAU);   // 收一点，给卷边留位置
      ctx.clip();
      drawAppleFilling(ctx, cx, cy, r, ry,
        clamp(opt.fill, 0, 1) * EVE_FILL_SLOTS.length, k, !!opt.sugared);
      ctx.restore();
    }

    // ⑦ 网格派皮（opt.lattice: 0~1 盖上程度）
    if (opt.lattice) {
      const lat = clamp(opt.lattice, 0, 1);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.995, ry * 0.995, 0, 0, TAU);
      ctx.clip();
      ctx.globalAlpha = lat;
      /* 20261114 修「苹果派上没有苹果片」：
         原来这里铺了整块 #6b3a12 的深棕，把下面刚码好的苹果馅、苹果片全盖实了，
         于是成品只剩下一个光板深棕色 —— 玩家看到的就是「派上没有苹果片」。
         网格皮之间的空隙本来就应该透出馅，所以这里只压一层很淡的暗色
         （模拟派内部的阴影），不再用实色整块覆盖。 */
      ctx.fillStyle = 'rgba(52,22,4,' + (0.20 + 0.12 * clamp(k / 4, 0, 1)).toFixed(3) + ')';
      ctx.fillRect(cx - r, cy - ry, r * 2, ry * 2);
      // 卷边内侧再压一圈内阴影：格子里才有「凹下去」的深度，不像贴纸
      const ig = ctx.createRadialGradient(cx, cy, r * 0.52, cx, cy, r * 0.99);
      ig.addColorStop(0, 'rgba(40,16,2,0)');
      ig.addColorStop(1, 'rgba(40,16,2,' + (0.28 * lat).toFixed(3) + ')');
      ctx.fillStyle = ig;
      ctx.fillRect(cx - r, cy - ry, r * 2, ry * 2);
      const stripW = Math.max(2.2, r * 0.098);
      const step = r * 0.46;
      // 第 1 组（压在下面，偏暗）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(0.52);
      ctx.strokeStyle = mixC(bakeColor(k), '#5c3008', 0.30);
      ctx.lineWidth = stripW;
      ctx.lineCap = 'butt';
      for (let i = -3; i <= 3; i++) {
        const yy = i * step;
        ctx.beginPath(); ctx.moveTo(-r * 1.15, yy); ctx.lineTo(r * 1.15, yy); ctx.stroke();
      }
      ctx.restore();
      // 第 2 组（压在上面，偏亮 + 一条高光边，看起来就像编起来的）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.52);
      for (let i = -3; i <= 3; i++) {
        const yy = i * step;
        ctx.strokeStyle = mixC(bakeColor(k), '#3f2204', 0.32);
        ctx.lineWidth = stripW * 1.18;
        ctx.beginPath(); ctx.moveTo(-r * 1.15, yy); ctx.lineTo(r * 1.15, yy); ctx.stroke();
        ctx.strokeStyle = mixC(bakeColor(k), '#fff4d0', 0.26);
        ctx.lineWidth = stripW * 1.02;
        ctx.beginPath(); ctx.moveTo(-r * 1.15, yy); ctx.lineTo(r * 1.15, yy); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,240,200,0.24)';
        ctx.lineWidth = Math.max(1, stripW * 0.16);
        ctx.beginPath(); ctx.moveTo(-r * 1.15, yy - stripW * 0.34); ctx.lineTo(r * 1.15, yy - stripW * 0.34); ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ⑧ 卷边（最上层）：粗环 + 褶皱。派皮卷起来那圈才是它"成形"的样子
    const rimC = mixC(bakeColor(k), '#7d4a12', 0.26);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.965, ry * 0.955, 0, 0, TAU);
    ctx.strokeStyle = rimC;
    ctx.lineWidth = Math.max(3, r * 0.135);
    ctx.stroke();
    // 褶皱：沿椭圆压一串小弧，像手指捏出来的花边
    ctx.strokeStyle = mixC(rimC, '#3a1f04', 0.35);
    ctx.lineWidth = Math.max(1.2, r * 0.03);
    const kn = 26;
    for (let i = 0; i < kn; i++) {
      const a0 = (i / kn) * TAU;
      const a1 = a0 + (TAU / kn) * 0.55;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.965, ry * 0.955, 0, a0, a1);
      ctx.stroke();
    }
    // 卷边上缘的一点高光（受光面）
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.012, r * 0.965, ry * 0.955, 0, Math.PI * 1.12, Math.PI * 1.88);
    ctx.strokeStyle = mixC(bakeColor(k), '#fff0cc', 0.55);
    ctx.lineWidth = Math.max(1.2, r * 0.045);
    ctx.stroke();

    // ⑨ 蛋液光泽（opt.glaze: 0~1 刷到多少）
    if (opt.glaze) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.99, ry * 0.99, 0, 0, TAU);
      ctx.clip();
      const gz = Math.min(1, opt.glaze);
      const gg = ctx.createRadialGradient(cx - r * 0.34, cy - ry * 0.55, 0, cx, cy, r * 1.15);
      gg.addColorStop(0, 'rgba(255,238,186,' + (0.42 * gz).toFixed(3) + ')');
      gg.addColorStop(0.45, 'rgba(255,196,96,' + (0.18 * gz).toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(120,60,10,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(cx - r, cy - ry, r * 2, ry * 2);
      // 几道油亮反光
      ctx.strokeStyle = 'rgba(255,246,214,' + (0.30 * gz).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, r * 0.035);
      for (let i = 0; i < 4; i++) {
        const ox = cx + Math.cos(1.1 + i * 1.5) * r * 0.46;
        const oy = cy + Math.sin(1.1 + i * 1.5) * ry * 0.46;
        ctx.beginPath();
        ctx.ellipse(ox, oy, r * 0.16, ry * 0.20, -0.5, Math.PI * 1.05, Math.PI * 1.72);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ⑩ 烤过头的黑斑（k > 2.6 才出现，位置固定，不然每帧乱跳）
    if (k > 2.6) {
      const bn = clamp((k - 2.6) / 1.4, 0, 1);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.99, ry * 0.99, 0, 0, TAU);
      ctx.clip();
      const SPOTS = [[-0.52, -0.32, 0.20], [0.18, -0.46, 0.15], [0.58, 0.10, 0.18],
                     [-0.24, 0.34, 0.16], [0.06, 0.08, 0.22], [-0.66, 0.18, 0.12], [0.36, -0.10, 0.13]];
      for (let i = 0; i < SPOTS.length; i++) {
        const sp = SPOTS[i];
        ctx.globalAlpha = 0.42 * bn;
        ctx.fillStyle = '#231a14';
        ctx.beginPath();
        ctx.ellipse(cx + sp[0] * r, cy + sp[1] * ry * 2.2, r * sp[2] * bn, ry * sp[2] * 0.9 * bn, sp[0], 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  /* ---------- 烤箱（含下拉炉门；toOven 过场与烘烤共用） ---------- */
  function drawOven(ctx, W, H, S, opt) {
    opt = opt || {};
    const ox = W * 0.14, ow = W * 0.72;
    const oy = H * 0.400, oh = H * 0.295;   // 20261115：底部要留给寄语和「我收到啦」，烤箱整体上移
    const door = clamp(opt.door || 0, 0, 1);      // 0 关 1 全开
    const heat = clamp(opt.heat == null ? 0 : opt.heat, 0, 1);

    // 机身
    const og = ctx.createLinearGradient(ox, oy, ox, oy + oh);
    og.addColorStop(0, '#403c47');
    og.addColorStop(1, '#232128');
    ctx.fillStyle = og;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ox, oy, ow, oh, 16 * S); else ctx.rect(ox, oy, ow, oh);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1.4 * S;
    ctx.stroke();

    // 玻璃窗
    const gx = ox + ow * 0.10, gy = oy + oh * 0.14, gw = ow * 0.80, gh = oh * 0.60;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(gx, gy, gw, gh, 10 * S); else ctx.rect(gx, gy, gw, gh);
    ctx.clip();
    // 炉内亮度：随温度升高
    const ig = ctx.createRadialGradient(gx + gw * 0.5, gy + gh * 0.72, 0, gx + gw * 0.5, gy + gh * 0.72, gw * 0.80);
    ig.addColorStop(0, 'rgba(255,176,78,' + (0.22 + heat * 0.66).toFixed(3) + ')');
    ig.addColorStop(0.55, 'rgba(196,88,30,' + (0.10 + heat * 0.38).toFixed(3) + ')');
    ig.addColorStop(1, 'rgba(28,16,10,0.97)');
    ctx.fillStyle = ig;
    ctx.fillRect(gx, gy, gw, gh);

    // 烤架
    ctx.strokeStyle = 'rgba(196,186,176,0.28)';
    ctx.lineWidth = 2 * S;
    for (let i = 0; i < 3; i++) {
      const yy = gy + gh * (0.28 + i * 0.26);
      ctx.beginPath(); ctx.moveTo(gx + gw * 0.06, yy); ctx.lineTo(gx + gw * 0.94, yy); ctx.stroke();
    }
    // 光点（火星）
    if (opt.sparks) {
      for (const p of opt.sparks) {
        ctx.globalAlpha = Math.max(0, p.a) * 0.85;
        ctx.fillStyle = '#ffcf7a';
        ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r * S, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 窗框
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.6 * S;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(gx, gy, gw, gh, 10 * S); else ctx.rect(gx, gy, gw, gh);
    ctx.stroke();
    // 玻璃反光
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(gx, gy, gw, gh, 10 * S); else ctx.rect(gx, gy, gw, gh);
    ctx.clip();
    const rf = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
    rf.addColorStop(0, 'rgba(255,255,255,0.12)');
    rf.addColorStop(0.42, 'rgba(255,255,255,0)');
    ctx.fillStyle = rf;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.restore();

    // 下拉炉门：门板从窗下沿往下翻（door 0→1，翻 90°）
    const dh = oh * 0.78;
    const ang = door * (Math.PI / 2);
    if (door > 0.001) {
      ctx.save();
      ctx.translate(gx, gy + gh);
      // 门板按透视压扁：sin 越大（开得越平）越薄
      const flat = Math.cos(ang * 0.92);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(gw, 0);
      ctx.lineTo(gw, dh * flat);
      ctx.lineTo(0, dh * flat);
      ctx.closePath();
      const dg = ctx.createLinearGradient(0, 0, 0, dh * flat);
      dg.addColorStop(0, '#4b4652');
      dg.addColorStop(1, '#2a2730');
      ctx.fillStyle = dg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.2 * S;
      ctx.stroke();
      // 门上的把手（跟着门板一起翻）
      ctx.strokeStyle = 'rgba(222,216,208,0.55)';
      ctx.lineWidth = 3.4 * S;
      ctx.lineCap = 'round';
      const hy = dh * flat * 0.62;
      ctx.beginPath();
      ctx.moveTo(gw * 0.30, hy);
      ctx.lineTo(gw * 0.70, hy);
      ctx.stroke();
      ctx.restore();
    }

    // 关闭状态的门板（door 接近 0 时显示）
    if (door < 0.02) {
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(gx, gy, gw, gh, 10 * S); else ctx.rect(gx, gy, gw, gh);
      const dg2 = ctx.createLinearGradient(gx, gy, gx, gy + gh);
      dg2.addColorStop(0, 'rgba(38,34,44,0.55)');
      dg2.addColorStop(1, 'rgba(24,22,30,0.86)');
      ctx.fillStyle = dg2;
      ctx.fill();
      ctx.strokeStyle = 'rgba(220,214,206,0.42)';
      ctx.lineWidth = 3 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(gx + gw * 0.32, gy + gh * 0.16);
      ctx.lineTo(gx + gw * 0.68, gy + gh * 0.16);
      ctx.stroke();
      ctx.restore();
    }

    // 旋钮
    ctx.fillStyle = 'rgba(190,184,178,0.35)';
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(ox + ow * (0.22 + i * 0.14), oy + oh * 0.90, 5.5 * S, 0, TAU);
      ctx.fill();
    }
    return { gx: gx, gy: gy, gw: gw, gh: gh };
  }

  /* ---------- 火候条：五档色块 + 完美窗口白框 + 指针 ---------- */
  function drawBakeBar(ctx, W, H, S, sec, running) {
    const bx = W * 0.12, bw = W * 0.76, by = H * 0.736, bh = 10 * S;   // 20261115：原 0.812 落在寄语与按钮之间，现在贴到烤箱下方
    const segs = [
      [0, 3.2, '#efe3c8'],      // 生
      [3.2, 5.0, '#e0a94f'],    // 刚好
      [5.0, 6.3, '#c8862f'],    // 焦糖色
      [6.3, 7.6, '#8a5a2e'],    // 烤焦
      [7.6, 8.6, '#241d19'],    // 炭
    ];
    const T = 8.6;
    for (const sg of segs) {
      ctx.fillStyle = sg[2];
      ctx.fillRect(bx + bw * (sg[0] / T), by, bw * ((sg[1] - sg[0]) / T) + 0.5, bh);
    }
    // 圆角裁一下
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bh / 2); else ctx.rect(bx, by, bw, bh);
    ctx.clip();
    for (const sg of segs) {
      ctx.fillStyle = sg[2];
      ctx.fillRect(bx + bw * (sg[0] / T), by, bw * ((sg[1] - sg[0]) / T) + 0.5, bh);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1 * S;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bh / 2); else ctx.rect(bx, by, bw, bh);
    ctx.stroke();

    // 完美窗口（苛刻条件：只有这 0.7 秒算满分）
    const gx0 = bx + bw * (EVE_GOLD_A / T), gx1 = bx + bw * (EVE_GOLD_B / T);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.6 * S;
    ctx.strokeRect(gx0, by - 2 * S, gx1 - gx0, bh + 4 * S);

    // 档位小字
    ctx.font = (8.5 * S) + 'px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const labels = ['生', '刚好', '焦糖', '烤焦', '炭'];
    const centers = [1.6, 4.1, 5.65, 6.95, 8.1];
    for (let i = 0; i < labels.length; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText(labels[i], bx + bw * (centers[i] / T), by - 5 * S);
    }

    // 指针
    const px = bx + bw * clamp(sec / T, 0, 1);
    ctx.fillStyle = running ? '#ffffff' : 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(px, by - 4 * S);
    ctx.lineTo(px - 5 * S, by - 12 * S);
    ctx.lineTo(px + 5 * S, by - 12 * S);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(px - 1.4 * S, by - 4 * S, 2.8 * S, bh + 6 * S);
  }

  /* ---------- 撒糖的糖量条 ---------- */
  function drawSugarBar(ctx, W, H, S, v) {
    const bx = W * 0.14, bw = W * 0.72, by = H * 0.800, bh = 12 * S;
    // 底
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bh / 2); else ctx.rect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    // 绿区（恰到好处）
    const g0 = 0.42, g1 = 0.66;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bh / 2); else ctx.rect(bx, by, bw, bh);
    ctx.clip();
    ctx.fillStyle = 'rgba(120,220,150,0.42)';
    ctx.fillRect(bx + bw * g0, by, bw * (g1 - g0), bh);
    // 已撒的量
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, '#fff6e0');
    grad.addColorStop(1, '#ffd98a');
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, bw * clamp(v, 0, 1), bh);
    ctx.restore();
    // 刻度框
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 1 * S;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bh / 2); else ctx.rect(bx, by, bw, bh);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.4 * S;
    [g0, g1].forEach(q => {
      ctx.beginPath();
      ctx.moveTo(bx + bw * q, by - 3 * S);
      ctx.lineTo(bx + bw * q, by + bh + 3 * S);
      ctx.stroke();
    });
  }

  /* ---------- 评级小卡（出炉后用）：一条标题 + 一行明细 ---------- */
  function drawResultText(ctx, W, H, S, title, sub, perfect, baseY) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = H * (baseY || 0.795);
    // 完美时给一条金色光带
    if (perfect) {
      const g = ctx.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
      g.addColorStop(0, 'rgba(255,214,120,0)');
      g.addColorStop(0.5, 'rgba(255,214,120,0.20)');
      g.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(W * 0.08, y - 22 * S, W * 0.84, 44 * S);
    }
    ctx.font = '700 ' + (16 * S) + 'px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = perfect ? '#ffe6a3' : '#fff4e2';
    ctx.shadowColor = perfect ? 'rgba(255,190,80,0.8)' : 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = perfect ? 16 * S : 6 * S;
    ctx.fillText(title, W * 0.5, y);
    ctx.shadowBlur = 0;
    if (sub) {
      ctx.font = (10.5 * S) + 'px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(246,232,214,0.80)';
      ctx.fillText(sub, W * 0.5, y + 19 * S);
    }
    ctx.restore();
  }

  /* 判定火候档位 */
  function eveGrade(sec) {
    if (sec < 3.2) return 'raw';
    if (sec < 5.0) return 'perfect';
    if (sec < 6.3) return 'caramel';
    if (sec < 7.6) return 'burnt';
    return 'carbon';
  }

  const eveHooks = {
    init() {
      return {
        phase: 'board',       // 见文件头注释的 7 个阶段
        phaseT: 0,            // 本阶段已经过的时间（过场动画靠它推进）
        fade: 1,              // 场景淡入
        doneK: 0,             // 出炉后的成品升起进度
        // —— ① 切苹果
        cuts: 0,              // 已切下的片数（含碎渣）
        goodCuts: 0,          // 其中「完整片」数（划得太短只能算碎渣）
        trash: 0,             // 碎渣数
        plated: 0,            // 真正送进派里的片数（点空白时结算，后面所有判定都用它）
        cutAngle: 0,          // 最近一刀的方向（画切口用）
        knifeT: 0,            // 刀光残留
        trail: [],            // 刀光轨迹
        slices: [],           // 苹果片（飞行中 / 已落在木托上）
        crumbs: [],           // 碎渣粒
        beginT: 0,            // 第一刀之后才开始计时（用来判断"切得急不急"）
        hintSlowT: 0,         // 「一片都没切呢」这句提示的停留时间
        // —— ② 撒糖
        sugar: 0,             // 当前糖量 0~1
        sugarPour: false,     // 正在倒
        sugarDone: false,     // 已定格
        sugarGrains: [],      // 落在派上的糖粒
        sugarStream: [],      // 正在空中飞的糖粒（抛物线，撒开的那种）
        sugarScore: 0,
        sugarEndT: -1,        // 松手那一刻的 phaseT（用来判断糖粒落完之后再切场）
        // —— ③ 装盘
        falling: [],          // 正在落下的片
        landK: 0,             // 网格皮盖上的进度 0~1
        // —— ④ 刷蛋液
        cell: Array.from({ length: 18 }, () => 0),   // 6 列 × 3 行
        coat: 0,              // 覆盖率 0~1
        coatScore: 0,
        // —— ⑤ 送炉
        door: 0,
        // —— ⑥ 烘烤
        bakeT: 0,
        cookResult: null,
        // —— 通用特效
        steam: [], sparks: [], smoke: [],
      };
    },

    step(st, t, dt, W, H, S) {
      st._W = W; st._H = H; st._S = S;   // up/down 钩子拿不到尺寸，这里存一份
      st.phaseT += dt;
      st.knifeT = Math.max(0, st.knifeT - dt * 2.4);
      st.fade = approach(st.fade, 1, 5, dt);

      // 刀光轨迹淡出
      for (let i = st.trail.length - 1; i >= 0; i--) {
        st.trail[i].a -= dt * 2.6;
        if (st.trail[i].a <= 0) st.trail.splice(i, 1);
      }
      // 碎渣物理
      for (let i = st.crumbs.length - 1; i >= 0; i--) {
        const c = st.crumbs[i];
        c.vy += 900 * S * dt * 0.5;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.rot += c.vr * dt;
        c.a -= dt * 0.5;
        if (c.a <= 0) st.crumbs.splice(i, 1);
      }
      // 苹果片飞向木托（指数趋近，不用物理，落点稳）
      for (const s of st.slices) {
        if (!s.flying) continue;
        s.x = approach(s.x, s.tx, 11, dt);
        s.y = approach(s.y, s.ty, 11, dt);
        s.rot = approach(s.rot, s.trot, 9, dt);
        if (Math.hypot(s.x - s.tx, s.y - s.ty) < 1.6 * S) { s.flying = false; s.x = s.tx; s.y = s.ty; s.rot = s.trot; }
      }

      /* ===== ① 切苹果 =====
         20261115 改：这里原来会「切够 10 片就自动装盘」。
         现在不自动了 —— 玩家自己决定切多少：切到一半想收手，就点一下空白处
         （既不是苹果、也不是盘子的地方）把当前这些片送进派里，直接进装盘。
         所以这里只负责把「一片都没切」的提示计时往下压。 */
      if (st.phase === 'board' && st.hintSlowT > 0) st.hintSlowT = Math.max(0, st.hintSlowT - dt);

      /* ===== ② 装盘：片一片片从空中落进派里，码成一圈圈 ===== */
      if (st.phase === 'plate') {
        let allDown = true;
        for (const f of st.falling) {
          if (f.landed) { f.splash = Math.min(0.5, f.splash + dt * 1.6); continue; }
          if (st.phaseT < f.delay) { allDown = false; continue; }
          f.vy += 1500 * S * dt;                          // 重力：落得越来越快，有下坠感
          f.y += f.vy * dt;
          f.x = approach(f.x, f.tx, 6, dt);               // 横向收到槽位上
          f.rot = approach(f.rot, f.slot.rot, 7, dt);     // 边落边转到码放的朝向
          if (f.y >= f.ty) {
            f.y = f.ty; f.x = f.tx; f.rot = f.slot.rot;
            f.landed = true; f.splash = 0.001;            // 落定 → 交给馅层画（同一槽位，不跳）
          } else allDown = false;
        }
        // 落完 + 停 0.5 秒让玩家看成品馅样 → 撒糖
        if (allDown) {
          st.landK = Math.min(1, st.landK + dt * 2.0);
          if (st.landK >= 1 && st.phaseT > 0.45) {
            st.phase = 'sugar'; st.phaseT = 0; st.fade = 0;
            st.sugar = 0; st.sugarPour = false; st.sugarDone = false;
            st.sugarGrains.length = 0; st.sugarEndT = -1;
          }
        }
      }

      /* ===== ③ 撒糖：按住就倒，松手定格（糖撒在苹果片上） ===== */
      if (st.phase === 'sugar') {
        const gg = eveDishGeom(W, H);
        const gry = gg.r * 0.40;
        /* 20261115 第二轮修撒糖：上一版改成「从罐口往左甩抛物线」，
           结果糖只落在派的右半边、还是一条斜线。真正的问题是动作本身错了：
           撒糖是手在食物上方移动、糖垂直落下散开，不是从侧面喷。
           现在罐子在派正上方匀速横扫，糖粒落点跟着罐口走（详见 eveJarPos）。 */
        if (st.sugarPour && !st.sugarDone) {
          st.sugar = Math.min(1.15, st.sugar + dt * 0.42);
          if (st.sugar >= 1.15) { st.sugarPour = false; st.sugarDone = true; st.sugarEndT = st.phaseT; }
          const jp = eveJarPos(st, W, H);
          const jh = H * 0.085;
          // 罐口 = 罐身下端（跟着罐子倾斜走）
          const mox = jp.x + Math.sin(jp.tilt) * jh * 0.34;
          const moy = jp.y + Math.cos(jp.tilt) * jh * 0.52;
          const G = 980 * S;                                  // 重力加速度（画布像素单位）
          // 每帧抖出 2~3 颗：撒满一罐约 400 颗，够铺一层糖霜又不糊成一片
          const nSpawn = 2 + (Math.random() < 0.32 ? 1 : 0);
          for (let i = 0; i < nSpawn; i++) {
            const tgt = eveSugarTarget(gg, jp.x);
            /* 反算初速：这颗糖要在 T 秒后正好落到 tgt。
               T 取自由落体时间的 0.80~0.95 倍 → 初速只是很小的向下速度，
               看着就是「糖从罐口落下去」，而不是被甩出一条线。 */
            const dy = Math.max(8 * S, tgt.y - moy);
            const freeT = Math.sqrt(2 * dy / G);
            const T = freeT * rand(0.80, 0.95);
            st.sugarStream.push({
              x: mox + rand(-2, 2) * S,
              y: moy + rand(-2, 2) * S,
              vx: (tgt.x - mox) / T,
              vy: (dy - 0.5 * G * T * T) / T,
              tx: tgt.x,
              ty: tgt.y,
              r: rand(0.9, 1.9) * S,
            });
          }
        }
        // 空中糖粒：按抛物线飞，到了自己的落点就粘在派面上
        for (let i = st.sugarStream.length - 1; i >= 0; i--) {
          const p = st.sugarStream[i];
          p.vy += 980 * S * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.y >= p.ty) {
            // 落定那一颗：落在派面椭圆里才算（边缘漏出去的丢掉）
            const u = (p.x - gg.cx) / gg.r;
            const v = (p.ty - gg.cy) / gry;
            if (u * u + v * v <= 1.04) st.sugarGrains.push({ x: p.x, y: p.ty, r: p.r, a: rand(0.55, 0.95) });
            st.sugarStream.splice(i, 1);
            continue;
          }
          if (p.y > gg.cy + gry * 2.6) st.sugarStream.splice(i, 1);
        }
        /* 20261115：上限从 300 提到 560。原来满 300 就删「最早撒的那批」，
           结果越往后撒、前面的糖越被抹掉，整盘糖全堆在最后扫过的那一块 —— 看着就是偏的。
           现在一罐撒完大约 400 颗，够不着上限，先撒的糖原样留着。 */
        if (st.sugarGrains.length > 560) st.sugarGrains.splice(0, st.sugarGrains.length - 560);
        // 松手后 0.85 秒进「盖皮 + 刷蛋液」
        if (st.sugarDone && st.sugarEndT >= 0 && st.phaseT - st.sugarEndT > 0.85 && st.sugarStream.length === 0) {
          /* 结算糖量：绿区（0.42~0.66，就是糖量条上那段绿）里都算满分 20，
             越往外越低。这样提示上写的「停在绿区最好」就不是空话 —— 停在绿区真的满分。 */
          const d = Math.abs(st.sugar - 0.54);
          st.sugarScore = d <= 0.12 ? 20 : d <= 0.20 ? 14 : d <= 0.30 ? 8 : 4;
          st.phase = 'glaze'; st.phaseT = 0; st.fade = 0;
          st.cell = Array.from({ length: 18 }, () => 0);
          st.coat = 0;
        }
      }

      /* ===== ④ 刷蛋液：覆盖率 ≥ 0.62 时可以送炉 ===== */
      if (st.phase === 'glaze') {
        let sum = 0;
        for (const v of st.cell) sum += v;
        st.coat = sum / st.cell.length;
      }

      /* ===== ⑤ 送炉过场：2.0 秒，三段（抬起 → 开门 → 滑入 → 关门） ===== */
      if (st.phase === 'toOven') {
        const p = clamp(st.phaseT / 2.0, 0, 1);
        // 炉门：0.25 开始开，0.80 开始关
        st.door = p < 0.25 ? 0 : p < 0.62 ? clamp((p - 0.25) / 0.22, 0, 1)
          : p < 0.86 ? 1 : clamp(1 - (p - 0.86) / 0.14, 0, 1);
        // fade 保持 1：下一段还是同一台烤箱，淡入会闪
        if (p >= 1) { st.phase = 'ready'; st.phaseT = 0; st.door = 0; st.fade = 1; }
      }

      /* ===== ⑥ 烘烤：火候计时 ===== */
      if (st.phase === 'baking') {
        st.bakeT += dt;
        // 烤过头冒黑烟
        if (st.bakeT > 5.6 && Math.random() < 0.45) {
          st.smoke.push({ x: rand(0.36, 0.64), y: 0.50, r: rand(3, 9), v: rand(0.03, 0.07), a: rand(0.16, 0.34) });
        }
        if (Math.random() < 0.5) st.sparks.push({ x: rand(0.28, 0.72), y: rand(0.52, 0.68), r: rand(0.8, 2.2), v: rand(0.02, 0.06), a: 0.7 });
        // 热气
        if (Math.random() < 0.35) {
          st.steam.push({ x: rand(0.34, 0.66), y: 0.50, r: rand(4, 10), v: rand(0.03, 0.07), a: rand(0.16, 0.36), ph: rand(0, TAU) });
        }
      }
      // 热气/火星/黑烟的统一推进（出炉后也继续飘一会儿）
      for (let i = st.steam.length - 1; i >= 0; i--) {
        const s = st.steam[i];
        s.y -= s.v * dt; s.r += dt * 5 * S; s.a -= dt * 0.24;
        if (s.a <= 0) st.steam.splice(i, 1);
      }
      for (let i = st.sparks.length - 1; i >= 0; i--) {
        const p = st.sparks[i];
        p.y -= p.v * dt; p.a -= dt * 0.7;
        if (p.a <= 0) st.sparks.splice(i, 1);
      }
      for (let i = st.smoke.length - 1; i >= 0; i--) {
        const p = st.smoke[i];
        p.y -= p.v * dt; p.r += dt * 7 * S; p.a -= dt * 0.16;
        if (p.a <= 0) st.smoke.splice(i, 1);
      }

      /* ===== ⑦ 出炉：成品升起 ===== */
      if (st.phase === 'done') {
        st.doneK = Math.min(1, st.doneK + dt * 2.2);
        if (Math.random() < 0.5) {
          st.steam.push({ x: rand(0.36, 0.64), y: 0.48, r: rand(4, 10), v: rand(0.03, 0.07), a: rand(0.14, 0.32), ph: rand(0, TAU) });
        }
      }
    },

    /* 手指划动 = 落刀。只有按住时才算（触屏 pointermove 只在按下时才有值）
       20261115：切苹果只能「划」—— 点一下不再自动补一刀。
       手机上一划就是一刀，桌面端也是按住拖着切，手感统一。 */
    move(st, x, y, px, py, t, W, H, S) {
      // 刷蛋液阶段：按住移动就是刷
      if (st.phase === 'glaze' && st._ptrDown) { eveGlazeAt(st, x, y, W, H, S); return; }
      if (st.phase !== 'board') return;
      if (!st._ptrDown) return;
      st._moved = true;                    // 有过拖动 → 抬手时就不算「点空白」
      const g2 = eveBoardGeom(W, H);
      const ax = g2.ax, ay = g2.ay;
      // 当前在切的是整苹果还是那半个（半个小一圈，判定也跟着缩）
      const ar = g2.ar * (st.cuts >= EVE_FULL_SLICES ? 0.92 : 1);
      // 刀必须在苹果上（放宽到 1.45 倍，让"从旁边划过去"也算切到）
      if (Math.hypot(x - ax, y - ay) > ar * 1.45) {
        st.trail.push({ x0: px, y0: py, x1: x, y1: y, a: 0.6 });
        if (st.trail.length > 40) st.trail.shift();
        return;
      }
      st.knifeT = 1;
      st.trail.push({ x0: px, y0: py, x1: x, y1: y, a: 0.95 });
      if (st.trail.length > 40) st.trail.shift();
      /* 累加本次按下的拖动距离，攒够 0.72 个苹果半径算切下一片。
         （上一版拿"上一刀位置"算位移、初值是 null，永远切不动 —— 这个坑别再踩。） */
      st.dragAcc = (st.dragAcc || 0) + Math.hypot(x - px, y - py);
      // 记这一刀的方向（画切口、飞片朝向都用它）
      if (Math.hypot(x - px, y - py) > 2 * S) st.cutAngle = Math.atan2(y - py, x - px);
      if (st.dragAcc >= ar * 0.72) {
        st.dragAcc = 0;
        // 这一刀是不是"擦着苹果边过去的"——擦边只能切出碎渣
        const edge = Math.hypot(px - ax, py - ay) > ar * 1.18;
        eveSlice(st, ax, ay, g2.ar, edge, W, H, S);
      }
    },

    /* 抬手 */
    up(st) {
      st.dragAcc = 0;
      /* ② 撒糖：松手就定格，糖量不再变（再按住也没用） */
      if (st.phase === 'sugar') {
        if (st.sugarPour) { st.sugarPour = false; st.sugarDone = true; st.sugarEndT = st.phaseT; }
        return;
      }
      if (st.phase !== 'board') return;
      if (st._moved) return;               // 划过刀了，这一次不是「点空白」
      if (st._tapApple) return;            // 在苹果上点一下没划 → 切不动，等玩家真的划
      /* 点空白处（既不是苹果、也不是盘子）→ 把当前这些片送进派里。
         一片都没切就送 = 一个没馅的派皮，所以先拦一下、给句提示。 */
      const W = st._W, H = st._H, S = st._S;
      if (!W) return;
      if (st.cuts <= 0) { st.hintSlowT = 1.8; return; }
      eveStartPlate(st, W, H, S, st.cuts);
    },

    down(st, x, y, t, W, H, S) {
      /* ① 切苹果：记下这一下是落在苹果上还是空白上。
         空白要不要「送片」不在这里决定 —— 等抬手时确认没拖过，才算一次点击。 */
      if (st.phase === 'board') {
        const g2 = eveBoardGeom(W, H);
        const ar = g2.ar * (st.cuts >= EVE_FULL_SLICES ? 0.92 : 1);
        st.dragAcc = 0;
        st._moved = false;
        st._tapApple = Math.hypot(x - g2.ax, y - g2.ay) <= ar * 1.45;
        if (st._tapApple) st.knifeT = 0.8;
        return;
      }
      /* ② 撒糖：按住开始倒 */
      if (st.phase === 'sugar') {
        if (!st.sugarDone) st.sugarPour = true;
        return;
      }
      /* ③ 装盘是过场，点了没用 */
      if (st.phase === 'plate') return;
      /* ④ 刷蛋液：在派皮上按住就是刷；刷到 62% 之后，点派皮外面才送进烤箱
         （否则玩家想再刷匀一点，一按就被送走了） */
      if (st.phase === 'glaze') {
        const gd = eveDishGeom(W, H);
        const inTop = Math.hypot((x - gd.cx) / gd.r, (y - gd.cy) / (gd.r * 0.40)) <= 1;
        if (!inTop && st.coat >= 0.62) { st.phase = 'toOven'; st.phaseT = 0; st.fade = 0; return; }
        eveGlazeAt(st, x, y, W, H, S);
        return;
      }
      if (st.phase === 'toOven') return;
      /* ⑤ 烤箱待烤 → 点火 */
      if (st.phase === 'ready') {
        st.phase = 'baking'; st.phaseT = 0; st.bakeT = 0; st.cookResult = null; st.fade = 0;
        return;
      }
      /* ⑥ 烘烤中 → 取出，按已烤时长定档 */
      if (st.phase === 'baking') {
        st.cookResult = eveGrade(st.bakeT);
        // 火候分：完美档 + 落在黄金窗口 = 满分 30
        const inGold = st.bakeT >= EVE_GOLD_A && st.bakeT <= EVE_GOLD_B;
        const bakeScore = st.cookResult === 'perfect' ? (inGold ? 30 : 26)
          : st.cookResult === 'caramel' ? 20
            : st.cookResult === 'raw' ? 8
              : st.cookResult === 'burnt' ? 5 : 0;
        /* 20261115：切片分改成「按实际送进去的片数」给，不再要求切够 10 片。
           20261114：再收一版 —— 一整个苹果是 10 片，所以 10 片给满分 30，
           9/11 差一片给 27、往两边一路递减。曲线上不明说「10 片最好」，
           玩家只会在几次之后发现切到 10 片分数最高。 */
        const n = st.plated || 0;
        let sliceScore = SLICE_SCORE_TBL[Math.min(EVE_MAX_SLICES, Math.max(0, n))];
        sliceScore = Math.max(0, sliceScore - st.trash * 3);
        st.sliceScore = sliceScore;
        st.bakeScore = bakeScore;
        st.coatScore = Math.round(clamp(st.coat, 0, 1) * 20);
        st.total = clamp(sliceScore + st.sugarScore + st.coatScore + bakeScore, 0, 100);
        st.isPerfect = (st.cookResult === 'perfect' && inGold && n === EVE_FULL_SLICES &&
          st.trash === 0 && st.sugarScore >= 20 && st.coatScore >= 20);
        st.phase = 'done'; st.phaseT = 0; st.doneK = 0; st.fade = 0;
        // 结算：底部的寄语淡出，把这块地方让给画布上的结果文字
        if (st.__host && st.__host.classList) st.__host.classList.add('fx-result');
        // 20261116：派做好了 → 卡片上多出「送给 TA」按钮（.fx-done 控制显隐）
        if (st.__host && st.__host.classList) st.__host.classList.add('fx-done');
        // 把这一炉的结论挂到卡片上，送出时用它决定文案（完美 / 焦糖 / 生 / 焦…）
        if (st.__host && st.__host.dataset) {
          st.__host.dataset.pie = JSON.stringify({
            perfect: !!st.isPerfect, cook: st.cookResult || '',
            slices: st.plated || 0, sweet: st.sugar || 0,
          });
        }
        return;
      }
      /* ⑦ 出炉 → 重做 */
      if (st.phase === 'done') {
        eveReset(st);
        return;
      }
    },

    /* 真正的绘制 */
    draw(st, ctx, t, dt, W, H, S) { drawEveScene(st, ctx, t, dt, W, H, S); },
  };

  /* ---------- 派盘在屏幕上的几何（判定与绘制共用同一份，避免错位） ----------
     20261115：cy 从 0.60H 下移到 0.655H。正式入梦签的文字占上半张卡（头像/节气/标题/正文/寄语），
     动画主体必须整块落在文字下方，否则「苹果与炉火」的正文会压住派盘。 */
  function eveDishGeom(W, H) {
    return { cx: W * 0.5, cy: H * 0.655, r: W * 0.235 };
  }

  /* ---------- 撒糖时糖罐的位置（发射 / 绘制 / 调试预置三处共用） ----------
     真撒糖、撒盐不是「罐子斜着朝食物喷一道糖流」—— 那画出来就是一条线。
     真的动作是：手捏着罐子在食物上方**匀速来回扫**，糖粒几乎垂直落下去，
     手扫到哪里哪里就有糖。所以：
       · 罐子悬在派的**正上方**，用三角波匀速左右扫（不是正弦：正弦在两端会停得久，
         糖就堆在两边、中间反而空），正好扫过整只派；
       · 糖粒落点 = 罐口正下方 + 一点点横向抖动，纵向按椭圆范围随机散开；
       · 合起来：整个派面（含最正中那一块）都能均匀撒到。 */
  function eveJarPos(st, W, H) {
    const g = eveDishGeom(W, H);
    const PERIOD = 1.35;                                  // 一个来回 1.35 秒（撒满一罐约两个来回）
    // 从派的正中起步（相位加 0.25），罐子不会一上来就贴在左边
    const ph = ((st.phaseT > 0 ? st.phaseT : 0) / PERIOD + 0.25) % 1;
    const tri = ph < 0.5 ? (ph * 4 - 1) : (3 - ph * 4);   // -1 → 1 → -1 匀速往复
    const bob = Math.sin(st.phaseT * 5.4) * 0.016 * g.r;  // 手上上下下的小抖动
    return {
      x: g.cx + tri * g.r * 0.86,
      // 贴着派面上方一点悬着（再高就跑到窗玻璃中间去了，看着像贴在窗上）
      y: g.cy - g.r * 0.84 + bob,
      tilt: st.sugarPour ? 0.14 : 0.04,                   // 只是随手歪一点，不是倾倒
      g: g,
    };
  }

  /* 在派面椭圆里取一个落点：横向跟着罐口走（只加一点抖动），
     纵向按该 x 处的椭圆弦长随机 → 落点铺满整个派面，中间不会空。 */
  function eveSugarTarget(g, jarX) {
    const u = clamp((jarX - g.cx) / g.r + rand(-0.26, 0.26), -0.93, 0.93);
    const chord = Math.sqrt(Math.max(0.02, 1 - u * u));   // 这个 x 位置椭圆的半短轴比例
    return { x: g.cx + u * g.r, y: g.cy + rand(-1, 1) * chord * g.r * 0.40 * 0.94 };
  }
  /* 案板阶段（切苹果）的几何：苹果、砧板、旁边的木托，判定和绘制都用这一份 */
  function eveBoardGeom(W, H) {
    return {
      ax: W * 0.40, ay: H * 0.645, ar: W * 0.100,
      boardX: W * 0.40, boardY: H * 0.710, boardRx: W * 0.265, boardRy: W * 0.092,
      trayX: W * 0.775, trayY: H * 0.720, trayRx: W * 0.140, trayRy: W * 0.048,
    };
  }

  /* ---------- 派里到底码了几片（0~1，相对 15 个槽位） ----------
     20261115：片数不再是固定 10 片，所以所有「画派」的地方都从这里取填充量，
     保证「送进去几片」和「画出来几片」永远是同一个数。 */
  function eveFillK(st) {
    return clamp((st.plated || 0) / EVE_FILL_SLOTS.length, 0, 1);
  }

  /* ---------- 切下一片 ----------
     edge=true 表示这一刀是擦着苹果边过去的，只能切出碎渣（失败点之一）。 */
  function eveSlice(st, ax, ay, ar, edge, W, H, S) {
    if (st.phase !== 'board' || st.cuts >= EVE_MAX_SLICES) return;
    /* 20261115：切完一个整苹果（10 片）后，板上会换出「半个苹果」继续切。
       所以半径、切面位置、刀口进度都要按「当前在切哪一个」来算，
       否则第 11 片会从一个已经不存在的果身上剥下来。 */
    const half = st.cuts >= EVE_FULL_SLICES;
    const rr = half ? ar * 0.92 : ar;
    st.cuts++;
    if (edge) st.trash++; else st.goodCuts++;
    const a = st.cutAngle || -0.5;
    // 木托上按序号摞：每层 5 片，层与层往上叠
    const idx = st.slices.length;
    const layer = Math.floor(idx / 5);
    const bg = eveBoardGeom(W, H);
    const trayX = bg.trayX, trayY = bg.trayY;
    const tx = trayX + ((idx % 5) - 2) * ar * 0.34 + rand(-ar * 0.07, ar * 0.07);
    const ty = trayY - layer * ar * 0.185 + rand(-ar * 0.05, ar * 0.05);
    // 片从「刚削出来的那个平面」飞出去，落到木托上（20261114：原先从果心按角度飞，
    // 看着像苹果往外吐纸片；现在是沿切面剥下来，位置和形状对得上）
    /* 剥落起点必须和「画面上果身被削掉多少」对齐：
       半个苹果一出来就已经缺了 0.42，所以这一段的 kPrev 也从 0.42 起算，
       否则第 11 片会从一块早就不存在的果肉上飞出去。 */
    const kPrev = half
      ? 0.50 + 0.50 * (st.cuts - 1 - EVE_FULL_SLICES) / (EVE_MAX_SLICES - EVE_FULL_SLICES)
      : (st.cuts - 1) / EVE_FULL_SLICES;
    const faceX = rr * (1.06 - kPrev * 1.52);
    st.slices.push({
      x: ax + faceX * 0.92,
      y: ay + rand(-rr * 0.30, rr * 0.30),
      tx: tx, ty: ty,
      rot: a + rand(-0.4, 0.4), trot: rand(-0.55, 0.55),
      r: edge ? ar * 0.24 : rr * rand(0.48, 0.56),
      peel: ['#cf3a2e', '#bd3928', '#d84a33'][idx % 3],
      flying: true,
    });
    // 擦边切 → 溅出碎渣
    if (edge) {
      for (let i = 0; i < 5; i++) {
        st.crumbs.push({
          x: ax + Math.cos(a) * ar * 0.7 + rand(-ar * 0.2, ar * 0.2),
          y: ay + Math.sin(a) * ar * 0.7 + rand(-ar * 0.2, ar * 0.2),
          r: rand(1.6, 3.6) * S, vx: rand(-90, 90) * S, vy: rand(-220, -60) * S,
          rot: rand(0, TAU), vr: rand(-8, 8), a: 1, hue: i % 2,
        });
      }
    }
    st.knifeT = 1;
  }

  /* ---------- 刷蛋液：指针所在格子及其邻格被刷到 ---------- */
  function eveGlazeAt(st, x, y, W, H, S) {
    const g = eveDishGeom(W, H);
    const nx = (x - g.cx) / g.r;
    const ny = (y - g.cy) / (g.r * 0.40);
    if (nx * nx + ny * ny > 1.0) return;         // 只在派顶椭圆内才算
    const col = clamp(Math.floor((nx * 0.5 + 0.5) * 6), 0, 5);
    const row = clamp(Math.floor((ny * 0.5 + 0.5) * 3), 0, 2);
    // 主格 + 邻格（手感宽容，否则要一格一格抠太难受）
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = col + dc, rw = row + dr;
        if (c < 0 || c > 5 || rw < 0 || rw > 2) continue;
        const w = (dr === 0 && dc === 0) ? 0.55 : 0.26;
        const i = rw * 6 + c;
        st.cell[i] = Math.min(1, st.cell[i] + w);
      }
    }
    st._brushOn = 0.35;
  }

  /* ---------- 重做：把状态清干净 ---------- */
  function eveReset(st) {
    st.phase = 'board'; st.phaseT = 0; st.fade = 0; st.doneK = 0;
    st.cuts = 0; st.goodCuts = 0; st.trash = 0; st.plated = 0; st.cutAngle = 0;
    st.knifeT = 0; st.trail.length = 0; st.slices.length = 0; st.crumbs.length = 0;
    st.sugar = 0; st.sugarPour = false; st.sugarDone = false;
    st.sugarGrains.length = 0; st.sugarStream.length = 0; st.sugarScore = 0;
    st.falling.length = 0; st.landK = 0;
    st.cell = Array.from({ length: 18 }, () => 0); st.coat = 0; st.coatScore = 0;
    st.door = 0; st.bakeT = 0; st.cookResult = null; st.total = 0; st.isPerfect = false; st.bakeScore = 0;
    st.steam.length = 0; st.sparks.length = 0; st.smoke.length = 0;
    st.dragAcc = 0; st._moved = false; st._tapApple = false; st.hintSlowT = 0;
    // 结果态的排版让位（寄语淡出）也一起收回来
    if (st.__host && st.__host.classList) st.__host.classList.remove('fx-result');
    // 20261116：重播回到切苹果 → 「送给 TA」按钮跟着消失
    if (st.__host && st.__host.classList) {
      st.__host.classList.remove('fx-done');
      const gb = st.__host.querySelector && st.__host.querySelector('.dream-fx-gift');
      if (gb) { gb.classList.remove('given'); gb.disabled = false; gb.textContent = '送给 TA 尝尝'; }
    }
  }

  /* ---------- 装盘：把切好的片按槽位摆好，生成「从空中落下」的对象 ----------
     20261114：阶段顺序改成「切 → 装盘 → 撒糖 → 盖皮刷蛋液」。
     原来的顺序是切完先撒糖、再装盘，糖撒在空派皮上、苹果片后到 ——
     玩家一看就发现「我还没撒苹果片，派上就已经有片了」。真实做法也是
     先铺底皮、码苹果馅、撒糖、编网格皮、刷蛋液，所以顺序一并改回来。 */
  function eveStartPlate(st, W, H, S, n) {
    const g = eveDishGeom(W, H);
    const ry = g.r * 0.40;
    st.phase = 'plate'; st.phaseT = 0; st.fade = 0; st.landK = 0;
    st.falling = [];
    /* 20261115：送进去几片就落几片（不再固定 10 片）。
       槽位取前 cnt 个：前 10 个是「铺满一层」的位置，第 11~15 个是补缝位 ——
       所以切得少就是稀稀拉拉一层，切得多就是片压片。 */
    const cnt = clamp(Math.round(n || 0), 0, EVE_MAX_SLICES);
    st.plated = cnt;
    for (let i = 0; i < cnt; i++) {
      const s = EVE_FILL_SLOTS[i];
      const tx = g.cx + s.u * g.r * 1.02;                 // 落点：派面椭圆内（与馅层同一系数）
      const ty = g.cy + s.v * ry * 1.14;
      // 起点：悬在派上方的空中，比落点散得更开 —— 一眼看出「还没落下来」
      const sx = g.cx + s.u * g.r * 1.55;
      const sy = g.cy - H * 0.150 + s.v * ry * 1.5;
      st.falling.push({
        slot: s, tx: tx, ty: ty, sx: sx, sy: sy,
        x: sx, y: sy,
        rot0: rand(-1.4, 1.4), rot: rand(-1.4, 1.4),
        vy: 0, landed: false, splash: 0,
        delay: 0.55 + i * 0.11,                            // 一片接一片地落
        r: g.r * 0.315 * s.s,                               // 片大小与馅层完全一致 → 落地不缩水
      });
    }
  }

  /* ---------- 平安夜：台面后方的一扇窗（窗外是雪夜） ----------
     20261115 新增：玩家要求「苹果的后方放一扇窗，窗外是雪景」。
     放在 drawCounter 的最前面画，于是它天然位于「台面之后、案板与苹果之前」——
     窗的下沿会被台面弧线压住一截，看起来就是一扇装在台面上方墙上的窗，
     不用改任何一件道具的坐标。 */
  const EVE_WIN_SNOW = Array.from({ length: 16 }, () => ({
    u: Math.random(),                 // 横向位置（0~1，相对窗内宽）
    v: Math.random(),                 // 纵向起始位置（0~1，相对窗内高）
    r: 0.5 + Math.random() * 0.9,     // 雪花半径系数（乘 S）
    sp: 0.012 + Math.random() * 0.030,// 下落速度（每秒下落占窗高的比例）
    ph: Math.random() * TAU,          // 横向摆动相位
  }));

  function drawEveWindow(ctx, W, H, S) {
    const wx = W * 0.220, ww = W * 0.560;     // 窗洞左边 / 宽度
    const wy = H * 0.370, wh = H * 0.230;     // 窗洞上边 / 高度（底边落在窗台板上）

    /* ① 墙影：窗洞外一圈暗边，让窗"凹"进墙里，而不是平贴上去 */
    ctx.save();
    ctx.fillStyle = 'rgba(10,5,14,0.40)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(wx - 5 * S, wy - 5 * S, ww + 10 * S, wh + 10 * S, 8 * S);
    else ctx.rect(wx - 5 * S, wy - 5 * S, ww + 10 * S, wh + 10 * S);
    ctx.fill();

    /* ② 玻璃：雪夜天光——上深下亮（雪地把光反上来），整体压暗，保证上面的白字仍然清楚 */
    const sky = ctx.createLinearGradient(0, wy, 0, wy + wh);
    sky.addColorStop(0, '#0e1730');
    sky.addColorStop(0.42, '#1a2946');
    sky.addColorStop(0.78, '#2f4059');
    sky.addColorStop(1, '#55647a');
    ctx.fillStyle = sky;
    ctx.fillRect(wx, wy, ww, wh);

    /* ③ 窗内景物统一裁到窗洞：远景雪坡 → 近处雪地 → 飘雪 → 玻璃反光 */
    ctx.save();
    ctx.beginPath();
    ctx.rect(wx, wy, ww, wh);
    ctx.clip();

    // 远处雪坡（低透明，只留一个起伏的轮廓）
    ctx.fillStyle = 'rgba(148,168,196,0.28)';
    ctx.beginPath();
    ctx.moveTo(wx - 2, wy + wh * 0.74);
    ctx.quadraticCurveTo(wx + ww * 0.28, wy + wh * 0.56, wx + ww * 0.54, wy + wh * 0.70);
    ctx.quadraticCurveTo(wx + ww * 0.78, wy + wh * 0.82, wx + ww + 2, wy + wh * 0.65);
    ctx.lineTo(wx + ww + 2, wy + wh + 2);
    ctx.lineTo(wx - 2, wy + wh + 2);
    ctx.closePath();
    ctx.fill();

    // 近处雪地（更亮一档，窗底积着雪）
    ctx.fillStyle = 'rgba(198,213,232,0.32)';
    ctx.beginPath();
    ctx.moveTo(wx - 2, wy + wh * 0.90);
    ctx.quadraticCurveTo(wx + ww * 0.34, wy + wh * 0.80, wx + ww * 0.66, wy + wh * 0.88);
    ctx.quadraticCurveTo(wx + ww * 0.86, wy + wh * 0.93, wx + ww + 2, wy + wh * 0.87);
    ctx.lineTo(wx + ww + 2, wy + wh + 2);
    ctx.lineTo(wx - 2, wy + wh + 2);
    ctx.closePath();
    ctx.fill();

    // 窗外的雪：用真实时间驱动，飘得很慢；每片自带相位，不会整片一起动
    const nowSec = performance.now() / 1000;
    for (const s2 of EVE_WIN_SNOW) {
      const p = (s2.v + nowSec * s2.sp) % 1;                    // 纵向循环下落
      const x = wx + ww * (s2.u + Math.sin(nowSec * 0.5 + s2.ph) * 0.020);
      const y = wy + wh * p;
      ctx.globalAlpha = 0.50 + 0.32 * Math.sin(nowSec * 1.4 + s2.ph);
      ctx.fillStyle = '#eef4ff';
      ctx.beginPath();
      ctx.arc(x, y, s2.r * S, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 玻璃反光：两道斜向极淡的高光，有了它才像"隔着一层玻璃"
    ctx.fillStyle = 'rgba(255,255,255,0.055)';
    for (let i = 0; i < 2; i++) {
      const ox = wx + ww * (0.12 + i * 0.40);
      ctx.beginPath();
      ctx.moveTo(ox, wy);
      ctx.lineTo(ox + ww * 0.13, wy);
      ctx.lineTo(ox + ww * 0.13 - wh * 0.42, wy + wh);
      ctx.lineTo(ox - wh * 0.42, wy + wh);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* ④ 窗棂：一竖一横把窗分成四格（雪夜常见的木格窗），再描一圈木框 */
    const bar = Math.max(2.2, Math.min(ww, wh) * 0.050);
    ctx.fillStyle = '#2a1a12';
    ctx.fillRect(wx + ww * 0.5 - bar * 0.5, wy, bar, wh);
    ctx.fillRect(wx, wy + wh * 0.5 - bar * 0.5, ww, bar);

    ctx.strokeStyle = '#3b2517';
    ctx.lineWidth = bar * 1.2;
    ctx.strokeRect(wx, wy, ww, wh);

    // 木框内侧的一线暖光（厨房灯照上去的那一点）
    ctx.strokeStyle = 'rgba(255,206,150,0.26)';
    ctx.lineWidth = 1.2 * S;
    ctx.strokeRect(wx + bar * 0.85, wy + bar * 0.85, ww - bar * 1.7, wh - bar * 1.7);

    /* ⑤ 窗台板：一条压住窗底的木横条，把窗和台面接住，
       否则台面那道浅弧会把窗底斜着切掉一个角，看着像穿模 */
    const sillH = 9 * S;
    const sillX = wx - 10 * S, sillW = ww + 20 * S;
    const sillY = wy + wh - sillH * 0.55;
    ctx.fillStyle = '#4a2c1c';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(sillX, sillY, sillW, sillH, 3 * S);
    else ctx.rect(sillX, sillY, sillW, sillH);
    ctx.fill();
    // 台面前缘的高光
    ctx.fillStyle = 'rgba(255,214,164,0.22)';
    ctx.fillRect(sillX, sillY, sillW, 1.2 * S);
    // 窗台上积的一层薄雪
    ctx.fillStyle = 'rgba(228,238,252,0.50)';
    ctx.beginPath();
    ctx.ellipse(sillX + sillW * 0.5, sillY + 0.7 * S, sillW * 0.47, 2.0 * S, 0, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  /* ---------- 厨房台面（俯视木台，下方各阶段共用） ---------- */
  function drawCounter(ctx, W, H, S) {
    // 20261115：台面后方的窗先画，因此窗永远在案板/苹果/派盘的后面
    drawEveWindow(ctx, W, H, S);
    const y = H * 0.618;   // 台面线：让砧板/派盘明显"立在台面上"，又不顶到上方的正文
    const g = ctx.createLinearGradient(0, y, 0, H);
    g.addColorStop(0, '#6d4530');
    g.addColorStop(0.28, '#4e2e22');
    g.addColorStop(1, '#281722');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    ctx.quadraticCurveTo(W * 0.5, y - H * 0.012, W + 10, y);   // 弧度收小：否则台面中心拱起，会把窗底斜切一刀
    ctx.lineTo(W + 10, H);
    ctx.lineTo(-10, H);
    ctx.closePath();
    ctx.fill();
    // 台面高光
    ctx.strokeStyle = 'rgba(255,204,152,0.16)';
    ctx.lineWidth = 1.6 * S;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    ctx.quadraticCurveTo(W * 0.5, y - H * 0.012, W + 10, y);   // 弧度收小：否则台面中心拱起，会把窗底斜切一刀
    ctx.stroke();
  }

  /* ---------- 总绘制 ---------- */
  function drawEveScene(st, ctx, t, dt, W, H, S) {
    // 暖色厨房底
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#241428');
    bg.addColorStop(0.5, '#301b2e');
    bg.addColorStop(1, '#3d2231');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // 灶台上方的一团暖光
    const lamp = ctx.createRadialGradient(W * 0.5, H * 0.24, 0, W * 0.5, H * 0.24, W * 0.8);
    lamp.addColorStop(0, 'rgba(255,178,108,0.18)');
    lamp.addColorStop(1, 'rgba(255,178,108,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = st.fade;
    if (st.phase === 'board') drawEveBoard(st, ctx, t, W, H, S);
    else if (st.phase === 'sugar') drawEveSugar(st, ctx, t, W, H, S);
    else if (st.phase === 'plate') drawEvePlate(st, ctx, t, W, H, S);
    else if (st.phase === 'glaze') drawEveGlaze(st, ctx, t, W, H, S);
    else if (st.phase === 'toOven') drawEveToOven(st, ctx, t, W, H, S);
    else if (st.phase === 'ready' || st.phase === 'baking') drawEveBake(st, ctx, t, W, H, S);
    else drawEveDone(st, ctx, t, W, H, S);
    ctx.globalAlpha = 1;

    // 热气（压在场景最上层）
    for (const s of st.steam) {
      ctx.globalAlpha = Math.max(0, s.a);
      ctx.fillStyle = 'rgba(255,242,222,0.42)';
      ctx.beginPath();
      ctx.arc(s.x * W + Math.sin(t * 1.4 + s.ph) * 6 * S, s.y * H, s.r * S, 0, TAU);
      ctx.fill();
    }
    // 黑烟（烤过头才冒）
    for (const p of st.smoke) {
      ctx.globalAlpha = Math.max(0, p.a);
      ctx.fillStyle = 'rgba(40,36,34,0.80)';
      ctx.beginPath();
      ctx.arc(p.x * W + Math.sin(t * 1.1 + p.r) * 8 * S, p.y * H, p.r * S, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 果核：一个苹果切完之后，板上剩下的那一小块 ---------- */
  function drawAppleCore(ctx, cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.28);
    // 影子
    ctx.beginPath();
    ctx.ellipse(0, r * 0.92, r * 0.90, r * 0.26, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 1.32, 0, 0, TAU);
    ctx.fillStyle = '#e8d09c';
    ctx.fill();
    // 两粒籽
    ctx.fillStyle = '#5a3a1c';
    ctx.beginPath(); ctx.ellipse(-r * 0.30, -r * 0.20, r * 0.16, r * 0.27, 0.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.33, r * 0.24, r * 0.16, r * 0.27, -0.4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ---------- ① 切苹果 ---------- */
  function drawEveBoard(st, ctx, t, W, H, S) {
    drawCounter(ctx, W, H, S);
    const g = eveBoardGeom(W, H);
    const ax = g.ax, ay = g.ay, ar = g.ar;
    drawBoard(ctx, g.boardX, g.boardY, g.boardRx, g.boardRy, S);
    drawTray(ctx, g.trayX, g.trayY, g.trayRx, g.trayRy, S);

    // 已经切下来的片（摞在木托上，先画 → 压在苹果下面）
    const arr = st.slices.slice().sort((p, q) => p.y - q.y);
    for (const s of arr) drawAppleSlice(ctx, s.x, s.y, s.r, s.rot, s.peel);

    // 苹果本体：每切一刀右侧就少一片，剩下的果身是「被削平了一面」的苹果
    if (st.cuts < EVE_MAX_SLICES) {
      /* 20261115：切满一个整苹果后换出「半个苹果」，可以继续切到 15 片。
         两段的进展各自独立算 k —— 否则第 11 片会从一个已经削没了的果身上剥下来。 */
      const half = st.cuts >= EVE_FULL_SLICES;
      /* 半个苹果：一出来就已经削掉一大块（kk 从 0.42 起），
         这样一眼能看出「这是剩的半个」，而不是「一只变小了的苹果」。 */
      const kk = half ? 0.50 + 0.50 * (st.cuts - EVE_FULL_SLICES) / (EVE_MAX_SLICES - EVE_FULL_SLICES)
        : st.cuts / EVE_FULL_SLICES;
      const base = half ? ar * 0.92 : ar;
      const rr = base * (1 - kk * 0.08);   // 果身只轻微缩小：体积是靠「少一块」减的，不是整体缩水
      const shake = st.knifeT > 0.5 ? Math.sin(t * 46) * 2.4 * S : 0;
      // 落在砧板上的影子
      ctx.beginPath();
      ctx.ellipse(ax + shake - rr * 0.10, ay + rr * 0.98, rr * 0.80, rr * 0.22, 0, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fill();
      drawCutApple(ctx, ax + shake, ay, rr, kk, st.knifeT > 0.5 ? Math.sin(t * 34) * 0.03 : 0);
      // 半个苹果阶段：第一个苹果的果核就躺在旁边，一眼看懂「那个切完了」
      if (half) drawAppleCore(ctx, ax - ar * 0.96, ay + ar * 0.46, ar * 0.22);
    } else {
      // 全切完了：板上只剩果核
      drawAppleCore(ctx, ax, ay + ar * 0.34, ar * 0.24);
    }

    // 刀光
    for (const s of st.trail) {
      ctx.globalAlpha = Math.max(0, s.a) * 0.95;
      ctx.strokeStyle = '#fff6d8';
      ctx.lineWidth = 2.4 * S;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(255,240,190,0.9)';
      ctx.shadowBlur = 12 * S;
      ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = st.fade;

    // 碎渣
    for (const c of st.crumbs) {
      ctx.globalAlpha = Math.max(0, c.a) * 0.95;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.hue === 0 ? '#f6e3b4' : '#c9302c';
      ctx.beginPath();
      ctx.moveTo(-c.r, -c.r * 0.7);
      ctx.lineTo(c.r * 0.9, -c.r * 0.5);
      ctx.lineTo(c.r * 0.7, c.r * 0.8);
      ctx.lineTo(-c.r * 0.8, c.r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = st.fade;

    /* 木托上方的进度（已切片数）—— 不写「/10」，避免玩家以为非得切够 10 片。
       20261114：切到 10 片（正好一整个苹果）时，计数变成暖金色 + 一句「一颗苹果」。
       不解释为什么、不提分数，只给一个「这样对了」的暗示 —— 玩家自己会发现 10 片最好。 */
    const fullApple = st.cuts === EVE_FULL_SLICES;
    ctx.save();
    ctx.font = '600 ' + (10.5 * S) + 'px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = fullApple ? 'rgba(255,214,140,0.98)' : 'rgba(255,232,200,0.86)';
    if (fullApple) { ctx.shadowColor = 'rgba(255,190,90,0.80)'; ctx.shadowBlur = 9 * S; }
    ctx.fillText(fullApple ? '一颗苹果 · ' + st.cuts + ' 片' : '已切 ' + st.cuts + ' 片',
      g.trayX, g.trayY - g.trayRy * 2.6);
    ctx.restore();

    drawHint(ctx,
      st.hintSlowT > 0 ? '一片都没切呢 · 先在苹果上划一刀'
        : st.cuts === 0 ? '按住苹果，划着切下去'
          : st.cuts < EVE_FULL_SLICES ? '点空白处，把这几片送进派里'
            : st.cuts === EVE_FULL_SLICES ? '一整个苹果，切完了 · 点空白送进派'
              : st.cuts < EVE_MAX_SLICES ? '还想再添半个？也能切，或点空白送进派'
                : '切满了 · 点空白处送进派里',
      W, H, S, '#ffe9cf');
  }

  /* ---------- ③ 撒糖：糖撒在苹果片上 ---------- */
  function drawEveSugar(st, ctx, t, W, H, S) {
    drawCounter(ctx, W, H, S);
    const g = eveDishGeom(W, H);
    // 装盘已经完成 → 派里是码好的 10 片，糖撒在片上（不再是一开始就画着片）
    drawDish(ctx, g.cx, g.cy, g.r, { k: 0, fill: eveFillK(st), lattice: 0, sugared: st.sugar > 0.02 ? 1 : 0 });

    // 落在馅上的糖粒：大小、明暗都各不相同，才像撒上去的一层糖霜（不是刷的一排点）
    for (const gr of st.sugarGrains) {
      ctx.globalAlpha = (gr.a == null ? 0.90 : gr.a);
      ctx.fillStyle = '#fffaf0';
      ctx.beginPath();
      ctx.arc(gr.x, gr.y, gr.r || 1.5 * S, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = st.fade;

    // 糖罐：悬在派的正上方、匀速左右扫（位置与发射共用 eveJarPos，糖不会从空气里冒出来）
    const jp = eveJarPos(st, W, H);
    const jx = jp.x, jy = jp.y;
    const tilt = jp.tilt;
    ctx.save();
    ctx.translate(jx, jy);
    ctx.rotate(tilt);
    const jw = W * 0.085, jh = H * 0.085;
    // 罐身（玻璃）
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-jw / 2, -jh / 2, jw, jh, 6 * S); else ctx.rect(-jw / 2, -jh / 2, jw, jh);
    const jg = ctx.createLinearGradient(-jw / 2, 0, jw / 2, 0);
    jg.addColorStop(0, 'rgba(255,255,255,0.30)');
    jg.addColorStop(0.45, 'rgba(255,250,240,0.14)');
    jg.addColorStop(1, 'rgba(255,255,255,0.26)');
    ctx.fillStyle = jg;
    ctx.fill();
    // 罐里的糖：罐子是倒着拿的，糖积在「倒过来的底」也就是上半部；撒出去越多剩得越少
    const sugarLv = Math.max(0.10, 1 - clamp(st.sugar, 0, 1.15) * 0.80);
    const sgH = jh * 0.62 * sugarLv;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-jw * 0.40, -jh * 0.46, jw * 0.80, sgH, 4 * S);
    else ctx.rect(-jw * 0.40, -jh * 0.46, jw * 0.80, sgH);
    ctx.fillStyle = 'rgba(255,252,244,0.92)';
    ctx.fill();
    // 玻璃反光
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.4 * S;
    ctx.beginPath();
    ctx.moveTo(-jw * 0.32, -jh * 0.34);
    ctx.lineTo(-jw * 0.32, jh * 0.34);
    ctx.stroke();
    // 罐口：拧开的盖圈朝下，糖就是从这里落出去的
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-jw * 0.44, jh * 0.46, jw * 0.88, jh * 0.16, 3 * S);
    else ctx.rect(-jw * 0.44, jh * 0.46, jw * 0.88, jh * 0.16);
    ctx.fillStyle = '#b98252';
    ctx.fill();
    // 口子边缘堆着的糖（倒着拿，糖会鼓出来一圈）
    ctx.beginPath();
    ctx.ellipse(0, jh * 0.50, jw * 0.34, jh * 0.052, 0, 0, TAU);
    ctx.fillStyle = 'rgba(255,252,244,0.95)';
    ctx.fill();
    ctx.restore();

    // 空中的糖：每一颗都是独立的抛物线粒子（会散开，不再是一条直线）
    if (st.sugarStream.length) {
      ctx.save();
      for (const p of st.sugarStream) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#fffdf6';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = st.fade;
    }

    drawSugarBar(ctx, W, H, S, st.sugar);
    drawHint(ctx, st.sugarDone ? '糖撒好了' : '按住屏幕撒糖，停在绿区最好', W, H, S, '#ffe9cf');
  }

  /* ---------- ② 装盘：片从空中落到派里，一片片码好 ---------- */
  function drawEvePlate(st, ctx, t, W, H, S) {
    drawCounter(ctx, W, H, S);
    const g = eveDishGeom(W, H);
    const total = Math.max(1, st.falling.length);
    let landed = 0;
    for (const f of st.falling) if (f.landed) landed++;
    /* 已经落定的片不在这里单独画 —— 直接交给馅层（按同一组槽位绘制），
       这样「落下的终点」和「码好的馅」天然重合，片不会落到别处、落地也不会跳位置。 */
    drawDish(ctx, g.cx, g.cy, g.r, {
      k: 0, lattice: 0, sugared: 0,
      // 落一片长一片：落地的比例 × 这一盘总共几片
      fill: (landed / total) * eveFillK(st),
    });

    // 还在空中的片（和馅层同一套画法，落地颜色不断层）
    for (const f of st.falling) {
      if (f.landed) continue;
      if (st.phaseT < f.delay) {
        // 悬停：轻轻上下浮动 + 轻微摇摆
        ctx.save();
        ctx.globalAlpha = st.fade * 0.96;
        ctx.translate(f.x, f.y + Math.sin(t * 2.6 + f.rot0 * 6) * 3.2 * S);
        drawWedge(ctx, f.r, f.rot + Math.sin(t * 1.6 + f.rot0) * 0.16, '#f8ebc9', '#e5cd9a');
        ctx.restore();
      } else {
        // 下落中：纵向拉长一点，看得出是「在掉」而不是「在飘」
        ctx.save();
        ctx.globalAlpha = st.fade;
        ctx.translate(f.x, f.y);
        ctx.scale(1, 1 + Math.min(0.26, f.vy * 0.00045));
        drawWedge(ctx, f.r, f.rot, '#f8ebc9', '#e5cd9a');
        ctx.restore();
      }
    }

    // 落地的一圈汁水光：0.45 秒扩出去就没了，让「落进去」有落感
    for (const f of st.falling) {
      if (!f.landed || f.splash >= 0.45) continue;
      const q = f.splash / 0.45;
      ctx.save();
      ctx.globalAlpha = (1 - q) * 0.40 * st.fade;
      ctx.strokeStyle = '#ffdca6';
      ctx.lineWidth = 1.6 * S;
      ctx.beginPath();
      ctx.ellipse(f.tx, f.ty, f.r * (0.85 + q * 1.0), f.r * 0.40 * (0.85 + q * 1.0), 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // 进度：已经落了几片
    ctx.save();
    ctx.font = '600 ' + (11 * S) + 'px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,236,206,0.86)';
    // 不写分母：片数是玩家自己定的，写「12 / 15」会让人以为还得切够 15 片
    // 0.748 而不是 0.775：再往下就压到寄语了
    ctx.fillText(landed + ' 片落进派里', W * 0.5, H * 0.748);
    ctx.restore();

    drawHint(ctx, '苹果片落进派里，一片片码好…', W, H, S, '#ffe9cf');
  }

  /* ---------- ④ 刷蛋液 ---------- */
  function drawEveGlaze(st, ctx, t, W, H, S) {
    drawCounter(ctx, W, H, S);
    const g = eveDishGeom(W, H);
    // 网格皮是「编上去」的：0.45 秒内淡入（撒完糖才盖皮，跟真实做法一致）
    const latK = clamp(st.phaseT / 0.45, 0, 1);
    drawDish(ctx, g.cx, g.cy, g.r, { k: 0, fill: eveFillK(st), lattice: latK, glaze: 0, sugared: 1 });

    // 已刷到的格子 → 亮斑（刷得越匀，亮斑越连成一片）
    for (let rw = 0; rw < 3; rw++) {
      for (let col = 0; col < 6; col++) {
        const v = st.cell[rw * 6 + col];
        if (v <= 0.02) continue;
        const nx = -1 + (col + 0.5) * (2 / 6);
        const ny = -1 + (rw + 0.5) * (2 / 3);
        const px = g.cx + nx * g.r * 0.90;
        const py = g.cy + ny * g.r * 0.40 * 0.90;
        ctx.save();
        ctx.globalAlpha = Math.min(1, v) * 0.55 * st.fade;
        const rg = ctx.createRadialGradient(px, py, 0, px, py, g.r * 0.30);
        rg.addColorStop(0, 'rgba(255,238,178,0.90)');
        rg.addColorStop(1, 'rgba(255,200,90,0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.ellipse(px, py, g.r * 0.34, g.r * 0.17, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    // 刷子（跟着手指走，没指过就停在派上）
    const bx = st._mx == null ? g.cx : st._mx;
    const by = st._my == null ? g.cy - g.r * 0.1 : st._my;
    ctx.save();
    ctx.globalAlpha = st.fade * 0.95;
    ctx.translate(bx, by);
    ctx.rotate(-0.5);
    // 刷柄
    ctx.strokeStyle = '#c79a6a';
    ctx.lineWidth = 3.2 * S;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -g.r * 0.05); ctx.lineTo(0, -g.r * 0.30); ctx.stroke();
    // 刷毛
    ctx.fillStyle = 'rgba(255,226,160,0.92)';
    ctx.beginPath();
    ctx.ellipse(0, 0, g.r * 0.055, g.r * 0.075, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 覆盖率百分比
    ctx.save();
    ctx.font = '600 ' + (11 * S) + 'px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,240,214,0.95)';
    // 这一行贴在浅色盘沿上，得有一层深影才读得清（不然白字压白盘子）
    ctx.shadowColor = 'rgba(28,14,10,0.75)';
    ctx.shadowBlur = 5 * S;
    /* 20261115：0.782 那条线正好是 DOM 寄语的落点，两行字会叠在一起。
       挪到盘沿下方的空白带（0.748），寄语和它各占一行。 */
    ctx.fillText('蛋液 ' + Math.round(st.coat * 100) + '%', W * 0.5, H * 0.748);
    ctx.restore();

    /* 提示也带暗示：刷满 100% 时语气变一下（「一点缝都没落下」），
       但不说「刷满才算完美」。0.62 是能送炉的下限，不是满分线。 */
    drawHint(ctx,
      st.coat >= 0.995 ? '一点缝都没落下 · 点一下送进烤箱'
        : st.coat >= 0.62 ? '刷匀了 · 还能再补补，或点一下送进烤箱'
          : '按住派皮刷蛋液，刷匀一点',
      W, H, S, '#ffe9cf');
  }

  /* ---------- ⑤ 送进烤箱（过场动画） ---------- */
  function drawEveToOven(st, ctx, t, W, H, S) {
    const p = clamp(st.phaseT / 2.0, 0, 1);
    const g = eveDishGeom(W, H);

    /* 20261114：修「送进烤箱时卡一下」
       ① 飞行终点原本写 g.r*0.34 + 0.50gh，而「已在炉膛」那一段用的是 0.30gw + 0.62gh，
          两者差 2.2 倍大小 —— 跨过 p=0.55 的那一帧派会突然胀大，看着就是卡了一下。
          现在两边共用同一组 inX / inY / inR。
       ② 换幕时整场一起淡入（含烤箱）：原来烤箱不参与 fade，前一秒还是案板，下一秒
          一台烤箱砰地出现，观感上也是「卡」。 */
    ctx.save();
    ctx.globalAlpha = clamp(st.fade, 0, 1);

    const ov = drawOven(ctx, W, H, S, { door: st.door, heat: 0.22 + p * 0.06, bakeK: 0 });

    // 台面：派飞起来之后淡出
    ctx.save();
    ctx.globalAlpha *= clamp(1 - p * 1.7, 0, 1);
    drawCounter(ctx, W, H, S);
    ctx.restore();

    // 炉膛内的落点（飞行终点 = 入炉后的位置，必须同一组数）
    const inX = ov.gx + ov.gw * 0.5;
    const inY = ov.gy + ov.gh * 0.62;
    const inR = ov.gw * 0.255;   // 炉膛里的派：留出窗框余量，太大会被窗口裁掉

    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    if (p < 0.55) {
      // 抬起 → 飞向炉口：中间抬一点弧线，直线飞过去像被吸尘器吸走
      const k = ease(p / 0.55);
      const lift = Math.sin(Math.PI * k) * H * 0.045;
      drawDish(ctx, lerp(g.cx, inX, k), lerp(g.cy, inY, k) - lift, lerp(g.r, inR, k),
        { k: 0, fill: eveFillK(st), lattice: 1, glaze: 1, sugared: 1 });
    } else {
      // 已经滑进炉膛：尺寸不再变，避免接着又跳一下
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(ov.gx, ov.gy, ov.gw, ov.gh, 10 * S); else ctx.rect(ov.gx, ov.gy, ov.gw, ov.gh);
      ctx.clip();
      drawDish(ctx, inX, inY, inR, { k: 0, fill: eveFillK(st), lattice: 1, glaze: 1, sugared: 1 });
    }
    ctx.restore();
    drawHint(ctx, '送进烤箱…', W, H, S, '#ffe9cf');
  }

  /* ---------- ⑥ 烘烤 ---------- */
  function drawEveBake(st, ctx, t, W, H, S) {
    const baking = st.phase === 'baking';
    const k = baking ? bakeKOf(st.bakeT) : 0;
    const heat = baking ? clamp(0.34 + (st.bakeT / 7.6) * 0.66, 0, 1) : 0.26;
    const ov = drawOven(ctx, W, H, S, { door: 0, heat: heat, bakeK: k, sparks: st.sparks });
    // 炉膛里的派
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ov.gx, ov.gy, ov.gw, ov.gh, 10 * S); else ctx.rect(ov.gx, ov.gy, ov.gw, ov.gh);
    ctx.clip();
    drawDish(ctx, ov.gx + ov.gw * 0.5, ov.gy + ov.gh * 0.62, ov.gw * 0.255,
      { k: k, fill: eveFillK(st), lattice: 1, glaze: 1, sugared: 1 });
    ctx.restore();
    if (baking) {
      drawBakeBar(ctx, W, H, S, st.bakeT, true);
      // 20261115：烘烤中不再走底部提示条（那里已经被寄语和按钮占住），
      // 把「点一下取出」写在火候条正上方，视线不用来回跑。
      ctx.save();
      ctx.font = '600 ' + (11 * S) + 'px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,233,207,0.94)';
      ctx.fillText('看准火候，点一下取出', W * 0.5, H * 0.710);
      ctx.restore();
    } else {
      drawHint(ctx, '点一下烤箱，开始烤', W, H, S, '#ffe9cf');
    }
  }

  /* ---------- ⑦ 出炉：成品形象 + 评级 ---------- */
  function drawEveDone(st, ctx, t, W, H, S) {
    const g = eveDishGeom(W, H);
    const e = clamp(st.doneK, 0, 1);
    // 展示背景：压暗 + 一束顶光
    ctx.fillStyle = 'rgba(18,10,18,' + (0.42 * e).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
    const spot = ctx.createRadialGradient(W * 0.5, H * 0.34, 0, W * 0.5, H * 0.34, W * 0.72);
    spot.addColorStop(0, 'rgba(255,206,140,' + (0.20 * e).toFixed(3) + ')');
    spot.addColorStop(1, 'rgba(255,206,140,0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, W, H);

    const cx = g.cx;
    const cy = lerp(H * 0.71, H * 0.63, e);
    const r = lerp(g.r * 0.82, g.r * 1.04, e);
    const k = bakeKOf(st.bakeT);

    // 完美的金环（柔光：细线 + 大范围发光。硬边椭圆看着像"选中框"，不像光）
    if (st.isPerfect) {
      ctx.save();
      ctx.globalAlpha = e * (0.42 + 0.22 * Math.sin(t * 2.0));
      ctx.strokeStyle = 'rgba(255,216,140,0.60)';
      ctx.lineWidth = 1.4 * S;
      ctx.shadowColor = 'rgba(255,196,90,0.85)';
      ctx.shadowBlur = 18 * S;
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.18, r * 1.30, r * 0.58, 0, 0, TAU);
      ctx.stroke();
      // 外圈再补一层更淡的，边缘就不会那么硬
      ctx.globalAlpha = e * 0.20;
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.18, r * 1.46, r * 0.68, 0, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 星星
      for (let i = 0; i < 6; i++) {
        const a = t * 0.6 + (i / 6) * TAU;
        const sr = r * (1.40 + 0.10 * Math.sin(t * 2 + i));
        const sx = cx + Math.cos(a) * sr;
        const sy = cy + r * 0.20 + Math.sin(a) * r * 0.62;
        ctx.globalAlpha = e * (0.35 + 0.55 * Math.abs(Math.sin(t * 2.2 + i)));
        ctx.fillStyle = '#ffe9b0';
        ctx.beginPath();
        ctx.moveTo(sx, sy - 3.4 * S);
        ctx.lineTo(sx + 1.1 * S, sy - 1.1 * S);
        ctx.lineTo(sx + 3.4 * S, sy);
        ctx.lineTo(sx + 1.1 * S, sy + 1.1 * S);
        ctx.lineTo(sx, sy + 3.4 * S);
        ctx.lineTo(sx - 1.1 * S, sy + 1.1 * S);
        ctx.lineTo(sx - 3.4 * S, sy);
        ctx.lineTo(sx - 1.1 * S, sy - 1.1 * S);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    drawDish(ctx, cx, cy, r, { k: k, fill: eveFillK(st), lattice: 1, glaze: st.coat > 0 ? 1 : 0.4, sugared: 1 });

    /* 文案
       20261115：结果不再只看火候一个维度。这一版加了「甜度」和「馅量」两条：
         甜度 → 偏淡 / 刚好 / 甜得发齁（由撒糖时停在哪一格决定）
         馅量 → 太少 / 偏少 / 刚好 / 塞满（由送进派的片数决定）
       所以同一炉火候，也能烤出「太甜的苹果派」「苹果很少的苹果派」等不同结果。 */
    const n = st.plated || 0;
    const sweet = st.sugar < 0.40 ? 0 : st.sugar <= 0.72 ? 1 : 2;   // 0 淡 · 1 刚好 · 2 太甜
    const amt = n < 5 ? 0 : n < 8 ? 1 : n <= 13 ? 2 : 3;            // 0 太少 · 1 偏少 · 2 刚好 · 3 塞满
    const sweetTxt = ['甜度偏淡', '甜度刚好', '甜得发齁'][sweet];
    /* 馅量文案也带一点暗示：10 片说「一颗苹果」，9/11 片说「差一片」，
       其余才直接报片数 —— 不说满分是多少，但读起来能感到「一颗苹果」是个刻度。 */
    const amtTxt = n === EVE_FULL_SLICES ? '一颗苹果'
      : (n === EVE_FULL_SLICES - 1 || n === EVE_FULL_SLICES + 1) ? n + ' 片 · 差一片'
        : ['馅料太少', '只有 ' + n + ' 片', n + ' 片', n + ' 片塞满'][amt];
    let sub = sweetTxt + ' · ' + amtTxt + ' · 蛋液 ' + st.coatScore + '/20 · 火候 ' + (st.bakeScore || 0) + '/30';

    let title;
    const gd = st.cookResult;
    if (st.isPerfect) {
      title = '最完美的苹果派';
      sub = '甜得刚好、烤得刚好，连网格都编得刚好';
    } else if (gd === 'raw') {
      title = '还是生的 · 派皮没熟';
    } else if (gd === 'caramel') {
      title = '焦糖色 · 更香一点';
    } else if (gd === 'burnt') {
      title = '烤焦了 · 边上发苦';
    } else if (gd === 'carbon') {
      title = '已经成炭 · 下次盯着火候';
    } else {
      // 火候完美 → 由甜度和馅量决定这是「哪一款」苹果派
      if (sweet === 2) title = '太甜了 · 齁嗓子';
      else if (sweet === 0) title = '有点淡 · 苹果味清清的';
      else if (amt === 0) title = '空落落 · 几乎没有馅';
      else if (amt === 1) title = '皮比馅多 · 苹果少了点';
      else if (amt === 3) title = '塞得满满 · 一口掉渣';
      else title = '刚刚好 · 金黄酥皮';
    }
    /* 20261114：结算页三行字原来挤成两行 —— 副标题落点（y+19S）正好被底部的
       「点一下重做」提示条压住。现在标题上移到 0.772、提示条下移到 0.862，
       中间留出约一行半的空隙。 */
    drawResultText(ctx, W, H, S, title, sub, !!st.isPerfect, 0.772);
    drawHint(ctx, '点一下重做', W, H, S, '#ffe9cf', 0.862);
  }




  /* ============================================================
   * 三、圣诞节：点圣诞树 → 树晃、掉礼物、星星挂饰亮起
   * ============================================================ */

  /* 画一颗五角星 */
  function starPath(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.44;
      const px = x + Math.cos(ang) * rr;
      const py = y + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /* 画礼物盒 */
  function drawGift(ctx, x, y, s, hue, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    // 盒身
    const g = ctx.createLinearGradient(-s * 0.5, 0, s * 0.5, 0);
    g.addColorStop(0, hue === 0 ? '#c0392b' : hue === 1 ? '#2a6f97' : '#8e6bbf');
    g.addColorStop(1, hue === 0 ? '#8e1f16' : hue === 1 ? '#1b4f6e' : '#63428f');
    ctx.fillStyle = g;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-s * 0.5, -s * 0.42, s, s * 0.84, s * 0.10); else ctx.rect(-s * 0.5, -s * 0.42, s, s * 0.84);
    ctx.fill();
    // 竖向丝带
    ctx.fillStyle = 'rgba(255,225,150,0.92)';
    ctx.fillRect(-s * 0.07, -s * 0.42, s * 0.14, s * 0.84);
    // 横向丝带
    ctx.fillRect(-s * 0.5, -s * 0.06, s, s * 0.12);
    // 蝴蝶结
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath(); ctx.ellipse(-s * 0.16, -s * 0.46, s * 0.16, s * 0.10, -0.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.16, -s * 0.46, s * 0.16, s * 0.10, 0.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -s * 0.44, s * 0.065, 0, TAU); ctx.fill();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-s * 0.44, -s * 0.34, s * 0.22, s * 0.62, s * 0.06); else ctx.rect(-s * 0.44, -s * 0.34, s * 0.22, s * 0.62);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- 圣诞树挂饰：不只圆球，还有小礼物 / 拐杖糖 / 星星 / 袜子 / 铃铛 ---------- */
  const ORN_TYPES = ['ball', 'gift', 'cane', 'star', 'sock', 'bell'];

  /* 固定种子的伪随机：挂饰位置只在 init 生成一次，不能每帧跳 */
  function makeRnd(seed) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  /* 生成挂饰分布：底层多、顶层少。
     tt = 沿树冠边缘曲线的参数（0 顶尖 → 1 底边），f = 从树轴到边缘的比例，side = 左右 */
  function buildOrnaments() {
    const rnd = makeRnd(20261225);
    const plan = [{ layer: 0, n: 10 }, { layer: 1, n: 7 }, { layer: 2, n: 4 }];
    const out = [];
    let ti = 0;
    for (const p of plan) {
      for (let i = 0; i < p.n; i++) {
        out.push({
          layer: p.layer,
          tt: 0.20 + rnd() * 0.72,
          f: 0.32 + rnd() * 0.56,
          side: rnd() < 0.5 ? -1 : 1,
          type: ORN_TYPES[ti++ % ORN_TYPES.length],
          hue: Math.floor(rnd() * 4),
          sc: 0.78 + rnd() * 0.38,
          ph: rnd() * TAU,
        });
      }
    }
    return out;
  }

  /* 画一个挂饰（含吊线）。lit 是整棵树的点亮程度，用来加暖光 */
  function drawTreeOrn(ctx, x, y, s, o, lit, t, idx) {
    // 吊线
    ctx.strokeStyle = 'rgba(196,206,220,0.50)';
    ctx.lineWidth = Math.max(0.8, s * 0.10);
    ctx.beginPath();
    ctx.moveTo(x, y - s * 2.1);
    ctx.lineTo(x, y - s * (o.type === 'sock' ? 0.95 : 0.78));
    ctx.stroke();

    ctx.save();
    ctx.translate(x, y);
    if (lit > 0.01) {
      ctx.shadowColor = `rgba(255,214,130,${0.85 * lit})`;
      ctx.shadowBlur = 13 * s * lit;
    }
    switch (o.type) {
      case 'gift':
        drawGift(ctx, 0, 0, s * 1.5, o.hue, 0);
        break;
      case 'cane': {
        // 拐杖糖：白色 J 形 + 红色斜纹
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#f8f4ee';
        ctx.lineWidth = Math.max(2, s * 0.44);
        ctx.beginPath();
        ctx.moveTo(0, s * 0.98);
        ctx.lineTo(0, -s * 0.12);
        ctx.arc(s * 0.31, -s * 0.12, s * 0.31, Math.PI, TAU, false);
        ctx.stroke();
        ctx.strokeStyle = '#e8404a';
        ctx.lineWidth = Math.max(1.1, s * 0.17);
        for (let i = 0; i < 4; i++) {
          const yy = s * 0.74 - i * s * 0.32;
          ctx.beginPath();
          ctx.moveTo(-s * 0.23, yy + s * 0.14);
          ctx.lineTo(s * 0.23, yy - s * 0.06);
          ctx.stroke();
        }
        break;
      }
      case 'star':
        starPath(ctx, 0, 0, s * 1.0);
        ctx.fillStyle = '#ffe27a';
        ctx.fill();
        starPath(ctx, 0, 0, s * 0.52);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
        break;
      case 'sock': {
        // 圣诞袜：红底 + 白口
        ctx.fillStyle = '#e0373f';
        ctx.beginPath();
        ctx.moveTo(-s * 0.30, -s * 0.70);
        ctx.lineTo(s * 0.18, -s * 0.70);
        ctx.lineTo(s * 0.18, s * 0.26);
        ctx.quadraticCurveTo(s * 0.26, s * 0.76, -s * 0.26, s * 0.78);
        ctx.quadraticCurveTo(-s * 0.86, s * 0.78, -s * 0.80, s * 0.30);
        ctx.quadraticCurveTo(-s * 0.76, -s * 0.02, -s * 0.30, s * 0.02);
        ctx.closePath();
        ctx.fill();
        // 脚尖与脚跟的浅色
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath();
        ctx.ellipse(-s * 0.52, s * 0.62, s * 0.30, s * 0.18, 0.2, 0, TAU);
        ctx.fill();
        // 白口
        ctx.fillStyle = '#f7f4ef';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-s * 0.40, -s * 0.94, s * 0.66, s * 0.32, s * 0.10);
        else ctx.rect(-s * 0.40, -s * 0.94, s * 0.66, s * 0.32);
        ctx.fill();
        break;
      }
      case 'bell': {
        const bg = ctx.createLinearGradient(-s * 0.5, 0, s * 0.5, 0);
        bg.addColorStop(0, '#ffe7a2');
        bg.addColorStop(0.45, '#f0b32e');
        bg.addColorStop(1, '#b0701a');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(-s * 0.64, s * 0.44);
        ctx.quadraticCurveTo(-s * 0.56, -s * 0.66, 0, -s * 0.74);
        ctx.quadraticCurveTo(s * 0.56, -s * 0.66, s * 0.64, s * 0.44);
        ctx.quadraticCurveTo(0, s * 0.62, -s * 0.64, s * 0.44);
        ctx.closePath();
        ctx.fill();
        // 摆锤
        ctx.fillStyle = '#8d5a12';
        ctx.beginPath(); ctx.arc(0, s * 0.56, s * 0.15, 0, TAU); ctx.fill();
        // 高光
        ctx.fillStyle = 'rgba(255,250,220,0.45)';
        ctx.beginPath();
        ctx.ellipse(-s * 0.22, -s * 0.26, s * 0.10, s * 0.22, -0.3, 0, TAU);
        ctx.fill();
        break;
      }
      default: {
        // 圆球：径向渐变 + 一点高光 + 小金属帽
        const colors = ['#ff5b62', '#ffd166', '#6fd3ff', '#ff9f43'];
        const base = colors[o.hue % colors.length];
        const g = ctx.createRadialGradient(-s * 0.30, -s * 0.34, s * 0.06, 0, 0, s * 0.78);
        g.addColorStop(0, 'rgba(255,255,255,0.92)');
        g.addColorStop(0.35, base);
        g.addColorStop(1, base);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, TAU); ctx.fill();
        // 金属帽
        ctx.fillStyle = '#c9b070';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-s * 0.14, -s * 0.78, s * 0.28, s * 0.22, s * 0.06) : ctx.rect(-s * 0.14, -s * 0.78, s * 0.28, s * 0.22);
        ctx.fill();
        // 高光点
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.arc(-s * 0.22, -s * 0.24, s * 0.14, 0, TAU); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  const christmasHooks = {
    init() {
      return {
        shake: 0,        // 点击后的晃动强度（指数衰减）
        lights: 0,       // 灯光点亮插值
        tapT: 0,
        gifts: [],       // 掉落的礼物
        stars: Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random() * 0.55, r: rand(0.5, 1.4), ph: rand(0, TAU) })),
        /* 20261115：雪再下一层——数量 48→68，半径放宽到 4.4，近处大雪花＋远处小雪粒，才有真正的下雪感 */
        snow: Array.from({ length: 68 }, () => ({ x: Math.random(), y: Math.random(), r: rand(1.0, 4.4), v: rand(0.02, 0.075), sw: rand(0, TAU), sp: rand(0.4, 1.3) })),
        fire: Array.from({ length: 12 }, () => ({ ph: rand(0, TAU), sp: rand(1.4, 2.6), h: rand(0.6, 1) })),
        orn: buildOrnaments(),   // 树上挂饰（球 / 小礼物 / 拐杖糖 / 星星 / 袜子 / 铃铛）
        /* 20261115：地上那堆礼物往下挪到雪地上，并且只堆在树根两侧。
           原来放在 0.703H —— 那个位置正好是「底层树冠的内部」，
           看着像礼物堆在树枝上、没落到地面。现在压到 0.75 以下坐在雪面上；
           x 也收到树根左右（0.20 / 0.80），避开正中间那条寄语。 */
        giftPool: [
          { x: 0.205, y: 0.752, s: 0.078, hue: 0, rot: -0.12 },
          { x: 0.795, y: 0.756, s: 0.070, hue: 1, rot: 0.10 },
          { x: 0.215, y: 0.777, s: 0.060, hue: 2, rot: 0.05 },
        ],
      };
    },
    step(st, t, dt, W, H, S) {
      st.shake = Math.max(0, st.shake - dt * 2.2);
      st.tapT = Math.max(0, st.tapT - dt * 2.4);
      st.lights = approach(st.lights, st.lights > 0.01 ? 1 : 0, 3.4, dt);
      // 礼物下落
      for (const g of st.gifts) {
        if (g.landed) { g.settle = Math.min(1, (g.settle || 0) + dt * 4); continue; }
        g.vy += 1400 * S * dt * 0.5;
        g.y += g.vy * dt;
        g.rot += g.vr * dt;
        if (g.y >= g.ground) {
          g.y = g.ground;
          if (Math.abs(g.vy) > 180 * S) { g.vy = -g.vy * 0.34; }  // 落地小弹一下
          else { g.landed = true; g.vy = 0; g.rot = 0; g.settle = 0; }
        }
      }
      // 雪花
      for (const s of st.snow) {
        s.y += s.v * dt;
        s.sw += dt * s.sp;
        if (s.y > 1.02) { s.y = -0.04; s.x = Math.random(); }
      }
    },
    down(st, x, y, t, W, H, S) {
      // 树的范围：以树心为基准的锥形（近似用一个矩形 + 三角判断）
      const tx = W * 0.5;
      // 20261115：树整体下移（0.38~0.84）—— 避开上方文字与底部按钮
      const topY = H * 0.442, botY = H * 0.735;
      const halfW = W * 0.26;
      const prog = clamp((y - topY) / (botY - topY), 0, 1);
      const inTree = y > topY - H * 0.05 && y < botY && Math.abs(x - tx) < halfW * (0.10 + prog * 1.0);
      if (inTree) {
        st.shake = 1;
        st.tapT = 1;
        st.lights = 1;
        // 掉 1~2 个礼物
        const n = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          st.gifts.push({
            // 只往树根两侧掉：中间那条落点是寄语，掉在那儿会跟字压在一起
            x: tx + (Math.random() < 0.5 ? -1 : 1) * rand(W * 0.17, W * 0.31),
            y: H * rand(0.42, 0.62),
            vy: rand(20, 90) * S,
            vr: rand(-3, 3),
            rot: rand(-0.3, 0.3),
            s: rand(0.062, 0.092) * W,
            hue: Math.floor(Math.random() * 3),
            // 落地高度：和地上那堆礼物同一片雪面（0.75H 往下），不能停在树冠上
            ground: H * rand(0.752, 0.776),
            landed: false,
          });
        }
        // 礼物太多时清掉最早的，避免越堆越乱
        if (st.gifts.length > 14) st.gifts.splice(0, st.gifts.length - 14);
      }
    },
    draw(st, ctx, t, dt, W, H, S) {
      // —— 夜空
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#081226');
      sky.addColorStop(0.55, '#122442');
      sky.addColorStop(1, '#1d3355');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // —— 星空
      for (const s of st.stars) {
        ctx.globalAlpha = (0.30 + 0.70 * Math.abs(Math.sin(t * 1.1 + s.ph))) * 0.9;
        ctx.fillStyle = '#eaf2ff';
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r * S, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // —— 月亮
      const mx = W * 0.82, my = H * 0.14, mr = W * 0.07;
      const mg = ctx.createRadialGradient(mx, my, mr * 0.3, mx, my, mr * 4);
      mg.addColorStop(0, 'rgba(220,235,255,0.36)');
      mg.addColorStop(1, 'rgba(220,235,255,0)');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(mx, my, mr * 4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8f1ff';
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();

      // —— 雪地
      const gy = H * 0.722;   // 雪线：树根压在雪地上，底下的按钮留出来
      const sg = ctx.createLinearGradient(0, gy - H * 0.06, 0, H);
      // 20261115：雪地压暗一档——原来接近纯白，底部的寄语（淡紫）压在上面几乎看不清
      sg.addColorStop(0, '#cadaea');
      sg.addColorStop(1, '#93a8c2');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(W * 0.25, gy - H * 0.05, W * 0.55, gy + H * 0.045, W, gy - H * 0.015);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();

      // —— 远处小树剪影
      ctx.fillStyle = 'rgba(12,28,48,0.55)';
      for (let i = 0; i < 4; i++) {
        const bx = W * (0.12 + i * 0.26) + (i % 2 ? 10 : 0);
        const bh = H * (0.10 + (i % 3) * 0.02);
        ctx.beginPath();
        ctx.moveTo(bx, gy - bh);
        ctx.lineTo(bx + bh * 0.36, gy + 2);
        ctx.lineTo(bx - bh * 0.36, gy + 2);
        ctx.closePath();
        ctx.fill();
      }

      // —— 篝火（左下）
      const fx = W * 0.18, fy = H * 0.87;
      // 木柴
      ctx.strokeStyle = '#5b4128';
      ctx.lineWidth = 4 * S;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fx - 16 * S, fy + 4 * S); ctx.lineTo(fx + 14 * S, fy - 2 * S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx - 12 * S, fy - 3 * S); ctx.lineTo(fx + 16 * S, fy + 5 * S); ctx.stroke();
      // 火光光晕（随火焰跳动）
      const flick = 0.78 + 0.22 * Math.sin(t * 9) * Math.sin(t * 5.3);
      const fg = ctx.createRadialGradient(fx, fy - 10 * S, 0, fx, fy - 10 * S, 96 * S * flick);
      fg.addColorStop(0, 'rgba(255,170,60,0.46)');
      fg.addColorStop(0.5, 'rgba(255,120,40,0.18)');
      fg.addColorStop(1, 'rgba(255,110,30,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(fx, fy - 10 * S, 96 * S * flick, 0, TAU); ctx.fill();
      // 火焰
      for (const f of st.fire) {
        const hgt = (30 + 22 * f.h) * S * flick;
        const wob = Math.sin(t * f.sp + f.ph) * 5 * S;
        const grd = ctx.createLinearGradient(fx, fy - hgt, fx, fy);
        grd.addColorStop(0, 'rgba(255,225,140,0.0)');
        grd.addColorStop(0.35, 'rgba(255,190,80,0.85)');
        grd.addColorStop(1, 'rgba(255,110,40,0.75)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(fx - 7 * S, fy);
        ctx.quadraticCurveTo(fx - 4 * S + wob, fy - hgt * 0.6, fx + wob * 0.6, fy - hgt);
        ctx.quadraticCurveTo(fx + 6 * S + wob, fy - hgt * 0.55, fx + 7 * S, fy);
        ctx.closePath();
        ctx.fill();
      }

      // —— 圣诞树（整体晃动）
      const tx = W * 0.5;
      // 20261115：与点击判定保持同一组坐标（0.442~0.735），避开文字层与底部按钮
      const topY = H * 0.442;
      const botY = H * 0.735;   // 与点击判定同一组坐标（改一处必须两处一起改）
      const treeH = botY - topY;
      ctx.save();
      ctx.translate(tx, botY);
      const rotA = Math.sin(t * 34) * 0.028 * st.shake + Math.sin(t * 1.2) * 0.004;
      ctx.rotate(rotA);
      ctx.translate(-tx, -botY);

      // 树干
      ctx.fillStyle = '#5a3b24';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx - W * 0.028, botY - H * 0.04, W * 0.056, H * 0.07, 3 * S);
      else ctx.rect(tx - W * 0.028, botY - H * 0.04, W * 0.056, H * 0.07);
      ctx.fill();

      // 三层树冠
      const layers = [
        { y: botY, w: W * 0.30, h: treeH * 0.46 },
        { y: botY - treeH * 0.26, w: W * 0.24, h: treeH * 0.42 },
        { y: botY - treeH * 0.48, w: W * 0.18, h: treeH * 0.40 },
      ];
      for (let i = layers.length - 1; i >= 0; i--) {
        const L = layers[i];
        const g2 = ctx.createLinearGradient(tx, L.y - L.h, tx, L.y);
        /* 20261115：加深树色 —— 原来偏灰，截图里像一棵褪色的假树 */
        g2.addColorStop(0, i === 2 ? '#2a7d4f' : '#1f6a42');
        g2.addColorStop(1, '#0f3f28');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.moveTo(tx, L.y - L.h);
        ctx.quadraticCurveTo(tx + L.w * 0.55, L.y - L.h * 0.30, tx + L.w, L.y);
        ctx.quadraticCurveTo(tx + L.w * 0.4, L.y + H * 0.012, tx, L.y + H * 0.008);
        ctx.quadraticCurveTo(tx - L.w * 0.4, L.y + H * 0.012, tx - L.w, L.y);
        ctx.quadraticCurveTo(tx - L.w * 0.55, L.y - L.h * 0.30, tx, L.y - L.h);
        ctx.closePath();
        ctx.fill();
        /* 20261115：雪只铺在最底层、且分成左右两坨。
           之前每层底边都画一条雪带，层叠后中间会出现一条白线横穿树身，很扎眼。 */
        if (i === 0) {
          ctx.fillStyle = 'rgba(236,246,255,0.60)';
          ctx.beginPath();
          ctx.ellipse(tx - L.w * 0.60, L.y - H * 0.004, L.w * 0.32, H * 0.013, -0.05, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(tx + L.w * 0.60, L.y - H * 0.004, L.w * 0.32, H * 0.013, 0.05, 0, TAU);
          ctx.fill();
        }
      }

      /* —— 挂饰（20261115：从「12 颗圆球」扩成 6 种、共 21 件）
         位置直接由每层树冠的那条二次贝塞尔算出，所以永远落在树形里、不会悬空。
         tt 沿边缘走，f 决定离树轴多远，side 决定左右。 */
      for (let i = 0; i < st.orn.length; i++) {
        const o = st.orn[i];
        const L = layers[o.layer] || layers[0];
        const tt = o.tt;
        const edx = 2 * (1 - tt) * tt * (L.w * 0.55) + tt * tt * L.w;
        const edy = (1 - tt) * (1 - tt) * (-L.h) + 2 * (1 - tt) * tt * (-L.h * 0.30);
        const ox = tx + o.side * edx * o.f;
        const oy = L.y + edy * 0.97;
        drawTreeOrn(ctx, ox, oy, W * 0.031 * o.sc, o, st.lights, t, i);
      }

      // 树顶星
      const starR = W * 0.052 * (1 + st.tapT * 0.18);
      ctx.save();
      if (st.lights > 0.01) {
        ctx.shadowColor = `rgba(255,230,150,${0.95 * st.lights})`;
        ctx.shadowBlur = 22 * S * st.lights;
      }
      ctx.fillStyle = st.lights > 0.5 ? '#ffe89a' : '#d8c98a';
      starPath(ctx, tx, topY - starR * 0.4, starR);
      ctx.fill();
      ctx.restore();

      ctx.restore();

      // —— 礼物（掉落中 + 地上那堆）
      for (const g of st.giftPool) {
        drawGift(ctx, W * g.x, H * g.y, W * g.s, g.hue, g.rot);
      }
      for (const g of st.gifts) {
        drawGift(ctx, g.x, g.y, g.s, g.hue, g.rot);
      }

      // —— 雪花（前景）
      for (const s of st.snow) {
        ctx.globalAlpha = 0.55 + 0.35 * Math.abs(Math.sin(s.sw));
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x * W + Math.sin(s.sw) * 5 * S, s.y * H, s.r * S, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // —— 提示
      /* 圣诞树不出底部提示条：卡片正文已经写了「点一下树，星星和挂饰会亮，礼物会掉下来」，
         而且树底这片被雪地和礼物占满，再压一条提示反而糊。 */

    },
  };

  /* ---------- 对外暴露 ---------- */
  const scenes = {};
  function mount(kind, canvas, hooks) {
    if (scenes[kind]) { try { scenes[kind].stop(); } catch (e) {} }
    const sc = createScene(canvas, hooks);
    scenes[kind] = sc;
    sc.start();
    return sc;
  }

  window.BMFX_SPECIAL = {
    halloween: { start: (cv) => mount('halloween', cv, halloweenHooks) },
    christmasEve: { start: (cv) => mount('christmasEve', cv, eveHooks) },
    christmas: { start: (cv) => mount('christmas', cv, christmasHooks) },
    stopAll() {
      for (const k in scenes) { try { scenes[k].stop(); } catch (e) {} }
    },
    /* 调试用（只在预览页/开发者截图时调用）：直接把某场景推到指定阶段，
       方便一次看完「切苹果 / 撒糖 / 装盘 / 刷蛋液 / 烤 / 出炉」的样子。 */
    debugJump(kind, phase, opt) {
      const sc = scenes[kind];
      if (!sc || !sc.state) return false;
      const st = sc.state;
      opt = opt || {};
      if (kind !== 'christmasEve') return false;
      if (phase === 'board') {
        eveReset(st);
        // 调试：直接摆出「已经切了 N 片」的样子（看木托上的摞片效果）
        const W = st._W, H = st._H, S = st._S;
        if (W && opt.cuts) {
          const bg = eveBoardGeom(W, H);
          for (let i = 0; i < Math.min(opt.cuts, EVE_MAX_SLICES); i++) {
            st.cutAngle = rand(-1.3, 1.3);
            eveSlice(st, bg.ax, bg.ay, bg.ar, false, W, H, S);
            const sl = st.slices[st.slices.length - 1];
            if (sl) { sl.flying = false; sl.x = sl.tx; sl.y = sl.ty; sl.rot = sl.trot; }
          }
          st.fade = 1;
        }
      }
      else if (phase === 'plate') {
        eveReset(st);
        const nc = opt.cuts == null ? EVE_FULL_SLICES : clamp(opt.cuts, 1, EVE_MAX_SLICES);
        st.cuts = nc; st.goodCuts = nc; st.sugarScore = 20;
        // 直接走正式的装盘生成器，落点/片大小与真玩时一模一样
        if (st._W) eveStartPlate(st, st._W, st._H, st._S, nc);
        st.fade = 1;
        // opt.settled：全部落定（截图看「码好的 10 片」用）
        if (opt.settled) {
          for (const f of st.falling) {
            f.landed = true; f.x = f.tx; f.y = f.ty; f.rot = f.slot.rot; f.splash = 0.5;
          }
          st.landK = 1;
        }
      } else if (phase === 'sugar') {
        eveReset(st);
        st.phase = 'sugar'; st.phaseT = 0; st.fade = 1;
        st.cuts = EVE_FULL_SLICES; st.goodCuts = EVE_FULL_SLICES; st.plated = EVE_FULL_SLICES;
        st.sugar = opt.sugar == null ? 0.55 : opt.sugar;
        // 调试默认就「正在倒」：否则截图时看不到空中那些糖粒
        st.sugarPour = opt.pour !== false;
        st.sugarDone = false;
        /* 无头截图只跑得出两三帧，粒子上根本攒不起来。所以这里按「已经撒了 0.6 秒」
           直接把画面摆好：派面铺一层糖霜（椭圆内按面积均匀采样，正中也有），
           空中还有一把正在落的（按同一套抛物线反算，位置和真玩时一致）。 */
        if (opt.pour !== false && st._W) {
          const W = st._W, H = st._H, S = st._S;
          const gg = eveDishGeom(W, H);
          const jp = eveJarPos({ phaseT: 0.6, sugarPour: true }, W, H);
          const jh = H * 0.085;
          const mox = jp.x + Math.sin(jp.tilt) * jh * 0.34;
          const moy = jp.y + Math.cos(jp.tilt) * jh * 0.52;
          const G = 980 * S;
          // 派面上的糖
          for (let i = 0; i < 220; i++) {
            const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * 0.94;
            st.sugarGrains.push({
              x: gg.cx + Math.cos(a) * gg.r * rr,
              y: gg.cy + Math.sin(a) * gg.r * 0.40 * rr,
              r: rand(0.9, 1.9) * S,
              a: rand(0.55, 0.95),
            });
          }
          // 空中的糖
          for (let i = 0; i < 46; i++) {
            const tgt = eveSugarTarget(gg, jp.x);
            const dy = Math.max(8 * S, tgt.y - moy);
            const freeT = Math.sqrt(2 * dy / G);
            const T = freeT * rand(0.80, 0.95);
            const vx = (tgt.x - mox) / T, vy = (dy - 0.5 * G * T * T) / T;
            const tt = rand(0.02, T * 0.8);
            st.sugarStream.push({
              x: mox + vx * tt,
              y: moy + vy * tt + 0.5 * G * tt * tt,
              vx: vx, vy: vy + G * tt,
              tx: tgt.x, ty: tgt.y,
              r: rand(0.9, 1.9) * S,
            });
          }
        }
      } else if (phase === 'glaze') {
        eveReset(st);
        st.phase = 'glaze'; st.phaseT = 1; st.fade = 1;   // phaseT=1：网格皮直接盖好，方便看成品
        st.cuts = EVE_FULL_SLICES; st.goodCuts = EVE_FULL_SLICES; st.plated = EVE_FULL_SLICES; st.sugarScore = 20;
        st.cell = st.cell.map(() => (opt.coat == null ? 0.55 : opt.coat));
        st.coat = opt.coat == null ? 0.55 : opt.coat;
      } else if (phase === 'toOven') {
        eveReset(st);
        st.phase = 'toOven'; st.phaseT = opt.t == null ? 0.65 : opt.t; st.fade = 1;
        st.cuts = EVE_FULL_SLICES; st.goodCuts = EVE_FULL_SLICES; st.plated = EVE_FULL_SLICES; st.sugarScore = 20; st.coat = 1;
      } else if (phase === 'ready') {
        eveReset(st);
        st.phase = 'ready'; st.phaseT = 0; st.fade = 1;
        st.cuts = EVE_FULL_SLICES; st.goodCuts = EVE_FULL_SLICES; st.plated = EVE_FULL_SLICES; st.sugarScore = 20; st.coat = 1;
      } else if (phase === 'baking') {
        eveReset(st);
        st.phase = 'baking'; st.phaseT = 0; st.fade = 1;
        st.cuts = EVE_FULL_SLICES; st.goodCuts = EVE_FULL_SLICES; st.plated = EVE_FULL_SLICES; st.sugarScore = 20; st.coat = 1;
        st.bakeT = opt.t == null ? 4.2 : opt.t;
      } else if (phase === 'done') {
        eveReset(st);
        // 调试可以指定片数与糖量，一次看完「太甜 / 太淡 / 馅太少 / 塞满」几种结果
        const nc = opt.cuts == null ? EVE_FULL_SLICES : clamp(opt.cuts, 0, EVE_MAX_SLICES);
        st.cuts = nc; st.goodCuts = nc; st.plated = nc;
        st.sugar = opt.sweet == null ? 0.54 : opt.sweet;      // 结算文案靠它判甜度
        st.bakeT = opt.t == null ? 4.2 : opt.t;
        st.cookResult = eveGrade(st.bakeT);
        const inGold = st.bakeT >= EVE_GOLD_A && st.bakeT <= EVE_GOLD_B;
        st.sugarScore = opt.sugar == null ? 20 : opt.sugar;
        st.coat = opt.coat == null ? 1 : opt.coat;
        st.coatScore = Math.round(st.coat * 20);
        st.bakeScore = st.cookResult === 'perfect' ? (inGold ? 30 : 26)
          : st.cookResult === 'caramel' ? 20 : st.cookResult === 'raw' ? 8 : st.cookResult === 'burnt' ? 5 : 0;
        st.sliceScore = SLICE_SCORE_TBL[Math.min(EVE_MAX_SLICES, Math.max(0, nc))];
        st.total = Math.max(0, st.sliceScore + st.sugarScore + st.coatScore + st.bakeScore);
        st.isPerfect = st.cookResult === 'perfect' && inGold && nc === EVE_FULL_SLICES &&
          st.trash === 0 && st.sugarScore >= 20 && st.coatScore >= 20;
        st.phase = 'done'; st.phaseT = 0; st.doneK = 1; st.fade = 1;
        // 与真玩时一样：结算态让底部的寄语淡出
        if (st.__host && st.__host.classList) st.__host.classList.add('fx-result');
        // 预览页也要看得到「送给 TA」按钮
        if (st.__host && st.__host.classList) st.__host.classList.add('fx-done');
        if (st.__host && st.__host.dataset) {
          st.__host.dataset.pie = JSON.stringify({
            perfect: !!st.isPerfect, cook: st.cookResult || '', slices: nc, sweet: st.sugar || 0,
          });
        }
      }
      return true;
    },
  };
})();
