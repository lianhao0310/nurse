## Context

当前个人数据全部存于单 `nurse-data.json`（含 base64 图片），`storage.js` 通过 Capacitor Filesystem + localStorage 双写。`_normalize` 归一化时对字段不匹配的实体 `return null` 并 `filter(Boolean)` 静默丢弃，是版本更新丢数据的代码层根因。项目已集成 `@capacitor-community/sqlite` ^6.0.2（RAG 知识库 `rag-knowledge.db` 在用，见 `rag-db.js`），本设计复用该插件为业务数据新建独立 `nurse.db`。`storage.js` 对外导出 20+ 个 CRUD 函数（appendRecord / getRecords / upsertOrder / saveConsultChat 等），上层 `app.js` / `consult-chat.js` 依赖这些签名。

## Goals / Non-Goals

**Goals:**
- 个人数据存入 SQLite `nurse.db`，App 正常更新时数据库文件保留、数据不丢
- 图片存为 Filesystem 二进制文件，db 仅存相对路径，消除 base64 膨胀
- 备份导出 = db 文件 + images 目录到 Documents/DATA；导入 = 从目录还原
- 导入时按 `PRAGMA user_version` 执行增量 schema 迁移，不丢数据行
- `storage.js` 对外函数签名不变，上层改动最小化
- Web 预览内存模式，不持久化

**Non-Goals:**
- 不自动从旧 `nurse-data.json` 迁移（用户手动导出旧数据再导入）
- 不导出 RAG 知识库 `rag-knowledge.db`
- 不做云同步 / 跨设备同步
- 不为 web 预览实现持久化（sql.js / IndexedDB）
- 不恢复已删除的录音功能

## Decisions

### D1: 独立 `nurse.db`，与 `rag-knowledge.db` 分离

两个数据库独立连接、独立文件。RAG db 只读（copyFromAssets），业务 db 读写。避免读写业务数据时锁住 RAG 检索。

**备选**：合并为单 db 多表。否决：RAG db 随 App 打包全量替换，业务 db 必须跨更新保留，混在一起会导致 RAG 更新时业务数据被覆盖。

### D2: 表结构 — 规范化拆表，嵌套对象独立成表

核心实体一表一行，标量字段用独立列。所有可抽象为对象的嵌套结构（图片数组、药品列表、指标列表、AI 解析结果的 medications/tasks/risks/diseases/examResults/prescription、时间槽、标签等）拆为独立子表，通过外键关联。不再使用 `*_json` 列存数组/对象。

```
-- 问诊记录（主表）
records(id, created_at, visit_date, hospital, doctor, source, transcript,
        order_id, report_id, advice_text, ai_analysis, ai_analysis_at,
        manual, status, result_engine, result_summary, result_disclaimer, result_advice)
record_images(id, record_id, kind, path, name, type, sort_order)   -- kind: image/rx/exam
record_medications(id, record_id, name, dose, freq, time, note, disease, sort_order)
record_tasks(id, record_id, type, title, detail, freq, due, sort_order)
record_tags(id, record_id, kind, text, sort_order)                 -- kind: disease/taboo/diet
record_risks(id, record_id, trigger, level, action, disease, sort_order)
record_exam_results(id, record_id, name, value, unit, range, abnormal, sort_order)
record_prescriptions(id, record_id, name, spec, pack_count, sort_order)

-- 药单
orders(id, source, date, kind, record_id, ai_generated)
order_medicines(id, order_id, name, manufacturer, alias, spec, pack_count, qty, price, sort_order)
order_images(id, order_id, path, name, type, sort_order)

-- 药箱药品
cabinet_drugs(id, name, manufacturer, alias, unit, spec, qty, dose_amount,
              dose_unit, meal, threshold, status, note, disease)
cabinet_time_slots(id, drug_id, time, sort_order)

-- 检查报告
reports(id, title, date, kind, record_id, ai_generated)
report_indicators(id, report_id, name, value, unit, range, abnormal, sort_order)
report_images(id, report_id, path, name, type, sort_order)

-- AI 聊天
consult_chats(id, title, created_at, updated_at)
consult_messages(id, chat_id, role, content, ts, sort_order)
message_images(id, message_id, path, name, type, ocr_text, sort_order)

-- 设置
ai_settings(id, enabled, base_url, api_key, model)                 -- 单行
app_settings(key, value)                                            -- notifications/largeFont/reminderTimes_*/lastDecrement
reminders(id, title, type, date, time, enabled, note)

-- 每日打卡
daily_done(id, date, kind, ref_id, value)                           -- kind: med/task

-- 指标
indicator_meta(name, unit, range)
followed_indicators(name, unit, range)
```

