## Why

当前 CI（build-android.yml / build-ios.yml）只做构建不跑测试，单元测试（npm test）不在 CI 中执行。移动端出现"仅显示图标"（splash 卡住）这类问题无法被现有测试发现——单元测试不覆盖 Capacitor 插件交互、脚本加载顺序、init() 完整流程。需要补充集成测试和 CI 冒烟检查，在构建前验证前端可正常初始化，避免低级问题到真机才发现。

## What Changes

- **CI 加 npm test**：在 build-android.yml / build-ios.yml 的构建步骤前加 `npm test`，测试失败则阻断构建
- **CI 加 cap sync 验证**：cap sync 已有但失败不明确，加显式检查确保 sync 成功
- **新增集成测试（Playwright）**：在 headless 浏览器中加载 `frontend/index.html`，验证：
  - 所有 `<script>` 标签加载成功（无 404）
  - `init()` 执行无抛错
  - 页面渲染后 `#header-title` 文本为 "Nurse"（非空白）
  - 底部 tab 栏可见
- **CI 加集成测试步骤**：在构建前运行 Playwright 集成测试
- **新增 Playwright 依赖和配置**：`@playwright/test` devDependency + `playwright.config.ts`

## Capabilities

### New Capabilities
- `ci-smoke-test`: CI 冒烟测试能力——构建前运行单元测试 + 集成测试，验证前端可正常初始化，阻断有问题的构建

## Impact

- `.github/workflows/build-android.yml`：加 npm test + 集成测试步骤
- `.github/workflows/build-ios.yml`：加 npm test + 集成测试步骤
- `tests/integration/`（新增目录）：Playwright 集成测试
- `playwright.config.ts`（新增）：Playwright 配置
- `package.json`：加 `@playwright/test` devDependency + test:integration 脚本
