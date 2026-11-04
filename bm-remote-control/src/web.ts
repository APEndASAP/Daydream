import { WebPlugin } from '@capacitor/core';
import type { BmRemoteControlPlugin, BmRemoteResult, BmRemoteMediaState } from './definitions';

export class BmRemoteControlWeb extends WebPlugin implements BmRemoteControlPlugin {
  async hasActiveSession(): Promise<BmRemoteResult & { hasSession: boolean }> {
    return { ok: false, hasSession: false, reason: 'web_not_supported' };
  }
  async getMediaState(): Promise<BmRemoteResult & BmRemoteMediaState> {
    return { ok: false, hasSession: false, reason: 'web_not_supported' };
  }
  async toggle(): Promise<BmRemoteResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async play(): Promise<BmRemoteResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async pause(): Promise<BmRemoteResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async next(): Promise<BmRemoteResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async prev(): Promise<BmRemoteResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
}
