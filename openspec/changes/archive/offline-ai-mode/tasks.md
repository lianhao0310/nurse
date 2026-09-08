## 1. P1 UI 重构：Tab 与入口

- [x] 1.1 移除首页"问 AI"悬浮按钮（index.html 删除 `#btn-ask-ai`，app.js 删除绑定，styles.css 删除 `.ask-ai-btn`）。验证：首页无悬浮按钮
- [x] 1.2 将底部 Tab"AI 医嘱"改为"问 AI"，图标改为 💬，data-page 改为 `consult`。验证：Tab 显示"问 AI"且可点击切换
- [x] 1.3 新建"问 AI"Tab 页面（`#page-consult`），展示历史对话列表卡片，风格与问诊记录页一致。验证：点击 Tab 进入历史列表页
- [x] 1.4 历史对话卡片显示标题、最后回复摘要、时间、消息数；左滑显示删除按钮。验证：卡片信息正确，左滑可删除
- [x] 1.5 顶部"新建对话"按钮，点击进入聊天会话窗。验证：点击后打开空白聊天窗
- [x] 1.6 聊天会话窗左滑返回历史列表页。验证：左滑返回列表
- [x] 1.7 空状态提示"点击上方新建对话，向倪师提问"。验证：无历史时显示提示

## 2. P1 UI 重构：问诊记录内嵌分析

- [x] 2.1 storage.js 在 record 模型新增 `aiAnalysis`(string) 和 `aiAnalysisAt`(ISO string) 字段，_normalize 做归一化。验证：新字段存在且旧数据加载不报错
- [x] 2.2 问诊记录列表卡片显示 AI 分析摘要（前 60 字 + AI 图标），无分析时不显示。验证：有分析显示摘要，无分析不预留空白
- [x] 2.3 问诊记录详情页在医嘱信息下方展示完整 AI 分析内容 + 免责声明。验证：详情页显示完整分析
- [x] 2.4 "医嘱分析"按钮点击后生成结果存入 `record.aiAnalysis`，不再存入首页 AI 医嘱。验证：分析后记录有 aiAnalysis 字段
- [x] 2.5 移除首页 AI 医嘱卡片及相关渲染逻辑（app.js renderHome 中的 aiAdivce 部分）。验证：首页无 AI 医嘱内容
- [x] 2.6 数据迁移：启动时检测旧 aiAdivce 数据，关联到对应 record.aiAnalysis，迁移后删除。验证：升级后旧数据正确迁移

## 3. P1 UI 重构：移除语音输入

- [x] 3.1 移除 consult-chat.js 中语音相关代码（initVoice/startVoice/stopVoice/recognition 变量）。验证：无语音相关代码
- [x] 3.2 移除 index.html 语音按钮 `#chat-voice` 和 styles.css `.chat-voice-btn`。验证：聊天页无语音按钮

## 4. P1 聊天图片消息支持

- [x] 4.1 聊天输入栏新增图片按钮 `#chat-image`，点击触发 `<input type="file" accept="image/*" multiple>`。验证：可选择/拍摄图片
- [x] 4.2 图片消息以缩略图气泡显示在聊天区，支持多图。验证：发送图片后显示缩略图气泡
- [x] 4.3 storage.js consultChat.messages 支持 `images` 字段（{dataUrl, ocrText}[]），归一化处理。验证：图片消息持久化后可恢复
- [x] 4.4 云端模式：图片直接发给 vision 模型（复用 ai.js _imagesToParts）。验证：云端模式图片识别正常

## 5. P1 设置页改造

- [x] 5.1 "AI 智能解析"标题改为"自定义 AI 配置"。验证：设置页显示新标题
- [x] 5.2 设置页同时展示"自定义 AI"配置区（URL/Model/Token）和"本地模型"配置区（模型选择/下载），两区可独立配置。验证：两区均可独立填写和保存
- [x] 5.3 激活模式切换：两区之间有 radio/switch 选择当前激活模式，切换后立即生效，另一区配置保留不丢失。验证：切换后配置仍在
- [x] 5.4 本地模型区：显示可选模型列表（当前仅 Qwen2.5-3B），选择后弹窗提示下载 2GB。验证：显示模型选择和下载提示
- [x] 5.5 本地模型下载进度条：显示下载百分比/大小，下载完成前本地模型不可激活。验证：下载进度实时更新，未完成不可选
- [x] 5.6 storage.js settings 新增 `activeAIMode`("custom"|"local"|null) 和 `localModel`({name,status,path}) 字段，ai 字段保留。验证：配置保存重启仍在
- [x] 5.7 移除 tcm-skill.js 和 tcm-ai.js，清理 index.html 中对应 `<script>` 引入。验证：无 tcm-skill/tcm-ai 引用

## 6. P2 OCR 原生插件

