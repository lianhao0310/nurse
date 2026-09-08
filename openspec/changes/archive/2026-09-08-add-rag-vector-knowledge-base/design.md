## Context

当前中医问诊通过 `frontend/tcm-skill.js` 导出一段约 4000+ tokens 的静态 `TCM_SKILL_PROMPT` 字符串，`frontend/tcm-ai.js` 将其作为 system message 全量注入每次对话。知识来源为 nihaixia 仓库的蒸馏速查层 Markdown（六经辨证公式、临床经验）与 `SKILL.md` 角色规则。`frontend/engine.js` 中以 JS 对象硬编码维护了 6 个病种与 14 种药物的知识库。项目为 Capacitor 6 混合应用，前端为纯静态资源（无构建步骤），iOS/Android 通过 WebView 加载 `frontend/` 目录。现有依赖不含 SQLite 与 Transformers.js。

约束：
- 前端为纯静态资源，无构建步骤（Capacitor 直接复制 `frontend/`）
- 需同时支持 iOS 与 Android
- 离线优先，但嵌入模型首次需联网下载
- 知识库规模为中小型（预计 < 1 万条 chunk）

## Goals / Non-Goals

**Goals:**
- 将中医知识从静态全量 prompt 注入改为 RAG 动态检索注入，单次对话 system message token 数从 4000+ 降至 1000-2000
- 建立可复用的端侧 RAG 基础设施，支持后续多知识源（PDF、数据集）扩充
- 全端一致行为：iOS/Android/Web 三端检索逻辑统一
- 保留精简核心规则作为 RAG 失败时的兜底，确保问诊功能不中断

**Non-Goals:**
- 不实现知识库的在线更新（本期 db 随 app 发布，后续版本再考虑 OTA 更新）
- 不实现用户自定义知识库上传
- 不实现向量检索的原生扩展加速（sqlite-vec 等），纯 JS 余弦相似度满足中小规模需求
- 不改动西医医嘱解析引擎（`engine.js` 的解析逻辑不变，仅其知识库内容作为 RAG 知识源之一）
- 不实现多语言嵌入模型切换（本期固定 `bge-small-zh-v1.5`）

## Decisions

### 决策 1：嵌入模型选择 `bge-small-zh-v1.5`（512 维）
**选择**：Xenova/bge-small-zh-v1.5，512 维，中文专用。
**理由**：倪海厦中医知识库为中文文本，中文专用模型语义匹配质量显著优于 multilingual/英文模型。512 维虽高于用户初始设想的 384 维，但检索质量优先，且模型体积（约 100MB）与推理速度在端侧可接受。
**备选**：
- `paraphrase-multilingual-MiniLM-L12-v2`（384 维，多语言）：中文质量不如 bge-zh
- `all-MiniLM-L6-v2`（384 维，英文为主）：中文支持弱，不适用
**影响**：向量维度常量 `EMBEDDING_DIM = 512`，SQLite schema 中向量 blob 大小按 512 维设计。

### 决策 2：向量检索采用纯 JS 余弦相似度
**选择**：SQLite 存储向量为 BLOB（Float32Array 序列化），前端 JS 取出候选集后计算余弦相似度排序。
**理由**：`@capacitor-community/sqlite` 不原生支持向量扩展，纯 JS 方案无需各平台编译原生扩展，全端行为一致。中小规模知识库（< 1 万条）下 JS 计算性能可接受（单次检索 < 50ms）。
**备选**：
- `sqlite-vec` 扩展：性能更好但需 iOS/Android 分别编译原生扩展，Capacitor 集成复杂度高
- 混合预过滤：增加复杂度但当前规模无必要
**优化**：可按 `source_type` 先 SQL 过滤候选集（如中医问诊只检索 `source_type IN ('tcm', 'disease')`），减少 JS 计算量。

### 决策 3：Prompt 构建 = 精简核心规则 + RAG 检索片段
**选择**：`tcm-skill.js` 精简为约 500 tokens 的核心规则（六经辨证总纲、回复要求、安全边界），RAG 检索 top-5 片段以结构化格式拼接其后。
**理由**：核心规则保证 AI 角色与回复风格稳定，RAG 片段提供具体经方/药性/心法等细节知识。RAG 失败时仍有兜底。
**备选**：
- 完全替换为 RAG：token 节省最大化但 RAG 失败时无兜底，风险高
- 保留完整 prompt + RAG 叠加：最安全但 token 节省效果弱
**拼接格式**：
```
{精简核心规则}

【相关知识】
[1] (来源: nihaixia/六经辨证) {chunk_text}
[2] (来源: engine.js/病种:高血压) {chunk_text}
...
```

### 决策 4：SQLite Schema 设计
```sql
CREATE TABLE knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,      -- 'tcm' | 'disease' | 'medication' | 'pdf' | 'dataset'
  source_path TEXT NOT NULL,      -- 来源文件路径或标识
  chunk_index INTEGER NOT NULL,   -- 同一来源内的分块序号
  title TEXT,                     -- 知识条目标题（如病种名、方剂名）
  text TEXT NOT NULL,             -- 分块文本内容
  embedding BLOB NOT NULL,        -- 512维向量，Float32Array序列化
  dim INTEGER NOT NULL,           -- 向量维度（冗余存储，校验用）
  created_at TEXT NOT NULL
);
CREATE INDEX idx_source_type ON knowledge_chunks(source_type);
```
**理由**：`source_type` 索引支持候选集预过滤；`embedding` 以 BLOB 存储 Float32Array 的 ArrayBuffer，读取后 `new Float32Array(blob)` 零拷贝还原；`dim` 冗余存储便于运行时校验向量维度一致性。

