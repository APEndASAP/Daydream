import type { PluginListenerHandle } from '@capacitor/core';
export interface CamResult {
    ok: boolean;
    reason?: string;
}
export interface CaptureResult extends CamResult {
    dataUrl?: string;
}
export interface LensInfo {
    lensIds: string[];
    factors: number[];
    index: number;
}
export interface BmCameraPlugin {
    checkPermission(): Promise<{
        granted: boolean;
    }>;
    requestPermission(): Promise<{
        granted: boolean;
    }>;
    open(options: {
        facing?: string;
        factor?: number;
        left?: number;
        top?: number;
        width?: number;
        height?: number;
    }): Promise<CamResult>;
    switchFacing(): Promise<{
        facing: string;
    } & CamResult>;
    setLens(options: {
        factor: number;
    }): Promise<CamResult>;
    zoomTo(options: {
        factor: number;
    }): Promise<CamResult>;
    focusAt(options: {
        x: number;
        y: number;
    }): Promise<CamResult>;
    capture(): Promise<CaptureResult>;
    close(): Promise<CamResult>;
}
