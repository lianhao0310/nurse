## Context

当前 AI 聊天三层架构：`consult-chat.js`（UI）→ `consult-ai.js`（业务）→ `ai.js`（HTTP）。`consult-chat.js:309` 的 `send` 函数已通过 `NurseStorage.load()` 加载了完整 `DATA`（含 `cabinet`/`reports`/`followedIndicators`），但仅取 `data.settings` 传给 `NurseConsult.chat()`。`consult-ai.js:60` 的 `chat` 函数只拼接 `GENERAL_SKILL_PROMPT` + 对话历史，无病情数据。`DATA.settings` 通过 `NurseStorage.saveSettings()` 持久化，`app.js` 设置页渲染开关 UI。

## Goals / Non-Goals

**Goals:**
- AI 聊天能结合用户在用药品与最近检查指标给出个性化回答
- 用户可通过设置开关控制是否注入病情数据
- 病情摘要 token 量受控，不影响现有聊天功能

**Non-Goals:**
- 不注入问诊历史（records）——数据量大且需深度精简，留待后续
- 不新增过敏/禁忌数据字段——当前数据库无此字段，超出本次范围
- 不改造为"智能判断是否需要注入"——按需求采用每次注入策略
- 不修改 `ai.js` 底层——病情摘要仅影响 system prompt 拼接，在 `consult-ai.js` 层完成

## Decisions

### 决策1：病情摘要构建逻辑放在 `consult-ai.js`

新增 `buildPatientContext(data)` 函数于 `consult-ai.js`，负责从 `data.cabinet`/`data.reports`/`data.followedIndicators` 组装病情摘要文本。

**理由**：`consult-ai.js` 已负责构建 system prompt（`GENERAL_SKILL_PROMPT`），病情摘要属于 prompt 构建职责，放此处内聚。`consult-chat.js` 只负责传 data，不关心摘要格式。

**替代方案**：在 `consult-chat.js` 构建摘要字符串后传入 `chat`。否决：职责分散，且 `chat` 无法自主控制格式。

### 决策2：`chat` 函数签名扩展为接受 `data`

`chat(messages, settings, onChunk)` → `chat(messages, settings, onChunk, data)`

`data` 为 `NurseStorage.load()` 返回的完整对象。`chat` 内部按需取 `data.cabinet`/`data.reports`/`data.followedIndicators`，并读 `settings.aiChatPatientContext` 判断是否注入。

**理由**：`send` 函数已有 `data`，传整个对象改动最小且未来扩展方便（如后续注入问诊历史只需改 `buildPatientContext`）。

**替代方案**：只传精选字段 `{cabinet, reports, followedIndicators}`。否决：多一次中间对象构造，且 `chat` 仍需 `settings` 判断开关，不如统一传 data。

### 决策3：病情摘要拼接到 system prompt 末尾

`buildPatientContext` 返回中文文本，拼接到 `GENERAL_SKILL_PROMPT` 之后，用 `【用户病情】` 标记开头。格式示例：
```
【用户病情】
当前用药：
- 华法林钠片 3mg，每次1片，早/晚 餐后服用（病种：房颤）
- 二甲双胍 0.5g，每次1片，早 餐后服用（病种：2型糖尿病）
最近检查指标（最近3次）：
- 2026-09-15：收缩压 145 mmHg（参考90-140 ↑异常），舒张压 92 mmHg（参考60-90 ↑异常）
- 2026-09-10：空腹血糖 7.2 mmol/L（参考3.9-6.1 ↑异常）
关注指标最新值：
- 收缩压：145 mmHg（最近 2026-09-15，参考90-140 ↑异常）
```

**理由**：与 `GENERAL_SKILL_PROMPT` 中文风格一致；放 system prompt 而非 user message，避免污染对话历史和用户可见消息。

### 决策4：开关字段加到 `settings` 顶层

`DATA.settings` 新增 `aiChatPatientContext: true`（默认开启）。通过现有 `NurseStorage.saveSettings()` 持久化，无需改 DB schema（settings 以 JSON 形式存储）。

**理由**：复用现有 settings 持久化机制，零 schema 变更。

### 决策5：token 控制策略

- 在用药品：全量注入（`status === "active"`，通常不超过 20 种）
- 检查报告：按 `date` 降序取最近 3 次
- 每份报告指标：按 `sort_order` 取前 30 项
- 关注指标最新值：遍历所有报告找该指标最近一次非空值，最多取 10 个关注指标

**理由**：在用药品是回答药物相互作用/食物禁忌的关键，需全量；历史报告价值递减，3 次足够反映近期趋势。

## Risks / Trade-offs

- **[Token 超限风险]** 用户药品或报告特别多时摘要可能过长 → 已通过取最近 3 次报告、每份 30 项指标控制；若仍超限，`buildPatientContext` 可在末尾追加截断标记，AI 仍能基于部分数据回答
- **[病情数据泄露给 AI 服务的隐私风险]** 病情数据会发送到用户配置的 AI API → 通过设置开关 + 隐私提示文案让用户知情同意；默认开启但可随时关闭
- **[病情数据时效性]** 用户更新用药/指标后，下一次聊天才会反映最新数据 → 可接受，聊天是按需触发而非实时同步
- **[摘要格式与 AI 理解偏差]** 不同模型对中文病情摘要的理解能力不同 → 格式采用结构化列表 + 明确标记，主流模型（gpt-4o/glm-4）均能良好理解
