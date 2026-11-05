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
export interface BmHttpResult {
    ok: boolean;
    status?: number;
    body?: string;
    reason?: string;
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
    httpRequest(options: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
    }): Promise<BmHttpResult>;
    neteaseRequest(options: {
        url: string;
        method?: string;
        cookie?: string;
    }): Promise<BmHttpResult>;
    neteaseCookie(): Promise<{
        ok: boolean;
        cookie?: string;
        loggedIn?: boolean;
    }>;
    neteaseClear(): Promise<BmRemoteResult>;
    neteaseLogin(): Promise<BmRemoteResult>;
}
