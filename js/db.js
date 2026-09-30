/* ============================================================
   《白日梦》- 数据层 (IndexedDB 封装)
   存储：角色、聊天记录、字卡库、设置
   ============================================================ */

const DB_NAME = 'bairimeng';
const DB_VERSION = 5; // 20260929ao：+1 新增 gifts store（超频礼物柜：收到的礼物+寄语，按送礼物的人索引）

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('characters')) {
        db.createObjectStore('characters', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const ms = db.createObjectStore('messages', { keyPath: 'id' });
        ms.createIndex('charId', 'charId', { unique: false });
        ms.createIndex('charId_time', ['charId', 'time'], { unique: false });
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('emojis')) {
        db.createObjectStore('emojis', { keyPath: 'id' }); // 表情包（5.10，上限300张）
      }
      if (!db.objectStoreNames.contains('palace')) {
        // 记忆宫殿条目（20260929w）：一段段记忆快照/手动上传，按文件夹索引
        const ps = db.createObjectStore('palace', { keyPath: 'id' });
        ps.createIndex('folderId', 'folderId', { unique: false });
      }
      if (!db.objectStoreNames.contains('surveys')) {
        // 问卷（20260929al）：一份问卷一条记录（问题列表/答案/排队状态），按角色索引
        const ss = db.createObjectStore('surveys', { keyPath: 'id' });
        ss.createIndex('charId', 'charId', { unique: false });
      }
      if (!db.objectStoreNames.contains('gifts')) {
        // 超频礼物柜（20260929ao）：收到的礼物 + 寄语，按送礼物的人（charId，项链=all）索引
        const gs = db.createObjectStore('gifts', { keyPath: 'id' });
        gs.createIndex('charId', 'charId', { unique: false });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

/* messages 只读缓存（Q3 性能优化）：
   idbGetAll('messages') 是最高频调用（聊天列表每次渲染、主页统计、书信记录等都全量读），
   消息一多反复反序列化开销明显。这里在内存维护一份镜像：
   - 首次 getAll 从库里加载，之后直接命中缓存（不再走 IO）；
   - put / delete / clear 同步维护缓存，保证与库里数据一字不差；
   - 只优化"计算方式"，数据本体不动——导出 / 导入 / 各功能读到的内容照旧。 */
let _messagesCache = null;

async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => {
      if (store === 'messages' && _messagesCache) {
        const i = _messagesCache.findIndex(m => m.id === value.id);
        if (i >= 0) _messagesCache[i] = value; else _messagesCache.push(value);
      }
      resolve();
    };
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => {
      if (store === 'messages' && _messagesCache) {
        _messagesCache = _messagesCache.filter(m => m.id !== key);
      }
      resolve();
    };
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function idbGetAll(store) {
  if (store === 'messages' && _messagesCache) return _messagesCache;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => {
      if (store === 'messages') _messagesCache = req.result;
      resolve(req.result);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbClear(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => {
      if (store === 'messages') _messagesCache = [];
      resolve();
    };
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* 按角色取聊天记录（分页） */
async function idbGetMessagesByChar(charId, limit = 100, offset = 0) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('charId_time');
    const range = IDBKeyRange.bound([charId, -Infinity], [charId, Infinity]);
    const req = index.openCursor(range, 'prev');
    const results = [];
    let skipped = 0;
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (skipped < offset) { skipped++; cursor.continue(); }
        else if (results.length < limit) { results.push(cursor.value); cursor.continue(); }
        else { resolve(results.reverse()); }
      } else {
        resolve(results.reverse());
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

/* ============================================================
   KV 设置读写（localStorage 兜底）
   ============================================================ */
async function getSetting(key, fallback) {
  try {
    const v = await idbGet('kv', key);
    return v !== undefined && v !== null ? v.value : fallback;
  } catch (e) {
    return fallback;
  }
}

async function setSetting(key, value) {
  try { await idbPut('kv', { key, value }); } catch (e) {}
}
