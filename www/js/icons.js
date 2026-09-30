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
};

/* 取图标 SVG（内联，自动继承颜色） */
function icon(name, size = 22) {
  const body = ICONS[name] || ICONS.dots;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* 自动填充 HTML 中所有 [data-icon] 占位 */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (el.dataset.iconDone) return;
    el.innerHTML = icon(el.dataset.icon, parseInt(el.dataset.size || '22'));
    el.dataset.iconDone = '1';
  });
}
