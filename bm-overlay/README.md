# bm-overlay · 白日梦原生悬浮窗插件

一个 **Capacitor 6 原生插件**，让「白日梦」App 的通话小窗能够**浮到系统层（其他应用之上）**，并支持丝滑拖动、点击回到应用。

## 它是干嘛的

白日梦是一款 AI 角色陪伴应用。用户和角色「通话」时，如果把通话缩小，默认只能在 App 内部的 WebView 里显示一个小窗；一旦切到微信、桌面等其他界面，这个小窗会随 App 一起被系统收起。

本插件解决的就是这个问题：通话缩小后，用一个**系统级悬浮窗**（Android `WindowManager` + `TYPE_APPLICATION_OVERLAY`）把小窗画到其他应用之上，用户可以在刷微信、看桌面时继续看到通话状态，点小窗就能跳回白日梦。

## 能力边界（刻意做小，避免副作用）

本插件**只做三件事**，严格单一职责：

1. **申请悬浮窗权限** —— 检查 `SYSTEM_ALERT_WINDOW` 权限，未授权时引导用户跳系统设置页开启；
2. **显示/更新/隐藏悬浮窗** —— 显示一个带头像首字、访客名、通话时长的圆角小窗，可实时更新时长；
3. **丝滑拖动 + 点击回应用** —— 手指拖动小窗到任意位置（跨应用），没拖动就松手 = 单击回到白日梦。

**它刻意不碰**：通知、日程提醒、闹钟（那些走 `@capacitor/local-notifications` 的 `NotificationManager` 通道，与本插件的 `WindowManager` 完全隔离，互不干扰）。

## 降级容错

- 用户**拒绝悬浮窗权限**、或系统不允许 → 插件静默返回失败，**绝不崩溃**；前端据返回结果自动回退到「软件内 DOM 悬浮」。
- 网页端（无原生能力）→ 全部返回降级结果，同样回退。

## 前端如何调用

前端通过 Capacitor 原生插件注册机制直接访问，**无需 npm 包、无需 dist 编译**：

```js
const Bm = window.Capacitor.Plugins.BmOverlay;

// 检查权限
const { granted } = await Bm.checkPermission();

// 无权限则申请（跳系统设置页）
if (!granted) await Bm.requestPermission();

// 显示悬浮窗
const { ok } = await Bm.show({ name: '访客名', sub: '00:12' });

// 更新通话时长
await Bm.updateSub({ sub: '00:13' });

// 隐藏
await Bm.hide();
```

## 接口清单

| JS 接口 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `checkPermission()` | 无 | `{ granted: boolean }` | 是否已授予悬浮窗权限 |
| `requestPermission()` | 无 | `{ granted, openedSettings?, error? }` | 未授权则跳系统设置页 |
| `show()` | `{ name, sub? }` | `{ ok, reason? }` | 显示悬浮窗 |
| `updateSub()` | `{ sub }` | `{ ok }` | 更新副标题（通话时长） |
| `hide()` | 无 | `{ ok }` | 隐藏并移除悬浮窗 |

## 技术要点

- **窗口类型**：Android 8.0+ 用 `TYPE_APPLICATION_OVERLAY`，老版本用 `TYPE_PHONE`；
- **不抢占焦点**：`FLAG_NOT_FOCUSABLE`，悬浮窗不会打断其他应用的输入；
- **丝滑拖动**：`OnTouchListener` 用屏幕绝对坐标（`getRawX/getRawY`）+ 4dp 死区区分「点击 / 拖动」，`updateViewLayout` 增量更新位置；
- **最低版本**：`minSdk 23`，`compileSdk 35`，`targetSdk 34`，Java 17。

## 目录结构

```
bm-overlay/
├── android/
│   ├── build.gradle
│   └── src/main/
│       ├── AndroidManifest.xml          # 只声明 SYSTEM_ALERT_WINDOW
│       └── java/com/bairimeng/overlay/
│           └── BmOverlayPlugin.java     # 插件核心（权限 + 悬浮 View + 拖动）
├── src/
│   ├── definitions.ts                   # TypeScript 接口类型
│   ├── index.ts                         # registerPlugin 注册
│   └── web.ts                           # 网页端降级实现
└── dist/                                # 编译产物（供 cap sync 识别）
```

## 许可

仅用于「白日梦」项目内部。
