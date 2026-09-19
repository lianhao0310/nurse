/*
 * Nurse · 业务数据 SQLite 数据库模块
 * ------------------------------------------------------------------
 * 依赖：@capacitor-community/sqlite（Capacitor 原生 SQLite / Web jeep-sqlite）
 *
 * 功能：
 *   - 管理 nurse.db 连接（createConnection + open + close）
 *   - 建表（25 张表）+ 索引
 *   - schema 版本迁移（PRAGMA user_version）
 *   - query / run / execute 封装
 *   - Web 平台通过 initWebStore() 启动 jeep-sqlite Web Component
 *
 * 加载方式：<script src="db.js"> -> window.NurseDB
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseDB = api;
})(this, function () {
  "use strict";

  const DB_NAME = "nurse";
  const APP_SCHEMA_VERSION = 1;

  let _sqlite = null;
  let _ready = false;
  let _memoryMode = false;
  let _initError = null;
  let _initFailed = false;

  function _getCapacitorSQLite() {
    if (typeof window !== "undefined" && window.Capacitor) {
      const plugins = window.Capacitor.Plugins || {};
      return plugins.CapacitorSQLite || null;
    }
    return null;
  }

  function _isWebPlatform() {
    try {
      if (typeof window !== "undefined" && window.Capacitor && window.Capacitor.getPlatform) {
        return window.Capacitor.getPlatform() === "web";
      }
    } catch (_) {}
    return true;
  }

  function _filterIosColumns(values) {
    const rows = values || [];
    if (rows.length && rows[0] && typeof rows[0] === "object" && "ios_columns" in rows[0]) {
      rows.shift();
    }
    return rows;
  }

  function isMemoryMode() { return _memoryMode; }
  function isReady() { return _ready; }
  function getInitError() { return _initError; }
  function isInitFailed() { return _initFailed; }

  // ---------------- 建表 DDL ----------------
  const DDL = `
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  visit_date TEXT DEFAULT '',
  hospital TEXT DEFAULT '',
  doctor TEXT DEFAULT '',
  source TEXT DEFAULT '',
  transcript TEXT DEFAULT '',
  order_id TEXT DEFAULT '',
  report_id TEXT DEFAULT '',
  advice_text TEXT DEFAULT '',
  ai_analysis TEXT,
  ai_analysis_at TEXT,
  manual INTEGER DEFAULT 0,
  status TEXT DEFAULT 'done',
  result_engine TEXT,
  result_summary TEXT DEFAULT '',
  result_disclaimer TEXT DEFAULT '',
  result_advice TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS record_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT DEFAULT '',
  type TEXT DEFAULT 'image/jpeg',
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS record_medications (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  dose TEXT DEFAULT '',
  freq TEXT DEFAULT '',
  time TEXT DEFAULT '',
  note TEXT DEFAULT '',
  disease TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS record_tasks (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  type TEXT DEFAULT 'life',
  title TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  freq TEXT DEFAULT '',
  due TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS record_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS record_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  trigger TEXT DEFAULT '',
  level TEXT DEFAULT 'yellow',
  action TEXT DEFAULT '',
  disease TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS record_exam_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  value TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  range TEXT DEFAULT '',
  abnormal INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS record_prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  spec TEXT DEFAULT '',
  pack_count INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  date TEXT DEFAULT '',
  kind TEXT DEFAULT 'custom',
  record_id TEXT DEFAULT '',
  ai_generated INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_medicines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  manufacturer TEXT DEFAULT '',
  alias TEXT DEFAULT '',
  spec TEXT DEFAULT '',
  pack_count INTEGER DEFAULT 0,
  qty REAL DEFAULT 0,
  price REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cabinet_drugs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manufacturer TEXT DEFAULT '',
  alias TEXT DEFAULT '',
  unit TEXT DEFAULT '片',
  spec TEXT DEFAULT '',
  qty REAL DEFAULT 0,
  dose_amount REAL DEFAULT 0,
  dose_unit TEXT DEFAULT '片',
  meal TEXT DEFAULT 'any',
  threshold INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  note TEXT DEFAULT '',
  disease TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS cabinet_time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drug_id TEXT NOT NULL,
  time TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT '检查报告',
  date TEXT DEFAULT '',
  kind TEXT DEFAULT 'hospital',
  record_id TEXT DEFAULT '',
  ai_generated INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS report_indicators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  value TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  range TEXT DEFAULT '',
  abnormal INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS consult_chats (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT '新对话',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consult_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  content TEXT DEFAULT '',
  ts TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS message_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT DEFAULT '',
  type TEXT DEFAULT 'image/jpeg',
  ocr_text TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER DEFAULT 0,
  base_url TEXT DEFAULT 'https://api.openai.com/v1',
  api_key TEXT DEFAULT '',
  model TEXT DEFAULT 'gpt-4o'
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'custom',
  date TEXT DEFAULT '',
  time TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS daily_done (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  value TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS indicator_meta (
  name TEXT PRIMARY KEY,
  unit TEXT DEFAULT '',
  range TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS followed_indicators (
  name TEXT PRIMARY KEY,
  unit TEXT DEFAULT '',
  range TEXT DEFAULT ''
);
`;

  const INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_records_visit_date ON records(visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_updated ON consult_chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date DESC);
CREATE INDEX IF NOT EXISTS idx_order_med_order_id ON order_medicines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_med_name ON order_medicines(name);
CREATE INDEX IF NOT EXISTS idx_cabinet_name ON cabinet_drugs(name);
CREATE INDEX IF NOT EXISTS idx_cabinet_alias ON cabinet_drugs(alias);
CREATE INDEX IF NOT EXISTS idx_record_images_rid ON record_images(record_id);
CREATE INDEX IF NOT EXISTS idx_record_med_rid ON record_medications(record_id);
CREATE INDEX IF NOT EXISTS idx_record_tasks_rid ON record_tasks(record_id);
CREATE INDEX IF NOT EXISTS idx_record_tags_rid ON record_tags(record_id);
CREATE INDEX IF NOT EXISTS idx_record_risks_rid ON record_risks(record_id);
CREATE INDEX IF NOT EXISTS idx_record_exam_rid ON record_exam_results(record_id);
CREATE INDEX IF NOT EXISTS idx_record_rx_rid ON record_prescriptions(record_id);
CREATE INDEX IF NOT EXISTS idx_report_ind_rid ON report_indicators(report_id);
CREATE INDEX IF NOT EXISTS idx_msg_images_mid ON message_images(message_id);
CREATE INDEX IF NOT EXISTS idx_msgs_chat_id ON consult_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_cabinet_ts_did ON cabinet_time_slots(drug_id);
CREATE INDEX IF NOT EXISTS idx_daily_done_date ON daily_done(date);
`;

  // ---------------- 迁移函数 ----------------
  const migrations = {
    1: async function () {
      await _sqlite.execute({ database: DB_NAME, statements: DDL });
      await _sqlite.execute({ database: DB_NAME, statements: INDEX_DDL });
    },
  };

  async function _runMigrations() {
    let curVersion = 0;
    try {
      const r = await _sqlite.query({ database: DB_NAME, statement: "PRAGMA user_version", values: [] });
      const rows = _filterIosColumns(r && r.values);
      curVersion = rows[0] ? Number(rows[0].user_version || 0) : 0;
    } catch (_) {}

    if (curVersion >= APP_SCHEMA_VERSION) return;

    for (let v = curVersion + 1; v <= APP_SCHEMA_VERSION; v++) {
      const fn = migrations[v];
      if (fn) await fn();
      await _sqlite.run({ database: DB_NAME, statement: "PRAGMA user_version = " + v, values: [] });
    }
    console.log("[NurseDB] schema 迁移完成: v" + curVersion + " → v" + APP_SCHEMA_VERSION);
  }

  // ---------------- 初始化 ----------------
  async function init() {
    if (_ready) return true;
    if (_initFailed) return false;

    try {
      _sqlite = _getCapacitorSQLite();
      if (!_sqlite) {
        _initError = new Error(
          _isWebPlatform()
            ? "CapacitorSQLite 插件未注册（Web），请确认 lib/capacitor.js 与 lib/sqlite-plugin.js 已加载"
            : "CapacitorSQLite 插件未注册，请确认已执行 npx cap sync ios && pod install 并使用 .xcworkspace 构建"
        );
        console.error("[NurseDB]", _initError.message);
        return false;
      }

      if (_isWebPlatform()) {
        await Promise.race([
          _sqlite.initWebStore(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("initWebStore 超时（10s），jeep-sqlite 可能未加载")), 10000)),
        ]);
      }

      await _sqlite.createConnection({
        database: DB_NAME,
        encrypted: false,
        mode: "no-encryption",
        version: APP_SCHEMA_VERSION,
        readonly: false,
      });
      await _sqlite.open({ database: DB_NAME });

      await _runMigrations();
      await _ensureAiSettingsRow();

      _ready = true;
      console.log("[NurseDB] 数据库初始化成功" + (_isWebPlatform() ? "（Web）" : ""));
      return true;
    } catch (e) {
      _initError = e;
      _ready = false;
      _initFailed = true;
      console.error("[NurseDB] 数据库初始化失败:", e);
      return false;
    }
  }

  async function _ensureAiSettingsRow() {
    const r = await _sqlite.query({ database: DB_NAME, statement: "SELECT COUNT(*) AS c FROM ai_settings", values: [] });
    const rows = _filterIosColumns(r && r.values);
    const count = rows[0] ? Number(rows[0].c) : 0;
    if (count === 0) {
      await _sqlite.run({
        database: DB_NAME,
        statement: "INSERT INTO ai_settings (id, enabled, base_url, api_key, model) VALUES (1, 0, 'https://api.openai.com/v1', '', 'gpt-4o')",
        values: [],
      });
    }
  }

  async function close() {
    if (_sqlite && _ready) {
      try { await _sqlite.close({ database: DB_NAME }); } catch (_) {}
    }
    _ready = false;
  }

  // ---------------- 查询封装 ----------------
  async function query(statement, values) {
    if (!_ready && !_initFailed) await init();
    if (!_sqlite || !_ready) return [];
    const r = await _sqlite.query({ database: DB_NAME, statement, values: values || [] });
    return _filterIosColumns(r && r.values);
  }

  async function run(statement, values) {
    if (!_ready && !_initFailed) await init();
    if (!_sqlite || !_ready) return { changes: 0 };
    const r = await _sqlite.run({ database: DB_NAME, statement, values: values || [] });
    return r || { changes: 0 };
  }

  async function execute(statement) {
    if (!_ready && !_initFailed) await init();
    if (!_sqlite || !_ready) return;
    await _sqlite.execute({ database: DB_NAME, statements: statement });
  }

  async function beginTransaction() {
    if (!_sqlite || !_ready) return;
    try { await _sqlite.beginTransaction({ database: DB_NAME }); } catch (_) {}
  }
  async function commitTransaction() {
    if (!_sqlite || !_ready) return;
    try { await _sqlite.commitTransaction({ database: DB_NAME }); } catch (_) {}
  }
  async function rollbackTransaction() {
    if (!_sqlite || !_ready) return;
    try { await _sqlite.rollbackTransaction({ database: DB_NAME }); } catch (_) {}
  }

  async function exportToJson() {
    if (!_sqlite) return null;
    try {
      const r = await _sqlite.exportToJson({ database: DB_NAME, jsonexportmode: "full" });
      return (r && r.export) ? JSON.stringify(r.export) : null;
    } catch (e) { console.warn("[NurseDB] exportToJson 失败:", e.message); return null; }
  }

  async function importFromJson(jsonStr) {
    if (!_sqlite) return false;
    try {
      const data = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
      await _sqlite.importFromJson({ jsonimport: data });
      return true;
    } catch (e) { console.warn("[NurseDB] importFromJson 失败:", e.message); return false; }
  }

  return {
    DB_NAME,
    APP_SCHEMA_VERSION,
    init,
    close,
    query,
    run,
    execute,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
    exportToJson,
    importFromJson,
    isMemoryMode,
    isReady,
    getInitError,
    isInitFailed,
  };
});
