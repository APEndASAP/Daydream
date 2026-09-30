/* ============================================================
   白日梦 · 开屏动画 v10「星轨手稿」— 独立预览（未接入应用）
   ------------------------------------------------------------
   ① 双六芒星彗星（液态尾迹）自右上角落入，慢→快（easeIn）；
     刚性双星互绕 4 圈交缠（相位差 π，分离距有结构下限），
     引导线终点=本侧轨道端点、到达方向=轨道切线——落轨零拐点
   ② 双彗星起笔各画一条完整椭圆星轨（金顺/蓝逆，起步带速
     不停顿）；三条同心圆 + 一条淡灰残墨椭圆由小星点画笔
     错落画满——全部完整闭环；18 颗圆点大小不一，其中 6 颗
     （每环一颗）带超小 Courier 打印体英文词沿轨旋转
   ③ 画完后双彗星沿切线出发大圆弧拱向最高点=中轴线起点（全程
     曲线、匀速无停顿），到达方向=向中横向收拢（零拐角）；在最
     高点横向收拢交汇、两星渐隐合为一颗六芒星渐显（交叉淡化，
     几乎点一下即落），合一后自最高点向下加速拉出长中轴线
     （笔尖=拉星，绝对同步）
   ④ 拉线过中心时金蓝双色中央星诞生——触发 WebAudio 合成
     「宇宙深处的叮」（钟音泛列+卷积混响，余韵 7 秒+）；三
     椭圆各自持续进动且旋转段不断提速直到最后一秒；背景深
     灰→纸白快速翻面
   文字层（全部跟随黑白反转）：
   · 标题落款（红标注位）：白日梦（0.665h 最大）+ Daydream
     （极小）｜祝你有一场好梦（0.815h 次大）+ Wishing you a
     beautiful dream（极极小）；字体=项目系统 --font 字族
   · 角落预设文案（蓝标注位）：六条拉丁箴言+中文小注，左上/
     右下交替播放，打字机体、弱存在感
   · 背景掉落字符串（黄标注意）：箴言词竖排如细雨错落飘落，
     底部自动消散，淡墨+打印残影质感
   · 右下「跳过」按钮（接入模式与循环预览均显示）
   整体节奏越来越快；各段衔接速度连续（无停顿）。
   质感：老式打印机墨水（inkStroke 渗化毛边）× 特种纸
   （深灰相=黑素材纸斑点纤维加强，纸白相=草本颗粒）。

   双模式：默认单次播放（接入用）；宿主 data-loop="1" 循环预览+点击重播。
   纪律：IIFE 全隔离；resize 用 addEventListener；仅存在期间挂载；
   低端机 / prefers-reduced-motion 不播（循环预览除外）。
   ============================================================ */
