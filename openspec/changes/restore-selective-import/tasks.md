## 1. 导出改用应用层格式

- [x] 1.1 修改 `frontend/app.js` 的 `exportData` 函数（约第 2234 行）：将 `NurseDB.exportToJson()` 替换为 `NurseStorage.exportJSON()`，后续分享/下载逻辑不变。验证：导出备份文件，检查 JSON 含 records/orders/reports 等字段且图片为 dataUrl

## 2. 导入格式检测与分流

- [x] 2.1 修改 `frontend/app.js` 的 `importData` 函数（约第 2271 行）：解析 JSON 后检测格式——若含 `database` 和 `tables` 字段则为旧 SQLite 格式，走原有 `NurseDB.importFromJson` 全量导入路径；若含 `records`/`orders`/`reports`/`cabinet`/`consultChats`/`settings` 任一字段则为新应用层格式，存入 `pendingImportText` 并显示模块选择弹窗；否则提示"文件格式不正确"。验证：分别用新旧格式备份文件测试导入，确认旧格式全量导入、新格式弹选择窗

## 3. 恢复模块选择 UI 逻辑

- [x] 3.1 在 `frontend/app.js` 的 `importData` 中（新格式分支），解析备份内容检测包含哪些模块，动态生成勾选项 HTML 注入 `#import-list`，显示 `#import-modal`。模块列表：问诊记录(records)、药单(orders)、检查报告(reports)、药箱(cabinet)、AI聊天(consultChats)、个人设置(settings)，仅显示备份中非空的模块，默认全选。验证：导入新格式备份时弹窗显示，勾选项与备份内容匹配
- [x] 3.2 修改 `frontend/app.js` 的 `confirmImport` 函数（约第 2289 行）：从 `#import-list` 的 checkbox 收集 selection 对象，若全不选则提示"未勾选任何项"并取消；否则调用 `NurseStorage.importJSON(pendingImportText, selection)`，完成后重新加载 DATA（load + getRecords/getOrders/getReports/getConsultChats）并刷新界面（applySettingsUI + renderHome + renderRecords + renderCabinet）。验证：勾选部分模块导入后，未勾选模块数据不变，勾选模块数据被替换

## 4. 验证

- [ ] 4.1 验证"导出→导入往返"：导出备份 → 清空部分数据 → 全选导入 → 确认数据恢复一致（含图片）。验证：导入后图片可正常显示
- [ ] 4.2 验证"部分模块导入"：导出备份 → 勾选仅"问诊记录"导入 → 确认问诊记录恢复且药箱/报告等不变。验证：药箱数据与导入前一致
- [ ] 4.3 验证"旧格式兼容"：用旧 SQLite 格式备份导入 → 确认全量导入不弹选择窗。验证：旧格式备份正常导入
- [ ] 4.4 验证"关联数据自动导入"：备份中问诊记录关联药单 → 勾选仅"问诊记录"导入 → 确认关联药单也被导入。验证：导入的记录可正常查看关联药单
