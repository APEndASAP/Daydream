/* ============================================================================
   event-yinyuan.js  ·  姻缘牵（红线事件）  20261113h
   ----------------------------------------------------------------------------
   从 .workbuddy/preview/redline.html 移植。算法一行没改，只做了三件事：
     1. 尺寸不再写死 360×740 —— 全部按真实视口 / 真实聊天页量（W、H、TOPL、BOTL）
     2. 锚点换成主项目真实元素：#chat-avatar / .chat-input-bar / #chat-scroll .bubble
     3. 删掉预览用的假聊天（renderChat）、重播按钮、自动淡出

   为什么不能用 iframe：红线必须从**真实那颗头像**上缠出来、从**真实气泡**背后穿过，
   iframe 里量不到这些东西。

   退出规则（用户定案，不许加兜底）：一旦触发就锁死整个界面，只有写下回复才能解开。
   没有任何超时自动退出。
   ========================================================================== */
(function () {
'use strict';

/* 样式跟着层走，注进 #yy-root，不污染主项目全局 CSS */
const CSS_TEXT = '\n#yy-root{position:fixed;inset:0;z-index:2147483020;pointer-events:none;}\n#yy-root .rl-layer{position:absolute;inset:0;z-index:2;pointer-events:none;overflow:visible;\n  transition:opacity .65s ease;}\n#yy-root .rl-layer .shadow{fill:none;stroke:#2a0710;stroke-width:3.4;opacity:.5;filter:blur(2.4px);}\n#yy-root .rl-layer .sheen{fill:none;stroke:#ffd2e4;stroke-width:.60;opacity:.09;}\n#yy-root .rl-layer .s1{fill:none;stroke:url(#rlGrad);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;\n  filter:drop-shadow(0 1px 2px rgba(40,0,10,.6));}\n#yy-root .rl-layer .s2{fill:none;stroke:#ff3d80;stroke-width:1.05;opacity:.46;stroke-linecap:round;\n  stroke-dasharray:11 13;filter:drop-shadow(0 0 2px rgba(255,60,120,.26));}\n#yy-root .rl-tp{fill:rgba(10,4,9,.70);}\n#yy-root .rl-t{font-family:"Songti SC","STSong","Noto Serif SC",serif;font-size:14.5px;font-weight:700;\n  fill:#ffa3bd;opacity:0;text-anchor:middle;dominant-baseline:middle;\n  paint-order:stroke;stroke:#1a0308;stroke-width:2.6;stroke-linejoin:round;\n  filter:drop-shadow(0 0 5px rgba(255,60,110,.40));}\n\n';
/* 演出层的 SVG 骨架（跟预览稿完全一致，只是 id 收在 #yy-root 里） */
const SVG_TPL = '<svg class="rl-layer" xmlns="http://www.w3.org/2000/svg">\n  <defs>\n    <linearGradient id="rlGrad" x1="0" y1="0" x2="0" y2="1">\n      <stop offset="0" stop-color="#a81242"/><stop offset=".18" stop-color="#c41750"/>\n      <stop offset=".36" stop-color="#e0538c"/><stop offset=".54" stop-color="#b5134a"/>\n      <stop offset=".72" stop-color="#d94a80"/><stop offset=".88" stop-color="#a81242"/>\n      <stop offset="1" stop-color="#c41750"/>\n    </linearGradient>\n    <filter id="softOcc" x="-20%" y="-20%" width="140%" height="140%">\n      <feGaussianBlur stdDeviation=".7"/>\n    </filter>\n    <mask id="occl" maskUnits="userSpaceOnUse" x="0" y="0" width="360" height="740">\n      <rect class="occl-bg" x="0" y="0" width="360" height="740" fill="#fff"/>\n    </mask>\n    <path id="tp1" fill="none"/>\n  </defs>\n  <g id="maskTarget">\n    <path class="shadow"/><path class="s1"/><path class="sheen"/><path class="s2"/>\n  </g>\n  <g class="txt-layer"></g>\n</svg>';

const NS = 'http://www.w3.org/2000/svg';
const DUR = 12400;          /* 整条线长满的时间 */

/* ---------------- 模块状态（每次播放重置） ---------------- */
let W = 360, H = 740;           /* 视口尺寸 */
let TOPL = 96, BOTL = 652;      /* 文字禁区上下界（动态：头像下方 ~ 输入栏上方） */
let SAFE_T = 44;                /* 打结时的顶部安全区 */
let nodes = [], totalS = 1, pxPerNode = 1;
let knotZones = [], knotS = [], wrapFrom = 0, wrapTo = 0, wrapS = 0;
let txtIdx = 0;
let growT = 0;
let root = null, rlLayer = null, txtLayer = null;
let shadow = null, line1 = null, sheen = null, line2 = null, maskTarget = null;
let settle = null;              /* 结束回调（回复后调用） */

/* 真实视口坐标（root 是 fixed 覆盖整屏，所以不需要再减容器原点） */
function rectInApp(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height,
           cx: r.left + r.width / 2, cy: r.top + r.height / 2, b: r.bottom };
}
/* 软饱和：归一化后 0.84 以内完全线性，超出部分用 tanh 平滑逼近边界。
   以前用硬 clamp，线一撞到左右边界就变成一条竖直直线，与曲线衔接处就是直角/尖角。 */
const softSat = u => {
  const k = .84, a = Math.abs(u), sg = u < 0 ? -1 : 1;
  if (a <= k) return u;
  return sg * (k + (1 - k) * Math.tanh((a - k) / (1 - k)));
};
const clampX = v => { const m = W / 2, r = W / 2 - 34; return m + r * softSat((v - m) / r); };
/* 缓动：首尾一阶二阶导都为 0，生长不会突然一顿一顿 */
const eInOut = x => { x = Math.max(0, Math.min(1, x)); return x * x * x * (x * (x * 6 - 15) + 10); };


/* ---------------- 1. 路径工具 ---------------- */
function curveTo(pts, target, sag){
  const prev = pts[pts.length - 1];
  const mx = (prev[0] + target[0]) / 2, my = (prev[1] + target[1]) / 2 + (sag || 0);
  const n = 10;
  for (let i = 1; i <= n; i++){
    const t = i / n, u = 1 - t;
    pts.push([u*u*prev[0] + 2*u*t*mx + t*t*target[0],
              u*u*prev[1] + 2*u*t*my + t*t*target[1]]);
  }
}
/* 椭圆环：用来「绕输入栏一圈」 */
function ovalLoop(pts, cx, cy, rx, ry, turns, startAng, wob){
  const n = 96;
  for (let i = 1; i <= n; i++){
    const a = startAng + turns * Math.PI * 2 * (i / n);
    /* wob>0 时半径按角度起伏 —— 回弯不会是一个规整的圆，而是有点散、有点崎岖 */
    const kx = 1 + (wob || 0) * Math.sin(a * 3.4 + .6);
    const ky = 1 + (wob || 0) * Math.sin(a * 2.7 + 1.9);
    pts.push([cx + Math.cos(a) * rx * kx, cy + Math.sin(a) * ry * ky]);
  }
}
function soften(pts, passes){
  let cur = pts;
  for (let k = 0; k < passes; k++){
    const nx = cur.slice();
    for (let i = 1; i < cur.length - 1; i++){
      nx[i] = [cur[i-1][0]*.25 + cur[i][0]*.5 + cur[i+1][0]*.25,
               cur[i-1][1]*.25 + cur[i][1]*.5 + cur[i+1][1]*.25];
    }
    cur = nx;
  }
  return cur;
}
/* 按弧长均匀重采样：点距一律 step。
   这是「不出尖角」的地基 —— 点距一旦忽疏忽密，Catmull-Rom 的三次拟合就会过冲，
   在结的两端冒出针尖/方角。结是圆的，但沿弧长的进度是变速的，必须重新等分。 */
function resamplePath(pts, step){
  if (pts.length < 3) return pts.slice();
  const out = [[pts[0][0], pts[0][1]]];
  let need = step;
  for (let i = 1; i < pts.length; i++){
    let ax = pts[i-1][0], ay = pts[i-1][1];
    const bx = pts[i][0], by = pts[i][1];
    let d = Math.hypot(bx-ax, by-ay);
    while (d >= need){
      const t = need / d;
      ax += (bx-ax)*t; ay += (by-ay)*t;
      out.push([ax, ay]);
      d = Math.hypot(bx-ax, by-ay);
      need = step;
    }
    need -= d;
  }
  const last = pts[pts.length-1], tail = out[out.length-1];
  if (Math.hypot(last[0]-tail[0], last[1]-tail[1]) > step * .35) out.push([last[0], last[1]]);
  return out;
}
/* 某个下标处的累计弧长：把「节点区间」换算成「弧长区间」，
   这样重采样之后结的位置依然准，不会因为点数变了而错位。 */
function sAt(pts, idx){
  let s = 0;
  const n = Math.min(idx, pts.length - 1);
  for (let i = 1; i <= n; i++) s += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
  return s;
}

/* 每个点带上弧长 s 和法线 (nx,ny) —— 波动就是沿法线推 */
function withArc(pts){
  let s = 0;
  return pts.map((p, i) => {
    if (i) s += Math.hypot(p[0]-pts[i-1][0], p[1]-pts[i-1][1]);
    const a = pts[Math.max(0, i-1)], b = pts[Math.min(pts.length-1, i+1)];
    const dx = b[0]-a[0], dy = b[1]-a[1], L = Math.hypot(dx, dy) || 1;
    return { x:p[0], y:p[1], s, nx:-dy/L, ny:dx/L };
  });
}
/* 两根线的横向间距：长波为主，只偶尔交一次 */
function offsetAt(s, phase){
  return 4.9 * Math.sin(s / 260 + phase) + 1.2 * Math.sin(s / 132 + phase * 1.7);
}
/* 生成 path：offsetAt（两线间距） + 麦浪（向前推的行波） */
function strandD(nodes, phase, time, ampFn){
  const total = nodes[nodes.length - 1].s || 1;
  const out = nodes.map(n => {
    const ramp = Math.min(1, n.s / 80);                       // 从头像出来先稳住，再慢慢飘
    /* 结区两条线必须并拢：法线在结里转满一圈，两线各偏 ±2.4 就会叉出一个 V 形尖 */
    const sep = Math.min(1, n.s / 170) * (1 - .74 * (n.pin || 0));
    /* 垂下来的晃动：两根线同相一起摆（只差一点点相位），所以间距不会被晃散。
       幅度要肉眼可见 —— 一线 1.5px 的细线，横向摆 6px 才像一根真线被风带着晃。 */
    const wg = n.wg === undefined ? 1 : n.wg;
    const wave = ramp * wg * (
        7.20 * Math.sin(n.s / 236 - time * .52 + phase * .18)
      + 2.40 * Math.sin(n.s / 98  + time * .31 + phase * .12)
    );
    /* 末端（绕输入栏那圈）两线并拢：扁椭圆两端法线是横的，不并拢会叉出两根尖刺 */
    const tail = n.s > total * .88 ? Math.max(0, (total - n.s) / (total * .12)) : 1;
    const o = sep * tail * (offsetAt(n.s, phase) + wave + (ampFn ? ampFn(n.s / total) : 0));
    return [n.x + n.nx * o, n.y + n.ny * o];
  });
  let d = 'M' + out[0][0].toFixed(1) + ' ' + out[0][1].toFixed(1);
  for (let i = 0; i < out.length - 1; i++){
    const p0 = out[Math.max(0, i-1)], p1 = out[i], p2 = out[i+1], p3 = out[Math.min(out.length-1, i+2)];
    d += 'C' + (p1[0] + (p2[0]-p0[0])/6).toFixed(1) + ' ' + (p1[1] + (p2[1]-p0[1])/6).toFixed(1) +
         ' ' + (p2[0] - (p3[0]-p1[0])/6).toFixed(1) + ' ' + (p2[1] - (p3[1]-p1[1])/6).toFixed(1) +
         ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
  }
  return d;
}

/* ---------------- 2. 打结 ---------------- */
function loopPath(a0, tx, ty, R, sgn, N, seed){
  const nx = -ty, ny = tx;
  const out = [];
  for (let k = 0; k <= N; k++){
    const u = k / N, phi = Math.PI * 2 * u;
    /* 半径的低频起伏：让环不是完美圆 —— 扁一点、边缘有一点点弯弯曲曲 */
    const wob = 1 + .085 * Math.sin(3 * phi + seed) + .035 * Math.sin(2 * phi - seed * 1.6);
    const ct = Math.sin(phi), cn = 1 - Math.cos(phi);
    const sx = ct * R * 1.06 * wob;        /* 沿主线方向略拉长 */
    const sn = cn * R * .86 * wob;         /* 法向压扁 → 扁圆 */
    out.push([a0[0] + tx * sx + sgn * nx * sn,
              a0[1] + ty * sx + sgn * ny * sn]);
  }
  return out;
}
function addLoop(pts, idx, R, barY, seed){
  const N = Math.max(96, Math.round(Math.PI * 2 * R / 2.4));
  if (idx < 6 || idx + 2 >= pts.length) return 0;
  const a0 = pts[idx], a1 = pts[idx + 1];
  let dx = a1[0] - a0[0], dy = a1[1] - a0[1];
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;

  /* 圈往哪边绕：两个方向都算一遍，挑不撞边、不压输入栏的那个；
     两边都放不下就干脆不打这个结，绝不让圈被屏幕裁掉半截（裁掉就是硬直角）。 */
  /* 尺寸全部按真实聊天页算：W-6 是右边界，SAFE_T 是顶栏留出的安全区 */
  const fits = arr => arr.every(p =>
    p[0] > 6 && p[0] < W - 6 && p[1] > SAFE_T && p[1] < barY - 2);
  let out = null, bestOut = 1e9;
  for (const sg of [1, -1]){
    const arr = loopPath(a0, dx, dy, R, sg, N, seed);
    if (!fits(arr)) continue;
    let far = 0;
    for (const p of arr) far = Math.max(far, Math.abs(p[0] - 180));
    if (far < bestOut){ bestOut = far; out = arr; }
  }
  if (!out) return 0;
  window.__lp = { R: R, N: N };
  /* 只替换 idx 这一个点：环的首尾都落在这里，点序连续，前后衔接平滑 */
  pts.splice(idx, 1, ...out);
  return out.length;
}

/* ---------------- 3. 走势 ---------------- */
function buildBase(){
  const pts = [];
  const bar = rectInApp(document.querySelector('.chat-input-bar'));
  /* 起点 = 最顶上那排的角色头像（聊天头部那个）：
     线先从上沿垂下来，绕着这颗头像缠一圈，再从右下角顺出去往下走。 */
  /* 20261113h：锚点换成主项目真实头像 #chat-avatar（红线必须从这颗头像上长出来） */
  const avEl = document.getElementById('chat-avatar') ||
               document.querySelector('#view-chat .topbar .avatar');
  const av = avEl && avEl.getBoundingClientRect && avEl.getBoundingClientRect().width
             ? rectInApp(avEl)
             : { cx: W / 2, cy: 72, w: 34, h: 34, b: 90 };   /* 兜底：头像没渲染时别把线画到屏幕外 */
  /* 文字禁区的上界 / 下界：上界压到头像下方，下界压在输入栏上沿 */
  TOPL = av.b + 8;
  BOTL = bar.y - 14;
  SAFE_T = Math.min(64, H * .075);
  const ccx = av.cx, ccy = av.cy;
  const arx = av.w / 2 + 3.6, ary = av.h / 2 + 4.0;

  /* ① 从画面上方垂下来，落到头像顶上 */
  for (let i = 0; i <= 10; i++){
    const u = i / 10;
    pts.push([ccx + 2.4 * u, -6 + (ccy - ary + 6) * u]);
  }
  wrapFrom = pts.length;
  /* ② 缠住这个头像：绕 1.3 圈，从左下/右下顺出去（不多不少，刚好一圈多） */
  const WRAP_N = 88, wrapA0 = -Math.PI / 2, turns = 1.30;
  for (let i = 1; i <= WRAP_N; i++){
    const a = wrapA0 + Math.PI * 2 * turns * (i / WRAP_N);
    pts.push([ccx + Math.cos(a) * arx, ccy + Math.sin(a) * ary]);
  }
  wrapTo = pts.length;
  const exit = pts[pts.length - 1];
  const startX = exit[0], startY = exit[1];

  const yBot = bar.y + bar.h * .5;
  const amp = 68 + Math.random() * 30;               /* 横向摆幅 */
  const ph  = Math.random() * Math.PI * 2;
  const freq = 1.35 + Math.random() * .55;           /* 往下走几个来回 */
  const N = 190;
  for (let i = 0; i <= N; i++){
    const t = i / N;
    const y = startY + (yBot - startY) * t;
    const env = Math.sin(Math.PI * Math.min(1, .06 + t * .94));
    let x = W / 2 + 2 + amp * env * Math.sin((t * freq + ph / (Math.PI * 2)) * Math.PI * 2)
              + 18 * Math.sin(t * 6.3 + ph * 1.7);
    /* 开头 18%：从头像身上先直着垂下来，再慢慢摆开，不凭空出现、也不在头像上打结 */
    const w = eInOut(Math.min(1, t / .18));
    x = startX + (x - startX) * w;
    x = clampX(x);
    pts.push([x, y]);
  }

  /* 结：一个或两个，位置每次随机，彼此避开。
     ?noloop 关掉结，专门用来核对主线本身有没有折角。 */
  knotZones = [];
  const NO_LOOP = location.search.indexOf('noloop') >= 0;
  const knots = NO_LOOP ? 0 : (Math.random() < .45 ? 2 : 1);
  const used = [];
  /* 结只能落在主 S 段上：落进「缠头像」那圈会把整段搅乱，落得太靠后会吃掉绕输入栏的收尾 */
  const kMin = Math.min(pts.length - 110, wrapTo + 22);
  const kMax = Math.max(kMin + 12, pts.length - 96);
  for (let k = 0; k < knots; k++){
    let idx = 0, tries = 0;
    do {
      idx = Math.round(kMin + (kMax - kMin) * Math.random());
      tries++;
    } while (tries < 40 && used.some(u => Math.abs(u - idx) < 170));
    used.push(idx);
    /* 结的半径 54~68（直径 108~136）：之前 31~40 太小，圈缩成一个小尖，看着像线断了一半 */
    const len = addLoop(pts, idx, (54 + Math.random() * 14) * Math.min(1.12, W / 360), bar.y, Math.random() * 6.283);
    if (len) knotZones.push([idx, idx + len]);
  }

  /* 落到输入栏，松松地搭一圈 —— 裹住，但只是搭着，不勒住输入框 */
  const bcx = W / 2, bcy = bar.y + bar.h / 2 - 3;
  const brx = Math.min(W * .34, W / 2 - 18) + Math.random() * 8, bry = 14 + Math.random() * 4;
  const last = pts[pts.length - 1];
  let a0 = Math.atan2((last[1] - bcy) / bry, (last[0] - bcx) / brx);
  a0 += Math.random() < .5 ? .12 : -.12;
  curveTo(pts, [bcx + Math.cos(a0) * brx, bcy + Math.sin(a0) * bry], 2);
  ovalLoop(pts, bcx, bcy, brx, bry, 1.02, a0, .05);
  return pts;
}

/* 主路径 → 平滑 + 弧长等分 → 带 s / 法线 的节点表。
   弧长等分是「不出尖角」的地基：点距一旦忽疏忽密，Catmull-Rom 就会过冲，
   在结的两端冒出针尖 / 方角。 */
function nodesBase(){
  const raw = buildBase();
  /* 结 / 缠头像的「节点区间」换算成「弧长区间」，重采样后仍然准 */
  knotS = knotZones.map(([a, b]) => [sAt(raw, a), sAt(raw, b)]);
  wrapS = sAt(raw, wrapTo);
  return withArc(soften(resamplePath(raw, 2.7), 4));
}

/* ---------------- 4. 遮挡 ---------------- */
function buildMask(){
  const mask = document.getElementById('occl');
  mask.querySelectorAll('.occ-hole').forEach(el => el.remove());
  const rows = [...document.querySelectorAll('#chat-scroll .msg-row, #chat-scroll .poke-row')];
  rows.forEach((row, i) => {
    if (i % 2 === 0) return;
    const bub = row.querySelector('.bubble') || row.querySelector('.poke-msg');
    if (!bub) return;
    const b = rectInApp(bub);
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', b.x - 1); r.setAttribute('y', b.y - 1);
    r.setAttribute('width', b.w + 2); r.setAttribute('height', b.h + 2);
    r.setAttribute('rx', 18); r.setAttribute('fill', '#000');
    r.setAttribute('filter', 'url(#softOcc)');
    r.setAttribute('class', 'occ-hole');
    mask.appendChild(r);
  });
}

/* ---------------- 5. 文字 ---------------- */
const TXT_SETS = [
  ['我想要缠着你', '我想要粘着你'],
  ['一直一直缠着你', '你别想走'],
  ['让我缠着你', '就一会儿'],
  ['线上的每一寸', '都写着你']
];



const TXT_STEP_PX = 24;    /* 字与字之间沿线的弧长 —— 拉开才看得清 */
const TXT_OFF = 19;        /* 字离开线多少 */

/* 每个节点的「弯不弯」：大回弯、打结的地方直接判死，不出字 */
function annotate(){
  const L = nodes.length;
  for (let i = 0; i < L; i++){
    const a = nodes[Math.max(0, i - 6)], b = nodes[i], c = nodes[Math.min(L - 1, i + 6)];
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = Math.PI * 2 - d;
    const len = Math.max(1, (b.s - a.s) + (c.s - b.s));
    b.curv = d / len;
    /* 打结、急弯一律不出字：字被线圈裹住就看不见了，宁可整句挪到前面或后面。
       结的半径 31~40 → 曲率 0.025~0.032，门槛必须低于它，否则圈里还会塞字。 */
    b.knot = b.curv > .022;
  }
  /* 两条线并拢的权重必须连续：按节点硬切（1 → .26）会让两线在边界上骤然靠近，
     接缝处捏出一个 V 形尖角 —— 这正是之前反复出现的「方方正正的角」。
     先按结的区间取硬标记，再做多次盒式模糊，得到一条平滑的 pin 曲线。 */
  let pin = nodes.map((n, i) => (inForbid(i) || n.knot) ? 1 : 0);
  for (let pass = 0; pass < 7; pass++){
    const prev = pin.slice();
    for (let i = 0; i < L; i++){
      let acc = 0, cnt = 0;
      for (let j = -4; j <= 4; j++){
        const k2 = i + j;
        if (k2 >= 0 && k2 < L){ acc += prev[k2]; cnt++; }
      }
      pin[i] = acc / cnt;
    }
  }
  for (let i = 0; i < L; i++) nodes[i].pin = pin[i];

  /* 晃动门控 wg：缠头像那圈、结、绕输入栏的收尾里都不要横摆 ——
     那几处法线转得飞快，一横摆就把圈搅成折角。 */
  for (let i = 0; i < L; i++){
    const s = nodes[i].s;
    let g = Math.max(0, Math.min(1, (s - wrapS) / 90));      /* 刚出缠头像那段先稳住 */
    for (const [a, b] of knotS){                             /* 结里 0，出结 90px 后渐入 */
      const dNear = s < a ? a - s : (s > b ? s - b : 0);
      g *= Math.max(0, Math.min(1, (dNear - 34) / 80));
    }
    g *= Math.max(0, Math.min(1, (totalS - s) / 130));        /* 尾段收住 */
    nodes[i].wg = g;
  }
}

/* 一句话拆成一串独立的字，每个字自己找路径上的位置（不随切线旋转） */
let charGroups = [];
function buildChars(set){
  txtLayer.innerHTML = '';
  charGroups = [];
  set.forEach(str => {
    const g = document.createElementNS(NS, 'g');
    txtLayer.appendChild(g);
    const arr = [];
    for (let i = 0; i < str.length; i++){
      const bg = document.createElementNS(NS, 'rect');
      bg.setAttribute('class', 'rl-tp');
      bg.setAttribute('width', '17'); bg.setAttribute('height', '19');
      bg.setAttribute('rx', '4.5');
      bg.setAttribute('opacity', '0');
      g.appendChild(bg);
      const el = document.createElementNS(NS, 'text');
      el.setAttribute('class', 'rl-t');
      el.textContent = str[i];
      g.appendChild(el);
      el._bg = bg;
      arr.push(el);
    }
    charGroups.push(arr);
  });
}

let plan = [];
const OFF_CANDS = [TXT_OFF, TXT_OFF + 8, TXT_OFF + 16];

/* 这一点旁边有多空：0 = 压在气泡里，1 = 四周开着 */
function clearanceAt(nd, dir, off, boxes){
  const cx = nd.x + nd.nx * dir * off, cy = nd.y + nd.ny * dir * off;
  if (cx < 14 || cx > W - 14 || cy < TOPL || cy > BOTL) return -1;
  let best = 999;
  for (const b of boxes){
    /* 留 6px 安全边：字压着气泡圆角也算「看不清」 */
    const dx = Math.max(b.x - 6 - cx, 0, cx - (b.x + b.w + 6));
    const dy = Math.max(b.y - 6 - cy, 0, cy - (b.y + b.h + 6));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return Math.min(1, best / 20);
}

/* 这个节点在不在结的「圈里」：结的起止过渡段（位移接近 0）允许出字，
   只有真正绕出去的那一圈禁字 —— 圈里的字会被线圈裹住，读不出来。 */
function inForbid(i){
  const nd = nodes[i];
  if (!nd) return true;
  for (const [a, b] of knotS){
    if (nd.s >= a && nd.s <= b) return true;
  }
  return false;
}

/* 这一段的字会不会自己叠在一起（路径折回来、两处贴太近）—— 叠了就换别处 */
function segFolds(i0, dir, len, stepN, boxes, minGap){
  const P = [];
  for (let k = 0; k < len; k++){
    const nd = nodes[i0 + k * stepN];
    if (!nd) return true;
    let bo = 0, bc = .16;
    for (const o of OFF_CANDS){
      for (const d of [dir, -dir]){
        const c = clearanceAt(nd, d, o, boxes);
        if (c > bc){ bc = c; bo = d * o; }
      }
    }
    const off = bo || TXT_OFF;
    P.push([nd.x + nd.nx * off, nd.y + nd.ny * off]);
  }
  for (let a = 0; a < P.length; a++){
    for (let b = a + 1; b < P.length; b++){
      if (Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]) < minGap) return true;
    }
  }
  return false;
}

