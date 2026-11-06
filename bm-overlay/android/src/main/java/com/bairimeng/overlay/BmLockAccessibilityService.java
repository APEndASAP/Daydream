package com.bairimeng.overlay;

import android.accessibilityservice.AccessibilityService;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * 白日梦「锁机」无障碍服务。
 *
 * 职责：番茄钟专注锁机期间，拦截系统导航键（Home / 返回 / 最近任务 / 分屏），
 * 让普通 App（非 Device Owner）也能「真正锁住手机」，而不是只加一层遮罩。
 *
 * 原理：通过 flagRequestFilterKeyEvents 申请键盘事件过滤，重写 onKeyEvent 消费
 * KEYCODE_HOME / KEYCODE_BACK / KEYCODE_APP_SWITCH，返回 true 表示「已处理，不再
 * 传递给系统」，从而拦截这些键。仅当用户开启锁机时才激活拦截（isLocking 静态标志），
 * 平时完全放行，不影响正常使用。
 *
 * 局限说明：不同厂商 ROM 对无障碍拦截 Home 键的支持程度不一（个别 ROM 可能放行），
 * 但这是普通 App 能做到的最强锁机方案（更强需 Device Owner / 系统签名）。
 */
public class BmLockAccessibilityService extends AccessibilityService {

    /** 是否处于锁机拦截状态（由 BmOverlayPlugin.lock()/unlock() 置位）。 */
    public static volatile boolean isLocking = false;

    /** 服务实例（供插件读取是否已连接）。 */
    public static volatile BmLockAccessibilityService instance = null;

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // 本服务只做键盘事件过滤，不处理无障碍事件
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
