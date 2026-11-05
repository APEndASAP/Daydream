import type { PluginListenerHandle } from '@capacitor/core';

export interface CheckResult {
  granted: boolean;
}

export interface ShowResult {
  ok: boolean;
  reason?: string;
}

/** 歌曲状态（JS 推送同步给原生层显示） */
export interface MusicState {
  /** 歌曲名 */
  title?: string;
  /** 艺术家 */
  artist?: string;
  /** 封面 data URL 或 URL（base64 或 http） */
  cover?: string;
  /** 当前歌词文本（LRC 已解析后的当前行或整段） */
  lyric?: string;
  /** 是否播放中 */
  playing?: boolean;
  /** 当前进度秒 */
  position?: number;
  /** 总时长秒 */
  duration?: number;
  /** 播放模式：'once'|'order'|'one'|'shuffle' */
  mode?: string;
  /** 一起听角色名（null=单人） */
  charName?: string;
  /** 一起听角色头像 data URL */
  charAvatar?: string;
  /** 我的头像 data URL */
  myAvatar?: string;
  /** 我的名字 */
  myName?: string;
  /** 一起听时长文本（如 03:24） */
  togetherText?: string;
  /** 是否在一起听 */
  together?: boolean;
  /** 播放列表（迷你列表用） */
  playlist?: Array<{ id?: string; name?: string; artist?: string; pic?: string }>;
  /** 当前播放序号 */
  playIndex?: number;
}

export interface BmMusicFloatPlugin {
  /** 检查悬浮窗权限（SYSTEM_ALERT_WINDOW） */
  checkPermission(): Promise<CheckResult>;
  /** 申请悬浮窗权限（无权限时跳系统设置页） */
  requestPermission(): Promise<CheckResult & { openedSettings?: boolean }>;
  /** 显示悬浮窗（dot 形态起步），返回是否成功 */
  show(options: MusicState): Promise<ShowResult>;
  /** 更新歌曲状态（切歌/播放/暂停/进度变化时 JS 推送） */
  update(options: MusicState): Promise<ShowResult>;
  /** 隐藏/移除悬浮窗 */
  hide(): Promise<ShowResult>;

  /** 原生按钮回调：播放/暂停切换 */
  addListener(eventName: 'onToggle', listener: () => void): Promise<PluginListenerHandle>;
  /** 原生按钮回调：上一首 */
  addListener(eventName: 'onPrev', listener: () => void): Promise<PluginListenerHandle>;
  /** 原生按钮回调：下一首 */
  addListener(eventName: 'onNext', listener: () => void): Promise<PluginListenerHandle>;
  /** 原生按钮回调：拖动进度条到指定秒 */
  addListener(eventName: 'onSeek', listener: (info: { position: number }) => void): Promise<PluginListenerHandle>;
  /** 原生按钮回调：切换播放模式 */
  addListener(eventName: 'onMode', listener: () => void): Promise<PluginListenerHandle>;
  /** 原生按钮回调：打开播放列表 */
  addListener(eventName: 'onList', listener: () => void): Promise<PluginListenerHandle>;
  /** 原生按钮回调：结束一起听 */
  addListener(eventName: 'onEnd', listener: () => void): Promise<PluginListenerHandle>;
  /** 原生按钮回调：双击回应用 */
  addListener(eventName: 'onEnterApp', listener: () => void): Promise<PluginListenerHandle>;
  /** 原生按钮回调：收起回 dot */
  addListener(eventName: 'onCollapse', listener: () => void): Promise<PluginListenerHandle>;
  /** 原生迷你列表：选中第 index 首 */
  addListener(eventName: 'onSelect', listener: (info: { index: number }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: string, listener: (...args: any[]) => void): Promise<PluginListenerHandle>;
}