function planText(set){
  plan = [];
  const boxes = [...document.querySelectorAll('#view-chat .topbar .who, #view-chat .topbar .avatar, #view-chat .topbar .icon-btn, #chat-scroll .bubble, #chat-scroll .poke-msg, #chat-scroll .msg-avatar')].map(rectInApp);
  /* 回复框也算「占位物」：字不能压到它上面，否则读不出来 */

  const stepN = Math.max(1, Math.round(TXT_STEP_PX / pxPerNode));
  const last = nodes.length - 1;
  const used = [];

  /* 两句分开摆：第一句在上半屏（y 100~400），第二句在下半屏（y 400~652） */
  const mid = (TOPL + BOTL) / 2;
  const band = [[TOPL + 4, mid], [mid, BOTL]];

  set.forEach((str, si) => {
    const len = str.length;
    let best = null;
    /* 三轮：先按严格间距找（21px），再放宽到 13px，最后允许跨整个屏幕找（绝不叠字） */
    const rounds = [{ gap: 21, band: band[si] }, { gap: 13, band: band[si] }, { gap: 13, band: [TOPL + 4, BOTL] }];
    for (const rd of rounds){
      if (best) break;
      for (const dir of [1, -1]){
        for (let i0 = 2; i0 <= last - len * stepN; i0++){
          const y0 = nodes[i0].y, y1 = nodes[i0 + (len - 1) * stepN].y;
          if (Math.min(y0, y1) < rd.band[0] || Math.max(y0, y1) > rd.band[1]) continue;
          let score = 0, bad = false;
          for (let k = 0; k < len; k++){
            const idx = i0 + k * stepN;
            const nd = nodes[idx];
            if (!nd || inForbid(idx) || nd.knot){ bad = true; break; }   /* 结、缠头像：硬排除 */
            let c = -1;
            for (const o of OFF_CANDS) c = Math.max(c, clearanceAt(nd, dir, o, boxes));
            score += c;
            if (used.some(([u0, u1]) => idx >= u0 - 12 && idx <= u1 + 12)){ bad = true; break; }
          }
          if (bad) continue;
          if (segFolds(i0, dir, len, stepN, boxes, rd.gap)) continue;
          const sc = score / len;
          if (!best || sc > best.score) best = { i0, dir, score: sc, stepN, str };
        }
      }
    }
    if (best){
      used.push([best.i0, best.i0 + (len - 1) * best.stepN]);
      /* 整句必须排在线的同一侧、同一个距离 —— 字列才整齐，不会一跳左一跳右。
         以前一旦有几个字被气泡挡住就退回「每字各挑各的」，结果字在气泡两边乱跳、
         看着像叠在一起。现在整句只选一次偏移，宁可离气泡近一点，也不打散。 */
      let pick = null;
      for (const d of [best.dir, -best.dir]){
        for (const o of OFF_CANDS){
          let sum = 0, ok = true;
          for (let k = 0; k < len; k++){
            const nd = nodes[best.i0 + k * best.stepN];
            if (!nd) continue;
            const c = clearanceAt(nd, d, o, boxes);
            if (c < 0){ ok = false; break; }
            sum += c;
          }
          if (ok && (!pick || sum > pick.sum)) pick = { d, o, sum };
        }
      }
      best.offs = [];
      for (let k = 0; k < len; k++){
        best.offs.push(pick ? pick.d * pick.o : TXT_OFF);
      }
      best.idx = si;
      plan.push(best);
    }
  });
}

