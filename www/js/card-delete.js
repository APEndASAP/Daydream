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
     ⑤ 每次动作**数量不设上限**（1 ~ 全部，随机平方分布，偏小但能很多）；
     ⑥ 改完必须给玩家发清单卡片（进聊天流），点开能看明细；
     ⑦ 字卡库里有「角色禁词总览」：**玩家权限**，能看到每个角色当前全部禁词
        （TA 移进的 / 玩家手动的 / 勾选禁用的），可以移出禁词，也可以删掉对应字卡；
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

  /* 数量不设上限：random² 偏小但能很多，1 ~ 池子全部 */
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

      return action === 'add' ? await cdDoAdd(c, log, addPool) : await cdDoRemove(c, log, rmPool);
    } catch (e) {
      return null;
    }
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
  async function cdDoAdd(c, log0, allSlots) {
    if (!c || !c.id) return null;
    const charId = c.id;
    const all = allSlots || cdCandidates(c);
    if (all.length < CD_MIN_TOTAL) return null;
    const log = log0 || (await cdLogGet());

    const picked = cdPickRandom(all, cdPickCount(all.length));
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
        r = await cdDoAdd(c, log, pool);
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
    const isRm = (p && p.action) === 'remove';
    const lyricN = (p && p.lyricN) || 0;
    const tag = isRm ? '放出禁词' : '移进禁词';
    const head = isRm ? ('把 ' + n + ' 张字卡从禁词里放出来了') : ('把 ' + n + ' 张字卡移进了自己的禁词');
    let sub = isRm ? '这几张又能被 TA 抽到了，点开看看是哪几张' : ('点开看看是哪几张，' + CD_WINDOW_DAYS + ' 天内可以撤销');
    if (lyricN > 0) sub += '（其中 ' + lyricN + ' 张是一起听歌时采到的歌词）';
    return '<div class="msg-card bm-cd-cc" data-cd-card="' + cdEsc(id) + '">' +
      '<span class="msg-card-tag">' + cdEsc(tag) + '</span>' +
      '<div class="bm-cd-cc-t">' + cdEsc(head) + '<span class="bm-cd-cc-arr">&#8250;</span></div>' +
      '<div class="bm-cd-cc-s">' + cdEsc(sub) + '</div>' +
      '</div>';
  }

  /* 单行 HTML（清单里的一项） */
  function cdRowHtml(it, idx, opt) {
    const tag = it.where === 'pool' ? '未分组' : (it.gname || '分组');
    const lyricTag = (it.src === 'lyric')
      ? '<span style="font-size:10.5px;color:#7fb3c8;border:1px solid rgba(127,179,200,.45);border-radius:6px;padding:0 4px;margin-left:4px;">歌词采集</span>'
      : '';
    const stTxt = it.st === 'deleted' ? '已彻底删除'
      : (it.st === 'undone' ? '已撤销'
        : (it.st === 'released' ? '已放出' : ''));
    const dim = stTxt ? ' style="opacity:.45;"' : '';
    const box = (opt && opt.checkable && !stTxt)
      ? '<label class="bm-cd-chk"><input type="checkbox" class="bm-cd-cb" data-cd-i="' + idx + '"><span></span></label>'
      : '<span class="bm-cd-chk-ph"></span>';
    return '<div class="bm-cd-row"' + dim + '>' + box +
      '<div class="bm-cd-row-main">' +
      '<div class="bm-cd-row-g">' + cdEsc(tag) + lyricTag + (stTxt ? ' · ' + cdEsc(stTxt) : '') + '</div>' +
      '<div class="bm-cd-row-t">' + cdEsc(it.text) + '</div>' +
      '</div></div>';
  }

  /* ============================================================
     聊天里点卡片 → 本次改了哪几张
     ============================================================ */
  async function bmCardDeleteOpen(id) {
    const log = await cdLogGet();
    const rec = log.find((r) => r && r.id === id);
    if (!rec) { cdToast('这条记录已经找不到了'); return; }

    const isRm = rec.action === 'remove';
    const rows = (rec.items || []).map((it, i) => cdRowHtml(it, i, { checkable: false })).join('')
      || '<div class="bm-cd-empty">（清单为空）</div>';

    const live = !isRm && cdHasLive(rec);
    const stateLine = isRm
      ? '<div class="bm-cd-state">' + cdEsc(cdFmtTime(rec.at)) + ' 放出来的 · 这几张现在又能被 TA 抽到了</div>'
      : (!cdAlive(rec)
        ? '<div class="bm-cd-state warn">已经超过 ' + CD_WINDOW_DAYS + ' 天，清单不再保留（这些词仍在 TA 的禁词里）</div>'
        : (live
          ? '<div class="bm-cd-state">' + cdEsc(cdFmtTime(rec.at)) + ' 移的 · TA 以后抽不到这几张 · 还剩 ' + cdDaysLeft(rec) + ' 天可撤销</div>'
          : '<div class="bm-cd-state ok">这几张都已经处理过了</div>'));

    const html = '<div class="bm-cd-wrap">' +
      '<div class="bm-cd-title">' + cdEsc((rec.charName || 'TA') + (isRm ? ' 把字卡放出了禁词' : ' 把字卡移进了禁词')) + '</div>' +
      stateLine + rows +
      '<div class="bm-cd-hint">' + (isRm
        ? '字卡一直都在库里，只是之前被 ' + cdEsc(rec.charName || 'TA') + ' 关进了自己的禁词。'
        : '字卡本体还在字卡库里，只是 ' + cdEsc(rec.charName || 'TA') + ' 不会再抽到它们。') + '</div>' +
      '<div class="bm-cd-btns">' +
      (live ? '<button class="btn primary block" id="bm-cd-undo">撤销，把这几张还给 TA</button>' : '') +
      '<button class="btn block" id="bm-cd-close" style="margin-top:8px;">知道了</button>' +
      '</div></div>';

    bmCardDeleteStyle();
    if (typeof openModal === 'function') openModal(html);

    const closeBtn = document.getElementById('bm-cd-close');
    if (closeBtn) closeBtn.onclick = () => { try { closeModal(); } catch (e) {} };

    const undoBtn = document.getElementById('bm-cd-undo');
    if (undoBtn) undoBtn.onclick = async () => {
      undoBtn.disabled = true;
      const r = await bmCardDeleteUndo(rec.id);
      try { closeModal(); } catch (e) {}
      if (typeof renderMessages === 'function') { try { renderMessages(currentCharId); } catch (e) {} }
      cdToast(r.ok ? ('已经把 ' + r.n + ' 张还给 TA 了') : (r.why || '撤销失败'));
    };
  }

  /* 整条记录撤销（聊天卡片上那个按钮用，只对「移进」有意义） */
  async function bmCardDeleteUndo(id) {
    const log = await cdLogGet();
    const rec = log.find((r) => r && r.id === id);
    if (!rec) return { ok: false, why: '记录不在了' };
    if (rec.action === 'remove') return { ok: false, why: '这次是放出，不需要撤销' };
    if (!cdAlive(rec)) return { ok: false, why: '超过 ' + CD_WINDOW_DAYS + ' 天了' };
    const live = (rec.items || []).filter((it) => it && (!it.st || it.st === 'banned'));
    if (!live.length) return { ok: false, why: '已经处理过了' };

    const c = cdChar(rec.charId);
    if (!c) return { ok: false, why: '角色不在了' };

    const n = cdBanRemove(c, live);
    try { if (typeof saveChar === 'function') await saveChar(c); } catch (e) {}
    for (const it of live) it.st = 'undone';
    rec.undone = true;
    rec.undoneAt = Date.now();
    await cdLogSave(log);
    return { ok: true, n: n };
  }

  /* ============================================================
     字卡库 →「角色禁词总览」（玩家权限）
     ------------------------------------------------------------
     列出每个角色当前**全部**禁词：TA 自己移进的 / 你手动设的 / 勾选禁用的。
     勾选后可：移出禁词（还给 TA）、删除对应字卡（真删 + 同时移出禁词）。
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

  async function bmCardDeleteShelf() {
    const log = await cdLogGet();
    const list = [];
    try {
      for (const c of (characters || [])) {
        if (!c || !c.id) continue;
        const rows = cdCharBanEntries(c, log);
        if (!rows.length) continue;
        list.push({ charId: c.id, charName: c.name || '角色', rows: rows });
      }
    } catch (e) {}

    bmCardDeleteStyle();

    const closeAndBack = () => { try { closeModal(); } catch (e) {} if (typeof showCardsModal === 'function') showCardsModal(); };

    if (!list.length) {
      const html0 = '<div class="bm-cd-wrap">' +
        '<div class="bm-cd-head"><div class="bm-cd-title">角色禁词总览</div>' +
        '<button class="icon-btn" id="bm-cd-sh-back"><i data-icon="close" data-size="17"></i></button></div>' +
        '<div class="bm-cd-empty" style="padding:28px 0;text-align:center;">现在没有任何角色设了禁词</div>' +
        '</div>';
      if (typeof openModal === 'function') openModal(html0);
      const b = document.getElementById('bm-cd-sh-back');
      if (b) b.onclick = closeAndBack;
      return;
    }

    /* 扁平索引：复选框值 = 行下标，便于批量操作 */
    const flat = [];
    let body = '';
    for (const g of list) {
      const lyricN = g.rows.filter((r) => r.lyric).length;
      body += '<div class="bm-cd-grp" data-cd-char="' + cdEsc(g.charId) + '">' +
        '<div class="bm-cd-grp-h">' +
        '<span class="bm-cd-grp-n">' + cdEsc(g.charName) + '</span>' +
        '<span class="bm-cd-grp-t">共 ' + g.rows.length + ' 条' + (lyricN ? (' · 歌词 ' + lyricN + ' 张') : '') + '</span>' +
        '</div>';
      for (const row of g.rows) {
        const idx = flat.length;
        flat.push({ charId: g.charId, charName: g.charName, text: row.text, src: row.src });
        let srcTxt = '';
        if (row.src.kind === 'char') {
          const dLeft = CD_WINDOW_DAYS * 24 * 3600 * 1000 - (Date.now() - (row.src.at || 0));
          srcTxt = (dLeft > 0)
            ? ('TA 移进 · ' + cdFmtTime(row.src.at) + ' · 还剩 ' + Math.max(1, Math.ceil(dLeft / 86400000)) + ' 天')
            : ('TA 移进 · ' + cdFmtTime(row.src.at) + ' · 已过 ' + CD_WINDOW_DAYS + ' 天');
        } else if (row.src.kind === 'group') {
          srcTxt = '你勾选禁用的单条';
        } else {
          srcTxt = '你手动设置';
        }
        /* 一起听歌采集来的歌词字卡：标出来，玩家一眼能认出「这句是从歌里收的」 */
        const lyricTag = row.lyric
          ? '<span style="font-size:10.5px;color:#7fb3c8;border:1px solid rgba(127,179,200,.45);border-radius:6px;padding:0 4px;margin-left:4px;">歌词采集</span>'
          : '';
        body += '<div class="bm-cd-row">' +
          '<label class="bm-cd-chk"><input type="checkbox" class="bm-cd-cb" data-cd-k="' + idx + '"><span></span></label>' +
          '<div class="bm-cd-row-main">' +
          '<div class="bm-cd-row-g">' + cdEsc(srcTxt) + lyricTag + '</div>' +
          '<div class="bm-cd-row-t">' + cdEsc(row.text) + '</div>' +
          '</div></div>';
      }
      body += '</div>';
    }

    const html = '<div class="bm-cd-wrap">' +
      '<div class="bm-cd-head">' +
      '<div class="bm-cd-title">角色禁词总览</div>' +
      '<button class="icon-btn" id="bm-cd-sh-back"><i data-icon="close" data-size="17"></i></button>' +
      '</div>' +
      '<div class="bm-cd-state">这里汇总每个角色当前的全部禁词：TA 自己移进的、你手动设的、勾选禁用的。' +
      '一起听歌采集的歌词字卡也算在内（标「歌词采集」）。' +
      '勾选后可以把词移出禁词（字卡一直都在库里），也可以把对应字卡从字卡库删掉。</div>' +
      '<div class="bm-cd-list" id="bm-cd-list">' + body + '</div>' +
      '<div class="bm-cd-btns">' +
      '<button class="btn primary block" id="bm-cd-unban-sel">移出禁词（还给 TA）</button>' +
      '<button class="btn danger block" id="bm-cd-del-sel" style="margin-top:8px;">删除对应字卡</button>' +
      '<button class="btn block" id="bm-cd-close" style="margin-top:8px;">完成</button>' +
      '</div></div>';

    if (typeof openModal === 'function') openModal(html);

    document.getElementById('bm-cd-sh-back').onclick = closeAndBack;
    document.getElementById('bm-cd-close').onclick = closeAndBack;

    const collect = () => {
      const out = [];
      document.querySelectorAll('.bm-cd-cb:checked').forEach((cb) => {
        const k = parseInt(cb.getAttribute('data-cd-k'), 10);
        if (Number.isFinite(k) && flat[k]) out.push(flat[k]);
      });
      return out;
    };

    const unbanBtn = document.getElementById('bm-cd-unban-sel');
    if (unbanBtn) unbanBtn.onclick = async () => {
      const sel = collect();
      if (!sel.length) { cdToast('先勾选要移出的词'); return; }
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
  window.bmCardDeleteLog = cdLogGet;          // 便于调试/自检
  window.bmCardDeleteEntries = cdCharBanEntries; // 便于自检
  window.bmCardDeleteUnban = cdShelfUnban;    // 便于自检
  window.bmCardDeleteHardDel = cdShelfDelete; // 便于自检
})();
