// bm-overlay 纯原生插件：web 端无实现，前端通过 window.Capacitor.Plugins.BmOverlay 直连原生。
// 此文件仅为满足 Capacitor 插件识别所需的 main 入口（CommonJS 空导出）。
'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.BmOverlay = {
  checkPermission: function () { return Promise.resolve({ granted: false }); },
  requestPermission: function () { return Promise.resolve({ granted: false }); },
  show: function () { return Promise.resolve({ ok: false, reason: 'web_not_supported' }); },
  updateSub: function () { return Promise.resolve({ ok: false }); },
  hide: function () { return Promise.resolve({ ok: true }); },
};
