## Purpose

将 AI 医嘱分析结果直接嵌入问诊记录，作为问诊内容的一部分，不再独立放置首页 AI 医嘱页面。问诊记录列表卡片显示分析摘要，用户可在记录详情中查看完整分析。

## ADDED Requirements

### Requirement: 医嘱分析结果存入问诊记录
系统 SHALL 将 AI 医嘱分析生成的结果直接存入对应问诊记录的 aiAnalysis 字段，不再单独存储到首页 AI 医嘱区域。

#### Scenario: 生成分析后存入记录
- **WHEN** 用户在问诊记录详情页点击"医嘱分析"且 AI 生成完成
- **THEN** 分析结果存入该记录的 aiAnalysis 字段，记录的 updatedAt 更新

#### Scenario: 重新分析覆盖旧结果
- **WHEN** 用户对已有 aiAnalysis 的记录再次点击"医嘱分析"
- **THEN** 新分析结果覆盖旧结果，提示"已更新分析"

### Requirement: 问诊记录卡片显示分析摘要
系统 SHALL 在问诊记录列表卡片中显示 AI 分析结果的摘要，使用户无需进入详情即可了解分析结论。

#### Scenario: 有分析结果的卡片
- **WHEN** 问诊记录有 aiAnalysis 字段且非空
- **THEN** 卡片显示分析摘要（截取前 60 字），带 AI 图标标识

#### Scenario: 无分析结果的卡片
- **WHEN** 问诊记录无 aiAnalysis 或为空
- **THEN** 卡片不显示分析摘要区域，不预留空白

### Requirement: 记录详情页展示完整分析
系统 SHALL 在问诊记录详情页中完整展示 AI 分析结果，位于医嘱信息下方。

#### Scenario: 查看完整分析
- **WHEN** 用户打开有 aiAnalysis 的问诊记录详情页
- **THEN** 页面在医嘱信息下方展示完整 AI 分析内容，支持滚动查看

#### Scenario: 分析中显示免责声明
- **WHEN** AI 分析内容展示时
- **THEN** 底部附带免责声明"仅供中医参考，需执业中医师辨证，不替代医疗诊断"

### Requirement: 移除首页 AI 医嘱独立展示
系统 SHALL 移除首页的 AI 医嘱卡片和独立展示逻辑，AI 分析结果只在问诊记录中查看。

#### Scenario: 首页不再显示 AI 医嘱
- **WHEN** 用户查看首页
- **THEN** 首页不显示 AI 医嘱卡片或相关内容

#### Scenario: 原有 AI 医嘱数据迁移
- **WHEN** 用户首次升级到新版本且原有 aiAdivce 数据存在
- **THEN** 系统将原有 AI 医嘱数据关联到对应问诊记录的 aiAnalysis 字段，迁移后删除旧数据
