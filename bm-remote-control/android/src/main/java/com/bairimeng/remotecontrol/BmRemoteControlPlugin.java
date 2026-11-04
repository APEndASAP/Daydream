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
            }
        } catch (Throwable t) { /* ignore */ }
        return o;
    }

    private void resolveOk(PluginCall call, JSObject extra) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        if (extra != null) {
            for (String k : extra.keySet()) {
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
