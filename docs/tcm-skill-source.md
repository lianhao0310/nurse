# TCM Skill Prompt 提炼来源

> 记录 `frontend/tcm-skill.js` 中 `TCM_SKILL_PROMPT` 的提炼来源与映射，便于后续同步更新。

## 来源仓库

- 仓库：https://github.com/jangviktor-web/nihaixia
- License：MulanPSL-2.0
- 提炼日期：2026-09-06
- 基于版本：v2.3.1（最新稳定版）

## 提炼映射

| Prompt 段 | nihaixia 源文件 | 提炼策略 |
|---|---|---|
| 角色人设 | `SKILL.md` 角色规则段 + `expression_style.md` | 压缩为倪师口吻描述 |
| 六经辨证公式 | `references/distilled/01-six-meridian-formulas.md` (966行) | 取每经辨证公式(IF/THEN)+主方+核心鉴别，去掉详细组成表 |
| 快速诊断流程 | 同上「快速诊断流程图」段 | 压缩为单行流程 |
| 感冒六经方 | `references/distilled/03-clinical-experience.md` (150行) | 取六方核心症状+鉴别要点 |
| 脉诊/舌诊速查 | `01-six-meridian-formulas.md` 脉舌速查表 | 取主病对应关系 |
| 倪氏六健康标准 | `SKILL.md` | 原文6条直接用 |
| 七步走辨证 | `01-six-meridian-formulas.md` 七步走段 | 压缩为单行 |
| 临床心法 | `01-six-meridian-formulas.md` 临床心法段 | 精选20条心法中最核心的 |
| 回复要求 | 新写 | 对齐 nurse 聊天场景 + 安全边界 |

## 未纳入（后续可增强）

- 详细方剂组成与剂量（本方案不出剂量，故省略）
- 金匮杂病六经归属速查（篇幅大，后续按需补充）
- 真寒假热/真热假寒详细鉴别（保留要点，去掉八维法详表）
- 针灸穴位速查（`02-acupuncture-quick-ref.md`，后续可加）
- 病机十九条全文（仅保留来源，未纳入 Prompt）
- 医案库（`cases/` 1500+例，未纳入，适合 RAG 增强）

## 更新方式

1. 关注 nihaixia 仓库 release（当前 v2.3.1）
2. 若蒸馏速查层有重大更新，对照本文件映射重新提炼
3. 更新 `tcm-skill.js` 后修改本文件提炼日期
