# -*- coding: utf-8 -*-
"""
白日梦「角色搜视频」真实视频库抓取脚本（B站）—— 稳定版
策略（避免 search/type 风控封 IP）：
  1. 主抓：ranking/v2 分区排行榜接口（稳定不封），按分区抓热门
  2. 垂直分类（传讯/梦占/塔罗/水晶/小说/社会历史）：从「知识区+生活区+娱乐区」抓一批热门，
     再按标题关键词本地筛选归类（搜索接口不稳定，仅低频兜底）
  3. 输出 deploy/www/js/videolib.json
用法：python fetch_videolib.py
"""
import urllib.request, urllib.parse, json, io, sys, time, ssl, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
    'Accept': 'application/json',
}

def get(url):
    req = urllib.request.Request(url, headers=HDR)
    try:
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'_err': str(e)}

def clean_title(t):
    return re.sub(r'<[^>]+>', '', (t or '')).strip()

def to_item(bvid, title, pic, owner, duration=None, view=None, pubdate=None):
    c = pic or ''
    if c.startswith('//'):
        c = 'https:' + c
    elif c.startswith('http://'):
        c = 'https://' + c[7:]  # 去掉 http://，换成 https://
    it = {
        'platform': 'bilibili',
        'bvid': bvid,
        'title': title,
        'cover': c,
        'author': owner or '',
    }
    if duration is not None: it['duration'] = duration
    if view is not None: it['view'] = view
    if pubdate is not None: it['pubdate'] = pubdate  # 20261106：发布时间戳，用于「只抓近期热门」过滤
    return it

# 20261106：日期过滤——只留「最近 15 天内」的热门，优先级「7 天内」>「15 天内」。
#   RECENT_DAYS：硬上限（超过直接丢弃）；PRIORITY_DAYS：优先保留区间（排序时靠前）。
RECENT_DAYS = 15
PRIORITY_DAYS = 7

def _age_days(pubdate, now=None):
    """返回距今天数（无法解析则返回大值，视为超期丢弃）"""
    if not pubdate:
        return 99999
    now = now if now is not None else int(time.time())
    return (now - int(pubdate)) / 86400.0

def _recent_score(pubdate, now=None):
    """按发布时间给分：越新分越高；7 天内给高权重，15 天内给基础权重，超期 0 分（丢弃）"""
    d = _age_days(pubdate, now)
    if d > RECENT_DAYS:
        return 0.0
    if d <= PRIORITY_DAYS:
        return 100.0 - d * 5.0        # 7 天内：100~65，越新越高
    return 60.0 - (d - PRIORITY_DAYS)  # 8~15 天：59~52


# 分区热门：走 ranking/v2（稳定不封）
# rid: 动漫1 音乐3 游戏4 娱乐5 知识36 生活160 影视181 科技188 时尚155 纪录片177 国创167
# 20261106：动漫去掉模型拼装/抽象鬼畜，保留混剪、可加 BJD 娃娃；娱乐不再用明星霸榜的娱乐榜，改关键词定向
RID_CATS = [
    ('动漫', 1, 25, 2),       # 多抓几条，供后续过滤模型拼装/抽象鬼畜，并筛手书/混剪
    ('音乐', 3, 10, 1),       # 有一起听歌，从搞笑匀 5 条过来
    ('知识', 36, 20, 2),
    ('生活', 160, 20, 2),
    ('影视', 181, 20, 1),     # 多抓几条，供过滤明星综艺类
]

# 垂直分类：从已抓热门里按标题关键词归类（不够再用低频搜索接口补）
# (分类名, 关键词列表, 目标条数, 权重)
# 20261106：传讯梦占从垂直归类中抽出，单独按「梦觉传讯为主 + 大众占卜加多 + 宇宙/能量传讯减少」定向抓
VERTICAL_CATS = [
    ('塔罗玄学', ['塔罗', '占卜', '灵性', '玄学', '星座', '命运', '命理'], 15, 3),
    ('治愈陪伴', ['治愈', '陪伴', '睡前', '助眠', '白噪音', '温暖', '安心'], 10, 2),
    ('小说', ['小说', '网文', '故事', '有声书', '推文', '听书', '爽文'], 10, 2),
    ('社会历史', ['历史', '社会', '时事', '人文', '考古', '王朝', '纪录片', '讲史'], 10, 2),
]

# 传讯梦占定向抓取（优先级从高到低）：梦角传讯最多、大众占卜其次、宇宙/能量传讯少量
# 每个 (关键词, 目标条数)
CHUANXUN_SEQ = [
    (['梦角传讯', '梦角', '梦占传讯', '梦境传讯'], 10),   # 梦角传讯：大头
    (['大众占卜', '大众塔罗', '集体传讯', '有缘人传讯'], 6),  # 大众占卜：多一点
    (['宇宙传讯', '能量传讯', '天使传讯'], 4),                # 宇宙/能量传讯：少量
]

