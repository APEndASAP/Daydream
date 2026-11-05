import { WebPlugin } from '@capacitor/core';
import type { BmMusicFloatPlugin, CheckResult, ShowResult, MusicState } from './definitions';

/**
 * 网页端实现：无原生悬浮窗能力，全部静默返回降级结果，
 * 前端据此回退到「软件内 DOM 悬浮」。
 */
export class BmMusicFloatWeb extends WebPlugin implements BmMusicFloatPlugin {
  async checkPermission(): Promise<CheckResult> {
    return { granted: false };
  }
  async requestPermission(): Promise<CheckResult & { openedSettings?: boolean }> {
    return { granted: false };
  }
  async show(_options: MusicState): Promise<ShowResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async update(_options: MusicState): Promise<ShowResult> {
    return { ok: false };
  }
  async hide(): Promise<ShowResult> {
    return { ok: true };
  }
}
