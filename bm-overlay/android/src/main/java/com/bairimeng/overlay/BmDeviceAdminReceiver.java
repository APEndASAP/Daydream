package com.bairimeng.overlay;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 白日梦「设备所有者」接收器（Device Owner / Device Admin）。
 *
 * 用途：让愿意彻底锁死的用户，通过 adb 把白日梦设成「设备所有者」：
 *   adb shell dpm set-device-owner com.bairimeng.app/com.bairimeng.overlay.BmDeviceAdminReceiver
 * 设成 Device Owner 后，番茄钟锁机可调用 setLockTaskPackages() 白名单 + startLockTask()，
 * 做到「完全锁死」：不弹确认框、连「长按返回+最近任务」组合键都退不出，唯一出口是「退出锁机」按钮。
 *
 * 关键特性（须向用户说明）：
 *   1. Device Owner 是「永久身份」，记录在系统设备策略里，不是记录在 APK 里。
 *      只要【包名不变 + 签名不变】，覆盖安装新版本后 Device Owner 身份继续有效。
 *      （白日梦用固定 keystore 签名，覆盖安装不会丢 Device Owner。）
 *   2. 设成 Device Owner 后，App 无法普通卸载，需先解除（dpm remove-active-admin）或恢复出厂。
 *   3. 非 Device Owner 的用户不受影响——仍走 LockTask（会弹确认框 + 组合键可退出）。
 *
 * 本类只做 Device Admin 的声明承载，业务逻辑（是否已设 Device Owner、白名单、startLockTask）
 * 在 BmOverlayPlugin 里实现。
 */
public class BmDeviceAdminReceiver extends DeviceAdminReceiver {

    @Override
    public void onEnabled(Context context, Intent intent) {
        // Device Owner / Device Admin 被启用（可选，无需额外处理）
        super.onEnabled(context, intent);
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        // Device Admin 被停用（可选，无需额外处理）
        super.onDisabled(context, intent);
    }
}
