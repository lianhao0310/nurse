## Context

当前项目 AI 功能全依赖云端 API：`ai.js`（`window.NurseAI`）直接 fetch 调用 OpenAI 兼容 `/chat/completions`，`consult-ai.js` 通过 `NurseAI.chatStream` 做问诊聊天。前端纯静态 HTML/CSS/JS + Capacitor 6，无构建步骤，无自建原生插件。settings.ai 为单一云端配置 `{ enabled, baseUrl, apiKey, model }`。资源打包通道 `frontend/assets/` 经 `cap sync` 复制进原生包。

用户选择 llama.cpp 原生插件路线（性能最好），本地模式仅文本，模型首期按需下载。

## Goals / Non-Goals

**Goals:**
- 新建 Capacitor 原生插件封装 llama.cpp，iOS/Android 双端可用
- AI 调用入口按 activeAIMode 分发云端/本地，双配置共存
- 本地模型按需下载到 Filesystem 持久目录，支持进度和断点续传
- 模型配置抽象可替换，后续 BianQue 蒸馏产物仅改配置即可替换
- 本地模式断网可用，隐私数据不出设备

**Non-Goals:**
- 不做本地 OCR（本地模式仅文本，图片置灰提示）
- 不做 RAG 知识检索（首期聚焦本地推理闭环）
- 不做随包发布（首期按需下载；预留 bundle 能力，后续可改）
- 不训练或微调模型（BianQue 蒸馏为独立后续工作）
- 不移除云端模式（双模式共存）
- 不做 UI 大重构（仅在现有 AI 设置区增加模式切换）

## Decisions

### D1: 新建 Capacitor 原生插件 capacitor-local-llm 封装 llama.cpp
**选择**: 自建 Capacitor 本地插件 `capacitor-local-llm`，封装 llama.cpp C++ 库
- **iOS**: Swift bridging → llama.cpp 预编译静态库（universal .a），Metal GPU 加速可选
- **Android**: JNI bridging → llama.cpp 共享库（.so），prefab 分发
- **插件接口**:
  - `loadModel({ ggufPath, contextLength, gpuLayers })` → 加载模型到内存
  - `generate({ prompt, messages, maxTokens, temperature, stop })` → 流式推理，通过 `@capacitor/core` 事件回调逐 token 返回
  - `unload()` → 释放模型内存
  - `isModelLoaded()` → 查询加载状态

**理由**: llama.cpp 是最成熟的端侧 LLM 运行时，iOS/Android 均有成熟编译方案，性能最好（0.5B Q4 在 A14 上预计 20-40 token/s）。Transformers.js WASM 方案虽无需原生插件但性能差 3-5 倍，且 WKWebView 内存限制风险。CoreML 仅 iOS 且模型转换工具链复杂。

**替代方案**: Transformers.js（ONNX，无需插件但慢）、CoreML（仅 iOS）、MLC-LLM（WebGPU 不稳定）

### D2: 模型按需下载到 Filesystem Documents 目录
**选择**: 首次切到本地模式时下载 GGUF 到 Capacitor Filesystem 的 Documents 目录，`local-llm.js` 管理下载逻辑
- 下载源：HuggingFace 镜像（`https://hf-mirror.com/Qwen/Qwen2.5-0.5B-Instruct-GGUF`）或自建 CDN
- 用 `fetch` + `Filesystem.writeFile` 分块下载，HTTP Range header 支持断点续传
- 下载进度通过回调事件实时上报到 UI
- 下载完成后记录 `localModel.downloaded = true` + `localModel.localPath`

**理由**: 0.5B GGUF Q4 ~400MB，随包发布使 IPA 增大 400MB 超 cellular 200MB 限制。按需下载保持 App 体积不变，首次联网下载后永久断网可用。

**替代方案**: 随包发布（IPA 过大）、App 启动后静默下载（侵入性强）

### D3: AI 调用入口按 activeAIMode 分发
**选择**: 在 `ai.js` 的 `parse()` 和 `chatStream()` 入口增加模式分发逻辑
- `activeAIMode === "custom"`（或 null 且 ai.enabled）→ 现有云端 fetch 逻辑，不变
- `activeAIMode === "local"` → 调用 `local-llm.js`（`window.NurseLocalLLM`）的推理接口
- `local-llm.js` 封装：检查模型已下载 → 调用 `capacitor-local-llm` 插件 loadModel/generate → 流式回调 → 返回结果

**理由**: 最小化对现有代码的侵入，模式分发集中在入口函数，下游解析逻辑（`_extractJSON` 等）复用。

**替代方案**: 新建独立 ai-local.js 完全平行实现（代码重复）、在 callChat 内部 if-else（侵入深）

### D4: 双配置共存数据模型
**选择**: settings 新增两个字段，保留现有 `ai` 字段不变
```
settings.activeAIMode: "custom" | "local" | null  // 当前激活模式
settings.localModel: {                            // 本地模型配置
  modelId: "qwen2.5-0.5b-instruct",
  name: "Qwen2.5-0.5B",
  ggufUrl: "https://hf-mirror.com/.../qwen2.5-0.5b-instruct-q4_k_m.gguf",
  sizeBytes: 400000000,
  contextLength: 2048,
  downloaded: false,
  localPath: ""                                   // 下载后填充
}
```
SQLite settings 表新增 `active_ai_mode`、`local_model`（JSON）列。

