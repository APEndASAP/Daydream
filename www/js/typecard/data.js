/* ============================================================================
   白日梦 · 打字卡（Typecard）数据层 —— data.js
   ----------------------------------------------------------------------------
   职责：只处理「演出数据」——根据最终文本生成拼音/候选字等演出道具。
   定位（V1.1 renderer 架构）：
     · 打字卡不是消息系统，不生成消息内容、不落库、不发通知；
     · 最终文本永远来自真实消息 replyMsg.content（由主链 generate 产生）；
     · 本文件只做「把已有文本演出来」所需的纯数据，不操作 DOM、不写数据库。
   ============================================================================ */

(function (global) {
  'use strict';

  // 配置读取 key（20261008 起已迁移：开关/模式并入 app.js chatSettings.typecardOn / typecardMode，
  // 不再使用独立 kv 键 typecard.on。以下 CFG.on/level 仅作历史占位，isEnabled 已无调用方）
  const CFG = {
    on: 'typecard.on',       // 【已弃用】开关现读 chatSettings.typecardOn
    level: 'typecard.level', // 动画档位：'auto' | 'full' | 'lite'（未使用）
    source: 'typecard.source' // 文本来源：'builtin' | 'card'（M1 保留，未使用）
  };

  // ==========================================================================
  // 内置常用字库 COMMON_WORD_LIB（唯一数据源）
  // 定位：打字卡的「字库」，供三个用途同源取数——
  //   1) 随机选字（generateContent 拼句，按 freq 加权）
  //   2) 拼音表（字 → 拼音）
  //   3) 候选池（按同拼音分组）
  // 安全：本库收录阶段已剔除粗俗/下流/极度生僻字；badWordBlacklist 再兜底。
  // ==========================================================================
  const COMMON_WORD_LIB = [
  { ch: '的', py: 'de', freq: 100 }, { ch: '是', py: 'shi', freq: 100 }, { ch: '一', py: 'yi', freq: 100 }, { ch: '不', py: 'bu', freq: 99 }, { ch: '了', py: 'le', freq: 99 }, { ch: '我', py: 'wo', freq: 99 },
  { ch: '人', py: 'ren', freq: 98 }, { ch: '他', py: 'ta', freq: 98 }, { ch: '在', py: 'zai', freq: 98 }, { ch: '上', py: 'shang', freq: 97 }, { ch: '有', py: 'you', freq: 97 }, { ch: '这', py: 'zhe', freq: 97 },
  { ch: '到', py: 'dao', freq: 96 }, { ch: '来', py: 'lai', freq: 96 }, { ch: '们', py: 'men', freq: 96 }, { ch: '大', py: 'da', freq: 95 }, { ch: '地', py: 'di', freq: 95 }, { ch: '时', py: 'shi', freq: 95 },
  { ch: '为', py: 'wei', freq: 94 }, { ch: '中', py: 'zhong', freq: 94 }, { ch: '子', py: 'zi', freq: 94 }, { ch: '你', py: 'ni', freq: 93 }, { ch: '生', py: 'sheng', freq: 93 }, { ch: '说', py: 'shuo', freq: 93 },
  { ch: '国', py: 'guo', freq: 92 }, { ch: '年', py: 'nian', freq: 92 }, { ch: '着', py: 'zhe', freq: 92 }, { ch: '和', py: 'he', freq: 91 }, { ch: '就', py: 'jiu', freq: 91 }, { ch: '那', py: 'na', freq: 91 },
  { ch: '出', py: 'chu', freq: 90 }, { ch: '她', py: 'ta', freq: 90 }, { ch: '要', py: 'yao', freq: 90 }, { ch: '得', py: 'de', freq: 89 }, { ch: '里', py: 'li', freq: 89 }, { ch: '也', py: 'ye', freq: 89 },
  { ch: '后', py: 'hou', freq: 88 }, { ch: '以', py: 'yi', freq: 88 }, { ch: '自', py: 'zi', freq: 88 }, { ch: '会', py: 'hui', freq: 87 }, { ch: '家', py: 'jia', freq: 87 }, { ch: '可', py: 'ke', freq: 87 },
  { ch: '而', py: 'er', freq: 86 }, { ch: '过', py: 'guo', freq: 86 }, { ch: '下', py: 'xia', freq: 86 }, { ch: '能', py: 'neng', freq: 85 }, { ch: '去', py: 'qu', freq: 85 }, { ch: '天', py: 'tian', freq: 85 },
  { ch: '对', py: 'dui', freq: 84 }, { ch: '多', py: 'duo', freq: 84 }, { ch: '小', py: 'xiao', freq: 84 }, { ch: '然', py: 'ran', freq: 83 }, { ch: '心', py: 'xin', freq: 83 }, { ch: '于', py: 'yu', freq: 83 },
  { ch: '么', py: 'me', freq: 82 }, { ch: '学', py: 'xue', freq: 82 }, { ch: '之', py: 'zhi', freq: 82 }, { ch: '都', py: 'dou', freq: 81 }, { ch: '好', py: 'hao', freq: 81 }, { ch: '看', py: 'kan', freq: 81 },
  { ch: '当', py: 'dang', freq: 80 }, { ch: '发', py: 'fa', freq: 80 }, { ch: '起', py: 'qi', freq: 80 }, { ch: '成', py: 'cheng', freq: 79 }, { ch: '没', py: 'mei', freq: 79 }, { ch: '只', py: 'zhi', freq: 79 },
  { ch: '把', py: 'ba', freq: 78 }, { ch: '如', py: 'ru', freq: 78 }, { ch: '事', py: 'shi', freq: 78 }, { ch: '第', py: 'di', freq: 77 }, { ch: '还', py: 'hai', freq: 77 }, { ch: '用', py: 'yong', freq: 77 },
  { ch: '道', py: 'dao', freq: 76 }, { ch: '想', py: 'xiang', freq: 76 }, { ch: '样', py: 'yang', freq: 76 }, { ch: '开', py: 'kai', freq: 75 }, { ch: '种', py: 'zhong', freq: 75 }, { ch: '作', py: 'zuo', freq: 75 },
  { ch: '昂', py: 'ang', freq: 74 }, { ch: '拜', py: 'bai', freq: 74 }, { ch: '板', py: 'ban', freq: 74 }, { ch: '钡', py: 'bei', freq: 74 }, { ch: '避', py: 'bi', freq: 74 }, { ch: '惨', py: 'can', freq: 74 },
  { ch: '藏', py: 'cang', freq: 74 }, { ch: '嘲', py: 'chao', freq: 74 }, { ch: '乘', py: 'cheng', freq: 74 }, { ch: '充', py: 'chong', freq: 74 }, { ch: '崇', py: 'chong', freq: 74 }, { ch: '臭', py: 'chou', freq: 74 },
  { ch: '锄', py: 'chu', freq: 74 }, { ch: '从', py: 'cong', freq: 74 }, { ch: '岛', py: 'dao', freq: 74 }, { ch: '瞪', py: 'deng', freq: 74 }, { ch: '店', py: 'dian', freq: 74 }, { ch: '顶', py: 'ding', freq: 74 },
  { ch: '侗', py: 'dong', freq: 74 }, { ch: '冻', py: 'dong', freq: 74 }, { ch: '夺', py: 'duo', freq: 74 }, { ch: '蛾', py: 'e', freq: 74 }, { ch: '坊', py: 'fang', freq: 74 }, { ch: '酚', py: 'fen', freq: 74 },
  { ch: '丰', py: 'feng', freq: 74 }, { ch: '冯', py: 'feng', freq: 74 }, { ch: '腹', py: 'fu', freq: 74 }, { ch: '疙', py: 'ge', freq: 74 }, { ch: '宫', py: 'gong', freq: 74 }, { ch: '孤', py: 'gu', freq: 74 },
  { ch: '挂', py: 'gua', freq: 74 }, { ch: '闺', py: 'gui', freq: 74 }, { ch: '哈', py: 'ha', freq: 74 }, { ch: '杭', py: 'hang', freq: 74 }, { ch: '禾', py: 'he', freq: 74 }, { ch: '河', py: 'he', freq: 74 },
  { ch: '恒', py: 'heng', freq: 74 }, { ch: '户', py: 'hu', freq: 74 }, { ch: '换', py: 'huan', freq: 74 }, { ch: '吉', py: 'ji', freq: 74 }, { ch: '疾', py: 'ji', freq: 74 }, { ch: '碱', py: 'jian', freq: 74 },
  { ch: '饯', py: 'jian', freq: 74 }, { ch: '角', py: 'jiao', freq: 74 }, { ch: '浸', py: 'jin', freq: 74 }, { ch: '茎', py: 'jing', freq: 74 }, { ch: '聚', py: 'ju', freq: 74 }, { ch: '绢', py: 'juan', freq: 74 },
  { ch: '凯', py: 'kai', freq: 74 }, { ch: '抗', py: 'kang', freq: 74 }, { ch: '烤', py: 'kao', freq: 74 }, { ch: '壳', py: 'ke', freq: 74 }, { ch: '控', py: 'kong', freq: 74 }, { ch: '筐', py: 'kuang', freq: 74 },
  { ch: '篮', py: 'lan', freq: 74 }, { ch: '肋', py: 'le', freq: 74 }, { ch: '俐', py: 'li', freq: 74 }, { ch: '哩', py: 'li', freq: 74 }, { ch: '硫', py: 'liu', freq: 74 }, { ch: '聋', py: 'long', freq: 74 },
  { ch: '陇', py: 'long', freq: 74 }, { ch: '美', py: 'mei', freq: 74 }, { ch: '蒙', py: 'meng', freq: 74 }, { ch: '糜', py: 'mi', freq: 74 }, { ch: '弥', py: 'mi', freq: 74 }, { ch: '冕', py: 'mian', freq: 74 },
  { ch: '苗', py: 'miao', freq: 74 }, { ch: '皿', py: 'min', freq: 74 }, { ch: '悯', py: 'min', freq: 74 }, { ch: '膜', py: 'mo', freq: 74 }, { ch: '末', py: 'mo', freq: 74 }, { ch: '孽', py: 'nie', freq: 74 },
  { ch: '抛', py: 'pao', freq: 74 }, { ch: '裴', py: 'pei', freq: 74 }, { ch: '喷', py: 'pen', freq: 74 }, { ch: '漂', py: 'piao', freq: 74 }, { ch: '乒', py: 'ping', freq: 74 }, { ch: '葡', py: 'pu', freq: 74 },
  { ch: '乞', py: 'qi', freq: 74 }, { ch: '器', py: 'qi', freq: 74 }, { ch: '铅', py: 'qian', freq: 74 }, { ch: '趣', py: 'qu', freq: 74 }, { ch: '烧', py: 'shao', freq: 74 }, { ch: '拭', py: 'shi', freq: 74 },
  { ch: '梳', py: 'shu', freq: 74 }, { ch: '拴', py: 'shuan', freq: 74 }, { ch: '撕', py: 'si', freq: 74 }, { ch: '寺', py: 'si', freq: 74 }, { ch: '烫', py: 'tang', freq: 74 }, { ch: '腆', py: 'tian', freq: 74 },
  { ch: '偷', py: 'tou', freq: 74 }, { ch: '兔', py: 'tu', freq: 74 }, { ch: '拖', py: 'tuo', freq: 74 }, { ch: '娃', py: 'wa', freq: 74 }, { ch: '杏', py: 'xing', freq: 74 }, { ch: '修', py: 'xiu', freq: 74 },
  { ch: '绣', py: 'xiu', freq: 74 }, { ch: '沿', py: 'yan', freq: 74 }, { ch: '焰', py: 'yan', freq: 74 }, { ch: '页', py: 'ye', freq: 74 }, { ch: '庸', py: 'yong', freq: 74 }, { ch: '粤', py: 'yue', freq: 74 },
  { ch: '憎', py: 'zeng', freq: 74 }, { ch: '宅', py: 'zhai', freq: 74 }, { ch: '寨', py: 'zhai', freq: 74 }, { ch: '崭', py: 'zhan', freq: 74 }, { ch: '侄', py: 'zhi', freq: 74 }, { ch: '捉', py: 'zhuo', freq: 74 },
  { ch: '仔', py: 'zai', freq: 74 }, { ch: '踪', py: 'zong', freq: 74 }, { ch: '总', py: 'zong', freq: 74 }, { ch: '卒', py: 'zu', freq: 74 }, { ch: '埃', py: 'ai', freq: 73 }, { ch: '案', py: 'an', freq: 73 },
  { ch: '熬', py: 'ao', freq: 73 }, { ch: '耙', py: 'ba', freq: 73 }, { ch: '摆', py: 'bai', freq: 73 }, { ch: '瓣', py: 'ban', freq: 73 }, { ch: '棒', py: 'bang', freq: 73 }, { ch: '滨', py: 'bin', freq: 73 },
  { ch: '玻', py: 'bo', freq: 73 }, { ch: '拨', py: 'bo', freq: 73 }, { ch: '残', py: 'can', freq: 73 }, { ch: '谗', py: 'chan', freq: 73 }, { ch: '钞', py: 'chao', freq: 73 }, { ch: '晨', py: 'chen', freq: 73 },
  { ch: '骋', py: 'cheng', freq: 73 }, { ch: '炽', py: 'chi', freq: 73 }, { ch: '川', py: 'chuan', freq: 73 }, { ch: '丛', py: 'cong', freq: 73 }, { ch: '村', py: 'cun', freq: 73 }, { ch: '戴', py: 'dai', freq: 73 },
  { ch: '涤', py: 'di', freq: 73 }, { ch: '垫', py: 'dian', freq: 73 }, { ch: '吊', py: 'diao', freq: 73 }, { ch: '督', py: 'du', freq: 73 }, { ch: '钝', py: 'dun', freq: 73 }, { ch: '躲', py: 'duo', freq: 73 },
  { ch: '惰', py: 'duo', freq: 73 }, { ch: '讹', py: 'e', freq: 73 }, { ch: '耳', py: 'er', freq: 73 }, { ch: '帆', py: 'fan', freq: 73 }, { ch: '封', py: 'feng', freq: 73 }, { ch: '凤', py: 'feng', freq: 73 },
  { ch: '浮', py: 'fu', freq: 73 }, { ch: '概', py: 'gai', freq: 73 }, { ch: '葛', py: 'ge', freq: 73 }, { ch: '构', py: 'gou', freq: 73 }, { ch: '馆', py: 'guan', freq: 73 }, { ch: '郭', py: 'guo', freq: 73 },
  { ch: '撼', py: 'han', freq: 73 }, { ch: '亨', py: 'heng', freq: 73 }, { ch: '弘', py: 'hong', freq: 73 }, { ch: '侯', py: 'hou', freq: 73 }, { ch: '狐', py: 'hu', freq: 73 }, { ch: '痪', py: 'huan', freq: 73 },
  { ch: '荒', py: 'huang', freq: 73 }, { ch: '昏', py: 'hun', freq: 73 }, { ch: '鸡', py: 'ji', freq: 73 }, { ch: '己', py: 'ji', freq: 73 }, { ch: '冀', py: 'ji', freq: 73 }, { ch: '匠', py: 'jiang', freq: 73 },
  { ch: '姐', py: 'jie', freq: 73 }, { ch: '锦', py: 'jin', freq: 73 }, { ch: '晶', py: 'jing', freq: 73 }, { ch: '痉', py: 'jing', freq: 73 }, { ch: '剧', py: 'ju', freq: 73 }, { ch: '亢', py: 'kang', freq: 73 },
  { ch: '胯', py: 'kua', freq: 73 }, { ch: '捞', py: 'lao', freq: 73 }, { ch: '蕾', py: 'lei', freq: 73 }, { ch: '荔', py: 'li', freq: 73 }, { ch: '廉', py: 'lian', freq: 73 }, { ch: '劣', py: 'lie', freq: 73 },
  { ch: '淋', py: 'lin', freq: 73 }, { ch: '凛', py: 'lin', freq: 73 }, { ch: '羚', py: 'ling', freq: 73 }, { ch: '馏', py: 'liu', freq: 73 }, { ch: '芦', py: 'lu', freq: 73 }, { ch: '戮', py: 'lu', freq: 73 },
  { ch: '锣', py: 'luo', freq: 73 }, { ch: '骆', py: 'luo', freq: 73 }, { ch: '码', py: 'ma', freq: 73 }, { ch: '煤', py: 'mei', freq: 73 }, { ch: '妹', py: 'mei', freq: 73 }, { ch: '魔', py: 'mo', freq: 73 },
  { ch: '拇', py: 'mu', freq: 73 }, { ch: '亩', py: 'mu', freq: 73 }, { ch: '蔫', py: 'nian', freq: 73 }, { ch: '酿', py: 'niang', freq: 73 }, { ch: '骗', py: 'pian', freq: 73 }, { ch: '苹', py: 'ping', freq: 73 },
  { ch: '评', py: 'ping', freq: 73 }, { ch: '栖', py: 'qi', freq: 73 }, { ch: '沏', py: 'qi', freq: 73 }, { ch: '歧', py: 'qi', freq: 73 }, { ch: '牵', py: 'qian', freq: 73 }, { ch: '浅', py: 'qian', freq: 73 },
  { ch: '氰', py: 'qing', freq: 73 }, { ch: '情', py: 'qing', freq: 73 }, { ch: '攘', py: 'rang', freq: 73 }, { ch: '融', py: 'rong', freq: 73 }, { ch: '溶', py: 'rong', freq: 73 }, { ch: '冗', py: 'rong', freq: 73 },
  { ch: '软', py: 'ruan', freq: 73 }, { ch: '弱', py: 'ruo', freq: 73 }, { ch: '撒', py: 'sa', freq: 73 }, { ch: '嫂', py: 'sao', freq: 73 }, { ch: '瑟', py: 'se', freq: 73 }, { ch: '刹', py: 'sha', freq: 73 },
  { ch: '闪', py: 'shan', freq: 73 }, { ch: '舍', py: 'she', freq: 73 }, { ch: '娠', py: 'shen', freq: 73 }, { ch: '赎', py: 'shu', freq: 73 }, { ch: '薯', py: 'shu', freq: 73 }, { ch: '搜', py: 'sou', freq: 73 },
  { ch: '踏', py: 'ta', freq: 73 }, { ch: '倘', py: 'tang', freq: 73 }, { ch: '藤', py: 'teng', freq: 73 }, { ch: '替', py: 'ti', freq: 73 }, { ch: '透', py: 'tou', freq: 73 }, { ch: '臀', py: 'tun', freq: 73 },
  { ch: '丸', py: 'wan', freq: 73 }, { ch: '网', py: 'wang', freq: 73 }, { ch: '危', py: 'wei', freq: 73 }, { ch: '畏', py: 'wei', freq: 73 }, { ch: '喂', py: 'wei', freq: 73 }, { ch: '瘟', py: 'wen', freq: 73 },
  { ch: '紊', py: 'wen', freq: 73 }, { ch: '翁', py: 'weng', freq: 73 }, { ch: '窝', py: 'wo', freq: 73 }, { ch: '无', py: 'wu', freq: 73 }, { ch: '伍', py: 'wu', freq: 73 }, { ch: '膝', py: 'xi', freq: 73 },
  { ch: '袭', py: 'xi', freq: 73 }, { ch: '席', py: 'xi', freq: 73 }, { ch: '媳', py: 'xi', freq: 73 }, { ch: '侠', py: 'xia', freq: 73 }, { ch: '涎', py: 'xian', freq: 73 }, { ch: '蟹', py: 'xie', freq: 73 },
  { ch: '惺', py: 'xing', freq: 73 }, { ch: '型', py: 'xing', freq: 73 }, { ch: '癣', py: 'xuan', freq: 73 }, { ch: '揖', py: 'yi', freq: 73 }, { ch: '益', py: 'yi', freq: 73 }, { ch: '银', py: 'yin', freq: 73 },
  { ch: '涌', py: 'yong', freq: 73 }, { ch: '釉', py: 'you', freq: 73 }, { ch: '诱', py: 'you', freq: 73 }, { ch: '幼', py: 'you', freq: 73 }, { ch: '耘', py: 'yun', freq: 73 }, { ch: '宰', py: 'zai', freq: 73 },
  { ch: '赃', py: 'zang', freq: 73 }, { ch: '糟', py: 'zao', freq: 73 }, { ch: '栈', py: 'zhan', freq: 73 }, { ch: '昭', py: 'zhao', freq: 73 }, { ch: '帧', py: 'zhen', freq: 73 }, { ch: '帚', py: 'zhou', freq: 73 },
  { ch: '昼', py: 'zhou', freq: 73 }, { ch: '翱', py: 'ao', freq: 72 }, { ch: '靶', py: 'ba', freq: 72 }, { ch: '搬', py: 'ban', freq: 72 }, { ch: '扳', py: 'ban', freq: 72 }, { ch: '蚌', py: 'bang', freq: 72 },
  { ch: '堡', py: 'bao', freq: 72 }, { ch: '狈', py: 'bei', freq: 72 }, { ch: '崩', py: 'beng', freq: 72 }, { ch: '绷', py: 'beng', freq: 72 }, { ch: '编', py: 'bian', freq: 72 }, { ch: '贬', py: 'bian', freq: 72 },
  { ch: '饼', py: 'bing', freq: 72 }, { ch: '波', py: 'bo', freq: 72 }, { ch: '辰', py: 'chen', freq: 72 }, { ch: '诚', py: 'cheng', freq: 72 }, { ch: '躇', py: 'chu', freq: 72 }, { ch: '纯', py: 'chun', freq: 72 },
  { ch: '搓', py: 'cuo', freq: 72 }, { ch: '掸', py: 'dan', freq: 72 }, { ch: '灯', py: 'deng', freq: 72 }, { ch: '低', py: 'di', freq: 72 }, { ch: '殿', py: 'dian', freq: 72 }, { ch: '钉', py: 'ding', freq: 72 },
  { ch: '栋', py: 'dong', freq: 72 }, { ch: '兜', py: 'dou', freq: 72 }, { ch: '锻', py: 'duan', freq: 72 }, { ch: '吨', py: 'dun', freq: 72 }, { ch: '剁', py: 'duo', freq: 72 }, { ch: '洱', py: 'er', freq: 72 },
  { ch: '罚', py: 'fa', freq: 72 }, { ch: '矾', py: 'fan', freq: 72 }, { ch: '否', py: 'fou', freq: 72 }, { ch: '孵', py: 'fu', freq: 72 }, { ch: '稿', py: 'gao', freq: 72 }, { ch: '耕', py: 'geng', freq: 72 },
  { ch: '恭', py: 'gong', freq: 72 }, { ch: '箍', py: 'gu', freq: 72 }, { ch: '涵', py: 'han', freq: 72 }, { ch: '罕', py: 'han', freq: 72 }, { ch: '弧', py: 'hu', freq: 72 }, { ch: '槐', py: 'huai', freq: 72 },
  { ch: '坏', py: 'huai', freq: 72 }, { ch: '贿', py: 'hui', freq: 72 }, { ch: '汇', py: 'hui', freq: 72 }, { ch: '箕', py: 'ji', freq: 72 }, { ch: '架', py: 'jia', freq: 72 }, { ch: '坚', py: 'jian', freq: 72 },
  { ch: '柬', py: 'jian', freq: 72 }, { ch: '溅', py: 'jian', freq: 72 }, { ch: '搅', py: 'jiao', freq: 72 }, { ch: '捷', py: 'jie', freq: 72 }, { ch: '禁', py: 'jin', freq: 72 }, { ch: '灸', py: 'jiu', freq: 72 },
  { ch: '旧', py: 'jiu', freq: 72 }, { ch: '狙', py: 'ju', freq: 72 }, { ch: '倦', py: 'juan', freq: 72 }, { ch: '揩', py: 'kai', freq: 72 }, { ch: '勘', py: 'kan', freq: 72 }, { ch: '窟', py: 'ku', freq: 72 },
  { ch: '侩', py: 'kuai', freq: 72 }, { ch: '捆', py: 'kun', freq: 72 }, { ch: '谰', py: 'lan', freq: 72 }, { ch: '凉', py: 'liang', freq: 72 }, { ch: '粱', py: 'liang', freq: 72 }, { ch: '良', py: 'liang', freq: 72 },
  { ch: '晾', py: 'liang', freq: 72 }, { ch: '琳', py: 'lin', freq: 72 }, { ch: '凌', py: 'ling', freq: 72 }, { ch: '吕', py: 'lv', freq: 72 }, { ch: '律', py: 'lv', freq: 72 }, { ch: '仑', py: 'lun', freq: 72 },
  { ch: '萝', py: 'luo', freq: 72 }, { ch: '玛', py: 'ma', freq: 72 }, { ch: '靡', py: 'mi', freq: 72 }, { ch: '勉', py: 'mian', freq: 72 }, { ch: '面', py: 'mian', freq: 72 }, { ch: '磨', py: 'mo', freq: 72 },
  { ch: '逆', py: 'ni', freq: 72 }, { ch: '扭', py: 'niu', freq: 72 }, { ch: '女', py: 'nv', freq: 72 }, { ch: '耪', py: 'pang', freq: 72 }, { ch: '披', py: 'pi', freq: 72 }, { ch: '毗', py: 'pi', freq: 72 },
  { ch: '浦', py: 'pu', freq: 72 }, { ch: '沁', py: 'qin', freq: 72 }, { ch: '氢', py: 'qing', freq: 72 }, { ch: '醛', py: 'quan', freq: 72 }, { ch: '扔', py: 'reng', freq: 72 }, { ch: '戎', py: 'rong', freq: 72 },
  { ch: '裳', py: 'shang', freq: 72 }, { ch: '涉', py: 'she', freq: 72 }, { ch: '诵', py: 'song', freq: 72 }, { ch: '唆', py: 'suo', freq: 72 }, { ch: '塔', py: 'ta', freq: 72 }, { ch: '挞', py: 'ta', freq: 72 },
  { ch: '酞', py: 'tai', freq: 72 }, { ch: '滔', py: 'tao', freq: 72 }, { ch: '踢', py: 'ti', freq: 72 }, { ch: '涕', py: 'ti', freq: 72 }, { ch: '田', py: 'tian', freq: 72 }, { ch: '厅', py: 'ting', freq: 72 },
  { ch: '秃', py: 'tu', freq: 72 }, { ch: '退', py: 'tui', freq: 72 }, { ch: '挽', py: 'wan', freq: 72 }, { ch: '挝', py: 'wo', freq: 72 }, { ch: '吴', py: 'wu', freq: 72 }, { ch: '武', py: 'wu', freq: 72 },
  { ch: '纤', py: 'xian', freq: 72 }, { ch: '匈', py: 'xiong', freq: 72 }, { ch: '续', py: 'xu', freq: 72 }, { ch: '旋', py: 'xuan', freq: 72 }, { ch: '勋', py: 'xun', freq: 72 }, { ch: '驯', py: 'xun', freq: 72 },
  { ch: '央', py: 'yang', freq: 72 }, { ch: '扬', py: 'yang', freq: 72 }, { ch: '尧', py: 'yao', freq: 72 }, { ch: '矣', py: 'yi', freq: 72 }, { ch: '诣', py: 'yi', freq: 72 }, { ch: '异', py: 'yi', freq: 72 },
  { ch: '铀', py: 'you', freq: 72 }, { ch: '裕', py: 'yu', freq: 72 }, { ch: '岳', py: 'yue', freq: 72 }, { ch: '韵', py: 'yun', freq: 72 }, { ch: '澡', py: 'zao', freq: 72 }, { ch: '辗', py: 'nian', freq: 72 },
  { ch: '诌', py: 'zhou', freq: 72 }, { ch: '桌', py: 'zhuo', freq: 72 }, { ch: '浊', py: 'zhuo', freq: 72 }, { ch: '宗', py: 'zong', freq: 72 }, { ch: '最', py: 'zui', freq: 72 }, { ch: '稗', py: 'bai', freq: 71 },
  { ch: '梆', py: 'bang', freq: 71 }, { ch: '膀', py: 'bang', freq: 71 }, { ch: '倍', py: 'bei', freq: 71 }, { ch: '鼻', py: 'bi', freq: 71 }, { ch: '鄙', py: 'bi', freq: 71 }, { ch: '毕', py: 'bi', freq: 71 },
  { ch: '臂', py: 'bi', freq: 71 }, { ch: '钵', py: 'bo', freq: 71 }, { ch: '材', py: 'cai', freq: 71 }, { ch: '碴', py: 'cha', freq: 71 }, { ch: '搽', py: 'cha', freq: 71 }, { ch: '柴', py: 'chai', freq: 71 },
  { ch: '尝', py: 'chang', freq: 71 }, { ch: '尘', py: 'chen', freq: 71 }, { ch: '痴', py: 'chi', freq: 71 }, { ch: '尺', py: 'chi', freq: 71 }, { ch: '雏', py: 'chu', freq: 71 }, { ch: '础', py: 'chu', freq: 71 },
  { ch: '聪', py: 'cong', freq: 71 }, { ch: '簇', py: 'cu', freq: 71 }, { ch: '脆', py: 'cui', freq: 71 }, { ch: '但', py: 'dan', freq: 71 }, { ch: '钓', py: 'diao', freq: 71 }, { ch: '叠', py: 'die', freq: 71 },
  { ch: '叮', py: 'ding', freq: 71 }, { ch: '堵', py: 'du', freq: 71 }, { ch: '睹', py: 'du', freq: 71 }, { ch: '饵', py: 'er', freq: 71 }, { ch: '贩', py: 'fan', freq: 71 }, { ch: '腐', py: 'fu', freq: 71 },
  { ch: '嘎', py: 'ga', freq: 71 }, { ch: '盖', py: 'gai', freq: 71 }, { ch: '纲', py: 'gang', freq: 71 }, { ch: '镐', py: 'gao', freq: 71 }, { ch: '刮', py: 'gua', freq: 71 }, { ch: '归', py: 'gui', freq: 71 },
  { ch: '诡', py: 'gui', freq: 71 }, { ch: '亥', py: 'hai', freq: 71 }, { ch: '害', py: 'hai', freq: 71 }, { ch: '憨', py: 'han', freq: 71 }, { ch: '喊', py: 'han', freq: 71 }, { ch: '旱', py: 'han', freq: 71 },
  { ch: '呵', py: 'he', freq: 71 }, { ch: '嘿', py: 'hei', freq: 71 }, { ch: '烘', py: 'hong', freq: 71 }, { ch: '蝗', py: 'huang', freq: 71 }, { ch: '簧', py: 'huang', freq: 71 }, { ch: '皇', py: 'huang', freq: 71 },
  { ch: '凰', py: 'huang', freq: 71 }, { ch: '惶', py: 'huang', freq: 71 }, { ch: '慧', py: 'hui', freq: 71 }, { ch: '卉', py: 'hui', freq: 71 }, { ch: '诲', py: 'hui', freq: 71 }, { ch: '霍', py: 'huo', freq: 71 },
  { ch: '饥', py: 'ji', freq: 71 }, { ch: '监', py: 'jian', freq: 71 }, { ch: '笺', py: 'jian', freq: 71 }, { ch: '兼', py: 'jian', freq: 71 }, { ch: '槛', py: 'kan', freq: 71 }, { ch: '杰', py: 'jie', freq: 71 },
  { ch: '救', py: 'jiu', freq: 71 }, { ch: '踞', py: 'ju', freq: 71 }, { ch: '坷', py: 'ke', freq: 71 }, { ch: '狂', py: 'kuang', freq: 71 }, { ch: '亏', py: 'kui', freq: 71 }, { ch: '傀', py: 'gui', freq: 71 },
  { ch: '阑', py: 'lan', freq: 71 }, { ch: '例', py: 'li', freq: 71 }, { ch: '沥', py: 'li', freq: 71 }, { ch: '玲', py: 'ling', freq: 71 }, { ch: '掳', py: 'lu', freq: 71 }, { ch: '氯', py: 'lv', freq: 71 },
  { ch: '裸', py: 'luo', freq: 71 }, { ch: '茅', py: 'mao', freq: 71 }, { ch: '娩', py: 'mian', freq: 71 }, { ch: '庙', py: 'miao', freq: 71 }, { ch: '乃', py: 'nai', freq: 71 }, { ch: '恼', py: 'nao', freq: 71 },
  { ch: '嫩', py: 'nen', freq: 71 }, { ch: '弄', py: 'nong', freq: 71 }, { ch: '胚', py: 'pei', freq: 71 }, { ch: '批', py: 'pi', freq: 71 }, { ch: '痞', py: 'pi', freq: 71 }, { ch: '曝', py: 'pu', freq: 71 },
  { ch: '契', py: 'qi', freq: 71 }, { ch: '弃', py: 'qi', freq: 71 }, { ch: '前', py: 'qian', freq: 71 }, { ch: '抢', py: 'qiang', freq: 71 }, { ch: '韧', py: 'ren', freq: 71 }, { ch: '腮', py: 'sai', freq: 71 },
  { ch: '叁', py: 'san', freq: 71 }, { ch: '摄', py: 'she', freq: 71 }, { ch: '盛', py: 'sheng', freq: 71 }, { ch: '戍', py: 'shu', freq: 71 }, { ch: '蓑', py: 'suo', freq: 71 }, { ch: '桃', py: 'tao', freq: 71 },
  { ch: '驼', py: 'tuo', freq: 71 }, { ch: '潍', py: 'wei', freq: 71 }, { ch: '委', py: 'wei', freq: 71 }, { ch: '捂', py: 'wu', freq: 71 }, { ch: '稀', py: 'xi', freq: 71 }, { ch: '犀', py: 'xi', freq: 71 },
  { ch: '现', py: 'xian', freq: 71 }, { ch: '县', py: 'xian', freq: 71 }, { ch: '羡', py: 'xian', freq: 71 }, { ch: '项', py: 'xiang', freq: 71 }, { ch: '晓', py: 'xiao', freq: 71 }, { ch: '殉', py: 'xun', freq: 71 },
  { ch: '鸦', py: 'ya', freq: 71 }, { ch: '呀', py: 'ya', freq: 71 }, { ch: '瑶', py: 'yao', freq: 71 }, { ch: '踊', py: 'yong', freq: 71 }, { ch: '泳', py: 'yong', freq: 71 }, { ch: '域', py: 'yu', freq: 71 },
  { ch: '豫', py: 'yu', freq: 71 }, { ch: '瘴', py: 'zhang', freq: 71 }, { ch: '罩', py: 'zhao', freq: 71 }, { ch: '浙', py: 'zhe', freq: 71 }, { ch: '壮', py: 'zhuang', freq: 71 }, { ch: '鞍', py: 'an', freq: 70 },
  { ch: '凹', py: 'ao', freq: 70 }, { ch: '颁', py: 'ban', freq: 70 }, { ch: '暴', py: 'bao', freq: 70 }, { ch: '杯', py: 'bei', freq: 70 }, { ch: '碑', py: 'bei', freq: 70 }, { ch: '痹', py: 'bi', freq: 70 },
  { ch: '兵', py: 'bing', freq: 70 }, { ch: '脖', py: 'bo', freq: 70 }, { ch: '埠', py: 'bu', freq: 70 }, { ch: '曹', py: 'cao', freq: 70 }, { ch: '承', py: 'cheng', freq: 70 }, { ch: '秤', py: 'cheng', freq: 70 },
  { ch: '瞅', py: 'chou', freq: 70 }, { ch: '创', py: 'chuang', freq: 70 }, { ch: '翠', py: 'cui', freq: 70 }, { ch: '挫', py: 'cuo', freq: 70 }, { ch: '贷', py: 'dai', freq: 70 }, { ch: '迪', py: 'di', freq: 70 },
  { ch: '佃', py: 'dian', freq: 70 }, { ch: '凋', py: 'diao', freq: 70 }, { ch: '跺', py: 'duo', freq: 70 }, { ch: '筏', py: 'fa', freq: 70 }, { ch: '纷', py: 'fen', freq: 70 }, { ch: '份', py: 'fen', freq: 70 },
  { ch: '蜂', py: 'feng', freq: 70 }, { ch: '缝', py: 'feng', freq: 70 }, { ch: '副', py: 'fu', freq: 70 }, { ch: '咐', py: 'fu', freq: 70 }, { ch: '敢', py: 'gan', freq: 70 }, { ch: '肛', py: 'gang', freq: 70 },
  { ch: '杠', py: 'gang', freq: 70 }, { ch: '搁', py: 'ge', freq: 70 }, { ch: '供', py: 'gong', freq: 70 }, { ch: '躬', py: 'gong', freq: 70 }, { ch: '顾', py: 'gu', freq: 70 }, { ch: '喝', py: 'he', freq: 70 },
  { ch: '蝴', py: 'hu', freq: 70 }, { ch: '艰', py: 'jian', freq: 70 }, { ch: '践', py: 'jian', freq: 70 }, { ch: '劲', py: 'jin', freq: 70 }, { ch: '睛', py: 'jing', freq: 70 }, { ch: '眷', py: 'juan', freq: 70 },
  { ch: '撅', py: 'jue', freq: 70 }, { ch: '慨', py: 'kai', freq: 70 }, { ch: '靠', py: 'kao', freq: 70 }, { ch: '葵', py: 'kui', freq: 70 }, { ch: '累', py: 'lei', freq: 70 }, { ch: '梨', py: 'li', freq: 70 },
  { ch: '敛', py: 'lian', freq: 70 }, { ch: '篓', py: 'lou', freq: 70 }, { ch: '陋', py: 'lou', freq: 70 }, { ch: '麓', py: 'lu', freq: 70 }, { ch: '录', py: 'lu', freq: 70 }, { ch: '铝', py: 'lv', freq: 70 },
  { ch: '迈', py: 'mai', freq: 70 }, { ch: '媒', py: 'mei', freq: 70 }, { ch: '谬', py: 'miu', freq: 70 }, { ch: '沫', py: 'mo', freq: 70 }, { ch: '陌', py: 'mo', freq: 70 }, { ch: '幕', py: 'mu', freq: 70 },
  { ch: '溺', py: 'ni', freq: 70 }, { ch: '鸟', py: 'niao', freq: 70 }, { ch: '涅', py: 'nie', freq: 70 }, { ch: '帕', py: 'pa', freq: 70 }, { ch: '劈', py: 'pi', freq: 70 }, { ch: '聘', py: 'pin', freq: 70 },
  { ch: '柒', py: 'qi', freq: 70 }, { ch: '企', py: 'qi', freq: 70 }, { ch: '歉', py: 'qian', freq: 70 }, { ch: '窍', py: 'qiao', freq: 70 }, { ch: '钦', py: 'qin', freq: 70 }, { ch: '擒', py: 'qin', freq: 70 },
  { ch: '庆', py: 'qing', freq: 70 }, { ch: '茸', py: 'rong', freq: 70 }, { ch: '蠕', py: 'ru', freq: 70 }, { ch: '萨', py: 'sa', freq: 70 }, { ch: '莎', py: 'sha', freq: 70 }, { ch: '煞', py: 'sha', freq: 70 },
  { ch: '擅', py: 'shan', freq: 70 }, { ch: '沈', py: 'shen', freq: 70 }, { ch: '胜', py: 'sheng', freq: 70 }, { ch: '蚀', py: 'shi', freq: 70 }, { ch: '柿', py: 'shi', freq: 70 }, { ch: '抒', py: 'shu', freq: 70 },
  { ch: '署', py: 'shu', freq: 70 }, { ch: '衰', py: 'shuai', freq: 70 }, { ch: '瞬', py: 'shun', freq: 70 }, { ch: '损', py: 'sun', freq: 70 }, { ch: '缩', py: 'suo', freq: 70 }, { ch: '所', py: 'suo', freq: 70 },
  { ch: '坛', py: 'tan', freq: 70 }, { ch: '汤', py: 'tang', freq: 70 }, { ch: '膛', py: 'tang', freq: 70 }, { ch: '添', py: 'tian', freq: 70 }, { ch: '同', py: 'tong', freq: 70 }, { ch: '褪', py: 'tui', freq: 70 },
  { ch: '吞', py: 'tun', freq: 70 }, { ch: '椭', py: 'tuo', freq: 70 }, { ch: '挖', py: 'wa', freq: 70 }, { ch: '唯', py: 'wei', freq: 70 }, { ch: '惟', py: 'wei', freq: 70 }, { ch: '伪', py: 'wei', freq: 70 },
  { ch: '硒', py: 'xi', freq: 70 }, { ch: '熄', py: 'xi', freq: 70 }, { ch: '瞎', py: 'xia', freq: 70 }, { ch: '舷', py: 'xian', freq: 70 }, { ch: '限', py: 'xian', freq: 70 }, { ch: '乡', py: 'xiang', freq: 70 },
  { ch: '祥', py: 'xiang', freq: 70 }, { ch: '些', py: 'xie', freq: 70 }, { ch: '蝎', py: 'xie', freq: 70 }, { ch: '懈', py: 'xie', freq: 70 }, { ch: '猩', py: 'xing', freq: 70 }, { ch: '秀', py: 'xiu', freq: 70 },
  { ch: '穴', py: 'xue', freq: 70 }, { ch: '询', py: 'xun', freq: 70 }, { ch: '涯', py: 'ya', freq: 70 }, { ch: '宴', py: 'yan', freq: 70 }, { ch: '谚', py: 'yan', freq: 70 }, { ch: '羊', py: 'yang', freq: 70 },
  { ch: '爷', py: 'ye', freq: 70 }, { ch: '拥', py: 'yong', freq: 70 }, { ch: '佣', py: 'yong', freq: 70 }, { ch: '芋', py: 'yu', freq: 70 }, { ch: '育', py: 'yu', freq: 70 }, { ch: '杂', py: 'za', freq: 70 },
  { ch: '责', py: 'ze', freq: 70 }, { ch: '札', py: 'zha', freq: 70 }, { ch: '彰', py: 'zhang', freq: 70 }, { ch: '漳', py: 'zhang', freq: 70 }, { ch: '账', py: 'zhang', freq: 70 }, { ch: '帜', py: 'zhi', freq: 70 },
  { ch: '琢', py: 'zuo', freq: 70 }, { ch: '茁', py: 'zhuo', freq: 70 }, { ch: '渍', py: 'zi', freq: 70 }, { ch: '钻', py: 'zuan', freq: 70 }, { ch: '疤', py: 'ba', freq: 69 }, { ch: '褒', py: 'bao', freq: 69 },
  { ch: '爆', py: 'bao', freq: 69 }, { ch: '蔽', py: 'bi', freq: 69 }, { ch: '睬', py: 'cai', freq: 69 }, { ch: '册', py: 'ce', freq: 69 }, { ch: '昌', py: 'chang', freq: 69 }, { ch: '矗', py: 'chu', freq: 69 },
  { ch: '揣', py: 'chuai', freq: 69 }, { ch: '淬', py: 'cui', freq: 69 }, { ch: '逮', py: 'dai', freq: 69 }, { ch: '稻', py: 'dao', freq: 69 }, { ch: '嫡', py: 'di', freq: 69 }, { ch: '颠', py: 'dian', freq: 69 },
  { ch: '惦', py: 'dian', freq: 69 }, { ch: '碉', py: 'diao', freq: 69 }, { ch: '跌', py: 'die', freq: 69 }, { ch: '毒', py: 'du', freq: 69 }, { ch: '乏', py: 'fa', freq: 69 }, { ch: '防', py: 'fang', freq: 69 },
  { ch: '峰', py: 'feng', freq: 69 }, { ch: '奉', py: 'feng', freq: 69 }, { ch: '袱', py: 'fu', freq: 69 }, { ch: '冈', py: 'gang', freq: 69 }, { ch: '钢', py: 'gang', freq: 69 }, { ch: '铬', py: 'ge', freq: 69 },
  { ch: '惯', py: 'guan', freq: 69 }, { ch: '贯', py: 'guan', freq: 69 }, { ch: '辊', py: 'gun', freq: 69 }, { ch: '憾', py: 'han', freq: 69 }, { ch: '汗', py: 'han', freq: 69 }, { ch: '鹤', py: 'he', freq: 69 },
  { ch: '忽', py: 'hu', freq: 69 }, { ch: '悔', py: 'hui', freq: 69 }, { ch: '惑', py: 'huo', freq: 69 }, { ch: '缉', py: 'ji', freq: 69 }, { ch: '件', py: 'jian', freq: 69 }, { ch: '浆', py: 'jiang', freq: 69 },
  { ch: '浇', py: 'jiao', freq: 69 }, { ch: '街', py: 'jie', freq: 69 }, { ch: '介', py: 'jie', freq: 69 }, { ch: '窘', py: 'jiong', freq: 69 }, { ch: '驹', py: 'ju', freq: 69 }, { ch: '刊', py: 'kan', freq: 69 },
  { ch: '宽', py: 'kuan', freq: 69 }, { ch: '岿', py: 'kui', freq: 69 }, { ch: '廓', py: 'kuo', freq: 69 }, { ch: '阔', py: 'kuo', freq: 69 }, { ch: '腊', py: 'la', freq: 69 }, { ch: '栗', py: 'li', freq: 69 },
  { ch: '廖', py: 'liao', freq: 69 }, { ch: '卤', py: 'lu', freq: 69 }, { ch: '履', py: 'lv', freq: 69 }, { ch: '轮', py: 'lun', freq: 69 }, { ch: '沦', py: 'lun', freq: 69 }, { ch: '霉', py: 'mei', freq: 69 },
  { ch: '锰', py: 'meng', freq: 69 }, { ch: '敏', py: 'min', freq: 69 }, { ch: '螟', py: 'ming', freq: 69 }, { ch: '蘑', py: 'mo', freq: 69 }, { ch: '钠', py: 'na', freq: 69 }, { ch: '霓', py: 'ni', freq: 69 },
  { ch: '腻', py: 'ni', freq: 69 }, { ch: '挪', py: 'nuo', freq: 69 }, { ch: '泡', py: 'pao', freq: 69 }, { ch: '脾', py: 'pi', freq: 69 }, { ch: '譬', py: 'pi', freq: 69 }, { ch: '启', py: 'qi', freq: 69 },
  { ch: '乾', py: 'qian', freq: 69 }, { ch: '秦', py: 'qin', freq: 69 }, { ch: '晴', py: 'qing', freq: 69 }, { ch: '泅', py: 'qiu', freq: 69 }, { ch: '裙', py: 'qun', freq: 69 }, { ch: '日', py: 'ri', freq: 69 },
  { ch: '辱', py: 'ru', freq: 69 }, { ch: '汕', py: 'shan', freq: 69 }, { ch: '矢', py: 'shi', freq: 69 }, { ch: '手', py: 'shou', freq: 69 }, { ch: '栓', py: 'shuan', freq: 69 }, { ch: '讼', py: 'song', freq: 69 },
  { ch: '艘', py: 'sou', freq: 69 }, { ch: '僳', py: 'su', freq: 69 }, { ch: '隧', py: 'sui', freq: 69 }, { ch: '琐', py: 'suo', freq: 69 }, { ch: '滩', py: 'tan', freq: 69 }, { ch: '叹', py: 'tan', freq: 69 },
  { ch: '剃', py: 'ti', freq: 69 }, { ch: '腿', py: 'tui', freq: 69 }, { ch: '顽', py: 'wan', freq: 69 }, { ch: '烷', py: 'wan', freq: 69 }, { ch: '萎', py: 'wei', freq: 69 }, { ch: '魏', py: 'wei', freq: 69 },
  { ch: '吻', py: 'wen', freq: 69 }, { ch: '嗡', py: 'weng', freq: 69 }, { ch: '翔', py: 'xiang', freq: 69 }, { ch: '哮', py: 'xiao', freq: 69 }, { ch: '鞋', py: 'xie', freq: 69 }, { ch: '崖', py: 'ya', freq: 69 },
  { ch: '秧', py: 'yang', freq: 69 }, { ch: '窑', py: 'yao', freq: 69 }, { ch: '翌', py: 'yi', freq: 69 }, { ch: '咏', py: 'yong', freq: 69 }, { ch: '幽', py: 'you', freq: 69 }, { ch: '又', py: 'you', freq: 69 },
  { ch: '钥', py: 'yao', freq: 69 }, { ch: '枣', py: 'zao', freq: 69 }, { ch: '掌', py: 'zhang', freq: 69 }, { ch: '臻', py: 'zhen', freq: 69 }, { ch: '疹', py: 'zhen', freq: 69 }, { ch: '宙', py: 'zhou', freq: 69 },
  { ch: '嘱', py: 'zhu', freq: 69 }, { ch: '艾', py: 'ai', freq: 68 }, { ch: '敖', py: 'ao', freq: 68 }, { ch: '奥', py: 'ao', freq: 68 }, { ch: '芭', py: 'ba', freq: 68 }, { ch: '傍', py: 'bang', freq: 68 },
  { ch: '辫', py: 'bian', freq: 68 }, { ch: '博', py: 'bo', freq: 68 }, { ch: '诧', py: 'cha', freq: 68 }, { ch: '抄', py: 'chao', freq: 68 }, { ch: '朝', py: 'chao', freq: 68 }, { ch: '惩', py: 'cheng', freq: 68 },
  { ch: '畴', py: 'chou', freq: 68 }, { ch: '滁', py: 'chu', freq: 68 }, { ch: '磁', py: 'ci', freq: 68 }, { ch: '郸', py: 'dan', freq: 68 }, { ch: '登', py: 'deng', freq: 68 }, { ch: '叼', py: 'diao', freq: 68 },
  { ch: '锭', py: 'ding', freq: 68 }, { ch: '冬', py: 'dong', freq: 68 }, { ch: '动', py: 'dong', freq: 68 }, { ch: '豆', py: 'dou', freq: 68 }, { ch: '缎', py: 'duan', freq: 68 }, { ch: '蹲', py: 'dun', freq: 68 },
  { ch: '肥', py: 'fei', freq: 68 }, { ch: '俘', py: 'fu', freq: 68 }, { ch: '脯', py: 'pu', freq: 68 }, { ch: '讣', py: 'fu', freq: 68 }, { ch: '圭', py: 'gui', freq: 68 }, { ch: '桂', py: 'gui', freq: 68 },
  { ch: '柜', py: 'gui', freq: 68 }, { ch: '韩', py: 'han', freq: 68 }, { ch: '含', py: 'han', freq: 68 }, { ch: '恨', py: 'hen', freq: 68 }, { ch: '脊', py: 'ji', freq: 68 }, { ch: '寂', py: 'ji', freq: 68 },
  { ch: '健', py: 'jian', freq: 68 }, { ch: '嚼', py: 'jue', freq: 68 }, { ch: '井', py: 'jing', freq: 68 }, { ch: '鞠', py: 'ju', freq: 68 }, { ch: '菊', py: 'ju', freq: 68 }, { ch: '局', py: 'ju', freq: 68 },
  { ch: '浚', py: 'jun', freq: 68 }, { ch: '郡', py: 'jun', freq: 68 }, { ch: '肯', py: 'ken', freq: 68 }, { ch: '奎', py: 'kui', freq: 68 }, { ch: '馈', py: 'kui', freq: 68 }, { ch: '缆', py: 'lan', freq: 68 },
  { ch: '榔', py: 'lang', freq: 68 }, { ch: '郎', py: 'lang', freq: 68 }, { ch: '姥', py: 'lao', freq: 68 }, { ch: '傈', py: 'li', freq: 68 }, { ch: '链', py: 'lian', freq: 68 }, { ch: '燎', py: 'liao', freq: 68 },
  { ch: '邻', py: 'lin', freq: 68 }, { ch: '垄', py: 'long', freq: 68 }, { ch: '抡', py: 'lun', freq: 68 }, { ch: '箩', py: 'luo', freq: 68 }, { ch: '漫', py: 'man', freq: 68 }, { ch: '貌', py: 'mao', freq: 68 },
  { ch: '镁', py: 'mei', freq: 68 }, { ch: '匿', py: 'ni', freq: 68 }, { ch: '藕', py: 'ou', freq: 68 }, { ch: '攀', py: 'pan', freq: 68 }, { ch: '佩', py: 'pei', freq: 68 }, { ch: '瓢', py: 'piao', freq: 68 },
  { ch: '婆', py: 'po', freq: 68 }, { ch: '仆', py: 'pu', freq: 68 }, { ch: '普', py: 'pu', freq: 68 }, { ch: '岂', py: 'qi', freq: 68 }, { ch: '泣', py: 'qi', freq: 68 }, { ch: '巧', py: 'qiao', freq: 68 },
  { ch: '峭', py: 'qiao', freq: 68 }, { ch: '琼', py: 'qiong', freq: 68 }, { ch: '邱', py: 'qiu', freq: 68 }, { ch: '榷', py: 'que', freq: 68 }, { ch: '蓉', py: 'rong', freq: 68 }, { ch: '尚', py: 'shang', freq: 68 },
  { ch: '绍', py: 'shao', freq: 68 }, { ch: '绅', py: 'shen', freq: 68 }, { ch: '恃', py: 'shi', freq: 68 }, { ch: '耸', py: 'song', freq: 68 }, { ch: '俗', py: 'su', freq: 68 }, { ch: '坍', py: 'tan', freq: 68 },
  { ch: '塘', py: 'tang', freq: 68 }, { ch: '糖', py: 'tang', freq: 68 }, { ch: '陶', py: 'tao', freq: 68 }, { ch: '眺', py: 'tiao', freq: 68 }, { ch: '托', py: 'tuo', freq: 68 }, { ch: '卧', py: 'wo', freq: 68 },
  { ch: '嫌', py: 'xian', freq: 68 }, { ch: '腺', py: 'xian', freq: 68 }, { ch: '腥', py: 'xing', freq: 68 }, { ch: '行', py: 'xing', freq: 68 }, { ch: '熊', py: 'xiong', freq: 68 }, { ch: '训', py: 'xun', freq: 68 },
  { ch: '阉', py: 'yan', freq: 68 }, { ch: '燕', py: 'yan', freq: 68 }, { ch: '雁', py: 'yan', freq: 68 }, { ch: '佯', py: 'yang', freq: 68 }, { ch: '摇', py: 'yao', freq: 68 }, { ch: '姚', py: 'yao', freq: 68 },
  { ch: '逸', py: 'yi', freq: 68 }, { ch: '意', py: 'yi', freq: 68 }, { ch: '右', py: 'you', freq: 68 }, { ch: '誉', py: 'yu', freq: 68 }, { ch: '凿', py: 'zao', freq: 68 }, { ch: '蚤', py: 'zao', freq: 68 },
  { ch: '赠', py: 'zeng', freq: 68 }, { ch: '摘', py: 'zhai', freq: 68 }, { ch: '沾', py: 'zhan', freq: 68 }, { ch: '涨', py: 'zhang', freq: 68 }, { ch: '珍', py: 'zhen', freq: 68 }, { ch: '怔', py: 'zheng', freq: 68 },
  { ch: '政', py: 'zheng', freq: 68 }, { ch: '症', py: 'zheng', freq: 68 }, { ch: '著', py: 'zhu', freq: 68 }, { ch: '啄', py: 'zhuo', freq: 68 }, { ch: '啊', py: 'a', freq: 67 }, { ch: '矮', py: 'ai', freq: 67 },
  { ch: '坝', py: 'ba', freq: 67 }, { ch: '鲍', py: 'bao', freq: 67 }, { ch: '宾', py: 'bin', freq: 67 }, { ch: '舶', py: 'bo', freq: 67 }, { ch: '捕', py: 'bu', freq: 67 }, { ch: '踩', py: 'cai', freq: 67 },
  { ch: '层', py: 'ceng', freq: 67 }, { ch: '岔', py: 'cha', freq: 67 }, { ch: '铲', py: 'chan', freq: 67 }, { ch: '忱', py: 'chen', freq: 67 }, { ch: '迟', py: 'chi', freq: 67 }, { ch: '丑', py: 'chou', freq: 67 },
  { ch: '窜', py: 'cuan', freq: 67 }, { ch: '怠', py: 'dai', freq: 67 }, { ch: '堤', py: 'di', freq: 67 }, { ch: '碟', py: 'die', freq: 67 }, { ch: '杜', py: 'du', freq: 67 }, { ch: '厄', py: 'e', freq: 67 },
  { ch: '繁', py: 'fan', freq: 67 }, { ch: '范', py: 'fan', freq: 67 }, { ch: '方', py: 'fang', freq: 67 }, { ch: '仿', py: 'fang', freq: 67 }, { ch: '访', py: 'fang', freq: 67 }, { ch: '啡', py: 'fei', freq: 67 },
  { ch: '匪', py: 'fei', freq: 67 }, { ch: '氛', py: 'fen', freq: 67 }, { ch: '甫', py: 'fu', freq: 67 }, { ch: '辅', py: 'fu', freq: 67 }, { ch: '钙', py: 'gai', freq: 67 }, { ch: '杆', py: 'gan', freq: 67 },
  { ch: '耿', py: 'geng', freq: 67 }, { ch: '勾', py: 'gou', freq: 67 }, { ch: '估', py: 'gu', freq: 67 }, { ch: '乖', py: 'guai', freq: 67 }, { ch: '跪', py: 'gui', freq: 67 }, { ch: '阂', py: 'he', freq: 67 },
  { ch: '宏', py: 'hong', freq: 67 }, { ch: '晦', py: 'hui', freq: 67 }, { ch: '获', py: 'huo', freq: 67 }, { ch: '货', py: 'huo', freq: 67 }, { ch: '夹', py: 'jia', freq: 67 }, { ch: '剑', py: 'jian', freq: 67 },
  { ch: '渐', py: 'jian', freq: 67 }, { ch: '僵', py: 'jiang', freq: 67 }, { ch: '奖', py: 'jiang', freq: 67 }, { ch: '缴', py: 'jiao', freq: 67 }, { ch: '距', py: 'ju', freq: 67 }, { ch: '锯', py: 'ju', freq: 67 },
  { ch: '堪', py: 'kan', freq: 67 }, { ch: '垮', py: 'kua', freq: 67 }, { ch: '筷', py: 'kuai', freq: 67 }, { ch: '匡', py: 'kuang', freq: 67 }, { ch: '擂', py: 'lei', freq: 67 }, { ch: '伶', py: 'ling', freq: 67 },
  { ch: '咙', py: 'long', freq: 67 }, { ch: '笼', py: 'long', freq: 67 }, { ch: '虏', py: 'lu', freq: 67 }, { ch: '旅', py: 'lv', freq: 67 }, { ch: '蛮', py: 'man', freq: 67 }, { ch: '冒', py: 'mao', freq: 67 },
  { ch: '昧', py: 'mei', freq: 67 }, { ch: '泌', py: 'mi', freq: 67 }, { ch: '狞', py: 'ning', freq: 67 }, { ch: '拧', py: 'ning', freq: 67 }, { ch: '奴', py: 'nu', freq: 67 }, { ch: '拍', py: 'pai', freq: 67 },
  { ch: '沛', py: 'pei', freq: 67 }, { ch: '撇', py: 'pie', freq: 67 }, { ch: '魄', py: 'po', freq: 67 }, { ch: '铺', py: 'pu', freq: 67 }, { ch: '期', py: 'qi', freq: 67 }, { ch: '戚', py: 'qi', freq: 67 },
  { ch: '崎', py: 'qi', freq: 67 }, { ch: '骑', py: 'qi', freq: 67 }, { ch: '仟', py: 'qian', freq: 67 }, { ch: '谴', py: 'qian', freq: 67 }, { ch: '腔', py: 'qiang', freq: 67 }, { ch: '锹', py: 'qiao', freq: 67 },
  { ch: '搔', py: 'sao', freq: 67 }, { ch: '兽', py: 'shou', freq: 67 }, { ch: '嗣', py: 'si', freq: 67 }, { ch: '擞', py: 'sou', freq: 67 }, { ch: '它', py: 'ta', freq: 67 }, { ch: '摊', py: 'tan', freq: 67 },
  { ch: '潭', py: 'tan', freq: 67 }, { ch: '炭', py: 'tan', freq: 67 }, { ch: '躺', py: 'tang', freq: 67 }, { ch: '淌', py: 'tang', freq: 67 }, { ch: '疼', py: 'teng', freq: 67 }, { ch: '剔', py: 'ti', freq: 67 },
  { ch: '啼', py: 'ti', freq: 67 }, { ch: '亭', py: 'ting', freq: 67 }, { ch: '桶', py: 'tong', freq: 67 }, { ch: '筒', py: 'tong', freq: 67 }, { ch: '徒', py: 'tu', freq: 67 }, { ch: '违', py: 'wei', freq: 67 },
  { ch: '稳', py: 'wen', freq: 67 }, { ch: '呜', py: 'wu', freq: 67 }, { ch: '惜', py: 'xi', freq: 67 }, { ch: '虾', py: 'xia', freq: 67 }, { ch: '馅', py: 'xian', freq: 67 }, { ch: '镶', py: 'xiang', freq: 67 },
  { ch: '萧', py: 'xiao', freq: 67 }, { ch: '啸', py: 'xiao', freq: 67 }, { ch: '悬', py: 'xuan', freq: 67 }, { ch: '绚', py: 'xuan', freq: 67 }, { ch: '雅', py: 'ya', freq: 67 }, { ch: '疡', py: 'yang', freq: 67 },
  { ch: '叶', py: 'ye', freq: 67 }, { ch: '亦', py: 'yi', freq: 67 }, { ch: '茵', py: 'yin', freq: 67 }, { ch: '殷', py: 'yin', freq: 67 }, { ch: '硬', py: 'ying', freq: 67 }, { ch: '邮', py: 'you', freq: 67 },
  { ch: '逾', py: 'yu', freq: 67 }, { ch: '援', py: 'yuan', freq: 67 }, { ch: '缘', py: 'yuan', freq: 67 }, { ch: '匝', py: 'za', freq: 67 }, { ch: '栽', py: 'zai', freq: 67 }, { ch: '脏', py: 'zang', freq: 67 },
  { ch: '择', py: 'ze', freq: 67 }, { ch: '渣', py: 'zha', freq: 67 }, { ch: '咋', py: 'za', freq: 67 }, { ch: '诈', py: 'zha', freq: 67 }, { ch: '章', py: 'zhang', freq: 67 }, { ch: '折', py: 'zhe', freq: 67 },
  { ch: '贞', py: 'zhen', freq: 67 }, { ch: '汁', py: 'zhi', freq: 67 }, { ch: '织', py: 'zhi', freq: 67 }, { ch: '滋', py: 'zi', freq: 67 }, { ch: '紫', py: 'zi', freq: 67 }, { ch: '揍', py: 'zou', freq: 67 },
  { ch: '岸', py: 'an', freq: 66 }, { ch: '跋', py: 'ba', freq: 66 }, { ch: '佰', py: 'bai', freq: 66 }, { ch: '邦', py: 'bang', freq: 66 }, { ch: '冰', py: 'bing', freq: 66 }, { ch: '槽', py: 'cao', freq: 66 },
  { ch: '长', py: 'zhang', freq: 66 }, { ch: '肠', py: 'chang', freq: 66 }, { ch: '敞', py: 'chang', freq: 66 }, { ch: '澄', py: 'cheng', freq: 66 }, { ch: '橱', py: 'chu', freq: 66 }, { ch: '滇', py: 'dian', freq: 66 },
  { ch: '迭', py: 'die', freq: 66 }, { ch: '斗', py: 'dou', freq: 66 }, { ch: '诽', py: 'fei', freq: 66 }, { ch: '芬', py: 'fen', freq: 66 }, { ch: '汾', py: 'fen', freq: 66 }, { ch: '粉', py: 'fen', freq: 66 },
  { ch: '忿', py: 'fen', freq: 66 }, { ch: '愤', py: 'fen', freq: 66 }, { ch: '锋', py: 'feng', freq: 66 }, { ch: '讽', py: 'feng', freq: 66 }, { ch: '敷', py: 'fu', freq: 66 }, { ch: '弗', py: 'fu', freq: 66 },
  { ch: '釜', py: 'fu', freq: 66 }, { ch: '斧', py: 'fu', freq: 66 }, { ch: '阜', py: 'fu', freq: 66 }, { ch: '赶', py: 'gan', freq: 66 }, { ch: '岗', py: 'gang', freq: 66 }, { ch: '弓', py: 'gong', freq: 66 },
  { ch: '骨', py: 'gu', freq: 66 }, { ch: '硅', py: 'gui', freq: 66 }, { ch: '郝', py: 'hao', freq: 66 }, { ch: '菏', py: 'he', freq: 66 }, { ch: '核', py: 'he', freq: 66 }, { ch: '贺', py: 'he', freq: 66 },
  { ch: '痕', py: 'hen', freq: 66 }, { ch: '瑚', py: 'hu', freq: 66 }, { ch: '惠', py: 'hui', freq: 66 }, { ch: '讳', py: 'hui', freq: 66 }, { ch: '贾', py: 'jia', freq: 66 }, { ch: '箭', py: 'jian', freq: 66 },
  { ch: '礁', py: 'jiao', freq: 66 }, { ch: '娇', py: 'jiao', freq: 66 }, { ch: '睫', py: 'jie', freq: 66 }, { ch: '鲸', py: 'jing', freq: 66 }, { ch: '经', py: 'jing', freq: 66 }, { ch: '炯', py: 'jiong', freq: 66 },
  { ch: '厩', py: 'jiu', freq: 66 }, { ch: '疚', py: 'jiu', freq: 66 }, { ch: '咯', py: 'ge', freq: 66 }, { ch: '炕', py: 'kang', freq: 66 }, { ch: '颗', py: 'ke', freq: 66 }, { ch: '咳', py: 'ke', freq: 66 },
  { ch: '隶', py: 'li', freq: 66 }, { ch: '涟', py: 'lian', freq: 66 }, { ch: '撩', py: 'liao', freq: 66 }, { ch: '吝', py: 'lin', freq: 66 }, { ch: '零', py: 'ling', freq: 66 }, { ch: '屡', py: 'lv', freq: 66 },
  { ch: '馒', py: 'man', freq: 66 }, { ch: '谜', py: 'mi', freq: 66 }, { ch: '幂', py: 'mi', freq: 66 }, { ch: '免', py: 'mian', freq: 66 }, { ch: '藐', py: 'miao', freq: 66 }, { ch: '墓', py: 'mu', freq: 66 },
  { ch: '睦', py: 'mu', freq: 66 }, { ch: '牧', py: 'mu', freq: 66 }, { ch: '努', py: 'nu', freq: 66 }, { ch: '陪', py: 'pei', freq: 66 }, { ch: '匹', py: 'pi', freq: 66 }, { ch: '谦', py: 'qian', freq: 66 },
  { ch: '钳', py: 'qian', freq: 66 }, { ch: '渠', py: 'qu', freq: 66 }, { ch: '嚷', py: 'rang', freq: 66 }, { ch: '揉', py: 'rou', freq: 66 }, { ch: '扫', py: 'sao', freq: 66 }, { ch: '涩', py: 'se', freq: 66 },
  { ch: '砂', py: 'sha', freq: 66 }, { ch: '删', py: 'shan', freq: 66 }, { ch: '煽', py: 'shan', freq: 66 }, { ch: '缮', py: 'shan', freq: 66 }, { ch: '噬', py: 'shi', freq: 66 }, { ch: '守', py: 'shou', freq: 66 },
  { ch: '竖', py: 'shu', freq: 66 }, { ch: '烁', py: 'shuo', freq: 66 }, { ch: '饲', py: 'si', freq: 66 }, { ch: '泰', py: 'tai', freq: 66 }, { ch: '汰', py: 'tai', freq: 66 }, { ch: '锑', py: 'ti', freq: 66 },
  { ch: '头', py: 'tou', freq: 66 }, { ch: '团', py: 'tuan', freq: 66 }, { ch: '鸵', py: 'tuo', freq: 66 }, { ch: '苇', py: 'wei', freq: 66 }, { ch: '渭', py: 'wei', freq: 66 }, { ch: '蚊', py: 'wen', freq: 66 },
  { ch: '屋', py: 'wu', freq: 66 }, { ch: '吸', py: 'xi', freq: 66 }, { ch: '铣', py: 'xi', freq: 66 }, { ch: '咸', py: 'xian', freq: 66 }, { ch: '旭', py: 'xu', freq: 66 }, { ch: '旬', py: 'xun', freq: 66 },
  { ch: '丫', py: 'ya', freq: 66 }, { ch: '芽', py: 'ya', freq: 66 }, { ch: '蜒', py: 'yan', freq: 66 }, { ch: '掖', py: 'ye', freq: 66 }, { ch: '谊', py: 'yi', freq: 66 }, { ch: '荫', py: 'yin', freq: 66 },
  { ch: '映', py: 'ying', freq: 66 }, { ch: '痈', py: 'yong', freq: 66 }, { ch: '忧', py: 'you', freq: 66 }, { ch: '尤', py: 'you', freq: 66 }, { ch: '渔', py: 'yu', freq: 66 }, { ch: '羽', py: 'yu', freq: 66 },
  { ch: '垣', py: 'yuan', freq: 66 }, { ch: '苑', py: 'yuan', freq: 66 }, { ch: '郧', py: 'yun', freq: 66 }, { ch: '障', py: 'zhang', freq: 66 }, { ch: '辙', py: 'zhe', freq: 66 }, { ch: '斟', py: 'zhen', freq: 66 },
  { ch: '狰', py: 'zheng', freq: 66 }, { ch: '值', py: 'zhi', freq: 66 }, { ch: '痔', py: 'zhi', freq: 66 }, { ch: '滞', py: 'zhi', freq: 66 }, { ch: '衷', py: 'zhong', freq: 66 }, { ch: '拽', py: 'zhuai', freq: 66 },
  { ch: '椎', py: 'chui', freq: 66 }, { ch: '拙', py: 'zhuo', freq: 66 }, { ch: '遵', py: 'zun', freq: 66 }, { ch: '氨', py: 'an', freq: 65 }, { ch: '版', py: 'ban', freq: 65 }, { ch: '蓖', py: 'bi', freq: 65 },
  { ch: '标', py: 'biao', freq: 65 }, { ch: '憋', py: 'bie', freq: 65 }, { ch: '柄', py: 'bing', freq: 65 }, { ch: '秉', py: 'bing', freq: 65 }, { ch: '菠', py: 'bo', freq: 65 }, { ch: '驳', py: 'bo', freq: 65 },
  { ch: '擦', py: 'ca', freq: 65 }, { ch: '猜', py: 'cai', freq: 65 }, { ch: '灿', py: 'can', freq: 65 }, { ch: '策', py: 'ce', freq: 65 }, { ch: '衬', py: 'chen', freq: 65 }, { ch: '呈', py: 'cheng', freq: 65 },
  { ch: '唇', py: 'chun', freq: 65 }, { ch: '刺', py: 'ci', freq: 65 }, { ch: '篡', py: 'cuan', freq: 65 }, { ch: '傣', py: 'dai', freq: 65 }, { ch: '旦', py: 'dan', freq: 65 }, { ch: '靛', py: 'dian', freq: 65 },
  { ch: '堆', py: 'dui', freq: 65 }, { ch: '遏', py: 'e', freq: 65 }, { ch: '鄂', py: 'e', freq: 65 }, { ch: '儿', py: 'er', freq: 65 }, { ch: '翻', py: 'fan', freq: 65 }, { ch: '付', py: 'fu', freq: 65 },
  { ch: '胳', py: 'ge', freq: 65 }, { ch: '个', py: 'ge', freq: 65 }, { ch: '雇', py: 'gu', freq: 65 }, { ch: '褂', py: 'gua', freq: 65 }, { ch: '癸', py: 'gui', freq: 65 }, { ch: '锅', py: 'guo', freq: 65 },
  { ch: '骇', py: 'hai', freq: 65 }, { ch: '函', py: 'han', freq: 65 }, { ch: '捍', py: 'han', freq: 65 }, { ch: '焊', py: 'han', freq: 65 }, { ch: '盒', py: 'he', freq: 65 }, { ch: '互', py: 'hu', freq: 65 },
  { ch: '划', py: 'hua', freq: 65 }, { ch: '缓', py: 'huan', freq: 65 }, { ch: '慌', py: 'huang', freq: 65 }, { ch: '辉', py: 'hui', freq: 65 }, { ch: '回', py: 'hui', freq: 65 }, { ch: '烩', py: 'hui', freq: 65 },
  { ch: '魂', py: 'hun', freq: 65 }, { ch: '混', py: 'hun', freq: 65 }, { ch: '嫉', py: 'ji', freq: 65 }, { ch: '挤', py: 'ji', freq: 65 }, { ch: '佳', py: 'jia', freq: 65 }, { ch: '硷', py: 'jian', freq: 65 },
  { ch: '竭', py: 'jie', freq: 65 }, { ch: '景', py: 'jing', freq: 65 }, { ch: '沮', py: 'ju', freq: 65 }, { ch: '巨', py: 'ju', freq: 65 }, { ch: '诀', py: 'jue', freq: 65 }, { ch: '咖', py: 'ka', freq: 65 },
  { ch: '寇', py: 'kou', freq: 65 }, { ch: '赖', py: 'lai', freq: 65 }, { ch: '镰', py: 'lian', freq: 65 }, { ch: '怜', py: 'lian', freq: 65 }, { ch: '恋', py: 'lian', freq: 65 }, { ch: '潦', py: 'lao', freq: 65 },
  { ch: '霖', py: 'lin', freq: 65 }, { ch: '溜', py: 'liu', freq: 65 }, { ch: '庐', py: 'lu', freq: 65 }, { ch: '潞', py: 'lu', freq: 65 }, { ch: '禄', py: 'lu', freq: 65 }, { ch: '螺', py: 'luo', freq: 65 },
  { ch: '莽', py: 'mang', freq: 65 }, { ch: '盟', py: 'meng', freq: 65 }, { ch: '瞄', py: 'miao', freq: 65 }, { ch: '妙', py: 'miao', freq: 65 }, { ch: '抹', py: 'mo', freq: 65 }, { ch: '牛', py: 'niu', freq: 65 },
  { ch: '沤', py: 'ou', freq: 65 }, { ch: '畔', py: 'pan', freq: 65 }, { ch: '坯', py: 'pi', freq: 65 }, { ch: '凄', py: 'qi', freq: 65 }, { ch: '钎', py: 'qian', freq: 65 }, { ch: '欠', py: 'qian', freq: 65 },
  { ch: '羌', py: 'qiang', freq: 65 }, { ch: '蔷', py: 'qiang', freq: 65 }, { ch: '瞧', py: 'qiao', freq: 65 }, { ch: '乔', py: 'qiao', freq: 65 }, { ch: '囚', py: 'qiu', freq: 65 }, { ch: '屈', py: 'qu', freq: 65 },
  { ch: '刃', py: 'ren', freq: 65 }, { ch: '熔', py: 'rong', freq: 65 }, { ch: '褥', py: 'ru', freq: 65 }, { ch: '赊', py: 'she', freq: 65 }, { ch: '射', py: 'she', freq: 65 }, { ch: '申', py: 'shen', freq: 65 },
  { ch: '审', py: 'shen', freq: 65 }, { ch: '婶', py: 'shen', freq: 65 }, { ch: '爽', py: 'shuang', freq: 65 }, { ch: '素', py: 'su', freq: 65 }, { ch: '锁', py: 'suo', freq: 65 }, { ch: '袒', py: 'tan', freq: 65 },
  { ch: '涛', py: 'tao', freq: 65 }, { ch: '酮', py: 'tong', freq: 65 }, { ch: '吐', py: 'tu', freq: 65 }, { ch: '哇', py: 'wa', freq: 65 }, { ch: '豌', py: 'wan', freq: 65 }, { ch: '胃', py: 'wei', freq: 65 },
  { ch: '位', py: 'wei', freq: 65 }, { ch: '尉', py: 'wei', freq: 65 }, { ch: '诬', py: 'wu', freq: 65 }, { ch: '毋', py: 'wu', freq: 65 }, { ch: '戊', py: 'wu', freq: 65 }, { ch: '勿', py: 'wu', freq: 65 },
  { ch: '霞', py: 'xia', freq: 65 }, { ch: '掀', py: 'xian', freq: 65 }, { ch: '效', py: 'xiao', freq: 65 }, { ch: '欣', py: 'xin', freq: 65 }, { ch: '辛', py: 'xin', freq: 65 }, { ch: '姓', py: 'xing', freq: 65 },
  { ch: '锈', py: 'xiu', freq: 65 }, { ch: '玄', py: 'xuan', freq: 65 }, { ch: '寻', py: 'xun', freq: 65 }, { ch: '汛', py: 'xun', freq: 65 }, { ch: '哑', py: 'ya', freq: 65 }, { ch: '奄', py: 'yan', freq: 65 },
  { ch: '砚', py: 'yan', freq: 65 }, { ch: '铱', py: 'yi', freq: 65 }, { ch: '伊', py: 'yi', freq: 65 }, { ch: '忆', py: 'yi', freq: 65 }, { ch: '寅', py: 'yin', freq: 65 }, { ch: '渝', py: 'yu', freq: 65 },
  { ch: '屿', py: 'yu', freq: 65 }, { ch: '驭', py: 'yu', freq: 65 }, { ch: '渊', py: 'yuan', freq: 65 }, { ch: '怨', py: 'yuan', freq: 65 }, { ch: '曰', py: 'yue', freq: 65 }, { ch: '燥', py: 'zao', freq: 65 },
  { ch: '泽', py: 'ze', freq: 65 }, { ch: '喳', py: 'zha', freq: 65 }, { ch: '诊', py: 'zhen', freq: 65 }, { ch: '职', py: 'zhi', freq: 65 }, { ch: '置', py: 'zhi', freq: 65 }, { ch: '窒', py: 'zhi', freq: 65 },
  { ch: '缀', py: 'zhui', freq: 65 }, { ch: '族', py: 'zu', freq: 65 }, { ch: '唉', py: 'ai', freq: 64 }, { ch: '爱', py: 'ai', freq: 64 }, { ch: '暗', py: 'an', freq: 64 }, { ch: '胺', py: 'an', freq: 64 },
  { ch: '澳', py: 'ao', freq: 64 }, { ch: '败', py: 'bai', freq: 64 }, { ch: '胞', py: 'bao', freq: 64 }, { ch: '泵', py: 'beng', freq: 64 }, { ch: '炳', py: 'bing', freq: 64 }, { ch: '卜', py: 'bo', freq: 64 },
  { ch: '怖', py: 'bu', freq: 64 }, { ch: '裁', py: 'cai', freq: 64 }, { ch: '彩', py: 'cai', freq: 64 }, { ch: '蚕', py: 'can', freq: 64 }, { ch: '苍', py: 'cang', freq: 64 }, { ch: '豺', py: 'chai', freq: 64 },
  { ch: '阐', py: 'chan', freq: 64 }, { ch: '郴', py: 'chen', freq: 64 }, { ch: '池', py: 'chi', freq: 64 }, { ch: '冲', py: 'chong', freq: 64 }, { ch: '宠', py: 'chong', freq: 64 }, { ch: '抽', py: 'chou', freq: 64 },
  { ch: '筹', py: 'chou', freq: 64 }, { ch: '船', py: 'chuan', freq: 64 }, { ch: '淳', py: 'chun', freq: 64 }, { ch: '绰', py: 'chuo', freq: 64 }, { ch: '赐', py: 'ci', freq: 64 }, { ch: '瘁', py: 'cui', freq: 64 },
  { ch: '丁', py: 'ding', freq: 64 }, { ch: '犊', py: 'du', freq: 64 }, { ch: '妒', py: 'du', freq: 64 }, { ch: '端', py: 'duan', freq: 64 }, { ch: '段', py: 'duan', freq: 64 }, { ch: '分', py: 'fen', freq: 64 },
  { ch: '傅', py: 'fu', freq: 64 }, { ch: '革', py: 'ge', freq: 64 }, { ch: '羹', py: 'geng', freq: 64 }, { ch: '拱', py: 'gong', freq: 64 }, { ch: '辜', py: 'gu', freq: 64 }, { ch: '拐', py: 'guai', freq: 64 },
  { ch: '罐', py: 'guan', freq: 64 }, { ch: '夯', py: 'hang', freq: 64 }, { ch: '荷', py: 'he', freq: 64 }, { ch: '狠', py: 'hen', freq: 64 }, { ch: '喉', py: 'hou', freq: 64 }, { ch: '环', py: 'huan', freq: 64 },
  { ch: '磺', py: 'huang', freq: 64 }, { ch: '晃', py: 'huang', freq: 64 }, { ch: '挥', py: 'hui', freq: 64 }, { ch: '击', py: 'ji', freq: 64 }, { ch: '棘', py: 'ji', freq: 64 }, { ch: '辑', py: 'ji', freq: 64 },
  { ch: '急', py: 'ji', freq: 64 }, { ch: '桨', py: 'jiang', freq: 64 }, { ch: '铰', py: 'jiao', freq: 64 }, { ch: '皆', py: 'jie', freq: 64 }, { ch: '揪', py: 'jiu', freq: 64 }, { ch: '抉', py: 'jue', freq: 64 },
  { ch: '楷', py: 'kai', freq: 64 }, { ch: '扣', py: 'kou', freq: 64 }, { ch: '枯', py: 'ku', freq: 64 }, { ch: '溃', py: 'kui', freq: 64 }, { ch: '老', py: 'lao', freq: 64 }, { ch: '漓', py: 'li', freq: 64 },
  { ch: '励', py: 'li', freq: 64 }, { ch: '璃', py: 'li', freq: 64 }, { ch: '猎', py: 'lie', freq: 64 }, { ch: '陆', py: 'lu', freq: 64 }, { ch: '埋', py: 'mai', freq: 64 }, { ch: '眯', py: 'mi', freq: 64 },
  { ch: '醚', py: 'mi', freq: 64 }, { ch: '耐', py: 'nai', freq: 64 }, { ch: '钮', py: 'niu', freq: 64 }, { ch: '懦', py: 'nuo', freq: 64 }, { ch: '爬', py: 'pa', freq: 64 }, { ch: '赔', py: 'pei', freq: 64 },
  { ch: '膨', py: 'peng', freq: 64 }, { ch: '迫', py: 'po', freq: 64 }, { ch: '扑', py: 'pu', freq: 64 }, { ch: '窃', py: 'qie', freq: 64 }, { ch: '寝', py: 'qin', freq: 64 }, { ch: '顷', py: 'qing', freq: 64 },
  { ch: '纫', py: 'ren', freq: 64 }, { ch: '晌', py: 'shang', freq: 64 }, { ch: '甩', py: 'shuai', freq: 64 }, { ch: '速', py: 'su', freq: 64 }, { ch: '淘', py: 'tao', freq: 64 }, { ch: '挑', py: 'tiao', freq: 64 },
  { ch: '迢', py: 'tiao', freq: 64 }, { ch: '跳', py: 'tiao', freq: 64 }, { ch: '妄', py: 'wang', freq: 64 }, { ch: '巍', py: 'wei', freq: 64 }, { ch: '芜', py: 'wu', freq: 64 }, { ch: '凶', py: 'xiong', freq: 64 },
  { ch: '墟', py: 'xu', freq: 64 }, { ch: '婿', py: 'xu', freq: 64 }, { ch: '轩', py: 'xuan', freq: 64 }, { ch: '靴', py: 'xue', freq: 64 }, { ch: '衙', py: 'ya', freq: 64 }, { ch: '咽', py: 'yan', freq: 64 },
  { ch: '盐', py: 'yan', freq: 64 }, { ch: '岩', py: 'yan', freq: 64 }, { ch: '堰', py: 'yan', freq: 64 }, { ch: '漾', py: 'yang', freq: 64 }, { ch: '腰', py: 'yao', freq: 64 }, { ch: '移', py: 'yi', freq: 64 },
  { ch: '邑', py: 'yi', freq: 64 }, { ch: '俞', py: 'yu', freq: 64 }, { ch: '愉', py: 'yu', freq: 64 }, { ch: '鸳', py: 'yuan', freq: 64 }, { ch: '闸', py: 'zha', freq: 64 }, { ch: '丈', py: 'zhang', freq: 64 },
  { ch: '砧', py: 'zhen', freq: 64 }, { ch: '郑', py: 'zheng', freq: 64 }, { ch: '证', py: 'zheng', freq: 64 }, { ch: '支', py: 'zhi', freq: 64 }, { ch: '赘', py: 'zhui', freq: 64 }, { ch: '挨', py: 'ai', freq: 63 },
  { ch: '抱', py: 'bao', freq: 63 }, { ch: '背', py: 'bei', freq: 63 }, { ch: '膘', py: 'biao', freq: 63 }, { ch: '勃', py: 'bo', freq: 63 }, { ch: '哺', py: 'bu', freq: 63 }, { ch: '猖', py: 'chang', freq: 63 },
  { ch: '逞', py: 'cheng', freq: 63 }, { ch: '喘', py: 'chuan', freq: 63 }, { ch: '醋', py: 'cu', freq: 63 }, { ch: '担', py: 'dan', freq: 63 }, { ch: '氮', py: 'dan', freq: 63 }, { ch: '淡', py: 'dan', freq: 63 },
  { ch: '挡', py: 'dang', freq: 63 }, { ch: '蝶', py: 'die', freq: 63 }, { ch: '兑', py: 'dui', freq: 63 }, { ch: '墩', py: 'dun', freq: 63 }, { ch: '敦', py: 'dun', freq: 63 }, { ch: '樊', py: 'fan', freq: 63 },
  { ch: '废', py: 'fei', freq: 63 }, { ch: '沸', py: 'fei', freq: 63 }, { ch: '烽', py: 'feng', freq: 63 }, { ch: '抚', py: 'fu', freq: 63 }, { ch: '鸽', py: 'ge', freq: 63 }, { ch: '给', py: 'gei', freq: 63 },
  { ch: '咕', py: 'gu', freq: 63 }, { ch: '固', py: 'gu', freq: 63 }, { ch: '寡', py: 'gua', freq: 63 }, { ch: '冠', py: 'guan', freq: 63 }, { ch: '很', py: 'hen', freq: 63 }, { ch: '猾', py: 'hua', freq: 63 },
  { ch: '淮', py: 'huai', freq: 63 }, { ch: '患', py: 'huan', freq: 63 }, { ch: '恍', py: 'huang', freq: 63 }, { ch: '讥', py: 'ji', freq: 63 }, { ch: '甲', py: 'jia', freq: 63 }, { ch: '镜', py: 'jing', freq: 63 },
  { ch: '疽', py: 'ju', freq: 63 }, { ch: '炬', py: 'ju', freq: 63 }, { ch: '峻', py: 'jun', freq: 63 }, { ch: '哭', py: 'ku', freq: 63 }, { ch: '喇', py: 'la', freq: 63 }, { ch: '蜡', py: 'la', freq: 63 },
  { ch: '狼', py: 'lang', freq: 63 }, { ch: '朗', py: 'lang', freq: 63 }, { ch: '犁', py: 'li', freq: 63 }, { ch: '谅', py: 'liang', freq: 63 }, { ch: '卢', py: 'lu', freq: 63 }, { ch: '露', py: 'lu', freq: 63 },
  { ch: '鹿', py: 'lu', freq: 63 }, { ch: '蔓', py: 'man', freq: 63 }, { ch: '茫', py: 'mang', freq: 63 }, { ch: '梅', py: 'mei', freq: 63 }, { ch: '灭', py: 'mie', freq: 63 }, { ch: '牡', py: 'mu', freq: 63 },
  { ch: '募', py: 'mu', freq: 63 }, { ch: '哦', py: 'o', freq: 63 }, { ch: '咆', py: 'pao', freq: 63 }, { ch: '抨', py: 'peng', freq: 63 }, { ch: '彭', py: 'peng', freq: 63 }, { ch: '鹏', py: 'peng', freq: 63 },
  { ch: '篇', py: 'pian', freq: 63 }, { ch: '齐', py: 'qi', freq: 63 }, { ch: '汽', py: 'qi', freq: 63 }, { ch: '芹', py: 'qin', freq: 63 }, { ch: '炔', py: 'gui', freq: 63 }, { ch: '惹', py: 're', freq: 63 },
  { ch: '茹', py: 'ru', freq: 63 }, { ch: '僧', py: 'seng', freq: 63 }, { ch: '赏', py: 'shang', freq: 63 }, { ch: '授', py: 'shou', freq: 63 }, { ch: '束', py: 'shu', freq: 63 }, { ch: '税', py: 'shui', freq: 63 },
  { ch: '宋', py: 'song', freq: 63 }, { ch: '酥', py: 'su', freq: 63 }, { ch: '谭', py: 'tan', freq: 63 }, { ch: '皖', py: 'wan', freq: 63 }, { ch: '卫', py: 'wei', freq: 63 }, { ch: '涡', py: 'wo', freq: 63 },
  { ch: '乌', py: 'wu', freq: 63 }, { ch: '峡', py: 'xia', freq: 63 }, { ch: '详', py: 'xiang', freq: 63 }, { ch: '硝', py: 'xiao', freq: 63 }, { ch: '汹', py: 'xiong', freq: 63 }, { ch: '嗅', py: 'xiu', freq: 63 },
  { ch: '讶', py: 'ya', freq: 63 }, { ch: '殃', py: 'yang', freq: 63 }, { ch: '壹', py: 'yi', freq: 63 }, { ch: '彝', py: 'yi', freq: 63 }, { ch: '因', py: 'yin', freq: 63 }, { ch: '饮', py: 'yin', freq: 63 },
  { ch: '莹', py: 'ying', freq: 63 }, { ch: '哟', py: 'yo', freq: 63 }, { ch: '优', py: 'you', freq: 63 }, { ch: '油', py: 'you', freq: 63 }, { ch: '宇', py: 'yu', freq: 63 }, { ch: '峪', py: 'yu', freq: 63 },
  { ch: '欲', py: 'yu', freq: 63 }, { ch: '袁', py: 'yuan', freq: 63 }, { ch: '灶', py: 'zao', freq: 63 }, { ch: '湛', py: 'zhan', freq: 63 }, { ch: '锗', py: 'zhe', freq: 63 }, { ch: '肢', py: 'zhi', freq: 63 },
  { ch: '执', py: 'zhi', freq: 63 }, { ch: '止', py: 'zhi', freq: 63 }, { ch: '粥', py: 'zhou', freq: 63 }, { ch: '骤', py: 'zhou', freq: 63 }, { ch: '爪', py: 'zhao', freq: 63 }, { ch: '佐', py: 'zuo', freq: 63 },
  { ch: '罢', py: 'ba', freq: 62 }, { ch: '帮', py: 'bang', freq: 62 }, { ch: '榜', py: 'bang', freq: 62 }, { ch: '绑', py: 'bang', freq: 62 }, { ch: '扁', py: 'bian', freq: 62 }, { ch: '彪', py: 'biao', freq: 62 },
  { ch: '铂', py: 'bo', freq: 62 }, { ch: '泊', py: 'po', freq: 62 }, { ch: '惭', py: 'can', freq: 62 }, { ch: '舱', py: 'cang', freq: 62 }, { ch: '馋', py: 'chan', freq: 62 }, { ch: '吵', py: 'chao', freq: 62 },
  { ch: '陈', py: 'chen', freq: 62 }, { ch: '绸', py: 'chou', freq: 62 }, { ch: '慈', py: 'ci', freq: 62 }, { ch: '递', py: 'di', freq: 62 }, { ch: '董', py: 'dong', freq: 62 }, { ch: '赌', py: 'du', freq: 62 },
  { ch: '法', py: 'fa', freq: 62 }, { ch: '佛', py: 'fu', freq: 62 }, { ch: '覆', py: 'fu', freq: 62 }, { ch: '割', py: 'ge', freq: 62 }, { ch: '蛤', py: 'ha', freq: 62 }, { ch: '汞', py: 'gong', freq: 62 },
  { ch: '轨', py: 'gui', freq: 62 }, { ch: '邯', py: 'han', freq: 62 }, { ch: '翰', py: 'han', freq: 62 }, { ch: '横', py: 'heng', freq: 62 }, { ch: '幻', py: 'huan', freq: 62 }, { ch: '豁', py: 'huo', freq: 62 },
  { ch: '级', py: 'ji', freq: 62 }, { ch: '间', py: 'jian', freq: 62 }, { ch: '拣', py: 'jian', freq: 62 }, { ch: '荐', py: 'jian', freq: 62 }, { ch: '降', py: 'jiang', freq: 62 }, { ch: '骄', py: 'jiao', freq: 62 },
  { ch: '洁', py: 'jie', freq: 62 }, { ch: '拒', py: 'ju', freq: 62 }, { ch: '菌', py: 'jun', freq: 62 }, { ch: '跨', py: 'kua', freq: 62 }, { ch: '栏', py: 'lan', freq: 62 }, { ch: '棱', py: 'leng', freq: 62 },
  { ch: '厘', py: 'li', freq: 62 }, { ch: '俩', py: 'lia', freq: 62 }, { ch: '练', py: 'lian', freq: 62 }, { ch: '拎', py: 'lin', freq: 62 }, { ch: '六', py: 'liu', freq: 62 }, { ch: '漏', py: 'lou', freq: 62 },
  { ch: '纶', py: 'lun', freq: 62 }, { ch: '盲', py: 'mang', freq: 62 }, { ch: '帽', py: 'mao', freq: 62 }, { ch: '闷', py: 'men', freq: 62 }, { ch: '眠', py: 'mian', freq: 62 }, { ch: '名', py: 'ming', freq: 62 },
  { ch: '模', py: 'mo', freq: 62 }, { ch: '娜', py: 'na', freq: 62 }, { ch: '淖', py: 'nao', freq: 62 }, { ch: '倪', py: 'ni', freq: 62 }, { ch: '宁', py: 'ning', freq: 62 }, { ch: '欧', py: 'ou', freq: 62 },
  { ch: '鸥', py: 'ou', freq: 62 }, { ch: '烹', py: 'peng', freq: 62 }, { ch: '飘', py: 'piao', freq: 62 }, { ch: '敲', py: 'qiao', freq: 62 }, { ch: '穷', py: 'qiong', freq: 62 }, { ch: '酋', py: 'qiu', freq: 62 },
  { ch: '龋', py: 'qu', freq: 62 }, { ch: '圈', py: 'quan', freq: 62 }, { ch: '犬', py: 'quan', freq: 62 }, { ch: '乳', py: 'ru', freq: 62 }, { ch: '纱', py: 'sha', freq: 62 }, { ch: '珊', py: 'shan', freq: 62 },
  { ch: '赦', py: 'she', freq: 62 }, { ch: '绳', py: 'sheng', freq: 62 }, { ch: '驶', py: 'shi', freq: 62 }, { ch: '嗜', py: 'shi', freq: 62 }, { ch: '刷', py: 'shua', freq: 62 }, { ch: '巳', py: 'si', freq: 62 },
  { ch: '松', py: 'song', freq: 62 }, { ch: '溯', py: 'su', freq: 62 }, { ch: '痰', py: 'tan', freq: 62 }, { ch: '绦', py: 'tao', freq: 62 }, { ch: '讨', py: 'tao', freq: 62 }, { ch: '凸', py: 'tu', freq: 62 },
  { ch: '韦', py: 'wei', freq: 62 }, { ch: '厦', py: 'sha', freq: 62 }, { ch: '弦', py: 'xian', freq: 62 }, { ch: '献', py: 'xian', freq: 62 }, { ch: '宵', py: 'xiao', freq: 62 }, { ch: '胁', py: 'xie', freq: 62 },
  { ch: '虚', py: 'xu', freq: 62 }, { ch: '烟', py: 'yan', freq: 62 }, { ch: '妖', py: 'yao', freq: 62 }, { ch: '抑', py: 'yi', freq: 62 }, { ch: '缨', py: 'ying', freq: 62 }, { ch: '萤', py: 'ying', freq: 62 },
  { ch: '荧', py: 'ying', freq: 62 }, { ch: '颖', py: 'ying', freq: 62 }, { ch: '臃', py: 'yong', freq: 62 }, { ch: '迂', py: 'yu', freq: 62 }, { ch: '舆', py: 'yu', freq: 62 }, { ch: '跃', py: 'yue', freq: 62 },
  { ch: '悦', py: 'yue', freq: 62 }, { ch: '允', py: 'yun', freq: 62 }, { ch: '孕', py: 'yun', freq: 62 }, { ch: '灾', py: 'zai', freq: 62 }, { ch: '增', py: 'zeng', freq: 62 }, { ch: '掷', py: 'zhi', freq: 62 },
  { ch: '株', py: 'zhu', freq: 62 }, { ch: '贮', py: 'zhu', freq: 62 }, { ch: '追', py: 'zhui', freq: 62 }, { ch: '兹', py: 'zi', freq: 62 }, { ch: '咨', py: 'zi', freq: 62 }, { ch: '邹', py: 'zou', freq: 62 },
  { ch: '昨', py: 'zuo', freq: 62 }, { ch: '俺', py: 'an', freq: 61 }, { ch: '霸', py: 'ba', freq: 61 }, { ch: '柏', py: 'bai', freq: 61 }, { ch: '豹', py: 'bao', freq: 61 }, { ch: '惫', py: 'bei', freq: 61 },
  { ch: '辟', py: 'pi', freq: 61 }, { ch: '茶', py: 'cha', freq: 61 }, { ch: '厂', py: 'chang', freq: 61 }, { ch: '趁', py: 'chen', freq: 61 }, { ch: '撑', py: 'cheng', freq: 61 }, { ch: '齿', py: 'chi', freq: 61 },
  { ch: '幢', py: 'chuang', freq: 61 }, { ch: '茨', py: 'ci', freq: 61 }, { ch: '粗', py: 'cu', freq: 61 }, { ch: '摧', py: 'cui', freq: 61 }, { ch: '粹', py: 'cui', freq: 61 }, { ch: '措', py: 'cuo', freq: 61 },
  { ch: '蹬', py: 'deng', freq: 61 }, { ch: '邓', py: 'deng', freq: 61 }, { ch: '谍', py: 'die', freq: 61 }, { ch: '订', py: 'ding', freq: 61 }, { ch: '恫', py: 'dong', freq: 61 }, { ch: '洞', py: 'dong', freq: 61 },
  { ch: '陡', py: 'dou', freq: 61 }, { ch: '遁', py: 'dun', freq: 61 }, { ch: '扼', py: 'e', freq: 61 }, { ch: '伐', py: 'fa', freq: 61 }, { ch: '藩', py: 'fan', freq: 61 }, { ch: '辐', py: 'fu', freq: 61 },
  { ch: '购', py: 'gou', freq: 61 }, { ch: '沪', py: 'hu', freq: 61 }, { ch: '毁', py: 'hui', freq: 61 }, { ch: '汲', py: 'ji', freq: 61 }, { ch: '煎', py: 'jian', freq: 61 }, { ch: '缄', py: 'jian', freq: 61 },
  { ch: '茧', py: 'jian', freq: 61 }, { ch: '检', py: 'jian', freq: 61 }, { ch: '阶', py: 'jie', freq: 61 }, { ch: '敬', py: 'jing', freq: 61 }, { ch: '拘', py: 'ju', freq: 61 }, { ch: '爵', py: 'jue', freq: 61 },
  { ch: '君', py: 'jun', freq: 61 }, { ch: '垦', py: 'ken', freq: 61 }, { ch: '孔', py: 'kong', freq: 61 }, { ch: '昆', py: 'kun', freq: 61 }, { ch: '莱', py: 'lai', freq: 61 }, { ch: '览', py: 'lan', freq: 61 },
  { ch: '莲', py: 'lian', freq: 61 }, { ch: '撂', py: 'liao', freq: 61 }, { ch: '龙', py: 'long', freq: 61 }, { ch: '碌', py: 'lu', freq: 61 }, { ch: '乱', py: 'luan', freq: 61 }, { ch: '萌', py: 'meng', freq: 61 },
  { ch: '觅', py: 'mi', freq: 61 }, { ch: '墨', py: 'mo', freq: 61 }, { ch: '漠', py: 'mo', freq: 61 }, { ch: '寞', py: 'mo', freq: 61 }, { ch: '泥', py: 'ni', freq: 61 }, { ch: '拈', py: 'nian', freq: 61 },
  { ch: '捻', py: 'nian', freq: 61 }, { ch: '捏', py: 'nie', freq: 61 }, { ch: '凝', py: 'ning', freq: 61 }, { ch: '偶', py: 'ou', freq: 61 }, { ch: '捧', py: 'peng', freq: 61 }, { ch: '霹', py: 'pi', freq: 61 },
  { ch: '朴', py: 'pu', freq: 61 }, { ch: '砌', py: 'qi', freq: 61 }, { ch: '恰', py: 'qia', freq: 61 }, { ch: '黔', py: 'qian', freq: 61 }, { ch: '墙', py: 'qiang', freq: 61 }, { ch: '琴', py: 'qin', freq: 61 },
  { ch: '禽', py: 'qin', freq: 61 }, { ch: '秋', py: 'qiu', freq: 61 }, { ch: '鹊', py: 'que', freq: 61 }, { ch: '染', py: 'ran', freq: 61 }, { ch: '孺', py: 'ru', freq: 61 }, { ch: '锐', py: 'rui', freq: 61 },
  { ch: '伞', py: 'san', freq: 61 }, { ch: '沙', py: 'sha', freq: 61 }, { ch: '稍', py: 'shao', freq: 61 }, { ch: '芍', py: 'shao', freq: 61 }, { ch: '韶', py: 'shao', freq: 61 }, { ch: '蛇', py: 'she', freq: 61 },
  { ch: '慑', py: 'she', freq: 61 }, { ch: '砷', py: 'shen', freq: 61 }, { ch: '省', py: 'sheng', freq: 61 }, { ch: '剩', py: 'sheng', freq: 61 }, { ch: '世', py: 'shi', freq: 61 }, { ch: '誓', py: 'shi', freq: 61 },
  { ch: '寿', py: 'shou', freq: 61 }, { ch: '疏', py: 'shu', freq: 61 }, { ch: '述', py: 'shu', freq: 61 }, { ch: '帅', py: 'shuai', freq: 61 }, { ch: '斯', py: 'si', freq: 61 }, { ch: '塌', py: 'ta', freq: 61 },
  { ch: '态', py: 'tai', freq: 61 }, { ch: '碳', py: 'tan', freq: 61 }, { ch: '趟', py: 'tang', freq: 61 }, { ch: '舔', py: 'tian', freq: 61 }, { ch: '庭', py: 'ting', freq: 61 }, { ch: '拓', py: 'tuo', freq: 61 },
  { ch: '宛', py: 'wan', freq: 61 }, { ch: '忘', py: 'wang', freq: 61 }, { ch: '伟', py: 'wei', freq: 61 }, { ch: '悟', py: 'wu', freq: 61 }, { ch: '锡', py: 'xi', freq: 61 }, { ch: '汐', py: 'xi', freq: 61 },
  { ch: '橡', py: 'xiang', freq: 61 }, { ch: '嚣', py: 'xiao', freq: 61 }, { ch: '携', py: 'xie', freq: 61 }, { ch: '讯', py: 'xun', freq: 61 }, { ch: '掩', py: 'yan', freq: 61 }, { ch: '咬', py: 'yao', freq: 61 },
  { ch: '溢', py: 'yi', freq: 61 }, { ch: '译', py: 'yi', freq: 61 }, { ch: '蝇', py: 'ying', freq: 61 }, { ch: '勇', py: 'yong', freq: 61 }, { ch: '榆', py: 'yu', freq: 61 }, { ch: '雨', py: 'yu', freq: 61 },
  { ch: '喻', py: 'yu', freq: 61 }, { ch: '绽', py: 'zhan', freq: 61 }, { ch: '知', py: 'zhi', freq: 61 }, { ch: '洲', py: 'zhou', freq: 61 }, { ch: '逐', py: 'zhu', freq: 61 }, { ch: '竹', py: 'zhu', freq: 61 },
  { ch: '驻', py: 'zhu', freq: 61 }, { ch: '坠', py: 'zhui', freq: 61 }, { ch: '酌', py: 'zhuo', freq: 61 }, { ch: '懊', py: 'ao', freq: 60 }, { ch: '拔', py: 'ba', freq: 60 }, { ch: '甭', py: 'beng', freq: 60 },
  { ch: '彼', py: 'bi', freq: 60 }, { ch: '渤', py: 'bo', freq: 60 }, { ch: '草', py: 'cao', freq: 60 }, { ch: '炒', py: 'chao', freq: 60 }, { ch: '弛', py: 'chi', freq: 60 }, { ch: '翅', py: 'chi', freq: 60 },
  { ch: '斥', py: 'chi', freq: 60 }, { ch: '窗', py: 'chuang', freq: 60 }, { ch: '次', py: 'ci', freq: 60 }, { ch: '祷', py: 'dao', freq: 60 }, { ch: '淀', py: 'dian', freq: 60 }, { ch: '哆', py: 'duo', freq: 60 },
  { ch: '峨', py: 'e', freq: 60 }, { ch: '恩', py: 'en', freq: 60 }, { ch: '扶', py: 'fu', freq: 60 }, { ch: '伏', py: 'fu', freq: 60 }, { ch: '服', py: 'fu', freq: 60 }, { ch: '涪', py: 'fu', freq: 60 },
  { ch: '羔', py: 'gao', freq: 60 }, { ch: '垢', py: 'gou', freq: 60 }, { ch: '姑', py: 'gu', freq: 60 }, { ch: '蛊', py: 'gu', freq: 60 }, { ch: '棍', py: 'gun', freq: 60 }, { ch: '汉', py: 'han', freq: 60 },
  { ch: '涸', py: 'he', freq: 60 }, { ch: '褐', py: 'he', freq: 60 }, { ch: '吼', py: 'hou', freq: 60 }, { ch: '葫', py: 'hu', freq: 60 }, { ch: '护', py: 'hu', freq: 60 }, { ch: '积', py: 'ji', freq: 60 },
  { ch: '姬', py: 'ji', freq: 60 }, { ch: '驾', py: 'jia', freq: 60 }, { ch: '减', py: 'jian', freq: 60 }, { ch: '鉴', py: 'jian', freq: 60 }, { ch: '蒋', py: 'jiang', freq: 60 }, { ch: '椒', py: 'jiao', freq: 60 },
  { ch: '矫', py: 'jiao', freq: 60 }, { ch: '绞', py: 'jiao', freq: 60 }, { ch: '轿', py: 'jiao', freq: 60 }, { ch: '截', py: 'jie', freq: 60 }, { ch: '桔', py: 'ju', freq: 60 }, { ch: '芥', py: 'jie', freq: 60 },
  { ch: '襟', py: 'jin', freq: 60 }, { ch: '晋', py: 'jin', freq: 60 }, { ch: '境', py: 'jing', freq: 60 }, { ch: '舅', py: 'jiu', freq: 60 }, { ch: '拷', py: 'kao', freq: 60 }, { ch: '渴', py: 'ke', freq: 60 },
  { ch: '坑', py: 'keng', freq: 60 }, { ch: '抠', py: 'kou', freq: 60 }, { ch: '库', py: 'ku', freq: 60 }, { ch: '两', py: 'liang', freq: 60 }, { ch: '略', py: 'lve', freq: 60 }, { ch: '麦', py: 'mai', freq: 60 },
  { ch: '矛', py: 'mao', freq: 60 }, { ch: '摹', py: 'mo', freq: 60 }, { ch: '姆', py: 'mu', freq: 60 }, { ch: '馁', py: 'nei', freq: 60 }, { ch: '琶', py: 'pa', freq: 60 }, { ch: '篷', py: 'peng', freq: 60 },
  { ch: '偏', py: 'pian', freq: 60 }, { ch: '频', py: 'pin', freq: 60 }, { ch: '菩', py: 'pu', freq: 60 }, { ch: '痊', py: 'quan', freq: 60 }, { ch: '群', py: 'qun', freq: 60 }, { ch: '妊', py: 'ren', freq: 60 },
  { ch: '鳃', py: 'sai', freq: 60 }, { ch: '陕', py: 'shan', freq: 60 }, { ch: '膳', py: 'shan', freq: 60 }, { ch: '伸', py: 'shen', freq: 60 }, { ch: '慎', py: 'shen', freq: 60 }, { ch: '渗', py: 'shen', freq: 60 },
  { ch: '施', py: 'shi', freq: 60 }, { ch: '什', py: 'shen', freq: 60 }, { ch: '势', py: 'shi', freq: 60 }, { ch: '曙', py: 'shu', freq: 60 }, { ch: '黍', py: 'shu', freq: 60 }, { ch: '硕', py: 'shuo', freq: 60 },
  { ch: '宿', py: 'su', freq: 60 }, { ch: '苔', py: 'tai', freq: 60 }, { ch: '贪', py: 'tan', freq: 60 }, { ch: '毯', py: 'tan', freq: 60 }, { ch: '帖', py: 'tie', freq: 60 }, { ch: '铜', py: 'tong', freq: 60 },
  { ch: '侮', py: 'wu', freq: 60 }, { ch: '雾', py: 'wu', freq: 60 }, { ch: '晰', py: 'xi', freq: 60 }, { ch: '牺', py: 'xi', freq: 60 }, { ch: '辖', py: 'xia', freq: 60 }, { ch: '衔', py: 'xian', freq: 60 },
  { ch: '湘', py: 'xiang', freq: 60 }, { ch: '楔', py: 'xie', freq: 60 }, { ch: '协', py: 'xie', freq: 60 }, { ch: '泄', py: 'xie', freq: 60 }, { ch: '屑', py: 'xie', freq: 60 }, { ch: '锌', py: 'xin', freq: 60 },
  { ch: '酗', py: 'xu', freq: 60 }, { ch: '宣', py: 'xuan', freq: 60 }, { ch: '蚜', py: 'ya', freq: 60 }, { ch: '唁', py: 'yan', freq: 60 }, { ch: '痒', py: 'yang', freq: 60 }, { ch: '耀', py: 'yao', freq: 60 },
  { ch: '遗', py: 'yi', freq: 60 }, { ch: '乙', py: 'yi', freq: 60 }, { ch: '艺', py: 'yi', freq: 60 }, { ch: '姻', py: 'yin', freq: 60 }, { ch: '尹', py: 'yin', freq: 60 }, { ch: '婴', py: 'ying', freq: 60 },
  { ch: '迎', py: 'ying', freq: 60 }, { ch: '蛹', py: 'yong', freq: 60 }, { ch: '鱼', py: 'yu', freq: 60 }, { ch: '寓', py: 'yu', freq: 60 }, { ch: '酝', py: 'yun', freq: 60 }, { ch: '眨', py: 'zha', freq: 60 },
  { ch: '蘸', py: 'zhan', freq: 60 }, { ch: '召', py: 'zhao', freq: 60 }, { ch: '蛰', py: 'zhe', freq: 60 }, { ch: '脂', py: 'zhi', freq: 60 }, { ch: '煮', py: 'zhu', freq: 60 }, { ch: '撞', py: 'zhuang', freq: 60 },
  { ch: '醉', py: 'zui', freq: 60 }, { ch: '尊', py: 'zun', freq: 60 }, { ch: '左', py: 'zuo', freq: 60 }, { ch: '扮', py: 'ban', freq: 59 }, { ch: '焙', py: 'bei', freq: 59 }, { ch: '辩', py: 'bian', freq: 59 },
  { ch: '遍', py: 'bian', freq: 59 }, { ch: '彬', py: 'bin', freq: 59 }, { ch: '补', py: 'bu', freq: 59 }, { ch: '测', py: 'ce', freq: 59 }, { ch: '搀', py: 'chan', freq: 59 }, { ch: '偿', py: 'chang', freq: 59 },
  { ch: '畅', py: 'chang', freq: 59 }, { ch: '倡', py: 'chang', freq: 59 }, { ch: '臣', py: 'chen', freq: 59 }, { ch: '搐', py: 'chu', freq: 59 }, { ch: '疮', py: 'chuang', freq: 59 }, { ch: '醇', py: 'chun', freq: 59 },
  { ch: '疵', py: 'ci', freq: 59 }, { ch: '词', py: 'ci', freq: 59 }, { ch: '袋', py: 'dai', freq: 59 }, { ch: '弹', py: 'dan', freq: 59 }, { ch: '懂', py: 'dong', freq: 59 }, { ch: '二', py: 'er', freq: 59 },
  { ch: '阀', py: 'fa', freq: 59 }, { ch: '肪', py: 'fang', freq: 59 }, { ch: '纺', py: 'fang', freq: 59 }, { ch: '幅', py: 'fu', freq: 59 }, { ch: '赋', py: 'fu', freq: 59 }, { ch: '竿', py: 'gan', freq: 59 },
  { ch: '港', py: 'gang', freq: 59 }, { ch: '皋', py: 'gao', freq: 59 }, { ch: '剐', py: 'gua', freq: 59 }, { ch: '骸', py: 'hai', freq: 59 }, { ch: '衡', py: 'heng', freq: 59 }, { ch: '鸿', py: 'hong', freq: 59 },
  { ch: '湖', py: 'hu', freq: 59 }, { ch: '徊', py: 'huai', freq: 59 }, { ch: '宦', py: 'huan', freq: 59 }, { ch: '幌', py: 'huang', freq: 59 }, { ch: '肌', py: 'ji', freq: 59 }, { ch: '蓟', py: 'ji', freq: 59 },
  { ch: '既', py: 'ji', freq: 59 }, { ch: '捡', py: 'jian', freq: 59 }, { ch: '剿', py: 'jiao', freq: 59 }, { ch: '借', py: 'jie', freq: 59 }, { ch: '谨', py: 'jin', freq: 59 }, { ch: '鹃', py: 'juan', freq: 59 },
  { ch: '倔', py: 'jue', freq: 59 }, { ch: '磕', py: 'ke', freq: 59 }, { ch: '夸', py: 'kua', freq: 59 }, { ch: '窥', py: 'kui', freq: 59 }, { ch: '垃', py: 'la', freq: 59 }, { ch: '铃', py: 'ling', freq: 59 },
  { ch: '琉', py: 'liu', freq: 59 }, { ch: '拢', py: 'long', freq: 59 }, { ch: '率', py: 'lv', freq: 59 }, { ch: '滦', py: 'luan', freq: 59 }, { ch: '洛', py: 'luo', freq: 59 }, { ch: '卖', py: 'mai', freq: 59 },
  { ch: '芒', py: 'mang', freq: 59 }, { ch: '锚', py: 'mao', freq: 59 }, { ch: '铆', py: 'mao', freq: 59 }, { ch: '酶', py: 'mei', freq: 59 }, { ch: '媚', py: 'mei', freq: 59 }, { ch: '描', py: 'miao', freq: 59 },
  { ch: '蔑', py: 'mie', freq: 59 }, { ch: '木', py: 'mu', freq: 59 }, { ch: '挠', py: 'nao', freq: 59 }, { ch: '闹', py: 'nao', freq: 59 }, { ch: '镍', py: 'nie', freq: 59 }, { ch: '泞', py: 'ning', freq: 59 },
  { ch: '纽', py: 'niu', freq: 59 }, { ch: '疟', py: 'nve', freq: 59 }, { ch: '袍', py: 'pao', freq: 59 }, { ch: '贫', py: 'pin', freq: 59 }, { ch: '萍', py: 'ping', freq: 59 }, { ch: '泼', py: 'po', freq: 59 },
  { ch: '颇', py: 'po', freq: 59 }, { ch: '七', py: 'qi', freq: 59 }, { ch: '漆', py: 'qi', freq: 59 }, { ch: '祁', py: 'qi', freq: 59 }, { ch: '签', py: 'qian', freq: 59 }, { ch: '遣', py: 'qian', freq: 59 },
  { ch: '橇', py: 'qiao', freq: 59 }, { ch: '躯', py: 'qu', freq: 59 }, { ch: '儒', py: 'ru', freq: 59 }, { ch: '瑞', py: 'rui', freq: 59 }, { ch: '善', py: 'shan', freq: 59 }, { ch: '扇', py: 'shan', freq: 59 },
  { ch: '呻', py: 'shen', freq: 59 }, { ch: '身', py: 'shen', freq: 59 }, { ch: '圣', py: 'sheng', freq: 59 }, { ch: '使', py: 'shi', freq: 59 }, { ch: '售', py: 'shou', freq: 59 }, { ch: '肃', py: 'su', freq: 59 },
  { ch: '笋', py: 'sun', freq: 59 }, { ch: '蹋', py: 'ta', freq: 59 }, { ch: '瘫', py: 'tan', freq: 59 }, { ch: '搪', py: 'tang', freq: 59 }, { ch: '童', py: 'tong', freq: 59 }, { ch: '投', py: 'tou', freq: 59 },
  { ch: '途', py: 'tu', freq: 59 }, { ch: '湍', py: 'tuan', freq: 59 }, { ch: '脱', py: 'tuo', freq: 59 }, { ch: '蔚', py: 'wei', freq: 59 }, { ch: '握', py: 'wo', freq: 59 }, { ch: '熙', py: 'xi', freq: 59 },
  { ch: '烯', py: 'xi', freq: 59 }, { ch: '仙', py: 'xian', freq: 59 }, { ch: '挟', py: 'xie', freq: 59 }, { ch: '忻', py: 'xin', freq: 59 }, { ch: '醒', py: 'xing', freq: 59 }, { ch: '朽', py: 'xiu', freq: 59 },
  { ch: '戌', py: 'xu', freq: 59 }, { ch: '延', py: 'yan', freq: 59 }, { ch: '阎', py: 'yan', freq: 59 }, { ch: '仰', py: 'yang', freq: 59 }, { ch: '遥', py: 'yao', freq: 59 }, { ch: '淤', py: 'yu', freq: 59 },
  { ch: '余', py: 'yu', freq: 59 }, { ch: '娱', py: 'yu', freq: 59 }, { ch: '愈', py: 'yu', freq: 59 }, { ch: '狱', py: 'yu', freq: 59 }, { ch: '皂', py: 'zao', freq: 59 }, { ch: '窄', py: 'zhai', freq: 59 },
  { ch: '者', py: 'zhe', freq: 59 }, { ch: '址', py: 'zhi', freq: 59 }, { ch: '珠', py: 'zhu', freq: 59 }, { ch: '蛀', py: 'zhu', freq: 59 }, { ch: '祝', py: 'zhu', freq: 59 }, { ch: '姿', py: 'zi', freq: 59 },
  { ch: '纵', py: 'zong', freq: 59 }, { ch: '扒', py: 'ba', freq: 58 }, { ch: '悲', py: 'bei', freq: 58 }, { ch: '贝', py: 'bei', freq: 58 }, { ch: '被', py: 'bei', freq: 58 }, { ch: '碧', py: 'bi', freq: 58 },
  { ch: '毙', py: 'bi', freq: 58 }, { ch: '壁', py: 'bi', freq: 58 }, { ch: '瘪', py: 'bie', freq: 58 }, { ch: '播', py: 'bo', freq: 58 }, { ch: '蹭', py: 'ceng', freq: 58 }, { ch: '澈', py: 'che', freq: 58 },
  { ch: '稠', py: 'chou', freq: 58 }, { ch: '炊', py: 'chui', freq: 58 }, { ch: '春', py: 'chun', freq: 58 }, { ch: '椿', py: 'chun', freq: 58 }, { ch: '磋', py: 'cuo', freq: 58 }, { ch: '狄', py: 'di', freq: 58 },
  { ch: '爹', py: 'die', freq: 58 }, { ch: '盯', py: 'ding', freq: 58 }, { ch: '逗', py: 'dou', freq: 58 }, { ch: '盾', py: 'dun', freq: 58 }, { ch: '掇', py: 'duo', freq: 58 }, { ch: '泛', py: 'fan', freq: 58 },
  { ch: '菲', py: 'fei', freq: 58 }, { ch: '吠', py: 'fei', freq: 58 }, { ch: '肺', py: 'fei', freq: 58 }, { ch: '肤', py: 'fu', freq: 58 }, { ch: '甘', py: 'gan', freq: 58 }, { ch: '高', py: 'gao', freq: 58 },
  { ch: '哥', py: 'ge', freq: 58 }, { ch: '戈', py: 'ge', freq: 58 }, { ch: '攻', py: 'gong', freq: 58 }, { ch: '沟', py: 'gou', freq: 58 }, { ch: '酣', py: 'han', freq: 58 }, { ch: '豪', py: 'hao', freq: 58 },
  { ch: '毫', py: 'hao', freq: 58 }, { ch: '糊', py: 'hu', freq: 58 }, { ch: '徽', py: 'hui', freq: 58 }, { ch: '浑', py: 'hun', freq: 58 }, { ch: '剂', py: 'ji', freq: 58 }, { ch: '嘉', py: 'jia', freq: 58 },
  { ch: '剪', py: 'jian', freq: 58 }, { ch: '江', py: 'jiang', freq: 58 }, { ch: '疥', py: 'jie', freq: 58 }, { ch: '斤', py: 'jin', freq: 58 }, { ch: '卷', py: 'juan', freq: 58 }, { ch: '掘', py: 'jue', freq: 58 },
  { ch: '钧', py: 'jun', freq: 58 }, { ch: '柯', py: 'ke', freq: 58 }, { ch: '款', py: 'kuan', freq: 58 }, { ch: '愧', py: 'kui', freq: 58 }, { ch: '懒', py: 'lan', freq: 58 }, { ch: '垒', py: 'lei', freq: 58 },
  { ch: '篱', py: 'li', freq: 58 }, { ch: '缕', py: 'lv', freq: 58 }, { ch: '蚂', py: 'ma', freq: 58 }, { ch: '茂', py: 'mao', freq: 58 }, { ch: '绵', py: 'mian', freq: 58 }, { ch: '暮', py: 'mu', freq: 58 },
  { ch: '呐', py: 'na', freq: 58 }, { ch: '奶', py: 'nai', freq: 58 }, { ch: '排', py: 'pai', freq: 58 }, { ch: '牌', py: 'pai', freq: 58 }, { ch: '盘', py: 'pan', freq: 58 }, { ch: '配', py: 'pei', freq: 58 },
  { ch: '硼', py: 'peng', freq: 58 }, { ch: '瞥', py: 'pie', freq: 58 }, { ch: '坪', py: 'ping', freq: 58 }, { ch: '瓶', py: 'ping', freq: 58 }, { ch: '莆', py: 'pu', freq: 58 }, { ch: '讫', py: 'qi', freq: 58 },
  { ch: '迁', py: 'qian', freq: 58 }, { ch: '擎', py: 'qing', freq: 58 }, { ch: '驱', py: 'qu', freq: 58 }, { ch: '缺', py: 'que', freq: 58 }, { ch: '仁', py: 'ren', freq: 58 }, { ch: '勺', py: 'shao', freq: 58 },
  { ch: '拾', py: 'shi', freq: 58 }, { ch: '蔬', py: 'shu', freq: 58 }, { ch: '庶', py: 'shu', freq: 58 }, { ch: '睡', py: 'shui', freq: 58 }, { ch: '嘶', py: 'si', freq: 58 }, { ch: '丝', py: 'si', freq: 58 },
  { ch: '孙', py: 'sun', freq: 58 }, { ch: '甜', py: 'tian', freq: 58 }, { ch: '贴', py: 'tie', freq: 58 }, { ch: '烃', py: 'ting', freq: 58 }, { ch: '蜕', py: 'tui', freq: 58 }, { ch: '袜', py: 'wa', freq: 58 },
  { ch: '腕', py: 'wan', freq: 58 }, { ch: '尾', py: 'wei', freq: 58 }, { ch: '谓', py: 'wei', freq: 58 }, { ch: '瓮', py: 'weng', freq: 58 }, { ch: '坞', py: 'wu', freq: 58 }, { ch: '昔', py: 'xi', freq: 58 },
  { ch: '矽', py: 'xi', freq: 58 }, { ch: '陷', py: 'xian', freq: 58 }, { ch: '孝', py: 'xiao', freq: 58 }, { ch: '卸', py: 'xie', freq: 58 }, { ch: '邢', py: 'xing', freq: 58 }, { ch: '巡', py: 'xun', freq: 58 },
  { ch: '逊', py: 'xun', freq: 58 }, { ch: '牙', py: 'ya', freq: 58 }, { ch: '焉', py: 'yan', freq: 58 }, { ch: '炎', py: 'yan', freq: 58 }, { ch: '噎', py: 'ye', freq: 58 }, { ch: '颐', py: 'yi', freq: 58 },
  { ch: '夷', py: 'yi', freq: 58 }, { ch: '姨', py: 'yi', freq: 58 }, { ch: '已', py: 'yi', freq: 58 }, { ch: '毅', py: 'yi', freq: 58 }, { ch: '吟', py: 'yin', freq: 58 }, { ch: '雍', py: 'yong', freq: 58 },
  { ch: '藻', py: 'zao', freq: 58 }, { ch: '铡', py: 'zha', freq: 58 }, { ch: '胀', py: 'zhang', freq: 58 }, { ch: '沼', py: 'zhao', freq: 58 }, { ch: '兆', py: 'zhao', freq: 58 }, { ch: '智', py: 'zhi', freq: 58 },
  { ch: '抓', py: 'zhua', freq: 58 }, { ch: '桩', py: 'zhuang', freq: 58 }, { ch: '资', py: 'zi', freq: 58 }, { ch: '纂', py: 'zuan', freq: 58 }, { ch: '按', py: 'an', freq: 57 }, { ch: '班', py: 'ban', freq: 57 },
  { ch: '拌', py: 'ban', freq: 57 }, { ch: '磅', py: 'bang', freq: 57 }, { ch: '帛', py: 'bo', freq: 57 }, { ch: '财', py: 'cai', freq: 57 }, { ch: '察', py: 'cha', freq: 57 }, { ch: '差', py: 'cha', freq: 57 },
  { ch: '拆', py: 'chai', freq: 57 }, { ch: '蝉', py: 'chan', freq: 57 }, { ch: '缠', py: 'chan', freq: 57 }, { ch: '扯', py: 'che', freq: 57 }, { ch: '侈', py: 'chi', freq: 57 }, { ch: '愁', py: 'chou', freq: 57 },
  { ch: '椽', py: 'chuan', freq: 57 }, { ch: '床', py: 'chuang', freq: 57 }, { ch: '搭', py: 'da', freq: 57 }, { ch: '歹', py: 'dai', freq: 57 }, { ch: '惮', py: 'dan', freq: 57 }, { ch: '刀', py: 'dao', freq: 57 },
  { ch: '抵', py: 'di', freq: 57 }, { ch: '奠', py: 'dian', freq: 57 }, { ch: '囤', py: 'dun', freq: 57 }, { ch: '噶', py: 'ga', freq: 57 }, { ch: '棺', py: 'guan', freq: 57 }, { ch: '哄', py: 'hong', freq: 57 },
  { ch: '壶', py: 'hu', freq: 57 }, { ch: '哗', py: 'hua', freq: 57 }, { ch: '滑', py: 'hua', freq: 57 }, { ch: '桓', py: 'huan', freq: 57 }, { ch: '豢', py: 'huan', freq: 57 }, { ch: '焕', py: 'huan', freq: 57 },
  { ch: '涣', py: 'huan', freq: 57 }, { ch: '稽', py: 'ji', freq: 57 }, { ch: '颊', py: 'jia', freq: 57 }, { ch: '胶', py: 'jiao', freq: 57 }, { ch: '进', py: 'jin', freq: 57 }, { ch: '臼', py: 'jiu', freq: 57 },
  { ch: '咀', py: 'ju', freq: 57 }, { ch: '均', py: 'jun', freq: 57 }, { ch: '棵', py: 'ke', freq: 57 }, { ch: '啦', py: 'la', freq: 57 }, { ch: '蓝', py: 'lan', freq: 57 }, { ch: '婪', py: 'lan', freq: 57 },
  { ch: '烂', py: 'lan', freq: 57 }, { ch: '牢', py: 'lao', freq: 57 }, { ch: '勒', py: 'lei', freq: 57 }, { ch: '儡', py: 'lei', freq: 57 }, { ch: '狸', py: 'li', freq: 57 }, { ch: '粮', py: 'liang', freq: 57 },
  { ch: '寥', py: 'liao', freq: 57 }, { ch: '辽', py: 'liao', freq: 57 }, { ch: '裂', py: 'lie', freq: 57 }, { ch: '磷', py: 'lin', freq: 57 }, { ch: '龄', py: 'ling', freq: 57 }, { ch: '隆', py: 'long', freq: 57 },
  { ch: '吗', py: 'ma', freq: 57 }, { ch: '曼', py: 'man', freq: 57 }, { ch: '眉', py: 'mei', freq: 57 }, { ch: '孟', py: 'meng', freq: 57 }, { ch: '秘', py: 'mi', freq: 57 }, { ch: '蜜', py: 'mi', freq: 57 },
  { ch: '渺', py: 'miao', freq: 57 }, { ch: '闽', py: 'min', freq: 57 }, { ch: '牟', py: 'mou', freq: 57 }, { ch: '叛', py: 'pan', freq: 57 }, { ch: '僻', py: 'pi', freq: 57 }, { ch: '坡', py: 'po', freq: 57 },
  { ch: '蒲', py: 'pu', freq: 57 }, { ch: '其', py: 'qi', freq: 57 }, { ch: '棋', py: 'qi', freq: 57 }, { ch: '潜', py: 'qian', freq: 57 }, { ch: '桥', py: 'qiao', freq: 57 }, { ch: '侵', py: 'qin', freq: 57 },
  { ch: '亲', py: 'qin', freq: 57 }, { ch: '卿', py: 'qing', freq: 57 }, { ch: '瘸', py: 'que', freq: 57 }, { ch: '绕', py: 'rao', freq: 57 }, { ch: '荣', py: 'rong', freq: 57 }, { ch: '森', py: 'sen', freq: 57 },
  { ch: '墒', py: 'shang', freq: 57 }, { ch: '哨', py: 'shao', freq: 57 }, { ch: '狮', py: 'shi', freq: 57 }, { ch: '恕', py: 'shu', freq: 57 }, { ch: '舜', py: 'shun', freq: 57 }, { ch: '颂', py: 'song', freq: 57 },
  { ch: '绥', py: 'sui', freq: 57 }, { ch: '髓', py: 'sui', freq: 57 }, { ch: '萄', py: 'tao', freq: 57 }, { ch: '蹄', py: 'ti', freq: 57 }, { ch: '铁', py: 'tie', freq: 57 }, { ch: '挺', py: 'ting', freq: 57 },
  { ch: '碗', py: 'wan', freq: 57 }, { ch: '纬', py: 'wei', freq: 57 }, { ch: '巷', py: 'xiang', freq: 57 }, { ch: '销', py: 'xiao', freq: 57 }, { ch: '芯', py: 'xin', freq: 57 }, { ch: '衅', py: 'xin', freq: 57 },
  { ch: '雄', py: 'xiong', freq: 57 }, { ch: '蓄', py: 'xu', freq: 57 }, { ch: '洋', py: 'yang', freq: 57 }, { ch: '谣', py: 'yao', freq: 57 }, { ch: '腋', py: 'ye', freq: 57 }, { ch: '宜', py: 'yi', freq: 57 },
  { ch: '倚', py: 'yi', freq: 57 }, { ch: '营', py: 'ying', freq: 57 }, { ch: '盈', py: 'ying', freq: 57 }, { ch: '恿', py: 'yong', freq: 57 }, { ch: '禹', py: 'yu', freq: 57 }, { ch: '御', py: 'yu', freq: 57 },
  { ch: '预', py: 'yu', freq: 57 }, { ch: '源', py: 'yuan', freq: 57 }, { ch: '阅', py: 'yue', freq: 57 }, { ch: '载', py: 'zai', freq: 57 }, { ch: '葬', py: 'zang', freq: 57 }, { ch: '债', py: 'zhai', freq: 57 },
  { ch: '毡', py: 'zhan', freq: 57 }, { ch: '杖', py: 'zhang', freq: 57 }, { ch: '侦', py: 'zhen', freq: 57 }, { ch: '拯', py: 'zheng', freq: 57 }, { ch: '殖', py: 'zhi', freq: 57 }, { ch: '旨', py: 'zhi', freq: 57 },
  { ch: '挚', py: 'zhi', freq: 57 }, { ch: '峙', py: 'zhi', freq: 57 }, { ch: '盅', py: 'zhong', freq: 57 }, { ch: '诛', py: 'zhu', freq: 57 }, { ch: '铸', py: 'zhu', freq: 57 }, { ch: '筑', py: 'zhu', freq: 57 },
  { ch: '撰', py: 'zhuan', freq: 57 }, { ch: '妆', py: 'zhuang', freq: 57 }, { ch: '谆', py: 'zhun', freq: 57 }, { ch: '卓', py: 'zhuo', freq: 57 }, { ch: '孜', py: 'zi', freq: 57 }, { ch: '蔼', py: 'ai', freq: 56 },
  { ch: '捌', py: 'ba', freq: 56 }, { ch: '叭', py: 'ba', freq: 56 }, { ch: '卑', py: 'bei', freq: 56 }, { ch: '辈', py: 'bei', freq: 56 }, { ch: '濒', py: 'bin', freq: 56 }, { ch: '箔', py: 'bo', freq: 56 },
  { ch: '蔡', py: 'cai', freq: 56 }, { ch: '侧', py: 'ce', freq: 56 }, { ch: '常', py: 'chang', freq: 56 }, { ch: '撤', py: 'che', freq: 56 }, { ch: '瓷', py: 'ci', freq: 56 }, { ch: '此', py: 'ci', freq: 56 },
  { ch: '促', py: 'cu', freq: 56 }, { ch: '导', py: 'dao', freq: 56 }, { ch: '悼', py: 'dao', freq: 56 }, { ch: '盗', py: 'dao', freq: 56 }, { ch: '雕', py: 'diao', freq: 56 }, { ch: '舵', py: 'duo', freq: 56 },
  { ch: '贰', py: 'er', freq: 56 }, { ch: '奋', py: 'fen', freq: 56 }, { ch: '阁', py: 'ge', freq: 56 }, { ch: '巩', py: 'gong', freq: 56 }, { ch: '钩', py: 'gou', freq: 56 }, { ch: '规', py: 'gui', freq: 56 },
  { ch: '赫', py: 'he', freq: 56 }, { ch: '哼', py: 'heng', freq: 56 }, { ch: '虹', py: 'hong', freq: 56 }, { ch: '厚', py: 'hou', freq: 56 }, { ch: '呼', py: 'hu', freq: 56 }, { ch: '虎', py: 'hu', freq: 56 },
  { ch: '话', py: 'hua', freq: 56 }, { ch: '绘', py: 'hui', freq: 56 }, { ch: '畸', py: 'ji', freq: 56 }, { ch: '伎', py: 'ji', freq: 56 }, { ch: '焦', py: 'jiao', freq: 56 }, { ch: '狡', py: 'jiao', freq: 56 },
  { ch: '较', py: 'jiao', freq: 56 }, { ch: '秸', py: 'jie', freq: 56 }, { ch: '藉', py: 'ji', freq: 56 }, { ch: '诫', py: 'jie', freq: 56 }, { ch: '届', py: 'jie', freq: 56 }, { ch: '靳', py: 'jin', freq: 56 },
  { ch: '韭', py: 'jiu', freq: 56 }, { ch: '慷', py: 'kang', freq: 56 }, { ch: '恐', py: 'kong', freq: 56 }, { ch: '澜', py: 'lan', freq: 56 }, { ch: '揽', py: 'lan', freq: 56 }, { ch: '劳', py: 'lao', freq: 56 },
  { ch: '佬', py: 'lao', freq: 56 }, { ch: '涝', py: 'lao', freq: 56 }, { ch: '磊', py: 'lei', freq: 56 }, { ch: '黎', py: 'li', freq: 56 }, { ch: '痢', py: 'li', freq: 56 }, { ch: '炉', py: 'lu', freq: 56 },
  { ch: '掠', py: 'lve', freq: 56 }, { ch: '伦', py: 'lun', freq: 56 }, { ch: '逻', py: 'luo', freq: 56 }, { ch: '络', py: 'luo', freq: 56 }, { ch: '麻', py: 'ma', freq: 56 }, { ch: '玫', py: 'mei', freq: 56 },
  { ch: '抿', py: 'min', freq: 56 }, { ch: '氖', py: 'nai', freq: 56 }, { ch: '祈', py: 'qi', freq: 56 }, { ch: '堑', py: 'qian', freq: 56 }, { ch: '枪', py: 'qiang', freq: 56 }, { ch: '蛆', py: 'qu', freq: 56 },
  { ch: '权', py: 'quan', freq: 56 }, { ch: '泉', py: 'quan', freq: 56 }, { ch: '燃', py: 'ran', freq: 56 }, { ch: '蕊', py: 'rui', freq: 56 }, { ch: '桑', py: 'sang', freq: 56 }, { ch: '衫', py: 'shan', freq: 56 },
  { ch: '捎', py: 'shao', freq: 56 }, { ch: '升', py: 'sheng', freq: 56 }, { ch: '氏', py: 'shi', freq: 56 }, { ch: '舒', py: 'shu', freq: 56 }, { ch: '熟', py: 'shu', freq: 56 }, { ch: '暑', py: 'shu', freq: 56 },
  { ch: '耍', py: 'shua', freq: 56 }, { ch: '隋', py: 'sui', freq: 56 }, { ch: '穗', py: 'sui', freq: 56 }, { ch: '祟', py: 'sui', freq: 56 }, { ch: '胎', py: 'tai', freq: 56 }, { ch: '屉', py: 'ti', freq: 56 },
  { ch: '瞳', py: 'tong', freq: 56 }, { ch: '涂', py: 'tu', freq: 56 }, { ch: '驮', py: 'tuo', freq: 56 }, { ch: '湾', py: 'wan', freq: 56 }, { ch: '威', py: 'wei', freq: 56 }, { ch: '污', py: 'wu', freq: 56 },
  { ch: '隙', py: 'xi', freq: 56 }, { ch: '享', py: 'xiang', freq: 56 }, { ch: '霄', py: 'xiao', freq: 56 }, { ch: '谢', py: 'xie', freq: 56 }, { ch: '休', py: 'xiu', freq: 56 }, { ch: '羞', py: 'xiu', freq: 56 },
  { ch: '嘘', py: 'xu', freq: 56 }, { ch: '椰', py: 'ye', freq: 56 }, { ch: '冶', py: 'ye', freq: 56 }, { ch: '液', py: 'ye', freq: 56 }, { ch: '疑', py: 'yi', freq: 56 }, { ch: '屹', py: 'yi', freq: 56 },
  { ch: '盂', py: 'yu', freq: 56 }, { ch: '隅', py: 'yu', freq: 56 }, { ch: '园', py: 'yuan', freq: 56 }, { ch: '圆', py: 'yuan', freq: 56 }, { ch: '蕴', py: 'yun', freq: 56 }, { ch: '赞', py: 'zan', freq: 56 },
  { ch: '遭', py: 'zao', freq: 56 }, { ch: '震', py: 'zhen', freq: 56 }, { ch: '睁', py: 'zheng', freq: 56 }, { ch: '吱', py: 'zhi', freq: 56 }, { ch: '州', py: 'zhou', freq: 56 }, { ch: '拄', py: 'zhu', freq: 56 },
  { ch: '柱', py: 'zhu', freq: 56 }, { ch: '棕', py: 'zong', freq: 56 }, { ch: '柞', py: 'zha', freq: 56 }, { ch: '阿', py: 'a', freq: 55 }, { ch: '皑', py: 'ai', freq: 55 }, { ch: '安', py: 'an', freq: 55 },
  { ch: '盎', py: 'ang', freq: 55 }, { ch: '吧', py: 'ba', freq: 55 }, { ch: '八', py: 'ba', freq: 55 }, { ch: '巴', py: 'ba', freq: 55 }, { ch: '爸', py: 'ba', freq: 55 }, { ch: '白', py: 'bai', freq: 55 },
  { ch: '百', py: 'bai', freq: 55 }, { ch: '斑', py: 'ban', freq: 55 }, { ch: '般', py: 'ban', freq: 55 }, { ch: '半', py: 'ban', freq: 55 }, { ch: '办', py: 'ban', freq: 55 }, { ch: '包', py: 'bao', freq: 55 },
  { ch: '剥', py: 'bo', freq: 55 }, { ch: '雹', py: 'bao', freq: 55 }, { ch: '保', py: 'bao', freq: 55 }, { ch: '报', py: 'bao', freq: 55 }, { ch: '北', py: 'bei', freq: 55 }, { ch: '备', py: 'bei', freq: 55 },
  { ch: '本', py: 'ben', freq: 55 }, { ch: '迸', py: 'beng', freq: 55 }, { ch: '比', py: 'bi', freq: 55 }, { ch: '笔', py: 'bi', freq: 55 }, { ch: '庇', py: 'bi', freq: 55 }, { ch: '必', py: 'bi', freq: 55 },
  { ch: '边', py: 'bian', freq: 55 }, { ch: '便', py: 'bian', freq: 55 }, { ch: '变', py: 'bian', freq: 55 }, { ch: '表', py: 'biao', freq: 55 }, { ch: '别', py: 'bie', freq: 55 }, { ch: '病', py: 'bing', freq: 55 },
  { ch: '并', py: 'bing', freq: 55 }, { ch: '膊', py: 'bo', freq: 55 }, { ch: '布', py: 'bu', freq: 55 }, { ch: '步', py: 'bu', freq: 55 }, { ch: '部', py: 'bu', freq: 55 }, { ch: '才', py: 'cai', freq: 55 },
  { ch: '参', py: 'can', freq: 55 }, { ch: '仓', py: 'cang', freq: 55 }, { ch: '茬', py: 'cha', freq: 55 }, { ch: '查', py: 'cha', freq: 55 }, { ch: '产', py: 'chan', freq: 55 }, { ch: '场', py: 'chang', freq: 55 },
  { ch: '唱', py: 'chang', freq: 55 }, { ch: '车', py: 'che', freq: 55 }, { ch: '彻', py: 'che', freq: 55 }, { ch: '沉', py: 'chen', freq: 55 }, { ch: '称', py: 'cheng', freq: 55 }, { ch: '城', py: 'cheng', freq: 55 },
  { ch: '程', py: 'cheng', freq: 55 }, { ch: '吃', py: 'chi', freq: 55 }, { ch: '持', py: 'chi', freq: 55 }, { ch: '匙', py: 'shi', freq: 55 }, { ch: '驰', py: 'chi', freq: 55 }, { ch: '虫', py: 'chong', freq: 55 },
  { ch: '踌', py: 'chou', freq: 55 }, { ch: '仇', py: 'chou', freq: 55 }, { ch: '初', py: 'chu', freq: 55 }, { ch: '厨', py: 'chu', freq: 55 }, { ch: '除', py: 'chu', freq: 55 }, { ch: '处', py: 'chu', freq: 55 },
  { ch: '穿', py: 'chuan', freq: 55 }, { ch: '传', py: 'chuan', freq: 55 }, { ch: '存', py: 'cun', freq: 55 }, { ch: '寸', py: 'cun', freq: 55 }, { ch: '错', py: 'cuo', freq: 55 }, { ch: '达', py: 'da', freq: 55 },
  { ch: '答', py: 'da', freq: 55 }, { ch: '瘩', py: 'da', freq: 55 }, { ch: '打', py: 'da', freq: 55 }, { ch: '带', py: 'dai', freq: 55 }, { ch: '代', py: 'dai', freq: 55 }, { ch: '待', py: 'dai', freq: 55 },
  { ch: '单', py: 'dan', freq: 55 }, { ch: '党', py: 'dang', freq: 55 }, { ch: '倒', py: 'dao', freq: 55 }, { ch: '德', py: 'de', freq: 55 }, { ch: '等', py: 'deng', freq: 55 }, { ch: '敌', py: 'di', freq: 55 },
  { ch: '笛', py: 'di', freq: 55 }, { ch: '底', py: 'di', freq: 55 }, { ch: '帝', py: 'di', freq: 55 }, { ch: '弟', py: 'di', freq: 55 }, { ch: '点', py: 'dian', freq: 55 }, { ch: '电', py: 'dian', freq: 55 },
  { ch: '刁', py: 'diao', freq: 55 }, { ch: '掉', py: 'diao', freq: 55 }, { ch: '调', py: 'diao', freq: 55 }, { ch: '定', py: 'ding', freq: 55 }, { ch: '东', py: 'dong', freq: 55 }, { ch: '独', py: 'du', freq: 55 },
  { ch: '读', py: 'du', freq: 55 }, { ch: '肚', py: 'du', freq: 55 }, { ch: '度', py: 'du', freq: 55 }, { ch: '断', py: 'duan', freq: 55 }, { ch: '队', py: 'dui', freq: 55 }, { ch: '俄', py: 'e', freq: 55 },
  { ch: '尔', py: 'er', freq: 55 }, { ch: '烦', py: 'fan', freq: 55 }, { ch: '反', py: 'fan', freq: 55 }, { ch: '饭', py: 'fan', freq: 55 }, { ch: '芳', py: 'fang', freq: 55 }, { ch: '房', py: 'fang', freq: 55 },
  { ch: '放', py: 'fang', freq: 55 }, { ch: '非', py: 'fei', freq: 55 }, { ch: '飞', py: 'fei', freq: 55 }, { ch: '费', py: 'fei', freq: 55 }, { ch: '吩', py: 'fen', freq: 55 }, { ch: '风', py: 'feng', freq: 55 },
  { ch: '逢', py: 'feng', freq: 55 }, { ch: '夫', py: 'fu', freq: 55 }, { ch: '拂', py: 'fu', freq: 55 }, { ch: '氟', py: 'fu', freq: 55 }, { ch: '福', py: 'fu', freq: 55 }, { ch: '赴', py: 'fu', freq: 55 },
  { ch: '复', py: 'fu', freq: 55 }, { ch: '父', py: 'fu', freq: 55 }, { ch: '富', py: 'fu', freq: 55 }, { ch: '妇', py: 'fu', freq: 55 }, { ch: '该', py: 'gai', freq: 55 }, { ch: '改', py: 'gai', freq: 55 },
  { ch: '干', py: 'gan', freq: 55 }, { ch: '感', py: 'gan', freq: 55 }, { ch: '刚', py: 'gang', freq: 55 }, { ch: '篙', py: 'gao', freq: 55 }, { ch: '搞', py: 'gao', freq: 55 }, { ch: '告', py: 'gao', freq: 55 },
  { ch: '歌', py: 'ge', freq: 55 }, { ch: '格', py: 'ge', freq: 55 }, { ch: '各', py: 'ge', freq: 55 }, { ch: '根', py: 'gen', freq: 55 }, { ch: '跟', py: 'gen', freq: 55 }, { ch: '更', py: 'geng', freq: 55 },
  { ch: '工', py: 'gong', freq: 55 }, { ch: '功', py: 'gong', freq: 55 }, { ch: '公', py: 'gong', freq: 55 }, { ch: '共', py: 'gong', freq: 55 }, { ch: '苟', py: 'gou', freq: 55 }, { ch: '够', py: 'gou', freq: 55 },
  { ch: '菇', py: 'gu', freq: 55 }, { ch: '古', py: 'gu', freq: 55 }, { ch: '故', py: 'gu', freq: 55 }, { ch: '关', py: 'guan', freq: 55 }, { ch: '官', py: 'guan', freq: 55 }, { ch: '观', py: 'guan', freq: 55 },
  { ch: '管', py: 'guan', freq: 55 }, { ch: '光', py: 'guang', freq: 55 }, { ch: '广', py: 'guang', freq: 55 }, { ch: '果', py: 'guo', freq: 55 }, { ch: '裹', py: 'guo', freq: 55 }, { ch: '孩', py: 'hai', freq: 55 },
  { ch: '海', py: 'hai', freq: 55 }, { ch: '氦', py: 'hai', freq: 55 }, { ch: '号', py: 'hao', freq: 55 }, { ch: '浩', py: 'hao', freq: 55 }, { ch: '何', py: 'he', freq: 55 }, { ch: '合', py: 'he', freq: 55 },
  { ch: '黑', py: 'hei', freq: 55 }, { ch: '红', py: 'hong', freq: 55 }, { ch: '候', py: 'hou', freq: 55 }, { ch: '乎', py: 'hu', freq: 55 }, { ch: '胡', py: 'hu', freq: 55 }, { ch: '唬', py: 'hu', freq: 55 },
  { ch: '花', py: 'hua', freq: 55 }, { ch: '华', py: 'hua', freq: 55 }, { ch: '画', py: 'hua', freq: 55 }, { ch: '化', py: 'hua', freq: 55 }, { ch: '怀', py: 'huai', freq: 55 }, { ch: '欢', py: 'huan', freq: 55 },
  { ch: '黄', py: 'huang', freq: 55 }, { ch: '谎', py: 'huang', freq: 55 }, { ch: '婚', py: 'hun', freq: 55 }, { ch: '活', py: 'huo', freq: 55 }, { ch: '火', py: 'huo', freq: 55 }, { ch: '或', py: 'huo', freq: 55 },
  { ch: '圾', py: 'ji', freq: 55 }, { ch: '基', py: 'ji', freq: 55 }, { ch: '机', py: 'ji', freq: 55 }, { ch: '激', py: 'ji', freq: 55 }, { ch: '极', py: 'ji', freq: 55 }, { ch: '及', py: 'ji', freq: 55 },
  { ch: '即', py: 'ji', freq: 55 }, { ch: '几', py: 'ji', freq: 55 }, { ch: '季', py: 'ji', freq: 55 }, { ch: '寄', py: 'ji', freq: 55 }, { ch: '计', py: 'ji', freq: 55 }, { ch: '记', py: 'ji', freq: 55 },
  { ch: '际', py: 'ji', freq: 55 }, { ch: '纪', py: 'ji', freq: 55 }, { ch: '枷', py: 'jia', freq: 55 }, { ch: '加', py: 'jia', freq: 55 }, { ch: '荚', py: 'jia', freq: 55 }, { ch: '钾', py: 'jia', freq: 55 },
  { ch: '假', py: 'jia', freq: 55 }, { ch: '价', py: 'jia', freq: 55 }, { ch: '尖', py: 'jian', freq: 55 }, { ch: '简', py: 'jian', freq: 55 }, { ch: '见', py: 'jian', freq: 55 }, { ch: '建', py: 'jian', freq: 55 },
  { ch: '将', py: 'jiang', freq: 55 }, { ch: '讲', py: 'jiang', freq: 55 }, { ch: '交', py: 'jiao', freq: 55 }, { ch: '侥', py: 'jiao', freq: 55 }, { ch: '脚', py: 'jiao', freq: 55 }, { ch: '教', py: 'jiao', freq: 55 },
  { ch: '叫', py: 'jiao', freq: 55 }, { ch: '接', py: 'jie', freq: 55 }, { ch: '节', py: 'jie', freq: 55 }, { ch: '结', py: 'jie', freq: 55 }, { ch: '解', py: 'jie', freq: 55 }, { ch: '戒', py: 'jie', freq: 55 },
  { ch: '界', py: 'jie', freq: 55 }, { ch: '金', py: 'jin', freq: 55 }, { ch: '今', py: 'jin', freq: 55 }, { ch: '紧', py: 'jin', freq: 55 }, { ch: '仅', py: 'jin', freq: 55 }, { ch: '近', py: 'jin', freq: 55 },
  { ch: '尽', py: 'jin', freq: 55 }, { ch: '京', py: 'jing', freq: 55 }, { ch: '惊', py: 'jing', freq: 55 }, { ch: '精', py: 'jing', freq: 55 }, { ch: '静', py: 'jing', freq: 55 }, { ch: '竟', py: 'jing', freq: 55 },
  { ch: '究', py: 'jiu', freq: 55 }, { ch: '久', py: 'jiu', freq: 55 }, { ch: '酒', py: 'jiu', freq: 55 }, { ch: '居', py: 'ju', freq: 55 }, { ch: '举', py: 'ju', freq: 55 }, { ch: '据', py: 'ju', freq: 55 },
  { ch: '具', py: 'ju', freq: 55 }, { ch: '句', py: 'ju', freq: 55 }, { ch: '攫', py: 'jue', freq: 55 }, { ch: '觉', py: 'jue', freq: 55 }, { ch: '决', py: 'jue', freq: 55 }, { ch: '绝', py: 'jue', freq: 55 },
  { ch: '军', py: 'jun', freq: 55 }, { ch: '骏', py: 'jun', freq: 55 }, { ch: '卡', py: 'ka', freq: 55 }, { ch: '康', py: 'kang', freq: 55 }, { ch: '糠', py: 'kang', freq: 55 }, { ch: '扛', py: 'kang', freq: 55 },
  { ch: '考', py: 'kao', freq: 55 }, { ch: '科', py: 'ke', freq: 55 }, { ch: '克', py: 'ke', freq: 55 }, { ch: '刻', py: 'ke', freq: 55 }, { ch: '客', py: 'ke', freq: 55 }, { ch: '课', py: 'ke', freq: 55 },
  { ch: '空', py: 'kong', freq: 55 }, { ch: '口', py: 'kou', freq: 55 }, { ch: '苦', py: 'ku', freq: 55 }, { ch: '块', py: 'kuai', freq: 55 }, { ch: '快', py: 'kuai', freq: 55 }, { ch: '困', py: 'kun', freq: 55 },
  { ch: '拉', py: 'la', freq: 55 }, { ch: '兰', py: 'lan', freq: 55 }, { ch: '滥', py: 'lan', freq: 55 }, { ch: '乐', py: 'le', freq: 55 }, { ch: '类', py: 'lei', freq: 55 }, { ch: '泪', py: 'lei', freq: 55 },
  { ch: '冷', py: 'leng', freq: 55 }, { ch: '离', py: 'li', freq: 55 }, { ch: '理', py: 'li', freq: 55 }, { ch: '李', py: 'li', freq: 55 }, { ch: '礼', py: 'li', freq: 55 }, { ch: '莉', py: 'li', freq: 55 },
  { ch: '丽', py: 'li', freq: 55 }, { ch: '历', py: 'li', freq: 55 }, { ch: '利', py: 'li', freq: 55 }, { ch: '立', py: 'li', freq: 55 }, { ch: '粒', py: 'li', freq: 55 }, { ch: '力', py: 'li', freq: 55 },
  { ch: '联', py: 'lian', freq: 55 }, { ch: '连', py: 'lian', freq: 55 }, { ch: '脸', py: 'lian', freq: 55 }, { ch: '量', py: 'liang', freq: 55 }, { ch: '亮', py: 'liang', freq: 55 }, { ch: '镣', py: 'liao', freq: 55 },
  { ch: '料', py: 'liao', freq: 55 }, { ch: '列', py: 'lie', freq: 55 }, { ch: '林', py: 'lin', freq: 55 }, { ch: '灵', py: 'ling', freq: 55 }, { ch: '领', py: 'ling', freq: 55 }, { ch: '另', py: 'ling', freq: 55 },
  { ch: '令', py: 'ling', freq: 55 }, { ch: '留', py: 'liu', freq: 55 }, { ch: '流', py: 'liu', freq: 55 }, { ch: '楼', py: 'lou', freq: 55 }, { ch: '颅', py: 'lu', freq: 55 }, { ch: '路', py: 'lu', freq: 55 },
  { ch: '峦', py: 'luan', freq: 55 }, { ch: '挛', py: 'luan', freq: 55 }, { ch: '论', py: 'lun', freq: 55 }, { ch: '罗', py: 'luo', freq: 55 }, { ch: '落', py: 'luo', freq: 55 }, { ch: '妈', py: 'ma', freq: 55 },
  { ch: '马', py: 'ma', freq: 55 }, { ch: '买', py: 'mai', freq: 55 }, { ch: '满', py: 'man', freq: 55 }, { ch: '毛', py: 'mao', freq: 55 }, { ch: '枚', py: 'mei', freq: 55 }, { ch: '每', py: 'mei', freq: 55 },
  { ch: '门', py: 'men', freq: 55 }, { ch: '檬', py: 'meng', freq: 55 }, { ch: '猛', py: 'meng', freq: 55 }, { ch: '梦', py: 'meng', freq: 55 }, { ch: '米', py: 'mi', freq: 55 }, { ch: '密', py: 'mi', freq: 55 },
  { ch: '缅', py: 'mian', freq: 55 }, { ch: '民', py: 'min', freq: 55 }, { ch: '明', py: 'ming', freq: 55 }, { ch: '命', py: 'ming', freq: 55 }, { ch: '默', py: 'mo', freq: 55 }, { ch: '某', py: 'mou', freq: 55 },
  { ch: '母', py: 'mu', freq: 55 }, { ch: '慕', py: 'mu', freq: 55 }, { ch: '目', py: 'mu', freq: 55 }, { ch: '拿', py: 'na', freq: 55 }, { ch: '哪', py: 'na', freq: 55 }, { ch: '纳', py: 'na', freq: 55 },
  { ch: '南', py: 'nan', freq: 55 }, { ch: '男', py: 'nan', freq: 55 }, { ch: '难', py: 'nan', freq: 55 }, { ch: '脑', py: 'nao', freq: 55 }, { ch: '呢', py: 'ne', freq: 55 }, { ch: '内', py: 'nei', freq: 55 },
  { ch: '尼', py: 'ni', freq: 55 }, { ch: '念', py: 'nian', freq: 55 }, { ch: '娘', py: 'niang', freq: 55 }, { ch: '您', py: 'nin', freq: 55 }, { ch: '怕', py: 'pa', freq: 55 }, { ch: '徘', py: 'pai', freq: 55 },
  { ch: '旁', py: 'pang', freq: 55 }, { ch: '跑', py: 'pao', freq: 55 }, { ch: '朋', py: 'peng', freq: 55 }, { ch: '砒', py: 'pi', freq: 55 }, { ch: '琵', py: 'pi', freq: 55 }, { ch: '皮', py: 'pi', freq: 55 },
  { ch: '片', py: 'pian', freq: 55 }, { ch: '品', py: 'pin', freq: 55 }, { ch: '平', py: 'ping', freq: 55 }, { ch: '破', py: 'po', freq: 55 }, { ch: '圃', py: 'pu', freq: 55 }, { ch: '妻', py: 'qi', freq: 55 },
  { ch: '奇', py: 'qi', freq: 55 }, { ch: '气', py: 'qi', freq: 55 }, { ch: '掐', py: 'qia', freq: 55 }, { ch: '千', py: 'qian', freq: 55 }, { ch: '钱', py: 'qian', freq: 55 }, { ch: '强', py: 'qiang', freq: 55 },
  { ch: '切', py: 'qie', freq: 55 }, { ch: '且', py: 'qie', freq: 55 }, { ch: '青', py: 'qing', freq: 55 }, { ch: '轻', py: 'qing', freq: 55 }, { ch: '清', py: 'qing', freq: 55 }, { ch: '请', py: 'qing', freq: 55 },
  { ch: '球', py: 'qiu', freq: 55 }, { ch: '求', py: 'qiu', freq: 55 }, { ch: '取', py: 'qu', freq: 55 }, { ch: '全', py: 'quan', freq: 55 }, { ch: '券', py: 'quan', freq: 55 }, { ch: '却', py: 'que', freq: 55 },
  { ch: '确', py: 'que', freq: 55 }, { ch: '让', py: 'rang', freq: 55 }, { ch: '热', py: 're', freq: 55 }, { ch: '任', py: 'ren', freq: 55 }, { ch: '认', py: 'ren', freq: 55 }, { ch: '仍', py: 'reng', freq: 55 },
  { ch: '容', py: 'rong', freq: 55 }, { ch: '汝', py: 'ru', freq: 55 }, { ch: '入', py: 'ru', freq: 55 }, { ch: '闰', py: 'run', freq: 55 }, { ch: '若', py: 'ruo', freq: 55 }, { ch: '赛', py: 'sai', freq: 55 },
  { ch: '三', py: 'san', freq: 55 }, { ch: '色', py: 'se', freq: 55 }, { ch: '晒', py: 'shai', freq: 55 }, { ch: '山', py: 'shan', freq: 55 }, { ch: '伤', py: 'shang', freq: 55 }, { ch: '商', py: 'shang', freq: 55 },
  { ch: '少', py: 'shao', freq: 55 }, { ch: '社', py: 'she', freq: 55 }, { ch: '设', py: 'she', freq: 55 }, { ch: '深', py: 'shen', freq: 55 }, { ch: '神', py: 'shen', freq: 55 }, { ch: '甚', py: 'shen', freq: 55 },
  { ch: '声', py: 'sheng', freq: 55 }, { ch: '师', py: 'shi', freq: 55 }, { ch: '失', py: 'shi', freq: 55 }, { ch: '诗', py: 'shi', freq: 55 }, { ch: '十', py: 'shi', freq: 55 }, { ch: '石', py: 'shi', freq: 55 },
  { ch: '食', py: 'shi', freq: 55 }, { ch: '实', py: 'shi', freq: 55 }, { ch: '识', py: 'shi', freq: 55 }, { ch: '史', py: 'shi', freq: 55 }, { ch: '始', py: 'shi', freq: 55 }, { ch: '式', py: 'shi', freq: 55 },
  { ch: '示', py: 'shi', freq: 55 }, { ch: '士', py: 'shi', freq: 55 }, { ch: '仕', py: 'shi', freq: 55 }, { ch: '侍', py: 'shi', freq: 55 }, { ch: '市', py: 'shi', freq: 55 }, { ch: '室', py: 'shi', freq: 55 },
  { ch: '视', py: 'shi', freq: 55 }, { ch: '试', py: 'shi', freq: 55 }, { ch: '收', py: 'shou', freq: 55 }, { ch: '首', py: 'shou', freq: 55 }, { ch: '受', py: 'shou', freq: 55 }, { ch: '淑', py: 'shu', freq: 55 },
  { ch: '书', py: 'shu', freq: 55 }, { ch: '孰', py: 'shu', freq: 55 }, { ch: '术', py: 'shu', freq: 55 }, { ch: '树', py: 'shu', freq: 55 }, { ch: '数', py: 'shu', freq: 55 }, { ch: '双', py: 'shuang', freq: 55 },
  { ch: '谁', py: 'shui', freq: 55 }, { ch: '水', py: 'shui', freq: 55 }, { ch: '思', py: 'si', freq: 55 }, { ch: '司', py: 'si', freq: 55 }, { ch: '四', py: 'si', freq: 55 }, { ch: '似', py: 'shi', freq: 55 },
  { ch: '怂', py: 'song', freq: 55 }, { ch: '送', py: 'song', freq: 55 }, { ch: '苏', py: 'su', freq: 55 }, { ch: '诉', py: 'su', freq: 55 }, { ch: '蒜', py: 'suan', freq: 55 }, { ch: '算', py: 'suan', freq: 55 },
  { ch: '虽', py: 'sui', freq: 55 }, { ch: '随', py: 'sui', freq: 55 }, { ch: '碎', py: 'sui', freq: 55 }, { ch: '岁', py: 'sui', freq: 55 }, { ch: '獭', py: 'ta', freq: 55 }, { ch: '台', py: 'tai', freq: 55 },
  { ch: '太', py: 'tai', freq: 55 }, { ch: '谈', py: 'tan', freq: 55 }, { ch: '棠', py: 'tang', freq: 55 }, { ch: '套', py: 'tao', freq: 55 }, { ch: '特', py: 'te', freq: 55 }, { ch: '提', py: 'ti', freq: 55 },
  { ch: '题', py: 'ti', freq: 55 }, { ch: '体', py: 'ti', freq: 55 }, { ch: '填', py: 'tian', freq: 55 }, { ch: '条', py: 'tiao', freq: 55 }, { ch: '听', py: 'ting', freq: 55 }, { ch: '停', py: 'ting', freq: 55 },
  { ch: '艇', py: 'ting', freq: 55 }, { ch: '通', py: 'tong', freq: 55 }, { ch: '桐', py: 'tong', freq: 55 }, { ch: '统', py: 'tong', freq: 55 }, { ch: '痛', py: 'tong', freq: 55 }, { ch: '突', py: 'tu', freq: 55 },
  { ch: '图', py: 'tu', freq: 55 }, { ch: '土', py: 'tu', freq: 55 }, { ch: '唾', py: 'tuo', freq: 55 }, { ch: '外', py: 'wai', freq: 55 }, { ch: '弯', py: 'wan', freq: 55 }, { ch: '完', py: 'wan', freq: 55 },
  { ch: '晚', py: 'wan', freq: 55 }, { ch: '万', py: 'wan', freq: 55 }, { ch: '王', py: 'wang', freq: 55 }, { ch: '往', py: 'wang', freq: 55 }, { ch: '望', py: 'wang', freq: 55 }, { ch: '微', py: 'wei', freq: 55 },
  { ch: '维', py: 'wei', freq: 55 }, { ch: '未', py: 'wei', freq: 55 }, { ch: '味', py: 'wei', freq: 55 }, { ch: '温', py: 'wen', freq: 55 }, { ch: '文', py: 'wen', freq: 55 }, { ch: '问', py: 'wen', freq: 55 },
  { ch: '蜗', py: 'wo', freq: 55 }, { ch: '斡', py: 'wo', freq: 55 }, { ch: '梧', py: 'wu', freq: 55 }, { ch: '五', py: 'wu', freq: 55 }, { ch: '物', py: 'wu', freq: 55 }, { ch: '务', py: 'wu', freq: 55 },
  { ch: '西', py: 'xi', freq: 55 }, { ch: '息', py: 'xi', freq: 55 }, { ch: '希', py: 'xi', freq: 55 }, { ch: '习', py: 'xi', freq: 55 }, { ch: '喜', py: 'xi', freq: 55 }, { ch: '系', py: 'xi', freq: 55 },
  { ch: '细', py: 'xi', freq: 55 }, { ch: '暇', py: 'xia', freq: 55 }, { ch: '先', py: 'xian', freq: 55 }, { ch: '显', py: 'xian', freq: 55 }, { ch: '线', py: 'xian', freq: 55 }, { ch: '相', py: 'xiang', freq: 55 },
  { ch: '香', py: 'xiang', freq: 55 }, { ch: '响', py: 'xiang', freq: 55 }, { ch: '像', py: 'xiang', freq: 55 }, { ch: '向', py: 'xiang', freq: 55 }, { ch: '象', py: 'xiang', freq: 55 }, { ch: '消', py: 'xiao', freq: 55 },
  { ch: '校', py: 'xiao', freq: 55 }, { ch: '笑', py: 'xiao', freq: 55 }, { ch: '写', py: 'xie', freq: 55 }, { ch: '薪', py: 'xin', freq: 55 }, { ch: '新', py: 'xin', freq: 55 }, { ch: '信', py: 'xin', freq: 55 },
  { ch: '星', py: 'xing', freq: 55 }, { ch: '兴', py: 'xing', freq: 55 }, { ch: '形', py: 'xing', freq: 55 }, { ch: '幸', py: 'xing', freq: 55 }, { ch: '性', py: 'xing', freq: 55 }, { ch: '需', py: 'xu', freq: 55 },
  { ch: '须', py: 'xu', freq: 55 }, { ch: '许', py: 'xu', freq: 55 }, { ch: '选', py: 'xuan', freq: 55 }, { ch: '薛', py: 'xue', freq: 55 }, { ch: '血', py: 'xue', freq: 55 }, { ch: '亚', py: 'ya', freq: 55 },
  { ch: '严', py: 'yan', freq: 55 }, { ch: '研', py: 'yan', freq: 55 }, { ch: '言', py: 'yan', freq: 55 }, { ch: '眼', py: 'yan', freq: 55 }, { ch: '演', py: 'yan', freq: 55 }, { ch: '验', py: 'yan', freq: 55 },
  { ch: '杨', py: 'yang', freq: 55 }, { ch: '阳', py: 'yang', freq: 55 }, { ch: '养', py: 'yang', freq: 55 }, { ch: '业', py: 'ye', freq: 55 }, { ch: '夜', py: 'ye', freq: 55 }, { ch: '医', py: 'yi', freq: 55 },
  { ch: '衣', py: 'yi', freq: 55 }, { ch: '胰', py: 'yi', freq: 55 }, { ch: '易', py: 'yi', freq: 55 }, { ch: '义', py: 'yi', freq: 55 }, { ch: '议', py: 'yi', freq: 55 }, { ch: '音', py: 'yin', freq: 55 },
  { ch: '引', py: 'yin', freq: 55 }, { ch: '印', py: 'yin', freq: 55 }, { ch: '英', py: 'ying', freq: 55 }, { ch: '樱', py: 'ying', freq: 55 }, { ch: '应', py: 'ying', freq: 55 }, { ch: '影', py: 'ying', freq: 55 },
  { ch: '永', py: 'yong', freq: 55 }, { ch: '由', py: 'you', freq: 55 }, { ch: '游', py: 'you', freq: 55 }, { ch: '友', py: 'you', freq: 55 }, { ch: '与', py: 'yu', freq: 55 }, { ch: '语', py: 'yu', freq: 55 },
  { ch: '吁', py: 'xu', freq: 55 }, { ch: '元', py: 'yuan', freq: 55 }, { ch: '原', py: 'yuan', freq: 55 }, { ch: '员', py: 'yuan', freq: 55 }, { ch: '猿', py: 'yuan', freq: 55 }, { ch: '远', py: 'yuan', freq: 55 },
  { ch: '愿', py: 'yuan', freq: 55 }, { ch: '院', py: 'yuan', freq: 55 }, { ch: '约', py: 'yue', freq: 55 }, { ch: '越', py: 'yue', freq: 55 }, { ch: '月', py: 'yue', freq: 55 }, { ch: '运', py: 'yun', freq: 55 },
  { ch: '哉', py: 'zai', freq: 55 }, { ch: '再', py: 'zai', freq: 55 }, { ch: '咱', py: 'zan', freq: 55 }, { ch: '早', py: 'zao', freq: 55 }, { ch: '造', py: 'zao', freq: 55 }, { ch: '则', py: 'ze', freq: 55 },
  { ch: '怎', py: 'zen', freq: 55 }, { ch: '曾', py: 'ceng', freq: 55 }, { ch: '粘', py: 'zhan', freq: 55 }, { ch: '战', py: 'zhan', freq: 55 }, { ch: '站', py: 'zhan', freq: 55 }, { ch: '张', py: 'zhang', freq: 55 },
  { ch: '找', py: 'zhao', freq: 55 }, { ch: '赵', py: 'zhao', freq: 55 }, { ch: '照', py: 'zhao', freq: 55 }, { ch: '真', py: 'zhen', freq: 55 }, { ch: '征', py: 'zheng', freq: 55 }, { ch: '争', py: 'zheng', freq: 55 },
  { ch: '整', py: 'zheng', freq: 55 }, { ch: '正', py: 'zheng', freq: 55 }, { ch: '直', py: 'zhi', freq: 55 }, { ch: '指', py: 'zhi', freq: 55 }, { ch: '趾', py: 'zhi', freq: 55 }, { ch: '纸', py: 'zhi', freq: 55 },
  { ch: '志', py: 'zhi', freq: 55 }, { ch: '至', py: 'zhi', freq: 55 }, { ch: '致', py: 'zhi', freq: 55 }, { ch: '制', py: 'zhi', freq: 55 }, { ch: '秩', py: 'zhi', freq: 55 }, { ch: '治', py: 'zhi', freq: 55 },
  { ch: '钟', py: 'zhong', freq: 55 }, { ch: '终', py: 'zhong', freq: 55 }, { ch: '重', py: 'zhong', freq: 55 }, { ch: '众', py: 'zhong', freq: 55 }, { ch: '周', py: 'zhou', freq: 55 }, { ch: '瞩', py: 'zhu', freq: 55 },
  { ch: '主', py: 'zhu', freq: 55 }, { ch: '助', py: 'zhu', freq: 55 }, { ch: '住', py: 'zhu', freq: 55 }, { ch: '注', py: 'zhu', freq: 55 }, { ch: '专', py: 'zhuan', freq: 55 }, { ch: '转', py: 'zhuan', freq: 55 },
  { ch: '装', py: 'zhuang', freq: 55 }, { ch: '准', py: 'zhun', freq: 55 }, { ch: '淄', py: 'zi', freq: 55 }, { ch: '籽', py: 'zi', freq: 55 }, { ch: '字', py: 'zi', freq: 55 }, { ch: '鬃', py: 'zong', freq: 55 },
  { ch: '走', py: 'zou', freq: 55 }, { ch: '租', py: 'zu', freq: 55 }, { ch: '足', py: 'zu', freq: 55 }, { ch: '做', py: 'zuo', freq: 55 }, { ch: '坐', py: 'zuo', freq: 55 }, { ch: '座', py: 'zuo', freq: 55 },
  { ch: '苯', py: 'ben', freq: 54 }, { ch: '毖', py: 'bi', freq: 54 }, { ch: '币', py: 'bi', freq: 54 }, { ch: '鞭', py: 'bian', freq: 54 }, { ch: '辨', py: 'bian', freq: 54 }, { ch: '丙', py: 'bing', freq: 54 },
  { ch: '簿', py: 'bu', freq: 54 }, { ch: '掣', py: 'che', freq: 54 }, { ch: '橙', py: 'cheng', freq: 54 }, { ch: '赤', py: 'chi', freq: 54 }, { ch: '楚', py: 'chu', freq: 54 }, { ch: '串', py: 'chuan', freq: 54 },
  { ch: '吹', py: 'chui', freq: 54 }, { ch: '垂', py: 'chui', freq: 54 }, { ch: '辞', py: 'ci', freq: 54 }, { ch: '催', py: 'cui', freq: 54 }, { ch: '凳', py: 'deng', freq: 54 }, { ch: '翟', py: 'di', freq: 54 },
  { ch: '丢', py: 'diu', freq: 54 }, { ch: '痘', py: 'dou', freq: 54 }, { ch: '娥', py: 'e', freq: 54 }, { ch: '钒', py: 'fan', freq: 54 }, { ch: '肝', py: 'gan', freq: 54 }, { ch: '赣', py: 'gan', freq: 54 },
  { ch: '缸', py: 'gang', freq: 54 }, { ch: '梗', py: 'geng', freq: 54 }, { ch: '龚', py: 'gong', freq: 54 }, { ch: '刽', py: 'gui', freq: 54 }, { ch: '悍', py: 'han', freq: 54 }, { ch: '煌', py: 'huang', freq: 54 },
  { ch: '绩', py: 'ji', freq: 54 }, { ch: '集', py: 'ji', freq: 54 }, { ch: '忌', py: 'ji', freq: 54 }, { ch: '俭', py: 'jian', freq: 54 }, { ch: '饺', py: 'jiao', freq: 54 }, { ch: '窖', py: 'jiao', freq: 54 },
  { ch: '揭', py: 'jie', freq: 54 }, { ch: '巾', py: 'jin', freq: 54 }, { ch: '荆', py: 'jing', freq: 54 }, { ch: '兢', py: 'jing', freq: 54 }, { ch: '警', py: 'jing', freq: 54 }, { ch: '净', py: 'jing', freq: 54 },
  { ch: '惧', py: 'ju', freq: 54 }, { ch: '捐', py: 'juan', freq: 54 }, { ch: '眶', py: 'kuang', freq: 54 }, { ch: '旷', py: 'kuang', freq: 54 }, { ch: '扩', py: 'kuo', freq: 54 }, { ch: '琅', py: 'lang', freq: 54 },
  { ch: '雷', py: 'lei', freq: 54 }, { ch: '镭', py: 'lei', freq: 54 }, { ch: '帘', py: 'lian', freq: 54 }, { ch: '辆', py: 'liang', freq: 54 }, { ch: '陵', py: 'ling', freq: 54 }, { ch: '骡', py: 'luo', freq: 54 },
  { ch: '嘛', py: 'ma', freq: 54 }, { ch: '脉', py: 'mai', freq: 54 }, { ch: '瞒', py: 'man', freq: 54 }, { ch: '摩', py: 'mo', freq: 54 }, { ch: '撵', py: 'nian', freq: 54 }, { ch: '聂', py: 'nie', freq: 54 },
  { ch: '啮', py: 'nie', freq: 54 }, { ch: '派', py: 'pai', freq: 54 }, { ch: '胖', py: 'pang', freq: 54 }, { ch: '砰', py: 'peng', freq: 54 }, { ch: '票', py: 'piao', freq: 54 }, { ch: '剖', py: 'pou', freq: 54 },
  { ch: '瀑', py: 'pu', freq: 54 }, { ch: '畦', py: 'qi', freq: 54 }, { ch: '扦', py: 'qian', freq: 54 }, { ch: '呛', py: 'qiang', freq: 54 }, { ch: '柔', py: 'rou', freq: 54 }, { ch: '嗓', py: 'sang', freq: 54 },
  { ch: '赡', py: 'shan', freq: 54 }, { ch: '释', py: 'shi', freq: 54 }, { ch: '蜀', py: 'shu', freq: 54 }, { ch: '墅', py: 'shu', freq: 54 }, { ch: '朔', py: 'shuo', freq: 54 }, { ch: '梭', py: 'suo', freq: 54 },
  { ch: '堂', py: 'tang', freq: 54 }, { ch: '汀', py: 'ting', freq: 54 }, { ch: '廷', py: 'ting', freq: 54 }, { ch: '颓', py: 'tui', freq: 54 }, { ch: '歪', py: 'wai', freq: 54 }, { ch: '惋', py: 'wan', freq: 54 },
  { ch: '旺', py: 'wang', freq: 54 }, { ch: '沃', py: 'wo', freq: 54 }, { ch: '晤', py: 'wu', freq: 54 }, { ch: '嘻', py: 'xi', freq: 54 }, { ch: '悉', py: 'xi', freq: 54 }, { ch: '吓', py: 'xia', freq: 54 },
  { ch: '贤', py: 'xian', freq: 54 }, { ch: '削', py: 'xue', freq: 54 }, { ch: '歇', py: 'xie', freq: 54 }, { ch: '邪', py: 'xie', freq: 54 }, { ch: '兄', py: 'xiong', freq: 54 }, { ch: '袖', py: 'xiu', freq: 54 },
  { ch: '绪', py: 'xu', freq: 54 }, { ch: '眩', py: 'xuan', freq: 54 }, { ch: '熏', py: 'xun', freq: 54 }, { ch: '压', py: 'ya', freq: 54 }, { ch: '彦', py: 'yan', freq: 54 }, { ch: '药', py: 'yao', freq: 54 },
  { ch: '亿', py: 'yi', freq: 54 }, { ch: '隐', py: 'yin', freq: 54 }, { ch: '玉', py: 'yu', freq: 54 }, { ch: '云', py: 'yun', freq: 54 }, { ch: '陨', py: 'yun', freq: 54 }, { ch: '暂', py: 'zan', freq: 54 },
  { ch: '躁', py: 'zao', freq: 54 }, { ch: '扎', py: 'zha', freq: 54 }, { ch: '乍', py: 'zha', freq: 54 }, { ch: '瞻', py: 'zhan', freq: 54 }, { ch: '詹', py: 'zhan', freq: 54 }, { ch: '斩', py: 'zhan', freq: 54 },
  { ch: '招', py: 'zhao', freq: 54 }, { ch: '哲', py: 'zhe', freq: 54 }, { ch: '蔗', py: 'zhe', freq: 54 }, { ch: '镇', py: 'zhen', freq: 54 }, { ch: '挣', py: 'zheng', freq: 54 }, { ch: '枝', py: 'zhi', freq: 54 },
  { ch: '肿', py: 'zhong', freq: 54 }, { ch: '仲', py: 'zhong', freq: 54 }, { ch: '肘', py: 'zhou', freq: 54 }, { ch: '烛', py: 'zhu', freq: 54 }, { ch: '综', py: 'zong', freq: 54 }, { ch: '奏', py: 'zou', freq: 54 },
  { ch: '哎', py: 'ai', freq: 53 }, { ch: '笆', py: 'ba', freq: 53 }, { ch: '苞', py: 'bao', freq: 53 }, { ch: '宝', py: 'bao', freq: 53 }, { ch: '弊', py: 'bi', freq: 53 }, { ch: '陛', py: 'bi', freq: 53 },
  { ch: '卞', py: 'bian', freq: 53 }, { ch: '伯', py: 'bo', freq: 53 }, { ch: '菜', py: 'cai', freq: 53 }, { ch: '餐', py: 'can', freq: 53 }, { ch: '沧', py: 'cang', freq: 53 }, { ch: '厕', py: 'ce', freq: 53 },
  { ch: '叉', py: 'cha', freq: 53 }, { ch: '耻', py: 'chi', freq: 53 }, { ch: '葱', py: 'cong', freq: 53 }, { ch: '囱', py: 'cong', freq: 53 }, { ch: '匆', py: 'cong', freq: 53 }, { ch: '凑', py: 'cou', freq: 53 },
  { ch: '蹿', py: 'cuan', freq: 53 }, { ch: '丹', py: 'dan', freq: 53 }, { ch: '蒂', py: 'di', freq: 53 }, { ch: '缔', py: 'di', freq: 53 }, { ch: '甸', py: 'dian', freq: 53 }, { ch: '顿', py: 'dun', freq: 53 },
  { ch: '坟', py: 'fen', freq: 53 }, { ch: '符', py: 'fu', freq: 53 }, { ch: '埂', py: 'geng', freq: 53 }, { ch: '贡', py: 'gong', freq: 53 }, { ch: '股', py: 'gu', freq: 53 }, { ch: '瓜', py: 'gua', freq: 53 },
  { ch: '怪', py: 'guai', freq: 53 }, { ch: '逛', py: 'guang', freq: 53 }, { ch: '貉', py: 'hao', freq: 53 }, { ch: '洪', py: 'hong', freq: 53 }, { ch: '猴', py: 'hou', freq: 53 }, { ch: '恢', py: 'hui', freq: 53 },
  { ch: '蛔', py: 'hui', freq: 53 }, { ch: '籍', py: 'ji', freq: 53 }, { ch: '技', py: 'ji', freq: 53 }, { ch: '悸', py: 'ji', freq: 53 }, { ch: '疆', py: 'jiang', freq: 53 }, { ch: '酱', py: 'jiang', freq: 53 },
  { ch: '津', py: 'jin', freq: 53 }, { ch: '粳', py: 'jing', freq: 53 }, { ch: '颈', py: 'jing', freq: 53 }, { ch: '径', py: 'jing', freq: 53 }, { ch: '靖', py: 'jing', freq: 53 }, { ch: '玖', py: 'jiu', freq: 53 },
  { ch: '俱', py: 'ju', freq: 53 }, { ch: '苛', py: 'ke', freq: 53 }, { ch: '啃', py: 'ken', freq: 53 }, { ch: '况', py: 'kuang', freq: 53 }, { ch: '酪', py: 'lao', freq: 53 }, { ch: '吏', py: 'li', freq: 53 },
  { ch: '厉', py: 'li', freq: 53 }, { ch: '临', py: 'lin', freq: 53 }, { ch: '赁', py: 'lin', freq: 53 }, { ch: '岭', py: 'ling', freq: 53 }, { ch: '刘', py: 'liu', freq: 53 }, { ch: '柳', py: 'liu', freq: 53 },
  { ch: '孪', py: 'luan', freq: 53 }, { ch: '氓', py: 'mang', freq: 53 }, { ch: '忙', py: 'mang', freq: 53 }, { ch: '卯', py: 'mao', freq: 53 }, { ch: '贸', py: 'mao', freq: 53 }, { ch: '寐', py: 'mei', freq: 53 },
  { ch: '棉', py: 'mian', freq: 53 }, { ch: '秒', py: 'miao', freq: 53 }, { ch: '铭', py: 'ming', freq: 53 }, { ch: '摸', py: 'mo', freq: 53 }, { ch: '浓', py: 'nong', freq: 53 }, { ch: '盼', py: 'pan', freq: 53 },
  { ch: '呸', py: 'pei', freq: 53 }, { ch: '澎', py: 'peng', freq: 53 }, { ch: '碰', py: 'peng', freq: 53 }, { ch: '嵌', py: 'qian', freq: 53 }, { ch: '侨', py: 'qiao', freq: 53 }, { ch: '鞘', py: 'qiao', freq: 53 },
  { ch: '勤', py: 'qin', freq: 53 }, { ch: '趋', py: 'qu', freq: 53 }, { ch: '瓤', py: 'rang', freq: 53 }, { ch: '壤', py: 'rang', freq: 53 }, { ch: '扰', py: 'rao', freq: 53 }, { ch: '壬', py: 'ren', freq: 53 },
  { ch: '肉', py: 'rou', freq: 53 }, { ch: '杉', py: 'shan', freq: 53 }, { ch: '梢', py: 'shao', freq: 53 }, { ch: '奢', py: 'she', freq: 53 }, { ch: '枢', py: 'shu', freq: 53 }, { ch: '殊', py: 'shu', freq: 53 },
  { ch: '输', py: 'shu', freq: 53 }, { ch: '叔', py: 'shu', freq: 53 }, { ch: '私', py: 'si', freq: 53 }, { ch: '塑', py: 'su', freq: 53 }, { ch: '酸', py: 'suan', freq: 53 }, { ch: '抬', py: 'tai', freq: 53 },
  { ch: '坦', py: 'tan', freq: 53 }, { ch: '探', py: 'tan', freq: 53 }, { ch: '逃', py: 'tao', freq: 53 }, { ch: '誊', py: 'teng', freq: 53 }, { ch: '彤', py: 'tong', freq: 53 }, { ch: '陀', py: 'tuo', freq: 53 },
  { ch: '洼', py: 'wa', freq: 53 }, { ch: '桅', py: 'wei', freq: 53 }, { ch: '围', py: 'wei', freq: 53 }, { ch: '闻', py: 'wen', freq: 53 }, { ch: '舞', py: 'wu', freq: 53 }, { ch: '误', py: 'wu', freq: 53 },
  { ch: '溪', py: 'xi', freq: 53 }, { ch: '洗', py: 'xi', freq: 53 }, { ch: '锨', py: 'xian', freq: 53 }, { ch: '厢', py: 'xiang', freq: 53 }, { ch: '箱', py: 'xiang', freq: 53 }, { ch: '襄', py: 'xiang', freq: 53 },
  { ch: '肖', py: 'xiao', freq: 53 }, { ch: '械', py: 'xie', freq: 53 }, { ch: '胸', py: 'xiong', freq: 53 }, { ch: '序', py: 'xu', freq: 53 }, { ch: '雪', py: 'xue', freq: 53 }, { ch: '循', py: 'xun', freq: 53 },
  { ch: '颜', py: 'yan', freq: 53 }, { ch: '衍', py: 'yan', freq: 53 }, { ch: '鸯', py: 'yang', freq: 53 }, { ch: '邀', py: 'yao', freq: 53 }, { ch: '耶', py: 'ye', freq: 53 }, { ch: '依', py: 'yi', freq: 53 },
  { ch: '鹰', py: 'ying', freq: 53 }, { ch: '赢', py: 'ying', freq: 53 }, { ch: '犹', py: 'you', freq: 53 }, { ch: '酉', py: 'you', freq: 53 }, { ch: '予', py: 'yu', freq: 53 }, { ch: '浴', py: 'yu', freq: 53 },
  { ch: '展', py: 'zhan', freq: 53 }, { ch: '肇', py: 'zhao', freq: 53 }, { ch: '针', py: 'zhen', freq: 53 }, { ch: '枕', py: 'zhen', freq: 53 }, { ch: '蒸', py: 'zheng', freq: 53 }, { ch: '芝', py: 'zhi', freq: 53 },
  { ch: '蜘', py: 'zhi', freq: 53 }, { ch: '稚', py: 'zhi', freq: 53 }, { ch: '质', py: 'zhi', freq: 53 }, { ch: '篆', py: 'zhuan', freq: 53 }, { ch: '滓', py: 'zi', freq: 53 }, { ch: '罪', py: 'zui', freq: 53 },
  { ch: '癌', py: 'ai', freq: 52 }, { ch: '袄', py: 'ao', freq: 52 }, { ch: '镑', py: 'bang', freq: 52 }, { ch: '薄', py: 'bao', freq: 52 }, { ch: '饱', py: 'bao', freq: 52 }, { ch: '奔', py: 'ben', freq: 52 },
  { ch: '敝', py: 'bi', freq: 52 }, { ch: '斌', py: 'bin', freq: 52 }, { ch: '糙', py: 'cao', freq: 52 }, { ch: '潮', py: 'chao', freq: 52 }, { ch: '酬', py: 'chou', freq: 52 }, { ch: '触', py: 'chu', freq: 52 },
  { ch: '锤', py: 'chui', freq: 52 }, { ch: '崔', py: 'cui', freq: 52 }, { ch: '殆', py: 'dai', freq: 52 }, { ch: '捣', py: 'dao', freq: 52 }, { ch: '滴', py: 'di', freq: 52 }, { ch: '掂', py: 'dian', freq: 52 },
  { ch: '鼎', py: 'ding', freq: 52 }, { ch: '朵', py: 'duo', freq: 52 }, { ch: '额', py: 'e', freq: 52 }, { ch: '恶', py: 'e', freq: 52 }, { ch: '珐', py: 'fa', freq: 52 }, { ch: '番', py: 'fan', freq: 52 },
  { ch: '凡', py: 'fan', freq: 52 }, { ch: '返', py: 'fan', freq: 52 }, { ch: '枫', py: 'feng', freq: 52 }, { ch: '腑', py: 'fu', freq: 52 }, { ch: '溉', py: 'gai', freq: 52 }, { ch: '糕', py: 'gao', freq: 52 },
  { ch: '隔', py: 'ge', freq: 52 }, { ch: '鼓', py: 'gu', freq: 52 }, { ch: '瑰', py: 'gui', freq: 52 }, { ch: '耗', py: 'hao', freq: 52 }, { ch: '伙', py: 'huo', freq: 52 }, { ch: '祭', py: 'ji', freq: 52 },
  { ch: '稼', py: 'jia', freq: 52 }, { ch: '嫁', py: 'jia', freq: 52 }, { ch: '姜', py: 'jiang', freq: 52 }, { ch: '纠', py: 'jiu', freq: 52 }, { ch: '九', py: 'jiu', freq: 52 }, { ch: '咎', py: 'jiu', freq: 52 },
  { ch: '俊', py: 'jun', freq: 52 }, { ch: '坎', py: 'kan', freq: 52 }, { ch: '吭', py: 'keng', freq: 52 }, { ch: '挎', py: 'kua', freq: 52 }, { ch: '矿', py: 'kuang', freq: 52 }, { ch: '魁', py: 'kui', freq: 52 },
  { ch: '坤', py: 'kun', freq: 52 }, { ch: '拦', py: 'lan', freq: 52 }, { ch: '廊', py: 'lang', freq: 52 }, { ch: '烙', py: 'lao', freq: 52 }, { ch: '楞', py: 'leng', freq: 52 }, { ch: '僚', py: 'liao', freq: 52 },
  { ch: '疗', py: 'liao', freq: 52 }, { ch: '榴', py: 'liu', freq: 52 }, { ch: '瘤', py: 'liu', freq: 52 }, { ch: '窿', py: 'long', freq: 52 }, { ch: '搂', py: 'lou', freq: 52 }, { ch: '滤', py: 'lv', freq: 52 },
  { ch: '卵', py: 'luan', freq: 52 }, { ch: '猫', py: 'mao', freq: 52 }, { ch: '谋', py: 'mou', freq: 52 }, { ch: '奈', py: 'nai', freq: 52 }, { ch: '拟', py: 'ni', freq: 52 }, { ch: '碾', py: 'nian', freq: 52 },
  { ch: '怒', py: 'nu', freq: 52 }, { ch: '虐', py: 'nve', freq: 52 }, { ch: '趴', py: 'pa', freq: 52 }, { ch: '湃', py: 'pai', freq: 52 }, { ch: '判', py: 'pan', freq: 52 }, { ch: '乓', py: 'pang', freq: 52 },
  { ch: '庞', py: 'pang', freq: 52 }, { ch: '棚', py: 'peng', freq: 52 }, { ch: '啤', py: 'pi', freq: 52 }, { ch: '疲', py: 'pi', freq: 52 }, { ch: '屏', py: 'ping', freq: 52 }, { ch: '粕', py: 'po', freq: 52 },
  { ch: '旗', py: 'qi', freq: 52 }, { ch: '洽', py: 'qia', freq: 52 }, { ch: '俏', py: 'qiao', freq: 52 }, { ch: '怯', py: 'qie', freq: 52 }, { ch: '曲', py: 'qu', freq: 52 }, { ch: '冉', py: 'ran', freq: 52 },
  { ch: '阮', py: 'ruan', freq: 52 }, { ch: '洒', py: 'sa', freq: 52 }, { ch: '苫', py: 'shan', freq: 52 }, { ch: '虱', py: 'shi', freq: 52 }, { ch: '逝', py: 'shi', freq: 52 }, { ch: '适', py: 'shi', freq: 52 },
  { ch: '属', py: 'shu', freq: 52 }, { ch: '嗽', py: 'sou', freq: 52 }, { ch: '遂', py: 'sui', freq: 52 }, { ch: '索', py: 'suo', freq: 52 }, { ch: '瓦', py: 'wa', freq: 52 }, { ch: '婉', py: 'wan', freq: 52 },
  { ch: '枉', py: 'wang', freq: 52 }, { ch: '巫', py: 'wu', freq: 52 }, { ch: '吾', py: 'wu', freq: 52 }, { ch: '戏', py: 'xi', freq: 52 }, { ch: '宪', py: 'xian', freq: 52 }, { ch: '淆', py: 'xiao', freq: 52 },
  { ch: '斜', py: 'xie', freq: 52 }, { ch: '谐', py: 'xie', freq: 52 }, { ch: '泻', py: 'xie', freq: 52 }, { ch: '迅', py: 'xun', freq: 52 }, { ch: '厌', py: 'yan', freq: 52 }, { ch: '椅', py: 'yi', freq: 52 },
  { ch: '疫', py: 'yi', freq: 52 }, { ch: '翼', py: 'yi', freq: 52 }, { ch: '佑', py: 'you', freq: 52 }, { ch: '愚', py: 'yu', freq: 52 }, { ch: '栅', py: 'zha', freq: 52 }, { ch: '盏', py: 'zhan', freq: 52 },
  { ch: '占', py: 'zhan', freq: 52 }, { ch: '遮', py: 'zhe', freq: 52 }, { ch: '舟', py: 'zhou', freq: 52 }, { ch: '蛛', py: 'zhu', freq: 52 }, { ch: '赚', py: 'zhuan', freq: 52 }, { ch: '灼', py: 'zhuo', freq: 52 },
  { ch: '组', py: 'zu', freq: 52 }, { ch: '碍', py: 'ai', freq: 51 }, { ch: '隘', py: 'ai', freq: 51 }, { ch: '傲', py: 'ao', freq: 51 }, { ch: '谤', py: 'bang', freq: 51 }, { ch: '蹦', py: 'beng', freq: 51 },
  { ch: '搏', py: 'bo', freq: 51 }, { ch: '采', py: 'cai', freq: 51 }, { ch: '插', py: 'cha', freq: 51 }, { ch: '掺', py: 'can', freq: 51 }, { ch: '超', py: 'chao', freq: 51 }, { ch: '储', py: 'chu', freq: 51 },
  { ch: '闯', py: 'chuang', freq: 51 }, { ch: '戳', py: 'chuo', freq: 51 }, { ch: '雌', py: 'ci', freq: 51 }, { ch: '撮', py: 'cuo', freq: 51 }, { ch: '诞', py: 'dan', freq: 51 }, { ch: '档', py: 'dang', freq: 51 },
  { ch: '蹈', py: 'dao', freq: 51 }, { ch: '抖', py: 'dou', freq: 51 }, { ch: '渡', py: 'du', freq: 51 }, { ch: '垛', py: 'duo', freq: 51 }, { ch: '堕', py: 'duo', freq: 51 }, { ch: '饿', py: 'e', freq: 51 },
  { ch: '犯', py: 'fan', freq: 51 }, { ch: '妨', py: 'fang', freq: 51 }, { ch: '疯', py: 'feng', freq: 51 }, { ch: '府', py: 'fu', freq: 51 }, { ch: '缚', py: 'fu', freq: 51 }, { ch: '柑', py: 'gan', freq: 51 },
  { ch: '膏', py: 'gao', freq: 51 }, { ch: '庚', py: 'geng', freq: 51 }, { ch: '谷', py: 'gu', freq: 51 }, { ch: '灌', py: 'guan', freq: 51 }, { ch: '寒', py: 'han', freq: 51 }, { ch: '嚎', py: 'hao', freq: 51 },
  { ch: '秽', py: 'hui', freq: 51 }, { ch: '迹', py: 'ji', freq: 51 }, { ch: '继', py: 'ji', freq: 51 }, { ch: '歼', py: 'jian', freq: 51 }, { ch: '肩', py: 'jian', freq: 51 }, { ch: '键', py: 'jian', freq: 51 },
  { ch: '蕉', py: 'jiao', freq: 51 }, { ch: '酵', py: 'jiao', freq: 51 }, { ch: '筋', py: 'jin', freq: 51 }, { ch: '矩', py: 'ju', freq: 51 }, { ch: '娟', py: 'juan', freq: 51 }, { ch: '喀', py: 'ka', freq: 51 },
  { ch: '恳', py: 'ken', freq: 51 }, { ch: '酷', py: 'ku', freq: 51 }, { ch: '裤', py: 'ku', freq: 51 }, { ch: '框', py: 'kuang', freq: 51 }, { ch: '盔', py: 'kui', freq: 51 }, { ch: '鲤', py: 'li', freq: 51 },
  { ch: '炼', py: 'lian', freq: 51 }, { ch: '聊', py: 'liao', freq: 51 }, { ch: '鳞', py: 'lin', freq: 51 }, { ch: '娄', py: 'lou', freq: 51 }, { ch: '鲁', py: 'lu', freq: 51 }, { ch: '赂', py: 'lu', freq: 51 },
  { ch: '绿', py: 'lv', freq: 51 }, { ch: '慢', py: 'man', freq: 51 }, { ch: '谩', py: 'man', freq: 51 }, { ch: '鸣', py: 'ming', freq: 51 }, { ch: '莫', py: 'mo', freq: 51 }, { ch: '穆', py: 'mu', freq: 51 },
  { ch: '妮', py: 'ni', freq: 51 }, { ch: '脓', py: 'nong', freq: 51 }, { ch: '农', py: 'nong', freq: 51 }, { ch: '呕', py: 'ou', freq: 51 }, { ch: '啪', py: 'pa', freq: 51 }, { ch: '潘', py: 'pan', freq: 51 },
  { ch: '炮', py: 'pao', freq: 51 }, { ch: '培', py: 'pei', freq: 51 }, { ch: '蓬', py: 'peng', freq: 51 }, { ch: '拼', py: 'pin', freq: 51 }, { ch: '埔', py: 'pu', freq: 51 }, { ch: '谱', py: 'pu', freq: 51 },
  { ch: '欺', py: 'qi', freq: 51 }, { ch: '脐', py: 'qi', freq: 51 }, { ch: '迄', py: 'qi', freq: 51 }, { ch: '悄', py: 'qiao', freq: 51 }, { ch: '撬', py: 'qiao', freq: 51 }, { ch: '倾', py: 'qing', freq: 51 },
  { ch: '颧', py: 'quan', freq: 51 }, { ch: '拳', py: 'quan', freq: 51 }, { ch: '雀', py: 'que', freq: 51 }, { ch: '绒', py: 'rong', freq: 51 }, { ch: '塞', py: 'sai', freq: 51 }, { ch: '筛', py: 'shai', freq: 51 },
  { ch: '邵', py: 'shao', freq: 51 }, { ch: '肾', py: 'shen', freq: 51 }, { ch: '甥', py: 'sheng', freq: 51 }, { ch: '饰', py: 'shi', freq: 51 }, { ch: '瘦', py: 'shou', freq: 51 }, { ch: '漱', py: 'shu', freq: 51 },
  { ch: '吮', py: 'shun', freq: 51 }, { ch: '肆', py: 'si', freq: 51 }, { ch: '伺', py: 'ci', freq: 51 }, { ch: '粟', py: 'su', freq: 51 }, { ch: '檀', py: 'tan', freq: 51 }, { ch: '掏', py: 'tao', freq: 51 },
  { ch: '嚏', py: 'ti', freq: 51 }, { ch: '恬', py: 'tian', freq: 51 }, { ch: '屠', py: 'tu', freq: 51 }, { ch: '推', py: 'tui', freq: 51 }, { ch: '蛙', py: 'wa', freq: 51 }, { ch: '纹', py: 'wen', freq: 51 },
  { ch: '钨', py: 'wu', freq: 51 }, { ch: '午', py: 'wu', freq: 51 }, { ch: '析', py: 'xi', freq: 51 }, { ch: '檄', py: 'xi', freq: 51 }, { ch: '狭', py: 'xia', freq: 51 }, { ch: '夏', py: 'xia', freq: 51 },
  { ch: '鲜', py: 'xian', freq: 51 }, { ch: '险', py: 'xian', freq: 51 }, { ch: '恤', py: 'xu', freq: 51 }, { ch: '絮', py: 'xu', freq: 51 }, { ch: '喧', py: 'xuan', freq: 51 }, { ch: '艳', py: 'yan', freq: 51 },
  { ch: '舀', py: 'yao', freq: 51 }, { ch: '沂', py: 'yi', freq: 51 }, { ch: '蚁', py: 'yi', freq: 51 }, { ch: '役', py: 'yi', freq: 51 }, { ch: '臆', py: 'yi', freq: 51 }, { ch: '肄', py: 'yi', freq: 51 },
  { ch: '阴', py: 'yin', freq: 51 }, { ch: '虞', py: 'yu', freq: 51 }, { ch: '郁', py: 'yu', freq: 51 }, { ch: '遇', py: 'yu', freq: 51 }, { ch: '冤', py: 'yuan', freq: 51 }, { ch: '辕', py: 'yuan', freq: 51 },
  { ch: '晕', py: 'yun', freq: 51 }, { ch: '攒', py: 'zan', freq: 51 }, { ch: '噪', py: 'zao', freq: 51 }, { ch: '贼', py: 'zei', freq: 51 }, { ch: '轧', py: 'ya', freq: 51 }, { ch: '榨', py: 'zha', freq: 51 },
  { ch: '斋', py: 'zhai', freq: 51 }, { ch: '樟', py: 'zhang', freq: 51 }, { ch: '帐', py: 'zhang', freq: 51 }, { ch: '仗', py: 'zhang', freq: 51 }, { ch: '甄', py: 'zhen', freq: 51 }, { ch: '振', py: 'zhen', freq: 51 },
  { ch: '植', py: 'zhi', freq: 51 }, { ch: '炙', py: 'zhi', freq: 51 }, { ch: '忠', py: 'zhong', freq: 51 }, { ch: '轴', py: 'zhou', freq: 51 }, { ch: '砖', py: 'zhuan', freq: 51 }, { ch: '庄', py: 'zhuang', freq: 51 },
  { ch: '状', py: 'zhuang', freq: 51 }, { ch: '祖', py: 'zu', freq: 51 }, { ch: '哀', py: 'ai', freq: 50 }, { ch: '肮', py: 'ang', freq: 50 }, { ch: '伴', py: 'ban', freq: 50 }, { ch: '绊', py: 'ban', freq: 50 },
  { ch: '闭', py: 'bi', freq: 50 }, { ch: '摈', py: 'bin', freq: 50 }, { ch: '颤', py: 'chan', freq: 50 }, { ch: '巢', py: 'chao', freq: 50 }, { ch: '耽', py: 'dan', freq: 50 }, { ch: '胆', py: 'dan', freq: 50 },
  { ch: '碘', py: 'dian', freq: 50 }, { ch: '典', py: 'dian', freq: 50 }, { ch: '镀', py: 'du', freq: 50 }, { ch: '短', py: 'duan', freq: 50 }, { ch: '鹅', py: 'e', freq: 50 }, { ch: '俯', py: 'fu', freq: 50 },
  { ch: '负', py: 'fu', freq: 50 }, { ch: '附', py: 'fu', freq: 50 }, { ch: '秆', py: 'gan', freq: 50 }, { ch: '沽', py: 'gu', freq: 50 }, { ch: '贵', py: 'gui', freq: 50 }, { ch: '航', py: 'hang', freq: 50 },
  { ch: '壕', py: 'hao', freq: 50 }, { ch: '轰', py: 'hong', freq: 50 }, { ch: '唤', py: 'huan', freq: 50 }, { ch: '灰', py: 'hui', freq: 50 }, { ch: '荤', py: 'hun', freq: 50 }, { ch: '祸', py: 'huo', freq: 50 },
  { ch: '济', py: 'ji', freq: 50 }, { ch: '舰', py: 'jian', freq: 50 }, { ch: '涧', py: 'jian', freq: 50 }, { ch: '郊', py: 'jiao', freq: 50 }, { ch: '劫', py: 'jie', freq: 50 }, { ch: '烬', py: 'jin', freq: 50 },
  { ch: '竞', py: 'jing', freq: 50 }, { ch: '竣', py: 'jun', freq: 50 }, { ch: '括', py: 'kuo', freq: 50 }, { ch: '辣', py: 'la', freq: 50 }, { ch: '砾', py: 'li', freq: 50 }, { ch: '梁', py: 'liang', freq: 50 },
  { ch: '烈', py: 'lie', freq: 50 }, { ch: '菱', py: 'ling', freq: 50 }, { ch: '侣', py: 'lv', freq: 50 }, { ch: '虑', py: 'lv', freq: 50 }, { ch: '迷', py: 'mi', freq: 50 }, { ch: '囊', py: 'nang', freq: 50 },
  { ch: '镊', py: 'nie', freq: 50 }, { ch: '柠', py: 'ning', freq: 50 }, { ch: '暖', py: 'nuan', freq: 50 }, { ch: '糯', py: 'nuo', freq: 50 }, { ch: '诺', py: 'nuo', freq: 50 }, { ch: '磐', py: 'pan', freq: 50 },
  { ch: '刨', py: 'pao', freq: 50 }, { ch: '盆', py: 'pen', freq: 50 }, { ch: '凭', py: 'ping', freq: 50 }, { ch: '翘', py: 'qiao', freq: 50 }, { ch: '茄', py: 'jia', freq: 50 }, { ch: '丘', py: 'qiu', freq: 50 },
  { ch: '区', py: 'qu', freq: 50 }, { ch: '娶', py: 'qu', freq: 50 }, { ch: '劝', py: 'quan', freq: 50 }, { ch: '饶', py: 'rao', freq: 50 }, { ch: '忍', py: 'ren', freq: 50 }, { ch: '润', py: 'run', freq: 50 },
  { ch: '散', py: 'san', freq: 50 }, { ch: '啥', py: 'sha', freq: 50 }, { ch: '舌', py: 'she', freq: 50 }, { ch: '湿', py: 'shi', freq: 50 }, { ch: '鼠', py: 'shu', freq: 50 }, { ch: '霜', py: 'shuang', freq: 50 },
  { ch: '顺', py: 'shun', freq: 50 }, { ch: '唐', py: 'tang', freq: 50 }, { ch: '腾', py: 'teng', freq: 50 }, { ch: '梯', py: 'ti', freq: 50 }, { ch: '惕', py: 'ti', freq: 50 }, { ch: '屯', py: 'tun', freq: 50 },
  { ch: '妥', py: 'tuo', freq: 50 }, { ch: '玩', py: 'wan', freq: 50 }, { ch: '汪', py: 'wang', freq: 50 }, { ch: '慰', py: 'wei', freq: 50 }, { ch: '夕', py: 'xi', freq: 50 }, { ch: '匣', py: 'xia', freq: 50 },
  { ch: '闲', py: 'xian', freq: 50 }, { ch: '刑', py: 'xing', freq: 50 }, { ch: '徐', py: 'xu', freq: 50 }, { ch: '叙', py: 'xu', freq: 50 }, { ch: '押', py: 'ya', freq: 50 }, { ch: '鸭', py: 'ya', freq: 50 },
  { ch: '淹', py: 'yan', freq: 50 }, { ch: '氧', py: 'yang', freq: 50 }, { ch: '野', py: 'ye', freq: 50 }, { ch: '曳', py: 'ye', freq: 50 }, { ch: '仪', py: 'yi', freq: 50 }, { ch: '裔', py: 'yi', freq: 50 },
  { ch: '绎', py: 'yi', freq: 50 }, { ch: '悠', py: 'you', freq: 50 }, { ch: '匀', py: 'yun', freq: 50 }, { ch: '阵', py: 'zhen', freq: 50 }, { ch: '皱', py: 'zhou', freq: 50 }, { ch: '朱', py: 'zhu', freq: 50 },
  { ch: '诸', py: 'zhu', freq: 50 }, { ch: '锥', py: 'zhui', freq: 50 }, { ch: '阻', py: 'zu', freq: 50 }, { ch: '嘴', py: 'zui', freq: 50 },
  { ch: '嗯', py: 'en', freq: 74 }, { ch: '噢', py: 'o', freq: 72 }, { ch: '咦', py: 'yi', freq: 70 }, { ch: '诶', py: 'ei', freq: 68 }, { ch: '嘞', py: 'lei', freq: 66 }, { ch: '呗', py: 'bei', freq: 66 }, { ch: '嗨', py: 'hai', freq: 66 }, { ch: '噫', py: 'yi', freq: 62 }, { ch: '哦', py: 'o', freq: 72 }, { ch: '喔', py: 'o', freq: 66 }, { ch: '咯', py: 'ge', freq: 64 }, { ch: '嘛', py: 'ma', freq: 66 }, { ch: '啦', py: 'la', freq: 66 }, { ch: '哟', py: 'yo', freq: 64 }, { ch: '哎', py: 'ai', freq: 66 }, { ch: '呵', py: 'he', freq: 64 },
];

  // 从 COMMON_WORD_LIB 派生（一次性构建，惰性缓存）
  let _pinyinMap = null;      // { 字: 拼音 }
  let _byPinyin = null;       // { 拼音: [字,...] } 同音分组（候选池用）
  let _freqWeights = null;    // 加权选字用的累计权重数组

  function ensureDerived() {
    if (_pinyinMap) return;
    _pinyinMap = {};
    _byPinyin = {};
    const weights = [];
    let acc = 0;
    for (const w of COMMON_WORD_LIB) {
      if (isBadWord(w.ch)) continue; // 兜底：黑名单字不进任何派生结构
      _pinyinMap[w.ch] = w.py;
      (_byPinyin[w.py] = _byPinyin[w.py] || []).push(w.ch);
      acc += w.freq;
      weights.push({ ch: w.ch, acc: acc });
    }
    _freqWeights = { list: weights, total: acc };
  }

  // 随机选一个字（按 freq 加权，模拟真人打字习惯）
  function randomChar(rng) {
    ensureDerived();
    const r = (typeof rng === 'function') ? rng : Math.random;
    const fw = _freqWeights;
    const t = r() * fw.total;
    for (const w of fw.list) { if (t < w.acc) return w.ch; }
    return fw.list.length ? fw.list[fw.list.length - 1].ch : '好';
  }

  // 字 → 拼音（查不到回退随机假拼音）
  function pinyinOf(ch, rng) {
    ensureDerived();
    if (_pinyinMap[ch]) return _pinyinMap[ch];
    if (/[\u4e00-\u9fa5]/.test(ch)) {
      const r = (typeof rng === 'function') ? rng : Math.random;
      const c1 = 'bcdfghjklmnpqrstwxyz'[Math.floor(r() * 22)];
      const vowels = 'aoeiu';
      const c2 = vowels[Math.floor(r() * vowels.length)];
      return c1 + c2 + (r() < 0.5 ? 'n' : '');
    }
    return '';
  }

  // 候选字（真·同音分组：目标字的同拼音字优先，不足用字库高频字补）
  function candidatesOf(targetChar, count, rng) {
    ensureDerived();
    const r = (typeof rng === 'function') ? rng : Math.random;
    const n = count || 5;
    const set = [];
    if (!isBadWord(targetChar)) set.push(targetChar);
    const py = _pinyinMap[targetChar];
    if (py && _byPinyin[py]) {
      for (const c of _byPinyin[py]) {
        if (set.length >= n) break;
        if (isBadWord(c)) continue;
        if (set.indexOf(c) >= 0) continue;
        set.push(c);
      }
    }
    // 同音不足，用字库高频字补（跳过黑名单/已存在）
    if (set.length < n) {
      for (const w of _freqWeights.list) {
        if (set.length >= n) break;
        if (isBadWord(w.ch)) continue;
        if (set.indexOf(w.ch) >= 0) continue;
        set.push(w.ch);
      }
    }
    while (set.length < n) set.push('好');
    const arr = set.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ==========================================================================
  // 脏字黑名单（badWordBlacklist）——候选字池兜底过滤。
  // 作用：无论候选池如何扩充、或目标字本身命中脏字，只要出现在黑名单，
  //       就绝不进入「可被选中的候选列表」，从一开始就没有被选中的可能。
  // 说明：只拦截「候选演出道具」，绝不改写最终文本（generator 铁律不受影响）。
  // ==========================================================================
  const BAD_WORD_BLACKLIST = [
    // 粗话/脏话单字（含口语化脏字，覆盖常见粗鲁用语的核心字）
    '操', '艹', '肏', '屌', '屄', '逼', '傻', '蠢', '呆', '笨',
    '贱', '骚', '浪', '荡', '淫', '娼', '妓', '嫖', '奸', '畜',
    '牲', '狗', '猪', '驴', '龟', '鳖', '蛋', '屁', '屎', '尿',
    '粪', '尸', '鬼', '死', '亡', '丧', '咒', '诅', '骂', '滚',
    '蛋', '捅', '砍', '杀', '炸', '焚', '殴', '捶', '砸', '摔'
  ];

  // 是否命中脏字黑名单
  function isBadWord(ch) {
    return BAD_WORD_BLACKLIST.indexOf(ch) >= 0;
  }

  const data = {
    CFG,
    COMMON_WORD_LIB,

    // 随机选一个字（按频率加权）——generateContent 拼句用
    randomChar: randomChar,

    // 字 → 拼音
    pinyinOf: pinyinOf,

    // 候选字（真同音分组）
    candidatesOf: candidatesOf,

    // 生成最终文本对应的拼音串（演出道具；按字拆，逐字返回拼音）
    // 返回 string[]，与文本逐字对齐（非中文字符原样保留）
    buildPinyin: function (text) {
      const s = String(text || '');
      const out = [];
      for (const ch of s) {
        if (/[\u4e00-\u9fa5]/.test(ch)) out.push(pinyinOf(ch));
        else out.push(''); // 标点/空格等不上拼音
      }
      return out;
    },

    // 生成候选字 chip（针对单个目标字）
    buildCandidates: function (pinyin, targetChar) {
      return candidatesOf(targetChar, 5 + Math.floor(Math.random() * 3)); // 5~7 个
    },

    // 配置读取（20261008：开关已迁移到 chatSettings.typecardOn，此函数仅作兼容占位，已无调用方）
    isEnabled: async function () {
      try { return !!(await global.getSetting(CFG.on, false)); } catch (e) { return false; }
    },
    level: async function () {
      try { return await global.getSetting(CFG.level, 'auto'); } catch (e) { return 'auto'; }
    },

    // ========================================================================
    // 字卡/表情资源池（eventManager 专用演出道具，纯数据、无 DOM、无业务）
    // ========================================================================

    // 字卡池：{ label, bg, color } 纯色占位字卡（白日梦深色紫风格），
    // 后续可替换为主线的真实字卡资源。label 为字卡上显示的单字/短词。
    cardPool: [
      { label: '梦', bg: '#3a2b6e', color: '#e9e4ff' },
      { label: '星', bg: '#2c3e7a', color: '#cfe0ff' },
      { label: '心', bg: '#5a2b5e', color: '#ffd7ef' },
      { label: '想', bg: '#2b5e5e', color: '#d7fff2' },
      { label: '暖', bg: '#6e3a2b', color: '#ffe9d7' },
      { label: '甜', bg: '#5e2b4a', color: '#ffd7e8' }
    ],

    // 表情池：单字符 emoji（演出道具，不落正文）
    emojiPool: ['😊', '✨', '🌙', '💜', '🌸', '🌟', '💫', '🥰'],

    // 脏字黑名单（候选字池兜底过滤；详情见 BAD_WORD_BLACKLIST 定义）
    badWordBlacklist: BAD_WORD_BLACKLIST,

    // 是否命中黑名单
    isBadWord: isBadWord
  };

  global.bmTypecardData = data;
})(typeof window !== 'undefined' ? window : this);
