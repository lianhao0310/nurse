## 1. 依赖与配置

- [x] 1.1 安装 `@capacitor-community/sqlite` 依赖并执行 `cap sync`，验证 iOS/Android 原生项目均出现 SQLite 插件引用
- [x] 1.2 在 `capacitor.config.js` 中配置 `@capacitor-community/sqlite` 插件（assets 路径等），验证 `npx cap sync` 无报错
- [x] 1.3 在 `package.json` 中记录 `@xenova/transformers` 依赖（或确认 CDN 加载方式），验证前端可加载 Transformers.js 全局对象
- [x] 1.4 在 `requirements.txt` 中补充构建脚本所需 Python 依赖（`sentence-transformers` 或 `onnxruntime` + 模型库），验证 `pip install -r requirements.txt` 成功

## 2. 知识库构建脚本（开发阶段）

- [x] 2.1 创建 `scripts/build-rag-db.py` 主入口与 `scripts/embeddings/` 目录结构，验证脚本可执行 `--help` 并显示知识源选项
- [x] 2.2 实现 nihaixia 仓库知识源提取器：拉取指定目录 Markdown，按 `##` 标题分块，验证对样例文档产出预期 chunk 列表（含 title、text、source_path）
- [x] 2.3 实现 `engine.js` 知识源提取器：解析 `DISEASE_KB` 与 `MEDICATIONS`，按病种/药物分块，验证对当前 engine.js 产出 6 个病种 chunk + 14 个药物 chunk
- [x] 2.4 实现向量化模块：加载 `BAAI/bge-small-zh-v1.5` 模型对 chunk 文本生成 512 维向量，验证向量维度与归一化（范数 ≈ 1）
- [x] 2.5 实现 SQLite 写入模块：按 design.md 的 schema 创建表并写入 chunk + 向量 BLOB（Float32Array 序列化），验证产出 `rag-knowledge.db` 可被 sqlite3 打开且行数与 chunk 数一致
- [x] 2.6 将构建产物 `rag-knowledge.db` 放置到 `frontend/assets/` 目录，验证文件存在且大小在预期范围（2-10MB）

## 3. 前端 RAG 模块

- [x] 3.1 创建 `frontend/rag-db.js`：封装 `@capacitor-community/sqlite` 连接管理与 `copyFromAssets()` 初始化，验证 APP 启动时数据库成功复制到沙盒并建立连接
- [x] 3.2 在 `frontend/rag-db.js` 实现向量检索函数：读取候选 chunk 向量 BLOB，`new Float32Array(blob)` 还原，计算余弦相似度排序返回 top-k，验证对样例 query 返回按相似度降序排列的结果
- [x] 3.3 创建 `frontend/rag-embed.js`：封装 Transformers.js 加载 `Xenova/bge-small-zh-v1.5` 与文本嵌入函数，验证首次加载模型后对样例中文文本产出 512 维向量
- [x] 3.4 在 `frontend/rag-embed.js` 实现模型单例缓存与加载失败降级，验证第二次嵌入不重复加载模型、加载失败时抛出可识别错误供调用方降级
- [x] 3.5 在 `frontend/index.html` 中按正确顺序加载 `rag-embed.js`、`rag-db.js`（在 `tcm-ai.js` 之前），验证页面加载后 `window.NurseRag` 对象可用

## 4. Prompt 构建改造

- [x] 4.1 将 `frontend/tcm-skill.js` 精简为约 500 tokens 的核心规则（六经辨证总纲、快速诊断流程、倪氏六健康标准、回复要求、安全边界），验证精简后 token 数 ≤ 600
- [x] 4.2 保留原始完整 prompt 为 `frontend/tcm-skill-full.js`（备份用途），验证原内容完整保留
- [x] 4.3 在 `frontend/rag-db.js` 或独立模块实现 prompt 拼接函数：精简核心规则 + RAG 检索片段结构化拼接（含来源标注），验证拼接产物格式符合 design.md 规定
- [x] 4.4 改造 `frontend/tcm-ai.js` 的 `chat()` 函数：调用 RAG 模块检索 + 拼接构建 system message，验证正常流程下 system message 包含核心规则 + 检索片段
- [x] 4.5 在 `frontend/tcm-ai.js` 实现降级逻辑：RAG 检索失败或返回空时仅使用精简核心规则，验证降级场景下问诊功能不中断且 system message 仅含核心规则

## 5. 真机验证与集成

- [ ] 5.1 iOS 真机验证 Transformers.js 加载与嵌入：在 iOS 真机发起中医问诊，验证模型成功加载并产出向量（确认 WebView 兼容性）
- [ ] 5.2 Android 真机验证 Transformers.js 加载与嵌入：在 Android 真机发起中医问诊，验证模型成功加载并产出向量
- [ ] 5.3 真机验证 SQLite assets 复制：iOS/Android 首次启动验证 `rag-knowledge.db` 成功复制到沙盒，非首次启动验证跳过复制
- [ ] 5.4 端到端验证：真机发起典型中医问诊（如"怕冷无汗脖子疼"），验证 AI 回复包含六经辨证结果且 system message token 数显著低于原 4000+（可通过日志确认）
- [ ] 5.5 降级路径验证：模拟 RAG 不可用（删除 db 或禁用模型加载），验证问诊仍可用精简核心规则回复且 app 不崩溃
- [x] 5.6 更新 `package.json` 的 test 脚本，补充 RAG 模块的 Node 单元测试（rag-db 检索逻辑、prompt 拼接逻辑），验证 `npm test` 全部通过
