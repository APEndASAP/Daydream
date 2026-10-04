import { WebPlugin } from '@capacitor/core';
import type { BmConversationNotifyPlugin, ConversationOptions, ConversationResult } from './definitions';
export declare class BmConversationNotifyWeb extends WebPlugin implements BmConversationNotifyPlugin {
    showConversation(_options: ConversationOptions): Promise<ConversationResult>;
}
