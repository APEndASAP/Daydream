export interface BmBackgroundTask {
  /** 稳定任务 id = charId|类别（proactive/summon/checkin/call/packet） */
  taskId: string;
  /** 角色 id */
  charId: string;
  /** 到期时间戳（毫秒） */
  dueAt: number;
  /** 角色名（引导通知兜底用） */
  name?: string;
  /** 任务类别 */
  kind?: string;
}

export interface BmBackgroundScheduleResult {
  ok: boolean;
  reason?: string;
}

export interface BmBackgroundRecoverResult {
  ok: boolean;
  /** 已到期仍未完成、需要 JS 补处理的任务列表 */
  dueTasks: BmBackgroundTask[];
}

export interface BmBackgroundPlugin {
  /** JS 启动/回前台时调用，把到期未完成任务推回 JS（recoverDue 同此） */
  recoverDue(): Promise<BmBackgroundRecoverResult>;
  /** 排一个到期任务（写原生任务表 + 排 AlarmManager 精确闹钟） */
  schedule(task: BmBackgroundTask): Promise<BmBackgroundScheduleResult>;
  /** 取消任务（清任务表 + 撤闹钟） */
  cancel(options: { taskId: string }): Promise<BmBackgroundScheduleResult>;
  /** 消息已成功落库后调用，标记任务完成并撤闹钟 */
  confirm(options: { taskId: string }): Promise<BmBackgroundScheduleResult>;
}
