/*
 * local-llm.js 单元测试
 * ------------------------------------------------------------------
 * 测试 NurseLocalLLM 封装层：插件检测、模型下载（含断点续传）、
 * 推理生成、卸载等。Mock Capacitor.Plugins.LocalLLM / Filesystem / fetch。
 *
 * 运行：node --test tests/local-llm.test.js
 */

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

// ── mock 工具 ──────────────────────────────────────────────

function createMockPlugin() {
  return {
    _loaded: false,
    _genResult: { text: "测试回复", tokens: 4 },
    async loadModel(opts) { this._lastLoadOpts = opts; },
    async generate(opts) { this._lastGenOpts = opts; return this._genResult; },
    async unload() { this._loaded = false; },
    async isModelLoaded() { return { loaded: this._loaded }; },
  };
}

function createMockFilesystem(existingSize) {
  const _files = {};
  return {
    _files,
    async stat() {
      if (existingSize > 0) return { size: existingSize };
      throw new Error("File not found");
    },
    async writeFile(opts) { _files[opts.path] = opts.data; },
    async appendFile(opts) { _files[opts.path] = (_files[opts.path] || "") + opts.data; },
  };
}

function createMockFetch(chunks, totalSize) {
  const _calls = [];
  return {
    _calls,
    fetch: async (url, opts) => {
      _calls.push({ url, opts });
      const rangeHeader = opts && opts.headers && opts.headers["Range"];
      const startByte = rangeHeader ? parseInt(/bytes=(\d+)/.exec(rangeHeader)[1], 10) : 0;

      const remainingChunks = chunks.slice();
      const body = {
        getReader() {
          return {
            read: async () => {
              if (remainingChunks.length === 0) return { done: true };
              const data = remainingChunks.shift();
              return { done: false, value: data };
            },
          };
        },
      };

      const headers = new Map();
      if (startByte > 0) {
        headers.set("Content-Range", `bytes ${startByte}-${totalSize - 1}/${totalSize}`);
      } else {
        headers.set("Content-Length", String(totalSize));
      }

      return {
        ok: true,
        status: startByte > 0 ? 206 : 200,
        headers: { get: (k) => headers.get(k) || null },
        body,
      };
    },
  };
}

function setupEnvironment(opts = {}) {
  const plugin = opts.plugin || createMockPlugin();
  const fs = opts.fs || createMockFilesystem(opts.existingSize || 0);
  const mockFetch = createMockFetch(opts.chunks || [], opts.totalSize || 0);

  const Capacitor = {
    Plugins: {
      LocalLLM: plugin,
      Filesystem: fs,
    },
    addListener: opts.addListener || null,
  };

  global.window = { Capacitor };
  global.Capacitor = Capacitor;

  global.fetch = mockFetch.fetch;
  global.btoa = global.btoa || ((str) => Buffer.from(str, "binary").toString("base64"));

  // 清除缓存重新加载模块
  delete require.cache[require.resolve("../frontend/local-llm.js")];
  const NurseLocalLLM = require("../frontend/local-llm.js");

  return { plugin, fs, mockFetch, NurseLocalLLM };
}

function cleanup() {
  delete global.window;
  delete global.Capacitor;
  delete global.fetch;
}

// ── 测试用例 ──────────────────────────────────────────────

describe("NurseLocalLLM.isReady", () => {
  afterEach(cleanup);

  test("插件存在时返回 true", () => {
    const { NurseLocalLLM } = setupEnvironment();
    assert.strictEqual(NurseLocalLLM.isReady(), true);
  });

  test("插件不存在时返回 false", () => {
    global.window = { Capacitor: { Plugins: {} } };
    global.Capacitor = global.window.Capacitor;
    delete require.cache[require.resolve("../frontend/local-llm.js")];
    const NurseLocalLLM = require("../frontend/local-llm.js");
    assert.strictEqual(NurseLocalLLM.isReady(), false);
  });

  test("Capacitor 未定义时返回 false", () => {
    global.window = {};
    delete global.Capacitor;
    delete require.cache[require.resolve("../frontend/local-llm.js")];
    const NurseLocalLLM = require("../frontend/local-llm.js");
    assert.strictEqual(NurseLocalLLM.isReady(), false);
  });
});