/* 字跟着线走：每帧按节点坐标摆，所在位置生长到了才亮出来 */
function layoutChars(prog){
  plan.forEach(item => {
    const arr = charGroups[item.idx];
    if (!arr) return;
    for (let k = 0; k < arr.length; k++){
      const nd = nodes[item.i0 + k * item.stepN];
      const el = arr[k];
      /* off 为 0 只代表「没找到空位」，不能因此把字吞掉 —— 退回默认间距，至少读得出来 */
      const off = item.offs[k] || TXT_OFF;
      if (!nd || nd.s / totalS > prog + .004){
        el.style.opacity = 0;
        if (el._bg) el._bg.setAttribute('opacity', '0');
        continue;
      }
      const px = nd.x + nd.nx * off, py = nd.y + nd.ny * off;
      el.setAttribute('x', px.toFixed(1));
      el.setAttribute('y', py.toFixed(1));
      el.style.opacity = 1;
      if (el._bg){
        el._bg.setAttribute('x', (px - 8.5).toFixed(1));
        el._bg.setAttribute('y', (py - 9.5).toFixed(1));
        el._bg.setAttribute('opacity', '1');
      }
    }
  });
}

/* ============================================================
   播放
   ============================================================ */
const grow = p => {
  p = Math.max(0, Math.min(1, p));
  return Math.pow(p, 1.62) * (1 - .06 * p) + .06 * p;
};

