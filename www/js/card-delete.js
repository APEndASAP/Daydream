/* ============================================================
   card-delete.js —— 角色自主「往自己的禁词里加 / 从自己的禁词里放出来」
   （2026-11-22 第二版，玩家定案）
   ------------------------------------------------------------
   玩家定案的规则（V3，重要，别改错）：
     ① 「删字卡」**不是真删**，而是把这几张字卡**移进当前这个角色自己的禁词**
        （写 characters 里该角色的 c.banWords）。字卡本体原封不动留在字卡库里；
     ② 因为进了 TA 的禁词，这个角色以后抽字卡就抽不到这几张了；
     ③ 角色**也能反向操作**：把已经在禁词里、且是**自己当初移进去**的字卡放出来
        （从 c.banWords 移除，字卡重新可被抽取）。绝不碰玩家手动设的禁词；
     ④ 触发带两级投币（20261122 玩家要求）：
        先过概率，再 50% 真做 / 50% 这次不做 —— 「想过，又算了」；
     ⑤ 每次动作有每轮上限（20261123 玩家要求）：硬顶 30 张，角色默认申请 20~30 张；
        且「移进禁词」不再直接做 —— 先发一张**申请卡**，玩家可以在卡上改条数，
        点「同意」才真的移（点「算了」就什么都不动）。放出去仍按随机数量，不受此上限影响；
     ⑥ 改完必须给玩家发清单卡片（进聊天流），点开能看明细（可勾选其中几条单独撤销）；
     ⑦ 字卡库里有「角色禁词」（玩家权限）：按角色分组、组内按原字卡分组再分一层，都可折叠；
        整行点击勾选、长按划选、全选、移出禁词、删除对应字卡；
        角色自主移进的记录保留 7 天（7 天后不再标「可撤销」，但词仍在、总览仍能看到）；
     ⑧ 聊天设置 → 主动 → 「允许角色自己添加禁词」开关控制本模块全部行为。
     ⑨ 禁词判定按**单句**（与字卡库去重同一标准：逐字完全相同，见 cards.js bmBanHit）。

   绝对不允许的数据串：
     · 只写 `characters` 里 **该 charId 那一个角色** 的 banWords；
     · 绝不写 `cards.customBanWords`（全局字卡禁词已停用，该字段只为老备份兼容保留）；
     · 每次操作都按 charId 重新取角色对象，不缓存跨角色引用。

   其它实现要点：
     · 日志落 kv（cardDeleteLog），记 action: 'add' | 'remove'，刷新后还能查/能撤；
     · 概率 4% × 50% ≈ 等效 2%（玩家要的 2% 观感）；同一角色 72 小时冷却（移进/移出共用）；
     · 群聊不触发；字卡总数 < 8 张不触发（移进侧）；
     · 投递走主项目同一条管道 deliverCharMessage，万一投递失败自动回滚，绝不「改了却不说」。
   ============================================================ */