- [ ] 6.1 创建 capacitor-native-ocr 插件骨架（package.json + iOS/Android 平台目录）。验证：插件结构存在
- [ ] 6.2 iOS 实现：Vision Framework VNRecognizeTextRequest，支持中文（recognitionLevel=accurate, recognitionLanguages=["zh-Hans","en"]）。验证：iOS 识别中文图片文字
- [ ] 6.3 Android 实现：ML Kit Text Recognition（chinese），依赖 com.google.mlkit:text-recognition-chinese。验证：Android 识别中文图片文字
- [ ] 6.4 插件 API：`OCR.recognize({ dataUrl }) → { text, confidence }`，错误处理。验证：API 调用返回识别结果
- [ ] 6.5 前端封装 offline-ocr.js（window.NurseOCR），调用插件并处理不支持时回退。验证：不支持时提示手动输入

## 7. P3 RAG 预构建与检索

- [ ] 7.1 创建 build-rag-index.js 脚本：读取 nihaixia 蒸馏速查层 .md，按主题分块（200-400 字/块）。验证：分块输出合理
- [ ] 7.2 对每个块计算 TF-IDF 向量，输出 tcm-rag-index.json（{ chunks: [{id, text, topic, tfidf}], idf } ）。验证：索引文件生成且大小 <1MB
- [ ] 7.3 中医同义词扩展表（怕冷→恶寒，出汗→自汗/盗汗等），提升检索召回。验证：同义词扩展生效
- [ ] 7.4 前端 rag-search.js（window.NurseRAG）：loadIndex() 加载 tcm-rag-index.json，search(question, topK) 返回相关片段。验证：检索返回相关中医知识片段
- [ ] 7.5 将 tcm-rag-index.json 放入 frontend/assets/，随 app 打包。验证：app 内可加载索引

## 8. P4 本地 LLM 原生插件

- [ ] 8.1 创建 capacitor-native-llm 插件骨架（package.json + iOS/Android 平台目录）。验证：插件结构存在
- [ ] 8.2 集成 llama.cpp：iOS 编译为 static library，Android 编译为 JNI shared library。验证：编译成功
- [ ] 8.3 插件 API：`LLM.load({ modelPath }) → { ok }`，`LLM.chat({ messages, temperature, maxTokens }, onToken) → { text }`，`LLM.release()`。验证：API 可调用
- [ ] 8.4 模型下载管理：从预设 URL 下载 Qwen2.5-3B GGUF Q4 到 Capacitor Filesystem 持久目录，支持进度回调。验证：模型可下载并持久存储
- [ ] 8.5 内存检测：加载前检查可用内存，不足 1GB 时拒绝并提示。验证：低内存设备提示友好
- [ ] 8.6 前端封装 local-llm.js（window.NurseLLM）：封装插件调用，管理模型加载状态。验证：前端可调用本地推理

## 9. P5 离线模式串联

- [ ] 9.1 ai.js 新增模式判断 `getActiveAIMode(settings)` 返回 settings.activeAIMode（"custom" | "local" | null）。验证：返回当前激活模式
- [ ] 9.2 本地模式药单/报告识别：图片 → NurseOCR.recognize() → 文字 → NurseLLM.chat() 结构化提取。验证：本地模式识别药单返回结构化 JSON
- [ ] 9.3 本地模式医嘱分析：医嘱文字 + 图片 OCR 文字 → NurseRAG.search() → RAG 片段 → NurseLLM.chat() → 分析结果。验证：本地模式分析返回辨证结果
- [ ] 9.4 本地模式问 AI 对话：用户消息(+图片OCR) → NurseRAG.search() → RAG + 历史 → NurseLLM.chat() 流式 → 回复。验证：本地模式对话流式回复正常
- [ ] 9.5 云端模式也使用 RAG：用户消息 → NurseRAG.search() → RAG 片段注入 system prompt → 云端模型生成。验证：云端模式 RAG 注入生效
- [ ] 9.6 本地模式 UI 标识：聊天页顶部显示"本地模型"标识。验证：本地模式显示标识

## 10. 集成验证

- [ ] 10.1 云端模式回归：选择自定义 AI 并配置后，药单/报告识别、医嘱分析、问 AI 对话均走云端 + RAG，功能正常。验证：云端全流程正常
- [ ] 10.2 本地模式全流程：选择本地模型 → 下载模型 → 拍药单 → OCR → 分析 → 问 AI 对话 → RAG 检索 → 本地推理 → 回复。验证：本地全流程无报错
- [ ] 10.3 数据迁移验证：有旧 aiAdivce 数据的设备升级后，数据正确迁移到 record.aiAnalysis。验证：迁移后旧数据清除
- [ ] 10.4 现有功能回归：问诊记录/药箱/检查报告/用药提醒不受影响。验证：现有功能正常
- [ ] 10.5 运行现有测试 `node --test tests/` 全部通过。验证：测试无失败
