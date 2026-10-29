/* ============================================================
 * 白日梦 · 入梦签节日动画引擎（dream-fx）
 * 从「节日动画样品.html」提取，纯 Canvas 自包含、无 ES module。
 * 对外暴露：
 *   - BgAudio         背景白噪音播放器（循环 + 交叉淡化）
 *   - FX_AUDIO        动画类型 -> 音频文件名 映射
 *   - FXWIND/FXBURSTS 风场 / 烟花交互状态
 *   - newBurstGlobal  全局烟花生成
 *   - stopFx()/runFx(kind, canvas)  动画启停
 *   - ChimeAudio      寒露露珠叮铃声
 * 依赖：window.devicePixelRatio / requestAnimationFrame / Audio
 * 20261028 接入入梦签用。
 * ============================================================ */
(function(global){
'use strict';

const BgAudio = (function(){
  let audio = null;      // 当前主音频
  let fading = null;     // 正在淡出的旧音频（交叉淡化用）
  let session = 0, fadeTimer = null, fadeTimer2 = null;
  /* 硬停单个 audio（不淡出） */
  function pause(a){ if (a){ try { a.pause(); } catch(e){} } }
  function clearTimers(){ if (fadeTimer){ clearInterval(fadeTimer); fadeTimer = null; } if (fadeTimer2){ clearInterval(fadeTimer2); fadeTimer2 = null; } }
  /* 播放指定真实录音：交叉淡化（旧音淡出 + 新音淡入，无缝衔接） */
  function play(file, vol){
    vol = (vol == null) ? 1.0 : Math.min(1.0, Math.max(0, vol));
    const mySession = ++session;
    // 若当前无音频，直接播新音（无交叉）
    if (!audio){
      audio = new Audio('audio/' + file);
      audio.loop = true;
      audio.volume = 0.0001;
      audio.play().catch(()=>{});
      fadeIn(audio, vol, 1200, mySession);
      return;
    }
    // 有旧音：旧音淡出，新音淡入（交叉淡化）
    const old = audio;
    fading = old;
    const fresh = new Audio('audio/' + file);
    fresh.loop = true;
    fresh.volume = 0.0001;
    fresh.play().catch(()=>{});
    audio = fresh;
    fadeIn(fresh, vol, 1200, mySession);
    fadeOut(old, 900, mySession);
  }
  /* 淡出并停止（签卡关闭时调用） */
  function stop(){
    if (!audio){ return; }
    const mySession = session;
    fadeOut(audio, 800, mySession);
    audio = null;
  }
  /* 淡入到目标音量 */
  function fadeIn(a, target, ms, mySession){
    if (fadeTimer){ clearInterval(fadeTimer); fadeTimer = null; }
    const startVol = a.volume, start = performance.now();
    fadeTimer = setInterval(() => {
      if (mySession !== session){ clearInterval(fadeTimer); fadeTimer = null; return; }
      const el = (performance.now() - start) / ms;
      if (el >= 1){ clearInterval(fadeTimer); fadeTimer = null; a.volume = target; return; }
      a.volume = Math.max(0.0001, Math.min(1.0, startVol + (target - startVol) * el));
    }, 30);
  }
  /* 淡出到 0 并暂停 */
  function fadeOut(a, ms, mySession){
    if (fadeTimer2){ clearInterval(fadeTimer2); fadeTimer2 = null; }
    const startVol = a.volume, start = performance.now();
    fadeTimer2 = setInterval(() => {
      if (mySession !== session){ clearInterval(fadeTimer2); fadeTimer2 = null; pause(a); return; }
      const el = (performance.now() - start) / ms;
      if (el >= 1){ clearInterval(fadeTimer2); fadeTimer2 = null; pause(a); return; }
      a.volume = Math.max(0.0001, startVol * (1 - el));
    }, 30);
  }
  return { play, stop, get current(){ return audio; } };
})();
const FXWIND = { vx:0, vy:0, life:0, streak:[], cx:0, radius:0, strength:1 };   // 滑动风场（strength=风力强度）
const FXBURSTS = [];                                 // 点击烟花待注入的 burst
let _dewPts = [];                                    // 寒露露珠屏幕坐标（归一化 0~1，供鼠标滑过检测）
let _dewLastPlay = 0;                                // 叮铃声防抖时间戳
let _mousePt = { x: 0.5, y: 0.5 };                   // 鼠标在 stage 内的归一化位置（供露珠跟随晃动）
/* 叮铃声播放器（寒露露珠拨动：清脆水晶/玻璃碰撞短音效，非循环）。
   20261028 根因修复（真正根因）：
   —— 之前误改成 WebAudio AudioContext 合成音，但 AudioContext 在无手势时是 suspended，
      且 resume() 是异步的；play() 里用同步 state 判断，导致每次拨动都命中 suspended
      分支直接 return，一个音都不发 →「滑到露珠却听不到声音」。
   —— 白噪音(BgAudio)之所以正常，是因为它用 HTMLAudioElement(new Audio().play())，
      不受 AudioContext 状态影响。故此处同样改回 HTMLAudio 播放，与白噪音同链路，
      只要页面有过一次用户交互（开屏点击）就能正常响。 */
const ChimeAudio = (function(){
  let el = null;
  function ensure(){
    if (!el) { el = new Audio('audio/glasses_clinking.ogg'); el.preload = 'auto'; el.loop = false; }
    return el;
  }
  /* 首次用户交互时预加载/预解锁（在玩家第一次点击网站时调用一次即可） */
  function unlock(){
    const a = ensure();
    try { a.load(); } catch(e) {}
  }
  /* 拨动露珠 → 清脆水晶声（快速起音、无循环） */
  function play(){
    const a = ensure();
    try {
      try { a.currentTime = 0; } catch(e) {}
      a.volume = 0.7;
      const p = a.play();
      if (p && p.then) p.catch(()=>{});
    } catch(e) {}
  }
  return { play, unlock };
})();
function newBurstGlobal(x, y, fxKind){
  const arr = [];
  const R = Math.random, TAU = Math.PI*2, dpr = window.devicePixelRatio || 1;
  const hue = (fxKind === 'national') ? (R() < 0.55 ? R()*14 : 32 + R()*18) : 25 + R()*40;
  const n = 36;
  for (let i=0;i<n;i++){ const a = TAU*i/n, v = (1.4+R()*1.6)*dpr; arr.push({x, y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, life:1, hue:hue+R()*20-10}); }
  return { burst:arr };
}
/* 惊蛰点击落雷：立即落雷信号（画布坐标），thunder 每帧检测到就立刻出一雷 */
const FXSTRIKE_NOW = { x: 0, y: 0, hit: false };
function strikeBoltGlobal(x, y){
  // 立即落雷：直接置位，thunder 每帧检测到就立刻出一雷（不等 next 到期）
  FXSTRIKE_NOW.x = x; FXSTRIKE_NOW.y = y; FXSTRIKE_NOW.hit = true;
}
const FX_AUDIO = {
  firework:'firework_1689.ogg', national:'firework_1689.ogg',       // 烟花类 → 烟花多响连爆
  lantern:null, candle:'fire_campfire_crackles.ogg',                 // 元宵花灯 → 静音；烛火 → 篝火噼啪
  rainripple:'rain_splashing.ogg', plumrain:'rain_splashing.ogg',    // 雨类 → 雨水溅落哗啦
  apricot:'rain_splashing.ogg', pear:'rain_splashing.ogg',           // 清明雨
  thunder:'thunder_big_rumble.ogg',                                  // 惊蛰 → 惊雷轰隆
  firefly:'night_crickets_loop.ogg',                                 // 立夏 → 夏夜虫鸣（流萤）
  snow:'snow_winter_wind.ogg', heavysnow:'snow_winter_wind.ogg', icecrystal:['snow_winter_wind.ogg', 0.35],// 大雪/大寒 雪类（大寒音量调小）
  lightsnow:null,                                                    // 小雪 → 静音（初雪将至，不配冬风）
  leaves:'leaves_breeze_2427.ogg', leaf:'leaves_breeze_2427.ogg', frost:'leaves_breeze_2427.ogg', geese:'glasses_clinking.ogg',// 秋风/落叶类；寒露 → 酒杯碰撞音
  moon:null, stars:null, sunburst:null,                              // 中秋/七夕/夏至 → 静音
  heatwave:'summer_cicada_heat.ogg',                                // 大暑 → 夏日蝉鸣热浪腾腾
  wave:'water_flowing_ambience.ogg', riverlamp:'water_flowing_ambience.ogg', dew:'rain_splashing.ogg',// 端午/处暑 → 流水潺潺；白露 → 雨
  flag:'water_flowing_ambience.ogg', tea:'leaves_breeze_2427.ogg', osmanthus:'leaves_breeze_2427.ogg', chrysanth:'leaves_breeze_2427.ogg',// 国庆 → 流水潺潺；草木类
  wheat:null, swallows:null, sprout:null, lotus:['leaves_breeze_2427.ogg', 0.35],  // 小满/春分/立春 → 静音；小暑 → 风声(低音量)
  plum:null, hearth:'fire_campfire_crackles.ogg', warmwindow:'fire_campfire_crackles.ogg',// 冬至红梅 → 静音；小寒 → 篝火；立冬 → 燃烧
  balloon:null, choco:null, peony:'rain_splashing.ogg',              // 六一/白色情人节 → 静音
  default:'leaves_breeze_2427.ogg',
};
let _raf = null, _fxTimer = null;
function stopFx(){ if (_raf) cancelAnimationFrame(_raf); _raf = null; if (_fxTimer) { clearInterval(_fxTimer); _fxTimer = null; } }
function runFx(kind, canvas) {
  stopFx();
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const R = Math.random, TAU = Math.PI * 2;
  const S = devicePixelRatio;
  let parts = [];
  let extra = [];
  const init = {
    firework(){ parts = []; for (let i=0;i<3;i++) parts.push(newBurst(W*(0.25+0.25*i)+R()*40, H*(0.22+R()*0.15))); _fxTimer = setInterval(()=>{ if(_raf!==null) parts.push(newBurst(W*(0.2+R()*0.6), H*(0.15+R()*0.3))); }, 1400); },
    national(){ parts = []; for (let i=0;i<3;i++) parts.push(newBurst(W*(0.25+0.25*i)+R()*40, H*(0.22+R()*0.15))); _fxTimer = setInterval(()=>{ if(_raf!==null) parts.push(newBurst(W*(0.2+R()*0.6), H*(0.15+R()*0.3))); }, 1300); },
    lantern(){ parts = []; for (let i=0;i<7;i++) parts.push({x:R()*W, y:H+R()*H*0.5, s:20+R()*26, v:0.4+R()*0.7, sw:R()*TAU}); },
    candle(){ parts = []; for (let i=0;i<6;i++) parts.push({x:R()*W, y:H+R()*H*0.6, s:18+R()*20, v:0.3+R()*0.5, sw:R()*TAU}); },
    /* 雨水：细雨 + 底部水面涟漪 */
    rainripple(){ parts = []; for (let i=0;i<55;i++) parts.push({x:R()*W, y:R()*H, v:2.2+R()*2.5, l:7+R()*11}); extra = { ripples:[] }; },
    /* 春分：双燕绕飞 + 柳絮白点 */
    swallows(){ parts = []; for (let i=0;i<22;i++) parts.push({x:R()*W, y:R()*H*0.8, r:0.8+R()*1.4, v:0.25+R()*0.4, tw:R()*TAU}); extra = [ {y:H*0.22, ph:0, sp:0.9, amp:H*0.05, s:26}, {y:H*0.38, ph:2.4, sp:0.75, amp:H*0.06, s:21}, {y:H*0.15, ph:4.6, sp:1.05, amp:H*0.04, s:18} ]; },
    /* 清明（节气/节日共用）：杏花微雨——大雨丝为主 + 少量花瓣 */
    apricot(){ parts = []; for (let i=0;i<14;i++) parts.push({x:R()*W, y:R()*-H, s:4+R()*6, v:0.5+R()*0.6, sw:R()*TAU, rot:R()*TAU, ph:R()*TAU});
      extra = { rain:[], ripples:[] };
      for (let i=0;i<60;i++) extra.rain.push({x:R()*W, y:R()*H, v:3.4+R()*2.2, l:12+R()*12}); },
    /* 谷雨：大朵牡丹花瓣缓落 */
    peony(){ parts = []; for (let i=0;i<12;i++) parts.push({x:R()*W, y:R()*-H, s:9+R()*10, v:0.35+R()*0.5, sw:R()*TAU, rot:R()*TAU, hue:335+R()*25}); },
    /* 小满：金色麦浪 + 麦穗光点 */
    wheat(){ parts = []; for (let i=0;i<14;i++) parts.push({x:R()*W, y:H*0.55+R()*H*0.4, tw:R()*TAU, v:0.01+R()*0.02}); },
    /* 芒种：青梅细雨 + 青梅果 */
    plumrain(){ parts = []; for (let i=0;i<45;i++) parts.push({x:R()*W, y:R()*H, v:2.2+R()*2.4, l:7+R()*10}); extra = []; for (let i=0;i<6;i++) extra.push({x:R()*W, y:R()*-H, s:5+R()*4, v:0.4+R()*0.5, sw:R()*TAU, rot:R()*TAU}); },
    /* 夏至：白日太阳 + 放射光芒 + 光尘 */
    sunburst(){ parts = []; for (let i=0;i<26;i++) parts.push({x:R()*W, y:R()*H, r:0.8+R()*1.6, tw:R()*TAU, v:0.015+R()*0.03}); },
    /* 小暑：荷塘——荷叶荷花剪影 + 涟漪 + 蜻蜓（装饰锚定在寄语与按钮之间的留白带） */
    lotus(){ parts = []; extra = { ripples:[], dragonfly:{t:0} };
      extra.lily = Array.from({length:4},(_,i)=>({x:W*(0.12+0.25*i)+(R()-0.5)*20, y:H*(0.70+R()*0.09), r:(18+R()*14)*S}));
      extra.flower = { x:W*0.62, y:H*0.70, s:14*S };
    },
    /* 大暑：橙黄热浪光晕升腾 */
    heatwave(){ parts = []; for (let i=0;i<16;i++) parts.push({x:R()*W, y:H+R()*H, r:(20+R()*36)*S, v:0.35+R()*0.55, a:0.10+R()*0.14}); },
    /* 立秋：落叶 */
    leaf(){ parts = []; for (let i=0;i<22;i++) parts.push({x:R()*W, y:R()*-H, s:6+R()*9, v:0.5+R()*0.8, sw:R()*TAU, rot:R()*TAU, rv:(R()-0.5)*0.06}); },
    /* 处暑：河灯漂过水面 */
    riverlamp(){ parts = []; for (let i=0;i<6;i++) parts.push({x:-R()*W*0.4, y:H*(0.68+R()*0.10), s:9+R()*7, v:0.3+R()*0.35, bob:R()*TAU}); },
    /* 白露：草叶大露珠 + 微光尘 */
    dew(){ parts = []; for (let i=0;i<24;i++) parts.push({x:R()*W, y:R()*H, r:0.7+R()*1.3, tw:R()*TAU, v:0.01+R()*0.025});
      extra = Array.from({length:5},(_,i)=>({x:W*(0.14+0.18*i)+(R()-0.5)*14, y:H*(0.70+R()*0.08), r:(4+R()*4)*S, ph:R()*TAU})); },
    /* 秋分：圆月 + 桂花花瓣飘落（金色四瓣花瓣，不要枝条、不要点点） */
    osmanthus(){ parts = []; for (let i=0;i<30;i++) parts.push({x:R()*W, y:R()*-H, r:(3.2+R()*3.4)*S, v:0.45+R()*0.6, sw:R()*TAU, rot:R()*TAU, spin:0.3+R()*0.4, tw:R()*TAU});
      extra = {};
    },
    /* 寒露：人字雁阵 + 淡月 */
    /* 寒露：草尖露珠（晶莹剔透、折射光）+ 鸿雁南飞（一候鸿雁来宾），去月亮 */
    geese(){ parts = []; extra = { prog:0, dews:[] };
      // 草叶尖上的露珠：底部草丛，每根草尖一颗晶莹露珠
      for (let i=0;i<14;i++){
        extra.dews.push({
          x: W*(0.04 + 0.07*i) + (R()-0.5)*6*S,
          grassH: (26 + R()*30)*S,
          r: (2.2 + R()*2.6)*S,
          lean: (R()-0.5)*0.3,
          ph: R()*TAU,
          // 20261028：草叶摆动——swayPh 相位 / swaySp 速度（每根草略有差异，像真实随风起伏）
          swayPh: R()*TAU,
          swaySp: 0.8 + R()*0.9,
        });
      }
    },
    /* 清明（节气）：梨花花瓣慢慢飘落 + 下方水面泛涟漪 + 微雨（去枝条、去高速旋转梨花） */
    pear(){ parts = []; for (let i=0;i<40;i++) parts.push({x:R()*W, y:R()*-H, v:0.9+R()*0.9, sw:R()*TAU, rot:R()*TAU, spin:0.15+R()*0.2, r:(4.5+R()*3.5)*S, water:0, landed:false, fadeIn:0});
      extra = { rain:[], ripples:[] };
      // 雨丝（斜落，明显）
      for (let i=0;i<48;i++) extra.rain.push({x:R()*W, y:R()*H, v:2.6+R()*2.6, l:12+R()*14});
    },
    /* 霜降：六角霜花浮现 + 红叶 */
    frost(){ parts = []; for (let i=0;i<9;i++) parts.push({x:W*(0.1+R()*0.8), y:H*(0.1+R()*0.7), r:(6+R()*10)*S, ph:R()*3, tw:R()*TAU});
      extra = []; for (let i=0;i<14;i++) extra.push({x:R()*W, y:R()*-H, s:6+R()*8, v:0.45+R()*0.6, sw:R()*TAU, rot:R()*TAU, rv:(R()-0.5)*0.06}); },
    /* 立冬：暖窗 + 稀疏雪 */
    warmwindow(){ parts = []; for (let i=0;i<24;i++) parts.push({x:R()*W, y:R()*H, r:0.8+R()*1.6, v:0.4+R()*0.6, sw:R()*TAU}); extra = { wx:W*0.5, wy:H*0.62, ww:74*S, wh:56*S }; },
    /* 小雪：细疏雪粒 */
    lightsnow(){ parts = []; for (let i=0;i<34;i++) parts.push({x:R()*W, y:R()*H, r:0.7+R()*1.5, v:0.35+R()*0.55, sw:R()*TAU}); },
    /* 大雪：鹅毛大片雪花（六角） */
    heavysnow(){ parts = []; for (let i=0;i<40;i++) parts.push({x:R()*W, y:R()*H, r:2.2+R()*3.4, v:0.4+R()*0.7, sw:R()*TAU, rot:R()*TAU, rv:(R()-0.5)*0.04}); },
    /* 冬至：梅枝 + 梅瓣飘落 */
    plum(){ parts = []; for (let i=0;i<18;i++) parts.push({x:R()*W, y:R()*-H, s:4+R()*6, v:0.35+R()*0.55, sw:R()*TAU, rot:R()*TAU});
      // 红梅枝条：短小一枝，从右边框伸入，贴右上角；花蕾沿枝分布
      // 花朵位置用相对坐标在 init 时一次性随机固定，渲染时不再每帧随机 → 消除高频颤动
      extra = { bx:W*0.86, by:H*0.24, buds:Array.from({length:7},()=>({bx:R(), by:R(), r:(1.6+R()*2.2)*S})) };
    },
    /* 小寒：炭炉暖光 + 火星 + 少量雪（炉盆+炉栅+炭火，不再是大椭圆） */
    hearth(){ parts = []; for (let i=0;i<14;i++) parts.push({x:W*0.5+(R()-0.5)*30*S, y:H*0.69, r:0.7+R()*1.3, v:0.4+R()*0.7, tw:R()*TAU, drift:R()*TAU});
      extra = []; for (let i=0;i<12;i++) extra.push({x:R()*W, y:R()*H, r:0.7+R()*1.3, v:0.3+R()*0.5, sw:R()*TAU}); },
    /* 谷雨：采茶——茶叶飘落（去茶树，只留飘落的嫩茶叶 + 微雨） */
    tea(){ parts = []; for (let i=0;i<18;i++) parts.push({x:R()*W, y:R()*-H, s:8+R()*9, v:0.35+R()*0.5, sw:R()*TAU, rot:R()*TAU, hue:105+R()*25});
      extra = { rain:[] };
      // 微雨丝（谷雨时节润物细无声）
      for (let i=0;i<30;i++) extra.rain.push({x:R()*W, y:R()*H, v:2.2+R()*2.2, l:9+R()*10});
    },
    /* 国庆：山河——远山层叠 + 蜿蜒河流 + 金色光点（去红旗） */
    flag(){ parts = []; for (let i=0;i<26;i++) parts.push({x:R()*W, y:R()*H, r:0.8+R()*1.5, tw:R()*TAU, v:0.02+R()*0.03});
      extra = { river:null, ripples:[], sparkles:[] };
      // 河流蜿蜒曲线（预生成控制点，保证稳定；上移避开底部按钮，河流主体露在按钮上方）
      const pts = []; for (let i=0;i<=10;i++) pts.push({ x:W*(i/10), y:H*0.66 + Math.sin(i*0.9)*H*0.06 });
      extra.river = pts;
      // 预生成固定波纹短线（沿河流曲线，不每帧随机，避免频闪）
      for (let i=0;i<12;i++){
        const pi = pts[1 + (i % (pts.length-2))];
        const gy = pi.y + 12*S + Math.sin(i*1.7)*4*S;
        extra.ripples.push({ pi: 1 + (i % (pts.length-2)), off: 12*S + Math.sin(i*1.7)*4*S, ln: (6+(i%7))*S, ph: i*0.9, sp: 0.6 + (i%4)*0.2 });
      }
      // 预生成固定闪烁光斑（沿河流，缓慢明灭，不频闪）
      for (let i=0;i<8;i++){
        const pi = pts[1 + (i % (pts.length-2))];
        extra.sparkles.push({ pi: 1 + (i % (pts.length-2)), dx: ((i%5)-2)*4*S, off: 14*S + Math.sin(i*2.3)*3*S, r: (1.2+(i%3)*0.8)*S, ph: i*1.3, sp: 0.5+(i%3)*0.3 });
      }
    },
    /* 大寒：冰蓝晶霜星光 */
    icecrystal(){ parts = []; for (let i=0;i<26;i++) parts.push({x:R()*W, y:R()*H, r:(1.4+R()*2.6)*S, tw:R()*TAU, v:0.008+R()*0.02, sp:R()<0.4}); },
    /* 惊蛰：雷雨闪电 */
    thunder(){ parts = []; for (let i=0;i<70;i++) parts.push({x:R()*W, y:R()*H, v:2.5+R()*3, l:8+R()*14}); extra = { flash:0, next:1.0, bolt:null }; },
    /* 立夏：萤火虫（全屏分散星星点点漂浮，明灭闪烁） */
    firefly(){ parts = []; for (let i=0;i<46;i++) parts.push({x:R()*W, y:R()*H, dx:(R()-0.5)*26, dy:(R()-0.5)*18, tw:R()*TAU, tv:0.5+R()*1.1, r:(1+R()*1.8), warm:R()<0.72}); extra = []; },
    /* 立春：嫩芽 + 荧光点 */
    sprout(){
      parts = []; for (let i=0;i<16;i++) parts.push({x:R()*W, y:H*0.3+R()*H*0.55, v:0.15+R()*0.3, tw:R()*TAU, r:1+R()*1.6});
      extra = Array.from({length:7},(_,i)=>({
        x: W*(0.10 + 0.135*i) + (R()-0.5)*W*0.04,
        seed: (i*37)%23, lean: Math.sin(i*1.7)*0.3,
        shade: 120 + (i*13)%40, w: 2.2 + (i%3), ph: (i%4)*0.08
      }));
    },
    /* 端午：水波 */
    wave(){ parts = []; },
    /* 儿童节：气球 */
    balloon(){ parts = []; for (let i=0;i<9;i++) parts.push({x:R()*W, y:H+R()*H*0.6, s:16+R()*18, v:0.5+R()*0.8, sw:R()*TAU, c:`hsl(${330+R()*60},70%,${72+R()*12}%)`}); },
    /* 重阳：秋菊绽放 */
    chrysanth(){ parts = []; for (let i=0;i<8;i++) parts.push({x:W*(0.12+R()*0.76), y:H*(0.2+R()*0.6), r:(7+R()*9)*S, ph:R()*3, petals:9+((i%3)*2), hue:38+R()*14});
      extra = []; for (let i=0;i<8;i++) extra.push({x:R()*W, y:R()*-H, s:5+R()*7, v:0.4+R()*0.6, sw:R()*TAU, rot:R()*TAU, rv:(R()-0.5)*0.06}); },
    /* 白色情人节：包装巧克力 + 缎带糖果 + 白羽毛 */
    choco(){ parts = []; const wraps=['#e8a0b4','#a0c4e8','#c0aee8','#f0c98a','#a8d8c0'];
      for (let i=0;i<14;i++) parts.push({x:R()*W, y:R()*-H, s:7+R()*8, v:0.4+R()*0.6, sw:R()*TAU, rot:R()*TAU, rv:(R()-0.5)*0.05, kind:'choco', c:wraps[i%wraps.length]});
      for (let i=0;i<8;i++) parts.push({x:R()*W, y:R()*-H, s:5+R()*5, v:0.45+R()*0.55, sw:R()*TAU, rot:R()*TAU, rv:(R()-0.5)*0.045, kind:'candy', c:wraps[(i+2)%wraps.length]});
      for (let i=0;i<5;i++) parts.push({x:R()*W, y:R()*-H, s:5+R()*6, v:0.35+R()*0.5, sw:R()*TAU, rot:R()*TAU, rv:(R()-0.5)*0.03, kind:'feather', c:''}); },
  }[kind] || (()=>{});
  init();

  function newBurst(x, y){
    const arr = [];
    const hue = (kind === 'national') ? (R() < 0.55 ? R()*14 : 32 + R()*18) : 25 + R()*40;
    const n = 36;
    for (let i=0;i<n;i++){ const a = TAU*i/n, v = (1.4+R()*1.6)*devicePixelRatio; arr.push({x, y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, life:1, hue:hue+R()*20-10}); }
    return { burst:arr };
  }
  function drawLantern(p, ctx){
    const x = p.x + Math.sin(p.sw + p.y*0.004)*18*devicePixelRatio;
    ctx.save(); ctx.translate(x, p.y); ctx.globalAlpha = 0.9;
    const s = p.s; const w = s, h = s*1.35;
    ctx.fillStyle = 'rgba(255,150,70,.14)'; ctx.shadowColor='rgba(255,160,80,.9)'; ctx.shadowBlur=20*devicePixelRatio;
    ctx.beginPath(); ctx.ellipse(0,0,w*0.62,h*0.6,0,0,TAU); ctx.fill(); ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(255,180,100,.85)'; ctx.fillStyle='rgba(190,80,40,.9)'; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(-w*0.5, -h*0.28); ctx.lineTo(-w*0.62, -h*0.16); ctx.lineTo(-w*0.3, -h*0.14); ctx.lineTo(0, -h*0.34); ctx.lineTo(w*0.3, -h*0.14); ctx.lineTo(w*0.62, -h*0.16); ctx.lineTo(w*0.5, -h*0.28); ctx.closePath(); ctx.fill(); ctx.stroke();
    const g = ctx.createLinearGradient(0,-h*0.14,0,h*0.5);
    g.addColorStop(0,'rgba(255,190,110,.92)'); g.addColorStop(1,'rgba(255,130,70,.8)');
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.rect(-w*0.34, -h*0.14, w*0.68, h*0.6); ctx.fill();
    ctx.strokeStyle='rgba(160,60,30,.7)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-w*0.34,-h*0.14); ctx.lineTo(-w*0.34,h*0.46);
    ctx.moveTo(w*0.34,-h*0.14); ctx.lineTo(w*0.34,h*0.46);
    ctx.moveTo(-w*0.14,-h*0.14); ctx.lineTo(-w*0.14,h*0.46);
    ctx.moveTo(w*0.14,-h*0.14); ctx.lineTo(w*0.14,h*0.46); ctx.stroke();
    ctx.strokeStyle='rgba(160,60,30,.8)';
    ctx.beginPath(); ctx.moveTo(-w*0.42,h*0.46); ctx.lineTo(w*0.42,h*0.46); ctx.stroke();
    ctx.fillStyle='rgba(255,200,120,.75)';
    for (let i=-1;i<=1;i++){ ctx.beginPath(); ctx.moveTo(i*w*0.28, h*0.46); ctx.lineTo(i*w*0.28, h*0.62); ctx.stroke(); }
    ctx.restore();
  }
  function drawSwallow(ctx, x, y, s, flap){
    ctx.fillStyle = 'rgba(60,68,88,.75)';
    const wing = Math.sin(flap)*s*0.55;
    ctx.beginPath();
    ctx.moveTo(x-s, y-wing); ctx.quadraticCurveTo(x-s*0.3, y, x, y);
    ctx.quadraticCurveTo(x+s*0.3, y, x+s, y-wing);
    ctx.quadraticCurveTo(x+s*0.2, y+s*0.28, x, y+s*0.16);
    ctx.quadraticCurveTo(x-s*0.2, y+s*0.28, x-s, y-wing);
    ctx.fill();
  }
  function drawSnowflake(ctx, x, y, r, rot){
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1;
    for (let i=0;i<3;i++){ ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(r,0); ctx.stroke(); ctx.rotate(TAU/6); }
    ctx.restore();
  }
  let t = 0, _last = performance.now();
  function frame(){
    if (_raf === null) return;
    const _now = performance.now();
    const dt = Math.min(0.05, (_now - _last) / 1000); _last = _now;
    t += dt;
    ctx.clearRect(0,0,W,H);
    /* ① 风场：鼠标/手指划过 = 一阵风（冲量式，不持续跟随）。
          划过时给下落物一次方向冲量 → 撞边界反弹一下 → 散开 → 自然下落。
          排除：元宵灯(lantern)、小满金粒(wheat)、立夏萤火(firefly)、以及无下落速度的静止粒子。 */
    if (FXWIND.life > 0) {
      FXWIND.life -= dt;
      if (FXWIND.life <= 0) { FXWIND.life = 0; FXWIND.vx = 0; FXWIND.vy = 0; }
      // 冲击曲线：划过瞬间最强，随时间快速衰减（一阵风刮过，非持续跟随）
      const gust = FXWIND.life * FXWIND.life;
      const gx = FXWIND.vx, gy = FXWIND.vy;   // 风的方向（划过方向）
      const str = FXWIND.strength;
      const force = 5200 * str * gust;        // 推力（稍弱一点，避免过猛）
      // 仅对「真正下落物」作用
      const FALL_KINDS = ['leaf','leaves','osmanthus','peony','pear','apricot','plum','tea','choco','frost','chrysanth','snow','heavysnow','lightsnow','warmwindow'];
      const allowFall = FALL_KINDS.indexOf(kind) >= 0;
      // 对单个下落物施加风（冲量 + 边界反弹 + 个体散开）
      // 每个粒子用自身 sw 相位作随机种子，受风时个体有差异 → 避免整齐挤成一条线
      function applyWind(p){
        if (!(p && (typeof p.v === 'number') && typeof p.dx === 'undefined' && p.w !== 'static')) return;
        // 个体扰动系数（-0.6~0.6，由 sw 相位决定，稳定不抖动）
        const jit = Math.sin(p.sw || 0) * 0.55;
        const windJitter = 1 + jit;
        p.wvx = (p.wvx || 0) + gx * force * windJitter * dt;
        p.wvy = (p.wvy || 0) + gy * force * 0.8 * (1 + jit*0.5) * dt;
        // 横向扩散：受风时给一个垂直于风向的微小随机漂移，让粒子散成一片而不是一条线
        p.wvx += (R()*2-1) * 180 * str * gust * dt;
        p.x += (p.wvx || 0) * dt;
        p.y += (p.wvy || 0) * dt;
        // 撞击左右边界：反弹 + 明显向上/侧弹散（幅度增大，让粒子别堆在边界）
        if (p.x < 6) {
          p.x = 6;
          p.wvx = Math.abs(p.wvx) * 0.45;
          p.wvy = (p.wvy || 0) - (180 + R()*220) * str;
          p.wsx = (p.wsx || 0) + (140 + R()*200) * str;
        } else if (p.x > W - 6) {
          p.x = W - 6;
          p.wvx = -Math.abs(p.wvx) * 0.45;
          p.wvy = (p.wvy || 0) - (180 + R()*220) * str;
          p.wsx = (p.wsx || 0) - (140 + R()*200) * str;
        }
        if (p.y < 6 && p.wvy < 0) { p.y = 6; p.wvy = Math.abs(p.wvy) * 0.4; }
        if (p.wsx){ p.x += p.wsx * dt; p.wsx *= 0.88; if (Math.abs(p.wsx) < 1) p.wsx = 0; }
        p.wvx *= 0.90;
        p.wvy *= 0.90;
      }
      if (allowFall){
        for (const p of parts) applyWind(p);
        // 下落物若放在 extra 数组里（frost 红叶、chrysanth 落叶等），同样受风
        if (Array.isArray(extra)) for (const p of extra) applyWind(p);
      }
      // 风停后：给粒子一个缓慢横向扩散，让被吹挤到一边的粒子重新自然散开
      // （在风场刚结束的短暂窗口内，粒子彼此错开，恢复均匀分布）
      if (allowFall){
        const relax = Math.max(0, 1 - FXWIND.life * 2.5);
        for (const p of parts){
          if (!(p && typeof p.v === 'number')) continue;
          p.wvx = (p.wvx || 0) + (R()*2-1) * 60 * relax * dt;
        }
      }
      // 除夕烛火（candle）随风摇曳（不吹飞，只轻微偏移）
      if (kind === 'candle' && FXWIND.life > 0){
        for (const p of parts){
          if (p && typeof p.v === 'number'){
            p.wvx = (p.wvx || 0) + gx * force * 0.5 * dt;
            p.x += (p.wvx || 0) * dt;
            p.wvx *= 0.90;
          }
        }
      }
      // 儿童节气球（balloon）随风漂移：上升的气球被风吹得横向摆动 + 上下颠簸
      if (kind === 'balloon' && FXWIND.life > 0){
        for (const p of parts){
          if (p && typeof p.v === 'number'){
            p.wvx = (p.wvx || 0) + gx * force * 0.7 * dt;
            p.wvy = (p.wvy || 0) + gy * force * 0.5 * dt;
            p.x += (p.wvx || 0) * dt;
            p.y += (p.wvy || 0) * dt;
            // 边界：气球碰到左右边界轻微反弹
            if (p.x < 8) { p.x = 8; p.wvx = Math.abs(p.wvx) * 0.4; }
            else if (p.x > W - 8) { p.x = W - 8; p.wvx = -Math.abs(p.wvx) * 0.4; }
            p.wvx *= 0.92;
            p.wvy *= 0.92;
          }
        }
      }
      // 雨丝（extra.rain）也受风：斜向吹动（仅雨类节气）
      if (extra && extra.rain && ['rainripple','apricot','pear','tea','plumrain'].indexOf(kind) >= 0){
        for (const r of extra.rain){
          r.wvx = (r.wvx || 0) + gx * force * 0.5 * dt;
          r.x += (r.wvx || 0) * dt;
          if (r.x < 2){ r.x = 2; r.wvx = Math.abs(r.wvx) * 0.4; }
          else if (r.x > W-2){ r.x = W-2; r.wvx = -Math.abs(r.wvx) * 0.4; }
          r.wvx *= 0.92;
        }
      }
    }
    /* ② 点击烟花注入：把 FXBURSTS 里待注入的 burst 并进 parts */
    if ((kind === 'firework' || kind === 'national') && FXBURSTS.length){
      for (const b of FXBURSTS) parts.push(b);
      FXBURSTS.length = 0;
    }
    /* ③ 风线视觉（划过时稀疏的一阵风流，细、淡、少） */
    for (const st of FXWIND.streak){
      st.x += st.vx*dt*60; st.y += st.vy*dt*60; st.a -= dt*2.2;
    }
    FXWIND.streak = FXWIND.streak.filter(s => s.a > 0.02);
    if (FXWIND.streak.length > 8) FXWIND.streak.splice(0, FXWIND.streak.length - 8);   // 最多 8 条，避免密集成排
    for (const st of FXWIND.streak){
      ctx.strokeStyle = `rgba(220,235,255,${st.a*0.7})`; ctx.lineWidth = 1*devicePixelRatio; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(st.x - st.vx*2.0, st.y - st.vy*2.0); ctx.stroke();
    }
    if (kind === 'wave') {
      for (let L=0; L<3; L++){
        ctx.beginPath();
        for (let x=0; x<=W; x+=8){
          const y = H*0.76 + L*26*devicePixelRatio + Math.sin(x*0.012 + t*(1+L*0.3) + L)*10*devicePixelRatio;
          x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
        }
        ctx.strokeStyle = `rgba(140,220,190,${0.22-L*0.05})`; ctx.lineWidth = 2*devicePixelRatio; ctx.stroke();
      }
    }
    if (kind === 'wheat') {
      for (let L=0; L<3; L++){
        ctx.beginPath();
        for (let x=0; x<=W; x+=8){
          const y = H*0.66 + L*22*devicePixelRatio + Math.sin(x*0.014 + t*(0.9+L*0.25) + L)*9*devicePixelRatio;
          x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
        }
        ctx.strokeStyle = `rgba(232,190,96,${0.30-L*0.07})`; ctx.lineWidth = 2*devicePixelRatio; ctx.stroke();
      }
      for (const p of parts){ p.tw += p.v; ctx.globalAlpha = 0.4+0.5*Math.abs(Math.sin(p.tw));
        ctx.fillStyle='rgba(245,214,130,.95)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 1.6*devicePixelRatio, 3.4*devicePixelRatio, 0.4, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (kind === 'rainripple') {
      ctx.strokeStyle = 'rgba(178,200,235,.4)'; ctx.lineWidth = 1;
      for (const p of parts){ p.y += p.v*devicePixelRatio; if (p.y > H*0.76) { extra.ripples.push({x:p.x, y:H*0.78, r:1, a:0.5}); p.y = -14; p.x = R()*W; }
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x-1.5*devicePixelRatio, p.y+p.l*devicePixelRatio); ctx.stroke(); }
      extra.ripples = extra.ripples.filter(rp => rp.a > 0.02);
      for (const rp of extra.ripples){ rp.r += dt*22; rp.a -= dt*0.5;
        ctx.strokeStyle = `rgba(190,215,245,${rp.a})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.r*devicePixelRatio, rp.r*0.36*devicePixelRatio, 0, 0, TAU); ctx.stroke(); }
      ctx.fillStyle = 'rgba(150,180,225,.08)'; ctx.fillRect(0, H*0.76, W, H*0.12);
    }
    if (kind === 'swallows') {
      for (const sw of extra){
        sw.ph += dt * sw.sp * 0.55;
        const x = ((sw.ph % 1.6) * (W+160)/1.6) - 80;
        const y = sw.y + Math.sin(sw.ph*7)*sw.amp;
        const flap = t*9 + sw.ph*5;
        drawSwallow(ctx, x, y, sw.s*devicePixelRatio, flap);
      }
      for (const p of parts){ p.y -= p.v*devicePixelRatio; p.tw += dt*1.6; if (p.y < -8) { p.y = H+8; p.x = R()*W; }
        ctx.globalAlpha = 0.3+0.4*Math.abs(Math.sin(p.tw));
        ctx.fillStyle='rgba(240,245,255,.9)';
        ctx.beginPath(); ctx.arc(p.x + Math.sin(p.tw*0.7)*7*devicePixelRatio, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (kind === 'apricot') {
      // 清明（节日）：雨丝 + 杏花落水循环（错落有序下落 → 落水泛涟漪 → 淡出 → 重生）
      // ① 下方水面（下移，不挡文字）
      const wl = H*0.74;
      const wg = ctx.createLinearGradient(0, wl, 0, H);
      wg.addColorStop(0,'rgba(150,190,210,.5)'); wg.addColorStop(1,'rgba(110,160,190,.6)');
      ctx.fillStyle = wg; ctx.fillRect(0, wl, W, H-wl);
      ctx.strokeStyle = 'rgba(225,240,250,.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, wl); ctx.lineTo(W, wl); ctx.stroke();
      // ② 雨丝
      ctx.strokeStyle = 'rgba(198,214,248,.72)'; ctx.lineWidth = 1.6;
      for (const r of extra.rain){ r.y += r.v*devicePixelRatio; if (r.y > H) { r.y = -14; r.x = R()*W; }
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x-2.5*devicePixelRatio, r.y+r.l*devicePixelRatio); ctx.stroke(); }
      // ③ 杏花瓣错落下落 → 落水泛涟漪 → 淡出 → 重生（循环）
      for (const p of parts){
        p.y += p.v*devicePixelRatio; p.sw += 0.016; p.rot += 0.008;
        const x = p.x + Math.sin(p.sw + p.ph)*8*devicePixelRatio;
        // 到达水面：落水泛涟漪，短暂停留淡出
        if (p.y >= wl - 2 && !p.landed){
          p.landed = true;
          extra.ripples.push({ x: x, y: wl + 2*devicePixelRatio, r: 1, a: 0.55 });
        }
        if (p.landed){
          p.water = (p.water || 0) + dt;
          // 漂浮淡出（约 1.5s），然后重生
          if (p.water > 1.5){ p.y = -16; p.x = R()*W; p.landed = false; p.water = 0; }
          const bob = wl + Math.sin(t*2 + p.ph)*1.5*devicePixelRatio;
          ctx.save(); ctx.translate(x, bob); ctx.rotate(Math.sin(t + p.ph)*0.2);
          ctx.globalAlpha = Math.max(0, 1 - p.water*0.6);
        } else {
          if (p.y > H+16) { p.y = -16; p.x = R()*W; }
          ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot);
        }
        ctx.fillStyle='rgba(250,218,228,.82)';
        ctx.beginPath(); ctx.ellipse(0,0,p.s,p.s*0.6,0,0,TAU); ctx.fill();
        ctx.fillStyle='rgba(255,255,255,.5)';
        ctx.beginPath(); ctx.ellipse(0,0,p.s*0.45,p.s*0.28,0,0,TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      // ④ 涟漪（落水处泛开的同心圆）
      extra.ripples = extra.ripples.filter(rp => rp.a > 0.02);
      for (const rp of extra.ripples){ rp.r += dt*20; rp.a -= dt*0.5;
        ctx.strokeStyle=`rgba(220,240,250,${rp.a})`; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.r*devicePixelRatio, rp.r*0.32*devicePixelRatio, 0, 0, TAU); ctx.stroke(); }
    }
    if (kind === 'peony') {
      for (const p of parts){
        p.y += p.v*devicePixelRatio; p.sw += 0.014; p.rot += 0.006;
        const x = p.x + Math.sin(p.sw)*7*devicePixelRatio;
        if (p.y > H+24) { p.y = -24; p.x = R()*W; }
        ctx.save(); ctx.translate(x,p.y); ctx.rotate(p.rot);
        const g = ctx.createRadialGradient(0,0,1,0,0,p.s);
        g.addColorStop(0,`hsla(${p.hue},70%,82%,.92)`); g.addColorStop(1,`hsla(${p.hue},62%,68%,.75)`);
        ctx.fillStyle=g;
        ctx.beginPath(); ctx.ellipse(0,0,p.s,p.s*0.62,0,0,TAU); ctx.fill();
        ctx.fillStyle='rgba(255,235,242,.5)';
        ctx.beginPath(); ctx.ellipse(-p.s*0.2,-p.s*0.1,p.s*0.4,p.s*0.22,0,0,TAU); ctx.fill();
        ctx.restore();
      }
    }
    if (kind === 'sunburst') {
      const sx = W*0.76, sy = H*0.16, sr = 30*devicePixelRatio;
      const g = ctx.createRadialGradient(sx,sy,sr*0.2,sx,sy,sr*2.6);
      g.addColorStop(0,'rgba(255,238,180,.8)'); g.addColorStop(0.4,'rgba(255,225,150,.22)'); g.addColorStop(1,'rgba(255,225,150,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx,sy,sr*2.6,0,TAU); ctx.fill();
      ctx.fillStyle='rgba(255,246,214,.95)'; ctx.beginPath(); ctx.arc(sx,sy,sr,0,TAU); ctx.fill();
      ctx.save(); ctx.translate(sx,sy); ctx.rotate(t*0.15);
      ctx.strokeStyle='rgba(255,232,160,.4)'; ctx.lineWidth=1.4*devicePixelRatio;
      for (let i=0;i<12;i++){ ctx.rotate(TAU/12);
        ctx.beginPath(); ctx.moveTo(sr*1.25,0); ctx.lineTo(sr*(1.5+0.12*Math.sin(t*2+i)),0); ctx.stroke(); }
      ctx.restore();
      for (const p of parts){ p.tw += p.v; ctx.globalAlpha = 0.3+0.5*Math.abs(Math.sin(p.tw));
        ctx.fillStyle='rgba(255,240,200,.95)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (kind === 'lotus') {
      ctx.fillStyle = 'rgba(150,200,160,.10)'; ctx.fillRect(0, H*0.78, W, H*0.1);
      // 荷叶：随微风摇曳（风起荷塘——每片荷叶按相位轻轻摆动，模拟风吹）
      for (let i=0;i<extra.lily.length;i++){
        const lf = extra.lily[i];
        const sway = Math.sin(t*1.6 + i*1.3)*0.12;   // 微风吹拂的摇曳角度
        ctx.save();
        ctx.translate(lf.x, lf.y); ctx.rotate(sway);
        ctx.fillStyle = 'rgba(110,190,140,.4)';
        ctx.beginPath(); ctx.ellipse(0, 0, lf.r, lf.r*0.4, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle='rgba(90,160,120,.35)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(-lf.r, 0); ctx.lineTo(lf.r, 0); ctx.stroke();
        ctx.restore();
      }
      const fl = extra.flower;
      const fsway = Math.sin(t*1.4)*0.1;   // 荷花也随微风轻摆
      ctx.save(); ctx.translate(fl.x, fl.y); ctx.rotate(fsway);
      for (let i=0;i<6;i++){ ctx.rotate(TAU/6);
        ctx.fillStyle='rgba(245,180,200,.55)';
        ctx.beginPath(); ctx.ellipse(0, -fl.s*0.5, fl.s*0.32, fl.s*0.6, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle='rgba(255,220,160,.7)'; ctx.beginPath(); ctx.arc(0,0,fl.s*0.22,0,TAU); ctx.fill();
      ctx.restore();
      if (R() < 0.03) extra.ripples.push({x:R()*W, y:H*(0.74+R()*0.1), r:1, a:0.4});
      extra.ripples = extra.ripples.filter(rp => rp.a > 0.02);
      for (const rp of extra.ripples){ rp.r += dt*18; rp.a -= dt*0.4;
        ctx.strokeStyle=`rgba(170,220,200,${rp.a})`; ctx.lineWidth=1;
        ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.r*devicePixelRatio, rp.r*0.32*devicePixelRatio, 0, 0, TAU); ctx.stroke(); }
      const df = extra.dragonfly; df.t += dt*0.7;
      const dx = W*0.42 + Math.cos(df.t)*W*0.24, dy = H*0.4 + Math.sin(df.t*2.3)*H*0.07;
      ctx.fillStyle='rgba(120,200,220,.8)';
      ctx.beginPath(); ctx.ellipse(dx, dy, 4*devicePixelRatio, 1.6*devicePixelRatio, Math.cos(df.t*2.3)*0.3, 0, TAU); ctx.fill();
      const wg = Math.sin(t*18)*3.4*devicePixelRatio;
      ctx.strokeStyle='rgba(190,235,245,.65)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(dx,dy-1); ctx.lineTo(dx-6*devicePixelRatio, dy-1-wg);
      ctx.moveTo(dx,dy-1); ctx.lineTo(dx+6*devicePixelRatio, dy-1-wg); ctx.stroke();
    }
    if (kind === 'heatwave') {
      for (const p of parts){
        p.y -= p.v*devicePixelRatio; if (p.y < -p.r) { p.y = H + p.r; p.x = R()*W; }
        const g = ctx.createRadialGradient(p.x,p.y,1,p.x,p.y,p.r);
        g.addColorStop(0,`rgba(255,190,110,${p.a})`); g.addColorStop(1,'rgba(255,170,90,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,TAU); ctx.fill();
      }
      ctx.globalAlpha = 0.5+0.2*Math.sin(t*3);
      ctx.fillStyle = 'rgba(255,200,120,.05)'; ctx.fillRect(0,0,W,H);
      ctx.globalAlpha = 1;
    }
    if (kind === 'riverlamp') {
      ctx.fillStyle = 'rgba(120,150,200,.08)'; ctx.fillRect(0, H*0.62, W, H*0.38);
      ctx.strokeStyle = 'rgba(160,190,235,.12)'; ctx.lineWidth = 1;
      for (let L=0;L<2;L++){ ctx.beginPath();
        for (let x=0;x<=W;x+=10){ const y = H*0.7 + L*20*devicePixelRatio + Math.sin(x*0.02 + t*(0.8+L))*5*devicePixelRatio;
          x===0?ctx.moveTo(x,y):ctx.lineTo(x,y); }
        ctx.stroke(); }
      for (const p of parts){
        p.x += p.v*devicePixelRatio; p.bob += dt*2;
        const y = p.y + Math.sin(p.bob)*3*devicePixelRatio;
        if (p.x > W+30) { p.x = -30; p.y = H*(0.68+R()*0.10); }
        const g = ctx.createRadialGradient(p.x,y,1,p.x,y,p.s*2.4);
        g.addColorStop(0,'rgba(255,200,120,.5)'); g.addColorStop(1,'rgba(255,180,90,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,y,p.s*2.4,0,TAU); ctx.fill();
        ctx.fillStyle='rgba(255,215,140,.92)';
        ctx.beginPath(); ctx.moveTo(p.x-p.s*0.7, y+p.s*0.4); ctx.lineTo(p.x-p.s*0.45, y-p.s*0.4);
        ctx.lineTo(p.x+p.s*0.45, y-p.s*0.4); ctx.lineTo(p.x+p.s*0.7, y+p.s*0.4); ctx.closePath(); ctx.fill();
        ctx.fillStyle='rgba(255,240,190,.95)'; ctx.beginPath(); ctx.arc(p.x, y-p.s*0.05, p.s*0.22, 0, TAU); ctx.fill();
      }
    }
    if (kind === 'dew') {
      for (const p of parts){ p.tw += p.v; ctx.globalAlpha = 0.25+0.4*Math.abs(Math.sin(p.tw));
        ctx.fillStyle='rgba(220,240,255,.9)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      for (const d of extra){
        const tw = 0.65+0.35*Math.sin(t*1.2 + d.ph);
        const g = ctx.createRadialGradient(d.x-d.r*0.35, d.y-d.r*0.35, d.r*0.1, d.x, d.y, d.r);
        g.addColorStop(0,`rgba(255,255,255,${tw})`); g.addColorStop(0.5,'rgba(200,230,250,.65)'); g.addColorStop(1,'rgba(160,205,240,.35)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
        ctx.fillStyle=`rgba(255,255,255,${tw*0.9})`;
        ctx.beginPath(); ctx.arc(d.x-d.r*0.35, d.y-d.r*0.4, d.r*0.24, 0, TAU); ctx.fill();
      }
    }
    if (kind === 'osmanthus') {
      // 秋分：右上圆月 + 桂花花瓣飘落（金色四瓣花瓣，缓慢旋转）
      const mx = W*0.76, my = H*0.17, mr = 26*devicePixelRatio;
      const g = ctx.createRadialGradient(mx,my,mr*0.2,mx,my,mr*2.2);
      g.addColorStop(0,'rgba(255,244,214,.7)'); g.addColorStop(1,'rgba(255,236,190,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(mx,my,mr*2.2,0,TAU); ctx.fill();
      ctx.fillStyle='rgba(255,248,225,.95)'; ctx.beginPath(); ctx.arc(mx,my,mr,0,TAU); ctx.fill();
      // 桂花花瓣飘落（金色四瓣小花，成片，缓慢旋转摇曳）
      for (const p of parts){
        p.y += p.v*devicePixelRatio; p.sw += 0.016; p.rot += p.spin*dt; p.tw += dt*2;
        const x = p.x + Math.sin(p.sw)*10*devicePixelRatio;
        if (p.y > H+16) { p.y = -16; p.x = R()*W; }
        ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = 0.8 + 0.2*Math.abs(Math.sin(p.tw));
        // 四瓣金黄桂花（倒卵形花瓣 + 橙黄蕊心）
        ctx.fillStyle='rgba(246,198,90,.92)';
        for (let k=0;k<4;k++){ const pa=-Math.PI/2 + k*Math.PI/2;
          ctx.beginPath(); ctx.ellipse(Math.cos(pa)*p.r*0.5, Math.sin(pa)*p.r*0.5, p.r*0.5, p.r*0.34, pa, 0, TAU); ctx.fill(); }
        ctx.fillStyle='rgba(198,118,48,.85)'; ctx.beginPath(); ctx.arc(0,0,p.r*0.18,0,TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
    if (kind === 'pear') {
      // 清明（节气）：雨丝 + 下方水面 + 梨花花瓣慢慢飘落落水泛涟漪
      // ① 下方水面（明显的青蓝水面，带水面线和高光，位置下调避开文字）
      const wl = H*0.74;   // 水面线（下移到 74%，不挡中间诗句）
      const wg = ctx.createLinearGradient(0, wl, 0, H);
      wg.addColorStop(0,'rgba(140,185,210,.55)'); wg.addColorStop(0.5,'rgba(110,160,190,.6)'); wg.addColorStop(1,'rgba(90,140,175,.68)');
      ctx.fillStyle = wg; ctx.fillRect(0, wl, W, H-wl);
      // 水面线（清晰的高光线）
      ctx.strokeStyle = 'rgba(225,240,250,.75)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(0, wl); ctx.lineTo(W, wl); ctx.stroke();
      // 水面细微波光（横向短线，随波轻动）
      for (let x=0;x<=W;x+=12*devicePixelRatio){
        const wy = wl + 8*devicePixelRatio + Math.sin(x*0.04 + t*1.4)*2.5*devicePixelRatio;
        ctx.strokeStyle = 'rgba(225,242,250,.4)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, wy); ctx.lineTo(x+6*devicePixelRatio, wy); ctx.stroke();
      }
      // ② 雨丝（斜落，明显）
      ctx.strokeStyle = 'rgba(190,210,240,.55)'; ctx.lineWidth = 1.5;
      for (const p of extra.rain){ p.y += p.v*devicePixelRatio; p.x -= 0.7*devicePixelRatio; if (p.y > H) { p.y = -16; p.x = R()*W; }
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x-3*devicePixelRatio, p.y+p.l*devicePixelRatio); ctx.stroke(); }
      // ③ 梨花花瓣慢慢飘落（五瓣白花+紫红花蕊，缓慢旋转），落水淡出、顶部淡入重生（无断裂）
      for (const p of parts){
        p.y += p.v*devicePixelRatio; p.sw += 0.012; p.rot += p.spin*dt;
        const x = p.x + Math.sin(p.sw)*14*devicePixelRatio;
        // 花瓣落水：到达水面线就「落」在水面上，泛涟漪后淡出
        if (p.y >= wl - 2) {
          if (!p.landed) {
            p.landed = true;
            extra.ripples.push({ x: x, y: wl + 2*devicePixelRatio, r: 1, a: 0.5 });
          }
          // 落水后花瓣短暂停留漂浮，快速淡出
          p.water += dt;
          if (p.water > 1.2) { p.y = -24; p.x = R()*W; p.landed = false; p.water = 0; p.fadeIn = 0; }
          // 漂浮：轻轻随波上下 + 淡出
          const bob = wl + Math.sin(t*2 + p.sw)*1.5*devicePixelRatio;
          ctx.save(); ctx.translate(x, bob); ctx.rotate(Math.sin(t + p.sw)*0.2);
          ctx.globalAlpha = Math.max(0, 1 - p.water*0.85);
        } else {
          if (p.y > H+24) { p.y = -24; p.x = R()*W; }
          ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot);
          // 顶部重生：刚重生时从透明渐入（避免硬跳断裂感）
          p.fadeIn = (p.fadeIn == null) ? 0 : p.fadeIn;
          if (p.y < -8 && p.fadeIn < 1) p.fadeIn += dt*3;
          ctx.globalAlpha = Math.min(1, p.fadeIn || 0.3);
        }
        // 白五瓣（倒卵圆）
        ctx.fillStyle='rgba(255,255,255,.9)';
        for (let k=0;k<5;k++){ const pa=-Math.PI/2 + k*TAU/5;
          ctx.beginPath(); ctx.ellipse(Math.cos(pa)*p.r*0.55, Math.sin(pa)*p.r*0.55, p.r*0.5, p.r*0.34, pa, 0, TAU); ctx.fill(); }
        // 紫红花蕊（点状）
        ctx.fillStyle='rgba(175,80,120,.85)';
        for (let k=0;k<4;k++){ const pa=R()*TAU, rr=R()*p.r*0.3;
          ctx.beginPath(); ctx.arc(Math.cos(pa)*rr, Math.sin(pa)*rr, p.r*0.1, 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      // ④ 涟漪（花瓣落水处泛开的同心圆）
      extra.ripples = extra.ripples.filter(rp => rp.a > 0.02);
      for (const rp of extra.ripples){ rp.r += dt*22; rp.a -= dt*0.5;
        ctx.strokeStyle=`rgba(220,240,250,${rp.a})`; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.r*devicePixelRatio, rp.r*0.32*devicePixelRatio, 0, 0, TAU); ctx.stroke(); }
    }
    if (kind === 'geese') {
      // 寒露：草尖露珠（晶莹剔透、折射清冷光）+ 鸿雁南飞（去月亮）
      // ① 底部草丛 + 草尖露珠
      const ground = H*0.76;
      // 记录露珠屏幕坐标（供鼠标滑过检测叮铃声）
      _dewPts = [];
      for (const d of extra.dews){
        const gx = d.x, baseY = ground;
        const tipY = baseY - d.grassH;
        // 20261028：草叶随风摆动——基础微风起伏（每根草相位/速度不同，自然不整齐），
        // 鼠标/手指靠近露珠时摆动幅度增强（被拨动的那根草明显晃一下），不呆板静止
        let sway = Math.sin(t * d.swaySp + d.swayPh) * 3.2 * S;   // 基础微风摆动（±3.2px）
        {
          const md = Math.hypot(_mousePt.x - (gx + d.lean*14*S)/W, _mousePt.y - tipY/H);
          if (md < 0.16) {
            // 靠近露珠：额外摆动，越近摆越大（最大额外 ±14px）
            const extraSway = (1 - md/0.16) * 14 * S;
            sway += Math.sin(t * 9 + d.swayPh) * extraSway;
          }
        }
        const tipX = gx + d.lean*14*S + sway;                    // 草尖端点（随摆动偏移）
        const ctrlX = gx + d.lean*8*S + sway*0.5;                // 控制点（偏移量约为端点一半）
        // 草叶（细长弯叶，青中带黄晕——寒露草木渐枯）
        ctx.strokeStyle = 'rgba(120,150,90,.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(gx, baseY);
        ctx.quadraticCurveTo(ctrlX, (baseY+tipY)/2, tipX, tipY);
        ctx.stroke();
        // 草尖露珠：浑圆剔透，折射清冷微光（微微颤动 + 鼠标靠近时磁吸晃动）
        const tw = Math.sin(t*1.4 + d.ph)*0.5;
        let dx = tipX, dy = tipY;   // 20261028：露珠基础位置跟随摆动的草尖端点
        // 鼠标靠近露珠 → 露珠向鼠标方向明显晃动（磁性吸附，越近偏越多）
        {
          const mnx = _mousePt.x, mny = _mousePt.y;
          const md = Math.hypot(mnx - dx/W, mny - dy/H);
          if (md < 0.12){
            // 用归一化方向向量 × 物理像素幅度，偏移量真正可见（最大 ~18 物理像素）
            const pull = (1 - md/0.12) * 18 * S;
            const dirX = (mnx - dx/W), dirY = (mny - dy/H);
            const dl = Math.hypot(dirX, dirY) || 1;
            dx += (dirX/dl) * pull;
            dy += (dirY/dl) * pull;
          }
        }
        const rg = ctx.createRadialGradient(dx-d.r*0.35, dy-d.r*0.35, d.r*0.1, dx, dy, d.r);
        rg.addColorStop(0,`rgba(255,255,255,${0.9+tw*0.1})`);
        rg.addColorStop(0.5,'rgba(210,235,250,.7)');
        rg.addColorStop(1,'rgba(160,205,235,.4)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(dx, dy, d.r, 0, TAU); ctx.fill();
        // 露珠高光点
        ctx.fillStyle = `rgba(255,255,255,${0.95+tw*0.05})`;
        ctx.beginPath(); ctx.arc(dx-d.r*0.35, dy-d.r*0.4, d.r*0.28, 0, TAU); ctx.fill();
        // 记录露珠原始归一化坐标（供滑过检测，不用偏移后的坐标避免「追着鼠标跑」）
        _dewPts.push({ nx: tipX / W, ny: tipY / H, r: d.r / W });
      }
      // ② 鸿雁南飞（一候鸿雁来宾，人字雁阵掠过）
      extra.prog += dt*0.05;
      const px = ((extra.prog % 1.4) * (W+220)/1.4) - 110, py = H*0.22;
      ctx.fillStyle = 'rgba(70,78,96,.65)';
      const n = 7;
      for (let i=0;i<n;i++){
        const side = i%2 ? 1 : -1, k = Math.ceil(i/2);
        const gx = px + side*k*16*devicePixelRatio;
        const gy = py + k*11*devicePixelRatio + Math.sin(t*3 + i)*1.5*devicePixelRatio;
        const flap = Math.sin(t*7 + i*0.9)*3.4*devicePixelRatio;
        ctx.beginPath();
        ctx.moveTo(gx-5*devicePixelRatio, gy-flap); ctx.quadraticCurveTo(gx, gy+1.5*devicePixelRatio, gx+5*devicePixelRatio, gy-flap);
        ctx.quadraticCurveTo(gx, gy+3*devicePixelRatio, gx-5*devicePixelRatio, gy-flap); ctx.fill();
      }
    }
    if (kind === 'frost') {
      for (const p of parts){
        const ap = Math.max(0, Math.sin(t*0.5 + p.ph));
        if (ap < 0.03) continue;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t*0.1 + p.ph);
        ctx.strokeStyle = `rgba(230,245,255,${ap*0.85})`; ctx.lineWidth = 1.1;
        for (let i=0;i<6;i++){ ctx.rotate(TAU/6);
          ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-p.r); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0,-p.r*0.55); ctx.lineTo(p.r*0.22,-p.r*0.75);
          ctx.moveTo(0,-p.r*0.55); ctx.lineTo(-p.r*0.22,-p.r*0.75); ctx.stroke(); }
        ctx.restore();
      }
      for (const p of extra){
        p.y += p.v*devicePixelRatio; p.sw += 0.016; p.rot += p.rv;
        const x = p.x + Math.sin(p.sw)*6*devicePixelRatio;
        if (p.y > H+16) { p.y = -16; p.x = R()*W; }
        ctx.save(); ctx.translate(x,p.y); ctx.rotate(p.rot);
        ctx.fillStyle='rgba(215,110,80,.6)';
        ctx.beginPath(); ctx.ellipse(0,0,p.s,p.s*0.45,0,0,TAU); ctx.fill(); ctx.restore();
      }
    }
    if (kind === 'warmwindow') {
      const e = extra;
      const g = ctx.createRadialGradient(e.wx, e.wy, 4, e.wx, e.wy, e.ww*1.9);
      g.addColorStop(0,'rgba(255,200,120,.3)'); g.addColorStop(1,'rgba(255,190,110,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(e.wx, e.wy, e.ww*1.9, 0, TAU); ctx.fill();
      ctx.fillStyle='rgba(60,52,90,.75)';
      ctx.fillRect(e.wx-e.ww/2-4*S, e.wy-e.wh/2-4*S, e.ww+8*S, e.wh+8*S);
      const wg = ctx.createLinearGradient(e.wx, e.wy-e.wh/2, e.wx, e.wy+e.wh/2);
      wg.addColorStop(0,'rgba(255,214,140,.95)'); wg.addColorStop(1,'rgba(240,170,90,.85)');
      ctx.fillStyle=wg; ctx.fillRect(e.wx-e.ww/2, e.wy-e.wh/2, e.ww, e.wh);
      ctx.strokeStyle='rgba(60,52,90,.9)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(e.wx, e.wy-e.wh/2); ctx.lineTo(e.wx, e.wy+e.wh/2);
      ctx.moveTo(e.wx-e.ww/2, e.wy); ctx.lineTo(e.wx+e.ww/2, e.wy); ctx.stroke();
      for (const p of parts){ p.y += p.v*devicePixelRatio; p.sw += 0.014;
        const x = p.x + Math.sin(p.sw)*5*devicePixelRatio;
        if (p.y > H+8) { p.y = -8; p.x = R()*W; }
        ctx.fillStyle='rgba(255,255,255,.7)';
        ctx.beginPath(); ctx.arc(x, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill(); }
    }
    if (kind === 'plum') {
      // 冬至：红梅（朱砂梅·骨里红）——短小枝条从右边框伸入，贴右上角 + 深紫红梅花 + 绛紫花萼
      const e = extra;
      ctx.lineCap='round';
      ctx.strokeStyle='rgba(122,42,52,.85)';
      // 枝条：自右边框外(W+6)伸入，短小弯曲，落在右上角（e.bx/e.by）
      ctx.lineWidth = 3*S;
      ctx.beginPath(); ctx.moveTo(W+6, e.by+H*0.1);
      ctx.quadraticCurveTo(W*0.92, e.by+H*0.02, e.bx, e.by);
      ctx.quadraticCurveTo(W*0.78, e.by-H*0.03, W*0.68, e.by+H*0.02); ctx.stroke();
      // 侧枝（细，向斜上）——贴着主干生发，不凸出
      ctx.lineWidth = 2*S;
      ctx.beginPath(); ctx.moveTo(e.bx-10*S, e.by+2*S);
      ctx.quadraticCurveTo(e.bx-24*S, e.by-16*S, e.bx-34*S, e.by-26*S); ctx.stroke();
      // 下垂小枝（细）
      ctx.beginPath(); ctx.moveTo(W*0.74, e.by);
      ctx.quadraticCurveTo(W*0.70, e.by+H*0.05, W*0.64, e.by+H*0.07); ctx.stroke();
      // 枝头红梅花朵（深紫红重瓣 + 绛紫花萼 + 金黄蕊），相对坐标固定，不再每帧随机
      for (const b of e.buds){
        const px = W*0.66 + b.bx*W*0.24, py = e.by - H*0.03 + b.by*H*0.09, r = b.r;
        // 花萼（绛紫）
        ctx.fillStyle='rgba(120,45,85,.9)';
        ctx.beginPath(); ctx.arc(px, py+r*0.45, r*0.7, 0, TAU); ctx.fill();
        // 深紫红花（重瓣）
        ctx.fillStyle='rgba(180,50,80,.92)';
        ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
        ctx.fillStyle='rgba(205,65,95,.9)';
        ctx.beginPath(); ctx.arc(px-r*0.16, py-r*0.16, r*0.6, 0, TAU); ctx.fill();
        // 金黄雄蕊
        ctx.fillStyle='rgba(240,200,90,.9)';
        ctx.beginPath(); ctx.arc(px, py, r*0.2, 0, TAU); ctx.fill();
      }
      // 飘落的红梅瓣（深紫红，非粉色）
      for (const p of parts){
        p.y += p.v*devicePixelRatio; p.sw += 0.015; p.rot += 0.008;
        const x = p.x + Math.sin(p.sw)*6*devicePixelRatio;
        if (p.y > H+14) { p.y = -14; p.x = R()*W; }
        ctx.save(); ctx.translate(x,p.y); ctx.rotate(p.rot);
        ctx.fillStyle='rgba(190,60,88,.82)';
        ctx.beginPath(); ctx.ellipse(0,0,p.s,p.s*0.58,0,0,TAU); ctx.fill(); ctx.restore();
      }
    }
    if (kind === 'hearth') {
      // 小寒：炭炉（炉盆+炉栅+炭火光）+ 火星 + 少量雪
      const fx0 = W*0.5, fy0 = H*0.71;
      const fl = 0.85+0.15*Math.sin(t*6)+0.06*Math.sin(t*11);
      const g = ctx.createRadialGradient(fx0, fy0-8*S, 2, fx0, fy0-8*S, 46*S*fl);
      g.addColorStop(0,'rgba(255,180,100,.55)'); g.addColorStop(0.55,'rgba(255,150,80,.22)'); g.addColorStop(1,'rgba(255,130,60,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(fx0, fy0-8*S, 46*S*fl, 0, TAU); ctx.fill();
      // 炭块
      ctx.fillStyle='rgba(50,40,55,.9)';
      ctx.beginPath(); ctx.ellipse(fx0-8*S, fy0-4*S, 9*S, 6*S, 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(fx0+8*S, fy0-5*S, 8*S, 5.5*S, -0.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(fx0, fy0-9*S, 8*S, 5*S, 0, 0, TAU); ctx.fill();
      ctx.fillStyle='rgba(255,150,80,.8)';
      ctx.beginPath(); ctx.ellipse(fx0-4*S, fy0-6*S, 3.4*S*fl, 2.2*S*fl, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(fx0+6*S, fy0-7*S, 2.6*S*fl, 1.8*S*fl, 0, 0, TAU); ctx.fill();
      // 炉盆（梯形碗）+ 炉栅横线
      ctx.fillStyle='rgba(58,48,78,.92)';
      ctx.beginPath(); ctx.moveTo(fx0-30*S, fy0); ctx.lineTo(fx0+30*S, fy0);
      ctx.lineTo(fx0+24*S, fy0+22*S); ctx.quadraticCurveTo(fx0, fy0+27*S, fx0-24*S, fy0+22*S); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='rgba(150,130,180,.55)'; ctx.lineWidth=1.4;
      ctx.beginPath();
      for (let i=0;i<3;i++){ const yy = fy0+7*S+i*6*S, half = 27*S-i*3*S;
        ctx.moveTo(fx0-half, yy); ctx.lineTo(fx0+half, yy); }
      ctx.stroke();
      // 火星上升（细小，从炭块上方）
      for (const p of parts){
        p.y -= p.v*devicePixelRatio; p.drift += dt;
        if (p.y < fy0-70*S) { p.y = fy0-10*S; p.x = fx0+(R()-0.5)*30*S; }
        ctx.globalAlpha = Math.max(0, 0.8 - (fy0-10*S-p.y)/(60*S));
        ctx.fillStyle='rgba(255,200,120,.95)';
        ctx.beginPath(); ctx.arc(p.x + Math.sin(p.drift*3)*3*S, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      for (const p of extra){ p.y += p.v*devicePixelRatio; p.sw += 0.013;
        const x = p.x + Math.sin(p.sw)*5*devicePixelRatio;
        if (p.y > H+8) { p.y = -8; p.x = R()*W; }
        ctx.fillStyle='rgba(255,255,255,.6)';
        ctx.beginPath(); ctx.arc(x, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill(); }
    }
    if (kind === 'tea') {
      // 谷雨：微雨丝 + 嫩茶叶飘落（去茶树）
      ctx.strokeStyle = 'rgba(180,210,215,.5)'; ctx.lineWidth = 1.3;
      for (const r of extra.rain){ r.y += r.v*devicePixelRatio; if (r.y > H) { r.y = -14; r.x = R()*W; }
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x-1.8*devicePixelRatio, r.y+r.l*devicePixelRatio); ctx.stroke(); }
      // 飘落的茶叶（明显的大叶子，两片对生为一组，带中脉）
      for (const p of parts){
        p.y += p.v*devicePixelRatio; p.sw += 0.014; p.rot += 0.008;
        const x = p.x + Math.sin(p.sw)*6*devicePixelRatio;
        if (p.y > H+22) { p.y = -22; p.x = R()*W; }
        ctx.save(); ctx.translate(x,p.y); ctx.rotate(p.rot);
        // 一片主叶
        ctx.fillStyle=`hsla(${p.hue},55%,58%,.92)`;
        ctx.beginPath(); ctx.ellipse(0,0,p.s*0.4,p.s,0,0,TAU); ctx.fill();
        ctx.fillStyle=`hsla(${p.hue+14},50%,48%,.85)`;
        ctx.beginPath(); ctx.ellipse(p.s*0.5, p.s*0.15, p.s*0.42, p.s*0.2, 0.7, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-p.s*0.5, p.s*0.18, p.s*0.4, p.s*0.18, -0.7, 0, TAU); ctx.fill();
        // 中脉
        ctx.strokeStyle='rgba(210,235,195,.55)'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.moveTo(0,-p.s); ctx.lineTo(0,p.s); ctx.stroke();
        ctx.restore();
      }
    }
    if (kind === 'flag') {
      // 国庆：山河——远山层叠 + 明显蜿蜒河流（亮色水面）+ 金色光点（去红旗）
      // 远山（三层，由远及近，颜色渐深，为河留出中间的空间）
      const ridges = [
        { base:H*0.24, amp:H*0.14, col:'rgba(118,128,188,.24)' },
        { base:H*0.36, amp:H*0.17, col:'rgba(88,103,162,.40)' },
        { base:H*0.50, amp:H*0.19, col:'rgba(56,74,136,.56)' },
      ];
      for (const rd of ridges){
        ctx.fillStyle=rd.col;
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x=0; x<=W; x+=6*devicePixelRatio){
          const y = rd.base + Math.sin(x*0.008 + rd.base)*rd.amp + Math.sin(x*0.02)*rd.amp*0.3;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      }
      // 河流：从画布中部蜿蜒流向右下，由窄变宽、亮色水面（明显的一条河）
      const rv = extra.river;
      const sway = t*1.2;
      // 河岸左缘（上边界蜿蜒）与右缘（下边界蜿蜒）构成水面
      const bankTop = rv.map((p,i) => ({ x:p.x, y:p.y + Math.sin(sway+i)*2.4*devicePixelRatio }));
      const bankBot = rv.map((p,i) => ({ x:p.x, y:p.y + 26*devicePixelRatio + Math.sin(sway*0.8+i+1.5)*3*devicePixelRatio + (i/rv.length)*20*devicePixelRatio }));
      // 水面填充（亮蓝，明显的河）
      ctx.fillStyle='rgba(140,190,235,.40)';
      ctx.beginPath();
      bankTop.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      for (let i=bankBot.length-1;i>=0;i--) ctx.lineTo(bankBot[i].x, bankBot[i].y);
      ctx.closePath(); ctx.fill();
      // 河岸亮边（上边缘高光）
      ctx.strokeStyle='rgba(215,235,250,.6)'; ctx.lineWidth=2.4*devicePixelRatio; ctx.lineCap='round';
      ctx.beginPath();
      bankTop.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.stroke();
      // 河面波纹（横向短线，沿河流曲线走势，缓慢流动不频闪）
      ctx.strokeStyle='rgba(220,240,255,.35)'; ctx.lineWidth=1.6*devicePixelRatio; ctx.lineCap='round';
      for (const rp of extra.ripples){
        const pi = extra.river[rp.pi];
        // 沿河岸切线的短线：方向跟随河流局部斜率（不凸出河流）
        const p0 = extra.river[rp.pi], p1 = extra.river[rp.pi+1];
        const ang = Math.atan2(p1.y-p0.y, p1.x-p0.x);
        const gy = pi.y + rp.off + Math.sin(t*rp.sp + rp.ph)*2.5*devicePixelRatio;
        const cx = Math.cos(ang), cy = Math.sin(ang);
        ctx.beginPath();
        ctx.moveTo(pi.x - cx*rp.ln, gy - cy*rp.ln*0.4);
        ctx.lineTo(pi.x + cx*rp.ln, gy + cy*rp.ln*0.4);
        ctx.stroke();
      }
      // 河面闪烁光斑（沿河流，缓慢明灭，不频闪）
      for (const sp of extra.sparkles){
        const pi = extra.river[sp.pi];
        const a = 0.30 + 0.35*(0.5+0.5*Math.sin(t*sp.sp + sp.ph));
        const gy = pi.y + sp.off + Math.sin(t*sp.sp*0.8 + sp.ph)*2.5*devicePixelRatio;
        ctx.fillStyle=`rgba(228,244,255,${a})`;
        ctx.beginPath(); ctx.arc(pi.x + sp.dx, gy, sp.r, 0, TAU); ctx.fill();
      }
      // 金色光点（洒满山河）
      for (const p of parts){ p.tw += p.v; ctx.globalAlpha = 0.3+0.5*Math.abs(Math.sin(p.tw));
        ctx.fillStyle='rgba(255,218,130,.95)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (kind === 'icecrystal') {
      ctx.fillStyle = 'rgba(120,170,220,.05)'; ctx.fillRect(0,0,W,H);
      for (const p of parts){
        const a = 0.2+0.75*Math.abs(Math.sin(p.tw));
        p.tw += p.v;
        ctx.strokeStyle = `rgba(190,225,255,${a})`; ctx.lineWidth = 1;
        if (p.sp){
          ctx.beginPath(); ctx.moveTo(p.x-p.r*2.2, p.y); ctx.lineTo(p.x+p.r*2.2, p.y);
          ctx.moveTo(p.x, p.y-p.r*2.2); ctx.lineTo(p.x, p.y+p.r*2.2); ctx.stroke();
        }
        ctx.fillStyle = `rgba(215,240,255,${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
    }
    if (kind === 'plumrain') {
      // 芒种：梅雨细丝 + 青梅果带叶缓落
      ctx.strokeStyle = 'rgba(175,210,220,.62)'; ctx.lineWidth = 1.5;
      for (const p of parts){ p.y += p.v*devicePixelRatio; if (p.y > H) { p.y = -16; p.x = R()*W; }
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x-2*devicePixelRatio, p.y+p.l*devicePixelRatio); ctx.stroke(); }
      for (const p of extra){
        p.y += p.v*devicePixelRatio; p.sw += 0.015; p.rot += 0.01;
        const x = p.x + Math.sin(p.sw)*7*devicePixelRatio;
        if (p.y > H+20) { p.y = -20; p.x = R()*W; }
        ctx.save(); ctx.translate(x,p.y); ctx.rotate(p.rot);
        // 青梅果（圆润带高光）
        const g = ctx.createRadialGradient(-p.s*0.3, -p.s*0.3, 1, 0, 0, p.s);
        g.addColorStop(0,'rgba(190,225,150,.95)'); g.addColorStop(1,'rgba(120,175,105,.9)');
        ctx.fillStyle=g;
        ctx.beginPath(); ctx.arc(0, 0, p.s, 0, TAU); ctx.fill();
        // 顶上小叶
        ctx.fillStyle='rgba(110,170,110,.85)';
        ctx.beginPath(); ctx.ellipse(p.s*0.35, -p.s*0.85, p.s*0.5, p.s*0.2, 0.5, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
    if (kind === 'thunder') {
      ctx.strokeStyle = 'rgba(180,198,235,.6)'; ctx.lineWidth = 1.4;
      for (const p of parts){ p.y += p.v*devicePixelRatio; if (p.y > H) { p.y = -20; p.x = R()*W; }
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x-2.5*devicePixelRatio, p.y+p.l*devicePixelRatio); ctx.stroke(); }
      const e = extra;
      e.next -= dt;
      // 点击立即落雷：检测到落点信号就立刻出一雷，不等 next 到期
      if (FXSTRIKE_NOW.hit) {
        FXSTRIKE_NOW.hit = false;
        e.flash = 1; e.next = 1.6 + R()*2.6;
        const bx = FXSTRIKE_NOW.x, strikeTo = Math.min(FXSTRIKE_NOW.y, H*0.9);
        const seg=[]; let by=0;
        while (by < strikeTo){ seg.push([bx + (R()-0.5)*40*devicePixelRatio, by]); by += Math.max(6, strikeTo/8); }
        seg.push([bx, strikeTo]);
        e.bolt = seg;
      } else if (e.next <= 0) {
        e.flash = 1; e.next = 1.6 + R()*2.6;
        // 随机落雷：没点就随机落
        const bx = W*(0.25+R()*0.5), strikeTo = H*0.55;
        const seg=[]; let by=0;
        while (by < strikeTo){ seg.push([bx + (R()-0.5)*40*devicePixelRatio, by]); by += Math.max(6, strikeTo/8); }
        seg.push([bx, strikeTo]);
        e.bolt = seg;
      }
      if (e.flash > 0) {
        ctx.fillStyle = `rgba(230,235,255,${e.flash*0.22})`; ctx.fillRect(0,0,W,H);
        if (e.bolt) {
          ctx.strokeStyle = `rgba(255,255,255,${Math.min(1,e.flash*1.6)})`; ctx.lineWidth = 2.4*devicePixelRatio;
          ctx.shadowColor='rgba(200,215,255,.95)'; ctx.shadowBlur=12*devicePixelRatio;
          ctx.beginPath(); e.bolt.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke();
          ctx.shadowBlur = 0;
        }
        e.flash -= dt*2.4;
        if (e.flash < 0) { e.flash = 0; e.bolt = null; }
      }
    }
    if (kind === 'firefly') {
      for (const p of parts){
        p.x += Math.sin(t*0.6 + p.tw)*p.dx*dt; p.y += Math.cos(t*0.45 + p.tw)*p.dy*dt; p.tw += p.tv*dt;
        // 边界环绕：飞出边界从另一边回来，保证一直全屏分散
        if (p.x < -6*devicePixelRatio) p.x = W+6*devicePixelRatio;
        if (p.x > W+6*devicePixelRatio) p.x = -6*devicePixelRatio;
        if (p.y < -6*devicePixelRatio) p.y = H+6*devicePixelRatio;
        if (p.y > H+6*devicePixelRatio) p.y = -6*devicePixelRatio;
        ctx.globalAlpha = 0.15 + 0.8*Math.abs(Math.sin(p.tw));
        ctx.fillStyle = p.warm ? 'rgba(255,228,140,.95)' : 'rgba(190,242,172,.9)';
        ctx.shadowColor = p.warm ? 'rgba(255,222,120,.95)' : 'rgba(180,255,160,.85)'; ctx.shadowBlur = 10*devicePixelRatio;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    }
    if (kind === 'stars' || kind === 'moon') {
      for (const p of parts){ p.tw += p.v; ctx.globalAlpha = 0.35 + 0.55*Math.abs(Math.sin(p.tw)); ctx.fillStyle = kind==='moon' ? 'rgba(255,240,200,.9)' : 'rgba(220,205,255,.95)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (kind === 'stars') {
        const nx = W*0.72, ny = H*0.30;
        const zx = W*0.24, zy = H*0.16;
        const S2 = devicePixelRatio;
        ctx.strokeStyle='rgba(200,190,255,.16)'; ctx.lineWidth=30*S2;
        ctx.beginPath(); ctx.moveTo(nx,ny); ctx.quadraticCurveTo(W*0.48,H*0.42,zx,zy); ctx.stroke();
        const zh=[ [zx,zy],[zx-26*S2,zy+30*S2],[zx,zy+56*S2],[zx+26*S2,zy+30*S2] ];
        ctx.strokeStyle='rgba(255,255,255,.3)'; ctx.lineWidth=1.2;
        ctx.beginPath(); zh.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath(); ctx.stroke();
        zh.forEach(p=>{ const tw=0.6+0.4*Math.sin(t*1.1); ctx.fillStyle=`rgba(255,255,255,${tw})`; ctx.beginPath(); ctx.arc(p[0],p[1],3.4*S2,0,TAU); ctx.fill(); });
        const nh=[ [nx-24*S2,ny-16*S2],[nx+24*S2,ny-16*S2],[nx,ny+20*S2] ];
        ctx.strokeStyle='rgba(255,255,255,.3)';
        ctx.beginPath(); ctx.moveTo(nh[0][0],nh[0][1]); ctx.lineTo(nh[2][0],nh[2][1]); ctx.lineTo(nh[1][0],nh[1][1]); ctx.stroke();
        nh.forEach(p=>{ const tw=0.6+0.4*Math.sin(t*1.1+1); ctx.fillStyle=`rgba(255,255,255,${tw})`; ctx.beginPath(); ctx.arc(p[0],p[1],3.4*S2,0,TAU); ctx.fill(); });
        ctx.fillStyle='rgba(255,255,255,.97)'; ctx.shadowColor='rgba(200,190,255,.95)'; ctx.shadowBlur=12*S2;
        ctx.beginPath(); ctx.arc(zx,zy,5*S2,0,TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(nx,ny+20*S2,5*S2,0,TAU); ctx.fill(); ctx.shadowBlur=0;
      }
      if (kind === 'moon') {
        // 中秋：月亮轻浮动 + 月面环形山阴影 + 云丝掠过
        // 20261028：月亮上移贴右上角（W*0.82/H*0.18），避开左侧「名字+入梦签」文字区和居中标题，
        // 避免长名字把月亮压住看不清。
        const mx = W*0.82, my = H*0.18 + Math.sin(t*0.6)*6*devicePixelRatio, mr = 34*devicePixelRatio;
        const g = ctx.createRadialGradient(mx,my,mr*0.2,mx,my,mr*2.4);
        g.addColorStop(0,'rgba(255,244,214,.85)'); g.addColorStop(0.35,'rgba(255,236,190,.25)'); g.addColorStop(1,'rgba(255,236,190,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx,my,mr*2.4,0,TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,248,225,.96)'; ctx.beginPath(); ctx.arc(mx,my,mr,0,TAU); ctx.fill();
        // 月面环形山（柔和阴影斑）
        ctx.fillStyle='rgba(225,208,168,.5)';
        ctx.beginPath(); ctx.ellipse(mx-mr*0.3, my-mr*0.18, mr*0.22, mr*0.17, 0.4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(mx+mr*0.25, my+mr*0.22, mr*0.16, mr*0.12, -0.3, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(mx+mr*0.05, my-mr*0.42, mr*0.11, mr*0.08, 0.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(mx-mr*0.12, my+mr*0.4, mr*0.09, mr*0.07, 0, 0, TAU); ctx.fill();
        // 月晕外圈
        ctx.strokeStyle='rgba(255,240,200,.28)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(mx,my,mr*1.18+Math.sin(t*1.2)*1.5*devicePixelRatio,0,TAU); ctx.stroke();
        // 云丝（缓慢掠过月前）
        for (let i=0;i<2;i++){
          const cy = my + mr*(0.5+i*0.7), cx = ((t*(6+i*3)) % (W+180)) - 90;
          ctx.fillStyle='rgba(210,200,235,.13)';
          ctx.beginPath(); ctx.ellipse(cx, cy, 60*devicePixelRatio, 8*devicePixelRatio, 0, 0, TAU); ctx.fill();
        }
      }
    }
    if (kind === 'firework' || kind === 'national') {
      for (const b of parts) for (const p of b.burst){
        const px = p.x, py = p.y;
        p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.vy += 1.2 * dt; p.life -= dt * 0.7;
        if (p.life <= 0) continue;
        const g = ctx.createLinearGradient(px, py, p.x, p.y);
        g.addColorStop(0, `hsla(${p.hue},90%,72%,0)`);
        g.addColorStop(1, `hsla(${p.hue},90%,72%,${Math.max(0,p.life)})`);
        ctx.strokeStyle = g; ctx.lineWidth = 2*devicePixelRatio; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = `hsla(${p.hue},95%,78%,1)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2*devicePixelRatio, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      parts = parts.filter(b => b.burst.some(p => p.life > 0));
    }
    if (kind === 'lantern' || kind === 'candle' || kind === 'balloon') {
      for (const p of parts){ p.y -= p.v*devicePixelRatio; p.sw += 0.01; if (p.y < -60) { p.y = H + 40; p.x = R()*W; }
        if (kind==='lantern') drawLantern(p, ctx);
        else if (kind==='candle') {
          const x = p.x + Math.sin(p.sw + p.y*0.006)*10*devicePixelRatio;
          const g = ctx.createRadialGradient(x,p.y,2,x,p.y,p.s*1.4);
          g.addColorStop(0,'rgba(255,190,120,.35)'); g.addColorStop(1,'rgba(255,170,100,0)');
          ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,p.y,p.s*1.4,0,TAU); ctx.fill();
          ctx.fillStyle='rgba(210,60,50,.9)'; ctx.shadowColor='rgba(255,120,80,.8)'; ctx.shadowBlur=12*devicePixelRatio;
          ctx.beginPath(); ctx.ellipse(x,p.y,p.s*0.6,p.s*0.72,0,0,TAU); ctx.fill(); ctx.shadowBlur=0;
          ctx.strokeStyle='rgba(255,200,130,.5)'; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(x,p.y-p.s*0.72); ctx.lineTo(x,p.y-p.s*0.85);
          ctx.moveTo(x,p.y+p.s*0.72); ctx.lineTo(x,p.y+p.s*0.9); ctx.stroke();
        }
        else { const x = p.x + Math.sin(p.sw + p.y*0.005)*14*devicePixelRatio;
          ctx.fillStyle = p.c; ctx.globalAlpha=.9; ctx.beginPath(); ctx.ellipse(x, p.y, p.s*0.62, p.s*0.75, 0, 0, TAU); ctx.fill();
          // 高光，气球质感
          ctx.fillStyle='rgba(255,255,255,.5)'; ctx.beginPath(); ctx.ellipse(x-p.s*0.22, p.y-p.s*0.28, p.s*0.16, p.s*0.24, -0.4, 0, TAU); ctx.fill();
          // 明显的绑绳（长线 + 尾端小蝴蝶结）
          ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.lineWidth=1.4*devicePixelRatio;
          ctx.beginPath(); ctx.moveTo(x, p.y+p.s*0.75);
          ctx.quadraticCurveTo(x+5*devicePixelRatio, p.y+p.s*1.5, x-2*devicePixelRatio, p.y+p.s*2.2);
          ctx.quadraticCurveTo(x-6*devicePixelRatio, p.y+p.s*2.8, x+2*devicePixelRatio, p.y+p.s*3.2); ctx.stroke();
          ctx.lineWidth=1.2*devicePixelRatio;
          ctx.beginPath(); ctx.moveTo(x-4*devicePixelRatio, p.y+p.s*3.2); ctx.lineTo(x+4*devicePixelRatio, p.y+p.s*3.5);
          ctx.moveTo(x-4*devicePixelRatio, p.y+p.s*3.5); ctx.lineTo(x+4*devicePixelRatio, p.y+p.s*3.2); ctx.stroke();
          ctx.globalAlpha=1; }
      }
    }
    if (kind === 'leaf') {
      for (const p of parts){
        p.y += p.v*devicePixelRatio; p.sw += 0.016; p.rot += p.rv;
        const x = p.x + Math.sin(p.sw)*8*devicePixelRatio;
        if (p.y > H+20) { p.y = -20; p.x = R()*W; }
        ctx.save(); ctx.translate(x,p.y); ctx.rotate(p.rot); ctx.fillStyle='rgba(230,170,90,.55)';
        ctx.beginPath(); ctx.ellipse(0,0,p.s,p.s*0.45,0,0,TAU); ctx.fill(); ctx.restore();
      }
    }
    if (kind === 'lightsnow' || kind === 'heavysnow') {
      for (const p of parts){
        p.y += p.v*devicePixelRatio*(kind==='heavysnow'?1.3:1); p.sw += 0.014; p.rot += p.rv||0;
        const x = p.x + Math.sin(p.sw)*(kind==='heavysnow'?12:5)*devicePixelRatio;
        if (p.y > H+10) { p.y = -10; p.x = R()*W; }
        if (kind === 'lightsnow'){ ctx.fillStyle='rgba(255,255,255,.75)';
          ctx.beginPath(); ctx.arc(x, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill(); }
        else { ctx.globalAlpha = 0.5+0.35*Math.sin(p.sw*2);
          drawSnowflake(ctx, x, p.y, p.r*2.4*devicePixelRatio, p.rot); ctx.globalAlpha = 1; }
      }
    }
    if (kind === 'chrysanth') {
      for (const p of parts){
        const ap = Math.max(0, Math.min(1, Math.sin(t*0.4 + p.ph)*1.4));
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t*0.06 + p.ph);
        ctx.globalAlpha = 0.15+0.55*ap;
        for (let i=0;i<p.petals;i++){ ctx.rotate(TAU/p.petals);
          ctx.fillStyle = `hsla(${p.hue},75%,72%,.85)`;
          ctx.beginPath(); ctx.ellipse(0, -p.r*ap, p.r*0.2*ap, p.r*0.62*ap, 0, 0, TAU); ctx.fill(); }
        ctx.fillStyle = `hsla(${p.hue+16},80%,82%,.9)`;
        ctx.beginPath(); ctx.arc(0, 0, p.r*0.24*ap, 0, TAU); ctx.fill();
        ctx.restore(); ctx.globalAlpha = 1;
      }
      for (const p of extra){
        p.y += p.v*devicePixelRatio; p.sw += 0.015; p.rot += p.rv;
        const x = p.x + Math.sin(p.sw)*7*devicePixelRatio;
        if (p.y > H+16) { p.y = -16; p.x = R()*W; }
        ctx.save(); ctx.translate(x,p.y); ctx.rotate(p.rot); ctx.fillStyle='rgba(220,160,90,.45)';
        ctx.beginPath(); ctx.ellipse(0,0,p.s,p.s*0.42,0,0,TAU); ctx.fill(); ctx.restore();
      }
    }
    if (kind === 'choco') {
      for (const p of parts){
        p.y += p.v*devicePixelRatio; p.sw += 0.013; p.rot += p.rv;
        const x = p.x + Math.sin(p.sw)*7*devicePixelRatio;
        if (p.y > H+22) { p.y = -22; p.x = R()*W; }
        ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot);
        if (p.kind === 'choco'){
          ctx.fillStyle = p.c; ctx.globalAlpha = .92;
          ctx.fillRect(-p.s, -p.s*0.75, p.s*2, p.s*1.5);
          ctx.strokeStyle='rgba(255,255,255,.55)'; ctx.lineWidth=1;
          ctx.strokeRect(-p.s, -p.s*0.75, p.s*2, p.s*1.5);
          ctx.beginPath(); ctx.moveTo(-p.s, -p.s*0.75); ctx.lineTo(p.s, p.s*0.75);
          ctx.moveTo(p.s, -p.s*0.75); ctx.lineTo(-p.s, p.s*0.75); ctx.stroke();
          ctx.fillStyle='rgba(90,55,40,.9)'; ctx.fillRect(-p.s*0.45, -p.s*0.34, p.s*0.9, p.s*0.68);
          ctx.globalAlpha = 1;
        } else if (p.kind === 'candy'){
          ctx.fillStyle = p.c; ctx.globalAlpha = .9;
          ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s*0.66, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = p.c; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(-p.s*0.95, -p.s*0.4); ctx.quadraticCurveTo(-p.s*1.5, -p.s*0.8, -p.s*1.4, 0);
          ctx.quadraticCurveTo(-p.s*1.5, p.s*0.8, -p.s*0.95, p.s*0.4); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(p.s*0.95, -p.s*0.4); ctx.quadraticCurveTo(p.s*1.5, -p.s*0.8, p.s*1.4, 0);
          ctx.quadraticCurveTo(p.s*1.5, p.s*0.8, p.s*0.95, p.s*0.4); ctx.stroke();
          ctx.fillStyle='rgba(255,255,255,.45)';
          ctx.beginPath(); ctx.ellipse(-p.s*0.3, -p.s*0.2, p.s*0.3, p.s*0.16, 0, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = 'rgba(255,252,254,.85)';
          ctx.beginPath(); ctx.ellipse(0, 0, p.s*0.5, p.s*1.15, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=0.9;
          ctx.beginPath(); ctx.moveTo(0, -p.s*1.1); ctx.lineTo(0, p.s*1.1); ctx.stroke();
        }
        ctx.restore();
      }
    }
    if (kind === 'sprout') {
      for (const p of parts){
        p.y -= p.v*dt*60*0.4; p.tw += dt*2;
        if (p.y < H*0.25) { p.y = H*0.72; p.x = R()*W; }
        ctx.globalAlpha = 0.35 + 0.5*Math.abs(Math.sin(p.tw));
        ctx.fillStyle = 'rgba(190,255,170,.9)';
        ctx.shadowColor = 'rgba(170,255,150,.9)'; ctx.shadowBlur = 6*devicePixelRatio;
        ctx.beginPath(); ctx.arc(p.x + Math.sin(p.tw*0.6)*8*devicePixelRatio, p.y, p.r*devicePixelRatio, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      for (const sp of extra){
        const grow = Math.min(1, t*0.5 + sp.ph);
        const h = (18 + sp.seed)*devicePixelRatio*grow;
        ctx.strokeStyle = `rgba(${sp.shade},230,${140+(sp.seed%3)*10},.75)`; ctx.lineWidth = sp.w*devicePixelRatio; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(sp.x, H*0.73);
        ctx.quadraticCurveTo(sp.x + sp.lean*8*devicePixelRatio, H*0.73 - h*0.5, sp.x + sp.lean*14*devicePixelRatio, H*0.73 - h); ctx.stroke();
        if (grow > 0.4) {
          ctx.fillStyle = `rgba(${sp.shade},240,${150+(sp.seed%3)*10},.8)`;
          const lx = sp.x + sp.lean*14*devicePixelRatio, ly = H*0.73 - h;
          ctx.beginPath(); ctx.ellipse(lx - 4*devicePixelRatio, ly, 5*devicePixelRatio, 3*devicePixelRatio, -0.6, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.ellipse(lx + 4*devicePixelRatio, ly, 5*devicePixelRatio, 3*devicePixelRatio, 0.6, 0, TAU); ctx.fill();
        }
      }
    }
    _raf = requestAnimationFrame(frame);
  }
  _raf = 0; _raf = requestAnimationFrame(frame);
}
/* ============ 节日/节气 key（festivalCards.js 拼音 id）→ 动画类型 fx 映射 ============ */
const DREAM_FX_MAP = {
  /* 节日 */
  chunjie:'firework', yuanxiao:'lantern', qingming:'apricot', duanwu:'wave',
  qixi:'stars', zhongqiu:'moon', chongyang:'chrysanth', chuxi:'candle',
  ertong:'balloon', baise:'choco', guoqing:'flag', laodong:'wheat',
  /* 节气 */
  lichun:'sprout', yushui:'rainripple', jingzhe:'thunder', chunfen:'swallows',
  guyu:'tea', lixia:'firefly', xiaoman:'wheat', mangzhong:'plumrain',
  xiazhi:'sunburst', xiaoshu:'lotus', dashu:'heatwave', liqiu:'leaf',
  chushu:'riverlamp', bailu:'dew', qiufen:'osmanthus', hanlu:'geese',
  shuangjiang:'frost', lidong:'warmwindow', xiaoxue:'lightsnow', daxue:'heavysnow',
  dongzhi:'plum', xiaohan:'hearth', dahan:'icecrystal',
};

/* 暴露到全局（供 app.js 调用） */
global.DREAM_FX_MAP = DREAM_FX_MAP;
global.BgAudio = BgAudio;
global.FX_AUDIO = FX_AUDIO;
global.FXWIND = FXWIND;
global.FXBURSTS = FXBURSTS;
global.newBurstGlobal = newBurstGlobal;
global.FXSTRIKE_NOW = FXSTRIKE_NOW;
global.strikeBoltGlobal = strikeBoltGlobal;
global.stopFx = stopFx;
global.runFx = runFx;
global.ChimeAudio = ChimeAudio;
/* 寒露露珠交互：runFx(geese) 会写 _dewPts（露珠归一化坐标），
   外部（app.js pointermove）读它做叮铃检测；_dewLastPlay 防抖时间戳同理 */
global.DreamFxDew = { getPts(){ return _dewPts; }, setPts(v){ _dewPts = v; }, getLast(){ return _dewLastPlay; }, setLast(v){ _dewLastPlay = v; } };
global.DreamFxMouse = { set(x, y){ _mousePt.x = x; _mousePt.y = y; }, get(){ return _mousePt; } };

})(window);
