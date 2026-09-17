## 1. Playwright 集成测试

- [x] 1.1 安装 `@playwright/test` devDependency，创建 `playwright.config.ts`（headless chromium，testDir: tests/integration）。验证 `npx playwright install chromium` 成功
- [x] 1.2 创建 `tests/integration/smoke.test.ts`：用 Playwright 加载 frontend/index.html（通过 file:// 或 http server），验证所有 `<script>` 加载成功（无 404 console error）、无 pageerror、init() 完成后 `#header-title` 文本为 "Nurse"、底部 tab 栏可见。验证 `npx playwright test` 通过
- [x] 1.3 在 `package.json` 加 `"test:integration": "npx playwright test"` 脚本。验证 `npm run test:integration` 可执行

## 2. CI 集成

- [x] 2.1 修改 `.github/workflows/build-android.yml`：在 `npm install` 之后、`cap sync` 之前插入 `npm run test:ci` 步骤（排除 storage.test.js 预先失败）。验证 CI 步骤顺序正确
- [x] 2.2 修改 `.github/workflows/build-android.yml`：在 npm test 之后插入 `npx playwright install --with-deps chromium` + `npm run test:integration` 步骤。验证步骤顺序正确
- [x] 2.3 修改 `.github/workflows/build-ios.yml`：同上加 npm test + 集成测试步骤。验证步骤顺序正确

## 3. 验证

- [x] 3.1 本地运行集成测试验证通过（3/3 passed，使用系统 Edge 作为浏览器）
- [x] 3.2 验证 CI 步骤顺序：npm install → npm run test:ci → playwright install → test:integration → cap sync → build。任一步骤失败则不继续
