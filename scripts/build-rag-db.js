#!/usr/bin/env node
/**
 * build-rag-db.js — 端侧 RAG 向量知识库构建脚本（Node.js 版）
 * ------------------------------------------------------------------
 * 使用 @xenova/transformers 加载 bge-small-zh-v1.5 生成向量，
 * 与前端运行时使用相同模型，保证向量一致性。
 *
 * 用法:
 *   node scripts/build-rag-db.js --source all
 *   node scripts/build-rag-db.js --source engine
 *   node scripts/build-rag-db.js --source all --output frontend/assets/databases/rag-knowledge.db
 */
const fs = require("fs");
const path = require("path");
const { pipeline, env } = require("@xenova/transformers");

env.allowLocalModels = true;
env.localModelPath = path.resolve(__dirname, "_model_cache");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, "frontend", "assets", "databases", "rag-knowledge.db");
const MODEL_ID = "Xenova/bge-small-zh-v1.5";
const EMBEDDING_DIM = 512;
const MAX_CHUNK_CHARS = 500;

const args = parseArgs();
const outputPath = args.output || DEFAULT_OUTPUT;
const source = args.source || "all";

console.log(`[build-rag-db] 知识源: ${source}`);
console.log(`[build-rag-db] 输出路径: ${outputPath}`);
console.log(`[build-rag-db] 嵌入模型: ${MODEL_ID}`);

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") args.source = argv[++i];
    else if (argv[i] === "--output") args.output = argv[++i];
    else if (argv[i] === "--nihaixia-local") args.nihaixiaLocal = argv[++i];
  }
  return args;
}

function chunkMarkdown(mdText, sourcePath) {
  const lines = mdText.split("\n");
  const chunks = [];
  let currentTitle = "";
  let currentLines = [];
  let chunkIndex = 0;

  function flush() {
    if (!currentLines.length) return;
    const body = currentLines.join("\n").trim();
    if (!body) return;
    if (body.length <= MAX_CHUNK_CHARS) {
      chunks.push({ title: currentTitle, text: body, source_path: sourcePath, chunk_index: chunkIndex++ });
    } else {
      for (const sub of splitByParagraph(body)) {
        chunks.push({ title: currentTitle, text: sub, source_path: sourcePath, chunk_index: chunkIndex++ });
      }
    }
  }

  for (const line of lines) {
    if (line.startsWith("## ")) { flush(); currentTitle = line.slice(3).trim(); currentLines = []; }
    else if (line.startsWith("# ") && !currentTitle) { currentTitle = line.slice(2).trim(); }
    else { currentLines.push(line); }
  }
  flush();
  return chunks;
}

function splitByParagraph(text) {
  const paragraphs = text.split(/\n\s*\n/);
  const result = [];
  let buf = "";
  for (const para of paragraphs) {
    if (buf.length + para.length + 2 <= MAX_CHUNK_CHARS) {
      buf = buf ? buf + "\n\n" + para : para;
    } else {
      if (buf) result.push(buf);
      if (para.length <= MAX_CHUNK_CHARS) { buf = para; }
      else {
        for (let i = 0; i < para.length; i += MAX_CHUNK_CHARS) {
          result.push(para.slice(i, i + MAX_CHUNK_CHARS));
        }
        buf = "";
      }
    }
  }
  if (buf) result.push(buf);
  return result;
}

function extractEngine(enginePath) {
  const src = fs.readFileSync(enginePath, "utf8");
  const diseaseMatch = src.match(/const DISEASE_KB\s*=\s*\{([\s\S]*?)\};/);
  const medMatch = src.match(/const MEDICATIONS\s*=\s*\[([\s\S]*?)\];/);
  const DISEASE_KB = diseaseMatch ? eval("({" + diseaseMatch[1] + "})") : {};
  const MEDICATIONS = medMatch ? eval("([" + medMatch[1] + "])") : [];

  const chunks = [];
  let chunkIndex = 0;

  for (const [name, info] of Object.entries(DISEASE_KB)) {
    const parts = [`病种: ${name}`];
    if (info.keywords) parts.push(`关键词: ${info.keywords.join(", ")}`);
    if (info.taboo) parts.push("禁忌:\n" + info.taboo.map(t => `  - ${t}`).join("\n"));
    if (info.diet) parts.push("饮食:\n" + info.diet.map(d => `  - ${d}`).join("\n"));
    if (info.monitor) parts.push("监测: " + info.monitor.join(", "));
    if (info.risk) parts.push("风险:\n" + info.risk.map(r => `  - [${r.level || "?"}] ${r.trigger || ""}: ${r.action || ""}`).join("\n"));
    chunks.push({ source_type: "disease", source_path: "engine.js/DISEASE_KB", title: name, text: parts.join("\n\n"), chunk_index: chunkIndex++ });
  }

  for (const med of MEDICATIONS) {
    const parts = [`药品: ${med.name}`];
    if (med.aliases) parts.push(`别名: ${med.aliases.join(", ")}`);
    if (med.disease) parts.push(`对应病种: ${med.disease}`);
    chunks.push({ source_type: "medication", source_path: "engine.js/MEDICATIONS", title: med.name, text: parts.join("\n"), chunk_index: chunkIndex++ });
  }

  return chunks;
}

