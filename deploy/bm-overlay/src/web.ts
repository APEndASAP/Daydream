import { WebPlugin } from '@capacitor/core';
import type { BmOverlayPlugin, CheckResult, ShowResult } from './definitions';

/**
 * 网页端实现：无原生悬浮窗能力，全部静默返回降级结果，
 * 前端据此回退到「软件内 DOM 悬浮」。
 */
export class BmOverlayWeb extends WebPlugin implements BmOverlayPlugin {
  async checkPermission(): Promise<CheckResult> {
    return { granted: false };
  }
  async requestPermission(): Promise<CheckResult & { openedSettings?: boolean; error?: string }> {
    return { granted: false };
  }
  async show(_options: { name: string; sub?: string }): Promise<ShowResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async updateSub(_options: { sub: string }): Promise<ShowResult> {
    return { ok: false };
  }
  async hide(): Promise<ShowResult> {
    return { ok: true };
  }
}