function draw(t, p) {
  const g = grow(p);
  const d1 = strandD(nodes, 0, t, null);
  line1.setAttribute('d', d1);
  const d2 = strandD(nodes, Math.PI, t, s => s < .34 ? 0 : Math.pow((s - .34) / .66, 1.4) * 10);
  line2.setAttribute('d', d2);
  shadow.setAttribute('d', d1);
  sheen.setAttribute('d', d1);

  line1.style.strokeDashoffset = 1000 * (1 - g);
  shadow.style.strokeDashoffset = line1.style.strokeDashoffset;
  sheen.style.strokeDashoffset = line1.style.strokeDashoffset;
  line2.style.strokeDashoffset = 1000 * (1 - grow(Math.max(0, (p - .04) / .96)));

  layoutChars(g);
}

/* 不重建聊天（原来是 renderChat 造假消息 —— 那会把玩家真实记录覆盖掉） */
function rebuild() {
  const sc = document.getElementById('chat-scroll');
  if (sc) void sc.offsetHeight;            /* 强制回流：气泡刚渲染完，坐标还没落定 */
  nodes = nodesBase();
  totalS = nodes[nodes.length - 1].s || 1;
  pxPerNode = totalS / Math.max(1, nodes.length - 1);
  annotate();
  buildMask();
  txtIdx = Math.floor(Math.random() * TXT_SETS.length);
  buildChars(TXT_SETS[txtIdx]);
  planText(TXT_SETS[txtIdx]);
}

