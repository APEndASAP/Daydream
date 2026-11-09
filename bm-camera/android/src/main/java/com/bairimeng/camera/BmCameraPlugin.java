package com.bairimeng.camera;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.MeteringPointFactory;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.common.util.concurrent.ListenableFuture;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 白日梦原生相机插件（CameraX，20261108）。
 *
 * 用途：四季「采集」相机——网页 getUserMedia 在安卓 WebView 里拿不到超广角/长焦镜头、
 * 也控制不了对焦与变焦，故改用 CameraX 原生实现，做到：
 *   ① 超广角/主摄/长焦 多物理镜头切换（0.5×/1×/2×/3×，按设备能力吸附，无黑边）；
 *   ② 点击对焦（tap-to-focus，MeteringPoint + FocusMeteringAction，3A 自动测光对焦）；
 *   ③ 双指捏合平滑变焦（CameraControl.setZoomRatio，真实数码变焦）；
 *   ④ 前后摄切换；
 *   ⑤ 拍照返回 base64 dataURL 给 JS。
 *
 * 界面：全屏原生浮层（WindowManager），自带一套仿四季风格的按钮（顶部返回、底部快门/
 * 翻转、倍数条 0.5/1/2/3×）。按钮点击通过 notifyListeners 回传事件给 JS（bmcam-back /
 * bmcam-zoom / bmcam-switch），拍照结果经 capture() 返回 dataUrl。
 *
 * 加固：所有方法全路径 catch Throwable 绝不抛异常杀进程；权限未授予时返回 granted:false。
 */
@CapacitorPlugin(name = "BmCamera")
public class BmCameraPlugin extends Plugin {

    private static final String TAG = "BmCamera";

    private WindowManager windowManager;
    private FrameLayout overlayRoot;
    private WindowManager.LayoutParams overlayParams;
    private PreviewView previewView;
    private boolean overlayAttached = false;

    // 原生 UI 控件
    private TextView zoomLabel;            // 当前倍数文字（右上角）
    private LinearLayout zoomBar;          // 倍数条 0.5/1/2/3
    private TextView[] zoomItems;

    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private CameraSelector currentSelector = CameraSelector.DEFAULT_BACK_CAMERA;
    private ImageCapture imageCapture;
    private Preview preview;
    private ExecutorService cameraExecutor;

    private String facing = "back";
    private float currentFactor = 1.0f;
    private float minZoom = 1.0f;
    private float maxZoom = 1.0f;
    private List<Float> lensFactors = new ArrayList<>();
    private int lensIndex = 0;

