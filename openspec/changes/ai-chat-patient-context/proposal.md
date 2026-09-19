## Why

当前 AI 聊天只传递对话历史，完全没有利用用户已管理的用药、检查指标等病情数据（`consult-chat.js:309` 加载了 `data` 但仅取 `data.settings`）。导致用户问"我是否可以吃什么食物？""感冒了能吃布洛芬？"等需要结合个人病情的问题时，AI 无法给出个性化回答。App 已经管理了这些数据，应让 AI 聊天利用它们提供精准的个性化健康建议。

## What Changes

- AI 聊天发送消息时，将用户**当前在用药品**（药箱中 status=active 的药品：药名、规格、单次用量、服药时段、餐前餐后、对应病种）和**最近检查指标**（最近 2-3 次检查报告的指标及关注指标最新值）组装为简洁病情摘要，注入 system prompt
- 新增设置开关"AI 聊天结合我的病情数据"，默认开启；关闭时 AI 聊天退回当前行为（仅传对话历史）
- 开关开启时，在设置页明确告知用户病情数据会发送到 AI 服务
- 病情摘要做 token 量控制：在用药品全量注入，检查报告只取最近 3 次，每份报告指标不超过 30 项

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ai-consult-chat`: 新增"病情上下文注入"需求——AI 聊天 SHALL 在 system prompt 中注入用户当前在用药品与最近检查指标摘要；新增"病情数据开关"需求——用户可在设置页控制是否将病情数据发给 AI

## Impact

- `frontend/consult-ai.js`：`chat` 函数签名扩展，接受病情上下文参数，拼接到 system prompt
- `frontend/consult-chat.js`：`send` 函数读取 `DATA.cabinet`/`DATA.reports`/`DATA.followedIndicators`，组装病情摘要后传入 `chat`
- `frontend/storage.js`：`settings` 增加 `aiChatPatientContext` 开关字段（默认 true）
- `frontend/app.js`：设置页新增开关 UI 及隐私提示文案
- `frontend/db.js`：`app_settings` 表可能需新增字段（或复用 settings JSON）
- 无破坏性变更，开关关闭时行为与现状完全一致
