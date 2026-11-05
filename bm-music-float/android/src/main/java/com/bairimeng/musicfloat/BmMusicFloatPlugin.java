package com.bairimeng.musicfloat;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.PathParser;
import androidx.core.graphics.drawable.RoundedBitmapDrawable;
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 白日梦「一起听歌」原生悬浮窗插件（20261105，独立插件，与 bm-overlay 模拟通话悬浮窗互不共用）。
 *
 * 把软件内的一起听歌三级悬浮窗（dot → mini → card）浮到系统层（其他应用之上），
 * 完整复刻软件内的布局、功能、图标、控制键：
 *
 *   1号 dot     ：封面圆点（真实图片 / ♪ 占位），点击展开 → mini
 *   2号 mini    ：双头像（我 + TA）+ 歌名 + 艺术家 + 歌词 + 播放/暂停按钮 + 收起按钮
 *   3号 card    ：大卡——双头像 + 一起听标签 + 一起听时长 + 结束按钮 + 封面 + 歌名/艺术家
 *                 + 歌词 + 进度条（可拖动 seek）+ 控制键排（模式/上一首/播放暂停/下一首/列表）
 *                 + 右下角拖拽缩放
 *   任意形态     ：拖动 = 移动位置（跨应用）；双击 = 进入白日梦应用
 *   列表按钮     ：弹「迷你播放列表」（封面+歌名+歌手，约 1/3 长度，半透明小卡片），
 *                 与软件内悬浮窗的迷你列表同款，点某行切歌。
 *
 * 状态同步：JS 端在切歌/播放/暂停/进度变化时调用 update() 推送歌曲状态；原生层负责
 * 显示 + 按钮回传事件（onToggle/onPrev/onNext/onSeek/onMode/onList/onEnd/onEnterApp/onCollapse）。
 *
 * 图标：原生层用 Path 绘制与 icons.js 完全相同的 SVG path（24x24 视窗、stroke 1.8、
 * 圆角端点），绝不用 emoji 替换任何图标/按键。
 *
 * 闪退加固（与 bm-overlay 一致）：全路径 catch Throwable；双击回应用先 moveToFront、
 * 悬浮窗移除延后一帧；图片解码采样压缩防 OOM。
 */
@CapacitorPlugin(name = "BmMusicFloat")
public class BmMusicFloatPlugin extends Plugin {

    private WindowManager windowManager;
    private ViewGroup overlayRoot;
    private WindowManager.LayoutParams layoutParams;
    private boolean viewAttached = false;

    /* 当前形态：0=dot 1=mini 2=card */
    private int form = 0;

    /* 歌曲状态（JS 推送） */
    private String title = "";
    private String artist = "";
    private Bitmap coverBmp = null;
    private String lyric = "";
    /* 20261105：完整歌词行（逐句 {t,text}），原生层本地推进高亮/滚动，复刻软件内滚动歌词 */
    private java.util.List<float[]> lyricTimes = new java.util.ArrayList<float[]>();   // 每句开始秒
    private java.util.List<String> lyricTexts = new java.util.ArrayList<String>();      // 每句文本
    private boolean playing = false;
    private int positionSec = 0;
    private int durationSec = 0;
    private String playMode = "order";      // once | order | one | shuffle
    private String charName = null;         // null=单人
    private Bitmap charAvatarBmp = null;
    private Bitmap myAvatarBmp = null;
    private String myName = "我";
    private String togetherText = "";
    private boolean together = false;

    /* 悬浮窗主题（跟随软件内「文字深浅」与「背景玻璃/浅底/深底」设置） */
    private String textMode = "dark";     // light | dark
    private String bgMode = "glass";      // glass | light | dark

    /* 播放列表（迷你列表用，JS 推送） */
    private java.util.List<JSObject> miniPlaylist = new java.util.ArrayList<JSObject>();
    private int miniPlayIndex = -1;

    /* 三形态视图引用 */
    private View dotView, miniView;
    private ViewGroup cardView;   // cardHost 是 FrameLayout，需 getChildAt/addView
    private ImageView dotCover;
    private TextView dotPlaceholder;
    private FrameLayout miniAvMine, miniAvTa, cardAvMine, cardAvTa;
    private TextView miniTitle, miniArtist, miniLyric;
    private TextView cardTitle, cardArtist, cardLyric, cardTogetherTime, cardEndBtn;
    private ImageView cardCover;
    private TextView cardCoverPlaceholder;
    private android.widget.ScrollView cardLyricScroll;    // 20261105：可滚动歌词区
    private TextView cardLyricLines;                       // 多行歌词（逐句高亮）
    private int lyricActiveIdx = -1;                       // 当前高亮句下标
    private IconBtn modeBtn, listBtn, ppBtn, prevBtn, nextBtn;
    private IconBtn miniPpBtn, miniCollapseBtn, cardCollapseBtn;

    /* 迷你播放列表视图 */
    private View miniListPanel;

    /* 进度条 */
    private View progressTrack;
    private FrameLayout progressThumb;
    private TextView progCurText, progDurText;
    private boolean seeking = false;

    /* 原生计时（进度本地自增，JS 冻结时依旧跳动） */
    private Handler tickHandler = null;
    private Runnable tickRunnable = null;
    private long tickStartElapsed = 0;
    private int tickBaseSec = 0;

    /* 2号缩放 */
    private float cardScale = 1f;
    private int cardNaturalW = 0, cardNaturalH = 0;

    /* 颜色 */
    private static final int ICON_COLOR = 0xFFE6E1F5;        // 主图标淡紫白
    private static final int ICON_COLOR_MUTED = 0xFFB8A6FF;   // 次图标淡紫
    private static final int ACCENT = 0xFF7C5CFC;             // 主紫

    /* ============ 1. 权限 ============ */

    @PluginMethod
    public void checkPermission(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("granted", canDrawOverlay(getContext()));
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        try {
            boolean granted = canDrawOverlay(getContext());
            if (granted) {
                JSObject ret = new JSObject();
                ret.put("granted", true);
                call.resolve(ret);
                return;
            }
            Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("openedSettings", true);
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("openedSettings", false);
            call.resolve(ret);
        }
    }

    private boolean canDrawOverlay(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return android.provider.Settings.canDrawOverlays(ctx);
            }
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /* ============ 2. 显示 / 更新 / 隐藏 ============ */

