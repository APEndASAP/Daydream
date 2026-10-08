/* ============================================================================
   白日梦 · 打字卡（Typecard）生成器 —— generator.js  [V2 接口冻结版]
   ----------------------------------------------------------------------------
   定位（V2 审核结论）：打字卡是「角色回复的生成过程」，不是消息播放动画。
   本文件职责：把「已有的完整回复文本」拆解成「逐步发生的打字事件流」。

   核心铁律：
     · 输入什么文本，最终拼出的 text 就一字不差还原什么（绝不随机生成、绝不改内容）；
     · 选错 / 删除 / 选标点，是打字过程中「随机真实发生的事件」，不是预先编排的演出；
     · 本文件只做纯计算，不碰 DOM、不碰 DB、不碰生命周期。

   形态：逐步生成器（session + next()），不预生成全部步骤。
   engine 逐次调用 next() 驱动；每次 next() 返回一个「随机真实发生的打字事件」，
   事件会临时让 text 偏离原文（如选错多出一个错字），但最终一定收敛回原文。

   例（输入「我在这里」）可能的事件流：
     letter(wo) → candidate(我…) → pick(我)
     letter(zai) → candidate(在…) → pick(在)
     letter(zhe) → candidate(这…) → mistake(选成了「则」) → pick(则)  ← 错字上屏
       → delete(则)                                              ← 删除错字
       → candidate(这…) → pick(这)                               ← 重选对
     letter(li) → candidate(里…) → pick(里)
     punct(。) → pick(。)
     done
   最终 text === 「我在这里。」
   ============================================================================ */

