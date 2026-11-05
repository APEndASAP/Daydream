package com.bairimeng.remotecontrol;

import android.content.ComponentName;
import android.content.Context;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * 白日梦后台遥控插件（模式二）。
 *
 * 职责：通过 MediaSessionManager 获取「当前活跃的外部媒体会话」（网易云/QQ音乐/酷狗等
 * 正在播放音乐的 App 会注册媒体会话），并向其发送媒体控制键：
 *   · play / pause / toggle / next / prev
 *   · 读取当前歌曲名 / 艺术家 / 专辑 / 是否播放
 *
 * 限制（与需求文档一致）：
 *   · 只能「盲抽盲切」——即 next/prev/play/pause，无法指定播放某一首歌；
 *   · 不能指定搜索（MediaSession 协议不支持）；
 *   · 目标 App 必须在后台/前台有活跃媒体会话（正在播放或最近播放过且未被杀）。
 *
 * Android 10（API 29）+ 通过 MediaSessionManager.getActiveSessions 可无需
 * NotificationListener 权限获取活跃会话；Android 11+ 受包可见性限制，需配合
 * NotificationListenerService 才能稳定枚举第三方 App 的会话（见 BmRemoteNotificationListener）。
 */
@CapacitorPlugin(name = "BmRemoteControl")
public class BmRemoteControlPlugin extends Plugin {

    /** 通知监听服务授权的 action（引导用户去设置里授权） */
    public static final String SETTINGS_ACTION =
            "android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS";

    private MediaSessionManager getSessionManager() {
        try {
            return (MediaSessionManager) getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
        } catch (Throwable t) {
            return null;
        }
    }

    /** 获取当前活跃的外部媒体会话控制器（第一个非本 App 的会话）。 */
    private MediaController getActiveController() {
        try {
            MediaSessionManager mgr = getSessionManager();
            if (mgr == null) return null;
            ComponentName notifComp = new ComponentName(getContext(), BmRemoteNotificationListener.class);
            List<MediaController> controllers = mgr.getActiveSessions(notifComp);
            if (controllers == null || controllers.isEmpty()) return null;
            String selfPkg = getContext().getPackageName();
            for (MediaController c : controllers) {
                if (c == null || c.getPackageName() == null) continue;
                // 跳过本 App 自己的会话，只控制外部音乐 App
                if (selfPkg.equals(c.getPackageName())) continue;
                // 优先返回「正在播放」的会话
                if (isPlaying(c)) return c;
            }
            // 没有正在播放的，返回第一个外部会话
            for (MediaController c : controllers) {
                if (c != null && c.getPackageName() != null && !selfPkg.equals(c.getPackageName())) {
                    return c;
                }
            }
            return null;
        } catch (Throwable t) {
            return null;
        }
    }

    private static boolean isPlaying(MediaController c) {
        try {
            PlaybackState ps = c.getPlaybackState();
            return ps != null && ps.getState() == PlaybackState.STATE_PLAYING;
        } catch (Throwable t) {
            return false;
        }
    }

