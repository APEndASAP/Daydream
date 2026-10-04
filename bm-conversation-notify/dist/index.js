import { registerPlugin } from '@capacitor/core';
const BmConversationNotify = registerPlugin('BmConversationNotify', {
    web: () => import('./web').then((m) => new m.BmConversationNotifyWeb()),
});
export * from './definitions';
export { BmConversationNotify };
