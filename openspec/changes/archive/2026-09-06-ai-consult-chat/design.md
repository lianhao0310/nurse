## Context

当前 nurse 前端为纯静态 HTML/CSS/JS（无框架），通过 Capacitor 封装为 iOS/Android 应用。已有 `ai.js` 封装 OpenAI 兼容接口调用（含流式 `_chatStream`），`engine.js` 为本地规则引擎，`storage.js` 管理本地持久化（Filesystem 回退 localStorage）。项目无构建步骤，Capacitor 直接复制 `frontend/` 目录。

本方案采用路径 C（Skill 注入云端模型）：从 nihaixia 仓库 `references/distilled/` 蒸馏速查层提炼约 4-6K 字 System Prompt，复用 `ai.js` 的云端调用能力，实现倪师中医问诊聊天。不训练模型、不端侧推理、不新增外部依赖。

## Goals / Non-Goals

**Goals:**
- 新增独立 AI 问诊聊天模块，与现有问诊记录功能互不影响
- 聊天式多轮对话，支持语音+文字，流式输出
- 历史对话持久化与续聊
- 倪师中医人设通过 Skill Prompt 注入云端模型
- 复用现有 `ai.js` 的 API 调用与流式能力，最小化改动

**Non-Goals:**
- 不做端侧模型推理（路径 B/A 留待后续）
- 不训练或微调模型
- 不改动现有问诊记录、药箱、检查报告、用药提醒等功能
- 不新增 npm 依赖或构建工具
- 不做向量检索 RAG（纯 Prompt 注入，后续可增强）

## Decisions

### D1: 纯 Prompt 注入而非 RAG
**选择**：将 nihaixia 蒸馏速查层提炼为 4-6K 字静态 Prompt 常量，直接作为 system message。
**理由**：路径 C 最轻量，无需向量索引、无额外运行时依赖。4-6K 字 + 对话历史 < 16K token，主流模型 context 充裕。
**替代方案**：RAG 检索 nihaixia .md 片段注入——效果更好但需端侧 embedding + 索引，属路径 B 范畴，后续可增强。

### D2: 复用 ai.js 的 _chatStream 而非新建 HTTP 调用
**选择**：将 `ai.js` 的 `_chatStream` 导出，`tcm-ai.js` 直接调用。
**理由**：避免重复实现 OpenAI 兼容请求、错误处理、SSE 解析。`_chatStream` 已支持流式增量回调。
**改动**：`ai.js` 需将 `_chatStream` 从闭包内函数改为可通过 `window.NurseAI` 访问的导出方法。

### D3: 多轮对话上下文管理
**选择**：每次发送时将完整 `messages[]`（含 system + 历史轮次）传入 `_chatStream`。
**理由**：OpenAI 兼容接口原生支持 messages 数组多轮上下文。需控制历史长度避免 token 溢出——超过阈值时截断早期消息（保留 system + 最近 N 轮）。
**阈值**：保留最近 20 轮（40 条消息），超出时丢弃最早的用户/助手消息对。

### D4: 历史对话数据模型
**选择**：在 `storage.js` 新增 `consultChats[]` 数组，与现有 `records`/`orders`/`cabinet` 同构。
**结构**：
```
consultChats[]: {
  id, title, createdAt, updatedAt,
  messages[]: { role: "user"|"assistant", content, ts }
}
```
**理由**：复用现有 storage 的 Filesystem/localStorage 持久化机制，无需新增存储方案。

### D5: 语音输入复用现有 Web Speech API
**选择**：聊天页面语音按钮调用 `webkitSpeechRecognition`（与现有录音转写同 API）。
**理由**：项目已有 Web Speech API 使用经验，无需引入新依赖。识别结束自动发送。

### D6: 独立中医模型配置
**选择**：设置页新增 `settings.tcmAi`（enabled/apiKey/baseUrl/model），未配置时回退 `settings.ai`。
**理由**：中医辨证需更强推理模型（如 glm-4-plus / qwen-max），与西医解析（glm-4.7-flash）分开配置更灵活。

### D7: 聊天 UI 纯原生 JS + CSS
**选择**：不引入框架，用原生 DOM 操作 + CSS 实现聊天界面，与项目现有风格一致。
**理由**：项目无构建步骤、无框架，保持一致。iOS 风格（PREFERENCE_8）通过 CSS 实现。

## Risks / Trade-offs

- [云端模型辨证深度不足] → 允许用户配置更强模型（qwen-max / deepseek-reasoner）；Prompt 中要求"不确定时说明"
- [Prompt 与 nihaixia 仓库版本同步] → `docs/tcm-skill-source.md` 记录来源版本与提炼映射，需人工定期更新
- [多轮对话 token 溢出] → D3 截断策略，保留最近 20 轮
- [联网依赖] → UI 明示需联网，断网禁用入口；这是路径 C 固有约束
- [倪师方剂被当处方] → Prompt 强制不出剂量、附免责声明；急危重症关键词触发就医提醒
- [Web Speech API 兼容性] → 不支持时隐藏语音按钮，仅保留文字输入（与现有录音转写降级策略一致）
