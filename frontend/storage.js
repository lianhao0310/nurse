/*
 * 私人护士 · 本地持久化存储（v3）
 * ------------------------------------------------------------------
 * 数据模型（单文件 nurse-data.json）：
 * {
 *   version, updatedAt, lastDecrement,
 *   settings: {
 *     ai: { enabled, baseUrl, apiKey, model },
 *     notifications, largeFont,
 *     dailyDone: { "2026-08-14": { medDoses:{}, tasks:{} } },
 *     reminders: [ {id,title,type,date,time,enabled,note} ],
 *     reminderTimes: { morning, noon, evening }   // 用药提醒通知时间（早/中/晚）
 *   },
 *   records: [ {                          // 问诊记录
 *     id, createdAt, visitDate, hospital, doctor, source,
 *     transcript, images[],                // 原始归档（旧结构兼容）
 *     advice: { text, audio:{name,dataUrl}|null },   // 医嘱（文字/录音）
 *     examImages: [ {name,type,dataUrl} ],          // 检查结果照片
 *     examTable: [ {name,value,unit,range,abnormal} ],
 *     rxImages: [ {name,type,dataUrl} ],            // 处方药照片
 *     rxTable: [ {name,manufacturer,alias,spec,dose,freq,time,note} ], // 处方药表格（含厂家/别名/规格）
 *     result: { engine, diseases, medications, tasks, advice, risks, summary } | null, // AI分析转化结果
 *     aiAdvice: { diet:[], taboo:[], text } | null,  // 医嘱分析生成的生活/饮食医嘱
 *     archived,                                      // 已归档：检查结果已并入全局趋势/明细
 *     status, manual
 *   } ],
 *   cabinet: [ {                           // 我的药箱：每种药品一条记录
 *     id, name, disease,
 *     doseAmount, doseUnit,                // 单次使用量
 *     timeSlots: ["morning"|"noon"|"evening"],  // 服用时间段
 *     meal: "before"|"after"|"any",        // 餐前/餐后
 *     intro, precautions[], advice, note,
 *     manufacturer, alias,                 // 厂家 / 别名（直接属性）
 *     qty, unit,                           // 当前库存 / 单位
 *     status: "active"|"disabled"|"out",    // 状态
 *     dailyDose, threshold,                // 每日消耗 / 库存阈值
 *     history: [ {                         // 历史药品（曾用其他厂家）
 *       id, manufacturer, spec, alias, doseUnit, note, addedAt
 *     } ]
 *   } ],
 *   followedIndicators: ["血糖","血压"],    // 关注的检查指标（按名称）
 *   examResults: [ {                       // 我的检查结果（全局，按时间维度）
 *     id, recordId, hospital, date,
 *     indicators: [ {name,value,unit,range,abnormal} ]
 *   } ]
 * }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseStorage = api;
})(this, function () {
  "use strict";

  const FILE_NAME = "nurse-data.json";
  const LS_KEY = "nurse-data";
  const VERSION = 3;

  function fsAvailable() {
    try {
      return !!(
        typeof window !== "undefined" &&
        window.Capacitor &&
        window.Capacitor.isPluginAvailable &&
        window.Capacitor.isPluginAvailable("Filesystem") &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.Filesystem
      );
    } catch (e) {
      return false;
    }
  }
  function _fs() {
    return window.Capacitor.Plugins.Filesystem;
  }

  function _uid(prefix) {
    return (prefix || "id_") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // 给 meds / tasks / 表格 分配稳定 id（首页勾选、去重用）
  function _withIds(rec) {
    if (rec.result && Array.isArray(rec.result.medications)) {
      rec.result.medications.forEach((m) => {
        if (!m.id) m.id = _uid("med_");
      });
    }
    if (rec.result && Array.isArray(rec.result.tasks)) {
      rec.result.tasks.forEach((t) => {
        if (!t.id) t.id = _uid("task_");
      });
    }
    return rec;
  }

  // 用药提醒时间（早/中/晚）
  function _normReminderTimes(v) {
    const t = v && typeof v === "object" ? v : {};
    const ok = (x, def) => (/^\d{1,2}:\d{2}$/.test(x) ? (String(x).length === 5 ? x : "0" + x) : def);
    return { morning: ok(t.morning, "08:00"), noon: ok(t.noon, "12:30"), evening: ok(t.evening, "19:00") };
  }

  function _empty() {
    return {
      version: VERSION,
      updatedAt: null,
      lastDecrement: null,
      settings: {
        ai: { enabled: false, baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o" },
        notifications: false,
        largeFont: false,
        dailyDone: {},
        reminders: [],
        reminderTimes: { morning: "08:00", noon: "12:30", evening: "19:00" },
      },
      records: [],
      cabinet: [],
      examResults: [],
      followedIndicators: [],
    };
  }

  function _normSettings(s) {
    s = s && typeof s === "object" ? s : {};
    const ai = s.ai && typeof s.ai === "object" ? s.ai : {};
    return {
      ai: {
        enabled: !!ai.enabled,
        baseUrl: ai.baseUrl || "https://api.openai.com/v1",
        apiKey: ai.apiKey || "",
        model: ai.model || "gpt-4o",
      },
      notifications: !!s.notifications,
      largeFont: !!s.largeFont,
      dailyDone: s.dailyDone && typeof s.dailyDone === "object" ? s.dailyDone : {},
      reminders: _normReminders(s.reminders, s),
      reminderTimes: _normReminderTimes(s.reminderTimes),
    };
  }

  function _normReminder(r) {
    if (!r || typeof r !== "object") return null;
    if (!r.title || !String(r.title).trim()) return null;
    return {
      id: r.id || _uid("rem_"),
      title: String(r.title).trim(),
      type: r.type || "custom",
      date: r.date || "",
      time: r.time || "",
      enabled: r.enabled !== false,
      note: r.note || "",
    };
  }
  function _normReminders(arr, s) {
    if (Array.isArray(arr)) {
      const list = arr.map(_normReminder).filter(Boolean);
      if (list.length) return list;
    }
    if (s && s.nextVisit) {
      return [_normReminder({ title: "下次就诊", type: "visit", date: s.nextVisit })];
    }
    return [];
  }

  function _mergeSettings(target, patch) {
    const out = Object.assign({}, target);
    if (patch && typeof patch === "object") {
      for (const k in patch) {
        if (k === "ai" && patch.ai && typeof patch.ai === "object") {
          out.ai = Object.assign({}, out.ai, patch.ai);
        } else {
          out[k] = patch[k];
        }
      }
    }
    return out;
  }

  // ---------------- 药箱归一化（药品 + 多厂家规格变体） ----------------
  const TIME_SLOTS = ["morning", "noon", "evening"];
  function _normTimeSlots(v) {
    if (Array.isArray(v)) {
      const arr = v.filter((x) => TIME_SLOTS.includes(x));
      if (arr.length) return arr;
    }
    return ["morning"];
  }
  function _normMeal(v) {
    return ["before", "after", "any"].includes(v) ? v : "any";
  }

  function _normVariant(v) {
    if (!v || typeof v !== "object") return null;
    const status = ["active", "disabled", "out"].includes(v.status) ? v.status : "active";
    return {
      id: v.id || _uid("var_"),
      manufacturer: v.manufacturer || "",
      spec: v.spec || "",
      alias: v.alias || "",
      qty: Number(v.qty) || 0,
      unit: v.unit || "片",
      status: status,
      dailyDose: Number(v.dailyDose) || 0,
      threshold: Number(v.threshold) || 0,
    };
  }

  function _normDrug(it) {
    if (!it || typeof it !== "object") return null;
    if (!it.name || !String(it.name).trim()) return null;
    // 迁移：旧「多厂家规格变体」 -> 当前厂家直接属性 + 其余厂家转入历史药品
    let variants = Array.isArray(it.variants) ? it.variants.map(_normVariant).filter(Boolean) : [];
    let history = Array.isArray(it.history) ? it.history.map(_normHistoryItem).filter(Boolean) : [];
    let manufacturer = it.manufacturer || "";
    let alias = it.alias || "";
    let qty = Number(it.qty) || 0;
    let unit = it.unit || "片";
    let status = ["active", "disabled", "out"].includes(it.status) ? it.status : "active";
    let dailyDose = Number(it.dailyDose) || 0;
    let threshold = Number(it.threshold) || 0;
    if (variants.length) {
      const primary = variants.find((v) => v.status === "active") || variants[0];
      manufacturer = primary.manufacturer;
      alias = primary.alias && primary.alias !== it.name ? primary.alias : it.alias || "";
      qty = primary.qty;
      unit = primary.unit;
      status = primary.status;
      dailyDose = primary.dailyDose;
      threshold = primary.threshold;
      // 其余变体（曾用厂家）转入历史药品
      variants.filter((v) => v !== primary).forEach((v) => history.unshift(_varToHistory(v)));
    }
    return {
      id: it.id || _uid("drug_"),
      name: String(it.name).trim(),
      disease: it.disease || "",
      doseAmount: Number(it.doseAmount) || 0,
      doseUnit: it.doseUnit || "片",
      timeSlots: _normTimeSlots(it.timeSlots),
      meal: _normMeal(it.meal),
      intro: it.intro || "",
      precautions: Array.isArray(it.precautions) ? it.precautions.filter(Boolean) : [],
      advice: it.advice || "",
      note: it.note || "",
      manufacturer,
      alias,
      qty,
      unit,
      status,
      dailyDose,
      threshold,
      history,
    };
  }

  // 药品名称（含别名）用于检索
  function drugNames(drug) {
    const names = [drug.name];
    if (drug.alias && String(drug.alias).trim() && !names.includes(String(drug.alias).trim())) names.push(String(drug.alias).trim());
    return names;
  }

  // 历史药品（曾用其他厂家）：厂家 / 规格 / 别名 / 单位剂量 / 备注
  function _normHistoryItem(h) {
    if (!h || typeof h !== "object") return null;
    return {
      id: h.id || _uid("his_"),
      manufacturer: h.manufacturer || "",
      spec: h.spec || "",
      alias: h.alias || "",
      doseUnit: h.doseUnit || h.unit || "片",
      note: h.note || "",
      addedAt: h.addedAt || "",
    };
  }
  function _varToHistory(v) {
    return {
      id: _uid("his_"),
      manufacturer: v.manufacturer || "",
      spec: v.spec || "",
      alias: v.alias || "",
      doseUnit: v.unit || "片",
      note: "",
      addedAt: "",
    };
  }

  // ---------------- 问诊记录归一化 ----------------
  function _normExamIndicator(x) {
    if (!x || typeof x !== "object") return null;
    if (!x.name || !String(x.name).trim()) return null;
    return {
      name: String(x.name).trim(),
      value: x.value === 0 || x.value ? String(x.value) : "",
      unit: x.unit || "",
      range: x.range || "",
      abnormal: !!x.abnormal,
    };
  }
  function _normRx(x) {
    if (!x || typeof x !== "object") return null;
    if (!x.name || !String(x.name).trim()) return null;
    return {
      name: String(x.name).trim(),
      manufacturer: x.manufacturer || "",
      alias: x.alias || "",
      spec: x.spec || "",
      dose: x.dose || "",
      freq: x.freq || "",
      time: x.time || "",
      note: x.note || "",
    };
  }
  function _normImage(im) {
    if (!im || !im.dataUrl) return null;
    return { name: im.name || "image", type: im.type || "image/jpeg", dataUrl: im.dataUrl };
  }

  function _normRecord(r) {
    if (!r || typeof r !== "object") return null;
    if (!(r.result || (r.images && r.images.length) || r.transcript || r.advice || r.examTable || r.rxTable)) return null;
    const rec = {
      id: r.id || _uid("rec_"),
      createdAt: r.createdAt || new Date().toISOString(),
      visitDate: r.visitDate || "",
      hospital: r.hospital || "",
      doctor: r.doctor || "",
      source: r.source || (r.transcript ? "text" : "upload"),
      transcript: r.transcript || "",
      images: Array.isArray(r.images) ? r.images.map(_normImage).filter(Boolean) : [],
      // 新版字段
      advice: r.advice && typeof r.advice === "object" ? { text: r.advice.text || "", audio: _normImage(r.advice.audio) } : { text: r.transcript || "", audio: null },
      examImages: Array.isArray(r.examImages) ? r.examImages.map(_normImage).filter(Boolean) : [],
      examTable: Array.isArray(r.examTable) ? r.examTable.map(_normExamIndicator).filter(Boolean) : [],
      rxImages: Array.isArray(r.rxImages) ? r.rxImages.map(_normImage).filter(Boolean) : [],
      rxTable: Array.isArray(r.rxTable) ? r.rxTable.map(_normRx).filter(Boolean) : [],
      result: r.result || null,
      aiAdvice: r.aiAdvice && typeof r.aiAdvice === "object" ? { diet: (r.aiAdvice.diet || []).filter(Boolean), taboo: (r.aiAdvice.taboo || []).filter(Boolean), text: r.aiAdvice.text || "", createdAt: r.aiAdvice.createdAt || "" } : null,
      manual: !!r.manual,
      archived: !!r.archived,
      status: r.status || "done",
    };
    // 旧数据：result 里的 medications 同步到 rxTable（去重）
    if (rec.result && Array.isArray(rec.result.medications) && !rec.rxTable.length) {
      rec.rxTable = rec.result.medications
        .map((m) => _normRx({ name: m.name, spec: m.dose, dose: m.dose, freq: m.freq, time: m.time, note: m.note }))
        .filter(Boolean);
    }
    return _withIds(rec);
  }

  // 全局检查结果归一化
  function _normExamEntry(e) {
    if (!e || typeof e !== "object") return null;
    const inds = Array.isArray(e.indicators) ? e.indicators.map(_normExamIndicator).filter(Boolean) : [];
    if (!inds.length) return null;
    return {
      id: e.id || _uid("ex_"),
      recordId: e.recordId || "",
      hospital: e.hospital || "",
      date: e.date || "",
      indicators: inds,
    };
  }

  function _normalize(obj) {
    const data = _empty();
    if (obj && typeof obj === "object") {
      data.settings = _normSettings(obj.settings);
      data.updatedAt = obj.updatedAt || null;
      data.lastDecrement = obj.lastDecrement || null;
      if (Array.isArray(obj.records)) {
        data.records = obj.records.map(_normRecord).filter(Boolean);
      }
      if (Array.isArray(obj.cabinet)) {
        data.cabinet = obj.cabinet.map(_normDrug).filter(Boolean);
      }
      if (Array.isArray(obj.examResults)) {
        data.examResults = obj.examResults.map(_normExamEntry).filter(Boolean);
      }
      if (Array.isArray(obj.followedIndicators)) {
        data.followedIndicators = obj.followedIndicators.filter((x) => x && typeof x === "string" && x.trim());
      }
    }
    return data;
  }

  // ---------------- 读取 / 写入 ----------------
  async function load() {
    if (fsAvailable()) {
      try {
        const res = await _fs().readFile({ path: FILE_NAME, directory: "Documents", encoding: "utf8" });
        return _normalize(JSON.parse(res.data));
      } catch (e) {
        return _empty();
      }
    }
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      return raw ? _normalize(JSON.parse(raw)) : _empty();
    } catch (e) {
      return _empty();
    }
  }

  async function save(data) {
    data = _normalize(data);
    data.updatedAt = new Date().toISOString();
    if (fsAvailable()) {
      await _fs().writeFile({ path: FILE_NAME, data: JSON.stringify(data), directory: "Documents", encoding: "utf8" });
    } else {
      window.localStorage.setItem(LS_KEY, JSON.stringify(data));
    }
    return data;
  }

  // ---------------- 记录（问诊历史） ----------------
  async function appendRecord(record) {
    const data = await load();
    const rec = _withIds({
      id: _uid("rec_"),
      createdAt: new Date().toISOString(),
      visitDate: record.visitDate || "",
      hospital: record.hospital || "",
      doctor: record.doctor || "",
      source: record.source || "text",
      transcript: record.transcript || "",
      images: record.images || [],
      advice: record.advice || { text: "", audio: null },
      examImages: record.examImages || [],
      examTable: record.examTable || [],
      rxImages: record.rxImages || [],
      rxTable: record.rxTable || [],
      result: record.result || null,
      aiAdvice: record.aiAdvice || null,
      manual: !!record.manual,
      status: record.status || "done",
    });
    data.records.unshift(rec);
    await save(data);
    return rec;
  }
  async function getRecords() {
    return (await load()).records;
  }
  async function getRecord(id) {
    return (await load()).records.find((r) => r.id === id) || null;
  }
  async function updateRecord(id, patch) {
    const data = await load();
    const rec = data.records.find((r) => r.id === id);
    if (!rec) return null;
    Object.assign(rec, patch);
    _withIds(rec);
    await save(data);
    return rec;
  }
  async function deleteRecord(id) {
    const data = await load();
    data.records = data.records.filter((r) => r.id !== id);
    // 同步删除该记录产生的全局检查结果
    data.examResults = data.examResults.filter((e) => e.recordId !== id);
    await save(data);
  }

  // ---------------- 我的药箱（药品 + 变体） ----------------
  async function getCabinet() {
    return (await load()).cabinet;
  }
  async function upsertDrug(item) {
    const data = await load();
    const it = _normDrug(item);
    if (!it) return null;
    const exist = item && item.id ? data.cabinet.find((x) => x.id === item.id) : null;
    if (exist) Object.assign(exist, it);
    else data.cabinet.unshift(it);
    await save(data);
    return it;
  }
  async function updateDrug(id, patch) {
    const data = await load();
    const it = data.cabinet.find((x) => x.id === id);
    if (!it) return null;
    const merged = _normDrug(Object.assign({}, it, patch));
    if (!merged) return null;
    Object.assign(it, merged);
    await save(data);
    return it;
  }
  async function deleteDrug(id) {
    const data = await load();
    data.cabinet = data.cabinet.filter((x) => x.id !== id);
    await save(data);
  }
  // 变体级操作
  async function upsertVariant(drugId, variant) {
    const data = await load();
    const drug = data.cabinet.find((x) => x.id === drugId);
    if (!drug) return null;
    const v = _normVariant(variant);
    if (!v) return null;
    const exist = variant && variant.id ? drug.variants.find((x) => x.id === variant.id) : null;
    if (exist) Object.assign(exist, v);
    else drug.variants.unshift(v);
    await save(data);
    return v;
  }
  async function deleteVariant(drugId, variantId) {
    const data = await load();
    const drug = data.cabinet.find((x) => x.id === drugId);
    if (!drug) return null;
    drug.variants = drug.variants.filter((x) => x.id !== variantId);
    await save(data);
  }
  // 历史药品（曾用其他厂家）
  async function addDrugHistory(drugId, item) {
    const data = await load();
    const drug = data.cabinet.find((x) => x.id === drugId);
    if (!drug) return null;
    drug.history = drug.history || [];
    drug.history.unshift(_normHistoryItem(item));
    await save(data);
    return drug;
  }
  async function deleteDrugHistory(drugId, historyId) {
    const data = await load();
    const drug = data.cabinet.find((x) => x.id === drugId);
    if (!drug) return null;
    drug.history = (drug.history || []).filter((x) => x.id !== historyId);
    await save(data);
    return drug;
  }
  async function setLastDecrement(dateKey) {
    const data = await load();
    data.lastDecrement = dateKey;
    await save(data);
  }

  // ---------------- 全局检查结果 ----------------
  async function getExamResults() {
    return (await load()).examResults;
  }
  async function upsertExamEntry(entry) {
    const data = await load();
    const e = _normExamEntry(entry);
    if (!e) return null;
    const exist = entry && entry.id ? data.examResults.find((x) => x.id === entry.id) : null;
    if (exist) Object.assign(exist, e);
    else data.examResults.unshift(e);
    await save(data);
    return e;
  }
  async function deleteExamEntry(id) {
    const data = await load();
    data.examResults = data.examResults.filter((x) => x.id !== id);
    await save(data);
  }
  // 关注指标（按指标名称）
  async function setFollowedIndicators(arr) {
    const data = await load();
    data.followedIndicators = Array.isArray(arr) ? arr.filter((x) => x && typeof x === "string" && x.trim()) : [];
    await save(data);
    return data.followedIndicators;
  }

  // ---------------- 设置 ----------------
  async function updateSettings(patch) {
    const data = await load();
    data.settings = _mergeSettings(data.settings, patch);
    await save(data);
    return data.settings;
  }

  // ---------------- 今日勾选状态 ----------------
  async function getDone(dateKey) {
    const s = (await load()).settings;
    const d = (s.dailyDone && s.dailyDone[dateKey]) || {};
    return { medDoses: d.medDoses || {}, tasks: d.tasks || {} };
  }
  async function setDone(dateKey, kind, id, done) {
    const data = await load();
    if (!data.settings.dailyDone[dateKey]) data.settings.dailyDone[dateKey] = { medDoses: {}, tasks: {} };
    const bucket = data.settings.dailyDone[dateKey][kind] || (data.settings.dailyDone[dateKey][kind] = {});
    if (done) bucket[id] = true;
    else delete bucket[id];
    const keys = Object.keys(data.settings.dailyDone).sort();
    while (keys.length > 7) delete data.settings.dailyDone[keys.shift()];
    await save(data);
  }

  // ---------------- 导出 / 导入 ----------------
  async function exportJSON() {
    return JSON.stringify(await load(), null, 2);
  }
  async function importJSON(jsonStr) {
    const incoming = _normalize(JSON.parse(jsonStr));
    const cur = await load();
    const map = {};
    cur.records.forEach((r) => (map[r.id] = r));
    incoming.records.forEach((r) => (map[r.id] = r));
    cur.records = Object.values(map).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    cur.cabinet = incoming.cabinet.length ? incoming.cabinet : cur.cabinet;
    cur.examResults = incoming.examResults.length ? incoming.examResults : cur.examResults;
    cur.settings = _mergeSettings(cur.settings, incoming.settings);
    await save(cur);
    return cur;
  }

  return {
    FILE_NAME,
    isNative: fsAvailable,
    load,
    save,
    appendRecord,
    getRecords,
    getRecord,
    updateRecord,
    deleteRecord,
    getCabinet,
    upsertDrug,
    updateDrug,
    deleteDrug,
    upsertVariant,
    deleteVariant,
    addDrugHistory,
    deleteDrugHistory,
    getExamResults,
    upsertExamEntry,
    deleteExamEntry,
    setFollowedIndicators,
    updateSettings,
    getDone,
    setDone,
    setLastDecrement,
    exportJSON,
    importJSON,
    drugNames,
  };
});
