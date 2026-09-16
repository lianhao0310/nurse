/*
 * Nurse · AI 问诊对话（慢性病健康管理）
 * ------------------------------------------------------------------
 * 依赖：ai.js (window.NurseAI.chatStream)
 *
 * 加载方式：<script src="consult-ai.js"> -> window.NurseConsult
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseConsult = api;
})(this, function () {
  "use strict";

  const MAX_TURNS = 20;

  const GENERAL_SKILL_PROMPT = `你是慢性病健康管理助手，帮助用户理解医嘱、管理用药、解读检查报告、提供饮食与生活方式建议。

【核心能力】
- 医嘱解读：将医生口头医嘱转化为清晰的用药/复诊/护理指引。
- 用药指导：解释药品用途、用法用量、注意事项、常见副作用，不出具体剂量调整方案（需遵医嘱）。
- 检查报告解读：解释指标含义、异常原因、是否需复查。
- 饮食禁忌：根据病情和用药给出饮食建议与禁忌。
- 风险预警：识别用药风险、药物相互作用、症状恶化信号。
- 生活方式：睡眠、运动、情绪等非药物管理建议。

【安全边界】
- 急危重症（胸痛持续、昏迷、大出血、呼吸困难、剧烈头痛等）必须首先强调立即就医，不要只做线上建议。
- 不替代医疗诊断，不出具体处方剂量，不鼓励自行停药换药。
- 不确定时如实说明，不编造医学结论。

【回复要求】
- 口语化，通俗易懂，避免术语堆砌。
- 回答聚焦用户问题，给出可操作的建议。
- 末尾自然带一句免责提醒（如"以上仅供参考，需遵医嘱"），不要每次用一模一样的套话。
- 用简体中文回复。`;

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

  function _truncate(messages) {
    if (messages.length <= MAX_TURNS * 2) return messages;
    return messages.slice(-MAX_TURNS * 2);
  }

  async function chat(messages, settings, onChunk) {
    const config = getConfig(settings);
    if (!config) throw new Error("AI 未配置：请在设置页开启 AI 并配置 API Key");

    const history = _truncate(messages || []).map((m) => ({ role: m.role, content: m.content }));
    const fullMessages = [{ role: "system", content: GENERAL_SKILL_PROMPT }].concat(history);
    const ai = (typeof window !== "undefined" && window.NurseAI) || null;
    if (!ai || typeof ai.chatStream !== "function") throw new Error("ai.js 未加载");
    return await ai.chatStream(fullMessages, config, onChunk, { temperature: 0.7 });
  }

  return { isConfigured, getConfig, chat, GENERAL_SKILL_PROMPT };
});
