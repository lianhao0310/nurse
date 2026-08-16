/*
 * 私人护士 · 本地持久化存储（v2）
 * ------------------------------------------------------------------
 * 设计目标：
 *   - 个人数据落盘到手机文件系统（iOS 用 Capacitor Filesystem 写入 App 的
 *     Documents 目录；浏览器回退到 localStorage）。
 *   - 方便换机：导出 / 导入 单个 JSON 文件迁移历史问诊与设置。
 *
 * 数据模型（单文件 nurse-data.json）：
 * {
 *   version, updatedAt,
 *   settings: {
 *     ai:        { enabled, baseUrl, apiKey, model },   // 智能解析接入
 *     notifications: bool,
 *     largeFont:     bool,
 *     dailyDone: { "2026-08-14": { meds:  {id:true}, tasks: {id:true} } }   // 今日勾选状态
 *   },
 *   records: [ {
 *     id, createdAt, source: "recording"|"upload"|"text",
 *     transcript: "",                       // 录音转写 / 手动文本（可为空）
 *     images: [ { name, type, dataUrl } ],  // 归档的检查报告 / 处方照片
 *     result: { engine, diseases, medications[], tasks[], advice, risks, reminders, disclaimer },
 *     manual: bool                          // 是否用户纯手动录入（无转写）
 *   } ]
 * }
 *
 * 加载方式：<script src="storage.js"> -> window.NurseStorage（全部为 async）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseStorage = api;
})(this, function () {
  "use strict";

  const FILE_NAME = "nurse-data.json";
  const LS_KEY = "nurse-data";
  const VERSION = 2;

  // 是否运行在 Capacitor 原生壳（iOS/Android）中，且 Filesystem 插件可用
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

  // 给 meds / tasks 分配稳定 id（首页勾选、去重用）
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

  function _empty() {
    return {
      version: VERSION,
      updatedAt: null,
      lastDecrement: null, // 上次药箱每日扣减日期（yyyy-mm-dd）
      settings: {
        ai: { enabled: false, baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o" },
        notifications: false,
        largeFont: false,
        dailyDone: {},
        reminders: [], // 通用个人提醒列表（含「下次就诊」等）
        medReminderMinutes: 10, // 用药提醒提前 N 分钟
      },
      records: [],
      cabinet: [], // 我的药箱：用户手头现有药品
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
      medReminderMinutes: Number(s.medReminderMinutes) >= 0 ? Number(s.medReminderMinutes) : 10,
    };
  }

  // 通用个人提醒：优先用 reminders 数组；旧数据用 nextVisit 迁移为一条「下次就诊」
  function _normReminder(r) {
    if (!r || typeof r !== "object") return null;
    if (!r.title || !String(r.title).trim()) return null;
    return {
      id: r.id || _uid("rem_"),
      title: String(r.title).trim(),
      type: r.type || "custom", // visit | custom（控制图标）
      date: r.date || "", // YYYY-MM-DD
      time: r.time || "", // HH:MM（可选）
      advanceDays: Number(r.advanceDays) >= 0 ? Number(r.advanceDays) : 3,
      enabled: r.enabled !== false,
      note: r.note || "",
    };
  }
  function _normReminders(arr, s) {
    if (Array.isArray(arr)) {
      const list = arr.map(_normReminder).filter(Boolean);
      if (list.length) return list;
    }
    // 旧数据迁移：若设置了 nextVisit，转成一条就诊提醒
    if (s && s.nextVisit) {
      return [_normReminder({ title: "下次就诊", type: "visit", date: s.nextVisit, advanceDays: Number(s.visitReminderDays) || 3 })];
    }
    return [];
  }

  // 浅+一层对象合并（用于 updateSettings 的嵌套 ai）
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

  function _recNormalize(r) {
    if (!r || typeof r !== "object") return null;
    if (!(r.result || (r.images && r.images.length) || r.transcript)) return null;
    const rec = {
      id: r.id || _uid("rec_"),
      createdAt: r.createdAt || new Date().toISOString(),
      source: r.source || (r.transcript ? "text" : "upload"),
      transcript: r.transcript || "",
      images: Array.isArray(r.images)
        ? r.images
            .filter((im) => im && im.dataUrl)
            .map((im) => ({ name: im.name || "image", type: im.type || "image/jpeg", dataUrl: im.dataUrl }))
        : [],
      result: r.result || null,
      manual: !!r.manual,
      // 解析状态：parsing（解析中）/ done（已归档）/ failed（解析失败）；旧数据无 status 默认 done
      status: r.status || "done",
    };
    return _withIds(rec);
  }

  // 药箱条目归一化（名称必填，其余带默认）
  function _cabItem(it) {
    if (!it || typeof it !== "object") return null;
    if (!it.name || !String(it.name).trim()) return null;
    const status = ["active", "disabled", "out"].includes(it.status) ? it.status : "active";
    return {
      id: it.id || _uid("cab_"),
      name: String(it.name).trim(),
      spec: it.spec || "",
      qty: Number(it.qty) || 0,
      unit: it.unit || "片",
      dailyDose: Number(it.dailyDose) || 0, // 每天消耗量（用于每日自动扣减）
      threshold: Number(it.threshold) || 0, // 剩余 ≤ 阈值时告警
      status: status, // active 使用中 / disabled 停用 / out 缺药
      disease: it.disease || "", // 针对病症（可多个，逗号分隔）
      intro: it.intro || "", // 药品介绍
      precautions: Array.isArray(it.precautions) ? it.precautions.filter(Boolean) : [], // 注意事项
      advice: it.advice || "", // 针对个人用药建议
      note: it.note || "",
    };
  }

  function _normalize(obj) {
    const data = _empty();
    if (obj && typeof obj === "object") {
      data.settings = _normSettings(obj.settings);
      data.updatedAt = obj.updatedAt || null;
      data.lastDecrement = obj.lastDecrement || null;
      if (Array.isArray(obj.records)) {
        data.records = obj.records.map(_recNormalize).filter(Boolean);
      }
      if (Array.isArray(obj.cabinet)) {
        data.cabinet = obj.cabinet.map(_cabItem).filter(Boolean);
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
      await _fs().writeFile({
        path: FILE_NAME,
        data: JSON.stringify(data),
        directory: "Documents",
        encoding: "utf8",
      });
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
      source: record.source || "text",
      transcript: record.transcript || "",
      images: record.images || [],
      result: record.result || null,
      manual: !!record.manual,
      status: record.status || "done", // 保留解析状态：parsing / done / failed
    });
    data.records.unshift(rec); // 最新在前
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
    await save(data);
  }

  // ---------------- 我的药箱（手头现有药品） ----------------
  async function getCabinet() {
    return (await load()).cabinet;
  }
  // 新增或更新一条药箱条目（item 含 id 则按 id 更新）
  async function upsertCabinetItem(item) {
    const data = await load();
    const it = _cabItem(item);
    if (!it) return null;
    const exist = item && item.id ? data.cabinet.find((x) => x.id === item.id) : null;
    if (exist) {
      Object.assign(exist, it);
    } else {
      data.cabinet.unshift(it);
    }
    await save(data);
    return it;
  }
  async function updateCabinetItem(id, patch) {
    const data = await load();
    const it = data.cabinet.find((x) => x.id === id);
    if (!it) return null;
    const merged = _cabItem(Object.assign({}, it, patch));
    if (!merged) return null;
    Object.assign(it, merged);
    await save(data);
    return it;
  }
  async function deleteCabinetItem(id) {
    const data = await load();
    data.cabinet = data.cabinet.filter((x) => x.id !== id);
    await save(data);
  }
  // 记录“每日扣减”已执行的日期
  async function setLastDecrement(dateKey) {
    const data = await load();
    data.lastDecrement = dateKey;
    await save(data);
  }

  // ---------------- 设置 ----------------
  async function updateSettings(patch) {
    const data = await load();
    data.settings = _mergeSettings(data.settings, patch);
    await save(data);
    return data.settings;
  }

  // ---------------- 今日勾选状态（首页用药/待办 done） ----------------
  async function getDone(dateKey) {
    const s = (await load()).settings;
    const d = (s.dailyDone && s.dailyDone[dateKey]) || {};
    return { meds: d.meds || {}, tasks: d.tasks || {} };
  }

  // done=true 写入；done=false 移除
  async function setDone(dateKey, kind, id, done) {
    const data = await load();
    if (!data.settings.dailyDone[dateKey]) data.settings.dailyDone[dateKey] = { meds: {}, tasks: {} };
    const bucket = data.settings.dailyDone[dateKey][kind] || (data.settings.dailyDone[dateKey][kind] = {});
    if (done) bucket[id] = true;
    else delete bucket[id];
    // 清理过期日期（仅保留最近 7 天），避免无限增长
    const keys = Object.keys(data.settings.dailyDone).sort();
    while (keys.length > 7) {
      delete data.settings.dailyDone[keys.shift()];
    }
    await save(data);
  }

  // ---------------- 导出 / 导入（换机迁移） ----------------
  async function exportJSON() {
    const data = await load();
    return JSON.stringify(data, null, 2);
  }

  // 导入：合并记录（按 id 去重，新覆盖旧），合并设置
  async function importJSON(jsonStr) {
    const incoming = _normalize(JSON.parse(jsonStr));
    const cur = await load();
    const map = {};
    cur.records.forEach((r) => (map[r.id] = r));
    incoming.records.forEach((r) => (map[r.id] = r));
    cur.records = Object.values(map).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
    upsertCabinetItem,
    updateCabinetItem,
    deleteCabinetItem,
    setLastDecrement,
    updateSettings,
    getDone,
    setDone,
    exportJSON,
    importJSON,
  };
});
