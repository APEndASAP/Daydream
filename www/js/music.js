/* ============================================================
   《白日梦》- 音乐功能（20261103）
   三模式互斥：镜像搜索 / 后台遥控（仅 App，占位）/ 本地与解析
   纯单机无服务器：用公开音乐镜像站听歌（Meting 主源 + 多源容灾）
   本文件独立于 app.js，通过 window.bmMusic 挂载，app.js 调用 bmMusic.xxx()
   ============================================================ */

window.bmMusic = (function () {

  /* ---------- 音源配置（多源容灾，玩家可在设置里选路径） ---------- */
  const SOURCES = [
    // 20261104 新主源：music-api.gdstudio.xyz（网易云），搜索/播放直链/歌词三接口均稳定，
    //   返回格式规范（id/name/artist[]/album/pic_id/url_id/lyric_id）。qijieya 搜索接口间歇性返回空数组
    //   （"前面顺畅、现在全坏"的根因），故 gdstudio 提到最前做主源，qijieya 降为备选。
    {
      key: 'gdstudio',
      name: '镜像路径 A（网易云·已失效 20261105）',
      search: (kw) => `https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=${encodeURIComponent(kw)}&count=20`,
      song: (song) => `https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=${encodeURIComponent(song.id)}&br=128`,
      lrc: (song) => `https://music-api.gdstudio.xyz/api.php?types=lyric&source=netease&id=${encodeURIComponent(song.id)}`,
      parseSearch: (j) => Array.isArray(j) ? j.map(x => {
        const artist = Array.isArray(x.artist) ? x.artist.join('/') : (x.artist || '');
        return {
          id: String(x.id || x.url_id || ''),
          name: x.name || x.title || '',
          artist: artist,
          album: x.album || '',
          pic: '',   // gdstudio 未直接给封面 url，留空，播放时可按需再取
          url: '',   // 播放时用 types=url 单独取直链
          lrc: '',
        };
      }).filter(x => x.name) : [],
      parseSong: (j) => (j && j.url) ? { url: j.url, pic: '', lrc: '' } : null,
      parseLrc: (j) => (j && j.lyric) ? j.lyric : (typeof j === 'string' ? j : ''),
    },
    // 20261104 新增：清羽 Meting API（met.liiiu.cn），标准 Meting 格式（title/author/pic/url/lrc），
    //   搜索+直链+歌词一步到位，直链 302 到 music.126.net 真实 mp3，作为新的稳定网易云镜像备选。
    {
      key: 'qingyu',
      name: '镜像路径 A（网易云·清羽·默认）',
      search: (kw) => `https://met.liiiu.cn/meting/api?server=netease&type=search&id=${encodeURIComponent(kw)}&limit=20`,
      song: (song) => `https://met.liiiu.cn/meting/api?server=netease&type=url&id=${encodeURIComponent(song.id)}`,
      lrc: (song) => `https://met.liiiu.cn/meting/api?server=netease&type=lrc&id=${encodeURIComponent(song.id)}`,
      parseSearch: (j) => Array.isArray(j) ? j.map(x => {
        let id = x.id || '';
        if (!id && x.url) { try { id = new URL(x.url, 'https://x').searchParams.get('id') || ''; } catch (e) {} }
        return {
          id: id,
          name: x.title || x.name || '',
          artist: x.author || x.artist || '',
          album: x.album || '',
          pic: x.pic || '',
          url: x.url || '',
          lrc: x.lrc || '',
        };
      }).filter(x => x.name) : [],
      parseSong: (j) => (j && j.url) ? { url: j.url, pic: '', lrc: '' } : (typeof j === 'string' && j ? { url: j, pic: '', lrc: '' } : null),
      parseLrc: (j) => (j && j.lrc) ? j.lrc : (typeof j === 'string' ? j : ''),
    },
    // 主源：qijieya Meting 镜像（网易云），搜索一步返回 url/lrc/pic，带 CORS，长期稳定
    {
      key: 'qijieya',
      name: '镜像路径 A（网易云·已失效 20261105）',
      search: (kw) => `https://api.qijieya.cn/meting/?type=search&id=${encodeURIComponent(kw)}&limit=20&server=netease`,
      song: (song) => `https://api.qijieya.cn/meting/?server=netease&type=url&id=${encodeURIComponent(song.id)}`,
      lrc: (song) => `https://api.qijieya.cn/meting/?server=netease&type=lrc&id=${encodeURIComponent(song.id)}`,
      parseSearch: (j) => Array.isArray(j) ? j.map(x => {
        // qijieya 的 id 藏在 url 参数里
        let id = x.id || '';
        if (!id && x.url) { try { id = new URL(x.url, 'https://x').searchParams.get('id') || ''; } catch (e) {} }
        return {
          id: id,
          name: x.name || x.title || '',
          artist: x.artist || x.singer || '',
          album: x.album || '',
          pic: x.pic || '',
          url: x.url || '',
          lrc: x.lrc || '',
        };
      }).filter(x => x.name) : [],
      parseSong: (j) => {
        // type=url 返回 302 跳转，实际 fetch 会跟随到 mp3；这里兼容返回对象或字符串
        if (j && j.url) return { url: j.url, pic: '', lrc: '' };
        if (typeof j === 'string' && j) return { url: j, pic: '', lrc: '' };
        return null;
      },
      parseLrc: (j) => (j && j.lrc) ? j.lrc : (typeof j === 'string' ? j : ''),
    },
    // 副源：tang s01s（QQ 音乐开放接口），长期维护
    {
      key: 'tang',
      name: '路径 B（QQ 音乐）',
      search: (kw) => `https://tang.api.s01s.cn/music_open_api.php?msg=${encodeURIComponent(kw)}&type=json`,
      song: (song) => `https://tang.api.s01s.cn/music_open_api.php?msg=${encodeURIComponent(song.name || song.id)}&type=json&n=1`,
      lrc: (song) => `https://tang.api.s01s.cn/music_open_api.php?msg=${encodeURIComponent(song.name || song.id)}&type=json&n=1`,
      parseSearch: (j) => {
        const arr = Array.isArray(j) ? j : (Array.isArray(j && j.data) ? j.data : []);
        return arr.map(x => ({
          id: x.song_mid || x.songid || x.id || '',
          name: x.song_title || x.name || x.title || '',
          artist: x.singer_name || x.singer || x.artist || '',
          album: x.album_name || x.album || '',
          pic: x.pic || x.cover || '',
          url: x.url || x.song_url || '',
          lrc: x.lrc || '',
        })).filter(x => x.name);
      },
      parseSong: (j) => { const d = Array.isArray(j) ? j[0] : (j && (j.data && j.data[0])); return d ? { url: d.url || d.song_url || d.playUrl || '', pic: d.pic || '', lrc: '' } : null; },
      parseLrc: (j) => { const d = Array.isArray(j) ? j[0] : (j && (j.data && j.data[0])); return (d && d.lrc) || ''; },
    },
    // 副源：酷我（oiapi），搜索列表 + 详情接口分开
    {
      key: 'kuwo',
      name: '路径 C（酷我音乐）',
      search: (kw) => `https://oiapi.net/api/Kuwo?msg=${encodeURIComponent(kw)}&page=1&limit=20`,
      // 详情：msg=歌名（酷我详情接口用歌名查，不是 rid）& n=1 & br=128（mp3，兼容性最好；br=1 返回 flac 浏览器不支持）
      song: (song) => `https://oiapi.net/api/Kuwo?msg=${encodeURIComponent(song.name || song.id)}&n=1&br=128`,
      lrc: (song) => `https://oiapi.net/api/Kuwo?msg=${encodeURIComponent(song.name || song.id)}&n=1&br=128`,
      parseSearch: (j) => {
        const arr = Array.isArray(j && j.data) ? j.data : [];
        return arr.map(x => ({
          id: x.rid || x.songid || '',
          name: x.song || x.name || '',
          artist: x.singer || x.artist || '',
          album: x.album || '',
          pic: x.picture || x.pic || '',
          url: '',
          lrc: '',
        })).filter(x => x.name);
      },
      parseSong: (j) => { const d = j && j.data; return d ? { url: d.url || '', pic: d.picture || '', lrc: d.lyric || d.lrc || '' } : null; },
      parseLrc: (j) => {
        // 酷我歌词可能在 data.lyric 或 data 顶层，兼容多种结构
        if (!j) return '';
        if (j.data && (j.data.lyric || j.data.lrc)) return j.data.lyric || j.data.lrc;
        if (typeof j.lyric === 'string') return j.lyric;
        return '';
      },
    },
    // 副源：iTunes Search API（国际曲库，英文/海外歌）
    // 20261106：iTunes 只给 30 秒试听（previewUrl），非「完整音源」，不符合「优先能播整首歌」需求，
    //   故 full:false 标记，自动容灾时不再参与匹配（仅玩家手动选「iTunes」源时才用）。
    {
      key: 'itunes',
      name: '路径 D（iTunes 国际·30秒试听）',
      full: false,
      search: (kw) => `https://itunes.apple.com/search?term=${encodeURIComponent(kw)}&media=music&limit=20`,
      song: (song) => `https://itunes.apple.com/lookup?id=${encodeURIComponent(song.id)}`,
      lrc: () => '',
      parseSearch: (j) => {
        const arr = Array.isArray(j && j.results) ? j.results : [];
        return arr.filter(x => x.kind === 'song' || x.wrapperType === 'track').map(x => ({
          id: String(x.trackId || ''),
          name: x.trackName || '',
          artist: x.artistName || '',
          album: x.collectionName || '',
          pic: (x.artworkUrl100 || '').replace('100x100', '300x300'),
          url: x.previewUrl || '',   // iTunes 提供 30 秒试听
          lrc: '',
        })).filter(x => x.name);
      },
      parseSong: (j) => { const d = j && j.results && j.results[0]; return d ? { url: d.previewUrl || '', pic: (d.artworkUrl100 || '').replace('100x100', '300x300'), lrc: '' } : null; },
      parseLrc: () => '',
    },
    // 官方 Meting API（api.i-meto.com），字段名 title/author，返回 url/lrc/pic 带 auth 签名（有时效，须实时使用）
    {
      key: 'meting',
      name: '路径 E（Meting 官方）',
      search: (kw) => `https://api.i-meto.com/meting/api?server=netease&type=search&id=${encodeURIComponent(kw)}&limit=20`,
      song: (song) => `https://api.i-meto.com/meting/api?server=netease&type=url&id=${encodeURIComponent(song.id || song.name)}`,
      lrc: (song) => `https://api.i-meto.com/meting/api?server=netease&type=lrc&id=${encodeURIComponent(song.id || song.name)}`,
      parseSearch: (j) => Array.isArray(j) ? j.map(x => {
        let id = x.id || '';
        if (!id && x.url) { try { id = new URL(x.url, 'https://x').searchParams.get('id') || ''; } catch (e) {} }
        return {
          id: id,
          name: x.title || x.name || '',
          artist: x.author || x.artist || '',
          album: x.album || '',
          pic: x.pic || '',
          url: x.url || '',
          lrc: x.lrc || '',
        };
      }).filter(x => x.name) : [],
      parseSong: (j) => (j && j.url) ? { url: j.url, pic: '', lrc: '' } : (typeof j === 'string' && j ? { url: j, pic: '', lrc: '' } : null),
      parseLrc: (j) => (j && j.lrc) ? j.lrc : (typeof j === 'string' ? j : ''),
    },
  ];

  /* ---------- 播放器状态 ---------- */
  const state = {
    mode: 'mirror',            // 'mirror' 镜像搜索 | 'remote' 后台遥控（占位）| 'local' 本地与解析
    playing: false,
    current: null,             // 当前曲目 {id,name,artist,album,pic,url,lrc}
    lyrics: '',                // 原始 LRC 文本
    audio: null,               // HTMLAudioElement
    charId: null,              // 一起听歌的角色 id（null=单人）
    togetherSince: 0,          // 一起听歌开始时间戳
    playlist: [],              // 当前播放列表
    playIndex: -1,
    floatState: 'dot',         // 'dot' | 'mini' | 'card' 悬浮窗三级
    listenSec: 0,              // 本次累计听歌秒数
    playMode: 'order',         // 播放模式：'once' 顺序播放(播完停) | 'order' 列表循环 | 'one' 单曲循环 | 'shuffle' 随机
    crossfade: false,          // 20261106：智能过渡（交叉淡入淡出）开关，默认关
    loadedId: null,            // 20261105：state.audio 当前加载的曲目 id（根治续播 src 匹配失败）
  };

  function isApp() {
    return !!(window.Capacitor && window.Capacitor.Plugins);
  }

  /* ---------- 网络请求（带超时） ---------- */
  async function _fetchJSON(url, timeout = 8000) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    try {
      const r = await fetch(url, { signal: ctrl ? ctrl.signal : undefined });
      if (t) clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (t) clearTimeout(t);
      return null;
    }
  }

  /* 跟随 302 拿到最终 mp3 直链（Meting 的 type=url 是转发地址，audio 直接吃转发地址在部分 WebView 里不跟随） */
  async function _resolveUrl(url, timeout = 8000) {
    if (!url) return '';
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
      const r = await fetch(url, { signal: ctrl ? ctrl.signal : undefined, redirect: 'follow' });
      if (t) clearTimeout(t);
      // fetch 跟随 302 后 r.url 是最终地址；拿不到时回退原 url
      return r.url || url;
    } catch (e) { return url; }
  }
  /* 拉歌词文本（Meting 的 type=lrc 转发地址会 302 到纯文本 LRC） */
  async function _fetchText(url, timeout = 8000) {
    if (!url) return '';
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
      const r = await fetch(url, { signal: ctrl ? ctrl.signal : undefined, redirect: 'follow' });
      if (t) clearTimeout(t);
      if (!r.ok) return '';
      return await r.text();
    } catch (e) { return ''; }
  }

  /* ---------- 搜索（多源容灾，玩家可选路径） ---------- */
  // 自定义音源（玩家粘贴的 Meting 兼容 API 地址），存 localStorage
  function getCustomSources() {
    try {
      const raw = localStorage.getItem('bmCustomMusicSources');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function addCustomSource(name, baseUrl) {
    const arr = getCustomSources();
    arr.push({ id: 'c' + Date.now(), name, baseUrl });
    try { localStorage.setItem('bmCustomMusicSources', JSON.stringify(arr)); } catch (e) {}
    return arr;
  }
  function removeCustomSource(id) {
    const arr = getCustomSources().filter(s => s.id !== id);
    try { localStorage.setItem('bmCustomMusicSources', JSON.stringify(arr)); } catch (e) {}
    return arr;
  }
  // 把自定义源转成 SOURCE 结构（Meting 兼容：baseUrl 里 {kw} 占位搜索词）
  function customToSource(c) {
    const mk = (url, kw, id) => url.replace('{kw}', encodeURIComponent(kw)).replace('{id}', encodeURIComponent(id));
    return {
      key: c.id,
      name: c.name,
      custom: true,
      search: (kw) => mk(c.baseUrl, kw, ''),
      song: (song) => mk(c.baseUrl, '', song.id),
      lrc: () => '',
      parseSearch: (j) => Array.isArray(j) ? j.map(x => {
        let id = x.id || '';
        if (!id && x.url) { try { id = new URL(x.url, 'https://x').searchParams.get('id') || ''; } catch (e) {} }
        return { id, name: x.name || x.title || '', artist: x.artist || x.singer || '', album: x.album || '', pic: x.pic || '', url: x.url || '', lrc: x.lrc || '' };
      }).filter(x => x.name) : [],
      parseSong: (j) => (j && j.url) ? { url: j.url, pic: '', lrc: '' } : null,
      parseLrc: (j) => (j && j.lrc) ? j.lrc : (typeof j === 'string' ? j : ''),
    };
  }

  // 玩家选定音源路径：'auto'=自动容灾，或某个源的 key
  async function getActiveSources() {
    let pick = 'auto';
    try { pick = await getSetting('musicSource', 'auto'); } catch (e) {}
    const custom = getCustomSources().map(customToSource);
    const all = [...SOURCES, ...custom];
    if (pick && pick !== 'auto') {
      const hit = all.find(s => s.key === pick);
      if (hit) return [hit];
    }
    // auto 容灾优先级（20261105 实测修正）：清羽(met.liiiu.cn，搜索一步返回 title/author/pic/url/lrc，稳定) 提到最前
    //   > 酷我 > QQ。
    // 20261105 实测失效：qijieya(api.qijieya.cn) 返回空数组 []；gdstudio(music-api.gdstudio.xyz) HTTP 000 连接失败
    //   ——两者已移出默认容灾顺序（仍可通过手动选源使用），避免每次容灾空耗请求、且搜索不到封面。
    // 20261104：官方 meting(api.i-meto.com) 已 401 挂掉，移出默认容灾顺序。
    // 20261106：自动匹配优先「完整音源」渠道——iTunes 只给 30 秒试听（full:false），不参与自动容灾，
    //   避免自动匹配到 30 秒试听导致「只能听一段」。iTunes 仅在玩家手动选源时使用。
    const order = ['qingyu', 'kuwo', 'tang'];
    const sorted = order.map(k => all.find(s => s.key === k)).filter(Boolean);
    // 追加任何不在 order 里的源（如自定义源）；但 full:false 的 30 秒试听源(iTunes)自动模式跳过
    all.forEach(s => { if (order.indexOf(s.key) < 0 && s.full !== false) sorted.push(s); });
    return sorted;
  }

  async function search(keyword) {
    if (!keyword) return [];
    const sources = await getActiveSources();
    for (const src of sources) {
      try {
        const j = await _fetchJSON(src.search(keyword));
        const list = src.parseSearch(j);
        if (list && list.length) return list;
      } catch (e) { /* 换下一个源 */ }
    }
    return [];
  }

  /* ---------- 跨闭包桥接（方案A）：闭包2 的网易云直连函数注入到这里 ----------
     20261106 修复根因：fetchSongDetail/_netEaseLyric 在闭包1（bmMusic），
     而 _netEaseSongUrl/_netEaseReq 等网易云直连函数在闭包2（bmMusicUI），
     跨闭包调用直接 ReferenceError → 导入歌单无法播放、漫游/每日推荐/角色搜歌选歌全崩。
     方案A：闭包2 初始化时把网易云直连函数注入到这里，闭包1 经代理调用。 */
  let _neteaseBridgeFns = null;
  function setNeteaseBridge(fns) { _neteaseBridgeFns = fns || null; }
  // 代理：优先用注入的网易云直连函数；未注入（闭包2 尚未初始化）时返回空，绝不抛 ReferenceError
  async function _netEaseReq(url) {
    if (_neteaseBridgeFns && _neteaseBridgeFns._netEaseReq) return _neteaseBridgeFns._netEaseReq(url);
    return null;
  }
  async function _netEaseSongUrl(id) {
    if (_neteaseBridgeFns && _neteaseBridgeFns._netEaseSongUrl) return _neteaseBridgeFns._netEaseSongUrl(id);
    return { url: null };
  }

  /* ---------- 获取单曲详情（播放直链 + 封面 + 歌词） ---------- */
  // 20261105：直连拿网易云歌词（官方接口，需 MUSIC_U 登录态）
  // 20261107 修复「英文/韩文歌只有原文、没有中文翻译」：网易云歌词接口返回里，
  //   lrc.lyric 是原文、tlyric.lyric 是翻译（中文）。之前只取了 lrc.lyric，丢了翻译。
  //   现在把原文+翻译按时间戳合并成「原文行 + 翻译行」交替的双语 LRC，播放器滚动时
  //   每句歌词显示两行（上行原文、下行中文翻译），与网易云 App 官方双语歌词一致。
  async function _netEaseLyric(id) {
    if (!id) return '';
    try {
      const j = await _netEaseReq('https://music.163.com/api/song/lyric?id=' + id + '&lv=1&kv=1&tv=-1');
      if (!j || !j.lrc || !j.lrc.lyric) return '';
      const orig = String(j.lrc.lyric || '');
      const trans = (j.tlyric && j.tlyric.lyric) ? String(j.tlyric.lyric) : '';
      if (!trans || !trans.trim()) return orig;   // 无翻译（中文歌）直接返回原文
      // 解析翻译行：只保留带时间戳且时间戳能精确匹配原文的行
      const tLine = new Map();   // 时间戳字符串 -> 翻译文本
      const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      trans.split('\n').forEach(line => {
        const m = line.match(re);
        const text = line.replace(re, '').trim();
        if (!m || !text) return;
        tLine.set(m[0], text);
      });
      // 遍历原文行，遇到「有对应翻译」的时间戳就在原文行后补一行翻译
      const out = [];
      orig.split('\n').forEach(line => {
        out.push(line);
        const m = line.match(re);
        const text = line.replace(re, '').trim();
        if (!m || !text) return;
        const tr = tLine.get(m[0]);
        if (tr) out.push(`${m[0]}${tr}`);
      });
      return out.join('\n');
    } catch (e) { return ''; }
  }
  async function fetchSongDetail(song) {
    // 20261105 修复「导入歌单无法播放」：netease-direct 源（导入的网易云歌单歌曲，
    //   url 为空、带 _neteaseId）必须走网易云官方接口拿真实直链 + 封面 + 滚动歌词，
    //   不能落回镜像源（镜像源搜不到网易云 id，导致「未获取到播放直链」）。
    if (song && song._neteaseId && ((song.source === 'netease-direct') || !song.url)) {
      const id = String(song._neteaseId);
      const u = await _netEaseSongUrl(id);
      if (u && u.url) {
        song.url = u.url;
        if (!song.pic) {
          // 封面缺失时从网易云歌曲详情接口补 picUrl（http 转 https）
          try {
            const dj = await _netEaseReq('https://music.163.com/api/song/detail?ids=[' + id + ']');
            const s0 = dj && dj.songs && dj.songs[0];
            if (s0 && s0.album && s0.album.picUrl) song.pic = String(s0.album.picUrl).replace(/^http:\/\//i, 'https://');
          } catch (e) {}
        }
        if (song.pic) song.pic = String(song.pic).replace(/^http:\/\//i, 'https://');
        if (!song.lrc) { const lrc = await _netEaseLyric(id); if (lrc) song.lrc = lrc; }
        song.source = 'netease-direct';
        return song;
      }
      // 直连拿不到（无登录态/VIP），再落回镜像源按名搜兜底
    }
    const sources = await getActiveSources();
    for (const src of sources) {
      try {
        // 搜索已带 url 时（Meting 系一步返回），复用但必须解析「转发地址」拿到真实 mp3 直链 + 歌词文本
        if (song.url && (src.key === 'qijieya' || src.key === 'meting' || src.key === 'qingyu')) {
          // song.url 是 type=url 转发地址 → 跟随 302 拿真实 mp3 直链
          const real = await _resolveUrl(song.url);
          // 20261104 容灾：若 qijieya 转发地址解析后仍是转发地址（未跟到真实 mp3），
          // 换 injahow 镜像再试一次（injahow url 接口稳定，独立域名，互备）
          if (real && real.indexOf('music.126.net') < 0 && real.indexOf('.mp3') < 0 && src.key === 'qijieya') {
            const inj = await _resolveUrl(`https://api.injahow.cn/meting/?server=netease&type=url&id=${encodeURIComponent(song.id)}`);
            if (inj && (inj.indexOf('music.126.net') >= 0 || inj.indexOf('.mp3') >= 0)) song.url = inj;
            else song.url = real;
          } else if (real) {
            song.url = real;
          }
          // song.lrc 是 type=lrc 转发地址 → 跟随拿 LRC 文本
          if (!song.lrc || song.lrc.indexOf('type=lrc') >= 0) {
            const txt = await _fetchText(src.lrc(song));
            if (txt) song.lrc = txt;
          }
          return song;
        }
        const j = await _fetchJSON(src.song(song));
        const d = src.parseSong(j);
        if (d && d.url) {
          song.url = d.url;
          if (d.pic) song.pic = d.pic;
          // 歌词单独拉（Meting 系 lrc 转发地址用文本抓取，其余用 JSON 解析）
          const lrc = await _fetchLrcText(src, song);
          if (lrc) song.lrc = lrc;
          return song;
        }
      } catch (e) { /* 换下一个源 */ }
    }
    return song;
  }

  // 统一拉歌词：优先按「转发地址文本」抓，失败再走 JSON 解析
  async function _fetchLrcText(src, song) {
    try {
      // 若 lrc 接口返回的是转发地址（Meting），直接抓文本
      const lj = await _fetchJSON(src.lrc(song));
      if (typeof lj === 'string' && lj) return lj;   // 已经是 LRC 文本
      const parsed = src.parseLrc(lj);
      if (parsed) return parsed;
    } catch (e) {}
    return '';
  }

  /* ---------- 本地曲库（模式三） ---------- */
  // source 过滤：'mirror'=镜像搜索收藏（玩家，全局共通） / 'local'=本地上传（玩家，全局共通）
  //              'visitor'=角色收藏（跟 charId 走，需传 charId 过滤）；不传=全部
  async function getLocalLibrary(source, charId) {
    try {
      const all = await idbGetAll('musicHistory');
      let list = (all || []).filter(x => x.kind === 'local');
      if (source) list = list.filter(x => (x.source || 'local') === source);
      // 20261104 数据隔离：角色收藏（visitor）按 charId 隔离；玩家收藏（mirror/local）全局共通不过滤
      if (source === 'visitor') {
        if (charId) list = list.filter(x => x.charId === charId);
        else list = [];   // 未指定角色时，访客收藏不展示（避免串角色）
      }
      return list;
    } catch (e) { return []; }
  }

  async function addLocalTrack(meta) {
    // meta: { id, name, artist, url, pic, lrc, source?('mirror'|'local'|'visitor'), charId?, blob? }
    try {
      const rec = Object.assign({ id: meta.id || uid('mh'), kind: 'local', source: meta.source || 'local', createdAt: Date.now() }, meta);
      await idbPut('musicHistory', rec);
      return rec;
    } catch (e) { return null; }
  }

  /* ---------- 歌单链接解析（本地与解析模式） ---------- */
  // 从分享链接/文本提取 { platform, id }；支持网易云、QQ音乐、酷我、酷狗、咪咕
  function parsePlaylistLink(text) {
    if (!text) return null;
    const s = String(text).trim();
    // 网易云：music.163.com/playlist?id=xxx 或 /#/playlist?id=xxx 或 y.music.163.com/m/playlist?id=xxx
    let m = s.match(/(?:music\.163\.com|y\.music\.163\.com)\/[^?#]*playlist[^?#]*[?&/]id=(\d+)/i);
    if (m) return { platform: 'netease', id: m[1] };
    m = s.match(/网易云[^\d]{0,20}?(\d{6,})/);
    if (m) return { platform: 'netease', id: m[1] };
    // 网易云短链 163cn.tv/短码（如 https://163cn.tv/bki4WbMh）——需先展开跳转才能拿到歌单 id
    m = s.match(/163cn\.tv\/([A-Za-z0-9]+)/i);
    if (m) return { platform: 'netease', shortUrl: `https://163cn.tv/${m[1]}`, id: '' };
    // QQ音乐：y.qq.com/n/ryqq/playlist/xxx 或 qq.com ... playlist/xxx 或 taoge?id=xxx
    m = s.match(/y\.qq\.com\/[^?#]*playlist\/(\d+)/i);
    if (m) return { platform: 'tencent', id: m[1] };
    m = s.match(/taoge[?&]id=(\d+)/i);
    if (m) return { platform: 'tencent', id: m[1] };
    // 酷我：kuwo.cn/playlist_detail/xxx
    m = s.match(/kuwo\.cn\/[^?#]*playlist[^?#]*[?&/](\d+)/i);
    if (m) return { platform: 'kuwo', id: m[1] };
    // 酷狗：kugou.com ... /songlist/xxx 或 dj ... id=
    m = s.match(/kugou\.com\/[^?#]*songlist\/([a-zA-Z0-9]+)/i);
    if (m) return { platform: 'kugou', id: m[1] };
    return null;
  }

  /* 展开网易云短链（163cn.tv/xxx → 真实长链，提取歌单 id）
     APK 环境用 CapacitorHttp（原生层请求，不受浏览器 CORS 限制，可跟随 302 拿最终 URL）；
     网页端降级用 unshorten.me（已验证返回 Access-Control-Allow-Origin:*）展开。 */
  async function expandNeteaseShortLink(shortUrl) {
    if (!shortUrl) return '';
    // 1) APK：CapacitorHttp 原生请求，跟随重定向拿最终 URL
    try {
      const cap = (typeof window !== 'undefined') ? (window.CapacitorHttp || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp)) : null;
      if (cap && typeof cap.get === 'function') {
        const res = await cap.get({ url: shortUrl, headers: { 'User-Agent': 'Mozilla/5.0' }, connectTimeout: 8000, readTimeout: 8000 });
        if (res && res.status === 200 && res.url) return res.url;
      }
    } catch (e) {}
    // 2) 网页端：unshorten.me（支持 CORS）展开
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
      const r = await fetch(`https://unshorten.me/json/${encodeURIComponent(shortUrl)}`, { signal: ctrl ? ctrl.signal : undefined });
      if (t) clearTimeout(t);
      if (r.ok) {
        const j = await r.json();
        if (j && j.success && j.resolved_url) return j.resolved_url;
      }
    } catch (e) {}
    // 3) 网页端兜底：直接 fetch 短链（若该短链服务未来开放 CORS，可拿到 r.url）
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
      const r = await fetch(shortUrl, { signal: ctrl ? ctrl.signal : undefined, redirect: 'follow' });
      if (t) clearTimeout(t);
      if (r.url && r.url !== shortUrl) return r.url;
    } catch (e) {}
    return '';
  }
  /* 从「长链」里挖网易云歌单 id（兼容 y.music.163.com/m/playlist?id= 与 music.163.com/playlist?id=） */
  function extractNeteasePlaylistId(url) {
    if (!url) return '';
    const m = String(url).match(/playlist[^?#]*[?&/]id=(\d+)/i);
    return m ? m[1] : '';
  }

  // 抓取歌单歌曲列表（返回 {name, artist, pic, lrc, url} 数组，url/pic 可能为空，播放时再按名搜）
  async function fetchPlaylist(platform, id) {
    try {
      if (platform === 'netease') {
        // 网易云歌单：qijieya Meting playlist 接口（近期搜索/直链接口不稳，playlist 仍可用）
        const j = await _fetchJSON(`https://api.qijieya.cn/meting/?server=netease&type=playlist&id=${encodeURIComponent(id)}`);
        if (Array.isArray(j) && j.length) {
          return j.map(x => ({
            id: 'pl_' + uid('mh'),
            name: x.name || '',
            artist: x.artist || '',
            album: x.album || '',
            pic: '',   // qijieya pic 转发地址已失效，留空，播放时按名重搜
            url: '',   // 播放时按「歌名+歌手」用酷我源搜真实直链
            lrc: '',
            _neteaseId: extractNeteaseId(x),
          })).filter(x => x.name);
        }
      }
      // 其他平台暂未接入歌单接口，返回空
      return [];
    } catch (e) { return []; }
  }
  function extractNeteaseId(x) {
    // 从 qijieya 的 url/lrc 转发地址里挖出网易云歌曲 id（用于后续拉歌词）
    const u = x.url || x.lrc || '';
    const m = String(u).match(/id=(\d+)/);
    return m ? m[1] : '';
  }

  async function removeLocalTrack(id) {
    try { await idbDelete('musicHistory', id); } catch (e) {}
  }

  /* ---------- 歌单（kind:'playlist'，tracks=曲目 id 数组） ---------- */
  async function getPlaylists() {
    try {
      const all = await idbGetAll('musicHistory');
      return (all || []).filter(x => x.kind === 'playlist').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    } catch (e) { return []; }
  }

  async function createPlaylist(name, cover) {
    try {
      // 20261105 修复「导入歌单封面不显示」：歌单支持 cover 字段（导入网易云歌单时把封面一起存进来）
      const rec = { id: uid('mh'), kind: 'playlist', name: name, tracks: [], cover: cover || '', createdAt: Date.now() };
      await idbPut('musicHistory', rec);
      return rec;
    } catch (e) { return null; }
  }

  async function removePlaylist(id) {
    try { await idbDelete('musicHistory', id); } catch (e) {}
  }

  /* 往歌单加曲（幂等去重） */
  async function addToPlaylist(playlistId, songId) {
    try {
      const rec = await idbGet('musicHistory', playlistId);
      if (!rec || rec.kind !== 'playlist') return;
      if (!Array.isArray(rec.tracks)) rec.tracks = [];
      if (rec.tracks.indexOf(songId) < 0) { rec.tracks.push(songId); await idbPut('musicHistory', rec); }
    } catch (e) {}
  }

  /* 从歌单移除曲（可批量） */
  async function removeFromPlaylist(playlistId, songIds) {
    try {
      const rec = await idbGet('musicHistory', playlistId);
      if (!rec || rec.kind !== 'playlist') return;
      const ids = Array.isArray(songIds) ? songIds : [songIds];
      rec.tracks = (rec.tracks || []).filter(t => ids.indexOf(t) < 0);
      await idbPut('musicHistory', rec);
    } catch (e) {}
  }

  /* ---------- 播放记录 / Ta的耳机 ---------- */
  async function addHistory(entry) {
    // entry: { kind:'history'|'ear', charId, songId, name, artist, album, pic, ts, listenSec }
    try {
      const rec = Object.assign({ id: uid('mh'), ts: Date.now() }, entry);
      await idbPut('musicHistory', rec);
    } catch (e) {}
  }

  async function getHistory(kind, charId) {
    try {
      const all = await idbGetAll('musicHistory');
      return (all || []).filter(x => x.kind === kind && (!charId || x.charId === charId));
    } catch (e) { return []; }
  }

  /* ---------- 播放控制 ---------- */
  /* 频谱分析（可选增强）：跨域 mp3 无 CORS 头时 createMediaElementSource 会静音，故默认禁用接管，audio 直通保证有声 */
  let _analyser = null, _freqData = null, _analyserReady = true;
  function ensureAnalyser() {
    // 不再用 createMediaElementSource 接管 audio 输出（跨域 mp3 会导致静音，是「修卡死」时改坏的根因）。
    // 频谱节奏数据暂时降级为 0，UI 侧已有降级处理；后续如需节奏动画改用 MediaSession/fetch+decode 方案再单独接入。
    _analyserReady = true;
  }
  /* 返回当前低频能量 0~1（用于水波纹节奏），频谱分析已禁用（避免跨域静音），恒返回 0 */
  function getBassLevel() {
    return 0;
  }

  function ensureAudio() {
    if (!state.audio) {
      state.audio = new Audio();
      state.audio.preload = 'auto';
      state.audio.onended = () => { onEnded(); };
      state.audio.onerror = () => {
        // 若增益激活但音频加载失败（跨域无 CORS 的源），回退直通避免静音
        if (_gainActive) { _teardownGain(); state.audio.volume = 1; }
        state.playing = false;
      };
      state.audio.ontimeupdate = () => {
        // 20261104：播放进度节流持久化（每 ~4 秒落一次 localStorage），刷新/重进后断点续播。
        const now = Date.now();
        if (!state._lastProgSave || now - state._lastProgSave > 4000) {
          state._lastProgSave = now;
          try {
            const cur = state.current;
            if (cur && cur.id && state.audio && state.audio.currentTime > 1) {
              const raw = localStorage.getItem('bmMusicSession');
              if (raw) {
                const d = JSON.parse(raw);
                d.progress = Math.floor(state.audio.currentTime);
                localStorage.setItem('bmMusicSession', JSON.stringify(d));
              }
            }
          } catch (e) {}
        }
      };
    }
    return state.audio;
  }

  // 20261104 修复「所有音源都播不了 + 播放动效消失」：
  //   根因不是 createMediaElementSource 劫持（增益早已禁用，_applyGain 不再被调用），而是
  //   「每次播放都 new Audio() 新建元素」——全新元素脱离了用户点击的手势激活上下文，
  //   autoplay 策略拦截 play() → state.playing 永远 false → 无声且动效不出现。
  //   正解：复用同一个 state.audio 元素（与旧版一致），只在元素不存在时才新建；
  //   跨源播放前只清 src 重新 load，绝不新建元素，保住手势激活延续性。
  // 播放失败自动重拉直链的重试计数（防止死循环）；每次成功播放清零
  let _reloadRetry = 0;
  // 20261104：断点续播进度（秒）。刷新/重进后从 saveSession 恢复，resume 时用它跳转到上次进度。
  let _resumeAt = 0;
  // 20261105：缓存最后一次有效的音频时长（秒）。Android WebView 挂后台时可能暂停/挂起 audio，
  //   a.duration 暂时丢失（NaN/0），时长与进度条会闪断归零。用缓存兜底，挂后台回来时长/进度不乱。
  let _cachedDuration = 0;
  // onerror 时若直链是「会过期的网易云直链」，自动重新解析直链重播一次
  function _onAudioError() {
    if (_gainActive) { _teardownGain(); state.audio.volume = 1; }
    state.playing = false;
    const cur = state.current;
    // 只有「网易云直链」（music.126.net，带时间戳、会过期）才值得自动重拉；
    // 其它源（酷我/QQ/iTunes 直链较稳定）失败多半是网络，重拉一次也够，统一重试一次。
    if (cur && cur.id && _reloadRetry < 2) {
      _reloadRetry++;
      fetchSongDetail(cur).then((full) => {
        if (full && full.url && String(full.url) !== String(cur.url)) {
          // 拿到新直链，替换并重播
          state.current = full;
          const idx = state.playlist.findIndex(s => String(s.id) === String(full.id));
          if (idx >= 0) state.playlist[idx] = full;
          const a = ensureAudio();
          a.src = _normUrl(full.url);
          state.loadedId = full.id;   // 20261105：重拉直链后同步记录，resume 精准命中
          a.play().then(() => { state.playing = true; _reloadRetry = 0; onStateChange(); }).catch(() => {});
        } else {
          // 20261105 修复「重装后歌单歌曲全播不了」：旧直链/旧 id 失效时，
          //   fetchSongDetail 按旧 id 取不到新直链，改用「歌名+歌手」重新搜索取新歌再播。
          //   这样重装 APK 后即使直链过期，点播放也能自动重新联网取到能播的新直链。
          _reloadByName(cur);
        }
      }).catch(() => { _reloadByName(cur); });
    } else {
      _reloadRetry = 0;
    }
  }
  // 20261105：统一规范化播放直链协议——网易云/部分源返回 http:// 直链，
  //   WebView（https://localhost）加载 http 音频会被混合内容拦截 → 无声。统一转 https。
  function _normUrl(u) {
    if (!u) return u;
    return String(u).replace(/^http:\/\//i, 'https://');
  }
  // 用「歌名+歌手」重新搜索取新直链重播（兜底，解决过期直链/失效 id）
  function _reloadByName(cur) {
    if (!cur || _reloadRetry >= 2) { _reloadRetry = 0; return; }
    const kw = (cur.name || '') + (cur.artist ? ' ' + cur.artist : '');
    if (!cur.name) { _reloadRetry = 0; return; }
    _reloadRetry++;
    search(kw).then((list) => {
      if (!list || !list.length) { _reloadRetry = 0; return; }
      // 优先匹配同歌手/同名，其次取第一首
      let best = list[0];
      const byName = list.find(s => String(s.name || '').trim() === String(cur.name || '').trim());
      const byNameArtist = list.find(s => String(s.name || '').trim() === String(cur.name || '').trim() && String(s.artist || '').trim() === String(cur.artist || '').trim());
      if (byNameArtist) best = byNameArtist;
      else if (byName) best = byName;
      if (!best.url) {
        fetchSongDetail(best).then((full) => {
          if (full && full.url) _swapAndReplay(cur, full);
          else _reloadRetry = 0;
        }).catch(() => { _reloadRetry = 0; });
      } else {
        _swapAndReplay(cur, best);
      }
    }).catch(() => { _reloadRetry = 0; });
  }
  // 用新歌曲对象替换当前曲并重播（同步更新播放列表里的旧条目）
  function _swapAndReplay(oldSong, newSong) {
    state.current = newSong;
    const idx = state.playlist.findIndex(s => String(s.id) === String(oldSong.id));
    if (idx >= 0) state.playlist[idx] = newSong;
    const a = ensureAudio();
    a.src = _normUrl(newSong.url);
    state.loadedId = newSong.id;
    a.play().then(() => { state.playing = true; _reloadRetry = 0; onStateChange(); }).catch(() => { _reloadRetry = 0; });
  }
  function rebuildCleanAudio() {
    _teardownGain();   // 增益已禁用，确保残留的 Web Audio 图拆干净（这是唯一真正需要清理的）
    if (!state.audio) {
      state.audio = new Audio();
      state.audio.preload = 'auto';
      state.audio.onended = () => { onEnded(); };
      state.audio.onerror = () => { _onAudioError(); };
      state.audio.ontimeupdate = () => { state.listenSec += 0; };
      // 20261105：duration 就绪后强制刷新一次进度条/时长（此前 duration 加载慢时，进度 UI 一直停在 00:00，
      //   要等下一次心跳才更新，用户看到「这首歌显示 0 分/00:00」）
      state.audio.addEventListener('loadedmetadata', () => {
        try {
          if (state.audio && isFinite(state.audio.duration) && state.audio.duration > 0) _cachedDuration = state.audio.duration;
          if (typeof window.__bmUpdateProgress === 'function') window.__bmUpdateProgress();
        } catch (e) {}
      });
      // 20261105：durationchange 也同步缓存（某些源 metadata 分阶段就绪），挂后台回来 duration 失效时用缓存兜底
      state.audio.addEventListener('durationchange', () => {
        try {
          if (state.audio && isFinite(state.audio.duration) && state.audio.duration > 0) _cachedDuration = state.audio.duration;
        } catch (e) {}
      });
      return state.audio;
    }
    // 复用现有元素：清空旧源、重置，但保留同一个元素实例（手势激活延续的关键）
    try { state.audio.pause(); } catch (e) {}
    return state.audio;
  }

  async function play(song) {
    if (!song) { if (window.miniToast) miniToast('没有可播放的歌曲'); return; }
    if (!song.url) { if (window.miniToast) miniToast('未获取到播放直链，请稍后重试或换关键词'); return; }
    // 20261105 修复「能登录但播不出声/进度不走」：网易云 player/url 接口返回的直链多为
    //   http://m7.music.126.net/...（http 协议）。Capacitor WebView 页面是 https://localhost，
    //   加载 http 音频会被「混合内容」策略拦截 → 无声、进度不动。这里统一把播放直链
    //   http→https（music.126.net 支持 https），根治直连模式播放失败。
    song.url = _normUrl(song.url);
    state.current = song;
    // 20261104：显式切歌（play）一律从头播放，清掉断点续播进度；
    //   只有「刷新/重进后点播放键」走 resume() 才续播到上次进度。
    _resumeAt = 0;
    _cachedDuration = 0;   // 20261105：切歌重置缓存时长，避免新歌未加载时沿用旧歌 duration
    // 20261104 修复：复用单一 state.audio（rebuildCleanAudio 现在不再新建元素），
    //   保住用户手势激活延续性，避免 autoplay 拦截导致「无声 + 动效消失」。
    const a = rebuildCleanAudio();
    // 禁用增益后音量恒 ≤1，直通播放；绝不设 crossOrigin（anonymous 会让无 CORS 的源加载失败 → onerror → 静音）
    const vol = getVolume();
    try { a.crossOrigin = null; } catch (e) {}
    a.src = song.url;
    state.loadedId = song.id;   // 20261105：记录当前加载的曲目，根治 resume 的 src 匹配失败
    // 20261106：智能过渡（交叉淡入淡出）——开启时新歌从 0 音量渐变到目标音量，平滑衔接；
    //   关闭时直接设目标音量。渐变用 requestAnimationFrame 轻量实现，避免引入额外元素。
    if (state.crossfade) {
      a.volume = 0;
      _crossfadeTo(a, vol);
    } else {
      a.volume = vol;
    }
    ensureAnalyser();          // 建立频谱分析（失败自动降级）
    // 20261104 乐观播放：先置 playing=true 并刷新 UI（点播放立即有反馈，不等音频缓冲），
    //   后台 a.play() 成功/失败再纠正。之前 await a.play() 会等音频真正出声才返回，
    //   网易云 CDN 慢时点播放要干等 3 秒多，用户误以为「点不了」。
    state.playing = true;
    onStateChange();
    a.play().then(() => {
      state.playing = true;
      _reloadRetry = 0;
      onStateChange();
    }).catch((e) => {
      // autoplay 被拦（NotAllowedError）或缓冲未就绪时，挂 canplay 重试一次
      state.playing = false;
      onStateChange();
      const retry = () => { try { a.play().then(() => { state.playing = true; onStateChange(); }).catch(() => {}); } catch (e2) {} };
      a.addEventListener('canplay', retry, { once: true });
    });
    // 20261104 统一记录播放历史（此前只在 playSong 里记，悬浮窗/角色主动等路径漏记，导致"播放了但没记录"）
    addHistory({ kind: 'history', charId: state.charId, songId: song.id, name: song.name, artist: song.artist || '', album: song.album || '', pic: song.pic || '' });
    // 20261105 修复「网易云直连歌词/封面不显示」：直连播放（搜歌点播/歌单点播/导入歌单）时
    //   song 往往只有 url 没有 lrc/pic（_netEaseSongUrl 不返回歌词、部分路径 pic 缺失）。
    //   这里异步补拉歌词 + 封面，补齐后刷新播放器/悬浮窗，让滚动歌词和封面都能显示。
    if (song.source === 'netease-direct' && song.id) {
      (async () => {
        let changed = false;
        try {
          if (!song.lrc) {
            const lrc = await _netEaseLyric(song.id);
            if (lrc) { song.lrc = lrc; changed = true; }
          }
        } catch (e) {}
        try {
          if (!song.pic) {
            const dj = await _netEaseReq('https://music.163.com/api/song/detail?ids=[' + song.id + ']');
            const s0 = dj && dj.songs && dj.songs[0];
            if (s0 && s0.album && s0.album.picUrl) { song.pic = String(s0.album.picUrl).replace(/^http:\/\//i, 'https://'); changed = true; }
          } else if (String(song.pic).indexOf('http://') === 0) {
            song.pic = String(song.pic).replace(/^http:\/\//i, 'https://'); changed = true;
          }
        } catch (e) {}
        if (changed) { try { refreshPlayerUI(); } catch (e) {} try { renderFloat(); } catch (e) {} }
      })();
    }
  }

  // 20261106：智能过渡——把 audio 音量从当前值平滑渐变到目标值（约 1.2s），
  //   每次调用先取消上一次未完成的渐变，避免叠加抖动。
  let _cfRaf = null;
  function _crossfadeTo(audio, target) {
    if (!audio) return;
    if (_cfRaf) { cancelAnimationFrame(_cfRaf); _cfRaf = null; }
    const from = audio.volume || 0;
    if (Math.abs(from - target) < 0.01) { audio.volume = target; return; }
    const t0 = performance.now();
    const dur = 1200;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);   // easeOutCubic，先快后缓
      audio.volume = from + (target - from) * e;
      if (p < 1) { _cfRaf = requestAnimationFrame(step); }
      else { audio.volume = target; _cfRaf = null; }
    };
    _cfRaf = requestAnimationFrame(step);
  }

  function pause() { const a = ensureAudio(); a.pause(); state.playing = false; saveSession(); onStateChange(); }
  function resume() {
    if (!state.current) return;   // 没有歌时不静默假启动
    // 20261105 修复「暂停时拖动进度条后点播放，不从拖动位置开始播」：
    //   根因 = sameSongLoaded 的 src 匹配经常失败（a.src 被浏览器规范化为绝对 URL，
    //   state.current.url 是转发地址，indexOf 匹配不上），一旦失败就走 rebuildCleanAudio()+重设 src，
    //   重设 src 触发音频重载 → currentTime 归零 → 丢掉了用户拖到的进度。
    //   这里进入时先「记住」当前进度（含拖动后的值），无论走哪个分支都用它 seek 回去。
    const keepTime = (state.audio && state.audio.currentTime > 0) ? state.audio.currentTime : 0;
    // 20261104：复用单一 audio（rebuildCleanAudio 不再新建元素）；若有 url 直接播，
    //   若 url 缺失（历史歌）异步重拉直链再播。play 失败时挂 canplay 兜底重试。
    // 20261105 修复竞态：seek 不能只挂 loadedmetadata（可能 addEventListener 前已触发导致落空），
    //   改为「readyState 已就绪就立即 seek，否则 loadedmetadata + canplay 双事件兜底，且可重复触发直到成功」。
    const tryPlay = (a, resumeAt) => {
      // 20261104：断点续播——若有上次进度（刷新/重进恢复），等音频就绪后跳转到该进度再播，
      //   避免每次刷新都从歌曲开头重放。续播后清空 _resumeAt，下次 pause/resume 走正常暂停恢复。
      const target = resumeAt > 0 ? resumeAt : (_resumeAt > 0 ? _resumeAt : keepTime);
      _resumeAt = 0;
      if (target > 0) {
        let seeked = false;
        const seek = () => {
          if (seeked) return;
          try {
            if (a.duration && target < a.duration - 2) { a.currentTime = target; seeked = true; }
          } catch (e) {}
        };
        // 已就绪立即 seek；否则挂双事件兜底（once 但 seeked 标记防重复；若第一次事件时 duration 未就绪，
        //   再补一个 timeupdate/durationchange 兜底，确保一定 seek 到）
        if (a.readyState >= 1) { seek(); if (!seeked) a.addEventListener('loadedmetadata', seek); }
        else { a.addEventListener('loadedmetadata', seek); a.addEventListener('canplay', seek); }
      }
      try {
        a.play().then(() => { state.playing = true; onStateChange(); }).catch(() => {
          const retry = () => { try { a.play().then(() => { state.playing = true; onStateChange(); }).catch(() => {}); } catch (e2) {} };
          a.addEventListener('canplay', retry, { once: true });
        });
      } catch (e) {}
    };
    // 20261104 修复「暂停后再播放从头开始」：若 audio 元素已加载当前这首歌（暂停未切歌），
    //   直接 a.play() 续播——浏览器天然保留 currentTime，无需重设 src（重设 src 会触发重载、进度归零）。
    //   只有「audio 还没加载 / 加载的不是当前歌 / 正在从头（无有效进度）」时才重设 src。
    if (state.current.url) {
      const a = state.audio;
      // 20261105 根治：不再用脆弱的 src 字符串匹配（a.src 会被浏览器规范化为绝对 URL、
      //   与 state.current.url 的转发地址 indexOf 匹配经常失败，导致误走「重设 src → 进度归零」）。
      //   改用 state.loadedId（play/resume 设 src 时同步记录）精准判断「当前 audio 是否就是这首歌」。
      const sameSongLoaded = !!(a && a.src && state.loadedId != null && String(state.loadedId) === String(state.current.id));
      if (sameSongLoaded && a.currentTime > 0) {
        // 同一首已加载且有进度：直接续播（currentTime 天然保留，无需 seek）
        try { a.play().then(() => { state.playing = true; onStateChange(); }).catch(() => {}); } catch (e) {}
        state.playing = true;
        onStateChange();
        return;
      }
      const a2 = rebuildCleanAudio();
      const vol = getVolume();
      a2.src = state.current.url;
      state.loadedId = state.current.id;   // 20261105：重设 src 后同步记录，下次 resume 精准命中
      a2.volume = vol;
      tryPlay(a2, keepTime);   // 20261105：显式传 keepTime，重设 src 后仍 seek 回拖动/当前进度
      state.playing = true;
      onStateChange();
      return;
    }
    fetchSongDetail(state.current).then((full) => {
      if (full && full.url) {
        state.current = full;
        const a = rebuildCleanAudio();
        const vol = getVolume();
        a.src = full.url;
        state.loadedId = full.id;   // 20261105：同步记录
        a.volume = vol;
        tryPlay(a, keepTime);  // 20261105：同样 seek 回拖动/当前进度
        state.playing = true;
        onStateChange();
      }
    }).catch(() => {});
  }
  function toggle() { state.playing ? pause() : resume(); }

  /* 添加到播放列表（去重）：返回是否新增 */
  function addToQueue(song) {
    if (!song || !song.id) return false;
    const exists = state.playlist.some(s => String(s.id) === String(song.id));
    if (!exists) {
      state.playlist.push(song);
      if (state.playIndex < 0 && state.playlist.length === 1) state.playIndex = 0;
      saveSession();
    }
    return !exists;
  }

  /* 一首播完：单曲循环→重播；顺序播放(once)播完最后一首→停止；否则按模式推进 */
  function onEnded() {
    if (state.playMode === 'one') { const a = ensureAudio(); a.currentTime = 0; a.play().catch(() => {}); return; }
    // 顺序播放：已是最后一首则停止，不再推进
    if (state.playMode === 'once' && state.playIndex >= state.playlist.length - 1) {
      state.playing = false;
      onStateChange();
      return;
    }
    next(true);
  }

  async function next(auto = false) {
    if (!state.playlist.length) return;
    if (state.playMode === 'shuffle' && state.playlist.length > 1) {
      // 随机：抽一个不同的下标
      let idx;
      do { idx = Math.floor(Math.random() * state.playlist.length); } while (idx === state.playIndex);
      state.playIndex = idx;
    } else if (state.playMode === 'once' && state.playIndex >= state.playlist.length - 1) {
      // 顺序播放：已在最后一首则停住，不再推进（播完即停，不循环）
      return;
    } else {
      state.playIndex = (state.playIndex + 1) % state.playlist.length;
    }
    await playPrepared(state.playIndex);
  }
  async function prev() {
    if (!state.playlist.length) return;
    state.playIndex = (state.playIndex - 1 + state.playlist.length) % state.playlist.length;
    await playPrepared(state.playIndex);
  }
  /* 切歌前确保目标曲有播放直链（搜索列表项只有元数据）。
     20261104 关键修复「某首歌记住旧直链永远放不了」：网易云直链（music.126.net）带时间戳、
     几分钟到几小时就会过期，播放列表里缓存的是首次解析的旧直链，复用必 404 静音。
     故凡遇到网易云直链，一律现场重新解析新直链；其它源直链较稳定可复用。 */
  function _isVolatileUrl(url) {
    return !!(url && url.indexOf('music.126.net') >= 0);
  }
  async function playPrepared(idx) {
    let song = state.playlist[idx];
    if (!song) return;
    if (!song.url || _isVolatileUrl(song.url)) {
      const fresh = await fetchSongDetail(song);
      if (fresh && fresh.url) song = fresh;
    }
    state.playlist[idx] = song;
    play(song);
  }

  /* 播放模式四档循环：once(顺序播放) → order(列表循环) → shuffle(随机) → one(单曲循环) → once */
  function cyclePlayMode() {
    const seq = ['once', 'order', 'shuffle', 'one'];
    const i = seq.indexOf(state.playMode);
    state.playMode = seq[(i < 0 ? 0 : i + 1) % seq.length];
    onStateChange();
  }

  /* 音量（0~1.5），持久化到 localStorage。
     1.0 = 标准 100%；>1.0 为增益放大（最高 150%）。
     增益用 Web Audio GainNode 实现；仅当音源能被跨域干净读取时才启用，
     否则回退直通（audio.volume 钉在 1.0），绝不静音。 */
  let _gainCtx = null, _gainNode = null, _gainSource = null, _gainActive = false;
  function _teardownGain() {
    try {
      if (_gainSource) { _gainSource.disconnect(); _gainSource = null; }
      if (_gainNode) { _gainNode.disconnect(); _gainNode = null; }
      if (_gainCtx) { _gainCtx.close().catch(() => {}); _gainCtx = null; }
    } catch (e) {}
    _gainActive = false;
  }
  function getVolume() {
    try {
      const v = parseFloat(localStorage.getItem('bmMusicVolume'));
      // 20261104 彻底禁用 >1 增益：Web Audio createMediaElementSource 一旦对 audio 元素调用即
      //   永久劫持其输出（且不可撤销），之后所有歌曲（无论换哪个音源）都静音——这是「每个音源
      //   都播不了」的确定性根因。音量上限钳到 1.0 直通，彻底绕开增益链路。
      if (!(v >= 0)) return 1;
      return Math.min(v, 1);
    } catch (e) { return 1; }
  }
  function setVolume(v) {
    // 20261104：音量钳到 [0,1]，不做 Web Audio 增益（见 getVolume 注释，增益会静音）
    const nv = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('bmMusicVolume', String(nv)); } catch (e) {}
    const a = ensureAudio();
    if (!a) return;
    _teardownGain();          // 增益已禁用，确保拆干净
    a.volume = nv;
  }
  /* 建立增益链路，失败/不安全则回退直通 */
  function _applyGain(gain) {
    const a = ensureAudio();
    if (!a || !a.src) { _teardownGain(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { _teardownGain(); return; }   // 无 Web Audio 环境 → 只能直通
    try {
      // 若已激活且只是调节 gain 值，直接更新
      if (_gainActive && _gainNode && _gainCtx) {
        _gainNode.gain.value = gain;
        return;
      }
      if (!_gainCtx) _gainCtx = new AC();
      if (_gainCtx.state === 'suspended') _gainCtx.resume().catch(() => {});
      // 建立：audio → GainNode → destination
      _gainSource = _gainCtx.createMediaElementSource(a);
      _gainNode = _gainCtx.createGain();
      _gainNode.gain.value = gain;
      _gainSource.connect(_gainNode);
      _gainNode.connect(_gainCtx.destination);
      _gainActive = true;
    } catch (e) {
      // createMediaElementSource 重复调用/失败 → 回退直通
      _teardownGain();
      a.volume = 1;
    }
  }

  function onStateChange() {
    if (typeof window.bmMusicUI !== 'undefined' && window.bmMusicUI.refreshPlayerUI) window.bmMusicUI.refreshPlayerUI();
    saveSession();
  }

  /* 持久化当前播放会话（当前曲目 + 播放列表 + 播放索引），刷新/重进后恢复。
     只存元数据与直链；url 可能较大但必要——否则恢复后「点继续播放」拿不到直链。 */
  function saveSession() {
    try {
      const cur = state.current;
      const data = {
        current: cur ? { id: cur.id, name: cur.name, artist: cur.artist || '', album: cur.album || '', pic: cur.pic || '', url: cur.url || '', lrc: cur.lrc || '' } : null,
        playlist: (state.playlist || []).map(s => ({ id: s.id, name: s.name, artist: s.artist || '', album: s.album || '', pic: s.pic || '', url: s.url || '', lrc: s.lrc || '' })),
        playIndex: state.playIndex,
        playMode: state.playMode,
        crossfade: !!state.crossfade,   // 20261106：智能过渡开关持久化
        mode: state.mode || 'mirror',   // 20261106：持久化三模式（镜像/后台遥控/本地），重进记住上次选的模式
        playing: state.playing,
        // 20261104：一起听状态一并持久化（charId + togetherSince）。
        //   此前只存播放列表/曲目，不存一起听状态，导致刷新/重进 App 后
        //   togetherSince 归零 → togetherText() 返回空 → 一起听时长不显示。
        charId: state.charId || null,
        togetherSince: state.togetherSince || 0,
        // 20261104：播放进度（秒）——刷新/重进后断点续播，不再每次从开头重放。
        progress: (state.audio && state.audio.currentTime) ? Math.floor(state.audio.currentTime) : 0,
      };
      localStorage.setItem('bmMusicSession', JSON.stringify(data));
    } catch (e) {}
  }

  /* 模块加载时恢复上次播放会话（不自动播放，避免未经用户手势触发被浏览器拦截） */
  function restoreSession() {
    try {
      const raw = localStorage.getItem('bmMusicSession');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d) return;
      if (Array.isArray(d.playlist) && d.playlist.length) {
        state.playlist = d.playlist;
        state.playIndex = (typeof d.playIndex === 'number' && d.playIndex >= 0 && d.playIndex < d.playlist.length) ? d.playIndex : 0;
      }
      if (d.current) {
        // 若 current 不在 playlist 里，补进去
        if (!state.playlist.some(s => String(s.id) === String(d.current.id))) {
          state.playlist.unshift(d.current);
          state.playIndex = 0;
        }
        state.current = d.current;
      }
      if (d.playMode) state.playMode = d.playMode;
      if (typeof d.crossfade === 'boolean') state.crossfade = d.crossfade;   // 20261106：恢复智能过渡开关
      // 20261106：恢复三模式（镜像/后台遥控/本地），重进记住上次选的模式
      if (d.mode === 'mirror' || d.mode === 'remote' || d.mode === 'local') state.mode = d.mode;
      // 20261104：恢复一起听状态（charId + togetherSince），使一起听时长在
      //   刷新/重进 App 后继续正确显示与累加（togetherSince 是时间戳，恢复后
      //   Date.now()-togetherSince 仍能算准已听时长）。
      if (d.charId) state.charId = d.charId;
      if (d.togetherSince) state.togetherSince = d.togetherSince;
      // 20261104：恢复播放进度（断点续播）。仅记内存 _resumeAt，resume() 时跳转到该进度。
      if (typeof d.progress === 'number' && d.progress > 0) _resumeAt = d.progress;
      // playing 不恢复（浏览器要求用户手势才能播放），保持暂停态，点播放键继续
      state.playing = false;
    } catch (e) {}
  }

  /* ---------- 对外接口 ---------- */
  return {
    state,
    isApp,
    setNeteaseBridge,   // 20261106 方案A：闭包2 注入网易云直连函数（修跨闭包 ReferenceError）
    _netEaseLyric,      // 20261107 暴露给闭包2：后台遥控模式拿外部 title/artist 搜歌后补拉歌词
    search,
    fetchSongDetail,
    parsePlaylistLink,
    expandNeteaseShortLink,
    extractNeteasePlaylistId,
    fetchPlaylist,
    getLocalLibrary,
    addLocalTrack,
    removeLocalTrack,
    getPlaylists,
    createPlaylist,
    removePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    addHistory,
    getHistory,
    addToQueue,
    playPrepared,
    ensureAudio,
    getBassLevel,
    getVolume,
    setVolume,
    play, pause, resume, toggle, next, prev,
    cyclePlayMode,
    getCustomSources,
    addCustomSource,
    removeCustomSource,
    saveSession,
    restoreSession,
  };
})();

// 模块加载即恢复上次播放会话（不自动播放，仅恢复列表与当前曲目，点播放键继续）
try { window.bmMusic.restoreSession(); } catch (e) {}

/* ============================================================
   音乐 UI（独立听歌页 + 一起听歌悬浮窗 + 律动星球）
   通过 window.bmMusicUI 暴露；app.js 的 showMusicPage() 调这里
   ============================================================ */
window.bmMusicUI = (function () {
  const M = window.bmMusic;

  /* ---------- 封面球：封面贴球面 + 魔法阵星图（同心星轨环 + 星座节点 + 扩散能量环） ---------- */
  function planetHTML(size) {
    const pic = M.state.current && M.state.current.pic;
    const core = pic
      ? `<div class="bm-planet-core has-pic" id="bm-planet-core" style="background-image:url('${esc(pic)}')"></div>`
      : `<div class="bm-planet-core" id="bm-planet-core"><div class="bm-planet-ph">${window.icon ? window.icon('music', 40) : '♪'}</div></div>`;
    return `
    <div class="bm-vinyl-rig">
      <div class="bm-planet" id="bm-planet" style="width:${size}px;height:${size}px;">
        ${core}
        <div class="bm-planet-ring r1"></div>
        <div class="bm-planet-ring r2"></div>
        <div class="bm-planet-ring r3"></div>
        <span class="bm-planet-star s1"></span>
        <span class="bm-planet-star s2"></span>
        <span class="bm-planet-star s3"></span>
        <div class="bm-magic-circle" id="bm-magic-circle">
          <span class="bm-node n1"></span>
          <span class="bm-node n2"></span>
          <span class="bm-node n3"></span>
          <span class="bm-node n4"></span>
          <span class="bm-node n5"></span>
          <span class="bm-node n6"></span>
          <svg class="bm-constellation" viewBox="0 0 200 200" preserveAspectRatio="none">
            <polygon points="185,100 142,26 58,26 15,100 58,174 142,174" class="bm-con-poly"></polygon>
          </svg>
        </div>
        <div class="bm-wave-ring" id="bm-wave-ring">
          <span></span><span></span><span></span>
        </div>
      </div>
      <!-- 20261107 PC 宽屏黑胶唱机：唱臂（默认隐藏，≥1100px 才显示） -->
      <div class="bm-tonearm" aria-hidden="true">
        <div class="bm-tonearm-pivot"></div>
        <div class="bm-tonearm-arm"></div>
        <div class="bm-tonearm-head"></div>
      </div>
    </div>`;
  }

  /* ---------- 解析 LRC 文本 → 时间标签数组 ---------- */
  function parseLrc(lrc) {
    if (!lrc) return [];
    const lines = [];
    const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    lrc.split('\n').forEach(line => {
      const times = [];
      let m;
      const re2 = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      while ((m = re2.exec(line)) !== null) {
        const mm = parseInt(m[1]), ss = parseInt(m[2]);
        const ms = m[3] ? parseInt(m[3].padEnd(3, '0')) : 0;
        times.push(mm * 60 + ss + ms / 1000);
      }
      const text = line.replace(re, '').trim();
      if (!text) return;
      times.forEach(t => lines.push({ t, text }));
    });
    lines.sort((a, b) => a.t - b.t);
    // 20261107 双语歌词：同一时间戳连续出现的「第二行」判定为翻译行，打 tr 标记，
    //   渲染时加 bm-lrc-tr / bm-fly-tr class，字稍小、色稍浅，与原文区分（与网易云官方一致）。
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].t === lines[i - 1].t && !lines[i - 1].tr) lines[i].tr = true;
    }
    return lines;
  }

  /* ---------- 当前一起听歌的角色 ---------- */
  function currentChar() {
    // 20261105 修复「角色数据串台」：优先取正在一起听的角色（M.state.charId），
    //   没有一起听时回退到「当前聊天页的角色」（app.js 全局 currentCharId）。
    //   否则从某角色聊天页进入音乐页、尚未一起听时，耳机/访客收藏会拿到上一个一起听角色
    //   或空，导致显示「另一个角色还没听过歌/收藏」。
    const id = M.state.charId || (typeof currentCharId !== 'undefined' ? currentCharId : null);
    if (!id) return null;
    return (typeof characters !== 'undefined' && characters.find) ? (characters.find(x => x.id === id) || null) : null;
  }

  /* 安全取角色 / 玩家资料（music.js 与 app.js 顶层 let 共享全局词法作用域，可裸名访问） */
  function getCharById(id) {
    if (!id) return null;
    try { return (typeof characters !== 'undefined' && characters.find) ? (characters.find(x => x.id === id) || null) : null; } catch (e) { return null; }
  }
  function playerAvatar() {
    // 20261104：头像可能是 base64 / Blob / {__img:5,ref} 文件引用，不能直接当字符串塞 <img src>。
    // 复用 app.js 的 imgSrc 做 Blob→objectURL / 文件引用→URL 转换；非字符串时返回空走文字占位。
    try {
      const av = (typeof playerProfile !== 'undefined' && playerProfile.avatar) ? playerProfile.avatar : '';
      if (!av) return '';
      if (typeof av === 'string') return av;
      if (typeof window.imgSrc === 'function') { const u = window.imgSrc(av); return u || ''; }
      return '';
    } catch (e) { return ''; }
  }
  function charAvatarUrl(c) {
    // 角色头像同理，统一走 imgSrc 做 Blob/文件引用转换
    try {
      const av = c && c.avatar ? c.avatar : '';
      if (!av) return '';
      if (typeof av === 'string') return av;
      if (typeof window.imgSrc === 'function') { const u = window.imgSrc(av); return u || ''; }
      return '';
    } catch (e) { return ''; }
  }
  /* 生成带头像的 <img> HTML（含 data-bmref 标记，供文件引用 {__img:5,ref} 异步回填后刷新）。
     返回 { html, hasImg }：html 为 img 或文字占位，hasImg 标识是否真的渲染了图片。
     头像字段可能是 base64 字符串 / Blob / {__img:5, ref, mime} 文件引用。 */
  function avatarImgHTML(av, fallback) {
    try {
      if (!av) return { html: `<span class="bm-avt-ph">${esc(fallback || '?')}</span>`, hasImg: false };
      if (typeof av === 'string') return { html: `<img src="${esc(av)}" referrerpolicy="no-referrer" alt="" draggable="false" onerror="this.style.display='none';">`, hasImg: true };
      // 文件引用：带 data-bmref，回填后 _bmImgRefreshByRef 会刷新 src
      if (av && av.__img === 5 && av.ref) {
        const u = (typeof window.bmImgUrl === 'function') ? window.bmImgUrl(av.ref) : '';
        // 异步确保回填（首次渲染 src 可能为空，回填后自动刷新）
        if (typeof window.bmImgEnsureUrl === 'function') window.bmImgEnsureUrl(av.ref).catch(() => {});
        if (u) return { html: `<img src="${esc(u)}" data-bmref="${esc(av.ref)}" alt="" draggable="false">`, hasImg: true };
        return { html: `<img src="" data-bmref="${esc(av.ref)}" alt="" draggable="false">`, hasImg: false };
      }
      // Blob 等其他：走 imgSrc
      if (typeof window.imgSrc === 'function') { const u = window.imgSrc(av); if (u) return { html: `<img src="${esc(u)}" alt="" draggable="false">`, hasImg: true }; }
      return { html: `<span class="bm-avt-ph">${esc(fallback || '?')}</span>`, hasImg: false };
    } catch (e) { return { html: `<span class="bm-avt-ph">${esc(fallback || '?')}</span>`, hasImg: false }; }
  }
  function playerName() {
    try { return (typeof playerProfile !== 'undefined' && playerProfile.name) ? playerProfile.name : '我'; } catch (e) { return '我'; }
  }

  /* 20261104：统一封面图片 HTML——加 referrerpolicy=no-referrer 绕过网易云/B站图床
     Referer 防盗链；onerror 兜底（图床失效时隐藏 img，露出文字占位，不再是裂图/黑块）。
     cls：可选，额外 class（如 bm-result-cover 自己带背景色）。 */
  function coverImgHTML(pic, cls) {
    if (!pic) return '';
    const u = String(pic).replace(/^http:\/\//i, 'https://');
    const c = cls ? ` class="${cls}"` : '';
    return `<img src="${esc(u)}"${c} referrerpolicy="no-referrer" alt="" draggable="false" loading="lazy" onerror="this.style.display='none';">`;
  }

  /* ============================================================
     累计一起听歌时长：实时落库（20261104 修复「断开/退出丢时长」）
     之前只在 endTogether 时一次性累加，导致玩家中途切走/退出 App/杀进程时
     本次已听的时长丢失。现改为：
     · startTogether 时记录「本次已落库起点」 _togetherLastPersist
     · 每 3 秒把「从上一次落库到现在」的增量写进 musicTogetherTotal
     · endTogether / 重新 startTogether 时先把最后一段收尾落库
     这样只要发生过一起听，无论中间怎么停、怎么断，时长都会持续累计。
     ============================================================ */
  let _togetherLastPersist = 0;   // 本次一起听「已落库到」的时间戳（增量累计的起点）
  let _togetherPersistTimer = null;
  async function _persistTogetherProgress() {
    try {
      const charId = M.state.charId;
      const since = M.state.togetherSince;
      if (!charId || !since) return;   // 不在一起听，无需落库
      if (!_togetherLastPersist) _togetherLastPersist = since;
      const now = Date.now();
      const addSec = Math.max(0, Math.floor((now - _togetherLastPersist) / 1000));
      if (addSec <= 0) return;
      const map = await getSetting('musicTogetherTotal', {});
      map[charId] = (map[charId] || 0) + addSec;
      await setSetting('musicTogetherTotal', map);
      _togetherLastPersist = now;   // 推进落库起点
    } catch (e) {}
  }
  function _startTogetherPersist() {
    if (_togetherPersistTimer) clearInterval(_togetherPersistTimer);
    _togetherLastPersist = M.state.togetherSince || Date.now();
    _togetherPersistTimer = setInterval(_persistTogetherProgress, 3000);   // 每 3 秒增量落库
  }
  function _stopTogetherPersist() {
    if (_togetherPersistTimer) { clearInterval(_togetherPersistTimer); _togetherPersistTimer = null; }
    _togetherLastPersist = 0;
  }

  /* 发起一起听：设置角色 + 开始时间，自动弹悬浮窗，并往聊天页发一张「一起听歌」卡片 */
  function startTogether(charId) {
    M.state.charId = charId;
    M.state.togetherSince = Date.now();
    _floatClosedByUser = false;
    // 20261104：启动累计时长实时落库（每 3 秒增量写库，断开/退出不丢）
    _startTogetherPersist();
    // 一起听发起时，若当前没有正在播的歌，带入「上次在听」的那首（玩家也能点歌，不必等对方）
    if (!M.state.current) {
      restoreLastPlayed();
    }
    // 往该角色聊天流发一张「一起听歌」卡片（玩家视角的 from:'me'）
    sendMusicCard(charId);
    M.saveSession();   // 20261104：一起听状态（charId+togetherSince）落库，刷新/重进不丢时长
    renderFloat();
    refreshPlayerUI();
  }

  /* 20261104：结束一起听——清空一起听角色与计时，发一张「结束一起听」小卡片到聊天，
     并刷新音乐页（结束按钮 ↔ 邀请按钮互斥切换）+ 悬浮窗（回到单人态）。结束后
     charInviteTogether 的互斥锁（charId && togetherSince）自然解除，其他角色才能发起新邀请。 */
  async function endTogether() {
    const c = getCharById(M.state.charId);
    const wasTogether = !!(M.state.charId && M.state.togetherSince);
    // 20261104：结束前先把「最后一段未落库」的进行中时长补写进累计（实时落库收尾）。
    //   之前的实现只在结束时一次性按 togetherSince 全量累加；现改为增量落库，结束只需补最后几秒。
    if (wasTogether) {
      try { await _persistTogetherProgress(); } catch (e) {}
    }
    _stopTogetherPersist();
    M.state.charId = null;
    M.state.togetherSince = 0;
    M.saveSession();   // 20261104：结束一起听后清掉持久化的一起听状态
    if (wasTogether && c) {
      // 往聊天流发一张「结束一起听」卡片（玩家视角 from:'me'）
      try {
        const msg = {
          id: uid('msg'), charId: c.id, from: 'me', type: 'music',
          content: { name: '一起听歌已结束', artist: '', pic: '', taName: c.name || 'TA', songId: null, time: Date.now(), ended: true },
          time: Date.now(), read: true,
        };
        if (typeof idbPut === 'function') idbPut('messages', msg);
        if (document.body.dataset.view === 'chat' && currentCharId === c.id) {
          if (typeof appendMessage === 'function') appendMessage(msg);
        } else if (typeof renderChatList === 'function') renderChatList();
      } catch (e) {}
    }
    renderFloat();
    refreshPlayerUI();
    if (window.miniToast) miniToast(c ? `已结束和 ${c.name || 'TA'} 的一起听歌` : '已结束一起听歌');
  }

  /* 20261104：读某角色「累计一起听歌时长」（秒）。含「已结束一起听」累加的秒数 +
     当前若正在和该角色一起听，实时加上的进行中时长。供日记页统计。 */
  async function getTogetherTotal(charId) {
    let total = 0;
    try {
      const map = await getSetting('musicTogetherTotal', {});
      total = (map && map[charId]) || 0;
    } catch (e) {}
    // 当前正在和该角色一起听时，把进行中时长也计入（实时显示）
    if (M.state.charId === charId && M.state.togetherSince) {
      total += Math.max(0, Math.floor((Date.now() - M.state.togetherSince) / 1000));
    }
    return total;
  }

  /* 发一张「一起听歌」卡片到聊天页（复用 app.js 的 messages 落库 + 渲染链路） */
  async function sendMusicCard(charId) {
    try {
      const c = getCharById(charId);
      if (!c) return;
      const cur = M.state.current;
      const msg = {
        id: uid('msg'),
        charId: c.id,
        from: 'me',
        type: 'music',
        content: {
          name: cur ? cur.name : '一起听歌',
          artist: cur ? (cur.artist || '') : '',
          pic: cur ? (cur.pic || '') : '',
          taName: c.name || 'TA',
          songId: cur ? cur.id : null,
          time: Date.now(),
        },
        time: Date.now(),
        read: true,
      };
      if (typeof idbPut === 'function') await idbPut('messages', msg);
      // 正处在该角色聊天页则即时上屏，否则刷新聊天列表摘要
      try {
        if (document.body.dataset.view === 'chat' && currentCharId === c.id) {
          if (typeof appendMessage === 'function') appendMessage(msg);
          if (typeof scrollToBottom === 'function') scrollToBottom();
        } else if (typeof renderChatList === 'function') {
          renderChatList();
        }
      } catch (e) {}
    } catch (e) {}
  }

  /* 从播放历史恢复最近一首歌到 current（不自动播放，仅带入一起听悬浮窗/列表） */
  async function restoreLastPlayed() {
    try {
      const his = await getHistory('history');
      if (his && his.length) {
        // 按时间倒序取最近一条
        his.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        const last = his[0];
        if (last && last.name) {
          const song = { id: last.songId, name: last.name, artist: last.artist || '—', album: last.album || '', pic: last.pic || '', url: '', lrc: '' };
          M.state.current = song;
          M.state.playlist = [song];
          M.state.playIndex = 0;
        }
      }
    } catch (e) {}
  }

  /* ============================================================
     角色主动操作（20261104 动作池版）：角色像其他功能一样，按玩家设置的固定间隔
     随机从「动作池」里抽一个动作执行（不设防刷屏冷却锁），动作包括：
       · 主动播放 / 主动暂停 / 上一首 / 下一首
       · 列表添加音乐（搜一首加进播放列表）
       · 收藏音乐（收藏当前歌，带 charId 落 source:'visitor'）
       · 主动选歌（从播放列表随机选一首播放）
       · 主动搜歌（去网站搜一首新歌播放）
     每个动作发聊天小横条（"XX播放了音乐 / 暂停了 / 切换了 / 收藏了 / 添加了 / 搜索了…"）。
     仅在镜像搜索模式生效（本地模式角色只在本地歌单盲抽，走别处；后台遥控仅 App 未实施）。
     ============================================================ */
  // 角色随机搜索关键词池（中性、符合"想听点啥"的自然联想）
  const _charSearchPool = ['轻音乐', '晚安曲', '钢琴', '民谣', '古风', '纯音乐', '睡前歌单', '治愈系', '温柔的旋律', '星空', '雨声', '夏日', '回忆', '慢歌', '爵士'];

  /* 20261105：AI 模式下角色「想听什么歌」由 AI 根据角色卡决定（角色卡非常重要）。
     返回 AI 生成的搜索词；AI 不可用/非 AI 模式返回 ''（调用方回退 _charSearchPool 固定池）。
     带内存缓存（同角色 10 分钟内不重复问 AI），省 API。 */
  let _aiMusicKwCache = {};   // { charId: { kw, t } }
  async function _aiMusicSearchWord(c) {
    try {
      if (!c || typeof isCharAIMode !== 'function') return '';
      const aiOn = await isCharAIMode(c.id);
      if (!aiOn) return '';
      const cache = _aiMusicKwCache[c.id];
      if (cache && cache.kw && (Date.now() - cache.t) < 10 * 60 * 1000) return cache.kw;
      if (typeof loadAIConfig !== 'function' || typeof callAI !== 'function' || typeof buildCharAIContext !== 'function') return '';
      const cfg = await loadAIConfig();
      if (!cfg || !cfg.chatApi || !cfg.chatApi.url || !cfg.chatApi.url.trim()) return '';
      const recent = await idbGetMessagesByChar(c.id, 8);
      const ctx = await buildCharAIContext(c.id, recent);
      const r = await callAI(cfg.chatApi.url, cfg.chatApi.key, cfg.chatApi.model, [
        { role: 'system', content: `你是「${c.name}」，一个 AI 角色扮演中的虚拟角色，正想听歌。请结合你的人设、性格、此刻心境和生活状态，想一个「你现在想听」的音乐搜索关键词（2~5 个中文字，贴近治愈/纯音乐/民谣/古风/轻音乐等可搜到的风格，或某个你喜欢的歌手/心境）。只输出关键词本身，不要引号、不要解释。` },
        { role: 'user', content: `【你的角色卡与生活轨迹】\n${ctx}\n\n请输出一个你想听的音乐关键词：` },
      ], { temperature: 0.85, maxTokens: 24 });
      const t = r && r.ok && r.text ? String(r.text).trim().replace(/^["「『]+|["」』]+$/g, '').replace(/[，。！？、]/g, ' ').trim() : '';
      if (t && t.length >= 2) {
        _aiMusicKwCache[c.id] = { kw: t, t: Date.now() };
        return t;
      }
      return '';
    } catch (e) { return ''; }
  }

  // 20261106：角色主动音乐操作「小垫片」——支持玩家自选形式：
  //   musicActionStyle = 'chat'  发到聊天框（type:'musicAction' 居中玻璃胶囊垫片，会沉淀进聊天记录）
  //                   = 'toast'  短暂提示条（带角色名 + ♪，2.6s 后自动消散，不沉淀）
  //                   = 'off'    不提示
  //   受聊天设置开关控制，总设置/个人主页均可覆盖（读 window.__chatSettings 同步值兜底）。
  let _maToastTimer = null;
  function _musicActionToast(c, text) {
    let el = document.getElementById('bm-ma-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bm-ma-toast';
      document.body.appendChild(el);
    }
    const who = (c && c.name) ? c.name : '访客';
    el.innerHTML = `<span class="bm-ma-ico">♪</span><span class="bm-ma-who">${who}</span><span class="bm-ma-txt">${text || ''}</span>`;
    el.classList.remove('bm-ma-hide');
    el.classList.add('bm-ma-show');
    if (_maToastTimer) clearTimeout(_maToastTimer);
    _maToastTimer = setTimeout(() => {
      el.classList.remove('bm-ma-show');
      el.classList.add('bm-ma-hide');
    }, 2600);
  }
  function _sayMusicAction(c, text) {
    try {
      // 20261106：剥离文本开头重复的角色名——渲染层（callend-who / toast 的 .bm-ma-who）已单独显示
      //   角色名，若 content 里再带一次 `${nm}` 前缀或「名字」包裹，会变成「名字 名字 动作」重复两次。
      //   这里统一去掉文本开头的角色名（裸前缀 + 「」包裹两种形式），只保留纯动作文本。
      let pure = typeof text === 'string' ? text : '';
      const nm = (c && c.name) ? c.name : 'TA';
      if (nm && pure) {
        const escNm = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 转义正则特殊字符
        // ① 裸前缀：`厉言霄（Raven）播放了音乐`
        pure = pure.replace(new RegExp('^' + escNm), '');
        // ② 「」包裹前缀：`「厉言霄（Raven）」听着《…》`
        pure = pure.replace(new RegExp('^[「『\u300c\u300e]?' + escNm + '[」』\u300d\u300f]?'), '');
        // ③ 若剥离后开头是「听着/把头/闭上/指尖/笑」等续句但残留引号，再清一次残留引号
        pure = pure.replace(/^[「」『』\u300c\u300d\u300e\u300f]+/, '');
        // ④ 清掉剥离后开头的空白（如 `TA 播放了音乐` 剥掉 `TA` 后残留的空格）
        pure = pure.replace(/^[\s\u3000]+/, '');
        text = pure;
      }
      // 读「小垫片形式」开关：'chat' | 'toast' | 'off'（默认 'chat' 发聊天框，保持原行为）
      //   优先级：角色个人主页覆盖(c.chatSettings) > 全局 chatSettings
      let style = 'chat';
      try {
        if (c && c.chatSettings && typeof c.chatSettings.musicActionStyle === 'string') {
          style = c.chatSettings.musicActionStyle;
        } else if (typeof window.__chatSettings === 'object' && window.__chatSettings) {
          style = window.__chatSettings.musicActionStyle || 'chat';
        } else if (typeof chatSettings === 'object' && chatSettings) {
          style = chatSettings.musicActionStyle || 'chat';
        }
      } catch (e) {}
      if (style === 'off') return;

      if (style === 'toast') {
        _musicActionToast(c, text);
        return;
      }

      // 默认（'chat'）：发 type:'musicAction' 居中玻璃胶囊垫片消息，沉淀进聊天记录
      if (typeof idbPut !== 'function') { _musicActionToast(c, text); return; }
      const m = { id: (typeof uid === 'function' ? uid('msg') : ('ma' + Date.now() + Math.random())), charId: c.id, from: 'them', type: 'musicAction', content: text, time: Date.now() };
      idbPut('messages', m).then(() => {
        const onChat = document.body.dataset.view === 'chat' && typeof currentCharId !== 'undefined' && currentCharId === c.id;
        if (typeof appendMessage === 'function' && onChat) appendMessage(m);
        else if (typeof renderChatList === 'function') renderChatList();
        if (typeof _ev === 'function' && typeof _saveUnreadEvents === 'function' && !onChat) {
          try { const e = _ev(c.id); e.msgs = (e.msgs || 0) + 1; _saveUnreadEvents(); } catch (err) {}
        }
      }).catch(() => {});
    } catch (e) {}
  }

  // 动作池：每项 { w: 权重, act: 执行函数 }
  function _charMusicActions(c, nm) {
    const say = (text) => { _sayMusicAction(c, text); };
    const cur = M.state.current;
    const hasList = M.state.playlist && M.state.playlist.length;
    const hasCur = !!cur;
    // 20261105：isRemote = 真在「遥控外部 App」（mode=remote 且未开网易云直连）。
    //   开了直连后，角色走内置播放器（搜歌/点播都走 _netEase*），不再盲控外部 App。
    const isRemote = (M.state.mode === 'remote') && !_netEaseDirect;
    // 20261106 修复「直连模式下角色互动权重归零」：网易云直连（_netEaseDirect=true 且 mode=mirror）
    //   时 isRemote 恒 false，导致盲抽/日推/漫游权重 isRemote?X:0 全部归零，角色永远只抽得到
    //   「主动搜歌」一个动作。这里单独标 isDirect，让盲抽/日推/漫游在直连模式下也有权重>0，
    //   且 act 走 _netEase* 内置播放器路径（_dailyRecommend/_roamPlay 内部已按 _netEaseDirect 分流）。
    const isDirect = !!_netEaseDirect;
    const actions = [
      // 主动播放（有歌时继续/从头播）
      { w: hasCur ? 2 : 0, act: async () => {
          if (isRemote) { await _remoteAction({ bridge: 'toggle', sayText: `${nm} 播放了音乐`, local: () => { if (!M.state.playing) M.resume(); } }, (t) => say(t)); }
          else { try { M.resume(); } catch(e){} say(`${nm} 播放了音乐`); }
        } },
      // 主动暂停（正在播时）
      { w: (M.state.playing && hasCur) ? 2 : 0, act: async () => {
          if (isRemote) { await _remoteAction({ bridge: 'toggle', sayText: `${nm} 暂停了音乐`, local: () => { if (M.state.playing) M.pause(); } }, (t) => say(t)); }
          else { try { M.pause(); } catch(e){} say(`${nm} 暂停了音乐`); }
        } },
      // 下一首（嫌弃切歌：角色觉得不好听/不符合心境，于是切歌）
      { w: hasList && M.state.playlist.length > 1 ? 2 : 0, act: async () => {
          const dislike = Math.random() < 0.5;
          const sayNext = dislike
            ? `${nm} 觉得这首歌不好听，于是切换了一首歌`
            : `${nm} 觉得这首歌不符合 TA 当前的心境，于是切换了一首歌`;
          if (isRemote) { await _remoteAction({ bridge: 'next', sayText: sayNext, local: () => M.next() }, (t) => say(t || sayNext)); }
          else { try { await M.next(); } catch(e) {} say(sayNext); }
        } },
      // 上一首
      { w: hasList && M.state.playlist.length > 1 ? 1 : 0, act: async () => {
          if (isRemote) { await _remoteAction({ bridge: 'prev', sayText: `${nm} 切换回上一首`, local: () => M.prev() }, (t) => say(t || `${nm} 切换回上一首`)); }
          else { try { await M.prev(); } catch(e){} say(`${nm} 切换回上一首`); }
        } },
      // 盲抽一首（模式二：角色随机抽外部 App 歌单里的一首来放；直连模式随机搜一首网易云的歌）
      { w: (isRemote || isDirect) ? 3 : 0, act: async () => {
          if (isRemote) {
            await _remoteAction({ bridge: 'next', sayText: `${nm} 随手抽了一首来听`, local: async () => {
              const lib = await M.getLocalLibrary();
              if (!lib.length) { const kw = _charSearchPool[Math.floor(Math.random() * _charSearchPool.length)]; const r = await M.search(kw); if (r && r.length) { const f = await M.fetchSongDetail(r[0]); if (f && f.url) { M.state.playlist = [f]; M.state.playIndex = 0; M.play(f); } } return; }
              const s = lib[Math.floor(Math.random() * lib.length)]; let f = s; if (!f.url) f = await M.fetchSongDetail(s); if (f && f.url) { M.state.playlist = [f]; M.state.playIndex = 0; M.play(f); }
            } }, (t) => say(t || `${nm} 随手抽了一首来听`));
          } else if (isDirect) {
            // 直连模式：随机搜一首网易云的歌盲抽（走 _netEase* 内置播放器）
            const kw = _charSearchPool[Math.floor(Math.random() * _charSearchPool.length)];
            const list = await _netEaseSearch(kw);
            if (!list || !list.length) { say(`${nm} 想随手抽一首，但没找到`); return; }
            const s = list[Math.floor(Math.random() * list.length)];
            const u = await _netEaseSongUrl(s.id);
            if (!u || !u.url) { say(`${nm} 想随手抽一首《${s.name}》，但没拿到播放源`); return; }
            const full = { id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' };
            M.state.current = full; M.addToQueue(full);
            try { await M.play(full); } catch (e) {}
            say(`${nm} 随手抽了一首《${full.name}》来听`);
          }
        } },
      // 每日推荐（模式二：角色自主播放每日推荐；直连模式同样可用）
      { w: (isRemote || isDirect) ? 2 : 0, act: async () => {
          await _dailyRecommend((t) => say(t || `${nm} 播放了每日推荐`));
        } },
      // 漫游（模式二：角色自主开启音乐漫游；直连模式同样可用）
      { w: (isRemote || isDirect) ? 2 : 0, act: async () => {
          await _roamPlay((t) => say(t || `${nm} 开启了音乐漫游`));
        } },
      // 列表添加音乐（搜一首加进播放列表，不打断当前播放）——仅镜像模式
      { w: (!isRemote && M.state.mode === 'mirror') ? 2 : 0, act: async () => {
          let kw = '';
          try { kw = await _aiMusicSearchWord(c); } catch (e) {}
          if (!kw) kw = _charSearchPool[Math.floor(Math.random() * _charSearchPool.length)];
          const res = await M.search(kw);
          if (!res || !res.length) { say(`${nm} 想找首歌，但没找到合适的`); return; }
          const s = res[Math.floor(Math.random() * res.length)];
          const full = await M.fetchSongDetail(s);
          if (!full) return;
          M.addToQueue(full);
          say(`${nm} 把《${full.name}》加进了播放列表`);
        } },
      // 收藏音乐（收藏当前歌，带 charId 落 source:'visitor'）
      { w: hasCur ? 2 : 0, act: async () => {
          await M.addLocalTrack({ id: cur.id, name: cur.name, artist: cur.artist || '', album: cur.album || '', pic: cur.pic || '', url: cur.url || '', lrc: cur.lrc || '', source: 'visitor', charId: c.id });
          const comment = pickComment(cur.name, nm);
          say(comment);
        } },
      // 主动选歌（从播放列表随机选一首播放）——仅镜像模式
      { w: (!isRemote && hasList && M.state.playlist.length > 1) ? 2 : 0, act: async () => {
          let idx; do { idx = Math.floor(Math.random() * M.state.playlist.length); } while (idx === M.state.playIndex);
          let song = M.state.playlist[idx];
          if (song && !song.url) { const full = await M.fetchSongDetail(song); if (full) { M.state.playlist[idx] = full; song = full; } }
          if (song && song.url) { M.state.playIndex = idx; try { await M.play(song); } catch(e) {} }
          say(`${nm} 从列表里选了一首来听`);
        } },
      // 主动搜歌（去网站搜一首新歌播放）——镜像模式 / 网易云直连模式
      { w: (!isRemote && (M.state.mode === 'mirror' || _netEaseDirect)) ? 3 : 0, act: async () => {
          // 20261105：AI 模式搜索词由 AI 按角色卡决定（决定「角色耳机里听什么」），失败回退固定池
          let kw = '';
          try { kw = await _aiMusicSearchWord(c); } catch (e) {}
          if (!kw) kw = _charSearchPool[Math.floor(Math.random() * _charSearchPool.length)];
          // 20261105 网易云直连：登录直连模式下走原生 Cookie 搜网易云（能搜 VIP/读专属歌单）
          if (_netEaseDirect) {
            const list = await _netEaseSearch(kw);
            if (!list || !list.length) { say(`${nm} 想搜首歌，但没找到`); return; }
            const s = list[Math.floor(Math.random() * list.length)];
            const u = await _netEaseSongUrl(s.id);
            if (!u || !u.url) { say(`${nm} 想播一首《${s.name}》，但没拿到播放源`); return; }
            const full = { id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' };
            M.state.current = full;
            M.addToQueue(full);
            try { await M.play(full); } catch(e) {}
            await M.addHistory({ kind: 'ear', charId: c.id, songId: full.id, name: full.name, artist: full.artist || '', album: full.album || '', pic: full.pic || '', ts: Date.now(), listenSec: 0 });
            say(`${nm} 用你的网易云账号搜了一首《${full.name}》来听`);
            return;
          }
          const res = await M.search(kw);
          if (!res || !res.length) { say(`${nm} 想搜首歌，但没找到`); return; }
          const s = res[Math.floor(Math.random() * res.length)];
          const full = await M.fetchSongDetail(s);
          if (!full || !full.url) return;
          M.state.current = full;
          M.addToQueue(full);
          try { await M.play(full); } catch(e) {}
          await M.addHistory({ kind: 'ear', charId: c.id, songId: full.id, name: full.name, artist: full.artist || '', album: full.album || '', pic: full.pic || '', ts: Date.now(), listenSec: 0 });
          say(`${nm} 去网上搜了一首《${full.name}》来听`);
        } },
      // 发音乐卡片（歌词 + 寄语）：从当前歌抽一句歌词，寄语抽 2~3 张回复字卡自由组合
      { w: (hasCur && (cur.lrc || cur.name)) ? 3 : 0, act: async () => {
          // 抽一句歌词
          let lyric = '';
          try {
            if (cur.lrc) {
              const lines = parseLrc(cur.lrc);
              if (lines && lines.length) {
                const l = lines[Math.floor(Math.random() * lines.length)];
                lyric = l.text || '';
              }
            }
          } catch (e) {}
          if (!lyric) lyric = cur.name || '';
          // 寄语：抽 2~3 张回复字卡自由组合（Set 去重补抽）
          let wish = '';
          try {
            if (typeof drawReply === 'function') {
              const n = 2 + Math.floor(Math.random() * 2); // 2~3 张
              const parts = [];
              const used = new Set();
              for (let k = 0; k < n; k++) {
                let t = drawReply(cards, getCharBanWords(c), c.relation || null, c.bannedGroups || []);
                let guard = 0;
                while (used.has(t) && guard < 6) { t = drawReply(cards, getCharBanWords(c), c.relation || null, c.bannedGroups || []); guard++; }
                if (t) { used.add(t); parts.push(t); }
              }
              wish = parts.filter(Boolean).join('，');
            }
          } catch (e) {}
          if (!wish) wish = '这首歌，想送给你。';
          // 发音乐卡片
          const cardMsg = {
            id: uid('msg'), charId: c.id, from: 'them', type: 'musiccard',
            content: {
              name: cur.name || '', artist: cur.artist || '', pic: cur.pic || '',
              lyric: lyric,
              wish: wish,
              time: Date.now(),
            },
            time: Date.now(),
          };
          try {
            if (typeof idbPut === 'function') await idbPut('messages', cardMsg);
            if (typeof appendMessage === 'function' && document.body.dataset.view === 'chat' && currentCharId === c.id) appendMessage(cardMsg);
            else if (typeof renderChatList === 'function') renderChatList();
          } catch (e) {}
        } },
    ];
    return actions.filter(a => a.w > 0);
  }
  async function charAutoMusic(charId) {
    try {
      const c = getCharById(charId);
      if (!c) return;
      // 20261104 模式二：镜像搜索 + 后台遥控两种模式角色都能自主操控；
      //   本地模式角色只在本地歌单盲抽（走别处）。remote 模式动作走 _remoteAction（后台遥控+垫片）。
      // 20261106 互斥加固：入口同时把「直连残留 + local 模式」排除在外。虽然 _netEaseSetDirect(true)
      //   已强制把 mode 改回 mirror（正常不会残留 local），但这里显式兜底：只要开了网易云直连
      //   （_netEaseDirect）且当前在本地模式，就禁止角色联网动作（搜歌/日推/漫游），
      //   避免「本地断网模式」下角色偷偷联网搜歌、破坏模式隔离。
      if (M.state.mode !== 'mirror' && M.state.mode !== 'remote') return;
      if (M.state.mode === 'local' && _netEaseDirect) return;
      // 20261104 互动B：只有「正在和该角色一起听歌」时才触发（真的搜歌/播放/暂停/切歌）。
      //   不与互动A（偷看歌单/后台听歌记录，默认开）混淆。
      if (!(M.state.charId === charId && M.state.togetherSince)) return;
      const nm = c.name || 'TA';
      const actions = _charMusicActions(c, nm);
      if (!actions.length) return;
      // 按权重随机抽一个动作
      const total = actions.reduce((s, a) => s + a.w, 0);
      let r = Math.random() * total, picked = actions[0];
      for (const a of actions) { r -= a.w; if (r <= 0) { picked = a; break; } }
      await picked.act();
    } catch (e) {}
  }

  /* ============================================================
     角色偷偷查看玩家歌单（20261104）：角色像查岗/主动搜歌一样，按玩家设置的固定间隔
     随机「偷看」玩家的歌单（含歌单 + 收藏曲库）。偷看后随机触发三种后续结果，每一种
     都会在玩家歌单里留一条「足迹」提醒（kind:'peek'），并在聊天里发小横条告诉玩家：
       · view  ：只是看看 → 留「TA 在 X 时间偷偷查看了你的歌单」
       · save  ：把玩家歌单里某首歌「顺」进 TA 自己的歌单（=访客收藏 source:'visitor'）
       · listen：偷偷听玩家歌单里某首歌（记 kind:'ear' 幽灵听歌记录）
     仅在镜像搜索模式生效（本地曲库无联网，角色无镜可偷）。
     由 app.js __proactiveScan 的 musicPeek 分支随机固定间隔触发。
     ============================================================ */
  // 写一条「偷看足迹」：kind:'peek'，玩家歌单/音乐库「访客足迹」区据此展示提醒
  async function _addPeekFootprint(entry) {
    try {
      const rec = Object.assign({ id: uid('mh'), kind: 'peek', ts: Date.now() }, entry);
      await idbPut('musicHistory', rec);
      return rec;
    } catch (e) { return null; }
  }
  async function charPeekPlaylist(charId) {
    try {
      const c = getCharById(charId);
      if (!c) return;
      if (M.state.mode !== 'mirror') return;
      const nm = c.name || 'TA';
      // 玩家歌单（kind:'playlist'）+ 玩家收藏曲库（kind:'local'，全局共通）里的歌
      const pls = await M.getPlaylists();
      const lib = await M.getLocalLibrary();   // 玩家收藏（mirror/local 全局共通）
      // 拼出「玩家歌单里能偷的歌」候选池：歌单内曲目（去重）+ 收藏曲库里的歌
      const pool = [];
      const seen = {};
      const push = (s) => { if (s && s.id && !seen[s.id]) { seen[s.id] = 1; pool.push(s); } };
      if (Array.isArray(pls)) {
        for (const p of pls) {
          for (const sid of (p.tracks || [])) {
            const t = lib.find(x => x.id === sid);
            if (t) push(t);
          }
        }
      }
      lib.forEach(push);   // 兜底：即使没建歌单，收藏曲库也算「歌单」
      if (!pool.length) {
        // 玩家还没有任何歌单/收藏，角色偷看扑了个空
        await _addPeekFootprint({ charId: c.id, charName: nm, action: 'view', empty: true });
        return;
      }
      // 20261105：偷看歌单只留「偷看一眼」足迹（action:'view'），不进聊天、不发消息。
      //   偷看歌单/偷偷听歌这类互动A，只能在音乐界面「访客足迹」和「Ta的耳机」里看到，
      //   绝不发聊天消息（用户明确要求）。「顺歌(save)」拆到 charCollect，「偷听(listen)」
      //   拆到 charEarListen（那里会同时写 kind:'ear' 记录 + action:'listen' 足迹，逻辑自洽）。
      await _addPeekFootprint({ charId: c.id, charName: nm, action: 'view' });
    } catch (e) {}
  }

  /* 20261105：角色「戴耳机」生成幽灵听歌记录（kind:'ear'）——独立随机固定间隔调度。
     不是概率、不是偷看歌单的副产品，而是角色后台听歌的独立行为。
     到点随机二选一来源：
     ① 从玩家歌单/收藏里随机偷听一首（记 ear，不打断玩家播放）；
     ② 角色自己搜一首新歌来听（AI 模式按角色卡生成搜索词，字卡模式用固定池）。
     字卡模式：来源也随机二选一（不用概率判断「是否发生」，只判断「听哪首」）。
     AI 模式：搜索词由 AI 按角色卡决定（角色卡非常重要）。 */
  async function charEarListen(charId) {
    try {
      const c = getCharById(charId);
      if (!c) return;
      const nm = c.name || 'TA';
      // 收集「玩家歌单 + 玩家收藏」候选池
      const pls = await M.getPlaylists();
      const lib = await M.getLocalLibrary();
      const pool = [];
      const seen = {};
      const push = (s) => { if (s && s.id && !seen[s.id]) { seen[s.id] = 1; pool.push(s); } };
      if (Array.isArray(pls)) for (const p of pls) for (const sid of (p.tracks || [])) { const t = lib.find(x => x.id === sid); if (t) push(t); }
      lib.forEach(push);
      // 二选一：约 50% 从玩家歌单偷听，50% 自己搜歌。玩家歌单为空则只能自己搜歌。
      const hasPool = pool.length > 0;
      const fromPool = hasPool && Math.random() < 0.5;
      if (fromPool) {
        const song = pool[Math.floor(Math.random() * pool.length)];
        // 20261105：偷偷听歌只写「Ta的耳机」ear 记录 + 「访客足迹」listen 足迹（带歌名），
        //   两边一致、逻辑严丝合缝；绝不发聊天消息（互动A 只在音乐界面可见）。
        await M.addHistory({ kind: 'ear', charId: c.id, songId: song.id, name: song.name, artist: song.artist || '', album: song.album || '', pic: song.pic || '', ts: Date.now(), listenSec: 0 });
        await _addPeekFootprint({ charId: c.id, charName: nm, action: 'listen', songId: song.id, songName: song.name });
        return;
      }
      // 自己搜一首新歌来听（AI 模式按角色卡生成搜索词，字卡模式固定池）
      let kw = '';
      try { kw = await _aiMusicSearchWord(c); } catch (e) {}
      if (!kw) kw = _charSearchPool[Math.floor(Math.random() * _charSearchPool.length)];
      const res = await M.search(kw);
      if (!res || !res.length) return;
      const s = res[Math.floor(Math.random() * res.length)];
      const full = await M.fetchSongDetail(s);
      if (!full || !full.url) return;
      // 自己搜歌听：同样只写 ear 记录，不发聊天消息（互动A 只在音乐界面可见）
      await M.addHistory({ kind: 'ear', charId: c.id, songId: full.id, name: full.name, artist: full.artist || '', album: full.album || '', pic: full.pic || '', ts: Date.now(), listenSec: 0 });
    } catch (e) {}
  }

  /* 20261105：一起听歌时角色随机收藏歌曲——独立随机固定间隔调度（仅正在一起听时触发）。
     到点从「当前播放」或「播放列表」里随机收藏一首进角色自己的歌单（source:'visitor'）。
     不是概率判断「是否收藏」，而是固定间隔到点就收藏一首（当前有歌可收时）。 */
  async function charCollect(charId) {
    try {
      const c = getCharById(charId);
      if (!c) return;
      if (M.state.mode !== 'mirror' && M.state.mode !== 'remote') return;
      const nm = c.name || 'TA';
      const say = (text) => { _sayMusicAction(c, text); };
      // 候选：当前播放的歌 + 播放列表里的歌
      const cands = [];
      if (M.state.current && M.state.current.id) cands.push(M.state.current);
      if (Array.isArray(M.state.playlist)) for (const s of M.state.playlist) if (s && s.id && !cands.find(x => x.id === s.id)) cands.push(s);
      if (!cands.length) return;
      const song = cands[Math.floor(Math.random() * cands.length)];
      // 存入角色自己的歌单（访客收藏，跟 charId 绑定）
      await M.addLocalTrack({ id: song.id, name: song.name, artist: song.artist || '', album: song.album || '', pic: song.pic || '', url: song.url || '', lrc: song.lrc || '', source: 'visitor', charId: c.id });
      say(`${nm} 觉得《${song.name}》很好听，悄悄收藏进了自己的歌单`);
    } catch (e) {}
  }
  // 偷看足迹时间显示（HH:MM 或 月日 HH:MM）
  function _fmtPeekTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    if (sameDay) return `${hh}:${mm}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  }

  /* 角色主动邀请玩家一起听歌（20261104）：角色发起，弹邀请函，玩家可同意/拒绝。
     同意 → 一起听 + 自动播放；拒绝 → 作废 + 发一条「已拒绝」小横条。
     由 app.js __proactiveScan 的 musicInvite 分支随机固定间隔触发。

     20261104 追加：若玩家此刻正与「另一位角色」一起听歌，则本次邀请不弹邀请函，
     而是像「未接听来电」那样发一条小圆垫片消息到聊天记录（"XX 在 HH:MM 想和你一起听歌，
     但信号好像出了问题"），并弹一条系统通知。结束后（endTogether）才能正常接收新邀请。 */
  function charInviteTogether(charId) {
    const c = getCharById(charId);
    if (!c) return;
    // 已和「某人」一起听中 → 不弹邀请卡，改发一条「未接上」的小圆垫片消息 + 通知
    if (M.state.charId && M.state.togetherSince) {
      const busy = getCharById(M.state.charId);
      // 若正在一起听的就是这个角色本身，直接忽略（不可能和自己正在听的人重复邀请）
      if (busy && busy.id === charId) return;
      const t = new Date();
      const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      const txt = `在[${hhmm}]想和你一起听歌，但信号好像出了问题`;
      const m = { id: uid('msg'), charId: c.id, from: 'them', type: 'poke', content: txt, time: Date.now() };
      try {
        if (typeof idbPut === 'function') idbPut('messages', m);
        if (typeof currentCharId !== 'undefined' && currentCharId === c.id && document.body.dataset.view === 'chat') {
          if (typeof appendMessage === 'function') appendMessage(m);
        } else if (typeof renderChatList === 'function') renderChatList();
      } catch (e) {}
      if (typeof notifyIncoming === 'function') notifyIncoming(c, `${c.name || 'TA'} 在 ${hhmm} 想和你一起听歌，但信号未能接通`, '听歌邀请未接上', 'call');
      return;
    }
    let card = document.getElementById('bm-invite-card');
    if (card) card.remove();
    const nm = esc(c.name || 'TA');
    const av = avatarImgHTML(c && c.avatar, (c.name || '?')[0]).html;
    const paHtml = avatarImgHTML(playerAvatar(), (playerName() || '我')[0]).html;
    const pn = esc(playerName());
    const lineHeart = `<svg viewBox="0 0 120 40" preserveAspectRatio="none" class="bm-heart-line"><path class="bm-heart-trace" d="M0,20 L36,20 L42,20 L46,7 L51,33 L56,11 L61,20 L120,20" fill="none" stroke="#e5484d" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    card = document.createElement('div');
    card.id = 'bm-invite-card';
    card.className = 'bm-invite-card from-char';
    card.innerHTML = `
      <div class="bm-invite-mask"></div>
      <div class="bm-invite-box">
        <div class="bm-invite-head">${nm} 想和你一起听歌</div>
        <div class="bm-invite-avatars">
          <div class="bm-avt-wrap ta">
            <div class="bm-avt">${av}</div>
            <div class="bm-avt-name">${nm}</div>
          </div>
          <div class="bm-invite-line" id="bm-invite-line">${lineHeart}</div>
          <div class="bm-avt-wrap mine">
            <div class="bm-avt">${paHtml}</div>
            <div class="bm-avt-name">${pn}</div>
          </div>
        </div>
        <div class="bm-invite-tip">${nm} 发起了听歌邀请，要一起听吗？</div>
        <div class="bm-invite-btns">
          <button class="bm-invite-btn no" id="bm-invite-no">拒绝</button>
          <button class="bm-invite-btn yes" id="bm-invite-yes">同意一起听</button>
        </div>
      </div>`;
    document.body.appendChild(card);
    const close = () => card.remove();
    card.querySelector('.bm-invite-mask').onclick = close;
    card.querySelector('#bm-invite-no').onclick = () => {
      close();
      // 拒绝：发一条「已拒绝」小横条到聊天
      if (typeof deliverCharMessage === 'function') {
        deliverCharMessage(c, `${c.name || 'TA'} 想和你一起听歌，但你拒绝了`, 'text').catch(() => {});
      }
      if (window.miniToast) miniToast('已拒绝邀请');
    };
    card.querySelector('#bm-invite-yes').onclick = () => {
      close();
      startTogether(charId);
      if (window.miniToast) miniToast(`已和 ${c.name || 'TA'} 一起听歌`);
    };
  }

  /* 邀请卡片（网易云风格：玩家头像 ↔ 心率连接线 ↔ 角色头像，询问是否一起听）
     连接线固定为心率波形（心电折线 + 扫描流动动画），红线已删除（20261104 用户定案） */
  function showInviteCard(charId) {
    const c = getCharById(charId);
    if (!c) { if (window.miniToast) miniToast('未找到该角色'); return; }
    // 20261104：正在一起听时（无论是否同一角色），不能再发起新的邀请，需先结束
    if (M.state.charId && M.state.togetherSince) {
      const busy = getCharById(M.state.charId);
      if (window.miniToast) miniToast(`正在和 ${busy ? busy.name || 'TA' : 'TA'} 一起听歌，先结束再邀请吧`);
      return;
    }
    let card = document.getElementById('bm-invite-card');
    if (card) card.remove();
    const pn = esc(playerName());
    const av = avatarImgHTML(c && c.avatar, (c.name || '?')[0]).html;
    const paHtml = avatarImgHTML(playerAvatar(), (playerName() || '我')[0]).html;
    // 心率连接：连续心电波形，通过 stroke-dashoffset 动画从左向右「一点一点划过去」（固定，不再切换红线）
    const lineHeart = `<svg viewBox="0 0 120 40" preserveAspectRatio="none" class="bm-heart-line"><path class="bm-heart-trace" d="M0,20 L36,20 L42,20 L46,7 L51,33 L56,11 L61,20 L120,20" fill="none" stroke="#e5484d" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    card = document.createElement('div');
    card.id = 'bm-invite-card';
    card.className = 'bm-invite-card';
    card.innerHTML = `
      <div class="bm-invite-mask"></div>
      <div class="bm-invite-box">
        <div class="bm-invite-head">邀请一起听歌</div>
        <div class="bm-invite-avatars">
          <div class="bm-avt-wrap mine">
            <div class="bm-avt">${paHtml}</div>
            <div class="bm-avt-name">${pn}</div>
          </div>
          <div class="bm-invite-line" id="bm-invite-line">${lineHeart}</div>
          <div class="bm-avt-wrap ta">
            <div class="bm-avt">${av}</div>
            <div class="bm-avt-name">${esc(c.name || 'TA')}</div>
          </div>
        </div>
        <div class="bm-invite-tip">要和 ${esc(c.name || 'TA')} 一起听歌吗？</div>
        <div class="bm-invite-btns">
          <button class="bm-invite-btn no" id="bm-invite-no">取消</button>
          <button class="bm-invite-btn yes" id="bm-invite-yes">邀请 TA</button>
        </div>
      </div>`;
    document.body.appendChild(card);
    const close = () => card.remove();
    card.querySelector('.bm-invite-mask').onclick = close;
    card.querySelector('#bm-invite-no').onclick = close;
    card.querySelector('#bm-invite-yes').onclick = () => {
      close();
      startTogether(charId);
      if (window.miniToast) miniToast(`已邀请 ${c.name || 'TA'} 一起听歌`);
    };
  }


  /* 分享：把当前歌曲分享给某个梦角 → 弹角色选择 → 邀请一起听 */
  function shareToChar() {
    const cur = M.state.current;
    if (!cur) { if (window.miniToast) miniToast('请先搜索并选择一首歌'); return; }
    // 20261104：正在和某角色一起听时，不能再邀请（包括 TA 自己），需先结束一起听
    if (M.state.charId && M.state.togetherSince) {
      const busy = getCharById(M.state.charId);
      if (window.miniToast) miniToast(`正在和 ${busy ? busy.name || 'TA' : 'TA'} 一起听歌，先结束再邀请别人吧`);
      return;
    }
    const list = (typeof characters !== 'undefined' && Array.isArray(characters)) ? characters : [];
    if (!list.length) { if (window.miniToast) miniToast('还没有梦角，先去创建角色吧'); return; }
    let box = document.getElementById('bm-share-picker');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'bm-share-picker';
    box.className = 'bm-share-picker';
    const items = list.map(c => `
      <button class="bm-share-item" data-id="${esc(c.id)}">
        <span class="bm-share-avt">${charAvatarUrl(c) ? `<img src="${esc(charAvatarUrl(c))}" alt="">` : esc((c.name || '?')[0])}</span>
        <span class="bm-share-name">${esc(c.name || 'TA')}</span>
      </button>`).join('');
    box.innerHTML = `
      <div class="bm-share-mask"></div>
      <div class="bm-share-box">
        <div class="bm-share-head">把《${esc(cur.name)}》分享给谁</div>
        <div class="bm-share-grid">${items}</div>
        <button class="bm-share-cancel" id="bm-share-cancel">取消</button>
      </div>`;
    document.body.appendChild(box);
    const close = () => box.remove();
    box.querySelector('.bm-share-mask').onclick = close;
    box.querySelector('#bm-share-cancel').onclick = close;
    box.querySelectorAll('.bm-share-item').forEach(btn => {
      btn.onclick = () => { const id = btn.dataset.id; close(); showInviteCard(id); };
    });
  }

  /* 20261104：「邀请一起听」按钮——不依赖当前有没有歌，直接弹角色选择器，
     选一个角色 → 发邀请函（showInviteCard）。点同意后才真正一起听。 */
  function inviteTogetherPicker() {
    // 正在和某角色一起听时，不能再邀请（包括 TA 自己），需先结束
    if (M.state.charId && M.state.togetherSince) {
      const busy = getCharById(M.state.charId);
      if (window.miniToast) miniToast(`正在和 ${busy ? busy.name || 'TA' : 'TA'} 一起听歌，先结束再邀请别人吧`);
      return;
    }
    const list = (typeof characters !== 'undefined' && Array.isArray(characters)) ? characters : [];
    if (!list.length) { if (window.miniToast) miniToast('还没有梦角，先去创建角色吧'); return; }
    let box = document.getElementById('bm-invite-picker');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'bm-invite-picker';
    box.className = 'bm-share-picker';
    const items = list.map(c => `
      <button class="bm-share-item" data-id="${esc(c.id)}">
        <span class="bm-share-avt">${charAvatarUrl(c) ? `<img src="${esc(charAvatarUrl(c))}" alt="">` : esc((c.name || '?')[0])}</span>
        <span class="bm-share-name">${esc(c.name || 'TA')}</span>
      </button>`).join('');
    box.innerHTML = `
      <div class="bm-share-mask"></div>
      <div class="bm-share-box">
        <div class="bm-share-head">邀请谁一起听歌</div>
        <div class="bm-share-grid">${items}</div>
        <button class="bm-share-cancel" id="bm-share-cancel">取消</button>
      </div>`;
    document.body.appendChild(box);
    const close = () => box.remove();
    box.querySelector('.bm-share-mask').onclick = close;
    box.querySelector('#bm-share-cancel').onclick = close;
    box.querySelectorAll('.bm-share-item').forEach(btn => {
      btn.onclick = () => { const id = btn.dataset.id; close(); showInviteCard(id); };
    });
  }

  /* 角色点评：从角色视角生成一句歌评（本地拼句，不依赖 AI） */
  function pickComment(songName, charName) {
    const templates = [
      `「${charName}」听着《${songName}》，轻轻跟着哼了一句：这首歌的旋律，像我们之间没说出口的话。`,
      `「${charName}」把头靠过来：这首《${songName}》，让我想起第一次见你的那天。`,
      `「${charName}」闭上眼说：别说话，就陪我把《${songName}》听完。`,
      `「${charName}」指尖打着节拍：《${songName}》……原来你也喜欢这种调调。`,
      `「${charName}」笑了一下：和《${songName}》一起的这一刻，我会一直记得。`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /* 点评气泡：在歌词区上方短暂显示角色头像 + 歌评，几秒后淡出 */
  let _commentTimer = null;
  function showCommentBubble(text, name, avatar) {
    let cb = document.getElementById('bm-music-commentbubble');
    if (!cb) {
      cb = document.createElement('div');
      cb.id = 'bm-music-commentbubble';
      cb.className = 'bm-music-commentbubble';
      document.getElementById('bm-music-stage').appendChild(cb);
    }
    cb.innerHTML = `
      <span class="bm-cb-avt">${avatar ? `<img src="${esc(avatar)}" alt="">` : esc((name || 'TA')[0])}</span>
      <span class="bm-cb-text">${esc(text)}</span>`;
    cb.classList.add('show');
    if (_commentTimer) clearTimeout(_commentTimer);
    _commentTimer = setTimeout(() => cb.classList.remove('show'), 5000);
  }

  /* 20261104：评论面板——点评论按钮弹出，含「角色点评」+「玩家写评论」。
     玩家评论存 musicHistory kind:'comment'（带 songId/name/comment），可查看历史评论。 */
  async function showCommentPanel() {
    const cur = M.state.current;
    if (!cur) { if (window.miniToast) miniToast('请先搜索并选择一首歌'); return; }
    let panel = document.getElementById('bm-comment-panel');
    if (panel) { panel.remove(); return; }
    const c = currentChar();
    const nm = c ? c.name : 'TA';
    // 拉该歌的玩家历史评论（按 songId 过滤）
    let myComments = [];
    try {
      const all = await M.getHistory('comment');
      myComments = (all || []).filter(x => x.songId === cur.id).sort((a, b) => b.ts - a.ts);
    } catch (e) {}
    panel = document.createElement('div');
    panel.id = 'bm-comment-panel';
    panel.className = 'bm-comment-panel';
    panel.innerHTML = `
      <div class="bm-comment-mask"></div>
      <div class="bm-comment-card">
        <div class="bm-comment-head">
          <span>《${esc(cur.name)}》的评论</span>
          <button class="bm-comment-close" id="bm-comment-close">✕</button>
        </div>
        <button class="bm-comment-char" id="bm-comment-char">${window.icon ? window.icon('comment', 16) : '💬'} 让 ${esc(nm)} 点评这首歌</button>
        <div class="bm-comment-inputrow">
          <input class="bm-comment-input" id="bm-comment-input" placeholder="写下你的评论…" maxlength="200" />
          <button class="bm-comment-submit" id="bm-comment-submit">发表</button>
        </div>
        <div class="bm-comment-list" id="bm-comment-list">
          ${myComments.length ? myComments.map(x => `<div class="bm-comment-item"><span class="bm-comment-mine">我</span><span class="bm-comment-text">${esc(x.comment)}</span><span class="bm-comment-time">${_fmtPeekTime(x.ts)}</span></div>`).join('') : '<div class="bm-music-empty">还没有评论，写下第一条吧</div>'}
        </div>
      </div>`;
    document.body.appendChild(panel);
    const close = () => panel.remove();
    panel.querySelector('.bm-comment-mask').onclick = close;
    panel.querySelector('.bm-comment-close').onclick = close;
    // 角色点评（复用 pickComment + 气泡）
    panel.querySelector('#bm-comment-char').onclick = () => {
      const comment = pickComment(cur.name, nm);
      showCommentBubble(comment, nm, c ? charAvatarUrl(c) : '');
    };
    // 玩家发表评论
    const input = panel.querySelector('#bm-comment-input');
    const submit = () => {
      const txt = input.value.trim();
      if (!txt) { if (window.miniToast) miniToast('评论内容不能为空'); return; }
      M.addHistory({ kind: 'comment', songId: cur.id, name: cur.name, comment: txt, ts: Date.now() }).then(() => {
        input.value = '';
        showCommentPanel();   // 重开刷新评论列表
        if (window.miniToast) miniToast('评论已发表');
      });
    };
    panel.querySelector('#bm-comment-submit').onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ---------- 显示一起听歌时长 ---------- */
  function togetherText() {
    if (!M.state.togetherSince) return '';
    const sec = Math.floor((Date.now() - M.state.togetherSince) / 1000);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? `${h}小时${m}分` : (m > 0 ? `${m}分${s}秒` : `${s}秒`);
  }

  /* ============================================================
     独立听歌页（全屏 overlay，非弹窗，兼容 PC/手机）
     ============================================================ */
  function showMusicPage(charId) {
    // 防止重复创建
    if (document.getElementById('bm-music-page')) return;
    // 20261104 修复「进音乐页听歌自动一起听」：从角色加号进音乐页只是普通听歌，
    //   不绑定任何角色。charId 参数忽略——只有玩家点「邀请一起听」同意后（startTogether）
    //   才设置 M.state.charId + togetherSince，真正进入一起听。
    // 20261103：防御——开屏已结束但 splash canvas 残留时主动移除，避免遮挡整页按钮
    if (window.__bmSplashEndAt && document.getElementById('splash-v5-canvas')) {
      try { const c = document.getElementById('splash-v5-canvas'); if (c && c.parentNode) c.parentNode.removeChild(c); } catch (e) {}
    }
    const overlay = document.createElement('div');
    overlay.id = 'bm-music-page';
    overlay.className = 'bm-music-page';
    const cur = M.state.current;
    overlay.innerHTML = `
      <div class="bm-music-head">
        <button class="bm-music-back" id="bm-music-back">${window.icon ? window.icon('back', 22) : '‹'}</button>
        <div class="bm-music-title">一起听歌</div>
        <button class="bm-music-headbtn" id="bm-music-libbtn" title="音乐库">${window.icon ? window.icon('musiclib', 20) : '♬'}</button>
        <button class="bm-music-headbtn" id="bm-music-themebtn" title="外观（主题 + 背景）">${window.icon ? window.icon('palette', 20) : '🖼'}</button>
      </div>
      <div class="bm-music-modes" id="bm-music-modes">
        <button class="bm-mode" data-mode="mirror">镜像搜索</button>
        <button class="bm-mode" data-mode="remote">后台遥控</button>
        <button class="bm-mode" data-mode="local">本地与解析</button>
      </div>
      <div class="bm-music-together" id="bm-music-together" style="display:none;">
        <span class="bm-together-avt" id="bm-together-avt"></span>
        <span class="bm-together-text" id="bm-together-text">正在一起听</span>
        <button class="bm-together-end" id="bm-together-end">结束一起听</button>
      </div>
      <div class="bm-music-stage">
        <div class="bm-music-visual" id="bm-music-visual">
          ${planetHTML(200)}
        </div>
        <div class="bm-music-now">
          <div class="bm-music-title2" id="bm-music-title2">${cur ? esc(cur.name) : '未在播放'}</div>
          <div class="bm-music-artist" id="bm-music-artist">${cur ? esc(cur.artist) : '—'}</div>
        </div>
        <div class="bm-music-lyric" id="bm-music-lyric"></div>
      </div>
      <div class="bm-music-progress" id="bm-music-progress">
        <span class="bm-prog-time" id="bm-prog-cur">00:00</span>
        <input type="range" class="bm-progress-slider" id="bm-progress-slider" min="0" max="1000" value="0" step="1" />
        <span class="bm-prog-time" id="bm-prog-dur">00:00</span>
      </div>
      <div class="bm-music-searchtool" id="bm-music-searchtool">
        <div class="bm-tool-left">
          <button class="bm-tool-invite bm-tool-icononly" id="bm-music-invite" title="邀请角色一起听歌">
            <span class="bm-invite-avt">${avatarImgHTML(playerAvatar(), (playerName() || '我')[0]).html}</span>
            <span class="bm-invite-plus">${window.icon ? window.icon('plus', 12) : '+'}</span>
          </button>
          <button class="bm-tool-share bm-tool-icononly" id="bm-music-share" title="把这首歌分享给梦角">${window.icon ? window.icon('share', 17) : '↗'}</button>
          <button class="bm-tool-comment bm-tool-icononly" id="bm-music-comment" title="让角色点评这首歌">${window.icon ? window.icon('comment', 17) : '💬'}</button>
          <button class="bm-tool-vol bm-tool-icononly" id="bm-music-volbtn" title="调节音量">${window.icon ? window.icon('volume', 17) : '🔊'}</button>
        </div>
        <div class="bm-tool-right" id="bm-tool-right">
          <button class="bm-tool-fav bm-tool-icononly" id="bm-music-fav" title="收藏到音乐库">${window.icon ? window.icon('star', 17) : '☆'}</button>
          <button class="bm-tool-dl bm-tool-icononly" id="bm-music-dl" title="下载歌曲">${window.icon ? window.icon('download', 17) : '↓'}</button>
          <button class="bm-tool-float bm-tool-icononly" id="bm-music-floatbtn" title="悬浮窗（开启/关闭 + 悬浮方式）">${window.icon ? window.icon('float', 17) : '◱'}</button>
        </div>
      </div>
      <div class="bm-music-search" id="bm-music-searchbox">
        <input class="bm-music-input" id="bm-music-input" placeholder="搜索歌曲…" />
        <button class="bm-music-gobtn" id="bm-music-go">搜索</button>
        <button class="bm-music-parsebtn" id="bm-music-parse" title="粘贴歌单链接解析整张歌单">解析歌单</button>
        <button class="bm-tool-source" id="bm-music-source" title="选择音源路径">${window.icon ? window.icon('list', 16) : '☰'} 音源</button>
      </div>
      <div class="bm-music-results" id="bm-music-results"></div>
      <div class="bm-music-ctrl">
        <button class="bm-ctrl-btn bm-ctrl-side" id="bm-music-mode" title="播放模式">${window.icon ? window.icon('repeat', 18) : '🔁'}</button>
        <button class="bm-ctrl-btn" id="bm-music-prev">${window.icon ? window.icon('prev', 22) : '‹‹'}</button>
        <button class="bm-ctrl-btn bm-ctrl-main" id="bm-music-pp">${window.icon ? window.icon('play', 26) : '▶'}</button>
        <button class="bm-ctrl-btn" id="bm-music-next">${window.icon ? window.icon('next', 22) : '››'}</button>
        <button class="bm-ctrl-btn bm-ctrl-side" id="bm-music-list" title="播放列表">${window.icon ? window.icon('list', 18) : '≡'}</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // 三模式切换：按钮永远可点、可自由切换；「选中」只是高亮当前模式，
    // 另外两个模式的功能面板（搜索/遥控/本地）自动隐藏，但按钮本身不灰、不锁。
    const modeBtns = overlay.querySelectorAll('.bm-mode');
    function setMode(mode) {
      M.state.mode = mode;
      modeBtns.forEach(b => {
        const isOn = b.dataset.mode === mode;
        b.classList.toggle('on', isOn);
        b.classList.remove('off');       // 20261104 修正：不再给未选模式加灰色禁用态
        b.disabled = false;              // 按钮永远可点
        b.title = isOn ? '当前模式' : '切换到「' + modeLabel(b.dataset.mode) + '」';
      });
      // 20261106 互斥：切到「后台遥控」时强制关掉网易云直连（两套状态真互斥，
      //   否则 _netEaseDirect 残留 true 会让所有遥控分支失效、角色互动权重归零）。
      //   切到 mirror/local 时也同步清掉遥控态心跳。
      if (mode === 'remote') {
        if (_netEaseDirect) { _netEaseSetDirect(false); }
      }
      // 20261106：remote 模式启动「真实态」心跳，其余模式停止
      if (mode === 'remote') { _startLiveExternalHeartbeat(); }
      else { _stopLiveExternalHeartbeat(); _liveExternal = null; _liveExternalAt = 0; }
      // 20261106：切换模式立即落库，重进记住上次选的模式
      M.saveSession();
      renderModePanel(mode);
    }
    function modeLabel(mode) {
      return ({ mirror: '镜像搜索', remote: '后台遥控', local: '本地与解析' })[mode] || mode;
    }
    modeBtns.forEach(b => {
      b.onclick = () => setMode(b.dataset.mode);
    });
    setMode(M.state.mode);

    // 返回（20261105：先关子层弹窗，子层关完才退音乐页，栈式返回）
    overlay.querySelector('#bm-music-back').onclick = () => backMusicPage();
    // 20261105：一起听歌页滑动返回手势——从屏幕最左边缘向右滑（超过阈值）触发返回，
    //   与左上角「‹ 返回」按钮等价，回到上一个功能界面（栈式返回，不是退出 App）。
    // 20261105 修复：EDGE 从 24 放宽到 56（用户反馈「手势滑动没识别」——从偏内侧起步滑动未被捕获），
    //   且横滑阈值 THRESH 从 70 降到 50，更易触发。
    (function bindSwipeBack() {
      const EDGE = 56, THRESH = 50;
      let sx = 0, sy = 0, tracking = false;
      overlay.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { tracking = false; return; }
        const t = e.touches[0];
        // 只在页面最左边缘区域触发，避免与内容横向滑动（如搜索结果/进度条）冲突
        if (t.clientX <= EDGE) { tracking = true; sx = t.clientX; sy = t.clientY; }
        else tracking = false;
      }, { passive: true });
      overlay.addEventListener('touchmove', (e) => {
        if (!tracking) return;
        const t = e.touches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        // 横向为主才算返回手势，避免与纵向滚动冲突
        if (dx > THRESH && Math.abs(dx) > Math.abs(dy) * 1.2) {
          tracking = false;
          backMusicPage();
        }
      }, { passive: true });
      overlay.addEventListener('touchend', () => { tracking = false; }, { passive: true });
    })();
    // 音乐库按钮 → 弹管理弹窗
    overlay.querySelector('#bm-music-libbtn').onclick = () => showMusicLib();
    // 外观按钮 → 弹「主题 + 背景」合并弹窗
    const themeBtn = overlay.querySelector('#bm-music-themebtn');
    applyMusicTheme();
    applyMusicBg();
    themeBtn.onclick = () => showThemePicker();

    // 搜索
    const input = overlay.querySelector('#bm-music-input');
    const doSearch = async () => {
      const kw = input.value.trim();
      if (!kw) return;
      const list = await M.search(kw);
      renderResults(list);
    };
    overlay.querySelector('#bm-music-go').onclick = doSearch;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    // 20261105：解析歌单按钮 → 本地模式点它先自动切到「镜像搜索」模式再去解析（歌单解析
    //   依赖镜像站，本地模式无镜像可解析，会报「未获取到播放直链」）。镜像/后台遥控模式直接弹。
    overlay.querySelector('#bm-music-parse').onclick = () => {
      if (M.state.mode === 'local') {
        setMode('mirror');
        if (window.miniToast) miniToast('已切到镜像搜索模式解析歌单');
      }
      showParsePlaylist();
    };
    // 搜索框聚焦时，若结果列表是收起状态则自动展开，方便再次搜索
    input.addEventListener('focus', () => {
      const results = document.getElementById('bm-music-results');
      if (results && results.classList.contains('collapsed')) {
        results.classList.remove('collapsed');
        const t = results.querySelector('#bm-results-toggle');
        if (t) t.innerHTML = '<span class="bm-caret">▾</span> 收起';
      }
    });
    // 点上方空白处（舞台区）自动收起搜索结果列表
    const stage = overlay.querySelector('.bm-music-stage');
    if (stage) {
      stage.addEventListener('click', (e) => {
        // 只有点击 stage 本身或空白处（非结果列表）才收起
        if (e.target.closest('#bm-music-results')) return;
        collapseResults();
      });
    }
    // 收起搜索结果列表（供全局调用）
    window.__collapseMusicResults = collapseResults;

    // 悬浮窗按钮（20261105 合并：一个图标承载「开启/关闭悬浮窗」+「悬浮方式」两个功能，
    //   点击后弹出合并小面板，面板里可切换开关、选择软件内/其他应用悬浮，不再有第二个图标）。
    const floatBtn = overlay.querySelector('#bm-music-floatbtn');
    floatBtn.onclick = async (e) => {
      e.stopPropagation();
      showFloatPanel(floatBtn);
    };
    syncFloatBtn();
    // 评论按钮：弹评论面板（角色点评 + 玩家写评论）
    overlay.querySelector('#bm-music-comment').onclick = () => showCommentPanel();
    // 分享按钮：把当前这首歌分享给某个梦角，进入「一起听歌」状态
    overlay.querySelector('#bm-music-share').onclick = () => shareToChar();
    // 邀请按钮（玩家头像+加号）：点击选择角色发邀请一起听
    const inviteBtn = overlay.querySelector('#bm-music-invite');
    if (inviteBtn) inviteBtn.onclick = () => inviteTogetherPicker();
    // 结束一起听按钮：当前已和某角色一起听时显示，点击结束（结束后其他角色才能发新邀请）
    overlay.querySelector('#bm-together-end').onclick = () => endTogether();
    // 音源路径选择按钮
    overlay.querySelector('#bm-music-source').onclick = () => showSourcePicker();
    // 收藏按钮：把当前播放的歌曲收藏进音乐库
    overlay.querySelector('#bm-music-fav').onclick = async () => {
      const cur = M.state.current;
      if (!cur) { if (window.miniToast) miniToast('请先搜索并选择一首歌'); return; }
      const full = await M.fetchSongDetail(cur);
      if (!full || !full.id) { if (window.miniToast) miniToast('收藏失败：未获取到歌曲信息'); return; }
      // 20261105 修复「提示已收藏但音乐库为空」：收藏按钮此前写死 source:'mirror'，
      //   而音乐库「歌曲」tab 按当前模式查（mirror 模式查 mirror、local 模式查 local），
      //   导致 local/解析模式下收藏的歌存进 mirror 库、音乐库却查 local 库 → 永远看不到。
      //   现改为按当前模式存 source，保证「存哪库、音乐库就查哪库」一致。
      const src = M.state.mode === 'mirror' ? 'mirror' : 'local';
      // 判断是否已收藏（按 id 查对应来源音乐库）
      let already = false;
      try {
        const lib = await M.getLocalLibrary(src);
        already = (lib || []).some(x => String(x.id) === String(full.id));
      } catch (e) {}
      if (already) {
        if (window.miniToast) miniToast(`《${full.name}》已经在音乐库了`);
        return;
      }
      await M.addLocalTrack({ id: full.id, name: full.name, artist: full.artist, album: full.album, pic: full.pic, url: full.url, lrc: full.lrc, source: src });
      // 20261106：收藏成功 → 图标放大回弹 + 粒子炸开
      if (window.bmFx) {
        const btn = overlay.querySelector('#bm-music-fav');
        if (btn) window.bmFx.burst(btn.querySelector('svg') || btn, { color: '#f5c97b' });
      }
      if (window.miniToast) miniToast(`《${full.name}》已加入音乐库`);
    };
    // 下载按钮：下载当前播放的歌曲音频
    overlay.querySelector('#bm-music-dl').onclick = async () => {
      const cur = M.state.current;
      if (!cur) { if (window.miniToast) miniToast('请先搜索并选择一首歌'); return; }
      const full = await M.fetchSongDetail(cur);
      if (!full.url) { if (window.miniToast) miniToast('未获取到下载地址'); return; }
      downloadSong(full);
    };

    // 控制键（20261104：模式二 remote 下走后台遥控）
    // 20261105：与角色动作/悬浮窗 isRemote 判断对齐——加 && !_netEaseDirect，
    //   开了直连后音乐页控制键也走内置播放器，不再误发外部 App。
    // 20261107 修复「直连模式下点播放/上一首还遥控外部 App」：isRemote 之前是渲染时 const 一次计算，
    //   闭包捕获了当时的 mode/_netEaseDirect，用户之后切到「网易云直连」时它不更新，仍残留 true 走遥控。
    //   改为「点击时才实时计算」的函数，确保直连开关切换后立即生效、直连/遥控真正互斥。
    const _isRemotePage = () => (M.state.mode === 'remote') && !_netEaseDirect;
    overlay.querySelector('#bm-music-prev').onclick = () => { if (_isRemotePage()) { _remoteAction({ bridge: 'prev', local: () => M.prev() }, null); refreshPlayerUI(); } else M.prev(); };
    overlay.querySelector('#bm-music-next').onclick = () => { if (_isRemotePage()) { _remoteAction({ bridge: 'next', local: () => M.next() }, null); refreshPlayerUI(); } else M.next(); };
    // 20261105 修复「外部网易云在播时点播放/暂停，内部残留旧歌与外部歌同时响（打架）」：
    //   点播放/暂停时，若检测到外部有活跃媒体会话，优先发 toggle 指令给外部 App（操控后台那首歌），
    //   而非操作内部残留 audio。无外部会话时才回落到内置播放器。
    // 20261105 二次修复「直连模式下点播放却操控后台音乐」+「镜像/本地模式下也误操控后台」：
    //   三模式互斥——只有「后台遥控」模式（mode==='remote' 且未开直连）才操控外部 App；
    //   直连（_netEaseDirect）或镜像搜索（mirror）/本地（local）模式一律走内置播放器 M.toggle()，
    //   绝不查外部活跃会话、绝不发 bridge 指令。之前只判 _netEaseDirect，漏了 mirror/local
    //   也会误查 hasActiveSession 遥控外部。
    const _isRemoteMode = () => (M.state.mode === 'remote') && !_netEaseDirect;
    const _ppToggle = async () => {
      if (!_isRemoteMode()) {
        if (!M.state.current) { window.miniToast && miniToast('请先搜索并选择一首歌'); return; }
        M.toggle();
        return;
      }
      const br = _remoteBridge();
      if (br && typeof br.hasActiveSession === 'function') {
        try {
          const r = await br.hasActiveSession();
          if (r && r.hasSession) {
            await _remoteAction({ bridge: 'toggle', local: () => M.toggle() }, null);
            refreshPlayerUI();
            return;
          }
        } catch (e) {}
      }
      if (!M.state.current) { window.miniToast && miniToast('请先搜索并选择一首歌'); return; }
      M.toggle();
    };
    overlay.querySelector('#bm-music-pp').onclick = _ppToggle;
    overlay.querySelector('#bm-music-mode').onclick = () => { M.cyclePlayMode(); updateCtrlState(); };
    overlay.querySelector('#bm-music-list').onclick = () => showPlaylist();
    // 音量：点击音量按钮 → 弹出竖条音量拖动浮层，拖动调节音量（0~100%），实时生效并持久化
    const volBtn = overlay.querySelector('#bm-music-volbtn');
    if (volBtn) {
      const initVol = (typeof M.getVolume === 'function') ? M.getVolume() : 1;
      const refreshVolIcon = (v) => {
        if (volBtn) volBtn.innerHTML = window.icon ? window.icon(v === 0 ? 'mute' : 'volume', 17) : (v === 0 ? '🔇' : '🔊');
      };
      refreshVolIcon(initVol);
      volBtn.onclick = (e) => {
        e.stopPropagation();
        // 已有浮层则关闭
        const old = document.getElementById('bm-volume-pop');
        if (old) { old.remove(); return; }
        const pop = document.createElement('div');
        pop.id = 'bm-volume-pop';
        pop.className = 'bm-volume-pop';
        const curVol = Math.round(initVol * 100);
        pop.innerHTML = `
          <div class="bm-volume-pop-track">
            <input type="range" class="bm-vol-vslider" id="bm-vol-pop-slider" min="0" max="100" value="${curVol}" orient="vertical" />
          </div>
          <span class="bm-volume-pop-val" id="bm-vol-pop-val">${curVol}</span>
        `;
        document.body.appendChild(pop);
        // 定位到音量按钮上方
        const r = volBtn.getBoundingClientRect();
        pop.style.left = (r.left + r.width / 2) + 'px';
        pop.style.bottom = (window.innerHeight - r.top + 10) + 'px';
        pop.style.transform = 'translateX(-50%)';
        const slider = pop.querySelector('#bm-vol-pop-slider');
        const valEl = pop.querySelector('#bm-vol-pop-val');
        slider.oninput = () => {
          const v = parseInt(slider.value, 10);
          valEl.textContent = v;
          if (typeof M.setVolume === 'function') M.setVolume(v / 100);
          refreshVolIcon(v / 100);
        };
        // 点外部关闭
        const close = (ev) => {
          if (pop && !pop.contains(ev.target) && ev.target !== volBtn) { pop.remove(); document.removeEventListener('click', close); }
        };
        setTimeout(() => document.addEventListener('click', close), 0);
      };
    }
    // 进度条：拖动 seek（0~1000 对应全曲），实时更新时间显示
    const progSlider = overlay.querySelector('#bm-progress-slider');
    let _seeking = false;
    // 20261105：fmtTime 已提到模块级（_fmtTime），此处复用，不再局部重复定义。
    if (progSlider) {
      progSlider.oninput = () => {
        _seeking = true;
        const a = M.state.audio;
        const cur = document.getElementById('bm-prog-cur');
        // 20261105：duration 失效时用缓存兜底
        const d = (a && isFinite(a.duration) && a.duration > 0) ? a.duration : _cachedDuration;
        if (a && d > 0) {
          const t = (parseInt(progSlider.value, 10) / 1000) * d;
          if (cur) cur.textContent = _fmtTime(t);
        }
      };
      progSlider.onchange = () => {
        const a = M.state.audio;
        const d = (a && isFinite(a.duration) && a.duration > 0) ? a.duration : _cachedDuration;
        if (a && d > 0) {
          const t = (parseInt(progSlider.value, 10) / 1000) * d;
          try { a.currentTime = t; } catch (e) {}
        }
        _seeking = false;
      };
      // 20261105：进度刷新统一走模块级 window.__bmUpdateProgress（见悬浮窗模块顶部定义），
      //   此处不再重复定义，避免「未打开音乐页则全局函数缺失」导致悬浮窗时长永不刷新。
    }

    // 律动星球动画启动
    startPlanetAnimation();
    // 初始渲染
    refreshPlayerUI();
    updateCtrlState();
  }

  /* 播放列表弹层：弹窗（带遮罩），展示当前 playlist，可点击切歌。
     每首歌右侧一个「⋯」更多操作按钮（下一首播放 / 收藏 / 加入歌单 / 删除）。
     20261104 重构：
       · 去掉冗余的加号+叉号，统一为「⋯」菜单，不再出现「三个点是摆设」。
       · 操作（收藏/删除/排到下一首）后弹窗保持打开（重渲染），只有点关闭/遮罩/切歌才关。
       · 「管理」进入批量管理模式：每首歌出勾选框 + 全选 + 底部「删除所选」。
       · 暂停状态下点任意歌曲也能切歌播放。 */
  /* 20261105：悬浮窗专用「迷你播放列表」——点悬浮窗的列表按钮弹出的小列表，
     与音乐页面的完整播放列表（showPlaylist）独立。极简：每行 = 封面缩略图 + 歌名 + 歌手，
     高度约完整列表的 1/3，半透明、贴在悬浮窗附近，不遮挡软件内画面。点某行切歌。
     只做查看 + 切歌，不带收藏/删除/管理。 */
  /* 20261105：悬浮窗迷你播放列表——独立浮层，默认停在「一起听歌」悬浮窗正上方；
     表头可拖动整个列表；点击列表按钮展开/收起。
     跟随悬浮窗主题（CSS 变量 + 文字深浅/背景玻璃档位），小且细，不遮其他画面。 */
  function showFloatMiniList(anchorEl) {
    let panel = document.getElementById('bm-float-minilist');
    if (panel) { panel.remove(); return; }
    const list = M.state.playlist || [];
    const cur = M.state.current;
    panel = document.createElement('div');
    panel.id = 'bm-float-minilist';
    panel.className = 'bm-float-minilist';
    panel.innerHTML = `
      <div class="bm-fml-head">
        <span class="bm-fml-title">播放列表（${list.length}）</span>
        <button class="bm-fml-close">${window.icon ? window.icon('close', 13) : '✕'}</button>
      </div>
      <div class="bm-fml-body">
        ${list.length ? list.map((s, i) => `
          <div class="bm-fml-item ${String(s.id) === String(cur && cur.id) ? 'on' : ''}" data-i="${i}">
            <span class="bm-fml-cover">${s.pic ? coverImgHTML(s.pic) : '♪'}</span>
            <div class="bm-fml-info">
              <div class="bm-fml-name">${esc(s.name)}</div>
              <div class="bm-fml-artist">${esc(s.artist || '')}</div>
            </div>
          </div>`).join('') : '<div class="bm-fml-empty">暂无播放列表</div>'}
      </div>`;
    document.body.appendChild(panel);

    // 跟随悬浮窗主题（文字深浅 + 背景玻璃/浅底/深底）
    panel.classList.add('ftext-' + _floatTextMode(), 'fbg-' + _floatBgMode());

    // 定位：默认停在「一起听歌」悬浮窗正上方（读取悬浮窗位置，水平居中对齐）
    const fw = document.getElementById('bm-music-float');
    const placeAboveFloat = () => {
      // 20261105 修复「点列表按钮没反应」：面板其实弹出了，但被定位到视口外（用户看不见）。
      //   根因：面板刚 append 时 offsetHeight 可能读到 0（未 reflow），且悬浮窗(dot)贴近屏幕底边，
      //   y = r.top - ph - 8 算出后又被 Math.min(innerHeight-ph-6) 钳到视口底边之外。
      //   修复：先强制 reflow 拿到真实尺寸；上方放不下就自动落到悬浮窗下方；最终硬钳制进视口内。
      void panel.offsetHeight;           // 强制 reflow，确保 offsetWidth/Height 为真实布局值
      const pw = panel.offsetWidth || 200, ph = panel.offsetHeight || 100;
      let x, y;
      if (fw) {
        const r = fw.getBoundingClientRect();
        x = r.left + (r.width - pw) / 2;   // 水平居中于悬浮窗
        y = r.top - ph - 8;                 // 悬浮窗正上方 8px
        // 上方放不下（y < 6）时，改放到悬浮窗下方，避免顶出视口
        if (y < 6) y = r.bottom + 8;
      } else {
        x = window.innerWidth - pw - 16;
        y = window.innerHeight - ph - 120;
      }
      // 收进屏内（用真实 ph，保证面板整体可见）
      x = Math.max(6, Math.min(window.innerWidth - pw - 6, x));
      y = Math.max(6, Math.min(window.innerHeight - ph - 6, y));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    };
    placeAboveFloat();

    // 表头作为拖动手柄，整个列表可拖动（独立于悬浮窗）
    let drag = null;
    const head = panel.querySelector('.bm-fml-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.bm-fml-close')) return;   // 关闭按钮不触发拖动
      e.preventDefault();
      drag = { px: e.clientX, py: e.clientY, left: panel.offsetLeft, top: panel.offsetTop };
      panel.setPointerCapture && panel.setPointerCapture(e.pointerId);
      panel.classList.add('dragging');
    });
    panel.addEventListener('pointermove', (e) => {
      if (!drag) return;
      let nx = drag.left + (e.clientX - drag.px);
      let ny = drag.top + (e.clientY - drag.py);
      nx = Math.max(6, Math.min(window.innerWidth - panel.offsetWidth - 6, nx));
      ny = Math.max(6, Math.min(window.innerHeight - panel.offsetHeight - 6, ny));
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
    });
    const endDrag = () => { drag = null; panel.classList.remove('dragging'); };
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);

    // 事件
    panel.querySelector('.bm-fml-close').onclick = () => panel.remove();
    panel.querySelectorAll('.bm-fml-item').forEach(el => {
      el.onclick = () => {
        const i = parseInt(el.dataset.i, 10);
        M.state.playIndex = i;
        M.playPrepared(i);
        // 20261105：选歌后不自动关闭列表小窗（用户明确：选了歌它应该能继续存在，
        //   只有点关闭按钮、或再点一次播放列表按钮才关）。选中后只更新当前曲目高亮。
        panel.querySelectorAll('.bm-fml-item').forEach(x => x.classList.remove('on'));
        el.classList.add('on');
      };
    });
  }

  /* 相对时间：把时间戳转成「x分钟前 / x小时前 / x天前 / 日期」短文案（历史播放用） */
  function _relTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 0) return '';
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + '分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + '小时前';
    const d = Math.floor(h / 24);
    if (d < 7) return d + '天前';
    const dt = new Date(ts);
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
  }

  function showPlaylist() {
    let panel = document.getElementById('bm-playlist-panel');
    if (panel) { panel.remove(); setListBtnOn(false); return; }
    const list = M.state.playlist || [];
    const page = document.getElementById('bm-music-page');
    const host = page || document.body;
    panel = document.createElement('div');
    panel.id = 'bm-playlist-panel';
    panel.className = 'bm-playlist-panel';
    // 管理模式状态（本次打开期间，全选勾选集合）
    let manageMode = false;
    const selected = new Set();
    // 当前 Tab：'now'（当前播放）/'history'（历史播放）
    let tab = 'now';
    // 来源标签（当前播放列表的来源）：镜像/本地/网易云直连/遥控
    const srcLabel = (() => {
      const m = M.state.mode;
      if (_netEaseDirect) return '网易云 · 私人漫游';
      if (m === 'remote') return '后台音乐 App';
      if (m === 'local') return '本地与解析';
      return '镜像搜索';
    })();
    panel.innerHTML = `
      <div class="bm-playlist-mask" id="bm-playlist-mask"></div>
      <div class="bm-playlist-card">
        <div class="bm-playlist-grip"></div>
        <div class="bm-playlist-head">
          <div class="bm-playlist-tabs">
            <span class="bm-playlist-tab on" data-tab="now">当前播放<span class="bm-playlist-count" id="bm-playlist-count">${list.length}</span></span>
            <span class="bm-playlist-tab" data-tab="history">历史播放</span>
          </div>
          <div class="bm-playlist-headbtns">
            <button class="bm-playlist-icon" id="bm-playlist-manage" title="管理">${window.icon ? window.icon('listview', 18) : '☰'}</button>
            <button class="bm-playlist-icon" id="bm-playlist-trash" title="清空播放列表">${window.icon ? window.icon('trash', 18) : '🗑'}</button>
          </div>
        </div>
        <div class="bm-playlist-src" id="bm-playlist-src">来自：<b>${esc(srcLabel)}</b></div>
        <div class="bm-playlist-body" id="bm-playlist-body"></div>
        <div class="bm-playlist-tip">— 边听边推荐，越听越精准 —</div>
        <div class="bm-playlist-foot" id="bm-playlist-foot">
          <button class="bm-playlist-pill" id="bm-playlist-inf">∞ 无限播放</button>
          <button class="bm-playlist-pill" id="bm-playlist-crossfade">智能过渡</button>
        </div>
        <div class="bm-playlist-foot-manage" id="bm-playlist-foot-manage" style="display:none;">
          <button class="bm-playlist-selall" id="bm-playlist-selall">全选</button>
          <button class="bm-playlist-delall" id="bm-playlist-delall">删除所选</button>
        </div>
      </div>`;
    host.appendChild(panel);

    // 关闭弹窗（点遮罩/下滑/切歌时调用）——先播滑出动画，动画结束后再 remove
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      const card = panel.querySelector('.bm-playlist-card');
      const mask = panel.querySelector('.bm-playlist-mask');
      if (mask) { mask.style.transition = 'opacity .28s ease'; mask.style.opacity = '0'; }
      if (card) {
        card.classList.add('bm-playlist-closing');
        const onEnd = () => { panel.remove(); setListBtnOn(false); };
        card.addEventListener('animationend', onEnd, { once: true });
        setTimeout(() => { if (panel.parentNode) { panel.remove(); setListBtnOn(false); } }, 500);
      } else {
        panel.remove(); setListBtnOn(false);
      }
    };
    // 渲染当前播放 Tab 的单行（照网易云：歌名 · 歌手 + 删除× + 拖动≡）
    const nowRow = (s, i) => `
      <div class="bm-playlist-item ${i === M.state.playIndex ? 'on' : ''}" data-i="${i}">
        <span class="bm-pl-check" style="display:${manageMode ? 'inline-flex' : 'none'};"><input type="checkbox" data-i="${i}" ${selected.has(i) ? 'checked' : ''}></span>
        <span class="bm-pl-playing"></span>
        <span class="bm-pl-name">${esc(s.name)}</span>
        ${s.artist ? `<span class="bm-pl-sep">·</span><span class="bm-pl-artist">${esc(s.artist)}</span>` : ''}
        <button class="bm-pl-del" data-i="${i}" title="从列表移除">${window.icon ? window.icon('close', 14) : '×'}</button>
        <button class="bm-pl-drag" data-i="${i}" title="下一首播放">≡</button>
      </div>`;
    // 渲染历史播放 Tab 的单行
    const historyRow = (h, i) => `
      <div class="bm-playlist-item" data-id="${esc(h.songId || '')}">
        <span class="bm-pl-name">${esc(h.name || '')}</span>
        ${h.artist ? `<span class="bm-pl-sep">·</span><span class="bm-pl-artist">${esc(h.artist)}</span>` : ''}
        <span class="bm-pl-time">${_relTime(h.ts || 0)}</span>
      </div>`;
    // 重渲染列表主体（操作后保持弹窗打开）
    const rerender = async () => {
      const body = panel.querySelector('#bm-playlist-body');
      const count = panel.querySelector('#bm-playlist-count');
      if (tab === 'history') {
        const his = await getHistory('history');
        const cur = his.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 100);
        if (count) count.textContent = cur.length;
        body.innerHTML = cur.length ? cur.map(historyRow).join('') : '<div class="bm-music-empty">暂无播放历史</div>';
        bindBody(body);
        return;
      }
      const cur = M.state.playlist || [];
      if (count) count.textContent = cur.length;
      body.innerHTML = cur.length ? cur.map(nowRow).join('') : '<div class="bm-music-empty">暂无播放列表，点搜索结果行的「+」添加</div>';
      bindBody(body);
    };
    // 绑定列表主体事件（点击切歌 / 删除 / 勾选）
    const bindBody = (body) => {
      body.querySelectorAll('.bm-playlist-item').forEach(el => {
        el.onclick = (e) => {
          // 管理模式：整行切换勾选，不切歌
          if (manageMode && tab === 'now') {
            const cb = el.querySelector('.bm-pl-check input');
            if (cb) { cb.checked = !cb.checked; onCheckToggle(cb); }
            return;
          }
          if (e.target.closest('.bm-pl-del') || e.target.closest('.bm-pl-drag')) return;
          if (tab === 'history') return;
          const i = parseInt(el.dataset.i, 10);
          M.state.playIndex = i;
          // 20261106 互斥修复：播放列表点击切歌此前直接 M.playPrepared(i) 走内置播放器，
          //   后台遥控模式（mode==='remote' 且未开直连）下应发 bridge 指令给外部 App 切歌，
          //   否则内置残留旧歌会跟外部歌打架、且切不动外部正在播的那首。
          //   这里与音乐页控制键 prev/next（_isRemotePage）判断对齐。
          if ((M.state.mode === 'remote') && !_netEaseDirect) {
            // 遥控模式：目标歌在外部 App 里，本 App 无法精确跳某首，发 next 语义最接近「切到列表里的歌」
            _remoteAction({ bridge: 'next', local: () => M.playPrepared(i) }, null);
            refreshPlayerUI();
          } else {
            M.playPrepared(i);
          }
          rerender();   // 只更新高亮，不关闭（用户明确：选歌后列表保持存在）
        };
      });
      body.querySelectorAll('.bm-pl-check input').forEach(cb => {
        cb.onclick = (e) => { e.stopPropagation(); onCheckToggle(cb); };
      });
      // 每行「三条杠」按钮：设为「下一首播放」（把这首插队到当前播放的下一首位置）
      body.querySelectorAll('.bm-pl-drag').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const i = parseInt(btn.dataset.i, 10);
          const pl = M.state.playlist;
          if (!pl[i]) return;
          const cur = M.state.playIndex;
          if (i === cur) { if (window.miniToast) miniToast('当前正在播放这首歌'); return; }
          const [s] = pl.splice(i, 1);
          let insertAt = cur + 1;
          if (i < cur) insertAt = cur;
          pl.splice(insertAt, 0, s);
          M.state.playIndex = pl.indexOf(M.state.current);
          if (M.state.playIndex < 0) M.state.playIndex = 0;
          M.saveSession();
          rerender();
          if (window.miniToast) miniToast('已排到下一首播放');
        };
      });
      // 每行「删除」按钮：从播放列表移除这一首
      body.querySelectorAll('.bm-pl-del').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const i = parseInt(btn.dataset.i, 10);
          const pl = M.state.playlist;
          if (!pl[i]) return;
          const removed = pl[i];
          pl.splice(i, 1);
          const removedCurrent = M.state.current && String(M.state.current.id) === String(removed.id);
          if (removedCurrent) {
            if (pl.length) { M.state.playIndex = Math.min(i, pl.length - 1); M.playPrepared(M.state.playIndex); }
            else { M.state.playIndex = -1; M.state.current = null; M.state.playing = false; try { const a = M.state.audio; if (a) { a.pause(); a.src = ''; } M.state.loadedId = null; } catch (e) {} }
          } else {
            M.state.playIndex = pl.indexOf(M.state.current);
            if (M.state.playIndex < 0) M.state.playIndex = pl.length ? 0 : -1;
          }
          M.saveSession();
          rerender();
          if (window.miniToast) miniToast('已从列表移除');
        };
      });
    };
    // 勾选切换：更新 selected 集合 + 底部按钮文案
    const onCheckToggle = (cb) => {
      const i = parseInt(cb.dataset.i, 10);
      if (cb.checked) selected.add(i); else selected.delete(i);
      updateFoot();
    };
    const updateFoot = () => {
      const delAll = panel.querySelector('#bm-playlist-delall');
      if (delAll) delAll.textContent = `删除所选${selected.size ? `（${selected.size}）` : ''}`;
      const selAll = panel.querySelector('#bm-playlist-selall');
      const cur = M.state.playlist || [];
      if (selAll) selAll.textContent = (selected.size === cur.length && cur.length) ? '取消全选' : '全选';
    };
    // 切换 Tab（当前播放 / 历史播放）
    const switchTab = async (t) => {
      tab = t;
      manageMode = false;
      selected.clear();
      panel.querySelectorAll('.bm-playlist-tab').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
      panel.querySelector('#bm-playlist-foot-manage').style.display = 'none';
      panel.querySelector('#bm-playlist-foot').style.display = (t === 'now') ? 'flex' : 'none';
      panel.querySelector('#bm-playlist-src').style.display = (t === 'now') ? 'block' : 'none';
      await rerender();
    };
    panel.querySelector('#bm-playlist-mask').onclick = close;
    panel.querySelectorAll('.bm-playlist-tab').forEach(t => {
      t.onclick = () => switchTab(t.dataset.tab);
    });
    // 下拉把手：点击或向下拖动关闭
    const grip = panel.querySelector('.bm-playlist-grip');
    if (grip) {
      let gStartY = null;
      grip.onpointerdown = (e) => { gStartY = e.clientY; };
      grip.onpointerup = (e) => { if (gStartY !== null && e.clientY - gStartY > 24) close(); gStartY = null; };
    }
    // 垃圾桶按钮：一键清空播放列表
    panel.querySelector('#bm-playlist-trash').onclick = () => {
      if (!M.state.playlist.length) { if (window.miniToast) miniToast('播放列表已是空的'); return; }
      if (!window.confirm) { M.state.playlist = []; M.state.playIndex = -1; M.state.current = null; M.state.playing = false; try { const a = M.state.audio; if (a) { a.pause(); a.src = ''; } M.state.loadedId = null; } catch (e) {} M.saveSession(); rerender(); return; }
      if (window.confirm('确定清空整个播放列表？')) {
        M.state.playlist = []; M.state.playIndex = -1; M.state.current = null; M.state.playing = false;
        try { const a = M.state.audio; if (a) { a.pause(); a.src = ''; } M.state.loadedId = null; } catch (e) {}
        M.saveSession(); rerender();
      }
    };
    // 无限播放：绑定真实播放模式——开=列表循环(order)，关=播完即停(once)。
    //   单曲循环(one)/随机(shuffle)由悬浮窗循环按钮控制，这里只在 order/once 之间切换。
    const infBtn = panel.querySelector('#bm-playlist-inf');
    const _syncInf = () => {
      if (!infBtn) return;
      const loop = (M.state.playMode === 'order') || (M.state.playMode === 'shuffle');
      infBtn.classList.toggle('on', loop);
    };
    _syncInf();
    if (infBtn) infBtn.onclick = () => {
      const loop = (M.state.playMode === 'order') || (M.state.playMode === 'shuffle');
      // 开启 → 列表循环；关闭 → 播完即停
      M.state.playMode = loop ? 'once' : 'order';
      M.saveSession();
      _syncInf();
      if (typeof updateCtrlState === 'function') updateCtrlState();
      if (window.miniToast) miniToast(loop ? '已关闭无限播放' : '已开启无限播放（列表循环）');
    };
    // 智能过渡：交叉淡入淡出开关
    const fadeBtn = panel.querySelector('#bm-playlist-crossfade');
    if (fadeBtn) fadeBtn.classList.toggle('on', !!M.state.crossfade);
    if (fadeBtn) fadeBtn.onclick = () => {
      M.state.crossfade = !M.state.crossfade;
      M.saveSession();
      fadeBtn.classList.toggle('on', !!M.state.crossfade);
      if (window.miniToast) miniToast(M.state.crossfade ? '已开启智能过渡（歌曲间淡入淡出）' : '已关闭智能过渡');
    };
    // 管理按钮：进入/退出批量管理模式（仅「当前播放」Tab）
    const manageBtn = panel.querySelector('#bm-playlist-manage');
    if (manageBtn) {
      manageBtn.onclick = (e) => {
        e.stopPropagation();
        if (tab !== 'now') return;
        manageMode = !manageMode;
        selected.clear();
        const foot = panel.querySelector('#bm-playlist-foot-manage');
        const footNormal = panel.querySelector('#bm-playlist-foot');
        foot.style.display = manageMode ? 'flex' : 'none';
        footNormal.style.display = manageMode ? 'none' : 'flex';
        manageBtn.classList.toggle('on', manageMode);
        updateFoot();
        rerender();
      };
    }
    // 全选 / 取消全选
    const selAllBtn = panel.querySelector('#bm-playlist-selall');
    if (selAllBtn) {
      selAllBtn.onclick = () => {
        const cur = M.state.playlist || [];
        const all = selected.size === cur.length && cur.length;
        selected.clear();
        if (!all) { for (let i = 0; i < cur.length; i++) selected.add(i); }
        const body = panel.querySelector('#bm-playlist-body');
        body.querySelectorAll('.bm-pl-check input').forEach(cb => {
          cb.checked = selected.has(parseInt(cb.dataset.i, 10));
        });
        updateFoot();
      };
    }
    // 删除所选
    const delAll = panel.querySelector('#bm-playlist-delall');
    if (delAll) {
      delAll.onclick = () => {
        if (!selected.size) { if (window.miniToast) miniToast('请先勾选要删除的歌曲'); return; }
        const pl = M.state.playlist;
        const idxs = Array.from(selected).sort((a, b) => b - a);
        const removedIds = idxs.map(i => pl[i] && pl[i].id);
        const removedCurrent = removedIds.some(id => M.state.current && String(M.state.current.id) === String(id));
        for (const i of idxs) pl.splice(i, 1);
        if (removedCurrent) {
          if (pl.length) { M.state.playIndex = Math.min(M.state.playIndex, pl.length - 1); M.play(pl[M.state.playIndex]); }
          else { M.state.playIndex = -1; M.state.current = null; M.state.playing = false; try { const a = M.state.audio; if (a) { a.pause(); a.src = ''; } M.state.loadedId = null; } catch (e) {} }
        } else {
          M.state.playIndex = pl.indexOf(M.state.current);
          if (M.state.playIndex < 0) M.state.playIndex = pl.length ? 0 : -1;
        }
        M.saveSession();
        selected.clear();
        if (!pl.length) { close(); if (window.miniToast) miniToast('已清空播放列表'); return; }
        rerender();
        updateFoot();
        if (window.miniToast) miniToast(`已删除 ${idxs.length} 首`);
      };
    }
    rerender();
    setListBtnOn(true);
  }

  /* 加号菜单：收藏到音乐库 / 添加到歌单 / 新建歌单 */
  function showSongAddMenu(anchor, song) {
    let menu = document.getElementById('bm-song-menu');
    if (menu) menu.remove();
    menu = document.createElement('div');
    menu.id = 'bm-song-menu';
    menu.className = 'bm-song-menu';
    menu.innerHTML = `
      <div class="bm-song-menu-item" data-act="fav">${window.icon ? window.icon('star', 15) : '☆'} 收藏到音乐库</div>
      <div class="bm-song-menu-item" data-act="addpl">${window.icon ? window.icon('plus', 15) : '+'} 添加到歌单</div>
      <div class="bm-song-menu-item" data-act="newpl">${window.icon ? window.icon('musiclib', 15) : '♬'} 新建歌单并添加</div>`;
    document.body.appendChild(menu);
    positionMenu(menu, anchor);
    const closeMenu = () => menu.remove();
    // 点外部关闭
    const docClose = (e) => { if (!menu.contains(e.target)) { closeMenu(); document.removeEventListener('click', docClose); } };
    setTimeout(() => document.addEventListener('click', docClose), 0);
    menu.querySelector('[data-act="fav"]').onclick = async () => {
      closeMenu();
      try {
        const full = (song.url) ? song : await M.fetchSongDetail(song);
        await M.addLocalTrack({ id: full.id, name: full.name, artist: full.artist, album: full.album, pic: full.pic, url: full.url, lrc: full.lrc, source: 'mirror' });
        if (window.miniToast) miniToast('已收藏到音乐库');
      } catch (e) { if (window.miniToast) miniToast('收藏失败'); }
    };
    menu.querySelector('[data-act="addpl"]').onclick = async () => {
      closeMenu();
      showSongAddToPlaylist(song);
    };
    menu.querySelector('[data-act="newpl"]').onclick = async () => {
      closeMenu();
      showSongNewPlaylist(song);
    };
  }

  /* 操作菜单：下一首播放 / 收藏到音乐库 / 添加到歌单 / 从播放列表删除。
     20261104：合并原「加号」「叉号」功能，统一为「⋯」菜单；操作后通过 rerender 回调
     刷新播放列表（弹窗保持打开），不再误关弹窗。 */
  function showSongMoreMenu(anchor, song, i, rerender) {
    let menu = document.getElementById('bm-song-menu');
    if (menu) menu.remove();
    menu = document.createElement('div');
    menu.id = 'bm-song-menu';
    menu.className = 'bm-song-menu';
    menu.innerHTML = `
      <div class="bm-song-menu-item" data-act="playnext">${window.icon ? window.icon('next', 15) : '››'} 下一首播放</div>
      <div class="bm-song-menu-item" data-act="fav">${window.icon ? window.icon('star', 15) : '☆'} 收藏到音乐库</div>
      <div class="bm-song-menu-item" data-act="addpl">${window.icon ? window.icon('plus', 15) : '+'} 添加到歌单</div>
      <div class="bm-song-menu-item" data-act="remove">${window.icon ? window.icon('close', 15) : '✕'} 从播放列表删除</div>`;
    document.body.appendChild(menu);
    positionMenu(menu, anchor);
    const closeMenu = () => menu.remove();
    const docClose = (e) => { if (!menu.contains(e.target)) { closeMenu(); document.removeEventListener('click', docClose); } };
    setTimeout(() => document.addEventListener('click', docClose), 0);
    menu.querySelector('[data-act="playnext"]').onclick = () => {
      closeMenu();
      // 把该曲移到「下一首」位置（当前播放之后）
      const cur = M.state.playIndex;
      const pl = M.state.playlist;
      if (i === cur) { if (window.miniToast) miniToast('当前正在播放这首歌'); return; }
      const [s] = pl.splice(i, 1);
      let insertAt = cur + 1;
      if (i < cur) insertAt = cur; // 删的是当前之前的，插入到当前之后仍是 cur
      pl.splice(insertAt, 0, s);
      M.state.playIndex = pl.indexOf(M.state.current);
      if (M.state.playIndex < 0) M.state.playIndex = 0;
      M.saveSession();
      if (typeof rerender === 'function') rerender(); else showPlaylist();
      if (window.miniToast) miniToast('已排到下一首');
    };
    menu.querySelector('[data-act="fav"]').onclick = async () => {
      closeMenu();
      try {
        const full = (song.url) ? song : await M.fetchSongDetail(song);
        await M.addLocalTrack({ id: full.id, name: full.name, artist: full.artist || '', album: full.album || '', pic: full.pic || '', url: full.url || '', lrc: full.lrc || '', source: 'mirror' });
        if (window.miniToast) miniToast('已收藏到音乐库');
      } catch (e) { if (window.miniToast) miniToast('收藏失败'); }
    };
    menu.querySelector('[data-act="addpl"]').onclick = () => {
      closeMenu();
      showSongAddToPlaylist(song);
    };
    menu.querySelector('[data-act="remove"]').onclick = () => {
      closeMenu();
      const pl = M.state.playlist;
      const removed = pl[i];
      pl.splice(i, 1);
      // 若删的是当前播放的歌，跳到下一首（或上一首）
      if (M.state.current && removed && String(M.state.current.id) === String(removed.id)) {
        M.state.playIndex = pl.length ? Math.min(i, pl.length - 1) : -1;
        if (pl.length) M.play(pl[M.state.playIndex]); else { M.state.current = null; M.state.playing = false; try { const a = M.state.audio; if (a) { a.pause(); a.src = ''; } M.state.loadedId = null; } catch (e) {} }
      } else {
        M.state.playIndex = pl.indexOf(M.state.current);
        if (M.state.playIndex < 0) M.state.playIndex = pl.length ? 0 : -1;
      }
      M.saveSession();
      if (!pl.length) { const p = document.getElementById('bm-playlist-panel'); if (p) p.remove(); setListBtnOn(false); }
      else if (typeof rerender === 'function') rerender(); else showPlaylist();
      if (window.miniToast) miniToast('已从播放列表删除');
    };
  }

  /* 定位菜单到锚点附近（右下/上方展开，避免超出视口） */
  function positionMenu(menu, anchor) {
    const r = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = '0';
    menu.style.top = '0';
    menu.style.visibility = 'hidden';
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = r.right - mw;
    let y = r.bottom + 6;
    if (x < 8) x = 8;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = r.top - mh - 6;
    if (y < 8) y = 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.visibility = '';
  }

  /* 添加到歌单（选择已有歌单）子浮层 */
  async function showSongAddToPlaylist(song) {
    const full = (song.url) ? song : await M.fetchSongDetail(song);
    const pls = await M.getPlaylists();
    let sub = document.getElementById('bm-song-addpl');
    if (sub) sub.remove();
    sub = document.createElement('div');
    sub.id = 'bm-song-addpl';
    sub.className = 'bm-lib-subpanel';
    sub.innerHTML = `
      <div class="bm-lib-submask"></div>
      <div class="bm-lib-subcard">
        <div class="bm-lib-subhead"><span>添加到歌单</span><button class="bm-lib-close" id="bm-song-addpl-close">✕</button></div>
        <div class="bm-lib-pllist">
          ${pls.length ? pls.map(p => `<div class="bm-lib-plopt" data-id="${esc(p.id)}">${esc(p.name)}<span>${(p.tracks||[]).length}首</span></div>`).join('') : '<div class="bm-music-empty">暂无歌单</div>'}
        </div>
        <div class="bm-lib-newpl">
          <input class="bm-lib-newpl-input" id="bm-song-addpl-input" placeholder="新建歌单名称…" />
          <button class="bm-lib-subbtn" id="bm-song-addpl-newbtn">新建并加入</button>
        </div>
      </div>`;
    document.body.appendChild(sub);
    const close = () => sub.remove();
    sub.querySelector('#bm-song-addpl-close').onclick = close;
    sub.querySelector('.bm-lib-submask').onclick = close;
    sub.querySelectorAll('.bm-lib-plopt').forEach(el => {
      el.onclick = async () => {
        await M.addToPlaylist(el.dataset.id, full.id);
        if (window.miniToast) miniToast('已加入歌单');
        close();
      };
    });
    sub.querySelector('#bm-song-addpl-newbtn').onclick = async () => {
      const name = sub.querySelector('#bm-song-addpl-input').value.trim();
      if (!name) { if (window.miniToast) miniToast('请输入歌单名称'); return; }
      const rec = await M.createPlaylist(name);
      if (rec) { await M.addToPlaylist(rec.id, full.id); if (window.miniToast) miniToast('已新建歌单并加入'); }
      close();
    };
  }

  /* 新建歌单并添加当前歌 */
  async function showSongNewPlaylist(song) {
    const full = (song.url) ? song : await M.fetchSongDetail(song);
    let sub = document.getElementById('bm-song-addpl');
    if (sub) sub.remove();
    sub = document.createElement('div');
    sub.id = 'bm-song-addpl';
    sub.className = 'bm-lib-subpanel';
    sub.innerHTML = `
      <div class="bm-lib-submask"></div>
      <div class="bm-lib-subcard">
        <div class="bm-lib-subhead"><span>新建歌单</span><button class="bm-lib-close" id="bm-song-addpl-close">✕</button></div>
        <div class="bm-lib-newpl" style="padding:14px 0;">
          <input class="bm-lib-newpl-input" id="bm-song-newpl-input" placeholder="输入歌单名称…" />
          <button class="bm-lib-subbtn" id="bm-song-newpl-btn">新建并加入《${esc(full.name)}》</button>
        </div>
      </div>`;
    document.body.appendChild(sub);
    const close = () => sub.remove();
    sub.querySelector('#bm-song-addpl-close').onclick = close;
    sub.querySelector('.bm-lib-submask').onclick = close;
    sub.querySelector('#bm-song-newpl-btn').onclick = async () => {
      const name = sub.querySelector('#bm-song-newpl-input').value.trim();
      if (!name) { if (window.miniToast) miniToast('请输入歌单名称'); return; }
      const rec = await M.createPlaylist(name);
      if (rec) { await M.addToPlaylist(rec.id, full.id); if (window.miniToast) miniToast('已新建歌单并加入'); }
      close();
    };
  }

  /* 播放列表按钮激活态反馈 */
  function setListBtnOn(on) {
    const btn = document.getElementById('bm-music-list');
    if (btn) btn.classList.toggle('on', on);
  }

  /* 刷新播放模式按钮的图标/高亮状态（once 顺序播放 / order 列表循环 / shuffle 随机 / one 单曲循环） */
  const _PLAYMODE_META = {
    once:   { icon: 'order',   emoji: '➡️', title: '顺序播放' },
    order:  { icon: 'repeat',  emoji: '🔁', title: '列表循环' },
    shuffle:{ icon: 'shuffle', emoji: '🔀', title: '随机播放' },
    one:    { icon: 'repeat-one', emoji: '🔂', title: '单曲循环' },
  };
  function updateCtrlState() {
    const modeBtn = document.getElementById('bm-music-mode');
    const m = M.state.playMode;
    const meta = _PLAYMODE_META[m] || _PLAYMODE_META.order;
    // 音乐页模式按钮
    if (modeBtn) {
      modeBtn.innerHTML = window.icon ? window.icon(meta.icon, 18) : meta.emoji;
      modeBtn.title = meta.title;
      modeBtn.classList.toggle('on', m !== 'order');
    }
    // 三级悬浮窗模式按钮（若存在）
    const fm = document.getElementById('bm-float-mode');
    if (fm) {
      fm.innerHTML = window.icon ? window.icon(meta.icon, 16) : meta.emoji;
      fm.title = meta.title;
      fm.classList.toggle('on', m !== 'order');
    }
  }

  function renderResults(list) {
    const box = document.getElementById('bm-music-results');
    if (!box) return;
    if (!list || !list.length) { box.innerHTML = '<div class="bm-music-empty">未找到结果，请换关键词试试</div>'; box.classList.remove('collapsed'); return; }
    const isMirror = M.state.mode === 'mirror';
    box.classList.remove('collapsed');
    box.innerHTML = `
      <div class="bm-results-head">
        <span class="bm-results-count">共 ${list.length} 首</span>
        <button class="bm-results-toggle" id="bm-results-toggle" title="收起/展开搜索结果"><span class="bm-caret">▾</span> 收起</button>
      </div>
      <div class="bm-results-body">
      ${list.map(s => `
        <div class="bm-result" data-id="${esc(s.id)}">
          <div class="bm-result-cover">${s.pic ? coverImgHTML(s.pic) : '♪'}</div>
          <div class="bm-result-info">
            <div class="bm-result-name">${esc(s.name)}</div>
            <div class="bm-result-artist">${esc(s.artist)}</div>
          </div>
          <button class="bm-result-add" data-id="${esc(s.id)}" title="添加到播放列表">${window.icon ? window.icon('plus', 16) : '+'}</button>
          ${isMirror ? `<button class="bm-result-fav" data-id="${esc(s.id)}" title="收藏到音乐库">${window.icon ? window.icon('star', 16) : '☆'}</button>
          <button class="bm-result-dl" data-id="${esc(s.id)}" title="下载">${window.icon ? window.icon('download', 16) : '↓'}</button>` : ''}
          <button class="bm-result-play" data-id="${esc(s.id)}">${window.icon ? window.icon('play', 16) : '▶'}</button>
        </div>`).join('')}
      </div>`;
    // 收起/展开
    box.querySelector('#bm-results-toggle').onclick = () => {
      const collapsed = box.classList.toggle('collapsed');
      box.querySelector('#bm-results-toggle').innerHTML = collapsed ? '<span class="bm-caret">▾</span> 展开' : '<span class="bm-caret">▾</span> 收起';
    };
    box.querySelectorAll('.bm-result').forEach(el => {
      el.onclick = async () => {
        const id = el.dataset.id;
        const song = list.find(s => String(s.id) === String(id));
        if (!song) return;
        playSong(song, null);   // 点整行：只播这一首
      };
    });
    box.querySelectorAll('.bm-result-play').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const id = b.dataset.id;
        const song = list.find(s => String(s.id) === String(id));
        if (!song) return;
        playSong(song, null);   // 点播放键：只播这一首（不自动加列表）
      };
    });
    // 加号：添加到播放列表
    box.querySelectorAll('.bm-result-add').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const id = b.dataset.id;
        const song = list.find(s => String(s.id) === String(id));
        if (!song) return;
        const full = await M.fetchSongDetail(song);
        const added = M.addToQueue(full);
        b.classList.add('on');
        setTimeout(() => b.classList.remove('on'), 600);
        if (window.miniToast) miniToast(added ? `已加入播放列表：${full.name}` : '已在播放列表中');
      };
    });
    // 收藏（仅镜像搜索模式）
    box.querySelectorAll('.bm-result-fav').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const id = b.dataset.id;
        const song = list.find(s => String(s.id) === String(id));
        if (!song) return;
        const full = await M.fetchSongDetail(song);
        await M.addLocalTrack({ id: full.id, name: full.name, artist: full.artist, album: full.album, pic: full.pic, url: full.url, lrc: full.lrc, source: 'mirror' });
        b.classList.add('on');
        setTimeout(() => b.classList.remove('on'), 600);
        // 20261106：收藏成功 → 粒子炸开
        if (window.bmFx) window.bmFx.burst(b.querySelector('svg') || b, { color: '#f5c97b' });
        if (window.miniToast) miniToast('已收藏到音乐库');
      };
    });
    // 下载（仅镜像搜索模式）
    box.querySelectorAll('.bm-result-dl').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const id = b.dataset.id;
        const song = list.find(s => String(s.id) === String(id));
        if (!song) return;
        const full = await M.fetchSongDetail(song);
        if (!full.url) { if (window.miniToast) miniToast('该歌曲暂无可下载的直链'); return; }
        downloadSong(full);
      };
    });
  }

  /* 收起搜索结果列表（供 stage 空白点击、搜索框外操作调用） */
  function collapseResults() {
    const box = document.getElementById('bm-music-results');
    if (!box || !box.querySelector('.bm-result')) return;   // 无结果则不动作
    box.classList.add('collapsed');
    const t = box.querySelector('#bm-results-toggle');
    if (t) t.innerHTML = '<span class="bm-caret">▾</span> 展开';
  }

  /* 下载歌曲：跳转直链（或 <a download> 尝试保存） */
  function downloadSong(song) {
    const name = (song.name || 'song') + ' - ' + (song.artist || '');
    const a = document.createElement('a');
    a.href = song.url;
    a.download = name + '.mp3';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (window.miniToast) miniToast('已开始下载');
  }

  async function playSong(song, list) {
    // 20261104 修复「点歌后没声音/点播放反应超慢」：
    //   预授权 + 立即 UI 反馈：先复用同一 audio 做手势预授权，再用搜索结果元数据立即上屏
    //   （标题/封面秒变，不等网络），随后 fetch 详情拿直链真正播放。
    const aPre = M.ensureAudio();
    try { aPre.play().catch(() => {}); } catch (e) {}
    // 立即用搜索结果元数据刷新 UI，点歌即有反馈
    if (song && song.name) {
      M.state.current = song;
      refreshPlayerUI();
    }
    const full = await M.fetchSongDetail(song);
    // 传入列表则整表作为播放列表，支持连播下一首；否则单曲
    if (list && list.length) {
      M.state.playlist = list;
      M.state.playIndex = list.findIndex(s => String(s.id) === String(full.id));
      if (M.state.playIndex < 0) M.state.playIndex = 0;
    } else {
      M.state.playlist = [full];
      M.state.playIndex = 0;
    }
    M.play(full);
    resetFloatClosed();   // 换歌后悬浮窗恢复显示
    refreshPlayerUI();
  }

  function renderModePanel(mode) {
    const stage = document.querySelector('.bm-music-stage');
    const searchBox = document.getElementById('bm-music-searchbox');
    const searchTool = document.getElementById('bm-music-searchtool');
    const favBtn = document.getElementById('bm-music-fav');
    const dlBtn = document.getElementById('bm-music-dl');
    const srcBtn = document.getElementById('bm-music-source');
    const parseBtn = document.getElementById('bm-music-parse');
    const results = document.getElementById('bm-music-results');
    if (!stage) return;
    // 收藏/下载按钮按模式区分：镜像=收藏+下载，本地=仅下载，后台遥控=也保留（20261105 用户要求补全）
    if (favBtn) favBtn.style.display = (mode === 'local') ? 'none' : '';
    if (dlBtn) dlBtn.style.display = '';   // 20261105：三种模式都显示下载按钮
    // 音源路径按钮只在镜像搜索模式显示
    if (srcBtn) srcBtn.style.display = (mode === 'mirror') ? '' : 'none';
    // 20261103：解析歌单按钮只在「本地与解析」模式显示（镜像搜索去掉，后台遥控面板自带解析入口）
    if (parseBtn) parseBtn.style.display = (mode === 'local') ? '' : 'none';
    if (mode === 'local') {
      // 本地与解析：保留搜索框（搜在线曲目），音乐库改由顶栏「音乐库」按钮弹窗管理
      if (searchBox) searchBox.style.display = '';
      if (searchTool) searchTool.style.display = '';
      if (results) { results.style.display = 'block'; results.innerHTML = ''; }
    } else if (mode === 'remote') {
      // 20261104 后台遥控：显示遥控面板（盲抽外部歌单 + 播放/暂停/切歌控制）
      // 20261105：工具栏图标（邀请/分享/评论/音量/收藏/下载/悬浮窗）在后台遥控页也保留，
      //   不再整行隐藏 searchTool，只隐藏搜索框和结果区。
      if (searchBox) searchBox.style.display = 'none';
      if (searchTool) searchTool.style.display = '';
      if (results) { results.style.display = 'block'; renderRemotePanel(results); }
    } else {
      if (searchBox) searchBox.style.display = '';
      if (searchTool) searchTool.style.display = '';
      if (results) { results.style.display = ''; }
      if (mode === 'mirror') { if (results) results.innerHTML = ''; }
    }
  }

  /* ============================================================
     后台遥控（模式二，20261104 完善）：
     · 真正的「控制外部 App」由 Capacitor 原生插件 BmRemoteControl 提供
       （MediaSession / NotificationListener 方案，见原生插件技术方案文档）。
     · 前端通过 window.Capacitor.Plugins.BmRemoteControl 桥接：真机有插件时发指令给外部 App；
       无插件时（Web/未装插件）降级为「本地模拟遥控」——盲抽盲切本地曲库，
       保证 UI 可演示、逻辑可跑通。
     ============================================================ */
  // 原生插件桥接：存在即走真遥控，否则走本地模拟
  function _remoteBridge() {
    // 20261104：插件走 Capacitor 运行时全局注册表（与其他插件 BmOverlay/BmBackground/BmConversationNotify 一致），
    //   不是 window.BmRemoteControl。此前写 window.BmRemoteControl 导致真机也永远拿不到插件、只会本地降级。
    const P = (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : null;
    const b = (P && P.BmRemoteControl) ? P.BmRemoteControl : null;
    return b || null;
  }
  // 目标 App 列表（可扩展到酷狗等，取决于原生插件支持）
  const _remoteApps = [
    { id: 'netease', name: '网易云音乐', pkg: 'com.netease.cloudmusic' },
    { id: 'qqmusic', name: 'QQ 音乐', pkg: 'com.tencent.qqmusic' },
    { id: 'kugou', name: '酷狗音乐', pkg: 'com.kugou.android' },
  ];
  let _remoteTargetApp = 'netease';   // 当前遥控目标 App（存内存，未持久化）

  /* ---------- 模式二统一遥控动作分发 ----------
     20261104：悬浮窗 / 音乐页 / 角色自主操控，在模式二（remote）下都走这里，
     保证「后台遥控 + 本地降级 + 小垫片提示」三件事一致。
     act：{ bridge:'next'|'prev'|'toggle', local:()=>Promise, sayText } */
  async function _remoteAction(act, say) {
    const bridge = _remoteBridge();
    // 有原生插件 → 直接发指令给外部 App（后台操控）
    if (bridge && act.bridge && typeof bridge[act.bridge] === 'function') {
      // 20261105 修复「外部在播 + 内部残留旧歌同时响（打架）」：
      //   遥控外部 App 前，先把内置播放器彻底停掉（pause + 清 src），
      //   否则内部残留的上一首歌会跟外部 App 的歌同时响。
      try {
        const a = M.state.audio;
        if (a) { a.pause(); }
        M.state.playing = false;
      } catch (e) {}
      try { await bridge[act.bridge](); } catch (e) { if (window.miniToast) miniToast('原生遥控指令失败'); }
      // 20261106 修复「图标错乱」：此前 toggle 时瞎猜 M.state.playing=!M.state.playing，
      //   next/prev 时瞎猜 M.state.playing=true，导致图标永远跟外部真实态脱节。
      //   现改为：发完指令后异步读 getMediaState() 拿外部真实 playing，刷新统一真实态缓存，
      //   让图标/悬浮窗/听歌页都显示外部 App 的真实播放/暂停状态，不再瞎猜。
      _refreshLiveExternal(true);
      if (say && act.sayText) say(act.sayText);
      return;
    }
    // 无插件 → 本地降级执行（Web 演示 / 未装插件），保证可播
    if (act.local) { try { await act.local(); } catch (e) {} }
    if (say && act.sayText) say(act.sayText);
  }

  /* ---------- 网易云直连（模式二升级，20261105） ----------
     玩家登录自己的网易云账号 → 原生插件带 Cookie 请求官方接口（绕过 CORS），
     实现「识别自己歌单 + 玩家主动搜歌 + 角色主动搜歌 + 内置播放器播放」。
     直连/遥控 二选一开关：直连走原生 Cookie，遥控走 MediaSession 控制外部 App。
     （用户明确：两个都要保留，玩家自己选，绝不放弃遥控后台） */
  const _neteaseBridge = () => {
    const P = (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : null;
    return (P && P.BmRemoteControl) ? P.BmRemoteControl : null;
  };
  // 是否处于「网易云直连」模式（持久化，默认 false=遥控）
  let _netEaseDirect = false;
  async function _netEaseLoadDirect() {
    try { _netEaseDirect = (await getSetting('neteaseDirect', false)) === true; } catch (e) {}
    return _netEaseDirect;
  }
  async function _netEaseSetDirect(v) {
    _netEaseDirect = !!v;
    try { await setSetting('neteaseDirect', _netEaseDirect); } catch (e) {}
    // 20261106 互斥：开直连时反向清掉「后台遥控」态（mode 离开 remote），
    //   并停掉遥控心跳。两套状态真互斥，避免「直连 + 遥控」同时成立导致角色互动权重归零、
    //   遥控分支失效、进度条双源打架。
    if (_netEaseDirect) {
      if (M.state.mode === 'remote') { M.state.mode = 'mirror'; try { M.saveSession(); } catch (e2) {} }
      _stopLiveExternalHeartbeat();
      _liveExternal = null; _liveExternalAt = 0;
    } else {
      // 20261107 修复互斥 bug：关直连（回到「遥控外部 App」）时，若 mode 还是 mirror
      //   （即之前开直连时被 _netEaseSetDirect 从 remote 改成了 mirror），必须把它拉回
      //   remote，否则 _isRemoteMode()=(mode==='remote') 恒 false，点播放/暂停只控内置播放器，
      //   只有「盲抽一首」因直接 bridge.next() 不看 mode 还能遥控——正是用户复现的现象。
      if (M.state.mode === 'mirror') { M.state.mode = 'remote'; try { M.saveSession(); } catch (e2) {} }
    }
  }
  // 原生层带 Cookie 请求网易云官方接口，返回解析后的 JSON（失败返回 null）
  async function _netEaseReq(url) {
    const b = _neteaseBridge();
    if (!b || typeof b.neteaseRequest !== 'function') return null;
    try {
      const r = await b.neteaseRequest({ url });
      // 20261105 修复：原生层现在返回真实 status 码。非 2xx（如 403/404）说明
      //   登录态失效或接口拒绝，直接返回 null，不再把错误页当 JSON 解析。
      if (!r || !r.ok) return null;
      if (typeof r.status === 'number' && (r.status < 200 || r.status >= 300)) return null;
      if (!r.body) return null;
      return JSON.parse(r.body);
    } catch (e) { return null; }
  }
  // 直连登录态检测（原生插件 neteaseCookie）
  async function _netEaseLoggedIn() {
    const b = _neteaseBridge();
    if (!b || typeof b.neteaseCookie !== 'function') return false;
    try { const r = await b.neteaseCookie(); return !!(r && r.loggedIn); } catch (e) { return false; }
  }
  // 直连搜歌：带 Cookie 请求网易云搜索接口，返回 [{id,name,artist,pic}] 
  async function _netEaseSearch(kw) {
    const j = await _netEaseReq('https://music.163.com/api/search/get/web?s=' + encodeURIComponent(kw) + '&type=1&offset=0&limit=30');
    if (!j || !j.result || !j.result.songs) return [];
    return j.result.songs.map(s => ({
      id: String(s.id),
      name: s.name || '',
      artist: (s.artists && s.artists.length) ? s.artists.map(a => a.name).join(' / ') : '',
      pic: (s.album && s.album.picUrl) ? s.album.picUrl : '',
      album: (s.album && s.album.name) || '',
      source: 'netease-direct',
    }));
  }
  // 直连拿播放直链（VIP 歌返回试听或 null）
  async function _netEaseSongUrl(id) {
    const j = await _netEaseReq('https://music.163.com/api/song/enhance/player/url?ids=[' + id + ']&br=320000');
    if (!j || !j.data || !j.data.length) return null;
    const d = j.data[0];
    if (!d || !d.url) return { url: null, freeTrial: d.freeTrialInfo || null, code: d.code };
    return { url: d.url, freeTrial: d.freeTrialInfo || null, code: d.code };
  }
  // 直连读玩家自己的歌单列表
  async function _netEaseMyPlaylists() {
    // 先拿用户信息（uid）
    const me = await _netEaseReq('https://music.163.com/api/nuser/account/get');
    const uid = me && me.profile ? me.profile.userId : null;
    if (!uid) return [];
    const j = await _netEaseReq('https://music.163.com/api/user/playlist?uid=' + uid + '&limit=50&offset=0');
    if (!j || !j.playlist) return [];
    return j.playlist.map(p => ({ id: String(p.id), name: p.name || '', cover: String(p.coverImgUrl || '').replace(/^http:\/\//i, 'https://'), count: p.trackCount || 0 }));
  }
  // 直连读某张歌单的歌曲列表
  async function _netEasePlaylistTracks(pid) {
    const j = await _netEaseReq('https://music.163.com/api/playlist/detail?id=' + pid);
    if (!j || !j.result || !j.result.tracks) return [];
    return j.result.tracks.map(t => ({
      id: String(t.id),
      name: t.name || '',
      artist: (t.ar && t.ar.length) ? t.ar.map(a => a.name).join(' / ') : '',
      pic: (t.al && t.al.picUrl) ? String(t.al.picUrl).replace(/^http:\/\//i, 'https://') : '',
      source: 'netease-direct',
    }));
  }
  // 20261107：weapi 加密请求（POST + params/encSecKey），用于网易云「每日推荐/私人FM」等
  //   需要登录 + weapi 加密的 /weapi/ 接口。原生插件 weapiEncrypt 做加密，neteaseRequest 发 POST。
  //   失败返回 null（前端据此回退到官方榜单/关键词搜歌）。
  async function _netEaseWeapiReq(path, payload) {
    const b = _neteaseBridge();
    if (!b || typeof b.weapiEncrypt !== 'function' || typeof b.neteaseRequest !== 'function') return null;
    try {
      const enc = await b.weapiEncrypt({ text: JSON.stringify(payload || {}) });
      if (!enc || !enc.params) return null;
      const body = 'params=' + encodeURIComponent(enc.params) + '&encSecKey=' + encodeURIComponent(enc.encSecKey);
      const r = await b.neteaseRequest({ url: 'https://music.163.com/weapi' + path, method: 'POST', body });
      if (!r || !r.ok) return null;
      if (typeof r.status === 'number' && (r.status < 200 || r.status >= 300)) return null;
      if (!r.body) return null;
      return JSON.parse(r.body);
    } catch (e) { return null; }
  }
  // 20261107：直连读「用户账号真实的每日推荐 30 首」（/weapi/v2/discovery/recommend/songs，需登录）
  async function _netEaseRecommendSongs() {
    const j = await _netEaseWeapiReq('/v2/discovery/recommend/songs', { offset: 0, total: true, limit: 30 });
    if (!j || j.code !== 200) return [];
    // 20261107 真机实测修正字段：真实返回的歌在 j.recommend[]（不是 j.data.dailySongs）。
    //   歌曲对象 {name,id,artists:[{name}],album:{name,picUrl}}。
    const list = (j.recommend && j.recommend.length) ? j.recommend
               : ((j.data && j.data.dailySongs) ? j.data.dailySongs : null);
    if (!list || !list.length) return [];
    return list.map(s => ({
      id: String(s.id),
      name: s.name || '',
      artist: (s.artists && s.artists.length) ? s.artists.map(a => a.name).join(' / ') : (s.ar && s.ar.length ? s.ar.map(a => a.name).join(' / ') : ''),
      pic: (s.album && s.album.picUrl) ? String(s.album.picUrl).replace(/^http:\/\//i, 'https://') : ((s.al && s.al.picUrl) ? String(s.al.picUrl).replace(/^http:\/\//i, 'https://') : ''),
      source: 'netease-direct',
    }));
  }
  // 20261107：直连读「用户账号的私人FM」（/weapi/v1/radio/get，需登录），每次返回约 1~3 首
  async function _netEasePersonalFm(batch) {
    const j = await _netEaseWeapiReq('/v1/radio/get', {});
    // 20261107 真机实测修正：该接口返回 {popAdjust, data:[...]}，顶层无 code 字段；
    //   歌在 j.data[]，封面在 album.picUrl。
    if (!j || !j.data) return [];
    const arr = Array.isArray(j.data) ? j.data : [];
    return arr.map(s => ({
      id: String(s.id),
      name: s.name || '',
      artist: (s.artists && s.artists.length) ? s.artists.map(a => a.name).join(' / ') : (s.ar && s.ar.length ? s.ar.map(a => a.name).join(' / ') : ''),
      pic: (s.album && s.album.picUrl) ? String(s.album.picUrl).replace(/^http:\/\//i, 'https://') : ((s.al && s.al.picUrl) ? String(s.al.picUrl).replace(/^http:\/\//i, 'https://') : ''),
      source: 'netease-direct',
    }));
  }
  // 20261105：导入歌单弹窗——列出网易云「我的歌单」，玩家勾选（顶部全选），
  //   选中歌单的歌曲逐首存入音乐库曲库 + 新建同名歌单关联，不做全量强导。
  async function _netEaseImportPlaylists(pls) {
    if (!pls || !pls.length) { if (window.miniToast) miniToast('没有可导入的歌单'); return; }
    // 20261105 修复：弹窗必须弹在音乐页内部（bm-lib-subpanel 子浮层，挂 #bm-music-page 内），
    //   不能用 openModal（全局 modal 的 z-index=100，远低于音乐页 z-index=2147482990，
    //   会被音乐页整个盖住，导致「退出音乐界面才看得到弹窗」）。
    const page = document.getElementById('bm-music-page');
    const host = page || document.body;
    let sub = document.getElementById('bm-neimport-panel');
    if (sub) sub.remove();
    sub = document.createElement('div');
    sub.id = 'bm-neimport-panel';
    sub.className = 'bm-lib-subpanel';
    sub.innerHTML = `
      <div class="bm-lib-submask"></div>
      <div class="bm-lib-subcard">
        <div class="bm-lib-subhead"><span>导入网易云歌单</span><button class="bm-lib-close" id="bm-neimport-close">✕</button></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin:10px 0 6px;">
          <span style="font-size:12px;color:var(--text-secondary);">勾选要导入的歌单（会存进音乐库「歌单」，可随时播放）</span>
          <label style="font-size:12px;color:var(--purple-soft);cursor:pointer;display:flex;align-items:center;gap:4px;">
            <input type="checkbox" id="bm-neimport-all" style="accent-color:var(--purple-soft);"> 全选
          </label>
        </div>
        <div class="bm-neimport-list" id="bm-neimport-list" style="max-height:52vh;overflow-y:auto;">
          ${pls.map(p => `
            <label class="bm-neimport-item" style="display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid var(--bm-card-line, rgba(255,255,255,.08));cursor:pointer;">
              <input type="checkbox" class="bm-neimport-cb" data-id="${p.id}" data-name="${esc(p.name)}" data-count="${p.count}" data-cover="${esc(p.cover || '')}" style="accent-color:var(--purple-soft);flex:0 0 auto;">
              ${p.cover ? `<img src="${esc(p.cover)}" referrerpolicy="no-referrer" style="width:34px;height:34px;border-radius:6px;object-fit:cover;flex:0 0 auto;">` : `<span style="width:34px;height:34px;border-radius:6px;background:var(--bm-card, rgba(255,255,255,.05));display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);flex:0 0 auto;">♪</span>`}
              <div style="flex:1;min-width:0;"><div style="font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.name)}</div><div style="font-size:11px;color:var(--text-tertiary);">${p.count} 首</div></div>
            </label>`).join('')}
        </div>
        <div style="display:flex;gap:10px;margin-top:12px;">
          <button class="btn" style="flex:1;" id="bm-neimport-cancel">取消</button>
          <button class="btn primary" style="flex:1;" id="bm-neimport-ok">导入</button>
        </div>
      </div>`;
    host.appendChild(sub);
    sub.querySelector('#bm-neimport-close').onclick = () => sub.remove();
    sub.querySelector('.bm-lib-submask').onclick = () => sub.remove();
    sub.querySelector('#bm-neimport-cancel').onclick = () => sub.remove();
    const listBox = sub.querySelector('#bm-neimport-list');
    const allCb = sub.querySelector('#bm-neimport-all');
    const cbs = listBox ? listBox.querySelectorAll('.bm-neimport-cb') : [];
    // 全选
    if (allCb) allCb.onchange = () => { cbs.forEach(c => { c.checked = allCb.checked; }); };
    // 单项反选时同步全选状态
    const syncAll = () => { if (allCb) { const total = cbs.length; const checked = listBox.querySelectorAll('.bm-neimport-cb:checked').length; allCb.checked = total > 0 && checked === total; } };
    cbs.forEach(c => { c.onchange = syncAll; });
    sub.querySelector('#bm-neimport-ok').onclick = async () => {
      const checked = Array.from(listBox.querySelectorAll('.bm-neimport-cb:checked'));
      if (!checked.length) { if (window.miniToast) miniToast('请先勾选要导入的歌单'); return; }
      const btn = sub.querySelector('#bm-neimport-ok'); btn.disabled = true; btn.textContent = '导入中…';
      let imported = 0, failed = 0;
      for (const cb of checked) {
        const pid = cb.dataset.id, name = cb.dataset.name, cover = cb.dataset.cover || '';
        try {
          const tracks = await _netEasePlaylistTracks(pid);
          if (!tracks || !tracks.length) { failed++; continue; }
          // 每首歌存进音乐库曲库（kind:'local'，source:'netease-direct'，播放时联网取直链）
          const rec = await M.createPlaylist(name + '（网易云）', cover);
          if (!rec) { failed++; continue; }
          for (const t of tracks) {
            // 20261106 修复「导入歌单无封面」：网易云 playlist/detail 老接口返回的 al.picUrl
            //   可能为空或字段缺失，这里逐首用 song/detail 接口兜底补封面，导入后列表即有封面。
            let pic = t.pic || '';
            if (!pic && t.id) {
              try {
                const dj = await _netEaseReq('https://music.163.com/api/song/detail?ids=[' + t.id + ']');
                const s0 = dj && dj.songs && dj.songs[0];
                if (s0 && s0.album && s0.album.picUrl) pic = String(s0.album.picUrl).replace(/^http:\/\//i, 'https://');
              } catch (e) {}
            }
            const saved = await M.addLocalTrack({ name: t.name, artist: t.artist, pic: pic, url: '', source: 'netease-direct', _neteaseId: t.id });
            if (saved) await M.addToPlaylist(rec.id, saved.id);
          }
          imported++;
        } catch (e) { failed++; }
      }
      sub.remove();
      if (window.miniToast) miniToast(`已导入 ${imported} 张歌单` + (failed ? `，${failed} 张失败` : '') + '，可在音乐库「歌单」里查看');
    };
  }

  /* ---------- 每日推荐 ----------
     点「每日推荐」→ 直接打开网易云音乐的「每日推荐」并自动播放。
     20261106 用户明确纠正：每日推荐不是「抓歌单」，是真正打开网易云的每日推荐。
     实现：App 端用原生插件 openUrl 拉起 orpheus://songrcmd?autoplay=1 深链，
     网易云 App 会直接打开每日推荐页并自动播放；网页端/无插件/深链打开失败时
     回退到本地推荐关键词搜歌播。 */
  const _dailyKwPool = ['每日推荐', '今日热歌', '新歌速递', '流行精选', '热歌榜', '华语新歌'];
  // 20261107 回退来源改造：不再用固定关键词搜歌（结果高度重复、风格固定），
  //   改为拉网易云官方榜单歌单（新歌榜/热歌榜/飙升榜，官方天天更新、无需登录、GET 直取），
  //   保证「每日推荐」回退路径也是实时变化的最新推荐，而非「永远这批歌」。
  const _dailyOfficialIds = ['3779629', '3778678', '19723756'];  // 新歌榜 / 热歌榜 / 飙升榜
  async function _dailyRecommend(say) {
    // ① 优先：原生插件拉起网易云「每日推荐」（orpheus://songrcmd?autoplay=1 自动播放）
    const bridge = _remoteBridge();
    if (bridge && typeof bridge.openUrl === 'function') {
      try {
        // 先停掉内置播放器，避免与外部网易云同时响
        try { const a = M.state.audio; if (a) a.pause(); M.state.playing = false; } catch (e) {}
        const r = await bridge.openUrl({ url: 'orpheus://songrcmd?autoplay=1' });
        if (r && r.opened) {
          if (say) say('已为你打开网易云每日推荐');
          else if (window.miniToast) miniToast('已打开网易云每日推荐');
          return;
        }
        // 深链打开失败（未装网易云/无 scheme）→ 走下方本地回退
        if (say) say('没能直接拉起网易云，改用内置每日推荐');
      } catch (e) {
        // 原生调用异常 → 本地回退
      }
    }
    // ② 回退：本地推荐关键词搜歌整批播（网页端 / 无插件 / 深链失败）
    // 20261105 直连模式：镜像源已失效（qijieya/gdstudio/meting 均挂），改用网易云官方搜索
    //   拿真实可播直链，根治「每日推荐暂时没抓到歌」。
    // 20261107 回退来源改造：优先拉网易云官方榜单歌单（新歌榜/热歌榜/飙升榜，天天更新、无需登录），
    //   拉不到才落回固定关键词搜歌兜底。这样「每日推荐」回退也是实时最新的官方推荐，不是「永远这批歌」。
    if (_netEaseDirect) {
      const fulls = [];
      // 20261107：直连优先拉「用户账号真实的每日推荐 30 首」（/weapi recommend/songs，需登录）
      const rcmd = await _netEaseRecommendSongs();
      if (rcmd && rcmd.length) {
        for (const s of rcmd.slice(0, 30)) {
          const u = await _netEaseSongUrl(s.id);
          if (u && u.url) fulls.push({ id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' });
        }
      }
      // 拿不到真实每日推荐（未登录/weapi 失败）→ 落回官方榜单歌单
      if (!fulls.length) {
        for (const pid of _dailyOfficialIds) {
          const tracks = await _netEasePlaylistTracks(pid);
          if (!tracks || !tracks.length) continue;
          for (const s of tracks.slice(0, 20)) {
            const u = await _netEaseSongUrl(s.id);
            if (u && u.url) fulls.push({ id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' });
          }
          if (fulls.length) break;
        }
      }
      if (!fulls.length) {
        for (const kw of _dailyKwPool) {
          const list = await _netEaseSearch(kw);
          if (!list || !list.length) continue;
          for (const s of list.slice(0, 12)) {
            const u = await _netEaseSongUrl(s.id);
            if (u && u.url) fulls.push({ id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' });
          }
          if (fulls.length) break;
        }
      }
      if (!fulls.length) { if (say) say('每日推荐暂时没抓到可播的歌'); if (window.miniToast) miniToast('每日推荐暂时没抓到歌'); return; }
      M.state.playlist = fulls;
      M.state.playIndex = 0;
      try { await M.play(fulls[0]); } catch (e) {}
      if (say) say(`播放了每日推荐，共 ${fulls.length} 首`);
      return;
    }
    // 本地：随机推荐关键词搜歌，整批入队列播放；某关键词抓不到歌则换下一个重试
    // 20261106 修复「每日推荐抓不到歌」：镜像源（qijieya/gdstudio/meting）已失效，
    //   M.search() 走镜像源必然空。这里优先试网易云官方搜索（_netEaseSearch 走原生 Cookie，
    //   只要登录态有效就能搜，不依赖 _netEaseDirect 开关），成功则用网易云直链播；
    //   失败（未登录/无 Cookie）才落回镜像源 M.search()。
    let fulls = [];
    const neTried = await (async () => {
      try {
        const chk = await _netEaseSearch(_dailyKwPool[0]);
        return !!(chk && chk.length);
      } catch (e) { return false; }
    })();
    if (neTried) {
      for (const kw of _dailyKwPool) {
        const list = await _netEaseSearch(kw);
        if (!list || !list.length) continue;
        for (const s of list.slice(0, 12)) {
          const u = await _netEaseSongUrl(s.id);
          if (u && u.url) fulls.push({ id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' });
        }
        if (fulls.length) break;
      }
    }
    if (!fulls.length) {
      for (const kw of _dailyKwPool) {
        const res = await M.search(kw);
        if (!res || !res.length) continue;
        const batch = res.slice(0, 12);
        for (const s of batch) {
          const f = await M.fetchSongDetail(s);
          if (f && f.url) fulls.push(f);
        }
        if (fulls.length) break;   // 抓到歌就停，不再换关键词
      }
    }
    if (!fulls.length) { if (say) say('每日推荐暂时没抓到可播的歌'); if (window.miniToast) miniToast('每日推荐暂时没抓到歌'); return; }
    M.state.playlist = fulls;
    M.state.playIndex = 0;
    try { await M.play(fulls[0]); } catch (e) {}
    if (say) say(`播放了每日推荐，共 ${fulls.length} 首`);
  }

  /* ---------- 漫游 ----------
     点「漫游」→ 直接开启网易云音乐的「私人 FM / 漫游」功能。
     20261106 用户明确纠正：漫游不是「抓歌单」，是真正开启网易云的漫游（私人FM）。
     实现：App 端用原生插件 openUrl 拉起 orpheus://radio 深链，网易云 App 会直接
     打开私人 FM 并开始播放；网页端/无插件/深链打开失败时回退到本地随机漫游播歌。 */
  const _roamKwPool = ['轻音乐', '民谣', '古风', '纯音乐', '爵士', '摇滚', '电子', '治愈系', '雨声', '星空', '钢琴', '慢歌', '回忆', '夏日', '晚安曲'];
  // 20261107 漫游回退来源改造：改用网易云官方「多风格」榜单歌单（无需登录、GET 直取、官方更新），
  //   取代固定关键词搜歌，让漫游每次都是实时变化的最新歌，而不是固定风格那一批。
  const _roamOfficialIds = ['19723756', '2250011882', '2884035', '3779629', '3778678', '2842711079', '2887052', '2890194'];  // 飙升/抖音/原创/新歌/热歌/电音/民谣/古风等
  async function _roamPlay(say) {
    // ① 优先：原生插件拉起网易云私人 FM（漫游）
    const bridge = _remoteBridge();
    if (bridge && typeof bridge.openUrl === 'function') {
      try {
        // 先停掉内置播放器，避免与外部网易云同时响
        try { const a = M.state.audio; if (a) a.pause(); M.state.playing = false; } catch (e) {}
        const r = await bridge.openUrl({ url: 'orpheus://radio' });
        if (r && r.opened) {
          if (say) say('已为你开启网易云漫游（私人 FM）');
          else if (window.miniToast) miniToast('已开启网易云漫游');
          return;
        }
        // 深链打开失败（未装网易云/无 scheme）→ 走下方本地回退
        if (say) say('没能直接拉起网易云，改用内置漫游');
      } catch (e) {
        // 原生调用异常 → 本地回退
      }
    }
    // ② 回退：本地随机漫游播歌（网页端 / 无插件 / 深链失败）
    // 20261105 直连模式：镜像源失效，改用网易云官方搜索，根治「漫游暂时没抓到歌」。
    // 20261107 回退来源改造：随机挑一个网易云官方榜单歌单（多风格、天天更新、无需登录），
    //   拉不到才落回固定关键词搜歌兜底。让漫游每次都是实时变化的最新歌，不是固定风格那一批。
    if (_netEaseDirect) {
      const ids = [..._roamOfficialIds];
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      let fulls = [];
      // 20261107：直连优先拉「用户账号真实的私人FM」（/weapi radio/get，需登录），多拉几批凑够一批
      try {
        for (let round = 0; round < 10 && fulls.length < 15; round++) {
          const fm = await _netEasePersonalFm();
          if (!fm || !fm.length) break;
          for (const s of fm) {
            const u = await _netEaseSongUrl(s.id);
            if (u && u.url) fulls.push({ id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' });
          }
        }
      } catch (e) {}
      // 拿不到私人FM（未登录/weapi 失败）→ 落回官方榜单歌单
      if (!fulls.length) {
        for (const pid of ids) {
          const tracks = await _netEasePlaylistTracks(pid);
          if (!tracks || !tracks.length) continue;
          const batch = tracks.slice(0, 20);
          for (let i = batch.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [batch[i], batch[j]] = [batch[j], batch[i]]; }
          for (const s of batch) {
            const u = await _netEaseSongUrl(s.id);
            if (u && u.url) fulls.push({ id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' });
          }
          if (fulls.length) break;
        }
      }
      if (!fulls.length) {
        const pool = [..._roamKwPool];
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        for (const kw of pool) {
          const list = await _netEaseSearch(kw);
          if (!list || !list.length) continue;
          const batch = list.slice(0, 15);
          for (let i = batch.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [batch[i], batch[j]] = [batch[j], batch[i]]; }
          for (const s of batch) {
            const u = await _netEaseSongUrl(s.id);
            if (u && u.url) fulls.push({ id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' });
          }
          if (fulls.length) break;
        }
      }
      if (!fulls.length) { if (say) say('漫游暂时没抓到可播的歌'); if (window.miniToast) miniToast('漫游暂时没抓到歌'); return; }
      M.state.playlist = fulls;
      M.state.playIndex = 0;
      try { await M.play(fulls[0]); } catch (e) {}
      if (say) say(`开启了音乐漫游，随机漫游 ${fulls.length} 首`);
      return;
    }
    // 随机风格搜歌，洗牌后整批播；某风格抓不到歌则换下一个重试
    // 20261106 修复「漫游抓不到歌」：镜像源已失效，M.search() 必然空。优先试网易云官方搜索
    //   （有登录态即可用，不依赖 _netEaseDirect），失败才落回镜像源 M.search()。
    const pool = [..._roamKwPool];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    let fulls = [];
    const neTried = await (async () => {
      try { const chk = await _netEaseSearch(pool[0]); return !!(chk && chk.length); } catch (e) { return false; }
    })();
    if (neTried) {
      for (const kw of pool) {
        const list = await _netEaseSearch(kw);
        if (!list || !list.length) continue;
        const batch = list.slice(0, 15);
        for (let i = batch.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [batch[i], batch[j]] = [batch[j], batch[i]]; }
        for (const s of batch) {
          const u = await _netEaseSongUrl(s.id);
          if (u && u.url) fulls.push({ id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' });
        }
        if (fulls.length) break;
      }
    }
    if (!fulls.length) {
      for (const kw of pool) {
        const res = await M.search(kw);
        if (!res || !res.length) continue;
        const batch = res.slice(0, 15);
        for (let i = batch.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [batch[i], batch[j]] = [batch[j], batch[i]]; }
        for (const s of batch) {
          const f = await M.fetchSongDetail(s);
          if (f && f.url) fulls.push(f);
        }
        if (fulls.length) break;
      }
    }
    if (!fulls.length) { if (say) say('漫游暂时没抓到可播的歌'); if (window.miniToast) miniToast('漫游暂时没抓到歌'); return; }
    M.state.playlist = fulls;
    M.state.playIndex = 0;
    try { await M.play(fulls[0]); } catch (e) {}
    if (say) say(`开启了音乐漫游，随机漫游 ${fulls.length} 首`);
  }

  /* 20261105：未登录时搜歌结果浮层（复用 bm-netease-result 样式，渲染在 import-row 之后）。
     走镜像搜索结果，点一首走 M.fetchSongDetail 拿直链后播放。 */
  function _showSearchResultsMini(box, kw, list) {
    // 找一个容器：优先已有 #bm-netease-results，没有则在搜索行后插入一个
    let resultsBox = box.querySelector('#bm-netease-results');
    if (!resultsBox) {
      resultsBox = document.createElement('div');
      resultsBox.className = 'bm-netease-results';
      resultsBox.id = 'bm-netease-results';
      const searchRow = box.querySelector('.bm-netease-search-row');
      if (searchRow && searchRow.parentNode) searchRow.parentNode.insertBefore(resultsBox, searchRow.nextSibling);
      else box.appendChild(resultsBox);
    }
    resultsBox.style.display = 'block';
    resultsBox.innerHTML = `<div class="bm-netease-results-head">「${esc(kw)}」搜索结果（点一首播放 · 镜像源）</div>` + list.slice(0, 12).map(s => `
      <div class="bm-netease-result" data-id="${esc(s.id)}" data-name="${esc(s.name)}" data-artist="${esc(s.artist || '')}" data-pic="${esc(s.pic || '')}">
        ${s.pic ? `<img src="${esc(s.pic)}" referrerpolicy="no-referrer" alt="">` : '<span class="bm-netease-result-ph">♪</span>'}
        <div class="bm-netease-result-info"><div class="bm-netease-result-name">${esc(s.name)}</div><div class="bm-netease-result-artist">${esc(s.artist || '')}</div></div>
      </div>`).join('');
    resultsBox.querySelectorAll('.bm-netease-result').forEach(el => {
      el.onclick = async () => {
        const s = { id: el.dataset.id, name: el.dataset.name, artist: el.dataset.artist, pic: el.dataset.pic };
        let full = s;
        if (!full.url) { try { full = await M.fetchSongDetail(s); } catch (e) {} }
        if (!full || !full.url) {
          if (window.miniToast) miniToast('该歌曲可能无可用直链，无法播放');
          return;
        }
        M.state.playlist = [full]; M.state.playIndex = 0;
        try { await M.play(full); } catch (e) {}
        if (window.miniToast) miniToast('正在播放：' + (full.name || s.name));
      };
    });
  }

  async function renderRemotePanel(box) {
    const cur = M.state.current;
    const bridge = _remoteBridge();
    // 20261105 网易云直连：读「直连/遥控」开关 + 登录态
    await _netEaseLoadDirect();
    const isDirect = _netEaseDirect;
    const neBridge = _neteaseBridge();
    let neLogged = false;
    if (neBridge) { neLogged = await _netEaseLoggedIn(); }
    // 读当前遥控目标 App（尝试持久化，无则默认网易云）
    try { const v = await getSetting('remoteTargetApp', 'netease'); if (v) _remoteTargetApp = v; } catch (e) {}
    const target = _remoteApps.find(a => a.id === _remoteTargetApp) || _remoteApps[0];
    const appOptions = _remoteApps.map(a => `<option value="${a.id}" ${a.id === _remoteTargetApp ? 'selected' : ''}>${a.name}</option>`).join('');
    // 读「是否展开面板」持久化状态（默认展开）
    let collapsed = false;
    try { collapsed = (await getSetting('remotePanelCollapsed', false)) === true; } catch (e) {}
    // 检测通知监听权限是否已授权（Android 11+ 稳定遥控第三方 App 需要）
    let notifEnabled = true;   // 默认 true，避免 Web 端误提示
    if (bridge && typeof bridge.isNotificationListenerEnabled === 'function') {
      try { const r = await bridge.isNotificationListenerEnabled(); notifEnabled = !!r.enabled; } catch (e) {}
    }
    // 检测能否操控后台音乐（有无活跃媒体会话）
    let hasSession = false; let sessionPkg = '';
    if (bridge && typeof bridge.hasActiveSession === 'function') {
      try { const r = await bridge.hasActiveSession(); hasSession = !!r.hasSession; sessionPkg = r.packageName || ''; } catch (e) {}
    }
    const sessionApp = _remoteApps.find(a => a.pkg === sessionPkg);
    const canControl = !!(bridge && hasSession);

    box.innerHTML = `
      <div class="bm-remote-box bm-remote-box-solid">
        <div class="bm-remote-headbar" id="bm-remote-headbar">
          <span class="bm-remote-head">📻 后台遥控</span>
          <div class="bm-remote-mode-switch" id="bm-remote-mode-switch">
            <span class="bm-remote-mode-label">${isDirect ? '🔗 网易云直连' : '🎛 遥控外部App'}</span>
            <button class="bm-remote-mode-btn ${isDirect ? 'on' : ''}" id="bm-remote-mode-btn" title="切换直连/遥控">
              <span class="bm-remote-mode-knob"></span>
            </button>
          </div>
          <button class="bm-remote-fold" id="bm-remote-fold">${collapsed ? '▸ 展开' : '▾ 收起'}</button>
        </div>
        <div class="bm-remote-body" id="bm-remote-body" style="${collapsed ? 'display:none;' : ''}">
          ${isDirect ? `
          <div class="bm-netease-box">
            <div class="bm-netease-login-row">
              ${neLogged
                ? `<span class="bm-netease-status on">● 已登录网易云</span><button class="bm-remote-btn" id="bm-netease-logout">退出登录</button>`
                : `<span class="bm-netease-status">○ 未登录（登录后可用自己账号搜歌/读歌单/点VIP）</span><button class="bm-remote-btn bm-netease-login" id="bm-netease-login">🔑 登录网易云</button>`}
            </div>
            <div class="bm-netease-import-row">
              <button class="bm-remote-btn bm-netease-import-fixed" id="bm-netease-import-fixed">⬇ 导入歌单</button>
            </div>
            <div class="bm-netease-search-row">
              <input class="bm-netease-input" id="bm-netease-search-input" placeholder="搜索网易云歌曲…" />
              <button class="bm-remote-btn" id="bm-netease-search-btn">搜歌</button>
            </div>
            ${neLogged ? `
            <div class="bm-netease-playlists" id="bm-netease-playlists"></div>
            <div class="bm-netease-results" id="bm-netease-results" style="display:none;"></div>
            ` : `<div class="bm-remote-status">登录后可：识别自己歌单 / 主动搜歌（含 VIP 试听）/ 角色也能搜歌点播。</div>`}
          </div>` : ''}
          <div class="bm-remote-conn ${canControl ? 'on' : ''}">
            <span class="bm-remote-dot"></span>
            <span class="bm-remote-conn-txt">${canControl ? ('可操控后台音乐' + (sessionApp ? ' · ' + sessionApp.name : '')) : (bridge ? '已连接插件，但当前没有正在播放的音乐' : '演示模式（未连接原生遥控插件）')}</span>
          </div>
          <div class="bm-remote-now" id="bm-remote-now" style="${canControl ? '' : 'display:none;'}">
            <div class="bm-remote-now-cover" id="bm-remote-now-cover"></div>
            <div class="bm-remote-now-info">
              <div class="bm-remote-now-title" id="bm-remote-now-title">—</div>
              <div class="bm-remote-now-artist" id="bm-remote-now-artist">正在读取后台歌曲…</div>
            </div>
            <button class="bm-remote-btn bm-remote-now-refresh" id="bm-remote-now-refresh" title="刷新后台状态">↻</button>
          </div>
          ${(!notifEnabled) ? `
          <div class="bm-remote-perm" id="bm-remote-perm">
            <span class="bm-remote-perm-txt">⚠️ 尚未授权「通知使用权」，Android 11+ 需此权限才能稳定遥控第三方音乐 App。</span>
            <button class="bm-remote-btn bm-remote-perm-btn" id="bm-remote-permbtn">去授权</button>
          </div>` : ''}
          <div class="bm-remote-row">
            <label class="bm-remote-label">目标 App</label>
            <select class="bm-remote-app" id="bm-remote-app">${appOptions}</select>
          </div>
          <div class="bm-remote-status">${canControl ? '可操控后台正在播放的音乐，点下方按钮直接遥控。' : (bridge ? '请先打开音乐 App 播放一首，再回来点「盲抽一首」。' : '未在播放 · 点「盲抽一首」开始')}</div>
          <div class="bm-remote-ctrl">
            <button class="bm-remote-btn bm-remote-blind" id="bm-remote-blind">🎲 盲抽一首</button>
            <button class="bm-remote-btn" id="bm-remote-daily">📅 每日推荐</button>
            <button class="bm-remote-btn" id="bm-remote-roam">🧭 漫游</button>
          </div>
          <div class="bm-remote-ctrl">
            <button class="bm-remote-btn" id="bm-remote-readnow">🎧 播放当前这首</button>
          </div>
          <div class="bm-remote-tip">上一首 / 播放 / 下一首 用下方悬浮窗那排图标直接遥控，这里不再重复。后台直接给 ${target.name} 发指令，不跳转软件；仅能盲抽盲切外部 App 歌单，不能指定搜索。</div>
          <div class="bm-remote-tip bm-remote-tip-warn">${bridge ? '已走原生插件控制外部 App（MediaSession / NotificationListener）。' : '当前为 Web 演示：真实控制外部 App 需在 App 端接入原生遥控插件。'}</div>
        </div>
      </div>`;
    // ===== 20261105 网易云直连事件 =====
    // 直连/遥控 开关切换（点击整个开关区域，不冒泡到折叠）
    const modeBtn = box.querySelector('#bm-remote-mode-btn');
    if (modeBtn) modeBtn.onclick = async (e) => {
      e.stopPropagation();
      // 20261106：切换时旋钮弹性拉伸（拉长成胶囊→回弹）
      if (window.bmFx) {
        const knob = modeBtn.querySelector('.bm-remote-mode-knob');
        if (knob) window.bmFx.elasticKnob(knob, 'left');
      }
      await _netEaseSetDirect(!_netEaseDirect);
      renderRemotePanel(box);
    };
    // 登录网易云
    const loginBtn = box.querySelector('#bm-netease-login');
    if (loginBtn) loginBtn.onclick = async (e) => {
      e.stopPropagation();
      const b = _neteaseBridge();
      if (!b || typeof b.neteaseLogin !== 'function') {
        if (window.miniToast) miniToast('直连登录需真机原生插件（当前为 Web 演示）');
        return;
      }
      try { await b.neteaseLogin(); } catch (err) {}
      if (window.miniToast) miniToast('请在打开的网易云页面登录，登录成功后自动返回');
      // 登录页返回后刷新登录态
      setTimeout(async () => { renderRemotePanel(box); }, 2500);
    };
    // 退出登录
    const logoutBtn = box.querySelector('#bm-netease-logout');
    if (logoutBtn) logoutBtn.onclick = async (e) => {
      e.stopPropagation();
      const b = _neteaseBridge();
      if (b && typeof b.neteaseClear === 'function') { try { await b.neteaseClear(); } catch (err) {} }
      renderRemotePanel(box);
    };
    // 20261105 固定「导入歌单」按钮（登录行下方黑框内，登录与否都显示）
    const importFixed = box.querySelector('#bm-netease-import-fixed');
    if (importFixed) importFixed.onclick = async (e) => {
      e.stopPropagation();
      if (!neLogged) {
        if (window.miniToast) miniToast('请先登录网易云，再导入你的歌单');
        return;
      }
      const pls = await _netEaseMyPlaylists();
      if (!pls || !pls.length) { if (window.miniToast) miniToast('没读到你的歌单（可能账号没建歌单）'); return; }
      await _netEaseImportPlaylists(pls);
    };
    // 搜歌（直连，带 Cookie 搜网易云）
    const searchBtn = box.querySelector('#bm-netease-search-btn');
    const searchInput = box.querySelector('#bm-netease-search-input');
    const resultsBox = box.querySelector('#bm-netease-results');
    const doSearch = async () => {
      const kw = (searchInput ? searchInput.value : '').trim();
      if (!kw) { if (window.miniToast) miniToast('请输入要搜索的歌曲'); return; }
      // 20261105：未登录时网易云直连搜不了，回退走镜像搜索（M.search），让模式二（一起听/镜像）不登录也能搜歌播放
      if (!neLogged) {
        const list = await M.search(kw);
        if (!list || !list.length) { if (window.miniToast) miniToast('没搜到结果（镜像源可能抽风，稍后再试）'); return; }
        // 未登录时没有 resultsBox 容器（在 neLogged 分支里），改用迷你结果浮层展示
        _showSearchResultsMini(box, kw, list);
        return;
      }
      const list = await _netEaseSearch(kw);
      if (!list || !list.length) { if (window.miniToast) miniToast('直连没搜到结果（可能未登录或接口异常）'); return; }
      resultsBox.style.display = 'block';
      resultsBox.innerHTML = `<div class="bm-netease-results-head">「${esc(kw)}」搜索结果（点一首播放）</div>` + list.slice(0, 12).map(s => `
        <div class="bm-netease-result" data-id="${s.id}" data-name="${esc(s.name)}" data-artist="${esc(s.artist)}" data-pic="${esc(s.pic)}">
          ${s.pic ? `<img src="${esc(s.pic)}" referrerpolicy="no-referrer" alt="">` : '<span class="bm-netease-result-ph">♪</span>'}
          <div class="bm-netease-result-info"><div class="bm-netease-result-name">${esc(s.name)}</div><div class="bm-netease-result-artist">${esc(s.artist)}</div></div>
        </div>`).join('');
      resultsBox.querySelectorAll('.bm-netease-result').forEach(el => {
        el.onclick = async () => {
          const id = el.dataset.id, name = el.dataset.name, artist = el.dataset.artist, pic = el.dataset.pic;
          const u = await _netEaseSongUrl(id);
          if (!u || !u.url) {
            if (window.miniToast) miniToast('该歌曲可能是 VIP 或无直链，无法播放');
            return;
          }
          const full = { id, name, artist, pic, url: u.url, source: 'netease-direct' };
          M.state.playlist = [full]; M.state.playIndex = 0;
          try { await M.play(full); } catch (e) {}
          if (window.miniToast) miniToast('正在播放：' + name);
        };
      });
    };
    if (searchBtn) searchBtn.onclick = (e) => { e.stopPropagation(); doSearch(); };
    if (searchInput) searchInput.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
    // 加载「我的歌单」（直连）
    const plBox = box.querySelector('#bm-netease-playlists');
    if (plBox && neLogged) {
      _netEaseMyPlaylists().then(pls => {
        if (!pls || !pls.length) { plBox.innerHTML = '<div class="bm-netease-empty">没读到你的歌单（可能账号没建歌单）</div>'; return; }
        plBox.innerHTML = `<div class="bm-netease-results-head">🎵 我的歌单（点一首播放 · 或导入到音乐库）<button class="bm-remote-btn bm-netease-import" id="bm-netease-import" title="勾选歌单导入到音乐库">⬇ 导入歌单</button></div>` + pls.slice(0, 50).map(p => `
          <div class="bm-netease-playlist" data-id="${p.id}">
            ${p.cover ? `<img src="${esc(p.cover)}" referrerpolicy="no-referrer" alt="">` : '<span class="bm-netease-result-ph">♪</span>'}
            <div class="bm-netease-result-info"><div class="bm-netease-result-name">${esc(p.name)}</div><div class="bm-netease-result-artist">${p.count} 首</div></div>
          </div>`).join('');
        plBox.querySelectorAll('.bm-netease-playlist').forEach(el => {
          el.onclick = async () => {
            const tracks = await _netEasePlaylistTracks(el.dataset.id);
            if (!tracks || !tracks.length) { if (window.miniToast) miniToast('歌单里没有歌曲'); return; }
            // 整张歌单入播放队列，从第一首播
            const fulls = [];
            for (const t of tracks.slice(0, 30)) {
              const u = await _netEaseSongUrl(t.id);
              if (u && u.url) fulls.push({ id: t.id, name: t.name, artist: t.artist, pic: t.pic, url: u.url, source: 'netease-direct' });
            }
            if (!fulls.length) { if (window.miniToast) miniToast('歌单歌曲暂无可用直链'); return; }
            M.state.playlist = fulls; M.state.playIndex = 0;
            try { await M.play(fulls[0]); } catch (e) {}
            if (window.miniToast) miniToast('播放歌单：' + fulls.length + ' 首');
          };
        });
        // 20261105：导入歌单按钮 → 弹窗勾选网易云歌单 → 存进音乐库歌单
        const importBtn = box.querySelector('#bm-netease-import');
        if (importBtn) importBtn.onclick = async (e) => {
          e.stopPropagation();
          await _netEaseImportPlaylists(pls);
        };
      });
    }
    // ===== 网易云直连事件结束 =====
    // 展开/收起
    box.querySelector('#bm-remote-headbar').onclick = async () => {
      const body = box.querySelector('#bm-remote-body');
      const fold = box.querySelector('#bm-remote-fold');
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? '' : 'none';
      fold.textContent = isHidden ? '▾ 收起' : '▸ 展开';
      try { await setSetting('remotePanelCollapsed', !isHidden); } catch (e) {}
    };
    // 20261105：读取后台正在播放的歌曲（歌名/歌手/封面）并展示到「后台当前播放」卡片。
    //   封面优先用原生插件读到的 st.cover（后台 App 真实封面 base64/uri），读不到再用白日梦音源搜同款补。
    async function refreshRemoteNow() {
      const nowBox = box.querySelector('#bm-remote-now');
      const coverEl = box.querySelector('#bm-remote-now-cover');
      const titleEl = box.querySelector('#bm-remote-now-title');
      const artistEl = box.querySelector('#bm-remote-now-artist');
      if (!nowBox || !bridge || typeof bridge.getMediaState !== 'function') return;
      let st = null;
      try { st = await bridge.getMediaState(); } catch (e) {}
      if (!st || !st.hasSession) { if (nowBox) nowBox.style.display = 'none'; return; }
      nowBox.style.display = '';
      const title = (st.title || '').trim();
      const artist = (st.artist || '').trim();
      titleEl.textContent = title || '未知歌曲';
      artistEl.textContent = artist || '未知歌手';
      // 封面：优先后台真实封面
      if (st.cover && typeof st.cover === 'string' && st.cover) {
        coverEl.innerHTML = `<img src="${esc(st.cover)}" alt="" draggable="false">`;
        coverEl.style.background = 'none';
      } else {
        coverEl.innerHTML = '♪';
        coverEl.style.background = '';
        // 读不到后台封面时，用白日梦音源搜同款补一张封面
        if (title) {
          try {
            const res = await M.search(title + (artist ? ' ' + artist : ''));
            if (res && res.length) {
              const f = await M.fetchSongDetail(res[0]);
              if (f && f.pic) {
                coverEl.innerHTML = `<img src="${esc(f.pic)}" alt="" draggable="false">`;
                coverEl.style.background = 'none';
              }
            }
          } catch (e) {}
        }
      }
    }
    // 有插件且能读状态时，面板打开即刷新一次后台状态
    if (bridge && typeof bridge.getMediaState === 'function') {
      refreshRemoteNow();
    }
    const nowRefreshBtn = box.querySelector('#bm-remote-now-refresh');
    if (nowRefreshBtn) nowRefreshBtn.onclick = (e) => { e.stopPropagation(); refreshRemoteNow(); };

    // 去授权通知监听
    const permBtn = box.querySelector('#bm-remote-permbtn');
    if (permBtn) permBtn.onclick = async () => {
      if (bridge && typeof bridge.openNotificationListenerSettings === 'function') {
        try { await bridge.openNotificationListenerSettings(); } catch (e) {}
      } else {
        if (window.miniToast) miniToast('请在系统设置里开启「通知使用权」');
      }
    };
    // 切换目标 App
    box.querySelector('#bm-remote-app').onchange = async (e) => {
      _remoteTargetApp = e.target.value;
      try { await setSetting('remoteTargetApp', _remoteTargetApp); } catch (err) {}
      if (bridge && bridge.setTarget) { try { bridge.setTarget(_remoteTargetApp); } catch (err) {} }
      renderRemotePanel(box);
    };
    // 盲抽：真机走原生插件盲切（发 next 给外部 App）。网页端无插件时禁止 fallback 到镜像搜索/本地曲库。
    box.querySelector('#bm-remote-blind').onclick = async () => {
      // 20261106：后台遥控（盲抽/每日推荐/漫游/播放当前这首）专给 App 端操控后台音乐 App 用；
      //   网页端没有原生插件（bridge），不能落回镜像搜索/本地解析播放——直接提示不可用。
      if (!bridge) { if (window.miniToast) miniToast('「盲抽一首」需 App 端操控后台音乐 App（网页端不可用）'); return; }
      if (bridge.next) {
        try { await bridge.next(); } catch (e) { if (window.miniToast) miniToast('原生遥控指令失败'); }
        // 20261105：遥控外部 App 盲抽切歌后，同步本地播放态，驱动星球律动/水波纹动效
        M.state.playing = true;
        // 20261106 修复「盲抽后播放器封面/歌词不跟着切」：切歌后稍等后台 MediaSession 更新，
        //   再 refreshPlayerUI()（内部 _refreshExternalIntoPlayerUI 读后台真实 title/artist/cover
        //   覆盖播放器圆盘与标题；歌词区显示「后台播放中」占位）。
        renderRemotePanel(box);
        setTimeout(() => { try { refreshPlayerUI(); } catch (e) {} }, 600);
        return;
      }
      if (window.miniToast) miniToast('原生插件暂不支持盲切');
      renderRemotePanel(box);
    };
    // 每日推荐：仅「网易云直连」模式下可用；后台遥控（外部 App）模式无此能力，点它给提示。
    box.querySelector('#bm-remote-daily').onclick = async () => {
      // 20261107 用户定案：后台遥控（未开直连 isDirect=false）下，每日推荐不可用——提醒玩家切换模式。
      if (!isDirect) {
        if (window.miniToast) miniToast('「每日推荐」需在「网易云直连」模式下使用，请先切换上方模式');
        return;
      }
      // 20261106：复用软件内 _dailyRecommend——优先 openUrl 深链拉起网易云每日推荐，
      //   深链失败（网页端/未装网易云）则回退本地推荐关键词搜歌整批播。
      if (typeof _dailyRecommend === 'function') {
        if (window.miniToast) miniToast('正在打开每日推荐…');
        await _dailyRecommend((t) => { if (t && window.miniToast) miniToast(t); });
        renderRemotePanel(box);
        return;
      }
      if (window.miniToast) miniToast('每日推荐暂不可用');
      renderRemotePanel(box);
    };
    // 漫游：仅「网易云直连」模式下可用；后台遥控（外部 App）模式无此能力，点它给提示。
    box.querySelector('#bm-remote-roam').onclick = async () => {
      // 20261107 用户定案：后台遥控（未开直连 isDirect=false）下，漫游不可用——提醒玩家切换模式。
      if (!isDirect) {
        if (window.miniToast) miniToast('「漫游」需在「网易云直连」模式下使用，请先切换上方模式');
        return;
      }
      // 20261106：复用软件内 _roamPlay——优先 openUrl 深链拉起网易云私人FM（orpheus://radio），
      //   深链失败（网页端/未装网易云）则回退本地随机风格搜歌整批播。
      if (typeof _roamPlay === 'function') {
        if (window.miniToast) miniToast('正在开启音乐漫游…');
        await _roamPlay((t) => { if (t && window.miniToast) miniToast(t); });
        renderRemotePanel(box);
        return;
      }
      if (window.miniToast) miniToast('漫游暂不可用');
      renderRemotePanel(box);
    };
    // 播放当前这首：真机有插件时读正在播的 title/artist，搜同款播放；网页端无插件提示仅 App 端可用
    box.querySelector('#bm-remote-readnow').onclick = async () => {
      // 20261106：网页端无插件不可用，不落回镜像搜索。
      if (!bridge || typeof bridge.getMediaState !== 'function') {
        if (window.miniToast) miniToast('「播放当前这首」需 App 端读取后台音乐 App（网页端不可用）');
        return;
      }
      {
        let st = null;
        try { st = await bridge.getMediaState(); } catch (e) {}
        if (!st || !st.hasSession) { if (window.miniToast) miniToast('外部 App 暂无活跃播放会话'); renderRemotePanel(box); return; }
        const title = (st.title || '').trim();
        const artist = (st.artist || '').trim();
        if (!title && !artist) { if (window.miniToast) miniToast('读不到当前歌曲信息'); renderRemotePanel(box); return; }
        if (window.miniToast) miniToast(`正在搜索：${title}${artist ? ' · ' + artist : ''}`);
        // 用歌名+歌手搜同款，白日梦自己播这首
        const kw = title + (artist ? ' ' + artist : '');
        // 20261105 直连模式优先走网易云官方搜索（镜像源失效，搜不到会误报「没搜到这首」）
        if (_netEaseDirect) {
          const list = await _netEaseSearch(kw);
          if (!list || !list.length) { if (window.miniToast) miniToast('白日梦没搜到这首《' + title + '》'); renderRemotePanel(box); return; }
          const s = list[0];
          const u = await _netEaseSongUrl(s.id);
          if (!u || !u.url) { if (window.miniToast) miniToast('未获取到播放直链'); renderRemotePanel(box); return; }
          const full = { id: s.id, name: s.name, artist: s.artist, pic: s.pic, url: u.url, source: 'netease-direct' };
          M.state.playlist = [full]; M.state.playIndex = 0;
          try { await M.play(full); } catch (e) {}
          if (window.miniToast) miniToast('正在播放：' + full.name);
          renderRemotePanel(box);
          return;
        }
        const res = await M.search(kw);
        if (!res || !res.length) { if (window.miniToast) miniToast('白日梦音源没搜到这首《' + title + '》'); renderRemotePanel(box); return; }
        const s = res[0];
        const full = await M.fetchSongDetail(s);
        if (!full || !full.url) { if (window.miniToast) miniToast('未获取到播放直链'); renderRemotePanel(box); return; }
        M.state.playlist = [full]; M.state.playIndex = 0;
        try { await M.play(full); } catch (e) {}
        if (window.miniToast) miniToast('正在播放：' + full.name);
        renderRemotePanel(box);
        return;
      }
    };
  }

  /* ============================================================
     音乐库弹窗（顶栏「音乐库」按钮 → 居中卡片弹层）
     含：歌曲列表 / 加歌(上传+搜索收藏) / 删除 / 批量管理 / 歌单
     ============================================================ */
  let _libSel = new Set();   // 批量管理模式下的选中曲目 id 集合

  /* ---------- 解析歌单（前置入口） ----------
     20261104：把「歌单解析」从音乐库-添加歌曲的子面板里提出来，做成主界面
     搜索框旁的「解析歌单」按钮直接弹出的独立浮层。粘贴网易云/QQ音乐/酷我/酷狗
     歌单分享链接 → 解析整张歌单歌曲列表 → 一键导入本地音乐库。 */
  function showParsePlaylist() {
    let pop = document.getElementById('bm-parse-playlist-pop');
    if (pop) { pop.remove(); return; }
    const page = document.getElementById('bm-music-page');
    const host = page || document.body;
    pop = document.createElement('div');
    pop.id = 'bm-parse-playlist-pop';
    pop.className = 'bm-lib-subpanel';
    pop.innerHTML = `
      <div class="bm-lib-submask" id="bm-parse-mask"></div>
      <div class="bm-lib-subcard">
        <div class="bm-lib-subhead"><span>解析歌单</span><button class="bm-lib-close" id="bm-parse-close">✕</button></div>
        <div class="bm-lib-parse-row">
          <input class="bm-lib-parse-input" id="bm-parse-input" placeholder="粘贴歌单分享链接（网易云/QQ音乐/酷我/酷狗…）" />
          <button class="bm-lib-parse-btn" id="bm-parse-btn">解析导入</button>
        </div>
        <div class="bm-lib-scantip" id="bm-parse-tip" style="display:none;"></div>
        <div class="bm-lib-subtip">粘贴歌单分享链接即可解析整张歌单的歌曲列表，导入本地音乐库；播放时自动联网取直链。支持网易云 / QQ音乐 / 酷我 / 酷狗。</div>
      </div>`;
    host.appendChild(pop);
    pop.querySelector('#bm-parse-mask').onclick = () => pop.remove();
    pop.querySelector('#bm-parse-close').onclick = () => pop.remove();
    const parseBtn = pop.querySelector('#bm-parse-btn');
    const parseInput = pop.querySelector('#bm-parse-input');
    const parseTip = pop.querySelector('#bm-parse-tip');
    const doParse = async () => {
      const txt = parseInput.value.trim();
      if (!txt) { if (window.miniToast) miniToast('请先粘贴歌单链接'); return; }
      const info = M.parsePlaylistLink(txt);
      if (!info) { if (window.miniToast) miniToast('无法识别该链接，请确认是网易云/QQ音乐等歌单分享链接'); return; }
      parseTip.style.display = 'block';
      parseTip.textContent = '正在解析歌单…';
      parseBtn.disabled = true;
      try {
        let id = info.id;
        // 短链（163cn.tv/xxx）：先展开跳转拿真实歌单 id
        if (!id && info.shortUrl) {
          parseTip.textContent = '正在展开短链接…';
          const longUrl = await M.expandNeteaseShortLink(info.shortUrl);
          id = M.extractNeteasePlaylistId(longUrl) || '';
          if (!id) { parseTip.textContent = '短链接展开失败，请改用长链接（网易云分享时选「复制链接」）或复制含 music.163.com 的完整链接'; return; }
        }
        const tracks = await M.fetchPlaylist(info.platform, id);
        if (!tracks.length) { parseTip.textContent = '未解析到歌曲，可能是该平台歌单接口暂不可用'; }
        else {
          let imported = 0;
          // 20261105：解析歌单只在「镜像搜索」模式进行（本地模式点解析已自动切镜像），
          //   导入 source 跟当前模式走（mirror 存镜像收藏库），并在镜像站匹配真实直链，避免
          //   「本地模式 url 为空 → 播放报未获取到播放直链」的问题。
          const src = M.state.mode === 'mirror' ? 'mirror' : 'local';
          for (const t of tracks) {
            await M.addLocalTrack({ id: t.id, name: t.name, artist: t.artist, album: t.album, pic: t.pic, url: t.url || '', lrc: '', source: src, _neteaseId: t._neteaseId });
            imported++;
          }
          parseTip.textContent = `已解析并导入 ${imported} 首歌曲到${src === 'mirror' ? '镜像收藏库' : '本地音乐库'}`;
          if (typeof renderLibSongs === 'function') renderLibSongs();
          if (window.miniToast) miniToast(`已导入 ${imported} 首歌曲`);
          parseInput.value = '';
        }
      } catch (e) {
        parseTip.textContent = '解析失败：' + (e && e.message ? e.message : e);
      } finally {
        parseBtn.disabled = false;
      }
    };
    parseBtn.onclick = doParse;
    parseInput.addEventListener('keydown', e => { if (e.key === 'Enter') doParse(); });
  }

  function showMusicLib() {
    let panel = document.getElementById('bm-music-lib-panel');
    if (panel) { panel.remove(); return; }
    const page = document.getElementById('bm-music-page');
    const host = page || document.body;
    const libName = M.state.mode === 'mirror' ? '镜像收藏库' : '本地音乐库';
    panel = document.createElement('div');
    panel.id = 'bm-music-lib-panel';
    panel.className = 'bm-music-lib-panel';
    panel.innerHTML = `
      <div class="bm-lib-mask" id="bm-lib-mask"></div>
      <div class="bm-lib-card">
        <div class="bm-lib-head">
          <span>${libName}</span>
          <div class="bm-lib-headbtns">
            <button class="bm-lib-manage" id="bm-lib-manage">批量管理</button>
            <button class="bm-lib-add" id="bm-lib-add">添加歌曲</button>
            <button class="bm-lib-close" id="bm-lib-close">✕</button>
          </div>
        </div>
        <div class="bm-lib-tabs">
          <button class="bm-lib-tab on" data-tab="songs">歌曲</button>
          <button class="bm-lib-tab" data-tab="playlists">歌单</button>
          <button class="bm-lib-tab" data-tab="visitor">访客收藏</button>
          <button class="bm-lib-tab" data-tab="ear">Ta的耳机</button>
        </div>
        <div class="bm-lib-body" id="bm-lib-body"></div>
        <div class="bm-lib-foot" id="bm-lib-foot" style="display:none;">
          <span class="bm-lib-selinfo" id="bm-lib-selinfo"></span>
          <div class="bm-lib-footbtns">
            <button class="bm-lib-del" id="bm-lib-batchdel">删除</button>
            <button class="bm-lib-addtopl" id="bm-lib-addtopl">加入歌单</button>
          </div>
        </div>
      </div>`;
    host.appendChild(panel);
    const close = () => { panel.remove(); _libSel.clear(); };
    panel.querySelector('#bm-lib-mask').onclick = close;
    panel.querySelector('#bm-lib-close').onclick = close;

    let curTab = 'songs';
    const tabs = panel.querySelectorAll('.bm-lib-tab');
    function switchTab(t) {
      curTab = t;
      tabs.forEach(x => x.classList.toggle('on', x.dataset.tab === t));
      _libSel.clear();
      renderLibFoot();
      if (t === 'songs') renderLibSongs(); else if (t === 'playlists') renderLibPlaylists(); else if (t === 'visitor') renderLibVisitor(); else renderLibEar();
    }
    tabs.forEach(x => x.onclick = () => switchTab(x.dataset.tab));

    // 添加歌曲 → 子浮层（上传本地 + 提示从搜索收藏）
    panel.querySelector('#bm-lib-add').onclick = () => showLibAdd(panel);

    // 批量管理 → 进入多选模式
    panel.querySelector('#bm-lib-manage').onclick = () => {
      const managing = panel.classList.toggle('managing');
      _libSel.clear();
      renderLibFoot();
      if (curTab === 'songs') renderLibSongs();
      panel.querySelector('#bm-lib-manage').textContent = managing ? '完成' : '批量管理';
    };

    // 底部批量操作
    panel.querySelector('#bm-lib-batchdel').onclick = async () => {
      if (!_libSel.size) return;
      const ids = [..._libSel];
      for (const id of ids) { await M.removeLocalTrack(id); _libSel.delete(id); }
      renderLibFoot();
      renderLibSongs();
      if (window.miniToast) miniToast(`已删除 ${ids.length} 首`);
    };
    panel.querySelector('#bm-lib-addtopl').onclick = () => showAddToPlaylist(panel);

    switchTab('songs');
  }

  /* 音乐库底部栏：批量模式下显示选中数 + 操作 */
  function renderLibFoot() {
    const foot = document.getElementById('bm-lib-foot');
    const info = document.getElementById('bm-lib-selinfo');
    const panel = document.getElementById('bm-music-lib-panel');
    if (!foot || !info) return;
    const managing = panel && panel.classList.contains('managing');
    if (!managing || !_libSel.size) { foot.style.display = 'none'; return; }
    foot.style.display = 'flex';
    info.textContent = `已选 ${_libSel.size} 首`;
  }

  /* 歌曲列表（含多选勾选、单曲删除、点歌播放）——按当前模式过滤 source */
  async function renderLibSongs() {
    const body = document.getElementById('bm-lib-body');
    if (!body) return;
    const panel = document.getElementById('bm-music-lib-panel');
    const managing = panel && panel.classList.contains('managing');
    const source = M.state.mode === 'mirror' ? 'mirror' : 'local';
    const lib = await M.getLocalLibrary(source);
    const emptyTip = source === 'mirror'
      ? '镜像收藏库为空，回到搜索页在结果点「☆」收藏歌曲'
      : '本地音乐库为空，点右上「添加歌曲」上传本地音乐';
    if (!lib.length) { body.innerHTML = `<div class="bm-music-empty">${emptyTip}</div>`; return; }
    body.innerHTML = lib.map(s => {
      const checked = _libSel.has(s.id);
      return `
      <div class="bm-lib-row ${checked ? 'on' : ''}" data-id="${esc(s.id)}">
        ${managing ? `<span class="bm-lib-check ${checked ? 'on' : ''}"></span>` : ''}
        <span class="bm-lib-cover">${s.pic ? `<img src="${esc(s.pic)}" alt="">` : '♪'}</span>
        <span class="bm-lib-info"><span class="bm-lib-name">${esc(s.name)}</span><span class="bm-lib-artist">${esc(s.artist || '')}</span></span>
        ${managing ? '' : `<button class="bm-lib-play" data-id="${esc(s.id)}" title="播放">${window.icon ? window.icon('play', 16) : '▶'}</button>`}
        ${managing ? '' : `<button class="bm-lib-del" data-id="${esc(s.id)}" title="删除">✕</button>`}
      </div>`;
    }).join('');
    body.querySelectorAll('.bm-lib-row').forEach(el => {
      el.onclick = async () => {
        const id = el.dataset.id;
        const t = lib.find(x => x.id === id);
        if (!t) return;
        if (managing) {
          if (_libSel.has(id)) _libSel.delete(id); else _libSel.add(id);
          el.classList.toggle('on', _libSel.has(id));
          const ck = el.querySelector('.bm-lib-check'); if (ck) ck.classList.toggle('on', _libSel.has(id));
          renderLibFoot();
        } else {
          // 20261105 修复「导入歌单无法播放」：导入的网易云歌单歌曲 url 为空（只存了 _neteaseId），
          //   直接 M.play(t) 会因 !song.url 提前 return「未获取到播放直链」。这里先 fetchSongDetail
          //   补直链（netease-direct 源走官方接口拿真实直链 + 封面 + 歌词），拿到 url 再播。
          M.state.playlist = lib; M.state.playIndex = lib.indexOf(t);
          if (!t.url) {
            const full = await M.fetchSongDetail(t);
            if (full) { lib[lib.indexOf(t)] = full; M.state.playlist = lib; M.play(full); refreshPlayerUI(); return; }
          }
          M.play(t); refreshPlayerUI();
        }
      };
    });
    // 播放按钮：点播这一首（并把当前库设为播放列表，支持连播）
    body.querySelectorAll('.bm-lib-play').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const t = lib.find(x => x.id === b.dataset.id);
      if (!t) return;
      // 20261105 修复「导入歌单无法播放」：url 为空先补直链再播
      M.state.playlist = lib; M.state.playIndex = lib.indexOf(t);
      if (!t.url) {
        const full = await M.fetchSongDetail(t);
        if (full) { lib[lib.indexOf(t)] = full; M.state.playlist = lib; M.play(full); refreshPlayerUI(); return; }
      }
      M.play(t); refreshPlayerUI();
    });
    body.querySelectorAll('.bm-lib-del').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await M.removeLocalTrack(b.dataset.id);
      renderLibSongs();
    });
  }

  /* 访客收藏：角色（访客）随机收藏的歌曲，存作独立音乐库，可播放；按当前一起听角色隔离 */
  async function renderLibVisitor() {
    const body = document.getElementById('bm-lib-body');
    if (!body) return;
    const c = currentChar();
    // 20261104 数据隔离：只展示当前一起听角色的收藏（charId 隔离），未指定角色时提示先邀请
    const lib = await M.getLocalLibrary('visitor', c ? c.id : null);
    if (!c) {
      body.innerHTML = '<div class="bm-music-empty">请先和某个角色一起听歌，这里会显示 TA 收藏的歌</div>';
      return;
    }
    if (!lib.length) {
      body.innerHTML = `<div class="bm-music-empty">${esc(c.name || 'TA')} 还没有收藏歌曲</div>`;
      return;
    }
    body.innerHTML = `<div class="bm-lib-visitor-hint">${esc(c.name || 'TA')} 收藏的歌（${lib.length} 首）</div>` + lib.map(s => `
      <div class="bm-lib-row" data-id="${esc(s.id)}">
        <span class="bm-lib-cover">${s.pic ? `<img src="${esc(s.pic)}" alt="">` : '♪'}</span>
        <span class="bm-lib-info"><span class="bm-lib-name">${esc(s.name)}</span><span class="bm-lib-artist">${esc(s.artist || '')}</span></span>
        <button class="bm-lib-play" data-id="${esc(s.id)}" title="播放">${window.icon ? window.icon('play', 16) : '▶'}</button>
      </div>`).join('');
    body.querySelectorAll('.bm-lib-row').forEach(el => {
      el.onclick = async () => {
        const t = lib.find(x => x.id === el.dataset.id);
        if (!t) return;
        M.state.playlist = lib; M.state.playIndex = lib.indexOf(t);
        if (!t.url) {
          const full = await M.fetchSongDetail(t);
          if (full) { lib[lib.indexOf(t)] = full; M.state.playlist = lib; M.play(full); refreshPlayerUI(); return; }
        }
        M.play(t); refreshPlayerUI();
      };
    });
    body.querySelectorAll('.bm-lib-play').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const t = lib.find(x => x.id === b.dataset.id);
      if (!t) return;
      // 20261105 修复「导入歌单无法播放」：url 为空先补直链再播
      M.state.playlist = lib; M.state.playIndex = lib.indexOf(t);
      if (!t.url) {
        const full = await M.fetchSongDetail(t);
        if (full) { lib[lib.indexOf(t)] = full; M.state.playlist = lib; M.play(full); refreshPlayerUI(); return; }
      }
      M.play(t); refreshPlayerUI();
    });
  }

  /* Ta的耳机（幽灵听歌记录）：玩家不在时，角色都在听什么歌。按当前一起听角色隔离 */
  async function renderLibEar() {
    const body = document.getElementById('bm-lib-body');
    if (!body) return;
    const c = currentChar();
    const his = await M.getHistory('ear', c ? c.id : null);
    if (!c) {
      body.innerHTML = '<div class="bm-music-empty">请先和某个角色一起听歌，这里会显示 TA 听过的歌</div>';
      return;
    }
    if (!his || !his.length) {
      body.innerHTML = `<div class="bm-music-empty">${esc(c.name || 'TA')} 还没在耳机里听过歌</div>`;
      return;
    }
    // 按时间倒序（最近的在前）
    his.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    body.innerHTML = `<div class="bm-lib-visitor-hint">${esc(c.name || 'TA')} 的耳机记录（${his.length} 首）</div>` + his.map(x => `
      <div class="bm-lib-row" data-id="${esc(x.songId || x.id || '')}">
        <span class="bm-lib-cover">${x.pic ? `<img src="${esc(x.pic)}" alt="">` : '♪'}</span>
        <span class="bm-lib-info"><span class="bm-lib-name">${esc(x.name)}</span><span class="bm-lib-artist">${esc(x.artist || '')}</span></span>
        <span class="bm-ear-time">${_fmtEarTime(x.ts)}</span>
      </div>`).join('');
  }

  // 幽灵听歌记录的时间显示（相对时间）
  function _fmtEarTime(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    const m = Math.floor(d / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const day = Math.floor(h / 24);
    return day + ' 天前';
  }

  /* 歌单列表 */
  async function renderLibPlaylists() {
    const body = document.getElementById('bm-lib-body');
    if (!body) return;
    const pls = await M.getPlaylists();
    // 20261104：访客足迹提醒——角色偷偷查看玩家歌单后留下的痕迹（kind:'peek'），
    // 展示最近的几条（谁在何时偷看 / 存歌 / 听歌），让玩家知道「TA 来过」。
    const peeks = await M.getHistory('peek');
    const peekHtml = _buildPeekFootprints(peeks);
    const listHtml = pls.length ? pls.map(p => `
      <div class="bm-lib-row" data-id="${esc(p.id)}">
        <span class="bm-lib-cover bm-lib-plcover">${p.cover ? `<img src="${esc(p.cover)}" referrerpolicy="no-referrer" alt="">` : '♪'}</span>
        <span class="bm-lib-info"><span class="bm-lib-name">${esc(p.name)}</span><span class="bm-lib-artist">${(p.tracks || []).length} 首</span></span>
        <button class="bm-lib-play" data-id="${esc(p.id)}" title="播放该歌单">${window.icon ? window.icon('play', 16) : '▶'}</button>
        <button class="bm-lib-del" data-id="${esc(p.id)}">✕</button>
      </div>`).join('') : '<div class="bm-music-empty">还没有歌单</div>';
    body.innerHTML = peekHtml + listHtml + `
      <div class="bm-lib-newpl-row">
        <input class="bm-lib-newpl-input" id="bm-lib-newpl-input" placeholder="输入歌单名称…" />
        <button class="bm-lib-newpl-btn" id="bm-lib-newpl-btn">新建歌单</button>
      </div>`;
    // 20261105：历史足迹按钮——点击查看前几天（今天之前）的访客足迹
    const histBtn = body.querySelector('#bm-peek-hist-btn');
    if (histBtn) histBtn.onclick = (e) => { e.stopPropagation(); _openPeekHistory(); };
    body.querySelectorAll('.bm-lib-row').forEach(el => {
      el.onclick = () => showPlaylistDetail(el.dataset.id);
    });
    // 播放该歌单
    body.querySelectorAll('.bm-lib-play').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await playPlaylist(b.dataset.id);
    });
    body.querySelectorAll('.bm-lib-del').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await M.removePlaylist(b.dataset.id);
      renderLibPlaylists();
    });
    // 新建歌单
    body.querySelector('#bm-lib-newpl-btn').onclick = async () => {
      const input = body.querySelector('#bm-lib-newpl-input');
      const name = input.value.trim();
      if (!name) { if (window.miniToast) miniToast('请输入歌单名称'); return; }
      await M.createPlaylist(name);
      input.value = '';
      renderLibPlaylists();
      if (window.miniToast) miniToast('已新建歌单');
    };
  }

  // 判断某时间戳是否属于「今天」（本地时区，跨零点归次日）
  function _isToday(ts) {
    if (!ts) return false;
    const d = new Date(ts);
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }
  // 生成某条 peek 足迹的文字描述
  function _peekLineText(p) {
    const nm = esc(p.charName || 'TA');
    const when = _fmtPeekTime(p.ts);
    if (p.action === 'view') return p.empty ? `${nm} 偷偷翻了你的歌单，发现还空空的` : `${nm} 在 ${when} 偷偷查看了你的歌单`;
    if (p.action === 'save') return `${nm} 偷看了你的歌单，把《${esc(p.songName || '')}》存进了 TA 的歌单`;
    if (p.action === 'listen') return `${nm} 偷偷听了你歌单里的《${esc(p.songName || '')}》`;
    return `${nm} 在 ${when} 偷偷查看了你的歌单`;
  }
  // 生成访客偷看足迹提示区 HTML（20261105：只显示「今天」的足迹，历史足迹点右下角图标查看）
  function _buildPeekFootprints(peeks) {
    if (!Array.isArray(peeks) || !peeks.length) return '';
    // 只保留今天（0 点后）的足迹，按时间倒序，取最近 5 条
    const today = peeks.filter(p => _isToday(p.ts));
    if (!today.length) return '';
    const recent = today.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 5);
    const lines = recent.map(p => `<div class="bm-peek-item"><span class="bm-peek-dot"></span><span class="bm-peek-text">${_peekLineText(p)}</span></div>`).join('');
    // 右上角「历史」小图标：查看前几天（非今天）的足迹记录
    const histBtn = `<button class="bm-peek-hist-btn" id="bm-peek-hist-btn" title="查看历史足迹">${window.icon ? window.icon('clock', 14) : '🕘'}</button>`;
    return `<div class="bm-peek-box"><div class="bm-peek-head">👀 访客足迹${histBtn}</div>${lines}</div>`;
  }
  // 打开历史足迹弹窗：按天分组展示「今天之前」的足迹（今天已在主区展示，历史里也一并列出，方便回看）
  function _openPeekHistory() {
    (async () => {
      const peeks = await M.getHistory('peek');
      if (!Array.isArray(peeks) || !peeks.length) { if (window.miniToast) miniToast('还没有历史足迹'); return; }
      // 按「日期」分组（今天 vs 昨天 vs MM-DD）
      const groups = new Map();
      const labelOf = (ts) => {
        const d = new Date(ts);
        const n = new Date();
        const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        const yest = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
        if (sameDay(d, n)) return '今天';
        if (sameDay(d, yest)) return '昨天';
        return `${d.getMonth() + 1}月${d.getDate()}日`;
      };
      peeks.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach(p => {
        const k = labelOf(p.ts);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      });
      let bodyHtml = '';
      for (const [day, list] of groups) {
        const items = list.map(p => `<div class="bm-peek-item"><span class="bm-peek-dot"></span><span class="bm-peek-text">${_peekLineText(p)}</span></div>`).join('');
        bodyHtml += `<div style="margin-bottom:14px;"><div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:6px;font-weight:600;">${esc(day)}</div>${items}</div>`;
      }
      openModal(`
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="font-size:16px;font-weight:600;">👀 访客足迹 · 历史</div>
          <button class="icon-btn" id="peekhist-close">✕</button>
        </div>
        <div style="max-height:60vh;overflow-y:auto;padding-right:4px;">${bodyHtml}</div>
      `);
      const cb = document.getElementById('peekhist-close');
      if (cb) cb.onclick = () => closeModal();
    })();
  }

  /* 播放歌单：把歌单内全部歌曲设为播放列表，从第一首开始播 */
  async function playPlaylist(plId) {
    const rec = await idbGet('musicHistory', plId);
    if (!rec || !rec.tracks || !rec.tracks.length) {
      if (window.miniToast) miniToast('该歌单还没有歌曲');
      return;
    }
    const lib = await M.getLocalLibrary();
    const tracks = rec.tracks.map(id => lib.find(x => x.id === id)).filter(Boolean);
    if (!tracks.length) { if (window.miniToast) miniToast('歌单内歌曲已失效'); return; }
    M.state.playlist = tracks;
    M.state.playIndex = 0;
    const first = tracks[0];
    if (!first.url) {
      const full = await M.fetchSongDetail(first);
      if (full && full.url) { tracks[0] = full; M.state.playlist[0] = full; }
      else { if (window.miniToast) miniToast('未获取到播放直链，请稍后重试或换关键词'); return; }
    }
    M.play(M.state.playlist[0]);
    resetFloatClosed();
    refreshPlayerUI();
    if (window.miniToast) miniToast(`开始播放歌单：${rec.name}`);
  }

  /* 添加歌曲子浮层：上传本地 + 自动扫描音频（可过滤 30 秒以下） + 提示搜索收藏 */
  function showLibAdd(hostPanel) {
    let sub = document.getElementById('bm-lib-add-panel');
    if (sub) sub.remove();
    sub = document.createElement('div');
    sub.id = 'bm-lib-add-panel';
    sub.className = 'bm-lib-subpanel';
    sub.innerHTML = `
      <div class="bm-lib-submask"></div>
      <div class="bm-lib-subcard">
        <div class="bm-lib-subhead"><span>添加歌曲</span><button class="bm-lib-close" id="bm-lib-add-close">✕</button></div>
        <label class="bm-lib-subbtn" for="bm-lib-file">上传本地音乐文件</label>
        <input type="file" id="bm-lib-file" accept="audio/*" multiple style="display:none;">
        <label class="bm-lib-scanbtn" for="bm-lib-scan-dir">🔍 扫描本机音频</label>
        <input type="file" id="bm-lib-scan-dir" accept="audio/*" multiple webkitdirectory directory style="display:none;">
        <label class="bm-lib-filter">
          <input type="checkbox" id="bm-lib-filter30" checked />
          <span>自动过滤 30 秒以下的音频</span>
        </label>
        <div class="bm-lib-scantip" id="bm-lib-scantip" style="display:none;"></div>
        <div class="bm-lib-parse-row">
          <input class="bm-lib-parse-input" id="bm-lib-parse-input" placeholder="粘贴歌单链接（网易云/QQ音乐…）" />
          <button class="bm-lib-parse-btn" id="bm-lib-parse-btn">解析导入</button>
        </div>
        <div class="bm-lib-scantip" id="bm-lib-parse-tip" style="display:none;"></div>
        <div class="bm-lib-subtip">扫描会读取所选文件夹（含子文件夹）内的全部音频文件并批量导入；粘贴歌单分享链接可解析整张歌单的歌曲列表导入（播放时自动联网取直链）。</div>
      </div>`;
    hostPanel.appendChild(sub);
    sub.querySelector('#bm-lib-add-close').onclick = () => sub.remove();
    sub.querySelector('.bm-lib-submask').onclick = () => sub.remove();

    // 解析歌单链接：提取平台+id → 抓歌单歌曲列表 → 导入音乐库
    const parseBtn = sub.querySelector('#bm-lib-parse-btn');
    const parseInput = sub.querySelector('#bm-lib-parse-input');
    const parseTip = sub.querySelector('#bm-lib-parse-tip');
    parseBtn.onclick = async () => {
      const txt = parseInput.value.trim();
      if (!txt) { if (window.miniToast) miniToast('请先粘贴歌单链接'); return; }
      const info = M.parsePlaylistLink(txt);
      if (!info) { if (window.miniToast) miniToast('无法识别该链接，请确认是网易云/QQ音乐等歌单分享链接'); return; }
      parseTip.style.display = 'block';
      parseTip.textContent = '正在解析歌单…';
      parseBtn.disabled = true;
      try {
        let id = info.id;
        // 短链（163cn.tv/xxx）：先展开跳转拿真实歌单 id
        if (!id && info.shortUrl) {
          parseTip.textContent = '正在展开短链接…';
          const longUrl = await M.expandNeteaseShortLink(info.shortUrl);
          id = M.extractNeteasePlaylistId(longUrl) || '';
          if (!id) { parseTip.textContent = '短链接展开失败，请改用长链接（网易云分享时选「复制链接」）或复制含 music.163.com 的完整链接'; return; }
        }
        const tracks = await M.fetchPlaylist(info.platform, id);
        if (!tracks.length) { parseTip.textContent = '未解析到歌曲，可能是该平台歌单接口暂不可用'; }
        else {
          let imported = 0;
          for (const t of tracks) {
            await M.addLocalTrack({ id: t.id, name: t.name, artist: t.artist, album: t.album, pic: t.pic, url: '', lrc: '', source: 'local', _neteaseId: t._neteaseId });
            imported++;
          }
          parseTip.textContent = `已解析并导入 ${imported} 首歌曲到本地音乐库`;
          renderLibSongs();
          if (window.miniToast) miniToast(`已导入 ${imported} 首歌曲`);
          parseInput.value = '';
        }
      } catch (e) {
        parseTip.textContent = '解析失败：' + (e && e.message ? e.message : e);
      } finally {
        parseBtn.disabled = false;
      }
    };

    const file = sub.querySelector('#bm-lib-file');
    file.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      files.forEach(f => {
        const url = URL.createObjectURL(f);
        const name = (f.name || '').replace(/\.(mp3|flac|wav|m4a|aac|ogg)$/i, '');
        M.addLocalTrack({ name, artist: '本地音乐', url, pic: '', lrc: '', source: 'local' }).then(() => renderLibSongs());
      });
      if (window.miniToast) miniToast(`已导入 ${files.length} 首本地音乐`);
      file.value = '';
      sub.remove();
    };

    // 自动扫描音频：读取所选目录全部音频，可选过滤 30 秒以下
    const scanDir = sub.querySelector('#bm-lib-scan-dir');
    scanDir.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) { scanDir.value = ''; return; }
      const tip = sub.querySelector('#bm-lib-scantip');
      const filter30 = sub.querySelector('#bm-lib-filter30').checked;
      tip.style.display = 'block';
      tip.textContent = `正在扫描 ${files.length} 个文件…`;
      // 逐文件读取时长，过滤掉 <30 秒的音频（用一个临时 Audio 读 duration）
      const kept = [];
      for (const f of files) {
        const dur = await readAudioDuration(f);
        if (filter30 && dur >= 0 && dur < 30) continue;   // 明确短于 30 秒则跳过
        kept.push(f);
      }
      kept.forEach(f => {
        const url = URL.createObjectURL(f);
        const name = (f.name || '').replace(/\.(mp3|flac|wav|m4a|aac|ogg)$/i, '');
        M.addLocalTrack({ name, artist: '本地音乐', url, pic: '', lrc: '', source: 'local' });
      });
      renderLibSongs();
      const skipped = files.length - kept.length;
      if (window.miniToast) miniToast(`已导入 ${kept.length} 首${skipped ? `，过滤掉 ${skipped} 首短音频` : ''}`);
      tip.textContent = '';
      tip.style.display = 'none';
      scanDir.value = '';
      sub.remove();
    };
  }

  /* 读取音频文件时长（秒），失败返回 -1（不参与过滤，保留） */
  function readAudioDuration(file) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const a = new Audio();
        const done = (sec) => { try { URL.revokeObjectURL(url); } catch (e) {} a.src = ''; resolve(sec); };
        a.preload = 'metadata';
        a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : -1);
        a.onerror = () => done(-1);
        a.src = url;
        // 兜底：2 秒没读到 metadata 就放弃（当作 -1 保留）
        setTimeout(() => done(-1), 2000);
      } catch (e) { resolve(-1); }
    });
  }

  /* 加入歌单子浮层：列出所有歌单 + 新建歌单 */
  async function showAddToPlaylist(hostPanel) {
    let sub = document.getElementById('bm-lib-addpl-panel');
    if (sub) sub.remove();
    const pls = await M.getPlaylists();
    const selCount = _libSel.size;
    sub = document.createElement('div');
    sub.id = 'bm-lib-addpl-panel';
    sub.className = 'bm-lib-subpanel';
    sub.innerHTML = `
      <div class="bm-lib-submask"></div>
      <div class="bm-lib-subcard">
        <div class="bm-lib-subhead"><span>加入歌单（已选 ${selCount} 首）</span><button class="bm-lib-close" id="bm-lib-addpl-close">✕</button></div>
        <div class="bm-lib-pllist">
          ${pls.length ? pls.map(p => `<div class="bm-lib-plopt" data-id="${esc(p.id)}">${esc(p.name)}<span>${(p.tracks||[]).length}首</span></div>`).join('') : '<div class="bm-music-empty">暂无歌单</div>'}
        </div>
        <div class="bm-lib-newpl">
          <input class="bm-lib-newpl-input" id="bm-lib-newpl-input" placeholder="新建歌单名称…" />
          <button class="bm-lib-subbtn" id="bm-lib-newpl-btn">新建并加入</button>
        </div>
      </div>`;
    hostPanel.appendChild(sub);
    const close = () => sub.remove();
    sub.querySelector('#bm-lib-addpl-close').onclick = close;
    sub.querySelector('.bm-lib-submask').onclick = close;
    sub.querySelectorAll('.bm-lib-plopt').forEach(el => {
      el.onclick = async () => {
        const plId = el.dataset.id;
        for (const sid of _libSel) { await M.addToPlaylist(plId, sid); }
        _libSel.clear();
        renderLibFoot();
        if (window.miniToast) miniToast('已加入歌单');
        close();
      };
    });
    sub.querySelector('#bm-lib-newpl-btn').onclick = async () => {
      const name = sub.querySelector('#bm-lib-newpl-input').value.trim();
      if (!name) { if (window.miniToast) miniToast('请输入歌单名称'); return; }
      const rec = await M.createPlaylist(name);
      for (const sid of _libSel) { await M.addToPlaylist(rec.id, sid); }
      _libSel.clear();
      renderLibFoot();
      if (window.miniToast) miniToast('已新建歌单并加入');
      close();
    };
  }

  /* 歌单详情：展示歌单内歌曲，可播放 / 移除 */
  async function showPlaylistDetail(plId) {
    let sub = document.getElementById('bm-lib-pldetail-panel');
    if (sub) sub.remove();
    const rec = await idbGet('musicHistory', plId);
    if (!rec) return;
    const lib = await M.getLocalLibrary();
    const tracks = (rec.tracks || []).map(id => lib.find(x => x.id === id)).filter(Boolean);
    const panel = document.getElementById('bm-music-lib-panel');
    const host = panel || document.body;
    sub = document.createElement('div');
    sub.id = 'bm-lib-pldetail-panel';
    sub.className = 'bm-lib-subpanel';
    sub.innerHTML = `
      <div class="bm-lib-submask"></div>
      <div class="bm-lib-subcard">
        <div class="bm-lib-subhead"><span>${esc(rec.name)}（${tracks.length} 首）</span><button class="bm-lib-close" id="bm-lib-pldetail-close">✕</button></div>
        <button class="bm-lib-subbtn" id="bm-lib-pldetail-playall">▶ 播放全部（${tracks.length} 首）</button>
        <div class="bm-lib-pldetail-body">
          ${tracks.length ? tracks.map((s, i) => `
            <div class="bm-lib-row" data-id="${esc(s.id)}" data-i="${i}">
              <span class="bm-lib-plidx">${i + 1}</span>
              <span class="bm-lib-cover">${s.pic ? `<img src="${esc(s.pic)}" alt="">` : '♪'}</span>
              <span class="bm-lib-info"><span class="bm-lib-name">${esc(s.name)}</span><span class="bm-lib-artist">${esc(s.artist || '')}</span></span>
              <button class="bm-lib-del" data-id="${esc(s.id)}">✕</button>
            </div>`).join('') : '<div class="bm-music-empty">歌单为空</div>'}
        </div>
      </div>`;
    host.appendChild(sub);
    sub.querySelector('#bm-lib-pldetail-close').onclick = () => sub.remove();
    sub.querySelector('.bm-lib-submask').onclick = () => sub.remove();
    // 播放全部
    sub.querySelector('#bm-lib-pldetail-playall').onclick = async () => {
      await playPlaylist(plId);
      sub.remove();
    };
    sub.querySelectorAll('.bm-lib-row').forEach(el => {
      el.onclick = async () => {
        const t = tracks.find(x => x.id === el.dataset.id);
        if (!t) return;
        // 20261105 修复「导入歌单无法播放」：url 为空先补直链再播
        M.state.playlist = tracks; M.state.playIndex = tracks.indexOf(t);
        if (!t.url) {
          const full = await M.fetchSongDetail(t);
          if (full) { tracks[tracks.indexOf(t)] = full; M.state.playlist = tracks; M.play(full); refreshPlayerUI(); return; }
        }
        M.play(t); refreshPlayerUI();
      };
    });
    sub.querySelectorAll('.bm-lib-del').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await M.removeFromPlaylist(plId, [b.dataset.id]);
      showPlaylistDetail(plId);
    });
  }

  /* ============================================================
     主题选择弹窗（顶栏主题按钮 → 6 主题平铺点选）
     ============================================================ */
  function showThemePicker() {
    let picker = document.getElementById('bm-theme-picker');
    if (picker) { picker.remove(); return; }
    const page = document.getElementById('bm-music-page');
    const host = page || document.body;
    const themes = [
      { id: 'star', name: '星轨', icon: '✦' },
      { id: 'vinyl', name: '黑胶', icon: '◉' },
      { id: 'paper', name: '手稿', icon: '☾' },
      { id: 'pixel', name: '像素', icon: '▚' },
      { id: 'y2k', name: '怀旧', icon: '⊞' },
      { id: 'collage', name: '拼贴', icon: '✄' },
      { id: 'bw', name: '黑白', icon: '◐' },
    ];
    const cur = page ? (page.dataset.theme || 'star') : 'star';
    picker = document.createElement('div');
    picker.id = 'bm-theme-picker';
    picker.className = 'bm-theme-picker';
    picker.innerHTML = `
      <div class="bm-theme-mask" id="bm-theme-mask"></div>
      <div class="bm-theme-card">
        <div class="bm-theme-head"><span>外观</span><button class="bm-theme-close" id="bm-theme-close">✕</button></div>
        <div class="bm-theme-subhead">主题</div>
        <div class="bm-theme-grid">
          ${themes.map(t => `<button class="bm-theme-opt ${t.id === cur ? 'on' : ''}" data-theme="${t.id}"><span class="bm-theme-ico">${t.icon}</span><span>${t.name}</span></button>`).join('')}
        </div>
        <div class="bm-theme-subhead">背景</div>
        <div class="bm-bg-picker-row">
          <button class="bm-bg-picker-btn" id="bgpick-preset">跟随全局预设</button>
          <label class="bm-bg-picker-btn bm-bg-picker-primary" for="bgpick-file">上传图片</label>
          <input type="file" id="bgpick-file" accept="image/*" style="display:none;">
        </div>
      </div>`;
    host.appendChild(picker);
    const close = () => picker.remove();
    picker.querySelector('#bm-theme-mask').onclick = close;
    picker.querySelector('#bm-theme-close').onclick = close;
    picker.querySelectorAll('.bm-theme-opt').forEach(b => {
      b.onclick = async () => {
        const theme = b.dataset.theme;
        if (page) page.dataset.theme = theme;
        await setSetting('musicTheme', theme);
        updateThemeToggleIcon(theme);
        renderFloat();
        close();
      };
    });
    // 背景：跟随全局预设 / 上传图片（合并进外观弹窗）
    picker.querySelector('#bgpick-preset').onclick = () => {
      setSetting('musicBg', null); applyMusicBg(); close();
      if (window.miniToast) miniToast('已恢复全局颜色预设');
    };
    picker.querySelector('#bgpick-file').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { setSetting('musicBg', rd.result); applyMusicBg(); close(); };
      rd.readAsDataURL(f);
    };
  }

  /* ---------- 音源路径选择（镜像搜索模式，玩家可选） ---------- */
  function showSourcePicker() {
    let picker = document.getElementById('bm-source-picker');
    if (picker) { picker.remove(); return; }
    const page = document.getElementById('bm-music-page');
    const host = page || document.body;
    const builtin = [
      { key: 'auto', name: '自动（推荐）', desc: '多源自动容灾切换' },
      { key: 'gdstudio', name: '网易云镜像（新）', desc: '直链稳定，直接返回真实 mp3' },
      { key: 'qijieya', name: '网易云镜像（旧）', desc: '搜索+播放+歌词一步到位' },
      { key: 'qingyu', name: '网易云镜像（清羽）', desc: '标准 Meting 格式，新稳定源' },
      { key: 'kuwo', name: '酷我音乐', desc: '酷我曲库，多档音质' },
      { key: 'tang', name: 'QQ 音乐', desc: '开放接口' },
      { key: 'itunes', name: 'iTunes（国际）', desc: '英文/欧美曲库，30 秒试听' },
    ];
    const custom = M.getCustomSources();
    picker = document.createElement('div');
    picker.id = 'bm-source-picker';
    picker.className = 'bm-source-picker';
    picker.innerHTML = `
      <div class="bm-theme-mask" id="bm-source-mask"></div>
      <div class="bm-theme-card bm-source-card">
        <div class="bm-theme-head"><span>选择音源来源</span><button class="bm-theme-close" id="bm-source-close">✕</button></div>
        <div class="bm-source-list" id="bm-source-list">
          <div class="bm-source-group">内置来源</div>
          ${builtin.map(o => `<button class="bm-source-opt" data-key="${o.key}"><span class="bm-source-name">${o.name}</span><span class="bm-source-desc">${o.desc}</span></button>`).join('')}
          ${custom.length ? `<div class="bm-source-group">自定义来源</div>` : ''}
          ${custom.map(c => `<div class="bm-source-opt bm-source-custom" data-key="${esc(c.id)}"><span class="bm-source-name">${esc(c.name)}</span><span class="bm-source-desc">${esc(c.baseUrl)}</span><button class="bm-source-del" data-id="${esc(c.id)}">✕</button></div>`).join('')}
        </div>
        <div class="bm-source-add">
          <div class="bm-source-addhead">添加自定义音源（粘贴 Meting 兼容 API 地址，关键词用 {kw} 占位）</div>
          <input class="bm-source-input" id="bm-source-name" placeholder="名称（如：我的镜像）" />
          <input class="bm-source-input" id="bm-source-url" placeholder="搜索地址，如 https://api.xxx.cn/meting/?type=search&id={kw}" />
          <button class="bm-source-addbtn" id="bm-source-addbtn">添加</button>
        </div>
      </div>`;
    host.appendChild(picker);
    const close = () => picker.remove();
    picker.querySelector('#bm-source-mask').onclick = close;
    picker.querySelector('#bm-source-close').onclick = close;
    // 标记当前选中的项
    getSetting('musicSource', 'auto').then(cur => {
      const curBtn = picker.querySelector(`.bm-source-opt[data-key="${cur}"]`);
      if (curBtn) curBtn.classList.add('on');
    });
    // 选择内置源
    picker.querySelectorAll('.bm-source-opt[data-key]').forEach(b => {
      b.onclick = async (e) => {
        if (e.target.classList && e.target.classList.contains('bm-source-del')) return;
        const key = b.dataset.key;
        await setSetting('musicSource', key);
        const nm = b.querySelector('.bm-source-name');
        if (window.miniToast) miniToast(`已切换音源：${nm ? nm.textContent : key}`);
        close();
        // 20261104：切换音源后，若搜索框里还留着上次的关键词，自动用新音源重新搜索刷新结果
        const input = document.getElementById('bm-music-input');
        const kw = input ? input.value.trim() : '';
        if (kw) {
          try {
            const list = await M.search(kw);
            renderResults(list);
            if (window.miniToast) miniToast(`已用「${kw}」重新搜索`);
          } catch (e2) {}
        }
      };
    });
    // 删除自定义源
    picker.querySelectorAll('.bm-source-del').forEach(d => {
      d.onclick = async (e) => {
        e.stopPropagation();
        M.removeCustomSource(d.dataset.id);
        showSourcePicker();
      };
    });
    // 添加自定义源
    picker.querySelector('#bm-source-addbtn').onclick = () => {
      const name = picker.querySelector('#bm-source-name').value.trim();
      const url = picker.querySelector('#bm-source-url').value.trim();
      if (!name || !url) { if (window.miniToast) miniToast('请填写名称和地址'); return; }
      if (!url.includes('{kw}')) { if (window.miniToast) miniToast('地址需包含 {kw} 关键词占位符'); return; }
      M.addCustomSource(name, url);
      showSourcePicker();
      if (window.miniToast) miniToast(`已添加自定义音源：${name}`);
    };
  }

  async function applyMusicBg() {
    const bg = await getSetting('musicBg', null);
    const page = document.getElementById('bm-music-page');
    if (!page) return;
    let layer = document.getElementById('bm-music-bgimg');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'bm-music-bgimg';
      layer.className = 'bm-music-bgimg';
      page.insertBefore(layer, page.firstChild);
    }
    if (bg) {
      layer.style.background = `url("${bg}") center/cover`;
      layer.style.opacity = '1';
      page.classList.add('bm-has-bg');
    } else {
      layer.style.background = '';
      layer.style.opacity = '0';
      page.classList.remove('bm-has-bg');
    }
  }

  function closeMusicPage() {
    const page = document.getElementById('bm-music-page');
    if (page) page.remove();
    stopPlanetAnimation();
  }

  /* 20261105 修复「音乐页内开弹窗后，手势回退/返回按钮直接退出整个音乐页」：
     栈式返回——音乐页内若有打开的子浮层（音乐库/导入歌单/解析歌单/主题/播放列表/评论/
     邀请/分享/音量/迷你列表等），先关闭最上面那层，回到音乐页本身；
     只有没有任何子层时才真正退出音乐页。返回 true=已关闭子层，false=无子层可关。

     20261105 二次修复：原实现只检测了 3 种浮层（bm-volume-pop/bm-float-minilist/.bm-lib-subpanel），
     漏掉了音乐页里真正会打开的评论面板、播放列表面板、音乐库面板、邀请/分享弹窗等一大票浮层，
     导致「按返回键直接退出整个音乐页」而非「先关弹窗」。现改为统一按 id 清单检测所有音乐浮层，
     按 z-index 从高到低关闭最上面那层（各浮层 id 已与 showXxx 函数一一核对）。 */
  function _closeTopMusicLayer() {
    // 所有音乐相关的浮层容器 id，按「层级从高到低」排列（越靠前 z-index 越高，先关）
    const LAYERS = [
      'bm-comment-panel',      // 评论面板（z=2147483005，最高）
      'bm-invite-card',        // 一起听歌邀请（角色发起 / 玩家发出）
      'bm-share-picker',       // 分享给谁 / 邀请谁（选角色）
      'bm-playlist-panel',     // 播放列表面板
      'bm-volume-pop',         // 音量浮层
      'bm-float-minilist',     // 迷你播放列表（悬浮窗上方）
      'bm-music-lib-panel',    // 音乐库面板（歌曲/歌单/访客收藏/Ta的耳机）
      'bm-lib-pldetail-panel', // 歌单详情
      'bm-lib-addpl-panel',    // 新建歌单
      'bm-lib-add-panel',      // 添加歌曲
      'bm-neimport-panel',     // 导入网易云歌单
      'bm-parse-playlist-pop', // 解析歌单
    ];
    for (let i = 0; i < LAYERS.length; i++) {
      const el = document.getElementById(LAYERS[i]);
      if (el) { el.remove(); return true; }
    }
    // 兜底：音乐页内残留的 .bm-lib-subpanel / 主题遮罩等子浮层（DOM 最后一个=最上面）
    const page = document.getElementById('bm-music-page');
    if (page) {
      const subs = page.querySelectorAll('.bm-lib-subpanel, .bm-theme-mask, .bm-bg-picker-mask');
      if (subs && subs.length) {
        const top = subs[subs.length - 1];
        // 主题遮罩/背景选择遮罩可能是子元素的 mask，直接移除其父浮层容器
        const host = top.closest('.bm-lib-subpanel, .bm-theme-panel, .bm-bg-picker') || top;
        host.remove();
        return true;
      }
    }
    return false;
  }
  /* 统一的「音乐页返回」入口：先关子层，关完了才退音乐页 */
  function backMusicPage() {
    if (_closeTopMusicLayer()) return;
    closeMusicPage();
  }

  /* ---------- 三主题（星轨 / 手稿 / 像素） ---------- */
  async function applyMusicTheme() {
    const page = document.getElementById('bm-music-page');
    if (!page) return;
    let theme = 'star';
    const valid = ['star', 'vinyl', 'paper', 'pixel', 'y2k', 'collage', 'bw'];
    try { theme = await getSetting('musicTheme', 'star'); } catch (e) { theme = 'star'; }
    if (valid.indexOf(theme) < 0) theme = 'star';
    page.dataset.theme = theme;
    updateThemeToggleIcon(theme);
    renderFloat();
  }
  function updateThemeToggleIcon(theme) {
    // 已合并为「外观」按钮，主题图标切换逻辑移除（保留空函数避免调用报错）
  }

  /* ---------- 律动动画：魔法阵星图慢转 + 能量环（水波纹）跟音乐节奏 ---------- */
  let _planetRaf = null;
  let _bassSmooth = 0, _lastBassT = 0;
  function startPlanetAnimation() {
    stopPlanetAnimation();
    const tick = () => {
      const planet = document.getElementById('bm-planet');
      const rings = document.querySelectorAll('.bm-planet-ring');
      const magic = document.getElementById('bm-magic-circle');
      const wave = document.getElementById('bm-wave-ring');
      const playing = M.state.playing;
      if (planet) planet.classList.toggle('playing', playing);
      const now = Date.now();
      // 星轨环：慢速持续旋转（r1/r3 反向），播放时加速
      rings.forEach((r, i) => {
        const dir = (i % 2 === 0) ? 1 : -1;
        const speed = playing ? 1 : 0.35;
        const rot = (now / (2600 + i * 900)) * dir * speed;
        r.style.transform = `rotate(${rot}deg)`;
      });
      // 魔法阵星图：整组缓慢旋转
      if (magic) {
        const speed = playing ? 1 : 0.4;
        const th = now / 6000 * speed;
        magic.style.transform = `rotate(${th}deg)`;
      }
      // 水波纹：能量环从中心持续外扩 + 消散（跟音乐节奏）。
      // 20261105 回滚：之前把频谱禁用后的律动改成了「时间驱动正弦包络」（恒定 0.55 底噪 + 大振幅脉冲），
      //   导致所有主题的波纹又大又剧烈，偏离了「之前刚刚好」的温和感。这里恢复原始版本：
      //   _bassSmooth 只由 getBassLevel() 驱动（频谱禁用时恒 0），波纹是恒定温和的外扩 + 消散，
      //   不再叠加人为的鼓点脉冲。
      if (wave && playing) {
        const lvl = (typeof M.getBassLevel === 'function') ? M.getBassLevel() : 0;
        // 平滑 + 峰值衰减，模拟"鼓点一响波纹一冲"的节奏感（真实频谱就绪时生效）
        _bassSmooth = Math.max(lvl, _bassSmooth * 0.90);
        const spans = wave.querySelectorAll('span');
        spans.forEach((s, i) => {
          const phase = (now / 900 + i * 0.33) % 1;          // 持续外扩相位
          const scale = 0.5 + phase * (0.9 + _bassSmooth * 0.9);
          const op = Math.max(0, (1 - phase)) * (0.35 + _bassSmooth * 0.65);
          s.style.transform = `scale(${scale})`;
          s.style.opacity = op.toFixed(2);
          s.style.borderWidth = `${1.5 + _bassSmooth * 2}px`;
        });
      } else if (wave) {
        // 未播放：波纹静止收敛
        wave.querySelectorAll('span').forEach(s => { s.style.opacity = '0'; });
      }
      // 20261104：进度条实时刷新（时间 + 进度滑块），复用 rAF 循环，不额外开定时器
      if (typeof window.__bmUpdateProgress === 'function') { try { window.__bmUpdateProgress(); } catch (e) {} }
      _planetRaf = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopPlanetAnimation() { if (_planetRaf) cancelAnimationFrame(_planetRaf); _planetRaf = null; }

  /* ---------- 刷新播放器 UI（页面 + 悬浮窗） ---------- */
  function refreshPlayerUI() {
    const cur = M.state.current;
    const title2 = document.getElementById('bm-music-title2');
    const artist = document.getElementById('bm-music-artist');
    const pp = document.getElementById('bm-music-pp');
    if (title2) title2.textContent = cur ? cur.name : '未在播放';
    if (artist) artist.textContent = cur ? cur.artist : '—';
    // 20261104：一起听状态条——已一起听时显示「正在和 XX 一起听 + 结束按钮」，未一起听隐藏
    const togBar = document.getElementById('bm-music-together');
    if (togBar) {
      const c = getCharById(M.state.charId);
      const together = !!(M.state.charId && M.state.togetherSince);
      if (together && c) {
        const avt = togBar.querySelector('#bm-together-avt');
        const txt = togBar.querySelector('#bm-together-text');
        if (avt) avt.innerHTML = avatarImgHTML(c.avatar, (c.name || '?')[0]).html;
        if (txt) txt.textContent = `正在和 ${c.name || 'TA'} 一起听歌`;
        togBar.style.display = '';
      } else {
        togBar.style.display = 'none';
      }
    }
    // 封面球刷新（直接赋原始 URL，不做 HTML 转义，否则 & 等字符会破坏图片地址）
    const core = document.getElementById('bm-planet-core');
    if (core) {
      if (cur && cur.pic) {
        // 20261105：http 封面强制转 https（WebView 里 http 图片可能被拦截/加载慢），
        //   否则一起听歌顶部封面球显示空白。backgroundImage 无法设 referrerpolicy，
        //   但 https + 网易云直链基本能正常加载。
        const picUrl = String(cur.pic).replace(/^http:\/\//i, 'https://');
        core.style.backgroundImage = `url("${picUrl.replace(/"/g, '\\"')}")`;
        core.innerHTML = '';
        core.classList.add('has-pic');   // 有封面：减轻深色遮罩，让封面清晰显示
      } else {
        core.style.backgroundImage = '';
        core.innerHTML = `<div class="bm-planet-ph">${window.icon ? window.icon('music', 40) : '♪'}</div>`;
        core.classList.remove('has-pic');
      }
    }
    // 20261106：图标改用统一真实态 _livePlayback().playing（遥控模式读外部真实态，不再用内置瞎猜）
    if (pp) { const lp = _livePlayback(); pp.innerHTML = window.icon ? window.icon(lp.playing ? 'pause' : 'play', 26) : (lp.playing ? '⏸' : '▶'); }
    // 随机/循环按钮状态
    updateCtrlState();
    // 歌词
    const lyricBox = document.getElementById('bm-music-lyric');
    if (lyricBox) {
      const lines = parseLrc(M.state.lyrics || (cur && cur.lrc) || '');
      if (!lines.length) { lyricBox.innerHTML = '<div class="bm-music-empty">暂无歌词</div>'; }
      else { lyricBox.innerHTML = lines.map(l => `<div class="bm-lrc-line${l.tr ? ' bm-lrc-tr' : ''}" data-t="${l.t}">${esc(l.text)}</div>`).join(''); startLyricScroll(); }
    }
    // 悬浮窗同步
    renderFloat();
    // 20261106：后台遥控模式下，异步用外部 App 真实歌信息覆盖播放器圆盘/标题
    _refreshExternalIntoPlayerUI();
    // 20261106：遥控模式额外刷一次统一真实态缓存（驱动图标/歌名/封面）
    if (_isRemoteNow()) _refreshLiveExternal(false);
  }

  /* 20261106 修复「后台遥控时播放器圆盘封面/标题不替换」：
     后台遥控模式（mode==='remote' 且未开直连）下，真正在播的是外部 App 的歌，
     M.state.current 是内部残留旧歌，导致播放器圆盘封面/标题/歌词显示错误。
     这里用原生 getMediaState() 读外部真实 title/artist/cover，覆盖到播放器圆盘与标题。
     歌词：外部 MediaSession 拿不到逐句歌词，圆盘歌词区显示「后台播放中」占位。 */
  async function _refreshExternalIntoPlayerUI() {
    if (!((M.state.mode === 'remote') && !_netEaseDirect)) return;
    try {
      const br = _remoteBridge();
      if (!br || typeof br.getMediaState !== 'function') return;
      const st = await br.getMediaState();
      if (!st || !st.hasSession) return;
      const title2 = document.getElementById('bm-music-title2');
      const artist = document.getElementById('bm-music-artist');
      const etitle = (st.title || '').trim();
      const eartist = (st.artist || '').trim();
      if (title2) title2.textContent = etitle || '未知歌曲';
      if (artist) artist.textContent = eartist || '未知歌手';
      const core = document.getElementById('bm-planet-core');
      if (core && st.cover && typeof st.cover === 'string' && st.cover) {
        core.style.backgroundImage = `url("${String(st.cover).replace(/"/g, '\\"')}")`;
        core.innerHTML = '';
        core.classList.add('has-pic');
      }
      // 20261107 修复「后台遥控拿不到歌词」：MediaSession 不提供歌词，只能拿外部
      //   title+artist 去网易云搜索匹配（搜「歌名 歌手」），命中后按 id 补拉真实 LRC，
      //   再写入 M.state.lyrics 并刷新歌词区。这样遥控模式下封面、歌词都能拿到。
      if (etitle && !_extLyricFetchedFor) {
        _extLyricFetchedFor = etitle + '|' + eartist;
        try {
          if (typeof _netEaseSearch === 'function' && M && typeof M._netEaseLyric === 'function') {
            const kw = (eartist && eartist !== '未知歌手') ? (etitle + ' ' + eartist) : etitle;
            const list = await _netEaseSearch(kw);
            if (list && list.length) {
              const hit = list[0];
              const lrc = await M._netEaseLyric(hit.id);
              if (lrc) {
                M.state.lyrics = lrc;
                const lyricBox = document.getElementById('bm-music-lyric');
                if (lyricBox) {
                  const lines = parseLrc(lrc);
                  if (lines.length) {
                    lyricBox.innerHTML = lines.map(l => `<div class="bm-lrc-line${l.tr ? ' bm-lrc-tr' : ''}" data-t="${l.t}">${esc(l.text)}</div>`).join('');
                    startLyricScroll();
                  }
                }
              }
            }
          }
        } catch (e2) {}
      }
    } catch (e) {}
  }

  /* ============================================================
     20261106 统一「真实播放态」读取（根治图标/进度/歌名/封面五处不一致）
     核心矛盾：遥控模式（mode==='remote' && !_netEaseDirect）下，真正在播的是外部 App（网易云）
     的歌，M.state.current 是内部残留旧歌、M.state.playing 是瞎猜值、audio.currentTime≈0。
     此前五处界面（听歌页图标/软件内悬浮窗/软件外原生悬浮窗/播放列表/角色动作池）各读各的
     M.state.*，导致图标不换、进度来回串、歌名封面不更新。
     这里抽一个统一缓存：_liveExternal 保存最近一次 getMediaState() 的返回（外部真实
     title/artist/cover/playing），_livePlayback() 同步返回「当前真实播放态」——
     遥控模式优先用外部真实态覆盖，其余模式用内置态。所有界面都从这里读，不再瞎猜。 */
  let _liveExternal = null;           // 最近一次 getMediaState() 返回（外部真实态缓存）
  let _liveExternalAt = 0;            // 缓存时间戳（防过期）
  let _liveExternalTimer = null;      // 遥控模式下周期刷新缓存的心跳
  let _extLyricFetchedFor = '';       // 20261107：已拉歌词的「歌名|歌手」，换歌才重拉，避免重复请求
  // 是否处于「真遥控外部 App」状态
  function _isRemoteNow() {
    return (M.state.mode === 'remote') && !_netEaseDirect;
  }
  // 同步读取「当前真实播放态」——遥控模式用外部真实态覆盖，其余模式用内置态。
  // 返回 { name, artist, cover, playing, position, duration, isExternal }
  function _livePlayback() {
    const cur = M.state.current;
    if (_isRemoteNow() && _liveExternal && _liveExternal.hasSession) {
      const e = _liveExternal;
      return {
        name: (e.title || '').trim() || (cur && cur.name) || '未知歌曲',
        artist: (e.artist || '').trim() || (cur && cur.artist) || '未知歌手',
        cover: (e.cover && typeof e.cover === 'string' && e.cover) ? e.cover : (cur && cur.pic) || '',
        playing: !!e.playing,
        position: (typeof e.position === 'number' && e.position >= 0) ? e.position : (M.state.audio ? Math.floor(M.state.audio.currentTime || 0) : 0),
        duration: (typeof e.duration === 'number' && e.duration > 0) ? e.duration : (M.state.audio && M.state.audio.duration ? Math.floor(M.state.audio.duration) : 0),
        isExternal: true,
      };
    }
    const a = M.state.audio;
    return {
      name: (cur && cur.name) || '',
      artist: (cur && cur.artist) || '',
      cover: (cur && cur.pic) || '',
      playing: !!M.state.playing,
      position: a ? Math.floor(a.currentTime || 0) : 0,
      duration: (a && a.duration) ? Math.floor(a.duration) : 0,
      isExternal: false,
    };
  }
  // 异步刷新外部真实态缓存（遥控模式才调），成功后顺手刷新相关界面。
  async function _refreshLiveExternal(forceRefreshUI) {
    if (!_isRemoteNow()) { _liveExternal = null; _liveExternalAt = 0; return; }
    try {
      const br = _remoteBridge();
      if (!br || typeof br.getMediaState !== 'function') return;
      const st = await br.getMediaState();
      if (st && st.hasSession) {
        _liveExternal = st;
        _liveExternalAt = Date.now();
        // 外部真实态变化后，同步刷新：听歌页标题/封面/图标 + 软件内悬浮窗 + 原生悬浮窗
        if (forceRefreshUI !== false) {
          _applyLiveToPlayerUI();
          _applyLiveToFloatUI();
        }
      }
    } catch (e) {}
  }
  // 把真实态应用到「听歌页」的标题/封面/播放图标
  function _applyLiveToPlayerUI() {
    const lp = _livePlayback();
    const title2 = document.getElementById('bm-music-title2');
    const artist = document.getElementById('bm-music-artist');
    const pp = document.getElementById('bm-music-pp');
    if (title2 && lp.isExternal) title2.textContent = lp.name;
    if (artist && lp.isExternal) artist.textContent = lp.artist;
    if (pp) pp.innerHTML = window.icon ? window.icon(lp.playing ? 'pause' : 'play', 26) : (lp.playing ? '⏸' : '▶');
    const core = document.getElementById('bm-planet-core');
    if (core && lp.isExternal && lp.cover) {
      const picUrl = String(lp.cover).replace(/^http:\/\//i, 'https://');
      core.style.backgroundImage = `url("${picUrl.replace(/"/g, '\\"')}")`;
      core.innerHTML = '';
      core.classList.add('has-pic');
    }
  }
  // 把真实态应用到「软件内悬浮窗」的歌名/歌手/封面/播放图标（第 6 项任务的核心）
  function _applyLiveToFloatUI() {
    const fw = document.getElementById('bm-music-float');
    if (!fw) return;
    const lp = _livePlayback();
    if (!lp.isExternal) return;   // 内置模式悬浮窗由 renderFloat 正常渲染，不覆盖
    const t = fw.querySelector('.bm-mini-title');
    const a = fw.querySelector('.bm-mini-artist');
    const ft = fw.querySelector('.bm-float-title');
    const fa = fw.querySelector('.bm-float-artist');
    if (t) t.textContent = lp.name;
    if (a) a.textContent = lp.artist;
    if (ft) ft.textContent = lp.name;
    if (fa) fa.textContent = lp.artist;
    const pp = fw.querySelector('#bm-float-pp');
    if (pp) pp.innerHTML = window.icon ? window.icon(lp.playing ? 'pause' : 'play', 22) : (lp.playing ? '⏸' : '▶');
    const miniPp = fw.querySelector('#bm-mini-pp');
    if (miniPp) miniPp.innerHTML = window.icon ? window.icon(lp.playing ? 'pause' : 'play', 18) : (lp.playing ? '⏸' : '▶');
    const cover = fw.querySelector('.bm-float-cover');
    if (cover && lp.cover) {
      const picUrl = String(lp.cover).replace(/^http:\/\//i, 'https://');
      const img = cover.querySelector('img');
      if (img) { try { img.src = picUrl; } catch (e) {} }
    }
  }
  // 启动/停止「真实态」周期刷新心跳（遥控模式才启，500ms 一次，与原生悬浮窗心跳对齐）
  function _startLiveExternalHeartbeat() {
    _stopLiveExternalHeartbeat();
    _liveExternalTimer = setInterval(() => { _refreshLiveExternal(true); }, 500);
  }
  function _stopLiveExternalHeartbeat() {
    if (_liveExternalTimer) { clearInterval(_liveExternalTimer); _liveExternalTimer = null; }
  }

  let _lyricRaf = null;
  let _lyricLastActive = -1;   // 上一次高亮句，只在「唱到新句」时才跳转滚动，玩家可自由上下滚动
  function startLyricScroll() {
    if (_lyricRaf) cancelAnimationFrame(_lyricRaf);
    const a = M.state.audio;
    const tick = () => {
      if (a) {
        const t = a.currentTime || 0;
        const box = document.getElementById('bm-music-lyric');
        if (box) {
          const lines = box.querySelectorAll('.bm-lrc-line');
          let active = -1;
          lines.forEach((l, i) => { if (parseFloat(l.dataset.t) <= t) active = i; });
          // 20261107 双语歌词：同一时间戳的「原文 + 翻译」两行要同时高亮，
          //   不能只亮最后一行（否则原文暗、只有翻译亮）。改为「时间戳等于当前句的所有行都亮」。
          let activeT = active >= 0 ? parseFloat(lines[active].dataset.t) : -1;
          lines.forEach((l, i) => {
            const on = i === active || (activeT >= 0 && parseFloat(l.dataset.t) === activeT);
            l.classList.toggle('on', on);
          });
          // 只在「唱到新一句」时跳转滚动（active 变化才滚），唱同一句期间玩家可自由上下滚动不被弹回。
          if (active >= 0 && active !== _lyricLastActive) {
            _lyricLastActive = active;
            const target = lines[active];
            const lineH = target.offsetHeight || 26;
            const center = box.clientHeight / 2 - lineH / 2;
            box.scrollTop = Math.max(0, target.offsetTop - center);
          }
        }
      }
      _lyricRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ============================================================
     一起听歌悬浮窗（三级：dot → mini → card，只能收起不能关闭；
     仅在「聊天设置关悬浮窗」或「听音乐界面关悬浮窗」时才真正移除）
     ============================================================ */
  let _floatClosedByUser = false;   // 用户主动关闭后，不再自动弹出（换歌重新播放才恢复）
  let _floatDragging = false;       // 拖拽中标记（hover 展开/缩回在拖拽中禁止）
  let _floatLyricTimer = null;      // 悬浮窗歌词滚动定时器（防重复堆积导致卡死）
  let _floatSeeking = false;        // 20261104：悬浮窗进度条拖动中标记（拖动时暂停进度条自动刷新，避免回跳）
  let _nativeHeartbeatTimer = null; // 20261106：overlay 原生悬浮窗进度/歌词心跳同步定时器

  // 20261105 修复「悬浮窗进度条总时长永远 00:00」根因：
  //   __bmUpdateProgress 此前定义在 showMusicPage() 内部 if(progSlider) 块里，
  //   用户从未打开音乐页面时该函数根本不存在，startPlanetAnimation 的 rAF 循环调它空操作，
  //   导致悬浮窗（card 形态）的当前时间 / 总时长 / 进度滑块永远停在初始 00:00。
  //   现将 fmtTime 与 __bmUpdateProgress 提到模块级，任何时候（含只挂悬浮窗未进音乐页）都可用。
  const _fmtTime = (sec) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  };
  // 20261105 修复「挂后台再回来时长变 00:00」：Android WebView 挂后台时可能暂停/挂起 audio，
  //   a.duration 会暂时丢失（NaN/0），导致时长与进度滑块全归零。这里缓存最后一次有效的 duration
  //   （见 _cachedDuration，模块级变量，play/rebuildCleanAudio 里同步更新），
  //   audio 的 duration 失效时用缓存兜底，时长和进度条不再闪断归零。
  window.__bmUpdateProgress = () => {
    const a = M.state.audio;
    const cur = document.getElementById('bm-prog-cur');
    const dur = document.getElementById('bm-prog-dur');
    const slider = document.getElementById('bm-progress-slider');
    const fcur = document.getElementById('bm-float-prog-cur');
    const fdur = document.getElementById('bm-float-prog-dur');
    const fslider = document.getElementById('bm-float-progress-slider');
    if (!a) return;
    // duration 优先取实时值，失效时用缓存兜底（并持续刷新缓存）
    let d = a.duration;
    if (isFinite(d) && d > 0) { _cachedDuration = d; }
    else { d = _cachedDuration; }
    if (dur && isFinite(d) && d > 0) dur.textContent = _fmtTime(d);
    if (cur) cur.textContent = _fmtTime(a.currentTime || 0);
    if (fdur && isFinite(d) && d > 0) fdur.textContent = _fmtTime(d);
    if (fcur) fcur.textContent = _fmtTime(a.currentTime || 0);
    if (d && isFinite(d) && d > 0) {
      const pct = Math.min(1000, Math.max(0, Math.round((a.currentTime / d) * 1000)));
      if (slider) slider.value = pct;
      if (fslider && !_floatSeeking) fslider.value = pct;
    }
  };

  /* ============================================================
     20261105：悬浮方式（软件内 / 其他应用原生悬浮）桥接层
     floatScope = 'inApp'（默认，DOM 悬浮）| 'overlay'（原生系统层悬浮）
     ============================================================ */
  let _nativeFloatBound = false;   // 原生按钮回调是否已注册
  let _floatScopeCache = null;     // 同步缓存悬浮方式（init 时异步填充，切换时同步更新）
  const _nativeImgCache = new Map();   // 图片 URL → base64 dataURL 缓存（避免 update 高频重复 fetch/压缩）

  // 读悬浮方式设置（默认 inApp）
  async function getFloatScope() {
    let s = 'inApp';
    try { s = await getSetting('musicFloatScope', 'inApp'); } catch (e) {}
    const r = s === 'overlay' ? 'overlay' : 'inApp';
    _floatScopeCache = r;
    return r;
  }
  async function setFloatScope(s) {
    _floatScopeCache = s === 'overlay' ? 'overlay' : 'inApp';
    try { await setSetting('musicFloatScope', s); } catch (e) {}
  }
  // 同步读悬浮方式（未加载时默认 inApp）
  function floatScopeNow() { return _floatScopeCache === 'overlay' ? 'overlay' : 'inApp'; }

  // 原生插件是否可用（App 内 + 已安装 bm-music-float）
  function nativeFloat() {
    try { return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BmMusicFloat); } catch (e) { return false; }
  }

  // 悬浮窗主题（跟随软件内「文字深浅」与「背景玻璃/浅底/深底」设置），带同步缓存供 buildNativeState 用
  let _floatTextModeCache = null;   // 'light' | 'dark'
  let _floatBgModeCache = null;     // 'glass' | 'light' | 'dark'
  async function loadFloatStyleCache() {
    try { _floatTextModeCache = (await getSetting('musicFloatText', 'dark')) === 'light' ? 'light' : 'dark'; } catch (e) { _floatTextModeCache = 'dark'; }
    try {
      let b = await getSetting('musicFloatBg', 'glass');
      _floatBgModeCache = (['glass', 'light', 'dark'].indexOf(b) >= 0) ? b : 'glass';
    } catch (e) { _floatBgModeCache = 'glass'; }
  }
  function _floatTextMode() { return _floatTextModeCache === 'light' ? 'light' : 'dark'; }
  function _floatBgMode() { return (['light', 'dark'].indexOf(_floatBgModeCache) >= 0) ? _floatBgModeCache : 'glass'; }

  // 把当前歌曲状态打包成原生插件需要的 MusicState（含头像 dataURL、播放列表）
  // 20261105：改为异步——封面/头像/歌词图必须转成 base64 data URL 才能被原生层
  //   BmMusicFloatPlugin.decodeDataUrl 解码（原生只认 base64，http/blob/capacitor/文件引用
  //   全部解码失败 → 悬浮窗封面、玩家头像、角色头像全空白、图标变白方块）。
  async function buildNativeState() {
    const cur = M.state.current;
    const a = M.state.audio;
    const c = currentChar();
    const together = !!M.state.charId && !!M.state.togetherSince;
    let song = cur || {};
    // 20261106 修复「后台遥控/网易云直连时悬浮窗封面歌词不替换」：
    //   后台遥控模式（mode==='remote' 且未开直连）下，真正在播的是外部 App 的歌，
    //   M.state.current 是内部残留旧歌。这里用原生 getMediaState() 读外部真实
    //   title/artist/cover，覆盖到悬浮窗，让悬浮窗显示后台正在播的那首。
    if ((M.state.mode === 'remote') && !_netEaseDirect) {
      try {
        const br = _remoteBridge();
        if (br && typeof br.getMediaState === 'function') {
          const st = await br.getMediaState();
          if (st && st.hasSession) {
            song = {
              name: (st.title || '').trim() || song.name || '未知歌曲',
              artist: (st.artist || '').trim() || song.artist || '未知歌手',
              pic: (st.cover && typeof st.cover === 'string' && st.cover) ? st.cover : (song.pic || ''),
              url: song.url || '',
              lrc: song.lrc || '',
            };
          }
        }
      } catch (e) {}
    }
    // 当前句歌词（解析 LRC 后取当前高亮句）
    let curLyric = '';
    let lyricLines = [];
    try {
      const lines = parseLrc(M.state.lyrics || (cur && cur.lrc) || '');
      const t = a ? a.currentTime : 0;
      for (const l of lines) { if (l.t <= t) curLyric = l.text; else break; }
      lyricLines = lines.map(l => ({ t: Math.round(l.t * 100) / 100, text: l.text }));
    } catch (e) {}
    // 封面 / 头像 / 播放列表图 → base64（并行转换，任一失败回退空串，走原生 ♪/字母占位）
    const [cover, charAv, myAv] = await Promise.all([
      _toNativeImg(song.pic || ''),
      _toNativeImg(c && c.avatar ? (typeof c.avatar === 'string' ? c.avatar : (typeof window.imgSrc === 'function' ? window.imgSrc(c.avatar) : '')) : ''),
      _toNativeImg(playerAvatar()),
    ]);
    const pl = await Promise.all((M.state.playlist || []).map(async s => ({
      id: String(s.id), name: s.name, artist: s.artist || '',
      pic: await _toNativeImg(s.pic || ''),
    })));
    return {
      title: song.name || '',
      artist: song.artist || '',
      cover: cover,
      lyric: curLyric,
      lyricLines: lyricLines,
      // 20261106：playing/position 改用统一真实态 _livePlayback()（遥控模式读外部真实态，
      //   不再用内置 M.state.playing 瞎猜，根治原生悬浮窗图标/进度条与外部 App 脱节）。
      playing: _livePlayback().playing,
      position: _livePlayback().position,
      duration: _livePlayback().duration || (a && a.duration ? Math.floor(a.duration) : 0),
      mode: M.state.playMode,
      charName: c ? c.name : '',
      charAvatar: charAv,
      myAvatar: myAv,
      myName: playerName() || '我',
      togetherText: together ? togetherText() : '',
      together: together,
      textMode: _floatTextMode(),
      bgMode: _floatBgMode(),
      playlist: pl,
      playIndex: M.state.playIndex,
    };
  }

  /* 把任意图片形式（data URL / http / capacitor:// / blob: / 文件引用 {__img:5,ref}）
     统一转成 base64 data URL，供原生层 decodeDataUrl 解码。
     - 已是 data: 直接透传；
     - 其余先 imgSrc 拿最终可加载 URL，再 fetch → blob → FileReader 转 base64；
     - 任何一步失败 → 返回空串（原生层走 ♪/字母占位，绝不阻塞）。
     maxPx 控制最大边长（原生层会再按需采样，这里先不压缩，保持清晰）。 */
  async function _toNativeImg(v, maxPx = 512) {
    try {
      let url = '';
      if (!v) return '';
      if (typeof v === 'string') {
        if (v.indexOf('data:') === 0) return v;   // 已是 base64 data URL，直接透传
        url = v;
      } else {
        // 文件引用 / Blob 描述符 → 走 imgSrc 拿可加载 URL
        if (typeof window.imgSrc === 'function') url = window.imgSrc(v);
        if (!url) return '';
      }
      if (!url) return '';
      // 缓存：同一 URL 已转过的直接复用，避免 update 高频调用时反复 fetch/压缩
      const cacheKey = maxPx + '|' + url;
      if (_nativeImgCache.has(cacheKey)) return _nativeImgCache.get(cacheKey);
      let blob = null;
      // blob: 直接 FileReader 读（fetch blob 也可，但 FileReader 更稳）
      if (url.indexOf('blob:') === 0) {
        blob = await (await fetch(url)).blob();
      } else {
        // http(s) / capacitor:// / 其他：fetch 拿二进制（no-referrer 绕过网易云/B站图床防盗链）
        const resp = await fetch(url, { referrerPolicy: 'no-referrer' });
        if (!resp.ok) return '';
        blob = await resp.blob();
      }
      if (!blob) return '';
      // 压缩到 maxPx 以内再转 base64（原生层 decodeDataUrl 也按 128/256 采样，这里先压小，
      // 避免大图 base64 过大拖慢 PluginCall 传输 / 占用内存）
      const dataUrl = await _blobToSizedDataUrl(blob, maxPx);
      if (dataUrl) _nativeImgCache.set(cacheKey, dataUrl);
      return dataUrl;
    } catch (e) {
      return '';
    }
  }
  // blob → 压缩到 maxPx 边长内 → base64 data URL（canvas 同源安全，不会 taint）
  function _blobToSizedDataUrl(blob, maxPx) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onerror = () => { try { URL.revokeObjectURL(url); } catch (e) {} resolve(''); };
        img.onload = () => {
          try {
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            if (w > 0 && h > 0 && Math.max(w, h) > maxPx) {
              const r = maxPx / Math.max(w, h);
              w = Math.max(1, Math.round(w * r));
              h = Math.max(1, Math.round(h * r));
            }
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(img, 0, 0, w, h);
            const out = cv.toDataURL('image/jpeg', 0.8);
            cv.width = cv.height = 0;
            try { URL.revokeObjectURL(url); } catch (e) {}
            resolve(out || '');
          } catch (e) {
            try { URL.revokeObjectURL(url); } catch (e2) {}
            resolve('');
          }
        };
        img.src = url;
      } catch (e) { resolve(''); }
    });
  }
  // FileReader 转 dataURL（兼容 app.js 的 blobToDataURL；此处内联一份避免跨文件依赖）
  function blobToDataURLSafe(blob) {
    return new Promise((resolve) => {
      try {
        const r = new FileReader();
        r.onerror = () => resolve('');
        r.onload = () => resolve(r.result || '');
        r.readAsDataURL(blob);
      } catch (e) { resolve(''); }
    });
  }

  // 把图片地址转成 dataURL（原生层 Base64 解码需要 data URL；http 图片原生层也能加载但头像走 dataURL 最稳）
  function toDataUrl(url) {
    return url || '';
  }

  // 向原生插件推送当前状态（show 或 update）
  async function pushNativeState(forceShow) {
    if (!nativeFloat()) return;
    try {
      const st = await buildNativeState();
      const p = window.Capacitor.Plugins.BmMusicFloat;
      if (forceShow) {
        // 先确保权限；无权限则引导并回退到软件内
        const chk = await p.checkPermission();
        if (!chk || !chk.granted) {
          const req = await p.requestPermission();
          if (!req || !req.granted) {
            // 权限未授予：回退软件内，提示
            if (window.miniToast) miniToast('未授予悬浮窗权限，已回到软件内悬浮');
            await setFloatScope('inApp');
            renderFloat();
            return;
          }
        }
        await p.show(st);
      } else {
        await p.update(st);
      }
    } catch (e) {
      // 原生桥接失败：回退软件内
      try { await setFloatScope('inApp'); } catch (e2) {}
      renderFloat();
    }
  }

  // 隐藏原生悬浮窗
  async function hideNativeFloat() {
    if (!nativeFloat()) return;
    try { await window.Capacitor.Plugins.BmMusicFloat.hide(); } catch (e) {}
  }

  // 20261106：overlay 原生悬浮窗的进度/歌词心跳——每 500ms 把真实 position 推给原生层，
  //   让原生进度条/滚动歌词与软件内真实播放严格同步（根治进度条、歌词、播放条错位）。
  //   只推 position 一个字段（轻量），歌词高亮由原生层按 positionSec 本地推进。
  function _startNativeHeartbeat() {
    _stopNativeHeartbeat();
    if (!nativeFloat()) return;
    const p = window.Capacitor.Plugins.BmMusicFloat;
    let _lastPushedSec = -1;   // 上次已推的秒数：position 未变则不推，避免暂停时反复 update 造成悬浮窗闪动
    const beat = async () => {
      try {
        // 20261106 修复「进度条来回串」：遥控模式下内置 audio.currentTime≈0（残留旧歌），
        //   推给原生层会让原生进度条归零、与外部真实进度打架。这里改用统一真实态
        //   _livePlayback().position（遥控模式读外部 getMediaState().position，其余模式读内置）。
        const sec = _livePlayback().position;
        if (!isFinite(sec) || sec < 0) return;
        // 20261106 修复「暂停状态下悬浮窗仍闪动」：position 没变化（暂停/缓冲）时跳过推送，
        //   原生层无需再 updateProgressUi（setText/setTranslationX 相同值仍会触发重绘闪烁）。
        //   只有秒数真正前进才推，且 seek 跳变也天然会推（sec 变化大）。
        if (sec === _lastPushedSec) return;
        _lastPushedSec = sec;
        await p.update({ position: sec });
      } catch (e) { /* 原生层已销毁等异常，静默忽略 */ }
    };
    _nativeHeartbeatTimer = setInterval(beat, 500);
  }

  function _stopNativeHeartbeat() {
    if (_nativeHeartbeatTimer) { clearInterval(_nativeHeartbeatTimer); _nativeHeartbeatTimer = null; }
  }

  // 注册原生按钮回调（只注册一次）
  function bindNativeFloat() {
    if (_nativeFloatBound || !nativeFloat()) return;
    _nativeFloatBound = true;
    const p = window.Capacitor.Plugins.BmMusicFloat;
    const reg = (ev, fn) => { try { p.addListener(ev, fn); } catch (e) {} };
    // 20261106 修复「后台遥控模式下悬浮窗播放/暂停/切歌仍操控内置播放器」：
    //   悬浮窗按钮回调此前直接调 M.toggle()/M.prev()/M.next()（内置），未走 remote 分发。
    //   现统一走 _remoteAction：后台遥控模式（mode==='remote' 且未开直连）发指令给外部 App，
    //   否则回落到内置播放器。与音乐页控制键 _ppToggle / _isRemoteMode 判断保持一致。
    const _remoteToggle = () => {
      if ((M.state.mode === 'remote') && !_netEaseDirect) {
        _remoteAction({ bridge: 'toggle', local: () => M.toggle() }, null);
      } else {
        M.toggle();
      }
      refreshPlayerUI();
      // 20261106：补推原生层状态，让悬浮窗播放/暂停图标（▶/||）真实切换。
      //   此前只刷新软件内 UI，未调 pushNativeState()，原生 refreshPpIcons() 不执行，
      //   导致点击后图标永远停在初始值。
      pushNativeState(false);
    };
    const _remotePrev = () => {
      if ((M.state.mode === 'remote') && !_netEaseDirect) {
        _remoteAction({ bridge: 'prev', local: () => M.prev() }, null);
      } else {
        M.prev();
      }
      refreshPlayerUI();
      pushNativeState(false);
    };
    const _remoteNext = () => {
      if ((M.state.mode === 'remote') && !_netEaseDirect) {
        _remoteAction({ bridge: 'next', local: () => M.next() }, null);
      } else {
        M.next();
      }
      refreshPlayerUI();
      pushNativeState(false);
    };
    reg('onToggle', _remoteToggle);
    reg('onPrev', _remotePrev);
    reg('onNext', _remoteNext);
    reg('onSeek', (info) => {
      try {
        const a = M.state.audio;
        if (a && info && typeof info.position === 'number') { try { a.currentTime = info.position; } catch (e) {} }
      } catch (e) {}
    });
    reg('onMode', () => { M.cyclePlayMode(); updateCtrlState(); });
    reg('onList', () => { /* 原生列表由插件自绘，无需 JS 处理 */ });
    reg('onEnd', () => { endTogether(); });
    reg('onSelect', (info) => {
      try {
        if (info && typeof info.index === 'number') {
          M.state.playIndex = info.index;
          M.playPrepared(info.index);
          refreshPlayerUI();
        }
      } catch (e) {}
    });
    reg('onEnterApp', () => { /* 双击回应用，恢复软件内状态 */ });
    reg('onCollapse', () => {});
  }

  // 悬浮方式切换（软件内 / 其他应用）——音乐页按钮、聊天设置共用。
  //   切到 overlay：移除 DOM 悬浮、走原生系统层（含权限自动检测，未授权自动跳系统设置页，失败回退软件内）。
  //   切回 inApp：隐藏原生、重建 DOM 悬浮。
  async function setFloatScopeAndApply(ns) {
    const target = ns === 'overlay' ? 'overlay' : 'inApp';
    await setFloatScope(target);
    if (target === 'overlay') {
      const fw = document.getElementById('bm-music-float');
      if (fw) fw.remove();
      bindNativeFloat();
      await pushNativeState(true);
    } else {
      await hideNativeFloat();
      renderFloat();
    }
  }

  // 20261105：合并面板——一个「悬浮窗」图标承载「开启/关闭悬浮窗」+「悬浮方式」两个功能。
  //   点击图标弹出此面板：上半是开关，下半是悬浮方式二选一。与聊天设置、音乐页共用同一份设置。
  function showFloatPanel(anchorBtn) {
    let pop = document.getElementById('bm-float-panel');
    if (pop) { pop.remove(); return; }
    const act = 'background:var(--purple);color:#fff;border-color:var(--purple);';
    let musicFloatOn = true;
    try { if (typeof chatSettings !== 'undefined' && chatSettings && chatSettings.musicFloatOn === false) musicFloatOn = false; } catch (e) {}
    pop = document.createElement('div');
    pop.id = 'bm-float-panel';
    pop.className = 'bm-float-scope-picker';
    pop.innerHTML = `
      <div class="fsp-title">悬浮窗</div>
      <button class="fsp-opt fsp-toggle" data-on="1">${musicFloatOn ? '● 已开启 · 点击关闭' : '○ 已关闭 · 点击开启'}</button>
      <div class="fsp-divider"></div>
      <div class="fsp-title">悬浮方式</div>
      <button class="fsp-opt fsp-scope" data-scope="inApp">软件内悬浮</button>
      <button class="fsp-opt fsp-scope" data-scope="overlay">其他应用悬浮</button>
      <div class="fsp-tip">其他应用悬浮需系统悬浮窗权限</div>`;
    document.body.appendChild(pop);
    // 回显当前悬浮方式
    getFloatScope().then(scope => {
      pop.querySelectorAll('.fsp-scope').forEach(b => {
        if (b.dataset.scope === scope) b.setAttribute('style', act);
      });
    });
    const place = () => {
      const r = anchorBtn.getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let x = r.right - pw, y = r.top - ph - 6;
      if (x < 6) x = Math.max(6, r.left);
      if (x + pw > window.innerWidth - 6) x = window.innerWidth - pw - 6;
      if (y < 6) y = r.bottom + 6;
      pop.style.left = x + 'px';
      pop.style.top = y + 'px';
    };
    place();
    // 开关
    pop.querySelector('.fsp-toggle').onclick = async () => {
      const next = !musicFloatOn;
      try {
        if (typeof chatSettings !== 'undefined' && chatSettings) {
          chatSettings.musicFloatOn = next;
          if (typeof setSetting === 'function') await setSetting('chatSettings', chatSettings);
        }
      } catch (e) {}
      if (next) {
        _floatClosedByUser = false;
        renderFloat();
        if (window.miniToast) miniToast('已开启悬浮窗');
      } else {
        const fw = document.getElementById('bm-music-float');
        if (fw) fw.remove();
        hideNativeFloat();
        _floatClosedByUser = true;
        if (window.miniToast) miniToast('已关闭悬浮窗');
      }
      syncFloatBtn();
      pop.remove();
    };
    // 悬浮方式
    pop.querySelectorAll('.fsp-scope').forEach(b => {
      b.onclick = async () => {
        const ns = b.dataset.scope;
        await setFloatScopeAndApply(ns);
        if (window.miniToast) miniToast(ns === 'overlay' ? '已切到其他应用悬浮' : '已切回软件内悬浮');
        pop.remove();
      };
    });
    // 点击外部关闭
    const onDocDown = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', onDocDown, true); } };
    setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
  }

  // 「悬浮方式」选择器（软件内 / 其他应用）——已合并进 showFloatPanel，此函数保留供聊天设置等复用
  function showFloatScopePicker(anchorBtn) {
    let pop = document.getElementById('bm-float-scope-picker');
    if (pop) { pop.remove(); return; }
    const act = 'background:var(--purple);color:#fff;border-color:var(--purple);';
    pop = document.createElement('div');
    pop.id = 'bm-float-scope-picker';
    pop.className = 'bm-float-scope-picker';
    getFloatScope().then(scope => {
      pop.innerHTML = `
        <div class="fsp-title">悬浮方式</div>
        <button class="fsp-opt" data-scope="inApp" style="${scope === 'inApp' ? act : ''}">软件内悬浮</button>
        <button class="fsp-opt" data-scope="overlay" style="${scope === 'overlay' ? act : ''}">其他应用悬浮</button>
        <div class="fsp-tip">其他应用悬浮需系统悬浮窗权限</div>`;
      document.body.appendChild(pop);
      const place = () => {
        const r = anchorBtn.getBoundingClientRect();
        const pw = pop.offsetWidth, ph = pop.offsetHeight;
        let x = r.right - pw, y = r.top - ph - 6;
        if (x < 6) x = Math.max(6, r.left);
        if (x + pw > window.innerWidth - 6) x = window.innerWidth - pw - 6;
        if (y < 6) y = r.bottom + 6;
        pop.style.left = x + 'px';
        pop.style.top = y + 'px';
      };
      place();
      pop.querySelectorAll('.fsp-opt').forEach(b => {
        b.onclick = async () => {
          const ns = b.dataset.scope;
          await setFloatScopeAndApply(ns);
          if (window.miniToast) miniToast(ns === 'overlay' ? '已切到其他应用悬浮' : '已切回软件内悬浮');
          pop.remove();
        };
      });
    });
    // 点击外部关闭
    const onDocDown = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', onDocDown, true); } };
    setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
  }

  // 预热：模块加载即读一次悬浮方式 + 悬浮窗主题，填充同步缓存（重进 App 恢复上次选择）
  getFloatScope();
  loadFloatStyleCache();

  function renderFloat() {
    let fw = document.getElementById('bm-music-float');
    const cur = M.state.current;
    // 20261105：悬浮方式 = 其他应用（overlay）时，不渲染 DOM 悬浮窗，改走原生系统层悬浮。
    if (floatScopeNow() === 'overlay') {
      if (fw) fw.remove();
      bindNativeFloat();
      // 若原生态尚未显示（首次/被杀），先 show；否则 update
      if (nativeFloat()) {
        (async () => {
          try {
            const p = window.Capacitor.Plugins.BmMusicFloat;
            const chk = await p.checkPermission();
            if (chk && chk.granted) {
              await p.update(await buildNativeState());
            }
          } catch (e) {}
        })();
        // 20261106 根因修复：原生悬浮窗进度/歌词此前只在 renderFloat 时 update 一次，
        //   之后原生层 startTicking 用本地 elapsedRealtime 每秒 +1 自增，与 JS 端真实
        //   audio.currentTime（受暂停/seek/缓冲/后台挂起影响）逐渐错位 → 进度条、滚动歌词、
        //   播放条三者脱节。这里加一个 500ms 心跳，把真实 position 持续推给原生层，
        //   原生层收到 position 即校准（见 applyState 里 positionSec = position）。
        _startNativeHeartbeat();
      }
      return;
    }
    // 20261104：悬浮窗显隐唯一依据 = 开关状态 + 用户是否主动关闭。
    //   不再要求「正在播放(cur)」或「一起听中(together)」——用户明确：开关打开即出现，
    //   且所有页面（朋友圈/个人主页/聊天/聊天导航/听歌页）都要出现。待机态显示 dot。
    const together = !!M.state.charId && !!M.state.togetherSince;
    let musicFloatOn = true;
    try { if (typeof chatSettings !== 'undefined' && chatSettings && chatSettings.musicFloatOn === false) musicFloatOn = false; } catch (e) {}
    // 20261104：开屏动画期间不显示悬浮窗，等开屏结束（__bmSplashEndAt 已打点）才出现
    const splashOngoing = (typeof window.__bmSplashEndAt === 'undefined' && document.getElementById('splash-v5-canvas'));
    if (_floatClosedByUser || !musicFloatOn || splashOngoing) { if (fw) fw.remove(); syncFloatBtn(); return; }
    const wasNew = !fw;
    if (!fw) {
      fw = document.createElement('div');
      fw.id = 'bm-music-float';
      fw.className = 'bm-music-float dot';
      document.body.appendChild(fw);
    }
    // 悬浮窗跟随主题
    (async () => {
      let theme = 'star';
      const valid = ['star', 'vinyl', 'paper', 'pixel', 'y2k', 'collage', 'bw'];
      try { theme = await getSetting('musicTheme', 'star'); } catch (e) {}
      if (valid.indexOf(theme) < 0) theme = 'star';
      fw.dataset.theme = theme;
    })();
    const c = currentChar();
    const playing = M.state.playing;
    // cur 可能为空（仅一起听未点歌），用占位对象兜底，避免模板里读 null 报错
    const song = cur || { name: '去点首歌吧', artist: '播放列表里的歌都能点', pic: '' };
    fw.innerHTML = `
      <div class="bm-float-dot" id="bm-float-dot">
        ${song.pic ? coverImgHTML(song.pic) : '♪'}
      </div>
      <div class="bm-float-mini" id="bm-float-mini">
        <div class="bm-mini-avs">
          <span class="bm-mini-av mine">${avatarImgHTML(playerAvatar(), (playerName() || '我')[0]).html}</span>
          <span class="bm-mini-av ta">${avatarImgHTML(c && c.avatar, (c && c.name || 'TA')[0]).html}</span>
        </div>
        <div class="bm-mini-info">
          <div class="bm-mini-title">${esc(song.name)}</div>
          <div class="bm-mini-artist">${esc(song.artist)}</div>
          <div class="bm-mini-lyric" id="bm-mini-lyric"></div>
        </div>
        <button class="bm-mini-btn" id="bm-mini-pp" title="${playing ? '暂停' : '播放'}">${window.icon ? window.icon(playing ? 'pause' : 'play', 18) : (playing ? '⏸' : '▶')}</button>
        <button class="bm-mini-close" id="bm-mini-close" title="收起">—</button>
      </div>
      <div class="bm-float-card" id="bm-float-card">
        <div class="bm-float-card-head">
          <div class="bm-float-avatars">
            <span class="bm-float-avatar mine">${avatarImgHTML(playerAvatar(), (playerName() || '我')[0]).html}</span>
            <span class="bm-float-starline">✦</span>
            <span class="bm-float-avatar ta">${avatarImgHTML(c && c.avatar, (c && c.name || 'TA')[0]).html}</span>
          </div>
          <div class="bm-float-head-btns">
            <button class="bm-float-style" id="bm-float-style" title="切换文字深浅/普通背景">Aa</button>
            <button class="bm-float-close" id="bm-float-close" title="收起">—</button>
          </div>
        </div>
        <div class="bm-float-head">
          <span class="bm-float-together-label">一起听歌</span>
          <div class="bm-float-time" id="bm-float-time">${togetherText()}</div>
          <button class="bm-float-end" id="bm-float-end" title="结束一起听">结束</button>
        </div>
        <div class="bm-float-body">
          <div class="bm-float-cover">${song.pic ? coverImgHTML(song.pic) : '♪'}</div>
          <div class="bm-float-info">
            <div class="bm-float-title">${esc(song.name)}</div>
            <div class="bm-float-artist">${esc(song.artist)}</div>
          </div>
        </div>
        <div class="bm-float-lyric" id="bm-float-lyric"></div>
        <div class="bm-float-progress" id="bm-float-progress">
          <span class="bm-float-prog-time" id="bm-float-prog-cur">00:00</span>
          <input type="range" class="bm-float-progress-slider" id="bm-float-progress-slider" min="0" max="1000" value="0" step="1" />
          <span class="bm-float-prog-time" id="bm-float-prog-dur">00:00</span>
        </div>
        <div class="bm-float-ctrl">
          <button class="bm-ctrl-btn bm-ctrl-side" id="bm-float-mode" title="播放模式">${window.icon ? window.icon('repeat', 16) : '🔁'}</button>
          <button class="bm-ctrl-btn" id="bm-float-prev">${window.icon ? window.icon('prev', 18) : '‹‹'}</button>
          <button class="bm-ctrl-btn bm-ctrl-main" id="bm-float-pp">${window.icon ? window.icon(playing ? 'pause' : 'play', 22) : '▶'}</button>
          <button class="bm-ctrl-btn" id="bm-float-next">${window.icon ? window.icon('next', 18) : '››'}</button>
          <button class="bm-ctrl-btn bm-ctrl-side" id="bm-float-list" title="播放列表">${window.icon ? window.icon('list', 16) : '≡'}</button>
        </div>
        <div class="bm-float-resize" id="bm-float-resize" title="拖拽缩放">⌟</div>
      </div>
    `;
    // 三级切换：dot → mini → card
    function setFloatState(s) {
      fw.classList.remove('dot', 'mini', 'card');
      if (s) fw.classList.add(s);
      M.state.floatState = s;
      // 20261104：每次形态切换都重新播放入场动画，让 dot→mini→card 展开丝滑（带回弹），
      // 而非 display 硬切瞬间跳变。用 reflow 强制重启 CSS animation。
      const el = s === 'dot' ? fw.querySelector('#bm-float-dot')
               : s === 'mini' ? fw.querySelector('#bm-float-mini')
               : fw.querySelector('#bm-float-card');
      if (el) {
        const name = s === 'dot' ? 'bm-dot-in' : s === 'mini' ? 'bm-mini-in' : 'bm-card-in';
        el.style.animation = 'none';
        void el.offsetHeight;  // 强制 reflow，确保 animation 重启
        el.style.animation = '';
        el.style.animation = `${name} .32s cubic-bezier(.34,1.2,.64,1)`;
      }
    }
    // 圆点 → 小卡（点击展开；若刚拖拽过则抑制，避免松手误触发展开）
    fw.querySelector('#bm-float-dot').onclick = () => {
      if (fw._suppressClick) return;
      fw._hoverExpanded = false;   // 20261104：点击展开不算「悬停展开」，移开鼠标不再缩回
      setFloatState('mini');
    };
    // 小卡 → 大卡：随便点哪里都展开（播放按钮除外，它负责播放/暂停）
    fw.querySelector('#bm-float-mini').onclick = (e) => {
      if (fw._suppressClick) return;
      if (e.target.closest('#bm-mini-pp')) return;
      if (e.target.closest('#bm-mini-close')) { collapseFloat(); return; }
      fw._hoverExpanded = false;   // 20261104：点击展开到三级后，移开鼠标不再缩回（三级保持展示）
      setFloatState('card');
    };
    // 20261104 用户修正：一级 dot → 二级 mini 改为【点击才展开】，不再鼠标悬停自动展开。
    //   层级约定：dot → mini 点击展开；mini → card 点击展开；收起靠减号按钮。
    fw._hoverExpanded = false;
    // 大卡内点封面/标题区不额外动作（保持大卡）
    // 收起：✕ 按钮不是"关闭"，而是收起回小圆点（悬浮窗不可被真正关闭，音乐继续全局后台播放）
    const collapseFloat = () => setFloatState('dot');
    fw.querySelector('#bm-mini-close').onclick = (e) => { e.stopPropagation(); collapseFloat(); };
    fw.querySelector('#bm-float-close').onclick = (e) => { e.stopPropagation(); collapseFloat(); };
    // 20261104：「结束」按钮——结束一起听（回到单人听歌），只在一起听时显示
    const endBtn = fw.querySelector('#bm-float-end');
    if (endBtn) {
      // 只在一起听中（together）显示；单人听歌时隐藏
      endBtn.style.display = together ? '' : 'none';
      endBtn.onclick = (e) => { e.stopPropagation(); endTogether(); };
    }
    // 20261104：文字/背景样式按钮——点开小弹窗，分「文字颜色」「背景颜色」两个独立选项快速选
    const fsBtn = fw.querySelector('#bm-float-style');
    if (fsBtn) {
      fsBtn.onclick = (e) => { e.stopPropagation(); showFloatStylePicker(); };
    }
    applyFloatTextStyle();
    // 控制键（20261104：模式二 remote 下走后台遥控 _remoteAction）
    // 20261105：与角色动作 isRemote 判断对齐——「真遥控外部 App」= mode=remote 且未开网易云直连。
    //   开了直连后悬浮窗控制的是白日梦内置播放器（走 M.toggle/M.prev/M.next），
    //   否则点播放/暂停会误发给外部 App 的 MediaSession，外部无活跃会话时报 no_active_session，
    //   表现为「点了没反应/只刷新不播放」。
    const _isRemote = () => (M.state.mode === 'remote') && !_netEaseDirect;
    fw.querySelector('#bm-float-prev').onclick = () => {
      if (_isRemote()) { _remoteAction({ bridge: 'prev', local: () => M.prev() }, null); refreshPlayerUI(); return; }
      M.prev();
    };
    fw.querySelector('#bm-float-next').onclick = () => {
      if (_isRemote()) { _remoteAction({ bridge: 'next', local: () => M.next() }, null); refreshPlayerUI(); return; }
      M.next();
    };
    // 20261105 修复「外部在播时点播放/暂停打架」：优先检测外部活跃会话，有则遥控外部。
    // 20261105 二次修复「直连/镜像/本地模式下点播放却操控后台音乐」：三模式互斥——
    //   只有后台遥控模式（_isRemote）才查外部活跃会话发 toggle；其余模式一律内置播放器。
    const _floatPpToggle = async () => {
      if (!_isRemote()) { M.toggle(); refreshPlayerUI(); return; }
      const br = _remoteBridge();
      if (br && typeof br.hasActiveSession === 'function') {
        try {
          const r = await br.hasActiveSession();
          if (r && r.hasSession) {
            await _remoteAction({ bridge: 'toggle', local: () => M.toggle() }, null);
            refreshPlayerUI();
            return;
          }
        } catch (e) {}
      }
      M.toggle(); refreshPlayerUI();
    };
    fw.querySelector('#bm-float-pp').onclick = _floatPpToggle;
    fw.querySelector('#bm-mini-pp').onclick = (e) => {
      e.stopPropagation();
      _floatPpToggle();
    };
    // 20261104：三级悬浮窗播放模式切换 + 播放列表按钮
    const fmBtn = fw.querySelector('#bm-float-mode');
    if (fmBtn) fmBtn.onclick = (e) => { e.stopPropagation(); M.cyclePlayMode(); updateCtrlState(); };
    const flBtn = fw.querySelector('#bm-float-list');
    // 20261106：悬浮窗「播放列表」按钮改为打开软件内部同一个完整播放列表面板（底部半屏、网易云样式），
    //   与音乐页点「播放列表」完全一致，不再是那个小的 showFloatMiniList 迷你列表。
    if (flBtn) flBtn.onclick = (e) => { e.stopPropagation(); showPlaylist(); };
    // 20261104：三级悬浮窗（card）播放进度条——可拖动 seek + 实时显示当前/总时长
    const fprog = fw.querySelector('#bm-float-progress-slider');
    if (fprog) {
      const fcurEl = fw.querySelector('#bm-float-prog-cur');
      fprog.oninput = () => {
        _floatSeeking = true;
        const a = M.state.audio;
        // 20261105：duration 用实时值，失效时用缓存兜底（挂后台回来 a.duration 丢失导致 seek 失效）
        const d = (a && isFinite(a.duration) && a.duration > 0) ? a.duration : _cachedDuration;
        if (a && d > 0 && fcurEl) {
          const t = (parseInt(fprog.value, 10) / 1000) * d;
          fcurEl.textContent = _fmtTime(t);
        }
      };
      fprog.onchange = () => {
        const a = M.state.audio;
        const d = (a && isFinite(a.duration) && a.duration > 0) ? a.duration : _cachedDuration;
        if (a && d > 0) {
          const t = (parseInt(fprog.value, 10) / 1000) * d;
          try { a.currentTime = t; } catch (e) {}
        }
        _floatSeeking = false;
      };
    }
    // 悬浮窗内歌词滚动（先清旧定时器，避免重复堆积导致页面卡死）
    if (_floatLyricTimer) { clearInterval(_floatLyricTimer); _floatLyricTimer = null; }
    const fly = fw.querySelector('#bm-float-lyric');
    const miniLyric = fw.querySelector('#bm-mini-lyric');
    if (fly || miniLyric) {
      const lines = parseLrc(M.state.lyrics || (cur && cur.lrc) || '');
      if (lines.length) {
        if (fly) fly.innerHTML = lines.map(l => `<div class="bm-fly-line${l.tr ? ' bm-fly-tr' : ''}" data-t="${l.t}">${esc(l.text)}</div>`).join('');
        const a = M.state.audio;
        // 大卡歌词逐句高亮 + 滚动居中 + mini 显示当前句。
        // 20261104：玩家可自由上下滚动歌词（wheel/touch 不拦截），只有「唱到新一句」才跳转回当前句。
        let _flyLastActive = -1;
        const upd = () => {
          // 20261105：悬浮窗进度条/时长独立刷新——此前只靠音乐页 rAF（startPlanetAnimation）驱动，
          //   音乐页关闭只挂悬浮窗时，进度条与「当前/总时长」永远停在 00:00（用户反馈「显示 0 分」）。
          //   这里每次心跳都同步刷新进度（__bmUpdateProgress 是模块级，含主进度条 + 悬浮窗进度条）。
          if (typeof window.__bmUpdateProgress === 'function') { try { window.__bmUpdateProgress(); } catch (e) {} }
          // 20261104：同步「已一起听 X」时长——togetherText() 只在渲染时算一次，
          //   之前卡片展开后时长永远停在初始值（截图里「已一起听」后面是空的），
          //   这里每次心跳都把最新时长写回 #bm-float-time。
          const ft = fw.querySelector('#bm-float-time');
          if (ft) {
            // 20261104：本次一起听时长（只记当次，不累计；累计在日记页单独统计）
            const tt = togetherText();
            const label = tt || '';
            if (ft.textContent !== label) ft.textContent = label;
          }
          // audio 未建立（还没真正播放）时，兜底显示第一句歌词，避免暂停态歌词区空白
          const t = a ? a.currentTime : (lines.length ? lines[0].t : 0);
          let activeIdx = -1;
          if (fly) {
            fly.querySelectorAll('.bm-fly-line').forEach((l, i) => {
              const on = parseFloat(l.dataset.t) <= t;
              l.classList.toggle('on', on);
              if (on) activeIdx = i;
            });
            // 只在「唱到新一句」时才跳转滚动（activeIdx 变化才滚），唱同一句期间玩家可自由滚动不被弹回
            if (activeIdx >= 0 && activeIdx !== _flyLastActive) {
              _flyLastActive = activeIdx;
              const target = fly.querySelectorAll('.bm-fly-line')[activeIdx];
              const lineH = target.offsetHeight || 24;
              const center = fly.clientHeight / 2 - lineH / 2;
              fly.scrollTop = Math.max(0, target.offsetTop - center);
            }
          }
          if (miniLyric) {
            let curLine = '';
            for (const l of lines) { if (l.t <= t) curLine = l.text; else break; }
            if (curLine !== miniLyric.dataset.cur) {
              miniLyric.dataset.cur = curLine;
              miniLyric.textContent = curLine;
            }
          }
        };
        upd();
        _floatLyricTimer = setInterval(upd, 500);
      } else {
        if (fly) fly.innerHTML = '<div class="bm-music-empty">暂无歌词</div>';
        if (miniLyric) { miniLyric.textContent = ''; miniLyric.dataset.cur = ''; }
        // 20261105：无歌词歌曲也要驱动进度条/时长刷新（此前无歌词不启动定时器 → 进度永远 00:00）
        const updNoLrc = () => {
          if (typeof window.__bmUpdateProgress === 'function') { try { window.__bmUpdateProgress(); } catch (e) {} }
          const ft = fw.querySelector('#bm-float-time');
          if (ft) { const tt = togetherText(); if (ft.textContent !== tt) ft.textContent = tt; }
        };
        _floatLyricTimer = setInterval(updNoLrc, 500);
      }
    }
    // 位置错开打字圆点：默认右下角，打字圆点在右下时会往上避让；支持拖拽 + 持久化
    positionFloat(fw);
    enableFloatDrag(fw);
    enableFloatResize(fw);
    // 悬浮窗内播放模式按钮同步当前模式图标
    updateCtrlState();
    // 悬浮窗渲染/移除后，同步音乐页开关按钮的开/关印记
    syncFloatBtn();
  }

  /* 同步音乐页「一起听悬浮窗」开关按钮的开/关印记 */
  function syncFloatBtn() {
    const btn = document.getElementById('bm-music-floatbtn');
    if (!btn) return;
    // 20261104：印记直接反映「开关状态」（musicFloatOn），而不是「悬浮窗当前是否真的显示」。
    // 这样用户点按钮能立刻看到紫色/白色切换（即使还没点歌、没一起听，开关也已生效）。
    let musicFloatOn = true;
    try { if (typeof chatSettings !== 'undefined' && chatSettings && chatSettings.musicFloatOn === false) musicFloatOn = false; } catch (e) {}
    btn.classList.toggle('on', musicFloatOn);
  }

  /* 换新歌播放时重置"用户主动关闭"标志，让悬浮窗重新出现 */
  function resetFloatClosed() { _floatClosedByUser = false; }

  /* 20261104：悬浮窗文字/背景样式——两个独立维度，点 Aa 弹小弹窗自由组合：
     · 文字颜色：musicFloatText = 'light'（浅字）/ 'dark'（深字）
     · 背景：musicFloatBg = 'glass'（玻璃磨砂底，默认）/ 'light'（浅色普通底）/ 'dark'（深色普通底）
     普通背景跟随全局预设色系（浅色普通=浅色预设的底色、深色普通=深色预设的底色）。
     两个维度自由组合：浅字/深字 × 玻璃/浅底/深底。 */
  async function showFloatStylePicker() {
    // 20261104：改成悬浮窗自身的小浮层（不用全局 modal），小且紧凑，z-index 高于悬浮窗、叠在它前方
    let text = 'dark';
    let bg = 'glass';
    try { text = await getSetting('musicFloatText', 'dark'); } catch (e) {}
    try { bg = await getSetting('musicFloatBg', 'glass'); } catch (e) {}
    if (text !== 'light') text = 'dark';
    if (['glass', 'light', 'dark'].indexOf(bg) < 0) bg = 'glass';
    const act = 'background:var(--purple);color:#fff;border-color:var(--purple);';
    // 已存在则先移除，避免叠层
    let old = document.getElementById('bm-float-style-picker');
    if (old) old.remove();
    const pop = document.createElement('div');
    pop.id = 'bm-float-style-picker';
    pop.innerHTML = `
      <div class="fsp-title">悬浮窗样式</div>
      <div class="fsp-label">文字</div>
      <div class="fsp-row">
        <button class="fsp-opt" data-fsp-text="light" style="${text === 'light' ? act : ''}">浅</button>
        <button class="fsp-opt" data-fsp-text="dark" style="${text === 'dark' ? act : ''}">深</button>
      </div>
      <div class="fsp-label">背景</div>
      <div class="fsp-row">
        <button class="fsp-opt" data-fsp-bg="glass" style="${bg === 'glass' ? act : ''}">玻璃</button>
        <button class="fsp-opt" data-fsp-bg="light" style="${bg === 'light' ? act : ''}">浅底</button>
        <button class="fsp-opt" data-fsp-bg="dark" style="${bg === 'dark' ? act : ''}">深底</button>
      </div>`;
    document.body.appendChild(pop);
    // 定位：紧贴在触发按钮（Aa）下方，先默认放悬浮窗右侧上方，随后按悬浮窗位置校准
    const fw = document.getElementById('bm-music-float');
    const btn = fw && fw.querySelector('#bm-float-style');
    const place = () => {
      const rect = (btn || fw).getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let x = rect.right - pw;           // 右对齐按钮
      let y = rect.bottom + 6;           // 按钮下方 6px
      if (x < 6) x = Math.max(6, rect.left);                 // 左越界则靠左
      if (x + pw > window.innerWidth - 6) x = window.innerWidth - pw - 6;
      if (y + ph > window.innerHeight - 6) y = rect.top - ph - 6; // 下方放不下翻到上方
      pop.style.left = x + 'px';
      pop.style.top = y + 'px';
    };
    place();
    pop.querySelectorAll('.fsp-opt').forEach(b => {
      b.onclick = async () => {
        if (b.dataset.fspText) {
          text = b.dataset.fspText;
          try { await setSetting('musicFloatText', text); } catch (e) {}
        } else if (b.dataset.fspBg) {
          bg = b.dataset.fspBg;
          try { await setSetting('musicFloatBg', bg); } catch (e) {}
        }
        applyFloatTextStyle();
        pop.remove();
      };
    });
    // 点击外部关闭
    const onDocDown = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', onDocDown, true); } };
    setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
  }
  async function applyFloatTextStyle() {
    const fw = document.getElementById('bm-music-float');
    if (!fw) return;
    let text = 'dark', bg = 'glass';
    try { text = await getSetting('musicFloatText', 'dark'); } catch (e) {}
    try { bg = await getSetting('musicFloatBg', 'glass'); } catch (e) {}
    if (text !== 'light') text = 'dark';
    if (['glass', 'light', 'dark'].indexOf(bg) < 0) bg = 'glass';
    // 同步原生悬浮窗主题缓存
    _floatTextModeCache = text;
    _floatBgModeCache = bg;
    fw.classList.remove('ftext-light', 'ftext-dark', 'fbg-glass', 'fbg-light', 'fbg-dark');
    fw.classList.add('ftext-' + text, 'fbg-' + bg);
    // 按钮印记：任何一档非默认（深字+玻璃）都点亮，方便玩家知道已自定义
    const btn = fw.querySelector('#bm-float-style');
    if (btn) btn.classList.toggle('on', text === 'light' || bg !== 'glass');
  }

  /* 20261107：把悬浮窗钳制在可视区内（四边各留 6px），宽高跟着页面长宽幅度走，绝不出屏。
     供拖拽 applyMove 与位置恢复 positionFloat 共用。 */
  function clampFloatToViewport(fw) {
    const r = fw.getBoundingClientRect();
    if (!r.width && !r.height) return;   // 尚未布局，跳过（恢复后 requestAnimationFrame 再钳一次）
    const margin = 6;
    const maxX = Math.max(margin, window.innerWidth - r.width - margin);
    const maxY = Math.max(margin, window.innerHeight - r.height - margin);
    let x = Math.max(margin, Math.min(maxX, r.left));
    let y = Math.max(margin, Math.min(maxY, r.top));
    fw.style.left = x + 'px';
    fw.style.top = y + 'px';
    fw.style.right = 'auto';
    fw.style.bottom = 'auto';
  }

  function positionFloat(fw) {
    // 优先恢复用户上次拖动的位置
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('bmFloatPos') || 'null'); } catch (e) {}
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
      fw.style.left = saved.x + 'px';
      fw.style.top = saved.y + 'px';
      fw.style.right = 'auto';
      fw.style.bottom = 'auto';
      // 20261107：恢复位置后按当前窗口/形态尺寸钳制回可视区（防止窗口变窄或换形态导致出屏）
      requestAnimationFrame(() => clampFloatToViewport(fw));
      return;
    }
    // 否则默认右下，与「碎梦重拼」打字圆点错开（它在右下时上移）
    const dot = document.querySelector('[data-typecard-float-dot], .tc-float-dot, .typecard-float-drag');
    fw.style.left = 'auto';
    fw.style.top = 'auto';
    fw.style.bottom = dot ? '92px' : '20px';
    fw.style.right = '16px';
  }

  /* 悬浮窗拖拽（三个形态 dot/mini/card 均可拖）：pointer 事件兼容鼠标/触摸。
     20261104 修复「拖拽失效」：renderFloat 每次都会重建 innerHTML（销毁子元素），
     之前 dot/mini 的拖拽监听器绑在子元素上会随重建丢失，且 __bmDragBound 守卫阻止了重新绑定。
     改为：容器级事件委托 + 只绑定一次（命名函数幂等），dot/mini 用「移动超阈值才算拖拽」，
     否则视为点击（dot→mini 展开 / mini→card 展开），card 形态直接拖拽。 */
  function enableFloatDrag(fw) {
    if (fw.__bmDragBound) return;
    fw.__bmDragBound = true;
    let drag = null;       // 当前拖拽状态（card 形态直接拖，dot/mini 形态延迟判定后拖）
    let down = null;       // 按下起点（dot/mini 形态用于阈值判定）
    let thresholdMet = false;

    const startDrag = (px, py) => {
      const r = fw.getBoundingClientRect();
      drag = { px, py, left: r.left, top: r.top };
      fw.setPointerCapture && fw.setPointerCapture(down ? down.pointerId : 0);
      fw.classList.add('dragging');
      _floatDragging = true;
    };
    const applyMove = (cx, cy) => {
      if (!drag) return;
      let nx = drag.left + (cx - drag.px);
      let ny = drag.top + (cy - drag.py);
      const r = fw.getBoundingClientRect();
      // 20261107 修复「悬浮窗能拉出边界外」：完全限制在可视区内，四边各留 6px 边距，
      // 且按悬浮窗实际宽高（含缩放后）钳制，宽高跟着页面长宽幅度走，绝不出屏。
      const margin = 6;
      const maxX = Math.max(margin, window.innerWidth - r.width - margin);
      const maxY = Math.max(margin, window.innerHeight - r.height - margin);
      nx = Math.max(margin, Math.min(maxX, nx));
      ny = Math.max(margin, Math.min(maxY, ny));
      fw.style.left = nx + 'px';
      fw.style.top = ny + 'px';
      fw.style.right = 'auto';
      fw.style.bottom = 'auto';
    };
    const savePos = () => {
      try {
        const r = fw.getBoundingClientRect();
        localStorage.setItem('bmFloatPos', JSON.stringify({ x: r.left, y: r.top }));
      } catch (err) {}
    };

    const onDown = (e) => {
      if (e.button != null && e.button !== 0) return;   // 只响应左键/触摸
      // 20261105 修复「进度条无法拖动」：range 滑块（进度条/音量条）需要浏览器原生拖拽，
      //   绝不能 preventDefault，否则滑块按住后不跟手、进度跳不动。这里提前放行，让原生交互生效。
      if (e.target.closest('input[type="range"]')) return;
      // 20261105 修复「播放按钮点了没反应」：点按钮（播放/收起/控制键/缩放锚点）必须在
      //   e.preventDefault() 之前就提前放行——pointerdown 上 preventDefault 会吞掉后续 click 合成，
      //   导致按钮点击失效。所以把按钮/锚点判断提到 preventDefault 之前。
      if (e.target.closest('button')) return;
      if (e.target.closest('#bm-float-resize')) return;
      // 20261104 修复「拖动悬浮窗把图片拖走」：按下即阻止浏览器默认行为，
      //   这样图片（封面/头像）不会被原生 drag 抓起来拖出窗口，也不会被选中。
      e.preventDefault();
      const isDot = !!e.target.closest('.bm-float-dot');
      const isMini = !!e.target.closest('.bm-float-mini');
      const isCard = !!e.target.closest('.bm-float-card');
      // 20261104 用户修正：mini 二级悬浮窗的头像（.bm-mini-av）不作拖拽把手——按住头像不拖动整窗，
      //   头像只是展示（点击头像仍走 mini 整体点击展开到 card）。dot 圆点仍是拖拽把手。
      if (isMini && e.target.closest('.bm-mini-av')) return;
      // dot/mini 形态：整窗都是「点一下切换形态」区，按住并移动超阈值才拖拽
      if (isDot || isMini) {
        down = { px: e.clientX, py: e.clientY, pointerId: e.pointerId };
        thresholdMet = false;
        return;
      }
      // card 形态：封面图/头像区/歌词区/控制区不作为拖动把手，其余（头部条/信息文字区）直接拖
      if (isCard) {
        if (e.target.closest('.bm-float-cover') || e.target.closest('.bm-float-avatars') ||
            e.target.closest('.bm-float-lyric') || e.target.closest('.bm-float-ctrl') ||
            e.target.closest('.bm-float-progress')) return;
        startDrag(e.clientX, e.clientY);
      }
    };
    const onMove = (e) => {
      if (down && !thresholdMet) {
        const dx = e.clientX - down.px, dy = e.clientY - down.py;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          thresholdMet = true;
          startDrag(down.px, down.py);
          // 拖拽开始后，吞掉后续 click，避免松手时误触发展开
          fw._suppressClick = true;
        } else return;
      }
      applyMove(e.clientX, e.clientY);
    };
    const onEnd = (e) => {
      if (drag) {
        drag = null;
        fw.classList.remove('dragging');
        savePos();
      }
      if (down) {
        down = null;
        thresholdMet = false;
        // 拖拽结束后，短暂抑制 click（松手瞬间可能触发 click 展开）
        if (fw._suppressClick) { setTimeout(() => { fw._suppressClick = false; }, 0); }
      }
      _floatDragging = false;
    };

    fw.addEventListener('pointerdown', onDown);
    fw.addEventListener('pointermove', onMove);
    fw.addEventListener('pointerup', onEnd);
    fw.addEventListener('pointercancel', onEnd);
  }

  /* 20261104：三级悬浮窗缩放——右下角锚点拖拽，用 zoom 让「内容整体等比缩放」（歌名/歌词/按钮一起变）。
     初始（zoom=1，card 基准 280px 宽）即最大状态，只能缩小不能放大（zoom 0.45~1）。
     独立于拖拽逻辑（锚点自身 stopPropagation）。缩放比例持久化 bmFloatZoom。 */
  function enableFloatResize(fw) {
    if (fw.__bmResizeBound) return;
    fw.__bmResizeBound = true;
    let rs = null;
    const card = () => fw.querySelector('#bm-float-card');
    const BASE_W = 280; // card CSS 基准宽度，zoom=1 时即 280px
    const applyZoom = (z) => {
      const c = card();
      if (!c) return;
      c.style.zoom = String(z);
      c.style.width = '';       // 交给 zoom 缩放，不写死 width
      c.style.minHeight = '';   // 高度也随内容 + zoom 自然缩放
    };
    // 恢复上次缩放（未缩放过则用默认 zoom=1，不覆盖）
    try {
      const saved = parseFloat(localStorage.getItem('bmFloatZoom') || '1');
      if (isFinite(saved) && saved >= 0.45 && saved <= 1) applyZoom(saved);
    } catch (e) {}

    const onDown = (e) => {
      const anchor = e.target.closest('#bm-float-resize');
      if (!anchor) return;
      e.preventDefault();
      e.stopPropagation();       // 阻止冒泡到容器拖拽/点击
      const c = card();
      const r = c ? c.getBoundingClientRect() : fw.getBoundingClientRect();
      const curZoom = c && c.style.zoom ? parseFloat(c.style.zoom) || 1 : 1;
      rs = { px: e.clientX, py: e.clientY, w: r.width, h: r.height, zoom: curZoom };
      fw.setPointerCapture && fw.setPointerCapture(e.pointerId);
      _floatDragging = true;
      fw.classList.add('resizing');
    };
    const onMove = (e) => {
      if (!rs) return;
      // 以「宽度」为主轴计算缩放：目标宽 = 起始宽 + 横向位移，比例 = 目标宽 / 起始宽
      const dw = e.clientX - rs.px;
      const targetW = rs.w + dw;
      let z = targetW / (rs.w / rs.zoom);
      z = Math.max(0.45, Math.min(1, z));
      applyZoom(z);
    };
    const onEnd = () => {
      if (!rs) return;
      rs = null;
      _floatDragging = false;
      fw.classList.remove('resizing');
      try {
        const c = card();
        const z = c && c.style.zoom ? parseFloat(c.style.zoom) || 1 : 1;
        localStorage.setItem('bmFloatZoom', String(z));
      } catch (e) {}
    };
    fw.addEventListener('pointerdown', onDown);
    fw.addEventListener('pointermove', onMove);
    fw.addEventListener('pointerup', onEnd);
    fw.addEventListener('pointercancel', onEnd);
  }

  // 20261104：开屏动画结束后，让「开屏后才出现」的音乐悬浮窗此刻上场。
  // 注意：end() 派发事件时开屏 canvas 尚未移除（延迟到触摸序列结束才删），
  // 所以这里不能拿 canvas 存在与否作判断——直接调 renderFloat，
  // renderFloat 内部已用 __bmSplashEndAt 是否打点来判开屏是否结束（end 里已先打点）。
  window.addEventListener('bm-splash-end', () => {
    renderFloat();
  });

  /* ---------- 方案A：把网易云直连函数注入到闭包1（修跨闭包 ReferenceError） ----------
     20261106：fetchSongDetail/_netEaseLyric 在闭包1，_netEaseSongUrl/_netEaseReq 在闭包2，
     跨闭包调用崩。这里初始化即注入，闭包1 经代理调用。 */
  M.setNeteaseBridge({
    _netEaseReq,
    _netEaseSongUrl,
    _netEaseSearch,
    _netEaseMyPlaylists,
    _netEasePlaylistTracks,
    _netEaseLoggedIn,
  });

  // 20261106 启动初始化：异步加载 _netEaseDirect，若当前已是「后台遥控」模式，
  //   立即启动「真实态」心跳（否则重进 App 后 remote 模式悬浮窗/图标不随外部更新）。
  (async () => {
    try {
      await _netEaseLoadDirect();
      if (M.state.mode === 'remote') { _startLiveExternalHeartbeat(); _refreshLiveExternal(true); }
    } catch (e) {}
  })();

  return { showMusicPage, refreshPlayerUI, renderFloat, closeMusicPage, backMusicPage, showMusicLib, showThemePicker, resetFloatClosed, showInviteCard, startTogether, endTogether, charAutoMusic, charInviteTogether, charPeekPlaylist, charEarListen, charCollect, getTogetherTotal, setFloatScopeAndApply };
})();

/* app.js 引用的全局入口 */
function showMusicPage(charId) { window.bmMusicUI.showMusicPage(charId); }
function showInviteCard(charId) { window.bmMusicUI.showInviteCard(charId); }
function showVideoPlaceholder() { miniToast('视频功能下一轮开发，敬请期待'); }
