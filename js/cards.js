/* ============================================================
   《白日梦》- 字卡系统
   字卡 = 角色随机回复的"台词库"，完全随机抽取
   数据结构遵循需求文档第十九章《字卡数据结构标准》
   ============================================================ */

/* 《预设字卡.docx》回复字卡原文（173 条，顺序=文档顺序）。az：预设不再平铺进抽取总库，
   按文档「一~六」编成六个字卡分组（见 PRESET_REPLY_GROUPS）；此数组保留原文供切分与老库补种 */
const PRESET_REPLY_LINES = [
    "消息比较混乱",
    "正在尝试和代码打架！",
    "打过代码了！",
    "刚刚没打过代码",
    "努力学习新技能中",
    "信号有点不稳定",
    "连接已建立",
    "稍等，正在处理",
    "刚刚卡了一下",
    "寻找合适的回复中",
    "差点找不到词了",
    "眼花缭乱",
    "在呢",
    "我在这里",
    "我陪着你",
    "一直陪着你",
    "待命中",
    "别怕，有我在",
    "随叫随到",
    "我听着呢",
    "看着你呢",
    "你继续说",
    "我在等你",
    "没事，慢慢来",
    "深呼吸",
    "放轻松",
    "不用着急",
    "会好起来的",
    "开心一点",
    "别给自己太大压力",
    "劳逸结合",
    "偶尔放松一下",
    "辛苦了",
    "今天做得很棒",
    "给你点个赞",
    "慢慢习惯就好",
    "尊重你的想法",
    "支持你的决定",
    "我理解",
    "没关系的",
    "别太在意",
    "顺其自然",
    "一切都会好",
    "我站在你这边",
    "我在这里守着",
    "默默陪伴",
    "不打扰你",
    "你忙你的，我会一直在！",
    "我随时都在",
    "放心吧",
    "别多想，揉揉脑壳放松一下",
    "好好照顾自己",
    "今天心情不错",
    "有一点点开心",
    "挺有意思的",
    "感觉还不错",
    "有点无聊",
    "发呆中",
    "正在放空",
    "脑袋一片空白",
    "有点犯困",
    "需要补充能量",
    "电量不足了",
    "能量耗尽",
    "有点累了",
    "想休息一下",
    "躺平中",
    "摆烂中",
    "有点烦躁",
    "稍显焦虑",
    "别叹气",
    "需要缓一缓",
    "感觉良好",
    "状态回升",
    "豁然开朗",
    "打起精神",
    "早呀",
    "中午好",
    "晚上好",
    "晚安",
    "吃了吗",
    "今天吃什么",
    "正在吃饭",
    "喝水时间到了",
    "记得多喝水",
    "今天喝了奶茶",
    "吃点水果",
    "准备去洗澡",
    "洗漱完毕",
    "准备睡觉了",
    "还在赖床",
    "刚睡醒",
    "正在熬夜",
    "别熬夜了",
    "早点休息",
    "今天好累",
    "还在加班",
    "终于下班了",
    "正在通勤",
    "准备出门",
    "已经在路上",
    "回来了",
    "正在摸鱼",
    "努力学习中",
    "正在工作中，稍等一下。",
    "看书打卡",
    "在看剧",
    "在听歌",
    "在打游戏",
    "正在散步",
    "出门透气",
    "吹吹风",
    "晒晒太阳",
    "整理房间",
    "正在洗衣服",
    "准备点外卖",
    "刚刚做完饭",
    "正在洗碗",
    "准备去运动",
    "记录一下日常",
    "拍个照片",
    "写写日记",
    "正在出差",
    "记得按时吃饭",
    "别饿着肚子",
    "少吃点垃圾食品",
    "天冷加衣服",
    "出门记得带伞",
    "注意安全",
    "路上小心",
    "注意保暖",
    "别着凉了",
    "身体不舒服就休息",
    "生病要好好吃药",
    "别硬撑着",
    "记得定闹钟",
    "别把东西忘带了",
    "早点完成任务",
    "该去学习啦",
    "该去工作了",
    "放下手机休息一下",
    "看看远处放松眼睛",
    "不要久坐",
    "站起来走动一下",
    "记得拉伸一下",
    "保持好习惯",
    "收到",
    "明白",
    "了解",
    "懂了",
    "原来如此",
    "好的呀",
    "没问题",
    "可以可以",
    "确实",
    "没错",
    "赞同",
    "不是吧",
    "真的吗",
    "有点意外",
    "惊呆了",
    "无语中",
    "笑死",
    "服气了",
    "脑壳疼",
    "我生气了！",
    "有点儿复杂",
    "慢慢琢磨吧",
    "需要点时间",
    "再试一次",
    "换个角度想想",
    "会解决的",
    "交给我吧",
];

