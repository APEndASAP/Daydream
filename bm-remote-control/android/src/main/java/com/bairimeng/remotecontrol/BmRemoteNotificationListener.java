package com.bairimeng.remotecontrol;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * 通知监听服务（后台遥控兜底）。
 *
 * Android 11（API 30）+ 的包可见性限制下，MediaSessionManager.getActiveSessions 对
 * 第三方 App 的枚举可能返回空。注册此 NotificationListenerService 后，用户在系统
 * 「通知使用权」里授权，即可稳定枚举第三方音乐 App 的媒体会话（并允许发送媒体控制键）。
 *
 * 本身不做任何事——它是作为 MediaSessionManager 的 NotificationListener 组件名传入，
 * 让系统放行活跃会话枚举。授权入口：ACTION_NOTIFICATION_LISTENER_SETTINGS。
 */
public class BmRemoteNotificationListener extends NotificationListenerService {

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        // 无需处理，仅用于让系统放行媒体会话枚举
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // 无需处理
    }
}
