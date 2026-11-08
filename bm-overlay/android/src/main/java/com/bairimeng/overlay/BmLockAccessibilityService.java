package com.bairimeng.overlay;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * 白日梦「锁机」无障碍服务。
 *
 * 职责：番茄钟专注锁机期间，拦截系统导航键（Home / 返回 / 最近任务 / 分屏），
 * 让普通 App（非 Device Owner）也能「真正锁住手机」，而不是只加一层遮罩。
 *
 * 原理：
 * ① 通过 flagRequestFilterKeyEvents 申请键盘事件过滤，重写 onKeyEvent 消费
 *   KEYCODE_HOME / KEYCODE_BACK / KEYCODE_APP_SWITCH，返回 true 表示「已处理，不再
 *   传递给系统」，从而拦截这些按键（三键导航模式有效）。
 * ② 20261107 升级：全面屏手势导航下，上滑回桌面是「手势」不是按键，onKeyEvent
 *   收不到事件。改为监听窗口变化事件（TYPE_WINDOW_STATE_CHANGED / TYPE_WINDOWS_CHANGED），
 *   锁机期间一旦检测到白日梦失去前台（有其他窗口抢到焦点/桌面出现），立即用
 *   performGlobalAction(GLOBAL_ACTION_HOME) + 拉起白日梦把前台抢回来。
 *
 * 仅当用户开启锁机时才激活拦截（isLocking 静态标志），平时完全放行，不影响正常使用。
 *
 * 局限说明：不同厂商 ROM 对无障碍拦截导航的支持程度不一（个别 ROM 可能放行），
 * 但这是普通 App 能做到的最强锁机方案（更强需 Device Owner / 系统签名）。
 */
public class BmLockAccessibilityService extends AccessibilityService {

    /** 是否处于锁机拦截状态（由 BmOverlayPlugin.lock()/unlock() 置位）。 */
    public static volatile boolean isLocking = false;

    /** 服务实例（供插件读取是否已连接）。 */
    public static volatile BmLockAccessibilityService instance = null;

    /** 主线程 Handler，用于延迟抢回前台（防抖，避免高频触发）。 */
    private final Handler handler = new Handler(Looper.getMainLooper());

    /** 抢回前台的 Runnable（防抖：短时间内多次触发只执行一次）。 */
    private final Runnable reclaimRunnable = new Runnable() {
        @Override
        public void run() {
            try {
                if (!isLocking) return;
                // 先 Home 键回到桌面态，再立刻把白日梦拉回前台，实现「抢回」。
                performGlobalAction(GLOBAL_ACTION_HOME);
            } catch (Throwable t) {}
            try {
                // 延迟一点再把白日梦拉起，确保 Home 动作已生效。
                handler.postDelayed(() -> {
                    try {
                        if (!isLocking) return;
                        relaunchSelf();
                    } catch (Throwable t) {}
                }, 120);
            } catch (Throwable t) {}
        }
    };

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // 锁机期间，监听窗口变化：一旦有别的窗口抢焦点/白日梦失去前台，就抢回。
        if (!isLocking) return;
        try {
            int type = event.getEventType();
            if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                    || type == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
                String pkg = event.getPackageName() != null ? event.getPackageName().toString() : "";
                // 焦点切到了非白日梦的窗口（桌面/别的 App）→ 抢回
                if (pkg != null && pkg.length() > 0 && !pkg.equals(getPackageName())) {
                    handler.removeCallbacks(reclaimRunnable);
                    handler.postDelayed(reclaimRunnable, 180);
                }
            }
        } catch (Throwable t) {}
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    /** 把白日梦 App 重新拉回前台（锁机期间抢回）。 */
    private void relaunchSelf() {
        try {
            android.content.Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch != null) {
                launch.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                        | android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                startActivity(launch);
            }
        } catch (Throwable t) {}
    }

    /**
     * 拦截系统导航键。锁机期间（isLocking=true）消费 Home/Back/AppSwitch 等键，
     * 返回 true 阻止系统执行默认动作（回桌面/退出/切最近任务）。
     */
    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        if (!isLocking) {
            return super.onKeyEvent(event);
        }
        // 只拦截按键按下/抬起，避免重复处理；ACTION_UP 时返回 true 完成一次完整拦截
        int key = event.getKeyCode();
        switch (key) {
            case KeyEvent.KEYCODE_HOME:
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_APP_SWITCH:
                return true;   // 消费掉，锁机期间禁止切走
            default:
                return super.onKeyEvent(event);
        }
    }
}