共 24 张表。`PRAGMA user_version` 记录 schema 版本，初始为 1。所有子表带 `sort_order` 列保序。外键逻辑层维护（SQLite 外键约束默认关闭，按需 `PRAGMA foreign_keys=ON`）。

**备选**：用 `*_json` 列存嵌套（更少表）。否决：用户明确要求能抽象为对象的尽量独立成表；拆表后子表可独立索引/查询（如按药品名搜药单），且 schema 迁移时 ALTER TABLE 加列比改 JSON 结构更可控。

**备选**：全部 key-value 表（EAV）。否决：丢失类型约束与查询能力，迁移更难。

### D3: 图片存储路径与命名

- 目录：与 db 同级 `images/` 子目录（iOS `Documents/images/`，Android `DATA/images/`）
- 文件名：`{timestamp}-{rand6}.jpg`（避免重名，压缩后统一 JPEG）
- db 存相对路径：`images/{filename}`
- 读取：`Filesystem.readFile({ path, directory, encoding: undefined })` 返回 base64，前端拼 dataUrl 显示
- 删除记录时：查询对应图片子表（record_images / order_images / report_images / message_images）提取 path 列表，逐个 `Filesystem.deleteFile`

**备选**：用 Capacitor Camera takePhoto 直接存文件。否决：当前用 `<input type=file>` + canvas 压缩流程成熟，改为文件存储只需把压缩后 dataUrl 写入文件而非内嵌 JSON。

### D4: `storage.js` 保持对外 API，内部改 SQL + 新增分页查询

`load()` 仍存在用于初始化，但角色调整：只加载非列表数据（settings / cabinet_drugs / reminders / indicator_meta / followed_indicators / daily_done）到内存 `DATA` 对象，供 `app.js` 渲染。列表数据（records / orders / reports / consult_chats）改为分页按需加载，不再全量读入内存。

各细粒度 CRUD（appendRecord / updateRecord / deleteRecord / upsertOrder / saveConsultChat 等）改为直接执行 SQL（INSERT / UPDATE / DELETE），不再 load→改→save 全量往返。`save()` 保留但标记废弃（仅导入时全量替换用）。

**新增分页查询函数**（非 breaking，上层逐步采用）：
```
getRecordsPaged(keyword, page, pageSize)   → { rows, total, hasMore }
getOrdersPaged(keyword, page, pageSize)    → { rows, total, hasMore }
getReportsPaged(keyword, page, pageSize)   → { rows, total, hasMore }
getConsultChatsPaged(keyword, page, pageSize) → { rows, total, hasMore }
getCabinetDrugsPaged(keyword, page, pageSize) → { rows, total, hasMore }
```
每页默认 20 条。`rows` 为当前页数据（含子表 JOIN 组装），`total` 为搜索结果总数，`hasMore = (page*pageSize) < total`。keyword 为空时返回全部分页数据。

**备选**：全量 save 模式（每次 CRUD 都 DELETE ALL + INSERT ALL 一个事务）。否决：数据量增长后全量写性能差，且 SQLite 细粒度操作本就是优势。

### D5: Schema 迁移 — PRAGMA user_version + ALTER TABLE

