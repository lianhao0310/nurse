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
  // 已知纯文本模型（不支持图片输入）。命中则直接跳过图片、仅用文字解析，
  // 避免接口因 image_url 不支持而报错（典型如 智谱 glm-4.7-flash）。
  const TEXT_ONLY_MODELS = [
    "glm-4.7-flash", "glm-4-flash", "glm-4-plus", "glm-4-long", "glm-4-air", "glm-4-airx",
    "glm-3-turbo", "glm-3-plus",
    "deepseek-chat", "deepseek-reasoner",
    "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k",
    "qwen-turbo", "qwen-plus", "qwen-max", "qwen2-7b", "qwen2-72b",
  ];
  // 明确支持视觉的模型标识：命中则视为支持图片，不主动跳过
  const VISION_HINT = /(vision|vl|v-plus|v-flash|v1-[\d.]*k-vision|multimodal|mm|image|pic|glm-4v|qwen-vl|gpt-4o|gpt-4o-mini|gpt-4-turbo|claude-3-(\w+)-sonnet|claude-3-opus|claude-3\.5-sonnet|gemini)/i;
  function isTextOnlyModel(model) {
    const m = (model || "").toLowerCase().trim();
    if (!m) return false;
    if (VISION_HINT.test(m)) return false;
    return TEXT_ONLY_MODELS.some((p) => m === p || m.indexOf(p) === 0);
  }

  // 构造并发起一次 chat/completions 请求
  async function callChat(baseUrl, apiKey, model, transcript, images) {
    const userParts = [];
    if (transcript && transcript.trim()) {
      userParts.push({ type: "text", text: "【问诊文字】\n" + transcript.trim() });
    }
    if (images && images.length) {
      userParts.push({
        type: "text",
        text: "【图片】以下是检查报告或处方照片，请识别其中的用药、诊断与医嘱信息。",
      });
      for (const im of images) {
        if (im && im.dataUrl) {
          userParts.push({ type: "image_url", image_url: { url: im.dataUrl } });
        }
      }
    }
    if (userParts.length === 0) throw new Error("没有提供任何文字或图片");

    const body = {
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

    return fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify(body),
    });
  }

  async function _readError(resp) {
    let detail = "";
    try {
      const j = await resp.json();
      detail = j.error && j.error.message ? j.error.message : JSON.stringify(j);
    } catch (e) {
      detail = await resp.text().catch(() => "");
    }
    return detail;
  }
  function _toError(resp, detail) {
    if (resp.status === 401) return new Error("API Key 无效或无权限（401）。");
    if (resp.status === 404) return new Error("接口路径不存在（404），请检查 Base URL 是否正确。");
    return new Error("接口返回 " + resp.status + "：" + detail.slice(0, 200));
  }

  async function parse(opts) {
    const settings = opts.settings || {};
    const ai = settings.ai || {};
    if (!ai.enabled || !ai.apiKey) {
      throw new Error("AI 未启用或未配置 API Key");
    }
    const baseUrl = (ai.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = ai.model || "gpt-4o";
    const transcript = opts.transcript || "";
    let images = (opts.images || []).filter((im) => im && im.dataUrl);

    // 文本模型：主动跳过图片，避免接口报错
    let skippedImages = false;
    if (images.length && isTextOnlyModel(model)) {
      images = [];
      skippedImages = true;
    }

    let resp;
    try {
      resp = await callChat(baseUrl, ai.apiKey, model, transcript, images);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/Failed to fetch|NetworkError|CORS|cross-origin/i.test(msg)) {
        throw new Error("网络或跨域(CORS)错误：请确认该接口允许浏览器跨域访问，或改用支持前端调用的代理。");
      }
      throw new Error("请求失败：" + msg);
    }

    if (!resp.ok) {
      // 带了图片却失败：可能是模型不支持图片，回退纯文字重试一次
      if (images.length) {
        const firstDetail = await _readError(resp);
        try {
          const r2 = await callChat(baseUrl, ai.apiKey, model, transcript, []);
          if (r2.ok) {
            resp = r2;
            skippedImages = true;
          } else {
            throw _toError(r2, await _readError(r2));
          }
        } catch (e) {
          if (e && e.message && e.message.indexOf("接口返回") >= 0) throw e;
          throw _toError(resp, firstDetail);
        }
      } else {
        throw _toError(resp, await _readError(resp));
      }
    }

    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const parsed = _extractJSON(content);
    const result = _coerce(parsed);
    if (skippedImages) {
      result.warning =
        "当前模型（" + model + "）不支持图片输入，已仅使用文字内容解析。如需识别处方/报告照片，请更换支持视觉的模型。";
    }
    return result;
  }

  // 通用对话请求：传入 systemPrompt + userParts，返回解析后的 JSON 对象
  async function _chat(systemPrompt, userParts, settings) {
    const ai = settings.ai || {};
    if (!ai.enabled || !ai.apiKey) throw new Error("AI 未启用或未配置 API Key");
    const baseUrl = (ai.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = ai.model || "gpt-4o";
    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts },
      ],
      temperature: 0.2,
    };
    try {
      body.response_format = { type: "json_object" };
    } catch (e) {}
    let resp;
    try {
      resp = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + ai.apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/Failed to fetch|NetworkError|CORS|cross-origin/i.test(msg)) {
        throw new Error("网络或跨域(CORS)错误：请确认该接口允许浏览器跨域访问。");
      }
      throw new Error("请求失败：" + msg);
    }
    if (!resp.ok) {
      let d = "";
      try {
        d = await resp.text();
      } catch (e) {}
      if (resp.status === 401) throw new Error("API Key 无效或无权限（401）。");
      if (resp.status === 404) throw new Error("接口路径不存在（404），请检查 Base URL。");
      throw new Error("接口返回 " + resp.status + "：" + d.slice(0, 200));
    }
    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return _extractJSON(content);
  }

  function _imagesToParts(images, label) {
    const parts = [];
    if (images && images.length) {
      parts.push({ type: "text", text: label });
      for (const im of images) {
        if (im && im.dataUrl) parts.push({ type: "image_url", image_url: { url: im.dataUrl } });
      }
    }
    return parts;
  }

  // Streaming 版 _chat：通过 SSE 增量回调实时输出 AI 文本
  async function _chatStream(systemPrompt, userParts, settings, onChunk) {
    const ai = settings.ai || {};
    if (!ai.enabled || !ai.apiKey) throw new Error("AI 未启用或未配置 API Key");
    const baseUrl = (ai.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = ai.model || "gpt-4o";
    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts },
      ],
      temperature: 0.2,
      stream: true,
    };
    try { body.response_format = { type: "json_object" }; } catch (e) {}
    let resp;
    try {
      resp = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + ai.apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/Failed to fetch|NetworkError|CORS|cross-origin/i.test(msg)) {
        throw new Error("网络或跨域(CORS)错误：请确认该接口允许浏览器跨域访问。");
      }
      throw new Error("请求失败：" + msg);
    }
    if (!resp.ok) {
      let d = "";
      try { d = await resp.text(); } catch (e) {}
      if (resp.status === 401) throw new Error("API Key 无效或无权限（401）。");
      if (resp.status === 404) throw new Error("接口路径不存在（404），请检查 Base URL。");
      throw new Error("接口返回 " + resp.status + "：" + d.slice(0, 300));
    }
    // SSE streaming
    if (resp.body && resp.body.getReader) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let full = "", buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t || !t.startsWith("data:")) continue;
          const data = t.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content || "";
            if (delta) { full += delta; if (onChunk) onChunk(full); }
          } catch (e) {}
        }
      }
      return _extractJSON(full);
    }
    // 回退：非 streaming
    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (onChunk) onChunk(content || "");
    return _extractJSON(content);
  }

  /**
   * AI 分析：把本次问诊的医嘱文字 + 检查结果图片 + 处方药图片 整理为结构化结果。
   * 返回 { advice, examResults[], prescription[] }
   */
  const CONSULT_SYSTEM = `你是一名严谨、贴心的"私人护士"健康助手。用户会提供：①本次问诊的医嘱文字（可能来自录音转写），②可选的检查结果照片，③可选的处方药照片。
请从中整理为结构化 JSON 对象，不要任何额外说明文字：
{
  "advice": "归纳后的本次医生医嘱文字（综合用药、复查、生活注意事项）",
  "examResults": [
    { "name":"指标名（用标准名，如 收缩压、空腹血糖）", "value":"数值", "unit":"单位", "range":"参考范围(可选)", "abnormal": false }
  ],
  "prescription": [
    { "name":"药品通用名", "spec":"规格/剂量(如 5mg)", "dose":"单次用量(如 1片)", "freq":"频次(如 1次/日)", "time":"服药时间(如 早饭后)", "note":"说明(可选)" }
  ]
}
要求：
- 检查结果照片：逐行逐项提取图片中每一行检查指标，不要遗漏任何一项。每项包含指标名、数值、单位、参考范围。指标尽量用标准名；数值、单位从图片提取，缺失则留空字符串；abnormal 依据参考范围或明显异常判断为 true/false。
- 处方药照片：逐项提取图片中每一种药品，不要遗漏。处方药尽量用通用名；剂量、频次、时间尽量从原文/图片提取。
- 不编造信息，缺则留空或返回空数组。所有文字使用简体中文。`;

  async function analyzeConsult(opts) {
    const settings = opts.settings || {};
    const model = (settings.ai && settings.ai.model) || "";
    let examImages = (opts.examImages || []).filter((im) => im && im.dataUrl);
    let rxImages = (opts.rxImages || []).filter((im) => im && im.dataUrl);
    // 文本模型：跳过图片，避免接口报错
    if (examImages.length && isTextOnlyModel(model)) examImages = [];
    if (rxImages.length && isTextOnlyModel(model)) rxImages = [];
    const adviceText = (opts.adviceText || "").trim();
    if (!adviceText && !examImages.length && !rxImages.length) {
      throw new Error("没有提供任何医嘱文字或图片");
    }
    const userParts = [];
    userParts.push({
      type: "text",
      text: "【本次医嘱文字】\n" + (adviceText || "（无文字，请根据图片识别）"),
    });
    _imagesToParts(examImages, "【检查结果照片】请识别其中的指标名称、数值、单位与参考范围。").forEach((p) => userParts.push(p));
    _imagesToParts(rxImages, "【处方药照片】请识别药品名称、规格与用法用量。").forEach((p) => userParts.push(p));
    const parsed = await _chatStream(CONSULT_SYSTEM, userParts, settings, opts.onChunk);
    const arr = (x) => (Array.isArray(x) ? x : []);
    const result = {
      advice: String(parsed.advice || adviceText || ""),
      examResults: arr(parsed.examResults).map((e) => ({
        name: String(e.name || "").trim(),
        value: e.value === 0 || e.value ? String(e.value) : "",
        unit: String(e.unit || ""),
        range: String(e.range || ""),
        abnormal: !!e.abnormal,
      })),
      prescription: arr(parsed.prescription).map((p) => ({
        name: String(p.name || "").trim(),
        spec: String(p.spec || ""),
        dose: String(p.dose || ""),
        freq: String(p.freq || ""),
        time: String(p.time || ""),
        note: String(p.note || ""),
      })),
    };
    if (!result.advice && !result.examResults.length && !result.prescription.length) {
      throw new Error("AI 未能从内容中提取有效信息");
    }
    return result;
  }

  /**
   * 医嘱分析：结合本次医生医嘱 + 历次检查趋势 + 当前用药，生成生活/饮食医嘱。
   * 返回 { diet[], taboo[], text }
   */
  const ADVICE_SYSTEM = `你是一名"私人护士"健康助手。用户会提供：①本次医生医嘱，②历次检查指标趋势，③当前正在服用的药物。
请综合生成面向患者的生活与饮食医嘱，仅输出 JSON 对象，不要额外说明：
{
  "diet": ["饮食/生活建议（结合指标趋势，如血压或血糖偏高应更严格控盐、控糖）"],
  "taboo": ["禁忌与注意事项"],
  "text": "一句话生活医嘱总结"
}
要求：建议具体、可执行；结合指标趋势给出针对性提示；简体中文。`;

  async function analyzeAdvice(opts) {
    const settings = opts.settings || {};
    const ctx = (opts.context || "").trim();
    if (!ctx) throw new Error("没有提供分析所需的医嘱与检查信息");
    const userParts = [{ type: "text", text: ctx }];
    const parsed = await _chatStream(ADVICE_SYSTEM, userParts, settings, opts.onChunk);
    const arr = (x) => (Array.isArray(x) ? x : []);
    return {
      diet: arr(parsed.diet).map((x) => String(x)),
      taboo: arr(parsed.taboo).map((x) => String(x)),
      text: String(parsed.text || ""),
    };
  }

  return { parse, isConfigured, SYSTEM_PROMPT, analyzeConsult, analyzeAdvice };
});