describe("NurseLocalLLM._getLocalPath", () => {
  afterEach(cleanup);

  test("返回 localModel.localPath 优先值", () => {
    const { NurseLocalLLM } = setupEnvironment();
    const path = NurseLocalLLM._getLocalPath({ localModel: { localPath: "/custom/path.gguf" } });
    assert.strictEqual(path, "/custom/path.gguf");
  });

  test("无 localPath 时用 modelId 生成默认路径", () => {
    const { NurseLocalLLM } = setupEnvironment();
    const path = NurseLocalLLM._getLocalPath({ localModel: { modelId: "qwen05" } });
    assert.strictEqual(path, "local-models/qwen05.gguf");
  });

  test("无 localModel 时返回 null", () => {
    const { NurseLocalLLM } = setupEnvironment();
    assert.strictEqual(NurseLocalLLM._getLocalPath({}), null);
    assert.strictEqual(NurseLocalLLM._getLocalPath(null), null);
  });
});

describe("NurseLocalLLM.downloadModel", () => {
  afterEach(cleanup);

  test("未配置 localModel 时抛出错误", async () => {
    const { NurseLocalLLM } = setupEnvironment();
    await assert.rejects(
      NurseLocalLLM.downloadModel(null, {}),
      { message: "未配置本地模型" }
    );
  });

  test("未配置 ggufUrl 时抛出错误", async () => {
    const { NurseLocalLLM } = setupEnvironment();
    const settings = { localModel: { modelId: "test" } };
    await assert.rejects(
      NurseLocalLLM.downloadModel(null, settings),
      { message: "未配置模型下载地址" }
    );
  });

  test("Filesystem 未加载时抛出错误", async () => {
    const cap = { Plugins: { LocalLLM: createMockPlugin() } };
    global.window = { Capacitor: cap };
    global.Capacitor = cap;
    delete require.cache[require.resolve("../frontend/local-llm.js")];
    const NurseLocalLLM = require("../frontend/local-llm.js");
    const settings = { localModel: { modelId: "test", ggufUrl: "http://x.gguf" } };
    await assert.rejects(
      NurseLocalLLM.downloadModel(null, settings),
      { message: "Filesystem 插件未加载" }
    );
  });

  test("已下载完成时直接返回不重新下载", async () => {
    const chunk = new Uint8Array([1, 2, 3]);
    const { NurseLocalLLM, mockFetch } = setupEnvironment({
      chunks: [chunk],
      totalSize: 3,
      existingSize: 3,
    });
    const settings = {
      localModel: { modelId: "test", ggufUrl: "http://x.gguf", sizeBytes: 3 },
    };
    const result = await NurseLocalLLM.downloadModel(null, settings);
    assert.strictEqual(result.size, 3);
    assert.strictEqual(mockFetch._calls.length, 0);
  });

  test("正常下载写入文件并返回路径", async () => {
    const chunk1 = new Uint8Array([1, 2, 3, 4]);
    const chunk2 = new Uint8Array([5, 6, 7, 8]);
    const { NurseLocalLLM, fs, mockFetch } = setupEnvironment({
      chunks: [chunk1, chunk2],
      totalSize: 8,
    });
    const settings = {
      localModel: { modelId: "qwen", ggufUrl: "http://x.gguf", sizeBytes: 8 },
    };
    const result = await NurseLocalLLM.downloadModel(null, settings);
    assert.strictEqual(result.localPath, "local-models/qwen.gguf");
    assert.strictEqual(result.size, 8);
    assert.strictEqual(mockFetch._calls.length, 1);
    assert.ok(fs._files["local-models/qwen.gguf"], "文件应被写入");
  });

  test("进度回调被正确调用", async () => {
    const chunk1 = new Uint8Array([1, 2, 3, 4]);
    const chunk2 = new Uint8Array([5, 6]);
    const { NurseLocalLLM } = setupEnvironment({
      chunks: [chunk1, chunk2],
      totalSize: 6,
    });
    const settings = {
      localModel: { modelId: "test", ggufUrl: "http://x.gguf", sizeBytes: 6 },
    };
    const progressValues = [];
    await NurseLocalLLM.downloadModel((pct) => progressValues.push(pct), settings);
    assert.ok(progressValues.length > 0, "应有进度回调");
    assert.strictEqual(progressValues[progressValues.length - 1], 1, "最终进度应为 1");
  });

  test("断点续传发送 Range 头", async () => {
    const chunk = new Uint8Array([5, 6, 7, 8]);
    const { NurseLocalLLM, mockFetch } = setupEnvironment({
      chunks: [chunk],
      totalSize: 8,
      existingSize: 4,
    });
    const settings = {
      localModel: { modelId: "test", ggufUrl: "http://x.gguf", sizeBytes: 8 },
    };
    await NurseLocalLLM.downloadModel(null, settings);
    assert.strictEqual(mockFetch._calls.length, 1);
    assert.strictEqual(mockFetch._calls[0].opts.headers["Range"], "bytes=4-");
  });
});