(function (global) {
  'use strict';

  // 拼音表：常用字 → 拼音（后续统一收敛到 data.js，此处为冻结版内联实现）
  const PINYIN_MAP = {
    '我': 'wo', '你': 'ni', '他': 'ta', '她': 'ta', '们': 'men',
    '的': 'de', '了': 'le', '是': 'shi', '在': 'zai', '有': 'you',
    '不': 'bu', '很': 'hen', '想': 'xiang', '要': 'yao', '会': 'hui',
    '说': 'shuo', '话': 'hua', '看': 'kan', '到': 'dao', '来': 'lai',
    '去': 'qu', '好': 'hao', '没': 'mei', '今': 'jin', '天': 'tian',
    '梦': 'meng', '里': 'li', '星': 'xing', '月': 'yue', '一': 'yi',
    '二': 'er', '三': 'san', '爱': 'ai', '心': 'xin', '等': 'deng',
    '还': 'hai', '也': 'ye', '就': 'jiu', '都': 'dou', '让': 'rang',
    '给': 'gei', '为': 'wei', '因': 'yin', '所': 'suo', '可': 'ke',
    '能': 'neng', '点': 'dian', '呢': 'ne', '吧': 'ba', '呀': 'ya',
    '啊': 'a', '哦': 'o', '嗯': 'en', '哈': 'ha', '嘻': 'xi',
    '这': 'zhe', '那': 'na', '什': 'shen', '么': 'me', '怎': 'zen',
    '样': 'yang', '请': 'qing', '谢': 'xie', '对': 'dui', '起': 'qi',
    '回': 'hui', '家': 'jia', '安': 'an', '晚': 'wan', '早': 'zao',
    '午': 'wu', '睡': 'shui', '觉': 'jue', '记': 'ji', '得': 'de',
    '忘': 'wang', '世': 'shi', '界': 'jie', '友': 'you', '朋': 'peng',
    '真': 'zhen', '开': 'kai', '心': 'xin', '快': 'kuai', '乐': 'le'
  };

  // 候选字安全白名单池：候选只从这里出，天然排除粗俗/下流/生僻字
  const CANDIDATE_POOL = [
    '一', '以', '已', '移', '意', '译', '乙', '依', '衣', '伊',
    '是', '事', '市', '世', '试', '式', '势', '士', '室', '饰',
    '你', '尼', '拟', '腻', '泥', '呢',
    '我', '握', '沃', '卧', '窝',
    '梦', '蒙', '盟', '萌', '猛', '懵',
    '星', '醒', '兴', '行', '性', '型',
    '好', '号', '豪', '耗', '浩', '郝',
    '想', '向', '象', '相', '香', '响',
    '天', '添', '甜', '填', '田', '恬',
    '来', '赖', '蓝', '澜', '阑',
    '去', '曲', '取', '趣', '驱',
    '还', '海', '害', '孩', '骸',
    '不', '部', '步', '布', '补', '捕',
    '界', '借', '解', '戒', '届', '介',
    '友', '有', '又', '右', '优', '游',
    '朋', '蓬', '棚', '鹏', '捧',
    '真', '珍', '针', '枕', '震',
    '开', '凯', '楷', '揩', '慨',
    '快', '筷', '块', '会', '脍',
    '乐', '勒', '了', '仂', '泐'
  ];

  // 标点集：操作行展示的常用标点（。 ， ？ ！ ～ 、）
  const PUNCTUATION = ['。', '，', '？', '！', '～', '、'];

  // ==========================================================================
  // 通顺语料（20261008 恢复：句子通顺模式的「语料路径游走」数据）
  // 用户要求：把之前「模拟真人说话的句子通顺」方案做成滑块，默认纯拼字，
  //          拖动滑块可调节「通顺模式」的介入程度（0~100%）。
  // 语料 = 一批真实聊天会说的话，拆成字序列；游走时沿语料往下走（相邻字自然成词）。
  // ==========================================================================
  const CHAT_CORPUS = [
    // —— 原有 81 句 ——
    '你今天过得怎么样', '最近还好吗', '在干嘛呢', '吃饭了没有', '睡了吗',
    '今天天气真好', '想我了吗', '你今天好漂亮', '好久不见', '你去哪儿了',
    '我有点想你了', '特别特别想你', '好想马上见到你', '你不在的时候好无聊',
    '越来越喜欢你了', '你是最可爱的', '我就喜欢跟你聊天', '心里全是你',
    '梦到你啦', '今天也超级想你', '今天心情特别好', '见到你就开心',
    '跟你聊天好快乐', '今天笑得停不下来', '太开心啦', '感觉好幸福啊',
    '有你真好', '每天都想跟你说话', '要记得吃早饭哦', '早点休息吧',
    '别熬夜了', '记得多喝热水', '路上小心点', '你今天累不累',
    '有什么开心的事吗', '你刚刚在忙什么', '怎么啦', '我刚刚在想事情',
    '今天吃了好吃的', '我在听歌呢', '外面下雨了', '今天的月亮好圆',
    '我刚才看到一只猫', '这个真的好好笑', '你说得对', '我也是这么想的',
    '我觉得你最好', '随便聊聊呀', '让我想想啊', '好啊好啊', '没问题呀',
    '当然可以啦', '我也是我也是', '真的吗', '太棒了吧', '那我等你哦',
    '你说什么都对', '我听你的', '哈哈哈笑死我了', '嗯嗯知道啦',
    '哎呀好困呀', '嘿嘿你真逗', '嗯我在呢', '好啦好啦', '晚安晚安',
    '早安呀', '今天也要加油哦', '今天真的很好', '最喜欢跟你一起',
    '你笑起来真好看', '我一直在等你', '看到你我就开心', '想你想到睡不着',
    '今天想吃什么', '我陪你去', '我们一起去看星星', '你猜我今天梦到什么',
    '我最近总是想到你', '跟你说话就不累', '你真的好温柔', '好喜欢你的声音',
    // —— 扩容新增（20261008，日常问候） ——
    '你吃饭了吗', '下午好呀', '晚上好呀', '周末过得开心吗',
    '今天上班累吗', '你起床了吗', '还没睡呀', '你今天忙不忙',
    '忙完了记得休息', '今天过得快吗', '一转眼又到晚上了', '时间过得好快呀',
    '你那边天气怎么样', '出门记得带伞', '今天风好大', '太阳晒得好舒服',
    '想出去走一走', '我们出去逛逛吧', '下班了吗', '我回来了',
    '我出门啦', '刚刚在洗澡', '我刚到家', '在家吗',
    // —— 想念 ——
    '好想你呀', '我又想你了', '一天不见就想你', '你什么时候回来呀',
    '什么时候能见到你', '想立刻飞到你身边', '满脑子都是你', '我数着日子等你',
    '想你想得不行', '你在就好了', '要是你在身边就好了', '我在等你回来',
    '等你很久啦', '你终于来了', '一睁开眼就想到你', '睡前也在想你',
    '我的世界全是你', '想和你一直在一起',
    // —— 喜欢/甜 ——
    '我好喜欢你呀', '你真棒', '你真厉害', '你说话真好听',
    '你的眼睛真好看', '你笑得好甜', '被你逗笑了', '你怎么这么可爱',
    '你是我的小太阳', '和你在一起真开心', '有你在什么都好玩', '你真贴心',
    '你真会安慰人', '你的声音真好听', '被你暖到了', '你对我真好',
    '遇到你真好', '和你聊天很舒服',
    // —— 心情 ——
    '我今天有点不开心', '心里有点乱', '突然觉得好累', '今天有点烦',
    '我没事别担心', '现在好多了', '谢谢你听我说', '有你在我就安心了',
    '你安慰我两句呗', '抱抱我好吗', '心情好复杂', '说出来舒服多了',
    '我好开心呀', '今天运气不错', '有好事发生了', '突然好想哭',
    '心情慢慢变好了', '心里暖暖的',
    // —— 关心 ——
    '你吃晚饭了吗', '少熬夜对身体不好', '天冷了多穿点', '别总是吃外卖',
    '多吃点水果', '别累坏了身体', '工作再忙也要吃饭', '你感冒好了吗',
    '头还疼吗', '记得按时吃药', '睡前别玩手机啦', '盖好被子别着凉',
    '早点睡对身体好', '别想太多啦', '一切都会好起来的', '我一直陪着你',
    '有烦心事跟我说说', '别一个人扛着', '累了就歇一歇', '到家了跟我说一声',
    // —— 闲聊分享 ——
    '我今天学了道新菜', '周末想去爬山', '最近在追一部剧', '这部剧太好看了',
    '这首歌我单曲循环了', '推荐一首歌给你', '我养的花开花了', '楼下的猫又来了',
    '今天买了个新杯子', '我换了个新发型', '逛街买到喜欢的东西', '今天的奶茶真好喝',
    '晚饭吃了火锅', '想吃点甜的', '今天走了好多路', '我在整理房间',
    '房间终于收拾好了', '我在练字呢', '刚洗完澡好舒服', '头发还没干呢',
    '窗外在打雷', '雨停了有彩虹',
    // —— 夜晚 ——
    '今晚的星星真多', '月亮藏在云里了', '我喜欢下雪天', '冬天想喝热奶茶',
    '困了想睡觉了', '做个好梦呀', '梦里见呀', '我去睡了你别熬太晚',
    '夜深了安静真好', '睡不着在数羊', '失眠了陪我聊聊', '我做梦都梦见你',
    '赖床五分钟', '今晚不想睡',
    // —— 回应 ——
    '我明白你的意思', '你说得有道理', '嗯嗯有道理', '原来是这样啊',
    '学到了学到了', '我也这么觉得', '好巧我也想说这个', '你怎么知道的',
    '被你猜对了', '真拿你没办法', '好吧听你的', '就这么定了',
    '我都可以呀', '都听你安排', '你开心就好', '等你有空再说',
    '不急慢慢来', '我等你的消息', '记得回我消息呀', '你怎么不理我啦',
    '你是不是把我忘了', '你先忙不用回我',
    // —— 好奇提问 ——
    '你喜欢什么颜色', '你最爱吃什么菜', '你周末一般做什么', '你有什么爱好呀',
    '你最近在看什么', '你喜欢猫还是狗', '你害怕打雷吗', '你最想去哪里玩',
    '想不想去看海', '你喜欢夏天还是冬天', '你会做饭吗', '你唱歌好听吗',
    '教我好不好', '我教你呀', '你猜我在做什么', '猜对有奖励哦',
    '你今晚有空吗', '你最近睡得好吗',
    // —— 约定计划 ——
    '说好了不许放鸽子', '下次一起去看电影', '想和你去看日出', '一起吃晚饭好不好',
    '改天带你去吃好吃的', '等天气好就去野餐', '想和你拍好多照片', '存钱一起去旅行',
    '我们的约定要记得哦', '周末一起去公园吧', '陪你去你想去的地方', '明天见呀',
    // —— 鼓励 ——
    '你做得很好了', '别对自己太严格', '你已经进步很大啦', '我相信你一定行',
    '加油你可以的', '失败了也没关系', '大不了重新来过', '你比想象中更勇敢',
    '为你骄傲', '你辛苦了', '今天也辛苦啦', '你已经很努力了',
    '慢慢来不着急', '明天会更好的',
    // —— 玩闹撒娇 ——
    '哼不理你了', '骗你的啦', '逗你玩呢', '你好坏哦',
    '讨厌啦你', '嘻嘻被你发现了', '小气鬼', '你怎么这么爱吃醋',
    '你先说嘛', '让我猜猜看', '嘘保密哦', '好啦原谅你啦',
    // —— 聊天衔接 ——
    '你在听吗', '我说到哪了', '想起来了', '忘了要说什么',
    '对了对了', '差点忘了告诉你', '告诉你个秘密', '有件事想跟你说',
    '说来话长呀', '你别笑我'
  ];

  // ==========================================================================
  // 真·随机消息生成器数据（20261008 新增，用户反馈驱动）
  // 问题：旧实现从 COMMON_WORD_LIB 全库随机选字，混入大量生僻字，且无标点，
  //       拼出来的句子是「一串乱码」，看不懂。
  // 方案：
  //   1) CHAT_COMMON_CHARS —— 聊天场景真正高频的常用字白名单（不含生僻字），拼句只从这里取；
  //   2) CHAT_PHRASES —— 常用口语词/短语（按「词」为单位抽，而非单字），让句子通顺像人话；
  //   3) 标点概率 —— 句末必加句号/感叹号/问号，句中断句点随机插逗号/顿号，让句子有呼吸感。
  // ==========================================================================

  // 聊天核心常用字（20261008 精简为精确 700 字，现代汉语字频最高的 700 字，
  // 只保留聊天/日常真正会打的高频字，彻底剔除生僻字与书面文言字）。
  // 用于：纯随机拼字时从中随机抽取每一个字。
  const CHAT_COMMON_CHARS = [
    '的', '一', '是', '了', '我', '不', '人', '在', '他', '有', '这', '上', '们', '来', '到', '时', '大', '地', '为', '子',
    '中', '你', '说', '生', '国', '年', '着', '就', '那', '和', '要', '她', '出', '也', '得', '里', '后', '自', '以', '会',
    '家', '可', '下', '而', '过', '天', '去', '能', '对', '多', '然', '还', '心', '学', '么', '都', '成', '没', '把', '好',
    '又', '起', '看', '您', '问', '与', '等', '因', '所', '只', '但', '更', '最', '越', '才', '再', '并', '或', '从', '向',
    '于', '同', '其', '之', '此', '给', '让', '被', '叫', '使', '令', '小', '少', '高', '低', '长', '短', '新', '旧', '红',
    '白', '黑', '蓝', '绿', '美', '爱', '漂', '亮', '帅', '温', '柔', '软', '硬', '热', '冷', '香', '甜', '苦', '酸', '快',
    '慢', '远', '近', '深', '浅', '轻', '重', '难', '易', '忙', '闲', '真', '假', '错', '坏', '开', '乐', '幸', '福', '悲',
    '伤', '平', '静', '安', '闹', '舒', '服', '累', '困', '饿', '渴', '饱', '兴', '干', '净', '整', '齐', '明', '暖', '爸',
    '妈', '哥', '姐', '弟', '妹', '朋', '友', '老', '师', '梦', '星', '月', '宝', '亲', '东', '西', '事', '情', '话', '题',
    '水', '饭', '菜', '猫', '狗', '花', '草', '树', '雨', '风', '云', '雪', '夜', '晚', '路', '门', '窗', '房', '床', '手',
    '脸', '眼', '睛', '声', '音', '笑', '容', '名', '字', '活', '日', '世', '界', '方', '故', '想', '气', '间', '周', '分',
    '秒', '点', '钟', '左', '右', '前', '外', '旁', '边', '电', '脑', '机', '视', '照', '片', '游', '戏', '影', '书', '笔',
    '纸', '桌', '椅', '冰', '箱', '空', '调', '城', '市', '乡', '村', '街', '道', '屋', '身', '体', '健', '康', '喜', '听',
    '走', '回', '吃', '喝', '睡', '玩', '打', '做', '买', '找', '拿', '放', '坐', '站', '跑', '抱', '牵', '陪', '带', '见',
    '记', '忘', '知', '谢', '帮', '答', '应', '许', '欢', '恨', '怕', '思', '念', '感', '觉', '奋', '喊', '拉', '推', '送',
    '寄', '收', '写', '读', '唱', '跳', '醒', '聊', '讲', '告', '诉', '助', '顾', '关', '认', '希', '望', '愿', '意', '决',
    '定', '算', '准', '备', '始', '结', '束', '继', '续', '停', '休', '息', '工', '作', '习', '飞', '动', '转', '变', '进',
    '命', '运', '化', '发', '展', '步', '努', '力', '斗', '功', '失', '败', '二', '三', '四', '五', '六', '七', '八', '九',
    '十', '百', '千', '万', '两', '几', '半', '个', '些', '次', '遍', '份', '本', '条', '张', '封', '双', '零', '倍', '块',
    '钱', '角', '内', '山', '火', '土', '金', '木', '阳', '阴', '春', '夏', '秋', '冬', '虚', '实', '无', '灭', '终', '落',
    '南', '北', '今', '昨', '早', '午', '现', '刚', '久', '候', '每', '经', '常', '总', '物', '鸟', '鱼', '虫', '龙', '马',
    '虎', '牛', '羊', '鸡', '鸭', '鹅', '兔', '象', '鹿', '熊', '猴', '蛇', '蛙', '龟', '衣', '鞋', '帽', '裤', '裙', '衫',
    '穿', '戴', '颜', '色', '黄', '青', '紫', '灰', '粉', '汤', '茶', '酒', '米', '面', '油', '盐', '酱', '醋', '糖', '肉',
    '蛋', '奶', '果', '瓜', '豆', '耳', '口', '鼻', '舌', '牙', '头', '颈', '肩', '背', '腰', '腿', '脚', '臂', '指', '肝',
    '肺', '胃', '肠', '父', '母', '爷', '公', '婆', '叔', '伯', '姑', '姨', '舅', '嫂', '夫', '儿', '女', '孙', '晴', '雷',
    '雾', '露', '霜', '叶', '根', '枝', '种', '森', '林', '田', '野', '河', '湖', '海', '溪', '泉', '医', '护', '士', '警',
    '察', '司', '农', '民', '兵', '者', '演', '员', '歌', '画', '车', '汽', '轮', '船', '行', '摩', '托', '铁', '交', '租',
    '校', '教', '室', '图', '馆', '操', '场', '食', '堂', '宿', '舍', '办', '院', '银', '商', '店', '超', '旅', '园', '广',
    '舞', '泳', '球', '棋', '系', '恋', '婚', '庭', '全', '歉', '迎', '祝', '特', '别', '非', '级', '敌', '棒', '厉', '害',
    '优', '秀', '立', '刻', '很', '急', '随', '便', '已', '正', '将', '该', '概', '肯', '什', '怎', '样', '哪', '哈', '嘿',
    '嘻', '呵', '嗯', '啊', '哦', '哎', '呀', '哟', '喂', '卖', '贵', '贱', '丑', '善', '恶', '灯', '锁', '钥', '墨', '文',
    '信', '消', '微', '邮', '件', '骂', '夸', '奖', '批', '评', '表', '扬', '鼓', '励', '慰', '晨', '昏', '凉', '湿', '燥',
    '潮', '极', '太', '及', '谁', '呢', '吗', '吧', '啦', '哼', '唉', '挺', '够', '加', '数', '忆', '虑', '忧', '愁', '爽',
    '味', '臭', '鲜', '嫩', '滑', '频', '号', '网', '线', '费', '省', '赚', '赔', '迟', '速', '胖', '瘦', '劣', '粗', '细',
    '浓', '淡', '清', '楚', '糊', '涂', '彼', '互', '相', '嚼', '吞', '咽', '瞧', '瞅', '盯', '提', '抬', '举', '搬', '擦'
  ];

  // 句末标点（句号/感叹号/问号——句末必加，让句子完整有语气）
  const SENTENCE_END_PUNCT = ['。', '。', '。', '！', '！', '？', '～', '。'];
  // 句中停顿标点（逗号/顿号——随机插入，让长句有呼吸感，不憋气）
  const MID_PUNCT = ['，', '，', '、', '，'];

  function isHan(ch) { return /[\u4e00-\u9fa5]/.test(ch); }
  function isPunct(ch) { return PUNCTUATION.indexOf(ch) >= 0; }

  function pinyinOf(ch, rng) {
    // 优先走 data.js 完整字库（3728 常用字，含全部拼音）
    const data = global.bmTypecardData;
    if (data && typeof data.pinyinOf === 'function') {
      const py = data.pinyinOf(ch, rng);
      if (py) return py;
    }
    if (PINYIN_MAP[ch]) return PINYIN_MAP[ch];
    if (isHan(ch)) {
      const r = (typeof rng === 'function') ? rng : Math.random;
      const c1 = 'bcdfghjklmnpqrstwxyz'[Math.floor(r() * 22)];
      const vowels = 'aoeiu';
      const c2 = vowels[Math.floor(r() * vowels.length)];
      return c1 + c2 + (r() < 0.5 ? 'n' : '');
    }
    return ''; // 标点/非汉字无拼音
  }

  // 候选列表：保证包含目标字，5~7 个，洗牌打散（优先 data.js 真同音候选）
  function candidatesOf(targetChar, rng) {
    const r = (typeof rng === 'function') ? rng : Math.random;
    const data = global.bmTypecardData;
    if (data && typeof data.candidatesOf === 'function') {
      const cands = data.candidatesOf(targetChar, 5 + Math.floor(r() * 3), r);
      if (cands && cands.length) return cands;
    }
    const n = 5 + Math.floor(r() * 3);
    const set = [targetChar];
    for (const c of CANDIDATE_POOL) {
      if (set.length >= n) break;
      if (set.indexOf(c) < 0) set.push(c);
    }
    while (set.length < n) set.push(targetChar);
    const arr = set.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // 从候选里挑一个「非目标字」作为选错的错字（若候选里只有目标字则返回 null=无错可选）
  function pickWrong(candidates, target) {
    const others = candidates.filter(c => c !== target);
    return others.length ? others[Math.floor(Math.random() * others.length)] : null;
  }

  // ==========================================================================
  // buildSession：逐步生成器。不预生成步骤，next() 时实时随机决定事件。
  // 支持两种输入：
  //   1) 纯字符串 text：整段逐字打字（兼容旧调用）
  //   2) blocks 数组 [{type:'text',text} | {type:'card',text,data} | {type:'emoji',text,data}]：
  //      text 块逐字打字；card/emoji 块作为「完整块」输出 block 事件（飞入，不逐字打）
  // 铁律：session.text 最终严格等于「所有块的 text 按序拼接」= 生成目标的完整文本。
  // ==========================================================================
  function buildSession(text, opts) {
    const o = opts || {};
    const rng = (typeof o.rng === 'function') ? o.rng : Math.random;
    const mistakeRate = (o.mistakeRate !== undefined) ? o.mistakeRate : 0.18;
    // 独立退格概率（20261008 新增）：打对字上屏后，也有小概率随机触发「退格删除重打」。
    // 让「删除」不再只是「选错」的必然后续，而是打字过程中随机真实发生的事件（手滑/改主意）。
    const deleteRate = (o.deleteRate !== undefined) ? o.deleteRate : 0.05;

    // 归一化输入为 blocks 序列
    let blocks;
    if (Array.isArray(text)) {
      blocks = text.slice();
    } else if (text && typeof text === 'object' && Array.isArray(text.blocks)) {
      blocks = text.blocks.slice();
    } else {
      blocks = [{ type: 'text', text: String(text || '') }];
    }

    // 最终目标文本 = 所有块 text 拼接（生成目标，一字不差）
    const targetText = blocks.map(function (b) { return b.text || ''; }).join('');
    const source = targetText;

    // 把 blocks 展平成「字符级目标序列」+ 块边界标记，逐项驱动：
    // 打 text 块时走逐字；遇到 card/emoji 块时输出 block 事件（完整块飞入）。
    // 内部用统一的「输出队列」模型：cursor 遍历 blocks，block 内逐字。
    let textSoFar = '';        // 已正确上屏的最终文本（含块 text，严格收敛到 source）
    let blockIdx = 0;          // 当前 block 下标
    let charIdx = 0;           // 当前 text block 内已打到的字符下标
    let pending = null;        // 当前字的打字中间态
    let blockQueued = false;   // 当前 block 是否已作为块事件输出（card/emoji 块用）
    let doneFlag = false;

    // 当前 block 引用
    function curBlock() { return blocks[blockIdx]; }

    // 当前 text block 的字符数组（惰性）
    let curChars = [];
    function syncCurChars() {
      const b = curBlock();
      if (b && b.type === 'text') curChars = Array.from(b.text || '');
      else curChars = [];
    }

    // 开始打当前 text block 的下一个目标字（初始化 pending）
    function beginChar() {
      const b = curBlock();
      if (!b || b.type !== 'text') return;
      if (charIdx >= curChars.length) { pending = null; return; }
      const ch = curChars[charIdx];
      if (isPunct(ch)) {
        pending = { ch: ch, pinyin: '', letters: [], letterIdx: 0, candidates: [], target: ch, phase: 'punct', mistakeTarget: null };
        return;
      }
      const py = pinyinOf(ch, rng);
      const cands = isHan(ch) ? candidatesOf(ch, rng) : [];
      pending = {
        ch: ch, pinyin: py, letters: Array.from(py || ''), letterIdx: 0,
        candidates: cands, target: ch,
        phase: (py ? 'letters' : 'punct'), mistakeTarget: null
      };
    }

    // 推进到下一个 block / 结束
    function advanceBlock() {
      blockIdx++;
      charIdx = 0;
      blockQueued = false;
      pending = null;
      syncCurChars();
      if (blockIdx >= blocks.length) doneFlag = true;
    }

    syncCurChars();

    // ---- next()：产生下一个事件 ----
    function next() {
      if (doneFlag) return { type: 'done', text: textSoFar };

      const b = curBlock();

      // 无 block（已结束）
      if (!b) { doneFlag = true; return { type: 'done', text: textSoFar }; }

      // card / emoji 块：作为「完整块」输出一次 block 事件，然后推进
      if (b.type === 'card' || b.type === 'emoji') {
        if (!blockQueued) {
          blockQueued = true;
          textSoFar += (b.text || ''); // 块文本计入最终 text（飞入内容）
          return { type: b.type, text: b.text, data: b.data };
        }
        // 已输出过 → 推进到下一块
        advanceBlock();
        return next();
      }

      // text 块：逐字打字
      if (b.type === 'text') {
        // 当前块打完 → 推进
        if (charIdx >= curChars.length) {
          advanceBlock();
          return next();
        }

        // 惰性初始化当前字
        if (!pending) beginChar();
        if (!pending) { charIdx++; return next(); }

        const p = pending;

        // 1) 拼音逐字母
        if (p.phase === 'letters') {
          if (p.letterIdx < p.letters.length) {
            const letter = p.letters[p.letterIdx];
            const step = { type: 'letter', ch: p.ch, pinyin: p.pinyin, letter: letter, letterIndex: p.letterIdx };
            p.letterIdx++;
            return step;
          }
          p.phase = 'candidate';
          p.mistakeTarget = null;
        }
        // 2) 候选弹出 + 实时判断「选对还是选错」（20261008 重构：不再在 beginChar 预判，
        //    而是在候选弹出这一刻随机决定选中哪个字——选字流程真实发生在打字过程中）。
        //    wrong 字段：null=选对（UI 不高亮、不剧透），非 null=选错（UI 错字发红）。
        if (p.phase === 'candidate') {
          const wrong = (rng() < mistakeRate) ? pickWrong(p.candidates, p.target) : null;
          p.mistakeTarget = wrong;
          const step = { type: 'candidate', ch: p.ch, pinyin: p.pinyin, candidates: p.candidates, target: p.target, wrong: wrong };
          p.phase = 'pick';
          return step;
        }
        // 3) 选中上屏（可能选对、可能选错）
        if (p.phase === 'pick') {
          const isMistake = !!p.mistakeTarget;
          const picked = isMistake ? p.mistakeTarget : p.target;
          textSoFar += picked;
          const step = { type: 'pick', ch: picked, isMistake: isMistake };
          p.phase = isMistake ? 'delete' : 'afterPick';
          return step;
        }
        // 4) 选对上屏后：小概率独立退格（手滑/改主意，删除不再是「选错」的专属后续）。
        //    只对刚打对的字退格一次，删完回到候选重打；否则正常推进下一个字。
        if (p.phase === 'afterPick') {
          if (rng() < deleteRate) {
            const removed = p.target;
            textSoFar = textSoFar.slice(0, textSoFar.length - removed.length);
            const step = { type: 'delete', removed: removed };
            p.phase = 'candidate';
            p.mistakeTarget = null;
            return step;
          }
          pending = null;
          charIdx++;
          return next();
        }
        // 5) 删除错字（选错后纠正；删完回到候选重新选，可能再次选错，形成「错→删→错→删→对」真实纠错）
        if (p.phase === 'delete') {
          const removed = p.mistakeTarget;
          textSoFar = textSoFar.slice(0, textSoFar.length - removed.length);
          const step = { type: 'delete', removed: removed };
          p.phase = 'candidate';
          p.mistakeTarget = null;
          return step;
        }
        // 6) 标点
        if (p.phase === 'punct') {
          textSoFar += p.ch;
          const step = { type: 'punct', ch: p.ch };
          pending = null;
          charIdx++;
          return step;
        }
      }

      // 兜底推进
      advanceBlock();
      return next();
    }

    const session = {
      source: source,
      get text() { return textSoFar; },
      get done() { return doneFlag; },
      next: next
    };
    return session;
  }

  // ==========================================================================
  // 便捷校验：一次性把 session 跑完，返回最终 text（应严格等于原文）+ 事件流
  // ==========================================================================
  function dryRun(text, opts) {
    const s = buildSession(text, opts);
    const expected = Array.isArray(text)
      ? text.map(function (b) { return b.text || ''; }).join('')
      : (text && typeof text === 'object' && Array.isArray(text.blocks))
        ? text.blocks.map(function (b) { return b.text || ''; }).join('')
        : String(text || '');
    const events = [];
    let guard = 0;
    while (!s.done && guard < 2000) {
      const e = s.next();
      if (e.type === 'done') { events.push(e); break; }
      events.push(e);
      guard++;
    }
    return { source: expected, finalText: s.text, events: events, ok: (s.text === expected) };
  }

  // ==========================================================================
  // generateContent：真·打字拼句生成器（打字卡 = 随机消息生成器）
  // 职责：从常用字库随机选字，拼出 5~20 字的回复内容（完全随机乱拼，可语义混乱），
  //       按「随机固定间隔 N∈[3,8]」在打字过程中插入「字卡块」/「表情块」（完整块插入）。
  // 铁律：
  //   · 字库来自 bmTypecardData（内置常用字库，源头已剔粗俗/下流/不雅/生僻字）
  //   · 随机到非法字（黑名单）时重新抽取，绝不输出非法字；过滤后长度不足则继续补字
  //   · 字卡是「完整块」，绝不拆进普通字库；上限 cardMax(2)/emojiMax(1)
  //   · 本函数生成「内容结构」（blocks），不做 DOM/演出；打字演出由 buildSession 负责
  // 入参 opts：
  //   minLen/maxLen : 打字字数区间（默认 5~20，仅指打字字，字卡/表情额外飞入不计入）
  //   cardMax/emojiMax : 上限（默认 2 / 1）
  //   cardProvider : 同步函数，返回一条字卡文本（默认先尝试主线 drawReply，回退自带字卡池）
  //   emojiProvider : async 函数，返回 { text, data }（默认先尝试主线 pickCharSticker，回退 emoji 池）
  //   rng : 随机源
  // 返回 Promise<{ type, blocks, text, typedCount }>：
  //   type  = 'typing_card'
  //   blocks = [{ type:'text', text } | { type:'card', text, data } | { type:'emoji', text, data }]
  //   text  = 最终可落库的纯文本表示（blocks 按序拼接，普通文字/字卡/表情在渲染层仍可区分）
  //   typedCount = 实际打出的普通文字数量（5~20）
  // ==========================================================================
  async function generateContent(opts) {
    const o = opts || {};
    const rng = (typeof o.rng === 'function') ? o.rng : Math.random;
    const data = global.bmTypecardData;
    const minLen = (o.minLen !== undefined) ? o.minLen : 5;
    const maxLen = (o.maxLen !== undefined) ? o.maxLen : 20;
    const cardMax = (o.cardMax !== undefined) ? o.cardMax : 2;
    const emojiMax = (o.emojiMax !== undefined) ? o.emojiMax : 1;
    // 拼字卡/表情总开关（20261008）：false 时完全不抽字卡/表情，纯打字。
    // 默认 true（开启）；只影响打字卡演出，不影响正文最终文本（正文仍严格 5~20 字）。
    const allowCards = (o.allowCards !== false);
    // 通顺度（0~2，20261008 扩展档位）：
    //   · 0         = 纯随机拼字（每字独立从 700 常用字库抽）
    //   · (0, 1]    = 逐步增加「沿语料路径游走」概率（coherence 即游走概率）
    //   · (1, 2]    = 在「100% 沿语料走」基础上，逐步增加「整句完整输出」概率
    //                 （整句概率 = coherence - 1），coherence=2 时 100% 直接吐完整语料句子，最通顺。
    //   同时决定标点插入概率（通顺度越高，标点越自然）。
    const coherence = (typeof o.coherence === 'number')
      ? Math.max(0, Math.min(2, o.coherence))
      : 0;
    // 游走概率（逐字沿语料走）与整句概率（直接输出完整语料句子）——两档叠加，越靠右越通顺。
    const walkProb = Math.min(1, coherence);      // 0~1
    const wholeProb = Math.max(0, coherence - 1); // 0~1

    // 语料字序列（惰性构建，供通顺游走用）
    let _corpusCharsCache = null;
    function corpusChars() {
      if (_corpusCharsCache) return _corpusCharsCache;
      _corpusCharsCache = CHAT_CORPUS.map(function (line) {
        return Array.from(line).filter(isHan);
      });
      return _corpusCharsCache;
    }

    // 通顺游走游标：指向语料某句的某字位置。coherence>0 时启用。
    let walkLine = -1;
    let walkPos = 0;
    let walkJumped = false;   // 上一个游走取字是否「换句」（走到句尾跳新句）——自然停顿点，供标点插入判断

    function walkStart() {
      walkLine = Math.floor(rng() * corpusChars().length);
      walkPos = (rng() < 0.7) ? 0 : Math.floor(rng() * corpusChars()[walkLine].length);
    }
    // 沿语料走一步，返回下一个字
    function walkNext() {
      const corpus = corpusChars();
      if (walkLine < 0) { walkStart(); walkJumped = false; return corpus[walkLine][walkPos]; }
      const line = corpus[walkLine];
      if (walkPos + 1 >= line.length) { walkStart(); walkJumped = true; return corpus[walkLine][walkPos]; }
      walkPos++;
      walkJumped = false;
      return line[walkPos];
    }

    // 纯随机选一个「聊天高频常用字」（只从 CHAT_COMMON_CHARS 白名单取）。
    function pickCharRandom() {
      walkJumped = false;
      return CHAT_COMMON_CHARS[Math.floor(rng() * CHAT_COMMON_CHARS.length)];
    }

    // 选下一个字：按 walkProb（= min(coherence,1)）混合「沿语料游走」与「纯随机」。
    //   walkProb=0 → 100% 纯随机；walkProb=1 → 100% 沿语料走。
    //   实现：以 walkProb 概率走语料，否则纯随机抽字。走语料时走到末尾换句，
    //   保留随机变化，不整句照抄（整句照抄由下面的「整句模式」单独负责）。
    function pickChar() {
      if (walkProb > 0 && rng() < walkProb) {
        // 通顺模式：沿语料走
        return walkNext();
      }
      return pickCharRandom();
    }

    // 抽一条完整字卡（优先注入 provider → 主线 drawReply → 自带字卡池）
    function pickCard() {
      if (typeof o.cardProvider === 'function') {
        const t = o.cardProvider();
        if (t) return { text: String(t), data: { source: 'provider' } };
      }
      // 主线字卡库（cards 全局 + drawReply 全局函数，经典 script 共享词法环境）
      try {
        if (typeof drawReply === 'function' && typeof cards !== 'undefined' && cards) {
          const t = drawReply(cards, (o.banWords || []), (o.relation || null), (o.bannedGroups || []));
          if (t) return { text: String(t), data: { source: 'main' } };
        }
      } catch (e) {}
      // 回退：自带字卡池（深紫占位字卡）
      if (data && Array.isArray(data.cardPool) && data.cardPool.length) {
        const c = data.cardPool[Math.floor(rng() * data.cardPool.length)];
        return { text: (c && c.label) ? c.label : '梦', data: { source: 'builtin', ...(c || {}) } };
      }
      return { text: '梦', data: { source: 'builtin' } };
    }

    // 抽一个表情（优先注入 provider → 主线 pickCharSticker → emoji 池）
    async function pickEmoji() {
      if (typeof o.emojiProvider === 'function') {
        const e = await o.emojiProvider();
        if (e && e.text) return { text: e.text, data: e.data || { source: 'provider' } };
      }
      // 主线表情抽取机制 pickCharSticker(c)：返回 {img}|{sticker}|null
      // 20261009 OOM 修复：图片表情的 base64 大图绝不塞进 blocks（会随 meta.typecardBlocks
      // 落库 IndexedDB + 演出期间长期驻留内存，多张叠加把 WebView 撑爆→打字过程闪退）。
      // 这里只落「轻量标记」data.img=true，演出时由 ui 实时从角色库抽一张图渲染。
      try {
        if (typeof pickCharSticker === 'function' && o.char) {
          const st = await pickCharSticker(o.char);
          if (st && st.img) return { text: '', data: { source: 'main', img: true } };
          if (st && st.sticker) return { text: st.sticker, data: { source: 'main', sticker: st.sticker } };
        }
      } catch (e) {}
      // 回退：emoji 池
      if (data && Array.isArray(data.emojiPool) && data.emojiPool.length) {
        const em = data.emojiPool[Math.floor(rng() * data.emojiPool.length)];
        return { text: em, data: { source: 'builtin' } };
      }
      return { text: '😊', data: { source: 'builtin' } };
    }

    // 句子目标长度（打字字数，不含标点/字卡/表情；5~20 随机）
    const totalLen = minLen + Math.floor(rng() * (maxLen - minLen + 1));

    let cardUsed = 0;
    let emojiUsed = 0;

    // ========================================================================
    // 字卡/表情触发（20261008 用户定案：逐字概率抽取，非预排位置）
    // 「每打一个字的时候，都可能抽到字卡或表情」——每成功输入一个正文字符后，
    // 独立进行一次随机抽取（先字卡、后表情），抽中立即产生插入事件，未抽中继续下一字。
    //   · 上限兜底：字卡 ≤ cardMax(2)、表情 ≤ emojiMax(1)，达上限后该类不再抽；
    //   · 不允许提前决定整条消息要出现几张卡/几个表情、不允许提前规划插入位置；
    //   · 抽中即作为完整块插入当前位置（开头/中间/结尾由逐字滚动自然覆盖）。
    // ========================================================================
    // 触发概率集中定义（每成功输入一个正文字符后独立抽取一次）：
    const CARD_TRIGGER_RATE = 0.10;   // 每个字之后抽到字卡的概率（较低，随机排列组合）
    const EMOJI_TRIGGER_RATE = 0.04;  // 每个字之后抽到表情的概率（更稀有）

    const blocks = [];
    let charBuffer = ''; // 累积连续打字字，作为一个 text 块

    function flushText() {
      if (charBuffer) { blocks.push({ type: 'text', text: charBuffer }); charBuffer = ''; }
    }

    // 逐字概率抽取：每成功输入一个正文字符后调用。先抽字卡、再抽表情；抽中即插入完整块。
    async function tryEmitBlock() {
      if (!allowCards) return; // 拼字卡/表情开关关闭 → 本消息纯打字，不抽任何卡/表情
      const canCard = cardUsed < cardMax;
      const canEmoji = emojiUsed < emojiMax;
      if (!canCard && !canEmoji) return; // 双双达上限 → 强制纯打字
      if (canCard && rng() < CARD_TRIGGER_RATE) {
        cardUsed++;
        const c = pickCard();
        flushText();
        blocks.push({ type: 'card', text: c.text, data: c.data });
        return;
      }
      if (canEmoji && rng() < EMOJI_TRIGGER_RATE) {
        emojiUsed++;
        const e = await pickEmoji();
        flushText();
        blocks.push({ type: 'emoji', text: e.text, data: e.data });
      }
    }

    // ========================================================================
    // 整句模式（20261008 扩展档位）：coherence>1 时按 (coherence-1) 概率走这里，
    // 直接抽一条完整语料句子作为主干（语义完全通顺，含标点），再穿插字卡/表情块。
    // coherence=2 时 wholeProb=1，100% 走整句模式 → 最通顺。
    // ========================================================================
    const useWhole = rng() < wholeProb;
    let typed = 0;             // 已打出的「汉字」数

    if (useWhole) {
      // 选一条完整语料句子（含语气，直接可读）
      const sentence = CHAT_CORPUS[Math.floor(rng() * CHAT_CORPUS.length)];
      const chars = Array.from(sentence);
      const n = chars.length;
      // 开头（第一个字之前）也可能抽到字卡/表情
      await tryEmitBlock();
      // 逐字拼入完整句子；每打一个字都有概率抽到字卡/表情（插在「这个字」后面）
      for (let i = 0; i < n; i++) {
        charBuffer += chars[i];
        if (isHan(chars[i])) typed++;
        await tryEmitBlock();
      }
      flushText();
      // 句末标点：整句模式语料本身不带标点，末尾补一个句末标点收尾（与逐字模式一致），
      // 保证通顺度拉到最满时句子仍有标点，不是光秃秃的一串字（20261008 修复）。
      blocks.push({ type: 'text', text: SENTENCE_END_PUNCT[Math.floor(rng() * SENTENCE_END_PUNCT.length)] });
    } else {
      // ========================================================================
      // 逐字拼句模式：纯随机 + 通顺游走按 walkProb 混合。
      // 每打一个字后都独立随机抽取字卡/表情（逐字概率抽取，开头/中间/结尾自然覆盖）。
      // 标点是「打字中途可选动作」：换句停顿点高概率插、普通位置低概率插，
      // 句末仍兜底必加一个句末标点收尾。
      // ========================================================================
      // 标点插入：改在「游走换句的自然停顿点」优先插（概率高），普通位置低概率插，
      // 避免标点插进词语中间把通顺句切碎（20261008 修复）。
      const punctChanceJump = 0.55;   // 换句停顿点插标点概率
      const punctChancePlain = 0.08;  // 普通位置插标点概率（低，保留随机停顿感）

      // 开头（第一个字之前）也可能抽到字卡/表情
      await tryEmitBlock();

      while (typed < totalLen) {
        // 1) 选下一个字（纯随机 / 通顺游走，按 walkProb 混合）
        const jumped = walkJumped; // 记录上一个字是否「换句」
        charBuffer += pickChar();
        typed++;

        // 2) 标点可选动作：换句停顿点高概率插，普通位置低概率插。
        if (typed < totalLen && rng() < (jumped ? punctChanceJump : punctChancePlain)) {
          charBuffer += MID_PUNCT[Math.floor(rng() * MID_PUNCT.length)];
        }

        // 3) 逐字概率抽取：打完这个字后，可能抽到字卡/表情（插在这个字后面）
        await tryEmitBlock();
      }

      // 4) 结尾再抽一次（最后一个字之后）+ 句末标点（必加，句子完整有语气）
      flushText();
      await tryEmitBlock();
      blocks.push({ type: 'text', text: SENTENCE_END_PUNCT[Math.floor(rng() * SENTENCE_END_PUNCT.length)] });
    }

    // 最终纯文本表示（落库用；blocks 保留结构供渲染区分）
    const text = blocks.map(function (b) { return b.text; }).join('');

    return {
      type: 'typing_card',
      blocks: blocks,
      text: text,
      typedCount: typed,
      cardCount: cardUsed,
      emojiCount: emojiUsed
    };
  }

  const generator = {
    PINYIN_MAP,
    CANDIDATE_POOL,
    PUNCTUATION,
    pinyinOf: pinyinOf,
    candidatesOf: candidatesOf,
    buildSession: buildSession,
    dryRun: dryRun,
    generateContent: generateContent
  };

  global.bmTypecardGenerator = generator;
})(typeof window !== 'undefined' ? window : this);