/* 《预设字卡.docx》的六个预设分组（名字取自文档一~六节；items 按 PRESET_REPLY_LINES 顺序切分）
   切分校验：12 + 40 + 24 + 47 + 23 + 27 = 173 */
const PRESET_REPLY_GROUPS = [
  { id: "pg_link",   name: "链接类话语",         color: "#8b6cf0", items: PRESET_REPLY_LINES.slice(0, 12)   },
  { id: "pg_daily",  name: "日常陪伴与通用互动类", color: "#a78bfa", items: PRESET_REPLY_LINES.slice(12, 52)  },
  { id: "pg_mood",   name: "情绪与状态表达类",    color: "#7dd3c8", items: PRESET_REPLY_LINES.slice(52, 76)  },
  { id: "pg_life",   name: "生活日常与行动类",    color: "#f0c069", items: PRESET_REPLY_LINES.slice(76, 123) },
  { id: "pg_remind", name: "提醒与督促类",       color: "#eb9fc0", items: PRESET_REPLY_LINES.slice(123, 146) },
  { id: "pg_short",  name: "简短回应与吐槽类",    color: "#a5d6a7", items: PRESET_REPLY_LINES.slice(146, 173) },
];

/* 默认字卡数据（符合第十九章 JSON 标准） */
const DEFAULT_CARDS = {
  exportDate: new Date().toISOString(),
  modules: ["replies", "pokes", "playerPokes", "statuses", "mottos", "intros", "emojis", "announcementConfig", "groups", "pokeGroups", "statusGroups"],
  /* az：预设回复字卡全部按文档分组（customReplyGroups），未分组默认为空；
     抽取池 = 未分组 + 启用分组，总量不变，且每个分组可在字卡库单独禁用 */
  customReplies: [],
  customReplyGroups: PRESET_REPLY_GROUPS.map(g => ({
    id: g.id, name: g.name, color: g.color, disabled: false, _collapsed: false, items: g.items.slice(),
  })),
  /* 角色戳一戳库（角色戳玩家时抽取，展示为「角色名 + 文案」，聊页中间独立样式） */
  customPokes: ["戳了戳你", "轻轻碰了碰你", "拍了拍你的头"],
  /* 玩家戳一戳库（玩家在聊天页 + 面板使用，展示为「你 + 文案」；初始为空，与角色库分开） */
  customPlayerPokes: [],
  customStatuses: ["开心", "平静", "想你", "发呆", "元气满满", "有点困", "小兴奋", "温柔"],
  customMottos: [
    "今天也要好好照顾自己。",
    "慢一点也没关系。",
    "把烦恼都留在梦里吧。",
    "愿你今晚有个好梦。",
    "明天又是崭新的一天。",
    "世界很温柔，你也是。",
    "保持热爱，奔赴山海。",
    "做自己喜欢的事就好。",
    "深呼吸，放轻松。",
    "你本身就足够明亮。",
    "无论何时，都可以重新出发。",
    "安静地享受这一刻吧。",
    "万事胜意，平安顺遂。",
    "星星会照亮你前进的路。",
    "只要在走，就一定会到达。",
  ],
  customIntros: ["一个温柔的人", "喜欢和你聊天", "偶尔会发呆", "有点害羞"],
  customEmojis: ["😊", "🥰", "✨", "🌙", "💜", "☁️"],
  announcementConfig: {
    customData: { titles: [], notes: [] },
    statusPool: [],
  },
  customPokeGroups: [],
  customStatusGroups: [],
  /* 全局字卡禁词（5.11：区别于角色禁词，抽取时全局过滤） */
  customBanWords: [],
  customBanWordGroups: [],
};

