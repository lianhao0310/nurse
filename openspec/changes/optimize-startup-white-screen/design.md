## Context

当前 App 启动时 `index.html` 按同步顺序加载所有脚本，其中 `@xenova/transformers`（1.2MB）从 CDN 加载，阻塞其后 `app.js` 的加载与执行。`app.js` 的 `init()` 串行执行 DB 初始化（每次跑 48 条 DDL）、全量加载记录（含图片 dataUrl）、重复 load 设置。非首次启动白屏近 1 分钟。

现有代码关键位置：
- `frontend/index.html:607` — Transformers.js 同步 CDN `<script>`
- `frontend/rag-embed.js:29-64` — `_getTransformers()` 从 `window.transformers` 取已加载实例，`_loadModel()` lazy 加载模型
- `frontend/db.js:317-354` — `init()` 中 `execute(DDL)` / `execute(INDEX_DDL)` 在版本判断之外
- `frontend/app.js:94-112` — `init()` 串行 await 链
- `frontend/app.js:97-99` — `getRecords/getOrders/getReports` 默认 `withDataUrls=true`
- `frontend/storage.js:357-361` 等 — `getRecords` 等函数的 `withDataUrls` 参数

## Goals / Non-Goals

**Goals:**
- 非首次启动首屏渲染 < 2s
- Transformers.js 不阻塞首屏，按需加载且从本地读取
- DDL 仅首次/版本升级时执行
- 启动期不读图片 dataUrl
- splash 闪屏遮盖初始化期

**Non-Goals:**
- 不优化 SQLite 查询本身的速度（已有索引，查询不是瓶颈）
- 不改 RAG 向量检索算法
- 不改图片存储方式（仍存 Filesystem 路径）
- 不做代码分割/懒加载整个 app.js（收益小、复杂度高）

## Decisions

### D1: Transformers.js 本地化到 `frontend/vendor/` + 按需动态注入

**方案**：构建时将 `node_modules/@xenova/transformers/dist/transformers.min.js` 复制到 `frontend/vendor/`。同时复制 onnxruntime-web 的 `.wasm` 文件到 `frontend/vendor/`（Transformers.js 运行时需加载这些 wasm）。`rag-embed.js` 的 `_loadModel()` 在调用 `pipeline()` 前先动态注入 `<script src="vendor/transformers.min.js">`。

**wasm 路径配置**：Transformers.js 通过 `env.backends.onnx.wasm.wasmPaths` 配置 wasm 查找路径。在 `_loadModel()` 中设置 `transformers.env.backends.onnx.wasm.wasmPaths = "vendor/"`，确保 wasm 从本地加载。

**替代方案考虑**：
- 仅加 `defer` 属性：不阻塞 `app.js` 但仍下载 1.2MB，浪费带宽且可能被 WebView 缓存策略限制。否决。
- 仅按需加载不从 CDN 改本地：消除网络依赖但需处理 wasm 仍从 CDN 拉的问题。否决，需一并本地化。
- 用 import() ES 模块动态导入：Transformers.js UMD 版本不支持 ES import，需改用 ESM 版本，兼容性风险。否决。

### D2: DDL/INDEX 移入版本判断分支

**方案**：`db.js` 的 `init()` 中，将 `execute(DDL)` / `execute(INDEX_DDL)` 移入 `if (curVersion < APP_SCHEMA_VERSION)` 分支。首次启动 `curVersion=0`，执行 DDL+INDEX+migrations；非首次启动 `curVersion >= APP_SCHEMA_VERSION`，跳过全部 DDL。

**实现**：在 `_runMigrations()` 开头（或 `init()` 中调用 `_runMigrations()` 之前）执行 DDL+INDEX。因 `migrations[1]` 当前为空占位，可将 DDL+INDEX 放入 `migrations[1]`，使逻辑统一。

**替代方案考虑**：
- 用 `CREATE TABLE IF NOT EXISTS` 靠 `IF NOT EXISTS` 跳过：仍需 48 次原生桥接往返，每次 10-20ms。否决。

### D3: 启动期 `withDataUrls=false`

**方案**：`app.js` 的 `init()` 中 `getRecords/getOrders/getReports` 调用传 `withDataUrls=false`（或改这些函数默认值为 `false`）。详情页打开时调 `getRecord(id, true)` / `getOrder(id, true)` / `getReport(id, true)` 按需读图。

**选择改调用方传参而非改默认值**：改默认值影响面大（列表页可能依赖 dataUrl 渲染缩略图），改 `init()` 调用方更精准。需检查列表渲染是否依赖 dataUrl——若列表页显示缩略图，则列表页也需改为按需读图或用路径直接渲染（`<img src="file://...">` 在 Capacitor WebView 中可用）。

### D4: runDailyDecrement 复用 DATA

**方案**：`runDailyDecrement()` 改为接收 `data` 参数，`init()` 调用时传入已加载的 `DATA`，去掉内部重复 `NurseStorage.load()`。

### D5: Splash Screen 插件

**方案**：安装 `@capacitor/splash-screen`，`capacitor.config.js` 配置 `SplashScreen: { launchAutoHide: false }`。`app.js` 的 `init()` 末尾 `await SplashScreen.hide()`。

**替代方案考虑**：
- 用 `launchShowDuration: 3000`：固定时长不精确，可能 init 已完成仍显示 splash 或 init 未完成已隐藏。否决。

## Risks / Trade-offs

- **[vendor/ 目录增大 APK 体积]** Transformers.js ~1.2MB + wasm ~2-4MB，APK 增大约 3-5MB → 可接受，换取无网络依赖和按需加载
- **[wasm MIME 类型问题]** WebView 从 `vendor/` 加载 `.wasm` 可能因 MIME 类型不正确失败 → 需确认 Capacitor WebView 对 `.wasm` 返回 `application/wasm`，若不行需用 `fetch` + `WebAssembly.instantiateStreaming` 手动加载
- **[列表页缩略图依赖 dataUrl]** 若列表页渲染依赖 dataUrl，改为 `withDataUrls=false` 后缩略图不显示 → 需检查列表渲染逻辑，改用图片路径或按需加载缩略图
- **[splash 在 Web 预览模式无效]** `@capacitor/splash-screen` 仅在原生环境生效，Web 预览仍白屏 → 可接受，Web 预览仅开发用

## Migration Plan

1. 先在 `frontend/vendor/` 放入 Transformers.js + wasm，构建脚本中加复制步骤
2. 改 `rag-embed.js` 动态注入逻辑，本地测试 AI 聊天仍正常
3. 改 `db.js` DDL 移入版本分支，测试首次/非首次启动
4. 改 `app.js` 图片读取和 runDailyDecrement
5. 加 splash-screen 插件，真机测试
6. 回滚策略：所有改动均为代码层，git revert 即可，无数据迁移
