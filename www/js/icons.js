/* ============================================================
   《白日梦》- 图标库
   风格：细线条 · 圆角端点 · 统一 24x24 视窗 · currentColor 继承
   替代原 emoji 图标，配合淡紫微光主题
   ============================================================ */

const ICONS = {
  /* —— 导航 —— */
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  moments: '<rect x="2" y="6" width="20" height="15" rx="4"/><circle cx="12" cy="13.5" r="4"/><path d="M8 6l1.2-2.4A1 1 0 0 1 10.1 3h3.8a1 1 0 0 1 .9.6L16 6"/><circle cx="18.5" cy="9.5" r="0.6" fill="currentColor" stroke="none"/>',

  /* —— 通用 —— */
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  dots: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',

  /* —— 聊天输入栏 / 拓展面板 —— */
  image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  emoji: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01" stroke-width="2.4"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7c0 2.6-5 1.6-5 4.4 0 1 1.1 1.7 2.5 1.7s2.5-.7 2.5-1.7"/>',
  redpacket: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M4 7l8 5 8-5"/><circle cx="12" cy="14.5" r="2.2"/>',
  checkin: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5" stroke-dasharray="3 3"/>',
  divination: '<circle cx="12" cy="10" r="6.5"/><path d="M9 20h6M10 16.8h4"/><path d="M12 7.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z" stroke-width="1.2"/>',
  note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  letter: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 8l10 6L22 8"/>',
  sticker: '<path d="M14 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h6l8-8V9"/><path d="M13 21v-4a2 2 0 0 1 2-2h4"/><path d="M8.5 10h.01M13.5 10h.01" stroke-width="2.4"/><path d="M9 13.5s1 1.2 2.5 1.2 2.5-1.2 2.5-1.2"/>',

  /* —— 功能宫格 —— */
  memory: '<path d="M4 21V9l8-6 8 6v12"/><path d="M2 21h20"/><path d="M9 21v-6h6v6"/><path d="M12 2.5V4"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
  tree: '<path d="M12 22v-8"/><path d="M12 13.5c-.2-1.8-1.1-3.1-2.6-4"/><path d="M12 10c.2-1.5 1-2.7 2.3-3.6"/><path d="M12 14c-3.9 0-7-2.3-7-5.7 0-2.9 1.9-4.8 4.4-4.9 1-1.6 4.2-1.6 5.2 0C17.1 3.5 19 5.4 19 8.3c0 3.4-3.1 5.7-7 5.7z"/>',
  relation: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M8 7.5l2.5 2.5M16 7.5L13.5 10M8 16.5L10.5 14M16 16.5L13.5 14"/>',
  cards: '<rect x="7" y="3" width="13" height="15" rx="2.5"/><path d="M4 7v11a3 3 0 0 0 3 3h9"/><path d="M11 8h5M11 12h5"/>',
  chatset: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M8 10h8M8 14h5"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  data: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/><path d="M4 11.5v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
  ai: '<rect x="4" y="6" width="16" height="12" rx="3"/><path d="M8 6v12M16 6v12"/><circle cx="12" cy="12" r="2"/><path d="M7.5 9h1M7.5 12h1M7.5 15h1M15.5 9h1M15.5 12h1M15.5 15h1" stroke-width="1.6"/>',
  ban: '<circle cx="12" cy="12" r="8.4"/><path d="M6.2 6.2l11.6 11.6"/>',
  aitoggle: '<rect x="2.5" y="7.2" width="19" height="9.6" rx="4.8"/><circle class="ai-knob" cx="7.3" cy="12" r="3" fill="currentColor" stroke="none"/>',
  regen: '<path d="M20.5 11.5a8.5 8.5 0 1 0-2.6 6.1"/><path d="M20.5 4.5v7h-7"/>',
  eye: '<path d="M2.5 12s3.4-6.3 9.5-6.3S21.5 12 21.5 12s-3.4 6.3-9.5 6.3S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/>',
  eyeoff: '<path d="M2.5 12s3.4-6.3 9.5-6.3S21.5 12 21.5 12s-3.4 6.3-9.5 6.3S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/><path d="M4.5 4.5l15 15" stroke-width="1.8"/>',
  expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7.5 7.5"/><path d="M3 21l7.5-7.5"/>',
  wallet: '<rect x="2.5" y="6" width="19" height="14" rx="3.5"/><path d="M2.5 10h19"/><path d="M16 15h2.5"/><path d="M6 6V5a2 2 0 0 1 2-2h9"/>',
  daily: '<rect x="3" y="4.5" width="18" height="17" rx="3.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/><path d="M12 14.5l.8 1.6 1.8.3-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.3z" stroke-width="1.1"/>',
  anniversary: '<rect x="3" y="8" width="18" height="13" rx="3"/><path d="M3 12h18M12 8v13"/><path d="M12 8c-2-2.5-5.5-2.6-5.5 0M12 8c2-2.5 5.5-2.6 5.5 0" stroke-width="1.4"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="9.5" r="1" fill="currentColor" stroke="none"/><path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.4 1.1-2 2.5-2s2-.6 2-1.5 1-1.5 2.5-1.5"/>',
  quote: '<path d="M9 6C6.5 7 5 9 5 12v6h5v-6H7.5C7.5 9.5 8 8 10 7z"/><path d="M18 6c-2.5 1-4 3-4 6v6h5v-6h-2.5c0-2.5.5-4 2.5-5z"/>',
  forward: '<path d="M14 5l7 7-7 7"/><path d="M21 12H9a6 6 0 0 0-6 6v1"/>',
  checklist: '<path d="M4 5.5l1.6 1.6L8.5 4.2"/><path d="M12 6.5h8"/><path d="M4 13.5l1.6 1.6 2.9-2.9"/><path d="M12 14.5h8"/>',
  poke: '<path d="M12 2.5v8"/><path d="M8.5 7L12 10.5 15.5 7"/><circle cx="12" cy="17" r="4"/>',
  topic: '<rect x="3.5" y="4.5" width="17" height="12.5" rx="3.4"/><path d="M8.5 17L6 20v-3"/><path d="M8.2 9h7.6M8.2 12h4.6"/>',
  vote: '<path d="M4 20.5h16"/><rect x="5" y="10.5" width="3.6" height="7" rx="1.2"/><rect x="10.2" y="5.5" width="3.6" height="12" rx="1.2"/><rect x="15.4" y="12.5" width="3.6" height="5" rx="1.2"/>',
  camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H7l1.4-2h7.2L17 6h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  call: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',

  /* —— 朋友圈 —— */
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  comment: '<path d="M21 12a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.4-5.7A8.5 8.5 0 1 1 21 12z"/>',
  share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.4 10.9l7.2-4.4M8.4 13.1l7.2 4.4"/>',
  gift: '<rect x="4" y="9" width="16" height="12" rx="2"/><path d="M12 9v12M3 9h18V6.5a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 0 3 6.5z"/><path d="M12 9c-1-4.3-6.2-6.4-7.5-3.5C3.3 8.2 7.4 9 12 9zM12 9c1-4.3 6.2-6.4 7.5-3.5C20.7 8.2 16.6 9 12 9z"/>',
  archive: '<path d="M4 4h16v4H4zM5 8v12h14V8M9 12h6M9 16h6"/>',
  overclock: '<path d="M3 12c2.2-5.5 4.4-5.5 6.6 0s4.4 5.5 6.6 0 3.7-5.5 5.8 0"/><path d="M5 17c1.7-3.1 3.5-3.1 5.2 0s3.5 3.1 5.2 0 2.7-3.1 3.9 0"/><path d="M12 2v3M12 19v3"/><circle cx="12" cy="12" r="2.2"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" stroke-width="1.4"/>',

  /* —— 记忆宫殿 / 世界树（20260929bc：替代 emoji，与本软件线性图标一脉相承） —— */
  folder: '<path d="M3 8.2A2.7 2.7 0 0 1 5.7 5.5h3c.75 0 1.46.31 1.96.86l.96 1.06h6.68A2.7 2.7 0 0 1 21 10.1v7.2a2.7 2.7 0 0 1-2.7 2.7H5.7A2.7 2.7 0 0 1 3 17.3z"/>',
  draft: '<rect x="5" y="4" width="14" height="16.5" rx="2.4"/><path d="M9 4V2.8M12 4V2.8M15 4V2.8"/><path d="M8.6 10h6.8M8.6 13.4h6.8M8.6 16.8h3.4"/>',
  doc: '<path d="M6.5 3.5H14l4.5 4.5v12.5h-12z"/><path d="M14 3.5V8h4.5"/><path d="M9.5 12.5h5M9.5 16h5"/>',
  shield: '<path d="M12 3l7.2 2.7v5.5c0 4.7-3 8-7.2 9.8-4.2-1.8-7.2-5.1-7.2-9.8V5.7z"/><path d="M9.2 11.8l2 2 3.6-3.9"/>',
  user: '<circle cx="12" cy="7.8" r="3.4"/><path d="M5.2 20c.8-3.6 3.5-5.4 6.8-5.4s6 1.8 6.8 5.4"/>',
  lock: '<rect x="5.5" y="10.6" width="13" height="9.4" rx="2.6"/><path d="M8.5 10.6V7.9a3.5 3.5 0 0 1 7 0v2.7"/><circle cx="12" cy="15.2" r="1.25" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M20.4 20.4L15.8 15.8"/>',
  listview: '<path d="M9 6.2h11M9 12h11M9 17.8h11"/><circle cx="4.4" cy="6.2" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.4" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.4" cy="17.8" r="1.15" fill="currentColor" stroke="none"/>',
  upload: '<path d="M12 14.5V4"/><path d="M7.6 8.4L12 4l4.4 4.4"/><path d="M4.5 15.5v2.7a2.3 2.3 0 0 0 2.3 2.3h10.4a2.3 2.3 0 0 0 2.3-2.3v-2.7"/>',
  orb: '<circle cx="12" cy="12" r="6.6"/><path d="M8.4 19.2c.5-1.7 1.9-2.7 3.6-2.7s3.1 1 3.6 2.7"/><path d="M5.5 21.2h13"/><path d="M9.7 9.6a3.1 3.1 0 0 1 2.3-1.4"/>',
  chevleft: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  chevright: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',

  /* —— 权重记忆（20261002ch）：五角星描边，正常线条不发光，点亮后由 CSS 上色发光 —— */
  star: '<path d="M12 3.3l2.5 5.1 5.6.8-4 3.9.9 5.5L12 16.2l-5 2.4.9-5.5-4-3.9 5.6-.8z"/>',

  /* —— 记事簿（20261028）：潮汐 / 闹钟（替代 emoji，线性一脉相承） —— */
  tide: '<path d="M3 9c2-2.5 3.4-2.5 5 0s3 2.5 5 0 3.4-2.5 5 0 3 2.5 5 0"/><path d="M3 15c2-2.5 3.4-2.5 5 0s3 2.5 5 0 3.4-2.5 5 0 3 2.5 5 0"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
  /* —— 复制（20261029）：消息菜单「复制」项 —— */
  copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H15"/>',

  /* —— 音乐播放器（20261103）：播放/暂停/上一首/下一首/耳机/星球/音乐库 —— */
  play: '<path d="M7 4.5l13 7.5-13 7.5z"/>',
  pause: '<path d="M7 4.5h3.4v15H7zM13.6 4.5H17v15h-3.4z"/>',
  prev: '<path d="M6 5.5v13"/><path d="M19 5.5L9 12l10 6.5z"/>',
  next: '<path d="M18 5.5v13"/><path d="M5 5.5l10 6.5L5 18.5z"/>',
  headphone: '<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="2"/><rect x="17" y="13" width="4" height="6" rx="2"/>',
  planet: '<circle cx="12" cy="12" r="4.2"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><circle cx="12" cy="12" r="9" stroke-dasharray="2.4 3"/>',
  musiclib: '<path d="M9 18.5V6.5l10-1.6v11.6"/><circle cx="6.5" cy="18.5" r="2.6"/><circle cx="16.5" cy="16.5" r="2.6"/>',
  volume: '<path d="M11 5.5L6.5 9H3v6h3.5l4.5 3.5"/><path d="M11 9v6"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M11 5.5L6.5 9H3v6h3.5l4.5 3.5z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  float: '<rect x="5" y="4" width="14" height="16" rx="3"/><rect x="9" y="8" width="6" height="4" rx="1.2"/><path d="M9 16h6"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10l5-2.5v9L16 14z"/>',
  shuffle: '<path d="M2.5 7h3.2c2.2 0 3.2 1.4 4.8 5s2.6 5 4.8 5h1.2"/><path d="M2.5 17h3.2c1 0 1.7-.3 2.4-.9l3-2.4"/><path d="M16.5 5.5L21 7l-1.5 4.5"/><path d="M16.5 15L21 17l-1.5 4.5"/>',
  repeat: '<path d="M17 2.5l3 3-3 3"/><path d="M20 5.5H8a4 4 0 0 0-4 4v1"/><path d="M7 21.5l-3-3 3-3"/><path d="M4 18.5h12a4 4 0 0 0 4-4v-1"/>',
  order: '<path d="M4.5 12h13"/><path d="M14 6.5l3.5 5.5L14 17.5"/><path d="M4.5 6.5h0"/><path d="M4.5 17.5h0"/>',
  'repeat-one': '<path d="M17 2.5l3 3-3 3"/><path d="M20 5.5H8a4 4 0 0 0-4 4v1"/><path d="M7 21.5l-3-3 3-3"/><path d="M4 18.5h12a4 4 0 0 0 4-4v-1"/><path d="M11.5 10.5v3"/>',
  list: '<path d="M8.5 6.2h12M8.5 12h12M8.5 17.8h12"/><circle cx="4.2" cy="6.2" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.2" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.2" cy="17.8" r="1.15" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 3.5v11"/><path d="M7.6 10.5L12 15l4.4-4.5"/><path d="M4.5 15.5v2.7a2.3 2.3 0 0 0 2.3 2.3h10.4a2.3 2.3 0 0 0 2.3-2.3v-2.7"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 13V8.5"/><path d="M9.5 2.5h5"/><path d="M12 5.5v-1"/>',
  /* 刷新/重抓（20261110）：单圈回旋箭头，24 视窗 · 1.8 线宽 · 圆角端点，
     与 play/next/share 同一套线性语言，绝不用 emoji。
     弧线终点 (17.66,6.34) 正好是右上角折线箭头的拐点，视觉上连成一支回旋箭头。 */
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M17.66 2.9v3.44h-3.44"/>',

  /* —— 陪伴 / 四季（20261108）：陪伴一级入口 + 番茄钟/四季两个功能块 —— */
  companion: '<circle cx="9" cy="8.5" r="3.2"/><circle cx="16.5" cy="10" r="2.4"/><path d="M3.5 20c.7-3.6 2.9-5.4 5.5-5.4 1.2 0 2.3.3 3.3.9"/><path d="M14.5 13.8c1.5.7 2.5 1.8 3 3.4.3 1 .6 1.9.8 2.8"/><path d="M8 14.2c.9.3 1.8.9 2.4 1.8"/>',
  season: '<path d="M12 4.5v3"/><path d="M12 7.5a4.5 4.5 0 0 1 4.5 4.5c0 1.6-.8 3-2 3.9.6.9.9 2 .9 3.1a4.5 4.5 0 0 1-9 0c0-1.1.3-2.2.9-3.1-1.2-.9-2-2.3-2-3.9A4.5 4.5 0 0 1 12 7.5z"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><path d="M5.5 3.5l1.2 1.2M18.5 3.5l-1.2 1.2"/>',

  /* —— 全站统一收口（20261111）：此前散落在 app.js / music.js 里的彩色 emoji，
     全部换成这一套 24 视窗 · 1.8 线宽 · currentColor 的线性图标。
     命名与语义一一对应，不再出现「同一个按钮两套视觉」。 —— */
  pin: '<path d="M9 3.2h6M12 3.2v5.6"/><path d="M6.4 8.8h11.2l-1.5 3.3a3 3 0 0 1-2.7 1.7h-2.8a3 3 0 0 1-2.7-1.7z"/><path d="M12 13.8V21"/>',
  location: '<path d="M12 21.2s6.4-5.7 6.4-10.4a6.4 6.4 0 1 0-12.8 0C5.6 15.5 12 21.2 12 21.2z"/><circle cx="12" cy="10.6" r="2.3"/>',
  group: '<circle cx="9.2" cy="8.4" r="3.3"/><path d="M3.4 20c.7-3.6 3-5.5 5.8-5.5s5.1 1.9 5.8 5.5"/><path d="M16.2 5.5a3 3 0 0 1 0 5.9"/><path d="M17.4 14.7c1.9.6 3.2 2.4 3.6 5.3"/>',
  flower: '<circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="7.2" r="2.6"/><circle cx="16.6" cy="10.5" r="2.6"/><circle cx="14.8" cy="16" r="2.6"/><circle cx="9.2" cy="16" r="2.6"/><circle cx="7.4" cy="10.5" r="2.6"/>',
  candle: '<path d="M12 3.4c1.6 1.9 2.4 3.3 2.4 4.6a2.4 2.4 0 1 1-4.8 0c0-1.3.8-2.7 2.4-4.6z"/><rect x="8.6" y="11.2" width="6.8" height="9.2" rx="1.8"/><path d="M6 20.4h12"/>',
  moon: '<path d="M20.2 14.4A8.4 8.4 0 0 1 9.6 3.8a8.4 8.4 0 1 0 10.6 10.6z"/>',
  crown: '<path d="M3.6 7.6l4.2 3.2L12 4.6l4.2 6.2 4.2-3.2-1.9 10.4H5.5z"/><path d="M5.5 20.6h13"/>',
  package: '<path d="M12 3l8.8 4.4v9.2L12 21l-8.8-4.4V7.4z"/><path d="M3.2 7.4L12 11.8l8.8-4.4"/><path d="M12 11.8V21"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.2 1.9"/>',
  alert: '<path d="M12 4.4l8.2 14.3a1 1 0 0 1-.9 1.5H4.7a1 1 0 0 1-.9-1.5z"/><path d="M12 9.8v4"/><circle cx="12" cy="16.6" r="0.95" fill="currentColor" stroke="none"/>',
  party: '<path d="M3.6 20.4L9.2 7.4l7.4 7.4z"/><path d="M16.6 3.4l.6 2.2 2.2.6-2.2.6-.6 2.2-.6-2.2-2.2-.6 2.2-.6z"/><path d="M14.4 11.4l.5 1.6 1.6.5-1.6.5-.5 1.6-.5-1.6-1.6-.5 1.6-.5z" stroke-width="1.3"/>',
  mic: '<rect x="9.2" y="2.8" width="5.6" height="10.4" rx="2.8"/><path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0"/><path d="M12 17.8V21M9.2 21h5.6"/>',
  inbox: '<path d="M3.6 12.6L6.2 5h11.6l2.6 7.6"/><path d="M3.6 12.6h4l1.2 2.4h6.4l1.2-2.4h4v5.2a2.4 2.4 0 0 1-2.4 2.4H6a2.4 2.4 0 0 1-2.4-2.4z"/>',
  key: '<circle cx="8" cy="12" r="3.4"/><path d="M11.4 12H20.6"/><path d="M17.6 12v3M20.2 12v2.4"/>',
  dice: '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4"/><circle cx="8.6" cy="8.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.6" cy="15.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.2" fill="currentColor" stroke="none"/>',
  compass: '<circle cx="12" cy="12" r="8.6"/><path d="M15.4 8.6l-2 4.8-4.8 2 2-4.8z"/>',
  radio: '<rect x="2.6" y="8.4" width="18.8" height="11.6" rx="2.4"/><path d="M6.4 8.4l9.4-4.2"/><circle cx="16.2" cy="14.2" r="2.6"/><path d="M6 12.4h4.4M6 16.4h4.4"/>',
  link: '<path d="M10.6 13.4a4 4 0 0 0 5.66 0l2.3-2.3a4 4 0 0 0-5.66-5.66L11.6 6.7"/><path d="M13.4 10.6a4 4 0 0 0-5.66 0l-2.3 2.3a4 4 0 0 0 5.66 5.66l1.3-1.3"/>',
  sliders: '<path d="M5 4v5.6M5 14.4V20M12 4v2.6M12 11v9M19 4v8.6M19 18v2"/><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="8.8" r="2.2"/><circle cx="19" cy="15.8" r="2.2"/>',
  cloud: '<path d="M7.4 19h9.2a3.7 3.7 0 0 0 .3-7.4 5.4 5.4 0 0 0-10.3-1.2A4.3 4.3 0 0 0 7.4 19z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/>',
  chart: '<path d="M4 3.6V20h16"/><path d="M8 16.6v-4.2M12.6 16.6V8.4M17.2 16.6v-6"/>',
  broom: '<path d="M19.6 4.4l-6.2 6.2"/><path d="M13.4 10.6l-2.8-2.8"/><path d="M10.6 13.4L6 18l2.8 2.8 4.6-4.6z"/><path d="M6 18l-2.4 4 4-2.4"/>',
  sprout: '<path d="M12 21v-8"/><path d="M12 13c0-3.4-2.5-6.1-5.8-6.1C6.2 10.2 8.6 13 12 13z"/><path d="M12 13c0-2.9 2.1-5.2 4.9-5.2 0 2.9-2.1 5.2-4.9 5.2z"/>',
  megaphone: '<path d="M3.4 10.4v3.2l4 1 9 4V5.4l-9 4z"/><path d="M7.4 14.6v4a1.6 1.6 0 0 0 3.2 0v-2.6"/><path d="M19.6 9.6a3 3 0 0 1 0 5"/>',
  scale: '<path d="M12 3.4V20.6"/><path d="M7.4 20.6h9.2"/><path d="M4.4 7h15.2"/><path d="M4.4 7L2 13h4.8z"/><path d="M19.6 7L17.2 13H22z"/>',
  door: '<path d="M5.4 21V4.2A1.2 1.2 0 0 1 6.6 3h10.8a1.2 1.2 0 0 1 1.2 1.2V21"/><path d="M3.4 21h17.2"/><circle cx="14.8" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2"/><path d="M12 3.4c2.2 2.4 3.4 5.4 3.4 8.6s-1.2 6.2-3.4 8.6c-2.2-2.4-3.4-5.4-3.4-8.6s1.2-6.2 3.4-8.6z"/>',
  help: '<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.5v.4"/><circle cx="12" cy="17" r="0.95" fill="currentColor" stroke="none"/>',
  bulb: '<path d="M9.4 17.4a5.6 5.6 0 1 1 5.2 0"/><path d="M9.2 20.6h5.6"/><path d="M10.4 17.4h3.2"/>',
};

