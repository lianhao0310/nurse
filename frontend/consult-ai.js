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
    if (settings && settings.activeAIMode === "local") {
      return !!(settings.localModel && settings.localModel.downloaded);
    }
    return !!getConfig(settings);
  }

  function _truncate(messages) {
    if (messages.length <= MAX_TURNS * 2) return messages;
    return messages.slice(-MAX_TURNS * 2);
  }

  function _fmtTimeSlots(slots) {
    const map = { morning: "早", noon: "午", evening: "晚" };
    return (slots || []).map((s) => map[s] || s).join("/") || "未设置";
  }

  function _fmtMeal(meal) {
    if (meal === "before") return "餐前";
    if (meal === "after") return "餐后";
    return "不限餐次";
  }

  function buildPatientContext(data) {
    if (!data) return "";
    const parts = [];

    const drugs = (data.cabinet || []).filter((d) => d && d.status === "active");
    if (drugs.length) {
      const lines = drugs.map((d) => {
        const name = d.name || "未知药品";
        const spec = d.spec ? " " + d.spec : "";
        const dose = d.doseAmount ? "，每次" + d.doseAmount + (d.doseUnit || "片") : "";
        const times = "，" + _fmtTimeSlots(d.timeSlots) + _fmtMeal(d.meal) + "服用";
        const disease = d.disease ? "（病种：" + d.disease + "）" : "";
        return "- " + name + spec + dose + times + disease;
      });
      parts.push("当前用药：\n" + lines.join("\n"));
    }

    const reports = (data.reports || [])
      .filter((r) => r && r.indicators && r.indicators.length)
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 3);
    if (reports.length) {
      const lines = reports.map((r) => {
        const date = r.date || "未注明日期";
        const inds = (r.indicators || []).slice(0, 30).map((ind) => {
          const nm = ind.name || "未知指标";
          const val = ind.value != null && ind.value !== "" ? " " + ind.value + (ind.unit || "") : " 无数据";
          const rng = ind.range ? "（参考" + ind.range : "（无参考范围";
          const abn = ind.abnormal ? " ↑异常" : "";
          return nm + val + rng + abn + "）";
        });
        return "- " + date + "：" + inds.join("，");
      });
      parts.push("最近检查指标（最近3次）：\n" + lines.join("\n"));
    }

    const followed = (data.followedIndicators || []).slice(0, 10);
    if (followed.length) {
      const allReports = (data.reports || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const lines = [];
      for (const f of followed) {
        const fName = f.name;
        if (!fName) continue;
        let found = null;
        for (const r of allReports) {
          const ind = (r.indicators || []).find((i) => i.name === fName && i.value != null && i.value !== "");
          if (ind) { found = { ind: ind, date: r.date }; break; }
        }
        if (found) {
          const rng = f.range || found.ind.range || "无参考范围";
          const abn = found.ind.abnormal ? " ↑异常" : "";
          lines.push("- " + fName + "：" + found.ind.value + (found.ind.unit || "") + "（最近 " + (found.date || "未注明") + "，参考" + rng + abn + "）");
        }
      }
      if (lines.length) parts.push("关注指标最新值：\n" + lines.join("\n"));
    }

    if (!parts.length) return "";
    return "【用户病情】\n" + parts.join("\n");
  }

  async function chat(messages, settings, onChunk, data, onStatus) {
    const history = _truncate(messages || []).map((m) => ({ role: m.role, content: m.content }));
    let systemContent = GENERAL_SKILL_PROMPT;
    if (data) {
      const ctx = buildPatientContext(data);
      if (ctx) systemContent = GENERAL_SKILL_PROMPT + "\n\n" + ctx;
    }
    const fullMessages = [{ role: "system", content: systemContent }].concat(history);
    const ai = (typeof window !== "undefined" && window.NurseAI) || null;
    if (!ai || typeof ai.chatStream !== "function") throw new Error("ai.js 未加载");

    if (settings && settings.activeAIMode === "local") {
      return await ai.chatStream(fullMessages, null, onChunk, { temperature: 0.7, localModel: settings.localModel, onStatus: onStatus });
    }

    const config = getConfig(settings);
    if (!config) throw new Error("AI 未配置：请在设置页开启 AI 并配置 API Key");
    return await ai.chatStream(fullMessages, config, onChunk, { temperature: 0.7 });
  }

  return { isConfigured, getConfig, chat, buildPatientContext, GENERAL_SKILL_PROMPT };
});
