package com.bairimeng.background;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.provider.AlarmClock;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;
import java.util.List;

/**
 * 白日梦后台主动消息插件。
 *
 * 职责：原生 AlarmManager 可靠调度 + 任务持久化(BmTaskStore) + 到期事件推 JS + 引导通知兜底。
 *   - schedule(task)：写任务表 + 排精确闹钟；
 *   - cancel(taskId)：清任务表 + 撤闹钟；
 *   - confirm(taskId)：消息落库后标记 done + 撤闹钟（只有 JS 确认落库成功才调用）；
 *   - recoverDue()：回前台把「已到期未完成」任务推回 JS 补处理。
 *
 * 静态实例（WeakReference）仅用于「进程存活时的通信捷径」——Receiver 到点后通过它
 * 把事件实时推给已初始化的 WebView。绝不用于判断任务完成、绝不用于跨进程持久化。
 */
@CapacitorPlugin(name = "BmBackground")
public class BmBackgroundPlugin extends Plugin {

    public static final String ACTION_TASK_DUE = "com.bairimeng.background.ACTION_TASK_DUE";
    public static final String EVENT_DUE = "bmBackgroundDue";

    private static WeakReference<BmBackgroundPlugin> sInstance = new WeakReference<>(null);

    public static BmBackgroundPlugin getInstance() {
        return sInstance.get();
    }

    /**
     * Receiver 到点时调用的唯一入口：把「到期任务」事件在主线程推给已初始化的 WebView。
     *
     * 为什么不直接在 Receiver 里调 notifyListeners：
     *   - notifyListeners(String, JSObject) 是 Plugin 的 protected 方法，Receiver 是外部类无权访问；
     *   - getActivity() 返回 AppCompatActivity（需要 appcompat 依赖），且主线程切换逻辑应收敛在插件内部。
     *
     * 这里封装：判实例/桥/WebView 存活 → 主线程 notifyListeners。三者任一缺失返回 false，
     * 由 Receiver 走「保留 pending + 引导通知」兜底。
     */
    public static boolean emitDue(String taskId, String charId, long dueAt) {
        final BmBackgroundPlugin p = sInstance.get();
        if (p == null) return false;
        final Bridge bridge = p.getBridge();
        if (bridge == null || bridge.getWebView() == null) return false;
        final String tid = taskId;
        final String cid = charId;
        final long due = dueAt;
        try {
            new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override
                public void run() {
                    try {
                        JSObject data = new JSObject();
                        data.put("taskId", tid);
                        data.put("charId", cid);
                        data.put("dueAt", due);
                        p.notifyListeners(EVENT_DUE, data);
                    } catch (Throwable t) {
                        android.util.Log.e("BmBackground", "emitDue notify failed: " + t.getMessage());
                    }
                }
            });
            return true;
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "emitDue post failed: " + t.getMessage());
            return false;
        }
    }

    @Override
    public void load() {
        super.load();
        sInstance = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        sInstance = new WeakReference<>(null);
        super.handleOnDestroy();
    }

    /** 回前台：把「已到期未完成」任务推回 JS。 */
    @PluginMethod
    public void recoverDue(PluginCall call) {
        try {
            List<BmTaskStore.BgTask> due = BmTaskStore.duePending(getContext(), System.currentTimeMillis());
            JSArray arr = new JSArray();
            for (BmTaskStore.BgTask t : due) {
                arr.put(t.toJson());
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("dueTasks", arr);
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", String.valueOf(t.getMessage()));
            ret.put("dueTasks", new JSArray());
            call.resolve(ret);
        }
    }

    /** 排一个到期任务。 */
    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            String taskId = call.getString("taskId", "");
            String charId = call.getString("charId", "");
            long dueAt = call.getLong("dueAt", 0L);
            String name = call.getString("name", "访客");
            String kind = call.getString("kind", "msg");

            if (taskId == null || taskId.isEmpty()) {
                resolveErr(call, "taskId required");
                return;
            }
            if (dueAt <= System.currentTimeMillis()) {
                resolveErr(call, "dueAt already past");
                return;
            }

            BmTaskStore.put(getContext(), taskId, charId, dueAt, name, kind, "pending");
            scheduleAlarm(getContext(), taskId, dueAt);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /** 取消任务。 */
    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            String taskId = call.getString("taskId", "");
            if (taskId == null || taskId.isEmpty()) {
                resolveErr(call, "taskId required");
                return;
            }
            BmTaskStore.remove(getContext(), taskId);
            cancelAlarm(getContext(), taskId);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /** 消息落库成功后：标记 done + 撤闹钟。 */
    @PluginMethod
    public void confirm(PluginCall call) {
        try {
            String taskId = call.getString("taskId", "");
            if (taskId == null || taskId.isEmpty()) {
                resolveErr(call, "taskId required");
                return;
            }
            BmTaskStore.markDone(getContext(), taskId);
            cancelAlarm(getContext(), taskId);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    /**
     * 打开系统时钟 App 的「新建闹钟」界面（AlarmClock.ACTION_SET_ALARM）。
     * 预填小时/分钟/备注（=日程标题），用户在该界面点「保存」后闹钟即建成。
     * 这是 Android 唯一能「真正进系统时钟 App」的方式——系统不允许任何应用
     * 不经用户确认就静默往系统时钟塞闹钟。
     */
    @PluginMethod
    public void setAlarmClock(PluginCall call) {
        try {
            int hour = call.getInt("hour", -1);
            int minute = call.getInt("minute", -1);
            String message = call.getString("message", "");

            if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
                resolveErr(call, "invalid hour/minute");
                return;
            }

            Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
            intent.putExtra(AlarmClock.EXTRA_HOUR, hour);
            intent.putExtra(AlarmClock.EXTRA_MINUTES, minute);
            if (message != null && !message.isEmpty()) {
                intent.putExtra(AlarmClock.EXTRA_MESSAGE, message);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            resolveErr(call, String.valueOf(t.getMessage()));
        }
    }

    private void resolveErr(PluginCall call, String reason) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("reason", reason);
        call.resolve(ret);
    }

    /** 排精确闹钟（setExactAndAllowWhileIdle：Doze 下也尽量准点）。 */
    static void scheduleAlarm(Context ctx, String taskId, long dueAt) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            Intent i = new Intent(ctx, BmBackgroundReceiver.class);
            i.setAction(ACTION_TASK_DUE);
            i.putExtra("taskId", taskId);
            int reqCode = taskId.hashCode();
            PendingIntent pi = PendingIntent.getBroadcast(ctx, reqCode, i,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (am != null) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueAt, pi);
            }
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "scheduleAlarm failed: " + t.getMessage());
        }
    }

    /** 撤闹钟。 */
    static void cancelAlarm(Context ctx, String taskId) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            Intent i = new Intent(ctx, BmBackgroundReceiver.class);
            i.setAction(ACTION_TASK_DUE);
            i.putExtra("taskId", taskId);
            int reqCode = taskId.hashCode();
            PendingIntent pi = PendingIntent.getBroadcast(ctx, reqCode, i,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (am != null) {
                am.cancel(pi);
            }
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "cancelAlarm failed: " + t.getMessage());
        }
    }
}
