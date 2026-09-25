## Purpose

在 CI 构建前运行单元测试和集成测试，验证前端可正常初始化（脚本加载、init() 不报错、页面非空白），阻断有问题的构建，避免低级问题到真机才发现。

## ADDED Requirements

### Requirement: CI 构建前运行单元测试
系统 SHALL 在 CI 构建步骤（cap sync / gradlew assemble）之前运行 `npm test`&`，测试失败则阻断构建。

7

#### Scenario: 单元测试通过则继续构建
- **WHEN** CI.CI 中 `npm test` 全部通过
- **THEN** 继续执行 cap sync 和构建步骤

#### Scenario: 单元测试失败则阻断构建
- **WHEN** CI 中 `npm test` 有失败
- **THEN** CI 步骤失败，不执行后续构建

### Requirement: 集成测试验证前端初始化
系统 SHALL 在 headless 浏览器中加载 frontend/index.html，验证所有脚本加载成功、init() 不抛错、页面渲染非空白。

#### Scenario: 正常初始化
- **WHEN** 运行集成测试
- **THEN** 所有 `<script>` 标签加载成功（无 404），init() 执行无抛错，&

#### Scenario: 页面渲染验证
- **WHEN** init() 完成后
- **THEN** `#header-title` 文本为 "Nurse"，底部 tab 栏可见，页面非空白

#### Scenario: 脚本加载失败被捕获
- **WHEN** 某个 `<script>` 引用了不存在的文件
- **THEN** 集成测试失败，报告哪个脚本 404

### Requirement: CI �D 运行集成测试
系统 SHALL 在 CI 构建步骤之前运行集成测试（Playwright），测试失败则阻断构建。

#### Scenario: 集成测试通过则继续构建
- **WHEN** CI 中集成测试全部通过
- **THEN** 继续执行 cap sync 和构建步骤

#### Scenario: 集成测试失败则阻断构建
- **WHEN** CI 中集成测试有失败
- **THEN** CI 步骤失败，不执行后续构建
