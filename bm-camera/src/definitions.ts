import type { PluginListenerHandle } from '@capacitor/core';

export interface CamResult {
  ok: boolean;
  reason?: string;
}

export interface CaptureResult extends CamResult {
  /** 拍照返回的 base64 dataURL（image/jpeg） */
  dataUrl?: string;
}

export interface LensInfo {
  /** 当前镜头 id 列表（按焦距排序，0.5/1/2/3 等） */
  lensIds: string[];
  /** 当前镜头焦距倍数（如 0.5、1、2、3） */
  factors: number[];
  /** 当前选中的镜头索引 */
  index: number;
}

export interface BmCameraPlugin {
  /** 检查相机权限 */
  checkPermission(): Promise<{ granted: boolean }>;
  /** 申请相机权限 */
  requestPermission(): Promise<{ granted: boolean }>;
  /**
   * 打开原生相机预览层。options:
   *  - facing: 'back' | 'front'
   *  - factor: 初始焦距倍数（0.5/1/2/3，实际按设备镜头能力吸附）
   *  - left/top/width/height: 预览区位置（相对屏幕，用于对齐四季 HTML 布局；省略则全屏）
   */
  open(options: { facing?: string; factor?: number; left?: number; top?: number; width?: number; height?: number }): Promise<CamResult>;
  /** 切换前后摄像头 */
  switchFacing(): Promise<{ facing: string } & CamResult>;
  /** 切换镜头（按焦距倍数吸附到最近物理镜头） */
  setLens(options: { factor: number }): Promise<CamResult>;
  /** 平滑变焦到指定倍数（双指捏合用，不吸附物理镜头） */
  zoomTo(options: { factor: number }): Promise<CamResult>;
  /** 点击对焦（归一化坐标 0~1） */
  focusAt(options: { x: number; y: number }): Promise<CamResult>;
  /** 拍照，返回 base64 dataURL */
  capture(): Promise<CaptureResult>;
  /** 关闭相机预览层 */
  close(): Promise<CamResult>;
}