启动时 `PRAGMA user_version` 读取当前版本，若低于 `APP_SCHEMA_VERSION` 则按顺序执行迁移函数。迁移手段以 `ALTER TABLE ADD COLUMN`（SQLite 原生支持，不重建表）为主，数据补全用 `UPDATE`。每个迁移函数幂等。迁移在一个事务内完成，失败则回滚并降级为空数据。

```
migrations = {
  1: () => { /* v0→v1: 初始建表 */ },
  2: () => { /* v1→v2: ALTER TABLE records ADD COLUMN new_field */ },
}
```

导入备份时：替换 db 文件后同样走迁移流程。

### D6: 导出/导入 — 目录复制，不打包

- **导出**：在 Documents/DATA 下创建 `nurse-backup-{timestamp}/`，复制 `nurse.db` → `nurse-backup-{ts}/nurse.db`，复制 `images/` → `nurse-backup-{ts}/images/`（递归）。用 Filesystem readdir + copyFile。
- **导入**：用户通过 `<input type=file webkitdirectory>` 或系统选择器选备份目录，读取其中的 `nurse.db` 替换当前 db，读取 `images/` 替换当前 images，关闭并重新 init db 连接 + 执行迁移 + 重新 load。

**备选**：zip 打包。否决：用户明确选择目录复制方式，且无需引入 zip 库。

### D7: Web 预览内存模式

`db.js` init 时检测 `window.Capacitor?.Plugins?.CapacitorSQLite` 是否可用。不可用则设 `_memoryMode = true`，`storage.js` 的 load 返回 `_empty()`，所有 CRUD 只改内存对象不落盘。刷新后内存清空。

### D8: 数据库连接生命周期

App 启动时 `db.init()` 建立连接并保持单例，全程复用同一连接（与 `rag-db.js` 模式一致）。App 退出或后台时不主动关闭（操作系统管理）。导入备份时先 `close()` 当前连接，替换文件后再 `init()`。

### D9: 索引设计

为支持列表搜索与分页排序的 5 张主表及其搜索关联子表建立索引：

```
-- 问诊记录：按就诊日期排序，模糊搜索 hospital/doctor/transcript
CREATE INDEX idx_records_visit_date ON records(visit_date DESC);
CREATE INDEX idx_records_created_at ON records(created_at DESC);

-- AI 聊天：按更新时间排序，模糊搜索 title
CREATE INDEX idx_chats_updated ON consult_chats(updated_at DESC);

-- 检查报告：按日期排序，模糊搜索 title
CREATE INDEX idx_reports_date ON reports(date DESC);

-- 药单：按日期排序，模糊搜索关联药品名
CREATE INDEX idx_orders_date ON orders(date DESC);
CREATE INDEX idx_order_med_order_id ON order_medicines(order_id);
CREATE INDEX idx_order_med_name ON order_medicines(name);

-- 药箱药品：按名称排序，模糊搜索 name/alias/manufacturer
CREATE INDEX idx_cabinet_name ON cabinet_drugs(name);
CREATE INDEX idx_cabinet_alias ON cabinet_drugs(alias);

-- 子表外键索引（加速 JOIN 组装）
CREATE INDEX idx_record_images_rid ON record_images(record_id);
CREATE INDEX idx_record_med_rid ON record_medications(record_id);
CREATE INDEX idx_record_tasks_rid ON record_tasks(record_id);
CREATE INDEX idx_record_tags_rid ON record_tags(record_id);
CREATE INDEX idx_record_risks_rid ON record_risks(record_id);
CREATE INDEX idx_record_exam_rid ON record_exam_results(record_id);
CREATE INDEX idx_record_rx_rid ON record_prescriptions(record_id);
CREATE INDEX idx_order_images_oid ON order_images(order_id);
CREATE INDEX idx_report_ind_rid ON report_indicators(report_id);
CREATE INDEX idx_report_images_rid ON report_images(report_id);
CREATE INDEX idx_msg_images_mid ON message_images(message_id);
CREATE INDEX idx_msgs_chat_id ON consult_messages(chat_id);
CREATE INDEX idx_cabinet_ts_did ON cabinet_time_slots(drug_id);
```

