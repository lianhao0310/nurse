/*
 * db.js iOS 兼容性测试 — 验证 query 过滤 ios_columns 行
 *
 * 根因: @capacitor-community/sqlite iOS 原生端的 querySQL → fetchColumnInfo
 * 在结果数组第一行插入 { ios_columns: ["col1", ...] }，后续行才是数据。
 * db.js 的 query 未过滤该行，导致所有查询多返回一条空记录。
 *
 * 本测试模拟 iOS proxy 行为，验证 db.js 正确过滤。
 */
const { DatabaseSync } = require("node:sqlite");
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

function loadDdl() {
  const src = fs.readFileSync(path.join(__dirname, "..", "frontend", "db.js"), "utf8");
  const ddl = src.match(/const DDL = `([\s\S]*?)`/)[1];
  const idx = src.match(/const INDEX_DDL = `([\s\S]*?)`/)[1];
  return { ddl, idx };
}

function setupIosEnv() {
  const { ddl, idx } = loadDdl();
  const db = new DatabaseSync(":memory:");
  db.exec(ddl);
  db.exec(idx);

  const mockSQLite = {
    createConnection: async () => ({}),
    open: async () => undefined,
    query: async ({ statement, values }) => {
      const stmt = db.prepare(statement);
      const rows = stmt.all(...(values || []));
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]);
        return { values: [{ ios_columns: columns }, ...rows] };
      }
      return { values: [] };
    },
    run: async ({ statement, values }) => {
      const stmt = db.prepare(statement);
      const r = stmt.run(...(values || []));
      return { changes: { changes: r.changes, lastId: r.lastInsertRowid } };
    },
    execute: async ({ statements }) => {
      db.exec(statements);
      return { changes: { changes: 0 } };
    },
    beginTransaction: async () => ({}),
    commitTransaction: async () => ({}),
    rollbackTransaction: async () => ({}),
  };

  global.window = {
    Capacitor: {
      getPlatform: () => "ios",
      Plugins: { CapacitorSQLite: mockSQLite },
    },
  };

  delete require.cache[require.resolve("../frontend/db.js")];
  const NurseDB = require("../frontend/db.js");
  return { NurseDB, db };
}

describe("db.js iOS ios_columns 过滤", () => {
  test("init 成功且 isReady", async () => {
    const { NurseDB } = setupIosEnv();
    const ok = await NurseDB.init();
    assert.strictEqual(ok, true);
    assert.strictEqual(NurseDB.isReady(), true);
  });

  test("query 过滤 ios_columns 行 — 单条记录", async () => {
    const { NurseDB } = setupIosEnv();
    await NurseDB.init();
    await NurseDB.run(
      "INSERT INTO records (id, created_at, hospital, visit_date) VALUES (?, ?, ?, ?)",
      ["rec_1", "2024-01-01T00:00:00Z", "协和医院", "2024-01-01"]
    );
    const rows = await NurseDB.query("SELECT * FROM records ORDER BY created_at DESC");
    assert.strictEqual(rows.length, 1, "应只有1条记录，ios_columns 行被过滤");
    assert.strictEqual(rows[0].id, "rec_1");
    assert.strictEqual(rows[0].hospital, "协和医院");
    assert.ok(!("ios_columns" in rows[0]), "结果不应包含 ios_columns 键");
  });

  test("query 过滤 ios_columns 行 — 多条记录", async () => {
    const { NurseDB } = setupIosEnv();
    await NurseDB.init();
    for (let i = 1; i <= 3; i++) {
      await NurseDB.run(
        "INSERT INTO records (id, created_at, hospital) VALUES (?, ?, ?)",
        [`rec_${i}`, `2024-01-0${i}T00:00:00Z`, `医院${i}`]
      );
    }
    const rows = await NurseDB.query("SELECT * FROM records ORDER BY created_at DESC");
    assert.strictEqual(rows.length, 3, "应返回3条记录");
    for (const r of rows) {
      assert.ok(r.id.startsWith("rec_"), `id 应为 rec_*，实际: ${r.id}`);
      assert.ok(!("ios_columns" in r), "不应包含 ios_columns");
    }
  });

  test("query 空结果返回空数组", async () => {
    const { NurseDB } = setupIosEnv();
    await NurseDB.init();
    const rows = await NurseDB.query("SELECT * FROM records");
    assert.strictEqual(rows.length, 0);
  });

  test("run 写入后 query 能读回（往返一致）", async () => {
    const { NurseDB } = setupIosEnv();
    await NurseDB.init();
    await NurseDB.run(
      "INSERT INTO cabinet_drugs (id, name, qty, status) VALUES (?, ?, ?, ?)",
      ["cab_1", "阿司匹林", 10, "active"]
    );
    const rows = await NurseDB.query("SELECT id, name, qty, status FROM cabinet_drugs WHERE name = ?", ["阿司匹林"]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].name, "阿司匹林");
    assert.strictEqual(rows[0].qty, 10);
  });

  test("ai_settings 初始化后可正确读取", async () => {
    const { NurseDB } = setupIosEnv();
    await NurseDB.init();
    const rows = await NurseDB.query("SELECT enabled, base_url, api_key, model FROM ai_settings WHERE id = 1");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].base_url, "https://api.openai.com/v1");
    assert.strictEqual(rows[0].model, "gpt-4o");
  });

  test("PRAGMA user_version 迁移后正确设置", async () => {
    const { NurseDB } = setupIosEnv();
    await NurseDB.init();
    const rows = await NurseDB.query("PRAGMA user_version");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].user_version, 1);
  });
});
