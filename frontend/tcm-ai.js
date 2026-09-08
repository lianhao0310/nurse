/*
 * Nurse · 倪海厦中医问诊对话（路径 C · 云端注入）
 * ------------------------------------------------------------------
 * 依赖：tcm-skill.js (window.TCM_SKILL_PROMPT) + ai.js (window.NurseAI.chatStream)
 *
 * 加载方式：<script src="tcm-ai.js"> -> window.NurseTCM
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseTCM = api;
})(this, function () {
  "use strict";

  const MAX_TURNS = 20;

  // 提取有效配置：使用 ai 配置
  function getConfig(settings) {
    const s = settings || {};
    const ai = s.ai || {};
    if (ai.enabled && ai.apiKey) {
      return {
        baseUrl: (ai.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, ""),
        apiKey: ai.apiKey,
        model: ai.model || "gpt-4o",
      };
    }
    return null;
  }

  function isConfigured(settings) {
    return !!getConfig(settings);
  }

  // 截断历史：保留最近 MAX_TURNS 轮（每轮 user+assistant = 2 条）
  function _truncate(messages) {
    if (messages.length <= MAX_TURNS * 2) return messages;
    return messages.slice(-MAX_TURNS * 2);
  }

  // 提取最后一条用户消息作为 RAG 查询
  function _lastUserMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].content;
    }
    return "";
  }

  // 构建 system message：精简核心规则 + RAG 检索片段（降级为仅核心规则）
  async function _buildSystemPrompt(corePrompt, queryText) {
    try {
      const rag = (typeof window !== "undefined" && window.NurseRag) || null;
      const embed = (typeof window !== "undefined" && window.NurseRagEmbed) || null;
      if (!rag || !embed || !queryText) return corePrompt;

      if (!rag.isReady()) {
        await rag.init();
      }
      const queryVector = await embed.embed(queryText);
      const chunks = await rag.search(queryVector, { topK: 5 });
      if (!chunks || !chunks.length) {
        console.log("[NurseTCM] RAG 检索返回空，仅使用核心规则");
        return corePrompt;
      }
      console.log(`[NurseTCM] RAG 检索命中 ${chunks.length} 条片段，拼接 prompt`);
      return rag.buildSystemPrompt(corePrompt, chunks);
    } catch (e) {
      console.warn("[NurseTCM] RAG 检索失败，降级为仅核心规则:", e.message);
      return corePrompt;
    }
  }

  // 多轮对话：messages 为历史 [{role,content}]，返回完整回复文本
  // onChunk(fullText) 流式增量回调
  async function chat(messages, settings, onChunk) {
    const config = getConfig(settings);
    if (!config) throw new Error("AI 未配置：请在设置页开启 AI 并配置 API Key");
    const corePrompt = (typeof window !== "undefined" && window.TCM_SKILL_PROMPT) || "";
    if (!corePrompt) throw new Error("中医 Skill Prompt 未加载");

    const history = _truncate(messages || []).map((m) => ({ role: m.role, content: m.content }));
    const queryText = _lastUserMessage(history);
    const systemPrompt = await _buildSystemPrompt(corePrompt, queryText);

    const fullMessages = [{ role: "system", content: systemPrompt }].concat(history);
    const ai = (typeof window !== "undefined" && window.NurseAI) || null;
    if (!ai || typeof ai.chatStream !== "function") throw new Error("ai.js 未加载");
    return await ai.chatStream(fullMessages, config, onChunk, { temperature: 0.7 });
  }

  return { isConfigured, getConfig, chat };
});