# 20261106：去掉「搞笑/娱乐」分类，替换为「vlog」+「生活记录」两个分类（用户需求）
#   vlog：UP 主日常 vlog / 一日 vlog / 生活向 vlog
#   生活记录：记录生活的日常视频（不搞笑、不娱乐向）
VLOG_KWS = ['vlog', '日常vlog', '一日vlog', '生活vlog', '我的vlog']
LIFE_RECORD_KWS = ['生活记录', '记录生活', '我的日常', '生活日常', '平凡的一天', '日常生活']

# 手书分区：单独用搜索接口精准抓（MAD/手书/动画手书）
SHOUSHU_KWS = ['手书', 'MAD', '动画手书', '手书动画']

# BJD 娃娃补充关键词（动漫区补足用）
BJD_KWS = ['BJD娃娃', 'BJD', 'bjd娃娃', '娃圈', '手办模型']

# 水晶分类：标题关键词匹配不到，单独用低频搜索接口补（用户的爱好，值得精准搜）
CRYSTAL_KWS = ['水晶疗愈', '天然水晶', '水晶石', '能量水晶']

# 20261106：小动物分类（猫咪为主、狗狗次之）——独立分类，抓 15 条
PET_KWS = ['猫咪', '猫', '小猫', '萌猫', '猫奴', '狗狗', '小狗', '萌宠', '可爱猫咪', '可爱狗狗']
# 20261106：宇宙星际科普——并入「社会历史」分类，额外 +7 条
COSMOS_KWS = ['宇宙科普', '星际科普', '天文科普', '黑洞', '银河系', '星球', '宇宙奥秘', '太空']
# 20261106：电影——并入「影视」分类，额外 +8 条
MOVIE_KWS = ['电影解说', '经典电影', '电影混剪', '高分电影', '电影推荐', '影评', '电影片段']

def fetch_ranking(rid, n):
    out = []
    url = 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=%d&type=all' % rid
    j = get(url)
    if '_err' in j or j.get('code') != 0:
        time.sleep(3.0)  # 风控后等 3 秒重试一次
        j = get(url)
    if '_err' in j or j.get('code') != 0:
        return out
    for it in (j.get('data', {}).get('list') or [])[:n]:
        if not it.get('bvid'):
            continue
        owner = (it.get('owner') or {}).get('name', '')
        out.append(to_item(it['bvid'], clean_title(it.get('title', '')), it.get('pic', ''), owner,
                           it.get('duration'), (it.get('stat') or {}).get('view'), it.get('pubdate')))
    return out

def match_vertical(item):
    """返回命中的垂直分类名（无则 None）"""
    t = item['title']
    for cat, kws, n, w in VERTICAL_CATS:
        for kw in kws:
            if kw in t:
                return cat
    return None

# 动漫区要过滤掉的内容（模型拼装、抽象鬼畜）
ANIME_DROP_KWS = ['模型', '拼装', '手办', '合金', '鬼畜', '抽象', '高达', '积木', '乐高', '擎天柱', '变形金刚', '龙']
# 影视区要过滤掉的内容（明星综艺类）
FILM_DROP_KWS = ['综艺', '明星', '练习生', '选秀', '饭制', 'cover', '直拍', '娱乐新闻', '气象主播', '模仿', '好物', 'vlog', '采访', '红毯', '直播']

def search_videos(kws, need, stop_after_fill=True):
    """低频搜索接口抓视频，返回去重后的列表（最多 need 条）"""
    out = []
    seen = set()
    for kw in kws:
        if stop_after_fill and len(out) >= need:
            break
        url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%s&page=1&page_size=%d' % (urllib.parse.quote(kw), need)
        j = get(url)
        if '_err' in j or j.get('code') != 0:
            time.sleep(2.0)
            continue
        for it in (j.get('data', {}).get('result') or []):
            if not it.get('bvid') or it['bvid'] in seen:
                continue
            if len(out) >= need:
                break
            out.append(to_item(it['bvid'], clean_title(it.get('title', '')),
                it.get('pic', ''), (it.get('author') or ''), it.get('duration'), it.get('play'), it.get('pubdate')))
            seen.add(it['bvid'])
        time.sleep(2.0)  # 低频，避免风控
    return out

def parse_duration_sec(d):
    """把 B 站 duration 字符串（如 '3:05' / '12:34' / '1:02:03'）转成秒；解析失败返回 None"""
    if not d:
        return None
    try:
        parts = [int(x) for x in str(d).split(':')]
        if len(parts) == 2:
            return parts[0] * 60 + parts[1]
        if len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        return None
    except Exception:
        return None

