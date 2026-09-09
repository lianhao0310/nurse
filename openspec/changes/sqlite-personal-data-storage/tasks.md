## 1. SQLite 基础设施 (db.js)

- [x] 1.1 创建 `frontend/db.js`，实现连接管理：`init()`（createConnection + open，复用 `@capacitor-community/sqlite`，参考 `rag-db.js` 模式）、`close()`、`query(stmt, values)`、`run(stmt, values)` 单例连接。验证：App 启动调用 `db.init()` 成功，`query("SELECT 1")` 返回 `[{1:1}]`
- [x] 1.2 实现建表 SQL（24 张表，含主表与子表，字段见 design.md D2）+ 全部索引（见 design.md D9），执行后 `PRAGMA user_version = 1`。验证：`sqlite3 nurse.db .schema` 输出全部 24 张表与索引
- [x] 1.3 实现 schema 迁移框架：读取 `PRAGMA user_version`，低于 `APP_SCHEMA_VERSION` 时按序执行迁移函数（`ALTER TABLE ADD COLUMN` / `UPDATE` 补全），单事务，失败回滚。验证：手动设 `user_version=0` 后重启，迁移到 1 且数据行不丢
- [x] 1.4 实现初始化失败降级：`init()` 异常时记日志、设 `_memoryMode=true`、不抛错。验证：模拟 SQLite 插件不可用时 App 正常启动显示空数据

## 2. 图片文件存储 (image-store.js)

- [x] 2.1 创建 `frontend/image-store.js`，实现 `saveImage(dataUrl)` → 写二进制文件到 `images/{ts}-{rand}.jpg`，返回相对路径；`readImage(path)` → Filesystem.readFile 返回 dataUrl；`deleteImage(path)` / `deleteImages(paths[])`。验证：saveImage 后 readImage 返回相同图片，deleteImage 后文件不存在
- [x] 2.2 图片目录与 db 同级（iOS Documents/images/，Android DATA/images/），路径生成避免重名。验证：连续保存 100 张图片文件名无冲突

## 3. storage.js 重写

- [x] 3.1 重写 `load()`：只加载非列表数据（ai_settings / app_settings / cabinet_drugs+cabinet_time_slots / reminders / indicator_meta / followed_indicators / daily_done）到内存 `DATA` 对象，列表数据（records / orders / reports / consult_chats）改为分页按需加载不在此读取。验证：load() 返回设置/药箱/提醒等数据，records 数组为空待分页填充
- [x] 3.2 重写问诊记录 CRUD（appendRecord / getRecord / updateRecord / deleteRecord）为 SQL 操作主表 records + 7 张子表（record_images/medications/tasks/tags/risks/exam_results/prescriptions），图片经 image-store 存取，deleteRecord 时级联删子表数据与图片文件。验证：增删改查后数据一致（含子表），删除记录后子表与图片不残留
- [x] 3.3 重写药单 CRUD（getOrders / getOrder / upsertOrder / updateOrder / deleteOrder）为 SQL + 图片文件操作。验证：同 3.2
- [x] 3.4 重写药箱 CRUD（getCabinetDrugs / upsertCabinetDrug / updateCabinetDrug / deleteCabinetDrug）为 SQL。验证：增删改查后数据一致
- [x] 3.5 重写检查报告 CRUD（getReports / getReport / upsertReport / updateReport / deleteReport）为 SQL + 图片文件操作。验证：同 3.2
- [x] 3.6 重写 AI 聊天历史 CRUD（getConsultChats / getConsultChat / saveConsultChat / deleteConsultChat / newConsultChat）为 SQL + 图片文件操作。验证：新建/续聊/删除对话后数据与图片一致
- [x] 3.7 重写设置/打卡/提醒/指标读写（updateSettings / getDone / setDone / setFollowedIndicators / setIndicatorMeta / setLastDecrement）为 SQL。验证：设置变更后重启恢复
- [x] 3.8 实现分页查询函数（getRecordsPaged / getOrdersPaged / getReportsPaged / getConsultChatsPaged / getCabinetDrugsPaged）：LIKE 模糊搜索 + LIMIT/OFFSET 分页 + COUNT 总数 + 子表批量 `WHERE id IN (...)` 组装避免 N+1。验证：keyword 过滤正确，分页边界正确，hasMore 计算正确
- [x] 3.9 实现 Web 预览内存模式：无 Capacitor SQLite 插件时 load 返回 `_empty()`，所有 CRUD 只改内存对象。验证：浏览器中操作数据后刷新，数据清空
- [x] 3.10 删除旧 JSON 存储代码：nurse-data.json 读写、localStorage 双写、`_normalize`、`_norm*`、`_migrateCabinet`、`_migrateAIAdvice`、FILE_NAME / LS_KEY 常量。验证：grep 确认无残留引用，App 功能正常

