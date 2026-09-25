## 1. 数据模型与配置扩展（P1 前端）

- [x] 1.1 在 `storage.js` 的 `_empty()` settings 中新增 `activeAIMode: null` 和 `localModel` 默认配置（modelId/name/ggufUrl/sizeBytes/contextLength/downloaded/localPath），验证 `_empty()` 返回包含新字段
- [x] 1.2 在 `storage.js` 的归一化函数中增加 `activeAIMode` 和 `localModel` 的兼容处理，验证旧数据（无新字段）归一化后不报错且默认值正确
- [x] 1.3 在 `storage.js` 的 SQLite settings 读写逻辑中新增 `active_ai_mode` 列和 `local_model` 列（JSON 文本），验证 `updateSettings` 能持久化和读取新字段
- [x] 1.4 编写 SQLite 迁移逻辑（ALTER TABLE ADD COLUMN，IF NOT EXISTS 兼容），验证旧库升级后新列存在且旧数据 activeAIMode 默认 null

## 2. AI 设置区 UI 改造（P1 前端）

- [x] 2.1 在 `index.html` 的 `#ai-card` 区域增加模式切换控件（云端模型/本地模型 单选组），验证 HTML 结构包含两个单选选项
- [x] 2.2 在 `index.html` 增加本地模型信息展示区（模型名称、大小、下载状态、下载进度条）和下载按钮，验证 UI 元素存在且默认隐藏（切到本地模式才显示）
- [x] 2.3 在 `index.html` 增加本地模式图片置灰提示文案"本地模型不支持图片，切至云端模型可解析图片"，验证提示元素存在
- [x] 2.4 在 `styles.css` 增加模式切换、下载进度条、本地模型信息区的样式，验证页面渲染无样式错乱

## 3. 设置读写与事件绑定（P1 前端）

- [x] 3.1 在 `app.js` 的 `applySettingsUI()` 中读取 `activeAIMode` 并勾选对应单选项，显示/隐藏云端配置区和本地模型区，验证切换模式时 UI 正确响应
- [x] 3.2 在 `app.js` 的 `saveAISettings()` 中保存 `activeAIMode`，验证保存后 `settings.activeAIMode` 持久化正确
- [x] 3.3 在 `app.js` 绑定模式切换事件——切到本地模式时检查模型下载状态，未下载则显示下载区，已下载则显示可用；切到云端模式时保留本地配置不清除，验证切换不丢失另一配置
- [x] 3.4 在 `app.js` 绑定下载按钮事件，调用 `NurseLocalLLM.downloadModel()` 并将进度回调更新到进度条 UI，验证下载进度实时显示

## 4. 本地 LLM 封装 local-llm.js（P1 前端）

- [x] 4.1 新建 `frontend/local-llm.js`，定义 `window.NurseLocalLLM`，实现 `downloadModel(onProgress)` 方法：fetch GGUF 分块下载到 Filesystem Documents 目录，支持 HTTP Range 断点续传，验证下载完成后 `localModel.downloaded=true` 且文件存在
- [x] 4.2 在 `local-llm.js` 实现 `isReady()` 方法：检查模型已下载 + 插件可用，返回布尔，验证未下载/未安装插件时返回 false
- [x] 4.3 在 `local-llm.js` 实现 `generate({ prompt, messages, maxTokens, temperature }, onToken)` 方法：调用 `capacitor-local-llm` 插件 `loadModel`（首次）+ `generate`，通过 Capacitor 事件监听 `local-llm-token` 转发 token 到 `onToken` 回调，验证流式 token 回调被上层收到（插件未就绪时 mock 返回错误提示）
- [x] 4.4 在 `local-llm.js` 实现 `unload()` 方法调用插件释放模型内存，验证调用后 `isModelLoaded` 返回 false
- [x] 4.5 在 `index.html` 的 `<script>` 加载序列中 `ai.js` 之前引入 `local-llm.js`，验证页面加载后 `window.NurseLocalLLM` 可用

## 5. AI 调用入口模式分发（P1 前端）

