/*
 * 数据层测试 — 内存模式（Web 预览降级路径）
 * 运行：node --test tests/storage.test.js
 */
function createLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

global.window = { localStorage: createLocalStorage() };
delete require.cache[require.resolve("../frontend/storage.js")];
const NurseStorage = require("../frontend/storage.js");
const { registerStorageTests } = require("./helpers/storage-tests");

registerStorageTests(NurseStorage);
