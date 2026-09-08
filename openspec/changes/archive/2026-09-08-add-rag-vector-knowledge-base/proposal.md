## Why

当前倪海厦中医问诊通过 `tcm-skill.js` 向大模型注入一段约 4000+ tokens 的静态 Skill Prompt，每次对话都全量携带，成本高且无法随知识库扩充而扩展。同时 `engine.js` 中的病种/药物知识库以硬编码方式维护，后续扩充（数据集、PDF 等）缺乏统一的向量化与检索通道。引入端侧 RAG 向量知识库，可按用户问题动态检索最相关的知识片段（约 500-1500 tokens）注入 prompt，大幅降低 token 消耗并支持知识库持续扩充。

## What Changes

- **新增开发阶段知识库构建脚本**：从 nihaixia GitHub 仓库及 `engine.js` 提取文本，分块、用 `bge-small-zh-v1.5` 模型（512 维）生成向量，写入标准 SQLite 数据库 `.db` 文件
- **新增打包阶段静态资源放置**：将构建产物 `rag-knowledge.db` 放入 `frontend/assets/` 目录，随 app 一起发布
- **新增运行阶段数据库初始化**：APP 启动时通过 `@capacitor-community/sqlite` 插件将 assets 中的 `.db` 文件复制到设备本地沙盒存储区
- **新增端侧向量嵌入能力**：集成 Transformers.js（`@xenova/transformers`）加载 `bge-small-zh-v1.5` 模型，前端实时计算用户问题的 512 维 query_vector
- **新增向量检索能力**：从 SQLite 读取候选向量，纯 JS 计算余弦相似度排序，返回 top-k 相关知识片段
- **改造中医问诊 prompt 构建流程**：将 `tcm-skill.js` 精简为约 500 tokens 的核心规则兜底，RAG 检索结果拼接到核心规则后注入 system message
- **预留多知识源扩充接口**：支持后续以同样流程将数据集、PDF 等新知识源向量化并入同一 SQLite 知识库
- **新增依赖**：`@capacitor-community/sqlite`、`@xenova/transformers`

## Capabilities

### New Capabilities
- `rag-knowledge-base`: 端侧 RAG 向量知识库能力，覆盖知识源提取、分块向量化、SQLite 存储、打包发布、运行时复制初始化、端侧嵌入、向量检索、prompt 拼接的完整生命周期

### Modified Capabilities
- `ai-consult-chat`: 中医问诊的 system prompt 构建方式从静态全量注入改为"精简核心规则 + RAG 动态检索片段"拼接

## Impact

- **新增代码**：
  - `scripts/build-rag-db.py`（开发阶段知识库构建脚本）
  - `scripts/embeddings/`（嵌入模型下载与向量化工具）
  - `frontend/rag-db.js`（运行时 SQLite 管理与向量检索模块）
  - `frontend/rag-embed.js`（Transformers.js 端侧嵌入模块）
  - `frontend/assets/rag-knowledge.db`（构建产物静态数据库）
- **修改代码**：
  - `frontend/tcm-skill.js`：精简为约 500 tokens 核心规则
  - `frontend/tcm-ai.js`：prompt 构建流程接入 RAG 检索
  - `frontend/index.html`：加载新脚本
  - `package.json`：新增依赖
  - `capacitor.config.js`：配置 sqlite 插件
- **新增依赖**：`@capacitor-community/sqlite`、`@xenova/transformers`
- **构建产物体积**：`rag-knowledge.db` 预计 2-10MB；端侧嵌入模型 `bge-small-zh-v1.5` 约 100MB（首次下载缓存）
- **平台影响**：iOS/Android 均需通过 `@capacitor-community/sqlite` 的 assets 数据库复制机制初始化
