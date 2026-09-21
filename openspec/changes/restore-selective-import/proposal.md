## Why

SQLite 重构（提交 `2d8b471`）时，导入备份从应用层 `NurseStorage.importJSON(text, selection)` 改为 SQLite 原生 `NurseDB.importFromJson(text)` 全量覆盖，丢失了按模块勾选导入的 UI 和逻辑。用户此前可以只导入问诊记录、或只导入药单等，现在只能全量覆盖。`storage.js` 的 `importJSON` 仍保留 `selection` 参数（测试覆盖），`index.html` 的 `import-modal` 弹层 HTML 也仍在，只是 `app.js` 的 JS 逻辑被移除了。

## What Changes

- 导出备份改用 `NurseStorage.exportJSON()`（应用层 JSON 格式，含图片 dataUrl），替代 `NurseDB.exportToJson()`（SQLite 表格式，不含图片内容）
- 导入时检测备份格式：
  - **应用层格式**（有 `records`/`orders` 等字段）→ 显示模块选择弹窗 → 按勾选调用 `NurseStorage.importJSON(text, selection)`
  - **SQLite 格式**（有 `database`/`tables` 字段，旧备份）→ 全量 `NurseDB.importFromJson`（向后兼容，不弹选择窗）
- 恢复 `app.js` 中模块选择 JS 逻辑，复用现有 `import-modal` HTML 弹层
- 模块选项：问诊记录、药单、检查报告、药箱、AI 聊天、个人设置（根据备份中实际包含的模块动态显示）

## Capabilities

### New Capabilities

- `data-backup-restore`: 备份导出与按模块选择性导入能力

### Modified Capabilities

（无）

## Impact

- `frontend/app.js`：`exportData` 改用 `NurseStorage.exportJSON`；`importData` 增加格式检测和模块选择逻辑；`confirmImport` 改用 `NurseStorage.importJSON` + selection
- `frontend/storage.js`：无改动（`exportJSON`/`importJSON` 已就绪）
- `frontend/index.html`：无改动（`import-modal` 弹层已存在）
- 备份格式变更：新备份为应用层 JSON（可读性更好、含图片），旧 SQLite 格式备份仍可全量导入
