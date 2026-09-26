/*
 * Nurse · 本地 LLM 推理封装
 * ------------------------------------------------------------------
 * 封装 capacitor-local-llm 原生插件调用 + GGUF 模型下载管理。
 * 插件未安装时 generate() 返回错误提示，不崩溃。
 *
 * 加载方式：<script src="local-llm.js"> -> window.NurseLocalLLM
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseLocalLLM = api;
})(this, function () {
  "use strict";

  var CHUNK_SIZE = 1024 * 1024;
  var MODEL_DIR = "local-models";
  var _loaded = false;

  function _uint8ToBase64(u8) {
    var binary = "";
    var len = u8.length;
    for (var i = 0; i < len; i++) {
      binary += String.fromCharCode(u8[i]);
    }
    return btoa(binary);
  }

  function _getPlugin() {
    if (typeof Capacitor === "undefined" || !Capacitor.Plugins) return null;
    return Capacitor.Plugins.LocalLLM || null;
  }

  function _getFilesystem() {
    if (typeof Capacitor === "undefined" || !Capacitor.Plugins) return null;
    return Capacitor.Plugins.Filesystem || null;
  }

  function isReady() {
    var plugin = _getPlugin();
    if (!plugin) return false;
    return true;
  }

  function _getLocalPath(settings) {
    var lm = settings && settings.localModel;
    if (!lm) return null;
    return lm.localPath || (MODEL_DIR + "/" + (lm.modelId || "model") + ".gguf");
  }

  async function downloadModel(onProgress, settings) {
    var lm = (settings || (window.NurseStorage && {})).localModel;
    if (!lm) throw new Error("未配置本地模型");
    var ggufUrl = lm.ggufUrl;
    if (!ggufUrl) throw new Error("未配置模型下载地址");

    var fs = _getFilesystem();
    if (!fs) throw new Error("Filesystem 插件未加载");

    var fileName = (lm.modelId || "model") + ".gguf";
    var filePath = MODEL_DIR + "/" + fileName;
    var totalSize = lm.sizeBytes || 0;
    var downloaded = 0;

    try {
      var stat = await fs.stat({ path: filePath, directory: "DOCUMENTS" });
      downloaded = stat.size || 0;
    } catch (e) { }

    if (totalSize && downloaded === totalSize) {
      return { localPath: filePath, size: downloaded };
    }

    if (downloaded > 0 && totalSize && downloaded > totalSize) {
      try { await fs.deleteFile({ path: filePath, directory: "DOCUMENTS" }); } catch (e) { }
      downloaded = 0;
    }

    var headers = {};
    if (downloaded > 0) headers["Range"] = "bytes=" + downloaded + "-";

    var resp;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        resp = await fetch(ggufUrl, { headers: headers });
        break;
      } catch (e) {
        if (attempt < 2) await new Promise(function(r) { setTimeout(r, 1000 * (attempt + 1)); });
        else throw new Error("下载请求失败（网络不可用）: " + (e.message || e));
      }
    }
    if (!resp.ok && resp.status !== 206) {
      if (resp.status === 416 && downloaded > 0) {
        try { await fs.deleteFile({ path: filePath, directory: "DOCUMENTS" }); } catch (e) { }
        downloaded = 0;
        headers = {};
        for (var attempt2 = 0; attempt2 < 3; attempt2++) {
          try {
            resp = await fetch(ggufUrl, { headers: headers });
            break;
          } catch (e) {
            if (attempt2 < 2) await new Promise(function(r) { setTimeout(r, 1000 * (attempt2 + 1)); });
            else throw new Error("下载请求失败（网络不可用）: " + (e.message || e));
          }
        }
        if (!resp.ok && resp.status !== 206) throw new Error("下载请求失败: " + resp.status);
      } else {
        throw new Error("下载请求失败: " + resp.status);
      }
    }

    var contentLength = totalSize;
    if (resp.headers.get("Content-Range")) {
      var m = /bytes \d+-(\d+)\/(\d+)/.exec(resp.headers.get("Content-Range"));
      if (m) contentLength = parseInt(m[2], 10);
    } else if (resp.headers.get("Content-Length")) {
      contentLength = downloaded + parseInt(resp.headers.get("Content-Length"), 10);
    }

    var reader = resp.body.getReader();
    var isFirstChunk = downloaded === 0;

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      var data = chunk.value;
      if (isFirstChunk) {
        await fs.writeFile({
          path: filePath,
          directory: "DOCUMENTS",
          data: _uint8ToBase64(data),
          recursive: true,
        });
        isFirstChunk = false;
      } else {
        await fs.appendFile({
          path: filePath,
          directory: "DOCUMENTS",
          data: _uint8ToBase64(data),
        });
      }
      downloaded += data.length;
      if (onProgress && contentLength) onProgress(downloaded / contentLength);
    }

    if (onProgress) onProgress(1);
    return { localPath: filePath, size: downloaded };
  }

  async function generate(opts, onToken) {
    var plugin = _getPlugin();
    if (!plugin) throw new Error("本地推理插件未安装。请安装 capacitor-local-llm 插件后重试。");

    var ggufPath = opts.ggufPath;
    if (!ggufPath) throw new Error("未指定模型路径");

    if (!_loaded) {
      var fs = _getFilesystem();
      if (fs && opts.expectedSize) {
        var needDownload = false;
        try {
          var stat = await fs.stat({ path: ggufPath, directory: "DOCUMENTS" });
          if (stat.size !== opts.expectedSize) needDownload = true;
        } catch (e) {
          needDownload = true;
        }
        if (needDownload) {
          var dlSettings = (window.NurseStorage && typeof NurseStorage.load === "function")
            ? await NurseStorage.load() : null;
          if (dlSettings && dlSettings.settings && dlSettings.settings.localModel) {
            await downloadModel(opts.onDownloadProgress || null, dlSettings.settings);
            if (typeof NurseStorage.updateSettings === "function") {
              var s = dlSettings.settings.localModel;
              await NurseStorage.updateSettings({ localModel: { ...s, downloaded: true, localPath: ggufPath } });
            }
          } else {
            throw new Error("模型文件不存在，请先在设置中下载模型");
          }
        }
      }
      await plugin.loadModel({
        ggufPath: ggufPath,
        contextLength: opts.contextLength || 512,
        gpuLayers: opts.gpuLayers || 0,
      });
      _loaded = true;
    }

    var listenerId = "local-llm-token-" + Date.now();
    var fullText = "";

    var tokenListener = null;
    var statusListener = null;

    if (onToken && typeof Capacitor !== "undefined" && Capacitor.addListener) {
      tokenListener = await Capacitor.addListener("local-llm-token", function (event) {
        var token = event && event.token ? event.token : "";
        fullText += token;
        onToken(token);
      });
    }

    if (opts.onStatus && typeof Capacitor !== "undefined" && Capacitor.addListener) {
      statusListener = await Capacitor.addListener("local-llm-status", function (event) {
        if (event && event.status) opts.onStatus(event.status);
      });
    }

    try {
      var result = await plugin.generate({
        prompt: opts.prompt || "",
        messages: opts.messages || [],
        maxTokens: opts.maxTokens || 512,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        stop: opts.stop || [],
      });
      if (result && result.text && !fullText) fullText = result.text;
    } finally {
      if (tokenListener && typeof tokenListener.remove === "function") await tokenListener.remove();
      if (statusListener && typeof statusListener.remove === "function") await statusListener.remove();
    }

    return fullText;
  }

  async function unload() {
    var plugin = _getPlugin();
    if (!plugin || !_loaded) return;
    try {
      await plugin.unload();
      _loaded = false;
    } catch (e) { }
  }

  function isModelLoaded() {
    return _loaded;
  }

  return {
    downloadModel: downloadModel,
    isReady: isReady,
    generate: generate,
    unload: unload,
    isModelLoaded: isModelLoaded,
    _getLocalPath: _getLocalPath,
  };
});
