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
 *     medicines: [ { id, name, manufacturer, alias, qty, price } ],  // 药单条目（qty=本药单配药数量, price=单价）
 *     images[]                           // 药单/处方照片
 *   } ],
 *   cabinet: [ {                          // 药箱药品（主档，按药名唯一）
 *     id, name, manufacturer, alias,
 *     unit, spec, qty(库存),
 *     doseAmount, doseUnit, timeSlots, meal,
 *     threshold, status, note, disease
 *   } ],
 *   reports: [ {                          // 检查报告
 *     id, title, date,
 *     kind: "self"|"hospital", recordId,
 *     indicators: [ {name,value,unit,range,abnormal} ],
 *     images[]                           // 报告照片
 *   } ],
 *   indicatorMeta: { "血糖": {unit:"mmol/L", range:"3.9-6.1"} },  // 指标单位/参考值记忆（隐式维护）
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
      cabinet: [],
      reports: [],
      indicatorMeta: {},
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

  // 药单内的单个药品条目（只记 药名/厂家/别名/数量；主属性归药箱 cabinet）
  function _normMedicine(m) {
    if (!m || typeof m !== "object") return null;
    if (!m.name || !String(m.name).trim()) return null;
    return {
      id: m.id || _uid("med_"),
      name: String(m.name).trim(),
      manufacturer: m.manufacturer || "",
      alias: m.alias || "",
      qty: Number(m.qty) || 0,
      price: Number(m.price) || 0,
    };
  }

  // 药箱药品主档（按药名唯一）
  function _normCabinetDrug(c) {
    if (!c || typeof c !== "object") return null;
    if (!c.name || !String(c.name).trim()) return null;
    return {
      id: c.id || _uid("cab_"),
      name: String(c.name).trim(),
      manufacturer: c.manufacturer || "",
      alias: c.alias || "",
      unit: c.unit || "片",
      spec: c.spec || "",
      qty: Number(c.qty) || 0,
      doseAmount: Number(c.doseAmount) || 0,
      doseUnit: c.doseUnit || "片",
      timeSlots: _normTimeSlots(c.timeSlots),
      meal: _normMeal(c.meal),
      threshold: Number(c.threshold) || 0,
      status: _normStatus(c.status),
      note: c.note || "",
      disease: c.disease || "",
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

  // 旧版迁移：order.medicine 上的主属性抽取到 cabinet（按药名合并）
  // 返回 cabinet 数组；幂等——cabinet 已存在（数组）则直接归一化
  function _migrateCabinet(obj) {
    if (Array.isArray(obj.cabinet)) {
      return obj.cabinet.map(_normCabinetDrug).filter(Boolean);
    }
    const map = {};
    (Array.isArray(obj.orders) ? obj.orders : []).forEach((o) => {
      (o.medicines || []).forEach((m) => {
        if (!m || !m.name) return;
        const key = String(m.name).trim();
        if (!key) return;
        if (!map[key]) {
          map[key] = {
            name: key,
            manufacturer: m.manufacturer || "",
            alias: m.alias || "",
            unit: m.unit || "片",
            spec: m.spec || "",
            qty: 0,
            doseAmount: Number(m.doseAmount) || 0,
            doseUnit: m.doseUnit || "片",
            timeSlots: m.timeSlots || ["morning"],
            meal: m.meal || "any",
            threshold: Number(m.threshold) || 0,
            status: m.status || "active",
            note: m.note || "",
          };
        }
        // 旧模型库存按药单 qty 汇总（每日扣减直接改药单条目 qty），求和即当前库存
        map[key].qty += Number(m.qty) || 0;
        if (map[key].status !== "active" && m.status === "active") map[key].status = "active";
      });
    });
    return Object.values(map).map(_normCabinetDrug).filter(Boolean);
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
      // cabinet（含旧版自动迁移）
      data.cabinet = _migrateCabinet(obj);
      if (Array.isArray(obj.orders)) {
        data.orders = obj.orders.map(_normOrder).filter(Boolean);
      }
      if (Array.isArray(obj.reports)) {
        data.reports = obj.reports.map(_normReport).filter(Boolean);
      }
      if (obj.indicatorMeta && typeof obj.indicatorMeta === "object") {
        const meta = {};
        for (const k in obj.indicatorMeta) {
          const v = obj.indicatorMeta[k];
          if (!v || typeof v !== "object") continue;
          meta[k] = { unit: String(v.unit || ""), range: String(v.range || "") };
        }
        data.indicatorMeta = meta;
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
    const recOrders = data.orders.filter((o) => o.recordId === id);
    data.records = data.records.filter((r) => r.id !== id);
    data.orders = data.orders.filter((o) => o.recordId !== id);
    data.reports = data.reports.filter((rp) => rp.recordId !== id);
    // 级联删除关联药单时同步回退药箱库存 / 清理无引用药品
    recOrders.forEach((o) => _removeOrderFromCabinet(data, o));
    await save(data);
  }

  // ---------------- 药箱库存 同步 ----------------
  // 药单保存前后 diff：按条目 id 对齐，qty 差额累加到 cabinet；被删条目回退并清理无引用药品
  // fullMap: { 药名 → 主属性 }（仅新药填写全属性时提供）；excludeOrder：当前正在编辑的药单（引用检查时排除）
  function _syncCabinetDiff(data, oldMeds, newMeds, fullMap, excludeOrder) {
    const oldMap = {};
    (oldMeds || []).forEach((m) => (oldMap[m.id] = m));
    (newMeds || []).forEach((nm) => {
      const om = oldMap[nm.id] || null;
      const delta = Number(nm.qty || 0) - (om ? Number(om.qty || 0) : 0);
      const full = fullMap ? fullMap[nm.name] : null;
      if (delta !== 0 || full) _adjustCabinet(data, nm, delta, full);
      if (om) delete oldMap[nm.id];
    });
    // 被删除的条目：回退数量；药名无任何药单（含本次新列表）引用 → 删除药箱药品
    Object.keys(oldMap).forEach((k) => {
      const om = oldMap[k];
      _adjustCabinet(data, om, -Number(om.qty || 0), null);
      const name = (om.name || "").trim();
      if (!name) return;
      const stillInNew = (newMeds || []).some((nm) => (nm.name || "").trim() === name);
      const inOthers = data.orders.some((o) => o !== excludeOrder && (o.medicines || []).some((m) => (m.name || "").trim() === name));
      if (!stillInNew && !inOthers) data.cabinet = data.cabinet.filter((c) => c.name !== name);
    });
  }
  function _adjustCabinet(data, med, delta, full) {
    const name = (med.name || "").trim();
    if (!name) return;
    let cab = data.cabinet.find((c) => c.name === name);
    if (!cab) {
      if (delta <= 0 && !full) return; // 回退但药箱无此药，忽略
      cab = _normCabinetDrug(Object.assign({ name: name, manufacturer: med.manufacturer || "", alias: med.alias || "", qty: Math.max(0, delta) }, full || {}));
      if (cab) data.cabinet.push(cab);
      return;
    }
    cab.qty = Math.max(0, Math.round((Number(cab.qty || 0) + delta) * 100) / 100);
    if (full) {
      const merged = _normCabinetDrug(Object.assign({}, cab, full, { qty: cab.qty }));
      if (merged) Object.assign(cab, merged);
    }
  }
  // 删除药单：回退每条数量；药名无其他药单引用 → 删除药箱药品
  function _removeOrderFromCabinet(data, order) {
    const remaining = new Set();
    data.orders.forEach((o) => (o.medicines || []).forEach((m) => remaining.add((m.name || "").trim())));
    (order.medicines || []).forEach((m) => {
      const name = (m.name || "").trim();
      const cab = data.cabinet.find((c) => c.name === name);
      if (cab) cab.qty = Math.max(0, Math.round((Number(cab.qty || 0) - Number(m.qty || 0)) * 100) / 100);
      if (name && !remaining.has(name)) data.cabinet = data.cabinet.filter((c) => c.name !== name);
    });
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
    if (exist) {
      _syncCabinetDiff(data, exist.medicines, it.medicines, item._full, exist);
      Object.assign(exist, it);
    } else {
      _syncCabinetDiff(data, [], it.medicines, item._full, null);
      data.orders.unshift(it);
    }
    await save(data);
    return it;
  }
  async function updateOrder(id, patch) {
    const data = await load();
    const it = data.orders.find((x) => x.id === id);
    if (!it) return null;
    const oldMeds = (it.medicines || []).map((m) => Object.assign({}, m));
    const merged = _normOrder(Object.assign({}, it, patch));
    if (!merged) return null;
    if (patch && Array.isArray(patch.medicines)) _syncCabinetDiff(data, oldMeds, merged.medicines, patch._full, it);
    Object.assign(it, merged);
    await save(data);
    return it;
  }
  async function deleteOrder(id) {
    const data = await load();
    const order = data.orders.find((x) => x.id === id) || null;
    data.orders = data.orders.filter((x) => x.id !== id);
    // 同步清理关联问诊记录的 orderId
    data.records.forEach((r) => {
      if (r.orderId === id) r.orderId = "";
    });
    // 回退药箱库存 / 清理无引用药品
    if (order) _removeOrderFromCabinet(data, order);
    await save(data);
  }

  // ---------------- 药箱药品（cabinet） ----------------
  async function getCabinetDrugs() {
    return (await load()).cabinet;
  }
  async function getCabinetDrug(id) {
    return (await load()).cabinet.find((c) => c.id === id) || null;
  }
  async function upsertCabinetDrug(item) {
    const data = await load();
    const it = _normCabinetDrug(item);
    if (!it) return null;
    const exist = item && item.id ? data.cabinet.find((c) => c.id === item.id) : null;
    const byName = !exist ? data.cabinet.find((c) => c.name === it.name) : null;
    const target = exist || byName;
    if (target) Object.assign(target, it);
    else data.cabinet.unshift(it);
    await save(data);
    return it;
  }
  async function updateCabinetDrug(id, patch) {
    const data = await load();
    const it = data.cabinet.find((c) => c.id === id);
    if (!it) return null;
    const merged = _normCabinetDrug(Object.assign({}, it, patch));
    if (!merged) return null;
    Object.assign(it, merged);
    await save(data);
    return it;
  }
  async function deleteCabinetDrug(id) {
    const data = await load();
    const cab = data.cabinet.find((c) => c.id === id);
    if (!cab) return;
    data.cabinet = data.cabinet.filter((c) => c.id !== id);
    // 同步从所有药单条目中移除该药（保持引用一致）
    data.orders.forEach((o) => {
      o.medicines = (o.medicines || []).filter((m) => (m.name || "").trim() !== cab.name);
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
  // 返回 [{ name, manufacturer, alias, unit, spec, qty(合并), status, doseAmount, doseUnit, timeSlots, meal, threshold, orderIds:[], count }]
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

  // 指标单位/参考值记忆（隐式维护，合并写入；非空字段优先，空值不覆盖已有记忆）
  async function setIndicatorMeta(map) {
    const data = await load();
    if (map && typeof map === "object") {
      for (const k in map) {
        const v = map[k];
        if (!v || typeof v !== "object") continue;
        const unit = String(v.unit || "");
        const range = String(v.range || "");
        const cur = data.indicatorMeta[k] || { unit: "", range: "" };
        const next = { unit: unit || cur.unit, range: range || cur.range };
        if (!next.unit && !next.range) continue;
        data.indicatorMeta[k] = next;
      }
    }
    await save(data);
    return data.indicatorMeta;
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
    cur.cabinet = incoming.cabinet.length ? incoming.cabinet : cur.cabinet;
    cur.indicatorMeta = Object.keys(incoming.indicatorMeta || {}).length ? incoming.indicatorMeta : cur.indicatorMeta;
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
    getCabinetDrugs,
    getCabinetDrug,
    upsertCabinetDrug,
    updateCabinetDrug,
    deleteCabinetDrug,
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
    setIndicatorMeta,
    setLastDecrement,
    exportJSON,
    importJSON,
    drugNames,
  };
});
