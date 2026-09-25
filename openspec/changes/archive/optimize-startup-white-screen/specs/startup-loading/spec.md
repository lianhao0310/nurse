## Purpose

定义 App 启动时的资源加载策略，确保非首次启动在 2 秒内完成首屏渲染，重资源按需加载、DDL 仅首次执行、splash 闪屏遮盖初始化期。

## ADDED Requirements

### Requirement: 重资源按需加载
系统 SHALL 将 Transformers.js 等体积超过 500KB 的非首屏必需库从同步 `<script>` 标签改为按需动态加载，首屏渲染前不加载这些资源。

#### Scenario: 首屏不加载 Transformers.js
- **WHEN** App 启动并执行 init 流程
- **THEN** Transformers.js 不在首屏渲染前加载，`boot()`/`init()` 不因该库阻塞

#### Scenario: AI 聊天时按需加载
- **WHEN** 用户首次发起 AI 问诊聊天触发向量嵌入
- **THEN** 系统动态注入本地 `vendor/transformers.min.js`，加载完成后执行嵌入推理

#### Scenario: 本地资源不依赖网络
- **WHEN** Transformers.js 及其 wasm 依赖已随包发布到 `frontend/vendor/`
- **THEN** 动态加载使用本地路径，不发起任何 CDN 网络请求

### Requirement: DDL 仅首次执行
系统 SHALL 只在数据库 schema 版本低于应用期望版本时执行建表 DDL 与索引 DDL，非首次启动跳过全部 DDL 语句。

#### Scenario: 首次启动执行 DDL
- **WHEN** App 首次启动且 `PRAGMA user_version` 为 0
- **THEN** 系统执行全部建表与索引 DDL，完成后设置 `user_version` 为目标版本

#### Scenario: 非首次启动跳过 DDL
- **WHEN** App 启动且 `PRAGMA user_version` 已等于应用期望版本
- **THEN** 系统跳过所有 `CREATE TABLE IF NOT EXISTS` 与 `CREATE INDEX IF NOT EXISTS` 语句，直接进入数据加载

### Requirement: 启动期不读图片数据
系统 SHALL 在启动 init 流程中加载问诊记录、药单、检查报告列表时不读取图片 dataUrl，仅加载元数据；图片在详情页打开时按需读取。

#### Scenario: 启动期仅加载元数据
- **WHEN** App 启动执行 `getRecords/getOrders/getReports`
- **THEN** 返回的记录列表不含图片 dataUrl，仅含图片路径等元数据

#### Scenario: 详情页按需读图
- **WHEN** 用户打开某条问诊记录/药单/报告详情
- **THEN** 系统按需读取该条记录的图片 dataUrl 供展示

### Requirement: Splash 闪屏遮盖初始化期
系统 SHALL 配置 splash 闪屏在 init 流程完成前不自动隐藏，init 完成后手动隐藏，消除初始化期的白屏。

#### Scenario: 初始化期显示闪屏
- **WHEN** App 启动进入 init 流程
- **THEN** splash 闪屏持续显示，用户不看到白屏

#### Scenario: 初始化完成隐藏闪屏
- **WHEN** init 流程执行完毕
- **THEN** 系统手动调用 `SplashScreen.hide()` 隐藏闪屏，展示首屏内容
