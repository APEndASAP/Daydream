package com.bairimeng.conversation;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Base64;

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
            String avatar = call.getString("avatar", null); // 20261004dk-fix：可选头像 base64 data URL
            long timestamp = System.currentTimeMillis();

            if (conversationId == null || conversationId.isEmpty()) {
                conversationId = "test_role";
            }
            if (senderName == null || senderName.isEmpty()) {
                senderName = "测试角色";
            }

            // 1. 建立通知渠道（Android 8.0+）
            ensureChannel();

            // 2. 登记长期 shortcut，让系统识别同一会话（带头像则一并设置 icon）
            registerShortcut(conversationId, senderName, avatar);

            // 3. 追加新消息到会话历史
            List<ConversationMessage> msgs = history.get(conversationId);
            if (msgs == null) {
                msgs = new ArrayList<>();
                history.put(conversationId, msgs);
            }
            msgs.add(new ConversationMessage(messageText, timestamp, senderName));
            // 20261004dr：历史截断——每会话最多保留最近 10 条，防展开历史在通知栏无限堆积
            while (msgs.size() > 10) {
                msgs.remove(0);
            }

            // 4. 构建会话式通知（MessagingStyle + Person）
            Notification notification = buildConversationNotification(conversationId, senderName, avatar, msgs);

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

    /** 20261004dr：清空某会话的历史并撤掉托盘通知（玩家点进会话=已读）。
     *  修复真机反馈「消息在通知栏里越堆越多/点进去不刷新」——此前 history 只 add 永不清理。 */
    @PluginMethod
    public void clearConversation(PluginCall call) {
        try {
            String conversationId = call.getString("conversationId", "");
            if (conversationId == null || conversationId.isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "conversationId required");
                call.resolve(ret);
                return;
            }
            history.remove(conversationId);
            NotificationManagerCompat.from(getContext()).cancel(conversationId.hashCode());
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

    /** 把 base64 data URL（可能带 data:image/xxx;base64, 前缀）解码成 Bitmap；失败返回 null */
    private Bitmap decodeAvatar(String avatar) {
        if (avatar == null || avatar.isEmpty()) return null;
        try {
            String base64 = avatar;
            int comma = avatar.indexOf(',');
            if (comma >= 0) base64 = avatar.substring(comma + 1); // 去掉 data:image/...;base64, 前缀
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            if (bytes == null || bytes.length == 0) return null;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Throwable t) {
            return null;
        }
    }

    /** 登记长期 shortcut（conversationId 作 shortcutId；有头像则设置 icon） */
    private void registerShortcut(String conversationId, String senderName, String avatar) {
        try {
            Bitmap icon = decodeAvatar(avatar);
            Person.Builder pb = new Person.Builder().setName(senderName);
            if (icon != null) pb.setIcon(IconCompat.createWithBitmap(icon));
            Person person = pb.build();
            ShortcutInfoCompat.Builder sb = new ShortcutInfoCompat.Builder(getContext(), conversationId)
                    .setLongLived(true)
                    .setPerson(person)
                    .setShortLabel(senderName);
            if (icon != null) sb.setIcon(IconCompat.createWithBitmap(icon));
            boolean pushed = ShortcutManagerCompat.pushDynamicShortcut(getContext(), sb.build());
            android.util.Log.i("BmConversation", "pushDynamicShortcut result=" + pushed + " id=" + conversationId + " hasIcon=" + (icon != null));
        } catch (Throwable t) {
            android.util.Log.e("BmConversation", "registerShortcut failed: " + t.getMessage());
        }
    }

    /** 构建 MessagingStyle 会话通知 */
    private Notification buildConversationNotification(String conversationId, String senderName, String avatar, List<ConversationMessage> msgs) {
        Context ctx = getContext();

        // 发送者 Person（有头像则设 icon，否则系统默认图标）
        Bitmap icon = decodeAvatar(avatar);
        Person.Builder pb = new Person.Builder().setName(senderName);
        if (icon != null) pb.setIcon(IconCompat.createWithBitmap(icon));
        Person sender = pb.build();

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
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE);

        // 20261004dq：点击通知跳转回 App——用 ComponentName 显式指向 MainActivity（插件不持有
        // MainActivity.class 引用，无法 new Intent(ctx, MainActivity.class)），并带
        // FLAG_ACTIVITY_NEW_TASK（从通知栏启动需新任务栈）+ FLAG_ACTIVITY_SINGLE_TOP
        // （App 已在前台时复用不重建）。FLAG_IMMUTABLE 是 Android 12+（API 31+）硬性要求。
        Intent launchIntent = new Intent(Intent.ACTION_MAIN);
        launchIntent.setComponent(new ComponentName(getContext(), "com.bairimeng.app.MainActivity"));
        launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
                getContext(),
                conversationId.hashCode(),
                launchIntent,
                piFlags);
        builder.setContentIntent(contentIntent);

        // 折叠态大头像 = setLargeIcon（Person.setIcon 只影响展开后消息气泡旁小头像）
        if (icon != null) {
            builder.setLargeIcon(icon);
        }

        return builder.build();
    }
}
