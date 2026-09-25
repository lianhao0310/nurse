## MODIFIED Requirements

### Requirement: 首页入口
系统 SHALL 在首页底部提供"问 AI"按钮，点击后进入 AI 问诊聊天页面。

#### Scenario: 正常进入
- **WHEN** 用户在首页点击"问 AI"按钮
- **THEN** 系统打开 AI 问诊聊天页面，显示当前对话或新建对话界面

#### Scenario: 云端模式未配置或断网时入口禁用
- **WHEN** activeAIMode 为 "custom" 且（AI 未配置 API Key 或网络不可用）
- **THEN** "问 AI"按钮显示禁用态并提示"需联网并配置云端 AI 后使用"

#### Scenario: 本地模式已下载模型时断网可用
- **WHEN** activeAIMode 为 "local" 且本地模型已下载完成
- **THEN** "问 AI"按钮可用，即使设备断网也可进入并使用问诊聊天

#### Scenario: 本地模式未下载模型时入口禁用
- **WHEN** activeAIMode 为 "local" 且本地模型未下载完成
- **THEN** "问 AI"按钮显示禁用态并提示"需先下载本地模型"

### Requirement: 流式输出
系统 SHALL 以流式方式实时显示 AI 回复，而非等待完整回复后一次性显示。云端模式通过 SSE 流式传输，本地模式通过原生插件 token 回调流式传输。

#### Scenario: 云端模式流式显示
- **WHEN** 云端模式激活且 AI 正在生成回复
- **THEN** 聊天区通过 SSE 实时逐字显示 AI 回复内容，并显示加载指示

#### Scenario: 本地模式流式显示
- **WHEN** 本地模式激活且本地模型正在推理生成
- **THEN** 聊天区通过原生插件 token 回调实时逐字显示生成内容，并显示加载指示

### Requirement: 独立模型配置
系统 SHALL 在设置页提供"中医问诊模型"独立配置项，可与西医解析模型不同。云端模式下可单独配置中医问诊的 API Key / Base URL / Model；本地模式下中医问诊与西医解析共用同一本地模型。

#### Scenario: 云端模式单独配置中医模型
- **WHEN** 云端模式下用户在设置页配置中医问诊模型（API Key / Base URL / Model）
- **THEN** AI 问诊聊天使用该配置调用云端模型，不影响西医解析的模型配置

#### Scenario: 云端模式未配置时回退共用
- **WHEN** 云端模式下用户未单独配置中医问诊模型
- **THEN** 系统回退使用西医解析的 AI 配置

#### Scenario: 本地模式共用本地模型
- **WHEN** 本地模式激活
- **THEN** AI 问诊聊天与西医解析共用同一本地模型配置，不单独配置
