import type { PluginListenerHandle } from '@capacitor/core';
export interface CheckResult { granted: boolean; }
export interface ShowResult { ok: boolean; reason?: string; }
export interface MusicState {
  title?: string; artist?: string; cover?: string; lyric?: string;
  playing?: boolean; position?: number; duration?: number; mode?: string;
  charName?: string; charAvatar?: string; myAvatar?: string; myName?: string;
  togetherText?: string; together?: boolean;
}
export interface BmMusicFloatPlugin {
  checkPermission(): Promise<CheckResult>;
  requestPermission(): Promise<CheckResult & { openedSettings?: boolean }>;
  show(options: MusicState): Promise<ShowResult>;
  update(options: MusicState): Promise<ShowResult>;
  hide(): Promise<ShowResult>;
  addListener(eventName: string, listener: (...args: any[]) => void): Promise<PluginListenerHandle>;
}
