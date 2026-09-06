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

  // 多轮对话：messages 为历史 [{role,content}]，返回完整回复文本
  // onChunk(fullText) 流式增量回调
  async function chat(messages, settings, onChunk) {
    const config = getConfig(settings);
    if (!config) throw new Error("AI 未配置：请在设置页开启 AI 并配置 API Key");
    const prompt = (typeof window !== "undefined" && window.TCM_SKILL_PROMPT) || "";
    if (!prompt) throw new Error("中医 Skill Prompt 未加载");
    const fullMessages = [
      { role: "system", content: prompt },
    ].concat(_truncate(messages || []).map((m) => ({ role: m.role, content: m.content })));
    const ai = (typeof window !== "undefined" && window.NurseAI) || null;
    if (!ai || typeof ai.chatStream !== "function") throw new Error("ai.js 未加载");
    return await ai.chatStream(fullMessages, config, onChunk, { temperature: 0.7 });
  }

  return { isConfigured, getConfig, chat };
});
