package com.bairimeng.conversation;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 白日梦「会话式通知」独立探针插件。
 *
 * 目的：验证 Android NotificationCompat.MessagingStyle + Person + ShortcutInfoCompat
 *       在 ColorOS 真机上的实际效果（折叠 / 展开历史 / 会话识别 / 覆盖更新）。
 *
 * 本插件是独立探针，不接入白日梦正式通知系统，不触碰 LocalNotifications。
 *
 * 关键实现：
 *   - conversationId 作为 shortcutId + 通知 id 的哈希来源；
 *   - 固定通知 id（conversationId.hashCode()），同会话覆盖同一条通知；
 *   - 内存维护每个会话的历史消息列表（App 进程存活期间有效），每次新消息
 *     把「历史 + 新消息」全部 addMessage 重建 MessagingStyle，实现展开看历史；
 *   - ShortcutInfoCompat(longLived=true) 让系统把同一 conversationId 识别为同一会话。
 *
 * 过度开发边界（本阶段不做）：消息数据库、历史持久化、后台 Service、前台 Service、
 *   生命周期处理、与白日梦业务结合。
 */
@CapacitorPlugin(name = "BmConversationNotify")
public class BmConversationNotifyPlugin extends Plugin {

    private static final String CHANNEL_ID = "bm-conversation";
    private static final String CHANNEL_NAME = "会话通知（探针）";

    /** 会话历史缓存：conversationId -> 消息列表（进程存活期间有效） */
    private final Map<String, List<ConversationMessage>> history = new ConcurrentHashMap<>();

    /** 单条消息模型 */
    private static final class ConversationMessage {
        final String text;
        final long timestamp;
        final String senderName;
        ConversationMessage(String text, long timestamp, String senderName) {
            this.text = text;
            this.timestamp = timestamp;
            this.senderName = senderName;
        }
    }

    @PluginMethod
    public void showConversation(PluginCall call) {
        try {
            String conversationId = call.getString("conversationId", "test_role");
            String senderName = call.getString("senderName", "测试角色");
            String messageText = call.getString("messageText", "");
            long timestamp = System.currentTimeMillis();

            if (conversationId == null || conversationId.isEmpty()) {
                conversationId = "test_role";
            }
            if (senderName == null || senderName.isEmpty()) {
                senderName = "测试角色";
            }

            // 1. 建立通知渠道（Android 8.0+）
            ensureChannel();

            // 2. 登记长期 shortcut，让系统识别同一会话
            registerShortcut(conversationId, senderName);

            // 3. 追加新消息到会话历史
            List<ConversationMessage> msgs = history.get(conversationId);
            if (msgs == null) {
                msgs = new ArrayList<>();
                history.put(conversationId, msgs);
            }
            msgs.add(new ConversationMessage(messageText, timestamp, senderName));

            // 4. 构建会话式通知（MessagingStyle + Person）
            Notification notification = buildConversationNotification(conversationId, senderName, msgs);

            // 5. 固定通知 id = conversationId.hashCode()，同会话覆盖更新
            int notificationId = conversationId.hashCode();
            NotificationManagerCompat.from(getContext()).notify(notificationId, notification);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("notificationId", notificationId);
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", String.valueOf(t.getMessage()));
            call.resolve(ret);
        }
    }

    /** 创建/获取通知渠道 */
    private void ensureChannel() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                NotificationChannel ch = nm.getNotificationChannel(CHANNEL_ID);
                if (ch == null) {
                    ch = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
                    ch.setDescription("白日梦会话式通知探针测试渠道");
                    nm.createNotificationChannel(ch);
                }
            }
        } catch (Throwable t) {
            android.util.Log.e("BmConversation", "ensureChannel failed: " + t.getMessage());
        }
    }

    /** 登记长期 shortcut（conversationId 作 shortcutId） */
    private void registerShortcut(String conversationId, String senderName) {
        try {
            Person person = new Person.Builder().setName(senderName).build();
            ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(getContext(), conversationId)
                    .setLongLived(true)
                    .setPerson(person)
                    .setShortLabel(senderName)
                    .build();
            boolean pushed = ShortcutManagerCompat.pushDynamicShortcut(getContext(), shortcut);
            android.util.Log.i("BmConversation", "pushDynamicShortcut result=" + pushed + " id=" + conversationId);
        } catch (Throwable t) {
            android.util.Log.e("BmConversation", "registerShortcut failed: " + t.getMessage());
        }
    }

    /** 构建 MessagingStyle 会话通知 */
    private Notification buildConversationNotification(String conversationId, String senderName, List<ConversationMessage> msgs) {
        Context ctx = getContext();

        // 发送者 Person（本探针固定用 senderName；角色头像暂用系统默认图标）
        Person sender = new Person.Builder()
                .setName(senderName)
                .build();

        // MessagingStyle：conversationTitle = 会话标题（角色名）
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(sender);
        style.setConversationTitle(senderName);
        for (ConversationMessage m : msgs) {
            // 每条消息归属 senderPerson（同一发送者）
            style.addMessage(new NotificationCompat.MessagingStyle.Message(
                    m.text, m.timestamp, sender));
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle(senderName)
                .setContentText(msgs.isEmpty() ? "" : msgs.get(msgs.size() - 1).text)
                .setStyle(style)
                .setShortcutId(conversationId)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE);

        return builder.build();
    }
}
