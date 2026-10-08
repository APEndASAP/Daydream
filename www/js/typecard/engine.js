/* ============================================================================
   白日梦 · 打字卡（Typecard）引擎层 —— engine.js
   ----------------------------------------------------------------------------
   职责：打字卡 renderer 状态机，唯一与主线交互的层。
   定位（V1.1 renderer 架构）：
     · 打字卡不是消息系统，不生成消息、不落库、不发通知；
     · 只做「真实消息已生成并落库后，在聊天页首次展示时的一层视觉演出」；
     · 最终文本永远来自 replyMsg.content。

   对外接口（window.bmTypecard）：
     shouldRender(msg) -> bool
     render(msg) -> Promise<boolean>   （fire-and-forget 由 app.js 调用，不阻塞 deliverReply）
   ============================================================================ */

(function (global) {
  'use strict';

  const STATE = {
    IDLE: 'idle',
    PLAYING: 'playing',
    FINISHING: 'finishing',
    ABORTING: 'aborting'
  };

  // app.js 顶层的 currentCharId 是 let 声明，不挂 window——必须直接按变量名访问
  // （经典 script 共享全局词法环境），走 global.currentCharId 永远是 undefined。
  function curCharId() {
    try { return typeof currentCharId !== 'undefined' ? currentCharId : undefined; } catch (e) { return undefined; }
  }
  // 是否仍在当前角色聊天页（真实消息补上屏的统一判断）
  function inThisChat(msg) {
    return document.body.dataset.view === 'chat' && msg && curCharId() === msg.charId;
  }

  // 20261008 晚：上屏统一入口（查重版 appendMessage）。
  // 真因：召唤消息「先落库→再演出」，演出期间任何一次 renderMessages 全量重建
  // （演出中玩家发消息/时间分割线刷新等）都会把已落库的消息直接渲染出来；
  // 演出结束 _finish 再无条件 appendMessage → 同一条消息 DOM 出现两条一模一样
  // （appendMessage 本身不查重）。修复：上屏前先查 #chat-scroll 里是否已有
  // 同 msgid 的行（renderMessages 与 appendMessage 的行都带 data-msgid），有则跳过。
  function appendOnce(msg) {
    if (!msg) return;
    try {
      const scrollEl = document.getElementById('chat-scroll');
      if (scrollEl && scrollEl.querySelector('.msg-row[data-msgid="' + CSS.escape(msg.id) + '"]')) {
        return; // 已上屏（renderMessages 重建渲染过），绝不再 append
      }
    } catch (e) {}
    try { global.appendMessage(msg); } catch (e) {}
  }

  // 20261008 晚九轮（用户明确要求）：打字卡悬浮球+悬浮窗**只允许出现在单聊聊天页**。
  // 聊天导航页/主页/朋友圈等（switchView 切走）以及一切弹窗（个人主页/朋友圈封面/
  // 聊天设置等 openModal——面板 z-index 远高于弹窗，不藏会浮在弹窗上面）都不出现。
  // 面板 z 2147482000 > modal-mask z 100，所以弹窗开着时必须主动藏。
  function _tcModalOpen() {
    try {
      const m = document.getElementById('modal-mask');
      return !!(m && m.classList.contains('show'));
    } catch (e) { return false; }
  }
  function _tcInChat() {
    return document.body.dataset.view === 'chat' && !!curCharId() && !_tcModalOpen();
  }

  // 读取「总设置 + 该访客独立设置」合并后的打字卡配置（与 app.js chatSettings 对齐）。
  // 打字卡开关/模式已并入 chatSettings（typecardOn / typecardMode），不再是独立 kv 键。
  // chatSettings / characters 是 app.js 顶层 let，与 typecard 同处经典 script 共享全局词法环境，
  // 直接按变量名访问（与 curCharId 同理），绝不走 global.xxx。
  function tcSettingsFor(msg) {
    let base = {};
    try { if (typeof chatSettings !== 'undefined') base = chatSettings; } catch (e) {}
    let per = {};
    try {
      if (typeof characters !== 'undefined' && msg && msg.charId) {
        const c = characters.find(x => x && x.id === msg.charId);
        if (c && c.chatSettings) per = c.chatSettings;
      }
    } catch (e) {}
    return Object.assign({}, base, per);
  }

  // ==========================================================================
  // V2：generator session 驱动器（新增，不重写既有状态机）
  // 职责：创建 generator session，循环 session.next() 驱动 ui.play(step, session)，
  //       直到 done；最终保留原始 replyMsg.content（一字不差，不落半截）。
  // 同时负责：
  //   1) step 延时控制（基础时间 × 速度系数 × 随机倍率 0.75~1.35）
  //   2) 连续正确上屏计数 → 达到随机阈值 nextEventCount∈[3,8] 时，
  //      调用 eventManager 生成 card/emoji/pause 演出事件（不进 session.text）。
  // ==========================================================================

  // 各 step 类型的基础延时（ms）。用户实测反馈：整体太快，需「慢到能看清每个字」。
  //   letter 逐字母：120；candidate 候选弹出：260；mistake 选错：320；
  //   delete 删除：300；pick 选中上屏：420；punct 标点：300。
  // engine 在每步之间按此表停顿，再乘速度系数 + 随机扰动，形成真实打字节奏。
  const STEP_DELAY_BASE = {
    letter: 120,
    candidate: 260,
    mistake: 320,
    delete: 300,
    pick: 420,
    punct: 300,
    done: 0
  };

  // 速度：连续倍率（滑条 0.6 ~ 1.5，默认 1.0）。不再用三档固定按钮。
  //   倍率 > 1 = 更慢（更从容），< 1 = 更快。speedFactor 直接乘基础延时。
  //   20261008 用户定案：范围 0.6× ~ 1.5×，默认 1.0×（速度值统一从配置传入，真正控制播放节奏）。
  const SPEED_MIN = 0.6;   // 最快
  const SPEED_MAX = 3.0;   // 最慢（20261008 用户要求加更慢档位到 3.0×）
  const SPEED_DEFAULT = 1.0;
  // 兼容旧的 slow/normal/fast 档位映射（若设置里残留旧值）
  const SPEED_FACTOR = {
    slow: 1.5,
    normal: 1.0,
    fast: 0.6
  };

  // 把一段文本通过 generator session 逐步驱动播放。
  //   text : 完整回复文本（原始内容，绝不被改写）
  //   opts : { mistakeRate?, speedRange?, speed?, rng?, eventManager? }（透传/控制）
  //          speed  : 'slow'|'normal'|'fast'（默认 'normal'）
  //          eventManager : 可选，传入 eventManager.createManager 的实例（默认内部创建）
  //   uiPlay: 每步的渲染回调（默认调 bmTypecardUi.play(step, session)）
  // 返回 Promise<{ text, steps, aborted, events }>：
  //   text    = 原始文本（驱动结束后的 session.text，应严格等于输入 text）
  //   steps   = 已驱动的 step 总数（含演出事件 step）
  //   aborted = 是否被中途打断（engine.abort 置 _stopSession 标志）
  //   events  = 本次驱动产出的非输入事件列表（[{type:'card'|'emoji'|'pause', ...}]）
  function driveSession(text, opts, uiPlay) {
    const self = this;
    const o = opts || {};
    const gen = (global.bmTypecardGenerator && global.bmTypecardGenerator.buildSession)
      ? global.bmTypecardGenerator.buildSession(text, o)
      : null;

    // 速度系数：支持连续倍率 speedFactor（0.6~3.0），兼容旧档位 speed 字符串
    const speedKey = o.speed || 'normal';
    let speedFactor;
    if (typeof o.speedFactor === 'number') {
      speedFactor = o.speedFactor;
    } else if (SPEED_FACTOR[speedKey] !== undefined) {
      speedFactor = SPEED_FACTOR[speedKey];
    } else {
      speedFactor = SPEED_DEFAULT;
    }
    // 钳制到合法区间 [SPEED_MIN, SPEED_MAX]
    speedFactor = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speedFactor));

    // 事件产出记录（供验证/统计；现在 card/emoji 由 buildSession 的块事件产生，这里仅记录）
    const producedEvents = [];

    return new Promise(function (resolve) {
      if (!gen) {
        // 无 generator：直接返回原始文本，不改变内容
        resolve({ text: String(text || ''), steps: 0, aborted: false, events: producedEvents });
        return;
      }

      let steps = 0;
      let guard = 0;
      const MAX_STEPS = 20000; // 防御：防止异常死循环（blocks 模式含字卡/表情块，步数更多）

      // 计算某 step 的实际延时（基础 × 速度系数 × 随机倍率 0.75~1.35）
      function delayFor(step) {
        // card/emoji 块事件：给一个固定停留时长（飞入后停留），让玩家看清
        if (step.type === 'card' || step.type === 'emoji') {
          const r = (typeof o.rng === 'function') ? o.rng() : Math.random();
          return Math.round((360 + 160) * speedFactor * (0.9 + r * 0.2)); // ~500ms 停留（×速度系数）
        }
        const base = STEP_DELAY_BASE[step.type] || 60;
        if (base <= 0) return 0;
        const r = (typeof o.rng === 'function') ? o.rng() : Math.random();
        const jitter = 0.75 + r * 0.6; // 0.75 ~ 1.35
        return Math.round(base * speedFactor * jitter);
      }

      // 消费一个 step / 事件到 ui 演出层（返回 Promise）
      function consume(item) {
        // 记录 card/emoji 块事件（供统计）
        if (item.type === 'card' || item.type === 'emoji') producedEvents.push(item);
        let p;
        const ui = global.bmTypecardUi;
        try {
          if (ui && typeof ui.play === 'function') {
            p = ui.play(item, gen);
          } else if (typeof uiPlay === 'function') {
            p = uiPlay(item, gen);
          } else {
            p = Promise.resolve();
          }
        } catch (e) {
          p = Promise.resolve();
        }
        return Promise.resolve(p);
      }

      // 主循环：驱动一个 step（输入或块事件），按节奏延时后继续
      function pump() {
        // 中断标志（由 abort 设置）：立即停止。
        // V2 铁律：abort 返回「完整目标正文」而非 session.text 中间态，绝不落半截、绝不残留错字。
        // 20261008 修复：text 可能是 blocks 数组（String(数组) 会变脏），
        //   改用 gen.source（session 的完整目标文本 = 所有块 text 拼接）返回，保证与目标一字不差。
        if (self._stopSession) {
          self._stopSession = false;
          const fullText = (gen && typeof gen.source === 'string') ? gen.source : String(text || '');
          resolve({ text: fullText, steps: steps, aborted: true, events: producedEvents });
          return;
        }

        if (gen.done || guard >= MAX_STEPS) {
          resolve({ text: gen.text, steps: steps, aborted: false, events: producedEvents });
          return;
        }

        const step = gen.next();
        if (!step) {
          resolve({ text: gen.text, steps: steps, aborted: false, events: producedEvents });
          return;
        }
        if (step.type === 'done') {
          resolve({ text: gen.text, steps: steps, aborted: false, events: producedEvents });
          return;
        }

        steps++;
        guard++;

        // 消费本 step（输入步或 card/emoji 块事件）
        const p = consume(step);

        // 节奏：本步基础延时（真实打字停顿；块事件给停留时长）
        const delay = delayFor(step);

        setTimeout(function () {
          p.then(pump).catch(function () { pump(); });
        }, delay);
      }

      pump();
    });
  }

  const engine = {
    STATE,
    _state: STATE.IDLE,
    _active: null, // { msg, ghost, observer }
    _stopSession: false, // V2：session 驱动中断标志（abort 置 true）
    _idlePanel: null,    // 20261008：悬浮窗模式「点击圆点展开的待机面板」（无演出时手动展开/收起）
    _summonPanel: null,  // 20261008 晚（碎梦重拼召唤）：常驻待机悬浮窗（带「生成一条消息」按钮）
    _summonBusy: false,  // 召唤流程进行中标志（防连点）
    _summonDismissed: false, // 用户点球主动收起召唤悬浮窗（true 时 _ensureSummonPanel 不自动重建）
    _summonCid: null,    // 召唤面板对应的角色 id（换角色时复位 dismissed）
    _summonAutoUntil: {}, // 20261009：召唤自动发消息「下次触发时间点」内存态（charId -> ts；持久化见 kv 'summonAutoNextAt'）
    _summonAutoLoaded: false, // 召唤自动调度是否已从 kv 懒加载过（幂等哨兵）

    // ========================================================================
    // 悬浮窗显隐总控（20261008 晚九轮终版：只在单聊聊天页出现）。
    // 用户明确要求：悬浮球+悬浮窗**只出现在单聊聊天页**——聊天导航页/主页/
    // 朋友圈（switchView 切走）与一切弹窗（个人主页/朋友圈封面/设置等）都不出现。
    // 三种形态互斥：
    //   A. 召唤开关开（typecardSummon）→ 常驻待机悬浮窗（带「生成一条消息」按钮）
    //      + 悬浮球（点球收起/展开悬浮窗）；
    //   B. 召唤关 + 打字卡开 + 模式=float → 常驻圆点（点击展开普通待机面板）；
    //   C. 其余 → 全部隐藏（切页面/进群聊/开弹窗/关开关等）。
    // 调用点：app.js switchView（进出聊天页/切角色）+ openModal/closeModal/forceCloseModal
    // （弹窗开→藏、关→恢复）+ 打字卡设置变更（tcPersist）。
    // ========================================================================
    updateFloatDot: function () {
      const ui = global.bmTypecardUi;
      if (!ui || typeof ui.ensureFloatDot !== 'function') return;
      let showDot = false;
      let summon = false;
      let curCid = null;
      try {
        curCid = curCharId();
        if (curCid && _tcInChat()) {
          const cfg = tcSettingsFor({ charId: curCid });
          showDot = !!cfg.typecardOn && cfg.typecardMode === 'float';
          summon = !!cfg.typecardSummon;
        }
      } catch (e) { showDot = false; summon = false; }
      if (summon) {
        // 形态 A：常驻待机悬浮窗 + 悬浮球（球回归：点球收起/展开，不再是藏球）
        if (this._summonCid !== curCid) {
          this._summonCid = curCid;          // 换角色/换聊天：复位「用户主动收起」状态
          this._summonDismissed = false;
        }
        ui._onDotTap = function () { engine.toggleSummonPanel(); };
        ui.ensureFloatDot();
        if (this._idlePanel) {
          try { ui.destroyGhost(this._idlePanel); } catch (e) {}
          this._idlePanel = null;
        }
        if (this._state === STATE.IDLE) this._ensureSummonPanel();
      } else {
        // 形态 B/C：先撤召唤面板（收起状态一并复位）
        this._summonDismissed = false;
        this._destroySummonPanel();
        if (showDot) {
          ui.ensureFloatDot();
          ui._onDotTap = function () { engine.toggleFloatPanel(); };
        } else {
          // 离开聊天页/关闭功能：待机面板一并收起
          if (this._idlePanel) {
            try { ui.destroyGhost(this._idlePanel); } catch (e) {}
            this._idlePanel = null;
          }
          ui._onDotTap = null;
          ui.hideFloatDot();
        }
      }
    },

    // ========================================================================
    // 碎梦重拼召唤：常驻待机悬浮窗（20261008 晚）。
    // _ensureSummonPanel 内部自检召唤开关——任何收尾链路（_finish/abort/开关切换）
    // 都可安全调用，开关关闭时静默跳过；幂等（已有面板不重建）。
    // ========================================================================
    _ensureSummonPanel: function () {
      const ui = global.bmTypecardUi;
      if (!ui || this._summonPanel) return;
      if (this._summonDismissed) return; // 用户点球主动收起：不自动重建（点球再展开）
      let summon = false;
      try {
        const cid = curCharId();
        // 20261008 晚九轮用户定稿：只在单聊聊天页（不在弹窗/其他页面出现）
        if (cid && _tcInChat()) summon = !!tcSettingsFor({ charId: cid }).typecardSummon;
      } catch (e) { summon = false; }
      if (!summon) return;
      const panel = ui.buildFloatPanel(null, { summon: true });
      if (!panel) return;
      ui.insertFloatPanel(panel);
      // 待机态：标题圆点置灰（与演出中的呼吸态区分）
      try {
        const d = panel._shadow.querySelector('.tc-title-dot');
        if (d) d.classList.add('tc-idle');
      } catch (e) {}
      this._summonPanel = panel;
      // 按钮点击 → 触发召唤（engine.summon）
      ui._onSummonTap = function () { engine.summon(); };
    },

    _destroySummonPanel: function () {
      if (!this._summonPanel) return;
      try {
        const ui = global.bmTypecardUi;
        if (ui) ui.destroyGhost(this._summonPanel);
      } catch (e) {}
      this._summonPanel = null;
      const ui2 = global.bmTypecardUi;
      if (ui2 && ui2._onSummonTap) ui2._onSummonTap = null;
    },

    // ========================================================================
    // summon()：碎梦重拼召唤——玩家点悬浮窗按钮，角色主动拼一条消息并发送。
    // 铁律（20261008 用户定案）：
    //   · 与正常抽字卡聊天完全独立：自己生成→落库→演出→上屏，不碰主线回复队列；
    //   · 不依赖打字卡总开关（召唤开关独立），但速度/通顺度/拼字卡设置跟随 tcSettingsFor；
    //   · 演出强制走悬浮窗（forceFloat）；演出全程「正在输入中」由 render 挂接；
    //   · 演出结束后 _finish 自动重建常驻待机面板；不弹系统通知（玩家就在看着）。
    // ========================================================================
    summon: async function () {
      if (this._summonBusy) return { ok: false, reason: 'busy' };
      if (this._state === STATE.PLAYING || this._state === STATE.FINISHING) {
        return { ok: false, reason: 'busy' };
      }
      const cid = curCharId();
      if (!cid) return { ok: false, reason: 'no_char' };
      this._summonBusy = true;
      try {
        const cfg = tcSettingsFor({ charId: cid });
        if (!cfg.typecardSummon) return { ok: false, reason: 'off' };
        // 生成内容：禁字/关系/分组与主线 deliverReply 同源（全局 helper 共享词法环境）
        let banWords, relation, bannedGroups;
        try {
          const c = (typeof characters !== 'undefined')
            ? characters.find(function (x) { return x && x.id === cid; }) : null;
          if (c) {
            if (typeof getCharBanWords === 'function') banWords = getCharBanWords(c);
            relation = c.relation || null;
            bannedGroups = c.bannedGroups || [];
          }
        } catch (e) {}
        const tc = await this.generate(cid, {
          banWords: banWords, relation: relation, bannedGroups: bannedGroups,
          coherence: (typeof cfg.typecardCoherence === 'number') ? cfg.typecardCoherence : 0,
          allowCards: cfg.typecardCards !== false
        });
        const msg = {
          id: (global.uid ? global.uid('msg') : ('sm' + Date.now())),
          charId: cid, from: 'them', type: 'text', content: tc.text, time: Date.now(),
          meta: { typecardBlocks: tc.blocks }
        };
        await global.idbPut('messages', msg);
        // 强制悬浮窗演出（不依赖打字卡总开关/展示模式），演出完 _finish 上屏+重建待机面板
        await this.render(msg, { forceFloat: true });
        return { ok: true, msg: msg };
      } finally {
        this._summonBusy = false;
      }
    },

    // ========================================================================
    // summonAuto(charId)：召唤「自动发消息」（20261009）——固定间隔到期自动触发，
    // 与手动点按钮 summon() 同源拼字生成，但不依赖 curCharId()（玩家可能不在聊天页/挂后台）。
    // 流程：生成拼字消息 → 落库 → 弹系统通知（复用主线 notifyIncoming，挂后台/锁屏也能提醒）
    //        → 若玩家恰好正看该角色聊天页，才走 forceFloat 拼字演出；否则仅落库+通知。
    // 不碰主线回复队列、不碰主动消息开关（召唤开关独立，与 typecardOn 互斥已由设置层保证）。
    // ========================================================================
    summonAuto: async function (charId) {
      if (!charId) return { ok: false, reason: 'no_char' };
      if (this._summonBusy || this._state === STATE.PLAYING || this._state === STATE.FINISHING) {
        return { ok: false, reason: 'busy' }; // 演出进行中/手动召唤进行中：本轮到点跳过（不堆积）
      }
      let c = null;
      try {
        if (typeof characters !== 'undefined') {
          c = characters.find(function (x) { return x && x.id === charId; }) || null;
        }
      } catch (e) {}
      const cfg = tcSettingsFor({ charId: charId });
      if (!cfg.typecardSummon) return { ok: false, reason: 'off' };

      this._summonBusy = true;
      try {
        // 内容生成与手动 summon 完全同源（禁字/关系/分组/通顺度/拼字卡设置跟随 tcSettingsFor）
        let banWords, relation, bannedGroups;
        try {
          if (c) {
            if (typeof getCharBanWords === 'function') banWords = getCharBanWords(c);
            relation = c.relation || null;
            bannedGroups = c.bannedGroups || [];
          }
        } catch (e) {}
        const tc = await this.generate(charId, {
          banWords: banWords, relation: relation, bannedGroups: bannedGroups,
          coherence: (typeof cfg.typecardCoherence === 'number') ? cfg.typecardCoherence : 0,
          allowCards: cfg.typecardCards !== false
        });
        const msg = {
          id: (global.uid ? global.uid('msg') : ('sm' + Date.now())),
          charId: charId, from: 'them', type: 'text', content: tc.text, time: Date.now(),
          meta: { typecardBlocks: tc.blocks, summonAuto: true }
        };
        await global.idbPut('messages', msg);

        // 弹系统通知（复用主线出口：notifySystem 关/该访客静音时自动静默）
        try {
          if (typeof global.notifyIncoming === 'function') {
            global.notifyIncoming(c, typeof tc.text === 'string' ? tc.text : '（碎梦重拼消息）', (c && c.name ? c.name : '访客') + ' 发来一条碎梦重拼消息', 'msg');
          }
        } catch (e) {}

        // 恰好正看该角色聊天页 → 走 forceFloat 拼字演出；否则仅落库+通知（等 renderMessages 展示）
        const inChatNow = (document.body.dataset.view === 'chat') && (typeof currentCharId !== 'undefined') && currentCharId === charId && !this._tcModalOpenSafe();
        if (inChatNow && this._state === STATE.IDLE) {
          await this.render(msg, { forceFloat: true });
        } else {
          // 不在聊天页：补未读计数 + 刷新列表（与 deliverCharMessage 后台分支对齐）
          try {
            if (typeof _ev === 'function' && typeof _saveUnreadEvents === 'function') {
              const e = _ev(charId);
              e.msgs = (e.msgs || 0) + 1;
              await _saveUnreadEvents();
            }
          } catch (e) {}
          try { if (typeof renderChatList === 'function') renderChatList(); } catch (e) {}
          try { if (typeof refreshUnreadBadges === 'function') refreshUnreadBadges(); } catch (e) {}
        }
        return { ok: true, msg: msg };
      } finally {
        this._summonBusy = false;
      }
    },

    // 内部：召唤自动发消息专用的「是否正看该角色聊天页」判断（不依赖 _tcModalOpen 的 curCharId）
    _tcModalOpenSafe: function () {
      try {
        const m = document.getElementById('modal-mask');
        return !!(m && m.classList.contains('show'));
      } catch (e) { return false; }
    },

    // 20261009：重置所有角色的召唤自动调度计时（间隔设置变更时调用，让新间隔立即生效）。
    // 实际清空逻辑在 app.js 的 _summonAutoReset（共享词法环境可直接调用），此处作为 engine 统一入口。
    resetSummonAuto: function () {
      try { if (typeof _summonAutoReset === 'function') _summonAutoReset(); } catch (e) {}
      try { if (this._summonAutoUntil) { for (const k in this._summonAutoUntil) delete this._summonAutoUntil[k]; } } catch (e) {}
    },

    // 圆点点击：展开/收起待机面板（演出中不响应，防双面板）
    toggleFloatPanel: function () {
      const ui = global.bmTypecardUi;
      if (!ui) return;
      if (this._state === STATE.PLAYING) return;
      if (this._idlePanel) {
        ui.destroyGhost(this._idlePanel);
        this._idlePanel = null;
        return;
      }
      const panel = ui.buildFloatPanel(null);
      if (!panel) return;
      ui.insertFloatPanel(panel);
      // 待机态：标题圆点置灰（与演出中的呼吸态区分）
      try {
        const d = panel._shadow.querySelector('.tc-title-dot');
        if (d) d.classList.add('tc-idle');
      } catch (e) {}
      this._idlePanel = panel;
    },

    // 悬浮球点击（召唤模式，20261008 晚三轮球回归）：收起/展开常驻待机悬浮窗。
    // 演出中不响应（面板此刻由演出接管，收起/展开都会造成双面板）。
    // 用户主动收起置 _summonDismissed——此后任何收尾链路的 _ensureSummonPanel
    // 都不再自动重建，直到用户再点球展开或切换角色。
    toggleSummonPanel: function () {
      const ui = global.bmTypecardUi;
      if (!ui) return;
      if (this._state !== STATE.IDLE) return;
      if (this._summonPanel) {
        try { ui.destroyGhost(this._summonPanel); } catch (e) {}
        this._summonPanel = null;
        this._summonDismissed = true;
        return;
      }
      this._summonDismissed = false;
      this._ensureSummonPanel();
    },

    // 是否该演出这条消息（纯同步判断，不读异步配置，保证 deliverReply 不被阻塞）
    // 异步开关判断在 render 内部补做。
    shouldRender: function (msg) {
      if (!msg) return false;
      if (msg.from !== 'them') return false;
      if (msg.type !== 'text') return false;
      // 不在聊天页 / 不是当前角色 → 不演出（走正常 appendMessage）
      if (document.body.dataset.view !== 'chat') return false;
      if (curCharId() !== msg.charId) return false;
      // 已播过 → 不重播
      if (msg.meta && msg.meta.typecardPlayed) return false;
      return true;
    },

    // 演出编排（fire-and-forget；app.js 不 await 此 Promise）。
    // opts.forceFloat=true：碎梦重拼召唤手动触发——不依赖打字卡总开关、强制悬浮窗演出。
    render: function (msg, opts) {
      const self = this;
      const rOpts = opts || {};
      // 防双开：新演出打断旧演出（旧演出淡出收尾 + 落地真消息，不阻塞新 ghost 创建）
      if (this._active) this.abort('new_message');

      return (async function () {
        // 开关（读合并后的 chatSettings.typecardOn，默认关）；关则直接让主链走 appendMessage（返回 false）。
        // 召唤流程（forceFloat）跳过总开关检查——召唤开关独立于打字卡开关。
        const cfg = tcSettingsFor(msg);
        const enabled = !!cfg.typecardOn || !!rOpts.forceFloat;
        if (!enabled) return false;

        const ui = global.bmTypecardUi;
        if (!ui) return false;

        // 展示模式：bubble=气泡内嵌（默认）；float=悬浮窗（独立 position:fixed 面板挂 body）。
        // 两者共用同一套 generator / speed / coherence / 错字删除重选 / card-emoji 逻辑，
        // 唯一区别是「演出容器」：bubble 嵌气泡、float 独立悬浮面板。
        // 召唤流程强制 float（演出必须在悬浮窗里，玩家点按钮看着打）。
        const mode = (rOpts.forceFloat || cfg.typecardMode === 'float') ? 'float' : 'bubble';
        const isFloat = (mode === 'float');

        // 20261008：演出开始前先收起「点击圆点展开的待机面板」，防双面板。
        // 20261008 晚：不再限定 isFloat——bubble 模式下手动触发演出同样要收起待机面板。
        // 20261008 修复：本段处于 async function 作用域内，this 不指向 engine（为 undefined），
        // 读 this._idlePanel 直接 throw「Cannot read properties of undefined (reading '_idlePanel')」
        // → 整个 render 兜底直显消息，float 演出从未发生（用户看到的「打字过程没有在
        // 悬浮窗里显示」真因）。必须用外层捕获的 self。
        if (self._idlePanel) {
          try { ui.destroyGhost(self._idlePanel); } catch (e) {}
          self._idlePanel = null;
        }
        // float 演出接管悬浮窗：召唤常驻面板也要让位（演出结束 _finish 会重建）
        if (isFloat && self._summonPanel) {
          try { ui.destroyGhost(self._summonPanel); } catch (e) {}
          self._summonPanel = null;
        }

        // 1) 保存 replyMsg 引用
        self._active = { msg, ghost: null, observer: null };

        // 2) 创建演出节点：float 用独立悬浮面板（挂 body），bubble 用占位气泡（挂 chat-scroll）。
        //    召唤开启时 float 演出面板也带「生成一条消息」按钮（演出中禁用）。
        const summonOn = !!cfg.typecardSummon;
        const ghost = isFloat ? ui.buildFloatPanel(msg, { summon: summonOn }) : ui.buildGhost(msg);
        if (!ghost) { self._active = null; return false; }
        if (ghost._summonBtn) ghost._summonBtn.disabled = true;

        // 3) 插入对应容器
        const ok = isFloat ? ui.insertFloatPanel(ghost) : ui.insertGhost(ghost);
        if (!ok) { self._active = null; return false; }

        self._active.ghost = ghost;
        self._state = STATE.PLAYING;

        // 20261008 晚：演出全程显示「正在输入中」（聊天流三点气泡 + 顶部签名），
        // 结束（_finish）/打断（abort/回收）时由 tcHideTyping 移除。用户要求：
        // 上面一直在打字，气泡就要一直显示正在输入中。
        try { if (typeof global.tcShowTyping === 'function') global.tcShowTyping(msg.charId); } catch (e) {}

        // 4) 挂 MutationObserver：只检测 ghost 被 renderMessages 清掉
        self._active.observer = ui.watchGhost(ghost, function () {
          self._onGhostRecycled(msg);
        });

        // 5) 播放打字过程（V2：走 generator session 驱动 blocks；ui 暂未实现 play(step) 时回退旧 playTyping）
        const uiHasStepPlay = ui && typeof ui.play === 'function';
        try {
          if (uiHasStepPlay) {
            // 新驱动：buildSession(blocks) → session.next() → ui.play(step, session)
            // 打字目标 = msg.meta.typecardBlocks（生成时定好的 blocks），回退 msg.content 纯文本。
            const blocks = (msg.meta && Array.isArray(msg.meta.typecardBlocks))
              ? msg.meta.typecardBlocks : msg.content;
            // 速度：连续倍率（chatSettings.typecardSpeed 数值，0.6~1.5，默认 1.0）；
            // 兼容旧档位字符串 slow/normal/fast。
            let spd = cfg.typecardSpeed;
            if (typeof spd !== 'number') spd = SPEED_DEFAULT;
            await self.startTyping(blocks, { speedFactor: spd });
          } else {
            // 旧接口回退（ui 尚未实现 play(step) 时，保证演出不缺失）
            await ui.playTyping(ghost, msg);
          }
        } catch (e) {
          // 动画出错不影响消息展示
        }

        // 演出期间若被 abort（离开聊天页 / 新演出打断），ghost 已被清理，直接落地真消息
        if (self._active !== null && self._active.msg === msg) {
          await self._finish(msg, ghost);
        }
        return true;
      })().catch(function (e) {
        console.warn('[碎梦重拼] 演出异常，兜底直显消息：', e && (e.message || e));
        // 兜底：确保真消息一定上屏（已撤回的不补，避免第二条撤回标识）
        try { self.abort(); } catch (e2) {}
        try { if (inThisChat(msg) && !msg.recalled) global.appendMessage(msg); } catch (e3) {}
      });
    },

    // 完成：回写 typecardPlayed → appendMessage 真消息 → 删 ghost
    _finish: async function (msg, ghost) {
      this._state = STATE.FINISHING;
      try {
        // 回写标记（不改 DB 结构，仅更新消息对象的 meta 字段）
        msg.meta = Object.assign({}, msg.meta || {}, { typecardPlayed: true });
        await global.idbPut('messages', msg);
      } catch (e) { /* 标记回写失败不阻断展示 */ }

      // 真消息上屏（此时才进入 _chatWin.all）
      // 20261008 修复：若演出期间该消息已被撤回（recalled），不再补上屏——
      // 撤回链路已用 renderMessages 重建并渲染撤回态，这里再 appendMessage 会重复出「第二条撤回标识」。
      // 20261008 晚：上屏前先撤演出专属「正在输入中」指示（先撤再上屏，三点气泡不与真消息同帧并存）。
      try { if (typeof global.tcHideTyping === 'function') global.tcHideTyping(msg.charId); } catch (e) {}
      if (inThisChat(msg) && !msg.recalled) {
        appendOnce(msg); // 查重版上屏：演出期间 renderMessages 重建渲染过就不再 append（防双条一模一样）
      }

      // 删 ghost
      const ui = global.bmTypecardUi;
      if (ui && ghost) ui.removeGhost(ghost);

      this._active = null;
      this._state = STATE.IDLE;
      // 召唤开启时重建常驻待机面板（内部自检开关，幂等）
      this._ensureSummonPanel();
    },

    // ghost 被 renderMessages 清掉（切页/翻页）——只处理 PLAYING 态的「意外回收」。
    // 正常完成（_finish 的 removeGhost）与打断（abort 的 destroyGhost）也会触发本回调，
    // 但那时状态已离开 PLAYING，直接忽略，杜绝真消息重复上屏。
    _onGhostRecycled: function (msg) {
      if (this._state !== STATE.PLAYING || !this._active || this._active.msg !== msg) return;
      // 演出意外中断：撤「正在输入中」指示
      try { if (typeof global.tcHideTyping === 'function') global.tcHideTyping(msg.charId); } catch (e) {}
      // 若仍在聊天页且是当前角色：补 appendMessage 真消息（消息已落库，绝不丢）
      // 20261008 修复：已撤回的消息不补上屏（renderMessages 已渲染撤回态，避免第二条撤回标识）
      if (inThisChat(msg) && !msg.recalled) {
        // 防止重复上屏：标记已播，直接展示
        msg.meta = Object.assign({}, msg.meta || {}, { typecardPlayed: true });
        try { global.appendMessage(msg); } catch (e) {}
      }
      // 已离开聊天页：不处理，等正常 renderMessages 显示
      if (this._active.observer) { try { this._active.observer.disconnect(); } catch (e) {} }
      this._active = null;
      this._state = STATE.IDLE;
      // 召唤开启时重建常驻待机面板（内部自检开关+在聊天页，幂等）
      this._ensureSummonPanel();
    },

    // 打断：按原因区分收尾方式
    //   reason === 'new_message'：新消息接管旧演出 → 旧 ghost 淡出（~180ms）→ 落地真消息；
    //                             不阻塞新 ghost 创建（_active 同步交给新 render 接管）。
    //   reason === 'leave_chat'（默认）：离开聊天页 → 立即清理 ghost，不补 appendMessage、不等待动画。
    abort: function (reason) {
      const act = this._active;
      // V2：通知 session 驱动停止（若有正在进行的 startTyping 循环）。
      // _stopSession 是「驱动层中断信号」，独立于 _active（后者是 ghost/消息引用）。
      // 即便 _active 为 null（例如脱离 render 直接 startTyping 的极端场景），
      // 只要还有 session 在跑，就应保留中断信号，让 driveSession 自行消费并复位。
      this._stopSession = true;
      if (!act) { return; }
      const oldMsg = act.msg;
      const oldGhost = act.ghost;
      this._state = STATE.ABORTING;
      if (act.observer) { try { act.observer.disconnect(); } catch (e) {} }
      // 立即交还 _active（新 render 会同步接管），淡出链路只依赖 oldMsg/oldGhost 闭包，不再触碰 this._active
      this._active = null;

      const ui = global.bmTypecardUi;

      if (reason === 'new_message') {
        // 淡出收尾：旧 ghost 平滑淡出 → 完成后落地旧真消息（仅仍在当前聊天页时）
        // 20261008：已撤回的消息不补上屏，避免第二条撤回标识
        if (ui && oldGhost) {
          ui.fadeGhost(oldGhost, function () {
            if (oldMsg && inThisChat(oldMsg) && !oldMsg.recalled) {
              oldMsg.meta = Object.assign({}, oldMsg.meta || {}, { typecardPlayed: true });
              try { appendOnce(oldMsg); } catch (e) {}
            }
            // 旧 summon 演出面板被新演出（可能是 bubble）顶掉后，重建常驻待机面板
            engine._ensureSummonPanel();
          });
        } else if (oldMsg && inThisChat(oldMsg) && !oldMsg.recalled) {
          // 无 ghost 可淡出（极端兜底）：直接落地
          try { appendOnce(oldMsg); } catch (e) {}
          engine._ensureSummonPanel();
        }
        this._state = STATE.IDLE;
        return;
      }

      // leave_chat / 默认：立即清理，不补上屏
      if (ui && oldGhost) ui.destroyGhost(oldGhost);
      this._state = STATE.IDLE;
    },

    // ========================================================================
    // generate(charId, opts)：真·打字卡消息生成入口（V2 核心新增）。
    //   调 generator.generateContent 从字库随机拼 5~20 字 + 穿插字卡/表情块，
    //   字卡走主线 drawReply、表情走主线 pickCharSticker（无资源时安全回退自带池）。
    //   返回 Promise<{ type, blocks, text }>：text 是最终落库文本，blocks 供演出区分。
    //   opts: { minLen, maxLen, cardMax, emojiMax, rng, banWords, relation, bannedGroups }
    // ========================================================================
    generate: async function (charId, opts) {
      const o = opts || {};
      const gen = global.bmTypecardGenerator;
      if (!gen || typeof gen.generateContent !== 'function') {
        // 无生成器：回退一个安全占位
        return { type: 'typing_card', blocks: [{ type: 'text', text: '……' }], text: '……' };
      }
      // 角色对象（供 pickCharSticker 使用）
      let char = null;
      try {
        if (typeof characters !== 'undefined' && charId) {
          char = characters.find(function (x) { return x && x.id === charId; }) || null;
        }
      } catch (e) {}
      return await gen.generateContent({
        minLen: o.minLen,
        maxLen: o.maxLen,
        cardMax: o.cardMax,
        emojiMax: o.emojiMax,
        coherence: o.coherence,
        allowCards: o.allowCards,
        rng: o.rng,
        char: char,
        banWords: o.banWords,
        relation: o.relation,
        bannedGroups: o.bannedGroups
      });
    },

    // ========================================================================
    // V2 对外接口：startTyping(text, opts)
    //   让 engine 成为 generator session 的驱动器。
    //   text : 完整回复文本或 blocks 数组（原始内容，绝不被改写、不落半截）
    //   opts : { mistakeRate?, speedRange?, rng?, uiPlay?, speedFactor? }
    //   返回 Promise<{ text, steps, aborted, events }>
    //   实现：创建 session → playing 循环 session.next() → 每步调 ui.play(step,session)
    //         → 收到 done 结束 → 保留原始文本；abort 时返回完整原始文本（不落半截）。
    // ========================================================================
    startTyping: function (text, opts) {
      const self = this;
      const o = opts || {};
      self._state = STATE.PLAYING;
      self._stopSession = false;

      const uiPlay = (typeof o.uiPlay === 'function') ? o.uiPlay : undefined;

      return driveSession.call(self, text, o, uiPlay).then(function (res) {
        // 完成/中断后，若状态仍为 PLAYING（未被 abort 改走），回到 IDLE
        if (self._state === STATE.PLAYING) self._state = STATE.IDLE;
        return res;
      });
    },

    // 测试入口（M1）：控制台手动触发 render
    play: function (msg) {
      // 兼容两种调用：play(charId) 需自行构造 test msg；play(msgObj) 直接演出
      const m = (typeof msg === 'string')
        ? { id: global.uid ? global.uid('msg') : ('t' + Date.now()), charId: msg, from: 'them', type: 'text', content: '今天也很想见到你', time: Date.now() }
        : msg;
      return this.render(m);
    }
  };

  global.bmTypecard = engine;
})(typeof window !== 'undefined' ? window : this);
