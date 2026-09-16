## Why

每次打开 App 出现近 1 分钟白屏。根因是 `index.html` 用同步 `<script>` 从 CDN 加载 1.2MB 的 Transformers.js，阻塞其后所有脚本（含 `app.js`）的加载与执行，导致 `boot()`/`init()` 无法开始。移动 WebView 的 HTTP 缓存不可靠，非首次启动仍可能从网络重新下载。此外 `db.js` 每次启动都执行 48 条 DDL（虽 `IF NOT EXISTS`，仍走原生桥接往返），启动期全量读取图片 dataUrl 也加剧老用户白屏。

用户原则：能随包发布的随包发布，能本地缓存的用本地，初次安装可接受短暂白屏，之后不可接受。

## What Changes

- **Transformers.js 本地化 + 按需加载**：将 `@xenova/transformers` 的 `dist/transformers.min.js` 及 onnxruntime-web `.wasm` 文件复制到 `frontend/vendor/` 随包发布；删除 `index.html` 中的同步 CDN `<script>` 标签；`rag-embed.js` 的 `_loadModel()` 改为按需动态注入本地 `vendor/transformers.min.js`。首屏完全不加载该库，仅用户发起 AI 聊天时才加载。
- **DDL 只在首次/版本升级时执行**：将 `db.js` 中 `execute(DDL)` / `execute(INDEX_DDL)` 移入 `if (curVersion < APP_SCHEMA_VERSION)` 分支，非首次启动跳过 48 条 `CREATE TABLE IF NOT EXISTS`。
- **启动期不读图片 dataUrl**：`app.js` 的 `init()` 中 `getRecords/getOrders/getReports` 改用 `withDataUrls=false`，仅加载元数据；详情页打开时再按需 `getRecord(id)` 读图。
- **runDailyDecrement 复用 DATA**：去掉 `runDailyDecrement` 内重复的 `NurseStorage.load()`，直接复用已加载的 `DATA`。
- **Splash Screen 遮盖初始化期**：安装 `@capacitor/splash-screen` 插件，配置 `launchAutoHide: false`，`init()` 末尾手动 `SplashScreen.hide()`，用闪屏遮盖初始化期消除主观白屏。

## Capabilities

### New Capabilities
- `startup-loading`: 启动时资源加载策略——按需加载重资源、DDL 仅首次执行、splash 遮盖初始化期

### Modified Capabilities
- `rag-knowledge-base`: Transformers.js 加载方式从同步 CDN `<script>` 改为按需动态注入本地 `vendor/` 资源

## Impact

- `frontend/index.html`：删除 Transformers.js CDN `<script>` 标签
- `frontend/rag-embed.js`：`_loadModel()` 增加本地 Transformers.js 动态注入逻辑
- `frontend/vendor/`：新增 `transformers.min.js` + onnxruntime-web `.wasm` 文件（随包发布）
- `frontend/db.js`：DDL/INDEX 执行移入版本判断分支
- `frontend/app.js`：`init()` 图片读取改 `withDataUrls=false`；`runDailyDecrement` 复用 `DATA`；末尾 `SplashScreen.hide()`
- `frontend/storage.js`：`getRecords/getOrders/getReports` 默认 `withDataUrls` 改为 `false`（或调用方传参）
- `capacitor.config.js`：新增 SplashScreen 插件配置
- `package.json`：新增 `@capacitor/splash-screen` 依赖
- 构建流程：需将 `node_modules/@xenova/transformers/dist/` 复制到 `frontend/vendor/` 的脚本
