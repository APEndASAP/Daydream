import type { PluginListenerHandle } from '@capacitor/core';

export interface CheckResult {
  granted: boolean;
}

export interface ShowResult {
  ok: boolean;
  reason?: string;
}

export interface BmOverlayPlugin {
  /** 检查悬浮窗权限（SYSTEM_ALERT_WINDOW）是否已授予 */
  checkPermission(): Promise<CheckResult>;
  /** 申请悬浮窗权限（无权限时跳系统设置页） */
  requestPermission(): Promise<CheckResult & { openedSettings?: boolean; error?: string }>;
  /** 显示悬浮窗（name 访客名，sub 副标题/时长） */
  show(options: { name: string; sub?: string }): Promise<ShowResult>;
  /** 更新副标题（通话时长跳动） */
  updateSub(options: { sub: string }): Promise<ShowResult>;
  /** 隐藏/移除悬浮窗 */
  hide(): Promise<ShowResult>;
  /** 20261105：锁机——显示全屏锁机覆盖层（番茄钟锁机用） */
  lock(options: { hint?: string }): Promise<ShowResult>;
  /** 20261105：解锁——移除全屏锁机覆盖层 */
  unlock(): Promise<ShowResult>;
}