/* ---------------- 建层 ---------------- */
function buildDom() {
  const host = document.createElement('div');
  host.id = 'yy-root';

  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  host.appendChild(style);

  /* 20261113h：不再有点击拦截层、不再有回复框 ——
     红线只是「过一会儿自己散掉」的装饰，玩家要能照常点聊天、照常在下方的原输入栏打字。 */
  const wrap = document.createElement('div');
  wrap.innerHTML = SVG_TPL;
  const svg = wrap.firstChild;
  host.appendChild(svg);

  document.body.appendChild(host);

  root = host;
  rlLayer = svg;
  txtLayer = svg.querySelector('.txt-layer');
  shadow = svg.querySelector('.shadow');
  line1 = svg.querySelector('.s1');
  sheen = svg.querySelector('.sheen');
  line2 = svg.querySelector('.s2');
  maskTarget = svg.querySelector('#maskTarget');

  maskTarget.setAttribute('mask', 'url(#occl)');
  [shadow, line1, sheen, line2].forEach(el => {
    el.setAttribute('pathLength', '1000');
    el.style.strokeDasharray = '1000';
    el.style.strokeDashoffset = '1000';
  });
}

/* 量尺寸：每次开演都重新量（横竖屏、键盘弹出、不同机型都吃得下） */
function measure() {
  W = Math.max(280, window.innerWidth || 360);
  H = Math.max(420, window.innerHeight || 740);
  rlLayer.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const mb = root.querySelector('.occl-bg');
  if (mb) { mb.setAttribute('width', W); mb.setAttribute('height', H); }
  const mk = root.querySelector('#occl');
  if (mk) { mk.setAttribute('width', W); mk.setAttribute('height', H); }
}

