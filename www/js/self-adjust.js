/* ============================================================
 * 角色自调数值 · 数据层
 * ------------------------------------------------------------
 * 这是一个「隐藏功能」：角色每次回复有 3% 的概率，把这一条换成「开场话 + 申请卡」。
 * 玩家点开卡片才弹同意窗；同意后走进主页 → 聊天设置逐项改给玩家看，改完可撤回。
 *
 * 本文件只负责三件事，不碰 UI、不碰动画：
 *   ① SA_FIELDS —— 可改数值的字段表（名称、单位、范围、0 的特殊含义、调大调小什么效果）
 *   ② saPick()  —— 完全随机地抽这次要改哪几项、每项改成多少
 *   ③ saApply() / saRevert() —— 写进设置 / 撤回
 *
 * 演出动画不在这里，见 __selfadj_preview.html（独立预览页）。
 * ============================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------
   * 字段表。一条 = 一个可以调的数值。
   *   panel  面板分组（和聊天设置里的分组一致）
   *   label  面板上显示的名字
   *   unit   单位
   *   min/max 面板允许的范围（随机值一定不会越界）
   *   def    默认值（预览页初始值、也是没设置过时的回退）
   *   zero   0 的特殊含义（没有就是 null）。这一条必须让 AI 知道，
   *          否则它会以为「0 封书信 = 随便写」。
   *   up/down 调大 / 调小分别是什么效果（给 AI 解释用）
   * ------------------------------------------------------------ */
  const SA_FIELDS = [
    /* —— 回复 ——
       type:'switch' = 主项目里的勾选框；gate 指向它管着哪个数值（开关关了，数值改了也没意义）。 */
    { k: 'minDelay', panel: '回复', label: '回复节奏 · 最短等待', unit: '秒', min: 0, max: 120, def: 1,
      zero: '0 = 立刻回复，不等待', up: '回得更慢', down: '回得更快' },
    { k: 'maxDelay', panel: '回复', label: '回复节奏 · 最长等待', unit: '秒', min: 0, max: 120, def: 5,
      zero: '0 = 立刻回复，不等待', up: '最长等待更久', down: '最长等待更短' },
    { k: 'eventYinyuan', type: 'switch', panel: '回复', label: '姻缘牵', def: true,
      up: '打开：回完话后可能牵出一根红线', down: '关掉：不再出现' },
    { k: 'eventYinyuanChance', panel: '回复', label: '姻缘牵 · 概率', unit: '%', min: 0.1, max: 6, step: 0.1, def: 1.5,
      gate: 'eventYinyuan', zero: null, up: '红线出现得更频繁', down: '红线出现得更少' },
    { k: 'eventGaze', type: 'switch', panel: '回复', label: '目光', def: true,
      up: '打开：回完话后可能出现那双眼睛', down: '关掉：不再出现' },
    { k: 'eventGazeChance', panel: '回复', label: '目光 · 概率', unit: '%', min: 0.1, max: 6, step: 0.1, def: 1.2,
      gate: 'eventGaze', zero: null, up: '那双眼睛出现得更频繁', down: '出现得更少' },

    /* —— 主动 ——
       固定间隔 / 随机区间 是互斥的两个模式（主项目里两个勾选框，勾一个另一个自动取消）：
         proactiveRandom = false → 走 proactiveMin（固定间隔）
         proactiveRandom = true  → 走 proactiveRandMin~proactiveRandMax（每次随机）
       下面用 when 标好归属，抽的时候只从当前模式那一侧抽，不会给出「改了却没生效」的数值。 */
    { k: 'proactive', type: 'switch', panel: '主动', label: '访客主动发消息', def: false,
      up: '打开：TA 会自己来找你', down: '关掉：TA 不再主动发消息（下面两种方式都不发）' },
    { k: 'proactiveRandom', type: 'switch', panel: '主动', label: '访客主动发消息 · 随机发消息', def: false,
      up: '改成：在区间内随机时刻发', down: '改成：每隔固定分钟发一条' },
    { k: 'proactiveMin', panel: '主动', label: '访客主动发消息 · 固定间隔', unit: '分钟', min: 1, max: 120, def: 20,
      gate: 'proactive', when: 'fixed', zero: '最小值 1，不存在 0',
      up: '隔更久才主动找你', down: '更勤快地来找你' },
    { k: 'proactiveRandMin', panel: '主动', label: '访客主动发消息 · 随机下限', unit: '分钟', min: 1, max: 720, def: 10,
      gate: 'proactive', when: 'random', zero: '最小值 1，不存在 0',
      up: '最早也要等更久', down: '可能很快就来' },
    { k: 'proactiveRandMax', panel: '主动', label: '访客主动发消息 · 随机上限', unit: '分钟', min: 1, max: 720, def: 120,
      gate: 'proactive', when: 'random', zero: '最小值 1，不存在 0',
      up: '最长可以很久不出现', down: '不会让你等太久' },
    { k: 'proactiveCheckin', type: 'switch', panel: '主动', label: '访客随机查岗', def: false,
      up: '打开：TA 会随机问你「现在在做什么」', down: '关掉：不再查岗' },
    { k: 'checkinDailyLimit', panel: '主动', label: '访客随机查岗 · 每日上限', unit: '次', min: 0, max: 99, def: 0,
      gate: 'proactiveCheckin', zero: '0 = 不限次数（不是一次都不查）',
      up: '一天查岗次数更多', down: '查得更少' },
    { k: 'randomCall', type: 'switch', panel: '主动', label: '访客随机来电', def: false,
      up: '打开：TA 会随机给你打语音/视频', down: '关掉：不再来电' },
    { k: 'callDailyLimit', panel: '主动', label: '访客随机来电 · 每日上限', unit: '次', min: 0, max: 99, def: 0,
      gate: 'randomCall', zero: '0 = 不限次数（不是一次都不打）', up: '一天来电更多', down: '打得更少' },
    { k: 'randomPacket', type: 'switch', panel: '主动', label: '访客随机发红包', def: false,
      up: '打开：TA 会隔一阵给你发个红包', down: '关掉：不再发红包' },
    { k: 'lettersEnabled', type: 'switch', panel: '主动', label: '访客主动寄书信', def: true,
      up: '打开：TA 会按间隔寄来火漆信封', down: '关掉：不再寄信' },
    { k: 'lettersDailyLimit', panel: '主动', label: '访客主动寄书信 · 每日上限', unit: '封', min: 0, max: 5, def: 2,
      gate: 'lettersEnabled', zero: '0 = 今天一封都不写（不是不限）', up: '一天写信更多', down: '写得更少' },

    /* —— 通话 —— */
    { k: 'callIntervalMin', panel: '通话', label: '随机来电间隔 · 下限', unit: '分钟', min: 1, max: 1440, def: 30,
      gate: 'randomCall', zero: '最小值 1，不存在 0', up: '两次来电隔得更久', down: '来得更频繁' },
    { k: 'callIntervalMax', panel: '通话', label: '随机来电间隔 · 上限', unit: '分钟', min: 1, max: 1440, def: 240,
      gate: 'randomCall', zero: '最小值 1，不存在 0', up: '最长可以一天不打', down: '不会隔太久' },
    { k: 'callAutoHangup', type: 'switch', panel: '通话', label: '随机挂断通话', def: true,
      up: '打开：TA 会找理由自己挂断', down: '关掉：通话只能你手动挂' },
    { k: 'callHangupMin', panel: '通话', label: '随机挂断通话 · 时长下限', unit: '分钟', min: 1, max: 720, def: 20,
      gate: 'callAutoHangup', zero: '最小值 1，不存在 0', up: '通话坚持得更久才挂', down: '很快挂断' },
    { k: 'callHangupMax', panel: '通话', label: '随机挂断通话 · 时长上限', unit: '分钟', min: 1, max: 720, def: 40,
      gate: 'callAutoHangup', zero: '最小值 1，不存在 0', up: '最长能聊更久', down: '不会聊太久' },

    /* —— 消息 —— */
    { k: 'allowRecall', type: 'switch', panel: '消息', label: '允许撤回消息', def: true,
      up: '打开：TA 偶尔会把发出的话收回去', down: '关掉：说出的话不再撤回' },

    /* —— 四季 —— */
    { k: 'seasonCareGapMin', panel: '四季', label: '照料间隔 · 下限', unit: '分钟', min: 15, max: 720, def: 30,
      zero: null, up: '关心来得更稀', down: '关心来得更密' },
    { k: 'seasonCareGapMax', panel: '四季', label: '照料间隔 · 上限', unit: '分钟', min: 15, max: 720, def: 90,
      zero: null, up: '最长更久不关心', down: '不会拖太久' },
    { k: 'seasonCardGapMin', panel: '四季', label: '抽卡留言间隔 · 下限', unit: '分钟', min: 15, max: 720, def: 120,
      zero: null, up: '字卡来得很稀', down: '字卡来得很密' },
    { k: 'seasonCardGapMax', panel: '四季', label: '抽卡留言间隔 · 上限', unit: '分钟', min: 15, max: 720, def: 240,
      zero: null, up: '最长隔得更久', down: '不会隔太久' },
    { k: 'seasonAiGapMin', panel: '四季', label: 'AI 兜底间隔 · 下限', unit: '分钟', min: 15, max: 720, def: 30,
      zero: null, up: 'AI 生成得更少', down: '生成得更勤' },
    { k: 'seasonAiGapMax', panel: '四季', label: 'AI 兜底间隔 · 上限', unit: '分钟', min: 15, max: 720, def: 120,
      zero: null, up: '最长更久不生成', down: '不会隔太久' },
    { k: 'seasonLoveGapMin', panel: '四季', label: '爱意邀请间隔 · 下限', unit: '分钟', min: 15, max: 720, def: 120,
      zero: null, up: '爱意表达更稀', down: '表达更频繁' },
    { k: 'seasonLoveGapMax', panel: '四季', label: '爱意邀请间隔 · 上限', unit: '分钟', min: 15, max: 720, def: 240,
      zero: null, up: '最长隔得更久', down: '不会隔太久' },

    /* —— 字卡组合 —— */
    { k: 'multiCardOn', type: 'switch', panel: '字卡组合', label: '多字卡组合回复', def: false,
      up: '打开：TA 会一次连发好几张字卡', down: '关掉：一次只回一条' },
    { k: 'multiCardCountMin', panel: '字卡组合', label: '多字卡组合回复 · 条数下限', unit: '条', min: 1, max: 10, def: 2,
      gate: 'multiCardOn', zero: '最小值 1，不存在 0', up: '一次至少说更多条', down: '一次说更少条' },
    { k: 'multiCardCountMax', panel: '字卡组合', label: '多字卡组合回复 · 条数上限', unit: '条', min: 1, max: 10, def: 3,
      gate: 'multiCardOn', zero: '最小值 1，不存在 0', up: '一次最多说更多条', down: '最多说更少条' },
    { k: 'multiCardIntervalMin', panel: '字卡组合', label: '多字卡组合回复 · 间隔下限', unit: '分钟', min: 1, max: 720, def: 40,
      gate: 'multiCardOn', zero: '最小值 1，不存在 0', up: '组合来得更稀', down: '组合来得更密' },
    { k: 'multiCardIntervalMax', panel: '字卡组合', label: '多字卡组合回复 · 间隔上限', unit: '分钟', min: 1, max: 720, def: 240,
      gate: 'multiCardOn', zero: '最小值 1，不存在 0', up: '最长更久不出组合', down: '不会隔太久' },

    /* —— 打字卡 —— */
    { k: 'typecardOn', type: 'switch', panel: '打字卡', label: '碎梦重拼', def: false,
      up: '打开：回复改成一个字一个字打出来', down: '关掉：回到整条气泡' },
    { k: 'typecardSummon', type: 'switch', panel: '打字卡', label: '碎梦重拼召唤', def: false,
      up: '打开：常驻悬浮窗，TA 会自己冒出一条', down: '关掉：不再自发生成' },
    { k: 'typecardSummonIntervalMin', panel: '打字卡', label: '碎梦重拼召唤 · 间隔下限', unit: '分钟', min: 1, max: 720, def: 40,
      gate: 'typecardSummon', zero: '最小值 1，不存在 0', up: '召唤来得更稀', down: '召唤来得更密' },
    { k: 'typecardSummonIntervalMax', panel: '打字卡', label: '碎梦重拼召唤 · 间隔上限', unit: '分钟', min: 1, max: 720, def: 240,
      gate: 'typecardSummon', zero: '最小值 1，不存在 0', up: '最长更久不召唤', down: '不会隔太久' },

    /* —— 行程 —— */
    { k: 'bmSchedDetect', type: 'switch', panel: '行程', label: '聊天日程+闹钟自动检测', def: true,
      up: '打开：从聊天里自动抓日程、建闹钟', down: '关掉：不再自动记录' },
    { k: 'charSchedCountMin', panel: '行程', label: '角色每天写入行程条数 · 下限', unit: '条', min: 0, max: 20, def: 2,
      gate: 'bmSchedDetect', zero: '0 = 那天可能一条都不写', up: '每天至少写更多条', down: '写得更少' },
    { k: 'charSchedCountMax', panel: '行程', label: '角色每天写入行程条数 · 上限', unit: '条', min: 0, max: 20, def: 3,
      gate: 'bmSchedDetect', zero: '0 = 那天一条都不写', up: '一天最多写更多条', down: '最多写更少条' },
    { k: 'commentPickCountMin', panel: '行程', label: '行程留言/备注抽卡张数 · 下限', unit: '张', min: 0, max: 20, def: 0,
      gate: 'bmSchedDetect', zero: '0 = 可能一句留言都不写', up: '留言更长', down: '留言更短' },
    { k: 'commentPickCountMax', panel: '行程', label: '行程留言/备注抽卡张数 · 上限', unit: '张', min: 0, max: 20, def: 2,
      gate: 'bmSchedDetect', zero: '0 = 不写留言', up: '留言可以很长', down: '留言更短' },

    /* —— 音乐 —— 每一项都有自己的开关，开关关着时只调区间没有任何意义 */
    { k: 'musicAuto', type: 'switch', panel: '音乐', label: '角色主动搜歌/切歌', def: true,
      up: '打开：一起听歌时 TA 会自己找歌、切歌、收藏', down: '关掉：音乐只由你操作' },
    { k: 'musicAutoMin', panel: '音乐', label: '角色主动搜歌/切歌 · 间隔下限', unit: '分钟', min: 1, max: 720, def: 20,
      gate: 'musicAuto', zero: null, up: '更少主动切歌搜歌', down: '更频繁地动音乐' },
    { k: 'musicAutoMax', panel: '音乐', label: '角色主动搜歌/切歌 · 间隔上限', unit: '分钟', min: 1, max: 720, def: 120,
      gate: 'musicAuto', zero: null, up: '最长更久不动音乐', down: '不会隔太久' },
    { k: 'musicModeSwitch', type: 'switch', panel: '音乐', label: '角色自主切换播放模式', def: true,
      up: '打开：TA 会自己切单曲/列表/随机', down: '关掉：播放模式固定' },
    { k: 'musicModeSwitchMin', panel: '音乐', label: '角色自主切换播放模式 · 间隔下限', unit: '分钟', min: 1, max: 1440, def: 45,
      gate: 'musicModeSwitch', zero: null, up: '更少切换播放模式', down: '更频繁切换' },
    { k: 'musicModeSwitchMax', panel: '音乐', label: '角色自主切换播放模式 · 间隔上限', unit: '分钟', min: 1, max: 1440, def: 90,
      gate: 'musicModeSwitch', zero: null, up: '最长更久不切', down: '不会隔太久' },
    { k: 'musicInvite', type: 'switch', panel: '音乐', label: '角色主动邀请一起听歌', def: false,
      up: '打开：TA 会主动邀你一起听歌', down: '关掉：不再邀请' },
    { k: 'musicInviteMin', panel: '音乐', label: '角色主动邀请一起听歌 · 间隔下限', unit: '分钟', min: 1, max: 1440, def: 120,
      gate: 'musicInvite', zero: null, up: '更少邀请你', down: '更常邀请你' },
    { k: 'musicInviteMax', panel: '音乐', label: '角色主动邀请一起听歌 · 间隔上限', unit: '分钟', min: 1, max: 1440, def: 480,
      gate: 'musicInvite', zero: null, up: '最长更久不邀请', down: '不会隔太久' },
    { k: 'musicSwap', type: 'switch', panel: '音乐', label: '角色主动问你要不要换歌', def: true,
      up: '打开：TA 会发卡问你要不要换歌', down: '关掉：不再问' },
    { k: 'musicSwapMin', panel: '音乐', label: '角色主动问你要不要换歌 · 间隔下限', unit: '分钟', min: 1, max: 1440, def: 90,
      gate: 'musicSwap', zero: null, up: '更少切歌', down: '更常切歌' },
    { k: 'musicSwapMax', panel: '音乐', label: '角色主动问你要不要换歌 · 间隔上限', unit: '分钟', min: 1, max: 1440, def: 300,
      gate: 'musicSwap', zero: null, up: '最长更久不切歌', down: '不会隔太久' },
    { k: 'musicShare', type: 'switch', panel: '音乐', label: '角色主动分享一首歌给你', def: true,
      up: '打开：TA 会主动分享一首歌给你', down: '关掉：不再分享' },
    { k: 'musicShareMin', panel: '音乐', label: '角色主动分享一首歌给你 · 间隔下限', unit: '分钟', min: 1, max: 1440, def: 180,
      gate: 'musicShare', zero: null, up: '更少分享歌给你', down: '更常分享' },
    { k: 'musicShareMax', panel: '音乐', label: '角色主动分享一首歌给你 · 间隔上限', unit: '分钟', min: 1, max: 1440, def: 600,
      gate: 'musicShare', zero: null, up: '最长更久不分享', down: '不会隔太久' },
    { k: 'musicPeek', type: 'switch', panel: '音乐', label: '角色偷偷查看你的歌单', def: true,
      up: '打开：TA 会偷看你在听什么', down: '关掉：不再偷看' },
    /* 这三组间隔（偷看歌单 / 角色戴耳机 / 一起听时随机收藏）
       在主项目里只有「开发者模式」打开才显示，普通用户在自己的聊天设置里根本看不到，
       放进清单会让人莫名其妙（「我哪有这个功能？」）。
       所以它们不交给角色改 —— 开关照旧可调，只去掉看不见的分钟数。 */

    /* —— 视频 —— */
    { k: 'videoAuto', type: 'switch', panel: '视频', label: '角色主动搜发视频', def: false,
      up: '打开：TA 会偶尔发个视频给你', down: '关掉：不再发视频' },
    { k: 'videoAutoMin', panel: '视频', label: '角色主动搜发视频 · 间隔下限', unit: '分钟', min: 1, max: 1440, def: 60,
      gate: 'videoAuto', zero: null, up: '更少发视频给你', down: '更常发' },
    { k: 'videoAutoMax', panel: '视频', label: '角色主动搜发视频 · 间隔上限', unit: '分钟', min: 1, max: 1440, def: 240,
      gate: 'videoAuto', zero: null, up: '最长更久不发', down: '不会隔太久' },

    /* —— 番茄钟 · 只保留「角色来找你」的那一组 ——
       专注 / 休息时长是玩家按自己的专注节奏定的，角色不许动；
       「前台互动（陪伴动作 / 陪伴回复）」在主项目番茄钟面板里有真控件
       （cs-companion-interact-min/max），可以改。 */
    { k: 'companionInteractMin', panel: '番茄钟', label: '前台互动 · 间隔下限', unit: '分钟', min: 1, max: 720, def: 8,
      zero: null, up: '陪你说话更少', down: '更常来打扰你' },
    { k: 'companionInteractMax', panel: '番茄钟', label: '前台互动 · 间隔上限', unit: '分钟', min: 1, max: 720, def: 20,
      zero: null, up: '最长更久不出声', down: '不会等太久' }
  ];

  /* ------------------------------------------------------------
   * 区间组：一对「下限 / 上限」说的其实是同一个概念的一个范围。
   * 清单与设置页都按「一组」显示（30~90 分钟 → 45~299 分钟），
   * 不拆成两行「下限」「上限」，否则一眼看不出它是个区间。
   *   lo/hi 对应字段表的两条；name 是这一组在界面上叫什么
   * ------------------------------------------------------------ */
  const SA_RANGES = [
    { lo: 'minDelay', hi: 'maxDelay', name: '回复节奏' },
    { lo: 'proactiveRandMin', hi: 'proactiveRandMax', name: '访客主动发消息 · 随机间隔' },
    { lo: 'callIntervalMin', hi: 'callIntervalMax', name: '随机来电间隔' },
    { lo: 'callHangupMin', hi: 'callHangupMax', name: '随机挂断通话 · 时长' },
    { lo: 'seasonCareGapMin', hi: 'seasonCareGapMax', name: '照料间隔' },
    { lo: 'seasonCardGapMin', hi: 'seasonCardGapMax', name: '抽卡留言间隔' },
    { lo: 'seasonAiGapMin', hi: 'seasonAiGapMax', name: 'AI 兜底间隔' },
    { lo: 'seasonLoveGapMin', hi: 'seasonLoveGapMax', name: '爱意邀请间隔' },
    { lo: 'multiCardCountMin', hi: 'multiCardCountMax', name: '多字卡组合回复 · 条数' },
    { lo: 'multiCardIntervalMin', hi: 'multiCardIntervalMax', name: '多字卡组合回复 · 间隔' },
    { lo: 'typecardSummonIntervalMin', hi: 'typecardSummonIntervalMax', name: '碎梦重拼召唤 · 间隔' },
    { lo: 'charSchedCountMin', hi: 'charSchedCountMax', name: '角色每天写入行程条数' },
    { lo: 'commentPickCountMin', hi: 'commentPickCountMax', name: '行程留言/备注抽卡张数' },
    { lo: 'musicAutoMin', hi: 'musicAutoMax', name: '角色主动搜歌/切歌 · 间隔' },
    { lo: 'musicModeSwitchMin', hi: 'musicModeSwitchMax', name: '角色自主切换播放模式 · 间隔' },
    { lo: 'musicInviteMin', hi: 'musicInviteMax', name: '角色主动邀请一起听歌 · 间隔' },
    { lo: 'musicSwapMin', hi: 'musicSwapMax', name: '角色主动问你要不要换歌 · 间隔' },
    { lo: 'musicShareMin', hi: 'musicShareMax', name: '角色主动分享一首歌给你 · 间隔' },
    { lo: 'videoAutoMin', hi: 'videoAutoMax', name: '角色主动搜发视频 · 间隔' },
    { lo: 'companionInteractMin', hi: 'companionInteractMax', name: '前台互动 · 间隔' }
  ];
  const SA_RANGE_BY_LO = {};
  for (const r of SA_RANGES) {
    SA_RANGE_BY_LO[r.lo] = r;
    r.unit = (SA_FIELDS.find((f) => f.k === r.lo) || {}).unit || '';
  }

  const SA_BY_KEY = {};
  for (const f of SA_FIELDS) SA_BY_KEY[f.k] = f;

  /* ------------------------------------------------------------
   * 随机一个「改成多少」。
   * 不是全区间瞎抓 —— 那会抽出「偷看歌单 60 分钟 → 1326 分钟」这种离谱值。
   * 改成在原值附近浮动（大约 0.45 倍 ~ 2.2 倍），区间上下限都还落在合理量级，
   * 看上去像 TA 真的想了想，而不是掷骰子。
   *   cur 传当前值；不传就用默认值
   * ------------------------------------------------------------ */
  function saRandVal(f, cur) {
    const step = f.step || 1;
    const base = (cur === undefined || cur === null || isNaN(cur)) ? f.def : Number(cur);
    let lo, hi;

    if (base <= 0) {
      // 0 起步的字段（查岗 / 来电 / 书信 / 每日写入）：从 0 往小范围抬
      lo = f.min;
      hi = Math.min(f.max, Math.max(step * 3, f.def * 2));
    } else {
      lo = Math.max(f.min, base * 0.45);
      hi = Math.min(f.max, base * 2.2);
    }
    if (hi - lo < step * 2) hi = Math.min(f.max, lo + step * 2);

    // 按 step 量化后再随机，别让 1.7000000000000002 这种跑出去
    const n = Math.max(1, Math.floor((hi - lo) / step));
    let v = lo + Math.floor(Math.random() * (n + 1)) * step;
    v = Math.round(v / step) * step;
    v = Math.round(v * 100) / 100;

    // 跟原值撞上了就往旁边挪一格
    if (Math.abs(v - base) < step * 0.5) {
      v = (v + step <= f.max) ? v + step : Math.max(f.min, v - step);
    }
    // 改得太少（比如 30 → 29 分钟）没意义：至少挪出 2 个步长或 12%
    const minDelta = Math.max(step * 2, Math.abs(base) * 0.12);
    if (Math.abs(v - base) < minDelta) {
      const up = Math.min(f.max, base + minDelta);
      const dn = Math.max(f.min, base - minDelta);
      // 哪边空间大往哪边走
      v = (up - base) >= (base - dn) ? up : dn;
      v = Math.round(v / step) * step;
      v = Math.round(v * 100) / 100;
    }
    return v;
  }

  /* 洗牌 */
  function saShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ------------------------------------------------------------
   * 抽一次：先抽「改几项」（1 ~ 全部），再随机挑这几项。
   * 完全随机，没有概率权重、没有间隔限制。
   * 但要满足两条硬规则，否则会抽出「改了却没生效」的假改动：
   *   ① 开关关着 → 不动它下面那些区间（gate）
   *   ② 主动发消息是「固定间隔」还是「随机区间」→ 只从对上的那一侧抽（when）
   * settings 用来读原值；缺失的用 def。
   * ------------------------------------------------------------ */
  function saPick(settings, depth, max) {
    /* max：上限（主项目真机演出用 1～4 处，67 项全改一趟演不完）。
       不传就是原来那套「1～全部」，预览页的随机仍然照旧。 */
    const cap = Math.max(1, Math.min(SA_FIELDS.length, max || SA_FIELDS.length));
    const count = 1 + Math.floor(Math.random() * cap);   // 1 ~ cap
    const order = saShuffle(SA_FIELDS);
    const changes = [];
    for (const f of order) {
      if (changes.length >= count) break;
      if (!saFieldUsable(f, settings, changes)) continue;
      changes.push(saMakeChange(f, settings));
    }
    saFixExclusive(changes, settings);   // 先把「开关关了 / 模式不对」的剔除
    saFixPairs(settings, changes);
    // 极端情况下所有改动都被判「改不动」，再抽一次
    if (!changes.length) {
      if ((depth || 0) < 3) return saPick(settings, (depth || 0) + 1, max);
      return [];
    }
    return changes;
  }

  /* 开关值统一成 true / false（settings 里可能存成 0/1、'false'） */
  function saReadSwitch(settings, f) {
    const v = settings ? settings[f.k] : undefined;
    if (v === undefined || v === null || v === '') return f.def !== false;
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return true;
  }

  /* 读一项此刻的值：本次已经排进去的改动优先，其次设置里的原值 */
  function saValWith(settings, changes, key) {
    const f = SA_BY_KEY[key];
    const c = (changes || []).find((x) => x.key === key);
    if (c) return c.to;
    if (!f) return undefined;
    return f.type === 'switch' ? saReadSwitch(settings, f) : saReadValue(settings, f);
  }

  /* 主动发消息：固定间隔 / 随机区间（互斥的两个模式，对应主项目那两个勾选框） */
  function saProactiveMode(settings, changes) {
    return saValWith(settings, changes, 'proactiveRandom') ? 'random' : 'fixed';
  }

  /* 这一项此刻改了有没有意义 */
  function saFieldUsable(f, settings, changes) {
    if (f.gate && !saValWith(settings, changes, f.gate)) return false;
    if (f.when && f.when !== saProactiveMode(settings, changes)) return false;
    return true;
  }

  /* 造一条改动：开关是「翻转」，数值是在原值附近浮动 */
  function saMakeChange(f, settings) {
    const from = f.type === 'switch' ? saReadSwitch(settings, f) : saReadValue(settings, f);
    const to = f.type === 'switch' ? !from : saRandVal(f, from);
    return {
      key: f.k, panel: f.panel, label: f.label, unit: f.unit || '',
      from: from, to: to, zero: f.zero, up: f.up, down: f.down,
      isSwitch: f.type === 'switch',
      reverted: false, chased: false,
    };
  }

  /* 抽完之后再校一次：这一轮里某个开关被关掉了，它下面的区间就不该留在清单里；
     主动发消息的模式如果被翻转了，另一侧的间隔也不该留着。 */
  function saFixExclusive(changes, settings) {
    for (let i = changes.length - 1; i >= 0; i--) {
      const f = SA_BY_KEY[changes[i].key];
      if (!f) continue;
      if (f.gate && !saValWith(settings, changes, f.gate)) { changes.splice(i, 1); continue; }
      if (f.when && f.when !== saProactiveMode(settings, changes)) { changes.splice(i, 1); }
    }
  }

  /* ------------------------------------------------------------
   * 区间合法性：上下限各自随机，很容易抽出「下限 303 / 上限 300」这种矛盾。
   * 统一收口，并且保证「下限 < 上限」至少差一个步长：
   *   · 上下限都被抽到 → 先把上限抬起来；抬不动就把下限压下去；
   *   · 只抽到一头 → 给另一头补一条「随动」改动（清单里会标出来，不偷偷改）；
   *   · 实在顶不开（已经贴着边界）→ 这一项这次不改，直接从清单里去掉。
   * ------------------------------------------------------------ */
  function saFixPairs(settings, changes) {
    const roundTo = (v, s) => Math.round(Math.round(v / s) * s * 100) / 100;

    for (const [lo, hi] of SA_PAIRS) {
      const cl = changes.find((c) => c.key === lo);
      const ch = changes.find((c) => c.key === hi);
      if (!cl && !ch) continue;

      const fl = SA_BY_KEY[lo], fh = SA_BY_KEY[hi];
      const step = Math.max(fl.step || 1, fh.step || 1);
      const loVal = cl ? cl.to : saReadValue(settings, fl);
      const hiVal = ch ? ch.to : saReadValue(settings, fh);
      if (loVal < hiVal) continue;              // 本来就合法，什么都不用做

      if (cl && ch) {
        const up = Math.min(fh.max, loVal + step);
        if (up > loVal) { ch.to = roundTo(up, fh.step || 1); continue; }
        const dn = Math.max(fl.min, hiVal - step);
        if (dn < hiVal) { cl.to = roundTo(dn, fl.step || 1); continue; }
        cl.to = cl.from; ch.to = ch.from;       // 顶不开，这次不动
      } else if (ch) {
        const up = Math.min(fh.max, loVal + step);
        if (up > loVal) ch.to = roundTo(up, fh.step || 1);
        else ch.to = ch.from;
      } else {
        // 只改了下限：补一条随动（不偷偷改，清单里会写「随动」）
        const to = Math.min(fh.max, Math.max(hiVal, loVal + step));
        changes.push({
          key: hi, panel: fh.panel, label: fh.label, unit: fh.unit,
          from: saReadValue(settings, fh), to: roundTo(to, fh.step || 1),
          zero: fh.zero, up: fh.up, down: fh.down,
          reverted: false, chased: true,
        });
      }
    }

    // 收拾掉「X → X」这种没意义的行
    for (let i = changes.length - 1; i >= 0; i--) {
      if (Number(changes[i].to) === Number(changes[i].from)) changes.splice(i, 1);
    }
  }

  function saReadValue(settings, f) {
    const v = settings ? settings[f.k] : undefined;
    if (v === undefined || v === null || v === '') return f.def;
    const n = parseFloat(v);
    return isNaN(n) ? f.def : n;
  }

  /* ------------------------------------------------------------
   * 把改动写进 settings（原地改）。同时做一次「区间对」的钳制：
   * 下限 > 上限时把上限顶上去，保证设置面板不会出现红字/异常。
   * ------------------------------------------------------------ */
  const SA_PAIRS = SA_RANGES.map((r) => [r.lo, r.hi]);

  function saApply(settings, changes) {
    if (!settings || !changes) return;
    for (const c of changes) {
      if (c.reverted) continue;
      settings[c.key] = c.to;
    }
    saClampPairs(settings);
  }

  /* 撤回一条：把值还原成 from，并重新钳制 */
  function saRevertOne(settings, change) {
    if (!settings || !change || change.reverted) return;
    change.reverted = true;
    settings[change.key] = change.from;
    saClampPairs(settings);
  }

  /* 恢复一条（撤回之后又点回来） */
  function saRestoreOne(settings, change) {
    if (!settings || !change || !change.reverted) return;
    change.reverted = false;
    settings[change.key] = change.to;
    saClampPairs(settings);
  }

  /* 全部撤回 */
  function saRevertAll(settings, changes) {
    if (!settings || !changes) return;
    for (const c of changes) { c.reverted = true; settings[c.key] = c.from; }
    saClampPairs(settings);
  }

  /* 区间钳制：下限不超过上限，上限不低于下限 */
  function saClampPairs(settings) {
    for (const [lo, hi] of SA_PAIRS) {
      if (settings[lo] === undefined || settings[hi] === undefined) continue;
      const a = parseFloat(settings[lo]), b = parseFloat(settings[hi]);
      if (isNaN(a) || isNaN(b)) continue;
      if (a > b) settings[hi] = a;
    }
  }

  /* ------------------------------------------------------------
   * 字段说明表（纯文本）：塞进 AI 上下文用。
   * 只写「改成多少会有什么效果」，不写任何概率与触发规则。
   * ------------------------------------------------------------ */
  function saFieldDoc() {
    const lines = [];
    let panel = '';
    for (const f of SA_FIELDS) {
      if (f.panel !== panel) { panel = f.panel; lines.push('\n【' + panel + '】'); }
      if (f.type === 'switch') {
        lines.push('- ' + f.label + '（开关，默认' + (f.def !== false ? '开' : '关') + '）：' + f.up + '；' + f.down);
        continue;
      }
      let s = '- ' + f.label + '（' + f.unit + '，' + f.min + '～' + f.max + '）';
      if (f.zero) s += '：' + f.zero;
      s += '；调大 → ' + f.up + '，调小 → ' + f.down;
      lines.push(s);
    }
    return lines.join('\n').trim();
  }

  /* ------------------------------------------------------------
   * 把一长串改动折成「给人看」的行：
   *   · 同一区间组的上下限 → 一行（30~90 分钟 → 45~299 分钟）
   *   · 单个字段 → 一行（姻缘牵概率 1.5 % → 3.4 %）
   * 并按面板分组，顺序与聊天设置里的面板一致。
   * settings 只用来补「这一组里没被改到的那一头」的值。
   * ------------------------------------------------------------ */
  function saGroupChanges(changes, settings) {
    const map = new Map();
    for (const c of changes || []) if (c) map.set(c.key, c);
    const used = new Set();
    const groups = [];
    // 数字收一下，别让清单里冒 1.7000000000000002
    const fmt = (v) => String(Math.round(Number(v) * 100) / 100);

    for (const f of SA_FIELDS) {
      if (used.has(f.k)) continue;
      const rg = SA_RANGE_BY_LO[f.k];
      let row = null;

      if (rg) {
        const cl = map.get(rg.lo), ch = map.get(rg.hi);
        used.add(rg.lo); used.add(rg.hi);
        if (!cl && !ch) continue;
        const of_ = SA_BY_KEY[rg.lo], of2 = SA_BY_KEY[rg.hi];
        const fromLo = cl ? cl.from : saReadValue(settings, of_);
        const fromHi = ch ? ch.from : saReadValue(settings, of2);
        const toLo = cl ? cl.to : saReadValue(settings, of_);
        const toHi = ch ? ch.to : saReadValue(settings, of2);
        const items = [cl, ch].filter(Boolean);
        row = {
          kind: 'pair', panel: f.panel, name: rg.name, unit: rg.unit,
          from: fmt(fromLo) + '~' + fmt(fromHi) + (rg.unit ? ' ' + rg.unit : ''),
          to: fmt(toLo) + '~' + fmt(toHi) + (rg.unit ? ' ' + rg.unit : ''),
          items: items,
          reverted: items.every((x) => x.reverted),
          chased: items.some((x) => x.chased),
        };
      } else {
        const c = map.get(f.k);
        if (!c) continue;
        used.add(f.k);
        if (f.type === 'switch') {
          // 开关行写成「开 → 关」，不要出现 true/false
          row = {
            kind: 'switch', panel: f.panel, name: f.label, unit: '',
            from: c.from ? '开' : '关',
            to: c.to ? '开' : '关',
            items: [c], reverted: !!c.reverted, chased: false,
          };
        } else {
          row = {
            kind: 'single', panel: f.panel, name: f.label, unit: f.unit,
            from: fmt(c.from) + (f.unit ? ' ' + f.unit : ''),
            to: fmt(c.to) + (f.unit ? ' ' + f.unit : ''),
            items: [c], reverted: !!c.reverted, chased: false,
          };
        }
      }

      let g = groups.find((x) => x.panel === row.panel);
      if (!g) { g = { panel: row.panel, rows: [] }; groups.push(g); }
      g.rows.push(row);
    }
    return groups;
  }

  /* 一行 = 一组改动。「已撤回」就整行恢复，否则整行撤回 */
  function saToggleRow(settings, row) {
    if (!row || !row.items) return;
    const allRev = row.items.every((x) => x.reverted);
    for (const c of row.items) {
      if (allRev) saRestoreOne(settings, c); else saRevertOne(settings, c);
    }
  }

  /* 折成行之后还剩几行（清单、小卡上显示的「N 处」都用这个数） */
  function saRowCount(changes, settings) {
    let n = 0;
    for (const g of saGroupChanges(changes, settings)) n += g.rows.length;
    return n;
  }

  window.SA_FIELDS = SA_FIELDS;
  window.SA = {
    fields: SA_FIELDS,
    byKey: SA_BY_KEY,
    pick: saPick,
    fixPairs: saFixPairs,
    fixExclusive: saFixExclusive,
    usable: saFieldUsable,
    readValue: saReadValue,
    apply: saApply,
    revertOne: saRevertOne,
    restoreOne: saRestoreOne,
    revertAll: saRevertAll,
    clampPairs: saClampPairs,
    randomValue: saRandVal,
    fieldDoc: saFieldDoc,
    ranges: SA_RANGES,
    groupChanges: saGroupChanges,
    toggleRow: saToggleRow,
    rowCount: saRowCount,
  };

  /* ══════════════════════════════════════════════════════════
   * 下面是「接进主项目」的那一层：隐藏卡判定 + 浮层卡片
   * ------------------------------------------------------------
   * app.js 只在 generateCharReply 开头调一次 bmSelfAdjustMaybe(charId)，
   * 命中就整条回复换成「开场话 + 申请小卡」，其余逻辑完全不动。
   * 演出动画不在这里（见 __selfadj_preview.html），主项目只出卡片和清单。
   * ══════════════════════════════════════════════════════════ */

  /* 20261116：开场话整段删掉 —— 玩家定案「发卡片消息就够了，不用发这句话」。
     以前这里是 6 句随机开场白，现在申请就是一张卡，落屏即完了。 */

  /* 申请登记簿：id → { charId, changes, n, at, done }
     只在内存里（刷新后点老卡片会提示已过期）；改过的值本身是落库的。 */
  const _pending = Object.create(null);

  /* 判定：抽不中返回 null；抽中返回 { type:'selfadjust_card' }（不带任何文字气泡） */
  async function bmSelfAdjustMaybe(charId) {
    try {
      if (typeof currentGroupId !== 'undefined' && currentGroupId) return null;   // 群聊完全不碰
      const c = (typeof characters !== 'undefined' && characters)
        ? characters.find((x) => x.id === charId) : null;
      if (!c) return null;
      const cs = (typeof getCharChatSettings === 'function') ? getCharChatSettings(c) : null;
      if (!cs) return null;

      /* 20261114（用户定案）：不再走「字卡池 + 1」的稀有度，改成固定 3% 概率。
         每一条角色回复都有 3% 的机会变成「开场话 + 申请卡」，
         跟玩家自己的字卡多不多彻底解耦——池子再大也不会更难抽。 */
      const SA_CHANCE = 0.03;
      if (Math.random() >= SA_CHANCE) return null;

      /* 真机上一趟最多改 4 处：67 项全改的话，逐项演出要演好几分钟 */
      const changes = saPick(cs, 0, 4);
      if (!changes.length) return null;
      let nRows = changes.length;
      try { nRows = saRowCount(changes, cs); } catch (e) {}
      const id = saNewId();
      saRemember(id, c, changes, nRows);

      /* 20261116：只发卡，不发开场话。
         卡片在 700ms 后自己投进聊天流（先让「正在输入」闪一下，不像凭空冒出来的）；
         返回的 selfadjust_card 会让主链一条文字都不落库。 */
      setTimeout(() => {
        try { bmSelfAdjustCardDeliver(c, { n: nRows, id: id, done: false }); } catch (e) {}
      }, 700);
      return { type: 'selfadjust_card', text: '' };
    } catch (e) {
      return null;
    }
  }

  /* 写回：只把这个角色和全局不一样的值写进 c.chatSettings，再 saveChar（与面板同一套惯例） */
  async function bmSelfAdjustCommit(c, changes) {
    try {
      if (!c || !changes) return;
      c.chatSettings = c.chatSettings || {};
      const merged = (typeof getCharChatSettings === 'function') ? getCharChatSettings(c) : {};
      for (const ch of changes) {
        /* 撤回的项要写回「原值」，不能直接跳过 —— 跳过就等于撤回没生效。 */
        const target = ch.reverted ? ch.from : ch.to;
        const gv = (typeof chatSettings !== 'undefined') ? chatSettings[ch.key] : undefined;
        if (gv !== undefined && Number(gv) === Number(target)) delete c.chatSettings[ch.key];
        else c.chatSettings[ch.key] = target;
      }
      if (typeof saveChar === 'function') await saveChar(c);
      // 保存后合并层要重算，避免同一次会话里继续用旧值
      if (typeof refreshCharacters === 'function') { try { await refreshCharacters(); } catch (e) {} }
    } catch (e) {}
  }

  /* ---------- 样式（只注入一次） ----------
     全部走主项目的主题变量：--purple / --purple-soft / --purple-dim / --purple-glow /
     --bg-elevated / --border / --text…
     这样「入梦」深色、十套浅色预设（樱粉/雾蓝/薄荷/杏黄/雾灰/暗红/莓红…）下，
     申请卡、同意窗、清单、完成卡都跟着当前美化预设走，不再是一块固定的深紫。 */
  let _styleDone = false;
  function bmSelfAdjustStyle() {
    if (_styleDone) return;
    _styleDone = true;
    const st = document.createElement('style');
    st.textContent = `
/* ===== 角色自调数值 · 浮层（跟随全局主题 / 美化预设） ===== */
/* 遮罩自己负责居中：同意窗 / 清单都落在屏幕正中，不再是贴底的底部条 */
.bm-sa-mask{position:fixed;inset:0;z-index:9000;background:rgba(6,5,10,.55);
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
  display:flex;align-items:center;justify-content:center;padding:22px;
  opacity:0;transition:opacity .26s;}
.bm-sa-mask.on{opacity:1;}
.bm-sa-card{position:relative;width:100%;max-width:400px;max-height:82vh;overflow-y:auto;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  border-radius:24px;padding:24px 22px 18px;
  background:var(--bg-elevated);border:1px solid var(--border);
  box-shadow:0 18px 54px rgba(0,0,0,.38);
  color:var(--text);
  transform:translateY(18px) scale(.97);opacity:0;
  transition:transform .34s cubic-bezier(.2,.9,.3,1.1),opacity .28s;}
.bm-sa-card.on{transform:none;opacity:1;}
.bm-sa-card h4{margin:0;font-size:17px;font-weight:650;color:var(--text);}
/* 同意窗：与预览页逐字同一套版式——居中标题、两行说明、底下两颗大胶囊按钮 */
.bm-sa-ask{text-align:center;}
.bm-sa-title{font-size:17px;font-weight:650;letter-spacing:.2px;color:var(--text);}
.bm-sa-meta{margin-top:10px;font-size:12px;color:var(--text-tertiary);}
.bm-sa-meta b{color:var(--purple-soft);font-weight:650;}
.bm-sa-panels{margin-top:14px;font-size:13px;line-height:1.85;color:var(--text-secondary);}
.bm-sa-card .bm-sa-sub{margin-top:6px;font-size:12.5px;line-height:1.6;color:var(--text-tertiary);}
.bm-sa-card .bm-sa-sub b{color:var(--purple-soft);}
.bm-sa-card .bm-sa-row{display:flex;gap:10px;margin-top:22px;}
.bm-sa-card button{flex:1;height:52px;border-radius:26px;border:1px solid var(--border);
  background:var(--bg-elevated-2);color:var(--text);font-size:15.5px;font-weight:600;font-family:inherit;}
.bm-sa-card button.pri{background:var(--purple);border-color:transparent;color:#141019;font-weight:650;}
.bm-sa-card button:active{opacity:.86;}
.bm-sa-card button[disabled]{opacity:.4;}
.bm-sa-list{max-height:46vh;overflow-y:auto;margin-top:6px;}
.bm-sa-grp{display:flex;align-items:center;gap:8px;margin:14px 0 2px;font-size:11px;letter-spacing:.6px;
  color:var(--purple-soft);}
.bm-sa-grp:first-child{margin-top:6px;}
.bm-sa-grp::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--purple-glow),transparent);}
.bm-sa-li{display:flex;align-items:flex-start;gap:10px;padding:10px 2px 11px;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);}
.bm-sa-li .cb{width:18px;height:18px;border-radius:6px;border:1.5px solid var(--border);display:grid;place-items:center;font-size:11px;color:transparent;cursor:pointer;margin-top:1px;flex:0 0 auto;}
.bm-sa-li.on .cb{background:var(--purple-dim);border-color:var(--purple);color:var(--text);}
.bm-sa-li.rev .cb{border-color:var(--danger);color:var(--danger);font-size:12.5px;}
.bm-sa-li .mn{flex:1;min-width:0;}
.bm-sa-li .nm{line-height:1.45;}
.bm-sa-li .nm i{font-style:normal;font-size:10.5px;color:var(--text-tertiary);margin-left:5px;}
.bm-sa-li .vv{display:block;margin-top:3px;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12px;color:var(--text-tertiary);}
.bm-sa-li .vv s{text-decoration:line-through;}
.bm-sa-li .vv i{font-style:normal;margin:0 7px;opacity:.55;}
.bm-sa-li .vv em{font-style:normal;color:var(--purple-soft);font-weight:600;}
.bm-sa-li.rev .nm{color:var(--text-tertiary);text-decoration:line-through;}
.bm-sa-li.rev .vv em{color:var(--danger);}
.bm-sa-bulk{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:11px;
  border-top:1px solid var(--border);font-size:12.5px;color:var(--text-secondary);}
.bm-sa-bulk label{display:flex;align-items:center;gap:7px;flex:0 0 auto;}
.bm-sa-bulk input[type=checkbox]{width:16px;height:16px;accent-color:var(--purple);margin:0;}
.bm-sa-bulk .cnt{flex:1;color:var(--text-tertiary);font-variant-numeric:tabular-nums;}
.bm-sa-bulk .undoall{flex:0 0 auto;background:none;border:0;padding:4px 2px;color:var(--danger);
  font-size:12.5px;font-family:inherit;}

/* ===== 演出光标：角色点到哪儿，必须看得见 =====
   · 手指模式 = 屏幕录制那种白色触点（实心点 + 外圈 + 点击涟漪）
   · 鼠标模式 = 白色箭头，按下时缩一下
   · 位置写在独立 translate 上（--cx/--cy），transform 只给按下缩放，两者不打架 */
.bm-sa-cur{position:fixed;left:var(--cx,0px);top:var(--cy,0px);z-index:9700;pointer-events:none;opacity:0;
  transition:left .62s cubic-bezier(.35,.9,.25,1),top .62s cubic-bezier(.35,.9,.25,1),opacity .2s;}
.bm-sa-cur.on{opacity:1;}
/* 手指触点：圆心对准目标中心（30px 见方，负 margin 15px） */
.bm-sa-cur.finger{width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;
  border:2px solid rgba(255,255,255,.95);
  background:radial-gradient(circle, rgba(255,255,255,.92) 0 30%, rgba(167,139,250,.30) 31% 100%);
  box-shadow:0 0 16px rgba(167,139,250,.9), 0 2px 8px rgba(0,0,0,.5);
  transition:left .62s cubic-bezier(.35,.9,.25,1),top .62s cubic-bezier(.35,.9,.25,1),opacity .2s,transform .12s;}
.bm-sa-cur.finger::after{content:'';position:absolute;inset:-7px;border-radius:50%;
  border:1.5px solid rgba(255,255,255,.42);}
.bm-sa-cur.finger.press{transform:scale(.84);}
/* 鼠标箭头：对准的是「箭头的尖端」，不是图片中心 ——
   SVG 里尖端在 (5, 3.2)/24，按 22px 缩放约 (4.6, 2.9)，
   所以左上各负这么多，尖端才正好落在目标点上。
   以前按图片中心对齐，尖端偏左上 8px，看着就是「没点在按钮上」。 */
.bm-sa-cur.mouse{width:22px;height:22px;margin:-3px 0 0 -5px;}
.bm-sa-cur.mouse svg{width:22px;height:22px;display:block;
  filter:drop-shadow(0 2px 5px rgba(0,0,0,.75));
  transform-origin:4px 3px;transition:transform .1s;}
.bm-sa-cur.mouse.press svg{transform:scale(.8);}
/* 点击涟漪 */
.bm-sa-rip{position:fixed;left:var(--cx,0px);top:var(--cy,0px);z-index:9699;pointer-events:none;
  width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;
  border:2px solid rgba(255,255,255,.92);opacity:0;}
.bm-sa-rip.go{animation:bmSaRip .66s cubic-bezier(.2,.7,.3,1) forwards;}
@keyframes bmSaRip{0%{opacity:.95;transform:scale(.55);}100%{opacity:0;transform:scale(2.6);}}

/* ===== 聊天流里的申请卡 / 完成卡（跟着气泡里的 .msg-card 走主题） ===== */
.bm-sa-cc{cursor:pointer;border-color:var(--purple-glow) !important;background:var(--purple-dim) !important;}
.bm-sa-cc .bm-sa-cc-t{font-size:14.5px;font-weight:650;color:var(--text);margin-top:2px;line-height:1.4;}
.bm-sa-cc .bm-sa-cc-s{font-size:11.5px;color:var(--text-tertiary);margin-top:4px;}
.bm-sa-cc .bm-sa-cc-arr{float:right;color:var(--purple-soft);font-size:15px;line-height:1;}
.bm-sa-cc:active{transform:scale(.985);}

/* ===== 演出高亮：正在改的那一块（跟预览页同一个观感） ===== */
#modal-content .bm-sa-hit{
  background:var(--purple-dim) !important;
  box-shadow:0 0 0 1px var(--purple-glow), 0 6px 22px var(--purple-dim) !important;
  border-color:var(--purple) !important;
  transition:background .3s ease, box-shadow .3s ease;
}
#modal-content .bm-sa-hit label{color:var(--purple-soft) !important;}
`;
    document.head.appendChild(st);
  }

  /* ---------- 聊天流卡片 ----------
     申请卡 / 完成卡的 HTML 由这里出，app.js 的 msgBodyHtml 直接调用
     （这样卡片的观感只需要维护一份）。 */
  function bmSelfAdjustCardHtml(p) {
    const n = (p && p.n) || 0;
    const done = !!(p && p.done);
    const id = (p && p.id) || '';
    return '<div class="msg-card bm-sa-cc' + (done ? ' done' : '') + '" data-sa-card="' + id + '" data-sa-done="' + (done ? 1 : 0) + '">' +
      '<span class="msg-card-tag">' + (done ? '改好了' : '数值修改申请') + '</span>' +
      '<div class="bm-sa-cc-t">' + (done ? ('动了 ' + n + ' 处') : ('想改 ' + n + ' 处数值')) +
        '<span class="bm-sa-cc-arr">&#8250;</span></div>' +
      '<div class="bm-sa-cc-s">' + (done ? '点开看看改了哪些数值' : '点开看看，你可以拒绝') + '</div>' +
      '</div>';
  }

  /* 把一张卡投递进聊天流（落库 + 上屏 + 通知，走主项目同一条管道） */
  async function bmSelfAdjustCardDeliver(c, payload) {
    if (!c || typeof deliverCharMessage !== 'function') return;
    try { await deliverCharMessage(c, null, 'selfAdjust', payload); } catch (e) {}
  }

  /* 申请登记簿：卡片点开时按 id 找回这一单（只在内存，刷新后点老卡片会提示已过期） */
  function saNewId() { return 'sa' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function saRemember(id, c, changes, n) {
    _pending[id] = { charId: c.id, changes: changes, n: n, at: Date.now(), done: false };
    return id;
  }

  /* 点聊天里的卡片（ask / done 两种） */
  function bmSelfAdjustOpenCard(id, done) {
    const p = id ? _pending[id] : null;
    const c = p ? (typeof characters !== 'undefined' ? characters.find((x) => x.id === p.charId) : null) : null;
    if (!p || !c) {
      if (typeof miniToast === 'function') miniToast('这次申请已经过期了，等 TA 下次再提');
      return;
    }
    bmSelfAdjustStyle();
    if (done || p.done) bmSelfAdjustList(c, p.changes);
    else bmSelfAdjustConfirm(c, p.changes, id);
  }

  /* ---------- 演出的 DOM 小工具 ---------- */
  const saWait = (ms) => new Promise((r) => setTimeout(r, ms));
  /* 主项目里 #modal-content 本身就是那个 .modal（同一个节点），它自己负责滚动 */
  const saModalBox = () => document.getElementById('modal-content');
  const saModalRoot = () => document.getElementById('modal-content');
  const saNorm = (t) => String(t || '').replace(/[\s\u3000]+/g, '');

  /* ------------------------------------------------------------
   * 每个字段对应的「主项目真实控件 id」
   * 演出直接按 id 找控件，不再靠功能名猜：
   *   ① 一定点在真按钮/真输入框上，不会点到别的行；
   *   ② 四季那种「一张大卡里四组区间」也能精确到那一组；
   *   ③ 找不到就是主项目真没有（比如番茄钟），而不是名字没对上。
   * 主项目改 id 时，这张表要跟着改。
   * ------------------------------------------------------------ */
  const SA_DOM = {
    /* 回复 */
    minDelay: 'cs-min-num', maxDelay: 'cs-max-num',
    eventYinyuan: 'cs-event-yinyuan', eventYinyuanChance: 'cs-event-yinyuan-pct',
    eventGaze: 'cs-event-gaze', eventGazeChance: 'cs-event-gaze-pct',
    /* 主动 */
    proactive: 'cs-proactive', proactiveRandom: 'cs-proactive-random',
    proactiveMin: 'cs-proactive-min',
    proactiveRandMin: 'cs-proactive-rand-min', proactiveRandMax: 'cs-proactive-rand-max',
    proactiveCheckin: 'cs-proactive-checkin', checkinDailyLimit: 'cs-checkin-limit',
    randomCall: 'cs-random-call', callDailyLimit: 'cs-call-limit',
    randomPacket: 'cs-random-packet',
    lettersEnabled: 'cs-letters', lettersDailyLimit: 'cs-letter-limit',
    /* 通话 */
    callIntervalMin: 'cs-call-interval-min', callIntervalMax: 'cs-call-interval-max',
    callAutoHangup: 'cs-call-auto-hangup',
    callHangupMin: 'cs-call-hangup-min', callHangupMax: 'cs-call-hangup-max',
    /* 消息 */
    allowRecall: 'cs-recall',
    /* 四季 */
    seasonCareGapMin: 'cs-season-care-gap-min', seasonCareGapMax: 'cs-season-care-gap-max',
    seasonCardGapMin: 'cs-season-card-gap-min', seasonCardGapMax: 'cs-season-card-gap-max',
    seasonAiGapMin: 'cs-season-ai-gap-min', seasonAiGapMax: 'cs-season-ai-gap-max',
    seasonLoveGapMin: 'cs-season-love-gap-min', seasonLoveGapMax: 'cs-season-love-gap-max',
    /* 字卡组合 */
    multiCardOn: 'cs-multicard-on',
    multiCardCountMin: 'cs-multicard-count-min', multiCardCountMax: 'cs-multicard-count-max',
    multiCardIntervalMin: 'cs-multicard-interval-min', multiCardIntervalMax: 'cs-multicard-interval-max',
    /* 打字卡 */
    typecardOn: 'cs-typecard-on', typecardSummon: 'cs-typecard-summon',
    typecardSummonIntervalMin: 'cs-typecard-summon-interval-min',
    typecardSummonIntervalMax: 'cs-typecard-summon-interval-max',
    /* 行程 */
    bmSchedDetect: 'cs-bm-sched',
    charSchedCountMin: 'cs-char-sched-min', charSchedCountMax: 'cs-char-sched-max',
    commentPickCountMin: 'cs-comment-pick-min', commentPickCountMax: 'cs-comment-pick-max',
    /* 音乐 */
    musicAuto: 'cs-music-auto', musicAutoMin: 'cs-music-auto-min', musicAutoMax: 'cs-music-auto-max',
    musicModeSwitch: 'cs-music-mode-switch',
    musicModeSwitchMin: 'cs-music-mode-min', musicModeSwitchMax: 'cs-music-mode-max',
    musicInvite: 'cs-music-invite', musicInviteMin: 'cs-music-invite-min', musicInviteMax: 'cs-music-invite-max',
    musicSwap: 'cs-music-swap', musicSwapMin: 'cs-music-swap-min', musicSwapMax: 'cs-music-swap-max',
    musicShare: 'cs-music-share', musicShareMin: 'cs-music-share-min', musicShareMax: 'cs-music-share-max',
    musicPeek: 'cs-music-peek',
    /* 视频 */
    videoAuto: 'cs-video-auto',
    videoAutoMin: 'cs-video-auto-min', videoAutoMax: 'cs-video-auto-max',
    /* 番茄钟 · 前台互动 */
    companionInteractMin: 'cs-companion-interact-min',
    companionInteractMax: 'cs-companion-interact-max'
  };

  /* 当前显示着的面板（tab 切过之后只有它是 block） */
  function saActivePanel() {
    const root = saModalRoot();
    if (!root) return null;
    const ps = Array.prototype.slice.call(root.querySelectorAll('.cs-panel'));
    let hit = null;
    for (const p of ps) {
      /* 必须看 computed：默认隐藏是靠 .cs-panel 的 CSS，内联 style 还是空字符串，
         只看 style.display 会把「从没被激活过」的面板误当成当前页。 */
      let d = '';
      try { d = getComputedStyle(p).display; } catch (e) { d = p.style.display || 'block'; }
      if (d !== 'none') { hit = p; break; }
    }
    return hit || ps[0] || null;
  }

  /* 强制切到某一页（tab 点击失效时的兜底，保证「切页」这件事一定发生） */
  function saActivatePanel(name) {
    const root = saModalRoot();
    if (!root) return false;
    let hit = false;
    root.querySelectorAll('.cs-panel').forEach((p) => {
      const on = p.dataset.csPanel === name;
      p.style.display = on ? 'block' : 'none';
      if (on) hit = true;
    });
    root.querySelectorAll('.cs-tab').forEach((b) => b.classList.toggle('on', b.dataset.csTab === name));
    return hit;
  }

  /* 从输入框往上找「该高亮的那一块」：
     四季那种一张大卡里塞了四组区间的，返回那一组的小卡；
     普通设置项返回整张 .field 卡。 */
  function saRowOf(inp) {
    let el = inp;
    while (el && el !== document.body) {
      const p = el.parentElement;
      if (!p) break;
      if (p.classList && p.classList.contains('cs-panel')) return el;
      if (p.classList && p.classList.contains('field')) {
        /* el 是 .field 的直接子块：带小标题的（四季的子卡）用它，否则用整张卡 */
        return el.querySelector('span[style*="font-weight"]') ? el : p;
      }
      el = p;
    }
    return (inp.closest && inp.closest('.field')) || inp.parentElement;
  }

  /* 文本兜底：只在「当前显示的面板」里找。
     以前在全部面板里找，隐藏面板里同名的行 rect 全是 0，
     光标就会飞到屏幕左上角 —— 这就是「它没点该点的位置」。 */
  function saFindField(label, scope) {
    const root = scope || saModalRoot();
    if (!root) return null;
    const want = saNorm(label);
    if (!want) return null;
    const rows = Array.prototype.slice.call(root.querySelectorAll('.field'));
    let loose = null;
    for (const el of rows) {
      const lab = el.querySelector('label');
      if (!lab) continue;
      const t = saNorm(lab.textContent);
      if (!t) continue;
      if (t === want) return el;
      if (!loose && (t.indexOf(want) === 0 || t.indexOf(want) > -1)) loose = el;
    }
    return loose;
  }

  /* 找一次改动应该落在哪儿：prefer 真实 id；没有 id 才回退文本匹配。
     返回 { row, num, cb, range } —— num/cb 一定指向真控件。 */
  function saSpot(key, f) {
    const root = saModalRoot();
    if (!root) return null;

    /* ① 真实 id（99% 走这条） */
    const id = SA_DOM[key];
    if (id) {
      const inp = root.querySelector('#' + id);
      if (inp) {
        const isNum = inp.type === 'number';
        const isCb = inp.type === 'checkbox';
        let range = null;
        if (isNum && /-num$/.test(id)) range = root.querySelector('#' + id.replace(/-num$/, ''));
        return {
          row: saRowOf(inp),
          num: isNum ? inp : null,
          cb: isCb ? inp : null,
          range: range
        };
      }
    }

    /* ② 文本兜底（只在当前面板里） */
    const panel = saActivePanel();
    const el = saFindField(f.label, panel || root);
    if (el) {
      return {
        row: el,
        num: el.querySelector('input[type=number]'),
        range: el.querySelector('input[type=range]'),
        cb: el.querySelector('input[type=checkbox]')
      };
    }

    /* ③ 区间回退：组名 + 第 1/2 个数字框 */
    const grp = (SA.ranges || []).find((x) => x.lo === key || x.hi === key);
    if (!grp) return null;
    const el2 = saFindField(grp.name, panel || root);
    if (!el2) return null;
    const nums = Array.prototype.slice.call(el2.querySelectorAll('input[type=number]'));
    const num = nums[key === grp.lo ? 0 : 1];
    if (!num) return null;
    return { row: saRowOf(num), num: num, range: null, cb: null };
  }

  /* ------------------------------------------------------------
   * 弹窗内滚动：自己插值，滚到位才 resolve。
   * 不能用 scrollTo({behavior:'smooth'})——它什么时候停说不准，
   * 光标就会在滚动途中取坐标，看起来「点偏了」。
   * ------------------------------------------------------------ */
  function saScrollTo(el, ms) {
    return new Promise((resolve) => {
      const box = saModalBox();
      if (!box || !el) return resolve();
      const br = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const max = Math.max(0, box.scrollHeight - box.clientHeight);
      const want = box.scrollTop + (r.top + r.height / 2) - (br.top + br.height / 2);
      const target = Math.max(0, Math.min(max, want));
      const from = box.scrollTop;
      if (Math.abs(target - from) < 2) return resolve();
      const dur = Math.max(200, ms || 520);
      const t0 = performance.now();
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        try { box.scrollTop = target; } catch (e) {}
        resolve();
      };
      const tick = (now) => {
        if (done) return;
        const k = Math.min(1, (now - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        box.scrollTop = from + (target - from) * e;
        if (k < 1) requestAnimationFrame(tick);
        else fin();
      };
      requestAnimationFrame(tick);
      /* 切后台 / 锁屏时 rAF 会被挂起，演出不能因此永久卡住 */
      setTimeout(fin, dur + 280);
    });
  }

  /* 滚回弹窗顶部：切 tab 之前必须做——tab 栏在最上面，滚在下面时它不在视野里，
     玩家就看不到「切到了哪一页」，光标也会指到屏幕外。 */
  function saScrollTop(ms) {
    return new Promise((resolve) => {
      const box = saModalBox();
      if (!box) return resolve();
      const from = box.scrollTop;
      if (from <= 1) return resolve();
      const dur = Math.max(160, ms || 420);
      const t0 = performance.now();
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        try { box.scrollTop = 0; } catch (e) {}
        resolve();
      };
      const tick = (now) => {
        if (done) return;
        const k = Math.min(1, (now - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        box.scrollTop = from * (1 - e);
        if (k < 1) requestAnimationFrame(tick);
        else fin();
      };
      requestAnimationFrame(tick);
      setTimeout(fin, dur + 280);
    });
  }

  /* 旧名保留（别处还有调用），内部走新的可控滚动 */
  function saScrollIn(el) { try { saScrollTo(el, 480); } catch (e) {} }

  function saTween(spot, from, to, ms) {
    return new Promise((resolve) => {
      const dur = ms || 620;
      const t0 = performance.now();
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        try {
          if (spot.num) { spot.num.value = to; spot.num.dispatchEvent(new Event('input', { bubbles: true })); }
          if (spot.range) { spot.range.value = to; spot.range.dispatchEvent(new Event('input', { bubbles: true })); }
        } catch (_) {}
        resolve();
      };
      const step = (now) => {
        if (done) return;
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        const v = from + (to - from) * e;
        try {
          if (spot.num) spot.num.value = (Math.round(v * 10) / 10);
          if (spot.range) spot.range.value = v;
        } catch (_) {}
        if (k < 1) requestAnimationFrame(step);
        else fin();
      };
      requestAnimationFrame(step);
      setTimeout(fin, dur + 260);
    });
  }

  /* 节奏：上一版已经放慢一档，这次再翻一倍（用户：还是太快，再慢一半） */
  const SA_PACE = { move: 760, scroll: 960, look: 640, val: 1800, rest: 880, tab: 1100, page: 1300, press: 260 };

  /* ---------- 演出光标：手指触点 / 鼠标箭头 ----------
     模式：localStorage.sa_ptr_mode 优先（预览页里选过就同步），
     没选过就按设备判断——触屏用手指、桌面用鼠标。全程不随机。 */
  let _cur = null, _rip = null;

  function saPtrMode() {
    let m = '';
    try { m = localStorage.getItem('sa_ptr_mode') || ''; } catch (e) {}
    if (m === 'mouse' || m === 'finger') return m;
    try { return (window.matchMedia && matchMedia('(pointer: coarse)').matches) ? 'finger' : 'mouse'; }
    catch (e) { return 'finger'; }
  }
  function saPtrBuild() {
    if (_cur) return _cur;
    const mode = saPtrMode();
    const c = document.createElement('div');
    c.className = 'bm-sa-cur ' + mode;
    if (mode === 'mouse') {
      c.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 3.2 L18.4 12.1 L12.6 13.2 L15.4 19.4 L12.9 20.6 L10.1 14.4 L5.9 18.1 Z" fill="#fff" stroke="#2a2338" stroke-width="1.15" stroke-linejoin="round"/></svg>';
    }
    _rip = document.createElement('div');
    _rip.className = 'bm-sa-rip';
    document.body.appendChild(c);
    document.body.appendChild(_rip);
    _cur = c;
    return _cur;
  }
  let _ptrFirst = true;
  function saPtrPlace(x, y) {
    const c = saPtrBuild();
    /* 第一次出现时直接落到位，不要从屏幕左上角「飞」过来 */
    if (_ptrFirst) {
      c.style.transition = 'none';
      _rip.style.transition = 'none';
    }
    c.style.setProperty('--cx', x + 'px');
    c.style.setProperty('--cy', y + 'px');
    _rip.style.setProperty('--cx', x + 'px');
    _rip.style.setProperty('--cy', y + 'px');
    c.classList.add('on');
    if (_ptrFirst) {
      _ptrFirst = false;
      void c.offsetWidth;
      requestAnimationFrame(() => { c.style.transition = ''; _rip.style.transition = ''; });
    }
  }
  function saPtrHide() {
    if (!_cur) return;
    _cur.classList.remove('on', 'press');
    _rip.classList.remove('go');
  }
  function saAim(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /* 把光标挪到元素中心，停一下——让眼睛先跟上「TA 要点哪儿」 */
  async function saMoveTo(el, ms) {
    const p = saAim(el);
    if (!p) return null;
    saPtrPlace(p.x, p.y);
    await saWait(ms || SA_PACE.move);
    return p;
  }
  /* 点一下：按下 → 涟漪 → onTap（切页/点击与光标同一拍，不然会错位） */
  async function saTap(el, ms, onTap) {
    if (!el) { if (onTap) onTap(); return; }
    const p1 = await saMoveTo(el, ms || SA_PACE.move);
    /* 按下前再量一次：滚动 / 布局在这一瞬可能还在动，
       光标停在「按下的那一刻」的真实位置上，绝不点偏 */
    const p2 = saAim(el);
    if (p2 && (!p1 || Math.abs(p2.x - p1.x) > 2 || Math.abs(p2.y - p1.y) > 2)) saPtrPlace(p2.x, p2.y);
    const c = saPtrBuild();
    c.classList.add('press');
    _rip.classList.remove('go');
    void _rip.offsetWidth;
    _rip.classList.add('go');
    if (onTap) onTap();
    await saWait(SA_PACE.press);
    c.classList.remove('press');
  }

  /* 一路关到底：设置 → 角色主页 → 真的关掉遮罩。
     主项目里「聊天设置」是替换角色主页弹窗的内容，关掉设置会自动弹回主页，
     所以关一次只退一层。这里循环关到遮罩消失为止（最多 5 层，防死循环）。
     之前演出结束只关了一次，人就停在角色主页上了，回不到单聊。 */
  async function saCloseStack() {
    for (let i = 0; i < 5; i++) {
      const mask = document.getElementById('modal-mask');
      if (!mask || !mask.classList.contains('show')) return true;
      try { if (typeof closeModal === 'function') closeModal(); else return false; }
      catch (e) { return false; }
      await saWait(520);
    }
    const m2 = document.getElementById('modal-mask');
    return !(m2 && m2.classList.contains('show'));
  }

  /* 演出结束 → 回到这个角色的单聊页（用户明确要求：改完要回到单聊） */
  async function saBackToChat(c) {
    saPtrHide();
    await saCloseStack();
    await saWait(320);
    if (typeof openChat === 'function') {
      try { await openChat(c.id); } catch (e) {}
      await saWait(720);
    }
  }

  /* ------------------------------------------------------------
   * 演出：聊天页 → 角色主页 → 聊天设置 → 逐项改 → 保存
   * 全程只走主项目自己的入口（#chat-header / #btn-char-chatset / .cs-tab / #cs-save），
   * 光标逐个按钮移过去、按下去，节奏是「看得清」优先。
   * ------------------------------------------------------------ */
  async function bmSelfAdjustPlay(c, changes, id) {
    bmSelfAdjustStyle();
    const finish = async () => {
      saPtrHide();
      await bmSelfAdjustCommit(c, changes);
      const p = id && _pending[id];
      if (p) p.done = true;
      bmSelfAdjustShowResult(c, changes, id);
    };
    try {
      if (typeof showCharProfile !== 'function' || typeof closeModal !== 'function') return finish();

      /* 玩家在「主动 → 显示角色修改过程」里关掉了：不演，直接改完给结果卡。 */
      let showProcess = true;
      try {
        showProcess = (typeof window.saShowProcessOn === 'function')
          ? window.saShowProcessOn()
          : (localStorage.getItem('sa_show_process') !== '0');
      } catch (e) {}
      if (!showProcess) {
        /* 不演也要回到单聊：结果卡是聊天里的一条消息，人得在聊天页才看得见 */
        await saWait(360);
        await saBackToChat(c);
        return finish();
      }

      /* ① 在单聊顶栏「点」一下，再进 TA 的主页 */
      const head = document.getElementById('chat-header');
      if (head) {
        saScrollIn(head);
        await saTap(head, SA_PACE.move);
        await saWait(SA_PACE.page);
      }
      await showCharProfile(c.id);
      await saWait(SA_PACE.page);

      /* ② 主页里滚到「聊天设置」，光标移过去再点 */
      const entry = document.querySelector('#btn-char-chatset');
      if (entry) {
        const rowBox = entry.closest('.cp-func, .list-item, .field') || entry.parentElement;
        await saScrollTo(entry, 520);
        await saWait(260);
        if (rowBox) rowBox.classList.add('bm-sa-hit');
        await saWait(SA_PACE.look);
        await saTap(entry, SA_PACE.move, () => { entry.click(); });
        await saWait(SA_PACE.page);
        if (rowBox) rowBox.classList.remove('bm-sa-hit');
      } else if (typeof showCharChatSettingsModal === 'function') {
        await showCharChatSettingsModal(c);
        await saWait(SA_PACE.page);
      }

      /* ③ 逐项改：切 tab → 滚到那一行 → 高亮 → 光标点到控件 → 慢慢滑值 */
      let tabNow = null;
      let skipped = 0;
      for (let i = 0; i < changes.length; i++) {
        const ch = changes[i];
        const f = SA_BY_KEY[ch.key];
        if (!f) continue;

        /* —— 切页 ——
           先把弹窗滚回顶部，tab 栏才在视野里（否则玩家只看到内容突然换了，
           根本不知道切到了哪个分类）；点完再核对面板，没切过去就强制切，
           免得后面的行都在隐藏面板里、光标指到屏幕外。 */
        const curPanel = saActivePanel();
        const curName = curPanel ? curPanel.dataset.csPanel : null;
        if (f.panel && (f.panel !== tabNow || curName !== f.panel)) {
          saPtrHide();
          await saScrollTop(SA_PACE.scroll);
          await saWait(260);
          const tb = saModalRoot() && saModalRoot().querySelector('.cs-tab[data-cs-tab="' + f.panel + '"]');
          if (tb) {
            await saTap(tb, SA_PACE.move, () => { tb.click(); });
            tabNow = f.panel;
            await saWait(SA_PACE.tab);
          } else {
            saActivatePanel(f.panel);
            tabNow = f.panel;
            await saWait(SA_PACE.tab);
          }
          const nowPanel = saActivePanel();
          if (!nowPanel || nowPanel.dataset.csPanel !== f.panel) saActivatePanel(f.panel);
          await saWait(280);
        }

        const spot = saSpot(ch.key, f);
        if (!spot) { skipped++; continue; }
        /* 滚到这一行「停稳」再高亮、再动光标——顺序不能反 */
        await saScrollTo(spot.row, SA_PACE.scroll);
        await saWait(200);
        spot.row.classList.add('bm-sa-hit');
        await saWait(SA_PACE.look);

        if (f.type === 'switch') {
          await saTap(spot.cb || spot.row, SA_PACE.move, () => {
            if (!spot.cb) return;
            if (!!spot.cb.checked !== !!ch.to) spot.cb.click();
            else {
              spot.cb.checked = !!ch.to;
              spot.cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
          await saWait(SA_PACE.rest);
        } else {
          /* 光标先停在数字框上，玩家看得见 TA 点的是哪一格，再滑值 */
          await saTap(spot.num || spot.row, SA_PACE.move);
          const from = parseFloat(spot.num ? spot.num.value : ch.from);
          await saTween(spot, isNaN(from) ? Number(ch.from) || 0 : from, Number(ch.to) || 0, SA_PACE.val);
          await saWait(SA_PACE.rest);
        }
        spot.row.classList.remove('bm-sa-hit');
        await saWait(300);
      }

      /* ④ 点「保存」 */
      const save = document.getElementById('cs-save');
      if (save) {
        await saScrollTo(save, 560);
        await saWait(260);
        await saTap(save, SA_PACE.move, () => { save.click(); });
        await saWait(900);
      }
      /* 收尾：关掉设置（会弹回主页）→ 关掉主页 → 回到 TA 的单聊页，
         让「改好了」这张卡就出现在玩家眼前的聊天里 */
      await saBackToChat(c);
    } catch (e) {
      /* 出错也要把弹窗收干净、回到单聊，别把人丢在主页或空白弹窗里 */
      try { await saBackToChat(c); } catch (_) {}
    }
    await finish();
  }

  /* ---------- 同意窗（跟随主题） ---------- */
  function bmSelfAdjustConfirm(c, changes, id) {
    bmSelfAdjustStyle();
    const mask = document.createElement('div');
    mask.className = 'bm-sa-mask';
    const card = document.createElement('div');
    card.className = 'bm-sa-card';
    card.addEventListener('click', (e) => e.stopPropagation());
    const panelList = [...new Set(changes.map((x) => x.panel))].filter(Boolean);
    const shown = panelList.slice(0, 4).join(' / ') + (panelList.length > 4 ? ' 等' : '');
    let nRows = changes.length;
    try { nRows = saRowCount(changes, getCharChatSettings(c)); } catch (e) {}
    /* 版式照预览页：标题居中 → 「一共 N 处，涉及 M 个面板」→ 面板名两行 → 两颗大按钮 */
    card.innerHTML =
      '<div class="bm-sa-ask">' +
        '<div class="bm-sa-title">TA 想动一动你的设置</div>' +
        '<div class="bm-sa-meta">一共 <b>' + nRows + '</b> 处，涉及 <b>' + panelList.length + '</b> 个面板</div>' +
        '<div class="bm-sa-panels">' + shown + '<br>你点了同意，TA 才会去改。</div>' +
      '</div>' +
      '<div class="bm-sa-row"><button class="no">拒绝</button><button class="pri yes">同意</button></div>';
    mask.appendChild(card);
    document.body.appendChild(mask);
    requestAnimationFrame(() => { mask.classList.add('on'); card.classList.add('on'); });

    const close = () => {
      mask.classList.remove('on'); card.classList.remove('on');
      setTimeout(() => { mask.remove(); card.remove(); }, 320);
    };
    mask.addEventListener('click', close);
    card.querySelector('.no').addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      // 拒绝不写任何冷却：TA 以后可能还会再提
      if (typeof miniToast === 'function') miniToast('你拒绝了，TA 以后可能还会再提');
    });
    card.querySelector('.yes').addEventListener('click', async (e) => {
      e.stopPropagation();
      close();
      await saWait(280);
      await bmSelfAdjustPlay(c, changes, id);
    });
  }

  /* ---------- 完成卡：作为一条消息投进聊天流 ---------- */
  function bmSelfAdjustShowResult(c, changes, id) {
    bmSelfAdjustStyle();
    let nRows = changes.length;
    try { nRows = saRowCount(changes, getCharChatSettings(c)); } catch (e) {}
    bmSelfAdjustCardDeliver(c, { n: nRows, id: id || '', done: true });
  }

  /* ---------- 开发者命令入口：直接让 TA 发一张修改申请 ----------
     走的是和「隐藏卡抽中」一模一样的后续（申请卡 → 同意 → 演出 → 完成卡），
     区别只是这里不看概率、不占用一次回复。 */
  async function bmSelfAdjustDev(c) {
    if (!c) { if (typeof miniToast === 'function') miniToast('开发者模式：找不到指定访客'); return; }
    if (typeof getCharChatSettings !== 'function') return;
    const cs = getCharChatSettings(c);
    const changes = saPick(cs, 0, 4);
    if (!changes.length) { if (typeof miniToast === 'function') miniToast('这次没抽到能改的项'); return; }
    const n = saRowCount(changes, cs);
    const id = saNewId();
    saRemember(id, c, changes, n);

    /* 20261116：开发者命令也照玩家的规矩 —— 不发开场话，直接一张卡 */
    await bmSelfAdjustCardDeliver(c, { n: n, id: id, done: false });
    if (typeof miniToast === 'function') miniToast('开发者模式：' + (c.name || 'TA') + ' 发来修改申请（' + n + ' 处）');
  }

  /* ------------------------------------------------------------
   * 清单浮层
   * 勾选 = 选中（打标记，不动数值）；「撤回选中」只撤勾上的；
   * 「全部撤回」撤全部、与勾选无关；已撤回的行变成 ↺，点它单独恢复。
   * 这样「全部撤回」到底撤哪些，不再需要猜。
   * ------------------------------------------------------------ */
  function bmSelfAdjustList(c, changes) {
    bmSelfAdjustStyle();
    const mask = document.createElement('div');
    mask.className = 'bm-sa-mask';
    const card = document.createElement('div');
    card.className = 'bm-sa-card';
    card.addEventListener('click', (e) => e.stopPropagation());
    card.innerHTML =
      '<h4>都修改了哪些数值</h4>' +
      '<div class="bm-sa-list"></div>' +
      '<div class="bm-sa-bulk">' +
        '<label><input type="checkbox" class="allcb"><span>全选</span></label>' +
        '<span class="cnt"></span>' +
        '<button class="undoall">全部撤回</button>' +
      '</div>' +
      '<div class="bm-sa-row"><button class="sel" disabled>撤回选中</button><button class="pri ok">知道了</button></div>';
    mask.appendChild(card);
    document.body.appendChild(mask);
    requestAnimationFrame(() => { mask.classList.add('on'); card.classList.add('on'); });

    const listEl = card.querySelector('.bm-sa-list');
    const settings = getCharChatSettings(c);
    const picked = new Set();

    const rowsNow = () => {
      const rows = [];
      for (const g of SA.groupChanges(changes, settings)) for (const r of g.rows) rows.push(r);
      return rows;
    };

    const paint = () => {
      const groups = SA.groupChanges(changes, settings);
      const rows = [];
      groups.forEach((g) => g.rows.forEach((r) => rows.push(r)));
      [...picked].forEach((i) => { if (!rows[i] || rows[i].reverted) picked.delete(i); });

      listEl.innerHTML = '';
      let idx = 0;
      for (const g of groups) {
        const hd = document.createElement('div');
        hd.className = 'bm-sa-grp';
        hd.textContent = g.panel;
        listEl.appendChild(hd);

        for (const row of g.rows) {
          const i = idx++;
          const li = document.createElement('div');
          li.className = 'bm-sa-li' + (row.reverted ? ' rev' : '') + (picked.has(i) ? ' on' : '');
          li.innerHTML =
            '<span class="cb">' + (row.reverted ? '&#8634;' : '&#10003;') + '</span>' +
            '<div class="mn">' +
              '<div class="nm">' + row.name + (row.chased ? '<i>随动</i>' : '') + '</div>' +
              '<div class="vv"><s>' + row.from + '</s><i>&#8594;</i><em>' + row.to + '</em></div>' +
            '</div>';
          li.querySelector('.cb').addEventListener('click', async () => {
            if (row.reverted) {
              SA.toggleRow(settings, row);       // ↺ = 恢复这一项
              picked.delete(i);
              await bmSelfAdjustCommit(c, row.items);
            } else if (picked.has(i)) {
              picked.delete(i);
            } else {
              picked.add(i);
            }
            paint();
          });
          listEl.appendChild(li);
        }
      }

      const undoable = rows.filter((r) => !r.reverted).length;
      const allcb = card.querySelector('.allcb');
      allcb.checked = undoable > 0 && picked.size === undoable;
      allcb.indeterminate = picked.size > 0 && picked.size < undoable;
      allcb.disabled = undoable === 0;
      card.querySelector('.cnt').textContent = undoable === 0 ? '已全部撤回' : ('已选 ' + picked.size + ' / ' + undoable);
      const sel = card.querySelector('.sel');
      sel.textContent = picked.size ? '撤回选中 ' + picked.size + ' 项' : '撤回选中';
      sel.disabled = picked.size === 0;
      card.querySelector('.undoall').style.visibility = undoable ? 'visible' : 'hidden';
    };
    paint();

    const close = () => {
      mask.classList.remove('on'); card.classList.remove('on');
      setTimeout(() => { mask.remove(); card.remove(); }, 320);
    };
    mask.addEventListener('click', close);
    card.querySelector('.ok').addEventListener('click', (e) => { e.stopPropagation(); close(); });

    // 全选：把还没撤回的行一次勾上（再点「撤回选中」就是全部撤回）
    card.querySelector('.allcb').addEventListener('click', (e) => {
      e.stopPropagation();
      const rows = rowsNow();
      picked.clear();
      if (e.target.checked) rows.forEach((r, i) => { if (!r.reverted) picked.add(i); });
      paint();
    });

    // 撤回选中：只动勾上的那几项
    card.querySelector('.sel').addEventListener('click', async (e) => {
      e.stopPropagation();
      const rows = rowsNow();
      const hit = [];
      for (const i of [...picked]) {
        const r = rows[i];
        if (r && !r.reverted) { SA.toggleRow(settings, r); hit.push(...r.items); }
      }
      picked.clear();
      if (hit.length) await bmSelfAdjustCommit(c, hit);
      paint();
    });

    // 全部撤回：撤全部（与勾选无关）
    card.querySelector('.undoall').addEventListener('click', async (e) => {
      e.stopPropagation();
      saRevertAll(settings, changes);
      picked.clear();
      await bmSelfAdjustCommit(c, changes);
      paint();
    });
  }

  /* 暴露给 app.js */
  window.bmSelfAdjustMaybe = bmSelfAdjustMaybe;
  window.bmSelfAdjustFieldDoc = saFieldDoc;
  /* 20261114：接入主项目页面后新增的三个入口
     · bmSelfAdjustCardHtml：聊天流里那张申请卡 / 完成卡的 HTML（app.js 的 msgBodyHtml 用）
     · bmSelfAdjustOpenCard：点卡片 → 同意窗 / 清单
     · bmSelfAdjustDev   ：开发者命令，直接让 TA 发一张修改申请 */
  window.bmSelfAdjustCardHtml = bmSelfAdjustCardHtml;
  window.bmSelfAdjustOpenCard = bmSelfAdjustOpenCard;
  window.bmSelfAdjustDev = bmSelfAdjustDev;
  /* 排查用：真机上想知道「为什么这一项没演」时，可以在控制台
     bmSelfAdjustDebug.spot('seasonAiGapMax', {panel:'四季'}) 看找到的是哪个控件。 */
  window.bmSelfAdjustDebug = {
    spot: saSpot, rowOf: saRowOf, scrollTo: saScrollTo, scrollTop: saScrollTop,
    activePanel: saActivePanel, activatePanel: saActivatePanel, domIds: SA_DOM,
    style: bmSelfAdjustStyle, closeStack: saCloseStack, backToChat: saBackToChat
  };
})();
