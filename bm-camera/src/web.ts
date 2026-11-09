import { WebPlugin } from '@capacitor/core';
import type { BmCameraPlugin, CamResult, CaptureResult, LensInfo } from './definitions';

/**
 * 网页端实现：无原生 CameraX 能力，全部静默返回降级结果。
 * 前端据此回退到 getUserMedia 网页相机。
 */
export class BmCameraWeb extends WebPlugin implements BmCameraPlugin {
  async checkPermission(): Promise<{ granted: boolean }> {
    return { granted: false };
  }
  async requestPermission(): Promise<{ granted: boolean }> {
    return { granted: false };
  }
  async open(_o: any): Promise<CamResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async switchFacing(): Promise<{ facing: string } & CamResult> {
    return { ok: false, facing: 'back', reason: 'web_not_supported' };
  }
  async setLens(_o: { factor: number }): Promise<CamResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async zoomTo(_o: { factor: number }): Promise<CamResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async focusAt(_o: { x: number; y: number }): Promise<CamResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async capture(): Promise<CaptureResult> {
    return { ok: false, reason: 'web_not_supported' };
  }
  async close(): Promise<CamResult> {
    return { ok: true };
  }
}
