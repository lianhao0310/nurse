## Context

现有 CI（build-android.yml / build-ios.yml）流程：checkout → setup node/java → npm install → cap sync → gradlew assemble。不跑任何测试。单元测试（npm test）只在本地手动执行。移动端"仅显示图标"问题（splash 卡住）到真机才发现，CI 无法捕获。

前端是纯静态文件（frontend/index.html + JS/CSS），无打包步骤。Capacitor WebView 加载这些文件的方式与浏览器一致（除了原生插件 API），因此可以用 Playwright 在 headless Chrome 中模拟 WebView 环境做集成测试。

## Goals / Non-Goals

**Goals:**
- CI 构建前跑 `npm test`（单元测试）
- CI 构建前跑 Playwright 集成测试（验证脚本加载 + init() + 页面渲染）
- 测试失败阻断构建

**Non-Goals:**
- 不做真机/模拟器 E2E（太重，GitHub Actions 跑 Android Emulator 耗时 10+ 分钟）
- 不测 Capacitor 原生插件功能（SQLite/Filesystem 等，这些在浏览器中不可用）
- 不改现有单元测试

## Decisions

### D1: 用 Playwright 做集成测试

**方案**：`@playwright/test` 在 headless Chromium 中加载 `frontend/index.html`（通过 file:// 或本地 http server），监听 console.error 和 pageerror，验证 init() 完成后页面非空白。

**为什么选 Playwright**：
- 内置 headless 浏览器，CI 中安装简单（`npx playwright install --with-deps chromium`）
- 能捕获 JS 加载失败（404）、运行时错误（pageerror）、console.error
- 比 Puppeteer 更适合测试（内置断言、测试 runner）

**替代方案**：
- Puppeteer：类似但需自己写 test runner。否决。
- jsdom：能测 JS 逻辑但不测 DOM 渲染和脚本加载。否决。
- Capacitor Mock：能模拟插件但不能测真实加载顺序。否决。

### D2: 集成测试用本地 http server 加载页面

**方案**：Playwright 配置中启动一个简单 http server（或用 Playwright 内置的 `page.goto('file://...')`）加载 frontend/index.html。

**注意**：Capacitor 插件（@capacitor-community/sqlite 等）在浏览器中不可用，`window.NurseDB.init()` 会进入内存模式（db.js 已有降级逻辑）。集成测试验证的是**脚本加载 + init() 不报错 + 页面渲染**，不验证原生插件功能。

### D3: CI 步骤顺序

**方案**：在现有 CI 的 `npm install` 之后、`cap sync` 之前插入：
1. `npm test`（单元测试）
2. `npx playwright install --with-deps chromium`（安装浏览器）
3. `npm run test:integration`（集成测试）

任一步骤失败则 CI 失败，不继续构建。

### D4: 集成测试文件位置

**方案**：`tests/integration/smoke.test.ts`，Playwright 配置 `playwright.config.ts` 在项目根目录。`package.json` 加 `"test:integration": "playwright test"` 脚本。

## Risks / Trade-offs

- **[Playwright 安装增加 CI 时长]** 安装 Chromium ~30s，首次 CI 多约 1 分钟 → 可接受，换取构建质量
- **[浏览器环境与 WebView 差异]** 浏览器中 Capacitor 插件不可用，init() 走内存模式，部分逻辑与真机不同 → 可接受，集成测试目标是抓"脚本加载错误"和"init() 抛错"这类低级问题，不是全面 E2E
- **[storage.test.js 预先存在 37 个失败]** CI 中 `npm test` 会因 storage 测试失败而阻断构建 → 需先修复或暂时排除 storage.test.js
