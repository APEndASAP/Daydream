package com.bairimeng.overlay;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
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

import androidx.core.graphics.drawable.RoundedBitmapDrawable;
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 白日梦原生悬浮窗插件（系统层三形态悬浮窗，20261002cp 重写）。
 *
 * 三形态（与软件内模拟通话悬浮窗完全一致）：
 *   1号 小方块：角色头像（真实图片）+ 通话时长（竖排），点按展开 → 长条；
 *   长条     ：头像 + 名字 + 时长 + 双箭头(⤢) + 挂断按钮；
 *              点双箭头 → 悬浮窗2号；点挂断 → 通知 JS 挂断；点条身 → 缩回小方块；
 *   2号 大卡片：完整模拟通话界面——计时/名字/状态/大头像（紫描边），
 *              语音⇄视频切换、静音、挂断、缩小(▣ → 回1号)、小眼镜(👁 隐藏 UI 只看背景)、
 *              更换通话背景（回应用里上传）、右下角 ⤢ 手柄拖拽等比缩放（0.5~1.15 倍）；
 *   任意形态：拖动 = 移动位置（跨应用）；双击 = 进入白日梦应用。
 *
 * 头像/背景：JS 端把图片压成 dataURL 传入，原生 Base64 解码成 Bitmap 圆形裁切显示。
 * 计时：原生 Handler 每秒自走（baseSec + elapsed），JS 冻结时系统层时间照样跳动。
 *
 * 与通知完全隔离：本插件只用 WindowManager，绝不触碰 LocalNotifications / AlarmManager。
 *
 * 闪退加固（20261002cp）：
 *   - 所有 PluginMethod / 手势回调 / 事件通知 全路径 catch Throwable，绝不抛异常杀进程；
 *   - 双击进应用 = 先 moveToFront 把任务栈带回前台，悬浮窗移除 post 延后一帧执行
 *     （绝不在触摸分发过程中同步 removeView 当前被触摸的窗口——低版本系统会崩）；
 *   - moveToFront 失败时用 launchIntent+SINGLE_TOP+REORDER_TO_FRONT 兜底（应用已有
 *     singleTask launchMode，不会重建 WebView、不重播开屏、不丢通话状态）；
 *   - 图片解码全部 inJustDecodeBounds 采样压缩，杜绝大图 OOM。
 */
@CapacitorPlugin(name = "BmOverlay")
public class BmOverlayPlugin extends Plugin {

    private WindowManager windowManager;
    private View overlayRoot;
    private WindowManager.LayoutParams layoutParams;
    private boolean viewAttached = false;

    /* 当前形态：0=小方块(1号) 1=长条 2=大卡片(2号) */
    private int form = 0;

    /* 状态 */
    private String charName = "访客";
    private String callKind = "voice";          // voice | video
    private Bitmap bgBitmap = null;             // 视频通话背景（JS 上传后传入）
    private boolean uiHidden = false;           // 小眼镜：隐藏 UI 只看背景
    private boolean muted = false;

    /* 三形态视图引用 */
    private View squareView, barView;
    private FrameLayout cardHost, cardFixed;
    private ImageView cardBg;
    private LinearLayout cardUi;
    private TextView squareTime, barTime, cardTimer, cardStatus;
    private FrameLayout squareAvatar, barAvatar, cardAvatar;
    private TextView barNameView;
    private TextView muteBtn;
    private ImageView eyeBtn;   // 20261003da：小眼镜改图片图标（用户指定睁眼/闭眼图，不再用 emoji）

    /* 原生计时 */
    private Handler tickHandler = null;
    private Runnable tickRunnable = null;
    private long startElapsed = 0;
    private int baseSec = 0;

    /* 2号缩放 */
    private float cardScale = 1f;
    private int cardNaturalW = 0, cardNaturalH = 0;

    /* ============ 1. 权限 ============ */

    @PluginMethod
    public void checkPermission(PluginCall call) {
        try {
            boolean granted = canDrawOverlay(getContext());
            JSObject ret = new JSObject();
            ret.put("granted", granted);
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

    /* ============ 2. 显示 / 更新 / 隐藏 ============ */

    /** 显示悬浮窗（1号小方块起步）。data: { name, sub, avatar?, bg?, kind?, baseSec? } */
    @PluginMethod
    public void show(PluginCall call) {
        try {
            if (!canDrawOverlay(getContext())) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "no_permission");
                call.resolve(ret);
                return;
            }
            String name = call.getString("name", "访客");
            String sub = call.getString("sub", "00:00");
            String avatar = call.getString("avatar", null);
            String bg = call.getString("bg", null);
            String k = call.getString("kind", "voice");
            callKind = "video".equals(k) ? "video" : "voice";
            Integer bs = call.getInt("baseSec", 0);
            baseSec = bs != null ? bs : 0;
            showOverlay(name, sub, avatar, bg);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", String.valueOf(t.getMessage()));
            call.resolve(ret);
        }
    }

