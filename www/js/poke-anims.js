/* ============================================================================
   poke-anims.js  ·  20261113g
   ----------------------------------------------------------------------------
   戳一戳「小球互动」动画池 —— 从 .workbuddy/preview/poke-anim.html 原样移植。
   尺寸与主项目戳一戳完全一致：viewBox 0 0 24 24，大球 R=5.0、小球 r=3.15，
   大球圆心 16.4 / 7.6，小球静止位 4.2 / 19.8（与 pokeFxHtml 的 BX/SX 一致）。

   与主项目原有「蹭蹭」戳一戳动画并存，互不影响：
     · 原有动画保持 pokeFxHtml + playPokeSquish（app.js 里那一套）
     · 本文件只负责新增的 7 个动作：抱抱 / 摸摸头 / 依偎 / 捏脸 / 钻进怀里 / 生气 / 亲亲

   对外只有两个接口：
     window.BM_POKE_ANIMS      动作清单（id / name / dur）
     window.bmPokePlay(host, id, side)   在 host 元素里播放，side=1 大球在右、-1 大球在左
   ========================================================================== */
(function(){
'use strict';

/* 预览页里用来调试的 URL 参数在主项目中一律视为「没有」：
   nofx（关特效）/ hdbg（打印手部坐标）都不生效，render 里的分支自然跳过。 */
const QS = { has(){ return false; }, get(){ return null; } };

const NS = 'http://www.w3.org/2000/svg';
const CY = 12, RB = 5.0, RS = 3.15;
const BIG_X = 16.55, SMALL_X = 5.55;

/* 缓动：smootherstep（首尾一阶二阶导都为 0，压入/松开不会有硬拐点） */
const eInOut = x => { x = Math.max(0, Math.min(1, x)); return x*x*x*(x*(x*6-15)+10); };
const eOut = x => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const lerp = (a, b, k) => a + (b - a) * k;
function track(t, pts, fn = eInOut){
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++){
    if (t <= pts[i][0]){
      const [t0, v0] = pts[i-1], [t1, v1] = pts[i];
      return lerp(v0, v1, fn((t - t0) / Math.max(1e-6, t1 - t0)));
    }
  }
  return pts[pts.length-1][1];
}
function pulse(t, at, w){
  const d = Math.abs(t - at) / w;
  return d >= 1 ? 0 : Math.cos(d * Math.PI / 2) ** 2;
}

/* 极坐标变形：角度 ang 方向压出深度 dent 的凹坑，对侧补宽缓鼓包（体积守恒）。
   dent 给负值就是「往外鼓」——捏脸那种被扯出来的尖就靠它；
   sig 控制坑的宽窄（小＝窄尖，大＝宽兜）。 */
function blobD(cx, cy, r, ang, dent, swell, ex = 1, ey = 1, sig = .85){
  const N = 96;
  let d = '';
  for (let i = 0; i <= N; i++){
    const t = i / N * Math.PI * 2;
    const dd = Math.atan2(Math.sin(t - ang), Math.cos(t - ang)) / sig;
    const db = Math.atan2(Math.sin(t - ang - Math.PI), Math.cos(t - ang - Math.PI)) / .95;
    const rr = 1 - dent * Math.exp(-dd*dd) + swell * Math.exp(-db*db);
    const x = cx + Math.cos(t) * r * rr * ex;
    const y = cy + Math.sin(t) * r * rr * ey;
    d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
  }
  return d + 'Z';
}

/* 手：像 emoji 里那种圆手掌 —— 一个圆润的掌 + 一颗拇指，不是一根棍 */
function handPath(x, y, r){
  /* 掌：一个圆；拇指：侧面一颗小圆 —— 合起来就是 emoji 里那只圆手的轮廓 */
  return 'M' + (x - r) + ' ' + y + 'a' + r + ' ' + r + ' 0 1 0 ' + (r*2) + ' 0' +
    'a' + r + ' ' + r + ' 0 1 0 ' + (-r*2) + ' 0Z' +
    'M' + (x - r*1.25) + ' ' + (y + r*.55) + 'a' + (r*.55) + ' ' + (r*.55) + ' 0 1 0 ' +
    (r*1.1) + ' 0a' + (r*.55) + ' ' + (r*.55) + ' 0 1 0 ' + (-r*1.1) + ' 0Z';
}

const clamp01 = v => Math.max(0, Math.min(1, v));

const ANIMS = [
  {
    id:'hug', name:'抱抱', dur:3200,
    desc:'侧面扑上去抱住：两颗球前后挤在一起、一起被压成竖长的扁豆，中间挤出一道明显的压痕；两臂交叉着从对方背后绕到前面。',
    fn(t, s){
      const inK  = track(t, [[0,0],[.28,1]], eOut);
      const outK = track(t, [[.86,0],[1,1]], eInOut);
      const hold = Math.max(0, inK - outK);
      /* 卸力：抱上去之后不是僵在那里 —— 挤压慢慢松掉三成，两个人一起往下沉一口气。
         这是「靠在一起、然后一起躺下」的那个过程，僵住就成了贴图。 */
      const relax = track(t, [[.44,0],[.94,1]], eInOut);
      const breath = Math.sin((t - .44) * 5.4) * relax;             /* 卸力以后的慢呼吸 */
      const hit  = pulse(t, .29, .10);
      const spring = (t > .28 && t < .84) ? Math.sin((t - .28) * 19) * Math.exp(-(t - .28) * 6) : 0;
      const ease = 1 - .34 * relax;                                  /* 挤压量随卸力衰减 */
      /* 侧面抱的重点是「挤」：横向压窄、竖向拉长，两颗都变成竖长的扁豆 */
      s.aEx = 1 - .16 * hold * ease + .07 * spring; s.aEy = 1 + .17 * hold * ease - .06 * spring;
      s.bEx = 1 - .15 * hold * ease - .06 * hit + .05 * spring;
      s.bEy = 1 + .16 * hold * ease + .05 * hit - .04 * spring;
      /* 重叠到小球半径的一半 —— 从侧面看是「抱进怀里」，不是并排站着 */
      s.ax = lerp(s.ax0, s.bx - s.side * (RS * s.aEx + RB * s.bEx - RS * .46), hold);
      s.ay = CY + .20 * hold + .30 * relax + breath * .10
           + (hold > .5 ? Math.sin((t - .3) * 7) * .09 : 0);
      s.by = CY + .18 * relax + breath * .08;
      s.aDent = .16 * hold * ease + .05 * hit; s.aAng = s.side > 0 ? 0 : Math.PI; s.aSig = 1.2;
      s.bDent = .18 * hold * ease + .05 * hit; s.bAng = s.side > 0 ? Math.PI : 0; s.bSig = 1.2;
      const k = clamp01((hold - .22) / .36);
      /* 侧视抱抱：两条手臂**横着从球前面穿过去**，一上一下。
         从自己外侧的边缘出发，直接横穿戴过对方身体，手掌落在对方外侧 ——
         之前从头顶/脚底绕一圈，等于把两个球当俯视的圆在包，观感立刻变成俯视。
         手臂画在前层（front:true），压在对方球面上是"手臂搭在对方身上"，
         不是穿模；线条本身走一条平缓的弧，才不会像根棍子。 */
      s.hands = [
        { who:s.bWho, x:s.ax - s.side * RS * s.aEx * .78, y:s.ay + RS * s.aEy * .18 + relax * .10, r:.62, k, front:true,
          from:[s.bx + s.side * RB * s.bEx * .78, s.by - RB * s.bEy * .34],
          c:[(s.bx + s.ax) / 2, s.by + RB * s.bEy * .34] },
        { who:s.sWho, x:s.bx + s.side * RB * s.bEx * .80, y:s.by + RB * s.bEy * .46 - relax * .08, r:.60, k, front:true,
          from:[s.ax - s.side * RS * s.aEx * .80, s.ay + RS * s.aEy * .34],
          c:[(s.bx + s.ax) / 2, s.by + RB * s.bEy * .86] }
      ];
      if (hold > .45) s.fx.push({type:'heart', x:(s.ax + s.bx) / 2 + s.side * 1.4, y:CY - 5.4, t});
    }
  },
  {
    id:'kiss', name:'亲亲', dur:3000,
    desc:'小球踮起来凑过去，先把嘴嘟成一个小圆包（轮廓真的鼓出去，不是贴在脸上的色块），贴到大球脸颊上「啵」一下 —— 接触处被吸出一个浅浅的坑，连着亲两下，亲完自己先害羞地往回缩半步。',
    fn(t, s){
      const near = track(t, [[0,0],[.30,1],[.60,1],[.84,.48],[1,0]], eInOut);
      /* 两下的包络要重叠：中间不能完全松开，否则看着像亲两下、中间离开了一次 */
      const k1 = pulse(t, .38, .105), k2 = pulse(t, .55, .115);
      const kiss = Math.max(k1, k2 * .88);
      s.ax = lerp(s.ax0, s.bx - s.side * (RS * s.aEx + RB * s.bEx - .52), near);
      s.ay = lerp(CY, s.by - RB * .44, near) + Math.sin(t * 8.5) * .05 * near;
      const ang = Math.atan2(s.ay - s.by, s.ax - s.bx);
      s.bDent = (.03 + .30 * kiss) * near; s.bAng = ang; s.bSig = .60;
      s.bEx = 1 - .06 * kiss * near; s.bEy = 1 + .05 * kiss * near;
      /* 嘟嘴（只给小球做）：手绘里的嘟嘴不是贴一对嘴唇，是脸在嘴的位置
         「顶出来一团肉」—— 轮廓上鼓起一个圆润的小包，包上最多一道浅浅的唇缝。
         凸起直接长进球自己的轮廓里（dent 取负值＝往外鼓），跟球身天然连着，
         不会像单独拼上去的一块。凑近先嘟一点，每「啵」一下再明显鼓一次。 */
      const pout = near * (.34 + .66 * kiss);
      s.aDent = -.02 * pout; s.aAng = ang + Math.PI; s.aSig = .86;   /* 球身几乎不动，凸起全部由那颗同色小圆顶出来 */
      s.aEx = 1 - .04 * kiss * near; s.aEy = 1 + .06 * kiss * near;
      s.pout = { ang: ang + Math.PI, k: pout };
      const shy = track(t, [[.62,0],[.80,1],[.92,1],[1,0]], eInOut);
      s.ax += s.side * .52 * shy;
      s.ay += .34 * shy;
      /* 20261113i：爱心粒子 —— 原来只有 3 颗、scale 才 .20（约 1px，肉眼看不出），
         而且起步点 y 落在球体内部，一半时间被当背景。现在 7 颗从球顶往上冒：
         先淡入、边飘边散、左右微扭，终点高出球顶 1~3 个单位，30px 垫片里能一眼看清。 */
      if (t > .34 && t < .92){
        const cx = (s.ax + s.bx) / 2;
        /* 关键：30px 的垫片里，爱心只要压在球面上就等于「看不见」。
           所以整体抬到球顶（y=7）以上、尺寸给到近 1 倍，让它在一片空白里飘。 */
        const cy = 4.8;
        for (let i = 0; i < 3; i++){
          const ph = Math.max(0, Math.min(1, (t - .36) * 1.05 - i * .13));
          if (ph <= 0 || ph >= 1) continue;
          const grow = Math.sin(Math.min(1, ph * 2.6) * Math.PI * .5);   /* 0→1 快速胀开 */
          s.fx.push({
            type: 'heart',
            x: cx + (i - 1) * 2.7 + Math.sin(ph * 4.6 + i * 1.3) * .22 * ph,
            /* 三角排布：两侧两颗同高、中间那颗高一档，不再上下互相抵消叠成一朵 */
            y: cy - (i % 2) * 1.7 - ph * 2.4,
            s: .92 + .30 * grow - .22 * ph,              /* 心高≈6 个单位（7.5px），一眼能认出 */
            o: Math.min(1, ph * 4) * (1 - ph * ph * ph) * .95,
          });
        }
        /* 接触点四散的小闪光 = 「啵」的那一下 */
        if (kiss > .5){
          for (let i = 0; i < 3; i++){
            const a2 = -Math.PI * .5 + (i - 1) * .62;
            s.fx.push({ type:'star', x: cx + Math.cos(a2) * .95, y: cy + Math.sin(a2) * .95 + 1.1,
                        s: .26 + .14 * (i % 2) });
          }
        }
      }
    }
  },
  {
    id:'pat', name:'摸摸头', dur:3000,
    desc:'贴着站，圆手掌落到对方头顶来回蹭；每蹭一下头顶跟着塌，松开又 Q 弹地弹回来。',
    fn(t, s){
      const near  = track(t, [[0,0],[.22,1],[.88,1],[1,0]], eInOut);
      const rubOn = track(t, [[.26,0],[.34,1],[.78,1],[.86,0]], eInOut);
      const ph = (t - .34) / .42 * Math.PI * 2 * 2;
      const press = (.5 - .5 * Math.cos(ph * 2)) * rubOn;
      /* 被按的时候整颗球往下沉、两侧鼓出来 —— 夸张的 Q 弹 */
      s.bEx = 1 + .085 * press; s.bEy = 1 - .11 * press;
      s.bDent = (.03 + .20 * press) * rubOn; s.bAng = -Math.PI / 2; s.bSig = .92;
      s.by = CY + .30 * press;
      /* 贴着站：两球相切、略微压进去一点，不是隔着一道沟伸手 */
      s.ax = lerp(s.ax0, s.bx - s.side * (RS * s.aEx + RB * s.bEx - .55), near);
      s.ay = CY + .12 * near;
      s.aDent = .05 * near; s.aAng = s.side > 0 ? 0 : Math.PI;
      /* 手掌中心在头顶上方 .16，掌半径 .56 —— 下缘整个压进头顶里 */
      const hx = s.bx + Math.cos(ph) * .56 * rubOn;
      /* 手掌按在「已经塌下去」的那个头顶上，不然永远悬着一条缝 */
      const dentTop = (.03 + .20 * press) * rubOn;
      const hy = s.by - RB * s.bEy * (1 - dentTop) - .12;
      s.hands = [{
        who:s.sWho, x:hx, y:hy, r:.56, k:rubOn, front:true,
        from:[s.ax + s.side * RS * .38, s.ay - RS * .56],
        c:[s.bx - s.side * RB * 1.02, s.by - RB * 1.34]
      }];
      if (press > .92) s.fx.push({type:'star', x:hx + s.side * 1.05, y:hy - 1.1});
    }
  },
  {
    id:'pinch', name:'捏脸', dur:3200,
    desc:'从侧面（离得最近的那边）捏住脸颊往外扯出一个尖，拽住后左右晃两下，再松手让它弹回去。',
    fn(t, s){
      const out  = track(t, [[0,0],[.20,1]], eOut);
      const back = track(t, [[.78,0],[1,1]], eInOut);
      const pull = Math.max(0, out - back);
      /* 拽住以后左右晃两下，幅度衰减 —— 脸皮被扯着甩 */
      const wob = (t > .26 && t < .78)
        ? Math.sin((t - .26) * 34) * .085 * Math.exp(-(t - .26) * 1.15) : 0;
      /* 小球退开半步并往上抬 —— 脸露在下面，才看得见被扯出来的那个尖 */
      s.ax = lerp(s.ax0, s.bx - s.side * (RS * s.aEx + RB * s.bEx + .30), out);
      s.ay = lerp(CY, CY - 1.15, out);
      s.aDent = .06 * pull; s.aAng = s.side > 0 ? 0 : Math.PI;
      /* 从侧面脸颊（中线略偏下）往外扯，不是从头顶 */
      const faceAng = s.side > 0 ? Math.PI * 1.08 : -Math.PI * .08;
      const a = faceAng + wob * s.side;
      s.bDent = -.40 * pull; s.bAng = a; s.bSig = .38;
      s.bEx = 1 - .05 * pull; s.bEy = 1 + .035 * pull;
      const tipX = s.bx + Math.cos(a) * RB * (1 + .40 * pull);
      const tipY = s.by + Math.sin(a) * RB * (1 + .40 * pull);
      /* 手从「小球的左边」伸出来，兜一圈再从下面绕到脸颊上 ——
         不能从贴着大球的那侧（右侧）直接长，那样看着像手从两球缝里挤出来。 */
      s.hands = [{ who:s.sWho, x:tipX, y:tipY, r:.60, k:clamp01(pull * 1.4), front:true,
                   from:[s.ax - s.side * RS * .98, s.ay + RS * .26],
                   c:[s.ax + s.side * RS * .18, s.ay + RS * 1.42] }];
      /* 被扯出来的脸颊单独抬到小球上面那一层：扯到小球这侧时不能被小球盖掉 */
      s.cheek = { x:tipX, y:tipY, r: RB * (.30 + .22 * pull), k: clamp01(pull * 1.6) };
      if (pull > .85 && t < .48) s.fx.push({type:'star', x:tipX + s.side * .4, y:tipY - 1.2});
    }
  },
  {
    id:'lean', name:'依偎', dur:3600,
    desc:'真贴上去、挤进去一点，两边各压出一道明显的凹面；靠久了慢慢卸力，还是一直黏着。',
    fn(t, s){
      const inK   = track(t, [[0,0],[.20,1]], eOut);
      const press = track(t, [[.14,0],[.26,1],[.52,.94],[1,.86]], eInOut);
      /* 卸力：靠着靠着整个人松下来 —— 这次来得更早、更明显，
         挤压退回近一半、身体往下沉一大截，只剩很慢的呼吸起伏。 */
      const soft  = track(t, [[.32,0],[.72,1]], eOut);
      const breath = Math.sin((t - .32) * 4.4) * soft;
      const pr = press * (1 - .46 * soft);
      s.aEx = 1 - .20 * pr - .06 * soft + breath * .020; s.aEy = 1 + .19 * pr + .12 * soft + breath * .016;
      s.bEx = 1 - .17 * pr - .05 * soft + breath * .020; s.bEy = 1 + .16 * pr + .11 * soft + breath * .016;
      /* 按压扁后的实际半径贴近、重叠 .34 —— 真的挤在一起，中间不留缝 */
      s.ax = lerp(s.ax0, s.bx - s.side * (RS * s.aEx + RB * s.bEx - 1.30), inK);
      s.ay = lerp(CY, CY + .46, inK);
      s.aDent = .30 * pr; s.aAng = s.side > 0 ? 0 : Math.PI; s.aSig = .78;
      s.bDent = .28 * pr; s.bAng = s.side > 0 ? Math.PI : 0; s.bSig = .82;
      /* 靠久了像叹了口气：两颗一起往下沉，沉得比之前更实 */
      s.ay += .56 * soft + breath * .18; s.by = CY + .48 * soft + breath * .14;
      if (t > .28 && t < .9) s.fx.push({type:'heart', x:(s.ax + s.bx) / 2, y:CY - 4.6, t});
    }
  },
  {
    id:'nestle', name:'钻进怀里', dur:3400,
    desc:'小球压到大球身上、往下陷（在小球在上面），把大球压出一个软兜；大球身上留着小球的影子。',
    fn(t, s){
      const up   = track(t, [[0,0],[.26,1]], eOut);
      const sink = track(t, [[.16,0],[.46,1]], eInOut);
      const outK = track(t, [[.86,0],[1,1]], eInOut);
      const k = Math.max(0, sink - outK);
      /* 小球在**上面**：压在大球身上，不是沉到后面去 */
      s.ax = lerp(s.ax0, s.bx - s.side * RB * .40, k);
      s.ay = lerp(CY - .6 * up, s.by - RB * .64, k);
      const ang = Math.atan2(s.ay - s.by, s.ax - s.bx);
      /* 大球被压的地方深深凹进一个软兜 */
      s.bDent = .40 * k; s.bAng = ang; s.bSig = 1.30;
      s.bEx = 1 + .05 * k; s.bEy = 1 - .05 * k;
      /* 小球贴着的那面被压平、整体略扁 */
      s.aDent = .14 * k; s.aAng = ang + Math.PI; s.aSig = 1.10;
      s.aEx = 1 + .06 * k; s.aEy = 1 - .12 * k;   /* 陷进去的一侧被挤扁 */
      /* 影子落在大球身上（小球的下方偏内侧），压得越深影子越重 */
      /* 窝进去的地方：三层同心阴影叠出一个有深度的兜，外圈浅、中心深 */
      s.shade = { x: s.ax, y: s.ay + RS * .42,
                  rx: RS * .88, ry: RS * .40, o: .66 * k };
      s._lip = .78 * k;          /* 坑口那一圈隆起的亮边 */
      /* 窝着的时候轻轻起伏 */
      s.ay += Math.sin(t * 7.5) * .11 * k;
      if (t > .55 && t < .92) s.fx.push({type:'heart', x:s.ax + s.side * .5, y:s.ay - RS - 1.0, t});
    }
  },
  {
    id:'angry', name:'生气', dur:2600,
    desc:'气鼓鼓：原地憋气鼓起来、一涨一涨，气到发抖，头顶呼呼冒白气，💢 一下一下往上跳。',
    fn(t, s){
      const puff = track(t, [[0,0],[.12,1],[.30,.84],[.44,1],[.60,.86],[.76,1],[.90,.92],[1,0]], eInOut);
      const trem = Math.sin(t * 78) * .055 * puff;            /* 气到发抖 */
      s.ax = s.ax0 + trem;
      s.ay = CY + Math.sin(t * 26) * .09 * puff;
      /* 鼓起来：横着更鼓，顶上被气顶得微微凸 */
      s.aEx = 1 + .15 * puff; s.aEy = 1 + .11 * puff;
      s.aDent = -.09 * puff; s.aAng = -Math.PI / 2; s.aSig = 1.45;
      /* 大球被这股气顶得往后退一点 */
      s.bx = s.bx0 + s.side * .58 * puff;
      s.bDent = -.02 * puff; s.bAng = s.side > 0 ? Math.PI : 0; s.bSig = 1.2;
      s.bEx = 1 - .02 * puff; s.bEy = 1 + .03 * puff;
      /* 叉腰：小球两侧各长出一只手，手掌按在自己腰上，手肘向外撑开 ——
         一生气就架起来，配合鼓起来的身子，才像在「哼」。 */
      /* 架手的同时整个人往上一弹、再落回来：腾空时拉着长，落地后带两下余震 */
      const hopRaw = (t - .14) / .36;
      const bounce = (hopRaw > 0 && hopRaw < 1) ? Math.sin(Math.PI * hopRaw) : 0;
      const settle = hopRaw >= 1 ? Math.sin((hopRaw - 1) * 10) * Math.exp(-(hopRaw - 1) * 4.5) * .09 : 0;
      s.ay -= bounce * .70;                 /* 弹起来那一下 */
      s.ay += settle;                       /* 落地的小余震 */
      s.aEy += .07 * bounce;                /* 腾空时身体被拉长 */
      s.aEx -= .04 * bounce;                /* 横向略收，弹跳才有体积感 */
      const akimbo = clamp01((puff - .10) / .28);
      if (akimbo > .02){
        const hx = RS * s.aEx, hy = RS * s.aEy;
        /* 手臂必须「从上往下」伸：肩在球的上半侧 → 手肘远远撑到外面 → 手掌落回腰侧。
           这样肩、肘、手三点围出的才是一个朝外的三角形（人叉腰就是这个形状）。
           旧版根部放在球底，手臂从下往上兜 → 看着像从地里长出来的一只手。
           ⚠️ 二次贝塞尔的实际外凸只有控制点的一半：(肩 + 2*肘 + 手)/4，
              所以肘的控制点必须推到 2R 附近，手肘才真的突出球体轮廓线，
              否则曲线只是贴着球边画一道弧，看着像挂在球上的把手。 */
        /* 叉腰 = 一个三角形：手从球的**中上部**（不是头顶）伸出去，
           手肘支到球轮廓外面一点，手掌收回腰侧按在球上。
           肩、肘、手三点之间就空出一个朝外的三角形。 */
        s.hands = [
          { who:s.sWho, x:s.ax - hx * .86, y:s.ay + hy * .20, r:.48, k:akimbo, front:true,
            from:[s.ax - hx * .93, s.ay - hy * .24],
            elbow:[s.ax - hx * 1.33, s.ay + hy * .01] },
          { who:s.sWho, x:s.ax + hx * .86, y:s.ay + hy * .20, r:.48, k:akimbo, front:true,
            from:[s.ax + hx * .93, s.ay - hy * .24],
            elbow:[s.ax + hx * 1.33, s.ay + hy * .01] }
        ];
      }
      /* 💢 比之前大一号，跟着脉搏一跳一跳 */
      const beat = .82 + .18 * Math.sin(t * 26);
      if (puff > .2) s.fx.push({ type:'anger', x: s.ax + s.side * 1.55,
                                 y: CY - RS - 2.05 + Math.sin(t * 26) * .12, s: 2.5 * beat });
      /* 头顶冒白气：四团错开相位，一边升一边散 */
      if (puff > .18){
        for (let i = 0; i < 4; i++){
          const phd = (t * 1.7 + i * .25) % 1;
          s.fx.push({ type:'puff',
                      x: s.ax + s.side * (-.85 + i * .58) + Math.sin(phd * 5.5 + i) * .26,
                      y: CY - RS - .5 - phd * 3.4,
                      r: .26 + phd * .40,
                      o: (1 - phd) * .5 * puff });
        }
      }
    }
  },
  {
    id:'hold', name:'牵手', dur:3000,
    desc:'两颗球并排靠住，下面各伸出一只手，手掌在中间扣在一起，然后一起轻轻抬一下。',
    fn(t, s){
      const k    = track(t, [[0,0],[.26,1],[.86,1],[1,0]], eInOut);
      const lift = track(t, [[.50,0],[.62,1],[.80,0]], eInOut);
      s.ay = CY - .45 * lift;
      s.by = CY - .45 * lift;
      s.aDent = .07 * k; s.aAng = s.side > 0 ? 0 : Math.PI;
      s.bDent = .06 * k; s.bAng = s.side > 0 ? Math.PI : 0;
      s.aEx = 1 - .03 * k; s.aEy = 1 + .03 * k;
      s.bEx = 1 - .02 * k; s.bEy = 1 + .02 * k;
      s.ax = lerp(s.ax0, s.bx - s.side * (RS * s.aEx + RB * s.bEx - .12), k);
      /* 两球相接的那个点，手在它正下方 —— 手掌间距 .68，掌直径 1.56，真的扣在一起 */
      const hx = s.bx - s.side * RB * s.bEx;
      const hy = s.by + RS * 1.16;
      const show = clamp01((k - .12) / .34);
      s.hands = [
        { who:s.sWho, x:hx - s.side * .54, y:hy - .02, r:.70, k:show, front:true,
          from:[s.ax + s.side * RS * .40, s.ay + RS * .80] },
        { who:s.bWho, x:hx + s.side * .54, y:hy + .18, r:.70, k:show, front:true,
          from:[s.bx - s.side * RB * .40, s.by + RB * .84] }
      ];
      if (t > .55 && t < .82) s.fx.push({type:'heart', x:hx, y:CY - 4.8, t});
    }
  }
];

/* ============================================================
   2. 渲染
   ============================================================ */

let _uidSeq = 0;
window.__bmMakeCard = function __bmMakeCard(a, idx, card){
  /* 每条戳一戳消息都是独立的 SVG，clipPath 的 id 必须唯一，
     否则聊天里同时存在两条时会全部引用第一份裁切框（脸颊/阴影会串）。 */
  const uid = 'pa' + (++_uidSeq);
  card.innerHTML =
    '<div class="stage"><span class="hi"></span>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<defs><clipPath id="bc' + uid + '"><path/></clipPath>' +
          '<clipPath id="ck' + uid + '"><circle r="0"/></clipPath></defs>' +
        '<g class="armsB"></g>' +
        '<path class="big"/>' +
        /* 阴影必须裁在大球轮廓里，否则会像一块黑斑糊到背景上 */
        '<g clip-path="url(#bc' + uid + ')">' +
          '<ellipse class="shade"/><ellipse class="shade"/><ellipse class="shade"/>' +
          '<ellipse class="nestLip" opacity="0"/>' +
        '</g>' +
        '<path class="small"/>' +
        /* 嘟嘴：一颗跟球身同色的小圆，圆心压在球面上、只把外面那一小截露出来 ——
           露出来的就是一个圆鼓鼓的小包；同色无描边，看不出是拼上去的。 */
        '<ellipse class="pout" opacity="0"/>' +
        '<path class="poutseam" opacity="0"/>' +
        '<ellipse class="pout-hi" opacity="0"/>' +
        /* 被扯出来的脸颊单独一层，压在小球上面 —— 不然扯到小球那侧就被小球盖住了 */
        '<g clip-path="url(#ck' + uid + ')"><path class="cheek"/></g>' +
        '<g class="arms"></g>' +
        '<g class="fx"></g>' +
      '</svg>' +
    '</div>' +
    '<div class="name">' + a.name + '</div>' +
    '<div class="desc">' + a.desc + '</div>' +
    '<div class="replay" title="重播">↻</div>';
  grid.appendChild(card);

  const svg = card.querySelector('svg');
  return {
    anim: a,
    card,
    svg,
    big: svg.querySelector('.big'),
    small: svg.querySelector('.small'),
    shades: [...svg.querySelectorAll('.shade')],
    bigClip: svg.querySelector('#bc' + uid + ' path'),
    nestLip: svg.querySelector('.nestLip'),
    pout: svg.querySelector('.pout'),
    poutSeam: svg.querySelector('.poutseam'),
    poutHi: svg.querySelector('.pout-hi'),
    cheekG: svg.querySelector('.cheek'),
    cheekClip: svg.querySelector('#ck' + uid + ' circle'),
    arms: svg.querySelector('.arms'),
    armsB: svg.querySelector('.armsB'),
    fxG: svg.querySelector('.fx'),
    t0: performance.now() - Math.random() * 600,
    done: false
  };
}

function layout(c){
  /* 主动方＝小球。角色主动：紫小球在左、粉大球在右；玩家主动镜像 */
  const bigIsChar = initiator === 'player';
  const side = bigIsChar ? -1 : 1;      /* side = 大球在小球的哪一侧 */
  c.side = side;
  c.bx0 = side > 0 ? BIG_X : 7.45;
  c.ax0 = side > 0 ? SMALL_X : 24 - SMALL_X;
  c.bWho = bigIsChar ? 'char' : 'player';
  c.sWho = bigIsChar ? 'player' : 'char';
  /* 颜色跟身份走：紫＝角色、粉＝玩家。换主动方只镜像位置，球本身不变。 */
  const CHAR = '#a78bfa', PLAY = '#f3b7cd';
  const bC = bigIsChar ? CHAR : PLAY, sC = bigIsChar ? PLAY : CHAR;
  c.big.style.fill = bC;
  c.small.style.fill = sC;
  c.arms.innerHTML = '';
  c.armsB.innerHTML = '';
}

function render(c, t){
  const s = {
    ax: c.ax0, ay: CY, sr: RS,
    bx: c.bx0, by: CY,
    aDent: 0, aAng: 0, aSig: .85, bDent: 0, bAng: 0, bSig: .85,
    aEx: 1, aEy: 1, bEx: 1, bEy: 1,
    ax0: c.ax0, bx0: c.bx0, side: c.side,
    sWho: c.sWho, bWho: c.bWho, behind: false,
    hands: [], fx: []
  };
  c.anim.fn(t, s);

  /* 关键修正：blobD 里 dent 会把球在「朝向对方」的那一面压进去一截，
     而动作里的位置是按 r*ex 算的 —— 于是压得越狠、中间那条缝越宽，
     看起来就是「两颗球根本没贴在一起」。这里把两边的凹陷量补回去。 */
  {
    const A = RS * s.aEx, B = RB * s.bEx;
    const dx = s.bx - s.ax, dy = s.by - s.ay, L0 = Math.hypot(dx, dy) || 1;
    if (L0 < A + B + 1.05){
      const ux = dx / L0, uy = dy / L0;
      const fa = Math.cos(s.aAng - Math.atan2(uy, ux));
      const fb = Math.cos(s.bAng - Math.atan2(-uy, -ux));
      const ga = A * Math.max(0, fa) * Math.max(0, s.aDent);
      const gb = B * Math.max(0, fb) * Math.max(0, s.bDent);
      s.ax += ux * (ga + gb * .55);
      s.ay += uy * (ga + gb * .55);
    }
  }

  /* 小球压在大球身上时，在大球上投一块软影（影子夹在球和球之间，只盖大球） */
  const sh = s.shade;
  if (sh){
    /* 三层同心椭圆：外圈铺得开、中心压得深 —— 读起来是「陷进去一个坑」，不是贴了张黑纸 */
    c.shades.forEach((el, i) => {
      const f = 1 - i * .33;
      el.setAttribute('cx', sh.x.toFixed(2));
      el.setAttribute('cy', sh.y.toFixed(2));
      el.setAttribute('rx', (sh.rx * f).toFixed(2));
      el.setAttribute('ry', (sh.ry * f).toFixed(2));
      el.setAttribute('opacity', Math.max(0, Math.min(1, sh.o * (.55 + i * .34))).toFixed(2));
    });
    if (c.nestLip){
      c.nestLip.setAttribute('cx', sh.x.toFixed(2));
      c.nestLip.setAttribute('cy', (sh.y + sh.ry * .55).toFixed(2));
      c.nestLip.setAttribute('rx', (sh.rx * 1.16).toFixed(2));
      c.nestLip.setAttribute('ry', (sh.ry * .92).toFixed(2));
      c.nestLip.setAttribute('opacity', Math.min(1, (s._lip || 0)).toFixed(2));
    }
  } else {
    c.shades.forEach(el => el.setAttribute('opacity', '0'));
    if (c.nestLip) c.nestLip.setAttribute('opacity', '0');
  }

  const bigD = blobD(s.bx, s.by, RB, s.bAng, s.bDent, .015, s.bEx, s.bEy, s.bSig);
  c.big.setAttribute('d', bigD);
  if (c.bigClip) c.bigClip.setAttribute('d', bigD);
  c.small.setAttribute('d', blobD(s.ax, s.ay, s.sr, s.aAng, s.aDent, .012, s.aEx, s.aEy, s.aSig));
  /* 嘟嘴：凸出去的形状靠一颗跟球身同色的小圆 —— 圆心压在球面上（球内），
     只把外面那一小截露出来，所以是个圆鼓鼓的小包，不是尖的、也不会有脖子。
     再补一道很淡的唇缝，读起来才像抿着的嘴，而不是一颗小肉球。 */
  if (c.pout){
    const pt = s.pout;
    if (pt && pt.k > .02){
      const R = RS, k = pt.k;
      const rr = R * .40 * k;                    /* 凸包半径 —— 嘟出来的那一小团 */
      const h  = R * .30 * k;                    /* 露在球外的高度 */
      const d  = R + h - rr;                     /* 圆心距球心 —— 落在球内，融合得才顺 */
      const ux = Math.cos(pt.ang), uy = Math.sin(pt.ang);
      const tx = -uy, ty = ux;                   /* 沿轮廓的切向 */
      const p  = (v) => v.toFixed(2);
      const opn = Math.min(1, k * 2.4);
      const sw = rr * .40;                       /* 唇缝半长：短一点，别拉成一道划痕 */
      const cx0 = s.ax + ux * (R + h * .55), cy0 = s.ay + uy * (R + h * .55);

      if (!c._pf || c._pfSrc !== c.small.style.fill){
        c._pfSrc = c.small.style.fill;
        c._pf = c._pfSrc || getComputedStyle(c.small).fill;
      }
      const px = s.ax + ux * d, py = s.ay + uy * d;
      c.pout.setAttribute('fill', c._pf);
      c.pout.setAttribute('cx', p(px));
      c.pout.setAttribute('cy', p(py));
      c.pout.setAttribute('rx', p(rr));
      c.pout.setAttribute('ry', p(rr * 1.06));
      c.pout.setAttribute('transform',
        'rotate(' + (pt.ang * 180 / Math.PI).toFixed(1) + ' ' + p(px) + ' ' + p(py) + ')');
      c.pout.setAttribute('opacity', opn.toFixed(2));

      /* 唇缝：鼓包正中一道很短的浅弧，微微朝球心弯 —— 像抿着的嘴 */
      c.poutSeam.setAttribute('d',
        'M' + p(cx0 - tx * sw) + ' ' + p(cy0 - ty * sw) +
        'Q' + p(cx0 - ux * h * .55) + ' ' + p(cy0 - uy * h * .55) +
        ' ' + p(cx0 + tx * sw) + ' ' + p(cy0 + ty * sw));
      c.poutSeam.setAttribute('opacity', (opn * .76).toFixed(2));

      /* 高光：鼓包朝上那一小块，很淡，只够点出「这颗是圆的」 */
      const hx = s.ax + ux * (R + h * .70) - tx * sw * .72;
      const hy = s.ay + uy * (R + h * .70) - ty * sw * .72;
      c.poutHi.setAttribute('cx', p(hx));
      c.poutHi.setAttribute('cy', p(hy));
      c.poutHi.setAttribute('rx', (h * .40).toFixed(2));
      c.poutHi.setAttribute('ry', (h * .26).toFixed(2));
      c.poutHi.setAttribute('transform',
        'rotate(' + (pt.ang * 180 / Math.PI).toFixed(1) + ' ' + p(hx) + ' ' + p(hy) + ')');
      c.poutHi.setAttribute('opacity', (opn * .24).toFixed(2));
    } else {
      c.pout.setAttribute('opacity', '0');
      c.poutSeam.setAttribute('opacity', '0');
      c.poutHi.setAttribute('opacity', '0');
    }
  }
  /* 脸颊层：只有捏脸会用到 —— 把大球被扯出去的那一小块，裁一个小圆后重画在小球上方 */
  if (c.cheekG && c.cheekClip){
    const ck = s.cheek;
    if (ck && ck.k > .02){
      c.cheekG.setAttribute('d', bigD);
      c.cheekG.style.fill = c.big.style.fill;
      c.cheekClip.setAttribute('cx', ck.x.toFixed(2));
      c.cheekClip.setAttribute('cy', ck.y.toFixed(2));
      c.cheekClip.setAttribute('r', (ck.r * ck.k).toFixed(2));
    } else {
      c.cheekClip.setAttribute('r', '0');
    }
  }

  if (QS.has('hdbg') && c.anim.id === QS.get('only')){
    let e = document.getElementById('hdbg');
    if (!e){ e = document.createElement('pre'); e.id = 'hdbg'; document.body.appendChild(e); }
    e.textContent = 'H ' + c.anim.id + ' ' + JSON.stringify({ax:+s.ax.toFixed(2), ay:+s.ay.toFixed(2), bx:+s.bx.toFixed(2), by:+s.by.toFixed(2), side:s.side,
      hands:(s.hands||[]).map(h=>({who:h.who, from:h.from.map(v=>+v.toFixed(2)), to:[+h.x.toFixed(2), +h.y.toFixed(2)]}))});
  }
  /* 手：一条细臂 + 一颗圆手掌。手的颜色跟「谁的手」走 */
  c.arms.innerHTML = '';
  c.armsB.innerHTML = '';
  (s.hands || []).forEach(h => {
    if (h.k <= .01) return;
    const ex = lerp(h.from[0], h.x, h.k), ey = lerp(h.from[1], h.y, h.k);
    /* 控制点：给了 c 就用它（手臂环着对方走弧线），否则按中点偏一点 */
    const cx = h.c ? lerp(h.from[0], h.c[0], h.k) : (h.from[0] + ex) / 2 - (h.bend || 0) * .5;
    const cy = h.c ? lerp(h.from[1], h.c[1], h.k) : (h.from[1] + ey) / 2 + Math.abs(h.bend || 0) * .4;
    const p = document.createElementNS(NS, 'path');
    /* h.elbow：上臂 + 前臂两段折线 —— 叉腰必须靠这个拐角，
       一条二次曲线永远是圆滑的弧，出不来「手肘支出去、中间空一个三角形」的样子。 */
    let dpath;
    if (h.elbow){
      const mx = lerp(h.from[0], h.elbow[0], h.k), my = lerp(h.from[1], h.elbow[1], h.k);
      dpath = 'M' + h.from[0].toFixed(2) + ' ' + h.from[1].toFixed(2) +
              ' L' + mx.toFixed(2) + ' ' + my.toFixed(2) +
              ' L' + ex.toFixed(2) + ' ' + ey.toFixed(2);
    } else {
      dpath = 'M' + h.from[0].toFixed(2) + ' ' + h.from[1].toFixed(2) +
              ' Q' + cx.toFixed(2) + ' ' + cy.toFixed(2) + ' ' + ex.toFixed(2) + ' ' + ey.toFixed(2);
    }
    p.setAttribute('d', dpath);
    p.setAttribute('class', 'arm ' + (h.who === 'char' ? 'purple' : 'pink'));
    p.setAttribute('opacity', Math.min(1, h.k * 1.4).toFixed(2));
    /* 手臂默认画在球的后层：从背后绕过去，被对方挡住，只留手掌在外面。
       h.front = 手是从球外围绕过去的（摸头、捏脸、牵手），要看得见手臂，画在前层。 */
    (h.front ? c.arms : c.armsB).appendChild(p);

    const hp = document.createElementNS(NS, 'path');
    hp.setAttribute('d', handPath(ex, ey, h.r));
    hp.setAttribute('class', 'hand ' + (h.who === 'char' ? 'purple' : 'pink'));
    hp.setAttribute('opacity', Math.min(1, h.k * 1.4).toFixed(2));
    c.arms.appendChild(hp);
  });

  /* 小特效 */
  c.fxG.innerHTML = '';
  if (QS.has('nofx')) return;   /* 调试：?nofx=1 关掉爱心/闪光，好看清形体本身 */
  (s.fx || []).forEach(f => {
    if (f.type === 'heart'){
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M0 2.2C-2.6 .6-2.9 -1.3-1.8 -2.1-.7 -2.9 .1 -2.2 0 -1.6.1 -2.2 .9 -2.9 2 -2.1 3.1 -1.3 2.6 .6 0 2.2Z');
      p.setAttribute('class', 'hrt');
      p.setAttribute('transform', 'translate(' + f.x.toFixed(2) + ' ' + f.y.toFixed(2) + ') scale(' +
        (f.s != null ? f.s : .62).toFixed(2) + ')');
      p.setAttribute('opacity', (f.o != null ? f.o : (.55 + Math.sin(t * 18) * .25)).toFixed(2));
      c.fxG.appendChild(p);
    } else if (f.type === 'star'){
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M0 -1.3Q0 0 1.3 0Q0 0 0 1.3Q0 0 -1.3 0Q0 0 0 -1.3Z');
      p.setAttribute('class', 'star');
      p.setAttribute('transform', 'translate(' + f.x.toFixed(2) + ' ' + f.y.toFixed(2) + ')' +
        (f.s != null ? ' scale(' + f.s.toFixed(2) + ')' : ''));
      c.fxG.appendChild(p);
    } else if (f.type === 'puff'){
      /* 生气时头顶呼呼冒的白气：一团一团往上升、边走边散 */
      const c2 = document.createElementNS(NS, 'circle');
      c2.setAttribute('cx', f.x.toFixed(2));
      c2.setAttribute('cy', f.y.toFixed(2));
      c2.setAttribute('r', f.r.toFixed(2));
      c2.setAttribute('class', 'puff');
      c2.setAttribute('opacity', Math.max(0, f.o).toFixed(2));
      c.fxG.appendChild(c2);
    } else if (f.type === 'anger'){
      /* 💢：四笔交叉成一个「井」，漫画里最直接的怒气符号（比原来的小钩好认） */
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform',
        'translate(' + f.x.toFixed(2) + ' ' + f.y.toFixed(2) + ') rotate(-12) scale(' + (f.s || 1) + ')');
      const L = .60, gap = .25;
      [[-gap,-L,-gap,L],[gap,-L,gap,L],[-L,-gap,L,-gap],[-L,gap,L,gap]].forEach(v => {
        const p2 = document.createElementNS(NS, 'path');
        p2.setAttribute('d', 'M' + v[0] + ' ' + v[1] + 'L' + v[2] + ' ' + v[3]);
        p2.setAttribute('class', 'anger');
        g.appendChild(p2);
      });
      c.fxG.appendChild(g);
    }
  });
}