- [x] 5.1 在 `ai.js` 的 `parse()` 入口增加 `activeAIMode` 分发：`"local"` → 调用 `NurseLocalLLM.generate` 走本地推理，`"custom"`/null → 现有云端逻辑，验证本地模式下 parse 不发起 HTTP 请求
- [x] 5.2 在 `ai.js` 的 `chatStream()` 入口增加同样的 `activeAIMode` 分发，验证问诊聊天本地模式走 `NurseLocalLLM.generate`
- [x] 5.3 本地推理路径复用 `SYSTEM_PROMPT`，在 prompt 末尾强化"仅输出 JSON 对象"指令（本地模型不支持 response_format），结果用现有 `_extractJSON()` 解析，验证本地模式 parse 返回结构与云端一致
- [x] 5.4 本地推理路径实现上下文截断：prompt + messages 超 `localModel.contextLength`（2048）时截断最早历史，验证超长输入不报错

## 6. 问诊聊天本地模式适配（P1 前端）

- [x] 6.1 在 `consult-ai.js` 中增加本地模式分支：`activeAIMode === "local"` 时不调用 `NurseAI.chatStream` 而调用 `NurseLocalLLM.generate`，验证本地模式问诊对话走本地推理
- [x] 6.2 在 `consult-chat.js` 中本地模式图片消息入口置灰并显示提示文案，验证本地模式下图片按钮不可点击且提示可见
- [x] 6.3 在 `consult-chat.js` 中本地模式流式渲染复用现有逐 token 追加逻辑，验证本地模式聊天回复实时逐字显示

## 7. Capacitor 原生插件 capacitor-local-llm 脚手架（P2 原生）

- [x] 7.1 创建 `capacitor-local-llm` 插件项目结构（package.json、ios/、android/、src/），按 Capacitor 6 插件规范生成，验证 `npx cap sync` 能识别插件
- [x] 7.2 定义插件 TypeScript 接口 `LocalLLMPlugin`（loadModel/generate/unload/isModelLoaded），生成 JS 胶水层，验证前端 `Capacitor.Plugins.LocalLLM` 可调用接口

## 8. iOS 插件实现（P2 原生）

- [x] 8.1 编译 llama.cpp 为 iOS universal 静态库（arm64 + x86_64 simulator），验证 .a 文件生成且可链接
- [x] 8.2 实现 Swift 插件类 `LocalLLMPlugin`：`loadModel` 读取 GGUF 路径调用 llama.cpp `llama_model_load`，验证模型加载成功
- [x] 8.3 实现 `generate` 方法：构造 `llama_context`、逐 token 采样、通过 `notifyListeners("local-llm-token", ...)` 发送 token 事件，验证前端收到流式 token
- [x] 8.4 实现 `unload` 释放 `llama_context` 和 `llama_model`，验证内存释放
- [x] 8.5 在 `ios/App/Podfile` 引入插件 Pod，`npx cap sync ios` 后验证 Xcode 工程能编译通过

## 9. Android 插件实现（P2 原生，可后续）

- [x] 9.1 编译 llama.cpp 为 Android .so（arm64-v8a/armeabi-v7a），用 prefab 分发，验证 NDK 编译成功
- [x] 9.2 实现 Java/Kotlin 插件类 `LocalLLMPlugin`：JNI bridging 调用 llama.cpp，接口与 iOS 一致，验证前端调用行为一致
- [x] 9.3 在 `android/app/build.gradle` 引入插件，`npx cap sync android` 后验证 Gradle 编译通过

## 10. 串联与端到端验证（P3）

- [ ] 10.1 将 `local-llm.js` 的 mock 替换为真实 `capacitor-local-llm` 插件调用，验证 iOS 真机上 loadModel → generate → unload 全链路工作
- [ ] 10.2 端到端测试：切到本地模式 → 下载模型 → 输入问诊文字 → 本地推理 → 流式输出 → JSON 解析 → 结构化结果展示，验证全流程无网络请求且结果合理
- [ ] 10.3 端到端测试：断网状态下本地模式问诊对话，验证正常工作不报错
- [ ] 10.4 端到端测试：本地模式切云端模式再切回，验证双配置共存不丢失、模型无需重新下载
- [ ] 10.5 验证模型可替换：修改 `localModel` 配置为不同 modelId/ggufUrl，验证系统按新配置下载和加载，推理代码无需改动
- [ ] 10.6 在 iPhone 12 真机上验证推理速度（目标 ≥10 token/s）和内存占用（不触发 OOM）
