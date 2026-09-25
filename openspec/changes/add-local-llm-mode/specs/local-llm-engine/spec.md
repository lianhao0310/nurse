## Purpose

提供端侧 LLM 推理能力，让用户在断网环境下使用本地大模型进行 AI 智能解析和问诊对话，确保隐私数据不离开设备。支持模型按需下载、可替换配置抽象，方便后续替换为 BianQue 蒸馏产物。

## ADDED Requirements

### Requirement: 云端/本地模式二选一
系统 SHALL 在 AI 设置中提供"云端模型"与"本地模型"两种模式，用户选择其一作为当前激活模式。两种配置 SHALL 独立保存、共存互不覆盖，切换激活模式不丢失另一配置。

#### Scenario: 切换到本地模式
- **WHEN** 用户在设置页将 AI 模式从"云端模型"切换为"本地模型"
- **THEN** 系统保存 `activeAIMode = "local"`，云端配置（baseUrl/apiKey/model）保留不清除，后续 AI 调用走本地推理路径

#### Scenario: 切换回云端模式
- **WHEN** 用户将 AI 模式从"本地模型"切换回"云端模型"
- **THEN** 系统保存 `activeAIMode = "custom"`，本地模型配置保留不清除，后续 AI 调用走云端 API 路径

#### Scenario: 首次使用默认云端
- **WHEN** 用户首次打开 AI 设置且从未配置
- **THEN** `activeAIMode` 为 null，AI 功能未启用；启用后默认选择"云端模型"

### Requirement: 本地模型按需下载
系统 SHALL 在用户首次选择本地模式且模型未下载时，提示下载默认模型（Qwen2.5-0.5B GGUF Q4_K_M），下载到 Filesystem 持久目录，并显示下载进度。

#### Scenario: 首次切到本地模式触发下载
- **WHEN** 用户切到本地模式且本地无已下载模型
- **THEN** 系统显示模型信息（名称、大小 ~400MB）和下载按钮，用户确认后开始下载，实时显示进度百分比

#### Scenario: 下载完成后可用
- **WHEN** 模型下载完成
- **THEN** 系统标记 `localModel.downloaded = true` 并记录本地路径，AI 功能切换为可用状态

#### Scenario: 下载中断后可续传
- **WHEN** 下载过程中网络中断或 App 退出
- **THEN** 下次进入本地模式时检测到未完成下载，从断点继续下载而非重新开始

#### Scenario: 已下载不重复下载
- **WHEN** 用户切到本地模式且模型已下载完成
- **THEN** 直接进入可用状态，不触发重复下载

### Requirement: 本地文本推理
系统 SHALL 通过 llama.cpp 原生插件在端侧执行本地模型推理，接受文本 prompt 和对话历史，流式返回生成结果。

#### Scenario: 本地文本推理生成
- **WHEN** 本地模式已激活且模型已下载，用户发起文本解析或对话请求
- **THEN** 系统调用 llama.cpp 加载 GGUF 模型执行推理，流式返回 token，不经过任何网络请求

#### Scenario: 推理上下文长度限制
- **WHEN** 输入 prompt + 历史超过模型上下文长度（默认 2048 tokens）
- **THEN** 系统截断最早的历史消息以适配上下文窗口，保留最新对话

#### Scenario: 模型加载失败
- **WHEN** GGUF 文件损坏或设备内存不足导致加载失败
- **THEN** 系统提示错误信息并引导用户重新下载模型或切换到云端模式

### Requirement: 本地模式仅支持文本
系统 SHALL 在本地模式下仅接受文本输入，图片相关功能入口置灰并提示用户切换云端模式。

#### Scenario: 本地模式图片入口置灰
- **WHEN** 本地模式激活时用户尝试使用图片解析或发送图片消息
- **THEN** 图片入口显示禁用态并提示"本地模型不支持图片，切至云端模型可解析图片"

### Requirement: 模型可替换配置抽象
系统 SHALL 将本地模型配置抽象为可替换的结构 `{ modelId, name, ggufUrl, sizeBytes, contextLength, downloaded, localPath }`，替换模型只需更新配置无需修改代码。

#### Scenario: 替换为 BianQue 蒸馏产物
- **WHEN** 后续 BianQue 蒸馏完成产出新 GGUF 模型
- **THEN** 仅更新 `localModel` 配置（modelId/name/ggufUrl/sizeBytes），系统自动下载新模型并替换，推理代码无需改动

#### Scenario: 多模型配置预留
- **WHEN** 配置中指定不同的 modelId
- **THEN** 系统按 modelId 区分模型文件，支持多个模型共存于设备，按激活配置加载对应模型

### Requirement: 断网可用与隐私保护
系统 SHALL 保证本地模式下所有推理在设备端完成，不发起任何网络请求，用户数据不离开设备。

#### Scenario: 断网下本地推理
- **WHEN** 设备无网络连接且本地模式已激活且模型已下载
- **THEN** AI 智能解析和问诊对话正常工作，不因断网失败

#### Scenario: 本地模式无网络请求
- **WHEN** 本地模式执行推理
- **THEN** 全程不发起任何 HTTP 请求，prompt 和生成结果仅在设备内存/本地存储中流转