## 4. 上层适配

- [x] 4.1 修改 `app.js` 图片读写调用点：`addImagesToDraft` / `saveRecordEdit` 中图片经 image-store 存为文件，draft 中暂存 dataUrl 供预览，保存时转文件路径。验证：新增问诊记录含图片后，db 中 images_json 为路径非 base64
- [x] 4.2 修改 `consult-chat.js` 聊天图片处理：发送时图片经 image-store 存文件，消息存路径；展示时 readImage 转 dataUrl。验证：聊天发送图片后重启，图片正常显示
- [x] 4.3 修改 `ai.js` 发送 AI 时图片处理：从文件路径读取为 dataUrl 拼请求（vision 模型需要 base64）。验证：含图片的 AI 请求正常发送
- [x] 4.4 列表页新增搜索框（问诊记录/聊天/报告/药单/药箱）：input + 300ms 防抖，输入触发对应 `get*Paged(keyword, 1, 20)` 重新加载首页。验证：输入关键字后列表过滤为匹配结果，清空关键字恢复全部
- [x] 4.5 列表页实现下拉加载更多：IntersectionObserver 监听列表底部触底，触发 `get*Paged(keyword, page+1, 20)` 追加，hasMore=false 时停止并提示"没有更多"。验证：滚动到底部自动加载下一页，数据量大时分页正确追加

## 5. 备份导出/导入

- [x] 5.1 实现导出备份：在 Documents/DATA 下创建 `nurse-backup-{ts}/`，Filesystem 复制 `nurse.db` + 递归复制 `images/`。验证：导出后目录含 nurse.db 和 images/ 子目录，RAG db 不在其中
- [x] 5.2 实现导入备份：用户选择备份目录，close 当前 db 连接 → 复制备份数据库替换当前 → 复制 images 替换当前 → 重新 init + 迁移 + load。导入前提示覆盖。验证：导入后数据与图片完整恢复，跨版本备份导入时迁移生效
- [x] 5.3 修改 `app.js` 导出/导入按钮绑定与 UI：导出提示备份目录位置，导入支持选择目录/文件。验证：设置页导出/导入按钮功能正常

## 6. 集成验证

- [ ] 6.1 原生端完整流程验证：新增问诊记录(含图片) → 新建药单 → AI 聊天(含图片) → 杀进程重启 → 全部数据与图片恢复。验证：无数据丢失
- [ ] 6.2 导出→导入闭环验证：产生数据后导出 → 清空（卸载重装或删 db）→ 导入 → 数据完整。验证：记录、图片、聊天历史全部恢复
- [ ] 6.3 跨版本 schema 迁移验证：构造旧版本 db（缺列）→ 导入 → 迁移补列 → 数据行不丢。验证：迁移后 App 功能正常
- [ ] 6.4 Web 预览验证：浏览器中操作各功能 → 刷新 → 数据清空、无报错。验证：控制台无 SQLite 相关错误
- [ ] 6.5 版本更新数据保留验证：装旧版产生数据 → 覆盖安装新版（不卸载）→ 数据完整。验证：这是核心目标，必须通过
- [ ] 6.6 搜索与分页验证：各列表页输入关键字搜索结果正确 → 滚动加载更多分页正确 → 搜索+分页组合正确 → 空关键字恢复全部。验证：5 个列表页搜索分页功能均正常
