/*
 * 私人护士 · AI 智能解析（前端直连 LLM）
 * ------------------------------------------------------------------
 * 由"我的"页配置的 API 直接调用 OpenAI 兼容接口（支持多模态图片），
 * 把 问诊文字 + 检查报告/处方照片 整理为结构化结果：
 *   { engine:"ai", diseases[], medications[], tasks[], advice{taboo,diet}, risks[], summary }
 *
 * 失败时抛出异常，调用方回退到 engine.js（规则引擎）。
 *
 * 加载方式：<script src="ai.js"> -> window.NurseAI
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseAI = api;
})(this, function () {
  "use strict";

  const SYSTEM_PROMPT = `你是一名严谨、贴心的"私人护士"健康助手。用户会提供：①门诊问诊的录音转写文字（或自行输入），②可选的 检查报告 / 处方 照片。
请从中提取结构化健康管理信息，仅输出一个 JSON 对象，不要任何额外说明文字。JSON 结构如下：
{
  "diseases": ["推断的相关慢性病或诊断，如 高血压、2型糖尿病"],
  "medications": [
    { "name":"药品通用名", "dose":"剂量(如 5mg/1片)", "freq":"频次(如 1次/日、2次/日、3次/日、必要时)", "time":"服药时间提示(如 晨起/早饭后/睡前/空腹)", "note":"特别说明(如 加量/停药/随餐)", "disease":"对应病种" }
  ],
  "tasks": [
    { "type":"monitor|revisit|life", "title":"待办标题", "detail":"具体说明", "freq":"频率", "due":"复诊/复查日期 YYYY-MM-DD(如有)" }
  ],
  "advice": {
    "taboo": ["生活/饮食禁忌"],
    "diet": ["饮食与生活医嘱建议"]
  },
  "risks": [
    { "trigger":"出现何种症状/情况", "level":"red|yellow|green", "action":"应对措施", "disease":"相关病种" }
  ],
  "summary": "一句话生活医嘱总结"
}
要求：
- 药品尽量用通用名；剂量、频次、时间尽量从原文提取，缺失则留空字符串。
- tasks 的 type：监测类填 monitor，复诊/复查填 revisit，生活方式填 life。
- risks 的 level：red=需立即就医/紧急，yellow=需警惕尽快处理，green=一般提醒。
- 若信息不足，对应数组返回空数组，不要编造。
- 所有文字使用简体中文。`;

  function isConfigured(settings) {
    return !!(settings && settings.ai && settings.ai.enabled && settings.ai.apiKey);
  }

  // 从模型返回文本中稳妥提取 JSON
  function _extractJSON(text) {
    if (!text) throw new Error("模型返回为空");
    let s = text.trim();
    // 去 markdown 代码围栏
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first === -1 || last === -1 || last < first) throw new Error("返回内容不是合法 JSON");
    const jsonStr = s.slice(first, last + 1);
    return JSON.parse(jsonStr);
  }

  function _coerce(obj) {
    const arr = (x) => (Array.isArray(x) ? x : []);
    return {
      engine: "ai",
      diseases: arr(obj.diseases).map((x) => String(x)),
      medications: arr(obj.medications).map((m) => ({
        name: String(m.name || "").trim(),
        dose: String(m.dose || ""),
        freq: String(m.freq || ""),
        time: String(m.time || ""),
        note: String(m.note || ""),
        disease: String(m.disease || ""),
      })),
      tasks: arr(obj.tasks).map((t) => ({
        type: String(t.type || "life"),
        title: String(t.title || "").trim(),
        detail: String(t.detail || ""),
        freq: String(t.freq || ""),
        due: String(t.due || ""),
      })),
      advice: {
        taboo: arr(obj.advice && obj.advice.taboo).map((x) => String(x)),
        diet: arr(obj.advice && obj.advice.diet).map((x) => String(x)),
      },
      risks: arr(obj.risks).map((r) => ({
        trigger: String(r.trigger || ""),
        level: ["red", "yellow", "green"].includes(r.level) ? r.level : "yellow",
        action: String(r.action || ""),
        disease: String(r.disease || ""),
      })),
      summary: String(obj.summary || ""),
      disclaimer: "本结果由 AI 根据您提供的内容生成，仅供参考，具体以医生处方为准。",
    };
  }

  /**
   * 解析入口
   * @param {Object} opts
   *   transcript: string           问诊文字（可为空，仅图片时也行）
   *   images: [{name,type,dataUrl}] 归档图片（处方/报告）
   *   settings: 全局设置（含 ai 配置）
   * @returns Promise<result>
   */
  async function parse(opts) {
    const settings = opts.settings || {};
    const ai = settings.ai || {};
    if (!ai.enabled || !ai.apiKey) {
      throw new Error("AI 未启用或未配置 API Key");
    }
    const baseUrl = (ai.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = ai.model || "gpt-4o";

    const userParts = [];
    if (opts.transcript && opts.transcript.trim()) {
      userParts.push({ type: "text", text: "【问诊文字】\n" + opts.transcript.trim() });
    }
    if (opts.images && opts.images.length) {
      userParts.push({
        type: "text",
        text: "【图片】以下是检查报告或处方照片，请识别其中的用药、诊断与医嘱信息。",
      });
      for (const im of opts.images) {
        if (im && im.dataUrl) {
          userParts.push({ type: "image_url", image_url: { url: im.dataUrl } });
        }
      }
    }
    if (userParts.length === 0) {
      throw new Error("没有提供任何文字或图片");
    }

    let body = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userParts },
      ],
      temperature: 0.2,
    };
    // 部分兼容接口支持 JSON 模式；不支持时忽略（提示词已要求纯 JSON）
    try {
      body.response_format = { type: "json_object" };
    } catch (e) {}

    let resp;
    try {
      resp = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + ai.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/Failed to fetch|NetworkError|CORS|cross-origin/i.test(msg)) {
        throw new Error("网络或跨域(CORS)错误：请确认该接口允许浏览器跨域访问，或改用支持前端调用的代理。");
      }
      throw new Error("请求失败：" + msg);
    }

    if (!resp.ok) {
      let detail = "";
      try {
        const j = await resp.json();
        detail = j.error && j.error.message ? j.error.message : JSON.stringify(j);
      } catch (e) {
        detail = await resp.text().catch(() => "");
      }
      if (resp.status === 401) throw new Error("API Key 无效或无权限（401）。");
      if (resp.status === 404) throw new Error("接口路径不存在（404），请检查 Base URL 是否正确。");
      throw new Error("接口返回 " + resp.status + "：" + detail.slice(0, 200));
    }

    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const parsed = _extractJSON(content);
    return _coerce(parsed);
  }

  return { parse, isConfigured, SYSTEM_PROMPT };
});