    private JSObject mediaStateJson(MediaController c) {
        JSObject o = new JSObject();
        if (c == null) {
            o.put("hasSession", false);
            return o;
        }
        o.put("hasSession", true);
        o.put("packageName", c.getPackageName());
        try {
            PlaybackState ps = c.getPlaybackState();
            o.put("playing", ps != null && ps.getState() == PlaybackState.STATE_PLAYING);
        } catch (Throwable t) {
            o.put("playing", false);
        }
        try {
            android.media.MediaMetadata md = c.getMetadata();
            if (md != null) {
                o.put("title", md.getString(android.media.MediaMetadata.METADATA_KEY_TITLE));
                o.put("artist", md.getString(android.media.MediaMetadata.METADATA_KEY_ARTIST));
                o.put("album", md.getString(android.media.MediaMetadata.METADATA_KEY_ALBUM));
                // 20261105：读封面——网易云/QQ音乐/酷狗通常把封面放进 METADATA_KEY_ALBUM_ART(Bitmap)
                //   或 METADATA_KEY_ART(Bitmap)。读出来后转 base64 data URI 回传前端，让模式二能显示后台封面。
                try {
                    android.graphics.Bitmap art = md.getBitmap(android.media.MediaMetadata.METADATA_KEY_ALBUM_ART);
                    if (art == null) art = md.getBitmap(android.media.MediaMetadata.METADATA_KEY_ART);
                    if (art == null) {
                        // 部分 App 用 METADATA_KEY_ART_URI（Uri）或 METADATA_KEY_ALBUM_ART_URI
                        try {
                            String artUri = md.getString(android.media.MediaMetadata.METADATA_KEY_ART_URI);
                            if (artUri != null && !artUri.isEmpty()) o.put("cover", artUri);
                        } catch (Throwable t2) { /* ignore */ }
                    }
                    if (art != null) {
                        // 压缩到 256px 以内，控制 base64 体积（原封面可能上千像素，直接传会爆内存/拖慢桥接）
                        int w = art.getWidth(), h = art.getHeight();
                        int maxSide = 256;
                        if (w > maxSide || h > maxSide) {
                            float scale = Math.min((float) maxSide / w, (float) maxSide / h);
                            int nw = Math.max(1, Math.round(w * scale));
                            int nh = Math.max(1, Math.round(h * scale));
                            art = android.graphics.Bitmap.createScaledBitmap(art, nw, nh, true);
                        }
                        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                        art.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, bos);
                        byte[] bytes = bos.toByteArray();
                        String b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
                        o.put("cover", "data:image/jpeg;base64," + b64);
                    }
                } catch (Throwable t) { /* ignore */ }
            }
        } catch (Throwable t) { /* ignore */ }
        return o;
    }

    private void resolveOk(PluginCall call, JSObject extra) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        if (extra != null) {
            java.util.Iterator<String> it = extra.keys();
            while (it.hasNext()) {
                String k = it.next();
                try { ret.put(k, extra.get(k)); } catch (Throwable t) { /* ignore */ }
            }
        }
        call.resolve(ret);
    }

    private void resolveErr(PluginCall call, String reason) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("reason", reason);
        call.resolve(ret);
    }

    /** 通知监听服务是否已被授权（Android 11+ 稳定枚举第三方会话依赖此权限）。 */
    @PluginMethod
    public void isNotificationListenerEnabled(PluginCall call) {
        JSObject o = new JSObject();
        try {
            ComponentName cn = new ComponentName(getContext(), BmRemoteNotificationListener.class);
            String flat = android.provider.Settings.Secure.getString(
                    getContext().getContentResolver(),
                    "enabled_notification_listeners");
            boolean enabled = flat != null && flat.contains(cn.flattenToString());
            o.put("enabled", enabled);
        } catch (Throwable t) {
            o.put("enabled", false);
        }
        resolveOk(call, o);
    }

    /** 跳转系统「通知使用权」设置页，引导用户授权通知监听。 */
    @PluginMethod
    public void openNotificationListenerSettings(PluginCall call) {
        try {
            android.content.Intent intent = new android.content.Intent(SETTINGS_ACTION);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            resolveOk(call, null);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /** 20261105：跳转系统「使用情况访问」（PACKAGE_USAGE_STATS）设置页，
        用于锁机权限——该权限是特殊权限，无法用 requestPermissions 弹窗申请，
        只能引导用户去系统设置手动开启。 */
    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        try {
            android.content.Intent intent = new android.content.Intent(
                    android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            resolveOk(call, null);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /** 20261105：是否已授予「使用情况访问」权限（锁机权限）。 */
    @PluginMethod
    public void hasUsageAccess(PluginCall call) {
        JSObject o = new JSObject();
        try {
            android.app.AppOpsManager aom = (android.app.AppOpsManager)
                    getContext().getSystemService(Context.APP_OPS_SERVICE);
            int mode = aom.unsafeCheckOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(), getContext().getPackageName());
            o.put("granted", mode == android.app.AppOpsManager.MODE_ALLOWED);
        } catch (Throwable t) {
            o.put("granted", false);
        }
        resolveOk(call, o);
    }

    /** 是否有活跃外部媒体会话。 */
    @PluginMethod
    public void hasActiveSession(PluginCall call) {
        MediaController c = getActiveController();
        JSObject o = new JSObject();
        o.put("hasSession", c != null);
        if (c != null) {
            o.put("packageName", c.getPackageName());
        }
        resolveOk(call, o);
    }

    /** 读取当前媒体会话状态（歌名/艺术家/是否播放/来源 App）。 */
    @PluginMethod
    public void getMediaState(PluginCall call) {
        MediaController c = getActiveController();
        JSObject o = mediaStateJson(c);
        resolveOk(call, o);
    }

    /** 播放/暂停。 */
    @PluginMethod
    public void toggle(PluginCall call) {
        MediaController c = getActiveController();
        if (c == null) { resolveErr(call, "no_active_session"); return; }
        try {
            PlaybackState ps = c.getPlaybackState();
            if (ps != null && ps.getState() == PlaybackState.STATE_PLAYING) {
                c.getTransportControls().pause();
            } else {
                c.getTransportControls().play();
            }
            resolveOk(call, null);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /** 播放。 */
    @PluginMethod
    public void play(PluginCall call) {
        MediaController c = getActiveController();
        if (c == null) { resolveErr(call, "no_active_session"); return; }
        try {
            c.getTransportControls().play();
            resolveOk(call, null);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /** 暂停。 */
    @PluginMethod
    public void pause(PluginCall call) {
        MediaController c = getActiveController();
        if (c == null) { resolveErr(call, "no_active_session"); return; }
        try {
            c.getTransportControls().pause();
            resolveOk(call, null);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /** 下一首。 */
    @PluginMethod
    public void next(PluginCall call) {
        MediaController c = getActiveController();
        if (c == null) { resolveErr(call, "no_active_session"); return; }
        try {
            c.getTransportControls().skipToNext();
            resolveOk(call, null);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /** 上一首。 */
    @PluginMethod
    public void prev(PluginCall call) {
        MediaController c = getActiveController();
        if (c == null) { resolveErr(call, "no_active_session"); return; }
        try {
            c.getTransportControls().skipToPrevious();
            resolveOk(call, null);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }
}
