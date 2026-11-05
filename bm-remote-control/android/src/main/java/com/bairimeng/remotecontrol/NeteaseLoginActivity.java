package com.bairimeng.remotecontrol;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * 网易云直连登录页（20261105）。
 *
 * 打开网易云 H5 登录页（music.163.com），玩家扫码/密码登录后，本 Activity 从
 * WebView 的 CookieManager 里提取 MUSIC_U Cookie，写回 SharedPreferences 供
 * BmRemoteControlPlugin.neteaseRequest 使用，然后 finish() 返回 App。
 *
 * 说明：网易云登录可能需要滑动验证，真机成功率以实测为准（本轮由用户插接口真机验证）。
 */
public class NeteaseLoginActivity extends Activity {

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
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
        });

        // 打开网易云登录页（手机 H5 版更易登录）
        webView.loadUrl("https://music.163.com/#/login");
    }

    private void checkLoginCookie(String url) {
        String cookies = CookieManager.getInstance().getCookie("https://music.163.com");
        if (cookies == null || cookies.isEmpty()) return;
        // 检测到 MUSIC_U（登录成功的核心凭证）即拦截保存
        if (cookies.contains("MUSIC_U=")) {
            // 保存到插件共享的 SharedPreferences
            getSharedPreferences("bm_netease_direct", MODE_PRIVATE)
                    .edit().putString("music_u_cookie", cookies).apply();
            finish();
        }
    }

    @Override
    public void onBackPressed() {
        // 返回时也尝试拦截一次（用户可能已登录但页面未刷新）
        checkLoginCookie("https://music.163.com");
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
