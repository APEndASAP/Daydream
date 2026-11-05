import { WebPlugin } from '@capacitor/core';
import type { BmRemoteControlPlugin, BmRemoteResult, BmRemoteMediaState, BmHttpResult } from './definitions';

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
  async httpRequest(_options: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<BmHttpResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async neteaseRequest(_options: { url: string; method?: string; cookie?: string }): Promise<BmHttpResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async neteaseCookie(): Promise<{ ok: boolean; cookie?: string; loggedIn?: boolean }> {
    return { ok: false, loggedIn: false };
  }
  async neteaseClear(): Promise<BmRemoteResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async neteaseLogin(): Promise<BmRemoteResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
}
