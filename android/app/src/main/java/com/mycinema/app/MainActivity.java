package com.mycinema.app;

import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean immersiveFullscreen = false;
    private View customFullscreenView = null;
    private FrameLayout customFullscreenContainer = null;
    private WebChromeClient.CustomViewCallback customViewCallback = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ExternalPlayerPlugin.class);
        super.onCreate(savedInstanceState);
        hookFullscreenChromeClient();
    }

    private void hookFullscreenChromeClient() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || this.bridge == null || this.bridge.getWebView() == null) return;
        final WebChromeClient orig = this.bridge.getWebView().getWebChromeClient();
        if (orig == null) return;
        this.bridge.getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customFullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customFullscreenView = view;
                customViewCallback = callback;
                FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                customFullscreenContainer = new FrameLayout(MainActivity.this);
                customFullscreenContainer.setBackgroundColor(0xFF000000);
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    Gravity.CENTER
                );
                customFullscreenContainer.addView(view, lp);
                decor.addView(customFullscreenContainer, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                ));
                setImmersiveFullscreen(true);
            }

            @Override
            public void onHideCustomView() {
                if (customFullscreenContainer != null) {
                    FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                    decor.removeView(customFullscreenContainer);
                    customFullscreenContainer = null;
                }
                customFullscreenView = null;
                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                    customViewCallback = null;
                }
                setImmersiveFullscreen(false);
            }

            @Override public void onProgressChanged(android.webkit.WebView v, int p) { orig.onProgressChanged(v, p); }
            @Override public void onReceivedTitle(android.webkit.WebView v, String t) { orig.onReceivedTitle(v, t); }
            @Override public boolean onJsAlert(android.webkit.WebView v, String u, String m, android.webkit.JsResult r) { return orig.onJsAlert(v, u, m, r); }
            @Override public boolean onJsConfirm(android.webkit.WebView v, String u, String m, android.webkit.JsResult r) { return orig.onJsConfirm(v, u, m, r); }
            @Override public boolean onJsPrompt(android.webkit.WebView v, String u, String m, String d, android.webkit.JsPromptResult r) { return orig.onJsPrompt(v, u, m, d, r); }
            @Override public boolean onShowFileChooser(android.webkit.WebView v, android.webkit.ValueCallback<android.net.Uri[]> cb, FileChooserParams p) { return orig.onShowFileChooser(v, cb, p); }
            @Override public void onPermissionRequest(android.webkit.PermissionRequest r) { orig.onPermissionRequest(r); }
            @Override public void onGeolocationPermissionsShowPrompt(String o, android.webkit.GeolocationPermissions.Callback cb) { orig.onGeolocationPermissionsShowPrompt(o, cb); }
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage m) { return orig.onConsoleMessage(m); }
            @Override public android.graphics.Bitmap getDefaultVideoPoster() { return orig.getDefaultVideoPoster(); }
        });
    }

    public void setImmersiveFullscreen(boolean enabled) {
        immersiveFullscreen = enabled;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = enabled
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            getWindow().setAttributes(lp);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), !enabled);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if (enabled) controller.hide(WindowInsetsCompat.Type.systemBars());
            else controller.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && immersiveFullscreen) {
            setImmersiveFullscreen(true);
        }
    }
}
