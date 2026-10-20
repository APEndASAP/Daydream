import { WebPlugin } from '@capacitor/core';
export class BmBackgroundWeb extends WebPlugin {
    async recoverDue() {
        return { ok: true, dueTasks: [] };
    }
    async schedule(_task) {
        return { ok: false, reason: 'web_not_supported' };
    }
    async cancel(_options) {
        return { ok: false, reason: 'web_not_supported' };
    }
    async confirm(_options) {
        return { ok: false, reason: 'web_not_supported' };
    }
}
