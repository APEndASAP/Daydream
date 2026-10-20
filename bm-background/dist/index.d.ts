export interface BmBackgroundTask {
    taskId: string;
    charId: string;
    dueAt: number;
    name?: string;
    kind?: string;
}
export interface BmBackgroundScheduleResult {
    ok: boolean;
    reason?: string;
}
export interface BmBackgroundRecoverResult {
    ok: boolean;
    dueTasks: BmBackgroundTask[];
}
export interface BmBackgroundPlugin {
    recoverDue(): Promise<BmBackgroundRecoverResult>;
    schedule(task: BmBackgroundTask): Promise<BmBackgroundScheduleResult>;
    cancel(options: { taskId: string }): Promise<BmBackgroundScheduleResult>;
    confirm(options: { taskId: string }): Promise<BmBackgroundScheduleResult>;
}
