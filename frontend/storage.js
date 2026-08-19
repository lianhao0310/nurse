/*
 * 私人护士 · 本地持久化存储（v3 · 药单/检查报告架构）
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
 *     transcript, images[],
 *     advice: { text, audio:{name,dataUrl}|null },
 *     orderId: string|null,               // 关联药单（hospital 属性）
 *     reportId: string|null,              // 关联检查报告（hospital 属性）
 *     result: { ... } | null,             // AI分析转化结果
 *     aiAdvice: { diet:[], taboo:[], text } | null,
 *     status, manual
 *   } ],
 *   orders: [ {                           // 药单
 *     id, source, date,
 *     kind: "custom"|"hospital", recordId,
 *     medicines: [ { id, name, manufacturer, alias, unit, spec,
 *                    qty, doseAmount, doseUnit, timeSlots, meal,
 *                    dailyDose, threshold, status, note } ],
 *     images[]                           // 药单/处方照片
 *   } ],
 *   reports: [ {                          // 检查报告
 *     id, title, date,
 *     kind: "self"|"hospital", recordId,
 *     indicators: [ {name,value,unit,range,abnormal} ],
 *     images[]                           // 报告照片
 *   } ],
 *   followedIndicators: ["血糖","血压"]     // 关注的检查指标（按名称）
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

  // 给 meds / tasks 分配稳定 id
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
      orders: [],
      reports: [],
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

  // ---------------- 药单（order）归一化 ----------------
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
  function _normStatus(v) {
    return ["active", "disabled", "out"].includes(v) ? v : "active";
  }

  // 药单内的单个药品条目
  function _normMedicine(m) {
    if (!m || typeof m !== "object") return null;
    if (!m.name || !String(m.name).trim()) return null;
    return {
      id: m.id || _uid("med_"),
      name: String(m.name).trim(),
      manufacturer: m.manufacturer || "",
      alias: m.alias || "",
      unit: m.unit || "片",
      spec: m.spec || "",
      qty: Number(m.qty) || 0,
      doseAmount: Number(m.doseAmount) || 0,
      doseUnit: m.doseUnit || "片",
      timeSlots: _normTimeSlots(m.timeSlots),
      meal: _normMeal(m.meal),
      dailyDose: Number(m.dailyDose) || 0,
      threshold: Number(m.threshold) || 0,
      status: _normStatus(m.status),
      note: m.note || "",
    };
  }

  function _normOrder(o) {
    if (!o || typeof o !== "object") return null;
    if (!o.source || !String(o.source).trim()) return null;
    const medicines = Array.isArray(o.medicines) ? o.medicines.map(_normMedicine).filter(Boolean) : [];
    return {
      id: o.id || _uid("ord_"),
      source: String(o.source).trim(),
      date: o.date || "",
      kind: o.kind === "hospital" ? "hospital" : "custom",
      recordId: o.recordId || "",
      medicines,
      images: Array.isArray(o.images) ? o.images.map(_normImage).filter(Boolean) : [],
    };
  }

  // 药品名称（含别名）用于检索
  function drugNames(med) {
    const names = [med.name];
    if (med.alias && String(med.alias).trim() && !names.includes(String(med.alias).trim())) names.push(String(med.alias).trim());
    return names;
  }

  // ---------------- 检查报告（report）归一化 ----------------
  function _normIndicator(x) {
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
  function _normReport(rp) {
    if (!rp || typeof rp !== "object") return null;
    const indicators = Array.isArray(rp.indicators) ? rp.indicators.map(_normIndicator).filter(Boolean) : [];
    return {
      id: rp.id || _uid("rep_"),
      title: rp.title || "检查报告",
      date: rp.date || "",
      kind: rp.kind === "self" ? "self" : "hospital",
      recordId: rp.recordId || "",
      indicators,
      images: Array.isArray(rp.images) ? rp.images.map(_normImage).filter(Boolean) : [],
    };
  }

  // ---------------- 问诊记录归一化 ----------------
  function _normImage(im) {
    if (!im || !im.dataUrl) return null;
    return { name: im.name || "image", type: im.type || "image/jpeg", dataUrl: im.dataUrl };
  }
  function _normRecord(r) {
    if (!r || typeof r !== "object") return null;
    if (!(r.result || (r.images && r.images.length) || r.transcript || r.advice)) return null;
    const rec = {
      id: r.id || _uid("rec_"),
      createdAt: r.createdAt || new Date().toISOString(),
      visitDate: r.visitDate || "",
      hospital: r.hospital || "",
      doctor: r.doctor || "",
      source: r.source || (r.transcript ? "text" : "upload"),
      transcript: r.transcript || "",
      images: Array.isArray(r.images) ? r.images.map(_normImage).filter(Boolean) : [],
      advice: r.advice && typeof r.advice === "object" ? { text: r.advice.text || "", audio: _normImage(r.advice.audio) } : { text: r.transcript || "", audio: null },
      orderId: r.orderId || "",
      reportId: r.reportId || "",
      result: r.result || null,
      aiAdvice: r.aiAdvice && typeof r.aiAdvice === "object" ? { diet: (r.aiAdvice.diet || []).filter(Boolean), taboo: (r.aiAdvice.taboo || []).filter(Boolean), text: r.aiAdvice.text || "", createdAt: r.aiAdvice.createdAt || "" } : null,
      manual: !!r.manual,
      status: r.status || "done",
    };
    return _withIds(rec);
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
      if (Array.isArray(obj.orders)) {
        data.orders = obj.orders.map(_normOrder).filter(Boolean);
      }
      if (Array.isArray(obj.reports)) {
        data.reports = obj.reports.map(_normReport).filter(Boolean);
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
      orderId: record.orderId || "",
      reportId: record.reportId || "",
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
    // 同步删除该记录关联的药单 / 检查报告（recordId 关联）
    data.orders = data.orders.filter((o) => o.recordId !== id);
    data.reports = data.reports.filter((rp) => rp.recordId !== id);
    await save(data);
  }

  // ---------------- 药单（order） ----------------
  async function getOrders() {
    return (await load()).orders;
  }
  async function getOrder(id) {
    return (await load()).orders.find((o) => o.id === id) || null;
  }
  async function upsertOrder(item) {
    const data = await load();
    const it = _normOrder(item);
    if (!it) return null;
    const exist = item && item.id ? data.orders.find((x) => x.id === item.id) : null;
    if (exist) Object.assign(exist, it);
    else data.orders.unshift(it);
    await save(data);
    return it;
  }
  async function updateOrder(id, patch) {
    const data = await load();
    const it = data.orders.find((x) => x.id === id);
    if (!it) return null;
    const merged = _normOrder(Object.assign({}, it, patch));
    if (!merged) return null;
    Object.assign(it, merged);
    await save(data);
    return it;
  }
  async function deleteOrder(id) {
    const data = await load();
    data.orders = data.orders.filter((x) => x.id !== id);
    // 同步清理关联问诊记录的 orderId
    data.records.forEach((r) => {
      if (r.orderId === id) r.orderId = "";
    });
    await save(data);
  }

  // ---------------- 检查报告（report） ----------------
  async function getReports() {
    return (await load()).reports;
  }
  async function getReport(id) {
    return (await load()).reports.find((r) => r.id === id) || null;
  }
  async function upsertReport(item) {
    const data = await load();
    const it = _normReport(item);
    if (!it) return null;
    const exist = item && item.id ? data.reports.find((x) => x.id === item.id) : null;
    if (exist) Object.assign(exist, it);
    else data.reports.unshift(it);
    await save(data);
    return it;
  }
  async function updateReport(id, patch) {
    const data = await load();
    const it = data.reports.find((x) => x.id === id);
    if (!it) return null;
    const merged = _normReport(Object.assign({}, it, patch));
    if (!merged) return null;
    Object.assign(it, merged);
    await save(data);
    return it;
  }
  async function deleteReport(id) {
    const data = await load();
    data.reports = data.reports.filter((x) => x.id !== id);
    // 同步清理关联问诊记录的 reportId
    data.records.forEach((r) => {
      if (r.reportId === id) r.reportId = "";
    });
    await save(data);
  }

  // ---------------- 汇总工具：药箱页按药名合并所有药单的药品 ----------------
  // 返回 [{ name, manufacturer, alias, unit, spec, qty(合并), status, doseAmount, doseUnit, timeSlots, meal, dailyDose, threshold, orderIds:[], count }]
  function summarizeMedicines(orders) {
    const map = {};
    (orders || []).forEach((o) => {
      (o.medicines || []).forEach((m) => {
        const key = (m.name || "").trim();
        if (!key) return;
        if (!map[key]) {
          map[key] = {
            name: key,
            manufacturer: m.manufacturer || "",
            alias: m.alias || "",
            unit: m.unit || "片",
            spec: m.spec || "",
            qty: 0,
            status: m.status === "disabled" ? "disabled" : "active",
            doseAmount: m.doseAmount || 0,
            doseUnit: m.doseUnit || "片",
            timeSlots: (m.timeSlots || []).slice(),
            meal: m.meal || "any",
            dailyDose: Number(m.dailyDose) || 0,
            threshold: Number(m.threshold) || 0,
            orderIds: [],
            occurrences: 0,
          };
        }
        const s = map[key];
        s.qty += Number(m.qty) || 0;
        s.occurrences++;
        if (s.orderIds.indexOf(o.id) < 0) s.orderIds.push(o.id);
        // 汇总层级：只要任一在使用中则视为 active，全 disabled 则 disabled
        if (m.status === "disabled" && s.status === "active") {
          // 若还有 active 则保持 active；这里先保持简单：任一 disabled 时标记为 mixed 用 out 兼容
          if (!(o.medicines.some((mm) => mm.name.trim() === key && mm.status === "active"))) s.status = "disabled";
        }
      });
    });
    return Object.values(map);
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

  // 关注指标（按指标名称）
  async function setFollowedIndicators(arr) {
    const data = await load();
    data.followedIndicators = Array.isArray(arr) ? arr.filter((x) => x && typeof x === "string" && x.trim()) : [];
    await save(data);
    return data.followedIndicators;
  }

  // ---------------- 每日扣减 ----------------
  async function setLastDecrement(dateKey) {
    const data = await load();
    data.lastDecrement = dateKey;
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
    cur.orders = incoming.orders.length ? incoming.orders : cur.orders;
    cur.reports = incoming.reports.length ? incoming.reports : cur.reports;
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
    getOrders,
    getOrder,
    upsertOrder,
    updateOrder,
    deleteOrder,
    getReports,
    getReport,
    upsertReport,
    updateReport,
    deleteReport,
    summarizeMedicines,
    updateSettings,
    getDone,
    setDone,
    setFollowedIndicators,
    setLastDecrement,
    exportJSON,
    importJSON,
    drugNames,
  };
});
