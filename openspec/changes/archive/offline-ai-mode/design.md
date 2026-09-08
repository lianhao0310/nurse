## Context

当前项目 AI 功能全依赖云端 API（ai.js → OpenAI 兼容接口）。前端纯静态 HTML/CSS/JS + Capacitor 6，无构建步骤。问诊记录支持药单/检查报告图片，当前直接发云端 vision 模型识别。问 AI 聊天为悬浮按钮入口，有语音输入。现有 tcm-skill.js（静态 Skill Prompt）和 tcm-ai.js 将被移除，统一改用 RAG 检索注入知识。

## Goals / Non-Goals

**Goals:**
- 选择本地模型时，全流程离线可用（OCR + RAG + 本地 LLM）
- 选择自定义 AI 时，使用云端 API + RAG 检索
- UI 重构：Tab 入口、记录内嵌分析、去语音、去悬浮按钮
- 聊天支持图片消息
- 统一使用 RAG 知识注入，移除静态 Skill Prompt

**Non-Goals:**
- 不做端侧 embedding 模型（用 TF-IDF 替代）
- 不做 RAG 向量库服务端（预构建静态索引打包进 app）
- 不训练或微调模型
- 不做 iOS/Android 之外的端侧推理
- 不移除云端模式（已配置时仍走云端）

## Decisions

### D1: OCR 用原生插件而非 WASM 库
**选择**: Capacitor 原生插件封装 ML Kit(Android) + Vision Framework(iOS)
**理由**: ML Kit 和 Vision 都是系统内置能力，零模型下载、<1s 识别、中文支持好。Tesseract.js WASM 方案需下载 ~15MB 语言包且耗内存。
**替代方案**: Tesseract.js（纯前端但慢且重）、PaddleOCR WASM（不成熟）

### D2: RAG 用 TF-IDF 而非 embedding 向量检索
**选择**: 开发时预构建 TF-IDF 索引（tcm-rag-index.json ~500KB），运行时纯 JS 检索
**理由**: 零运行时依赖、零模型下载、纯 JS ~100 行实现。中医关键词检索（"太阳病""桂枝汤"）TF-IDF 准确率够用。embedding 方案需下载 ~30-100MB 模型，移动端不划算。
**替代方案**: bge-small-zh embedding（更准但太重）、sqlite-vec（需原生插件）

### D3: 本地 LLM 用 llama.cpp 原生插件 + Qwen2.5-3B Q4
**选择**: Capacitor 原生插件封装 llama.cpp，模型 Qwen2.5-3B GGUF Q4_K_M（~2GB）
**理由**: 3B 是移动端可用的最小推理能力尚可的中文模型。0.5B 推理能力不足以做中医辨证。llama.cpp 是最成熟的端侧 LLM 运行时，iOS/Android 均有编译方案。
**替代方案**: MLC-LLM（TVM 编译复杂）、CoreML（仅 iOS）、transformers.js（WASM 太慢）

### D4: 统一使用 RAG 知识注入，移除 Skill Prompt
**选择**: 云端和本地模式均通过 RAG 检索倪海厦知识片段注入 prompt，不再使用 tcm-skill.js 静态 Skill Prompt
**理由**: RAG 按需检索比全量注入更精准、更省 token。云端大模型上下文足够容纳 RAG 片段，本地 3B 模型上下文有限更需精准检索。统一方案简化代码，不再维护 Skill Prompt 文件。
**替代方案**: 保留 Skill Prompt + RAG 混合（冗余）、仅 Skill Prompt 无 RAG（知识覆盖有限）

### D5: AI 双配置 + 激活模式切换
**选择**: settings 同时保存 `ai`（自定义 AI 配置）和 `localModel`（本地模型配置），`settings.activeAIMode` 为 "custom" 或 "local" 决定实际使用哪种。两种配置可共存，切换激活模式不丢失另一种配置。
**理由**: 用户可能在不同场景切换使用（有网用云端、无网用本地），重新填写配置体验差。双配置 + 一键切换最灵活。
**替代方案**: 互斥单选（切换时清空另一配置，需重新填写）、自动判断（不够明确）

### D6: AI 分析结果存入 record.aiAnalysis 字段
**选择**: 在 record 数据模型新增 `aiAnalysis` (string) 和 `aiAnalysisAt` (ISO string) 字段
**理由**: 分析结果与问诊记录强关联，独立存储导致数据冗余和同步问题。嵌入记录简化数据模型。
**替代方案**: 独立 aiAdivce 表关联 recordId（当前方案，已废弃）

### D7: "问 AI" Tab 复用现有 Tab 机制
**选择**: 将原"AI 医嘱"Tab 改为"问 AI"Tab，页面内容替换为历史对话列表
**理由**: 不新增 Tab 数量，复用现有 goPage 路由和 Tab 切换逻辑。原 AI 医嘱内容已迁移到问诊记录。

### D8: 聊天图片消息流程——离线先 OCR 再文本推理
**选择**: 离线模式下图片 → OCR 提取文字 → 文字作为消息 content → RAG + 本地 LLM。不将图片直接喂给本地 LLM（3B 模型无 vision 能力）。
**理由**: Qwen2.5-3B 是纯文本模型，不支持图片输入。OCR 转文字后走文本推理流程是唯一可行路径。
**替代方案**: 用 Qwen2-VL（无 3B 量化版可用）

## Risks / Trade-offs

- [Qwen2.5-3B 推理质量有限] → 本地模式回复质量低于云端大模型，UI 提示"本地模型"标识让用户知情
- [模型下载 2GB 体验差] → 选择本地模型时显示下载进度条，支持 WiFi 下载，下载中 AI 功能不可用
- [低端设备内存不足] → 检测可用内存，不足时提示并引导配置云端 API
- [TF-IDF 检索精度低于 embedding] → 对中医术语做同义词扩展（如"怕冷"→"恶寒"）提升召回
- [原生插件开发周期长] → 分阶段交付：P1 纯 UI 重构不依赖插件，P2-P4 逐步引入原生能力
- [iOS/Android 插件维护成本] → OCR 和 LLM 插件接口统一，平台差异封装在插件内部

## Migration Plan

1. **P1 UI 重构**（纯前端，不依赖原生插件）: Tab 改名、去悬浮按钮、去语音、分析结果嵌入记录、历史对话列表页。可独立发布。
2. **P2 OCR 插件**: 开发 capacitor-native-ocr，离线模式图片识别可用。
3. **P3 RAG 索引**: 预构建脚本 + 前端检索 JS，打包 tcm-rag-index.json。
4. **P4 LLM 插件**: 开发 capacitor-native-llm，模型下载管理，离线推理可用。
5. **P5 串联**: 离线模式完整流程 OCR → RAG → LLM。
6. **数据迁移**: 启动时检测旧 aiAdivce 数据，关联到对应 record.aiAnalysis，迁移后删除。

## Open Questions

- Qwen2.5-3B GGUF 具体用哪个量化版本（Q4_K_M vs Q4_0）需实测速度/质量权衡
- ML Kit OCR 中文模型是否需要额外下载（v2 默认含中文，需确认）
- iOS Vision Framework 最低系统版本要求（VNRecognizeTextRequest 需 iOS 13+，项目最低版本待确认）
