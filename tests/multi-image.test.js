/*
 * 多图上传回归测试
 * 运行：node --test tests/multi-image.test.js
 *
 * 加固点：问诊记录/药单/检查报告导入多张图片时，onchange 回调必须先把
 * input.files 快照为数组再重置 input.value，否则异步压缩遍历途中
 * input.value="" 会清空 FileList，导致只处理首张图（历史 bug 复发）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { snapshotAndReset, collectImages } = require("../frontend/imgupload.js");

function mockFile(name, type = "image/jpeg") {
  return { name, type, size: 1024 };
}

// 模拟 <input type="file">：value 设为 "" 时 files 被清空（重现浏览器 FileList 行为）
function mockInput(files) {
  let current = files;
  let val = "x";
  return {
    get value() { return val; },
    set value(v) { val = v; if (v === "") current = []; },
    get files() { return current; },
  };
}

// 模拟动态 FileList：清空内容后 length=0，迭代器反映动态长度（贴近浏览器 FileList）
function dynamicFileList(files) {
  return {
    get length() { return files.length; },
    item(i) { return files[i] || null; },
    *[Symbol.iterator]() {
      let i = 0;
      while (i < files.length) yield files[i++];
    },
  };
}

// ---- snapshotAndReset ----

test("snapshotAndReset 快照全部文件并重置 input", () => {
  const input = mockInput([mockFile("a.jpg"), mockFile("b.jpg"), mockFile("c.jpg")]);
  const snap = snapshotAndReset(input);
  assert.strictEqual(snap.length, 3);
  assert.strictEqual(input.value, "");
  assert.strictEqual(input.files.length, 0);
});

test("snapshotAndReset 快照在 input 清空后仍完整（修复核心）", () => {
  const input = mockInput([mockFile("a.jpg"), mockFile("b.jpg"), mockFile("c.jpg")]);
  const snap = snapshotAndReset(input);
  assert.strictEqual(snap.length, 3);
  assert.deepStrictEqual(snap.map((f) => f.name), ["a.jpg", "b.jpg", "c.jpg"]);
});

test("snapshotAndReset 空文件列表返回空数组", () => {
  assert.strictEqual(snapshotAndReset(mockInput([])).length, 0);
});

test("snapshotAndReset 无 files 属性返回空数组", () => {
  assert.strictEqual(snapshotAndReset({ value: "x" }).length, 0);
});

test("snapshotAndReset null 入参不报错", () => {
  assert.strictEqual(snapshotAndReset(null).length, 0);
});

// ---- collectImages ----

test("collectImages 收集全部图片文件", async () => {
  const files = [mockFile("a.jpg"), mockFile("b.png"), mockFile("c.jpeg")];
  const out = await collectImages(files, async (f) => "data:" + f.name);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map((x) => x.name), ["a.jpg", "b.png", "c.jpeg"]);
  assert.deepStrictEqual(out.map((x) => x.dataUrl), ["data:a.jpg", "data:b.png", "data:c.jpeg"]);
  assert.ok(out.every((x) => x.type === "image/jpeg"));
});

test("collectImages 过滤非图片文件", async () => {
  const files = [mockFile("a.jpg", "image/jpeg"), mockFile("b.txt", "text/plain"), mockFile("c.pdf", "application/pdf")];
  const out = await collectImages(files, async (f) => "data:" + f.name);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, "a.jpg");
});

test("collectImages 跳过压缩失败的文件", async () => {
  const files = [mockFile("a.jpg"), mockFile("b.jpg"), mockFile("c.jpg")];
  const out = await collectImages(files, async (f) => (f.name === "b.jpg" ? "" : "data:" + f.name));
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out.map((x) => x.name), ["a.jpg", "c.jpg"]);
});

test("collectImages 空输入返回空数组", async () => {
  assert.strictEqual((await collectImages([], async () => "x")).length, 0);
  assert.strictEqual((await collectImages(null, async () => "x")).length, 0);
});

test("collectImages 逐张 await downscale（保持顺序）", async () => {
  const files = [mockFile("a.jpg"), mockFile("b.jpg"), mockFile("c.jpg")];
  const order = [];
  const out = await collectImages(files, async (f) => { order.push(f.name); await Promise.resolve(); return "d:" + f.name; });
  assert.deepStrictEqual(order, ["a.jpg", "b.jpg", "c.jpg"]);
  assert.deepStrictEqual(out.map((x) => x.dataUrl), ["d:a.jpg", "d:b.jpg", "d:c.jpg"]);
});

// ---- 回归：bug 模式 vs 修复模式 ----

test("回归·bug模式：async 遍历 FileList 中途清空只处理首张", async () => {
  const files = [mockFile("a.jpg"), mockFile("b.jpg"), mockFile("c.jpg")];
  const fileList = dynamicFileList(files);
  const processed = [];
  for (const f of fileList) {
    await Promise.resolve(); // 模拟 await downscale 让出控制权
    processed.push(f.name);
    if (processed.length === 1) files.length = 0; // 模拟 input.value="" 清空 FileList
  }
  assert.strictEqual(processed.length, 1);
  assert.strictEqual(processed[0], "a.jpg");
});

test("回归·修复模式：先快照再清空，全部保留", async () => {
  const files = [mockFile("a.jpg"), mockFile("b.jpg"), mockFile("c.jpg")];
  const fileList = dynamicFileList(files);
  const snap = Array.from(fileList); // 先快照
  files.length = 0; // 再清空
  const processed = [];
  for (const f of snap) {
    await Promise.resolve();
    processed.push(f.name);
  }
  assert.strictEqual(processed.length, 3);
  assert.deepStrictEqual(processed, ["a.jpg", "b.jpg", "c.jpg"]);
});

test("回归·端到端：snapshotAndReset + collectImages 多图全部入桶", async () => {
  const files = [mockFile("a.jpg"), mockFile("b.jpg"), mockFile("c.jpg"), mockFile("d.jpg")];
  const input = mockInput(files);
  const snap = snapshotAndReset(input);
  const bucket = await collectImages(snap, async (f) => "data:" + f.name);
  assert.strictEqual(bucket.length, 4);
  assert.deepStrictEqual(bucket.map((x) => x.name), ["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
});
