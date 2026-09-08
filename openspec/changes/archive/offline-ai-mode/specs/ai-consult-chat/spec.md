## MODIFIED Requirements

### Requirement: 历史对话管理
系统 SHALL 在"问 AI"Tab 页面展示历史对话列表，顶部提供"新建对话"按钮，点击对话卡片进入聊天，左滑可删除，风格与其他 Tab 页面一致。

#### Scenario: Tab 页面展示历史列表
- **WHEN** 用户点击底部"问 AI"Tab
- **THEN** 系统展示历史对话列表，每条卡片显示标题（首条消息摘要）、最后回复摘要、时间、消息数

#### Scenario: 新建对话
- **WHEN** 用户点击列表顶部"新建对话"按钮
- **THEN** 系统打开空白聊天会话窗，用户可开始提问

#### Scenario: 续聊历史对话
- **WHEN** 用户点击历史对话列表中的某条卡片
- **THEN** 系统打开该对话的聊天会话窗，加载完整消息记录，用户可继续发送消息

#### Scenario: 左滑删除对话
- **WHEN** 用户在历史列表左滑某条对话卡片
- **THEN** 显示删除按钮，点击后删除该对话并从列表移除

#### Scenario: 左滑返回列表
- **WHEN** 用户在聊天会话窗左滑
- **THEN** 返回历史对话列表页

#### Scenario: 对话持久化
- **WHEN** 用户发送消息或收到 AI 回复后
- **THEN** 对话内容自动保存到本地存储（Capacitor Filesystem，回退 localStorage），App 重启后可恢复

### Requirement: 倪海厦中医人设
系统 SHALL 通过 RAG 检索倪海厦中医知识库相关片段注入 prompt，使 AI 以倪海厦视角进行六经辨证、经方建议、饮食禁忌等回复。云端和本地模式统一使用 RAG，不再使用静态 Skill Prompt。

#### Scenario: 云端模式中医辨证回复
- **WHEN** 用户选择自定义 AI 且描述症状（如"怕冷无汗脖子疼"）
- **THEN** 系统检索 RAG 相关片段注入 prompt，云端模型以倪师口吻回复辨证结果，包含六经归属、病机分析、方剂建议（不出剂量）、饮食禁忌等

#### Scenario: 本地模式中医辨证回复
- **WHEN** 用户选择本地模型且模型已加载，描述症状
- **THEN** 系统检索 RAG 相关片段注入 prompt，本地 LLM 以倪师口吻回复辨证结果

#### Scenario: 非中医问题也可回答
- **WHEN** 用户询问一般健康问题
- **THEN** AI 结合中医视角给出回复，但不拒绝非中医问题

### Requirement: 流式输出
系统 SHALL 以流式方式实时显示 AI 回复。云端模式使用 SSE 流式，离线模式使用本地 LLM 逐 token 回调。

#### Scenario: 云端流式显示
- **WHEN** 云端模式下 AI 正在生成回复
- **THEN** 聊天区实时逐字显示 AI 回复内容，并显示加载指示

#### Scenario: 离线流式显示
- **WHEN** 本地模式下本地 LLM 正在生成回复
- **THEN** 聊天区实时逐 token 显示 AI 回复内容，并显示加载指示

### Requirement: 安全边界
系统 SHALL 对急危重症关键词进行检测并触发就医提醒，AI 回复附带免责声明。离线模式下同样生效。

#### Scenario: 急危重症提醒
- **WHEN** 用户输入包含急危重症关键词（胸痛、昏迷、大出血、呼吸困难等）
- **THEN** 系统在发送前显示醒目就医提醒，建议立即就医

#### Scenario: 免责声明
- **WHEN** AI 回复完成
- **THEN** 回复底部附带免责声明"仅供中医参考，需执业中医师辨证，不替代医疗诊断"

### Requirement: 对话标题自动生成
系统 SHALL 根据用户首条消息自动生成对话标题，用于历史列表展示。

#### Scenario: 首条消息生成标题
- **WHEN** 用户在新对话中发送首条消息
- **THEN** 系统截取首条消息前若干字作为对话标题

## REMOVED Requirements

### Requirement: 首页入口
**Reason**: 悬浮按钮入口改为 Tab 页面入口，不再需要首页悬浮按钮
**Migration**: 用户通过底部"问 AI"Tab 进入，不再通过首页悬浮按钮

### Requirement: 语音输入
**Reason**: 用户反馈录音转写功能无用，移除以简化界面
**Migration**: 用户通过文字输入和图片输入进行问诊

### Requirement: 独立模型配置
**Reason**: 已在上一个 change 中移除，此处清理残留 spec
**Migration**: 统一使用"自定义 AI 配置"，未配置时自动回退离线模式

## ADDED Requirements

### Requirement: Tab 页面入口
系统 SHALL 在底部 Tab 栏提供"问 AI"入口，替代原"AI 医嘱"Tab，点击进入历史对话列表页。

#### Scenario: Tab 入口可见
- **WHEN** 用户查看底部 Tab 栏
- **THEN** 显示"问 AI"Tab，图标为聊天图标

#### Scenario: 点击进入历史列表
- **WHEN** 用户点击"问 AI"Tab
- **THEN** 系统展示历史对话列表页，若有对话显示列表，若无显示空状态提示

### Requirement: 图片消息支持
系统 SHALL 在聊天会话中支持发送图片消息，用户可拍照或从相册选择图片发送给 AI。

#### Scenario: 发送图片消息
- **WHEN** 用户在聊天会话中点击图片按钮并选择/拍摄图片
- **THEN** 图片以缩略图气泡显示在聊天区，AI 开始处理

#### Scenario: 离线模式图片处理
- **WHEN** 本地模式下用户发送图片
- **THEN** 系统先调用原生 OCR 提取文字，再将文字作为用户消息内容传入 RAG + 本地 LLM 处理

#### Scenario: 云端模式图片处理
- **WHEN** 云端模式下用户发送图片
- **THEN** 系统将图片直接发给云端 vision 模型处理，同时 RAG 检索结果注入 prompt

### Requirement: 空状态引导
系统 SHALL 在历史对话列表为空时显示引导提示，帮助用户开始第一次问诊。

#### Scenario: 无历史对话
- **WHEN** 用户首次进入"问 AI"Tab 且无任何历史对话
- **THEN** 显示空状态提示"点击上方新建对话，向倪师提问"
