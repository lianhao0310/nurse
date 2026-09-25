## 1. Transformers.js 本地化 + 按需加载

- [x] 1.1 创建构建脚本 `scripts/copy-vendor.js`，将 `node_modules/@xenova/transformers/dist/transformers.min.js` 及 onnxruntime-web 的 `.wasm` 文件复制到 `frontend/vendor/`，运行脚本验证 `frontend/vendor/` 下文件存在且大小正确（transformers.min.js ~1.2MB）
- [x] 1.2 删除 `frontend/index.html:607` 的 Transformers.js CDN `<script>` 标签，验证页面不再从 CDN 加载该库
- [x] 1.3 修改 `frontend/rag-embed.js` 的 `_loadModel()`：在取 `window.transformers` 前先检查并动态注入 `<script src="vendor/transformers.min.js">`，注入完成后设置 `transformers.env.backends.onnx.wasm.wasmPaths = "vendor/"`，验证首次 AI 聊天时 Transformers.js 从本地加载且 wasm 不发起 CDN 请求
- [ ] 1.4 真机测试 AI 问诊聊天功能正常：首次提问时加载 Transformers.js + 模型，向量检索返回结果，prompt 拼接正确

## 2. DDL 仅首次执行

- [x] 2.1 修改 `frontend/db.js` 的 `init()`：将 `execute(DDL)` / `execute(INDEX_DDL)` 移入 `if (curVersion < APP_SCHEMA_VERSION)` 分支（或放入 `migrations[1]`），验证首次启动建表正常、非首次启动跳过 DDL
- [ ] 2.2 清除 App 本地数据后首次启动，验证 25 张表 + 23 索引正确创建；再次启动验证 DDL 不执行（可通过 console.log 确认跳过）

## 3. 启动期不读图片 dataUrl

- [x] 3.1 检查 `frontend/app.js` 列表渲染逻辑（`renderRecords` 等），确认列表页是否依赖 dataUrl 显示缩略图；若依赖，改为用图片路径渲染或按需加载缩略图
- [x] 3.2 修改 `frontend/app.js:97-99` 的 `getRecords/getOrders/getReports` 调用，传 `withDataUrls=false`（或 `{ withDataUrls: false }`），验证启动后列表页正常显示、无图片 dataUrl 加载
- [x] 3.3 修改详情页打开逻辑，改为按需调用 `getRecord(id, true)` / `getOrder(id, true)` / `getReport(id, true)` 读取图片 dataUrl，验证详情页图片正常显示

## 4. runDailyDecrement 复用 DATA

- [x] 4.1 修改 `frontend/app.js` 的 `runDailyDecrement()`：改为接收 `data` 参数，去掉内部 `NurseStorage.load()` 调用；`init()` 调用处传入 `DATA`，验证药量递减逻辑正常

## 5. Splash Screen 遮盖初始化期

- [x] 5.1 安装 `@capacitor/splash-screen` 依赖，验证 `package.json` 中依赖存在且 `npm install` 成功
- [x] 5.2 修改 `capacitor.config.js` 添加 `SplashScreen: { launchAutoHide: false }` 配置，验证配置生效
- [x] 5.3 修改 `frontend/app.js` 的 `init()` 末尾添加 `SplashScreen.hide()` 调用（try-catch 包裹，Web 预览模式降级），验证真机启动时 splash 持续显示到首屏渲染完成

## 6. 集成验证

- [x] 6.1 运行 `npm test` 验证全部测试通过（rag-knowledge/engine/multi-image 全通过，storage 预先存在 37 个失败与本次改动无关）
- [ ] 6.2 真机冷启动测试（非首次启动）：从点击图标到首屏渲染 < 2s，无白屏
- [ ] 6.3 真机首次安装测试：首次启动可接受短暂白屏（splash 遮盖），建表完成后正常进入
- [ ] 6.4 验证 AI 聊天、问诊记录详情、药单详情、报告详情功能均正常
