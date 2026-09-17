const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

function createSqliteMock() {
  const dbSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "db.js"), "utf8");
  const ddlMatch = dbSource.match(/const DDL = `([\s\S]*?)`/);
  const indexDdlMatch = dbSource.match(/const INDEX_DDL = `([\s\S]*?)`/);
  if (!ddlMatch || !indexDdlMatch) throw new Error("无法从 db.js 提取 DDL");

  const db = new DatabaseSync(":memory:");
  db.exec(ddlMatch[1]);
  db.exec(indexDdlMatch[1]);
  db.exec("INSERT OR REPLACE INTO ai_settings (id, enabled, base_url, api_key, model) VALUES (1, 0, 'https://api.openai.com/v1', '', 'gpt-4o')");

  const NurseDB = {
    init: async () => true,
    isMemoryMode: () => false,
    isReady: () => true,
    query: async (statement, values) => {
      const stmt = db.prepare(statement);
      return stmt.all(...(values || []));
    },
    run: async (statement, values) => {
      const stmt = db.prepare(statement);
      return stmt.run(...(values || []));
    },
    execute: async (statement) => {
      db.exec(statement);
    },
    close: async () => { try { db.close(); } catch (_) {} },
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
  };

  const imgStore = new Map();
  let imgSeq = 0;
  const NurseImageStore = {
    saveImage: async (dataUrl) => {
      const p = "mock://img/" + (++imgSeq);
      imgStore.set(p, dataUrl);
      return { path: p, name: "image", type: "image/jpeg" };
    },
    readImage: async (p) => imgStore.get(p) || "",
    deleteImages: async (paths) => { for (const p of (paths || [])) imgStore.delete(p); },
  };

  return { NurseDB, NurseImageStore, close: NurseDB.close };
}

module.exports = { createSqliteMock };
