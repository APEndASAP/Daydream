# 白日梦 · 安卓 APK 云打包指南（小白版）

这个仓库可以把「白日梦」网页应用自动打包成安卓 APK——**全程在你电脑上不用装任何东西**（不用装 Java、不用装 Android Studio），只要在 GitHub 网页上点几下，云端机器会自动帮你下载环境、构建、生成 APK。

---

## 一、第一次使用：把代码传到 GitHub

如果你还没有把这个文件夹传到 GitHub，按下面做一次（以后就不用再做了）：

1. 打开 https://github.com/APEndASAP/Daydream （你的仓库）
2. 点页面上的 **「Add file」** 按钮 → 选 **「Upload files」**
3. 把本文件夹（`deploy` 目录）里的这些文件**全部拖进去**：
   - `.github/` 文件夹（里面有打包脚本）
   - `www/` 文件夹（你的整个应用）
   - `assets/` 文件夹（应用图标）
   - `capacitor.config.json`
   - `package.json`
   - `.gitignore`
4. 拉到页面底部，绿色按钮 **「Commit changes」** 点一下。

> 以后你想更新应用，重复第 2~4 步，把改过的文件再传一遍就行。

---

## 二、触发打包（点几下就有 APK）

1. 打开 https://github.com/APEndASAP/Daydream
2. 点页面顶部的 **「Actions」** 标签
3. 左边列表点 **「Build Android APK」**
4. 右边会出现一个 **「Run workflow」** 按钮（灰色下拉）→ 点它 → 再点弹出来的绿色 **「Run workflow」** 按钮
5. 页面会出现一个黄色圆圈转动的任务，**等它转完变成绿色对勾**（一般 3~6 分钟）

---

## 三、下载 APK 文件

1. 等上面那个任务变成绿色 ✓ 后，**点进这个任务**（点任务名字那行）
2. 页面往下拉，找到 **「Artifacts」** 区块
3. 点 **「bairimeng-apk」** 下载（会得到一个 `.zip` 文件）
4. 解压这个 zip，里面就是 **`.apk`** 文件
5. 把 apk 传到手机（微信/QQ/网盘都行），在手机上点它安装即可

> ⚠️ 手机安装时会提示「未知来源应用」，需要在手机设置里允许安装未知应用（这是正常的，因为 APK 不是从应用商店下载的）。

> 💡 APK 是 **Debug 签名**（自动带签名，下载即可安装，无需任何配置）。以后想升级：改完文件重新触发打包，下载新 APK 直接覆盖安装，**应用数据不会丢**。

---

## 四、常见问题

- **打包失败（红色 ✗）？** 点进任务，看红色那一步的报错，把截图发给 AI 帮你修。
- **找不到 Actions 标签？** 确认仓库里 `.github/workflows/build-android.yml` 文件已经传上去了。
- **APK 安装后打开是空白/跳走？** 说明「数据源门卫」没放行安卓环境，告诉 AI 即可（当前版本已内置放行）。

---

## 技术说明（给懂的人看）

- **打包方案**：Capacitor 6 离线内嵌——`www/` 全部文件打包进原生安卓 WebView，`capacitor.config.json` 里 `webDir: "www"`，`androidScheme: "https"`。
- **云端流程**（`.github/workflows/build-android.yml`）：
  1. `setup-java` 装 Temurin JDK 17
  2. `setup-android` 装 Android SDK
  3. `npm install` → `cap add android` → `cap sync android`
  4. `capacitor-assets generate` 用 `assets/icon.png` 生成应用图标
  5. **原生禁用 Force Dark**：`styles.xml` 全部主题注入 `android:forceDarkAllowed=false` + `AndroidManifest.xml` `<application>` 同款（系统暗色模式不再反色/变暗网页，与网页 CSS 防反色层双保险）
  6. `gradlew assembleDebug` 构建 **Debug 签名 APK**（可直接安装）
  7. `upload-artifact` 上传 APK 产物
- **应用标识**：`com.bairimeng.app`，应用名「白日梦」。
- **防反色**：网页层 `css/style.css` 顶部物理锁死（`filter:none` + `forced-color-adjust:none`）；原生层 `forceDarkAllowed=false`。双层防护，系统暗色模式无法改动任何颜色。
