export interface CheckResult { granted: boolean; }
export interface ShowResult { ok: boolean; reason?: string; }
export interface BmOverlayPlugin {
  checkPermission(): Promise<CheckResult>;
  requestPermission(): Promise<CheckResult & { openedSettings?: boolean; error?: string }>;
  show(options: { name: string; sub?: string }): Promise<ShowResult>;
  updateSub(options: { sub: string }): Promise<ShowResult>;
  hide(): Promise<ShowResult>;
}
