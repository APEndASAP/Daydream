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

    /* ============================================================
       网易云直连（20261105 新增）：
       · neteaseRequest(url, method, cookie)：原生层（Java，不受 CORS 限制）带上玩家
         的网易云 Cookie 发起 HTTP 请求，返回 JSON 字符串给前端。这是「登录直连」模式
         的核心桥接——绕过浏览器 CORS，让角色/玩家能直接搜歌、读歌单、拿直链。
       · neteaseLogin()：打开网易云 H5 登录页（内置 WebView），拦截并提取 MUSIC_U
         Cookie 返回给前端，前端存本地（绝不外传）。
       · neteaseCookie()：读取当前保存的 MUSIC_U Cookie（前端可据此判断是否已登录）。
       · neteaseClear()：清除本地保存的 Cookie（退出登录）。
       ============================================================ */

    private static final String NETEASE_PREF = "bm_netease_direct";
    private static final String NETEASE_KEY_COOKIE = "music_u_cookie";

    private android.content.SharedPreferences neteasePrefs() {
        return getContext().getSharedPreferences(NETEASE_PREF, Context.MODE_PRIVATE);
    }

    /** 原生层带 Cookie 请求（前端传入完整 URL + 可选 method + Cookie），返回 {ok,status,body}。
        20261105 修复：返回真实 HTTP 状态码，前端据此判断登录态是否有效、直链是否被 403。 */
    @PluginMethod
    public void neteaseRequest(PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method", "GET");
        String cookie = call.getString("cookie");
        if (url == null || url.isEmpty()) { resolveErr(call, "empty_url"); return; }
        // 未显式传 cookie 时，用本地已保存的 Cookie
        if (cookie == null || cookie.isEmpty()) {
            cookie = neteasePrefs().getString(NETEASE_KEY_COOKIE, "");
        }
        try {
            java.net.HttpURLConnection conn = null;
            java.net.URL u = new java.net.URL(url);
            conn = (java.net.HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(15000);
            conn.setRequestMethod(method == null ? "GET" : method.toUpperCase());
            conn.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36");
            conn.setRequestProperty("Referer", "https://music.163.com/");
            conn.setRequestProperty("Accept", "application/json,text/plain,*/*");
            if (cookie != null && !cookie.isEmpty()) {
                conn.setRequestProperty("Cookie", cookie);
            }
            int code = conn.getResponseCode();
            java.io.InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            String body = "";
            if (is != null) {
                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                is.close();
                body = bos.toString("UTF-8");
            }
            conn.disconnect();
            JSObject o = new JSObject();
            o.put("status", code);
            o.put("body", body);
            resolveOk(call, o);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /** 读取当前已保存的网易云 Cookie（前端据此判断登录态）。 */
    @PluginMethod
    public void neteaseCookie(PluginCall call) {
        String cookie = neteasePrefs().getString(NETEASE_KEY_COOKIE, "");
        JSObject o = new JSObject();
        o.put("cookie", cookie);
        // 20261105 修复：只有真正含 MUSIC_U 才算已登录。
        //   之前只判「非空」，导致只有统计 cookie（Hm_lvt/Hm_lpvt）时也误报 loggedIn=true，
        //   前端以为登录成功，实际取直链/搜歌全部无权限。
        boolean loggedIn = cookie != null && cookie.contains("MUSIC_U=");
        o.put("loggedIn", loggedIn);
        resolveOk(call, o);
    }

    /** 清除本地保存的 Cookie（退出登录）。 */
    @PluginMethod
    public void neteaseClear(PluginCall call) {
        neteasePrefs().edit().remove(NETEASE_KEY_COOKIE).apply();
        resolveOk(call, null);
    }

    /** 保存 Cookie（供 WebView 登录回调使用）。 */
    private void saveCookie(String cookie) {
        if (cookie == null) return;
        // 只保留 MUSIC_U 关键字段，避免把整个 Cookie 头都存下来
        StringBuilder keep = new StringBuilder();
        for (String part : cookie.split(";")) {
            String p = part.trim();
            if (p.isEmpty()) continue;
            String key = p.split("=", 2)[0].trim();
            if ("MUSIC_U".equalsIgnoreCase(key) || "__csrf".equalsIgnoreCase(key)) {
                if (keep.length() > 0) keep.append("; ");
                keep.append(p);
            }
        }
        if (keep.length() == 0) keep = new StringBuilder(cookie);
        neteasePrefs().edit().putString(NETEASE_KEY_COOKIE, keep.toString()).apply();
    }

    /** 打开网易云 H5 登录页（内置 WebView），拦截 MUSIC_U Cookie 后返回。 */
    @PluginMethod
    public void neteaseLogin(PluginCall call) {
        try {
            android.content.Intent intent = new android.content.Intent(
                    getContext(), NeteaseLoginActivity.class);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            resolveOk(call, null);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /* ============================================================
       20261105 B 部分：通用原生 HTTP 请求代理（绕过 CORS）。
       · httpRequest(url, method, headers, body)：原生层（Java，不受浏览器 CORS
         限制）带浏览器 UA + 自定义 headers（可选 Cookie/Referer/User-Agent）发起
         GET/POST 请求，返回 { ok, status, body }。这是 B站 WBI / 小红书 X-s /
         抖音等「前端 fetch 被 CORS 挡住」接口的统一桥接通道。
       · headers 参数为 JSON 对象（可选），前端可传 Referer/Cookie/X-s/X-t 等
         自定义头。body 用于 POST。
       ============================================================ */

    /** 通用原生 HTTP 请求：绕过 CORS，带自定义 headers。 */
    @PluginMethod
    public void httpRequest(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) { resolveErr(call, "empty_url"); return; }
        String method = call.getString("method", "GET");
        String body = call.getString("body", null);
        JSObject headers = call.getObject("headers");
        java.net.HttpURLConnection conn = null;
        try {
            java.net.URL u = new java.net.URL(url);
            conn = (java.net.HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(15000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod(method == null ? "GET" : method.toUpperCase());
            // 默认浏览器 UA（若 headers 里带了则覆盖）
            conn.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36");
            conn.setRequestProperty("Accept", "application/json,text/plain,*/*");
            // 应用前端传入的自定义 headers（Referer/Cookie/X-s/X-t 等）
            if (headers != null) {
                java.util.Iterator<String> it = headers.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    try {
                        String v = headers.getString(k);
                        if (v != null && !v.isEmpty()) {
                            conn.setRequestProperty(k, v);
                        }
                    } catch (Throwable t) { /* ignore 单个 header */ }
                }
            }
            // POST body
            if (body != null && !body.isEmpty()) {
                conn.setDoOutput(true);
                byte[] bytes = body.getBytes("UTF-8");
                conn.setRequestProperty("Content-Length", String.valueOf(bytes.length));
                java.io.OutputStream os = conn.getOutputStream();
                os.write(bytes);
                os.flush();
                os.close();
            }
            int code = conn.getResponseCode();
            java.io.InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            String respBody = "";
            if (is != null) {
                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                is.close();
                respBody = bos.toString("UTF-8");
            }
            JSObject o = new JSObject();
            o.put("status", code);
            o.put("body", respBody);
            resolveOk(call, o);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** 20261105：解析短链重定向（如 b23.tv/XXXX → 最终 bilibili.com/video/BVxxx）。
        前端 fetch 因 CORS 拿不到 302 的 Location 头，这里用原生层手动跟随重定向，
        返回 { ok, finalUrl, status }。用于视频链接解析兜底。 */
    @PluginMethod
    public void resolveRedirect(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) { resolveErr(call, "empty_url"); return; }
        java.net.HttpURLConnection conn = null;
        try {
            java.net.URL u = new java.net.URL(url);
            String current = url;
            // 最多跟 5 次重定向，避免死循环
            for (int i = 0; i < 5; i++) {
                conn = (java.net.HttpURLConnection) new java.net.URL(current).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(12000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36");
                int code = conn.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    if (loc == null || loc.isEmpty()) break;
                    // 处理相对路径
                    if (loc.startsWith("/")) {
                        java.net.URL base = new java.net.URL(current);
                        loc = base.getProtocol() + "://" + base.getHost() + loc;
                    }
                    current = loc;
                    conn.disconnect();
                    conn = null;
                } else {
                    break;
                }
            }
            JSObject o = new JSObject();
            o.put("finalUrl", current);
            o.put("status", conn != null ? 200 : 200);
            resolveOk(call, o);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}

