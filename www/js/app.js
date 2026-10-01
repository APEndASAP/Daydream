/* ============================================================
   《白日梦》- 主应用逻辑
   ============================================================ */

const APP_VERSION = '20261001cl'; // 全局版本号（总设置展示；升版时同步 index.html 全部 ?v= 与 README）

let characters = [];
let cards = null;
let currentCharId = null;
let chatGroups = []; // 群聊列表 [{ id, name, memberIds, createdAt }]
let currentGroupId = null; // 当前打开的群聊 id（与 currentCharId 互斥）
let anniversaries = []; // 纪念日 [{ id, charId, date:'MM-DD', reason, createdAt }]
let heartCharId = null; // 心念角色 id
let charGroups = []; // 访客分组 [{ id, name, memberIds, _collapsed }]
let chatSettings = {
  minDelay: 1, maxDelay: 5,      // 回复节奏（秒）5.3
  groupRounds: 2,                // 群聊自动接龙轮次上限 0~5（20260929az 细则；群聊设置可单独覆盖）
  allowFloat2: true,             // 20260929bi：悬浮窗2号（缩小后的通话小窗）允许拖动浮游
  float2Mode: 'inner',           // 20260929bk：悬浮窗2号模式 inner=软件内悬浮 / system=其他应用上悬浮（网页端回退软件内）
  notifySystem: true,            // 20260929bi：系统通知（挂后台/切走时弹 QQ 式系统弹窗），需浏览器通知权限
  proactive: false,              // 访客主动发消息 5.3
  proactiveMin: 10,              // 主动消息间隔（分钟）1~120
  proactiveRandom: false,        // 随机主动发消息：开启后在下方区间内随机时刻发，不再按固定间隔
  proactiveRandMin: 10,          // 20260929bf 随机发消息区间·最小（分钟）
  proactiveRandMax: 120,         // 20260929bf 随机发消息区间·最大（分钟）
  proactiveCheckin: false,       // 访客随机查岗：开启后访客随机向玩家发查岗卡片（15.1；每日上限见 checkinDailyLimit，0=不限）
  checkinDailyLimit: 0,          // 随机查岗每日上限（20260929an：0=不限制；可在角色聊天设置里调）
  randomCall: false,             // 访客随机发起/接收视频通话：开启后访客随机来电，也会随机给你发视频通话
  callDailyLimit: 0,             // 随机来电每日上限（20260929an：0=不限制；可在角色聊天设置里调）
  randomPacket: false,           // 20260929ba 访客随机发红包：独立固定随机间隔模式（与查岗/通话同款）
  overclockProactive: true,      // 超频独立随机触发总开关（默认开启）
  overclockIntervalMin: 20,       // 超频随机触发最小间隔（分钟）
  overclockIntervalMax: 240,      // 超频随机触发最大间隔（分钟）
  developerMode: false,           // 开发者命令模式，默认关闭
  soundOn: true,                 // 消息提示音 5.3
  soundName: '默认',             // 提示音名称（可自定义）
  customSound: '',               // 自定义提示音（玩家上传的音频 dataURL）
  allowRecall: true,             // 允许撤回消息 5.3
  charPoke: 'mid',               // 访客随机戳一戳：off 关 / mid 偶尔(10%) / often 经常(25%)
  lettersEnabled: true,          // 访客随机来信总开关（书信 13）
  lettersDailyLimit: 2,          // 访客随机来信每日上限（0~5，书信 13）
  skipOverclockAnim: false,      // 超频：跳过裂隙动画（20260929ao；低端机/卡顿时建议开启）
};

/* 聊天美化（气泡颜色+自定义CSS存全局 chatTheme；背景图按角色独立存 character.chatBg；22：群聊气泡统一用总设置）
   10：新增三处全局背景——聊天导航页 / 个人主页（背景图下方黑色区域）/ 朋友圈整体背景 */
let chatTheme = {
  bubbleMe: '#8b5cf6',    // 我的气泡颜色
  bubbleMeText: '#ffffff',
  bubbleThem: '#26232e',  // 对方气泡颜色
  bubbleThemText: '#f2f0f6',
  customCss: '',          // 自定义 CSS（聊天美化，用户手写）
  navBg: '',              // 聊天导航页面背景
  homeBg: '',             // 个人主页背景（背景图下方区域）
  momentsBg: '',          // 朋友圈整体背景
  glassUI: false,         // 玻璃拟态模式（可选，开启后系统界面切到更透明磨砂玻璃）
  fontId: '',             // 聊天字体（20260929af：织梦点-更换字体；''=系统默认）
  uiFontId: '',           // 全局 UI 字体（20260929ah：织梦点-全局字体，应用到所有界面；''=系统默认）
};

/* 玩家资料 */
let playerProfile = {
  name: '白日梦主人',
  avatar: '',
  bg: '',
  status: '入梦中',
  sign: '做个好梦',
  wallet: 0,
};

/* 20260930bx：开屏音乐继续播放开关状态（主页顶栏 🎵 按钮读写；splash.js 独立读 IndexedDB 同键） */
let _splashAutoplay = false;

/* ---------- 工具 ---------- */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

/* 纯横线/分割装饰符号判定（全局版，禁词弹窗等渲染层也用它兜底过滤）：
   先剥离零宽字符/软连字符/变体选择符等不可见字符（导入字卡包常混入，导致肉眼是纯横线
   却匹配不上正则而漏网），剩余字符全部属于"横线族"且 ≥2 个码点 → 判为垃圾。
   省略号/波浪号/星号等可能是正常文案，不删。 */
function isLineJunkText(t) {
  if (typeof t !== 'string') return false;
  const s = t.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u180E\u00AD\uFE00-\uFE0F\u0300-\u036F]/g, '').trim();
  if (!s) return false;
  // 横线族全量字符类：box drawing(─━)、连字符/破折号(‐‑‒–—―)、em/en dash、
  // 上划线族(‾¯ˉˍ￣)、扩展线(⎯▔⁃᠆᐀)、低线族(︃︄﹍﹎﹏)、块线(▁▔)、
  // 重减号(➖)、片假名长音(ー)、汉字"一"、波浪/全角波浪(〜〰～)、下划线/等号/点。
  // 注意：必须"整条只由横线族组成"才判定为装饰（颜文字 ⌓‿⌓、(눈‸눈) 等混有其他字符不会误杀）
  const lineChars = /^[\s\u00AF\u02C9\u02CD\u1400\u1806\u2043\u23AF\u2594\u2581\u2594\u2796\u2E3A-\u2E3C\u2500-\u257F\u2010-\u2015\u203E\u301C\u3030\u3033-\u3035\u30FC\u4E00\uFE33\uFE34\uFE4B-\uFE4F\uFE58\uFE63\uFFE3\uFF0D\uFF3F\uFF5E_\uFF1D=\-—–~.]+$/.test(s);
  return lineChars && [...s].length >= 2;
}

/* ---------- 初始化 ---------- */

/* 字卡库净化：清掉旧版本/导入残留的垃圾数据（空字符串字卡、无名字且无内容的空分组、
   非对象分组、纯横线装饰符号条目）。空条目和横线符号（导入字卡包里自带的"──────"类
   分隔装饰）会导致禁词弹窗出现整排空条纹、字卡库出现空行、聊天抽到空气泡。
   只删"确凿的垃圾"，正常数据一律不动；有清理时回写数据库。 */
function sanitizeCards(c) {
  if (!c || typeof c !== 'object') return false;
  let dirty = false;
  const isText = (t) => typeof t === 'string' && t.trim();
  // 横线垃圾判定统一走全局 isLineJunkText（剥离不可见字符 + 横线族全量，含 一/ー 等易混字符）
  const cleanList = (arr) => Array.isArray(arr) ? arr.filter(t => isText(t) && !isLineJunkText(t)) : arr;
  const cleanArr = (key) => {
    if (!Array.isArray(c[key])) return;
    const filtered = cleanList(c[key]);
    if (filtered.length !== c[key].length) { c[key] = filtered; dirty = true; }
  };
  ['customReplies', 'customPokes', 'customPlayerPokes', 'customStatuses', 'customMottos', 'customIntros', 'customEmojis'].forEach(cleanArr);
  const cleanGroups = (key) => {
    if (!Array.isArray(c[key])) return;
    const before = c[key].length;
    c[key] = c[key].filter(g => {
      if (!g || typeof g !== 'object' || !g.id) return false;      // 非对象/无 id：垃圾
      // 分组名本身是横线装饰行（导入字卡包用"────"当分隔行被解析成分组）：
      // 清空名字让它走下方"无名字且无内容"规则——没内容的直接删掉，
      // 真有内容的保留（渲染层会显示为未命名分组），正常分组一律不动
      if (typeof g.name === 'string' && isLineJunkText(g.name)) { g.name = ''; }
      if (Array.isArray(g.items)) {
        const items = g.items.filter(t => isText(t) && !isLineJunkText(t));
        if (items.length !== g.items.length) g.items = items;       // 清掉空字符串/横线符号条目
      }
      const hasName = typeof g.name === 'string' && g.name.trim();
      const hasItems = Array.isArray(g.items) && g.items.length > 0;
      return hasName || hasItems;                                   // 无名字且无内容：空分组，删
    });
    if (c[key].length !== before) dirty = true;
  };
  ['customReplyGroups', 'customPokeGroups', 'customStatusGroups', 'customBanWordGroups'].forEach(cleanGroups);
  return dirty;
}

async function init() {
  /* 20260929ad：数据源门卫第二道——index.html head 脚本判定非 8902 时已置
     __BM_ORIGIN_OK=false，且正常情况下页面早已 replace 跳走；若跳转被宿主预览
     面板拦截，这里直接不初始化（不建库不渲染），保护页由 head 脚本注入。
     根治"文件卡片打开 → 空库界面 → 以为数据串了"（数据全在 8902，一份没丢）。 */
  if (window.__BM_ORIGIN_OK === false) return;
  /* 20260929ab：一次性自动清库（?autoclear=1）——用户要求"直接帮我清除"，
     入口=带参链接，打开即清空全部 5 个 store（与总设置「重置」同一套动作），
     然后抹掉参数自动刷新，落到全新初始状态。只认显式参数，绝非常规行为。 */
  if (/[?&]autoclear=1/.test(location.search)) {
    try {
      await Promise.all([idbClear('characters'), idbClear('messages'), idbClear('kv'), idbClear('emojis'), idbClear('palace'), idbClear('surveys'), idbClear('gifts')]);
      sessionStorage.setItem('__justAutocleared', '1');
    } catch (e) { console.error('[白日梦] 自动清库异常', e); }
    try {
      const clean = location.pathname + location.search.replace(/[?&]autoclear=1/, '').replace(/^\?$/, '') + location.hash;
      history.replaceState(null, '', clean);
    } catch (e) {}
    location.reload();
    return; // 刷新后走正常启动
  }
  if (sessionStorage.getItem('__justAutocleared') === '1') {
    sessionStorage.removeItem('__justAutocleared');
    setTimeout(() => showToast('已清空全部数据，现在是全新初始状态'), 600);
  }
  /* 20260929ap：重看超频首次动画（?ocredo=1）——只清超频解锁标记与初始项链记录，
     其余数据全部保留；因为 ap 修复了 firstUse 天数误算 bug，部分用户被误触发过，需要重看入口。 */
  if (/[?&]ocredo=1/.test(location.search)) {
    try {
      await idbDelete('kv', 'oc_unlocked');
      await idbDelete('kv', 'oc_seen');
      await idbDelete('kv', 'oc_surpriseUnlocked');
      // firstUse 拨回 3 天前（格式与 todayKey 一致 YYYY-M-D），下次进聊天立即触发完整动画
      const d = new Date(Date.now() - 3 * 86400000);
      await idbPut('kv', { key: 'oc_firstUse', value: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` });
      const gifts = await idbGetAll('gifts');
      for (const g of gifts) { if (g.isInitial) await idbDelete('gifts', g.id); }
    } catch (e) { console.error('[白日梦] ocredo 异常', e); }
    try {
      const clean = location.pathname + location.search.replace(/[?&]ocredo=1/, '').replace(/^\?$/, '') + location.hash;
      history.replaceState(null, '', clean);
    } catch (e) {}
    location.reload();
    return;
  }
  document.body.dataset.view = 'home'; // 3.3：启动后默认进入个人主页
  // 启动加载段包 try/catch：任何异常都不能让界面空白。出错时照样渲染界面。
  // 20260929z：应用内开屏动画（#splash"正在入梦中"）整体删除——启动器已有入梦动画，两段重复
  try {
    cards = await loadCards();
    if (sanitizeCards(cards)) {
      await saveCards(cards);
      console.log('[白日梦] 已清理字卡库冗余数据');
    }
    await refreshCharacters();
    chatGroups = await getSetting('chatGroups', []);
    playerProfile = Object.assign({ name: '白日梦主人', avatar: '', bg: '', status: '入梦中', sign: '做个好梦', wallet: 0 }, await getSetting('playerProfile', {}));
    chatSettings = Object.assign(chatSettings, await getSetting('chatSettings', {}));
    chatTheme = Object.assign(chatTheme, await getSetting('chatTheme', {}));
    floatSettings = Object.assign(floatSettings, await getSetting('floatSettings', {}));
    anniversaries = await getSetting('anniversaries', []);
    heartCharId = await getSetting('heartCharId', null);
    charGroups = await getSetting('charGroups', []);
    // 20260929bk：软件声明未同意时提前置 gate，保证后续启动的定时器（随机来电/超频/书信等）
    // 触发前 gate 已生效，任何打断弹窗都被抑制，声明弹窗始终排在最前
    try {
      if (!(await getSetting('softwareNoticeAgreed'))) _noticeGate = true;
    } catch (e) {}
  } catch (e) {
    console.error('[白日梦] 启动加载异常（已跳过，界面照常显示）', e);
  }
  hydrateIcons();
  showStars();
  // 20260929al：先注册玩家上传的自定义字体（FontFace），再应用主题——
  // 否则 uiFontId 指向自定义字体时 chatFontOf 查表为空会回退系统默认
  await loadCustomFonts();
  // Q9 绘制开销降级：低端机统一打标，CSS 侧关闭 backdrop-filter 毛玻璃（最大绘制开销源）
  if (isLowEndDevice()) document.body.classList.add('low-end');
  await initGlassLevel(); // 20260929bh：玻璃三档精度——读上次的自动降级档位（避免每次会话重走降级）
  await loadGlobalTheme(); // 20260929bo：全局色彩预设（先于 applyChatTheme，浅色主题 class 一次到位）
  applyChatTheme();
  try {
    await showDailyCard();
    renderChatList();
    renderPlayerHome();
    renderEmojiGrid();
    renderPokeList();
    buildPlusPanel();
    bindEvents();
    startProactiveTimer(); // 5.3 主动发消息
    startStatusTimer();    // 7 聊天页顶部状态按时段自动换
    startDayRolloverTimer(); // 8 聊天天数过零点自动 +1
    startMomentsTick();    // 9 朋友圈：访客随机发帖 + 互动补算（每 45 秒）
    startNotebookTimer();  // 记事簿：到点提醒（30 秒一查）
    startLetterTimer();    // 书信：梦角随机来信（30 分钟一查，频率完全随机）
    startLetterReplyWatcher(); // 书信：待回信队列补投（20260925i，修复刷新后回信丢失）
    startGroupAutoChatTimer(); // 20260929ae：群聊自主聊天（AI 模式）
    startSurveyTimer(); // 20260929al：问卷答题调度（玩家发问卷→角色按排队顺序作答）
    startOverclockWatcher(); // 20260929ao：超频首次使用日期记录
    // 20260929au：加载跨角色未读事件表，刷新红点
    await _loadUnreadEvents();
    refreshUnreadBadges();
    // 请求通知权限（2.5：后台消息/通话提醒）；浏览器要求手势 → 首次点击时补申请
    requestNotificationPermission();
    setupNotifyFirstGesture();
  } catch (e) {
    console.error('[白日梦] 界面初始化异常', e);
  }
  showDataSourceWarning(); // 20260929z：非 8902 入口打开时提示数据源隔离（数据串防呆）
  showSoftwareNotice(); // 20260929bj：首次打开一次性软件声明弹窗（已同意则跳过）
}

/* ---------- 20260929z：数据源警示（"数据又串了"防呆） ----------
   IndexedDB 按浏览器 origin 隔离：127.0.0.1:8902 预览卡 / 启动器文件卡落在的宿主静态服务
   (如 127.0.0.1:55625) / file:// 直开，三者是互不相通的数据空间。只要不是从 8902 打开，
   顶部就显示一条警示——数据没丢，全在 8902 那份里；关闭后本次会话（同 origin）不再提示 */
function showDataSourceWarning() {
  // 20260930cd：GitHub Pages（*.github.io）为正式发布入口，不显示"数据源"警示
  // 20260930cg-apk：Capacitor 安卓壳（https://localhost / capacitor://）同为合法数据源，不警示
  const hn = location.hostname;
  const on8902 = location.hostname === '127.0.0.1' && location.port === '8902';
  const onPages = /(^|\.)github\.io$/i.test(hn);
  const onCapacitor = hn === 'localhost' || (hn === '127.0.0.1') || location.protocol.startsWith('capacitor');
  if (on8902 || onPages || onCapacitor) return;
  try { if (sessionStorage.getItem('bm_srcwarn')) return; } catch (e) {}
  const where = location.protocol === 'file:' ? '本地文件（file://）方式'
    : (location.hostname + (location.port ? ':' + location.port : ''));
  const bar = document.createElement('div');
  bar.id = 'src-warn';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:300;display:flex;align-items:center;gap:10px;padding:9px 12px 9px 14px;background:linear-gradient(90deg,rgba(167,139,250,.18),rgba(167,139,250,.08));border-bottom:1px solid rgba(167,139,250,.35);backdrop-filter:blur(8px);font-size:12px;color:var(--text-secondary);line-height:1.6;';
  const txt = document.createElement('span');
  txt.style.cssText = 'flex:1;min-width:0;';
  txt.innerHTML = '⚠ 当前从 <b style="color:var(--purple-soft);white-space:nowrap;">' + escapeHtml(where) + '</b> 打开，与常用入口（127.0.0.1:8902）的数据<b>互不相通</b>——若访客 / 聊天记录"消失"，数据没有丢，请改用 8902 预览卡进入。';
  const x = document.createElement('button');
  x.className = 'icon-btn';
  x.textContent = '✕';
  x.style.cssText = 'flex-shrink:0;width:26px;height:26px;font-size:12px;';
  x.onclick = () => { bar.remove(); try { sessionStorage.setItem('bm_srcwarn', '1'); } catch (e) {} };
  bar.appendChild(txt);
  bar.appendChild(x);
  document.body.appendChild(bar);
}

/* ---------- 20260929bj：软件声明（首次打开一次性弹窗） ----------
   20260929bk 重做：结构化七节。
   20260929bl 重排：参考公众号排版（小红书参考图）——小字英文眉题 + 大标题 + 编号小节
   （01~07 斜体数字+渐隐线）+ 首行缩进段落 + 右下署名，保持紫色玻璃风格；
   修复：内联 overflow:auto 使装饰光斑（blob right:-90px）撑出横向滚动、可右滑出现左侧裁切
   → 改 overflow-y:auto + overflow-x:hidden。
   ① 首次打开 = 最高优先级：_noticeGate 抑制来电/超频/书信等一切打断弹窗，必须点同意才能进
     （bl：首次模式不再显示 ✕，唯一出口=同意按钮，严格落实「必须点我已知晓」）。
   ② 从总设置「软件声明」重看时 opts.review=true：不设 gate、可点 ✕ 关闭（关闭后自动回总设置）。 */
async function showSoftwareNotice(opts = {}) {
  const isReview = !!opts.review;
  try {
    const agreed = await getSetting('softwareNoticeAgreed');
    if (!isReview && agreed) return; // 已同意且非主动重看 → 跳过
    if (!isReview && !agreed) _noticeGate = true;
  } catch (e) { if (!isReview) _noticeGate = true; }

  /* 编号小节：01~07 斜体数字 + 渐隐线 + 标题（可带英文小字），正文为若干段 */
  const sec = (num, title, en, paras) => `
    <div class="nt-sec">
      <div class="nt-num">${num}</div>
      <div class="nt-sec-title">${title}${en ? `<span class="nt-en">${en}</span>` : ''}</div>
      ${paras.map(p => `<p class="nt-p${p.indent ? ' indent' : ''}">${p.html}</p>`).join('')}
    </div>`;
  const cl = (t) => ({ html: t });           // 条款段（带序号加粗，不缩进）
  const prose = (t) => ({ html: t, indent: true }); // 散文段（首行缩进）

  openModal(`
    <div class="oc-star-modal notice-modal" style="max-height:80vh;overflow-y:auto;overflow-x:hidden;">
      <div class="oc-star-field"></div>
      <div class="nt-blobs"><div class="oc-star-blob oc-star-blob1"></div><div class="oc-star-blob oc-star-blob2"></div></div>
      <div class="notice-doc">
        <div class="nt-eyebrow">Bairimeng · Software Notice</div>
        <div class="nt-title">《白日梦》<br>软件声明与使用须知</div>
        <div class="nt-sub">本网站/软件由小红书用户：@蓝色鸽子窝（1139353519）原创制作</div>
        <div class="nt-sub" style="margin-top:4px;">参考学习了小红书 @milk（1149615009）老师所制作的传讯字卡网站中字卡部分的代码，兼容其字卡导入</div>
        ${isReview ? '<button class="icon-btn" id="notice-close" style="position:absolute;top:0;right:0;color:rgba(230,222,255,0.9);">✕</button>' : ''}
        <div class="nt-line"></div>
        <p class="nt-lead">感谢你来到《白日梦》。为了维护良好的创作与交流环境，请在下载、使用或分享本软件前，仔细阅读以下声明。</p>

        ${sec('01', '软件性质与数据安全', 'Nature', [
          cl('<b>1. 静态前端 · 纯单机运行：</b>本软件本质上是一个纯前端静态程序。它不依赖任何官方服务器，也没有云端数据库，所有数据全部储存在你自己的设备本地。开发者及第三方均无法读取、获取您的任何数据。'),
          cl('<b>2. 字卡需自行配置：</b>本软件不自带完整字卡库（仅包含少量预设字卡作为开箱体验）。核心聊天内容完全由你自己的字卡库驱动，需要你自行导入或手动配置。'),
          cl('<b>3. API 需自行配置：</b>如需使用 AI 模式，你需要自行准备 API 链接、Key 和模型名（软件会提供测试连接按钮）。若没有配置 API，软件将自动回退到字卡模式运行。'),
        ])}

        ${sec('02', '用户内容与 AI 免责声明', 'Content & AI', [
          cl('<b>1. 用户生成内容负责：</b>本软件仅提供工具。所有用户自定义的字卡、图片、礼物、世界观、关系网等文本和内容，均由用户自行创作、自行导入添加，与开发者无任何关联，由用户本人对内容全权负责。'),
          cl('<b>2. AI 对话免责：</b>AI 角色对话回复由第三方 AI 模型生成，全部对话均为虚构娱乐内容，不代表开发者立场。请理性区分虚拟与现实，请勿过度代入。'),
          cl('<b>3. API 风险提醒：</b>用户自行配置的第三方 API 所生成的一切文字、内容及产生的任何后果，均与本软件及作者无关。请确保你使用的第三方 API 服务符合当地法律法规。'),
        ])}

        ${sec('03', '年龄限制与违规行为', 'Age & Conduct', [
          cl('<b>1. 禁止未成年人使用：</b>本软件不支持 18 岁以下未成年人使用。因使用本产品所产生的全部后果，由使用者本人（若为未成年人则由其监护人）自行承担，与开发者无关。'),
          cl('<b>2. 严禁违规违法行为：</b>使用者严禁借助本软件、本网站实施违反国家法律法规的行为，包括但不限于传播违规信息、侵害他人名誉、著作权以及其他合法权益。若出现违法行为，一切责任由使用者自行承担。'),
        ])}

        ${sec('04', '版权与转载 / 二创规则', 'Copyright', [
          cl('<b>1. 允许二传：</b>欢迎将本软件分享给更多人。'),
          cl('<b>2. 禁止二改：</b>不允许直接修改、魔改本软件或本网站进行发布。'),
          cl('<b>3. 参考学习：</b>可以参考学习本软件的代码，甚至使用代码进行相似功能的开发，但请务必标明出处。'),
          cl('<b>4. 严正声明：</b>本软件绝对禁止任何形式的商用、盈利行为，严禁倒卖。'),
        ])}

        ${sec('05', '关于我们的相处边界', 'Boundaries', [
          prose('《白日梦》是一个充满爱意的个人小项目，为了让这里的氛围保持简单友好，以下情况请止步：'),
          cl('1. 希望在评论区引战、辱骂他人，或者不尊重他人爱好的人。'),
          cl('2. 认为使用本软件会导致"怪力乱神"等迷信事件的人。'),
          cl('3. 遇到第三方 API 中转站问题，直接向作者发泄甚至迁怒作者的人。'),
          cl('4. 希望得到"保姆级一条龙服务"，不愿看教程、也不愿自行探索的朋友。'),
          cl('（说明：作者是一个人兼职在做，精力有限，希望大家互相体谅。）'),
        ])}

        ${sec('06', '本软件面向以下人群', 'For You', [
          cl('1. 轻量化用户：对功能丰富度要求不高，仅需纯粹的聊天功能，或是刚上手想尝试的新用户。'),
          cl('2. 进阶创作型用户：同时有字卡传讯、API 使用需求，以及希望建立 OC 关系网与世界观的人群。'),
          cl('3. 愿意尝试本软件的人：对新生事物抱有好奇心，愿意下载体验，并按照自己的节奏去探索和使用的玩家。'),
          cl('4. 包容且乐于反馈的用户：能接受本软件"佛系更新"的节奏，愿意向作者反馈 Bug 的人。'),
        ])}

        ${sec('07', '写在最后', 'Finally', [
          prose('《白日梦》是一个纯粹的个人创作。希望在这里，你能卸下现实的重担，与访客们一起做一场好梦。感谢你的理解与支持。'),
        ])}

        <div class="nt-sign">—— 本声明最终解释权归作者 @蓝色鸽子窝 所有</div>

        <div class="nt-seal" aria-hidden="true">
          <div class="nt-seal-ring"></div>
          <div class="nt-seal-star">✶</div>
          <div class="nt-seal-cap">BAIRIMENG</div>
        </div>

        <div style="margin-top:20px;">
          <button class="btn primary block" id="notice-agree" style="white-space:normal;line-height:1.6;padding:13px 16px;font-size:14px;border-radius:14px;">我已知晓上述全部内容，我承诺我已满18岁，将会遵守上述内容</button>
        </div>
      </div>
    </div>`, { glass: true, narrow: true, noBackdrop: true });

  const releaseGate = () => { _noticeGate = false; };
  const agree = async () => {
    try { await setSetting('softwareNoticeAgreed', '1'); } catch (e) {}
    releaseGate();
    closeModal();
  };
  const agreeBtn = $('#notice-agree');
  if (agreeBtn) agreeBtn.onclick = agree;
  const closeBtn = $('#notice-close'); // 仅重看模式渲染（关闭后自动回总设置，走 _settingsActive）
  if (closeBtn) closeBtn.onclick = () => { releaseGate(); closeModal(); };
}

/* 入梦签补弹：0 点跨天时若玩家正开着页面则不打断（不弹）；
   玩家切走再切回来（=「下次进入页面」）时自动补弹当天的入梦签。幂等：当日已弹/已收下则不弹 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    try { showDailyCard().catch(() => {}); } catch (e) {}
    // 回到页面时聊天页顶部状态可能已跨时段，立即校准一次
    try { if (document.body.dataset.view === 'chat' && currentCharId) restoreChatHeaderStatus(); } catch (e) {}
  }
});
window.addEventListener('pageshow', () => { try { showDailyCard().catch(() => {}); } catch (e) {} });

/* ---------- 低端设备检测（3.2/21：低端机自动省略星光和部分光晕，保证不卡顿） ---------- */
function isLowEndDevice() {
  try {
    const mem = navigator.deviceMemory || 8;          // 设备内存（GB），不支持则默认 8
    const cores = navigator.hardwareConcurrency || 8; // CPU 逻辑核数
    return mem <= 3 || cores <= 4;
  } catch (e) {
    return false;
  }
}

/* ---------- 20260929bh：动态玻璃拟态精度系统（三档）+ 运行时自动降级 ----------
   hi（高精度，默认）：全部磨砂效果（现状 blur 11~26px + 光泽阴影），适用内存 ≥6GB 或性能中上
   mid（中精度）：磨砂保留但模糊统一降到 8px，去掉外泛白光与复杂高光，只留半透明底色——
                 GPU 运算量大幅下降，肉眼仍是毛玻璃。适用内存 ~4GB 或实测帧率 45~55fps
   low（低精度）：完全不用 backdrop-filter，改用带边框的半透明纯色卡片模拟玻璃质感，零模糊开销。
                 适用内存 ≤3GB 或实测帧率 <45fps
   自动降级红线：玻璃开启后启动帧率监测，连续 3 秒 <45fps 降一档；
   low 档仍连续 3 秒 <45fps → 整体关闭玻璃切回普通模式，提示「为了保持流畅，已为你切换至普通模式」。
   降级结果持久化（kv glassAutoLevel），下次启动直接沿用；手动切换玻璃开关时清除重判。 */
let _glassLevel = 'hi';    // hi | mid | low（当前生效档位）
let _glassManual = '';      // 20260929bj：手动选择的档位 hi|mid|low；''=跟随系统自动
let _noticeGate = false;    // 20260929bk：软件声明弹窗显示期间=true，抑制来电/超频/书信等打断弹窗，保证声明始终在最前
let _glassFpsState = null; // { raf, frames, winStart, lowSec }
let _glassFpsDelay = null;

/* 初始档位判定：设备内存优先，未知时按逻辑核数兜底，完全未知默认高精度（交给运行时降级） */
function glassBaseLevel() {
  try {
    const mem = navigator.deviceMemory || 0; // GB；不支持该 API 时为 0（未知）
    if (mem >= 6) return 'hi';
    if (mem >= 4) return 'mid';
    if (mem >= 1) return 'low'; // ≤3GB
    const cores = navigator.hardwareConcurrency || 0;
    if (cores >= 8) return 'hi';
    if (cores >= 4) return 'mid';
    return 'hi';
  } catch (e) { return 'hi'; }
}

/* 启动时读上次的档位（自动降级结果 或 手动选择），手动选择优先于自动降级 */
async function initGlassLevel() {
  _glassLevel = glassBaseLevel();
  try {
    // 20260929bj：手动选择档位优先（玩家明确指定高/中/低，锁定该档，不再被自动降级覆盖）
    const manual = await getSetting('glassManualLevel');
    if (manual === 'hi' || manual === 'mid' || manual === 'low') {
      _glassManual = manual;
      _glassLevel = manual;
      return;
    }
    const saved = await getSetting('glassAutoLevel');
    if (saved === 'mid' || saved === 'low') _glassLevel = saved;
  } catch (e) {}
}

/* 统一应用玻璃档位：glass-ui 总开关 + glass-mid/glass-low 档位类 + 帧率监测启停 */
function applyGlassMode() {
  const on = !!chatTheme.glassUI;
  document.body.classList.toggle('glass-ui', on);
  document.body.classList.toggle('glass-mid', on && _glassLevel === 'mid');
  document.body.classList.toggle('glass-low', on && _glassLevel === 'low');
  if (on && !document.body.classList.contains('low-end')) _glassFpsStart();
  else _glassFpsStop();
}

/* 帧率监测：rAF 每秒结算一次 fps；启动延迟 4 秒（避开启动重负载误判）；连续 3 秒 <45 触发降档 */
function _glassFpsStart() {
  if (_glassFpsState || _glassFpsDelay) return;
  _glassFpsDelay = setTimeout(() => {
    _glassFpsDelay = null;
    if (!document.body.classList.contains('glass-ui')) return; // 延迟期间被关闭
    const st = { raf: 0, frames: 0, winStart: performance.now(), lowSec: 0 };
    _glassFpsState = st;
    const tick = (t) => {
      if (_glassFpsState !== st) return;
      st.frames++;
      if (t - st.winStart >= 1000) {
        const fps = (st.frames * 1000) / (t - st.winStart);
        st.frames = 0; st.winStart = t;
        if (fps < 45) st.lowSec++; else st.lowSec = 0;
        if (st.lowSec >= 3) { _glassDegrade(); return; }
      }
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
  }, 4000);
}
function _glassFpsStop() {
  if (_glassFpsDelay) { clearTimeout(_glassFpsDelay); _glassFpsDelay = null; }
  if (_glassFpsState) { cancelAnimationFrame(_glassFpsState.raf); _glassFpsState = null; }
}

/* 降一档：hi→mid→low→关闭玻璃（普通模式）；每步温和提示并持久化结果
   20260929bj：玩家手动锁定档位时（_glassManual 非空），帧率不足也不再自动降级——
   尊重玩家自己的选择（自动降级只在"跟随系统"模式下生效）。 */
async function _glassDegrade() {
  _glassFpsStop();
  if (_glassManual) { miniToast('已手动锁定 ' + (_glassManual === 'hi' ? '高' : _glassManual === 'mid' ? '中' : '低') + '精度，帧率不足也不自动降级'); return; }
  if (_glassLevel === 'hi') {
    _glassLevel = 'mid';
    applyGlassMode();
    miniToast('为保持流畅，磨砂效果已降低一档');
  } else if (_glassLevel === 'mid') {
    _glassLevel = 'low';
    applyGlassMode();
    miniToast('为保持流畅，磨砂效果已降低一档');
  } else {
    chatTheme.glassUI = false;
    try { await setSetting('chatTheme', chatTheme); } catch (e) {}
    applyGlassMode();
    miniToast('为了保持流畅，已为你切换至普通模式');
  }
  try { await setSetting('glassAutoLevel', _glassLevel); } catch (e) {}
}

/* ---------- 星光背景（11：保留星点动态效果；挑几颗做成大号四芒星，大小错落不一） ---------- */
function showStars() {
  const sf = $('#starfield');
  const low = isLowEndDevice();
  const smallN = low ? 10 : 34;
  const midN = low ? 2 : 8;
  const sp4N = low ? 0 : 5; // 大四芒星带 clip-path 光晕 + 自转，低端机直接省略
  // 小星点（数量多、大小 1.5~3.5px 错落）
  for (let i = 0; i < smallN; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const size = 1.5 + Math.random() * 2;
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 100 + '%';
    s.style.animationDelay = Math.random() * 3 + 's';
    s.style.animationDuration = (2 + Math.random() * 3) + 's';
    sf.appendChild(s);
  }
  // 中星点（4~6px，微光晕）
  for (let i = 0; i < midN; i++) {
    const s = document.createElement('div');
    s.className = 'star mid';
    const size = 4 + Math.random() * 2.5;
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 100 + '%';
    s.style.animationDelay = Math.random() * 3 + 's';
    s.style.animationDuration = (2.5 + Math.random() * 3) + 's';
    sf.appendChild(s);
  }
  // 大号四芒星（5 颗，clip-path 四芒星形状 + 光晕，大小错落，适度调小）
  for (let i = 0; i < sp4N; i++) {
    const s = document.createElement('div');
    s.className = 'star sp4';
    const size = 10 + Math.random() * 6; // 10~16px 错落
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = Math.random() * 92 + '%';
    s.style.top = Math.random() * 92 + '%';
    s.style.animationDelay = Math.random() * 4 + 's';
    s.style.animationDuration = (3.5 + Math.random() * 3) + 's';
    sf.appendChild(s);
  }
}

/* ---------- 20260929z：开屏动画已删除（原 playSplash + 8 秒保险 + #splash DOM）——
   入梦加载动画只保留启动器一段，软件内直接进主页，避免两段动画重复 ---------- */

/* ---------- 每日弹卡（7.1：每天只弹一次；当天内容固定不变；7.2 内容；6.3 心情=emoji+字卡） ---------- */
function todayKey() {
  const n = new Date();
  return `${n.getFullYear()}-${n.getMonth() + 1}-${n.getDate()}`; // 0 点刷新
}

/* 生成一份弹卡内容并持久化（当天不再改变）。
   注意：pageshow 触发的补弹可能早于 init 完成字卡加载（cards 还是 null），
   所有取池操作必须做空值防御，否则补弹会在启动早期静默抛错、入梦签弹不出来 */
async function generateDailyCard() {
  const char = await getDailyChar();
  // 字卡跟随范围（用户修正）：入梦签仅「寄语」「来信心文」跟随访客禁词；
  // 心情、状态、天气一律用全局池，不跟随角色
  const pools = char ? charCardPools(char) : null;
  const replyPool = pools ? pools.replies : ((cards && cards.customReplies) || [])
    .concat((((cards && cards.customReplyGroups) || [])).flatMap(g => g.items || []));
  const mottoPool = pools ? pools.mottos : ((cards && cards.customMottos) || []);
  const globalReplyPool = ((cards && cards.customReplies) || [])
    .concat((((cards && cards.customReplyGroups) || [])).flatMap(g => g.items || []));
  const statusPool = (cards && cards.customStatuses && cards.customStatuses.length) ? cards.customStatuses : ['平静'];
  // 纪念日：弹卡纪念日角色今天的纪念日（与 computeTodayAnnivText 同一套逻辑，保证缓存校验一致）
  const annivText = await computeTodayAnnivText();
  // 20260929ae：AI 模式下，心情/寄语/来信心文由 AI 生成；天气/状态仍走字卡（特殊项一）
  let aiText = null;
  if (await isAIMode()) {
    try { aiText = await aiGenerateDailyCardText(char ? char.id : null); } catch (e) {}
  }
  const data = {
    date: todayKey(),
    charId: char ? char.id : null,
    charName: char ? char.name : '访客',
    charAvatar: char ? (char.avatar || '') : '',
    weather: drawFrom(WEATHER_CARDS),
    moodEmoji: drawFrom(cards && cards.customEmojis && cards.customEmojis.length ? cards.customEmojis : ['🌙']),
    moodText: (aiText && aiText.moodText) || drawFrom(globalReplyPool) || '想你了', // 心情
    motto: (aiText && aiText.motto) || drawFrom(mottoPool.length ? mottoPool : ['愿你的梦里有我。']), // 寄语
    status: drawFrom(statusPool), // 状态：全局池，不跟随角色（特殊项一：永远走字卡）
    msg: (aiText && aiText.msg) || drawFrom(replyPool) || '今晚也要梦到我哦。', // 来信心文
    annivText: annivText, // 今日纪念日（空则无）
  };
  await setSetting('dailyCardData', data);
  return data;
}

/* 读取当天弹卡内容（没有则生成；同一天内容固定。
   例外：入梦签角色与当日数据记录的不一致（玩家改设了角色，或当日数据生成时还没有访客）
   → 立即重新生成，保证头像/昵称始终是玩家当前设置的入梦签角色） */
async function getTodayCard() {
  let data = await getSetting('dailyCardData', null);
  const dc = await getDailyChar();
  const expectId = dc ? dc.id : null;
  // 20260929j：入梦签纪念日即时刷新——玩家当天已生成入梦签后，再去设置「入梦签纪念日角色」
  // 或「今天为纪念日」，缓存的 annivText 不会跟着变。这里校验缓存里记录的纪念日文案与
  // 当前设置实时算出的是否一致，不一致（含从有到无、从无到有、换了角色/原因）就重生成。
  const expectAnniv = await computeTodayAnnivText();
  if (!data || data.date !== todayKey() || (data.charId || null) !== expectId
      || (data.annivText || '') !== expectAnniv) {
    data = await generateDailyCard();
  }
  return data;
}

/* 实时计算「今天入梦签该显示的纪念日文案」（空串=今天没有纪念日）。
   与 generateDailyCard 内部用同一套逻辑，供 getTodayCard 做缓存一致性校验。
   20260929k 修复：之前只匹配 'MM-DD'（每年重复），用日期选择器/填年份存的
   'YYYY-MM-DD'（具体日期）永远匹配不上 → 纪念日不显示。现统一走 annivDayText()
   的 isToday 判定，与纪念日列表页完全一致，两种格式都兼容 */
async function computeTodayAnnivText() {
  const dailyAnnivCharId = await getSetting('dailyAnnivCharId', null);
  if (!dailyAnnivCharId) return '';
  const todayAnniv = anniversaries.find(a => a.charId === dailyAnnivCharId && annivDayText(a.date).isToday);
  if (!todayAnniv) return '';
  const ac = characters.find(x => x.id === dailyAnnivCharId);
  return `${ac ? ac.name : 'TA'}的${todayAnniv.reason}`;
}

function buildDailyCardHtml(d, btnId) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  // 头像与昵称取玩家设置的入梦签角色；未设置时用占位
  const noChar = !d.charId;
  const displayName = noChar ? '访客' : (d.charName || '梦角');
  const fallbackLetter = noChar ? '梦' : ((d.charName || '梦')[0]);
  return `
    <div class="daily-card fade-in" style="position:relative;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
        <div class="avatar lg" style="width:56px;height:56px;border:2px solid var(--purple-soft);box-shadow:0 0 18px rgba(167,139,250,.35);flex-shrink:0;">
          ${d.charAvatar ? `<img src="${imgSrc(d.charAvatar)}">` : escapeHtml(fallbackLetter)}
        </div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:19px;font-weight:600;">${escapeHtml(displayName)}的入梦签</div>
          <div style="color:var(--text-tertiary);font-size:12px;letter-spacing:2px;margin-top:4px;">${dateStr} · ${timeStr}</div>
        </div>
      </div>

      <div style="text-align:center;font-size:26px;font-weight:600;margin-bottom:18px;">${escapeHtml(d.moodEmoji)} ${escapeHtml(d.moodText)}</div>

      ${d.annivText ? `
        <div style="text-align:center;background:linear-gradient(135deg,rgba(167,139,250,0.22),rgba(244,114,182,0.16));border:1px solid var(--purple-dim);border-radius:16px;padding:12px 16px;margin-bottom:10px;">
          <div style="font-size:12px;color:var(--purple-soft);letter-spacing:1px;">🎉 今天是纪念日</div>
          <div style="font-size:15px;font-weight:700;margin-top:4px;">${escapeHtml(d.annivText)}</div>
        </div>
      ` : ''}

      <div style="display:flex;gap:10px;margin-bottom:10px;">
        <div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:12px 14px;">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;">☁️ ${escapeHtml(displayName)}的天气</div>
          <div style="font-size:14px;line-height:1.5;">${escapeHtml(d.weather)}</div>
        </div>
        <div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:12px 14px;">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;">📍 ${escapeHtml(displayName)}的状态</div>
          <div style="font-size:14px;line-height:1.5;">${escapeHtml(d.status)}</div>
        </div>
      </div>

      <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:12px 16px;margin-bottom:10px;position:relative;text-align:center;">
        <span style="position:absolute;left:10px;top:6px;color:var(--purple-dim);font-size:24px;font-family:serif;">“</span>
        <span style="font-size:14px;line-height:1.6;color:var(--purple-soft);">${escapeHtml(d.motto)}</span>
        <span style="position:absolute;right:10px;bottom:0px;color:var(--purple-dim);font-size:24px;font-family:serif;">”</span>
      </div>

      <div style="background:var(--purple-dim);border-radius:16px;padding:13px 16px;font-size:14px;line-height:1.6;color:var(--purple-soft);margin-bottom:16px;">
        「${escapeHtml(d.msg)}」
      </div>

      <button class="btn primary block" id="${btnId}">我收到啦</button>
    </div>
  `;
}

/* 弹卡渲染（当天内容固定） */
async function openDailyCardModal(d, onReceive) {
  openModal(buildDailyCardHtml(d, 'btn-daily-receive'));
  $('#btn-daily-receive').onclick = onReceive;
}

/* 启动时弹卡：当天已弹过（dailyShown === today）则不再弹。
   _dailyCardOpening 防重入：pageshow / visibilitychange / init 三处可能几乎同时触发，
   避免同一毫秒内重复查库+开窗；写入 dailyShown 前二次核对，防止并发窗口内重复弹。 */
let _dailyCardOpening = false;
async function showDailyCard() {
  // 20260929bk：软件声明未同意期间不弹入梦签（声明必须排最前；同意后由 visibilitychange/pageshow 补弹）
  if (_noticeGate) return;
  // 字卡库尚未就绪（pageshow 补弹可能早于 init 完成）：本次跳过，
  // 否则会用空字卡池生成一份"空内容"入梦签并写死当天数据；init 加载完成后会再调一次
  if (!cards) return;
  const today = todayKey();
  const lastShown = await getSetting('dailyShown', null);
  if (lastShown === today) return; // 7.1：每天只弹一次
  if (_dailyCardOpening) return;
  _dailyCardOpening = true;
  try {
    const d = await getTodayCard(); // 内容当天固定
    if ((await getSetting('dailyShown', null)) === today) return; // 等待期间已被标记
    openDailyCardModal(d, async () => {
      closeModal();
      await setSetting('dailyShown', todayKey());
    });
  } finally {
    _dailyCardOpening = false;
  }
}

async function getDailyChar() {
  if (characters.length === 0) return null;
  const dailyCharId = await getSetting('dailyCharId', null);
  if (dailyCharId) {
    const c = characters.find(c => c.id === dailyCharId);
    if (c) return c;
  }
  return characters[0];
}

/* ---------- 访客系统 ---------- */
async function refreshCharacters() {
  characters = await idbGetAll('characters');
  characters.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* 角色个性签名（7）：创建后自动抽一条；之后每 5~7 天自动刷新一次（间隔在 5~7 天内随机）。
   20260929al 修正：按模式区分——
   · 自考模式：每 5~7 天自动抽一条字卡；
   · AI 模式：每 5~7 天由 AI 生成一次个性签名（失败静默回退字卡）。
   本函数保持同步返回「当前可显示的签名」用于界面渲染；到期时先抽字卡占位，
   若处于 AI 模式再异步触发 aiRefreshCharSign 生成个性签名覆盖。 */
function ensureCharSign(c) {
  const now = Date.now();
  const drawSign = () => {
    const pool = (cards.customReplies || []).concat((cards.customReplyGroups || []).flatMap(g => g.items || []));
    return pool.length ? drawFrom(pool) : '';   // 字卡库为空时留空，不再显示"这个人很神秘"
  };
  let changed = false;
  let needNew = false;
  if (!c.sign) needNew = true;
  else if (!c.signNext) {
    c.signNext = now + randInt(5, 7) * 86400000;
    changed = true;
  } else if (now >= c.signNext) needNew = true;
  if (needNew) {
    const s = drawSign();
    if (s) {           // 抽到空（库为空）时不写入，避免每次调用都重复保存
      c.sign = s;
      c.signAt = now;
      c.signNext = now + randInt(5, 7) * 86400000; // 每 5~7 天随机刷新
      changed = true;
      aiRefreshCharSign(c); // AI 模式：异步生成个性签名覆盖（失败静默保留字卡）
    }
  }
  if (changed) idbPut('characters', c);
  return c.sign;
}

/* AI 模式：到期后由 AI 生成一次个性签名（一句话，符合角色人设），成功后覆盖 c.sign 并刷新界面。
   失败/非 AI 模式静默跳过（签名保持字卡占位）。 */
async function aiRefreshCharSign(c) {
  try {
    if (!(await isAIMode())) return;
    const cfg = await loadAIConfig();
    if (!(cfg.chatApi && cfg.chatApi.url)) return;
    const ctx = await buildCharAIContext(c.id, []);
    const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
      { role: 'system', content: `你是角色扮演 AI。请为当前扮演的角色写一句「个性签名」：一句话（20 字内），贴合角色人设与性格，像社交软件的签名，不要提"AI""签名"等字眼，只输出这一句话本身。\n\n${ctx}` },
      { role: 'user', content: '为这个角色写一句个性签名。' },
    ], { temperature: 0.9 });
    if (r.ok && r.text) {
      const sign = r.text.trim().slice(0, 40);
      if (sign) {
        c.sign = sign;
        c.signAt = Date.now();
        await idbPut('characters', c);
        // 若正在聊天页/访客主页，就地刷新签名显示
        if (currentCharId === c.id) setChatHeaderSign(c);
        renderChatList();
      }
    }
  } catch (e) {}
}

async function addCharacter(name, bio, avatarDataUrl, playerNick = '', opts = {}) {
  const char = {
    id: uid('char'),
    name: name.trim(),
    bio: bio.trim() || '',
    avatar: avatarDataUrl || '',
    createdAt: Date.now(),
    wallet: 100000, // 访客钱包初始 100000
    relation: '无',        // 与玩家的关系
    peerRelations: {},     // 与其他访客的关系 { [其他访客id]: 关系类型 }
    banWords: [],
    bannedGroups: [],      // 禁用的字卡分组（直接勾选字卡文件夹整体禁用）
    remindMoments: true,
    cantSeeMyMoments: false, // 角色单独屏蔽：该访客看不到我的朋友圈（9.1）
    playerNicknames: (playerNick && playerNick.trim()) ? [playerNick.trim()] : [], // 20260929ah：角色对玩家的专属昵称（最多 5 个）
    sign: '',              // 个性签名（创建后自动从字卡库抽）
    signAt: 0,
    signNext: 0,
    statusCache: null,     // 时段状态缓存 { period, day, text }
  };
  await idbPut('characters', char);
  await refreshCharacters();
  ensureCharSign(char); // 创建后立即抽一条字卡作为个性签名
  // 20260930cb：角色开场白——玩家填了开场白 → 点进聊天页时 TA 已经「发布」了这句话（第一条消息）；
  // 没填 → TA 从字卡库随机抽一张打招呼。两种都在创建时落库，消息时间=创建时间。
  try {
    const greeting = (opts && opts.greeting ? String(opts.greeting) : '').trim();
    const firstText = greeting || drawReply(cards, getCharBanWords(char), char.relation || null, char.bannedGroups || []);
    if (firstText) {
      const m = { id: uid('msg'), charId: char.id, from: 'them', type: 'text', content: firstText, time: Date.now() };
      await idbPut('messages', m);
    }
  } catch (e) {}
  // 默认第一个创建的角色成为每日弹卡对象
  const existingDaily = await getSetting('dailyCharId', null);
  if (!existingDaily) await setSetting('dailyCharId', char.id);
  return char;
}

async function deleteCharacter(id, scopes = new Set(['chat'])) {
  // 按勾选范围删除数据
  if (scopes.has('chat')) {
    const msgs = await idbGetMessagesByChar(id, 100000);
    for (const m of msgs) await idbDelete('messages', m.id);
  }
  // 朋友圈：删除该访客的帖子及其在别人帖子里的点赞/评论
  if (scopes.has('moments')) {
    const posts = await loadMomentPosts();
    const keep = posts.filter(p => !(p.authorType === 'char' && p.authorId === id));
    for (const p of keep) {
      p.likes = (p.likes || []).filter(l => l.who !== id);
      p.comments = (p.comments || []).filter(cm => cm.who !== id);
      p.pending = (p.pending || []).filter(pd => pd.charId !== id);
    }
    _momentsPosts = keep;
    await saveMomentPosts();
  }
  // 记忆宫殿：删除该访客的记忆文件夹及其下全部记忆（含子文件夹；细则十-1）。
  // 弹窗里不勾选此项 = 仅删角色，记忆宫殿数据保留
  if (scopes.has('memory')) {
    const fid = 'pf_char_' + id;
    const folders = await getSetting('palaceFolders', []);
    await setSetting('palaceFolders', folders.filter(f => f.id !== fid && f.parentId !== fid));
    const pal = await idbGetAll('palace');
    for (const e of pal) {
      if (e.folderId === fid) await idbDelete('palace', e.id);
    }
  }
  // 问卷：删除该访客相关的全部问卷记录（细则七-3：删除访客时可选择同时删除问卷数据）
  if (scopes.has('survey')) {
    const srvs = await idbGetAll('surveys');
    for (const e of srvs) {
      if (e.charId === id) await idbDelete('surveys', e.id);
    }
  }
  // 超频礼物柜：删除该访客赠送的礼物（首次项链 charId='all' 保留）
  {
    const gs = await idbGetAll('gifts');
    for (const g of gs) {
      if (g.charId === id) await idbDelete('gifts', g.id);
    }
  }
  // 删除访客本体
  await idbDelete('characters', id);
  // 清理其他访客单向关系里指向该访客的条目
  for (const other of characters) {
    if (other.id === id) continue;
    if (other.peerRelations && other.peerRelations[id] !== undefined) {
      delete other.peerRelations[id];
      await idbPut('characters', other);
    }
  }
  // 每日弹卡对象顺延（4.4）
  const dailyCharId = await getSetting('dailyCharId', null);
  if (dailyCharId === id) {
    const remaining = characters.filter(x => x.id !== id);
    await setSetting('dailyCharId', remaining.length ? remaining[0].id : null);
  }
  await refreshCharacters();
}

/* ---------- 渲染 ---------- */
/* 玩家个人主页（8.1 布局：上1/3背景图+分隔条+白边框圆头像，下半功能列表） */
function renderPlayerHome() {
  // 一体式顶栏：实测顶栏高度写入 CSS 变量，hero 面板自动补偿同高
  // （背景延伸到顶栏后面，而 hero 底边/头像落点与原版完全一致）
  const tb0 = $('#home-topbar');
  if (tb0) document.documentElement.style.setProperty('--home-topbar-h', tb0.offsetHeight + 'px');
  const av = $('#player-avatar');
  av.innerHTML = playerProfile.avatar ? `<img src="${imgSrc(playerProfile.avatar)}">` : escapeHtml((playerProfile.name || '梦')[0]);
  $('#player-name').textContent = playerProfile.name || '白日梦主人';
  $('#player-status-chip').textContent = '🌙 ' + (playerProfile.status || '入梦中');
  $('#player-sign-chip').textContent = playerProfile.sign || '做个好梦';
  $('#player-quote-chip').textContent = '「记录和 TA 们的日常」';
  $('#stat-chars').textContent = characters.length;
  $('#stat-wallet').textContent = '¥' + (playerProfile.wallet || 0);

  // 顶栏头像+昵称（下滑遮住昵称时从顶栏滑出）
  const tbAv = $('#topbar-avatar');
  const tbName = $('#topbar-name');
  if (tbAv) tbAv.innerHTML = playerProfile.avatar ? `<img src="${imgSrc(playerProfile.avatar)}">` : escapeHtml((playerProfile.name || '梦')[0]);
  if (tbName) tbName.textContent = playerProfile.name || '白日梦主人';

  // 背景图：铺在 hero 圆角面板内（#hero-bg），20260926a 版式
  const hero = $('#player-hero');
  const bgEl = $('#hero-bg');
  if (hero && bgEl) {
    if (playerProfile.bg) {
      bgEl.style.backgroundImage = `url("${imgSrc(playerProfile.bg)}")`;
      bgEl.classList.add('has-bg');
      hero.classList.add('has-bg');
    } else {
      bgEl.style.backgroundImage = '';
      bgEl.classList.remove('has-bg');
      hero.classList.remove('has-bg');
    }
  }
  // 顶栏融合背景：有背景图时用背景主色（无背景时回退默认玻璃色）
  document.documentElement.style.setProperty('--home-top-color', playerProfile.bgColor ? hexToRgba(playerProfile.bgColor, 0.78) : '');

  // 聊天天数：取所有消息中最早一条到今天的天数（认识当天算第 1 天）。
  // Q3：消息走内存缓存（首轮后不再读库）；求最早时间用循环归约，
  // 不再用 Math.min(...map) 展开大数组（消息上万时会超调用栈）
  idbGetAll('messages').then(msgs => {
    let days = 1;
    let earliest = Infinity;
    for (const m of msgs) {
      const t = m.time || 0;
      if (t && t < earliest) earliest = t;
    }
    if (earliest !== Infinity) {
      days = Math.max(1, Math.floor((startOfToday() - startOfDay(new Date(earliest))) / 86400000) + 1);
    }
    $('#stat-days').textContent = days;
  });
}

/* 颜色工具：#rrggbb → rgba(r,g,b,a) */
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return '';
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

/* 取图片主色（8：顶栏下滑遮挡背景时取背景最主要的颜色） */
function computeDominantColor(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = 8; cv.height = 8;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, 8, 8);
        const d = ctx.getImageData(0, 0, 8, 8).data;
        let r = 0, g = 0, b = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        // 压暗到适合深色顶栏的亮度
        const dim = (v) => Math.round(v * 0.55);
        resolve('#' + [r, g, b].map(v => dim(v).toString(16).padStart(2, '0')).join(''));
      } catch (e) { resolve(''); }
    };
    img.onerror = () => resolve('');
    // 双保险：imgSrc 兼容 Blob 描述符 / 旧 base64（20260929g）；任何同步异常都兜底成无主色，绝不让背景图崩溃
    try { img.src = imgSrc(dataUrl) || ''; } catch (e) { resolve(''); }
  });
}

/* 主页背景弹窗（8：更换/删除融合在一个弹窗） */
function showHomeBgModal() {
  const hasBg = !!playerProfile.bg;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">主页背景图</div>
      <button class="icon-btn" id="hbg-close">✕</button>
    </div>
    <div id="hbg-preview" style="height:150px;border-radius:16px;border:1px solid var(--border);background:${hasBg ? `url(&quot;${imgSrc(playerProfile.bg)}&quot;) center/cover` : 'var(--bg-elevated-2)'};display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);font-size:13px;margin-bottom:14px;">
      ${hasBg ? '' : '暂无背景图（显示默认星空）'}
    </div>
    <div style="display:flex;gap:10px;">
      <label class="btn primary" for="hbg-input" style="flex:1;height:44px;padding:0;cursor:pointer;">${icon('camera', 15)} 上传背景图</label>
      <button class="btn danger" style="flex:1;height:44px;padding:0;" id="hbg-del" ${hasBg ? '' : 'disabled'}>删除背景图</button>
    </div>
    <input type="file" id="hbg-input" accept="image/*" style="display:none;">
  `);
  $('#hbg-close').onclick = closeModal;
  $('#hbg-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    // 20260929ax：先裁剪再应用——比例取主页 hero 面板实际宽高，所见即所得
    const heroEl = $('#player-hero');
    const heroAspect = heroEl && heroEl.clientHeight > 40 ? heroEl.clientWidth / heroEl.clientHeight : 0;
    const cropped = await openImageCropper(file, { aspect: heroAspect });
    if (!cropped) return;
    playerProfile.bg = cropped;
    playerProfile.bgColor = await computeDominantColor(playerProfile.bg);
    await savePlayerProfile();
    miniToast('主页背景已更新');
    showHomeBgModal();
  };
  $('#hbg-del').onclick = async () => {
    playerProfile.bg = '';
    playerProfile.bgColor = '';
    await savePlayerProfile();
    miniToast('已删除主页背景');
    showHomeBgModal();
  };
}

async function savePlayerProfile() {
  await setSetting('playerProfile', playerProfile);
  renderPlayerHome();
}

/* 编辑玩家资料（头像/状态/签名） */
function showEditProfileModal() {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">编辑资料</div>
      <button class="icon-btn" id="editp-close">✕</button>
    </div>
    <div class="field">
      <label>头像</label>
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="avatar lg" id="editp-avatar-preview">${playerProfile.avatar ? `<img src="${imgSrc(playerProfile.avatar)}">` : '梦'}</div>
        <input class="input" type="file" id="editp-avatar-input" accept="image/*" style="flex:1;">
      </div>
    </div>
    <div class="field">
      <label>昵称</label>
      <input class="input" id="editp-name" value="${escapeHtml(playerProfile.name || '白日梦主人')}" maxlength="20" placeholder="你的昵称">
    </div>
    <div class="field">
      <label>我的状态</label>
      <input class="input" id="editp-status" value="${escapeHtml(playerProfile.status)}" placeholder="如：入梦中">
    </div>
    <div class="field">
      <label>个性签名</label>
      <input class="input" id="editp-sign" value="${escapeHtml(playerProfile.sign)}" placeholder="写一句你的签名">
    </div>
    <button class="btn primary block" id="editp-save">保存</button>
  `);
  $('#editp-close').onclick = closeModal;
  $('#editp-avatar-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      // 20260929bn：头像方形裁剪后再用
      const cropped = await openImageCropper(file, { aspect: 1, maxEdge: 360, quality: 0.8 });
      if (!cropped) return;
      playerProfile.avatar = cropped;
      $('#editp-avatar-preview').innerHTML = `<img src="${imgSrc(playerProfile.avatar)}">`;
    }
  };
  $('#editp-save').onclick = async () => {
    playerProfile.name = $('#editp-name').value.trim() || '白日梦主人';
    playerProfile.status = $('#editp-status').value.trim() || '入梦中';
    playerProfile.sign = $('#editp-sign').value.trim() || '做个好梦';
    await savePlayerProfile();
    closeModal();
  };
}

/* 编辑玩家钱包 */
function showWalletModal() {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">我的钱包</div>
      <button class="icon-btn" id="wallet-close">✕</button>
    </div>
    <div style="text-align:center;font-size:32px;font-weight:600;margin:10px 0 18px;color:var(--purple-soft);" id="wallet-show">¥${playerProfile.wallet}</div>
    <div class="field">
      <label>修改钱包数值</label>
      <input class="input" type="number" id="wallet-input" value="${playerProfile.wallet}" step="1">
    </div>
    <button class="btn primary block" id="wallet-save">保存</button>
  `);
  $('#wallet-close').onclick = closeModal;
  $('#wallet-input').oninput = (e) => { $('#wallet-show').textContent = '¥' + (e.target.value || '0'); };
  $('#wallet-save').onclick = async () => {
    playerProfile.wallet = parseInt($('#wallet-input').value) || 0;
    await savePlayerProfile();
    closeModal();
  };
}

/* ---------- 渲染 ---------- */
/* 聊天导航列表：群聊靠前；角色按 charGroups 分组展示（分组可折叠）+ 未分组；
   每行显示最新一条消息小字 + 未读红点徽标；访客间淡分隔线 */
/* 渲染序号守卫：renderChatList 是 async（要读 IndexedDB），主动消息定时器/开关聊天页会并发调它；
   若不加守卫，两次调用的 await 交错会导致「清空后各自追加一遍」→ 访客列表重复滚动 */
let _renderChatListSeq = 0;
let _chatListSig = null; // Q4：上次渲染的数据签名（一致则跳过重建）
async function renderChatList() {
  // 批量管理模式下不重绘（避免后台消息渲染覆盖批量勾选列表）
  if (batchMode) return;
  const seq = ++_renderChatListSeq;
  const list = $('#chat-list');
  if (characters.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🌙</div>
        <div>还没有访客</div>
        <div style="font-size:13px;">点击右上角 ＋ 添加你的第一个访客吧</div>
        <button class="btn primary" id="btn-empty-add">添加访客</button>
      </div>`;
    $('#btn-empty-add').onclick = showAddCharModal;
    _chatListSig = null;
    return;
  }

  // 取所有消息，按角色汇总最新一条 + 未读数（一次性读所有已读时间，避免逐条 await）
  // Q3：idbGetAll('messages') 现在走内存缓存，只有首轮真正读库
  const allMsgs = await idbGetAll('messages');
  const lastReads = {};
  for (const c of characters) lastReads[c.id] = await getSetting('lastRead_' + c.id, 0);
  // az 细则一.1：群聊未读 = 群内 them 消息数 - 已读时间之后的条数（与单聊同口径）
  const lastReadsGroup = {};
  for (const g of chatGroups) lastReadsGroup[g.id] = await getSetting('lastRead_group_' + g.id, 0);
  const byChar = {};
  const byGroup = {};
  for (const m of allMsgs) {
    if (m.groupId) {
      if (!byGroup[m.groupId]) byGroup[m.groupId] = { lastMsg: null, unread: 0 };
      const ge = byGroup[m.groupId];
      if (!ge.lastMsg || m.time > ge.lastMsg.time) ge.lastMsg = m;
      if (m.from === 'them' && m.time > (lastReadsGroup[m.groupId] || 0)) ge.unread++;
      continue;
    }
    if (!byChar[m.charId]) byChar[m.charId] = { lastMsg: null, unread: 0 };
    if (!byChar[m.charId].lastMsg || m.time > byChar[m.charId].lastMsg.time) {
      byChar[m.charId].lastMsg = m;
    }
    if (m.from === 'them' && m.time > (lastReads[m.charId] || 0)) byChar[m.charId].unread++;
  }
  // 20260929ax：未读事件（礼物/惊喜/书信/跨页消息）并入列表未读——
  // 「只在某聊天页加号上有红点、退出到导航页却看不出是谁发的」的补全：
  // 哪位访客有未读事件，谁的列表行就亮未读（取 max 防止与已读统计重复计数）
  for (const cid in _unreadEvents) {
    const ev = _unreadEvents[cid];
    const evTotal = (ev.gifts || 0) + (ev.surprises || 0) + (ev.letters || 0) + (ev.msgs || 0);
    if (!byChar[cid]) byChar[cid] = { lastMsg: null, unread: 0 };
    byChar[cid].unread = Math.max(byChar[cid].unread || 0, evTotal);
  }

  // 数据读取完成后再次校验：期间若又触发了新的渲染，本次直接放弃（防止重复追加）
  if (seq !== _renderChatListSeq) return;

  // Q4 性能优化：数据签名一致就直接跳过 DOM 重建。
  // 本函数被高频调用（每条消息、收发互动、开关弹窗后），绝大多数调用数据其实没变，
  // 全量重建才是卡顿大头；签名覆盖：群聊/分组结构、每行最新消息与未读数、撤回态。
  const sig = JSON.stringify([
    chatGroups.map(g => {
      const d = byGroup[g.id] || {};
      return [g.id, g.name, g.avatar || '', (g.memberIds || []).length, d.lastMsg ? d.lastMsg.id : '', d.unread || 0];
    }),
    charGroups.map(g => [g.id, g.name, g._collapsed ? 1 : 0, (g.memberIds || []).join(',')]),
    characters.map(c => {
      const d = byChar[c.id] || {};
      return [c.id, c.name, c.avatar || '', d.lastMsg ? d.lastMsg.id : '', d.lastMsg && d.lastMsg.recalled ? 1 : 0, d.unread || 0];
    }),
  ]);
  if (sig === _chatListSig) return;
  _chatListSig = sig;

  list.innerHTML = '';

  const appendSep = () => {
    const sep = document.createElement('div');
    sep.className = 'chat-sep';
    list.appendChild(sep);
  };

  /* —— 群聊行（22：单独占一行，靠前显示；20260925i 起也可被收入访客分组） —— */
  const buildGroupRow = (g) => {
    const data = byGroup[g.id] || { lastMsg: null, unread: 0 };
    const lastMsg = data.lastMsg;
    let brief = '群聊已开启';
    if (lastMsg) {
      const speakerName = lastMsg.from === 'me' ? '我' : groupMemberName(g, lastMsg.charId);
      if (lastMsg.type === 'emoji') brief = speakerName + '：[表情]';
      else if (lastMsg.type === 'image') brief = speakerName + '：[图片]';
      else if (lastMsg.type === 'share') brief = speakerName + '：[朋友圈分享]';
      else if (lastMsg.type === 'poke') brief = '[戳一戳]';
      else if (lastMsg.type === 'survey') brief = speakerName + '：[问卷]';
      else if (lastMsg.type === 'grouppacket') brief = speakerName === '我' ? '你发了群红包' : speakerName + '：[群红包]';
      else if (lastMsg.type === 'topic') brief = '💬 话题：' + (lastMsg.content && lastMsg.content.text || '');
      else if (lastMsg.type === 'vote') brief = '📊 投票：' + (lastMsg.content && lastMsg.content.question || '');
      else if (lastMsg.type === 'letter') brief = lastMsg.from === 'me' ? '[寄出的书信]' : '[书信]';
      else if (lastMsg.type === 'call') brief = (lastMsg.content && lastMsg.content.group) ? `[群${lastMsg.content.kind === 'video' ? '视频' : '语音'}通话]` : '[通话]';
      else if (typeof lastMsg.content === 'string') brief = speakerName + '：' + lastMsg.content;
      else brief = speakerName + '：[卡片消息]';
    }
    const item = document.createElement('div');
    item.className = 'list-item chat-item';
    item.innerHTML = `
      <div class="avatar" style="background:var(--purple-dim);font-size:20px;overflow:hidden;">${g.avatar ? `<img src="${imgSrc(g.avatar)}" style="width:100%;height:100%;object-fit:cover;">` : '👥'}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:16px;font-weight:600;">${escapeHtml(g.name)} <span style="font-size:11px;color:var(--text-tertiary);font-weight:400;">(${g.memberIds.length})</span></div>
        <div class="chat-item-brief" style="font-size:13px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(brief)}</div>
      </div>
      ${data.unread > 0 ? `<div class="unread-badge">${data.unread > 99 ? '99+' : data.unread}</div>` : ''}
    `;
    item.onclick = () => openGroupChat(g.id);
    // 长按/右键群聊行 → 群聊设置（改名/换头像/解散）
    let gPress = null;
    item.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) return; // 20261001ci：多指（三指截屏等）不触发长按
      gPress = setTimeout(() => showGroupSettingsModal(g), 600);
    });
    item.addEventListener('touchend', () => clearTimeout(gPress));
    item.addEventListener('touchmove', () => clearTimeout(gPress));
    item.addEventListener('touchcancel', () => clearTimeout(gPress)); // 20261001ci：系统手势接管时取消长按
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); showGroupSettingsModal(g); });
    return item;
  };

  // 已被收入某个访客分组的群聊不再单独占行（改在分组内显示）
  const claimedGroupIds = new Set();
  charGroups.forEach(g => (g.memberIds || []).forEach(id => { if (chatGroups.some(x => x.id === id)) claimedGroupIds.add(id); }));
  chatGroups.filter(g => !claimedGroupIds.has(g.id)).forEach((g) => {
    list.appendChild(buildGroupRow(g));
    appendSep();
  });

  /* —— 访客行渲染辅助 —— */
  const buildCharRow = (c) => {
    const data = byChar[c.id] || { lastMsg: null, unread: 0 };
    const lastMsg = data.lastMsg;
    let brief = '开始聊天吧';
    if (lastMsg) {
      if (lastMsg.recalled) brief = '对方撤回了一条消息';
      else if (lastMsg.type === 'emoji') brief = '[表情]';
      else if (lastMsg.type === 'image') brief = '[图片]';
      else if (lastMsg.type === 'call') brief = lastMsg.content.kind === 'video' ? '[视频通话]' : '[语音通话]';
      else if (lastMsg.type === 'checkin') brief = '[突击查岗]';
      else if (lastMsg.type === 'transfer') brief = '[转账]';
      else if (lastMsg.type === 'coin') brief = '[决策币]';
      else if (lastMsg.type === 'poke') brief = lastMsg.from === 'me' ? '你戳了戳 TA' : 'TA 戳了戳你';
      else if (lastMsg.type === 'letter') brief = lastMsg.from === 'me' ? '[寄出的书信]' : '[收到的书信]';
      else if (lastMsg.type === 'share') brief = '[朋友圈分享]';
      else if (lastMsg.type === 'survey') brief = lastMsg.from === 'me' ? '[发出的问卷]' : '[问卷]';
      else if (typeof lastMsg.content === 'string') brief = lastMsg.content;
      else brief = '[卡片消息]';
    }
    const item = document.createElement('div');
    item.className = 'list-item chat-item';
    item.innerHTML = `
      <div class="avatar">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : (c.name[0] || '?')}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:16px;font-weight:600;">${escapeHtml(c.name)}</div>
        <div class="chat-item-brief" style="font-size:13px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(brief)}</div>
      </div>
      ${data.unread > 0 ? `<div class="unread-badge">${data.unread > 99 ? '99+' : data.unread}</div>` : ''}
    `;
    item.onclick = () => openChat(c.id);
    let pressTimer = null;
    item.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) return; // 20261001ci：多指不触发长按
      pressTimer = setTimeout(() => enterBatchMode(), 600);
    });
    item.addEventListener('touchend', () => clearTimeout(pressTimer));
    item.addEventListener('touchmove', () => clearTimeout(pressTimer));
    item.addEventListener('touchcancel', () => clearTimeout(pressTimer)); // 20261001ci
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); enterBatchMode(); });
    return item;
  };

  /* —— 分组 + 未分组访客（20260925i：分组内也支持收录群聊，群聊排在该分组角色前面） —— */
  const groupedIds = new Set();
  charGroups.forEach((g) => {
    const members = (g.memberIds || []).map(id => characters.find(x => x.id === id)).filter(Boolean);
    const groupChats = (g.memberIds || []).map(id => chatGroups.find(x => x.id === id)).filter(Boolean);
    if (members.length === 0 && groupChats.length === 0) return;
    members.forEach(c => groupedIds.add(c.id));
    // 分组标题（可折叠）
    const head = document.createElement('div');
    head.className = 'char-group-head';
    head.innerHTML = `
      <span class="cg-arrow">${g._collapsed ? '▸' : '▾'}</span>
      <span style="flex:1;font-weight:600;font-size:13px;color:var(--text-secondary);">📁 ${escapeHtml(g.name)}（${members.length + groupChats.length}）</span>
    `;
    head.onclick = () => {
      g._collapsed = !g._collapsed;
      saveCharGroups().then(() => renderChatList());
    };
    list.appendChild(head);
    if (!g._collapsed) {
      const rows = [...groupChats.map(gc => buildGroupRow(gc)), ...members.map(c => buildCharRow(c))];
      rows.forEach((row, i) => {
        list.appendChild(row);
        if (i < rows.length - 1) appendSep();
      });
    }
  });

  const ungrouped = characters.filter(c => !groupedIds.has(c.id));
  if (ungrouped.length > 0) {
    const head = document.createElement('div');
    head.className = 'char-group-head';
    head.innerHTML = `<span style="flex:1;font-weight:600;font-size:13px;color:var(--text-tertiary);">未分组（${ungrouped.length}）</span>`;
    list.appendChild(head);
    ungrouped.forEach((c, i) => {
      list.appendChild(buildCharRow(c));
      if (i < ungrouped.length - 1) appendSep();
    });
  }
}

/* ---------- 群聊（22：单独占一行，发消息头像不同，气泡用总设置） ---------- */
async function saveGroups() {
  await setSetting('chatGroups', chatGroups);
}

async function createGroup(memberIds) {
  const members = characters.filter(c => memberIds.includes(c.id));
  if (members.length < 2) return;
  const group = {
    id: uid('group'),
    name: members.map(m => m.name).join('、'),
    memberIds: members.map(m => m.id),
    avatar: '', // 群头像（可上传更换）
    createdAt: Date.now(),
  };
  chatGroups.push(group);
  await saveGroups();
  batchMode = false;
  batchSelected = new Set();
  renderChatList();
  miniToast('群聊已创建');
}

/* 群名片显示名（群聊内发言者名：优先玩家设的群名片） */
function groupMemberName(g, charId) {
  const nick = g && g.memberNick && g.memberNick[charId];
  if (nick) return nick;
  const c = characters.find(x => x.id === charId);
  return c ? c.name : 'TA';
}

/* 20260929ba：群设置子功能上下文（关闭子功能后回群设置页——子功能一律回上一界面） */
let _groupSettingsCtx = null;
/* 子弹窗统一关闭：关闭后若来源是群设置页则重开群设置（而不是直接退出） */
function closeGroupSub(g, opts = {}) {
  closeModal();
  if (opts.returnTo === 'gset' && chatGroups.some(x => x.id === g.id)) showGroupSettingsModal(g);
}

/* 群聊设置（20260929az 细则扩充：群管理=添加/踢出成员、群公告、管理员、群名片、禁言；
   AI 设置=回复节奏 / 自动接龙轮次 0~5 / 退出后自主聊天 20 分钟窗口；ba：AI 管理员开关+后台轮数） */
function showGroupSettingsModal(g) {
  _groupSettingsCtx = null; // 本身就是顶层界面
  let newAvatar = g.avatar || '';
  const gs = getGroupChatSettings(g);
  const admins = new Set(g.adminIds || []);
  const muted = new Set(g.mutedIds || []);
  const ann = g.announcement || null;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">群聊设置</div>
      <button class="icon-btn" id="gset-close">✕</button>
    </div>
    <div class="field">
      <label>群头像</label>
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="avatar lg" id="gset-avatar-preview" style="display:flex;align-items:center;justify-content:center;font-size:24px;">${g.avatar ? `<img src="${imgSrc(g.avatar)}">` : '👥'}</div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <label class="btn" for="gset-avatar-input" style="cursor:pointer;justify-content:center;padding:9px 0;">上传群头像</label>
          ${g.avatar ? `<button class="btn" style="padding:9px 0;color:var(--danger);" id="gset-avatar-del">删除群头像</button>` : ''}
        </div>
      </div>
      <input type="file" id="gset-avatar-input" accept="image/*" style="display:none;">
    </div>
    <div class="field">
      <label>群聊名称</label>
      <input class="input" id="gset-name" value="${escapeHtml(g.name)}" maxlength="30" placeholder="群聊名称">
    </div>
    <div class="field">
      <label>群公告</label>
      <textarea class="textarea" id="gset-ann" rows="2" maxlength="200" placeholder="发布后群聊顶部展示公告横幅；清空保存 = 撤下公告">${ann ? escapeHtml(ann.text) : ''}</textarea>
      ${ann ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">当前公告：${escapeHtml(new Date(ann.time).toLocaleString())} 发布</div>` : ''}
    </div>
    <div class="field">
      <label>群成员（${g.memberIds.length} 人）</label>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;">
        ${g.memberIds.map(id => {
          const m = characters.find(x => x.id === id);
          if (!m) return '';
          const nick = (g.memberNick || {})[id];
          return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-elevated-2);border-radius:10px;cursor:pointer;" data-gm="${id}">
            <div class="avatar sm">${m.avatar ? `<img src="${imgSrc(m.avatar)}">` : escapeHtml(m.name[0] || '?')}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;">${admins.has(id) ? '👑 ' : ''}${escapeHtml(m.name)}${muted.has(id) ? ' <span style="font-size:11px;color:var(--danger);">🔇已禁言</span>' : ''}</div>
              ${nick ? `<div style="font-size:11.5px;color:var(--text-tertiary);">群名片：${escapeHtml(nick)}</div>` : ''}
            </div>
            <span style="font-size:11px;color:var(--text-tertiary);">管理 ›</span>
          </div>`;
        }).join('')}
      </div>
      <button class="btn" style="margin-top:8px;justify-content:center;" id="gset-addmem">＋ 添加群成员</button>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:8px;">点成员可设群名片 / 管理员 / 禁言 / 踢出</div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px dashed var(--border);border-radius:12px;">
      <div style="font-size:13px;color:var(--text-secondary);">AI 管理员<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">接 AI 后启用：由管理员成员自发拉人（只拉自己关系网中认识的人）、踢人（只踢与自己或他人起冲突的人）</div></div>
      <input type="checkbox" id="gset-aiadmin" ${g.aiAdmin ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px dashed var(--border);border-radius:12px;">
      <div style="font-size:13px;color:var(--text-secondary);">成员随机发群红包<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">开启后成员会按 30～180 分钟的随机间隔主动发一个拼手气/平分红包（从 TA 自己钱包扣款）</div></div>
      <input type="checkbox" id="gset-autopacket" ${gs.autoPacket ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
    </div>
    <div style="font-size:14px;font-weight:600;margin:4px 0 8px;">AI 群聊设置（API 相关）</div>
    <div class="field">
      <label>群聊回复节奏 · 最短（秒）</label>
      <input class="input" type="number" id="gset-min" min="0" max="300" value="${gs.replyMin}" style="width:100%;">
    </div>
    <div class="field">
      <label>群聊回复节奏 · 最长（秒）</label>
      <input class="input" type="number" id="gset-max" min="0" max="300" value="${gs.replyMax}" style="width:100%;">
    </div>
    <div class="field">
      <label>自动接龙轮次上限（0～5，1 轮 = 每个成员各发言一次）</label>
      <input class="input" type="number" id="gset-rounds" min="0" max="5" value="${typeof gs.rounds === 'number' ? gs.rounds : ''}" placeholder="跟随总设置（当前 ${chatSettings.groupRounds ?? 2} 轮）" style="width:100%;">
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">接龙达到轮次上限立即停止，防刷屏防卡死；玩家发消息 / 话题卡 / 群投票后按此轮数自动接龙</div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px dashed var(--border);border-radius:12px;">
      <div style="font-size:13px;color:var(--text-secondary);">退出群聊后成员继续自主聊天<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">开启时退出群聊页面还会在 20 分钟窗口内继续按下面的轮数聊天，之后自动停止；关闭则退出即停</div></div>
      <input type="checkbox" id="gset-autochat" ${gs.autoChat !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
    </div>
    <div class="field">
      <label>退出后继续聊的轮数（1～5，每轮 = 每个成员各发言一次）</label>
      <input class="input" type="number" id="gset-bgrounds" min="1" max="5" value="${Math.min(5, Math.max(1, gs.bgRounds ?? 1))}" style="width:100%;">
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">轮数越多越热闹，消耗的 API 额度也越多（AI 模式生效）</div>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn" style="flex:1;" id="gset-cancel">取消</button>
      <button class="btn danger" style="flex:1;" id="gset-dissolve">解散群聊</button>
      <button class="btn primary" style="flex:1;" id="gset-save">保存</button>
    </div>
  `);
  $('#gset-close').onclick = closeModal;
  $('#gset-avatar-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // 20260929bn：群头像方形裁剪后再用
    const cropped = await openImageCropper(file, { aspect: 1, maxEdge: 360, quality: 0.8 });
    if (!cropped) return;
    newAvatar = cropped;
    $('#gset-avatar-preview').innerHTML = `<img src="${imgSrc(newAvatar)}">`;
  };
  const delBtn = $('#gset-avatar-del');
  if (delBtn) delBtn.onclick = () => { newAvatar = ''; $('#gset-avatar-preview').innerHTML = '👥'; delBtn.remove(); };
  $('#gset-cancel').onclick = closeModal;
  // 20260929ba 根因修复：openModal 写入的是 #modal-content，此前绑到 #modal-box 永远找不到元素 → 「管理」点击无效
  $$('#modal-content [data-gm]').forEach(el => {
    el.onclick = () => showGroupMemberActions(g, el.dataset.gm, { returnTo: 'gset' });
  });
  $('#gset-addmem').onclick = () => showGroupAddMemberModal(g, { returnTo: 'gset' });
  $('#gset-dissolve').onclick = () => {
    showConfirm('确定解散该群聊吗？群聊消息将保留在记录中，但无法再进入。', async () => {
      chatGroups = chatGroups.filter(x => x.id !== g.id);
      await saveGroups();
      // 20260925i：该群聊可能已被收入访客分组——解散时把引用一并清掉，避免分组里出现死条目
      let cgDirty = false;
      charGroups.forEach(cg => {
        const before = (cg.memberIds || []).length;
        cg.memberIds = (cg.memberIds || []).filter(id => id !== g.id);
        if (cg.memberIds.length !== before) cgDirty = true;
      });
      if (cgDirty) await saveCharGroups();
      if (currentGroupId === g.id) { currentGroupId = null; forceCloseModal(); switchView('chatlist'); }
      renderChatList();
      miniToast('群聊已解散');
    });
  };
  $('#gset-save').onclick = async () => {
    const name = $('#gset-name').value.trim();
    if (name) g.name = name;
    g.avatar = newAvatar;
    // 20260929ae：群聊 AI 设置（回复节奏 + 退出后自主聊天开关）；az：接龙轮次 + 群公告
    const replyMin = parseInt($('#gset-min').value) || 0;
    const replyMax = parseInt($('#gset-max').value) || 0;
    const autoChat = $('#gset-autochat').checked;
    g.groupChatSettings = Object.assign({}, g.groupChatSettings, { replyMin, replyMax, autoChat });
    g.aiAdmin = $('#gset-aiadmin').checked;
    g.groupChatSettings.autoPacket = $('#gset-autopacket').checked;
    g.groupChatSettings.bgRounds = Math.min(5, Math.max(1, parseInt($('#gset-bgrounds').value, 10) || 1));
    const roundsRaw = $('#gset-rounds').value.trim();
    if (roundsRaw === '') delete g.groupChatSettings.rounds;
    else g.groupChatSettings.rounds = Math.min(5, Math.max(0, parseInt(roundsRaw, 10) || 0));
    if (replyMin > replyMax) { const t = replyMin; g.groupChatSettings.replyMin = replyMax; g.groupChatSettings.replyMax = t; }
    const annText = $('#gset-ann').value.trim();
    if (annText) {
      if (!g.announcement || g.announcement.text !== annText) g.announcement = { text: annText, time: Date.now() };
    } else g.announcement = null;
    await saveGroups();
    renderChatList();
    if (currentGroupId === g.id) {
      $('#chat-name').textContent = g.name;
      $('#chat-status').textContent = g.memberIds.length + ' 人';
      $('#chat-avatar').innerHTML = g.avatar ? `<img src="${imgSrc(g.avatar)}">` : '👥';
      renderGroupNotice(g);
    }
    miniToast('群聊设置已保存');
    closeModal();
  };
  // 20260929ba：「关闭」与「开启」都做确认（开启会持续消耗 API 额度）
  $('#gset-autochat').onchange = (e) => {
    if (!e.target.checked) {
      // 关闭：无风险，直接生效
      return;
    }
    e.target.checked = false; // 先还原，确认后再真正开启
    showConfirm('开启「退出群聊后继续自主聊天」吗？开启状态下成员会在退出群聊后按设定的轮数继续对话（20 分钟窗口内），AI 模式会消耗较多 API 额度，请谨慎开启。', () => {
      e.target.checked = true;
    });
  };
}

/* 单个群成员管理（群名片 / 管理员 / 禁言 / 踢出）；opts.returnTo='gset' 时关闭回群设置页 */
function showGroupMemberActions(g, charId, opts = {}) {
  const m = characters.find(x => x.id === charId);
  if (!m) return;
  const admins = new Set(g.adminIds || []);
  const muted = new Set(g.mutedIds || []);
  const nick = (g.memberNick || {})[charId] || '';
  const rerun = () => showGroupMemberActions(g, charId, opts);
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">管理成员 · ${escapeHtml(m.name)}</div>
      <button class="icon-btn" id="gma-close">✕</button>
    </div>
    <div class="field">
      <label>群名片（留空 = 群内使用原名，最多 12 字）</label>
      <input class="input" id="gma-nick" maxlength="12" value="${escapeHtml(nick)}" placeholder="TA 在这个群里的昵称">
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button class="btn" id="gma-admin" style="justify-content:center;">${admins.has(charId) ? '👑 取消群管理员' : '👑 设为群管理员'}</button>
      <button class="btn" id="gma-mute" style="justify-content:center;">${muted.has(charId) ? '🗣️ 解除禁言' : '🔇 禁言（不能发言，但能看消息）'}</button>
      <button class="btn danger" id="gma-kick" style="justify-content:center;">🚪 踢出群成员</button>
    </div>
    <button class="btn primary block" style="margin-top:14px;" id="gma-done">完成</button>
  `);
  $('#gma-close').onclick = () => closeGroupSub(g, opts);
  $('#gma-admin').onclick = async () => {
    g.adminIds = g.adminIds || [];
    if (admins.has(charId)) g.adminIds = g.adminIds.filter(x => x !== charId);
    else g.adminIds.push(charId);
    await saveGroups();
    miniToast(admins.has(charId) ? '已取消管理员' : '已设为群管理员');
    rerun();
  };
  $('#gma-mute').onclick = async () => {
    g.mutedIds = g.mutedIds || [];
    if (muted.has(charId)) g.mutedIds = g.mutedIds.filter(x => x !== charId);
    else g.mutedIds.push(charId);
    await saveGroups();
    miniToast(muted.has(charId) ? '已解除禁言' : '已禁言');
    rerun();
  };
  $('#gma-kick').onclick = () => {
    showConfirm(`确定把「${m.name}」踢出群聊吗？`, async () => {
      g.memberIds = g.memberIds.filter(x => x !== charId);
      g.adminIds = (g.adminIds || []).filter(x => x !== charId);
      g.mutedIds = (g.mutedIds || []).filter(x => x !== charId);
      if (g.memberNick) delete g.memberNick[charId];
      await saveGroups();
      renderChatList();
      if (currentGroupId === g.id) $('#chat-status').textContent = g.memberIds.length + ' 人';
      miniToast('已踢出群聊');
      closeGroupSub(g, opts);
    });
  };
  $('#gma-done').onclick = async () => {
    const v = $('#gma-nick').value.trim();
    g.memberNick = g.memberNick || {};
    if (v) g.memberNick[charId] = v;
    else delete g.memberNick[charId];
    await saveGroups();
    closeGroupSub(g, opts);
  };
}

/* 添加群成员（从未入群的访客中勾选）；opts.returnTo='gset' 时关闭/完成后回群设置页 */
function showGroupAddMemberModal(g, opts = {}) {
  const cands = characters.filter(c => !g.memberIds.includes(c.id));
  if (cands.length === 0) { miniToast('所有访客都已经在群里了'); return; }
  const sel = new Set();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">添加群成员</div>
      <button class="icon-btn" id="gadd-close">✕</button>
    </div>
    <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
      ${cands.map(c => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;" data-gadd="${c.id}">
          <div class="avatar sm">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
          <div style="flex:1;font-size:14px;font-weight:600;">${escapeHtml(c.name)}</div>
          <div class="gadd-check" style="width:20px;height:20px;border-radius:50%;border:2px solid var(--text-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;color:#141019;flex-shrink:0;"></div>
        </div>`).join('')}
    </div>
    <button class="btn primary block" id="gadd-go">添加（0）</button>
  `);
  $('#gadd-close').onclick = () => closeGroupSub(g, opts);
  const refresh = () => {
    document.querySelectorAll('[data-gadd]').forEach(el => {
      const on = sel.has(el.dataset.gadd);
      const box = el.querySelector('.gadd-check');
      box.style.background = on ? 'var(--purple)' : '';
      box.style.borderColor = on ? 'var(--purple)' : 'var(--text-tertiary)';
      box.textContent = on ? '✓' : '';
      el.style.borderColor = on ? 'var(--purple)' : 'var(--border)';
    });
    $('#gadd-go').textContent = `添加（${sel.size}）`;
  };
  document.querySelectorAll('[data-gadd]').forEach(el => {
    el.onclick = () => { sel.has(el.dataset.gadd) ? sel.delete(el.dataset.gadd) : sel.add(el.dataset.gadd); refresh(); };
  });
  $('#gadd-go').onclick = async () => {
    if (sel.size === 0) { miniToast('先勾选要加入的访客'); return; }
    g.memberIds.push(...sel);
    await saveGroups();
    renderChatList();
    if (currentGroupId === g.id) $('#chat-status').textContent = g.memberIds.length + ' 人';
    miniToast(`已添加 ${sel.size} 位成员`);
    closeGroupSub(g, opts);
  };
}

/* 打开群聊（点顶部头像/名字可进群聊设置） */
async function openGroupChat(groupId) {
  if (currentGroupId && currentGroupId !== groupId) markGroupBgChatWindow(currentGroupId);
  currentGroupId = groupId;
  currentCharId = null;
  const g = chatGroups.find(x => x.id === groupId);
  if (!g) return;
  g._bgChatUntil = 0; // 回到群聊页 → 取消后台窗口
  $('#chat-name').textContent = g.name;
  $('#chat-status').textContent = g.memberIds.length + ' 人';
  $('#chat-sign').textContent = '';
  $('#chat-avatar').innerHTML = g.avatar ? `<img src="${imgSrc(g.avatar)}">` : '👥';
  // 群聊：点顶部头像区进群聊设置；三点按钮也进群聊设置（16）
  $('#chat-header').onclick = () => showGroupSettingsModal(g);
  $('#btn-char-profile').onclick = () => showGroupSettingsModal(g);
  // 20260929be：群聊右上角「生成一轮回复」——成员>10 人时随机抽 5~7 人，轮数跟随群设置
  const regenBtn = $('#btn-group-regen');
  if (regenBtn) {
    regenBtn.style.display = '';
    regenBtn.onclick = () => {
      if (_grpChains.has(g.id)) { miniToast('群聊正在接龙中，稍等这轮结束'); return; }
      startGroupChain(g, { source: 'manual' });
      miniToast('已开启新一轮群聊回复');
    };
  }
  closeModalPanels();
  cancelQuote();
  if (multiSelectMode) exitMultiSelect();
  switchView('chat');
  ensureModeSwitchUI(); // 20260929af：群聊窗口顶栏模式开关图标同步状态（原 ae 胶囊已改顶栏开关）
  applyChatTheme();
  buildPlusPanel(); // az：群聊模式重建 + 号面板（话题卡/群投票/成员选择弹窗）
  await renderGroupMessages(groupId);
  await setSetting('lastRead_group_' + groupId, Date.now());
  renderGroupNotice(g); // az：群公告横幅
  renderChatList();
}

/* 群聊消息渲染（22：发消息的人头像不一样；20260929w 虚拟滚动——
   旧版 idbGetAll 全量渲染无上限，是低端机聊天页最大性能黑洞） */
async function renderGroupMessages(groupId) {
  const scroll = $('#chat-scroll');
  const all = await idbGetAll('messages');
  const msgs = all.filter(m => m.groupId === groupId).sort((a, b) => a.time - b.time);
  scroll.innerHTML = '';
  if (msgs.length === 0) {
    _chatWin = null;
    scroll.innerHTML = `<div class="empty"><div class="empty-icon">👥</div><div>群聊已开启，说点什么吧</div></div>`;
    return;
  }
  _chatWin = { all: msgs, start: Math.max(0, msgs.length - CHAT_WINDOW), mode: 'group', busy: false, suspend: false };
  ensureChatWindowHooks();
  chatRenderSentinel(scroll);
  _chatWin.suspend = true;
  for (let i = _chatWin.start; i < msgs.length; i++) appendGroupMessage(msgs[i], false);
  _chatWin.suspend = false;
  scrollToBottom();
}

function appendGroupMessage(m, scroll = true) {
  const scrollEl = $('#chat-scroll');
  // 虚拟滚动：新消息同步进窗口数据源（初始渲染/补载时 suspend 挂起，避免重复）
  if (_chatWin && !_chatWin.suspend && _chatWin.mode === 'group') _chatWin.all.push(m);
  const emptyEl = scrollEl.querySelector('.empty');
  if (emptyEl) emptyEl.remove();

  const row = document.createElement('div');
  row.className = 'msg-row ' + (m.from === 'me' ? 'me' : 'them');
  row.dataset.msgid = m.id;
  const g = chatGroups.find(x => x.id === m.groupId);

  // 群聊：发言者头像（自己 or 某访客）
  let av;
  if (m.from === 'me') {
    av = avatarHtml(playerProfile.avatar, playerProfile.name);
  } else {
    const speaker = characters.find(x => x.id === m.charId);
    av = avatarHtml(speaker && speaker.avatar, speaker && speaker.name);
  }
  const body = msgBodyHtml(m);
  if (m.from === 'me') {
    row.innerHTML = `${av}<div class="msg-body">${body}<div class="msg-time">${msgTimeLabel(m.time)}</div></div>`;
  } else {
    // az：群名片优先（玩家给成员单独设的群内昵称）
    const nameTag = `<div class="group-speaker-name">${escapeHtml(groupMemberName(g, m.charId))}</div>`;
    row.innerHTML = `${av}<div class="msg-body">${nameTag}${body}<div class="msg-time">${msgTimeLabel(m.time)}</div></div>`;
  }
  scrollEl.appendChild(row);
  // az：群内互动卡片绑定
  const voteCard = row.querySelector('[data-vote-card]');
  if (voteCard) bindVoteCard(m, voteCard);
  const letterCard = row.querySelector('[data-letter-card]');
  if (letterCard && m.content && m.content.groupLetter) {
    letterCard.onclick = () => {
      openModal(`
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div style="font-size:17px;font-weight:600;">✉️ 书信</div>
          <button class="icon-btn" id="gletter-close">✕</button>
        </div>
        <div style="font-size:14px;line-height:1.8;white-space:pre-wrap;">${escapeHtml(m.content.text || '')}</div>
      `);
      $('#gletter-close').onclick = closeModal;
    };
  }
  // bd：右键 / 长按群聊气泡 → 操作菜单（引用/转发/撤回/删除）——此前群消息没绑定，菜单「不见了」
  if (!m.recalled && g) {
    let pressTimer = null;
    const openGMenu = (x, y) => showGroupMsgMenu(g, m, x, y);
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); openGMenu(e.clientX, e.clientY); });
    const gBodyEl = row.querySelector('.msg-body') || row;
    gBodyEl.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) return; // 20261001ci：多指不触发长按
      const t = e.touches[0];
      pressTimer = setTimeout(() => openGMenu(t.clientX, t.clientY), 550);
    });
    gBodyEl.addEventListener('touchend', () => clearTimeout(pressTimer));
    gBodyEl.addEventListener('touchmove', () => clearTimeout(pressTimer));
    gBodyEl.addEventListener('touchcancel', () => clearTimeout(pressTimer)); // 20261001ci
  }
  if (scroll) scrollToBottom();
}

/* —— @ 工具（20260929ba 细则六）—— */
/* 输入 @ 时弹出群成员选择浮层；点选后把「@已输入片段」替换成完整「@昵称 」 */
function updateAtPopover() {
  const inp = $('#chat-input');
  const g = currentGroupId ? chatGroups.find(x => x.id === currentGroupId) : null;
  if (!inp || !g) { hideAtPopover(); return; }
  const upto = inp.value.slice(0, inp.selectionStart == null ? inp.value.length : inp.selectionStart);
  const mAt = upto.match(/@([^@\s]*)$/);
  if (!mAt) { hideAtPopover(); return; }
  const q = (mAt[1] || '').toLowerCase();
  const members = (g.memberIds || []).map(id => characters.find(x => x.id === id)).filter(Boolean)
    .filter(m => {
      const nick = (g.memberNick || {})[m.id] || '';
      return !q || m.name.toLowerCase().includes(q) || (nick && nick.toLowerCase().includes(q));
    })
    .slice(0, 6);
  if (!members.length) { hideAtPopover(); return; }
  let pop = $('#at-popover');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'at-popover';
    const bar = document.querySelector('.chat-input-bar');
    bar.parentNode.insertBefore(pop, bar);
  }
  pop.innerHTML = members.map(m => `
    <div class="at-item" data-at="${m.id}">
      <div class="avatar sm">${m.avatar ? `<img src="${imgSrc(m.avatar)}">` : escapeHtml(m.name[0] || '?')}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13.5px;font-weight:600;">${escapeHtml((g.memberNick || {})[m.id] || m.name)}</div>
        ${(g.memberNick || {})[m.id] ? `<div style="font-size:11px;color:var(--text-tertiary);">本名 ${escapeHtml(m.name)}</div>` : ''}
      </div>
      <span style="font-size:11px;color:var(--purple-soft);">@</span>
    </div>`).join('');
  pop.classList.add('show');
  pop.querySelectorAll('[data-at]').forEach(el => {
    el.onclick = () => {
      const member = characters.find(x => x.id === el.dataset.at);
      if (!member) return;
      const nick = (g.memberNick || {})[member.id] || member.name;
      const start = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
      const before = inp.value.slice(0, start).replace(/@[^@\s]*$/, '@' + nick + ' ');
      inp.value = before + inp.value.slice(start);
      hideAtPopover();
      inp.focus();
    };
  });
}
function hideAtPopover() {
  const pop = $('#at-popover');
  if (pop) pop.remove();
}
/* 从文本中解析被 @ 的成员 id：按群名片/本名最长匹配（避免「小明」「小明子」误配） */
function parseAtIds(g, text) {
  const ids = [];
  const members = (g.memberIds || []).map(id => characters.find(x => x.id === id)).filter(Boolean);
  const names = [];
  for (const m of members) {
    const nick = (g.memberNick || {})[m.id];
    if (nick) names.push({ id: m.id, name: nick });
    names.push({ id: m.id, name: m.name });
  }
  names.sort((a, b) => b.name.length - a.name.length);
  let rest = text || '';
  for (const nm of names) {
    const token = '@' + nm.name;
    if (rest.includes(token)) {
      if (!ids.includes(nm.id)) ids.push(nm.id);
      rest = rest.split(token).join('');
    }
  }
  return ids;
}
/* 被 @ 的成员立刻引用该消息回复（细则六：让该角色引用这条 @ 立刻回复） */
function scheduleAtQuoteReplies(g, playerMsg, atIds) {
  atIds.forEach((cid, idx) => {
    const member = characters.find(x => x.id === cid);
    if (!member || (g.mutedIds || []).includes(cid)) return;
    setTimeout(async () => {
      try {
        let text;
        if (await isAIMode()) {
          text = await aiSoftReply(member,
            `玩家刚刚在群消息里 @ 了你：「${typeof playerMsg.content === 'string' ? playerMsg.content.slice(0, 80) : '[消息]'}」。请以该成员身份回复玩家：先自然接住 TA 点你的话题，1~2 句，口语化。`,
            () => drawReply(cards, getCharBanWords(member), member.relation || null, member.bannedGroups || []));
        } else {
          text = drawReply(cards, getCharBanWords(member), member.relation || null, member.bannedGroups || []);
        }
        const m2 = {
          id: uid('msg'), groupId: g.id, charId: cid, from: 'them', type: 'text',
          content: text, time: Date.now(),
          quote: { name: playerProfile.name || '我', content: (typeof playerMsg.content === 'string' ? playerMsg.content : '[消息]').slice(0, 60) },
        };
        await idbPut('messages', m2);
        if (currentGroupId === g.id && document.body.dataset.view === 'chat') {
          appendGroupMessage(m2);
        } else {
          renderChatList();
          notifyGroupMention(g, member);
        }
      } catch (e) {}
    }, 900 + idx * 1600 + randInt(0, 900));
  });
}

/* 群聊发送消息（22 + az 细则：玩家发消息后成员按「接龙」依次回复——
   后发言者读前文接话，轮次达上限立即停止，杜绝无限循环与刷屏） */
async function sendGroupMessage(text) {
  if (!currentGroupId) return;
  const trimmed = (text || '').trim();
  if (!trimmed) return;
  const g = chatGroups.find(x => x.id === currentGroupId);
  const myMsg = { id: uid('msg'), groupId: currentGroupId, from: 'me', type: 'text', content: trimmed, time: Date.now() };
  // bd：群聊也支持「引用该条消息」——引用条随消息一起发出（气泡带引用块）
  if (pendingQuote) {
    myMsg.quote = {
      name: pendingQuote.name,
      content: typeof pendingQuote.content === 'string' ? String(pendingQuote.content).slice(0, 60) : '[卡片消息]',
    };
    cancelQuote();
  }
  if (g) {
    const atIds = parseAtIds(g, trimmed);
    if (atIds.length) myMsg.atIds = atIds;
  }
  await idbPut('messages', myMsg);
  appendGroupMessage(myMsg);
  $('#chat-input').value = '';
  palAutoCollectMaybe(null, currentGroupId); // 记忆宫殿：群聊系统随机收藏（归随机成员的访客文件夹）
  // 被 @ 的成员优先、立刻引用回复（细则六），并叠加常规接龙
  if (g && myMsg.atIds && myMsg.atIds.length) scheduleAtQuoteReplies(g, myMsg, myMsg.atIds);
  if (g) startGroupChain(g, { source: 'player' });
}

/* —— 群聊接龙引擎（20260929az 细则）——
   · 1 轮 = 群内每个未禁言成员各发言一次；轮次上限 = 群设置 rounds ?? 总设置 groupRounds（0~5）
   · 接龙式上下文：后发言成员读取最近群消息（尤其上一条）再接话，AI 不再各聊各的
   · 轮次计数器硬上限 = 成员数 × 轮次，写死在循环边界，杜绝死循环卡死
   · 活跃（玩家在群里发消息/话题卡/投票）按轮次上限；后台自主聊天每次只 1 轮 */
function effGroupRounds(g) {
  const gs = getGroupChatSettings(g);
  if (typeof gs.rounds === 'number' && gs.rounds >= 0) return Math.min(5, gs.rounds);
  return Math.min(5, Math.max(0, chatSettings.groupRounds ?? 2));
}
function chainMembers(g) {
  const muted = new Set(g.mutedIds || []);
  return (g.memberIds || []).map(id => characters.find(x => x.id === id)).filter(c => c && !muted.has(c.id));
}
async function putGroupMsg(g, member, text, extra = {}) {
  const m = { id: uid('msg'), groupId: g.id, charId: member.id, from: 'them', type: 'text', content: text, time: Date.now(), ...extra };
  await idbPut('messages', m);
  if (currentGroupId === g.id && document.body.dataset.view === 'chat') {
    appendGroupMessage(m);
  } else {
    renderChatList();
    const cs = getCharChatSettings(member);
    if (document.body.dataset.view !== 'chat' && !cs.muteNotifications) playDing();
    notifyIncoming(member, m.content, g ? (groupMemberName(g, member.id) + ' 在「' + g.name + '」') : undefined); // 20260929bi：群消息后台通知
    // 20260929ba 细则六：成员在消息里 @ 了玩家 → 顶部细条弹窗提醒（谁 @ 了你），点横幅跳进该群
    notifyGroupMention(g, member, m);
  }
  return m;
}
/* 成员 @ 玩家的群外通知（顶部细条横幅；在群聊页内不提醒） */
function notifyGroupMention(g, member, m) {
  try {
    if (!g || !member) return;
    if (currentGroupId === g.id && document.body.dataset.view === 'chat') return;
    const body = (m && typeof m.content === 'string') ? m.content : (m && m.content && m.content.text) || '';
    const atMe = (playerProfile.name && body.includes('@' + playerProfile.name)) || (m && Array.isArray(m.atIds) && m.atIds.includes('me'));
    if (!atMe) return;
    const who = groupMemberName(g, member.id);
    const gname = g.name || '群聊';
    showTopBanner(`<div class="tb-sub" style="font-size:11px;color:var(--purple-soft);">${escapeHtml(gname)}</div>「${escapeHtml(who)}」@ 了你`, { groupId: g.id, dur: 4200 });
  } catch (e) {}
}
const _grpChains = new Set(); // 正在接龙的群 id（防叠加：上一轮没结束不开启新一轮）
function startGroupChain(g, opts = {}) {
  const rounds = Math.max(0, opts.rounds != null ? opts.rounds : effGroupRounds(g));
  let members = chainMembers(g);
  // 20260929be：手动生成按钮（source manual）在大群（>10 人）随机抽 5~7 人开一轮，避免刷屏
  if (opts.source === 'manual' && members.length > 10) {
    const n = randInt(5, 7);
    members = members.slice().sort(() => Math.random() - 0.5).slice(0, n);
  }
  if (rounds === 0 || members.length === 0) return;
  if (_grpChains.has(g.id)) return;
  _grpChains.add(g.id);
  g._lastSpeakerId = g._lastSpeakerId || null;
  const total = members.length * rounds; // 硬上限
  let i = 0;
  const step = async () => {
    try {
      if (i >= total || !chatGroups.some(x => x.id === g.id)) { _grpChains.delete(g.id); return; }
      const member = members[i % members.length];
      const roundIdx = Math.floor(i / members.length); // 当前轮次（0 起）
      const isFinal = (i === total - 1);
      const prevSpeakerId = g._lastSpeakerId;
      // 20260929bd：每个成员每轮随机发 1~3 条（抽到几条发几条），连发间隔 1.4~2.8s
      const count = 1 + randInt(0, 2);
      const res = await generateGroupReplyText(g, member, { isFinal, roundIdx, roundsTotal: rounds, source: opts.source || 'player', count });
      const texts = Array.isArray(res) ? res.filter(Boolean).slice(0, count) : [res];
      for (let k = 0; k < texts.length; k++) {
        if (k > 0) {
          await new Promise(r => setTimeout(r, randInt(1400, 2800)));
          if (!chatGroups.some(x => x.id === g.id)) { _grpChains.delete(g.id); return; }
        }
        await putGroupMsg(g, member, texts[k]);
        if (k === 0) grpRecordInteraction(g, prevSpeakerId, member.id, texts[0]); // 关系网自动同步计数（AI 模式，仅首条计一次）
        g._lastSpeakerId = member.id;
      }
      i++;
      if (i >= total) { _grpChains.delete(g.id); return; }
      // 20260929ba：发言间隔统一用群回复节奏（字卡模式同样生效，不只 AI 模式）
      const gs = getGroupChatSettings(g);
      setTimeout(step, Math.max(1.2, randInt(gs.replyMin, gs.replyMax)) * 1000);
    } catch (e) { _grpChains.delete(g.id); }
  };
  const gs0 = getGroupChatSettings(g);
  setTimeout(step, Math.max(1.2, randInt(gs0.replyMin, gs0.replyMax)) * 1000);
}

/* 群聊回复文本：AI 模式 = 接龙式上下文（最近群消息喂给 AI，接上一条相关的话）；
   字卡模式 = 按成员禁词/关系抽卡。AI 失败一律回退字卡，绝不中断群聊。
   轮次语义（20260929ba 细则）：
   · source 'player'：第 1 轮 = 每人回应玩家（有概率自然 @ 玩家，不要每条都 @）；
     第 2 轮起 = 成员之间互相探讨话题，不 @ 玩家；最后一轮收尾的那条必须 @ 玩家交回话题。
   · 其他 source（红包道谢/回信/话题/后台）维持原有行为。 */
async function generateGroupReplyText(g, member, opts = {}) {
  const card = () => drawReply(cards, getCharBanWords(member), member.relation || null, member.bannedGroups || []);
  // 20260929bd：count>1 = 一次生成 count 条（每条一行，返回数组）；默认 1 条返回字符串（红包道谢/群书信等旧调用不受影响）
  const wantN = Math.max(1, Math.min(3, opts.count || 1));
  const drawCards = (num) => {
    const arr = [];
    for (let k = 0; k < num; k++) {
      let t = card(), tries = 0;
      while (arr.includes(t) && tries < 3) { t = card(); tries++; }
      arr.push(t);
    }
    return arr;
  };
  if (!(await isAIMode())) return wantN > 1 ? drawCards(wantN) : card();
  try {
    const all = await idbGetAll('messages');
    const recent = all.filter(m => m.groupId === g.id).sort((a, b) => a.time - b.time).slice(-12);
    // 20260929bb：话题卡/投票把实际内容喂给 AI；20261001ci：统一走全局 msgBodyText（图片/表情包/红包等可读描述）
    const cardBody = (m) => msgBodyText(m);
    const lines = recent.map(m => {
      const who = m.from === 'me' ? (playerProfile.name || '我') : groupMemberName(g, m.charId);
      return `${who}：${cardBody(m)}`;
    }).join('\n');
    const src = opts.source || 'player';
    const roundIdx = opts.roundIdx || 0;
    let stance = '';
    if (src === 'player') {
      if (opts.isFinal) {
        stance = '这条是本轮收尾：请在结尾自然地 @ 玩家（用「@」加对玩家的称呼），邀请 TA 说两句。';
      } else if (roundIdx === 0) {
        stance = '这是玩家刚发言后的第一轮：请回应玩家说的话。大约只有四分之一的概率在句中自然地 @ 玩家一次，其余情况不要 @ 玩家，像正常群聊一样说话即可。';
      } else {
        stance = '这是后续轮次，成员之间互相聊天：请直接接上一条其他成员（不是玩家）说的话，@ 或称呼那位成员的名字来回应、抬杠、补充或调侃 TA，语气像朋友之间聊天。绝对不要 @ 玩家、不要回应玩家、不要向玩家汇报或征求玩家意见。';
      }
    } else if (src === 'topic') {
      // 20260929bb：话题卡来源——明确要求围绕话题内容聊天
      stance = '玩家刚在群里抛出了一张话题卡（见最近记录里的「话题卡：…」）：请围绕该话题内容自然接话，聊自己的经历、看法或抛给大家的新角度，1~2 句，口语化。';
    } else {
      stance = '请以该成员身份发出下一条群消息：接龙式回应上面（尤其最后一条）相关的内容，1~2 句，口语化。';
    }
    // 20260929bd：连发多条——每条单独一行输出，像真实群聊里连着发几条
    if (wantN > 1) {
      stance += opts.isFinal
        ? ` 你会连着发 ${wantN} 条消息：每条单独一行输出（共 ${wantN} 行），最后一条的结尾自然地 @ 玩家，邀请 TA 说两句。`
        : ` 你会连着发 ${wantN} 条消息：每条单独一行输出（共 ${wantN} 行），像真实聊天里连着发几条，几条之间可以是补充、吐槽或自问自答。`;
    }
    const cfg = await loadAIConfig();
    const ctx = await buildCharAIContext(member.id, []);
    // 20261001ci：收集最近群消息里的图片/表情包 → vision 附加（模型不支持时去图重试）
    const gImgs = await collectMsgImageDataUrls(recent, 3);
    const gSys = (extraVision) => `你是角色扮演 AI，扮演群聊「${g.name}」里的成员「${groupMemberName(g, member.id)}」（本名 ${member.name}）。群成员：${(g.memberIds || []).map(id => groupMemberName(g, id)).join('、')}，以及玩家（${playerProfile.name || '我'}）。\n群聊是大家一起聊天的场合，成员之间也会互相聊天、互相 @ 对方、抬杠调侃，不是每句话都围着玩家转。\n最近群聊记录：\n${lines}\n${stance}${extraVision}\n要求：1~2 句，口语化，不要复述记录，不要跳出角色，不要提“AI”“模型”，除要求外不要出现「@」。\n隐藏指令：这段对话里有值得你永久记住的事时，另起一行输出 [[MEMO:一句话记忆]]（最多一条，宁缺毋滥）。\n\n${ctx}`;
    const gUser = (withImgs) => withImgs
      ? { role: 'user', content: [{ type: 'text', text: '请发出群里的下一条消息。最近记录里的图片/表情包已按时间顺序附在下面。' }, ...gImgs.map(im => ({ type: 'image_url', image_url: { url: im.dataUrl } }))] }
      : { role: 'user', content: '请发出群里的下一条消息。' };
    const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
      { role: 'system', content: gSys(gImgs.length ? '\n【视觉输入】本条消息末尾附上了最近群聊里的图片/表情包（按时间顺序），你可以直接看到它们。' : '') },
      gUser(gImgs.length > 0),
    ]);
    let rr = r;
    if (!rr.ok && gImgs.length) {
      rr = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
        { role: 'system', content: gSys('') }, gUser(false),
      ]);
    }
    if (rr.ok && rr.text) {
      const parsed = parseAITags(rr.text);
      if (parsed.memo) aiPalStoreMemo(member.id, parsed.memo);
      if (wantN > 1) {
        // 拆行 → 去行首序号 → 过滤空行，最多取 wantN 条；一条都没拆出来就回退单条
        let arr = String(parsed.clean || '').split('\n').map(s => s.trim().replace(/^\d+[.、)）]\s*/, '')).filter(Boolean);
        if (!arr.length) return [card()];
        return arr.slice(0, wantN);
      }
      return parsed.clean || card();
    }
    return wantN > 1 ? drawCards(wantN) : card();
  } catch (e) { return wantN > 1 ? [card()] : card(); }
}
let batchSelected = new Set();
let batchMode = false;

function enterBatchMode() {
  if (batchMode) return;
  batchMode = true;
  batchSelected = new Set();
  renderBatchList();
}

function renderBatchList() {
  const list = $('#chat-list');
  _chatListSig = null; // 批量列表接管了 #chat-list 的 DOM，重置签名让退出后 renderChatList 必定重绘
  list.innerHTML = `
    <div style="padding:10px 18px;color:var(--text-tertiary);font-size:13px;">已选 ${batchSelected.size} 个访客 · 点击访客勾选</div>
  `;
  characters.forEach(c => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const checked = batchSelected.has(c.id);
    item.innerHTML = `
      <div class="avatar">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : (c.name[0] || '?')}</div>
      <div style="flex:1;font-size:16px;font-weight:600;">${escapeHtml(c.name)}</div>
      <div style="width:24px;height:24px;border-radius:50%;border:2px solid var(--text-tertiary);display:flex;align-items:center;justify-content:center;font-size:14px;${checked ? 'background:var(--purple);border-color:var(--purple);color:#141019;' : ''}">${checked ? '✓' : ''}</div>
    `;
    item.onclick = () => {
      if (batchSelected.has(c.id)) batchSelected.delete(c.id);
      else batchSelected.add(c.id);
      renderBatchList();
    };
    list.appendChild(item);
  });
  // 底部操作栏
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:10px;padding:12px 18px;border-top:1px solid var(--border);flex-wrap:wrap;';
  bar.innerHTML = `
    <button class="btn" style="flex:1;" id="batch-cancel">取消</button>
    <button class="btn" style="flex:1;" id="batch-move">移入分组</button>
    <button class="btn primary" style="flex:1;" id="batch-group">建立群聊</button>
    <button class="btn danger" style="flex:1;" id="batch-delete">删除所选</button>
  `;
  list.appendChild(bar);
  $('#batch-cancel').onclick = () => { batchMode = false; batchSelected = new Set(); renderChatList(); };
  // 20260929be：批量勾选多个访客 → 直接移入某个分组（与建立群聊同交互）
  $('#batch-move').onclick = () => {
    if (batchSelected.size === 0) { showToast('请先勾选访客'); return; }
    if (charGroups.length === 0) { showToast('还没有分组，先在「访客分组」里新建一个'); return; }
    openModal(`
      <div style="font-size:17px;font-weight:600;margin-bottom:14px;">把 ${batchSelected.size} 位访客移入分组</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;">
        ${charGroups.map((g, gi) => `
          <button class="btn" style="justify-content:flex-start;" data-bm-group="${gi}">${icon('folder', 15)} ${escapeHtml(g.name)}（${(g.memberIds || []).length}）</button>
        `).join('')}
      </div>
      <button class="btn block" id="bm-cancel">取消</button>
    `);
    $('#bm-cancel').onclick = () => { closeModal(); renderBatchList(); };
    document.querySelectorAll('[data-bm-group]').forEach(btn => {
      btn.onclick = async () => {
        const grp = charGroups[parseInt(btn.dataset.bmGroup)];
        const moved = batchSelected.size;
        batchSelected.forEach(cid => {
          charGroups.forEach(g => { if (g !== grp) g.memberIds = (g.memberIds || []).filter(x => x !== cid); });
          if (!grp.memberIds.includes(cid)) grp.memberIds.push(cid);
        });
        await saveCharGroupsAndRefresh();
        batchMode = false;
        batchSelected = new Set();
        closeModal();
        renderChatList();
        miniToast(`已把 ${moved} 位访客移入「${grp.name}」`);
      };
    });
  };
  $('#batch-group').onclick = () => {
    if (batchSelected.size < 2) { showToast('至少选择 2 个访客才能建群'); return; }
    createGroup([...batchSelected]);
  };
  $('#batch-delete').onclick = () => {
    if (batchSelected.size === 0) { showToast('请先勾选访客'); return; }
    showConfirm(`确定删除选中的 ${batchSelected.size} 个访客吗？此操作无法撤销。`, async () => {
      for (const id of batchSelected) await deleteCharacter(id);
      batchMode = false;
      batchSelected = new Set();
      renderChatList();
    });
  };
}

async function openChat(charId) {
  if (currentGroupId) markGroupBgChatWindow(currentGroupId); // az：离开群聊 → 挂 20 分钟窗口
  currentCharId = charId;
  currentGroupId = null;
  const c = characters.find(x => x.id === charId);
  if (!c) return;
  const regenBtn = $('#btn-group-regen');
  if (regenBtn) regenBtn.style.display = 'none'; // 20260929be：单聊不显示群生成按钮
  $('#chat-name').textContent = c.name;
  restoreChatHeaderStatus(); // 顶部状态：按时段抽状态（7）
  $('#chat-avatar').innerHTML = c.avatar ? `<img src="${imgSrc(c.avatar)}">` : (c.name[0] || '?');
  // 单聊：点顶部头像区进访客主页；三点按钮也进访客主页（群聊时会被改为群聊设置）
  // 注意：必须用箭头函数包装——直接传函数引用会把 Event 对象当成 charId 参数导致主页打不开
  $('#chat-header').onclick = () => showCharProfile();
  $('#btn-char-profile').onclick = () => showCharProfile();
  closeModalPanels();
  cancelQuote();
  if (multiSelectMode) exitMultiSelect();
  switchView('chat');
  ensureModeSwitchUI(); // 20260929ae：聊天窗口内字卡/AI 模式切换胶囊
  applyChatTheme(); // 按角色应用独立聊天背景
  buildPlusPanel(); // az：按单聊模式重建 + 号面板（群聊专属项隐藏）
  await renderMessages(charId);
  // 标记已读：清除该访客未读数
  await setSetting('lastRead_' + charId, Date.now());
  renderChatList();
  // 20260929au：进入聊天页时，若该访客有挂起的超频动画/未读，播最后一条（惊喜优先）+ 清未读
  _ocOnEnterChat(c);
  // 20260929au：进入聊天页时，若该访客有挂起的书信，只播一次开信动画（多封也只播一次）
  _letterOnEnterChat(c);
  // 超频：第三天首次进访客聊天时触发故障动画 + 维度裂隙（一次性）
  maybeTriggerOverclockIntro();
}

/* ---------- 聊天消息虚拟滚动（20260929w）----------
   长聊天记录此前一次性渲染全部消息（单聊 200 条、群聊无上限全量），低端机打开聊天明显卡顿。
   现在：首屏只渲染最近 CHAT_WINDOW 条，上滑到顶附近自动补载更早的一批；
   DOM 总量超过 CHAT_MAX_DOM 时从顶部清理最旧的一批（数据都在库里，上滑可再载入）。
   appendMessage / appendGroupMessage 的行交互（长按菜单/多选/卡片刷新）全部保留不动。 */
const CHAT_WINDOW = 60;    // 首屏渲染条数
const CHAT_LOAD_STEP = 60; // 上滑每次补载条数
const CHAT_MAX_DOM = 240;  // DOM 消息行上限，超出从顶部清理
let _chatWin = null;       // { all, start, mode:'single'|'group', busy, suspend }

/* 渲染完窗口后，在顶部插一个「加载更早」哨兵行（start==0 时显示已到开头） */
function chatRenderSentinel(scroll) {
  const old = scroll.querySelector('#chat-loadmore');
  if (old) old.remove();
  if (!_chatWin || _chatWin.start <= 0) return;
  const s = document.createElement('div');
  s.id = 'chat-loadmore';
  s.style.cssText = 'text-align:center;font-size:12px;color:var(--text-tertiary);padding:10px 0 6px;cursor:pointer;';
  s.textContent = `⬆ 上滑或点这里加载更早的消息（还有 ${_chatWin.start} 条）`;
  s.onclick = () => chatLoadOlder();
  scroll.prepend(s);
}

function ensureChatWindowHooks() {
  const scroll = $('#chat-scroll');
  if (!scroll || scroll._winHooked) return;
  scroll._winHooked = true;
  scroll.addEventListener('scroll', () => {
    if (!_chatWin || _chatWin.busy || _chatWin.start <= 0) return;
    if (scroll.scrollTop < 80) chatLoadOlder();
  }, { passive: true });
}

/* 上滑补载更早一批：先渲染再搬移到顶部，滚动位置用高度差补偿 */
function chatLoadOlder() {
  const scroll = $('#chat-scroll');
  const w = _chatWin;
  if (!w || w.busy || w.start <= 0) return;
  w.busy = true;
  const step = Math.min(CHAT_LOAD_STEP, w.start);
  const prevH = scroll.scrollHeight, prevTop = scroll.scrollTop;
  const anchor = scroll.querySelector('#chat-loadmore') ? scroll.querySelector('#chat-loadmore').nextSibling : scroll.firstChild;
  w.suspend = true;
  for (let i = w.start - step; i < w.start; i++) {
    if (w.mode === 'group') appendGroupMessage(w.all[i], false);
    else appendMessage(w.all[i], false);
    const row = scroll.lastChild; // 刚追加到末尾的行，搬到锚点前
    if (row && anchor && row !== anchor) scroll.insertBefore(row, anchor);
  }
  w.suspend = false;
  w.start -= step;
  // 顶部清理：DOM 行数超上限时移除最旧一批
  let rendered = scroll.querySelectorAll('.msg-row').length;
  if (rendered > CHAT_MAX_DOM) {
    const rows = scroll.querySelectorAll('.msg-row');
    const excess = rendered - CHAT_MAX_DOM;
    let removedH = 0;
    for (let i = 0; i < excess; i++) {
      removedH += rows[i].offsetHeight;
      rows[i].remove();
    }
    w.start += excess;
    scroll.scrollTop = prevTop + (scroll.scrollHeight - prevH) - removedH;
  } else {
    scroll.scrollTop = prevTop + (scroll.scrollHeight - prevH);
  }
  chatRenderSentinel(scroll);
  // 防连环自动触发：清理+补偿后若仍贴顶，轻推回哨兵可见位——
  // 否则「加载→清理→scrollTop 补偿→仍<80→再加载」会一口气循环载完全部历史
  if (w.start > 0 && scroll.scrollTop < 60) scroll.scrollTop = 80;
  w.busy = false;
}

async function renderMessages(charId) {
  const scroll = $('#chat-scroll');
  // 数据乱串根治（用户 20260925 反馈）：群聊消息落库带 charId+groupId，之前这里只按 charId 取，
  // 群聊里说的话全被串进该访客的单聊——现在排除一切带 groupId 的消息，单聊只留单聊
  const msgs = (await idbGetMessagesByChar(charId, 100000)).filter(m => !m.groupId);
  scroll.innerHTML = '';
  if (msgs.length === 0) {
    _chatWin = null;
    scroll.innerHTML = `<div class="empty"><div class="empty-icon">💭</div><div>说点什么，开启你们的对话吧</div></div>`;
    return;
  }
  _chatWin = { all: msgs, start: Math.max(0, msgs.length - CHAT_WINDOW), mode: 'single', busy: false, suspend: false };
  ensureChatWindowHooks();
  chatRenderSentinel(scroll);
  _chatWin.suspend = true;
  for (let i = _chatWin.start; i < msgs.length; i++) appendMessage(msgs[i], false);
  _chatWin.suspend = false;
  scrollToBottom();
}

/* 消息头像（5.2/22：气泡旁显示发送者头像） */
function avatarHtml(avatar, name) {
  return `<div class="msg-avatar">${avatar ? `<img src="${imgSrc(avatar, true)}">` : escapeHtml(name ? name[0] || '?' : '?')}</div>`;
}

/* 引用块渲染（右键菜单 → 引用该条消息） */
function quoteHtml(q) {
  if (!q) return '';
  const brief = typeof q.content === 'string' && q.content.length <= 40
    ? q.content
    : (typeof q.content === 'string' ? q.content.slice(0, 40) + '…' : '[卡片消息]');
  return `<div class="msg-quote"><div class="msg-quote-name">${escapeHtml(q.name)}</div><div class="msg-quote-text">${escapeHtml(brief)}</div></div>`;
}

/* 查岗是否已完成一轮应答（20260925i：角色已回应过玩家的回复）。
   完成后卡片闭合，不再显示「回复查岗」——与书信线程同一套「一轮即闭合」逻辑，杜绝无限回复 */
function checkinAnswered(m) {
  if (!m || m.from !== 'them' || !m.content) return true;
  if (m.content.answered) return true;
  const rs = m.content.replies || [];
  if (!rs.length) return false;
  // 旧数据无 answered 标记：最后一条回复是角色本人说的、且玩家回复过 → 视为已完成一轮
  const c = characters.find(x => x.id === m.charId);
  const me = playerProfile.name || '我';
  return !!(c && rs[rs.length - 1].who === c.name && rs.some(r => r.who === me));
}

/* 就地刷新某条查岗卡片内的回复列表（4：查岗回复要显示在卡片内） */
function refreshCheckinCardReplies(m) {
  const card = document.querySelector(`[data-checkin-card="${m.id}"]`);
  if (!card) return;
  const replies = (m.content && m.content.replies) || [];
  // 移除旧的回复区
  const old = card.querySelector('.checkin-replies');
  if (old) old.remove();
  // 按钮保持在最后，因此在按钮前插入回复区
  const btn = card.querySelector('[data-checkin-reply]');
  // 已完成一轮应答：按钮移除，卡片闭合（20260925i 防无限回复）
  if (btn && checkinAnswered(m)) btn.remove();
  const replyHtml = replies.length
    ? `<div class="checkin-replies" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);display:flex;flex-direction:column;gap:5px;">${replies.map(r => `<div style="font-size:12px;line-height:1.45;color:var(--text-secondary);"><span style="color:var(--text-tertiary);">${escapeHtml(r.who)}：</span>${escapeHtml(r.text)}</div>`).join('')}</div>`
    : '';
  if (replyHtml) {
    if (btn) btn.insertAdjacentHTML('beforebegin', replyHtml);
    else card.insertAdjacentHTML('beforeend', replyHtml);
  }
}

/* 消息主体渲染（5.6 消息类型） */
function msgBodyHtml(m, oneLine = false) {
  if (m.recalled) {
    const who = m.from === 'me' ? '你' : '对方';
    return `<div class="msg-recalled" data-msgid="${m.id}">${who}撤回了一条消息</div>`;
  }
  const bubbleCls = oneLine ? 'bubble oneline' : 'bubble';
  switch (m.type) {
    case 'image':
      return `${quoteHtml(m.quote)}<img class="msg-img" src="${imgSrc(m.content, true)}" data-full="${imgSrc(m.content)}" data-msgid="${m.id}">`;
    case 'emoji':
      return `${quoteHtml(m.quote)}<img class="msg-img msg-emoji" src="${imgSrc(m.content)}" data-msgid="${m.id}">`;
    case 'coin':
      return `${quoteHtml(m.quote)}<div class="msg-card"><span class="msg-card-tag">🪙 决策币</span><div>${escapeHtml(m.content.question)}</div><div style="margin-top:6px;font-size:20px;font-weight:700;color:var(--purple-soft);">${escapeHtml(m.content.result)}</div></div>`;
    case 'checkin': {
      const replies = (m.content && m.content.replies) || [];
      const replyHtml = replies.length
        ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);display:flex;flex-direction:column;gap:5px;">${replies.map(r => `<div style="font-size:12px;line-height:1.45;color:var(--text-secondary);"><span style="color:var(--text-tertiary);">${escapeHtml(r.who)}：</span>${escapeHtml(r.text)}</div>`).join('')}</div>`
        : '';
      return `${quoteHtml(m.quote)}<div class="msg-card" data-checkin-card="${m.id}"><span class="msg-card-tag">📍 突击查岗</span><div>${escapeHtml(m.content.text)}</div>${replyHtml}${m.from === 'them' && !checkinAnswered(m) ? `<button class="btn primary" style="margin-top:8px;padding:6px 12px;font-size:12px;" data-checkin-reply="${m.id}">回复查岗</button>` : ''}</div>`;
    }
    case 'call':
      // 20260929ba：群通话卡片显示参与人数
      if (m.content.group) {
        return `${quoteHtml(m.quote)}<div class="msg-card"><span class="msg-card-tag">${m.content.kind === 'video' ? '📹 群视频通话' : '🎙️ 群语音通话'}</span><div style="margin-top:4px;">${(m.content.memberIds || []).length} 人参与 · ${m.content.missed ? '无人接听' : (m.content.ended ? `通话时长 ${formatDuration(m.content.duration)}` : '通话中…')}</div></div>`;
      }
      return `${quoteHtml(m.quote)}<div class="msg-card"><span class="msg-card-tag">${m.content.kind === 'video' ? '📹 视频通话' : '🎙️ 语音通话'}</span><div style="margin-top:4px;">${m.content.missed ? '未接听' : (m.content.ended ? `通话时长 ${formatDuration(m.content.duration)}` : '通话中…')}</div></div>`;
    case 'transfer': {
      const st = m.content.status || 'claimed';
      let statusLine = '';
      if (m.content.returnedNote) statusLine = `<div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(m.content.returnedNote)}</div>`;
      else if (st === 'pending') statusLine = `<div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">待领取…</div>`;
      else if (st === 'claimed') statusLine = `<div style="font-size:12px;color:var(--ok);margin-top:4px;">已领取</div>`;
      else if (st === 'returned') statusLine = `<div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">已退回</div>`;
      // 角色发来的转账（char_to_me）且待领取：显示「领取 / 退回」按钮
      const isCharToMePending = m.content.direction === 'char_to_me' && st === 'pending';
      return `${quoteHtml(m.quote)}<div class="msg-card" data-transfer-card="${m.id}"><span class="msg-card-tag">🧧 转账</span><div style="font-size:18px;font-weight:700;color:var(--purple-soft);">¥${m.content.amount}</div>${m.content.note ? `<div style="font-size:12px;color:var(--text-tertiary);margin-top:3px;">${escapeHtml(m.content.note)}</div>` : ''}${statusLine}${isCharToMePending ? `<div style="display:flex;gap:8px;margin-top:8px;"><button class="btn primary" style="padding:5px 12px;font-size:12px;flex:1;" data-transfer-claim="${m.id}">领取</button><button class="btn" style="padding:5px 12px;font-size:12px;flex:1;" data-transfer-return="${m.id}">退回</button></div>` : ''}</div>`;
    }
    case 'grouppacket': // az：群红包（细则拓展 3）
      return gpacketCardHtml(m);
    case 'topic': // az：话题卡（细则拓展 2）
      return `<div class="msg-card" style="border-color:var(--purple);"><span class="msg-card-tag">💬 话题卡</span><div style="font-weight:600;">${escapeHtml(m.content.text)}</div><div style="font-size:11.5px;color:var(--text-tertiary);margin-top:4px;">话题已抛出，大家聊聊吧</div></div>`;
    case 'vote': // az：群投票（细则拓展 4）
      return voteCardHtml(m);
    case 'letter': {
      const who = m.from === 'me' ? '寄给 TA 的信' : 'TA 寄来的信';
      return `<div class="letter-card" data-letter-card="${m.id}">
        <div class="lc-flap"></div>
        <div class="lc-tag">✉️ ${who}</div>
        <div class="lc-title">一封书信</div>
        <div class="lc-preview">${escapeHtml(m.content.preview || '')}</div>
        ${!m.read && m.from === 'them' ? '<div class="lc-unread"></div>' : ''}
        <div class="lc-seal">🕯️</div>
      </div>`;
    }
    case 'share': {
      // 朋友圈分享卡片（玩家从朋友圈分享给角色）
      const sc = m.content || {};
      return `<div class="msg-share-card">
        <span class="msg-card-tag">📤 朋友圈分享</span>
        <div style="margin-top:6px;font-size:13px;font-weight:600;">${escapeHtml(sc.authorName || '朋友圈')}</div>
        ${sc.text ? `<div style="margin-top:4px;font-size:13.5px;line-height:1.55;word-break:break-word;">${escapeHtml(sc.text)}</div>` : ''}
        ${sc.sticker ? `<div style="margin-top:4px;font-size:30px;line-height:1.2;">${escapeHtml(sc.sticker)}</div>` : ''}
        ${sc.img ? `<img src="${imgSrc(sc.img, true)}" style="margin-top:6px;max-width:180px;max-height:130px;object-fit:cover;border-radius:10px;border:1px solid var(--border);">` : ''}
        <div style="margin-top:6px;font-size:11px;color:var(--text-tertiary);">${(sc.images || []).length > 1 ? `共 ${sc.images.length} 张图 · ` : ''}${escapeHtml(timeAgoStr(sc.time || m.time))}</div>
      </div>`;
    }
    case 'survey': {
      // 问卷卡片（20260929al）：玩家发出或角色发起的一份问卷
      // 20260929an：卡片上显示「预计还有 X 分钟回答」倒计时（用户要求）
      const sv = m.content || {};
      const isCharAsk = m.from === 'them' || sv.charAsk;
      const answered = sv.answeredCount || 0;
      const total = sv.totalCount || (sv.questions ? sv.questions.length : 0);
      let status;
      if (sv.done) status = '已全部回答';
      else if (isCharAsk) status = '等你来答';
      else if (sv.queueAt) {
        const remain = Math.ceil((sv.queueAt - Date.now()) / 60000);
        status = remain > 0 ? ('预计还有 ' + remain + ' 分钟回答') : '正在翻问卷作答…';
      } else status = '待回答';
      return `<div class="msg-card" data-survey-card="${m.id}" style="cursor:pointer;">
        <span class="msg-card-tag">📋 ${isCharAsk ? 'TA 的问卷' : '我发出的问卷'}</span>
        <div style="margin-top:4px;font-size:14px;font-weight:600;">${escapeHtml(sv.title || '我向你发出了一份问卷，快来回答吧！')}</div>
        <div style="margin-top:4px;font-size:12px;color:var(--text-tertiary);">共 ${total} 题 · ${status}</div>
        ${!isCharAsk && !sv.done ? `<div style="margin-top:6px;font-size:11px;color:var(--text-tertiary);">点击查看题目与回答状态</div>` : ''}
      </div>`;
    }
    case 'gift': {
      // 超频礼物卡片（20260929ap 重做）：顶部真实礼物图；访客送且未打开 → 高亮「打开礼物」按钮
      const gc = m.content || {};
      const fromChar = m.from === 'them' || gc.direction === 'char_to_me';
      const isOpened = gc.opened !== false; // 旧消息无 opened 字段 → 视为已打开（兼容 ao 旧卡）
      const imgHtml = _ocGiftImgOf(gc) ? `<img src="${imgSrc(_ocGiftImgOf(gc), true)}" style="width:100%;height:110px;object-fit:cover;display:block;">` : `<div style="font-size:44px;text-align:center;padding:20px 0;">🎁</div>`;
      return `<div class="msg-card" data-gift-card="${m.id}" style="cursor:pointer;overflow:hidden;padding:0;">
        <div style="position:relative;">
          ${imgHtml}
          <span class="msg-card-tag" style="position:absolute;top:8px;left:8px;background:rgba(10,8,16,0.55);">${fromChar ? 'TA 送的礼物' : '我送出的礼物'}</span>
        </div>
        <div style="padding:10px 12px 12px;">
          <div style="display:flex;align-items:baseline;gap:8px;">
            <div style="font-size:14px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(gc.giftName || '礼物')}</div>
            ${gc.price ? `<div style="font-size:11px;color:var(--text-tertiary);">¥${gc.price}</div>` : ''}
          </div>
          ${fromChar && !isOpened
            ? `<button class="btn primary block" data-gift-open-btn="${m.id}" style="margin-top:10px;">打开礼物</button>`
            : (gc.note ? `<div style="font-size:12.5px;color:var(--text-secondary);font-style:italic;margin-top:6px;line-height:1.6;">“${escapeHtml(gc.note)}”</div>` : '')}
        </div>
      </div>`;
    }
    case 'surprise': {
      // 超频惊喜卡片（20260929ao）：故障风大字（20260929av：卡片不放问号——问号只在裂隙跳出动画里出现）
      const sc = m.content || {};
      return `<div class="msg-card" data-surprise-card="${m.id}">
        <span class="msg-card-tag">✨ 惊喜</span>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:4px;">Ta（${escapeHtml(sc.act || '')}），决定跨越维度，（${escapeHtml(sc.move || '')}），</div>
        <div style="font-size:24px;font-weight:900;color:#e5615c;margin-top:6px;letter-spacing:1px;text-shadow:0 0 10px rgba(229,97,92,.5);">${escapeHtml(sc.big || '！')}</div>
      </div>`;
    }
    case 'text':
    default: {
      // 单字消息：字在气泡正中间（不偏左）；单个 emoji 且有微软 Fluent 本地图 → 大图展示（20260929at）
      const plain = typeof m.content === 'string' ? m.content.trim() : '';
      const cps = [...plain];
      const isSingle = !m.quote && cps.length === 1;
      const isSoloEmoji = !m.quote && cps.length >= 1 && cps.length <= 2
        && (cps.length === 1 || cps[1].codePointAt(0) === 0xFE0F)
        && /\p{Extended_Pictographic}/u.test(cps[0]);
      const emoImg = isSoloEmoji ? emojiImgOf(plain, 'msg-emoji-img') : '';
      return `${quoteHtml(m.quote)}<div class="${bubbleCls}${isSingle ? ' msg-single' : ''}">${emoImg || escapeHtml(m.content)}</div>`;
    }
  }
}

/* 多选模式状态 */
let multiSelectMode = false;
let multiSelected = new Set();
/* 待引用消息（发送时附加） */
let pendingQuote = null;

/* 颜文字筛选：判定一条纯文本是不是颜文字（(づ｡◕‿‿◕｡)づ、(T_T)、😀🎉 等）。
   规则：不含数字/汉字/谚文，也没有"连续两个字母"以上的词 → 视为颜文字。
   注：日文假名（づ、ノ）和希腊字母（ω）是颜文字常用件，不算文本；
   (T_T) 里单个 T 也不算；"LOL"、"2333"、"哈哈哈" 都会正常按文本换行。 */
function isKaomojiText(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t || t.includes('\n')) return false;
  if (/[0-9\u3400-\u9FFF\uAC00-\uD7AF]/.test(t)) return false;        // 数字 / 汉字 / 谚文 → 正常文本
  if (/[A-Za-z\u00C0-\u024F\u0370-\u04FF]{2}/.test(t)) return false;  // 连续字母（单词）→ 正常文本
  // 20260929bo：纯 emoji 长串（≥7 个）不再走单行——单行模式 nowrap+横向滑动，
  // 超出气泡宽度的表情会被裁掉（用户反馈"发多个表情会被吞掉一些"），改回正常换行保证全量可见
  if ((t.match(/\p{Extended_Pictographic}/gu) || []).length >= 7) return false;
  return [...t].length >= 2;
}

function appendMessage(m, scroll = true) {
  const scrollEl = $('#chat-scroll');
  // 虚拟滚动：新消息同步进窗口数据源（初始渲染/补载时 suspend 挂起，避免重复）
  if (_chatWin && !_chatWin.suspend && _chatWin.mode === 'single') _chatWin.all.push(m);
  const emptyEl = scrollEl.querySelector('.empty');
  if (emptyEl) emptyEl.remove();

  /* 戳一戳：聊天页中间独立展示（非气泡、带昵称），与普通消息渲染完全分离 */
  if (m.type === 'poke') {
    const pc = characters.find(x => x.id === m.charId);
    const who = m.from === 'me' ? '你' : (pc ? pc.name : '梦角');
    const row = document.createElement('div');
    row.className = 'msg-row poke-row';
    row.dataset.msgid = m.id;
    row.innerHTML = `<div class="poke-msg"><span class="poke-ic">👆</span><span><span class="poke-who">${escapeHtml(who)}</span> ${escapeHtml(m.content)}</span></div>`;
    // 长按/右键 → 删除（戳一戳不参与引用/转发/多选/撤回）
    let pokePress = null;
    const delPoke = () => showConfirm('删除这条戳一戳吗？', async () => {
      await idbDelete('messages', m.id);
      row.remove();
    });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); delPoke(); });
    row.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) return; // 20261001ci：多指不触发长按
      pokePress = setTimeout(() => delPoke(), 550);
    });
    row.addEventListener('touchend', () => clearTimeout(pokePress));
    row.addEventListener('touchmove', () => clearTimeout(pokePress));
    row.addEventListener('touchcancel', () => clearTimeout(pokePress)); // 20261001ci
    scrollEl.appendChild(row);
    if (scroll) scrollToBottom();
    return;
  }

  const row = document.createElement('div');
  row.className = 'msg-row ' + (m.from === 'me' ? 'me' : 'them') + (multiSelectMode && !m.recalled ? ' ms-mode' : '');
  row.dataset.msgid = m.id;

  // 颜文字单行展示：先筛选——整条消息不含中文/字母/数字（只由符号、标点、emoji 组成）
  // 才判定为颜文字，此时一行展示完；普通文字消息恢复原来的自动换行
  const rawText = typeof m.content === 'string' ? m.content : '';
  const isOneLine = !m.recalled && isKaomojiText(rawText);
  if (isOneLine) row.classList.add('oneline-msg');

  const c = characters.find(x => x.id === m.charId);
  const body = msgBodyHtml(m, isOneLine);
  const checked = multiSelected.has(m.id);
  const checkHtml = (multiSelectMode && !m.recalled)
    ? `<div class="msg-check ${checked ? 'on' : ''}">${checked ? '✓' : ''}</div>` : '';
  if (m.recalled) {
    // 撤回消息：无气泡、无头像，仅一行句子
    row.innerHTML = body;
  } else if (m.from === 'me') {
    row.innerHTML = `${checkHtml}${avatarHtml(playerProfile.avatar, playerProfile.name)}<div class="msg-body">${body}<div class="msg-time">${msgTimeLabel(m.time)}</div></div>`;
  } else {
    row.innerHTML = `${avatarHtml(c && c.avatar, c && c.name)}<div class="msg-body">${body}<div class="msg-time">${msgTimeLabel(m.time)}</div></div>${checkHtml}`;
  }
  scrollEl.appendChild(row);

  // 事件：撤回消息点击查看原文 / 图片点击放大 / 右键或长按操作菜单
  const recalledEl = row.querySelector('.msg-recalled');
  if (recalledEl) {
    recalledEl.onclick = () => {
      openModal(`
        <div style="font-size:16px;font-weight:600;margin-bottom:12px;">被撤回的消息</div>
        <div style="background:var(--bg-elevated-2);border-radius:14px;padding:14px;font-size:15px;line-height:1.6;word-break:break-word;">${m.type === 'image' || m.type === 'emoji' ? `<img src="${imgSrc(m.content)}" style="max-width:100%;border-radius:10px;">` : escapeHtml(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))}</div>
        <button class="btn primary block" style="margin-top:14px;" id="recalled-close">关闭</button>
      `);
      $('#recalled-close').onclick = closeModal;
    };
  }
  const imgEl = row.querySelector('.msg-img');
  if (imgEl) {
    imgEl.onclick = () => {
      if (multiSelectMode) { toggleMultiSelect(m.id); return; }
      openModal(`<img src="${imgSrc(m.content)}" style="width:100%;border-radius:16px;"><button class="btn primary block" style="margin-top:12px;" id="imgview-close">关闭</button>`);
      $('#imgview-close').onclick = closeModal;
    };
  }

  // 查岗卡片「回复」按钮（角色发来的查岗，玩家可点击回复，回复会引用这条查岗）
  const checkinReply = row.querySelector('[data-checkin-reply]');
  if (checkinReply) {
    checkinReply.onclick = (ev) => {
      ev.stopPropagation();
      openCheckinReplyModal(m.charId, m);
    };
  }

  // 书信信封卡片：点开火漆印开信动画
  const letterEl = row.querySelector('[data-letter-card]');
  if (letterEl) {
    letterEl.onclick = (ev) => {
      ev.stopPropagation();
      openLetterOverlay(m);
    };
  }

  // 问卷卡片：点开查看题目与回答状态（20260929al）
  const surveyEl = row.querySelector('[data-survey-card]');
  if (surveyEl) {
    surveyEl.onclick = (ev) => {
      ev.stopPropagation();
      openSurveyDetail(m.content && m.content.surveyId);
    };
  }

  // 超频礼物卡片（20260929ap 重做）：未打开 → 播打开动画 → 紫色星际弹窗；已打开/我送的 → 直接弹窗
  const giftEl = row.querySelector('[data-gift-card]');
  if (giftEl) {
    giftEl.onclick = (ev) => {
      ev.stopPropagation();
      _ocHandleGiftCardClick(m);
    };
  }

  // 超频惊喜卡片（20260929ay）：点击重新弹出惊喜大字弹窗（打字机大字，点按任意处关闭）
  const surpriseEl = row.querySelector('[data-surprise-card]');
  if (surpriseEl) {
    surpriseEl.style.cursor = 'pointer';
    surpriseEl.onclick = (ev) => {
      ev.stopPropagation();
      _ocShowSurpriseBigText(m.content || {});
    };
  }

  // 转账卡片「领取 / 退回」按钮（角色发来的转账）
  const claimBtn = row.querySelector('[data-transfer-claim]');
  const returnBtn = row.querySelector('[data-transfer-return]');
  if (claimBtn) {
    claimBtn.onclick = async (ev) => {
      ev.stopPropagation();
      m.content.status = 'claimed';
      playerProfile.wallet += (m.content.amount || 0);
      await savePlayerProfile();
      await idbPut('messages', m);
      await renderMessages(m.charId);
      miniToast('已领取转账');
    };
  }
  if (returnBtn) {
    returnBtn.onclick = async (ev) => {
      ev.stopPropagation();
      m.content.status = 'returned';
      const c = characters.find(x => x.id === m.charId);
      if (c) { c.wallet = (c.wallet ?? 100000) + (m.content.amount || 0); await saveChar(c); }
      await idbPut('messages', m);
      await renderMessages(m.charId);
      miniToast('已退回转账');
    };
  }

  if (!m.recalled) {
    // 多选模式下点击消息 = 勾选
    if (multiSelectMode) {
      row.onclick = (ev) => {
        if (ev.target.classList.contains('msg-img')) return;
        toggleMultiSelect(m.id);
      };
    } else {
      // 右键 / 长按 → 操作菜单（引用/删除/转发/多选/撤回）
      let pressTimer = null;
      const openMenu = (x, y) => showMsgMenu(m, x, y);
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY); });
      const bodyEl = row.querySelector('.msg-body') || row;
      bodyEl.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) return; // 20261001ci：多指（三指截屏等）不触发长按
        const t = e.touches[0];
        pressTimer = setTimeout(() => openMenu(t.clientX, t.clientY), 550);
      });
      bodyEl.addEventListener('touchend', () => clearTimeout(pressTimer));
      bodyEl.addEventListener('touchmove', () => clearTimeout(pressTimer));
      bodyEl.addEventListener('touchcancel', () => clearTimeout(pressTimer)); // 20261001ci：系统手势接管时取消长按
    }
  }

  if (scroll) scrollToBottom();
}

/* ---------- 气泡操作菜单（引用 / 删除 / 转发 / 多选 / 撤回） ---------- */
function closeCtxMenu() {
  const el = $('#ctx-menu');
  if (el) { el.classList.remove('show'); el.innerHTML = ''; }
}
document.addEventListener('click', (e) => {
  const menu = $('#ctx-menu');
  if (menu && menu.classList.contains('show') && !menu.contains(e.target)) closeCtxMenu();
});
window.addEventListener('resize', closeCtxMenu);
window.addEventListener('scroll', closeCtxMenu, true);

function showMsgMenu(m, x, y) {
  if (bmMultiTouchRecent()) return; // 20261001ci：三指截屏等多指手势后 1.2 秒内不弹菜单
  const menu = $('#ctx-menu');
  const items = [];
  items.push({ icon: 'quote', label: '引用该条消息', act: () => startQuote(m) });
  items.push({ icon: 'forward', label: '转发该条消息', act: () => showForwardModal(m) });
  // 记忆宫殿（20260929w 全量落地：以这条消息为基准点，前后各截 50 条存入访客文件夹）
  items.push({ icon: 'memory', label: '存入记忆宫殿', act: () => palCaptureMenu(m) });
  items.push({ icon: 'checklist', label: '多选', act: () => enterMultiSelect(m.id) });
  if (m.from === 'me' && (m.type === 'text' || m.type === 'emoji') && chatSettings.allowRecall) {
    // 5.3：只有单纯的字卡消息和表情包可以撤回
    items.push({ icon: 'back', label: '撤回', act: () => recallMessage(m) });
  }
  items.push({ icon: 'trash', label: '删除该条消息', danger: true, act: () => {
    showConfirm('确定删除这条消息吗？此操作无法撤销。', async () => {
      await idbDelete('messages', m.id);
      await renderMessages(m.charId);
    });
  } });

  menu.innerHTML = items.map((it, i) => `
    <button class="ctx-item ${it.danger ? 'danger' : ''}" data-ctx="${i}">
      <span class="ctx-ic">${icon(it.icon, 16)}</span><span>${it.label}</span>
    </button>
  `).join('');
  menu.classList.add('show');

  // 定位（防止溢出屏幕）
  const mw = 190, mh = items.length * 40 + 12;
  const px = Math.min(x, window.innerWidth - mw - 8);
  const py = Math.min(y, window.innerHeight - mh - 8);
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';

  menu.querySelectorAll('[data-ctx]').forEach(el => {
    el.onclick = () => { closeCtxMenu(); items[parseInt(el.dataset.ctx)].act(); };
  });
}

/* ---------- 群聊气泡操作菜单（20260929bd：引用 / 转发 / 撤回 / 删除）----------
   与单聊 showMsgMenu 同款交互；撤回/删除后按群聊视图重绘（不能走 renderMessages） */
function showGroupMsgMenu(g, m, x, y) {
  const menu = $('#ctx-menu');
  const items = [];
  items.push({ icon: 'quote', label: '引用该条消息', act: () => startQuote(m) });
  items.push({ icon: 'forward', label: '转发该条消息', act: () => showForwardModal(m) });
  if (m.from === 'me' && (m.type === 'text' || m.type === 'emoji') && chatSettings.allowRecall) {
    items.push({ icon: 'back', label: '撤回', act: async () => {
      m.recalled = true;
      m.recallTime = Date.now();
      await idbPut('messages', m);
      if (currentGroupId === m.groupId) await renderGroupMessages(m.groupId);
      else renderChatList();
    } });
  }
  items.push({ icon: 'trash', label: '删除该条消息', danger: true, act: () => {
    showConfirm('确定删除这条消息吗？此操作无法撤销。', async () => {
      await idbDelete('messages', m.id);
      if (currentGroupId === m.groupId) await renderGroupMessages(m.groupId);
      else renderChatList();
    });
  } });
  menu.innerHTML = items.map((it, i) => `
    <button class="ctx-item ${it.danger ? 'danger' : ''}" data-ctx="${i}">
      <span class="ctx-ic">${icon(it.icon, 16)}</span><span>${it.label}</span>
    </button>
  `).join('');
  menu.classList.add('show');
  // 定位（防止溢出屏幕）
  const mw = 190, mh = items.length * 40 + 12;
  const px = Math.min(x, window.innerWidth - mw - 8);
  const py = Math.min(y, window.innerHeight - mh - 8);
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  menu.querySelectorAll('[data-ctx]').forEach(el => {
    el.onclick = () => { closeCtxMenu(); items[parseInt(el.dataset.ctx)].act(); };
  });
}

/* 引用：输入框上方出现引用条 */
function startQuote(m) {
  pendingQuote = { msgId: m.id, name: m.from === 'me' ? (playerProfile.name || '我') : (characters.find(x => x.id === m.charId)?.name || '对方'), content: m.content };
  let bar = $('#quote-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'quote-bar';
    // 插入到输入栏之前
    const inputBar = document.querySelector('.chat-input-bar');
    inputBar.parentNode.insertBefore(bar, inputBar);
  }
  const brief = typeof m.content === 'string' ? (m.content.length > 30 ? m.content.slice(0, 30) + '…' : m.content) : '[卡片消息]';
  bar.innerHTML = `
    <div style="flex:1;min-width:0;">
      <div style="font-size:12px;color:var(--purple-soft);">引用 ${escapeHtml(pendingQuote.name)}</div>
      <div style="font-size:12px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(brief)}</div>
    </div>
    <button class="icon-btn" style="width:26px;height:26px;" id="quote-cancel">${icon('close', 14)}</button>
  `;
  bar.classList.add('show');
  $('#quote-cancel').onclick = cancelQuote;
  $('#chat-input').focus();
}
function cancelQuote() {
  pendingQuote = null;
  const bar = $('#quote-bar');
  if (bar) bar.remove();
}

/* 转发：选择一个角色，把消息副本发过去 */
function showForwardModal(m) {
  if (characters.length === 0) { miniToast('还没有其他访客'); return; }
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">转发给</div>
      <button class="icon-btn" id="fw-close">${icon('close', 18)}</button>
    </div>
    ${characters.map(c => `
      <div class="fw-item" data-cid="${c.id}" style="display:flex;align-items:center;gap:12px;padding:10px 6px;border-bottom:1px solid var(--border);cursor:pointer;border-radius:10px;">
        <div class="avatar sm">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
        <div style="flex:1;font-size:15px;font-weight:600;">${escapeHtml(c.name)}</div>
        <span style="color:var(--text-tertiary);">›</span>
      </div>
    `).join('')}
  `);
  $('#fw-close').onclick = closeModal;
  document.querySelectorAll('.fw-item').forEach(el => {
    el.onclick = async () => {
      const cid = el.dataset.cid;
      closeModal();
      const copy = { id: uid('msg'), charId: cid, from: 'me', type: m.type, content: m.content, time: Date.now() };
      await idbPut('messages', copy);
      if (currentCharId === cid) appendMessage(copy);
      miniToast('已转发');
      await scheduleCharReply(cid);
    };
  });
}

/* 撤回自己的字卡/表情包（5.3） */
async function recallMessage(m) {
  m.recalled = true;
  m.recallTime = Date.now();
  await idbPut('messages', m);
  await renderMessages(m.charId);
}

/* ---------- 多选模式（批量删除消息） ---------- */
function enterMultiSelect(firstId) {
  multiSelectMode = true;
  multiSelected = new Set([firstId]);
  // 就地标记所有消息为多选态，不重渲染（保持滚动位置）
  document.querySelectorAll('#chat-scroll .msg-row').forEach(row => {
    const mid = row.dataset.msgid;
    if (!mid) return;
    if (row.querySelector('.msg-recalled')) return; // 撤回消息不参与多选
    row.classList.add('ms-mode');
    const check = row.querySelector('.msg-check') || (() => {
      const d = document.createElement('div');
      d.className = 'msg-check';
      // 我方消息勾选框放最左，对方放最右
      if (row.classList.contains('me')) row.prepend(d); else row.appendChild(d);
      return d;
    })();
    row.dataset.checked = multiSelected.has(mid) ? '1' : '0';
    check.classList.toggle('on', multiSelected.has(mid));
    check.textContent = multiSelected.has(mid) ? '✓' : '';
    row.onclick = (ev) => { if (ev.target.closest('.msg-img')) return; toggleMultiSelect(mid); };
  });
  showMultiBar();
}
function toggleMultiSelect(msgId) {
  if (multiSelected.has(msgId)) multiSelected.delete(msgId);
  else multiSelected.add(msgId);
  // 就地更新该行勾选态 + 计数，不重渲染
  const row = document.querySelector(`#chat-scroll .msg-row[data-msgid="${msgId}"]`);
  if (row) {
    const on = multiSelected.has(msgId);
    const check = row.querySelector('.msg-check');
    if (check) { check.classList.toggle('on', on); check.textContent = on ? '✓' : ''; }
  }
  const countEl = $('#multi-count');
  if (countEl) countEl.textContent = multiSelected.size;
}
function showMultiBar() {
  closeMultiBar();
  const bar = document.createElement('div');
  bar.id = 'multi-bar';
  document.querySelector('.chat-input-bar').parentNode.insertBefore(bar, document.querySelector('.chat-input-bar'));
  bar.innerHTML = `
    <div style="flex:1;font-size:13px;color:var(--text-secondary);">已选 <b id="multi-count">${multiSelected.size}</b> 条消息</div>
    <button class="btn" style="padding:7px 14px;font-size:13px;" id="multi-palace">${icon('memory', 14)} 存宫殿</button>
    <button class="btn danger" style="padding:7px 14px;font-size:13px;" id="multi-del">${icon('trash', 14)} 删除</button>
    <button class="btn" style="padding:7px 14px;font-size:13px;" id="multi-cancel">取消</button>
  `;
  $('#multi-cancel').onclick = exitMultiSelect;
  // 批量存入记忆宫殿（细则：玩家批量选择上限 101 条）
  $('#multi-palace').onclick = () => {
    if (multiSelected.size === 0) { miniToast('请先勾选消息'); return; }
    if (multiSelected.size > 101) { miniToast('一次最多存 101 条（满分多一点，溢出爱意）'); return; }
    palCaptureBatch([...multiSelected]);
  };
  $('#multi-del').onclick = () => {
    if (multiSelected.size === 0) { miniToast('请先勾选消息'); return; }
    showConfirm(`确定删除选中的 ${multiSelected.size} 条消息吗？此操作无法撤销。`, async () => {
      for (const id of multiSelected) await idbDelete('messages', id);
      exitMultiSelect();
      await renderMessages(currentCharId);
    });
  };
}
function closeMultiBar() {
  const bar = $('#multi-bar');
  if (bar) bar.remove();
}
function exitMultiSelect() {
  multiSelectMode = false;
  multiSelected = new Set();
  closeMultiBar();
  renderMessages(currentCharId);
}

function scrollToBottom() {
  const scroll = $('#chat-scroll');
  scroll.scrollTop = scroll.scrollHeight;
}

/* ---------- 发送消息 + 字卡回复逻辑 ---------- */
async function sendMessage(text) {
  // 群聊走群聊发送
  if (currentGroupId) {
    await sendGroupMessage(text);
    return;
  }
  if (!currentCharId) return;
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return;

  // 开发者模式命令为专用命令，不保存到聊天，也不触发普通回复。
  if (chatSettings.developerMode) {
    const command = parseDeveloperCommand(trimmed);
    if (command) {
      $('#chat-input').value = '';
      await executeDeveloperCommand(command);
      return;
    }
  }
  // 1. 玩家消息立即上屏
  const myMsg = { id: uid('msg'), charId: currentCharId, from: 'me', type: 'text', content: trimmed, time: Date.now() };
  if (pendingQuote) { myMsg.quote = pendingQuote; cancelQuote(); }
  await idbPut('messages', myMsg);
  appendMessage(myMsg);
  $('#chat-input').value = '';
  palAutoCollectMaybe(currentCharId, null); // 记忆宫殿：系统随机收藏（每线程每天至多 1 次，细则四）

  // 角色回复
  await scheduleCharReply(currentCharId);
}

function parseDeveloperCommand(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  // 动作关键词（正则可无目标：不写角色名时默认当前访客）
  const actions = [
    // 朋友圈：让[名]发朋友圈 / 发朋友圈 / 发一条朋友圈动态
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:发|发布)(?:一条)?朋友圈(?:动态)?$/u, 'moment'],
    [/^(?:发|发布)(?:一条)?朋友圈(?:动态)?$/u, 'moment'],
    // 表情包：让[名]发个表情包 / 发个表情包 / 发表情
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:发|发送)(?:一张|一个|个)?(?:表情包|表情)$/u, 'emoji'],
    [/^(?:发|发送)(?:一张|一个|个)?(?:表情包|表情)$/u, 'emoji'],
    // 戳一戳：让[名]戳我 / 戳一戳 / 戳戳 / 戳我
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:发个|发|来个)?(?:戳一戳|戳戳|戳我)$/u, 'poke'],
    [/^(?:发个|发|来个)?(?:戳一戳|戳戳|戳我)$/u, 'poke'],
    // 查岗：让[名]发查岗 / 查岗 / 突击查岗
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:发|来)(?:一个|一次)?(?:突击)?查岗$/u, 'checkin'],
    [/^(?:发|来)(?:一个|一次)?(?:突击)?查岗$/u, 'checkin'],
    [/^(?:突击)?查岗$/u, 'checkin'],
    // 超频：让[名]触发超频 / 触发超频 / 超频礼物 / 超频惊喜
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:触发|发送|送)(?:一次)?超频(?:礼物|惊喜)?$/u, 'overclock'],
    [/^(?:触发|发送|送)(?:一次)?超频(?:礼物|惊喜)?$/u, 'overclock'],
    [/^超频(?:礼物|惊喜)?$/u, 'overclock'],
    // 视频通话：让[名]打视频通话 / 打视频通话 / 视频通话
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:打|发起|拨)(?:一个|一次)?视频(?:通话|电话)?$/u, 'video'],
    [/^(?:打|发起|拨)(?:一个|一次)?视频(?:通话|电话)?$/u, 'video'],
    [/^视频(?:通话|电话)$/u, 'video'],
    // 发红包/转账：让[名]发红包 / 发红包
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:发|送)(?:一个|一次|个)?(?:红包|转账)$/u, 'redpacket'],
    [/^(?:发|送)(?:一个|一次|个)?(?:红包|转账)$/u, 'redpacket'],
    [/^红包$/u, 'redpacket'],
    // 书信：让[名]写信 / 写信 / 来信
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:写|发|寄)(?:一封|封|来)?(?:信|书信)$/u, 'letter'],
    [/^(?:写|发|寄)(?:一封|封|来)?(?:信|书信)$/u, 'letter'],
    [/^书信$/u, 'letter'],
    // 问卷：让[名]发问卷 / 发问卷
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:发|送)(?:一份|份|个)?(?:问卷|调查)$/u, 'survey'],
    [/^(?:发|送)(?:一份|份|个)?(?:问卷|调查)$/u, 'survey'],
    [/^问卷$/u, 'survey'],
    // 惊喜（20260929ax）：直接输入「惊喜」立即触发惊喜动画，跳过一切解锁规则（绝对命令）
    [/^(?:让|叫|命令)?(.+?)(?:给我)?(?:发|来|触发)(?:一个|一次|个)?惊喜$/u, 'surprise'],
    [/^(?:发|来|触发)(?:一个|一次|个)?惊喜$/u, 'surprise'],
    [/^惊喜$/u, 'surprise'],
    // warning：触发超频首次解锁动画（故障→裂隙→项链，20260929at；全局命令，无需目标访客）
    [/^(?:触发|发送|来|发)(?:一次)?warning$/iu, 'warning'],
    [/^(?:让|叫|命令)(?:当前访客|访客|TA|ta|角色|他|她)?(?:给我)?(?:触发|发送|来)?(?:一次)?warning$/iu, 'warning'],
    [/^warning$/iu, 'warning'],
  ];
  for (const [re, action] of actions) {
    const m = s.match(re);
    if (!m) continue;
    const target = (m[1] || '').trim();
    // 未写目标，或目标是「我/玩家/你/角色/访客/他/她/TA」→ 当前访客
    if (!target || /^(?:我|玩家|你|角色|访客|他|她|TA|ta|当前访客)$/u.test(target)) return { action, target: '当前访客', raw: s };
    // 写了目标名：需命中某个访客名字才生效（否则视为普通消息，不拦截）
    if (characters.some(c => c.name === target || c.name.includes(target))) return { action, target, raw: s };
    return null;
  }
  return null;
}

function _devResolveChar(target) {
  const t = String(target || '').replace(/^(?:让|叫|命令)/u, '').trim();
  if (!t || /^(?:角色|访客|他|她|TA|ta|当前访客)$/u.test(t)) return characters.find(c => c.id === currentCharId) || null;
  return characters.find(c => c.name === t || c.name.includes(t)) || null;
}

async function _devCommandMoment(c) {
  const content = drawReply(cards, getCharBanWords(c), c.relation || null, c.bannedGroups || [])
    || drawFrom(cards.customMottos || []) || '今天也想记录一下生活。';
  const post = { id:uid('mo'), authorType:'char', authorId:c.id, content, images:[], visibility:{type:'all',ids:[]}, likes:[], comments:[], createTime:Date.now(), pending:[], authorReplies:[] };
  const st = await drawMomentSticker();
  if (st) { if (st.img) post.images.push(st.img); else post.sticker = st.sticker; }
  schedulePostInteractions(post);
  const posts = await loadMomentPosts(); posts.unshift(post); await saveMomentPosts(posts);
  if (document.body.dataset.view === 'moments') renderMoments();
}

async function _devCommandEmoji(c, raw) {
  const imgs = await getEmojis();
  const img = imgs && imgs.length ? drawFrom(imgs) : null;
  let content = img ? (img.img || img.data) : '';
  if (!content) content = drawFrom(cards.customEmojis || []) || drawFrom(EMOJI_LIB) || '✨';
  const m = { id:uid('msg'), charId:c.id, from:'them', type: typeof content === 'string' && content.startsWith('data:') ? 'emoji' : 'text', content, time:Date.now() };
  await idbPut('messages',m);
  if (currentCharId === c.id && document.body.dataset.view === 'chat') appendMessage(m); else renderChatList();
}

/* 开发者密码校验（20260929av）：代码只存 djb2-32/base36 哈希，不落明文——
   防止普通用户在源码里直接看穿密码；本地校验时对输入算哈希后比对。
   更换密码：node -e "let h=5381;for(const c of '新密码'){h=(((h<<5)+h)+c.charCodeAt(0))>>>0}console.log(h.toString(36))" → 替换 DEV_PWD_HASH */
function _devPwdHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const DEV_PWD_HASH = 'qbnrxg';          // 开发者密码哈希
const DEV_PWD_LEN = 11;                 // 密码长度（降低短输入碰撞误判）

async function executeDeveloperCommand(command) {
  if (!chatSettings.developerMode) return false;
  // warning：全局命令（无需目标访客）——强制重放超频首次解锁完整动画（故障→裂隙→项链→解锁）
  if (command.action === 'warning') {
    try {
      // 20260929av：绝对命令——已解锁也强制重放（开发者测试用，不再拦截）
      _ocIntroRunning = false;
      miniToast('开发者模式：重放超频首次动画…');
      await maybeTriggerOverclockIntro(true);
    } catch (e) { console.error('[开发者模式 warning]', e); miniToast('开发者命令执行失败'); }
    return true;
  }
  const c = _devResolveChar(command.target);
  if (!c) { miniToast('开发者模式：找不到指定访客'); return true; }
  try {
    if (command.action === 'moment') await _devCommandMoment(c);
    else if (command.action === 'emoji') await _devCommandEmoji(c, command.raw);
    else if (command.action === 'poke') await sendCharPoke(c);
    else if (command.action === 'checkin') await deliverCharMessage(c, '突击查岗！你现在在做什么？', 'checkin', { text:'突击查岗！你现在在做什么？', replies:[] });
    else if (command.action === 'overclock') {
      // 20260929au：开发者命令为绝对命令，绕过超频解锁/惊喜解锁限制，直接触发
      const wantSurprise = /惊喜/u.test(command.raw);
      if (wantSurprise) await _ocCharSendSurprise(c);
      else await _ocCharSendGift(c);
    } else if (command.action === 'surprise') {
      // 20260929ay/bb：「惊喜」= 完整复现「最初触发动画」——三问号跳出（漩涡滚动）
      // → 好像掉出了什么奇怪的东西 → 交由系统检测 → 大字卡片（最上行「你收到了一条消息」）
      // → 落库+轻送达（绝对命令，无视已解锁状态）
      await _ocCharSendSurprise(c, { forceFirst: true });
    } else if (command.action === 'video') {
      if (_callActive) { miniToast('当前已有通话进行中'); return true; }
      await triggerIncomingCall(c, 'video');
    } else if (command.action === 'redpacket') {
      // 发红包：角色向玩家转账（char_to_me，待领取）；绝对命令无视钱包余额
      await deliverCharTransfer(c, { force: true });
    } else if (command.action === 'letter') {
      await charSendLetter(c, {});
    } else if (command.action === 'survey') {
      await charAskPlayer(c);
    }
    miniToast(`开发者模式：已执行「${command.action}」`);
  } catch (e) { console.error('[开发者模式命令]', e); miniToast('开发者命令执行失败'); }
  return true;
}

/* 角色延迟回复（5.4：按每条消息计算）
   replyQuote：显式引用（查岗回复时引用查岗卡片）。
   无显式引用时，角色有概率（约 22%）随机引用玩家最近一条消息（5：角色会引用玩家的每句话）。 */
function scheduleCharReply(charId, replyQuote = null, opts = {}) {
  const c = characters.find(x => x.id === charId);
  const cs = getCharChatSettings(c);
  const inThisChat = currentCharId === charId && document.body.dataset.view === 'chat';
  const burstStart = Date.now(); // 20260929bf：本轮回复起点——之后玩家再发消息视为「打断」

  // 2. 显示打字中（带头像）——只在当前正打开这个角色的聊天页时显示
  if (inThisChat) {
    const typing = document.createElement('div');
    typing.className = 'msg-row them';
    typing.innerHTML = `${avatarHtml(c && c.avatar, c && c.name)}<div class="msg-body"><div class="bubble typing"><span></span><span></span><span></span></div></div>`;
    typing.id = 'typing-indicator-' + charId; // 20260929z：按角色命名——并发两条回复时互不误删（此前固定 id，第一条落地会把第二条的"正在输入"动画提前删掉）
    $('#chat-scroll').appendChild(typing);
    scrollToBottom();
    // 「正在输入中」只出现在签名位置（昵称下方），右侧状态保持时段状态
    setChatHeaderStatus('', true);
  }

  // 3. 计算延迟（回复节奏，访客级设置优先）；opts.quick = 查岗应答等需要"及时反馈"的场景，固定 2~4 秒
  const delay = (opts.quick ? randInt(2, 4) : randInt(cs.minDelay, cs.maxDelay)) * 1000;

  // 4. 延迟后回复字卡（访客禁词 + 全局字卡禁词过滤 + 关系语气倾向）
  return new Promise((resolve) => {
    setTimeout(async () => {
      // 20260929ai：执行体包进 deliverReply——任何意外错误都不允许"静默不回复"，
      // catch 里强制回退发一条字卡（字卡模式/AI 模式都兜底）
      const deliverReply = async () => {
      const t = document.getElementById('typing-indicator-' + charId);
      if (t) t.remove();
      if (inThisChat) restoreChatHeaderStatus();

      // 无显式引用时：随机引用玩家最近一条消息
      let finalQuote = replyQuote;
      if (!finalQuote) {
        const msgs = await idbGetMessagesByChar(charId, 50);
        // 只在单聊消息里找引用对象（群聊消息不串进单聊，20260925 数据乱串修复）
        const lastMe = [...msgs].reverse().find(mm => mm.from === 'me' && mm.type === 'text' && !mm.groupId);
        if (lastMe && Math.random() < 0.22) {
          finalQuote = { name: playerProfile.name || '我', content: lastMe.content };
        }
      }

      const curChar = characters.find(x => x.id === charId);
      const banWords = curChar ? getCharBanWords(curChar) : [];
      const relation = curChar ? (curChar.relation || null) : null;
      const bannedGroups = curChar ? (curChar.bannedGroups || []) : []; // 角色勾选禁用的字卡分组
      // 20260929ae：AI 模式分流（AI 生成 / 失败自动回退字卡；字卡模式走原逻辑）
      // 20260929bf：AI 模式也随机 1~3 条——先抽条数，再让 AI 按条数分行输出
      const gen = await generateCharReply(charId, { quote: finalQuote, count: randInt(1, 3) });
      // 20260929ah：随机 1~3 条回复——字卡模式按概率连发（此前只有单条，规则缺失），
      // AI 模式按 AI 输出分段拆条（最多 3 条），像真人连续发消息
      const parts = splitReplyParts(gen, curChar);
      let lastMsg = null;
      for (let i = 0; i < parts.length; i++) {
        // 20260929bf：玩家中途插话 → 剩余几条攒住不发（首条照常落地；插话的新消息会正常触发下一轮回复）
        if (i > 0) {
          const recent = await idbGetMessagesByChar(charId, 10);
          if (recent && recent.some(mm => mm && mm.from === 'me' && mm.type === 'text' && !mm.groupId && mm.time >= burstStart)) break;
        }
        const replyMsg = { id: uid('msg'), charId, from: 'them', type: 'text', content: parts[i], time: Date.now() };
        if (i === 0 && finalQuote) replyMsg.quote = finalQuote;
        await idbPut('messages', replyMsg);
        if (currentCharId === charId) appendMessage(replyMsg);
        lastMsg = replyMsg;
        // 后续条目间隔 1.2~3.5 秒连续发出；引用只带在第一条上
        if (i < parts.length - 1) await new Promise(r => setTimeout(r, randInt(1200, 3500)));
      }
      // 提示音：聊天页内仅当前角色响；不在聊天页且未关闭该访客提示音才响（20260930 统一 shouldDingFor）
      if (shouldDingFor(curChar)) playDing();
      notifyIncoming(curChar, lastMsg ? lastMsg.content : parts[0]); // 20260929bi：后台系统通知
      // 角色概率撤回（5.3：撤回后仍可查看；只对最后一条生效，避免连环撤回刷屏）
      if (lastMsg && cs.allowRecall && Math.random() < 0.12) {
        setTimeout(async () => {
          lastMsg.recalled = true;
          await idbPut('messages', lastMsg);
          if (currentCharId === charId) await renderMessages(charId);
        }, 1500 + Math.random() * 2500);
      }
      // 访客随机戳一戳（发消息时按聊天设置概率附带，聊页中间独立展示）
      if (lastMsg && !lastMsg.recalled) maybeCharPoke(curChar);
      // 20260929ah：回复后小概率追加表情包/emoji（AI 与字卡模式都生效）
      if (curChar) maybeAttachSticker(curChar);
      resolve(lastMsg);
      };
      try {
        await deliverReply();
      } catch (eReply) {
        console.warn('[聊天] 回复执行出错，已强制回退字卡：', eReply && (eReply.message || eReply));
        try {
          const t2 = document.getElementById('typing-indicator-' + charId);
          if (t2) t2.remove();
          const cc = characters.find(x => x.id === charId);
          const fb = drawReply(cards, cc ? getCharBanWords(cc) : [], cc ? (cc.relation || null) : null, cc ? (cc.bannedGroups || []) : []);
          const fbMsg = { id: uid('msg'), charId, from: 'them', type: 'text', content: fb, time: Date.now() };
          await idbPut('messages', fbMsg);
          if (currentCharId === charId && document.body.dataset.view === 'chat') appendMessage(fbMsg);
          else renderChatList();
          resolve(fbMsg);
        } catch (e2) { resolve(null); }
      }
    }, delay);
  });
}

/* 20260929ah：把一次回复拆成 1~3 条消息。
   · 字卡模式：55% 1 条 / 30% 2 条 / 15% 3 条，每条独立抽字卡（内容完全一致时重抽，最多 3 次）
   · AI 模式：按 AI 输出的换行分段拆条（最多 3 条，多余段落并回最后一条） */
function splitReplyParts(gen, c) {
  if (gen.type === 'ai') {
    const segs = String(gen.text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (segs.length <= 1) return [gen.text];
    if (segs.length <= 3) return segs;
    return [segs[0], segs[1], segs.slice(2).join('\n')];
  }
  const r = Math.random();
  const n = r < 0.55 ? 1 : (r < 0.85 ? 2 : 3);
  const parts = [gen.text];
  const banWords = c ? getCharBanWords(c) : [];
  const relation = c ? (c.relation || null) : null;
  const bannedGroups = c ? (c.bannedGroups || []) : [];
  let tries = 0;
  while (parts.length < n && tries < 3) {
    tries++;
    const t = drawReply(cards, banWords, relation, bannedGroups);
    if (!parts.includes(t)) parts.push(t);
  }
  return parts;
}

/* 20260929ah：回复落地后小概率（12%）追加一条表情包/emoji 消息。
   玩家上传的表情包库优先（60%），否则从 Emoji 库抽一个字符当短消息。 */
async function maybeAttachSticker(c) {
  try {
    if (!c || Math.random() > 0.12) return;
    let img = '';
    try {
      const pics = await getEmojis();
      if (pics && pics.length && Math.random() < 0.6) img = (drawFrom(pics).img) || '';
    } catch (e) {}
    const m = img
      ? { id: uid('msg'), charId: c.id, from: 'them', type: 'emoji', content: img, time: Date.now() }
      : { id: uid('msg'), charId: c.id, from: 'them', type: 'text', content: drawFrom(EMOJI_LIB) || '🌙', time: Date.now() };
    await idbPut('messages', m);
    if (currentCharId === c.id && document.body.dataset.view === 'chat') appendMessage(m);
    else renderChatList();
  } catch (e) {}
}

/* ---------- 聊天页顶部状态（7：按时段抽状态 + 正在输入中） ---------- */
let _statusTimer = null;
/* 六个时间段（7：凌晨/上午/中午/下午/傍晚/深夜各抽一次状态，边界按需求文档 10.6） */
function statusPeriod() {
  const h = new Date().getHours();
  if (h >= 0 && h < 6) return '凌晨';    // 0点~6点
  if (h >= 6 && h < 11) return '上午';   // 6点~11点
  if (h >= 11 && h < 14) return '中午';  // 11点~14点
  if (h >= 14 && h < 17) return '下午';  // 14点~17点
  if (h >= 17 && h < 20) return '傍晚';  // 17点~20点
  return '深夜';                          // 20点之后
}
/* 状态抽取池：顶层状态字卡 + 未禁用的状态分组（与回复字卡同规则——
   只用顶层会漏掉分组里的状态字卡，表现为"状态一直不变/总是在线"） */
function statusPool() {
  const base = (cards.customStatuses && cards.customStatuses.length) ? cards.customStatuses.slice() : [];
  (cards.customStatusGroups || []).forEach(g => {
    if (g && !g.disabled) (g.items || []).forEach(t => { if (t) base.push(t); });
  });
  return base.length ? base : ['在线'];
}
/* 取角色当前时段的状态（同一时段内固定，跨时段/跨天重新抽；重抽时避开上一条，
   让"到点换状态"肉眼可感知） */
function getCharPeriodStatus(c) {
  const period = statusPeriod();
  const day = todayKey();
  if (!c.statusCache || c.statusCache.period !== period || c.statusCache.day !== day) {
    const pool = statusPool();
    let text = drawFrom(pool);
    if (c.statusCache && c.statusCache.text && pool.length > 1) {
      const others = pool.filter(t => t !== c.statusCache.text);
      if (others.length) text = drawFrom(others);
    }
    c.statusCache = { period, day, text };
    idbPut('characters', c);
  }
  return `${c.statusCache.text} · ${period}`;
}
/* 设置聊天页顶部签名（昵称下方，7/11） */
function setChatHeaderSign(c) {
  const el = $('#chat-sign');
  if (!el) return;
  el.textContent = c ? ensureCharSign(c) : '';
}
/* 写入聊天页顶部状态文字（昵称右边，7/11）。
   正在输入中：只显示在昵称下方（签名位置），右侧状态保持时段状态不变 */
function setChatHeaderStatus(text, isTyping = false) {
  const el = $('#chat-status');
  if (!el) return;
  const signEl = $('#chat-sign');
  if (isTyping) {
    el.dataset.typing = '1';
    if (signEl) {
      signEl.textContent = '正在输入中…';
      signEl.style.color = 'var(--text-secondary)';
      signEl.style.fontStyle = 'italic';
    }
    return;
  }
  el.dataset.typing = '';
  el.textContent = text;
  if (signEl) {
    const c = currentCharId ? characters.find(x => x.id === currentCharId) : null;
    signEl.textContent = c ? ensureCharSign(c) : '';
    signEl.style.color = '';
    signEl.style.fontStyle = '';
  }
}
/* 恢复为角色按时段抽到的状态 + 签名 */
function restoreChatHeaderStatus() {
  const c = currentCharId ? characters.find(x => x.id === currentCharId) : null;
  if (!c) return;
  setChatHeaderStatus(getCharPeriodStatus(c));
  setChatHeaderSign(c);
}
/* 每分钟校准一次状态（跨时段自动换） */
function startStatusTimer() {
  if (_statusTimer) clearInterval(_statusTimer);
  _statusTimer = setInterval(() => {
    if (document.body.dataset.view === 'chat' && currentCharId && !$('#chat-status').dataset.typing) {
      restoreChatHeaderStatus();
    }
  }, 60000);
}

/* 过零点自动刷新（8：聊天天数 +1、纪念日提示、状态跨天；同时补弹当天入梦签） */
let _lastDayKey = null;
function startDayRolloverTimer() {
  _lastDayKey = todayKey();
  setInterval(() => {
    const key = todayKey();
    if (key !== _lastDayKey) {
      _lastDayKey = key;
      // 跨天：刷新个人主页（聊天天数、纪念日提示）；聊天页状态跨天也重抽
      renderPlayerHome();
      if (document.body.dataset.view === 'chat' && currentCharId) restoreChatHeaderStatus();
      renderChatList();
      // 页面开着跨过 0 点：当天入梦签在此刻补弹（无需玩家重新打开应用）
      try { showDailyCard().catch(() => {}); } catch (e) {}
    }
  }, 30000);
}

/* 发送图片消息（5.9：压缩后存本地；20260929g 存 Blob+缩略图描述符） */
async function sendImageMessage(file) {
  if (!file) return;
  const img = await compressImage(file, 1080, 0.7);
  if (currentGroupId) {
    const myMsg = { id: uid('msg'), groupId: currentGroupId, from: 'me', type: 'image', content: img, time: Date.now() };
    await idbPut('messages', myMsg);
    appendGroupMessage(myMsg);
    return;
  }
  if (!currentCharId) return;
  const myMsg = { id: uid('msg'), charId: currentCharId, from: 'me', type: 'image', content: img, time: Date.now() };
  await idbPut('messages', myMsg);
  appendMessage(myMsg);
  await scheduleCharReply(currentCharId);
}

/* 图片压缩（21：图片上传默认压缩，越小越好）
   支持保留透明（PNG）与错误兜底；mime 可指定，表情包用 png 保留透明
   20260929g：图片存储 base64 → Blob + 缩略图 ——
   返回 { blob 主图, thumb 缩略图(≤320px；小图自身够小不生成), w, h }；
   压缩失败兜底仍返回 data URL 字符串；旧数据（字符串）由显示层 imgSrc() 统一兼容 */
function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片编码失败')), mime, quality);
  });
}

function compressImage(file, maxEdge = 1080, quality = 0.7, keepAlpha = false) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.onload = async () => {
        try {
          let { width, height } = img;
          if (Math.max(width, height) > maxEdge) {
            const r = maxEdge / Math.max(width, height);
            width = Math.round(width * r);
            height = Math.round(height * r);
          }
          const mime = keepAlpha ? 'image/png' : 'image/jpeg';
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const blob = await canvasToBlob(canvas, mime, quality);
          // 缩略图：仅主图较大时生成（表情包 240px 等小图直接用主图，避免放大失真）
          let thumb = null;
          if (Math.max(width, height) > 360) {
            const tr = 320 / Math.max(width, height);
            const tw = Math.max(1, Math.round(width * tr));
            const th = Math.max(1, Math.round(height * tr));
            const tc = document.createElement('canvas');
            tc.width = tw;
            tc.height = th;
            tc.getContext('2d').drawImage(img, 0, 0, tw, th);
            thumb = await canvasToBlob(tc, keepAlpha ? 'image/png' : 'image/jpeg', 0.72);
          }
          resolve({ blob, thumb, w: width, h: height });
        } catch (e) {
          // 兜底：压缩失败则直接用原图 dataUrl（保证能看）
          resolve(reader.result);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* 显示层统一取图 URL（20260929g）：
   - 字符串（旧 base64 数据 / 兜底结果）→ 原样返回，旧数据一字不动；
   - { blob, thumb } 描述符 → objectURL；WeakMap 按 Blob 实例缓存，
     同一条记录在会话内只创建一次 URL，避免每次渲染重复创建导致泄漏 */
const _imgURLCache = new WeakMap();
function imgSrc(v, useThumb = false) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const b = (useThumb && v.thumb) ? v.thumb : v.blob;
  if (!b) return '';
  if (typeof b === 'string') return b;
  try {
    let u = _imgURLCache.get(b);
    if (!u) { u = URL.createObjectURL(b); _imgURLCache.set(b, u); }
    return u;
  } catch (e) { return ''; }
}

/* Blob ↔ base64（仅导出/导入边界使用：.ocdata 是 JSON 单文件，Blob 不能直接序列化，
   导出时转回 base64 内嵌，导入时转回 Blob，新旧版本备份可互相导入） */
function blobToDataURL(b) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('图片读取失败'));
    r.onload = () => resolve(r.result);
    r.readAsDataURL(b);
  });
}
async function dataURLToBlob(s) {
  const res = await fetch(s);
  return await res.blob();
}

/* 消息提示音（5.3：WebAudio 合成，无需外部资源，兼容 App 打包）
   soundName 支持多种音色：默认/清脆/柔和/叮咚/风铃 */
const SOUND_PRESETS = {
  '默认':   { freq: 880, type: 'sine', dur: 0.36 },
  '清脆':   { freq: 1180, type: 'triangle', dur: 0.22 },
  '柔和':   { freq: 660, type: 'sine', dur: 0.5 },
  '叮咚':   { freq: 740, type: 'sine', dur: 0.4, two: 988 },
  '风铃':   { freq: 1568, type: 'triangle', dur: 0.6, two: 2093 },
};
function playDing() {
  if (!chatSettings.soundOn) return;
  // 自定义提示音优先（玩家上传的音频文件）
  if (chatSettings.customSound) {
    try {
      const a = new Audio(chatSettings.customSound);
      a.volume = 0.5;
      a.play().catch(() => {});
      return;
    } catch (e) { /* 回退到合成音 */ }
  }
  const p = SOUND_PRESETS[chatSettings.soundName] || SOUND_PRESETS['默认'];
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, delay, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = p.type;
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.12, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    };
    play(p.freq, 0, p.dur);
    if (p.two) play(p.two, p.dur * 0.7, p.dur);
    setTimeout(() => ctx.close(), (p.dur * 2 + 0.5) * 1000);
  } catch (e) { /* 音频不可用则静默 */ }
}

/* 20260930：某访客发消息时是否该响提示音。
   规则：① 关闭了该访客提示音（muteNotifications）→ 不响；
        ② 在聊天页内 → 仅当前正在聊的角色（currentCharId）响，其他角色不响（走未读>10条弹窗）；
        ③ 不在聊天页 → 正常响。 */
function shouldDingFor(c) {
  const cs = getCharChatSettings(c);
  if (cs && cs.muteNotifications) return false;
  if (document.body.dataset.view === 'chat') return currentCharId === c.id;
  return true;
}

/* 主动发消息（5.3：开启后按间隔随机触发；访客级设置优先，未设则继承全局）
   即使玩家没打开聊天页也会触发（模拟后台消息）
   修复：首次启动即初始化计时起点，到间隔后稳定触发（不再被额外概率挡住） */
let _lastProactive = {}; // 按角色 id 记录上次主动发消息时间
let _proactiveRandUntil = {}; // 随机模式下，按角色记录「下次触发时间点」
let _checkinUntil = {}; // 随机查岗：按角色记录「下次查岗时间点」
let _checkinCount = {};  // 随机查岗：按角色+日期记录当天已查岗次数
let _callUntil = {};     // 随机通话：按角色记录「下次来电时间点」
let _callCount = {};     // 随机通话：按角色+日期记录当天来电次数
let _packetUntil = {};   // 20260929ba 随机红包：按角色记录「下次发红包时间点」
let _ocNextAt = {};      // 超频：按访客记录下一次独立随机触发时刻（20260929at 起持久化到 kv，跨会话累计）
let _ocPending = new Set(); // 超频：避免同一访客的交互动画期间重复触发
function _ocSaveNextAt() { try { _ocSet('nextAt', _ocNextAt).catch(() => {}); } catch (e) {} }
function getCharChatSettings(c) {
  const per = (c && c.chatSettings) || {};
  const merged = Object.assign({}, chatSettings, per);
  merged.overclockUnlocked = !!_ocUnlockedCache;
  return merged;
}
let _ocUnlockedCache = false;
/* 访客禁词合并：banWords + 分组内单条禁用的字卡（bannedGroupItems 展平） */
function getCharBanWords(c) {
  const base = (c && c.banWords) || [];
  const extra = (c && c.bannedGroupItems) ? Object.values(c.bannedGroupItems).flat() : [];
  return base.concat(extra);
}

/* 角色可用字卡池：访客禁词/禁用分组同时约束聊天回复、书信、入梦签等所有字卡抽取
   （角色可以使用哪些字卡，入梦签/书信就只能用哪些字卡）。
   返回 { replies, mottos }；伪分组 id：__pool_replies__=未分组回复、__pool_mottos__=寄语
   （访客禁词弹窗里的两个伪文件夹，整组禁用后对应池整体不再参与抽取）。
   过滤后为空时回退到未过滤池（与 drawReply 的兜底语义一致） */
function charCardPools(c) {
  const junk = (t) => !(typeof t === 'string' && t.trim()) || isLineJunkText(t);
  const banned = new Set((c && c.bannedGroups) || []);
  const banWords = getCharBanWords(c).concat(
    (cards.customBanWords || []).concat((cards.customBanWordGroups || []).flatMap(g => g.items || []))
  );
  const wordBanned = (t) => banWords.some(b => b && t.includes(b));
  const rawReplies = [];
  if (!banned.has('__pool_replies__')) (cards.customReplies || []).forEach(t => rawReplies.push(t));
  (cards.customReplyGroups || []).forEach(g => {
    if (g.disabled || banned.has(g.id)) return;
    (g.items || []).forEach(t => rawReplies.push(t));
  });
  const rawMottos = banned.has('__pool_mottos__') ? [] : (cards.customMottos || []).slice();
  const applyWordBan = (arr) => {
    if (!banWords.length) return arr;
    const out = arr.filter(t => !wordBanned(t));
    return out.length ? out : arr;
  };
  return {
    replies: applyWordBan(rawReplies.filter(t => !junk(t))),
    mottos: applyWordBan(rawMottos.filter(t => !junk(t))),
  };
}
function startProactiveTimer() {
  // 初始化计时起点：避免首次 last=0 导致 Date.now()-0 恒判定「已到时间」
  for (const c of characters) {
    if (!_lastProactive[c.id]) _lastProactive[c.id] = Date.now();
  }
  setInterval(async () => {
    const day = todayKey();
    for (const c of characters) {
      const s = getCharChatSettings(c);
      const now = Date.now();
      if (!_lastProactive[c.id]) _lastProactive[c.id] = now;

      // —— 主动发消息（双模式互斥：随机模式优先） ——
      if (s.proactive) {
        let triggerAt;
        if (s.proactiveRandom) {
          // 随机模式：在设置的 最小～最大 分钟区间内随机取下一次触发时刻（每次只发一条；20260929bf 区间可设置）
          const lo = Math.max(1, parseInt(s.proactiveRandMin, 10) || s.proactiveMin || 5);
          const hi = Math.max(lo, Math.min(720, parseInt(s.proactiveRandMax, 10) || 120));
          if (!_proactiveRandUntil[c.id] || _proactiveRandUntil[c.id] <= now) {
            _proactiveRandUntil[c.id] = now + randInt(lo, hi) * 60000;
          }
          triggerAt = _proactiveRandUntil[c.id];
        } else {
          triggerAt = _lastProactive[c.id] + (s.proactiveMin || 10) * 60000;
        }
        if (now >= triggerAt) {
          _lastProactive[c.id] = now;
          if (s.proactiveRandom) {
            const lo2 = Math.max(1, parseInt(s.proactiveRandMin, 10) || s.proactiveMin || 5);
            const hi2 = Math.max(lo2, Math.min(720, parseInt(s.proactiveRandMax, 10) || 120));
            _proactiveRandUntil[c.id] = now + randInt(lo2, hi2) * 60000;
          }
          // 20260929ba：转账/红包不再搭载在主动消息里——独立「随机红包」模式（下方 s.randomPacket 块）
          // 20260929ah：AI 模式下主动消息由 AI 生成（节奏不变）；失败软回退字卡（不回滚模式开关）
          let msg = null;
          if (await isAIMode()) {
            const r = await aiSoftReply(c,
              '请主动给玩家发一条消息（像自然地想起对方）：可以是分享、问候、吐槽或关心，1~3 句，符合角色口吻。',
              () => drawReply(cards, getCharBanWords(c), c.relation || null, c.bannedGroups || []));
            msg = r;
          } else {
            msg = drawReply(cards, getCharBanWords(c), c.relation || null, c.bannedGroups || []);
          }
          await deliverCharMessage(c, msg, 'text');
          // 主动发消息也可能随机附带一次戳一戳（AI 模式下不触发）
          maybeCharPoke(c);
          // 20260929al：访客随机向玩家提问（每天0~3条，搭在主动消息节奏上，不新增定时器）
          maybeCharAskPlayer(c);
          // 超频已从主动消息分离，固定在 15 秒 tick 每访客独立计时；此处不再触发
        }
      }

      // —— 访客随机查岗（15.1：默认不限次数；角色聊天设置里可设每日上限，0=不限） ——
      if (s.proactiveCheckin) {
        const ckl = Math.max(0, parseInt(s.checkinDailyLimit, 10) || 0); // 0 = 不限制
        if (!_checkinCount[c.id + '|' + day]) _checkinCount[c.id + '|' + day] = 0;
        if (!ckl || _checkinCount[c.id + '|' + day] < ckl) {
          if (!_checkinUntil[c.id] || _checkinUntil[c.id] <= now) {
            _checkinUntil[c.id] = now + randInt(20, 180) * 60000; // 20~180 分钟内随机查岗一次
            _checkinCount[c.id + '|' + day]++;
            // 20260929ah：查岗寄语 AI 模式由 AI 生成（TA 在做什么也由 AI 编），失败回退字卡
            let text;
            if (await isAIMode()) {
              text = await aiSoftReply(c,
                '请以角色身份发一条「突击查岗」消息给玩家：先问玩家现在在做什么，再自然地说出你此刻正在做的一件具体小事（符合人设与当前时段）。2~3 句。',
                () => {
                  const doing = drawFrom([cards.customReplies, ...(cards.customReplyGroups || []).map(g => g.items || [])].flat());
                  return `突击查岗！你现在在做什么？\n我在做：${doing}`;
                });
            } else {
              const doing = drawFrom([cards.customReplies, ...(cards.customReplyGroups || []).map(g => g.items || [])].flat());
              text = `突击查岗！你现在在做什么？\n我在做：${doing}`;
            }
            await deliverCharMessage(c, text, 'checkin', { text });
          }
        }
      }

      // —— 超频独立随机触发（与主动消息频率解耦；总/访客开关，默认开启，无附加概率） ——
      await _ocTickRandom(c, now);

      // —— 访客随机通话（5.8：随机来电，默认不限次数；角色聊天设置里可设每日上限，0=不限） ——
      if (s.randomCall) {
        const cll = Math.max(0, parseInt(s.callDailyLimit, 10) || 0); // 0 = 不限制
        if (!_callCount[c.id + '|' + day]) _callCount[c.id + '|' + day] = 0;
        if (!cll || _callCount[c.id + '|' + day] < cll) {
          if (!_callUntil[c.id] || _callUntil[c.id] <= now) {
            _callUntil[c.id] = now + randInt(30, 240) * 60000; // 30~240 分钟随机来电一次
            _callCount[c.id + '|' + day]++;
            triggerIncomingCall(c);
          }
        }
      }

      // —— 访客随机发红包（20260929ba：独立固定随机间隔模式，与查岗/通话同款；
      //     总设置 randomPacket 开启后，访客从自己钱包发转账红包给玩家） ——
      if (s.randomPacket) {
        if (!_packetUntil[c.id] || _packetUntil[c.id] <= now) {
          _packetUntil[c.id] = now + randInt(40, 240) * 60000; // 40~240 分钟随机一次
          await deliverCharTransfer(c);
        }
      }
    }
  }, 15000);
}

/* 角色向玩家转账（char_to_me，待领取）：从访客钱包真扣款，玩家可在卡片内领取或退回
   20260929au：opts.force=true（开发者命令）时无视钱包余额（模拟测试用） */
async function deliverCharTransfer(c, opts = {}) {
  const amount = randInt(50, 2000);
  // 访客钱包不足则不发（开发者命令 force 除外）
  if ((c.wallet ?? 100000) < amount) {
    if (!opts.force) return;
  } else {
    c.wallet = (c.wallet ?? 100000) - amount;
    await saveChar(c);
  }
  const m = { id: uid('msg'), charId: c.id, from: 'them', type: 'transfer', content: { amount, note: '', direction: 'char_to_me', status: 'pending' }, time: Date.now() };
  await idbPut('messages', m);
  const cs = getCharChatSettings(c);
  if (currentCharId === c.id && document.body.dataset.view === 'chat') {
    appendMessage(m);
    // 20260929aw：正在看的转账直接标记已读——防退出聊天后导航页仍提示未读
    setSetting('lastRead_' + c.id, Date.now());
  } else {
    renderChatList();
    if (shouldDingFor(c)) playDing();
    notifyIncoming(c, '¥' + amount, c.name + ' 给你转账'); // 20260929bi：统一出口（含挂后台）
  }
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* 请求通知权限（2.5：网页端 Notification，用于后台消息/通话/查岗提醒）
   20261001ci：APK 端此前从不申请系统通知权限——WebView 没有 Notification API，
   直接走到「当前浏览器不支持通知」就返回了，Android 13+ 不授权 POST_NOTIFICATIONS
   就一条通知都发不出（系统里显示「未请求任何权限」）。
   现在 APK 端走 @capacitor/local-notifications 的 requestPermissions（原生权限弹窗，无需手势） */
function requestNotificationPermission() {
  const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
  if (LN && typeof LN.requestPermissions === 'function') {
    LN.requestPermissions().then((st) => {
      const granted = st && (st.display === 'granted' || st.granted === true);
      if (granted) miniToast('通知权限已开启');
      else miniToast('通知权限未开启，收不到消息提醒（系统设置→应用→白日梦→通知管理）');
    }).catch(() => {});
    return;
  }
  if (!('Notification' in window)) {
    miniToast('当前浏览器不支持通知');
    return;
  }
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') {
    miniToast('通知已关闭，请在系统设置里开启');
    return;
  }
  Notification.requestPermission().then((perm) => {
    if (perm === 'granted') miniToast('通知权限已开启');
    else miniToast('通知权限未开启，可在系统设置中开启');
  });
}

/* 20260929bi：浏览器要求权限申请必须发生在用户手势里——启动时的裸调用不会弹授权框。
   首次任意点击时补申请一次（每安装只问一次，拒绝/授权后不再打扰）。
   20261001ci：APK 端是原生权限弹窗不受此限制，启动即申请（跳过手势等待）。 */
function setupNotifyFirstGesture() {
  try {
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (LN) return; // APK：启动即申请，无需手势
    if (!('Notification' in window)) return;
    if (localStorage.getItem('bm_notify_asked')) return;
    const ask = () => {
      document.removeEventListener('pointerdown', ask);
      try { localStorage.setItem('bm_notify_asked', '1'); } catch (e) {}
      if (Notification.permission === 'default') requestNotificationPermission();
    };
    document.addEventListener('pointerdown', ask);
  } catch (e) {}
}

/* 20260929bi：统一系统通知出口（QQ/微信式后台弹窗）。
   触发条件：notifySystem 未关、该访客未静音、浏览器通知权限已授权，
   且（页面挂后台 document.hidden / 窗口失焦 / 不在该聊天页）任一成立。
   —— 修复「软件挂后台收不到通知」：此前所有通知点只判 view!=='chat'，
   挂后台时 view 仍是 'chat'，通知全被跳过。 */
function notifyIncoming(c, body, title) {
  try {
    if (chatSettings.notifySystem === false) return;
    const cs = c ? getCharChatSettings(c) : null;
    if (cs && cs.muteNotifications) return;
    const inChatView = document.body.dataset.view === 'chat';
    // 正在盯着聊天页、且页面没挂后台/没失焦 → 不打扰（QQ/微信也是盯着聊天窗不弹）。
    // 挂后台（document.hidden）或失焦（!hasFocus）时仍要弹——这是后台提醒的核心。
    // 用 document.hidden 作主判据（无头/移动端 hasFocus 不可靠），hasFocus 仅作辅助。
    if (inChatView && !document.hidden && document.hasFocus()) return;
    // 20261001ci：APK 端走 @capacitor/local-notifications——WebView 里 Web Notification
    // 形同虚设（无权限概念、授权后也可能不显示），必须走原生本地通知才会在系统通知栏留记录
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (LN && typeof LN.schedule === 'function') {
      bmNativeNotify(LN, c, body, title);
      return;
    }
    if (!('Notification' in window)) return;
    const N = window.Notification;
    if (!N || N.permission !== 'granted') return;
    const n = new N(title || (c ? c.name + ' 发来消息' : '白日梦'), {
      body: String(body == null ? '' : body).slice(0, 90),
      icon: c && c.avatar ? imgSrc(c.avatar) : undefined,
      tag: c ? 'bm-' + c.id : 'bm', // 同一访客连发只弹一条，不刷屏
    });
    n.onclick = () => { try { window.focus(); n.close(); } catch (e) {} };
  } catch (e) {}
}

/* 20261001ci：APK 原生本地通知（幂等创建渠道 + schedule；smallIcon 用应用图标）。
   权限被拒（display=denied）时静默放弃——申请引导在 requestNotificationPermission 里 */
async function bmNativeNotify(LN, c, body, title) {
  try {
    let allowed = true;
    try {
      const st = await LN.checkPermissions();
      allowed = !st || st.display !== 'denied';
    } catch (e) {}
    if (!allowed) return;
    try {
      await LN.createChannel({
        id: 'bm-messages',
        name: '消息提醒',
        description: '访客消息、朋友圈动态、通话与书信提醒',
        importance: 5, // HIGH：横幅 + 通知栏
        visibility: 'PUBLIC',
      });
    } catch (e) {} // 渠道已存在或低版本 Android 无渠道概念 → 忽略
    await LN.schedule({
      notifications: [{
        id: Math.floor(Date.now() % 2147483000), // int32 内唯一 id
        title: title || (c ? c.name + ' 发来消息' : '白日梦'),
        body: String(body == null ? '' : body).slice(0, 120),
        channelId: 'bm-messages',
        smallIcon: 'res://ic_launcher',
      }],
    });
  } catch (e) {}
}

function formatDuration(sec) {
  sec = sec || 0;
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

/* 消息时间戳（20260930）：气泡下方的小字时间。
   今天 → 「HH:MM」；昨天 → 「昨天 HH:MM」；更早 → 「M月D日 HH:MM」 */
function msgTimeLabel(ts) {
  const d = new Date(ts || Date.now());
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thatStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((dayStart - thatStart) / 86400000);
  if (diffDays <= 0) return hm;
  if (diffDays === 1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/* ---------- 视图切换 ---------- */
function switchView(viewName) {
  const prevView = document.body.dataset.view;
  // 20260929aw：离开聊天页即把当前会话标记为已读——修复「在聊天页里看过消息后，
  // 退到导航页仍提示未读」的滞后：期间送达的消息此前只 appendMessage 不更新已读时间
  if (prevView === 'chat' && viewName !== 'chat') {
    if (currentCharId) {
      setSetting('lastRead_' + currentCharId, Date.now()).then(() => renderChatList());
    } else if (currentGroupId) {
      setSetting('lastRead_group_' + currentGroupId, Date.now()).then(() => renderChatList());
      markGroupBgChatWindow(currentGroupId); // az：退出群聊页 → 挂 20 分钟自主聊天窗口（autoChat 开启时）
    }
  }
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + viewName).classList.add('active');
  document.body.dataset.view = viewName; // PC 端双栏布局依赖
  $$('.tab-item').forEach(t => t.classList.toggle('active',
    t.dataset.view === viewName || (viewName === 'chat' && t.dataset.view === 'chatlist')));
  // 进入聊天页时隐藏底部导航栏（14：聊天页不应显示上一页的导航栏）
  // 20260929s：改用 class 控制——移动端隐藏，PC 端（≥900px）左侧竖向导航常驻
  const tb = $('.tabbar');
  if (tb) {
    tb.style.display = ''; // 清掉旧版可能残留的 inline display，统一交给 class
    tb.classList.toggle('tab-hidden', viewName === 'chat');
  }
  // 全局背景层：聊天导航/朋友圈显示对应背景（铺满含底栏后方），主页/聊天页各自管理
  updateAppFullBg();
  if (viewName === 'moments') enterMoments();
  // 进入主页时重算统计（访客数量 / 聊天天数），保证添加/删除访客后数字即时刷新
  if (viewName === 'home') renderPlayerHome();
}

/* ---------- 多指触摸守卫（20261001ci）----------
   真机上「三指下滑截屏」等系统多指手势会留下按在消息气泡上的手指，
   WebView 里 550ms 长按定时器来不及被 touchmove/touchend 清掉 → 长按菜单误弹出。
   约定：任何时刻出现 ≥2 根手指即记录时间戳，1.2 秒内所有长按菜单入口一律拒绝弹菜单；
   各长按 touchstart 同时检查 touches.length，多指不启动定时器。 */
let _bmMultiTouchAt = 0;
document.addEventListener('touchstart', (e) => {
  if (e.touches && e.touches.length >= 2) _bmMultiTouchAt = Date.now();
}, { capture: true, passive: true });
function bmMultiTouchRecent() { return Date.now() - _bmMultiTouchAt < 1200; }

/* ---------- 移动端侧滑/返回键的「应用内返回」逻辑（20261001ch） ----------
   统一入口：浏览器侧滑（popstate）与 APK 物理返回键（Capacitor backButton）
   都走这里。返回 true = 消费了这次返回（有上一级）；false = 已在顶层，仅拦截 */
function bmInternalBack() {
  // 软件声明未同意期间：不许任何返回动作绕过声明（声明弹窗也不被侧滑关掉）
  if (_noticeGate) return false;
  // 1) 最上层弹窗开着 → 关弹窗（等于取消，closeModal 内部处理访客主页/设置上下文回退）
  const mask = $('#modal-mask');
  if (mask && mask.classList.contains('show')) { closeModal(); return true; }
  // 2) 长按操作菜单开着 → 关菜单
  const menu = $('#ctx-menu');
  if (menu && menu.classList.contains('show')) { closeCtxMenu(); return true; }
  // 3) 聊天页多选模式 → 先退出多选
  if (multiSelectMode) { exitMultiSelect(); return true; }
  // 4) 聊天页 → 聊天导航（与顶栏返回按钮同路径）
  if (document.body.dataset.view === 'chat') {
    closeModalPanels(); cancelQuote(); switchView('chatlist');
    return true;
  }
  // 5) 已在顶层 tab（home / chatlist / moments）→ 无上一级，仅拦截退出
  return false;
}

/* ---------- history 守卫：拦住浏览器侧滑/返回，永不真正退出网页（20261001ch） ----------
   原理：页面加载即 replaceState 根锚点 + pushState 一条「守卫」记录。
   用户侧滑 → 历史退到根锚点触发 popstate → 执行应用内返回 → 重新压入守卫。
   历史栈永不耗尽，浏览器侧滑/返回键永远无法关闭页面本身。 */
(function () {
  if (!window.history || !history.pushState) return;
  const ROOT = { bmRoot: true }, GUARD = { bmGuard: true };
  try {
    history.replaceState(ROOT, '');
    history.pushState(GUARD, '');
  } catch (e) { return; }
  window.addEventListener('popstate', function () {
    try { bmInternalBack(); } catch (e) {}
    // 无论是否处理，都重新压入守卫条目（异步等当前导航事件走完）
    setTimeout(function () { try { history.pushState(GUARD, ''); } catch (e) {} }, 0);
  });
})();

/* ---------- Capacitor（APK）物理返回键/侧滑手势接管（20261001ch） ----------
   装有 @capacitor/app 时生效：返回键 → 应用内返回；顶层双击 2 秒内退出。
   未装插件（纯网页）时 window.Capacitor.Plugins.App 不存在，静默跳过 */
(function () {
  try {
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App || typeof App.addListener !== 'function') return;
    App.addListener('backButton', function () {
      let handled = false;
      try { handled = bmInternalBack(); } catch (e) {}
      if (handled) return;
      const now = Date.now();
      if (window.__bmLastBack && now - window.__bmLastBack < 2000) { App.exitApp(); return; }
      window.__bmLastBack = now;
      if (typeof miniToast === 'function') miniToast('再按一次退出应用');
    });
  } catch (e) {}
})();

/* 聊天导航/朋友圈顶栏滚动主色（20260929u）：复用 computeDominantColor（imgSrc 兼容
   Blob/旧 base64），按图缓存，异步回填 CSS 变量；无背景时清空走 CSS 默认底色 */
const _topColorCache = new Map();
function extractTopColor(bg, cssVar) {
  const root = document.documentElement.style;
  if (!bg) { root.setProperty(cssVar, ''); return; }
  const src = imgSrc(bg);
  const cached = _topColorCache.get(src);
  if (cached !== undefined) { root.setProperty(cssVar, cached || ''); return; }
  computeDominantColor(src).then((hex) => {
    _topColorCache.set(src, hex);
    root.setProperty(cssVar, hex ? hexToRgba(hex, 0.72) : '');
  });
}

/* 全局页面背景层（铺满整个 app 含顶栏/底栏后方）：
   聊天导航页与聊天页→navBg，朋友圈→momentsBg，个人主页→homeBg。
   20260929v：聊天页回滚为导航背景——u 版曾把访客聊天背景铺上全屏层，
   导致 PC 端进聊天后左列表背景跟着变、手机端聊天页顶栏区域也跟着变；
   现在聊天背景只在聊天页自身呈现（手机=消息区自铺，PC=栏内 ::before 单层承接） */
function updateAppFullBg() {
  const el = $('#app-fullbg');
  if (!el) return;
  const view = document.body.dataset.view || 'home';
  let bg = '';
  if ((view === 'chatlist' || view === 'chat') && chatTheme.navBg) bg = chatTheme.navBg;
  if (view === 'moments' && chatTheme.momentsBg) bg = chatTheme.momentsBg;
  if (view === 'home' && chatTheme.homeBg) bg = chatTheme.homeBg;
  if (bg) { el.style.backgroundImage = `url("${imgSrc(bg)}")`; el.style.display = 'block'; }
  else { el.style.backgroundImage = ''; el.style.display = 'none'; }
  // 顶栏滚动主色（按当前页背景提取；有缓存，开销可忽略）
  if (view === 'chatlist') extractTopColor(chatTheme.navBg, '--nav-top-color');
  if (view === 'moments') extractTopColor(chatTheme.momentsBg, '--moments-top-color');
}

/* ---------- 弹窗 ---------- */
function openModal(html, opts) {
  const box = $('#modal-content');
  const o = opts || {};
  // 20260929bk：软件声明未同意期间（_noticeGate），任何非声明的弹窗一律抑制——
  // 保证声明弹窗绝对排在最前，不被来电/超频/书信/入梦签等打断
  // 20261001cj：抑制时返回 false，调用方可据此跳过后续「取元素绑 onclick」的动作，
  //   避免 $() 取到 null 抛异常（真机声明未同意时点按钮崩溃、界面瘫痪）
  if (_noticeGate && String(html || '').indexOf('notice-modal') === -1) return false;
  // 20260929aq：超频礼物弹窗支持玻璃拟态（glass）与收窄（narrow）外观
  // 20260929bc：glitch=故障风非圆角弹窗（warning/惊喜触发）；galaxy=记忆宫殿星空卡片风
  box.classList.remove('modal-oc-glass', 'modal-oc-narrow', 'modal-oc-hub', 'modal-oc-glitch', 'modal-pal-galaxy');
  if (o.glass) box.classList.add('modal-oc-glass');
  if (o.narrow) box.classList.add('modal-oc-narrow');
  if (o.glitch) box.classList.add('modal-oc-glitch');
  if (o.galaxy) box.classList.add('modal-pal-galaxy');
  $('#modal-mask').classList.toggle('mask-oc-clear', !!o.noBackdrop);
  $('#modal-mask').classList.add('show');
  box.innerHTML = html;
}
function closeModal() {
  const wasOpen = $('#modal-mask').classList.contains('show');
  $('#modal-content').classList.remove('modal-oc-glass', 'modal-oc-narrow', 'modal-oc-hub', 'modal-oc-glitch', 'modal-pal-galaxy');
  $('#modal-mask').classList.remove('mask-oc', 'mask-oc-clear');
  $('#modal-mask').classList.remove('show');
  setCallGlass(false);
  resetModalSizing(); // 20260929bg：清理通话弹窗等比缩放的 inline 尺寸，防残留到下一个弹窗
  // 若当前处于「访客主页 → 子功能」的上下文，关闭子功能后自动回到访客主页
  if (_charProfileActive) {
    const c = _charProfileActive;
    _charProfileActive = null;
    showCharProfile();
    return;
  }
  // 20260929bl：总设置子功能上下文——子功能/确认弹窗关闭后自动回到总设置（回到上一界面，
  // 不再直接退出）。关的若是总设置本身则清标记正常关闭。覆盖：入梦签设置/软件声明重看/
  // 开发者密码/清除与重置的 showConfirm/保活引导等一切从总设置打开的弹窗。
  if (wasOpen && _settingsActive) {
    if (document.querySelector('#modal-content #gs-close')) {
      _settingsActive = false; // 关的就是总设置本身 → 正常退出
    } else {
      showSettingsModal();
      return;
    }
  }
}

/* 访客主页子功能上下文标记（关闭后回到访客主页） */
let _charProfileActive = null;
/* 20260929bl：总设置子功能上下文标记（showSettingsModal 置 true，关总设置本身时清除） */
let _settingsActive = false;

/* 强制完全关闭弹窗（不触发返回访客主页），用于删除访客等最终操作 */
function forceCloseModal() {
  _charProfileActive = null;
  _settingsActive = false; // 20260929bl：一并清除总设置返回标记，防误弹
  $('#modal-mask').classList.remove('show');
  setCallGlass(false);
  resetModalSizing(); // 20260929bg：同 closeModal，清理缩放残留
}

// 点击遮罩空白处关闭弹窗
// 20261001cj：软件声明未同意期间（_noticeGate）声明弹窗是唯一弹窗，必须点「同意」才能进，
//   严禁被遮罩点击关闭——否则开屏「跳过」后的手指点击会穿透到透明遮罩误关声明，
//   导致 _noticeGate 永久卡 true、所有弹窗被抑制、按钮全失灵（真机必现 bug）
$('#modal-mask').addEventListener('click', (e) => {
  if (e.target !== $('#modal-mask')) return;
  if (_noticeGate) return; // 声明未同意：遮罩点击不关闭，只能点同意按钮
  closeModal();
});

/* ---------- 图片裁剪器（20260929az 虚拟框版）：上传背景图先裁后用 ----------
   选图后弹出全屏裁剪层：图片在舞台上自由拖动/缩放，画面中央叠加「虚拟框」——
   虚拟框比例 = 目标显示区域的实际宽高比（聊天背景=视口、主页/访客主页=hero 实测比），
   框外整体压暗 + 九宫格辅助线 + 四角亮标，所见即所得；确认后按虚拟框精确裁剪。
   输出 {blob,thumb,w,h} 描述符（与 compressImage 同构，imgSrc 直接可用）；
   取消 resolve(null)，调用方保持原状。 */
function openImageCropper(file, opts = {}) {
  const aspect = Math.min(2.4, Math.max(0.45, opts.aspect || (document.documentElement.clientWidth / Math.max(1, document.documentElement.clientHeight))));
  const maxEdge = opts.maxEdge || 1440;
  const quality = opts.quality || 0.72;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); miniToast('图片格式不支持'); resolve(null); };
    img.onload = () => {
      // 舞台 = 图片自由区；虚拟框 = 中央裁剪区（比例=目标区域宽/高，尺寸缓存于 state）
      const state = { scale: 1, tx: 0, ty: 0, minScale: 1, pointers: new Map(), pinchDist: 0, vw: 320, vh: 320 };
      const ov = document.createElement('div');
      ov.id = 'img-cropper';
      ov.innerHTML = `
        <div class="ic-hint">拖动图片调整位置 · 双指 / 滚轮 / 滑杆缩放</div>
        <div class="ic-stage">
          <img class="ic-img" draggable="false">
          <div class="ic-vf"><i class="v" style="left:33.333%"></i><i class="v" style="left:66.666%"></i><i class="h" style="top:33.333%"></i><i class="h" style="top:66.666%"></i><b class="c1"></b><b class="c2"></b><b class="c3"></b><b class="c4"></b></div>
        </div>
        <div class="ic-toolbar">
          <input type="range" class="ic-zoom" min="100" max="400" value="100">
          <div class="ic-btns">
            <button class="btn ic-cancel" type="button">取消</button>
            <button class="btn primary ic-ok" type="button">确认裁剪</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const stage = ov.querySelector('.ic-stage');
      const vf = ov.querySelector('.ic-vf');
      const el = ov.querySelector('.ic-img');
      const zoom = ov.querySelector('.ic-zoom');
      el.src = url;
      // 虚拟框尺寸：舞台内按目标比例取最大内接框（留 16px 呼吸边）
      const fitVf = () => {
        const sw = stage.clientWidth || 320, sh = stage.clientHeight || 320;
        const pad = 16;
        let vw = sw - pad * 2, vh = vw / aspect;
        if (vh > sh - pad * 2) { vh = sh - pad * 2; vw = vh * aspect; }
        state.vw = Math.max(60, Math.round(vw));
        state.vh = Math.max(60, Math.round(vh));
        vf.style.width = state.vw + 'px';
        vf.style.height = state.vh + 'px';
      };

      const clampPos = () => {
        const mx = Math.max(0, (img.naturalWidth * state.scale - state.vw) / 2);
        const my = Math.max(0, (img.naturalHeight * state.scale - state.vh) / 2);
        state.tx = Math.min(mx, Math.max(-mx, state.tx));
        state.ty = Math.min(my, Math.max(-my, state.ty));
      };
      const render = () => {
        clampPos();
        el.style.width = (img.naturalWidth * state.scale) + 'px';
        el.style.height = (img.naturalHeight * state.scale) + 'px';
        el.style.transform = `translate(calc(-50% + ${state.tx}px), calc(-50% + ${state.ty}px))`;
      };
      const setScale = (v, cx, cy) => {
        // 以舞台中心（=虚拟框中心；cx,cy 为相对舞台左上角的坐标）为锚缩放，保持锚点下的图像不动
        const old = state.scale;
        const ns = Math.min(state.minScale * 4, Math.max(state.minScale, v));
        if (old === ns) return;
        const fx = stage.clientWidth / 2, fy = stage.clientHeight / 2;
        const ax = (cx == null ? fx : cx) - fx - state.tx;
        const ay = (cy == null ? fy : cy) - fy - state.ty;
        state.tx += ax * (1 - ns / old);
        state.ty += ay * (1 - ns / old);
        state.scale = ns;
        zoom.value = Math.round(ns / state.minScale * 100);
        render();
      };
      el.onload = () => {
        fitVf();
        // 最小缩放：图片恰好盖满虚拟框（框内永不露底）
        state.minScale = Math.max(state.vw / img.naturalWidth, state.vh / img.naturalHeight);
        state.scale = state.minScale;
        render();
      };
      if (el.complete && el.naturalWidth) el.onload();

      // 拖动 / 双指缩放（Pointer Events 统一鼠标与触屏）
      stage.addEventListener('pointerdown', (e) => {
        stage.setPointerCapture(e.pointerId);
        state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (state.pointers.size === 2) {
          const pts = [...state.pointers.values()];
          state.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        }
      });
      stage.addEventListener('pointermove', (e) => {
        if (!state.pointers.has(e.pointerId)) return;
        const prev = state.pointers.get(e.pointerId);
        state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (state.pointers.size === 1) {
          state.tx += e.clientX - prev.x;
          state.ty += e.clientY - prev.y;
          render();
        } else if (state.pointers.size === 2) {
          const pts = [...state.pointers.values()];
          const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (state.pinchDist > 0) setScale(state.scale * (d / state.pinchDist));
          state.pinchDist = d;
        }
      });
      const dropPtr = (e) => { state.pointers.delete(e.pointerId); state.pinchDist = 0; };
      stage.addEventListener('pointerup', dropPtr);
      stage.addEventListener('pointercancel', dropPtr);
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        setScale(state.scale * (e.deltaY < 0 ? 1.08 : 0.925), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      zoom.oninput = () => setScale(state.minScale * (parseInt(zoom.value, 10) / 100));

      const finish = (ok) => {
        // 虚拟框尺寸缓存于 state（不依赖 DOM 读取），按框取样 → 输出比例恒等于目标比例
        const vw = state.vw, vh = state.vh;
        const dw = img.naturalWidth * state.scale, dh = img.naturalHeight * state.scale;
        const sx = (dw / 2 - vw / 2 - state.tx) * (img.naturalWidth / dw);
        const sy = (dh / 2 - vh / 2 - state.ty) * (img.naturalHeight / dh);
        const sw = vw * (img.naturalWidth / dw);
        const sh = vh * (img.naturalHeight / dh);
        URL.revokeObjectURL(url);
        ov.remove();
        if (!ok) { resolve(null); return; }
        try {
          // 输出画布严格保持虚拟框比例（sw/sh = vw/vh，无拉伸变形）；maxEdge 限长边
          let outW = Math.max(1, Math.round(sw));
          let outH = Math.max(1, Math.round(outW / aspect));
          if (outW > maxEdge || outH > maxEdge) {
            const k = maxEdge / Math.max(outW, outH);
            outW = Math.max(1, Math.round(outW * k));
            outH = Math.max(1, Math.round(outH * k));
          }
          const canvas = document.createElement('canvas');
          canvas.width = outW; canvas.height = outH;
          canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
          canvasToBlob(canvas, 'image/jpeg', quality).then(async (blob) => {
            const tr = 320 / Math.max(outW, outH);
            const tc = document.createElement('canvas');
            tc.width = Math.max(1, Math.round(outW * tr));
            tc.height = Math.max(1, Math.round(outH * tr));
            tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
            const thumb = await canvasToBlob(tc, 'image/jpeg', 0.72);
            resolve({ blob, thumb, w: outW, h: outH });
          }).catch(() => resolve(null));
        } catch (err) { resolve(null); }
      };
      ov.querySelector('.ic-cancel').onclick = () => finish(false);
      ov.querySelector('.ic-ok').onclick = () => finish(true);
    };
    img.src = url;
  });
}

/* ---------- 聊天列表页加号菜单（添加访客 / 建立群聊 / 批量管理 / 访客分组） ---------- */
function showChatListMenu() {
  const _ok = openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">聊天</div>
      <button class="icon-btn" id="clm-close">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn block" style="justify-content:flex-start;" id="clm-add">
        <span class="func-ic">${icon('plus', 18)}</span><span>添加访客</span>
      </button>
      <button class="btn block" style="justify-content:flex-start;" id="clm-group">
        <span class="func-ic">👥</span><span>建立群聊</span>
      </button>
      <button class="btn block" style="justify-content:flex-start;" id="clm-batch">
        <span class="func-ic">${icon('checklist', 18)}</span><span>批量管理</span>
      </button>
      <button class="btn block" style="justify-content:flex-start;" id="clm-folders">
        <span class="func-ic">${icon('cards', 18)}</span><span>访客分组</span>
      </button>
    </div>
  `);
  if (_ok === false) return; // 20261001cj：声明未同意被抑制，跳过绑定避免 null 崩溃
  $('#clm-close').onclick = closeModal;
  $('#clm-add').onclick = () => { closeModal(); showAddCharModal(); };
  $('#clm-group').onclick = () => { closeModal(); showCreateGroupModal(); };
  $('#clm-batch').onclick = () => { closeModal(); enterBatchMode(); };
  $('#clm-folders').onclick = () => { closeModal(); showCharGroupsModal(); };
}

/* 建立群聊弹窗（从导航页进入：勾选 2 个以上角色） */
function showCreateGroupModal() {
  if (characters.length < 2) { miniToast('至少需要 2 个访客才能建立群聊'); return; }
  const sel = new Set();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">建立群聊</div>
      <button class="icon-btn" id="cg-create-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">勾选要拉入群聊的访客（至少 2 个）</div>
    <div style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:14px;" id="cg-create-list">
      ${characters.map(c => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;" data-gsel="${c.id}">
          <div class="avatar sm">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
          <div style="flex:1;font-size:14px;font-weight:600;">${escapeHtml(c.name)}</div>
          <div class="gs-check" style="width:20px;height:20px;border-radius:50%;border:2px solid var(--text-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;color:#141019;flex-shrink:0;"></div>
        </div>`).join('')}
    </div>
    <button class="btn primary block" id="cg-create-go">创建群聊</button>
  `);
  $('#cg-create-close').onclick = closeModal;
  const refresh = () => {
    document.querySelectorAll('[data-gsel]').forEach(el => {
      const on = sel.has(el.dataset.gsel);
      const box = el.querySelector('.gs-check');
      box.style.background = on ? 'var(--purple)' : '';
      box.style.borderColor = on ? 'var(--purple)' : 'var(--text-tertiary)';
      box.textContent = on ? '✓' : '';
      el.style.borderColor = on ? 'var(--purple)' : 'var(--border)';
    });
  };
  document.querySelectorAll('[data-gsel]').forEach(el => {
    el.onclick = () => { sel.has(el.dataset.gsel) ? sel.delete(el.dataset.gsel) : sel.add(el.dataset.gsel); refresh(); };
  });
  $('#cg-create-go').onclick = async () => {
    if (sel.size < 2) { miniToast('至少选择 2 个访客'); return; }
    closeModal();
    await createGroup([...sel]);
  };
}

/* ---------- 添加访客弹窗 ---------- */
function showAddCharModal() {
  openModal(`
    <h3>添加访客</h3>
    <div class="field">
      <label>头像（可选）</label>
      <input class="input" type="file" id="char-avatar-input" accept="image/*">
    </div>
    <div class="field">
      <label>访客名称 *</label>
      <input class="input" id="char-name" placeholder="给 TA 起个名字">
    </div>
    <div class="field">
      <label>访客生平（3000 字内）</label>
      <textarea class="textarea" id="char-bio" maxlength="3000" placeholder="介绍一下 TA 吧…"></textarea>
    </div>
    <div class="field">
      <label>专属昵称（可选）</label>
      <input class="input" id="char-nick" maxlength="10" placeholder="TA 对你的专属昵称（创建后可在编辑资料里加到 5 个）">
    </div>
    <div class="field">
      <label>角色开场白（可选）</label>
      <textarea class="textarea" id="char-greeting" maxlength="500" placeholder="TA 见到你说的第一句话…（留空则 TA 从字卡库随机抽一张打招呼）"></textarea>
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="btn-char-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="btn-char-confirm">添加访客</button>
    </div>
  `);

  $('#btn-char-cancel').onclick = closeModal;
  $('#btn-char-confirm').onclick = async () => {
    const name = $('#char-name').value.trim();
    if (!name) { showToast('请填写访客名称'); return; }
    const bio = $('#char-bio').value.trim();
    const nick = $('#char-nick').value.trim();
    const greeting = $('#char-greeting').value.trim();
    let avatar = '';
    const file = $('#char-avatar-input').files[0];
    if (file) {
      // 20260929bn：访客头像方形裁剪后再用
      const cropped = await openImageCropper(file, { aspect: 1, maxEdge: 360, quality: 0.8 });
      if (cropped) avatar = cropped;
    }
    await addCharacter(name, bio, avatar, nick, { greeting }); // 20260930cb：开场白随创建落成第一条消息
    closeModal();
    renderChatList();
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

/* 编辑访客资料（改名/生平/头像，8.2） */
function showEditCharModal(c) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">编辑访客资料</div>
      <button class="icon-btn" id="editchar-close">✕</button>
    </div>
    <div class="field">
      <label>头像</label>
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="avatar lg" id="editchar-avatar-preview">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : (c.name[0] || '?')}</div>
        <input class="input" type="file" id="editchar-avatar-input" accept="image/*" style="flex:1;">
      </div>
    </div>
    <div class="field">
      <label>访客名称</label>
      <input class="input" id="editchar-name" value="${escapeHtml(c.name)}" maxlength="20" placeholder="访客名称">
    </div>
    <div class="field">
      <label>访客生平（3000 字内）</label>
      <textarea class="textarea" id="editchar-bio" maxlength="3000" placeholder="介绍一下 TA 吧…">${escapeHtml(c.bio || '')}</textarea>
    </div>
    <div class="field">
      <label>个性签名</label>
      <input class="input" id="editchar-sign" value="${escapeHtml(c.sign || '')}" maxlength="50" placeholder="TA 的个性签名（留空则自动从字卡库抽一条）">
    </div>
    <div class="field">
      <label>TA 对你的昵称（最多 5 个，聊天中 TA 会用）</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;" id="editchar-nicks"></div>
      <div style="display:flex;gap:8px;">
        <input class="input" id="editchar-nick-input" maxlength="10" placeholder="输入昵称（10 字内）" style="flex:1;">
        <button class="btn" id="editchar-nick-add" style="flex-shrink:0;">添加</button>
      </div>
    </div>
    <button class="btn primary block" id="editchar-save">保存</button>
  `);
  $('#editchar-close').onclick = closeModal;
  // 20260929ah：角色对玩家的昵称（chips 编辑，最多 5 个）
  let _nickList = Array.isArray(c.playerNicknames) ? c.playerNicknames.slice(0, 5) : [];
  const renderNicks = () => {
    const box = $('#editchar-nicks');
    if (!box) return;
    box.innerHTML = _nickList.length
      ? _nickList.map((n, i) => `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-elevated-2);border:1px solid var(--border);border-radius:14px;padding:4px 10px;font-size:13px;">${escapeHtml(n)}<button data-nickdel="${i}" style="border:none;background:none;color:var(--text-tertiary);cursor:pointer;font-size:13px;padding:0;">✕</button></span>`).join('')
      : '<span style="font-size:12px;color:var(--text-tertiary);">还没有昵称，TA 会用默认称呼叫你</span>';
    box.querySelectorAll('[data-nickdel]').forEach(b => {
      b.onclick = () => { _nickList.splice(parseInt(b.dataset.nickdel, 10), 1); renderNicks(); };
    });
  };
  renderNicks();
  const addNick = () => {
    const inp = $('#editchar-nick-input');
    const v = (inp.value || '').trim();
    if (!v) return;
    if (_nickList.length >= 5) { miniToast('最多 5 个昵称'); return; }
    if (_nickList.includes(v)) { miniToast('这个昵称已经有了'); return; }
    _nickList.push(v);
    inp.value = '';
    renderNicks();
  };
  $('#editchar-nick-add').onclick = addNick;
  $('#editchar-nick-input').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addNick(); } };
  let newAvatar = c.avatar || '';
  $('#editchar-avatar-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      // 20260929bn：访客头像方形裁剪后再用
      const cropped = await openImageCropper(file, { aspect: 1, maxEdge: 360, quality: 0.8 });
      if (!cropped) return;
      newAvatar = cropped;
      $('#editchar-avatar-preview').innerHTML = `<img src="${imgSrc(newAvatar)}">`;
    }
  };
  $('#editchar-save').onclick = async () => {
    const name = $('#editchar-name').value.trim();
    if (!name) { miniToast('访客名称不能为空'); return; }
    c.name = name;
    c.bio = $('#editchar-bio').value.trim();
    c.avatar = newAvatar;
    c.playerNicknames = _nickList.slice(0, 5); // 20260929ah：角色对玩家的昵称（最多 5 个）
    const newSign = $('#editchar-sign').value.trim();
    if (newSign && newSign !== c.sign) {
      // 手动改签名：立即生效，并重置自动刷新倒计时（5~7 天后再次自动刷新）
      c.sign = newSign;
      c.signAt = Date.now();
      c.signNext = Date.now() + randInt(5, 7) * 86400000;
    }
    await saveChar(c);
    if (currentCharId === c.id) {
      $('#chat-name').textContent = c.name;
      $('#chat-avatar').innerHTML = c.avatar ? `<img src="${imgSrc(c.avatar)}">` : (c.name[0] || '?');
    }
    renderChatList();
    miniToast('访客资料已保存');
    closeModal();
  };
}

/* 表情包管理（主页入口，5.10） */
function showEmojiManagerModal() {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">表情包管理</div>
      <button class="icon-btn" id="emo-close">✕</button>
    </div>
    <div id="emo-list" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;max-height:260px;overflow-y:auto;margin-bottom:14px;"></div>
    <label class="btn primary block" for="emo-file" style="cursor:pointer;justify-content:center;">＋ 添加表情包（上限 300 张）</label>
    <input type="file" id="emo-file" accept="image/*" multiple style="display:none;">
  `);
  $('#emo-close').onclick = closeModal;
  const renderList = async () => {
    const emojis = await getEmojis();
    $('#emo-list').innerHTML = emojis.length
      ? emojis.map(e => `<div class="emoji-cell"><img src="${imgSrc(e.img || e.data)}"><button class="emoji-del" style="display:block;" data-del="${e.id}">✕</button></div>`).join('')
      : '<div class="emoji-empty" style="grid-column:1/-1;">还没有表情包</div>';
    $('#emo-list').querySelectorAll('[data-del]').forEach(el => {
      el.onclick = async (ev) => {
        ev.stopPropagation();
        await idbDelete('emojis', el.dataset.del);
        renderList();
      };
    });
  };
  renderList();
  $('#emo-file').onchange = async () => {
    if ($('#emo-file').files.length) {
      await addEmojiFiles($('#emo-file').files);
      renderList();
    }
    $('#emo-file').value = '';
  };
}

/* ---------- 访客个人主页（弹窗，参考图风格布局：顶部背景+居中头像+功能行） ---------- */
async function showCharProfile(charId = null) {
  if (charId && typeof charId !== 'string') charId = null; // 防御：误传 Event 对象时回退当前角色
  const c = characters.find(x => x.id === (charId || currentCharId));
  if (!c) return;
  _charProfileActive = c;
  const isDaily = (await getSetting('dailyCharId', null)) === c.id;
  // 心念角色 = 弹卡纪念日角色（dailyAnnivCharId）
  const isHeart = (await getSetting('dailyAnnivCharId', null)) === c.id;
  const banWords = c.banWords || [];
  const bannedGroups = (c.bannedGroups || []).length;
  const relation = c.relation || '无';
  const charSign = ensureCharSign(c); // 个性签名（每5~7天自动刷新：自考抽字卡 / AI 生成）
  const remindMoments = c.remindMoments !== false; // 朋友圈提醒默认开
  const funcs = [
    { id: 'btn-edit-char', label: '编辑访客资料', arrow: true },
    { id: 'btn-set-daily', label: '设为入梦签访客', note: isDaily ? '✓ 已设置' : '' },
    { id: 'btn-set-heart', label: '设为心念访客', note: isHeart ? '✓ 已设置' : '' },
    { id: 'btn-set-relation', label: '设置关系网', note: relation },
    { id: 'btn-moments-settings', label: '朋友圈设置', note: `${remindMoments ? '提醒开' : '提醒关'} · 每日${charMomentLimit(c)}条`, arrow: true },
    { id: 'btn-char-theme', label: '聊天背景图', note: c.chatBg ? '已设置' : '' },
    { id: 'btn-char-emoji', label: 'TA 的表情包库', note: `${(c.emojis || []).length} 张`, arrow: true },
    { id: 'btn-char-diary', label: '我们的日记', note: '', arrow: true },
    { id: 'btn-char-chatset', label: '聊天设置', note: '', arrow: true },
    { id: 'btn-banwords', label: '访客禁词', note: `${banWords.length} 个词${bannedGroups ? ' · ' + bannedGroups + ' 个分组' : ''}` },
    { id: 'btn-clear-chat', label: '清除聊天记录', arrow: true },
  ];
  openModal(`
    <div class="charprofile">
      <div class="cp-hero">
        <button class="icon-btn cp-close" id="btn-profile-close">${icon('close', 18)}</button>
        <div class="cp-hero-bg" style="${c.profileBg ? `background:url(&quot;${imgSrc(c.profileBg)}&quot;) center/cover;` : ''}"></div>
        <label class="cp-bg-change" for="cp-bg-input" title="更换访客主页背景">${icon('camera', 14)} 背景</label>
        <input type="file" id="cp-bg-input" accept="image/*" style="display:none;">
        <div class="cp-avatar">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
      </div>
      <div class="cp-info">
        <div class="cp-name">${escapeHtml(c.name)}</div>
        <div class="cp-sign">${escapeHtml(charSign || '')}</div>
        ${c.bio ? `<div class="cp-bio">${escapeHtml(c.bio)}</div>` : ''}
        <div class="cp-chips">
          <span class="chip">💰 ¥${c.wallet ?? 100000}</span>
          <span class="chip ghost">关系：${escapeHtml(relation)}</span>
        </div>
        <div class="cp-funcs">
          ${funcs.map(f => `
            <button class="func-row" id="${f.id}">
              <span class="func-label">${f.label}</span>
              ${f.note ? `<span class="func-note">${escapeHtml(f.note)}</span>` : ''}
              ${f.arrow ? '<span class="func-arrow">›</span>' : ''}
            </button>
          `).join('')}
          <button class="func-row danger" id="btn-delete-char">
            <span class="func-label">删除访客</span><span class="func-arrow">›</span>
          </button>
        </div>
      </div>
    </div>
  `);

  $('#btn-profile-close').onclick = () => { _charProfileActive = null; closeModal(); };
  // 访客主页背景图上传
  $('#cp-bg-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    // 20260929ax：先裁剪再应用——比例取访客主页头图实际宽高，所见即所得
    const heroEl = document.querySelector('.cp-hero');
    const heroAspect = heroEl && heroEl.clientHeight > 40 ? heroEl.clientWidth / heroEl.clientHeight : 0;
    const cropped = await openImageCropper(file, { aspect: heroAspect });
    if (!cropped) return;
    c.profileBg = cropped;
    await saveChar(c);
    miniToast('访客主页背景已更新');
    showCharProfile();
  };
  $('#btn-edit-char').onclick = () => showEditCharModal(c);
  $('#btn-set-daily').onclick = async () => {
    await setSetting('dailyCharId', c.id);
    showCharProfile();
  };
  $('#btn-set-heart').onclick = async () => {
    // 心念角色 = 弹卡纪念日角色：点击即切换该访客为弹卡纪念日对象（再点取消）
    const cur = await getSetting('dailyAnnivCharId', null);
    heartCharId = (cur === c.id) ? null : c.id;
    await setSetting('heartCharId', heartCharId);
    await setSetting('dailyAnnivCharId', heartCharId);
    showCharProfile();
  };
  $('#btn-set-relation').onclick = () => showRelationModal(c);
  // 朋友圈设置（合并入口：消息提醒 / 不看TA / 不让TA看我的 / 每日上限）
  $('#btn-moments-settings').onclick = () => showCharMomentsSettingsModal(c);
  $('#btn-banwords').onclick = () => showBanWordsModal(c);
  $('#btn-char-theme').onclick = () => showCharThemeModal(c);
  $('#btn-char-emoji').onclick = () => showCharEmojiModal(c);
  $('#btn-char-diary').onclick = () => showCharDiaryModal(c);
  $('#btn-char-chatset').onclick = () => showCharChatSettingsModal(c);
  $('#btn-clear-chat').onclick = () => {
    showConfirm(`确定清除与「${c.name}」的所有聊天记录吗？此操作无法撤销。`, async () => {
      const msgs = await idbGetMessagesByChar(c.id, 100000);
      for (const m of msgs) await idbDelete('messages', m.id);
      closeModal();
      await renderMessages(c.id);
    });
  };
  $('#btn-delete-char').onclick = () => {
    showDeleteCharModal(c.id);
  };
}

/* 删除访客弹窗（4.5：询问是否同时删除该访客所有数据） */
function showDeleteCharModal(charId) {
  const c = characters.find(x => x.id === charId);
  if (!c) return;
  openModal(`
    <div style="text-align:center;margin-bottom:8px;">
      <div style="font-size:40px;margin-bottom:10px;">⚠️</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:4px;">删除「${escapeHtml(c.name)}」</div>
      <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:14px;">此操作无法撤销，请选择要删除的范围</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
      ${[
        { k: 'chat', label: '聊天记录' },
        { k: 'moments', label: '朋友圈内容' },
        { k: 'wallet', label: '钱包余额' },
        { k: 'relation', label: '关系网' },
        { k: 'memory', label: '记忆宫殿文件夹' },
        { k: 'survey', label: '问卷数据' },
      ].map((it, i) => `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;">
          <input type="checkbox" class="del-scope" data-k="${it.k}" ${i === 0 ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
          <span style="font-size:14px;">${it.label}</span>
        </label>
      `).join('')}
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="del-cancel">取消</button>
      <button class="btn danger" style="flex:1;" id="del-confirm">确定删除</button>
    </div>
  `);
  $('#del-cancel').onclick = closeModal;
  $('#del-confirm').onclick = async () => {
    const scopes = new Set();
    document.querySelectorAll('.del-scope:checked').forEach(el => scopes.add(el.dataset.k));
    forceCloseModal();
    await deleteCharacter(c.id, scopes);
    if (currentCharId === c.id) { currentCharId = null; switchView('chatlist'); }
    renderChatList();
  };
}

/* 保存角色（更新字段） */
async function saveChar(c) {
  await idbPut('characters', c);
  await refreshCharacters();
}

/* 朋友圈设置（合并入口：消息提醒 / 不看TA / 不让TA看我的 / 每日上限） */
function showCharMomentsSettingsModal(c) {
  const remind = c.remindMoments !== false;
  const blocked = !!c.momentsBlocked;
  const cantSee = !!c.cantSeeMyMoments;
  const limit = charMomentLimit(c);
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div style="font-size:18px;font-weight:600;">朋友圈设置</div>
      <button class="icon-btn" id="mos-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:14px;">针对「${escapeHtml(c.name)}」的朋友圈相关设置</div>

    <label class="field" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
      <span style="font-size:14px;font-weight:500;">朋友圈消息提醒</span>
      <input type="checkbox" id="mos-remind" ${remind ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
    </label>
    <div style="font-size:11.5px;color:var(--text-tertiary);margin:-6px 0 12px;">TA 发朋友圈时通知你（含后台挂机）</div>

    <label class="field" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
      <span style="font-size:14px;font-weight:500;">不看 TA 的朋友圈</span>
      <input type="checkbox" id="mos-block" ${blocked ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
    </label>
    <div style="font-size:11.5px;color:var(--text-tertiary);margin:-6px 0 12px;">屏蔽后你的朋友圈里不显示 TA 的动态，TA 也不再来互动你的帖子</div>

    <label class="field" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
      <span style="font-size:14px;font-weight:500;">不让 TA 看我的朋友圈</span>
      <input type="checkbox" id="mos-cantsee" ${cantSee ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
    </label>
    <div style="font-size:11.5px;color:var(--text-tertiary);margin:-6px 0 12px;">开启后该访客看不到、也不评论/点赞你的朋友圈</div>

    <div class="field">
      <label>朋友圈每日上限（0～5，默认 2）</label>
      <input class="input" type="number" id="mos-limit" min="0" max="5" value="${limit}">
    </div>

    <button class="btn primary block" id="mos-save">保存</button>
  `);
  $('#mos-close').onclick = closeModal;
  $('#mos-save').onclick = async () => {
    c.remindMoments = $('#mos-remind').checked;
    c.momentsBlocked = $('#mos-block').checked;
    c.cantSeeMyMoments = $('#mos-cantsee').checked;
    let v = parseInt($('#mos-limit').value, 10);
    if (isNaN(v)) v = 2;
    c.momentsDailyLimit = Math.min(5, Math.max(0, v));
    c.momentsPlan = null; // 让明天的计划按新上限重新生成
    await saveChar(c);
    miniToast('朋友圈设置已保存');
    showCharProfile();
  };
}

/* 设置关系网（与玩家的关系 + 与其他访客的关系） */
const RELATION_TYPES = ['无', '朋友', '恋人', '家人', '同事', '陌生人', '宿敌', '仇人', '厌恶'];

function showRelationModal(c) {
  const peers = characters.filter(x => x.id !== c.id);
  const peerRels = c.peerRelations || {};
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">设置关系网</div>
      <button class="icon-btn" id="relation-close">✕</button>
    </div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">你和「${escapeHtml(c.name)}」的关系</div>
    <div style="color:var(--text-secondary);font-size:12px;margin-bottom:10px;">关系类型会影响 TA 对你的回复语气</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;" id="rel-self-group">
      ${RELATION_TYPES.map(r => `
        <button class="btn rel-self-opt" data-r="${r}" style="${r === (c.relation || '无') ? 'background:var(--purple);color:#141019;' : ''}">${r}</button>
      `).join('')}
    </div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">「${escapeHtml(c.name)}」与其他访客的关系</div>
    <div style="color:var(--text-secondary);font-size:12px;margin-bottom:10px;">设定访客之间的羁绊，让群聊和互动更真实</div>
    <div id="rel-peer-group" style="margin-bottom:16px;">
      ${peers.length === 0
        ? '<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0;">还没有其他访客，先添加更多访客吧</div>'
        : peers.map(p => `
          <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);">
            <div class="avatar sm">${p.avatar ? `<img src="${imgSrc(p.avatar)}">` : (p.name[0] || '?')}</div>
            <div style="flex:1;min-width:0;font-size:14px;font-weight:600;">${escapeHtml(p.name)}</div>
            <select class="input rel-peer-sel" data-peer="${p.id}" style="width:auto;padding:6px 10px;font-size:13px;">
              ${RELATION_TYPES.map(r => `<option value="${r}" ${r === (peerRels[p.id] || '无') ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
        `).join('')}
    </div>

    <button class="btn primary block" id="relation-save">保存</button>
  `);

  // 与玩家的关系选择
  let selected = c.relation || '无';
  document.querySelectorAll('.rel-self-opt').forEach(el => {
    el.onclick = () => {
      selected = el.dataset.r;
      document.querySelectorAll('.rel-self-opt').forEach(x => { x.style.background = ''; x.style.color = ''; });
      el.style.background = 'var(--purple)';
      el.style.color = '#141019';
    };
  });

  $('#relation-close').onclick = closeModal;
  $('#relation-save').onclick = async () => {
    c.relation = selected;
    const newPeerRels = { ...peerRels };
    document.querySelectorAll('.rel-peer-sel').forEach(sel => {
      newPeerRels[sel.dataset.peer] = sel.value;
    });
    c.peerRelations = newPeerRels; // 单向：仅存本角色对他人的关系
    await saveChar(c);
    closeModal();
  };
}

/* 访客禁词管理（手动输入 + 从字卡总库勾选单条 + 直接勾选字卡文件夹整组禁用）
   修复：旧版每次交互都重渲染整个弹窗并从 c 读回旧值，导致整组禁用/单条勾选改动丢失、
   视觉堆叠、无法展开收起。改为：本地可变状态 + 就地更新 DOM，不再重渲染弹窗。 */
function showBanWordsModal(c) {
  // 本地可变状态（弹窗生命周期内唯一真相来源，关闭时才写回 c）
  const words = [...(c.banWords || [])];
  const bannedGroups = new Set(c.bannedGroups || []);
  const bannedGroupItems = { ...(c.bannedGroupItems || {}) };
  const fold = { ...(window._banFold || {}) };

  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">访客禁词</div>
      <button class="icon-btn" id="ban-close">✕</button>
    </div>
    <div style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">TA 回复、书信、入梦签等抽取字卡时，过滤禁词、禁用分组和勾选的单条字卡（入梦签同样只从 TA 可用的字卡里抽）</div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">已设禁词（<span id="ban-count">${words.length}</span>）</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;min-height:20px;" id="ban-list"></div>

    <div style="display:flex;gap:8px;margin-bottom:18px;">
      <input class="input" id="ban-input" placeholder="手动输入禁词" style="flex:1;">
      <button class="btn primary" id="ban-add">添加</button>
    </div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">从字卡库禁用（文件夹形式：可展开收起 / 整组禁用 / 单条勾选）</div>
    <div style="margin-bottom:16px;display:flex;flex-direction:column;gap:8px;" id="ban-groups"></div>

    <button class="btn primary block" id="ban-save">完成</button>
  `);

  /* —— 就地渲染函数（只更新对应容器，不重渲染弹窗） —— */

  // 已设禁词列表
  function renderList() {
    const el = $('#ban-list');
    el.innerHTML = words.map((w, i) => `<span class="badge" style="display:inline-flex;gap:4px;cursor:pointer;" data-bi="${i}">${escapeHtml(w)} ✕</span>`).join('');
    $('#ban-count').textContent = words.length;
    el.querySelectorAll('[data-bi]').forEach(b => {
      b.onclick = () => { words.splice(parseInt(b.dataset.bi), 1); renderList(); };
    });
  }

  // 分组区域（展开/收起、整组禁用勾选、单条勾选）
  // 渲染层防御：只渲染"有有效名字或有内容"的分组——名字是横线装饰（导入包的分隔行被
  // 解析成分组）视同无名；条目只渲染非空且非横线装饰的文本。就算数据里混进垃圾
  // 也不会再出现整排空条纹/通栏细线（数据源头已在 init/导入时净化过）
  const realGroups = () => (cards.customReplyGroups || []).filter(g => {
    if (!g || typeof g !== 'object' || !g.id) return false;
    const nameOk = typeof g.name === 'string' && g.name.trim() && !isLineJunkText(g.name);
    return nameOk || (g.items || []).some(t => typeof t === 'string' && t.trim() && !isLineJunkText(t));
  });  // 分组条目渲染过滤：非空文本 + 排除横线装饰条目
  const groupItems = (g) => (g.items || []).filter(t => typeof t === 'string' && t.trim() && !isLineJunkText(t));
  // 伪文件夹：未分组回复 / 寄语——字卡库里没有分组结构的内容，同样以文件夹形式整组禁用/单条勾选
  const POOL_FOLDERS = [
    { id: '__pool_replies__', name: '未分组回复', color: '#a78bfa', source: () => cards.customReplies || [] },
    { id: '__pool_mottos__', name: '寄语', color: '#f472b6', source: () => cards.customMottos || [] },
  ];
  const allBanFolders = () => [
    ...realGroups(),
    ...POOL_FOLDERS.map(p => ({ id: p.id, name: p.name, color: p.color, items: p.source() })),
  ];
  const findFolder = (gid) => allBanFolders().find(x => x.id === gid);
  function renderGroups() {
    const el = $('#ban-groups');
    const folders = allBanFolders();
    if (folders.length === 0) {
      el.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;">字卡库还没有内容可禁用</div>';
      return;
    }
    el.innerHTML = folders.map(g => {
      const on = bannedGroups.has(g.id);
      // 默认收起（与字卡库一致）：fold 未记录的分组一律折叠，只显示分组头；
      // 点开才渲染条目（且已过滤横线装饰），数据再多也不会满屏条目/横线
      const collapsed = fold[g.id] !== false;
      const items = groupItems(g);
      const itemBanned = bannedGroupItems[g.id] || [];
      // 名字兜底显示：横线名/空名分组（导入包分隔行产物，数据保留）一律显示"未命名分组"，
      // 不再把"────"渲染出来变成通栏横线
      const gName = (typeof g.name === 'string' && g.name.trim() && !isLineJunkText(g.name)) ? g.name : '未命名分组';
      const head = `
        <div class="ban-ghead" data-bgid="${g.id}" style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;">
          <div class="ban-gcheck" style="width:20px;height:20px;border-radius:6px;border:2px solid ${on ? 'var(--purple)' : 'var(--text-tertiary)'};display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;${on ? 'background:var(--purple);color:#141019;' : ''}">${on ? '✓' : ''}</div>
          <span class="ban-garrow" style="color:var(--text-tertiary);font-size:12px;transition:transform .15s;">${collapsed ? '▸' : '▾'}</span>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.color};margin-right:2px;flex-shrink:0;"></span>
          <div style="flex:1;font-size:13px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(gName)}</div>
          <div style="font-size:12px;color:var(--text-tertiary);flex-shrink:0;">${items.length} 条${itemBanned.length ? ` · 禁用 ${itemBanned.length}` : ''}</div>
        </div>`;
      let body = '';
      if (!collapsed) {
        body = `<div class="ban-gbody" style="padding:6px 12px 10px 44px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--border);">
          ${items.length === 0 ? '<span style="color:var(--text-tertiary);font-size:12px;">（空分组）</span>' : items.map((t, ii) => {
            const checked = itemBanned.includes(t);
            return `<span class="badge ban-gitem" data-bgid="${g.id}" data-bt="${ii}" title="${escapeHtml(t)}" style="cursor:pointer;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;${checked ? 'background:var(--purple);color:#141019;' : ''}">${escapeHtml(cardBrief(t))}</span>`;
          }).join('')}
        </div>`;
      }
      return `<div class="ban-gwrap" data-bgid="${g.id}" style="border:1px solid ${on ? 'var(--purple)' : 'var(--border)'};border-radius:12px;overflow:hidden;${on ? 'background:var(--purple-dim);' : ''}">${head}${body}</div>`;
    }).join('');

    // 分组头点击：点勾选框整组禁用；点其它区域展开/收起
    el.querySelectorAll('.ban-ghead').forEach(h => {
      h.onclick = (ev) => {
        const gid = h.dataset.bgid;
        if (ev.target.closest('.ban-gcheck')) {
          bannedGroups.has(gid) ? bannedGroups.delete(gid) : bannedGroups.add(gid);
          renderGroups();
          return;
        }
        fold[gid] = !fold[gid];
        renderGroups();
      };
    });
    // 分组内单条勾选（data-bt 是"过滤后条目列表"的下标，值以实际文本为准）
    el.querySelectorAll('.ban-gitem').forEach(it => {
      it.onclick = () => {
        const gid = it.dataset.bgid;
        const g = findFolder(gid);
        const t = groupItems(g || {})[parseInt(it.dataset.bt)];
        if (t == null) return;
        const arr = bannedGroupItems[gid] = bannedGroupItems[gid] || [];
        if (arr.includes(t)) bannedGroupItems[gid] = arr.filter(x => x !== t);
        else arr.push(t);
        renderGroups();
      };
    });
  }

  renderList();
  renderGroups();

  // 关闭：把本地状态写回 c（点 ✕ 也保存，符合直觉）
  const commit = async (toast) => {
    c.banWords = words;
    c.bannedGroups = [...bannedGroups];
    c.bannedGroupItems = bannedGroupItems;
    window._banFold = fold;
    await saveChar(c);
    if (toast) miniToast('禁词已保存');
    closeModal();
  };

  $('#ban-close').onclick = () => commit(false);
  $('#ban-add').onclick = () => {
    const v = $('#ban-input').value.trim();
    if (v && !words.includes(v)) { words.push(v); $('#ban-input').value = ''; renderList(); }
  };
  $('#ban-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#ban-add').click();
  });
  $('#ban-save').onclick = () => commit(true);
}

/* 关系网总览（交互式：先选角色 → 查看/直接修改 TA 与玩家、与其他所有访客的关系） */
async function showRelationsModal(selectedId = null) {
  /* 第一步：可交互的访客列表（分组可折叠 + 批量管理可勾选/整组勾选/删除） */
  if (!selectedId) {
    const relBatch = !!window._relBatch;
    const groupedIds = new Set(charGroups.flatMap(g => g.memberIds || []));
    const ungrouped = characters.filter(c => !groupedIds.has(c.id));

    // 渲染访客行：批量模式下显示勾选框，普通模式下点击进入
    const rowHtml = (c, extra = '') => `
      <div class="rel-pick" data-cid="${c.id}" style="display:flex;align-items:center;gap:12px;padding:11px 8px;border-bottom:1px solid var(--border);cursor:pointer;border-radius:10px;">
        ${relBatch ? `<div class="rel-check" data-chk="${c.id}" style="width:20px;height:20px;border-radius:50%;border:2px solid var(--text-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;color:#141019;flex-shrink:0;"></div>` : ''}
        <div class="avatar sm">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
        <div style="flex:1;min-width:0;font-size:15px;font-weight:600;">${escapeHtml(c.name)}</div>
        <span class="badge">与我：${escapeHtml(c.relation || '无')}</span>
        ${relBatch ? '' : '<span style="color:var(--text-tertiary);font-size:16px;">›</span>'}
        ${extra}
      </div>`;

    openModal(`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="font-size:18px;font-weight:600;">关系网</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn" style="padding:6px 12px;font-size:13px;" id="rel-groups">分组</button>
          <button class="btn" style="padding:6px 12px;font-size:13px;" id="rel-batch">${relBatch ? '退出批量' : '批量管理'}</button>
          <button class="icon-btn" id="rel-all-close">✕</button>
        </div>
      </div>
      <div style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">${relBatch ? '批量模式：勾选访客可删除；点击分组标题可整组勾选' : '点击任意访客，查看并直接修改 TA 与玩家、与其他所有访客的关系'}</div>
      ${characters.length === 0
        ? '<div style="color:var(--text-tertiary);text-align:center;padding:20px;">还没有访客，先添加一个访客吧</div>'
        : `
          ${charGroups.map((g, gi) => {
            const members = (g.memberIds || []).map(id => characters.find(x => x.id === id)).filter(Boolean);
            if (members.length === 0) return '';
            return `
            <div style="display:flex;align-items:center;gap:6px;padding:10px 2px 4px;cursor:pointer;" data-cg-fold="${gi}">
              ${relBatch ? `<span class="rel-gcheck" data-gchk="${gi}" style="width:18px;height:18px;border-radius:6px;border:2px solid var(--text-tertiary);display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#141019;flex-shrink:0;"></span>` : ''}
              <span style="color:var(--text-tertiary);font-size:12px;transition:transform .15s;">${g._collapsed ? '▸' : '▾'}</span>
              <span style="font-size:13px;font-weight:600;color:var(--text-secondary);">📁 ${escapeHtml(g.name)}（${members.length}）</span>
            </div>
            ${g._collapsed ? '' : members.map(c => rowHtml(c)).join('')}`;
          }).join('')}
          ${ungrouped.length > 0 ? `<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin:14px 0 6px;">未分组</div>` : ''}
          ${ungrouped.map(c => rowHtml(c)).join('')}
        `}
      ${relBatch ? `<div style="display:flex;gap:10px;margin-top:16px;"><button class="btn danger block" id="rel-batchdel">删除所选访客</button></div>` : ''}
    `);
    $('#rel-all-close').onclick = closeModal;
    $('#rel-groups').onclick = () => showCharGroupsModal();
    $('#rel-batch').onclick = () => { window._relBatch = !relBatch; showRelationsModal(null); };

    if (relBatch) {
      const sel = new Set();
      const refresh = () => {
        document.querySelectorAll('[data-chk]').forEach(el => {
          const on = sel.has(el.dataset.chk);
          el.style.background = on ? 'var(--purple)' : '';
          el.style.borderColor = on ? 'var(--purple)' : 'var(--text-tertiary)';
          el.textContent = on ? '✓' : '';
        });
        document.querySelectorAll('[data-gchk]').forEach(el => {
          const gi = parseInt(el.dataset.gchk);
          const g = charGroups[gi];
          const ids = (g.memberIds || []).filter(id => characters.some(x => x.id === id));
          const allOn = ids.length > 0 && ids.every(id => sel.has(id));
          el.style.background = allOn ? 'var(--purple)' : '';
          el.style.borderColor = allOn ? 'var(--purple)' : 'var(--text-tertiary)';
          el.textContent = allOn ? '✓' : '';
        });
      };
      document.querySelectorAll('[data-chk]').forEach(el => {
        el.onclick = (ev) => {
          ev.stopPropagation();
          sel.has(el.dataset.chk) ? sel.delete(el.dataset.chk) : sel.add(el.dataset.chk);
          refresh();
        };
      });
      document.querySelectorAll('[data-gchk]').forEach(el => {
        el.onclick = (ev) => {
          ev.stopPropagation();
          const gi = parseInt(el.dataset.gchk);
          const g = charGroups[gi];
          const ids = (g.memberIds || []).filter(id => characters.some(x => x.id === id));
          const allOn = ids.length > 0 && ids.every(id => sel.has(id));
          ids.forEach(id => allOn ? sel.delete(id) : sel.add(id));
          refresh();
        };
      });
      // 折叠标题（批量模式下点箭头/文字折叠，点勾选框勾选）
      document.querySelectorAll('[data-cg-fold]').forEach(el => {
        el.onclick = (ev) => {
          if (ev.target.closest('[data-gchk]')) return;
          const gi = parseInt(el.dataset.cgFold);
          charGroups[gi]._collapsed = !charGroups[gi]._collapsed;
          saveCharGroups().then(() => showRelationsModal(null));
        };
      });
      $('#rel-batchdel').onclick = () => {
        if (sel.size === 0) { miniToast('请先勾选访客'); return; }
        showConfirm(`确定删除选中的 ${sel.size} 个访客吗？此操作无法撤销。`, async () => {
          for (const id of sel) await deleteCharacter(id);
          window._relBatch = false;
          closeModal();
          renderChatList();
        });
      };
    } else {
      // 折叠标题（普通模式）
      document.querySelectorAll('[data-cg-fold]').forEach(el => {
        el.onclick = () => {
          const gi = parseInt(el.dataset.cgFold);
          charGroups[gi]._collapsed = !charGroups[gi]._collapsed;
          saveCharGroups().then(() => showRelationsModal(null));
        };
      });
      document.querySelectorAll('.rel-pick').forEach(el => {
        el.onclick = () => showRelationsModal(el.dataset.cid);
      });
    }
    return;
  }

  /* 第二步：该访客与所有人（玩家 + 其他访客）的关系，可就地修改 */
  const c = characters.find(x => x.id === selectedId);
  if (!c) { showRelationsModal(null); return; }
  const peers = characters.filter(x => x.id !== c.id);
  const peerRels = c.peerRelations || {};

  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:6px;min-width:0;">
        <button class="icon-btn" id="rel-back" style="font-size:22px;flex-shrink:0;">‹</button>
        <div style="font-size:18px;font-weight:600;">${escapeHtml(c.name)} 的关系网</div>
      </div>
      <button class="icon-btn" id="rel-all-close">✕</button>
    </div>

    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;">
      <div class="avatar">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : (c.name[0] || '?')}</div>
      <div style="flex:1;min-width:0;font-size:13px;color:var(--text-secondary);">${c.bio ? escapeHtml(c.bio) : ''}</div>
    </div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">与玩家（你）的关系 <span style="color:var(--text-tertiary);font-size:12px;font-weight:400;">点击即保存</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;">
      ${RELATION_TYPES.map(r => `
        <button class="btn rel-chip" data-r="${r}" style="padding:7px 14px;font-size:13px;${r === (c.relation || '无') ? 'background:var(--purple);color:#141019;' : ''}">${r}</button>
      `).join('')}
    </div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">与其他访客的关系 <span style="color:var(--text-tertiary);font-size:12px;font-weight:400;">下拉选择即保存</span></div>
    ${peers.length === 0
      ? '<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0;">还没有其他访客，先添加更多访客吧</div>'
      : peers.map(p => `
        <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);">
          <div class="avatar sm">${p.avatar ? `<img src="${imgSrc(p.avatar)}">` : (p.name[0] || '?')}</div>
          <div style="flex:1;min-width:0;font-size:14px;font-weight:600;">${escapeHtml(p.name)}</div>
          <select class="input rel-peer-sel" data-peer="${p.id}" style="width:auto;padding:6px 10px;font-size:13px;">
            ${RELATION_TYPES.map(r => `<option value="${r}" ${r === (peerRels[p.id] || '无') ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
      `).join('')}
  `);

  $('#rel-all-close').onclick = closeModal;
  $('#rel-back').onclick = () => showRelationsModal(null);

  // 与玩家的关系：点击即保存
  document.querySelectorAll('.rel-chip').forEach(el => {
    el.onclick = async () => {
      c.relation = el.dataset.r;
      await saveChar(c);
      miniToast('已更新与你的关系');
      showRelationsModal(c.id); // 刷新高亮
    };
  });

  // 与其他访客的关系：下拉即保存（单向，仅存本角色对他人的关系）
  document.querySelectorAll('.rel-peer-sel').forEach(sel => {
    sel.onchange = async () => {
      const pid = sel.dataset.peer;
      c.peerRelations = c.peerRelations || {};
      c.peerRelations[pid] = sel.value;
      await saveChar(c);
      miniToast('关系已更新（单向）');
    };
  });
}

/* ============================================================
   表情包系统（5.10：上传上限300张，压缩存储，面板发送）
   表情包与戳一戳是两个独立功能，各占一个按钮/面板
   ============================================================ */
let emojiManageMode = false;

async function getEmojis() {
  const list = await idbGetAll('emojis');
  // 20260929g：新记录存 img（Blob 描述符），旧记录字段是 data（base64 字符串）——
  // 统一映射为 img 供显示/发送使用，旧表情数据一字不动
  return list.map(e => ({ id: e.id, createdAt: e.createdAt, img: e.img || e.data || '' }));
}

/* 表情包面板（只显示"我的表情包"） */
async function renderEmojiGrid() {
  const grid = $('#emoji-grid');
  if (!grid) return;
  const emojis = await getEmojis();
  const countEl = $('#emoji-count');
  if (countEl) countEl.textContent = `${emojis.length}/300`;
  grid.classList.toggle('manage', emojiManageMode);
  grid.innerHTML = emojis.length
    ? emojis.map(e => `
      <div class="emoji-cell" data-eid="${e.id}">
        <img src="${imgSrc(e.img || e.data)}">
        <button class="emoji-del" data-del="${e.id}">✕</button>
      </div>`).join('')
    : `<div class="emoji-empty">还没有表情包<br><span style="font-size:12px;">点右上角「＋ 添加」上传（上限 300 张）</span></div>`;
  grid.querySelectorAll('.emoji-cell').forEach(el => {
    el.onclick = (ev) => {
      if (ev.target.classList.contains('emoji-del')) return;
      if (emojiManageMode) return;
      const id = el.dataset.eid;
      const emo = emojis.find(x => x.id === id);
      if (emo) { closeModalPanels(); sendEmojiMessage(emo.img); }
    };
  });
  grid.querySelectorAll('[data-del]').forEach(el => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      await idbDelete('emojis', el.dataset.del);
      renderEmojiGrid();
    };
  });
}

/* Emoji 库（20260929ah）：表情包功能的独立分类，系统自带 emoji 直接点选发送 */
const EMOJI_LIB = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
  '😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐',
  '🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒',
  '🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁',
  '😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞',
  '😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👻','👽','🤖',
  '😍‍😍','💋','💌','💘','💝','💖','💗','💓','💞','💕','❤️','🧡','💛','💚','💙','💜',
  '🤍','🤎','💔','❣️','💕','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌚','🌙','⭐',
  '✨','💫','⚡','🔥','🌈','☀️','⛅','🌧️','❄️','🌊','🎁','🎈','🎉','🎊','🎆','🎇',
  '🍰','🎂','🍫','🍬','🍭','☕','🍵','🧋','🍺','🍷','🥂','🍕','🍔','🍜','🍣','🍎',
  '🐱','🐶','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🦄',
  '🌼','🍀','🌱','🌿','🦋','🐢','🐬','🐳','🦈','🐘','🦒','🦌','🐇','🦝','🦉','🦇',
];
/* 微软 Fluent 表情图（20260929at）：img/emoji/<unicode码点>.png（128px，本地零联网），
   EMOJI_IMG_SET 由 js/emoji-img.js 自动生成（有本地图的字符清单）；
   命中返回 <img>，未命中返回 ''（调用方回退系统字体文字）。
   20260929aw：目录改名 img/emojis→img/emoji + URL 追加 ?v=EMOJI_VER——
   彻底绕开浏览器对同名旧图（3D 时期）的启发式缓存，保证永远是最新扁平风格 */
function emojiImgOf(e, cls) {
  const s = String(e || '');
  if (!s || !window.EMOJI_IMG_SET || !window.EMOJI_IMG_SET.has(s)) return '';
  const code = [...s].map(c => c.codePointAt(0).toString(16)).join('-');
  const ver = window.EMOJI_VER || '1';
  return `<img class="${cls || 'emoji-img'}" src="img/emoji/${code}.png?v=${ver}" alt="${escapeHtml(s)}" loading="lazy" draggable="false">`;
}
function renderEmojiLib() {
  const grid = $('#emojilib-grid');
  if (!grid) return;
  grid.innerHTML = EMOJI_LIB.map(e => {
    const img = emojiImgOf(e, 'emoji-lib-img');
    return `<div class="emoji-cell emojilib-cell" data-libe="${escapeHtml(e)}">${img || `<span style="font-size:21px;line-height:1;">${escapeHtml(e)}</span>`}</div>`;
  }).join('');
  grid.querySelectorAll('[data-libe]').forEach(el => {
    el.onclick = () => { closeModalPanels(); sendEmojiLibText(el.dataset.libe); };
  });
}
/* 发送 Emoji（当普通文本消息发出，角色照常回复） */
async function sendEmojiLibText(e) {
  if (!e) return;
  if (currentGroupId) {
    const myMsg = { id: uid('msg'), groupId: currentGroupId, from: 'me', type: 'text', content: e, time: Date.now() };
    await idbPut('messages', myMsg);
    appendGroupMessage(myMsg);
    const g = chatGroups.find(x => x.id === currentGroupId);
    if (g) startGroupChain(g, { source: 'player' }); // az：接龙回复
    return;
  }
  if (!currentCharId) return;
  await sendRawText(e);
}

/* 戳一戳面板（聊天页 + 面板，玩家使用）：文案来自「玩家戳一戳」独立库（初始为空，
   与角色用的 customPokes 分开），发送后在聊天页中间独立展示「你 + 文案」 */
function renderPokeList() {
  const list = $('#poke-list');
  if (!list) return;
  const pokes = cards.customPlayerPokes || [];
  list.innerHTML = pokes.length
    ? pokes.map((p, i) => `<div class="poke-item" data-poke="${i}">${escapeHtml(p)}</div>`).join('')
    : '<div class="emoji-empty">玩家戳一戳库还是空的<br><span style="font-size:12px;">点右上角「＋ 添加戳一戳」直接加几条吧<br>发送后显示为：你 + 文案（可用 TA 指代访客）</span></div>';
  list.querySelectorAll('[data-poke]').forEach(el => {
    el.onclick = () => {
      const p = pokes[parseInt(el.dataset.poke)];
      closeModalPanels();
      sendPlayerPoke(p);
    };
  });
}

/* 20260929ba：玩家戳一戳添加窗口（面板内直接加文案，不用绕去字卡库；
   弹窗关闭后面板保持打开 = 子功能回上一界面） */
function showPlayerPokeAddModal() {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">添加戳一戳文案</div>
      <button class="icon-btn" id="pokeadd-close">✕</button>
    </div>
    <div class="field">
      <label>文案（用 TA 指代访客，每行一条，最多一次加 20 条）</label>
      <textarea class="textarea" id="pokeadd-text" rows="5" maxlength="600" placeholder="戳了一下 TA 的脑袋&#10;朝 TA 挥了挥手"></textarea>
    </div>
    <button class="btn primary block" id="pokeadd-go">添加</button>
  `);
  $('#pokeadd-close').onclick = closeModal;
  $('#pokeadd-go').onclick = async () => {
    const lines = $('#pokeadd-text').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 20);
    if (!lines.length) { miniToast('先写点文案吧'); return; }
    const cur = cards.customPlayerPokes || [];
    const exist = new Set(cur.map(t => String(t).trim()));
    let added = 0;
    for (const t of lines) { if (!exist.has(t)) { cur.push(t); exist.add(t); added++; } }
    cards.customPlayerPokes = cur;
    await saveCards(cards);
    renderPokeList();
    miniToast(added > 0 ? `已添加 ${added} 条戳一戳` : '没有新增（重复的已跳过）');
    closeModal();
  };
}

/* 20260929ah：GIF 原样入库为 Blob 描述符——canvas 重绘会丢掉动画帧，
   所以 gif 不压缩（8MB 上限），只取自然宽高供布局使用 */
function gifBlobDesc(f) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { resolve({ blob: f, thumb: f, w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(url); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('GIF 解析失败')); };
    im.src = url;
  });
}

async function addEmojiFiles(files) {
  try {
    const emojis = await getEmojis();
    const remain = 300 - emojis.length; // 5.10：上限 300 张
    if (remain <= 0) { miniToast('表情包已满 300 张，请先删除部分'); return; }
    const list = [...files].slice(0, remain);
    if (files.length > remain) miniToast(`最多还能添加 ${remain} 张，已自动截取`);
    let ok = 0, fail = 0;
    for (const f of list) {
      try {
        let img;
        if (f.type === 'image/gif' || /\.gif$/i.test(f.name)) {
          // 20260929ah：gif 兼容——保留动画原样存（8MB 上限）
          if (f.size > 8 * 1024 * 1024) { fail++; miniToast('GIF 超过 8MB，已跳过'); continue; }
          img = await gifBlobDesc(f);
        } else {
          // 表情包保留透明（png），压缩至 240px；20260929g 存 Blob 描述符（img 字段）
          img = await compressImage(f, 240, 0.85, true);
        }
        await idbPut('emojis', { id: uid('emoji'), img, createdAt: Date.now() });
        ok++;
      } catch (e) {
        fail++;
      }
    }
    renderEmojiGrid();
    if (fail === 0) miniToast(`已添加 ${ok} 张表情包`);
    else if (ok > 0) miniToast(`已添加 ${ok} 张，${fail} 张失败`);
    else miniToast(`添加失败，请检查图片格式`);
  } catch (e) {
    miniToast('添加失败：' + (e && e.message ? e.message : '未知错误'));
  }
}

/* 发送表情包消息 */
async function sendEmojiMessage(dataUrl) {
  if (currentGroupId) {
    const myMsg = { id: uid('msg'), groupId: currentGroupId, from: 'me', type: 'emoji', content: dataUrl, time: Date.now() };
    await idbPut('messages', myMsg);
    appendGroupMessage(myMsg);
    return;
  }
  if (!currentCharId) return;
  const myMsg = { id: uid('msg'), charId: currentCharId, from: 'me', type: 'emoji', content: dataUrl, time: Date.now() };
  await idbPut('messages', myMsg);
  appendMessage(myMsg);
  await scheduleCharReply(currentCharId);
}

/* 发送纯文本（等价于玩家正常输入） */
async function sendRawText(text) {
  if (!currentCharId || !text) return;
  const myMsg = { id: uid('msg'), charId: currentCharId, from: 'me', type: 'text', content: text, time: Date.now() };
  await idbPut('messages', myMsg);
  appendMessage(myMsg);
  await scheduleCharReply(currentCharId);
}

/* ============ 戳一戳（独立于气泡：聊天页中间展示，带昵称） ============ */

/* 戳一戳触发概率（聊天设置三档：off 关 / mid 偶尔 10% / often 经常 25%） */
function charPokeChance(mode) {
  return mode === 'off' ? 0 : (mode === 'often' ? 0.25 : 0.10);
}

/* 玩家戳角色：从「玩家戳一戳」库抽文案，聊天页中间展示「你 + 文案」 */
async function sendPlayerPoke(text) {
  if (currentGroupId) { miniToast('戳一戳暂时只在单聊里玩'); return; }
  if (!currentCharId || !text) return;
  const myMsg = { id: uid('msg'), charId: currentCharId, from: 'me', type: 'poke', content: text, time: Date.now() };
  await idbPut('messages', myMsg);
  appendMessage(myMsg);
  renderChatList();
}

/* 角色戳玩家：AI 模式下由 AI 生成戳一戳文案（失败回退字卡库），
   字卡模式从「访客戳一戳」库抽文案；都过滤该访客禁词；展示「访客名 + 文案」 */
async function sendCharPoke(c) {
  if (!c) return;
  let text = '';
  // 20260929ah：AI 模式也可触发戳一戳——文案由 AI 生成（轻量 prompt，失败静默回字卡）
  try {
    if (await isAIMode()) {
      const cfg = await loadAIConfig();
      if (cfg.chatApi && cfg.chatApi.url) {
        const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
          { role: 'system', content: `你是角色扮演 AI（扮演${c.name}）。请以角色的口吻"戳一戳"玩家：输出一句 20 字内的俏皮短句，可用「TA」指代玩家，不要跳出角色，不要标点结尾，不要任何解释。` },
          { role: 'user', content: '戳一戳玩家。' },
        ], { temperature: 1.0 });
        if (r.ok && r.text) text = r.text.trim().slice(0, 40);
      }
    }
  } catch (e) {}
  if (!text) {
    const pool = (cards.customPokes || []).filter(t =>
      !(getCharBanWords(c) || []).some(b => b && t.includes(b)));
    if (!pool.length) return;
    text = drawFrom(pool);
  }
  const m = { id: uid('msg'), charId: c.id, from: 'them', type: 'poke', content: text, time: Date.now() };
  await idbPut('messages', m);
  if (currentCharId === c.id && document.body.dataset.view === 'chat') {
    appendMessage(m);
  } else {
    renderChatList();
  }
}

/* 角色发消息后随机附带一次戳一戳（延迟 0.8~2.5 秒，像顺手戳了一下）
   20260929ah：AI 模式不再停用——两种模式都按概率触发，AI 模式文案由 AI 生成 */
async function maybeCharPoke(c) {
  const cs = getCharChatSettings(c);
  const chance = charPokeChance(cs.charPoke ?? chatSettings.charPoke ?? 'mid');
  if (chance > 0 && Math.random() < chance) {
    setTimeout(() => sendCharPoke(c), 800 + Math.random() * 1700);
  }
}

/* ============================================================
   聊天底部功能面板（5.5：＋号展开）
   ============================================================ */
function buildPlusPanel() {
  const g0 = currentGroupId ? chatGroups.find(x => x.id === currentGroupId) : null;
  /* az 群聊模式（细则一.2）：消息型功能直达群内；交互型功能先选目标成员、
     再切到该成员单聊执行；群专属项（话题卡/群投票）只在群聊出现 */
  const pickThen = (title, groupFlow, singleFn) => async () => {
    if (!g0) return singleFn ? singleFn() : undefined;
    const m = await pickGroupMember(g0, title);
    if (!m) return;
    if (groupFlow) await groupFlow(g0, m);
    else { await openChat(m.id); if (singleFn) singleFn(); }
  };
  const items = g0 ? [
    { label: '上传图片', labelFor: 'plus-file-input', icon: 'image' }, // 群内直达
    { label: '表情包', icon: 'sticker', act: () => togglePanel('emoji-panel') }, // 群内直达
    { label: '决策币', icon: 'coin', act: pickThen('决策币 · 选一名成员主持', (g, m) => showGroupCoinModal(g, m)) },
    { label: '查岗', icon: 'checkin', act: pickThen('查岗 · 选择目标成员', null, () => showCheckinModal()) },
    { label: '群通话', icon: 'call', act: () => showGroupCallModal(g0) }, // ba：勾选多名成员发起群通话
    { label: '发红包', icon: 'redpacket', act: () => showGroupPacketModal(g0) }, // 群红包直达
    { label: '占卜', icon: 'divination', act: pickThen('占卜 · 选择解牌成员', null, () => showDivinationModal()) },
    { label: '记事簿', icon: 'note', act: () => showNotebookModal() },
    // 20260929be：群聊问卷改多选成员发起（书信项已从群聊功能栏移除）
    { label: '问卷', icon: 'checklist', act: () => showGroupSurveyModal(g0) },
    { label: '超频', icon: 'overclock', act: pickThen('超频 · 选择目标成员', null, () => showOverclockHub()), ocOnly: true },
    { label: '话题卡', icon: 'topic', act: () => showTopicModal(g0) },
    { label: '群投票', icon: 'vote', act: () => showGroupVoteModal(g0) },
  ] : [
    { label: '上传图片', labelFor: 'plus-file-input', icon: 'image' }, // label 原生触发，兼容沙箱/WebView
    { label: '表情包', icon: 'sticker', act: () => togglePanel('emoji-panel') },
    { label: '决策币', icon: 'coin', act: showCoinModal },
    { label: '查岗', icon: 'checkin', act: showCheckinModal },
    { label: '模拟通话', icon: 'call', act: showCallModal },
    { label: '发红包', icon: 'redpacket', act: showTransferModal },
    { label: '占卜', icon: 'divination', act: () => showDivinationModal() },
    { label: '记事簿', icon: 'note', act: () => showNotebookModal() },
    { label: '书信', icon: 'letter', act: () => showLetterComposeModal(), id: 'plus-item-letter' },
    { label: '问卷', icon: 'checklist', act: () => showSurveyHub() },
    { label: '超频', icon: 'overclock', act: () => showOverclockHub(), ocOnly: true },
  ];
  $('#plus-grid').innerHTML = items.map((it, i) => it.labelFor
    ? `<label class="panel-item" for="${it.labelFor}" data-plus="${i}">
        <div class="panel-icon">${icon(it.icon, 24)}</div>
        <div class="panel-label">${it.label}</div>
      </label>`
    : `<button class="panel-item" data-plus="${i}"${it.ocOnly ? ' data-oc-only="1"' : ''}${it.id ? ` id="${it.id}"` : ''}>
        <div class="panel-icon">${it.emoji ? it.emoji : icon(it.icon, 24)}</div>
        <div class="panel-label">${it.label}</div>
      </button>`).join('');
  // 书信入口红点（未读时显示）
  refreshUnreadBadges();
  // 超频入口：未解锁时隐藏（第三天首次动画后才出现）
  (async () => {
    const ocUnlocked = await isOverclockUnlocked();
    if (!ocUnlocked) {
      $$('#plus-grid [data-oc-only]').forEach(el => el.remove());
    }
  })();
  // 选择图片后关闭面板并发送（5.9：压缩后存本地）
  const inp = $('#plus-file-input');
  inp.onchange = () => {
    if (inp.files[0]) {
      closeModalPanels();
      sendImageMessage(inp.files[0]);
      inp.value = '';
    }
  };
  $$('#plus-grid [data-plus]').forEach(el => {
    if (el.tagName === 'LABEL') return; // label 原生打开文件选择，不需要 JS
    el.onclick = () => { closeModalPanels(); items[parseInt(el.dataset.plus)].act(); };
  });
}

function togglePanel(id) {
  const target = $('#' + id);
  const wasOpen = target.classList.contains('show');
  closeModalPanels();
  if (!wasOpen) {
    target.classList.add('show');
    if (id === 'emoji-panel') renderEmojiGrid();
    if (id === 'emoji-panel') renderPokeList();
  }
}
function closeModalPanels() {
  $$('.chat-panel').forEach(p => p.classList.remove('show'));
}

/* ---------- 决策币（5.12） ---------- */
/* 落地音效：短促的金属清脆声（WebAudio 合成，无需外部资源） */
/* 真实硬币落地音效：金属泛音脆响 + 桌面闷响 + 打转余韵
   真实硬币的泛音是不谐和的（非整数倍），叠 3 个偏离泛音更像金属 */
function playCoinLandSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    // 1) 金属脆响：三个不谐和泛音（硬币材质特征），快速起音、长衰减
    [[5230, 0.55, 0.16], [7890, 0.34, 0.09], [3140, 0.4, 0.11]].forEach(([f, dur, vol]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 0.982, t0 + dur); // 轻微下滑更真实
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    });

    // 2) 桌面闷响：短噪声脉冲（低通滤波），给"落在实体桌面"的质感
    const len = Math.floor(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 850;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.5, t0);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    src.connect(lp).connect(g2).connect(master);
    src.start(t0);

    // 3) 90ms 后轻微的第二次金属颤音（硬币落桌后打转的余韵，不是弹跳）
    [[5230, 0.3, 0.05], [7890, 0.2, 0.03]].forEach(([f, dur, vol], i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.01, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0 + 0.09);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.095);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09 + dur);
      o.connect(g).connect(master);
      o.start(t0 + 0.09);
      o.stop(t0 + 0.09 + dur + 0.05);
    });

    setTimeout(() => ctx.close(), 1200);
  } catch (e) { /* 静默 */ }
}

function showCoinModal() {
  openModal(`
    <div style="font-size:18px;font-weight:600;margin-bottom:16px;">决策币</div>
    <div class="field">
      <label>你要问的问题</label>
      <input class="input" id="coin-question" placeholder="例如：今天要早点睡觉吗？">
    </div>
    <div id="coin-stage">
      <div style="display:flex;gap:10px;">
        <button class="btn" style="flex:1;" id="coin-cancel">取消</button>
        <button class="btn primary" style="flex:1;" id="coin-start">开始</button>
      </div>
    </div>
  `);
  $('#coin-cancel').onclick = closeModal;
  $('#coin-start').onclick = () => {
    const q = $('#coin-question').value.trim();
    if (!q) { miniToast('先输入你的问题'); return; }
    // 两面风格化图标：正面「是」🌙（月）/ 背面「否」⭐（星）——白日梦一脉相承
    $('#coin-stage').innerHTML = `
      <div class="coin-scene">
        <div class="coin3d" id="coin-coin">
          <div class="coin-face coin-front">🌙<span>是</span></div>
          <div class="coin-face coin-back">⭐<span>否</span></div>
        </div>
      </div>`;
    // 第一阶段：旋转翻转（coinSpin 无限旋转）
    setTimeout(() => {
      const result = Math.random() < 0.5 ? '是' : '否';
      const coin = $('#coin-coin');
      if (coin) {
        // 第二阶段：弹起 → 落地（coinToss 动画，只弹一次），定格在结果面
        coin.classList.add('landing', result === '是' ? 'face-front' : 'face-back');
        // 落地音效：对准动画落地瞬间（coinToss 1.05s，落地在 ~0.9s 处）
        setTimeout(() => playCoinLandSound(), 880);
      }
      // 动画播完（约 1.15s）后替换为结果 UI
      setTimeout(() => {
        $('#coin-stage').innerHTML = `
          <div class="coin-scene">
            <div class="coin3d landed ${result === '是' ? 'face-front' : 'face-back'}">
              <div class="coin-face coin-front">🌙<span>是</span></div>
              <div class="coin-face coin-back">⭐<span>否</span></div>
            </div>
          </div>
          <div style="text-align:center;color:var(--text-secondary);font-size:13px;margin-bottom:12px;">「${escapeHtml(q)}」→ ${result}</div>
          <div style="display:flex;gap:10px;">
            <button class="btn" style="flex:1;" id="coin-cancel2">取消</button>
            <button class="btn primary" style="flex:1;" id="coin-send">发送</button>
          </div>`;
        $('#coin-cancel2').onclick = closeModal; // 取消不发，不做记录
        $('#coin-send').onclick = async () => {
          closeModal();
          if (!currentCharId) return;
          // 发送决策币结果卡片，相当于玩家正常输入一条消息
          const myMsg = { id: uid('msg'), charId: currentCharId, from: 'me', type: 'coin', content: { question: q, result }, time: Date.now() };
          await idbPut('messages', myMsg);
          appendMessage(myMsg);
          await scheduleCharReply(currentCharId);
        };
      }, 1150);
    }, 1300);
  };
}

/* ---------- 突击查岗（15.2 简版：卡片 + 角色抽 2~3 条字卡回复） ---------- */
function showCheckinModal() {
  openModal(`
    <div style="font-size:18px;font-weight:600;margin-bottom:16px;">突击查岗</div>
    <div class="field">
      <label>查岗文案（可编辑）</label>
      <input class="input" id="checkin-text" value="突击查岗！你现在在做什么！">
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="checkin-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="checkin-send">发送</button>
    </div>
  `);
  $('#checkin-cancel').onclick = closeModal;
  $('#checkin-send').onclick = async () => {
    const text = $('#checkin-text').value.trim() || '突击查岗！你现在在做什么！';
    closeModal();
    if (!currentCharId) return;
    const myMsg = { id: uid('msg'), charId: currentCharId, from: 'me', type: 'checkin', content: { text, replies: [] }, time: Date.now() };
    await idbPut('messages', myMsg);
    appendMessage(myMsg);
    // 角色抽 2~3 条字卡依次回复（15.1），每条都引用查岗卡片，并把回复内容写进查岗卡片
    const quote = { name: playerProfile.name || '我', content: text };
    const c = characters.find(x => x.id === currentCharId);
    const n = randInt(2, 3);
    for (let i = 0; i < n; i++) {
      const replyMsg = await scheduleCharReply(currentCharId, quote, { quick: true }); // 查岗汇报走快速节奏，反馈更及时
      if (replyMsg) {
        myMsg.content.replies = myMsg.content.replies || [];
        myMsg.content.replies.push({ who: c ? c.name : 'TA', text: replyMsg.content });
        await idbPut('messages', myMsg);
        // 就地刷新这条查岗卡片的回复展示
        refreshCheckinCardReplies(myMsg);
      }
    }
  };
}

/* 玩家回复角色发来的查岗卡片（15.2：输入框回复，引用该查岗卡片，作为一条消息发给角色） */
function openCheckinReplyModal(charId, checkinMsg = null) {
  const c = characters.find(x => x.id === charId);
  const checkinText = checkinMsg && checkinMsg.content && checkinMsg.content.text ? checkinMsg.content.text : '突击查岗';
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">回复查岗</div>
      <button class="icon-btn" id="ckr-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">「${escapeHtml(c ? c.name : 'TA')}」正在查岗，告诉 TA 你现在在做什么吧</div>
    <div class="field">
      <textarea class="textarea" id="ckr-input" placeholder="我现在在…" style="min-height:90px;"></textarea>
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="ckr-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="ckr-send">发送</button>
    </div>
  `);
  $('#ckr-close').onclick = closeModal;
  $('#ckr-cancel').onclick = closeModal;
  $('#ckr-send').onclick = async () => {
    const text = $('#ckr-input').value.trim();
    if (!text) { miniToast('请填写你的回复'); return; }
    closeModal();
    // 玩家的回复引用角色的查岗卡片，在聊天里可见地对应这次查岗
    const myMsg = { id: uid('msg'), charId, from: 'me', type: 'text', content: text, time: Date.now(), quote: { name: c ? c.name : 'TA', content: checkinText } };
    await idbPut('messages', myMsg);
    if (currentCharId === charId) appendMessage(myMsg);
    // 玩家回复也写进查岗卡片
    if (checkinMsg) {
      checkinMsg.content.replies = checkinMsg.content.replies || [];
      checkinMsg.content.replies.push({ who: playerProfile.name || '我', text });
      await idbPut('messages', checkinMsg);
      refreshCheckinCardReplies(checkinMsg);
    }
    miniToast('已回复查岗，TA 正在看你发来的消息…');
    // 角色对玩家回复的应答也引用玩家这条回复，并把应答写进查岗卡片（quick：2~4 秒内及时反馈）
    const replyMsg = await scheduleCharReply(charId, { name: playerProfile.name || '我', content: text }, { quick: true });
    if (replyMsg && checkinMsg) {
      checkinMsg.content.replies = checkinMsg.content.replies || [];
      checkinMsg.content.replies.push({ who: c ? c.name : 'TA', text: replyMsg.content });
      checkinMsg.content.answered = true; // 一轮应答完成：卡片闭合，不再显示「回复查岗」（20260925i 防无限回复）
      await idbPut('messages', checkinMsg);
      refreshCheckinCardReplies(checkinMsg);
    }
  };
  $('#ckr-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ckr-send').click(); }
  });
}

/* ---------- 模拟通话（5.7 模拟语音 + 5.8 模拟视频通话：不调用真实摄像头/麦克风，仅模拟 UI）
   含：缩小悬浮窗、拖拽、与完整弹窗切换、访客随机接收/拒绝/未接听、访客随机发起 ---------- */

/* 通话悬浮窗设置（总设置里可改）：仅软件内部 或 手机/其他软件上悬浮 */
let floatSettings = {
  floatMode: 'internal', // 'internal' = 仅悬浮在软件内部；'overlay' = 在手机/其他软件上悬浮
};

function showCallModal() {
  const c = characters.find(x => x.id === currentCharId);
  openModal(`
    <div style="font-size:18px;font-weight:600;margin-bottom:4px;">模拟通话</div>
    <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:16px;">与「${escapeHtml(c ? c.name : 'TA')}」通话（纯模拟，不调用摄像头和麦克风）</div>
    <div style="display:flex;gap:12px;">
      <button class="btn" style="flex:1;flex-direction:column;gap:10px;padding:22px 0;" id="call-voice">
        <span style="font-size:30px;">🎙️</span><span>语音通话</span>
      </button>
      <button class="btn" style="flex:1;flex-direction:column;gap:10px;padding:22px 0;" id="call-video">
        <span style="font-size:30px;">📹</span><span>视频通话</span>
      </button>
    </div>
    <button class="btn block" style="margin-top:14px;" id="call-cancel">取消</button>
  `);
  $('#call-cancel').onclick = closeModal;
  const startCall = async (kind) => {
    closeModal();
    if (!currentCharId) return;
    // 呼出：对方可能不接（随机未接听）
    const answered = Math.random() < 0.85;
    if (!answered) {
      // 未接听
      const myMsg = { id: uid('msg'), charId: currentCharId, from: 'me', type: 'call', content: { kind, ended: true, duration: 0, missed: true }, time: Date.now() };
      await idbPut('messages', myMsg);
      appendMessage(myMsg);
      miniToast('对方未接听');
      await scheduleCharReply(currentCharId);
      return;
    }
    const duration = randInt(8, 45);
    const myMsg = { id: uid('msg'), charId: currentCharId, from: 'me', type: 'call', content: { kind, duration, ended: false }, time: Date.now() };
    await idbPut('messages', myMsg);
    appendMessage(myMsg);
    openCallScreen(c, kind, duration, myMsg, { incoming: false });
  };
  $('#call-voice').onclick = () => startCall('voice');
  $('#call-video').onclick = () => startCall('video');
}

/* ---------- 20260929bm：通话独立层 ----------
   旧机制：通话 UI 复用 #modal-content（openModal 只换 innerHTML）——来电/接听会把玩家
   正在使用的功能弹窗直接顶掉，挂断后 forceCloseModal 全部关闭，原功能页丢失。
   新机制：通话 UI 渲染到专属 #call-layer（z-index 高于弹窗遮罩），接听/挂断/缩小
   只影响本层；底下玩家正在用的功能弹窗/页面原样保留、通话结束原样可见。 */
function ensureCallLayer() {
  let layer = document.getElementById('call-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'call-layer';
    layer.innerHTML = '<div id="call-box" class="modal call-glass"></div>';
    document.body.appendChild(layer);
  }
  return layer;
}
function openCallLayer(html) {
  const layer = ensureCallLayer();
  const box = document.getElementById('call-box');
  box.className = 'modal call-glass';
  box.removeAttribute('style'); // 清上一次通话的 inline 缩放/浮游定位
  box.innerHTML = html;
  layer.classList.remove('call-float2');
  layer.classList.add('show');
}
function closeCallLayer() {
  const layer = document.getElementById('call-layer');
  if (!layer) return;
  layer.classList.remove('show', 'call-float2');
  const box = document.getElementById('call-box');
  if (box) {
    box.classList.remove('call-scale-host');
    box.removeAttribute('style');
    box.innerHTML = '';
    box._callBase = null;
    box._callScale = 1;
    box._f2Pos = null;
  }
}

/* 通话状态管理 */
let _callActive = null; // { c, kind, msg, sec, timer, floatMode, incoming }
let _callActions = null; // { accept, reject } —— 当前来电的接听/拒绝动作（事件委托兜底用）

/* 来电按钮事件委托兜底（捕获阶段，注册一次）：
   即使按钮上的直接 onclick 绑定因任何原因失效（重渲染覆盖、异常中断、缓存旧代码），
   点击接听/拒绝也一定生效。每次来电重置 _callActions，通话结束后清空。 */
if (!window.__callDelegationBound) {
  window.__callDelegationBound = true;
  document.addEventListener('click', (e) => {
    if (!_callActions) return;
    const t = e.target;
    if (t && t.closest && t.closest('#call-accept') && _callActions.accept) { e.preventDefault(); _callActions.accept(); return; }
    if (t && t.closest && t.closest('#call-reject') && _callActions.reject) { e.preventDefault(); _callActions.reject(); }
  }, true);
}

/* 打开通话界面（全屏弹窗），支持缩小成悬浮窗 */
function openCallScreen(c, kind, duration, msg, opts = {}) {
  const incoming = opts.incoming || false;
  // 20260929bk：软件声明未同意期间，抑制来电等打断弹窗（声明必须排最前）
  if (_noticeGate) return;
  // 若已有通话进行中，先结束
  if (_callActive) closeCall(true);

  // 来电时初始为未接听状态（显示接听/拒绝按钮）；呼出时直接接通
  let answered = !incoming;

  // 来电：显示接听/拒绝界面
  const renderFull = (sec) => `
    <div style="display:flex;flex-direction:column;align-items:center;padding:20px 0;min-height:360px;">
      <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:6px;" id="call-timer">${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}</div>
      <div style="font-size:22px;font-weight:700;margin-bottom:4px;">${escapeHtml(c ? c.name : 'TA')}</div>
      <div style="font-size:13px;color:var(--purple-soft);margin-bottom:24px;">${incoming && !answered ? '邀请你进行' : (kind === 'video' ? '视频通话中…' : '语音通话中…')}</div>
      <div class="avatar xl" style="width:150px;height:150px;border-radius:50%;border:3px solid var(--purple);overflow:hidden;background:var(--bg-elevated-2);display:flex;align-items:center;justify-content:center;font-size:56px;color:var(--purple-soft);margin-bottom:28px;">
        ${c && c.avatar ? `<img src="${imgSrc(c.avatar)}" style="width:100%;height:100%;object-fit:cover;">` : (c ? c.name[0] : '?')}
      </div>
      ${incoming && !answered
        ? `<div style="display:flex;gap:26px;">
            <button class="icon-btn" style="width:64px;height:64px;background:var(--danger);border:none;border-radius:50%;font-size:26px;" id="call-reject" title="拒绝">📵</button>
            <button class="icon-btn" style="width:64px;height:64px;background:var(--ok);border:none;border-radius:50%;font-size:26px;color:#0c1a12;" id="call-accept" title="接听">📞</button>
          </div>`
        : `<div style="display:flex;gap:26px;">
            <button class="icon-btn" style="width:54px;height:54px;background:var(--bg-elevated-2);border:1px solid var(--border);" title="静音">🔇</button>
            <button class="icon-btn" style="width:64px;height:64px;background:var(--danger);border:none;border-radius:50%;display:flex;align-items:center;justify-content:center;" id="call-hangup" title="挂断"><span style="display:inline-flex;transform:rotate(135deg);color:#ffffff;">${icon('call', 22)}</span></button>
            <button class="icon-btn" style="width:54px;height:54px;background:var(--bg-elevated-2);border:1px solid var(--border);" id="call-minimize" title="缩小悬浮窗">▣</button>
          </div>`}
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:20px;">${incoming && !answered ? '模拟来电 · 可选择接听或拒绝' : '挂断后聊天里会显示通话时长'}</div>
    </div>
  `;

  openCallLayer(incoming ? renderFull(0) : renderFullCallBody(c, kind, 0)); // 20260929bm：独立层，不再顶掉玩家正在用的功能弹窗
  setCallGlass(true); // 6：模拟通话界面 = 透明磨砂玻璃拟态（透出后面界面与星光）

  let sec = 0;
  const timer = setInterval(() => {
    if (answered) {
      sec++;
      const el = $('#call-timer');
      if (el) el.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
      updateCallFloatTime(sec);
    }
  }, 1000);

  const endCall = async (missed) => {
    clearInterval(timer);
    if (answered) {
      msg.content.duration = sec;
      msg.content.ended = true;
    } else {
      msg.content.duration = 0;
      msg.content.ended = true;
      msg.content.missed = missed;
    }
    // UI 先行响应（移除悬浮窗/关通话层），存储写入放最后且不阻塞界面
    removeCallFloat();
    _callActive = null;
    _callActions = null;
    closeCallLayer(); // 20260929bm：只关通话层，玩家正在用的功能弹窗原样保留
    try { await idbPut('messages', msg); } catch (e) {}
  };

  _callActive = { c, kind, msg, sec, timer, answered, incoming, endCall };

  // 来电接听/拒绝（直接绑定 + 事件委托兜底，acted 防止两条路径重复触发）
  let acted = false;
  const doAccept = () => {
    if (acted) return;
    acted = true;
    answered = true;
    _callActive.answered = true;
    // 接听后用完整通话界面（含视频背景上传 + 玻璃态）
    document.getElementById('call-box').innerHTML = renderFullCallBody(c, kind, 0);
    rebindFullCall(c, kind, msg, { answered: true, incoming });
  };
  const doReject = async () => {
    if (acted) return;
    acted = true;
    answered = false;
    _callActive.answered = false;
    await endCall(true); // 拒绝 = 未接听
  };
  const acceptEl = $('#call-accept');
  const rejectEl = $('#call-reject');
  if (acceptEl) acceptEl.onclick = doAccept;
  if (rejectEl) rejectEl.onclick = doReject;
  _callActions = { accept: doAccept, reject: doReject };

  if (!incoming || answered) {
    rebindFullCall(c, kind, msg, { answered, incoming });
  }
}

/* 绑定完整通话界面按钮 */
function rebindFullCall(c, kind, msg, state) {
  const hangup = $('#call-hangup');
  const minimize = $('#call-minimize');
  if (hangup) hangup.onclick = async () => { await _callActive.endCall(false); if (Math.random() < 0.7 && currentCharId) await scheduleCharReply(currentCharId); };
  if (minimize) minimize.onclick = () => minimizeCall(c, kind);
  const switchBtn = $('#call-switch'); // 20260929bg：语音↔视频切换
  if (switchBtn) switchBtn.onclick = () => switchCallKind();
  // 视频通话：绑定上传背景
  const bgInput = $('#call-bg-input');
  if (bgInput) {
    bgInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      // 20261001cl：更换通话背景先走裁剪器（所见即所得，取消返回 null 不生效）
      const cropped = await openImageCropper(file, { aspect: document.documentElement.clientWidth / Math.max(1, document.documentElement.clientHeight) });
      if (!cropped) return;
      if (_callActive) _callActive.bg = cropped;
      updateCallBg(cropped);
      miniToast('通话背景已更新');
    };
  }
  bindCallExtras(); // 20260929be：小眼睛 + 右下角缩放
}

/* 通话界面玻璃化开关：20260929bm 起通话 UI 在独立层，玻璃类切换到 #call-box */
function setCallGlass(on) {
  const layer = document.getElementById('call-layer');
  const box = document.getElementById('call-box');
  if (layer && box && layer.classList.contains('show')) {
    box.classList.toggle('call-glass', on);
    return;
  }
}

/* 缩小为悬浮窗（正方形头像 + 通话时长） */
function minimizeCall(c, kind) {
  const sec = _callActive.sec || 0;
  // 20260929bm：只隐藏通话层（保持通话），不再动 #modal-mask——底下功能弹窗原样保留
  const layer = document.getElementById('call-layer');
  if (layer) layer.classList.remove('show', 'call-float2');
  buildCallFloat(c, kind, sec);
}

/* 悬浮窗上次位置（只保留当前设置，不保留历史记录） */
let _callFloatPos = null; // { x, y }
let _callFloatDragging = false; // 拖拽中标记：拖拽时禁止悬停展开/缩回

/* 创建悬浮窗（玻璃拟态半透明；位置继承上次拖动位置）
   关键：DOM 只建一次，展开/缩回纯 CSS class 切换，避免 innerHTML 重建 + 重复 addEventListener 导致卡死 */
function buildCallFloat(c, kind, sec) {
  removeCallFloat();
  const f = document.createElement('div');
  f.id = 'call-float';
  f.className = 'call-float square';
  f.innerHTML = `
    <div class="cf-avatar">${c && c.avatar ? `<img src="${imgSrc(c.avatar)}">` : (c ? c.name[0] : '?')}</div>
    <div class="cf-mid">
      <div class="cf-name">${escapeHtml(c ? c.name : 'TA')}</div>
      <div class="cf-time">${formatDurShort(sec)}</div>
    </div>
    <button class="cf-btn" id="cf-back" title="切回完整通话">⤢</button>
    <button class="cf-btn danger" id="cf-hangup" title="挂断">📞</button>
  `;
  document.body.appendChild(f);

  // 定位：优先用上次拖动位置；否则默认右下角
  if (_callFloatPos) {
    f.style.left = _callFloatPos.x + 'px';
    f.style.top = _callFloatPos.y + 'px';
    f.style.right = 'auto';
    f.style.bottom = 'auto';
  } else {
    f.style.right = '14px';
    f.style.bottom = '84px';
    f.style.left = 'auto';
    f.style.top = 'auto';
  }

  // 一次性绑定（只执行一次，不随展开/缩回重建）
  // 悬停展开（拖拽中禁止）
  f.addEventListener('mouseenter', () => {
    if (_callFloatDragging) return;
    expandCallFloat(c, kind);
  });
  // 移开缩回（拖拽中禁止）
  f.addEventListener('mouseleave', () => {
    if (_callFloatDragging) return;
    collapseCallFloat();
  });
  // 扩展按钮 → 切回完整通话并移除悬浮窗
  $('#cf-back').onclick = (e) => { e.stopPropagation(); backToFullCall(c, kind); };
  // 挂断按钮
  $('#cf-hangup').onclick = async (e) => {
    e.stopPropagation();
    if (_callActive) await _callActive.endCall(false);
    if (Math.random() < 0.7 && currentCharId) await scheduleCharReply(currentCharId);
  };
  // 拖拽（拖动开始/结束回调控制 _callFloatDragging）
  makeDraggable(f, (x, y) => { _callFloatPos = { x, y }; });
}

/* 展开为圆角长条：仅切换 class，不重建 DOM */
function expandCallFloat(c, kind) {
  const f = $('#call-float');
  if (!f) return;
  if (f.classList.contains('bar')) return; // 已展开则跳过，避免重复
  f.classList.remove('square');
  f.classList.add('bar');
}

/* 长条缩回正方形：仅切换 class，不重建 DOM */
function collapseCallFloat() {
  const f = $('#call-float');
  if (!f) return;
  if (f.classList.contains('square')) return; // 已缩回则跳过
  f.classList.remove('bar');
  f.classList.add('square');
}

/* 切回完整通话页面（同时移除悬浮窗，不再保留） */
function backToFullCall(c, kind) {
  const sec = _callActive ? _callActive.sec : 0;
  removeCallFloat();
  openCallLayer(renderFullCallBody(c, kind, sec)); // 20260929bm：独立层
  setCallGlass(true);
  const hangup = $('#call-hangup');
  const minimize = $('#call-minimize');
  if (hangup) hangup.onclick = async () => { await _callActive.endCall(false); if (Math.random() < 0.7 && currentCharId) await scheduleCharReply(currentCharId); };
  if (minimize) minimize.onclick = () => minimizeCall(c, kind);
  const switchBtn = $('#call-switch'); // 20260929bg：语音↔视频切换
  if (switchBtn) switchBtn.onclick = () => switchCallKind();
  // 视频通话：绑定上传背景
  const bgInput = $('#call-bg-input');
  if (bgInput) {
    bgInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      // 20261001cl：更换通话背景先走裁剪器（所见即所得，取消返回 null 不生效）
      const cropped = await openImageCropper(file, { aspect: document.documentElement.clientWidth / Math.max(1, document.documentElement.clientHeight) });
      if (!cropped) return;
      if (_callActive) _callActive.bg = cropped;
      updateCallBg(cropped);
      miniToast('通话背景已更新');
    };
  }
  bindCallExtras(); // 20260929be：小眼睛 + 右下角缩放
}

/* 更新完整通话界面的视频背景（20260929g：兼容 Blob 描述符） */
function updateCallBg(v) {
  const bgEl = document.getElementById('call-screen-bg');
  if (bgEl) bgEl.style.backgroundImage = v ? `url("${imgSrc(v)}")` : '';
}

/* 完整通话界面 body（切回时复用；玻璃拟态半透明 + 视频可上传背景）
   20260929be：视频通话加「小眼睛」纯背景模式（隐藏渐变 UI 与遮罩直接看图）
   + 右下角长按拖拽缩放弹窗（与缩小悬浮窗互不影响）
   20260929bg：①拖拽缩放改等比例（按钮/文字随整体 scale，最小 0.4 倍）
   ②底部新增「语音↔视频」切换按钮，界面内自由切换 ③手柄换对角箭头图标，语音通话也可缩放 */
function renderFullCallBody(c, kind, sec) {
  const bg = (_callActive && _callActive.bg) || '';
  return `
    <div class="call-full-body" style="display:flex;flex-direction:column;align-items:center;padding:20px 0;min-height:360px;position:relative;border-radius:20px;">
      ${kind === 'video' ? `
      <div id="call-screen-bg" style="position:absolute;inset:0;border-radius:20px;background-size:cover;background-position:center;opacity:0.35;pointer-events:none;${bg ? `background-image:url(&quot;${imgSrc(bg)}&quot;);` : ''}"></div>
      <button class="icon-btn" id="call-eye" title="隐藏通话 UI（纯背景）" style="position:absolute;top:10px;right:12px;z-index:12;">${icon('eye', 18)}</button>
      ` : ''}
      <div class="call-ui" style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;width:100%;">
        <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:6px;" id="call-timer">${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}</div>
        <div style="font-size:22px;font-weight:700;margin-bottom:4px;">${escapeHtml(c ? c.name : 'TA')}</div>
        <div style="font-size:13px;color:var(--purple-soft);margin-bottom:24px;" id="call-kind-label">${kind === 'video' ? '视频通话中…' : '语音通话中…'}</div>
        <div class="avatar xl" style="width:150px;height:150px;border-radius:50%;border:3px solid var(--purple);overflow:hidden;background:var(--bg-elevated-2);display:flex;align-items:center;justify-content:center;font-size:56px;color:var(--purple-soft);margin-bottom:28px;">
          ${c && c.avatar ? `<img src="${imgSrc(c.avatar)}" style="width:100%;height:100%;object-fit:cover;">` : (c ? c.name[0] : '?')}
        </div>
        ${kind === 'video' ? `
        <label for="call-bg-input" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:18px;background:rgba(20,16,25,0.72);color:rgba(255,255,255,0.82);font-size:12px;cursor:pointer;margin-bottom:20px;">${icon('camera', 14)} 更换通话背景</label>
        <input type="file" id="call-bg-input" accept="image/*" style="display:none;">
        ` : ''}
        <div style="display:flex;gap:14px;align-items:center;">
          <button class="icon-btn" style="width:54px;height:54px;background:var(--bg-elevated-2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;" id="call-switch" title="${kind === 'video' ? '切换为语音通话' : '切换为视频通话'}">${icon(kind === 'video' ? 'call' : 'camera', 20)}</button>
          <button class="icon-btn" style="width:54px;height:54px;background:var(--bg-elevated-2);border:1px solid var(--border);" title="静音">🔇</button>
          <button class="icon-btn" style="width:64px;height:64px;background:var(--danger);border:none;border-radius:50%;display:flex;align-items:center;justify-content:center;" id="call-hangup" title="挂断"><span style="display:inline-flex;transform:rotate(135deg);color:#ffffff;">${icon('call', 22)}</span></button>
          <button class="icon-btn" style="width:54px;height:54px;background:var(--bg-elevated-2);border:1px solid var(--border);" id="call-minimize" title="缩小悬浮窗">▣</button>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:20px;">挂断后聊天里会显示通话时长</div>
      </div>
      <div id="call-resize-handle" title="拖拽缩放窗口（等比例，最小可缩到 0.4 倍）">${icon('expand', 14)}</div>
    </div>
  `;
}

/* 20260929bg：通话弹窗等比例缩放核心——
   首次打开时把 #modal-content 切到 call-scale-host（去 padding、锁溢出），
   以其当前渲染尺寸为基准 (base.w, base.h)；之后拖拽只改 scale：
   容器 = 基准×s，内容层按基准尺寸布局再 transform: scale(s)，
   按钮/文字/背景随整体真正等比缩放（不是拉宽高）。
   最小 0.4 倍（掌心大小），最大不超过视口 94%/92%；缩放比例存 modal._callScale，
   模式切换/悬浮窗切回时保留，关弹窗时由 resetModalSizing 清理。 */
function initCallScale() {
  const modal = document.getElementById('call-box'); // 20260929bm：通话独立层容器
  const body = modal && modal.querySelector('.call-full-body');
  if (!modal || !body) return null;
  modal.classList.add('call-scale-host'); // 先切容器形态再量基准，避免 padding 计入
  modal.style.width = ''; modal.style.height = '';
  modal.style.maxWidth = ''; modal.style.maxHeight = '';
  const rect = modal.getBoundingClientRect();
  const base = { w: Math.max(200, Math.round(rect.width)), h: Math.max(260, Math.round(rect.height)) };
  modal._callBase = base;
  body.style.transformOrigin = 'top left';
  body.style.minHeight = '0';
  body.style.height = base.h + 'px';
  // 20260929bi：显式锁内容层宽=容器内容宽（clientWidth 不含边框）——修复缩小后 UI 偏左：
  // 此前内容层按「已缩小的容器宽」布局再 scale，视觉宽=基准×s²，右侧空出一条
  body.style.width = modal.clientWidth + 'px';
  applyCallScale(modal, base, modal._callScale || 1);
  return base;
}
function applyCallScale(modal, base, s) {
  modal._callScale = s;
  modal.style.width = Math.round(base.w * s) + 'px';
  modal.style.height = Math.round(base.h * s) + 'px';
  modal.style.maxWidth = 'none';
  modal.style.maxHeight = 'none';
  const body = modal.querySelector('.call-full-body');
  if (body) body.style.transform = `scale(${s})`;
}
/* 关闭弹窗时还原容器（清除 inline 尺寸/缩放/悬浮窗2号定位，防残留到下一个普通弹窗） */
function resetModalSizing() {
  const modal = $('#modal-content');
  if (!modal) return;
  modal.classList.remove('call-scale-host');
  modal.style.width = ''; modal.style.height = '';
  modal.style.maxWidth = ''; modal.style.maxHeight = '';
  // 20260929bi：悬浮窗2号拖动产生的定位一并清理
  modal.style.position = ''; modal.style.left = ''; modal.style.top = ''; modal.style.margin = '';
  modal._f2Pos = null;
  modal._callBase = null;
  modal._callScale = 1;
  $('#modal-mask').classList.remove('mask-float2'); // 20260929bj：清理遮罩穿透
  const body = modal.querySelector('.call-full-body');
  if (body) { body.style.transform = ''; body.style.width = ''; body.style.height = ''; body.style.minHeight = ''; }
}
/* 20260929bg：通话中语音↔视频自由切换——保留通话秒数与缩放比例，
   重渲染界面（视频=背景+眼睛+更换背景；语音=纯头像），消息类型同步更新（挂断后按新模式记录） */
function switchCallKind() {
  if (!_callActive) return;
  const nk = _callActive.kind === 'video' ? 'voice' : 'video';
  _callActive.kind = nk;
  if (_callActive.msg && _callActive.msg.content) _callActive.msg.content.kind = nk;
  const c = _callActive.c;
  document.getElementById('call-box').innerHTML = renderFullCallBody(c, nk, _callActive.sec || 0); // 20260929bm：独立层
  rebindFullCall(c, nk, _callActive.msg, { answered: true, incoming: _callActive.incoming });
  miniToast(nk === 'video' ? '已切换为视频通话' : '已切换为语音通话');
}

/* 20260929bi：悬浮窗2号——缩小后的通话弹窗整体可拖动浮游（浮在软件界面/屏幕任意位置）。
   聊天设置「允许悬浮窗2号浮游」关闭时禁用（始终居中）；
   位置存 #modal-content._f2Pos，语音↔视频切换/缩小悬浮窗切回都保留，关弹窗由 resetModalSizing 清理。
   注意：弹窗缩放等比后内容层已锁基准宽，拖动只改 left/top，不影响缩放。 */
function float2DragStart(e) {
  const modal = document.getElementById('call-box'); // 20260929bm：通话独立层
  if (!modal || !modal.classList.contains('call-scale-host')) return; // 只作用于通话弹窗
  if (chatSettings.allowFloat2 === false) return; // 聊天设置：不允许浮游 → 锁定居中
  if (e.target.closest('button, input, label, #call-resize-handle, a')) return; // 控件不触发拖动
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault(); // 防文字选中/图片拖拽
  const rect = modal.getBoundingClientRect();
  const startX = e.clientX, startY = e.clientY;
  const baseLeft = rect.left, baseTop = rect.top, w = rect.width, h = rect.height;
  let moved = false;
  const onMove = (ev) => {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return; // 超过死区才算拖动
    moved = true;
    if (modal.style.position !== 'fixed') {
      modal.style.position = 'fixed';
      modal.style.margin = '0';
      modal.style.left = baseLeft + 'px';
      modal.style.top = baseTop + 'px';
    }
    // 20260929bj：进入浮游状态 → 层穿透，玩家可以直接点按底下的功能界面继续使用
    const _cl = document.getElementById('call-layer');
    if (_cl) _cl.classList.add('call-float2');
    // 钳制在视口内（留 6px 边距），浮在软件内任意位置
    const nx = Math.max(6, Math.min(window.innerWidth - w - 6, baseLeft + dx));
    const ny = Math.max(6, Math.min(window.innerHeight - h - 6, baseTop + dy));
    modal.style.left = Math.round(nx) + 'px';
    modal.style.top = Math.round(ny) + 'px';
    modal._f2Pos = { x: Math.round(nx), y: Math.round(ny) };
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}
/* 把悬浮窗2号位置重新贴回（重渲染后调用；_f2Pos 存在才贴） */
function applyFloat2Pos(modal) {
  if (!modal || !modal._f2Pos) return;
  modal.style.position = 'fixed';
  modal.style.margin = '0';
  modal.style.left = modal._f2Pos.x + 'px';
  modal.style.top = modal._f2Pos.y + 'px';
  const _cl = document.getElementById('call-layer'); // 20260929bm：层穿透（替代旧 mask-float2）
  if (_cl) _cl.classList.add('call-float2');
}
/* 20260929bg：通话弹窗扩展控件绑定（小眼睛 + 右下角缩放手柄）——
   rebindFullCall / backToFullCall 共用，避免两处漏绑
   20260929bg：缩放改等比例（拖拽只改 scale）；末尾统一 initCallScale 应用尺寸 */
function bindCallExtras() {
  const body = document.querySelector('#call-box .call-full-body'); // 20260929bm：通话独立层
  if (!body) return;
  const eye = $('#call-eye');
  if (eye) {
    eye.onclick = () => {
      const clean = body.classList.toggle('call-clean');
      eye.innerHTML = icon(clean ? 'eyeoff' : 'eye', 18);
      eye.title = clean ? '显示通话 UI' : '隐藏通话 UI（纯背景）';
    };
  }
  const handle = $('#call-resize-handle');
  if (handle && !handle._rsBound) {
    handle._rsBound = true;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const modal = document.getElementById('call-box'); // 20260929bm：通话独立层
      if (!modal) return;
      const base = initCallScale();
      if (!base) return;
      const startX = e.clientX, startY = e.clientY;
      const s0 = modal._callScale || 1;
      const maxS = Math.min(1.6, (window.innerWidth * 0.94) / base.w, (window.innerHeight * 0.92) / base.h);
      const onMove = (ev) => {
        // 等比例：对角方向拖拽统一映射到 scale，宽高始终按基准锁比，按钮/文字随整体缩放
        const s = Math.max(0.4, Math.min(maxS, s0 + ((ev.clientX - startX) + (ev.clientY - startY)) / 460));
        applyCallScale(modal, base, s);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
  // 20260929bi：悬浮窗2号——弹窗整体可拖动（绑定一次，listener 挂在持久元素上）
  const host = document.getElementById('call-box'); // 20260929bm：通话独立层
  if (host && !host._f2Bound) {
    host._f2Bound = true;
    host.addEventListener('pointerdown', float2DragStart);
  }
  initCallScale(); // 20260929bg：每次渲染/重绑定后应用等比缩放（保留 _callScale）
  applyFloat2Pos(host); // 20260929bi：重渲染（模式切换/切回）后贴回悬浮窗2号位置
}

function updateCallFloatTime(sec) {
  const el = document.querySelector('#call-float .cf-time');
  if (el) el.textContent = formatDurShort(sec);
}

function formatDurShort(sec) {
  sec = sec || 0;
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function removeCallFloat() {
  const f = $('#call-float');
  if (f) f.remove();
}

/* 强制结束通话（新通话或切角色时） */
function closeCall(silent = false) {
  if (_callActive) {
    clearInterval(_callActive.timer);
    const msg = _callActive.msg;
    msg.content.duration = _callActive.sec || 0;
    msg.content.ended = true;
    idbPut('messages', msg);
    _callActive = null;
    _callActions = null;
  }
  removeCallFloat();
  closeCallLayer(); // 20260929bm：同步收起独立层（新通话随后会重新渲染）
}

/* 群通话（20260929ba 细则）：勾选多名成员发起群通话；
   通话页关闭后留在群聊（不再像旧版先切到成员单聊——修复关闭后跳走的问题） */
function showGroupCallModal(g) {
  const members = chainMembers(g);
  if (!members.length) { miniToast('群里没有可以通话的成员'); return; }
  const sel = new Set();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">群通话 · 勾选成员</div>
      <button class="icon-btn" id="gcall-close">✕</button>
    </div>
    <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
      ${members.map(c => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;" data-gcall="${c.id}">
          <div class="avatar sm">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
          <div style="flex:1;font-size:14px;font-weight:600;">${escapeHtml((g.memberNick || {})[c.id] || c.name)}</div>
          <div class="gcall-check" style="width:20px;height:20px;border-radius:50%;border:2px solid var(--text-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;color:#141019;flex-shrink:0;"></div>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:12px;">
      <button class="btn" style="flex:1;flex-direction:column;gap:8px;padding:16px 0;" id="gcall-voice"><span style="font-size:26px;">🎙️</span><span>语音群聊</span></button>
      <button class="btn" style="flex:1;flex-direction:column;gap:8px;padding:16px 0;" id="gcall-video"><span style="font-size:26px;">📹</span><span>视频群聊</span></button>
    </div>
  `);
  $('#gcall-close').onclick = closeModal;
  const refresh = () => {
    document.querySelectorAll('[data-gcall]').forEach(el => {
      const on = sel.has(el.dataset.gcall);
      const box = el.querySelector('.gcall-check');
      box.style.background = on ? 'var(--purple)' : '';
      box.style.borderColor = on ? 'var(--purple)' : 'var(--text-tertiary)';
      box.textContent = on ? '✓' : '';
      el.style.borderColor = on ? 'var(--purple)' : 'var(--border)';
    });
  };
  document.querySelectorAll('[data-gcall]').forEach(el => {
    el.onclick = () => { sel.has(el.dataset.gcall) ? sel.delete(el.dataset.gcall) : sel.add(el.dataset.gcall); refresh(); };
  });
  const start = async (kind) => {
    if (sel.size === 0) { miniToast('先勾选要通话的成员'); return; }
    closeModal();
    const picked = members.filter(c => sel.has(c.id));
    const answered = Math.random() < 0.85;
    const msg = {
      id: uid('msg'), groupId: g.id, from: 'me', type: 'call',
      content: { kind, group: true, memberIds: picked.map(c => c.id), duration: 0, missed: !answered, ended: !answered },
      time: Date.now(),
    };
    await idbPut('messages', msg);
    if (currentGroupId === g.id && document.body.dataset.view === 'chat') { appendGroupMessage(msg); scrollToBottom(); }
    else renderChatList();
    if (!answered) { miniToast('没有人接听'); return; }
    openGroupCallScreen(g, picked, kind, msg);
  };
  $('#gcall-voice').onclick = () => start('voice');
  $('#gcall-video').onclick = () => start('video');
}
/* 群通话全屏界面（复用通话计时/挂断状态机；关闭后停留在当前视图，不跳单聊） */
function openGroupCallScreen(g, members, kind, msg) {
  if (_callActive) closeCall(true);
  let sec = 0;
  const avatars = members.slice(0, 4).map(c => `<div class="avatar" style="width:72px;height:72px;font-size:26px;">${c.avatar ? `<img src="${imgSrc(c.avatar)}" style="width:100%;height:100%;object-fit:cover;">` : escapeHtml(c.name[0] || '?')}</div>`).join('');
  const more = members.length > 4 ? `<div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">等 ${members.length} 人</div>` : '';
  openCallLayer(`
    <div style="display:flex;flex-direction:column;align-items:center;padding:20px 0;min-height:360px;">
      <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:6px;" id="call-timer">00:00</div>
      <div style="font-size:22px;font-weight:700;margin-bottom:4px;">${escapeHtml(g.name)}</div>
      <div style="font-size:13px;color:var(--purple-soft);margin-bottom:24px;">${kind === 'video' ? '视频' : '语音'}群聊通话中 · ${members.length} 人</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-bottom:12px;">${avatars}</div>
      ${more}
      <div style="display:flex;gap:26px;margin-top:auto;">
        <button class="icon-btn" style="width:54px;height:54px;background:var(--bg-elevated-2);border:1px solid var(--border);" title="静音">🔇</button>
        <button class="icon-btn" style="width:64px;height:64px;background:var(--danger);border:none;border-radius:50%;display:flex;align-items:center;justify-content:center;" id="call-hangup" title="挂断"><span style="display:inline-flex;transform:rotate(135deg);color:#ffffff;">${icon('call', 22)}</span></button>
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:20px;">挂断后群里会显示通话时长</div>
    </div>
  `, { noBackdrop: true });
  setCallGlass(true);
  const timer = setInterval(() => {
    sec++;
    _callActive && (_callActive.sec = sec);
    const el = $('#call-timer');
    if (el) el.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    updateCallFloatTime(sec);
  }, 1000);
  const endCall = async () => {
    clearInterval(timer);
    msg.content.duration = sec;
    msg.content.ended = true;
    removeCallFloat();
    _callActive = null;
    closeCallLayer(); // 20260929bm：只关通话层
    try { await idbPut('messages', msg); } catch (e) {}
    // 挂断后刷新群消息区（通话卡片从「通话中」变「通话时长」）
    if (currentGroupId === msg.groupId && document.body.dataset.view === 'chat') await renderGroupMessages(msg.groupId);
  };
  _callActive = { g, kind, msg, sec, timer, answered: true, incoming: false, endCall, group: true, members };
  const hangup = $('#call-hangup');
  if (hangup) hangup.onclick = () => { endCall(); };
}

/* 访客随机来电（5.8：随机接收视频/语音通话，可接听/拒绝/未接听）；kind 可强制指定 'video'/'voice'（开发者命令用） */
async function triggerIncomingCall(c, kind) {
  // 若已有通话进行中，跳过
  if (_callActive) return;
  if (kind !== 'video' && kind !== 'voice') kind = Math.random() < 0.5 ? 'video' : 'voice';
  const msg = { id: uid('msg'), charId: c.id, from: 'them', type: 'call', content: { kind, ended: false, duration: 0, incoming: true }, time: Date.now() };
  await idbPut('messages', msg);
  // 打开来电界面（全屏弹窗），显示接听/拒绝
  openCallScreen(c, kind, 0, msg, { incoming: true });
}

/* 拖拽悬浮窗（20260929w 丝滑化重写）：
   旧实现每帧改 left/top（每次都触发重排）+ 每次 move 都读 offsetWidth/offsetHeight
   （读写交错 = 强制同步布局），拖起来发涩。现在：
   ① 拖动中只写 transform（合成器直接搬运，不触发重排）；
   ② 尺寸在拖动开始时读一次并缓存，move 里零布局读取；
   ③ move 事件用 requestAnimationFrame 合并，一帧最多写一次。
   onDrop(x, y)：拖拽结束后的左上角坐标回调，用于记忆位置 */
function makeDraggable(el, onDrop) {
  let startX = 0, startY = 0, dragging = false;
  let baseX = 0, baseY = 0, elW = 0, elH = 0; // 拖动锚点与缓存尺寸
  let lastCX = 0, lastCY = 0, rafId = 0;

  const finishDrag = (moved) => {
    if (!dragging) return;
    dragging = false;
    _callFloatDragging = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    el.classList.remove('dragging');
    if (moved) {
      // 把 transform 位移烘焙回 left/top，清掉 transform（还原语义坐标）
      const dx = lastCX - startX, dy = lastCY - startY;
      let nx = Math.max(0, Math.min(window.innerWidth - elW, baseX + dx));
      let ny = Math.max(0, Math.min(window.innerHeight - elH, baseY + dy));
      el.style.transform = '';
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
      if (onDrop) onDrop(nx, ny);
    }
  };

  // 每帧一次的实际写入
  const applyPos = () => {
    rafId = 0;
    if (!dragging) return;
    let nx = Math.max(0, Math.min(window.innerWidth - elW, baseX + (lastCX - startX)));
    let ny = Math.max(0, Math.min(window.innerHeight - elH, baseY + (lastCY - startY)));
    el.style.transform = `translate3d(${nx - baseX}px, ${ny - baseY}px, 0)`;
  };
  const queuePos = () => { if (!rafId) rafId = requestAnimationFrame(applyPos); };

  const begin = (cx, cy) => {
    dragging = true; _callFloatDragging = true;
    startX = cx; startY = cy; lastCX = cx; lastCY = cy;
    const rect = el.getBoundingClientRect();
    baseX = rect.left; baseY = rect.top;
    elW = el.offsetWidth; elH = el.offsetHeight; // 尺寸只在开始读一次
    el.style.left = baseX + 'px'; el.style.top = baseY + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
    el.style.transform = 'translate3d(0, 0, 0)';
    el.classList.add('dragging');
  };
  const onMove = (cx, cy) => {
    if (!dragging) return;
    lastCX = cx; lastCY = cy;
    queuePos();
  };

  // 触屏拖拽
  el.addEventListener('touchstart', (e) => {
    if (e.target.closest('.cf-btn')) return;
    const t = e.touches[0];
    begin(t.clientX, t.clientY);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    onMove(t.clientX, t.clientY);
  }, { passive: true });
  el.addEventListener('touchend', () => { finishDrag(true); });
  el.addEventListener('touchcancel', () => { finishDrag(false); });

  // 鼠标拖拽（PC）
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.cf-btn')) return;
    if (e.button !== 0) return; // 仅左键
    e.preventDefault();
    begin(e.clientX, e.clientY);
    let moved = false;
    const move = (ev) => {
      if (Math.abs(ev.clientX - startX) > 2 || Math.abs(ev.clientY - startY) > 2) moved = true;
      onMove(ev.clientX, ev.clientY);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      finishDrag(moved);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

/* ---------- 发红包 / 转账（14 简版：真扣款） ---------- */
function showTransferModal() {
  const c = characters.find(x => x.id === currentCharId);
  openModal(`
    <div style="font-size:18px;font-weight:600;margin-bottom:16px;">转账给 ${escapeHtml(c ? c.name : 'TA')}</div>
    <div style="display:flex;gap:12px;margin-bottom:14px;font-size:13px;color:var(--text-secondary);">
      <span>我的钱包：¥${playerProfile.wallet}</span>
      <span>TA 的钱包：¥${c ? (c.wallet ?? 100000) : '-'}</span>
    </div>
    <div class="field">
      <label>金额</label>
      <input class="input" type="number" id="transfer-amount" placeholder="输入转账金额" min="1">
    </div>
    <div class="field">
      <label>备注（可选）</label>
      <input class="input" id="transfer-note" placeholder="如：请你喝奶茶">
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="transfer-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="transfer-go">转账</button>
    </div>
  `);
  $('#transfer-cancel').onclick = closeModal;
  $('#transfer-go').onclick = async () => {
    const amount = parseInt($('#transfer-amount').value);
    if (!amount || amount <= 0) { miniToast('请输入有效金额'); return; }
    if (amount > playerProfile.wallet) { miniToast('余额不足'); return; }
    const note = $('#transfer-note').value.trim();
    const c2 = characters.find(x => x.id === currentCharId);
    // 真扣款：玩家钱包先扣（钱进入「待领取」状态）
    playerProfile.wallet -= amount;
    await savePlayerProfile();
    closeModal();
    const myMsg = {
      id: uid('msg'), charId: currentCharId, from: 'me', type: 'transfer',
      content: { amount, note, direction: 'me_to_char', status: 'pending' }, time: Date.now()
    };
    await idbPut('messages', myMsg);
    appendMessage(myMsg);
    // 随机决定梦角是否领取（70% 领取 / 30% 退回）
    const claimed = Math.random() < 0.7;
    const delay = randInt(2, 6) * 1000;
    setTimeout(async () => {
      const c3 = characters.find(x => x.id === currentCharId);
      if (claimed) {
        // 领取：钱入访客钱包
        myMsg.content.status = 'claimed';
        if (c3) { c3.wallet = (c3.wallet ?? 100000) + amount; await saveChar(c3); }
        await idbPut('messages', myMsg);
        if (currentCharId === myMsg.charId) await renderMessages(myMsg.charId);
        await scheduleCharReply(myMsg.charId);
      } else {
        // 退回：钱退回玩家钱包，卡片内提示「XX 退回了你的转账」
        myMsg.content.status = 'returned';
        playerProfile.wallet += amount;
        await savePlayerProfile();
        await idbPut('messages', myMsg);
        if (currentCharId === myMsg.charId) await renderMessages(myMsg.charId);
        // 追加一条角色退回提示（作为角色消息）
        const returnMsg = { id: uid('msg'), charId: myMsg.charId, from: 'them', type: 'transfer', content: { amount, note, direction: 'me_to_char', status: 'returned', returnedNote: (c3 ? c3.name : 'TA') + ' 退回了你的转账' }, time: Date.now() };
        await idbPut('messages', returnMsg);
        if (currentCharId === myMsg.charId) appendMessage(returnMsg);
      }
      renderChatList();
    }, delay);
  };
}

/* ---------- 通用确认框（替代原生 confirm，兼容沙箱） ---------- */
function showConfirm(message, onConfirm) {
  openModal(`
    <div style="text-align:center;margin-bottom:8px;">
      <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
      <div style="font-size:15px;line-height:1.6;color:var(--text);">${escapeHtml(message)}</div>
    </div>
    <div style="display:flex;gap:10px;margin-top:20px;">
      <button class="btn" style="flex:1;" id="confirm-cancel">取消</button>
      <button class="btn danger" style="flex:1;" id="confirm-ok">确定</button>
    </div>
  `);
  $('#confirm-cancel').onclick = closeModal;
  $('#confirm-ok').onclick = () => { closeModal(); onConfirm(); };
}

/* ---------- 轻提示（不阻断操作，不顶掉当前弹窗；替代原生 alert） ---------- */
let _miniToastTimer = null;
function miniToast(message) {
  let el = document.getElementById('mini-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mini-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(_miniToastTimer);
  _miniToastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}
function showToast(message) { miniToast(message); }

/* ---------- 顶部横幅提示（20260929au）：长条形，从顶部滑入，队列顺序展示，不挤占页面 ---------- */
let _bannerQueue = [];
let _bannerBusy = false;
function showTopBanner(html, opts = {}) {
  // 20260929be 细则五「终极降级」：低端机不弹顶部横幅（保滑动丝滑），只留红点角标
  if (opts.canDegrade !== false && isLowEndDevice()) return;
  const dur = opts.dur || 3200;
  _bannerQueue.push({ html, dur, charId: opts.charId, groupId: opts.groupId, gotoChatlist: opts.gotoChatlist });
  if (_bannerBusy) return;
  _bannerBusy = true;
  const next = () => {
    const item = _bannerQueue.shift();
    if (!item) { _bannerBusy = false; return; }
    let el = document.getElementById('top-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'top-banner';
      document.body.appendChild(el);
    }
    el.innerHTML = item.html;
    el.classList.add('show');
    if (item.charId || item.groupId || item.gotoChatlist) {
      el.style.cursor = 'pointer';
      el.onclick = () => {
        el.classList.remove('show');
        setTimeout(next, 320);
        if (item.gotoChatlist) { switchView('chatlist'); return; } // 20260929be：聚合卡片直达聊天列表
        if (item.groupId) { openGroupChat(item.groupId); return; }
        const c = characters.find(x => x.id === item.charId);
        if (c) openChat(c.id);
      };
    }
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(next, 320);
    }, item.dur);
  };
  next();
}

/* 20260929be「防堆积聚合」细则三：60 秒窗口内超过 3 个访客发来东西 →
   不再逐条弹横幅，改弹一张聚合卡片（点击直达聊天列表）。
   返回 true = 本次已走聚合，调用方跳过单条横幅（未读/红点照常累计）。 */
const AGG_WINDOW_MS = 60000;
let _aggrSenders = new Map(); // charId -> 首次来件时间
let _aggrShownAt = 0;
function _noteCrossPageIncoming(charId) {
  const now = Date.now();
  // 窗口过期：清空重来
  if (_aggrSenders.size && now - Math.min(..._aggrSenders.values()) > AGG_WINDOW_MS) _aggrSenders.clear();
  _aggrSenders.set(charId, now);
  if (_aggrSenders.size <= 3) return false;
  // 已聚合过一轮：窗口内不再重复弹聚合卡（未读照常累计）
  if (now - _aggrShownAt < AGG_WINDOW_MS) return true;
  _aggrShownAt = now;
  // 清掉排队中的单条横幅，聚合卡顶格播
  _bannerQueue.length = 0;
  showTopBanner(`检测到多处维度信号波动<div class="tb-sub">点击前往聊天列表查看</div>`, { dur: 3600, gotoChatlist: true, canDegrade: true });
  return true;
}

/* ============================================================
   跨角色消息隔离 + 未读事件队列 + 红点（20260929au）
   核心：玩家停留在访客 A 的聊天页时，访客 B 的消息/礼物/惊喜/书信
   不得插入当前聊天 DOM。改为顶部横幅提示；超频动画延迟到玩家进入
   对应访客聊天页时才播（只播最后一条，惊喜优先）；多封书信只播一次。
   ============================================================ */

/* 未读事件注册表（内存态，kv 持久化兜底）：按 charId 累积待播动画与红点 */
let _unreadEvents = {   // { [charId]: { gifts: 0, surprises: 0, letters: 0, msgs: 0 } }
};
async function _loadUnreadEvents() {
  try { _unreadEvents = (await getSetting('unreadEvents', {})) || {}; } catch (e) { _unreadEvents = {}; }
}
async function _saveUnreadEvents() {
  try { await setSetting('unreadEvents', _unreadEvents); } catch (e) {}
}
function _ev(charId) {
  if (!_unreadEvents[charId]) _unreadEvents[charId] = { gifts: 0, surprises: 0, letters: 0, msgs: 0 };
  return _unreadEvents[charId];
}
/* 计算某访客是否还有未读超频（礼物+惊喜）与书信 */
function _ocUnreadCount(charId) {
  const e = _unreadEvents[charId] || { gifts: 0, surprises: 0, letters: 0, msgs: 0 };
  return { oc: (e.gifts || 0) + (e.surprises || 0), letters: e.letters || 0, msgs: e.msgs || 0 };
}
/* 红点：加号（超频+书信未读合并）+ 书信入口 + 信箱
   20260929ax：红点只跟随「当前聊天页的这位访客」——他访客的未读不再串到别的聊天页加号上，
   谁的未读进谁的聊天页才亮；跨访客概览交给聊天导航列表的未读标识 */
function refreshUnreadBadges() {
  const e = currentCharId ? (_unreadEvents[currentCharId] || null) : null;
  const oc = e ? ((e.gifts || 0) + (e.surprises || 0)) : 0;
  const letters = e ? (e.letters || 0) : 0;
  const combined = oc + letters;
  const fmt = (n) => (n > 99 ? '99+' : n);
  setBadge('btn-plus', combined > 0 ? fmt(combined) : null);
  // 书信入口（+ 面板里的「书信」项，若存在）
  setBadge('plus-item-letter', letters > 0 ? fmt(letters) : null);
  // 信箱按钮（写信弹窗内，若存在）
  setBadge('letter-records', letters > 0 ? fmt(letters) : null);
}
function setBadge(elId, text) {
  const btn = document.getElementById(elId);
  if (!btn) return;
  let b = btn.querySelector('.icon-badge');
  if (text == null) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'icon-badge'; btn.appendChild(b); }
  b.textContent = text;
  b.classList.toggle('dot', text === '');
}

/* 是否正处于「某访客的聊天页」（非当前访客的其他聊天一律算外部） */
function _inChatWith(charId) {
  return currentCharId === charId && document.body.dataset.view === 'chat';
}
/* 是否在聊天页（任意访客） */
function _inAnyChat() {
  return document.body.dataset.view === 'chat';
}
/* 是否在「非聊天页」但仍是应用内可见页（导航/主页/朋友圈等）——用于即时播动画 */
function _inNonChatPage() {
  const v = document.body.dataset.view;
  return v === 'home' || v === 'chatlist' || v === 'moments' || v === 'discover';
}

/* 统一投递：角色发给玩家的消息（text/查岗等）——他访客消息不进当前聊天页 */
async function deliverCharMessage(c, content, type = 'text', extra = null) {
  const m = { id: uid('msg'), charId: c.id, from: 'them', type, content, time: Date.now() };
  if (extra) m.content = extra;
  await idbPut('messages', m);
  const cs = getCharChatSettings(c);
  if (_inChatWith(c.id)) {
    appendMessage(m);
    // 20260929aw：正在看的消息直接标记已读——防退出聊天后导航页仍提示未读
    setSetting('lastRead_' + c.id, Date.now());
    // 20260930：聊天页内当前角色发消息也响提示音（其他角色不响）
    if (shouldDingFor(c)) playDing();
    return;
  }
  // 不在该访客聊天页：累计未读普通消息计数（>10 条才提示）
  const e = _ev(c.id);
  e.msgs = (e.msgs || 0) + 1;
  await _saveUnreadEvents();
  renderChatList();
  refreshUnreadBadges();
  // 只有该访客未读普通消息超过 10 条才弹横幅（且避免刷屏：恰好跨过 10 时才提示一次）
  // 20260929be 细则三：60 秒窗口内超 3 个访客发来东西 → 聚合卡片取代单条横幅
  if (e.msgs === 11 && !_noteCrossPageIncoming(c.id)) {
    showTopBanner(`<b>${escapeHtml(c.name)}</b> 给你发送了一些消息<div class="tb-sub">点进与 TA 的聊天查看</div>`, { charId: c.id });
  }
  if (shouldDingFor(c)) playDing();
  notifyIncoming(c, typeof content === 'string' ? content : '（查岗卡片）'); // 20260929bi：收敛到统一通知出口（含挂后台）
}

/* ---------- 通用文件导出（20260929p：根治"假导出"）
   旧写法 a.click() 后同步 revokeObjectURL——下载还没启动就被撤销，且 <a> 没挂 DOM，
   所有导出只弹提示、不出文件。
   现在分两段用：
   ① beginExport(文件名)：在点击的用户激活期内立刻取保存句柄——
      PC Chrome/Edge 会弹真实"另存为"对话框（可自选文件夹）；
      用户取消 → 返回 {cancelled:true}；环境不支持/激活过期 → 静默降级为下载。
   ② finishExport(save, blob, 提示)：有句柄写入所选位置；否则 <a download> 触发
      浏览器下载（安卓手机浏览器进"下载"目录，通知栏可见），<a> 挂 body、
      延迟 4s 再撤销 ObjectURL，给下载留足启动时间。 ---------- */
async function beginExport(filename) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename });
      return { filename, handle };
    } catch (e) {
      if (e && e.name === 'AbortError') { miniToast('已取消导出'); return { filename, cancelled: true }; }
      // 其他异常（激活过期/预览面板 iframe 安全策略拦截"另存为"）：提示降级，不再静默——
      // 20260929z：此前静默降级+iframe 内下载被宿主拦截时用户侧零反馈，看起来像"点了没反应"
      const inIframe = (() => { try { return window.self !== window.top; } catch (err) { return true; } })();
      miniToast(inIframe
        ? '当前面板弹不出保存窗口，已改为直接下载；若无反应请复制 8902 地址到浏览器打开后重试'
        : '当前环境不支持"另存为"，已改为直接下载');
    }
  }
  return { filename };
}
async function finishExport(save, blob, okMsg) {
  if (!save || save.cancelled) return false;
  if (save.handle) {
    // 已经弹过"另存为"（用户选好了位置）：写入失败时绝不能再降级 <a download>——
    // 那会触发第二次保存弹窗（"导出弹两次窗"的根源）。先重试一次，仍失败就明确报错。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const w = await save.handle.createWritable();
        await w.write(blob);
        await w.close();
        miniToast(okMsg + '（已保存到你选择的文件夹）');
        return true;
      } catch (e) { /* 重试一次；两次都失败则报错终止 */ }
    }
    miniToast('写入所选文件夹失败，请重试导出');
    return false;
  }
  // 20261001ck：APK（Capacitor 环境）里 <a download> 是 no-op（WebView 无 DownloadListener，
  //   点了静默无反应、文件永远下不来）。改用 @capacitor/filesystem 写进公共「文档」目录
  //   （Directory.Documents = /storage/emulated/0/Documents/，属公共区域，
  //   卸载应用不会被删除——正是「卸载重装读数据」的备份落点）。
  const FS = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
  if (FS && FS.writeFile) {
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); };
        r.onerror = () => rej(new Error('读取失败'));
        r.readAsDataURL(blob);
      });
      // Directory.Documents = 'DOCUMENTS'（公共文档目录，卸载不删）；recursive 建父目录
      await FS.writeFile({ path: '白日梦备份/' + save.filename, data: b64, directory: 'DOCUMENTS', recursive: true });
      miniToast(okMsg + '（已存到「文档/白日梦备份」，卸载重装后可从该目录导入）');
      return true;
    } catch (e) {
      miniToast('保存到文档目录失败：' + (e && e.message ? e.message : '未知错误'));
      return false;
    }
  }
  // 只有浏览器环境（非 APK）才走 <a download>——全程只有一次交互
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = save.filename;
  a.style.display = 'none';
  document.body.appendChild(a); // 必须挂 DOM，部分浏览器才触发下载
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000); // 延迟撤销，给下载留足启动时间
  miniToast(okMsg + '（已开始下载，见浏览器"下载"目录或通知栏）');
  return true;
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  // 底部导航
  $$('.tab-item').forEach(t => {
    t.onclick = () => { closeModalPanels(); switchView(t.dataset.view); };
  });

  // 添加访客（改为弹出功能菜单：添加访客 / 建立群聊 / 批量管理 / 访客分组）
  $('#btn-add-char').onclick = showChatListMenu;
  // 访客分组管理
  $('#btn-char-groups').onclick = () => showCharGroupsModal();

  // 聊天页返回
  $('#btn-chat-back').onclick = () => { closeModalPanels(); cancelQuote(); switchView('chatlist'); };
  $('#btn-char-profile').onclick = () => showCharProfile();
  // 20260929af：顶栏 AI/字卡模式开关（三个点左侧），切换带「滴」声；be 起逻辑抽为共用函数
  $('#btn-chat-aimode').onclick = () => toggleAImodeFromUI();
  // 20260929be：朋友圈顶栏同款 AI/字卡开关
  $('#btn-moments-aimode').onclick = () => toggleAImodeFromUI();
  // 5.2：点击聊天页中的梦角头像也可进入梦角主页（箭头包装，防止 Event 被当成 charId）
  $('#chat-header').onclick = () => showCharProfile();

  // 发送消息
  $('#btn-send').onclick = () => { hideAtPopover(); sendMessage($('#chat-input').value); };
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      hideAtPopover();
      sendMessage($('#chat-input').value);
    } else if (e.key === 'Escape') {
      hideAtPopover();
    }
  });
  // 20260929ba 细则六：输入 @ 自动弹出群成员列表，点选直接补全（仅群聊）
  $('#chat-input').addEventListener('input', () => updateAtPopover());
  document.addEventListener('click', (e) => {
    const pop = $('#at-popover');
    if (pop && !e.target.closest('#at-popover') && e.target.id !== 'chat-input') hideAtPopover();
  });

  // 聊天底部：功能面板（5.5）、表情包+戳一戳合并面板
  $('#btn-plus').onclick = () => togglePanel('plus-panel');
  $('#btn-emoji').onclick = () => { togglePanel('emoji-panel'); };
  // 聊天输入栏右侧模拟通话按钮（5.8）
  $('#btn-call').onclick = () => {
    // 20260929ba：群聊模式 = 群通话（勾选多名成员发起），不再误入单聊通话弹窗
    if (currentGroupId) {
      const g = chatGroups.find(x => x.id === currentGroupId);
      if (g) { showGroupCallModal(g); return; }
    }
    showCallModal();
  };
  // 表情包/Emoji 库/戳一戳 tab 切换（20260929ah：Emoji 库独立分类）
  document.querySelectorAll('[data-etab]').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('[data-etab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.etab;
      const isPoke = which === 'poke';
      const isLib = which === 'emojilib';
      $('#emoji-grid').style.display = (isPoke || isLib) ? 'none' : '';
      $('#emojilib-grid').style.display = isLib ? '' : 'none';
      $('#poke-list').style.display = isPoke ? '' : 'none';
      // 20260929ba：戳一戳 tab 显示专属添加按钮（添加窗口，不再是图片上传）
      $('#emoji-add-btn').style.display = isLib ? 'none' : '';
      $('#btn-emoji-manage').style.display = (isPoke || isLib) ? 'none' : '';
      if (isPoke) {
        $('#emoji-add-btn').setAttribute('data-poke-add', '1');
        $('#emoji-add-btn').innerHTML = '＋ 添加戳一戳';
        $('#emoji-add-btn').removeAttribute('for');
      } else {
        $('#emoji-add-btn').removeAttribute('data-poke-add');
        $('#emoji-add-btn').innerHTML = '＋ 添加';
        $('#emoji-add-btn').setAttribute('for', 'emoji-file-input');
      }
      if (isLib) renderEmojiLib();
    };
  });
  // 表情包上传：input 由面板内 label 原生触发（兼容沙箱/WebView，不依赖 JS click）
  $('#emoji-file-input').onchange = async () => {
    const inp = $('#emoji-file-input');
    if (inp.files.length) {
      await addEmojiFiles(inp.files);
      renderEmojiGrid();
    }
    inp.value = '';
  };
  $('#btn-emoji-manage').onclick = () => {
    emojiManageMode = !emojiManageMode;
    renderEmojiGrid();
    miniToast(emojiManageMode ? '管理模式：点 ✕ 删除表情包' : '已退出管理模式');
  };
  // 20260929ba：戳一戳 tab 的添加按钮 → 添加戳一戳文案弹窗（面板保持打开，关闭弹窗即回戳一戳）
  $('#emoji-add-btn').onclick = (e) => {
    if (!$('#emoji-add-btn').hasAttribute('data-poke-add')) return; // 表情包 tab：label 原生触发文件选择
    e.preventDefault();
    showPlayerPokeAddModal();
  };

  // 玩家个人主页
  $('#btn-daily-open').onclick = () => showTodayCardModal();
  $('#btn-anniversary').onclick = () => showAnniversaryModal();
  // 20260930bx：顶栏「开屏音乐继续播放」小开关（纪念日右侧）——
  // 开=开屏结束后音乐继续循环播放贯穿整个使用过程；关=开屏结束即收（并立即停掉正在播的音乐）
  (async () => {
    const mb = $('#btn-splash-music');
    if (!mb) return;
    const paint = () => {
      const on = _splashAutoplay;
      mb.style.background = on ? 'var(--purple-dim)' : '';
      mb.style.color = on ? 'var(--purple-soft)' : '';
      mb.style.opacity = on ? '1' : '0.6';
      mb.title = on ? '开屏音乐：继续播放中（点击关闭）' : '开屏音乐：开屏结束即停（点击开启继续播放）';
    };
    _splashAutoplay = (await getSetting('splashAutoplay', '0')) === '1';
    paint();
    mb.onclick = async () => {
      _splashAutoplay = !_splashAutoplay;
      await setSetting('splashAutoplay', _splashAutoplay ? '1' : '0');
      paint();
      if (_splashAutoplay) {
        // 20260930by：开关打开=立即从头播放（无论开屏是否结束）；若已在播则延续不重播
        try { window.dispatchEvent(new CustomEvent('bm-splash-music-start')); } catch (e) {}
        miniToast('已开启：开屏音乐从头播放，并贯穿全程');
      } else {
        try { window.dispatchEvent(new CustomEvent('bm-splash-music-stop')); } catch (e) {}
        miniToast('已关闭：音乐已淡出停止');
      }
    };
  })();
  // 20260929al：编辑资料热区覆盖整个头像（此前只绑头像圆本身，热区小且偏上不好点）
  const avWrap = $('#hero-avatar-wrap');
  if (avWrap) avWrap.onclick = showEditProfileModal;
  else $('#player-avatar').onclick = showEditProfileModal;
  // 更换背景 → 弹窗（上传/删除合并在同一个弹窗里）
  $('#btn-bg-change').onclick = () => showHomeBgModal();
  // 个人主页滚动：遮住昵称时，顶栏浮现头像+昵称（从下滑出的衔接动画）并切换为背景主色
  // 20260929bb：向下滚动时顶栏的「更换背景」按钮淡出，滚回顶部（≤40px）才重新出现
  const hs = $('#home-scroll');
  if (hs) {
    hs.addEventListener('scroll', () => {
      const tb = $('#home-topbar');
      if (tb) {
        // 阈值 240 = 原 170 + 顶栏高度（一体式后 hero 从视口顶开始，补偿 70px 保持相同浮现时机）
        if (hs.scrollTop > 240) tb.classList.add('scrolled');
        else tb.classList.remove('scrolled');
      }
      const bgBtn = $('#btn-bg-change');
      if (bgBtn) bgBtn.classList.toggle('bgbtn-hidden', hs.scrollTop > 40);
    }, { passive: true });
  }
  // 聊天导航页/朋友圈顶栏：平时与背景一体，下滑超过阈值浮现背景主色半透明条（20260929u）
  const clScroll = $('#chat-list');
  if (clScroll) {
    clScroll.addEventListener('scroll', () => {
      const tb = document.querySelector('#view-chatlist .topbar');
      if (tb) tb.classList.toggle('scrolled', clScroll.scrollTop > 24);
    }, { passive: true });
  }
  const moScroll = $('#moments-scroll');
  if (moScroll) {
    moScroll.addEventListener('scroll', () => {
      const tb = $('#moments-topbar');
      if (tb) tb.classList.toggle('scrolled', moScroll.scrollTop > 24);
    }, { passive: true });
  }
  $('#stat-wallet-card').onclick = showWalletModal;
  $('#btn-home-cards').onclick = () => showCardsModal();
  $('#btn-home-theme').onclick = () => showChatThemeModal();
  $('#btn-home-chatsettings').onclick = () => showChatSettingsModal(); // 5.3 聊天设置
  $('#btn-home-settings').onclick = () => showSettingsModal();          // 18.1 总设置
  $('#btn-home-data').onclick = () => showDataModal();
  $('#btn-home-ai').onclick = () => showAIConfigModal(); // 20260929ae：API 接入
  $('#btn-home-emoji').onclick = () => showEmojiManagerModal();
  $('#btn-home-memory').onclick = () => showMemoryPalaceModal(); // 记忆宫殿：朋友圈分享存入的记忆
  $('#btn-home-world').onclick = () => showWorldBookModal();
  $('#btn-home-relations').onclick = () => showRelationsModal();

  // 朋友圈发布入口
  $('#btn-moments-publish').onclick = () => showPublishMomentModal();
  $('#btn-moments-bg').onclick = () => showMomentsCoverModal(); // 更换的是朋友圈顶部封面图（不是主页背景）
  // 20260929ax：朋友圈右上角「我」的名片（头像/昵称/签名）点击 → 编辑玩家资料（与个人主页头像一致）
  const meCard = document.querySelector('.mc-me');
  if (meCard) {
    meCard.style.cursor = 'pointer';
    meCard.title = '点击编辑资料';
    meCard.addEventListener('click', (e) => { e.stopPropagation(); showEditProfileModal(); });
  }
}

/* 弹卡查看（玩家主页右上角入口，7.1：当天内容固定不变） */
async function showTodayCardModal() {
  const d = await getTodayCard();
  openDailyCardModal(d, closeModal);
}

/* ---------- 字卡库管理弹窗 ---------- */
/* 字卡库模块 tab（6.1：普通字卡/访客戳一戳/玩家戳一戳/状态/寄语/表情 分区展示）
   戳一戳分两库：访客戳一戳（角色戳玩家时抽）+ 玩家戳一戳（玩家在聊天页 + 面板用，初始为空） */
const CARD_MODULES = [
  { key: 'replies', label: '回复字卡' },
  { key: 'pokes', label: '访客戳一戳' },
  { key: 'playerPokes', label: '玩家戳一戳' },
  { key: 'statuses', label: '状态' },
  { key: 'mottos', label: '寄语' },
  { key: 'emojis', label: '表情' },
];

function showCardsModal() {
  const tab = window._cardsTab || 'replies';
  const batch = !!window._cardsBatch;
  const total = cards.customReplies.length + cards.customReplyGroups.reduce((s, g) => s + g.items.length, 0);

  // 各模块渲染（普通字卡分区展示未分组+分组；其他模块简单列表）
  let body = '';
  if (tab === 'replies') {
    body = `
      <div style="margin-bottom:16px;">
        <div style="font-size:14px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;background:var(--bg-elevated-2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;" data-fold-ungroup>
          <span style="display:flex;align-items:center;gap:6px;">
            ${batch ? `<span class="bg-check" data-folder-ungroup style="width:18px;height:18px;border-radius:6px;border:2px solid var(--text-tertiary);display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#141019;flex-shrink:0;"></span>` : ''}
            <span style="color:var(--text-tertiary);font-size:12px;transition:transform .15s;">${window._ungroupCollapsed ? '▸' : '▾'}</span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#8b8b94;"></span>
            未分组字卡（${cards.customReplies.length}）
          </span>
        </div>
        <div style="display:${window._ungroupCollapsed ? 'none' : 'flex'};flex-wrap:wrap;gap:6px;padding:10px 4px;max-height:180px;overflow-y:auto;" id="cards-ungrouped">
          ${cards.customReplies.map((t, i) => batch
            ? `<span class="badge" style="cursor:pointer;max-width:100%;" title="${escapeHtml(t)}" data-sel-ungroup="${i}">${escapeHtml(cardBrief(t))}</span>`
            : `<span class="badge" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;max-width:100%;" title="${escapeHtml(t)}" data-idx="${i}">${escapeHtml(cardBrief(t))} ✕</span>`
          ).join('') || '<span style="color:var(--text-tertiary);font-size:12px;">（空）</span>'}
        </div>
      </div>

      ${cards.customReplyGroups.map((g, gi) => {
        const collapsed = !!g._collapsed;
        // 名字兜底：横线名/空名分组（导入包分隔行产物）显示"未命名分组"，不渲染横线
        const gName = (typeof g.name === 'string' && g.name.trim() && !isLineJunkText(g.name)) ? g.name : '未命名分组';
        return `
        <div style="margin-bottom:16px;border:1px solid var(--border);border-radius:14px;overflow:hidden;">
          <div style="font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:space-between;padding:11px 12px;cursor:pointer;background:var(--bg-elevated-2);" data-fold-group="${gi}">
            <span style="display:flex;align-items:center;gap:6px;">
              ${batch ? `<span class="bg-check" data-folder="${gi}" style="width:18px;height:18px;border-radius:6px;border:2px solid var(--text-tertiary);display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#141019;flex-shrink:0;cursor:pointer;"></span>` : ''}
              <span style="color:var(--text-tertiary);font-size:12px;transition:transform .15s;">${collapsed ? '▸' : '▾'}</span>
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.color};"></span>
              ${escapeHtml(gName)}（${g.items.length}）${g.disabled ? '<span style="color:var(--danger);font-size:11px;">已禁用</span>' : ''}
            </span>
            ${batch ? '' : `<span class="badge" style="cursor:pointer;color:var(--danger);" data-delgroup="${gi}" title="删除分组">删</span>`}
          </div>
          <div style="display:${collapsed ? 'none' : 'flex'};flex-wrap:wrap;gap:6px;padding:12px;">
            ${g.items.length === 0 ? '<span style="color:var(--text-tertiary);font-size:12px;">（空分组）</span>' : g.items.map((t, ii) => batch
              ? `<span class="badge" style="cursor:pointer;max-width:100%;" title="${escapeHtml(t)}" data-sel-group="${gi}" data-sel-i="${ii}">${escapeHtml(cardBrief(t))}</span>`
              : `<span class="badge" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;max-width:100%;" title="${escapeHtml(t)}" data-g="${gi}" data-i="${ii}">${escapeHtml(cardBrief(t))} ✕</span>`
            ).join('')}
          </div>
        </div>`;
      }).join('')}
    `;
  } else {
    // 其他模块（访客戳一戳/玩家戳一戳/状态/寄语/表情）：简单列表 + 添加/删除
    const listKey = { pokes: 'customPokes', playerPokes: 'customPlayerPokes', statuses: 'customStatuses', mottos: 'customMottos', emojis: 'customEmojis' }[tab];
    const list = cards[listKey] || [];
    const pokeNote = tab === 'pokes'
      ? '<div style="font-size:12px;color:var(--text-tertiary);margin:-6px 0 12px;">访客戳玩家时从这个库抽取，展示为「访客名 + 文案」，出现在聊天页面中间（不是气泡）</div>'
      : (tab === 'playerPokes'
        ? '<div style="font-size:12px;color:var(--text-tertiary);margin:-6px 0 12px;">你在聊天页 + 面板里使用的戳一戳，展示为「你 + 文案」（可用 TA 指代访客），初始为空、与访客库分开</div>'
        : '');
    body = `
      <div style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">共 ${list.length} 条</div>
      ${pokeNote}
      <div style="max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
        ${list.map((t, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--bg-elevated-2);border:1px solid var(--border);border-radius:10px;">
            <span style="flex:1;font-size:14px;word-break:break-word;">${escapeHtml(t)}</span>
            <button class="badge" style="cursor:pointer;color:var(--danger);flex-shrink:0;" data-mod-del="${i}">删</button>
          </div>`).join('') || '<div style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:24px 0;">还没有内容</div>'}
      </div>
      <div style="display:flex;gap:8px;">
        <input class="input" id="mod-add-input" placeholder="添加一条…" style="flex:1;">
        <button class="btn primary" id="mod-add-btn">添加</button>
      </div>
    `;
  }

  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">字卡库</div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${batch && tab === 'replies' ? `<button class="btn" style="padding:6px 12px;font-size:13px;" id="btn-cards-movetop">移动</button>` : ''}
        <button class="btn" style="padding:6px 12px;font-size:13px;" id="btn-cards-batch">${batch ? '退出批量' : '批量管理'}</button>
        <button class="plus-ring" id="btn-cards-plus" title="新建分组 / 添加字卡 / 过滤重复 / 禁词管理">
          <span class="plus-ring-sym">＋</span>
        </button>
        <button class="icon-btn" id="btn-cards-close">✕</button>
      </div>
    </div>

    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;align-items:center;" id="cards-mod-tabs">
      ${CARD_MODULES.map(m => `<button class="emoji-tab ${m.key === tab ? 'active' : ''}" data-mod="${m.key}">${m.label}</button>`).join('')}
    </div>

    ${tab === 'replies' ? `<div style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">共 ${total} 条字卡 · ${cards.customReplyGroups.length} 个分组${batch ? ' · <span style="color:var(--purple-soft);">批量模式：点击字卡勾选，可整组勾选或移动</span>' : ''}</div>` : ''}

    ${body}

    <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px;">
      ${batch && tab === 'replies' ? `
        <button class="btn danger block" id="btn-cards-batchdel">删除所选字卡</button>
      ` : ''}
      ${batch && tab !== 'replies' ? `<button class="btn block" id="btn-cards-batchnote">该模块暂不支持批量管理</button>` : ''}
      ${!batch && tab === 'replies' ? `
        <div style="display:flex;gap:10px;">
          <button class="btn block" style="flex:1;" id="btn-cards-import">⬆ 导入字卡</button>
          <button class="btn block" style="flex:1;" id="btn-cards-export">⬇ 导出字卡</button>
        </div>
      ` : ''}
    </div>
  `);

  $('#btn-cards-close').onclick = closeModal;
  $('#btn-cards-plus').onclick = () => showCardsPlusMenu();
  $('#btn-cards-batch').onclick = () => {
    window._cardsBatch = !batch;
    showCardsModal();
  };

  // 模块 tab 切换
  document.querySelectorAll('[data-mod]').forEach(el => {
    el.onclick = () => {
      window._cardsTab = el.dataset.mod;
      showCardsModal();
    };
  });

  // 非 replies 模块：添加/删除
  if (tab !== 'replies') {
    const listKey = { pokes: 'customPokes', playerPokes: 'customPlayerPokes', statuses: 'customStatuses', mottos: 'customMottos', emojis: 'customEmojis' }[tab];
    if (!cards[listKey]) cards[listKey] = [];
    document.querySelectorAll('[data-mod-del]').forEach(el => {
      el.onclick = () => {
        const i = parseInt(el.dataset.modDel);
        cards[listKey].splice(i, 1);
        saveCards(cards).then(() => showCardsModal());
      };
    });
    $('#mod-add-btn').onclick = () => {
      const t = $('#mod-add-input').value.trim();
      if (!t) { showToast('内容不能为空'); return; }
      cards[listKey] = cards[listKey] || [];
      cards[listKey].push(t);
      saveCards(cards).then(() => showCardsModal());
    };
    $('#btn-cards-batchnote').onclick = () => miniToast('该模块暂不支持批量管理');
    return;
  }

  // 未分组折叠/展开
  const ungroupHead = document.querySelector('[data-fold-ungroup]');
  if (ungroupHead) {
    ungroupHead.onclick = (ev) => {
      if (ev.target.closest('[data-folder-ungroup]')) return;
      window._ungroupCollapsed = !window._ungroupCollapsed;
      showCardsModal();
    };
  }

  // 分组折叠/展开（点标题切换，状态持久化到 _collapsed）
  document.querySelectorAll('[data-fold-group]').forEach(el => {
    el.onclick = (ev) => {
      if (ev.target.closest('[data-delgroup]')) return; // 点「删」不触发折叠
      if (ev.target.closest('[data-folder]')) return;   // 批量模式点文件夹勾选不触发折叠
      const gi = parseInt(el.dataset.foldGroup);
      const g = cards.customReplyGroups[gi];
      g._collapsed = !g._collapsed;
      saveCards(cards).then(() => showCardsModal());
    };
  });

  if (batch) {
    // 批量模式：勾选逻辑（单条 + 整文件夹 + 未分组整体）
    const selUngroup = new Set();
    const selGroup = new Set(); // "gi:ii"
    const applyHighlight = () => {
      document.querySelectorAll('[data-sel-ungroup]').forEach(el => {
        const i = parseInt(el.dataset.selUngroup);
        const on = selUngroup.has(i);
        el.style.background = on ? 'var(--purple)' : '';
        el.style.color = on ? '#141019' : '';
      });
      document.querySelectorAll('[data-sel-group]').forEach(el => {
        const key = el.dataset.selGroup + ':' + el.dataset.selI;
        const on = selGroup.has(key);
        el.style.background = on ? 'var(--purple)' : '';
        el.style.color = on ? '#141019' : '';
      });
      // 分组文件夹勾选框状态（全选时高亮）
      document.querySelectorAll('[data-folder]').forEach(el => {
        const gi = parseInt(el.dataset.folder);
        const g = cards.customReplyGroups[gi];
        const all = (g.items || []).map((_, ii) => `${gi}:${ii}`);
        const selCount = all.filter(k => selGroup.has(k)).length;
        const full = all.length > 0 && selCount === all.length;
        el.style.background = full ? 'var(--purple)' : '';
        el.style.borderColor = full ? 'var(--purple)' : 'var(--text-tertiary)';
        el.textContent = full ? '✓' : '';
      });
      // 未分组整体勾选框状态
      const unCheck = document.querySelector('[data-folder-ungroup]');
      if (unCheck) {
        const allN = cards.customReplies.length;
        const selN = allN > 0 ? cards.customReplies.filter((_, i) => selUngroup.has(i)).length : 0;
        const full = allN > 0 && selN === allN;
        unCheck.style.background = full ? 'var(--purple)' : '';
        unCheck.style.borderColor = full ? 'var(--purple)' : 'var(--text-tertiary)';
        unCheck.textContent = full ? '✓' : '';
      }
    };
    document.querySelectorAll('[data-sel-ungroup]').forEach(el => {
      el.onclick = () => { const i = parseInt(el.dataset.selUngroup); selUngroup.has(i) ? selUngroup.delete(i) : selUngroup.add(i); applyHighlight(); };
    });
    document.querySelectorAll('[data-sel-group]').forEach(el => {
      el.onclick = () => { const key = el.dataset.selGroup + ':' + el.dataset.selI; selGroup.has(key) ? selGroup.delete(key) : selGroup.add(key); applyHighlight(); };
    });
    // 分组整体勾选
    document.querySelectorAll('[data-folder]').forEach(el => {
      el.onclick = () => {
        const gi = parseInt(el.dataset.folder);
        const g = cards.customReplyGroups[gi];
        const keys = (g.items || []).map((_, ii) => `${gi}:${ii}`);
        const allOn = keys.length > 0 && keys.every(k => selGroup.has(k));
        keys.forEach(k => allOn ? selGroup.delete(k) : selGroup.add(k));
        applyHighlight();
      };
    });
    // 未分组整体勾选
    const unCheck = document.querySelector('[data-folder-ungroup]');
    if (unCheck) {
      unCheck.onclick = () => {
        const allN = cards.customReplies.length;
        const allOn = allN > 0 && cards.customReplies.every((_, i) => selUngroup.has(i));
        cards.customReplies.forEach((_, i) => allOn ? selUngroup.delete(i) : selUngroup.add(i));
        applyHighlight();
      };
    }

    // 移动所选字卡（顶部「移动」按钮 → 弹窗：选分组 / 新建分组）
    const moveTop = $('#btn-cards-movetop');
    if (moveTop) {
      moveTop.onclick = () => {
        const count = selUngroup.size + selGroup.size;
        if (count === 0) { showToast('请先勾选要移动的字卡'); return; }
        showCardMoveModal(() => {
          // 返回 { targetName } 或 { newGroupName }
        }, (targetName) => {
          // 执行移动
          let target = cards.customReplyGroups.find(g => g.name === targetName);
          if (!target) {
            target = { id: uid('group'), name: targetName, color: '#a78bfa', disabled: false, _collapsed: false, items: [] };
            cards.customReplyGroups.push(target);
          }
          let moved = 0;
          const groupDel = {};
          selGroup.forEach(k => {
            const [g, i] = k.split(':').map(Number);
            (groupDel[g] = groupDel[g] || []).push(i);
          });
          Object.keys(groupDel).forEach(g => {
            const idxs = groupDel[g].sort((a, b) => b - a);
            idxs.forEach(i => { target.items.push(cards.customReplyGroups[g].items[i]); moved++; });
            idxs.forEach(i => cards.customReplyGroups[g].items.splice(i, 1));
          });
          const ungroupIdx = [...selUngroup].sort((a, b) => b - a);
          ungroupIdx.forEach(i => { target.items.push(cards.customReplies[i]); moved++; });
          ungroupIdx.forEach(i => cards.customReplies.splice(i, 1));
          saveCards(cards).then(() => {
            miniToast(`已移动 ${moved} 条字卡到「${targetName}」`);
            showCardsModal();
          });
        });
      };
    }

    $('#btn-cards-batchdel').onclick = () => {
      const ungroupIdx = [...selUngroup].sort((a, b) => b - a);
      ungroupIdx.forEach(i => cards.customReplies.splice(i, 1));
      const groupDel = {};
      selGroup.forEach(k => {
        const [g, i] = k.split(':').map(Number);
        (groupDel[g] = groupDel[g] || []).push(i);
      });
      Object.keys(groupDel).forEach(g => {
        const idxs = groupDel[g].sort((a, b) => b - a);
        idxs.forEach(i => cards.customReplyGroups[g].items.splice(i, 1));
      });
      saveCards(cards).then(() => showCardsModal());
    };
    return;
  }

  // 删除未分组字卡
  document.querySelectorAll('#cards-ungrouped [data-idx]').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.idx);
      cards.customReplies.splice(idx, 1);
      saveCards(cards).then(() => showCardsModal());
    };
  });

  // 删除分组内字卡
  document.querySelectorAll('[data-g][data-i]').forEach(el => {
    el.onclick = () => {
      const g = parseInt(el.dataset.g), i = parseInt(el.dataset.i);
      cards.customReplyGroups[g].items.splice(i, 1);
      saveCards(cards).then(() => showCardsModal());
    };
  });

  // 删除分组
  document.querySelectorAll('[data-delgroup]').forEach(el => {
    el.onclick = () => {
      const g = parseInt(el.dataset.delgroup);
      showConfirm(`删除分组「${cards.customReplyGroups[g].name}」？组内字卡将一并删除。`, () => {
        cards.customReplyGroups.splice(g, 1);
        saveCards(cards).then(() => showCardsModal());
      });
    };
  });

  $('#btn-cards-import').onclick = () => showCardImportModal();

  $('#btn-cards-export').onclick = async () => {
    // 导出前自动去重（持久化后台进行，不阻塞导出；导出的就是去重后的内存数据）
    const { removed } = dedupeCards(cards);
    saveCards(cards).catch(() => {});
    const save = await beginExport('字卡库.json'); // 紧跟点击，用户激活新鲜
    if (save.cancelled) return;
    const blob = new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' });
    await finishExport(save, blob, removed > 0 ? `已导出字卡库（自动过滤重复 ${removed} 条）` : '已导出字卡库');
  };
}

/* 字卡库加号圆环按钮 → 弹窗（新建分组 / 添加字卡 / 过滤重复字卡 / 字卡禁词管理） */
function showCardsPlusMenu() {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">字卡功能</div>
      <button class="icon-btn" id="cp-close">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn block" style="justify-content:flex-start;" id="cp-addgroup">
        <span class="func-ic">${icon('cards', 16)}</span><span>新建分组</span>
      </button>
      <button class="btn block" style="justify-content:flex-start;" id="cp-add">
        <span class="func-ic">${icon('plus', 16)}</span><span>添加字卡</span>
      </button>
      <button class="btn block" style="justify-content:flex-start;" id="cp-dedupe">
        <span class="func-ic">🧹</span><span>过滤重复字卡</span>
      </button>
      <button class="btn block" style="justify-content:flex-start;" id="cp-banwords">
        <span class="func-ic">🚫</span><span>字卡禁词管理</span>
      </button>
    </div>
  `);
  $('#cp-close').onclick = () => showCardsModal();
  $('#cp-addgroup').onclick = () => showCardGroupModal();
  $('#cp-add').onclick = () => showCardInputModal('添加字卡', '', (text) => {
    cards.customReplies.push(text);
    saveCards(cards).then(() => showCardsModal());
  });
  $('#cp-dedupe').onclick = () => {
    const { removed } = dedupeCards(cards);
    saveCards(cards).then(() => {
      if (removed > 0) miniToast(`已过滤重复字卡 ${removed} 条`);
      else miniToast('没有发现重复字卡');
      showCardsModal();
    });
  };
  $('#cp-banwords').onclick = () => showGlobalBanWordsModal();
}

/* 移动字卡弹窗：选择已有分组 或 新建分组（可输入名字） */
function showCardMoveModal(onOpen, onMove) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">移动字卡</div>
      <button class="icon-btn" id="move-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">将选中的字卡移动到某个分组，或直接建立一个新的分组</div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">移动到已有分组</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;max-height:200px;overflow-y:auto;" id="move-group-list">
      ${cards.customReplyGroups.length === 0
        ? '<div style="color:var(--text-tertiary);font-size:13px;">还没有分组，可在下方新建</div>'
        : cards.customReplyGroups.map(g => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;" data-movegroup="${escapeHtml(g.name)}">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.color};"></span>
            <div style="flex:1;font-size:14px;font-weight:600;">${escapeHtml(g.name)}</div>
            <div style="font-size:12px;color:var(--text-tertiary);">${(g.items || []).length} 条</div>
            <span style="color:var(--purple-soft);">›</span>
          </div>`).join('')}
    </div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">新建分组</div>
    <div style="display:flex;gap:8px;margin-bottom:4px;">
      <input class="input" id="move-new-name" placeholder="输入新分组名字…" style="flex:1;">
      <button class="btn primary" id="move-new-btn">新建并移动</button>
    </div>
  `);
  $('#move-close').onclick = () => showCardsModal();
  // 选择已有分组
  document.querySelectorAll('[data-movegroup]').forEach(el => {
    el.onclick = () => {
      const name = el.dataset.movegroup;
      onMove(name);
    };
  });
  // 新建分组并移动
  $('#move-new-btn').onclick = () => {
    const name = $('#move-new-name').value.trim();
    if (!name) { showToast('请填写新分组名字'); return; }
    onMove(name);
  };
  $('#move-new-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#move-new-btn').click();
  });
}

/* 字卡输入弹窗（添加/编辑字卡文本） */
function showCardInputModal(title, initial, onSave) {
  openModal(`
    <div style="font-size:18px;font-weight:600;margin-bottom:16px;">${title}</div>
    <div class="field">
      <textarea class="textarea" id="card-input-text" placeholder="输入字卡内容…" style="min-height:120px;">${escapeHtml(initial)}</textarea>
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="card-input-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="card-input-save">确定</button>
    </div>
  `);
  $('#card-input-cancel').onclick = closeModal;
  $('#card-input-save').onclick = () => {
    const t = $('#card-input-text').value.trim();
    if (!t) { showToast('内容不能为空'); return; }
    closeModal();
    onSave(t);
  };
}

/* 新建分组弹窗 */
function showCardGroupModal() {
  openModal(`
    <div style="font-size:18px;font-weight:600;margin-bottom:16px;">新建分组</div>
    <div class="field">
      <label>分组名称</label>
      <input class="input" id="group-name" placeholder="如：撒娇、晚安…">
    </div>
    <div class="field">
      <label>分组颜色</label>
      <input type="color" id="group-color" value="#a78bfa" style="width:100%;height:40px;border:none;background:none;cursor:pointer;">
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="group-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="group-save">创建</button>
    </div>
  `);
  $('#group-cancel').onclick = closeModal;
  $('#group-save').onclick = () => {
    const name = $('#group-name').value.trim();
    if (!name) { showToast('请填写分组名称'); return; }
    cards.customReplyGroups.push({
      id: uid('group'),
      name,
      color: $('#group-color').value,
      disabled: false,
      _collapsed: false,
      items: [],
    });
    saveCards(cards).then(() => showCardsModal());
  };
}

/* ---------- 全局字卡禁词管理（5.11：独立于访客禁词，含文件夹分类 + 批量管理） ---------- */
function showGlobalBanWordsModal() {
  cards.customBanWords = cards.customBanWords || [];
  cards.customBanWordGroups = cards.customBanWordGroups || [];
  const batch = !!window._banBatch;

  const total = cards.customBanWords.length + cards.customBanWordGroups.reduce((s, g) => s + (g.items || []).length, 0);
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">字卡禁词</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn" style="padding:6px 12px;font-size:13px;" id="ban-batch">${batch ? '退出批量' : '批量管理'}</button>
        <button class="icon-btn" id="ban-close">✕</button>
      </div>
    </div>
    <div style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">
      全局字卡禁词：抽取任何字卡时都会过滤掉包含这些词的条目。共 ${total} 条${batch ? ' · <span style="color:var(--purple-soft);">批量模式：点击勾选</span>' : ''}
    </div>

    <div style="margin-bottom:14px;">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px;">未分组禁词（${cards.customBanWords.length}）</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;min-height:20px;" id="banb-ungrouped">
        ${cards.customBanWords.map((w, i) => batch
          ? `<span class="badge" style="cursor:pointer;" data-bsel="${i}">${escapeHtml(w)}</span>`
          : `<span class="badge" style="display:inline-flex;gap:4px;cursor:pointer;" data-bdel="${i}">${escapeHtml(w)} ✕</span>`
        ).join('')}
      </div>
    </div>

    ${cards.customBanWordGroups.map((g, gi) => `
      <div style="margin-bottom:14px;">
        <div style="font-size:14px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.color || '#a78bfa'};margin-right:6px;"></span>${escapeHtml(g.name)}（${(g.items || []).length}）</span>
          ${batch ? '' : `<span class="badge" style="cursor:pointer;color:var(--danger);" data-bdelgroup="${gi}">删</span>`}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${(g.items || []).map((w, ii) => batch
            ? `<span class="badge" style="cursor:pointer;" data-bgsel="${gi}" data-bgseli="${ii}">${escapeHtml(w)}</span>`
            : `<span class="badge" style="display:inline-flex;gap:4px;cursor:pointer;" data-bg="${gi}" data-bi="${ii}">${escapeHtml(w)} ✕</span>`
          ).join('')}
        </div>
      </div>
    `).join('')}

    <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px;">
      ${batch ? `
        <button class="btn danger block" id="ban-batchdel">删除所选禁词</button>
      ` : `
        <div style="display:flex;gap:8px;margin-bottom:6px;">
          <input class="input" id="ban-input" placeholder="输入禁词" style="flex:1;">
          <button class="btn primary" id="ban-add">添加</button>
        </div>
        <button class="btn block" id="ban-addgroup">📁 新建禁词分组</button>
      `}
    </div>
  `);

  $('#ban-close').onclick = closeModal;
  $('#ban-batch').onclick = () => { window._banBatch = !batch; showGlobalBanWordsModal(); };

  if (batch) {
    const sel = new Set(); // 存 "u:i" 或 "g:gi:ii"
    const apply = () => {
      document.querySelectorAll('[data-bsel]').forEach(el => {
        const on = sel.has('u:' + el.dataset.bsel);
        el.style.background = on ? 'var(--purple)' : ''; el.style.color = on ? '#141019' : '';
      });
      document.querySelectorAll('[data-bgsel]').forEach(el => {
        const on = sel.has('g:' + el.dataset.bgsel + ':' + el.dataset.bgseli);
        el.style.background = on ? 'var(--purple)' : ''; el.style.color = on ? '#141019' : '';
      });
    };
    document.querySelectorAll('[data-bsel]').forEach(el => {
      el.onclick = () => { const k = 'u:' + el.dataset.bsel; sel.has(k) ? sel.delete(k) : sel.add(k); apply(); };
    });
    document.querySelectorAll('[data-bgsel]').forEach(el => {
      el.onclick = () => { const k = 'g:' + el.dataset.bgsel + ':' + el.dataset.bgseli; sel.has(k) ? sel.delete(k) : sel.add(k); apply(); };
    });
    $('#ban-batchdel').onclick = () => {
      const ungroupIdx = [...sel].filter(k => k.startsWith('u:')).map(k => parseInt(k.slice(2))).sort((a, b) => b - a);
      ungroupIdx.forEach(i => cards.customBanWords.splice(i, 1));
      const groupDel = {};
      [...sel].filter(k => k.startsWith('g:')).forEach(k => {
        const [, gi, ii] = k.split(':').map(Number);
        (groupDel[gi] = groupDel[gi] || []).push(ii);
      });
      Object.keys(groupDel).forEach(gi => {
        groupDel[gi].sort((a, b) => b - a).forEach(ii => cards.customBanWordGroups[gi].items.splice(ii, 1));
      });
      saveCards(cards).then(() => showGlobalBanWordsModal());
    };
    return;
  }

  // 删除未分组禁词
  document.querySelectorAll('[data-bdel]').forEach(el => {
    el.onclick = () => { cards.customBanWords.splice(parseInt(el.dataset.bdel), 1); saveCards(cards).then(() => showGlobalBanWordsModal()); };
  });
  // 删除分组内禁词
  document.querySelectorAll('[data-bg][data-bi]').forEach(el => {
    el.onclick = () => {
      cards.customBanWordGroups[parseInt(el.dataset.bg)].items.splice(parseInt(el.dataset.bi), 1);
      saveCards(cards).then(() => showGlobalBanWordsModal());
    };
  });
  // 删除分组
  document.querySelectorAll('[data-bdelgroup]').forEach(el => {
    el.onclick = () => {
      const g = parseInt(el.dataset.bdelgroup);
      showConfirm(`删除禁词分组「${cards.customBanWordGroups[g].name}」？组内禁词将一并删除。`, () => {
        cards.customBanWordGroups.splice(g, 1);
        saveCards(cards).then(() => showGlobalBanWordsModal());
      });
    };
  });

  $('#ban-add').onclick = () => {
    const v = $('#ban-input').value.trim();
    if (v && !cards.customBanWords.includes(v)) {
      cards.customBanWords.push(v);
      saveCards(cards).then(() => showGlobalBanWordsModal());
    }
  };
  $('#ban-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ban-add').click(); });

  $('#ban-addgroup').onclick = () => {
    openModal(`
      <div style="font-size:18px;font-weight:600;margin-bottom:16px;">新建禁词分组</div>
      <div class="field"><label>分组名称</label><input class="input" id="bang-name" placeholder="如：脏话、敏感词…"></div>
      <div class="field"><label>分组颜色</label><input type="color" id="bang-color" value="#a78bfa" style="width:100%;height:40px;border:none;background:none;cursor:pointer;"></div>
      <div style="display:flex;gap:10px;">
        <button class="btn" style="flex:1;" id="bang-cancel">取消</button>
        <button class="btn primary" style="flex:1;" id="bang-save">创建</button>
      </div>
    `);
    $('#bang-cancel').onclick = closeModal;
    $('#bang-save').onclick = () => {
      const name = $('#bang-name').value.trim();
      if (!name) { miniToast('请填写分组名称'); return; }
      cards.customBanWordGroups.push({ id: uid('bang'), name, color: $('#bang-color').value, items: [] });
      saveCards(cards).then(() => showGlobalBanWordsModal());
    };
  };
}

/* 导入字卡弹窗（19.4：全模块识别 + 合并/覆盖） */
function showCardImportModal() {
  openModal(`
    <div style="font-size:18px;font-weight:600;margin-bottom:16px;">导入字卡</div>
    <div style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">
      支持三种方式：<br>
      1. 上传字卡 JSON 文件（自动识别全部模块：回复/戳一戳/状态/寄语/简介/表情/分组）<br>
      2. 直接粘贴 JSON 文本<br>
      3. 粘贴纯文本，每行一条字卡
    </div>
    <div class="field">
      <label>上传 JSON 文件</label>
      <input class="input" type="file" id="card-file" accept=".json,.ocdata,.letterdata,.chatdata,application/json,application/octet-stream,text/plain"><!-- accept 放宽：安卓文件选择器常把自定义扩展名归类为 octet-stream/plain，不放宽会选不到备份文件 -->
    </div>
    <div style="text-align:center;color:var(--text-tertiary);font-size:12px;margin:8px 0;">— 或 —</div>
    <div class="field">
      <label>粘贴内容（JSON 或 每行一条）</label>
      <textarea class="textarea" id="card-paste" placeholder='{"customReplies":["字卡1",…]} 或直接每行一条'></textarea>
    </div>
    <div class="field">
      <label>导入方式</label>
      <div style="display:flex;gap:10px;">
        <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;">
          <input type="radio" name="card-import-mode" value="merge" checked style="accent-color:var(--purple);">
          <span style="font-size:14px;">合并导入<span style="display:block;font-size:11px;color:var(--text-tertiary);">保留现有，去重追加</span></span>
        </label>
        <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;">
          <input type="radio" name="card-import-mode" value="overwrite" style="accent-color:var(--purple);">
          <span style="font-size:14px;">覆盖导入<span style="display:block;font-size:11px;color:var(--text-tertiary);">清空现有，完全替换</span></span>
        </label>
      </div>
    </div>
    <div id="card-import-preview" style="display:none;background:var(--purple-dim);border-radius:12px;padding:10px 14px;font-size:13px;color:var(--purple-soft);margin-bottom:12px;"></div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="import-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="import-go">导入</button>
    </div>
  `);
  $('#import-cancel').onclick = closeModal;

  const getMode = () => {
    const r = document.querySelector('input[name="card-import-mode"]:checked');
    return r ? r.value : 'merge';
  };
  // 选了覆盖时给出警示预览
  document.querySelectorAll('input[name="card-import-mode"]').forEach(r => {
    r.onchange = () => {
      const pv = $('#card-import-preview');
      if (getMode() === 'overwrite') {
        pv.style.display = 'block';
        pv.innerHTML = '⚠️ 覆盖导入将清空当前全部字卡数据，用文件内容完全替换。';
      } else {
        pv.style.display = 'none';
      }
    };
  });

  const parseInput = async () => {
    const file = $('#card-file').files[0];
    const paste = $('#card-paste').value.trim();
    let raw = null, isJson = false;
    if (file) {
      raw = await file.text();
      isJson = true;
    } else if (paste) {
      raw = paste;
      isJson = paste.startsWith('{') || paste.startsWith('[');
    }
    if (raw === null) return { error: '请选择文件或粘贴内容' };

    if (isJson) {
      try {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) return { list: data };          // 纯数组 = 一堆字卡
        if (data && typeof data === 'object') return { data };   // 标准字卡 JSON
        return { error: 'JSON 内容无法识别' };
      } catch (e) {
        if (file) return { error: 'JSON 解析失败，请检查文件格式' };
        // 粘贴的文本解析失败 → 当作纯文本
        return { list: raw.split('\n').map(s => s.trim()).filter(Boolean) };
      }
    }
    return { list: raw.split('\n').map(s => s.trim()).filter(Boolean) };
  };

  $('#import-go').onclick = async () => {
    const parsed = await parseInput();
    if (parsed.error) { miniToast(parsed.error); return; }
    const mode = getMode();

    if (parsed.data) {
      const modules = detectCardModules(parsed.data);
      if (modules.length === 0) { miniToast('文件里没有识别到任何字卡模块'); return; }
      const doIt = async () => {
        const stats = await importCardsData(parsed.data, mode);
        closeModal();
        const dedupMsg = stats.deduped > 0 ? `，自动过滤重复字卡 ${stats.deduped} 条` : '';
        const harmMsg = stats.harmonized > 0 ? `，已把 ${stats.harmonized} 条归入对应分组` : '';
        miniToast(`导入成功：新增 ${stats.added} 条${dedupMsg}${harmMsg}`);
        showCardsModal();
      };
      if (mode === 'overwrite') {
        showConfirm(`覆盖导入将清空当前全部字卡（识别到：${modules.join('、')}），确定继续吗？`, doIt);
      } else {
        doIt();
      }
      return;
    }

    if (parsed.list) {
      if (!parsed.list.length) { miniToast('没有可导入的内容'); return; }
      if (mode === 'overwrite') {
        cards.customReplies = parsed.list;
        cards.customReplyGroups = [];
      } else {
        const exist = new Set(cards.customReplies || []);
        cards.customReplies = (cards.customReplies || []).concat(parsed.list.filter(t => !exist.has(t)));
      }
      // 全局去重 + 同步净化（导入文本里混入的横线装饰行立即清掉，不进数据库）
      const { removed } = dedupeCards(cards);
      sanitizeCards(cards);
      await saveCards(cards);
      const dedupMsg = removed > 0 ? `，自动过滤重复 ${removed} 条` : '';
      miniToast(`导入成功：新增 ${parsed.list.length} 条${dedupMsg}`);
      showCardsModal();
    }
  };
}

/* ---------- 聊天美化（玩家主页入口：气泡颜色 + 自定义CSS；背景图在访客主页单独设置） ---------- */
const BUBBLE_ME_COLORS = ['#8b5cf6', '#c084fc', '#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#e5e7eb'];
const BUBBLE_THEM_COLORS = ['#26232e', '#312b40', '#1f2937', '#2d2a24', '#242f2b', '#33262a', '#252833', '#3a3a3a'];

/* 聊天字体候选（20260929af）：全部取系统自带字体，零下载零依赖；id 存 chatTheme.fontId */
/* 20260929ah：字体表全部换成可商用开源字体（用户要求移除侵权风险字体）。
   · web:true 的字体通过 CDN 加载 webfont（断网自动回退到字体栈后续项）
   · 其余为字体栈引用：用户设备装了对应开源字体就生效，没装回退系统默认 */
const CHAT_FONT_OPTIONS = [
  { id: '',        name: '系统默认',    css: '' },
  // 20260929an：内置预设 5 款（本地 fonts/ 打包，零联网）；其余字体走「上传字体」（TTF/OTF/WOFF/WOFF2）
  // 20260929an：按用户要求移除 K8x12像素体，新增 Unifont点阵黑
  { id: 'tsanger', name: '仓耳与墨W02', css: "'TsangerYuMo W02', 'Microsoft YaHei', sans-serif" },
  { id: 'pfxc',    name: 'PingFang星辰体', css: "'PingFang XingChenTi', 'Microsoft YaHei', sans-serif" },
  { id: 'yrdz',    name: '阳人东住体',  css: "'YangRenDongZhuShiTi', 'Microsoft YaHei', sans-serif" },
  { id: 'unifont', name: 'Unifont点阵黑', css: "'Unifont DianZhenHei', 'Microsoft YaHei', sans-serif" },
];
/* 20260929al：玩家上传的自定义字体（kv customFonts [{id,name,data:Blob,createdAt}]）
   启动时 loadCustomFonts() 用 FontFace 注册进 document.fonts；chatFontOf 同步查表 */
let _customFontList = [];
function fontOptionsAll() {
  return CHAT_FONT_OPTIONS.concat(_customFontList.map(f => ({
    id: f.id, name: f.name + '（上传）', css: `'${String(f.name).replace(/'/g, '')}', 'Microsoft YaHei', sans-serif`, custom: true,
  })));
}
function chatFontOf(id) {
  const idn = id || '';
  return fontOptionsAll().find(f => f.id === idn) || CHAT_FONT_OPTIONS[0];
}
async function loadCustomFonts() {
  try {
    const list = await getSetting('customFonts', []);
    if (!Array.isArray(list)) return;
    _customFontList = list;
    for (const f of list) {
      try {
        if (!f || !f.name || !f.data) continue;
        const buf = await f.data.arrayBuffer();
        // 同名字体已注册过（重复打开页面不会发生，但防导入/重传叠加）先移除
        try { [...document.fonts].forEach(ff => { if (ff.family === f.name) document.fonts.delete(ff); }); } catch (e) {}
        const ff = new FontFace(f.name, buf);
        ff.load().then(() => document.fonts.add(ff)).catch(() => {}); // 不 await，避免拖慢启动
      } catch (e) {}
    }
  } catch (e) {}
}

async function showChatThemeModal() {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">织梦点</div>
      <button class="icon-btn" id="theme-close">✕</button>
    </div>

    <div class="field">
      <label>全局色彩（点选即换，浅色系会自动把界面换成浅底深字）</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;" id="theme-global-colors">
        ${Object.keys(GLOBAL_THEMES).map(k => {
          const t = GLOBAL_THEMES[k];
          const on = (_globalThemeId || 'dark') === k;
          return `<div class="gt-dot${on ? ' on' : ''}" data-gt="${k}" title="${t.name}" style="background:${t.dot};">
            <span class="gt-dot-accent" style="background:${t.accent};"></span>
          </div>`;
        }).join('')}
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:8px;" id="gt-cur-name">当前：${(GLOBAL_THEMES[_globalThemeId] || GLOBAL_THEMES.dark).name}${(_globalThemeId || 'dark') !== 'dark' ? ' · 浅色下文字已自动加深，保证可读性' : ''}</div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>玻璃拟态模式</span>
        <input type="checkbox" id="theme-glass-ui" ${chatTheme.glassUI ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">开启后，聊天导航页、个人主页、底部导航等界面切换为更透明的磨砂玻璃拟态，能透出后面的星光背景（不影响模拟通话界面）</div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">当前：<span style="color:var(--purple-soft);" id="glass-level-now"></span></div>
      <div style="margin-top:10px;">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">玻璃精度（可手动选择，也可跟随系统自动）</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;" id="glass-tier-pick">
          <button class="btn glass-tier-btn" data-tier="" style="padding:7px 13px;font-size:12px;">跟随系统</button>
          <button class="btn glass-tier-btn" data-tier="hi" style="padding:7px 13px;font-size:12px;">高精度</button>
          <button class="btn glass-tier-btn" data-tier="mid" style="padding:7px 13px;font-size:12px;">中精度</button>
          <button class="btn glass-tier-btn" data-tier="low" style="padding:7px 13px;font-size:12px;">低精度</button>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">高=全磨砂+光泽；中=模糊降到8px去复杂高光；低=不用磨砂改半透明纯色卡片（最省电）。手动选定后锁定该档、不再自动降级；选「跟随系统」则按设备自动适配并在帧率不足时平滑降级</div>
      </div>
    </div>

    <div class="field">
      <label>我的气泡颜色</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;" id="theme-me-colors">
        ${BUBBLE_ME_COLORS.map(col => `
          <div class="color-dot" data-col="${col}" style="background:${col};${col === chatTheme.bubbleMe ? 'outline:2px solid var(--purple-soft);outline-offset:2px;' : ''}"></div>
        `).join('')}
      </div>
    </div>

    <div class="field">
      <label>对方气泡颜色</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;" id="theme-them-colors">
        ${BUBBLE_THEM_COLORS.map(col => `
          <div class="color-dot" data-col="${col}" style="background:${col};${col === chatTheme.bubbleThem ? 'outline:2px solid var(--purple-soft);outline-offset:2px;' : ''}"></div>
        `).join('')}
      </div>
    </div>

    <div class="field">
      <label>聊天字体</label>
      <button class="btn" id="theme-font-btn" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;">
        <span id="theme-font-cur" style="${chatFontOf(chatTheme.fontId).css ? `font-family:${chatFontOf(chatTheme.fontId).css};` : ''}font-size:15px;">${chatFontOf(chatTheme.fontId).name}</span>
        <span style="color:var(--text-tertiary);font-size:12px;">更换 ›</span>
      </button>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">应用到聊天页（气泡/输入框/顶栏）</div>
    </div>

    <div class="field">
      <label>全局字体（应用到所有界面）</label>
      <button class="btn" id="theme-uifont-btn" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;">
        <span id="theme-uifont-cur" style="${chatFontOf(chatTheme.uiFontId).css ? `font-family:${chatFontOf(chatTheme.uiFontId).css};` : ''}font-size:15px;">${chatFontOf(chatTheme.uiFontId).name}</span>
        <span style="color:var(--text-tertiary);font-size:12px;">更换 ›</span>
      </button>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">应用到导航、主页、朋友圈、弹窗等全部界面；全部为可商用开源字体</div>
    </div>

    <div style="background:var(--bg-elevated-2);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
      <div style="font-size:11px;color:var(--text-tertiary);">预览效果</div>
      <div style="display:flex;justify-content:flex-end;"><span style="background:${chatTheme.bubbleMe};color:${chatTheme.bubbleMeText};padding:8px 12px;border-radius:16px 16px 4px 16px;font-size:13px;max-width:70%;">这样聊起来更有氛围啦</span></div>
      <div><span style="background:${chatTheme.bubbleThem};color:${chatTheme.bubbleThemText};padding:8px 12px;border-radius:16px 16px 16px 4px;font-size:13px;max-width:70%;display:inline-block;">嗯嗯，我一直在呢</span></div>
    </div>

    <div class="field">
      <label>自定义 CSS（高级美化）</label>
      <textarea class="textarea" id="theme-css" placeholder="输入 CSS 代码自定义美化，例如：&#10;.chat-scroll { background-color:#1a1626; }&#10;.msg-row.them .bubble { border-radius:20px; }" style="min-height:110px;font-family:monospace;font-size:12px;">${escapeHtml(chatTheme.customCss || '')}</textarea>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">改动即时生效并保存；群聊气泡统一使用总设置（22）</div>
    </div>

    <div class="field">
      <label>背景定制（10：上传图片即可替换系统默认背景）</label>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${[
          { k: 'navBg', label: '聊天导航页面背景' },
          { k: 'homeBg', label: '个人主页美化背景（铺在主页背景下方，随页面滚动）' },
          { k: 'momentsBg', label: '朋友圈整体背景（含底栏后方）' },
        ].map(it => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:14px;background:var(--bg-elevated-2);">
            <div style="width:56px;height:38px;border-radius:8px;background:${chatTheme[it.k] ? `url(&quot;${imgSrc(chatTheme[it.k])}&quot;) center/cover` : 'var(--bg)'};border:1px solid var(--border);flex-shrink:0;"></div>
            <div style="flex:1;font-size:13px;font-weight:600;">${it.label}</div>
            <label class="btn" for="bgup-${it.k}" style="padding:7px 12px;font-size:12px;cursor:pointer;">上传</label>
            ${chatTheme[it.k] ? `<button class="btn" style="padding:7px 12px;font-size:12px;color:var(--danger);" data-bgdel="${it.k}">删除</button>` : ''}
            <input type="file" id="bgup-${it.k}" accept="image/*" style="display:none;">
          </div>
        `).join('')}
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">上传后立即生效；玻璃拟态元素会自动透出你设置的背景</div>
    </div>
  `);
  $('#theme-close').onclick = closeModal;

  // 20260929bo：全局色彩预设点选（立即生效并持久化；浅色下正文/弹窗/输入框等自动浅底深字）
  $$('#theme-global-colors .gt-dot').forEach(d => {
    d.onclick = async () => {
      _globalThemeId = d.dataset.gt || 'dark';
      if (!GLOBAL_THEMES[_globalThemeId]) _globalThemeId = 'dark';
      try { await setSetting('globalTheme', _globalThemeId); } catch (e) {}
      applyGlobalThemeNow();
      applyChatTheme(); // 联动刷新（星光/玻璃/气泡变量等同链重挂）
      $$('#theme-global-colors .gt-dot').forEach(x => x.classList.toggle('on', x === d));
      const cn = $('#gt-cur-name');
      if (cn) cn.textContent = `当前：${GLOBAL_THEMES[_globalThemeId].name}${_globalThemeId !== 'dark' ? ' · 浅色下文字已自动加深，保证可读性' : ''}`;
      miniToast('全局色彩已切换：' + GLOBAL_THEMES[_globalThemeId].name);
    };
  });

  // 当前玻璃档位提示（20260929bh；20260929bj 区分手动/自动）
  const tierName = (lv) => lv === 'hi' ? '高精度' : lv === 'mid' ? '中精度' : '低精度';
  const refreshGlassTierUI = () => {
    const glNow = $('#glass-level-now');
    if (glNow) {
      if (!chatTheme.glassUI) glNow.textContent = '未开启';
      else glNow.textContent = `${tierName(_glassLevel)}${_glassManual ? '（手动锁定）' : (_glassLevel !== glassBaseLevel() ? '（已自动降级）' : '（系统自动）')}`;
    }
    $$('#glass-tier-pick .glass-tier-btn').forEach(b => {
      const active = (b.dataset.tier || '') === _glassManual;
      b.style.outline = active ? '2px solid var(--purple-soft)' : 'none';
      b.style.background = active ? 'var(--purple-soft)' : '';
      b.style.color = active ? '#fff' : '';
      b.style.fontWeight = active ? '600' : '400';
    });
  };
  refreshGlassTierUI();

  // 玻璃拟态模式开关（20260929bh：手动开启时清除自动降级记录，从设备判定重新开始）
  $('#theme-glass-ui').onchange = async () => {
    chatTheme.glassUI = $('#theme-glass-ui').checked;
    await setSetting('chatTheme', chatTheme);
    if (chatTheme.glassUI) {
      try { await setSetting('glassAutoLevel', ''); } catch (e) {}
      // 手动档位保留（玩家已选定则沿用；否则回到设备判定）
      _glassLevel = _glassManual || glassBaseLevel();
    }
    applyChatTheme();
    refreshGlassTierUI();
    miniToast(chatTheme.glassUI ? '已开启玻璃拟态模式' : '已关闭玻璃拟态模式');
  };

  // 20260929bj：玻璃精度手动三档选择（跟随系统 / 高 / 中 / 低）
  $$('#glass-tier-pick .glass-tier-btn').forEach(b => {
    b.onclick = async () => {
      const tier = b.dataset.tier || ''; // '' = 跟随系统
      if (!tier) {
        _glassManual = '';
        try { await setSetting('glassManualLevel', ''); } catch (e) {}
        _glassLevel = glassBaseLevel();
        try { await setSetting('glassAutoLevel', ''); } catch (e) {}
        miniToast('已切换为跟随系统自动');
      } else {
        _glassManual = tier;
        _glassLevel = tier;
        try { await setSetting('glassManualLevel', tier); } catch (e) {}
        miniToast('已手动锁定为' + tierName(tier));
      }
      applyChatTheme();
      refreshGlassTierUI();
    };
  });

  // 聊天字体（20260929af）：打开更换字体窗口
  $('#theme-font-btn').onclick = () => showChatFontModal('chat');
  $('#theme-uifont-btn').onclick = () => showChatFontModal('global');

  // 10：三处背景上传/删除
  ['navBg', 'homeBg', 'momentsBg'].forEach(k => {
    const inp = $(`#bgup-${k}`);
    if (inp) {
      inp.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // 20260929bn：背景图先裁剪再使用（比例=视口宽高比，所见即所得）
        const cropped = await openImageCropper(file, { aspect: document.documentElement.clientWidth / Math.max(1, document.documentElement.clientHeight) });
        if (!cropped) return;
        chatTheme[k] = cropped;
        await setSetting('chatTheme', chatTheme);
        applyChatTheme();
        miniToast('背景已更新');
        showChatThemeModal();
      };
    }
    const del = document.querySelector(`[data-bgdel="${k}"]`);
    if (del) {
      del.onclick = async () => {
        chatTheme[k] = '';
        await setSetting('chatTheme', chatTheme);
        applyChatTheme();
        miniToast('已删除该背景');
        showChatThemeModal();
      };
    }
  });

  // 气泡颜色
  const bindColors = (selId, key, textKey, textCol) => {
    document.querySelectorAll(`#${selId} .color-dot`).forEach(dot => {
      dot.onclick = async () => {
        chatTheme[key] = dot.dataset.col;
        chatTheme[textKey] = textCol;
        await setSetting('chatTheme', chatTheme);
        applyChatTheme();
        showChatThemeModal();
      };
    });
  };
  bindColors('theme-me-colors', 'bubbleMe', 'bubbleMeText', '#ffffff');
  bindColors('theme-them-colors', 'bubbleThem', 'bubbleThemText', '#f2f0f6');

  // 自定义 CSS：输入即时保存
  $('#theme-css').oninput = async () => {
    chatTheme.customCss = $('#theme-css').value;
    applyChatTheme();
    await setSetting('chatTheme', chatTheme);
  };
}

/* ---------- 访客日记（与 TA 的通话时长/认识天数/消息数） ---------- */
async function showCharDiaryModal(c) {
  const all = await idbGetAll('messages');
  const msgs = all.filter(m => m.charId === c.id);
  // 消息数
  const msgCount = msgs.length;
  // 认识天数：从最早一条消息（或角色创建时间）当天起算，认识当天 = 第 1 天
  // （循环归约求最早，不用 Math.min(...map) 展开——消息上万会超调用栈）
  let days = 1;
  let base = (c.createdAt || Date.now());
  for (const m of msgs) {
    const t = m.time || 0;
    if (t && t < base) base = t;
  }
  days = Math.max(1, Math.floor((startOfToday() - startOfDay(new Date(base))) / 86400000) + 1);
  // 通话时长：汇总所有 call 类型消息（已结束）
  let callSec = 0, callCount = 0;
  msgs.forEach(m => {
    if (m.type === 'call' && m.content && m.content.ended && !m.content.missed) {
      callSec += m.content.duration || 0;
      callCount++;
    }
  });
  const callText = callSec > 0 ? formatDuration(callSec) : '还没有通过话';
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">我们的日记</div>
      <button class="icon-btn" id="diary-close">✕</button>
    </div>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
      <div class="avatar lg">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
      <div>
        <div style="font-size:18px;font-weight:700;">${escapeHtml(c.name)}</div>
        <div style="font-size:13px;color:var(--text-tertiary);margin-top:2px;">记录你们的点点滴滴</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div class="diary-stat">
        <span class="diary-ic">📞</span>
        <span class="diary-label">累计通话时长</span>
        <span class="diary-val">${callText}${callCount > 0 ? `（${callCount} 次）` : ''}</span>
      </div>
      <div class="diary-stat">
        <span class="diary-ic">🗓️</span>
        <span class="diary-label">已经认识</span>
        <span class="diary-val">${days} 天</span>
      </div>
      <div class="diary-stat">
        <span class="diary-ic">💬</span>
        <span class="diary-label">发了</span>
        <span class="diary-val">${msgCount} 条消息</span>
      </div>
    </div>
  `);
  $('#diary-close').onclick = closeModal;
}

/* ---------- 纪念日（玩家主页左上角：访客导航 → 新建/删除纪念日） ---------- */
async function saveAnniversaries() {
  await setSetting('anniversaries', anniversaries);
}

function showAnniversaryModal() {
  // 第一步：访客导航（先选角色，再设置纪念日）
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">纪念日</div>
      <button class="icon-btn" id="anniv-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">先选择一个访客，再为 TA 设置纪念日</div>
    ${characters.length === 0
      ? '<div style="color:var(--text-tertiary);text-align:center;padding:24px;">还没有访客，先添加一个访客吧</div>'
      : characters.map(c => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 6px;border-bottom:1px solid var(--border);cursor:pointer;border-radius:10px;" data-anniv-char="${c.id}">
          <div class="avatar sm">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
          <div style="flex:1;min-width:0;font-size:15px;font-weight:600;">${escapeHtml(c.name)}</div>
          <span class="badge">${anniversaries.filter(a => a.charId === c.id).length} 个纪念日</span>
          <span style="color:var(--text-tertiary);">›</span>
        </div>`).join('')}
  `);
  $('#anniv-close').onclick = closeModal;
  document.querySelectorAll('[data-anniv-char]').forEach(el => {
    el.onclick = () => showCharAnniversaryModal(el.dataset.annivChar);
  });
}

/* 计算纪念日「已过多少天 / 距离还有多少天」（7：两项都要）
   支持两种日期格式：
   - 'MM-DD'：每年重复（原逻辑）
   - 'YYYY-MM-DD'：具体日期（玩家在新建时填了年份），已过天数从真实日期起算，倒计时按下一个周年
   返回 { isToday, left, passed } */
function annivDayText(dateStr) {
  const now = new Date();
  const todayMd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // 带年份（YYYY-MM-DD）
  if (typeof dateStr === 'string' && dateStr.length === 10 && dateStr[4] === '-') {
    const [y, m, d] = dateStr.split('-').map(Number);
    const origin = new Date(y, m - 1, d);
    const thisYear = new Date(now.getFullYear(), m - 1, d);
    if (startOfDay(thisYear) === startOfToday()) {
      return { isToday: true, left: 0, passed: Math.floor((startOfToday() - startOfDay(origin)) / 86400000) };
    }
    let next = thisYear;
    if (thisYear.getTime() < startOfToday()) next = new Date(now.getFullYear() + 1, m - 1, d);
    const left = Math.floor((startOfDay(next) - startOfToday()) / 86400000);
    const passed = Math.floor((startOfToday() - startOfDay(origin)) / 86400000);
    return { isToday: false, left, passed };
  }
  const dateMd = dateStr;
  const [m, d] = dateMd.split('-').map(Number);
  const thisYear = new Date(now.getFullYear(), m - 1, d);
  if (todayMd === dateMd) {
    return { isToday: true, left: 0, passed: 0 };
  }
  if (thisYear.getTime() < startOfToday()) {
    // 今年已过：距下次 = 明年该日；已过 = 今年该日到今天
    const next = new Date(now.getFullYear() + 1, m - 1, d);
    const left = Math.floor((startOfDay(next) - startOfToday()) / 86400000);
    const passed = Math.floor((startOfToday() - startOfDay(thisYear)) / 86400000);
    return { isToday: false, left, passed };
  } else {
    // 还没到：距下次 = 今年该日；已过 = 去年该日到今天
    const prev = new Date(now.getFullYear() - 1, m - 1, d);
    const left = Math.floor((startOfDay(thisYear) - startOfToday()) / 86400000);
    const passed = Math.floor((startOfToday() - startOfDay(prev)) / 86400000);
    return { isToday: false, left, passed };
  }
}

/* 最近的纪念日（用于顶栏提示）：返回 { hint, reason } */
function nextAnniversaryInfo() {
  if (!anniversaries.length) return null;
  let best = null;
  for (const a of anniversaries) {
    const info = annivDayText(a.date);
    if (info.isToday) return { hint: '🎉今天', reason: a.reason };
    if (!best || info.left < best.left) best = { ...info, reason: a.reason };
  }
  if (!best) return null;
  return { hint: `${best.left}天`, reason: best.reason };
}
function startOfToday() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

function showCharAnniversaryModal(charId) {
  const c = characters.find(x => x.id === charId);
  if (!c) { showAnniversaryModal(); return; }
  const list = anniversaries.filter(a => a.charId === charId).sort((a, b) => (a.date < b.date ? -1 : 1));
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:6px;min-width:0;">
        <button class="icon-btn" id="anniv-back" style="font-size:22px;flex-shrink:0;">‹</button>
        <div style="font-size:18px;font-weight:600;">${escapeHtml(c.name)} 的纪念日</div>
      </div>
      <button class="icon-btn" id="anniv-list-close">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;max-height:300px;overflow-y:auto;" id="anniv-list">
      ${list.length === 0
        ? '<div style="color:var(--text-tertiary);text-align:center;padding:24px;">还没有纪念日，点击下方「新建纪念日」添加</div>'
        : list.map(a => {
            const info = annivDayText(a.date);
            const dayLine = info.isToday
              ? `<div style="font-size:12px;color:var(--purple-soft);font-weight:600;">🎊 就是今天</div>`
              : `<div style="font-size:12px;color:var(--ok);">还有 ${info.left} 天</div><div style="font-size:12px;color:var(--text-secondary);">已过 ${info.passed} 天</div>`;
            return `
          <div style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:var(--card);border:1px solid var(--border);border-radius:14px;">
            <div style="font-size:22px;">🎉</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;">${escapeHtml(a.reason || '纪念日')}</div>
              <div style="font-size:12px;color:var(--text-tertiary);">${escapeHtml(a.date)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;white-space:nowrap;flex-shrink:0;">${dayLine}</div>
            <button class="badge" style="cursor:pointer;color:var(--danger);flex-shrink:0;" data-anniv-del="${a.id}">删除</button>
          </div>`;
          }).join('')}
    </div>
    <button class="btn primary block" id="anniv-new">＋ 新建纪念日</button>
  `);
  $('#anniv-list-close').onclick = closeModal;
  $('#anniv-back').onclick = () => showAnniversaryModal();
  $('#anniv-new').onclick = () => showNewAnniversaryModal(charId);
  document.querySelectorAll('[data-anniv-del]').forEach(el => {
    el.onclick = async () => {
      const id = el.dataset.annivDel;
      showConfirm('确定删除这个纪念日吗？', async () => {
        anniversaries = anniversaries.filter(a => a.id !== id);
        await saveAnniversaries();
        showCharAnniversaryModal(charId);
      });
    };
  });
}

function showNewAnniversaryModal(charId) {
  const c = characters.find(x => x.id === charId);
  openModal(`
    <div style="font-size:18px;font-weight:600;margin-bottom:16px;">新建纪念日</div>
    <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:14px;">为「${escapeHtml(c ? c.name : 'TA')}」添加一个纪念日</div>
    <div class="field">
      <label>纪念日日期</label>
      <input class="input" type="date" id="anniv-date">
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <span style="font-size:12px;color:var(--text-tertiary);white-space:nowrap;">或直接输入</span>
        <input class="input" type="number" id="anniv-year" min="1900" max="2100" placeholder="年" style="width:86px;flex:none;">
        <span style="font-size:13px;color:var(--text-tertiary);">年</span>
        <input class="input" type="number" id="anniv-month" min="1" max="12" placeholder="月" style="width:74px;flex:none;">
        <span style="font-size:13px;color:var(--text-tertiary);">月</span>
        <input class="input" type="number" id="anniv-day" min="1" max="31" placeholder="日" style="width:74px;flex:none;">
        <span style="font-size:13px;color:var(--text-tertiary);">日</span>
      </div>
      <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:6px;">两种方式任填一种；年份可不填（不填 = 每年重复的月-日，填了 = 具体日期，会精确计算「已过 N 天」）</div>
    </div>
    <div class="field">
      <label>纪念原因</label>
      <input class="input" id="anniv-reason" placeholder="如：第一次相遇、生日、表白日…">
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="anniv-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="anniv-save">保存</button>
    </div>
  `);
  $('#anniv-cancel').onclick = () => showCharAnniversaryModal(charId);
  // 日期选择器变化时，同步填充数字输入框（双向都可用）
  $('#anniv-date').onchange = () => {
    const v = $('#anniv-date').value;
    if (v) {
      $('#anniv-year').value = parseInt(v.slice(0, 4), 10);
      $('#anniv-month').value = parseInt(v.slice(5, 7), 10);
      $('#anniv-day').value = parseInt(v.slice(8, 10), 10);
    }
  };
  $('#anniv-save').onclick = async () => {
    const reason = $('#anniv-reason').value.trim();
    if (!reason) { showToast('请填写纪念原因'); return; }
    // 优先用直接输入的年月日数字；没填全再用日期选择器
    const yr = parseInt($('#anniv-year').value, 10);
    const mo = parseInt($('#anniv-month').value, 10);
    const da = parseInt($('#anniv-day').value, 10);
    let md = '';
    if (!isNaN(mo) && !isNaN(da)) {
      if (mo < 1 || mo > 12) { showToast('月份要在 1～12 之间'); return; }
      if (da < 1 || da > 31) { showToast('日期要在 1～31 之间'); return; }
      const mm = String(mo).padStart(2, '0');
      const dd = String(da).padStart(2, '0');
      if (!isNaN(yr) && yr >= 1900 && yr <= 2100) {
        md = `${yr}-${mm}-${dd}`;        // 带年份：具体日期
      } else {
        md = `${mm}-${dd}`;              // 不带年份：每年重复
      }
    } else {
      const date = $('#anniv-date').value;
      if (!date) { showToast('请选择日期，或直接输入年月日'); return; }
      md = date; // YYYY-MM-DD，annivDayText 自动兼容带/不带年份
    }
    anniversaries.push({ id: uid('anniv'), charId, date: md, reason, createdAt: Date.now() });
    await saveAnniversaries();
    showCharAnniversaryModal(charId);
  };
}

/* 弹卡纪念日设置（总设置里：只能选一个角色的纪念日，可更换） */
async function showAnnivCardSettingModal() {
  const cur = await getSetting('dailyAnnivCharId', null);
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">入梦签纪念日</div>
      <button class="icon-btn" id="annivcard-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">选择一个访客，当 TA 的纪念日到来时，入梦签会标明「今天是什么纪念日」</div>
    ${characters.length === 0
      ? '<div style="color:var(--text-tertiary);text-align:center;padding:24px;">还没有访客</div>'
      : characters.map(c => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 6px;border-bottom:1px solid var(--border);cursor:pointer;border-radius:10px;${cur === c.id ? 'background:var(--purple-dim);' : ''}" data-annivcard="${c.id}">
          <div class="avatar sm">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
          <div style="flex:1;min-width:0;font-size:15px;font-weight:600;">${escapeHtml(c.name)}</div>
          <span class="badge">${anniversaries.filter(a => a.charId === c.id).length} 个纪念日</span>
          ${cur === c.id ? '<span style="color:var(--purple-soft);">✓</span>' : '<span style="color:var(--text-tertiary);">›</span>'}
        </div>`).join('')}
    <div style="display:flex;gap:10px;margin-top:14px;">
      ${cur ? `<button class="btn" style="flex:1;" id="annivcard-clear">取消入梦签纪念日</button>` : ''}
      <button class="btn primary" style="flex:1;" id="annivcard-done">完成</button>
    </div>
  `);
  $('#annivcard-close').onclick = closeModal;
  $('#annivcard-done').onclick = closeModal;
  const clearBtn = $('#annivcard-clear');
  if (clearBtn) clearBtn.onclick = async () => { await setSetting('dailyAnnivCharId', null); miniToast('已取消入梦签纪念日'); showAnnivCardSettingModal(); };
  document.querySelectorAll('[data-annivcard]').forEach(el => {
    el.onclick = async () => {
      await setSetting('dailyAnnivCharId', el.dataset.annivcard);
      miniToast('已设置入梦签纪念日访客');
      showAnnivCardSettingModal();
    };
  });
}

/* ---------- 访客分组管理（20260929be 重构：勾选式直接建组/加人，像建立群聊一样） ---------- */
async function saveCharGroups() {
  await setSetting('charGroups', charGroups);
}

/* 保存分组后必须强刷聊天列表（此前只在重开弹窗时刷，导致「分组建好了聊天导航页却不显示」） */
async function saveCharGroupsAndRefresh() {
  await saveCharGroups();
  _chatListSig = null; // 分组结构变了，签名失效强制重绘
  renderChatList();
}

/* 勾选式成员选择弹窗（角色 + 群聊混排；新建分组 / 添加成员 / 批量移动共用） */
function pickMembersModal({ title, tip, exclude = [], initial = [], onDone, onClose }) {
  const chars = characters.filter(c => !exclude.includes(c.id));
  const groups = chatGroups.filter(g => !exclude.includes(g.id));
  const sel = new Set(initial);
  const rowHtml = (id, name, av, isGroup) => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;" data-pm="${id}">
      <div class="avatar sm">${av}</div>
      <div style="flex:1;font-size:14px;font-weight:600;">${escapeHtml(name)}${isGroup ? ' <span style="font-size:11px;color:var(--text-tertiary);font-weight:400;">（群聊）</span>' : ''}</div>
      <div class="pm-check" style="width:20px;height:20px;border-radius:50%;border:2px solid var(--text-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;color:#141019;flex-shrink:0;${sel.has(id) ? 'background:var(--purple);border-color:var(--purple);' : ''}">${sel.has(id) ? '✓' : ''}</div>
    </div>`;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:17px;font-weight:600;">${escapeHtml(title)}</div>
      <button class="icon-btn" id="pm-close">${icon('close', 18)}</button>
    </div>
    ${tip ? `<div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:10px;">${tip}</div>` : ''}
    <div style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
      ${groups.map(g => rowHtml(g.id, g.name, g.avatar ? `<img src="${imgSrc(g.avatar)}">` : '👥', true)).join('')}
      ${chars.map(c => rowHtml(c.id, c.name, c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?'), false)).join('')}
      ${(groups.length + chars.length) ? '' : '<div style="color:var(--text-tertiary);font-size:13px;padding:12px 0;text-align:center;">没有可选成员</div>'}
    </div>
    <button class="btn primary block" id="pm-ok" style="padding:13px;">完成（已选 0）</button>
  `);
  const sync = () => { $('#pm-ok').textContent = `完成（已选 ${sel.size}）`; };
  document.querySelectorAll('[data-pm]').forEach(row => {
    row.onclick = () => {
      const id = row.dataset.pm;
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      const chk = row.querySelector('.pm-check');
      chk.style.background = sel.has(id) ? 'var(--purple)' : 'transparent';
      chk.style.borderColor = sel.has(id) ? 'var(--purple)' : 'var(--text-tertiary)';
      chk.textContent = sel.has(id) ? '✓' : '';
      sync();
    };
  });
  $('#pm-close').onclick = () => { if (onClose) onClose(); else showCharGroupsModal(); }; // 子功能关闭回上一界面
  $('#pm-ok').onclick = async () => { await onDone([...sel]); };
  sync();
}

function showCharGroupsModal() {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">访客分组</div>
      <button class="icon-btn" id="cg-close">${icon('close', 18)}</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">把访客和群聊归入不同文件夹，聊天导航页会更清爽（建组时直接勾选成员）</div>

    ${charGroups.map((g, gi) => `
      <div style="margin-bottom:12px;border:1px solid var(--border);border-radius:14px;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 12px;background:var(--bg-elevated-2);">
          <span style="font-weight:600;font-size:14px;">${icon('folder', 15)} ${escapeHtml(g.name)}（${(g.memberIds || []).length}）</span>
          <span style="display:inline-flex;align-items:center;gap:10px;">
            <span class="badge" style="cursor:pointer;color:var(--purple-soft);" data-cg-addmore="${gi}">＋ 添加成员</span>
            <span class="badge" style="cursor:pointer;color:var(--danger);" data-cg-del="${gi}">删</span>
          </span>
        </div>
        <div style="padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px;">
          ${(g.memberIds || []).map(id => {
            const gc = chatGroups.find(x => x.id === id);
            if (gc) return `<span class="badge" style="display:inline-flex;gap:4px;cursor:pointer;" data-cg-rm="${gi}" data-cid="${gc.id}">${icon('chat', 12)} ${escapeHtml(gc.name)} ✕</span>`;
            const c = characters.find(x => x.id === id);
            return c ? `<span class="badge" style="display:inline-flex;gap:4px;cursor:pointer;" data-cg-rm="${gi}" data-cid="${c.id}">${escapeHtml(c.name)} ✕</span>` : '';
          }).join('') || '<span style="color:var(--text-tertiary);font-size:12px;">（空分组）</span>'}
        </div>
      </div>
    `).join('')}

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">未分组访客</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
      ${characters.filter(c => !charGroups.some(g => (g.memberIds || []).includes(c.id))).map(c => `
        <span class="badge" style="opacity:.75;">${escapeHtml(c.name)}</span>
      `).join('') || '<span style="color:var(--text-tertiary);font-size:12px;">（无未分组访客）</span>'}
    </div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">未分组群聊</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
      ${chatGroups.filter(g => !charGroups.some(cg => (cg.memberIds || []).includes(g.id))).map(g => `
        <span class="badge" style="opacity:.75;">${icon('chat', 12)} ${escapeHtml(g.name)}</span>
      `).join('') || '<span style="color:var(--text-tertiary);font-size:12px;">（无未分组群聊）</span>'}
    </div>

    <button class="btn primary block" id="cg-new">＋ 新建分组</button>
  `);
  $('#cg-close').onclick = closeModal;
  // 新建分组：名称 → 勾选成员（创建即含成员，一步到位）
  $('#cg-new').onclick = () => {
    openModal(`
      <div style="font-size:18px;font-weight:600;margin-bottom:16px;">新建访客分组</div>
      <div class="field"><label>分组名称</label><input class="input" id="cg-name" placeholder="如：家人、朋友、同事…"></div>
      <div style="display:flex;gap:10px;">
        <button class="btn" style="flex:1;" id="cg-cancel">取消</button>
        <button class="btn primary" style="flex:1;" id="cg-save">下一步：选成员</button>
      </div>
    `);
    $('#cg-cancel').onclick = () => showCharGroupsModal();
    $('#cg-save').onclick = () => {
      const name = $('#cg-name').value.trim();
      if (!name) { showToast('请填写分组名称'); return; }
      const grp = { id: uid('cg'), name, memberIds: [], _collapsed: false };
      pickMembersModal({
        title: `选择「${name}」的成员`,
        tip: '勾选访客或群聊，创建后也会显示在聊天导航页（可展开/收起）',
        onClose: () => showCharGroupsModal(),
        onDone: async (ids) => {
          grp.memberIds = ids;
          charGroups.push(grp);
          await saveCharGroupsAndRefresh();
          miniToast(`分组「${name}」已创建${ids.length ? `（${ids.length} 个成员）` : ''}`);
          showCharGroupsModal();
        },
      });
    };
  };
  // 删除分组
  document.querySelectorAll('[data-cg-del]').forEach(el => {
    el.onclick = async () => {
      const gi = parseInt(el.dataset.cgDel);
      showConfirm(`删除分组「${charGroups[gi].name}」？组内访客会回到未分组。`, async () => {
        charGroups.splice(gi, 1);
        await saveCharGroupsAndRefresh();
        showCharGroupsModal();
      });
    };
  });
  // 继续往分组里加成员（勾选式；候选 = 未在该组内的角色/群聊）
  document.querySelectorAll('[data-cg-addmore]').forEach(el => {
    el.onclick = () => {
      const gi = parseInt(el.dataset.cgAddmore);
      const grp = charGroups[gi];
      pickMembersModal({
        title: `把成员加入「${grp.name}」`,
        tip: '勾选后点完成；已在其他分组的成员会同时从原分组移出',
        exclude: grp.memberIds || [],
        onClose: () => showCharGroupsModal(),
        onDone: async (ids) => {
          ids.forEach(cid => {
            charGroups.forEach(g => { if (g !== grp) g.memberIds = (g.memberIds || []).filter(x => x !== cid); });
            if (!grp.memberIds.includes(cid)) grp.memberIds.push(cid);
          });
          await saveCharGroupsAndRefresh();
          showCharGroupsModal();
        },
      });
    };
  });
  // 从分组移除成员
  document.querySelectorAll('[data-cg-rm]').forEach(el => {
    el.onclick = async () => {
      const gi = parseInt(el.dataset.cgRm);
      const cid = el.dataset.cid;
      charGroups[gi].memberIds = (charGroups[gi].memberIds || []).filter(id => id !== cid);
      await saveCharGroupsAndRefresh();
      showCharGroupsModal();
    };
  });
}

/* ---------- 访客专属表情包库（每个访客独立，存 character.emojis） ---------- */
function showCharEmojiModal(c) {
  c.emojis = c.emojis || [];
  const render = () => {
    const grid = $('#char-emoji-grid');
    const list = c.emojis;
    grid.innerHTML = list.length
      ? list.map(e => `
        <div class="emoji-cell" data-eid="${e.id}">
          <img src="${imgSrc(e.img || e.data)}">
          <button class="emoji-del" data-del="${e.id}">✕</button>
        </div>`).join('')
      : `<div class="emoji-empty">还没有专属表情包<br><span style="font-size:12px;">点「＋ 添加」上传（上限 300 张）</span></div>`;
    grid.querySelectorAll('.emoji-cell').forEach(el => {
      el.onclick = (ev) => {
        if (ev.target.classList.contains('emoji-del')) return;
        const emo = list.find(x => x.id === el.dataset.eid);
        if (emo) { closeModal(); sendEmojiMessage(emo.img); }
      };
    });
    grid.querySelectorAll('[data-del]').forEach(el => {
      el.onclick = async (ev) => {
        ev.stopPropagation();
        c.emojis = c.emojis.filter(x => x.id !== el.dataset.del);
        await saveChar(c);
        render();
      };
    });
  };
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">「${escapeHtml(c.name)}」的表情包库</div>
      <button class="icon-btn" id="cemoji-close">✕</button>
    </div>
    <div style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">这是 TA 的专属表情包（${c.emojis.length}/300），仅在与 TA 聊天时可用，与其他访客互不影响</div>
    <div style="display:flex;gap:10px;margin-bottom:12px;">
      <label class="btn primary" for="char-emoji-input" style="flex:1;cursor:pointer;justify-content:center;">＋ 添加表情包</label>
    </div>
    <input type="file" id="char-emoji-input" accept="image/*" multiple style="display:none;">
    <div class="emoji-grid" id="char-emoji-grid"></div>
  `);
  $('#cemoji-close').onclick = closeModal;
  $('#char-emoji-input').onchange = async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    const remain = 300 - c.emojis.length;
    const list = [...files].slice(0, remain);
    let ok = 0, fail = 0;
    for (const f of list) {
      try {
        const data = await compressImage(f, 240, 0.85, true);
        c.emojis.push({ id: uid('emoji'), img: data });
        ok++;
      } catch (err) { fail++; }
    }
    await saveChar(c);
    if (fail === 0) miniToast(`已添加 ${ok} 张表情包`);
    else miniToast(`已添加 ${ok} 张，${fail} 张失败`);
    e.target.value = '';
    render();
  };
  render();
}

/* ---------- 访客聊天背景图（访客主页入口，按角色独立） ---------- */
function showCharThemeModal(c) {
  const hasBg = !!c.chatBg;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">聊天背景图</div>
      <button class="icon-btn" id="ctheme-close">✕</button>
    </div>
    <div style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">设置与「${escapeHtml(c.name)}」聊天时的专属背景图，与其他访客互不影响</div>

    <div class="field">
      <label>当前背景图</label>
      <div id="ctheme-bg-preview" style="height:130px;border-radius:14px;border:1px solid var(--border);background:${hasBg ? `url(&quot;${imgSrc(c.chatBg)}&quot;) center/cover` : 'var(--bg-elevated-2)'};display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);font-size:13px;margin-bottom:10px;">
        ${hasBg ? '' : '暂无背景图'}
      </div>
      <div style="display:flex;gap:10px;">
        <label class="btn" for="ctheme-bg-input" style="flex:1;height:44px;padding:0;cursor:pointer;">${icon('camera', 15)} 上传背景图</label>
        <button class="btn danger" style="flex:1;height:44px;padding:0;" id="ctheme-bg-del" ${hasBg ? '' : 'disabled'}>删除背景图</button>
      </div>
      <input type="file" id="ctheme-bg-input" accept="image/*" style="display:none;">
    </div>
  `);
  $('#ctheme-close').onclick = closeModal;

  $('#ctheme-bg-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    // 20260929ax：先裁剪再应用（框内所见即聊天页背景效果，比例取当前视口）
    const cropped = await openImageCropper(file, { aspect: document.documentElement.clientWidth / Math.max(1, document.documentElement.clientHeight) });
    if (!cropped) return;
    c.chatBg = cropped;
    await saveChar(c);
    applyChatTheme();
    miniToast('聊天背景已更新');
    showCharThemeModal(c);
  };
  $('#ctheme-bg-del').onclick = async () => {
    c.chatBg = '';
    await saveChar(c);
    applyChatTheme();
    miniToast('已删除聊天背景');
    showCharThemeModal(c);
  };
}

/* ---------- 更换字体窗口（20260929af，聊天美化的子弹窗） ----------
   点选即用立即生效；按弹窗链路铁律，✕/选择后一律回 showChatThemeModal()。 */
/* ---------- 更换字体窗口（20260929af，织梦点的子弹窗）
   20260929ah：scope='chat'（聊天字体，默认）| 'global'（全局 UI 字体，应用到所有界面） */
function showChatFontModal(scope = 'chat') {
  const isGlobal = scope === 'global';
  const curId = isGlobal ? (chatTheme.uiFontId || '') : (chatTheme.fontId || '');
  const cur = chatFontOf(curId);
  const opts = fontOptionsAll();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">${isGlobal ? '更换全局字体' : '更换聊天字体'}</div>
      <button class="icon-btn" id="font-close">✕</button>
    </div>
    <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px;">${isGlobal ? '应用到全部界面（聊天页不受影响，仍用聊天字体）' : '应用到聊天页（气泡/输入框/顶栏）'}；点选即用、立即生效；✕ 返回织梦点</div>
    <div style="display:flex;flex-direction:column;gap:8px;" id="font-list">
      ${opts.map(f => `
        <button class="btn font-opt ${f.id === cur.id ? 'primary' : ''}" data-font="${f.id}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;">
          <span style="${f.css ? `font-family:${f.css};` : ''}font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">白日梦 字体预览 Aa 123</span>
          <span style="font-size:12px;color:var(--text-tertiary);flex-shrink:0;">${f.name}${f.id === cur.id ? ' · 当前' : ''}</span>
        </button>
      `).join('')}
    </div>
    <div class="field" style="margin-top:14px;">
      <label>上传字体</label>
      <label class="btn" for="font-upload-input" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:11px 14px;cursor:pointer;">⬆ 上传字体文件</label>
      <input type="file" id="font-upload-input" accept=".ttf,.otf,.woff,.woff2" style="display:none;">
      <div style="font-size:12px;color:#e5615c;margin-top:6px;font-weight:600;">⚠ 支持 TTF / OTF / WOFF / WOFF2 字体文件，不支持压缩包（zip/rar 需先解压出字体文件再上传）</div>
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">上传后保存在本机软件里，最多 8 个、单个不超过 20MB；上传即代表你已确认该字体可自由使用</div>
    </div>
  `);
  $('#font-close').onclick = () => showChatThemeModal();
  document.querySelectorAll('.font-opt').forEach(btn => {
    btn.onclick = async () => {
      const pick = btn.dataset.font || '';
      if (isGlobal) chatTheme.uiFontId = pick; else chatTheme.fontId = pick;
      await setSetting('chatTheme', chatTheme);
      applyChatTheme();
      miniToast(pick ? `字体已更换为${chatFontOf(pick).name}` : '字体已恢复系统默认');
      showChatThemeModal(); // 回织梦点
    };
  });
  const finp = $('#font-upload-input');
  finp.onchange = async () => {
    const f = finp.files && finp.files[0];
    finp.value = '';
    if (!f) return;
    if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) { miniToast('格式不支持：请上传 TTF / OTF / WOFF / WOFF2 文件（不支持压缩包）'); return; }
    if (f.size > 20 * 1024 * 1024) { miniToast('字体文件超过 20MB，无法上传'); return; }
    let list = (await getSetting('customFonts', [])).slice();
    if (!Array.isArray(list)) list = [];
    if (list.length >= 8) { miniToast('最多保存 8 个上传字体，先删掉不用的再传'); return; }
    const name = (f.name.replace(/\.(ttf|otf|woff2?)$/i, '').slice(0, 24) || '自定义字体');
    let ff = null;
    try {
      ff = new FontFace(name, await f.arrayBuffer());
      await ff.load();
    } catch (e) { miniToast('字体文件解析失败，可能已损坏'); return; }
    try { [...document.fonts].forEach(x => { if (x.family === name) document.fonts.delete(x); }); } catch (e) {}
    document.fonts.add(ff);
    const id = uid('cfont');
    list.push({ id, name, data: f, createdAt: Date.now() });
    await setSetting('customFonts', list);
    _customFontList = list;
    miniToast('字体已上传：' + name);
    showChatFontModal(scope); // 重渲染列表（新字体出现在最下方）
  };
}

/* 应用聊天美化到聊天页（CSS 变量）
   背景图按当前角色独立；气泡颜色/自定义CSS用全局 */
let _customCssStyle = null;
function applyChatTheme() {
  const root = document.documentElement.style;
  // 背景图：按当前角色的 character.chatBg 读取（每个访客独立）
  const c = currentCharId ? characters.find(x => x.id === currentCharId) : null;
  let bg = '';
  if (c && c.chatBg) bg = c.chatBg;
  root.setProperty('--chat-bg', bg ? `url("${imgSrc(bg)}")` : 'none');
  // 20260929v：上传过聊天背景时 body 挂 chat-has-bg——PC 端据此由 #view-chat
  // 栏内 ::before 单层无缝承接背景（顶栏区域显示上传背景）；手机端消息区
  // 始终自铺 var(--chat-bg)，全屏层在聊天页恒为导航背景，不受此类影响
  document.body.classList.toggle('chat-has-bg', !!bg);
  root.setProperty('--bubble-me', chatTheme.bubbleMe);
  root.setProperty('--bubble-me-text', chatTheme.bubbleMeText);
  root.setProperty('--bubble-them', chatTheme.bubbleThem);
  root.setProperty('--bubble-them-text', chatTheme.bubbleThemText);
  // 10：三处全局背景（聊天导航页 / 个人主页美化背景 / 朋友圈）
  root.setProperty('--nav-bg', chatTheme.navBg ? `url("${imgSrc(chatTheme.navBg)}")` : 'none');
  root.setProperty('--home-page-bg', chatTheme.homeBg ? `url("${imgSrc(chatTheme.homeBg)}")` : 'none');
  root.setProperty('--moments-bg', chatTheme.momentsBg ? `url("${imgSrc(chatTheme.momentsBg)}")` : 'none');
  // 个人主页美化背景：20260929t 起改由 #app-fullbg 统一承接（铺满整屏含顶栏/底栏后方，
  // 与聊天导航/朋友圈同一套机制）。旧的 #home-pagebg 滚动层与全屏层裁切比例不一致，
  // 同屏会出现接缝，保留 DOM 但恒隐藏
  const pb = $('#home-pagebg');
  if (pb) { pb.style.backgroundImage = ''; pb.style.display = 'none'; }
  updateAppFullBg();
  // 玻璃拟态模式：可选，开启后系统界面切到磨砂玻璃（不影响通话界面）
  // 20260929bh：改走 applyGlassMode 统一入口（三档精度 + 帧率自动降级）
  applyGlassMode();
  // 自定义 CSS：注入 <style>，避免重复创建
  if (!_customCssStyle) {
    _customCssStyle = document.createElement('style');
    _customCssStyle.id = 'chat-custom-css';
    document.head.appendChild(_customCssStyle);
  }
  _customCssStyle.textContent = chatTheme.customCss || '';
  // 聊天字体（20260929af）：应用到整个聊天视图，气泡/输入框/顶栏自动继承
  const vc = $('#view-chat');
  if (vc) vc.style.fontFamily = chatFontOf(chatTheme.fontId).css || '';
  // 全局 UI 字体（20260929ah）：body 内联 font-family，全部界面继承；
  // 聊天页由上面 #view-chat 内联覆盖（内层元素内联样式优先），互不打架。
  // 20260929al：自定义字体由 FontFace 预注册（loadCustomFonts），无需再注入 webfont 链接
  document.body.style.fontFamily = chatFontOf(chatTheme.uiFontId).css || '';
  // 20260929an：html 根元素同步内联——底部导航栏/个人主页顶栏等所有元素双保险，
  // 任何不在 body 直接继承链上的游离元素（如挂 body 的弹窗层）也从根继承
  document.documentElement.style.fontFamily = chatFontOf(chatTheme.uiFontId).css || '';
  // 20260929aj：同步覆盖 --font 变量——style.css 里 html/body/.btn/.input/icon-btn 等
  // 6 处显式写 font-family: var(--font)，只改 body 内联值时这些元素不跟随（用户反馈
  // "个人主页功能行没切字体"根因之一）；选择系统默认时移除覆盖、恢复原始 --font
  if (chatTheme.uiFontId) {
    root.setProperty('--font', chatFontOf(chatTheme.uiFontId).css);
  } else {
    root.removeProperty('--font');
  }
  // 20260929bl：配色预设已移除（仅保留星夜紫）——摘除旧版本可能残留的主题 class
  document.body.classList.remove('theme-blue', 'theme-gray');
  // 20260929bo：全局浅色主题预设（body.theme-light + tl-* 变体）——CSS 侧统一切浅底深字
  applyGlobalThemeNow();
}

/* ============================================================
   20260929bo：全局色彩预设（浅色系）——像气泡预设一样的点选色板。
   dark=默认星夜紫（深色）；其余 6 款为浅色系：切换后 body 挂
   theme-light + tl-<id>，style.css 末尾的浅色主题块接管全部变量，
   原本偏浅的文字自动变深（--text 族变量整体翻转），保证可读性
   ============================================================ */
const GLOBAL_THEMES = {
  dark:   { name: '星夜紫（默认）', cls: '',          dot: 'linear-gradient(135deg,#241f31,#3a2f55)', accent: '#a78bfa' },
  lilac:  { name: '薄暮藕荷',       cls: 'tl-lilac',  dot: 'linear-gradient(135deg,#f3effa,#e6def7)', accent: '#7c5cf0' },
  sakura: { name: '春樱粉',         cls: 'tl-sakura', dot: 'linear-gradient(135deg,#fbf1f5,#f7e3ec)', accent: '#d6568d' },
  sky:    { name: '晴空蓝',         cls: 'tl-sky',    dot: 'linear-gradient(135deg,#eef5fc,#ddecf9)', accent: '#3b7fd4' },
  mint:   { name: '薄荷奶绿',       cls: 'tl-mint',   dot: 'linear-gradient(135deg,#eefaf3,#ddf2e8)', accent: '#279d6e' },
  cream:  { name: '奶油杏',         cls: 'tl-cream',  dot: 'linear-gradient(135deg,#faf6ee,#f5ead8)', accent: '#c98a2d' },
  mist:   { name: '云雾灰',         cls: 'tl-mist',   dot: 'linear-gradient(135deg,#f2f3f5,#e4e6ea)', accent: '#5b6270' },
};
let _globalThemeId = 'dark';
/* 启动时从 kv 载入用户选择的全局色彩 */
async function loadGlobalTheme() {
  try { _globalThemeId = (await getSetting('globalTheme')) || 'dark'; } catch (e) { _globalThemeId = 'dark'; }
  if (!GLOBAL_THEMES[_globalThemeId]) _globalThemeId = 'dark';
  applyGlobalThemeNow();
}
/* 同步 body class（浅色=theme-light + tl-<id>；深色=全部摘除） */
function applyGlobalThemeNow() {
  const conf = GLOBAL_THEMES[_globalThemeId] || GLOBAL_THEMES.dark;
  const cl = document.body.classList;
  cl.remove('theme-light', 'tl-lilac', 'tl-sakura', 'tl-sky', 'tl-mint', 'tl-cream', 'tl-mist');
  if (conf.cls) { cl.add('theme-light'); cl.add(conf.cls); }
}

/* ---------- 聊天设置（5.3：回复节奏/主动消息/提示音/撤回）
   全局（玩家主页）与访客级（访客主页）共用一套 UI，只是保存目标不同 ---------- */
function chatSettingsHtml(s, title, subtitle, isPerChar = false) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div style="font-size:18px;font-weight:600;">${title}</div>
      <button class="icon-btn" id="cs-close">✕</button>
    </div>
    ${subtitle ? `<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:14px;">${subtitle}</div>` : ''}

    ${!isPerChar ? `
    <div class="field">
      <label>聊天模式（全局，聊天窗口顶栏开关可随时切换）</label>
      <div style="display:flex;gap:8px;">
        <button class="btn cs-ai-btn" data-mode="card" style="flex:1;gap:6px;display:inline-flex;align-items:center;justify-content:center;">${icon('cards', 15)} 字卡模式</button>
        <button class="btn cs-ai-btn" data-mode="ai" style="flex:1;gap:6px;display:inline-flex;align-items:center;justify-content:center;">${icon('ai', 15)} AI 模式</button>
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">AI 模式下除入梦签外，随机字卡功能停用，回复由 AI 生成；需先在「API 接入」配置链接</div>
    </div>` : ''}

    <div class="field">
      <label>回复节奏 · 最短等待（秒，0～120）</label>
      <div style="display:flex;gap:10px;align-items:center;">
        <input type="range" min="0" max="120" value="${s.minDelay}" id="cs-min" style="flex:1;">
        <input class="input" type="number" min="0" max="120" value="${s.minDelay}" id="cs-min-num" style="width:76px;">
      </div>
    </div>
    <div class="field">
      <label>回复节奏 · 最长等待（秒，0～120）</label>
      <div style="display:flex;gap:10px;align-items:center;">
        <input type="range" min="0" max="120" value="${s.maxDelay}" id="cs-max" style="flex:1;">
        <input class="input" type="number" min="0" max="120" value="${s.maxDelay}" id="cs-max-num" style="width:76px;">
      </div>
    </div>
    ${!isPerChar ? `
    <div class="field">
      <label>群聊自动接龙轮次上限（0～5）</label>
      <input class="input" type="number" min="0" max="5" value="${s.groupRounds ?? 2}" id="cs-group-rounds" style="width:100px;">
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">1 轮 = 群内每个成员各发言一次；到轮立即停止，防刷屏防卡死。可在每个群的群聊设置里单独覆盖。此项只与群聊相关，访客个人主页的聊天设置里不再显示</div>
    </div>` : ''}

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>访客主动发消息</span>
        <input type="checkbox" id="cs-proactive" ${s.proactive ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">总开关关闭时，以下两种模式都不发</div>
      <label style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;">
        <span style="font-size:13.5px;">按固定间隔发消息<small style="display:block;color:var(--text-tertiary);font-size:11.5px;">每隔固定分钟发一条</small></span>
        <input type="checkbox" id="cs-proactive-fixed" ${!s.proactiveRandom ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="display:flex;gap:10px;align-items:center;margin:8px 0 0 12px;" id="cs-fixed-row">
        <span style="font-size:13px;color:var(--text-secondary);white-space:nowrap;">间隔（分钟 1～120）</span>
        <input class="input" type="number" min="1" max="120" value="${s.proactiveMin}" id="cs-proactive-min" style="width:90px;">
      </div>
      <label style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;">
        <span style="font-size:13.5px;">随机发消息<small style="display:block;color:var(--text-tertiary);font-size:11.5px;">在下方设置的分钟区间内随机时刻发，不固定</small></span>
        <input type="checkbox" id="cs-proactive-random" ${s.proactiveRandom ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="display:flex;gap:10px;align-items:center;margin:8px 0 0 12px;" id="cs-rand-row">
        <span style="font-size:13px;color:var(--text-secondary);white-space:nowrap;">区间（分钟）</span>
        <input class="input" type="number" min="1" max="720" value="${parseInt(s.proactiveRandMin, 10) || 10}" id="cs-proactive-rand-min" style="width:80px;" title="最小间隔">
        <span style="font-size:13px;color:var(--text-tertiary);">～</span>
        <input class="input" type="number" min="1" max="720" value="${parseInt(s.proactiveRandMax, 10) || 120}" id="cs-proactive-rand-max" style="width:80px;" title="最大间隔">
        <span style="font-size:12px;color:var(--text-tertiary);">TA 只会在最小～最大分钟之间的随机时刻发</span>
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">两个勾选互斥：勾选其中一个，另一个自动取消</div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>访客随机查岗</span>
        <input type="checkbox" id="cs-proactive-checkin" ${s.proactiveCheckin ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px;">
        <span style="font-size:13px;color:var(--text-secondary);white-space:nowrap;">每日上限（0=不限制）</span>
        <input class="input" type="number" min="0" max="99" value="${s.checkinDailyLimit ?? 0}" id="cs-checkin-limit" style="width:80px;">
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">开启后访客会随机突击查岗（15.1）：TA 会问你「现在在做什么」，并抽字卡汇报自己正在做的事。默认不限次数，可设每日上限</div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>访客随机来电</span>
        <input type="checkbox" id="cs-random-call" ${s.randomCall ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px;">
        <span style="font-size:13px;color:var(--text-secondary);white-space:nowrap;">每日上限（0=不限制）</span>
        <input class="input" type="number" min="0" max="99" value="${s.callDailyLimit ?? 0}" id="cs-call-limit" style="width:80px;">
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">开启后访客会随机向你发起视频/语音通话（5.8），你可接听、拒绝或未接听。默认不限次数，可设每日上限</div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>访客随机发红包</span>
        <input type="checkbox" id="cs-random-packet" ${s.randomPacket ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">20260929ba：开启后访客会按 40～240 分钟的随机间隔从 TA 自己的钱包给你发红包（与查岗/来电同款的随机模式）。群聊里的成员随机发群红包在「群聊设置」单独开关</div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>通话悬浮窗模式</span>
        <select class="input" id="cs-float-mode" style="width:auto;padding:8px 10px;font-size:13px;">
          <option value="internal" ${floatSettings.floatMode === 'internal' ? 'selected' : ''}>仅悬浮在软件内部</option>
          <option value="overlay" ${floatSettings.floatMode === 'overlay' ? 'selected' : ''}>在手机/其他软件上悬浮</option>
        </select>
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">「在其他软件上悬浮」需要系统授予悬浮窗权限（网页端为通知权限）</div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>悬浮窗2号（缩小后的通话小窗）允许浮游</span>
        <input type="checkbox" id="cs-float2" ${s.allowFloat2 !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">开启后，等比缩小/放大后的模拟通话窗口可以按住拖到屏幕任意位置浮着；关闭则始终居中、不可拖动。与「缩小悬浮窗」（1号）互不影响</div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:10px;padding:10px;border:1px dashed var(--border);border-radius:12px;">
        <div style="position:relative;width:86px;height:54px;border-radius:8px;background:var(--bg-elevated-2);border:1px solid var(--border);flex-shrink:0;overflow:hidden;" aria-hidden="true">
          <div style="position:absolute;left:8px;top:9px;width:38px;height:4px;border-radius:2px;background:var(--border);"></div>
          <div style="position:absolute;left:8px;top:19px;width:54px;height:4px;border-radius:2px;background:var(--border);"></div>
          <div style="position:absolute;left:8px;top:29px;width:30px;height:4px;border-radius:2px;background:var(--border);"></div>
          <div style="position:absolute;right:3px;bottom:3px;width:24px;height:24px;border-radius:7px;background:var(--purple);box-shadow:0 2px 8px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;">
            <div style="width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,0.88);"></div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary);line-height:1.7;">功能示意：缩小后的通话小窗像右上角这个悬浮小方块，按住即可拖到软件界面任意位置浮着；松手后停在那儿，继续显示头像和通话时长，点击可展开回完整通话。</div>
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:8px;">悬浮范围：</div>
      <div style="display:flex;gap:8px;margin-top:6px;" id="cs-float2-mode">
        <button class="btn float2-mode-btn" data-mode="inner" style="padding:7px 13px;font-size:12px;flex:1;">悬浮在软件内</button>
        <button class="btn float2-mode-btn" data-mode="system" style="padding:7px 13px;font-size:12px;flex:1;">其他应用上悬浮</button>
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;" id="cs-float2-mode-hint">「其他应用上悬浮」需打包成 APP（Android）才能悬浮到系统桌面/其他应用上；网页端会自动回退为软件内悬浮</div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>消息提示音</span>
        <input type="checkbox" id="cs-sound" ${s.soundOn ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <span style="font-size:13px;color:var(--text-secondary);white-space:nowrap;">提示音类型</span>
        <select class="input" id="cs-sound-name" style="width:auto;padding:8px 10px;font-size:13px;">
          ${Object.keys(SOUND_PRESETS).map(n => `<option value="${n}" ${n === (s.soundName || '默认') ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <button class="btn" style="padding:8px 14px;font-size:13px;" id="cs-sound-test">试听</button>
      </div>
      <div style="margin-top:12px;padding:12px;border:1px dashed var(--border);border-radius:12px;">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">DIY 自定义提示音：上传你自己的音频文件（mp3/wav 等），上传后替代内置音色</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label class="btn" for="cs-sound-file" style="flex:1;cursor:pointer;justify-content:center;padding:9px 0;">${s.customSound ? '已上传 · 重新上传' : '上传音频文件'}</label>
          ${s.customSound ? `<button class="btn" style="padding:9px 14px;color:var(--danger);" id="cs-sound-clear">移除</button>` : ''}
        </div>
        <input type="file" id="cs-sound-file" accept="audio/*" style="display:none;">
      </div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>访客随机戳一戳</span>
        <select class="input" id="cs-poke-mode" style="width:auto;padding:8px 10px;font-size:13px;">
          <option value="off" ${s.charPoke === 'off' ? 'selected' : ''}>关</option>
          <option value="mid" ${(s.charPoke || 'mid') === 'mid' ? 'selected' : ''}>偶尔（约 10%）</option>
          <option value="often" ${s.charPoke === 'often' ? 'selected' : ''}>经常（约 25%）</option>
        </select>
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">开启后，访客发消息（回复和主动消息）时可能随机附带一次戳一戳：从字卡库「访客戳一戳」抽文案，以「访客名 + 文案」显示在聊天页面中间（不是气泡）</div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>访客主动寄书信</span>
        <input type="checkbox" id="cs-letters" ${s.lettersEnabled !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">开启后，访客会按固定间隔主动寄来书信（火漆印信封），每天不超过下方上限</div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px;">
        <span style="font-size:13px;color:var(--text-secondary);white-space:nowrap;">每日上限（0～5 封）</span>
        <input class="input" type="number" min="0" max="5" value="${s.lettersDailyLimit ?? 2}" id="cs-letter-limit" style="width:80px;">
      </div>
    </div>

    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>允许撤回消息</span>
        <input type="checkbox" id="cs-recall" ${s.allowRecall ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">长按自己发送的字卡/表情包可撤回；撤回后仍可点击查看，永久保留</div>
    </div>

    ${!isPerChar && s.overclockUnlocked ? `
    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>跳过超频动画</span>
        <input type="checkbox" id="cs-skip-oc" ${s.skipOverclockAnim ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">超频已解锁；开启后跳过超频动画</div>
    </div>
    ` : ''}

    ${isPerChar && s.overclockUnlocked ? `
    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>跳过超频动画</span>
        <input type="checkbox" id="cs-skip-oc" ${s.skipOverclockAnim ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">只影响该访客主动赠送礼物/惊喜时的过场动画</div>
    </div>
    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>允许该访客主动触发超频</span>
        <input type="checkbox" id="cs-oc-proactive" ${s.overclockProactive !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">开启后，TA 在主动发消息时才可能顺带送出礼物或惊喜</div>
    </div>
    ` : ''}

    ${!isPerChar ? `
    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>系统通知（挂后台/切走时弹系统弹窗）</span>
        <input type="checkbox" id="cs-notify-sys" ${s.notifySystem !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">类似 QQ/微信的桌面弹窗：软件挂在后台或不在该聊天页时，新消息/书信/朋友圈等走系统通知。通知权限：<span id="cs-notify-status" style="color:var(--purple-soft);">检测中…</span> <button class="btn" id="cs-notify-ask" style="padding:4px 12px;font-size:12px;margin-left:6px;">申请通知权限</button></div>
    </div>
    ` : ''}

    ${isPerChar ? `
    <div class="field">
      <label style="display:flex;align-items:center;justify-content:space-between;">
        <span>关闭该访客的消息提示音</span>
        <input type="checkbox" id="cs-mute" ${s.muteNotifications ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">开启后，TA 发消息时不再响提示音、也不弹系统通知（未读红点仍会显示）。注意：你在聊天页面里时，任何提示音都不会响</div>
    </div>
    ` : ''}

    <button class="btn primary block" id="cs-save">保存</button>
  `;
}

function bindChatSettings(s, onSave) {
  $('#cs-close').onclick = closeModal;
  // 20260929bi：悬浮窗2号浮游开关（仅总聊天设置；立即生效）
  const f2cb = $('#cs-float2');
  if (f2cb) f2cb.onchange = async () => {
    chatSettings.allowFloat2 = f2cb.checked;
    await setSetting('chatSettings', chatSettings);
    miniToast(f2cb.checked ? '悬浮窗2号已允许浮游' : '悬浮窗2号已锁定居中');
  };
  // 20260929bk：悬浮窗2号模式选择（软件内 / 其他应用上）——全局与访客级都渲染
  const f2ModeBtns = $$('#cs-float2-mode .float2-mode-btn');
  const refreshF2ModeUI = () => {
    f2ModeBtns.forEach(b => {
      const active = (b.dataset.mode || 'inner') === (s.float2Mode || 'inner');
      b.style.outline = active ? '2px solid var(--purple-soft)' : 'none';
      b.style.background = active ? 'var(--purple-soft)' : '';
      b.style.color = active ? '#141019' : '';
      b.style.fontWeight = active ? '600' : '400';
    });
  };
  refreshF2ModeUI();
  f2ModeBtns.forEach(b => {
    b.onclick = async () => {
      s.float2Mode = b.dataset.mode || 'inner';
      chatSettings.float2Mode = s.float2Mode;
      refreshF2ModeUI();
      miniToast(s.float2Mode === 'system' ? '已设为「其他应用上悬浮」（网页端自动回退软件内）' : '已设为「悬浮在软件内」');
    };
  });
  // 20260929bi：系统通知开关 + 权限状态 + 申请按钮（用户手势内申请，浏览器才会弹授权框）
  const nsEl = $('#cs-notify-sys');
  if (nsEl) nsEl.onchange = async () => {
    chatSettings.notifySystem = nsEl.checked;
    await setSetting('chatSettings', chatSettings);
    miniToast(nsEl.checked ? '系统通知已开启' : '系统通知已关闭');
  };
  const nStatus = $('#cs-notify-status');
  const syncNotifyStatus = () => {
    if (!nStatus) return;
    // 20261001ci：APK 端状态走本地通知插件；异步取状态
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (LN && typeof LN.checkPermissions === 'function') {
      nStatus.textContent = '查询中…';
      LN.checkPermissions().then((st) => {
        const d = st && st.display;
        if (d === 'granted') nStatus.textContent = '已授权';
        else if (d === 'denied') nStatus.textContent = '已被拒绝（系统设置→应用→白日梦→通知管理里开启）';
        else nStatus.textContent = '未申请';
      }).catch(() => { nStatus.textContent = '未申请'; });
      return;
    }
    if (!('Notification' in window)) nStatus.textContent = '浏览器不支持';
    else if (Notification.permission === 'granted') nStatus.textContent = '已授权';
    else if (Notification.permission === 'denied') nStatus.textContent = '已被拒绝（需在浏览器站点设置里开启）';
    else nStatus.textContent = '未申请';
  };
  syncNotifyStatus();
  const nAsk = $('#cs-notify-ask');
  if (nAsk) nAsk.onclick = () => { requestNotificationPermission(); setTimeout(syncNotifyStatus, 1000); };
  // 20260929ah：聊天模式切换（仅总聊天设置渲染了该行；立即生效，与顶栏开关同款逻辑）
  document.querySelectorAll('.cs-ai-btn').forEach(btn => {
    btn.onclick = async () => {
      const mode = btn.dataset.mode;
      const cfg = await loadAIConfig();
      if (cfg.chatMode === mode) return;
      if (mode === 'ai' && !(cfg.chatApi && cfg.chatApi.url && cfg.chatApi.url.trim())) {
        showToast('尚未配置 API，请先在「主页 → API 接入」填写链接');
        return;
      }
      const doSwitch = async () => {
        cfg.chatMode = mode;
        await saveAIConfig(cfg);
        invalidateAICache();
        playModeBeep(mode === 'ai');
        miniToast(mode === 'ai' ? '已切换到 AI 模式' : '已切换到字卡模式');
        refreshModeSwitchUI();
        document.querySelectorAll('.cs-ai-btn').forEach(b => b.classList.toggle('primary', b.dataset.mode === mode));
      };
      if (mode === 'ai' && hasFixedProactiveChar()) { warnAIApiBurn(doSwitch); return; }
      await doSwitch();
    };
  });
  refreshModeSwitchUI().then(() => {
    loadAIConfig().then(cfg => {
      document.querySelectorAll('.cs-ai-btn').forEach(b => b.classList.toggle('primary', b.dataset.mode === cfg.chatMode));
    });
  });
  const link = (rangeId, numId) => {
    $(rangeId).oninput = (e) => { $(numId).value = e.target.value; };
    $(numId).oninput = (e) => { if (e.target.value !== '') $(rangeId).value = Math.min(120, Math.max(0, parseInt(e.target.value) || 0)); };
  };
  link('#cs-min', '#cs-min-num');
  link('#cs-max', '#cs-max-num');

  // 主动发消息双模式互斥：勾选固定间隔 → 取消随机；勾选随机 → 取消固定间隔
  const fixedCb = $('#cs-proactive-fixed');
  const randomCb = $('#cs-proactive-random');
  const fixedRow = $('#cs-fixed-row');
  const randRow = $('#cs-rand-row'); // 20260929bf：随机模式分钟区间行（勾选随机才显示）
  const syncFixedRow = () => { if (fixedRow) fixedRow.style.visibility = fixedCb.checked ? 'visible' : 'hidden'; };
  const syncRandRow = () => { if (randRow) randRow.style.visibility = randomCb.checked ? 'visible' : 'hidden'; };
  fixedCb.onchange = () => { if (fixedCb.checked) randomCb.checked = false; syncFixedRow(); syncRandRow(); };
  randomCb.onchange = () => { if (randomCb.checked) fixedCb.checked = false; syncFixedRow(); syncRandRow(); };
  syncFixedRow();
  syncRandRow();

  $('#cs-sound-test').onclick = () => {
    const prev = chatSettings.soundName;
    chatSettings.soundName = $('#cs-sound-name').value;
    chatSettings.soundOn = true;
    playDing();
    chatSettings.soundName = prev;
    chatSettings.soundOn = $('#cs-sound').checked;
  };
  // DIY 自定义提示音：上传音频文件
  $('#cs-sound-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // 音频文件直接读为 dataURL（不压缩），限制 5MB 以内
    if (file.size > 5 * 1024 * 1024) { showToast('音频文件过大，请选择 5MB 以内的文件'); e.target.value = ''; return; }
    s.customSound = await fileToDataUrl(file);
    s.soundName = '自定义';
    s.soundOn = true;
    miniToast('自定义提示音已上传，可点「试听」预览');
    // 重新渲染当前弹窗以刷新状态
    onSave();
  };
  const clearSound = $('#cs-sound-clear');
  if (clearSound) {
    clearSound.onclick = () => {
      s.customSound = '';
      s.soundName = '默认';
      miniToast('已移除自定义提示音');
      onSave();
    };
  }
  $('#cs-save').onclick = async () => {
    s.minDelay = parseInt($('#cs-min-num').value) || 0;
    s.maxDelay = parseInt($('#cs-max-num').value) || 0;
    if (s.minDelay > s.maxDelay) { const t = s.minDelay; s.minDelay = s.maxDelay; s.maxDelay = t; }
    s.proactive = $('#cs-proactive').checked;
    s.proactiveMin = Math.min(120, Math.max(1, parseInt($('#cs-proactive-min').value) || 10));
    // 20260929bf：随机发消息分钟区间（1~720；最小>最大时自动对调）
    let randMin = Math.min(720, Math.max(1, parseInt($('#cs-proactive-rand-min').value, 10) || 10));
    let randMax = Math.min(720, Math.max(1, parseInt($('#cs-proactive-rand-max').value, 10) || 120));
    if (randMin > randMax) { const t = randMin; randMin = randMax; randMax = t; }
    s.proactiveRandMin = randMin;
    s.proactiveRandMax = randMax;
    // 双模式互斥：随机勾选优先判定；固定勾选时 proactiveRandom=false
    s.proactiveRandom = $('#cs-proactive-random').checked;
    if (s.proactive && !s.proactiveRandom && !$('#cs-proactive-fixed').checked) {
      // 两个都没勾：视为固定间隔（避免双开关全关导致"看似开了却从不发"的困惑）
      s.proactiveRandom = false;
    }
    s.proactiveCheckin = $('#cs-proactive-checkin').checked;
    s.randomCall = $('#cs-random-call').checked;
    s.randomPacket = !!$('#cs-random-packet').checked;
    // az：群聊自动接龙轮次上限（仅总聊天设置渲染该输入；0~5）
    const grEl = $('#cs-group-rounds');
    if (grEl) s.groupRounds = Math.min(5, Math.max(0, parseInt(grEl.value, 10) || 0));
    // 20260929an：查岗/来电每日上限（0=不限制；默认 0）
    const cklEl = $('#cs-checkin-limit');
    if (cklEl) s.checkinDailyLimit = Math.min(99, Math.max(0, parseInt(cklEl.value, 10) || 0));
    const cllEl = $('#cs-call-limit');
    if (cllEl) s.callDailyLimit = Math.min(99, Math.max(0, parseInt(cllEl.value, 10) || 0));
    const letterLimitEl = $('#cs-letter-limit');
    if (letterLimitEl) s.lettersDailyLimit = Math.min(5, Math.max(0, parseInt(letterLimitEl.value, 10) || 0));
    const lettersEl = $('#cs-letters');
    if (lettersEl) s.lettersEnabled = lettersEl.checked;
    // 重新锚定主动消息计时：从现在开始算，避免保存后因旧计时点已过期而立刻弹出一堆消息
    _lastProactive = {};
    _proactiveRandUntil = {};
    // 悬浮窗模式：全局设置
    floatSettings.floatMode = $('#cs-float-mode').value;
    await setSetting('floatSettings', floatSettings);
    if (floatSettings.floatMode === 'overlay') {
      requestNotificationPermission();
    }
    s.soundOn = $('#cs-sound').checked;
    s.soundName = $('#cs-sound-name').value;
    s.allowRecall = $('#cs-recall').checked;
    const pokeEl = $('#cs-poke-mode');
    if (pokeEl) s.charPoke = pokeEl.value;
    const muteEl = $('#cs-mute');
    if (muteEl) s.muteNotifications = muteEl.checked;
    const ocSkipEl = $('#cs-skip-oc');
    if (ocSkipEl) s.skipOverclockAnim = ocSkipEl.checked;
    const ocProEl = $('#cs-oc-proactive');
    if (ocProEl) s.overclockProactive = ocProEl.checked;
    // 20260929ah：AI 模式下保存「固定间隔发消息」→ 中间弹窗警告 API 消耗，玩家确认才落库
    const skipOcEl = $('#cs-skip-oc');
    if (skipOcEl) chatSettings.skipOverclockAnim = skipOcEl.checked;
    const ocProGlobalEl = $('#cs-oc-proactive');
    if (ocProGlobalEl) chatSettings.overclockProactive = ocProGlobalEl.checked;
    const willFixed = s.proactive && !s.proactiveRandom;
    if (willFixed && await isAIMode()) {
      warnAIApiBurn(() => { onSave(); });
      return;
    }
    onSave();
  };
}

async function showChatSettingsModal() {
  const settingsView = Object.assign({}, chatSettings, { overclockUnlocked: await isOverclockUnlocked() });
  openModal(chatSettingsHtml(settingsView, '聊天设置', '这里是总设置，对所有访客生效；单个访客可在其主页单独覆盖'));
  bindChatSettings(chatSettings, async () => {
    await setSetting('chatSettings', chatSettings);
    miniToast('聊天设置已保存');
    closeModal();
  });
}

/* 访客级聊天设置：存在 character.chatSettings 上，未设置字段继承全局 */
async function showCharChatSettingsModal(c) {
  c.chatSettings = c.chatSettings || {};
  const unlocked = await isOverclockUnlocked();
  const s = getCharChatSettings(c);
  s.overclockUnlocked = unlocked;
  openModal(chatSettingsHtml(s, '聊天设置', `针对「${escapeHtml(c.name)}」的独立设置，仅影响 TA 一人`, true));
  bindChatSettings(s, async () => {
    // 把与全局不同的字段写回角色，继承的字段从全局取
    c.chatSettings = c.chatSettings || {};
    for (const k of ['minDelay','maxDelay','proactive','proactiveMin','proactiveRandMin','proactiveRandMax','proactiveRandom','proactiveCheckin','checkinDailyLimit','randomCall','callDailyLimit','randomPacket','overclockProactive','skipOverclockAnim','soundOn','soundName','customSound','allowRecall','muteNotifications','charPoke','lettersEnabled','lettersDailyLimit','allowFloat2','float2Mode']) {
      if (s[k] !== chatSettings[k]) c.chatSettings[k] = s[k];
      else delete c.chatSettings[k];
    }
    await saveChar(c);
    miniToast('已保存该访客的聊天设置');
    closeModal();
  });
}

/* ---------- 总设置（18.1：清缓存/清所有聊天记录/重置） ---------- */
async function showSettingsModal() {
  _settingsActive = true; // 20260929bl：总设置上下文——子功能关闭后自动回到这里
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">总设置</div>
      <button class="icon-btn" id="gs-close">✕</button>
    </div>

    <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:10px;">清理与重置（数据迁移请前往「数据管理」）</div>
    <button class="btn block" style="margin-bottom:10px;justify-content:space-between;" id="btn-splash-audio-guide">
      开屏音乐播放设置引导（浏览器白名单） <span>🎵</span>
    </button>
    <button class="btn block" style="margin-bottom:10px;justify-content:space-between;" id="btn-splash-music-setting">
      更换开屏动画音乐 <span>🎹</span>
    </button>
    <button class="btn block" style="margin-bottom:10px;justify-content:space-between;" id="btn-app-sound-setting">
      更换软件内提示音 <span>🔔</span>
    </button>
    <div class="field" style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;margin-bottom:12px;">
      <label style="display:flex;align-items:center;justify-content:space-between;font-weight:600;">🎵 音乐音量</label>
      <div style="margin-top:10px;">
        <label style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-secondary);margin-bottom:4px;"><span>开屏动画音乐</span><span id="gs-splash-vol-val"></span></label>
        <input type="range" id="gs-splash-vol" min="0" max="200" step="5" style="width:100%;accent-color:var(--purple);">
      </div>
      <div style="margin-top:8px;">
        <label style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-secondary);margin-bottom:4px;"><span>软件内音乐</span><span id="gs-app-vol-val"></span></label>
        <input type="range" id="gs-app-vol" min="0" max="200" step="5" style="width:100%;accent-color:var(--purple);">
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:8px;line-height:1.6;">两条音量条互相独立：上面一条只调开屏动画部分的音乐（默认 150%，比原来更响）；下面一条只调「开屏音乐继续播放」开启后贯穿软件内的音乐音量。</div>
    </div>
    <div class="field" style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;margin-bottom:12px;">
      <label style="display:flex;align-items:center;justify-content:space-between;font-weight:600;">
        <span>开发者模式</span>
        <input type="checkbox" id="gs-developer-mode" ${chatSettings.developerMode ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </label>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:7px;line-height:1.6;">开启需输入密码。开启后可在访客单聊输入命令，让访客发朋友圈/表情包/戳一戳/查岗/超频/视频通话/发红包/书信/问卷。命令不会作为普通消息发送，且不受任何功能解锁限制。</div>
    </div>
    <button class="btn block" style="margin-bottom:10px;justify-content:space-between;" id="btn-anniv-card-setting">
      入梦签纪念日设置 <span>🎉</span>
    </button>

    <button class="btn block" style="margin-bottom:10px;justify-content:space-between;" id="btn-software-notice">
      软件声明与使用须知 <span>📜</span>
    </button>

    <button class="btn block" style="margin-bottom:10px;justify-content:space-between;" id="btn-keepalive-guide">
      后台保活设置引导 <span>🛡️</span>
    </button>

    <button class="btn block" style="margin-bottom:10px;justify-content:space-between;" id="btn-clear-cache">
      清除缓存 <span>🧹</span>
    </button>
    <button class="btn block" style="margin-bottom:10px;justify-content:space-between;" id="btn-clear-all-chat">
      清除所有聊天记录 <span>💬</span>
    </button>
    <button class="btn danger block" style="justify-content:space-between;" id="btn-reset">
      重置（恢复出厂设置）
    </button>
    <div style="font-size:12px;color:var(--text-tertiary);margin-top:12px;">只有重置会影响美化、字卡和表情包（18.1）</div>
    <div style="text-align:center;font-size:12px;color:var(--text-tertiary);margin-top:16px;">《白日梦》 v${APP_VERSION}</div>
    <div id="layout-check" style="text-align:center;font-size:11px;color:var(--text-tertiary);margin-top:4px;opacity:.85;"></div>
  `);
  $('#gs-close').onclick = closeModal;
  $('#btn-splash-audio-guide').onclick = () => showSplashAudioGuideModal(); // 20260930bx：浏览器自动播放白名单引导
  $('#btn-splash-music-setting').onclick = () => showSplashMusicModal();    // 20260930bx：更换开屏动画音乐
  $('#btn-app-sound-setting').onclick = () => showAppSoundModal();          // 20260930bx：更换软件内提示音
  // 20260930cb：两条独立音乐音量条——kv 存百分数字符串（splash.js 每次进入独立读库），
  // 拖动时实时调 window.__bmSplashVol（正在播放就平滑过渡），下次开屏按存档生效
  {
    const svIn = $('#gs-splash-vol'), avIn = $('#gs-app-vol');
    const svVal = $('#gs-splash-vol-val'), avVal = $('#gs-app-vol-val');
    const sv0 = parseInt(await getSetting('splashBgmVol', '150'), 10);
    const av0 = parseInt(await getSetting('appBgmVol', '100'), 10);
    svIn.value = isNaN(sv0) ? 150 : Math.max(0, Math.min(200, sv0));
    avIn.value = isNaN(av0) ? 100 : Math.max(0, Math.min(200, av0));
    const syncLbl = () => { svVal.textContent = svIn.value + '%'; avVal.textContent = avIn.value + '%'; };
    syncLbl();
    svIn.oninput = () => {
      svVal.textContent = svIn.value + '%';
      setSetting('splashBgmVol', String(svIn.value));
      if (window.__bmSplashVol) window.__bmSplashVol.setSplash(svIn.value);
    };
    avIn.oninput = () => {
      avVal.textContent = avIn.value + '%';
      setSetting('appBgmVol', String(avIn.value));
      if (window.__bmSplashVol) window.__bmSplashVol.setApp(avIn.value);
    };
  }
  $('#gs-developer-mode').onchange = async (e) => {
    const box = e.target;
    if (box.checked) {
      // 20260929au：开启开发者模式需输入密码
      box.checked = false; // 先还原，密码通过后再勾选
      openModal(`
        <div style="font-size:17px;font-weight:600;margin-bottom:6px;">输入开发者密码</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px;">用于测试系统功能，命令为绝对优先级</div>
        <div class="field">
          <input class="input" type="password" id="dev-pwd-input" placeholder="请输入密码" autocomplete="off">
        </div>
        <div style="display:flex;gap:10px;margin-top:6px;">
          <button class="btn" style="flex:1;" id="dev-pwd-cancel">取消</button>
          <button class="btn primary" style="flex:1;" id="dev-pwd-ok">确认</button>
        </div>`);
      const input = $('#dev-pwd-input');
      $('#dev-pwd-cancel').onclick = closeModal;
      const confirm = async () => {
        const v = (input.value || '').trim();
        // 20260929av：只比对哈希，代码中不存明文密码
        if (_devPwdHash(v) === DEV_PWD_HASH && v.length === DEV_PWD_LEN) {
          closeModal();
          chatSettings.developerMode = true;
          await setSetting('chatSettings', chatSettings);
          box.checked = true;
          miniToast('开发者模式已开启');
        } else {
          miniToast('密码错误');
          input.value = '';
          input.focus();
        }
      };
      $('#dev-pwd-ok').onclick = confirm;
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') confirm(); });
      setTimeout(() => input.focus(), 60);
      return;
    }
    chatSettings.developerMode = false;
    await setSetting('chatSettings', chatSettings);
    miniToast('开发者模式已关闭');
  };
  /* 布局自检（20260929o）：底栏是否完整落在视口内 + 缩放信息。
     若"底栏被裁"与版本号一起出现，说明页面没有加载到最新代码（强刷 Ctrl+F5）；
     若 DPR ≠ 1 说明浏览器/系统缩放非 100%，配合窗口截图可定位裁切来源 */
  try {
    const lc = $('#layout-check');
    if (lc) {
      const de = document.documentElement;
      const tbEl = document.querySelector('.tabbar');
      const tbB = tbEl ? tbEl.getBoundingClientRect() : null;
      const tbOk = tbB ? (tbB.bottom <= de.clientHeight + 1 && tbB.top >= -1) : null;
      lc.textContent = `视口 ${innerWidth}×${de.clientHeight} · 底栏${tbOk === null ? '—' : (tbOk ? '完整 ✓' : '被裁 ✗')} · 缩放 ${Math.round((devicePixelRatio || 1) * 100)}%`;
    }
  } catch (e) {}
  $('#btn-anniv-card-setting').onclick = () => showAnnivCardSettingModal();
  $('#btn-software-notice').onclick = () => showSoftwareNotice({ review: true }); // 20260929bk：总设置重看软件声明
  $('#btn-keepalive-guide').onclick = () => showKeepAliveModal(); // 20260929bl：后台保活设置引导
  $('#btn-clear-cache').onclick = () => {
    miniToast('缓存已清理（网页端无多余缓存项）');
  };
  $('#btn-clear-all-chat').onclick = () => {
    showConfirm('确定清除所有访客的聊天记录吗？此操作无法撤销。', async () => {
      const msgs = await idbGetAll('messages');
      for (const m of msgs) await idbDelete('messages', m.id);
      miniToast('已清除所有聊天记录');
      if (currentCharId && document.body.dataset.view === 'chat') await renderMessages(currentCharId);
    });
  };
  $('#btn-reset').onclick = () => {
    showConfirm('确定要重置吗？所有数据将清空（含访客、聊天记录、书信、字卡、表情包、世界树、记忆宫殿、问卷），此操作无法撤销。', () => {
      Promise.all([idbClear('characters'), idbClear('messages'), idbClear('kv'), idbClear('emojis'), idbClear('palace'), idbClear('surveys'), idbClear('gifts')]).then(() => {
        location.reload();
      });
    });
  };
}

/* ---------- 20260930bx：开屏音乐三个设置弹窗（总设置入口） ---------- */

/* ① 开屏音乐播放设置引导：浏览器自动播放白名单分步引导（Edge/Chrome 为主） */
function showSplashAudioGuideModal() {
  const isChromium = /Edg\//.test(navigator.userAgent || '');
  const settingsUrl = isChromium ? 'edge://settings/content/mediaAutoplay' : 'chrome://settings/content/sound';
  const browserName = isChromium ? 'Edge' : 'Chrome';
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">开屏音乐播放设置引导</div>
      <button class="icon-btn" id="sag-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-tertiary);line-height:1.7;margin-bottom:14px;">
      浏览器默认禁止网页在「零操作」下自动播放声音（安全策略，所有网页都一样，软件无法绕过）。
      想让开屏音乐每次都直接响、不用任何点击，把本站加入浏览器的「自动播放允许列表」即可，设置一次长期生效：
    </div>
    <div class="field" style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;margin-bottom:10px;">
      <div style="font-weight:600;margin-bottom:6px;">第 1 步 · 打开设置页</div>
      <div style="font-size:12.5px;color:var(--text-tertiary);line-height:1.7;">在 ${browserName} 地址栏输入并回车：</div>
      <div style="margin-top:8px;padding:9px 12px;border-radius:10px;background:rgba(167,139,250,0.14);color:var(--purple-soft);font-family:Consolas,monospace;font-size:12.5px;user-select:all;word-break:break-all;">${settingsUrl}</div>
    </div>
    <div class="field" style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;margin-bottom:10px;">
      <div style="font-weight:600;margin-bottom:6px;">第 2 步 · 添加允许站点</div>
      <div style="font-size:12.5px;color:var(--text-tertiary);line-height:1.7;">在「允许播放音频 / 允许自动播放」一栏点「添加」，输入本站地址（即浏览器地址栏里的地址）后确认。</div>
    </div>
    <div class="field" style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;margin-bottom:12px;">
      <div style="font-weight:600;margin-bottom:6px;">第 3 步 · 刷新页面</div>
      <div style="font-size:12.5px;color:var(--text-tertiary);line-height:1.7;">回到《白日梦》刷新（Ctrl+F5），重新进入开屏动画，音乐就会自动响起，不再需要点按。</div>
    </div>
    <div style="font-size:12px;color:var(--text-tertiary);line-height:1.7;">不想改浏览器设置也没关系：每次开屏动画下方都会出现「点按任意处播放音乐」提醒，点一下页面任意位置即可出声；在个人主页顶栏打开 🎵 开关，开屏结束后音乐还会继续播放。</div>
  `);
  $('#sag-close').onclick = closeModal;
}

/* ② 更换开屏动画音乐：上传音频（存 kv splashBgmCustom，dataURL），可试听/恢复默认 */
function showSplashMusicModal() {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">更换开屏动画音乐</div>
      <button class="icon-btn" id="sm-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);line-height:1.7;margin-bottom:12px;">
      上传你喜欢的音频文件（mp3/wav 等），下次进入开屏动画时将播放你上传的音乐。软件会从音频开头约 0.3 秒处开始播放并自动衔接循环播放设置。
    </div>
    <div id="sm-status" style="font-size:13px;color:var(--purple-soft);margin-bottom:10px;"></div>
    <div style="display:flex;gap:10px;">
      <label class="btn primary" for="sm-file" style="flex:1;height:44px;padding:0;cursor:pointer;justify-content:center;">上传音乐文件</label>
      <button class="btn" style="height:44px;padding:0 14px;" id="sm-preview">试听</button>
    </div>
    <div style="display:flex;gap:10px;margin-top:10px;">
      <button class="btn danger" style="flex:1;height:44px;padding:0;" id="sm-reset">恢复默认音乐</button>
    </div>
    <input type="file" id="sm-file" accept="audio/*" style="display:none;">
  `);
  $('#sm-close').onclick = closeModal;
  let _smAudio = null;
  const stopPrev = () => { try { if (_smAudio) { _smAudio.pause(); _smAudio = null; } } catch (e) {} };
  getSetting('splashBgmCustom', '').then(v => {
    const st = $('#sm-status');
    if (st) st.textContent = v ? '当前：已使用自定义音乐' : '当前：默认开屏音乐（bgm_intro）';
  });
  $('#sm-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 8 * 1024 * 1024) { miniToast('文件过大（上限 8MB），请截取后上传'); return; }
    const dataUrl = await fileToDataUrl(file);
    if (!dataUrl || dataUrl.indexOf('data:audio') !== 0) { miniToast('请选择音频文件（mp3/wav 等）'); return; }
    await setSetting('splashBgmCustom', dataUrl);
    stopPrev();
    const st = $('#sm-status');
    if (st) st.textContent = '当前：已使用自定义音乐';
    miniToast('开屏音乐已更换，下次进入开屏生效');
  };
  $('#sm-preview').onclick = async () => {
    stopPrev();
    let v = await getSetting('splashBgmCustom', '');
    if (!v) { try { v = new URL('audio/bgm_intro.mp3', location.href).href; } catch (e) { v = 'audio/bgm_intro.mp3'; } }
    try { _smAudio = new Audio(v); _smAudio.volume = 0.9; _smAudio.play(); miniToast('试听中…'); } catch (e) { miniToast('试听失败'); }
  };
  $('#sm-reset').onclick = async () => {
    await setSetting('splashBgmCustom', '');
    stopPrev();
    const st = $('#sm-status');
    if (st) st.textContent = '当前：默认开屏音乐（bgm_intro）';
    miniToast('已恢复默认开屏音乐');
  };
}

/* ③ 更换软件内提示音：上传（写 chatSettings.customSound，与聊天设置同一字段同步） */
function showAppSoundModal() {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">更换软件内提示音</div>
      <button class="icon-btn" id="as-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);line-height:1.7;margin-bottom:12px;">
      上传你自己的音频文件（mp3/wav 等）作为访客新消息提示音，上传后替代内置音色。与「聊天设置 → DIY 自定义提示音」是同一份设置，两边都会同步。
    </div>
    <div id="as-status" style="font-size:13px;color:var(--purple-soft);margin-bottom:10px;"></div>
    <div style="display:flex;gap:10px;">
      <label class="btn primary" for="as-file" style="flex:1;height:44px;padding:0;cursor:pointer;justify-content:center;">上传音频文件</label>
      <button class="btn" style="height:44px;padding:0 14px;" id="as-preview">试听</button>
      <button class="btn danger" style="height:44px;padding:0 14px;" id="as-clear">移除</button>
    </div>
    <input type="file" id="as-file" accept="audio/*" style="display:none;">
  `);
  $('#as-close').onclick = closeModal;
  let _asAudio = null;
  const stopPrev = () => { try { if (_asAudio) { _asAudio.pause(); _asAudio = null; } } catch (e) {} };
  const syncStatus = () => {
    const st = $('#as-status');
    if (st) st.textContent = chatSettings.customSound ? '当前：已使用自定义提示音' : '当前：内置提示音';
    return !!chatSettings.customSound;
  };
  syncStatus();
  $('#as-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 8 * 1024 * 1024) { miniToast('文件过大（上限 8MB），请截取后上传'); return; }
    const dataUrl = await fileToDataUrl(file);
    if (!dataUrl || dataUrl.indexOf('data:audio') !== 0) { miniToast('请选择音频文件（mp3/wav 等）'); return; }
    chatSettings.customSound = dataUrl;
    await setSetting('chatSettings', chatSettings);
    stopPrev(); syncStatus();
    miniToast('软件内提示音已更换');
  };
  $('#as-preview').onclick = () => {
    stopPrev();
    if (chatSettings.customSound) {
      try { _asAudio = new Audio(chatSettings.customSound); _asAudio.volume = 0.9; _asAudio.play(); miniToast('试听中…'); } catch (e) { miniToast('试听失败'); }
    } else {
      try { playDing(); miniToast('试听中（内置提示音）…'); } catch (e) {}
    }
  };
  $('#as-clear').onclick = async () => {
    chatSettings.customSound = '';
    await setSetting('chatSettings', chatSettings);
    stopPrev(); syncStatus();
    miniToast('已恢复内置提示音');
  };
}

/* ---------- 后台保活设置引导（20260929bl：打包 APP 版核心体验） ----------
   背景：国产 ROM（OPPO ColorOS/小米 MIUI·澎湃/华为 EMUI·鸿蒙）默认激进杀后台，
   网页与 APP 都无法 100% 免杀，但按品牌做完「自启动+电池白名单+锁定后台」三步后
   可接近 QQ/微信的存活率。本页按 UA 自动定位品牌标签，图文分步引导玩家完成设置。
   网页版玩家 → 提示对浏览器做同样设置。从总设置打开，关闭自动回总设置。 */
function showKeepAliveModal() {
  const brands = [
    { id: 'all', name: '通用', en: 'All Phones' },
    { id: 'oppo', name: 'OPPO / 一加', en: 'ColorOS' },
    { id: 'mi', name: '小米 / 红米', en: 'MIUI · 澎湃OS' },
    { id: 'hw', name: '华为 / 荣耀', en: 'HarmonyOS · MagicOS' },
  ];
  const steps = {
    all: [
      ['允许通知', '系统设置 → 通知 → 找到《白日梦》（网页版=你使用的浏览器）→ 允许通知，并打开全部通知类别。'],
      ['锁定后台', '打开最近任务（多任务）界面，找到《白日梦》卡片，下拉或长按卡片 → 点击锁形图标 🔒 加锁。加锁后系统清理不会杀掉它。'],
      ['别用一键清理', '避免用「一键清理 / 一键加速」按钮清后台——部分系统的一键清理会无视加锁。'],
      ['关省电模式', '手机电量充足时关闭「省电模式/超级省电」，该模式会冻结后台网络与活动。'],
    ],
    oppo: [
      ['允许自启动 + 完全后台行为', '设置 → 应用 → 应用管理 → 《白日梦》（网页版=浏览器）→ 耗电管理 → 开启「允许自启动」「允许完全后台行为」。'],
      ['关闭智能后台管控', '设置 → 电池 → 更多设置（应用耗电管理）→ 找到《白日梦》→ 关闭「智能后台管理」，选择「不优化」。'],
      ['最近任务加锁', '最近任务界面下拉《白日梦》卡片 → 点 🔒 锁定（ColorOS 部分版本为长按卡片 → 加锁）。'],
      ['关闭深度睡眠', '设置 → 电池 → 更多设置 → 关闭「睡眠待机优化」（部分机型有此选项）。'],
    ],
    mi: [
      ['允许自启动', '设置 → 应用设置 → 应用管理 → 《白日梦》（网页版=浏览器）→ 开启「自启动」。'],
      ['省电策略改为无限制', '设置 → 省电与电池 → 右上角 ⚙ → 应用智能省电 → 《白日梦》→ 选择「无限制」。'],
      ['允许后台弹出界面', '同一应用详情页 → 「其他权限」→ 允许「后台弹出界面」与「显示悬浮窗」（悬浮窗2号系统模式也需要）。'],
      ['最近任务加锁', '最近任务界面长按《白日梦》卡片 → 点 🔒 加锁。'],
    ],
    hw: [
      ['手动管理启动', '设置 → 电池 → 更多电池设置（或 应用 → 应用启动管理）→ 《白日梦》（网页版=浏览器）→ 关闭「自动管理」→ 手动管理里把「允许自启动」「允许关联启动」「允许后台活动」全部打开。'],
      ['休眠保持联网', '设置 → 电池 → 更多电池设置 → 开启「休眠时始终保持网络连接」。'],
      ['最近任务加锁', '最近任务界面下拉《白日梦》卡片 → 点 🔒 锁定。'],
      ['关闭省电冻结', '设置 → 电池 → 关闭「智能充电模式」以外的省电冻结类选项；部分机型在「手机管家 → 启动管理」里同样设置一遍。'],
    ],
  };
  // UA 自动定位品牌（检测不到 → 通用）
  let defTab = 'all';
  try {
    const ua = navigator.userAgent || '';
    if (/HeyTap|OPPO|OnePlus|Realme/i.test(ua)) defTab = 'oppo';
    else if (/MIUI|Xiaomi|MIX|Redmi|M201|Redmi/i.test(ua)) defTab = 'mi';
    else if (/HUAWEI|HONOR|EMUI|HarmonyOS/i.test(ua)) defTab = 'hw';
  } catch (e) {}
  let curTab = defTab;

  const renderTab = () => {
    const list = steps[curTab] || [];
    return list.map((s, i) => `
      <div class="ka-step">
        <div class="ka-step-num">${i + 1}</div>
        <div class="ka-step-main">
          <div class="ka-step-title">${s[0]}</div>
          <div class="ka-step-desc">${s[1]}</div>
        </div>
      </div>`).join('');
  };
  const syncUI = () => {
    $$('#ka-tabs .ka-tab').forEach(b => {
      const on = b.dataset.brand === curTab;
      b.classList.toggle('on', on);
    });
    const body = $('#ka-body');
    if (body) body.innerHTML = renderTab();
  };

  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div>
        <div style="font-size:18px;font-weight:600;">后台保活设置引导</div>
        <div style="font-size:11px;letter-spacing:2px;color:var(--purple-soft);margin-top:3px;">KEEP ALIVE GUIDE</div>
      </div>
      <button class="icon-btn" id="ka-close">✕</button>
    </div>
    <div style="font-size:12.5px;line-height:1.8;color:var(--text-tertiary);margin-bottom:12px;">
      国产手机系统默认会清理后台。完成下面设置后，《白日梦》的消息通知就能像 QQ / 微信一样在后台稳定弹出（打包 APP 效果最佳；<b>网页版请对你使用的浏览器做同样设置</b>）。
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;" id="ka-tabs">
      ${brands.map(b => `<button class="btn ka-tab" data-brand="${b.id}" style="padding:7px 13px;font-size:12.5px;">${b.name}</button>`).join('')}
    </div>
    <div id="ka-body"></div>
    <div style="margin-top:14px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-elevated-2);font-size:11.5px;line-height:1.7;color:var(--text-tertiary);">
      设置完成后建议重启一次软件。若仍收不到通知，请检查系统「勿扰 / 专注模式」。极端内存不足时任何应用都可能被系统回收，重要数据记得定期「全局导出」备份。
    </div>
  `);
  $('#ka-close').onclick = closeModal;
  $$('#ka-tabs .ka-tab').forEach(b => { b.onclick = () => { curTab = b.dataset.brand; syncUI(); }; });
  syncUI();
}

/* ---------- 数据管理弹窗（18.2：专注数据迁移——导入/导出） ---------- */
async function showDataModal() {
  /* 20260929x：改为分类导航页——点条目才进入该分类的导入导出子页；子页关闭/取消回本导航页 */
  /* 20260929z：图标第二版——统一淡紫（与主页功能宫格 .grid-icon 同视觉语言），不再五颜六色 */
  const cats = [
    { id: 'migrate', ic: 'data',    name: '数据迁移', desc: '整包备份 / 恢复（.ocdata）· 清理冗余缓存' },
    { id: 'chat',    ic: 'chatset', name: '聊天记录', desc: '单独导出 / 导入聊天记录 · 一键清空' },
    { id: 'letters', ic: 'letter',  name: '书信', desc: '往来书信与信箱文件夹（.letterdata）' },
    { id: 'world',   ic: 'tree',    name: '世界树', desc: '世界观设定库（.worlddata，原世界书）' },
    { id: 'palace',  ic: 'memory',  name: '记忆宫殿', desc: '记忆条目与文件夹结构（.palacedata）' },
  ];
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">数据管理</div>
      <button class="icon-btn" id="data-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:12px;">点分类进入对应的导入 / 导出功能</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${cats.map(c => `
        <div class="pal-row" data-datacat="${c.id}" style="cursor:pointer;">
          <div class="dm-ic">${icon(c.ic, 19)}</div>
          <div class="pal-main">
            <div class="pal-title">${c.name}</div>
            <div class="pal-sub">${c.desc}</div>
          </div>
          <span style="color:var(--text-tertiary);">›</span>
        </div>`).join('')}
    </div>
    <div style="font-size:12px;color:var(--text-tertiary);margin-top:14px;">清理与重置请前往「总设置」</div>
  `);
  $('#data-close').onclick = closeModal;
  document.querySelectorAll('[data-datacat]').forEach(row => {
    row.onclick = () => showDataCatModal(row.dataset.datacat);
  });
}

/* 数据管理分类子页：✕ / 返回一律回导航页（showDataModal），不再直接退出整个弹窗 */
function showDataCatModal(id) {
  /* 20260929z：子页标题图标与导航行同款（统一淡紫 SVG），不再用 emoji */
  const ti = (ic) => `<span style="display:inline-flex;vertical-align:-4px;margin-right:7px;color:var(--purple-soft);">${icon(ic, 18)}</span>`;
  const titles = {
    migrate: [`${ti('data')}数据迁移`, '把整个《白日梦》数据打包成单个 .ocdata 文件，或从备份恢复（覆盖/合并）'],
    chat: [`${ti('chatset')}聊天记录`, '单独备份/恢复聊天记录，或一键清空（不影响访客、字卡、美化等）'],
    letters: [`${ti('letter')}书信`, '单独导出全部往来书信与信箱文件夹结构（.letterdata），或从备份导入（按 ID 合并去重）'],
    world: [`${ti('tree')}世界树`, '导出/导入世界观设定库（.worlddata，含文件夹、条目与草稿箱；导入会覆盖当前世界树）'],
    palace: [`${ti('memory')}记忆宫殿`, '导出/导入记忆条目与文件夹结构（.palacedata）；导出可选访客/玩家文件夹，导入自动分辨归属'],
  };
  const t = titles[id] || ['', ''];
  const btn = (bid, label, tail) => `<button class="btn block" style="margin-bottom:10px;justify-content:space-between;" id="${bid}">${label} <span>${tail}</span></button>`;
  openModal(`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <button class="icon-btn" id="dc-back">‹</button>
      <div style="flex:1;font-size:17px;font-weight:600;">${t[0]}</div>
      <button class="icon-btn" id="dc-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:14px;">${t[1]}</div>
    <div id="dc-body"></div>
  `);
  $('#dc-back').onclick = showDataModal;
  $('#dc-close').onclick = showDataModal;
  const body = $('#dc-body');
  if (id === 'migrate') {
    body.innerHTML = `
      ${btn('btn-export', '导出全局数据（.ocdata）', '⬇')}
      ${btn('btn-import', '导入全局数据（.ocdata）', '⬆')}
      <div style="height:1px;background:var(--border);margin:16px 0 14px;"></div>
      <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:10px;">维护：软件或浏览器更新后，清掉旧版本遗留的冗余缓存（只清缓存，<b>不影响</b>访客、聊天记录等正式数据）</div>
      ${btn('btn-clear-stale', '清除冗余缓存（旧版遗留）', '🧹')}`;
    $('#btn-export').onclick = exportAll;
    $('#btn-import').onclick = () => showImportModal(showDataModal);
    $('#btn-clear-stale').onclick = clearStaleCache;
  } else if (id === 'chat') {
    body.innerHTML = `
      ${btn('btn-export-chat', '导出聊天记录', '⬇')}
      ${btn('btn-import-chat', '导入聊天记录', '⬆')}
      ${btn('btn-data-clear-chat', '清除聊天记录', '💬')}`;
    $('#btn-export-chat').onclick = exportChatRecords;
    $('#btn-import-chat').onclick = () => showImportChatModal(showDataModal);
    $('#btn-data-clear-chat').onclick = clearAllChatRecords;
  } else if (id === 'letters') {
    body.innerHTML = `
      ${btn('btn-export-letters', '导出书信数据', '⬇')}
      ${btn('btn-import-letters', '导入书信数据', '⬆')}`;
    $('#btn-export-letters').onclick = () => showExportLettersModal(showDataModal); // 先弹选择（全部/按角色）
    $('#btn-import-letters').onclick = () => showImportLettersModal(showDataModal);
  } else if (id === 'world') {
    body.innerHTML = `
      ${btn('btn-export-world', '导出世界树数据', '⬇')}
      ${btn('btn-import-world', '导入世界树数据', '⬆')}`;
    $('#btn-export-world').onclick = exportWorldBook;
    $('#btn-import-world').onclick = () => showImportWorldModal(showDataModal);
  } else if (id === 'palace') {
    body.innerHTML = `
      ${btn('btn-export-palace', '导出记忆宫殿数据', '⬇')}
      ${btn('btn-import-palace', '导入记忆宫殿数据', '⬆')}
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">导入时会自动分辨每条记忆的归属：访客记忆归入同名访客的文件夹，玩家记忆归入玩家的记忆，认不出的默认放进玩家根部且 AI 不可读</div>`;
    $('#btn-export-palace').onclick = () => showExportPalaceModal(showDataModal);
    $('#btn-import-palace').onclick = () => showImportPalaceModal(showDataModal);
  }
}

/* ---------- 导出书信选择弹窗（20260925i）：单独导出（可选多个角色）/ 全部导出 ---------- */
/* back（20260929x）：从数据管理导航页进入时传入 showDataModal，✕/取消回导航页而不是直接退出 */
async function showExportLettersModal(back = null) {
  const backFn = () => back ? back() : closeModal();
  const letters = (await idbGetAll('messages')).filter(m => m.type === 'letter' && m.charId);
  if (!letters.length) { miniToast('还没有往来书信可以导出'); return; }
  // 只列出实际有书信往来的角色（没有信的角色选了也导不出东西）
  const withLetters = characters.filter(c => letters.some(m => m.charId === c.id));
  const picked = new Set();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">导出书信数据</div>
      <button class="icon-btn" id="lex-close">✕</button>
    </div>
    <button class="btn primary block" id="lex-all" style="margin-bottom:16px;">📦 全部导出（共 ${letters.length} 封书信）</button>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:8px;">单独导出：点选要导出的访客（可多选）</div>
    ${withLetters.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        ${withLetters.map(c => `
          <span class="badge lex-chip" data-cid="${c.id}" style="cursor:pointer;${picked.has(c.id) ? 'background:var(--purple);color:#141019;' : ''}">${escapeHtml(c.name)}</span>
        `).join('')}
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px;" id="lex-count">已选 0 个访客</div>
      <button class="btn block" id="lex-go" disabled style="opacity:.5;">⬇ 导出所选访客的书信</button>
    ` : '<div style="color:var(--text-tertiary);font-size:12.5px;margin-bottom:10px;">（还没有和任何访客的书信往来）</div>'}
    <div style="font-size:12px;color:var(--text-tertiary);margin-top:10px;">信箱文件夹结构会一并导出</div>
  `);
  $('#lex-close').onclick = backFn;
  $('#lex-all').onclick = async () => { closeModal(); await exportLetters(null); };
  const refresh = () => {
    const n = picked.size;
    const go = $('#lex-go');
    if (!go) return;
    go.disabled = n === 0;
    go.style.opacity = n === 0 ? '.5' : '1';
    $('#lex-count').textContent = `已选 ${n} 个访客`;
  };
  document.querySelectorAll('.lex-chip').forEach(chip => {
    chip.onclick = () => {
      const cid = chip.dataset.cid;
      if (picked.has(cid)) { picked.delete(cid); chip.style.background = ''; chip.style.color = ''; }
      else { picked.add(cid); chip.style.background = 'var(--purple)'; chip.style.color = '#141019'; }
      refresh();
    };
  });
  const goBtn = $('#lex-go');
  if (goBtn) goBtn.onclick = async () => {
    if (!picked.size) { miniToast('先选至少一个访客'); return; }
    closeModal();
    await exportLetters([...picked]);
  };
}

/* ---------- 导出书信数据（20260925i：charIds=null 导出全部；传角色 id 数组只导出这些角色的往来） ---------- */
async function exportLetters(charIds = null) {
  let letters = (await idbGetAll('messages')).filter(m => m.type === 'letter' && m.charId);
  const scoped = Array.isArray(charIds) && charIds.length > 0;
  if (scoped) letters = letters.filter(m => charIds.includes(m.charId));
  if (!letters.length) { miniToast('所选范围内没有书信'); return; }
  const save = await beginExport(scoped ? '白日梦书信备份（部分）.letterdata' : '白日梦书信备份.letterdata');
  if (save.cancelled) return;
  const letterFolders = await getSetting('letterFolders', []);
  const letterFolderMap = await getSetting('letterFolderMap', {});
  const data = {
    app: 'bairimeng',
    format: 'letterdata',
    version: '1.0',
    exportDate: new Date().toISOString(),
    count: letters.length,
    letters,
    letterFolders,
    letterFolderMap,
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  await finishExport(save, blob, '已导出 ' + letters.length + ' 封书信');
}

/* ---------- 导出聊天记录（单独备份 messages，不影响其他数据） ---------- */
async function exportChatRecords() {
  const save = await beginExport('白日梦聊天记录备份.chatdata'); // 先弹"另存为"（点击激活期内），再慢慢取数据
  if (save.cancelled) return;
  const messages = await idbGetAll('messages');
  const data = {
    app: 'bairimeng',
    format: 'chatdata',
    version: '1.0',
    exportDate: new Date().toISOString(),
    count: messages.length,
    messages,
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  await finishExport(save, blob, '已导出 ' + messages.length + ' 条聊天记录');
}

/* ---------- 导入聊天记录（单独恢复 messages，按消息 ID 去重合并） ---------- */
function showImportChatModal(back = null) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">导入聊天记录</div>
      <button class="icon-btn" id="ich-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">选择之前导出的「白日梦聊天记录备份.chatdata」文件，合并导入（按消息 ID 去重覆盖）</div>
    <div class="field">
      <label>选择文件</label>
      <input class="input" type="file" id="ich-file" accept=".chatdata,.json,.ocdata,application/json,application/octet-stream,text/plain">
    </div>
    <button class="btn primary block" style="margin-top:14px;" id="ich-go">导入</button>
  `);
  $('#ich-close').onclick = () => back ? back() : closeModal();
  $('#ich-go').onclick = async () => {
    const f = $('#ich-file').files[0];
    if (!f) { miniToast('请先选择文件'); return; }
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      const msgs = data.messages || data;
      if (!Array.isArray(msgs)) { miniToast('文件里没有聊天记录'); return; }
      const existing = await idbGetAll('messages');
      const existingIds = new Set(existing.map(m => m.id));
      let added = 0, updated = 0;
      for (const m of msgs) {
        if (!m || !m.id) continue;
        if (existingIds.has(m.id)) updated++; else added++;
        await idbPut('messages', m);
      }
      miniToast('导入完成：新增 ' + added + ' 条，覆盖 ' + updated + ' 条');
      closeModal();
      if (currentCharId && document.body.dataset.view === 'chat') await renderMessages(currentCharId);
      renderChatList();
    } catch (e) {
      miniToast('导入失败：' + (e && e.message ? e.message : '文件格式不对'));
    }
  };
}

/* ---------- 导出世界书数据（20260929r：.worlddata = 文件夹 + 条目 + 草稿箱；20260929x 界面文案统一改「世界树」） ---------- */
async function exportWorldBook() {
  const wb = await loadWorldBook();
  const drafts = await loadWorldDrafts();
  const save = await beginExport('白日梦世界树备份.worlddata');
  if (save.cancelled) return;
  const data = {
    app: 'bairimeng',
    format: 'worlddata',
    version: '1.0',
    exportDate: new Date().toISOString(),
    worldBook: wb,
    worldBookDrafts: drafts,
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  await finishExport(save, blob, `已导出世界树（${(wb.entries || []).length} 条内容）`);
}

/* ---------- 导入世界书数据（覆盖当前世界树；两段确认防手滑，其余数据不受影响） ---------- */
function showImportWorldModal(back = null) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">导入世界树数据</div>
      <button class="icon-btn" id="wiw-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">选择之前导出的「白日梦世界树备份.worlddata」文件。<b>导入会覆盖</b>当前世界树的全部文件夹、条目与草稿箱；访客、聊天记录等其他数据不受影响。</div>
    <div class="field">
      <label>选择文件</label>
      <input class="input" type="file" id="wiw-file" accept=".worlddata,.json,application/json,application/octet-stream,text/plain"><!-- accept 放宽：安卓常把自定义扩展名归类为 octet-stream/plain -->
    </div>
    <button class="btn primary block" style="margin-top:14px;" id="wiw-go">导入并覆盖</button>
  `);
  $('#wiw-close').onclick = () => back ? back() : closeModal();
  $('#wiw-go').onclick = async () => {
    const f = $('#wiw-file').files[0];
    if (!f) { miniToast('请先选择文件'); return; }
    try {
      const data = JSON.parse(await f.text());
      const wb = data.worldBook || ((data.folders && data.entries) ? data : null);
      if (!wb || !Array.isArray(wb.entries)) { miniToast('文件里没有世界书数据'); return; }
      const go = $('#wiw-go');
      if (!go.dataset.confirm) {
        go.dataset.confirm = '1';
        go.textContent = `确认导入（${wb.entries.length} 条内容，覆盖现有世界树）`;
        setTimeout(() => { if (go.isConnected) { go.dataset.confirm = ''; go.textContent = '导入并覆盖'; } }, 4000);
        return;
      }
      await saveWorldBook({ folders: Array.isArray(wb.folders) ? wb.folders : [], entries: wb.entries });
      if (Array.isArray(data.worldBookDrafts)) await saveWorldDrafts(data.worldBookDrafts);
      miniToast('世界书导入完成');
      closeModal();
    } catch (e) {
      miniToast('导入失败：' + (e && e.message ? e.message : '文件格式不对'));
    }
  };
}

/* ---------- 导入书信数据（20260929r：.letterdata——书信按 ID 合并去重，信箱文件夹结构并入） ---------- */
function showImportLettersModal(back = null) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">导入书信数据</div>
      <button class="icon-btn" id="wil-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">选择之前导出的「白日梦书信备份.letterdata」文件。书信按 ID 合并去重（已有书信不重复），信箱文件夹结构一并并入，不影响现有数据。</div>
    <div class="field">
      <label>选择文件</label>
      <input class="input" type="file" id="wil-file" accept=".letterdata,.json,application/json,application/octet-stream,text/plain">
    </div>
    <button class="btn primary block" style="margin-top:14px;" id="wil-go">导入</button>
  `);
  $('#wil-close').onclick = () => back ? back() : closeModal();
  $('#wil-go').onclick = async () => {
    const f = $('#wil-file').files[0];
    if (!f) { miniToast('请先选择文件'); return; }
    try {
      const data = JSON.parse(await f.text());
      const msgs = Array.isArray(data.letters) ? data.letters : (Array.isArray(data.messages) ? data.messages : null);
      if (!msgs) { miniToast('文件里没有书信数据'); return; }
      const existing = await idbGetAll('messages');
      const existingIds = new Set(existing.map(m => m.id));
      let added = 0, updated = 0;
      for (const m of msgs) {
        if (!m || !m.id || m.type !== 'letter') continue;
        if (existingIds.has(m.id)) updated++; else added++;
        await idbPut('messages', m);
      }
      // 信箱文件夹结构并入：按 id（无 id 按名称）去重，只补缺不覆盖
      if (Array.isArray(data.letterFolders) && data.letterFolders.length) {
        const cur = await getSetting('letterFolders', []);
        const have = new Set(cur.map(x => x.id || x.name));
        let changed = false;
        for (const fo of data.letterFolders) {
          const key = fo.id || fo.name;
          if (!have.has(key)) { cur.push(fo); have.add(key); changed = true; }
        }
        if (changed) await setSetting('letterFolders', cur);
      }
      if (data.letterFolderMap && typeof data.letterFolderMap === 'object') {
        const curMap = await getSetting('letterFolderMap', {});
        for (const k of Object.keys(data.letterFolderMap)) {
          if (!(k in curMap)) curMap[k] = data.letterFolderMap[k];
        }
        await setSetting('letterFolderMap', curMap);
      }
      miniToast(`书信导入完成：新增 ${added} 封，合并 ${updated} 封`);
      closeModal();
    } catch (e) {
      miniToast('导入失败：' + (e && e.message ? e.message : '文件格式不对'));
    }
  };
}

/* ---------- 清除所有聊天记录（数据管理入口，复用总设置同款逻辑） ---------- */
function clearAllChatRecords() {
  showConfirm('确定清除所有访客的聊天记录吗？此操作无法撤销。', async () => {
    const msgs = await idbGetAll('messages');
    for (const m of msgs) await idbDelete('messages', m.id);
    miniToast('已清除所有聊天记录');
    if (currentCharId && document.body.dataset.view === 'chat') await renderMessages(currentCharId);
    renderChatList();
  });
}

/* ---------- 清除冗余缓存：浏览器/软件更新后旧版本遗留的缓存（不动 IndexedDB 正式数据） ----------
   清理对象：① Cache Storage 旧静态资源；② Service Worker 残留注册；
            ③ localStorage / sessionStorage 旧版遗留键值（本应用正式数据全部存 IndexedDB）；
            ④ 非 bairimeng 的旧 IndexedDB 数据库（旧版本换库名留下的） */
async function clearStaleCache() {
  const cleaned = [];
  // ① Cache Storage
  try {
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      for (const k of keys) { await caches.delete(k); cleaned.push('缓存存储「' + k + '」'); }
    }
  } catch (e) {}
  // ② Service Worker
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) { await r.unregister(); cleaned.push('Service Worker 注册'); }
    }
  } catch (e) {}
  // ③ localStorage / sessionStorage（本应用不使用，存在即旧版遗留）
  try {
    const ls = localStorage.length || 0, ss = sessionStorage.length || 0;
    localStorage.clear();
    sessionStorage.clear();
    if (ls) cleaned.push('localStorage 旧数据 ' + ls + ' 项');
    if (ss) cleaned.push('sessionStorage 旧数据 ' + ss + ' 项');
  } catch (e) {}
  // ④ 旧版本遗留的 IndexedDB 数据库（正式库名固定为 bairimeng）
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const d of (dbs || [])) {
        if (d && d.name && d.name !== DB_NAME) {
          indexedDB.deleteDatabase(d.name);
          cleaned.push('旧数据库「' + d.name + '」');
        }
      }
    }
  } catch (e) {}
  if (cleaned.length) {
    openModal(`
      <div style="text-align:center;margin-bottom:8px;">
        <div style="font-size:40px;margin-bottom:12px;">🧹</div>
        <div style="font-size:15px;line-height:1.7;color:var(--text);">已清理 ${cleaned.length} 项冗余缓存：<br><span style="font-size:13px;color:var(--text-secondary);">${escapeHtml(cleaned.slice(0, 8).join('；'))}${cleaned.length > 8 ? ' 等' : ''}</span></div>
      </div>
      <div style="font-size:12.5px;color:var(--text-tertiary);margin-top:10px;">建议立即刷新页面，确保加载的是最新版代码（访客与聊天记录不受影响）。</div>
      <div style="display:flex;gap:10px;margin-top:18px;">
        <button class="btn" style="flex:1;" id="cc-later">稍后自己刷</button>
        <button class="btn primary" style="flex:1;" id="cc-reload">立即刷新</button>
      </div>
    `);
    $('#cc-later').onclick = closeModal;
    $('#cc-reload').onclick = () => location.reload();
  } else {
    miniToast('没发现冗余缓存，已经很干净啦');
  }
}

/* ---------- 导入全局数据（2.4：支持覆盖/合并） ---------- */
function showImportModal(back = null) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">导入全局数据</div>
      <button class="icon-btn" id="import-close">✕</button>
    </div>
    <div style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">
      选择之前导出的「白日梦数据备份.ocdata」文件。<br>
      <span style="color:var(--danger);">⚠️ 覆盖导入会清空当前所有数据，此操作无法撤销。</span>
    </div>
    <div class="field">
      <label>备份文件</label>
      <input class="input" type="file" id="import-file" accept=".ocdata,.json,.letterdata,.chatdata,application/octet-stream,application/json,text/plain">
    </div>
    <div class="field">
      <label>导入方式</label>
      <div style="display:flex;gap:10px;">
        <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;">
          <input type="radio" name="import-mode" value="overwrite" checked style="accent-color:var(--purple);">
          <span style="font-size:14px;">覆盖导入<span style="display:block;font-size:11px;color:var(--text-tertiary);">清空当前，完全替换</span></span>
        </label>
        <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;">
          <input type="radio" name="import-mode" value="merge" style="accent-color:var(--purple);">
          <span style="font-size:14px;">合并导入<span style="display:block;font-size:11px;color:var(--text-tertiary);">保留现有，合并追加</span></span>
        </label>
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="import-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="import-go">导入</button>
    </div>
  `);
  $('#import-close').onclick = () => back ? back() : closeModal();
  $('#import-cancel').onclick = () => back ? back() : closeModal();
  $('#import-go').onclick = async () => {
    const file = $('#import-file').files[0];
    if (!file) { showToast('请先选择备份文件'); return; }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      showToast('文件解析失败，请确认是有效的《白日梦》备份');
      return;
    }
    const mode = (document.querySelector('input[name="import-mode"]:checked') || {}).value || 'overwrite';
    if (data.app !== 'bairimeng') {
      showConfirm('该文件似乎不是《白日梦》的备份，仍要导入吗？', () => doImport(data, mode));
      return;
    }
    doImport(data, mode);
  };
}

/* 导入：{ __img:1, data, thumb } base64 载荷 → { blob, thumb } Blob 描述符；
   旧备份里的纯 base64 字符串按原样保留（显示层 imgSrc 兼容，不做迁移） */
async function imgDescFromExport(v) {
  try {
    const blob = v.data ? await dataURLToBlob(v.data) : null;
    if (!blob) return '';
    const thumb = v.thumb ? await dataURLToBlob(v.thumb) : null;
    return { blob, thumb, w: v.w || 0, h: v.h || 0 };
  } catch (e) { return ''; }
}
async function deepImagesFromExport(node) {
  if (!node || typeof node !== 'object') return node;
  // 20260929x：与导出对称——先收集 {__img} 载荷，8 路并发还原 + 进度（大数据量导入不再像卡死）
  const found = []; // { parent, key, n }
  (function collect(n, parent, key) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (let i = 0; i < n.length; i++) collect(n[i], n, i); return; }
    if (n.__img && typeof n.data === 'string') { found.push({ parent, key, n }); return; }
    for (const k of Object.keys(n)) collect(n[k], n, k);
  })(node, null, null);
  if (!found.length) return node;
  const total = found.length;
  let idx = 0, done = 0;
  const worker = async () => {
    while (idx < total) {
      const i = idx++;
      const it = found[i];
      const conv = await imgDescFromExport(it.n);
      if (it.parent) it.parent[it.key] = conv;
      done++;
      if (total > 8 && (done % 8 === 0 || done === total)) exportProgress(true, `⬇️ 正在还原图片 ${done}/${total}…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, total) }, worker));
  exportProgress(false);
  return node;
}

async function doImport(data, mode = 'overwrite') {
  try {
    // 20260929g：新格式图片载荷转回 Blob；旧备份 base64 字符串原样保留（玩家选择：不迁移）
    data = await deepImagesFromExport(data);
    if (mode === 'overwrite') {
      // 清空现有数据
      await idbClear('characters');
      await idbClear('messages');
      await idbClear('emojis');
      await idbClear('palace'); // 记忆宫殿（20260929w）
      await idbClear('surveys'); // 问卷（20260929al）
      await idbClear('gifts'); // 超频礼物柜（20260929ao）
      await idbClear('kv');
    }
    // 写入导入的数据（覆盖模式直接写；合并模式按 id 合并覆盖）
    const chars = Array.isArray(data.characters) ? data.characters : [];
    for (const c of chars) await idbPut('characters', c);
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    for (const m of msgs) await idbPut('messages', m);
    const emos = Array.isArray(data.emojis) ? data.emojis : [];
    for (const e of emos) await idbPut('emojis', e);
    const pals = Array.isArray(data.palace) ? data.palace : []; // 记忆宫殿条目
    for (const e of pals) await idbPut('palace', e);
    const srvs = Array.isArray(data.surveys) ? data.surveys : []; // 问卷（20260929al）
    for (const e of srvs) await idbPut('surveys', e);
    const gifts = Array.isArray(data.gifts) ? data.gifts : []; // 超频礼物柜（20260929ao）
    for (const e of gifts) await idbPut('gifts', e);
    if (data.cards) {
      if (mode === 'merge') {
        // 合并字卡：用导入的去重合并
        const cur = await getSetting('cards', null);
        if (cur) {
          const merged = JSON.parse(JSON.stringify(cur));
          const inc = data.cards;
          const exist = new Set(merged.customReplies || []);
          (inc.customReplies || []).forEach(t => { if (!exist.has(t)) { merged.customReplies.push(t); exist.add(t); } });
          (inc.customReplyGroups || []).forEach(ng => {
            const same = (merged.customReplyGroups || []).find(x => x.name === ng.name);
            if (same) { const se = new Set(same.items || []); (ng.items || []).forEach(t => { if (!se.has(t)) { same.items.push(t); se.add(t); } }); }
            else merged.customReplyGroups.push(JSON.parse(JSON.stringify(ng)));
          });
          sanitizeCards(merged); // 同步净化（横线装饰行/空分组不入库）
          await setSetting('cards', merged);
        } else {
          const freshCards = JSON.parse(JSON.stringify(data.cards));
          sanitizeCards(freshCards);
          await setSetting('cards', freshCards);
        }
      } else {
        const freshCards = JSON.parse(JSON.stringify(data.cards));
        sanitizeCards(freshCards);
        await setSetting('cards', freshCards);
      }
    }
    if (data.playerProfile) await setSetting('playerProfile', data.playerProfile);
    if (data.chatSettings) await setSetting('chatSettings', data.chatSettings);
    if (data.chatTheme) await setSetting('chatTheme', data.chatTheme);
    if (data.settings) {
      for (const [k, v] of Object.entries(data.settings)) {
        if (v !== null && v !== undefined) await setSetting(k, v);
      }
    }
    closeModal();
    miniToast('导入成功，正在重新载入…');
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    miniToast('导入失败：' + (e && e.message ? e.message : '未知错误'));
  }
}

/* ---------- 导出全局数据（2.4：.ocdata 单文件备份格式，包含所有内容 + 图片资源内嵌）
   20260929g：库内图片是 Blob 描述符，JSON 无法序列化 Blob ——
   导出前深度遍历，把 { blob, thumb } 转回 { __img:1, data, thumb } base64 内嵌，
   其余内容原样；旧版备份（纯 base64 字符串）导出逻辑不受影响 ---------- */
async function imgDescToExport(v) {
  // 已是 base64 载荷（重复导出防御）：原样返回，禁止二次转换（会把 data 抹成空串）
  if (v.__img && typeof v.data === 'string' && !(v.blob instanceof Blob)) return v;
  return {
    __img: 1,
    w: v.w || 0,
    h: v.h || 0,
    data: v.blob instanceof Blob ? await blobToDataURL(v.blob) : '',
    thumb: v.thumb instanceof Blob ? await blobToDataURL(v.thumb) : '',
  };
}

/* 导出进度提示（Blob→base64 打包可能持续数秒，必须有可见反馈，否则像"点了没反应"） */
let _exportProgEl = null;
function exportProgress(show, text) {
  if (!_exportProgEl || !_exportProgEl.isConnected) {
    _exportProgEl = document.createElement('div');
    _exportProgEl.id = 'export-progress';
    _exportProgEl.style.cssText = 'position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:9999;background:rgba(24,20,32,.92);color:#fff;padding:9px 16px;border-radius:14px;font-size:12.5px;box-shadow:0 8px 28px rgba(0,0,0,.28);display:none;pointer-events:none;max-width:80vw;';
    document.body.appendChild(_exportProgEl);
  }
  if (!show) { _exportProgEl.style.display = 'none'; return; }
  _exportProgEl.textContent = text;
  _exportProgEl.style.display = 'block';
}

/* 20260929x 重写：先收集全部 Blob 描述符，再 8 路并发转 base64 + 实时进度。
   旧版串行逐张 await，图库一大导出要等几分钟且零反馈（用户报"导出点了没反应"的根因） */
async function deepImagesToExport(node, label = '正在打包图片') {
  if (!node || typeof node !== 'object') return node;
  if (node instanceof Blob) return node; // 防御：不应单独出现
  const found = []; // { parent, key, n }
  (function collect(n, parent, key) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (let i = 0; i < n.length; i++) collect(n[i], n, i); return; }
    if (n.blob instanceof Blob || (n.__img && n.data !== undefined)) { found.push({ parent, key, n }); return; }
    for (const k of Object.keys(n)) collect(n[k], n, k);
  })(node, null, null);
  if (!found.length) return node;
  const total = found.length;
  const t0 = Date.now();
  let idx = 0, done = 0, topConv = null;
  const worker = async () => {
    while (idx < total) {
      const i = idx++;
      const it = found[i];
      const conv = await imgDescToExport(it.n);
      if (it.parent) it.parent[it.key] = conv; else topConv = conv;
      done++;
      if (total > 8 && (done % 8 === 0 || done === total)) exportProgress(true, `⬇️ ${label} ${done}/${total}…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, total) }, worker));
  exportProgress(false);
  if (total > 8) miniToast(`图片打包完成（${total} 张，${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
  return topConv !== null ? topConv : node;
}

async function exportAll() {
  let save = null;
  try {
    save = await beginExport('白日梦数据备份.ocdata'); // 先取保存句柄（点击激活期内），再慢慢打包图片
    if (save.cancelled) return;
    miniToast('正在打包全量数据，图库大时需要几秒…');
    const data = {
      app: 'bairimeng',
      format: 'ocdata',
      version: '2.2',
      exportDate: new Date().toISOString(),
      characters: await idbGetAll('characters'),
      messages: await idbGetAll('messages'),
      emojis: await idbGetAll('emojis'),
      palace: await idbGetAll('palace'), // 记忆宫殿（细则十-2：全量备份必须包含）
      surveys: await idbGetAll('surveys'), // 问卷（20260929al：全量备份包含）
      gifts: await idbGetAll('gifts'), // 超频礼物柜（20260929ao：全量备份包含）
      cards: cards,
      playerProfile: await getSetting('playerProfile', null),
      chatSettings: await getSetting('chatSettings', null),
      chatTheme: await getSetting('chatTheme', null),
      settings: {
        dailyCharId: await getSetting('dailyCharId', null),
        dailyShown: await getSetting('dailyShown', null),
        dailyCardData: await getSetting('dailyCardData', null),
        anniversaries: await getSetting('anniversaries', []),
        heartCharId: await getSetting('heartCharId', null),
        dailyAnnivCharId: await getSetting('dailyAnnivCharId', null),
        charGroups: await getSetting('charGroups', []),
        chatGroups: await getSetting('chatGroups', []),
        momentsPosts: await getSetting('momentsPosts', []),
        momentsCover: await getSetting('momentsCover', ''),
        momentsUnread: await getSetting('momentsUnread', 0),
        palaceFolders: await getSetting('palaceFolders', []),
        palaceSettings: await getSetting('palaceSettings', null),
      },
    };
    // .ocdata：单文件备份（JSON 结构 + 图片 base64 内嵌，无需手动解压，可直接导入导出）
    const safeData = await deepImagesToExport(data, '正在打包全量备份'); // Blob → base64 内嵌（JSON 可序列化）
    const blob = new Blob([JSON.stringify(safeData)], { type: 'application/octet-stream' });
    await finishExport(save, blob, '全量备份已导出');
  } catch (e) {
    exportProgress(false);
    miniToast('导出失败：' + (e && e.message ? e.message : '未知错误'));
  }
}

/* ---------- 工具：HTML 转义 ---------- */
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* 字卡徽标显示截断：超长内容（尤其导入库里的横线装饰串）只显示前 n 字符 + 省略号，
   防止把徽标/弹窗撑乱；全文放 title 悬停可见，数据本身不动 */
function cardBrief(t, n = 40) {
  const s = typeof t === 'string' ? t : '';
  return [...s].length > n ? [...s].slice(0, n).join('') + '…' : s;
}

/* ============================================================
   朋友圈（第九章：类微信朋友圈）
   · 玩家、访客都能发帖；都能点赞、评论（9.1）
   · 玩家帖可设可见范围：公开 / 仅自己 / 部分可见 / 不给谁看（9.1）
   · 访客帖不屏蔽玩家；访客没接 API 用字卡随机内容（9.2）
   · 访客随机发帖：每天上限默认 2 条（玩家可在访客主页改，最多 5 条）（9.4）
   · 互动：同关系网访客 24h 内随机时间点赞+评论一条；
     发贴访客对其他访客只回一条；玩家与发贴访客可反复盖楼（9.4）
   数据：kv.momentsPosts / kv.momentsCover / kv.momentsUnread
   post: { id, authorType:'player'|'char', authorId, content, images[],
           visibility:{type,ids}, likes:[{who,time}],
           comments:[{id,who,replyTo,content,time}],
           createTime, pending:[{charId,at,done}],
           peerReplyAt, peerReplied, authorReplies:[{commentId,at,done}] }
   ============================================================ */
let _momentsPosts = null; // 内存缓存（异步写库）

async function loadMomentPosts() {
  if (_momentsPosts) return _momentsPosts;
  _momentsPosts = await getSetting('momentsPosts', []);
  return _momentsPosts;
}
async function saveMomentPosts() {
  if (!_momentsPosts) return;
  await setSetting('momentsPosts', _momentsPosts);
}

/* 帖子作者信息 */
function momentAuthor(post) {
  if (post.authorType === 'player') return { name: playerProfile.name || '白日梦主人', avatar: playerProfile.avatar || '' };
  const c = characters.find(x => x.id === post.authorId);
  return { name: c ? c.name : '已删除的访客', avatar: c ? c.avatar : '', char: c };
}

/* 访客与访客之间是否认识（9.3：一方设了关系即双方相识） */
function charKnowsChar(a, b) {
  const ra = (a.peerRelations || {})[b.id];
  const rb = (b.peerRelations || {})[a.id];
  return (ra && ra !== '无') || (rb && rb !== '无');
}

/* 角色能否看到某条玩家帖（9.1 可见范围） */
function momentVisibleToChar(post, c) {
  const v = post.visibility || { type: 'all' };
  if (v.type === 'all') return true;
  if (v.type === 'self') return false;
  const ids = v.ids || [];
  if (v.type === 'part') return ids.includes(c.id);
  if (v.type === 'except') return !ids.includes(c.id);
  return true;
}

/* 可见范围标签 */
function visLabel(post) {
  if (post.authorType !== 'player') return '';
  const v = post.visibility || { type: 'all' };
  if (v.type === 'self') return '🔒 仅自己可见';
  if (v.type === 'part') return `👥 部分可见(${(v.ids || []).length})`;
  if (v.type === 'except') return `🚫 不给谁看(${(v.ids || []).length})`;
  return '';
}

/* 有资格与该帖互动的角色。
   玩家帖：除玩家屏蔽的角色（关系网「屏蔽」/ 单独「看不到我的朋友圈」）与当条可见范围
   排除者（仅自己/部分可见/不给谁看）之外，全部角色都会点赞评论（9.4）；
   访客帖：同关系网的角色（一方设了关系即双方相识，9.3） */
function relatedCharsForPost(post) {
  if (post.authorType === 'player') {
    return characters.filter(c => !c.momentsBlocked && !c.cantSeeMyMoments && momentVisibleToChar(post, c));
  }
  const author = momentAuthor(post).char;
  if (!author) return [];
  return characters.filter(c => c.id !== author.id && charKnowsChar(c, author));
}

/* 发帖后安排角色互动：点赞+评论（9.4）。
   20260929aj：玩家帖收拢到 2 分钟~2 小时内（旧窗口 5 分钟~24 小时太长，用户多次反馈
   "角色迟迟不回我的帖"）；访客帖保持 5 分钟~24 小时不变。 */
function schedulePostInteractions(post) {
  const pool = relatedCharsForPost(post);
  const now = Date.now();
  post.pending = [];
  if (post.authorType === 'player') {
    // 20260929al：玩家帖排队 = 5 分钟~5 小时，加权偏向更早的时间（rand^1.7 压向头部）；
    // 多角色先各自抽取、再按时间升序分配并保证相邻至少 90 秒——不撞车、互不错峰重叠；
    // 角色多到 5 小时排不下时，最晚的自然落到 5 小时之后（= 自动顺延下一轮的 5 分钟~5 小时）
    const MIN = 5 * 60e3, SPAN = 5 * 3600e3;
    const picks = pool.map(c => ({ charId: c.id, at: now + MIN + Math.floor(SPAN * Math.pow(Math.random(), 1.7)) }));
    picks.sort((a, b) => a.at - b.at);
    let prev = 0;
    for (const p of picks) {
      if (prev && p.at - prev < 90e3) p.at = prev + 90e3;
      prev = p.at;
      post.pending.push({ charId: p.charId, at: p.at, done: false });
    }
  } else {
    pool.forEach(c => {
      post.pending.push({ charId: c.id, at: now + randInt(5 * 60e3, 24 * 3600e3), done: false });
    });
  }
  if (post.authorType === 'char') {
    post.peerReplied = false; // 发贴角色还没回过其他访客
  }
}

/* 互动执行：点赞 + 评论（各一条）；访客帖的其他访客评论完后安排发贴角色回一条 */
async function runPendingInteractions() {
  const posts = await loadMomentPosts();
  const now = Date.now();
  let changed = false;
  let newlyArrived = [];
  for (const post of posts) {
    // 20260929ai 加固①：旧数据/导入数据可能缺 likes/comments/pending/charContinue 等数组——
    // 缺字段会让本函数中途抛错（如 post.likes.some），被心跳的 try/catch 静默吞掉后，
    // 排在这条帖子之后的所有帖子永远得不到互动（表现为"朋友圈再也没有人评论回复"）。
    post.likes = Array.isArray(post.likes) ? post.likes : [];
    post.comments = Array.isArray(post.comments) ? post.comments : [];
    post.pending = Array.isArray(post.pending) ? post.pending : [];
    post.authorReplies = Array.isArray(post.authorReplies) ? post.authorReplies : [];
    post.charContinue = Array.isArray(post.charContinue) ? post.charContinue : [];
    // 20260929al：玩家帖旧数据收拢——发帖时排的 pending 可能落在更晚处，
    // 统一钳到"发帖后 5 小时内"（与排队窗口一致）；已过期的（如昨晚的帖子）在 30 秒~8 分钟内补上
    if (post.authorType === 'player') {
      const cap = (post.createTime || now) + 5 * 3600e3;
      for (const p of post.pending) {
        if (!p.done && p.at > cap) p.at = Math.min(cap, now + randInt(30e3, 8 * 60e3));
      }
    }
    // 20260929ai 加固②：单帖隔离——一条帖子出错只跳过它自己，绝不影响其他帖子的互动
    try {
    // 需求 9.3/9.4 补算：朋友圈基于单向关系——只要有一方把另一方设为某种关系，
    // 双方即相识、必定互动。关系可能在帖子发出之后才设置（发帖时的 pending 名单已冻结），
    // 因此每次心跳按"当前"关系网重新核对：有资格、却从没被排过也没互动过的角色补排一条。
    // 补排的等待用 1~30 分钟（仍在"24 小时内随机时间段"语义内，且设置关系后很快能看到效果）
    const pool = relatedCharsForPost(post);
    post.pending = post.pending || [];
    for (const c of pool) {
      const known = post.pending.some(p => p.charId === c.id) ||
        (post.comments || []).some(x => x.who === c.id);
      if (!known) {
        post.pending.push({ charId: c.id, at: now + randInt(60e3, 30 * 60e3), done: false });
        changed = true;
      }
    }
    if (post.pending && post.pending.some(p => !p.done && p.at <= now)) {
      for (const p of post.pending) {
        if (p.done || p.at > now) continue;
        const c = characters.find(x => x.id === p.charId);
        p.done = true;
        if (!c) continue;
        // 点赞（未点过才点）
        if (!post.likes.some(l => l.who === c.id)) {
          post.likes.push({ who: c.id, time: now });
        }
        // 评论一条（按对作者的关系语气抽字卡；AI 模式由 AI 生成）；25% 概率随机配一个表情包
        const author = momentAuthor(post);
        const rel = author.char ? ((c.peerRelations || {})[author.char.id] || c.relation) : c.relation;
        const text = await momentReplyText(c, rel, post);
        post.comments = post.comments || [];
        const newCm = { id: uid('mc'), who: c.id, replyTo: null, content: text, time: now };
        if (Math.random() < 0.25) {
          const st = await drawMomentSticker();
          if (st) { if (st.img) newCm.img = st.img; else newCm.sticker = st.sticker; }
        }
        post.comments.push(newCm);
        changed = true;
        newlyArrived.push({ post, char: c });
      }
      // 访客帖：有"未被回过的其他访客评论"时，发贴角色 3 分钟~12 小时内回复
      // （对每个评论角色各回一条；新角色晚到评论也会再排一轮，9.4）
      if (post.authorType === 'char') {
        const hasUnreplied = (post.comments || []).some(x =>
          x.who !== 'player' && x.who !== post.authorId &&
          !(post.comments || []).some(rc => rc.who === post.authorId && rc.replyTo === x.id));
        if (hasUnreplied && !post.peerReplyAt) {
          post.peerReplyAt = now + randInt(3 * 60e3, 12 * 3600e3);
          changed = true;
        }
      }
    }
    // 发贴角色对"其他访客"的回复（9.4：多个角色都回复时，发贴角色回复每个人；
    // 但对每个访客只回一条，其他访客不能再盖楼回复）
    if (post.authorType === 'char' && post.peerReplyAt && post.peerReplyAt <= now) {
      const author = momentAuthor(post).char;
      if (author) {
        const charComments = (post.comments || []).filter(x => x.who !== 'player' && x.who !== post.authorId);
        const repliedTo = new Set((post.comments || []).filter(x => x.who === post.authorId && x.replyTo).map(x => x.replyTo));
        let repliedAny = false;
        for (const cc of charComments) {
          if (repliedTo.has(cc.id)) continue; // 该访客评论已回过（每人只回一条）
          const text = await momentReplyText(author, author.relation, post, { replyTo: cc });
          const rep = { id: uid('mc'), who: author.id, replyTo: cc.id, content: text, time: Date.now() };
          if (Math.random() < 0.2) {
            const st = await drawMomentSticker();
            if (st) { if (st.img) rep.img = st.img; else rep.sticker = st.sticker; }
          }
          post.comments.push(rep);
          repliedAny = true;
          changed = true;
        }
        if (repliedAny && document.body.dataset.view !== 'moments') {
          const n = (await getSetting('momentsUnread', 0)) + 1;
          await setSetting('momentsUnread', n);
          updateMomentsBadge();
        }
      }
      post.peerReplyAt = null; // 回完本轮；有新的角色评论会再排
    }
    // 发贴角色对"玩家每条评论"的回复（玩家与发贴角色可反复盖楼，9.4）
    if (post.authorType === 'char' && post.authorReplies && post.authorReplies.some(r => !r.done && r.at <= now)) {
      const author = momentAuthor(post).char;
      for (const r of post.authorReplies) {
        if (r.done || r.at > now) continue;
        r.done = true;
        if (!author) continue;
        const pcm = (post.comments || []).find(x => x.id === r.commentId); // 20260929bf：带上被回复的玩家评论
        const text = await momentReplyText(author, author.relation, post, { replyTo: pcm }); // 20260929ah：AI 模式由 AI 生成回复
        const rep = { id: uid('mc'), who: author.id, replyTo: r.commentId, content: text, time: Date.now() };
        if (Math.random() < 0.2) {
          const st = await drawMomentSticker();
          if (st) { if (st.img) rep.img = st.img; else rep.sticker = st.sticker; }
        }
        post.comments.push(rep);
        changed = true;
        if (document.body.dataset.view === 'moments') {
          miniToast(author.name + ' 回复了你的评论');
        } else {
          // 不在朋友圈页：涨红点提醒
          const n = (await getSetting('momentsUnread', 0)) + 1;
          await setSetting('momentsUnread', n);
          updateMomentsBadge();
          miniToast('💬 ' + author.name + ' 回复了你的评论');
        }
      }
    }
    // 玩家帖：玩家回复了角色的评论 → 该访客继续回复玩家（可无限盖楼，9.4）
    // 20260929bf：去掉 authorType 限制——访客帖上玩家回复另一位访客时也走这里（被回复的访客接话）
    if (post.charContinue && post.charContinue.some(r => !r.done && r.at <= now)) {
      for (const r of post.charContinue) {
        if (r.done || r.at > now) continue;
        r.done = true;
        const cc = characters.find(x => x.id === r.charId);
        if (!cc) continue;
        const pcm = (post.comments || []).find(x => x.id === r.commentId); // 20260929bf：带上被回复的玩家评论
        const text = await momentReplyText(cc, cc.relation, post, { replyTo: pcm }); // 20260929ah：AI 模式由 AI 生成回复
        const rep = { id: uid('mc'), who: cc.id, replyTo: r.commentId, content: text, time: Date.now() };
        if (Math.random() < 0.2) {
          const st = await drawMomentSticker();
          if (st) { if (st.img) rep.img = st.img; else rep.sticker = st.sticker; }
        }
        post.comments.push(rep);
        changed = true;
        if (document.body.dataset.view === 'moments') {
          miniToast('💬 ' + cc.name + ' 回复了你');
        } else {
          const n = (await getSetting('momentsUnread', 0)) + 1;
          await setSetting('momentsUnread', n);
          updateMomentsBadge();
        }
      }
    }
    } catch (ePost) { console.warn('[朋友圈] 单条帖子互动出错，已跳过该帖（不影响其他帖子）：', ePost && (ePost.message || ePost)); }
  }
  if (changed) {
    await saveMomentPosts();
    if (document.body.dataset.view === 'moments') {
      renderMoments();
    } else if (newlyArrived.some(x => x.post.authorType === 'player')) {
      // 9.4：别人互动了玩家的帖子 → 涨红点 + 提醒
      const n = (await getSetting('momentsUnread', 0)) + newlyArrived.filter(x => x.post.authorType === 'player').length;
      await setSetting('momentsUnread', n);
      updateMomentsBadge();
      const who = newlyArrived.find(x => x.post.authorType === 'player').char;
      miniToast('💬 ' + (who ? who.name : '梦角') + ' 互动了你的朋友圈');
    }
  }
  return newlyArrived;
}

/* 访客随机发帖：每天 0~上限 条（默认 2，玩家可改最多 5），时间点随机分布 */
function charMomentLimit(c) { return Math.min(5, Math.max(0, parseInt(c.momentsDailyLimit ?? 2) || 0)); }

async function checkCharMomentPosts() {
  const posts = await loadMomentPosts();
  const tk = todayKey();
  const start = startOfToday();
  let changed = false;
  let planDirty = false;
  const arrived = [];
  for (const c of characters) {
    const limit = charMomentLimit(c);
    if (limit <= 0) continue;
    // 每天首次检查时生成当日随机发帖时间点
    if (!c.momentsPlan || c.momentsPlan.day !== tk) {
      const times = [];
      const n = Math.floor(Math.random() * (limit + 1)); // 0~limit 条
      for (let i = 0; i < n; i++) {
        times.push(start + randInt(9 * 3600e3, 23 * 3600e3));
      }
      c.momentsPlan = { day: tk, times, posted: [] };
      await idbPut('characters', c); // 直接写库（不用 saveChar，避免循环中途 refreshCharacters 换掉数组引用）
      planDirty = true;
    }
    const plan = c.momentsPlan;
    for (const t of (plan.times || [])) {
      if (t > Date.now()) continue;
      if ((plan.posted || []).includes(t)) continue;
      // 实时统计当天已发条数（以帖子数据为准），防止重复触发
      const postedCount = posts.filter(p => p.authorType === 'char' && p.authorId === c.id && p.createTime >= start).length;
      if (postedCount >= limit) break;
      plan.posted = plan.posted || [];
      plan.posted.push(t);
      await idbPut('characters', c);
      const post = await charMomentPost(c);
      posts.unshift(post);
      arrived.push({ post, char: c });
      changed = true;
    }
  }
  if (changed) await saveMomentPosts();
  if (planDirty || changed) await refreshCharacters();
  return arrived;
}

/* 抽一张表情包：图片型表情包库（emojis store，data:/http）优先；库里没有图则
   从字卡库 emoji 表情模块抽，再兜底 Emoji 库（20260929ah）抽一个 emoji 字符当贴纸。
   返回 { img } 或 { sticker } 或 null */
async function drawMomentSticker() {
  try {
    const pics = await getEmojis();
    if (pics && pics.length && Math.random() < 0.6) {
      const p = drawFrom(pics);
      if (p && (p.img || p.data)) return { img: p.img || p.data };
    }
  } catch (e) {}
  const emo = drawFrom(cards.customEmojis || []) || drawFrom(EMOJI_LIB);
  if (emo) return { sticker: emo };
  return null;
}

/* 角色发一条朋友圈（字卡随机内容，9.2；AI 模式下由 AI 生成）
   20261001ci：发贴角色给自己点赞——字卡模式随机（约 40%）；AI 模式由 AI 用 [[SELF_LIKE]] 判定 */
async function charMomentPost(c) {
  const now = Date.now();
  let content = '';
  let aiSelfLike = false; // AI 判定要自赞
  // 20260929ae：AI 模式下由 AI 生成朋友圈内容（失败回退字卡）
  let aiContent = null;
  if (await isAIMode()) {
    try {
      const cfg = await loadAIConfig();
      const ctx = await buildCharAIContext(c.id, []);
      const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
        { role: 'system', content: `你是角色扮演 AI，正在发一条朋友圈动态。请以角色身份写一句自然的生活分享（1~2 句，可带 emoji），不要跳出角色。\n隐藏指令：若你自己想给这条动态点赞，在正文输出后的最末尾另起一行输出 [[SELF_LIKE]]；一般情况不要输出。\n\n${ctx}` },
        { role: 'user', content: '请发一条朋友圈动态。' },
      ], { temperature: 0.9 });
      if (r.ok && r.text) {
        const p = parseAITags(r.text);
        aiContent = p.clean;
        aiSelfLike = !!p.selfLike;
      }
    } catch (e) {}
  }
  const usedAI = !!aiContent;
  if (aiContent) {
    content = aiContent;
  } else {
    const r = Math.random();
    if (r < 0.5) content = drawReply(cards, getCharBanWords(c), c.relation, c.bannedGroups || []);
    else if (r < 0.75) content = drawFrom(cards.customMottos) || drawReply(cards, [], null, []);
    else {
      const emo = drawFrom(cards.customEmojis) || '✨';
      content = emo + ' ' + drawFrom(cards.customStatuses);
    }
  }
  const post = {
    id: uid('mo'), authorType: 'char', authorId: c.id,
    content, images: [], visibility: { type: 'all', ids: [] },
    likes: [], comments: [], createTime: now,
    pending: [], authorReplies: [],
  };
  // 一半概率配表情包（图片库优先，emoji 贴纸兜底）
  if (Math.random() < 0.5) {
    const st = await drawMomentSticker();
    if (st) { if (st.img) post.images.push(st.img); else post.sticker = st.sticker; }
  }
  // 20261001ci：发贴角色给自己点赞（AI 判定 或 字卡模式 40% 随机；点赞时间往后错开一点显得自然）
  if (aiSelfLike || (!usedAI && Math.random() < 0.4)) {
    post.likes.push({ who: c.id, time: now + randInt(10e3, 240e3) });
  }
  schedulePostInteractions(post);
  // 提醒（9.4：可在访客主页关闭；关闭或被玩家屏蔽则不弹提醒、不涨红点）
  if (c.remindMoments !== false && !c.momentsBlocked) {
    const n = (await getSetting('momentsUnread', 0)) + 1;
    await setSetting('momentsUnread', n);
    updateMomentsBadge();
    miniToast('💬 ' + c.name + ' 发布了新动态');
    notifyIncoming(c, content.slice(0, 40), c.name + ' 发布了新动态'); // 20260929bi：统一出口（含挂后台）
  }
  return post;
}

/* 底栏红点 */
async function updateMomentsBadge() {
  const n = await getSetting('momentsUnread', 0);
  const b = $('#moments-badge');
  if (!b) return;
  if (n > 0) { b.textContent = n > 99 ? '99+' : n; b.style.display = ''; }
  else b.style.display = 'none';
}

/* 进入朋友圈页：渲染 + 清红点 */
async function enterMoments() {
  await renderMoments();
  await setSetting('momentsUnread', 0);
  updateMomentsBadge();
}

/* 时间显示：刚刚 / n分钟前 / n小时前 / 昨天 / n月n日；超过 5 天 → 完整年月日（2026年09月06日 19:34） */
function timeAgoStr(ts) {
  const diff = Date.now() - ts;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + '分钟前';
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + '小时前';
  const d = new Date(ts);
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  if (d.getFullYear() === yd.getFullYear() && d.getMonth() === yd.getMonth() && d.getDate() === yd.getDate()) return '昨天 ' + hm;
  if (diff > 5 * 86400e3) {
    return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${hm}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ` + hm;
}

/* 渲染朋友圈 */
async function renderMoments() {
  const posts = await loadMomentPosts();
  const meName = $('#moments-me-name');
  const meAv = $('#moments-me-avatar');
  if (meName) meName.textContent = playerProfile.name || '白日梦主人';
  // 20260929s：昵称下方个性签名行，与个人主页设置的签名一致
  const meSign = $('#moments-me-sign');
  if (meSign) meSign.textContent = playerProfile.sign || '做个好梦';
  if (meAv) meAv.innerHTML = playerProfile.avatar ? `<img src="${imgSrc(playerProfile.avatar)}">` : escapeHtml((playerProfile.name || '梦')[0]);

  // 封面
  const cover = $('#moments-cover');
  if (cover) {
    const cv = await getSetting('momentsCover', '');
    cover.classList.toggle('has-cover', !!cv);
    cover.style.backgroundImage = cv ? `url("${imgSrc(cv)}")` : '';
  }

  const list = $('#moments-list');
  if (!list) return;
  list.innerHTML = '';
  if (posts.length === 0) {
    list.innerHTML = `<div class="moments-empty">还没有动态<br><span style="font-size:12px;">点右上角相机发第一条朋友圈，或等梦角们自己发～</span></div>`;
    return;
  }
  const sorted = [...posts]
    .filter(p => {
      // 9.3：被玩家屏蔽的角色，动态不显示在朋友圈里
      if (p.authorType === 'char') {
        const cc = characters.find(x => x.id === p.authorId);
        if (cc && cc.momentsBlocked) return false;
      }
      return true;
    })
    .sort((a, b) => b.createTime - a.createTime);
  for (const post of sorted) {
    const author = momentAuthor(post);
    const likedByMe = post.likes.some(l => l.who === 'player');
    const likesHtml = post.likes.length
      ? `<div class="mo-likes">${icon('heart', 13)}<span>${post.likes.map(l => escapeHtml(l.who === 'player' ? (playerProfile.name || '我') : (characters.find(x => x.id === l.who)?.name || '梦角'))).join('、')}</span></div>`
      : '';
    const commentsHtml = (post.comments || []).map(cm => {
      const who = cm.who === 'player' ? (playerProfile.name || '我') : (characters.find(x => x.id === cm.who)?.name || '梦角');
      let toHtml = '';
      if (cm.replyTo) {
        const target = (post.comments || []).find(x => x.id === cm.replyTo);
        if (target) {
          const toName = target.who === 'player' ? (playerProfile.name || '我') : (characters.find(x => x.id === target.who)?.name || '梦角');
          toHtml = `<span class="mo-cto"> 回复 @${escapeHtml(toName)}</span>`;
        }
      }
      // 评论表情包（20260929ah 多选）：图片型 → 小图；emoji 贴纸 → 大号 emoji；兼容旧单图/单贴纸
      const cImgs = (cm.imgs && cm.imgs.length ? cm.imgs : (cm.img ? [cm.img] : []));
      const cStks = (cm.stickers && cm.stickers.length ? cm.stickers : (cm.sticker ? [cm.sticker] : []));
      const stickerHtml = cImgs.map(im => `<img class="mo-cimg" src="${imgSrc(im, true)}" data-full="${imgSrc(im)}" data-mo-cimg="${cm.id}">`).join('')
        + cStks.map(s => `<div class="mo-csticker">${emojiImgOf(s, 'mo-csticker-img') || escapeHtml(s)}</div>`).join('');
      return `<div class="mo-comment"><span class="mo-cname" data-mcmt="${cm.id}">${escapeHtml(who)}</span>${toHtml}：${escapeHtml(cm.content)}${stickerHtml}<button class="mo-creply" data-mreply="${cm.id}">回复</button></div>`;
    }).join('');
    const socialHtml = (post.likes.length || (post.comments || []).length)
      ? `<div class="moment-social show">${likesHtml}${commentsHtml ? `<div class="mo-comments">${commentsHtml}</div>` : ''}</div>`
      : '';

    const card = document.createElement('div');
    card.className = 'moment-card';
    const charAuthor = post.authorType === 'char' ? characters.find(x => x.id === post.authorId) : null;
    card.innerHTML = `
      <div class="moment-avatar${charAuthor ? ' clickable' : ''}" ${charAuthor ? `data-mo-author="${charAuthor.id}" title="查看主页"` : ''}>${author.avatar ? `<img src="${imgSrc(author.avatar)}">` : escapeHtml((author.name || '?')[0])}</div>
      <div class="moment-main">
        <div class="moment-name${charAuthor ? ' clickable' : ''}" ${charAuthor ? `data-mo-author="${charAuthor.id}"` : ''}>${escapeHtml(author.name)}${visLabel(post) ? `<span class="moment-visibility">${visLabel(post)}</span>` : ''}</div>
        ${post.content ? `<div class="moment-text">${escapeHtml(post.content)}</div>` : ''}
        ${(() => { const sts = (post.stickers && post.stickers.length ? post.stickers : (post.sticker ? [post.sticker] : [])); return sts.map(s => `<div class="mo-sticker">${emojiImgOf(s, 'mo-sticker-img') || escapeHtml(s)}</div>`).join(''); })()}
        ${post.images && post.images.length ? `<div class="moment-imgs${post.images.length === 1 ? ' n1' : ''}">${post.images.map(im => `<img src="${imgSrc(im, true)}" data-full="${imgSrc(im)}">`).join('')}</div>` : ''}
        <div class="moment-time-row">
          <div class="moment-time">${timeAgoStr(post.createTime)}</div>
          ${post.authorType === 'player' ? '<button class="moment-del" data-mod-del="' + post.id + '">删除</button>' : ''}
          <div class="moment-acts">
            <button class="moment-act${likedByMe ? ' on' : ''}" data-mo-like="${post.id}" title="点赞">${icon('heart', 15)}</button>
            <button class="moment-act" data-mo-cmt="${post.id}" title="评论">${icon('comment', 15)}</button>
            <button class="moment-act" data-mo-share="${post.id}" title="分享">${icon('share', 15)}</button>
          </div>
        </div>
        ${socialHtml}
      </div>
    `;
    list.appendChild(card);
  }

  // 事件绑定
  list.querySelectorAll('[data-mo-like]').forEach(btn => {
    btn.onclick = () => toggleMomentLike(btn.dataset.moLike);
  });
  list.querySelectorAll('[data-mo-cmt]').forEach(btn => {
    btn.onclick = () => showMomentCommentModal(btn.dataset.moCmt, null);
  });
  list.querySelectorAll('[data-mo-share]').forEach(btn => {
    btn.onclick = () => showMomentShareModal(btn.dataset.moShare);
  });
  list.querySelectorAll('[data-mod-del]').forEach(btn => {
    btn.onclick = () => {
      showConfirm('真的要删除这条动态吗？此操作无法撤销。', async () => {
        const posts2 = await loadMomentPosts();
        const idx = posts2.findIndex(p => p.id === btn.dataset.modDel);
        if (idx >= 0) { posts2.splice(idx, 1); await saveMomentPosts(); }
        renderMoments();
        miniToast('已删除');
      });
    };
  });
  list.querySelectorAll('.moment-imgs img').forEach(img => {
    img.onclick = () => {
      openModal(`<div style="text-align:center;"><img src="${img.dataset.full || img.src}" style="max-width:100%;max-height:70vh;border-radius:14px;"><button class="btn primary block" style="margin-top:14px;" id="imgview-close">关闭</button></div>`);
      $('#imgview-close').onclick = closeModal;
    };
  });
  // 点评论里的名字 → 回复该评论
  list.querySelectorAll('[data-mcmt]').forEach(el => {
    el.onclick = () => {
      const postId = el.closest('.moment-card')?.querySelector('[data-mo-cmt]')?.dataset.moCmt;
      if (postId) showMomentCommentModal(postId, el.dataset.mcmt);
    };
  });
  // 评论行尾「回复」按钮 → 回复该评论（玩家可无限评论/回复；角色必回）
  list.querySelectorAll('[data-mreply]').forEach(el => {
    el.onclick = () => {
      const postId = el.closest('.moment-card')?.querySelector('[data-mo-cmt]')?.dataset.moCmt;
      if (postId) showMomentCommentModal(postId, el.dataset.mreply);
    };
  });
  // 评论里的表情包图片点击放大
  list.querySelectorAll('.mo-cimg').forEach(img => {
    img.onclick = () => {
      openModal(`<div style="text-align:center;"><img src="${img.dataset.full || img.src}" style="max-width:100%;max-height:70vh;border-radius:14px;"><button class="btn primary block" style="margin-top:14px;" id="imgview-close">关闭</button></div>`);
      $('#imgview-close').onclick = closeModal;
    };
  });
  // 点访客头像/名字 → 进访客个人主页（9.1 朋友圈交互）
  list.querySelectorAll('[data-mo-author]').forEach(el => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      showCharProfile(el.dataset.moAuthor);
    };
  });
  // 封面点击 → 更换封面（cover 为函数开头已取的元素）
  if (cover) cover.onclick = showMomentsCoverModal;
}

/* 玩家点赞（可取消） */
async function toggleMomentLike(postId) {
  const posts = await loadMomentPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return;
  const idx = post.likes.findIndex(l => l.who === 'player');
  if (idx >= 0) post.likes.splice(idx, 1);
  else post.likes.push({ who: 'player', time: Date.now() });
  await saveMomentPosts();
  renderMoments();
}

/* 评论弹窗（玩家评论；replyTo=回复某条评论） */
async function showMomentCommentModal(postId, replyTo = null) {
  const posts = await loadMomentPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return;
  let replyInfo = '';
  let placeholder = '评论';
  if (replyTo) {
    const target = (post.comments || []).find(x => x.id === replyTo);
    if (target) {
      const toName = target.who === 'player' ? (playerProfile.name || '我') : (characters.find(x => x.id === target.who)?.name || '梦角');
      replyInfo = `<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:10px;">回复 @${escapeHtml(toName)}</div>`;
      placeholder = '回复 ' + toName;
    }
  }
  let cmtImgs = [];      // 评论附带图片（20260929ah 多选，兼容旧 cmtImg 单图）
  let cmtStickers = [];  // 评论附带 emoji 贴纸（20260929ah 多选，兼容旧 cmtSticker）
  const renderAttach = () => {
    const box = $('#mo-cmt-attach');
    if (!box) return;
    if (!cmtImgs.length && !cmtStickers.length) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.style.display = '';
    box.innerHTML = `
      ${cmtImgs.map((im, i) => `<div style="position:relative;display:inline-block;margin:2px 6px 2px 0;"><img src="${imgSrc(im, true)}" style="max-width:120px;max-height:120px;border-radius:10px;border:1px solid var(--border);object-fit:cover;"><button data-cimgrm="${i}" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.65);color:#fff;border:none;font-size:11px;line-height:18px;cursor:pointer;">✕</button></div>`).join('')}
      ${cmtStickers.map((s, i) => `<div style="position:relative;display:inline-block;font-size:42px;line-height:1;margin:2px 6px 2px 0;">${escapeHtml(s)}<button data-cstkrm="${i}" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.65);color:#fff;border:none;font-size:11px;line-height:18px;cursor:pointer;">✕</button></div>`).join('')}`;
    box.querySelectorAll('[data-cimgrm]').forEach(b => { b.onclick = () => { cmtImgs.splice(parseInt(b.dataset.cimgrm, 10), 1); renderAttach(); }; });
    box.querySelectorAll('[data-cstkrm]').forEach(b => { b.onclick = () => { cmtStickers.splice(parseInt(b.dataset.cstkrm, 10), 1); renderAttach(); }; });
  };
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">评论</div>
      <button class="icon-btn" id="mo-cmt-close">✕</button>
    </div>
    ${replyInfo}
    <div class="field">
      <textarea class="textarea" id="mo-cmt-text" placeholder="${escapeHtml(placeholder)}…" style="min-height:80px;"></textarea>
      <div id="mo-cmt-attach" style="margin-top:8px;"></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn" id="mo-cmt-img" style="padding:7px 14px;font-size:12.5px;">🖼 图片</button>
        <button class="btn" id="mo-cmt-emoji" style="padding:7px 14px;font-size:12.5px;">😊 表情包</button>
      </div>
      <div id="mo-cmt-emoji-panel" style="display:none;margin-top:10px;border:1px solid var(--border);border-radius:14px;padding:12px;background:var(--bg-elevated-2);"></div>
      <input type="file" id="mo-cmt-img-file" accept="image/*" style="display:none;">
    </div>
    <button class="btn primary block" id="mo-cmt-send">发送</button>
  `);
  $('#mo-cmt-close').onclick = closeModal;
  $('#mo-cmt-img').onclick = () => $('#mo-cmt-img-file').click();
  $('#mo-cmt-img-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { if (cmtImgs.length < 9) cmtImgs.push(await compressImage(f, 900, 0.68)); else miniToast('最多 9 张图片'); } catch (err) {}
    e.target.value = '';
    renderAttach();
  };
  $('#mo-cmt-emoji').onclick = async () => {
    const box = $('#mo-cmt-emoji-panel');
    if (!box) return;
    if (box.dataset.ready === '1') { // 已挂载过 → 展开/收起切换
      box.style.display = box.style.display === 'none' ? '' : 'none';
      return;
    }
    box.dataset.ready = '1';
    await mountStickerPicker(box, (st) => {
      // 20260929ah：多选——面板不收起，可连续点选；附件区实时更新
      if (st.img) { if (cmtImgs.length < 9) cmtImgs.push(st.img); else { miniToast('最多 9 张图片'); return; } }
      else if (cmtStickers.length < 20) cmtStickers.push(st.sticker);
      renderAttach();
    });
  };
  $('#mo-cmt-send').onclick = async () => {
    const text = $('#mo-cmt-text').value.trim();
    if (!text && !cmtImgs.length && !cmtStickers.length) { miniToast('写点什么或加个表情包吧'); return; }
    const posts2 = await loadMomentPosts();
    const p = posts2.find(x => x.id === postId);
    if (!p) { closeModal(); return; }
    p.comments = p.comments || [];
    const cm = { id: uid('mc'), who: 'player', replyTo: replyTo || null, content: text, time: Date.now() };
    if (cmtImgs.length) { cm.imgs = [...cmtImgs]; cm.img = cmtImgs[0]; } // img=首个，兼容旧渲染
    if (cmtStickers.length) { cm.stickers = [...cmtStickers]; cm.sticker = cmtStickers[0]; }
    p.comments.push(cm);
    // 访客帖：玩家评论 → 谁来回话？（20260929bf 修复「2号不回复」）
    // · 回复的是发贴作者（或直接评论帖子）→ 作者回（原逻辑）
    // · 回复的是另一位访客的评论 → 由那位访客接话（此前永远只有作者回，被回复的访客从不吭声）
    if (p.authorType === 'char') {
      const target = replyTo ? (p.comments || []).find(x => x.id === replyTo) : null;
      const otherChar = (target && target.who !== 'player' && target.who !== p.authorId) ? target.who : null;
      if (otherChar) {
        p.charContinue = p.charContinue || [];
        p.charContinue.push({ charId: otherChar, commentId: cm.id, at: Date.now() + randInt(5e3, 40e3), done: false });
        // 25% 概率：作者 1~10 分钟后也来搭话
        if (Math.random() < 0.25) {
          p.charContinue.push({ charId: p.authorId, commentId: cm.id, at: Date.now() + randInt(60e3, 10 * 60e3), done: false });
        }
      } else {
        p.authorReplies = p.authorReplies || [];
        p.authorReplies.push({ commentId: cm.id, at: Date.now() + randInt(5e3, 40e3), done: false });
      }
    } else if (p.authorType === 'player' && replyTo) {
      // 玩家帖：玩家回复了某条角色评论 → 该访客 5~40 秒后继续回复玩家（可无限盖楼，9.4）
      const target = (p.comments || []).find(x => x.id === replyTo);
      if (target && target.who !== 'player') {
        p.charContinue = p.charContinue || [];
        p.charContinue.push({ charId: target.who, commentId: cm.id, at: Date.now() + randInt(5e3, 40e3), done: false });
        // 25% 概率：另一位已评论过的角色 1~10 分钟后也来凑热闹，回复玩家这条
        if (Math.random() < 0.25) {
          const others = [...new Set((p.comments || []).filter(x => x.who !== 'player' && x.who !== target.who).map(x => x.who))];
          if (others.length) {
            p.charContinue.push({ charId: others[Math.floor(Math.random() * others.length)], commentId: cm.id, at: Date.now() + randInt(60e3, 10 * 60e3), done: false });
          }
        }
      }
    }
    await saveMomentPosts();
    closeModal();
    renderMoments();
  };
  setTimeout(() => { const t = $('#mo-cmt-text'); if (t) t.focus(); }, 120);
}

/* 表情包选择器（评论/发帖用）：内嵌面板挂载到当前弹窗内，点选即回调。
   修复：旧版用 openModal 弹独立窗，会顶掉评论/发帖弹窗——选完表情整个弹窗被关闭、
   表情也无处安放；现在改为在弹窗内展开面板，选择后自动收起。
   20260929ah：①emoji 贴纸改为全量 Emoji 库 + 玩家自定义 emoji（不再截断 48 个）；
   ②点选后面板保持展开（可连续多选），收起由调用方控制 */
/* 表情包选择器（评论/发帖用）：20260929al 改为 tab 交互——
   「图片表情包」在左、「Emoji 库」在右，点击按钮切换下方内容区；
   点选不收起面板（可连续多选），再点弹窗里的触发按钮收起 */
async function mountStickerPicker(box, onPick) {
  const pics = await getEmojis();
  const seen = new Set();
  const emojiChars = [];
  for (const e of (cards.customEmojis || [])) { if (e && !seen.has(e)) { seen.add(e); emojiChars.push(e); } }
  for (const e of EMOJI_LIB) { if (e && !seen.has(e)) { seen.add(e); emojiChars.push(e); } }
  const hasPics = pics && pics.length;
  const hasEmoji = emojiChars.length;
  if (!hasPics && !hasEmoji) {
    box.innerHTML = '<div style="color:var(--text-tertiary);text-align:center;padding:24px;">还没有表情包，先去聊天页的「表情包」上传吧</div>';
    box.style.display = '';
    return;
  }
  const tabBtn = (key, label, show) => show
    ? `<button class="btn stk-tab" data-stab="${key}" style="flex:1;padding:9px 0;font-size:13.5px;justify-content:center;border-radius:12px;">${label}</button>` : '';
  box.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      ${tabBtn('pic', '🖼 图片表情包', hasPics)}
      ${tabBtn('emoji', '😃 Emoji 库', hasEmoji)}
    </div>
    <div id="stk-body"></div>
  `;
  let tab = hasPics ? 'pic' : 'emoji';
  const paintTabs = () => {
    box.querySelectorAll('.stk-tab').forEach(b => {
      const on = b.dataset.stab === tab;
      b.style.background = on ? 'var(--purple)' : 'var(--bg-elevated-2)';
      b.style.color = on ? '#141019' : 'var(--text-secondary)';
    });
  };
  const renderBody = () => {
    paintTabs();
    const body = $('#stk-body');
    if (!body) return;
    if (tab === 'pic') {
      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;max-height:240px;overflow-y:auto;">
        ${pics.map((p, i) => `<img src="${imgSrc(p.img)}" data-pick-img="1" data-idx="${i}" style="width:100%;aspect-ratio:1;object-fit:contain;border-radius:8px;cursor:pointer;background:var(--card);">`).join('')}
      </div>`;
      body.querySelectorAll('[data-pick-img]').forEach(el => {
        el.onclick = () => {
          // 传 Blob 描述符本体（blob: URL 只在本会话有效，入库必须存描述符）
          const p = pics[parseInt(el.dataset.idx)];
          if (p && (p.img || p.data)) onPick({ img: p.img || p.data });
        };
      });
    } else {
      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px;max-height:240px;overflow-y:auto;">
        ${emojiChars.map(e => { const img = emojiImgOf(e, 'emoji-stk-img'); return `<button class="btn" data-pick-sticker="1" data-s="${escapeHtml(e)}" style="padding:5px 0;justify-content:center;">${img || `<span style="font-size:21px;">${escapeHtml(e)}</span>`}</button>`; }).join('')}
      </div>`;
      body.querySelectorAll('[data-pick-sticker]').forEach(el => {
        el.onclick = () => { onPick({ sticker: el.dataset.s }); };
      });
    }
  };
  box.querySelectorAll('.stk-tab').forEach(b => {
    b.onclick = () => { if (tab !== b.dataset.stab) { tab = b.dataset.stab; renderBody(); } };
  });
  renderBody();
  box.style.display = '';
}

/* 玩家发布动态弹窗（文字 + 图片最多9张 + 表情包 + 可见范围，9.1）
   20260929ah：emoji 贴纸支持多选（_moStickers 数组，_moSticker=首个兼容旧数据） */
let _moImages = [];
let _moStickers = [];
function showPublishMomentModal() {
  _moImages = [];
  _moStickers = [];
  const chars = characters;
  const renderPubAttach = () => {
    const box = $('#mo-pub-attach');
    if (!box) return;
    if (_moStickers.length) {
      box.style.display = '';
      box.innerHTML = _moStickers.map((s, i) => `<div style="position:relative;display:inline-block;font-size:42px;line-height:1;margin:2px 8px 2px 0;">${escapeHtml(s)}<button data-mopubstkrm="${i}" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.65);color:#fff;border:none;font-size:11px;line-height:18px;cursor:pointer;">✕</button></div>`).join('');
      box.querySelectorAll('[data-mopubstkrm]').forEach(b => {
        b.onclick = () => { _moStickers.splice(parseInt(b.dataset.mopubstkrm, 10), 1); renderPubAttach(); };
      });
    } else {
      box.style.display = 'none';
      box.innerHTML = '';
    }
  };
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">发动态</div>
      <button class="icon-btn" id="mo-pub-close">✕</button>
    </div>
    <div class="field">
      <textarea class="textarea" id="mo-pub-text" placeholder="这一刻的想法…" style="min-height:110px;"></textarea>
    </div>
    <div class="field">
      <label>图片（最多 9 张，自动压缩）</label>
      <div id="mo-pub-imgs" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;"></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <label class="btn" for="mo-pub-file" id="mo-pub-add" style="padding:8px 14px;font-size:12.5px;cursor:pointer;">＋ 添加图片</label>
        <button class="btn" id="mo-pub-emoji" style="padding:8px 14px;font-size:12.5px;">😊 表情包</button>
      </div>
      <div id="mo-pub-attach" style="margin-top:8px;display:none;"></div>
      <div id="mo-pub-emoji-panel" style="display:none;margin-top:10px;border:1px solid var(--border);border-radius:14px;padding:12px;background:var(--bg-elevated-2);"></div>
      <input type="file" id="mo-pub-file" accept="image/*" multiple style="display:none;">
    </div>
    <div class="field">
      <label>谁可以看</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;" id="mo-vis-group">
        <button class="btn mo-vis-opt" data-v="all" style="padding:7px 14px;font-size:13px;background:var(--purple);color:#141019;">公开</button>
        <button class="btn mo-vis-opt" data-v="self" style="padding:7px 14px;font-size:13px;">🔒 仅自己</button>
        <button class="btn mo-vis-opt" data-v="part" style="padding:7px 14px;font-size:13px;">👥 部分可见</button>
        <button class="btn mo-vis-opt" data-v="except" style="padding:7px 14px;font-size:13px;">🚫 不给谁看</button>
      </div>
      <div id="mo-vis-pick" style="display:none;margin-top:10px;"></div>
    </div>
    <button class="btn primary block" id="mo-pub-send">发布</button>
  `);
  $('#mo-pub-close').onclick = closeModal;

  // 可见范围选择
  let visType = 'all';
  let visIds = new Set();
  const renderVisPick = () => {
    const box = $('#mo-vis-pick');
    if (!box) return;
    if (visType !== 'part' && visType !== 'except') { box.style.display = 'none'; return; }
    box.style.display = '';
    box.innerHTML = chars.length
      ? `<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;">${visType === 'part' ? '勾选可见的访客' : '勾选要屏蔽的访客'}</div><div style="display:flex;flex-wrap:wrap;gap:8px;">${chars.map(c => `<button class="btn mo-vis-char" data-cid="${c.id}" style="padding:6px 12px;font-size:12.5px;${visIds.has(c.id) ? 'background:var(--purple);color:#141019;' : ''}">${escapeHtml(c.name)}</button>`).join('')}</div>`
      : '<div style="font-size:12px;color:var(--text-tertiary);">还没有访客</div>';
    box.querySelectorAll('.mo-vis-char').forEach(b => {
      b.onclick = () => {
        const id = b.dataset.cid;
        if (visIds.has(id)) visIds.delete(id); else visIds.add(id);
        renderVisPick();
      };
    });
  };
  document.querySelectorAll('.mo-vis-opt').forEach(b => {
    b.onclick = () => {
      visType = b.dataset.v;
      document.querySelectorAll('.mo-vis-opt').forEach(x => { x.style.background = ''; x.style.color = ''; });
      b.style.background = 'var(--purple)'; b.style.color = '#141019';
      renderVisPick();
    };
  });

  // 图片选择（压缩，最多 9 张）
  const renderImgs = () => {
    const box = $('#mo-pub-imgs');
    if (!box) return;
    box.innerHTML = _moImages.map((im, i) => `
      <div style="position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--border);">
        <img src="${imgSrc(im, true)}" style="width:100%;height:100%;object-fit:cover;">
        <button data-rm="${i}" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.65);color:var(--danger);border:none;font-size:11px;line-height:18px;cursor:pointer;">✕</button>
      </div>`).join('');
    box.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => { _moImages.splice(parseInt(b.dataset.rm), 1); renderImgs(); }; });
    $('#mo-pub-add').style.display = _moImages.length >= 9 ? 'none' : '';
  };
  $('#mo-pub-file').onchange = async (e) => {
    const files = [...e.target.files];
    for (const f of files) {
      if (_moImages.length >= 9) { miniToast('最多 9 张图片'); break; }
      try { _moImages.push(await compressImage(f, 900, 0.68)); } catch (err) {}
    }
    e.target.value = '';
    renderImgs();
  };
  // 表情包选择（与评论区同一选择器：图片表情包库 + emoji 贴纸；内嵌面板，不覆盖当前弹窗）
  $('#mo-pub-emoji').onclick = async () => {
    const box = $('#mo-pub-emoji-panel');
    if (!box) return;
    if (box.dataset.ready === '1') {
      box.style.display = box.style.display === 'none' ? '' : 'none';
      return;
    }
    box.dataset.ready = '1';
    await mountStickerPicker(box, (st) => {
      if (st.img) {
        if (_moImages.length < 9) { _moImages.push(st.img); renderImgs(); }
        else miniToast('最多 9 张图片');
      } else {
        // 20260929ah：多选——面板不收起，贴纸可连续叠加
        if (_moStickers.length < 20) { _moStickers.push(st.sticker); renderPubAttach(); }
      }
    });
  };

  // 发布
  $('#mo-pub-send').onclick = async () => {
    const text = $('#mo-pub-text').value.trim();
    if (!text && _moImages.length === 0 && !_moStickers.length) { miniToast('写点什么或加张图片吧'); return; }
    const post = {
      id: uid('mo'), authorType: 'player', authorId: null,
      content: text, images: [..._moImages],
      visibility: { type: visType, ids: [...visIds] },
      likes: [], comments: [], createTime: Date.now(),
      pending: [], authorReplies: [],
    };
    if (_moStickers.length) { post.stickers = [..._moStickers]; post.sticker = _moStickers[0]; } // sticker=首个，兼容旧渲染
    schedulePostInteractions(post);
    const posts = await loadMomentPosts();
    posts.unshift(post);
    await saveMomentPosts();
    closeModal();
    miniToast('已发布到朋友圈');
    const inMoments = document.body.dataset.view === 'moments';
    if (inMoments) renderMoments();
  };
}

/* 封面更换弹窗 */
function showMomentsCoverModal() {
  const cv = getSetting('momentsCover', '');
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">朋友圈封面</div>
      <button class="icon-btn" id="mocv-close">✕</button>
    </div>
    <div id="mocv-preview" style="height:150px;border-radius:16px;border:1px solid var(--border);background-size:cover;background-position:center;background-image:var(--cv);display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);font-size:13px;margin-bottom:14px;">
    </div>
    <div style="display:flex;gap:10px;">
      <label class="btn primary" for="mocv-input" style="flex:1;height:44px;padding:0;cursor:pointer;">${icon('camera', 15)} 上传封面</label>
      <button class="btn danger" style="flex:1;height:44px;padding:0;" id="mocv-del">删除封面</button>
      <input type="file" id="mocv-input" accept="image/*" style="display:none;">
    </div>
  `);
  cv.then(url => {
    const prev = $('#mocv-preview');
    if (prev && url) prev.style.backgroundImage = `url("${imgSrc(url)}")`;
    if (prev && !url) prev.textContent = '暂无封面（显示默认星空）';
    $('#mocv-del').disabled = !url;
    $('#mocv-input').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // 20260929ba：封面也走裁剪器（比例=朋友圈封面显示区实测比），所见即所得
      const coverEl = $('#moments-cover');
      const aspect = coverEl && coverEl.clientHeight
        ? Math.min(4, Math.max(1, coverEl.clientWidth / coverEl.clientHeight))
        : 3.9;
      const cropped = await openImageCropper(file, { aspect });
      if (!cropped) { e.target.value = ''; return; } // 取消裁剪保持原状
      await setSetting('momentsCover', cropped);
      miniToast('封面已更新');
      showMomentsCoverModal();
      renderMoments();
    };
    $('#mocv-del').onclick = async () => {
      await setSetting('momentsCover', '');
      miniToast('已删除封面');
      showMomentsCoverModal();
      renderMoments();
    };
  });
  $('#mocv-close').onclick = closeModal;
}

/* ---------- 朋友圈分享（9.5）：发给所有访客 / 单个角色 / 存入记忆宫殿 ---------- */
async function showMomentShareModal(postId) {
  const posts = await loadMomentPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return;
  const author = momentAuthor(post);
  const snippet = (post.content || '').slice(0, 60);
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">分享这条动态</div>
      <button class="icon-btn" id="mo-sh-close">✕</button>
    </div>
    <div style="background:var(--bg-elevated-2);border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-size:12.5px;font-weight:600;color:var(--purple-soft);">${escapeHtml(author.name)} 的动态</div>
      ${snippet ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:4px;line-height:1.5;">${escapeHtml(snippet)}${(post.content || '').length > 60 ? '…' : ''}</div>` : ''}
      ${(post.images || []).length ? `<div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">📎 附 ${post.images.length} 张图片</div>` : ''}
    </div>
    <button class="btn primary block" id="mo-share-all" style="margin-bottom:12px;">📤 发送给所有访客</button>
    ${characters.length ? `
      <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:8px;">或发送给单个访客</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        ${characters.map(c => `
          <button class="btn mo-share-char" data-cid="${c.id}" style="display:flex;align-items:center;gap:6px;padding:6px 12px 6px 6px;font-size:13px;">
            <span class="avatar" style="width:24px;height:24px;font-size:12px;overflow:hidden;">${c.avatar ? `<img src="${imgSrc(c.avatar)}" style="width:100%;height:100%;object-fit:cover;">` : escapeHtml(c.name[0] || '?')}</span>
            ${escapeHtml(c.name)}
          </button>`).join('')}
      </div>` : '<div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:14px;">还没有访客可以发送</div>'}
    ${chatGroups.length ? `
      <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:8px;">或分享到群聊（全体成员都会回复）</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        ${chatGroups.map(g => `
          <button class="btn mo-share-group" data-gid="${g.id}" style="display:flex;align-items:center;gap:6px;padding:6px 12px 6px 6px;font-size:13px;">
            <span class="avatar" style="width:24px;height:24px;font-size:12px;background:var(--purple-dim);display:flex;align-items:center;justify-content:center;overflow:hidden;">${g.avatar ? `<img src="${imgSrc(g.avatar)}" style="width:100%;height:100%;object-fit:cover;">` : '👥'}</span>
            ${escapeHtml(g.name)}
          </button>`).join('')}
      </div>` : '<div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:14px;">还没有群聊可以分享</div>'}
    <button class="btn block" id="mo-share-palace">🏛️ 存入记忆宫殿</button>
  `);
  $('#mo-sh-close').onclick = closeModal;
  $('#mo-share-all').onclick = async () => {
    if (!characters.length) { miniToast('还没有访客'); return; }
    for (const c of characters) await sharePostToChar(post, c);
    closeModal();
    miniToast(`已分享给 ${characters.length} 个访客`);
  };
  document.querySelectorAll('.mo-share-char').forEach(b => {
    b.onclick = async () => {
      const c = characters.find(x => x.id === b.dataset.cid);
      if (!c) return;
      await sharePostToChar(post, c);
      closeModal();
      miniToast('已分享给 ' + c.name);
    };
  });
  document.querySelectorAll('.mo-share-group').forEach(b => {
    b.onclick = async () => {
      const g = chatGroups.find(x => x.id === b.dataset.gid);
      if (!g) return;
      await sharePostToGroup(post, g);
      closeModal();
      miniToast('已分享到群聊「' + g.name + '」');
    };
  });
  $('#mo-share-palace').onclick = async () => {
    await savePostToPalace(post);
    closeModal();
  };
}

/* 把一条朋友圈以「分享卡片消息」写进角色聊天流（20260925i：分享后角色会自动回复，
   相当于在聊天页发了一条消息——之前漏了自动回复） */
async function sharePostToChar(post, c) {
  const author = momentAuthor(post);
  const msg = {
    id: uid('msg'), charId: c.id, from: 'me', type: 'share',
    content: {
      authorName: author.name,
      text: post.content || '',
      sticker: post.sticker || null,
      img: (post.images || [])[0] || null, // 分享卡片首图（渲染端一直读 sc.img，构建端此前漏传）
      images: (post.images || []).slice(0, 9),
      time: post.createTime,
    },
    time: Date.now(), read: true,
  };
  await idbPut('messages', msg);
  if (document.body.dataset.view === 'chat' && currentCharId === c.id) {
    appendMessage(msg);
    scrollToBottom();
  } else {
    renderChatList(); // 不在该访客聊天里：刷新列表摘要即可
  }
  scheduleCharReply(c.id); // 对面的角色自动回复（与转发消息同一节奏）
}

/* 把一条朋友圈以「分享卡片消息」发进群聊（20260925i 新增：分享漏了群聊入口），
   群里所有成员都会像看到普通消息一样各自回复 */
async function sharePostToGroup(post, g) {
  const author = momentAuthor(post);
  const msg = {
    id: uid('msg'), groupId: g.id, from: 'me', type: 'share',
    content: {
      authorName: author.name,
      text: post.content || '',
      sticker: post.sticker || null,
      img: (post.images || [])[0] || null,
      images: (post.images || []).slice(0, 9),
      time: post.createTime,
    },
    time: Date.now(), read: true,
  };
  await idbPut('messages', msg);
  if (currentGroupId === g.id && document.body.dataset.view === 'chat') {
    appendGroupMessage(msg);
    scrollToBottom();
  } else {
    renderChatList();
  }
  startGroupChain(g, { source: 'share' }); // az：走接龙引擎（尊重禁言+轮次，替代已删除的 scheduleGroupReply）
}

/* ============================================================
   记忆宫殿（20260929w 全量落地）
   细则要点：
   · 三类文件夹：每角色一个（可再分子文件夹）、玩家一个（内含一个隐藏文件夹）；
     群聊记忆只归某一个访客文件夹（系统随机/AI 决定，手动截取按细则也归单角色）
   · 存入：以一条消息为基准点前后各截 50 条（共 101 条，不足截多少存多少）；
     玩家批量勾选上限 101 条；玩家手动上传图片+配文
   · 时间标签：2026.06.03.上午（7点～11点）六段式
   · AI 读取：总开关 → 访客文件夹默认可读（扮演谁读谁）→ 玩家文件夹默认不可读、
     文件夹/单条可勾选 → 隐藏文件夹绝对不可读
   · 摘要：接入 AI 后由 AI 撰写（AI 读摘要不读全文防卡顿）；未接 AI 系统简单截取
   · 存储：条目入 IndexedDB palace store（不塞大 JSON）；图片沿用 Blob 描述符；
     全量备份 .ocdata 包含记忆宫殿
   ============================================================ */
const PAL_P = 'pf_player', PAL_H = 'pf_hidden';
/* 20260929ah：玩家根文件夹的显示名——跟随玩家在主页设置的昵称（存储名不变，昵称可随时改） */
function palPlayerFolderName() {
  return (playerProfile.name || '玩家') + '的记忆';
}
/* 20260929an：记忆文本里的「玩家」字样显示时自动替换成玩家主页昵称。
   存库原文不动（AI 写的记忆标题/系统截取的对话里固化了"玩家"二字），
   这样改昵称后历史记忆也跟随显示；昵称为空或就叫"玩家"时原样返回。 */
function palWithPlayerName(s) {
  if (typeof s !== 'string' || !s) return s || '';
  const n = String(playerProfile.name || '').trim();
  if (!n || n === '玩家') return s;
  return s.split('玩家').join(n);
}

async function palFolders() { return await getSetting('palaceFolders', []); }
async function palSaveFolders(list) { await setSetting('palaceFolders', list); }
async function palEntries() { return await idbGetAll('palace'); }
async function palSettings() { return await getSetting('palaceSettings', { aiMaster: true, autoCollect: true }); }

/* 文件夹自愈：玩家文件夹 + 隐藏文件夹 + 每个访客一个（快照名字头像，删角色后记忆仍可读） */
async function palEnsureFolders() {
  const list = await palFolders();
  let dirty = false;
  const has = (id) => list.some(f => f.id === id);
  if (!has(PAL_P)) { list.push({ id: PAL_P, type: 'player', name: '玩家的记忆', allowAI: false, createdAt: Date.now() }); dirty = true; }
  if (!has(PAL_H)) { list.push({ id: PAL_H, type: 'hidden', parentId: PAL_P, name: '隐藏夹', allowAI: false, createdAt: Date.now() }); dirty = true; }
  for (const c of characters) {
    const id = 'pf_char_' + c.id;
    if (!has(id)) {
      list.push({ id, type: 'char', charId: c.id, name: (c.name || 'TA') + '的记忆', charName: c.name || 'TA', charAvatar: c.avatar || '', allowAI: true, createdAt: Date.now() });
      dirty = true;
    }
  }
  if (dirty) await palSaveFolders(list);
  return list;
}

/* 条目/文件夹 AI 权限解析（20260929x 支持指定访客）：
   优先级：条目 allowCharIds > 条目 allowAI > 子文件夹 allowCharIds/allowAI > 主文件夹 allowCharIds/allowAI。
   隐藏文件夹链条一律 false（绝对不给 AI）。charId = 当前被 AI 扮演的角色 id */
function palPermFor(entry, folders, charId) {
  const f0 = folders.find(x => x.id === entry.folderId);
  const isHidden = !!(f0 && (f0.type === 'hidden' || f0.parentId === PAL_H));
  // 20260929be：隐藏夹默认绝密，但单条显式授权（allowAI=true 或 allowCharIds 指定）可破例放行
  const explicit = entry.allowAI === true || (Array.isArray(entry.allowCharIds) && entry.allowCharIds.some(Boolean));
  if (isHidden) {
    if (!explicit) return false;
    if (Array.isArray(entry.allowCharIds) && entry.allowCharIds.length) return entry.allowCharIds.includes(charId);
    return entry.allowAI === true;
  }
  if (Array.isArray(entry.allowCharIds) && entry.allowCharIds.length) return entry.allowCharIds.includes(charId);
  if (entry.allowAI === true) return true;
  if (entry.allowAI === false) return false;
  if (entry.subFolderId) {
    const sf = folders.find(x => x.id === entry.subFolderId);
    if (sf) {
      if (Array.isArray(sf.allowCharIds) && sf.allowCharIds.length) return sf.allowCharIds.includes(charId);
      return !!sf.allowAI;
    }
  }
  if (f0) {
    if (Array.isArray(f0.allowCharIds) && f0.allowCharIds.length) return f0.allowCharIds.includes(charId);
    return !!f0.allowAI;
  }
  return false;
}

/* 兼容旧调用：该条是否"对任意角色可读"（UI 展示用） */
function palEntryAllow(entry, folders) {
  if (Array.isArray(entry.allowCharIds) && entry.allowCharIds.length) return true;
  if (entry.allowAI === true) return true;
  if (entry.allowAI === false) return false;
  const sf = entry.subFolderId ? folders.find(x => x.id === entry.subFolderId) : null;
  if (sf) return !!sf.allowAI || !!(Array.isArray(sf.allowCharIds) && sf.allowCharIds.length);
  const f = folders.find(x => x.id === entry.folderId);
  if (f && (f.type === 'hidden' || f.parentId === PAL_H)) return false;
  return !!(f && (f.allowAI || (Array.isArray(f.allowCharIds) && f.allowCharIds.length)));
}

/* 行尾权限按钮的状态小字（条目用：跟随/可读/关/指定n人） */
function palPermTagText(entryLike, folders) {
  const n = Array.isArray(entryLike.allowCharIds) ? entryLike.allowCharIds.filter(Boolean).length : 0;
  if (n) return `指定${n}人`;
  if (entryLike.allowAI === true) return 'AI 可读';
  if (entryLike.allowAI === false) return 'AI 关';
  const sf = entryLike.subFolderId ? folders.find(x => x.id === entryLike.subFolderId) : null;
  if (sf) return (sf.allowAI || (Array.isArray(sf.allowCharIds) && sf.allowCharIds.length)) ? '跟随·可读' : '跟随·关';
  const f = folders.find(x => x.id === entryLike.folderId);
  if (f && (f.type === 'hidden' || f.parentId === PAL_H)) return '绝密';
  return (f && (f.allowAI || (Array.isArray(f.allowCharIds) && f.allowCharIds.length))) ? '跟随·可读' : '跟随·关';
}

/* 时间段标签（细则五，20260929x 整点边界精确到分钟：11点属上午、14点属中午、17点属下午、20点起深夜） */
function palDateLabel(ts) {
  const d = new Date(ts);
  const p2 = (n) => String(n).padStart(2, '0');
  const mins = d.getHours() * 60 + d.getMinutes();
  let seg, range;
  if (mins < 7 * 60) { seg = '凌晨'; range = '0点～6点'; }
  else if (mins <= 11 * 60) { seg = '上午'; range = '7点～11点'; }
  else if (mins <= 14 * 60) { seg = '中午'; range = '11点～14点'; }
  else if (mins <= 17 * 60) { seg = '下午'; range = '14点～17点'; }
  else if (mins < 20 * 60) { seg = '傍晚'; range = '17点～20点'; }
  else { seg = '深夜'; range = '20点～24点'; }
  return `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}.${seg}（${range}）`;
}

/* 消息快照：文字原样；图片/表情共用 Blob 描述符；其余卡片类记类型占位 */
function palSnapMsg(m, charName) {
  let content = '';
  if (typeof m.content === 'string') content = m.content;
  else if (m.type === 'image' || m.type === 'emoji') content = m.content;
  else content = '[卡片消息]';
  return { from: m.from, type: m.type, content, name: m.from === 'me' ? (playerProfile.name || '我') : (charName || 'TA'), time: m.time };
}

/* 系统简单截取（未接 AI）：第一条文字截 30 字；接 AI 后由 AI 写摘要（读摘要不读全文） */
function palBrief(snaps) {
  const first = snaps.find(s => s.type === 'text' && s.content);
  const t = first ? first.content : (snaps[0] ? snaps[0].content : '');
  const s = String(t).replace(/\s+/g, ' ').trim();
  return s.length > 30 ? s.slice(0, 30) + '…' : s;
}

/* 存一段对话快照（基准截取 / 批量 / 系统随机共用） */
async function palSaveSegment(threadMsgs, folderId, opt = {}) {
  if (!threadMsgs.length) return null;
  const c = opt.charId ? characters.find(x => x.id === opt.charId) : null;
  const snaps = threadMsgs.map(m => palSnapMsg(m, c ? c.name : (opt.charName || '')));
  const entry = {
    id: uid('pal'), kind: 'chat',
    folderId, subFolderId: opt.subFolderId || '',
    charId: opt.charId || '', groupId: opt.groupId || '',
    messages: snaps, baseMsgId: opt.baseMsgId || '',
    title: palBrief(snaps) || '一段对话',
    summary: '', summaryByAI: false,
    text: '', img: null,
    dateLabel: palDateLabel(Date.now()),
    time: Date.now(), createdAt: Date.now(),
    allowAI: null, // 跟随文件夹（角色夹默认可读、玩家夹默认不可读）
    auto: !!opt.auto,
  };
  await idbPut('palace', entry);
  return entry;
}

/* ---------- 玩家主动存入（细则三） ---------- */
/* 基准点截取：前后各 50 条 + 基准点 = 最多 101 条（比满分多一点，溢出爱意） */
async function palCaptureMenu(baseMsg) {
  const isGroup = !!baseMsg.groupId;
  let thread, folderId, charId = '', charName = '', groupId = '';
  if (isGroup) {
    const all = await idbGetAll('messages');
    thread = all.filter(m => m.groupId === baseMsg.groupId).sort((a, b) => a.time - b.time);
    groupId = baseMsg.groupId;
    const g = chatGroups.find(x => x.id === groupId);
    const members = ((g && g.memberIds) || []).filter(id => characters.find(c => c.id === id));
    if (!members.length) { miniToast('群成员数据异常'); return; }
    const pick = members[randInt(0, members.length - 1)];
    const pc = characters.find(c => c.id === pick);
    folderId = 'pf_char_' + pick;
    charId = pick; charName = pc ? pc.name : 'TA';
  } else {
    thread = (await idbGetMessagesByChar(baseMsg.charId, 100000)).filter(m => !m.groupId);
    folderId = 'pf_char_' + baseMsg.charId;
    charId = baseMsg.charId;
    const c = characters.find(x => x.id === baseMsg.charId);
    charName = c ? c.name : 'TA';
  }
  const i = thread.findIndex(m => m.id === baseMsg.id);
  if (i < 0) { miniToast('找不到这条消息了'); return; }
  const seg = thread.slice(Math.max(0, i - 50), Math.min(thread.length, i + 51));
  const tail = isGroup ? `（群聊记忆按细则归入单访客文件夹，已选：${escapeHtml(charName)}）` : '';
  showConfirm(`以这条消息为基准，截取前后各 50 条（本段共 ${seg.length} 条）存入「${escapeHtml(charName)}」的记忆文件夹？${tail}`, async () => {
    await palEnsureFolders();
    const e = await palSaveSegment(seg, folderId, { charId, groupId, baseMsgId: baseMsg.id });
    if (e) miniToast(`已存入记忆宫殿 🏛️（${seg.length} 条）`);
  });
}

/* 批量选择存入（细则三-4：上限 101 条） */
async function palCaptureBatch(ids) {
  if (!currentCharId) { miniToast('批量存入请在角色聊天里使用'); return; }
  const thread = (await idbGetMessagesByChar(currentCharId, 100000)).filter(m => !m.groupId);
  const set = new Set(ids);
  const seg = thread.filter(m => set.has(m.id));
  if (!seg.length) { miniToast('勾选的消息不在当前会话里'); return; }
  const c = characters.find(x => x.id === currentCharId);
  showConfirm(`把勾选的 ${seg.length} 条对话存入「${escapeHtml(c ? c.name : 'TA')}」的记忆文件夹？`, async () => {
    await palEnsureFolders();
    await palSaveSegment(seg, 'pf_char_' + currentCharId, { charId: currentCharId });
    miniToast(`已存入记忆宫殿 🏛️（${seg.length} 条）`);
    exitMultiSelect();
  });
}

/* 系统随机存入（细则四）：每线程每天至多 1 次、低概率触发、上限 100 条；
   群聊归档到系统随机的那一位成员的访客文件夹 */
async function palAutoCollectMaybe(charId, groupId) {
  try {
    const st = await palSettings();
    if (st.autoCollect === false) return;
    const key = 'palaceAuto_' + (groupId || charId);
    const today = new Date().toDateString();
    if ((await getSetting(key, '')) === today) return;
    if (Math.random() > 0.03) return;
    let seg, folderId, opt;
    if (groupId) {
      const all = await idbGetAll('messages');
      seg = all.filter(m => m.groupId === groupId).sort((a, b) => a.time - b.time).slice(-100);
      if (seg.length < 30) return;
      const g = chatGroups.find(x => x.id === groupId);
      const members = ((g && g.memberIds) || []).filter(id => characters.find(c => c.id === id));
      if (!members.length) return;
      const pick = members[randInt(0, members.length - 1)];
      folderId = 'pf_char_' + pick;
      opt = { charId: pick, groupId, auto: true };
    } else {
      seg = (await idbGetMessagesByChar(charId, 100)).filter(m => !m.groupId);
      if (seg.length < 30) return;
      folderId = 'pf_char_' + charId;
      opt = { charId, auto: true };
    }
    await palEnsureFolders();
    await palSaveSegment(seg, folderId, opt);
    await setSetting(key, today);
    miniToast('🏛️ TA 悄悄把这段对话收进了记忆宫殿');
  } catch (e) { /* 静默：收藏失败不打扰聊天 */ }
}

/* 玩家手动上传（细则一-3）：图片 + 配文，存玩家文件夹（可细分） */
async function palAddManual({ text, img, subFolderId, folderId }) {
  const entry = {
    id: uid('pal'), kind: 'manual',
    folderId: folderId || PAL_P, subFolderId: subFolderId || '',
    charId: '', groupId: '',
    messages: [], baseMsgId: '',
    title: (text || '一条手记').replace(/\s+/g, ' ').trim().slice(0, 30) || '一条手记',
    summary: '', summaryByAI: false,
    text: text || '', img: img || null,
    dateLabel: palDateLabel(Date.now()),
    time: Date.now(), createdAt: Date.now(),
    allowAI: null,
  };
  await idbPut('palace', entry);
  return entry;
}

/* 旧版朋友圈收藏（kv memoryPalaceItems）一次性迁移为宫殿条目 */
async function palMigrateOldPosts() {
  if (await getSetting('palaceMigrated', false)) return;
  const items = await getSetting('memoryPalaceItems', []);
  for (const it of items) {
    await idbPut('palace', {
      id: uid('pal'), kind: 'post', folderId: PAL_P, subFolderId: '',
      charId: '', groupId: '', messages: [], baseMsgId: '',
      title: (it.text || '朋友圈收藏').replace(/\s+/g, ' ').trim().slice(0, 30) || '朋友圈收藏',
      summary: '', summaryByAI: false,
      text: it.text || '', sticker: it.sticker || '',
      images: it.images || [], img: null,
      authorName: it.authorName || '', authorAvatar: it.authorAvatar || '',
      dateLabel: palDateLabel(it.time || it.savedAt || Date.now()),
      time: it.time || it.savedAt || Date.now(), createdAt: Date.now(),
      allowAI: null,
    });
  }
  await setSetting('palaceMigrated', true);
}

/* 朋友圈分享存入（分享弹窗按钮入口，保留原函数名） */
async function savePostToPalace(post) {
  await palEnsureFolders();
  const author = momentAuthor(post);
  await idbPut('palace', {
    id: uid('pal'), kind: 'post', folderId: PAL_P, subFolderId: '',
    charId: '', groupId: '', messages: [], baseMsgId: '',
    title: (post.content || '朋友圈收藏').replace(/\s+/g, ' ').trim().slice(0, 30) || '朋友圈收藏',
    summary: '', summaryByAI: false,
    text: post.content || '', sticker: post.sticker || '',
    images: (post.images || []).slice(0, 9), img: null,
    authorName: author.name, authorAvatar: author.avatar || '',
    dateLabel: palDateLabel(post.createTime || Date.now()),
    time: post.createTime || Date.now(), createdAt: Date.now(),
    allowAI: null,
  });
  miniToast('已存入记忆宫殿 🏛️');
}

/* ---------- AI 上下文（细则六，供接入 AI 模块后调用） ---------- */
/* 20260929x：支持指定访客权限（allowCharIds）。铁律：AI 扮演谁，只能读谁自己的访客文件夹
   + 玩家侧放行的条目；其他访客文件夹/群聊记忆绝对隔离；隐藏夹永不放行 */
async function getPalaceAIContext(charId) {
  const st = await palSettings();
  if (st.aiMaster === false) return [];
  const folders = await palFolders();
  const entries = await palEntries();
  const out = [];
  for (const e of entries) {
    const f = folders.find(x => x.id === e.folderId);
    if (f && f.type === 'char') {
      // 访客专属文件夹：只有扮演 TA 本人时才可能读（其他访客/群聊记忆绝对隔离）
      if ((f.charId || e.charId) !== charId) continue;
    } else {
      // 访客专属文件夹之外：只放行玩家侧条目；隐藏夹绝对禁止
      const isPlayerSide = e.folderId === PAL_P || e.folderId === PAL_H;
      if (!isPlayerSide) continue;
    }
    if (!palPermFor(e, folders, charId)) continue;
    // 20260929an：AI 读记忆时标题/摘要里的「玩家」也换成玩家昵称，保持称呼一致
    out.push({ dateLabel: e.dateLabel, title: palWithPlayerName(e.title), summary: palWithPlayerName(e.summary || e.title), size: (e.messages || []).length, kind: e.kind });
  }
  return out;
}

/* ---------- UI：主视图（文件夹总览 + AI 总开关） ---------- */
/* 检索输入绑定（20260929bd）：拼音输入法组词期间不触发检索（composition 守卫），
   修复「拼音字母刚打完还没选字就自动检索」；回车立即检索；fire 收最终关键词 */
function bindPalSearch(input, fire) {
  if (!input) return;
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; fire(input.value); });
  input.addEventListener('input', () => { if (!composing) fire(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !composing) { e.preventDefault(); fire(input.value); }
  });
}
function palDebounce(fn, ms) { let t = null; return (v) => { clearTimeout(t); t = setTimeout(() => fn(v), ms); }; }

async function showMemoryPalaceModal(opts = {}) {
  await palMigrateOldPosts();
  const folders = await palEnsureFolders();
  const pf = folders.find(x => x.id === PAL_P);
  const entries = await palEntries();
  const st = await palSettings();
  const cnt = (fid) => entries.filter(e => e.folderId === fid).length;
  const subCount = (fid) => folders.filter(f => f.parentId === fid).length;
  /* 20260929bc：关键词搜索——标题/摘要/正文全量检索，点结果直接开卡片（左右滑动跨结果） */
  const q = (opts.q || '').trim();
  const hit = (e) => {
    if (!q) return true;
    const hay = `${e.title || ''} ${e.summary || ''} ${e.text || ''} ${e.ocr || ''} ${(e.messages || []).map(s => s.content && s.content.text ? s.content.text : (typeof s.content === 'string' ? s.content : '')).join(' ')}`;
    return hay.toLowerCase().includes(q.toLowerCase());
  };
  const searchResults = q ? entries.filter(hit).sort((a, b) => b.time - a.time) : null;
  /* 20260929bd：文件夹也进检索结果——夹名匹配或夹内有匹配内容的分类，一并列在结果顶部 */
  const folderHits = q ? folders.filter(f =>
    (f.name || '').toLowerCase().includes(q.toLowerCase()) ||
    searchResults.some(e => e.folderId === f.id || e.subFolderId === f.id)
  ) : [];
  openModal(`
    <div class="pal-galaxy-head">
      <div class="pal-galaxy-title">记忆宫殿</div>
      <div class="pal-galaxy-sub">${entries.length ? `共 ${entries.length} 段记忆 · 星光收藏` : '这里将收藏你和 TA 的记忆'}</div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        ${icon('memory', 18)}<span class="badge">${folders.length} 个文件夹</span>
      </div>
      <button class="icon-btn" id="mp-close" title="关闭">${icon('close', 18)}</button>
    </div>
    <div class="pal-searchbar">
      ${icon('search', 15)}
      <input class="input" id="pal-search" placeholder="检索记忆关键词…" value="${escapeHtml(q)}">
      ${q ? `<button class="pal-search-clear" id="pal-search-clear">${icon('close', 13)}</button>` : ''}
    </div>
    ${searchResults ? `
      <div style="font-size:12px;color:var(--text-tertiary);margin:6px 2px;">检索到 ${folderHits.length} 个分类 · ${searchResults.length} 段记忆</div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow-y:auto;" id="pal-search-list">
        ${folderHits.map((f) => {
          const nIn = searchResults.filter(e => e.folderId === f.id || e.subFolderId === f.id).length;
          const nameHit = (f.name || '').toLowerCase().includes(q.toLowerCase());
          return `
          <div class="pal-row" data-sfopen="${f.id}">
            <div class="pal-ic">${icon('folder', 17)}</div>
            <div class="pal-main">
              <div class="pal-title">${escapeHtml(f.name || '未命名分类')}</div>
              <div class="pal-sub">${nameHit ? '分类名匹配' : `夹内有 ${nIn} 段匹配记忆`} · 点击进入</div>
            </div>
            <span style="color:var(--text-tertiary);">›</span>
          </div>`;
        }).join('')}
        ${searchResults.length ? searchResults.map((e, i) => {
          const f = folders.find(x => x.id === e.folderId);
          return `
          <div class="pal-row" data-srid="${e.id}" data-srl="${i}">
            <div class="pal-ic">${e.kind === 'chat' ? icon('chatset', 17) : (e.kind === 'letter' ? icon('letter', 17) : (e.kind === 'manual' ? icon('image', 17) : icon('moments', 17)))}</div>
            <div class="pal-main">
              <div class="pal-title">${escapeHtml(palWithPlayerName(e.title || '（无题）'))}</div>
              <div class="pal-sub">${escapeHtml(e.dateLabel || '')} · ${f ? escapeHtml(f.name) : '未归类'}</div>
            </div>
            <span style="color:var(--text-tertiary);">›</span>
          </div>`;
        }).join('') : `<div class="empty" style="padding:16px 0;"><div class="empty-icon">${icon('search', 30)}</div><div>没有匹配的记忆</div></div>`}
      </div>
    ` : `
    <div style="display:flex;flex-direction:column;gap:8px;max-height:48vh;overflow-y:auto;" id="pal-root">
      ${(() => {
        const pn = pf && Array.isArray(pf.allowCharIds) ? pf.allowCharIds.filter(Boolean).length : 0;
        const pTag = pn ? `指定${pn}人` : (pf && pf.allowAI ? 'AI 可读' : 'AI 关');
        return `
      <div class="pal-row" data-open="${PAL_P}">
        <div class="pal-ic">${icon('user', 18)}</div>
        <div class="pal-main">
          <div class="pal-title">${escapeHtml(palPlayerFolderName())}</div>
          <div class="pal-sub">${cnt(PAL_P)} 段 · ${subCount(PAL_P)} 个分类 · AI 默认不可读（可勾选放开）</div>
        </div>
        <button class="wb-act ai" data-pact="folder:${PAL_P}" title="AI 读取权限">${icon('shield', 13)} ${pTag}</button>
        <span style="color:var(--text-tertiary);">›</span>
      </div>`;
      })()}
      ${folders.filter(f => f.type === 'char').map(f => `
        <div class="pal-row" data-open="${f.id}">
          <div class="pal-ic">${f.charAvatar ? `<img src="${imgSrc(f.charAvatar, true)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">` : escapeHtml((f.charName || '梦')[0])}</div>
          <div class="pal-main">
            <div class="pal-title">${escapeHtml(f.name)}</div>
            <div class="pal-sub">${cnt(f.id)} 段 · ${subCount(f.id)} 个分类 · ${f.allowAI ? 'AI 默认可读' : 'AI 不可读'}</div>
          </div>
          <button class="wb-act ai" data-pact="folder:${f.id}" title="AI 读取权限">${icon('shield', 13)} ${f.allowAI ? 'AI 开' : 'AI 关'}</button>
          <span style="color:var(--text-tertiary);">›</span>
        </div>
      `).join('')}
      ${entries.length === 0 ? `<div class="empty" style="padding:18px 0;"><div class="empty-icon">${icon('memory', 34)}</div><div>宫殿里还没有记忆</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">长按聊天消息可截取前后各 50 条；多选消息可批量存（上限 101 条）</div></div>` : ''}
    </div>`}
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border:1px dashed var(--border);border-radius:12px;margin-top:10px;">
      <div style="font-size:12.5px;color:var(--text-secondary);line-height:1.45;">AI 可读取记忆（总开关）<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">扮演谁只能读谁的记忆；玩家勾选的条目与隐藏夹规则见文件夹内</div></div>
      <input type="checkbox" id="pal-master" ${st.aiMaster === false ? '' : 'checked'} style="width:18px;height:18px;accent-color:var(--purple);">
    </div>
    <div style="font-size:11px;color:var(--text-tertiary);margin-top:10px;line-height:1.5;">记忆包含在「所有内容」备份（.ocdata）里；玩家上传的图片以 Blob 存储，保护低端机内存</div>
  `, { galaxy: true });
  $('#mp-close').onclick = closeModal;
  bindPalSearch($('#pal-search'), palDebounce((v) => showMemoryPalaceModal({ q: v, refocus: true }), 260));
  const clr = $('#pal-search-clear');
  if (clr) clr.onclick = () => showMemoryPalaceModal();
  if (q && opts.refocus) {
    const si = $('#pal-search');
    if (si) { si.focus(); try { si.setSelectionRange(si.value.length, si.value.length); } catch (e) {} }
  }
  $('#pal-master').onchange = async (e) => {
    const s = await palSettings();
    s.aiMaster = e.target.checked;
    await setSetting('palaceSettings', s);
    miniToast(e.target.checked ? 'AI 可按规则读取记忆' : '已禁止 AI 读取全部记忆');
  };
  if (searchResults) {
    const res = searchResults;
    document.querySelectorAll('#pal-search-list [data-srid]').forEach(row => {
      row.onclick = () => showPalaceEntry(row.dataset.srid, res.find(x => x.id === row.dataset.srid).folderId, { list: res });
    });
    // bd：检索结果里的分类行——点击进入该文件夹（子文件夹走 showPalaceSubFolder）
    document.querySelectorAll('#pal-search-list [data-sfopen]').forEach(row => {
      row.onclick = () => {
        const sf = folders.find(x => x.id === row.dataset.sfopen);
        if (sf && sf.type === 'sub') showPalaceSubFolder(sf.parentId, sf.id);
        else showPalaceFolder(row.dataset.sfopen);
      };
    });
  } else {
    document.querySelectorAll('#pal-root [data-open]').forEach(row => {
      row.onclick = () => showPalaceFolder(row.dataset.open);
    });
    // 行尾 AI 权限按钮（20260929x：权限入口放在每行后方，不再藏进文件夹里）
    document.querySelectorAll('#pal-root [data-pact]').forEach(btn => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        const [kind, id] = btn.dataset.pact.split(':');
        openPalPerm(kind, id, showMemoryPalaceModal);
      };
    });
  }
}

/* ---------- UI：文件夹视图（子文件夹 + 条目 + 批量管理） ---------- */
let _palBatch = new Set();
let _palBatchMode = false;

async function showPalaceFolder(fid, opts = {}) {
  const folders = await palEnsureFolders();
  const f = folders.find(x => x.id === fid);
  if (!f) { showMemoryPalaceModal(); return; }
  const entries = (await palEntries())
    .filter(e => e.folderId === fid)
    .sort((a, b) => b.time - a.time);
  const subs = folders.filter(x => x.parentId === fid);
  const isChar = f.type === 'char';
  const isPlayer = f.type === 'player';
  const isHidden = f.type === 'hidden';
  /* 20260929bc：关键词搜索——在本文件夹内检索标题/摘要/正文 */
  const q = (opts.q || '').trim();
  const searching = !!q;
  const qHit = (e) => {
    const hay = `${e.title || ''} ${e.summary || ''} ${e.text || ''} ${e.ocr || ''} ${(e.messages || []).map(s => s.content && s.content.text ? s.content.text : (typeof s.content === 'string' ? s.content : '')).join(' ')}`;
    return hay.toLowerCase().includes(q.toLowerCase());
  };
  const searched = searching ? entries.filter(qHit) : entries;
  /* 20260929x 修复"批量管理没有用"：旧版每次进本函数都无条件重置 _palBatchMode，
     而「批量管理」按钮是"置反→重进本函数"，刚置 true 就被清掉，批量 UI 永远出不来。
     现在只有从外部进入（非 keepBatch）才重置 */
  if (!opts.keepBatch) { _palBatch = new Set(); _palBatchMode = false; }

  const entryRow = (e) => {
    const ic = e.kind === 'chat' ? icon('chatset', 17) : (e.kind === 'letter' ? icon('letter', 17) : (e.kind === 'manual' ? icon('image', 17) : icon('moments', 17)));
    const kindLabel = e.kind === 'chat' ? `${(e.messages || []).length} 条对话` : (e.kind === 'letter' ? '信件' : (e.kind === 'manual' ? '手记' : '朋友圈收藏'));
    // 20260929be：隐藏夹条目单条显式授权后显示实际权限（可读/指定n人），未授权仍显示绝密
    const tag = (isHidden && !palEntryAllow(e, folders)) ? '绝密' : palPermTagText(e, folders);
    const sf = e.subFolderId ? folders.find(x => x.id === e.subFolderId) : null;
    const subName = sf ? ' · ' + escapeHtml(sf.name) : '';
    return `
    <div class="pal-row${_palBatch.has(e.id) ? ' sel' : ''}" data-eid="${e.id}">
      ${_palBatchMode ? `<input type="checkbox" data-palchk="${e.id}" ${_palBatch.has(e.id) ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--purple);flex-shrink:0;">` : ''}
      <div class="pal-ic">${ic}</div>
      <div class="pal-main">
        <div class="pal-title">${escapeHtml(palWithPlayerName(e.title || '（无题）'))}</div>
        <div class="pal-sub">${escapeHtml(e.dateLabel)} · ${kindLabel}${subName} ${isHidden ? '' : ''}</div>
      </div>
      ${isHidden ? '' : `<button class="wb-act ai" data-pact="entry:${e.id}" title="AI 读取权限">${icon('shield', 13)} ${tag}</button>`}
      <span style="color:var(--text-tertiary);">›</span>
    </div>`;
  };

  openModal(`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <button class="icon-btn" id="pf-back">${icon('chevleft', 18)}</button>
      <div style="flex:1;font-size:16.5px;font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${isHidden ? `${icon('lock', 15)} ` : ''}${escapeHtml(isPlayer ? palPlayerFolderName() : (f.name || ''))}</div>
      <button class="icon-btn" id="pf-close">${icon('close', 18)}</button>
    </div>
    <div class="pal-searchbar" style="margin-bottom:10px;">
      ${icon('search', 15)}
      <input class="input" id="pf-search" placeholder="检索本夹记忆关键词…" value="${escapeHtml(q)}">
      ${q ? `<button class="pal-search-clear" id="pf-search-clear">${icon('close', 13)}</button>` : ''}
    </div>
    ${isChar ? `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px dashed var(--border);border-radius:12px;margin-bottom:10px;">
      <div style="font-size:12.5px;color:var(--text-secondary);">允许 AI 读取本文件夹<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">AI 扮演 ${escapeHtml(f.charName || 'TA')} 时可作为上下文参考（也可点每条记忆行尾的权限盾单独控制）</div></div>
      <input type="checkbox" id="pf-allow" ${f.allowAI ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
    </div>` : ''}
    ${isPlayer ? `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px dashed var(--border);border-radius:12px;margin-bottom:10px;">
      <div style="font-size:12.5px;color:var(--text-secondary);">允许 AI 读取本文件夹<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">默认不可读；也可点行尾权限盾只授权给指定访客的 AI</div></div>
      <input type="checkbox" id="pf-allow" ${f.allowAI ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
    </div>` : ''}
    ${searching ? `<div style="font-size:12px;color:var(--text-tertiary);margin:2px 2px 8px;">检索到 ${searched.length} 段记忆</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:8px;max-height:42vh;overflow-y:auto;" id="pf-list">
      ${searching ? searched.map(entryRow).join('') || `<div class="empty" style="padding:14px 0;"><div class="empty-icon">${icon('search', 30)}</div><div>没有匹配的记忆</div></div>` : `
      ${!isHidden && !isChar ? `
      <div class="pal-row" data-newsub="1" style="border-style:dashed;">
        <div class="pal-ic">${icon('folder', 20)}</div><div class="pal-main"><div class="pal-title">新建子文件夹</div><div class="pal-sub">把记忆细分归类</div></div>
      </div>
      <div class="pal-row" data-manual="1" style="border-style:dashed;">
        <div class="pal-ic">${icon('image', 20)}</div><div class="pal-main"><div class="pal-title">手动上传一条记忆</div><div class="pal-sub">图片 + 配文，记录和 TA 的日常</div></div>
      </div>` : ''}
      ${!isHidden && isChar ? `
      <div class="pal-row" data-newsub="1" style="border-style:dashed;">
        <div class="pal-ic">${icon('folder', 20)}</div><div class="pal-main"><div class="pal-title">新建子文件夹</div><div class="pal-sub">把这段记忆细分归类</div></div>
      </div>` : ''}
      ${!isHidden ? subs.map(sf => {
        const sfHidden = sf.type === 'hidden' || sf.parentId === PAL_H;
        return `
      <div class="pal-row${_palBatch.has('fld:' + sf.id) ? ' sel' : ''}" data-sub="${sf.id}">
        ${_palBatchMode ? `<input type="checkbox" data-palfk="${sf.id}" ${_palBatch.has('fld:' + sf.id) ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--purple);flex-shrink:0;">` : ''}
        <div class="pal-ic">${icon('folder', 20)}</div>
        <div class="pal-main">
          <div class="pal-title">${escapeHtml(sf.name)}</div>
          <div class="pal-sub">${entries.filter(e => e.subFolderId === sf.id).length} 段 · ${sfHidden ? '绝密' : palPermTagText(sf, folders)}</div>
        </div>
        ${sfHidden
          ? `<button class="wb-act ai" data-hidden-perm="1" title="隐藏夹">${icon('shield', 13)} 绝密</button>`
          : `<button class="wb-act ai" data-pact="folder:${sf.id}" title="AI 读取权限">${icon('shield', 13)} ${palPermTagText(sf, folders)}</button>`}
        <button class="icon-btn" data-subdel="${sf.id}" title="删除文件夹" style="width:26px;height:26px;flex-shrink:0;">${icon('trash', 13)}</button>
        <span style="color:var(--text-tertiary);">›</span>
      </div>`;
      }).join('') : ''}
      ${isHidden ? `<div style="font-size:11.5px;color:var(--text-tertiary);padding:2px 2px 6px;">这里的记忆绝对不给 AI 读取，只属于你自己</div>` : ''}
      ${entries.filter(e => !e.subFolderId).map(entryRow).join('')}
      ${entries.length === 0 && isHidden ? `<div class="empty" style="padding:14px 0;"><div class="empty-icon">${icon('lock', 30)}</div><div>隐藏夹是空的</div></div>` : ''}
      `}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn" style="flex:1;white-space:nowrap;padding-left:4px;padding-right:4px;" id="pf-batch">${_palBatchMode ? '退出批量' : '批量管理'}</button>
      ${_palBatchMode ? `
        <button class="btn" style="flex:1;white-space:nowrap;padding-left:4px;padding-right:4px;" id="pf-selall">全选</button>
        <button class="btn" style="flex:1;white-space:nowrap;padding-left:4px;padding-right:4px;" id="pf-move">移动</button>
        <button class="btn danger" style="flex:1;white-space:nowrap;padding-left:4px;padding-right:4px;" id="pf-del">删除</button>
      ` : ''}
    </div>
    ${_palBatchMode ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:6px;" id="pf-batchhint">点任意一行即可勾选/取消（已选 ${_palBatch.size} 项）；子文件夹可勾选后删除，移动仅对记忆生效</div>` : ''}
  `, { galaxy: true });
  $('#pf-close').onclick = () => showMemoryPalaceModal(); // 20260929x：✕ 回上一功能页，不再直接退出
  $('#pf-back').onclick = () => showMemoryPalaceModal();
  bindPalSearch($('#pf-search'), palDebounce((v) => showPalaceFolder(fid, { q: v, keepBatch: _palBatchMode, refocus: true }), 260));
  const pfClr = $('#pf-search-clear');
  if (pfClr) pfClr.onclick = () => showPalaceFolder(fid, { keepBatch: _palBatchMode });
  if (q && opts.refocus) {
    const si = $('#pf-search');
    if (si) { si.focus(); try { si.setSelectionRange(si.value.length, si.value.length); } catch (e) {} }
  }
  const allowEl = $('#pf-allow');
  if (allowEl) allowEl.onchange = async (e) => {
    const list = await palFolders();
    const me = list.find(x => x.id === fid);
    if (me) { me.allowAI = e.target.checked; if (e.target.checked) me.allowCharIds = []; await palSaveFolders(list); }
    miniToast(e.target.checked ? '已允许 AI 读取（可点行尾权限盾细化到指定访客）' : '已禁止 AI 读取本文件夹');
  };
  // 行尾 AI 权限按钮（条目 / 子文件夹通用）；隐藏夹按钮=禁用态提示（绝密不可授权）
  document.querySelectorAll('#pf-list [data-pact], [data-pact]').forEach(btn => {
    if (!btn.closest('#pf-list')) return;
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const [kind, id] = btn.dataset.pact.split(':');
      openPalPerm(kind, id, () => showPalaceFolder(fid, { keepBatch: _palBatchMode }));
    };
  });
  document.querySelectorAll('#pf-list [data-hidden-perm]').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      miniToast('隐藏夹绝对不给 AI 读取，只属于你自己');
    };
  });
  document.querySelectorAll('[data-palchk]').forEach(chk => {
    chk.onchange = () => { if (chk.checked) _palBatch.add(chk.dataset.palchk); else _palBatch.delete(chk.dataset.palchk); };
  });
  document.querySelectorAll('[data-palfk]').forEach(chk => {
    chk.onchange = () => { const id = 'fld:' + chk.dataset.palfk; if (chk.checked) _palBatch.add(id); else _palBatch.delete(id); };
  });
  const newSub = document.querySelector('[data-newsub]');
  if (newSub) newSub.onclick = () => palNewSubModal(fid);
  const manualBtn = document.querySelector('[data-manual]');
  if (manualBtn) manualBtn.onclick = () => palManualModal(fid);
  // 批量模式下：点行任意位置 = 勾选/取消（不再误开详情）
  const toggleSel = (id, chk, row) => {
    if (_palBatch.has(id)) _palBatch.delete(id); else _palBatch.add(id);
    if (chk) chk.checked = _palBatch.has(id);
    if (row) row.classList.toggle('sel', _palBatch.has(id));
    const hint = document.getElementById('pf-batchhint');
    if (hint) hint.textContent = `点任意一行即可勾选/取消（已选 ${_palBatch.size} 项）；子文件夹可勾选后删除，移动仅对记忆生效`;
  };
  document.querySelectorAll('[data-sub]').forEach(row => {
    row.onclick = (ev) => {
      if (ev.target.closest('[data-subdel]') || ev.target.closest('[data-pact]')) return;
      if (_palBatchMode) { toggleSel('fld:' + row.dataset.sub, row.querySelector('[data-palfk]'), row); return; }
      showPalaceSubFolder(fid, row.dataset.sub);
    };
  });
  document.querySelectorAll('[data-subdel]').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const sid = btn.dataset.subdel;
      showConfirm('删除这个子文件夹？里面的记忆会回到本文件夹根部，不会丢失。', async () => {
        const list = await palFolders();
        await palSaveFolders(list.filter(x => x.id !== sid));
        const pal = await palEntries();
        for (const e of pal) { if (e.subFolderId === sid) { e.subFolderId = ''; await idbPut('palace', e); } }
        showPalaceFolder(fid, { keepBatch: _palBatchMode });
      });
    };
  });
  document.querySelectorAll('[data-eid]').forEach(row => {
    row.onclick = (ev) => {
      if (ev.target.closest('[data-palchk]') || ev.target.closest('[data-pact]')) return;
      if (_palBatchMode) { toggleSel(row.dataset.eid, row.querySelector('[data-palchk]'), row); return; }
      showPalaceEntry(row.dataset.eid, fid);
    };
  });
  $('#pf-batch').onclick = () => { _palBatchMode = !_palBatchMode; if (!_palBatchMode) _palBatch = new Set(); showPalaceFolder(fid, { keepBatch: true }); };
  const selall = $('#pf-selall');
  if (selall) selall.onclick = () => {
    const allIds = entries.map(e => e.id).concat(subs.map(sf => 'fld:' + sf.id));
    if (_palBatch.size >= allIds.length) _palBatch = new Set();
    else allIds.forEach(id => _palBatch.add(id));
    showPalaceFolder(fid, { keepBatch: true });
  };
  const mvBtn = $('#pf-move');
  if (mvBtn) mvBtn.onclick = () => {
    if (!_palBatch.size) { miniToast('请先勾选记忆'); return; }
    const entryIds = [..._palBatch].filter(id => !id.startsWith('fld:'));
    if (!entryIds.length) { miniToast('子文件夹不支持批量移动'); return; }
    palMoveModal(entryIds, fid);
  };
  const delBtn = $('#pf-del');
  if (delBtn) delBtn.onclick = () => {
    if (!_palBatch.size) { miniToast('请先勾选'); return; }
    const folderIds = [..._palBatch].filter(id => id.startsWith('fld:')).map(id => id.slice(4));
    const entryIds = [..._palBatch].filter(id => !id.startsWith('fld:'));
    const parts = [];
    if (entryIds.length) parts.push(`${entryIds.length} 段记忆`);
    if (folderIds.length) parts.push(`${folderIds.length} 个子文件夹（其中记忆回到本层根部）`);
    showConfirm(`删除选中的 ${parts.join(' 和 ')}？记忆删除后无法撤销。`, async () => {
      for (const id of entryIds) await idbDelete('palace', id);
      if (folderIds.length) {
        const list = await palFolders();
        await palSaveFolders(list.filter(x => !folderIds.includes(x.id)));
        const pal = await palEntries();
        for (const e of pal) { if (folderIds.includes(e.subFolderId)) { e.subFolderId = ''; await idbPut('palace', e); } }
      }
      _palBatch = new Set();
      miniToast('已删除');
      showPalaceFolder(fid, { keepBatch: true });
    });
  };
}

/* 子文件夹视图：只显示该子文件夹下的条目（20260929x：行尾权限按钮 + 批量管理 + ✕ 回上一页） */
async function showPalaceSubFolder(fid, sid, opts = {}) {
  const folders = await palFolders();
  const sf = folders.find(x => x.id === sid);
  if (!sf) { showPalaceFolder(fid); return; }
  const entries = (await palEntries()).filter(e => e.folderId === fid && e.subFolderId === sid).sort((a, b) => b.time - a.time);
  if (!opts.keepBatch) { _palBatch = new Set(); _palBatchMode = false; }
  /* 20260929bd：子文件夹内检索（标题/摘要/正文）+ 新建记忆入口 */
  const q = (opts.q || '').trim();
  const qHit = (e) => {
    const hay = `${e.title || ''} ${e.summary || ''} ${e.text || ''} ${e.ocr || ''} ${(e.messages || []).map(s => s.content && s.content.text ? s.content.text : (typeof s.content === 'string' ? s.content : '')).join(' ')}`;
    return hay.toLowerCase().includes(q.toLowerCase());
  };
  const searched = q ? entries.filter(qHit) : entries;
  openModal(`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <button class="icon-btn" id="ps-back">${icon('chevleft', 18)}</button>
      <div style="flex:1;display:flex;align-items:center;gap:6px;font-size:16.5px;font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${icon('folder', 18)} ${escapeHtml(sf.name)}</div>
      <button class="icon-btn" id="ps-close">${icon('close', 18)}</button>
    </div>
    <div class="pal-searchbar" style="margin-bottom:8px;">
      ${icon('search', 15)}
      <input class="input" id="ps-search" placeholder="检索本分类记忆关键词…" value="${escapeHtml(q)}">
      ${q ? `<button class="pal-search-clear" id="ps-search-clear">${icon('close', 13)}</button>` : ''}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px dashed var(--border);border-radius:12px;margin-bottom:8px;">
      <div style="font-size:11.5px;color:var(--text-tertiary);">${palPermTagText(sf, folders)} · ${entries.length} 段记忆</div>
      <button class="wb-act ai" data-pact="folder:${sid}" title="AI 读取权限">${icon('shield', 13)} 权限</button>
    </div>
    <div class="pal-row" data-psmanual="1" style="border-style:dashed;margin-bottom:8px;">
      <div class="pal-ic">${icon('image', 20)}</div>
      <div class="pal-main"><div class="pal-title">新建记忆</div><div class="pal-sub">图片 + 配文，直接存进这个分类</div></div>
    </div>
    ${q ? `<div style="font-size:12px;color:var(--text-tertiary);margin:2px 2px 8px;">检索到 ${searched.length} 段记忆</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:8px;max-height:42vh;overflow-y:auto;" id="ps-list">
      ${searched.map(e => `
        <div class="pal-row${_palBatch.has(e.id) ? ' sel' : ''}" data-eid="${e.id}">
          ${_palBatchMode ? `<input type="checkbox" data-palchk="${e.id}" ${_palBatch.has(e.id) ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--purple);flex-shrink:0;">` : ''}
          <div class="pal-ic">${e.kind === 'chat' ? icon('chatset', 17) : (e.kind === 'letter' ? icon('letter', 17) : (e.kind === 'manual' ? icon('image', 17) : icon('moments', 17)))}</div>
          <div class="pal-main">
            <div class="pal-title">${escapeHtml(palWithPlayerName(e.title || '（无题）'))}</div>
            <div class="pal-sub">${escapeHtml(e.dateLabel)}</div>
          </div>
          <button class="wb-act ai" data-pact="entry:${e.id}" title="AI 读取权限">${icon('shield', 13)} ${palPermTagText(e, folders)}</button>
          <span style="color:var(--text-tertiary);">›</span>
        </div>
      `).join('') || `<div class="empty" style="padding:14px 0;"><div class="empty-icon">${icon('folder', 30)}</div><div>${q ? '没有匹配的记忆' : '这个分类还是空的'}</div></div>`}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn" style="flex:1;white-space:nowrap;padding-left:4px;padding-right:4px;" id="ps-batch">${_palBatchMode ? '退出批量' : '批量管理'}</button>
      ${_palBatchMode ? `
        <button class="btn" style="flex:1;white-space:nowrap;padding-left:4px;padding-right:4px;" id="ps-selall">全选</button>
        <button class="btn" style="flex:1;white-space:nowrap;padding-left:4px;padding-right:4px;" id="ps-move">移动</button>
        <button class="btn danger" style="flex:1;white-space:nowrap;padding-left:4px;padding-right:4px;" id="ps-del">删除</button>
      ` : ''}
    </div>
    ${_palBatchMode ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:6px;" id="ps-batchhint">点任意一行即可勾选/取消（已选 ${_palBatch.size} 项）</div>` : ''}
  `);
  $('#ps-close').onclick = () => showPalaceFolder(fid); // 20260929x：✕ 回上一功能页
  $('#ps-back').onclick = () => showPalaceFolder(fid);
  /* bd：子分类检索（composition 守卫）+ 新建记忆入口 */
  bindPalSearch($('#ps-search'), palDebounce((v) => showPalaceSubFolder(fid, sid, { q: v, keepBatch: _palBatchMode, refocus: true }), 260));
  const psClr = $('#ps-search-clear');
  if (psClr) psClr.onclick = () => showPalaceSubFolder(fid, sid, { keepBatch: _palBatchMode });
  const psManual = document.querySelector('[data-psmanual]');
  if (psManual) psManual.onclick = () => palManualModal(fid, sid);
  if (q && opts.refocus) {
    const si = $('#ps-search');
    if (si) { si.focus(); try { si.setSelectionRange(si.value.length, si.value.length); } catch (e) {} }
  }
  const toggleSel = (id, chk, row) => {
    if (_palBatch.has(id)) _palBatch.delete(id); else _palBatch.add(id);
    if (chk) chk.checked = _palBatch.has(id);
    if (row) row.classList.toggle('sel', _palBatch.has(id));
    const hint = document.getElementById('ps-batchhint');
    if (hint) hint.textContent = `点任意一行即可勾选/取消（已选 ${_palBatch.size} 项）`;
  };
  document.querySelectorAll('[data-palchk]').forEach(chk => {
    chk.onchange = () => { if (chk.checked) _palBatch.add(chk.dataset.palchk); else _palBatch.delete(chk.dataset.palchk); };
  });
  document.querySelectorAll('#ps-list [data-pact]').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      openPalPerm('entry', btn.dataset.pact.split(':')[1], () => showPalaceSubFolder(fid, sid, { keepBatch: _palBatchMode }));
    };
  });
  // 子文件夹自身权限（20260929ah：头部「🛡️ 权限」按钮）
  const sfPermBtn = document.querySelector(`[data-pact="folder:${sid}"]`);
  if (sfPermBtn) {
    sfPermBtn.onclick = (ev) => {
      ev.stopPropagation();
      openPalPerm('folder', sid, () => showPalaceSubFolder(fid, sid, { keepBatch: _palBatchMode }));
    };
  }
  document.querySelectorAll('#ps-list [data-eid]').forEach(row => {
    row.onclick = (ev) => {
      if (ev.target.closest('[data-palchk]') || ev.target.closest('[data-pact]')) return;
      if (_palBatchMode) { toggleSel(row.dataset.eid, row.querySelector('[data-palchk]'), row); return; }
      showPalaceEntry(row.dataset.eid, fid);
    };
  });
  $('#ps-batch').onclick = () => { _palBatchMode = !_palBatchMode; if (!_palBatchMode) _palBatch = new Set(); showPalaceSubFolder(fid, sid, { keepBatch: true }); };
  const selall = $('#ps-selall');
  if (selall) selall.onclick = () => {
    if (_palBatch.size >= entries.length) _palBatch = new Set();
    else entries.forEach(e => _palBatch.add(e.id));
    showPalaceSubFolder(fid, sid, { keepBatch: true });
  };
  const mvBtn = $('#ps-move');
  if (mvBtn) mvBtn.onclick = () => {
    if (!_palBatch.size) { miniToast('请先勾选记忆'); return; }
    palMoveModal([..._palBatch], fid);
  };
  const delBtn = $('#ps-del');
  if (delBtn) delBtn.onclick = () => {
    if (!_palBatch.size) { miniToast('请先勾选'); return; }
    showConfirm(`删除选中的 ${_palBatch.size} 段记忆？此操作无法撤销。`, async () => {
      for (const id of _palBatch) await idbDelete('palace', id);
      _palBatch = new Set();
      miniToast('已删除');
      showPalaceSubFolder(fid, sid, { keepBatch: true });
    });
  };
}

/* 新建子文件夹（玩家 / 访客文件夹内） */
function palNewSubModal(fid) {
  openModal(`
    <div style="font-size:16.5px;font-weight:600;margin-bottom:12px;">新建子文件夹</div>
    <div class="field"><label>名称</label><input class="input" id="pns-name" placeholder="例如：日常 / 纪念日 / 心情" maxlength="12"></div>
    <div class="field" style="display:flex;align-items:center;justify-content:space-between;">
      <label style="margin:0;">允许 AI 读取</label>
      <input type="checkbox" id="pns-allow" style="width:18px;height:18px;accent-color:var(--purple);">
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="pns-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="pns-ok">创建</button>
    </div>
  `);
  $('#pns-cancel').onclick = () => showPalaceFolder(fid);
  $('#pns-ok').onclick = async () => {
    const name = ($('#pns-name').value || '').trim();
    if (!name) { miniToast('请输入名称'); return; }
    const list = await palFolders();
    list.push({ id: uid('pf_sub'), type: 'sub', parentId: fid, name, allowAI: $('#pns-allow').checked, createdAt: Date.now() });
    await palSaveFolders(list);
    miniToast('已创建');
    showPalaceFolder(fid);
  };
}

/* 手动上传记忆（图片 + 配文）
   20260929bd：palManualModal(fid, sid)——传入 sid 时直接存入该子文件夹（不再显示分类下拉），
   保存/取消都回到子文件夹视图 */
function palManualModal(fid, sid) {
  let imgDesc = null;
  openModal(`
    <div style="display:flex;align-items:center;gap:6px;font-size:16.5px;font-weight:600;margin-bottom:12px;">${icon('image', 18)} 上传一条记忆</div>
    <div class="field"><label>配文</label><textarea class="input" id="pm-text" rows="3" placeholder="记录这一刻的心情和故事…"></textarea></div>
    <div class="field"><label>图片（可选，自动压缩存储）</label><input class="input" type="file" id="pm-img" accept="image/*"></div>
    <div id="pm-preview" style="margin-bottom:10px;"></div>
    ${sid ? '' : '<div class="field"><label>存入分类</label><select class="input" id="pm-sub"></select></div>'}
    <div style="font-size:11.5px;color:var(--text-tertiary);margin-bottom:10px;">存到勾选「允许 AI 读取」的分类里才能被 AI 读到；隐藏夹永远只有你自己能看</div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="pm-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="pm-ok">存入宫殿</button>
    </div>
  `);
  const pmBack = () => sid ? showPalaceSubFolder(fid, sid) : showPalaceFolder(fid);
  (async () => {
    if (sid) return;
    const folders = await palFolders();
    const subs = folders.filter(x => x.parentId === PAL_P);
    const sel = $('#pm-sub');
    if (!sel) return;
    sel.innerHTML = `<option value="">${escapeHtml(palPlayerFolderName())}（根部）</option>` + subs.map(sf => `<option value="${sf.id}">${escapeHtml(sf.name)}</option>`).join('');
  })();
  $('#pm-img').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      imgDesc = await compressImage(file, 1280, 0.78, true);
      $('#pm-preview').innerHTML = `<img src="${imgSrc(imgDesc)}" style="max-width:100%;max-height:150px;border-radius:10px;border:1px solid var(--border);">`;
    } catch (err) { miniToast('图片读取失败'); }
  };
  $('#pm-cancel').onclick = pmBack;
  $('#pm-ok').onclick = async () => {
    const text = ($('#pm-text').value || '').trim();
    if (!text && !imgDesc) { miniToast('写点配文或选一张图吧'); return; }
    await palEnsureFolders();
    await palAddManual({ text, img: imgDesc, subFolderId: sid ? sid : ($('#pm-sub') ? $('#pm-sub').value : ''), folderId: sid ? fid : PAL_P });
    miniToast('已存入记忆宫殿');
    pmBack();
  };
}

/* 记忆查看器：对话快照 / 手记 / 朋友圈收藏 */
/* 20260929bd 重设计：3D 实体照片牌组（参考「记忆银河/卡片滑动」）——
   三张卡扇形堆叠（轻微左右旋转 + Z 轴递进 + 缩放错位），点击或左右滑动最前面的卡片：
   当前卡先向手势方向抽离（rotateY/rotateZ/translateZ + 缩小），离开前景立即降层级、
   绕过第二张直接落到最底层；第二/第三张依次向前补位（顺序 [1,2,3] → [2,3,1]，不经过中间层）；
   约 1.24s 重叠动画（power3.inOut / power3.in / power3.out），慢、优雅、有重量感；
   新主卡片出现时高斯模糊背景同步交叉切换。保留全部功能：AI 权限（盾）、移动、删除、查看列表 */
async function showPalaceEntry(eid, backFid, opts = {}) {
  const folders = await palFolders();
  let list = Array.isArray(opts.list) && opts.list.length ? opts.list : null;
  if (!list) {
    list = (await palEntries())
      .filter(e => e.folderId === backFid)
      .sort((a, b) => b.time - a.time);
  }
  let idx = list.findIndex(x => x.id === eid);
  if (idx < 0) { showPalaceFolder(backFid); return; }

  const kindLabelOf = (e) => e.kind === 'chat' ? `对话 ${(e.messages || []).length} 条` : (e.kind === 'letter' ? '信件' : (e.kind === 'manual' ? '手记' : '朋友圈收藏'));

  function entryBody(e) {
    if (e.kind === 'chat') {
      return `<div class="pal-card-snap">${palSnapHtml(e)}</div>`;
    }
    if (e.kind === 'letter' || e.kind === 'manual') {
      return `
        ${e.img ? `<img src="${imgSrc(e.img)}" style="max-width:100%;max-height:240px;border-radius:12px;border:1px solid rgba(196,181,253,.24);display:block;margin-bottom:12px;">` : ''}
        ${e.text ? `<div style="font-size:13.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word;color:rgba(238,232,255,.94);">${escapeHtml(palWithPlayerName(e.text))}</div>` : ''}`;
    }
    return `
      ${e.authorName ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span class="avatar" style="width:26px;height:26px;font-size:13px;overflow:hidden;">${e.authorAvatar ? `<img src="${imgSrc(e.authorAvatar)}" style="width:100%;height:100%;object-fit:cover;">` : escapeHtml((e.authorName || '梦')[0])}</span><span style="font-size:13px;font-weight:600;">${escapeHtml(e.authorName)}</span></div>` : ''}
      ${e.text ? `<div style="font-size:13.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word;color:rgba(238,232,255,.94);">${escapeHtml(palWithPlayerName(e.text))}</div>` : ''}
      ${e.sticker ? `<div style="font-size:30px;margin-top:6px;">${escapeHtml(e.sticker)}</div>` : ''}
      ${(e.images || []).length ? `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">${e.images.map(im => `<img src="${imgSrc(im, true)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid rgba(196,181,253,.24);">`).join('')}</div>` : ''}`;
  }

  function jumpHtml() {
    return `
      <div class="pal-jump" id="pal-jump" style="display:none;">
        <div class="pal-jump-head">
          <div style="font-size:14px;font-weight:600;">全部记忆（${list.length}）</div>
          <button class="icon-btn" id="pal-jump-close">${icon('close', 16)}</button>
        </div>
        <div class="pal-jump-list" id="pal-jump-list">
          ${list.map((e, i) => `
            <div class="pal-jump-row" data-jid="${e.id}">
              <div class="pal-jump-no">${String(i + 1).padStart(2, '0')}</div>
              <div style="flex:1;min-width:0;">
                <div class="pal-jump-title">${escapeHtml(palWithPlayerName(e.title || '（无题）'))}</div>
                <div class="pal-jump-sub">${escapeHtml(e.dateLabel || '')} · ${kindLabelOf(e)}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  /* —— 牌组状态：cards[k] = 第 k 层卡 DOM（0 = 前景）；卡常驻 DOM，只循环换内容 —— */
  const n = list.length;
  const backSlot = Math.min(2, n - 1);
  const SLOT = [
    { t: 'translate(-50%,-50%) translate3d(0px,0px,0px) rotateZ(0deg) scale(1)', f: 'brightness(1)', z: 30 },
    { t: 'translate(-50%,-50%) translate3d(-16px,26px,-70px) rotateZ(-4.5deg) scale(.945)', f: 'brightness(.8)', z: 20 },
    { t: 'translate(-50%,-50%) translate3d(14px,50px,-140px) rotateZ(3.8deg) scale(.89)', f: 'brightness(.62)', z: 10 },
  ];
  const E_INOUT = 'cubic-bezier(.65,.05,.36,1)';  // power3.inOut
  const E_IN = 'cubic-bezier(.55,.06,.68,.19)';   // power3.in
  const E_OUT = 'cubic-bezier(.215,.61,.355,1)';  // power3.out
  let cards = [];
  let busy = false;
  let _anims = [];
  let bgCur = 0;

  function entryBgImg(e) {
    if (e.img) return e.img;
    if (Array.isArray(e.images) && e.images.length) return e.images[0];
    return null;
  }

  function cardHtml(e) {
    const isPlayerSide = e.folderId === PAL_P || e.folderId === PAL_H;
    const allow = palEntryAllow(e, folders);
    const kindIcon = e.kind === 'chat' ? icon('chatset', 13) : (e.kind === 'letter' ? icon('letter', 13) : (e.kind === 'manual' ? icon('image', 13) : icon('moments', 13)));
    return `
      <div class="pal-dc-top">
        <span class="pal-dc-date">${escapeHtml(e.dateLabel || '')}</span>
        <span class="pal-dc-kind">${kindIcon} ${kindLabelOf(e)}</span>
      </div>
      <div class="pal-dc-title">${escapeHtml(palWithPlayerName(e.title || '（无题）'))}</div>
      ${e.kind === 'chat' ? `<div class="pal-dc-sum">摘要：${escapeHtml(palWithPlayerName(e.summary || e.title || ''))}</div>` : ''}
      <div class="pal-dc-body">${entryBody(e)}</div>
      <div class="pal-dc-foot">
        ${e.folderId === PAL_H ? '' : `<button class="pal-card-chip" data-cact="perm" title="点击设置 AI 读取权限">${icon('shield', 13)} ${palPermTagText(e, folders)}</button>`}
        <button class="pal-card-chip" data-cact="move">移动到…</button>
        <button class="pal-card-chip danger" data-cact="del">删除</button>
      </div>`;
  }

  function bindCardActions(el) {
    el.querySelectorAll('[data-cact]').forEach(btn => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        const act = btn.dataset.cact;
        const e = list.find(x => x.id === el._eid);
        if (!e) return;
        if (act === 'perm') {
          openPalPerm('entry', e.id, () => { const ne = list.find(x => x.id === e.id); if (ne) setCardContent(el, ne); });
        } else if (act === 'move') {
          palMoveModal([e.id], backFid);
        } else if (act === 'del') {
          showConfirm('删除这段记忆？此操作无法撤销。', async () => {
            await idbDelete('palace', e.id);
            const di = list.findIndex(x => x.id === e.id);
            if (di >= 0) list.splice(di, 1);
            if (!list.length) { miniToast('已删除'); showPalaceFolder(backFid); return; }
            idx = Math.min(idx, list.length - 1);
            miniToast('已删除');
            rebuildDeck();
          });
        }
      };
    });
  }

  function setCardContent(el, e) {
    el._eid = e.id;
    el.innerHTML = cardHtml(e);
    bindCardActions(el);
  }

  function applySlot(el, k) {
    const s = SLOT[Math.min(k, 2)];
    el.style.transform = s.t;
    el.style.filter = s.f;
    el.style.zIndex = s.z;
    el.classList.toggle('front', k === 0);
  }

  /* 高斯模糊背景：前景是图片记忆时展示其模糊放大图，两层交叉淡化 */
  function setDeckBg(e) {
    const wrap = $('#pal-deck-bg');
    if (!wrap) return;
    const imgs = wrap.querySelectorAll('img');
    if (!imgs || imgs.length < 2) return;
    const im = entryBgImg(e);
    if (!im) { imgs[0].style.opacity = '0'; imgs[1].style.opacity = '0'; return; }
    const nxt = imgs[1 - bgCur];
    const cur = imgs[bgCur];
    const url = imgSrc(im, true);
    nxt.onload = () => {
      nxt.style.opacity = '.55';
      cur.style.opacity = '0';
      bgCur = 1 - bgCur;
    };
    if (nxt.src === url && nxt.complete) { try { nxt.onload(); } catch (err) {} }
    else nxt.src = url;
  }

  function updateHud() {
    const c = $('#pal-deck-count');
    if (c) c.textContent = `${idx + 1} / ${n}`;
  }

  function rebuildDeck() {
    const deck = $('#pal-deck');
    if (!deck) return;
    _anims.forEach(a => { try { a.cancel(); } catch (e) {} });
    _anims = [];
    busy = false;
    deck.innerHTML = '';
    cards = [];
    const layers = Math.min(3, n);
    for (let k = 0; k < layers; k++) {
      const el = document.createElement('div');
      el.className = 'pal-dcard';
      setCardContent(el, list[(idx + k) % n]);
      el.addEventListener('pointerdown', onDown);
      deck.appendChild(el);
      cards.push(el);
      applySlot(el, k);
    }
    updateHud();
    setDeckBg(list[idx]);
  }

  /* 抽出 → 补位：总时长约 1.24s，三张卡重叠运动 */
  function advance(dir, dragState) {
    if (busy || n < 2) return;
    busy = true;
    const E0 = cards[0], E1 = cards[1] || null, E2 = cards[2] || null;
    const exitX = dir * Math.max(300, window.innerWidth * 0.6);
    const fromT = (dragState && dragState.fromT) || SLOT[0].t;
    const landT = SLOT[backSlot].t, landF = SLOT[backSlot].f;
    // 1) 前景抽离：向手势方向抽出（rotateY/rotateZ/translateZ + 缩小），power3.in
    const a0 = E0.animate([
      { transform: fromT, filter: 'brightness(1)' },
      { transform: `translate(-50%,-50%) translate3d(${exitX * 0.5}px,-22px,-60px) rotateZ(${dir * 8}deg) rotateY(${-dir * 24}deg) scale(.85)`, filter: 'brightness(.9)', offset: 0.42 },
      { transform: `translate(-50%,-50%) translate3d(${exitX}px,14px,-110px) rotateZ(${dir * 12}deg) rotateY(${-dir * 32}deg) scale(.78)`, filter: 'brightness(.78)' },
    ], { duration: 560, easing: E_IN, fill: 'forwards' });
    _anims = [a0];
    // 离开前景立即降层级：绕过第二张，直接落到最底层
    setTimeout(() => { E0.style.zIndex = '5'; }, 170);
    // 2) 第二张 → 前景；3) 第三张 → 第二层（重叠进行，power3.inOut）
    if (E1) {
      setTimeout(() => { E1.style.zIndex = '30'; }, 250);
      _anims.push(E1.animate([
        { transform: SLOT[1].t, filter: SLOT[1].f },
        { transform: SLOT[0].t, filter: SLOT[0].f },
      ], { duration: 820, delay: 250, easing: E_INOUT, fill: 'forwards' }));
    }
    if (E2) {
      setTimeout(() => { E2.style.zIndex = '20'; }, 380);
      _anims.push(E2.animate([
        { transform: SLOT[2].t, filter: SLOT[2].f },
        { transform: SLOT[1].t, filter: SLOT[1].f },
      ], { duration: 780, delay: 380, easing: E_INOUT, fill: 'forwards' }));
    }
    // 4) 抽出的卡越过第二张后，从抽离位直接落到最底层（power3.out；n≥3 时换上它该显示的内容）
    setTimeout(() => {
      if (n >= 3) setCardContent(E0, list[(idx + 3) % n]);
      const a0b = E0.animate([
        { transform: `translate(-50%,-50%) translate3d(${exitX}px,14px,-110px) rotateZ(${dir * 12}deg) rotateY(${-dir * 32}deg) scale(.78)`, filter: 'brightness(.78)' },
        { transform: landT, filter: landF },
      ], { duration: 660, easing: E_OUT, fill: 'forwards' });
      _anims.push(a0b);
    }, 560);
    // 收尾：顺序 [1,2,3] → [2,3,1]；前景切换，模糊背景同步交叉淡化
    setTimeout(() => {
      idx = (idx + 1) % n;
      cards = cards.slice(1).concat(cards.slice(0, 1));
      _anims.forEach(a => { try { a.cancel(); } catch (e) {} });
      _anims = [];
      cards.forEach((el, k) => applySlot(el, Math.min(k, n - 1)));
      busy = false;
      updateHud();
      setDeckBg(list[idx]);
    }, 1240);
  }

  /* 拖拽跟手：松手过阈值/快甩 = 向手势方向抽出；轻点 = 抽出下一张；未过阈值弹回 */
  let drag = null;
  function onDown(ev) {
    const el = ev.currentTarget;
    if (busy || n < 2 || el !== cards[0]) return;
    if (ev.target.closest('[data-cact]')) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, t: Date.now(), moved: false, el };
    try { el.setPointerCapture(ev.pointerId); } catch (e) {}
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }
  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const el = drag.el;
    drag.dx = ev.clientX - drag.x;
    drag.dy = ev.clientY - drag.y;
    if (Math.abs(drag.dx) > 6 || Math.abs(drag.dy) > 6) drag.moved = true;
    const lead = Math.min(1, Math.abs(drag.dx) / 240);
    el.style.transform = `translate(-50%,-50%) translate3d(${drag.dx}px,${drag.dy * 0.3}px,${-lead * 46}px) rotateZ(${drag.dx * 0.05}deg) rotateY(${-drag.dx * 0.14}deg) scale(${1 - lead * 0.07})`;
  }
  function onUp(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const el = drag.el;
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    const d = drag; drag = null;
    if (!d || el !== cards[0]) return;
    const speed = Math.abs(d.dx) / Math.max(1, Date.now() - d.t);
    if (!d.moved || (Math.abs(d.dx) < 56 && speed < 0.45)) {
      if (!d.moved) { advance(1); return; } // 点按 = 抽出下一张
      busy = true; // 未过阈值：轻弹回前景
      const a = el.animate([
        { transform: el.style.transform || SLOT[0].t, filter: 'brightness(1)' },
        { transform: SLOT[0].t, filter: SLOT[0].f },
      ], { duration: 300, easing: 'cubic-bezier(.3,.9,.4,1)', fill: 'forwards' });
      a.onfinish = () => { try { a.cancel(); } catch (e) {} applySlot(el, 0); busy = false; };
      return;
    }
    advance(d.dx > 0 ? 1 : -1, { fromT: el.style.transform });
  }

  openModal(`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
        <button class="icon-btn" id="pc-back">${icon('chevleft', 18)}</button>
        <div style="flex:1;text-align:center;">
          <div style="font-size:15px;font-weight:600;letter-spacing:1px;">记忆宫殿</div>
          <div style="font-size:10.5px;color:rgba(213,200,255,.55);font-style:italic;margin-top:1px;">every memory, a little starlight</div>
        </div>
        <button class="icon-btn" id="pc-list" title="查看列表">${icon('listview', 17)}</button>
        <button class="icon-btn" id="pc-close">${icon('close', 18)}</button>
      </div>
      <div class="pal-deck-stage">
        <div class="pal-deck-bg" id="pal-deck-bg"><img alt=""><img alt=""></div>
        <div class="pal-deck" id="pal-deck"></div>
      </div>
      <div class="pal-deck-hud">
        <button class="pal-card-arrow" id="pc-prev" ${n < 2 ? 'disabled' : ''}>${icon('chevleft', 16)}</button>
        <div class="pal-card-count" id="pal-deck-count"></div>
        <button class="pal-card-arrow" id="pc-next" ${n < 2 ? 'disabled' : ''}>${icon('chevright', 16)}</button>
      </div>
      <div class="pal-deck-hint">左右滑动 · 点按抽出这张卡片</div>
      ${jumpHtml()}
    `, { galaxy: true });

  $('#pc-close').onclick = () => showPalaceFolder(backFid);
  $('#pc-back').onclick = () => showPalaceFolder(backFid);
  $('#pc-prev').onclick = () => advance(-1);
  $('#pc-next').onclick = () => advance(1);
  // 列表浮层（右上角「查看列表」）：竖长可滚动，直接点选某条记忆
  const jump = $('#pal-jump');
  $('#pc-list').onclick = () => {
    jump.style.display = 'flex';
    jump.querySelectorAll('.pal-jump-row').forEach(r => r.classList.toggle('cur', list.findIndex(x => x.id === r.dataset.jid) === idx));
    const cur = jump.querySelector('.pal-jump-row.cur');
    if (cur) cur.scrollIntoView({ block: 'center' });
  };
  $('#pal-jump-close').onclick = () => { jump.style.display = 'none'; };
  jump.querySelectorAll('.pal-jump-row').forEach(row => {
    row.onclick = () => {
      const ni = list.findIndex(x => x.id === row.dataset.jid);
      if (ni >= 0) { idx = ni; rebuildDeck(); }
      jump.style.display = 'none';
    };
  });
  rebuildDeck();
}

/* 对话快照迷你气泡 */
function palSnapHtml(e) {
  return (e.messages || []).map(s => {
    const me = s.from === 'me';
    let body;
    if ((s.type === 'image' || s.type === 'emoji') && s.content) body = `<img src="${imgSrc(s.content)}" style="max-width:160px;max-height:160px;border-radius:10px;display:block;">`;
    else body = escapeHtml(s.content);
    return `<div class="pal-bubble-row ${me ? 'me' : ''}">
      <div class="pal-ava">${escapeHtml(palWithPlayerName(s.name || '?')[0])}</div>
      <div style="min-width:0;max-width:78%;">
        <div style="font-size:10.5px;color:var(--text-tertiary);margin-bottom:2px;">${escapeHtml(palWithPlayerName(s.name || ''))}</div>
        <div class="pal-bubble">${body}</div>
      </div>
    </div>`;
  }).join('');
}

/* 移动记忆到其他文件夹（细则八-4） */
function palMoveModal(ids, backFid) {
  (async () => {
    const folders = await palFolders();
    const charFs = folders.filter(f => f.type === 'char');
    const playerSubs = folders.filter(f => f.parentId === PAL_P);
    const row = (label, sub, fn, ic) => `
      <div class="pal-row" data-mv="1">
        <div class="pal-ic">${ic}</div>
        <div class="pal-main"><div class="pal-title">${escapeHtml(label)}</div><div class="pal-sub">${escapeHtml(sub)}</div></div>
      </div>`;
    openModal(`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <button class="icon-btn" id="pmv-back">‹</button>
        <div style="flex:1;font-size:16px;font-weight:600;">移动 ${ids.length} 段记忆到…</div>
        <button class="icon-btn" id="pmv-close">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto;" id="pmv-list">
        ${row(palPlayerFolderName(), '根部 · AI 默认不可读', null, icon('user', 18))}
        ${playerSubs.map(sf => row(sf.name, '玩家分类 · ' + (sf.allowAI ? 'AI 可读' : 'AI 不可读'), null, icon('folder', 18))).join('')}
        ${row('隐藏夹', '绝对不给 AI 读取', null, icon('lock', 18))}
        ${charFs.map(f => row(f.name, (f.allowAI ? 'AI 默认可读' : 'AI 不可读'), null, f.charAvatar ? `<img src="${imgSrc(f.charAvatar, true)}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;">` : icon('user', 18))).join('')}
      </div>
    `);
    $('#pmv-back').onclick = () => showPalaceFolder(backFid);
    $('#pmv-close').onclick = () => showPalaceFolder(backFid); // 20260929x：✕ 同样回上一功能页
    const rows = document.querySelectorAll('#pmv-list .pal-row');
    const targets = [
      { fid: PAL_P, sub: '' },
      ...playerSubs.map(sf => ({ fid: PAL_P, sub: sf.id })),
      { fid: PAL_H, sub: '' },
      ...charFs.map(f => ({ fid: f.id, sub: '' })),
    ];
    rows.forEach((r, i) => {
      r.onclick = async () => {
        const t = targets[i];
        if (!t) return;
        const all = await palEntries();
        for (const id of ids) {
          const e = all.find(x => x.id === id);
          if (e) { e.folderId = t.fid; e.subFolderId = t.sub; await idbPut('palace', e); }
        }
        miniToast('已移动');
        showPalaceFolder(backFid);
      };
    });
  })();
}

/* ---------- AI 权限弹窗（20260929x）：每条记忆 / 每个文件夹行尾 🛡️ 打开 ----------
   支持三种授权：全部角色 / 指定访客（allowCharIds）/ 关闭；隐藏夹不可改（绝对不给 AI） */
async function openPalPerm(kind, id, back) {
  const folders = await palFolders();
  let name = '', isHiddenChain = false, isCharFolder = false, isCharEntry = false, charName = '';
  let allowAll = false, list = [], isEntry = false, followVal = null, hiddenEntry = false;
  if (kind === 'folder') {
    const f = folders.find(x => x.id === id);
    if (!f) { back(); return; }
    if (f.type === 'hidden' || f.parentId === PAL_H) { miniToast('🔒 隐藏夹绝对不给 AI 读取，无法修改'); return; }
    name = f.name || '文件夹';
    isCharFolder = f.type === 'char';
    charName = f.charName || '';
    allowAll = !!f.allowAI && !(Array.isArray(f.allowCharIds) && f.allowCharIds.length);
    list = Array.isArray(f.allowCharIds) ? f.allowCharIds.slice() : [];
    if (isCharFolder) { list = []; allowAll = !!f.allowAI; } // 20260929al：访客文件夹只对本人 AI 开/关，无指定他人
  } else {
    isEntry = true;
    const e = (await palEntries()).find(x => x.id === id);
    if (!e) { back(); return; }
    const f0 = folders.find(x => x.id === e.folderId);
    // 20260929bn：隐藏夹条目不再允许授权（入口已去盾牌图标，此处兜底拦截，防误触卡死）
    if (f0 && (f0.type === 'hidden' || f0.parentId === PAL_H)) { miniToast('🔒 隐藏夹绝对不给 AI 读取，无法修改'); return; }
    // 20260929be：隐藏夹条目也允许单条授权（文件夹级仍然绝对禁读；单条显式授权可破例）
    const fromHidden = !!(f0 && (f0.type === 'hidden' || f0.parentId === PAL_H));
    name = e.title || '（无题）';
    followVal = e.allowAI; // null = 跟随文件夹
    list = Array.isArray(e.allowCharIds) ? e.allowCharIds.slice() : [];
    allowAll = e.allowAI === true && !list.length;
    // 20260929al：访客文件夹里的单条记忆——只能给"角色本人"的 AI 开/关，
    // 不能设置给其他访客（读取侧 getPalaceAIContext 本就隔离，这里把设置界面也锁住）
    if (f0 && f0.type === 'char') {
      isCharEntry = true;
      charName = f0.charName || '';
      list = [];
      allowAll = e.allowAI === true;
    }
    hiddenEntry = fromHidden && !isCharEntry;
  }
  const renderChips = () => {
    const box = document.getElementById('pp-chips');
    if (!box) return;
    box.innerHTML = characters.length ? characters.map(c => {
      const on = list.includes(c.id);
      return `<span class="badge pp-chip${on ? ' on' : ''}" data-pcid="${c.id}" style="cursor:pointer;${on ? 'background:var(--purple);color:#141019;' : ''}">${escapeHtml(c.name || 'TA')}</span>`;
    }).join('') : '<span style="font-size:12px;color:var(--text-tertiary);">还没有访客</span>';
    box.querySelectorAll('.pp-chip').forEach(chip => {
      chip.onclick = () => {
        const cid = chip.dataset.pcid;
        if (list.includes(cid)) list = list.filter(x => x !== cid);
        else list.push(cid);
        if (list.length) { allowAll = false; const ac = document.getElementById('pp-all'); if (ac) ac.checked = false; }
        renderChips();
      };
    });
  };
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="font-size:17px;font-weight:600;">🛡️ AI 读取权限</div>
      <button class="icon-btn" id="pp-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:12px;word-break:break-all;">${isEntry ? '这条记忆' : '这个文件夹'}：${escapeHtml(name)}</div>
    ${hiddenEntry ? `<div style="font-size:11.5px;color:var(--purple-soft);margin:-4px 0 12px;">该记忆在隐藏夹（默认绝密）。单条显式授权后，仅这一条会对 AI 放行；隐藏夹整体仍然不可读。</div>` : ''}
    ${(isCharFolder || isCharEntry) ? `
      <div class="field" style="display:flex;align-items:center;justify-content:space-between;">
        <label style="margin:0;">允许 AI 读取${isCharFolder ? '本文件夹' : '这条记忆'}<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">只有 AI 扮演「${escapeHtml(charName || 'TA')}」本人时会读，其他访客绝对读不到（访客记忆不能授权给别的访客）</div></label>
        <input type="checkbox" id="pp-all" ${allowAll ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </div>
    ` : `
      <div class="field" style="display:flex;align-items:center;justify-content:space-between;">
        <label style="margin:0;">允许<b>所有访客</b>的 AI 读取</label>
        <input type="checkbox" id="pp-all" ${allowAll ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
      </div>
      <div class="field">
        <label>或只授权给指定访客（点选，可多选；选了指定访客则以指定为准）</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;" id="pp-chips"></div>
      </div>
      ${isEntry ? `<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:10px;"><span style="color:var(--purple-soft);cursor:pointer;" id="pp-follow">↺ 清除单条设置，恢复跟随文件夹（当前${followVal === null ? '就是跟随' : '：' + (followVal ? '可读' : '不可读')}）</span></div>` : ''}
    `}
    <div style="font-size:11.5px;color:var(--text-tertiary);margin-bottom:12px;">隐藏夹永远不可读；AI 总开关在记忆宫殿主页；AI 扮演某访客时只能读 TA 自己的访客文件夹 + 玩家侧放行内容</div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="pp-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="pp-save">保存</button>
    </div>
  `);
  $('#pp-close').onclick = back;
  $('#pp-cancel').onclick = back;
  renderChips();
  const allChk = $('#pp-all');
  if (allChk) allChk.onchange = () => {
    allowAll = allChk.checked;
    if (allowAll) { list = []; renderChips(); }
  };
  const followLink = $('#pp-follow');
  if (followLink) followLink.onclick = () => { back(); (async () => {
    const cur = (await palEntries()).find(x => x.id === id);
    if (cur) { cur.allowAI = null; cur.allowCharIds = []; await idbPut('palace', cur); miniToast('已恢复跟随文件夹'); }
  })(); };
  $('#pp-save').onclick = async () => {
    if (kind === 'folder') {
      const fl = await palFolders();
      const me = fl.find(x => x.id === id);
      if (me) {
        if (isCharFolder) { me.allowAI = allowAll; me.allowCharIds = []; } // 访客文件夹：只对本人开/关
        else { me.allowAI = allowAll || list.length > 0; me.allowCharIds = list; } // 20260929be：指定访客时也标记可读（读取侧 allowCharIds 优先）
        await palSaveFolders(fl);
      }
      miniToast(list.length ? `已授权给 ${list.length} 个指定访客` : (allowAll ? '已允许所有访客 AI 读取' : '已禁止 AI 读取'));
    } else {
      const cur = (await palEntries()).find(x => x.id === id);
      if (cur) {
        if (isCharEntry) { cur.allowAI = allowAll; cur.allowCharIds = []; } // 访客文件夹内条目：只对本人开/关
        else { cur.allowAI = allowAll; cur.allowCharIds = list; }
        await idbPut('palace', cur);
      }
      miniToast(list.length ? `已授权给 ${list.length} 个指定访客` : (allowAll ? '所有访客 AI 可读取这条记忆' : 'AI 不可读取这条记忆'));
    }
    back();
  };
}

/* ---------- 记忆宫殿导出（20260929x：.palacedata，可选角色/玩家文件夹） ---------- */
async function showExportPalaceModal(back = null) {
  const backFn = () => back ? back() : closeModal();
  await palEnsureFolders();
  const folders = await palFolders();
  const entries = await palEntries();
  if (!entries.length) { miniToast('记忆宫殿还是空的，没有可导出的记忆'); return; }
  const playerSubs = folders.filter(f => f.parentId === PAL_P);
  const charFs = folders.filter(f => f.type === 'char');
  const picked = new Set();
  const cnt = (fid) => entries.filter(e => e.folderId === fid).length;
  const chip = (id, label) => `<span class="badge pal-exp-chip" data-pfid="${id}" style="cursor:pointer;${picked.has(id) ? 'background:var(--purple);color:#141019;' : ''}">${label}（${cnt(id)}）</span>`;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;">导出记忆宫殿</div>
      <button class="icon-btn" id="pex-close">✕</button>
    </div>
    <button class="btn primary block" id="pex-all" style="margin-bottom:14px;">📦 全部导出（共 ${entries.length} 段记忆）</button>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:8px;">或点选要导出的文件夹（可多选）：</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;" id="pex-chips">
      ${chip(PAL_P, '👤 ' + palPlayerFolderName() + '（根部）')}
      ${playerSubs.map(sf => chip(sf.id, '📁 ' + escapeHtml(sf.name))).join('')}
      ${charFs.map(f => chip(f.id, '🧑 ' + escapeHtml(f.charName || f.name))).join('')}
      ${chip(PAL_H, '🔒 隐藏夹')}
    </div>
    <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px;" id="pex-count">已选 0 个文件夹</div>
    <button class="btn block" id="pex-go" disabled style="opacity:.5;">⬇ 导出所选文件夹的记忆</button>
    <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:10px;">文件夹结构一并导出；图片打包成 base64 内嵌，网页端 / App 端格式通用</div>
  `);
  $('#pex-close').onclick = backFn;
  const refresh = () => {
    const n = picked.size;
    const go = $('#pex-go');
    if (!go) return;
    go.disabled = n === 0;
    go.style.opacity = n === 0 ? '.5' : '1';
    $('#pex-count').textContent = `已选 ${n} 个文件夹`;
  };
  document.querySelectorAll('.pal-exp-chip').forEach(c => {
    c.onclick = () => {
      const fid = c.dataset.pfid;
      if (picked.has(fid)) { picked.delete(fid); c.style.background = ''; c.style.color = ''; }
      else { picked.add(fid); c.style.background = 'var(--purple)'; c.style.color = '#141019'; }
      refresh();
    };
  });
  $('#pex-all').onclick = async () => { backFn(); await exportPalaceData(null); };
  $('#pex-go').onclick = async () => {
    if (!picked.size) { miniToast('先选至少一个文件夹'); return; }
    const ids = [...picked];
    backFn();
    await exportPalaceData(ids);
  };
}

async function exportPalaceData(folderIds = null) {
  let save = null;
  try {
    await palEnsureFolders();
    const folders = await palFolders();
    const entries = await palEntries();
    const scoped = Array.isArray(folderIds) && folderIds.length > 0;
    const selEntries = scoped ? entries.filter(e => folderIds.includes(e.folderId)) : entries;
    if (!selEntries.length) { miniToast('所选范围内没有记忆'); return; }
    // 结构：选中的文件夹定义 + 两个固定容器壳（导入端靠它们定位玩家/隐藏归属）
    const selFolders = folders.filter(f => !scoped || folderIds.includes(f.id) || f.id === PAL_P || f.id === PAL_H);
    save = await beginExport('白日梦记忆宫殿备份.palacedata');
    if (save.cancelled) return;
    exportProgress(true, '⬇️ 正在打包宫殿图片…');
    const data = {
      app: 'bairimeng',
      format: 'palacedata',
      version: '1.0',
      exportDate: new Date().toISOString(),
      count: selEntries.length,
      folders: selFolders,
      entries: selEntries,
      settings: await palSettings(),
    };
    await deepImagesToExport(data, '正在打包宫殿图片');
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    await finishExport(save, blob, `已导出记忆宫殿（${selEntries.length} 段记忆）`);
  } catch (e) {
    exportProgress(false);
    miniToast('导出失败：' + (e && e.message ? e.message : '未知错误'));
  }
}

/* ---------- 记忆宫殿导入（20260929x：自动分辨文件夹归属，按 ID 合并去重） ----------
   归属规则：访客文件夹按 charId → 访客名 匹配现有角色，没有就新建同名访客文件夹；
   玩家子文件夹按 id → 名称 匹配，没有就新建；隐藏夹归隐藏夹；
   认不出归属的条目一律放进「玩家的记忆」根部且 AI 默认不可读（安全兜底） */
function showImportPalaceModal(back = null) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:600;">导入记忆宫殿</div>
      <button class="icon-btn" id="pim-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">选择之前导出的「白日梦记忆宫殿备份.palacedata」文件。按 ID 合并去重（已有记忆不重复），系统会自动分辨每条记忆的归属并放入对应文件夹，不影响现有数据。</div>
    <div class="field">
      <label>选择文件</label>
      <input class="input" type="file" id="pim-file" accept=".palacedata,.json,application/json,application/octet-stream,text/plain">
    </div>
    <button class="btn primary block" style="margin-top:14px;" id="pim-go">导入</button>
  `);
  $('#pim-close').onclick = () => back ? back() : closeModal();
  $('#pim-go').onclick = async () => {
    const f = $('#pim-file').files[0];
    if (!f) { miniToast('请先选择文件'); return; }
    try {
      const raw = JSON.parse(await f.text());
      const rawEntries = Array.isArray(raw.entries) ? raw.entries : null;
      if (!rawEntries) { miniToast('文件里没有记忆宫殿数据'); return; }
      const go = $('#pim-go');
      if (!go.dataset.confirm) {
        go.dataset.confirm = '1';
        go.textContent = `确认导入（${rawEntries.length} 段记忆，自动分辨归属合并）`;
        setTimeout(() => { if (go.isConnected) { go.dataset.confirm = ''; go.textContent = '导入'; } }, 4000);
        return;
      }
      exportProgress(true, '⬇️ 正在还原宫殿图片…');
      const data = await deepImagesFromExport(raw); // {__img} base64 → Blob 描述符（返回新树，需重新取 entries）
      exportProgress(false);
      const entries = Array.isArray(data.entries) ? data.entries : rawEntries;
      await palEnsureFolders();
      const curFolders = await palFolders();
      const map = {}; // 旧文件夹 id → 现有文件夹 id
      for (const fo of (Array.isArray(data.folders) ? data.folders : [])) {
        if (!fo || !fo.id) continue;
        if (fo.id === PAL_P) { map[fo.id] = PAL_P; continue; }
        if (fo.id === PAL_H || fo.type === 'hidden' || fo.parentId === PAL_H) { map[fo.id] = PAL_H; continue; }
        if (fo.type === 'char' || String(fo.id).startsWith('pf_char_')) {
          let target = null;
          if (fo.charId) target = curFolders.find(x => x.type === 'char' && x.charId === fo.charId);
          if (!target && fo.charName) target = curFolders.find(x => x.type === 'char' && x.charName === fo.charName);
          if (!target) {
            target = { id: 'pf_char_' + uid('imp'), type: 'char', charId: fo.charId || '', name: fo.name || ((fo.charName || 'TA') + '的记忆'), charName: fo.charName || '', charAvatar: fo.charAvatar || '', allowAI: fo.allowAI !== false, createdAt: Date.now() };
            curFolders.push(target);
          }
          map[fo.id] = target.id;
        } else {
          // 玩家子文件夹 / 其他分类夹：先按 id，再按名称（同一父级下）
          let target = curFolders.find(x => x.id === fo.id);
          if (!target && fo.name) target = curFolders.find(x => x.parentId === PAL_P && x.name === fo.name);
          if (!target) {
            target = { id: uid('pf_sub'), type: 'sub', parentId: PAL_P, name: fo.name || '导入的分类', allowAI: !!fo.allowAI, allowCharIds: Array.isArray(fo.allowCharIds) ? fo.allowCharIds.slice() : [], createdAt: Date.now() };
            curFolders.push(target);
          }
          map[fo.id] = target.id;
        }
      }
      await palSaveFolders(curFolders);
      const existingIds = new Set((await palEntries()).map(e => e.id));
      let added = 0, merged = 0, fallback = 0;
      for (const e of entries) {
        if (!e || !e.id) continue;
        if (existingIds.has(e.id)) { merged++; continue; }
        const newFid = map[e.folderId] || PAL_P;
        if (!map[e.folderId]) { fallback++; e.allowAI = false; e.allowCharIds = []; } // 认不出归属：玩家根部 + AI 不可读
        if (e.subFolderId && !map[e.subFolderId]) e.subFolderId = '';
        e.folderId = newFid;
        await idbPut('palace', e);
        existingIds.add(e.id);
        added++;
      }
      miniToast(`记忆宫殿导入完成：新增 ${added} 段${fallback ? `（${fallback} 段归属不明，已放入玩家根部且 AI 不可读）` : ''}${merged ? `，合并去重 ${merged} 段` : ''}`);
      if (back) back(); else closeModal();
    } catch (e) {
      exportProgress(false);
      miniToast('导入失败：' + (e && e.message ? e.message : '文件格式不对'));
    }
  };
}

/* 朋友圈心跳：访客随机发帖 + 互动补算 + 红点（45 秒一次） */
function startMomentsTick() {
  const tick = async () => {
    try {
      const arrived = await checkCharMomentPosts();
      await runPendingInteractions();
      palMomentAutoCollectMaybe(); // 20260929ah：字卡模式朋友圈低概率随机收藏（AI 模式由 AI 决定）
      updateMomentsBadge();
      if (arrived.length && document.body.dataset.view === 'moments') renderMoments();
    } catch (e) {}
  };
  tick();
  setInterval(tick, 45000);
}

/* ==================== 加号细分功能：占卜（韦特塔罗） / 记事簿 / 书信 ==================== */

/* 韦特塔罗 78 张（大阿卡纳 22 + 小阿卡纳 56），正逆位牌意简述。
   n=牌名 sym=牌面符号 up=正位 rev=逆位 */
const TAROT_DECK = [
  { n: '愚者', sym: '🃏', up: '新的开始、自由与冒险，一切皆有可能', rev: '鲁莽行事、缺乏计划，需三思而后行' },
  { n: '魔术师', sym: '🪄', up: '行动力与创造，资源齐备、正当其时', rev: '能力误用、言不由衷，小心被误导' },
  { n: '女祭司', sym: '🌙', up: '直觉与内在智慧，静心倾听心声', rev: '有话未被说出口，忽视了直觉的提醒' },
  { n: '女皇', sym: '🌷', up: '丰饶与滋养，爱意充盈、有所收获', rev: '过度保护或依赖，创造力受阻' },
  { n: '皇帝', sym: '👑', up: '稳定与掌控，权威树立、格局稳固', rev: '固执僵化、控制欲过强' },
  { n: '教皇', sym: '⚜️', up: '传统与指引，寻求智者或体系的支持', rev: '跳出教条，按自己的方式行事' },
  { n: '恋人', sym: '💞', up: '爱与结合，重要的选择将带来契合', rev: '失衡与分歧，警惕诱惑或价值观冲突' },
  { n: '战车', sym: '🏛️', up: '意志与胜利，目标明确、一往无前', rev: '方向不明、节奏失控，需要收束' },
  { n: '力量', sym: '🦁', up: '以温柔驾驭强烈，内在力量充足', rev: '自我怀疑，或被情绪欲望牵着走' },
  { n: '隐士', sym: '🏮', up: '内省与寻求真理，独处自有答案', rev: '过度孤立、逃避人群与问题' },
  { n: '命运之轮', sym: '🎡', up: '转机降临，命运之流正向你敞开', rev: '时运暂滞，抗拒变化不如顺势调整' },
  { n: '正义', sym: '⚖️', up: '公正与因果，权衡清晰、抉择正当', rev: '有所偏颇，逃避应承担的责任' },
  { n: '倒吊人', sym: '🙃', up: '换位思考，暂时的悬置带来洞见', rev: '无谓的牺牲、原地打转' },
  { n: '死神', sym: '🦋', up: '结束即是重生，蜕变正在发生', rev: '抗拒落幕，旧事拖住新章' },
  { n: '节制', sym: '🏺', up: '调和与平衡，耐心酿造恰到好处', rev: '走向极端、失去节奏感' },
  { n: '恶魔', sym: '⛓️', up: '直面欲望与束缚，看清链条所在', rev: '挣脱羁绊，从沉溺中觉醒' },
  { n: '塔', sym: '🗼', up: '骤变与崩塌，摧毁的是不再适用的', rev: '灾变被延迟或逃避，根基仍需检视' },
  { n: '星星', sym: '⭐', up: '希望与治愈，灵感在暗夜里发亮', rev: '信心动摇、期望落空，别急着放弃' },
  { n: '月亮', sym: '🌕', up: '潜意识与迷雾，不安需要被照亮', rev: '迷雾渐散，真相开始浮现' },
  { n: '太阳', sym: '☀️', up: '光明与成功，喜悦清晰可见', rev: '暂时的阴霾，乐观仍需落地' },
  { n: '审判', sym: '📯', up: '觉醒与召唤，答案指引新的方向', rev: '逃避内心的召唤，自我怀疑' },
  { n: '世界', sym: '🌍', up: '圆满与完成，一段旅程画上句点', rev: '尚未完结，差最后一步的收束' },
];
const TAROT_SUIT_ORDER = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', '侍从', '骑士', '王后', '国王'];
const TAROT_SUITS = [
  { name: '权杖', sym: '🔥', realm: '行动与热情', up: ['行动的火花、新机遇', '规划未来、胸有成竹', '扩张视野、远方有信', '庆祝与欢聚、根基渐稳', '竞争与摩擦、以战练形', '胜利与认可、众望所归', '坚守阵地、寸步不让', '快速进展、消息将至', '经验为盾、坚持到底', '重任在肩、学会分派', '热忱的探索者、跃跃欲试', '大胆行动、冲劲十足', '自信温暖、独立有光', '远见与魄力、领军人物'], rev: ['延误起步、方向未明', '恐惧改变、计划模糊', '视野受限、推进缓慢', '过渡失和、聚散有时', '冲突内耗、两败俱伤', '挫败失落、不被看见', '力竭放弃、防线松动', '处处受阻、急不得', '疲惫戒备、心防过重', '负担过重、难以为继', '三分钟热度、虎头蛇尾', '冲动冒进、半途而废', '专断急躁、以己度人', '独断傲慢、灼伤他人'] },
  { name: '圣杯', sym: '💧', realm: '情感与关系', up: ['情感萌发、心之所向', '相互吸引、心意相通', '欢聚与友谊、举杯同庆', '静观内心、倦怠将尽', '失落之后、学会接纳', '纯真回忆、旧情温暖', '幻梦众多、择一而终', '转身离开、寻找更深的意义', '心愿成真、满足安然', '情感圆满、家和心安', '浪漫消息、柔软的心', '浪漫邀约、以情动人', '温柔共情、包容如海', '情感成熟、稳重深沉'], rev: ['心门未开、错失邀约', '误解失衡、渐行渐远', '流言纷扰、社交疲惫', '重燃兴趣、走出低谷', '困于所失、不舍放手', '困于过去、美化旧梦', '幻象散去、脚踏实地', '徘徊原地、畏惧启程', '表面欢笑、内心空落', '貌合神离、温差渐生', '情绪起伏、稚嫩敏感', '不切实际、忽冷忽热', '情绪泛滥、过度付出', '压抑情绪、暗流涌动'] },
  { name: '宝剑', sym: '⚔️', realm: '思维与冲突', up: ['思维清明、真相大白', '僵局暂避、静待时机', '刺痛真相、破而后立', '休整静养、蓄力复原', '争执落定、胜败有价', '驶向平静、渐离风雨', '策略试探、暗中布局', '受困于心、牢笼自设', '忧思难眠、夜漫长', '跌落谷底、终结亦是起点', '好奇观察、慎言求真', '思维如锋、直陈利弊', '理性清醒、界限分明', '公正决断、理智为上'], rev: ['思绪混乱、言语伤人', '打破沉默、直面抉择', '释怀疗愈、痛渐愈合', '倦怠未愈、被迫前行', '放下胜负、握手言和', '滞留原地、不愿启程', '真相揭穿、坦白从宽', '看清牢笼、挣脱束缚', '倾诉求解、阴霾渐散', '熬过低谷、缓慢复原', '多疑轻率、言多必失', '好斗善辩、锋芒伤人', '冷漠刻薄、拒人千里', '独断冷酷、严苛待人'] },
  { name: '星币', sym: '🪙', realm: '物质与现实', up: ['物质新机、耕耘开始', '多方平衡、灵活调度', '协作建设、匠心成事', '守成有度、积谷防饥', '暂处匮乏、寒冬有尽', '给予与接受、互通有余', '耐心等待、静候收成', '专注打磨、勤恳精进', '自立丰足、安享成果', '家业稳固、久积成林', '务实起步、步步为营', '踏实稳健、长期主义', '温暖务实、照护周全', '富足安稳、事业有成'], rev: ['良机错失、财务隐忧', '顾此失彼、左支右绌', '配合失灵、标准不一', '紧握不放、忘了流动', '低谷将尽、援手将至', '往来失衡、施受不均', '急躁难耐、恐无所获', '敷衍了事、热情消退', '依赖成性、外强中干', '根基动摇、纷争渐起', '拖延散漫、心不在焉', '停滞倦怠、动力不足', '操劳过度、心神不宁', '固执守旧、物欲过重'] },
];
(function buildTarotDeck() {
  for (const s of TAROT_SUITS) {
    TAROT_SUIT_ORDER.forEach((rank, i) => {
      TAROT_DECK.push({ n: rank + '·' + s.name, sym: s.sym, up: s.up[i], rev: s.rev[i], realm: s.realm });
    });
  }
})();

/* 占卜：三张牌时间流（过去/现在/未来），牌背→点击翻开牌面（正逆位随机），不记录任何历史 */
async function showDivinationModal() {
  // 洗牌取 3 张不重复，每张独立随机正/逆位
  const deck = [...TAROT_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const pick = deck.slice(0, 3).map(card => ({ card, reversed: Math.random() < 0.5 }));
  // 20260929bc：卡背改为魔法阵（月相星轨）SVG，替代原 🌙 + 星点
  const magicBack = () => `
    <svg class="tb-magic" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="34" fill="none" stroke="rgba(196,181,253,.7)" stroke-width="1.2"/>
      <circle cx="50" cy="50" r="26" fill="none" stroke="rgba(196,181,253,.4)" stroke-width=".8"/>
      <g stroke="rgba(216,202,255,.55)" stroke-width=".8" fill="none">
        <polygon points="50,14 78,64 22,64"/>
        <polygon points="50,86 78,36 22,36"/>
        <line x1="50" y1="16" x2="50" y2="84"/>
        <line x1="24" y1="38" x2="76" y2="62"/>
        <line x1="24" y1="62" x2="76" y2="38"/>
      </g>
      <circle cx="50" cy="50" r="6" fill="none" stroke="rgba(226,214,255,.8)" stroke-width="1"/>
      <circle cx="50" cy="50" r="2" fill="rgba(236,228,255,.9)"/>
      <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(196,181,253,.25)" stroke-width=".6" stroke-dasharray="2 3"/>
      <path d="M50 6 a44 44 0 1 1 -0.01 0" fill="none" stroke="rgba(226,214,255,.5)" stroke-width=".9" stroke-dasharray="1.4 2.6"/>
      <circle cx="14" cy="20" r="1.3" fill="rgba(236,228,255,.85)"/>
      <circle cx="84" cy="74" r="1" fill="rgba(236,228,255,.7)"/>
      <circle cx="78" cy="16" r="1.1" fill="rgba(236,228,255,.7)"/>
      <circle cx="22" cy="82" r=".9" fill="rgba(236,228,255,.6)"/>
    </svg>`;
  const labels = ['过去', '现在', '未来'];
  const diviUseAI = await getSetting('diviUseAI', true); // 20260929ah：AI 解牌开关（持久化）
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="font-size:18px;font-weight:600;">占卜 · 三张牌时间流</div>
      <button class="icon-btn" id="divi-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:10px;">韦特塔罗 78 张 · 正逆位 · 静下心来，想着要问的事，依次翻开三张牌</div>
    <div class="field" style="margin-bottom:10px;">
      <input class="input" id="divi-question" maxlength="100" placeholder="想问什么？（可选，如：最近的运势怎么样）">
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px dashed var(--border);border-radius:12px;margin-bottom:12px;">
      <div style="font-size:12.5px;color:var(--text-secondary);">AI 解牌<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">开启并配好 API 后，三张牌翻开由 AI 结合问题解读；关闭则显示本地牌意</div></div>
      <input type="checkbox" id="divi-useai" ${diviUseAI ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--purple);">
    </div>
    <div class="tarot-wrap">
      ${pick.map((p, i) => `
        <div class="tarot-slot">
          <div class="tarot-card" data-ti="${i}">
            <div class="tarot-inner">
              <div class="tarot-back">${magicBack()}</div>
              <div class="tarot-face${p.reversed ? ' reversed' : ''}">
                <div class="tf-no">${p.card.realm ? p.card.realm : '大阿卡纳'}</div>
                <div class="tf-sym">${p.card.sym}</div>
                <div class="tf-name">${escapeHtml(p.card.n)}</div>
                <div class="tf-pos">${p.reversed ? '逆位' : '正位'}</div>
              </div>
            </div>
          </div>
          <div class="tarot-label">${labels[i]}</div>
        </div>`).join('')}
    </div>
    <div id="divi-meaning" style="margin-top:10px;display:none;"></div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn" style="flex:1;" id="divi-api">AI 解牌设置</button>
      <button class="btn primary" style="flex:1;" id="divi-again">重新占卜</button>
    </div>
  `);
  $('#divi-close').onclick = closeModal;
  $('#divi-again').onclick = () => showDivinationModal();
  $('#divi-api').onclick = () => showAIConfigModal(); // 20260929ae：统一到 API 接入配置页（占卜 API 独立栏）
  // AI 解牌开关（20260929ah）：即时持久化
  const useAiEl = $('#divi-useai');
  if (useAiEl) useAiEl.onchange = async (e) => {
    await setSetting('diviUseAI', !!e.target.checked);
    miniToast(e.target.checked ? '三张牌翻开后将由 AI 解牌' : '已关闭 AI 解牌，显示本地牌意');
  };
  const opened = new Set();
  document.querySelectorAll('.tarot-card').forEach(el => {
    el.onclick = () => {
      if (el.classList.contains('open')) return;
      el.classList.add('open');
      opened.add(parseInt(el.dataset.ti));
      if (opened.size === 3) renderDivinationMeaning(pick);
    };
  });
}

/* 三张牌全翻开后展示牌意汇总（本地牌意；AI 解牌开关开启且配了占卜 API 时，AI 结合问题解读） */
function renderDivinationMeaning(pick) {
  const labels = ['过去', '现在', '未来'];
  const box = $('#divi-meaning');
  if (!box) return;
  const qEl = $('#divi-question');
  const question = (qEl && qEl.value.trim()) || '';
  const useAiEl = $('#divi-useai');
  const useAI = useAiEl ? !!useAiEl.checked : true; // 弹窗已关则按默认开
  box.innerHTML = `
    <div class="tarot-meaning">
      ${question ? `<div class="tm-row" style="color:var(--text-secondary);font-size:12.5px;">❓ 想问：${escapeHtml(question)}</div>` : ''}
      ${pick.map((p, i) => `<div class="tm-row"><b>${labels[i]} · ${escapeHtml(p.card.n)}（${p.reversed ? '逆位' : '正位'}）</b><br>${escapeHtml(p.reversed ? p.card.rev : p.card.up)}</div>`).join('')}
      ${useAI ? '<div class="tm-row" style="color:var(--text-tertiary);font-size:12px;">💡 想要 AI 结合问题解牌？开启「AI 解牌」并在「AI 解牌设置」里填入占卜 API 链接即可（可与聊天 API 相同）</div>' : '<div class="tm-row" style="color:var(--text-tertiary);font-size:12px;">AI 解牌已关闭，显示本地牌意</div>'}
    </div>`;
  box.style.display = '';
  // 20260929ah：AI 解牌开关开启 且 配置了占卜/聊天 API 时，自动追加 AI 解牌（失败回退本地牌意）
  if (!useAI) return;
  loadAIConfig().then(cfg => {
    const url = cfg.divApi.url || cfg.chatApi.url;
    if (!url) return;
    const aiRow = document.createElement('div');
    aiRow.className = 'tm-row';
    aiRow.style.cssText = 'margin-top:8px;border-top:1px dashed var(--border);padding-top:10px;';
    aiRow.innerHTML = '<b>🔮 AI 解牌</b><br><span style="color:var(--text-secondary);">正在解读…</span>';
    box.querySelector('.tarot-meaning').appendChild(aiRow);
    divinationAIInterpret(question, pick).then(txt => {
      if (txt) {
        aiRow.innerHTML = `<b>🔮 AI 解牌</b><br>${escapeHtml(txt)}`;
      } else {
        aiRow.remove();
      }
    });
  });
}

/* 占卜 API 独立设置（可与聊天 API 不同；未接入时使用本地牌意） */
async function showDivinationApiModal() {
  const cur = await getSetting('divinationApi', '');
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">占卜 API 设置</div>
      <button class="icon-btn" id="diviapi-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">填入占卜用的 API 链接（可以和聊天 API 是同一个，也可以不同）。留空则使用本地牌意解读。</div>
    <div class="field"><input class="input" id="diviapi-url" placeholder="https://…" value="${escapeHtml(cur)}"></div>
    <button class="btn primary block" id="diviapi-save">保存</button>
  `);
  $('#diviapi-close').onclick = closeModal;
  $('#diviapi-save').onclick = async () => {
    await setSetting('divinationApi', $('#diviapi-url').value.trim());
    miniToast('占卜 API 已保存');
    closeModal();
  };
}

/* ---------- 记事簿：玩家记录事件，梦角到点提醒（走通知系统），文案抽字卡 ---------- */
async function showNotebookModal() {
  const items = (await getSetting('notebookItems', [])).sort((a, b) => (a.done - b.done) || (a.remindAt || 0) - (b.remindAt || 0));
  const fmtWhen = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">记事簿</div>
      <button class="icon-btn" id="note-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:12px;">记下重要的事，到点梦角会提醒你（App 走本地通知，网页走浏览器通知）</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;max-height:300px;overflow-y:auto;" id="note-list">
      ${items.length === 0 ? '<div style="color:var(--text-tertiary);text-align:center;padding:20px;">还没有记录，先添加一条吧</div>'
        : items.map(it => `
          <div class="note-item${it.done ? ' done' : ''}">
            <div class="nt-check${it.done ? ' on' : ''}" data-note-check="${it.id}">${it.done ? '✓' : ''}</div>
            <div style="flex:1;min-width:0;">
              <div class="nt-text">${escapeHtml(it.text)}</div>
              ${it.remindAt ? `<div class="nt-when ${(!it.done && it.remindAt > Date.now()) ? 'nt-due' : ''}">⏰ ${fmtWhen(it.remindAt)}${(!it.done && it.remindAt <= Date.now()) ? ' 已提醒' : ''}</div>` : ''}
            </div>
            <button class="badge" style="cursor:pointer;color:var(--danger);flex-shrink:0;" data-note-del="${it.id}">删</button>
          </div>`).join('')}
    </div>
    <div class="field">
      <input class="input" id="note-text" placeholder="记点什么…">
      <div style="font-size:12.5px;color:var(--text-secondary);margin:10px 0 6px;">提醒时间（可不填，仅作记录）</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <input class="input" type="number" id="note-y" min="2020" max="2100" placeholder="年" style="width:64px;flex:none;">
        <span style="font-size:13px;color:var(--text-tertiary);">年</span>
        <input class="input" type="number" id="note-mo" min="1" max="12" placeholder="月" style="width:56px;flex:none;">
        <span style="font-size:13px;color:var(--text-tertiary);">月</span>
        <input class="input" type="number" id="note-d" min="1" max="31" placeholder="日" style="width:56px;flex:none;">
        <span style="font-size:13px;color:var(--text-tertiary);">日</span>
        <input class="input" type="number" id="note-h" min="0" max="23" placeholder="时" style="width:56px;flex:none;">
        <span style="font-size:13px;color:var(--text-tertiary);">时</span>
        <input class="input" type="number" id="note-mi" min="0" max="59" placeholder="分" style="width:56px;flex:none;">
        <span style="font-size:13px;color:var(--text-tertiary);">分</span>
        <button class="btn primary" id="note-add" style="flex:none;margin-left:auto;">添加</button>
      </div>
    </div>
  `);
  $('#note-close').onclick = closeModal;
  document.querySelectorAll('[data-note-check]').forEach(el => {
    el.onclick = async () => {
      const items2 = await getSetting('notebookItems', []);
      const it = items2.find(x => x.id === el.dataset.noteCheck);
      if (it) { it.done = !it.done; await setSetting('notebookItems', items2); }
      showNotebookModal();
    };
  });
  document.querySelectorAll('[data-note-del]').forEach(el => {
    el.onclick = async () => {
      let items2 = await getSetting('notebookItems', []);
      items2 = items2.filter(x => x.id !== el.dataset.noteDel);
      await setSetting('notebookItems', items2);
      showNotebookModal();
    };
  });
  $('#note-add').onclick = async () => {
    const text = $('#note-text').value.trim();
    if (!text) { miniToast('先写点内容吧'); return; }
    const items2 = await getSetting('notebookItems', []);
    const y = parseInt($('#note-y').value, 10);
    const mo = parseInt($('#note-mo').value, 10);
    const d = parseInt($('#note-d').value, 10);
    const hh = parseInt($('#note-h').value, 10);
    const mi = parseInt($('#note-mi').value, 10);
    let remindAt = null;
    const anyDate = !isNaN(y) || !isNaN(mo) || !isNaN(d);
    if (anyDate) {
      if (isNaN(y) || isNaN(mo) || isNaN(d)) { miniToast('请把年、月、日填完整'); return; }
      if (mo < 1 || mo > 12) { miniToast('月份要在 1～12 之间'); return; }
      if (d < 1 || d > 31) { miniToast('日期要在 1～31 之间'); return; }
      const hour = isNaN(hh) ? 0 : hh;
      const min = isNaN(mi) ? 0 : mi;
      if (hour < 0 || hour > 23 || min < 0 || min > 59) { miniToast('时间格式不对'); return; }
      remindAt = new Date(y, mo - 1, d, hour, min).getTime();
    }
    items2.push({ id: uid('note'), text, at: Date.now(), remindAt, done: false, reminded: false });
    await setSetting('notebookItems', items2);
    showNotebookModal();
  };
}

/* 记事簿心跳：到点提醒（30 秒一查；文案=梦角名 + 字卡抽的一句话） */
function startNotebookTimer() {
  const tick = async () => {
    try {
      const items = await getSetting('notebookItems', []);
      let dirty = false;
      const now = Date.now();
      const c = characters[0];
      for (const it of items) {
        if (it.done || it.reminded || !it.remindAt || it.remindAt > now) continue;
        it.reminded = true;
        dirty = true;
        // 20260929ae：AI 模式下提醒文案由 AI 生成（失败回退字卡）
        let quote = '';
        if (c && await isAIMode()) {
          try {
            const cfg = await loadAIConfig();
            const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
              { role: 'system', content: `你是角色扮演 AI。玩家记了一件待办「${it.text}」，请以角色身份写一句温柔的提醒（1 句，可带 emoji）。` },
              { role: 'user', content: '请写一句提醒。' },
            ], { temperature: 0.8 });
            if (r.ok && r.text) quote = r.text;
          } catch (e) {}
        }
        if (!quote) quote = cards.customReplies && cards.customReplies.length ? drawFrom(cards.customReplies) : '';
        const body = quote ? `${it.text}\n\n—— ${c ? c.name : '梦角'}：${quote}` : it.text;
        miniToast('⏰ 记事簿提醒：' + it.text.slice(0, 18));
        // 20261001ci：统一走 notifyIncoming——APK 端自动切本地通知，网页端走 Web Notification
        notifyIncoming(c, body.slice(0, 120), '⏰ 记事簿提醒');
      }
      if (dirty) await setSetting('notebookItems', items);
    } catch (e) {}
  };
  tick();
  setInterval(tick, 30000);
}

/* ---------- 书信：信纸书写 → 聊天流信封卡片 → 火漆印开信动画；梦角随机来信 ----------
   charId 可选：从书信记录/开信动画里回信时指定访客（不必正在该访客的聊天里） */
async function showLetterComposeModal(charId = null, opts = {}) {
  const c = characters.find(x => x.id === (charId || currentCharId));
  if (!c) { miniToast('先进入一个访客的聊天'); return; }
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">${opts.reply ? '给' + escapeHtml(c.name) + '回信' : '给' + escapeHtml(c.name) + '写信'}</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn" style="padding:6px 12px;font-size:13px;" id="letter-records">信箱</button>
        <button class="icon-btn" id="letterw-close">✕</button>
      </div>
    </div>
    <div class="letter-compose">
      <textarea id="letter-text" maxlength="2000" placeholder="提笔，把想说的话写给 TA…（纯文字，最多 2000 字）"></textarea>
      <div class="lc-count"><span id="letter-count">0</span> / 2000</div>
    </div>
    <button class="btn primary block" style="margin-top:14px;" id="letter-send">🕯️ 封缄寄出</button>
  `);
  $('#letterw-close').onclick = closeModal;
  $('#letter-records').onclick = () => showLetterRecordsModal(c.id); // 信箱：只看与当前角色的往来
  $('#letter-text').oninput = () => { $('#letter-count').textContent = [...$('#letter-text').value].length; };
  $('#letter-send').onclick = async () => {
    const text = $('#letter-text').value.trim();
    if (!text) { miniToast('信纸上还没有字'); return; }
    const msg = {
      id: uid('msg'), charId: c.id, from: 'me', type: 'letter',
      reply: !!opts.reply,
      threadId: opts.reply ? (opts.threadId || opts.replyToMsgId || null) : null, // 回信挂到原信线程；新写信在下面补自身 id
      content: { text, preview: [...text].slice(0, 26).join('') },
      time: Date.now(), read: true,
    };
    if (!msg.threadId) msg.threadId = msg.id; // 新线程：线程 id = 根信 id
    await idbPut('messages', msg);
    closeModal();
    miniToast('信已寄出 ✉️');
    if (currentCharId === c.id && document.body.dataset.view === 'chat') {
      appendMessage(msg);
      scrollToBottom();
    } else {
      renderChatList(); // 不在该访客聊天里（如从信箱回信）：刷新列表摘要即可
    }
    // 一对一书信（用户修正）：玩家写信（根信）→ 梦角必回一次（40 秒~2 分钟）；
    // 线程内的回信不再触发角色再回信——杜绝「回信→又回信」的没完没了。
    // 20260925i：改走持久化待回信队列——旧实现裸 setTimeout 页面一刷新就丢，回信永远不来
    if (!opts.reply) {
      await scheduleLetterReply(c, text, msg.id);
    }
  };
  setTimeout(() => { const t = $('#letter-text'); if (t) t.focus(); }, 120);
}

/* 信箱（原「书信记录」，用户 20260929 重做）：一对一线程视图——
   玩家写信→梦角回一次 / 梦角来信→玩家回一次，原信与回信合并为一行条目；
   回信下方不再设回信按钮（线程一轮即闭合，杜绝没完没了）。
   从角色聊天页进入（写信弹窗 → 信箱）只显示与当前角色的往来。
   支持：文件夹归类（新建/删除/移动）、批量管理（多选删除/移动）。 */
async function showLetterRecordsModal(charId = null) {
  let folders = await getSetting('letterFolders', []);      // [{id,name}]
  let folderMap = await getSetting('letterFolderMap', {});  // { 线程id: 文件夹id（''=未分组） }
  let curFolder = 'all';       // 'all' | '__none__'（未分组） | 文件夹id
  let batchMode = false;
  const selected = new Set();  // 线程 id

  const all = await idbGetAll('messages');
  const letters = all.filter(m => m.type === 'letter' && m.charId && (!charId || m.charId === charId));
  const threads = buildLetterThreads(letters).sort((a, b) => letterLatest(b).time - letterLatest(a).time);
  const scopeChar = charId ? characters.find(x => x.id === charId) : null;
  const tidOf = (t) => t.root ? (t.root.threadId || t.root.id) : (t.replyMsg.replyTo || t.replyMsg.threadId || t.replyMsg.id);
  const unreadCount = threads.reduce((n, t) =>
    n + (((t.replyMsg && !t.replyMsg.read) || (!t.replyMsg && t.root && t.root.from === 'them' && !t.root.read)) ? 1 : 0), 0);

  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        <div style="font-size:18px;font-weight:600;">信箱</div>
        <span class="badge" id="lr-count"></span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn" style="padding:6px 12px;font-size:13px;" id="lr-batch">批量管理</button>
        <button class="icon-btn" id="lr-close">✕</button>
      </div>
    </div>
    ${scopeChar ? `<div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:8px;">只显示与「${escapeHtml(scopeChar.name)}」的往来书信</div>` : ''}
    <div class="lr-folders" id="lr-folders"></div>
    <div class="lr-newrow" id="lr-newrow" style="display:none;">
      <input class="input" id="lr-newname" placeholder="文件夹名称" style="flex:1;">
      <button class="btn primary" id="lr-newok">确定</button>
      <button class="btn" id="lr-newcancel">取消</button>
    </div>
    <div id="lr-list"></div>
    <div class="lr-batchbar" id="lr-batchbar">
      <button class="btn" id="lr-selall">全选</button>
      <button class="btn danger" id="lr-del">删除</button>
      <select class="input" id="lr-move" style="flex:1.2;"></select>
      <button class="btn" id="lr-palace2" title="把勾选的信件存入记忆宫殿">🏛️ 存宫殿</button>
      <button class="btn" id="lr-done">完成</button>
    </div>
  `);
  $('#lr-close').onclick = closeModal;
  // 20260929bh：信箱顶栏「记忆宫殿」入口按钮已删除（批量管理里的「存宫殿」保留）
  $('#lr-batch').onclick = () => {
    batchMode = !batchMode;
    selected.clear();
    $('#lr-batch').textContent = batchMode ? '退出批量' : '批量管理';
    render();
  };

  const saveFolders = () => setSetting('letterFolders', folders);
  const saveMap = () => setSetting('letterFolderMap', folderMap);
  const shownThreads = () => threads.filter(t => {
    const v = folderMap[tidOf(t)] || '';
    return curFolder === 'all' ? true : v === (curFolder === '__none__' ? '' : curFolder);
  });

  function renderFolderBar() {
    const el = $('#lr-folders');
    const chips = [
      `<div class="lr-fchip${curFolder === 'all' ? ' on' : ''}" data-f="all">全部</div>`,
      `<div class="lr-fchip${curFolder === '__none__' ? ' on' : ''}" data-f="__none__">未分组</div>`,
    ];
    for (const f of folders) {
      chips.push(`<div class="lr-fchip${curFolder === f.id ? ' on' : ''}" data-f="${f.id}">${escapeHtml(f.name)}<span class="fx" data-fx="${f.id}" title="删除文件夹（信件移回未分组）">✕</span></div>`);
    }
    chips.push(`<div class="lr-fchip" data-f="__new__" style="border-style:dashed;">＋ 新建</div>`);
    el.innerHTML = chips.join('');
    el.querySelectorAll('.lr-fchip').forEach(chip => {
      chip.onclick = (ev) => {
        if (ev.target.classList.contains('fx')) return; // 删除✕单独处理
        const f = chip.dataset.f;
        if (f === '__new__') { $('#lr-newrow').style.display = 'flex'; $('#lr-newname').focus(); return; }
        curFolder = f;
        selected.clear();
        render();
      };
    });
    el.querySelectorAll('[data-fx]').forEach(x => {
      x.onclick = (ev) => {
        ev.stopPropagation();
        const fid = x.dataset.fx;
        if (!x.dataset.confirm) { // 两段确认，避免误删
          x.dataset.confirm = '1'; x.textContent = '确认删?';
          setTimeout(() => { if (x.isConnected) { x.dataset.confirm = ''; x.textContent = '✕'; } }, 2500);
          return;
        }
        folders = folders.filter(y => y.id !== fid);
        for (const k of Object.keys(folderMap)) if (folderMap[k] === fid) delete folderMap[k];
        if (curFolder === fid) curFolder = 'all';
        saveFolders(); saveMap(); render();
        miniToast('文件夹已删除，信件移入未分组');
      };
    });
  }

  function renderList() {
    const list = $('#lr-list');
    const shown = shownThreads();
    $('#lr-count').textContent = `${shown.length} 封${unreadCount ? ` · ${unreadCount} 封未读` : ''}`;
    if (shown.length === 0) {
      list.innerHTML = `
        <div class="empty" style="padding:30px 0;">
          <div class="empty-icon">🕯️</div>
          <div>${curFolder === 'all' ? '还没有往来书信' : '这个文件夹还没有信件'}</div>
          <div style="font-size:12.5px;margin-top:4px;">在聊天页「＋ → 书信」提笔写第一封，或等梦角随机来信</div>
        </div>`;
      return;
    }
    list.innerHTML = shown.map(t => {
      const root = t.root, rep = t.replyMsg;
      const latest = rep || root;
      const c = characters.find(x => x.id === (root || rep).charId);
      const name = c ? c.name : '已删除的访客';
      const unreadDot = ((rep && !rep.read) || (!rep && root && root.from === 'them' && !root.read)) ? '<span class="lr-unread" title="未读"></span>' : '';
      const badge = !root ? '回信'
        : root.from === 'me' ? (rep ? '已回信' : '等待回信')
        : (rep ? '已回信' : '来信');
      // 20260929ah：主条目=最初寄出的信件（玩家和角色寄出的都一样）；
      // 行尾按钮：有回信→「查看回信」；没回信→寄出方显示等待、来信显示「✍️ 回信」
      let act = '';
      if (!batchMode && root) {
        if (rep) act = `<button class="btn lr-act" data-lr-view="${root.id}" title="查看回信">查看回信</button>`;
        else if (root.from === 'me') act = `<button class="btn lr-act" data-lr-view="${root.id}" title="查看访客的回信">查看回信</button>`;
        else act = `<button class="btn lr-act" data-lr-reply="${root.id}" title="给这封来信回信">✍️ 回信</button>`;
      }
      // 预览显示根信（主条目）内容，不再显示回信内容
      const preview = (root && root.content && root.content.text) ? [...root.content.text].slice(0, 30).join('') : '';
      const checked = selected.has(tidOf(t));
      return `
        <div class="letter-rec" data-tid="${tidOf(t)}" style="${batchMode ? 'cursor:pointer;' : ''}">
          ${batchMode ? `<div class="lr-check${checked ? ' on' : ''}">✓</div>` : ''}
          <div class="avatar sm">${c && c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(name[0] || '?')}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;min-width:0;">
              ${scopeChar ? '' : `<span style="font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</span>`}
              <span class="badge" style="flex-shrink:0;">${badge}</span>
              ${unreadDot}
            </div>
            <div style="font-size:12.5px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${escapeHtml(preview || '（无文字内容）')}</div>
          </div>
          <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
            ${act}
            <div style="font-size:11.5px;color:var(--text-tertiary);">${letterTimeStr(latest.time)}</div>
          </div>
        </div>`;
    }).join('');

    // 行点击：批量模式=勾选/取消；普通=打开主条目（最初寄出的那封信，不播开信动画）
    list.querySelectorAll('.letter-rec').forEach(el => {
      el.onclick = () => {
        const t = shown.find(x => tidOf(x) === el.dataset.tid);
        if (!t) return;
        if (batchMode) {
          const id = el.dataset.tid;
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          render();
          return;
        }
        if (t.root) openLetterOverlay(t.root, characters.find(x => x.id === t.root.charId), { noAnim: true });
        else if (t.replyMsg) openLetterOverlay(t.replyMsg, characters.find(x => x.id === t.replyMsg.charId), { noAnim: true });
      };
    });
    // 「查看回信」：已回→直接看回信（不播动画）；未回→等待提示（一对一线程只会有这一封回信）
    list.querySelectorAll('[data-lr-view]').forEach(b => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        const t = shown.find(x => x.root && x.root.id === b.dataset.lrView);
        if (!t) return;
        if (t.replyMsg) {
          if (!t.replyMsg.read) { t.replyMsg.read = true; await idbPut('messages', t.replyMsg); }
          openLetterOverlay(t.replyMsg, characters.find(x => x.id === t.replyMsg.charId), { noAnim: true });
        } else {
          // 20260925i：显示预计送达时间（待回信队列里有到期时间）；
          // 旧版本写的信（裸 setTimeout 已随刷新丢失）在这里自动补排一封，不让玩家干等
          let remainTxt = '回信已在路上，稍等片刻';
          try {
            const cc = characters.find(x => x.id === t.root.charId);
            if (!cc) {
              remainTxt = '（该访客已不存在，无法回信）';
            } else {
              let pend = (await getSetting('pendingLetterReplies', [])).find(p => p && p.replyToMsgId === t.root.id);
              if (!pend) pend = await scheduleLetterReply(cc, (t.root.content && t.root.content.text) || '', t.root.id, 30000 + Math.floor(Math.random() * 30000));
              if (pend && pend.dueAt > Date.now()) {
                const ms = pend.dueAt - Date.now();
                remainTxt = ms >= 60000 ? `预计还有 ${Math.ceil(ms / 60000)} 分钟送到` : `预计还有 ${Math.max(1, Math.round(ms / 1000))} 秒送到`;
              }
            }
          } catch (e) {}
          openModal(`
            <div style="text-align:center;padding:10px 0 4px;">
              <div style="font-size:34px;">🕯️</div>
              <div style="font-size:16px;font-weight:600;margin-top:10px;">访客正在回信中</div>
              <div style="font-size:13px;color:var(--text-tertiary);margin-top:6px;">${escapeHtml(remainTxt)}</div>
              <button class="btn primary block" style="margin-top:16px;" id="lr-wait-ok">知道了</button>
            </div>
          `);
          $('#lr-wait-ok').onclick = closeModal;
        }
      };
    });
    // 来信「✍️ 回信」：进入回信模式（线程内只此一次，寄出后线程闭合，不再触发角色回信）
    list.querySelectorAll('[data-lr-reply]').forEach(b => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        const t = shown.find(x => x.root && x.root.id === b.dataset.lrReply);
        if (t && t.root) showLetterComposeModal(t.root.charId, { reply: true, threadId: t.root.threadId || t.root.id, replyToMsgId: t.root.id });
      };
    });
  }

  function renderBatchBar() {
    const bar = $('#lr-batchbar');
    if (!batchMode) { bar.classList.remove('show'); return; }
    bar.classList.add('show');
    $('#lr-selall').textContent = selected.size ? '全不选' : '全选';
    $('#lr-del').textContent = selected.size ? `删除(${selected.size})` : '删除';
    $('#lr-del').dataset.confirm = '';
    const mv = $('#lr-move');
    mv.innerHTML = `<option value="__">移动到…</option><option value="">未分组</option>` +
      folders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    mv.value = '__';
    mv.onchange = async () => {
      if (mv.value === '__' || !selected.size) { mv.value = '__'; if (!selected.size) miniToast('先勾选信件'); return; }
      for (const id of selected) folderMap[id] = mv.value;
      await saveMap();
      miniToast('已移动 ' + selected.size + ' 封');
      selected.clear();
      render();
    };
  }

  function render() { renderFolderBar(); renderList(); renderBatchBar(); }

  $('#lr-selall').onclick = () => {
    const shown = shownThreads();
    if (selected.size) selected.clear();
    else shown.forEach(t => selected.add(tidOf(t)));
    render();
  };
  $('#lr-del').onclick = async () => {
    if (!selected.size) { miniToast('先勾选要删除的信件'); return; }
    const b = $('#lr-del');
    if (!b.dataset.confirm) { // 两段确认
      b.dataset.confirm = '1';
      b.textContent = '确认删除?';
      setTimeout(() => { if (b.isConnected && batchMode) { b.dataset.confirm = ''; b.textContent = selected.size ? `删除(${selected.size})` : '删除'; } }, 2500);
      return;
    }
    let n = 0;
    for (const t of threads) {
      const id = tidOf(t);
      if (!selected.has(id)) continue;
      if (t.root) { await idbDelete('messages', t.root.id); n++; }
      if (t.replyMsg) { await idbDelete('messages', t.replyMsg.id); n++; }
      delete folderMap[id];
    }
    await saveMap();
    selected.clear();
    miniToast('已删除 ' + n + ' 封信件');
    render();
  };
  $('#lr-done').onclick = () => {
    batchMode = false;
    selected.clear();
    $('#lr-batch').textContent = '批量管理';
    render();
  };
  $('#lr-newok').onclick = async () => {
    const v = $('#lr-newname').value.trim();
    if (!v) { miniToast('先起个文件夹名'); return; }
    if (folders.some(f => f.name === v)) { miniToast('已有同名文件夹'); return; }
    const f = { id: 'lf' + Date.now().toString(36), name: v };
    folders.push(f);
    await saveFolders();
    $('#lr-newname').value = '';
    $('#lr-newrow').style.display = 'none';
    curFolder = f.id;
    miniToast('文件夹「' + v + '」已创建');
    render();
  };
  $('#lr-newcancel').onclick = () => { $('#lr-newrow').style.display = 'none'; };

  // 批量存入记忆宫殿（20260929ah）：勾选信件 → 选宫殿文件夹 → 成对存入
  $('#lr-palace2').onclick = () => {
    if (!selected.size) { miniToast('先勾选要存入的信件'); return; }
    const picked = threads.filter(t => selected.has(tidOf(t)));
    showLetterPalaceModal(picked, () => { selected.clear(); render(); });
  };

  render();
}

/* 信件存入记忆宫殿：选目标文件夹（玩家根文件夹 / 访客文件夹 / 其子文件夹），
   每个线程存一条 kind='letter' 的宫殿条目（主信 + 回信成对留底） */
async function showLetterPalaceModal(pickedThreads, onDone) {
  const folders = await palEnsureFolders();
  const options = [];
  for (const f of folders) {
    if (f.type === 'hidden') continue; // 隐藏夹不收信
    options.push({ id: f.id, name: f.name, indent: 0 });
    folders.filter(x => x.parentId === f.id && x.type !== 'hidden')
      .forEach(sf => options.push({ id: sf.id, name: sf.name, indent: 1 }));
  }
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="font-size:17px;font-weight:600;">🏛️ 存入记忆宫殿</div>
      <button class="icon-btn" id="lp-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:10px;">把选中的 ${pickedThreads.length} 封往来信件存入哪个文件夹？（主信与回信成对留底，AI 按文件夹权限读取）</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:44vh;overflow-y:auto;" id="lp-list">
      ${options.map(o => `
        <div class="pal-row lp-opt" data-lpf="${o.id}" style="${o.indent ? 'margin-left:18px;' : ''}">
          <div class="pal-ic">${o.indent ? '📁' : (String(o.id).startsWith('pf_char_') ? '🧠' : '👤')}</div>
          <div class="pal-main"><div class="pal-title">${escapeHtml(o.name)}</div></div>
          <span class="lp-radio" style="width:18px;height:18px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;"></span>
        </div>`).join('')}
    </div>
    <button class="btn primary block" id="lp-ok" style="margin-top:12px;">存入</button>
  `);
  let target = '';
  const okBtn = $('#lp-ok');
  $('#lp-close').onclick = closeModal;
  document.querySelectorAll('.lp-opt').forEach(row => {
    row.onclick = () => {
      target = row.dataset.lpf;
      document.querySelectorAll('.lp-opt').forEach(r => { r.querySelector('.lp-radio').style.background = ''; r.querySelector('.lp-radio').style.borderColor = 'var(--border)'; });
      const radio = row.querySelector('.lp-radio');
      radio.style.background = 'var(--purple)';
      radio.style.borderColor = 'var(--purple)';
      okBtn.disabled = false;
      okBtn.style.opacity = '1';
    };
  });
  okBtn.disabled = true;
  okBtn.style.opacity = '0.5';
  okBtn.onclick = async () => {
    if (!target || !pickedThreads.length) return;
    await palEnsureFolders();
    let n = 0;
    for (const t of pickedThreads) {
      const root = t.root, rep = t.replyMsg;
      if (!root && !rep) continue;
      const charId = (root || rep).charId;
      const c = characters.find(x => x.id === charId);
      const me = playerProfile.name || '我';
      const who = (m) => m ? (m.from === 'me' ? me : (c ? c.name : 'TA')) : '';
      const body = [
        root ? `【${who(root)} 寄出】\n${(root.content && root.content.text) || ''}` : '',
        rep ? `【${who(rep)} 的回信】\n${(rep.content && rep.content.text) || ''}` : '',
      ].filter(Boolean).join('\n\n');
      await idbPut('palace', {
        id: uid('pal'), kind: 'letter', folderId: target, subFolderId: '',
        charId: charId || '', groupId: '', messages: [], baseMsgId: '',
        title: ((root && root.content && root.content.text) || '一封信').replace(/\s+/g, ' ').trim().slice(0, 30) || '一封信',
        summary: '', summaryByAI: false,
        text: body, img: null,
        dateLabel: palDateLabel((root && root.time) || (rep && rep.time) || Date.now()),
        time: (root && root.time) || (rep && rep.time) || Date.now(), createdAt: Date.now(),
        allowAI: null,
      });
      n++;
    }
    miniToast(`已把 ${n} 封信存入记忆宫殿 🏛️`);
    closeModal();
    if (onDone) onDone();
  };
}

/* 把信件按时间序配成一对一线程：根信（非回信）+ 最多一条回复。
   兼容旧数据：reply=true 但缺 replyTo 的旧回信，挂到同角色最近一封还没有回复的根信上；
   找不到归属的旧回信单独成行（root=null，徽章显示「回信」） */
function buildLetterThreads(letters) {
  const asc = [...letters].sort((a, b) => a.time - b.time);
  const roots = [];
  const byId = new Map();
  for (const m of asc) {
    if (!m.reply) {
      const t = { root: m, replyMsg: null };
      roots.push(t);
      byId.set(m.id, t);
    } else {
      let t = (m.replyTo && byId.get(m.replyTo)) || null;
      if (!t) {
        // 旧格式回信（无 replyTo）：与同角色最早一封还没回的信配对（FIFO，符合回信先后顺序）
        for (let i = 0; i < roots.length; i++) {
          const r = roots[i];
          if (r.root && r.root.charId === m.charId && !r.replyMsg) { t = r; break; }
        }
      }
      if (t && !t.replyMsg) t.replyMsg = m;
      else roots.push({ root: null, replyMsg: m, orphan: true });
    }
  }
  return roots;
}
function letterLatest(t) { return t.replyMsg || t.root; }

/* 找一封玩家寄出信件的回信：优先精确关联（replyTo），其次该访客此后标记为回信的信 */
async function findLetterReply(m) {
  const all = await idbGetAll('messages');
  const cands = all.filter(x => x.type === 'letter' && x.from === 'them' && x.charId === m.charId && x.time >= m.time);
  return cands.find(x => x.replyTo === m.id) || cands.find(x => x.reply) || null;
}

/* 书信记录时间：今年显示"X月X日"，往年带年份 */
function letterTimeStr(ts) {
  const d = new Date(ts);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/* 梦角来信/回信（20260929ah：AI 模式信文由 AI 生成，失败回退字卡拼贴），
   写入消息（未读），火漆印信封弹窗动画 + 通知 + 提示音 */
async function charSendLetter(c, opts = {}) {
  try {
    // 信文：AI 模式由 AI 写信（回信会结合玩家原信），失败回退随机抽 10 张字卡
    let text = '';
    const isReply = !!opts.replyToText;
    if (await isAIMode()) {
      const aiText = await aiSoftReply(c, isReply
        ? `请以角色身份给玩家写一封回信，回应这封来信的内容：\n「${String(opts.replyToText).slice(0, 400)}」\n书信体，温柔自然，100~200 字，分段，不要跳出角色。`
        : '请以角色身份主动给玩家写一封信（不是回信）：分享近况、思念或日常，书信体，温柔自然，100~200 字，分段，不要跳出角色。', () => '');
      if (aiText) text = aiText;
    }
    if (!text) {
      // 字卡兜底（原逻辑）：随机抽取 10 张字卡拼成信文（角色可用池，跟随访客禁词/禁用分组）
      const pools = charCardPools(c);
      const pool = pools.replies.concat(pools.mottos);
      const picked = [];
      for (let i = 0; i < 10; i++) {
        const t = drawFrom(pool);
        if (t) picked.push(t);
      }
      const lines = picked.filter((t, i) => i === 0 || t !== picked[i - 1]); // 去掉相邻重复
      text = lines.length ? lines.join('\n') : '见字如面。\n近来安好。\n愿梦里相见。';
    } else {
      // AI 信文里的隐藏指令：AI 决定把玩家的来信/这段通信存进记忆宫殿
      const parsed = parseAITags(text);
      text = parsed.clean;
      if (parsed.memo) aiPalStoreMemo(c.id, parsed.memo);
      if (isReply && parsed.memo) {
        // 回信场景：连同玩家原信一起留底（正文=玩家来信+AI 记忆）
        try {
          await palEnsureFolders();
          await idbPut('palace', {
            id: uid('pal'), kind: 'letter', folderId: 'pf_char_' + c.id, subFolderId: '',
            charId: c.id, groupId: '', messages: [], baseMsgId: '',
            title: ('玩家来信：' + String(opts.replyToText)).replace(/\s+/g, ' ').trim().slice(0, 30),
            summary: '', summaryByAI: false,
            text: `【玩家的来信】\n${opts.replyToText}\n\n【${c.name} 的回信】\n${text}`,
            img: null, dateLabel: palDateLabel(Date.now()),
            time: Date.now(), createdAt: Date.now(), allowAI: null, auto: true,
          });
        } catch (e) {}
      }
    }
    const msg = {
      id: uid('msg'), charId: c.id, from: 'them', type: 'letter', reply: isReply,
      replyTo: opts.replyToMsgId || null, // 关联的原信（玩家寄出的那封）
      threadId: opts.replyToMsgId || null, // 回信挂到原信线程；随机来信在下面补自身 id
      content: { text, preview: [...text].slice(0, 26).join('') },
      time: Date.now(), read: false,
    };
    if (!msg.threadId) msg.threadId = msg.id; // 根信：线程 id = 自身
    await idbPut('messages', msg);
    const cs = getCharChatSettings(c);
    if (_inChatWith(c.id)) {
      appendMessage(msg); scrollToBottom();
      openLetterOverlay(msg, c);
      // 20260929aw：正在看的信件直接标记已读——防退出聊天后导航页仍提示未读
      setSetting('lastRead_' + c.id, Date.now());
    } else {
      // 20260929au：不在该访客聊天页 → 不插入 DOM，改顶部横幅 + 累计未读 + 红点；
      // 20260929be 动画细则：外部页面（导航/主页/朋友圈）一律不播开信动画——
      // 开信动画只在玩家点进该访客聊天页时播一次（_letterOnEnterChat）
      const e = _ev(c.id);
      e.letters = (e.letters || 0) + 1;
      await _saveUnreadEvents();
      renderChatList();
      refreshUnreadBadges();
      if (!_noteCrossPageIncoming(c.id)) {
        showTopBanner(`<b>${escapeHtml(c.name)}</b> 给你发送了一封信<div class="tb-sub">点进与 TA 的聊天查看</div>`, { charId: c.id });
      }
    }
    // 通知 + 提示音（20260929ah：收到信件/回信都会响；20260930 改 shouldDingFor 统一「聊天页内仅当前角色响」）
    if (shouldDingFor(c)) playDing();
    notifyIncoming(c, text.slice(0, 60), c.name + (isReply ? ' 回了一封信' : ' 寄来一封信')); // 20260929bi：统一出口+挂后台可收
  } catch (e) {}
}

/* ---------- 梦角待回信持久化队列（20260925i） ----------
   旧实现：写信后裸 setTimeout(40s~2min) 调 charSendLetter——页面一刷新定时器就没了，
   回信永远不来（用户实测「这都好久了也没有回信」）。
   现在：待回信记录写进 kv('pendingLetterReplies')，三路互补保证必达——
   1) 入队时排一个精确 setTimeout（页面不关就准点送到）；
   2) 10 秒一轮的兜底轮询（浏览器节流/休眠唤醒后也能补投）；
   3) 启动时立即补投所有已到期记录（上次关页面错过的回信，一打开就送到）。
   先出队再投递 + 互斥标记，保证任何情况下不会重复投递。 */
async function scheduleLetterReply(c, replyToText, replyToMsgId, delay = null) {
  const list = (await getSetting('pendingLetterReplies', [])).filter(x => x && x.charId && x.replyToMsgId);
  const rec = {
    id: uid('plr'), charId: c.id, replyToText: replyToText || '', replyToMsgId,
    dueAt: Date.now() + (delay != null ? delay : 40000 + Math.floor(Math.random() * 80000)),
  };
  list.push(rec);
  await setSetting('pendingLetterReplies', list);
  setTimeout(() => { deliverDueLetterReplies().catch(() => {}); }, Math.max(200, rec.dueAt - Date.now() + 100));
  return rec;
}

let _deliveringLetterReplies = false;
async function deliverDueLetterReplies() {
  if (_deliveringLetterReplies) return;
  _deliveringLetterReplies = true;
  try {
    const list = await getSetting('pendingLetterReplies', []);
    if (!list.length) return;
    const now = Date.now();
    const due = list.filter(r => r && r.dueAt <= now);
    if (!due.length) return;
    await setSetting('pendingLetterReplies', list.filter(r => !due.includes(r))); // 先出队，防重投
    for (const r of due) {
      const c = characters.find(x => x.id === r.charId);
      if (c) await charSendLetter(c, { replyToText: r.replyToText, replyToMsgId: r.replyToMsgId });
    }
  } finally {
    _deliveringLetterReplies = false;
  }
}

function startLetterReplyWatcher() {
  deliverDueLetterReplies().catch(() => {}); // 启动即补投到期的（含上次关页面错过的）
  setInterval(() => { deliverDueLetterReplies().catch(() => {}); }, 10 * 1000);
}

/* 火漆印开信全屏动画：点击信封 → 火漆印上移消失 + 盖片翻开 + 信纸弹出。
   一对一线程（用户修正）：只有「梦角的根信（来信）且玩家还没回过」才显示回信按钮；
   回信本身（reply）不再显示回信按钮——线程一轮即结束，杜绝没完没了。
   20260929ah：opts.noAnim = 从信箱打开——不播开信动画，直接呈现信纸（只有
   第一次收到信（含回信）或从聊天页点信封才播动画） */
async function openLetterOverlay(msg, c, opts = {}) {
  const ch = c || characters.find(x => x.id === msg.charId);
  let canReply = false;
  if (msg.from === 'them' && !msg.reply) {
    try {
      const all = await idbGetAll('messages');
      const tid = msg.threadId || msg.id;
      canReply = !all.some(x => x.type === 'letter' && x.from === 'me' && x.threadId === tid);
    } catch (e) { canReply = true; }
  }
  const overlay = document.createElement('div');
  overlay.className = 'letter-overlay' + (opts.noAnim ? ' instant' : '');
  overlay.innerHTML = `
    <div class="letter-env">
      <div class="env-body"></div>
      <div class="env-paper"></div>
      <div class="env-flap"></div>
      <div class="env-seal">🕯️</div>
    </div>
    <div class="letter-hint">${msg.read ? '点击空白处收起信纸' : (ch ? escapeHtml(ch.name) : '梦角') + ' 寄来一封火漆封信 · 点击拆开'}</div>
    <button class="letter-reply" id="letter-reply-btn" style="display:none;">✍️ 给 ${escapeHtml(ch ? ch.name : 'TA')} 回信</button>
  `;
  document.body.appendChild(overlay);
  const paper = overlay.querySelector('.env-paper');
  // 20260929bk：信纸结构化排版——顶部寄件人小字 + 字距标题 + 居中正文（参考「远方来信」版式）
  const whoName = ch ? escapeHtml(ch.name) : '梦角';
  const render = () => {
    const text = String(msg.content.text || '');
    paper.classList.add('lp-rich');
    paper.innerHTML = `
      <div class="lp-head">
        <div class="lp-who">${whoName}</div>
        <div class="lp-sub">沉睡回音 ⋆｡°✩ Echoes of Slumber ✩°｡⋆</div>
      </div>
      <div class="lp-body">${escapeHtml(text)}</div>
      <div class="lp-foot">· 见字如面 ·</div>`;
  };
  const markRead = async () => {
    if (!msg.read) {
      msg.read = true;
      await idbPut('messages', msg);
      const el = document.querySelector(`.msg-row[data-msgid="${msg.id}"] .letter-card .lc-unread`);
      if (el) el.remove();
    }
  };
  if (opts.noAnim) {
    // 无动画直开：信封直接呈翻开态，信纸已展开
    const env = overlay.querySelector('.letter-env');
    env.classList.add('opened');
    render();
    await markRead();
    overlay.querySelector('.letter-hint').textContent = '点击空白处收起信纸';
    const rb = overlay.querySelector('.letter-reply');
    if (rb && canReply) rb.style.display = 'inline-flex';
    env.onclick = async () => { overlay.remove(); };
  } else {
    overlay.querySelector('.letter-env').onclick = async () => {
      const env = overlay.querySelector('.letter-env');
      if (!env.classList.contains('opened')) {
        env.classList.add('opened');
        render();
        await markRead();
        overlay.querySelector('.letter-hint').textContent = '点击空白处收起信纸';
        const rb = overlay.querySelector('.letter-reply');
        if (rb && canReply) rb.style.display = 'inline-flex'; // 拆开来信后可回信（仅根信且未回过）
      } else {
        overlay.remove();
      }
    };
  }
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const replyBtn = overlay.querySelector('.letter-reply');
  if (replyBtn) replyBtn.onclick = (e) => {
    e.stopPropagation();
    overlay.remove();
    showLetterComposeModal(msg.charId, { reply: true, threadId: msg.threadId || msg.id, replyToMsgId: msg.id });
  };
}

/* 梦角主动寄书信心跳（20260930 修复：原 9% 随机 + 30 分钟间隔导致来信极稀疏、
   体感「停滞」；改为固定间隔 + 启动即查，受每日上限约束）。
   每 LETTER_INTERVAL 分钟检查一次：当天未达每日上限的访客依次寄一封；
   页面加载即先跑一轮，不再干等一个间隔周期。 */
const LETTER_INTERVAL_MIN = 45;  // 主动寄信固定间隔（分钟）
function charLetterLimit(c) { 
  const s = getCharChatSettings(c);
  if (s.lettersEnabled === false) return 0; // 主动寄书信总开关关闭
  return Math.min(5, Math.max(0, parseInt(s.lettersDailyLimit ?? 2, 10) || 0));
}

function startLetterTimer() {
  const tick = async () => {
    try {
      const start = startOfToday();
      for (const c of characters) {
        const limit = charLetterLimit(c);
        if (limit <= 0) continue;
        const todayLetters = (await idbGetMessagesByChar(c.id, 500)).filter(m => m.type === 'letter' && m.from === 'them' && m.time >= start).length;
        if (todayLetters >= limit) continue;
        await charSendLetter(c);
      }
    } catch (e) {}
  };
  tick();                              // 启动即查一轮（20260930：不再干等首个间隔）
  setInterval(tick, LETTER_INTERVAL_MIN * 60e3);
}

/* ============================================================
   世界树（玩家主页核心功能：世界观/访客背景设定库）
   · 文件夹 + 文本条目 + 图片条目；批量管理；关灯模式
   · AI 读取权限：默认全部允许，可按条目/文件夹设置允许哪些角色的 AI 读取
   · 草稿箱：输入超 100 字点取消 → 提示是否存草稿，草稿 AI 绝对不读
   · 上传：仅 Word(.docx) 与图片；Word 本地提取纯文本，图片压缩+OCR（降级插图存档）
   · 单文件上限 20MB；解析走内联 Web Worker，不阻塞 UI，可跳过仅存原文件
   数据：kv.worldBook { folders:[], entries:[] }、kv.worldBookDrafts
   ============================================================ */
const WORLD_MAX_FILE = 20 * 1024 * 1024;   // 单文件 20MB 上限
const WORLD_IMG_MAX = 2 * 1024 * 1024;     // 图片压缩目标 ≤2MB

async function loadWorldBook() {
  return await getSetting('worldBook', { folders: [], entries: [] });
}
async function saveWorldBook(wb) {
  await setSetting('worldBook', wb);
}
async function loadWorldDrafts() {
  return await getSetting('worldBookDrafts', []);
}
async function saveWorldDrafts(list) {
  await setSetting('worldBookDrafts', list);
}

/* ============================================================
   20260930bz：世界树「权限三态 + 本地关键词/摘要预提取 + AI 精炼后台队列」
   · 权限三态：allowAll === undefined 表示「跟随文件夹」（未单独设置）；
     allowAll === true = 单独设「全部可读」；allowAll === false = 单独设「禁读/指定访客」。
     与记忆宫殿 allowAI 三态同构，一劳永逸。历史数据 allowAll:true 在判定侧一律按「跟随」处理
     （通过 isExplicitAllow 判定：只有「显式单独设置过」才覆盖文件夹权限）。
   · 本地关键词：保存/上传时一次性提取 autoKeywords（高频词去停用词 + 人名地名），
     存条目，聊天触发时优先匹配；复用 isLineJunkText 去脏数据/符号。
   · 摘要粗提取：本地按段落截取 summary 兜底；AI 精炼后覆盖。
   · AI 精炼队列：串行后台，防重复（ai_summary_generated），断网/无 API 挂起，UI 无感状态。
   ============================================================ */

/* 世界树中文停用词（本地关键词提取用；只剔除最通用无信息量词，保留实义词） */
const WORLD_STOPWORDS = new Set(['的','了','和','是','在','我','你','他','她','它','我们','你们','他们','这','那','有','就','不','也','都','而','及','与','或','一个','一种','这个','那个','这些','那些','因为','所以','但是','如果','然后','以及','还有','一样','可以','没有','什么','怎么','为什么','时候','自己','它们','一些','其他','其中','进行','通过','对于','关于','已经','这个','这样','那样','地','得','着','过','吧','呢','啊','哦','么','之','其','被','把','让','被','等','中','里','外','上','下','前','后','内','间','为','以','到','从','向','对','比','但','并','却','只是','就是','还是','只是','不是','没有']);

/* 从一段纯文本里提取本地关键词（高频词 + 人名/地名启发式）。
   返回字符串数组（去重、有序）。纯本地，无网可用。 */
function worldExtractKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  // 去脏：剥离零宽字符/BOM/变体选择符（复用全局清洗思路，与 isLineJunkText 同源）
  let s = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u180E\u00AD\uFE00-\uFE0F]/g, '');
  // 只保留中文/字母/数字，其余转空格分隔
  s = s.replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, ' ');
  const freq = new Map();
  const tokens = [];
  // 中文按 2~4 字滑窗取片段；英文/数字按空白词取整词
  const segs = s.split(/\s+/).filter(Boolean);
  for (const seg of segs) {
    if (/^[\u4e00-\u9fa5]+$/.test(seg)) {
      const arr = Array.from(seg);
      if (arr.length <= 4) { tokens.push(seg); continue; }
      // 长中文串：2~4 字滑窗
      for (let len = 4; len >= 2; len--) {
        for (let i = 0; i + len <= arr.length; i++) {
          tokens.push(arr.slice(i, i + len).join(''));
        }
      }
    } else {
      // 英文/数字整词（长度≥2）
      if (seg.length >= 2) tokens.push(seg);
    }
  }
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (k.length < 2) continue;
    if (WORLD_STOPWORDS.has(k)) continue;
    freq.set(k, (freq.get(k) || 0) + 1);
  }
  // 按词频降序，取前 12 个（词频≥2 优先，不足则取前几名）
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const min2 = sorted.filter(k => (freq.get(k) || 0) >= 2);
  const picked = (min2.length >= 3 ? min2 : sorted).slice(0, 12);
  return picked;
}

/* 本地摘要粗提取：按段落（换行/句号）截取开头若干段，限制长度。AI 精炼后覆盖。 */
function worldExtractSummary(text) {
  if (!text || typeof text !== 'string') return '';
  let s = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u180E\u00AD\uFE00-\uFE0F]/g, '').trim();
  if (!s) return '';
  // 按换行或句号/分号粗切段落
  const paras = s.split(/\n+|(?<=[。！？!?；;])/).map(p => p.trim()).filter(Boolean);
  let sum = '';
  for (const p of paras) {
    if (sum.length >= 160) break;
    sum += (sum ? ' ' : '') + p;
  }
  if (sum.length > 200) sum = sum.slice(0, 200) + '…';
  return sum;
}

/* 世界树条目是否「显式单独设置过权限」（allowAll 非 undefined，或指定了访客）。
   只有显式设置过才覆盖文件夹权限；否则一律跟随文件夹。 */
function worldEntryExplicit(e) {
  return e && (e.allowAll !== undefined || (Array.isArray(e.allowCharIds) && e.allowCharIds.length > 0));
}

/* 世界树文件夹是否「显式设置过权限」 */
function worldFolderExplicit(f) {
  return f && (f.allowAll !== undefined || (Array.isArray(f.allowCharIds) && f.allowCharIds.length > 0));
}

/* AI 精炼后台队列状态（模块级单例） */
let _worldAIQueue = [];      // 待精炼条目 id 队列
let _worldAIProcessing = false;
let _worldAIStarted = false; // 是否已尝试启动（避免重复入队监听）

/* 把「需要 AI 精炼」的世界树条目加入后台串行队列。
   触发条件：AI 模式开启 + 条目字数 > 200 + 未生成过（无 ai_summary_generated）。 */
async function worldQueueAIRefine() {
  try {
    const aiOn = await isAIMode();
    if (!aiOn) return;
    const wb = await loadWorldBook();
    if (!wb || !Array.isArray(wb.entries)) return;
    let changed = false;
    for (const e of wb.entries) {
      if (e.draft || e.ai_summary_generated) continue;
      const body = e.type === 'image' ? (e.ocr || '') : (e.text || '');
      if (!body || body.length <= 200) continue;
      if (_worldAIQueue.includes(e.id)) continue;
      _worldAIQueue.push(e.id);
    }
    if (!_worldAIStarted) {
      _worldAIStarted = true;
      worldProcessAIQueue();
    }
  } catch (e) {}
}

/* 后台串行处理 AI 精炼队列：一个处理完再下一个；断网/无 API 时挂起（本地粗提取兜底）。 */
async function worldProcessAIQueue() {
  if (_worldAIProcessing) return;
  _worldAIProcessing = true;
  try {
    while (_worldAIQueue.length) {
      const id = _worldAIQueue[0];
      const ok = await worldRefineEntryAI(id);
      if (!ok) {
        // 失败（断网/无 API/被限流）：挂起，保留队列，等下次触发重试
        break;
      }
      _worldAIQueue.shift();
    }
  } finally {
    _worldAIProcessing = false;
  }
}

/* 用 AI 精炼单个条目：生成摘要 + 核心关键词，覆盖本地粗提取；成功后打 ai_summary_generated 标记。
   返回 true=成功（继续队列），false=失败（挂起队列）。 */
async function worldRefineEntryAI(id) {
  try {
    const aiOn = await isAIMode();
    if (!aiOn) return false;
    const cfg = await loadAIConfig();
    const { url, key, model } = (cfg && cfg.chatApi) || {};
    if (!url || !url.trim()) return false;
    const wb = await loadWorldBook();
    const e = wb.entries.find(x => x.id === id);
    if (!e || e.ai_summary_generated) return true; // 已生成/已删，视为完成
    const body = e.type === 'image' ? (e.ocr || '') : (e.text || '');
    if (!body || body.length <= 200) { e.ai_summary_generated = true; await saveWorldBook(wb); return true; }
    const r = await callAI(url, key, model, [
      { role: 'system', content: '你是世界观设定库的整理助手。请把用户给出的世界观文本，压缩成：①一句不超过 40 字的中文精炼摘要；②3~8 个核心关键词（人名、地名、专有名词优先，逗号分隔）。只输出两行，第一行摘要，第二行关键词，不要任何额外解释。' },
      { role: 'user', content: body.slice(0, 3000) },
    ], { temperature: 0.3 });
    if (!r || !r.ok) return false;
    // 解析：第一行=摘要，第二行=关键词
    const lines = (r.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const summary = lines[0] || '';
    const kwLine = lines[1] || '';
    const kws = kwLine.split(/[,，、;；]/).map(k => k.trim()).filter(k => k.length >= 2).slice(0, 8);
    e.summary = summary;
    if (kws.length) e.aiKeywords = kws;
    e.ai_summary_generated = true;
    await saveWorldBook(wb);
    worldRefreshRefineStatusUI(id, 'ready');
    return true;
  } catch (err) {
    return false;
  }
}

/* 刷新条目右下角打字机状态（Status: AI Refining... / Ready）。
   世界树界面打开时渲染，队列处理时动态更新。 */
function worldRefreshRefineStatusUI(id, status) {
  const el = document.querySelector(`[data-wb-status="${id}"]`);
  if (el) {
    el.textContent = status === 'ready' ? 'Status: Ready' : 'Status: AI Refining...';
    el.classList.toggle('ready', status === 'ready');
  }
}

/* 世界树主界面（20260929k 重排）：
   · 文件夹与条目统一为同样式的一行；行尾「AI 权限」「删除」独立大按钮，不再挤在一起
   · 草稿箱入口常驻根视图；根视图 = 草稿箱 + 文件夹行 + 未归类条目 + 新建文件夹
   · 点文件夹行进入文件夹内视图（顶部返回行）
   · 关灯模式：黑灰圆从右上角蔓延变暗（clip-path 动画），勾选 UI 提亮形成对比
   · 子弹窗（AI 权限/查看/编辑/草稿箱/上传）保存或关闭后回退到本界面 */
/* 20260929ah：记录世界树当前视图（'root' 或文件夹 id）——子弹窗（新建/上传/查看/权限/草稿箱）
   完成后回"上一功能"（打开它时所在的视图），不再越级跳回总界面；关闭弹窗时重置回根 */
let _wbLastView = 'root';
async function showWorldBookModal(startView) {
  let wb = await loadWorldBook();
  if (!wb || !Array.isArray(wb.folders)) wb = { folders: [], entries: [] };
  const drafts = await loadWorldDrafts();
  let view = (typeof startView === 'string' && startView && startView !== 'root') ? startView : (_wbLastView || 'root');
  if (view !== 'root' && !wb.folders.some(f => f.id === view)) view = 'root'; // 文件夹已被删则回根
  let batchMode = false;       // 关灯模式 = 批量管理模式
  const selected = new Set();  // 条目 id（批量勾选）
  /* 20260929bc：关键词检索——标题/正文/OCR 全量过滤，根视图与文件夹视图都生效 */
  let wbQuery = '';

  function entryTitle(e) {
    if (e.type === 'image') return e.ocr || '(图片插图)';
    return e.text || '(空条目)';
  }
  /* AI 权限状态标签（20260930bz：区分「跟随」vs「单独设置」，纯文字，注意配色可读性
     20260930ca：跟随条目也显示文件夹的有效权限（跟随·全部可读 / N 个访客 / 禁读）；
     从未设置过权限的文件夹 = 默认全部可读（不再误标「AI·禁读」））
     · 文件夹：显示「全部可读 / N 个访客 / 禁读」（文件夹本身是权限源，无「跟随」概念）
     · 条目未显式设置 → 「跟随·X」，X = 所在文件夹的有效权限（未归类条目只显示「跟随」，走默认全部可读）
     · 条目显式设置 → 「单独设置」，并标注具体结果（全部可读/N 个访客/禁读） */
  function aiTagOf(obj, isFolder) {
    if (isFolder) {
      if (obj.allowAll === true) return '<span class="wb-aitag">AI·全部可读</span>';
      const n = (obj.allowCharIds || []).length;
      if (n) return `<span class="wb-aitag">AI·${n} 个访客</span>`;
      // 显式禁读才标红；从未设置过（undefined 且无指定访客）= 默认全部可读
      return obj.allowAll === false ? '<span class="wb-aitag off">AI·禁读</span>' : '<span class="wb-aitag">AI·全部可读</span>';
    }
    if (!worldEntryExplicit(obj)) {
      const f = wb.folders.find(x => x.id === obj.folderId);
      if (!f) return '<span class="wb-aitag follow">跟随</span>'; // 未归类：无文件夹可跟，走默认全部可读
      if (f.allowAll === true) return '<span class="wb-aitag follow">跟随·全部可读</span>';
      const fn = (f.allowCharIds || []).length;
      if (fn) return `<span class="wb-aitag follow">跟随·${fn} 个访客</span>`;
      if (f.allowAll === false) return '<span class="wb-aitag follow off">跟随·禁读</span>';
      return '<span class="wb-aitag follow">跟随·全部可读</span>'; // 文件夹也未设置 = 默认全部可读
    }
    if (obj.allowAll === true) return '<span class="wb-aitag solo">单独设置·全部可读</span>';
    const n = (obj.allowCharIds || []).length;
    return n ? `<span class="wb-aitag solo">单独设置·${n} 个访客</span>` : '<span class="wb-aitag solo off">单独设置·禁读</span>';
  }
  const entryCount = (fid) => wb.entries.filter(e => (e.folderId || '') === fid).length;

  /* AI 精炼状态（打字机字体小字）：后台队列处理中显示 Refining，完成后 Ready */
  function worldRefineStatusHtml(e) {
    if (e.draft) return '';
    const body = e.type === 'image' ? (e.ocr || '') : (e.text || '');
    if (!body || body.length <= 200) return '';               // 不足 200 字不参与精炼
    if (e.ai_summary_generated) return '<span class="wb-refine ready" data-wb-status="' + e.id + '">Status: Ready</span>';
    // 待精炼（可能在队列中，或 AI 模式未开）
    return '<span class="wb-refine" data-wb-status="' + e.id + '">Status: AI Refining...</span>';
  }

  openModal(`
    <div id="wb-root">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <div style="font-size:18px;font-weight:600;">世界树</div>
          <span class="badge" id="wb-count"></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="icon-btn" id="wb-lamp" title="批量管理（关灯模式）">${icon('orb', 17)}</button>
          <button class="icon-btn" id="wb-close">${icon('close', 18)}</button>
        </div>
      </div>
      <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:10px;">存放世界观设定、访客背景等；AI 按<b>关键词/人名</b>触发读取相关条目，点行尾「AI 权限」设置哪些访客可读</div>
      <div class="pal-searchbar" style="margin-bottom:10px;">
        ${icon('search', 15)}
        <input class="input" id="wb-search" placeholder="检索设定关键词…" value="${escapeHtml(wbQuery || '')}">
        ${wbQuery ? `<button class="pal-search-clear" id="wb-search-clear">${icon('close', 13)}</button>` : ''}
      </div>
      <div id="wb-body"></div>
      <div class="wb-batchbar" id="wb-batchbar">
        <button class="btn" id="wb-selall">全选</button>
        <button class="btn danger" id="wb-del">删除</button>
        <button class="btn" id="wb-move" style="flex:1.2;">移动到…</button>
        <button class="btn" id="wb-done">完成</button>
      </div>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <button class="btn primary" style="flex:1;" id="wb-add-text">＋ 新建文本</button>
        <button class="btn" style="flex:1;" id="wb-add-file">${icon('upload', 15)} 上传文件</button>
      </div>
    </div>
  `);
  $('#wb-close').onclick = () => { _wbLastView = 'root'; closeModal(); };
  // 搜索条（20260929bc）：输入即过滤；20260929bd：composition 守卫（拼音组词不触发检索）
  bindPalSearch($('#wb-search'), palDebounce((v) => { wbQuery = v; render(); }, 280));
  const wbClr = $('#wb-search-clear');
  if (wbClr) wbClr.onclick = () => { wbQuery = ''; $('#wb-search').value = ''; render(); };

  /* 关灯动画：只在灯图标附近扩散圆环涟漪，不蒙灰、不影响界面其他部分 */
  function lampRipple() {
    const lamp = $('#wb-lamp');
    if (!lamp) return;
    const r = lamp.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 2; i++) {
      const ring = document.createElement('div');
      ring.className = 'wb-ripple';
      ring.style.left = cx + 'px';
      ring.style.top = cy + 'px';
      ring.style.animationDelay = (i * 0.14) + 's';
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 1100 + i * 140);
    }
  }

  const lampOn = () => {
    batchMode = true; selected.clear();
    $('#wb-lamp').innerHTML = icon('orb', 17);
    $('#wb-root').classList.add('batching');
    lampRipple();
  };
  const lampOff = () => {
    batchMode = false; selected.clear();
    $('#wb-lamp').innerHTML = icon('orb', 17);
    $('#wb-root').classList.remove('batching');
    lampRipple();
  };
  $('#wb-lamp').onclick = () => { batchMode ? lampOff() : lampOn(); render(); };

  function entryRowHtml(e) {
    const checked = selected.has(e.id);
    return `
      <div class="wb-item" data-wid="${e.id}" style="${batchMode ? 'cursor:pointer;' : ''}">
        ${batchMode ? `<div class="lr-check${checked ? ' on' : ''}">✓</div>` : ''}
        <div class="wb-ic">${e.type === 'image' ? icon('image', 20) : icon('doc', 20)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(entryTitle(e))}</div>
          <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:2px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${aiTagOf(e)}${e.draft ? '<span class="badge" style="color:var(--danger);">草稿</span>' : ''}${worldRefineStatusHtml(e)}</div>
        </div>
        ${batchMode ? '' : `<button class="wb-act ai" data-wai="${e.id}">AI 权限</button>
        <button class="wb-act danger" data-wdel="${e.id}">删除</button>`}
      </div>`;
  }

  function bindEntryRows(scope) {
    scope.querySelectorAll('.wb-item[data-wid]').forEach(el => {
      el.onclick = () => {
        const e = wb.entries.find(x => x.id === el.dataset.wid);
        if (!e) return;
        if (batchMode) {
          if (selected.has(e.id)) selected.delete(e.id); else selected.add(e.id);
          render();
          return;
        }
        showWorldEntryView(e);
      };
    });
  }

  /* 行尾「AI 权限」「删除」独立按钮（文件夹 + 条目通用）；删除为两段确认（不顶掉当前界面） */
  function bindRowActions(scope) {
    scope.querySelectorAll('[data-wai]').forEach(b => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        const e = wb.entries.find(x => x.id === b.dataset.wai);
        if (e) await showWorldEntryAccessModal(e);
      };
    });
    scope.querySelectorAll('[data-wai-f]').forEach(b => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        const f = wb.folders.find(x => x.id === b.dataset.waiF);
        if (f) await showWorldEntryAccessModal(f);
      };
    });
    scope.querySelectorAll('[data-wdel]').forEach(b => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = '确认?'; setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = '删除'; } }, 2500); return; }
        wb.entries = wb.entries.filter(x => x.id !== b.dataset.wdel);
        await saveWorldBook(wb);
        miniToast('已删除');
        render();
      };
    });
    scope.querySelectorAll('[data-wdel-f]').forEach(b => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = '确认?'; setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = '删除'; } }, 2500); return; }
        const fid = b.dataset.wdelF;
        wb.folders = wb.folders.filter(x => x.id !== fid);
        wb.entries.forEach(e => { if (e.folderId === fid) e.folderId = ''; });
        if (view === fid) view = 'root';
        await saveWorldBook(wb);
        miniToast('文件夹已删除，内容移入未归类');
        render();
      };
    });
  }

  function renderRoot(body) {
    const folderRows = wb.folders.map(f => `
      <div class="wb-item" data-wf="${f.id}">
        <div class="wb-ic">${icon('folder', 20)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.name)}</div>
          <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:2px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><span>${entryCount(f.id)} 条内容</span>${aiTagOf(f, true)}</div>
        </div>
        ${batchMode ? '' : `<button class="wb-act ai" data-wai-f="${f.id}">AI 权限</button>
        <button class="wb-act danger" data-wdel-f="${f.id}">删除</button>`}
      </div>`).join('');

    const noneEntries = wb.entries.filter(e => !e.folderId);
    const entryRows = noneEntries.map(entryRowHtml).join('');

    body.innerHTML = `
      <div class="wb-item" id="wb-drafts-row">
        <div class="wb-ic">${icon('draft', 20)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:600;">草稿箱 <span class="badge">${drafts.length}</span></div>
          <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:2px;">未编辑完的内容 · AI 绝对不读</div>
        </div>
        <span style="color:var(--text-tertiary);flex-shrink:0;">›</span>
      </div>
      ${wbQuery ? (() => {
        // 20260929bd：检索命中不止内容——夹名匹配或夹内有匹配内容的文件夹也列出来
        const ql = wbQuery.toLowerCase();
        const hits = wb.entries.filter(e => entryTitle(e).toLowerCase().includes(ql));
        const fHits = wb.folders.filter(f => (f.name || '').toLowerCase().includes(ql) || hits.some(e => (e.folderId || '') === f.id));
        return `
        <div style="font-size:12px;color:var(--text-tertiary);margin:8px 2px 4px;">检索「${escapeHtml(wbQuery)}」：${fHits.length} 个文件夹 · ${hits.length} 条内容</div>
        ${fHits.map(f => `
        <div class="wb-item" data-wf="${f.id}">
          <div class="wb-ic">${icon('folder', 20)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.name)}</div>
            <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:2px;">${hits.filter(e => (e.folderId || '') === f.id).length} 条匹配 · 点击进入文件夹</div>
          </div>
          <span style="color:var(--text-tertiary);flex-shrink:0;">›</span>
        </div>`).join('')}
        ${hits.map(entryRowHtml).join('') || '<div style="font-size:12.5px;color:var(--text-tertiary);padding:4px 2px 8px;">没有匹配的内容</div>'}
      `; })() : `
      ${folderRows}
      <div style="font-size:12px;color:var(--text-tertiary);margin:12px 0 2px;">未归类内容（${noneEntries.length}）</div>
      ${entryRows || '<div style="font-size:12.5px;color:var(--text-tertiary);padding:4px 2px 8px;">（暂无未归类内容）</div>'}
      <div class="wb-item" id="wb-newfolder-row" style="border:1.5px dashed var(--border);margin-top:8px;opacity:.85;">
        <div style="font-size:22px;flex-shrink:0;color:var(--text-tertiary);">＋</div>
        <div style="flex:1;font-size:14px;color:var(--text-tertiary);">新建文件夹</div>
      </div>
      <div class="wb-newrow" id="wb-newrow" style="display:none;">
        <input class="input" id="wb-newname" placeholder="文件夹名称" style="flex:1;">
        <button class="btn primary" id="wb-newok">确定</button>
        <button class="btn" id="wb-newcancel">取消</button>
      </div>
      ${(!wb.folders.length && !wb.entries.length) ? `<div class="empty" style="padding:6px 0 14px;">
        <div class="empty-icon">${icon('tree', 34)}</div>
        <div style="font-size:13px;">新建一条文本，或上传 Word / 图片</div>
      </div>` : ''}`}
    `;

    const draftsRow = $('#wb-drafts-row');
    if (draftsRow) draftsRow.onclick = () => showWorldDraftsModal();
    const nfRow = $('#wb-newfolder-row');
    if (nfRow) nfRow.onclick = () => { $('#wb-newrow').style.display = 'flex'; $('#wb-newname').focus(); };
    const newOk = $('#wb-newok');
    if (newOk) newOk.onclick = async () => {
      const v = $('#wb-newname').value.trim();
      if (!v) { miniToast('先起个文件夹名'); return; }
      if (wb.folders.some(f => f.name === v)) { miniToast('已有同名文件夹'); return; }
      wb.folders.push({ id: 'wf' + Date.now().toString(36), name: v });
      await saveWorldBook(wb);
      miniToast('文件夹「' + v + '」已创建');
      render();
    };
    const newCancel = $('#wb-newcancel');
    if (newCancel) newCancel.onclick = () => { $('#wb-newrow').style.display = 'none'; };
    body.querySelectorAll('[data-wf]').forEach(el => {
      el.onclick = () => { view = el.dataset.wf; selected.clear(); render(); };
    });
    bindEntryRows(body);
    bindRowActions(body);
    $('#wb-count').textContent = `${wb.folders.length} 个文件夹 · ${wb.entries.length} 条`;
  }

  function renderFolder(body) {
    const f = wb.folders.find(x => x.id === view);
    if (!f) { view = 'root'; renderRoot(body); return; }
    let items = wb.entries.filter(e => e.folderId === f.id);
    if (wbQuery) items = items.filter(e => entryTitle(e).toLowerCase().includes(wbQuery.toLowerCase()));
    body.innerHTML = `
      <div class="wb-item" id="wb-back-row">
        <div style="flex-shrink:0;color:var(--text-secondary);font-size:20px;line-height:1;">‹</div>
        <div style="flex:1;min-width:0;font-size:15px;font-weight:600;">${escapeHtml(f.name)} <span style="font-size:11.5px;color:var(--text-tertiary);font-weight:400;">· ${wbQuery ? `检索到 ${items.length} 条` : `${items.length} 条`}</span></div>
        ${batchMode ? '' : `<button class="wb-act ai" data-wai-f="${f.id}">AI 权限</button>`}
      </div>
      ${items.map(entryRowHtml).join('') || `<div style="color:var(--text-tertiary);text-align:center;padding:20px;font-size:13px;">${wbQuery ? '没有匹配的内容' : '这个文件夹还没有内容，用底部按钮添加'}</div>`}
    `;
    $('#wb-back-row').onclick = () => { view = 'root'; selected.clear(); render(); };
    bindEntryRows(body);
    bindRowActions(body);
    $('#wb-count').textContent = `${items.length} 条`;
  }

  function renderBatchBar() {
    const bar = $('#wb-batchbar');
    if (!batchMode) { bar.classList.remove('show'); return; }
    bar.classList.add('show');
    $('#wb-selall').textContent = selected.size ? '全不选' : '全选';
    $('#wb-del').textContent = selected.size ? `删除(${selected.size})` : '删除';
    $('#wb-del').dataset.confirm = '';
    // 「移动到…」改为自定义底部动作面板（原生 select 选项多时会超出屏幕）
    const mv = $('#wb-move');
    mv.textContent = selected.size ? `移动 ${selected.size} 条到…` : '移动到…';
    mv.onclick = () => {
      if (!selected.size) { miniToast('先勾选要移动的条目'); return; }
      openMoveSheet();
    };
  }

  /* 「移动到…」选择弹窗（20260929n 由底部动作面板改为居中弹窗）：列表可滚动，文件夹再多也不会超出屏幕 */
  function openMoveSheet() {
    const old = $('#wb-sheet-mask');
    if (old) old.remove();
    const cntIn = fid => wb.entries.filter(e => e.folderId === fid).length;
    const rows = [
      { to: '', name: '未归类', n: cntIn('') },
      ...wb.folders.filter(f => f.id !== view).map(f => ({ to: f.id, name: f.name, n: cntIn(f.id) })),
    ];
    const mask = document.createElement('div');
    mask.id = 'wb-sheet-mask';
    mask.innerHTML = `
      <div class="wb-sheet">
        <div class="wb-sheet-title">移动 ${selected.size} 条到…</div>
        <div class="wb-sheet-list">
          ${rows.map(r => `
            <div class="wb-sheet-row" data-to="${r.to}">
              <span style="flex-shrink:0;display:flex;color:var(--text-secondary);">${icon('folder', 16)}</span>
              <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.name)}</span>
              <span style="flex-shrink:0;font-size:11.5px;color:var(--text-tertiary);">${r.n} 条</span>
            </div>`).join('') || '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:13px;">还没有文件夹</div>'}
        </div>
        <button class="btn block" id="wb-sheet-cancel">取消</button>
      </div>
    `;
    /* 挂到 body 层 fixed 居中弹窗（z 高于弹窗容器 100），列表内部滚动，文件夹再多也不溢出 */
    document.body.appendChild(mask);
    mask.onclick = (ev) => { if (ev.target === mask) mask.remove(); };
    $('#wb-sheet-cancel').onclick = () => mask.remove();
    mask.querySelectorAll('.wb-sheet-row').forEach(row => {
      row.onclick = async () => {
        wb.entries.forEach(e => { if (selected.has(e.id)) e.folderId = row.dataset.to; });
        await saveWorldBook(wb);
        miniToast('已移动 ' + selected.size + ' 条');
        selected.clear();
        mask.remove();
        render();
      };
    });
  }

  /* 20260930cd：视图级滚动位记忆——进入/返回/勾选/删除后都回到该视图上次的滚动位
     （滚动容器是 #wb-body：max-height 42vh 内滚，弹窗本体不滚） */
  let _wbShownView = view;
  const _wbScrollMem = {};
  function render() {
    const body = $('#wb-body');
    if (body) _wbScrollMem[_wbShownView] = body.scrollTop; // 离开当前视图前记录
    if (view === 'root') renderRoot(body); else renderFolder(body);
    renderBatchBar();
    _wbLastView = view; // 20260929ah：记录当前视图，供子弹窗完成后回"上一功能"
    _wbShownView = view;
    requestAnimationFrame(() => {
      const b2 = $('#wb-body');
      if (b2 && _wbScrollMem[view] !== undefined) b2.scrollTop = _wbScrollMem[view];
    });
  }

  $('#wb-selall').onclick = () => {
    const items = view === 'root' ? wb.entries.filter(e => !e.folderId) : wb.entries.filter(e => e.folderId === view);
    if (selected.size) selected.clear();
    else items.forEach(e => selected.add(e.id));
    render();
  };
  $('#wb-del').onclick = async () => {
    if (!selected.size) { miniToast('先勾选要删除的条目'); return; }
    const b = $('#wb-del');
    if (!b.dataset.confirm) {
      b.dataset.confirm = '1';
      b.textContent = '确认删除?';
      setTimeout(() => { if (b.isConnected && batchMode) { b.dataset.confirm = ''; b.textContent = selected.size ? `删除(${selected.size})` : '删除'; } }, 2500);
      return;
    }
    wb.entries = wb.entries.filter(e => !selected.has(e.id));
    await saveWorldBook(wb);
    selected.clear();
    miniToast('已删除');
    render();
  };
  $('#wb-done').onclick = () => { lampOff(); render(); };
  $('#wb-add-text').onclick = () => showWorldCreateModal(view === 'root' ? '' : view);
  $('#wb-add-file').onclick = () => showWorldUploadModal(view === 'root' ? '' : view);

  render();
  worldQueueAIRefine(); // 20260930bz：打开世界树时后台补 AI 精炼队列（AI 模式 + >200字 + 未生成）
}

/* 查看单条内容（文本全文 / 图片大图）：✕/编辑/删除后回世界树总界面（不直接退出）
   20260929r：正文用米黄信纸底 + 16px 大字；Word 导入的条目优先渲染 e.html
   （保留标题/加粗/斜体/下划线/列表，worker 生成的受控 HTML，内容已转义） */
function showWorldEntryView(e) {
  const ocrPaper = (e.type === 'image' && e.ocr)
    ? `<div class="wb-paper" style="margin-top:12px;">${escapeHtml(e.ocr)}</div>` : '';
  const body = e.type === 'image'
    ? `<img src="${imgSrc(e.img)}" style="width:100%;border-radius:14px;display:block;">${ocrPaper}`
    : `<div class="wb-paper wb-doc">${e.html ? e.html : escapeHtml(e.text || '')}</div>`;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">${e.type === 'image' ? '图片' : '世界树内容'}</div>
      <button class="icon-btn" id="wv-close">✕</button>
    </div>
    ${e.draft ? '<div style="font-size:12px;color:var(--danger);margin-bottom:10px;">这是草稿，AI 模式下不会读取</div>' : ''}
    ${body}
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn" style="flex:1;" id="wv-access">AI 读取权限</button>
      <button class="btn" style="flex:1;" id="wv-edit">${e.type === 'image' ? '重新OCR' : '编辑'}</button>
      <button class="btn danger" style="flex:1;" id="wv-del">删除</button>
    </div>
  `);
  $('#wv-close').onclick = () => showWorldBookModal();
  $('#wv-access').onclick = () => showWorldEntryAccessModal(e);
  // 删除用两段确认（showConfirm 会顶掉当前弹窗，取消后会退出到主页而不是回到世界树）
  $('#wv-del').onclick = () => {
    const b = $('#wv-del');
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = '确认删除?'; setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = '删除'; } }, 2500); return; }
    (async () => {
      const wb = await loadWorldBook();
      wb.entries = wb.entries.filter(x => x.id !== e.id);
      await saveWorldBook(wb);
      miniToast('已删除');
      showWorldBookModal();
    })();
  };
  $('#wv-edit').onclick = () => {
    if (e.type === 'image') { miniToast('重新 OCR 需重新上传图片'); return; }
    showWorldCreateModal(e.folderId || '', e);
  };
}

/* 设置某条/某文件夹内容允许哪些角色的 AI 读取（20260930bz：三态 + 跟随文件夹）
   target 为 entry 对象（含 type 字段）或 folder 对象（{id,name}，无 type 字段）。
   保存/关闭后回世界树总界面（20260929k：不再直接退出） */
async function showWorldEntryAccessModal(target) {
  const targetIsFolder = !('type' in target);
  const isEntry = !targetIsFolder;
  // 三态读取：allowAll===undefined=跟随；true=全部可读；false=禁读/指定
  const isFollow = target.allowAll === undefined && !(Array.isArray(target.allowCharIds) && target.allowCharIds.length);
  const allowAll = target.allowAll === true;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">AI 读取权限</div>
      <button class="icon-btn" id="wa-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
      ${targetIsFolder ? `文件夹「${escapeHtml(target.name)}」` : '这条内容'}当前：<b>${isFollow ? '跟随文件夹' : (allowAll ? '允许所有访客 AI 读取' : '仅允许勾选的访客')}</b>
    </div>
    ${isEntry ? `<button class="btn block" id="wa-follow" style="margin-bottom:8px;${isFollow ? 'background:var(--purple-dim);' : ''}">↺ 跟随文件夹（清除单独设置）</button>` : ''}
    <button class="btn block" id="wa-all" style="margin-bottom:8px;${allowAll ? 'background:var(--purple-dim);' : ''}">允许所有访客读取</button>
    <button class="btn block" id="wa-none" style="margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px;">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="M6.2 6.2l11.6 11.6"/></svg>
      禁止 AI 读取
    </button>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin:10px 0 8px;">或仅允许以下访客读取（不勾任何 = 全部禁读）</div>
    ${characters.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
        ${characters.map(c => {
          const on = (target.allowCharIds || []).includes(c.id);
          return `<span class="badge wa-chip" data-cid="${c.id}" style="cursor:pointer;${on ? 'background:var(--purple);color:#141019;' : ''}">${escapeHtml(c.name)}</span>`;
        }).join('')}
      </div>` : '<div style="color:var(--text-tertiary);font-size:12.5px;margin-bottom:12px;">还没有访客</div>'}
    <button class="btn primary block" id="wa-save">保存</button>
  `);
  let mode = isFollow ? 'follow' : (allowAll ? 'all' : 'custom');
  const picked = new Set(target.allowCharIds || []);
  const paintAll = () => { $('#wa-all').style.background = mode === 'all' ? 'var(--purple-dim)' : ''; };
  $('#wa-close').onclick = () => showWorldBookModal();
  const waFollow = $('#wa-follow');
  if (waFollow) waFollow.onclick = () => {
    mode = 'follow';
    paintAll();
    document.querySelectorAll('.wa-chip').forEach(chip => { chip.style.background = ''; chip.style.color = ''; });
    miniToast('将跟随文件夹权限，点「保存」生效');
  };
  $('#wa-all').onclick = () => {
    mode = mode === 'all' ? 'custom' : 'all';
    paintAll();
    if (mode === 'all') picked.clear();
  };
  // 禁止 AI 读取（20260929ah）：一键关死，不勾任何角色
  $('#wa-none').onclick = () => {
    mode = 'none';
    picked.clear();
    paintAll();
    document.querySelectorAll('.wa-chip').forEach(chip => { chip.style.background = ''; chip.style.color = ''; });
    miniToast('将禁止 AI 读取，点「保存」生效');
  };
  document.querySelectorAll('.wa-chip').forEach(chip => {
    chip.onclick = () => {
      mode = 'custom';
      paintAll();
      const cid = chip.dataset.cid;
      if (picked.has(cid)) { picked.delete(cid); chip.style.background = ''; chip.style.color = ''; }
      else { picked.add(cid); chip.style.background = 'var(--purple)'; chip.style.color = '#141019'; }
    };
  });
  $('#wa-save').onclick = async () => {
    // 按 id 在最新数据里定位后再写（target 引用可能来自旧一轮加载的 wb，直接改它不会落库）
    const wb = await loadWorldBook();
    const t = targetIsFolder ? wb.folders.find(x => x.id === target.id) : wb.entries.find(x => x.id === target.id);
    if (t) {
      if (mode === 'follow') {
        t.allowAll = undefined;               // 跟随文件夹（清除单独设置）
        t.allowCharIds = [];
      } else {
        t.allowAll = mode === 'all';
        t.allowCharIds = mode === 'all' ? [] : [...picked];
      }
      await saveWorldBook(wb);
      miniToast(mode === 'follow' ? '已恢复跟随文件夹' : (mode === 'none' ? '已禁止 AI 读取' : 'AI 读取权限已保存'));
    }
    showWorldBookModal();
  };
}

/* 创建世界（新建文本，5000 字上限 + 草稿箱防手滑）
   prefillText：从草稿箱续写时带入的文本。保存/取消/存草稿后回世界树总界面 */
function showWorldCreateModal(folderId = '', editEntry = null, prefillText = '') {
  const isEdit = !!editEntry;
  const initText = isEdit ? (editEntry.text || '') : (prefillText || '');
  const goBack = () => showWorldBookModal();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">${isEdit ? '编辑内容' : '新建文本'}</div>
      <button class="icon-btn" id="wc-close">✕</button>
    </div>
    <div class="wb-compose">
      <textarea id="wc-text" maxlength="5000" placeholder="写下世界观设定、访客背景…（最多 5000 字）">${escapeHtml(initText)}</textarea>
      <div class="lc-count"><span id="wc-count">${[...initText].length}</span> / 5000</div>
    </div>
    <div class="field" style="margin-top:10px;">
      <label style="font-size:12.5px;color:var(--text-secondary);">补充关键词（可选，逗号分隔；优先级最高，供 AI 精准触发）</label>
      <input class="input" id="wc-keywords" placeholder="例如：星辰神殿, 北境, 白霜骑士" value="${escapeHtml((editEntry && Array.isArray(editEntry.keywords) ? editEntry.keywords.join(',') : ''))}">
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" style="flex:1;" id="wc-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="wc-ok">确定</button>
    </div>
  `);
  $('#wc-close').onclick = () => {
    if (handleCancelDraft($('#wc-text').value, isEdit ? editEntry : null)) goBack();
  };
  $('#wc-text').oninput = () => { $('#wc-count').textContent = [...$('#wc-text').value].length; };
  $('#wc-cancel').onclick = () => {
    if (handleCancelDraft($('#wc-text').value, isEdit ? editEntry : null)) goBack();
  };
  $('#wc-ok').onclick = async () => {
    const text = $('#wc-text').value.trim();
    if (!text) { miniToast('还没有输入内容'); return; }
    const wb = await loadWorldBook();
    if (isEdit) {
      const e = wb.entries.find(x => x.id === editEntry.id);
      if (e) { e.text = text; e.draft = false; }
    } else {
      wb.entries.push({ id: uid('wb'), type: 'text', folderId, text, draft: false, createdAt: Date.now() });
    }
    // 20260930bz：保存时本地一次性提取关键词+摘要（无网可用），AI 精炼后台补
    const saved = isEdit ? wb.entries.find(x => x.id === editEntry.id) : wb.entries[wb.entries.length - 1];
    if (saved) {
      // 玩家手动补充关键词（最高优先级，逗号分隔，合并不覆盖本地/AI 词）
      const manual = ($('#wc-keywords').value || '').split(/[,，、;；]/).map(k => k.trim()).filter(k => k.length >= 1);
      if (manual.length) saved.keywords = manual;
      saved.autoKeywords = worldExtractKeywords(text);
      saved.summary = worldExtractSummary(text);
      saved.allowAll = undefined;      // 跟随文件夹（未单独设置）
      saved.allowCharIds = [];
      // 编辑后重新参与 AI 精炼（内容变了，之前的精炼结果失效）
      if (isEdit) { saved.ai_summary_generated = false; }
    }
    await saveWorldBook(wb);
    miniToast(isEdit ? '已保存' : '已加入世界树');
    goBack();
    worldQueueAIRefine(); // 后台 AI 精炼（>200字且 AI 模式时）
  };
  setTimeout(() => { const t = $('#wc-text'); if (t) t.focus(); }, 120);
}

/* 草稿箱防手滑：输入超 100 字点取消 → 询问是否存草稿。
   返回 true=直接关闭（未超字数）；返回 false=已弹出询问，用户选择后自行回总界面 */
function handleCancelDraft(text, editEntry) {
  const len = [...text.trim()].length;
  if (len <= 100) return true; // 未超 100 字，直接取消
  // 超 100 字：弹二次确认
  openModal(`
    <div style="text-align:center;padding:8px 0 4px;">
      <div style="display:flex;justify-content:center;color:var(--text-tertiary);">${icon('draft', 34)}</div>
      <div style="font-size:16px;font-weight:600;margin-top:10px;">当前输入字数已超过 100 字</div>
      <div style="font-size:13px;color:var(--text-tertiary);margin-top:6px;">是否要存入草稿箱？</div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">存入草稿箱的内容视为未编辑完，AI 模式下不会读取</div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button class="btn" style="flex:1;" id="draft-no">不存草稿</button>
        <button class="btn primary" style="flex:1;" id="draft-yes">存入草稿箱</button>
      </div>
    </div>
  `);
  $('#draft-no').onclick = () => showWorldBookModal();
  $('#draft-yes').onclick = async () => {
    const drafts = await loadWorldDrafts();
    if (editEntry) {
      // 编辑已有条目存草稿：直接覆盖其文本标记为草稿
      const wb = await loadWorldBook();
      const e = wb.entries.find(x => x.id === editEntry.id);
      if (e) { e.text = text; e.draft = true; await saveWorldBook(wb); }
    } else {
      drafts.push({ id: uid('draft'), text, at: Date.now() });
      await saveWorldDrafts(drafts);
    }
    miniToast('已存入草稿箱');
    showWorldBookModal();
  };
  return false;
}

/* 上传文件（Word / 图片）：20MB 上限、后台解析、可跳过 */
function showWorldUploadModal(folderId = '') {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">上传文件</div>
      <button class="icon-btn" id="wu-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">支持 Word(.docx) 与图片；单文件上限 20MB，图片会压缩到 2MB 以内</div>
    <label class="btn primary block" for="wu-input" style="height:44px;cursor:pointer;">选择文件</label>
    <input type="file" id="wu-input" accept=".docx,.doc,image/*" style="display:none;" multiple>
    <div id="wu-progress" style="margin-top:14px;"></div>
  `);
  $('#wu-close').onclick = () => showWorldBookModal(); // ✕ 回世界树总界面（不直接退出）
  $('#wu-input').onchange = async (ev) => {
    const files = [...ev.target.files];
    if (!files.length) return;
    for (const file of files) {
      await processWorldUpload(file, folderId, $('#wu-progress'));
    }
    miniToast('上传完成');
    showWorldBookModal();
  };
}

/* 处理单个上传文件：Word 本地提取纯文本 / 图片压缩+OCR（后台 Worker） */
async function processWorldUpload(file, folderId, progEl) {
  if (file.size > WORLD_MAX_FILE) {
    miniToast(`「${file.name}」超过 20MB，已跳过`);
    return;
  }
  const isImage = file.type.startsWith('image/');
  const isDoc = /\.(docx|doc)$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  if (!isImage && !isDoc) {
    miniToast(`「${file.name}」格式不支持（仅 Word / 图片）`);
    return;
  }

  if (progEl) progEl.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);">⏳ 解析中… ${escapeHtml(file.name)}</div>`;
  const wb = await loadWorldBook();

  if (isImage) {
    // 图片：压缩至 2MB 以内，后台 OCR
    let img;
    try {
      const comp = await compressImage(file, 1080, 0.72, true);
      img = (comp && comp.blob) ? comp : file;
    } catch (e) { img = file; }
    if (img && img.size && img.size > WORLD_IMG_MAX) {
      // 压缩后仍超 2MB：再降质量压缩一次
      try { img = await compressImage(file, 800, 0.5, true); } catch (e) {}
    }
    let ocr = '';
    try { ocr = await ocrImageText(img); } catch (e) { ocr = ''; }
    wb.entries.push({
      id: uid('wb'), type: 'image', folderId, img,
      ocr, draft: false, createdAt: Date.now(),
      autoKeywords: worldExtractKeywords(ocr),   // 20260930bz：OCR 文本本地提取关键词
      summary: worldExtractSummary(ocr),          // 本地摘要粗提取
    });
  } else {
    // Word：本地提取文本+受控 HTML（后台 Worker 解析 docx，尽量还原 Word 排版）
    let text = '', html = '';
    try {
      const r = await extractDocxText(file);
      text = r.text; html = r.html || '';
    } catch (e) { text = ''; }
    if (!text) text = `（未能解析「${file.name}」的文字，请转成 .txt 或图片上传）`;
    wb.entries.push({
      id: uid('wb'), type: 'text', folderId, text, html,
      draft: false, createdAt: Date.now(),
      sourceName: file.name,
      autoKeywords: worldExtractKeywords(text),   // 20260930bz：本地提取关键词
      summary: worldExtractSummary(text),          // 本地摘要粗提取
    });
  }
  await saveWorldBook(wb);
  if (progEl) progEl.innerHTML = `<div style="font-size:13px;color:var(--ok);">✓ 已解析并存入世界树</div>`;
  worldQueueAIRefine(); // 后台 AI 精炼（>200字且 AI 模式时）
}

/* 内联 Web Worker：后台解析 docx，绝不阻塞 UI。
   20260929r：除纯文本外还产出受控 HTML，尽量还原 Word 里的格式——
   · 标题（pStyle 映射 styles.xml 的 styleId→级别，兼容中文 Word 的 "1"/"2" 样式 id；outlineLvl 兜底）
   · 加粗/斜体/下划线、段内换行 <w:br>、制表 <w:tab>、项目符号（numPr）
   产出 html 只含 p/h1-h3/b/i/u/br 与纯文本（内容全部转义），查看端直接注入安全 */
function _worldDocxWorkerBody(self) {
  self.onmessage = function (e) {
    const d = e.data;
    if (!d || d.type !== 'docx') return;
    try {
      const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/\uFEFF/g, ''); // 20260929ah：工具导出的 docx 常在文本里塞零宽 BOM，清除
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // styles.xml：styleId → 标题级别
      const styleLevel = {};
      const styleBlocks = (d.styles || '').match(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g) || [];
      for (const sb of styleBlocks) {
        const idm = sb.match(/w:styleId="([^"]+)"/);
        const nm = sb.match(/<w:name w:val="([^"]+)"/);
        if (!idm || !nm) continue;
        const name = nm[1].toLowerCase();
        let lv = 0;
        const hm = name.match(/^heading (\d)$/);
        if (hm) lv = Math.min(3, parseInt(hm[1], 10) || 1);
        else if (name === 'title') lv = 1;
        else if (name === 'subtitle') lv = 2;
        if (lv) styleLevel[idm[1]] = lv;
      }
      const paras = (d.doc || '').match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\s*\/>/g) || [];
      const htmlParts = [];
      const textParts = [];
      for (const p of paras) {
        if (p.indexOf('<w:p>') !== 0 && !/^<w:p[\s>]/.test(p)) continue; // 自闭合空段
        const runs = p.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || [];
        let pHtml = '', pText = '';
        let bigSz = 0; // 段内最大字号（半磅），用于无样式表文档的标题启发式
        let anyBold = false;
        for (const r of runs) {
          const on = (tag) => new RegExp('<w:' + tag + '(?:\\s[^>]*)?/>').test(r)
            && !new RegExp('<w:' + tag + '\\s[^>]*w:val="(?:false|0|none|off)"').test(r);
          if (on('b')) anyBold = true;
          const szm = r.match(/<w:sz w:val="(\d+)"/);
          if (szm) bigSz = Math.max(bigSz, parseInt(szm[1], 10) || 0);
          // 20260929ah：<w:cr/>（软回车）也计为换行——很多导出工具整篇只有一两个 w:p，
          // 段内换行全靠 w:cr，之前只认 <w:br/> 导致格式全丢
          const toks = r.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:br(?:\s[^>]*)?\/>|<w:cr(?:\s[^>]*)?\/>|<w:tab(?:\s[^>]*)?\/>/g) || [];
          for (const tk of toks) {
            if (/^<w:br/.test(tk) || /^<w:cr/.test(tk)) { pText += '\n'; pHtml += '<br>'; continue; }
            if (/^<w:tab/.test(tk)) { pText += '\t'; pHtml += '&emsp;'; continue; }
            let txt = dec(tk.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, ''));
            if (!txt) continue;
            pText += txt;
            let seg = esc(txt);
            if (on('b')) seg = '<b>' + seg + '</b>';
            if (on('i')) seg = '<i>' + seg + '</i>';
            if (on('u')) seg = '<u>' + seg + '</u>';
            pHtml += seg;
          }
        }
        textParts.push(pText);
        if (!pText.trim()) { htmlParts.push(''); continue; }
        let inner = pHtml;
        if (/<w:numPr>/.test(p)) inner = '• ' + inner; // 项目符号段
        const psm = p.match(/<w:pStyle w:val="([^"]+)"/);
        const olm = p.match(/<w:outlineLvl w:val="([0-5])"/);
        let level = (psm && styleLevel[psm[1]]) || 0;
        if (!level && olm) level = Math.min(3, parseInt(olm[1], 10) + 1);
        // 20260929ah：无样式表的工具导出 docx——大字号（≥36 半磅=18pt）段落按二级标题还原
        if (!level && bigSz >= 36) level = 2;
        htmlParts.push(level ? ('<h' + level + '>' + inner + '</h' + level + '>') : ('<p>' + inner + '</p>'));
      }
      const text = textParts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      const html = htmlParts.join('\n');
      self.postMessage({ ok: true, text: text, html: html });
    } catch (err) {
      self.postMessage({ ok: false, error: String(err) });
    }
  };
}
let _worldWorker = null;
function _getWorldWorker() {
  if (_worldWorker) return _worldWorker;
  const code = '(' + _worldDocxWorkerBody.toString() + ')(self);';
  _worldWorker = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
  return _worldWorker;
}

/* 后台提取 docx 文本+受控 HTML（解压 zip → 读 word/document.xml + styles.xml → worker 还原格式）
   20260929ah：返回 {text, html}（此前只返回 text 且字段错位导致永远为空） */
async function extractDocxText(file) {
  return new Promise((resolve) => {
    const worker = _getWorldWorker();
    const onMsg = (e) => {
      worker.removeEventListener('message', onMsg);
      if (e.data && e.data.ok) resolve({ text: e.data.text || '', html: e.data.html || '' });
      else resolve({ text: '', html: '' });
    };
    worker.addEventListener('message', onMsg);
    // 主线程解压 docx（zip），把 document.xml / styles.xml 文本丢给 worker 剥离标签
    try {
      const reader = new FileReader();
      reader.onerror = () => { worker.removeEventListener('message', onMsg); resolve({ text: '', html: '' }); };
      reader.onload = async () => {
        try {
          const buf = reader.result;
          // 用轻量方式找 word/document.xml：docx 是 zip，这里用 DecompressionStream 解压
          const { doc, styles } = await _readDocxTextFromZip(buf);
          if (!doc) { worker.removeEventListener('message', onMsg); resolve({ text: '', html: '' }); return; }
          worker.postMessage({ type: 'docx', doc, styles });
        } catch (err) {
          worker.removeEventListener('message', onMsg);
          resolve({ text: '', html: '' });
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (e) { worker.removeEventListener('message', onMsg); resolve({ text: '', html: '' }); }
  });
}

/* 解压 zip 读取 word/document.xml + word/styles.xml（纯前端零依赖，不用任何 zip 库）。
   docx 本质是 zip 包，document.xml 几乎总是 DEFLATE 压缩存储——
   之前用正则从二进制里碰运气只能解出未压缩的明文 XML，真正的 Word 导出文件全部失败（已修复）：
   现在手写解析 ZIP 中央目录二进制结构 + 浏览器原生 DecompressionStream('deflate-raw') 解压。
   20260929ah：①同时取 styles.xml（标题级别映射）；②返回 {doc, styles} 对象；
   （此前主线程传 {text} 而 worker 读 d.doc，字段错位 → 永远解析为空，本次修为同一字段名） */
async function _readDocxTextFromZip(arrayBuffer) {
  const read = async (target) => {
    try {
      const dv = new DataView(arrayBuffer);
      const u8 = new Uint8Array(arrayBuffer);
      const len = u8.length;
      if (len < 22) return '';
      // 1) 从文件尾向前找 EOCD（End Of Central Directory，22 字节起，注释区最长 65535）
      let eocd = -1;
      const lo = Math.max(0, len - 22 - 65535);
      for (let i = len - 22; i >= lo; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) return '';
      // 2) 遍历中央目录条目，定位目标条目
      let n = dv.getUint16(eocd + 10, true);   // 条目总数
      let p = dv.getUint32(eocd + 16, true);   // 中央目录起始偏移
      while (n-- > 0 && p + 46 <= len) {
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        const method = dv.getUint16(p + 10, true);      // 0=存储 8=DEFLATE
        const compSize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const cmtLen = dv.getUint16(p + 32, true);
        const localOff = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
        if (name === target && localOff + 30 <= len) {
          // 3) 跳过本地文件头（30 字节 + 文件名 + 扩展区），取出压缩数据
          const lNameLen = dv.getUint16(localOff + 26, true);
          const lExtraLen = dv.getUint16(localOff + 28, true);
          const dataStart = localOff + 30 + lNameLen + lExtraLen;
          const comp = u8.subarray(dataStart, dataStart + compSize);
          if (method === 0) return new TextDecoder().decode(comp);
          if (method === 8 && typeof DecompressionStream !== 'undefined') {
            const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return await new Response(stream).text();
          }
          return '';
        }
        p += 46 + nameLen + extraLen + cmtLen;
      }
      return '';
    } catch (e) { return ''; }
  };
  const doc = await read('word/document.xml');
  if (!doc) return { doc: '', styles: '' };
  const styles = await read('word/styles.xml');
  return { doc, styles };
}

/* OCR：优先本地，无本地 OCR 能力则把图片作为插图存档（返回空文字） */
async function ocrImageText(img) {
  // 网页端无内置 OCR；这里返回空，图片作为插图存档（符合文档「无文字则作为插图存档」）
  // 保留此函数作为未来接入本地 OCR 的挂载点
  return '';
}

/* 世界树草稿箱查看（从世界树总界面「草稿箱」行进入）：✕ 回总界面 */
async function showWorldDraftsModal() {
  const drafts = await loadWorldDrafts();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">草稿箱</div>
      <button class="icon-btn" id="wd-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:10px;">存入草稿箱的内容视为未编辑完，AI 模式下绝对不读取</div>
    ${drafts.length === 0 ? '<div style="color:var(--text-tertiary);text-align:center;padding:24px;">草稿箱是空的</div>'
      : `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;max-height:320px;overflow-y:auto;">
        ${drafts.map((d, i) => `
          <div class="wb-item" style="cursor:default;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.text.slice(0, 40))}</div>
              <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:2px;">${new Date(d.at).toLocaleString()}</div>
            </div>
            <button class="btn" data-wd-use="${i}" style="flex-shrink:0;">继续编辑</button>
            <button class="badge" data-wd-del="${i}" style="cursor:pointer;color:var(--danger);flex-shrink:0;">删</button>
          </div>`).join('')}
      </div>`}
  `);
  $('#wd-close').onclick = () => showWorldBookModal(); // ✕ 回世界树总界面
  document.querySelectorAll('[data-wd-del]').forEach(b => {
    b.onclick = async () => {
      let ds = await loadWorldDrafts();
      ds = ds.filter((_, i) => i !== parseInt(b.dataset.wdDel, 10));
      await saveWorldDrafts(ds);
      showWorldDraftsModal();
    };
  });
  document.querySelectorAll('[data-wd-use]').forEach(b => {
    b.onclick = async () => {
      const idx = parseInt(b.dataset.wdUse, 10);
      const d = drafts[idx];
      if (!d) return;
      // 续写：删除该草稿，打开新建弹窗并预填文本（确定后转为正式条目）
      const ds = await loadWorldDrafts();
      ds.splice(idx, 1);
      await saveWorldDrafts(ds);
      showWorldCreateModal('', null, d.text);
    };
  });
}

/* 布局保险（20260929o）：文档级滚动一律复位。
   overflow:hidden 下浏览器仍可能因焦点管理/标签页会话恢复把文档滚出一个小偏移，
   整页上移后底栏/输入栏被顶出视口（间歇性"底栏裁一半"）。
   CSS overflow:clip 已从根上禁止；不支持 clip 的旧浏览器由这里兜底复位 */
(function guardDocScroll() {
  const reset = () => {
    const de = document.documentElement, b = document.body;
    if ((de.scrollTop || 0) !== 0 || (b.scrollTop || 0) !== 0) window.scrollTo(0, 0);
  };
  window.addEventListener('scroll', reset, { passive: true });
  window.addEventListener('pageshow', reset);
  document.addEventListener('visibilitychange', reset);
})();

/* ============================================================
   20260929ae：API 接入模块（AI 模式）
   细则《API接入模式(1).docx》全量落地。核心原则：
   · 字卡模式：一切回复取决于字卡（除特殊项外）
   · AI 模式：除特殊项外一切回复取决于 AI
   特殊项（即使 AI 模式也走字卡）：①入梦签的「天气」「状态」；②AI 调用失败自动回退字卡；
   ③玩家手动切回字卡模式。
   ============================================================ */

/* ---------- 一、AI 配置数据层 ---------- */
/* 配置结构：kv `aiConfig`
   { chatApi:{url,key,model}, divApi:{url,key,model}, chatMode:'card'|'ai' }
   chatApi=聊天/扮演用的 API；divApi=占卜独立 API（可与 chatApi 相同也可不同）。 */
async function loadAIConfig() {
  const c = await getSetting('aiConfig', null);
  if (!c || typeof c !== 'object') {
    return { chatApi: { url: '', key: '', model: '' }, divApi: { url: '', key: '', model: '' }, chatMode: 'card' };
  }
  return {
    chatApi: Object.assign({ url: '', key: '', model: '' }, c.chatApi || {}),
    divApi: Object.assign({ url: '', key: '', model: '' }, c.divApi || {}),
    chatMode: (c.chatMode === 'ai') ? 'ai' : 'card',
  };
}
async function saveAIConfig(cfg) {
  await setSetting('aiConfig', cfg);
}

/* 是否处于 AI 模式（字卡/AI 模式切换判断接口）。
   返回 true 需同时满足：①模式开关=ai ②聊天 API 已配置（url 非空）。 */
async function isAIMode() {
  const cfg = await loadAIConfig();
  return cfg.chatMode === 'ai' && !!(cfg.chatApi && cfg.chatApi.url && cfg.chatApi.url.trim());
}
/* 同步版（配置已在内存缓存时用，避免频繁 await）——聊天气泡渲染等高频处 */
let _aiCfgCache = null; // { cfg, ts } 内存缓存（配置改动时清除）
async function getAIConfigCached() {
  if (!_aiCfgCache || Date.now() - _aiCfgCache.ts > 30000) {
    _aiCfgCache = { cfg: await loadAIConfig(), ts: Date.now() };
  }
  return _aiCfgCache.cfg;
}
function invalidateAICache() { _aiCfgCache = null; }

/* ---------- 二、通用 AI 调用 ---------- */
/* 兼容 OpenAI 风格 /chat/completions 与 /v1/chat/completions（自动补全路径）。
   返回 { ok:true, text } 或 { ok:false, error }。
   超时默认 60s；失败场景（断网/超时/Key 错/余额耗尽）由调用方弹窗并回退字卡。 */
async function callAI(url, key, model, messages, opts = {}) {
  const timeoutMs = opts.timeout || 60000;
  let endpoint = (url || '').trim();
  if (!endpoint) return { ok: false, error: '未配置 API 链接' };
  // 用户可能填到 /v1、/v1/chat/completions、或裸域名；统一补齐到 chat/completions
  if (!/\/chat\/completions\s*$/.test(endpoint)) {
    endpoint = endpoint.replace(/\/+$/, '');
    if (/\/v1$/.test(endpoint)) endpoint += '/chat/completions';
    else if (/\/completions$/.test(endpoint)) { /* 已到 /completions，补 chat */ endpoint = endpoint.replace(/\/completions$/, '/chat/completions'); }
    else endpoint += '/v1/chat/completions';
  }
  const body = {
    model: model || 'gpt-3.5-turbo',
    messages: messages,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.9,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key && key.trim() ? { 'Authorization': 'Bearer ' + key.trim() } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch (e) {}
      const statusHint = res.status === 401 ? 'Key 错误或无权限'
        : res.status === 429 ? '请求过于频繁或余额/额度耗尽'
        : res.status === 404 ? '接口地址不对（404）'
        : `HTTP ${res.status}`;
      return { ok: false, error: `${statusHint}${detail ? '：' + detail : ''}` };
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.content || '')
      : '';
    if (!text) return { ok: false, error: '返回内容为空' };
    return { ok: true, text: text.trim() };
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? '请求超时（网络慢或服务无响应）'
      : ((e && e.message) || '网络错误');
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 三、AI 上下文组装（细则五：动态上下文隔离） ---------- */
/* 20261001ci：消息 → AI 可读文本。修复图片/表情包/红包等对象型 content
   拼进上下文变成字符串「[object Object]」的严重问题（AI 完全看不懂玩家发了什么） */
function msgBodyText(m) {
  if (!m) return '';
  const t = m.type || '';
  if (t === 'image') return '[图片]';
  if (t === 'emoji') return '[表情包]';
  if (t === 'redpacket' || t === 'grouppacket') return '[红包]';
  if (t === 'transfer') return '[转账]';
  if (t === 'letter') return '[书信]';
  if (t === 'survey') return '[问卷]';
  if (t === 'topic') return `[话题卡：${(m.content && m.content.text) || ''}]`;
  if (t === 'vote') return `[投票：${(m.content && m.content.question) || ''}]`;
  if (typeof m.content === 'string') return m.content;
  if (m.content && typeof m.content.text === 'string') return m.content.text;
  if (m.content && typeof m.content === 'object') return `[${t || '消息'}]`;
  return String(m.content == null ? '' : m.content);
}

/* 20261001ci：收集最近消息里的图片/表情包 → base64 dataURL（OpenAI vision 格式）。
   支持视觉的模型（gpt-4o 等）可直接"看到"图；不支持的模型由调用方去图重试降级。
   只取最近 maxN 张（默认 3），图片消息用原图 blob 转码，表情包本身即 dataURL */
async function collectMsgImageDataUrls(msgs, maxN) {
  const out = [];
  try {
    const arr = (msgs || []).slice(-12).reverse(); // 从最新往回找
    for (const m of arr) {
      if (out.length >= (maxN || 3)) break;
      try {
        if (m.type === 'image' && m.content && m.content.blob) {
          const du = await blobToDataURL(m.content.blob);
          if (du) out.push({ label: '图片', dataUrl: du });
        } else if (m.type === 'emoji' && typeof m.content === 'string' && m.content.slice(0, 5) === 'data:') {
          out.push({ label: '表情包', dataUrl: m.content });
        }
      } catch (e) {}
    }
  } catch (e) {}
  return out;
}

/* 20261001ci：朋友圈最近动态列表（给 AI 的点赞编号来源；#1 最新）。
   已按该访客的可见范围过滤（部分可见/屏蔽的帖子不给看），并标注已赞名单防重复点赞 */
async function momentBriefForAI(charId, limit) {
  try {
    const c = characters.find(x => x.id === charId);
    const posts = await loadMomentPosts();
    const sorted = [...posts]
      .filter(p => {
        if (p.authorType === 'char') {
          const cc = characters.find(x => x.id === p.authorId);
          if (cc && cc.momentsBlocked) return false;
        }
        if (c && !momentVisibleToChar(p, c)) return false;
        return true;
      })
      .sort((a, b) => b.createTime - a.createTime)
      .slice(0, limit || 8);
    if (!sorted.length) return '';
    const lines = sorted.map((p, i) => {
      const author = p.authorType === 'player'
        ? (playerProfile.name || '白日梦主人')
        : (characters.find(x => x.id === p.authorId)?.name || '梦角');
      const imgN = (p.images || []).length;
      const sts = (p.stickers && p.stickers.length) ? p.stickers : (p.sticker ? [p.sticker] : []);
      const extra = (imgN ? `（配图${imgN}张）` : '') + (sts.length ? `（表情：${sts.join(' ')}）` : '');
      const likedNames = (p.likes || []).map(l => l.who === 'player' ? (playerProfile.name || '我') : (characters.find(x => x.id === l.who)?.name || '梦角'));
      const likedStr = likedNames.length ? `〔已赞：${likedNames.join('、')}〕` : '';
      return `#${i + 1} 「${author}」：${String(p.content || '').replace(/\s+/g, ' ').slice(0, 60)}${extra}${likedStr}`;
    });
    return `【朋友圈最新动态（#1 最新；编号供 [[LIKE:编号]] 点赞用）】\n${lines.join('\n')}`;
  } catch (e) { return ''; }
}

/* 20261001ci：执行 AI 的 [[LIKE:编号]] 点赞（编号 = momentBriefForAI 列表序号，1=最新）。
   生成列表与点赞必须用同一套过滤/排序，否则编号错位 */
async function aiLikeMomentByIndex(charId, idxList) {
  try {
    if (!idxList || !idxList.length) return;
    const c = characters.find(x => x.id === charId);
    const posts = await loadMomentPosts();
    const sorted = [...posts]
      .filter(p => {
        if (p.authorType === 'char') {
          const cc = characters.find(x => x.id === p.authorId);
          if (cc && cc.momentsBlocked) return false;
        }
        if (c && !momentVisibleToChar(p, c)) return false;
        return true;
      })
      .sort((a, b) => b.createTime - a.createTime);
    let changed = false;
    for (const n of idxList) {
      const post = sorted[n - 1];
      if (!post) continue;
      post.likes = Array.isArray(post.likes) ? post.likes : [];
      if (!post.likes.some(l => l.who === charId)) {
        post.likes.push({ who: charId, time: Date.now() });
        changed = true;
      }
    }
    if (changed) {
      await saveMomentPosts();
      if (document.body.dataset.view === 'moments') renderMoments();
      miniToast('❤️ ' + (c ? c.name : 'TA') + ' 赞了一条朋友圈');
    }
  } catch (e) {}
}

/* 组装「扮演某访客」时注入给 AI 的上下文。只读该访客权限内的内容：
   角色人设 + 访客专属记忆宫殿摘要 + 世界树（分批）+ 玩家侧放行记忆 + 钱包 + 近期聊天。
   绝对不读：其他访客文件夹、未勾选玩家内容、隐藏夹、其他访客群聊记忆。 */
async function buildCharAIContext(charId, recentMessages) {
  const c = characters.find(x => x.id === charId);
  const parts = [];
  // 1. 角色人设
  if (c) {
    parts.push(`【你正在扮演的角色】\n名字：${c.name || 'TA'}`);
    if (c.bio) parts.push(`人设/介绍：${c.bio}`);
    if (c.relation && c.relation !== '无') parts.push(`与玩家的关系：${c.relation}`);
    // 20260929ah：角色对玩家的专属昵称（AI 聊天中用这些称呼玩家）
    if (Array.isArray(c.playerNicknames) && c.playerNicknames.length) {
      parts.push(`你对玩家的专属昵称（聊天中自然地用它们称呼玩家）：${c.playerNicknames.join('、')}`);
    }
    if (c.sign) parts.push(`个性签名：${c.sign}`);
  }
  // 2. 记忆宫殿摘要（只读该访客专属文件夹 + 玩家侧放行条目；摘要关键词触发，不读全文）
  try {
    const palCtx = await getPalaceAIContext(charId);
    if (palCtx && palCtx.length) {
      const brief = palCtx.slice(0, 20).map(e => `· ${e.dateLabel || ''} ${e.title || e.summary || ''}`.trim()).join('\n');
      parts.push(`【记忆宫殿摘要（与你有关的记忆，供参考）】\n${brief}`);
    }
  } catch (e) {}
  // 3. 世界树（20260929bc：按关键词/人名触发，只注入与当前对话相关的条目）
  try {
    // 触发文本 = 近期对话内容拼接（含角色名/玩家名由 getWorldBookAIContext 自动并入）
    const triggerText = Array.isArray(recentMessages) && recentMessages.length
      ? recentMessages.map(m => (m && typeof m.content === 'string') ? m.content : (m && m.content && m.content.text) || '').join(' ')
      : '';
    const wbCtx = await getWorldBookAIContext(charId, triggerText);
    if (wbCtx && wbCtx.length) {
      const chunk = wbCtx.slice(0, 12).map(t => `· ${t}`).join('\n');
      parts.push(`【世界树设定（与当前话题相关）】\n${chunk}`);
    }
  } catch (e) {}
  // 4. 钱包余额（AI 感知扣款/收款）
  if (c && typeof c.wallet === 'number') {
    parts.push(`【该访客当前钱包余额】${c.wallet}`);
  }
  // 5. 近期聊天记录（最近若干条，帮 AI 接上下文；20261001ci：图片/表情包等转可读描述）
  if (recentMessages && recentMessages.length) {
    const tail = recentMessages.slice(-12).map(m => {
      const who = m.from === 'me' ? (playerProfile.name || '玩家') : (c ? c.name : 'TA');
      return `${who}：${msgBodyText(m)}`;
    }).join('\n');
    parts.push(`【最近的对话（按时间顺序）】\n${tail}`);
  }
  // 6. 玩家与该访客的书信往来（20260929ah：AI 模式下 AI 也能读到双方通信）
  try {
    if (c) {
      const all = await idbGetAll('messages');
      const letters = all.filter(m => m.type === 'letter' && m.charId === c.id && !m.groupId)
        .sort((a, b) => a.time - b.time).slice(-4);
      if (letters.length) {
        const me = playerProfile.name || '玩家';
        const lines = letters.map(m => {
          const who = m.from === 'me' ? me : (c.name || 'TA');
          const t = (m.content && m.content.text) ? String(m.content.text).replace(/\s+/g, ' ').slice(0, 60) : '';
          return `· ${who} 的信：${t}${t.length >= 60 ? '…' : ''}`;
        });
        parts.push(`【近期书信往来（节选）】\n${lines.join('\n')}`);
      }
    }
  } catch (e) {}
  return parts.join('\n\n');
}

/* 世界树 AI 上下文（细则五：按权限隔离 + 关键词/人名触发，分批注入）
   20260930bz 重构：权限三态（条目显式 > 文件夹显式 > 默认全部可读）；
   关键词触发 = 显式关键词（autoKeywords/aiKeywords/手动 keywords）优先 + 滑窗启发式兜底。 */
async function getWorldBookAIContext(charId, triggerText) {
  const wb = await loadWorldBook();
  const entries = (wb && Array.isArray(wb.entries)) ? wb.entries : [];
  const folders = (wb && Array.isArray(wb.folders)) ? wb.folders : [];
  const out = [];
  // 触发文本：当前对话 + 所有角色名 + 玩家名（人名始终参与匹配，便于「提到某人」触发其设定）
  const names = (characters || []).map(c => c.name).filter(Boolean);
  if (playerProfile && playerProfile.name) names.push(playerProfile.name);
  const trigger = `${triggerText || ''} ${names.join(' ')}`;
  const trigLower = trigger.toLowerCase();
  for (const e of entries) {
    if (e.draft) continue; // 草稿 AI 绝对不读
    const f = folders.find(x => x.id === e.folderId);
    // 权限三态：条目显式 > 文件夹显式 > 默认全部可读
    let allowAll, allowedIds;
    if (worldEntryExplicit(e)) {
      allowAll = e.allowAll === true;
      allowedIds = Array.isArray(e.allowCharIds) ? e.allowCharIds : [];
    } else if (worldFolderExplicit(f)) {
      allowAll = f.allowAll === true;
      allowedIds = Array.isArray(f.allowCharIds) ? f.allowCharIds : [];
    } else {
      allowAll = true; // 默认全部允许（界面标签同语义）
      allowedIds = [];
    }
    if (allowAll || (allowedIds.length && allowedIds.includes(charId))) {
      const title = e.type === 'image' ? (e.ocr || '(图片设定)') : (e.text || '');
      if (!title) continue;
      // 关键词/人名触发：显式关键词优先 + 滑窗启发式兜底
      if (triggerText) {
        const hit = _wbEntryTriggered(e, title, trigLower);
        if (!hit.hit) continue;
        // 20260930bz：开发者模式日志——区分「系统提取词」「玩家补充词」「AI 词」「人名」「滑窗」
        if (chatSettings.developerMode) {
          const srcMap = { name: '人名', manual: '玩家补充词', auto: '系统提取词', ai: 'AI 精炼词', slide: '滑窗兜底' };
          worldDevLog(`世界树[${srcMap[hit.source] || hit.source}]已注入：${(hit.kw || '').slice(0, 12)}`);
        }
      }
      out.push(title.slice(0, 200));
    }
  }
  return out;
}

/* 20260930bz：世界树条目是否被当前对话触发。
   ① 人名命中（提到某人 → 注入 TA 的设定）
   ② 显式关键词命中（玩家手动 keywords 最高优先 > AI aiKeywords > 本地 autoKeywords）
   ③ 滑窗关键词兜底（2~6 字显著片段命中）
   返回 {hit:boolean, source:'name'|'manual'|'ai'|'auto'|'slide', kw:string}。
   空触发文本（无可读对话）时 {hit:false}。 */
function _wbEntryTriggered(e, entryText, trigLower) {
  if (!trigLower) return { hit: false, source: '', kw: '' };
  const body = String(entryText || '');
  const low = body.toLowerCase();
  // 1) 人名直接命中（提到某人 → 注入 TA 的设定）
  const names = (characters || []).map(c => c.name).filter(Boolean);
  if (playerProfile && playerProfile.name) names.push(playerProfile.name);
  for (const n of names) {
    if (!n) continue;
    const nl = n.toLowerCase();
    if (nl.length >= 2 && trigLower.includes(nl)) return { hit: true, source: 'name', kw: n };
  }
  // 2) 玩家手动关键词（最高优先级）
  const manual = Array.isArray(e.keywords) ? e.keywords : [];
  for (const k of manual) {
    const kl = String(k).toLowerCase();
    if (kl.length >= 2 && trigLower.includes(kl)) return { hit: true, source: 'manual', kw: k };
  }
  // 3) AI 精炼关键词（次高）
  const aiKws = Array.isArray(e.aiKeywords) ? e.aiKeywords : [];
  for (const k of aiKws) {
    const kl = String(k).toLowerCase();
    if (kl.length >= 2 && trigLower.includes(kl)) return { hit: true, source: 'ai', kw: k };
  }
  // 4) 本地系统提取关键词（兜底）
  const autoKws = Array.isArray(e.autoKeywords) ? e.autoKeywords : [];
  for (const k of autoKws) {
    const kl = String(k).toLowerCase();
    if (kl.length >= 2 && trigLower.includes(kl)) return { hit: true, source: 'auto', kw: k };
  }
  // 5) 滑窗关键词兜底：2~6 字片段（含中文按字符、英文按词）命中对话
  const clean = low.replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, ' ');
  const chars = Array.from(clean);
  for (let len = 6; len >= 2; len--) {
    for (let i = 0; i + len <= chars.length; i++) {
      const gram = chars.slice(i, i + len).join('').trim();
      if (gram.length < 2) continue;
      if (trigLower.includes(gram)) return { hit: true, source: 'slide', kw: gram };
    }
  }
  return { hit: false, source: '', kw: '' };
}

/* 20260930bz：开发者模式日志（打字机字体小字，屏幕角落） */
function worldDevLog(msg) {
  try {
    let el = document.getElementById('wb-devlog');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wb-devlog';
      el.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9999;max-width:90vw;'
        + 'font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--ok);'
        + 'background:rgba(8,6,12,.72);padding:6px 10px;border-radius:8px;pointer-events:none;'
        + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      document.body.appendChild(el);
    }
    el.textContent = 'LOG: ' + msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => { if (el.isConnected) el.remove(); }, 3000);
  } catch (e) {}
}

/* ---------- 四、AI 配置页面（个人主页入口，含「测试链接」按钮） ---------- */
async function showAIConfigModal() {
  const cfg = await loadAIConfig();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="font-size:18px;font-weight:600;">🤖 API 接入</div>
      <button class="icon-btn" id="aicfg-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:14px;">接入 AI 后，聊天、朋友圈、占卜、入梦签等可由 AI 生成。填写链接 + Key + 模型名，可直接输入或粘贴。</div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">聊天 API</div>
    <div class="field"><label>接口链接</label><input class="input" id="aicfg-url" placeholder="https://api.example.com/v1/chat/completions" value="${escapeHtml(cfg.chatApi.url)}"></div>
    <div class="field"><label>Key（可选）</label><input class="input" id="aicfg-key" placeholder="sk-…" value="${escapeHtml(cfg.chatApi.key)}"></div>
    <div class="field"><label>模型名</label><input class="input" id="aicfg-model" placeholder="gpt-3.5-turbo / deepseek-chat …" value="${escapeHtml(cfg.chatApi.model)}"></div>
    <div style="display:flex;gap:8px;margin:6px 0 16px;">
      <button class="btn" id="aicfg-test" style="flex:1.5;">测试链接</button>
      <button class="btn primary" id="aicfg-save-chat" style="flex:1;">保存配置</button>
    </div>
    <div id="aicfg-test-result" style="display:none;font-size:12px;margin:-10px 0 12px;padding:8px 12px;border-radius:10px;"></div>

    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">占卜 API（可与聊天 API 相同，也可不同）</div>
    <div class="field"><label>接口链接</label><input class="input" id="aicfg-durl" placeholder="留空则沿用聊天 API" value="${escapeHtml(cfg.divApi.url)}"></div>
    <div class="field"><label>Key（可选）</label><input class="input" id="aicfg-dkey" placeholder="留空则沿用聊天 API" value="${escapeHtml(cfg.divApi.key)}"></div>
    <div class="field"><label>模型名</label><input class="input" id="aicfg-dmodel" placeholder="留空则沿用聊天 API" value="${escapeHtml(cfg.divApi.model)}"></div>

    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px dashed var(--border);border-radius:12px;margin-top:6px;">
      <div style="font-size:13px;color:var(--text-secondary);">默认聊天模式<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">可在每个聊天窗口内随时切换</div></div>
      <div style="display:flex;gap:6px;">
        <button class="btn aicfg-mode ${cfg.chatMode === 'card' ? 'primary' : ''}" data-mode="card" style="padding:7px 14px;">字卡模式</button>
        <button class="btn aicfg-mode ${cfg.chatMode === 'ai' ? 'primary' : ''}" data-mode="ai" style="padding:7px 14px;">AI 模式</button>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn" style="flex:1;" id="aicfg-cancel">取消</button>
      <button class="btn primary" style="flex:1;" id="aicfg-save">保存</button>
    </div>
  `);
  $('#aicfg-close').onclick = closeModal;
  $('#aicfg-cancel').onclick = closeModal;

  let selectedMode = cfg.chatMode;
  document.querySelectorAll('.aicfg-mode').forEach(btn => {
    btn.onclick = () => {
      selectedMode = btn.dataset.mode;
      document.querySelectorAll('.aicfg-mode').forEach(b => b.classList.toggle('primary', b === btn));
    };
  });

  // 测试链接（细则一.2：极其重要）
  $('#aicfg-test').onclick = async () => {
    const url = $('#aicfg-url').value.trim();
    const key = $('#aicfg-key').value.trim();
    const model = $('#aicfg-model').value.trim();
    const box = $('#aicfg-test-result');
    if (!url) { box.style.display = 'block'; box.style.cssText += ';color:var(--danger);background:rgba(255,100,120,0.12);'; box.textContent = '请先填写接口链接'; return; }
    box.style.display = 'block';
    box.style.cssText = 'display:block;font-size:12px;margin:-10px 0 12px;padding:8px 12px;border-radius:10px;color:var(--text-secondary);background:var(--bg-elevated-2);';
    box.textContent = '正在测试连接…';
    const r = await callAI(url, key, model, [{ role: 'user', content: '你好，请回复“连接成功”四个字。' }], { temperature: 0.3, timeout: 30000 });
    if (r.ok) {
      box.style.color = 'var(--success, #4ade80)';
      box.style.background = 'rgba(74,222,128,0.12)';
      box.textContent = '连接成功';
    } else {
      box.style.color = 'var(--danger)';
      box.style.background = 'rgba(255,100,120,0.12)';
      box.textContent = '测试失败：' + r.error;
    }
  };

  // 20261001ci：独立保存按钮（测试链接右侧）——保存整份配置但不关弹窗，不依赖最下方的保存
  const saveAllCfg = async () => {
    const chatApi = { url: $('#aicfg-url').value.trim(), key: $('#aicfg-key').value.trim(), model: $('#aicfg-model').value.trim() };
    const divApi = {
      url: $('#aicfg-durl').value.trim(),
      key: $('#aicfg-dkey').value.trim(),
      model: $('#aicfg-dmodel').value.trim(),
    };
    await saveAIConfig({ chatApi, divApi, chatMode: selectedMode });
    invalidateAICache();
    refreshModeSwitchUI();
  };
  $('#aicfg-save-chat').onclick = async () => {
    await saveAllCfg();
    miniToast('API 配置已保存');
  };

  $('#aicfg-save').onclick = async () => {
    await saveAllCfg();
    miniToast('API 配置已保存');
    closeModal();
  };
}

/* ---------- 五、聊天窗口内模式切换（20260929af：顶栏开关图标） ---------- */
/* 旧版是输入栏上方的双胶囊条（20260929ae），20260929af 改为聊天顶栏
   「三个点」左侧的开关样式图标：旋钮在左+灰色=字卡模式（关），
   旋钮滑到右侧+紫色=AI 模式（开）。切换时播放一声短促「滴」（Web Audio 合成，
   零音频文件零依赖）；AI 调用失败自动回退字卡时开关也同步回滚。 */
function ensureModeSwitchUI() { refreshModeSwitchUI(); }

async function refreshModeSwitchUI() {
  const cfg = await loadAIConfig();
  const aiOn = cfg.chatMode === 'ai';
  // 20260929be：聊天顶栏与朋友圈顶栏共用同一个 AI/字卡开关状态
  ['#btn-chat-aimode', '#btn-moments-aimode'].forEach(sel => {
    const btn = $(sel);
    if (!btn) return;
    btn.classList.toggle('on', aiOn);
    btn.title = aiOn ? '当前：AI 模式 · 点击切回字卡' : '当前：字卡模式 · 点击切换 AI';
  });
}

/* 20260929be：AI/字卡模式切换（聊天顶栏 + 朋友圈顶栏共用） */
async function toggleAImodeFromUI() {
  const cfg = await loadAIConfig();
  const toAI = cfg.chatMode !== 'ai';
  if (toAI && !(cfg.chatApi && cfg.chatApi.url && cfg.chatApi.url.trim())) {
    showToast('尚未配置 API，请先在「主页 → API 接入」填写链接');
    return;
  }
  const doSwitch = async () => {
    cfg.chatMode = toAI ? 'ai' : 'card';
    await saveAIConfig(cfg);
    invalidateAICache();
    playModeBeep(toAI);
    miniToast(toAI ? '已切换到 AI 模式' : '已切换到字卡模式');
    refreshModeSwitchUI();
    document.querySelectorAll('.cs-ai-btn').forEach(b => b.classList.toggle('primary', b.dataset.mode === cfg.chatMode));
  };
  // 20260929ah：开启 AI 且有角色按固定间隔主动发消息 → 中间弹窗警告 API 消耗
  if (toAI && hasFixedProactiveChar()) {
    warnAIApiBurn(doSwitch);
    return;
  }
  await doSwitch();
}

/* 模式开关音：AI 模式高音「滴」、字卡模式低音「滴」，便于盲听区分 */
let _modeBeepCtx = null;
function playModeBeep(aiOn) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_modeBeepCtx) _modeBeepCtx = new AC();
    const ctx = _modeBeepCtx;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = aiOn ? 920 : 640;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.14);
  } catch (e) { /* 音频失败不影响切换 */ }
}

/* ---------- 六、聊天回复分流（AI / 字卡） ---------- */
/* 给 scheduleCharReply / scheduleGroupReply 用：按当前模式决定回复内容。
   返回 { type:'card'|'ai', text }。AI 失败时返回 { type:'card', text, fallback:true }。 */
async function generateCharReply(charId, opts = {}) {
  const aiOn = await isAIMode();
  if (!aiOn) {
    const c = characters.find(x => x.id === charId);
    const reply = drawReply(cards, getCharBanWords(c), c ? (c.relation || null) : null, c ? (c.bannedGroups || []) : []);
    return { type: 'card', text: reply };
  }
  // AI 模式
  const cfg = await loadAIConfig();
  const c = characters.find(x => x.id === charId);
  try {
    const recent = await idbGetMessagesByChar(charId, 30);
    const ctx = await buildCharAIContext(charId, recent);
    // 20261001ci：朋友圈列表（编号供 [[LIKE:]] 点赞）+ 最近图片/表情包（vision 附图）
    const momentBrief = await momentBriefForAI(charId, 8);
    const imgs = await collectMsgImageDataUrls(recent, 3);
    const userLast = (opts.quote && opts.quote.content) ? opts.quote.content : '';
    // 20260929bf：count>1 = 单聊 AI 也连发多条（每条单独一行，像真人连着发消息）；默认 1 条
    const wantN = Math.max(1, Math.min(3, parseInt(opts.count, 10) || 1));
    const multiLine = wantN > 1
      ? `\n你会连着发 ${wantN} 条消息：每条单独一行输出（共 ${wantN} 行），像真实聊天里连着发几条，几条之间可以是补充、吐槽或自问自答；每条 1 句左右，不要编号。`
      : '';
    const sysBase = (visionNote) => `你是角色扮演 AI。请完全以角色的身份、口吻回复，简短自然（1~3 句），不要跳出角色，不要提“AI”“模型”等字眼。${multiLine}${visionNote}\n隐藏指令（玩家看不到，单独成行放在回复最末尾，没有就整行省略）：\n1. 玩家让你发朋友圈/发动态时：另起一行输出 [[MOMENT:朋友圈正文]]，由系统代发；若你想同时给自己这条动态点赞，再另起一行输出 [[SELF_LIKE]]。\n2. 这段对话里有值得你永久记住的事（约定/秘密/重要事实）时：另起一行输出 [[MEMO:一句话记忆]]，由系统替你存进记忆宫殿。最多一条，宁缺毋滥。\n3. 玩家让你去朋友圈点赞/给某条动态点赞时：另起一行输出 [[LIKE:编号]]（编号取自下方【朋友圈最新动态】列表，#1 是最新一条）；可同时输出多个点赞不同的动态；列表里没有或没有玩家要的动态就省略。${momentBrief ? '\n\n' + momentBrief : ''}\n\n${ctx}`;
    const sysNoImg = sysBase('');
    const messages = [
      { role: 'system', content: imgs.length ? sysBase('\n【视觉输入】本条消息末尾附上了最近聊天里的图片/表情包（按时间顺序），你可以直接看到它们的内容。') : sysNoImg },
      ...(imgs.length
        ? [{ role: 'user', content: [{ type: 'text', text: userLast ? `玩家说：${userLast}` : '（继续对话）' }, ...imgs.map(im => ({ type: 'image_url', image_url: { url: im.dataUrl } }))] }]
        : (userLast ? [{ role: 'user', content: `玩家说：${userLast}` }] : [{ role: 'user', content: '（继续对话）' }])),
    ];
    let r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, messages);
    // 20261001ci：模型不支持视觉输入时自动去掉图片重试一次，再失败才回退字卡
    if (!r.ok && imgs.length) {
      r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
        { role: 'system', content: sysNoImg },
        ...(userLast ? [{ role: 'user', content: `玩家说：${userLast}` }] : [{ role: 'user', content: '（继续对话）' }]),
      ]);
    }
    if (r.ok && r.text) {
      // 解析隐藏指令：发朋友圈 / 存记忆宫殿 / 点赞朋友圈 / 自赞（20260929ah + 20261001ci）
      const parsed = parseAITags(r.text);
      if (parsed.memo) aiPalStoreMemo(charId, parsed.memo);
      if (parsed.moment) aiPostMomentFromTag(charId, parsed.moment, { selfLike: parsed.selfLike });
      if (parsed.likes && parsed.likes.length) aiLikeMomentByIndex(charId, parsed.likes);
      return { type: 'ai', text: parsed.clean };
    }
    // 失败：弹窗报错 + 回退字卡；模式开关同步回滚到字卡（20260929af）
    cfg.chatMode = 'card';
    await saveAIConfig(cfg);
    invalidateAICache();
    refreshModeSwitchUI();
    showToast(`AI 调用失败，已自动回退字卡模式：${r.error}`);
    const reply = drawReply(cards, getCharBanWords(c), c ? (c.relation || null) : null, c ? (c.bannedGroups || []) : []);
    return { type: 'card', text: reply, fallback: true };
  } catch (e) {
    cfg.chatMode = 'card';
    await saveAIConfig(cfg);
    invalidateAICache();
    refreshModeSwitchUI();
    showToast('AI 调用异常，已自动回退字卡模式');
    const reply = drawReply(cards, getCharBanWords(c), c ? (c.relation || null) : null, c ? (c.bannedGroups || []) : []);
    return { type: 'card', text: reply, fallback: true };
  }
}

/* 占卜 AI 解牌（独立占卜 API；失败回退本地牌意） */
async function divinationAIInterpret(question, pick) {
  const cfg = await loadAIConfig();
  const url = cfg.divApi.url || cfg.chatApi.url;
  const key = cfg.divApi.key || cfg.chatApi.key;
  const model = cfg.divApi.model || cfg.chatApi.model;
  if (!url) return null;
  const labels = ['过去', '现在', '未来'];
  const cardsDesc = pick.map((p, i) => `${labels[i]}：${p.card.n}（${p.reversed ? '逆位' : '正位'}）`).join('；');
  const messages = [
    { role: 'system', content: '你是塔罗牌解读师，用温柔、有画面感的语言解读三张牌的时间流。控制在 150 字内。' },
    { role: 'user', content: `玩家想问：${question || '（未说明）'}\n抽到的牌：${cardsDesc}\n请结合问题解读。` },
  ];
  const r = await callAI(url, key, model, messages, { temperature: 0.8 });
  return r.ok ? r.text : null;
}

/* ---------- 七、入梦签 AI 生成（特殊项一：天气/状态仍走字卡） ---------- */
async function aiGenerateDailyCardText(charId) {
  const cfg = await loadAIConfig();
  if (!(cfg.chatApi && cfg.chatApi.url)) return null;
  const c = characters.find(x => x.id === charId);
  try {
    const ctx = await buildCharAIContext(charId, []);
    const messages = [
      { role: 'system', content: `你是角色扮演 AI，正在写一张给玩家的「入梦签」。请输出三行，格式固定：\n心情：（一句心情）\n寄语：（一句温柔的寄语）\n对玩家说的话：（1~2 句）\n不要输出其它内容。\n\n${ctx}` },
      { role: 'user', content: '请写今天的入梦签。' },
    ];
    const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, messages, { temperature: 0.9 });
    if (!r.ok) return null;
    const mood = (r.text.match(/心情[：:]\s*(.+)/) || [])[1] || '';
    const motto = (r.text.match(/寄语[：:]\s*(.+)/) || [])[1] || '';
    const msg = (r.text.match(/对玩家说的话[：:]\s*([\s\S]+)/) || [])[1] || '';
    return { moodText: mood.trim(), motto: motto.trim(), msg: msg.trim() };
  } catch (e) { return null; }
}

/* ---------- 八、群聊自主聊天（细则五.7：AI 模式下群聊里的人自主聊天） ---------- */
/* 群聊设置扩展字段：group.groupChatSettings = { replyMin, replyMax, autoChat }
   replyMin/replyMax：群聊回复节奏（秒）
   autoChat：玩家退出群聊后，角色们是否继续自主聊天（默认 true；关闭需二次确认） */
function getGroupChatSettings(g) {
  return Object.assign({ replyMin: 5, replyMax: 30, autoChat: true }, g.groupChatSettings || {});
}
let _groupAutoChatTimer = null;
/* 退出群聊页面时给该群挂 20 分钟后台聊天窗口（az 细则三.2）：
   autoChat 开启 → 退出后成员继续自主聊天 20 分钟，之后自动停止；
   autoChat 关闭 → 退出即停（窗口直接置 0） */
function markGroupBgChatWindow(groupId) {
  const g = chatGroups.find(x => x.id === groupId);
  if (!g) return;
  const gs = getGroupChatSettings(g);
  g._bgChatUntil = (gs.autoChat === false) ? 0 : Date.now() + 20 * 60 * 1000;
}
/* 群聊自主聊天（az 重写）：AI 模式 + autoChat 开启 + 存在有效 20 分钟后台窗口 +
   玩家当前不在该群聊页时，触发一次 1 轮接龙（细则：挂后台最多 1 轮就停） */
async function groupAutoChatTick() {
  try {
    if (!(await isAIMode())) return; // 字卡模式不自主聊天
    const now = Date.now();
    for (const g of chatGroups) {
      if (currentGroupId === g.id && document.body.dataset.view === 'chat') continue; // 玩家正在该群聊
      const until = g._bgChatUntil || 0;
      if (now >= until) continue; // 无有效窗口（未开启 / 未退出过页面 / 已超 20 分钟）
      if (_grpChains.has(g.id)) continue;
      g._bgChatUntil = 0; // 窗口内只触发一次，聊完即止
      startGroupChain(g, { rounds: Math.min(5, Math.max(1, gs.bgRounds ?? 1)), source: 'auto' });
    }
  } catch (e) {}
}
/* 启动群聊自主聊天定时器（每 20 秒一查；实际节奏由 20 分钟窗口与轮次控制） */
function startGroupAutoChatTimer() {
  if (_groupAutoChatTimer) return;
  _groupAutoChatTimer = setInterval(groupAutoChatTick, 20000);
  // 20260929ba：成员随机发群红包（独立 60s 轮询；群设置 autoPacket 开启才生效）
  if (!window.__groupPacketTimer) {
    window.__groupPacketTimer = setInterval(async () => {
      try {
        const now = Date.now();
        for (const g of chatGroups) {
          const gs = getGroupChatSettings(g);
          if (!gs.autoPacket) continue;
          if (!(g._packetUntil > 0)) { g._packetUntil = now + randInt(30, 180) * 60000; continue; } // 首次播种间隔
          if (now < g._packetUntil) continue;
          g._packetUntil = now + randInt(30, 180) * 60000;
          const members = chainMembers(g);
          if (!members.length) continue;
          const sender = members[randInt(0, members.length - 1)];
          const amount = randInt(20, 500);
          const count = Math.max(1, Math.min(members.length, randInt(1, 5)));
          await fireGroupPacket(g, { from: 'them', charId: sender.id }, {
            amount, count,
            mode: Math.random() < 0.5 ? 'lucky' : 'avg',
            note: '',
          });
        }
      } catch (e) {}
    }, 60000);
  }
}

/* —— 群聊关系网自动同步（az 细则四；20260929be 升级为「结识提议」制）——
   接龙中相邻发言的两成员做互动计数：友好词→升温、冲突词→恶化；
   达阈值时按互动氛围从关系网预设类型（RELATION_TYPES）中挑一种关系，
   弹窗告知玩家「A 和 B 想要成为 X 关系」；玩家允许才写入双方 peerRelations，
   不允许则保持之前的关系（本轮不再重复弹，之后互动仍可再次触发提议）。
   AI 深度语义判断接口预留（接 AI 分析后替换关键词启发式） */
const _grpBond = {}; // groupId -> { "a|b": { pos, neg, done } }
const GRP_WARM_WORDS = ['谢谢', '感谢', '喜欢', '开心', '哈哈', '嘻嘻', '爱', '抱抱', '真好', '同意', '支持', '陪你', '聊得来'];
const GRP_COLD_WORDS = ['闭嘴', '滚', '讨厌', '吵架', '别说了', '哼', '无聊', '冲突', '够了'];
/* 提议池：融洽向 / 冲突向（全部来自关系网预设类型 RELATION_TYPES） */
const GRP_BOND_WARM_TYPES = ['朋友', '恋人', '家人', '同事'];
const GRP_BOND_COLD_TYPES = ['宿敌', '仇人', '厌恶'];
function grpBondKey(a, b) { return [a, b].sort().join('|'); }
function grpRecordInteraction(g, prevId, speakerId, text) {
  try {
    if (!g || !prevId || prevId === speakerId) return;
    if (!characters.some(x => x.id === prevId)) return; // 上一条是玩家/不存在 → 不计
    const t = String(text || '');
    const warm = GRP_WARM_WORDS.some(w => t.includes(w));
    const cold = GRP_COLD_WORDS.some(w => t.includes(w));
    if (!warm && !cold) return;
    const key = grpBondKey(prevId, speakerId);
    _grpBond[g.id] = _grpBond[g.id] || {};
    const b = _grpBond[g.id][key] = _grpBond[g.id][key] || { pos: 0, neg: 0, done: false };
    if (b.done) return; // 每对成员每个群同一轮只提议一次
    if (warm) b.pos++;
    if (cold) b.neg++;
    const a = characters.find(x => x.id === prevId);
    const c2 = characters.find(x => x.id === speakerId);
    if (!a || !c2) return;
    // 20260929be：提议的关系类型——从预设池随机挑一个，且排除两人已有的关系
    const pickType = (pool) => {
      const curA = (a.peerRelations || {})[c2.id] || '无';
      const curB = (c2.peerRelations || {})[a.id] || '无';
      const avail = pool.filter(r => r !== curA && r !== curB);
      const cand = avail.length ? avail : pool;
      return cand[Math.floor(Math.random() * cand.length)];
    };
    if (b.pos >= 4) {
      b.done = true;
      const rel = pickType(GRP_BOND_WARM_TYPES);
      showConfirm(`访客「${a.name}」和「${c2.name}」想要成为「${rel}」关系（在群聊中互动融洽），是否允许？\n不允许则两人保持现在的关系。`, async () => {
        bondApply(a.id, c2.id, rel);
        miniToast(`关系网已更新：两人相互标记为「${rel}」`);
      });
    } else if (b.neg >= 3) {
      b.done = true;
      const rel = pickType(GRP_BOND_COLD_TYPES);
      showConfirm(`访客「${a.name}」和「${c2.name}」想要成为「${rel}」关系（在群聊中似乎起了冲突），是否允许？\n不允许则两人保持现在的关系。`, async () => {
        bondApply(a.id, c2.id, rel);
        miniToast(`关系网已更新：两人相互标记为「${rel}」`);
      });
    }
  } catch (e) {}
}
/* 写入关系网：只从「无/陌生人」改写，已有更深关系（朋友/恋人/家人…）不动 */
function bondApply(aId, bId, type) {
  const a = characters.find(x => x.id === aId);
  const b = characters.find(x => x.id === bId);
  if (!a || !b) return;
  const set = (owner, peer) => {
    owner.peerRelations = owner.peerRelations || {};
    const cur = owner.peerRelations[peer] || '无';
    if (cur === '无' || cur === '陌生人') owner.peerRelations[peer] = type;
  };
  set(a, bId); set(b, aId);
  saveChar(a); saveChar(b);
}
/* AI 管理员判断接口（细则二.3；自动拉人/踢人行为接 AI 模块后启用，先立好限制规则）：
   拉人限制：AI 管理员只会拉自己关系网中认识的人（peerRelations 有记录且非「无」）；
   踢人限制：只踢在群聊中与自己或他人产生冲突的人（现为关键词占位，接 AI 后换语义识别） */
function aiAdminCanAdd(admin, candidate) {
  const rel = (admin.peerRelations || {})[candidate.id] || '无';
  return rel !== '无';
}
function aiAdminCanKick(admin, target, recentTexts = []) {
  const t = recentTexts.join('\n');
  return GRP_COLD_WORDS.some(w => t.includes(w));
}

/* ============================================================
   群聊拓展功能（az 细则一.2/五）：选择群成员弹窗、群红包、话题卡、
   群投票、群内决策币、群内书信、群公告横幅
   ============================================================ */

/* 选择群成员弹窗（细则一.2：需要目标的功能先选目标成员） */
function pickGroupMember(g, title = '选择群成员') {
  return new Promise((resolve) => {
    const members = (g.memberIds || []).map(id => characters.find(x => x.id === id)).filter(Boolean);
    if (members.length === 0) { resolve(null); return; }
    openModal(`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:17px;font-weight:600;">${escapeHtml(title)}</div>
        <button class="icon-btn" id="gpick-close">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;">
        ${members.map(m => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;" data-gpick="${m.id}">
            <div class="avatar sm">${m.avatar ? `<img src="${imgSrc(m.avatar)}">` : escapeHtml(m.name[0] || '?')}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;">${escapeHtml(m.name)}</div>
              ${(g.memberNick || {})[m.id] ? `<div style="font-size:11.5px;color:var(--text-tertiary);">群名片：${escapeHtml(g.memberNick[m.id])}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>
    `);
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; mask.removeEventListener('click', onMask); resolve(v); } };
    const mask = $('#modal-mask');
    const onMask = () => done(null);
    $('#gpick-close').onclick = () => { closeModal(); done(null); };
    mask.addEventListener('click', onMask, { once: true });
    document.querySelectorAll('[data-gpick]').forEach(el => {
      el.onclick = () => {
        const m = characters.find(x => x.id === el.dataset.gpick);
        closeModal();
        done(m || null);
      };
    });
  });
}

/* 群红包卡片 HTML（msgBodyHtml 与就地刷新共用） */
function gpacketCardHtml(m) {
  const pc = m.content || {};
  const grabs = pc.grabs || [];
  const claimed = grabs.reduce((s, x) => s + x.share, 0);
  const g = chatGroups.find(x => x.id === m.groupId);
  const modeTag = pc.mode === 'avg' ? '平分' : '拼手气';
  const listHtml = grabs.length
    ? grabs.map(x => `<div>${escapeHtml(groupMemberName(g, x.charId))} 抢到 ¥${x.share}</div>`).join('')
    : (pc.mode === 'avg' ? `每人 ¥${Math.floor((pc.amount || 0) / Math.max(1, pc.count || 1))}，等待领取…` : '等待领取…');
  return `<div class="msg-card" data-gpacket-card="${m.id}"><span class="msg-card-tag">🧧 群红包 · ${modeTag} · ${grabs.length}/${(pc.count || grabs.length)} 份</span><div style="font-size:18px;font-weight:700;color:var(--purple-soft);">¥${pc.amount}</div>${pc.note ? `<div style="font-size:12px;color:var(--text-tertiary);margin-top:3px;">${escapeHtml(pc.note)}</div>` : ''}<div style="font-size:12px;color:var(--text-secondary);margin-top:6px;line-height:1.6;">${listHtml}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">已领 ${claimed} / ${pc.amount} 元 · ${grabs.length}/${(pc.count || grabs.length)} 份</div></div>`;
}
function refreshGroupPacketCard(m) {
  const el = document.querySelector(`[data-gpacket-card="${m.id}"]`);
  if (el) el.outerHTML = gpacketCardHtml(m);
}
/* 拆分金额：拼手气=二分法随机（现实中"抢红包"的方差感）；平分=均摊余数进首份 */
function splitPacketShares(amount, count, mode) {
  const n = Math.max(1, Math.min(count, amount));
  if (n === 1) return [amount];
  if (mode === 'avg') {
    const base = Math.floor(amount / n);
    const shares = Array(n).fill(base);
    shares[0] += amount - base * n; // 余数给第一份，保证总额精确
    return shares;
  }
  // 拼手气：随机切 n-1 刀
  const cuts = new Set();
  while (cuts.size < n - 1) cuts.add(randInt(1, amount - 1));
  const pts = [0, ...[...cuts].sort((a, b) => a - b), amount];
  const shares = [];
  for (let i = 0; i < n; i++) shares.push(pts[i + 1] - pts[i]);
  return shares;
}
/* 群红包发放公共流程（玩家发 / 成员自发共用）：
   sender = { from: 'me' } 或 { from: 'them', charId }；扣款真实入账，抢完各自到账 */
async function fireGroupPacket(g, sender, { amount, count, mode, note }) {
  const members = chainMembers(g);
  if (!members.length) return null;
  count = Math.max(1, Math.min(count, members.length, amount));
  // 扣款
  if (sender.from === 'me') {
    if ((playerProfile.wallet || 0) < amount) { miniToast('钱包余额不足'); return null; }
    playerProfile.wallet -= amount;
    await savePlayerProfile();
  } else {
    const sp = characters.find(x => x.id === sender.charId);
    if (!sp || (sp.wallet ?? 100000) < amount) return null;
    sp.wallet = (sp.wallet ?? 100000) - amount;
    await saveChar(sp);
  }
  const m = {
    id: uid('msg'), groupId: g.id,
    from: sender.from, charId: sender.charId,
    type: 'grouppacket',
    content: { amount, count, mode: mode === 'avg' ? 'avg' : 'lucky', note: note || '', grabs: [], total: count },
    time: Date.now(),
  };
  await idbPut('messages', m);
  if (currentGroupId === g.id && document.body.dataset.view === 'chat') { appendGroupMessage(m); scrollToBottom(); }
  else renderChatList();
  // 随机抽 count 个成员，按节奏依次抢；抢到（AI 模式）自动道谢一句
  const shuffled = members.slice().sort(() => Math.random() - 0.5).slice(0, count);
  const shares = splitPacketShares(amount, count, m.content.mode);
  let delayAcc = 1200;
  shuffled.forEach((mem, i) => {
    delayAcc += randInt(1200, 4200);
    setTimeout(async () => {
      try {
        m.content.grabs.push({ charId: mem.id, share: shares[i] });
        mem.wallet = (mem.wallet ?? 100000) + shares[i];
        await saveChar(mem);
        await idbPut('messages', m);
        refreshGroupPacketCard(m);
        const thanks = await generateGroupReplyText(g, mem, { source: 'packet' });
        await putGroupMsg(g, mem, thanks);
      } catch (e) {}
    }, delayAcc);
  });
  return m;
}
/* 群红包弹窗（ba 重写：红包个数 + 拼手气/平分；个数与分配模式仅群聊有） */
function showGroupPacketModal(g, opts = {}) {
  const members = chainMembers(g);
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">发群红包</div>
      <button class="icon-btn" id="gpacket-close">✕</button>
    </div>
    <div class="field"><label>总金额（¥，从玩家钱包扣除）</label><input class="input" type="number" id="gpacket-amount" min="1" placeholder="输入金额"></div>
    <div class="field"><label>红包个数（1～${members.length}，按群里人数发）</label><input class="input" type="number" id="gpacket-count" min="1" max="${Math.max(1, members.length)}" value="1"></div>
    <div class="field"><label>分配方式</label>
      <div style="display:flex;gap:8px;">
        <button class="btn" data-gmode="lucky" style="flex:1;justify-content:center;">🧧 拼手气（手气随机）</button>
        <button class="btn" data-gmode="avg" style="flex:1;justify-content:center;">⚖️ 平分（每份一样）</button>
      </div>
    </div>
    <div class="field"><label>附言（可选）</label><input class="input" id="gpacket-note" maxlength="30" placeholder="恭喜发财"></div>
    <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:10px;">发出后群里的成员会随机来抢，抢到的会自动到账并道谢</div>
    <button class="btn primary block" id="gpacket-go">塞进群里 🧧</button>
  `);
  let mode = 'lucky';
  const paintMode = () => {
    document.querySelectorAll('[data-gmode]').forEach(b => {
      const on = b.dataset.gmode === mode;
      b.style.borderColor = on ? 'var(--purple)' : 'var(--border)';
      b.style.background = on ? 'var(--purple-dim)' : '';
    });
  };
  paintMode();
  document.querySelectorAll('[data-gmode]').forEach(b => {
    b.onclick = () => { mode = b.dataset.gmode; paintMode(); };
  });
  $('#gpacket-close').onclick = () => closeGroupSub(g, opts);
  $('#gpacket-go').onclick = async () => {
    const amount = Math.floor(parseFloat($('#gpacket-amount').value));
    if (!amount || amount <= 0) { miniToast('请输入有效金额'); return; }
    let count = Math.floor(parseInt($('#gpacket-count').value, 10) || 1);
    count = Math.max(1, Math.min(count, members.length, amount));
    closeGroupSub(g, opts);
    await fireGroupPacket(g, { from: 'me' }, { amount, count, mode, note: $('#gpacket-note').value.trim() });
  };
}

/* 话题卡（细则拓展 2）：玩家抛出话题，成员围绕话题接龙讨论（最多 3 轮） */
const TOPIC_PRESETS = ['今天最开心的事', '最近在追的剧', '最想吃的一道菜', '小时候的暑假', '如果可以去任何地方', '最近的小烦恼'];
function showTopicModal(g) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">发话题卡 💬</div>
      <button class="icon-btn" id="topic-close">✕</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
      ${TOPIC_PRESETS.map(t => `<button class="btn" data-topic-preset="${escapeHtml(t)}" style="padding:7px 12px;font-size:13px;">${escapeHtml(t)}</button>`).join('')}
    </div>
    <div class="field"><label>或自定义话题</label><input class="input" id="topic-text" maxlength="40" placeholder="今天最开心的事…"></div>
    <button class="btn primary block" id="topic-go">抛出话题</button>
  `);
  $('#topic-close').onclick = closeModal;
  document.querySelectorAll('[data-topic-preset]').forEach(el => {
    el.onclick = () => { $('#topic-text').value = el.dataset.topicPreset; };
  });
  $('#topic-go').onclick = async () => {
    const text = $('#topic-text').value.trim();
    if (!text) { miniToast('先选一个话题或自己写一个'); return; }
    const m = { id: uid('msg'), groupId: g.id, from: 'me', type: 'topic', content: { text }, time: Date.now() };
    await idbPut('messages', m);
    appendGroupMessage(m);
    renderChatList();
    closeModal();
    const r = effGroupRounds(g);
    const rounds = r === 0 ? 0 : Math.min(3, r); // 细则：话题卡最多聊 3 轮
    startGroupChain(g, { rounds, source: 'topic' });
  };
}

/* 群投票卡片 HTML（共用） */
function voteCardHtml(m) {
  const vc = m.content || {};
  const votes = vc.votes || {};
  const g = chatGroups.find(x => x.id === m.groupId);
  const reasonLines = Object.entries(votes).map(([k, v]) => {
    const who = k === 'me' ? (playerProfile.name || '我') : groupMemberName(g, k);
    const op = (vc.options || [])[v.pick] || '';
    return `${escapeHtml(who)}：投了「${escapeHtml(op)}」${v.reason ? ` —— ${escapeHtml(v.reason)}` : ''}`;
  }).join('<br>');
  return `<div class="msg-card" data-vote-card="${m.id}"><span class="msg-card-tag">📊 群投票</span><div style="font-weight:600;">${escapeHtml(vc.question)}</div><div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">${(vc.options || []).map((op, i) => {
    const cnt = Object.values(votes).filter(v => v.pick === i).length;
    return `<button class="btn" data-vote-opt="${i}" style="justify-content:space-between;padding:8px 12px;font-size:13px;"><span>${escapeHtml(op)}</span><span style="color:var(--text-tertiary);font-size:12px;">${cnt} 票</span></button>`;
  }).join('')}</div><div style="font-size:11.5px;color:var(--text-tertiary);margin-top:6px;line-height:1.6;">${reasonLines || '点选项即可投票'}</div></div>`;
}
function refreshVoteCard(m) {
  const el = document.querySelector(`[data-vote-card="${m.id}"]`);
  if (el) el.outerHTML = voteCardHtml(m);
  // 重绑（outerHTML 替换后按钮是全新节点）
  const fresh = document.querySelector(`[data-vote-card="${m.id}"]`);
  if (fresh) bindVoteCard(m, fresh);
}
function bindVoteCard(m, scope) {
  scope.querySelectorAll('[data-vote-opt]').forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const pick = parseInt(btn.dataset.voteOpt, 10);
      m.content.votes = m.content.votes || {};
      m.content.votes.me = { pick, reason: '' };
      await idbPut('messages', m);
      refreshVoteCard(m);
    };
  });
}
/* 群投票（细则拓展 4）：玩家发起 → 成员陆续投票并给出理由（字卡池抽取；AI 语义投票接口预留） */
function showGroupVoteModal(g) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">发起群投票 📊</div>
      <button class="icon-btn" id="gvote-close">✕</button>
    </div>
    <div class="field"><label>投票问题</label><input class="input" id="gvote-q" maxlength="40" placeholder="比如：周末去哪玩？"></div>
    <div class="field"><label>选项（2～4 个，至少填 2 个）</label>
      <input class="input" id="gvote-o1" maxlength="20" placeholder="选项 1" style="margin-bottom:6px;">
      <input class="input" id="gvote-o2" maxlength="20" placeholder="选项 2" style="margin-bottom:6px;">
      <input class="input" id="gvote-o3" maxlength="20" placeholder="选项 3（可选）" style="margin-bottom:6px;">
      <input class="input" id="gvote-o4" maxlength="20" placeholder="选项 4（可选）">
    </div>
    <button class="btn primary block" id="gvote-go">发起投票</button>
  `);
  $('#gvote-close').onclick = closeModal;
  $('#gvote-go').onclick = async () => {
    const q = $('#gvote-q').value.trim();
    const opts = [1, 2, 3, 4].map(i => $(`#gvote-o${i}`).value.trim()).filter(Boolean);
    if (!q || opts.length < 2) { miniToast('要有问题和至少 2 个选项'); return; }
    const m = { id: uid('msg'), groupId: g.id, from: 'me', type: 'vote', content: { question: q, options: opts, votes: {} }, time: Date.now() };
    await idbPut('messages', m);
    appendGroupMessage(m);
    renderChatList();
    closeModal();
    // 成员陆续投票（1 轮：每人只投一次 + 一句理由，绝不反复）
    chainMembers(g).forEach((mem, i) => {
      setTimeout(async () => {
        try {
          const pick = randInt(0, opts.length - 1);
          const reason = drawReply(cards, getCharBanWords(mem), mem.relation || null, mem.bannedGroups || []);
          m.content.votes[mem.id] = { pick, reason };
          await idbPut('messages', m);
          refreshVoteCard(m);
          await putGroupMsg(g, mem, `我投「${opts[pick]}」——${reason}`);
        } catch (e) {}
      }, 2000 + i * randInt(2200, 5200));
    });
  };
}

/* 群内决策币：选一名成员主持掷币，结果发到群里 */
function showGroupCoinModal(g, member) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">决策币 · ${escapeHtml(member.name)} 主持</div>
      <button class="icon-btn" id="gc-close">✕</button>
    </div>
    <div class="field"><label>要决定什么？</label><input class="input" id="gc-q" maxlength="40" placeholder="比如：中午吃什么？"></div>
    <button class="btn primary block" id="gc-go">掷币 🪙</button>
  `);
  $('#gc-close').onclick = closeModal;
  $('#gc-go').onclick = async () => {
    const q = $('#gc-q').value.trim() || '让命运决定吧';
    const result = Math.random() < 0.5 ? '正面 ✔' : '反面 ✖';
    const m = { id: uid('msg'), groupId: g.id, charId: member.id, from: 'me', type: 'coin', content: { question: `${q}（${member.name} 掷）`, result }, time: Date.now() };
    await idbPut('messages', m);
    appendGroupMessage(m);
    renderChatList();
    closeModal();
    startGroupChain(g, { rounds: 1, source: 'coin' }); // 成员围观反应（1 轮）
  };
}

/* 群内书信：选收信成员，信件卡片进群，成员稍后群内回信（简版） */
function showGroupLetterModal(g, member) {
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">给 ${escapeHtml(member.name)} 写信 ✉️</div>
      <button class="icon-btn" id="gl-close">✕</button>
    </div>
    <div class="field"><label>信的内容</label><textarea class="textarea" id="gl-text" rows="4" maxlength="600" placeholder="写下想对 TA 说的话…"></textarea></div>
    <button class="btn primary block" id="gl-go">寄出信件</button>
  `);
  $('#gl-close').onclick = closeModal;
  $('#gl-go').onclick = async () => {
    const text = $('#gl-text').value.trim();
    if (!text) { miniToast('先写下信的内容'); return; }
    const m = { id: uid('msg'), groupId: g.id, charId: member.id, from: 'me', type: 'letter', content: { preview: text.slice(0, 40), text, groupLetter: true }, time: Date.now(), read: true };
    await idbPut('messages', m);
    appendGroupMessage(m);
    renderChatList();
    closeModal();
    miniToast('信已寄进群里');
    // 成员回信：延迟一条群内消息
    setTimeout(async () => {
      try {
        const reply = await generateGroupReplyText(g, member, { source: 'letter' });
        await putGroupMsg(g, member, `（回信）${reply}`);
      } catch (e) {}
    }, randInt(4, 9) * 1000);
  };
}

/* 群公告横幅（细则二.2）：群聊顶部常驻；点开看全文；✕ 收起（同一份公告只提示一次） */
async function renderGroupNotice(g) {
  const oldBar = $('#group-notice-bar');
  if (oldBar) oldBar.remove();
  if (!g || !g.announcement || !g.announcement.text) return;
  if (currentGroupId !== g.id || document.body.dataset.view !== 'chat') return;
  const hiddenAt = await getSetting('noticeHidden_' + g.id, 0);
  if (hiddenAt >= g.announcement.time) return;
  const scroll = $('#chat-scroll');
  if (!scroll) return;
  const bar = document.createElement('div');
  bar.id = 'group-notice-bar';
  bar.className = 'group-notice-bar';
  bar.innerHTML = `<span class="gn-tag">📢 公告</span><span class="gn-text">${escapeHtml(g.announcement.text)}</span><button class="gn-close">✕</button>`;
  scroll.insertAdjacentElement('beforebegin', bar);
  bar.querySelector('.gn-close').onclick = async (e) => {
    e.stopPropagation();
    await setSetting('noticeHidden_' + g.id, Date.now());
    bar.remove();
  };
  bar.onclick = () => {
    openModal(`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-size:17px;font-weight:600;">📢 群公告</div>
        <button class="icon-btn" id="gnv-close">✕</button>
      </div>
      <div style="font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(g.announcement.text)}</div>
      <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:10px;">发布于 ${escapeHtml(new Date(g.announcement.time).toLocaleString())}</div>
    `);
    $('#gnv-close').onclick = closeModal;
  };
}

/* ============================================================
   以上为 AI 模块核心。衔接点（最小侵入）：
   1. index.html 主页加「API 接入」入口按钮 → btn-home-ai（已做）
   2. bindEvents 里绑定 btn-home-ai → showAIConfigModal（已做）
   3. scheduleCharReply / scheduleGroupReply 内回复内容改为 generateCharReply（已做）
   4. generateDailyCard 内心情/寄语/来信心文（AI 模式）走 aiGenerateDailyCardText（已做）
   5. openChat / openGroupChat 内 ensureModeSwitchUI()（已做）
   6. 占卜 renderDivinationMeaning 处加 AI 解牌（已做）
   7. 群聊设置页加回复节奏/随机发消息/退出后自动聊开关 + init 启动 groupAutoChat 定时器（待做）
   ============================================================ */

/* ---------- 九、朋友圈评论/回复文案（AI 模式走 AI，否则字卡） ----------
   20260929ah：AI 模式下 AI 可用 [[存忆]] 隐藏标记决定把当前这条朋友圈收进记忆宫殿
   （字卡模式下由系统低概率随机收藏）。post：正在互动的朋友圈帖（可空）。 */
async function momentReplyText(char, relation, post = null, opts = {}) {
  if (char && await isAIMode()) {
    try {
      const cfg = await loadAIConfig();
      const ctx = await buildCharAIContext(char.id, []);
      // 20260929bf：把「当前时间 + 帖子全文与发布时间 + 评论区已有对话 + 要回复的那条」都喂给 AI，
      // 修复已读乱回（不看帖子内容、不知道现在几点、不接上文就瞎回）
      const now2 = Date.now();
      const week = ['周日','周一','周二','周三','周四','周五','周六'][new Date(now2).getDay()];
      const hm = new Date(now2).toTimeString().slice(0, 5);
      // 20261001ci：帖子的图片/表情贴纸也喂给 AI（此前 AI 完全看不到帖子配图与表情）
      const pImgN = post && Array.isArray(post.images) ? post.images.length : 0;
      const pSts = post ? ((post.stickers && post.stickers.length) ? post.stickers : (post.sticker ? [post.sticker] : [])) : [];
      const postExtra = (pImgN ? `（这条动态附有 ${pImgN} 张图片${pImgN <= 2 ? '，已给你看' : '，已给你看前 2 张'}）` : '')
        + (pSts.length ? `（表情贴纸：${pSts.join(' ')}）` : '');
      const postDesc = post
        ? `【这条朋友圈】作者是「${(post.authorType === 'player' ? (playerProfile.name || '白日梦主人') : (characters.find(x => x.id === post.authorId)?.name || '梦角'))}」，发布于 ${timeAgoStr(post.createTime)}，正文：\n「${String(post.content || '').slice(0, 200)}」${postExtra}`
        : '';
      // 评论区对话记录（按时间顺序，最多最近 12 条，每条截断 60 字；评论附带的表情包/贴纸也描述给 AI）
      const cmts = post && Array.isArray(post.comments) ? post.comments.slice(-12) : [];
      const nameOf = (who) => who === 'player' ? (playerProfile.name || '我') : (characters.find(x => x.id === who)?.name || '梦角');
      const threadDesc = cmts.length
        ? `【评论区目前对话（时间顺序）】\n${cmts.map(cm => {
            let line = `${nameOf(cm.who)}`;
            if (cm.replyTo) {
              const t = cmts.find(x => x.id === cm.replyTo) || (post.comments || []).find(x => x.id === cm.replyTo);
              if (t) line += `（回复@${nameOf(t.who)}）`;
            }
            // 20261001ci：评论里的表情包图片/emoji 贴纸转为文字描述
            const cmImgN = (cm.imgs && cm.imgs.length) ? cm.imgs.length : (cm.img ? 1 : 0);
            const cmStks = (cm.stickers && cm.stickers.length) ? cm.stickers : (cm.sticker ? [cm.sticker] : []);
            const cmExtra = (cmImgN ? `〔附${cmImgN}张表情包图片〕` : '') + (cmStks.length ? `〔表情：${cmStks.join(' ')}〕` : '');
            return `${line}：${String(cm.content || '').slice(0, 60)}${cmExtra}`;
          }).join('\n')}`
        : '【评论区目前对话】还没有人评论。';
      const rt = opts.replyTo || null;
      const targetDesc = rt
        ? `【你的任务】你现在要以「${char.name}」的身份回复 @${nameOf(rt.who)} 的这条评论：「${String(rt.content || '').slice(0, 80)}」。先读懂上面在聊什么再开口：必须接住对方的话头（回应、反驳、补充或调侃都可以），不要答非所问，不要无视对方说的话，不要重复别人已经说过的内容。`
        : `【你的任务】以「${char.name}」的身份给这条朋友圈发一条新评论：结合帖子正文和当前时间说话（比如深夜就别硬聊清晨的安排），像熟人一样自然。`;
      // 20261001ci：帖子配图（前 2 张）转 base64 附给支持视觉的模型；失败自动去图重试
      let postImgUrls = [];
      if (post && Array.isArray(post.images)) {
        for (const im of post.images.slice(0, 2)) {
          try {
            const du = im && im.blob ? await blobToDataURL(im.blob) : (typeof im === 'string' && im.slice(0, 5) === 'data:' ? im : '');
            if (du) postImgUrls.push(du);
          } catch (e) {}
        }
      }
      const moSys = `你是角色扮演 AI，正在朋友圈评论区互动。当前时间是${week} ${hm}。\n${postDesc}\n${threadDesc}\n${targetDesc}\n要求：写 1 句简短自然的评论（可带 emoji），贴合上文语境，不要跳出角色。\n隐藏指令：若这条朋友圈对你很珍贵/难忘，在评论最末尾另起一行输出 [[存忆]]，系统会替你把这条朋友圈收进记忆宫殿；一般情况不要输出。\n\n${ctx}`;
      const moUser = (withImgs) => withImgs
        ? { role: 'user', content: [{ type: 'text', text: rt ? `请回复 @${nameOf(rt.who)} 的这条评论。这条朋友圈的配图已附在下面。` : '请评论这条朋友圈。这条朋友圈的配图已附在下面。' }, ...postImgUrls.map(u => ({ type: 'image_url', image_url: { url: u } }))] }
        : { role: 'user', content: rt ? `请回复 @${nameOf(rt.who)} 的这条评论。` : '请评论这条朋友圈。' };
      let r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
        { role: 'system', content: moSys }, moUser(postImgUrls.length > 0),
      ], { temperature: 0.9 });
      if (!r.ok && postImgUrls.length) {
        r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
          { role: 'system', content: moSys }, moUser(false),
        ], { temperature: 0.9 });
      }
      if (r.ok && r.text) {
        let text = r.text.trim();
        if (/\[\[\s*存忆\s*\]\]/.test(text) && post) {
          text = text.replace(/\[\[\s*存忆\s*\]\]/g, '').trim();
          aiPalStorePost(char.id, post);
        }
        return text;
      }
    } catch (e) {}
  }
  return drawReply(cards, getCharBanWords(char), relation, char ? (char.bannedGroups || []) : []);
}

/* ============================================================
   十、AI 隐藏指令解析与执行（20260929ah）
   [[MEMO:一句话]] → 由 AI 决定存入记忆宫殿（存进该访客的记忆文件夹）
   [[MOMENT:正文]] → 由 AI 决定代发一条朋友圈
   字卡模式不注入这些指令，随机收藏仍走 palAutoCollectMaybe（聊天）/随机朋友圈收藏。
   ============================================================ */
function parseAITags(text) {
  const out = { clean: String(text || ''), memo: '', moment: '', likes: [], selfLike: false };
  out.clean = out.clean.replace(/\[\[\s*MOMENT\s*[:：]\s*([\s\S]*?)\]\]/gi, (_, v) => { out.moment = v.trim(); return ''; });
  out.clean = out.clean.replace(/\[\[\s*MEMO\s*[:：]\s*([\s\S]*?)\]\]/gi, (_, v) => { out.memo = v.trim(); return ''; });
  // 20261001ci：[[LIKE:编号]] 点赞朋友圈（可多个）；[[SELF_LIKE]] 给自己刚发的动态点赞
  out.clean = out.clean.replace(/\[\[\s*LIKE\s*[:：]\s*(\d+)\s*\]\]/gi, (_, n) => { const k = parseInt(n, 10); if (k > 0) out.likes.push(k); return ''; });
  out.clean = out.clean.replace(/\[\[\s*SELF_LIKE\s*\]\]/gi, () => { out.selfLike = true; return ''; });
  out.clean = out.clean.replace(/\[\[\s*存忆\s*\]\]/g, '').trim();
  return out;
}

/* AI 决定存一条记忆：写进该访客的记忆文件夹（默认可读，跟随文件夹权限） */
async function aiPalStoreMemo(charId, memo) {
  try {
    if (!memo) return;
    await palEnsureFolders();
    const c = characters.find(x => x.id === charId);
    const entry = {
      id: uid('pal'), kind: 'manual',
      folderId: 'pf_char_' + charId, subFolderId: '',
      charId: charId || '', groupId: '',
      messages: [], baseMsgId: '',
      title: memo.replace(/\s+/g, ' ').trim().slice(0, 30) || '一条记忆',
      summary: '', summaryByAI: false,
      text: memo, img: null,
      dateLabel: palDateLabel(Date.now()),
      time: Date.now(), createdAt: Date.now(),
      allowAI: null, auto: true,
    };
    await idbPut('palace', entry);
    miniToast('🏛️ ' + (c ? c.name : 'TA') + ' 把一件重要的事存进了记忆宫殿');
  } catch (e) {}
}

/* AI 决定把一条朋友圈收进记忆宫殿（存进该访客的记忆文件夹） */
async function aiPalStorePost(charId, post) {
  try {
    if (!post) return;
    await palEnsureFolders();
    const author = momentAuthor(post);
    await idbPut('palace', {
      id: uid('pal'), kind: 'post', folderId: 'pf_char_' + charId, subFolderId: '',
      charId: charId || '', groupId: '', messages: [], baseMsgId: '',
      title: (post.content || '朋友圈收藏').replace(/\s+/g, ' ').trim().slice(0, 30) || '朋友圈收藏',
      summary: '', summaryByAI: false,
      text: post.content || '', sticker: post.sticker || '',
      images: (post.images || []).slice(0, 9), img: null,
      authorName: author.name, authorAvatar: author.avatar || '',
      dateLabel: palDateLabel(post.createTime || Date.now()),
      time: post.createTime || Date.now(), createdAt: Date.now(),
      allowAI: null, auto: true,
    });
    const c = characters.find(x => x.id === charId);
    miniToast('🏛️ ' + (c ? c.name : 'TA') + ' 把一条朋友圈收进了记忆宫殿');
  } catch (e) {}
}

/* AI 决定代发一条朋友圈（[[MOMENT:正文]]；20261001ci 支持 [[SELF_LIKE]] 自赞） */
async function aiPostMomentFromTag(charId, content, opts = {}) {
  try {
    if (!content) return;
    const c = characters.find(x => x.id === charId);
    if (!c) return;
    const now = Date.now();
    const post = {
      id: uid('mo'), authorType: 'char', authorId: c.id,
      content: content.trim(), images: [], visibility: { type: 'all', ids: [] },
      likes: [], comments: [], createTime: now,
      pending: [], authorReplies: [],
    };
    if (Math.random() < 0.5) {
      const st = await drawMomentSticker();
      if (st) { if (st.img) post.images.push(st.img); else post.sticker = st.sticker; }
    }
    if (opts.selfLike) post.likes.push({ who: c.id, time: now }); // 20261001ci：AI 判定要给自己这条点赞
    schedulePostInteractions(post);
    const posts = await loadMomentPosts();
    posts.unshift(post);
    await saveMomentPosts(posts);
    if (c.remindMoments !== false && !c.momentsBlocked) {
      const n = (await getSetting('momentsUnread', 0)) + 1;
      await setSetting('momentsUnread', n);
      updateMomentsBadge();
      miniToast('💬 ' + c.name + ' 发布了新动态');
      notifyIncoming(c, content.slice(0, 40), c.name + ' 发布了新动态'); // 20260929bi：统一出口（含挂后台）
    }
    if (document.body.dataset.view === 'moments') renderMoments();
  } catch (e) {}
}

/* ---------- 后台 AI 软调用（主动消息/查岗/书信等） ----------
   与 generateCharReply 的区别：失败只 toast（限频）+ 用字卡兜底，不回滚模式开关、不炸后台循环 */
let _aiSoftFailAt = 0;
async function aiSoftReply(c, instruction, cardFallback) {
  try {
    const cfg = await loadAIConfig();
    if (cfg.chatApi && cfg.chatApi.url) {
      const ctx = await buildCharAIContext(c.id, []);
      const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
        { role: 'system', content: `你是角色扮演 AI，完全以角色身份、口吻输出，不要跳出角色，不要提“AI”“模型”。\n隐藏指令：若输出里有值得永久记住的事，可在最末尾另起一行输出 [[MEMO:一句话记忆]]（最多一条，没有就省略）。写 [[MEMO]] 时请用玩家在上下文里的昵称称呼玩家，不要写“玩家”二字。\n\n${ctx}` },
        { role: 'user', content: instruction },
      ], { temperature: 0.95 });
      if (r.ok && r.text) {
        const parsed = parseAITags(r.text);
        if (parsed.memo) aiPalStoreMemo(c.id, parsed.memo);
        if (parsed.moment) aiPostMomentFromTag(c.id, parsed.moment, { selfLike: parsed.selfLike });
        if (parsed.likes && parsed.likes.length) aiLikeMomentByIndex(c.id, parsed.likes); // 20261001ci
        return parsed.clean || cardFallback();
      }
    }
  } catch (e) {}
  if (Date.now() - _aiSoftFailAt > 60000) {
    _aiSoftFailAt = Date.now();
    miniToast('AI 暂时连不上，这条先用字卡顶上');
  }
  return cardFallback();
}

/* ---------- AI 模式 × 固定间隔发消息：API 消耗警告弹窗（20260929ah） ----------
   界面正中弹窗告知玩家此举会剧烈消耗 API，让玩家谨慎确认。onOk=确认继续。 */
function warnAIApiBurn(onOk) {
  openModal(`
    <div style="text-align:center;padding:8px 0 2px;">
      <div style="font-size:38px;">⚠️</div>
      <div style="font-size:17px;font-weight:600;margin-top:10px;">AI 模式 + 固定间隔发消息</div>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin-top:10px;text-align:left;">
        当前有访客开启了<b>「按固定间隔发消息」</b>。AI 模式下，每一条主动消息、查岗、回信都会实时调用
        你的 API 生成——间隔越短、访客越多，消耗越剧烈，额度可能很快烧完，请谨慎考虑是否要这样做。
        <div style="margin-top:8px;color:var(--text-tertiary);font-size:12px;">建议：改用「随机发消息」拉长间隔，或只在个别访客上开启。</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button class="btn" style="flex:1;" id="aiwarn-cancel">再想想</button>
        <button class="btn primary" style="flex:1;" id="aiwarn-ok">我知道了，继续</button>
      </div>
    </div>
  `);
  $('#aiwarn-cancel').onclick = closeModal;
  $('#aiwarn-ok').onclick = () => { closeModal(); if (onOk) onOk(); };
}
/* 是否存在「按固定间隔发消息」的角色（proactive 开 + 非随机模式） */
function hasFixedProactiveChar() {
  return characters.some(c => {
    const s = getCharChatSettings(c);
    return s.proactive && !s.proactiveRandom;
  });
}

/* 字卡模式：角色有概率把一条朋友圈收进记忆宫殿（每天每角色至多 1 条）
   范围：玩家发布时未屏蔽该访客的帖子（玩家开放权限的）或 TA 自己的帖子。
   AI 模式不走这里——由 AI 的 [[存忆]] 隐藏指令决定（细则：AI 决定存哪条） */
async function palMomentAutoCollectMaybe() {
  try {
    if (await isAIMode()) return;
    const st = await palSettings();
    if (st.autoCollect === false) return;
    if (Math.random() > 0.04) return;
    const posts = await loadMomentPosts();
    if (!posts.length) return;
    // 候选：角色自己的帖 + 玩家帖中该访客有资格互动的（未被屏蔽/可见范围含 TA）
    const cands = [];
    for (const post of posts) {
      if (post.authorType === 'char') {
        const c = characters.find(x => x.id === post.authorId);
        if (c) cands.push({ post, c });
      } else {
        for (const c of relatedCharsForPost(post)) cands.push({ post, c });
      }
    }
    if (!cands.length) return;
    const pick = cands[randInt(0, cands.length - 1)];
    const key = 'palaceAutoMoment_' + pick.c.id;
    const today = new Date().toDateString();
    if ((await getSetting(key, '')) === today) return;
    await palEnsureFolders();
    const author = momentAuthor(pick.post);
    await idbPut('palace', {
      id: uid('pal'), kind: 'post', folderId: 'pf_char_' + pick.c.id, subFolderId: '',
      charId: pick.c.id, groupId: '', messages: [], baseMsgId: '',
      title: (pick.post.content || '朋友圈收藏').replace(/\s+/g, ' ').trim().slice(0, 30) || '朋友圈收藏',
      summary: '', summaryByAI: false,
      text: pick.post.content || '', sticker: pick.post.sticker || '',
      images: (pick.post.images || []).slice(0, 9), img: null,
      authorName: author.name, authorAvatar: author.avatar || '',
      dateLabel: palDateLabel(pick.post.createTime || Date.now()),
      time: pick.post.createTime || Date.now(), createdAt: Date.now(),
      allowAI: null, auto: true,
    });
    await setSetting(key, today);
    miniToast('🏛️ ' + pick.c.name + ' 把一条朋友圈收进了记忆宫殿');
  } catch (e) {}
}

/* ============================================================
   问卷功能（20260929al）
   细则：玩家与梦角双方都能发起问卷；题目自定义/Word导入；不设有效期；
   玩家发≤3条→20分钟抽字卡(2~3条)或AI回复；>3条(上限10条)→"一份问卷"卡片，
   1小时回复，逐条答题最后一起显示；选择题问卷末尾自动加"读后感"输入；
   多份问卷按先后顺序排队顺延；防刷屏→聊天卡片+「查看问卷」历史；
   角色每天随机0~3条向玩家提问（卡片+输入框，玩家作答）。
   ============================================================ */

/* 问卷记录结构（surveys store）：
   { id, charId, from:'me'|'them', title, questions:[{id,text,type:'text'|'choice',options:[],answer:'',answeredAt}],
     state:'pending'|'answering'|'done', queueAt, createdAt, msgId, readBack:'' } */

let _surveyQueue = [];       // 排队中的问卷（内存镜像，启动时从库恢复）
let _surveyTimer = null;
let _surveyCharAskCount = {}; // 角色每天向玩家提问计数 { charId|day: n }

/* 问卷归属角色是否存在（删除访客后清理） */
function _surveyCharExists(charId) {
  return !!characters.find(x => x.id === charId);
}

/* 从问卷记录计算已回答题数 */
function _surveyAnswered(sv) {
  return (sv.questions || []).filter(q => q.answer && q.answer.trim()).length;
}

/* 判断问卷是否全部答完 */
function _surveyDone(sv) {
  return (sv.questions || []).every(q => q.answer && q.answer.trim());
}

/* 20260929an：预计回答状态文案（用户要求：查看问卷和卡片要显示预计还有多长时间回答）
   · 玩家发的问卷：排队中 → 「预计还有 X 分钟回答」；到期 → 「正在翻问卷作答…」
   · 角色提问（from='them'）：等玩家自己答 → 「待你回答」
   · 已答完 → ''（调用方自行显示已完成） */
function _surveyEtaText(sv) {
  if (!sv || _surveyDone(sv)) return '';
  if (sv.from === 'them') return '待你回答';
  if (sv.state === 'answering') return '正在翻问卷作答…';
  const remain = Math.ceil(((sv.queueAt || 0) - Date.now()) / 60000);
  if (remain <= 0) return '正在翻问卷作答…';
  return '预计还有 ' + remain + ' 分钟回答';
}

/* 启动问卷调度：先恢复排队队列，再每 20 秒检查一次是否有到期可答的问卷 */
async function startSurveyTimer() {
  if (_surveyTimer) return;
  try {
    const all = await idbGetAll('surveys');
    // 20260930cc：只收玩家发给角色的问卷（from:'me'）。角色向玩家提问的问卷（from:'them'）
    // 是等玩家作答的，绝不能进答题队列——此前 state:'answering' 被这里捞起，20 秒后角色自答了自己的问题（大 bug）
    _surveyQueue = all.filter(sv => sv.from !== 'them' && (sv.state === 'pending' || sv.state === 'answering'))
      .sort((a, b) => (a.queueAt || 0) - (b.queueAt || 0));
  } catch (e) { _surveyQueue = []; }
  _surveyTimer = setInterval(() => surveyAnswerTick(), 20000);
}

/* 答题调度：按排队顺序，只有队首问卷到期才处理；答完出队，下一份顺延 */
async function surveyAnswerTick() {
  try {
    // 20260929an：有排队中的问卷、且正停留在该访客的聊天页 → 每 20 秒重绘一次消息，
    // 让卡片上的「预计还有 X 分钟回答」倒计时走起来（renderMessages 只重绘消息区，不影响输入框）
    if (currentCharId && document.body.dataset.view === 'chat'
        && _surveyQueue.some(sv => sv.charId === currentCharId && !_surveyDone(sv))) {
      renderMessages(currentCharId);
    }
    if (!_surveyQueue.length) return;
    // 清理已不存在的角色问卷
    _surveyQueue = _surveyQueue.filter(sv => _surveyCharExists(sv.charId));
    if (!_surveyQueue.length) return;
    const sv = _surveyQueue[0];
    const now = Date.now();
    if (now < (sv.queueAt || 0)) return; // 队首未到期，后面的顺延等待
    await _answerSurvey(sv);
  } catch (e) {}
}

/* 回答一份问卷（玩家发起的，角色作答）：逐条抽字卡或AI，最后一起显示 */
async function _answerSurvey(sv) {
  try {
    // 重新从库读最新（可能已被删除）
    const cur = await idbGet('surveys', sv.id);
    if (!cur || cur.state === 'done') { _surveyQueue.shift(); return; }
    // 20260930cc：兜底守卫——角色向玩家提问的问卷由玩家作答，绝不允许角色自答
    if (cur.from === 'them') { _surveyQueue.shift(); return; }
    cur.state = 'answering';
    await idbPut('surveys', cur);

    const c = characters.find(x => x.id === cur.charId);
    const aiOn = await isAIMode();
    const qs = cur.questions || [];
    for (const q of qs) {
      if (q.answer && q.answer.trim()) continue; // 已答跳过
      let ans = '';
      if (aiOn) {
        // AI 模式：AI 按角色口吻回答该问题
        try {
          const cfg = await loadAIConfig();
          if (cfg.chatApi && cfg.chatApi.url) {
            const ctx = await buildCharAIContext(cur.charId, []);
            const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
              { role: 'system', content: `你是角色扮演 AI。请以角色的身份、口吻回答下面这道问卷题，简短自然（1~2 句），不要跳出角色。\n\n${ctx}` },
              { role: 'user', content: `问卷题：${q.text}` },
            ], { temperature: 0.9 });
            if (r.ok && r.text) ans = r.text.trim().slice(0, 200);
          }
        } catch (e) {}
      }
      if (!ans) {
        // 字卡模式 / AI 失败回退：每题抽 2~3 条字卡拼接（细则：每条问题抽2~3条字卡回复）
        const n = randInt(2, 3);
        const parts = [];
        for (let i = 0; i < n; i++) {
          parts.push(drawReply(cards, getCharBanWords(c), c ? (c.relation || null) : null, c ? (c.bannedGroups || []) : []));
        }
        ans = parts.join('，');
      }
      q.answer = ans;
      q.answeredAt = Date.now();
    }

    // 选择题问卷：最后补一条"读后感"（角色对做这份问卷的感想，抽字卡或AI）
    const hasChoice = qs.some(q => q.type === 'choice');
    if (hasChoice && !cur.readBack) {
      let back = '';
      if (aiOn) {
        try {
          const cfg = await loadAIConfig();
          if (cfg.chatApi && cfg.chatApi.url) {
            const ctx = await buildCharAIContext(cur.charId, []);
            const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
              { role: 'system', content: `你是角色扮演 AI。刚做完了玩家的一份问卷，请以角色口吻说一句"做这份问卷的感想"（1~2 句，自然不跳戏）。\n\n${ctx}` },
              { role: 'user', content: '说说你做这份问卷的感想。' },
            ], { temperature: 0.95 });
            if (r.ok && r.text) back = r.text.trim().slice(0, 200);
          }
        } catch (e) {}
      }
      if (!back) back = drawReply(cards, getCharBanWords(c), c ? (c.relation || null) : null, c ? (c.bannedGroups || []) : []);
      cur.readBack = back;
    }

    cur.state = 'done';
    cur.doneAt = Date.now();
    await idbPut('surveys', cur);
    _surveyQueue.shift();

    // 顺延下一份：从上一份完成时刻起重新计时（细则：多份问卷顺序排队，绝不并发）
    if (_surveyQueue.length) {
      const next = _surveyQueue[0];
      const isMulti = (next.questions || []).length > 3;
      next.queueAt = Date.now() + (isMulti ? randInt(10, 60) : randInt(15, 20)) * 60000;
      await idbPut('surveys', next);
    }

    // 更新聊天卡片消息的状态
    await _refreshSurveyCardMsg(cur);
    miniToast('📋 ' + (c ? c.name : 'TA') + ' 已答完你的问卷');
    if (currentCharId === cur.charId && document.body.dataset.view === 'chat') {
      renderMessages(cur.charId);
    } else {
      renderChatList();
    }
  } catch (e) {
    // 答题出错：保持排队，下次再试
    try {
      const cur = await idbGet('surveys', sv.id);
      if (cur && cur.state === 'answering') { cur.state = 'pending'; await idbPut('surveys', cur); }
    } catch (e2) {}
  }
}

/* 刷新聊天里的问卷卡片消息状态 */
async function _refreshSurveyCardMsg(sv) {
  try {
    const all = await idbGetAll('messages');
    const m = all.find(x => x.type === 'survey' && x.content && x.content.surveyId === sv.id);
    if (!m) return;
    m.content.answeredCount = _surveyAnswered(sv);
    m.content.totalCount = (sv.questions || []).length;
    m.content.done = _surveyDone(sv);
    m.content.queueAt = sv.queueAt || 0; // 20260929an：同步排队截止时间（顺延后卡片倒计时跟随）
    await idbPut('messages', m);
  } catch (e) {}
}

/* 玩家发送问卷：落库 + 发聊天卡片 + 入队 */
async function sendSurveyToChar(charId, questions, isChoice, opts = {}) {
  if (!charId || !questions || !questions.length) { miniToast('问卷还没有题目'); return; }
  const c = characters.find(x => x.id === charId);
  if (!c) { miniToast('访客不存在'); return; }
  const groupId = opts.groupId || null; // 20260929be：群聊发起时问卷卡片发到群里
  const count = questions.length;
  // 上限 10 条
  if (count > 10) { miniToast('一次问卷最多 10 条题目'); return; }
  const isMulti = count > 3; // >3 条 = "一份问卷"
  const title = isMulti ? '我向你发出了一份问卷，快来回答吧！' : '想问你几件事';

  const sv = {
    id: uid('survey'),
    charId,
    from: 'me',
    title,
    questions: questions.map(q => ({
      id: uid('q'), text: q.text, type: q.type || 'text',
      options: q.options || [], answer: '', answeredAt: 0,
    })),
    state: 'pending',
    // 20260929an：≤3条 → 20 分钟内答完（随机 15~20 分钟，贴近 20 分钟上限）；>3条：1小时内（随机 10~60 分钟）
    queueAt: Date.now() + (isMulti ? randInt(10, 60) : randInt(15, 20)) * 60000,
    createdAt: Date.now(),
    msgId: '',
    readBack: '',
  };
  await idbPut('surveys', sv);

  // 发聊天卡片消息（content.queueAt：卡片上显示「预计还有 X 分钟回答」倒计时用）
  const m = {
    id: uid('msg'), charId, from: 'me', type: 'survey', time: Date.now(),
    content: { surveyId: sv.id, title, totalCount: count, answeredCount: 0, done: false, queueAt: sv.queueAt },
  };
  if (groupId) m.groupId = groupId;
  sv.msgId = m.id;
  await idbPut('surveys', sv);
  await idbPut('messages', m);

  // 排队：追加到队尾（按 queueAt 排序）
  _surveyQueue.push(sv);
  _surveyQueue.sort((a, b) => (a.queueAt || 0) - (b.queueAt || 0));

  if (groupId && currentGroupId === groupId && document.body.dataset.view === 'chat') {
    appendGroupMessage(m);
  } else if (!groupId && currentCharId === charId && document.body.dataset.view === 'chat') {
    appendMessage(m);
  }
  renderChatList();
  if (!opts.quiet) miniToast(isMulti ? '问卷已发出，TA 会在 1 小时内逐题作答' : '问卷已发出，TA 会在 20 分钟内作答');
}

/* 角色向玩家提问（每天0~3条）：卡片+输入框，玩家作答 */
async function charAskPlayer(c) {
  if (!c) return;
  const day = todayKey();
  const key = c.id + '|' + day;
  _surveyCharAskCount[key] = (_surveyCharAskCount[key] || 0) + 1;
  // 从字卡库/默认问题池抽一个问题（AI 模式由 AI 出题）
  let question = '';
  const aiOn = await isAIMode();
  if (aiOn) {
    try {
      const cfg = await loadAIConfig();
      if (cfg.chatApi && cfg.chatApi.url) {
        const ctx = await buildCharAIContext(c.id, []);
        const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
          { role: 'system', content: `你是角色扮演 AI。请以角色口吻向玩家提一个自然的小问题（类似闲聊里的好奇发问，20 字内），不要跳出角色。\n\n${ctx}` },
          { role: 'user', content: '向玩家提一个问题。' },
        ], { temperature: 0.95 });
        if (r.ok && r.text) question = r.text.trim().slice(0, 40);
      }
    } catch (e) {}
  }
  if (!question) {
    const pool = (cards.customReplies || []).concat((cards.customReplyGroups || []).flatMap(g => g.items || []));
    question = pool.length ? drawFrom(pool) : '你今天过得怎么样？';
  }

  const sv = {
    id: uid('survey'),
    charId: c.id,
    from: 'them',
    title: question,
    questions: [{ id: uid('q'), text: question, type: 'text', options: [], answer: '', answeredAt: 0 }],
    state: 'answering', // 等待玩家作答
    queueAt: 0,
    createdAt: Date.now(),
    msgId: '',
    readBack: '',
  };
  await idbPut('surveys', sv);

  const m = {
    id: uid('msg'), charId: c.id, from: 'them', type: 'survey', time: Date.now(),
    content: { surveyId: sv.id, title: question, totalCount: 1, answeredCount: 0, done: false, charAsk: true },
  };
  sv.msgId = m.id;
  await idbPut('surveys', sv);
  await idbPut('messages', m);

  if (currentCharId === c.id && document.body.dataset.view === 'chat') {
    appendMessage(m);
    if (shouldDingFor(c)) playDing(); // 20260930：聊天页内当前角色发问卷也响提示音
  } else {
    renderChatList();
    if (shouldDingFor(c)) playDing();
  }
}

/* 玩家回答角色发来的提问（输入框作答，落库 + 更新卡片） */
async function playerAnswerSurvey(surveyId, answer) {
  const sv = await idbGet('surveys', surveyId);
  if (!sv) { miniToast('问卷不存在'); return; }
  const q = (sv.questions || [])[0];
  if (!q) return;
  q.answer = answer.trim();
  q.answeredAt = Date.now();
  sv.state = 'done';
  sv.doneAt = Date.now();
  await idbPut('surveys', sv);
  await _refreshSurveyCardMsg(sv);
  if (currentCharId === sv.charId && document.body.dataset.view === 'chat') renderMessages(sv.charId);
  else renderChatList();
  miniToast('已提交你的回答');
  _charReactToAnswers(sv); // 20260930cb：玩家答完 → 角色逐题回「感想」
}

/* 角色对玩家的问卷回答逐题发感想（20260930cb）：每题一条、间隔连发。
   字卡模式：每题抽一条字卡；AI 模式：AI 结合题目+玩家回答生成感想（失败回退字卡）。 */
async function _charReactToAnswers(sv) {
  try {
    const c = characters.find(x => x.id === sv.charId);
    if (!c) return;
    const answered = (sv.questions || []).filter(q => q.answer && q.answer.trim());
    if (!answered.length) return;
    const aiOn = await isAIMode();
    for (let i = 0; i < answered.length; i++) {
      const q = answered[i];
      let text = '';
      if (aiOn) {
        try {
          const cfg = await loadAIConfig();
          if (cfg.chatApi && cfg.chatApi.url) {
            const ctx = await buildCharAIContext(sv.charId, []);
            const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
              { role: 'system', content: `你是角色扮演 AI。玩家刚刚回答了你的问卷题，请以角色口吻针对这道题和玩家的回答说一句感想（1~2 句，自然不跳戏，可以共情、调侃或追问）。\n\n${ctx}` },
              { role: 'user', content: `题目：${q.text}\n玩家的回答：${q.answer}` },
            ], { temperature: 0.95 });
            if (r.ok && r.text) text = r.text.trim().slice(0, 200);
          }
        } catch (e) {}
      }
      if (!text) text = drawReply(cards, getCharBanWords(c), c.relation || null, c.bannedGroups || []);
      const m = { id: uid('msg'), charId: sv.charId, from: 'them', type: 'text', content: text, time: Date.now() };
      await idbPut('messages', m);
      if (currentCharId === sv.charId && document.body.dataset.view === 'chat') appendMessage(m);
      else renderChatList();
      if (shouldDingFor(c)) playDing();
      if (i < answered.length - 1) await new Promise(r => setTimeout(r, randInt(1500, 3200)));
    }
    renderChatList();
  } catch (e) {}
}

/* 打开问卷详情（题目+回答状态） */
async function openSurveyDetail(surveyId) {
  if (!surveyId) return;
  const sv = await idbGet('surveys', surveyId);
  if (!sv) { miniToast('问卷不存在'); return; }
  const c = characters.find(x => x.id === sv.charId);
  const isCharAsk = sv.from === 'them';
  const done = _surveyDone(sv);
  const answered = _surveyAnswered(sv);
  // 20260930cd：进入详情前记录列表滚动位，返回查看列表时恢复（不跳回顶部）
  const prevBox = $('#modal-content');
  const prevList = $('#svl-list');
  const snapSt = prevBox ? prevBox.scrollTop : 0;
  const snapListSt = prevList ? prevList.scrollTop : 0;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">📋 问卷详情</div>
      <button class="icon-btn" id="svd-close">✕</button>
    </div>
    <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:12px;">${isCharAsk ? (c ? c.name : 'TA') + ' 向你提问' : '你向 ' + (c ? c.name : 'TA') + ' 提问'} · 共 ${sv.questions.length} 题 · ${done ? '已全部回答' : (_surveyEtaText(sv) || (answered > 0 ? '回答中' : '待回答'))}</div>
    <div style="display:flex;flex-direction:column;gap:10px;max-height:46vh;overflow:auto;" id="svd-list">
      ${sv.questions.map((q, i) => `
        <div style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px;">${i + 1}. ${escapeHtml(q.text)}</div>
          ${q.type === 'choice' && q.options && q.options.length ? `<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px;">选项：${q.options.map(o => escapeHtml(o)).join(' / ')}</div>` : ''}
          ${q.answer && q.answer.trim() ? `<div style="font-size:13px;line-height:1.55;padding:8px 10px;background:var(--bg);border-radius:8px;">${escapeHtml(q.answer)}</div>` : `<div style="font-size:12px;color:var(--text-tertiary);font-style:italic;">（未回答）</div>`}
        </div>
      `).join('')}
      ${sv.readBack ? `<div style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;"><div style="font-size:13px;font-weight:600;margin-bottom:4px;">💬 ${c ? c.name : 'TA'} 的读后感</div><div style="font-size:13px;line-height:1.55;">${escapeHtml(sv.readBack)}</div></div>` : ''}
    </div>
    ${isCharAsk && !done ? `
      <div class="field" style="margin-top:14px;">
        <label>你的回答</label>
        <textarea class="textarea" id="svd-answer" placeholder="输入你的回答…" style="min-height:70px;"></textarea>
        <button class="btn primary block" id="svd-submit" style="margin-top:10px;">提交回答</button>
      </div>
    ` : ''}
  `);
  $('#svd-close').onclick = async () => {
    await showSurveyList();
    requestAnimationFrame(() => {
      const box = $('#modal-content');
      if (box && snapSt) box.scrollTop = snapSt;
      const list = $('#svl-list');
      if (list && snapListSt) list.scrollTop = snapListSt;
    });
  };
  if (isCharAsk && !done) {
    $('#svd-submit').onclick = async () => {
      const ans = $('#svd-answer').value.trim();
      if (!ans) { miniToast('请输入你的回答'); return; }
      await playerAnswerSurvey(surveyId, ans);
      openSurveyDetail(surveyId);
    };
  }
}

/* 问卷功能页（+号菜单进入）：添加问卷 / 查看问卷。关闭层级：
   hub ✕ → 回聊天页；添加问卷/查看问卷 ✕ → 回 hub；详情 ✕ → 回查看问卷 */
function showSurveyHub() {
  const c = currentCharId ? characters.find(x => x.id === currentCharId) : null;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">📋 问卷</div>
      <button class="icon-btn" id="svh-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:14px;">${c ? '当前聊天对象：' + escapeHtml(c.name) : '请先在单聊里打开问卷'}</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn primary block" id="svh-add" ${c ? '' : 'disabled'} style="padding:14px;">➕ 添加问卷</button>
      <button class="btn block" id="svh-view" style="padding:14px;">📖 查看问卷</button>
    </div>
  `);
  $('#svh-close').onclick = closeModal;
  $('#svh-add').onclick = () => {
    if (!c) { miniToast('请先进入与访客的单聊'); return; }
    showSurveyCompose([c.id]);
  };
  $('#svh-view').onclick = () => showSurveyList();
}

/* 20260929be：群聊问卷——多选成员发起 + 右上角「查看问卷」（与单聊问卷中心同套功能） */
function showGroupSurveyModal(g) {
  const members = chainMembers(g);
  if (!members.length) { miniToast('群里没有可以作答的成员'); return; }
  const sel = new Set();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:17px;font-weight:600;">问卷 · 选择作答成员</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="btn" id="gsv-view" style="padding:6px 12px;font-size:12.5px;">${icon('doc', 14)} 查看问卷</button>
        <button class="icon-btn" id="gsv-close">${icon('close', 18)}</button>
      </div>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:12px;">勾选一个或多个成员，同一份问卷会分别发给他们作答</div>
    <div style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
      ${members.map(c => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;" data-gsv="${c.id}">
          <div class="avatar sm">${c.avatar ? `<img src="${imgSrc(c.avatar)}">` : escapeHtml(c.name[0] || '?')}</div>
          <div style="flex:1;font-size:14px;font-weight:600;">${escapeHtml((g.memberNick || {})[c.id] || c.name)}</div>
          <div class="gsv-check" style="width:20px;height:20px;border-radius:50%;border:2px solid var(--text-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;color:#141019;flex-shrink:0;"></div>
        </div>`).join('')}
    </div>
    <button class="btn primary block" id="gsv-next" style="padding:13px;">去发起问卷（已选 0 人）</button>
  `);
  $('#gsv-close').onclick = closeModal;
  $('#gsv-view').onclick = () => showSurveyList();
  const syncNext = () => {
    $('#gsv-next').textContent = `去发起问卷（已选 ${sel.size} 人）`;
    $('#gsv-next').style.opacity = sel.size ? '1' : '.5';
  };
  document.querySelectorAll('[data-gsv]').forEach(row => {
    row.onclick = () => {
      const id = row.dataset.gsv;
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      const chk = row.querySelector('.gsv-check');
      chk.style.background = sel.has(id) ? 'var(--purple)' : 'transparent';
      chk.style.borderColor = sel.has(id) ? 'var(--purple)' : 'var(--text-tertiary)';
      chk.textContent = sel.has(id) ? '✓' : '';
      syncNext();
    };
  });
  syncNext();
  $('#gsv-next').onclick = () => {
    if (!sel.size) { miniToast('先勾选至少一位作答成员'); return; }
    showSurveyCompose([...sel], { groupId: g.id, back: () => showGroupSurveyModal(g) });
  };
}

/* 添加问卷编辑区（两步分离：输入/导入 → 完成存草稿 → 发送才真正发到聊天）
   20260929be：charIds 支持多角色（群聊多选发起）；opts.groupId=发到群聊；opts.back=取消/关闭的返回 */
function showSurveyCompose(charIds, opts = {}) {
  const recipients = (Array.isArray(charIds) ? charIds : [charIds]).filter(Boolean);
  const groupId = opts.groupId || null;
  const backFn = opts.back || (() => showSurveyHub());
  const first = characters.find(x => x.id === recipients[0]);
  if (!first || !recipients.length) return;
  const whoLabel = recipients.length === 1
    ? `发给「${escapeHtml((first.memberNick ? first.memberNick : null) || first.name)}」`
    : `发给「${escapeHtml(first.name)}」等 ${recipients.length} 位成员`;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">添加问卷</div>
      <button class="icon-btn" id="svc-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:12px;">${whoLabel} · 手动输入题目，或导入 Word 文档（选择题会直接解析成选择题）</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:44vh;overflow:auto;margin-bottom:12px;" id="svc-list"></div>
    <button class="btn block" id="svc-addq" style="padding:10px;">＋ 添加一道题</button>
    <button class="btn block" id="svc-addchoice" style="padding:10px;margin-top:8px;">⊕ 添加选择题（最多 5 个选项）</button>
    <label class="btn block" for="svc-docx" style="padding:10px;cursor:pointer;margin-top:8px;">📄 导入 Word 文档（.docx）</label>
    <input type="file" id="svc-docx" accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none;">
    <div style="font-size:11px;color:#e5615c;margin-top:6px;font-weight:600;">⚠ 选择题会自动在问卷末尾增加一道「读后感」输入，由访客作答</div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn" style="flex:1;" id="svc-cancel">返回</button>
      <button class="btn primary" style="flex:1;" id="svc-send">发送</button>
    </div>
  `);
  let qs = []; // 内存题目列表 [{text,type,options}]
  const renderQList = () => {
    $('#svc-list').innerHTML = qs.map((q, i) => `
      <div style="background:var(--bg-elevated-2);border-radius:12px;padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:var(--text-tertiary);flex-shrink:0;">${i + 1}.</span>
          <input class="input" data-qidx="${i}" data-qf="text" value="${escapeHtml(q.text)}" placeholder="${q.type === 'choice' ? '问题内容' : '题目内容'}" style="flex:1;">
          <button class="icon-btn" data-qdel="${i}">✕</button>
        </div>
        ${q.type === 'choice' ? `
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
            ${(q.options || []).map((opt, oi) => `
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:12px;color:var(--text-tertiary);flex-shrink:0;width:16px;text-align:center;">${String.fromCharCode(65 + oi)}</span>
                <input class="input" data-qidx="${i}" data-oidx="${oi}" data-of="opt" value="${escapeHtml(opt)}" placeholder="选项 ${String.fromCharCode(65 + oi)}" style="flex:1;">
                <button class="icon-btn" data-odel="${i}:${oi}" title="删除该选项">✕</button>
              </div>`).join('')}
            ${(q.options || []).length < 5
              ? `<button class="btn" data-oadd="${i}" style="padding:7px 0;font-size:12.5px;">＋ 添加选项（${(q.options || []).length}/5）</button>`
              : `<div style="font-size:11.5px;color:var(--text-tertiary);text-align:center;">选项最多 5 个</div>`}
          </div>` : ''}
      </div>
    `).join('') || `<div style="text-align:center;color:var(--text-tertiary);font-size:13px;padding:16px;">还没有题目，点下方「添加一道题」「添加选择题」或导入 Word</div>`;
    // 绑定输入
    document.querySelectorAll('[data-qf="text"]').forEach(inp => {
      inp.oninput = () => { qs[+inp.dataset.qidx].text = inp.value; };
    });
    // 选择题：逐行选项输入框（20260930cb）
    document.querySelectorAll('[data-of="opt"]').forEach(inp => {
      inp.oninput = () => { qs[+inp.dataset.qidx].options[+inp.dataset.oidx] = inp.value; };
    });
    document.querySelectorAll('[data-oadd]').forEach(btn => {
      btn.onclick = () => {
        const q = qs[+btn.dataset.oadd];
        if ((q.options || []).length >= 5) { miniToast('选项最多 5 个'); return; }
        q.options.push('');
        renderQList();
      };
    });
    document.querySelectorAll('[data-odel]').forEach(btn => {
      btn.onclick = () => {
        const [qi, oi] = btn.dataset.odel.split(':').map(Number);
        qs[qi].options.splice(oi, 1);
        renderQList();
      };
    });
    document.querySelectorAll('[data-qdel]').forEach(btn => {
      btn.onclick = () => { qs.splice(+btn.dataset.qdel, 1); renderQList(); };
    });
  };
  $('#svc-addq').onclick = () => { qs.push({ text: '', type: 'text', options: [] }); renderQList(); };
  $('#svc-addchoice').onclick = () => { qs.push({ text: '', type: 'choice', options: ['', ''] }); renderQList(); }; // 20260930cb：默认给两个空选项行
  $('#svc-close').onclick = backFn;
  $('#svc-cancel').onclick = backFn;
  $('#svc-send').onclick = async () => {
    // 收集并过滤空题；选择题选项去掉空行，且至少要有 2 个选项
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      if (!q.text || !q.text.trim()) continue;
      if (q.type === 'choice') {
        q.options = (q.options || []).map(s => String(s).trim()).filter(Boolean);
        if (q.options.length < 2) { miniToast(`第 ${i + 1} 题选择题至少需要 2 个选项`); return; }
      }
    }
    const valid = qs.filter(q => q.text && q.text.trim());
    if (!valid.length) { miniToast('请先添加至少一道题'); return; }
    const isChoice = valid.some(q => q.type === 'choice');
    // 20260929be：多角色 = 同一份问卷分别发给每位成员（群聊时卡片发到群里）
    for (let i = 0; i < recipients.length; i++) {
      await sendSurveyToChar(recipients[i], valid.map(q => ({ text: q.text.trim(), type: q.type, options: q.options })), isChoice, { groupId, quiet: i > 0 });
    }
    if (recipients.length > 1) miniToast(`问卷已发给 ${recipients.length} 位成员，TA 们会陆续作答`);
    closeModal(); // 发完直接回聊天页（问卷卡片已发出）
  };
  // Word 导入
  $('#svc-docx').onchange = async () => {
    const f = $('#svc-docx').files[0];
    $('#svc-docx').value = '';
    if (!f) return;
    if (!/\.(docx|doc)$/i.test(f.name)) { miniToast('请选择 .docx / .doc 文件'); return; }
    try {
      const buf = await f.arrayBuffer();
      const { doc } = await _readDocxTextFromZip(buf);
      const paras = _extractDocxParagraphs(doc);
      if (!paras.length) { miniToast('未从文档中解析到题目'); return; }
      const parsed = _parseDocxQuestions(paras);
      qs = qs.concat(parsed);
      renderQList();
      miniToast(`已解析 ${parsed.length} 道题（${parsed.filter(p => p.type === 'choice').length} 道选择题）`);
    } catch (e) { miniToast('Word 解析失败：' + (e && e.message ? e.message : '未知错误')); }
  };
  renderQList();
}

/* 从 docx document.xml 提取段落纯文本 */
function _extractDocxParagraphs(docXml) {
  if (!docXml) return [];
  const paras = [];
  const pRe = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = pRe.exec(docXml))) {
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t, txt = '';
    while ((t = tRe.exec(m[0]))) txt += t[1];
    txt = txt.replace(/<w:tab[^>]*\/>/g, ' ').trim();
    if (txt) paras.push(txt);
  }
  return paras;
}

/* 解析段落为题目：选择题识别（选项以 A./B./C./D. 或 ①②③④ 开头，独立成段或同段） */
function _parseDocxQuestions(paras) {
  const out = [];
  // 单个段落是否像一个选项（A.xxx / ①xxx / 1.xxx 开头且较短）
  const isOption = (s) => /^[A-Da-d][\.、．)）:：]\s*\S/.test(s) || /^[①②③④]/.test(s);
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i].trim();
    if (!p) continue;
    // 情况1：下一段是选项开头 → 当前段是题干，收集后续连续选项段
    if (i + 1 < paras.length && isOption(paras[i + 1].trim())) {
      const stem = p.replace(/^[0-9]+[\.、．)）:：]\s*/, '').trim() || p;
      const opts = [];
      let j = i + 1;
      while (j < paras.length && isOption(paras[j].trim())) {
        opts.push(paras[j].trim().replace(/^[A-Da-d][\.、．)）:：]\s*|^[①②③④]\s*/, '').trim());
        j++;
      }
      out.push({ text: stem, type: 'choice', options: opts });
      i = j - 1;
      continue;
    }
    // 情况2：同一段内含多个选项标记（A. B. C. D. 分散，前面可以是空格/标点/开头）
    const optMarks = p.match(/(?:^|[^\u3400-\u9FFFa-zA-Z0-9])[A-Da-d][\.、．)）]/g);
    if (optMarks && optMarks.length >= 2) {
      const firstOpt = p.search(/[A-Da-d][\.、．)）]/);
      const stem = firstOpt > 0 ? p.slice(0, firstOpt).replace(/^[0-9]+[\.、．)）:：]\s*/, '').replace(/[：:？?]\s*$/, '').trim() : p;
      const optsPart = p.slice(firstOpt);
      const opts = optsPart.split(/(?=[A-Da-d][\.、．)）])/).map(s => s.replace(/^[A-Da-d][\.、．)）]\s*/, '').trim()).filter(Boolean);
      out.push({ text: stem || p, type: 'choice', options: opts });
      continue;
    }
    // 普通题
    out.push({ text: p, type: 'text', options: [] });
  }
  return out;
}

/* 查看问卷：历史列表 + 批量删除 */
let _svlBatchMode = false;   // 批量管理模式开关
const _svlSel = new Set();   // 批量选中问卷 id
let _svlAll = [];            // 20260930cc：当前列表数据镜像（批量点选就地更新时间戳用）
async function showSurveyList() {
  const all = (await idbGetAll('surveys')).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  _svlAll = all;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:18px;font-weight:600;">📖 查看问卷</div>
      <button class="icon-btn" id="svl-close">✕</button>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="font-size:12.5px;color:var(--text-tertiary);" id="svl-count">共 ${all.length} 份问卷 · ${_svlBatchMode ? '点选要删除的问卷' : '点条目查看详情'}</div>
      ${all.length ? `<button class="btn" id="svl-batch" style="padding:6px 12px;font-size:12px;${_svlBatchMode ? 'background:var(--danger);color:#fff;' : ''}">${_svlBatchMode ? '删除选中' : '批量管理'}</button>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto;" id="svl-list">
      ${all.map(sv => {
        const c = characters.find(x => x.id === sv.charId);
        const done = _surveyDone(sv);
        const answered = _surveyAnswered(sv);
        const sel = _svlSel.has(sv.id);
        // 20260929an：状态里带「预计还有 X 分钟回答」倒计时（用户要求）
        const statusTxt = done ? '已完成' : (_surveyEtaText(sv) || (answered > 0 ? '回答中 ' + answered + '/' + sv.questions.length : '待回答'));
        // 20260930cc：选中框用 inset box-shadow——outline 会被列表容器 overflow:auto 裁掉左右两侧
        return `<div class="svl-item" data-svid="${sv.id}" style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:10px;${sel ? 'box-shadow:inset 0 0 0 2px var(--purple-soft);' : ''}">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(sv.title || '问卷')}</div>
            <div style="font-size:12px;color:var(--text-tertiary);margin-top:3px;">${sv.from === 'them' ? (c ? c.name : 'TA') + ' 问你' : '你问 ' + (c ? c.name : 'TA')} · ${sv.questions.length} 题 · ${statusTxt}</div>
          </div>
          <div data-selmark style="flex-shrink:0;">${sel ? `<span style="font-size:18px;color:var(--purple-soft);">✓</span>` : `<span style="font-size:11px;color:var(--text-tertiary);">${timeAgoStr(sv.createdAt)}</span>`}</div>
        </div>`;
      }).join('') || `<div style="text-align:center;color:var(--text-tertiary);font-size:13px;padding:24px;">还没有问卷</div>`}
    </div>
  `);
  $('#svl-close').onclick = () => { _svlBatchMode = false; _svlSel.clear(); showSurveyHub(); };
  // 点条目：批量模式下切换选中（20260930cc：就地更新不重渲染，滚动位置不跳顶），否则看详情
  document.querySelectorAll('[data-svid]').forEach(el => {
    el.onclick = () => {
      if (_svlBatchMode) {
        const id = el.dataset.svid;
        const sel = !_svlSel.has(id);
        if (sel) _svlSel.add(id); else _svlSel.delete(id);
        el.style.boxShadow = sel ? 'inset 0 0 0 2px var(--purple-soft)' : 'none';
        const mark = el.querySelector('[data-selmark]');
        if (mark) {
          const sv = (_svlAll || []).find(x => x.id === id);
          mark.innerHTML = sel
            ? `<span style="font-size:18px;color:var(--purple-soft);">✓</span>`
            : `<span style="font-size:11px;color:var(--text-tertiary);">${sv ? timeAgoStr(sv.createdAt) : ''}</span>`;
        }
        const cnt = $('#svl-count');
        if (cnt) cnt.textContent = `已选 ${_svlSel.size} 份 · 点选要删除的问卷`;
      } else {
        openSurveyDetail(el.dataset.svid);
      }
    };
  });
  // 批量管理按钮
  const batchBtn = $('#svl-batch');
  if (batchBtn) {
    batchBtn.onclick = () => {
      if (_svlBatchMode) {
        if (!_svlSel.size) { miniToast('请先点选要删除的问卷'); return; }
        showConfirm(`确定删除选中的 ${_svlSel.size} 份问卷吗？`, async () => {
          for (const id of _svlSel) await idbDelete('surveys', id);
          _svlSel.clear();
          _svlBatchMode = false;
          miniToast('已删除');
          showSurveyList();
        });
      } else {
        _svlBatchMode = true;
        miniToast('点选要删除的问卷，再点「删除选中」确认');
        showSurveyList();
      }
    };
  }
}

/* 访客主动提问入口：搭在主动消息节奏里（每天0~3条，不新增独立定时器） */
async function maybeCharAskPlayer(c) {
  if (!c) return;
  const day = todayKey();
  const key = c.id + '|' + day;
  const n = _surveyCharAskCount[key] || 0;
  if (n >= 3) return; // 每天最多 3 条
  // 低概率触发（约 8%），且仅当角色开启主动发消息时
  if (Math.random() > 0.08) return;
  await charAskPlayer(c);
}

/* ============================================================
   超频功能（20260929ao 全量落地）
   细则见《超频.docx》《超频逻辑解释2.docx》
   核心闭环：
   - 第三天首次进访客聊天 → 故障动画 + Warning + 维度裂隙 → 掉落首个礼物（星辰项链）
   - 解锁后 +号菜单出现「超频」；初始只有「礼物」列表，绝对没有「惊喜」
   - 惊喜列表要等「访客第一次给玩家发惊喜」才解锁
   - 礼物有礼物柜（记录+寄语），惊喜完全不做记录
   ============================================================ */

/* 预设礼物（12 个，第一个星辰项链为固定初次礼物） */
const OVERCLOCK_GIFTS = [
  { id: 'necklace', name: '星辰水晶项链', desc: '它带着这世间一切最美好的祝福，跨越维度，来到你身边。', price: 1001, emoji: '💎', img: 'img/gifts/necklace.jpg' },
  { id: 'nebula', name: '瓶中星云', desc: '瓶中封存着一小片璀璨的星云。在黑夜中静静散发着微光，能驱散所有的不安与恐惧，让人在星空的陪伴下安然入睡。', price: 188, emoji: '🌌', img: 'img/gifts/nebula.jpg' },
  { id: 'anchor', name: '跨越维度的锚点（碎星怀表）', desc: '表盘上刻着相遇的坐标。无论迷失在哪个时空，只要打开表盖，指针就会拨开迷雾，指向对方所在的方向。', price: 233, emoji: '⌚', img: 'img/gifts/anchor.jpg' },
  { id: 'hourglass', name: '月光沙漏', desc: '沙漏里流淌着静谧的月光。翻转沙漏，流逝的时间会短暂停滞，将此刻的美好与温暖永远留存。', price: 166, emoji: '⏳', img: 'img/gifts/hourglass.jpg' },
  { id: 'bracelet', name: '引力星轨手链', desc: '两颗粒子在宇宙中缠绕共振。戴上它，能精准感知到对方心跳的频率，让跨越时空的情绪同频共鸣。', price: 199, emoji: '📿', img: 'img/gifts/bracelet.jpg' },
  { id: 'dreamcatcher', name: '捕梦网（星尘款）', desc: '用细碎星尘编织的守护网。挂在床头，它能过滤掉所有的噩梦与烦恼，只留下一夜香甜的安眠。', price: 99, emoji: '🕸️', img: 'img/gifts/dreamcatcher.jpg' },
  { id: 'rose', name: '永恒态的蔷薇（水晶标本）', desc: '来自第四维度之上的物品，将绽放的蔷薇封存在水晶中，同时承载着过去、现在与未来。它永不枯萎，双方的信念永不褪色。', price: 131, emoji: '🌹', img: 'img/gifts/rose.jpg' },
  { id: 'pillow', name: '暖光抱枕（拟态云朵）', desc: '云朵内部装满了温暖的阳光。将脸埋进去，能瞬间驱散积攒的疲惫，感受到被柔和包裹的安心。', price: 66, emoji: '☁️', img: 'img/gifts/pillow.jpg' },
  { id: 'redline', name: '命运的红线（纳米丝线）', desc: '一条肉眼看不见的丝线，系在双方的小指上。当信号不好时，向对方发送这份礼物，信号便会稳定许多。', price: 88, emoji: '🧵', img: 'img/gifts/redline.jpg' },
  { id: 'gramophone', name: '白噪音留声机（记忆水晶）', desc: '水晶里存储了山川河流，月亮星辰的声音。按下开关，瞬间抚平所有焦躁，伴你入梦。', price: 288, emoji: '📻', img: 'img/gifts/gramophone.jpg' },
  { id: 'potion', name: '情绪安抚药剂（无副作用）', desc: '由异世界草药熬制的奇妙药剂。喝下它，所有的委屈、焦虑与负面情绪都会被瞬间平复，内心重新归于宁静。', price: 52, emoji: '🧪', img: 'img/gifts/potion.jpg' },
  { id: 'projector', name: '梦境投影仪', desc: '一台可以投射未来的机器。按下按钮，墙壁上就会浮现出某条时间线上，你们一起生活的温馨画面，给予人不断前行的勇气。', price: 350, emoji: '🎞️', img: 'img/gifts/projector.jpg' },
];

/* 预设惊喜（友情版 / 爱人版，格式：Ta（…），决定跨越维度，（…），大字！） */
const OVERCLOCK_SURPRISES = {
  friend: [
    { act: '好奇你最近在忙什么，又不想显得太八卦', move: '蹲在你屏幕角落偷偷看你', big: '暗中观察！' },
    { act: '路过你的世界，想留个脚印又怕打扰你', move: '轻轻踩过你的聊天框，留下一阵风', big: '悄悄来过！' },
    { act: '觉得你最近可能有点累，又不知道怎么开口安慰', move: '张开手臂撞进你的消息里', big: '抱抱！' },
    { act: '想和你贴贴，但嘴硬说只是顺手', move: '用脑袋蹭了蹭你的通知栏', big: '蹭蹭！' },
    { act: '觉得你可爱但绝不承认，只好用玩笑掩饰', move: '隔空啵一口你的屏幕，纯友谊那种', big: '亲亲！' },
    { act: '想你又不好意思直说，只好假装系统故障', move: '把想念塞进一条乱码消息', big: '想你！' },
    { act: '觉得你太久没理Ta，有点小委屈', move: '跨过维度朝你挥挥手', big: '理我！' },
  ],
  lover: [
    { act: '觉得你太久没理Ta，委屈得快把维度墙抠穿了', move: '穿过所有消息，直直扑到你眼前', big: '理我！' },
    { act: '觉得你好看，又怕自己看多了眩晕', move: '躲在屏幕后面，偷偷看你一整天', big: '暗中观察！' },
    { act: '想你又怕打扰你，只好先悄悄靠近', move: '在你的聊天框边留下一个吻和一阵心跳', big: '悄悄来过！' },
    { act: '非常想要安慰你', move: '张开双臂，把距离抱碎', big: '抱抱！' },
    { act: '想黏着你又怕你嫌烦，于是想着先试探一下', move: '蹭蹭你的颈窝和通知栏', big: '蹭蹭！' },
    { act: '觉得你可爱到犯规，又不想只在梦里碰你', move: '穿过信号和星光，亲在你屏幕上', big: '亲亲！' },
    { act: '想你想得不好意思打扰，只好让系统替Ta报警', move: '把「想你」写成红色故障，砸进你眼里', big: '想你！' },
  ],
};

/* 超频相关 kv 读取辅助 */
async function _ocGet(key, fallback) { return await getSetting('oc_' + key, fallback); }
async function _ocSet(key, val) { await setSetting('oc_' + key, val); }

/* 超频是否已解锁（第三天触发首次动画后） */
async function isOverclockUnlocked() {
  _ocUnlockedCache = !!(await _ocGet('unlocked', false));
  return _ocUnlockedCache;
}
/* 惊喜是否已解锁（访客第一次给玩家发惊喜后） */
async function isSurpriseUnlocked() {
  return await _ocGet('surpriseUnlocked', false);
}
/* 首次动画是否已完成（避免重复触发） */
async function isOverclockSeen() {
  return await _ocGet('seen', false);
}

/* 记录玩家首次使用日期（用于「第三天」判定）。首次启动即写入 */
async function _ocRecordFirstUse() {
  const first = await _ocGet('firstUse', null);
  if (!first) await _ocSet('firstUse', todayKey());
  return first || todayKey();
}

/* 聊天天数（20260929aq）：与个人主页「聊天天数」统计完全同源——
   取所有消息中最早一条到今天的天数，认识当天算第 1 天；聊天天数到 3 触发超频 */
async function _ocChatDays() {
  const msgs = await idbGetAll('messages');
  let earliest = Infinity;
  for (const m of msgs) {
    const t = m.time || 0;
    if (t && t < earliest) earliest = t;
  }
  if (earliest === Infinity) return 1;
  return Math.max(1, Math.floor((startOfToday() - startOfDay(new Date(earliest))) / 86400000) + 1);
}

/* 角色惊喜版本（friend/lover，默认爱人版；可在角色主页设置） */
async function _ocCharSurpriseMode(charId) {
  const map = await _ocGet('charSurpriseMode', {});
  return map[charId] || 'lover';
}

/* 取玩家自定义礼物 */
async function _ocCustomGifts() { return await _ocGet('customGifts', []); }
/* 取玩家自定义惊喜 */
async function _ocCustomSurprises() { return await _ocGet('customSurprises', []); }

/* 角色每月金钱增加（本地计算，不频繁刷新 UI；在超频解锁后由主动消息节奏顺带触发） */
async function _ocMonthlyAllowance() {
  const now = new Date();
  const monthKey = now.getFullYear() + '-' + (now.getMonth() + 1);
  const last = await _ocGet('lastAllowanceMonth', '');
  if (last === monthKey) return;
  await _ocSet('lastAllowanceMonth', monthKey);
  for (const c of characters) {
    const add = randInt(500, 5000); // 每月随机增加 500~5000
    c.wallet = (c.wallet ?? 100000) + add;
    await saveChar(c);
  }
}

/* 生成寄语：字卡模式抽字卡 / AI 模式由 AI 生成（仅寄语这一处区分，其余不区分） */
async function _ocGenerateNote(c) {
  const cardFallback = () => {
    const r = drawReply(cards, getCharBanWords(c), c.relation || null, c.bannedGroups || []);
    if (r) return r;
    const pool = (cards.customReplies || []).concat((cards.customReplyGroups || []).flatMap(g => g.items || []));
    return pool.length ? drawFrom(pool) : '跨越维度，把这份心意送到你身边。';
  };
  if (await isAIMode()) {
    // AI 模式：由 AI 生成一句送礼物时的寄语，失败回退字卡
    const note = await aiSoftReply(c,
      '你刚刚给玩家送了一份礼物，请以角色的身份、口吻写一句送礼物时的「寄语」（1~2 句，温暖自然，20~40 字），不要跳出角色，不要提"礼物""寄语"等字眼，只输出这句话本身。',
      cardFallback);
    return note;
  }
  return cardFallback();
}

/* ============================================================
   首次故障动画 + 维度裂隙 + 掉落星辰项链
   ============================================================ */
let _ocIntroRunning = false;
async function maybeTriggerOverclockIntro(force = false) {
  if (!force) {
    if (_ocIntroRunning) return;
    if (await isOverclockSeen()) return;          // 已看过，一次性
    const days = await _ocChatDays();
    if (days < 3) return;                          // 聊天天数到 3 才触发（个人主页统计同源，20260929aq）
  }
  _ocIntroRunning = true;
  await _ocSet('seen', true);
  await _ocSet('unlocked', true);

  // 动画性能降级：低端机 或 跳过动画开关 → 直接弹简短提示
  const skip = chatSettings.skipOverclockAnim || isLowEndDevice();
  if (skip) {
    _ocIntroRunning = false;
    await _ocGrantInitialGift();
    await buildPlusPanel();
    showConfirm('系统好像发生了一点异变，聊天页面的加号菜单里多了一个「超频」功能，去看看吧。', () => {});
    return;
  }

  // 全屏故障动画层
  _ocShowGlitch(() => {
    // 故障结束 → 弹窗说明（20260929bc：故障风非圆角）
    openModal(`
      <div style="text-align:center;padding:8px 4px;">
        <div class="glitch-title" style="font-size:13px;margin-bottom:12px;">⚠ SYSTEM ERROR</div>
        <div class="glitch-body" style="font-size:15px;font-weight:600;line-height:1.6;">Ops！系统好像发生了一些异常，前方出现了一个维度裂隙，请问你要前往查看吗？</div>
        <button class="btn primary block" id="oc-go" style="margin-top:18px;">前往查看</button>
      </div>`, { glitch: true });
    $('#oc-go').onclick = () => {
      closeModal();
      _ocShowRift(async () => {
        // 20260929aw：裂隙已在 _ocShowRift 裂过一次——后续礼物改为「跳出」动画
        // （noCrack 复用全开裂口，不再重复撕裂隙），不再使用吸入式掉落
        const rec = await _ocGrantInitialGift();
        const gc0 = { giftId: rec.giftId, giftName: rec.giftName, giftDesc: rec.giftDesc, giftImg: rec.giftImg, note: rec.note };
        // 20260929bb：跳出落地后同一个盒子直接形变为开箱盒（警告首次动画与日常礼物同款连续体验）
        const handle0 = await _ocShowGiftBurst('gift', { noCrack: true, keepAlive: true, gc: gc0 });
        // 20260929ax：礼盒跳出后接完整「打开礼物」流程——紫盒+打开礼物按钮→开箱动画→星际详情，
        // 详情关闭后再弹「聊天页面好像发生了什么变化」（watcher 兼容 ✕ 与遮罩点击两种关闭方式）
        await _ocPlayOpenGiftAnim(gc0, handle0);
        await buildPlusPanel();
        _ocShowGiftModal(gc0, { head: '维度另一端送来的礼物', foot: '星辰项链 · 所有访客共有' });
        let checks = 0;
        const iv = setInterval(() => {
          checks++;
          const mask = $('#modal-mask');
          if (!mask || !mask.classList.contains('show') || checks > 300) {
            clearInterval(iv);
            openModal(`
              <div style="text-align:center;padding:8px 4px;">
                <div class="glitch-title" style="font-size:13px;margin-bottom:12px;">⚠ SIGNAL DETECTED</div>
                <div class="glitch-body" style="font-size:15px;font-weight:600;line-height:1.6;">聊天页面好像发生了什么变化</div>
                <button class="btn primary block" id="oc-ack" style="margin-top:18px;">去看看</button>
              </div>`, { glitch: true });
            $('#oc-ack').onclick = () => { closeModal(); _ocIntroRunning = false; };
          }
        }, 350);
      });
    };
  });
}

/* 首次固定礼物：星辰项链，系统强制赠予，不扣任何一方钱，出现在所有访客礼物柜 */
async function _ocGrantInitialGift() {
  const g = OVERCLOCK_GIFTS[0];
  const pronoun = characters.length >= 2 ? '我们' : '我';
  const note = `${pronoun}打开了这道微小的维度裂隙，这是${pronoun}送你的礼物，我想这样我们能靠的再近一点儿。`;
  const rec = {
    id: uid('gift'), charId: 'all', giftId: g.id, giftName: g.name, giftDesc: g.desc,
    giftImg: g.img || '', note, noteFrom: 'all', receivedAt: Date.now(), isInitial: true,
  };
  await idbPut('gifts', rec);
  return rec;
}

/* 警报音（20260929ap）：AudioContext 零依赖合成，双音交替 ×4；自动播放被拦时静默跳过 */
function _ocPlayAlarm() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    const t0 = ctx.currentTime + 0.02;
    const freqs = [988, 740, 988, 740, 988, 740];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = f;
      const s = t0 + i * 0.17;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.10, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.15);
      o.connect(g); g.connect(ctx.destination);
      o.start(s); o.stop(s + 0.17);
    });
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1800);
  } catch (e) {}
}

/* 惊喜红字震动音效（20260929bc）：低频震动感 + 短促上行警示音，配合大字 shake 动画 */
function _ocPlaySurpriseBuzz() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    const t0 = ctx.currentTime + 0.02;
    // 低频轰鸣（震动感）
    const bass = ctx.createOscillator(), bg = ctx.createGain();
    bass.type = 'sawtooth'; bass.frequency.setValueAtTime(62, t0);
    bass.frequency.exponentialRampToValueAtTime(40, t0 + 0.5);
    bg.gain.setValueAtTime(0.0001, t0);
    bg.gain.exponentialRampToValueAtTime(0.16, t0 + 0.04);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    bass.connect(bg); bg.connect(ctx.destination);
    bass.start(t0); bass.stop(t0 + 0.6);
    // 短促上行警示（三次）
    [660, 880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = f;
      const s = t0 + 0.06 + i * 0.09;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.08, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
      o.connect(g); g.connect(ctx.destination);
      o.start(s); o.stop(s + 0.09);
    });
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 900);
  } catch (e) {}
}
function _ocVortexSvg(size, dense) {
  const n = dense ? 26 : 16;
  const cx = size / 2;
  let orbits = '';
  for (let i = 0; i < n; i++) {
    const rx = size * (0.16 + 0.34 * (i / n) + Math.random() * 0.05);
    const ry = rx * (0.28 + Math.random() * 0.42);
    const rot = Math.round(Math.random() * 180);
    const op = (0.22 + Math.random() * 0.5).toFixed(2);
    const dash = Math.random() < 0.35 ? ` stroke-dasharray="${(2 + Math.random() * 5).toFixed(1)} ${(3 + Math.random() * 6).toFixed(1)}"` : '';
    orbits += `<ellipse cx="${cx}" cy="${cx}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${rot} ${cx} ${cx})" fill="none" stroke="rgba(255,255,255,${op})" stroke-width="${(0.7 + Math.random() * 1.4).toFixed(1)}"${dash}/>`;
  }
  let stars = '';
  for (let i = 0; i < (dense ? 46 : 26); i++) {
    const a = Math.random() * Math.PI * 2;
    const r = size * (0.1 + Math.random() * 0.42);
    const x = (cx + Math.cos(a) * r).toFixed(1), y = (cx + Math.sin(a) * r * 0.72).toFixed(1);
    stars += `<circle class="oc-vx-star" cx="${x}" cy="${y}" r="${(0.6 + Math.random() * 1.5).toFixed(1)}" fill="#fff" style="animation-delay:${(Math.random() * 2).toFixed(2)}s"/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" style="width:min(88vmin,${dense ? 560 : 420}px);height:auto;overflow:visible;">
    <defs>
      <radialGradient id="ocvx-g" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.95)"/>
        <stop offset="28%" stop-color="rgba(196,168,255,0.55)"/>
        <stop offset="100%" stop-color="rgba(124,92,224,0)"/>
      </radialGradient>
    </defs>
    <circle cx="${cx}" cy="${cx}" r="${size * 0.34}" fill="url(#ocvx-g)" class="oc-vx-glow"/>
    <g class="oc-vx-spin" style="animation-duration:${dense ? 26 : 34}s">${orbits}</g>
    <g class="oc-vx-spin-rev" style="animation-duration:${dense ? 40 : 52}s">${stars}</g>
    <circle cx="${cx}" cy="${cx}" r="${(size * 0.016).toFixed(1)}" fill="#ffffff" class="oc-vx-core"/>
  </svg>`;
}

/* 故障动画层（20260929ap 重做）：满屏乱码矩阵 + RGB 撕裂 + 扫描线 + 屏幕震动 + 红色 Warning + 警报音 */
function _ocShowGlitch(done) {
  let layer = document.createElement('div');
  layer.id = 'oc-glitch';
  layer.innerHTML = `
    <div class="oc-glitch-bg"></div>
    <div class="oc-glitch-code"></div>
    <div class="oc-glitch-code oc-glitch-code2"></div>
    <div class="oc-scanline"></div>
    <div class="oc-warning"><div class="oc-warn-tri">⚠</div><div class="oc-warn-txt">WARNING</div><div class="oc-warn-sub">SYSTEM ERROR · DIMENSION BREACH</div></div>`;
  document.body.appendChild(layer);
  // 满屏乱码（双层交替 + 随机刷新，双色错位营造 RGB 撕裂）
  const codeEl = layer.querySelector('.oc-glitch-code');
  const codeEl2 = layer.querySelector('.oc-glitch-code2');
  const glyphs = 'アイウエオカキクケコサシスセソ!@#$%^&*()_+-=[]{}|;:,.<>?/~ABCDEF0123456789ｦｧｨｩｪｫﾊﾋﾌﾍﾎ';
  const randStr = n => { let s = ''; for (let i = 0; i < n; i++) s += glyphs[Math.floor(Math.random() * glyphs.length)]; return s; };
  let flip = false;
  const iv = setInterval(() => {
    flip = !flip;
    const s = randStr(460);
    if (flip) { codeEl.textContent = s; codeEl.style.opacity = '0.9'; codeEl2.style.opacity = '0.3'; }
    else { codeEl2.textContent = s; codeEl.style.opacity = '0.3'; codeEl2.style.opacity = '0.9'; }
  }, 70);
  _ocPlayAlarm();
  // 约 2.6 秒后结束（比旧版多 0.8s，保证满屏乱码读得完一次警报）
  setTimeout(() => {
    clearInterval(iv);
    layer.remove();
    done();
  }, 2600);
}

/* 斜切刀光路径（20260929as 公共）：从右上斜插到左下的主刃 + 碎玻璃飞溅，
   _ocShowRift（独立裂隙动画）与 _ocShowGiftDrop（礼物投送背景裂隙）共用，保证视觉一致 */
function _ocRiftBladePaths() {
  const jag = (pts, jx, jy) => {
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = pts[i];
      const last = i === pts.length - 1;
      d += ` L ${(last ? x : x + (Math.random() - .5) * jx).toFixed(1)} ${(last ? y : y + (Math.random() - .5) * jy).toFixed(1)}`;
    }
    return d;
  };
  // 斜切主刃：从右上 (W-40, 0) 一路斜插到左下 (40, H)，中段锯齿
  const bladeTop = [[646, 8],[560, 120],[486, 240],[402, 362],[330, 486],[252, 606],[176, 726],[96, 848],[28, 896]];
  const bladeBot = [[666, 22],[590, 150],[512, 268],[430, 392],[356, 512],[276, 632],[198, 750],[118, 864],[48, 900]];
  const top = jag(bladeTop, 22, 30);
  const bot = jag(bladeBot, 20, 26);
  // 斜向裂口：上刃沿正方向、下刃沿反方向收口成一条斜缝
  const mouth = `${top} L ${bladeBot[bladeBot.length-1][0]} ${bladeBot[bladeBot.length-1][1]} ` +
    bladeBot.slice(0, -1).reverse().map(p => `L ${p[0]} ${p[1]}`).join(' ') + ` Z`;
  // 碎玻璃：围绕刃身两侧飞溅的短斜线（从刃线向外发散）
  const splints = [];
  const seed = [
    [[590, 90],[540, 52],[492, 30]], [[500, 210],[446, 176],[396, 150]],
    [[420, 330],[368, 300],[320, 280]], [[340, 450],[292, 426],[246, 410]],
    [[262, 568],[216, 550],[172, 540]], [[184, 686],[142, 676],[102, 670]],
    [[596, 150],[636, 120],[662, 96]], [[516, 270],[550, 242],[576, 218]],
    [[436, 392],[468, 366],[492, 342]], [[358, 512],[388, 488],[410, 466]],
    [[278, 632],[306, 610],[326, 590]], [[200, 750],[226, 730],[244, 714]],
  ];
  for (const seg of seed) splints.push(jag(seg, 14, 16));
  return { top, bot, mouth, splints };
}

/* 维度裂隙动画层（20260929ap 重做）：锯齿裂纹从中心生长绽开 + 分叉 + 光透出 + 强光爆闪 */
function _ocShowRift(done) {
  const layer = document.createElement('div');
  layer.id = 'oc-rift';
  const W = 680, H = 900;
  /* 刀光从右侧斜切划过屏幕：主刃沿「右上→左下」对角线，带锯齿抖动；
     上下两条边构成一道斜向裂口（mouth），刃身两侧各叠 glow/mid/core 三层光边，
     再撒一圈碎玻璃（splinter）向裂口两侧飞溅。 */
  const { top, bot, mouth, splints } = _ocRiftBladePaths();
  layer.innerHTML = `
    <div class="oc-void-flash"></div>
    <svg class="oc-void-rift-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path class="oc-void-mouth" d="${mouth}"/>
      <path class="oc-void-edge oc-void-edge-glow" pathLength="1" d="${top}"/>
      <path class="oc-void-edge oc-void-edge-glow" pathLength="1" d="${bot}"/>
      <path class="oc-void-edge oc-void-edge-mid" pathLength="1" d="${top}"/>
      <path class="oc-void-edge oc-void-edge-mid" pathLength="1" d="${bot}"/>
      <path class="oc-void-edge oc-void-edge-core" pathLength="1" d="${top}"/>
      <path class="oc-void-edge oc-void-edge-core" pathLength="1" d="${bot}"/>
      ${splints.map(d => `<path class="oc-void-splinter" pathLength="1" d="${d}"/>`).join('')}
    </svg>`;
  document.body.appendChild(layer);
  setTimeout(() => { layer.remove(); done(); }, 1450);
}

/* 礼物投送过场（20260929ar）：撕开虚空 → 星系漩涡展开 → 礼物图自上方落入礼盒 → 礼盒被裂隙吸入
   20260929au：kind='surprise' 时不用礼盒，改成「三个红色像素问号」从裂隙里掉出/被吸入 */
function _ocShowGiftDrop(kind, imgUrl) {
  return new Promise(resolve => {
    const layer = document.createElement('div');
    layer.id = 'oc-drop';
    const W = 680, H = 900;
    const { top, bot, mouth, splints } = _ocRiftBladePaths();
    const isSurprise = kind === 'surprise';
    // 主体：惊喜=三个红色像素问号；礼物=落盒
    const mainHtml = isSurprise
      ? `<div class="oc-drop-qqq"><span>?</span><span>?</span><span>?</span></div>`
      : (() => {
          const giftSrc = imgUrl || '';
          const giftHtml = giftSrc
            ? `<img class="oc-drop-gift" src="${giftSrc}" alt="礼物">`
            : `<div class="oc-drop-gift oc-drop-gift-fallback">✦</div>`;
          return `<div class="oc-drop-box">
            <div class="oc-drop-box-shadow"></div>
            <div class="oc-drop-giftclip">${giftHtml}</div>
            <div class="oc-drop-box-base"></div>
            <div class="oc-drop-box-lid"></div>
          </div>`;
        })();
    layer.innerHTML = `
      <div class="oc-void-flash"></div>
      <svg class="oc-void-rift-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <path class="oc-void-mouth" d="${mouth}"/>
        <path class="oc-void-edge oc-void-edge-glow" pathLength="1" d="${top}"/>
        <path class="oc-void-edge oc-void-edge-glow" pathLength="1" d="${bot}"/>
        <path class="oc-void-edge oc-void-edge-mid" pathLength="1" d="${top}"/>
        <path class="oc-void-edge oc-void-edge-mid" pathLength="1" d="${bot}"/>
        <path class="oc-void-edge oc-void-edge-core" pathLength="1" d="${top}"/>
        <path class="oc-void-edge oc-void-edge-core" pathLength="1" d="${bot}"/>
        ${splints.map(d => `<path class="oc-void-splinter" pathLength="1" d="${d}"/>`).join('')}
      </svg>
      <div class="oc-vx-wrap">${_ocVortexSvg(680, true)}</div>
      ${mainHtml}
      <button class="oc-skip-btn" type="button">跳过动画 ›</button>`;
    document.body.appendChild(layer);
    // 20260930ca：动画下方「跳过动画」按钮——点击立即结束本段动画（remove+resolve），
    // 后续礼物卡片/惊喜弹窗照常弹出，不受影响
    let dropDone = false;
    const finishDrop = () => { if (dropDone) return; dropDone = true; layer.remove(); resolve(); };
    const dropTimer = setTimeout(finishDrop, 3450);
    const skipDrop = layer.querySelector('.oc-skip-btn');
    if (skipDrop) skipDrop.onclick = (e) => { e.stopPropagation(); clearTimeout(dropTimer); finishDrop(); };
  });
}

/* ============================================================
   收到方向动画（20260929av）：角色→玩家
   gift=礼盒从裂隙中央「跳出」→ 页面中间弹窗（内下方「打开礼物」按钮）；
   surprise=三个红色像素问号从裂隙中央「跳出」→ 无背景大字弹窗。
   玩家→角色（送出）仍走 _ocShowGiftDrop（礼物落盒吸入 / 问号塞入裂隙）。
   ============================================================ */

/* 裂隙跳出动画：裂口绽开后主体从裂口中心弹出（弹性回跳），无漩涡
   20260929aw：opts.noCrack=true 时不重播裂口生长（用于 warning 首次动画——
   前面 _ocShowRift 已经裂过一次，后续不能再裂一次），裂口直接以全开状态呈现
   20260929bb：礼物改用「开箱盒」结构构建（oc-unbox-* 子元素）——
   opts.keepAlive=true 时跳出落地后不关层不淡出，裂口淡出、盒子原位悬停，
   resolve({layer,box}) 把同一个盒子交给开箱流程继续形变（消除两段弹出之间的卡顿）；
   opts.withVortex=true 保留背景白色漩涡滚动（惊喜初次触发全程漩涡）；
   opts.gc 传入礼物内容，礼物图在跳出阶段就预置进盒口裁剪容器 */
function _ocShowGiftBurst(kind, opts = {}) {
  return new Promise(resolve => {
    const layer = document.createElement('div');
    layer.id = 'oc-drop';
    layer.classList.add('oc-burst');
    if (opts.noCrack) layer.classList.add('oc-nocrack');
    if (opts.withVortex) layer.classList.add('oc-burst-vortex');
    const W = 680, H = 900;
    const { top, bot, mouth, splints } = _ocRiftBladePaths();
    const isSurprise = kind === 'surprise';
    const giftImg = (!isSurprise && opts.gc) ? _ocGiftImgOf(opts.gc) : '';
    const mainHtml = isSurprise
      ? `<div class="oc-burst-subject"><div class="oc-burst-qqq"><span>?</span><span>?</span><span>?</span></div></div>`
      : `<div class="oc-burst-subject"><div class="oc-burst-box oc-unbox-host">
          <div class="oc-unbox-glow"></div>
          <div class="oc-burst-shadow"></div>
          <div class="oc-unbox-giftclip">${giftImg ? `<img class="oc-unbox-gift" src="${imgSrc(giftImg)}" alt="">` : ''}</div>
          <div class="oc-unbox-base"></div>
          <div class="oc-unbox-lid"></div>
        </div></div>`;
    layer.innerHTML = `
      <div class="oc-void-flash"></div>
      <svg class="oc-void-rift-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <path class="oc-void-mouth" d="${mouth}"/>
        <path class="oc-void-edge oc-void-edge-glow" pathLength="1" d="${top}"/>
        <path class="oc-void-edge oc-void-edge-glow" pathLength="1" d="${bot}"/>
        <path class="oc-void-edge oc-void-edge-mid" pathLength="1" d="${top}"/>
        <path class="oc-void-edge oc-void-edge-mid" pathLength="1" d="${bot}"/>
        <path class="oc-void-edge oc-void-edge-core" pathLength="1" d="${top}"/>
        <path class="oc-void-edge oc-void-edge-core" pathLength="1" d="${bot}"/>
        ${splints.map(d => `<path class="oc-void-splinter" pathLength="1" d="${d}"/>`).join('')}
      </svg>
      <div class="oc-vx-wrap">${_ocVortexSvg(680, true)}</div>
      ${mainHtml}
      <button class="oc-skip-btn" type="button">跳过动画 ›</button>`;
    document.body.appendChild(layer);
    const subject = layer.querySelector('.oc-burst-subject');
    const box = layer.querySelector('.oc-burst-box');
    // 20260930ca：动画下方「跳过动画」按钮——点击=快速完成本段动画（与自然结束同路径 resolve）：
    // keepAlive 段直接进 settle 悬停并交出 {layer,box,subject}（开箱场景照常接管）；
    // 非 keepAlive 段立即移层并 resolve（惊喜大字/后续弹窗照常弹出）
    let burstDone = false;
    const burstTimers = [];
    const burstLater = (fn, ms) => { const t = setTimeout(fn, ms); burstTimers.push(t); };
    const burstClear = () => { burstTimers.forEach(t => clearTimeout(t)); };
    const skipBurst = layer.querySelector('.oc-skip-btn');
    if (skipBurst) skipBurst.onclick = (e) => {
      e.stopPropagation();
      if (burstDone) return;
      burstDone = true;
      burstClear();
      if (opts.keepAlive) { layer.classList.add('oc-burst-settle'); resolve({ layer, box, subject }); }
      else { layer.remove(); resolve(isSurprise ? { layer, subject } : null); }
    };
    if (opts.keepAlive) {
      // bb：跳出落地（0.5s 延迟 + 1.2s 跳出）后裂口/阴影淡出，主体留在原地 → 交给后续流程（同一 DOM）
      // gift=盒子交给开箱流程形变；surprise=问号交给初次触发流程悬停（box 为 null）
      burstLater(() => layer.classList.add('oc-burst-settle'), 1950);
      burstLater(() => { if (!burstDone) { burstDone = true; resolve({ layer, box, subject }); } }, 2350);
      return;
    }
    // 主体跳出并停驻后整层淡出，再交由调用方弹窗/大字
    burstLater(() => layer.classList.add('oc-burst-fade'), 2000);
    burstLater(() => { layer.remove(); if (!burstDone) { burstDone = true; resolve(isSurprise ? { layer, subject } : null); } }, 2480);
  });
}

/* 打开礼物完整流程：开箱场景（紫盒 +「打开礼物」按钮）→ opened 双写（消息+礼物柜）→ 星际详情弹窗
   20260929av：从 _ocHandleGiftCardClick 抽出；20260929aw：成为收到礼物的唯一弹窗路径
   （原「礼物预览中间弹窗」已删——收到 = 跳出动画直接接开箱场景，只保留这一个开箱弹窗） */
async function _ocOpenGiftFlow(m, gc, reuse) {
  await _ocPlayOpenGiftAnim(gc, reuse);
  gc.opened = true;
  await idbPut('messages', m);
  if (gc.giftRecId) {
    try {
      const rec = await idbGet('gifts', gc.giftRecId);
      if (rec) { rec.opened = true; await idbPut('gifts', rec); }
    } catch (e) {}
  }
  if (currentCharId === m.charId && document.body.dataset.view === 'chat') renderMessages(m.charId);
  const c = characters.find(x => x.id === m.charId);
  _ocShowGiftModal(gc, { head: `${c ? c.name : 'TA'} 送来的礼物`, foot: `跨越维度送达 · ${timeAgoStr(m.time)}` });
}

/* 收到方向统一入口（20260929aw）：跳出动画 → 礼物直接进开箱场景（紫盒+「打开礼物」按钮
   → 开箱 → 星际详情）；惊喜接打字机大字卡片。走全局动画互斥队列；
   「跳过超频动画」开启时礼物直接进开箱场景、惊喜直接弹大字；已开过的旧礼物直接看详情 */
async function _ocPlayIncoming(c, m, imgUrl) {
  const isSurprise = m.type === 'surprise';
  const gc = m.content || {};
  if (isSurprise) {
    if (_ocSkipAnim(c)) { _ocShowSurpriseBigText(gc); return; }
    // 20260929bc：收到方向也保留白色漩涡（与送出方向一致）
    await _ocAnimQueue(() => _ocShowGiftBurst('surprise', { withVortex: true }));
    _ocShowSurpriseBigText(gc);
    return;
  }
  if (gc.opened !== false) {
    // 已开过的旧礼物：不播跳出/开箱，直接看详情
    _ocShowGiftModal(gc, { head: `${c ? c.name : 'TA'} 送来的礼物`, foot: `跨越维度送达 · ${timeAgoStr(m.time)}` });
    return;
  }
  if (_ocSkipAnim(c)) { await _ocOpenGiftFlow(m, gc); return; }
  // 20260929bb：跳出落地后保留同一个盒子交给开箱流程（连续形变，不再两段弹出）
  // 20260929bc：收到方向也保留白色漩涡（withVortex）
  const handle = await _ocAnimQueue(() => _ocShowGiftBurst('gift', { keepAlive: true, gc, withVortex: true }));
  await _ocOpenGiftFlow(m, gc, handle);
}

/* ============================================================
   超频入口（+号菜单里的「超频」）
   ============================================================ */
async function showOverclockHub(preferTab) { // 20260929bm：preferTab 可指定落点（'gift'/'surprise'）
  const unlocked = await isOverclockUnlocked();
  if (!unlocked) { miniToast('超频功能尚未开启'); return; }
  const surpriseUnlocked = await isSurpriseUnlocked();
  _ocHubBack = () => {
    // 入口来源 = 聊天 +号菜单，关闭即回聊天页（已在聊天页，直接关弹窗）
    closeModal();
  };
  const inlineStyles = `
    .modal-oc-hub { max-width:390px; width:calc(100% - 32px); padding:20px 18px; }
    .modal-oc-hub .oc-panel-scroll { max-height:58vh; overflow:auto; }
  `;
  openModal(`
    <style>${inlineStyles}</style>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;display:flex;align-items:center;gap:8px;">${icon('overclock',22)} 超频</div>
      <button class="icon-btn" id="oc-close">✕</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <button class="btn oc-tab" data-oc-tab="gift" style="flex:1;${true ? 'background:var(--purple);color:#141019;' : ''}">${icon('gift',16)} 礼物</button>
      ${surpriseUnlocked ? `<button class="btn oc-tab" data-oc-tab="surprise" style="flex:1;">${icon('sparkle',16)} 惊喜</button>` : ''}
    </div>
    <div id="oc-panel" class="oc-panel-scroll"></div>
  `);
  $('#modal-content').classList.add('modal-oc-hub');
  $('#oc-close').onclick = () => { const b = _ocHubBack; _ocHubBack = null; b(); };
  // tab 切换
  $$('[data-oc-tab]').forEach(t => {
    t.onclick = () => {
      $$('[data-oc-tab]').forEach(x => x.style.cssText = 'flex:1;');
      t.style.cssText = 'flex:1;background:var(--purple);color:#141019;';
      renderOcPanel(t.dataset.ocTab);
    };
  });
  const startTab = preferTab === 'surprise' && surpriseUnlocked ? 'surprise' : 'gift'; // 20260929bm
  $$('[data-oc-tab]').forEach(t => {
    if (t.dataset.ocTab === startTab) t.style.cssText = 'flex:1;background:var(--purple);color:#141019;';
    else t.style.cssText = 'flex:1;';
  });
  renderOcPanel(startTab);
}
let _ocHubBack = null;

/* 渲染超频面板内容（20260930cd：重渲染保滚动位——滚动到哪选完/返回后还在哪，不跳顶） */
async function renderOcPanel(tab) {
  const el = $('#oc-panel');
  if (!el) return;
  const st = el.scrollTop;                 // 离开前记录
  if (tab === 'gift') {
    el.innerHTML = await _ocGiftPanelHtml();
    _ocBindGiftPanel();
  } else {
    el.innerHTML = await _ocSurprisePanelHtml();
    _ocBindSurpriseTabs();
    _ocBindSurprisePanel();
  }
  el.scrollTop = st;                       // 渲染完恢复
}

/* 礼物面板：预设礼物 + 自定义礼物 + 礼物柜 */
async function _ocGiftPanelHtml() {
  const customs = await _ocCustomGifts();
  const allGifts = OVERCLOCK_GIFTS.map(g => ({ ...g, custom: false }))
    .concat(customs.map(g => ({ ...g, custom: true })));
  return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:13px;font-weight:600;">🎁 礼物库（点礼物查看说明）</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="oc-side-action" id="oc-gift-batch" title="批量管理">${icon('trash',19)}</button>
          <button class="oc-side-action" id="oc-gift-cabinet" title="礼物柜">${icon('archive',19)}</button>
          <button class="oc-side-action" id="oc-add-menu" title="添加">${icon('plus',19)}</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px;">
      ${allGifts.map(g => `
        <div class="oc-gift-card" data-gift-id="${g.id}" data-gift-price="${g.price}" style="background:var(--bg-elevated-2);border-radius:12px;padding:10px;cursor:pointer;">
          <div style="width:100%;aspect-ratio:1/1;border-radius:9px;overflow:hidden;background:var(--bg);">${g.img ? `<img src="${imgSrc(g.img)}" style="width:100%;height:100%;object-fit:cover;display:block;">` : `<div style="font-size:34px;text-align:center;line-height:60px;">${g.emoji || '🎁'}</div>`}</div>
          <div style="font-size:12.5px;font-weight:600;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(g.name)}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">¥${g.price}</div>
        </div>`).join('')}
      </div>
  `;
}

/* 惊喜面板：预设惊喜（友情/爱人 tab），自定义惊喜通过礼物栏加号入口 */
async function _ocSurprisePanelHtml() {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:13px;font-weight:600;">✨ 惊喜（免费，不做记录）</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="oc-side-action" id="oc-surprise-batch" title="批量管理">${icon('trash',19)}</button>
        <button class="oc-side-action" id="oc-add-menu-surprise" title="添加">${icon('plus',19)}</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button class="btn oc-stab" data-oc-stab="friend" style="flex:1;background:var(--purple);color:#141019;">友情版</button>
      <button class="btn oc-stab" data-oc-stab="lover" style="flex:1;">爱人版</button>
    </div>
    <div id="oc-surprise-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;"></div>
  `;
}

/* 礼物柜（20260929bm 重做）：记忆宫殿式卡片牌组浏览 + 列表 双视图
   - 默认卡片视图：三张层叠卡，轻点/左右滑动翻看（WAAPI advance，同记忆宫殿手感）
   - 右上角「列表/卡片」按钮随时切换视图；列表里点某件礼物 → 卡片视图直接翻到那件
     （不再弹独立详情弹窗，从根上解决「一关详情整个页面全退出」）
   - 批量管理按当前 tab 勾选删除；底部新增「清空所有收到的礼物」「清空所有送出的礼物」 */
let _gcTab = 'in';
let _gcView = 'deck'; // 'deck' = 卡片牌组 | 'list' = 列表
let _gcTapDetail = true; // 20260929bo：牌组「轻点卡片查看详情」开关（kv gcTapDetail，'0'=关；关时轻点=翻下一件）
function _gcFilterGifts(all, isIn, cid) {
  return all.filter(g => isIn
    ? (g.direction !== 'toChar' && (g.charId === cid || g.charId === 'all'))
    : (g.direction === 'toChar' && g.charId === cid));
}
async function _ocGiftCabinetHtml() {
  const all = await idbGetAll('gifts');
  const cid = currentCharId;
  const isIn = _gcTab !== 'out';
  _gcTapDetail = (await getSetting('gcTapDetail')) !== '0'; // 20260929bo：默认开
  const mine = _gcFilterGifts(all, isIn, cid).sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
  const cName = (characters.find(x => x.id === cid) || {}).name || 'TA';
  const isDeck = _gcView !== 'list';
  return `
    <div style="display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;margin-bottom:12px;">
      <button class="icon-btn" id="gc-back">←</button>
      <div style="text-align:center;font-size:18px;font-weight:600;">🎁 礼物柜</div>
      <button class="icon-btn" id="gc-tap-toggle" title="轻点卡片查看详情（开/关）" style="width:34px;height:34px;font-size:16px;margin-right:4px;${_gcTapDetail ? 'color:var(--purple-soft);background:var(--purple-dim);' : 'color:var(--text-tertiary);'}">${icon('eye', 16)}</button>
      <button class="btn" id="gc-view-toggle" style="padding:7px 12px;${isDeck ? '' : 'background:var(--purple);color:#141019;'}">${icon(isDeck ? 'listview' : 'cards', 15)}　${isDeck ? '列表' : '卡片'}</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button class="btn gc-tab" data-gc-tab="in" style="flex:1;${isIn ? 'background:var(--purple);color:#141019;' : ''}">收到的</button>
      <button class="btn gc-tab" data-gc-tab="out" style="flex:1;${!isIn ? 'background:var(--purple);color:#141019;' : ''}">送出的</button>
    </div>
    ${isDeck ? `
      ${mine.length ? `
        <div class="gc-deck-stage"><div class="gc-deck" id="gc-deck"></div></div>
        <div class="gc-deck-hud">
          <button class="icon-btn" id="gc-prev" title="上一件">←</button>
          <span id="gc-deck-count" style="font-size:12.5px;color:var(--text-tertiary);min-width:56px;text-align:center;">1 / ${mine.length}</span>
          <button class="icon-btn" id="gc-next" title="下一件">→</button>
        </div>
        <div class="gc-deck-hint">${_gcTapDetail ? '轻点卡片查看详情 · 左右滑动翻看' : '轻点卡片或左右滑动翻看'} · 共 ${mine.length} 件${isIn ? '收到' : '送出'}的礼物</div>
      ` : `<div style="text-align:center;color:var(--text-tertiary);font-size:13px;padding:40px 0;">${isIn ? '礼物柜还是空的' : '还没有送出过礼物'}</div>`}
    ` : `
      <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:10px;">${isIn ? `收到 ${mine.length} 件礼物` : `送出 ${mine.length} 件礼物`} · 点卡片翻看</div>
      <div id="gc-list" style="display:flex;flex-direction:column;gap:8px;max-height:44vh;overflow:auto;">
        ${mine.map((g, i) => `
          <div class="gc-item" data-gid="${g.id}" data-gidx="${i}" style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px;">
            <div style="width:44px;height:44px;border-radius:10px;overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center;background:var(--bg);">${_ocGiftImgOf(g) ? `<img src="${imgSrc(_ocGiftImgOf(g))}" style="width:44px;height:44px;object-fit:cover;">` : '🎁'}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(g.giftName)}</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${isIn
                ? (g.charId === 'all' ? '来自维度裂隙' : '来自 ' + ((characters.find(x => x.id === g.charId) || {}).name || 'TA')) + (g.opened === false ? ' · 未打开' : '')
                : '送给了 ' + cName} · ${timeAgoStr(g.receivedAt)}</div>
            </div>
            <div style="font-size:11px;color:var(--text-tertiary);flex:none;">${i + 1}/${mine.length}</div>
          </div>`).join('') || `<div style="text-align:center;color:var(--text-tertiary);font-size:13px;padding:24px;">${isIn ? '礼物柜还是空的' : '还没有送出过礼物'}</div>`}
      </div>
      ${mine.length ? `<button class="btn block" id="gc-batch" style="margin-top:10px;">批量管理</button>` : ''}
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn danger" id="gc-clear-in" style="flex:1;font-size:12.5px;">清空所有收到的礼物</button>
        <button class="btn danger" id="gc-clear-out" style="flex:1;font-size:12.5px;">清空所有送出的礼物</button>
      </div>
    `}
  `;
}

/* 打开礼物柜（视图/tab 切换重进；startIdx = 列表点进卡片视图时定位到第几件）
   20260930cd：重建保滚动位——弹窗本体与列表的 scrollTop 先记后还，不跳顶 */
async function _ocOpenCabinet(startIdx = 0) {
  const prevBox = $('#modal-content');
  const prevList = $('#gc-list');
  const snapSt = prevBox ? prevBox.scrollTop : 0;
  const snapListSt = prevList ? prevList.scrollTop : 0;
  openModal(await _ocGiftCabinetHtml());
  $('#gc-back').onclick = () => showOverclockHub();
  $$('.gc-tab').forEach(t => { t.onclick = () => { _gcTab = t.dataset.gcTab; _ocOpenCabinet(0); }; });
  const tog = $('#gc-view-toggle');
  if (tog) tog.onclick = () => { _gcView = _gcView === 'deck' ? 'list' : 'deck'; _ocOpenCabinet(0); };
  // 20260929bo：轻点查看详情 开/关（标题右侧眼睛按钮）
  const tapTog = $('#gc-tap-toggle');
  if (tapTog) tapTog.onclick = async () => {
    _gcTapDetail = !_gcTapDetail;
    await setSetting('gcTapDetail', _gcTapDetail ? '1' : '0');
    miniToast(_gcTapDetail ? '轻点卡片查看详情：已开启' : '轻点卡片查看详情：已关闭（轻点=翻下一件）');
    _ocOpenCabinet(startIdx);
  };
  if (_gcView === 'deck') _gcBindDeck(startIdx);
  else _gcBindGiftCabinet();
  requestAnimationFrame(() => {
    const box = $('#modal-content');
    if (box && snapSt) box.scrollTop = snapSt;
    const list = $('#gc-list');
    if (list && snapListSt) list.scrollTop = snapListSt;
  });
}

/* 绑定列表视图事件（点卡片 → 卡片视图定位；批量管理/清空） */
function _gcBindGiftCabinet() {
  $$('.gc-item').forEach(it => {
    it.onclick = () => { _gcView = 'deck'; _ocOpenCabinet(parseInt(it.dataset.gidx, 10) || 0); };
  });
  const batch = $('#gc-batch');
  if (batch) batch.onclick = () => _ocBatchDeleteGifts();
  const ci = $('#gc-clear-in');
  if (ci) ci.onclick = () => _gcClearGifts('in');
  const co = $('#gc-clear-out');
  if (co) co.onclick = () => _gcClearGifts('out');
}

/* 清空当前访客的全部收到的 / 送出的礼物（20260929bm）。
   收到侧保留维度裂隙首赠的星辰项链（charId='all'/isInitial），与全局删除约定一致 */
async function _gcClearGifts(kind) {
  const isIn = kind === 'in';
  const cid = currentCharId;
  const cName = (characters.find(x => x.id === cid) || {}).name || 'TA';
  const all = await idbGetAll('gifts');
  const mine = _gcFilterGifts(all, isIn, cid);
  const targets = isIn ? mine.filter(g => !(g.charId === 'all' || g.isInitial)) : mine;
  if (!targets.length) { miniToast(isIn ? '没有可清空的礼物（初始项链会保留）' : '还没有送出过礼物'); return; }
  showConfirm(isIn
    ? `确定清空 ${cName} 送来的全部 ${targets.length} 件礼物吗？（初始的星辰项链会保留）此操作无法撤销。`
    : `确定清空你送给 ${cName} 的全部 ${targets.length} 件礼物吗？此操作无法撤销。`, async () => {
    for (const g of targets) await idbDelete('gifts', g.id);
    miniToast('已清空');
    _ocOpenCabinet(0);
  });
}

/* —— 礼物柜卡片牌组（20260929bm）：三卡层叠 + 轻点/拖拽翻看，移植记忆宫殿手感 —— */
function _gcBindDeck(startIdx = 0) {
  const deck = $('#gc-deck');
  if (!deck) return;
  (async () => {
    const all = await idbGetAll('gifts');
    const cid = currentCharId;
    const isIn = _gcTab !== 'out';
    const list = _gcFilterGifts(all, isIn, cid).sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
    const n = list.length;
    if (!n) return;
    let idx = Math.min(Math.max(0, startIdx), n - 1);
    const cName = (characters.find(x => x.id === cid) || {}).name || 'TA';

    const backSlot = Math.min(2, n - 1);
    const SLOT = [
      { t: 'translate(-50%,-50%) translate3d(0px,0px,0px) rotateZ(0deg) scale(1)', f: 'brightness(1)', z: 30 },
      { t: 'translate(-50%,-50%) translate3d(-16px,26px,-70px) rotateZ(-4.5deg) scale(.945)', f: 'brightness(.8)', z: 20 },
      { t: 'translate(-50%,-50%) translate3d(14px,50px,-140px) rotateZ(3.8deg) scale(.89)', f: 'brightness(.62)', z: 10 },
    ];
    const E_INOUT = 'cubic-bezier(.65,.05,.36,1)';
    const E_IN = 'cubic-bezier(.55,.06,.68,.19)';
    const E_OUT = 'cubic-bezier(.215,.61,.355,1)';
    let cards = [];
    let busy = false;
    let _anims = [];

    function cardHtml(g) {
      const fromIn = g.direction !== 'toChar';
      const img = _ocGiftImgOf(g);
      const who = fromIn ? (g.charId === 'all' ? '来自维度裂隙' : '来自 ' + ((characters.find(x => x.id === g.charId) || {}).name || 'TA')) : ('送给了 ' + cName);
      return `
        <div class="gc-dc-top">
          <span class="gc-dc-who">${escapeHtml(who)}</span>
          <span class="gc-dc-tag">${fromIn ? '收到的礼物' : '送出的礼物'}</span>
        </div>
        <div class="gc-dc-img">${img ? `<img src="${imgSrc(img)}" alt="">` : '🎁'}</div>
        <div class="gc-dc-name">${escapeHtml(g.giftName || '礼物')}</div>
        <div class="gc-dc-body">${g.giftDesc ? escapeHtml(g.giftDesc) : ''}</div>
        <div class="gc-dc-foot">
          ${g.note ? `<div class="gc-dc-note">“${escapeHtml(g.note)}”</div>` : ''}
          <div class="gc-dc-meta">${(g.opened === false ? '未打开 · ' : '') + timeAgoStr(g.receivedAt) + (g.price ? ' · ¥' + g.price : '')}</div>
        </div>`;
    }
    function setCardContent(el, g) { el._gid = g.id; el.innerHTML = cardHtml(g); }
    function applySlot(el, k) {
      const s = SLOT[Math.min(k, 2)];
      el.style.transform = s.t;
      el.style.filter = s.f;
      el.style.zIndex = s.z;
      el.classList.toggle('front', k === 0);
    }
    function updateHud() {
      const c = $('#gc-deck-count');
      if (c) c.textContent = `${idx + 1} / ${n}`;
    }
    function rebuildDeck() {
      _anims.forEach(a => { try { a.cancel(); } catch (e) {} });
      _anims = [];
      busy = false;
      deck.innerHTML = '';
      cards = [];
      const layers = Math.min(3, n);
      for (let k = 0; k < layers; k++) {
        const el = document.createElement('div');
        el.className = 'gc-dcard';
        setCardContent(el, list[(idx + k) % n]);
        el.addEventListener('pointerdown', onDown);
        deck.appendChild(el);
        cards.push(el);
        applySlot(el, k);
      }
      updateHud();
    }
    /* 抽出 → 补位（同记忆宫殿 advance） */
    function advance(dir, dragState) {
      if (busy || n < 2) return;
      busy = true;
      const E0 = cards[0], E1 = cards[1] || null, E2 = cards[2] || null;
      const exitX = dir * Math.max(300, window.innerWidth * 0.6);
      const fromT = (dragState && dragState.fromT) || SLOT[0].t;
      const landT = SLOT[backSlot].t, landF = SLOT[backSlot].f;
      const a0 = E0.animate([
        { transform: fromT, filter: 'brightness(1)' },
        { transform: `translate(-50%,-50%) translate3d(${exitX * 0.5}px,-22px,-60px) rotateZ(${dir * 8}deg) rotateY(${-dir * 24}deg) scale(.85)`, filter: 'brightness(.9)', offset: 0.42 },
        { transform: `translate(-50%,-50%) translate3d(${exitX}px,14px,-110px) rotateZ(${dir * 12}deg) rotateY(${-dir * 32}deg) scale(.78)`, filter: 'brightness(.78)' },
      ], { duration: 560, easing: E_IN, fill: 'forwards' });
      _anims = [a0];
      setTimeout(() => { E0.style.zIndex = '5'; }, 170);
      if (E1) {
        setTimeout(() => { E1.style.zIndex = '30'; }, 250);
        _anims.push(E1.animate([
          { transform: SLOT[1].t, filter: SLOT[1].f },
          { transform: SLOT[0].t, filter: SLOT[0].f },
        ], { duration: 820, delay: 250, easing: E_INOUT, fill: 'forwards' }));
      }
      if (E2) {
        setTimeout(() => { E2.style.zIndex = '20'; }, 380);
        _anims.push(E2.animate([
          { transform: SLOT[2].t, filter: SLOT[2].f },
          { transform: SLOT[1].t, filter: SLOT[1].f },
        ], { duration: 780, delay: 380, easing: E_INOUT, fill: 'forwards' }));
      }
      setTimeout(() => {
        if (n >= 3) setCardContent(E0, list[(idx + 3) % n]);
        const a0b = E0.animate([
          { transform: `translate(-50%,-50%) translate3d(${exitX}px,14px,-110px) rotateZ(${dir * 12}deg) rotateY(${-dir * 32}deg) scale(.78)`, filter: 'brightness(.78)' },
          { transform: landT, filter: landF },
        ], { duration: 660, easing: E_OUT, fill: 'forwards' });
        _anims.push(a0b);
      }, 560);
      setTimeout(() => {
        idx = (idx + 1) % n;
        cards = cards.slice(1).concat(cards.slice(0, 1));
        _anims.forEach(a => { try { a.cancel(); } catch (e) {} });
        _anims = [];
        cards.forEach((el, k) => applySlot(el, Math.min(k, n - 1)));
        busy = false;
        updateHud();
      }, 1240);
    }
    /* 拖拽跟手（同记忆宫殿） */
    let drag = null;
    function onDown(ev) {
      const el = ev.currentTarget;
      if (busy || n < 2 || el !== cards[0]) return;
      drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, t: Date.now(), moved: false, el };
      try { el.setPointerCapture(ev.pointerId); } catch (e) {}
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    }
    function onMove(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      const el = drag.el;
      drag.dx = ev.clientX - drag.x;
      drag.dy = ev.clientY - drag.y;
      if (Math.abs(drag.dx) > 6 || Math.abs(drag.dy) > 6) drag.moved = true;
      const lead = Math.min(1, Math.abs(drag.dx) / 240);
      el.style.transform = `translate(-50%,-50%) translate3d(${drag.dx}px,${drag.dy * 0.3}px,${-lead * 46}px) rotateZ(${drag.dx * 0.05}deg) rotateY(${-drag.dx * 0.14}deg) scale(${1 - lead * 0.07})`;
    }
    function onUp(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      const el = drag.el;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      const d = drag; drag = null;
      if (!d || el !== cards[0]) return;
      const speed = Math.abs(d.dx) / Math.max(1, Date.now() - d.t);
      if (!d.moved || (Math.abs(d.dx) < 56 && speed < 0.45)) {
        if (!d.moved) {
          // 20260929bo：轻点 = 查看礼物详情（可在标题右侧开关）；开关关闭时保持原行为（翻下一件）
          if (_gcTapDetail) { _gcShowGiftDetail(list[idx], idx); }
          else advance(1);
          return;
        }
        busy = true;
        const a = el.animate([
          { transform: el.style.transform || SLOT[0].t, filter: 'brightness(1)' },
          { transform: SLOT[0].t, filter: SLOT[0].f },
        ], { duration: 300, easing: 'cubic-bezier(.3,.9,.4,1)', fill: 'forwards' });
        a.onfinish = () => { try { a.cancel(); } catch (e) {} applySlot(el, 0); busy = false; };
        return;
      }
      advance(d.dx > 0 ? 1 : -1, { fromT: el.style.transform });
    }
    /* HUD 左右按钮（PC 也能方便翻看） */
    const prev = $('#gc-prev'), next = $('#gc-next');
    if (prev) prev.onclick = () => { if (!busy && n >= 2) { idx = (idx - 1 + n) % n; rebuildDeck(); } };
    if (next) next.onclick = () => { if (!busy && n >= 2) advance(1); };
    rebuildDeck();
  })();
}

/* 绑定礼物面板事件 */
/* 20260929bq：礼物柜轻点详情改用「涂色」星空渐变样式——与聊天收礼弹窗同一 oc-star-modal
   风格（紫罗兰渐变 + 星光 + 寄语打字机），替换此前白色普通弹窗（含 📥 标题，与整体风格
   不一致）。关闭 = 直接重开礼物柜牌组并定位到同一件——子功能关闭必须回上一界面 */
function _gcShowGiftDetail(g, idx) {
  if (!g) return;
  const fromIn = g.direction !== 'toChar';
  const cName = (characters.find(x => x.id === currentCharId) || {}).name || 'TA';
  const head = fromIn
    ? (g.charId === 'all'
        ? '来自维度裂隙的礼物'
        : (((characters.find(x => x.id === g.charId) || {}).name || cName) + ' 送来的礼物'))
    : ('送给 ' + cName + ' 的礼物');
  const foot = `${timeAgoStr(g.receivedAt)}${g.price ? ' · ¥' + g.price : ''}${g.opened === false ? ' · 未打开' : ''}`;
  _ocShowGiftModal(g, { head, foot }, () => _ocOpenCabinet(idx));
}

function _ocBindGiftPanel() {
  const batchBtn = $('#oc-gift-batch'); // 20260929bm：礼物库批量管理（删除自定义礼物）
  if (batchBtn) batchBtn.onclick = () => _ocBatchManageGiftLib();
  const cabBtn = $('#oc-gift-cabinet');
  if (cabBtn) cabBtn.onclick = async () => { await _ocOpenCabinet(); };
  const addBtn = $('#oc-add-menu');
  if (addBtn) addBtn.onclick = () => showOcAddMenu();
  $$('.oc-gift-card').forEach(card => {
    card.onclick = async () => {
      const id = card.dataset.giftId;
      const price = parseInt(card.dataset.giftPrice, 10);
      let g = OVERCLOCK_GIFTS.find(x => x.id === id);
      if (!g) g = (await _ocCustomGifts()).find(x => x.id === id);
      if (!g) { miniToast('礼物不存在'); return; }
      showOcGiftInfo(g, price);
    };
  });
}

/* 礼物库批量管理（20260929bm）：勾选删除自定义礼物（预设礼物为内置不可删） */
async function _ocBatchManageGiftLib() {
  const customs = await _ocCustomGifts();
  let sel = new Set();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;">批量管理礼物库</div>
      <button class="icon-btn" id="glb-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:10px;">自定义礼物 ${customs.length} 个 · 点选要删除的（预设礼物为内置，不提供删除）</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto;" id="glb-list">
      ${customs.map(g => `<div class="glb-item" data-gid="${g.id}" style="background:var(--bg-elevated-2);border-radius:10px;padding:11px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;">${g.emoji || '🎁'}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.name)}</span>
        <span style="font-size:11px;color:var(--text-tertiary);">¥${g.price}</span>
      </div>`).join('') || '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">还没有自定义礼物</div>'}
    </div>
    <button class="btn danger block" id="glb-del" style="margin-top:12px;">删除所选</button>
  `);
  $('#glb-close').onclick = () => showOverclockHub('gift');
  $$('.glb-item').forEach(it => {
    it.onclick = () => {
      const id = it.dataset.gid;
      if (sel.has(id)) { sel.delete(id); it.style.outline = ''; }
      else { sel.add(id); it.style.outline = '2px solid var(--purple-soft)'; }
    };
  });
  $('#glb-del').onclick = async () => {
    if (!sel.size) { miniToast('请先点选要删除的礼物'); return; }
    showConfirm(`确定删除选中的 ${sel.size} 个自定义礼物吗？`, async () => {
      const left = (await _ocCustomGifts()).filter(g => !sel.has(g.id));
      await _ocSet('customGifts', left);
      miniToast('已删除');
      showOverclockHub('gift');
    });
  };
}

/* 礼物库卡片 → 查看礼物解释（20260929aq）：玻璃拟态详情弹窗，底部按钮进入送出流程
   20260930cd：进入前记录礼物库滚动位，关闭/送出取消返回后恢复（不跳回顶部） */
let _ocHubPanelScroll = 0;
/* 20260930cd：返回超频后恢复礼物库滚动位——renderOcPanel 是 fire-and-forget，
   轮询等面板真正渲染出内容后再设 scrollTop（其内部同步尾段先归零也不会覆盖） */
async function ocRestoreHubScroll() {
  for (let i = 0; i < 20; i++) {
    const p = $('#oc-panel');
    if (p && p.children.length) { p.scrollTop = _ocHubPanelScroll; return; }
    await new Promise(r => setTimeout(r, 25));
  }
}
function showOcGiftInfo(g, price) {
  const panel = $('#oc-panel');
  _ocHubPanelScroll = panel ? panel.scrollTop : 0;   // 记录礼物库滚动位（openModal 会整体替换弹窗内容）
  const restoreHub = async () => {
    await showOverclockHub();
    await ocRestoreHubScroll();
  };
  const img = _ocGiftImgOf(g);
  const imgHtml = img ? `<img src="${imgSrc(img, true)}" style="width:132px;height:132px;object-fit:cover;border-radius:18px;display:block;margin:0 auto;box-shadow:0 0 32px rgba(167,139,250,0.45),0 0 0 1px rgba(255,255,255,0.15) inset;">` : `<div style="font-size:60px;text-align:center;">🎁</div>`;
  openModal(`
    <div class="oc-star-modal">
      <div class="oc-star-field"></div>
      <div class="oc-star-blob oc-star-blob1"></div>
      <div class="oc-star-blob oc-star-blob2"></div>
      <div style="position:relative;z-index:2;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:14px;color:rgba(230,222,255,0.82);">礼物 · ${g.custom ? '自定义' : '预设'}</div>
          <button class="icon-btn" id="ocgi-close" style="color:rgba(230,222,255,0.9);">✕</button>
        </div>
        <div style="text-align:center;padding:14px 0 0;">${imgHtml}</div>
        <div style="text-align:center;font-size:20px;font-weight:750;color:#f4efff;margin-top:14px;">${escapeHtml(g.name)}</div>
        ${g.desc ? `<div style="text-align:center;font-size:16px;color:rgba(238,231,255,0.9);line-height:1.85;margin-top:12px;">${escapeHtml(g.desc)}</div>` : ''}
        <div style="text-align:center;font-size:14px;color:rgba(230,222,255,0.7);margin-top:12px;">¥${price} · 我的钱包 ¥${playerProfile.wallet}</div>
        <div style="margin-top:16px;">
          <button class="btn primary block" id="ocgi-send">送出这份礼物</button>
        </div>
      </div>
    </div>`, { glass: true, narrow: true, noBackdrop: true });
  $('#ocgi-close').onclick = () => restoreHub();
  $('#ocgi-send').onclick = () => showOcSendGift(g, price);
}

/* 批量删除礼物（20260929bm：按当前 tab 过滤；关闭/删除后回礼物柜列表视图，不再退出整个柜子） */
async function _ocBatchDeleteGifts() {
  const all = await idbGetAll('gifts');
  const cid = currentCharId;
  const isIn = _gcTab !== 'out';
  const mine = _gcFilterGifts(all, isIn, cid);
  let sel = new Set();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;">批量管理礼物</div>
      <button class="icon-btn" id="gbd-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:10px;">点选要删除的礼物（当前：${isIn ? '收到的' : '送出的'}）</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto;" id="gbd-list">
      ${mine.map(g => `<div class="gbd-item" data-gid="${g.id}" style="background:var(--bg-elevated-2);border-radius:10px;padding:11px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;">
        <span style="font-size:17px;">${_ocGiftImgOf(g) ? `<img src="${imgSrc(_ocGiftImgOf(g))}" style="width:26px;height:26px;object-fit:cover;border-radius:7px;">` : '🎁'}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.giftName)}</span>
      </div>`).join('') || '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">没有可删除的礼物</div>'}
    </div>
    <button class="btn danger block" id="gbd-del" style="margin-top:12px;">删除所选</button>
  `);
  $('#gbd-close').onclick = () => { _gcView = 'list'; _ocOpenCabinet(0); };
  $$('.gbd-item').forEach(it => {
    it.onclick = () => {
      const id = it.dataset.gid;
      if (sel.has(id)) { sel.delete(id); it.style.outline = ''; }
      else { sel.add(id); it.style.outline = '2px solid var(--purple-soft)'; }
    };
  });
  $('#gbd-del').onclick = async () => {
    if (!sel.size) { miniToast('请先点选要删除的礼物'); return; }
    showConfirm(`确定删除选中的 ${sel.size} 件礼物吗？`, async () => {
      for (const id of sel) await idbDelete('gifts', id);
      miniToast('已删除');
      _gcView = 'list'; _ocOpenCabinet(0);
    });
  };
}

async function showOcAddMenu() {
  const surpriseUnlocked = await isSurpriseUnlocked();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:17px;font-weight:650;">添加超频内容</div>
      <button class="icon-btn" id="ocam-close">✕</button>
    </div>
    <button class="btn block" id="ocam-gift" style="margin-bottom:9px;">${icon('gift',17)}　自定义添加礼物</button>
    ${surpriseUnlocked ? `<button class="btn block" id="ocam-surprise">${icon('sparkle',17)}　自定义添加惊喜</button>` : ''}
  `, { glass:true, narrow:true, noBackdrop:true });
  $('#ocam-close').onclick = () => showOverclockHub();
  $('#ocam-gift').onclick = () => showOcAddGift();
  const sb = $('#ocam-surprise');
  if (sb) sb.onclick = () => showOcAddSurprise();
}

/* 自定义添加礼物（图片 + 解释语 + 寄语 + 定价 1~2000） */
function showOcAddGift() {
  let imgData = '';
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;">自定义礼物</div>
      <button class="icon-btn" id="ocag-close">✕</button>
    </div>
    <div class="field">
      <label>礼物图片</label>
      <div style="display:flex;align-items:center;gap:10px;">
        <label class="btn" for="ocag-img" style="cursor:pointer;">上传图片</label>
        <input type="file" id="ocag-img" accept="image/*" style="display:none;">
        <span id="ocag-img-prev" style="font-size:22px;">🎁</span>
      </div>
    </div>
    <div class="field"><label>礼物名称</label><input class="input" id="ocag-name" maxlength="20" placeholder="礼物名称"></div>
    <div class="field"><label>礼物解释语</label><textarea class="input" id="ocag-desc" maxlength="120" placeholder="写一句礼物的解释"></textarea></div>
    <div class="field"><label>礼物发出的寄语</label><textarea class="input" id="ocag-note" maxlength="60" placeholder="送出去时附上的寄语"></textarea></div>
    <div class="field"><label>礼物价格（1~2000）</label><input class="input" type="number" id="ocag-price" value="100" min="1" max="2000"></div>
    <button class="btn primary block" id="ocag-save">保存礼物</button>
  `);
  $('#ocag-close').onclick = () => showOverclockHub();
  $('#ocag-img').onchange = async (e) => {
    const f = e.target.files[0];
    if (f) { imgData = await compressImage(f, 360, 0.8, true); $('#ocag-img-prev').innerHTML = `<img src="${imgSrc(imgData, true)}" style="width:34px;height:34px;object-fit:cover;border-radius:8px;">`; }
  };
  $('#ocag-save').onclick = async () => {
    const name = $('#ocag-name').value.trim();
    const desc = $('#ocag-desc').value.trim();
    const note = $('#ocag-note').value.trim();
    let price = parseInt($('#ocag-price').value, 10);
    if (!name) { miniToast('请填写礼物名称'); return; }
    if (!price || price < 1) price = 1;
    if (price > 2000) price = 2000;
    const customs = await _ocCustomGifts();
    customs.push({ id: uid('cg'), name, desc, note, price, img: imgData });
    await _ocSet('customGifts', customs);
    miniToast('礼物已添加');
    showOverclockHub();
  };
}

/* 绑定惊喜面板 tab */
function _ocBindSurpriseTabs() {
  let cur = 'friend';
  $$('.oc-stab').forEach(t => {
    t.onclick = () => {
      $$('.oc-stab').forEach(x => x.style.cssText = 'flex:1;');
      t.style.cssText = 'flex:1;background:var(--purple);color:#141019;';
      cur = t.dataset.ocStab;
      _ocRenderSurpriseList(cur);
    };
  });
  _ocRenderSurpriseList(cur);
}

async function _ocRenderSurpriseList(mode) {
  const list = $('#oc-surprise-list');
  if (!list) return;
  const presets = OVERCLOCK_SURPRISES[mode] || [];
  // 20260929bm：自定义惊喜按版本归类（旧数据无 mode → 两个 tab 都显示，不丢失）
  const customs = (await _ocCustomSurprises()).filter(s => !s.mode || s.mode === mode);
  const all = presets.concat(customs);
  list.innerHTML = all.map(s => `
    <div class="oc-surprise-item" data-big="${escapeHtml(s.big)}" data-act="${escapeHtml(s.act)}" data-move="${escapeHtml(s.move)}" style="background:var(--bg-elevated-2);border-radius:12px;padding:12px;cursor:pointer;">
      ${s.mode ? `<div style="font-size:10.5px;color:var(--text-tertiary);margin-bottom:3px;">自定义 · ${s.mode === 'friend' ? '友情版' : '爱人版'}</div>` : ''}
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">Ta（${escapeHtml(s.act)}），决定跨越维度，（${escapeHtml(s.move)}），</div>
      <div style="font-size:15px;font-weight:700;color:#e5615c;margin-top:2px;">${escapeHtml(s.big)}</div>
    </div>`).join('');
  $$('.oc-surprise-item').forEach(it => {
    it.onclick = () => _ocSendSurprise({ act: it.dataset.act, move: it.dataset.move, big: it.dataset.big });
  });
}

/* 绑定惊喜面板事件（自定义惊喜 + 批量管理） */
function _ocBindSurprisePanel() {
  const addBtn = $('#oc-add-menu-surprise');
  if (addBtn) addBtn.onclick = () => showOcAddMenu();
  const batchBtn = $('#oc-surprise-batch'); // 20260929bm：惊喜批量管理（删除自定义惊喜）
  if (batchBtn) batchBtn.onclick = () => _ocBatchManageSurprises();
}

/* 惊喜批量管理（20260929bm）：勾选删除自定义惊喜（预设惊喜为内置不可删） */
async function _ocBatchManageSurprises() {
  const customs = await _ocCustomSurprises();
  let sel = new Set();
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;">批量管理惊喜</div>
      <button class="icon-btn" id="srb-close">✕</button>
    </div>
    <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:10px;">自定义惊喜 ${customs.length} 条 · 点选要删除的（预设惊喜为内置，不提供删除）</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto;" id="srb-list">
      ${customs.map(s => `<div class="srb-item" data-sid="${s.id}" style="background:var(--bg-elevated-2);border-radius:10px;padding:10px 12px;cursor:pointer;">
        <div style="font-size:11px;color:var(--text-tertiary);">${s.mode === 'friend' ? '友情版' : (s.mode === 'lover' ? '爱人版' : '未分组')}</div>
        <div style="font-size:14px;font-weight:700;color:#e5615c;margin-top:2px;">${escapeHtml(s.big)}</div>
      </div>`).join('') || '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">还没有自定义惊喜</div>'}
    </div>
    <button class="btn danger block" id="srb-del" style="margin-top:12px;">删除所选</button>
  `);
  $('#srb-close').onclick = () => showOverclockHub('surprise');
  $$('.srb-item').forEach(it => {
    it.onclick = () => {
      const id = it.dataset.sid;
      if (sel.has(id)) { sel.delete(id); it.style.outline = ''; }
      else { sel.add(id); it.style.outline = '2px solid var(--purple-soft)'; }
    };
  });
  $('#srb-del').onclick = async () => {
    if (!sel.size) { miniToast('请先点选要删除的惊喜'); return; }
    showConfirm(`确定删除选中的 ${sel.size} 条自定义惊喜吗？`, async () => {
      const left = (await _ocCustomSurprises()).filter(s => !sel.has(s.id));
      await _ocSet('customSurprises', left);
      miniToast('已删除');
      showOverclockHub('surprise');
    });
  };
}

/* 自定义惊喜（仅文字，严格按格式；20260929bm：可选友情版/爱人版） */
function showOcAddSurprise() {
  let mode = 'friend';
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;">自定义惊喜</div>
      <button class="icon-btn" id="ocas-close">✕</button>
    </div>
    <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:10px;">格式：Ta（这里填动作），决定跨越维度，（这里填描述），（这里填大字）！</div>
    <div class="field">
      <label>惊喜版本</label>
      <div style="display:flex;gap:8px;" id="ocas-mode-pick">
        <button class="btn ocas-mode" data-mode="friend" style="flex:1;background:var(--purple);color:#141019;">友情版</button>
        <button class="btn ocas-mode" data-mode="lover" style="flex:1;">爱人版</button>
      </div>
    </div>
    <div class="field"><label>动作（Ta…）</label><input class="input" id="ocas-act" maxlength="30" placeholder="比如：想你又不敢说"></div>
    <div class="field"><label>描述（决定跨越维度，…）</label><input class="input" id="ocas-move" maxlength="40" placeholder="比如：偷偷戳了戳你的屏幕"></div>
    <div class="field"><label>大字（最后一行红色故障大字）</label><input class="input" id="ocas-big" maxlength="15" placeholder="比如：抱抱！"></div>
    <button class="btn primary block" id="ocas-save">保存惊喜</button>
  `);
  $('#ocas-close').onclick = () => showOverclockHub('surprise');
  $$('.ocas-mode').forEach(b => {
    b.onclick = () => {
      mode = b.dataset.mode;
      $$('.ocas-mode').forEach(x => { x.style.background = ''; x.style.color = ''; });
      b.style.background = 'var(--purple)';
      b.style.color = '#141019';
    };
  });
  $('#ocas-save').onclick = async () => {
    const act = $('#ocas-act').value.trim();
    const move = $('#ocas-move').value.trim();
    const big = $('#ocas-big').value.trim();
    if (!act || !move || !big) { miniToast('请填写完整（动作/描述/大字）'); return; }
    const customs = await _ocCustomSurprises();
    customs.push({ id: uid('cs'), act, move, big, mode }); // 20260929bm：记录版本（旧数据无 mode 在两个 tab 都显示）
    await _ocSet('customSurprises', customs);
    miniToast('惊喜已添加');
    showOverclockHub('surprise');
  };
}

/* 玩家发送礼物（20260929aq 玻璃拟态）：确认弹窗可输入寄语 → 扣钱包 → 裂隙动画（真实礼物图坠出）→ 发消息 → 礼物柜记录「送出」 */
function showOcSendGift(g, price) {
  if (!currentCharId) { miniToast('请先进入与访客的单聊'); return; }
  if (playerProfile.wallet < price) { miniToast('钱包金额不足了'); return; }
  if (_ocSending) return;
  const img = _ocGiftImgOf(g);
  const imgHtml = img ? `<img src="${imgSrc(img, true)}" style="width:120px;height:120px;object-fit:cover;border-radius:16px;display:block;margin:0 auto;box-shadow:0 0 30px rgba(167,139,250,0.45);">` : `<div style="font-size:56px;text-align:center;">🎁</div>`;
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:16.5px;font-weight:600;max-width:82%;">把「${escapeHtml(g.name)}」塞进维度裂隙</div>
      <button class="icon-btn" id="ocsg-close">✕</button>
    </div>
    <div style="text-align:center;padding:6px 0 2px;">${imgHtml}</div>
    <div style="font-size:12px;color:var(--text-tertiary);text-align:center;margin-top:8px;">花费 ¥${price} · 我的钱包 ¥${playerProfile.wallet}</div>
    <div class="field" style="margin-top:12px;">
      <label style="font-size:16px;font-weight:600;">礼物寄语（可选，随礼物一起送出）</label>
      <textarea class="input" id="ocsg-note" maxlength="60" placeholder="写一句想对 TA 说的话…" style="font-size:16px;line-height:1.75;">${g.custom && g.note ? escapeHtml(g.note) : ''}</textarea>
    </div>
    <button class="btn primary block" id="ocsg-send" style="margin-top:4px;">送出礼物</button>
  `, { glass: true, narrow: true, noBackdrop: true });
  $('#ocsg-close').onclick = async () => {           // 20260930cd：取消送出返回超频 = 回到之前滚动位
    await showOverclockHub();
    await ocRestoreHubScroll();
  };
  $('#ocsg-send').onclick = async () => {
    const playerNote = ($('#ocsg-note').value || '').trim();
    if (playerProfile.wallet < price) { miniToast('钱包金额不足了'); closeModal(); return; }
    _ocSending = true;
    try {
      playerProfile.wallet -= price;
      await setSetting('playerProfile', playerProfile);
      renderPlayerHome();
      const cid = currentCharId;
      const skipAnim = chatSettings.skipOverclockAnim || isLowEndDevice();
      closeModal();
      if (!skipAnim) await _ocShowGiftDrop('gift', img ? imgSrc(img, true) : '');
      // 礼物柜：记录玩家送出的礼物（direction=toChar，20260929ap 双向记录）
      const giftRecId = uid('gift');
      await idbPut('gifts', {
        id: giftRecId, charId: cid, giftId: g.id, giftName: g.name, giftDesc: g.desc || '',
        giftImg: g.img || '', note: playerNote || (g.note || ''), noteFrom: 'me', receivedAt: Date.now(), isInitial: false,
        direction: 'toChar', opened: true, price,
      });
      const m = {
        id: uid('msg'), charId: cid, from: 'me', type: 'gift', time: Date.now(),
        content: { giftId: g.id, giftName: g.name, giftDesc: g.desc || '', giftImg: g.img || '', note: playerNote, direction: 'me_to_char', price, giftRecId },
      };
      await idbPut('messages', m);
      appendMessage(m, true);
      renderChatList();
      closeModal();
      miniToast(`已送出「${g.name}」，花费 ¥${price}`);
      // 访客稍后回应
      scheduleCharReply(cid);
    } finally {
      _ocSending = false;
    }
  };
}
let _ocSending = false;

/* 玩家发送惊喜：免费，不做记录 */
async function _ocSendSurprise(s) {
  if (!currentCharId) { miniToast('请先进入与访客的单聊'); return; }
  if (_ocSending) return;
  _ocSending = true;
  try {
    if (!(chatSettings.skipOverclockAnim || isLowEndDevice())) {
      await _ocShowGiftDrop('surprise');
    }
    // 惊喜以特殊卡片消息展示（但不进礼物柜、不做记录）
    const m = {
      id: uid('msg'), charId: currentCharId, from: 'me', type: 'surprise', time: Date.now(),
      content: { act: s.act, move: s.move, big: s.big, direction: 'me_to_char' },
    };
    await idbPut('messages', m);
    appendMessage(m, true);
    renderChatList();
    closeModal();
    // 访客回应
    scheduleCharReply(currentCharId);
  } finally {
    _ocSending = false;
  }
}

/* ============================================================
   超频独立随机触发（20260929as）：与主动消息解耦，不附加概率
   ============================================================ */
function _ocIntervalFor(c) {
  const globalMin = Math.max(1, parseInt(chatSettings.overclockIntervalMin, 10) || 20);
  const globalMax = Math.max(globalMin, parseInt(chatSettings.overclockIntervalMax, 10) || 240);
  const cs = (c && c.chatSettings) || {};
  const min = Math.max(1, parseInt(cs.overclockIntervalMin, 10) || globalMin);
  const max = Math.max(min, parseInt(cs.overclockIntervalMax, 10) || globalMax);
  return randInt(min, max) * 60000;
}
async function _ocTickRandom(c, now = Date.now()) {
  if (!c || _ocPending.has(c.id)) return;
  if (!(await isOverclockUnlocked())) return;
  const cs = c.chatSettings || {};
  if (chatSettings.overclockProactive === false || cs.overclockProactive === false) return;
  if (!_ocNextAt[c.id]) { _ocNextAt[c.id] = now + _ocIntervalFor(c); _ocSaveNextAt(); }
  if (now < _ocNextAt[c.id]) return;
  _ocNextAt[c.id] = now + _ocIntervalFor(c);
  _ocSaveNextAt();
  _ocPending.add(c.id);
  try {
    // 惊喜占主动触发的 30%（20260929at 修复：原先要求「惊喜已解锁才可能发惊喜」，
    // 而惊喜解锁恰恰依赖访客先发惊喜——死锁导致永远发不出惊喜）
    const isSurprise = Math.random() < 0.30;
    if (isSurprise) await _ocCharSendSurprise(c);
    else await _ocCharSendGift(c);
  } finally { _ocPending.delete(c.id); }
}
async function maybeCharSendGift(c) { return _ocTickRandom(c, Date.now()); }

/* 是否跳过超频动画（该访客级覆盖 + 全局开关 + 低端机降级） */
function _ocSkipAnim(c) {
  const override = (c && c.chatSettings) || {};
  const skip = override.skipOverclockAnim !== undefined ? override.skipOverclockAnim : chatSettings.skipOverclockAnim;
  return skip || isLowEndDevice();
}

/* 判定超频动画「现在」是否该播：
   玩家正停留在该访客聊天页 → 立即播；
   玩家在非聊天页（导航/主页/朋友圈）→ 立即播（送达）；
   玩家在别的访客聊天页 → 不播，延迟到进入该访客聊天页。 */
function _ocCanAnimateNow(c) {
  return _inChatWith(c.id) || _inNonChatPage();
}

/* 访客主动赠送（随机间隔触发） */
async function _ocCharSendGift(c) {
  const allGifts = OVERCLOCK_GIFTS.concat(await _ocCustomGifts());
  const pick = allGifts[randInt(0, allGifts.length - 1)];
  if (!pick) return;
  const price = pick.price || 0;
  if ((c.wallet ?? 100000) < price) return; // 余额不足，等下次金钱增加
  c.wallet -= price;
  await saveChar(c);
  // 寄语：字卡 / AI 区分
  const note = await _ocGenerateNote(c);
  // 落礼物柜（direction=toPlayer 收到的礼物；opened=false 待玩家打开）
  const giftRecId = uid('gift');
  await idbPut('gifts', {
    id: giftRecId, charId: c.id, giftId: pick.id, giftName: pick.name, giftDesc: pick.desc || '',
    giftImg: pick.img || '', note, noteFrom: c.id, receivedAt: Date.now(), isInitial: false,
    direction: 'toPlayer', opened: false,
  });
  // 发礼物卡片消息
  const m = {
    id: uid('msg'), charId: c.id, from: 'them', type: 'gift', time: Date.now(),
    content: { giftId: pick.id, giftName: pick.name, giftDesc: pick.desc || '', giftImg: pick.img || '', note, direction: 'char_to_me', price, giftRecId, opened: false },
  };
  await idbPut('messages', m);
  // 动画：立即播（本访客聊天页 / 非聊天页）或挂起（他访客聊天页）由通知函数统一处理
  await _ocNotifyNewGift(c, m, pick.img ? imgSrc(pick.img, true) : '');
}

/* 访客送惊喜：免费，解锁惊喜列表，展示故障大字
   20260929ay：opts.forceFirst=true 时强制走「最初触发动画」（首次引导弹窗流程），
   供开发者命令「惊喜」复现完整首次体验（绝对命令，无视已解锁状态） */
async function _ocCharSendSurprise(c, opts = {}) {
  const mode = await _ocCharSurpriseMode(c.id);
  const presets = OVERCLOCK_SURPRISES[mode] || OVERCLOCK_SURPRISES.lover;
  const s = presets[randInt(0, presets.length - 1)];
  if (!s) return;
  // 首次触发：一次性弹窗「好像掉出了什么奇怪的东西」+「交由系统检测」
  const firstSurprise = opts.forceFirst || !(await isSurpriseUnlocked());
  if (firstSurprise) {
    await _ocSet('surpriseUnlocked', true);
    // 20260929be 细则一：外部页面（导航/主页/朋友圈）禁播全屏动画——
    // 完整首次流程挂起，进入该访客聊天页时再播（_ocOnEnterChat 接管）
    if (_inNonChatPage() && !opts.forceFirst) {
      await setSetting('pendingFirstSurprise', { charId: c.id, s });
      const e = _ev(c.id);
      e.surprises = (e.surprises || 0) + 1;
      await _saveUnreadEvents();
      renderChatList();
      refreshUnreadBadges();
      showTopBanner(`<b>${escapeHtml(c.name)}</b> 的维度好像传来了一些动静<div class="tb-sub">超频 · 点进与 TA 的聊天查看</div>`, { charId: c.id });
      if (shouldDingFor(c)) playDing();
      return;
    }
    await _ocShowFirstSurpriseFlow(c, s);
    return;
  }
  // 非首次：直接展示故障大字消息
  const m = {
    id: uid('msg'), charId: c.id, from: 'them', type: 'surprise', time: Date.now(),
    content: { act: s.act, move: s.move, big: s.big, direction: 'char_to_me' },
  };
  await idbPut('messages', m);
  await _ocNotifyNewSurprise(c, m);
}

/* 首次惊喜完整流程（20260929bb 重排）：
   三问号跳出（白色漩涡滚动）→ 问号缩小上浮悬停在弹窗上方（同一个图标，持续发光）→
   「好像掉出了什么奇怪的东西」玻璃弹窗 → 交由系统检测（漩涡持续滚动）→
   大字卡片（最上行「你收到了一条消息」）→ 点按任意处：落库+轻送达。
   （原「功能已解锁/知道了」二次弹窗已按反馈删除；此流程仅影响初次触发） */
async function _ocShowFirstSurpriseFlow(c, s) {
  const landMessage = async () => {
    const m = { id: uid('msg'), charId: c.id, from: 'them', type: 'surprise', time: Date.now(), content: { act: s.act, move: s.move, big: s.big, direction: 'char_to_me' } };
    await idbPut('messages', m);
    _ocNotifyNewSurprise(c, m, { skipAnim: true });
  };
  if (_ocSkipAnim(c)) { await landMessage(); return; }
  // 1) 三问号从裂隙跳出（含白色漩涡），结束后保留层与问号 DOM（同一个图标）
  const handle = await _ocAnimQueue(() => _ocShowGiftBurst('surprise', { keepAlive: true, withVortex: true }));
  await new Promise(resolve => {
    const layer = handle.layer;
    // 2) 问号上浮缩小悬停 + 背后光晕呼吸；裂口淡出、漩涡继续滚动
    layer.classList.add('oc-first-settle');
    // bd：弹窗外包一层 wrap——边框/背景交界处贴故障撕裂条带（黑白错位闪烁）+ RGB 错位描边
    const glt = (seed) => Array.from({ length: 4 }, (_, i) => {
      const w = 8 + ((seed * 13 + i * 29) % 26);
      const l = (seed * 17 + i * 31) % 66;
      return `<i style="left:${l}%;width:${w}%;animation-delay:${(((seed + i) % 5) * 0.37).toFixed(2)}s"></i>`;
    }).join('');
    const wrap = document.createElement('div');
    wrap.className = 'oc-first-wrap';
    wrap.innerHTML = `
      <div class="oc-glt-band top">${glt(2)}</div>
      <div class="oc-glt-band bot">${glt(5)}</div>
      <i class="oc-glt-side oc-glt-l1"></i><i class="oc-glt-side oc-glt-l2"></i>
      <i class="oc-glt-side oc-glt-r1"></i><i class="oc-glt-side oc-glt-r2"></i>
      <div class="oc-first-card">
        <div class="oc-first-glitch">⚠ SIGNAL DETECTED</div>
        <div class="oc-first-title">好像掉出了什么奇怪的东西</div>
        <button class="btn primary block" id="oc-first-detect" style="margin-top:16px;">交由系统检测</button>
      </div>`;
    layer.appendChild(wrap);
    $('#oc-first-detect').onclick = () => {
      // 3) 检测阶段：弹窗淡出，问号+漩涡继续滚动一小段
      wrap.classList.add('gone');
      setTimeout(() => {
        layer.classList.add('oc-burst-fade');
        setTimeout(() => {
          layer.remove();
          // 4) 大字卡片（最上行「你收到了一条消息」），关闭时落库+轻送达
          _ocShowSurpriseBigText(s, { head: '你收到了一条消息', onClose: landMessage });
          resolve();
        }, 520);
      }, 1500);
    };
  });
}

/* 礼物/惊喜落地通知（20260929av 重构；20260929be 按动画细则改造）：
   - 当前正停留在该访客聊天页 → appendMessage 上屏 + 跳出动画（礼盒/三问号从裂隙跳出）+ 弹窗/大字；
   - 其他访客聊天页 / 外部页面（导航·主页·朋友圈）→ 绝不播全屏动画，只累计未读 +
     顶部排队长条提示（细则二）；60 秒窗口内超 3 个访客 → 聚合卡片（细则三）；
   - 全屏裂隙动画只在玩家点进对应访客聊天页时由 _ocOnEnterChat 播（细则四）。 */
async function _ocNotifyNewGift(c, m, imgUrl) {
  const e = _ev(c.id);
  e.gifts = (e.gifts || 0) + 1;
  await _saveUnreadEvents();
  if (_inChatWith(c.id)) {
    appendMessage(m, true);
    _ocClearUnreadFor(c.id); // 已在聊天页，视为已读该访客超频
    await _ocPlayIncoming(c, m, imgUrl);
  } else {
    renderChatList();
    refreshUnreadBadges();
    if (!_noteCrossPageIncoming(c.id)) {
      showTopBanner(`<b>${escapeHtml(c.name)}</b> 的维度好像传来了一些动静<div class="tb-sub">超频 · 点进与 TA 的聊天查看</div>`, { charId: c.id });
    }
    if (shouldDingFor(c)) playDing();
  }
}
async function _ocNotifyNewSurprise(c, m, opts = {}) {
  const e = _ev(c.id);
  e.surprises = (e.surprises || 0) + 1;
  await _saveUnreadEvents();
  // 20260929bb：skipAnim=true（初次触发大字卡片已播过动画）→ 只落库与轻提示，不再重播跳出动画
  if (!opts.skipAnim && _inChatWith(c.id)) {
    appendMessage(m, true);
    _ocClearUnreadFor(c.id);
    await _ocPlayIncoming(c, m, '');
  } else if (opts.skipAnim && _inChatWith(c.id)) {
    appendMessage(m, true);
    _ocClearUnreadFor(c.id);
  } else {
    renderChatList();
    refreshUnreadBadges();
    if (!_noteCrossPageIncoming(c.id)) {
      showTopBanner(`<b>${escapeHtml(c.name)}</b> 的维度好像传来了一些动静<div class="tb-sub">超频 · 点进与 TA 的聊天查看</div>`, { charId: c.id });
    }
    if (shouldDingFor(c)) playDing();
  }
}

/* 清空某访客的未读超频计数（进入其聊天页即视为已读） */
async function _ocClearUnreadFor(charId) {
  const e = _unreadEvents[charId];
  if (e) { e.gifts = 0; e.surprises = 0; await _saveUnreadEvents(); }
  refreshUnreadBadges();
}

/* 播放「进入聊天页时」的待播动画：只取最后一条（惊喜优先），并播细窗提醒剩余未读
   20260929av：改走收到方向（跳出动画+弹窗/大字），不再是掉落吸入 */
async function _ocPlayPendingAnim(c, lastMsg) {
  const e = _unreadEvents[c.id] || { gifts: 0, surprises: 0 };
  const hasSurprise = (e.surprises || 0) > 0;
  const total = (e.gifts || 0) + (e.surprises || 0);
  const kind = hasSurprise ? 'surprise' : 'gift';
  // 素材消息：库里的最后一条；类型不符/缺失时兜底空内容（动画与弹窗仍可播）
  const msg = (lastMsg && lastMsg.type === kind)
    ? lastMsg
    : { id: 'pending', charId: c.id, from: 'them', type: kind, time: Date.now(), content: {} };
  // 20260929ax：进聊天页看到动画即算「看过」——先清未读再播动画。
  // 此前等「打开礼物」交互完成才清，玩家不点开 ⇒ 未读红点一直挂着（列表/加号都不灭）。
  await _ocClearUnreadFor(c.id);
  refreshUnreadBadges();
  renderChatList();
  await _ocPlayIncoming(c, msg);
  // 播完后再看是否还有其他未读（>1 条时提示）
  const remain = Math.max(0, total - 1);
  if (remain > 0) {
    showTopBanner(`还有 ${remain} 个超频未读<div class="tb-sub">礼物与惊喜已收纳，可在聊天记录中查看</div>`, { dur: 3600 });
  }
}

/* 全局动画互斥队列（20260929au）：礼物/惊喜全屏动画同一时间只播一个，
   防止多访客同时触发导致动画叠加、界面卡死 */
let _ocAnimChain = Promise.resolve();
function _ocAnimQueue(run) {
  const p = _ocAnimChain.then(run);
  _ocAnimChain = p.catch(() => {});
  return p;
}

/* 进入访客聊天页：处理挂起的超频动画与未读 */
async function _ocOnEnterChat(c) {
  if (!c) return;
  // 20260929be：外部页面挂起的「首次惊喜完整流程」——进入该访客聊天页时补播
  try {
    const pending = await getSetting('pendingFirstSurprise', null);
    if (pending && pending.charId === c.id && pending.s) {
      await setSetting('pendingFirstSurprise', null);
      await _ocClearUnreadFor(c.id);
      await _ocShowFirstSurpriseFlow(c, pending.s);
      return;
    }
  } catch (err) {}
  const e = _unreadEvents[c.id];
  // 进入聊天页即视为已读普通消息（清除 msgs 计数，避免「超过10条」横幅在下次重复触发）
  if (e && e.msgs) { e.msgs = 0; await _saveUnreadEvents(); }
  const total = e ? ((e.gifts || 0) + (e.surprises || 0)) : 0;
  if (total > 0) {
    // 有未读：取最后一条礼物/惊喜消息做动画素材（惊喜优先），播完细窗提示剩余
    let lastMsg = null;
    try {
      const all = await idbGetMessagesByChar(c.id, 100000);
      const ocMsgs = all.filter(x => x.from === 'them' && (x.type === 'gift' || x.type === 'surprise') && !x.groupId);
      lastMsg = ocMsgs.length ? ocMsgs[ocMsgs.length - 1] : null;
    } catch (err) {}
    _ocPlayPendingAnim(c, lastMsg).catch(() => {});
  }
  // 无论有无未读都刷新红点
  refreshUnreadBadges();
}

/* 进入访客聊天页：处理挂起的书信（只播一次开信动画） */
async function _letterOnEnterChat(c) {
  if (!c) return;
  const e = _unreadEvents[c.id];
  if (!e || !(e.letters > 0)) return;
  const count = e.letters;
  // 清空该访客未读书信计数
  e.letters = 0;
  await _saveUnreadEvents();
  refreshUnreadBadges();
  // 取该访客最新一封未读书信播开信动画（只播一次）
  try {
    const all = await idbGetMessagesByChar(c.id, 100000);
    const unreadLetters = all.filter(x => x.type === 'letter' && x.from === 'them' && !x.read && !x.groupId);
    const latest = unreadLetters.length ? unreadLetters[unreadLetters.length - 1] : null;
    if (latest) {
      openLetterOverlay(latest, c);
    }
    // 有多封时细窗提示
    if (count > 1) {
      showTopBanner(`还有 ${count - 1} 封信未读<div class="tb-sub">点左侧「信箱」查看全部往来</div>`, { dur: 3600 });
    }
  } catch (err) {}
}

/* 惊喜送达大字弹窗（20260929au）：无背景遮罩，大字直接弹到屏幕中央，PC 适配 */
/* 惊喜送达大字弹窗（20260929aw 重构）：深紫渐变卡片背景（参考睡眠 App 视觉），
   布局参考「梦界」：胶囊标签 → 逐字打出的大字（打字机）→ 正文；点击任意处关闭 */
function _ocShowSurpriseBigText(s, opts = {}) {
  // 移除旧的
  const old = document.getElementById('oc-surprise-big');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'oc-surprise-big';
  const big = String((s && s.big) || '！');
  const sub = `${String((s && s.act) || '')}，决定跨越维度，${String((s && s.move) || '')}`;
  el.innerHTML = `
    <div class="ocsb-card">
      ${opts.head ? `<div class="ocsb-head">${escapeHtml(opts.head)}</div>` : ''}
      <div class="ocsb-tag">✨ 惊喜</div>
      <div class="ocsb-main"><span class="ocsb-type"></span><span class="ocsb-caret">|</span></div>
      <div class="ocsb-sub">${escapeHtml(sub)}</div>
      <div class="ocsb-hint">点按任意处继续</div>
    </div>`;
  document.body.appendChild(el);
  // 20260929bc：巨大红字震动摇晃 + 低频警示音效
  _ocPlaySurpriseBuzz();
  // 打字机：大字逐字打出；20260929bb：打完光标立即隐去（此前多留 1.8s 的「文字+空隙+光标」
  // 被看成多打了一个空格），光标贴紧文字（补偿字距）
  const typeEl = el.querySelector('.ocsb-type');
  const caret = el.querySelector('.ocsb-caret');
  let i = 0;
  const timer = setInterval(() => {
    i++;
    typeEl.textContent = big.slice(0, i);
    if (i >= big.length) {
      clearInterval(timer);
      if (caret) caret.style.display = 'none';
    }
  }, 150);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => {
    clearInterval(timer);
    clearTimeout(el._t);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 380);
    if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (e) {} }
  };
  el.onclick = close;
  el._t = setTimeout(close, 1200 + big.length * 150 + 2600);
}

/* ============================================================
   礼物打开体验（20260929ap）：打开动画 + 紫色星际详情弹窗
   ============================================================ */

/* 礼物消息卡片点击分流 */
async function _ocHandleGiftCardClick(m) {
  const gc = m.content || {};
  const fromChar = m.from === 'them' || gc.direction === 'char_to_me';
  const c = characters.find(x => x.id === m.charId);
  const isOpened = gc.opened !== false;
  if (fromChar && !isOpened) {
    // 首次打开：开箱动画 → opened 双写 → 星际详情弹窗（20260929av 抽出复用）
    await _ocOpenGiftFlow(m, gc);
    return;
  }
  // 已开过/玩家自己送出：直接查看详情，不再播放开箱动画
  const who = fromChar ? ((c ? c.name : 'TA') + ' 送来的礼物') : '你送出的礼物';
  _ocShowGiftModal(gc, { head: who, foot: timeAgoStr(m.time) });
}

/* 礼物盒开箱动画：首次打开播放；调用方只在 opened=false 时进入。
   20260929at 重构：礼物图预置在「盒口裁剪容器」内（藏在盒身之后），
   点击打开后盒盖掀起、礼物从盒口里升出（裁剪保证升起前完全不可见，无穿模）
   20260929bb：传入 reuse={layer,box}（跳出动画保留的同一个盒子）时不再新建场景——
   直接在原层上把盒子形变为开箱盒（同一 DOM 连续动画，无关闭/重开间隙） */
function _ocPlayOpenGiftAnim(gc, reuse) {
  return new Promise(resolve => {
    const img = _ocGiftImgOf(gc);
    if (reuse && reuse.layer && reuse.box) {
      const layer = reuse.layer, box = reuse.box;
      layer.classList.add('oc-unbox-mode');
      box.classList.remove('oc-burst-box');
      box.classList.add('oc-unbox-box', 'oc-unbox-closed', 'oc-unbox-morph');
      // 礼物图补入（跳出阶段未带图时）
      if (img && !box.querySelector('.oc-unbox-gift')) {
        const clip = box.querySelector('.oc-unbox-giftclip');
        if (clip) clip.innerHTML = `<img class="oc-unbox-gift" src="${imgSrc(img)}" alt="">`;
      }
      const openBtn = document.createElement('button');
      openBtn.className = 'btn primary oc-unbox-open-btn';
      openBtn.type = 'button';
      openBtn.textContent = '打开礼物';
      layer.appendChild(openBtn);
      try { playDing(); } catch (e) {}
      openBtn.onclick = () => {
        openBtn.remove();
        box.classList.remove('oc-unbox-closed');
        box.classList.add('oc-unbox-opened');
        setTimeout(() => { layer.remove(); resolve(); }, 1500);
      };
      return;
    }
    const layer = document.createElement('div');
    layer.className = 'oc-unbox-scene';
    layer.innerHTML = `<div class="oc-unbox-glow"></div>
      <div class="oc-unbox-box oc-unbox-closed">
        <div class="oc-unbox-base"></div>
        <div class="oc-unbox-giftclip">${img ? `<img class="oc-unbox-gift" src="${imgSrc(img)}" alt="">` : ''}</div>
        <div class="oc-unbox-lid"></div>
      </div>
      <button class="btn primary oc-unbox-open-btn" type="button">打开礼物</button>`;
    document.body.appendChild(layer);
    const box = layer.querySelector('.oc-unbox-box');
    const openBtn = layer.querySelector('.oc-unbox-open-btn');
    openBtn.onclick = () => {
      openBtn.remove();
      box.classList.remove('oc-unbox-closed');
      box.classList.add('oc-unbox-opened');
      setTimeout(() => { layer.remove(); resolve(); }, 1500);
    };
    try { playDing(); } catch(e) {}
  });
}

/* 礼物图片兜底（20260929aq）：旧记录/旧消息没存图时，按 giftId 回查预设库（修复初始项链显示礼盒 emoji 的问题） */
function _ocGiftImgOf(g) {
  if (g && g.giftImg) return g.giftImg;
  const id = g && (g.giftId || g.id);
  const p = OVERCLOCK_GIFTS.find(x => x.id === id);
  return (p && p.img) || (g && g.img) || '';
}

/* 紫色星际宇宙感礼物详情弹窗（20260929aq：玻璃拟态面板 + 收窄，参考紫色星空 App 视觉） */
function _ocShowGiftModal(gc, meta, onClose) {
  if (_noticeGate) return; // 20260929bk：软件声明未同意期间抑制超频礼物弹窗
  // 20260930cd：进入详情前记录弹窗滚动位（详情会整体替换弹窗内容），关闭返回后恢复
  const prevBox = $('#modal-content');
  const prevList = $('#gc-list');
  const snapSt = prevBox ? prevBox.scrollTop : 0;
  const snapListSt = prevList ? prevList.scrollTop : 0;
  const img = _ocGiftImgOf(gc);
  const imgHtml = img
    ? `<img src="${imgSrc(img)}" style="width:172px;height:172px;object-fit:cover;border-radius:22px;box-shadow:0 0 46px rgba(167,139,250,0.5),0 0 0 1px rgba(255,255,255,0.16) inset;">
       <div style="margin:12px auto 0;width:150px;height:1px;background:linear-gradient(90deg,transparent,rgba(196,168,255,0.7),transparent);"></div>`
    : '<div style="font-size:72px;">🎁</div>';
  openModal(`
    <div class="oc-star-modal">
      <div class="oc-star-field"></div>
      <div class="oc-star-blob oc-star-blob1"></div>
      <div class="oc-star-blob oc-star-blob2"></div>
      <div style="position:relative;z-index:2;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:16px;font-weight:600;color:rgba(241,234,255,0.96);">${escapeHtml((meta && meta.head) || '礼物详情')}</div>
          <button class="icon-btn" id="ocgm-close" style="color:rgba(230,222,255,0.9);">✕</button>
        </div>
        <div style="text-align:center;padding:14px 0 0;">${imgHtml}</div>
        <div style="text-align:center;font-size:21px;font-weight:750;color:#f4efff;margin-top:16px;letter-spacing:0.5px;">${escapeHtml(gc.giftName || '礼物')}</div>
        ${gc.giftDesc ? `<div style="text-align:center;font-size:16px;color:rgba(238,231,255,0.9);line-height:1.85;margin-top:12px;">${escapeHtml(gc.giftDesc)}</div>` : ''}
        ${gc.note ? `<div style="border-top:1px dashed rgba(255,255,255,0.26);margin:18px 0 12px;"></div>
        <div style="font-size:17px;color:rgba(250,246,255,0.97);line-height:1.9;font-style:italic;text-align:center;min-height:1.9em;">“<span id="ocgm-note-tw"></span>”</div>` : ''}
        ${meta && meta.foot ? `<div style="text-align:center;font-size:13px;color:rgba(230,222,255,0.7);margin-top:14px;">${escapeHtml(meta.foot)}</div>` : ''}
      </div>
    </div>`, { glass: true, narrow: true, noBackdrop: true });
  // 20260929bq：支持自定义关闭回调（礼物柜轻点详情关闭后回到礼物柜牌组，而非直接退出）
  // 20260930cd：关闭回调完成后再恢复进入前的滚动位（onClose 多为 async 重渲染）
  $('#ocgm-close').onclick = async () => {
    if (onClose) await onClose(); else closeModal();
    requestAnimationFrame(() => {
      const box = $('#modal-content');
      if (box && snapSt) box.scrollTop = snapSt;
      const list = $('#gc-list');
      if (list && snapListSt) list.scrollTop = snapListSt;
    });
  };
  // 20260929bb：寄语打字机逐字打出（每个字带轻微上下弹动，打完停止；逐字插入不引入多余空格）
  if (gc.note) _twBounceType($('#ocgm-note-tw'), gc.note, 115);
}

/* 逐字打字（20260929bb）：把文本按字符（含 emoji 代理对）逐个插入，
   每个字符出现时播放一次轻微上下弹动后静止；不追加任何空格。
   返回定时器 id，调用方可 clearInterval 提前终止 */
function _twBounceType(el, text, speed = 115) {
  if (!el) return null;
  el.innerHTML = '';
  const chars = Array.from(String(text == null ? '' : text));
  let i = 0;
  const timer = setInterval(() => {
    if (i >= chars.length) { clearInterval(timer); return; }
    const sp = document.createElement('span');
    sp.className = 'tw-bounce-ch';
    sp.textContent = chars[i];
    el.appendChild(sp);
    i++;
  }, Math.max(40, speed));
  return timer;
}

/* ============================================================
   消息卡片渲染（gift / surprise 类型）
   ============================================================ */

/* 启动超频相关 */
async function startOverclockWatcher() {
  // 旧数据迁移（20260929aq）：补记旧版送出的礼物 + 给旧记录/旧消息补礼物图
  await _ocMigrateGiftData();
  // 首次使用日期记录（兼容保留；第三天判定已改为聊天天数同源）
  await _ocRecordFirstUse();
  // 20260929at：下次触发时刻跨会话持久化——此前 _ocNextAt 只在内存里，每次刷新重置为
  // 20~240 分钟后，短会话永远等不到 ⇒「主动超频一条都收不到」的根源
  try {
    const saved = await _ocGet('nextAt', null);
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) _ocNextAt = saved;
    if (!(await _ocGet('nextAtSeeded', false))) {
      const now = Date.now();
      for (const c of characters) {
        if (!_ocNextAt[c.id]) _ocNextAt[c.id] = now + randInt(2, 6) * 60000; // 首次播种：2~6 分钟内有一次体验
      }
      await _ocSet('nextAtSeeded', true);
      _ocSaveNextAt();
    }
  } catch (e) {}
  // 20260929at：每月金钱补充改为启动时执行——此前只挂在超频触发里，触发断了钱包永不回血，
  // 访客余额不足 ⇒ 红包（转账）与主动送礼全部静默停摆
  try { await _ocMonthlyAllowance(); } catch (e) {}
  // 由 openChat 进入聊天时触发 maybeTriggerOverclockIntro（聊天天数=3）
}

/* 礼物数据迁移（20260929aq，幂等可重复跑）：
   ① ao 旧版玩家送出的礼物只有消息没有礼物柜记录 → 按「charId|时间」去重补写 direction=toChar 记录；
   ② 旧记录/旧消息 giftImg 为空 → 按 giftId 回查预设库补图（含初始项链） */
async function _ocMigrateGiftData() {
  try {
    const msgs = await idbGetAll('messages');
    const recs = await idbGetAll('gifts');
    const have = new Set(recs.filter(r => r.direction === 'toChar').map(r => `${r.charId}|${r.receivedAt}`));
    for (const m of msgs) {
      if (m.type !== 'gift' || m.from !== 'me') continue;
      const gc = m.content || {};
      const img = _ocGiftImgOf({ giftImg: gc.giftImg, giftId: gc.giftId });
      if (!gc.giftImg && img) { gc.giftImg = img; await idbPut('messages', m); }
      if (!have.has(`${m.charId}|${m.time}`)) {
        await idbPut('gifts', {
          id: uid('gift'), charId: m.charId, giftId: gc.giftId || '', giftName: gc.giftName || '礼物',
          giftDesc: gc.giftDesc || '', giftImg: img || '', note: gc.note || '', noteFrom: 'me',
          receivedAt: m.time, isInitial: false, direction: 'toChar', opened: true, price: gc.price || 0,
        });
      }
    }
    const fresh = await idbGetAll('gifts');
    for (const r of fresh) {
      const img = _ocGiftImgOf(r);
      if (!r.giftImg && img) { r.giftImg = img; await idbPut('gifts', r); }
    }
  } catch (e) { console.error('[白日梦] 礼物数据迁移异常', e); }
}

/* 启动 */
init();
