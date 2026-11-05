import { WebPlugin } from '@capacitor/core';
export class BmRemoteControlWeb extends WebPlugin {
    async hasActiveSession() {
        return { ok: false, hasSession: false, reason: 'web_not_supported' };
    }
    async getMediaState() {
        return { ok: false, hasSession: false, reason: 'web_not_supported' };
    }
    async toggle() {
        return { ok: false, reason: 'web_not_supported' };
    }
    async play() {
        return { ok: false, reason: 'web_not_supported' };
    }
    async pause() {
        return { ok: false, reason: 'web_not_supported' };
    }
    async next() {
        return { ok: false, reason: 'web_not_supported' };
    }
    async prev() {
        return { ok: false, reason: 'web_not_supported' };
    }
    async httpRequest(_options) {
        return { ok: false, reason: 'web_not_supported' };
    }
    async neteaseRequest(_options) {
        return { ok: false, reason: 'web_not_supported' };
    }
    async neteaseCookie() {
        return { ok: false, loggedIn: false };
    }
    async neteaseClear() {
        return { ok: false, reason: 'web_not_supported' };
    }
    async neteaseLogin() {
        return { ok: false, reason: 'web_not_supported' };
    }
}
