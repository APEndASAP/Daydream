package com.bairimeng.remotecontrol;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 网易云直连登录页（20261105，20261113 修复「跳一下就回退 / 假登录」）。
 *
 * 打开网易云 H5 登录页（music.163.com），玩家扫码/密码登录后，本 Activity 从
 * WebView 的 CookieManager 里提取 MUSIC_U Cookie，**校验账号接口通过后**再写回
 * SharedPreferences 供 BmRemoteControlPlugin.neteaseRequest 使用，然后 finish() 返回 App。
 *
 * 20261113 真机复现的故障：点「登录网易云」→ 页面闪一下就退回 App，仍显示未登录，
 * 之后所有接口都是「没有直链 / VIP 歌放不了 / 读不到歌单」。根因是 WebView 的
 * CookieManager 里残留着一条**早已失效的 MUSIC_U**（之前登录或浏览网易云页面留下的），
 * 本 Activity 一进 onPageStarted 就读到它、直接保存并 finish()，于是「闪一下就回来」；
 * 而这条 cookie 在服务端已经无效（/api/nuser/account/get 返回 account:null），
 * 前端却因为「cookie 里含 MUSIC_U」显示成已登录 —— 这就是玩家说的假登录。
 *
 * 现在的做法：
 *   ① 打开登录页之前，先把 music.163.com 下的 MUSIC_U 置为过期（只清这一个键，
 *      不动其它 cookie），保证后面读到的一定是这次登录新写入的；
 *   ② 读到 MUSIC_U 后不急着 finish，先带它请求账号接口，account 非空才算真登录；
 *   ③ 校验失败就清掉这条空壳 cookie、留在登录页并提示「登录态无效，请重新登录」，
 *      不再静默退回 App。
 */
public class NeteaseLoginActivity extends Activity {

