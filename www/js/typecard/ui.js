/* ============================================================================
   白日梦 · 打字卡（Typecard）视图层 —— ui.js
   ----------------------------------------------------------------------------
   职责：占位演出气泡（ghost）的构建、插入、动画、回收检测。
   定位（V1.1 renderer 架构）：
     · ghost 只是「真实消息上屏前」的演出外壳，不承载消息生成；
     · ghost 直接 appendChild 到 #chat-scroll，绝不经过 appendMessage、绝不进 _chatWin.all。

   结构：
     .msg-row.them[data-typecard-ghost]
       └ .msg-body
           ├ .msg-avatar                     （复用 avatarHtml，继承现有头像样式）
           └ .bubble.message.message-received.typecard-ghost
               ├ .tc-panel-host              （Shadow DOM 宿主，只包输入法面板）
               └ .tc-body-preview            （正文逐字预览区，气泡内、面板下）

   Shadow DOM 只隔离输入法面板（拼音行/候选行/操作行/动画样式），
   不包裹 bubble / 背景 / 圆角 / 头像 / 正文预览——这些全部继承用户自定义气泡 CSS。
   ============================================================================ */

(function (global) {
  'use strict';

  // 主题变量透传：Shadow DOM 拿不到外层 CSS 变量，需在宿主上声明并透传进 shadow。
  // 20261008 用户要求「面板跟随气泡和气泡美化」：面板文字色不再走主题变量，
  // 改为从宿主（气泡/悬浮窗容器）继承——气泡内嵌时与美化后的气泡正文同色同风格，
  // 悬浮窗时跟随 .typecard-float-panel 的 --text。Shadow 内只剩强调色三件套
  // （紫色高亮/警示红）需要透传。
  const HOST_VARS = ['--purple', '--purple-soft', '--danger'];

  // 操作行展示的常用标点（与 generator.PUNCTUATION 一致：。 ， ？ ！ ～ 、）
  const PUNCT_LABELS = ['。', '，', '？', '！', '～', '、'];

  // 当前活动的演出 ghost（同一时刻只一条演出）。
  // engine 在 render 时 buildGhost → play(step)；play 通过此变量定位到最新 ghost，
  // 无需 engine 显式绑定（本阶段不改 engine.js）。
  let activeGhost = null;

  // 20261009：悬浮窗位置同步缓存。getSetting 是异步 Promise，若只在 then 回调里
  // 恢复 left/top，面板会先按 CSS 默认（居中底部）渲染一帧、再跳回记忆位置 → 用户看到
  // 「打开时先在初始位置闪一下」。缓存由 endDrag 同步写入，buildFloatPanel 创建后同步读取，
  // 位置一步到位、零闪烁；getSetting 仅在缓存为空时（冷启动）异步兜底。
  let _floatPanelPosCache = null;

  // 构建 Shadow DOM 面板的样式（内联注入，只作用于面板内部）
  function panelStyle() {
    return `
      :host {
        display: block;
        /* 等宽字体（规格书要求 Courier New），回退系统等宽，保证清晰 */
        font-family: 'Courier New', 'Courier Prime', 'Consolas', 'SF Mono', monospace;
        /* 20261008：不设 color——面板文字从宿主继承。气泡内嵌时继承美化气泡的正文色，
           悬浮窗时继承 .typecard-float-panel 的 --text，深浅色天然正确 */
      }
      .tc-panel {
        padding: 6px 8px;
        /* 20261008 用户要求：气泡内嵌时面板不再自带「底垫盒」，直接跟随气泡背景
           与气泡美化（文字色也从气泡继承）；悬浮窗模式则透出 .typecard-float-panel 的底色 */
        background: transparent;
        display: flex;
        flex-direction: column;
        gap: 3px;
        /* 20261008 修复「删除/确定按钮、尾部候选字溢出气泡」：
           实测旧 min-width:196px 会让面板比窄气泡宽约 49px（气泡宽度由主线 flex 布局决定，
           不随 shadow 面板 min-width 撑开），右对齐的键帽整体露在气泡外。
           现在面板恒等于宿主（气泡内容区）宽度，绝不超出气泡；
           气泡自身的宽度下限由 typecard.css 的 .typecard-ghost min-width 保证。 */
        width: 100%;
        box-sizing: border-box;
        min-width: 0;
      }
      /* 第 0 行：标题栏（呼吸圆点 + 状态文字）
         20261008 晚八轮：9px 被评「太小看不清」→ 11.5px，弱化透明度同步回升 */
      .tc-row-title {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11.5px;
        line-height: 1.25;
        letter-spacing: 0.3px;
        color: inherit;
        opacity: 0.72; /* 弱化层级：跟随气泡文字色，靠透明度区分 */
        min-height: 14px;
      }
      .tc-title-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--purple-soft, #a78bfa);
        animation: tc-breathe 1.6s ease-in-out infinite;
      }
      .tc-title-dot.tc-idle { animation: none; opacity: 0.45; }
      /* 第一行：拼音行（紧凑，字号下调；八轮 12→13px） */
      .tc-row-pinyin {
        font-size: 13px;
        line-height: 1.2;
        letter-spacing: 0.5px;
        min-height: 15px;
        color: inherit; /* 跟随气泡文字色 */
        display: flex;
        align-items: center;
        gap: 1px;
      }
      .tc-pinyin-letter {
        opacity: 0;
        display: inline-block;
      }
      .tc-caret {
        display: inline-block;
        width: 1px;
        height: 1em;
        background: currentColor;
        margin-left: 2px;
        animation: tc-blink 1s steps(1) infinite;
      }
      /* 第二行：候选字行（紧凑，字号下调） */
      .tc-row-candidate {
        display: flex;
        gap: 4px;
        flex-wrap: nowrap;
        overflow: hidden;
      }
      .tc-cand {
        flex: 0 0 auto;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
        line-height: 1.3;
        color: inherit; /* 跟随气泡文字色 */
        border: 1px solid transparent;
        opacity: 0;
        transform: translateY(2px);
      }
      .tc-cand.tc-active {
        color: #fff;
        background: var(--purple, #8b74e8);
        border-color: var(--purple-soft, #a78bfa);
        font-weight: 700;
        box-shadow: 0 0 0 1px var(--purple-soft, #a78bfa);
      }
      /* 选错：候选高亮为警示色（区别于正常选中，让玩家一眼看出选错了） */
      .tc-cand.tc-wrong {
        color: #fff;
        background: var(--danger, #c0506a);
        border-color: var(--danger, #c0506a);
        font-weight: 700;
        box-shadow: 0 0 0 1px var(--danger, #c0506a);
      }
      /* 删除：正文预览区里被删的字短暂冒红（20261008 用户要求，选字阶段不红、删除时才红） */
      @keyframes tc-del-flash {
        0%   { color: var(--danger, #c0506a); background: rgba(192,80,106,0.22); text-shadow: 0 0 4px rgba(192,80,106,0.6); }
        100% { color: inherit; background: transparent; text-shadow: none; }
      }
      .tc-del-flash { animation: tc-del-flash 0.16s ease-out; }
      /* 候选高亮闪烁反馈（选中/确定/删除瞬间） */
      @keyframes tc-cand-flash {
        0% { filter: brightness(1.6); }
        100% { filter: brightness(1); }
      }
      .tc-cand.tc-flash { animation: tc-cand-flash 0.18s ease-out; }
      /* 第三行：标点/操作行（紧凑，字号下调）
         20261008 兜底：极窄气泡下允许换行——键帽换到下一行也绝不出面板/气泡 */
      .tc-row-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        row-gap: 2px;
        gap: 6px;
        font-size: 12px;
        color: inherit;
        opacity: 0.78; /* 弱化层级：标点与键帽略淡于正文 */
        min-height: 14px;
      }
      .tc-toolbar-puncs { letter-spacing: 2px; }
      .tc-toolbar-puncs .tc-punc { cursor: default; }
      /* 单个标点高亮（选中标点的过程） */
      .tc-toolbar-puncs .tc-punc.tc-active {
        color: #fff;
        background: var(--purple, #8b74e8);
        border-radius: 2px;
        padding: 0 1px;
      }
      .tc-toolbar-keys { margin-left: auto; display: flex; gap: 4px; }
      .tc-key {
        padding: 0 5px;
        border-radius: 3px;
        /* 键帽描边跟随继承的文字色（气泡美化改字色时描边同步），灰色兜底 */
        border: 1px solid rgba(127, 127, 127, 0.45);
        border-color: color-mix(in srgb, currentColor 35%, transparent);
        font-size: 11px;
        line-height: 1.5;
        box-shadow: inset 0 1px 1px rgba(0,0,0,0.15);
      }
      /* 键帽被按下（删除/确定）瞬间的高亮反馈 */
      .tc-key.tc-pressed {
        background: var(--purple, #8b74e8);
        color: #fff;
        border-color: var(--purple-soft, #a78bfa);
        box-shadow: inset 0 1px 2px rgba(0,0,0,0.3);
      }
      @keyframes tc-blink { 0%,49%{opacity:1;} 50%,100%{opacity:0;} }
      @keyframes tc-breathe { 0%,100%{opacity:0.55; transform:scale(0.85);} 50%{opacity:1; transform:scale(1.15);} }
      /* 停顿事件的强烈呼吸（标题圆点短暂加亮） */
      @keyframes tc-breathe-strong { 0%,100%{opacity:0.6; transform:scale(0.9);} 50%{opacity:1; transform:scale(1.5);} }
      .tc-title-dot.tc-breathe-strong { animation: tc-breathe-strong 0.26s ease-in-out; }
    `;
  }

  // 构建输入法面板 Shadow DOM（只包面板，不包 bubble）
  function buildPanel(host) {
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = panelStyle();
    const panel = document.createElement('div');
    panel.className = 'tc-panel';
    panel.innerHTML = `
      <div class="tc-row-title"><span class="tc-title-dot"></span><span class="tc-title-text">碎梦重拼</span></div>
      <div class="tc-row-pinyin"><span class="tc-pinyin-track"></span><span class="tc-caret"></span></div>
      <div class="tc-row-candidate"></div>
      <div class="tc-row-toolbar">
        <span class="tc-toolbar-puncs">${PUNCT_LABELS.map(p => '<span class="tc-punc">' + p + '</span>').join('')}</span>
        <span class="tc-toolbar-keys"><span class="tc-key tc-key-del">删除</span><span class="tc-key tc-key-ok">确定</span></span>
      </div>`;
    shadow.appendChild(style);
    shadow.appendChild(panel);
    return shadow;
  }

  // 透传主题变量到 shadow 宿主（让 Shadow DOM 内 var(--xxx) 生效）。
  // 20261008：面板文字色已改为继承宿主 color，这里只透传强调色（紫/红）。
  function syncHostVars(host) {
    const cs = getComputedStyle(document.body);
    HOST_VARS.forEach(function (v) {
      const val = cs.getPropertyValue(v).trim();
      if (val) host.style.setProperty(v, val);
    });
  }

  const ui = {

    // 创建 ghost（真实消息结构 + Shadow DOM 面板 + 正文预览区），返回 ghost 节点
    buildGhost: function (replyMsg) {
      // app.js 顶层 let characters 不挂 window，必须直接按变量名访问（共享全局词法环境）
      let chars = [];
      try { if (typeof characters !== 'undefined') chars = characters; } catch (e) {}
      const c = chars.find(x => x.id === replyMsg.charId);
      const name = c ? c.name : '梦角';
      const avatar = c ? c.avatar : '';
      const avatarHtml = (typeof global.avatarHtml === 'function')
        ? global.avatarHtml(avatar, name)
        : '<div class="msg-avatar">' + (name ? name[0] : '?') + '</div>';

      const ghost = document.createElement('div');
      ghost.className = 'msg-row them';
      ghost.setAttribute('data-typecard-ghost', '1');

      const body = document.createElement('div');
      body.className = 'msg-body';

      const bubble = document.createElement('div');
      bubble.className = 'bubble message message-received typecard-ghost';

      const host = document.createElement('div');
      host.className = 'tc-panel-host';
      syncHostVars(host);
      const shadow = buildPanel(host);

      const preview = document.createElement('div');
      preview.className = 'tc-body-preview';

      bubble.appendChild(host);
      bubble.appendChild(preview);
      body.appendChild(bubble);
      ghost.appendChild(body);
      // 头像放在 msg-body 外、msg-row 内（与现有 .msg-row.them 布局对齐，头像在最左）
      ghost.insertBefore(_avatarNode(avatarHtml), ghost.firstChild);

      ghost._shadow = shadow;
      ghost._preview = preview;
      ghost._charId = replyMsg.charId; // 20261009：供图片表情实时抽图（emoji 块不含 charId）
      ghost._tc = {          // 渲染上下文：play(step) 期间维护
        committed: '',       // 正文预览区当前已显示的文本（= session.text 的镜像）
        caret: null          // 拼音行光标节点引用
      };
      activeGhost = ghost;   // 绑定为当前活动 ghost（供 play 定位）
      return ghost;
    },

    // 插入 chat-scroll（不经过 appendMessage、不进 _chatWin.all）
    insertGhost: function (ghost) {
      const scroll = global.$ ? global.$('#chat-scroll') : document.getElementById('chat-scroll');
      if (!scroll) return false;
      scroll.appendChild(ghost);
      if (typeof global.scrollToBottom === 'function') global.scrollToBottom();
      return true;
    },

    // ======================================================================
    // float（悬浮窗）模式：创建独立悬浮面板，挂到 document.body。
    // 与 buildGhost 的差异只有「容器」：
    //   · 不嵌聊天气泡、不放头像，直接一个 position:fixed 的独立面板；
    //   · 内部复用同一套 buildPanel(host)（Shadow DOM 输入法面板）+ preview 正文预览，
    //     并挂上 _shadow / _preview / _tc 三个关键属性，让 play(step) 完全复用不重写。
    // 返回的面板节点具备与 ghost 相同的内部契约，engine 生命周期（_finish/abort/watchGhost）
    // 与 removeGhost/destroyGhost/fadeGhost 对面板同样适用（只依赖 parentNode / classList）。
    // ======================================================================
    buildFloatPanel: function (replyMsg, opts) {
      const o = opts || {};
      const panel = document.createElement('div');
      panel.className = 'typecard-float-panel';
      panel.setAttribute('data-typecard-float', '1');

      // 20261010 终极根治：不再用 .tc-bd-clip 内层裁切层。这个「圆角裁切层」的
      //   overflow:hidden + backdrop-filter 组合在 App WebView 里采样错位、露出直角
      //   玻璃边=「上面一层遮罩」。玻璃拟态元素(.modal/.chat-panel)无此层、backdrop
      //   直接挂本体，实测无遮罩——悬浮窗改成同构：backdrop-filter 直接挂面板本体，
      //   圆角靠 border-radius 自然生效。

      // 复用输入法面板（Shadow DOM）——与 bubble 完全同一套
      const host = document.createElement('div');
      host.className = 'tc-panel-host';
      syncHostVars(host);
      const shadow = buildPanel(host);

      // 复用正文预览区
      const preview = document.createElement('div');
      preview.className = 'tc-body-preview';

      panel.appendChild(host);
      panel.appendChild(preview);

      // 20261008 晚（碎梦重拼召唤）：summon 形态比普通悬浮窗多一个「生成一条消息」按钮。
      // 演出面板同样带按钮（engine 在演出开始时禁用，结束后随待机面板重建恢复）。
      if (o.summon) {
        const btnRow = document.createElement('div');
        btnRow.className = 'tc-summon-row';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tc-summon-btn';
        btn.innerHTML = '<span class="tc-summon-ico">✦</span><span class="tc-summon-label">生成一条消息</span>';
        // 按钮不触发面板整块拖拽（拖拽监听在 panel 上，stopPropagation 隔离）
        btn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          if (typeof ui._onSummonTap === 'function') { try { ui._onSummonTap(); } catch (e) {} }
        });
        btnRow.appendChild(btn);
        panel.appendChild(btnRow);
        panel._summonBtn = btn;
      }

      panel._shadow = shadow;
      panel._preview = preview;
      // 20261009 晚根因修复：待机面板/召唤面板走 buildFloatPanel(null)，replyMsg.charId
      // 直接 TypeError → toggleFloatPanel/toggleSummonPanel/_ensureSummonPanel 全链炸掉、
      // 异常被 _onDotTap 的 catch 静默吞掉 = 「圆点点击完全没反应」「待机面板建不出来」真因。
      // 待机面板不演出不需要抽图，charId 置 null 即可（演出面板传真消息不受影响）。
      panel._charId = (replyMsg && replyMsg.charId) ? replyMsg.charId : null;
      panel._tc = {
        committed: '',
        caret: null
      };
      // 20261008 用户要求：去掉三横杠手柄（丑），整块面板都能拖动
      // （按钮已 stopPropagation 隔离，其余区域纯视觉，整块拖拽不误触任何功能）
      _makeDraggable(panel);
      // 20261008 用户要求：记住上次拖到的位置，下次打开原地出现
      // （恢复时按当前视口钳制，防旋屏/小屏后位置出界；无记忆走默认底部居中）。
      // 20261009 修复「打开先在初始位置闪一下」：优先用同步缓存 _floatPanelPosCache
      // 一步到位定位（零闪烁）；缓存为空（冷启动）才异步 getSetting 兜底。
      const _applyPos = function (pos) {
        if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
          const vw = window.innerWidth || document.documentElement.clientWidth;
          const vh = window.innerHeight || document.documentElement.clientHeight;
          const w = panel.offsetWidth || 280;
          const h = panel.offsetHeight || 180;
          const nx = Math.max(6, Math.min(pos.left, vw - w - 6));
          const ny = Math.max(6, Math.min(pos.top, vh - h - 6));
          panel.style.left = nx + 'px';
          panel.style.top = ny + 'px';
          panel.style.bottom = 'auto';
          panel.style.right = 'auto';
          panel.style.transform = 'none';
          return true;
        }
        return false;
      };
      if (_floatPanelPosCache) {
        _applyPos(_floatPanelPosCache);
      } else {
        try {
          if (typeof global.getSetting === 'function') {
            global.getSetting('typecardFloatPanelPos', null).then(function (pos) {
              if (_applyPos(pos)) { _floatPanelPosCache = pos; }
            }).catch(function () {});
          }
        } catch (e) {}
      }
      activeGhost = panel;   // 绑定为当前活动演出节点（供 play 定位）
      return panel;
    },

    // 插入 document.body（脱离聊天列表 DOM：不受滚动/overflow/max-height 影响）。
    insertFloatPanel: function (panel) {
      if (!panel) return false;
      document.body.appendChild(panel);
      return true;
    },

    // 20261009：预取悬浮窗记忆位置填内存缓存（冷启动首次打开也同步定位、零闪跳）。
    // engine 在初始化时调一次，之后 buildFloatPanel 直接走同步缓存，不再等异步 getSetting。
    preloadFloatPos: function () {
      if (_floatPanelPosCache) return;
      try {
        if (typeof global.getSetting === 'function') {
          global.getSetting('typecardFloatPanelPos', null).then(function (pos) {
            if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
              _floatPanelPosCache = pos;
            }
          }).catch(function () {});
        }
      } catch (e) {}
    },

    // ======================================================================
    // 悬浮窗模式 · 常驻圆点（20261008 用户要求：悬浮窗是常驻的，普通状态下
    // 就是一个圆点，玩家点击才会展开）。engine 调 ensureFloatDot/hideFloatDot
    // 控制显隐；点击（无移动）回调 ui._onDotTap（由 engine 注入展开/收起逻辑）。
    // ======================================================================
    ensureFloatDot: function () { return ensureFloatDot(); },
    hideFloatDot: function () { hideFloatDot(); },
    _onDotTap: null,
    // 碎梦重拼召唤：悬浮窗「生成一条消息」按钮回调（engine._ensureSummonPanel 注入）
    _onSummonTap: null,

    // ======================================================================
    // play(step, session)：step → 视觉变化（V2 新驱动核心，纯渲染，无业务逻辑）
    // ----------------------------------------------------------------------
    // engine 逐次调用：session.next() 得到一个 step，再调 ui.play(step, session)
    // 让三行面板 + 正文预览区呈现对应的「真实打字过程」。
    // 本方法只做视觉，不决策、不计算步骤、不碰业务/DB。
    // 返回 Promise（多数 step 立即 resolve，供 engine await 衔接节奏）。
    // ======================================================================
    play: function (step, session) {
      if (!step) return Promise.resolve();
      const ghost = activeGhost;
      if (!ghost || !ghost._shadow || !ghost._tc) {
        // 无活动 ghost 时静默忽略（容错：engine 未绑定 ghost 或已回收）
        return Promise.resolve();
      }
      const ctx = ghost._tc;
      const shadow = ghost._shadow;

      const pinyinTrack = shadow.querySelector('.tc-pinyin-track');
      const candidateRow = shadow.querySelector('.tc-row-candidate');
      const titleText = shadow.querySelector('.tc-title-text');
      const titleDot = shadow.querySelector('.tc-title-dot');

      const type = step.type;

      try {
        switch (type) {

          // ---- 拼音逐字母敲出：把字母追加到拼音轨，光标闪烁 ----
          case 'letter': {
            _clearPinyinTrack(pinyinTrack);
            // 还原已敲出的字母（letterIndex 之前的所有字母）
            const pinyin = step.pinyin || '';
            const letters = Array.from(pinyin);
            const done = step.letterIndex; // 已完成的字母数（不含当前）
            for (let i = 0; i <= done && i < letters.length; i++) {
              const sp = document.createElement('span');
              sp.className = 'tc-pinyin-letter';
              sp.textContent = letters[i];
              sp.style.opacity = '1';
              pinyinTrack.appendChild(sp);
            }
            _ensureCaret(pinyinTrack);
            break;
          }

          // ---- 候选字弹出：填充候选行。紫色目标字高亮常驻（20261008 用户要求恢复）：
          //      · 目标字 tc-active 紫色高亮（选中标记，永远显示）；
          //      · 选字阶段不再显示红色标记（用户 20261008 要求：红色只在删除时冒一下）。
          //      拼音轨保持完整拼音（真实输入法候选期间拼音不消失）。
          case 'candidate': {
            _renderPinyinFull(pinyinTrack, step.pinyin);
            _clearCandidate(candidateRow);
            const cands = step.candidates || [];
            const target = step.target;
            cands.forEach(function (c) {
              const el = document.createElement('span');
              el.className = 'tc-cand' + (c === target ? ' tc-active' : '');
              el.textContent = c;
              el.style.opacity = '1';
              el.style.transform = 'translateY(0)';
              candidateRow.appendChild(el);
            });
            break;
          }

          // ---- 选错（兼容旧驱动保留的独立 mistake 事件，新版已并入 candidate.wrong，此 case 兜底） ----
          case 'mistake': {
            _renderPinyinFull(pinyinTrack, step.pinyin);
            _clearCandidate(candidateRow);
            const cands = step.candidates || [];
            cands.forEach(function (c) {
              const el = document.createElement('span');
              el.className = 'tc-cand';
              el.textContent = c;
              el.style.opacity = '1';
              el.style.transform = 'translateY(0)';
              candidateRow.appendChild(el);
            });
            break;
          }

          // ---- 选字上屏：正文预览区追加字；错字/正确字分别处理 ----
          case 'pick': {
            const ch = step.ch;
            if (ch) {
              _appendPreviewChar(ghost, ch);
              ctx.committed += ch;
              _flashCandidate(candidateRow, ch, step.isMistake);
            }
            // 选中后清空候选行（准备下一字）
            _clearCandidate(candidateRow);
            _clearPinyinTrack(pinyinTrack);
            break;
          }

          // ---- 删除：正文预览区移除末尾字（删掉刚上屏的错字） ----
          case 'delete': {
            const removed = step.removed || '';
            _removePreviewChars(ghost, removed);
            if (removed) {
              ctx.committed = ctx.committed.slice(0, ctx.committed.length - removed.length);
            }
            // 删除键按下的反馈
            const delKey = shadow.querySelector('.tc-key-del');
            if (delKey) _flashKey(delKey);
            _clearCandidate(candidateRow);
            break;
          }

          // ---- 标点：操作行高亮对应标点，正文预览区追加标点 ----
          case 'punct': {
            const ch = step.ch;
            if (ch) {
              // 操作行高亮该标点
              const puncs = shadow.querySelectorAll('.tc-toolbar-puncs .tc-punc');
              puncs.forEach(function (p) {
                if (p.textContent === ch) {
                  p.classList.add('tc-active');
                  p.style.transition = 'opacity .12s';
                  p.classList.add('tc-flash');
                }
              });
              // 确定键按下的反馈（标点上屏相当于按了确定）
              const okKey = shadow.querySelector('.tc-key-ok');
              if (okKey) _flashKey(okKey);
              _appendPreviewChar(ghost, ch);
              ctx.committed += ch;
            }
            break;
          }

          // ---- 收尾：标题栏置空闲态，清空拼音/候选 ----
          case 'done': {
            _clearPinyinTrack(pinyinTrack);
            _clearCandidate(candidateRow);
            if (titleText) titleText.textContent = '碎梦重拼';
            if (titleDot) titleDot.classList.add('tc-idle');
            break;
          }

          // ---- 字卡（块事件）：完整字卡飞入，绝不拆进正文逐字打 ----
          case 'card': {
            // blocks 格式：{ type:'card', text, data:{ source, label?, bg?, color? } }
            // 兼容旧 eventManager 格式：{ type:'card', card:{ label, bg, color } }
            const cardData = step.data || step.card || {};
            const label = cardData.label || step.text || '梦';
            _showCardOverlay(ghost, {
              label: label,
              bg: cardData.bg || '#3a2b6e',
              color: cardData.color || '#e9e4ff'
            });
            // 字卡块文本也要进入正文预览区（它是最终消息内容的一部分，完整块上屏）
            if (step.text) {
              _appendPreviewChar(ghost, step.text);
              ctx.committed += step.text;
            }
            break;
          }

          // ---- 表情（块事件）：完整表情飞入，不拆进正文 ----
          case 'emoji': {
            // blocks 格式：{ type:'emoji', text, data:{ source, img?, sticker? } }
            // 兼容旧格式：{ type:'emoji', emoji: '😊' }
            // 20261009 OOM/显示修复：data.img===true 表示「图片表情」，演出时实时从角色库
            // 抽一张图渲染成 <img>（落库不存 base64，图不再丢失，也不再撑爆内存）。
            const emojiText = step.text || step.emoji || '✨';
            const emojiData = step.data || {};
            if (emojiData.img === true) {
              // 图片表情：抽一张真实图 → 只在正文预览区显示（小图、按卡片尺寸）。
              // 20261009 晚（用户定稿）：演出「居中弹出大图」浮层（_showEmojiImage）已删——
              // 大图不按卡片尺寸裁切、溢出面板顶部与面板边缘叠出「拼接缝」观感；
              // 函数定义保留为死代码（历史参考），不再调用。
              const cid = ghost._charId;
              _appendPreviewImg(ghost, cid);
            } else {
              _showEmojiOverlay(ghost, emojiText);
              _appendPreviewChar(ghost, emojiText);
              ctx.committed += emojiText;
            }
            break;
          }

          // ---- 停顿（非输入事件）：纯节奏停顿，无视觉变化（或轻微光标呼吸） ----
          case 'pause': {
            // 无视觉副作用：停顿由 engine 的延时控制承担，这里可选让标题呼吸点闪一下
            if (titleDot) {
              titleDot.classList.add('tc-breathe-strong');
              setTimeout(function () { titleDot.classList.remove('tc-breathe-strong'); }, 260);
            }
            break;
          }

          default:
            break;
        }
      } catch (e) {
        // 渲染异常不阻断 engine 流程
      }

      // 正文预览区滚动到底（长文本时跟随最新内容，但不裁切、完整保留）
      _scrollPreviewToBottom(ghost);

      return Promise.resolve();
    },

    // 播放逐字演出动画：拼音逐字母 → 候选弹出 → 选中 → 上屏到正文预览。
    // 全程 transform/opacity，不改变外层高度。
    playTyping: function (ghost, replyMsg) {
      const text = String(replyMsg.content || '');
      const pinyins = (global.bmTypecardData && global.bmTypecardData.buildPinyin)
        ? global.bmTypecardData.buildPinyin(text)
        : [];
      const shadow = ghost._shadow;
      const preview = ghost._preview;
      const pinyinTrack = shadow.querySelector('.tc-pinyin-track');
      const candidateRow = shadow.querySelector('.tc-row-candidate');

      // 逐字演出，返回 Promise（resolved 时全部上屏完成）
      return new Promise(function (resolve) {
        const chars = Array.from(text);
        let ci = 0;

        // 判断字符是否为 emoji（含代理对/组合 emoji），用于快速通道的停顿节奏
        function isEmoji(ch) {
          if (!ch) return false;
          const cp = ch.codePointAt(0);
          // 覆盖常见 emoji 区段：Misc Symbols、Dingbats、Emoticons、Transport、Supplemental 等
          return (cp >= 0x1F300 && cp <= 0x1FAFF) ||
                 (cp >= 0x2600 && cp <= 0x27BF) ||
                 (cp >= 0x2190 && cp <= 0x21FF && ch.length > 1);
        }

        // 直接上屏一个字符到正文预览（中文选中上屏 / 非汉字快速通道共用）
        function appendPreviewChar(ch) {
          const span = document.createElement('span');
          span.textContent = ch;
          span.style.opacity = '0';
          span.style.transition = 'opacity .18s';
          preview.appendChild(span);
          requestAnimationFrame(function () { span.style.opacity = '1'; });
        }

        function step() {
          if (ci >= chars.length) { resolve(); return; }
          const ch = chars[ci];
          const py = pinyins[ci] || '';

          // ============ 任务2：非汉字快速通道 ============
          // buildPinyin 对非汉字（标点/emoji/换行/空格/英文数字）返回 ''，
          // 此时不走拼音/候选/选中三段动画，直接快速上屏，节奏显著缩短。
          if (py === '') {
            let delay;
            if (ch === '\n') {
              delay = 40;               // 换行：立即处理
            } else if (isEmoji(ch)) {
              delay = 240;              // emoji：短暂停顿后出现
            } else {
              delay = 170;              // 标点/空格/英文数字：快速出现
            }
            // 清空拼音轨，保持「无拼音输入中」的干净状态
            pinyinTrack.innerHTML = '';
            candidateRow.innerHTML = '';
            setTimeout(function () { appendPreviewChar(ch); }, delay);
            ci++;
            setTimeout(step, delay + 40);
            return;
          }

          // ============ 任务1：拼音轨实时化 ============
          // 进入每个中文字符演出前清空拼音轨，只显示「当前正在输入的字」的拼音，
          // 避免多字拼音无限堆积（今→jin，天→tian，而不是 jin tian yong...）。
          pinyinTrack.innerHTML = '';

          // 1) 拼音逐字母出现
          {
            const letters = Array.from(py);
            letters.forEach(function (l, li) {
              const sp = document.createElement('span');
              sp.className = 'tc-pinyin-letter';
              sp.textContent = l;
              pinyinTrack.appendChild(sp);
              setTimeout(function () { sp.style.transition = 'opacity .12s'; sp.style.opacity = '1'; }, li * 60);
            });
          }

          // 2) 候选字弹出（含目标字高亮）
          const cands = (global.bmTypecardData && global.bmTypecardData.buildCandidates)
            ? global.bmTypecardData.buildCandidates(py, ch)
            : [ch];
          // 清空上一步候选
          candidateRow.innerHTML = '';
          const targetIdx = cands.indexOf(ch) >= 0 ? cands.indexOf(ch) : 0;
          cands.forEach(function (c, i) {
            const el = document.createElement('span');
            el.className = 'tc-cand' + (i === targetIdx ? ' tc-active' : '');
            el.textContent = c;
            candidateRow.appendChild(el);
            setTimeout(function () {
              el.style.transition = 'opacity .15s, transform .15s';
              el.style.opacity = '1';
              el.style.transform = 'translateY(0)';
            }, i * 40);
          });

          // 3) 选中上屏到正文预览
          setTimeout(function () {
            appendPreviewChar(ch);
          }, Math.max(320, cands.length * 40 + 160));

          ci++;
          // ============ 任务：长消息节奏动态加速 ============
          // 按消息总字数分档调速：短消息（<=8 字）保持原速，中消息（9~16 字）提速 15%，
          // 长消息（>16 字）提速 30%。per 下限 320ms，避免下一字提前开始与候选选中阶段重叠。
          const basePer = py.length * 60 + 360;
          const speedFactor =
            chars.length <= 8 ? 1 :
            chars.length <= 16 ? 0.85 :
            0.7;
          const per = Math.max(320, Math.floor(basePer * speedFactor));
          setTimeout(step, per);
        }
        step();
      });
    },

    // 淡出移除 ghost（演出完成、真消息已上屏后调用）
    removeGhost: function (ghost) {
      if (activeGhost === ghost) activeGhost = null;
      if (!ghost || !ghost.parentNode) return;
      ghost.classList.add('tc-fading');
      ghost.addEventListener('transitionend', function h() {
        ghost.removeEventListener('transitionend', h);
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      });
      // 兜底：过渡未触发时强制移除
      setTimeout(function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 300);
    },

    // 立即移除 ghost（异常退出，无淡出）
    destroyGhost: function (ghost) {
      if (activeGhost === ghost) activeGhost = null;
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    },

    // 打断收尾专用淡出：加 .tc-fading → 过渡结束（或 180ms 兜底）→ 移除 → onDone()。
    // 与 removeGhost 的区别：removeGhost 不回调、服务于演出完成后的静默淡出；
    // fadeGhost 带 onDone 回调，供打断链路在淡出完成后落地真消息（衔接 appendMessage）。
    fadeGhost: function (ghost, onDone) {
      if (!ghost) { if (onDone) onDone(); return; }
      if (!ghost.parentNode) { if (onDone) onDone(); return; }
      let done = false;
      const finish = function () {
        if (done) return;
        done = true;
        if (activeGhost === ghost) activeGhost = null;
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
        if (onDone) onDone();
      };
      ghost.classList.add('tc-fading');
      ghost.addEventListener('transitionend', function h() {
        ghost.removeEventListener('transitionend', h);
        finish();
      });
      // 兜底：transition 未触发时强制完成
      setTimeout(finish, 180);
    },

    // 挂 MutationObserver：只检测 ghost 被 renderMessages 意外清掉（脱离文档）。
    // 只在检测到「从文档移除」时回调，绝不在此 append 回节点。
    watchGhost: function (ghost, onRecycled) {
      if (typeof MutationObserver === 'undefined') return null;
      const observer = new MutationObserver(function () {
        if (!ghost.isConnected) {
          observer.disconnect();
          if (onRecycled) onRecycled(ghost);
        }
      });
      observer.observe(ghost.parentNode || ghost, { childList: true, subtree: false });
      // 也监听自身被移除（若 parent 整体被清空，父节点可能先断开）
      observer.observe(ghost, { childList: true, subtree: true });
      return observer;
    }
  };

  function _avatarNode(avatarHtml) {
    const wrap = document.createElement('div');
    wrap.innerHTML = avatarHtml;
    return wrap.firstChild;
  }

  // ======================================================================
  // 悬浮窗拖拽（20261008 用户要求：去掉手柄，整块面板都能拖动）。
  // 只做「定位」：pointerdown 记起点 → pointermove 更新位置 → pointerup 结束。
  // 铁律：
  //   · 20261009 晚终版：拖动位移改 transform: translate3d——纯合成器动画，
  //     不触发主线程 layout/paint。left/top 位移会让 backdrop-filter 面板每帧
  //     重排+重绘（主线程）再叠加模糊重采样（合成线程），移动端 GPU 扛不住 →
  //     磨砂闪烁（「拖动时跳来跳去」根因）。translate3d 只走合成器，
  //     磨砂层恒定渲染，拖动全程稳定。
  //   · 按下时把「居中/记忆定位」固化成显式 left/top（一次 layout，无视觉变化）；
  //     拖动中只写 transform（钳制后的位移量）；松手把最终位置写回 left/top、
  //     transform 清 none（同帧同位，无跳变）。
  //   · 边界钳制在视口内（左右/上下留 6px），绝不拖出屏幕；
  //   · 松手记住位置（kv typecardFloatPanelPos），下次打开原地出现。
  // ======================================================================
  function _makeDraggable(panel) {
    if (!panel) return;
    let drag = null; // { sx, sy, ox, oy, pid, maxDx, minDx, maxDy, minDy }
    let moved = false;

    try { panel.style.touchAction = 'none'; panel.style.cursor = 'grab'; } catch (e) {}

    panel.addEventListener('pointerdown', function (e) {
      // 只响应主键 / 单指
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      // 把「居中定位 / 记忆定位」切换成「显式坐标定位」（同帧同位，无视觉跳变）
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.transform = 'none';
      // 预计算位移钳制范围（拖动中直接用，不再读 offsetWidth 触发强制布局）
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const MARGIN = 6;
      drag = {
        sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, pid: e.pointerId,
        minDx: MARGIN - rect.left,         maxDx: vw - w - MARGIN - rect.left,
        minDy: MARGIN - rect.top,          maxDy: vh - h - MARGIN - rect.top
      };
      moved = false;
      try { panel.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });

    panel.addEventListener('pointermove', function (e) {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return; // 防手抖：微移不算拖拽
      moved = true;
      // 纯合成器位移：translate3d（不碰 left/top，零 layout/paint）
      const tx = Math.max(drag.minDx, Math.min(dx, drag.maxDx));
      const ty = Math.max(drag.minDy, Math.min(dy, drag.maxDy));
      drag.lastTx = tx; drag.lastTy = ty;   // 记录最后钳制位移（pointercancel 时 event 坐标不可靠）
      panel.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0)';
      e.preventDefault();
    });

    function endDrag(e) {
      if (!drag) return;
      try { if (drag.pid != null) panel.releasePointerCapture(drag.pid); } catch (err) {}
      const d = drag;
      drag = null;
      // 松手：把钳制后的最终位置写回 left/top，transform 清 none（与当前视觉同位，无跳变）
      // 位移用 pointermove 记录的最后值（pointercancel 的 clientX/Y 不可靠）
      const tx = (typeof d.lastTx === 'number') ? d.lastTx : 0;
      const ty = (typeof d.lastTy === 'number') ? d.lastTy : 0;
      panel.style.left = (d.ox + tx) + 'px';
      panel.style.top = (d.oy + ty) + 'px';
      panel.style.transform = 'none';
      // 松手记住位置：下次打开原地出现（20261008 用户要求）
      if (moved) {
        const savedPos = {
          left: parseFloat(panel.style.left) || 0,
          top: parseFloat(panel.style.top) || 0
        };
        // 20261009：同步更新内存缓存，下次 buildFloatPanel 一步到位（消除打开闪跳）
        _floatPanelPosCache = savedPos;
        try {
          if (typeof global.setSetting === 'function') {
            global.setSetting('typecardFloatPanelPos', savedPos);
          }
        } catch (err) {}
      }
    }
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
  }


  // ======================================================================
  // 悬浮窗常驻圆点（20261008）：双圈靶心形态（规格 D：悬浮窗模式=常驻双圈）。
  // 铁律：
  //   · 视觉圆点 22px（直径 18-24px 区间），热区 44px；
  //   · 按住移动超 5px=拖动，松手吸附屏幕左/右缘（规格 D）；
  //   · 位置存 kv（typecardFloatDotPos），下次进入聊天页恢复；
  //   · 点击（无移动）→ ui._onDotTap()（engine 注入：展开/收起悬浮窗面板）。
  // ======================================================================
  let floatDot = null;
  let floatDotPos = null;          // { side: 'left'|'right'|null, left: 热区左 px, top: 视觉圆点顶部 px }
  const DOT_VISUAL = 22;           // 视觉圆点直径
  const DOT_HIT = 44;              // 热区边长
  const DOT_EDGE = 10;             // 吸附后视觉圆点距屏幕左右缘
  const DOT_TOP_MIN = 64;          // 顶部栏之下
  const DOT_SNAP = 28;             // 贴边吸附阈值：热区左缘距屏缘 ≤ 此值即吸附
  const DOT_DEFAULT_POS = { side: 'right', left: null, top: 96 }; // 默认：聊天记录区右上角（顶部栏下方）

  function _dotClampTop(top) {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return Math.max(DOT_TOP_MIN, Math.min(top, vh - DOT_VISUAL - 90));
  }
  // 热区 left = 视觉圆点目标 x - 热区与视觉圆点的半径差
  function _dotHitX(side) {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const pad = (DOT_HIT - DOT_VISUAL) / 2;
    return side === 'left' ? (DOT_EDGE - pad) : (vw - DOT_EDGE - DOT_VISUAL - pad);
  }
  // 视觉圆点顶部 px（从热区 top 换算：热区比视觉圆点上下各多 (DOT_HIT-DOT_VISUAL)/2）
  function _dotVisualTopFromHit(hitTop) {
    return hitTop + (DOT_HIT - DOT_VISUAL) / 2;
  }
  function _dotApplyPos() {
    if (!floatDot) return;
    const pos = floatDotPos || DOT_DEFAULT_POS;
    // 贴边态：吸附到对应边缘；自由态：用记忆的 left（未记忆则回默认）
    if (pos.side === 'left' || pos.side === 'right') {
      floatDot.style.left = _dotHitX(pos.side) + 'px';
    } else if (typeof pos.left === 'number') {
      const vw = window.innerWidth || document.documentElement.clientWidth;
      floatDot.style.left = Math.max(0, Math.min(pos.left, vw - DOT_HIT)) + 'px';
    } else {
      floatDot.style.left = _dotHitX('right') + 'px';
    }
    floatDot.style.top = _dotClampTop(pos.top) + 'px';
  }

  function _makeDotInteractive(dot) {
    let drag = null;
    let moved = false;
    dot.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const rect = dot.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, pid: e.pointerId };
      moved = false;
      try { dot.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    dot.addEventListener('pointermove', function (e) {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // 超 5px 才算拖动
      moved = true;
      dot.classList.add('tfd-dragging');
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      let nx = drag.ox + dx;
      let ny = drag.oy + dy;
      // 拖动中粗钳制不出屏；精确吸附在松手时做
      nx = Math.max(0, Math.min(nx, vw - DOT_HIT));
      ny = Math.max(DOT_TOP_MIN - 11, Math.min(ny, vh - DOT_HIT - 80));
      dot.style.left = nx + 'px';
      dot.style.top = ny + 'px';
      e.preventDefault();
    });
    function endDrag() {
      if (!drag) return;
      try { if (drag.pid != null) dot.releasePointerCapture(drag.pid); } catch (err) {}
      drag = null;
      dot.classList.remove('tfd-dragging');
      if (moved) {
        // 松手定位：只有「贴边」才吸附到屏幕左/右缘；否则停在松手位置（拖到哪停到哪）
        const rect = dot.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const hitLeft = rect.left;                       // 热区左缘（left 存的就是热区 left）
        const visualTop = _dotVisualTopFromHit(rect.top); // 视觉圆点顶部
        if (hitLeft <= DOT_SNAP) {
          floatDotPos = { side: 'left', left: null, top: visualTop };
        } else if (hitLeft + rect.width >= vw - DOT_SNAP) {
          floatDotPos = { side: 'right', left: null, top: visualTop };
        } else {
          floatDotPos = { side: null, left: hitLeft, top: visualTop };
        }
        _dotApplyPos();
        try {
          if (typeof global.setSetting === 'function') global.setSetting('typecardFloatDotPos', floatDotPos);
        } catch (err) {}
      } else if (typeof ui._onDotTap === 'function') {
        try { ui._onDotTap(); } catch (err) {}
      } else {
        // 20261009 兜底：圆点残留显示但无点击回调（开关已关、_onDotTap 被置 null 的竞态残留）——
        // 点一下自动隐藏圆点，避免「圆点是摆设、点了没反应」的卡死观感。
        try { hideFloatDot(); } catch (err) {}
      }
    }
    dot.addEventListener('pointerup', endDrag);
    dot.addEventListener('pointercancel', endDrag);
  }

  // 显示圆点（不存在则创建 + 恢复记忆位置）
  function ensureFloatDot() {
    if (!floatDot) {
      floatDot = document.createElement('div');
      floatDot.className = 'typecard-float-dot';
      floatDot.setAttribute('data-typecard-dot', '1');
      floatDot.innerHTML = '<span class="tfd-ring"></span><span class="tfd-core"></span>';
      _makeDotInteractive(floatDot);
      document.body.appendChild(floatDot);
      // 恢复上次拖拽记忆的位置；无记忆用默认（聊天记录区右上角，顶部栏下方）
      try {
        if (typeof global.getSetting === 'function') {
          global.getSetting('typecardFloatDotPos', null).then(function (p) {
            // 兼容新旧格式：旧 { side:'left'|'right', top }；新 { side:side|null, left, top }
            if (p && typeof p.top === 'number') {
              if (p.side === 'left' || p.side === 'right') {
                floatDotPos = { side: p.side, left: null, top: p.top };
              } else if (typeof p.left === 'number') {
                floatDotPos = { side: null, left: p.left, top: p.top };
              }
              _dotApplyPos();
            }
          }).catch(function () {});
        }
      } catch (e) {}
    }
    _dotApplyPos();
    floatDot.style.display = 'flex';
    return floatDot;
  }

  // 隐藏圆点（不销毁：保留节点与位置状态，切回悬浮窗模式时原位复现）
  function hideFloatDot() {
    if (floatDot) floatDot.style.display = 'none';
  }

  // ======================================================================
  // play() 的渲染辅助函数（纯视觉 DOM 操作，无业务逻辑）
  // ======================================================================

  // 清空拼音轨
  function _clearPinyinTrack(track) {
    if (track) track.innerHTML = '';
  }

  // 清空候选行
  function _clearCandidate(row) {
    if (row) row.innerHTML = '';
  }

  // 确保拼音行末尾有闪烁光标（每次字母变化后调用）
  function _ensureCaret(track) {
    if (!track) return;
    let caret = track.querySelector('.tc-caret');
    if (!caret) {
      caret = document.createElement('span');
      caret.className = 'tc-caret';
      track.appendChild(caret);
    }
  }

  // 渲染完整拼音 + 光标（候选/重选期间拼音保持显示，贴近真实输入法）。
  // pinyin 为空时 no-op（保持当前状态，不误清已有字母）。
  function _renderPinyinFull(track, pinyin) {
    if (!track || !pinyin) return;
    _clearPinyinTrack(track);
    Array.from(pinyin).forEach(function (l) {
      const sp = document.createElement('span');
      sp.className = 'tc-pinyin-letter';
      sp.textContent = l;
      sp.style.opacity = '1';
      track.appendChild(sp);
    });
    _ensureCaret(track);
  }

  // 正文预览区追加一个字符（带淡入动画）
  function _appendPreviewChar(ghost, ch) {
    const preview = ghost._preview;
    if (!preview) return;
    const span = document.createElement('span');
    span.textContent = ch;
    span.style.opacity = '0';
    span.style.transition = 'opacity .15s';
    preview.appendChild(span);
    requestAnimationFrame(function () { span.style.opacity = '1'; });
  }

  // 正文预览区移除末尾 N 个字符（按字符数从后往前删）
  // 20261008 用户要求：删除时被删的字要冒一下红色标记，再消失。
  function _removePreviewChars(ghost, removed) {
    const preview = ghost._preview;
    if (!preview) return;
    const n = Array.from(removed).length;
    // 先给末尾要删的字上红色闪一下（tc-del-flash），再删。
    const doomed = [];
    let cur = preview.lastChild;
    for (let i = 0; i < n && cur; i++) {
      doomed.push(cur);
      cur = cur.previousSibling;
    }
    doomed.forEach(function (el) {
      el.classList.add('tc-del-flash');
    });
    // 红色冒一下后（约 160ms）再真正移除
    setTimeout(function () {
      for (let i = 0; i < n; i++) {
        if (preview.lastChild) preview.removeChild(preview.lastChild);
      }
    }, 160);
  }

  // 候选行里对某个字做闪烁反馈（选错=警示闪烁，正常=高亮闪烁）
  function _flashCandidate(row, ch, isMistake) {
    if (!row) return;
    const cands = row.querySelectorAll('.tc-cand');
    cands.forEach(function (el) {
      if (el.textContent === ch) {
        el.classList.add('tc-flash');
      }
    });
  }

  // 键帽按下的闪烁反馈
  function _flashKey(key) {
    if (!key) return;
    key.classList.add('tc-pressed');
    setTimeout(function () { key.classList.remove('tc-pressed'); }, 120);
  }

  // 正文预览区滚动到底（长文本跟随最新内容，不裁切）
  function _scrollPreviewToBottom(ghost) {
    const preview = ghost._preview;
    if (!preview) return;
    if (preview.scrollHeight > preview.clientHeight) {
      preview.scrollTop = preview.scrollHeight;
    }
  }

  // ======================================================================
  // 非输入事件演出层（card / emoji / pause 的视觉呈现）
  // 铁律：这些 overlay 只浮在气泡上方做演出，绝不触碰 .tc-body-preview、
  //       绝不往 session.text / 正文追加任何字符。
  // ======================================================================

  // 找挂载点：bubble（.typecard-ghost）。返回可挂 overlay 的容器，无则返回 null。
  function _eventMount(ghost) {
    if (!ghost) return null;
    const bubble = ghost.querySelector('.typecard-ghost') || ghost.querySelector('.bubble') || ghost;
    return bubble;
  }

  // 字卡演出：居中弹出纯色字卡 → 停留 → 淡出移除
  function _showCardOverlay(ghost, card) {
    const mount = _eventMount(ghost);
    if (!mount) return;
    const label = (card && card.label) ? card.label : '梦';
    const bg = (card && card.bg) ? card.bg : '#3a2b6e';
    const color = (card && card.color) ? card.color : '#e9e4ff';

    const ov = document.createElement('div');
    ov.className = 'tc-event-overlay tc-event-card';
    ov.textContent = label;
    ov.style.background = bg;
    ov.style.color = color;
    mount.appendChild(ov);

    // 淡入
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ov.classList.add('tc-event-in');
      });
    });

    // 停留 ~360ms 后淡出移除
    setTimeout(function () {
      ov.classList.remove('tc-event-in');
      ov.classList.add('tc-event-out');
      setTimeout(function () {
        if (ov.parentNode) ov.parentNode.removeChild(ov);
      }, 160);
    }, 360);
  }

  // 表情演出：居中弹出大号 emoji → 停留 → 淡出移除
  function _showEmojiOverlay(ghost, emoji) {
    const mount = _eventMount(ghost);
    if (!mount) return;
    const text = emoji || '✨';

    const ov = document.createElement('div');
    ov.className = 'tc-event-overlay tc-event-emoji';
    ov.textContent = text;
    mount.appendChild(ov);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ov.classList.add('tc-event-in');
      });
    });

    setTimeout(function () {
      ov.classList.remove('tc-event-in');
      ov.classList.add('tc-event-out');
      setTimeout(function () {
        if (ov.parentNode) ov.parentNode.removeChild(ov);
      }, 160);
    }, 360);
  }

  // 20261009：图片表情实时抽图（emoji 块的 data.img 已改为轻量标记，不落 base64）。
  // 演出时从角色对象实时抽一张图 → 居中弹出大图 → 停留 → 淡出移除。
  // 抽图走主线 pickCharSticker（TA 专属库优先 → 玩家库(允许时) → 兜底字符），
  // 抽不到图时安全回退纯文本 emoji 演出，绝不阻断 engine。
  function _showEmojiImage(ghost, charId) {
    const mount = _eventMount(ghost);
    if (!mount) return;
    let char = null;
    try {
      if (typeof characters !== 'undefined' && charId) {
        char = characters.find(function (x) { return x && x.id === charId; }) || null;
      }
    } catch (e) {}
    const doImg = function (src) {
      if (!src) return; // 无图：静默跳过（正文预览区已用占位，不重复弹）
      const ov = document.createElement('div');
      ov.className = 'tc-event-overlay tc-event-emoji tc-event-emoji-img';
      const im = document.createElement('img');
      im.src = src;
      im.alt = '';
      ov.appendChild(im);
      mount.appendChild(ov);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { ov.classList.add('tc-event-in'); });
      });
      setTimeout(function () {
        ov.classList.remove('tc-event-in');
        ov.classList.add('tc-event-out');
        setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 160);
      }, 420);
    };
    if (typeof global.pickCharSticker === 'function' && char) {
      global.pickCharSticker(char).then(function (st) {
        if (st && st.img) {
          const src = (typeof global.imgSrc === 'function') ? global.imgSrc(st.img) : st.img;
          doImg(src);
        }
        // 抽到字符而非图时：回退文本 emoji 演出
        else if (st && st.sticker) _showEmojiOverlay(ghost, st.sticker);
      }).catch(function () { /* 抽图失败静默 */ });
    } else {
      _showEmojiOverlay(ghost, '😊');
    }
  }

  // 20261009：正文预览区插入一张图片表情（完整块上屏，与文本块并列）。
  // 同样实时抽图；抽不到图时回退插入文本占位（保证预览区内容不缺失）。
  function _appendPreviewImg(ghost, charId) {
    const preview = ghost._preview;
    if (!preview) return;
    let char = null;
    try {
      if (typeof characters !== 'undefined' && charId) {
        char = characters.find(function (x) { return x && x.id === charId; }) || null;
      }
    } catch (e) {}
    const append = function (node) {
      node.style.opacity = '0';
      node.style.transition = 'opacity .15s';
      preview.appendChild(node);
      requestAnimationFrame(function () { node.style.opacity = '1'; });
    };
    if (typeof global.pickCharSticker === 'function' && char) {
      global.pickCharSticker(char).then(function (st) {
        if (st && st.img) {
          const src = (typeof global.imgSrc === 'function') ? global.imgSrc(st.img) : st.img;
          if (src) {
            const im = document.createElement('img');
            im.className = 'tc-preview-emoji';
            im.src = src;
            im.alt = '';
            append(im);
          }
        } else if (st && st.sticker) {
          const sp = document.createElement('span');
          sp.textContent = st.sticker;
          append(sp);
        }
      }).catch(function () {});
    } else {
      const sp = document.createElement('span');
      sp.textContent = '😊';
      append(sp);
    }
  }

  // ======================================================================
  // 20261009 深夜终版：已删除「软键盘弹出切换去模糊」监听（body.tc-kb-open）。
  // 切换 backdrop-filter 数值这个动作本身在真机 WebView 触发采样重建=一条杠，
  // 想靠切换避开撕裂反而制造撕裂。现所有状态共用一套恒定 blur(14px)，
  // 视口 resize（键盘弹出）也不改 blur 值，无需任何监听。
  // ======================================================================

  global.bmTypecardUi = ui;
})(typeof window !== 'undefined' ? window : this);
