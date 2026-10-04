import { registerPlugin } from '@capacitor/core';
import type { BmConversationNotifyPlugin } from './definitions';

const BmConversationNotify = registerPlugin<BmConversationNotifyPlugin>('BmConversationNotify', {
  web: () => import('./web').then((m) => new m.BmConversationNotifyWeb()),
});

export * from './definitions';
export { BmConversationNotify };
