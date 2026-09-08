/*
 * Nurse · RAG 向量知识库检索模块
 * ------------------------------------------------------------------
 * 依赖：@capacitor-community/sqlite（Capacitor 原生 SQLite）
 *
 * 功能：
 *   - APP 启动时从 assets 复制 rag-knowledge.db 到沙盒并建立连接
 *   - 向量检索：读取候选 chunk 向量，纯 JS 计算余弦相似度，返回 top-k
 *   - prompt 拼接：精简核心规则 + RAG 检索片段
 *
 * 加载方式：<script src="rag-db.js"> -> window.NurseRag
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseRag = api;
})(this, function () {
  "use strict";

  const DB_NAME = "rag-knowledge";
  const DB_VERSION = 1;
  const EMBEDDING_DIM = 512;
  const DEFAULT_TOP_K = 5;
  const DEFAULT_SOURCE_TYPES = ["tcm", "disease", "medication"];

  let _sqlite = null;
  let _connection = null;
  let _ready = false;
  let _initError = null;

  function _getCapacitorSQLite() {
    if (typeof window !== "undefined" && window.Capacitor) {
      const plugins = window.Capacitor.Plugins || {};
      return plugins.CapacitorSQLite || null;
    }
    return null;
  }

  async function init() {
    if (_ready) return true;
    if (_initError) throw _initError;

    try {
      _sqlite = _getCapacitorSQLite();
      if (!_sqlite) {
        throw new Error("CapacitorSQLite 插件不可用（非 Capacitor 原生环境）");
      }

      await _sqlite.copyFromAssets({ overwrite: false });

      const conn = await _sqlite.createConnection({
        database: DB_NAME,
        version: DB_VERSION,
        encrypted: false,
        mode: "no-encryption",
      });
      _connection = conn;
      await conn.open();
      _ready = true;
      console.log("[NurseRag] 数据库初始化成功");
      return true;
    } catch (e) {
      _initError = e;
      console.warn("[NurseRag] 数据库初始化失败，降级为仅核心规则:", e.message);
      throw e;
    }
  }

  function _bytesToFloat32(blob) {
    const buf = blob instanceof ArrayBuffer ? blob : new Uint8Array(blob).buffer;
    return new Float32Array(buf);
  }

  function _cosineSimilarity(a, b) {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) dot += a[i] * b[i];
    return dot;
  }

  async function search(queryVector, options) {
    if (!_ready) await init();
    if (!_connection) return [];

    const opts = options || {};
    const topK = opts.topK || DEFAULT_TOP_K;
    const sourceTypes = opts.sourceTypes || DEFAULT_SOURCE_TYPES;

    const placeholders = sourceTypes.map(() => "?").join(",");
    const sql =
      `SELECT id, source_type, source_path, title, text, embedding, dim ` +
      `FROM knowledge_chunks WHERE source_type IN (${placeholders})`;
    const result = await _connection.query({ statement: sql, values: sourceTypes });
    const rows = (result && result.values) || [];
    if (!rows.length) return [];

    const scored = [];
    for (const row of rows) {
      if (!row.embedding || row.dim !== EMBEDDING_DIM) continue;
      const vec = _bytesToFloat32(row.embedding);
      const score = _cosineSimilarity(queryVector, vec);
      scored.push({
        id: row.id,
        sourceType: row.source_type,
        sourcePath: row.source_path,
        title: row.title || "",
        text: row.text,
        score: score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async function searchByText(text, embedFn, options) {
    if (typeof embedFn !== "function") throw new Error("embedFn 未提供");
    const queryVector = await embedFn(text);
    return await search(queryVector, options);
  }

  function buildSystemPrompt(corePrompt, chunks) {
    if (!chunks || !chunks.length) return corePrompt;
    const parts = [corePrompt, "", "【相关知识】"];
    chunks.forEach((c, i) => {
      const source = c.sourcePath || c.sourceType || "unknown";
      parts.push(`[${i + 1}] (来源: ${source}) ${c.text}`);
    });
    return parts.join("\n");
  }

  async function isReady() {
    return _ready;
  }

  function getInitError() {
    return _initError;
  }

  async function close() {
    if (_connection) {
      try {
        await _connection.close();
      } catch (e) {
      }
      _connection = null;
    }
    _ready = false;
  }

  return {
    init,
    search,
    searchByText,
    buildSystemPrompt,
    isReady,
    getInitError,
    close,
    EMBEDDING_DIM,
  };
});
