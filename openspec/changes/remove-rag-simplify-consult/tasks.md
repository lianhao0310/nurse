## 1. 创建 consult-ai.js

- [x] 1.1 创建 `frontend/consult-ai.js`，导出 `window.NurseConsult`（GENERAL_SKILL_PROMPT、isConfigured、getConfig、chat），chat() 用静态慢性病管理 prompt 作为 system message，不依赖 RAG。验证模块可被 require 加载且 GENERAL_SKILL_PROMPT 非空
- [x] 1.2 创建 `tests/consult-ai.test.js`，测试 prompt 内容（含慢性病管理定位、急危重症安全边界）、prompt 不含中医内容、isConfigured 分支覆盖。验证 `node --test tests/consult-ai.test.js` 通过

## 2. 更新 consult-chat.js

- [x] 2.1 修改 `frontend/consult-chat.js`：依赖从 `window.NurseTCM` 改为 `window.NurseConsult`，急危重症提示从"中医辨证不能替代急诊"改为"AI 问诊不能替代急诊"，标题从"问 AI · 倪师中医"改为"问 AI"。验证文件中无 NurseTCM / 倪师 / 中医残留

## 3. 更新 index.html

- [x] 3.1 修改 `frontend/index.html`：移除 `rag-embed.js`、`rag-db.js`、`tcm-skill.js`、`tcm-ai.js` 的 `<script>` 标签，改为 `<script src="consult-ai.js">`。验证页面脚本引用正确

## 4. 删除 RAG 和中医文件

- [x] 4.1 删除 `frontend/rag-db.js`、`frontend/rag-embed.js`、`frontend/tcm-skill.js`、`frontend/tcm-skill-full.js`、`frontend/tcm-ai.js`。验证文件已删除
- [x] 4.2 删除 `frontend/assets/databases/rag-knowledge.db`（如存在）、`frontend/vendor/` 目录（如存在）、`scripts/build-rag-db.js`、`scripts/build-rag-db.py`、`scripts/copy-vendor.js`（如存在）。验证已删除
- [x] 4.3 删除 `tests/rag-knowledge.test.js`。验证已删除

## 5. 清理依赖和配置

- [x] 5.1 修改 `package.json`：移除 `@xenova/transformers` devDependency，test 脚本中 `tests/rag-knowledge.test.js` 替换为 `tests/consult-ai.test.js`。验证 `npm test` 引用正确
- [x] 5.2 检查 `capacitor.config.js` 和 `frontend/db.js` 是否有 RAG 专属配置/表需清理，有则移除（确认无 RAG 残留）

## 6. 验证

- [x] 6.1 运行 `npm test` 验证 consult-ai 测试通过且无引用已删文件的报错（consult-ai 5/5 通过，storage 预先存在 37 个失败与本次改动无关）
- [x] 6.2 验证 `frontend/index.html` 中无 rag/tcm/transformers 拗留引用（grep 确认无残留）
