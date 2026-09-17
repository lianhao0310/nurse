/*
 * 数据层测试 — SQLite 原生模式（node:sqlite mock）
 * 运行：node --test tests/storage-sqlite.test.js
 *
 * 使用 node:sqlite 创建内存 SQLite 数据库，mock NurseDB + NurseImageStore，
 * 使 storage.js 走原生（非内存）代码路径，覆盖 SQLite 分支逻辑。
 */
const { createSqliteMock } = require("./helpers/sqlite-mock");

const { NurseDB, NurseImageStore } = createSqliteMock();
global.window = { NurseDB, NurseImageStore };
delete require.cache[require.resolve("../frontend/storage.js")];
const NurseStorage = require("../frontend/storage.js");
const { registerStorageTests } = require("./helpers/storage-tests");

registerStorageTests(NurseStorage);
