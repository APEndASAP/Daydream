package com.bairimeng.background;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * 白日梦后台主动消息「任务表」持久化（SharedPreferences）。
 *
 * 关键设计：这是跨进程/跨重启的权威任务状态来源，独立于插件实例与 WebView 生命周期。
 *   - BmBackgroundReceiver 到点后【不依赖插件实例】，直接读本表判断任务是否已完成；
 *   - 进程被杀重启后，BOOT_COMPLETED 读本表重排未完成闹钟；
 *   - App 回前台，Plugin.recoverDue 读本表把「已到期未完成」任务推回 JS 补处理。
 *
 * 任务状态：pending（已排待处理）→ done（消息落库后 confirm 置位）。
 * 结构：SharedPreferences 键 "bmBgTasks"，值 JSONObject { taskId: {taskId,charId,dueAt,name,kind,state} }。
 */
public final class BmTaskStore {

    private static final String PREFS = "bm_background_tasks";
    private static final String KEY_TASKS = "bmBgTasks";

    private BmTaskStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject loadAll(Context ctx) {
        try {
            String raw = prefs(ctx).getString(KEY_TASKS, "{}");
            return new JSONObject(raw);
        } catch (Throwable t) {
            return new JSONObject();
        }
    }

    private static void saveAll(Context ctx, JSONObject obj) {
        try {
            prefs(ctx).edit().putString(KEY_TASKS, obj.toString()).apply();
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "saveAll failed: " + t.getMessage());
        }
    }

    /** 写入/更新一个任务（同 taskId 覆盖）。state 缺省 pending。 */
    public static synchronized void put(Context ctx, String taskId, String charId, long dueAt, String name, String kind, String state) {
        JSONObject all = loadAll(ctx);
        try {
            JSONObject t = new JSONObject();
            t.put("taskId", taskId);
            t.put("charId", charId == null ? "" : charId);
            t.put("dueAt", dueAt);
            t.put("name", name == null ? "" : name);
            t.put("kind", kind == null ? "" : kind);
            t.put("state", state == null ? "pending" : state);
            all.put(taskId, t);
            saveAll(ctx, all);
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "put task failed: " + t.getMessage());
        }
    }

    /** 把任务标记为 done（消息已落库，confirm）。 */
    public static synchronized void markDone(Context ctx, String taskId) {
        JSONObject all = loadAll(ctx);
        try {
            JSONObject t = all.optJSONObject(taskId);
            if (t != null) {
                t.put("state", "done");
                all.put(taskId, t);
                saveAll(ctx, all);
            }
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "markDone failed: " + t.getMessage());
        }
    }

    /** 删除任务（cancel）。 */
    public static synchronized void remove(Context ctx, String taskId) {
        JSONObject all = loadAll(ctx);
        try {
            all.remove(taskId);
            saveAll(ctx, all);
        } catch (Throwable t) {
            android.util.Log.e("BmBackground", "remove failed: " + t.getMessage());
        }
    }

    /** 取单个任务；不存在返回 null。 */
    public static synchronized BgTask get(Context ctx, String taskId) {
        JSONObject all = loadAll(ctx);
        JSONObject t = all.optJSONObject(taskId);
        if (t == null) return null;
        return fromJson(t);
    }

    /** 是否已完成（done）。任务不存在视为「已完成」（避免闹钟对已清理任务重复投递）。 */
    public static synchronized boolean isDone(Context ctx, String taskId) {
        JSONObject all = loadAll(ctx);
        JSONObject t = all.optJSONObject(taskId);
        if (t == null) return true; // 已清理 = 视为完成
        return "done".equals(t.optString("state", "pending"));
    }

    /** 取所有「已到期（dueAt <= now）且未完成」的任务，用于回前台 recoverDue。 */
    public static synchronized List<BgTask> duePending(Context ctx, long now) {
        List<BgTask> out = new ArrayList<>();
        JSONObject all = loadAll(ctx);
        Iterator<String> it = all.keys();
        while (it.hasNext()) {
            String k = it.next();
            JSONObject t = all.optJSONObject(k);
            if (t == null) continue;
            String state = t.optString("state", "pending");
            long dueAt = t.optLong("dueAt", 0);
            if (!"done".equals(state) && dueAt <= now) {
                out.add(fromJson(t));
            }
        }
        return out;
    }

    /** 取所有未完成（pending）任务，用于 BOOT_COMPLETED 重排闹钟。 */
    public static synchronized List<BgTask> pending(Context ctx) {
        List<BgTask> out = new ArrayList<>();
        JSONObject all = loadAll(ctx);
        Iterator<String> it = all.keys();
        while (it.hasNext()) {
            String k = it.next();
            JSONObject t = all.optJSONObject(k);
            if (t == null) continue;
            String state = t.optString("state", "pending");
            if (!"done".equals(state)) {
                out.add(fromJson(t));
            }
        }
        return out;
    }

    private static BgTask fromJson(JSONObject t) {
        BgTask task = new BgTask();
        task.taskId = t.optString("taskId", "");
        task.charId = t.optString("charId", "");
        task.dueAt = t.optLong("dueAt", 0);
        task.name = t.optString("name", "");
        task.kind = t.optString("kind", "");
        task.state = t.optString("state", "pending");
        return task;
    }

    /** 任务模型（供 Receiver / Plugin 传递）。 */
    public static final class BgTask {
        public String taskId;
        public String charId;
        public long dueAt;
        public String name;
        public String kind;
        public String state;

        public JSONObject toJson() {
            JSONObject j = new JSONObject();
            try {
                j.put("taskId", taskId);
                j.put("charId", charId);
                j.put("dueAt", dueAt);
                j.put("name", name);
                j.put("kind", kind);
                j.put("state", state);
            } catch (Throwable t) {}
            return j;
        }
    }
}
