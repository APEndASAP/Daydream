package com.bairimeng.overlay;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 白日梦原生悬浮窗插件（极简版）。
 *
 * 只做两件事（严格单一职责，避免影响通知/日程）：
 *   1. 申请悬浮窗权限（SYSTEM_ALERT_WINDOW）——跳系统设置页；
 *   2. 在系统层显示一个自定义悬浮 View（头像首字 + 名字 + 时长，可丝滑拖动，点击回应用）。
 *
 * 与通知完全隔离：本插件只用 WindowManager，绝不触碰 LocalNotifications / AlarmManager。
 *
 * 降级容错：无权限或系统不允许时静默返回失败，绝不抛异常崩溃；
 * 前端据返回结果自动回退到「软件内 DOM 悬浮」。
 */
@CapacitorPlugin(name = "BmOverlay")
public class BmOverlayPlugin extends Plugin {

    private WindowManager windowManager;
    private View overlayView;
    private WindowManager.LayoutParams layoutParams;
    private boolean viewAttached = false;

    /* ============ 1. 权限 ============ */

    @PluginMethod
    public void checkPermission(PluginCall call) {
        boolean granted = canDrawOverlay(getContext());
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        boolean granted = canDrawOverlay(getContext());
        if (granted) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("openedSettings", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("openedSettings", false);
            ret.put("error", String.valueOf(e.getMessage()));
            call.resolve(ret);
        }
    }

    /* ============ 2. 悬浮 View ============ */

    /** 显示悬浮窗。data: { name, sub } */
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
            String sub = call.getString("sub", "");
            showOverlay(name, sub);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", String.valueOf(e.getMessage()));
            call.resolve(ret);
        }
    }

    /** 更新副标题（通话时长跳动）。 */
    @PluginMethod
    public void updateSub(PluginCall call) {
        try {
            String sub = call.getString("sub", "");
            if (overlayView != null) {
                TextView tv = overlayView.findViewWithTag("bm-sub");
                if (tv != null) tv.setText(sub);
            }
            call.resolve(new JSObject().put("ok", true));
        } catch (Exception e) {
            call.resolve(new JSObject().put("ok", false));
        }
    }

    /** 隐藏/移除悬浮窗。 */
    @PluginMethod
    public void hide(PluginCall call) {
        try {
            removeOverlay();
            call.resolve(new JSObject().put("ok", true));
        } catch (Exception e) {
            call.resolve(new JSObject().put("ok", false));
        }
    }

    /* ============ 内部实现 ============ */

    private boolean canDrawOverlay(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return android.provider.Settings.canDrawOverlays(ctx);
        }
        return true;
    }

    private void showOverlay(String name, String sub) {
        removeOverlay();

        windowManager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);

        // 根容器：圆角玻璃质感
        FrameLayout root = new FrameLayout(getContext());
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xE6202228);
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(1), 0x33FFFFFF);
        root.setBackground(bg);
        root.setElevation(dp(6));

        // 内容：头像 + 文字
        android.widget.LinearLayout ll = new android.widget.LinearLayout(getContext());
        ll.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        ll.setGravity(Gravity.CENTER_VERTICAL);
        ll.setPadding(dp(14), dp(10), dp(14), dp(10));

        TextView av = new TextView(getContext());
        av.setText(name != null && name.length() > 0 ? String.valueOf(name.charAt(0)) : "?");
        av.setTextColor(Color.WHITE);
        av.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        av.setGravity(Gravity.CENTER);
        GradientDrawable avbg = new GradientDrawable();
        avbg.setColor(0xFF7C5CFC);
        avbg.setShape(GradientDrawable.OVAL);
        av.setBackground(avbg);
        int sz = dp(42);
        ll.addView(av, new android.widget.LinearLayout.LayoutParams(sz, sz));

        android.widget.LinearLayout txt = new android.widget.LinearLayout(getContext());
        txt.setOrientation(android.widget.LinearLayout.VERTICAL);
        txt.setPadding(dp(10), 0, 0, 0);

        TextView nm = new TextView(getContext());
        nm.setText(name);
        nm.setTextColor(Color.WHITE);
        nm.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        nm.setMaxWidth(dp(120));
        nm.setSingleLine(true);
        nm.setEllipsize(android.text.TextUtils.TruncateAt.END);
        txt.addView(nm);

        TextView subTv = new TextView(getContext());
        subTv.setTag("bm-sub");
        subTv.setText(sub);
        subTv.setTextColor(0xFFB8BCC8);
        subTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        txt.addView(subTv);

        ll.addView(txt);
        root.addView(ll);
        overlayView = root;

        // 窗口类型：Android 8.0+（API 26）用 TYPE_APPLICATION_OVERLAY（系统级悬浮窗），
        // 老版本用 TYPE_PHONE。两个都是"浮在其他应用之上"的窗口类型。
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        // 窗口参数：不抢占焦点（FLAG_NOT_FOCUSABLE，避免影响其他应用输入）、
        // 允许拖出屏幕边界（FLAG_LAYOUT_NO_LIMITS）、背景透明。
        layoutParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);

        // 初始位置：屏幕左上角偏下（x=24dp, y=140dp），避免挡住状态栏
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = 24;
        layoutParams.y = dp(140);

        windowManager.addView(overlayView, layoutParams);
        viewAttached = true;

        // 丝滑拖动：手指按下记录起点，移动时用"起点 + 手指位移"增量更新窗口位置。
        // 用 getRawX/getRawY（屏幕绝对坐标）保证跨应用拖动准确；4dp 死区区分"点击"和"拖动"，
        // 没拖动就松手 = 点击（回到应用），拖动了松手 = 停在当前位置。
        root.setOnTouchListener(new View.OnTouchListener() {
            float startX = 0, startY = 0, touchX = 0, touchY = 0;
            boolean dragging = false;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        // 记录按下瞬间的窗口位置和手指位置
                        startX = layoutParams.x;
                        startY = layoutParams.y;
                        touchX = e.getRawX();
                        touchY = e.getRawY();
                        dragging = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        // 手指位移
                        float dx = e.getRawX() - touchX;
                        float dy = e.getRawY() - touchY;
                        // 位移小于 4dp 视为抖动，不判定为拖动（避免点击被误判）
                        if (!dragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return true;
                        dragging = true;
                        // 窗口新位置 = 按下时的位置 + 手指位移
                        layoutParams.x = (int) (startX + dx);
                        layoutParams.y = (int) (startY + dy);
                        try {
                            windowManager.updateViewLayout(overlayView, layoutParams);
                        } catch (Exception ignore) {}
                        return true;
                    case MotionEvent.ACTION_UP:
                        // 全程没拖动 = 单击，回到白日梦应用
                        if (!dragging) bringAppToFront();
                        return true;
                    default:
                        return true;
                }
            }
        });
    }

    private void removeOverlay() {
        try {
            if (viewAttached && overlayView != null && windowManager != null) {
                windowManager.removeView(overlayView);
            }
        } catch (Exception ignore) {}
        overlayView = null;
        viewAttached = false;
        windowManager = null;
    }

    private void bringAppToFront() {
        try {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                getContext().startActivity(launch);
            }
        } catch (Exception ignore) {}
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics());
    }

    @Override
    protected void handleOnDestroy() {
        removeOverlay();
        super.handleOnDestroy();
    }
}
