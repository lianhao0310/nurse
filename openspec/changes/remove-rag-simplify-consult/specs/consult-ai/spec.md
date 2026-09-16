## Purpose

提供 AI 问诊对话能力，以静态慢性病管理 prompt 作为 system message，支持多轮上下文与流式回复，不依赖向量检索。

## ADDED Requirements

### Requirement: 慢性病管理 System Prompt
系统 SHALL 使用静态慢性病管理 prompt 作为 AI 问诊的 system message，覆盖医嘱解读、用药指导、饮食禁忌、风险预警、护理任务等慢性病管理场景，不绑定特定病种或中医辨证体系。

#### Scenario: prompt 内容覆盖慢性病管理核心场景
- **WHEN** 加载 consult-ai.js 模块
- **THEN** 模块导出 GENERAL_SKILL_PROMPT 常量，内容包含慢性病管理定位、用药安全、饮食禁忌、风险预警、急危重症安全边界、回复要求等核心指引

#### Scenario: prompt 不绑定特定病种
- **WHEN** 检查 GENERAL_SKILL_PROMPT 内容
- **THEN** 不包含中医六经辨证、倪海厦、特定病种硬编码等内容

### Requirement: 多轮对话
系统 SHALL 支持多轮上下文对话，截断保留最近 20 轮历史，以 system message + history 调用 AI chatStream。

#### Scenario: 正常多轮对话
- **WHEN** 用户发起问诊提问，传入历史消息列表
- **THEN** 系统截断历史至最近 20 轮，拼接 system message 后调用 AI chatStream 流式返回回复

#### Scenario: 未配置 AI 时报错
- **WHEN** AI 未配置（未启用或无 API Key）
- **THEN** isConfigured 返回 false，chat 抛出明确错误

### Requirement: 配置检测
系统 SHALL 提供 isConfigured(settings) 检测 AI 是否可用，基于 ai.enabled + ai.apiKey 判断。

#### Scenario: 已配置返回 true
- **WHEN** settings.ai.enabled 为 true 且 settings.ai.apiKey 非空
- **THEN** isConfigured 返回 true

#### Scenario: 未配置返回 false
- **WHEN** settings.ai.enabled 为 false 或 apiKey 为空
- **THEN** isConfigured 返回 false