**理由**: 双配置共存让用户在云端/本地间切换不丢失配置。保留 `ai` 字段不变确保向后兼容。

### D5: 模型可替换配置抽象
**选择**: `localModel` 配置为独立可替换结构，推理代码只读 `localModel.modelId` 和 `localModel.localPath`，不硬编码模型信息
- 默认配置内置 Qwen2.5-0.5B，后续替换只需更新 `localModel` 的 `modelId/name/ggufUrl/sizeBytes`
- 预留 `availableModels` 数组支持多模型选择（首期仅 1 个，后续可扩展）

**理由**: 用户明确要求"方便后续 BianQue 蒸馏后直接替换"。配置抽象使替换零代码改动。

### D6: 本地模式 prompt 适配与 JSON 输出
**选择**: 本地模式复用 `ai.js` 的 `SYSTEM_PROMPT`，但做两处适配：
1. 本地 0.5B 模型不支持 `response_format: { type: "json_object" }`，改为在 prompt 末尾强化"仅输出 JSON"指令，JS 端用现有 `_extractJSON()` 解析
2. 上下文超 2048 tokens 时截断最早历史消息

**理由**: 0.5B 指令遵循能力弱于云端大模型，需更强的格式约束提示。`_extractJSON` 已有容错（去 markdown 围栏、提取首个 JSON 块），可复用。

### D7: 流式输出适配
**选择**: 
- 云端模式：保持现有 SSE `fetch` + `ReadableStream` 解析，不变
- 本地模式：`capacitor-local-llm` 插件 `generate()` 通过 Capacitor 事件 `local-llm-token` 逐 token 回调，`local-llm.js` 转发给上层回调，UI 渲染逻辑复用 `consult-chat.js` 现有流式渲染

**理由**: 统一上层流式渲染接口（回调逐 token），底层差异封装在 `local-llm.js` 和 `ai.js` 分发逻辑中。

### D8: 插件加载与模型生命周期管理
**选择**: 
- App 启动时不预加载模型（避免内存占用）
- 首次本地推理调用时 `loadModel`，加载后保持常驻直到 `unload` 或 App 退出
- 模型加载约 2-5s（0.5B Q4 ~400MB 从磁盘读入内存），UI 显示"加载模型中..."指示
- 切换到云端模式时不主动 unload（保留在内存，切回本地秒级可用），仅在内存紧张时按需 unload

**理由**: 0.5B 模型加载后内存占用约 500-600MB，iPhone 12（4GB）可承受。常驻避免反复加载的 2-5s 延迟。

## Risks / Trade-offs

- [0.5B 推理质量有限] → UI 标识"本地模型"让用户知情；prompt 工程优化；后续蒸馏提升质量
- [原生插件开发周期长] → 分阶段交付：P1 纯前端（配置 UI + 模式分发 + 下载管理，插件用 mock），P2 原生插件实现
- [llama.cpp iOS 编译复杂] → 使用社区预编译方案（如 llama.cpp 的 makefile iOS target 或 Swift Package），降低编译门槛
- [模型下载 400MB 体验差] → 显示进度条 + WiFi 提示 + 断点续传；下载失败可重试
- [低端设备内存不足] → loadModel 前检测可用内存，不足时提示并引导切云端
- [HF 镜像下载不稳定] → 预留可配置 CDN 源，失败重试 + 断点续传
- [0.5B JSON 格式遵循不稳定] → prompt 强化 + `_extractJSON` 容错 + 失败回退规则引擎 engine.js

## Migration Plan

1. **P1 前端配置与分发**（不依赖原生插件，插件用 mock/stub）:
   - storage.js 新增 `activeAIMode` + `localModel` 字段和 SQLite 列
   - index.html AI 设置区增加模式切换 UI + 下载进度
   - app.js 设置读写/事件绑定
   - local-llm.js 下载管理 + 推理封装（插件未就绪时 mock 返回）
   - ai.js 入口增加 activeAIMode 分发
   - 可独立发布，本地模式 UI 可操作但推理待插件
2. **P2 原生插件 capacitor-local-llm**:
   - iOS: llama.cpp 编译 + Swift 插件实现
   - Android: llama.cpp 编译 + JNI 插件实现
   - 插件接口: loadModel/generate/unload
3. **P3 串联验证**:
   - local-llm.js 接入真实插件
   - 端到端测试：下载 → 加载 → 推理 → 流式输出 → JSON 解析
4. **数据迁移**: SQLite settings 表 ALTER TABLE 新增列，旧数据 activeAIMode 默认 null（兼容现有云端行为）

## Open Questions

- Qwen2.5-0.5B GGUF 具体用哪个量化版本（Q4_K_M vs Q4_0）需实测速度/质量权衡
- llama.cpp iOS 静态库编译方案选型（手动编译 vs Swift Package vs 社区预编译）
- GGUF 下载源最终确定（HF 镜像 vs 自建 CDN vs GitHub Release）
- Android 端是否首期支持（用户聚焦 iPhone 12，Android 可后续）
