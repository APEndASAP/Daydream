import { WebPlugin } from '@capacitor/core';
export class BmConversationNotifyWeb extends WebPlugin {
    async showConversation(_options) {
        return { ok: false, reason: 'web_not_supported' };
    }
}
