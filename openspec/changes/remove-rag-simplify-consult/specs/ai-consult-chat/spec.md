## MODIFIED Requirements

### Requirement: 倪海厦中医人设
系统 SHALL 使用静态慢性病管理 prompt 作为 AI 问诊的 system message，使 AI 以慢性病健康管理助手身份进行医嘱解读、用药指导、饮食禁忌、风险预警等回复。prompt 不绑定特定病种或中医辨证体系，不依赖向量检索。

#### Scenario: 慢性病管理回复
- **WHEN** 用户描述症状或用药问题
- **THEN** 系统以静态慢性病管理 prompt 作为 system message，AI 以健康管理助手身份回复，包含用药指导、饮食禁忌、风险预警等

#### Scenario: 一般健康问题
- **WHEN** 用户询问一般健康问题
- **THEN** AI 结合慢性病管理视角给出回复

### Requirement: 安全边界
系统 SHALL 对急危重症关键词进行检测并触发就医提醒，AI 回复附带免责声明。

#### Scenario: 急危重症提醒
- **WHEN** 用户输入包含急危重症关键词（胸痛、昏迷、大出血、呼吸困难等）
- **THEN** 系统在发送前显示醒目就医提醒，建议立即就医

#### Scenario: 免责声明
- **WHEN** AI 回复完成
- **THEN** 回复底部附带免责声明"仅供参考，不替代医疗诊断，需遵医嘱"

### Requirement: 独立模型配置
系统 SHALL 在设置页提供统一的 AI 配置项，问诊聊天与医嘱解析共用同一配置。

#### Scenario: 统一配置
- **WHEN** 用户在设置页配置 AI（API Key / Base URL / Model）
- **THEN** AI 问诊聊天与医嘱解析均使用该配置
