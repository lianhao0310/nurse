const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

function registerStorageTests(NurseStorage) {
  beforeEach(async () => { await NurseStorage._resetForTest(); });

  test("load 空数据返回归一化空结构", async () => {
    const data = await NurseStorage.load();
    assert.ok(Array.isArray(data.records));
    assert.ok(Array.isArray(data.orders));
    assert.ok(Array.isArray(data.reports));
    assert.ok(Array.isArray(data.cabinet));
  });

  test("upsertOrder 新药单入库同步药箱", async () => {
    const o = await NurseStorage.upsertOrder({
      source: "市医院", date: "2026-08-23", kind: "hospital",
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
    const o = await NurseStorage.upsertOrder({ source: "市医院", medicines: [{ name: "氨氯地平", qty: 10 }] });
    await NurseStorage.updateOrder(o.id, { medicines: [{ id: o.medicines[0].id, name: "氨氯地平", qty: 25 }] });
    const data = await NurseStorage.load();
    const cab = data.cabinet.find((c) => c.name === "氨氯地平");
    assert.strictEqual(Number(cab.qty), 25, "库存应为调整后 25");
  });

  test("deleteOrder 不删除药箱药品", async () => {
    const o = await NurseStorage.upsertOrder({ source: "市医院", medicines: [{ name: "缬沙坦", qty: 20 }] });
    await NurseStorage.deleteOrder(o.id);
    const data = await NurseStorage.load();
    assert.strictEqual(data.orders.length, 0, "药单应删除");
    assert.ok(data.cabinet.find((c) => c.name === "缬沙坦"), "药箱药品应保留");
  });

  test("upsertReport 归一化指标并过滤空名", async () => {
    const rp = await NurseStorage.upsertReport({
      title: "血常规", date: "2026-08-23", kind: "self",
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
    const srcOrderFull = await NurseStorage.getOrder(srcOrder.id, true);
    const copyItem = {
      source: "市医院", date: "2026-08-23", kind: "hospital", recordId: rec2.id,
      medicines: srcOrder.medicines.map((m) => ({ name: m.name, qty: m.qty })),
      images: srcOrderFull.images.map((im) => ({ name: im.name, type: im.type, dataUrl: im.dataUrl })),
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

  test("exportJSON 输出有效 JSON 且结构完整", async () => {
    await NurseStorage.upsertOrder({ source: "市医院", medicines: [{ name: "氨氯地平", qty: 10 }] });
    await NurseStorage.upsertReport({ title: "血常规", date: "2026-08-23", kind: "self", indicators: [{ name: "血糖", value: "5.5" }] });
    await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-23", transcript: "医嘱", manual: true });
    const json = await NurseStorage.exportJSON();
    assert.ok(typeof json === "string", "导出应为字符串");
    const parsed = JSON.parse(json);
    assert.ok(Array.isArray(parsed.records), "导出应含 records");
    assert.ok(Array.isArray(parsed.orders), "导出应含 orders");
    assert.ok(Array.isArray(parsed.reports), "导出应含 reports");
    assert.ok(Array.isArray(parsed.cabinet), "导出应含 cabinet");
    assert.ok(parsed.orders.length === 1, "应导出 1 条药单");
    assert.ok(parsed.reports.length === 1, "应导出 1 条报告");
    assert.ok(parsed.records.length === 1, "应导出 1 条记录");
  });

  test("importJSON 导入数据并覆盖药单/报告/药箱", async () => {
    const backup = JSON.stringify({
      version: 3, records: [],
      orders: [{ id: "o1", source: "备份医院", date: "2026-01-01", kind: "custom", medicines: [{ id: "m1", name: "备份药", qty: 5 }] }],
      reports: [{ id: "r1", title: "备份报告", date: "2026-01-01", kind: "self", indicators: [{ name: "血糖", value: "7" }] }],
      cabinet: [{ id: "c1", name: "备份药", qty: 5 }],
      settings: { ai: { enabled: false } },
    });
    await NurseStorage.importJSON(backup);
    const data = await NurseStorage.load();
    assert.strictEqual(data.orders.length, 1);
    assert.strictEqual(data.orders[0].source, "备份医院");
    assert.strictEqual(data.reports.length, 1);
    assert.strictEqual(data.reports[0].title, "备份报告");
    assert.strictEqual(data.cabinet.length, 1);
    assert.strictEqual(data.cabinet[0].name, "备份药");
  });

  test("importJSON 按 ID 合并记录（新增+覆盖）", async () => {
    const rec1 = await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-20", transcript: "原记录", manual: true });
    const backup = JSON.stringify({
      version: 3,
      records: [
        { id: rec1.id, createdAt: rec1.createdAt, hospital: "更新医院", visitDate: "2026-08-20", transcript: "覆盖", manual: true },
        { id: "new-rec-1", createdAt: "2026-08-25T00:00:00.000Z", hospital: "新医院", visitDate: "2026-08-25", transcript: "新增", manual: true },
      ],
      orders: [], reports: [], cabinet: [],
    });
    await NurseStorage.importJSON(backup);
    const data = await NurseStorage.load();
    assert.strictEqual(data.records.length, 2, "应有 2 条记录");
    const updated = data.records.find((r) => r.id === rec1.id);
    assert.strictEqual(updated.hospital, "更新医院", "已有记录应被覆盖");
    const added = data.records.find((r) => r.id === "new-rec-1");
    assert.ok(added, "新记录应被添加");
  });

  test("导出→清空→导入 往返保持数据一致", async () => {
    await NurseStorage.upsertOrder({ source: "市医院", medicines: [{ name: "氨氯地平", qty: 10 }, { name: "缬沙坦", qty: 5 }] });
    await NurseStorage.upsertReport({ title: "血常规", date: "2026-08-23", kind: "self", indicators: [{ name: "血糖", value: "5.5", unit: "mmol/L" }] });
    await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-23", transcript: "测试往返", manual: true });
    const json = await NurseStorage.exportJSON();
    await NurseStorage._resetForTest();
    const empty = await NurseStorage.load();
    assert.strictEqual(empty.orders.length, 0, "清空后应无数据");
    await NurseStorage.importJSON(json);
    const restored = await NurseStorage.load();
    assert.strictEqual(restored.orders.length, 1, "应恢复 1 条药单");
    assert.strictEqual(restored.orders[0].medicines.length, 2, "药单应含 2 种药");
    assert.strictEqual(restored.reports.length, 1, "应恢复 1 条报告");
    assert.strictEqual(restored.reports[0].indicators[0].name, "血糖", "报告指标应一致");
    assert.strictEqual(restored.records.length, 1, "应恢复 1 条记录");
    assert.strictEqual(restored.records[0].transcript, "测试往返", "记录内容应一致");
  });

  test("importJSON 保留 followedIndicators", async () => {
    await NurseStorage.setFollowedIndicators([{ name: "血糖", unit: "mmol/L", range: "3.9-6.1" }]);
    const json = await NurseStorage.exportJSON();
    await NurseStorage._resetForTest();
    await NurseStorage.importJSON(json);
    const data = await NurseStorage.load();
    assert.ok(data.followedIndicators && data.followedIndicators.length === 1, "应恢复 1 个关注指标");
    assert.strictEqual(data.followedIndicators[0].name, "血糖");
    assert.strictEqual(data.followedIndicators[0].unit, "mmol/L");
  });

  test("importJSON 空备份不覆盖现有数据", async () => {
    await NurseStorage.upsertOrder({ source: "市医院", medicines: [{ name: "氨氯地平", qty: 10 }] });
    await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-23", transcript: "已有", manual: true });
    const before = await NurseStorage.load();
    assert.ok(before.orders.length === 1, "导入前应有 1 条药单");
    await NurseStorage.importJSON(JSON.stringify({ version: 3, records: [], orders: [], reports: [], cabinet: [] }));
    const after = await NurseStorage.load();
    assert.strictEqual(after.orders.length, 1, "空备份不应清空现有药单");
    assert.strictEqual(after.records.length, 1, "空备份不应清空现有记录");
  });

  test("全量数据导出导入往返一致（含关注指标+设置）", async () => {
    await NurseStorage.upsertOrder({ source: "市医院", medicines: [{ name: "氨氯地平", qty: 30 }, { name: "缬沙坦", qty: 10 }] });
    await NurseStorage.upsertReport({ title: "血常规", date: "2026-08-23", kind: "self", indicators: [{ name: "血糖", value: "5.5", unit: "mmol/L" }, { name: "血压", value: "130/80", abnormal: true }] });
    await NurseStorage.appendRecord({ hospital: "市医院", visitDate: "2026-08-23", transcript: "全量测试", manual: true });
    await NurseStorage.setFollowedIndicators([{ name: "血糖", unit: "mmol/L", range: "3.9-6.1" }, { name: "血压", unit: "mmHg", range: "90-140" }]);
    const json = await NurseStorage.exportJSON();
    await NurseStorage._resetForTest();
    await NurseStorage.importJSON(json);
    const restored = await NurseStorage.load();
    assert.strictEqual(restored.orders.length, 1, "药单");
    assert.strictEqual(restored.orders[0].medicines.length, 2, "药品");
    assert.strictEqual(restored.reports.length, 1, "报告");
    assert.strictEqual(restored.reports[0].indicators.length, 2, "指标");
    assert.strictEqual(restored.records.length, 1, "记录");
    assert.strictEqual(restored.records[0].transcript, "全量测试", "记录内容");
    assert.ok(restored.cabinet.length >= 2, "药箱应有药品");
    assert.strictEqual(restored.followedIndicators.length, 2, "关注指标");
    assert.strictEqual(restored.followedIndicators[0].name, "血糖", "关注指标名");
    assert.strictEqual(restored.followedIndicators[1].range, "90-140", "关注指标参考值");
  });

  test("导入空AI配置不覆盖现有AI设置", async () => {
    await NurseStorage.updateSettings({ ai: { enabled: true, baseUrl: "https://my.api/v1", apiKey: "sk-secret", model: "gpt-4o" } });
    const before = await NurseStorage.load();
    assert.strictEqual(before.settings.ai.apiKey, "sk-secret", "导入前应有 apiKey");
    const backup = JSON.stringify({ version: 3, records: [{ id: "r1", hospital: "市医院", visitDate: "2026-08-23", transcript: "test", manual: true, createdAt: "2026-08-23T10:00:00Z" }], orders: [], reports: [], cabinet: [], settings: { ai: { enabled: false, baseUrl: "", apiKey: "", model: "" } } });
    await NurseStorage.importJSON(backup);
    const after = await NurseStorage.load();
    assert.strictEqual(after.settings.ai.apiKey, "sk-secret", "空 apiKey 不应覆盖现有值");
    assert.strictEqual(after.settings.ai.baseUrl, "https://my.api/v1", "空 baseUrl 不应覆盖现有值");
    assert.strictEqual(after.settings.ai.model, "gpt-4o", "空 model 不应覆盖现有值");
    assert.strictEqual(after.settings.ai.enabled, true, "enabled 不应被空备份覆盖");
  });

  test("首次开启AI时enabled能正常保存", async () => {
    await NurseStorage.updateSettings({ ai: { enabled: true, baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o" } });
    const after = await NurseStorage.load();
    assert.strictEqual(after.settings.ai.enabled, true, "enabled=true 应保存成功");
    assert.strictEqual(after.settings.ai.baseUrl, "https://api.openai.com/v1", "baseUrl 应保存");
  });

  test("导入非空AI配置覆盖现有AI设置", async () => {
    await NurseStorage.updateSettings({ ai: { enabled: true, baseUrl: "https://my.api/v1", apiKey: "sk-old", model: "gpt-4o" } });
    const backup = JSON.stringify({ version: 3, records: [], orders: [], reports: [], cabinet: [], settings: { ai: { enabled: true, baseUrl: "https://new.api/v1", apiKey: "sk-new", model: "gpt-4o-mini" } } });
    await NurseStorage.importJSON(backup);
    const after = await NurseStorage.load();
    assert.strictEqual(after.settings.ai.apiKey, "sk-new", "非空 apiKey 应覆盖");
    assert.strictEqual(after.settings.ai.baseUrl, "https://new.api/v1", "非空 baseUrl 应覆盖");
    assert.strictEqual(after.settings.ai.model, "gpt-4o-mini", "非空 model 应覆盖");
  });

  test("importJSON selection 仅导入勾选项", async () => {
    await NurseStorage.appendRecord({ hospital: "原医院", visitDate: "2026-08-23", transcript: "原有记录", manual: true });
    await NurseStorage.upsertOrder({ source: "原医院", medicines: [{ name: "原药", qty: 5 }] });
    const backup = JSON.stringify({
      version: 3,
      records: [{ id: "r-new", hospital: "新医院", visitDate: "2026-08-24", transcript: "新记录", manual: true, createdAt: "2026-08-24T10:00:00Z" }],
      orders: [{ id: "o-new", source: "新医院", medicines: [{ name: "新药", qty: 10 }] }],
      reports: [], cabinet: [],
    });
    await NurseStorage.importJSON(backup, { records: true, orders: false });
    const after = await NurseStorage.load();
    assert.ok(after.records.some((r) => r.id === "r-new"), "勾选 records 应导入新记录");
    assert.ok(!after.orders.some((o) => o.id === "o-new"), "未勾选 orders 且无关联 不应导入新药单");
    assert.ok(after.orders.some((o) => o.source === "原医院"), "原药单应保留");
  });

  test("importJSON selection 全不勾选则不导入任何数据", async () => {
    await NurseStorage.appendRecord({ hospital: "原医院", visitDate: "2026-08-23", transcript: "原有", manual: true });
    const before = await NurseStorage.load();
    const backup = JSON.stringify({
      version: 3,
      records: [{ id: "r-new", hospital: "新医院", visitDate: "2026-08-24", transcript: "新", manual: true, createdAt: "2026-08-24T10:00:00Z" }],
      orders: [], reports: [], cabinet: [],
    });
    await NurseStorage.importJSON(backup, { records: false, orders: false, reports: false, cabinet: false, settings: false });
    const after = await NurseStorage.load();
    assert.strictEqual(after.records.length, before.records.length, "全不勾选不应改变记录数");
    assert.ok(!after.records.some((r) => r.id === "r-new"), "新记录不应被导入");
  });

  test("导入问诊记录时强制带关联药单和报告", async () => {
    const backup = JSON.stringify({
      version: 3,
      records: [{ id: "r1", hospital: "新医院", visitDate: "2026-08-24", transcript: "关联测试", manual: true, createdAt: "2026-08-24T10:00:00Z", orderId: "o1", reportId: "rp1" }],
      orders: [{ id: "o1", source: "新医院", medicines: [{ name: "关联药", qty: 10 }] }],
      reports: [{ id: "rp1", title: "关联报告", date: "2026-08-24", kind: "self", indicators: [] }],
      cabinet: [],
    });
    await NurseStorage.importJSON(backup, { records: true, orders: false, reports: false });
    const after = await NurseStorage.load();
    assert.ok(after.records.some((r) => r.id === "r1"), "问诊记录应导入");
    assert.ok(after.orders.some((o) => o.id === "o1"), "关联药单应强制导入");
    assert.ok(after.reports.some((r) => r.id === "rp1"), "关联报告应强制导入");
  });

  test("个人配置合并含关注指标和AI设置", async () => {
    const backup = JSON.stringify({
      version: 3, records: [], orders: [], reports: [], cabinet: [],
      followedIndicators: [{ name: "血糖", unit: "mmol/L", range: "3.9-6.1" }],
      indicatorMeta: { "血糖": { unit: "mmol/L" } },
      settings: { ai: { enabled: true, baseUrl: "https://api.test/v1", apiKey: "sk-test", model: "gpt-4o" } },
    });
    await NurseStorage.importJSON(backup, { settings: true });
    const after = await NurseStorage.load();
    assert.strictEqual(after.followedIndicators.length, 1, "关注指标应导入");
    assert.strictEqual(after.followedIndicators[0].name, "血糖", "关注指标名");
    assert.strictEqual(after.settings.ai.apiKey, "sk-test", "AI设置应导入");
  });

  test("getRecord 查询存在与不存在", async () => {
    const rec = await NurseStorage.appendRecord({ hospital: "测试医院", visitDate: "2026-01-01", transcript: "t", manual: true });
    assert.ok(rec && rec.id, "appendRecord 应返回含 id 的记录");
    const found = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(found.hospital, "测试医院", "getRecord 应返回正确记录");
    const notFound = await NurseStorage.getRecord("nonexistent-id");
    assert.strictEqual(notFound, null, "不存在的记录返回 null");
  });

  test("appendRecord 字段归一化默认值", async () => {
    const rec = await NurseStorage.appendRecord({ hospital: "A", visitDate: "2026-01-01", manual: true });
    assert.ok(rec.createdAt, "应有 createdAt");
    assert.strictEqual(rec.orderId, "", "orderId 默认空");
    assert.strictEqual(rec.reportId, "", "reportId 默认空");
    assert.strictEqual(rec.transcript, "", "transcript 默认空");
    assert.strictEqual(rec.doctor, "", "doctor 默认空");
  });

  test("updateRecord 修改字段并持久化", async () => {
    const rec = await NurseStorage.appendRecord({ hospital: "旧", visitDate: "2026-01-01", manual: true });
    await NurseStorage.updateRecord(rec.id, { hospital: "新", doctor: "张医生" });
    const updated = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(updated.hospital, "新", "hospital 应更新");
    assert.strictEqual(updated.doctor, "张医生", "doctor 应更新");
    assert.strictEqual(updated.visitDate, "2026-01-01", "未修改字段保持不变");
  });

  test("updateRecord 不存在返回 null", async () => {
    const result = await NurseStorage.updateRecord("nonexistent", { hospital: "x" });
    assert.strictEqual(result, null, "更新不存在的记录返回 null");
  });

  test("getOrder 查询存在与不存在", async () => {
    const o = await NurseStorage.upsertOrder({ source: "市医院", medicines: [{ name: "测试药", qty: 5 }] });
    const found = await NurseStorage.getOrder(o.id);
    assert.strictEqual(found.source, "市医院", "getOrder 返回正确");
    assert.strictEqual(await NurseStorage.getOrder("nope"), null, "不存在返回 null");
  });

  test("upsertOrder 多药品同步到药箱", async () => {
    await NurseStorage.upsertOrder({ source: "A", medicines: [{ name: "药A", qty: 10 }, { name: "药B", qty: 20 }] });
    const cabinet = await NurseStorage.getCabinetDrugs();
    assert.ok(cabinet.some((c) => c.name === "药A" && c.qty === 10), "药A 入箱 qty=10");
    assert.ok(cabinet.some((c) => c.name === "药B" && c.qty === 20), "药B 入箱 qty=20");
  });

  test("updateOrder 编辑药单数量同步库存", async () => {
    const o = await NurseStorage.upsertOrder({ source: "A", medicines: [{ name: "药X", qty: 30 }] });
    await NurseStorage.updateOrder(o.id, { medicines: [{ name: "药X", qty: 15 }] });
    const cabinet = await NurseStorage.getCabinetDrugs();
    const drug = cabinet.find((c) => c.name === "药X");
    assert.strictEqual(drug.qty, 15, "药单改 15 后库存应同步为 15");
  });

  test("deleteOrder 不删除药箱药品（保留库存）", async () => {
    const o = await NurseStorage.upsertOrder({ source: "A", medicines: [{ name: "药Y", qty: 8 }] });
    await NurseStorage.deleteOrder(o.id);
    const cabinet = await NurseStorage.getCabinetDrugs();
    assert.ok(cabinet.some((c) => c.name === "药Y"), "删除药单后药箱药品应保留");
    const orders = await NurseStorage.getOrders();
    assert.ok(!orders.some((x) => x.id === o.id), "药单应已删除");
  });

  test("deleteOrder 清除问诊记录的 orderId 关联", async () => {
    const o = await NurseStorage.upsertOrder({ source: "A", medicines: [{ name: "药Z", qty: 5 }] });
    const rec = await NurseStorage.appendRecord({ hospital: "H", visitDate: "2026-01-01", manual: true });
    await NurseStorage.updateRecord(rec.id, { orderId: o.id });
    await NurseStorage.deleteOrder(o.id);
    const r = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(r.orderId, "", "删除药单后记录 orderId 应清空");
  });

  test("getReport 查询存在与不存在", async () => {
    const rp = await NurseStorage.upsertReport({ title: "血常规", date: "2026-01-01", kind: "self", indicators: [] });
    const found = await NurseStorage.getReport(rp.id);
    assert.strictEqual(found.title, "血常规", "getReport 返回正确");
    assert.strictEqual(await NurseStorage.getReport("nope"), null, "不存在返回 null");
  });

  test("updateReport 修改指标", async () => {
    const rp = await NurseStorage.upsertReport({ title: "R", date: "2026-01-01", kind: "self", indicators: [{ name: "血糖", value: "5.0", unit: "mmol/L" }] });
    await NurseStorage.updateReport(rp.id, { indicators: [{ name: "血糖", value: "6.2", unit: "mmol/L" }] });
    const updated = await NurseStorage.getReport(rp.id);
    assert.strictEqual(updated.indicators[0].value, "6.2", "指标值应更新");
  });

  test("deleteReport 清除问诊记录的 reportId 关联", async () => {
    const rp = await NurseStorage.upsertReport({ title: "R", date: "2026-01-01", kind: "self", indicators: [] });
    const rec = await NurseStorage.appendRecord({ hospital: "H", visitDate: "2026-01-01", manual: true });
    await NurseStorage.updateRecord(rec.id, { reportId: rp.id });
    await NurseStorage.deleteReport(rp.id);
    const r = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(r.reportId, "", "删除报告后记录 reportId 应清空");
  });

  test("upsertReport 指标 value 为 0 时保留", async () => {
    const rp = await NurseStorage.upsertReport({ title: "R", date: "2026-01-01", kind: "self", indicators: [{ name: "血糖", value: "0", unit: "mmol/L" }] });
    assert.strictEqual(rp.indicators[0].value, "0", "value=0 应保留");
  });

  test("upsertReport 过滤空名指标", async () => {
    const rp = await NurseStorage.upsertReport({ title: "R", date: "2026-01-01", kind: "self", indicators: [{ name: "", value: "1" }, { name: "血糖", value: "5" }] });
    assert.strictEqual(rp.indicators.length, 1, "空名指标应过滤");
    assert.strictEqual(rp.indicators[0].name, "血糖", "保留有效指标");
  });

  test("upsertCabinetDrug 新增和按名更新", async () => {
    await NurseStorage.upsertCabinetDrug({ name: "阿司匹林", qty: 100, unit: "片" });
    await NurseStorage.upsertCabinetDrug({ name: "阿司匹林", qty: 50, unit: "片" });
    const cabinet = await NurseStorage.getCabinetDrugs();
    const drug = cabinet.find((c) => c.name === "阿司匹林");
    assert.strictEqual(drug.qty, 50, "同名药品应更新而非新增");
    assert.strictEqual(cabinet.filter((c) => c.name === "阿司匹林").length, 1, "不应有重复");
  });

  test("updateCabinetDrug 修改库存", async () => {
    const d = await NurseStorage.upsertCabinetDrug({ name: "布洛芬", qty: 20, unit: "粒" });
    await NurseStorage.updateCabinetDrug(d.id, { qty: 10 });
    const updated = await NurseStorage.getCabinetDrug(d.id);
    assert.strictEqual(updated.qty, 10, "库存应更新为 10");
  });

  test("deleteCabinetDrug 删除并从药单移除", async () => {
    const d = await NurseStorage.upsertCabinetDrug({ name: "维生素C", qty: 30, unit: "片" });
    await NurseStorage.upsertOrder({ source: "A", medicines: [{ name: "维生素C", qty: 5 }] });
    await NurseStorage.deleteCabinetDrug(d.id);
    const cabinet = await NurseStorage.getCabinetDrugs();
    assert.ok(!cabinet.some((c) => c.id === d.id), "药箱药品应删除");
    const orders = await NurseStorage.getOrders();
    orders.forEach((o) => {
      assert.ok(!o.medicines.some((m) => m.name === "维生素C"), "药单中应移除该药");
    });
  });

  test("AI 设置 enabled 开关往返", async () => {
    await NurseStorage.updateSettings({ ai: { enabled: true, baseUrl: "https://api.test/v1", apiKey: "sk-1", model: "gpt-4o" } });
    let s = (await NurseStorage.load()).settings;
    assert.strictEqual(s.ai.enabled, true, "开启后应为 true");
    await NurseStorage.updateSettings({ ai: { enabled: false, baseUrl: "https://api.test/v1", apiKey: "sk-1", model: "gpt-4o" } });
    s = (await NurseStorage.load()).settings;
    assert.strictEqual(s.ai.enabled, false, "关闭后应为 false");
  });

  test("AI 设置 baseUrl 和 model 默认值", async () => {
    await NurseStorage.updateSettings({ ai: { enabled: true, baseUrl: "", apiKey: "sk-2", model: "" } });
    const s = (await NurseStorage.load()).settings;
    assert.strictEqual(s.ai.baseUrl, "https://api.openai.com/v1", "空 baseUrl 应有默认值");
    assert.strictEqual(s.ai.model, "gpt-4o", "空 model 应有默认值");
  });

  test("通知设置开关往返", async () => {
    await NurseStorage.updateSettings({ notifications: true });
    assert.strictEqual((await NurseStorage.load()).settings.notifications, true, "通知开启");
    await NurseStorage.updateSettings({ notifications: false });
    assert.strictEqual((await NurseStorage.load()).settings.notifications, false, "通知关闭");
  });

  test("大字体设置开关往返", async () => {
    await NurseStorage.updateSettings({ largeFont: true });
    assert.strictEqual((await NurseStorage.load()).settings.largeFont, true, "大字体开启");
    await NurseStorage.updateSettings({ largeFont: false });
    assert.strictEqual((await NurseStorage.load()).settings.largeFont, false, "大字体关闭");
  });

  test("提醒时间设置保存和读取", async () => {
    await NurseStorage.updateSettings({ reminderTimes: { morning: "07:30", noon: "12:00", evening: "18:30" } });
    const s = (await NurseStorage.load()).settings;
    assert.strictEqual(s.reminderTimes.morning, "07:30", "morning 时间");
    assert.strictEqual(s.reminderTimes.noon, "12:00", "noon 时间");
    assert.strictEqual(s.reminderTimes.evening, "18:30", "evening 时间");
  });

  test("setFollowedIndicators 对象数组增删改", async () => {
    await NurseStorage.setFollowedIndicators([{ name: "血糖", unit: "mmol/L", range: "3.9-6.1" }, { name: "血压", unit: "mmHg", range: "90-140" }]);
    let data = await NurseStorage.load();
    assert.strictEqual(data.followedIndicators.length, 2, "应有两个关注指标");
    await NurseStorage.setFollowedIndicators([{ name: "血糖", unit: "mmol/L", range: "3.9-6.1" }]);
    data = await NurseStorage.load();
    assert.strictEqual(data.followedIndicators.length, 1, "删除后应剩一个");
    assert.strictEqual(data.followedIndicators[0].name, "血糖", "保留的应为血糖");
  });

  test("setFollowedIndicators 兼容字符串数组旧格式", async () => {
    await NurseStorage.setFollowedIndicators(["血糖", "血压"]);
    const data = await NurseStorage.load();
    assert.strictEqual(data.followedIndicators.length, 2, "字符串数组应转换");
    assert.strictEqual(data.followedIndicators[0].name, "血糖", "名称正确");
    assert.strictEqual(data.followedIndicators[0].unit, "", "unit 默认空");
  });

  test("setIndicatorMeta 合并写入不覆盖已有", async () => {
    await NurseStorage.setIndicatorMeta({ "血糖": { unit: "mmol/L", range: "3.9-6.1" } });
    await NurseStorage.setIndicatorMeta({ "血糖": { unit: "", range: "4.0-7.0" } });
    const data = await NurseStorage.load();
    assert.strictEqual(data.indicatorMeta["血糖"].unit, "mmol/L", "空值不覆盖已有 unit");
    assert.strictEqual(data.indicatorMeta["血糖"].range, "4.0-7.0", "非空 range 应更新");
  });

  test("setDone/getDone 勾选和取消", async () => {
    const dateKey = "2026-01-15";
    await NurseStorage.setDone(dateKey, "medDoses", "dose-1", true);
    let done = await NurseStorage.getDone(dateKey);
    assert.strictEqual(done.medDoses["dose-1"], true, "勾选后应为 true");
    await NurseStorage.setDone(dateKey, "medDoses", "dose-1", false);
    done = await NurseStorage.getDone(dateKey);
    assert.ok(!done.medDoses["dose-1"], "取消后应不存在");
  });

  test("dailyDone 最多保留7天", async () => {
    for (let i = 1; i <= 10; i++) {
      await NurseStorage.setDone("2026-01-" + String(i).padStart(2, "0"), "medDoses", "d" + i, true);
    }
    const s = (await NurseStorage.load()).settings;
    const keys = Object.keys(s.dailyDone);
    assert.ok(keys.length <= 7, "dailyDone 最多保留 7 天，实际 " + keys.length);
  });

  test("summarizeMedicines 多药单合并同药", async () => {
    const orders = [
      { id: "o1", medicines: [{ name: "药A", qty: 10, unit: "片" }, { name: "药B", qty: 5 }] },
      { id: "o2", medicines: [{ name: "药A", qty: 20, unit: "片" }] },
    ];
    const summary = NurseStorage.summarizeMedicines(orders);
    const a = summary.find((s) => s.name === "药A");
    assert.strictEqual(a.qty, 30, "药A 合并 qty=30");
    assert.strictEqual(a.orderIds.length, 2, "药A 关联 2 个药单");
    assert.ok(summary.some((s) => s.name === "药B" && s.qty === 5), "药B 存在");
  });

  test("summarizeMedicines 空输入不报错", async () => {
    assert.strictEqual(NurseStorage.summarizeMedicines([]).length, 0, "空数组返回空");
    assert.strictEqual(NurseStorage.summarizeMedicines(null).length, 0, "null 返回空");
  });

  test("drugNames 返回药名和别名", async () => {
    const names = NurseStorage.drugNames({ name: "阿司匹林", alias: "ASA" });
    assert.ok(names.includes("阿司匹林"), "应包含药名");
    assert.ok(names.includes("ASA"), "应包含别名");
    const names2 = NurseStorage.drugNames({ name: "布洛芬", alias: "" });
    assert.strictEqual(names2.length, 1, "无别名时只返回药名");
  });

  test("load 空存储返回安全默认结构", async () => {
    const data = await NurseStorage.load();
    assert.ok(Array.isArray(data.records), "records 是数组");
    assert.ok(Array.isArray(data.orders), "orders 是数组");
    assert.ok(Array.isArray(data.reports), "reports 是数组");
    assert.ok(Array.isArray(data.cabinet), "cabinet 是数组");
    assert.ok(Array.isArray(data.followedIndicators), "followedIndicators 是数组");
    assert.ok(data.settings && typeof data.settings === "object", "settings 是对象");
    assert.ok(data.settings.ai && typeof data.settings.ai === "object", "settings.ai 是对象");
  });

  test("upsertOrder 空 source 返回 null", async () => {
    const result = await NurseStorage.upsertOrder({ source: "", medicines: [{ name: "药", qty: 1 }] });
    assert.strictEqual(result, null, "空 source 应拒绝");
  });

  test("upsertOrder 空药品列表创建空药单", async () => {
    const result = await NurseStorage.upsertOrder({ source: "A", medicines: [] });
    assert.ok(result && result.id, "空药品列表可创建药单");
    assert.strictEqual(result.medicines.length, 0, "药品列表为空");
  });

  test("upsertCabinetDrug 空名返回 null", async () => {
    const result = await NurseStorage.upsertCabinetDrug({ name: "", qty: 10 });
    assert.strictEqual(result, null, "空药名应拒绝");
  });

  test("导出→导入→再导出 数据稳定不变", async () => {
    await NurseStorage.upsertOrder({ source: "稳定测试", medicines: [{ name: "稳定药", qty: 7 }] });
    await NurseStorage.appendRecord({ hospital: "稳定医院", visitDate: "2026-01-01", transcript: "稳定", manual: true });
    await NurseStorage.setFollowedIndicators([{ name: "稳定指标", unit: "mg", range: "1-10" }]);
    const json1 = await NurseStorage.exportJSON();
    await NurseStorage._resetForTest();
    await NurseStorage.importJSON(json1);
    const json2 = await NurseStorage.exportJSON();
    const p1 = JSON.parse(json1);
    const p2 = JSON.parse(json2);
    assert.strictEqual(p2.records.length, p1.records.length, "记录数一致");
    assert.strictEqual(p2.orders.length, p1.orders.length, "药单数一致");
    assert.strictEqual(p2.cabinet.length, p1.cabinet.length, "药箱数一致");
    assert.strictEqual(p2.followedIndicators.length, p1.followedIndicators.length, "关注指标数一致");
    assert.strictEqual(p2.settings.ai.apiKey, p1.settings.ai.apiKey, "AI 配置一致");
  });

  test("删除问诊记录级联清理药单和报告", async () => {
    const o = await NurseStorage.upsertOrder({ source: "级联", medicines: [{ name: "级联药", qty: 3 }] });
    const rp = await NurseStorage.upsertReport({ title: "级联报告", date: "2026-01-01", kind: "self", indicators: [] });
    const rec = await NurseStorage.appendRecord({ hospital: "级联医院", visitDate: "2026-01-01", manual: true });
    await NurseStorage.updateRecord(rec.id, { orderId: o.id, reportId: rp.id });
    await NurseStorage.updateOrder(o.id, { recordId: rec.id });
    await NurseStorage.updateReport(rp.id, { recordId: rec.id });
    await NurseStorage.deleteRecord(rec.id);
    const data = await NurseStorage.load();
    assert.ok(!data.records.some((r) => r.id === rec.id), "记录已删除");
    assert.ok(!data.orders.some((x) => x.id === o.id), "关联药单已级联删除");
    assert.ok(!data.reports.some((x) => x.id === rp.id), "关联报告已级联删除");
  });

  test("多药单同药名药箱库存累加正确", async () => {
    await NurseStorage.upsertOrder({ source: "A", medicines: [{ name: "共享药", qty: 10 }] });
    await NurseStorage.upsertOrder({ source: "B", medicines: [{ name: "共享药", qty: 15 }] });
    const cabinet = await NurseStorage.getCabinetDrugs();
    const drug = cabinet.find((c) => c.name === "共享药");
    assert.strictEqual(drug.qty, 25, "两药单同药名库存应累加为 25");
  });

  test("AI 设置往返：保存→读取→验证所有字段", async () => {
    const config = { enabled: true, baseUrl: "https://custom.api/v2", apiKey: "sk-full-test", model: "gpt-4o-mini" };
    await NurseStorage.updateSettings({ ai: config });
    const s = (await NurseStorage.load()).settings.ai;
    assert.strictEqual(s.enabled, config.enabled, "enabled 一致");
    assert.strictEqual(s.baseUrl, config.baseUrl, "baseUrl 一致");
    assert.strictEqual(s.apiKey, config.apiKey, "apiKey 一致");
    assert.strictEqual(s.model, config.model, "model 一致");
  });

  test("appendRecord 医院+日期唯一约束：相同则更新不新建", async () => {
    const r1 = await NurseStorage.appendRecord({ hospital: "第一医院", visitDate: "2026-03-01", transcript: "第一次", manual: true });
    const r2 = await NurseStorage.appendRecord({ hospital: "第一医院", visitDate: "2026-03-01", transcript: "第二次", manual: true });
    assert.strictEqual(r1.id, r2.id, "相同医院+日期应返回同一条记录");
    const records = await NurseStorage.getRecords();
    assert.strictEqual(records.length, 1, "不应有重复记录");
    assert.strictEqual(records[0].transcript, "第二次", "应更新为最新内容");
  });

  test("appendRecord 不同医院或日期允许创建多条", async () => {
    await NurseStorage.appendRecord({ hospital: "A医院", visitDate: "2026-03-01", manual: true });
    await NurseStorage.appendRecord({ hospital: "B医院", visitDate: "2026-03-01", manual: true });
    await NurseStorage.appendRecord({ hospital: "A医院", visitDate: "2026-03-02", manual: true });
    const records = await NurseStorage.getRecords();
    assert.strictEqual(records.length, 3, "不同医院或日期应允许创建");
  });

  test("deleteRecord 按 orderId/reportId 双向关联删除", async () => {
    const o = await NurseStorage.upsertOrder({ source: "双向", medicines: [{ name: "双药", qty: 3 }] });
    const rp = await NurseStorage.upsertReport({ title: "双报", date: "2026-03-01", kind: "self", indicators: [] });
    const rec = await NurseStorage.appendRecord({ hospital: "双医院", visitDate: "2026-03-01", manual: true });
    await NurseStorage.updateRecord(rec.id, { orderId: o.id, reportId: rp.id });
    await NurseStorage.deleteRecord(rec.id);
    const data = await NurseStorage.load();
    assert.ok(!data.orders.some((x) => x.id === o.id), "通过 orderId 关联的药单应删除");
    assert.ok(!data.reports.some((x) => x.id === rp.id), "通过 reportId 关联的报告应删除");
  });

  test("saveConsultChat 内存模式 upsert 不产生重复历史记录", async () => {
    const chat = await NurseStorage.newConsultChat();
    chat.title = "血压偏高怎么办";
    chat.messages.push({ role: "user", content: "血压偏高怎么办", ts: new Date().toISOString() });
    await NurseStorage.saveConsultChat(chat);
    chat.messages.push({ role: "assistant", content: "建议低盐饮食并规律监测", ts: new Date().toISOString() });
    await NurseStorage.saveConsultChat(chat);
    const chats = await NurseStorage.getConsultChats();
    assert.strictEqual(chats.length, 1, "一次提问多次保存应只产生1条历史记录");
    assert.strictEqual(chats[0].id, chat.id, "应保留同一 id");
    assert.strictEqual(chats[0].messages.length, 2, "应保留最新消息列表");
  });

  // ---------------- 分页查询 ----------------
  test("getRecordsPaged 基本分页", async () => {
    for (let i = 1; i <= 25; i++) {
      await NurseStorage.appendRecord({ hospital: `医院${i}`, visitDate: `2026-01-${String(i).padStart(2, "0")}`, transcript: `记录${i}`, manual: true });
    }
    const page1 = await NurseStorage.getRecordsPaged("", 1, 10);
    assert.strictEqual(page1.rows.length, 10, "第一页10条");
    assert.strictEqual(page1.total, 25, "总数25");
    assert.strictEqual(page1.hasMore, true, "有更多");
    const page3 = await NurseStorage.getRecordsPaged("", 3, 10);
    assert.strictEqual(page3.rows.length, 5, "第三页5条");
    assert.strictEqual(page3.hasMore, false, "无更多");
  });

  test("getRecordsPaged 关键词搜索", async () => {
    await NurseStorage.appendRecord({ hospital: "协和医院", visitDate: "2026-01-01", transcript: "高血压", manual: true });
    await NurseStorage.appendRecord({ hospital: "人民医院", visitDate: "2026-01-02", transcript: "糖尿病", manual: true });
    const r = await NurseStorage.getRecordsPaged("协和", 1, 10);
    assert.strictEqual(r.total, 1, "关键词搜索应只匹配1条");
    assert.strictEqual(r.rows[0].hospital, "协和医院");
  });

  test("getOrdersPaged 分页和搜索", async () => {
    for (let i = 1; i <= 15; i++) {
      await NurseStorage.upsertOrder({ source: `源${i}`, medicines: [{ name: `药${i}`, qty: i }] });
    }
    const page1 = await NurseStorage.getOrdersPaged("", 1, 10);
    assert.strictEqual(page1.rows.length, 10);
    assert.strictEqual(page1.total, 15);
    const search = await NurseStorage.getOrdersPaged("药3", 1, 10);
    assert.strictEqual(search.total, 1, "搜索药3应匹配1条");
  });

  test("getReportsPaged 分页和搜索", async () => {
    for (let i = 1; i <= 5; i++) {
      await NurseStorage.upsertReport({ title: `报告${i}`, date: `2026-01-0${i}`, kind: "self", indicators: [] });
    }
    const page = await NurseStorage.getReportsPaged("", 1, 3);
    assert.strictEqual(page.rows.length, 3);
    assert.strictEqual(page.total, 5);
    assert.strictEqual(page.hasMore, true);
    const search = await NurseStorage.getReportsPaged("报告2", 1, 10);
    assert.strictEqual(search.total, 1);
  });

  test("getCabinetDrugsPaged 分页和搜索", async () => {
    for (let i = 1; i <= 8; i++) {
      await NurseStorage.upsertCabinetDrug({ name: `药品${i}`, qty: i });
    }
    const page = await NurseStorage.getCabinetDrugsPaged("", 1, 5);
    assert.strictEqual(page.rows.length, 5);
    assert.strictEqual(page.total, 8);
    const search = await NurseStorage.getCabinetDrugsPaged("药品3", 1, 10);
    assert.strictEqual(search.total, 1);
  });

  test("getConsultChatsPaged 分页", async () => {
    for (let i = 0; i < 3; i++) {
      const chat = await NurseStorage.newConsultChat();
      chat.title = `对话${i}`;
      await NurseStorage.saveConsultChat(chat);
    }
    const page = await NurseStorage.getConsultChatsPaged("", 1, 2);
    assert.strictEqual(page.rows.length, 2);
    assert.strictEqual(page.total, 3);
  });

  // ---------------- AI 聊天完整 CRUD ----------------
  test("getConsultChat 单条获取", async () => {
    const chat = await NurseStorage.newConsultChat();
    chat.title = "测试对话";
    chat.messages.push({ role: "user", content: "你好", ts: new Date().toISOString() });
    await NurseStorage.saveConsultChat(chat);
    const found = await NurseStorage.getConsultChat(chat.id);
    assert.strictEqual(found.title, "测试对话");
    assert.strictEqual(found.messages.length, 1);
    assert.strictEqual(found.messages[0].content, "你好");
  });

  test("deleteConsultChat 删除聊天及消息", async () => {
    const chat = await NurseStorage.newConsultChat();
    chat.messages.push({ role: "user", content: "测试", ts: new Date().toISOString() });
    await NurseStorage.saveConsultChat(chat);
    await NurseStorage.deleteConsultChat(chat.id);
    assert.strictEqual(await NurseStorage.getConsultChat(chat.id), null, "删除后返回 null");
    const chats = await NurseStorage.getConsultChats();
    assert.ok(!chats.some((c) => c.id === chat.id), "列表中不应存在");
  });

  test("saveConsultChat 带图片", async () => {
    const chat = await NurseStorage.newConsultChat();
    chat.messages.push({ role: "user", content: "看图", ts: new Date().toISOString(), images: [{ dataUrl: "data:image/jpeg;base64,abc", name: "img.jpg", type: "image/jpeg" }] });
    await NurseStorage.saveConsultChat(chat);
    const found = await NurseStorage.getConsultChat(chat.id);
    assert.ok(found.messages[0].images && found.messages[0].images.length === 1, "应保留图片");
  });

  test("saveConsultChat 消息排序保持", async () => {
    const chat = await NurseStorage.newConsultChat();
    for (let i = 0; i < 5; i++) {
      chat.messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: `消息${i}`, ts: new Date().toISOString() });
    }
    await NurseStorage.saveConsultChat(chat);
    const found = await NurseStorage.getConsultChat(chat.id);
    assert.strictEqual(found.messages.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(found.messages[i].content, `消息${i}`, `消息${i}顺序正确`);
    }
  });

  // ---------------- 记录带图片完整往返 ----------------
  test("appendRecord 带图片并读回", async () => {
    const rec = await NurseStorage.appendRecord({
      hospital: "图片医院", visitDate: "2026-01-01", transcript: "带图", manual: true,
      images: [{ dataUrl: "data:image/jpeg;base64,img1", name: "1.jpg", type: "image/jpeg" }],
      rxImages: [{ dataUrl: "data:image/jpeg;base64,rx1", name: "rx.jpg", type: "image/jpeg" }],
      examImages: [{ dataUrl: "data:image/jpeg;base64,ex1", name: "ex.jpg", type: "image/jpeg" }],
    });
    const found = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(found.images.length, 1, "应有1张普通图片");
    assert.strictEqual(found.rxImages.length, 1, "应有1张药单图片");
    assert.strictEqual(found.examImages.length, 1, "应有1张检查图片");
    assert.ok(found.images[0].dataUrl, "图片应有 dataUrl");
  });

  test("getRecords 带 dataUrl", async () => {
    await NurseStorage.appendRecord({
      hospital: "H", visitDate: "2026-01-01", manual: true,
      images: [{ dataUrl: "data:image/jpeg;base64,x", name: "i.jpg", type: "image/jpeg" }],
    });
    const list = await NurseStorage.getRecords(true);
    assert.strictEqual(list.length, 1);
    assert.ok(list[0].images[0].dataUrl, "列表应带 dataUrl");
  });

  test("updateRecord 更新图片", async () => {
    const rec = await NurseStorage.appendRecord({
      hospital: "H", visitDate: "2026-01-01", manual: true,
      images: [{ dataUrl: "data:image/jpeg;base64,old", name: "old.jpg", type: "image/jpeg" }],
    });
    await NurseStorage.updateRecord(rec.id, { images: [{ dataUrl: "data:image/jpeg;base64,new", name: "new.jpg", type: "image/jpeg" }] });
    const found = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(found.images.length, 1);
    assert.ok(found.images[0].dataUrl.includes("new"), "图片应更新");
  });

  test("updateRecord 同时更新 rxImages 与 examImages 不互删（回归）", async () => {
    const rec = await NurseStorage.appendRecord({
      hospital: "双图医院", visitDate: "2026-01-01", manual: true,
    });
    await NurseStorage.updateRecord(rec.id, {
      rxImages: [{ dataUrl: "data:image/jpeg;base64,rx1", name: "rx.jpg", type: "image/jpeg" }],
      examImages: [{ dataUrl: "data:image/jpeg;base64,ex1", name: "ex.jpg", type: "image/jpeg" }],
    });
    const found = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(found.rxImages.length, 1, "药单图片应保留，不应被 examImages 分支删除");
    assert.strictEqual(found.examImages.length, 1, "检查图片应保留");
    assert.ok(found.rxImages[0].dataUrl, "药单图片应有 dataUrl");
  });

  test("updateRecord 传入仅有 path 无 dataUrl 的图片不删原文件（回归·AI分析后图片消失）", async () => {
    const rec = await NurseStorage.appendRecord({
      hospital: "路径医院", visitDate: "2026-01-01", manual: true,
      rxImages: [{ dataUrl: "data:image/jpeg;base64,keepRx", name: "rx.jpg", type: "image/jpeg" }],
      examImages: [{ dataUrl: "data:image/jpeg;base64,keepEx", name: "ex.jpg", type: "image/jpeg" }],
    });
    const list = await NurseStorage.getRecords(false);
    const saved = list.find((r) => r.id === rec.id);
    const rxPath = saved.rxImages[0].path;
    const exPath = saved.examImages[0].path;
    const rxImgs = saved.rxImages.map((im) => ({ path: im.path, name: im.name, type: im.type }));
    const exImgs = saved.examImages.map((im) => ({ path: im.path, name: im.name, type: im.type }));
    await NurseStorage.updateRecord(rec.id, { rxImages: rxImgs, examImages: exImgs });
    const after = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(after.rxImages.length, 1, "药单图片不应丢失");
    assert.strictEqual(after.examImages.length, 1, "检查图片不应丢失");
    assert.ok(after.rxImages[0].dataUrl, "药单图片文件应仍存在可读");
    assert.ok(after.examImages[0].dataUrl, "检查图片文件应仍存在可读");
    const afterList = await NurseStorage.getRecords(false);
    const afterRec = afterList.find((r) => r.id === rec.id);
    assert.strictEqual(afterRec.rxImages[0].path, rxPath, "药单图片 path 不变");
    assert.strictEqual(afterRec.examImages[0].path, exPath, "检查图片 path 不变");
  });

  test("updateOrder 传入仅有 path 无 dataUrl 的图片不删原文件（回归）", async () => {
    const o = await NurseStorage.upsertOrder({ source: "药单", date: "2026-01-01", kind: "hospital", medicines: [{ name: "阿司匹林", qty: 1 }] });
    await NurseStorage.updateOrder(o.id, { images: [{ dataUrl: "data:image/jpeg;base64,ord1", name: "o.jpg", type: "image/jpeg" }] });
    const orders = await NurseStorage.getOrders(false);
    const saved = orders.find((x) => x.id === o.id);
    const ordPath = saved.images[0].path;
    await NurseStorage.updateOrder(o.id, { images: saved.images.map((im) => ({ path: im.path, name: im.name, type: im.type })) });
    const after = await NurseStorage.getOrder(o.id);
    assert.strictEqual(after.images.length, 1, "药单图片不应丢失");
    assert.ok(after.images[0].dataUrl, "药单图片文件应仍存在可读");
    const afterOrders = await NurseStorage.getOrders(false);
    const afterOrd = afterOrders.find((x) => x.id === o.id);
    assert.strictEqual(afterOrd.images[0].path, ordPath, "药单图片 path 不变");
  });

  test("deleteRecord 清理图片", async () => {
    const rec = await NurseStorage.appendRecord({
      hospital: "H", visitDate: "2026-01-01", manual: true,
      images: [{ dataUrl: "data:image/jpeg;base64,del", name: "d.jpg", type: "image/jpeg" }],
    });
    await NurseStorage.deleteRecord(rec.id);
    assert.strictEqual(await NurseStorage.getRecord(rec.id), null);
  });

  // ---------------- 记录带 AI result ----------------
  test("appendRecord 带 AI result 并读回", async () => {
    const rec = await NurseStorage.appendRecord({
      hospital: "AI医院", visitDate: "2026-01-01", transcript: "AI分析", manual: true,
      result: {
        engine: "ai",
        diseases: ["高血压"],
        medications: [{ id: "m1", name: "氨氯地平", dose: "5mg", freq: "每日一次", time: "morning", note: "", disease: "高血压" }],
        tasks: [{ id: "t1", type: "life", title: "低盐饮食", detail: "每日盐<5g", freq: "每日", due: "" }],
        advice: { taboo: ["高盐食物"], diet: ["多吃蔬菜"] },
        risks: [{ trigger: "血压>180", level: "red", action: "立即就医", disease: "高血压" }],
        summary: "高血压二期", disclaimer: "仅供参考",
      },
    });
    const found = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(found.result.engine, "ai");
    assert.strictEqual(found.result.diseases[0], "高血压");
    assert.strictEqual(found.result.medications.length, 1);
    assert.strictEqual(found.result.medications[0].name, "氨氯地平");
    assert.strictEqual(found.result.tasks.length, 1);
    assert.strictEqual(found.result.tasks[0].title, "低盐饮食");
    assert.strictEqual(found.result.advice.taboo[0], "高盐食物");
    assert.strictEqual(found.result.advice.diet[0], "多吃蔬菜");
    assert.strictEqual(found.result.risks[0].level, "red");
    assert.strictEqual(found.result.summary, "高血压二期");
  });

  test("appendRecord 带检查结果 result 并读回", async () => {
    const rec = await NurseStorage.appendRecord({
      hospital: "检查医院", visitDate: "2026-01-01", transcript: "检查", manual: true,
      result: {
        advice: "定期复查",
        examResults: [{ name: "血糖", value: "6.5", unit: "mmol/L", range: "3.9-6.1", abnormal: true }],
        prescription: [{ name: "氨氯地平", spec: "5mg", packCount: 2 }],
      },
    });
    const found = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(found.result.advice, "定期复查");
    assert.strictEqual(found.result.examResults.length, 1);
    assert.strictEqual(found.result.examResults[0].abnormal, true);
    assert.strictEqual(found.result.prescription[0].packCount, 2);
  });

  test("updateRecord 更新 result 替换旧数据", async () => {
    const rec = await NurseStorage.appendRecord({
      hospital: "H", visitDate: "2026-01-01", manual: true,
      result: { engine: "ai", diseases: ["高血压"], medications: [{ id: "m1", name: "药A", dose: "", freq: "", time: "", note: "", disease: "" }], tasks: [], advice: { taboo: [], diet: [] }, risks: [], summary: "", disclaimer: "" },
    });
    await NurseStorage.updateRecord(rec.id, {
      result: { engine: "ai", diseases: ["糖尿病"], medications: [{ id: "m2", name: "药B", dose: "", freq: "", time: "", note: "", disease: "" }], tasks: [], advice: { taboo: [], diet: [] }, risks: [], summary: "", disclaimer: "" },
    });
    const found = await NurseStorage.getRecord(rec.id);
    assert.strictEqual(found.result.diseases[0], "糖尿病", "diseases 应替换");
    assert.strictEqual(found.result.medications[0].name, "药B", "medications 应替换");
    assert.strictEqual(found.result.medications.length, 1, "不应残留旧数据");
  });

  // ---------------- 其他设置 ----------------
  test("setLastDecrement 保存和读取", async () => {
    await NurseStorage.setLastDecrement("2026-01-15");
    const data = await NurseStorage.load();
    assert.strictEqual(data.lastDecrement, "2026-01-15");
  });

  test("reminders 设置往返", async () => {
    await NurseStorage.updateSettings({
      reminders: [
        { id: "rem1", title: "吃药提醒", type: "med", time: "08:00", enabled: true },
        { id: "rem2", title: "复查提醒", type: "custom", date: "2026-02-01", time: "09:00", enabled: false },
      ],
    });
    const data = await NurseStorage.load();
    assert.strictEqual(data.settings.reminders.length, 2);
    assert.strictEqual(data.settings.reminders[0].title, "吃药提醒");
    assert.strictEqual(data.settings.reminders[0].enabled, true);
    assert.strictEqual(data.settings.reminders[1].enabled, false);
  });

  // ---------------- 导出导入图片往返 ----------------
  test("导出导入图片往返", async () => {
    await NurseStorage.appendRecord({
      hospital: "往返医院", visitDate: "2026-01-01", transcript: "图片往返", manual: true,
      images: [{ dataUrl: "data:image/jpeg;base64,rt", name: "rt.jpg", type: "image/jpeg" }],
    });
    const json = await NurseStorage.exportJSON();
    await NurseStorage._resetForTest();
    await NurseStorage.importJSON(json);
    const restored = await NurseStorage.getRecords(true);
    assert.strictEqual(restored.length, 1);
    assert.ok(restored[0].images.length > 0, "图片应恢复");
  });

  test("导出导入 AI result 往返", async () => {
    await NurseStorage.appendRecord({
      hospital: "AI往返", visitDate: "2026-01-01", transcript: "AI", manual: true,
      result: { engine: "ai", diseases: ["高血压"], medications: [{ id: "m1", name: "氨氯地平", dose: "5mg", freq: "", time: "", note: "", disease: "高血压" }], tasks: [], advice: { taboo: ["高盐"], diet: [] }, risks: [], summary: "test", disclaimer: "" },
    });
    const json = await NurseStorage.exportJSON();
    await NurseStorage._resetForTest();
    await NurseStorage.importJSON(json);
    const restored = await NurseStorage.getRecords();
    assert.strictEqual(restored.length, 1);
    assert.strictEqual(restored[0].result.engine, "ai");
    assert.strictEqual(restored[0].result.diseases[0], "高血压");
    assert.strictEqual(restored[0].result.medications[0].name, "氨氯地平");
  });

  test("导出导入 AI 聊天往返", async () => {
    const chat = await NurseStorage.newConsultChat();
    chat.title = "导出测试";
    chat.messages.push({ role: "user", content: "问题", ts: new Date().toISOString() });
    chat.messages.push({ role: "assistant", content: "回答", ts: new Date().toISOString() });
    await NurseStorage.saveConsultChat(chat);
    const json = await NurseStorage.exportJSON();
    await NurseStorage._resetForTest();
    await NurseStorage.importJSON(json);
    const restored = await NurseStorage.getConsultChats();
    assert.strictEqual(restored.length, 1);
    assert.strictEqual(restored[0].title, "导出测试");
    assert.strictEqual(restored[0].messages.length, 2);
  });

  test("upsertOrder 已存在药单追加药品同步药箱库存", async () => {
    const o = await NurseStorage.upsertOrder({
      source: "市医院", date: "2026-09-18", kind: "hospital",
      medicines: [{ name: "氨氯地平", qty: 10 }],
    });
    let data = await NurseStorage.load();
    let cabA = data.cabinet.find((c) => c.name === "氨氯地平");
    assert.strictEqual(Number(cabA.qty), 10, "首药品应入库");

    await NurseStorage.upsertOrder({
      id: o.id, source: "市医院", date: "2026-09-18", kind: "hospital",
      medicines: [{ name: "氨氯地平", qty: 10 }, { name: "缬沙坦", qty: 20 }],
    });
    data = await NurseStorage.load();
    cabA = data.cabinet.find((c) => c.name === "氨氯地平");
    const cabB = data.cabinet.find((c) => c.name === "缬沙坦");
    assert.strictEqual(Number(cabA.qty), 10, "首药品库存应保持");
    assert.ok(cabB, "追加药品应入药箱");
    assert.strictEqual(Number(cabB.qty), 20, "追加药品库存应为 20");

    await NurseStorage.upsertOrder({
      id: o.id, source: "市医院", date: "2026-09-18", kind: "hospital",
      medicines: [{ name: "氨氯地平", qty: 15 }, { name: "缬沙坦", qty: 20 }, { name: "美托洛尔", qty: 8 }],
    });
    data = await NurseStorage.load();
    cabA = data.cabinet.find((c) => c.name === "氨氯地平");
    const cabC = data.cabinet.find((c) => c.name === "美托洛尔");
    assert.strictEqual(Number(cabA.qty), 15, "修改数量应按差额同步");
    assert.ok(cabC && Number(cabC.qty) === 8, "再次追加药品应入药箱");
  });
}

module.exports = { registerStorageTests };