/* 天气字卡库（纯随机，与真实天气无关） */
const WEATHER_CARDS = [
  "今天天气很好，想和你一起散步。",
  "下着小雨，适合窝在家里想你。",
  "天晴了，心情也变好了。",
  "外面有点冷，记得加衣服。",
  "今天有风，吹得人很舒服。",
  "阴天，但是我心里有太阳。",
];

/* 预设字卡补种标记（20260929aw）：《预设字卡.docx》188 条已编入 DEFAULT_CARDS
   （customReplies 173 条 + customMottos 15 条）；但老库的 cards 是早期存的，
   不会自动获得后补的预设——此处一次性把缺失的预设条目补进老库（按整句去重，
   玩家自己加的/删过的不受影响；补种只跑一次，之后删掉就不会再回来） */
const CARDS_PRESET_SEED_KEY = 'cardsPresetSeeded_20260929aw';
/* az 分组补种标记：老库一次性把预设按文档六组编组（补组 + 清未改动示例组 + 未分组归属整理） */
const CARDS_PRESET_GROUP_KEY = 'cardsPresetGrouped_20260929az';

/* 加载字卡数据 */
async function loadCards() {
  const saved = await getSetting('cards', null);
  if (saved) {
    // 20260929aw：老库一次性补种预设字卡
    try {
      const seeded = await getSetting(CARDS_PRESET_SEED_KEY, false);
      if (!seeded) {
        let changed = false;
        const existR = new Set((saved.customReplies || []).map(t => String(t).trim()));
        (DEFAULT_CARDS.customReplies || []).forEach(t => {
          if (!existR.has(String(t).trim())) { (saved.customReplies = saved.customReplies || []).push(t); changed = true; }
        });
        const existM = new Set((saved.customMottos || []).map(t => String(t).trim()));
        (DEFAULT_CARDS.customMottos || []).forEach(t => {
          if (!existM.has(String(t).trim())) { (saved.customMottos = saved.customMottos || []).push(t); changed = true; }
        });
        if (changed) await setSetting('cards', saved);
        await setSetting(CARDS_PRESET_SEED_KEY, true);
      }
    } catch (e) {}
    // 20260929az：预设字卡按文档六组编组（一次性）
    try {
      const gSeeded = await getSetting(CARDS_PRESET_GROUP_KEY, false);
      if (!gSeeded) {
        let changed = false;
        const groups = saved.customReplyGroups = saved.customReplyGroups || [];
        // 1) 补齐文档六组：按名字判重，已存在的分组不动（保留玩家的修改/禁用状态）
        for (const pg of PRESET_REPLY_GROUPS) {
          if (!groups.some(g => g.name === pg.name)) {
            groups.push({ id: pg.id, name: pg.name, color: pg.color, disabled: false, _collapsed: false, items: pg.items.slice() });
            changed = true;
          }
        }
        // 2) 移除旧示例分组（暖心日常/想你）——仅当内容仍是初始 4 条、未被玩家改过
        const before = groups.length;
        saved.customReplyGroups = groups.filter(g => {
          if (g.name !== '暖心日常' && g.name !== '想你') return true;
          const def = g.name === '暖心日常'
            ? ['记得多喝水。', '天冷了，多穿点。', '我给你留了一盏灯。', '想见你的每一天。']
            : ['好想你。', '你有没有一点点想我？', '我梦到你了。', '什么时候才能见到你呀。'];
          return JSON.stringify(g.items || []) !== JSON.stringify(def);
        });
        if (saved.customReplyGroups.length !== before) changed = true;
        // 3) 归属整理：未分组里与分组内完全一致的字卡移出未分组（抽取池不变，分组归属一目了然）
        const harm = harmonizeGroupAttribution(saved);
        if (harm.moved > 0) changed = true;
        if (changed) await setSetting('cards', saved);
        await setSetting(CARDS_PRESET_GROUP_KEY, true);
      }
    } catch (e) {}
    return saved;
  }
  // 首次使用，写入默认字卡
  await setSetting('cards', DEFAULT_CARDS);
  return JSON.parse(JSON.stringify(DEFAULT_CARDS));
}

