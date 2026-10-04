import { WebPlugin } from '@capacitor/core';
import type { BmConversationNotifyPlugin, ConversationOptions, ConversationResult } from './definitions';

export class BmConversationNotifyWeb extends WebPlugin implements BmConversationNotifyPlugin {
  async showConversation(_options: ConversationOptions): Promise<ConversationResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
}
