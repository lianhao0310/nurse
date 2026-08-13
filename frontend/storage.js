/*
 * 私人护士 · 本地持久化存储
 * 设计目标：
 *   - 个人数据"不存内存"：落盘到手机文件系统（iOS 用 Capacitor Filesystem 写入
 *     App 的 Documents 目录，用户可在"文件" App 中看到并导出），
 *     非电容（浏览器）环境下回退到 localStorage。
 *   - 方便换机：提供 导出 / 导入 单个 JSON 文件，迁移历史问诊与设置。
 *
 * 数据模型（单文件 nurse-data.json）：
 *   { version, updatedAt, settings:{...}, records:[ {id, createdAt, transcript, result} ] }
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
  const VERSION = 1;

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

  function _empty() {
    return { version: VERSION, updatedAt: null, settings: {}, records: [] };
  }

  // 规范化：补齐字段，丢弃无法解析的脏数据
  function _normalize(obj) {
    const data = _empty();
    if (obj && typeof obj === "object") {
      data.settings = obj.settings && typeof obj.settings === "object" ? obj.settings : {};
      data.updatedAt = obj.updatedAt || null;
      if (Array.isArray(obj.records)) {
        data.records = obj.records
          .filter((r) => r && typeof r === "object" && r.result)
          .map((r) => ({
            id: r.id || "rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
            createdAt: r.createdAt || new Date().toISOString(),
            transcript: r.transcript || "",
            result: r.result,
          }));
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
        // 文件不存在或解析失败 -> 返回空库
        return _empty();
      }
    }
    // 浏览器回退
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
    const rec = {
      id: "rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
      transcript: record.transcript || "",
      result: record.result,
    };
    data.records.unshift(rec); // 最新在前
    await save(data);
    return rec;
  }

  async function getRecords() {
    return (await load()).records;
  }

  async function deleteRecord(id) {
    const data = await load();
    data.records = data.records.filter((r) => r.id !== id);
    await save(data);
  }

  async function updateSettings(patch) {
    const data = await load();
    data.settings = Object.assign({}, data.settings, patch);
    await save(data);
    return data.settings;
  }

  // ---------------- 导出 / 导入（换机迁移） ----------------
  async function exportJSON() {
    const data = await load();
    return JSON.stringify(data, null, 2);
  }

  // 导入：合并记录（按 id 去重，新覆盖旧），保留设置
  async function importJSON(jsonStr) {
    const incoming = _normalize(JSON.parse(jsonStr));
    const cur = await load();
    const map = {};
    cur.records.forEach((r) => (map[r.id] = r));
    incoming.records.forEach((r) => (map[r.id] = r));
    cur.records = Object.values(map).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    cur.settings = Object.assign({}, cur.settings, incoming.settings);
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
    deleteRecord,
    updateSettings,
    exportJSON,
    importJSON,
  };
});