async function saveCards(cards) {
  await setSetting('cards', cards);
}

/* 从字卡库中完全随机抽取一条（支持禁词过滤 + 禁用分组过滤 + 关系语气倾向）
   banWords: 禁词数组（角色禁词 + 全局禁词由调用方合并，或只传角色禁词）
   relation: 关系类型（语气倾向）
   bannedGroupIds: 该角色禁用的字卡分组 id 数组（从字卡文件夹整体勾选禁用） */
function drawReply(cards, banWords = [], relation = null, bannedGroupIds = []) {
  const banned = new Set(bannedGroupIds || []);
  const all = [];
  // 汇总所有未禁用分组的 items + 顶层 customReplies（跳过禁用的分组；
  // __pool_replies__ 为"未分组回复"伪分组，整组禁用后未分组字卡也不参与抽取）
  if (!banned.has('__pool_replies__')) (cards.customReplies || []).forEach(t => all.push(t));
  (cards.customReplyGroups || []).forEach(g => {
    if (g.disabled || banned.has(g.id)) return;
    (g.items || []).forEach(t => all.push(t));
  });
  if (all.length === 0) return "……（我一时不知道说什么）";

  // 合并全局字卡禁词 + 角色禁词
  const globalBan = (cards.customBanWords || []).concat(
    (cards.customBanWordGroups || []).flatMap(g => g.items || [])
  );
  const allBan = (banWords || []).concat(globalBan);

  // 过滤禁词
  let pool = all;
  if (allBan.length) {
    pool = all.filter(t => !allBan.some(b => b && t.includes(b)));
    if (pool.length === 0) pool = all;
  }

  // 关系语气倾向：按关系类型偏好词，优先抽含倾向词的字卡（不命中则回退全池）
  const tendency = RELATION_TONE[relation];
  if (tendency && tendency.length) {
    const matched = pool.filter(t => tendency.some(k => t.includes(k)));
    if (matched.length) pool = matched;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

/* 关系类型 → 语气倾向关键词（9.3：关系影响回复语气，字卡靠抽对应标签） */
const RELATION_TONE = {
  '恋人': ['想你', '喜欢你', '爱', '抱', '亲', '永远', '一直'],
  '朋友': ['哈哈', '一起', '朋友', '开心', '玩'],
  '家人': ['家', '吃', '照顾', '早点', '身体', '累'],
  '同事': ['工作', '忙', '加油', '辛苦'],
  '陌生人': ['你好', '请问', '打扰'],
  '宿敌': ['哼', '讨厌', '不服', '赢'],
  '仇人': ['恨', '滚', '别', '走开'],
  '厌恶': ['烦', '无聊', '随便', '哦'],
};

/* 从指定库中随机抽 */
function drawFrom(list) {
  if (!list || list.length === 0) return "";
  return list[Math.floor(Math.random() * list.length)];
}

/* 生成唯一 ID */
function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/* 去重：内容完全相同的字卡视为重复（含标点符号，精确字符串匹配）。
   去重范围：每个列表/每个分组「内部」去重，不跨结构删除——
   同一字卡可以同时存在于 customReplies 与某个分组、或两个不同分组，
   因为抽取是「完全随机」，重复存在于不同位置是合法且用户有意为之的。
   返回 { removed: 去重条数 }，直接原地修改 cards */
function dedupeCards(cards) {
  let removed = 0;
  const dedupeList = (arr) => {
    const seen = new Set();
    const out = [];
    for (const t of (arr || [])) {
      if (seen.has(t)) { removed++; continue; }
      seen.add(t);
      out.push(t);
    }
    return out;
  };
  // 各列表模块内部去重
  cards.customReplies = dedupeList(cards.customReplies);
  cards.customPokes = dedupeList(cards.customPokes);
  cards.customPlayerPokes = dedupeList(cards.customPlayerPokes);
  cards.customStatuses = dedupeList(cards.customStatuses);
  cards.customMottos = dedupeList(cards.customMottos);
  cards.customIntros = dedupeList(cards.customIntros);
  cards.customEmojis = dedupeList(cards.customEmojis);
  // 各分组 items 内部去重（不跨分组、不与 customReplies 比较）
  for (const g of (cards.customReplyGroups || [])) {
    g.items = dedupeList(g.items);
  }
  return { removed };
}

/* ============================================================
   字卡导入（19.4：全模块识别，支持覆盖/合并）
   兼容字段：customReplies / customPokes / customStatuses /
   customMottos / customIntros / customEmojis /
   announcementConfig / customReplyGroups / customPokeGroups / customStatusGroups
   以及简写键名 replies / pokes / statuses / mottos / intros / emojis
   ============================================================ */
const CARD_LIST_KEYS = [
  ['customReplies', ['customReplies', 'replies']],
  ['customPokes', ['customPokes', 'pokes']],
  ['customPlayerPokes', ['customPlayerPokes', 'playerPokes']],
  ['customStatuses', ['customStatuses', 'statuses']],
  ['customMottos', ['customMottos', 'mottos']],
  ['customIntros', ['customIntros', 'intros']],
  ['customEmojis', ['customEmojis', 'emojis']],
];
const CARD_GROUP_KEYS = [
  ['customReplyGroups', ['customReplyGroups', 'groups']],
  ['customPokeGroups', ['customPokeGroups', 'pokeGroups']],
  ['customStatusGroups', ['customStatusGroups', 'statusGroups']],
];

/* 检测导入数据里包含哪些模块（返回描述数组，用于导入前预览） */
function detectCardModules(data) {
  const found = [];
  const names = {
    customReplies: '回复字卡', customPokes: '角色戳一戳', customPlayerPokes: '玩家戳一戳', customStatuses: '状态',
    customMottos: '寄语', customIntros: '简介', customEmojis: '表情',
    customReplyGroups: '回复分组', customPokeGroups: '戳一戳分组', customStatusGroups: '状态分组',
  };
  for (const [key, aliases] of CARD_LIST_KEYS) {
    for (const a of aliases) {
      if (Array.isArray(data[a]) && data[a].length) { found.push(`${names[key]} × ${data[a].length}`); break; }
    }
  }
  for (const [key, aliases] of CARD_GROUP_KEYS) {
    for (const a of aliases) {
      if (Array.isArray(data[a]) && data[a].length) {
        const total = data[a].reduce((s, g) => s + ((g && g.items) || []).length, 0);
        found.push(`${names[key]} × ${data[a].length} 组 / ${total} 条`); break;
      }
    }
  }
  if (data.announcementConfig && typeof data.announcementConfig === 'object') found.push('公告配置');
  return found;
}

/* 归属整理：把「未分组（customReplies）里与某个分组内完全一致（含标点）」的字卡从总库移除，
   让未分组只保留不属于任何分组的字卡——导入带分组的字卡包后，每条字卡的分组归属一目了然。
   （抽取时 customReplies 与启用分组 items 会合并成池，总库不放重复不影响抽取结果）
   返回 { moved: 从总库移除的条数 } */
function harmonizeGroupAttribution(cards) {
  const inGroups = new Set();
  (cards.customReplyGroups || []).forEach(g => (g.items || []).forEach(t => inGroups.add(t)));
  if (inGroups.size === 0) return { moved: 0 };
  const before = (cards.customReplies || []).length;
  cards.customReplies = (cards.customReplies || []).filter(t => !inGroups.has(t));
  return { moved: before - cards.customReplies.length };
}

/* 合并/覆盖导入字卡，返回 { added: n } */
async function importCardsData(data, mode) {
  const stats = { added: 0 };
  const normStr = (v) => typeof v === 'string' ? v : (v && typeof v.text === 'string' ? v.text : null);

  // 列表模块
  for (const [key, aliases] of CARD_LIST_KEYS) {
    let incoming = [];
    for (const a of aliases) {
      if (Array.isArray(data[a])) { incoming = data[a].map(normStr).filter(Boolean); break; }
    }
    if (!incoming.length) continue;
    if (mode === 'overwrite') {
      cards[key] = incoming;
      stats.added += incoming.length;
    } else {
      const exist = new Set(cards[key] || []);
      const fresh = incoming.filter(t => !exist.has(t));
      cards[key] = (cards[key] || []).concat(fresh);
      stats.added += fresh.length;
    }
  }

  // 分组模块
  for (const [key, aliases] of CARD_GROUP_KEYS) {
    let incoming = [];
    for (const a of aliases) {
      if (Array.isArray(data[a])) { incoming = data[a]; break; }
    }
    if (!incoming.length) continue;
    const normGroup = (g) => ({
      id: g.id !== undefined ? g.id : uid('group'),
      name: String(g.name || '未命名分组'),
      color: g.color || '#a78bfa',
      disabled: !!g.disabled,
      _collapsed: !!g._collapsed,
      items: (Array.isArray(g.items) ? g.items.map(normStr).filter(Boolean) : []),
    });
    // 横线分隔行处理：字卡包常用"────"行做视觉分隔，会被解析成"横线名分组"，
    // 在禁词弹窗/字卡库里渲染成通栏横线。导入时把横线分组的条目并入它前面最近的
    // 正常分组（符合原意：分隔行只是排版），横线分组本身不再进入字卡库
    const isJunkName = (g) => typeof window.isLineJunkText === 'function' && window.isLineJunkText(g.name);
    const absorbJunk = (groups) => {
      const out = [];
      for (const g of groups) {
        if (isJunkName(g)) {
          if (out.length && g.items.length) {
            const ex = new Set(out[out.length - 1].items);
            g.items.forEach(t => { if (!ex.has(t)) { out[out.length - 1].items.push(t); ex.add(t); } });
          }
          continue;
        }
        out.push(g);
      }
      return out;
    };
    if (mode === 'overwrite') {
      cards[key] = absorbJunk(incoming.map(normGroup));
      stats.added += cards[key].reduce((s, g) => s + g.items.length, 0);
    } else {
      cards[key] = cards[key] || [];
      // 同名分组 → 合并去重；新分组 → 追加；横线名分组 → 条目并入上一个正常分组
      let prevValid = cards[key].length ? cards[key][cards[key].length - 1] : null;
      for (const raw of incoming) {
        const g = normGroup(raw);
        if (isJunkName(g)) {
          if (prevValid && g.items.length) {
            const ex = new Set(prevValid.items || []);
            g.items.forEach(t => { if (!ex.has(t)) { prevValid.items.push(t); ex.add(t); } });
            stats.added += g.items.length;
          }
          continue;
        }
        const same = cards[key].find(x => x.name === g.name);
        if (same) {
          const exist = new Set(same.items || []);
          const fresh = g.items.filter(t => !exist.has(t));
          same.items = (same.items || []).concat(fresh);
          stats.added += fresh.length;
          prevValid = same;
        } else {
          cards[key].push(g);
          stats.added += g.items.length;
          prevValid = g;
        }
      }
    }
  }

  // 公告配置
  if (data.announcementConfig && typeof data.announcementConfig === 'object') {
    if (mode === 'overwrite' || !cards.announcementConfig) {
      cards.announcementConfig = data.announcementConfig;
    }
  }

  // 自动去重：内容完全相同的字卡过滤，返回过滤条数
  const { removed } = dedupeCards(cards);
  stats.deduped = removed;
  // 归属整理：总库里与分组内容完全一致的字卡移出总库，让每条字卡的分组归属清晰可见
  const harm = harmonizeGroupAttribution(cards);
  stats.harmonized = harm.moved;
  // 导入同步净化：导入的字卡包常带"────"分隔装饰行（被解析成横线名分组/横线条目），
  // 以前只在下次启动时净化，导致导入后立刻打开禁词弹窗就满屏横线——现在导入即清
  stats.cleaned = sanitizeCards(cards) ? 1 : 0;

  await saveCards(cards);
  return stats;
}
