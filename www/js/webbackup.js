/* ============================================================
   《白日梦》网页端自动备份（webbackup.js）
   ------------------------------------------------------------
   设计约束（2026-11-20 与玩家逐条确认）：
   · 只服务网页端。APK 端存在 Capacitor Filesystem → 本文件启动即退出，一行不生效。
   · 不改动任何现有函数：备份数据组装、图片抽离、容器打包、导入链路全部「只调用」。
   · 不写主数据库。备份本身落到浏览器源私有文件系统（OPFS），
     备份状态只存 localStorage，导出容器里不会多出任何字段。
   · 不新增常驻高频定时器：只在「切后台 / 回到前台 / 冷启动 / 每 5 分钟轻量巡检」四个点动。
   · 恢复才写主数据，且必须玩家点击 + 二次确认，走现有 doImport（不改它）。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 0. 环境判定：APK 端直接退出 ----------
     四重判定，任一命中即认定是原生 App：
       ① Capacitor 自报原生平台（isNativePlatform / isNative / getPlatform）
       ② Capacitor 的 Filesystem 插件已注册（app.js 里 FS 的同一判据）
       ③ Android 原生桥 androidBridge
       ④ iOS 原生桥 webkit.messageHandlers.bridge
     之所以不用单一判据：脚本可能比 Capacitor 的桥更早执行，那时 Plugins 还是空的。
     因此这里判一次，boot 里再判一次（boot 在 DOMContentLoaded，桥一定已注入）。 */
  function isAppEnv() {
    try {
      const C = window.Capacitor;
      if (C) {
        if (typeof C.isNativePlatform === 'function' && C.isNativePlatform()) return true;
        if (C.isNative === true) return true;
        if (typeof C.getPlatform === 'function') {
          const p = C.getPlatform();
          if (p === 'android' || p === 'ios') return true;
        }
        if (C.Plugins && C.Plugins.Filesystem) return true;
      }
      if (window.androidBridge) return true;
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge) return true;
    } catch (e) {}
    return false;
  }

  if (isAppEnv()) return;
  if (window.__bmWebBackup) return; // 防重复加载

  /* ---------- 1. 常量 ---------- */
  const DIR_NAME = 'bm-web-backups';
  const BEFORE_DIR = '_before-restore';
  const INDEX_NAME = 'webbackup-index.json';
  const LS = {
    enabled: 'wb_enabled',
    fp: 'wb_fingerprint',
    pending: 'wb_pending',
    coveredSlot: 'wb_covered_slot',
    lastSig: 'wb_last_sig',
    lastAt: 'wb_last_at',
    lastRestore: 'wb_last_restore',
    dest: 'wb_dest',            // 'opfs'（浏览器内部，默认）| 'folder'（指定文件夹）
    folderName: 'wb_folder_name',
  };
  const KEEP_MAX = 10;          // 最多保留份数（与 App 端一致）
  const KEEP_DAYS = 1;          // 每天最多一份
  const UNDO_DAYS = 7;          // 撤销点保留 7 天（玩家定）
  const NAME_RE = /^白日梦网页备份_\d{8}-\d{4}\.ocdata$/;
  const BEFORE_RE = /^恢复前_\d{8}-\d{4}\.ocdata$/;

  const WB = window.__bmWebBackup = { version: '1.0', ready: false };

  /* ---------- 2. 小工具 ---------- */
  const pad2 = n => String(n).padStart(2, '0');
  function stampOf(d) {
    d = d || new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  }
  function lsGet(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function lsJson(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }

  function fmtTime(ts) {
    const d = new Date(ts || 0);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function fmtBytes(n) {
    n = n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function toast(msg) {
    try { if (typeof miniToast === 'function') miniToast(msg); } catch (e) {}
  }

  /* OPFS 根目录（不可用返回 null） */
  async function opfsRoot() {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) return null;
      return await navigator.storage.getDirectory();
    } catch (e) { return null; }
  }
  async function opfsDir(name, create) {
    const root = await opfsRoot();
    if (!root) return null;
    try { return await root.getDirectoryHandle(name, { create: !!create }); } catch (e) { return null; }
  }

  /* ---------- 2.5 存放位置：浏览器内部 / 指定文件夹 ----------
     A 浏览器内部（默认）：OPFS 私有目录，零操作，但和聊天数据同生共死。
     B 指定文件夹：玩家自己选一个目录，文件落在站点之外，清站点数据也能救回来。
     两种目录对象是同一套 API（FileSystemDirectoryHandle），所以上层写入逻辑完全共用。 */
  const META_DB = 'bm_webbackup_meta';   // 独立小库，只放文件夹句柄；绝不碰主库 bairimeng
  const META_STORE = 'kv';
  let _metaDB = null;
  function metaOpen() {
    if (_metaDB) return Promise.resolve(_metaDB);
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(META_DB, 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        try { if (!req.result.objectStoreNames.contains(META_STORE)) req.result.createObjectStore(META_STORE); } catch (e) {}
      };
      req.onsuccess = () => { _metaDB = req.result; resolve(_metaDB); };
      req.onerror = () => reject(req.error);
    });
  }
  async function metaGet(key) {
    try {
      const db = await metaOpen();
      return await new Promise((res, rej) => {
        const tx = db.transaction(META_STORE, 'readonly');
        const r = tx.objectStore(META_STORE).get(key);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
    } catch (e) { return null; }
  }
  async function metaSet(key, val) {
    try {
      const db = await metaOpen();
      return await new Promise((res, rej) => {
        const tx = db.transaction(META_STORE, 'readwrite');
        tx.objectStore(META_STORE).put(val, key);
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { return false; }
  }

  let _dirHandle = null;   // 指定文件夹的句柄（内存缓存）
  const hasPicker = () => typeof window.showDirectoryPicker === 'function';
  const destMode = () => (lsGet(LS.dest, 'opfs') === 'folder' ? 'folder' : 'opfs');

  function permOf(h) {
    return new Promise((resolve) => {
      try {
        if (!h || !h.queryPermission) return resolve('granted');
        Promise.resolve(h.queryPermission({ mode: 'readwrite' })).then(v => resolve(v || 'prompt')).catch(() => resolve('denied'));
      } catch (e) { resolve('denied'); }
    });
  }
  /* requestPermission 必须在用户点击的同一轮事件里调用，所以只从按钮里调 */
  function requestPermOf(h) {
    return new Promise((resolve) => {
      try {
        if (!h || !h.requestPermission) return resolve('granted');
        Promise.resolve(h.requestPermission({ mode: 'readwrite' })).then(v => resolve(v || 'denied')).catch(() => resolve('denied'));
      } catch (e) { resolve('denied'); }
    });
  }

  async function loadFolderHandle() {
    if (_dirHandle) return _dirHandle;
    const h = await metaGet('dirHandle');
    if (h && h.kind === 'directory') _dirHandle = h;
    if (h && !lsGet(LS.folderName, '')) lsSet(LS.folderName, h.name || '');
    return _dirHandle;
  }
  async function saveFolderHandle(h) {
    _dirHandle = h || null;
    if (h) {
      await metaSet('dirHandle', h);
      lsSet(LS.folderName, h.name || '');
    } else {
      await metaSet('dirHandle', null);
      lsDel(LS.folderName);
    }
  }

  /* 当前实际可写的目录。folder 模式拿不到就返回 null（上层据此报「需要授权」） */
  async function activeDir(create) {
    if (destMode() === 'folder') {
      const h = await loadFolderHandle();
      if (!h) return null;
      const p = await permOf(h);
      if (p !== 'granted') return null;
      return h;
    }
    return opfsDir(DIR_NAME, create);
  }

  /* 选文件夹（必须由点击触发） */
  async function chooseFolder(onDone) {
    if (!hasPicker()) { toast('当前浏览器不支持选择文件夹，请改用浏览器内部'); return false; }
    let h;
    try {
      h = await window.showDirectoryPicker({ id: 'bm-web-backups', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      if (e && e.name === 'AbortError') return false; // 玩家自己取消
      toast('选择文件夹失败：' + (e && e.message ? e.message : e));
      return false;
    }
    if (!h) return false;
    // 同一轮事件里申请读写权限
    const p = await requestPermOf(h);
    if (p !== 'granted') { toast('没有拿到文件夹写入权限'); return false; }
    await saveFolderHandle(h);
    lsSet(LS.dest, 'folder');
    lsSet(LS.coveredSlot, '-1');   // 位置变了，记账清零，到新位置立刻补一份
    if (onDone) onDone();
    return true;
  }

  /* 换回浏览器内部 */
  function useInternal() {
    /* 备份写到一半就换位置，会让「刚备份的那份」留在旧目录、当前目录看不到。
       不拦死，但要等这次写完。 */
    if (_running) { toast('正在备份中，请稍后再切换'); return false; }
    lsSet(LS.dest, 'opfs');
    lsSet(LS.coveredSlot, '-1');
    return true;
  }

  /* 把浏览器内部已有的备份复制到刚选的文件夹（一次性搬运，源文件保留） */
  async function copyInternalToFolder(onStage) {
    const src = await opfsDir(DIR_NAME, false);
    const dst = await activeDir(true);
    if (!src || !dst) return { ok: false, copied: 0 };
    if (destMode() !== 'folder') return { ok: false, copied: 0 };
    let copied = 0;
    try {
      for await (const [name, h] of src.entries()) {
        if (h.kind !== 'file' || !NAME_RE.test(name)) continue;
        try {
          const f = await (await h).getFile();
          const fh = await dst.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(await f.arrayBuffer());
          await w.close();
          copied++;
          if (onStage) { try { onStage('复制 ' + copied + '…'); } catch (e) {} }
        } catch (e) {}
      }
      // 撤销点一起搬
      try {
        const sb = await src.getDirectoryHandle(BEFORE_DIR, { create: false });
        const db = await dst.getDirectoryHandle(BEFORE_DIR, { create: true });
        for await (const [name, h] of sb.entries()) {
          if (h.kind !== 'file' || !BEFORE_RE.test(name)) continue;
          try {
            const f = await (await h).getFile();
            const fh = await db.getFileHandle(name, { create: true });
            const w = await fh.createWritable();
            await w.write(await f.arrayBuffer());
            await w.close();
          } catch (e) {}
        }
      } catch (e) {}
      // 索引也搬：两边合并（以文件夹现有索引为准，缺的补进来）
      const srcIdx = await (async () => { try { const fh = await src.getFileHandle(INDEX_NAME); return JSON.parse(await (await fh.getFile()).text()); } catch (e) { return null; } })();
      if (srcIdx && Array.isArray(srcIdx.items) && srcIdx.items.length) {
        const dstIdx = await readIndex();
        const have = new Set((dstIdx.items || []).map(x => x.file));
        for (const it of srcIdx.items) if (it && it.file && !have.has(it.file)) dstIdx.items.push(it);
        dstIdx.items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        await writeIndex(dstIdx);
      }
    } catch (e) {}
    return { ok: true, copied };
  }

  /* ---------- 3. 持久化申请（基础层） ---------- */
  async function ensurePersist() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return { supported: false, granted: false };
      let granted = false;
      try { granted = await navigator.storage.persisted(); } catch (e) {}
      if (!granted) { try { granted = await navigator.storage.persist(); } catch (e) {} }
      return { supported: true, granted: !!granted };
    } catch (e) { return { supported: false, granted: false }; }
  }

  /* ---------- 4. 数据指纹（基础层） ----------
     只读统计：角色数 / 消息数 / 最后一条消息时间。消息用现有内存缓存，不重复全量读盘。 */
  async function readCounts() {
    try {
      const chars = await idbGetAll('characters');
      const msgs = await idbGetAll('messages');
      let maxT = 0;
      for (let i = 0; i < msgs.length; i++) { const t = msgs[i] && msgs[i].time; if (t > maxT) maxT = t; }
      return { charCount: chars.length, msgCount: msgs.length, lastMsgTime: maxT };
    } catch (e) {
      return null;
    }
  }

  async function updateFingerprint(force) {
    const c = await readCounts();
    if (!c) return null;
    let old = lsJson(LS.fp, null);
    /* localStorage 的指纹可能被一起清掉了，这时备份索引里那份才是「上次的规模」 */
    if (!old) {
      try { const idx = await readIndex(); if (idx && idx.fp && idx.fp.charCount) old = idx.fp; } catch (e) {}
    }
    /* 关键：如果原本有角色、现在读到 0，很可能是「库读不进来 / 被清空」，
       此时不要用 0 覆盖指纹，否则下一次启动就再也判断不出异常。 */
    if (!force && old && old.charCount > 0 && c.charCount === 0) {
      return { ...old, suspiciousAt: Date.now(), current: c };
    }
    const fp = {
      charCount: c.charCount, msgCount: c.msgCount, lastMsgTime: c.lastMsgTime,
      dbVersion: (typeof DB_VERSION !== 'undefined' ? DB_VERSION : 0),
      updatedAt: Date.now(),
    };
    lsSet(LS.fp, JSON.stringify(fp));
    return { ...fp, current: c };
  }

  /* ---------- 5. 时段与调度 ---------- */
  function slotIndex(ts) {
    // 直接复用 App 端同一套算法（只调用，不改）
    try { if (typeof bmSlotIndex === 'function') return bmSlotIndex(ts); } catch (e) {}
    const d = new Date(typeof ts === 'number' ? ts : Date.now());
    const h = d.getHours();
    let seg = 0;
    if (h >= 6 && h < 11) seg = 1; else if (h >= 11 && h < 14) seg = 2;
    else if (h >= 14 && h < 17) seg = 3; else if (h >= 17 && h < 20) seg = 4;
    else if (h >= 20) seg = 5;
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) * 6 + seg;
  }

  function enabled() { return lsGet(LS.enabled, '1') !== '0'; }

  /* ---------- 6. 索引读写 ---------- */
  async function readIndex() {
    const dir = await activeDir(false);
    if (!dir) return { v: 1, items: [] };
    try {
      const fh = await dir.getFileHandle(INDEX_NAME, { create: false });
      const f = await fh.getFile();
      const txt = await f.text();
      const o = JSON.parse(txt);
      if (o && Array.isArray(o.items)) return o;
    } catch (e) {}
    return { v: 1, items: [] };
  }
  async function writeIndex(idx) {
    const dir = await activeDir(true);
    if (!dir) return false;
    try {
      const fh = await dir.getFileHandle(INDEX_NAME, { create: true });
      const w = await fh.createWritable();
      await w.write(new Blob([JSON.stringify(idx)], { type: 'application/json' }));
      await w.close();
      return true;
    } catch (e) { return false; }
  }

  /* 目录与索引对齐：索引丢了/被删了就从文件名重建；文件被删了就从索引里剔除。
     这是「自动查找备份」的核心——玩家只要把文件夹指过来，目录里有什么就能看见什么。 */
  async function reconcileIndexFromDir(dir) {
    let idx;
    try { idx = await readIndex(); } catch (e) { idx = { v: 1, items: [] }; }
    const files = new Map();
    try {
      for await (const [name, h] of dir.entries()) {
        if (!h || h.kind !== 'file' || !NAME_RE.test(name)) continue;
        let size = 0;
        try { size = (await h.getFile()).size; } catch (e) {}
        files.set(name, size);
      }
    } catch (e) { return idx; }
    const list = idx.items || [];
    const known = new Set(list.map(x => x && x.file).filter(Boolean));
    const kept = list.filter(it => it && it.file && files.has(it.file));
    let changed = kept.length !== list.length;
    for (const [name, size] of files) {
      if (known.has(name)) continue;
      const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
      const ts = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
      kept.push({ file: name, ts, charCount: 0, msgCount: 0, imgCount: 0, bytes: size, sig: '', rebuilt: true });
      changed = true;
    }
    kept.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const out = { v: 1, items: kept };
    if (changed) { try { await writeIndex(out); } catch (e) {} }
    return out;
  }

  /* ---------- 7. 写容器到当前目录 ----------
     复用现有导出链路的三个只读函数：
       buildBackupPayload → 全量数据（只读组装）
       collectImagesV4    → 图片抽离 + 去重（深拷贝，不改原数据）
       packContainerFile  → JSON 头 + offset 表（与 App 端同一格式）
     图片字节直接写原 Blob（不重新压缩，保真优先；GIF 动画帧原样保留）。 */
  async function buildContainerBlob(onStage) {
    const stage = (s) => { try { if (onStage) onStage(s); } catch (e) {} };
    stage('读取数据…');
    const rawData = await buildBackupPayload('3.0');
    stage('整理图片…');
    const { data, images } = await collectImagesV4(rawData);
    data.version = '2.2'; // 与 App 端一致：容器统一标 2.2，导入端靠分隔符识别
    stage('打包…');
    const head = packContainerFile(data, images);
    const headBytes = new TextEncoder().encode(head);
    let total = headBytes.byteLength;
    for (const im of images) total += (im.byteLen || 0);
    let lastMsgTime = 0;
    const msgs = data.messages || [];
    for (let i = 0; i < msgs.length; i++) { const t = msgs[i] && msgs[i].time; if (t > lastMsgTime) lastMsgTime = t; }
    return { headBytes, images, total, imgCount: images.length, lastMsgTime,
      charCount: (data.characters || []).length, msgCount: msgs.length };
  }

  async function writeContainer(dir, fileName, built, onStage) {
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    let written = 0;
    try {
      await w.write(built.headBytes);
      written += built.headBytes.byteLength;
      for (let i = 0; i < built.images.length; i++) {
        const im = built.images[i];
        const bytes = im.blob ? new Uint8Array(await im.blob.arrayBuffer()) : new Uint8Array(0);
        await w.write(bytes);
        written += bytes.byteLength;
        if (onStage && (i % 8 === 0 || i === built.images.length - 1)) {
          try { onStage('写入图片 ' + (i + 1) + '/' + built.images.length); } catch (e) {}
        }
      }
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch (e2) {}
      throw e;
    }
    // 体积校验：写入字节数与预估必须一致，不一致就当作失败（删掉半成品）
    let size = 0;
    try { const f = await fh.getFile(); size = f.size; } catch (e) {}
    if (size && Math.abs(size - written) > 1024) {
      throw new Error('写入校验失败（' + size + ' / ' + written + '）');
    }
    return size || written;
  }

  /* ---------- 8. 备份主流程 ---------- */
  let _running = false;
  let _lastRunAt = 0;
  /* 当前挂在设置页上的卡片宿主：备份在后台跑完时用它把「备份中…」状态同步回来。
     玩家退出设置页后备份不会中断，但回来时要能看到真实进度，不能一直显示可点的「立即备份」。 */
  let _mountedHost = null;

  async function backupNow(opts) {
    opts = opts || {};
    if (_running) return { ok: false, reason: 'busy' };
    if (!enabled() && !opts.force) return { ok: false, reason: 'disabled' };
    const dir = await activeDir(true);
    /* folder 模式拿不到目录 = 句柄没了或权限掉了，这时不要去写，也不要记 pending，
       等玩家在设置里点一下「重新授权」再继续。 */
    if (!dir) return { ok: false, reason: destMode() === 'folder' ? 'no-perm' : 'no-opfs' };

    // 标记必须在开始写之前同步落下：页面下一秒被冻结也能认出来
    lsSet(LS.pending, JSON.stringify({ at: Date.now(), slot: slotIndex(Date.now()) }));
    _running = true; _lastRunAt = Date.now();
    const t0 = performance.now();
    try {
      const built = await buildContainerBlob(opts.onStage);
      if (!built.charCount) { lsDel(LS.pending); return { ok: false, reason: 'empty' }; }

      const fname = '白日梦网页备份_' + stampOf(new Date()) + '.ocdata';
      const bytes = await writeContainer(dir, fname, built, opts.onStage);

      // 数据指纹（用于「同时段无变化就跳过」）：与 shouldBackup 用同一套口径
      const sig = [built.charCount, built.msgCount, built.lastMsgTime].join('|');

      // 索引 = 完成标记
      const idx = await readIndex();
      idx.v = 1;
      /* 指纹同时写进索引：万一站点数据被清、localStorage 一起没了，
         还能从备份目录的索引里读到「上次是什么规模」，健康检查不至于瞎。 */
      idx.fp = { charCount: built.charCount, msgCount: built.msgCount, lastMsgTime: built.lastMsgTime,
        dbVersion: (typeof DB_VERSION !== 'undefined' ? DB_VERSION : 0), updatedAt: Date.now() };
      idx.items = (idx.items || []).filter(x => x && x.file && x.file !== fname);
      idx.items.unshift({
        file: fname, ts: Date.now(), charCount: built.charCount, msgCount: built.msgCount,
        imgCount: built.imgCount, bytes, sig,
      });
      // 轮转：同一天只留最新一份；总数不超过 KEEP_MAX
      const dayKey = ts => { const d = new Date(ts || 0); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
      const sorted = idx.items.filter(x => x && x.file).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const keep = [], drop = [], seenDay = new Set();
      for (const it of sorted) {
        const dk = dayKey(it.ts);
        if (seenDay.has(dk)) { drop.push(it); continue; }
        seenDay.add(dk);
        if (keep.length >= KEEP_MAX) { drop.push(it); continue; }
        keep.push(it);
      }
      idx.items = keep;
      const idxOk = await writeIndex(idx);
      if (!idxOk) throw new Error('索引写入失败');

      // 索引成功后才算完成
      lsDel(LS.pending);
      lsSet(LS.coveredSlot, slotIndex(Date.now()));
      lsSet(LS.lastSig, sig);
      lsSet(LS.lastAt, Date.now());

      // 删轮转掉的旧文件（只删自己的命名规则）
      for (const it of drop) {
        if (!NAME_RE.test(String(it.file || ''))) continue;
        try { await dir.removeEntry(it.file); } catch (e) {}
      }
      /* 半成品清扫只在「浏览器内部」做。
         指定文件夹是玩家的目录，里面可能有他自己拷进来的备份（页面开着时拷进来、索引还没来得及收录），
         在这一层做「不在索引里的就删」会误伤玩家自己的文件。所以 folder 模式只删轮转掉的，不扫全目录。 */
      if (destMode() === 'opfs') {
        try {
          const keepSet = new Set(idx.items.map(x => x.file));
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind !== 'file') continue;
            if (name === INDEX_NAME) continue;
            if (NAME_RE.test(name) && !keepSet.has(name)) { try { await dir.removeEntry(name); } catch (e) {} }
          }
        } catch (e) {}
      }

      return { ok: true, file: fname, bytes, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      // 失败不打扰：保留 pending，下次补做
      try { lsSet('wb_last_error', String(e && e.message ? e.message : e).slice(0, 160)); } catch (e2) {}
      return { ok: false, reason: 'error', error: String(e && e.message ? e.message : e) };
    } finally {
      _running = false;
      /* 后台跑完（玩家可能早已退出设置页）：若卡片还挂着，把状态同步回来。
         不 await，避免拖慢备份返回；失败也不影响备份结果。 */
      try {
        if (_mountedHost && document.contains(_mountedHost)) refreshCard(_mountedHost).catch(() => {});
      } catch (e) {}
    }
  }

  /* 是否该备：开关 + 有角色 + 跨时段 + 指纹变化
     三条缺一不可：只看时段会在「玩家一整天没聊」时白写；只看指纹会在同一时段反复写。 */
  async function shouldBackup() {
    if (!enabled()) return false;
    const idx = await readIndex();
    if (!idx.items.length) {
      const c0 = await readCounts();
      return !!(c0 && c0.charCount > 0);
    }
    const covered = parseInt(lsGet(LS.coveredSlot, '-1'), 10);
    const cur = slotIndex(Date.now());
    if (!isNaN(covered) && covered >= 0 && cur <= covered) return false; // 本时段已覆盖
    const c = await readCounts();
    if (!c || !c.charCount) return false;
    const sig = [c.charCount, c.msgCount, c.lastMsgTime].join('|');
    const lastSig = lsGet(LS.lastSig, '');
    /* 数据一点没变：这次不写盘。
       注意：这里【不能】推进「本时段已覆盖」的记账 —— 一旦推进，本时段后面真的聊了内容，
       也会被「本时段已备过」挡住，那一整段话就永远等不到备份。
       记账只在真正写盘成功后才推进（见 backupNow）。 */
    if (lastSig && lastSig === sig) return false;
    return true;
  }

  /* 补备：发现 pending 就立刻做，不等下一次切后台 */
  async function catchUp(reason) {
    const p = lsJson(LS.pending, null);
    if (!p) return;
    if (_running) return;
    if (Date.now() - (p.at || 0) > 1000 * 60 * 30) { lsDel(LS.pending); return; } // 太旧，直接重来
    await backupNow({ force: true });
  }

  /* ---------- 9. 恢复 ---------- */
  async function getBackupFile(fileName) {
    const dir = await activeDir(false);
    if (!dir) return null;
    try {
      const fh = await dir.getFileHandle(fileName, { create: false });
      return await fh.getFile();
    } catch (e) { return null; }
  }

  /* 恢复前快照（撤销点）：写到独立子目录，只保留最近一份 */
  async function writeUndoPoint() {
    const main = await activeDir(true);
    if (!main) return null;
    let bdir;
    try { bdir = await main.getDirectoryHandle(BEFORE_DIR, { create: true }); } catch (e) { return null; }
    const built = await buildContainerBlob();
    if (!built.charCount) return null;
    const fname = '恢复前_' + stampOf(new Date()) + '.ocdata';
    // 先清掉旧撤销点（只留最近一份）
    try {
      for await (const [name, h] of bdir.entries()) {
        if (h.kind === 'file' && BEFORE_RE.test(name) && name !== fname) {
          try { await bdir.removeEntry(name); } catch (e) {}
        }
      }
    } catch (e) {}
    const bytes = await writeContainer(bdir, fname, built);
    return { file: fname, bytes, charCount: built.charCount, msgCount: built.msgCount, ts: Date.now() };
  }

  async function restoreFromFile(fileName, opts) {
    opts = opts || {};
    /* 备份正在读主库时不能恢复：恢复会往主库写，同时读会拿到半截数据，
       写出来的备份就是坏的。宁可让玩家等一下，也不要产出一份坏备份。 */
    if (_running) { toast('正在备份中，请等备份完成再恢复'); return false; }
    const f = await getBackupFile(fileName);
    if (!f) { toast('备份文件不存在'); return false; }

    // 撤销点（可在 opts.skipUndo 时跳过，例如「撤销」操作本身不再生成新的撤销点）
    let undo = null;
    let curEmpty = false;
    try { const cur = await readCounts(); curEmpty = !cur || !cur.charCount; } catch (e) {}
    /* 当前库本来就是空的（玩家数据丢了、或者全新装），根本没有东西可「撤销」，
       这时不该弹「无法创建快照，是否继续」——那会把「救回数据」这件事卡在一句吓人的提示上。 */
    if (!opts.skipUndo && !curEmpty) {
      try { undo = await writeUndoPoint(); } catch (e) { undo = null; }
      if (!undo) {
        const ok = await confirmAsync(
          '无法创建「恢复前」快照（可能是浏览器空间不足）。\n\n继续恢复将无法撤销这次操作。',
          '仍要继续', '取消');
        if (!ok) return false;
      }
    }

    // 解析容器：完全复用现有探测与流式读图
    let data, readImageV4 = null;
    try {
      const probed = await probeContainerHead(f);
      data = JSON.parse(probed.headStr);
      if (probed.sepFound) {
        const reader = bmCreateStreamReader(f, probed.containerStart);
        readImageV4 = async (offset, len, mime) => {
          const u8 = await reader.readAt(offset || 0, len || 0);
          if ((len || 0) > 0 && u8.byteLength === 0) throw new Error('empty-blob');
          return new Blob([u8], { type: mime || 'image/png' });
        };
      }
    } catch (e) {
      toast('备份文件解析失败：' + (e && e.message ? e.message : e));
      return false;
    }

    // 记录「上一次操作是恢复」，供重载后显示撤销入口
    lsSet(LS.lastRestore, JSON.stringify({
      at: Date.now(), from: fileName, undo: undo ? undo.file : '',
      charCount: undo ? undo.charCount : 0, msgCount: undo ? undo.msgCount : 0,
      restoredCharCount: (data.characters || []).length,
      restoredMsgCount: (data.messages || []).length,
    }));

    try {
      await doImport(data, 'overwrite', null, readImageV4);
    } catch (e) {
      toast('恢复失败：' + (e && e.message ? e.message : e));
      return false;
    }
    setTimeout(() => location.reload(), 600);
    return true;
  }

  async function undoLastRestore() {
    const r = lsJson(LS.lastRestore, null);
    if (!r || !r.undo) { toast('没有可撤销的恢复记录'); return false; }
    const dir = await activeDir(false);
    if (!dir) { toast('备份目录不可用'); return false; }
    let bdir;
    try { bdir = await dir.getDirectoryHandle(BEFORE_DIR, { create: false }); } catch (e) {}
    let f = null;
    if (bdir) { try { const fh = await bdir.getFileHandle(r.undo, { create: false }); f = await fh.getFile(); } catch (e) {} }
    if (!f) { toast('撤销点已失效（可能已过期）'); return false; }

    const ok = await confirmAsync(
      '撤销后会回到恢复前的状态：\n角色 ' + (r.charCount || 0) + ' · 消息 ' + (r.msgCount || 0) + '。\n\n恢复之后新产生的聊天记录会一并消失。',
      '确认撤销', '取消');
    if (!ok) return false;

    let data, readImageV4 = null;
    try {
      const probed = await probeContainerHead(f);
      data = JSON.parse(probed.headStr);
      if (probed.sepFound) {
        const reader = bmCreateStreamReader(f, probed.containerStart);
        readImageV4 = async (offset, len, mime) => {
          const u8 = await reader.readAt(offset || 0, len || 0);
          if (u8.byteLength === 0 && (len || 0) > 0) throw new Error('empty-blob');
          return new Blob([u8], { type: mime || 'image/png' });
        };
      }
    } catch (e) { toast('撤销点解析失败'); return false; }

    try { await doImport(data, 'overwrite', null, readImageV4); } catch (e) { toast('撤销失败：' + (e && e.message ? e.message : e)); return false; }
    // 撤销成功：删撤销点、清记录
    try { if (bdir) await bdir.removeEntry(r.undo); } catch (e) {}
    lsDel(LS.lastRestore);
    setTimeout(() => location.reload(), 600);
    return true;
  }

  /* ---------- 10. 健康检查 ---------- */
  async function healthCheck() {
    let old = lsJson(LS.fp, null);
    const c = await readCounts();
    if (!c) return { state: 'unknown' };
    /* localStorage 的指纹没了（站点数据被清、换了浏览器），退回读备份目录里的索引指纹 */
    if (!old) {
      try { const idx = await readIndex(); if (idx && idx.fp && idx.fp.charCount) old = idx.fp; } catch (e) {}
    }
    if (!old) { await updateFingerprint(true); return { state: 'fresh', c }; }
    if (old.charCount > 0 && c.charCount === 0) return { state: 'lost', old, c };
    if (old.msgCount > 50 && c.msgCount < old.msgCount * 0.8) return { state: 'partial', old, c };
    if (c.charCount > 0) await updateFingerprint(true);
    return { state: 'ok', old, c };
  }

  async function runHealthCheckUI() {
    const h = await healthCheck();
    if (h.state !== 'lost' && h.state !== 'partial') return;
    /* 24 小时只提醒一次：玩家点了「稍后再说」当天不再弹，但明天还会再提醒一次，
       不会因为点过一次就永久闭嘴（数据真丢了这件事必须一直能被看见）。 */
    const ack = parseInt(lsGet('wb_health_ack', '0'), 10);
    if (ack && Date.now() - ack < 86400000) return;
    /* 软件声明还没同意时，openModal 会抑制一切非声明弹窗（这是 App 的既有规则，不去动它）。
       此时不要硬弹，等玩家进到主界面再提示一次，避免「真丢数据却没人告诉他」。 */
    if (window.__bmNoticeGateDone !== true) {
      setTimeout(() => { runHealthCheckUI().catch(() => {}); }, 30000);
      return;
    }
    showHealthModal(h);
  }

  /* ---------- 11. 界面 ---------- */
  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
  const CARD_STYLE = 'border:1px solid var(--border);border-radius:14px;padding:14px 15px;margin:4px 0 12px;background:var(--bg-elevated-2);';

  function dot(active) {
    return `<span style="flex:0 0 auto;width:15px;height:15px;border-radius:50%;border:1.5px solid ${active ? 'var(--purple-soft,#b9a6e8)' : 'var(--border)'};display:inline-flex;align-items:center;justify-content:center;">
      ${active ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--purple-soft,#b9a6e8);"></span>' : ''}
    </span>`;
  }

  function renderCard(host) {
    if (!host) return;
    const idxCache = window.__wbIdxCache || { items: [] };
    const items = idxCache.items || [];
    const lastAt = parseInt(lsGet(LS.lastAt, '0'), 10);
    const persist = window.__wbPersist || { supported: false, granted: false };
    const totalBytes = items.reduce((s, x) => s + (x.bytes || 0), 0);
    const on = enabled();
    const mode = destMode();
    const perm = window.__wbFolderPerm || '';
    const fname = lsGet(LS.folderName, '');
    const pickerOk = hasPicker();

    /* 指定文件夹的状态行：说清现在能不能写 */
    let folderState = '';
    if (!pickerOk) {
      folderState = '<span style="color:var(--warning,#e0b072);">当前浏览器不支持选择文件夹（Safari / Firefox），只能用浏览器内部</span>';
    } else if (!fname) {
      folderState = '<span style="color:var(--text-tertiary);">还没有选文件夹</span>';
    } else if (perm === 'granted') {
      folderState = '<span style="color:var(--success,#8fc7a8);">已连接：' + escapeHtml(fname) + '</span>'
        + (mode === 'opfs' ? '<span style="color:var(--text-tertiary);">（当前未启用）</span>' : '');
    } else if (perm === '') {
      /* 句柄本身没了（浏览器重装、清了站点数据、或玩家把文件夹删了）——只能重新选一次 */
      folderState = '<span style="color:var(--warning,#e0b072);">连接已断开：' + escapeHtml(fname) + '（需要重新选一次文件夹）</span>';
    } else {
      folderState = '<span style="color:var(--warning,#e0b072);">需要点一下重新授权：' + escapeHtml(fname) + '</span>';
    }

    host.innerHTML = `
      <div style="${CARD_STYLE}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:14px;font-weight:600;color:var(--text);">网页自动备份</div>
          <label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-secondary);">
            <input type="checkbox" id="wb-enabled" ${on ? 'checked' : ''} style="width:16px;height:16px;">
            启用
          </label>
        </div>

        <div style="font-size:11.5px;color:var(--text-tertiary);letter-spacing:.4px;margin-bottom:7px;">存放位置</div>

        <div id="wb-opt-opfs" style="display:flex;gap:8px;align-items:flex-start;padding:9px 10px;border:1px solid ${mode === 'opfs' ? 'var(--purple-soft,#b9a6e8)' : 'var(--border)'};border-radius:11px;margin-bottom:7px;cursor:pointer;">
          <div style="padding-top:1px;">${dot(mode === 'opfs')}</div>
          <div style="min-width:0;flex:1;">
            <div style="font-size:12.5px;color:var(--text);">浏览器内部<span style="font-size:11px;color:var(--text-tertiary);">（默认）</span></div>
            <div style="font-size:11px;line-height:1.65;color:var(--text-tertiary);margin-top:2px;">零操作。但和聊天数据同生共死，清站点数据会一起没。</div>
          </div>
        </div>

        <div id="wb-opt-folder" style="display:flex;gap:8px;align-items:flex-start;padding:9px 10px;border:1px solid ${mode === 'folder' ? 'var(--purple-soft,#b9a6e8)' : 'var(--border)'};border-radius:11px;margin-bottom:9px;cursor:${pickerOk ? 'pointer' : 'not-allowed'};opacity:${pickerOk ? '1' : '.6'};">
          <div style="padding-top:1px;">${dot(mode === 'folder')}</div>
          <div style="min-width:0;flex:1;">
            <div style="font-size:12.5px;color:var(--text);">指定文件夹<span style="font-size:11px;color:var(--text-tertiary);">（更安全）</span></div>
            <div style="font-size:11px;line-height:1.65;color:var(--text-tertiary);margin-top:2px;">备份落在站点外面，清站点数据、重装浏览器都能救回来。首次要选一次文件夹。</div>
            <div id="wb-folder-state" style="font-size:11px;line-height:1.6;margin-top:5px;">${folderState}</div>
            <div id="wb-folder-btns" style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px;"></div>
          </div>
        </div>

        <div style="font-size:11.5px;line-height:1.8;color:var(--text-tertiary);margin-bottom:9px;">
          ${mode === 'opfs'
            ? (persist.supported
                ? (persist.granted ? '存储已受保护（浏览器不会因空间紧张清理）' : '存储未受保护（浏览器可能在空间紧张时清理）——换成指定文件夹更稳妥')
                : '当前浏览器不支持持久化申请')
            : '备份写在你自己选的文件夹里，浏览器不会清理它。'}
        </div>

        <div style="font-size:12px;color:var(--text-tertiary);line-height:1.9;margin-bottom:9px;">
          上次备份：${lastAt ? fmtTime(lastAt) : '还没有'}　·　共 ${items.length} 份　·　占用 ${fmtBytes(totalBytes)}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" id="wb-now" ${_running ? 'disabled' : ''} style="flex:1;min-width:96px;height:38px;padding:0;font-size:13px;${_running ? 'opacity:.6;' : ''}">${_running ? '备份中…' : '立即备份'}</button>
          <button class="btn" id="wb-list" style="flex:1;min-width:96px;height:38px;padding:0;font-size:13px;">恢复 / 查看</button>
        </div>
        <div id="wb-undo-row" style="display:none;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);font-size:12px;color:var(--text-secondary);">
          <div id="wb-undo-text" style="margin-bottom:8px;"></div>
          <button class="btn" id="wb-undo" style="width:100%;height:34px;padding:0;font-size:12.5px;">撤销上一次恢复</button>
        </div>
        <div id="wb-tip" style="display:none;margin-top:9px;font-size:11.5px;color:var(--text-tertiary);"></div>
      </div>`;

    const $ = s => host.querySelector(s);

    /* ---- 存放位置切换 ---- */
    const optOpfs = $('#wb-opt-opfs');
    const optFolder = $('#wb-opt-folder');
    if (optOpfs) optOpfs.onclick = () => {
      if (mode === 'opfs') return;
      if (!useInternal()) return; // 备份进行中，useInternal 已提示
      toast('已改为存在浏览器内部');
      refreshCard(host);
    };
    if (optFolder) optFolder.onclick = async () => {
      if (!pickerOk) { toast('当前浏览器不支持选择文件夹'); return; }
      if (mode === 'folder' && perm === 'granted') return;
      await doPickFolder(host);
    };

    /* ---- 文件夹相关按钮 ---- */
    const fb = $('#wb-folder-btns');
    if (fb && pickerOk) {
      if (!fname) {
        const b0 = el('<button class="btn" id="wb-pick" style="height:29px;padding:0 12px;font-size:11.5px;">选择文件夹</button>');
        b0.onclick = async () => { await doPickFolder(host); };
        fb.appendChild(b0);
      }
      if (perm === 'prompt' || perm === 'denied') {
        const b = el('<button class="btn" id="wb-reauth" style="height:29px;padding:0 12px;font-size:11.5px;">重新授权</button>');
        b.onclick = async () => {
          const h = await loadFolderHandle();
          if (!h) { toast('文件夹句柄已失效，请重新选择'); await doPickFolder(host); return; }
          const p = await requestPermOf(h);
          if (p === 'granted') { lsSet(LS.dest, 'folder'); toast('已重新授权'); }
          else toast('没有拿到权限');
          refreshCard(host);
        };
        fb.appendChild(b);
      }
      if (fname) {
        const b2 = el('<button class="btn" id="wb-repick" style="height:29px;padding:0 12px;font-size:11.5px;">换一个文件夹</button>');
        b2.onclick = async () => { await doPickFolder(host); };
        fb.appendChild(b2);
      }
      if (mode === 'folder' && perm === 'granted') {
        const b3 = el('<button class="btn" id="wb-copy" style="height:29px;padding:0 12px;font-size:11.5px;">把内部备份复制过来</button>');
        b3.onclick = async () => {
          b3.disabled = true; b3.textContent = '复制中…';
          const r = await copyInternalToFolder();
          b3.disabled = false; b3.textContent = '把内部备份复制过来';
          toast(r.copied ? ('已复制 ' + r.copied + ' 份') : '没有需要复制的备份');
          refreshCard(host);
        };
        fb.appendChild(b3);
      }
    }

    if ($('#wb-enabled')) $('#wb-enabled').onchange = () => {
      lsSet(LS.enabled, $('#wb-enabled').checked ? '1' : '0');
      toast($('#wb-enabled').checked ? '网页自动备份已开启' : '网页自动备份已关闭');
    };
    if ($('#wb-now')) $('#wb-now').onclick = async () => {
      const btn = $('#wb-now');
      btn.disabled = true; btn.textContent = '备份中…';
      const r = await backupNow({ force: true, onStage: (s) => { const t = $('#wb-tip'); if (t) { t.style.display = 'block'; t.textContent = s; } } });
      btn.disabled = false; btn.textContent = '立即备份';
      if (r.ok) { toast('已备份（' + fmtBytes(r.bytes) + '）'); }
      else if (r.reason === 'empty') { toast('当前没有任何数据，无需备份'); }
      else if (r.reason === 'busy') { toast('正在备份中，请稍等…'); }
      else if (r.reason === 'no-perm') { toast('文件夹没授权，请点「重新授权」'); }
      else { toast('备份失败：' + (r.error || r.reason)); }
      await refreshCard(host);
    };
    if ($('#wb-list')) $('#wb-list').onclick = () => showListModal(host);

    const r = lsJson(LS.lastRestore, null);
    if (r && r.undo) {
      const row = $('#wb-undo-row');
      const between = Date.now() - (r.at || 0);
      if (between < UNDO_DAYS * 86400000) {
        row.style.display = 'block';
        $('#wb-undo-text').textContent = '可撤销：' + fmtTime(r.at) + ' 的恢复（回到角色 ' + (r.charCount || 0) + ' · 消息 ' + (r.msgCount || 0) + '），可在 ' + UNDO_DAYS + ' 天内撤销。';
        $('#wb-undo').onclick = async () => { await undoLastRestore(); };
      } else {
        /* 过期：不隐藏、也不留死按钮，明确告诉玩家已经不能撤销 */
        row.style.display = 'block';
        $('#wb-undo-text').textContent = '撤销点已过期（' + fmtTime(r.at) + ' 的恢复，超过 ' + UNDO_DAYS + ' 天已自动清除）。';
        const b = $('#wb-undo');
        if (b) { b.disabled = true; b.style.opacity = '.45'; b.textContent = '不可撤销'; b.onclick = null; }
      }
    }
  }

  /* 选文件夹的统一入口：选完顺便把索引对齐、刷卡片 */
  async function doPickFolder(host) {
    /* 备份进行中换目录，这份备份会落在旧目录、当前目录看不到那份，容易误判成丢了。 */
    if (_running) { toast('正在备份中，请稍后再切换'); return; }
    const ok = await chooseFolder();
    if (!ok) { try { await refreshCard(host); } catch (e) {} return; }
    try {
      const d = await activeDir(false);
      if (d) await reconcileIndexFromDir(d);
    } catch (e) {}
    toast('已切换到指定文件夹');
    refreshCard(host);
  }

  async function refreshCard(host) {
    /* folder 模式刷新一次权限状态（只 query，不 request）。
       opfs 模式下也照查：这样「指定文件夹」那一行能如实显示「已连接但当前未启用」，而不是误报要重新授权。 */
    try {
      const h = await loadFolderHandle();
      window.__wbFolderPerm = h ? await permOf(h) : '';
    } catch (e) { window.__wbFolderPerm = ''; }
    try { window.__wbIdxCache = await readIndex(); } catch (e) { window.__wbIdxCache = { items: [] }; }
    try { window.__wbPersist = await ensurePersist(); } catch (e) {}
    renderCard(host);
  }

  function showListModal(host) {
    const items = (window.__wbIdxCache || {}).items || [];
    const mode = destMode();
    const perm = window.__wbFolderPerm || '';
    const where = mode === 'folder'
      ? (lsGet(LS.folderName, '') ? '指定文件夹「' + escapeHtml(lsGet(LS.folderName, '')) + '」' : '指定文件夹')
      : '浏览器内部';
    const blocked = mode === 'folder' && perm !== 'granted';

    const rows = items.length
      ? items.map(it => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;border:1px solid var(--border);border-radius:11px;margin-bottom:8px;background:var(--bg-elevated-2);">
          <div style="min-width:0;">
            <div style="font-size:13px;color:var(--text);">${fmtTime(it.ts)}</div>
            <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:3px;">角色 ${it.rebuilt ? '—' : (it.charCount || 0)} · 消息 ${it.rebuilt ? '—' : (it.msgCount || 0)} · 图片 ${it.rebuilt ? '—' : (it.imgCount || 0)} · ${fmtBytes(it.bytes)}</div>
          </div>
          <button class="btn" data-wb-restore="${it.file}" ${blocked ? 'disabled style="flex:0 0 auto;height:33px;padding:0 13px;font-size:12.5px;opacity:.45;"' : 'style="flex:0 0 auto;height:33px;padding:0 13px;font-size:12.5px;"'}>恢复</button>
        </div>`).join('')
      : '<div style="font-size:13px;color:var(--text-tertiary);text-align:center;padding:26px 0;">还没有备份</div>';

    openModal(`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:17px;font-weight:600;">网页自动备份</div>
        <button class="icon-btn" id="wb-list-close"><i data-icon="close" data-size="17"></i></button>
      </div>
      <div style="font-size:12px;color:var(--text-tertiary);line-height:1.8;margin-bottom:14px;">
        位置：${where}。选一份恢复到那个时间点，恢复前会自动存一份「恢复前」快照，七天内可以撤销。
        ${blocked ? '<br><span style="color:var(--warning,#e0b072);">文件夹还没授权，先回上一页点「重新授权」。</span>' : ''}
      </div>
      <div style="max-height:52vh;overflow-y:auto;">${rows}</div>
    `);
    const m = document.getElementById('modal-content');
    const close = m.querySelector('#wb-list-close');
    if (close) close.onclick = closeModal;
    m.querySelectorAll('[data-wb-restore]').forEach(b => {
      b.onclick = async () => {
        const file = b.getAttribute('data-wb-restore');
        const ok = await confirmAsync(
          '将恢复到 ' + file.replace(/^白日梦网页备份_|\.ocdata$/g, '') + ' 的状态。\n\n当前数据会被覆盖，恢复前会自动存一份快照（七天内可撤销）。',
          '恢复', '取消');
        if (!ok) return;
        closeModal();
        await restoreFromFile(file);
      };
    });
  }

  function showHealthModal(h) {
    const lost = h.state === 'lost';
    openModal(`
      <div style="text-align:center;padding:4px 0 2px;">
        <div style="font-size:34px;margin-bottom:10px;"><i data-icon="warning" data-size="32"></i></div>
        <div style="font-size:16px;font-weight:600;margin-bottom:10px;color:var(--text);">${lost ? '本地数据看起来不见了' : '聊天记录比上次少了很多'}</div>
        <div style="font-size:13px;line-height:1.9;color:var(--text-secondary);text-align:left;">
          上次打开时这里还有 <b style="color:var(--text);">${h.old.charCount} 个角色 / ${h.old.msgCount} 条消息</b>（${fmtTime(h.old.updatedAt)}）。<br>
          现在读到的是 <b style="color:var(--text);">${h.c.charCount} 个角色 / ${h.c.msgCount} 条消息</b>。<br><br>
          先不要新建角色。可能是浏览器换了入口、数据被清理，或版本不兼容。可以试试从备份恢复。
        </div>
        <div style="display:flex;gap:9px;margin-top:16px;">
          <button class="btn" id="wb-hc-later" style="flex:1;height:40px;padding:0;font-size:13px;">稍后再说</button>
          <button class="btn primary" id="wb-hc-go" style="flex:1;height:40px;padding:0;font-size:13px;">去看备份</button>
        </div>
      </div>
    `);
    const m = document.getElementById('modal-content');
    const later = m.querySelector('#wb-hc-later');
    const go = m.querySelector('#wb-hc-go');
    if (later) later.onclick = () => { try { lsSet('wb_health_ack', String(Date.now())); } catch (e) {} closeModal(); };
    if (go) go.onclick = () => { closeModal(); setTimeout(() => { try { showDataModal && showDataModal(); } catch (e) {} }, 200); };
  }

  /* ---------- 11.5 撤销点可用性与过期清理（7 天） ---------- */
  /* 判断「能不能撤销」只看文件是否真的还在；判断「要不要提示」看本地记录。
     两者分开，才不会出现点了按钮报错的死按钮。 */
  async function undoAvailable(r) {
    if (!r || !r.undo) return { ok: false, reason: 'none' };
    if (Date.now() - (r.at || 0) > UNDO_DAYS * 86400000) return { ok: false, reason: 'expired' };
    const dir = await activeDir(false);
    if (!dir) return { ok: false, reason: 'nodir' };
    let bdir = null;
    try { bdir = await dir.getDirectoryHandle(BEFORE_DIR, { create: false }); } catch (e) {}
    if (!bdir) return { ok: false, reason: 'missing' };
    try {
      const fh = await bdir.getFileHandle(r.undo, { create: false });
      const f = await fh.getFile();
      if (!f || !f.size) return { ok: false, reason: 'missing' };
      return { ok: true };
    } catch (e) { return { ok: false, reason: 'missing' }; }
  }

  /* 过期清理：撤销点超过 7 天就删，顺手把失效的本地记录也清掉 */
  async function purgeExpiredUndo() {
    const r = lsJson(LS.lastRestore, null);
    if (r && r.at && Date.now() - r.at > UNDO_DAYS * 86400000) lsDel(LS.lastRestore);
    const dir = await activeDir(false);
    if (!dir) return;
    let bdir = null;
    try { bdir = await dir.getDirectoryHandle(BEFORE_DIR, { create: false }); } catch (e) {}
    if (!bdir) return;
    try {
      for await (const [name, h] of bdir.entries()) {
        if (h.kind !== 'file' || !BEFORE_RE.test(name)) continue;
        // 文件名里的时间戳：恢复前_20261120-1458.ocdata
        const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
        if (!m) continue;
        const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
        if (Date.now() - t > UNDO_DAYS * 86400000) {
          try { await bdir.removeEntry(name); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  /* ---------- 11.6 首页提示条（恢复完一眼能看到，不自动消失） ---------- */
  function showUndoBanner(r) {
    if (document.getElementById('wb-undo-banner')) return;
    const bar = el(`
      <div id="wb-undo-banner" style="position:fixed;left:10px;right:10px;top:calc(env(safe-area-inset-top, 0px) + 10px);z-index:900;
        background:var(--bg-elevated-2);border:1px solid var(--border);border-radius:14px;padding:12px 13px;
        box-shadow:0 8px 26px rgba(0,0,0,.28);">
        <div style="font-size:12.5px;line-height:1.75;color:var(--text-secondary);margin-bottom:10px;">
          已恢复到 <b style="color:var(--text);">${fmtTime(r.at)}</b> 的备份（角色 ${r.restoredCharCount || 0} · 消息 ${r.restoredMsgCount || 0}）。<br>
          <span style="font-size:11.5px;color:var(--text-tertiary);">7 天内可以退回恢复之前的样子。</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" id="wb-banner-undo" style="flex:0 0 auto;height:34px;padding:0 14px;font-size:12.5px;">撤销这次恢复</button>
          <button class="btn" id="wb-banner-ok" style="flex:0 0 auto;height:34px;padding:0 14px;font-size:12.5px;">知道了</button>
        </div>
      </div>`);
    document.body.appendChild(bar);
    const off = () => { try { bar.remove(); } catch (e) {} };
    bar.querySelector('#wb-banner-undo').onclick = async () => { await undoLastRestore(); };
    bar.querySelector('#wb-banner-ok').onclick = () => { lsSet('wb_undo_ack', String(r.at || 0)); off(); };
  }

  async function maybeShowUndoBanner() {
    const r = lsJson(LS.lastRestore, null);
    if (!r || !r.undo) return;
    if (parseInt(lsGet('wb_undo_ack', '0'), 10) === (r.at || 0)) return; // 玩家已点「知道了」
    const av = await undoAvailable(r);
    if (!av.ok) return; // 已过期或文件不在：不显示入口，避免死按钮
    showUndoBanner(r);
  }

  /* ---------- 12. 启动与事件 ---------- */
  let _inited = false;
  async function boot() {
    if (_inited) return;
    /* 第二次环境判定：此刻 DOMContentLoaded，Capacitor 的桥必然已注入。
       若这里才发现是原生环境，什么副作用都不做（不挂卡片、不注册监听、不读库）。 */
    if (isAppEnv()) { window.__wbMount = null; return; }
    _inited = true;
    /* 目录准备：folder 模式先恢复句柄（只 query，不 request——request 必须由点击触发） */
    if (destMode() === 'folder') {
      try { await loadFolderHandle(); } catch (e) {}
      /* 零点击自动发现：权限还在就直接扫目录，索引丢了就从文件名重建 */
      try {
        const d = await activeDir(false);
        if (d) await reconcileIndexFromDir(d);
      } catch (e) {}
    } else {
      try { await opfsDir(DIR_NAME, true); } catch (e) {}
    }
    window.__wbPersist = await ensurePersist();
    try { window.__wbIdxCache = await readIndex(); } catch (e) {}

    // 冷启动补备：上次没写完 → 立刻补
    setTimeout(() => { catchUp('boot'); }, 2500);
    // 冷启动兜底：从没备过、或跨了时段且有变化 → 备一份
    setTimeout(async () => {
      try {
        if (!enabled()) return;
        if (await shouldBackup()) await backupNow({});
      } catch (e) {}
    }, 12000);
    // 健康检查（只读，不打扰除非异常）
    setTimeout(() => { runHealthCheckUI().catch(() => {}); }, 4000);
    // 首次指纹（不能 force：force 会在「数据刚被清空」时把旧指纹一起抹掉，
    // 那样健康检查就永远看不出异常了。这条 bug 是 20261120 真实数据包实测抓到的）
    setTimeout(() => { updateFingerprint(false).catch(() => {}); }, 6000);
    // 撤销点过期清理 + 恢复后的首页提示条（都排在渲染之后）
    setTimeout(() => { purgeExpiredUndo().then(maybeShowUndoBanner).catch(() => {}); }, 5000);

    // 前台轻量巡检：每 5 分钟，只读一个本地字段
    setInterval(() => {
      try {
        if (document.visibilityState !== 'visible') return;
        if (lsGet(LS.pending, '')) catchUp('tick');
      } catch (e) {}
    }, 300000);

    WB.ready = true;
  }

  /* 独立监听器：不碰现有 visibilitychange 处理函数。
     仅网页端注册（原生环境连监听器都不加，避免和 App 自己的后台逻辑并存）。 */
  if (!isAppEnv()) document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      /* 切后台：主力时机。先判「该不该备」（跨时段 + 指纹变化），再开始写。
         判据读的是内存里的消息缓存，很快；真正写盘才有 IO。 */
      try {
        if (!enabled() || _running || !WB.ready) return;
        shouldBackup().then(ok => { if (ok) backupNow({}); }).catch(() => {});
      } catch (e) {}
    } else {
      // 回到前台：补做没写完的
      setTimeout(() => { catchUp('visible'); }, 1500);
    }
  });

  /* 设置页挂载点：仅网页端暴露给 app.js（App 端 app.js 那一行因此永远空跑） */
  WB.mount = function (host) {
    if (!host || isAppEnv()) return;
    _mountedHost = host; // 记录宿主：后台备份跑完时把状态同步回这张卡
    renderCard(host);
    refreshCard(host);
  };
  if (!isAppEnv()) window.__wbMount = WB.mount;

  /* 对外暴露（诊断用，不含任何写操作） */
  WB.diag = function () {
    return {
      ready: WB.ready, enabled: enabled(), running: _running,
      pending: lsJson(LS.pending, null), lastAt: lsGet(LS.lastAt, '0'),
      fp: lsJson(LS.fp, null), persist: window.__wbPersist || null,
      dest: destMode(), folderName: lsGet(LS.folderName, ''), folderPerm: window.__wbFolderPerm || '',
      pickerSupported: hasPicker(),
    };
  };
  WB.backupNow = backupNow;
  WB.restoreFromFile = restoreFromFile;
  WB.undoLastRestore = undoLastRestore;
  WB.healthCheck = healthCheck;
  WB.shouldBackup = shouldBackup;
  WB.reconcile = async () => { const d = await activeDir(false); return d ? await reconcileIndexFromDir(d) : null; };
  /* 仅用于自动化测试：把一个已有目录句柄当作「已选文件夹」，避免依赖系统文件选择器 */
  WB._devUseDir = async function (h) {
    await saveFolderHandle(h);
    lsSet(LS.dest, 'folder');
    lsSet(LS.coveredSlot, '-1');
    const d = await activeDir(false);
    if (d) await reconcileIndexFromDir(d);
    return { dest: destMode(), perm: window.__wbFolderPerm };
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
