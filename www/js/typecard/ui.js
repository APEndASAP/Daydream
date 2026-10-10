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
    // 插入后立即挂装饰层（水晶花簇/藤蔓/银链/叶子）——只生成一次，静态固定，之后不重建。
    insertFloatPanel: function (panel) {
      if (!panel) return false;
      document.body.appendChild(panel);
      _decorateFloatPanel(panel);
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
  // 悬浮窗玻璃装饰层（20261010 静态重写）：
  //   水晶花簇 + 藤蔓(成对互生叶+卷须+尾端花苞) + 银链星坠 + 叶子，钉在面板四边。
  //   ★核心原则（用户铁律）：装饰层「静态、只生成一次、绝不来回跳动」——
  //     · 面板创建时生成一次，之后永远不再重建（无 ResizeObserver、无重随机）；
  //     · 用 seeded PRNG（固定种子）替代 Math.random()，同尺寸下结果完全确定；
  //     · 装饰用 position:absolute 锚定四边，SVG 用固定 viewBox/坐标（不随面板
  //       高度 preserveAspectRatio:none 拉伸），打字演出/输入内容撑高面板时装饰不动；
  //     · 拖拽时装饰作为面板子元素自然跟随（translate3d 移动），无需任何重算。
  //   ★可读性红线：装饰全部 z-index:0，压在文字/按键/按钮（z1）之下，绝不盖字。
  // ======================================================================
  let _decorUid = 0; // SVG defs 渐变 id 计数器（同页多面板不撞 id）

  // 确定性伪随机（mulberry32）：同一种子同序列，保证装饰稳定不跳
  function _seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 面板装饰入口：只生成一次（panel._decorated 幂等），静态固定，不监听尺寸变化
  function _decorateFloatPanel(panel) {
    if (!panel || panel._decorated) return;
    panel._decorated = true;
    try {
      _renderFloatDecor(panel);
    } catch (e) {}
  }

  // 生成装饰（一次）。以面板当前 offsetWidth/Height 为基准算一次坐标，之后不再重算。
  function _renderFloatDecor(panel) {
    const w = Math.max(panel.offsetWidth || 260, 180);
    const h = Math.max(panel.offsetHeight || 130, 90);
    // 固定种子：面板宽高取整参与种子，同一尺寸外观稳定；不同尺寸也稳定不重排
    const rnd = _seededRandom((Math.round(w) * 7919 + Math.round(h) * 104729 + 17) >>> 0);

    // 先藤蔓（底层），再花簇（盖藤上），再银链，再闪光点
    const frag = document.createDocumentFragment();
    const anchors = { top: [], bottom: [] };
    const clusterEls = [];

    // ---- 主花对角：左上大 + 右下大，微微越出边框（offset 收里）----
    const mains = [
      { ax: 'left', ay: 'top', tier: 0, base: 70, out: 0.20 },
      { ax: 'right', ay: 'bottom', tier: 2, base: 64, out: 0.20 }
    ];
    mains.forEach(function (c) {
      const size = c.base + rnd() * 10;
      const f = document.createElement('span');
      f.className = 'tc-cluster';
      f.appendChild(_bouquetSVG(c.tier, rnd));
      f.style.width = size.toFixed(1) + 'px';
      f.style.height = size.toFixed(1) + 'px';
      f.style.transform = 'rotate(' + Math.floor(rnd() * 30 - 15) + 'deg)';
      const out = -(size * (c.out + rnd() * 0.04));
      f.style[c.ax] = out.toFixed(1) + 'px';
      f.style[c.ay] = out.toFixed(1) + 'px';
      const cx = (c.ax === 'left' ? 0 : w) + (c.ax === 'left' ? size * 0.62 : -size * 0.62);
      (c.ay === 'top' ? anchors.top : anchors.bottom).push(cx);
      clusterEls.push(f);
    });

    // ---- 边框散簇（坐边、不堆角、大小不一）----
    const sides = [
      { edge: 'top', tier: 1, base: 46, px: 0.58 },
      { edge: 'top', tier: 3, base: 38, px: 0.30 },
      { edge: 'bottom', tier: 1, base: 44, px: 0.26 },
      { edge: 'bottom', tier: 3, base: 38, px: 0.74 }
    ].filter(function (c, i) { return i % 2 === 0 || rnd() < 0.75; });
    sides.forEach(function (c) {
      const size = c.base + rnd() * 8;
      const f = document.createElement('span');
      f.className = 'tc-cluster';
      f.appendChild(_bouquetSVG(c.tier, rnd));
      f.style.width = size.toFixed(1) + 'px';
      f.style.height = size.toFixed(1) + 'px';
      f.style.transform = 'rotate(' + Math.floor(rnd() * 40 - 20) + 'deg)';
      const off = -(size * (0.16 + rnd() * 0.05));
      f.style[c.edge] = off.toFixed(1) + 'px';
      const cx = w * c.px;
      f.style.left = (cx - size / 2).toFixed(1) + 'px';
      (c.edge === 'top' ? anchors.top : anchors.bottom).push(cx);
      clusterEls.push(f);
    });

    // ---- 藤蔓：4 条独立短藤段（顶/底/左/右各一段，各自局部定位，不铺满整层）----
    _borderVinesFrags(w, h, anchors, rnd).forEach(function (v) { frag.appendChild(v); });
    clusterEls.forEach(function (f) { frag.appendChild(f); });

    // ---- 银链星坠（顶部局部垂弧，独立元素局部定位）----
    frag.appendChild(_chainSVG(w, h, rnd));

    // ---- 闪光点（贴边、不进正文区）----
    const spN = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < spN; i++) {
      const s = 7 + rnd() * 6;
      const sp = document.createElement('span');
      sp.className = 'tc-sparkle';
      sp.innerHTML = _sparkleSVG();
      sp.style.width = s.toFixed(1) + 'px';
      sp.style.height = s.toFixed(1) + 'px';
      sp.style.opacity = (0.45 + rnd() * 0.4).toFixed(2);
      sp.style[rnd() < 0.5 ? 'left' : 'right'] = (12 + rnd() * 34) + 'px';
      sp.style[rnd() < 0.5 ? 'top' : 'bottom'] = (6 + rnd() * 16) + 'px';
      frag.appendChild(sp);
    }

    panel.appendChild(frag);
  }

  // ---- 藤蔓：改为 4 条独立短藤段（顶/底/左/右各一段），每条各自局部定位。
  //     原版是「一条 SVG 铺满整层面板 + inset:-6px + drop-shadow」，在 Android WebView
  //     与面板 backdrop-filter 组合合成时必出横杠/遮罩；现拆为离散小元素，各自局部定位，
  //     SVG 用固定 viewBox 不拉伸，绝不铺满整层。 ----
  function _borderVinesFrags(w, h, anchors, rnd) {
    const ns = 'http://www.w3.org/2000/svg';
    _decorUid++;
    const gid = 'tcbv' + _decorUid;

    function miniCluster(cx, cy) {
      const cols = ['#b7c8f5', '#e3b8e8', '#c9a4ee', '#9db9f2'];
      const col = cols[Math.floor(rnd() * cols.length)];
      const n = 4 + Math.floor(rnd() * 2);
      let s = '<ellipse cx="' + (cx + 6.5).toFixed(1) + '" cy="' + (cy + 4.5).toFixed(1)
        + '" rx="6.5" ry="2.6" fill="url(#' + gid + ')" opacity="0.85"'
        + ' transform="rotate(-32 ' + (cx + 6.5).toFixed(1) + ' ' + (cy + 4.5).toFixed(1) + ')"/>';
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * 2 * i) / n - Math.PI / 2 + (rnd() - 0.5) * 0.5;
        const rr = 4.6 + rnd() * 1.6;
        s += '<circle cx="' + (cx + Math.cos(ang) * rr).toFixed(1) + '" cy="' + (cy + Math.sin(ang) * rr * 0.9).toFixed(1)
          + '" r="' + (3 + rnd() * 1.1).toFixed(1) + '" fill="' + col
          + '" stroke="rgba(255,255,255,0.65)" stroke-width="0.5" opacity="0.92"/>';
      }
      s += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="1.6" fill="#f2d270" stroke="rgba(255,255,255,0.7)" stroke-width="0.4"/>';
      return s;
    }

    // 在本地坐标系（viewBox 内）生成一段水平藤蔓，长度 L，从 (0, 基线) 向右
    function htrail(L, dense, nodeFlower) {
      const INS = 4.5, AMP = 4;
      const yBase = INS;
      let d = 'M0,' + yBase.toFixed(1);
      const joints = [];
      let x = 0, up = rnd() < 0.5 ? 1 : -1;
      while (x < L - 6) {
        const step = 10 + rnd() * 6;
        const nx = Math.min(x + step, L);
        const ny = yBase + up * (1.0 + rnd() * 1.6);
        d += ' Q' + ((x + nx) / 2).toFixed(1) + ',' + (yBase + up * AMP).toFixed(1)
           + ' ' + nx.toFixed(1) + ',' + ny.toFixed(1);
        joints.push([nx, ny, up]);
        x = nx; up = -up;
      }
      let leaves = '';
      joints.forEach(function (j, idx) {
        const t = L > 0 ? idx / Math.max(joints.length - 1, 1) : 0;
        const p = dense * (1 - 0.55 * t);
        const side = j[2];
        [-1, 1].forEach(function (s) {
          if (rnd() < p) {
            const ly = j[1] - side * 3.0 * s * 0.4 + (s === 1 ? -0.5 : 0.5);
            const rot = s > 0 ? (-34 + rnd() * 14) : (34 + rnd() * 14);
            const rx = 5.6 - 1.6 * t;
            leaves += '<ellipse cx="' + j[0].toFixed(1) + '" cy="' + ly.toFixed(1)
              + '" rx="' + rx.toFixed(1) + '" ry="' + (rx * 0.44).toFixed(1)
              + '" fill="url(#' + gid + ')" transform="rotate(' + rot.toFixed(0) + ' ' + j[0].toFixed(1) + ' ' + ly.toFixed(1) + ')"/>';
          }
        });
        if (t < 0.6 && rnd() < 0.4) {
          leaves += '<path d="M' + j[0].toFixed(1) + ',' + (j[1] + side * 1.5).toFixed(1)
            + ' q3,' + (side * 4).toFixed(1)
            + ' 5,' + (side * 2).toFixed(1)
            + '" fill="none" stroke="rgba(150,190,130,0.5)" stroke-width="0.7" stroke-linecap="round"/>';
        }
      });
      let flowers = '';
      if (nodeFlower && joints.length > 4) {
        const picks = [0.28 + rnd() * 0.14];
        if (rnd() < 0.7) picks.push(0.58 + rnd() * 0.18);
        picks.forEach(function (t) {
          const j = joints[Math.min(Math.floor(joints.length * t), joints.length - 1)];
          flowers += miniCluster(j[0], j[1] - 5.5);
        });
      }
      let tail = '';
      if (rnd() < 0.55) {
        const bx = L, by = yBase - 3.5;
        tail = '<path d="M' + bx.toFixed(1) + ',' + (by - 4.5).toFixed(1)
          + ' C' + (bx + 2.4).toFixed(1) + ',' + (by - 3.2).toFixed(1)
          + ' ' + (bx + 3).toFixed(1) + ',' + (by - 0.8).toFixed(1)
          + ' ' + (bx + 2).toFixed(1) + ',' + (by + 1).toFixed(1)
          + ' C' + (bx + 1.2).toFixed(1) + ',' + (by + 2.4).toFixed(1)
          + ' ' + (bx - 1.2).toFixed(1) + ',' + (by + 2.4).toFixed(1)
          + ' ' + (bx - 2).toFixed(1) + ',' + (by + 1).toFixed(1)
          + ' C' + (bx - 3).toFixed(1) + ',' + (by - 0.8).toFixed(1)
          + ' ' + (bx - 2.4).toFixed(1) + ',' + (by - 3.2).toFixed(1)
          + ' ' + bx.toFixed(1) + ',' + (by - 4.5).toFixed(1)
          + ' Z" fill="rgba(214,196,246,0.85)" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>';
      }
      return '<path d="' + d + '" fill="none" stroke="rgba(120,160,112,0.6)" stroke-width="1.4" stroke-linecap="round"/>'
        + leaves + flowers + tail;
    }

    // 竖直方向藤蔓（与 htrail 对称：沿 y 轴向下蜿蜒），避免 preserveAspectRatio:none 非等比缩放扭曲
    function vtrail(L, dense) {
      const INS = 4.5, AMP = 4;
      const xBase = INS;
      let d = 'M' + xBase.toFixed(1) + ',0';
      const joints = [];
      let y = 0, up = rnd() < 0.5 ? 1 : -1;
      while (y < L - 6) {
        const step = 10 + rnd() * 6;
        const ny = Math.min(y + step, L);
        const nx = xBase + up * (1.0 + rnd() * 1.6);
        d += ' Q' + (xBase + up * AMP).toFixed(1) + ',' + ((y + ny) / 2).toFixed(1)
           + ' ' + nx.toFixed(1) + ',' + ny.toFixed(1);
        joints.push([nx, ny, up]);
        y = ny; up = -up;
      }
      let leaves = '';
      joints.forEach(function (j, idx) {
        const t = L > 0 ? idx / Math.max(joints.length - 1, 1) : 0;
        const p = dense * (1 - 0.55 * t);
        const side = j[2];
        [-1, 1].forEach(function (s) {
          if (rnd() < p) {
            const lx = j[0] - side * 3.0 * s * 0.4 + (s === 1 ? -0.5 : 0.5);
            const rot = s > 0 ? (-34 + rnd() * 14) : (34 + rnd() * 14);
            const rx = 5.6 - 1.6 * t;
            leaves += '<ellipse cx="' + lx.toFixed(1) + '" cy="' + j[1].toFixed(1)
              + '" rx="' + (rx * 0.44).toFixed(1) + '" ry="' + rx.toFixed(1)
              + '" fill="url(#' + gid + ')" transform="rotate(' + rot.toFixed(0) + ' ' + lx.toFixed(1) + ' ' + j[1].toFixed(1) + ')"/>';
          }
        });
      });
      return '<path d="' + d + '" fill="none" stroke="rgba(120,160,112,0.6)" stroke-width="1.4" stroke-linecap="round"/>'
        + leaves;
    }

    const defs = '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="#a7d496" stop-opacity="0.9"/>'
      + '<stop offset="1" stop-color="#679570" stop-opacity="0.78"/>'
      + '</linearGradient></defs>';

    // 生成一条藤蔓元素：水平（horiz=true）或竖直（horiz=false），局部定位，viewBox 与内容 1:1 无拉伸
    function vineEl(horiz, len, boxW, boxH, left, top) {
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'tc-vines');
      svg.setAttribute('viewBox', '0 0 ' + boxW + ' ' + boxH);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.left = left + 'px';
      svg.style.top = top + 'px';
      svg.style.width = boxW + 'px';
      svg.style.height = boxH + 'px';
      svg.innerHTML = defs + '<g opacity="0.7">'
        + (horiz ? htrail(len, 0.85, true) : vtrail(len, 0.78))
        + '</g>';
      return svg;
    }

    const frags = [];
    const topA = (anchors && anchors.top && anchors.top.length) ? anchors.top.slice().sort(function (a, b) { return a - b; }) : [w * 0.1, w * 0.6];
    const botA = (anchors && anchors.bottom && anchors.bottom.length) ? anchors.bottom.slice().sort(function (a, b) { return b - a; }) : [w * 0.9, w * 0.4];

    // 顶藤：从左到右一段，宽约 42% 面板宽、高约 24px，贴在顶部（top 锚，面板撑高不受影响）
    const topLen = w * (0.34 + rnd() * 0.08);
    frags.push(vineEl(true, topLen, topLen, 24, w * 0.06, -3));
    // 底藤：一段。★用 bottom 锚定（不是 top:h-21）——演出中正文打字撑高面板时，
    // top 锚会让藤停在旧位置跑到面板里，bottom 锚则永远贴住底边框。
    const botLen = w * (0.30 + rnd() * 0.08);
    const botLeft = w * (0.60 - rnd() * 0.10);
    const bEl = vineEl(true, botLen, botLen, 24, 0, 0);
    bEl.style.left = 'auto';
    bEl.style.top = 'auto';
    bEl.style.right = (w - botLeft - botLen).toFixed(1) + 'px';
    // 藤茎画在 SVG 顶部 y≈4.5 处 → bottom 需 -18px 才能让茎压在底边框线上
    // （与顶藤 top:-3 对称：茎在边框内侧 1.5px；-3px 会让茎悬进面板 16px）
    bEl.style.bottom = '-18px';
    frags.push(bEl);
    // 左藤：竖直一段，宽约 24px、高约 32% 面板高，贴左缘（top 锚偏上，撑高不受影响）
    const lLen = h * (0.30 + rnd() * 0.10);
    frags.push(vineEl(false, lLen, 24, lLen, -3, h * 0.18));
    // 右藤：竖直一段。★用 right + bottom 锚定——演出中面板撑高时永远贴住右缘下部，
    // 与底藤右端衔接（原 top:h*0.52 在面板撑高后会跑到面板中部）。
    const rLen = h * (0.26 + rnd() * 0.10);
    const rEl = vineEl(false, rLen, 24, rLen, 0, 0);
    rEl.style.left = 'auto';
    rEl.style.top = 'auto';
    // 藤茎画在 SVG 左侧 x≈4.5 处 → right 需 -18px 才能让茎压在右边框线上
    // （与左藤 left:-3 对称：茎在边框内侧 1.5px）
    rEl.style.right = '-18px';
    rEl.style.bottom = (h * 0.15).toFixed(1) + 'px';
    frags.push(rEl);
    return frags;
  }

  // ---- 银链星坠：银链 + 星形坠饰，改为顶部局部垂弧（局部定位，不再 inset:0 铺满整层）----
  function _chainSVG(w, h, rnd) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'tc-chain');
    const CH = 34;                       // 链的高度（含垂弧），只占顶部一小段
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + CH);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.left = '0';
    svg.style.top = '-6px';
    svg.style.width = '100%';
    svg.style.height = CH + 'px';
    const x0 = w * (0.14 + rnd() * 0.06);
    const x1 = w * (0.80 + rnd() * 0.06);
    const yTop = 6;
    const sag = 9 + rnd() * 6;
    const mx = (x0 + x1) / 2, my = yTop + sag * 2;
    let inner = '<path d="M' + x0.toFixed(1) + ',' + yTop + ' Q' + mx.toFixed(1) + ',' + my.toFixed(1)
      + ' ' + x1.toFixed(1) + ',' + yTop + '" fill="none" stroke="rgba(228,233,255,0.55)" stroke-width="0.8"/>';
    for (let i = 1; i <= 7; i++) {
      const t = i / 8;
      const qx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1;
      const qy = (1 - t) * (1 - t) * yTop + 2 * (1 - t) * t * my + t * t * yTop;
      inner += '<circle cx="' + qx.toFixed(1) + '" cy="' + qy.toFixed(1) + '" r="0.9" fill="rgba(240,244,255,0.7)"/>';
    }
    const nch = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < nch; i++) {
      const t = 0.18 + 0.64 * (nch === 1 ? 0.5 : i / (nch - 1)) + (rnd() - 0.5) * 0.06;
      const qx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1;
      const qy = (1 - t) * (1 - t) * yTop + 2 * (1 - t) * t * my + t * t * yTop;
      const s = 2.2 + rnd() * 1.8;
      const cy = qy + 2.5 + rnd() * 2;
      inner += '<path d="M' + qx.toFixed(1) + ' ' + (cy - s).toFixed(1)
        + ' L' + (qx + s * 0.27).toFixed(1) + ' ' + (cy - s * 0.27).toFixed(1)
        + ' L' + (qx + s).toFixed(1) + ' ' + cy.toFixed(1)
        + ' L' + (qx + s * 0.27).toFixed(1) + ' ' + (cy + s * 0.27).toFixed(1)
        + ' L' + qx.toFixed(1) + ' ' + (cy + s).toFixed(1)
        + ' L' + (qx - s * 0.27).toFixed(1) + ' ' + (cy + s * 0.27).toFixed(1)
        + ' L' + (qx - s).toFixed(1) + ' ' + cy.toFixed(1)
        + ' L' + (qx - s * 0.27).toFixed(1) + ' ' + (cy - s * 0.27).toFixed(1)
        + ' Z" fill="rgba(250,250,255,0.88)"/>';
    }
    svg.innerHTML = '<g opacity="0.8">' + inner + '</g>';
    return svg;
  }

  // ---- 水晶花簇（完整建模）：六瓣水晶大花 + 四瓣绣球 + 五瓣小花 + 泪滴花苞 + 梭形叶 ----
  function _bouquetSVG(tier, rnd) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'tc-cluster-svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    _decorUid++;
    const u = _decorUid;
    const defs = '<defs>'
      + '<linearGradient id="gP0' + u + '" x1="0" y1="1" x2="0" y2="0">'
      + '<stop offset="0" stop-color="#5b6ee0" stop-opacity="0.85"/>'
      + '<stop offset="0.55" stop-color="#8fa8f0" stop-opacity="0.9"/>'
      + '<stop offset="1" stop-color="#ffffff" stop-opacity="0.95"/></linearGradient>'
      + '<linearGradient id="gP1' + u + '" x1="0" y1="1" x2="0" y2="0">'
      + '<stop offset="0" stop-color="#b48ae8" stop-opacity="0.85"/>'
      + '<stop offset="0.55" stop-color="#e9c2ee" stop-opacity="0.9"/>'
      + '<stop offset="1" stop-color="#ffffff" stop-opacity="0.95"/></linearGradient>'
      + '<linearGradient id="gP2' + u + '" x1="0" y1="1" x2="0" y2="0">'
      + '<stop offset="0" stop-color="#7fa3ea" stop-opacity="0.85"/>'
      + '<stop offset="0.55" stop-color="#c3d8fa" stop-opacity="0.9"/>'
      + '<stop offset="1" stop-color="#ffffff" stop-opacity="0.95"/></linearGradient>'
      + '<linearGradient id="gP3' + u + '" x1="0" y1="1" x2="0" y2="0">'
      + '<stop offset="0" stop-color="#3a55b8" stop-opacity="0.85"/>'
      + '<stop offset="0.55" stop-color="#6f92ea" stop-opacity="0.9"/>'
      + '<stop offset="1" stop-color="#eaf2ff" stop-opacity="0.95"/></linearGradient>'
      + '<radialGradient id="gC' + u + '" cx="0.5" cy="0.42" r="0.7">'
      + '<stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>'
      + '<stop offset="0.55" stop-color="#f2d270" stop-opacity="0.9"/>'
      + '<stop offset="1" stop-color="#dd9f45" stop-opacity="0.85"/></radialGradient>'
      + '<linearGradient id="gL' + u + '" x1="0" y1="1" x2="0" y2="0">'
      + '<stop offset="0" stop-color="#a8d89a" stop-opacity="0.85"/>'
      + '<stop offset="1" stop-color="#4f7f58" stop-opacity="0.8"/></linearGradient>'
      + '<linearGradient id="gLD' + u + '" x1="0" y1="1" x2="0" y2="0">'
      + '<stop offset="0" stop-color="#46558c" stop-opacity="0.9"/>'
      + '<stop offset="1" stop-color="#1e2a52" stop-opacity="0.85"/></linearGradient>'
      + '<linearGradient id="gB' + u + '" x1="0" y1="1" x2="0" y2="0">'
      + '<stop offset="0" stop-color="#9db9f2" stop-opacity="0.9"/>'
      + '<stop offset="1" stop-color="#f0d3f6" stop-opacity="0.95"/></linearGradient>'
      + '</defs>';

    function heroFlower(pg) {
      const petal = 'M0,3 C-7.5,-1 -11.5,-9 -10,-17 C-8.8,-24 -3.2,-27 0,-30 C3.2,-27 8.8,-24 10,-17 C11.5,-9 7.5,-1 0,3 Z';
      let s = '';
      for (let r = 0; r < 6; r++) {
        s += '<g transform="rotate(' + (r * 60) + ')">'
          + '<path d="' + petal + '" fill="url(#' + pg + u + ')" stroke="rgba(255,255,255,0.6)" stroke-width="0.9"/>'
          + '<path d="M0,-5 C-1.4,-11 -1.4,-18 0,-24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.8" stroke-linecap="round"/>'
          + '</g>';
      }
      let st = '';
      for (let r = 0; r < 6; r++) {
        const ang = (Math.PI * 2 * r) / 6 + 0.5;
        const sx = (Math.cos(ang) * 4.6).toFixed(1), sy = (Math.sin(ang) * 4.6).toFixed(1);
        st += '<line x1="0" y1="0" x2="' + sx + '" y2="' + sy + '" stroke="rgba(255,255,255,0.55)" stroke-width="0.7"/>'
          + '<circle cx="' + sx + '" cy="' + sy + '" r="1.25" fill="rgba(255,255,255,0.92)"/>';
      }
      return s + st + '<circle r="3" fill="url(#gC' + u + ')" stroke="rgba(255,255,255,0.85)" stroke-width="0.7"/>';
    }
    function hydrangea(pg) {
      const petal = 'M0,2 C-6.5,-1 -10,-7 -9.5,-13 C-9.2,-17.5 -5.5,-20 -3,-18.8 C-1.6,-18.1 -0.7,-16.6 0,-15.4 C0.7,-16.6 1.6,-18.1 3,-18.8 C5.5,-20 9.2,-17.5 9.5,-13 C10,-7 6.5,-1 0,2 Z';
      let s = '';
      for (let r = 0; r < 4; r++) {
        s += '<path d="' + petal + '" fill="url(#' + pg + u + ')" stroke="rgba(255,255,255,0.55)" stroke-width="0.8" transform="rotate(' + (r * 90 + 22) + ')"/>';
      }
      return s + '<circle r="2.6" fill="url(#gC' + u + ')" stroke="rgba(255,255,255,0.8)" stroke-width="0.6"/>';
    }
    function smallFlower(pg) {
      const petal = 'M0,1.5 C-3.6,-0.5 -5.6,-4 -5,-7.2 C-4.5,-9.6 -2.2,-11 0,-11 C2.2,-11 4.5,-9.6 5,-7.2 C5.6,-4 3.6,-0.5 0,1.5 Z';
      let s = '';
      for (let r = 0; r < 5; r++) {
        s += '<path d="' + petal + '" fill="url(#' + pg + u + ')" stroke="rgba(255,255,255,0.5)" stroke-width="0.6" transform="rotate(' + (r * 72) + ')"/>';
      }
      return s + '<circle r="1.8" fill="url(#gC' + u + ')" stroke="rgba(255,255,255,0.75)" stroke-width="0.5"/>';
    }
    function bud() {
      return '<path d="M0,-7 C3.4,-5.2 4.4,-1.4 3.1,1.5 C2,3.9 -2,3.9 -3.1,1.5 C-4.4,-1.4 -3.4,-5.2 0,-7 Z" fill="url(#gB' + u + ')" stroke="rgba(255,255,255,0.6)" stroke-width="0.6"/>'
        + '<path d="M0,4.4 C-2.1,3.1 -2.7,1 -2,-0.5 L0,1 L2,-0.5 C2.7,1 2.1,3.1 0,4.4 Z" fill="url(#gL' + u + ')"/>'
        + '<path d="M-1.1,-3.6 C-2,-2.3 -2.2,-0.8 -1.7,0.6" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="0.7" stroke-linecap="round"/>';
    }
    function leaf(s, navy) {
      return '<g transform="scale(' + s + ')">'
        + '<path d="M0,0 C-5.5,-2.5 -8.5,-8 -7,-13.5 C-6.3,-15.5 -3,-16.5 0,-16 C3,-16.5 6.3,-15.5 7,-13.5 C8.5,-8 5.5,-2.5 0,0 Z" fill="url(#' + (navy ? 'gLD' : 'gL') + u + ')" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"/>'
        + '<path d="M0,-1.5 L0,-13" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.6" stroke-linecap="round"/>'
        + '</g>';
    }
    function twinklePath() {
      return '<path d="M0,-5 L1.2,-1.2 L5,0 L1.2,1.2 L0,5 L-1.2,1.2 L-5,0 L-1.2,-1.2 Z" fill="rgba(255,255,255,0.92)"/>';
    }
    function jit(v, a) { return v + (rnd() - 0.5) * a; }
    const parts = [];
    function put(inner, x, y, sc, rot) {
      parts.push('<g transform="translate(' + jit(x, 7).toFixed(1) + ' ' + jit(y, 7).toFixed(1) + ')'
        + ' rotate(' + jit(rot || 0, 24).toFixed(0) + ')'
        + (sc && sc !== 1 ? ' scale(' + (sc * (0.94 + rnd() * 0.12)).toFixed(3) + ')' : '')
        + '">' + inner + '</g>');
    }

    if (tier === 0) {
      put(leaf(1.15, false), 22, 15, 1, -35);
      put(leaf(0.95, true), 46, 17, 1, 20);
      put(leaf(1.05, false), 13, 42, 1, -75);
      put(leaf(0.85, false), 28, 60, 1, -125);
      put(heroFlower('gP0'), 34, 31, 1.0, 8);
      put(hydrangea('gP1'), 56, 44, 0.92, 35);
      put(hydrangea('gP2'), 21, 56, 0.78, -20);
      put(smallFlower('gP2'), 46, 62, 0.6, 0);
      put(smallFlower('gP0'), 64, 29, 0.55, 0);
      put(smallFlower('gP1'), 59, 13, 0.5, 0);
      put(bud(), 69, 42, 1.05, 25);
      put(bud(), 33, 73, 0.9, -15);
      put(twinklePath(), 50, 24, 0.5, 0);
      put(twinklePath(), 17, 30, 0.4, 0);
    } else if (tier === 1) {
      put(leaf(0.95, false), 22, 17, 1, -40);
      put(leaf(0.85, true), 44, 15, 1, 15);
      put(heroFlower('gP1'), 34, 33, 0.78, -10);
      put(hydrangea('gP0'), 54, 42, 0.85, 30);
      put(smallFlower('gP2'), 43, 57, 0.55, 0);
      put(smallFlower('gP1'), 59, 26, 0.5, 0);
      put(bud(), 64, 36, 0.9, 30);
      put(twinklePath(), 48, 22, 0.45, 0);
    } else if (tier === 2) {
      put(leaf(1.1, true), 20, 18, 1, -30);
      put(leaf(0.95, false), 47, 16, 1, 25);
      put(leaf(1.0, false), 12, 44, 1, -80);
      put(heroFlower('gP3'), 35, 33, 0.92, 15);
      put(hydrangea('gP1'), 56, 48, 0.88, -30);
      put(hydrangea('gP2'), 19, 57, 0.7, 50);
      put(smallFlower('gP0'), 45, 64, 0.55, 0);
      put(smallFlower('gP2'), 63, 27, 0.5, 0);
      put(bud(), 67, 40, 1.0, 20);
      put(bud(), 30, 70, 0.85, -25);
      put(twinklePath(), 52, 28, 0.5, 0);
    } else {
      put(leaf(0.9, false), 23, 19, 1, -35);
      put(leaf(0.8, true), 43, 17, 1, 10);
      put(hydrangea('gP0'), 34, 34, 0.95, 20);
      put(smallFlower('gP2'), 51, 41, 0.6, 0);
      put(smallFlower('gP1'), 35, 52, 0.55, 0);
      put(bud(), 55, 29, 0.85, 25);
      put(twinklePath(), 44, 25, 0.4, 0);
    }

    const mirror = ['', 'translate(120,0) scale(-1,1)', 'translate(120,120) scale(-1,-1)', 'translate(0,120) scale(1,-1)'][tier] || '';
    svg.innerHTML = defs + '<g opacity="0.95"' + (mirror ? ' transform="' + mirror + '"' : '') + '>' + parts.join('') + '</g>';
    return svg;
  }

  // ---- 四角星闪光点（水晶点缀）----
  function _sparkleSVG() {
    return '<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M6 0 L7.3 4.7 L12 6 L7.3 7.3 L6 12 L4.7 7.3 L0 6 L4.7 4.7 Z" fill="rgba(255,255,255,0.9)"/>'
      + '</svg>';
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
