// bm-camera 纯原生插件：web 端无实现，前端通过 window.Capacitor.Plugins.BmCamera 直连原生。
// 此文件仅为满足 Capacitor 插件识别所需的 main 入口（CommonJS 空导出）。
'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.BmCamera = {
  checkPermission: function () { return Promise.resolve({ granted: false }); },
  requestPermission: function () { return Promise.resolve({ granted: false }); },
  open: function () { return Promise.resolve({ ok: false, reason: 'web_not_supported' }); },
  switchFacing: function () { return Promise.resolve({ ok: false, facing: 'back', reason: 'web_not_supported' }); },
  setLens: function () { return Promise.resolve({ ok: false, reason: 'web_not_supported' }); },
  zoomTo: function () { return Promise.resolve({ ok: false, reason: 'web_not_supported' }); },
  focusAt: function () { return Promise.resolve({ ok: false, reason: 'web_not_supported' }); },
  capture: function () { return Promise.resolve({ ok: false, reason: 'web_not_supported' }); },
  close: function () { return Promise.resolve({ ok: true }); },
};
