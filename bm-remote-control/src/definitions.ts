/** 遥控结果 */
export interface BmRemoteResult {
  ok: boolean;
  reason?: string;
}

/** 当前媒体会话状态 */
export interface BmRemoteMediaState {
  /** 是否已获取到活跃媒体会话 */
  hasSession: boolean;
  /** 当前播放的歌曲名 */
  title?: string;
  /** 艺术家 */
  artist?: string;
  /** 专辑 */
  album?: string;
  /** 是否正在播放 */
  playing?: boolean;
  /** 来源 App 包名 */
  packageName?: string;
}

/** 通用原生 HTTP 请求返回 */
export interface BmHttpResult {
  ok: boolean;
  status?: number;
  body?: string;
  reason?: string;
}

export interface BmRemoteControlPlugin {
  /** 检测是否有活跃的外部媒体会话（正在播放音乐的 App） */
  hasActiveSession(): Promise<BmRemoteResult & { hasSession: boolean }>;
  /** 读取当前媒体会话状态（歌曲名/艺术家/是否播放） */
  getMediaState(): Promise<BmRemoteResult & BmRemoteMediaState>;
  /** 播放/暂停（toggle） */
  toggle(): Promise<BmRemoteResult>;
  /** 播放 */
  play(): Promise<BmRemoteResult>;
  /** 暂停 */
  pause(): Promise<BmRemoteResult>;
  /** 下一首 */
  next(): Promise<BmRemoteResult>;
  /** 上一首 */
  prev(): Promise<BmRemoteResult>;
  /** 通用原生 HTTP 请求（绕过 CORS），支持自定义 headers/body */
  httpRequest(options: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<BmHttpResult>;
  /** 原生层带 Cookie 请求网易云官方接口 */
  neteaseRequest(options: { url: string; method?: string; cookie?: string }): Promise<BmHttpResult>;
  /** 读取已保存的网易云 Cookie */
  neteaseCookie(): Promise<{ ok: boolean; cookie?: string; loggedIn?: boolean }>;
  /** 清除已保存的网易云 Cookie */
  neteaseClear(): Promise<BmRemoteResult>;
  /** 打开网易云 H5 登录页拦截 Cookie */
  neteaseLogin(): Promise<BmRemoteResult>;
}
