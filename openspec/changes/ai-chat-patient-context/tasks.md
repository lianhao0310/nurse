## 1. 病情摘要构建（consult-ai.js）

- [x] 1.1 在 `frontend/consult-ai.js` 新增 `buildPatientContext(data)` 函数：从 `data.cabinet` 筛选 `status === "active"` 的药品，输出"当前用药"列表（药名+规格+单次用量+服药时段+餐前餐后+病种）；从 `data.reports` 按 date 降序取最近 3 次、每次指标按 sort_order 取前 30 项，输出"最近检查指标"列表（日期+指标名+数值+单位+参考范围+异常标记）；从 `data.followedIndicators` 遍历报告找每个关注指标最近非空值，输出"关注指标最新值"（最多 10 个）。返回拼接好的中文文本（以"【用户病情】"开头），无数据时返回空字符串。验证：在浏览器控制台调用 `NurseConsult.buildPatientContext({cabinet:[...],reports:[...],followedIndicators:[...]})` 检查输出格式
- [x] 1.2 修改 `frontend/consult-ai.js` 的 `chat` 函数（第 60-69 行）：签名从 `chat(messages, settings, onChunk)` 扩展为 `chat(messages, settings, onChunk, data)`；在构建 `fullMessages` 时，若 `settings.aiChatPatientContext !== false` 且 `data` 存在，调用 `buildPatientContext(data)` 获取摘要文本，非空则拼接到 `GENERAL_SKILL_PROMPT` 之后作为 system message content。验证：调用 `NurseConsult.chat([{role:"user",content:"测试"}], {aiChatPatientContext:true}, null, mockData)` 后在 console 检查请求体 system prompt 包含"【用户病情】"

## 2. 聊天调用层修改（consult-chat.js）

- [x] 2.1 修改 `frontend/consult-chat.js` 的 `send` 函数（约第 309 行）：将 `window.NurseConsult.chat(history, data.settings, onChunk)` 改为 `window.NurseConsult.chat(history, data.settings, onChunk, data)`，把已加载的完整 `data` 传入。验证：在 AI 聊天页发送消息，用浏览器开发者工具 Network 面板检查请求体 messages[0].content 是否包含病情摘要（开关开启时）

## 3. 设置开关（storage.js + app.js）

- [x] 3.1 在 `frontend/storage.js` 的 `_empty()` 函数（约第 27-39 行）settings 对象中新增 `aiChatPatientContext: true` 字段（默认开启）。验证：调用 `NurseStorage.load()` 检查返回的 `settings.aiChatPatientContext === true`
- [x] 3.2 在 `frontend/app.js` 设置页渲染逻辑中新增"AI 聊天结合我的病情数据"开关 UI（toggle 样式，与现有设置开关一致），开关旁显示提示文案"开启后，您的用药和检查指标数据会发送到所配置的 AI 服务，用于个性化回答"。开关状态读写 `DATA.settings.aiChatPatientContext`，切换后调用 `NurseStorage.saveSettings(DATA.settings)` 持久化。验证：在设置页切换开关，关闭重开 App 后开关状态保持

## 4. 集成验证

- [ ] 4.1 验证"结合在用药品回答"：在药箱添加在用药品（如华法林），在 AI 聊天问"我能吃菠菜吗"，确认 AI 回复提及当前用药。验证：AI 回复内容包含对华法林的引用
- [ ] 4.2 验证"结合检查指标回答"：录入一份检查报告（如血压偏高），在 AI 聊天问"我血压控制得怎么样"，确认 AI 引用具体数值。验证：AI 回复包含用户录入的血压数值
- [x] 4.3 验证"关闭开关退回原行为"：在设置页关闭开关，在 AI 聊天发送消息，检查 Network 请求体 system prompt 不包含"【用户病情】"。验证：请求体 messages[0].content 等于原始 GENERAL_SKILL_PROMPT
- [x] 4.4 验证"无病情数据正常聊天"：清空药箱和检查报告（或新用户），在 AI 聊天发送消息，确认正常回复无报错。验证：AI 正常流式回复
- [x] 4.5 验证"病情摘要不污染对话历史"：开关开启状态下聊天后，查看历史对话记录，确认消息列表中不包含病情摘要文本。验证：consultChats 存储的 messages 不含"【用户病情】"字样