    /* ============ 权限 ============ */
    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED;
            ret.put("granted", granted);
        } catch (Throwable t) {
            ret.put("granted", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT < 23) {
                JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return;
            }
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED) {
                JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return;
            }
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    ActivityCompat.requestPermissions(getActivity(),
                            new String[]{ Manifest.permission.CAMERA }, 9002);
                } catch (Throwable t) {}
                JSObject r = new JSObject();
                r.put("granted",
                        ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA)
                                == PackageManager.PERMISSION_GRANTED);
                call.resolve(r);
            });
        } catch (Throwable t) {
            JSObject r = new JSObject(); r.put("granted", false); call.resolve(r);
        }
    }

    /* ============ 打开预览 ============ */
    @PluginMethod
    public void open(PluginCall call) {
        try {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED) {
                JSObject r = new JSObject();
                r.put("ok", false); r.put("reason", "no_permission");
                call.resolve(r);
                return;
            }
            String f = call.getString("facing", "back");
            if (!"back".equals(f) && !"front".equals(f)) f = "back";
            facing = f;
            double factor = call.getDouble("factor", 1.0);
            currentFactor = (float) Math.max(0.3, factor);

            if (cameraExecutor == null) cameraExecutor = Executors.newSingleThreadExecutor();

            ListenableFuture<ProcessCameraProvider> fut = ProcessCameraProvider.getInstance(getContext());
            fut.addListener(() -> {
                try {
                    cameraProvider = fut.get();
                    currentSelector = "front".equals(facing)
                            ? CameraSelector.DEFAULT_FRONT_CAMERA
                            : CameraSelector.DEFAULT_BACK_CAMERA;
                    bindPreviewAndStart();
                    JSObject r = new JSObject();
                    r.put("ok", true);
                    call.resolve(r);
                } catch (Throwable t) {
                    android.util.Log.e(TAG, "open failed: " + t);
                    JSObject r = new JSObject();
                    r.put("ok", false);
                    r.put("reason", String.valueOf(t.getMessage()));
                    call.resolve(r);
                }
            }, ContextCompat.getMainExecutor(getContext()));
        } catch (Throwable t) {
            JSObject r = new JSObject();
            r.put("ok", false); r.put("reason", String.valueOf(t.getMessage()));
            call.resolve(r);
        }
    }

    private void bindPreviewAndStart() {
        getActivity().runOnUiThread(() -> {
            try {
                ensureOverlay();
                preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());
                imageCapture = new ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .build();
                if (cameraProvider.isBound(preview)) cameraProvider.unbindAll();
                camera = cameraProvider.bindToLifecycle(getActivity(), currentSelector, preview, imageCapture);
                readLensInfo();
                refreshZoomUI();
            } catch (Throwable t) {
                android.util.Log.e(TAG, "bind failed: " + t);
            }
        });
    }

    /* 搭全屏浮层 + 仿四季按钮 */
    private void ensureOverlay() {
        if (overlayAttached && overlayRoot != null) return;
        windowManager = (WindowManager) getContext().getSystemService(android.content.Context.WINDOW_SERVICE);
        DisplayMetrics dm = getContext().getResources().getDisplayMetrics();

        overlayRoot = new FrameLayout(getContext());
        overlayRoot.setBackgroundColor(Color.parseColor("#0f0e0c"));

        // 预览视图
        previewView = new PreviewView(getContext());
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        FrameLayout.LayoutParams pvp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        overlayRoot.addView(previewView, pvp);
        previewView.setOnTouchListener((v, ev) -> handleTouch(ev));

        // 顶部渐变条 + 返回键 + 标题 + 倍数文字
        buildTopBar(overlayRoot);
        // 倍数条（底部快门上方）
        buildZoomBar(overlayRoot);
        // 底部按钮条：快门 + 翻转
        buildBottomBar(overlayRoot);

        overlayParams = new WindowManager.LayoutParams(
                dm.widthPixels, dm.heightPixels,
                WindowManager.LayoutParams.TYPE_APPLICATION_PANEL,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.OPAQUE);
        overlayParams.gravity = Gravity.TOP | Gravity.START;

        windowManager.addView(overlayRoot, overlayParams);
        overlayAttached = true;
    }

    private TextView makeLabel(String text, float sizeSp, int color) {
        TextView tv = new TextView(getContext());
        tv.setText(text);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        tv.setTextColor(color);
        tv.setGravity(Gravity.CENTER);
        return tv;
    }

    private void buildTopBar(FrameLayout root) {
        // 顶部渐变（返回键 + 标题）
        LinearLayout top = new LinearLayout(getContext());
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(12), dp(14), dp(12), dp(10));
        GradientDrawable gd = new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{ Color.argb(160, 0, 0, 0), Color.argb(0, 0, 0, 0) });
        top.setBackground(gd);

        TextView back = makeLabel("←", 20, Color.parseColor("#f2ecdd"));
        back.setPadding(0, 0, dp(14), 0);
        back.setOnClickListener(v -> notifyListeners("bmcam-back", new JSObject()));
        top.addView(back);

        TextView title = makeLabel("采集", 16, Color.parseColor("#f2ecdd"));
        title.setGravity(Gravity.LEFT);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, dp(40), 1.0f);
        top.addView(title, tp);

        zoomLabel = makeLabel("1×", 15, Color.parseColor("#f2ecdd"));
        zoomLabel.setGravity(Gravity.RIGHT);
        zoomLabel.setPadding(dp(14), 0, 0, 0);
        top.addView(zoomLabel);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP);
        root.addView(top, lp);
    }

    private void buildZoomBar(FrameLayout root) {
        zoomBar = new LinearLayout(getContext());
        zoomBar.setOrientation(LinearLayout.HORIZONTAL);
        zoomBar.setGravity(Gravity.CENTER);
        int pad = dp(5);
        zoomBar.setPadding(pad, pad, pad, pad);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(22));
        bg.setColor(Color.argb(160, 16, 14, 11));
        zoomBar.setBackground(bg);

        float[] steps = { 0.5f, 1f, 2f, 3f };
        zoomItems = new TextView[steps.length];
        for (int i = 0; i < steps.length; i++) {
            final float fct = steps[i];
            TextView it = makeLabel(fmtFactor(fct), 12, Color.parseColor("#c9c1ac"));
            it.setPadding(dp(10), dp(6), dp(10), dp(6));
            final int idx = i;
            it.setOnClickListener(v -> { setLensInternal(fct); });
            zoomBar.addView(it);
            zoomItems[i] = it;
        }

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lp.bottomMargin = dp(108);
        root.addView(zoomBar, lp);
    }

    private void buildBottomBar(FrameLayout root) {
        LinearLayout bar = new LinearLayout(getContext());
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER);
        bar.setPadding(0, dp(16), 0, dp(28));
        GradientDrawable gd = new GradientDrawable(
                GradientDrawable.Orientation.BOTTOM_TOP,
                new int[]{ Color.argb(200, 0, 0, 0), Color.argb(0, 0, 0, 0) });
        bar.setBackground(gd);

        // 左侧占位（对齐四季相册位置，此处无相册功能，放空）
        FrameLayout left = new FrameLayout(getContext());
        left.setLayoutParams(new LinearLayout.LayoutParams(dp(72), dp(72)));
        bar.addView(left);

        // 快门（大圆）
        TextView shutter = makeLabel("", 0, Color.WHITE);
        GradientDrawable sd = new GradientDrawable();
        sd.setShape(GradientDrawable.OVAL);
        sd.setColor(Color.WHITE);
        sd.setStroke(dp(5), Color.parseColor("#f2ecdd"));
        shutter.setBackground(sd);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(72), dp(72));
        bar.addView(shutter, sp);
        shutter.setOnClickListener(v -> captureInternal());

        // 翻转按钮
        FrameLayout right = new FrameLayout(getContext());
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(dp(72), dp(72));
        right.setLayoutParams(rp);
        TextView flip = makeLabel("⇄", 22, Color.parseColor("#f2ecdd"));
        GradientDrawable fd = new GradientDrawable();
        fd.setCornerRadius(dp(10));
        fd.setColor(Color.argb(150, 16, 14, 11));
        fd.setStroke(dp(1), Color.argb(120, 242, 236, 221));
        flip.setBackground(fd);
        flip.setGravity(Gravity.CENTER);
        right.addView(flip, new FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER));
        flip.setOnClickListener(v -> switchFacingInternal());
        bar.addView(right);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        root.addView(bar, lp);
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                getContext().getResources().getDisplayMetrics()));
    }

    private String fmtFactor(float f) {
        if (f == Math.rint(f)) return ((int) f) + "×";
        if (f == 0.5f) return "0.5×";
        return String.format("%.1f×", f);
    }

    /* 镜头信息：变焦范围 + 物理镜头档位 */
    private void readLensInfo() {
        try {
            if (camera == null) return;
            minZoom = camera.getCameraInfo().getZoomState().getValue().getMinZoomRatio();
            maxZoom = camera.getCameraInfo().getZoomState().getValue().getMaxZoomRatio();
            lensFactors.clear();
            if (minZoom < 0.7f) lensFactors.add(Math.max(0.5f, minZoom));
            lensFactors.add(1.0f);
            if (maxZoom >= 2.0f) lensFactors.add(2.0f);
            if (maxZoom >= 3.0f) lensFactors.add(Math.min(3.0f, maxZoom));
            applyZoom(currentFactor);
        } catch (Throwable t) {
            android.util.Log.e(TAG, "readLensInfo failed: " + t);
        }
    }

    /* ============ 前后摄 ============ */
    @PluginMethod
    public void switchFacing(PluginCall call) {
        switchFacingInternal();
        JSObject r = new JSObject();
        r.put("ok", true); r.put("facing", facing);
        call.resolve(r);
    }

    private void switchFacingInternal() {
        try {
            facing = "front".equals(facing) ? "back" : "front";
            currentSelector = "front".equals(facing)
                    ? CameraSelector.DEFAULT_FRONT_CAMERA
                    : CameraSelector.DEFAULT_BACK_CAMERA;
            if (cameraProvider != null) {
                getActivity().runOnUiThread(() -> {
                    try {
                        if (cameraProvider.isBound(preview)) cameraProvider.unbindAll();
                        camera = cameraProvider.bindToLifecycle(getActivity(), currentSelector, preview, imageCapture);
                        readLensInfo();
                    } catch (Throwable t) {
                        android.util.Log.e(TAG, "switchFacing failed: " + t);
                    }
                });
            }
            JSObject ev = new JSObject();
            ev.put("facing", facing);
            notifyListeners("bmcam-switch", ev);
        } catch (Throwable t) {}
    }

    /* ============ 镜头切换 ============ */
    @PluginMethod
    public void setLens(PluginCall call) {
        double factor = call.getDouble("factor", 1.0);
        setLensInternal((float) factor);
        JSObject r = new JSObject(); r.put("ok", true); call.resolve(r);
    }

    private void setLensInternal(float factor) {
        currentFactor = factor;
        applyZoom(factor);
        refreshZoomUI();
    }

    /* ============ 平滑变焦 ============ */
    @PluginMethod
    public void zoomTo(PluginCall call) {
        double factor = call.getDouble("factor", 1.0);
        float z = (float) Math.max(minZoom, Math.min(maxZoom, factor));
        currentFactor = z;
        applyZoom(z);
        refreshZoomUI();
        JSObject r = new JSObject(); r.put("ok", true); call.resolve(r);
    }

    private void applyZoom(float factor) {
        if (camera == null) return;
        try {
            float z = Math.max(minZoom, Math.min(maxZoom, factor));
            camera.getCameraControl().setZoomRatio(z);
        } catch (Throwable t) {
            android.util.Log.e(TAG, "applyZoom failed: " + t);
        }
    }

    private void refreshZoomUI() {
        getActivity().runOnUiThread(() -> {
            try {
                if (zoomLabel != null) zoomLabel.setText(fmtFactor(currentFactor));
                if (zoomItems != null) {
                    float best = 1f, bd = 1e9f;
                    for (int i = 0; i < zoomItems.length; i++) {
                        float[] steps = { 0.5f, 1f, 2f, 3f };
                        float d = Math.abs(steps[i] - currentFactor);
                        if (d < bd) { bd = d; best = steps[i]; }
                    }
                    for (int i = 0; i < zoomItems.length; i++) {
                        float[] steps = { 0.5f, 1f, 2f, 3f };
                        boolean on = Math.abs(steps[i] - best) < 0.01f;
                        zoomItems[i].setTextColor(on ? Color.parseColor("#1d1a16") : Color.parseColor("#c9c1ac"));
                        GradientDrawable bg = new GradientDrawable();
                        bg.setCornerRadius(dp(16));
                        if (on) bg.setColor(Color.parseColor("#f2ecdd"));
                        zoomItems[i].setBackground(bg);
                    }
                }
            } catch (Throwable t) {}
        });
    }

    /* ============ 点击对焦 ============ */
    @PluginMethod
    public void focusAt(PluginCall call) {
        double x = call.getDouble("x", 0.5);
        double y = call.getDouble("y", 0.5);
        doFocus((float) x, (float) y);
        JSObject r = new JSObject(); r.put("ok", true); call.resolve(r);
    }

    private void doFocus(float x, float y) {
        try {
            if (camera != null && previewView != null) {
                float fx = Math.max(0f, Math.min(1f, x));
                float fy = Math.max(0f, Math.min(1f, y));
                MeteringPointFactory factory = previewView.getMeteringPointFactory();
                MeteringPoint point = factory.createPoint(fx, fy);
                FocusMeteringAction action = new FocusMeteringAction.Builder(point).build();
                camera.getCameraControl().startFocusAndMetering(action);
            }
        } catch (Throwable t) {
            android.util.Log.e(TAG, "focus failed: " + t);
        }
    }

    /* ============ 拍照 ============ */
    @PluginMethod
    public void capture(PluginCall call) {
        captureInternal(call);
    }

    private void captureInternal() {
        captureInternal(null);
    }

    private void captureInternal(PluginCall call) {
        try {
            if (imageCapture == null) {
                if (call != null) {
                    JSObject r = new JSObject(); r.put("ok", false); r.put("reason", "not_ready"); call.resolve(r);
                }
                return;
            }
            // 快门闪光反馈
            getActivity().runOnUiThread(() -> {
                try {
                    View flash = new View(getContext());
                    flash.setBackgroundColor(Color.WHITE);
                    overlayRoot.addView(flash, new FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                    flash.setAlpha(0f);
                    flash.animate().alpha(0.8f).setDuration(60).withEndAction(() ->
                            flash.animate().alpha(0f).setDuration(220).withEndAction(() -> overlayRoot.removeView(flash)).start()).start();
                } catch (Throwable t) {}
            });

            imageCapture.takePicture(
                    ContextCompat.getMainExecutor(getContext()),
                    new ImageCapture.OnImageCapturedCallback() {
                        @Override
                        public void onCaptureSuccess(@NonNull androidx.camera.core.ImageProxy image) {
                            try {
                                Bitmap bmp = imageProxyToBitmap(image);
                                image.close();
                                String dataUrl = bitmapToDataUrl(bmp);
                                if (call != null) {
                                    JSObject r = new JSObject();
                                    r.put("ok", true);
                                    r.put("dataUrl", dataUrl);
                                    call.resolve(r);
                                } else {
                                    // 原生快门按钮触发的拍照：经事件回传 dataUrl
                                    JSObject ev = new JSObject();
                                    ev.put("dataUrl", dataUrl);
                                    notifyListeners("bmcam-photo", ev);
                                }
                            } catch (Throwable t) {
                                if (call != null) {
                                    JSObject r = new JSObject();
                                    r.put("ok", false);
                                    r.put("reason", String.valueOf(t.getMessage()));
                                    call.resolve(r);
                                }
                            }
                        }

                        @Override
                        public void onError(@NonNull ImageCaptureException exc) {
                            if (call != null) {
                                JSObject r = new JSObject();
                                r.put("ok", false);
                                r.put("reason", String.valueOf(exc.getMessage()));
                                call.resolve(r);
                            }
                        }
                    });
        } catch (Throwable t) {
            if (call != null) {
                JSObject r = new JSObject();
                r.put("ok", false); r.put("reason", String.valueOf(t.getMessage()));
                call.resolve(r);
            }
        }
    }

    private Bitmap imageProxyToBitmap(androidx.camera.core.ImageProxy image) {
        androidx.camera.core.ImageProxy.PlaneProxy[] planes = image.getPlanes();
        androidx.camera.core.ImageProxy.PlaneProxy yPlane = planes[0];
        int width = image.getWidth();
        int height = image.getHeight();
        java.nio.ByteBuffer yBuf = yPlane.getBuffer();
        int ySize = yBuf.remaining();
        byte[] nv21 = new byte[ySize + (ySize / 2)];
        yBuf.get(nv21, 0, ySize);
        androidx.camera.core.ImageProxy.PlaneProxy uPlane = planes[1];
        androidx.camera.core.ImageProxy.PlaneProxy vPlane = planes[2];
        java.nio.ByteBuffer uBuf = uPlane.getBuffer();
        java.nio.ByteBuffer vBuf = vPlane.getBuffer();
        int uvSize = ySize / 4;
        for (int i = 0; i < uvSize; i++) {
            nv21[ySize + i * 2] = vBuf.get(i);
            nv21[ySize + i * 2 + 1] = uBuf.get(i);
        }
        android.graphics.YuvImage yuv = new android.graphics.YuvImage(
                nv21, android.graphics.ImageFormat.NV21, width, height, null);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        yuv.compressToJpeg(new Rect(0, 0, width, height), 92, out);
        byte[] jpeg = out.toByteArray();
        return android.graphics.BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
    }

    private String bitmapToDataUrl(Bitmap bmp) {
        Bitmap out = bmp;
        if ("front".equals(facing)) {
            android.graphics.Matrix m = new android.graphics.Matrix();
            m.preScale(-1, 1);
            out = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
        }
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        out.compress(Bitmap.CompressFormat.JPEG, 90, baos);
        byte[] bytes = baos.toByteArray();
        String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
        if (out != bmp && !out.isRecycled()) out.recycle();
        return "data:image/jpeg;base64," + b64;
    }

    /* ============ 触摸：双指变焦 + 单击对焦 ============ */
    private float pinchStartDist = 0f;
    private float pinchStartZoom = 1f;
    private boolean pinching = false;

    private boolean handleTouch(MotionEvent ev) {
        int action = ev.getActionMasked();
        int count = ev.getPointerCount();
        if (count == 2) {
            float dx = ev.getX(0) - ev.getX(1);
            float dy = ev.getY(0) - ev.getY(1);
            float dist = (float) Math.hypot(dx, dy);
            if (action == MotionEvent.ACTION_POINTER_DOWN) {
                pinchStartDist = dist;
                pinchStartZoom = currentFactor;
                pinching = true;
                return true;
            } else if (action == MotionEvent.ACTION_MOVE && pinching) {
                if (pinchStartDist > 0) {
                    float ratio = dist / pinchStartDist;
                    float z = Math.max(minZoom, Math.min(maxZoom, pinchStartZoom * ratio));
                    currentFactor = z;
                    applyZoom(z);
                    refreshZoomUI();
                }
                return true;
            } else if (action == MotionEvent.ACTION_POINTER_UP) {
                pinching = false;
                return true;
            }
        }
        if (action == MotionEvent.ACTION_UP && !pinching) {
            if (previewView != null) {
                float x = ev.getX() / (float) previewView.getWidth();
                float y = ev.getY() / (float) previewView.getHeight();
                doFocus(x, y);
            }
            return true;
        }
        return true;
    }

    /* ============ 关闭 ============ */
    @PluginMethod
    public void close(PluginCall call) {
        closeInternal();
        JSObject r = new JSObject(); r.put("ok", true); call.resolve(r);
    }

    private void closeInternal() {
        try {
            if (cameraProvider != null && cameraProvider.isBound(preview)) cameraProvider.unbindAll();
            if (cameraExecutor != null) { cameraExecutor.shutdown(); cameraExecutor = null; }
            if (windowManager != null && overlayRoot != null && overlayAttached) {
                try { windowManager.removeView(overlayRoot); } catch (Throwable t) {}
            }
            overlayAttached = false;
            overlayRoot = null;
            previewView = null;
            camera = null;
            imageCapture = null;
            preview = null;
            cameraProvider = null;
        } catch (Throwable t) {}
    }

    @Override
    protected void handleOnDestroy() {
        try { closeInternal(); } catch (Throwable t) {}
        super.handleOnDestroy();
    }
}
