## Why

当前 AI 问诊依赖端侧 RAG 向量检索（Transformers.js + bge-small-zh-v1.5 + rag-knowledge.db）注入中医知识片段，架构重、启动慢、维护成本高。项目定位是慢性病健康管理（医嘱/用药提醒/护理任务/饮食禁忌/风险预警），不需要中医六经辨证专用知识。删掉 RAG 模块后用静态慢性病管理 prompt 替代，既简化架构又彻底解决 Transformers.js 导致的白屏问题。

## What Changes

- **删除 RAG 向量检索模块**：`rag-db.js`、`rag-embed.js`、`frontend/assets/databases/rag-knowledge.db`、`frontend/vendor/`（transformers.min.js + wasm）、`@xenova/transformers` 依赖、构建脚本 `scripts/build-rag-db.{js,py}`、`scripts/copy-vendor.js`
- **删除中医 Skill Prompt**：`tcm-skill.js`、`tcm-skill-full.js`
- **重构 tcm-ai.js → consult-ai.js**：`window.NurseTCM` → `window.NurseConsult`，chat() 不再依赖 RAG 检索，直接用静态慢性病管理 prompt 作为 system message
- **更新 consult-chat.js**：依赖从 `window.NurseTCM` 改为 `window.NurseConsult`，急危重症提示去中医化
- **更新 index.html**：移除 rag-embed.js/rag-db.js/tcm-skill.js/tcm-ai.js 的 `<script>` 标签，改为 consult-ai.js
- **更新测试**：`tests/rag-knowledge.test.js` 中 RAG 相关测试删除，保留 consult-ai 的 prompt 测试
- **清理 capacitor.config.js**：移除 RAG 相关配置（如有）
- **清理 db.js**：移除 RAG 知识库表（knowledge_chunks 等，如有）

## Capabilities

### New Capabilities
- `consult-ai`: AI 问诊对话能力，使用静态慢性病管理 prompt，不依赖向量检索

### Modified Capabilities
- `ai-consult-chat`: 问诊聊天的 AI 后端依赖从 NurseTCM 改为 NurseConsult，急危重症提示去中医化

### Removed Capabilities
- `rag-knowledge-base`: 端侧 RAG 向量知识库能力完全移除

## Impact

- 删除文件：`frontend/rag-db.js`、`frontend/rag-embed.js`、`frontend/tcm-skill.js`、`frontend/tcm-skill-full.js`、`frontend/tcm-ai.js`、`frontend/assets/databases/rag-knowledge.db`、`frontend/vendor/*`、`scripts/build-rag-db.js`、`scripts/build-rag-db.py`、`scripts/copy-vendor.js`、`tests/rag-knowledge.test.js`
- 新增文件：`frontend/consult-ai.js`、`tests/consult-ai.test.js`
- 修改文件：`frontend/index.html`、`frontend/consult-chat.js`、`package.json`、`capacitor.config.js`、`frontend/db.js`（移除 RAG 表）
- 依赖移除：`@xenova/transformers`
- 依赖保留：`@capacitor-community/sqlite`（主数据库仍用）