/* 结束：淡出后整层移除。
   红线跟「目光」不是一回事 —— 它不挡操作、不要求回复，长满后停一会儿自己散开。 */
function finish() {
  if (!root) return;
  clearInterval(growT); growT = 0;
  const host = root, cb = settle;
  root = null; settle = null;
  rlLayer.style.transition = 'opacity .95s ease';
  rlLayer.style.opacity = '0';
  setTimeout(function () {
    try { host.remove(); } catch (e) {}
    if (cb) cb(null);
  }, 1000);
}

/* ============================================================================
   对外入口
   bmYinyuanPlay() → Promise<null>
   纯装饰：不拦触摸、不弹输入框、不要回复。整层 pointer-events:none，
   玩家照常点聊天、照常在下方的原输入栏打字发消息；线长满 → 停 HOLD → 自行淡出。
   ========================================================================== */
const HOLD = 2600;                 /* 长满后再停多久开始淡出 */

window.bmYinyuanPlay = function () {
  return new Promise(function (resolve) {
    if (document.getElementById('yy-root')) { resolve(null); return; }
    if (!document.getElementById('chat-scroll')) { resolve(null); return; }
    settle = resolve;

    buildDom();

    /* 页面切换有 .26s 的位移/透明度过渡：
       过渡中 getBoundingClientRect 量到的是「动着的」坐标，缠头像会缠到错的地方。
       所以等视图停稳（transform 归位）再量、再建线。 */
    const view = document.getElementById('view-chat');
    const settling = function () {
      if (!view) return false;
      const t = getComputedStyle(view).transform;
      return !!t && t !== 'none';
    };
    const start = function () {
      measure();
      rebuild();
      run();
    };
    if (settling()) setTimeout(start, 340);
    else requestAnimationFrame(function () { requestAnimationFrame(start); });

    function run() {
      const t0 = performance.now();
      clearInterval(growT);
      growT = setInterval(function () {
        const ms = performance.now() - t0;
        if (ms < DUR) {
          draw(ms / 1000, Math.min(1, ms / DUR));
        } else {
          /* 长满了：保持一点呼吸般的晃动，停 HOLD 之后自己散掉 */
          draw(performance.now() / 1000, 1);
          if (ms >= DUR + HOLD) { clearInterval(growT); growT = 0; finish(); }
        }
      }, 22);

      /* 视口变化（键盘弹出/旋转）→ 重新量尺寸重算走势 */
      let rzT = 0;
      const onResize = function () {
        clearTimeout(rzT);
        rzT = setTimeout(function () {
          if (!root) return;
          measure();
          rebuild();
        }, 260);
      };
      window.addEventListener('resize', onResize);
      /* 玩家中途切去别的页面：线不该继续挂在别的页面上，直接散掉 */
      const iv = setInterval(function () {
        if (!root) {
          window.removeEventListener('resize', onResize);
          clearInterval(iv);
          return;
        }
        const v = document.body.dataset.view;
        if (v && v !== 'chat') { clearInterval(growT); growT = 0; finish(); }
      }, 700);
    }
  });
};

})();
