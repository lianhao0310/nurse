## Context

当前 AI 问诊依赖 RAG 向量检索（Transformers.js + bge-small-zh-v1.5 + rag-knowledge.db）注入中医知识。项目定位是慢性病健康管理，不需要中医辨证专用知识。删掉 RAG 后用静态 prompt 替代，简化架构并消除 Transformers.js 白屏问题。

现有代码关键位置：
- `frontend/tcm-ai.js` — 中医问诊对话，chat() 依赖 RAG 检索构建 system prompt
- `frontend/tcm-skill.js` — 精简中医 prompt（~500 tokens）
- `frontend/tcm-skill-full.js` — 完整中医 prompt（备份）
- `frontend/rag-embed.js` — Transformers.js 端侧嵌入
- `frontend/rag-db.js` — SQLite 向量检索
- `frontend/consult-chat.js` — 依赖 `window.NurseTCM`
- `frontend/index.html:607-611` — 加载 transformers CDN + rag-embed + rag-db + tcm-skill + tcm-ai
- `tests/rag-knowledge.test.js` — RAG + 中医 prompt 测试

## Goals / Non-Goals

**Goals:**
- 完全移除 RAG 模块和 Transformers.js 依赖
- 移除中医 Skill Prompt
- 用静态慢性病管理 prompt 替代
- tcm-ai.js → consult-ai.js（window.NurseTCM → window.NurseConsult）

**Non-Goals:**
- 不改 consult-chat.js 的 UI/交互逻辑（仅改 AI 后端依赖）
- 不改 app.js 中医嘱分析/药单分析/报告分析的 AI 调用（它们用 NurseAI，不经过 RAG）
- 不保留 RAG 的任何残留代码

## Decisions

### D1: 静态慢性病管理 prompt 内容

**方案**：基于项目定位（医嘱/用药提醒/护理任务/饮食禁忌/风险预警）生成通用慢性病管理 prompt，约 300-400 tokens。覆盖：
- 角色定位：慢性病健康管理助手
- 核心能力：医嘱解读、用药指导、饮食禁忌、风险预警、生活方式建议
- 安全边界：急危重症立即就医、不出具体剂量、不替代医疗诊断
- 回复要求：简体中文、口语化、不确定时如实说明、末尾免责提醒

**不包含**：六经辨证、倪海厦、特定病种硬编码、经方/药性/脉舌等中医内容。

### D2: consult-ai.js 接口设计

**方案**：保持与 tcm-ai.js 相同的接口（isConfigured、getConfig、chat），便于 consult-chat.js 无缝切换。导出 `GENERAL_SKILL_PROMPT` 常量供测试。chat() 内部直接用 `GENERAL_SKILL_PROMPT` 作为 system message，不再调用 RAG 检索。

### D3: 测试策略

**方案**：删除 `tests/rag-knowledge.test.js`，新建 `tests/consult-ai.test.js` 测试 prompt 内容、isConfigured、chat 接口。从 `package.json` 的 test 脚本中替换测试文件引用。

## Risks / Trade-offs

- **[知识覆盖面降低]** 静态 prompt 无法动态注入特定药品/病种知识 → 可接受，AI 模型本身具备通用医学知识，prompt 只需定位角色和安全边界
- **[rag-knowledge.db 构建工作浪费]** 之前构建的 328 chunk 知识库被删除 → 可接受，项目定位已不需要中医知识