/* 取图标 SVG（内联，自动继承颜色） */
function icon(name, size = 22) {
  const body = ICONS[name] || ICONS.dots;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* 自动填充 HTML 中所有 [data-icon] 占位 */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]:not([data-icon-done])').forEach(el => {
    el.innerHTML = icon(el.dataset.icon, parseInt(el.dataset.size || '22'));
    el.dataset.iconDone = '1';
  });
}

/* ============================================================
   20261111：图标占位符「随插随填」
   ------------------------------------------------------------
   为什么需要它：app.js / music.js 里大量界面是拼 HTML 字符串再 innerHTML 的，
   而且同一个文件里既有模板字符串（可插值）也有单引号字符串（不能插值）。
   若统一改成 ${icon(...)}，单引号那部分会静默失效、把代码原样印到界面上。
   所以统一改用 <i data-icon="close" data-size="16"></i> 这种纯标记占位，
   再在这里挂一个 MutationObserver 自动补 SVG —— 无论字符串用哪种引号、
   无论插到哪个容器，只要进了 DOM 就会被填上。

   性能：只观察 childList，回调里把新增节点攒到下一帧统一处理；
   每个新增子树只查一次 [data-icon]:not([data-icon-done])，已填过的不会重复处理。
   ============================================================ */
(function initIconAutoHydrate() {
  if (typeof document === 'undefined' || !document.body) return;
  if (window.__bmIconHydrateReady) return;
  window.__bmIconHydrateReady = true;

  // 占位符的对齐与尺寸（内联注入，避免依赖外部 CSS 的加载顺序）
  try {
    const st = document.createElement('style');
    st.id = 'bm-icon-placeholder-style';
    st.textContent = '[data-icon]{display:inline-flex;align-items:center;justify-content:center;vertical-align:-0.18em;line-height:1;flex:0 0 auto}[data-icon]>svg{display:block}';
    document.head.appendChild(st);
  } catch (e) {}

  let queue = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const nodes = queue;
    queue = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n.isConnected) continue;
      try {
        if (n.nodeType === 1 && n.matches && n.matches('[data-icon]:not([data-icon-done])')) {
          // 新增节点本身就是占位符：直接填，不必回扫整个父级
          n.innerHTML = icon(n.dataset.icon, parseInt(n.dataset.size || '22'));
          n.dataset.iconDone = '1';
        } else if (n.querySelectorAll) {
          hydrateIcons(n);
        }
      } catch (e) {}
    }
  };
  const mo = new MutationObserver(muts => {
    for (let i = 0; i < muts.length; i++) {
      const added = muts[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const n = added[j];
        if (n.nodeType === 1) queue.push(n);
      }
    }
    if (!queue.length || scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  });
  try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  hydrateIcons(document);
})();
