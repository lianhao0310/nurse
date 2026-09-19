#!/usr/bin/env node
/**
 * 从 node_modules/sql.js 复制 sql-wasm.wasm 到 frontend/assets/
 *
 * 重要：wasm 版本必须与 jeep-sqlite 预编译产物内联的胶水代码匹配，
 * 否则 WebAssembly.instantiate() 会报 LinkError。
 * jeep-sqlite 2.8.0 内联的是 sql.js 1.11.0 的胶水代码，
 * 因此 npm overrides 固定 sql.js@1.11.0。
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dstDir = path.join(root, "frontend", "assets");
const dst = path.join(dstDir, "sql-wasm.wasm");

const candidates = [
  path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  path.join(root, "node_modules", "jeep-sqlite", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
];

let src = null;
let pkgPath = null;
for (const c of candidates) {
  if (fs.existsSync(c)) {
    src = c;
    pkgPath = path.join(path.dirname(path.dirname(c)), "package.json");
    break;
  }
}

if (!src) {
  console.warn("[copy-wasm] sql-wasm.wasm 未找到，跳过。已搜索:", candidates.join(", "));
  process.exit(0);
}

const sqlJsVersion = require(pkgPath).version;
fs.mkdirSync(dstDir, { recursive: true });
fs.copyFileSync(src, dst);
console.log(`[copy-wasm] sql.js@${sqlJsVersion} → frontend/assets/sql-wasm.wasm (${fs.statSync(dst).size} bytes)`);