/* ============================================================
/* ----------------------------------------------------------------------------
   挂载：主项目调用入口
   host —— 聊天里那个 .poke-fx 容器（30px 见方）
   id   —— ANIMS 里的动作 id
   side —— 1：大球在右、小球在左（角色戳玩家，对应原动画 dir='L'）
           -1：大球在左、小球在右（玩家戳角色，对应原动画 dir='R'）
   ---------------------------------------------------------------------------- */
let grid = null;
let initiator = 'char';

window.bmPokePlay = function(host, id, side, atT){
  const anim = ANIMS.find(a => a.id === id) || ANIMS[0];
  /* 大球在哪一侧决定镜像：预览里 side>0 = 大球在右（角色主动那颗在左） */
  initiator = side > 0 ? 'char' : 'player';

  const box = document.createElement('div');
  grid = box;
  const c = (function(){
    const card = document.createElement('div');
    card.className = 'card';
    /* 这里直接复用原预览的 makeCard：它把结构写进 card，我们把 svg 取出来搬走 */
    return window.__bmMakeCard(anim, 0, card);
  })();

  host.innerHTML = '';
  host.appendChild(c.svg);

  /* 坐标对齐主项目 pokeFxHtml：BIG_X 16.55→16.4 / SMALL_X 5.55→4.2，
     另一侧镜像位 7.45→7.6 / 18.45→19.8。差 0.15~1.35 个单位，
     在 30px 的容器里是 1~2px，但「跟聊天里那两颗球一模一样」得卡死。 */
  if (c.side > 0){ c.bx0 = 16.4; c.ax0 = 4.2; }
  else { c.bx0 = 7.6; c.ax0 = 19.8; }
  layout(c);

  /* 调试用：传第 4 个参数（0~1）就只渲染那一帧并停住，方便截图核对形体 */
  if (typeof atT === 'number'){
    render(c, Math.max(0, Math.min(1, atT)));
    return { stop(){} };
  }

  if (c._raf) cancelAnimationFrame(c._raf);
  const t0 = performance.now();
  const DUR = anim.dur || 3000;
  let raf = 0;
  const step = (now) => {
    const t = Math.min(1, (now - t0) / DUR);
    render(c, t);
    if (t < 1) raf = requestAnimationFrame(step);
    else { /* 停在最后一帧（动作自己会回到静止位） */ }
  };
  raf = requestAnimationFrame(step);
  c._raf = raf;
  return { stop(){ if (raf) cancelAnimationFrame(raf); } };
};

window.BM_POKE_ANIMS = ANIMS.map(a => ({ id: a.id, name: a.name, dur: a.dur }));

})();
