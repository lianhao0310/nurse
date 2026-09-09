## Why

版本更新后用户历史数据被清空、更新前导出的备份文件也一并丢失。根因是当前所有个人数据（问诊记录、药单、药箱、检查报告、AI 聊天历史、设置）存于单个 `nurse-data.json` 文件且图片以 base64 内嵌，`_normalize` 归一化时对字段不匹配的实体静默丢弃；同时 iOS WKWebView localStorage 跨更新不保证持久化、卸载重装清空 Documents。迁移到 SQLite 原生数据库（App 正常更新时数据库文件保留）可从根本上消除版本更新丢数据问题。

## What Changes

- **新增 `nurse.db` SQLite 数据库**存储全部个人数据（records / orders / cabinet / reports / consultChats / settings / indicators），替代单 JSON 文件。数据库随 App 更新保留，不再因 `_normalize` 静默过滤丢数据。
- **图片改为 Filesystem 独立文件存储**，db 中只存相对路径。涉及 7 个 base64 字段：record.images / rxImages / examImages、order.images、report.images、consultChat.messages.images。录音功能已删除，不再考虑 advice.audio。
- **导出备份改为导出 `nurse.db` + `images/` 目录**到 Documents（iOS）/ DATA（Android），导入时从同一目录读取还原。RAG db（`rag-knowledge.db`）不导出。
- **导入时支持 schema 版本迁移**：db 内记录 `user_version`（PRAGMA user_version），导入后按版本号执行增量迁移（ALTER TABLE 加列 / 数据补全），确保跨版本导入不丢数据。
- **新增 `db.js` 模块**封装 `@capacitor-community/sqlite` 连接管理、建表、迁移、CRUD；**新增 `image-store.js` 模块**封装图片文件读写（Filesystem 二进制 + 路径生成）。
- **`storage.js` 重写**为 SQLite 之上的数据访问层，保持对外导出的函数签名不变（appendRecord / getRecords / saveConsultChat 等），上层 app.js / consult-chat.js 仅改图片处理方式。
- **Web 预览不持久化**：纯浏览器环境（无 Capacitor SQLite 原生插件）下数据驻留内存，刷新清空，仅用于 UI 预览。
- **BREAKING**：不自动从旧 `nurse-data.json` 迁移数据。用户升级到新版本前需手动导出旧数据为 JSON，升级后通过"导入备份"手动导入。后续版本更新不再丢数据。
- **删除旧 JSON 存储逻辑**：移除 nurse-data.json 读写、localStorage 双写兜底、`_normalize` 静默过滤、`_migrateCabinet` / `_migrateAIAdvice` 等基于字段存在性检测的迁移。

## Capabilities

### New Capabilities
- `personal-data-storage`: 个人数据 SQLite 持久化、图片文件存储、备份导出导入与 schema 版本迁移

### Modified Capabilities
- `ai-consult-chat`: 对话持久化需求从"Capacitor Filesystem JSON + localStorage 兜底"改为"SQLite 数据库"，图片从 base64 内嵌改为文件路径引用

## Impact

- **新增文件**：`frontend/db.js`（SQLite 连接/建表/迁移/CRUD 封装）、`frontend/image-store.js`（图片文件读写）
- **重写文件**：`frontend/storage.js`（改为 SQLite 数据访问层，保持对外 API 签名）
- **修改文件**：`frontend/app.js`（导出/导入逻辑、图片读写调用点）、`frontend/consult-chat.js`（聊天图片改文件存储）、`frontend/ai.js`（发送 AI 时图片从文件读取为 dataUrl）
- **不影响**：`frontend/rag-db.js` / `rag-embed.js`（RAG 独立 db，只读）、`frontend/engine.js`、`frontend/tcm-*.js`
- **依赖**：`@capacitor-community/sqlite` ^6.0.2 已有，无需新增
- **配置**：`capacitor.config.js` 已有 SQLite 插件配置，新增业务 db 连接复用同一插件
- **原生**：iOS/Android 无需额外配置，SQLite 数据库文件存于 `Library/CapacitorDatabase/`（iOS）/ 应用内部数据库目录（Android），App 正常更新保留