# 20261106：短视频优先——长视频（>30 分钟）降权、短视频（≤10 分钟）加权，
#   避免只抓长视频。只调整排序权重，不硬性丢弃（保证分类条数凑得齐）。
def _short_video_score(item):
    sec = parse_duration_sec(item.get('duration'))
    if sec is None:
        return 0.0
    if sec <= 10 * 60:
        return 15.0          # 短视频：强加权
    if sec <= 30 * 60:
        return 5.0           # 中视频：小加权
    if sec > 90 * 60:
        return -15.0         # 超长（>90 分钟）：降权
    return 0.0

def _rank_recent(items):
    """综合「发布时间 + 短视频」打分排序，并过滤掉超 15 天的；返回排序后的列表"""
    now = int(time.time())
    scored = []
    for it in items:
        s = _recent_score(it.get('pubdate'), now)
        if s <= 0:
            continue          # 超 15 天，丢弃
        s += _short_video_score(it)
        scored.append((s, it))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [it for _, it in scored]

def main():
    lib = {}
    # 1. 分区热门（动漫/音乐/知识/生活/影视）
    for cat, rid, n, w in RID_CATS:
        items = fetch_ranking(rid, n)
        lib.setdefault(cat, [])
        seen = {x['bvid'] for x in lib[cat]}
        for it in items:
            if it['bvid'] not in seen:
                lib[cat].append(it); seen.add(it['bvid'])
        print('[分区] %s(rid=%d) 抓到 %d 条' % (cat, rid, len(items)))
        time.sleep(2.5)

    # 2. 动漫区过滤：去掉模型拼装/抽象鬼畜（BJD 娃娃保留）
    if '动漫' in lib:
        before = len(lib['动漫'])
        lib['动漫'] = [it for it in lib['动漫'] if not any(k in it['title'] for k in ANIME_DROP_KWS)]
        print('[过滤] 动漫 去掉模型拼装/抽象鬼畜：%d -> %d 条' % (before, len(lib['动漫'])))
        # 动漫不足则用「混剪/手书/BJD」搜索补
        need = 20
        if len(lib['动漫']) < need:
            extra = search_videos(['动画混剪', '动漫混剪', 'BJD娃娃', 'BJD', 'bjd娃娃', '手书'], need - len(lib['动漫']))
            seen = {x['bvid'] for x in lib['动漫']}
            for it in extra:
                if it['bvid'] not in seen:
                    lib['动漫'].append(it); seen.add(it['bvid'])
            lib['动漫'] = lib['动漫'][:need]
            print('[补足] 动漫 搜索补充后 %d 条' % len(lib['动漫']))

    # 3. 影视区过滤：去掉明星综艺类
    if '影视' in lib:
        before = len(lib['影视'])
        lib['影视'] = [it for it in lib['影视'] if not any(k in it['title'] for k in FILM_DROP_KWS)]
        print('[过滤] 影视 去掉明星综艺类：%d -> %d 条' % (before, len(lib['影视'])))
        # 影视不足则用「电影解说/混剪」搜索补
        # 20261106：影视 12 -> 20 条（含电影 +8 条）
        need = 20
        if len(lib['影视']) < need:
            extra = search_videos(['电影解说', '影视混剪', '电影混剪', '剧集解说'], need - len(lib['影视']))
            seen = {x['bvid'] for x in lib['影视']}
            for it in extra:
                if it['bvid'] not in seen:
                    lib['影视'].append(it); seen.add(it['bvid'])
            lib['影视'] = lib['影视'][:need]
            print('[补足] 影视 搜索补充后 %d 条' % len(lib['影视']))
        # 20261106：电影并入影视——额外补电影向视频，总目标 20 条
        if len(lib['影视']) < need:
            extra2 = search_videos(MOVIE_KWS, need - len(lib['影视']))
            seen2 = {x['bvid'] for x in lib['影视']}
            for it in extra2:
                if it['bvid'] not in seen2 and len(lib['影视']) < need:
                    lib['影视'].append(it); seen2.add(it['bvid'])
            lib['影视'] = lib['影视'][:need]
            print('[电影并入] 影视 补电影后 %d 条' % len(lib['影视']))

    # 4. 20261106：去掉「娱乐/搞笑」，替换为「vlog」+「生活记录」两个分类（用户需求）
    vlog = search_videos(VLOG_KWS, 10)
    lib['vlog'] = vlog
    print('[搜索] vlog 抓到 %d 条' % len(vlog))
    liferec = search_videos(LIFE_RECORD_KWS, 10)
    lib['生活记录'] = liferec
    print('[搜索] 生活记录 抓到 %d 条' % len(liferec))

    # 5. 手书分区：走搜索接口精准抓
    shoushu = search_videos(SHOUSHU_KWS, 10)
    lib['手书'] = shoushu
    print('[搜索] 手书 抓到 %d 条' % len(shoushu))

    # 5.5 传讯梦占：定向抓取（梦觉传讯为主 + 大众占卜 + 少量宇宙/能量传讯）
    chuanxun = []
    seen_cx = set()
    for kws, need in CHUANXUN_SEQ:
        got = search_videos(kws, need)
        for it in got:
            if it['bvid'] not in seen_cx and len(chuanxun) < 20:
                chuanxun.append(it); seen_cx.add(it['bvid'])
    lib['传讯梦占'] = chuanxun
    print('[定向] 传讯梦占 抓到 %d 条' % len(chuanxun))

    # 6. 垂直分类：从知识/生活/动漫/影视 里按标题关键词归类
    big_pool = []
    for cat in ['知识', '生活', '动漫', '影视']:
        big_pool.extend(lib.get(cat, []))
    seen_pool = {}
    for it in big_pool:
        seen_pool.setdefault(it['bvid'], it)
    big_pool = list(seen_pool.values())

    vertical = {}
    for it in big_pool:
        cat = match_vertical(it)
        if cat:
            vertical.setdefault(cat, [])
            if len(vertical[cat]) < 30:
                vertical[cat].append(it)

    # 7. 垂直分类不够的，用搜索接口补（每次只搜 1 词，间隔 2s）
    def search_supplement(cat, kws, need):
        got = len(vertical.get(cat, []))
        if got >= need:
            return
        extra = search_videos(kws, need - got)
        vertical.setdefault(cat, [])
        seenv = {x['bvid'] for x in vertical[cat]}
        for it in extra:
            if it['bvid'] not in seenv and len(vertical[cat]) < need:
                vertical[cat].append(it); seenv.add(it['bvid'])

    for cat, kws, n, w in VERTICAL_CATS:
        search_supplement(cat, kws, n)

    # 8. 水晶分类：单独用搜索接口补
    search_supplement('水晶', CRYSTAL_KWS, 10)

    # 8.5 20261106：小动物分类（猫咪为主 + 狗狗）——独立分类，抓 15 条
    pets = search_videos(PET_KWS, 15)
    lib['小动物'] = pets
    print('[搜索] 小动物 抓到 %d 条' % len(pets))

    # 9. 合并：垂直分类作为独立分类写入 lib
    for cat, items in vertical.items():
        lib[cat] = items[:30]

    # 9.5 20261106：宇宙星际科普——并入「社会历史」分类（社会历史 10 -> 17 条）
    sh = lib.get('社会历史', [])
    if len(sh) < 10:
        # 社会历史本身不足 10 条时先用历史关键词补
        extra_sh = search_videos(['历史', '社会', '时事', '人文', '考古', '王朝', '纪录片', '讲史'], 10 - len(sh))
        seen_sh = {x['bvid'] for x in sh}
        for it in extra_sh:
            if it['bvid'] not in seen_sh and len(sh) < 10:
                sh.append(it); seen_sh.add(it['bvid'])
    # 再额外 +7 条宇宙星际科普（目标 17 条）
    cosmos = search_videos(COSMOS_KWS, 7)
    seen_sh2 = {x['bvid'] for x in sh}
    for it in cosmos:
        if it['bvid'] not in seen_sh2 and len(sh) < 17:
            sh.append(it); seen_sh2.add(it['bvid'])
    lib['社会历史'] = sh
    print('[宇宙并入] 社会历史 补宇宙科普后 %d 条' % len(sh))

    # 10. 20261106：统一收尾——每个分类按「发布时间近（7天内优先）+ 短视频」排序，
    #    过滤掉超 15 天的老视频，保证线上视频库都是「近期热门」，不掺 24/25 年老视频。
    for cat in list(lib.keys()):
        before = len(lib.get(cat, []))
        lib[cat] = _rank_recent(lib.get(cat, []))
        if len(lib[cat]) < before:
            print('[日期过滤] %s 去掉 %d 条超期视频' % (cat, before - len(lib[cat])))

    total = sum(len(v) for v in lib.values())
    out = {
        'version': 1,
        'updatedAt': int(time.time()),
        'categories': lib,
    }
    # 输出路径：本地开发环境输出到 deploy/www/js/，GitHub Actions 输出到 www/js/
    import os
    if os.path.isdir('deploy/www/js'):
        path = 'deploy/www/js/videolib.json'
    else:
        path = 'www/js/videolib.json'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print('\n=== 汇总 ===')
    for k, v in lib.items():
        print('  %-8s %d 条' % (k, len(v)))
    print('  总计 %d 条 -> %s' % (total, path))

if __name__ == '__main__':
    main()
