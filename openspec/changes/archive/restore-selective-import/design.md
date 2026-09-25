## Context

当前导出用 `NurseDB.exportToJson()`（SQLite 表格式，不含图片内容），导入用 `NurseDB.importFromJson()`（全量覆盖）。`NurseStorage.exportJSON()` 和 `NurseStorage.importJSON(jsonStr, selection)` 已就绪且测试覆盖，前者输出应用层 JSON（含图片 dataUrl），后者支持 selection 按模块导入并处理关联数据（forceIds 逻辑）。`index.html:588-604` 的 `import-modal` 弹层 HTML 完整存在，仅 `app.js` 的 JS 逻辑在 SQLite 重构时被移除。

## Goals / Non-Goals

**Goals:**
- 恢复按模块勾选导入的 UI 和逻辑
- 新备份为应用层格式（含图片 dataUrl，可读性更好）
- 兼容旧 SQLite 格式备份全量导入

**Non-Goals:**
- 不改 `storage.js`（`exportJSON`/`importJSON` 已就绪）
- 不改 `index.html`（`import-modal` 弹层已存在）
- 不改 `db.js`（旧格式导入仍用 `NurseDB.importFromJson`）
- 不支持旧 SQLite 格式备份的按模块导入（格式转换复杂度高，旧备份走全量即可）

## Decisions

### 决策1：导出改用 `NurseStorage.exportJSON()`

`exportData` 函数中 `NurseDB.exportToJson()` 替换为 `NurseStorage.exportJSON()`。

**理由**：应用层格式含图片 dataUrl（SQLite 格式只存路径，恢复后图片可能丢失）；可读性好；天然支持 `importJSON` 的 selection。

**替代方案**：保持 SQLite 格式导出，导入时写 SQLite→应用层格式转换器。否决：转换器需反序列化 25 张表，复杂且易错。

### 决策2：导入时按格式分流

```
importData(file):
  解析 JSON
  if (有 database && tables 字段)  → 旧 SQLite 格式 → NurseDB.importFromJson 全量
  else if (有 records || orders || reports 等字段) → 新应用层格式 → 显示模块选择弹窗
  else → 格式不正确
```

**理由**：两种格式特征字段互斥，检测简单可靠。

### 决策3：模块选择复用现有 import-modal HTML

`import-modal`/`import-list`/`import-confirm` 元素已存在于 `index.html:588-604`。`importData` 解析备份后，动态生成勾选项注入 `import-list`，显示弹窗。`confirmImport` 收集勾选状态作为 selection 调用 `NurseStorage.importJSON`。

模块→selection key 映射：
| UI 标签 | selection key | 检测字段 |
|---|---|---|
| 问诊记录 | `records` | `backup.records` 非空数组 |
| 药单 | `orders` | `backup.orders` 非空数组 |
| 检查报告 | `reports` | `backup.reports` 非空数组 |
| 药箱 | `cabinet` | `backup.cabinet` 非空数组 |
| AI 聊天 | `consultChats` | `backup.consultChats` 非空数组 |
| 个人设置 | `settings` | `backup.settings` 存在 |

**理由**：复用现有 HTML 和 CSS，零 UI 改动。

### 决策4：导入后数据刷新

`confirmImport` 完成后重新 `NurseStorage.load()` + `getRecords/getOrders/getReports/getConsultChats` + `applySettingsUI()` + `renderHome/renderRecords/renderCabinet`，与现有逻辑一致。

## Risks / Trade-offs

- **[新备份无法在旧版 App 导入]** 新备份是应用层格式，旧版 App 期望 SQLite 格式 → 可接受，旧版会提示"格式不正确"，用户需升级 App
- **[应用层格式备份文件较大]** 图片以 dataUrl 内联，文件比 SQLite 格式大 → 可接受，dataUrl 是 base64 编码，膨胀约 33%，但保证了图片可恢复
- **[旧 SQLite 备份无法按模块导入]** 旧格式走全量导入，不支持选择 → 可接受，旧备份使用频率低，用户可先全量导入再手动删除不需要的
