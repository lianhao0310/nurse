## Why

当前 AI 功能完全依赖云端 API，无法离线使用。用户隐私敏感场景（中医问诊、医疗记录）需要全本地方案。同时现有 UI 结构存在不合理之处：AI 医嘱分析结果独立放置首页，与问诊记录割裂；问 AI 入口为悬浮按钮而非 Tab 页面；问诊录音转写功能实际无用。

## What Changes

- **BREAKING**: 移除首页"问 AI"悬浮按钮，原"AI 医嘱"Tab 改为"问 AI"Tab，展示对话历史列表
- **BREAKING**: 移除问诊录音转写功能
- **BREAKING**: AI 医嘱分析结果不再独立放首页，直接嵌入问诊记录，卡片显示分析摘要
- 问 AI Tab 页：顶部新建对话按钮，卡片左滑删除，点击进入聊天，左滑返回列表
- 聊天会话支持图片消息（拍照/选图 → OCR → 模型解析）
- 设置页"AI 智能解析"改为"自定义 AI 配置"，启用后选择"自定义 AI"（填写 URL/Model/Token）或"本地模型"（选择 Qwen2.5-3B，同意下载并显示进度条）
- 离线模式：ML Kit(Android)/Vision(iOS) OCR + 本地 RAG(倪海厦知识) + Qwen2.5-3B 本地模型
- 云端模式（选择自定义 AI）：使用云端 API 调用
- 药单/检查报告：本地模式 OCR → 本地模型结构化解析；云端模式直接发 vision 模型
- 医嘱分析/问 AI 对话：统一使用 RAG 检索倪海厦知识 + 模型生成（云端或本地），不再使用静态 Skill Prompt

## Capabilities

### New Capabilities
- `offline-ai-engine`: 端侧 AI 引擎——OCR 识别（ML Kit/Vision）、RAG 检索（倪海厦知识本地索引）、本地 LLM 推理（Qwen2.5-3B via llama.cpp），以及模型下载管理
- `consult-record-analysis`: 问诊记录内嵌 AI 分析——医嘱分析结果直接存入问诊记录并显示于卡片，不再独立展示

### Modified Capabilities
- `ai-consult-chat`: 从悬浮按钮入口改为 Tab 页面入口；移除语音输入；新增图片消息支持；RAG 知识注入替代 Skill Prompt；历史对话列表改为 Tab 首页

## Impact

- **前端**: index.html（Tab 结构重构）、app.js（路由/事件/渲染）、styles.css（卡片/列表样式）、consult-chat.js（去语音/加图片/离线模式）、ai.js（离线分支）、storage.js（数据模型变更）
- **新增前端**: rag-search.js（TF-IDF 检索）、offline-ocr.js（OCR 调用封装）、local-llm.js（本地 LLM 调用封装）
- **新增构建脚本**: build-rag-index.js（预构建 RAG 索引）
- **新增 Capacitor 原生插件**: capacitor-native-ocr（ML Kit + Vision）、capacitor-native-llm（llama.cpp）
- **新增资源**: assets/tcm-rag-index.json（预构建 RAG 索引 ~500KB）、Qwen2.5-3B GGUF 模型（按需下载 ~2GB）
- **删除**: 首页 AI 医嘱卡片及独立展示逻辑、录音转写相关代码、tcm-skill.js（静态 Skill Prompt）、tcm-ai.js（旧封装）
- **依赖**: 新增 @capacitor-community/native-ocr（或自建）、llama.cpp 原生库
