## 1. Skill Prompt 提炼

- [x] 1.1 创建 `frontend/tcm-skill.js`，从 nihaixia 仓库 `references/distilled/` 提炼倪师中医 Skill Prompt（角色人设+六经辨证公式+八纲脉舌+感冒六经方+六健康标准+输出约束+安全边界，约 4-6K 字），文件头保留 MulanPSL-2.0 版权声明与来源链接。验证：在浏览器 console 加载 `tcm-skill.js`，确认 `window.TCM_SKILL_PROMPT` 为非空字符串且长度 > 2000
- [x] 1.2 创建 `docs/tcm-skill-source.md`，记录 Prompt 各段对应的 nihaixia 源文件、提炼策略、版本号。验证：文件存在且包含来源映射表

## 2. ai.js 改造

- [x] 2.1 将 `frontend/ai.js` 的 `_chatStream` 函数从闭包内部改为通过 `window.NurseAI.chatStream` 导出，保持现有调用方不受影响。验证：现有 `ai.js` 的 `parse`/`analyzeConsult` 功能正常，且 `window.NurseAI.chatStream` 可调用

## 3. storage.js 历史对话数据模型

- [x] 3.1 在 `frontend/storage.js` 新增 `consultChats[]` 数据模型与 CRUD 方法：`getConsultChats()`、`getConsultChat(id)`、`saveConsultChat(chat)`、`deleteConsultChat(id)`、`newConsultChat()`，复用现有 Filesystem/localStorage 持久化。验证：创建/读取/更新/删除对话后重启 App 数据仍在
- [x] 3.2 确保旧数据兼容：现有 `nurse-data.json` 无 `consultChats` 字段时自动初始化为空数组，不破坏现有数据。验证：用现有数据文件加载无报错

## 4. tcm-ai.js 中医问诊对话封装

- [x] 4.1 创建 `frontend/tcm-ai.js`，封装 `window.NurseTCM`：`isConfigured(settings)` 检测中医模型配置（回退共用 ai 配置）、`chat(messages, settings, onChunk)` 调用 `NurseAI.chatStream` 传入 TCM_SKILL_PROMPT 作为 system message。验证：配置 API Key 后调用 `NurseTCM.chat` 能收到流式回调
- [x] 4.2 实现多轮上下文管理：发送时拼接 system + 历史 messages，超过 20 轮（40 条）时截断早期消息保留 system + 最近轮次。验证：模拟 25 轮对话后发送，请求体 messages 数组不超过 42 条

## 5. 聊天 UI 实现

- [x] 5.1 在 `frontend/index.html` 新增 AI 问诊聊天页面容器（消息列表区 + 输入区 + 顶部栏），引入 `tcm-skill.js`、`tcm-ai.js`、`consult-chat.js`。验证：页面 DOM 结构存在，脚本加载无 404
- [x] 5.2 创建 `frontend/consult-chat.js`，实现聊天交互：消息渲染（用户右侧/AI 左侧气泡）、文字输入发送、流式接收实时渲染、加载指示器、自动滚动到底部。验证：输入文字发送后能看到用户气泡与 AI 流式回复
- [x] 5.3 实现语音输入：语音按钮调用 `webkitSpeechRecognition`（zh-CN），实时显示识别文字，结束后自动发送；不支持时隐藏按钮。验证：Chrome 下语音输入能转文字并发送
- [x] 5.4 在 `frontend/styles.css` 新增聊天界面样式：iOS 风格气泡、输入栏、顶部栏、消息列表滚动，适配移动端（PREFERENCE_8）。验证：移动端尺寸下布局正常，气泡圆角/间距符合 iOS 风格

## 6. 历史对话管理

- [x] 6.1 实现顶部栏"新建对话"按钮：点击后保存当前对话、创建空白对话、清空聊天区。验证：新建后聊天区清空，历史列表多一条记录
- [x] 6.2 实现"查看历史对话"：点击展开历史对话列表（标题/创建时间/更新时间），点击某条加载其消息记录到聊天区可续聊。验证：切换历史对话后聊天区显示对应消息，可继续发送
- [x] 6.3 实现对话标题自动生成：首条用户消息发送时截取前 20 字作为标题。验证：历史列表显示的标题与首条消息一致
- [x] 6.4 实现对话自动保存：每次发送消息或收到 AI 回复后自动保存到 storage。验证：发送消息后刷新页面，对话内容不丢失

## 7. 首页入口与页面切换

- [x] 7.1 在首页底部新增"问 AI"按钮，点击切换到 AI 问诊聊天页面。验证：首页可见按钮，点击后进入聊天页面
- [x] 7.2 未配置 API Key 或断网时，"问 AI"按钮禁用并提示"需联网并配置 AI 后使用"。验证：未配置时按钮禁用，配置后可用

## 8. 设置页中医模型配置

- [x] 8.1 在设置页新增"中医问诊模型"独立配置区（开关/API Key/Base URL/Model），保存到 `settings.tcmAi`。验证：配置后保存重启仍在
- [x] 8.2 `tcm-ai.js` 的 `isConfigured` 优先使用 `settings.tcmAi`，未配置时回退 `settings.ai`。验证：仅配置 ai 不配置 tcmAi 时中医问诊仍可用

## 9. 安全边界与免责

- [x] 9.1 实现急危重症关键词检测（胸痛/昏迷/大出血/呼吸困难/剧烈头痛等），用户输入命中时在发送前显示就医提醒弹窗。验证：输入"胸痛持续不缓解"时出现就医提醒
- [x] 9.2 AI 回复完成后在消息底部附带免责声明"仅供中医参考，需执业中医师辨证，不替代医疗诊断"。验证：每条 AI 回复底部有免责声明

## 10. 集成验证

- [x] 10.1 端到端验证：配置 API Key → 首页点"问 AI" → 输入症状（如"怕冷无汗脖子疼"）→ 收到倪师风格中医辨证回复 → 新建对话 → 历史列表可见 → 点击历史续聊。验证：完整流程无报错
- [x] 10.2 现有功能回归：问诊记录/药箱/检查报告/用药提醒功能不受影响。验证：现有功能正常使用
- [x] 10.3 运行现有测试 `npm test` 通过。验证：测试无失败