    @PluginMethod
    public void show(PluginCall call) {
        try {
            if (!canDrawOverlay(getContext())) {
                resolve(call, false, "no_permission");
                return;
            }
            applyState(call);
            showOverlay();
            resolve(call, true, null);
        } catch (Throwable t) {
            resolve(call, false, String.valueOf(t.getMessage()));
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        try {
            applyState(call);
            refreshAll();
            resolve(call, true, null);
        } catch (Throwable t) {
            resolve(call, false, String.valueOf(t.getMessage()));
        }
    }

    @PluginMethod
    public void hide(PluginCall call) {
        try {
            stopTicking();
            removeOverlay();
            resolve(call, true, null);
        } catch (Throwable t) {
            resolve(call, false, String.valueOf(t.getMessage()));
        }
    }

    private void resolve(PluginCall call, boolean ok, String reason) {
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        if (reason != null) ret.put("reason", reason);
        call.resolve(ret);
    }

    /* 把 PluginCall 里的字段应用到成员 */
    private void applyState(PluginCall call) {
        if (call.hasOption("title")) title = call.getString("title", "");
        if (call.hasOption("artist")) artist = call.getString("artist", "");
        if (call.hasOption("cover")) {
            String cover = call.getString("cover", "");
            if (cover != null && cover.length() > 0) {
                Bitmap b = decodeDataUrl(cover, 256);
                if (b != null) coverBmp = b;
            } else {
                coverBmp = null;
            }
        }
        if (call.hasOption("lyric")) lyric = call.getString("lyric", "");
        // 20261105：完整歌词行数组 [{t,text}]，原生本地推进高亮/滚动
        if (call.hasOption("lyricLines")) {
            lyricTimes.clear(); lyricTexts.clear();
            try {
                org.json.JSONArray arr = call.getArray("lyricLines");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        try {
                            org.json.JSONObject o = arr.optJSONObject(i);
                            if (o != null) {
                                lyricTimes.add(new float[]{(float) o.optDouble("t", 0)});
                                lyricTexts.add(o.optString("text", ""));
                            }
                        } catch (Throwable t) {}
                    }
                }
            } catch (Throwable t) {}
        }
        if (call.hasOption("playing")) playing = call.getBoolean("playing", false);
        Integer p = call.getInt("position");
        if (p != null) positionSec = p;
        Integer d = call.getInt("duration");
        if (d != null) durationSec = d;
        if (call.hasOption("mode")) playMode = call.getString("mode", "order");
        if (call.hasOption("charName")) charName = call.getString("charName");
        if (call.hasOption("charAvatar")) {
            String ca = call.getString("charAvatar", "");
            if (ca != null && ca.length() > 0) {
                Bitmap b = decodeDataUrl(ca, 128);
                if (b != null) charAvatarBmp = b;
            } else {
                charAvatarBmp = null;
            }
        }
        if (call.hasOption("myAvatar")) {
            String ma = call.getString("myAvatar", "");
            if (ma != null && ma.length() > 0) {
                Bitmap b = decodeDataUrl(ma, 128);
                if (b != null) myAvatarBmp = b;
            } else {
                myAvatarBmp = null;
            }
        }
        if (call.hasOption("myName")) myName = call.getString("myName", "我");
        if (call.hasOption("togetherText")) togetherText = call.getString("togetherText", "");
        if (call.hasOption("together")) together = call.getBoolean("together", false);
        // 悬浮窗主题：文字深浅 + 背景档位（跟随软件内音乐悬浮窗样式设置）
        if (call.hasOption("textMode")) textMode = "light".equals(call.getString("textMode")) ? "light" : "dark";
        if (call.hasOption("bgMode")) {
            String b = call.getString("bgMode");
            bgMode = ("light".equals(b) || "dark".equals(b)) ? b : "glass";
        }
        // 迷你播放列表
        if (call.hasOption("playlist")) {
            miniPlaylist.clear();
            try {
                org.json.JSONArray arr = call.getArray("playlist");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        try {
                            org.json.JSONObject o = arr.optJSONObject(i);
                            if (o != null) miniPlaylist.add(JSObject.fromJSONObject(o));
                        } catch (Throwable t) { /* 单行跳过 */ }
                    }
                }
            } catch (Throwable t) {}
        }
        Integer pi = call.getInt("playIndex");
        if (pi != null) miniPlayIndex = pi;
    }

    /* ============ 内部实现：构建悬浮窗 ============ */

    private void showOverlay() {
        stopTicking();
        removeOverlay();
        form = 0;
        cardScale = 1f;

        windowManager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);

        FrameLayout root = new FrameLayout(getContext());
        root.setTag("bm-mf-root");
        root.setClipChildren(false);
        overlayRoot = root;

        buildDot(root);
        buildMini(root);
        buildCard(root);

        refreshAll();

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        layoutParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = dp(24);
        layoutParams.y = dp(160);

        windowManager.addView(root, layoutParams);
        viewAttached = true;

        bindRootGesture(root);
        startTicking();
    }

    /* —— 1号 dot：封面圆点 —— */
    private void buildDot(FrameLayout root) {
        FrameLayout dot = new FrameLayout(getContext());
        dot.setTag("bm-mf-dot");
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(0xE61C1824);
        dotBg.setStroke(dp(1), 0x33FFFFFF);
        dot.setBackground(dotBg);
        dot.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, android.graphics.Outline outline) {
                try { outline.setOval(0, 0, view.getWidth(), view.getHeight()); } catch (Throwable t) {}
            }
        });
        dot.setClipToOutline(true);

        dotCover = new ImageView(getContext());
        dotCover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        dotCover.setVisibility(View.GONE);
        dot.addView(dotCover, new FrameLayout.LayoutParams(dp(48), dp(48)));

        dotPlaceholder = new TextView(getContext());
        dotPlaceholder.setText("♪");
        dotPlaceholder.setTextColor(0xFFB8A6FF);
        dotPlaceholder.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        dotPlaceholder.setGravity(Gravity.CENTER);
        dot.addView(dotPlaceholder, new FrameLayout.LayoutParams(dp(48), dp(48)));

        dot.setLayoutParams(new FrameLayout.LayoutParams(dp(48), dp(48)));
        dotView = dot;
        root.addView(dot);
    }

    /* —— 2号 mini：双头像 + 歌名/艺术家/歌词 + 播放暂停 + 收起 —— */
    private void buildMini(FrameLayout root) {
        LinearLayout mini = new LinearLayout(getContext());
        mini.setTag("bm-mf-mini");
        mini.setOrientation(LinearLayout.HORIZONTAL);
        mini.setGravity(Gravity.CENTER_VERTICAL);
        GradientDrawable miniBg = new GradientDrawable();
        miniBg.setColor(0xF21C1824);
        miniBg.setCornerRadius(dp(20));
        miniBg.setStroke(dp(1), 0x33FFFFFF);
        mini.setBackground(miniBg);
        mini.setPadding(dp(10), dp(10), dp(10), dp(10));

        FrameLayout avs = new FrameLayout(getContext());
        miniAvMine = makeAvatar(dp(34), "我");
        miniAvTa = makeAvatar(dp(34), "TA");
        avs.addView(miniAvMine, new FrameLayout.LayoutParams(dp(34), dp(34)));
        FrameLayout.LayoutParams taLp = new FrameLayout.LayoutParams(dp(34), dp(34));
        taLp.leftMargin = dp(18);
        avs.addView(miniAvTa, taLp);
        mini.addView(avs, new LinearLayout.LayoutParams(dp(52), dp(34)));

        LinearLayout info = new LinearLayout(getContext());
        info.setOrientation(LinearLayout.VERTICAL);
        info.setPadding(dp(8), 0, 0, 0);
        miniTitle = makeText(13, Color.WHITE, true);
        info.addView(miniTitle);
        miniArtist = makeText(11, 0xFFB8A6FF, false);
        info.addView(miniArtist);
        miniLyric = makeText(10, 0xFF9A92B5, false);
        info.addView(miniLyric);
        LinearLayout.LayoutParams infoLp = new LinearLayout.LayoutParams(dp(138), ViewGroup.LayoutParams.WRAP_CONTENT);
        mini.addView(info, infoLp);

        miniPpBtn = new IconBtn(getContext(), ICONS_PLAY, ICON_COLOR, dp(34), dp(14), 0xFF322B40);
        miniPpBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { fireJsEvent("onToggle", new JSObject()); } catch (Throwable t) {} }
        });
        LinearLayout.LayoutParams ppLp = new LinearLayout.LayoutParams(dp(34), dp(34));
        ppLp.leftMargin = dp(6);
        mini.addView(miniPpBtn, ppLp);

        miniCollapseBtn = new IconBtn(getContext(), ICONS_CLOSE, 0xFFC9CDD8, dp(30), dp(11), 0x00000000);
        miniCollapseBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { collapseFloat(); } catch (Throwable t) {} }
        });
        LinearLayout.LayoutParams clLp = new LinearLayout.LayoutParams(dp(30), dp(30));
        clLp.leftMargin = dp(2);
        mini.addView(miniCollapseBtn, clLp);

        mini.setVisibility(View.GONE);
        miniView = mini;
        root.addView(mini, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    /* —— 3号 card：完整大卡 —— */
    private void buildCard(FrameLayout root) {
        cardNaturalW = dp(300);
        cardNaturalH = dp(430);   // 20261105：+20 给可滚动歌词区（原 410 会被 64px 歌词区挤压裁掉控制键）

        FrameLayout cardHost = new FrameLayout(getContext());
        cardHost.setTag("bm-mf-cardhost");
        cardHost.setClipChildren(false);
        cardHost.setVisibility(View.GONE);

        FrameLayout card = new FrameLayout(getContext());
        card.setTag("bm-mf-card");
        card.setClipChildren(false);
        card.setPivotX(0f);
        card.setPivotY(0f);
        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(0xF21C1824);
        cardBg.setCornerRadius(dp(22));
        cardBg.setStroke(dp(1), 0x33FFFFFF);
        card.setBackground(cardBg);
        card.setElevation(dp(6));

        LinearLayout cardUi = new LinearLayout(getContext());
        cardUi.setOrientation(LinearLayout.VERTICAL);
        cardUi.setGravity(Gravity.CENTER_HORIZONTAL);
        cardUi.setPadding(dp(14), dp(12), dp(14), dp(10));

        /* 头部：双头像 + 一起听标签/时长 + 结束 + 收起 */
        LinearLayout headRow = new LinearLayout(getContext());
        headRow.setOrientation(LinearLayout.HORIZONTAL);
        headRow.setGravity(Gravity.CENTER_VERTICAL);

        FrameLayout headAvs = new FrameLayout(getContext());
        cardAvMine = makeAvatar(dp(40), "我");
        cardAvTa = makeAvatar(dp(40), "TA");
        headAvs.addView(cardAvMine, new FrameLayout.LayoutParams(dp(40), dp(40)));
        FrameLayout.LayoutParams taHlp = new FrameLayout.LayoutParams(dp(40), dp(40));
        taHlp.leftMargin = dp(24);
        headAvs.addView(cardAvTa, taHlp);
        headRow.addView(headAvs, new LinearLayout.LayoutParams(dp(64), dp(40)));

        LinearLayout midHead = new LinearLayout(getContext());
        midHead.setOrientation(LinearLayout.VERTICAL);
        midHead.setPadding(dp(10), 0, 0, 0);
        TextView togetherLabel = makeText(13, Color.WHITE, true);
        togetherLabel.setText("一起听歌");
        midHead.addView(togetherLabel);
        cardTogetherTime = makeText(11, 0xFFB8A6FF, false);
        midHead.addView(cardTogetherTime);
        headRow.addView(midHead, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        cardEndBtn = new TextView(getContext());
        cardEndBtn.setText("结束");
        cardEndBtn.setTextColor(0xFFFF8A8A);
        cardEndBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        cardEndBtn.setGravity(Gravity.CENTER);
        GradientDrawable endBg = new GradientDrawable();
        endBg.setCornerRadius(dp(12));
        endBg.setColor(0x33141019);
        endBg.setStroke(dp(1), 0x33FF8A8A);
        cardEndBtn.setBackground(endBg);
        cardEndBtn.setPadding(dp(10), dp(4), dp(10), dp(4));
        cardEndBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { fireJsEvent("onEnd", new JSObject()); } catch (Throwable t) {} }
        });
        headRow.addView(cardEndBtn, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        cardCollapseBtn = new IconBtn(getContext(), ICONS_CLOSE, 0xFFC9CDD8, dp(30), dp(11), 0x00000000);
        cardCollapseBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { collapseFloat(); } catch (Throwable t) {} }
        });
        LinearLayout.LayoutParams ccLp = new LinearLayout.LayoutParams(dp(30), dp(30));
        ccLp.leftMargin = dp(4);
        headRow.addView(cardCollapseBtn, ccLp);

        cardUi.addView(headRow, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        /* 封面 */
        FrameLayout coverFrame = new FrameLayout(getContext());
        cardCoverPlaceholder = new TextView(getContext());
        cardCoverPlaceholder.setText("♪");
        cardCoverPlaceholder.setTextColor(0xFFB8A6FF);
        cardCoverPlaceholder.setTextSize(TypedValue.COMPLEX_UNIT_SP, 48);
        cardCoverPlaceholder.setGravity(Gravity.CENTER);
        GradientDrawable phBg = new GradientDrawable();
        phBg.setCornerRadius(dp(16));
        phBg.setColor(0xFF1A1428);
        cardCoverPlaceholder.setBackground(phBg);
        cardCover = new ImageView(getContext());
        cardCover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cardCover.setVisibility(View.GONE);
        cardCover.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, android.graphics.Outline outline) {
                try { outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), dp(16)); } catch (Throwable t) {}
            }
        });
        cardCover.setClipToOutline(true);
        coverFrame.addView(cardCoverPlaceholder, new FrameLayout.LayoutParams(dp(150), dp(150)));
        coverFrame.addView(cardCover, new FrameLayout.LayoutParams(dp(150), dp(150)));
        LinearLayout.LayoutParams coverLp = new LinearLayout.LayoutParams(dp(150), dp(150));
        coverLp.topMargin = dp(14);
        cardUi.addView(coverFrame, coverLp);

        /* 歌名 / 艺术家 */
        cardTitle = makeText(16, Color.WHITE, true);
        cardTitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleLp.topMargin = dp(12);
        cardUi.addView(cardTitle, titleLp);

        cardArtist = makeText(12, 0xFFB8A6FF, false);
        cardArtist.setGravity(Gravity.CENTER);
        cardUi.addView(cardArtist, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        /* 歌词：20261105 改成可滚动歌词区——逐句渲染，当前句高亮 + 滚动居中，复刻软件内滚动歌词 */
        cardLyric = makeText(11, 0xFF9A92B5, false);
        cardLyric.setGravity(Gravity.CENTER);
        cardLyric.setVisibility(View.GONE);   // 有逐句歌词时隐藏单行，无歌词时才用它显示「暂无歌词」
        LinearLayout.LayoutParams lyricLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lyricLp.topMargin = dp(6);
        cardUi.addView(cardLyric, lyricLp);

        cardLyricScroll = new android.widget.ScrollView(getContext());
        cardLyricScroll.setVerticalScrollBarEnabled(false);
        cardLyricScroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        cardLyricLines = new TextView(getContext());
        cardLyricLines.setTextColor(0xFF9A92B5);
        cardLyricLines.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        cardLyricLines.setGravity(Gravity.CENTER);
        cardLyricLines.setLineSpacing(0f, 1.5f);
        cardLyricLines.setPadding(0, dp(6), 0, dp(6));
        cardLyricScroll.addView(cardLyricLines, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams lyScrollLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64));
        lyScrollLp.topMargin = dp(2);
        cardUi.addView(cardLyricScroll, lyScrollLp);

        /* 进度条 */
        buildProgress(cardUi);

        /* 控制键排 */
        LinearLayout ctrlRow = new LinearLayout(getContext());
        ctrlRow.setOrientation(LinearLayout.HORIZONTAL);
        ctrlRow.setGravity(Gravity.CENTER_VERTICAL);

        modeBtn = new IconBtn(getContext(), ICONS_REPEAT, ICON_COLOR_MUTED, dp(40), dp(15), 0x00000000);
        modeBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { fireJsEvent("onMode", new JSObject()); } catch (Throwable t) {} }
        });
        ctrlRow.addView(modeBtn, new LinearLayout.LayoutParams(dp(40), dp(40)));

        prevBtn = new IconBtn(getContext(), ICONS_PREV, ICON_COLOR, dp(44), dp(17), 0xFF322B40);
        prevBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { fireJsEvent("onPrev", new JSObject()); } catch (Throwable t) {} }
        });
        LinearLayout.LayoutParams prevLp = new LinearLayout.LayoutParams(dp(44), dp(44));
        prevLp.leftMargin = dp(8);
        ctrlRow.addView(prevBtn, prevLp);

        ppBtn = new IconBtn(getContext(), ICONS_PLAY, ICON_COLOR, dp(56), dp(21), ACCENT);
        ppBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { fireJsEvent("onToggle", new JSObject()); } catch (Throwable t) {} }
        });
        LinearLayout.LayoutParams ppCLp = new LinearLayout.LayoutParams(dp(56), dp(56));
        ppCLp.leftMargin = dp(10);
        ctrlRow.addView(ppBtn, ppCLp);

        nextBtn = new IconBtn(getContext(), ICONS_NEXT, ICON_COLOR, dp(44), dp(17), 0xFF322B40);
        nextBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { fireJsEvent("onNext", new JSObject()); } catch (Throwable t) {} }
        });
        LinearLayout.LayoutParams nextLp = new LinearLayout.LayoutParams(dp(44), dp(44));
        nextLp.leftMargin = dp(8);
        ctrlRow.addView(nextBtn, nextLp);

        listBtn = new IconBtn(getContext(), ICONS_LIST, ICON_COLOR_MUTED, dp(40), dp(15), 0x00000000);
        listBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { toggleMiniList(); } catch (Throwable t) {} }
        });
        LinearLayout.LayoutParams listLp = new LinearLayout.LayoutParams(dp(40), dp(40));
        listLp.leftMargin = dp(8);
        ctrlRow.addView(listBtn, listLp);

        LinearLayout.LayoutParams ctrlLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        ctrlLp.topMargin = dp(14);
        cardUi.addView(ctrlRow, ctrlLp);

        card.addView(cardUi, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        /* 右下角缩放手柄（⤢ 用 expand 图标绘制，不用 emoji） */
        IconBtn resizeHandle = new IconBtn(getContext(), ICONS_EXPAND, ICON_COLOR_MUTED, dp(38), dp(13), 0x66141019);
        FrameLayout.LayoutParams rhLp = new FrameLayout.LayoutParams(dp(38), dp(38));
        rhLp.gravity = Gravity.BOTTOM | Gravity.END;
        rhLp.bottomMargin = dp(12);
        rhLp.rightMargin = dp(10);
        card.addView(resizeHandle, rhLp);
        resizeHandle.setOnTouchListener(new View.OnTouchListener() {
            float sx = 0, sy = 0, baseScale = 1f;
            @Override
            public boolean onTouch(View v, MotionEvent e) {
                try {
                    switch (e.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            sx = e.getRawX(); sy = e.getRawY(); baseScale = cardScale; return true;
                        case MotionEvent.ACTION_MOVE: {
                            float s = baseScale + ((e.getRawX() - sx) + (e.getRawY() - sy)) / 700f;
                            cardScale = Math.max(0.5f, Math.min(1.2f, s));
                            applyCardWindowSize();
                            return true;
                        }
                        default: return true;
                    }
                } catch (Throwable t) { return true; }
            }
        });

        cardHost.addView(card, new FrameLayout.LayoutParams(cardNaturalW, cardNaturalH));
        cardView = cardHost;
        root.addView(cardHost, new FrameLayout.LayoutParams(cardNaturalW, cardNaturalH));
    }

    /* —— 进度条（可拖动 seek） —— */
    private void buildProgress(LinearLayout parent) {
        LinearLayout progRow = new LinearLayout(getContext());
        progRow.setOrientation(LinearLayout.HORIZONTAL);
        progRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams progLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        progLp.topMargin = dp(10);
        progLp.bottomMargin = dp(4);

        progCurText = makeText(10, 0xFF9A92B5, false);
        progCurText.setText("00:00");
        progRow.addView(progCurText);

        final FrameLayout trackWrap = new FrameLayout(getContext());
        trackWrap.setPadding(dp(4), 0, dp(4), 0);
        LinearLayout.LayoutParams twLp = new LinearLayout.LayoutParams(0, dp(24), 1f);
        twLp.leftMargin = dp(8);
        twLp.rightMargin = dp(8);
        progRow.addView(trackWrap, twLp);

        progressTrack = new View(getContext());
        GradientDrawable trackBg = new GradientDrawable();
        trackBg.setColor(0x33FFFFFF);
        trackBg.setCornerRadius(dp(2));
        progressTrack.setBackground(trackBg);
        FrameLayout.LayoutParams trackLp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4));
        trackLp.gravity = Gravity.CENTER_VERTICAL;
        trackWrap.addView(progressTrack, trackLp);

        progressThumb = new FrameLayout(getContext());
        GradientDrawable thumbBg = new GradientDrawable();
        thumbBg.setShape(GradientDrawable.OVAL);
        thumbBg.setColor(ACCENT);
        progressThumb.setBackground(thumbBg);
        FrameLayout.LayoutParams thumbLp = new FrameLayout.LayoutParams(dp(16), dp(16));
        thumbLp.gravity = Gravity.CENTER_VERTICAL;
        trackWrap.addView(progressThumb, thumbLp);

        trackWrap.setOnTouchListener(new View.OnTouchListener() {
            float downX = 0;
            boolean dragging = false;
            int startPos = 0;
            @Override
            public boolean onTouch(View v, MotionEvent e) {
                try {
                    switch (e.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            dragging = true; seeking = true;
                            downX = e.getRawX(); startPos = positionSec;
                            return true;
                        case MotionEvent.ACTION_MOVE: {
                            if (!dragging) return true;
                            int w = trackWrap.getWidth() - dp(8);
                            if (w <= 0 || durationSec <= 0) return true;
                            float dx = e.getRawX() - downX;
                            int delta = Math.round(dx / (float) w * durationSec);
                            positionSec = Math.max(0, Math.min(durationSec, startPos + delta));
                            updateProgressUi();
                            return true;
                        }
                        case MotionEvent.ACTION_UP:
                        case MotionEvent.ACTION_CANCEL:
                            if (dragging) {
                                dragging = false; seeking = false;
                                JSObject data = new JSObject();
                                data.put("position", positionSec);
                                fireJsEvent("onSeek", data);
                            }
                            return true;
                        default: return true;
                    }
                } catch (Throwable t) { return true; }
            }
        });

        progDurText = makeText(10, 0xFF9A92B5, false);
        progDurText.setText("00:00");
        progRow.addView(progDurText);

        parent.addView(progRow, progLp);
    }

    /* ============ 图标绘制（复刻 icons.js SVG path，绝不用 emoji） ============ */

    private static final String ICONS_PLAY = "M7 4.5l13 7.5-13 7.5z";
    private static final String ICONS_PAUSE = "M7 4.5h3.4v15H7zM13.6 4.5H17v15h-3.4z";
    private static final String ICONS_PREV = "M6 5.5v13M19 5.5L9 12l10 6.5z";
    private static final String ICONS_NEXT = "M18 5.5v13M5 5.5l10 6.5L5 18.5z";
    private static final String ICONS_REPEAT = "M17 2.5l3 3-3 3M20 5.5H8a4 4 0 0 0-4 4v1M7 21.5l-3-3 3-3M4 18.5h12a4 4 0 0 0 4-4v-1";
    private static final String ICONS_LIST = "M8.5 6.2h12M8.5 12h12M8.5 17.8h12";
    private static final String ICONS_CLOSE = "M18 6L6 18M6 6l12 12";
    private static final String ICONS_EXPAND = "M15 3h6v6M9 21H3v-6M21 3l-7.5 7.5M3 21l7.5-7.5";

    /** 自绘图标 View：用 Path 绘制 SVG 线条图标，stroke 1.8/24 比例、圆角端点（与 icons.js 一致） */
    private static class IconView extends View {
        private Path path;
        private int color;
        IconView(Context ctx, String pathData, int color) {
            super(ctx);
            this.color = color;
            Path p = null;
            try { p = PathParser.createPathFromPathData(pathData); } catch (Throwable t) { p = null; }
            this.path = p != null ? p : new Path();
        }
        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (path == null || path.isEmpty()) return;
            try {
                Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
                paint.setStyle(Paint.Style.STROKE);
                paint.setColor(color);
                // 与软件内 icons.js 完全一致：viewBox 24、stroke-width 1.8。
                // 之前 strokeScale 算错（iconSp*1.6 再乘 getWidth()/24），stroke 宽到几乎填满
                // 整颗 View，图标糊成实心方块 → 用户看到「白方块」。
                paint.setStrokeWidth(getWidth() * 1.8f / 24f);
                paint.setStrokeCap(Paint.Cap.ROUND);
                paint.setStrokeJoin(Paint.Join.ROUND);
                canvas.drawPath(path, paint);
            } catch (Throwable t) {}
        }
    }

    /** 图标按钮：FrameLayout 容器（可选圆形底）+ 居中 IconView。图标数据可运行时替换。 */
    private class IconBtn extends FrameLayout {
        private IconView iconView;
        private int iconColor;

        IconBtn(Context ctx, String pathData, int iconColor, int btnSizePx, float iconSp, int bgColor) {
            super(ctx);
            this.iconColor = iconColor;
            if (bgColor != 0x00000000) {
                GradientDrawable bg = new GradientDrawable();
                bg.setShape(GradientDrawable.OVAL);
                bg.setColor(bgColor);
                setBackground(bg);
            }
            iconView = new IconView(ctx, pathData, iconColor);
            int inner = btnSizePx * 3 / 4;
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(inner, inner);
            lp.gravity = Gravity.CENTER;
            addView(iconView, lp);
        }

        void setIcon(String pathData) {
            try {
                Path p = PathParser.createPathFromPathData(pathData);
                iconView.path = p != null ? p : new Path();
                iconView.invalidate();
            } catch (Throwable t) {}
        }
    }

    /* ============ 迷你播放列表（极简：封面+歌名+歌手，约 1/3 长度） ============ */

    private void toggleMiniList() {
        try {
            if (miniListPanel != null) {
                dismissMiniList();
                return;
            }
            showMiniList();
        } catch (Throwable t) {}
    }

    private void showMiniList() {
        if (overlayRoot == null || windowManager == null) return;
        try {
            int listW = dp(220);
            int itemH = dp(42);
            int headH = dp(28);
            int maxItems = Math.min(miniPlaylist.size(), 5);
            int listH = headH + itemH * Math.max(1, maxItems) + dp(6);

            // 跟随主题配色
            boolean isLightText = "light".equals(textMode);
            boolean isGlass = "glass".equals(bgMode);
            int panelColor;      // 底板
            int lineColor;       // 边框/分隔线
            int inkColor;        // 主文字
            int dimColor;        // 次文字
            int accentColor = ACCENT;
            if ("light".equals(bgMode)) {
                panelColor = 0xF2FBF9F3; lineColor = 0x332A2A28; inkColor = 0xFF2A2A28; dimColor = 0xFF6F6B5E;
            } else if ("dark".equals(bgMode)) {
                panelColor = 0xF20A0E1A; lineColor = 0x33BECDF0; inkColor = 0xFFEEF2FC; dimColor = 0xFFA6B0C8;
            } else { // glass：半透明磨砂，深浅跟随文字档
                panelColor = isLightText ? 0xE6222030 : 0xE60A0E1A;
                lineColor = 0x33FFFFFF;
                inkColor = isLightText ? 0xFFF2F5FF : 0xFFEEF2FC;
                dimColor = isLightText ? 0xFFC3CBE2 : 0xFFA6B0C8;
            }

            FrameLayout panel = new FrameLayout(getContext());
            panel.setTag("bm-mf-minilist");
            GradientDrawable panelBg = new GradientDrawable();
            panelBg.setColor(panelColor);
            panelBg.setCornerRadius(dp(12));
            panelBg.setStroke(dp(1), lineColor);
            panel.setBackground(panelBg);
            panel.setElevation(dp(16));

            LinearLayout col = new LinearLayout(getContext());
            col.setOrientation(LinearLayout.VERTICAL);

            // 头：播放列表（N）+ 关闭
            LinearLayout head = new LinearLayout(getContext());
            head.setGravity(Gravity.CENTER_VERTICAL);
            head.setPadding(dp(10), dp(5), dp(10), dp(5));
            TextView headTitle = makeText(11, inkColor, true);
            headTitle.setText("播放列表（" + miniPlaylist.size() + "）");
            head.addView(headTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            IconBtn closeBtn = new IconBtn(getContext(), ICONS_CLOSE, dimColor, dp(20), dp(8), 0x00000000);
            closeBtn.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { dismissMiniList(); }
            });
            head.addView(closeBtn, new LinearLayout.LayoutParams(dp(20), dp(20)));
            // 分隔线
            View div = new View(getContext());
            div.setBackgroundColor(lineColor);
            head.addView(div);
            col.addView(head, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, headH));

            // 行
            if (miniPlaylist.isEmpty()) {
                TextView empty = makeText(11, dimColor, false);
                empty.setText("暂无播放列表");
                empty.setGravity(Gravity.CENTER);
                empty.setPadding(dp(10), dp(14), dp(10), dp(14));
                col.addView(empty, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            } else {
                for (int i = 0; i < miniPlaylist.size() && i < 8; i++) {
                    JSObject s = miniPlaylist.get(i);
                    final int idx = i;
                    String name = optStr(s, "name", "");
                    String art = optStr(s, "artist", "");
                    String pic = optStr(s, "pic", "");

                    LinearLayout row = new LinearLayout(getContext());
                    row.setGravity(Gravity.CENTER_VERTICAL);
                    row.setPadding(dp(8), dp(4), dp(8), dp(4));
                    if (i == miniPlayIndex) {
                        GradientDrawable onBg = new GradientDrawable();
                        onBg.setColor(isGlass ? 0x2EA78BFA : 0x33A78BFA);
                        row.setBackground(onBg);
                    }

                    // 封面缩略图
                    FrameLayout cover = new FrameLayout(getContext());
                    GradientDrawable covBg = new GradientDrawable();
                    covBg.setCornerRadius(dp(5));
                    covBg.setColor(isGlass ? 0x14FFFFFF : (0x142A2A28));
                    cover.setBackground(covBg);
                    Bitmap cb = decodeDataUrl(pic, 64);
                    if (cb != null) {
                        ImageView iv = new ImageView(getContext());
                        iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
                        iv.setImageBitmap(cb);
                        cover.setOutlineProvider(new ViewOutlineProvider() {
                            @Override public void getOutline(View view, android.graphics.Outline outline) {
                                try { outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), dp(5)); } catch (Throwable t) {}
                            }
                        });
                        cover.setClipToOutline(true);
                        cover.addView(iv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                    } else {
                        TextView ph = makeText(12, dimColor, false);
                        ph.setText("♪");
                        ph.setGravity(Gravity.CENTER);
                        cover.addView(ph, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                    }
                    row.addView(cover, new LinearLayout.LayoutParams(dp(28), dp(28)));

                    // 歌名 + 歌手
                    LinearLayout inf = new LinearLayout(getContext());
                    inf.setOrientation(LinearLayout.VERTICAL);
                    inf.setPadding(dp(8), 0, 0, 0);
                    TextView nm = makeText(12, i == miniPlayIndex ? accentColor : inkColor, false);
                    nm.setText(name);
                    nm.setSingleLine(true);
                    nm.setEllipsize(android.text.TextUtils.TruncateAt.END);
                    inf.addView(nm);
                    TextView ar = makeText(10, dimColor, false);
                    ar.setText(art);
                    ar.setSingleLine(true);
                    ar.setEllipsize(android.text.TextUtils.TruncateAt.END);
                    inf.addView(ar);
                    row.addView(inf, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

                    row.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            JSObject data = new JSObject();
                            data.put("index", idx);
                            fireJsEvent("onSelect", data);
                            dismissMiniList();
                        }
                    });
                    col.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, itemH));
                }
            }

            panel.addView(col, new FrameLayout.LayoutParams(listW, ViewGroup.LayoutParams.WRAP_CONTENT));

            // 贴附悬浮窗：作为 overlayRoot 的子 View，定位在悬浮窗上方（root 已 setClipChildren(false) 不会被裁剪）
            final FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(listW, listH);
            lp.gravity = Gravity.TOP | Gravity.START;
            // 水平居中于悬浮窗；垂直放在悬浮窗顶部之上（紧贴悬浮窗向上弹出）
            lp.leftMargin = Math.max(0, (getOverlayWidth() - listW) / 2);
            lp.topMargin = -listH - dp(6);
            overlayRoot.addView(panel, lp);
            miniListPanel = panel;

            // 表头作为拖动手柄，整个迷你列表可拖动（独立于悬浮窗）
            head.setOnTouchListener(new View.OnTouchListener() {
                float lastX = 0, lastY = 0;
                @Override public boolean onTouch(View v, android.view.MotionEvent e) {
                    switch (e.getActionMasked()) {
                        case android.view.MotionEvent.ACTION_DOWN:
                            lastX = e.getRawX(); lastY = e.getRawY();
                            return true;
                        case android.view.MotionEvent.ACTION_MOVE: {
                            float dx = e.getRawX() - lastX;
                            float dy = e.getRawY() - lastY;
                            lastX = e.getRawX(); lastY = e.getRawY();
                            lp.leftMargin += (int) dx;
                            lp.topMargin += (int) dy;
                            panel.setLayoutParams(lp);
                            return true;
                        }
                    }
                    return false;
                }
            });
        } catch (Throwable t) {}
    }

    private int getOverlayWidth() {
        if (overlayRoot == null) return dp(280);
        int w = overlayRoot.getWidth();
        return w > 0 ? w : dp(280);
    }

    private void dismissMiniList() {
        try {
            if (miniListPanel != null && miniListPanel.getParent() != null) {
                ((ViewGroup) miniListPanel.getParent()).removeView(miniListPanel);
            }
        } catch (Throwable t) {}
        miniListPanel = null;
    }

    private String optStr(JSObject o, String key, String def) {
        try {
            String v = o.getString(key);
            return v != null ? v : def;
        } catch (Throwable t) { return def; }
    }

    /* ============ 刷新 UI ============ */

    private void refreshAll() {
        if (overlayRoot == null) return;
        try {
            boolean hasCover = coverBmp != null;
            if (dotCover != null) {
                if (hasCover) { dotCover.setImageBitmap(coverBmp); dotCover.setVisibility(View.VISIBLE); }
                else dotCover.setVisibility(View.GONE);
            }
            if (dotPlaceholder != null) dotPlaceholder.setVisibility(hasCover ? View.GONE : View.VISIBLE);
            if (cardCover != null) {
                if (hasCover) { cardCover.setImageBitmap(coverBmp); cardCover.setVisibility(View.VISIBLE); }
                else cardCover.setVisibility(View.GONE);
            }
            if (cardCoverPlaceholder != null) cardCoverPlaceholder.setVisibility(hasCover ? View.GONE : View.VISIBLE);

            String t = title != null && title.length() > 0 ? title : "未在播放";
            String a = artist != null && artist.length() > 0 ? artist : "—";
            if (miniTitle != null) miniTitle.setText(t);
            if (miniArtist != null) miniArtist.setText(a);
            if (cardTitle != null) cardTitle.setText(t);
            if (cardArtist != null) cardArtist.setText(a);

            String lyr = lyric != null ? lyric : "";
            if (miniLyric != null) miniLyric.setText(lyr);
            if (cardLyric != null) cardLyric.setText(lyr);
            // 20261105：逐句歌词渲染（有 lyricTexts 时显示滚动区，隐藏单行；否则单行显示当前句/暂无歌词）
            renderLyricLines();

            if (cardTogetherTime != null) cardTogetherTime.setText(togetherText != null ? togetherText : "");
            if (cardEndBtn != null) cardEndBtn.setVisibility(together ? View.VISIBLE : View.GONE);

            String taName = charName != null && charName.length() > 0 ? charName : "TA";
            setAvatarBitmap(miniAvMine, myAvatarBmp, myName);
            setAvatarBitmap(miniAvTa, charAvatarBmp, taName);
            setAvatarBitmap(cardAvMine, myAvatarBmp, myName);
            setAvatarBitmap(cardAvTa, charAvatarBmp, taName);

            refreshPpIcons();
            refreshModeIcon();
            updateProgressUi();
        } catch (Throwable t) {}
    }

    /* 20261105：逐句歌词渲染——高亮当前句 + 滚动居中，复刻软件内滚动歌词 */
    private void renderLyricLines() {
        try {
            boolean hasLines = lyricTexts != null && !lyricTexts.isEmpty();
            if (cardLyricScroll != null) cardLyricScroll.setVisibility(hasLines ? View.VISIBLE : View.GONE);
            if (cardLyric != null) {
                if (hasLines) cardLyric.setVisibility(View.GONE);
                else cardLyric.setVisibility(View.VISIBLE);
            }
            if (!hasLines || cardLyricLines == null) return;
            // 构建多行文本（当前句紫色加粗高亮）
            int active = lyricActiveIdxForPosition();
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < lyricTexts.size(); i++) {
                if (i > 0) sb.append('\n');
                sb.append(lyricTexts.get(i));
            }
            android.text.SpannableString ss = new android.text.SpannableString(sb.toString());
            // 逐句定位并上色
            int offset = 0;
            for (int i = 0; i < lyricTexts.size(); i++) {
                String line = lyricTexts.get(i);
                int len = line.length();
                if (i == active) {
                    ss.setSpan(new android.text.style.ForegroundColorSpan(0xFFB8A6FF), offset, offset + len, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    ss.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), offset, offset + len, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                }
                offset += len + 1;   // +1 换行
            }
            cardLyricLines.setText(ss);
            // 滚动居中到当前句（只在 active 变化时滚，唱同一句期间不弹回）
            if (active != lyricActiveIdx) {
                lyricActiveIdx = active;
                if (cardLyricScroll != null && active >= 0) {
                    final int idx = active;
                    cardLyricScroll.post(new Runnable() {
                        @Override public void run() {
                            try {
                                if (cardLyricLines == null || idx < 0 || idx >= lyricTexts.size()) return;
                                android.text.Layout layout = cardLyricLines.getLayout();
                                if (layout == null) return;
                                int lineTop = layout.getLineTop(idx);
                                int lineBottom = layout.getLineBottom(idx);
                                int lineCenter = (lineTop + lineBottom) / 2;
                                int viewCenter = cardLyricScroll.getHeight() / 2;
                                int target = Math.max(0, lineCenter - viewCenter);
                                cardLyricScroll.smoothScrollTo(0, target);
                            } catch (Throwable t) {}
                        }
                    });
                }
            }
        } catch (Throwable t) {}
    }

    /* 按当前进度算当前高亮句下标 */
    private int lyricActiveIdxForPosition() {
        int active = -1;
        try {
            for (int i = 0; i < lyricTimes.size() && i < lyricTexts.size(); i++) {
                float t = lyricTimes.get(i)[0];
                if (t <= positionSec) active = i; else break;
            }
        } catch (Throwable t) {}
        return active;
    }

    private void refreshPpIcons() {
        try {
            if (ppBtn != null) ppBtn.setIcon(playing ? ICONS_PAUSE : ICONS_PLAY);
            if (miniPpBtn != null) miniPpBtn.setIcon(playing ? ICONS_PAUSE : ICONS_PLAY);
        } catch (Throwable t) {}
    }

    private void refreshModeIcon() {
        try {
            if (modeBtn == null) return;
            String icon;
            if ("shuffle".equals(playMode)) icon = "M2.5 7h3.2c2.2 0 3.2 1.4 4.8 5s2.6 5 4.8 5h1.2M2.5 17h3.2c1 0 1.7-.3 2.4-.9l3-2.4M16.5 5.5L21 7l-1.5 4.5M16.5 15L21 17l-1.5 4.5";
            else if ("once".equals(playMode)) icon = "M4.5 12h13M14 6.5l3.5 5.5L14 17.5";
            else icon = ICONS_REPEAT;   // order / one 都用 repeat（单曲循环视觉同 repeat）
            modeBtn.setIcon(icon);
        } catch (Throwable t) {}
    }

    private void updateProgressUi() {
        try {
            if (progCurText != null) progCurText.setText(fmtDur(positionSec));
            if (progDurText != null) progDurText.setText(fmtDur(durationSec));
            if (progressThumb != null) {
                View parent = (View) progressThumb.getParent();
                float trackW = parent != null ? parent.getWidth() - dp(16) : 0;
                if (trackW > 0 && durationSec > 0) {
                    float ratio = Math.max(0f, Math.min(1f, (float) positionSec / durationSec));
                    progressThumb.setTranslationX(trackW * ratio);
                } else {
                    progressThumb.setTranslationX(0);
                }
            }
        } catch (Throwable t) {}
    }

    /* ============ 三形态切换 ============ */

    private void switchForm(int f) {
        form = f;
        if (overlayRoot == null || layoutParams == null || windowManager == null) return;
        try {
            if (dotView != null) dotView.setVisibility(f == 0 ? View.VISIBLE : View.GONE);
            if (miniView != null) miniView.setVisibility(f == 1 ? View.VISIBLE : View.GONE);
            if (cardView != null) cardView.setVisibility(f == 2 ? View.VISIBLE : View.GONE);
            if (f == 2) {
                applyCardWindowSize();
            } else {
                layoutParams.width = WindowManager.LayoutParams.WRAP_CONTENT;
                layoutParams.height = WindowManager.LayoutParams.WRAP_CONTENT;
                windowManager.updateViewLayout(overlayRoot, layoutParams);
            }
        } catch (Throwable t) {}
    }

    private void collapseFloat() {
        try {
            switchForm(0);
            fireJsEvent("onCollapse", new JSObject());
        } catch (Throwable t) {}
    }

    private void applyCardWindowSize() {
        applyCardWindowSize(true);
    }

    private void applyCardWindowSize(boolean repost) {
        try {
            if (overlayRoot == null || layoutParams == null || windowManager == null || cardView == null) return;
            int w = (int) (cardNaturalW * cardScale);
            int h = (int) (cardNaturalH * cardScale);
            layoutParams.width = w;
            layoutParams.height = h;
            clampToScreen();
            if (cardView != null) {
                FrameLayout.LayoutParams hostLp = (FrameLayout.LayoutParams) cardView.getLayoutParams();
                if (hostLp == null) hostLp = new FrameLayout.LayoutParams(w, h);
                hostLp.width = w;
                hostLp.height = h;
                cardView.setLayoutParams(hostLp);
                View inner = cardView.getChildAt(0);
                if (inner != null) {
                    inner.setScaleX(cardScale);
                    inner.setScaleY(cardScale);
                }
            }
            windowManager.updateViewLayout(overlayRoot, layoutParams);
            if (repost && overlayRoot != null) {
                final View rootRef = overlayRoot;
                rootRef.post(new Runnable() {
                    @Override public void run() {
                        try { if (form == 2) applyCardWindowSize(false); } catch (Throwable t) {}
                    }
                });
            }
        } catch (Throwable t) {}
    }

    private void clampToScreen() {
        try {
            if (layoutParams == null) return;
            android.util.DisplayMetrics dm = android.content.res.Resources.getSystem().getDisplayMetrics();
            if (layoutParams.width > 0 && layoutParams.x + layoutParams.width > dm.widthPixels) {
                layoutParams.x = Math.max(0, dm.widthPixels - layoutParams.width);
            }
            if (layoutParams.height > 0 && layoutParams.y + layoutParams.height > dm.heightPixels) {
                layoutParams.y = Math.max(0, dm.heightPixels - layoutParams.height);
            }
            if (layoutParams.x < 0) layoutParams.x = 0;
            if (layoutParams.y < 0) layoutParams.y = 0;
        } catch (Throwable t) {}
    }

    /* ============ 手势：拖动 + 三形态切换 + 双击回应用 ============ */

    private void bindRootGesture(View root) {
        root.setOnTouchListener(new View.OnTouchListener() {
            float startX = 0, startY = 0, touchX = 0, touchY = 0;
            boolean dragging = false;
            long lastUpTime = 0;
            float lastUpX = 0, lastUpY = 0;
            Runnable pendingSingleTap = null;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                try {
                    switch (e.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            startX = layoutParams.x;
                            startY = layoutParams.y;
                            touchX = e.getRawX();
                            touchY = e.getRawY();
                            dragging = false;
                            return true;
                        case MotionEvent.ACTION_MOVE: {
                            float dx = e.getRawX() - touchX;
                            float dy = e.getRawY() - touchY;
                            if (!dragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return true;
                            dragging = true;
                            if (pendingSingleTap != null) { root.removeCallbacks(pendingSingleTap); pendingSingleTap = null; }
                            layoutParams.x = (int) (startX + dx);
                            layoutParams.y = (int) (startY + dy);
                            try { windowManager.updateViewLayout(overlayRoot, layoutParams); } catch (Throwable t2) {}
                            return true;
                        }
                        case MotionEvent.ACTION_UP: {
                            if (dragging) { lastUpTime = 0; return true; }
                            long now = SystemClock.elapsedRealtime();
                            boolean isDouble = (now - lastUpTime) < 300
                                    && Math.abs(e.getRawX() - lastUpX) < dp(8)
                                    && Math.abs(e.getRawY() - lastUpY) < dp(8);
                            if (isDouble) {
                                if (pendingSingleTap != null) { root.removeCallbacks(pendingSingleTap); pendingSingleTap = null; }
                                lastUpTime = 0;
                                bringAppToFront();
                                return true;
                            }
                            lastUpTime = now;
                            lastUpX = e.getRawX();
                            lastUpY = e.getRawY();
                            pendingSingleTap = new Runnable() {
                                @Override public void run() {
                                    pendingSingleTap = null;
                                    if (form == 0) switchForm(1);
                                    else if (form == 1) switchForm(2);
                                }
                            };
                            root.postDelayed(pendingSingleTap, 220);
                            return true;
                        }
                        default:
                            return true;
                    }
                } catch (Throwable t) {
                    return true;
                }
            }
        });
    }

    /* ============ 原生计时 ============ */

    private void startTicking() {
        stopTicking();
        try {
            tickStartElapsed = SystemClock.elapsedRealtime();
            tickBaseSec = positionSec;
            tickHandler = new Handler(Looper.getMainLooper());
            tickRunnable = new Runnable() {
                @Override
                public void run() {
                    try {
                        if (playing && !seeking && durationSec > 0) {
                            positionSec = tickBaseSec + (int) ((SystemClock.elapsedRealtime() - tickStartElapsed) / 1000);
                            if (positionSec >= durationSec) positionSec = durationSec;
                            updateProgressUi();
                            // 20261105：进度推进时同步刷新歌词高亮/滚动
                            renderLyricLines();
                        }
                        if (form == 2 && layoutParams != null && overlayRoot != null) {
                            int wantW = (int) (cardNaturalW * cardScale);
                            int wantH = (int) (cardNaturalH * cardScale);
                            boolean off = layoutParams.width != wantW || layoutParams.height != wantH;
                            if (off) applyCardWindowSize(false);
                        }
                    } catch (Throwable t) {}
                    if (tickHandler != null) tickHandler.postDelayed(this, 1000);
                }
            };
            tickHandler.post(tickRunnable);
        } catch (Throwable t) {
            tickHandler = null;
            tickRunnable = null;
        }
    }

    private void stopTicking() {
        try {
            if (tickHandler != null && tickRunnable != null) tickHandler.removeCallbacks(tickRunnable);
        } catch (Throwable t) {}
        tickHandler = null;
        tickRunnable = null;
    }

    /* ============ 通用小部件 ============ */

    private TextView makeText(float sp, int color, boolean bold) {
        TextView tv = new TextView(getContext());
        tv.setTextColor(color);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) tv.setTypeface(null, android.graphics.Typeface.BOLD);
        tv.setSingleLine(true);
        tv.setEllipsize(android.text.TextUtils.TruncateAt.END);
        return tv;
    }

    private FrameLayout makeAvatar(int sizePx, String name) {
        FrameLayout slot = new FrameLayout(getContext());
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(ACCENT);
        slot.setBackground(bg);
        slot.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, android.graphics.Outline outline) {
                try { outline.setOval(0, 0, view.getWidth(), view.getHeight()); } catch (Throwable t) {}
            }
        });
        slot.setClipToOutline(true);
        TextView letter = new TextView(getContext());
        letter.setTag("bm-av-letter");
        letter.setTextColor(Color.WHITE);
        letter.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(11, sizePx * 0.42f));
        letter.setGravity(Gravity.CENTER);
        letter.setText(name != null && name.length() > 0 ? String.valueOf(name.charAt(0)) : "?");
        slot.addView(letter, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ImageView img = new ImageView(getContext());
        img.setTag("bm-av-img");
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        img.setVisibility(View.GONE);
        slot.addView(img, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return slot;
    }

    private void setAvatarBitmap(FrameLayout slot, Bitmap bmp, String name) {
        if (slot == null) return;
        try {
            ImageView img = slot.findViewWithTag("bm-av-img");
            TextView letter = slot.findViewWithTag("bm-av-letter");
            if (bmp != null && img != null) {
                RoundedBitmapDrawable rd = RoundedBitmapDrawableFactory.create(getContext().getResources(), bmp);
                rd.setCircular(true);
                img.setImageDrawable(rd);
                img.setVisibility(View.VISIBLE);
                if (letter != null) letter.setVisibility(View.GONE);
            } else {
                if (img != null) img.setVisibility(View.GONE);
                if (letter != null) {
                    letter.setVisibility(View.VISIBLE);
                    letter.setText(name != null && name.length() > 0 ? String.valueOf(name.charAt(0)) : "?");
                }
            }
        } catch (Throwable t) {}
    }

    private Bitmap decodeDataUrl(String dataUrl, int maxPx) {
        try {
            if (dataUrl == null || dataUrl.length() < 24) return null;
            int comma = dataUrl.indexOf(',');
            String b64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            if (bytes == null || bytes.length == 0) return null;
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
            int sample = 1;
            while (Math.max(o.outWidth, o.outHeight) / sample > maxPx) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o2);
        } catch (Throwable t) {
            return null;
        }
    }

    /* ============ 事件 / 移除 / 回应用 ============ */

    private void fireJsEvent(String name, JSObject data) {
        try {
            final JSObject d = data != null ? data : new JSObject();
            if (getActivity() != null) {
                getActivity().runOnUiThread(new Runnable() {
                    @Override public void run() {
                        try { notifyListeners(name, d); } catch (Throwable t) {}
                    }
                });
            } else {
                try { notifyListeners(name, d); } catch (Throwable t) {}
            }
        } catch (Throwable t) {}
    }

    private void removeOverlay() {
        try {
            dismissMiniList();
            if (viewAttached && overlayRoot != null && windowManager != null) {
                windowManager.removeView(overlayRoot);
            }
        } catch (Throwable t) {}
        overlayRoot = null;
        viewAttached = false;
        windowManager = null;
        dotView = null; miniView = null; cardView = null;
        dotCover = null; dotPlaceholder = null;
        miniAvMine = null; miniAvTa = null; cardAvMine = null; cardAvTa = null;
        miniTitle = null; miniArtist = null; miniLyric = null;
        cardTitle = null; cardArtist = null; cardLyric = null;
        cardTogetherTime = null; cardEndBtn = null;
        cardCover = null; cardCoverPlaceholder = null;
        cardLyricScroll = null; cardLyricLines = null; lyricActiveIdx = -1;
        modeBtn = null; listBtn = null; ppBtn = null; prevBtn = null; nextBtn = null;
        miniPpBtn = null; miniCollapseBtn = null; cardCollapseBtn = null;
        progressTrack = null; progressThumb = null; progCurText = null; progDurText = null;
        form = 0;
        cardScale = 1f;
        seeking = false;
    }

    private void bringAppToFront() {
        try {
            fireJsEvent("onEnterApp", new JSObject());
            removeOverlay();
            android.app.ActivityManager am = (android.app.ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                java.util.List<android.app.ActivityManager.AppTask> tasks = null;
                try { tasks = am.getAppTasks(); } catch (Throwable t) { tasks = null; }
                if (tasks != null && !tasks.isEmpty()) {
                    try { tasks.get(0).moveToFront(); return; } catch (Throwable t) {}
                }
            }
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                getContext().startActivity(launch);
            }
        } catch (Throwable t) {
            try {
                Toast.makeText(getContext(), "请从桌面点开「白日梦」继续", Toast.LENGTH_SHORT).show();
            } catch (Throwable t2) {}
        }
    }

    private String fmtDur(int s) {
        if (s < 0) s = 0;
        return String.format("%02d:%02d", s / 60, s % 60);
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics());
    }

    @Override
    protected void handleOnDestroy() {
        try {
            stopTicking();
            removeOverlay();
        } catch (Throwable t) {}
        super.handleOnDestroy();
    }
}
