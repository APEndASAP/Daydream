# bm-music-float

白日梦「一起听歌」原生悬浮窗插件（独立插件，与 `bm-overlay` 模拟通话悬浮窗互不共用）。

把软件内的一起听歌三级悬浮窗（dot → mini → card）浮到系统层（其他应用之上），
完整复刻软件内的布局、功能、图标、控制键：

- 三形态切换：dot（圆点）→ mini（小卡）→ card（大卡），点击展开、减号收起
- 完整控制键：播放/暂停、上一首、下一首、播放模式、播放列表
- 进度条拖动 seek、封面、歌名/艺术家、歌词、一起听时长
- 右下角拖拽缩放、整窗拖动、双击回应用

图标：原生层用 `Path` 直接绘制与 `icons.js` 完全相同的 SVG path（24x24 视窗、
stroke-width 1.8、圆角端点），绝不用 emoji 替换。

## 状态同步

JS 端（music.js）在切歌/播放/暂停/进度变化时调用 `update()` 推送歌曲状态；
原生层负责显示 + 按钮回传事件（onToggle/onPrev/onNext/onSeek/onMode/onList/onEnd/onEnterApp/onCollapse）。

## 权限

`SYSTEM_ALERT_WINDOW`（悬浮窗），无权限时 `requestPermission()` 跳系统设置页。
