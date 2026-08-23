/*
 * 数据层测试（重点功能：持久化 + 归一化 + 药箱库存同步 + 关联 + 复制副本）
 * 运行：node --test tests/storage.test.js
 *
 * 通过 mock global.window.localStorage 在 Node 中加载 storage.js（UMD）。
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

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
const NurseStorage = require("../frontend/storage.js");

beforeEach(() => global.window.localStorage.clear());

test("load 空数据返回归一化空结构", async () => {
  const data = await NurseStorage.load();
  assert.ok(Array.isArray(data.records));
  assert.ok(Array.isArray(data.orders));
  assert.ok(Array.isArray(data.reports));
  assert.ok(Array.isArray(data.cabinet));
});

test("upsertOrder 新药单入库同步药箱", async () => {
  const o = await NurseStorage.upsertOrder({
    source: "市医院",
    date: "2026-08-23",
    kind: "hospital",
    medicines: [{ name: "苯磺酸氨氯地平片", qty: 30 }],
  });
  assert.ok(o && o.id, "药单应有 id");
  const data = await NurseStorage.load();
  assert.ok(data.orders.length === 1);
  const cab = data.cabinet.find((c) => c.name === "苯磺酸氨氯地平片");
  assert.ok(cab, "药箱应出现该药");
  assert.strictEqual(Number(cab.qty), 30, "入库数量应为 30");
});

test("updateOrder 改数量按差额调整库存", async () => {
  const o = await NurseStorage.upsertOrder({
    source: "市医院",
    medicines: [{ name: "氨氯地平", qty: 10 }],
  });
  await NurseStorage.updateOrder(o.id, { medicines: [{ id: o.medicines[0].id, name: "氨氯地平", qty: 25 }] });
  const data = await NurseStorage.load();
  const cab = data.cabinet.find((c) => c.name === "氨氯地平");
  assert.strictEqual(Number(cab.qty), 25, "库存应为调整后 25");
});

test("deleteOrder 回退库存并清理无引用药品", async () => {
  const o = await NurseStorage.upsertOrder({
    source: "市医院",
    medicines: [{ name: "缬沙坦", qty: 20 }],
  });
  await NurseStorage.deleteOrder(o.id);
  const data = await NurseStorage.load();
  assert.strictEqual(data.orders.length, 0);
  assert.ok(!data.cabinet.find((c) => c.name === "缬沙坦"), "无引用药品应清理");
});

test("upsertReport 归一化指标并过滤空名", async () => {
  const rp = await NurseStorage.upsertReport({
    title: "血常规",
    date: "2026-08-23",
    kind: "self",
    indicators: [
      { name: "血糖", value: "6.5", unit: "mmol/L" },
      { name: "", value: "x" },
      { name: "血压", value: "130/80", abnormal: true },
    ],
  });
  assert.ok(rp && rp.id);
  const data = await NurseStorage.load();
  const r = data.reports.find((x) => x.id === rp.id);
  assert.strictEqual(r.indicators.length, 2, "空名指标应过滤");
  assert.ok(r.indicators.find((i) => i.name === "血糖"));
  assert.ok(r.indicators.find((i) => i.name === "血压").abnormal);
});

test("appendRecord/updateRecord 关联药单与报告", async () => {
  const rec = await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-23", transcript: "医嘱", manual: true });
  const o = await NurseStorage.upsertOrder({ source: "市医院", kind: "hospital", recordId: rec.id, medicines: [{ name: "氨氯地平", qty: 5 }] });
  await NurseStorage.updateRecord(rec.id, { orderId: o.id });
  const rp = await NurseStorage.upsertReport({ title: "市医院", kind: "hospital", recordId: rec.id, indicators: [{ name: "血糖", value: "6" }] });
  await NurseStorage.updateRecord(rec.id, { reportId: rp.id });
  const data = await NurseStorage.load();
  const r = data.records.find((x) => x.id === rec.id);
  assert.strictEqual(r.orderId, o.id);
  assert.strictEqual(r.reportId, rp.id);
});

test("复制副本：创建新药单关联到另一记录，解除旧关联但保留旧实体", async () => {
  const rec1 = await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-20", transcript: "上次", manual: true });
  const rec2 = await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-23", transcript: "本次", manual: true });
  const srcOrder = await NurseStorage.upsertOrder({
    source: "市医院", date: "2026-08-20", kind: "hospital", recordId: rec1.id,
    medicines: [{ name: "氨氯地平", qty: 10 }, { name: "缬沙坦", qty: 5 }],
    images: [{ name: "rx.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,xxx" }],
  });
  await NurseStorage.updateRecord(rec1.id, { orderId: srcOrder.id });

  const copyItem = {
    source: "市医院", date: "2026-08-23", kind: "hospital", recordId: rec2.id,
    medicines: srcOrder.medicines.map((m) => ({ name: m.name, qty: m.qty })),
    images: srcOrder.images.map((im) => ({ name: im.name, type: im.type, dataUrl: im.dataUrl })),
  };
  const copyOrder = await NurseStorage.upsertOrder(copyItem);
  await NurseStorage.updateOrder(srcOrder.id, { recordId: "" });
  await NurseStorage.updateRecord(rec2.id, { orderId: copyOrder.id, rxImages: copyItem.images });

  const data = await NurseStorage.load();
  const old = data.orders.find((x) => x.id === srcOrder.id);
  const copy = data.orders.find((x) => x.id === copyOrder.id);
  assert.ok(old, "旧药单实体应保留");
  assert.strictEqual(old.recordId, "", "旧药单应解除关联");
  assert.ok(copy, "新副本应存在");
  assert.strictEqual(copy.recordId, rec2.id, "副本应关联到本次记录");
  assert.strictEqual(copy.medicines.length, 2, "副本应含全部药品");
  assert.ok(copy.images.length === 1, "副本应含图片");
  const r2 = data.records.find((x) => x.id === rec2.id);
  assert.strictEqual(r2.orderId, copyOrder.id, "本次记录应指向副本");
});

test("复制检查报告副本并关联", async () => {
  const rec1 = await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-20", transcript: "上次", manual: true });
  const rec2 = await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-23", transcript: "本次", manual: true });
  const src = await NurseStorage.upsertReport({
    title: "市医院", date: "2026-08-20", kind: "hospital", recordId: rec1.id,
    indicators: [{ name: "血糖", value: "7.2", unit: "mmol/L" }],
  });
  await NurseStorage.updateRecord(rec1.id, { reportId: src.id });

  const copy = await NurseStorage.upsertReport({
    title: "市医院", date: "2026-08-23", kind: "hospital", recordId: rec2.id,
    indicators: src.indicators.map((x) => ({ name: x.name, value: x.value, unit: x.unit })),
  });
  await NurseStorage.updateReport(src.id, { recordId: "" });
  await NurseStorage.updateRecord(rec2.id, { reportId: copy.id });

  const data = await NurseStorage.load();
  const old = data.reports.find((x) => x.id === src.id);
  const cp = data.reports.find((x) => x.id === copy.id);
  assert.ok(old && old.recordId === "", "旧报告保留并解除关联");
  assert.strictEqual(cp.recordId, rec2.id, "副本关联本次");
  assert.strictEqual(cp.indicators.length, 1);
});

test("upsertOrder 过滤无 source 的药单", async () => {
  const o = await NurseStorage.upsertOrder({ medicines: [{ name: "x", qty: 1 }] });
  assert.strictEqual(o, null, "无 source 应被归一化过滤");
});

test("deleteRecord 级联清理关联药单/报告", async () => {
  const rec = await NurseStorage.appendRecord({ hospital: "市医院", transcript: "x", manual: true });
  const o = await NurseStorage.upsertOrder({ source: "市医院", kind: "hospital", recordId: rec.id, medicines: [{ name: "氨氯地平", qty: 3 }] });
  await NurseStorage.updateRecord(rec.id, { orderId: o.id });
  await NurseStorage.deleteRecord(rec.id);
  const data = await NurseStorage.load();
  assert.ok(!data.records.find((r) => r.id === rec.id));
  assert.ok(!data.orders.find((x) => x.id === o.id), "关联药单应级联删除");
});