### 决策 5：分块策略
- **nihaixia Markdown**：按 Markdown 二级标题（`##`）分块，单块超过 500 字时按段落二次切分，保留标题作为 `title` 字段
- **engine.js 病种**：每个病种作为一个 chunk，`title` 为病种名，`text` 包含 keywords/taboo/diet/monitor/risk 拼接文本
- **engine.js 药物**：每种药物作为一个 chunk，`title` 为药物标准名，`text` 包含名称/别名/对应病种
**理由**：按语义边界分块优于固定长度切分，保证每块知识完整。中医文档的 `##` 标题天然对应知识主题。

### 决策 6：Transformers.js 集成方式
**选择**：通过 `<script>` 标签加载 Transformers.js 的 UMD 构建产物（或 CDN），使用 `Xenova/bge-small-zh-v1.5` 模型仓库。
**理由**：前端为纯静态资源无构建步骤，采用 UMD/CDN 方式与现有 `tcm-skill.js`、`ai.js` 加载方式一致。模型首次从 HuggingFace CDN 下载并缓存到 IndexedDB / Cache Storage，后续离线可用。
**备选**：引入 npm 依赖 + 打包工具 → 与当前"无构建步骤"约束冲突
**注意**：需确认 Transformers.js 在 iOS/Android WebView 中的兼容性（WebAssembly、Web Worker 支持）。

### 决策 7：`@capacitor-community/sqlite` Assets 数据库复制
**选择**：使用 `@capacitor-community/sqlite` 的 `copyFromAssets()` 方法将 `frontend/assets/rag-knowledge.db` 复制到沙盒。
**理由**：该插件提供原生 assets 数据库复制能力，自动处理 iOS/Android 的资源路径差异与沙盒权限。
**配置**：`capacitor.config.js` 中配置插件，assets 目录下放置 `.db` 文件，插件启动时自动复制同名数据库到沙盒可读写区。

### 决策 8：构建脚本用 Python
**选择**：`scripts/build-rag-db.py`，使用 Python + `sentence-transformers`（或 `onnxruntime` + bge 模型）生成向量，`sqlite3` 写入数据库。
**理由**：项目已有 Python 脚本惯例（`.set_secret.py`、`requirements.txt`），Python 生态的嵌入模型库成熟。构建脚本在开发阶段运行，不进入 app 产物。
**备选**：Node.js 构建脚本 → Transformers.js 在 Node 中也可用，但 Python 的 `sentence-transformers` 对 bge 模型支持更成熟。

## Risks / Trade-offs

- **[Transformers.js WebView 兼容性]** iOS/Android WebView 对 WebAssembly 与 Web Worker 的支持可能存在限制 → 需在真机早期验证；若不兼容则降级为预计算 query 向量（不可行，用户问题动态）或改用原生插件嵌入
- **[嵌入模型体积]** `bge-small-zh-v1.5` 约 100MB，首次下载耗时且耗流量 → 模型从 CDN 下载并缓存，后续离线可用；在 UI 上提示"首次问诊需加载知识模型"
- **[检索延迟]** 纯 JS 余弦相似度在万级 chunk 下单次检索约 50-100ms → 可接受；若后续知识库扩大可引入预过滤或量化
- **[知识库版本与 app 版本耦合]** db 随 app 发布，知识库更新需发新版 app → 本期接受，后续可考虑 OTA 更新 db 文件
- **[RAG 检索质量]** 向量检索可能召回语义相关但临床不切题的片段 → 通过 `source_type` 预过滤 + top-k 控制范围，核心规则兜底保证回复风格
- **[精简核心规则设计]** 从 4000+ tokens 精简到 500 tokens 可能丢失关键规则 → 保留六经辨证总纲、回复要求、安全边界等不可妥协的核心，细节知识交由 RAG

## Migration Plan

1. **新增构建脚本与依赖**：不改动现有运行时，先实现 `scripts/build-rag-db.py` 并产出 `rag-knowledge.db`
2. **新增前端 RAG 模块**：`rag-embed.js`、`rag-db.js`，独立于现有代码，可单独测试
3. **改造 prompt 构建**：精简 `tcm-skill.js`，修改 `tcm-ai.js` 接入 RAG；保留完整原 prompt 作为注释或 `tcm-skill-full.js` 备份便于回滚
4. **真机验证**：在 iOS/Android 真机验证 Transformers.js 与 SQLite 插件可用性后再合并
5. **回滚策略**：若 RAG 不可用，`tcm-ai.js` 的降级逻辑自动回退到仅使用精简核心规则；若需完全回滚，恢复 `tcm-skill.js` 原始内容即可

## Open Questions

- Transformers.js 在 iOS WKWebView 与 Android WebView 中的 WebAssembly/Web Worker 兼容性需真机验证（可在实现阶段早期 spike）
- `@capacitor-community/sqlite` 的 `copyFromAssets()` 对 `frontend/assets/` 路径的具体配置方式需查阅插件文档确认（Capacitor 6 版本）
- nihaixia 仓库的具体目录结构与 Markdown 格式需在构建脚本实现时确认（proposal 中引用的 `references/distilled/` 路径）
