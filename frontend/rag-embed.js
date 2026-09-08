/*
 * Nurse · RAG 端侧向量嵌入模块
 * ------------------------------------------------------------------
 * 依赖：Transformers.js（@xenova/transformers，通过 CDN UMD 加载）
 *        模型：Xenova/bge-small-zh-v1.5（512 维，中文专用）
 *
 * 功能：
 *   - 加载 bge-small-zh-v1.5 模型，将文本转换为 512 维向量
 *   - 模型单例缓存，避免重复加载
 *   - 加载失败时抛出可识别错误供调用方降级
 *
 * 加载方式：<script src="rag-embed.js"> -> window.NurseRagEmbed
 *           需在之前加载 Transformers.js CDN UMD
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseRagEmbed = api;
})(this, function () {
  "use strict";

  const MODEL_ID = "Xenova/bge-small-zh-v1.5";
  const EMBEDDING_DIM = 512;

  let _extractor = null;
  let _loadingPromise = null;
  let _loadError = null;

  function _getTransformers() {
    if (typeof window !== "undefined" && window.transformers) return window.transformers;
    if (typeof window !== "undefined" && window.Transformers) return window.Transformers;
    return null;
  }

  async function _loadModel() {
    if (_extractor) return _extractor;
    if (_loadError) throw _loadError;
    if (_loadingPromise) return _loadingPromise;

    _loadingPromise = (async () => {
      try {
        const transformers = _getTransformers();
        if (!transformers) {
          throw new Error("Transformers.js 未加载（需通过 CDN script 标签加载）");
        }
        const pipeline = transformers.pipeline || (transformers.default && transformers.default.pipeline);
        if (typeof pipeline !== "function") {
          throw new Error("Transformers.js pipeline 不可用");
        }
        console.log("[NurseRagEmbed] 加载嵌入模型:", MODEL_ID);
        _extractor = await pipeline("feature-extraction", MODEL_ID);
        console.log("[NurseRagEmbed] 模型加载成功");
        return _extractor;
      } catch (e) {
        _loadError = e;
        console.warn("[NurseRagEmbed] 模型加载失败:", e.message);
        throw e;
      } finally {
        _loadingPromise = null;
      }
    })();

    return _loadingPromise;
  }

  async function embed(text) {
    const extractor = await _loadModel();
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const vec = Array.from(output.data || output.tolist()[0]);
    if (vec.length !== EMBEDDING_DIM) {
      console.warn(`[NurseRagEmbed] 向量维度异常: ${vec.length} (期望 ${EMBEDDING_DIM})`);
    }
    return vec;
  }

  async function embedBatch(texts) {
    const extractor = await _loadModel();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    if (output.tolist) return output.tolist();
    const dim = EMBEDDING_DIM;
    const data = Array.from(output.data);
    const result = [];
    for (let i = 0; i < data.length; i += dim) {
      result.push(data.slice(i, i + dim));
    }
    return result;
  }

  function isModelLoaded() {
    return !!_extractor;
  }

  function getLoadError() {
    return _loadError;
  }

  function reset() {
    _extractor = null;
    _loadingPromise = null;
    _loadError = null;
  }

  return {
    embed,
    embedBatch,
    isModelLoaded,
    getLoadError,
    reset,
    EMBEDDING_DIM,
    MODEL_ID,
  };
});
