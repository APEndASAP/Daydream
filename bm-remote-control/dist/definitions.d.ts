export interface BmRemoteResult {
    ok: boolean;
    reason?: string;
}
export interface BmRemoteMediaState {
    hasSession: boolean;
    title?: string;
    artist?: string;
    album?: string;
    playing?: boolean;
    packageName?: string;
}
export interface BmRemoteControlPlugin {
    hasActiveSession(): Promise<BmRemoteResult & {
        hasSession: boolean;
    }>;
    getMediaState(): Promise<BmRemoteResult & BmRemoteMediaState>;
    toggle(): Promise<BmRemoteResult>;
    play(): Promise<BmRemoteResult>;
    pause(): Promise<BmRemoteResult>;
    next(): Promise<BmRemoteResult>;
    prev(): Promise<BmRemoteResult>;
}
