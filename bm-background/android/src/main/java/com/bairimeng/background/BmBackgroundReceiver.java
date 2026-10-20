package com.bairimeng.background;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;

import java.util.List;

/**
 * 白日梦后台主动消息「到期广播接收器」。
 *
 * 触发来源：
 *   1. AlarmManager 精确闹钟到点（ACTION_TASK_DUE）；
 *   2. BOOT_COMPLETED / LOCKED_BOOT_COMPLETED（进程重启后重排未完成闹钟）。
 *
 * 核心约束（审计要求）：
 *   - 不依赖静态插件实例做「任务是否完成」判断或「跨进程恢复」——一律先读 BmTaskStore（SharedPreferences）；
 *   - 静态实例只用于「进程存活且 WebView 已初始化」时把到期事件实时推给 JS；
 *   - WebView 不存在 / 插件实例为 null / 进程刚重启 → 保留 pending 任务 + 发引导通知兜底，
 *     绝不做任何「假装完成」的标记。
 */
public class BmBackgroundReceiver extends BroadcastReceiver {

    private static final String CHANNEL_ID = "bm-background";
    private static final String CHANNEL_NAME = "白日梦后台消息";

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            String action = intent == null ? null : intent.getAction();

            // 开机/重启：读任务表，重排所有「未完成且未过期」的闹钟
            if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                    || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
                    || Intent.ACTION_QUICKBOOT_POWERON.equals(action)) {
                reschedulePending(context);
                return;
            }

            // 到期闹钟
            if (BmBackgroundPlugin.ACTION_TASK_DUE.equals(action)) {
                String taskId = intent.getStringExtra("taskId");
                if (taskId == null || taskId.isEmpty()) return;
                onTaskDue(context, taskId);
            }
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "onReceive failed: " + t.getMessage());
        }
    }

    /** 到期处理：先读任务表判 done，再决定推 JS 还是兜底通知。 */
    private void onTaskDue(Context context, String taskId) {
        // 1. 独立读任务表（权威），不依赖插件实例
        BmTaskStore.BgTask task = BmTaskStore.get(context, taskId);
        if (task == null || "done".equals(task.state)) {
            return; // 已清理/已完成 → 幂等跳过
        }

        // 2. 尝试拿插件实例（进程存活 + WebView 已初始化的通信捷径）
        BmBackgroundPlugin plugin = BmBackgroundPlugin.getInstance();
        if (plugin != null && plugin.getBridge() != null && plugin.getBridge().getWebView() != null
                && plugin.getActivity() != null) {
            // WebView 存活 → 主线程推事件给 JS，由 JS 走统一的 _claimTask → 生成 → 落库 → confirm 流程
            final BmBackgroundPlugin p = plugin;
            final String tid = taskId;
            final String cid = task.charId;
            final long due = task.dueAt;
            plugin.getActivity().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        JSObject data = new JSObject();
                        data.put("taskId", tid);
                        data.put("charId", cid);
                        data.put("dueAt", due);
                        p.notifyListeners(BmBackgroundPlugin.EVENT_DUE, data);
                    } catch (Throwable t) {
                        android.util.Log.e("BmBackground", "notifyListeners failed: " + t.getMessage());
                    }
                }
            });
        } else {
            // WebView 不可用 → 保留 pending + 引导通知兜底
            sendGuideNotification(context, task);
        }
    }

    /** 引导通知兜底：不含真实内容，只引导用户打开查看（真实内容由回前台 JS 补处理）。 */
    private void sendGuideNotification(Context context, BmTaskStore.BgTask task) {
        try {
            ensureChannel(context);
            String title = (task.name == null || task.name.isEmpty() ? "访客" : task.name) + " 发来消息";
            String body = "给你发来了新消息，打开看看吧";

            Intent launch = new Intent(Intent.ACTION_MAIN);
            launch.setComponent(new ComponentName(context, "com.bairimeng.app.MainActivity"));
            launch.addCategory(Intent.CATEGORY_LAUNCHER);
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent contentIntent = PendingIntent.getActivity(context, task.taskId.hashCode(), launch, piFlags);

            Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.stat_notify_chat)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setContentIntent(contentIntent)
                    .build();

            NotificationManagerCompat.from(context).notify(task.taskId.hashCode(), notification);
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "sendGuideNotification failed: " + t.getMessage());
        }
    }

    /** 开机重排：把所有未完成任务的闹钟重新排上（已过期的不排，等回前台 recoverDue）。 */
    private void reschedulePending(Context context) {
        try {
            long now = System.currentTimeMillis();
            List<BmTaskStore.BgTask> list = BmTaskStore.pending(context);
            for (BmTaskStore.BgTask t : list) {
                if (t.dueAt > now) {
                    BmBackgroundPlugin.scheduleAlarm(context, t.taskId, t.dueAt);
                }
            }
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "reschedulePending failed: " + t.getMessage());
        }
    }

    private void ensureChannel(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                    NotificationChannel ch = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
                    ch.setDescription("白日梦后台主动消息引导通知");
                    nm.createNotificationChannel(ch);
                }
            }
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "ensureChannel failed: " + t.getMessage());
        }
    }
}
