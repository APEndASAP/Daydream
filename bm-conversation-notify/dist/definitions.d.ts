export interface ConversationOptions {
    /** 会话唯一标识（shortcutId 同此值，固定 hash 成通知 id） */
    conversationId: string;
    /** 消息发送者名字 */
    senderName: string;
    /** 消息正文 */
    messageText: string;
}
export interface ConversationResult {
    /** 是否成功 */
    ok: boolean;
    /** 通知 id（= conversationId.hashCode()） */
    notificationId?: number;
    /** 失败原因 */
    reason?: string;
}
export interface BmConversationNotifyPlugin {
    /** 发送/更新一条会话式通知（同 conversationId 覆盖同一条） */
    showConversation(options: ConversationOptions): Promise<ConversationResult>;
}
