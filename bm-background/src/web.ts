import { WebPlugin } from '@capacitor/core';
import type { BmBackgroundPlugin, BmBackgroundScheduleResult, BmBackgroundRecoverResult, BmBackgroundTask } from './definitions';

export class BmBackgroundWeb extends WebPlugin implements BmBackgroundPlugin {
  async recoverDue(): Promise<BmBackgroundRecoverResult> {
    return { ok: true, dueTasks: [] };
  }
  async schedule(_task: BmBackgroundTask): Promise<BmBackgroundScheduleResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async cancel(_options: { taskId: string }): Promise<BmBackgroundScheduleResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async confirm(_options: { taskId: string }): Promise<BmBackgroundScheduleResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
}