(function () {
  'use strict';

  /* ==== 可调参数 ==== */
  var CFG = {
    T_FALL: 2400,            // ① 落入（幕内加速）
    T_DRAW: 3500,            // ② 画轨（六环错落，各环窗口递减=越来越快）
    T_AXIS: 1500,            // ③ 绕行滑入已在画轨段完成；此段=汇合+拉轴+点星
    T_ROT:  7600,            // ④ 各环异速进动 + 转白（白底短句延长，结尾略收）
    FADE: 900, LOOP_PAUSE: 420,
    FADE_OUT: 1600,          // 单次播放结尾过渡时长（ms）：画面淡出，BGM 在此后再余韵 1~2s
    CXK: 0.5, CYK: 0.40,     // 星盘中心（中上部——按参考红圈位置再上移）
    RK_W: 0.205, RK_H: 0.128, // 基准半径——整体再缩小一点
    AXK: 1.5                 // 中轴线半长 = AXK × R
  };
  var TD = CFG.T_DRAW, TA = CFG.T_AXIS;
  var MERGE_D = 220, PULL_D = 1150, VAN_D = 200;       // 合体（最高点交汇，几乎点一下即落）/拉轴/消散
  var T_DRAW_S = CFG.T_FALL,
      T_AXIS_S = T_DRAW_S + TD,
      T_ROT_S  = T_AXIS_S + TA,
      T_END    = T_ROT_S + CFG.T_ROT;
  function pullProg(l) { return 0.25 * l + 0.75 * Math.pow(l, 2.6); }   // 拉轴：从慢到快（起步缓、末段急加速）
  var T_BORN = (function () {                          // 笔尖越过画面中心=中央星诞生（数值解）
    var lo = 0, hi = 1, m, i;
    for (i = 0; i < 28; i++) { m = (lo + hi) / 2; if (pullProg(m) < 0.5) lo = m; else hi = m; }
    return T_AXIS_S + MERGE_D + (lo + hi) / 2 * PULL_D;
  })();

  /* ==== 宿主 / 模式 ==== */
  var host = document.currentScript
    ? (document.currentScript.previousElementSibling || document.getElementById('bm-splash-host') || document.body)
    : document.body;
  var LOOP = false;
  try { LOOP = !!(host && host.getAttribute && host.getAttribute('data-loop') === '1'); } catch (e) {}
  try {
    if (!LOOP && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (e) {}

  /* ==== 画布 ==== */
  var cv = document.createElement('canvas');
  cv.id = 'splash-v5-canvas';
  // 20260930ce：CSS 尺寸禁用 100vw/100vh——移动端 100vh=「大视口」恒大于 innerHeight（地址栏占位），
  // 内部按 innerHeight 绘制、CSS 却拉到大视口高度→整幅垂直拉伸，正圆变竖椭圆。改为 100% 初值，
  // 并在 resize() 里用 innerWidth/innerHeight 的像素值强制同步（CSS 尺寸≡绘制坐标系，拉伸无从发生）。
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;z-index:2147483000;cursor:pointer;background:rgb(21,22,28);';
  (document.body || document.documentElement).appendChild(cv);
  var ctx = cv.getContext('2d');
  var DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  /* ==== 调色（深灰相 → 纸白相插值）==== */
  var PAL = {
    bgD: [21, 22, 28],      bgW: [236, 233, 226],
    inkD: [203, 209, 221],  inkW: [70, 72, 82],
    goldD: [201, 164, 97],  goldW: [156, 116, 52],
    blueD: [126, 158, 199], blueW: [63, 97, 139],
    axD: [176, 182, 196],   axW: [90, 92, 102]
  };
  function mix3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function ss(a, b, t) { var k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); }
  function easeIO(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
  function lerp(a, b, k) { return a + (b - a) * k; }

  /* ==== 几何 / 纸纹（仅颗粒+纤维+残墨点，无烟雾）==== */
  var w, h, cx, cy, R, SC, AH, A_Y, B_Y, bgDark, bgWhite;

  function buildBg(base, darkEdge) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * DPR)); c.height = Math.max(1, Math.ceil(h * DPR));
    var g = c.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = rgba(base, 1); g.fillRect(0, 0, w, h);
    var i, x, y, ln, an, dark;
    for (i = 0; i < 80; i++) {           // 纸纤维划痕
      x = Math.random() * w; y = Math.random() * h;
      an = Math.random() * Math.PI; ln = 12 + Math.random() * 70;
      dark = Math.random() < 0.5;
      g.strokeStyle = dark ? 'rgba(0,0,0,' + (0.015 + Math.random() * 0.03).toFixed(3) + ')'
                           : 'rgba(255,255,255,' + (0.012 + Math.random() * 0.028).toFixed(3) + ')';
      g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an) * ln, y + Math.sin(an) * ln); g.stroke();
    }
    for (i = 0; i < 620; i++) {          // 颗粒雀斑（草本纸感）
      x = Math.random() * w; y = Math.random() * h;
      dark = Math.random() < 0.55;
      g.fillStyle = dark ? 'rgba(0,0,0,' + (0.02 + Math.random() * 0.05).toFixed(3) + ')'
                         : 'rgba(255,255,255,' + (0.015 + Math.random() * 0.04).toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, 0.35 + Math.random() * 0.8, 0, 6.2832); g.fill();
    }
    for (i = 0; i < 26; i++) {           // 残墨点（少量稍大）
      x = Math.random() * w; y = Math.random() * h;
      g.fillStyle = 'rgba(10,10,14,' + (0.04 + Math.random() * 0.05).toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, 0.9 + Math.random() * 1.2, 0, 6.2832); g.fill();
    }
    if (darkEdge) {                      // 黑素材纸质感（参考图黑纸部分）：白色斑点密布+发丝纤维
      for (i = 0; i < 900; i++) {
        x = Math.random() * w; y = Math.random() * h;
        g.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.07).toFixed(3) + ')';
        g.beginPath(); g.arc(x, y, 0.3 + Math.random() * 0.7, 0, 6.2832); g.fill();
      }
      for (i = 0; i < 7; i++) {          // 弯曲发丝纤维
        x = Math.random() * w; y = Math.random() * h;
        ln = 20 + Math.random() * 60; an = Math.random() * Math.PI;
        g.strokeStyle = 'rgba(255,255,255,' + (0.03 + Math.random() * 0.05).toFixed(3) + ')';
        g.lineWidth = 0.5;
        g.beginPath(); g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(an) * ln * 0.5 + (Math.random() - 0.5) * 14,
                           y + Math.sin(an) * ln * 0.5 + (Math.random() - 0.5) * 14,
                           x + Math.cos(an) * ln, y + Math.sin(an) * ln);
        g.stroke();
      }
    }
    var vg = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.30, cx, cy, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, darkEdge ? 'rgba(0,0,0,0.26)' : 'rgba(96,84,66,0.13)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    return c;
  }

  function resize() {
    w = window.innerWidth; h = window.innerHeight;
    cv.width = Math.ceil(w * DPR); cv.height = Math.ceil(h * DPR);
    // 20260930ce：CSS 显示尺寸逐像素钉死为 innerWidth/innerHeight（不用 vw/vh/100%）——
    // 移动端地址栏收放时 100vh≠innerHeight，会整体拉伸画面；px 同步后圆环恒为正圆。
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = w * CFG.CXK; cy = h * CFG.CYK;
    R = Math.min(w * CFG.RK_W, h * CFG.RK_H);
    SC = clamp(R / 90, 0.75, 1.8);       // 细节尺寸随星盘缩放
    AH = R * CFG.AXK; A_Y = cy - AH; B_Y = cy + AH;
    bgDark = buildBg(PAL.bgD, true);
    bgWhite = buildBg(PAL.bgW, false);
    initStrings();                       // 字符串坐标依赖 w/h，随 resize 重建
  }

  /* ==== 星轨定义（全部完整闭环；窗口递减=越来越快；方向交错）==== */
  var ELLS = [
    { rx: 0.94, ry: 0.30, rot: -0.14, col: 'gold', a: 0.62, w: [0.000, 0.46], dir:  1, th0: 0.0000, pre:  0.26 },
    { rx: 0.72, ry: 0.28, rot: -0.92, col: 'blue', a: 0.62, w: [0.050, 0.48], dir: -1, th0: 3.1416, pre: -0.17 },
    { rx: 1.00, ry: 0.26, rot:  0.05, col: 'ink',  a: 0.34, w: [0.620, 0.93], dir: -1, th0: -1.55, pre:  0.09 }
  ];
  var CIRCS = [
    { r: 1.00, a: 0.36, w: [0.30, 0.65], dir:  1, th0: 2.4 },
    { r: 0.72, a: 0.34, w: [0.44, 0.74], dir: -1, th0: 4.1 },
    { r: 0.46, a: 0.30, w: [0.56, 0.82], dir:  1, th0: 1.2, dash: true }
  ];
  var NODE_F = [-1, -0.667, -0.48, 0.48, 0.667, 1];   // 中轴线节点（±端、±外圈、±中圈）

  function ellPt(E, th, pre) {
    var rt = E.rot + pre, X = Math.cos(th) * E.rx * R, Y = Math.sin(th) * E.ry * R;
    var ct = Math.cos(rt), st = Math.sin(rt);
    return { x: cx + X * ct - Y * st, y: cy + X * st + Y * ct };
  }
  function ellTan(E, th, dir) {          // 椭圆行进切线（单位向量）
    var tx = -E.rx * Math.sin(th) * dir, ty = E.ry * Math.cos(th) * dir;
    var n = Math.sqrt(tx * tx + ty * ty) || 1;
    return { x: tx / n, y: ty / n };
  }
  function orbQ(time, w0, w1) {          // 画轨进度：起步带速（0.55）→持续加速（1.45×），无起笔停顿
    var l = clamp((time - T_DRAW_S - w0 * TD) / ((w1 - w0) * TD), 0, 1);
    return 0.55 * l + 0.45 * l * l;
  }
  function orbEnd(w1) { return T_DRAW_S + w1 * TD; }
  function preOf(E, time) {              // 各椭圆自己的进动节奏（持续加速到最后，越来越快）
    var tt = clamp(time - T_ROT_S, 0, T_END - T_ROT_S);
    var ramp = ss(T_ROT_S - 60, T_ROT_S + 700, time);          // 缓入
    var accel = 1 + 0.9 * ss(T_ROT_S, T_ROT_S + 4200, time);    // 旋转段持续提速（坡随长旋转幕拉长）
    return E.pre * ramp * accel * tt / 1000;
  }

  /* ==== 轨道圆点（大小不一、错落有致；方向/速度各异）==== */
  var DOTS = [
    { o: 'c0', th: 0.50, r: 1.05, al: 0.85, spd:  0.14, dl:  60 },
    { o: 'c0', th: 1.32, r: 2.30, al: 0.90, spd:  0.14, dl: 210, ringed: true, tint: 'blue' },
    { o: 'c0', th: 2.05, r: 1.15, al: 0.45, spd:  0.14, dl: 120 },
    { o: 'c0', th: 3.55, r: 1.55, al: 0.70, spd:  0.14, dl: 330 },
    { o: 'c0', th: 4.42, r: 0.95, al: 0.40, spd:  0.14, dl:  90 },
    { o: 'c0', th: 5.40, r: 1.90, al: 0.80, spd:  0.14, dl: 460, tint: 'gold' },
    { o: 'c1', th: 0.92, r: 1.25, al: 0.60, spd: -0.20, dl: 150 },
    { o: 'c1', th: 2.38, r: 1.85, al: 0.75, spd: -0.20, dl: 380, tint: 'blue' },
    { o: 'c1', th: 4.02, r: 0.95, al: 0.40, spd: -0.20, dl:  90 },
    { o: 'c1', th: 5.62, r: 1.45, al: 0.65, spd: -0.20, dl: 520 },
    { o: 'c2', th: 1.72, r: 1.05, al: 0.50, spd:  0.26, dl: 140 },
    { o: 'c2', th: 4.86, r: 1.35, al: 0.60, spd:  0.26, dl: 420 },
    { o: 'e0', th: 0.85, r: 1.45, al: 0.80, crawl:  0.045, dl: 100, tint: 'gold' },
    { o: 'e0', th: 3.65, r: 1.00, al: 0.50, crawl: -0.030, dl: 300, tint: 'gold' },
    { o: 'e1', th: 2.18, r: 1.55, al: 0.80, crawl: -0.050, dl: 120, tint: 'blue' },
    { o: 'e1', th: 5.05, r: 0.95, al: 0.50, crawl:  0.035, dl: 340, tint: 'blue' },
    { o: 'e2', th: 1.10, r: 1.15, al: 0.45, crawl:  0.030, dl: 160 },
    { o: 'e2', th: 4.28, r: 1.45, al: 0.55, crawl: -0.025, dl: 400 }
  ];
  function dotReveal(d, time) {
    var end = d.o.charAt(0) === 'c' ? orbEnd(CIRCS[d.o.charAt(1)].w[1]) : orbEnd(ELLS[d.o.charAt(1)].w[1]);
    return ss(end + d.dl, end + d.dl + 420, time);
  }
  var WORDS = ['Hope', 'Guidance', 'Inner Light', 'Destiny', 'Transcendence', 'Eternity']; // 参考图六词
  var WORD_DOTS = [1, 7, 11, 12, 14, 17];    // 只 6 颗圆点带词（c0/c1/c2/e0/e1/e2 每环一颗，其余纯圆点）

  /* ==== 项目系统字体（style.css --font 字族；标题落款使用）==== */
  var FONT_APP = '"Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", sans-serif';
  var FONT_TYPE = '"Courier New", "Nimbus Mono PS", Courier, monospace';   // 打字机体（参考图字体风格）

  /* ==== 角落预设文案（蓝标注位：左上/右下交替；打字机体+中文小注，弱存在感）==== */
  var QUOTES = [
    { en: 'Hinc itur ad astra', zh: '此处通往繁星' },
    { en: 'We are a way for the cosmos to know itself. Some part of our being knows this is where we came from. We long to return.', by: '—— 卡尔·萨根 《宇宙》' },
    { en: 'Sic itur ad astra', zh: '循此苦旅，以达天际' },
    { en: 'Per aspera ad astra', zh: '历经艰辛，终达星辰' },
    { en: 'Ex chao, ordo', zh: '混沌中诞生秩序' },
    { en: 'Ad infinitum', zh: '直到无限' }
  ];
  var Q_SPAN0 = 1400, Q_GAP = 120;                     // 黑底阶段恢复上一版节奏（更晚开播、原间隔）
  var Q_WHITE_EXTRA = 400;                             // 白底阶段短句每条延长 400ms（<1s，缓解闪但不拖）
  var Q_SCHED = (function () {                         // 黑底 3 条按原节奏；白底 3 条各延长 Q_WHITE_EXTRA
    var i, wsum = 0;
    for (i = 0; i < QUOTES.length; i++) wsum += (QUOTES[i].by ? 2.3 : 1);
    var unit = (T_END - 500 - Q_SPAN0 - (QUOTES.length - 1) * Q_GAP - 3 * Q_WHITE_EXTRA) / wsum;
    var out = [], cur = Q_SPAN0;
    for (i = 0; i < QUOTES.length; i++) {
      var d = (QUOTES[i].by ? 2.3 : 1) * unit;
      if (i >= 3) d += Q_WHITE_EXTRA;                  // 白底短句（Per aspera/Ex chao/Ad infinitum）延长
      out.push({ t0: cur, t1: cur + d, tl: i % 2 === 0 });   // 偶数条=左上，奇数条=右下
      cur += d + Q_GAP;
    }
    return out;
  })();

  /* ==== 彗星与分镜（全部切线连续的贝塞尔圆弧，无直线硬拐）==== */
  var comets = [
    { gold: true,  side:  1, ph0: 0.5,           pd: PAL.goldD, pw: PAL.goldW,
      trail: [], seg: -1, x: -99, y: -99, px: -99, py: -99, vx: -0.7, vy: 0.7, alpha: 1 },
    { gold: false, side: -1, ph0: 0.5 + Math.PI, pd: PAL.blueD, pw: PAL.blueW,
      trail: [], seg: -1, x: -99, y: -99, px: -99, py: -99, vx: -0.7, vy: 0.7, alpha: 1 }
  ];
  var THL = null;                                      // 双星终点对齐角（惰性初始化）

  function fallGuide(p, c) {   // 右上角 → 本侧轨道端点的三次贝塞尔（到达方向=轨道切线=竖直向下）
    var E = c.gold ? ELLS[0] : ELLS[1];
    var P3 = ellPt(E, E.th0, 0);                          // 引导线终点=轨道起点
    var a = 1 - p;
    var x0 = w * 1.02 + 30 + c.side * w * 0.065, y0 = -30;
    var x1 = c.gold ? cx - w * 0.28 : cx + w * 0.16;      // P1 拉开双线（金左蓝右，S 形绕行）
    var y1 = c.gold ? h * 0.09 : h * 0.22;
    var x2 = P3.x, y2 = P3.y - 1.2 * R;                   // P2 在终点正上方→到达切线竖直向下
    return { x: a * a * a * x0 + 3 * a * a * p * x1 + 3 * a * p * p * x2 + p * p * p * P3.x,
             y: a * a * a * y0 + 3 * a * a * p * y1 + 3 * a * p * p * y2 + p * p * p * P3.y };
  }

  function bez4(p0, p1, p2, p3, k) {
    var a = 1 - k, b = a * a, c2 = a * b;
    return {
      x: c2 * p0.x + 3 * a * a * k * p1.x + 3 * a * k * k * p2.x + k * k * k * p3.x,
      y: c2 * p0.y + 3 * a * a * k * p1.y + 3 * a * k * k * p2.y + k * k * k * p3.y
    };
  }

  function buildSegs(c) {
    var D = T_DRAW_S;
    if (c.gold) {
      return [
        { t0: 0,              t1: D,                     m: 'fall' },                        // 交织环绕落入→金轨起点
        { t0: D,              t1: D + TD * 0.46,         m: 'sweep', E: ELLS[0] },           // 顺时针画满金椭圆（起步带速）
        { t0: D + TD * 0.46,  t1: T_AXIS_S,              m: 'cruise' },                      // 沿切线拱向轴顶（匀速无停顿）
        { t0: T_AXIS_S,       t1: T_AXIS_S + MERGE_D,    m: 'merge' },                       // 边下降边合体
        { t0: T_AXIS_S + MERGE_D, t1: T_AXIS_S + MERGE_D + PULL_D, m: 'pull' },                  // 合一后加速拉轴
        { t0: T_AXIS_S + MERGE_D + PULL_D, t1: T_AXIS_S + MERGE_D + PULL_D + VAN_D, m: 'vanish' }
      ];
    }
    return [
      { t0: 0,              t1: D,                     m: 'fall' },                        // 刚性双星与金 SIDE 同窗落下
      { t0: D + TD * 0.05,  t1: D + TD * 0.48,         m: 'sweep', E: ELLS[1] },           // 稍晚起笔=错落（先在轨位驻留）
      { t0: D + TD * 0.48,  t1: T_AXIS_S,              m: 'cruise' },
      { t0: T_AXIS_S,       t1: T_AXIS_S + MERGE_D,    m: 'merge' },
      { t0: T_AXIS_S + MERGE_D, t1: T_AXIS_S + MERGE_D + PULL_D, m: 'pull' },
      { t0: T_AXIS_S + MERGE_D + PULL_D, t1: T_AXIS_S + MERGE_D + PULL_D + VAN_D, m: 'vanish' }
    ];
  }

  function cruiseEase(k) {               // 1.8k-1.25k²+0.45k³：快进缓收，导数恒>0（两端都不停顿）
    return 1.8 * k - 1.25 * k * k + 0.45 * k * k * k;
  }

  function segBezier(c, s, time, tgt, tanEnd, handleLen) {  // 切线连续的贝塞尔滑弧（cruise 专用）
    var l = clamp((time - s.t0) / (s.t1 - s.t0), 0, 1);
    if (!s.built) {
      s.built = true;
      var dx = c.vx, dy = c.vy, n = Math.sqrt(dx * dx + dy * dy);
      if (n < 0.01) {                                      // 速度异常时兜底用目标方向
        var tx0 = tgt.x - c.x, ty0 = tgt.y - c.y, tn0 = Math.sqrt(tx0 * tx0 + ty0 * ty0) || 1;
        dx = tx0 / tn0; dy = ty0 / tn0; n = 1;
      } else { dx /= n; dy /= n; }
      s.P0 = { x: c.x, y: c.y };
      s.P1 = { x: c.x + dx * handleLen, y: c.y + dy * handleLen };   // 出发切线=当前速度方向（零拐角）
      s.P2 = { x: tgt.x - tanEnd.x * handleLen, y: tgt.y - tanEnd.y * handleLen };
      s.P3 = tgt;
    }
    var p = bez4(s.P0, s.P1, s.P2, s.P3, cruiseEase(l));
    c.x = p.x; c.y = p.y;
  }

  function cometUpdate(c, time) {
    var segs = c.segs || (c.segs = buildSegs(c));
    var i = segs.length - 1;
    while (i > 0 && time < segs[i].t0) i--;
    var s = segs[i];
    if (i !== c.seg) { c.seg = i; s.built = false; }
    c.alpha = 1;
    if (s.m === 'fall') {
      var u = clamp(time / CFG.T_FALL, 0, 1);
      var p = Math.pow(u, 1.7);                        // 慢→快（easeIn 加速）
      var gA = fallGuide(p, comets[0]), gB = fallGuide(p, comets[1]);
      var ddx = gB.x - gA.x, ddy = gB.y - gA.y;
      var mx = (gA.x + gB.x) * 0.5, my = (gA.y + gB.y) * 0.5;
      var dl2 = Math.sqrt(ddx * ddx + ddy * ddy);
      if (THL === null) {                              // 终点对齐角（恒定，算一次）
        var pg0 = ellPt(ELLS[0], ELLS[0].th0, 0), pb0 = ellPt(ELLS[1], ELLS[1].th0, 0);
        THL = Math.atan2(pb0.y - pg0.y, pb0.x - pg0.x);
      }
      var th2 = THL - Math.pow(1 - p, 1.8) * Math.PI * 8;   // 刚性互绕 4 圈，落轨时自转减速归零
      var rb = dl2 * 0.5 + 10 * SC * (1 - p);               // 轨道半径=半间距+衰减摆幅（分离距有结构下限）
      var sgn = c.gold ? -1 : 1;
      c.x = mx + Math.cos(th2) * rb * sgn;
      c.y = my + Math.sin(th2) * rb * sgn;
    } else if (s.m === 'sweep') {
      var q = orbQ(time, s.E.w[0], s.E.w[1]);
      var pt = ellPt(s.E, s.E.th0 + s.E.dir * q * 6.2832, 0);
      c.x = pt.x; c.y = pt.y;
    } else if (s.m === 'cruise') {                     // 沿轨道切线出发，大圆弧拱向轴顶上方（匀速不停）
      var tgt = { x: cx + c.side * 10 * SC, y: A_Y };   // 拱向最高点（=中轴线起点，交汇点）
      var tanE = { x: -c.side * 0.90, y: 0.18 };        // 到达方向=向中横向收拢（与 merge 交汇零拐角）
      segBezier(c, s, time, tgt, tanE, R * 0.7);
    } else if (s.m === 'merge') {                      // 最高点横向收拢交汇（丝滑，无停顿），立即下落
      var k5 = clamp((time - s.t0) / (s.t1 - s.t0), 0, 1);
      var ke = 1 - Math.pow(1 - k5, 1.7);              // 快合慢收（全程收拢，不停顿）
      c.x = cx + c.side * 10 * SC * (1 - ke);
      c.y = A_Y;                                       // 在最高点（中轴线起点）交汇
    } else if (s.m === 'pull') {                       // 合一后自上而下加速拉轴（起步带速）
      var l3 = clamp((time - s.t0) / (s.t1 - s.t0), 0, 1);
      c.x = cx;
      c.y = A_Y + (B_Y - A_Y) * pullProg(l3);
    } else {                                           // vanish
      c.x = cx; c.y = B_Y;
      c.alpha = 1 - clamp((time - s.t0) / (s.t1 - s.t0), 0, 1);
    }
    var ttl = (s.m === 'sweep' || s.m === 'pull' || s.m === 'merge') ? 460 : 760;
    while (c.trail.length && c.trail[0].t < time - ttl) c.trail.shift();
    if (c.alpha > 0.03) {
      c.trail.push({ x: c.x + (Math.random() - 0.5) * 0.8, y: c.y + (Math.random() - 0.5) * 0.8, t: time });
      if (c.trail.length > 240) c.trail.shift();
    }
    c.vx = c.vx * 0.55 + (c.x - c.px) * 0.45;          // 平滑速度（供切线用）
    c.vy = c.vy * 0.55 + (c.y - c.py) * 0.45;
    c.px = c.x; c.py = c.y;
  }

  /* ==== 绘制原语 ==== */
  function spike(x, y, len, hw, rot, fill) {   // 四芒锥形（墨质光刺）
    var ct = Math.cos(rot), st = Math.sin(rot);
    function P(l, s) { return [x + l * ct - s * st, y + l * st + s * ct]; }
    var a = P(-len, 0), b = P(-len * 0.3, hw), c = P(0, hw), d = P(len * 0.3, hw),
        e = P(len, 0), f = P(len * 0.3, -hw), g = P(0, -hw), h2 = P(-len * 0.3, -hw);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(b[0], b[1], c[0], c[1]);
    ctx.quadraticCurveTo(d[0], d[1], e[0], e[1]);
    ctx.quadraticCurveTo(f[0], f[1], g[0], g[1]);
    ctx.quadraticCurveTo(h2[0], h2[1], a[0], a[1]);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }

  function hexStar(x, y, r, col, rot, alpha) { // 六芒星彗星头
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.strokeStyle = rgba(col, 0.9 * alpha);
    ctx.lineWidth = 0.9;
    var i, a, px, py;
    for (i = 0; i < 2; i++) {
      ctx.beginPath();
      for (a = 0; a < 3; a++) {
        var ang = a * 2.0944 + i * Math.PI / 3 - 1.5708;
        px = Math.cos(ang) * r; py = Math.sin(ang) * r;
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.stroke();
    }
    ctx.fillStyle = rgba(col, 0.95 * alpha);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.30, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  function drawTrail(c, col, alpha, time) {    // 液态尾迹（时间限长，双描边）
    var n = c.trail.length;
    if (n < 2 || alpha <= 0.02) return;
    var pass, i, k, age, TTL = 720;
    for (pass = 0; pass < 2; pass++) {
      for (i = 1; i < n; i++) {
        age = time - c.trail[i].t;
        k = 1 - age / TTL;
        if (k <= 0.01) continue;
        ctx.strokeStyle = rgba(col, alpha * (pass ? 0.50 : 0.17) * k);
        ctx.lineWidth = ((pass ? 1.5 : 3.4) * k + 0.2) * SC;
        ctx.beginPath();
        ctx.moveTo(c.trail[i - 1].x, c.trail[i - 1].y);
        ctx.lineTo(c.trail[i].x, c.trail[i].y);
        ctx.stroke();
      }
    }
  }

  /* ==== 场景绘制 ==== */
  function inkStroke(col, al, baseW, jitter, time) {  // 笔墨质感：渗化毛边+粗细不均（主墨线仍锐利）
    var i, w, off;
    // 渗墨层：多次轻微随机偏移的细描边，模拟墨水在纸面渗化
    var layers = 3;
    for (i = 0; i < layers; i++) {
      off = (Math.sin(time * 0.011 + i * 2.399) * 0.5 + (i - 1) * 0.35) * jitter * SC;
      w = baseW * (0.85 + 0.35 * Math.sin(time * 0.017 + i * 1.618)) * SC;
      ctx.strokeStyle = rgba(col, al * 0.14);
      ctx.lineWidth = Math.max(0.3, w + 0.7 * SC);
      ctx.stroke();
      ctx.save();
      ctx.translate(off * 0.6, off * 0.5);
      ctx.strokeStyle = rgba(col, al * 0.10);
      ctx.lineWidth = Math.max(0.3, w);
      ctx.stroke();
      ctx.restore();
    }
    // 主墨线：锐利清晰，提按有轻微粗细变化
    ctx.strokeStyle = rgba(col, al);
    ctx.lineWidth = baseW * Math.max(0.75, SC) * (1 + 0.10 * Math.sin(time * 0.009));
    ctx.stroke();
  }

  function drawRings(time, invK) {
    var ink = mix3(PAL.inkD, PAL.inkW, invK);
    var gold = mix3(PAL.goldD, PAL.goldW, invK);
    var blue = mix3(PAL.blueD, PAL.blueW, invK);
    var i, C, q, E, col, al;
    for (i = 0; i < CIRCS.length; i++) {       // 同心圆（小星点画笔的闭环）
      C = CIRCS[i]; q = orbQ(time, C.w[0], C.w[1]);
      if (q <= 0.004) continue;
      al = C.a * (0.35 + 0.65 * ss(0, 0.10, q));
      ctx.save();
      if (C.dash) { ctx.setLineDash([2.6 * SC, 5.6 * SC]); ctx.lineDashOffset = -time * 0.010 * SC; }
      ctx.beginPath();
      if (C.dir > 0) ctx.arc(cx, cy, C.r * R, C.th0, C.th0 + q * 6.2832);
      else ctx.arc(cx, cy, C.r * R, C.th0, C.th0 - q * 6.2832, true);
      inkStroke(ink, al, 0.85, 0.8, time);
      ctx.restore();
    }
    for (i = 0; i < ELLS.length; i++) {        // 椭圆星轨（彗星闭环，方向各异）
      E = ELLS[i]; q = orbQ(time, E.w[0], E.w[1]);
      if (q <= 0.004) continue;
      col = E.col === 'gold' ? gold : (E.col === 'blue' ? blue : ink);
      al = E.a * (0.35 + 0.65 * ss(0, 0.08, q));
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(E.rot + preOf(E, time));
      ctx.beginPath();
      if (E.dir > 0) ctx.ellipse(0, 0, E.rx * R, E.ry * R, 0, E.th0, E.th0 + q * 6.2832);
      else ctx.ellipse(0, 0, E.rx * R, E.ry * R, 0, E.th0, E.th0 - q * 6.2832, true);
      inkStroke(col, al, 1.0, 0.9, time);
      ctx.restore();
    }
  }

  function dotAngle(d, time, base, t0, accel) {  // 圆点爬行角度（旋转段持续加速）
    var tt = clamp(time - t0, 0, T_END - t0);
    return base + d * accel * tt / 1000;
  }

  function drawDots(time, invK) {
    var ink = mix3(PAL.inkD, PAL.inkW, invK);
    var gold = mix3(PAL.goldD, PAL.goldW, invK);
    var blue = mix3(PAL.blueD, PAL.blueW, invK);
    var i, d, ak, ang, px, py, col;
    var accel = 1 + 0.9 * ss(T_ROT_S, T_ROT_S + 4200, time);   // 与椭圆同节奏持续提速
    for (i = 0; i < DOTS.length; i++) {        // 轨道圆点：大小不一、错落浮现
      d = DOTS[i];
      ak = dotReveal(d, time);
      if (ak <= 0.02) continue;
      if (d.o.charAt(0) === 'c') {
        var C = CIRCS[d.o.charAt(1)];
        ang = dotAngle(d.spd, time, d.th, orbEnd(C.w[1]), accel);
        px = cx + Math.cos(ang) * C.r * R; py = cy + Math.sin(ang) * C.r * R;
      } else {
        var E = ELLS[d.o.charAt(1)];
        ang = dotAngle(d.crawl, time, d.th, orbEnd(E.w[1]), accel);
        var p = ellPt(E, ang, preOf(E, time));
        px = p.x; py = p.y;
      }
      col = d.tint === 'gold' ? gold : (d.tint === 'blue' ? blue : ink);
      if (d.ringed) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(0.5);
        ctx.strokeStyle = rgba(col, 0.8 * ak); ctx.lineWidth = 0.9 * SC;
        ctx.beginPath(); ctx.ellipse(0, 0, 5.6 * SC, 1.9 * SC, 0, 0, 6.2832); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = rgba(col, 0.9 * ak);
        ctx.beginPath(); ctx.arc(px, py, 2.0 * SC, 0, 6.2832); ctx.fill();
      } else {
        ctx.fillStyle = rgba(col, d.al * ak);
        ctx.beginPath(); ctx.arc(px, py, d.r * SC, 0, 6.2832); ctx.fill();
      }
      var wIdx = WORD_DOTS.indexOf(i);           // 只 6 颗圆点带英文词（径向外侧，沿轨旋转）
      if (wIdx >= 0) {
        var wd = WORDS[wIdx];
        var dxr = px - cx, dyr = py - cy, dln = Math.sqrt(dxr * dxr + dyr * dyr) || 1;
        var wox = px + dxr / dln * (10 + d.r * 2.4) * SC, woy = py + dyr / dln * (10 + d.r * 2.4) * SC;
        ctx.font = Math.max(5.5, 6.4 * SC).toFixed(1) + 'px "Courier New", Courier, monospace';
        try { ctx.letterSpacing = '0.6px'; } catch (e2) {}
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = rgba(col, 0.20 * ak);      // 打印双击残影
        ctx.fillText(wd, wox + 0.5, woy + 0.4);
        ctx.fillStyle = rgba(col, 0.72 * ak);      // 主墨层
        ctx.fillText(wd, wox, woy);
        try { ctx.letterSpacing = '0px'; } catch (e2) {}
      }
    }
  }

  function drawAxis(time, invK) {              // 长中轴线（笔尖=合一拉星位置，绝对同步零停顿）
    if (time < T_AXIS_S) return;
    var tip = Math.max(A_Y, comets[0].y);
    if (tip <= A_Y + 0.5) return;
    var axC = mix3(PAL.axD, PAL.axW, invK);
    ctx.beginPath(); ctx.moveTo(cx, A_Y); ctx.lineTo(cx, tip);
    inkStroke(axC, 0.60, 0.8, 0.7, time);
    for (var i = 0; i < NODE_F.length; i++) {
      var ny = cy + AH * NODE_F[i];
      var nk = ss(ny - 30 * SC, ny - 4, tip);
      if (nk <= 0.02) continue;
      ctx.fillStyle = rgba(axC, 0.75 * nk);
      ctx.beginPath(); ctx.arc(cx, ny, (Math.abs(NODE_F[i]) === 1 ? 2.1 : 1.6) * SC, 0, 6.2832); ctx.fill();
    }
  }

  function drawStar(time, invK) {              // 金蓝双色中央星（笔尖过中心即诞生）
    var k = ss(T_BORN, T_BORN + 520, time);
    if (k <= 0.01) return;
    var pulse = 1 + 0.05 * Math.sin(time * 0.0042);
    var goldC = mix3(PAL.goldD, PAL.goldW, invK), blueC = mix3(PAL.blueD, PAL.blueW, invK);
    var gr = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx - 2, cy - 2, R * 0.40 * pulse);
    gr.addColorStop(0, rgba(goldC, 0.34 * k * (1 - 0.45 * invK)));
    gr.addColorStop(1, rgba(goldC, 0));
    ctx.fillStyle = gr; ctx.fillRect(cx - R * 0.5, cy - R * 0.5, R, R);
    gr = ctx.createRadialGradient(cx + 2, cy + 2, 0, cx + 2, cy + 2, R * 0.34 * pulse);
    gr.addColorStop(0, rgba(blueC, 0.30 * k * (1 - 0.45 * invK)));
    gr.addColorStop(1, rgba(blueC, 0));
    ctx.fillStyle = gr; ctx.fillRect(cx - R * 0.5, cy - R * 0.5, R, R);
    var inkC = mix3(PAL.inkD, PAL.inkW, invK);
    if (invK > 0.02) {                         // 纸白相：灰晕盘
      ctx.fillStyle = rgba(inkC, 0.12 * invK * k);
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.16, 0, 6.2832); ctx.fill();
    }
    var sc = mix3([248, 248, 255], [64, 64, 72], invK);
    spike(cx, cy, R * 0.62 * pulse, 1.6 * SC, Math.PI / 2, rgba(sc, 0.85 * k));  // 竖长刺
    spike(cx, cy, R * 0.26 * pulse, 1.2 * SC, 0, rgba(sc, 0.80 * k));            // 横短刺
    spike(cx, cy, R * 0.11 * pulse, 0.8 * SC, Math.PI / 4, rgba(sc, 0.28 * k));
    spike(cx, cy, R * 0.11 * pulse, 0.8 * SC, -Math.PI / 4, rgba(sc, 0.28 * k));
    ctx.fillStyle = 'rgba(255,255,255,' + 0.95 * k + ')';
    ctx.beginPath(); ctx.arc(cx, cy, 3.0 * SC, 0, 6.2832); ctx.fill();
  }

  /* ==== 中央星诞生音效（WebAudio 合成：悠长绵延的「叮」——
     钟音泛列+失谐孪生泛音+深空卷积混响，余韵 7 秒+；自动播放
     被浏览器策略拦截时静默跳过）==== */
  var actx = null, noiseBuf = null, soundPlayed = false;
  function makeIR(sec, decay) {                        // 生成深空混响脉冲响应（指数衰减噪声）
    var len = Math.floor(actx.sampleRate * sec);
    var buf = actx.createBuffer(2, len, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function playStarBirth() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') { try { actx.resume(); } catch (e1) {} }
      if (actx.state !== 'running') return false;        // 自动播放策略拦截→由手势补放（wakeStar）
      var t = actx.currentTime + 0.02;
      var dry = actx.createGain(); dry.gain.value = 0.8; dry.connect(actx.destination);
      var conv = actx.createConvolver(); conv.buffer = makeIR(4.5, 3.2);
      var wet = actx.createGain(); wet.gain.value = 0.6; conv.connect(wet); wet.connect(actx.destination);
      var bus = actx.createGain(); bus.gain.value = 1; bus.connect(dry); bus.connect(conv);
      var F0 = 523.25;                                   // 钟音基频（C5）
      var PART = [[1, 0.50, 7.5], [2.004, 0.16, 5.2], [2.98, 0.09, 3.6], [4.16, 0.05, 2.4], [5.43, 0.03, 1.6]];
      var i, o, g;
      for (i = 0; i < PART.length; i++) {                // 钟音泛列：基频余韵 7.5s，泛音递短
        var f = F0 * PART[i][0], ga = PART[i][1], dc = PART[i][2];
        o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(ga, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dc);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + dc + 0.1);
        if (i < 2) {                                     // 轻微失谐孪生→空灵宇宙感
          o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f * 1.0035;
          g = actx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(ga * 0.4, t + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dc * 0.85);
          o.connect(g); g.connect(bus); o.start(t); o.stop(t + dc);
        }
      }
      o = actx.createOscillator(); g = actx.createGain();   // 极轻低频下滑垫底（只给距离感）
      o.type = 'sine';
      o.frequency.setValueAtTime(130.8, t);
      o.frequency.exponentialRampToValueAtTime(65.4, t + 5);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 6.6);
      if (!noiseBuf) {                                   // 高频敲击瞬态（让「叮」有起音）
        noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
        var dd = noiseBuf.getChannelData(0);
        for (i = 0; i < dd.length; i++) dd[i] = Math.random() * 2 - 1;
      }
      var ns = actx.createBufferSource(); ns.buffer = noiseBuf;
      var hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
      g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      ns.connect(hp); hp.connect(g); g.connect(bus); ns.start(t); ns.stop(t + 0.12);
      return true;                                       // 已实际起振
    } catch (e) {}
    return false;
  }

  /* ==== 开屏 BGM（MP3 截取段：运行时 fetch+decode，Gain 包络淡入淡出。
     autoplay 被浏览器拦截时挂起，首次任意手势后按动画已播进度音画对齐补播）==== */
  var BGM = {
    url: 'audio/bgm_intro.mp3',
    offset: 0.05,      // 截取起点（s）：20260930cd 提前播放（原 0.3；开头电平低由「前半段增益+极短淡入」补足）
    dur: 16.2,         // 截取时长（s）：覆盖 T_END(15s)+余量
    fadeIn: 0.12,      // 淡入（s）：20260930cd 再缩短（原 0.4），起声更快
    fadeOut: 2.6,      // 淡出（s）
    vol: 1.0,          // 背景音量（经压缩器+补偿增益提响度）
    frontBoost: 1.25,  // 20260930cd：前半段初始增益（淡入到位后从 vT*1.25 缓落回 vT，约前 45% 时长）
    userVol: 1.5,      // 20260930cd：开屏动画阶段音量倍率（总设置「开屏音乐音量」0~200%，默认 150%=更响）
    appVol: 1.0,       // 20260930cb：软件内阶段音量倍率（「继续播放」贯穿软件内时用，总设置独立滑杆）
    buf: null, src: null, gain: null, started: false, pending: false, failed: false
  };
  function bgmVolTarget() {   // 当前阶段应使用的目标音量：开屏动画=开屏音量条；进软件后循环=软件内音量条
    return BGM.vol * ((splashOver && AUTO_MUSIC) ? BGM.appVol : BGM.userVol);
  }
  var bgmArmed = false, splashOver = false;
  var AUTO_MUSIC = false;   // 20260930bx：「开屏音乐继续播放」开关——开=开屏结束/跳过后 BGM 不停，循环播放贯穿整个使用过程
  function bgmElapsed() { return t0 === null ? 0 : Math.max(0, (performance.now() - t0) / 1000); }
  function bgmStart(atSec) {
    if (!BGM.buf || BGM.started || (splashOver && !AUTO_MUSIC)) return;
    var pos = Math.max(0, Math.min(atSec || 0, BGM.dur - 0.05));
    var remain = BGM.dur - pos;
    if (remain < 0.15) return;
    var src = actx.createBufferSource(); src.buffer = BGM.buf;
    if (AUTO_MUSIC) src.loop = true;               // 开关开：整段循环，开屏结束/MP3 播完都不停
    var g = actx.createGain(); g.gain.value = 0.0001;
    var comp = actx.createDynamicsCompressor();    // 压缩器只压峰值（20260930cd 阈值/比率微调）
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 2.5;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    var makeup = actx.createGain(); makeup.gain.value = 2.0;  // 20260930cd：压缩器补偿增益（原链路无补偿实际在压低音量，+6dB）
    var t = actx.currentTime;
    var vT = bgmVolTarget();                                    // 20260930cb：按阶段音量条取目标
    var fi = Math.min(BGM.fadeIn, remain * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vT * (BGM.frontBoost || 1), t + fi);  // 淡入直达「前半段增益」电平
    if (pos < 0.6) {                                            // 全新起播才加前半段增益（补播对齐不加）
      var decayT = Math.max(4, remain * 0.45);
      g.gain.linearRampToValueAtTime(vT, t + fi + decayT);      // 缓慢回落到正常电平
    }
    if (!AUTO_MUSIC) {                                          // 开关关：维持原样（尾部淡出、定时结束）
      var fo = Math.min(BGM.fadeOut, remain * 0.5);
      g.gain.setValueAtTime(vT, t + remain - fo);
      g.gain.linearRampToValueAtTime(0.0001, t + remain);       // 淡出
    }
    src.connect(g); g.connect(comp); comp.connect(makeup); makeup.connect(actx.destination);
    if (AUTO_MUSIC) src.start(t, BGM.offset + pos);             // 循环：不带 duration（无限播）
    else src.start(t, BGM.offset + pos, remain);
    BGM.src = src; BGM.gain = g; BGM.started = true;
    hideAudioHint();                                            // 已实际出声→提示条退场（每次进入都会先显示）
    src.onended = function () {                 // 身份检查：循环重播时旧 src 结束不得误清新状态
      if (BGM.src === src) { BGM.started = false; BGM.src = null; BGM.gain = null; }
    };
  }
  function bgmPlay(atSec) {                                     // 有缓冲直接播；否则先解码
    if (BGM.failed || (splashOver && !AUTO_MUSIC)) return;
    if (BGM.buf) { bgmStart(atSec); return; }
    fetch(BGM.url).then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return actx.decodeAudioData(ab); })
      .then(function (b) {
        BGM.buf = b;
        if (splashOver && !AUTO_MUSIC) return;
        if (actx.state !== 'running') { BGM.pending = true; bgmArm(); showAudioHint(); return; }  // 解码完成仍被拦→转手势补播
        bgmStart(atSec);
      })
      .catch(function () { BGM.failed = true; });
  }
  function bgmStop(fade) {                                      // 跳过/结束/重播：快速淡出停止
    BGM.pending = false;
    if (!BGM.started || !BGM.gain) return;
    try {
      var t = actx.currentTime, fd = fade || 0.4;
      BGM.gain.gain.cancelScheduledValues(t);
      BGM.gain.gain.setValueAtTime(Math.max(0.0001, BGM.gain.gain.value || 0.0001), t);
      BGM.gain.gain.linearRampToValueAtTime(0.0001, t + fd);
      if (BGM.src) { try { BGM.src.stop(t + fd + 0.05); } catch (e2) {} }
    } catch (e) {}
  }
  /* 读取「开屏音乐继续播放」开关 + 自定义开屏音乐（独立读 IndexedDB kv，不依赖 db.js——
     本脚本先于应用执行）。开关开=AUTO_MUSIC（开屏结束后 BGM 循环播放贯穿全程）；
     关=维持「开屏结束即收」并等首次手势。 */
  function readAudioPrefs(cb) {
    var done = false;
    function fin(auto) { if (!done) { done = true; cb(auto); } }
    function readKey(db, key, cb2) {
      try {
        var tx = db.transaction('kv', 'readonly');
        var g = tx.objectStore('kv').get(key);
        g.onsuccess = function () { cb2(g.result ? g.result.value : null); };
        g.onerror = function () { cb2(null); };
      } catch (e) { cb2(null); }
    }
    try {
      if (!window.indexedDB) { fin(false); return; }
      var req = indexedDB.open('bairimeng');
      req.onerror = function () { fin(false); };
      req.onblocked = function () { fin(false); };
      req.onsuccess = function () {
        var db = req.result;
        readKey(db, 'splashAutoplay', function (v1) {
          var auto = !!(v1 && v1 === '1');
          readKey(db, 'splashBgmCustom', function (v2) {
            try { if (typeof v2 === 'string' && v2.indexOf('data:audio') === 0) BGM.url = v2; } catch (e) {}
            // 20260930cb：两条独立音量条（kv 百分数）——开屏动画一条、软件内一条
            readKey(db, 'splashBgmVol', function (v3) {
              var p3 = parseFloat(v3); if (!isNaN(p3)) BGM.userVol = Math.max(0, Math.min(2.0, p3 / 100));
              readKey(db, 'appBgmVol', function (v4) {
                var p4 = parseFloat(v4); if (!isNaN(p4)) BGM.appVol = Math.max(0, Math.min(2.0, p4 / 100));
                try { db.close(); } catch (e) {}
                fin(auto);
              });
            });
          });
        });
      };
    } catch (e) { fin(false); }
  }
  function bgmTry() {                                           // 动画起点调用；读偏好后决定播放策略
    readAudioPrefs(function (auto) {
      AUTO_MUSIC = auto;                                       // 全程循环播放语义（bx）
      showAudioHint();                                         // 每次进入开屏都显示「点按播放音乐」提醒（出声即退场）
      if (auto) {                                              // 开关打开：积极 resume，等 Promise 真正落定后再判断
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          if (!actx) actx = new AC();
          if (actx.state === 'suspended') {
            var p = actx.resume();
            var go = function () {
              try {
                if (splashOver && !AUTO_MUSIC) return;
                if (actx.state === 'running') { bgmPlay(0); return; }   // resume 成功→立即播
                BGM.pending = true; bgmArm();                            // 仍被拦→待首次手势补播
              } catch (e3) {}
            };
            if (p && p.then) { p.then(go, go); return; }
            go(); return;
          }
          bgmPlay(0);
        } catch (e) {}
        return;
      }
      // 开关关闭：维持保守行为（被拦则挂起待首次手势）
      try {
        var AC2 = window.AudioContext || window.webkitAudioContext;
        if (!AC2 || splashOver) return;
        if (!actx) actx = new AC2();
        if (actx.state === 'suspended') { try { actx.resume(); } catch (e1) {} }
        if (actx.state !== 'running') { BGM.pending = true; bgmArm(); return; }
        bgmPlay(0);
      } catch (e) {}
    });
  }
  function bgmArm() {                                           // 首次任意手势/鼠标移动→resume→对齐补播
    if (bgmArmed) return; bgmArmed = true;
    var fire = function () {
      var ok = false;
      try {
        if (actx && actx.state !== 'running') {                 // resume 是异步的：必须挂 Promise，
          var p = actx.resume();                                // 否则同步读 state 仍是 suspended→永远不播
          var go = function () { try { wake(true); } catch (e3) {} };
          if (p && p.then) { p.then(go, go); return; }
        }
        wake(false);
      } catch (e) {}
      function wake(fromResume) {
        try {
          if (BGM.pending && actx && actx.state === 'running' && (!splashOver || AUTO_MUSIC)) {
            BGM.pending = false; ok = true;
            bgmPlay(splashOver ? 0 : bgmElapsed());             // 音画对齐；开屏已结束（开关开）则从头播
            if (!splashOver) wakeStar();                        // 若已过 T_BORN，「叮」补一声（迟到好过没有）
          }
          if (ok || (splashOver && !AUTO_MUSIC)) cleanup();   // 开关开时开屏结束后监听保留：随时点击仍可解锁音乐
        } catch (e2) {}
      }
    };
    function cleanup() {
      window.removeEventListener('pointerdown', fire);
      window.removeEventListener('touchstart', fire);
      window.removeEventListener('keydown', fire);
      window.removeEventListener('mousemove', fire);
      hideAudioHint();
    }
    window.addEventListener('pointerdown', fire, { passive: true });
    window.addEventListener('touchstart', fire, { passive: true });
    window.addEventListener('keydown', fire);
    window.addEventListener('mousemove', fire, { passive: true });  // PC 端：鼠标一动即解锁，无需刻意点击
  }
  function wakeStar() {                                         // 错过 T_BORN 的「叮」：手势激活后补放
    try {
      if (!soundPlayed && !splashOver && t0 !== null &&
          (performance.now() - t0) >= T_BORN && actx && actx.state === 'running') {
        soundPlayed = true; playStarBirth();
      }
    } catch (e) {}
  }
  /* 声音提示条：autoplay 被拦时显示「点按任意处开启声音」，出声即淡出 */
  var audioHint = null;
  function showAudioHint() {
    try {
      if (audioHint || LOOP) return;
      audioHint = document.createElement('div');
      audioHint.textContent = '点按任意处播放音乐';
      audioHint.style.cssText = 'position:fixed;left:50%;bottom:calc(64px + env(safe-area-inset-bottom, 0px));'
        + 'transform:translateX(-50%);color:#9a96ac;font-size:12px;letter-spacing:2px;'
        + 'z-index:2147483001;opacity:0;transition:opacity 900ms;user-select:none;-webkit-user-select:none;'
        + 'pointer-events:none;font-family:' + FONT_APP + ';';
      (document.body || document.documentElement).appendChild(audioHint);
      setTimeout(function () { try { audioHint.style.opacity = '0.75'; } catch (e) {} }, 1200);
    } catch (e) {}
  }
  function hideAudioHint() {
    try {
      if (!audioHint) return;
      var el = audioHint; audioHint = null;
      el.style.opacity = '0';
      setTimeout(function () { try { el.parentNode.removeChild(el); } catch (e) {} }, 900);
    } catch (e) {}
  }

  /* ==== 背景掉落字符串（黄标注意：箴言词竖排细雨，错落有序、底部消散、残墨质感）==== */
  var STRINGS = [];
  var STR_WORDS = ['hinc', 'itur', 'ad', 'astra', 'sic', 'per', 'aspera', 'ex', 'chao', 'ordo',
                   'infinitum', 'cosmos', 'stella', 'nocte', 'lux', 'somnus', 'fata', 'via'];
  function newString(first) {
    var colN = w > 700 ? 13 : 9;
    var s = {
      x: (((Math.random() * colN) | 0) + 0.15 + Math.random() * 0.7) / colN * w,   // 错落列+横向抖动
      y: first ? Math.random() * h * 1.2 - h * 0.2 : -Math.random() * h * 0.35,
      word: STR_WORDS[(Math.random() * STR_WORDS.length) | 0],
      sp: (13 + Math.random() * 22) * (0.8 + SC * 0.25),                          // 下落速度（雨感）
      fs: Math.max(5, Math.min(w * 0.016, h * 0.013)),
      sway: Math.random() * 6.283, sAmp: 1 + Math.random() * 2.2,
      al: 0.17 + Math.random() * 0.15,                                             // 存在感稍明显
      ja: [], js: []
    };
    var i;
    for (i = 0; i < s.word.length; i++) {
      s.ja.push(0.55 + Math.random() * 0.9);            // 每字符残墨浓淡
      s.js.push(Math.random() < 0.22);                  // 部分字符双击残影
    }
    return s;
  }
  function initStrings() {
    STRINGS.length = 0;
    var n = w > 700 ? 16 : 12, i;
    for (i = 0; i < n; i++) STRINGS.push(newString(true));
  }
  function drawStrings(time, invK, dt) {
    var col = mix3([228, 231, 238], [44, 46, 54], invK);
    var gk = ss(200, 1500, time);                       // 整层缓入
    if (gk <= 0.01) return;
    var i, j, s, ch, cy, ax, a;
    for (i = 0; i < STRINGS.length; i++) {
      s = STRINGS[i];
      s.y += s.sp * dt;
      var sH = s.word.length * s.fs * 1.5;
      if (s.y - sH > h) { STRINGS[i] = newString(false); continue; }
      ax = s.x + Math.sin(time * 0.0006 + s.sway) * s.sAmp;
      ctx.font = s.fs.toFixed(1) + 'px ' + FONT_TYPE;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (j = 0; j < s.word.length; j++) {
        ch = s.word.charAt(j);
        cy = s.y + j * s.fs * 1.5;
        a = s.al * gk * s.ja[j]
          * ss(-10, h * 0.05, cy)                        // 顶部淡入
          * (1 - ss(h * 0.78, h * 0.94, cy));            // 底部自动消散（更明显）
        if (a <= 0.008) continue;
        if (s.js[j]) { ctx.fillStyle = rgba(col, a * 0.45); ctx.fillText(ch, ax + 0.6, cy + 0.5); }
        ctx.fillStyle = rgba(col, a);
        ctx.fillText(ch, ax, cy);
      }
    }
  }

  /* ==== 角落预设文案绘制（左上/右下交替，打字机体+中文小注）==== */
  function wrapEn(txt, maxW, fs) {
    var arr = txt.split(' '), lines = [], cur = '';
    ctx.font = fs + 'px ' + FONT_TYPE;
    for (var i = 0; i < arr.length; i++) {
      var test = cur ? cur + ' ' + arr[i] : arr[i];
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = arr[i]; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function drawQuotes(time, invK) {
    var col = mix3([225, 228, 235], [40, 42, 50], invK);
    var i, s, k, q, j, yy;
    for (i = 0; i < QUOTES.length; i++) {
      s = Q_SCHED[i];
      if (time < s.t0 || time > s.t1) continue;
      k = ss(s.t0, s.t0 + 500, time) * (1 - ss(s.t1 - 600, s.t1, time));
      if (k <= 0.01) continue;
      q = QUOTES[i];
      var fsEn = Math.max(8, Math.min(w * 0.0235, h * 0.019));   // 拉丁：打字机体（很小，宽高双上限）
      var fsZh = Math.max(8.5, Math.min(w * 0.024, h * 0.0195)); // 中文小注（稍小）
      var maxW = w * 0.36;
      var lines = wrapEn(q.en, maxW, fsEn);
      var lh = fsEn * 1.74;                              // 行距加宽（PC 人名贴诗句已修）
      var blockH = lines.length * lh + (q.zh ? fsZh * 1.8 : 0) + (q.by ? fsEn * 2.3 : 0);
      var x = s.tl ? w * 0.065 : w * 0.935;
      var y0 = s.tl ? h * 0.055 : h * 0.948 - blockH;   // 左上自上而下；右下块底对齐
      ctx.textAlign = s.tl ? 'left' : 'right';
      ctx.textBaseline = 'alphabetic';
      yy = y0;
      ctx.font = fsEn.toFixed(1) + 'px ' + FONT_TYPE;
      try { ctx.letterSpacing = Math.max(0.5, fsEn * 0.08).toFixed(1) + 'px'; } catch (e2) {}
      for (j = 0; j < lines.length; j++) {
        ctx.fillStyle = rgba(col, 0.16 * k);            // 打印双击残影
        ctx.fillText(lines[j], x + 0.6, yy + 0.5);
        ctx.fillStyle = rgba(col, 0.52 * k);            // 弱存在感主墨层
        ctx.fillText(lines[j], x, yy);
        yy += lh;
      }
      try { ctx.letterSpacing = '0px'; } catch (e2) {}
      if (q.zh) {
        ctx.font = fsZh.toFixed(1) + 'px ' + FONT_APP;
        ctx.fillStyle = rgba(col, 0.44 * k);
        ctx.fillText(q.zh, x, yy + fsZh * 0.4);
        yy += fsZh * 1.8;
      }
      if (q.by) {
        yy += fsEn * 0.6;                              // 人名行与诗句再拉开一档
        ctx.font = Math.max(7.5, w * 0.021).toFixed(1) + 'px ' + FONT_APP;
        ctx.fillStyle = rgba(col, 0.40 * k);
        ctx.fillText(q.by, x, yy + 2);
      }
    }
    ctx.textAlign = 'left';
  }

  /* ==== 标题落款（红标注位：白日梦最大 · 祝你有一场好梦次大 · 英文极极小）==== */
  var T_TITLE1 = T_BORN + 370, T_TITLE2 = T_BORN + 970;   // 中央星诞生后先后浮现（跟随合体停顿顺延）
  function drawTitles(time, invK) {
    if (time < T_TITLE1) return;
    var col = mix3([233, 235, 242], [40, 42, 50], invK);
    var k1 = ss(T_TITLE1, T_TITLE1 + 700, time);
    var k2 = ss(T_TITLE2, T_TITLE2 + 700, time);
    var fs1 = Math.min(w * 0.064, h * 0.040);           // 白日梦（最大，再缩一圈）
    var fs2 = Math.min(w * 0.019, h * 0.012);           // Daydream（极小）
    var fs3 = Math.min(w * 0.038, h * 0.024);           // 祝你有一场好梦（次大，稍缩小）
    var fs4 = Math.max(4.5, Math.min(w * 0.0165, h * 0.0105));  // Wishing…（极极小，已稍调大）
    var y1 = h * 0.692, y2 = h * 0.727, y3 = h * 0.832, y4 = h * 0.863;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 ' + fs1.toFixed(1) + 'px ' + FONT_APP;
    ctx.fillStyle = rgba(col, 0.18 * k1);               // 双击残墨
    ctx.fillText('白日梦', cx + 0.8, y1 + 0.7);
    ctx.fillStyle = rgba(col, 0.94 * k1);
    ctx.fillText('白日梦', cx, y1);
    ctx.font = fs2.toFixed(1) + 'px ' + FONT_TYPE;
    try { ctx.letterSpacing = Math.max(1, fs2 * 0.42).toFixed(1) + 'px'; } catch (e2) {}
    ctx.fillStyle = rgba(col, 0.30 * k1);
    ctx.fillText('Daydream', cx + 0.5, y2 + 0.4);
    ctx.fillStyle = rgba(col, 0.62 * k1);
    ctx.fillText('Daydream', cx, y2);
    try { ctx.letterSpacing = '0px'; } catch (e2) {}
    if (time >= T_TITLE2 && k2 > 0.01) {
      ctx.font = '500 ' + fs3.toFixed(1) + 'px ' + FONT_APP;
      ctx.fillStyle = rgba(col, 0.85 * k2);
      ctx.fillText('「祝你有一场好梦」', cx, y3);
      ctx.font = fs4.toFixed(1) + 'px ' + FONT_TYPE;
      try { ctx.letterSpacing = Math.max(0.8, fs4 * 0.35).toFixed(1) + 'px'; } catch (e2) {}
      ctx.fillStyle = rgba(col, 0.40 * k2);
      ctx.fillText('Wishing you a beautiful dream', cx, y4);
      try { ctx.letterSpacing = '0px'; } catch (e2) {}
    }
  }

  /* ==== 主循环 ==== */
  var t0 = null, rafId = 0, lastTs = null, bgmEndFired = false;

  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    if (t0 === null) t0 = ts;
    var time = ts - t0;
    var dt = lastTs === null ? 16 : clamp(ts - lastTs, 0, 50);
    lastTs = ts;

    if (LOOP && time > T_END + CFG.FADE + CFG.LOOP_PAUSE) { restart(); return; }
    if (!LOOP && time > T_END + CFG.FADE_OUT) { end(); return; }

    if (!LOOP && !AUTO_MUSIC && !bgmEndFired && time >= T_END) {   // 结尾：BGM 长淡出（开关开=继续播放不停，bx）
      bgmEndFired = true;
      bgmStop(2.5);
    }

    var invK = ss(T_ROT_S + 600, T_ROT_S + 880, time);   // 快速翻面（避免中间灰低对比）

    ctx.drawImage(bgDark, 0, 0, w, h);
    if (invK > 0.003) { ctx.globalAlpha = invK; ctx.drawImage(bgWhite, 0, 0, w, h); ctx.globalAlpha = 1; }

    drawStrings(time, invK, dt / 1000);                  // 背景掉落字符串（最底层）

    var i, c, q, th, px, py;
    for (i = 0; i < 2; i++) {                  // 彗星运动更新（提前：轴线/中央星同步笔尖）
      cometUpdate(comets[i], time);
    }
    if (!soundPlayed && time >= T_BORN) {        // 笔尖过中心=中央星诞生→悠长的「叮」
      if (playStarBirth()) soundPlayed = true;   // actx 被挂起时返回 false→留待手势补放（wakeStar）
    }

    drawRings(time, invK);
    drawDots(time, invK);
    drawAxis(time, invK);
    drawStar(time, invK);
    drawQuotes(time, invK);                      // 角落预设文案（左上/右下交替）
    drawTitles(time, invK);                      // 标题落款

    var inkB = mix3([240, 242, 248], [40, 42, 50], invK);
    if (time > T_AXIS_S + MERGE_D + PULL_D + VAN_D) {    // 已消散
    } else if (time >= T_AXIS_S) {            // 合体段：两星渐隐 × 六芒星渐显（交叉淡化）
      var c0 = comets[0], ccG = mix3(comets[0].pd, comets[0].pw, invK), ccB = mix3(comets[1].pd, comets[1].pw, invK);
      var mk = ss(T_AXIS_S + MERGE_D * 0.08, T_AXIS_S + MERGE_D * 0.92, time);   // 合体相内六芒星渐显
      var fk0 = 1 - mk;                       // 两颗独立星渐隐
      drawTrail(comets[0], ccG, fk0, time);
      drawTrail(comets[1], ccB, fk0, time);
      if (fk0 > 0.03) {
        for (i = 0; i < 2; i++) {
          c = comets[i];
          var ccx = i === 0 ? ccG : ccB;
          var g2 = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 16 * SC);
          g2.addColorStop(0, rgba(ccx, 0.32 * fk0));
          g2.addColorStop(1, rgba(ccx, 0));
          ctx.fillStyle = g2; ctx.fillRect(c.x - 16 * SC, c.y - 16 * SC, 32 * SC, 32 * SC);
          hexStar(c.x, c.y, 6.2 * SC, ccx, time * 0.002 + i * 1.3, fk0);
        }
      }
      if (mk > 0.01) {                        // 合为一颗六芒星（透金蓝双色）渐显
        var gG = ctx.createRadialGradient(c0.x - 2 * SC, c0.y - 2 * SC, 0, c0.x - 2 * SC, c0.y - 2 * SC, 15 * SC);
        gG.addColorStop(0, rgba(ccG, 0.30 * mk)); gG.addColorStop(1, rgba(ccG, 0));
        ctx.fillStyle = gG; ctx.fillRect(c0.x - 15 * SC, c0.y - 15 * SC, 30 * SC, 30 * SC);
        var gB2 = ctx.createRadialGradient(c0.x + 2 * SC, c0.y + 2 * SC, 0, c0.x + 2 * SC, c0.y + 2 * SC, 13 * SC);
        gB2.addColorStop(0, rgba(ccB, 0.26 * mk)); gB2.addColorStop(1, rgba(ccB, 0));
        ctx.fillStyle = gB2; ctx.fillRect(c0.x - 13 * SC, c0.y - 13 * SC, 26 * SC, 26 * SC);
        hexStar(c0.x, c0.y, 6.4 * SC, ccG, time * 0.0016 - 0.10, mk);   // 双层微转六芒=一星透双色
        hexStar(c0.x, c0.y, 6.4 * SC, ccB, time * 0.0016 + 0.10, mk);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.95 * mk).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(c0.x, c0.y, 2.6 * SC, 0, 6.2832); ctx.fill();
      }
    } else {
      for (i = 0; i < 2; i++) {                // 融合前：两颗独立彗星
        c = comets[i];
        var cc = mix3(c.pd, c.pw, invK);
        drawTrail(c, cc, c.alpha, time);
        if (c.alpha > 0.03) {
          var g2 = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 16 * SC);
          g2.addColorStop(0, rgba(cc, 0.32 * c.alpha));
          g2.addColorStop(1, rgba(cc, 0));
          ctx.fillStyle = g2; ctx.fillRect(c.x - 16 * SC, c.y - 16 * SC, 32 * SC, 32 * SC);
          hexStar(c.x, c.y, 6.2 * SC, cc, time * 0.002 + i * 1.3, c.alpha);
        }
      }
    }
    for (i = 0; i < CIRCS.length; i++) {       // 圆轨画笔星头
      q = orbQ(time, CIRCS[i].w[0], CIRCS[i].w[1]);
      if (q <= 0.004 || q >= 0.996) continue;
      th = CIRCS[i].th0 + CIRCS[i].dir * q * 6.2832;
      px = cx + Math.cos(th) * CIRCS[i].r * R; py = cy + Math.sin(th) * CIRCS[i].r * R;
      var g3 = ctx.createRadialGradient(px, py, 0, px, py, 8 * SC);
      g3.addColorStop(0, rgba(inkB, 0.30)); g3.addColorStop(1, rgba(inkB, 0));
      ctx.fillStyle = g3; ctx.fillRect(px - 8 * SC, py - 8 * SC, 16 * SC, 16 * SC);
      ctx.fillStyle = rgba(inkB, 0.9);
      ctx.beginPath(); ctx.arc(px, py, 1.6 * SC, 0, 6.2832); ctx.fill();
    }
    q = orbQ(time, ELLS[2].w[0], ELLS[2].w[1]);   // 灰椭圆画笔星头
    if (q > 0.004 && q < 0.996) {
      var pt2 = ellPt(ELLS[2], ELLS[2].th0 + ELLS[2].dir * q * 6.2832, 0);
      var g4 = ctx.createRadialGradient(pt2.x, pt2.y, 0, pt2.x, pt2.y, 8 * SC);
      g4.addColorStop(0, rgba(inkB, 0.30)); g4.addColorStop(1, rgba(inkB, 0));
      ctx.fillStyle = g4; ctx.fillRect(pt2.x - 8 * SC, pt2.y - 8 * SC, 16 * SC, 16 * SC);
      ctx.fillStyle = rgba(inkB, 0.9);
      ctx.beginPath(); ctx.arc(pt2.x, pt2.y, 1.6 * SC, 0, 6.2832); ctx.fill();
    }
    {                                     // 结尾过渡淡出（循环用 FADE，单次播放用更长的 FADE_OUT）
      var fadeSpan = LOOP ? CFG.FADE : CFG.FADE_OUT;
      var fk = ss(T_END, T_END + fadeSpan, time);
      if (fk > 0.003) {
        ctx.fillStyle = rgba(mix3(PAL.bgD, PAL.bgW, invK), fk);
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  function restart() {
    bgmStop(0.25);                               // 循环重播：BGM 快速收掉再从头起
    bgmEndFired = false;
    t0 = null; lastTs = null;
    for (var i = 0; i < 2; i++) {
      comets[i].trail.length = 0;
      comets[i].seg = -1; comets[i].segs = null;
      comets[i].alpha = 1; comets[i].vx = -0.7; comets[i].vy = 0.7;
    }
    soundPlayed = false;
    BGM.started = false;
    bgmTry();
  }
  function end() {
    splashOver = true;
    if (!bgmEndFired && !AUTO_MUSIC) bgmStop(0.6);   // 跳过时快速淡出；开关开=音乐继续播放不停（bx）
    // 20260930cb：继续播放进软件 → 音乐音量平滑切到「软件内音乐音量」条（与开屏音量条互不影响）
    if (AUTO_MUSIC && BGM.gain && BGM.started) {
      try {
        var tE = actx.currentTime;
        BGM.gain.gain.cancelScheduledValues(tE);
        BGM.gain.gain.setValueAtTime(Math.max(0.0001, BGM.gain.gain.value || 0.0001), tE);
        BGM.gain.gain.linearRampToValueAtTime(Math.max(0.0001, BGM.vol * BGM.appVol), tE + 0.8);
      } catch (eV) {}
    }
    hideAudioHint();                             // 声音提示条一并移除
    try { cancelAnimationFrame(rafId); } catch (e) {}
    window.removeEventListener('resize', resize);
    cv.removeEventListener('pointerdown', onTap);
    if (cv.parentNode) cv.parentNode.removeChild(cv);
    if (skipBtn && skipBtn.parentNode) skipBtn.parentNode.removeChild(skipBtn);   // 跳过按钮一并移除
  }
  function onTap() {                               // 点击开屏：只激活音频（出声），绝不跳过
    try {
      if (actx && actx.state !== 'running') {      // resume 异步：挂 Promise 后再补播
        var p = actx.resume();
        var go = function () { try { wakeTap(); } catch (e3) {} };
        if (p && p.then) { p.then(go, go); return; }
      }
      wakeTap();
    } catch (e) {}
    function wakeTap() {
      try {
        if (splashOver || !actx || actx.state !== 'running') return;
        if (BGM.pending) { BGM.pending = false; bgmPlay(bgmElapsed()); }   // 音画对齐补播
        else if (!BGM.started && BGM.buf) { bgmStart(bgmElapsed()); }
        else if (!BGM.started && !BGM.buf && !BGM.failed) { bgmPlay(bgmElapsed()); }
        wakeStar();
        hideAudioHint();
      } catch (e2) {}
    }
  }

  var skipBtn = document.createElement('div');          // 跳过按钮（接入模式与循环预览均显示）
  skipBtn.textContent = '跳过';
  skipBtn.style.cssText = 'position:fixed;right:18px;bottom:calc(16px + env(safe-area-inset-bottom, 0px));'
    + 'color:#9a96ac;font-size:12px;letter-spacing:3px;cursor:pointer;padding:8px 12px;'
    + 'z-index:2147483001;opacity:0;transition:opacity 700ms;user-select:none;-webkit-user-select:none;'
    + 'font-family:' + FONT_APP + ';';
  skipBtn.addEventListener('pointerdown', function (ev) {
    ev.stopPropagation();
    if (LOOP) restart(); else end();
  });
  (document.body || document.documentElement).appendChild(skipBtn);
  setTimeout(function () { try { skipBtn.style.opacity = '0.8'; } catch (e) {} }, 900);

  window.addEventListener('resize', resize);
  cv.addEventListener('pointerdown', onTap);
  // 20260930bx：主页顶栏「开屏音乐继续播放」开关关→立即收掉音乐（自定义事件，不新增全局）
  // 20260930by：关→同步重置 BGM 状态（保证随后「开」能可靠从头重播，不等 onended 异步清状态）
  window.addEventListener('bm-splash-music-stop', function () {
    try {
      AUTO_MUSIC = false;
      bgmStop(1.2);
      BGM.started = false; BGM.src = null; BGM.gain = null; BGM.pending = false;
      hideAudioHint();
    } catch (e) {}
  });
  // 20260930by：开关打开=立即从头播放（无论开屏是否结束）；已在播则延续不重播
  window.addEventListener('bm-splash-music-start', function () {
    try {
      AUTO_MUSIC = true;
      if (BGM.started) return;                       // 已在循环播放→延续，不打断不重播
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      var resume = function (r) {
        if (actx.state === 'running') { bgmPlay(0); return; }   // 从头播
        BGM.pending = true; bgmArm(); showAudioHint();          // 仍被拦→待手势（点开关本身即手势，通常已 running）
      };
      if (actx.state !== 'running') {
        var p; try { p = actx.resume(); } catch (e1) {}
        if (p && p.then) { p.then(resume, resume); return; }
      }
      resume(true);
    } catch (e) {}
  });
  /* 20260930cb：总设置两条音量条的实时调节钩子（app.js 调用）。
     setSplash(pct)=开屏动画音乐音量；setApp(pct)=软件内音乐音量（「继续播放」贯穿时生效）。
     正在播放时就地平滑过渡，不重播不打断。 */
  window.__bmSplashVol = {
    setSplash: function (pct) {
      try {
        var p = Math.max(0, Math.min(2.0, (parseFloat(pct) || 0) / 100));
        BGM.userVol = p;
        if (BGM.gain && BGM.started && !(splashOver && AUTO_MUSIC)) {
          var t = actx.currentTime;
          BGM.gain.gain.cancelScheduledValues(t);
          BGM.gain.gain.setValueAtTime(Math.max(0.0001, BGM.gain.gain.value || 0.0001), t);
          BGM.gain.gain.linearRampToValueAtTime(Math.max(0.0001, BGM.vol * p), t + 0.15);
        }
      } catch (e) {}
    },
    setApp: function (pct) {
      try {
        var p = Math.max(0, Math.min(2.0, (parseFloat(pct) || 0) / 100));
        BGM.appVol = p;
        if (BGM.gain && BGM.started && splashOver && AUTO_MUSIC) {
          var t2 = actx.currentTime;
          BGM.gain.gain.cancelScheduledValues(t2);
          BGM.gain.gain.setValueAtTime(Math.max(0.0001, BGM.gain.gain.value || 0.0001), t2);
          BGM.gain.gain.linearRampToValueAtTime(Math.max(0.0001, BGM.vol * p), t2 + 0.15);
        }
      } catch (e) {}
    }
  };
  resize();
  bgmTry();                                      // 开屏起点：读偏好并尝试播放 BGM（被拦则待首次手势）
  rafId = requestAnimationFrame(frame);
})();
