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
  /* 20261114：NaN 防御。真机上 TouchEvent 取不到坐标时（见 localPt 注释）会算出 NaN，
     NaN 会被 clamp 原样传出去（`NaN < a` 和 `NaN > b` 都是 false），于是南瓜坐标、
     拖动累计距离全被污染成 NaN —— 这正是「苹果只颤动切不动」「南瓜点亮后消失」的病根。
     这里统一让非法值落到下限，宁可不动也不要画到坐标外。 */
  const clamp = (v, a, b) => (!Number.isFinite(v) ? a : (v < a ? a : (v > b ? b : v)));
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
      st._W = W; st._H = H; st._S = S;  // 首帧之前也要能给 down/up 用（点空白跳关靠它）
    };

    /* 20261114 真机修复（苹果切不动 / 南瓜点亮后消失的根因）：
       TouchEvent 对象本身**没有** clientX/clientY —— 直接在 touchstart/touchmove 上读
       `e.clientX` 得到的是 undefined，减 rect.left 之后是 NaN。NaN 一路传下去：
         · 万圣节：down 里 hypot(NaN) 恒为 false → 判定不到「点在南瓜上」；
                   已经浮起时 clamp(NaN) 让 pcyT 变 NaN → 南瓜画到画布外，整只消失；
         · 平安夜：move 里 hypot(NaN) 恒为 false → 永远攒不满拖动距离 → 只颤动、切不下片。
       同时 pointerdown 与 touchstart 会**各触发一次 down**，一次点击等于点两下
       （南瓜一下就「点亮 + 浮起」）。所以这里同时做两件事：坐标从 touches 里取、
       并把事件源锁成「先到的那个」（pointer 优先，只发 touch 的 WebView 自动走 touch）。 */
    const localPt = (e) => {
      const r = canvas.getBoundingClientRect();
      const tp = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || null;
      const cx = tp ? tp.clientX : e.clientX;
      const cy = tp ? tp.clientY : e.clientY;
      return {
        x: (cx - r.left) * (W / Math.max(1, r.width)),
        y: (cy - r.top) * (H / Math.max(1, r.height)),
      };
    };
    /* 坐标必须是有限数，否则直接丢弃这一帧（宁可少一次操作，也不让 NaN 污染状态机） */
    const okPt = (p) => Number.isFinite(p.x) && Number.isFinite(p.y);
    // '' = 还没确定；'pointer' / 'touch' = 已锁定的事件源
    let src = '';

    /* 20261116 手势加固（玩家点名：手势识别特别重要）
       ① 手指绑定：只认「按下那一根」。旧实现任何一根手指的 move/up 都驱动游戏 ——
          长按时第二根手指蹭到屏幕，摇树摆幅会突然反向、拖着的果子会瞬移；
          多指时先抬起的那根还会提前结算。
       ② 打断兜底：Android/WebView 长按会发 pointercancel / touchcancel（系统接管成
          长按选择、或边缘返回手势），旧实现只监听 up —— cancel 一来手指状态就永远
          停在「按下」：挑果的果子粘在手上、摇树的树一直摇、切完苹果随便划一下还在出片。
          现在把 cancel 当成「原位放弃」：不结算成投放，把果子放回手里再清状态。
       ③ 坐标复位：按下时同步 _mx/_my，避免上一轮残留的上一帧坐标让首帧算出巨大位移
          （摇树一下掉三颗、切苹果一刀出十几片）。 */
    let activeId = null;                 // 当前操作那根手指的 id（pointerId / touch identifier）
    const ptId = (e, isTouch) => {
      if (isTouch) {
        const tp = (e.changedTouches && e.changedTouches[0])
          || (e.touches && e.touches[0]) || null;
        return tp && tp.identifier != null ? tp.identifier : null;
      }
      return typeof e.pointerId === 'number' ? e.pointerId : null;
    };

    const onDown = (e) => {
      const isTouch = e.type.indexOf('touch') === 0;
      if (!src) src = isTouch ? 'touch' : 'pointer';
      if ((src === 'touch') !== isTouch) return; // 另一条链路的事件一律放掉，避免一次触摸算两下
      // 20261115：正式入梦签里 canvas 是 pointer-events:none，事件挂在整张卡片上；
      // 所以点「我收到啦」这类按钮时不能当成游戏操作，直接放过。
      if (e.target && e.target.closest && e.target.closest('button')) return;
      if (activeId !== null) return;       // 已经有一根手指在操作，后来的手指不接管
      if (e.cancelable) e.preventDefault();
      const p = localPt(e);
      if (!okPt(p)) return;
      const id = ptId(e, isTouch);
      activeId = (id == null) ? 'any' : id;
      st._ptrDown = true;
      st._px = p.x; st._py = p.y;
      st._mx = p.x; st._my = p.y;
      /* 记下这一下的落点：抬手时若几乎没移动，就算一次「点空白」（用来清屏） */
      st._tapX = p.x; st._tapY = p.y; st._tapMoved = false;
      if (hooks.down) hooks.down(st, p.x, p.y, t, W, H, S);
    };
    const onMove = (e) => {
      const isTouch = e.type.indexOf('touch') === 0;
      if (src && (src === 'touch') !== isTouch) return;
      if (activeId === null) return;       // 没按住 → 悬停不驱动任何操作
      const id = ptId(e, isTouch);
      if (activeId !== 'any' && id !== null && id !== activeId) return; // 别的手指，忽略
      // 只有真的走 touch 链路时才拦滚动（pointer 链路下 touchstart 已被放掉，
      //   这里再 preventDefault 会连带影响卡片的正常点击）
      if (isTouch && e.cancelable && src === 'touch') e.preventDefault();
      const p = localPt(e);
      if (!okPt(p)) return;
      const prevX = st._mx == null ? p.x : st._mx;
      const prevY = st._my == null ? p.y : st._my;
      st._mx = p.x; st._my = p.y;
      /* 只要真的划过一段（约 14 CSS px），这一下就不再算「点空白」 */
      if (st._tapX != null && Math.hypot(p.x - st._tapX, p.y - st._tapY) > 14 * S) st._tapMoved = true;
      if (hooks.move) hooks.move(st, p.x, p.y, prevX, prevY, t, W, H, S);
    };
    /* 抬手（正常松手）：只认当前那根手指，别的手指抬起不结算 */
    const onUp = (e) => {
      if (activeId === null) return;
      if (e) {
        const isTouch = e.type.indexOf('touch') === 0;
        if (src && (src === 'touch') !== isTouch) return;
        const id = ptId(e, isTouch);
        if (activeId !== 'any' && id !== null && id !== activeId) return;
      }
      /* 20261116：抬手前先判定「这一下是不是纯点击」—— 是的话把文字清屏。
         放在 hooks.up 之前：清屏和这一下的原意（进下一阶段）互不干扰，
         推进照常走，字照样收起来。拖动（挑果/切苹果）永远不算点击。 */
      const pureTap = st._tapX != null && !st._tapMoved;
      st._tapX = null; st._tapY = null; st._tapMoved = false;
      activeId = null;
      st._ptrDown = false;
      if (pureTap) clearChrome();
      if (hooks.up) hooks.up(st);
    };
    /* 被系统打断（pointercancel / touchcancel）：不放进容器，不触发结算 */
    const onCancel = () => {
      if (st.grab && st.grab.state === 'drag') {
        const a = st.grab;
        a.state = 'in'; a.x = a.hx; a.y = a.hy;
        a.rot = a.homeRot || a.rot; a.lift = 0;
        st.grab = null;
      }
      st.shakeOn = false;
      st.washHold = false;
      // 切苹果：丢弃这次按下的半截拖动，避免下次按下从旧距离继续累加
      st.dragAcc = 0;
      // 撒糖：被打断就当松手定格（已经倒下去的糖不会消失）
      if (st.sugarPour) { st.sugarPour = false; st.sugarDone = true; st.sugarEndT = st.phaseT; }
      activeId = null;
      st._ptrDown = false;
      st._tapX = null; st._tapY = null; st._tapMoved = false;
      /* 刻意不调 hooks.up：up 在切苹果阶段代表「点空白送片」，系统打断不等于玩家
         主动收手 —— 调了会把半截的片直接送进派里，属于替玩家做了决定。 */
    };
    /* 长按保护：卡片上禁止选中文本、禁止系统长按菜单（否则按住做游戏会弹菜单/选中文字） */
    const onCtxMenu = (e) => { e.preventDefault(); return false; };
    const onSelectStart = (e) => { e.preventDefault(); return false; };

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
    /* 20261116（玩家要求）：小游戏里「第一次点空白」就把周边文字清屏 ——
       头像行、节气名、标题、寄语一起淡出，画布拿到整张卡，手指怎么划都不压字。
       只在 .fx-game（万圣节 / 平安夜 / 圣诞节这三张可玩卡）生效，
       普通节日/节气卡的文字一个字都不动。按钮保留，玩家随时能关掉这张卡。 */
    const isGameCard = !!(host.classList && host.classList.contains('fx-game'));
    const clearChrome = () => {
      if (!isGameCard || host.classList.contains('fx-cleared')) return;
      host.classList.add('fx-cleared');
    };
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
        /* 重新开始一局 → 文字先回来（上一局点空白清掉的屏，这一局重新给玩家看） */
        if (host.classList) host.classList.remove('fx-cleared');
        host.addEventListener('pointerdown', onDown);
        host.addEventListener('pointermove', onMove);
        // 触屏：部分 WebView 只发 touch 不发 pointer，补一条链路（与 app.js 里风场的处理一致）
        // 20261115：touchmove/touchstart 都改成 passive:false —— 切苹果要「划」，
        // passive:true 时 preventDefault 无效，手指一划页面会跟着滚。
        host.addEventListener('touchmove', onMove, { passive: false });
        host.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('pointerup', onUp);
        window.addEventListener('touchend', onUp);
        /* 20261116 手势加固：系统打断 + 长按保护。
           · cancel：长按/边缘手势被系统接管时 WebView 发这个事件，必须兜住，
             否则状态机永远停在「按下」（见上面 onCancel 注释）。
           · contextmenu / selectstart：长按弹出「选择文字/保存图片」菜单，
             看起来就像页面被系统踢出去了 —— 卡片上手势区内一律禁掉。 */
        host.addEventListener('pointercancel', onCancel);
        host.addEventListener('touchcancel', onCancel, { passive: true });
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('touchcancel', onCancel, { passive: true });
        host.addEventListener('contextmenu', onCtxMenu);
        host.addEventListener('selectstart', onSelectStart);
        /* 手势区不吃滚动/缩放：三张可玩卡都是定高布局，手指划动全部交给游戏。
           旧样式下纵向划会带着卡片滚，手指一离开再回来坐标就错位。 */
        host.style.touchAction = 'none';
        host.style.webkitUserSelect = 'none';
        host.style.userSelect = 'none';
        host.style.webkitTouchCallout = 'none';
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
        host.removeEventListener('pointercancel', onCancel);
        host.removeEventListener('touchcancel', onCancel);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('touchcancel', onCancel);
        host.removeEventListener('contextmenu', onCtxMenu);
        host.removeEventListener('selectstart', onSelectStart);
        host.style.touchAction = '';
        host.style.webkitUserSelect = '';
        host.style.userSelect = '';
        host.style.webkitTouchCallout = '';
        activeId = null;
        st._ptrDown = false;
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

  /* 场景顶部的计数（已摇下 N 颗 / 新鲜 N / 已洗净 N）——
     垫一层半透明药丸，压到窗户/树冠/水柱上也能读清，不靠背景。 */
  function drawCountTag(ctx, text, cx, cy, S, color) {
    const fs = 10.5 * S;
    ctx.save();
    ctx.font = '600 ' + fs + 'px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const ph = fs * 1.95, pw = tw + fs * 2.1;
    ctx.globalAlpha = 0.66;
    ctx.fillStyle = 'rgba(12,8,22,0.72)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
    else ctx.rect(cx - pw / 2, cy - ph / 2, pw, ph);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color || 'rgba(255,232,200,0.94)';
    ctx.fillText(text, cx, cy);
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
      /* 20261114：NaN 自愈。approach() 对 NaN 是「永远 NaN」，一旦被污染，
         南瓜会永远画在画布外（玩家看到的就是「点亮后整只南瓜消失、只剩一个圈」）。
         这里每帧检查一次，非有限数就复位到默认位置，不需要玩家重进卡片。 */
      if (!Number.isFinite(st.pcx) || !Number.isFinite(st.pcy)) { st.pcx = W * 0.5; st.pcy = H * 0.62; }
      if (!Number.isFinite(st.pcxT) || !Number.isFinite(st.pcyT)) { st.pcxT = st.pcx; st.pcyT = st.pcy; }
      if (!Number.isFinite(st.lit)) st.lit = 0;
      if (!Number.isFinite(st.float)) st.float = 0;
      if (!Number.isFinite(st.pressT)) st.pressT = 0;
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
  function drawAppleFilling(ctx, cx, cy, r, ry, n, k, sugared, dim) {
    const cnt = Math.max(0, Math.min(EVE_FILL_SLOTS.length, Math.round(n)));
    if (cnt <= 0) return;
    const baked = clamp(k / 4, 0, 1);          // 烤的程度：片从奶白慢慢烤成琥珀

    // ① 馅底色：熬过的苹果酱（焦糖化），中心受光、边缘压暗
    /* 20261116 第七轮（玩家）：「几乎没馅」「皮比馅多」两炉看起来像一坑泥 ——
       因为馅底不分多少都把整个派面铺满了深棕。现在覆盖半径跟着片数缩：
       片少 → 只在中间熬出一小圈馅，四周是烤得金黄的派皮；
       塞满 → 铺到边沿，靠卷边收住。边缘加一段透明过渡，不留下硬圆边。 */
    const cov = 0.44 + 0.56 * clamp(cnt / EVE_FILL_SLOTS.length, 0, 1);
    /* 片特别少的时候（几乎没馅），底下不该是一汪深褐色的酱 ——
       那看起来像糊了一坑焦糖。少馅时改成「烤干的派皮内壁」色，
       这样读起来是「皮多馅少」，不是「酱烧糊了」。 */
    const dryPan = cnt <= 5;
    const cIn = dryPan ? mixC('#c8a068', '#a37b3e', baked) : mixC('#b3711f', '#77400c', baked * 0.55);
    const cMid = dryPan ? mixC('#a87f45', '#7d5628', baked) : mixC('#8f5013', '#4f2406', baked * 0.55);
    const cOut = dryPan ? mixC('#8a6733', '#5c3d18', baked) : mixC('#68360c', '#2e1403', baked * 0.55);
    const fg = ctx.createRadialGradient(cx - r * 0.14, cy - ry * 0.34, r * 0.05, cx, cy, r * cov);
    fg.addColorStop(0, cIn);
    fg.addColorStop(0.55, cMid);
    fg.addColorStop(0.86, cOut);
    fg.addColorStop(1, 'rgba(46,20,3,0)');
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.955 * cov, ry * 0.955 * cov, 0, 0, TAU);
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
      /* dim：成品阶段顶部已经有一圈整齐的苹果片，馅层这十几片如果还那么清楚，
         两层片叠在一起就成了「撒了一把杏仁」。这里把它们压成底纹。 */
      const dk = dim || 0;
      ctx.globalAlpha = 1 - 0.62 * dk;
      const flesh = baked <= 0.04 ? '#f8ebc9' : mixC('#f8ebc9', '#e0a457', baked);
      const edge = baked <= 0.04 ? '#e5cd9a' : mixC('#e5cd9a', '#b06b26', baked);
      drawWedge(ctx, sr, s.rot, mixC(flesh, '#96561a', 0.45 * dk), mixC(edge, '#7a4410', 0.45 * dk));
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

  /* ---------- 顶部那一圈苹果片（20261116 第七轮） ----------
     玩家原话：「苹果应该是最上面也会很规整的摆一圈，码得很整齐」。
     这一圈不参与「馅够不够」的判定，只是成品该有的样子：沿卷边内侧等距排开，
     片的长轴一律走切线方向（一圈片层层压着，才是码上去的，不是撒上去的）。
     片数由 opt.fill 换算 —— 馅少的派只码几片，不会凭空变满。 */
  function drawAppleRing(ctx, cx, cy, r, ry, n, k, bright) {
    const baked = clamp(k / 4, 0, 1);
    const br = bright || 0;
    /* 20261116 第八轮（玩家）：试过「弧形瓦」——一片片连起来像切好的八块点心；
       又试过「斜切口弯瓦」——像贴上去的纸片。都不对。
       回到「一圈统一的椭圆苹果片」，但把三件事调好：
         ① 片沿半径方向、朝心，一圈看起来才是「码上去的」；
         ② 片够宽够厚（不再是细杏仁），相邻两片之间的空隙很窄；
         ③ 描边改成软阴影，不要硬亮边 —— 硬边一出现就像贴纸。 */
    const ringR = 0.655;
    const sr = r * 0.315;
    const flesh = mixC(mixC('#f5dc9f', '#dda45a', baked), '#fdeac2', 0.55 * br);
    const edge = mixC(mixC('#cd8c39', '#96510f', baked), '#dd9c48', 0.45 * br);
    const list = [];
    for (let i = 0; i < n; i++) list.push(-Math.PI / 2 + (i / n) * TAU);
    /* 从远到近画：靠下的片压住靠上的片，这一圈才有厚度 */
    list.sort((p, q) => Math.sin(p) - Math.sin(q));
    for (let idx = 0; idx < list.length; idx++) {
      const a = list[idx];
      const px = cx + Math.cos(a) * r * ringR;
      const py = cy + Math.sin(a) * ry * ringR;
      ctx.save();
      ctx.translate(px, py);
      // 接触阴影：片与派面之间那道缝
      ctx.beginPath();
      ctx.ellipse(sr * 0.06, sr * 0.22, sr * 0.78, sr * 0.32, 0, 0, TAU);
      ctx.fillStyle = 'rgba(58,26,4,0.24)';
      ctx.fill();
      ctx.scale(1, 0.70);
      ctx.rotate(a);
      /* 每片亮度只差一点点（±4%）：差多了就是「一堆不同材质的贴纸」 */
      const jit = (pieHash(idx * 4.7 + 2.2) - 0.5) * 0.08;
      const fl = mixC(flesh, jit > 0 ? '#fff3d6' : '#cfa05c', Math.abs(jit));
      const eg = mixC(edge, jit > 0 ? '#e6ae60' : '#8a4a10', Math.abs(jit));
      const pg = ctx.createRadialGradient(-sr * 0.16, -sr * 0.10, sr * 0.02, 0, 0, sr * 0.66);
      pg.addColorStop(0, mixC(fl, '#fffdf4', 0.62));
      pg.addColorStop(0.55, fl);
      pg.addColorStop(1, eg);
      ctx.beginPath();
      ctx.ellipse(0, 0, sr * 0.615, sr * 0.315, 0, 0, TAU);
      ctx.fillStyle = pg;
      ctx.fill();
      // 软描边：只是把片和派面分开，不抢眼
      ctx.strokeStyle = 'rgba(140,82,26,0.30)';
      ctx.lineWidth = Math.max(0.7, sr * 0.045);
      ctx.stroke();
      /* 不再画那条「种子上的一道白高光」——它就是让片看起来像瓜子的元凶。
         受光改由上面的径向渐变承担，片身只留极淡的一点湿润感。 */
      ctx.beginPath();
      ctx.ellipse(-sr * 0.10, -sr * 0.075, sr * 0.30, sr * 0.14, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.06 + 0.08 * br).toFixed(3) + ')';
      ctx.fill();
      ctx.restore();
    }
  }

  /* 「几乎没馅」那一炉：整张派皮上只有中间孤零零两片苹果。
     玩家要的是「苹果只在最中间留了个影子」—— 片要看得清，
     但只有两片、挤在中心，四周全是烤得干爽的派皮。 */
  function pieFewSlices(ctx, cx, cy, r, S, e) {
    const ry = r * 0.40;
    const POS = [
      { u: -0.13, v: -0.03, rot: -0.58 },
      { u: 0.14, v: 0.04, rot: 0.54 },
    ];
    ctx.save();
    ctx.globalAlpha = e;
    for (const p of POS) {
      const px = cx + p.u * r;
      const py = cy + p.v * ry * 2.0;
      const sr = r * 0.235;
      // 先压一层浅影：片是嵌在派皮里的，不是摆在上面
      ctx.beginPath();
      ctx.ellipse(px, py + sr * 0.18, sr * 0.92, sr * 0.44, 0, 0, TAU);
      ctx.fillStyle = 'rgba(60,28,6,0.26)';
      ctx.fill();
      ctx.save();
      ctx.translate(px, py);
      drawWedge(ctx, sr, p.rot, '#f9ecca', '#d9b979');
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---------- 夹心层（塞满/流心那几炉） ----------
     玩家要的是「中间有夹心、顶上这层也有区别」：
     在中心再码一小圈紧凑的苹果片、底下垫一层发亮的糖心，
     这样透过密网格看下去能读成「两层馅」，而不是糊成一团。 */
  function drawPieCore(ctx, cx, cy, r, ry, k) {
    const baked = clamp(k / 4, 0, 1);
    const cg = ctx.createRadialGradient(cx, cy - ry * 0.12, r * 0.02, cx, cy, r * 0.44);
    cg.addColorStop(0, 'rgba(255,232,168,' + (0.95 - 0.22 * baked).toFixed(3) + ')');
    cg.addColorStop(0.50, 'rgba(246,178,84,' + (0.74 - 0.16 * baked).toFixed(3) + ')');
    cg.addColorStop(1, 'rgba(214,130,44,0)');
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.52, ry * 0.52, 0, 0, TAU);
    ctx.fillStyle = cg;
    ctx.fill();
    // 中心四小片：紧凑地围住圆心，让「夹心」有实体
    const flesh = baked <= 0.04 ? '#f9eecd' : mixC('#f9eecd', '#e3a95e', baked);
    const edge = baked <= 0.04 ? '#e7d09e' : mixC('#e7d09e', '#b4702a', baked);
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i / 4) * TAU + 0.4;
      const px = cx + Math.cos(a) * r * 0.27;
      const py = cy + Math.sin(a) * ry * 0.27;
      ctx.save();
      ctx.translate(px, py);
      drawWedge(ctx, r * 0.155, a + Math.PI / 2, flesh, edge);
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
        clamp(opt.fill, 0, 1) * EVE_FILL_SLOTS.length, k, !!opt.sugared,
        opt.topRing > 0 ? clamp(opt.lattice || 0, 0, 1) * 0.95 : 0);
      ctx.restore();
    }

    // ⑥-b 夹心层：塞满的那几炉，中心多一层（画在网格之下，透过缝看得到两层）
    if (opt.core && opt.fill > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.955, ry * 0.955, 0, 0, TAU);
      ctx.clip();
      drawPieCore(ctx, cx, cy, r, ry, k);
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
      /* 20261116 第七轮：网格加密后条数翻倍，原来那层压暗如果照旧会叠成一片黑，
         于是馅和苹果片全糊掉。压暗降到 0.10~0.20，片才亮得起来。 */
      ctx.fillStyle = 'rgba(52,22,4,' + (0.10 + 0.10 * clamp(k / 4, 0, 1)).toFixed(3) + ')';
      ctx.fillRect(cx - r, cy - ry, r * 2, ry * 2);
      // 卷边内侧再压一圈内阴影：格子里才有「凹下去」的深度，不像贴纸
      const ig = ctx.createRadialGradient(cx, cy, r * 0.52, cx, cy, r * 0.99);
      ig.addColorStop(0, 'rgba(40,16,2,0)');
      ig.addColorStop(1, 'rgba(40,16,2,' + (0.20 * lat).toFixed(3) + ')');
      ctx.fillStyle = ig;
      ctx.fillRect(cx - r, cy - ry, r * 2, ry * 2);
      const stripW = Math.max(2.0, r * 0.055);
      /* 20261116 第七轮（玩家）：饼皮条原来 step 0.46r、只铺 ±3 条，
         裁进派里只剩四根，看着像敷衍。现在 0.245r、铺 ±7 条 ——
         每个方向都有七八根，编得密、折叠多，才像折叠过的派皮。 */
      const step = r * 0.245;
      // 第 1 组（压在下面，偏暗）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(0.52);
      ctx.strokeStyle = mixC(bakeColor(k), '#5c3008', 0.30);
      ctx.lineWidth = stripW;
      ctx.lineCap = 'butt';
      for (let i = -7; i <= 7; i++) {
        const yy = i * step;
        ctx.beginPath(); ctx.moveTo(-r * 1.15, yy); ctx.lineTo(r * 1.15, yy); ctx.stroke();
      }
      ctx.restore();
      // 第 2 组（压在上面，偏亮 + 一条高光边，看起来就像编起来的）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.52);
      for (let i = -7; i <= 7; i++) {
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


    // ⑦-b 顶部那一圈苹果片：**画在卷边和蛋液之后**，才压得住卷边的内阴影
    if (opt.topRing > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.99, ry * 0.99, 0, 0, TAU);
      ctx.clip();
      drawAppleRing(ctx, cx, cy, r, ry, opt.topRing, k, opt.ringBright || 0);
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
      /* 判定语现在是每一档一句完整的话（最长 40 字左右）。
         旧做法只缩字号：缩到 8S 就停，长句仍会顶出画布、还会小到看不清。
         现在分两步：能缩就缩（缩到 9.2S 为止），仍放不下就按标点折成两行。 */
      const maxW = W * 0.88;
      /* 20261116 第七轮（玩家）：判定语跟标题贴太紧，且字偏小。
         基准 10.5S → 11.6S，最小 9.2S → 10S；与标题的间距 19S → 27S。 */
      const baseFs = 11.6 * S;
      ctx.font = baseFs + 'px system-ui, -apple-system, sans-serif';
      const tw = ctx.measureText(sub).width;
      let lines = [sub];
      let fs = baseFs;
      if (tw > maxW) {
        const fit = Math.max(10 * S, baseFs * maxW / tw);
        ctx.font = fit + 'px system-ui, -apple-system, sans-serif';
        if (ctx.measureText(sub).width <= maxW) {
          fs = fit;
        } else {
          // 折两行：优先在标点后断，没有标点就取中点
          const half = sub.length / 2;
          let cut = -1, bestD = 1e9;
          const marks = '，。！？；：、—…';
          for (let i = 1; i < sub.length - 1; i++) {
            if (marks.indexOf(sub[i]) >= 0) {
              const d = Math.abs(i - half);
              if (d < bestD) { bestD = d; cut = i; }
            }
          }
          if (cut < 0 || bestD > sub.length * 0.30) cut = Math.ceil(half) - 1;
          lines = [sub.slice(0, cut + 1), sub.slice(cut + 1)];
          // 两行各占一半宽，字号可以回到接近原尺寸
          fs = 11 * S;
          ctx.font = fs + 'px system-ui, -apple-system, sans-serif';
          const wMax = Math.max(ctx.measureText(lines[0]).width, ctx.measureText(lines[1]).width);
          if (wMax > maxW) fs = Math.max(9.6 * S, fs * maxW / wMax);
          ctx.font = fs + 'px system-ui, -apple-system, sans-serif';
        }
      }
      ctx.fillStyle = 'rgba(246,232,214,0.80)';
      const lh = fs * 1.28;
      /* 两行时以原位为中心上下对称展开：整块不往下长，免得压住「点一下重做」 */
      const y0 = y + 27 * S - (lines.length - 1) * lh * 0.5;
      lines.forEach((ln, i) => {
        ctx.fillText(ln, W * 0.5, y0 + i * lh);
      });
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
        /* 20261116：前置三个流程（玩家点名要的「从树上到案板」）——
           ⓪ shake 摇树摘果 → ⓪-2 pick 挑出新鲜果 → ⓪-3 wash 洗净 → ① board 切苹果。
           后面 ②~⑦ 一字未动，所以「切/撒糖/装盘/刷蛋液/烤/出炉」的手感与上一版完全一致。 */
        phase: 'shake',       // 起点从切苹果前移到摇苹果树
        phaseT: 0,            // 本阶段已经过的时间（过场动画靠它推进）
        fade: 1,              // 场景淡入
        doneK: 0,             // 出炉后的成品升起进度
        // —— ⓪ 摇树摘果
        treeReady: false,     // 树/篮/枝头苹果是否已按当前画布尺寸摆好
        treeApples: [],       // 还挂在枝头的苹果 [{x,y,r,rot,no}]
        dropApples: [],       // 正在下落的苹果（抛物线）
        basket: [],           // 已落进篮子的苹果
        shakeAmp: 0,          // 树的摆幅 0~1（拖动时涨、松手衰减）
        shakeAcc: 0,          // 本次按住累计的横向位移（够一格就掉一颗）
        shakeDir: 0,          // 上一次的拖动方向（±1，反转时额外加摆幅）
        shakeOn: false,       // 这一按是不是按在树上
        shakeCount: 0,        // 已摇下来的颗数
        // —— ⓪-2 挑果（篮子里 4 好 2 坏，好果挑进木台，坏果拨进废料筐）
        pickReady: false,
        pick: [],             // [{bad,state:'in'|'fly'|'ok'|'out',x,y,tx,ty,r,rot,vr}]
        pickOut: 0,           // 已挑出的好果数
        pickBadOut: 0,        // 已拨走的坏果数
        pickBadIn: 0,         // 20261116：混进木盘的坏果数（结算按它降级）
        pickGoodOut: 0,       // 20261116：被丢进废料筐的好果数（少一份馅）
        badRatio: 0,          // 20261116：进案板时算好的坏果率（结算与台词共用）
        pickAllAt: -1,        // 旧字段：原来「分完自动去洗果」用的，已改成点空白才走，保留只为老存档/调试兼容
        // —— ⓪-3 洗果
        washReady: false,
        wash: [],             // [{x,y,r,clean,wet,ph}]
        washHold: false,
        washDoneAt: -1,
        washProgress: 0,      // 平均洗净度 0~1
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

      /* ===== ⓪ 摇树摘果（20261116 新增）=====
         按住树干左右摇 → 摆幅越大幅度越高 → 每摇够一段距离掉一颗苹果 →
         苹果抛物线落进右下角的木篮 → 枝头空了再停 0.9 秒，自动进「挑果」。 */
      if (st.phase === 'shake') {
        if (!st.treeReady && W) eveOrchardLayout(st, W, H);
        st.shakeAmp = approach(st.shakeAmp, 0, 2.0, dt);   // 松手后自己停下来
        for (let i = st.dropApples.length - 1; i >= 0; i--) {
          const a = st.dropApples[i];
          a.vy += 1500 * S * dt;
          a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.vr * dt;
          if (a.y >= a.ty) {
            st.dropApples.splice(i, 1);
            st.basket.push({ x: a.x, y: a.ty, r: a.r, rot: rand(-0.5, 0.5), bad: a.bad, no: a.no, bounce: 1 });
          }
        }
        // 落进篮子后轻轻弹一下（纯视觉，不影响落点）
        for (const b of st.basket) if (b.bounce > 0) b.bounce = Math.max(0, b.bounce - dt * 2.2);
        if (!st.treeApples.length && !st.dropApples.length && st.phaseT > 0.9) eveStartPick(st, W, H, S);
      }

      /* ===== ⓪-2 挑果：点好果 → 飞进左边木台；点坏果 → 拨进右下废料筐 ===== */
      if (st.phase === 'pick') {
        if (!st.pickReady && W) evePickLayout(st, W, H);
        if (st.pickHintT > 0) st.pickHintT = Math.max(0, st.pickHintT - dt);
        for (const a of st.pick) {
          if (a.state === 'drag') { a.lift = Math.min(1, (a.lift || 0) + dt * 5); continue; }
          if (a.state === 'back') {                     // 放错了：飘回原位
            a.lift = Math.max(0, (a.lift || 0) - dt * 4);
            a.x = approach(a.x, a.tx, 8, dt);
            a.y = approach(a.y, a.ty, 8, dt);
            a.rot = approach(a.rot, a.trot || 0, 7, dt);
            if (Math.hypot(a.x - a.tx, a.y - a.ty) < 1.4 * S) {
              a.x = a.tx; a.y = a.ty; a.rot = a.trot || 0;
              a.state = 'in'; a.lift = 0;
            }
            continue;
          }
          if (a.state !== 'fly') continue;
          a.x = approach(a.x, a.tx, 9, dt);
          a.y = approach(a.y, a.ty, 9, dt);
          a.rot = approach(a.rot, a.trot || 0, 8, dt);
          a.lift = Math.max(0, (a.lift || 0) - dt * 4);
          if (Math.hypot(a.x - a.tx, a.y - a.ty) < 1.4 * S) {
            a.x = a.tx; a.y = a.ty; a.rot = a.trot || 0;
            // 20261116：落位后的状态看「进了哪个容器」，不再看好坏 ——
            //   坏果进木盘也要算「已挑好」，它后面会被切进派里。
            a.state = a.inTray ? 'ok' : 'out';
          }
        }
        /* ★ 20261116（玩家要求）：**不再自动推进**。
           以前「全部分拣完 → 停 0.8 秒自动去洗」，导致刚放好的果子没机会改 ——
           玩家要的是：只要还没点空白进下一步，盘里/筐里的果子都能再拖出来重放。
           所以这里只保留松手落位，进水洗完全交给「点空白」那个动作。 */
      }

      /* ===== ⓪-3 洗果：按住在水龙头下左右抹，四颗都洗到发亮才放上案板 ===== */
      if (st.phase === 'wash') {
        if (!st.washReady && W) eveWashLayout(st, W, H);
        let sum = 0;
        for (const a of st.wash) {
          if (a.clean < 1) a.clean = clamp(a.clean, 0, 1);
          if (a.wet > 0) a.wet = Math.max(0, a.wet - dt * 0.22);
          sum += a.clean;
        }
        st.washProgress = st.wash.length ? sum / st.wash.length : 0;
        if (st.washProgress >= 0.999 && st.washDoneAt < 0) st.washDoneAt = st.phaseT;
        if (st.washDoneAt >= 0 && st.phaseT - st.washDoneAt > 0.75) eveStartBoard(st);
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
      /* ⓪-2 挑果：拖着走。手指有偏移也算，苹果始终在指腹上方一点，不被手指挡住 */
      if (st.phase === 'pick') {
        const a = st.grab;
        if (!a || a.state !== 'drag' || !st._ptrDown) {
          // 空手划过空白 → 这一次就不算「点空白跳关」了（玩家的本意是拖，不是点）
          /* 20261116 真机：阈值原来 10*S，手机上 S≈2.8 只剩 9~10 CSS px，
             手指点按时正常抖动就能超过去 → 玩家觉得「点了没反应」。
             空手划动在挑果阶段没有别的用途，放宽到 16*S（≈15 CSS px）不影响判断。 */
          if (st._pickTap && Math.hypot(x - st._pickTapX, y - st._pickTapY) > 16 * S) st._pickTapMoved = true;
          return;
        }
        a.x = clamp(x + st.grabDX, W * 0.05, W * 0.95);
        a.y = clamp(y + st.grabDY - W * 0.035, H * 0.36, H * 0.80);
        a.lift = Math.min(1, (a.lift || 0) + 0.20);
        return;
      }
      /* ⓪ 摇树：横向拖动累积摆幅；左右换向额外加一把劲（真摇树就是来回晃） */
      if (st.phase === 'shake') {
        if (!st.shakeOn || !st._ptrDown) return;
        const dx = x - px;
        if (!dx) return;
        const ad = Math.abs(dx);
        st.shakeAmp = clamp(st.shakeAmp + ad / (W * 0.16), 0, 1);
        const dir = dx > 0 ? 1 : -1;
        if (st.shakeDir && dir !== st.shakeDir) st.shakeAmp = clamp(st.shakeAmp + 0.10, 0, 1);
        st.shakeDir = dir;
        st.shakeAcc += ad;
        if (st.shakeAcc >= W * 0.13 && st.treeApples.length) {
          st.shakeAcc = 0;
          eveDropOne(st, W, H, S);
        }
        return;
      }
      /* ⓪-3 洗果：按住在苹果上左右抹，抹的长度换算成洗净度 */
      if (st.phase === 'wash') {
        if (!st.washHold || !st._ptrDown) {
          if (st._washTap && Math.hypot(x - st._washTapX, y - st._washTapY) > 16 * S) st._washTapMoved = true;
          return;
        }
        const ad = Math.abs(x - px) + Math.abs(y - py);
        for (const a of st.wash) {
          if (a.clean >= 1) continue;
          if (Math.hypot(x - a.x, y - a.y) > a.r * 1.55) continue;
          a.clean = clamp(a.clean + ad / (W * 0.30) * 0.55, 0, 1);
          a.wet = 1;
        }
        return;
      }
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
      st.shakeOn = false;      // ⓪ 松手 → 树自己停下来
      st.washHold = false;     // ⓪-3 松手 → 停止擦洗
      /* ⓪-2 挑果：松手结算——落在木盘/废料筐才算放下，放错弹回 */
      if (st.phase === 'pick') {
        if (st.grab) { evePickRelease(st); return; }
        /* 20261116（玩家要求）：哪怕没分完，只要在空白处「单纯点一下」就进洗果。
           这里刻意要求那一下没有滑动（_pickTapMoved）—— 拖着果子划过空白抬手，
           不算点击，不能把玩家正在分拣的那一局提前结束。 */
        const tap = st._pickTap && !st._pickTapMoved;
        st._pickTap = false; st._pickTapMoved = false;
        if (tap) {
          const W = st._W, H = st._H, S = st._S;
          if (!W) return;
          // 盘里一颗都没有就不放行：空盘去洗、再切，出来只能是个没有馅的派皮
          if (!(st.pickOut > 0)) { evePickSay(st, '先挑一颗放进木盘，再点空白去洗', true); return; }
          eveStartWash(st, W, H, S);
        }
        return;
      }
      /* ⓪-3 洗果：没洗完也能点空白直接上案板（洗到什么程度算什么程度，结算按洗净度算） */
      if (st.phase === 'wash') {
        const tap = st._washTap && !st._washTapMoved;
        st._washTap = false; st._washTapMoved = false;
        if (tap && st._W) eveStartBoard(st);
        return;
      }
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
      /* ⓪ 摇树：按在树干/树冠上才算「抓住树」，按空白不摇 */
      if (st.phase === 'shake') {
        const g = eveTreeGeom(W, H);
        const onTree = Math.abs(x - g.trunkX) < W * 0.16 && y > H * 0.44 && y < H * 0.86;
        st.shakeOn = onTree;
        st.shakeAcc = 0;
        st._ptrDown = true;
        return;
      }
      /* ⓪-2 挑果：按住哪颗就「拎起」哪颗，全程玩家自己拖。
         20261116：这里不判好坏 —— 好坏只在松手那一刻记账（坏果混进木盘会被切进派里）。 */
      if (st.phase === 'pick') {
        st._ptrDown = true;
        st.grab = null;
        st._pickTap = false; st._pickTapMoved = false;
        /* ★ 20261116：篮子里（in）、木盘里（ok）、废料筐里（out）都能重新拎起来。
           拎出一颗已分好的，就先把它的账撤掉（place 清空 + 重算 + 重排），
           松手时再按落点重新记 —— 全程不点空白，就可以一直改。 */
        for (const a of st.pick) {
          if (a.state !== 'in' && a.state !== 'ok' && a.state !== 'out') continue;
          if (Math.hypot(x - a.x, y - a.y) <= a.r * 1.7) {
            st.grab = a;
            st.grabDX = a.x - x; st.grabDY = a.y - y;
            if (a.place) { a.place = ''; evePickRecount(st); }
            a.state = 'drag'; a.lift = 0;
            st.pickHint = ''; st.pickHintT = 0;
            break;
          }
        }
        /* 20261116（玩家要求）：没抓着果的那一下先记下来 —— 抬手时若「没滑动过」，
           就是一次明确的「点空白」，直接去洗果；拖动经过空白不算。 */
        if (!st.grab) { st._pickTap = true; st._pickTapX = x; st._pickTapY = y; }
        return;
      }
      /* ⓪-3 洗果：按在任意一颗上就算开始擦 */
      if (st.phase === 'wash') {
        st._ptrDown = true;
        st.washHold = false;
        st._washTap = false; st._washTapMoved = false;
        for (const a of st.wash) {
          if (Math.hypot(x - a.x, y - a.y) <= a.r * 1.6) { st.washHold = true; a.wet = 1; break; }
        }
        // 同上：按在苹果之外的地方，抬手没滑动就算一次「点空白」→ 直接上案板
        if (!st.washHold) { st._washTap = true; st._washTapX = x; st._washTapY = y; }
        return;
      }
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
        /* 20261116：没洗干净要真的扣分，否则「点空白跳过洗果」就是白赚时间。
           四档：干净 0 / 略脏 -4 / 没洗净 -9 / 带泥 -15。 */
        const washPenalty = [0, 4, 9, 15][clamp(st.dirty || 0, 0, 3)];
        st.washPenalty = washPenalty;
        st.total = clamp(sliceScore + st.sugarScore + st.coatScore + bakeScore - washPenalty, 0, 100);
        /* 20261116：有坏果、或没洗干净，都绝不可能是「最完美的苹果派」。 */
        st.isPerfect = (st.cookResult === 'perfect' && inGold && n === EVE_FULL_SLICES &&
          st.trash === 0 && st.sugarScore >= 20 && st.coatScore >= 20 &&
          (st.badRatio || 0) <= 0 && (st.dirty || 0) === 0);
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
            // 20261116：坏果率一并带给卡片，送出时的台词要按它换口气
            badRatio: Number((st.badRatio || 0).toFixed(3)), badN: st.pickBadIn || 0,
            // 20261116：洗净档也带出去 —— 送派那句话要和结算页说的是同一件事
            dirty: clamp(st.dirty || 0, 0, 3), washP: Number((st.washP || 0).toFixed(3)),
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
  /* ============================================================
   * 20261116 新增：苹果派的前三个流程
   *   ⓪ 摇树摘果 → ⓪-2 挑出新鲜果 → ⓪-3 洗净 → ① 切苹果（原有）
   * 三段共用同一套「暖色厨房 + 木器」配色，和后面的案板/派盘接得上。
   * 所有坐标都按 W/H 归一化，卡片多宽都适配（与其余场景一致）。
   * ============================================================ */

  /* 苹果树的几何：树干在左，木篮在右下 —— 摇下来的果子才有「飞过去」的距离感。
     20261116 排版修正：整组元素必须收在 0.79H 以内 —— 卡片底部还有一句寄语（约 0.80H）
     和操作提示条（0.845H），上一版把地面画到 0.85H，篮子和提示条直接压住了文字。 */
  function eveTreeGeom(W, H) {
    return {
      trunkX: W * 0.300,
      trunkW: W * 0.055,
      trunkTop: H * 0.500,
      groundY: H * 0.760,
      crownX: W * 0.300,
      crownY: H * 0.515,
      crownR: W * 0.195,
      basketX: W * 0.755,
      basketY: H * 0.700,
      basketRx: W * 0.105,
      basketRy: W * 0.055,
    };
  }

  /* 摆树：6 颗苹果按「固定相对位」挂在树冠上。
     固定而不是随机 —— 玩家每次重玩看到的是同一棵树，才好比较手感；
     其中第 3、第 6 颗是坏果（摇树阶段外观一样，挑果阶段才露馅）。 */
  function eveOrchardLayout(st, W, H) {
    const g = eveTreeGeom(W, H);
    const rel = [[-0.55, -0.28], [0.12, -0.52], [0.58, -0.20], [-0.34, 0.26], [0.38, 0.30], [-0.02, 0.02]];
    st.treeApples = rel.map((p, i) => ({
      x: g.crownX + p[0] * g.crownR * 0.80,
      y: g.crownY + p[1] * g.crownR * 0.80,
      r: W * 0.032,
      rot: rand(-0.3, 0.3),
      no: i,
      bad: (i === 2 || i === 5),
    }));
    st.basket = [];
    st.dropApples = [];
    st.treeReady = true;
  }

  /* 摇下来一颗：从枝头脱落 → 抛物线对准篮子 */
  function eveDropOne(st, W, H, S) {
    if (!st.treeApples.length) return;
    const idx = Math.floor(Math.random() * st.treeApples.length);
    const a = st.treeApples.splice(idx, 1)[0];
    const g = eveTreeGeom(W, H);
    const tx = g.basketX + rand(-0.045, 0.045) * W;
    const ty = g.basketY - g.basketRy * 0.10;   // 落点在篮口内侧，不会浮在篮沿上
    const vx = (tx - a.x) / 0.46;      // 按 ~0.46s 的下落时间预先配平水平速度
    st.dropApples.push({
      x: a.x, y: a.y, vx, vy: 40 * S, ty,
      rot: a.rot, vr: rand(-5, 5), r: a.r, bad: a.bad, no: a.no,
    });
    st.shakeCount = (st.shakeCount || 0) + 1;
  }

  /* 进挑果：把篮子里的 6 颗摆进篮口（3 列 × 2 行） */
  function evePickLayout(st, W, H) {
    const cols = [-0.55, 0, 0.55], rows = [-0.45, 0.45];
    const cx = W * 0.580, cy = H * 0.672, rx = W * 0.225, ry = W * 0.092;
    // 兜底：万一篮子里没有记录（调试跳阶段、或摇树被跳过），也要凑够 6 颗
    const src = (st.basket && st.basket.length) ? st.basket : [
      { bad: false, no: 0 }, { bad: false, no: 1 }, { bad: true, no: 2 },
      { bad: false, no: 3 }, { bad: false, no: 4 }, { bad: true, no: 5 },
    ];
    st.pick = src.map((b, i) => {
      const c = i % 3, r = Math.floor(i / 3) % 2;
      const px2 = cx + cols[c] * rx;
      const py2 = cy + rows[r] * ry;
      const hrot = rand(-0.4, 0.4);
      return {
        bad: !!b.bad, no: b.no == null ? i : b.no,
        state: 'in',
        place: '',                         // 还没分拣（进木盘 / 废料筐后才记）
        x: px2, y: py2,
        hx: px2, hy: py2, homeRot: hrot,   // 原点：放错了要弹回这里
        tx: 0, ty: 0, lift: 0,
        r: W * 0.040, rot: hrot, trot: 0,
      };
    });
    st.pickReady = true;
  }

  /* 挑果的两个投放点。判定用椭圆，偏大一圈，手指粗也放得进去。 */
  function evePickZone(x, y, W, H) {
    const tx = W * 0.160, ty = H * 0.598, trx = W * 0.150, try_ = W * 0.088;
    if (Math.pow((x - tx) / trx, 2) + Math.pow((y - ty) / try_, 2) <= 1) return 'tray';
    const wx = W * 0.130, wy = H * 0.712, wrx = W * 0.108, wry = W * 0.074;
    if (Math.pow((x - wx) / wrx, 2) + Math.pow((y - wy) / wry, 2) <= 1) return 'bin';
    return '';
  }

  function evePickSay(st, text, bad) {
    st.pickHint = text || '';
    st.pickHintT = text ? 1.7 : 0;
    st.pickHintBad = !!bad;
  }

  /* ★ 20261116（玩家要求）：已经分好的果子必须能**再拖出来重放** ——
     只要还没点空白进下一步，就一直在分拣这一局里。
     这就带来一个问题：旧代码是松手时 pickOut+1、只增不减，
     把盘里的果子再拖出来重放，计数只会越数越多（盘里显示 5 颗、其实只摆了 3 颗）。
     所以「账」改成从每颗果子自己的 place 重算一遍（tray / bin / 空），
     顺便把两个容器里的位置紧凑重排 —— 拖走一颗，后面的会自己补上来。
     place：'' 未分拣 / 'tray' 木盘（要切的）/ 'bin' 废料筐（丢的）。 */
  function evePickRecount(st) {
    let out = 0, badIn = 0, bin = 0, goodOut = 0;
    for (const a of st.pick) {
      if (a.place === 'tray') { out++; if (a.bad) badIn++; }
      else if (a.place === 'bin') { bin++; if (!a.bad) goodOut++; }
    }
    st.pickOut = out; st.pickBadIn = badIn;
    st.pickBadOut = bin; st.pickGoodOut = goodOut;

    const W = st._W, H = st._H;
    if (!W || !H) return;
    /* 木盘 4 个位一循环、废料筐 2 列一循环 —— 和原来松手时的排法一致，
       只是现在每次重算都会重排，位子永远紧凑、不会留空洞。 */
    const dxAll = [-0.048, 0.048, -0.048, 0.048];
    const dyAll = [-0.021, -0.021, 0.021, 0.021];
    let ti = 0, bi = 0;
    for (const a of st.pick) {
      let tx = a.tx, ty = a.ty;
      if (a.place === 'tray') {
        const k = ti++ % 4;
        tx = W * 0.155 + dxAll[k] * W;
        ty = H * 0.598 + dyAll[k] * H;
      } else if (a.place === 'bin') {
        const n = bi++;
        tx = W * 0.130 + ((n % 2) ? 0.020 : -0.020) * W;
        ty = H * 0.706 - Math.floor(n / 2) * H * 0.006;
      } else {
        continue;                       // 篮里 / 手上 / 弹回途中：不动它的目标
      }
      a.tx = tx; a.ty = ty;
      if ((a.state === 'ok' || a.state === 'out') && Math.hypot(a.x - tx, a.y - ty) > 0.6) {
        /* 位子变了 → 用一小段飞行补过去，别整颗瞬移 */
        a.state = 'fly';
        a.inTray = (a.place === 'tray');
      }
    }
  }

  /* 松手结算：木盘 / 废料筐都收，只有丢在空白处才弹回。
     20261116（玩家口径改）：拖错不再自动飘回原位 —— 分拣的意义就是「放错了要认」。
       · 坏果放进木盘 → 会被洗、被切、被烤进派里（pickBadIn 记数，结算按比例降级）；
       · 好果丢进废料筐 → 白白少一份馅（pickGoodOut 记数）；
       · 只有没放进任何容器才弹回（那不是放错，是没放）。 */
  function evePickRelease(st) {
    const a = st.grab;
    st.grab = null;
    if (!a || a.state !== 'drag') return;
    const W = st._W, H = st._H;
    if (!W) return;
    const zone = evePickZone(a.x, a.y, W, H);

    if (zone === 'tray') {                     // 木盘：好果坏果都收
      a.place = 'tray';
      a.trot = rand(-0.35, 0.35);
      a.state = 'fly';
      a.inTray = true;
      evePickRecount(st);
      if (a.bad) evePickSay(st, '这颗坏了，也会被切进派里', true);
      else evePickSay(st, '');
      return;
    }
    if (zone === 'bin') {                      // 废料筐：好果坏果都收
      a.place = 'bin';
      a.trot = rand(-1.2, 1.2);
      a.state = 'fly';
      a.inTray = false;
      evePickRecount(st);
      if (!a.bad) evePickSay(st, '这颗还新鲜，扔了可惜', true);
      else evePickSay(st, '');
      return;
    }

    // 没放进任何一个容器：弹回篮口
    a.place = '';
    a.state = 'back';
    a.tx = a.hx; a.ty = a.hy; a.trot = a.homeRot;
    evePickRecount(st);
    evePickSay(st, '放木盘或废料筐里才算挑完', true);
  }

  function eveStartPick(st, W, H, S) {
    st.phase = 'pick'; st.phaseT = 0; st.fade = 0;
    st.pickReady = false; st.pick = [];
    st.pickOut = 0; st.pickBadOut = 0; st.pickAllAt = -1;
    // 20261116：分拣账本 —— 盘里混了几颗坏果、筐里扔了几颗好果（结算按这两个数降级）
    st.pickBadIn = 0; st.pickGoodOut = 0;
    st.grab = null; st.pickHint = ''; st.pickHintT = 0; st.pickHintBad = false;
    evePickLayout(st, W, H);
    /* 20261116：先把规则说清楚 —— 放错不拦，但坏果混进木盘会被切进派里。
       不说的话玩家会以为「放错会自动弹回」，最后烤出一个发酸的派还以为出 bug。 */
    evePickSay(st, '坏果混进木盘，也会被切进派里', false);
  }

  /* 洗果：挑进木盘的果子一字排在水槽上方，数量跟着实际挑出的走。
     20261116：不再固定 4 颗 —— 玩家可能只留 2 颗、也可能 6 颗全留下；
     盘里混进来的坏果排在最后，洗不亮（带暗斑），洗的时候一眼能看出哪颗坏了。 */
  function eveWashLayout(st, W, H) {
    const n = clamp(Math.round(st.pickOut || 4), 1, 6);
    const spread = n <= 1 ? 0 : 0.56;
    const xs = [];
    for (let i = 0; i < n; i++) xs.push(n <= 1 ? 0.50 : 0.50 - spread / 2 + spread * i / (n - 1));
    const badN = clamp(Math.round(st.pickBadIn || 0), 0, n);
    st.wash = xs.map((k, i) => ({
      x: W * k, y: H * 0.682, r: W * (n > 4 ? 0.040 : 0.048),
      clean: 0, wet: 0, ph: i * 1.7,
      bad: i >= n - badN,          // 坏果排在最后
    }));
    st.washReady = true;
  }

  function eveStartWash(st, W, H, S) {
    st.phase = 'wash'; st.phaseT = 0; st.fade = 0;
    st.washReady = false; st.wash = []; st.washDoneAt = -1; st.washProgress = 0;
    eveWashLayout(st, W, H);
  }

  /* 洗好了 → 交回原有的切苹果流程（切之前的计数全部归零，保证判定干净） */
  function eveStartBoard(st) {
    st.phase = 'board'; st.phaseT = 0; st.fade = 0;
    st.cuts = 0; st.goodCuts = 0; st.trash = 0; st.plated = 0;
    /* 20261116：把分拣的结果带进案板 —— 盘里混了几颗坏果，按比例算坏果率。
       切的时候这整盘苹果被当成「一整个苹果」来切（10 片 = 一颗），
       所以坏果率直接按下刀片数摊到馅里，结算时用它降级。 */
    st.badRatio = clamp((st.pickBadIn || 0) / Math.max(1, st.pickOut || 1), 0, 1);
    /* 20261116（玩家要求）：洗果可以「没洗完就点空白上案板」，所以这里必须把洗净度
       定格带进结算，分四档 —— 全洗净 / 略脏（只在明细里提）/ 没洗净 / 带泥。
       洗到一半就切，代价在这一炉的评级里认。 */
    const wp = clamp(st.washProgress || 0, 0, 1);
    st.washP = wp;
    st.dirty = wp >= 0.999 ? 0 : wp >= 0.75 ? 1 : wp >= 0.45 ? 2 : 3;
    st.cutAngle = 0; st.knifeT = 0;
    st.slices.length = 0; st.crumbs.length = 0;
    st.hintSlowT = 0; st.dragAcc = 0; st._moved = false; st._tapApple = false;
  }

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
    /* 20261116：重播从「摇树」开始（不再是直接上案板），前置三段状态一并归零 */
    st.phase = 'shake'; st.phaseT = 0; st.fade = 0; st.doneK = 0;
    st.treeReady = false; st.treeApples.length = 0; st.dropApples.length = 0;
    st.basket.length = 0; st.shakeAmp = 0; st.shakeAcc = 0; st.shakeDir = 0;
    st.shakeOn = false; st.shakeCount = 0;
    st.pickReady = false; st.pick.length = 0; st.pickOut = 0; st.pickBadOut = 0; st.pickAllAt = -1;
    // 20261116：分拣账本与坏果率一并归零，重做不再继承上一炉的坏果
    st.pickBadIn = 0; st.pickGoodOut = 0; st.badRatio = 0;
    st.washReady = false; st.wash.length = 0; st.washHold = false;
    st.washDoneAt = -1; st.washProgress = 0;
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
    if (st.phase === 'shake') drawEveShake(st, ctx, t, W, H, S);
    else if (st.phase === 'pick') drawEvePick(st, ctx, t, W, H, S);
    else if (st.phase === 'wash') drawEveWash(st, ctx, t, W, H, S);
    else if (st.phase === 'board') drawEveBoard(st, ctx, t, W, H, S);
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

  /* ---------- 藤编木篮：后壁（含影子/内壁） + 前缘，中间留给你画苹果 ----------
     拆成前后两半，是为了让果子看起来「躺在篮子里」——
     苹果画完后再压一道前缘木边，底部就被篮沿挡住，不会像贴纸浮在篮口上。 */
  function drawEveBasketBack(ctx, cx, cy, rx, ry, S) {
    // 落地影子
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 1.55, rx * 0.92, ry * 0.40, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fill();
    // 篮体
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy);
    ctx.bezierCurveTo(cx - rx * 1.04, cy + ry * 1.35, cx - rx * 0.52, cy + ry * 1.66, cx, cy + ry * 1.66);
    ctx.bezierCurveTo(cx + rx * 0.52, cy + ry * 1.66, cx + rx * 1.04, cy + ry * 1.35, cx + rx, cy);
    ctx.closePath();
    const bg = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry * 1.7);
    bg.addColorStop(0, '#b0803f');
    bg.addColorStop(0.45, '#8d5f2c');
    bg.addColorStop(1, '#5f3d1c');
    ctx.fillStyle = bg;
    ctx.fill();
    // 编织横纹（三道，越往下越密）
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy);
    ctx.bezierCurveTo(cx - rx * 1.04, cy + ry * 1.35, cx - rx * 0.52, cy + ry * 1.66, cx, cy + ry * 1.66);
    ctx.bezierCurveTo(cx + rx * 0.52, cy + ry * 1.66, cx + rx * 1.04, cy + ry * 1.35, cx + rx, cy);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,214,160,0.16)';
    ctx.lineWidth = 1.6 * S;
    for (let i = 1; i <= 5; i++) {
      const yy = cy + ry * 0.30 * i;
      ctx.beginPath();
      ctx.moveTo(cx - rx, yy);
      ctx.quadraticCurveTo(cx, yy + ry * 0.28, cx + rx, yy);
      ctx.stroke();
    }
    // 竖编纹
    ctx.strokeStyle = 'rgba(60,36,14,0.22)';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * rx * 0.34, cy + ry * 0.10);
      ctx.lineTo(cx + i * rx * 0.30, cy + ry * 1.62);
      ctx.stroke();
    }
    ctx.restore();
    // 篮口内壁（深色，制造「里面是空的」的深度）
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fillStyle = '#3d2710';
    ctx.fill();
  }

  function drawEveBasketFront(ctx, cx, cy, rx, ry, S) {
    // 前缘木边（只压下半圈）+ 一点高光
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0.02 * Math.PI, 0.98 * Math.PI, false);
    ctx.strokeStyle = '#d9a763';
    ctx.lineWidth = 3.2 * S;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.96, ry * 0.94, 0, 0.10 * Math.PI, 0.90 * Math.PI, false);
    ctx.strokeStyle = 'rgba(255,232,190,0.42)';
    ctx.lineWidth = 1.1 * S;
    ctx.stroke();
  }

  /* 坏果标记：褐斑 + 虫眼（挑果阶段才用，摇树时果子外观一致） */
  function drawBadMarks(ctx, x, y, r, S) {
    ctx.save();
    ctx.fillStyle = 'rgba(92,58,26,0.55)';
    const spots = [[-0.34, -0.26, 0.21], [0.30, 0.06, 0.17], [-0.06, 0.46, 0.13]];
    for (const p of spots) {
      ctx.beginPath();
      ctx.ellipse(x + p[0] * r, y + p[1] * r, p[2] * r, p[2] * r * 0.82, 0.7, 0, TAU);
      ctx.fill();
    }
    // 虫眼：深色小孔 + 一圈被蛀空的浅色边
    ctx.beginPath();
    ctx.arc(x + r * 0.12, y - r * 0.20, r * 0.15, 0, TAU);
    ctx.fillStyle = '#2a190d';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,224,190,0.55)';
    ctx.lineWidth = Math.max(0.7, 0.8 * S);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- ⓪ 摇树摘果 ---------- */
  function drawEveShake(st, ctx, t, W, H, S) {
    const g = eveTreeGeom(W, H);
    const sway = Math.sin(t * 13) * st.shakeAmp;    // -1~1，摇得越狠摆得越大

    // 夜空：盖掉厨房那层暖光，换成院子里的夜色
    const sky = ctx.createLinearGradient(0, H * 0.38, 0, H);
    sky.addColorStop(0, 'rgba(26,20,46,0)');
    sky.addColorStop(0.34, 'rgba(23,18,42,0.72)');
    sky.addColorStop(1, 'rgba(16,12,28,0.96)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, H * 0.38, W, H * 0.62);
    // 星点（固定位置，只做呼吸）
    for (let i = 0; i < 14; i++) {
      const sx = W * ((i * 37) % 97) / 97;
      const sy = H * (0.40 + ((i * 23) % 17) / 100);
      ctx.globalAlpha = (0.18 + 0.30 * Math.abs(Math.sin(t * 0.8 + i))) * st.fade;
      ctx.fillStyle = '#ffeecb';
      ctx.beginPath();
      ctx.arc(sx, sy, 0.9 * S, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = st.fade;

    // 地面
    ctx.fillStyle = '#291f30';
    ctx.beginPath();
    ctx.moveTo(0, g.groundY);
    ctx.quadraticCurveTo(W * 0.5, g.groundY - H * 0.014, W, g.groundY);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,196,150,0.13)';
    ctx.lineWidth = 1.6 * S;
    ctx.beginPath();
    ctx.moveTo(0, g.groundY);
    ctx.quadraticCurveTo(W * 0.5, g.groundY - H * 0.014, W, g.groundY);
    ctx.stroke();

    // 树干（根部不动，越往上摆得越多）
    const lean = sway * 4 * S;
    ctx.beginPath();
    ctx.moveTo(g.trunkX - g.trunkW * 0.55, g.groundY);
    ctx.quadraticCurveTo(g.trunkX - g.trunkW * 0.34, H * 0.700, g.trunkX - g.trunkW * 0.26 + lean, g.trunkTop);
    ctx.lineTo(g.trunkX + g.trunkW * 0.26 + lean, g.trunkTop);
    ctx.quadraticCurveTo(g.trunkX + g.trunkW * 0.34, H * 0.700, g.trunkX + g.trunkW * 0.55, g.groundY);
    ctx.closePath();
    const tg = ctx.createLinearGradient(g.trunkX - g.trunkW * 0.5, 0, g.trunkX + g.trunkW * 0.5, 0);
    tg.addColorStop(0, '#4b3220');
    tg.addColorStop(0.42, '#6d4a2c');
    tg.addColorStop(1, '#3d2718');
    ctx.fillStyle = tg;
    ctx.fill();
    // 树皮竖纹
    ctx.strokeStyle = 'rgba(28,16,8,0.30)';
    ctx.lineWidth = 1 * S;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(g.trunkX + i * g.trunkW * 0.20, H * 0.640);
      ctx.quadraticCurveTo(g.trunkX + i * g.trunkW * 0.18 + lean * 0.6, H * 0.600, g.trunkX + i * g.trunkW * 0.16 + lean, g.trunkTop + 2 * S);
      ctx.stroke();
    }

    // 树冠：三层叠圆（深 → 中 → 亮），整体随摆幅平移
    const cx = g.crownX + sway * 8 * S, cy = g.crownY;
    const layers = [
      { dx: 0, dy: 0, r: 1.00, c: '#1d4530' },
      { dx: -0.32, dy: 0.10, r: 0.62, c: '#26563a' },
      { dx: 0.34, dy: 0.06, r: 0.60, c: '#2a6142' },
      { dx: -0.06, dy: -0.30, r: 0.58, c: '#2f6b48' },
    ];
    for (const L of layers) {
      ctx.beginPath();
      ctx.arc(cx + L.dx * g.crownR, cy + L.dy * g.crownR, g.crownR * L.r, 0, TAU);
      ctx.fillStyle = L.c;
      ctx.fill();
    }
    // 顶部受光
    const lit = ctx.createRadialGradient(cx - g.crownR * 0.30, cy - g.crownR * 0.42, 0, cx, cy, g.crownR * 1.05);
    lit.addColorStop(0, 'rgba(150,220,160,0.20)');
    lit.addColorStop(1, 'rgba(150,220,160,0)');
    ctx.fillStyle = lit;
    ctx.beginPath();
    ctx.arc(cx, cy, g.crownR * 1.02, 0, TAU);
    ctx.fill();

    // 枝头苹果（比树冠摆得更大一点，才有「被摇下来」的预期）
    for (const a of st.treeApples) {
      drawApple(ctx, a.x + sway * 11 * S, a.y + Math.sin(t * 13 + 0.6) * st.shakeAmp * 2.2 * S, a.r, a.rot + sway * 0.10);
    }

    // 正在下落的苹果
    for (const a of st.dropApples) {
      ctx.globalAlpha = st.fade * 0.28;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(a.x, g.groundY - 3 * S, a.r * 0.8, a.r * 0.28, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = st.fade;
      drawApple(ctx, a.x, a.y, a.r, a.rot);
    }

    // 篮子（先画后壁 → 画已落的苹果 → 压前缘）
    drawEveBasketBack(ctx, g.basketX, g.basketY, g.basketRx, g.basketRy, S);
    const shown = st.basket.slice(-6);
    shown.forEach((b, i) => {
      const bx = g.basketX + (i - (shown.length - 1) / 2) * g.basketRx * 0.46;
      const by = g.basketY - g.basketRy * 0.10 - (b.bounce || 0) * g.basketRy * 0.18;
      drawApple(ctx, bx, by, b.r * 0.92, (b.rot || 0) + 0.05 * i);
    });
    drawEveBasketFront(ctx, g.basketX, g.basketY, g.basketRx, g.basketRy, S);

    // 计数
    const total = 6;
    const got = (st.basket || []).length;
    drawCountTag(ctx, got >= total ? '六颗都摇下来了' : '已摇下 ' + got + ' / ' + total + ' 颗',
      W * 0.760, H * 0.600, S, got >= total ? '#ffd68c' : null);

    /* 20261116（玩家要求）：第一帧弹一张小提示窗，提醒「这一关要摇」。
       底部那条提示条离画面重心太远，玩家第一眼往往看不到树干是能按的；
       这张卡只在最前面几秒出现，且一真的摇起来（shakeAmp 上来）就自己退场，
       不挡操作、不打断节奏。放在 0.335H —— 树冠顶在 0.425H 左右，卡片压不到树。 */
    const tipIn = clamp(st.phaseT / 0.30, 0, 1);
    const tipOut = clamp((4.8 - st.phaseT) / 0.70, 0, 1);
    const tipAmp = clamp((0.22 - (st.shakeAmp || 0)) / 0.16, 0, 1);
    const tipK = tipIn * tipOut * tipAmp * clamp(st.fade, 0, 1);
    if (tipK > 0.012) {
      const cw = W * 0.74, chh = H * 0.088;
      const ccx = W * 0.5, ccy = H * 0.335;
      ctx.save();
      ctx.globalAlpha = tipK;
      // 卡片：深底 + 一圈暖色描边，和厨房/夜色的暖调接上
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(ccx - cw / 2, ccy - chh / 2, cw, chh, 12 * S);
      else ctx.rect(ccx - cw / 2, ccy - chh / 2, cw, chh);
      ctx.fillStyle = 'rgba(28,19,24,0.93)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,160,0.58)';
      ctx.lineWidth = 1.2 * S;
      ctx.stroke();
      // 标题 + 一行说明
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 ' + (14 * S) + 'px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#fff0d2';
      ctx.fillText('摇一摇苹果树', ccx, ccy - chh * 0.18);
      ctx.font = (11 * S) + 'px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(255,242,222,0.95)';
      ctx.fillText('按住树干，左右来回晃 · 把六颗苹果摇进篮子', ccx, ccy + chh * 0.24);
      ctx.restore();
    }

    drawHint(ctx,
      st.shakeAmp > 0.25 ? '摇得对，接着晃'
        : got >= total ? '果子齐了 · 该挑了'
          : '按住树干，左右摇一摇',
      W, H, S, '#ffe9cf');
  }

  /* ---------- ⓪-2 挑果 ---------- */
  function drawEvePick(st, ctx, t, W, H, S) {
    drawCounter(ctx, W, H, S);

    const bx = W * 0.580, by = H * 0.672, brx = W * 0.225, bry = W * 0.092;

    /* 左上角净果木盘（挑出来的好果摆这儿）。
       上一版是个圆角矩形，像贴了张便利贴；改成俯视的椭圆木盘，带木纹和内圈，
       和水槽、篮子同一套「木器」语言。 */
    const tx = W * 0.160, ty = H * 0.598;
    const trx = W * 0.118, try_ = W * 0.052;
    ctx.save();
    // 投影
    ctx.beginPath();
    ctx.ellipse(tx, ty + try_ * 1.15, trx * 0.96, try_ * 0.42, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    // 盘体（侧面厚度）
    ctx.beginPath();
    ctx.ellipse(tx, ty + try_ * 0.16, trx, try_ * 1.04, 0, 0, TAU);
    ctx.fillStyle = '#5b3a1c';
    ctx.fill();
    // 盘面
    ctx.beginPath();
    ctx.ellipse(tx, ty, trx, try_, 0, 0, TAU);
    const bg2 = ctx.createLinearGradient(0, ty - try_, 0, ty + try_);
    bg2.addColorStop(0, '#b0824a');
    bg2.addColorStop(0.55, '#8d6132');
    bg2.addColorStop(1, '#6a4522');
    ctx.fillStyle = bg2;
    ctx.fill();
    // 木纹（三道弧）
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(tx, ty, trx, try_, 0, 0, TAU);
    ctx.clip();
    ctx.strokeStyle = 'rgba(58,34,14,0.22)';
    ctx.lineWidth = 1 * S;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.ellipse(tx + i * trx * 0.22, ty, trx * 0.82, try_ * 0.86, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    // 内圈高光
    ctx.beginPath();
    ctx.ellipse(tx, ty - try_ * 0.06, trx * 0.90, try_ * 0.86, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(255,224,178,0.24)';
    ctx.lineWidth = 1.2 * S;
    ctx.stroke();
    ctx.restore();

    // 右下角废料筐（坏果拨这儿）
    const wx = W * 0.130, wy = H * 0.712;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(wx, wy + W * 0.026, W * 0.080, W * 0.026, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(wx - W * 0.075, wy);
    ctx.quadraticCurveTo(wx, wy + W * 0.090, wx + W * 0.075, wy);
    ctx.closePath();
    ctx.fillStyle = '#61452a';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(wx, wy, W * 0.075, W * 0.023, 0, 0, TAU);
    ctx.fillStyle = '#33210f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(214,170,120,0.45)';
    ctx.lineWidth = 1.4 * S;
    ctx.beginPath();
    ctx.ellipse(wx, wy, W * 0.075, W * 0.023, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    /* 拎着苹果时，两个投放点同时亮一圈（不区分对错 —— 对错由果子的样子决定，
       这里只告诉玩家"可以放这儿"）。 */
    if (st.grab) {
      const pulse = 0.34 + 0.16 * Math.sin(st.phaseT * 6.0);
      ctx.save();
      ctx.setLineDash([5 * S, 4 * S]);
      ctx.lineDashOffset = -st.phaseT * 22 * S;
      ctx.strokeStyle = 'rgba(255,228,178,' + pulse.toFixed(3) + ')';
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.ellipse(W * 0.160, H * 0.598, W * 0.140, W * 0.074, 0, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(W * 0.130, H * 0.712, W * 0.098, W * 0.058, 0, 0, TAU);
      ctx.stroke();
      /* 两个目标各带一句小字：光靠形状分不清「盘」和「筐」，尤其第一次玩 */
      ctx.setLineDash([]);
      const lf = 9.5 * S;
      ctx.font = '600 ' + lf + 'px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,236,205,' + (pulse + 0.20).toFixed(3) + ')';
      ctx.fillText('木盘 · 要切的', W * 0.160, H * 0.598 + W * 0.088);
      ctx.fillText('废料筐 · 不要的', W * 0.130, H * 0.712 + W * 0.082);
      ctx.restore();
    }

    // 大篮子（特写）
    drawEveBasketBack(ctx, bx, by, brx, bry, S);

    // 篮里的苹果（弹回途中也一起画，被篮沿压住才对）
    for (const a of st.pick) {
      if (a.state !== 'in' && a.state !== 'back') continue;
      drawApple(ctx, a.x, a.y, a.r, a.rot);
      if (a.bad) drawBadMarks(ctx, a.x, a.y, a.r, S);
    }
    drawEveBasketFront(ctx, bx, by, brx, bry, S);

    // 飞出去的（好果 → 木盘，坏果 → 废料筐）
    for (const a of st.pick) {
      if (a.state === 'in' || a.state === 'back' || a.state === 'drag') continue;
      drawApple(ctx, a.x, a.y, a.r, a.rot);
      if (!a.bad) continue;
      drawBadMarks(ctx, a.x, a.y, a.r, S);
      // 坏果打个淡淡的叉，一眼看出「这颗不要」
      if (a.state === 'out') {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,120,110,0.55)';
        ctx.lineWidth = 1.6 * S;
        ctx.beginPath();
        ctx.moveTo(a.x - a.r * 0.5, a.y - a.r * 0.5);
        ctx.lineTo(a.x + a.r * 0.5, a.y + a.r * 0.5);
        ctx.moveTo(a.x + a.r * 0.5, a.y - a.r * 0.5);
        ctx.lineTo(a.x - a.r * 0.5, a.y + a.r * 0.5);
        ctx.stroke();
        ctx.restore();
      }
    }

    /* 手上拎着的那颗画在最上层：放大一点 + 落影子，像真的被提起来了 */
    if (st.grab && st.grab.state === 'drag') {
      const a = st.grab;
      const k = 1 + 0.14 * (a.lift || 0);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(a.x + a.r * 0.20, a.y + a.r * 1.30, a.r * 0.82, a.r * 0.30, 0, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.fill();
      ctx.restore();
      drawApple(ctx, a.x, a.y, a.r * k, a.rot);
      if (a.bad) drawBadMarks(ctx, a.x, a.y, a.r * k, S);
    }

    // 计数：盘里 / 筐里各几颗，混进去的坏果单独标出来（玩家要看得见自己的账）
    drawCountTag(ctx, '盘里 ' + (st.pickOut || 0) + ' 颗'
      + ((st.pickBadIn || 0) ? '（坏 ' + st.pickBadIn + '）' : '')
      + '　·　筐里 ' + (st.pickBadOut || 0) + ' 颗',
      W * 0.620, H * 0.560, S);

    const busy = st.pick.some(a => a.state === 'in' || a.state === 'back');
    drawHint(ctx,
      !busy ? '还能拖出来重放 · 点空白去洗果'
        : (st.pickHintT > 0 && st.pickHint) ? st.pickHint
          : st.grab ? '松手就放下 · 木盘是要切的，筐是丢的'
            : '按住苹果拖去分拣 · 点空白直接去洗',
      W, H, S, (st.pickHintT > 0 && st.pickHintBad) ? '#ffc9bd' : '#ffe9cf');
  }

  /* ---------- ⓪-3 洗果 ---------- */
  function drawEveWash(st, ctx, t, W, H, S) {
    // 台面 / 水槽
    const deck = ctx.createLinearGradient(0, H * 0.66, 0, H);
    deck.addColorStop(0, 'rgba(58,42,62,0)');
    deck.addColorStop(1, 'rgba(28,19,33,0.92)');
    ctx.fillStyle = deck;
    ctx.fillRect(0, H * 0.66, W, H * 0.34);

    /* 水槽：盆口椭圆 + 下方碗身，苹果嵌在盆里。
       上一版只有一个扁椭圆，看着像把苹果摆在盘沿上；补出碗深才有「在洗」的感觉。 */
    const bx = W * 0.500, by = H * 0.690, brx = W * 0.395, bry = W * 0.070;
    // 碗身
    ctx.beginPath();
    ctx.moveTo(bx - brx, by);
    ctx.bezierCurveTo(bx - brx * 0.98, by + bry * 1.75, bx - brx * 0.46, by + bry * 1.98, bx, by + bry * 1.98);
    ctx.bezierCurveTo(bx + brx * 0.46, by + bry * 1.98, bx + brx * 0.98, by + bry * 1.75, bx + brx, by);
    ctx.closePath();
    const pg = ctx.createLinearGradient(0, by - bry, 0, by + bry * 2);
    pg.addColorStop(0, '#7d6d86');
    pg.addColorStop(0.45, '#54455c');
    pg.addColorStop(1, '#2b2030');
    ctx.fillStyle = pg;
    ctx.fill();
    // 盆口内壁
    ctx.beginPath();
    ctx.ellipse(bx, by, brx, bry, 0, 0, TAU);
    ctx.fillStyle = 'rgba(58,46,66,0.92)';
    ctx.fill();
    // 盆里的水
    ctx.beginPath();
    ctx.ellipse(bx, by + bry * 0.10, brx * 0.92, bry * 0.82, 0, 0, TAU);
    const wg2 = ctx.createLinearGradient(0, by - bry * 0.6, 0, by + bry * 0.8);
    wg2.addColorStop(0, 'rgba(150,205,235,0.38)');
    wg2.addColorStop(1, 'rgba(70,130,175,0.24)');
    ctx.fillStyle = wg2;
    ctx.fill();
    // 盆沿高光
    ctx.beginPath();
    ctx.ellipse(bx, by, brx, bry, 0, 0.02 * Math.PI, 0.98 * Math.PI, false);
    ctx.strokeStyle = 'rgba(255,226,200,0.30)';
    ctx.lineWidth = 2.2 * S;
    ctx.stroke();

    /* 水龙头：左边接一段横管 → 弯头向下 → 靠近盆面的出水口。
       上一版只有一根细长竖条悬在空中，像麦秆；现在管子有来处、水流短而粗。 */
    const jx = W * 0.500, jTop = H * 0.570, jBot = by + bry * 0.30;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#9aa0ad';
    ctx.lineWidth = 5.4 * S;
    ctx.beginPath();
    ctx.moveTo(W * 0.02, H * 0.534);
    ctx.lineTo(jx - 16 * S, H * 0.534);
    ctx.quadraticCurveTo(jx, H * 0.534, jx, H * 0.562);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.40)';
    ctx.lineWidth = 1.6 * S;
    ctx.beginPath();
    ctx.moveTo(W * 0.02, H * 0.528);
    ctx.lineTo(jx - 18 * S, H * 0.528);
    ctx.stroke();
    ctx.restore();
    // 出水口（喇叭口）
    ctx.save();
    ctx.fillStyle = '#c3c8d2';
    ctx.beginPath();
    ctx.moveTo(jx - 4.6 * S, jTop - 10 * S);
    ctx.lineTo(jx + 4.6 * S, jTop - 10 * S);
    ctx.lineTo(jx + 7.4 * S, jTop);
    ctx.lineTo(jx - 7.4 * S, jTop);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 水柱（画在苹果后面）
    ctx.save();
    ctx.globalAlpha = 0.55 * st.fade;
    const wg = ctx.createLinearGradient(0, jTop, 0, jBot);
    wg.addColorStop(0, 'rgba(198,234,255,0.85)');
    wg.addColorStop(1, 'rgba(150,205,255,0.30)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(jx - 5.2 * S, jTop);
    ctx.lineTo(jx + 5.2 * S, jTop);
    ctx.lineTo(jx + 7.6 * S, jBot);
    ctx.lineTo(jx - 7.6 * S, jBot);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.30 * st.fade;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const span = jBot - jTop;
    for (let i = 0; i < 4; i++) {
      const yy = jTop + ((t * 260 + i * (span / 4)) % span);
      ctx.fillRect(jx - 2.2 * S, yy, 4.4 * S, 9 * S);
    }
    ctx.restore();

    // 苹果一排
    const washed = st.wash.filter(a => a.clean >= 0.999).length;
    st.wash.forEach((a, i) => {
      const bob = Math.sin(t * 1.6 + a.ph) * 1.6 * S;
      const y = a.y + bob;
      drawApple(ctx, a.x, y, a.r, 0.06 * Math.sin(t * 0.9 + a.ph));
      /* 20261116：混进木盘的坏果 —— 洗得再干净也留一块褐斑（它是从里面坏的）。
         洗的时候一眼能看出哪几颗不该在里面，但不阻止玩家继续洗，
         代价留到最后结算：坏果会跟着切片一起进派。 */
      if (a.bad) {
        ctx.save();
        ctx.globalAlpha = 0.62 * st.fade;
        ctx.fillStyle = 'rgba(74,48,30,0.80)';
        ctx.beginPath();
        ctx.ellipse(a.x + a.r * 0.22, y + a.r * 0.10, a.r * 0.30, a.r * 0.24, 0.4, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.38 * st.fade;
        ctx.beginPath();
        ctx.ellipse(a.x - a.r * 0.26, y - a.r * 0.18, a.r * 0.16, a.r * 0.13, -0.3, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      // 污渍：洗得越干净越淡
      if (a.clean < 0.985) {
        ctx.save();
        ctx.globalAlpha = (1 - a.clean) * 0.80 * st.fade;
        ctx.fillStyle = 'rgba(96,74,40,0.62)';
        const spots = [[-0.30, -0.16, 0.20], [0.24, 0.22, 0.17], [-0.02, -0.40, 0.13]];
        for (const p of spots) {
          ctx.beginPath();
          ctx.ellipse(a.x + p[0] * a.r, y + p[1] * a.r, p[2] * a.r, p[2] * a.r * 0.78, 0.5, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
      // 洗干净 → 水亮高光 + 几颗水珠
      if (a.clean >= 0.985) {
        ctx.save();
        ctx.globalAlpha = 0.85 * st.fade;
        ctx.strokeStyle = 'rgba(255,255,255,0.70)';
        ctx.lineWidth = 1.4 * S;
        ctx.beginPath();
        ctx.arc(a.x - a.r * 0.26, y - a.r * 0.30, a.r * 0.34, 2.2, 3.9);
        ctx.stroke();
        ctx.fillStyle = 'rgba(210,240,255,0.85)';
        for (let k = 0; k < 3; k++) {
          const ang = t * 0.7 + k * 2.1 + a.ph;
          ctx.beginPath();
          ctx.arc(a.x + Math.cos(ang) * a.r * 0.72, y + Math.sin(ang) * a.r * 0.62, 1.5 * S, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
      // 正在擦洗的水花
      if (a.wet > 0.05 && a.clean < 0.999) {
        ctx.save();
        ctx.globalAlpha = a.wet * 0.55 * st.fade;
        ctx.strokeStyle = 'rgba(190,230,255,0.85)';
        ctx.lineWidth = 1.1 * S;
        for (let k = 0; k < 2; k++) {
          const rr = a.r * (1.05 + ((t * 0.9 + k * 0.5) % 1) * 0.55);
          ctx.beginPath();
          ctx.arc(a.x, y, rr, 0.4 + k, 2.2 + k);
          ctx.stroke();
        }
        ctx.restore();
      }
    });

    // 计数
    drawCountTag(ctx, washed >= st.wash.length ? '都洗干净了' : '已洗净 ' + washed + ' / ' + st.wash.length + ' 颗',
      W * 0.5, H * 0.500, S, washed >= st.wash.length ? '#ffd68c' : null);

    drawHint(ctx,
      washed >= st.wash.length ? '冲干净了 · 点空白上案板'
        : '按住苹果左右擦 · 点空白直接上案板（没洗净会算进结算）',
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
  /* ============================================================
   * 出炉评级表（20261116 玩家口径）：标题统一成「……的苹果派」。
   *   甜度四档：淡 / 刚好（糖量条绿区）/ 甜美（刚过绿区，绑蝴蝶结）/ 齁
   *   馅量四档：太少 / 偏少 / 刚好 / 塞满（>13 片，会流心）
   *   坏果两档：有点发酸 / 坏了一半
   *   洗净两档：没洗干净 / 带着泥下锅
   * 火候档优先（生、焦糖、糊、炭），因为那是整炉的定性。
   * flags 只给装饰用，和标题互不影响：塞满又能同时是甜美的（蝴蝶结 + 流心）。
   * ============================================================ */
  function evePieJudge(st) {
    const n = st.plated || 0;
    const sugar = st.sugar || 0;
    const sweet = sugar < 0.40 ? 0 : sugar <= 0.66 ? 1 : sugar <= 0.80 ? 2 : 3;
    const amt = n < 5 ? 0 : n < 8 ? 1 : n <= 13 ? 2 : 3;
    const badN = clamp(Math.round(st.pickBadIn || 0), 0, 6);
    const bad = badN <= 0 ? 0 : ((badN / Math.max(1, st.pickOut || 1)) <= 0.34 ? 1 : 2);
    const dirty = clamp(st.dirty || 0, 0, 3);
    const washPct = Math.round(clamp(st.washP || 0, 0, 1) * 100);

    const sweetTxt = ['甜度偏淡', '甜度刚好', '甜而不腻', '甜得发齁'][sweet];
    const amtTxt = n === EVE_FULL_SLICES ? '一颗苹果'
      : (n === EVE_FULL_SLICES - 1 || n === EVE_FULL_SLICES + 1) ? n + ' 片 · 差一片'
        : ['馅料太少', '只有 ' + n + ' 片', n + ' 片', n + ' 片塞满'][amt];
    const detail = sweetTxt + ' · ' + amtTxt
      + ' · 蛋液 ' + (st.coatScore || 0) + '/20 · 火候 ' + (st.bakeScore || 0) + '/30'
      + (bad ? ' · 坏果 ' + badN + ' 颗' : '')
      + (dirty ? ' · 洗净 ' + washPct + '%' : '');

    const gd = st.cookResult || '';
    /* 20261116 第四轮：标题全部改成「……的苹果派」，并且每一档都给一句自己的
       判定语（就是标题下面那行）。判定语不报数字，只描述「这一炉长什么样」，
       具体的甜度/片数/火候仍然并到 detail 里、只在需要时挂上去。
       命名口径（玩家点名改过的三处）：
         甜得齁嗓子 → 像糖浆的苹果派
         有点淡     → 不太甜的苹果派
       洗涤两档（玩家 20261116 明确纠正，别再搞反）：
         浅档 洗净 45~74%（dirty=2）→ 有些掉渣的苹果派 + 「最原生态」
         深档 洗净 <45%（dirty=3）  → 有石子的苹果派   + 「有点硌牙」 */
    let kind, title, sub;
    /* 20261116 第五轮：玩家亲自写的判词，按档一一对应（不再由我编）。
       口径确认过的三处：碳化→成了炭；边上有一点焦→边上烤糊（不是焦糖）；
       糖脆/馅软/皮酥→焦糖色；洗涤两档按方案 C（浅=掉渣·最原生态 / 重=石子·硌牙）。 */
    if (st.isPerfect) {
      kind = 'perfect'; title = '最完美的苹果派';
      sub = '恭喜你！做出了世界上最完美的苹果派！！无论年纪，老少皆宜，没有人不爱吃这款苹果派。';
    } else if (gd === 'raw') {
      kind = 'raw'; title = '还没烤熟的苹果派';
      sub = '虽然没怎么烤熟，但上面满是苹果的清香。';
    } else if (gd === 'caramel') {
      kind = 'caramel'; title = '焦糖色的苹果派';
      sub = '口感层次非常丰富，糖脆脆的，馅软软的，皮酥酥的。';
    } else if (gd === 'burnt') {
      kind = 'burnt'; title = '边上烤糊的苹果派';
      sub = '边上有一点焦，但也是别有风味，爱吃苦一点的可以尝尝。';
    } else if (gd === 'carbon') {
      kind = 'carbon'; title = '成了炭的苹果派';
      sub = '已经碳化了，可以放到相框里收藏了，放 100 年也不会坏。';
    } else if (bad === 2) {
      kind = 'rotten'; title = '酸得倒牙的苹果派';
      sub = '酸得牙根发软，连舌头都想躲开。';
    } else if (dirty === 3) {
      kind = 'dusty'; title = '有石子的苹果派';
      sub = '好吃，就是可能会有点硌牙，可以拿去作为最佳牙口挑战大赛的道具了。';
    } else if (bad === 1) {
      kind = 'sour'; title = '有点发酸的苹果派';
      sub = '有一丝酸，但刚好解腻了。';
    } else if (dirty === 2) {
      kind = 'muddy'; title = '有些掉渣的苹果派';
      sub = '这简直是最原生态的苹果派。';
    } else if (sweet === 3) {
      kind = 'toosweet'; title = '像糖浆的苹果派';
      sub = '糖浆挂在饼皮上，真适合配一杯热茶。';
    } else if (sweet === 2) {
      kind = 'sweet'; title = '甜美的苹果派';
      /* 20261116 第六轮：玩家否掉旧句「糖在表面结了一层薄壳」——派不会结壳。
         改从香气/氛围切入，只写甜「是什么感觉」，不写任何入口的动作。 */
      sub = '甜是从香气里先来的，像把一整个秋天收进了派里，风都吹得暖了一点。';
    } else if (sweet === 0) {
      kind = 'faint'; title = '不太甜的苹果派';
      sub = '不太甜？很好！这简直是国人的最高评价！';
    } else if (amt === 0) {
      kind = 'empty'; title = '几乎没馅的苹果派';
      sub = '切面几乎是一整块酥皮，苹果只在最中间留了个影子。';
    } else if (amt === 1) {
      kind = 'thin'; title = '皮比馅多的苹果派';
      sub = '皮烤得真香，苹果再多两片，我就能确认它是苹果派了。';
    } else if (amt === 3) {
      kind = 'full'; title = '流心的苹果派';
      sub = '我说真的，这个流心真的看起来非常好吃。';
    } else {
      kind = 'fine'; title = '刚刚好的苹果派';
      sub = '哪儿都没多做一步，哪儿也没少做一步——这一炉，就是这个派该有的样子。';
    }
    return {
      kind, title, sub, detail, sweet, amt, bad, dirty, badN, n, washPct,
      halo: !!st.isPerfect,
      bow: kind === 'sweet',                                  // 甜美 → 缎带蝴蝶结
      stream: amt === 3 && gd !== 'carbon',                   // 塞满 → 馅从边沿流出来
    };
  }

  /* ============================================================
   * 结算页：每一档自己的「小特色」（20261116 第四轮）
   * 十六炉派原本长着同一张脸，玩家分不出自己烤没烤好；
   * 所以除了标题，每一档再给一点只属于它的动静：
   *   完美    金环 + 散射金光 + 上升的金色光尘
   *   甜美    缎带蝴蝶结 + 缓缓落下的糖晶
   *   糖浆    表面挂浆扫光 + 两道糖丝 + 糖泡
   *   不太甜  派顶一枝苹果花 + 一滴清露
   *   没馅    派心塌下去 + 干裂纹
   *   皮多    边沿几处豁口，露出干派皮
   *   流心    馅从边沿溢出来 + 热气
   *   生      淡蓝冷气 + 一层没烤到的面粉
   *   焦糖    琥珀边光 + 焦糖香雾
   *   糊      细烟
   *   炭      黑烟 + 暗红火星
   *   酸      灰绿霉斑 + 往上冒的酸气泡
   *   坏一半  大片霉斑 + 两只绕飞的小虫
   *   有石子  沙粒 + 两三颗白石子
   *   掉渣    干裂 + 碎屑往下掉
   * 全部画在 drawDish 之后（才压得住网格），并且收在派与盘之间，
   * 不上探到结算文字所在的 0.772H。
   * ============================================================ */
  /* 确定性伪随机：同一颗籽每帧都一样，否则颗粒会满画飘 */
  function pieHash(i) {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* 一缕往上飘的烟/气：分 5 段逐段变淡、变粗，才不会像一根硬线条 */
  function pieSmoke(ctx, cx, cy, r, S, e, t, col, n, rise, wide, thick, seed) {
    ctx.save();
    ctx.lineCap = 'round';
    const steps = 5;
    for (let i = 0; i < n; i++) {
      const s1 = pieHash(i * 3.7 + seed);
      const s2 = pieHash(i * 7.1 + seed * 2.3);
      const bx = cx + (s1 - 0.5) * wide * r;
      const by = cy + (s2 - 0.5) * r * 0.30;
      const amp = r * (0.04 + 0.05 * s1);
      const ph = t * (0.65 + 0.5 * s2) + i * 1.7;
      const up = r * rise * (0.85 + 0.3 * s2);
      let px = bx, py = by;
      for (let k = 1; k <= steps; k++) {
        const u = k / steps;
        const nx = bx + Math.sin(ph + u * 3.2) * amp * u * 1.6;
        const ny = by - up * u;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo((px + nx) / 2 + amp * 0.8, (py + ny) / 2, nx, ny);
        ctx.strokeStyle = 'rgba(' + col + ',' + (e * (1 - u) * 0.42).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, r * thick * (1 + u * 1.6));
        ctx.stroke();
        px = nx; py = ny;
      }
    }
    ctx.restore();
  }

  /* 颗粒：铺在派面上（面粉/糖霜）或从派沿往下掉（碎屑） */
  function pieGrains(ctx, cx, cy, r, S, e, t, col, n, alpha, sand, fall) {
    const ry = r * 0.40;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const a = pieHash(i * 5.3 + 1.1) * TAU;
      const rad = Math.sqrt(pieHash(i * 9.7 + 2.7)) * 0.88;
      let gx = cx + Math.cos(a) * r * rad;
      let gy = cy + Math.sin(a) * ry * rad;
      let al = alpha;
      if (fall) {
        const ph = (t * 0.4 + pieHash(i * 3.3)) % 1;
        gx = cx + Math.cos(a) * r * (0.90 + 0.10 * rad);
        gy = cy + Math.sin(a) * ry * 0.90 + r * 0.62 * ph;
        al = alpha * (1 - ph);
      }
      const sz = r * (sand ? (0.015 + 0.010 * pieHash(i * 2.1)) : (0.019 + 0.013 * pieHash(i * 2.1)));
      ctx.beginPath();
      ctx.arc(gx, gy, Math.max(0.8, sz), 0, TAU);
      ctx.fillStyle = 'rgba(' + col + ',' + (e * al).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  /* 霉斑：一块霉由 5 个小圆叠出来，边界才毛糙 */
  function pieMold(ctx, cx, cy, r, S, e, big) {
    const ry = r * 0.40;
    const n = big ? 6 : 3;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const a = pieHash(i * 4.1 + 0.7) * TAU;
      const rad = 0.28 + 0.55 * pieHash(i * 8.3 + 1.9);
      const mx = cx + Math.cos(a) * r * rad;
      const my = cy + Math.sin(a) * ry * rad;
      const mr = r * (big ? (0.135 + 0.085 * pieHash(i * 2.7)) : (0.085 + 0.050 * pieHash(i * 2.7)));
      /* 20261116 第三版：上一版是「一个圆形 + 白色中心点」，缩小后读成了青豆/葡萄。
         现在改成 7 块大小不一的暗绿斑叠在一起（边缘自然毛糙、没有圆轮廓），
         再罩一层很淡的灰白霉霜 —— 这才是「坏了」。 */
      for (let k = 0; k < 7; k++) {
        const aa = pieHash(i * 5.9 + k * 2.7) * TAU;
        const off = mr * (0.30 + 0.55 * pieHash(k * 4.3 + i * 1.7));
        const rr2 = mr * (0.24 + 0.62 * pieHash(k * 3.1 + i * 5.3));
        ctx.beginPath();
        ctx.arc(mx + Math.cos(aa) * off, my + Math.sin(aa) * off * 0.55, rr2, 0, TAU);
        ctx.fillStyle = 'rgba(74,90,54,' + (e * 0.34).toFixed(3) + ')';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(mx, my, mr * 0.92, mr * 0.54, i * 0.5, 0, TAU);
      ctx.fillStyle = 'rgba(198,206,180,' + (e * 0.13).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  /* 两只绕派飞的小虫：翅膀高频抖，离派不远 */
  function pieFlies(ctx, cx, cy, r, S, e, t) {
    ctx.save();
    for (let i = 0; i < 2; i++) {
      const ph = t * (1.1 + 0.3 * i) + i * 2.6;
      const fx = cx + Math.cos(ph) * r * (0.92 + 0.14 * Math.sin(ph * 1.7));
      const fy = cy - r * 0.26 + Math.sin(ph * 1.9) * r * 0.34;
      const wf = 0.35 + 0.55 * Math.abs(Math.sin(t * 26 + i));
      [-1, 1].forEach(sg => {
        ctx.beginPath();
        ctx.ellipse(fx + sg * r * 0.052, fy - r * 0.040, r * 0.048, r * 0.023 * wf, sg * 0.5, 0, TAU);
        ctx.fillStyle = 'rgba(238,238,230,' + (e * 0.44).toFixed(3) + ')';
        ctx.fill();
      });
      ctx.beginPath();
      ctx.arc(fx, fy, r * 0.033, 0, TAU);
      ctx.fillStyle = 'rgba(38,30,26,' + (e * 0.80).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  /* 气泡：从派面往上冒（酸气 / 糖泡），到顶前渐隐 */
  function pieBubbles(ctx, cx, cy, r, S, e, t, col) {
    const ry = r * 0.40;
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const s = pieHash(i * 3.9 + 0.4);
      const ph = (t * (0.32 + 0.20 * s) + pieHash(i * 7.7)) % 1;
      const wob = Math.sin(t * 2 + i) * r * 0.02;
      const bx = cx + (pieHash(i * 5.1 + 1.3) - 0.5) * r * 1.25 + wob;
      const by = cy + ry * 0.32 - r * 0.78 * ph;
      const br = Math.max(0.9, r * (0.024 + 0.020 * s) * (1 + ph * 0.6));
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fillStyle = 'rgba(' + col + ',' + (e * (1 - ph) * 0.52).toFixed(3) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx - br * 0.3, by - br * 0.3, Math.max(0.4, br * 0.30), 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,' + (e * (1 - ph) * 0.55).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  /* 糖浆：整面挂一层蜜色浆 + 两块湿润反光 + 三道挂下来的糖丝。
     20261116 第二版：上一版只叠了两道极淡的渐变，在浅棕派面上等于没有；
     现在先整面铺浆、再补高光和糖丝，远看也能看出「这派是湿的」。 */
  function pieSyrup(ctx, cx, cy, r, S, e, t) {
    const ry = r * 0.40;
    ctx.save();
    // ① 整面挂浆
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.975, ry * 0.975, 0, 0, TAU);
    const sg = ctx.createLinearGradient(cx - r * 0.8, cy - ry, cx + r * 0.7, cy + ry);
    sg.addColorStop(0, 'rgba(226,150,50,' + (e * 0.30).toFixed(3) + ')');
    sg.addColorStop(0.44, 'rgba(255,214,142,' + (e * 0.26).toFixed(3) + ')');
    sg.addColorStop(1, 'rgba(190,112,30,' + (e * 0.34).toFixed(3) + ')');
    ctx.fillStyle = sg;
    ctx.fill();
    // ② 湿润高光：两团柔光在不同位置轻轻移，像浆面反光
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.965, ry * 0.965, 0, 0, TAU);
    ctx.clip();
    const sw = 0.5 + 0.5 * Math.sin(t * 0.7);
    [[-0.34, -0.32, 0.30], [0.32, 0.14, 0.19]].forEach((hl, i) => {
      const hx = cx + r * (hl[0] + 0.07 * sw);
      const hy = cy + ry * hl[1];
      const g2 = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * hl[2] * 1.9);
      g2.addColorStop(0, 'rgba(255,247,222,' + (e * (i ? 0.30 : 0.48)).toFixed(3) + ')');
      g2.addColorStop(1, 'rgba(255,247,222,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(cx - r, cy - ry, r * 2, ry * 2);
    });
    ctx.restore();
    // ③ 三道从派沿往下挂的糖丝，末端挂一颗糖珠
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * (0.42 + 0.22 * i);       // 前偏右 → 正前 → 左前，别挤在一侧
      const px = cx + Math.cos(a) * r * 0.93;
      const py = cy + Math.sin(a) * ry * 0.93;
      const len = r * (0.32 + 0.06 * Math.sin(t * 0.9 + i * 1.4));
      const w = r * (0.032 + 0.004 * i);
      ctx.beginPath();
      ctx.moveTo(px - w, py);
      ctx.quadraticCurveTo(px - w * 0.7, py + len * 0.6, px, py + len);
      ctx.quadraticCurveTo(px + w * 0.7, py + len * 0.6, px + w, py);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,190,84,' + (e * 0.95).toFixed(3) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(px, py + len + w * 0.9, w * 0.95, w * 1.15, 0, 0, TAU);
      ctx.fillStyle = 'rgba(232,160,56,' + (e * 0.90).toFixed(3) + ')';
      ctx.fill();
      // 糖丝上一道细高光
      ctx.beginPath();
      ctx.moveTo(px - w * 0.34, py + len * 0.20);
      ctx.quadraticCurveTo(px - w * 0.26, py + len * 0.58, px, py + len * 0.86);
      ctx.strokeStyle = 'rgba(255,244,206,' + (e * 0.55).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.8, r * 0.008);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 暗红火星：只给「成了炭」那一炉，缓慢上飘 */
  function pieEmbers(ctx, cx, cy, r, S, e, t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const s = pieHash(i * 4.7 + 0.9);
      const ph = (t * (0.26 + 0.20 * s) + pieHash(i * 8.1)) % 1;
      const ex = cx + (pieHash(i * 2.3 + 0.5) - 0.5) * r * 1.5;
      const ey = cy + r * 0.20 - r * 0.58 * ph;
      const er = Math.max(0.9, r * (0.022 + 0.016 * s) * (1 - ph * 0.5));
      const al = e * (1 - ph) * (0.50 + 0.50 * Math.abs(Math.sin(t * 3 + i)));
      ctx.beginPath();
      ctx.arc(ex, ey, er * 2.6, 0, TAU);
      ctx.fillStyle = 'rgba(255,90,30,' + (al * 0.14).toFixed(3) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, TAU);
      ctx.fillStyle = 'rgba(255,140,58,' + al.toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  /* 干裂纹：三条从派心往外折的裂缝 */
  function pieCracks(ctx, cx, cy, r, S, e) {
    const ry = r * 0.40;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const a0 = pieHash(i * 6.1 + 2.2) * TAU;
      let px = cx + Math.cos(a0) * r * 0.24;
      let py = cy + Math.sin(a0) * ry * 0.24;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let k = 1; k <= 4; k++) {
        const a = a0 + (pieHash(i * 3.1 + k) - 0.5) * 0.9;
        px += Math.cos(a) * r * 0.16;
        py += Math.sin(a) * ry * 0.22;
        ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(74,38,12,' + (e * 0.62).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.2, r * 0.019);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 派心塌陷：中间压一圈暗影，像馅缩下去了 */
  function pieSink(ctx, cx, cy, r, S, e, k) {
    const ry = r * 0.40;
    const g = ctx.createRadialGradient(cx, cy + ry * 0.12, r * 0.05, cx, cy + ry * 0.12, r * 0.70);
    g.addColorStop(0, 'rgba(48,22,4,' + (e * 0.58 * k).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(52,24,6,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.88, ry * 0.88, 0, 0, TAU);
    ctx.fill();
    // 凹陷的折痕：一道暗色弧，塌下去的地方才有「边」
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.07, r * 0.56, ry * 0.56, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(56,26,6,' + (e * 0.34 * k).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, r * 0.022);
    ctx.stroke();
    /* 20261116 第七轮：坑口补一道受光的亮边。
       只有暗影时整块读成「一坑泥」，有亮边才读得出是「派皮塌下去」。 */
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.05, r * 0.56, ry * 0.56, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.strokeStyle = 'rgba(255,228,172,' + (e * 0.34 * k).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, r * 0.018);
    ctx.stroke();
    ctx.restore();
  }

  /* 豁口：网格里空出来的几块，露出下面干干的派皮 */
  function pieGaps(ctx, cx, cy, r, S, e) {
    const ry = r * 0.40;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * (0.10 + 0.80 * pieHash(i * 3.7 + 1.2));
      const rad = 0.26 + 0.42 * pieHash(i * 7.3 + 0.5);
      const gx = cx + Math.cos(a) * r * rad;
      const gy = cy + Math.sin(a) * ry * rad;
      // ① 凹陷的缺口（深色，读作「这里没有馅」）
      ctx.beginPath();
      ctx.ellipse(gx, gy, r * 0.150, ry * 0.25, a, 0, TAU);
      ctx.fillStyle = 'rgba(52,24,4,' + (e * 0.62).toFixed(3) + ')';
      ctx.fill();
      // ② 洞底那点干派皮：只占缺口的下半，别糊成一块白斑
      ctx.beginPath();
      ctx.ellipse(gx, gy + ry * 0.07, r * 0.086, ry * 0.12, a, 0, TAU);
      ctx.fillStyle = 'rgba(222,186,142,' + (e * 0.38).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  /* 一枝苹果花 + 一滴清露：给「不太甜」那一炉，清清淡淡的一笔 */
  function pieBlossom(ctx, cx, cy, r, S, e, t) {
    const bx = cx + r * 0.02, by = cy - r * 0.10;
    const rr = r * 0.185;                 // 上一版 0.13r，在 360 宽的画布上只有 12px，远看是个白点
    ctx.save();
    ctx.globalAlpha = e;
    ctx.beginPath();
    ctx.moveTo(bx - rr * 0.3, by + rr * 0.5);
    ctx.quadraticCurveTo(bx + rr * 0.5, by + rr * 1.0, bx + rr * 1.5, by + rr * 1.2);
    ctx.strokeStyle = 'rgba(112,88,52,0.82)';
    ctx.lineWidth = Math.max(1, rr * 0.13);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * TAU + 0.2;
      const px = bx + Math.cos(a) * rr * 0.52;
      const py = by + Math.sin(a) * rr * 0.52;
      ctx.beginPath();
      ctx.ellipse(px, py, rr * 0.46, rr * 0.31, a, 0, TAU);
      const pg = ctx.createLinearGradient(bx, by, px + Math.cos(a) * rr * 0.4, py + Math.sin(a) * rr * 0.4);
      pg.addColorStop(0, 'rgba(255,253,250,0.98)');
      pg.addColorStop(1, 'rgba(250,208,216,0.94)');
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(226,176,188,0.42)';
      ctx.lineWidth = Math.max(0.6, rr * 0.035);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(bx, by, rr * 0.23, 0, TAU);
    ctx.fillStyle = 'rgba(246,206,96,0.96)';
    ctx.fill();
    const dr = rr * 0.19;
    const dx = bx + rr * 0.74;
    const dy = by + rr * 0.60 + Math.sin(t * 1.4) * rr * 0.05;
    ctx.beginPath();
    ctx.arc(dx, dy, dr, 0, TAU);
    ctx.fillStyle = 'rgba(212,238,246,0.78)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dx - dr * 0.3, dy - dr * 0.3, dr * 0.32, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.restore();
  }

  /* 糖晶：甜美档周围缓缓落下的白色小亮点 */
  /* 甜美档的糖霜：派面一层薄糖粉 + 卷边内侧堆起来的一圈白霜 + 一把糖粒。
     20261116 第三版（玩家）：上一版只有空中飘的几颗糖晶，看不出「甜」。
     甜的第一眼应该是「这上面撒过糖」，所以糖粉必须落在派面上。 */
  /* 甜美档的糖晶星芒：七粒，散在派上方的空气里与派沿两侧。
     一颗颗四角星、大小不一、各自呼吸 —— 甜品摄影里那种「bling」，
     比在派面上堆白点更干净，也更甜。 */
  function pieSparkle(ctx, cx, cy, r, e, t) {
    const SPK = [
      { u: -0.92, v: -0.62, s: 0.052, ph: 0.0 },
      { u: 0.86, v: -0.50, s: 0.042, ph: 1.1 },
      { u: -1.06, v: 0.10, s: 0.034, ph: 2.2 },
      { u: 1.02, v: 0.22, s: 0.046, ph: 3.3 },
      { u: -0.46, v: -1.02, s: 0.038, ph: 4.1 },
      { u: 0.52, v: -0.94, s: 0.030, ph: 5.0 },
      { u: -0.24, v: -1.14, s: 0.032, ph: 5.8 },
    ];
    ctx.save();
    for (const sp of SPK) {
      const al = 0.26 + 0.62 * Math.abs(Math.sin(t * 1.45 + sp.ph));
      const sx = cx + sp.u * r;
      const sy = cy + sp.v * r * 0.62;
      const sz = r * sp.s;
      ctx.globalAlpha = e * al;
      ctx.beginPath();
      ctx.moveTo(sx, sy - sz * 2.0);
      ctx.lineTo(sx + sz * 0.42, sy - sz * 0.42);
      ctx.lineTo(sx + sz * 2.0, sy);
      ctx.lineTo(sx + sz * 0.42, sy + sz * 0.42);
      ctx.lineTo(sx, sy + sz * 2.0);
      ctx.lineTo(sx - sz * 0.42, sy + sz * 0.42);
      ctx.lineTo(sx - sz * 2.0, sy);
      ctx.lineTo(sx - sz * 0.42, sy - sz * 0.42);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,252,250,0.96)';
      ctx.fill();
      // 极淡的粉色外晕，让星芒偏甜不发冷
      ctx.beginPath();
      ctx.arc(sx, sy, sz * 2.6, 0, TAU);
      ctx.fillStyle = 'rgba(255,170,200,0.16)';
      ctx.fill();
    }
    ctx.restore();
  }

  function pieFrost(ctx, cx, cy, r, ry, e, t) {
    ctx.save();
    ctx.globalAlpha = e;

    // ① 糖粉：中心略亮、边缘化开的一层白雾（太厚派就变灰了，控制在极淡）
    const g = ctx.createRadialGradient(cx - r * 0.12, cy - ry * 0.26, r * 0.02, cx, cy, r * 0.98);
    g.addColorStop(0, 'rgba(255,251,246,0.26)');
    g.addColorStop(0.52, 'rgba(255,247,238,0.16)');
    g.addColorStop(1, 'rgba(255,243,232,0.03)');
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.945, ry * 0.945, 0, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    // ② 卷边内侧一道白霜：糖粉最爱堆在边上
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.895, ry * 0.895, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(255,253,249,0.30)';
    ctx.lineWidth = Math.max(2, r * 0.040);
    ctx.stroke();

    // ③ 糖粒：位置写死（每帧不跳），大小不一，一部分会闪
    for (let i = 0; i < 34; i++) {
      const u = pieHash(i * 3.7 + 1.1) * 2 - 1;
      const v = pieHash(i * 5.3 + 2.9) * 2 - 1;
      if (u * u + v * v > 1) continue;
      const px = cx + u * r * 0.93;
      const py = cy + v * ry * 0.93;
      /* 糖粒要「看得见」：直径 1.5~3.4px（按派半径缩），白度高、边缘实 */
      const sz = Math.max(1.0, r * (0.014 + 0.024 * pieHash(i * 7.9 + 0.4)));
      const tw = 0.5 + 0.5 * Math.sin(t * 1.5 + i * 1.7);
      ctx.beginPath();
      ctx.arc(px, py, sz, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,252,' + (0.46 + 0.44 * tw).toFixed(3) + ')';
      ctx.fill();
      // 糖晶的暗边：白色小点压在金色派上，没有暗边会糊进去
      ctx.beginPath();
      ctx.arc(px + sz * 0.25, py + sz * 0.30, sz * 0.55, 0, TAU);
      ctx.fillStyle = 'rgba(186,132,58,0.22)';
      ctx.fill();
    }
    // ④ 整面一层很淡的糖光：撒过糖的派在灯下会泛白
    const gl = ctx.createRadialGradient(cx - r * 0.16, cy - ry * 0.30, r * 0.02, cx, cy, r * 0.86);
    gl.addColorStop(0, 'rgba(255,252,248,0.16)');
    gl.addColorStop(0.60, 'rgba(255,250,244,0.07)');
    gl.addColorStop(1, 'rgba(255,248,240,0)');
    ctx.beginPath();
    ctx.ellipse(cx, cy - ry * 0.06, r * 0.86, ry * 0.86, 0, 0, TAU);
    ctx.fillStyle = gl;
    ctx.fill();
    ctx.restore();
  }

  function pieSugar(ctx, cx, cy, r, S, e, t) {
    ctx.save();
    for (let i = 0; i < 10; i++) {
      const s = pieHash(i * 4.3 + 1.7);
      const ph = (t * (0.18 + 0.12 * s) + pieHash(i * 6.7)) % 1;
      const sx = cx + (pieHash(i * 2.9 + 0.3) - 0.5) * r * 1.9;
      const sy = cy - r * 0.62 + r * 1.15 * ph;
      const sz = Math.max(0.7, r * (0.016 + 0.011 * s));
      const al = e * Math.sin(ph * Math.PI) * 0.90;
      ctx.fillStyle = 'rgba(255,246,240,' + al.toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(sx, sy - sz * 2.2);
      ctx.lineTo(sx + sz, sy);
      ctx.lineTo(sx, sy + sz * 2.2);
      ctx.lineTo(sx - sz, sy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* 金色光尘：完美档里从派面往上飘的碎光 */
  function pieDust(ctx, cx, cy, r, S, e, t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const s = pieHash(i * 5.9 + 0.8);
      const ph = (t * (0.14 + 0.10 * s) + pieHash(i * 8.7)) % 1;
      const dx = cx + Math.sin(t * 0.5 + i) * r * (0.45 + 0.65 * s) * ph;
      const dy = cy + r * 0.50 - r * 1.45 * ph;
      const dr = Math.max(0.7, r * (0.013 + 0.011 * s));
      const al = e * Math.sin(ph * Math.PI) * 0.80;
      ctx.beginPath();
      ctx.arc(dx, dy, dr, 0, TAU);
      ctx.fillStyle = 'rgba(255,234,172,' + al.toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  /* 小石子：有石子那一档，派面上嵌着两三颗洗不掉的白石子 */
  function pieStones(ctx, cx, cy, r, S, e) {
    const ry = r * 0.40;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const a = pieHash(i * 5.3 + 2.4) * TAU;
      const rad = 0.25 + 0.55 * pieHash(i * 9.1 + 0.6);
      const sx = cx + Math.cos(a) * r * rad;
      const sy = cy + Math.sin(a) * ry * rad;
      const sr = r * (0.046 + 0.022 * pieHash(i * 3.9));
      ctx.beginPath();
      ctx.ellipse(sx, sy + sr * 0.3, sr * 1.05, sr * 0.55, 0, 0, TAU);
      ctx.fillStyle = 'rgba(30,14,4,' + (e * 0.26).toFixed(3) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(sx, sy, sr, sr * 0.82, a, 0, TAU);
      const g = ctx.createLinearGradient(sx - sr, sy - sr, sx + sr, sy + sr);
      g.addColorStop(0, 'rgba(246,244,238,' + (e * 0.95).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(172,166,154,' + (e * 0.95).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx - sr * 0.28, sy - sr * 0.28, Math.max(0.4, sr * 0.28), 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,' + (e * 0.80).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  /* 酸果档：坏果只是「刚摘下来就比较酸」，不是烂透了。
     所以这里**不画霉斑、不画飞虫、不画气泡** —— 那些是放到长毛才有的东西。
     只画「酸」能看见的两件事：切口渗出的酸汁（湿润、微亮），
     以及极淡的一点青色酸气。k=1.0 酸得倒牙 / 0.55 有一丝酸。 */
  function pieAcidJuice(ctx, cx, cy, r, S, e, t, k) {
    const KY = 0.40;                    // 派面透视压扁比（跟派盘一致）
    ctx.save();
    const n = k > 0.8 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      /* 画「被汁水浸湿的一小片派面」：扁、边缘柔、颜色浅琥珀。
         试过两种都不行：圆点缩小像糖珠，细长条+末端珠子像小虫。
         湿片没有硬轮廓、没有孤立高光点，任何尺寸都不会读错。 */
      const a = pieHash(i * 4.7 + 1.3) * TAU;
      const rad = 0.20 + 0.40 * pieHash(i * 7.9 + 0.4);
      const px = cx + Math.cos(a) * r * rad;
      const py = cy + Math.sin(a) * r * KY * rad;
      const dr = r * (0.070 + 0.036 * pieHash(i * 3.1 + 2.2));
      const g = ctx.createRadialGradient(px, py, dr * 0.10, px, py, dr);
      g.addColorStop(0, 'rgba(250,248,208,' + (e * (0.48 * k + 0.12)).toFixed(3) + ')');
      g.addColorStop(0.62, 'rgba(232,226,164,' + (e * 0.34 * k).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(226,218,150,0)');
      ctx.beginPath();
      ctx.ellipse(px, py, dr * 1.15, dr * 0.72, a * 0.6, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
      // 液面的边缘：只在上缘描一小段更亮的弧（张力的反光），不成点
      ctx.beginPath();
      ctx.ellipse(px, py, dr * 1.10, dr * 0.68, a * 0.6, Math.PI * 1.12, Math.PI * 1.88);
      ctx.strokeStyle = 'rgba(255,252,214,' + (e * 0.50 * k).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.8, dr * 0.10);
      ctx.stroke();
    }
    // 酸得倒牙：派沿再挂两道很细的汁，慢慢往下渗
    if (k > 0.8) {
      for (let i = 0; i < 2; i++) {
        const a = Math.PI * (0.52 + 0.22 * i);
        const px = cx + Math.cos(a) * r * 0.95;
        const py = cy + Math.sin(a) * r * KY * 0.95;
        const len = r * (0.11 + 0.035 * Math.sin(t * 0.7 + i * 2.1));
        ctx.beginPath();
        ctx.moveTo(px - r * 0.016, py);
        ctx.quadraticCurveTo(px - r * 0.010, py + len * 0.62, px, py + len);
        ctx.quadraticCurveTo(px + r * 0.010, py + len * 0.62, px + r * 0.016, py);
        ctx.closePath();
        ctx.fillStyle = 'rgba(234,224,156,' + (e * 0.46).toFixed(3) + ')';
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* 掉渣档：派沿下方、盘面上散落的派皮碎屑
     （20261116：这个函数之前只写了调用没写实现，muddy 档绘制时直接抛错中断，
      上面的标题和「点一下重做」都没画出来——已补上） */
  function pieCrumbsOnPlate(ctx, cx, cy, r, S, e, t) {
    const ry = r * 0.40;
    ctx.save();
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * (0.08 + 0.84 * pieHash(i * 3.7 + 0.9));
      const rad = 1.03 + 0.30 * pieHash(i * 6.1 + 2.2);
      const px = cx + Math.cos(a) * r * rad;
      const py = cy + Math.sin(a) * ry * rad * 1.08 + r * 0.05;
      const sz = r * (0.013 + 0.011 * pieHash(i * 2.3 + 4.1));
      // 投影
      ctx.beginPath();
      ctx.ellipse(px, py + sz * 0.55, sz * 1.20, sz * 0.60, 0, 0, TAU);
      ctx.fillStyle = 'rgba(72,44,18,' + (e * 0.20).toFixed(3) + ')';
      ctx.fill();
      // 碎屑本体：小片、带一点不规则的转角
      ctx.beginPath();
      ctx.ellipse(px, py, sz, sz * 0.80, pieHash(i * 1.7) * TAU, 0, TAU);
      const g = ctx.createLinearGradient(px - sz, py - sz, px + sz, py + sz);
      g.addColorStop(0, 'rgba(238,210,164,' + (e * 0.88).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(194,156,102,' + (e * 0.88).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  /* 焦糖档：沿派顶外缘一圈琥珀色的亮边，像糖被烤化又凝住 */
  function pieCaramelRim(ctx, cx, cy, r, S, e, t) {
    const ry = r * 0.40;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.62 + 0.22 * Math.sin(t * 1.6);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.99, ry * 0.99, 0, Math.PI * 0.02, Math.PI * 0.98);
    ctx.strokeStyle = 'rgba(255,166,52,' + (e * 0.34 * pulse).toFixed(3) + ')';
    ctx.lineWidth = Math.max(2.4, r * 0.085);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.985, ry * 0.985, 0, Math.PI * 0.02, Math.PI * 0.98);
    ctx.strokeStyle = 'rgba(255,216,138,' + (e * 0.62 * pulse).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1.2, r * 0.030);
    ctx.stroke();
    ctx.restore();
  }

  /* 分发：一档一套，互不重叠（流心的溢馅与甜美的蝴蝶结走独立的 J.stream / J.bow） */
  function drawPieFlavor(ctx, cx, cy, r, S, e, t, kind) {
    switch (kind) {
      case 'perfect': pieDust(ctx, cx, cy, r, S, e, t); break;
      case 'sweet': pieSugar(ctx, cx, cy, r, S, e, t); break;
      case 'toosweet':
        pieSyrup(ctx, cx, cy, r, S, e, t);
        pieBubbles(ctx, cx, cy, r, S, e, t, '255,204,116');
        break;
      case 'faint':
        pieBlossom(ctx, cx, cy, r, S, e, t);
        pieSmoke(ctx, cx, cy, r, S, e, t, '255,250,238', 2, 0.50, 0.55, 0.028, 0.6);
        break;
      case 'empty':
        /* 20261116 第七轮（玩家）：这一炉的主角是「派皮」，不是一坑泥。
           去掉那几条像划痕的裂纹，只留浅浅一塌 + 一点干面粉；
           馅少时四周本来就会露出金黄的派皮（见 drawAppleFilling 的覆盖半径）。 */
        pieSink(ctx, cx, cy, r, S, e, 0.62);
        pieFewSlices(ctx, cx, cy, r, S, e);
        pieGrains(ctx, cx, cy, r, S, e, t, '244,232,206', 20, 0.34, true, false);
        break;
      case 'thin':
        pieSink(ctx, cx, cy, r, S, e, 0.70);
        pieGaps(ctx, cx, cy, r, S, e);
        pieGrains(ctx, cx, cy, r, S, e, t, '236,206,158', 16, 0.34, true, false);
        break;
      case 'full':
        pieSmoke(ctx, cx, cy, r, S, e, t, '255,246,232', 3, 0.80, 0.55, 0.034, 0.3);
        break;
      case 'raw':
        pieSmoke(ctx, cx, cy, r, S, e, t, '216,240,252', 4, 0.92, 0.55, 0.044, 1.0);
        pieGrains(ctx, cx, cy, r, S, e, t, '255,253,248', 34, 0.70, false, false);
        break;
      case 'caramel':
        pieCaramelRim(ctx, cx, cy, r, S, e, t);
        pieSmoke(ctx, cx, cy, r, S, e, t, '255,230,192', 2, 0.55, 0.50, 0.030, 2.0);
        break;
      case 'burnt':
        pieSmoke(ctx, cx, cy, r, S, e, t, '198,190,182', 3, 1.00, 0.50, 0.032, 3.0);
        break;
      case 'carbon':
        pieSmoke(ctx, cx, cy, r, S, e, t, '150,142,136', 4, 1.15, 0.55, 0.038, 4.0);
        pieEmbers(ctx, cx, cy, r, S, e, t);
        break;
      case 'sour':
        /* 20261116（玩家）：坏果只是酸，不是烂。
           第七轮再收紧：**一点绿色气体都不要** —— 派上冒青烟看着像变质，很怪。
           现在只剩切口渗出的一小片湿亮酸汁。 */
        pieAcidJuice(ctx, cx, cy, r, S, e, t, 0.55);
        break;
      case 'rotten':
        /* 同上：不画霉斑、不画飞虫、不冒绿气，只把「酸」加重。 */
        pieAcidJuice(ctx, cx, cy, r, S, e, t, 1.0);
        break;
      case 'dusty':
        pieGrains(ctx, cx, cy, r, S, e, t, '228,216,190', 34, 0.55, true, false);
        pieStones(ctx, cx, cy, r, S, e);
        break;
      case 'muddy':
        /* 20261116 第七轮（玩家）：掉渣档派面上那些弯曲细线被读成了「毛」。
           掉渣只是掉渣，派面不该有毛 —— 去掉裂纹，只留砂粒与盘上的碎屑。 */
        pieGrains(ctx, cx, cy, r, S, e, t, '206,184,152', 34, 0.58, false, true);
        pieGrains(ctx, cx, cy, r, S, e, t, '222,202,172', 22, 0.50, true, false);
        pieCrumbsOnPlate(ctx, cx, cy, r, S, e, t);
        break;
      default: break;
    }
  }

  /* 甜美档的蝴蝶结：系在派顶上方，两片环 + 一个结 + 两条飘带。
     20261116 第三版（玩家）：前两版是深玫红，压在暖黄的派上发闷，
     看着像「一块深色的结」，一点都不甜美。
     这一版把整块缎带提到「樱桃粉 → 玫瑰糖」的亮度区间，描白边、结心换成糖珠、
     四周补几粒星芒 —— 甜美靠亮度和糖的质感，不是靠把颜色压深。 */
  function drawPieBow(ctx, cx, cy, r, ry, S, e, t) {
    const bx = cx + r * 0.005;
    const by = cy - ry * 0.02;
    /* 缩小一档：大了在暖黄派面上像两只粉色气球；小一点才读成「系上去的一个结」。 */
    const w = r * 0.300;
    const h = r * 0.185;
    ctx.save();
    ctx.globalAlpha = e;

    // 投影：贴着派面，读作「压在派上」
    ctx.beginPath();
    ctx.ellipse(bx, by + h * 0.92, w * 0.98, h * 0.44, 0, 0, TAU);
    ctx.fillStyle = 'rgba(70,22,34,0.20)';
    ctx.fill();

    // 两条飘带（从结心往下垂，末端斜口，长度只到派面）
    [-1, 1].forEach(sgn => {
      ctx.beginPath();
      ctx.moveTo(bx + sgn * w * 0.10, by + h * 0.05);
      ctx.bezierCurveTo(
        bx + sgn * w * 0.38, by + h * 0.70,
        bx + sgn * w * 0.26, by + h * 1.26,
        bx + sgn * w * 0.50, by + h * 1.44);
      ctx.lineTo(bx + sgn * w * 0.66, by + h * 1.30);
      ctx.bezierCurveTo(
        bx + sgn * w * 0.44, by + h * 1.10,
        bx + sgn * w * 0.52, by + h * 0.56,
        bx + sgn * w * 0.24, by + h * 0.10);
      ctx.closePath();
      const rg = ctx.createLinearGradient(bx, by, bx + sgn * w * 0.6, by + h * 1.4);
      rg.addColorStop(0, '#ffe0ec');
      rg.addColorStop(0.5, '#ff8fb4');
      rg.addColorStop(1, '#df5c85');
      ctx.fillStyle = rg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, r * 0.008);
      ctx.stroke();
    });

    // 两片环
    [-1, 1].forEach(sgn => {
      /* 20261116 第九轮（玩家）：上一版两片环是圆鼓鼓的胶囊，一眼看像两只粉色气球。
         真的蝴蝶结是「上下两条边在结心收窄、在外端收尖、中间有折痕」——
         所以这里把外端拉出一个尖角，并补一条从结心到尖角的折痕（明暗分界）。 */
      const ring = () => {
        ctx.beginPath();
        ctx.moveTo(bx, by - h * 0.22);
        ctx.bezierCurveTo(bx + sgn * w * 0.30, by - h * 1.16,
          bx + sgn * w * 0.94, by - h * 1.08, bx + sgn * w * 1.02, by - h * 0.30);
        ctx.bezierCurveTo(bx + sgn * w * 1.05, by - h * 0.06,
          bx + sgn * w * 1.00, by + h * 0.10, bx + sgn * w * 0.94, by + h * 0.22);
        ctx.bezierCurveTo(bx + sgn * w * 0.66, by + h * 0.66,
          bx + sgn * w * 0.24, by + h * 0.56, bx, by + h * 0.20);
        ctx.closePath();
      };
      ring();
      const g = ctx.createLinearGradient(bx, by - h, bx + sgn * w, by + h * 0.5);
      g.addColorStop(0, '#fff5f9');
      g.addColorStop(0.38, '#ffa8c8');
      g.addColorStop(1, '#ef6a95');
      ctx.fillStyle = g;
      ctx.fill();
      // 白缎带包边：这是「缎带」最直接的信号，浅到接近白才显甜
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.lineWidth = Math.max(1, r * 0.010);
      ctx.stroke();
      /* 20261117 第十轮（玩家）：上一版在翼里掏了个椭圆孔，还描了一圈亮边，
         结果被读成「两只眼睛 / 两个洞」，透不透都别扭。
         真正的缎带环不是靠「洞」成立的 —— 是靠「环内侧那道卷起来的折腔」。
         所以这里取消闭口椭圆：只画一道不闭合的弯月暗面（上边深、往里渐浅），
         再沿内缘补一条卷边亮线。不描边、不闭合，就不会再像眼睛。 */
      ctx.save();
      ring();
      ctx.clip();
      /* 折腔：贴着环内侧的一条弯月，越靠外端越深 —— 缎带在这里翻折 */
      ctx.beginPath();
      ctx.moveTo(bx + sgn * w * 0.08, by - h * 0.34);
      ctx.quadraticCurveTo(bx + sgn * w * 0.50, by - h * 0.84, bx + sgn * w * 0.96, by - h * 0.26);
      ctx.quadraticCurveTo(bx + sgn * w * 0.62, by - h * 0.10, bx + sgn * w * 0.08, by + h * 0.12);
      ctx.closePath();
      const cg = ctx.createLinearGradient(
        bx + sgn * w * 0.10, by - h * 0.60,
        bx + sgn * w * 0.96, by + h * 0.04);
      cg.addColorStop(0, 'rgba(214,102,140,0.08)');
      cg.addColorStop(0.55, 'rgba(186,66,106,0.26)');
      cg.addColorStop(1, 'rgba(168,50,90,0.34)');
      ctx.fillStyle = cg;
      ctx.fill();
      /* 缎面反光：折腔上方那一块才是受光面，缎带的光泽靠它 */
      const sh = ctx.createRadialGradient(
        bx + sgn * w * 0.36, by - h * 0.72, 0,
        bx + sgn * w * 0.36, by - h * 0.72, w * 0.60);
      sh.addColorStop(0, 'rgba(255,255,255,0.42)');
      sh.addColorStop(0.55, 'rgba(255,255,255,0.14)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(bx - w * 1.40, by - h * 2.20, w * 2.80, h * 4.40);
      /* 卷边：折腔下沿的一道细亮线，暗示缎带是卷起来的（不是贴片） */
      ctx.beginPath();
      ctx.moveTo(bx + sgn * w * 0.12, by + h * 0.16);
      ctx.quadraticCurveTo(bx + sgn * w * 0.62, by - h * 0.08, bx + sgn * w * 0.94, by - h * 0.22);
      ctx.strokeStyle = 'rgba(255,244,248,0.46)';
      ctx.lineWidth = Math.max(1, r * 0.011);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      // 折痕：从结心到外尖的一条明暗分界，蝴蝶结才「有折」
      ctx.save();
      ring();
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(bx, by - h * 0.06);
      ctx.quadraticCurveTo(bx + sgn * w * 0.48, by - h * 0.44, bx + sgn * w * 1.02, by - h * 0.30);
      ctx.lineTo(bx + sgn * w * 1.02, by + h * 0.24);
      ctx.quadraticCurveTo(bx + sgn * w * 0.48, by + h * 0.46, bx, by + h * 0.20);
      ctx.closePath();
      ctx.fillStyle = 'rgba(198,74,112,0.24)';     // 下半折面压暗
      ctx.fill();
      // 反折亮带：紧贴折痕的那一条，是缎带翻折时露出的背面
      ctx.beginPath();
      ctx.moveTo(bx, by - h * 0.04);
      ctx.quadraticCurveTo(bx + sgn * w * 0.50, by - h * 0.40, bx + sgn * w * 1.00, by - h * 0.26);
      ctx.strokeStyle = 'rgba(255,246,250,0.55)';
      ctx.lineWidth = Math.max(1, r * 0.016);
      ctx.stroke();
      ctx.restore();
      // 高光：沿环上缘一道白弧
      ctx.beginPath();
      ctx.moveTo(bx + sgn * w * 0.14, by - h * 0.56);
      ctx.quadraticCurveTo(bx + sgn * w * 0.54, by - h * 0.92, bx + sgn * w * 0.80, by - h * 0.32);
      ctx.strokeStyle = 'rgba(255,255,255,0.78)';
      ctx.lineWidth = Math.max(1, r * 0.015);
      ctx.stroke();
      // 缎面光泽：两条很淡的斜亮带 —— 缎带跟气球最大的区别就在这里
      ctx.save();
      ring();
      ctx.clip();
      for (const off of [-0.20, 0.16]) {
        ctx.beginPath();
        ctx.moveTo(bx + sgn * w * (0.12 + off), by - h * 1.2);
        ctx.quadraticCurveTo(bx + sgn * w * (0.46 + off), by - h * 0.30,
          bx + sgn * w * (0.34 + off), by + h * 0.9);
        ctx.strokeStyle = 'rgba(255,255,255,0.30)';
        ctx.lineWidth = Math.max(1, r * 0.020);
        ctx.stroke();
      }
      ctx.restore();
    });

    // 结心：一颗糖珠，而不是一块布结（布结太「硬」，糖珠才甜）
    const kb = ctx.createRadialGradient(bx - w * 0.05, by - h * 0.22, h * 0.04, bx, by, h * 0.86);
    kb.addColorStop(0, '#fff3f8');
    kb.addColorStop(0.45, '#ff9dc0');
    kb.addColorStop(1, '#d95a86');
    ctx.beginPath();
    ctx.ellipse(bx, by, w * 0.135, h * 0.62, 0, 0, TAU);
    ctx.fillStyle = kb;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.80)';
    ctx.lineWidth = Math.max(1, r * 0.009);
    ctx.stroke();

    ctx.globalAlpha = e;
    ctx.restore();
  }

  /* 塞满档的流心：馅从派顶下缘溢出来，沿派壁往下淌，末端挂一颗将落未落的。
     上宽下窄、带一点摆动，才不会看着像几根硬棍子。 */
  function drawPieDrip(ctx, cx, cy, r, ry, S, e, t) {
    ctx.save();
    ctx.globalAlpha = e;
    /* 20261116 第七轮（玩家）：三版垂滴全部失败 —— 獠牙、小瓶子、高脚杯。
       根因是尺度：派半径只有 88px，「竖条 + 珠子」怎么画都读成零件。
       这一版不再画实体垂滴，改成「卷边外沿两段湿润的糖浆反光」：
       低对比、不抢中心糖心，但看得出边上是黏的、刚刚溢过。 */
    for (const a0 of [0.44, 0.845]) {
      const pulse = 0.72 + 0.28 * Math.sin(t * 0.6 + a0 * 5);
      ctx.beginPath();
      ctx.ellipse(cx, cy + ry * 0.05, r * 0.945, ry * 0.945, 0, Math.PI * a0, Math.PI * (a0 + 0.10));
      ctx.strokeStyle = 'rgba(255,216,152,' + (0.52 * pulse).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2, r * 0.052);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    /* 盘面两处糖渍：极扁的一点亮斑，读作「滴下去过」 */
    for (const a of [0.52, 0.80]) {
      const px = cx + Math.cos(Math.PI * a) * r * 0.86;
      const py = cy + Math.sin(Math.PI * a) * ry * 0.92 + r * 0.30;
      const g = ctx.createRadialGradient(px, py, r * 0.004, px, py, r * 0.075);
      g.addColorStop(0, 'rgba(255,226,166,0.55)');
      g.addColorStop(1, 'rgba(206,132,44,0)');
      ctx.beginPath();
      ctx.ellipse(px, py, r * 0.075, r * 0.030, 0, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  /* 流心档：一颗完整的派，糖心从饼皮边缘「挤」出来，一注两注往盘上淌。
     20261117 第二十三版。前面试过切走一角、也试过画裂口，小尺寸下都会被读成
     「派上破了个洞 / 有道裂痕」—— 玩家明确说过没让加裂痕，也看不出切块。
     所以回到最直白的读法：派是完整的，糖是从饼皮边沿溢出来的。
       ① 派沿先被糖顶起一个鼓包（糖正从卷边缝里往外拱）；
       ② 糖顺着派壁淌下来，上粗—中细—落盘铺开，两侧走黏稠的弧线，带一道高光；
       ③ 落到盘面上积成一小滩，滩面反光，外沿一圈浅浅的糖渍。
     一共两注：右前一注大的、左前一注小的，都在观众看得到的这一侧。 */
  function pieHeart(ctx, cx, cy, r, ry, e, t) {
    const f = ry / r;
    const depth = r * 0.26;              // 派壁高度，必须与 drawDish 的 depth 一致
    const R1 = r * 0.255;

    ctx.save();
    ctx.globalAlpha = e;

    /* ---------- ① 馅满到派沿：一圈流心贴着卷边 ---------- */
    /* 这一档前后试过十几版「糖从派沿流下来」：细条像栏杆，糖片像袋子，
       垂下来那一截像小桶，派面上的糖痕像两根筷子。原因很简单 ——
       任何挂在派壁上的东西，在这个尺寸下都会被读成一个「配件」。
       换成没有凸出物的表达：馅满到派沿内侧，卷边里圈一整圈都是亮的糖，
       前端两处再稍微鼓出来一点，像就要溢出来、但还挂在边上。 */
    const ringIn = r * 0.872, ringOut = r * 0.972;
    /* 边缘带一点起伏：完全等宽的一圈会被读成「描了一圈线」 */
    const wob = a2 => 1 + 0.030 * Math.sin(a2 * 3.0 + 0.7) + 0.018 * Math.sin(a2 * 5.0 + 2.1);
    const edgeOf = (a2, inward) => {
      const R2 = inward
        ? ringIn * (1 - 0.022 * Math.sin(a2 * 4.0 + 1.4))
        : ringOut * wob(a2);
      return [cx + Math.cos(a2) * R2, cy + Math.sin(a2) * R2 * f];
    };
    ctx.beginPath();
    for (let i = 0; i <= 108; i++) {
      const p = edgeOf((i / 108) * TAU, false);
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    for (let i = 108; i >= 0; i--) {
      const p = edgeOf((i / 108) * TAU, true);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    const rg = ctx.createLinearGradient(cx, cy - ringOut * f, cx, cy + ringOut * f);
    rg.addColorStop(0, 'rgba(255,224,164,1)');
    rg.addColorStop(0.30, 'rgba(248,184,92,1)');
    rg.addColorStop(0.66, 'rgba(222,140,44,1)');
    rg.addColorStop(1, 'rgba(176,98,22,1)');
    ctx.fillStyle = rg;
    ctx.fill();
    /* 内缘一道浅色糖液面：亮在贴着派面的那一侧，糖才像「液面」不是「糖圈」 */
    ctx.beginPath();
    for (let i = 0; i <= 108; i++) {
      const a2 = (i / 108) * TAU;
      const p = edgeOf(a2, true);
      const dx = p[0] - cx, dy = p[1] - cy;
      const L2 = Math.hypot(dx, dy) || 1;
      const q = [p[0] + (dx / L2) * r * 0.006, p[1] + (dy / L2) * r * 0.006];
      if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = 'rgba(255,246,212,0.44)';
    ctx.lineWidth = Math.max(1, r * 0.010);
    ctx.stroke();

    /* 前端两处鼓包：馅在卷边那儿多顶出来一点，但不过卷边、更不往下垂 */
    [[Math.PI * 0.415, 0.078, 0.034], [Math.PI * 0.600, 0.050, 0.024]].forEach(function (o) {
      const a3 = o[0], rr3 = r * o[1], ry3 = r * o[2];
      const bxp = cx + Math.cos(a3) * r * 0.952;
      const byp = cy + Math.sin(a3) * r * 0.952 * f;
      const bg3 = ctx.createRadialGradient(
        bxp - r * 0.010, byp - r * 0.012, r * 0.004,
        bxp, byp, rr3);
      bg3.addColorStop(0, 'rgba(255,232,180,1)');
      bg3.addColorStop(0.55, 'rgba(246,182,88,1)');
      bg3.addColorStop(1, 'rgba(196,114,26,0.90)');
      ctx.beginPath();
      ctx.ellipse(bxp, byp, rr3, ry3, 0, 0, TAU);
      ctx.fillStyle = bg3;
      ctx.fill();
    });

    /* ---------- ④ 中心糖坑：圆形保留，液面反光加强 ---------- */
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, f);
    ctx.beginPath();
    ctx.ellipse(0, 0, R1, R1, 0, 0, TAU);
    const cg = ctx.createRadialGradient(-R1 * 0.26, -R1 * 0.30, R1 * 0.05, 0, 0, R1);
    cg.addColorStop(0, 'rgba(255,244,204,0.99)');
    cg.addColorStop(0.30, 'rgba(250,200,118,0.98)');
    cg.addColorStop(0.70, 'rgba(226,152,62,0.97)');
    cg.addColorStop(0.94, 'rgba(190,110,28,0.96)');
    cg.addColorStop(1, 'rgba(168,92,16,0.95)');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, R1 * 0.90, R1 * 0.90, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(255,250,226,0.40)';
    ctx.lineWidth = Math.max(1, r * 0.014);
    ctx.stroke();
    for (const ph2 of [0, 2.2]) {
      const sw = Math.sin(t * 0.75 + ph2) * 0.55;
      ctx.beginPath();
      ctx.ellipse(R1 * 0.06 * Math.cos(ph2), R1 * 0.06 * Math.sin(ph2),
        R1 * 0.58, R1 * 0.58, sw * 0.28, 0.5 + ph2 * 0.15, 2.3 + ph2 * 0.15);
      ctx.strokeStyle = 'rgba(255,248,220,' + (ph2 ? 0.26 : 0.44) + ')';
      ctx.lineWidth = Math.max(1, r * (ph2 ? 0.009 : 0.012));
      ctx.stroke();
    }
    const hg = ctx.createRadialGradient(-R1 * 0.22, -R1 * 0.26, R1 * 0.02, -R1 * 0.22, -R1 * 0.26, R1 * 0.52);
    hg.addColorStop(0, 'rgba(255,255,250,0.34)');
    hg.addColorStop(1, 'rgba(255,255,250,0)');
    ctx.beginPath();
    ctx.ellipse(0, 0, R1, R1, 0, 0, TAU);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

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
    // 这一炉的全部判定（标题 / 副标 / 蝴蝶结 / 流心 / 光环）都从这里取，画面和文字不会打架
    const J = evePieJudge(st);

    /* 最完美：背景四散的散射金光 —— 十几道粗细不一的扇形光从派心射出去，
       慢速自转 + 各自呼吸，配合下面那一圈金色光环。用 lighter 叠色，
       才有「光从派里透出来」的感觉，而不是贴了几块半透明色块。 */
    if (J.halo) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      /* 先铺一层大范围的金色光晕：光束再柔，没有这层底色也会显得干。 */
      const glow = ctx.createRadialGradient(cx, cy - r * 0.10, r * 0.36, cx, cy - r * 0.10, W * 0.64);
      glow.addColorStop(0, 'rgba(255,208,124,' + (0.17 * e).toFixed(3) + ')');
      glow.addColorStop(0.58, 'rgba(255,182,84,' + (0.06 * e).toFixed(3) + ')');
      glow.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      /* 20261116 第三版：上一版光一直射到画面边缘，看着像星芒爆炸。
         现在 8 道、更宽、半径收到 0.5~0.6W —— 光是「散在派周围」，
         而不是刺穿整屏。 */
      const rays = 7;
      for (let i = 0; i < rays; i++) {
        const a0 = t * 0.10 + (i / rays) * TAU;
        /* 20261116 第四版：光再收一档 —— 半径从 0.5~0.6W 收到 0.4~0.48W，
           单道扇形放宽到 8~11°，这样是「大块的散射光围在派周围」，
           而不是几道细光射穿整屏、把标题也切了。 */
        const wide = 0.130 + 0.070 * (0.5 + 0.5 * Math.sin(i * 2.7 + 1.1));
        const R = W * (0.40 + 0.08 * Math.sin(t * 0.55 + i * 1.3));
        /* 每道光画三层同心扇形（宽→窄、淡→浓），两侧边界自然过渡。
           单层硬边扇形画出来就是探照灯，三层叠下来才像"光散在空气里"。 */
        [[1, 0.34, 0.88], [0.64, 0.62, 0.94], [0.34, 1.0, 1.0]].forEach((lay) => {
          const ws = lay[0], ka = lay[1], rk = lay[2];
          const g2 = ctx.createRadialGradient(cx, cy - r * 0.10, r * 0.52, cx, cy - r * 0.10, R);
          g2.addColorStop(0, 'rgba(255,222,150,' + (0.24 * e * ka).toFixed(3) + ')');
          g2.addColorStop(0.42, 'rgba(255,200,110,' + (0.10 * e * ka).toFixed(3) + ')');
          g2.addColorStop(1, 'rgba(255,180,70,0)');
          ctx.fillStyle = g2;
          ctx.beginPath();
          ctx.moveTo(cx, cy - r * 0.10);
          ctx.arc(cx, cy - r * 0.10, R * rk, a0 - wide * ws, a0 + wide * ws);
          ctx.closePath();
          ctx.fill();
        });
      }
      ctx.restore();
    }

    // 完美的金环（柔光：细线 + 大范围发光。硬边椭圆看着像"选中框"，不像光）
    if (st.isPerfect) {
      ctx.save();
      ctx.globalAlpha = e * (0.58 + 0.24 * Math.sin(t * 2.0));
      ctx.strokeStyle = 'rgba(255,222,152,0.88)';
      ctx.lineWidth = 2.4 * S;
      ctx.shadowColor = 'rgba(255,196,90,0.95)';
      ctx.shadowBlur = 26 * S;
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.18, r * 1.30, r * 0.58, 0, 0, TAU);
      ctx.stroke();
      // 外圈再补一层更淡的，边缘就不会那么硬
      ctx.globalAlpha = e * 0.26;
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.18, r * 1.48, r * 0.70, 0, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 星星
      for (let i = 0; i < 8; i++) {
        const a = t * 0.6 + (i / 8) * TAU;
        const sr = r * (1.40 + 0.10 * Math.sin(t * 2 + i));
        const sx = cx + Math.cos(a) * sr;
        const sy = cy + r * 0.20 + Math.sin(a) * r * 0.62;
        ctx.globalAlpha = e * (0.42 + 0.58 * Math.abs(Math.sin(t * 2.2 + i)));
        ctx.fillStyle = '#ffeebe';
        ctx.beginPath();
        ctx.moveTo(sx, sy - 4.2 * S);
        ctx.lineTo(sx + 1.3 * S, sy - 1.3 * S);
        ctx.lineTo(sx + 4.2 * S, sy);
        ctx.lineTo(sx + 1.3 * S, sy + 1.3 * S);
        ctx.lineTo(sx, sy + 4.2 * S);
        ctx.lineTo(sx - 1.3 * S, sy + 1.3 * S);
        ctx.lineTo(sx - 4.2 * S, sy);
        ctx.lineTo(sx - 1.3 * S, sy - 1.3 * S);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    /* 甜美档专属：派后面一层暖暖的粉光。
       「甜」不只是配件，还是整张图的氛围 —— 让这一炉看起来像甜品台的照片。 */
    if (J.kind === 'sweet') {
      const ph = ctx.createRadialGradient(cx, cy + r * 0.06, r * 0.55, cx, cy + r * 0.06, r * 1.80);
      ph.addColorStop(0, 'rgba(255,186,206,' + (0.26 * e).toFixed(3) + ')');
      ph.addColorStop(0.55, 'rgba(255,168,196,' + (0.10 * e).toFixed(3) + ')');
      ph.addColorStop(1, 'rgba(255,168,196,0)');
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.06, r * 1.80, r * 1.16, 0, 0, TAU);
      ctx.fillStyle = ph;
      ctx.fill();
    }

    /* 20261116 第七轮：成品这一张加上「顶部苹果圈」与「夹心层」。
       topRing 的片数跟着塞进去的片数走（馅少的派不会凭空长满一圈）；
       夹心只给塞满/流心那几炉 —— 那是它们跟别的派长得不一样的地方。 */
    const fillK = eveFillK(st);
    drawDish(ctx, cx, cy, r, {
      k: k, fill: fillK, lattice: 1, glaze: st.coat > 0 ? 1 : 0.4, sugared: 1,
      /* 片数按馅量分档。玩家的要求是「码一圈、码整齐」，
         所以数量要够密：16 片以上相邻两片真的压到一起，才连成一条边。 */
      topRing: fillK >= 0.95 ? 10 : fillK >= 0.75 ? 10 : fillK >= 0.5 ? 9 : fillK >= 0.3 ? 7 : 0,
      core: !!J.stream,
      /* 甜美档的苹果片提亮一档：它的甜要靠「糖渍苹果」那种亮，不是靠蝴蝶结一个配件 */
      ringBright: J.kind === 'sweet' ? 1 : 0,
    });

    /* 档位装饰（画在派之后，才压得住网格）：
       塞满 → 馅从边沿流出来；甜美 → 系一个缎带蝴蝶结。两者可以同时出现。 */
    const dry = r * 0.40;
    /* 完美档：光环在派之后再补一道前景弧。
       前面那道整圈有一半会被派盖住，只看得到上半圈，像个断掉的框；
       这里按「派沿外侧的下半圈」再描一道，光环就完整地兜住了派。 */
    if (J.halo) {
      ctx.save();
      ctx.globalAlpha = e * (0.50 + 0.22 * Math.sin(t * 2.0));
      ctx.strokeStyle = 'rgba(255,226,160,0.90)';
      ctx.lineWidth = 2.2 * S;
      ctx.shadowColor = 'rgba(255,198,92,0.95)';
      ctx.shadowBlur = 24 * S;
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.18, r * 1.30, r * 0.58, 0, Math.PI * 0.02, Math.PI * 0.98);
      ctx.stroke();
      ctx.restore();
    }
    /* 流心档的心脏：中心一块塌下去的糖心（玩家要的「中间有夹心」）。
       画在网格之上才看得见 —— 压在网格下面只会被缝里的暗色吃掉。 */
    if (J.stream) {
      /* 流心的全部视觉都在 pieHeart 里：中心糖坑 + 三条漫到派沿的流心。
         原来那个 drawPieDrip（卷边湿润反光）已并入，避免两处糖浆各说各话。 */
      pieHeart(ctx, cx, cy, r, dry, e, t);
    }
    /* 甜美档：糖霜先落在派面上，蝴蝶结再压上去 —— 反过来糖粉会把缎带糊白。 */
    if (J.kind === 'sweet') {
      pieFrost(ctx, cx, cy, r, dry, e, t);
      pieSparkle(ctx, cx, cy, r, e, t);
    }
    if (J.bow) drawPieBow(ctx, cx, cy, r, dry, S, e, t);
    /* 每一档自己的小特色：热气 / 烟 / 霉斑 / 糖丝 / 苹果花 / 石子 / 火星……
       画在派之后，才压得住网格；范围也收在派与盘之间，不上探到标题。 */
    drawPieFlavor(ctx, cx, cy, r, S, e, t, J.kind);

    /* 文案：标题与副标全部来自 evePieJudge —— 标题统一成「……的苹果派」，
       副标只报这一炉的账（甜度 / 馅量 / 蛋液 / 火候 / 坏果 / 洗净）。 */
    const title = J.title, sub = J.sub;
    /* 20261114：结算页三行字原来挤成两行 —— 副标题落点（y+19S）正好被底部的
       「点一下重做」提示条压住。现在标题上移到 0.772、提示条下移到 0.862，
       中间留出约一行半的空隙。 */
    drawResultText(ctx, W, H, S, title, sub, !!J.halo, 0.772);
    drawHint(ctx, '点一下重做', W, H, S, '#ffe9cf', 0.895);
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

  /* ★ 20261116：苹果派的十六档结算，**唯一档位表**。
     预览页（__pieflow.html）和主项目（入梦签调试器）都从这里取，
     免得两边各写一份、改一档忘一处。
     每项：name=档名（和 evePieJudge 的 title 一致），opt=喂给 debugJump 的状态。
       cuts=片数 / sweet=糖量 / sugar=糖分 / coat=蛋液 / t=烘烤秒数
       bad=坏果颗数 / dirty=洗净档（2 掉渣浅档、3 石子深档）
     顺序与 evePieJudge 的判定优先级一致，一档一档对得下来。 */
  const PIE_TIERS = [
    { name: '最完美的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 20, coat: 1, t: 4.2 } },
    { name: '甜美的苹果派', opt: { cuts: 10, sweet: 0.72, sugar: 14, coat: 1, t: 4.2 } },
    { name: '像糖浆的苹果派', opt: { cuts: 10, sweet: 0.92, sugar: 6, coat: 1, t: 4.2 } },
    { name: '不太甜的苹果派', opt: { cuts: 10, sweet: 0.30, sugar: 6, coat: 1, t: 4.2 } },
    { name: '几乎没馅的苹果派', opt: { cuts: 3, sweet: 0.54, sugar: 14, coat: 1, t: 4.2 } },
    { name: '皮比馅多的苹果派', opt: { cuts: 6, sweet: 0.54, sugar: 14, coat: 1, t: 4.2 } },
    { name: '流心的苹果派', opt: { cuts: 15, sweet: 0.54, sugar: 14, coat: 1, t: 4.2 } },
    { name: '刚刚好的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 14, coat: 0.7, t: 4.2 } },
    { name: '还没烤熟的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 14, coat: 1, t: 2.0 } },
    { name: '焦糖色的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 14, coat: 1, t: 5.5 } },
    { name: '边上烤糊的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 14, coat: 1, t: 6.8 } },
    { name: '成了炭的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 14, coat: 1, t: 8.4 } },
    { name: '有点发酸的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 14, coat: 1, t: 4.2, bad: 1 } },
    { name: '酸得倒牙的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 14, coat: 1, t: 4.2, bad: 4 } },
    { name: '有些掉渣的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 14, coat: 1, t: 4.2, dirty: 2 } },
    { name: '有石子的苹果派', opt: { cuts: 10, sweet: 0.54, sugar: 14, coat: 1, t: 4.2, dirty: 3 } },
  ];

  window.BMFX_SPECIAL = {
    halloween: { start: (cv) => mount('halloween', cv, halloweenHooks) },
    christmasEve: { start: (cv) => mount('christmasEve', cv, eveHooks) },
    PIE_TIERS,
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
      /* 20261116：预览页可以直接跳到前置三段看效果（摇树 / 挑果 / 洗果） */
      if (phase === 'shake') {
        eveReset(st); st.fade = 1;
        return true;
      }
      if (phase === 'pick') {
        eveReset(st);
        if (st._W) eveStartPick(st, st._W, st._H, st._S);
        st.fade = 1;
        return true;
      }
      if (phase === 'wash') {
        eveReset(st);
        if (st._W) eveStartWash(st, st._W, st._H, st._S);
        st.fade = 1;
        return true;
      }
      if (phase === 'board') {
        eveReset(st);
        st.phase = 'board'; st.phaseT = 0;   // eveReset 现在从「摇树」开始，调试切苹果要显式跳回来
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
        /* 20261116：调试也能单独看「有点发酸 / 没洗干净 / 甜美 / 流心」这几档，
           不用真去玩一遍。opt.bad=坏果颗数，opt.dirty=洗净档 0~3。 */
        st.pickOut = 6;
        st.pickBadIn = opt.bad == null ? 0 : clamp(opt.bad, 0, 6);
        st.badRatio = clamp(st.pickBadIn / 6, 0, 1);
        st.dirty = clamp(opt.dirty || 0, 0, 3);
        st.washP = st.dirty === 0 ? 1 : st.dirty === 1 ? 0.88 : st.dirty === 2 ? 0.60 : 0.30;
        st.washProgress = st.washP;
        st.washPenalty = [0, 4, 9, 15][st.dirty];
        st.total = Math.max(0, st.sliceScore + st.sugarScore + st.coatScore + st.bakeScore - st.washPenalty);
        st.isPerfect = st.cookResult === 'perfect' && inGold && nc === EVE_FULL_SLICES &&
          st.trash === 0 && st.sugarScore >= 20 && st.coatScore >= 20 &&
          st.pickBadIn === 0 && st.dirty === 0;
        st.phase = 'done'; st.phaseT = 0; st.doneK = 1; st.fade = 1;
        // 与真玩时一样：结算态让底部的寄语淡出
        if (st.__host && st.__host.classList) st.__host.classList.add('fx-result');
        // 预览页也要看得到「送给 TA」按钮
        if (st.__host && st.__host.classList) st.__host.classList.add('fx-done');
        if (st.__host && st.__host.dataset) {
          st.__host.dataset.pie = JSON.stringify({
            perfect: !!st.isPerfect, cook: st.cookResult || '', slices: nc, sweet: st.sugar || 0,
            badRatio: Number(st.badRatio.toFixed(3)), badN: st.pickBadIn,
            dirty: st.dirty, washP: st.washP,
          });
        }
      }
      return true;
    },
  };
})();
