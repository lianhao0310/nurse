## Why

当前 AI 智能解析完全依赖云端 API，断网不可用，且医疗问诊/记录属隐私敏感数据，用户需要全本地推理选项。同时后续计划将 BianQue-1.0 蒸馏到小模型，需提前在端侧建立可替换的本地 LLM 基础设施，蒸馏完成后可直接替换 Qwen2.5-0.5B。

## What Changes

- 设置页"AI 智能解析"增加模式选择：**云端模型** / **本地模型** 二选一（双配置共存，切换不丢失另一配置）
- 云端模式：保持现有行为（OpenAI 兼容接口，支持多模态图片）
- 本地模式：默认 Qwen2.5-0.5B（GGUF Q4_K_M ~400MB），通过 llama.cpp 原生插件在端侧推理，断网可用，隐私数据不出设备
- 本地模型首期**按需下载**：首次切到本地模式时下载 GGUF 到 Filesystem 持久目录，显示进度条；下载完成后断网可用。预留随包发布能力（后续可改为 bundle 打包）
- 本地模式**仅支持文本**解析（图片入口置灰并提示"切至云端模型可解析图片"）
- 本地模型**可替换**：模型配置抽象为 `{ id, name, ggufUrl, ggufPath, sizeBytes, contextLength }`，后续 BianQue 蒸馏产物只需替换该配置即可，无需改代码
- AI 调用入口（`ai.js`）按 `settings.activeAIMode` 分发到云端或本地推理路径

## Capabilities

### New Capabilities
- `local-llm-engine`: 端侧 LLM 推理引擎——llama.cpp 原生插件封装（iOS Swift + Android JNI）、GGUF 模型下载管理（断点续传、进度回调、Filesystem 持久化）、本地文本推理调用、模型可替换配置抽象

### Modified Capabilities
- `ai-consult-chat`: 问诊聊天新增本地模型模式支持——按 activeAIMode 分发云端/本地推理路径；本地模式下仅文本对话（图片消息置灰提示）

## Impact

- **前端修改**: `ai.js`（调用入口增加模式分发）、`storage.js`（settings 新增 `localModel` + `activeAIMode` 字段）、`index.html`（AI 设置区增加模式切换 UI + 本地模型下载进度）、`app.js`（设置读写/事件绑定）、`consult-ai.js`/`consult-chat.js`（本地模式分支）
- **前端新增**: `local-llm.js`（本地 LLM 调用封装 `window.NurseLocalLLM`，封装插件调用 + 模型下载 + 推理接口）
- **新增 Capacitor 原生插件**: `capacitor-local-llm`（封装 llama.cpp，iOS 用 Swift bridging 预编译静态库，Android 用 JNI + prefab）
- **新增原生依赖**: llama.cpp 静态库（iOS .a / Android .so），Metal/GPU 加速可选
- **模型资源**: Qwen2.5-0.5B GGUF Q4_K_M（~400MB），按需下载到 Filesystem Documents 目录，不随包发布
- **配置数据模型**: `settings.activeAIMode`("custom"|"local"|null)、`settings.localModel`({ modelId, ggufUrl, sizeBytes, contextLength, downloaded, localPath })