    /** 更新副标题（通话时长跳动，兼容旧版调用；原生自走 tick 已覆盖）。 */
    @PluginMethod
    public void updateSub(PluginCall call) {
        try {
            String sub = call.getString("sub", "");
            // 兼容：手动同步一次（原生 tick 每秒会覆盖为精确值）
            if (squareTime != null) squareTime.setText(sub);
            if (barTime != null) barTime.setText(sub);
            if (cardTimer != null) cardTimer.setText(sub);
            call.resolve(new JSObject().put("ok", true));
        } catch (Throwable t) {
            call.resolve(new JSObject().put("ok", false));
        }
    }

    /** 隐藏/移除悬浮窗。 */
    @PluginMethod
    public void hide(PluginCall call) {
        try {
            stopTicking();
            removeOverlay();
            call.resolve(new JSObject().put("ok", true));
        } catch (Throwable t) {
            call.resolve(new JSObject().put("ok", false));
        }
    }

    /* ============ 内部实现 ============ */

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

    private void showOverlay(String name, String sub, String avatarB64, String bgB64) {
        stopTicking();
        removeOverlay();
        form = 0;
        uiHidden = false;
        muted = false;
        cardScale = 1f;
        charName = name != null && name.length() > 0 ? name : "访客";

        windowManager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);

        // 图片解码（全部采样压缩，防 OOM）
        Bitmap avatarBmp = decodeDataUrl(avatarB64, 256);
        bgBitmap = decodeDataUrl(bgB64, 520);

        FrameLayout root = new FrameLayout(getContext());
        root.setTag("bm-root");
        root.setClipChildren(false);       // 20261003da：最外层同步放行（窗口=视觉尺寸，理论不裁，兜底）
        overlayRoot = root;

