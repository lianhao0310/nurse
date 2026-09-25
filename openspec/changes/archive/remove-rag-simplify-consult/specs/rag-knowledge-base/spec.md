## REMOVED Requirements

### Requirement: 知识库构建（开发阶段）
**Reason**: RAG 向量检索模块完全移除，不再需要构建脚本生成 rag-knowledge.db
**Migration**: 无需迁移，知识库文件和构建脚本直接删除

### Requirement: 静态数据库打包发布
**Reason**: rag-knowledge.db 不再随包发布
**Migration**: 删除 frontend/assets/databases/rag-knowledge.db

### Requirement: 运行时数据库初始化
**Reason**: 不再在运行时初始化 RAG 知识库连接
**Migration**: 删除 rag-db.js

### Requirement: 端侧向量嵌入
**Reason**: 不再使用 Transformers.js 进行端侧向量嵌入
**Migration**: 删除 rag-embed.js、@xenova/transformers 依赖、frontend/vendor/

### Requirement: 向量检索
**Reason**: 不再进行向量检索
**Migration**: 无需迁移

### Requirement: Prompt 动态拼接
**Reason**: 改为静态慢性病管理 prompt，不再动态拼接 RAG 检索片段
**Migration**: consult-ai.js 直接使用 GENERAL_SKILL_PROMPT

### Requirement: 多知识源扩充预留
**Reason**: RAG 模块移除，知识源扩充接口不再需要
**Migration**: 无需迁移