### D10: 搜索与分页查询

**搜索方式**：SQLite `LIKE '%keyword%'` 模糊匹配。数据量级为百至千条，LIKE 全表扫描性能可接受，无需 FTS5 全文检索的复杂度。

**各表搜索字段与 SQL**：
```
records:    WHERE hospital LIKE ? OR doctor LIKE ? OR transcript LIKE ?
            ORDER BY visit_date DESC LIMIT ? OFFSET ?
consult_chats: WHERE title LIKE ? ORDER BY updated_at DESC LIMIT ? OFFSET ?
reports:    WHERE title LIKE ? ORDER BY date DESC LIMIT ? OFFSET ?
orders:     SELECT DISTINCT o.* FROM orders o
            LEFT JOIN order_medicines m ON m.order_id = o.id
            WHERE m.name LIKE ? OR o.source LIKE ?
            ORDER BY o.date DESC LIMIT ? OFFSET ?
cabinet_drugs: WHERE name LIKE ? OR alias LIKE ? OR manufacturer LIKE ?
            ORDER BY name ASC LIMIT ? OFFSET ?
```

**分页**：`LIMIT pageSize OFFSET (page-1)*pageSize`，默认 pageSize=20。先 `SELECT COUNT(*)` 获取 total，再查当前页 rows。每页 rows 通过子表 JOIN 或批量查询组装完整对象（避免 N+1 查询：先查主表 page 条，再按主表 id 批量查子表 `WHERE record_id IN (...)`，内存分组组装）。

**前端**：列表页顶部新增搜索框（input + 防抖 300ms），输入触发 `get*Paged(keyword, 1, 20)` 重新加载首页。列表底部用 IntersectionObserver 监听滚动触底，触发 `get*Paged(keyword, page+1, 20)` 追加加载，`hasMore=false` 时停止并显示"没有更多"。

## Risks / Trade-offs

- **[风险] 用户未导出旧数据就升级 → 数据丢失** → 这是用户明确选择的方案。在升级引导文案中强提示"请先导出备份"，且首个新版本 release notes 醒目提醒。后续版本更新不再有此问题。
- **[风险] SQLite 导入替换文件时连接未关闭 → 文件锁** → 导入流程严格按 close → 等待 → 复制 → init 顺序，复制失败时保留原 db 不覆盖。
- **[风险] 图片文件孤儿（删除记录时删图片失败）** → 删除记录时先删 db 行再删图片文件，删图片失败仅记日志不影响记录删除；可后续加启动时清理孤儿文件的逻辑。
- **[权衡] 24 张表 JOIN 组装开销** → 查询列表时每条记录需关联多张子表。用批量 `WHERE id IN (...)` 替代逐条 JOIN 避免 N+1 查询，数据量级下可接受。
- **[权衡] LIKE '%keyword%' 全表扫描** → 数据量级百至千条，已建索引加速排序，搜索用 LIKE 可接受。若未来数据量增长到万级，可迁移到 FTS5 全文检索。

## Migration Plan

1. 实现 `db.js` + `image-store.js` + 重写 `storage.js`
2. 修改 `app.js` 导出/导入逻辑、图片读写调用点
3. 修改 `consult-chat.js` / `ai.js` 图片处理
4. 删除旧 JSON 存储代码（nurse-data.json 读写、localStorage 双写、`_normalize`、`_migrate*`）
5. 测试：原生端 CRUD、导出导入、跨版本迁移、图片存取、Web 预览内存模式
6. Release notes 醒目提醒用户先导出旧数据

**回滚策略**：若新版本出现严重问题，用户可用旧版本导出的 JSON 备份在旧版本恢复。新版本的 SQLite db 无法被旧版本读取，但旧 JSON 备份格式不变。

## Open Questions

- 导入备份时用户如何选择目录？iOS 可用 `DocumentPicker`（需新增插件）或引导用户通过"文件"App 选中 db 文件后自动定位同目录 images。此为实现细节，可在 tasks 阶段确定，不改变 spec 行为。