    private WebView webView;
    private TextView statusView;
    private android.os.Handler cookiePollHandler;
    private int pollCount = 0;
    private volatile boolean verifying = false;   // 正在校验账号接口，避免重复请求
    /* 20261115：进入登录页之前 CookieManager 里就已经存在的凭证。
       它不是「这次登录的成果」，绝不能据此自动返回（见 checkLoginCookie）。 */
    private String baselineCookie = null;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        /* 20261113：顶部加一条状态栏。原来登录页没有任何反馈，玩家点完只看到网页，
           不知道「到底有没有登录成功」，失败时也没有任何提示，只能靠猜。 */
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        statusView = new TextView(this);
        statusView.setTextSize(13f);
        statusView.setTextColor(Color.WHITE);
        statusView.setBackgroundColor(0xFF2A2233);
        statusView.setGravity(Gravity.CENTER_VERTICAL);
        statusView.setPadding(dp(14), dp(8), dp(14), dp(8));
        statusView.setText("正在打开网易云登录页…");
        root.addView(statusView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(webView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setUserAgentString(ws.getUserAgentString());
        // 允许第三方 Cookie，确保登录态写入
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                checkLoginCookie(url);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // 20261105 修复：登录成功后网易云会跳转回首页（url 变化），
                // 此时 MUSIC_U 可能已写入 CookieManager，主动检测一次。
                checkLoginCookie(url);
            }
        });

        // 20261105 修复：扫码登录后 MUSIC_U 写入 CookieManager 有延迟，
        // 页面 onPageFinished 时往往还没写入（导致「登录成功但 Cookie 只有统计 cookie」）。
        // 这里启动一个轮询，每 500ms 检测一次 MUSIC_U，最长 60 秒，检测到立即保存并关闭。
        cookiePollHandler = new android.os.Handler(android.os.Looper.getMainLooper());
        startCookiePoll();

        // 打开网易云登录页（手机 H5 版更易登录）
        // 20261113：先把残留的 MUSIC_U 置过期，否则一进页面就被旧 cookie 骗着「秒登录成功」
        clearStaleCookie();
        /* 20261115「点进去就自动退出」修复：
           20261113 的 clearStaleCookie 只能清非 HttpOnly 的 MUSIC_U —— 但网易云下发的
           MUSIC_U 是 HttpOnly 的，setCookie 清不掉（真机实测：进页面后库里仍有 898 字符的
           MUSIC_U）。于是轮询/onPageStarted 立刻读到它 → 判成「登录成功」→ 300ms 后 finish()，
           玩家看到的就是点一下登录页、闪一下就退回 App。
           记下基线后：只要凭证还是进来时那条，就绝不自动返回；只有它变了（玩家这次真的
           登录/换了账号）才保存并返回。 */
        baselineCookie = collectCookie();
        webView.loadUrl("https://music.163.com/#/login");
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    /** 20261113：只让 MUSIC_U 失效（上次登录残留的空壳），其它 cookie 不动。
        这样无论 WebView 里存过什么，接下来读到的 MUSIC_U 一定是这次登录写入的。 */
    private void clearStaleCookie() {
        try {
            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            String[] urls = {"https://music.163.com", "http://music.163.com", "https://www.music.163.com"};
            for (String u : urls) {
                // 两种写法都要清：带 Domain 的和不带 Domain 的，可能是两条不同的 cookie
                cm.setCookie(u, "MUSIC_U=; Max-Age=0; Path=/");
                cm.setCookie(u, "MUSIC_U=; Max-Age=0; Path=/; Domain=.music.163.com");
            }
            cm.flush();
        } catch (Throwable t) {}
    }

    private void startCookiePoll() {
        cookiePollHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                pollCount++;
                if (isFinishing() || isDestroyed()) return;
                checkLoginCookie("https://music.163.com");
                // 最长轮询 120 次（60 秒）
                if (pollCount < 120) {
                    cookiePollHandler.postDelayed(this, 500);
                }
            }
        }, 500);
    }

    private void checkLoginCookie(String url) {
        // 20261105 修复：登录成功后 MUSIC_U 可能写在不同域名下，
        // 逐个域名尝试读取，任何一处拿到 MUSIC_U 即视为「有凭证」
        String cookies = collectCookie();
        if (cookies == null || cookies.isEmpty()) return;
        // 20261113：MUSIC_U= 后面必须有值，空值（MUSIC_U=;）是清 cookie 留下的残渣
        int idx = cookies.indexOf("MUSIC_U=");
        if (idx < 0) return;
        String after = cookies.substring(idx + "MUSIC_U=".length());
        if (after.isEmpty() || after.startsWith(";")) return;
        // 20261115：还是进来时那条旧凭证 → 不是本次登录的成果，提示玩家自己决定，不自动退出
        if (baselineCookie != null && cookies.equals(baselineCookie)) {
            setStatus("当前已是登录态：可直接返回使用；要换账号请在下方页面重新登录");
            return;
        }
        // 已在校验中就等结果，别重复打账号接口
        if (verifying) return;
        verifying = true;
        setStatus("已检测到登录凭证，正在校验账号…");
        final String ck = cookies;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean ok = accountAlive(ck);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing() || isDestroyed()) return;
                        if (ok) {
                            // 校验通过才落盘 + 返回，避免把空壳 cookie 当成登录态存下来
                            saveCookie(ck);
                            setStatus("登录成功，正在返回…");
                            cookiePollHandler.postDelayed(new Runnable() {
                                @Override public void run() { finish(); }
                            }, 300);
                        } else {
                            // 空壳/失效 cookie：清掉，留在登录页让玩家重新登
                            clearStaleCookie();
                            verifying = false;
                            setStatus("登录态无效（账号接口返回空），请在上方页面重新登录");
                        }
                    }
                });
            }
        }).start();
    }

    /** 汇总各域名下的 cookie 字符串（哪个域名里有 MUSIC_U 就用哪个） */
    private String collectCookie() {
        String[] domains = {
                "https://music.163.com",
                "http://music.163.com",
                "https://www.music.163.com",
                "https://interface.music.163.com",
        };
        for (String d : domains) {
            String c = CookieManager.getInstance().getCookie(d);
            if (c != null && c.contains("MUSIC_U=")) return c;
        }
        return null;
    }

    /** 20261113：带 cookie 问一次账号接口，返回 account 非空才算真登录。
        实测失效 cookie 返回 {"code":200,"account":null,"profile":null}，
        以前只看「cookie 里有没有 MUSIC_U」，就会把这个当成登录成功。 */
    private boolean accountAlive(String cookie) {
        java.net.HttpURLConnection conn = null;
        try {
            java.net.URL u = new java.net.URL("https://music.163.com/api/nuser/account/get");
            conn = (java.net.HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36");
            conn.setRequestProperty("Referer", "https://music.163.com/");
            if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
            int code = conn.getResponseCode();
            java.io.InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) return false;
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            is.close();
            String body = bos.toString("UTF-8");
            // 有效登录态形如 {"code":200,"account":{"id":...},"profile":{...}}
            return body.contains("\"account\":{") || body.contains("\"account\": {");
        } catch (Throwable t) {
            return false;
        } finally {
            if (conn != null) { try { conn.disconnect(); } catch (Throwable t2) {} }
        }
    }

    /** 把网易云凭证落盘：只留 MUSIC_U / __csrf，不把整套统计 cookie 塞进 preferences。
        prefs 名与 key 必须和 BmRemoteControlPlugin.NETEASE_PREF / NETEASE_KEY_COOKIE 一致。 */
    private void saveCookie(String ck) {
        try {
            StringBuilder keep = new StringBuilder();
            for (String part : ck.split(";")) {
                String p = part.trim();
                if (p.isEmpty()) continue;
                String k = p.split("=", 2)[0].trim();
                if ("MUSIC_U".equalsIgnoreCase(k) || "__csrf".equalsIgnoreCase(k)) {
                    if (keep.length() > 0) keep.append("; ");
                    keep.append(p);
                }
            }
            String out = keep.length() > 0 ? keep.toString() : ck;
            getSharedPreferences("bm_netease_direct", MODE_PRIVATE)
                    .edit().putString("music_u_cookie", out).apply();
        } catch (Throwable t) {}
    }

    private void setStatus(final String s) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                // 20261115：轮询每 500ms 都会走到这里，文字没变就别重复 setText
                if (statusView != null && !s.contentEquals(statusView.getText())) statusView.setText(s);
            }
        });
    }

    @Override
    public void onBackPressed() {
        /* 20261115：玩家按返回 = 「就用现在这个状态」。
           有 MUSIC_U 就按统一规则落盘（前端还有三态校验，失效的会被判 expired 并清掉）；
           没有就什么都不存，直接回 App。 */
        String ck = collectCookie();
        if (ck != null && ck.indexOf("MUSIC_U=") >= 0) saveCookie(ck);
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        // 20261105：停止 Cookie 轮询，避免内存泄漏
        if (cookiePollHandler != null) {
            cookiePollHandler.removeCallbacksAndMessages(null);
            cookiePollHandler = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