(function () {
  'use strict';

  const CD_CHANCE = 0.04;                   // 基础概率 4%，再过 50% 投币 → 等效 2%
  const CD_COIN = 0.5;                      // 第二级投币：真做 / 这次算了
  const CD_COOLDOWN_MS = 72 * 3600 * 1000;  // 同一角色 72 小时内不再做（移进移出共用）
  const CD_MIN_TOTAL = 8;                   // 字卡总数少于这个数就别动了
  /* 20261123（玩家要求）：⑩ 每轮移进禁词有上限，硬顶 30 张；角色"先申请"一个条数，
     默认落在 20~30 之间（随机），玩家在申请卡上可以改，但改不出 1~30 这个范围。
     「加进来」和「放出去」共用同一个上限，避免一次动太多玩家来不及看。 */
  const CD_MAX_ROUND = 30;                  // 每轮硬上限（改这个值 = 全站上限）
  const CD_REQ_MIN = 20;                    // 角色申请时默认条数下界
  const CD_REQ_MAX = 30;                    // 角色申请时默认条数上界
  const CD_LOG_KEY = 'cardDeleteLog';       // kv 键
  const CD_LOG_MAX = 60;                    // 最多留 60 条记录
  const CD_WINDOW_DAYS = 7;                 // 角色自主移进的记录在字卡库保留 7 天
  const CD_LYRIC_GROUP_ID = 'grp_lyric_collect';  // music.js 一起听歌采集的歌词字卡分组（与其他字卡同权）

  /* 记录 id 必须绝对唯一：原写法只拼「毫秒时间戳 + 3 位随机」，同一毫秒内连记两条
     （两个角色先后触发、或开发者命令连点）会生成相同 id —— 按 id 撤销时就会撤销到
     别人的记录上，属于典型的「数据串」。这里额外加一个会话内自增序号，彻底避免碰撞。 */
  let cdSeq = 0;
  const cdUid = () => 'cd' + Date.now().toString(36) + (++cdSeq).toString(36) + Math.random().toString(36).slice(2, 5);
  const cdEsc = (s) => (typeof escapeHtml === 'function')
    ? escapeHtml(String(s == null ? '' : s))
    : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cdToast = (t) => { try { if (typeof miniToast === 'function') miniToast(t); } catch (e) {} };

  /* ---------- 字卡库 / 角色读写 ---------- */
  function cdStore() {
    try { return (typeof cards !== 'undefined' && cards) ? cards : null; } catch (e) { return null; }
  }

  /* 按 id 取角色 —— 每次现取，绝不缓存，避免串角色 */
  function cdChar(charId) {
    try {
      if (typeof characters === 'undefined' || !characters) return null;
      return characters.find((x) => x && x.id === charId) || null;
    } catch (e) { return null; }
  }

  /* 把所有字卡展开成「位置」清单。
     字卡库是纯字符串数组，没有独立 id —— 所以位置就是 (数组 + 下标)：
       customReplies          → { where:'pool' }
       customReplyGroups[i]   → { where:'group', gi:i, gid, gname } */
  function cdSlots() {
    const cs = cdStore();
    if (!cs) return [];
    const out = [];
    (cs.customReplies || []).forEach((t, i) => {
      if (typeof t === 'string' && t) out.push({ where: 'pool', index: i, text: t, gname: '未分组' });
    });
    (cs.customReplyGroups || []).forEach((g, gi) => {
      if (!g) return;
      /* 20261122：一起听歌采集的歌词字卡（music.js 的 grp_lyric_collect 分组）与其他字卡同构，
         同样参与「移进 / 移出 / 删除」，这里只是打个来源标记，供清单和总览标注。 */
      const isLyric = (g.src === 'lyric' || g.id === CD_LYRIC_GROUP_ID);
      (g.items || []).forEach((t, i) => {
        if (typeof t === 'string' && t) {
          out.push({
            where: 'group', gi: gi, gid: g.id || '', gname: g.name || '未命名分组',
            index: i, text: t, src: isLyric ? 'lyric' : '',
          });
        }
      });
    });
    return out;
  }

  /* 这个角色当前禁掉的全部文本（banWords + 各组勾选禁用），用于排除候选、判来源 */
  function cdBanTextSet(c) {
    const set = new Set();
    if (!c) return set;
    (c.banWords || []).forEach((b) => { if (b != null) set.add(String(b)); });
    try {
      Object.keys(c.bannedGroupItems || {}).forEach((gid) => {
        (c.bannedGroupItems[gid] || []).forEach((b) => { if (b != null) set.add(String(b)); });
      });
    } catch (e) {}
    return set;
  }

  /* 可作为「移进禁词」候选的字卡：排除已经在这个角色禁词里的（移了也没意义） */
  function cdCandidates(c) {
    const banned = cdBanTextSet(c);
    return cdSlots().filter((s) => !banned.has(String(s.text)));
  }

  /* 当前歌词采集分组里的全部原文 —— 用来给「老记录」（没有 src 字段的）补标来源 */
  function cdLyricTextSet() {
    const set = new Set();
    const cs = cdStore();
    if (!cs) return set;
    for (const g of (cs.customReplyGroups || [])) {
      if (!g || (g.src !== 'lyric' && g.id !== CD_LYRIC_GROUP_ID)) continue;
      (g.items || []).forEach((t) => { if (typeof t === 'string' && t) set.add(t); });
    }
    return set;
  }

  /* 可以从禁词里「放出来」的池：只看**角色自己当初移进**、且现在还在禁词里的条目 */
  function cdRemovable(c, log) {
    if (!c) return [];
    const now = cdBanTextSet(c);
    const lyricSet = cdLyricTextSet();
    const seen = new Set();
    const out = [];
    for (const rec of (log || [])) {
      if (!rec || rec.charId !== c.id || rec.action === 'remove') continue;
      for (const it of (rec.items || [])) {
        if (!it || (it.st && it.st !== 'banned')) continue;
        const t = String(it.text);
        if (!now.has(t) || seen.has(t)) continue;
        seen.add(t);
        out.push({
          text: t, where: it.where, gi: it.gi, gid: it.gid, gname: it.gname,
          src: it.src || (lyricSet.has(t) ? 'lyric' : ''),
          recId: rec.id, at: rec.at,
        });
      }
    }
    return out;
  }

  /* 数量不设上限：random² 偏小但能很多，1 ~ 池子全部
     20261123：仍然保留给「放出去」用（放出去不限轮次上限，玩家不会因此少东西）；
     「移进禁词」改走 cdClampN + 玩家在申请卡上改的数字。 */
  function cdPickCount(total) {
    if (total <= 0) return 0;
    const r = Math.random();
    return Math.min(total, 1 + Math.floor(r * r * total));
  }
  function cdPickRandom(arr, n) {
    const pool = arr.slice();
    const out = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
  }
  /* 条数收敛：1 ≤ n ≤ min(每轮硬上限, 候选池大小)。NaN / 空值走默认。 */
  function cdClampN(n, poolSize) {
    const cap = Math.min(CD_MAX_ROUND, Math.max(0, poolSize | 0));
    let v = parseInt(n, 10);
    if (!Number.isFinite(v)) v = CD_REQ_MIN;
    if (v < 1) v = 1;
    if (v > cap) v = cap;
    return cap > 0 ? v : 0;
  }
  function cdRandInt(a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  /* 文本 → 现在的字卡库位置（分组名）。一次建表，供总览分组用；
     825 条禁词逐条去 indexOf 也能跑，但每次开面板都扫一遍太浪费。 */
  function cdLocMap() {
    const cs = cdStore();
    const map = new Map();
    if (!cs) return map;
    (cs.customReplies || []).forEach((t) => {
      if (typeof t === 'string' && !map.has(t)) map.set(t, { where: 'pool', gid: '', gname: '未分组' });
    });
    (cs.customReplyGroups || []).forEach((g) => {
      if (!g) return;
      (g.items || []).forEach((t) => {
        if (typeof t === 'string' && !map.has(t)) {
          map.set(t, { where: 'group', gid: g.id || '', gname: g.name || '未命名分组' });
        }
      });
    });
    return map;
  }

  /* ---------- 日志（kv） ---------- */
  async function cdLogGet() {
    try {
      const v = await getSetting(CD_LOG_KEY, []);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  async function cdLogSave(arr) {
    try {
      const cut = arr.slice(0, CD_LOG_MAX);
      await setSetting(CD_LOG_KEY, cut);
      return cut;
    } catch (e) { return arr; }
  }

  /* 记录是否还在 7 天窗口内 */
  function cdAlive(rec) {
    if (!rec || !rec.at) return false;
    return (Date.now() - rec.at) < CD_WINDOW_DAYS * 24 * 3600 * 1000;
  }
  /* 这条记录里还有没有「仍被关在禁词里」的条目 */
  function cdHasLive(rec) {
    if (!rec || !cdAlive(rec)) return false;
    return (rec.items || []).some((it) => it && (!it.st || it.st === 'banned'));
  }
  /* 剩余天数（向上取整，用于清单上的「还剩 N 天」） */
  function cdDaysLeft(rec) {
    const ms = CD_WINDOW_DAYS * 24 * 3600 * 1000 - (Date.now() - (rec.at || 0));
    return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
  }
  function cdFmtTime(ts) {
    try {
      const d = new Date(ts);
      const p = (x) => String(x).padStart(2, '0');
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ''; }
  }

  /* ---------- 开关：聊天设置 → 主动 → 允许角色自己添加禁词 ---------- */
  function cdAllowed(c) {
    try {
      let st = null;
      if (typeof getCharChatSettings === 'function') st = getCharChatSettings(c);
      if (!st) st = (typeof chatSettings !== 'undefined') ? chatSettings : null;
      if (!st) return true;
      return st.allowSelfBan !== false;      // 默认允许；只有显式关掉才拦
    } catch (e) { return true; }
  }

  /* ---------- ① 移进该角色的禁词 ---------- */
  /* 只动 c.banWords（这个角色自己的禁词），返回带 added 标记的条目：
     added=false 表示这个字卡原文本来就在 TA 的禁词里（撤销时不能删掉玩家自己加的那条） */
  function cdBanAdd(c, slots) {
    if (!c) return [];
    if (!Array.isArray(c.banWords)) c.banWords = [];
    const out = [];
    for (const s of slots) {
      const existed = c.banWords.some((b) => b != null && String(b) === s.text);
      if (!existed) c.banWords.push(s.text);
      out.push({
        text: s.text,
        where: s.where,
        gi: s.gi,
        gid: s.gid,
        gname: s.gname,
        index: s.index,
        src: s.src || '',        // 'lyric' = 一起听歌采集来的歌词字卡
        added: !existed,
        st: 'banned',
      });
    }
    return out;
  }

  /* 从该角色的禁词里撤掉一条（banWords 与勾选禁用组都清，避免同一个词留在另一处继续生效） */
  function cdUnbanText(c, text) {
    if (!c) return false;
    let hit = false;
    const t = String(text);
    if (Array.isArray(c.banWords)) {
      for (let i = c.banWords.length - 1; i >= 0; i--) {
        if (c.banWords[i] != null && String(c.banWords[i]) === t) { c.banWords.splice(i, 1); hit = true; }
      }
    }
    try {
      Object.keys(c.bannedGroupItems || {}).forEach((gid) => {
        const arr = c.bannedGroupItems[gid];
        if (!Array.isArray(arr)) return;
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i] != null && String(arr[i]) === t) { arr.splice(i, 1); hit = true; }
        }
        if (!arr.length) delete c.bannedGroupItems[gid];
      });
    } catch (e) {}
    return hit;
  }

  /* 批量撤词（只撤「当初是我们加的」那些，玩家自己手输的同名词不动） */
  function cdBanRemove(c, items) {
    if (!c) return 0;
    let n = 0;
    for (const it of (items || [])) {
      if (!it || it.added === false) continue;
      if (cdUnbanText(c, it.text)) n++;
    }
    return n;
  }

  /* ---------- ② 彻底删除（玩家在总览里点「删除对应字卡」才走这里） ---------- */
  function cdHardDeleteText(text) {
    const cs = cdStore();
    if (!cs) return 0;
    const t = String(text);
    const k = (cs.customReplies || []).indexOf(t);
    if (k >= 0) { cs.customReplies.splice(k, 1); return 1; }
    for (const g of (cs.customReplyGroups || [])) {
      if (!g || !Array.isArray(g.items)) continue;
      const j = g.items.indexOf(t);
      if (j >= 0) { g.items.splice(j, 1); return 1; }
    }
    return 0;
  }

  /* ---------- 触发判定：由 generateCharReply 开头调用 ---------- */
  async function bmCardDeleteMaybe(charId) {
    try {
      if (typeof currentGroupId !== 'undefined' && currentGroupId) return null;   // 群聊不碰
      const c = cdChar(charId);
      if (!c) return null;
      if (!cdAllowed(c)) return null;                                             // 玩家关了开关

      const log = await cdLogGet();
      const last = log.find((r) => r && r.charId === charId);
      if (last && (Date.now() - (last.at || 0)) < CD_COOLDOWN_MS) return null;    // 冷却中（移进移出共用）

      const addPool = cdCandidates(c);
      const rmPool = cdRemovable(c, log);
      const canAdd = addPool.length >= CD_MIN_TOTAL;
      const canRm = rmPool.length > 0;
      if (!canAdd && !canRm) return null;

      if (Math.random() >= CD_CHANCE) return null;                                // 第一级：概率
      if (Math.random() >= CD_COIN) return null;                                  // 第二级：50% 算了

      /* 两边都能做 → 各一半；只有一边 → 做那一边 */
      let action;
      if (canAdd && canRm) action = (Math.random() < 0.5 ? 'add' : 'remove');
      else action = canAdd ? 'add' : 'remove';

      /* 20261123（玩家要求）：移进禁词不再「说都不说就动手」——先发一张申请卡，
         角色申请一个条数（20~30 之间），玩家在卡上可以改，点了同意才真的移。 */
      if (action === 'add') return await cdAskAdd(c, log, addPool);
      return await cdDoRemove(c, log, rmPool);
    } catch (e) {
      return null;
    }
  }

  /* ---------- ①' 申请：把「想收几张」先问玩家 ---------- */
  /* 只写一条 action:'ask' 的日志（st:'pending'），字卡库一个字都不动 —— 玩家没点同意之前，
     这些字卡照旧能被抽到，绝不存在「暗改了却说没改」的中间态。 */
  async function cdAskAdd(c, log0, pool) {
    if (!c || !c.id) return null;
    const cands = pool || cdCandidates(c);
    if (cands.length < CD_MIN_TOTAL) return null;
    const n = cdClampN(cdRandInt(CD_REQ_MIN, CD_REQ_MAX), cands.length);
    if (n < 1) return null;

    const log = log0 || (await cdLogGet());
    /* 同一个角色不该叠着好几张没人理的申请 —— 老的一律标成过期，只留最新这张 */
    for (const r of log) {
      if (r && r.charId === c.id && r.action === 'ask' && (!r.st || r.st === 'pending')) r.st = 'expired';
    }
    const rec = {
      id: cdUid(), charId: c.id, charName: c.name || '', at: Date.now(),
      action: 'ask', n: n, st: 'pending', poolTotal: cands.length,
    };
    const ok = await cdDeliver(c, { id: rec.id, action: 'ask', n: n, at: rec.at });
    if (!ok) return null;                       // 没送出去就当没申请
    await cdLogSave([rec].concat(log));
    return { type: 'carddelete_card', text: '' };
  }

  /* 玩家在申请卡上点「同意」→ 按改完的条数真做 */
  async function cdApproveAsk(recId, nWanted) {
    const log = await cdLogGet();
    const rec = log.find((r) => r && r.id === recId);
    if (!rec) return { ok: false, why: '这条申请已经找不到了' };
    if (rec.action !== 'ask') return { ok: false, why: '这不是一条申请' };
    if (rec.st && rec.st !== 'pending') return { ok: false, why: '这条申请已经处理过了' };
    const c = cdChar(rec.charId);
    if (!c) return { ok: false, why: '角色不在了' };

    const pool = cdCandidates(c);
    if (!pool.length) return { ok: false, why: '没有可以移进禁词的字卡了' };
    const n = cdClampN(nWanted, pool.length);

    rec.st = 'ok';
    rec.okAt = Date.now();
    rec.askedN = rec.n;
    rec.n = n;

    /* 注意：cdDoAdd 内部会用「最近一条在前」的写法把 add 记录并进同一个 log 数组并落库，
       所以成功之后**绝不能再写一次 log**（原来这里多写了一次，会把刚生成的清单记录冲掉，
       聊天里那张卡的 id 就变成孤儿）。失败时才需要回滚并落库。 */
    const r = await cdDoAdd(c, log, pool, n);
    if (!r) {
      rec.st = 'pending';                        // 失败 → 申请还挂着，玩家可以再点
      delete rec.okAt;
      delete rec.askedN;
      await cdLogSave(log);
      return { ok: false, why: '这次没做成（可能没发出去），再点一次试试' };
    }
    return { ok: true, n: n };
  }

  /* 玩家在申请卡上点「算了」→ 这条申请作废，什么都不改 */
  async function cdRejectAsk(recId) {
    const log = await cdLogGet();
    const rec = log.find((r) => r && r.id === recId);
    if (!rec) return { ok: false, why: '找不到了' };
    if (rec.action !== 'ask' || (rec.st && rec.st !== 'pending')) return { ok: false, why: '已经处理过了' };
    rec.st = 'rejected';
    rec.rejAt = Date.now();
    await cdLogSave(log);
    return { ok: true };
  }

  /* 投递一张清单卡片；失败返回 false，调用方负责回滚 */
  async function cdDeliver(c, payload) {
    try {
      if (typeof deliverCharMessage !== 'function') return false;
      const r = await deliverCharMessage(c, null, 'cardDelete', payload);
      return !!(r && r.persisted);
    } catch (e) { return false; }
  }

  /* ---------- 执行：移进禁词 ---------- */
  /* nWant：玩家在申请卡上确认的条数（不给就按老逻辑随机，最多次每轮上限） */
  async function cdDoAdd(c, log0, allSlots, nWant) {
    if (!c || !c.id) return null;
    const charId = c.id;
    const all = allSlots || cdCandidates(c);
    if (all.length < CD_MIN_TOTAL) return null;
    const log = log0 || (await cdLogGet());

    const want = cdClampN(
      (nWant == null) ? cdPickCount(all.length) : nWant,
      all.length
    );
    if (want < 1) return null;
    const picked = cdPickRandom(all, want);
    if (!picked.length) return null;

    const items = cdBanAdd(c, picked);
    if (!items.length) return null;
    try {
      if (typeof saveChar === 'function') await saveChar(c);
      else return null;
    } catch (e) {
      cdBanRemove(c, items);   // 落库失败 → 回到动手前
      return null;
    }

    const rec = { id: cdUid(), charId: charId, charName: c.name || '', at: Date.now(), action: 'add', items: items };
    const lyricN = items.filter((i) => i.added && i.src === 'lyric').length;
    const ok = await cdDeliver(c, { id: rec.id, action: 'add', n: items.length, at: rec.at, lyricN: lyricN });

    if (!ok) {
      /* 没送出去就等于没做：把词从禁词里撤掉，不给玩家留一个「字卡凭空抽不到」的坑 */
      cdBanRemove(c, items);
      try { if (typeof saveChar === 'function') await saveChar(c); } catch (e) {}
      return null;
    }

    await cdLogSave([rec].concat(log));
    return { type: 'carddelete_card', text: '' };
  }

  /* ---------- 执行：从禁词里放出来 ---------- */
  async function cdDoRemove(c, log0, rmPool) {
    if (!c || !c.id) return null;
    const charId = c.id;
    const log = log0 || (await cdLogGet());
    const pool = rmPool || cdRemovable(c, log);
    if (!pool.length) return null;

    const picked = cdPickRandom(pool, cdPickCount(pool.length));
    if (!picked.length) return null;

    const items = [];
    for (const s of picked) {
      if (cdUnbanText(c, s.text)) {
        items.push({ text: s.text, where: s.where, gi: s.gi, gid: s.gid, gname: s.gname, src: s.src || '', added: true, st: 'restored' });
      }
    }
    if (!items.length) return null;

    try {
      if (typeof saveChar === 'function') await saveChar(c);
      else return null;
    } catch (e) {
      /* 落库失败 → 把它们放回禁词 */
      for (const it of items) {
        if (!Array.isArray(c.banWords)) c.banWords = [];
        c.banWords.push(it.text);
      }
      return null;
    }

    const rec = { id: cdUid(), charId: charId, charName: c.name || '', at: Date.now(), action: 'remove', items: items };
    const lyricN = items.filter((i) => i.src === 'lyric').length;
    const ok = await cdDeliver(c, { id: rec.id, action: 'remove', n: items.length, at: rec.at, lyricN: lyricN });

    if (!ok) {
      for (const it of items) {
        if (!Array.isArray(c.banWords)) c.banWords = [];
        c.banWords.push(it.text);
      }
      try { if (typeof saveChar === 'function') await saveChar(c); } catch (e) {}
      return null;
    }

    /* 把当初「移进」那条记录里的对应条目标成已放回，避免总览里出现双份 */
    const texts = new Set(items.map((x) => String(x.text)));
    for (const r of log) {
      if (!r || r.charId !== charId || r.action === 'remove') continue;
      for (const it of (r.items || [])) {
        if (it && (!it.st || it.st === 'banned') && texts.has(String(it.text))) it.st = 'released';
      }
    }
    await cdLogSave([rec].concat(log));
    return { type: 'carddelete_card', text: '' };
  }

  /* 开发者命令用：无视概率与冷却，立刻演一次（玩家自己要看的） */
  async function bmCardDeleteDev(c, action) {
    if (!c || !c.id) return null;
    try {
      const log = await cdLogGet();
      const want = (action === 'remove') ? 'remove' : 'add';
      let r = null;
      if (want === 'add') {
        const pool = cdCandidates(c);
        if (pool.length < CD_MIN_TOTAL) {
          cdToast('字卡太少，没法移（至少要有 ' + CD_MIN_TOTAL + ' 张）');
          return null;
        }
        /* 20261123：跟真实链路保持一致 —— 开发者命令也只发申请卡，不直接动字卡 */
        r = await cdAskAdd(c, log, pool);
      } else {
        const pool = cdRemovable(c, log);
        if (!pool.length) { cdToast('TA 的禁词里没有自己能放出来的字卡'); return null; }
        r = await cdDoRemove(c, log, pool);
      }
      return r;
    } catch (e) { return null; }
  }

  /* ---------- 聊天流里的卡片 ---------- */
  function bmCardDeleteCardHtml(p) {
    const n = (p && p.n) || 0;
    const id = (p && p.id) || '';
    const act = (p && p.action) || 'add';
    const lyricN = (p && p.lyricN) || 0;

    /* 20261123：申请卡（玩家同意/改条数之后才会真移） */
    if (act === 'ask') {
      return '<div class="msg-card bm-cd-cc" data-cd-card="' + cdEsc(id) + '">' +
        '<span class="msg-card-tag">申请</span>' +
        '<div class="bm-cd-cc-t">想把 ' + n + ' 张字卡收进自己的禁词<span class="bm-cd-cc-arr">&#8250;</span></div>' +
        '<div class="bm-cd-cc-s">点开确认 · 条数你可以改（1~' + CD_MAX_ROUND + ' 张）</div>' +
        '</div>';
    }

    const isRm = act === 'remove';
    const tag = isRm ? '放出禁词' : '移进禁词';
    const head = isRm ? ('把 ' + n + ' 张字卡从禁词里放出来了') : ('把 ' + n + ' 张字卡移进了自己的禁词');
    let sub = isRm ? '这几张又能被 TA 抽到了，点开看看是哪几张' : ('点开看看是哪几张，' + CD_WINDOW_DAYS + ' 天内可以移出禁词');
    if (lyricN > 0) sub += '（其中 ' + lyricN + ' 张是一起听歌时采到的歌词）';
    return '<div class="msg-card bm-cd-cc" data-cd-card="' + cdEsc(id) + '">' +
      '<span class="msg-card-tag">' + cdEsc(tag) + '</span>' +
      '<div class="bm-cd-cc-t">' + cdEsc(head) + '<span class="bm-cd-cc-arr">&#8250;</span></div>' +
      '<div class="bm-cd-cc-s">' + cdEsc(sub) + '</div>' +
      '</div>';
  }

  /* 单行 HTML（清单里的一项）
     20261123：整行可点（不再只认左边小方块），方块改成纯装饰的 span，
     点击/长按划选统一由 cdBindPicker 接管，避免和原生 checkbox 抢事件。 */
  function cdRowHtml(it, key, opt) {
    const o = opt || {};
    const tag = it.where === 'pool' ? '未分组' : (it.gname || '分组');
    const lyricTag = (it.src === 'lyric')
      ? '<span class="bm-cd-lyric">歌词采集</span>'
      : '';
    const stTxt = it.st === 'deleted' ? '已彻底删除'
      : (it.st === 'undone' ? '已移出'
        : (it.st === 'released' ? '已放出' : ''));
    const dim = stTxt ? ' bm-cd-dim' : '';
    const pickable = !!(o.checkable && !stTxt);
    const box = pickable
      ? '<span class="bm-cd-box"></span>'
      : '<span class="bm-cd-box bm-cd-box-ph"></span>';
    return '<div class="bm-cd-row' + (pickable ? ' bm-cd-pickable' : '') + dim + '" data-cd-row="' + cdEsc(key) + '">' +
      box +
      '<div class="bm-cd-row-main">' +
      '<div class="bm-cd-row-g">' + cdEsc(tag) + lyricTag + (stTxt ? ' · ' + cdEsc(stTxt) : '') + '</div>' +
      '<div class="bm-cd-row-t">' + cdEsc(it.text) + '</div>' +
      '</div></div>';
  }

  /* ============================================================
     多选：整行点一下切换 + 长按 240ms 后划过多行一起选
     ------------------------------------------------------------
     · 点（没移动）→ 切换那一行，跟普通列表一样；
     · 按住不动 240ms → 进入「划选」，之后手指划过的行统一设成同一个状态；
     · 进入划选后临时拦住 touchmove，免得列表跟着滚（否则根本划不动）。
     玩家原话：「长按划过就选中的功能，你是想让我手指点死吗」。
     ============================================================ */
  let cdPainting = false;
  let cdGuardDone = false;
  function cdEnsureGuard() {
    if (cdGuardDone) return;
    cdGuardDone = true;
    document.addEventListener('touchmove', (ev) => { if (cdPainting) ev.preventDefault(); }, { passive: false });
  }

  function cdBindPicker(root, sel, onChange) {
    if (!root) return;
    cdEnsureGuard();
    const paint = () => {
      root.querySelectorAll('[data-cd-row]').forEach((el) => {
        const k = el.getAttribute('data-cd-row');
        el.classList.toggle('bm-cd-on', sel.has(k));
      });
      if (onChange) { try { onChange(sel.size); } catch (e) {} }
    };
    paint();

    let holdT = null, paintVal = true, startKey = null, moved = false;
    let downX = 0, downY = 0, painting = false;

    const rowOf = (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest('[data-cd-quick]')) return null;  // 行内「移出」不参与勾选
      const row = t && t.closest ? t.closest('[data-cd-row]') : null;
      if (!row || !root.contains(row)) return null;
      return row.classList.contains('bm-cd-pickable') ? row : null;
    };

    const onDown = (ev) => {
      const row = rowOf(ev);
      if (!row) return;
      startKey = row.getAttribute('data-cd-row');
      downX = ev.clientX; downY = ev.clientY;
      moved = false; painting = false;
      if (holdT) clearTimeout(holdT);
      holdT = setTimeout(() => {
        holdT = null;
        if (moved || !startKey) return;
        painting = true; cdPainting = true;
        paintVal = !sel.has(startKey);
        if (paintVal) sel.add(startKey); else sel.delete(startKey);
        paint();
      }, 240);
    };

    const onMove = (ev) => {
      if (!startKey) return;
      if (!painting) {
        if (Math.abs(ev.clientX - downX) > 10 || Math.abs(ev.clientY - downY) > 10) {
          moved = true;
          if (holdT) { clearTimeout(holdT); holdT = null; }
        }
        return;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el && el.closest ? el.closest('[data-cd-row]') : null;
      if (!row || !root.contains(row) || !row.classList.contains('bm-cd-pickable')) return;
      const k = row.getAttribute('data-cd-row');
      const has = sel.has(k);
      if (paintVal === has) return;
      if (paintVal) sel.add(k); else sel.delete(k);
      paint();
    };

    const onUp = () => {
      if (holdT) { clearTimeout(holdT); holdT = null; }
      if (startKey && !painting && !moved) {
        if (sel.has(startKey)) sel.delete(startKey); else sel.add(startKey);
        paint();
      }
      if (painting) { painting = false; cdPainting = false; }
      startKey = null;
    };

    root.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return paint;
  }

  /* ============================================================
     聊天里点卡片 → 本次改了哪几张
     ============================================================ */
  async function bmCardDeleteOpen(id) {
    const log = await cdLogGet();
    const rec = log.find((r) => r && r.id === id);
    if (!rec) { cdToast('这条记录已经找不到了'); return; }
    if (rec.action === 'ask') { cdOpenAsk(rec); return; }
    cdOpenRecord(rec);
  }

  /* ---------- 申请卡：同意前条数可以改 ---------- */
  function cdOpenAsk(rec) {
    const c = cdChar(rec.charId);
    const poolN = c ? cdCandidates(c).length : 0;
    const cap = Math.max(1, Math.min(CD_MAX_ROUND, poolN));
    const pending = !rec.st || rec.st === 'pending';
    const cName = cdEsc(rec.charName || (c && c.name) || 'TA');
    let n = Math.min(Math.max(1, rec.n || CD_REQ_MIN), cap);

    const stLine = pending
      ? (cdEsc(cdFmtTime(rec.at)) + ' 发来的申请 · 还没动你的字卡')
      : (rec.st === 'ok'
        ? ('你已经同意了 · 这次移进去 ' + (rec.n || 0) + ' 张')
        : (rec.st === 'expired'
          ? '这条申请已经过期了（TA 后来又发了一张新的，去最新的那张处理）'
          : '这次你没让 TA 动'));

    const html = '<div class="bm-cd-wrap">' +
      '<div class="bm-cd-title">' + cName + ' 想收一批字卡进禁词</div>' +
      '<div class="bm-cd-state">' + stLine + '</div>' +
      (pending
        ? ('<div class="bm-cd-state">字卡库里还有 <b>' + poolN + '</b> 张 TA 没禁过的字卡。TA 想收 <b>' + n + '</b> 张，' +
          '条数你可以改，改完点「同意」才会真的移进去。</div>' +
          '<div class="bm-cd-stepper">' +
          '<button class="bm-cd-step" id="cd-ask-minus" type="button">−</button>' +
          '<input class="bm-cd-num" id="cd-ask-n" type="text" inputmode="numeric" pattern="[0-9]*" value="' + n + '">' +
          '<button class="bm-cd-step" id="cd-ask-plus" type="button">＋</button>' +
          '</div>' +
          '<div class="bm-cd-hint">每轮最多 ' + CD_MAX_ROUND + ' 张，这次最多 ' + cap + ' 张（库里的候选不够）。' +
          '改完点同意；不同意就点下面「算了」，TA 不会动。</div>')
        : '') +
      '<div class="bm-cd-btns">' +
      (pending
        ? ('<button class="btn primary block" id="cd-ask-ok">同意，就这些</button>' +
          '<button class="btn block" id="cd-ask-no" style="margin-top:8px;">算了，这次别动</button>')
        : '') +
      '<button class="btn block" id="bm-cd-close" style="margin-top:8px;">' +
      (pending ? '先放着，回头再说' : '知道了') + '</button>' +
      '</div></div>';

    bmCardDeleteStyle();
    if (typeof openModal === 'function') openModal(html);

    const numEl = document.getElementById('cd-ask-n');
    const readN = () => {
      let v = parseInt(numEl && numEl.value, 10);
      if (!Number.isFinite(v)) v = n;
      if (v < 1) v = 1;
      if (v > cap) v = cap;
      return v;
    };
    const writeN = (v) => { if (numEl) numEl.value = String(v); };
    const minus = document.getElementById('cd-ask-minus');
    const plus = document.getElementById('cd-ask-plus');
    if (minus) minus.onclick = () => writeN(Math.max(1, readN() - 1));
    if (plus) plus.onclick = () => writeN(Math.min(cap, readN() + 1));
    if (numEl) {
      numEl.oninput = () => {
        const v = String(numEl.value).replace(/[^\d]/g, '');
        if (v !== numEl.value) numEl.value = v;
      };
      numEl.onblur = () => writeN(readN());
    }

    const closeBtn = document.getElementById('bm-cd-close');
    if (closeBtn) closeBtn.onclick = () => { try { closeModal(); } catch (e) {} };

    const noBtn = document.getElementById('cd-ask-no');
    if (noBtn) noBtn.onclick = async () => {
      noBtn.disabled = true;
      const r = await cdRejectAsk(rec.id);
      try { closeModal(); } catch (e) {}
      if (typeof renderMessages === 'function') { try { renderMessages(currentCharId); } catch (e) {} }
      cdToast(r.ok ? '这次没让 TA 动' : (r.why || '没成功'));
    };

    const okBtn = document.getElementById('cd-ask-ok');
    if (okBtn) okBtn.onclick = async () => {
      const want = readN();
      okBtn.disabled = true;
      const r = await cdApproveAsk(rec.id, want);
      try { closeModal(); } catch (e) {}
      if (typeof renderMessages === 'function') { try { renderMessages(currentCharId); } catch (e) {} }
      cdToast(r.ok ? ('同意了，' + r.n + ' 张已收进 TA 的禁词') : (r.why || '这次没做成'));
    };
  }

  /* ---------- 普通清单：勾选（全选 / 划选）+ 移出禁词 ---------- */
  function cdOpenRecord(rec) {
    const isRm = rec.action === 'remove';
    const alive = !isRm && cdAlive(rec);
    const rows = (rec.items || []).map((it, i) => cdRowHtml(it, String(i), { checkable: !isRm && alive })).join('')
      || '<div class="bm-cd-empty">（清单为空）</div>';

    const live = !isRm && cdHasLive(rec);
    const stateLine = isRm
      ? '<div class="bm-cd-state">' + cdEsc(cdFmtTime(rec.at)) + ' 放出来的 · 这几张现在又能被 TA 抽到了</div>'
      : (!cdAlive(rec)
        ? '<div class="bm-cd-state warn">已经超过 ' + CD_WINDOW_DAYS + ' 天，清单不再保留（这些词仍在 TA 的禁词里）</div>'
        : (live
          ? '<div class="bm-cd-state">' + cdEsc(cdFmtTime(rec.at)) + ' 移的 · TA 以后抽不到这几张 · 还剩 ' + cdDaysLeft(rec) + ' 天可移出</div>'
          : '<div class="bm-cd-state ok">这几张都已经处理过了</div>'));

    const html = '<div class="bm-cd-wrap">' +
      '<div class="bm-cd-head">' +
      '<div class="bm-cd-title">' + cdEsc((rec.charName || 'TA') + (isRm ? ' 把字卡放出了禁词' : ' 把字卡移进了禁词')) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">' +
      '<span style="font-size:11.5px;opacity:.55;white-space:nowrap;">共 ' + ((rec.items || []).length) + ' 条' + (((rec.items || []).length) > 6 ? ' · 上下滑' : '') + '</span>' +
      (live ? '<button class="bm-cd-mini" id="bm-cd-all">全选</button>' : '') +
      '</div>' +
      '</div>' +
      stateLine +
      /* 20261123：行放进可滚区，条数多时不会把底部按钮顶出屏幕 */
      '<div class="bm-cd-list">' + rows + '</div>' +
      '<div class="bm-cd-hint">' + (isRm
        ? '字卡一直都在库里，只是之前被 ' + cdEsc(rec.charName || 'TA') + ' 关进了自己的禁词。'
        : ('字卡本体还在字卡库里，只是 ' + cdEsc(rec.charName || 'TA') + ' 不会再抽到它们。' +
          (live ? '想只留几张禁用的话，勾上要放出的那几张，再点「移出禁词」。' : ''))) + '</div>' +
      '<div class="bm-cd-btns">' +
      (live ? '<button class="btn primary block" id="bm-cd-undo-sel">移出禁词（取消禁用）</button>' : '') +
      '<button class="btn block" id="bm-cd-close" style="margin-top:8px;">' + (live ? '确定' : '知道了') + '</button>' +
      '</div></div>';

    bmCardDeleteStyle();
    if (typeof openModal === 'function') openModal(html);

    const closeBtn = document.getElementById('bm-cd-close');
    if (closeBtn) closeBtn.onclick = () => { try { closeModal(); } catch (e) {} };
    if (!live) return;

    const root = document.querySelector('.bm-cd-wrap');
    const sel = new Set();
    const paint = cdBindPicker(root, sel);

    const allBtn = document.getElementById('bm-cd-all');
    if (allBtn) allBtn.onclick = () => {
      const keys = Array.from(root.querySelectorAll('.bm-cd-pickable')).map((el) => el.getAttribute('data-cd-row'));
      const on = keys.length > 0 && keys.every((k) => sel.has(k));
      if (on) sel.clear();
      else keys.forEach((k) => sel.add(k));
      allBtn.textContent = on ? '全选' : '取消全选';
      if (paint) paint();
    };

    const undoSel = document.getElementById('bm-cd-undo-sel');
    if (undoSel) undoSel.onclick = async () => {
      if (!sel.size) { cdToast('先勾选要移出禁词的字卡'); return; }
      undoSel.disabled = true;
      const texts = new Set();
      sel.forEach((k) => {
        const it = (rec.items || [])[parseInt(k, 10)];
        if (it) texts.add(String(it.text));
      });
      const r = await cdUndoItems(rec.id, texts);
      try { closeModal(); } catch (e) {}
      if (typeof renderMessages === 'function') { try { renderMessages(currentCharId); } catch (e) {} }
      cdToast(r.ok ? ('已把 ' + r.n + ' 条移出禁词') : (r.why || '移出失败'));
    };
  }


  /* 整条记录撤销（聊天卡片上那个按钮用，只对「移进」有意义）
     20261123：加了 texts —— 只撤清单里被勾中的那几条（不传 = 整条）。 */
  async function bmCardDeleteUndo(id) {
    return cdUndoItems(id, null);
  }
  async function cdUndoItems(id, texts) {
    const log = await cdLogGet();
    const rec = log.find((r) => r && r.id === id);
    if (!rec) return { ok: false, why: '记录不在了' };
    if (rec.action === 'remove') return { ok: false, why: '这次是放出，不需要撤销' };
    if (rec.action === 'ask') return { ok: false, why: '这是一条还没处理的申请' };
    if (!cdAlive(rec)) return { ok: false, why: '超过 ' + CD_WINDOW_DAYS + ' 天了' };
    const want = (texts && texts.size) ? texts : null;
    const live = (rec.items || []).filter((it) => {
      if (!it || (it.st && it.st !== 'banned')) return false;
      if (want && !want.has(String(it.text))) return false;
      return true;
    });
    if (!live.length) return { ok: false, why: '已经处理过了' };

    const c = cdChar(rec.charId);
    if (!c) return { ok: false, why: '角色不在了' };

    const n = cdBanRemove(c, live);
    try { if (typeof saveChar === 'function') await saveChar(c); } catch (e) {}
    for (const it of live) it.st = 'undone';
    if (!(rec.items || []).some((it) => it && (!it.st || it.st === 'banned'))) {
      rec.undone = true;
      rec.undoneAt = Date.now();
    }
    await cdLogSave(log);
    return { ok: true, n: n };
  }

  /* ============================================================
     字卡库 →「角色禁词」（玩家权限）
     ------------------------------------------------------------
     列出每个角色当前**全部**禁词：TA 自己移进的 / 你手动设的 / 勾选禁用的。
     勾选后可：移出禁词、删除对应字卡（真删 + 同时移出禁词）。
     角色自主移进的记录标 7 天窗口；过期只是不再显示「还剩 N 天」，词仍在，玩家仍可处理。
     ============================================================ */

  /* 汇总某个角色当前全部禁词条目（去重，来源优先级：角色移进 > 勾选禁用 > 手动） */
  function cdCharBanEntries(c, log) {
    if (!c) return [];
    /* 角色自主移进且仍在禁词里的：text → {at, recId}（取最近一次） */
    const byCharAdd = new Map();
    for (const r of (log || [])) {
      if (!r || r.charId !== c.id || r.action === 'remove') continue;
      for (const it of (r.items || [])) {
        if (!it || (it.st && it.st !== 'banned')) continue;
        const t = String(it.text);
        const prev = byCharAdd.get(t);
        if (!prev || (r.at || 0) > (prev.at || 0)) byCharAdd.set(t, { at: r.at || 0, recId: r.id });
      }
    }
    /* 勾选禁用（bannedGroupItems）→ text 集合 */
    const groupBanned = new Set();
    try {
      Object.keys(c.bannedGroupItems || {}).forEach((gid) => {
        (c.bannedGroupItems[gid] || []).forEach((t) => { if (t != null) groupBanned.add(String(t)); });
      });
    } catch (e) {}

    const now = cdBanTextSet(c);
    const lyricSet = cdLyricTextSet();       // 标出「一起听歌采集来的歌词字卡」
    const rows = [];
    const seen = new Set();
    const push = (text, src) => {
      const t = String(text);
      if (!t || seen.has(t)) return;
      if (!now.has(t)) return;           // 已经不在禁词里了（可能被别处移除）
      seen.add(t);
      rows.push({ text: t, src: src, lyric: lyricSet.has(t) });
    };
    /* 顺序：角色移进（最近的在前）→ 勾选禁用 → 手动 */
    const addList = [...byCharAdd.entries()].sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    for (const [t, meta] of addList) push(t, { kind: 'char', at: meta.at, recId: meta.recId });
    for (const t of groupBanned) push(t, { kind: 'group' });
    for (const t of (c.banWords || [])) push(t, { kind: 'manual' });
    return rows;
  }

  /* 总览里的勾选状态与折叠状态（跨重渲染保留：勾完一组、展开另一组不会丢） */
  let cdShelfSel = new Set();
  const cdShelfFold = Object.create(null);      // 'c:'+charId / 's:'+charId+'|'+分组名 → true=收起
  /* 行身份 = 角色 id + 字卡原文。原文里可能有引号/尖括号/换行，
     直接塞进 data-* 属性会被 HTML 解析吃掉，所以整体百分号编码成纯 ASCII 再用。 */
  const cdKeyOf = (charId, text) => encodeURIComponent(charId + '\u0001' + text);

  async function bmCardDeleteShelf() {
    const log = await cdLogGet();
    const loc = cdLocMap();          // 文本 → 现在在字卡库哪个分组（用于「按原来的分组分组」）
    const list = [];
    const meta = new Map();          // key → 行数据（批量动作用）
    const charKeys = new Map();      // charId → [key...]（「全选本组」用，不靠前缀匹配）
    try {
      for (const c of (characters || [])) {
        if (!c || !c.id) continue;
        const rows = cdCharBanEntries(c, log);
        if (!rows.length) continue;
        const out = rows.map((r) => {
          const l = loc.get(r.text);
          return { text: r.text, src: r.src, lyric: r.lyric, gname: (l && l.gname) || '不在字卡库' };
        });
        list.push({ charId: c.id, charName: c.name || '角色', rows: out });
        const ks = [];
        out.forEach((r) => {
          const k = cdKeyOf(c.id, r.text);
          meta.set(k, { charId: c.id, charName: c.name || '角色', text: r.text, kind: r.src.kind });
          ks.push(k);
        });
        charKeys.set(c.id, ks);
      }
    } catch (e) {}

    /* 清掉已经失效的勾选（角色被删、词被移出等） */
    for (const k of Array.from(cdShelfSel)) if (!meta.has(k)) cdShelfSel.delete(k);

    bmCardDeleteStyle();

    const closeAndBack = () => {
      cdShelfSel = new Set();
      try { closeModal(); } catch (e) {}
      if (typeof showCardsModal === 'function') showCardsModal();
    };

    if (!list.length) {
      const html0 = '<div class="bm-cd-wrap">' +
        '<div class="bm-cd-head"><div class="bm-cd-title">角色禁词</div>' +
        '<button class="icon-btn" id="bm-cd-sh-back"><i data-icon="close" data-size="17"></i></button></div>' +
        '<div class="bm-cd-empty" style="padding:28px 0;text-align:center;">现在没有任何角色设了禁词</div>' +
        '</div>';
      if (typeof openModal === 'function') openModal(html0);
      const b = document.getElementById('bm-cd-sh-back');
      if (b) b.onclick = closeAndBack;
      return;
    }

    /* 全部 key（含被折叠起来的），「全选」按这个算，不受折叠影响 */
    const allKeys = Array.from(meta.keys());
    let body = '';

    for (const g of list) {
      const cKey = 'c:' + g.charId;
      const cFold = !!cdShelfFold[cKey];
      const lyricN = g.rows.filter((r) => r.lyric).length;

      body += '<div class="bm-cd-cgrp">' +
        '<div class="bm-cd-cgrp-h" data-cd-foldc="' + cdEsc(g.charId) + '">' +
        '<span class="bm-cd-arrow" data-cd-arrowc="' + cdEsc(g.charId) + '">' + (cFold ? '▸' : '▾') + '</span>' +
        '<span class="bm-cd-cgrp-n">' + cdEsc(g.charName) + '</span>' +
        '<span class="bm-cd-cgrp-t">' + g.rows.length + ' 条' + (lyricN ? (' · 歌词 ' + lyricN) : '') + '</span>' +
        '<button class="bm-cd-mini" data-cd-charall="' + cdEsc(g.charId) + '">全选本组</button>' +
        '</div>';

      if (!cFold) {
        /* 按「原来的字卡分组」再分一层，跟字卡库的分组一一对应 */
        const subMap = new Map();
        g.rows.forEach((r) => {
          const gn = r.gname || '未分组';
          if (!subMap.has(gn)) subMap.set(gn, []);
          subMap.get(gn).push(r);
        });
        const names = Array.from(subMap.keys()).sort((a, b) => {
          if (a === '未分组') return -1;
          if (b === '未分组') return 1;
          return String(a).localeCompare(String(b), 'zh');
        });

        for (const gn of names) {
          const arr = subMap.get(gn);
          const sKey = 's:' + g.charId + '|' + gn;
          const sFold = (cdShelfFold[sKey] !== undefined) ? !!cdShelfFold[sKey] : arr.length > 24;
          body += '<div class="bm-cd-sub">' +
            '<div class="bm-cd-sub-h" data-cd-folds="' + cdEsc(g.charId + '|' + gn) + '">' +
            '<span class="bm-cd-arrow sm">' + (sFold ? '▸' : '▾') + '</span>' +
            '<span class="bm-cd-sub-n">' + cdEsc(gn) + '</span>' +
            '<span class="bm-cd-sub-t">' + arr.length + '</span>' +
            '</div>';
          if (!sFold) {
            for (const r of arr) {
              const k = cdKeyOf(g.charId, r.text);
              body += cdShelfRowHtml(k, r);
            }
          }
          body += '</div>';
        }
      }
      body += '</div>';
    }

    const html = '<div class="bm-cd-wrap">' +
      '<div class="bm-cd-head">' +
      '<div class="bm-cd-title">角色禁词</div>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
      '<button class="bm-cd-mini" id="bm-cd-all">全选</button>' +
      '<button class="icon-btn" id="bm-cd-sh-back"><i data-icon="close" data-size="17"></i></button>' +
      '</div></div>' +
      '<div class="bm-cd-state">每个角色一段，点标题展开收起；段内又按字卡库里原来的分组再分一层。' +
      '点一下整行就勾上，按住一行往上下划能连着勾。' +
      '<span id="bm-cd-count" style="color:var(--purple-soft);"></span></div>' +
      '<div class="bm-cd-list" id="bm-cd-list">' + body + '</div>' +
      '<div class="bm-cd-btns">' +
      '<button class="btn primary block" id="bm-cd-unban-sel">移出禁词（取消禁用）</button>' +
      '<button class="btn danger block" id="bm-cd-del-sel" style="margin-top:8px;">删除对应字卡</button>' +
      '<button class="btn block" id="bm-cd-close" style="margin-top:8px;">完成</button>' +
      '</div></div>';

    if (typeof openModal === 'function') openModal(html);

    const root = document.getElementById('bm-cd-list');
    const paint = cdBindPicker(root, cdShelfSel, (n) => {
      const cnt = document.getElementById('bm-cd-count');
      if (cnt) cnt.textContent = n ? ('已选 ' + n + ' 条') : '';
    });

    document.getElementById('bm-cd-sh-back').onclick = closeAndBack;
    document.getElementById('bm-cd-close').onclick = closeAndBack;

    /* 角色段折叠 / 分组折叠 */
    document.querySelectorAll('[data-cd-foldc]').forEach((el) => {
      el.onclick = (ev) => {
        if (ev.target.closest('[data-cd-charall]')) return;
        const id = el.getAttribute('data-cd-foldc');
        const key = 'c:' + id;
        cdShelfFold[key] = !cdShelfFold[key];
        bmCardDeleteShelf();
      };
    });
    document.querySelectorAll('[data-cd-folds]').forEach((el) => {
      el.onclick = () => {
        const v = el.getAttribute('data-cd-folds');
        const sKey = 's:' + v;
        const cur = (cdShelfFold[sKey] !== undefined) ? !!cdShelfFold[sKey] : false;
        cdShelfFold[sKey] = !cur;
        bmCardDeleteShelf();
      };
    });

    /* 全选本组 */
    document.querySelectorAll('[data-cd-charall]').forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-cd-charall');
        const keys = charKeys.get(id) || [];
        const on = keys.length > 0 && keys.every((k) => cdShelfSel.has(k));
        keys.forEach((k) => { if (on) cdShelfSel.delete(k); else cdShelfSel.add(k); });
        if (paint) paint();
      };
    });

    /* 全选 / 取消全选（含折叠起来的） */
    const allBtn = document.getElementById('bm-cd-all');
    if (allBtn) allBtn.onclick = () => {
      const on = allKeys.length > 0 && allKeys.every((k) => cdShelfSel.has(k));
      if (on) cdShelfSel.clear();
      else allKeys.forEach((k) => cdShelfSel.add(k));
      allBtn.textContent = on ? '全选' : '取消全选';
      if (paint) paint();
    };

    /* 单行「移出」：只对角色自己移进去的显示，点一下当场放出 */
    document.querySelectorAll('[data-cd-quick]').forEach((el) => {
      el.onclick = async (ev) => {
        ev.stopPropagation();
        const k = el.getAttribute('data-cd-quick');
        const m = meta.get(k);
        if (!m) return;
        el.textContent = '…';
        const r = await cdShelfUnban([{ charId: m.charId, charName: m.charName, text: m.text }]);
        cdShelfSel.delete(k);
        cdToast(r.n ? '已移出禁词 1 条' : '这条已经不在了');
        bmCardDeleteShelf();
      };
    });

    const collect = () => Array.from(cdShelfSel).map((k) => meta.get(k)).filter(Boolean);

    const unbanBtn = document.getElementById('bm-cd-unban-sel');
    if (unbanBtn) unbanBtn.onclick = async () => {
      const sel = collect();
      if (!sel.length) { cdToast('先勾选要移出禁词的字卡'); return; }
      unbanBtn.disabled = true;
      const r = await cdShelfUnban(sel);
      cdToast(r.n ? ('已把 ' + r.n + ' 条移出禁词') : '没有可移出的项');
      bmCardDeleteShelf();
    };

    const delBtn = document.getElementById('bm-cd-del-sel');
    if (delBtn) delBtn.onclick = async () => {
      const sel = collect();
      if (!sel.length) { cdToast('先勾选要删除的字卡'); return; }
      const ok = await new Promise((res) => {
        if (typeof showConfirm === 'function') {
          showConfirm('把勾选的 ' + sel.length + ' 条对应的字卡从字卡库里彻底删掉？\n\n删掉之后字卡库就真的没有了，这个操作不能撤销。', () => res(true), () => res(false));
        } else res(true);
      });
      if (!ok) return;
      delBtn.disabled = true;
      const r = await cdShelfDelete(sel);
      cdToast(r.n ? ('已彻底删除 ' + r.n + ' 张字卡') : '字卡库里没找到对应的字卡');
      bmCardDeleteShelf();
    };
  }

  /* 总览里的一行：整行可点（勾选），右边给角色移进的条目一个「移出」 */
  function cdShelfRowHtml(k, r) {
    const on = cdShelfSel.has(k);
    let srcTxt = '';
    if (r.src.kind === 'char') {
      const dLeft = CD_WINDOW_DAYS * 24 * 3600 * 1000 - (Date.now() - (r.src.at || 0));
      srcTxt = (dLeft > 0)
        ? ('TA 移进 · ' + cdFmtTime(r.src.at) + ' · 还剩 ' + Math.max(1, Math.ceil(dLeft / 86400000)) + ' 天')
        : ('TA 移进 · ' + cdFmtTime(r.src.at) + ' · 已过 ' + CD_WINDOW_DAYS + ' 天');
    } else if (r.src.kind === 'group') {
      srcTxt = '你勾选禁用的单条';
    } else {
      srcTxt = '你手动设置';
    }
    const lyricTag = r.lyric ? '<span class="bm-cd-lyric">歌词采集</span>' : '';
    return '<div class="bm-cd-row bm-cd-pickable' + (on ? ' bm-cd-on' : '') + '" data-cd-row="' + cdEsc(k) + '">' +
      '<span class="bm-cd-box"></span>' +
      '<div class="bm-cd-row-main">' +
      '<div class="bm-cd-row-g">' + cdEsc(srcTxt) + lyricTag + '</div>' +
      '<div class="bm-cd-row-t">' + cdEsc(r.text) + '</div>' +
      '</div>' +
      (r.src.kind === 'char' ? '<span class="bm-cd-q" data-cd-quick="' + cdEsc(k) + '">移出</span>' : '') +
      '</div>';
  }

  /* 总览：移出禁词（只改禁词，不动字卡） */
  async function cdShelfUnban(sel) {
    const log = await cdLogGet();
    const byChar = new Map();
    for (const r of sel) {
      if (!byChar.has(r.charId)) byChar.set(r.charId, []);
      byChar.get(r.charId).push(r.text);
    }
    let n = 0;
    for (const [charId, texts] of byChar) {
      const c = cdChar(charId);
      if (!c) continue;
      for (const t of texts) {
        if (cdUnbanText(c, t)) n++;
        /* 同步把角色自主移进那条记录标成已撤销，避免总览/聊天卡片状态不一致 */
        for (const rec of log) {
          if (!rec || rec.charId !== charId || rec.action === 'remove') continue;
          for (const it of (rec.items || [])) {
            if (it && String(it.text) === String(t) && (!it.st || it.st === 'banned')) it.st = 'undone';
          }
        }
      }
      try { if (typeof saveChar === 'function') await saveChar(c); } catch (e) {}
    }
    await cdLogSave(log);
    return { n: n };
  }

  /* 总览：删除对应字卡（真删 + 移出禁词） */
  async function cdShelfDelete(sel) {
    const log = await cdLogGet();
    const byChar = new Map();
    for (const r of sel) {
      if (!byChar.has(r.charId)) byChar.set(r.charId, []);
      byChar.get(r.charId).push(r.text);
    }
    let n = 0;
    for (const [charId, texts] of byChar) {
      const c = cdChar(charId);
      for (const t of texts) {
        n += cdHardDeleteText(t);
        if (c) cdUnbanText(c, t);
        for (const rec of log) {
          if (!rec || rec.charId !== charId || rec.action === 'remove') continue;
          for (const it of (rec.items || [])) {
            if (it && String(it.text) === String(t) && (!it.st || it.st === 'banned')) it.st = 'deleted';
          }
        }
      }
      if (c) { try { if (typeof saveChar === 'function') await saveChar(c); } catch (e) {} }
    }
    try { if (typeof saveCards === 'function') await saveCards(cdStore()); } catch (e) {}
    await cdLogSave(log);
    return { n: n };
  }

  /* ---------- 字卡库入口条统计（showCardsModal 里调用） ---------- */
  async function bmCardDeleteShelfStat() {
    try {
      const log = await cdLogGet();
      let chars = 0, items = 0, recent = 0, lyric = 0;
      for (const c of (characters || [])) {
        if (!c || !c.id) continue;
        const rows = cdCharBanEntries(c, log);
        if (!rows.length) continue;
        chars++;
        items += rows.length;
        lyric += rows.filter((r) => r.lyric).length;   // 其中一起听歌采集来的歌词字卡
        if (rows.some((r) => r.src.kind === 'char' && (Date.now() - (r.src.at || 0)) < CD_WINDOW_DAYS * 86400000)) recent++;
      }
      return { chars: chars, items: items, recent: recent, lyric: lyric };
    } catch (e) { return { chars: 0, items: 0, recent: 0, lyric: 0 }; }
  }

  /* ---------- 样式（只注入一次，全部跟主题变量走） ---------- */
  let cdStyleDone = false;
  function bmCardDeleteStyle() {
    if (cdStyleDone) return;
    cdStyleDone = true;
    const st = document.createElement('style');
    st.textContent = `
.bm-cd-cc .bm-cd-cc-t{display:flex;align-items:center;gap:6px;margin-top:4px;font-weight:600;}
.bm-cd-cc .bm-cd-cc-arr{margin-left:auto;opacity:.55;font-size:18px;line-height:1;}
.bm-cd-cc .bm-cd-cc-s{margin-top:2px;font-size:12px;opacity:.66;}
.bm-cd-wrap{font-size:14px;color:var(--text);}
.bm-cd-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.bm-cd-title{font-size:16px;font-weight:700;}
.bm-cd-state{font-size:12.5px;opacity:.7;margin-bottom:12px;line-height:1.6;}
.bm-cd-state.ok{color:var(--purple-soft);opacity:1;}
.bm-cd-state.warn{color:#c86a5a;opacity:1;}
.bm-cd-list{max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch;margin:0 -2px 4px;padding:0 2px;}
.bm-cd-grp{margin-bottom:14px;}
.bm-cd-grp-h{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;}
.bm-cd-grp-n{font-size:13.5px;font-weight:600;color:var(--purple-soft);}
.bm-cd-grp-t{font-size:11.5px;opacity:.55;}
.bm-cd-row{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:14px;margin-bottom:8px;background:var(--bg-elevated);}
.bm-cd-row-main{flex:1;min-width:0;}
.bm-cd-row-g{font-size:11.5px;opacity:.6;margin-bottom:4px;}
.bm-cd-row-t{font-size:14px;line-height:1.5;word-break:break-word;}
.bm-cd-chk{display:flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;margin-top:2px;}
.bm-cd-chk input{width:16px;height:16px;margin:0;accent-color:var(--purple-soft);}
.bm-cd-chk-ph{width:20px;flex:0 0 20px;}
.bm-cd-empty{opacity:.6;padding:12px 0;}
.bm-cd-hint{font-size:11.5px;opacity:.55;line-height:1.6;margin:2px 0 2px;}
.bm-cd-btns{margin-top:14px;}
/* ---- 20261123：整行勾选 / 长按划选 ---- */
.bm-cd-pickable{cursor:pointer;-webkit-user-select:none;user-select:none;}
.bm-cd-pickable.bm-cd-on{border-color:var(--purple-soft);background:rgba(167,139,250,.16);}
.bm-cd-box{flex:0 0 18px;width:18px;height:18px;margin-top:2px;border-radius:6px;
  border:1.6px solid var(--text-tertiary);display:inline-flex;align-items:center;justify-content:center;
  font-size:12px;line-height:1;transition:background .12s,border-color .12s;}
.bm-cd-box.bm-cd-box-ph{border-color:transparent;background:transparent;}
.bm-cd-row.bm-cd-on .bm-cd-box{background:var(--purple-soft);border-color:var(--purple-soft);color:#141019;}
.bm-cd-row.bm-cd-on .bm-cd-box::after{content:'✓';}
.bm-cd-dim{opacity:.45;}
.bm-cd-lyric{font-size:10.5px;color:#7fb3c8;border:1px solid rgba(127,179,200,.45);border-radius:6px;padding:0 4px;margin-left:4px;}
.bm-cd-mini{font-size:11.5px;padding:4px 9px;border-radius:9px;border:1px solid var(--border);
  background:var(--bg-elevated-2);color:var(--text-secondary);cursor:pointer;}
.bm-cd-mini:active{opacity:.7;}
.bm-cd-q{flex:0 0 auto;font-size:11.5px;color:var(--purple-soft);border:1px solid rgba(167,139,250,.4);
  border-radius:8px;padding:2px 8px;margin-left:4px;cursor:pointer;}
.bm-cd-q:active{opacity:.6;}
/* 角色段 / 分组段（可折叠） */
.bm-cd-cgrp{margin-bottom:10px;}
.bm-cd-cgrp-h{display:flex;align-items:center;gap:6px;padding:9px 10px;border-radius:12px;
  background:var(--bg-elevated-2);cursor:pointer;}
.bm-cd-arrow{font-size:12px;color:var(--text-tertiary);width:12px;flex:0 0 12px;}
.bm-cd-arrow.sm{font-size:11px;}
.bm-cd-cgrp-n{font-size:13.5px;font-weight:600;color:var(--purple-soft);}
.bm-cd-cgrp-t{font-size:11.5px;opacity:.55;flex:1;min-width:0;}
.bm-cd-sub{margin:6px 0 2px 4px;}
.bm-cd-sub-h{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:9px;cursor:pointer;}
.bm-cd-sub-n{font-size:12.5px;color:var(--text-secondary);font-weight:600;}
.bm-cd-sub-t{font-size:11px;opacity:.5;}
.bm-cd-sub .bm-cd-row{margin-left:4px;}
/* 申请卡的 ± 改条数 */
.bm-cd-stepper{display:flex;align-items:center;justify-content:center;gap:14px;margin:12px 0 4px;}
.bm-cd-step{width:42px;height:42px;border-radius:13px;border:1px solid var(--border);
  background:var(--bg-elevated-2);color:var(--text);font-size:20px;line-height:1;cursor:pointer;}
.bm-cd-step:active{opacity:.7;}
.bm-cd-num{width:96px;height:42px;text-align:center;font-size:19px;font-weight:700;
  border-radius:13px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);}
.bm-cd-num::-webkit-outer-spin-button,.bm-cd-num::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
/* 字卡库里的入口条 */
.bm-cd-shelf{display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:14px;
  border:1px solid var(--border);border-radius:16px;background:var(--bg-elevated);cursor:pointer;}
.bm-cd-shelf-ic{font-size:16px;line-height:1;}
.bm-cd-shelf-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.bm-cd-shelf-t{display:block;font-size:13.5px;font-weight:600;}
.bm-cd-shelf-s{display:block;font-size:11.5px;opacity:.6;}
.bm-cd-shelf-arr{opacity:.5;font-size:18px;line-height:1;}
`;
    document.head.appendChild(st);
  }

  /* ---------- 对外 ---------- */
  window.bmCardDeleteMaybe = bmCardDeleteMaybe;
  window.bmCardDeleteDev = bmCardDeleteDev;
  window.bmCardDeleteCardHtml = bmCardDeleteCardHtml;
  window.bmCardDeleteOpen = bmCardDeleteOpen;
  window.bmCardDeleteUndo = bmCardDeleteUndo;
  window.bmCardDeleteShelf = bmCardDeleteShelf;
  window.bmCardDeleteShelfStat = bmCardDeleteShelfStat;
  window.bmCardDeleteStyle = bmCardDeleteStyle;
  window.bmCardDeleteApprove = cdApproveAsk;   // 20261123：申请卡「同意」（自检/开发者命令用）
  window.bmCardDeleteReject = cdRejectAsk;     // 20261123：申请卡「算了」
  window.bmCardDeleteUndoItems = cdUndoItems;  // 20261123：清单里勾选撤销
  window.bmCardDeleteLog = cdLogGet;          // 便于调试/自检
  window.bmCardDeleteEntries = cdCharBanEntries; // 便于自检
  window.bmCardDeleteUnban = cdShelfUnban;    // 便于自检
  window.bmCardDeleteHardDel = cdShelfDelete; // 便于自检
})();
