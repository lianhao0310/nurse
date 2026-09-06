## Why

当前 nurse 应用的 AI 能力仅用于"问诊录音转写后的医嘱解析"（`ai.js`），用户无法直接向 AI 提问或进行多轮对话。用户希望能在移动端直接与具备倪海厦经方中医思维的 AI 助手聊天问诊，随时咨询症状辨证、经方建议、饮食禁忌等问题，并保留历史对话可续聊。

采用"路径 C：Skill 注入云端模型"——不训练、不端侧推理，将 nihaixia 仓库的蒸馏速查层提炼为 System Prompt，复用现有 `ai.js` 的 OpenAI 兼容接口调用云端大模型（如 GLM、Qwen），让 AI 以倪师视角进行中医辨证。该路径最轻量、最快落地，无需模型下载、不占本地存储，联网时使用、断网时禁用。

## What Changes

- 新增首页底部"问 AI"按钮入口，点击进入 AI 问诊聊天页面
- 新增 AI 问诊聊天页面：聊天式多轮对话界面，支持文字输入与语音输入（语音经 Web Speech API 转文字后发送）
- 聊天页面顶部提供"新建对话"与"查看历史对话"功能；历史对话列表可点击展开继续聊天
- 新增倪海厦中医 Skill Prompt（从 nihaixia 仓库 `references/distilled/` 蒸馏速查层提炼，约 4-6K 字），作为 AI 问诊的默认人设与辨证骨架
- 新增 `tcm-ai.js` 封装中医问诊对话调用，复用 `ai.js` 的流式聊天能力（`_chatStream`），支持多轮上下文
- 新增历史对话持久化：复用 `storage.js`，新增对话列表数据模型，落盘到手机文件系统（与现有健康档案同构）
- AI 问诊页面支持流式输出（SSE），实时显示 AI 回复
- 设置页新增"中医问诊模型"独立配置项（可与西医解析模型不同，因辨证需更强推理模型）
- 断网或未配置 API Key 时，禁用"问 AI"入口并给出明确提示
- 医疗安全边界：急危重症关键词触发就医提醒；AI 回复附带免责声明（仅供中医参考，需执业中医师辨证）

## Capabilities

### New Capabilities
- `ai-consult-chat`: 移动端 AI 问诊聊天模块，含首页入口、聊天界面、语音/文字输入、多轮对话、历史对话管理与续聊、倪师中医人设、流式输出、独立模型配置

### Modified Capabilities
<!-- 无现有 capability 需修改 -->

## Impact

- **新增文件**：`frontend/tcm-ai.js`（中医问诊对话封装）、`frontend/tcm-skill.js`（提炼的 Skill Prompt 常量）、`frontend/consult-chat.js`（聊天 UI 与交互）、`docs/tcm-skill-source.md`（Prompt 提炼来源记录）
- **修改文件**：`frontend/index.html`（首页底部入口 + AI 问诊页面容器 + 引入新脚本）、`frontend/app.js`（首页入口绑定、页面切换）、`frontend/ai.js`（导出 `_chatStream` 供复用）、`frontend/storage.js`（新增历史对话数据模型与存取方法）、`frontend/styles.css`（聊天界面 iOS 风格样式）
- **依赖**：无新增外部依赖，复用现有 Web Speech API（语音输入）与 OpenAI 兼容接口
- **数据模型**：`storage.js` 新增 `consultChats[]`（历史对话列表，每条含 id/标题/创建时间/更新时间/messages[]）
- **外部资源**：nihaixia 仓库（MulanPSL-2.0 开源）的蒸馏速查层用于提炼 Prompt，需在 `tcm-skill.js` 保留版权声明
- **不受影响**：现有问诊记录、药箱、检查报告、用药提醒等功能完全保留，本模块为独立新增
- **运行环境**：联网使用（路径 C 固有约束），Capacitor iOS/Android WebView 与 Web 演示端均可用