        /* —— 1号 小方块：头像 + 时长（竖排，圆角方窗） —— */
        LinearLayout sq = new LinearLayout(getContext());
        sq.setOrientation(LinearLayout.VERTICAL);
        sq.setGravity(Gravity.CENTER);
        GradientDrawable sqBg = new GradientDrawable();
        sqBg.setColor(0xF21C1824);
        sqBg.setCornerRadius(dp(20));
        sqBg.setStroke(dp(1), 0x33FFFFFF);
        sq.setBackground(sqBg);
        sq.setPadding(dp(10), dp(10), dp(10), dp(8));
        squareAvatar = makeAvatar(dp(40), 0);
        sq.addView(squareAvatar, new LinearLayout.LayoutParams(dp(40), dp(40)));
        squareTime = new TextView(getContext());
        squareTime.setText(sub != null ? sub : "00:00");
        squareTime.setTextColor(0xFFC9CDD8);
        squareTime.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        squareTime.setGravity(Gravity.CENTER);
        squareTime.setMaxWidth(dp(64)); // 20261004：全 mm:ss 后不换行（宽度富余），保留上限防异常长文本
        sq.addView(squareTime, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        squareView = sq;
        root.addView(sq);

        /* —— 长条：头像 + 名字/时长 + 双箭头 + 挂断 —— */
        LinearLayout bar = new LinearLayout(getContext());
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        GradientDrawable barBg = new GradientDrawable();
        barBg.setColor(0xF21C1824);
        barBg.setCornerRadius(dp(28));
        barBg.setStroke(dp(1), 0x33FFFFFF);
        bar.setBackground(barBg);
        bar.setPadding(dp(8), dp(8), dp(9), dp(8));
        bar.setVisibility(View.GONE);
        barAvatar = makeAvatar(dp(36), 0);
        bar.addView(barAvatar, new LinearLayout.LayoutParams(dp(36), dp(36)));

        LinearLayout mid = new LinearLayout(getContext());
        mid.setOrientation(LinearLayout.VERTICAL);
        mid.setPadding(dp(9), 0, 0, 0);
        barNameView = new TextView(getContext());
        barNameView.setText(charName);
        barNameView.setTextColor(Color.WHITE);
        barNameView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        barNameView.setTypeface(null, android.graphics.Typeface.BOLD);
        barNameView.setSingleLine(true);
        barNameView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        barNameView.setMaxWidth(dp(84));
        mid.addView(barNameView);
        barTime = new TextView(getContext());
        barTime.setText(sub != null ? sub : "00:00");
        barTime.setTextColor(0xFFB8A6FF);
        barTime.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        mid.addView(barTime);
        bar.addView(mid, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView expandBtn = circleTextBtn("⤢", dp(30), 0xFF322B40, 13, Color.WHITE);
        expandBtn.setOnClickListener(v -> { try { switchForm(2); } catch (Throwable t) {} });
        LinearLayout.LayoutParams expLp = new LinearLayout.LayoutParams(dp(30), dp(30));
        expLp.leftMargin = dp(8);
        bar.addView(expandBtn, expLp);

        TextView hangBtn = circleTextBtn("📞", dp(38), 0xFFFF6B6B, 15, Color.WHITE);
        hangBtn.setRotation(135f);
        hangBtn.setOnClickListener(v -> { try { fireJsEvent("onHangup", new JSObject()); postRemove(); } catch (Throwable t) {} });
        LinearLayout.LayoutParams hangLp = new LinearLayout.LayoutParams(dp(38), dp(38));
        hangLp.leftMargin = dp(7);
        bar.addView(hangBtn, hangLp);
        barView = bar;
        root.addView(bar);

        /* —— 2号 大卡片：完整模拟通话界面 —— */
        cardNaturalW = dp(296);
        cardNaturalH = dp(344);

        cardHost = new FrameLayout(getContext());
        cardHost.setClipChildren(false);   // 20261003da：同上，放行 cardFixed 放大后的超出部分
        cardHost.setVisibility(View.GONE);

        cardFixed = new FrameLayout(getContext());
        // 20261003da：关闭裁剪——2号放大（scale>1）时 cardFixed 视觉尺寸超出 cardHost，
        // 默认 clipChildren 会把超出部分裁掉（右侧/右下缺一块）；root 同理放行
        cardFixed.setClipChildren(false);
        FrameLayout.LayoutParams fixedLp = new FrameLayout.LayoutParams(cardNaturalW, cardNaturalH);
        cardFixed.setLayoutParams(fixedLp);
        cardFixed.setPivotX(0f);
        cardFixed.setPivotY(0f);
        GradientDrawable cardBgDrawable = new GradientDrawable();
        cardBgDrawable.setColor(0xF21C1824);
        cardBgDrawable.setCornerRadius(dp(22));
        cardBgDrawable.setStroke(dp(1), 0x33FFFFFF);
        cardFixed.setBackground(cardBgDrawable);
        cardFixed.setElevation(dp(6));

        // 视频背景层
        cardBg = new ImageView(getContext());
        cardBg.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cardBg.setAlpha(0.38f);
        cardBg.setVisibility(View.GONE);
        // 20261004dc：背景图圆角裁剪——uiHidden 全显（alpha 1.0）后 ImageView 直角铺满，
        // 盖住 cardFixed 的 22dp 圆角（用户实测：遮罩修复了，但四角变直角不好看）；
        // outline 圆角 22dp 与 cardBgDrawable.setCornerRadius(dp(22)) 一致，半显/全显两态都是圆角
        cardBg.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, android.graphics.Outline outline) {
                try { outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), dp(22)); } catch (Throwable t) {}
            }
        });
        cardBg.setClipToOutline(true);
        cardFixed.addView(cardBg, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // UI 层
        cardUi = new LinearLayout(getContext());
        cardUi.setOrientation(LinearLayout.VERTICAL);
        cardUi.setGravity(Gravity.CENTER_HORIZONTAL);
        cardUi.setPadding(dp(14), dp(12), dp(14), dp(10));

        cardTimer = new TextView(getContext());
        cardTimer.setText(sub != null ? sub : "00:00");
        cardTimer.setTextColor(0xFFC9CDD8);
        cardTimer.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        // 20261004：计时文字显式撑满行宽 + 文字居中（与下方 cardName 同款做法）——
        // 修复真机上 cardTimer 贴在卡片左上角、与应用内通话页「计时居中」不一致的问题
        cardTimer.setGravity(Gravity.CENTER_HORIZONTAL);
        cardUi.addView(cardTimer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView cardName = new TextView(getContext());
        cardName.setText(charName);
        cardName.setTextColor(Color.WHITE);
        cardName.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        cardName.setTypeface(null, android.graphics.Typeface.BOLD);
        cardName.setSingleLine(true);
        cardName.setEllipsize(android.text.TextUtils.TruncateAt.END);
        cardName.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nameLp.topMargin = dp(2);
        cardUi.addView(cardName, nameLp);

        cardStatus = new TextView(getContext());
        cardStatus.setTextColor(0xFFB8A6FF);
        cardStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        LinearLayout.LayoutParams stLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stLp.topMargin = dp(3);
        cardUi.addView(cardStatus, stLp);

        // 大头像（紫描边圆）
        FrameLayout ring = new FrameLayout(getContext());
        GradientDrawable ringBg = new GradientDrawable();
        ringBg.setShape(GradientDrawable.OVAL);
        ringBg.setColor(0x1A7C5CFC);
        ringBg.setStroke(dp(3), 0xFF7C5CFC);
        ring.setBackground(ringBg);
        ring.setPadding(dp(3), dp(3), dp(3), dp(3));
        cardAvatar = makeAvatar(dp(112), 0);
        ring.addView(cardAvatar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        LinearLayout.LayoutParams avLp = new LinearLayout.LayoutParams(dp(112), dp(112));
        avLp.topMargin = dp(16);
        cardUi.addView(ring, avLp);

        // 更换通话背景（视频模式显示；点击 = 回应用上传，应用内 resume 自动回到完整通话页）
        TextView bgPill = new TextView(getContext());
        bgPill.setText("📷 更换通话背景");
        bgPill.setTextColor(0xD9FFFFFF);
        bgPill.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        bgPill.setGravity(Gravity.CENTER);
        GradientDrawable pillBg = new GradientDrawable();
        pillBg.setColor(0xB3141019);
        pillBg.setCornerRadius(dp(18));
        bgPill.setBackground(pillBg);
        bgPill.setPadding(dp(14), dp(6), dp(14), dp(6));
        bgPill.setOnClickListener(v -> { try { bringAppToFront(); } catch (Throwable t) {} });
        LinearLayout.LayoutParams pillLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pillLp.topMargin = dp(14);
        cardUi.addView(bgPill, pillLp);
        bgPill.setTag("bm-bg-pill");

        // 按钮排：语音/视频切换 · 静音 · 挂断 · 缩小
        LinearLayout btnRow = new LinearLayout(getContext());
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView camBtn = circleTextBtn("📷", dp(44), 0xFF322B40, 17, Color.WHITE);
        camBtn.setOnClickListener(v -> { try { toggleCallKind(); } catch (Throwable t) {} });
        btnRow.addView(camBtn, new LinearLayout.LayoutParams(dp(44), dp(44)));

        muteBtn = circleTextBtn("🎙", dp(44), 0xFF322B40, 17, Color.WHITE);
        muteBtn.setOnClickListener(v -> {
            try {
                muted = !muted;
                muteBtn.setText(muted ? "🔇" : "🎙");
            } catch (Throwable t) {}
        });
        LinearLayout.LayoutParams muteLp = new LinearLayout.LayoutParams(dp(44), dp(44));
        muteLp.leftMargin = dp(10);
        btnRow.addView(muteBtn, muteLp);

        TextView hangupBtn = circleTextBtn("📞", dp(56), 0xFFFF6B6B, 21, Color.WHITE);
        hangupBtn.setRotation(135f);
        hangupBtn.setOnClickListener(v -> { try { fireJsEvent("onHangup", new JSObject()); postRemove(); } catch (Throwable t) {} });
        LinearLayout.LayoutParams hupLp = new LinearLayout.LayoutParams(dp(56), dp(56));
        hupLp.leftMargin = dp(12);
        btnRow.addView(hangupBtn, hupLp);

        TextView minBtn = circleTextBtn("▣", dp(44), 0xFF322B40, 17, Color.WHITE);
        minBtn.setOnClickListener(v -> { try { switchForm(0); } catch (Throwable t) {} });
        LinearLayout.LayoutParams minLp = new LinearLayout.LayoutParams(dp(44), dp(44));
        minLp.leftMargin = dp(10);
        btnRow.addView(minBtn, minLp);

        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rowLp.topMargin = dp(18);
        cardUi.addView(btnRow, rowLp);

        TextView hint = new TextView(getContext());
        hint.setText("挂断后聊天里会显示通话时长");
        hint.setTextColor(0x80FFFFFF);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hintLp.topMargin = dp(12);
        cardUi.addView(hint, hintLp);

        cardFixed.addView(cardUi, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 小眼镜（视频+有背景时显示）：隐藏 UI 只看背景。
        // 20261003da：图标从 emoji(👁/🙈) 改为用户指定的图片资源（bm_eye_open/bm_eye_closed）；
        // 点击时同步把背景 alpha 切到全显（uiHidden 时 1.0），对齐应用内「小眼睛=隐藏 UI 与遮罩直接看图」，
        // 修复 uiHidden 时背景仍残留 0.38 透明度的问题；恢复时回到 0.38 与应用内 call-screen-bg 一致。
        eyeBtn = new ImageView(getContext());
        eyeBtn.setImageResource(R.drawable.bm_eye_open);
        eyeBtn.setScaleType(ImageView.ScaleType.CENTER_CROP);
        GradientDrawable eyeBg = new GradientDrawable();
        eyeBg.setShape(GradientDrawable.OVAL);
        eyeBg.setColor(0x66141019);
        eyeBtn.setBackground(eyeBg);
        eyeBtn.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, android.graphics.Outline outline) {
                try { outline.setOval(0, 0, view.getWidth(), view.getHeight()); } catch (Throwable t) {}
            }
        });
        eyeBtn.setClipToOutline(true);
        eyeBtn.setOnClickListener(v -> {
            try {
                uiHidden = !uiHidden;
                cardUi.setVisibility(uiHidden ? View.GONE : View.VISIBLE);
                cardBg.setAlpha(uiHidden ? 1f : 0.38f);
                eyeBtn.setImageResource(uiHidden ? R.drawable.bm_eye_closed : R.drawable.bm_eye_open);
            } catch (Throwable t) {}
        });
        FrameLayout.LayoutParams eyeLp = new FrameLayout.LayoutParams(dp(34), dp(34));
        eyeLp.gravity = Gravity.TOP | Gravity.END;
        eyeLp.topMargin = dp(10);
        eyeLp.rightMargin = dp(12);
        cardFixed.addView(eyeBtn, eyeLp);
        eyeBtn.setVisibility(View.GONE);

        // 右下角缩放手柄：拖拽等比缩放 0.5~1.15
        TextView resizeHandle = circleTextBtn("⤢", dp(30), 0x66141019, 13, 0xFFB8A6FF);
        FrameLayout.LayoutParams rhLp = new FrameLayout.LayoutParams(dp(30), dp(30));
        rhLp.gravity = Gravity.BOTTOM | Gravity.END;
        rhLp.bottomMargin = dp(8);
        rhLp.rightMargin = dp(8);
        cardFixed.addView(resizeHandle, rhLp);
        resizeHandle.setOnTouchListener(new View.OnTouchListener() {
            float sx = 0, sy = 0;
            float baseScale = 1f;
            @Override
            public boolean onTouch(View v, MotionEvent e) {
                try {
                    switch (e.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            sx = e.getRawX();
                            sy = e.getRawY();
                            baseScale = cardScale;
                            return true;
                        case MotionEvent.ACTION_MOVE: {
                            float s = baseScale + ((e.getRawX() - sx) + (e.getRawY() - sy)) / 700f;
                            cardScale = Math.max(0.5f, Math.min(1.15f, s));
                            applyCardWindowSize();
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

        cardHost.addView(cardFixed, new FrameLayout.LayoutParams(cardNaturalW, cardNaturalH));
        root.addView(cardHost, new FrameLayout.LayoutParams(cardNaturalW, cardNaturalH));

        // 头像上屏（三形态共用同一张图）
        setAvatarBitmap(squareAvatar, avatarBmp, charName);
        setAvatarBitmap(barAvatar, avatarBmp, charName);
        setAvatarBitmap(cardAvatar, avatarBmp, charName);
        refreshCardKind();

        // 窗口类型：Android 8.0+ 用 TYPE_APPLICATION_OVERLAY（系统级悬浮窗），老版本 TYPE_PHONE
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
        layoutParams.y = dp(140);

        windowManager.addView(root, layoutParams);
        viewAttached = true;

        // 手势交互：拖动 = 移动；单击 = 形态切换（1号⇄长条）；双击 = 进入应用。
        // 按钮自身可点击会优先消费触摸（子 View 先于父容器），父容器 onTouch 只收到非按钮区域。
        root.setOnTouchListener(new View.OnTouchListener() {
            float startX = 0, startY = 0, touchX = 0, touchY = 0;
            boolean localDragging = false;
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
                            localDragging = false;
                            return true;
                        case MotionEvent.ACTION_MOVE: {
                            float dx = e.getRawX() - touchX;
                            float dy = e.getRawY() - touchY;
                            if (!localDragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return true;
                            localDragging = true;
                            if (pendingSingleTap != null) { root.removeCallbacks(pendingSingleTap); pendingSingleTap = null; }
                            layoutParams.x = (int) (startX + dx);
                            layoutParams.y = (int) (startY + dy);
                            try { windowManager.updateViewLayout(overlayRoot, layoutParams); } catch (Throwable t2) {}
                            return true;
                        }
                        case MotionEvent.ACTION_UP: {
                            if (localDragging) { lastUpTime = 0; return true; }
                            long now = SystemClock.elapsedRealtime();
                            boolean isDouble = (now - lastUpTime) < 300
                                    && Math.abs(e.getRawX() - lastUpX) < dp(8)
                                    && Math.abs(e.getRawY() - lastUpY) < dp(8);
                            if (isDouble) {
                                if (pendingSingleTap != null) { root.removeCallbacks(pendingSingleTap); pendingSingleTap = null; }
                                lastUpTime = 0;
                                bringAppToFront(); // 双击 = 进入白日梦（内部已加固：先 moveToFront，移除悬浮窗延后一帧）
                                return true;
                            }
                            lastUpTime = now;
                            lastUpX = e.getRawX();
                            lastUpY = e.getRawY();
                            pendingSingleTap = () -> {
                                pendingSingleTap = null;
                                // 单击形态切换：1号 → 长条；长条 → 1号；2号不响应（防误触缩小）
                                if (form == 0) switchForm(1);
                                else if (form == 1) switchForm(0);
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

        // 原生自走计时：每秒刷新三形态时间文字（JS 冻结时系统层照样跳动）
        startTicking();
    }

    /* 语音⇄视频切换（2号卡片内） */
    private void toggleCallKind() {
        callKind = "video".equals(callKind) ? "voice" : "video";
        refreshCardKind();
        JSObject data = new JSObject();
        data.put("kind", callKind);
        fireJsEvent("onKindChange", data);
    }

    /* 按 kind 刷新卡片 UI：状态文案 / 背景层 / 小眼镜 / 更换背景按钮可见性 */
    private void refreshCardKind() {
        try {
            if (cardStatus != null) cardStatus.setText("video".equals(callKind) ? "视频通话中…" : "语音通话中…");
            boolean video = "video".equals(callKind);
            boolean hasBg = bgBitmap != null;
            if (cardBg != null) {
                if (video && hasBg) {
                    cardBg.setImageBitmap(bgBitmap);
                    cardBg.setVisibility(View.VISIBLE);
                } else {
                    cardBg.setVisibility(View.GONE);
                }
            }
            if (eyeBtn != null) eyeBtn.setVisibility(video && hasBg ? View.VISIBLE : View.GONE);
            View pill = cardFixed != null ? cardFixed.findViewWithTag("bm-bg-pill") : null;
            if (pill != null) pill.setVisibility(video ? View.VISIBLE : View.GONE);
            if (!video && cardUi != null) {
                cardUi.setVisibility(View.VISIBLE); // 切回语音时确保 UI 可见
                uiHidden = false;
                if (cardBg != null) cardBg.setAlpha(0.38f);   // 20261003da：背景透明度一并复位
                if (eyeBtn != null) eyeBtn.setImageResource(R.drawable.bm_eye_open);
            }
        } catch (Throwable t) {}
    }

    /* 形态切换：显隐三个容器 + 窗口尺寸（2号 = 自然尺寸 × 缩放） */
    private void switchForm(int f) {
        form = f;
        if (overlayRoot == null || layoutParams == null || windowManager == null) return;
        try {
            if (squareView != null) squareView.setVisibility(f == 0 ? View.VISIBLE : View.GONE);
            if (barView != null) barView.setVisibility(f == 1 ? View.VISIBLE : View.GONE);
            if (cardHost != null) cardHost.setVisibility(f == 2 ? View.VISIBLE : View.GONE);
            if (f == 2) {
                applyCardWindowSize();
            } else {
                layoutParams.width = WindowManager.LayoutParams.WRAP_CONTENT;
                layoutParams.height = WindowManager.LayoutParams.WRAP_CONTENT;
            }
            windowManager.updateViewLayout(overlayRoot, layoutParams);
        } catch (Throwable t) {}
    }

    /** 2号窗口尺寸 = 自然尺寸 × 缩放。
     *  20261004 变形修复：真机（ColorOS）上 setScaleX/Y（View 属性，立即生效）与
     *  updateViewLayout（WMS relayout 事务）是两条更新轨——快速连续拖拽缩放手柄时，
     *  relayout 事务会被节流/合并/丢失，而 scale 已生效 → 「窗口尺寸 ≠ 内容视觉尺寸」
     *  的稳定态变形（内容偏在窗口一角、另一侧大片空白）。修复 = 每次更新后延迟一帧
     *  再校准重发一次（repost=false 不再续 post，杜绝循环），稳定态必然对齐。 */
    private void applyCardWindowSize() {
        applyCardWindowSize(true);
    }

    private void applyCardWindowSize(boolean repost) {
        try {
            if (overlayRoot == null || layoutParams == null || windowManager == null || cardFixed == null) return;
            layoutParams.width = (int) (cardNaturalW * cardScale);
            layoutParams.height = (int) (cardNaturalH * cardScale);
            // 20261004df：放大到最大（1.15 倍）后不能缩小的修复——窗口带 FLAG_LAYOUT_NO_LIMITS
            // 允许越出屏幕，用户把窗口拖到屏幕边缘附近再放大时，右下角的缩放手柄会整体或
            // 大部跑出屏外，摸不到手柄就「不能缩小」。每次窗口尺寸更新前把 x/y 钳回屏内
            // （只收右/下缘，不动用户拖放的自由）。
            clampCardWindowToScreen();
            cardFixed.setScaleX(cardScale);
            cardFixed.setScaleY(cardScale);
            windowManager.updateViewLayout(overlayRoot, layoutParams);
            if (repost && overlayRoot != null) {
                final View rootRef = overlayRoot;
                rootRef.post(() -> {
                    try { if (form == 2) applyCardWindowSize(false); } catch (Throwable t) {}
                });
            }
        } catch (Throwable t) {}
    }

    /** 20261004df：把 2 号窗口右/下缘收回屏内（配合缩放修复，见 applyCardWindowSize 注释）。 */
    private void clampCardWindowToScreen() {
        try {
            if (layoutParams == null) return;
            android.util.DisplayMetrics dm = android.content.res.Resources.getSystem().getDisplayMetrics();
            int screenW = dm.widthPixels;
            int screenH = dm.heightPixels;
            if (layoutParams.width > 0 && layoutParams.x + layoutParams.width > screenW) {
                layoutParams.x = Math.max(0, screenW - layoutParams.width);
            }
            if (layoutParams.height > 0 && layoutParams.y + layoutParams.height > screenH) {
                layoutParams.y = Math.max(0, screenH - layoutParams.height);
            }
        } catch (Throwable t) {}
    }

    /* ============ 计时 ============ */

    private void startTicking() {
        stopTicking();
        try {
            startElapsed = SystemClock.elapsedRealtime();
            tickHandler = new Handler(Looper.getMainLooper());
            tickRunnable = new Runnable() {
                @Override
                public void run() {
                    try {
                        int s = baseSec + (int) ((SystemClock.elapsedRealtime() - startElapsed) / 1000);
                        String t = fmtDur(s);
                        if (squareTime != null) squareTime.setText(t);
                        if (barTime != null) barTime.setText(t);
                        if (cardTimer != null) cardTimer.setText(t);
                        // 20261004：2号卡片缩放失步自愈——每秒校验窗口尺寸/视图缩放是否与 cardScale
                        // 一致（拖拽中 relayout 丢失的残留），不一致就按当前 cardScale 重新对齐一次
                        if (form == 2 && layoutParams != null && overlayRoot != null && cardFixed != null) {
                            int wantW = (int) (cardNaturalW * cardScale);
                            int wantH = (int) (cardNaturalH * cardScale);
                            boolean sizeOff = layoutParams.width != wantW || layoutParams.height != wantH;
                            boolean scaleOff = Math.abs(cardFixed.getScaleX() - cardScale) > 0.001f
                                    || Math.abs(cardFixed.getScaleY() - cardScale) > 0.001f;
                            // 20261004df：出屏自愈——拖动路径（onTouch MOVE 直接 updateViewLayout）
                            // 不经过 applyCardWindowSize 的钳制，用户把窗口拖到屏缘外时右下角
                            // 缩放手柄会跑出屏摸不到（"放大到最大就不能缩小"的另一半根因）。
                            // 每秒巡检出屏就拉回（只收右/下缘，不动拖放自由）。
                            boolean posOff = false;
                            try {
                                android.util.DisplayMetrics dm = android.content.res.Resources.getSystem().getDisplayMetrics();
                                posOff = layoutParams.x + layoutParams.width > dm.widthPixels
                                        || layoutParams.y + layoutParams.height > dm.heightPixels;
                            } catch (Throwable t2) {}
                            if (sizeOff || scaleOff || posOff) applyCardWindowSize(false);
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

    private String fmtDur(int s) {
        // 20261004：恢复全「分:秒」显示（取消 1 小时进位），与 JS formatDurShort 保持一致；
        // 分钟数自然增长（如 114:23），不再切「X小时Y分」。
        return String.format("%02d:%02d", s / 60, s % 60);
    }

    /* ============ 通用小部件 ============ */

    /** 圆形文字按钮（底色圆 + 居中字符） */
    private TextView circleTextBtn(String text, int sizePx, int bgColor, float sp, int textColor) {
        TextView tv = new TextView(getContext());
        tv.setText(text);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        tv.setTextColor(textColor);
        tv.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(bgColor);
        tv.setBackground(bg);
        return tv;
    }

    /** 头像槽：圆形裁切容器，含「首字占位」与「图片」两个子 View（按需切换） */
    private FrameLayout makeAvatar(int sizePx, int strokeDp) {
        FrameLayout slot = new FrameLayout(getContext());
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xFF7C5CFC);
        if (strokeDp > 0) bg.setStroke(dp(strokeDp), 0xFF7C5CFC);
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
        letter.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(12, sizePx / dp(1) * 0.42f));
        letter.setGravity(Gravity.CENTER);
        slot.addView(letter, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ImageView img = new ImageView(getContext());
        img.setTag("bm-av-img");
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        img.setVisibility(View.GONE);
        slot.addView(img, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return slot;
    }

    /** 头像上屏：有图用圆形裁切图，无图回落首字 */
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

    /** dataURL → 采样压缩 Bitmap；失败返回 null（绝不抛异常） */
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

    /** 通知 JS 层事件（onHangup / onKindChange）；全路径吞异常 */
    private void fireJsEvent(String name, JSObject data) {
        try {
            if (getActivity() != null) {
                getActivity().runOnUiThread(() -> {
                    try { notifyListeners(name, data != null ? data : new JSObject()); } catch (Throwable t) {}
                });
            } else {
                try { notifyListeners(name, data != null ? data : new JSObject()); } catch (Throwable t) {}
            }
        } catch (Throwable t) {}
    }

    /** 延后一帧移除悬浮窗（避免在触摸/点击分发中同步 removeView） */
    private void postRemove() {
        try {
            if (overlayRoot != null) overlayRoot.post(() -> { try { removeOverlay(); } catch (Throwable t) {} });
            else removeOverlay();
        } catch (Throwable t) {
            try { removeOverlay(); } catch (Throwable t2) {}
        }
    }

    private void removeOverlay() {
        try {
            if (viewAttached && overlayRoot != null && windowManager != null) {
                windowManager.removeView(overlayRoot);
            }
        } catch (Throwable t) {}
        overlayRoot = null;
        viewAttached = false;
        windowManager = null;
        squareView = null;
        barView = null;
        cardHost = null;
        cardFixed = null;
        cardBg = null;
        cardUi = null;
        squareTime = null;
        barTime = null;
        cardTimer = null;
        cardStatus = null;
        squareAvatar = null;
        barAvatar = null;
        cardAvatar = null;
        barNameView = null;
        eyeBtn = null;
        muteBtn = null;
        bgBitmap = null;
        uiHidden = false;
        muted = false;
        cardScale = 1f;
        form = 0;
    }

    /** 回到应用：优先 moveToFront（不重建 Activity / WebView / 不重播开屏），
        失败再 launchIntent 兜底；悬浮窗移除一律延后一帧。 */
    private void bringAppToFront() {
        try {
            postRemove(); // 先安排移除（延后一帧，不在触摸分发中移除窗口）
            android.app.ActivityManager am = (android.app.ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                java.util.List<android.app.ActivityManager.AppTask> tasks = null;
                try { tasks = am.getAppTasks(); } catch (Throwable t) { tasks = null; }
                if (tasks != null && !tasks.isEmpty()) {
                    try { tasks.get(0).moveToFront(); return; } catch (Throwable t) { /* 落到兜底 */ }
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