describe("NurseLocalLLM.generate", () => {
  afterEach(cleanup);

  test("插件未安装时抛出错误", async () => {
    const cap = { Plugins: {} };
    global.window = { Capacitor: cap };
    global.Capacitor = cap;
    delete require.cache[require.resolve("../frontend/local-llm.js")];
    const NurseLocalLLM = require("../frontend/local-llm.js");
    await assert.rejects(
      NurseLocalLLM.generate({ ggufPath: "/m.gguf" }),
      { message: "本地推理插件未安装。请安装 capacitor-local-llm 插件后重试。" }
    );
  });

  test("未指定 ggufPath 时抛出错误", async () => {
    const { NurseLocalLLM } = setupEnvironment();
    await assert.rejects(
      NurseLocalLLM.generate({}),
      { message: "未指定模型路径" }
    );
  });

  test("首次调用会 loadModel", async () => {
    const { NurseLocalLLM, plugin } = setupEnvironment();
    await NurseLocalLLM.generate({ ggufPath: "/model.gguf", prompt: "你好" });
    assert.ok(plugin._lastLoadOpts, "loadModel 应被调用");
    assert.strictEqual(plugin._lastLoadOpts.ggufPath, "/model.gguf");
  });

  test("返回生成的文本", async () => {
    const { NurseLocalLLM } = setupEnvironment();
    const text = await NurseLocalLLM.generate({ ggufPath: "/m.gguf", prompt: "测试" });
    assert.strictEqual(text, "测试回复");
  });

  test("传递正确的生成参数", async () => {
    const { NurseLocalLLM, plugin } = setupEnvironment();
    await NurseLocalLLM.generate({
      ggufPath: "/m.gguf",
      prompt: "你好",
      maxTokens: 256,
      temperature: 0.5,
    });
    assert.strictEqual(plugin._lastGenOpts.prompt, "你好");
    assert.strictEqual(plugin._lastGenOpts.maxTokens, 256);
    assert.strictEqual(plugin._lastGenOpts.temperature, 0.5);
  });

  test("使用默认值当参数缺失", async () => {
    const { NurseLocalLLM, plugin } = setupEnvironment();
    await NurseLocalLLM.generate({ ggufPath: "/m.gguf" });
    assert.strictEqual(plugin._lastGenOpts.maxTokens, 512);
    assert.strictEqual(plugin._lastGenOpts.temperature, 0.7);
  });
});

describe("NurseLocalLLM.unload & isModelLoaded", () => {
  afterEach(cleanup);

  test("未加载时 unload 无操作", async () => {
    const { NurseLocalLLM } = setupEnvironment();
    assert.strictEqual(NurseLocalLLM.isModelLoaded(), false);
    await NurseLocalLLM.unload();
    assert.strictEqual(NurseLocalLLM.isModelLoaded(), false);
  });

  test("加载后 isModelLoaded 返回 true，unload 后返回 false", async () => {
    const { NurseLocalLLM } = setupEnvironment();
    await NurseLocalLLM.generate({ ggufPath: "/m.gguf" });
    assert.strictEqual(NurseLocalLLM.isModelLoaded(), true);
    await NurseLocalLLM.unload();
    assert.strictEqual(NurseLocalLLM.isModelLoaded(), false);
  });
});
