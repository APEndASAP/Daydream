# bm-conversation-notify

白日梦会话式通知**独立探针插件**（Capacitor 6，Android）。用于在真机上验证
`NotificationCompat.MessagingStyle` + `Person` + 长期共享 Shortcut 的微信/QQ 式
会话通知效果（同一会话多条消息合并进一条通知、折叠显示最新、展开显示历史）。

> 本插件是独立探针，不包含消息数据库 / 历史同步 / 后台服务；宿主 App 需自行处理
> 通知运行时权限（POST_NOTIFICATIONS）。

## 能力

`showConversation({ conversationId, senderName, messageText })`

- 同一 `conversationId` 固定通知 id（`conversationId.hashCode()`），新消息**原地更新**同一条通知；
- `MessagingStyle` 消息历史在内存中按会话维护，每次重建完整时间线（进程被杀后从当前消息重建）；
- `Person.Builder(name).setKey(conversationId)` 提供发送者身份（未设 icon 时系统用首字生成头像）；
- `ShortcutInfoCompat`（`longLived=true` + `setIntent`）+ `pushDynamicShortcut`，
  让系统将会话识别为 Conversation（含「sesame 长按/对话泡」等系统能力的前置条件）；
- 消息时间戳使用 `System.currentTimeMillis()`。

## 真机验证结论（ColorOS / Android 15，2026-10-03）

- 同会话连发多条 → 通知栏仅 1 条，折叠显示最新一条，展开显示完整历史 ✓
- 发送者首字头像自动生成 ✓
- 不同 `conversationId` 相互独立（多会话并存）✓
- 系统会话识别（shortcut 绑定）✓

## 使用

```ts
import { BmConversationNotify } from 'bm-conversation-notify';

await BmConversationNotify.showConversation({
  conversationId: 'test_role',
  senderName: '测试角色',
  messageText: '你好，这是第一条消息',
});
```

Web 端为空实现（`web.ts`），仅 Android 生效。

## 安装（宿主工程）

```bash
npm install file:../path/to/bm-conversation-notify
npx cap sync android
```

Capacitor 会自动注册插件（`src` 里是 ES module 导出；Android 侧类名
`com.bairimeng.conversation.BmConversationNotifyPlugin`，需在 MainActivity
`registerPlugin(BmConversationNotifyPlugin.class)` 或由 cap 自动扫描注册）。

## 构建

```bash
npm install
npm run build   # tsc -> dist/
```

## 版本

- 1.1.0（2026-10-03）：探针验证通过后的整理版；API 与行为与验证版一致。
- 1.0.0（2026-10-03）：初版探针（ColorOS 真机验证通过）。