function extractNihaixiaLocal(localDir) {
  const chunks = [];
  const distilledFiles = ["01-six-meridian-formulas.md", "02-acupuncture-quick-ref.md", "03-clinical-experience.md", "05-clinical-dose-quickref.md", "06-clinical-dose-c99.md"];

  const skillPath = path.join(localDir, "SKILL.md");
  if (fs.existsSync(skillPath)) {
    const md = fs.readFileSync(skillPath, "utf8");
    for (const c of chunkMarkdown(md, "nihaixia/SKILL.md")) { c.source_type = "tcm"; chunks.push(c); }
  }

  const distilledDir = path.join(localDir, "references", "distilled");
  for (const fname of distilledFiles) {
    const fpath = path.join(distilledDir, fname);
    if (!fs.existsSync(fpath)) continue;
    const md = fs.readFileSync(fpath, "utf8");
    for (const c of chunkMarkdown(md, `nihaixia/references/distilled/${fname}`)) { c.source_type = "tcm"; chunks.push(c); }
  }

  return chunks;
}

function vectorToBuffer(vector) {
  const buf = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i++) buf.writeFloatLE(vector[i], i * 4);
  return buf;
}

function writeDb(dbPath, chunks) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      dim INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_source_type ON knowledge_chunks(source_type);
    CREATE INDEX idx_source_path ON knowledge_chunks(source_path);
  `);

  const insert = db.prepare(
    "INSERT INTO knowledge_chunks (source_type, source_path, chunk_index, title, text, embedding, dim, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const now = new Date().toISOString();
  for (const c of chunks) {
    const buf = Buffer.alloc(c.embedding.length * 4);
    for (let i = 0; i < c.embedding.length; i++) buf.writeFloatLE(c.embedding[i], i * 4);
    insert.run(c.source_type, c.source_path, c.chunk_index, c.title || "", c.text, buf, c.embedding.length, now);
  }

  const count = db.prepare("SELECT COUNT(*) as n FROM knowledge_chunks").get();
  console.log(`[write_sqlite] 写入 ${count.n} 条记录到 ${dbPath}`);
  const groups = db.prepare("SELECT source_type, COUNT(*) as n FROM knowledge_chunks GROUP BY source_type").all();
  for (const g of groups) console.log(`[write_sqlite]   ${g.source_type}: ${g.n} 条`);
  db.close();
}

async function main() {
  const chunks = [];

  if (source === "all" || source === "nihaixia") {
    console.log("[build-rag-db] 提取 nihaixia 仓库知识...");
    if (args.nihaixiaLocal) {
      const tcmChunks = extractNihaixiaLocal(args.nihaixiaLocal);
      console.log(`[build-rag-db] nihaixia 产出 ${tcmChunks.length} 个 chunk`);
      chunks.push(...tcmChunks);
    } else {
      console.log("[build-rag-db] 警告: 未指定 --nihaixia-local，跳过 nihaixia 源");
    }
  }

  if (source === "all" || source === "engine") {
    console.log("[build-rag-db] 提取 engine.js 知识库...");
    const enginePath = path.join(PROJECT_ROOT, "frontend", "engine.js");
    const engineChunks = extractEngine(enginePath);
    console.log(`[build-rag-db] engine.js 产出 ${engineChunks.length} 个 chunk`);
    chunks.push(...engineChunks);
  }

  if (!chunks.length) { console.error("[build-rag-db] 错误: 未提取到任何 chunk"); process.exit(1); }

  console.log(`[build-rag-db] 总计 ${chunks.length} 个 chunk，开始向量化...`);
  const extractor = await pipeline("feature-extraction", MODEL_ID);
  const BATCH_SIZE = 50;
  const allVectors = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.title ? `${c.title}\n${c.text}` : c.text);
    console.log(`[build-rag-db] 向量化批次 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (${i + 1}-${i + batch.length})`);
    const outputs = await extractor(texts, { pooling: "mean", normalize: true });
    const vectors = outputs.tolist ? outputs.tolist() : (() => {
      const data = Array.from(outputs.data);
      const result = [];
      for (let j = 0; j < data.length; j += EMBEDDING_DIM) result.push(data.slice(j, j + EMBEDDING_DIM));
      return result;
    })();
    allVectors.push(...vectors);
  }

  for (let i = 0; i < chunks.length; i++) chunks[i].embedding = allVectors[i];
  console.log(`[build-rag-db] 向量化完成，维度: ${allVectors[0].length}`);

  console.log("[build-rag-db] 写入 SQLite 数据库...");
  writeDb(outputPath, chunks);

  const stats = fs.statSync(outputPath);
  console.log(`[build-rag-db] 完成！数据库已写入: ${outputPath}`);
  console.log(`[build-rag-db] 文件大小: ${(stats.size / 1024).toFixed(1)} KB`);
}

main().catch(e => { console.error("[build-rag-db] 失败:", e.message); process.exit(1); });
