/*
 * 医嘱解析引擎测试（重点功能：本地规则解析）
 * 运行：node --test tests/engine.test.js
 */
const { test } = require("node:test");
const assert = require("node:assert");
const NurseEngine = require("../frontend/engine.js");
const { parse, detect_diseases, extract_medications } = NurseEngine;

test("parse 返回标准结构", () => {
  const r = parse("高血压，开苯磺酸氨氯地平片");
  assert.strictEqual(typeof r, "object");
  assert.ok(Array.isArray(r.diseases));
  assert.ok(Array.isArray(r.medications));
  assert.ok(Array.isArray(r.tasks));
  assert.ok(r.advice && Array.isArray(r.advice.taboo) && Array.isArray(r.advice.diet));
  assert.ok(Array.isArray(r.risks));
  assert.ok(Array.isArray(r.reminders));
  assert.ok(typeof r.disclaimer === "string" && r.disclaimer.length > 0);
});

test("识别高血压病种", () => {
  const r = parse("患者高血压，血压150/95，开苯磺酸氨氯地平片每日一片");
  assert.ok(r.diseases.includes("高血压"), "应识别高血压");
});

test("识别2型糖尿病病种", () => {
  const r = parse("2型糖尿病，空腹血糖8.5，开二甲双胍缓释片");
  assert.ok(r.diseases.includes("2型糖尿病"), "应识别2型糖尿病");
});

test("多病种同时识别", () => {
  const r = parse("高血压2型糖尿病，开苯磺酸氨氯地平片和二甲双胍缓释片");
  assert.ok(r.diseases.includes("高血压"));
  assert.ok(r.diseases.includes("2型糖尿病"));
});

test("提取处方药（含别名归一）", () => {
  const r = parse("高血压，开络活喜每日一片，拜糖平餐前一片");
  const names = r.medications.map((m) => m.name);
  assert.ok(names.includes("苯磺酸氨氯地平片"), "络活喜应归一为苯磺酸氨氯地平片");
  assert.ok(names.includes("阿卡波糖片"), "拜糖平应归一为阿卡波糖片");
});

test("生成饮食禁忌与建议", () => {
  const r = parse("高血压，开苯磺酸氨氯地平片");
  assert.ok(r.advice.taboo.length > 0, "高血压应有饮食禁忌");
  assert.ok(r.advice.diet.length > 0, "高血压应有饮食建议");
});

test("生成风险预警", () => {
  const r = parse("高血压，血压180/120，头痛胸闷");
  assert.ok(r.risks.length > 0, "应有风险预警");
});

test("空文本不报错", () => {
  const r = parse("");
  assert.ok(Array.isArray(r.diseases) && r.diseases.length === 0);
  assert.ok(Array.isArray(r.medications));
});

test("detect_diseases 返回原始数组结构", () => {
  const ds = detect_diseases("高血压");
  assert.ok(Array.isArray(ds));
  assert.ok(ds.length >= 1);
});

test("extract_medications 依赖病种上下文", () => {
  const meds = extract_medications("开苯磺酸氨氯地平片", detect_diseases("高血压"));
  assert.ok(meds.length >= 1);
  assert.strictEqual(meds[0].name, "苯磺酸氨氯地平片");
});
