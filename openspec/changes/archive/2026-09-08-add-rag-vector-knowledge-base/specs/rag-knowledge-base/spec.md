## Purpose

提供端侧 RAG 向量知识库能力，将倪海厦中医知识及病种/药物知识库向量化存储于 SQLite，运行时按用户问题动态检索相关片段注入大模型 prompt，降低 token 消耗并支持知识库持续扩充。

## ADDED Requirements

### Requirement: 知识库构建（开发阶段）
系统 SHALL 在开发阶段提供构建脚本，从配置的知识源（nihaixia GitHub 仓库、engine.js 知识库）提取文本，按策略分块，使用 `bge-small-zh-v1.5` 模型生成 512 维向量，写入标准 SQLite 数据库文件。

#### Scenario: 从 nihaixia 仓库构建
- **WHEN** 开发者执行构建脚本并指定 nihaixia 仓库作为知识源
- **THEN** 脚本拉取仓库指定目录的 Markdown 文档，分块并向量化，将文本块与向量存入 SQLite 的 knowledge_chunks 表

#### Scenario: 从 engine.js 知识库构建
- **WHEN** 开发者执行构建脚本并指定 engine.js 作为知识源
- **THEN** 脚本解析病种知识库与药物词典，按病种/药物结构化分块并向量化，存入同一 SQLite 数据库

#### Scenario: 增量重建
- **WHEN** 知识源内容更新后开发者重新执行构建脚本
- **THEN** 脚本清空旧数据并重新全量构建生成新的 `.db` 文件，构建过程产出可追溯的日志

### Requirement: 静态数据库打包发布
系统 SHALL 将构建产物 `rag-knowledge.db` 放置在 `frontend/assets/` 目录，作为静态资源随 app 一起打包发布到 iOS/Android。

#### Scenario: 打包包含数据库
- **WHEN** 执行 app 打包流程
- **THEN** `frontend/assets/rag-knowledge.db` 文件被包含在最终产物中，iOS 与 Android 产物均可访问该文件

### Requirement: 运行时数据库初始化
系统 SHALL 在 APP 启动时通过 `@capacitor-community/sqlite` 插件将 assets 中的 `.db` 文件复制到设备本地沙盒存储区，并建立可读写的数据库连接。

#### Scenario: 首次启动复制数据库
- **WHEN** APP 首次启动且沙盒中不存在 `rag-knowledge.db`
- **THEN** 系统从 assets 复制数据库文件到沙盒存储区，复制完成后建立数据库连接

#### Scenario: 非首次启动直接连接
- **WHEN** APP 启动且沙盒中已存在 `rag-knowledge.db`
- **THEN** 系统跳过复制步骤，直接建立数据库连接

#### Scenario: 数据库初始化失败降级
- **WHEN** 数据库复制或连接失败
- **THEN** 系统记录错误日志，中医问诊降级为仅使用精简核心规则 prompt，不阻塞 app 启动

### Requirement: 端侧向量嵌入
系统 SHALL 集成 Transformers.js 加载 `bge-small-zh-v1.5` 模型，在前端实时将用户问题文本转换为 512 维向量。

#### Scenario: 首次嵌入加载模型
- **WHEN** 用户首次发起中医问诊提问
- **THEN** 系统加载 `bge-small-zh-v1.5` 模型（首次从远程下载并缓存），将用户问题转换为 512 维浮点向量

#### Scenario: 后续嵌入复用模型
- **WHEN** 模型已加载后用户再次提问
- **THEN** 系统复用已加载模型实例，直接将问题转换为 512 维向量，不重复加载

#### Scenario: 嵌入失败降级
- **WHEN** 模型加载或向量计算失败
- **THEN** 系统记录错误，中医问诊降级为仅使用精简核心规则 prompt，不中断用户提问

### Requirement: 向量检索
系统 SHALL 以用户问题的 query_vector 对知识库进行余弦相似度检索，返回 top-k 最相关的知识片段。

#### Scenario: 正常检索返回相关片段
- **WHEN** 用户提问且向量嵌入与数据库连接均就绪
- **THEN** 系统从 SQLite 读取知识块向量，计算与 query_vector 的余弦相似度，返回相似度最高的 top-k（默认 k=5）片段及其元数据

#### Scenario: 检索结果按相似度排序
- **WHEN** 检索返回多个片段
- **THEN** 返回片段按相似度从高到低排序，每条片段包含文本内容、来源、相似度得分

#### Scenario: 空数据库检索返回空
- **WHEN** 知识库为空时执行检索
- **THEN** 系统返回空结果集，不抛出异常

### Requirement: Prompt 动态拼接
系统 SHALL 将精简核心规则（约 500 tokens）与 RAG 检索结果片段拼接，构建为 system message 注入大模型对话。

#### Scenario: RAG 检索成功拼接
- **WHEN** RAG 检索返回非空结果
- **THEN** system message 由"精简核心规则 + 检索片段拼接"组成，检索片段以结构化格式标注来源，总 token 数显著低于原全量 prompt

#### Scenario: RAG 检索失败仅用核心规则
- **WHEN** RAG 检索返回空结果或检索过程失败
- **THEN** system message 仅包含精简核心规则，问诊功能不中断

### Requirement: 多知识源扩充预留
系统 SHALL 预留知识源扩充接口，支持后续将数据集、PDF 等新知识源以同样流程向量化并入同一 SQLite 知识库。

#### Scenario: 新增知识源类型
- **WHEN** 后续需要接入新的知识源类型（如 PDF、数据集）
- **THEN** 系统通过实现知识源提取接口（文本提取 → 分块 → 向量化 → 写入 SQLite）即可将新知识并入现有知识库，无需改动运行时检索与 prompt 拼接逻辑

#### Scenario: 知识源元数据可追溯
- **WHEN** 检索返回知识片段
- **THEN** 每条片段携带来源类型、来源路径、分块序号等元数据，支持追溯知识来源
