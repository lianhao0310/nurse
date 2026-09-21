## Purpose

让用户将应用数据导出为备份文件，并在导入时按模块勾选需要恢复的内容，而非全量覆盖。

## ADDED Requirements

### Requirement: 导出备份
系统 SHALL 在设置页"数据"区域提供"导出备份"按钮，将应用全部数据（问诊记录、药单、检查报告、药箱、AI 聊天、个人设置、关注指标）导出为 JSON 文件，其中图片以 dataUrl 内联。导出格式为应用层 JSON（含 records/orders/reports/cabinet/consultChats/settings/followedIndicators/indicatorMeta 等字段）。

#### Scenario: 正常导出
- **WHEN** 用户点击"导出备份"按钮
- **THEN** 系统生成 JSON 备份文件并保存到设备（原生端通过分享，Web 端通过下载）

#### Scenario: 导出包含图片
- **WHEN** 问诊记录/药单/检查报告包含图片
- **THEN** 导出的 JSON 中图片以 dataUrl 形式内联，导入后可恢复图片

### Requirement: 按模块选择性导入
系统 SHALL 在导入备份时显示模块选择弹窗，用户可勾选需要导入的模块（问诊记录、药单、检查报告、药箱、AI 聊天、个人设置），未勾选的模块保持现有数据不变。弹窗中只显示备份文件中实际包含的模块。

#### Scenario: 选择部分模块导入
- **WHEN** 用户选择备份文件后，在弹窗中勾选"问诊记录"和"药单"，取消其他选项，点击"确定导入"
- **THEN** 系统仅导入问诊记录和药单数据，检查报告/药箱/AI聊天/设置保持不变

#### Scenario: 全选导入
- **WHEN** 用户在弹窗中勾选所有模块并确认
- **THEN** 系统导入备份中所有模块数据，效果等同于全量导入

#### Scenario: 全不选取消导入
- **WHEN** 用户在弹窗中取消所有勾选并点击"确定导入"
- **THEN** 系统提示"未勾选任何项"并取消导入，现有数据不变

#### Scenario: 关联数据自动导入
- **WHEN** 用户勾选"问诊记录"但未勾选"药单"，且备份中的问诊记录关联了药单
- **THEN** 系统自动导入关联的药单数据以保证数据完整性

### Requirement: 旧格式备份兼容
系统 SHALL 兼容旧版 SQLite 格式备份（含 database/tables 字段），导入时自动识别格式并全量导入，不显示模块选择弹窗。

#### Scenario: 导入旧 SQLite 格式备份
- **WHEN** 用户选择旧版 SQLite 格式备份文件（JSON 含 database 和 tables 字段）
- **THEN** 系统识别为旧格式，直接全量导入，不显示模块选择弹窗

#### Scenario: 导入新应用层格式备份
- **WHEN** 用户选择新版应用层格式备份文件（JSON 含 records/orders 等字段）
- **THEN** 系统识别为新格式，显示模块选择弹窗供用户勾选

### Requirement: 导入后刷新界面
系统 SHALL 在导入完成后自动刷新所有页面数据，确保界面显示与数据库一致。

#### Scenario: 导入后界面刷新
- **WHEN** 导入完成
- **THEN** 首页、问诊记录、药箱、设置等页面数据自动刷新，无需手动重启 App
