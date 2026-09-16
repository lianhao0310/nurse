const { test } = require("node:test");
const assert = require("node:assert");

const NurseConsult = require("../frontend/consult-ai.js");

test("consult-ai.js: 通用兜底 prompt 存在且非空", () => {
  const prompt = NurseConsult.GENERAL_SKILL_PROMPT;
  assert.ok(prompt && prompt.length > 0, "通用兜底 prompt 应非空");
  assert.ok(prompt.includes("慢性病健康管理"), "应包含慢性病健康管理定位");
  assert.ok(prompt.includes("回复要求"), "应包含回复要求");
  assert.ok(prompt.includes("急危重症"), "应包含急危重症安全边界");
});

test("consult-ai.js: 通用兜底 prompt 不绑定特定病种", () => {
  const prompt = NurseConsult.GENERAL_SKILL_PROMPT;
  assert.ok(!prompt.includes("六经辨证"), "不应包含中医六经辨证");
  assert.ok(!prompt.includes("倪海厦"), "不应包含倪海厦");
  assert.ok(!prompt.includes("经方"), "不应包含经方");
});

test("consult-ai.js: isConfigured 未配置时返回 false", () => {
  assert.strictEqual(NurseConsult.isConfigured({}), false);
  assert.strictEqual(NurseConsult.isConfigured({ ai: {} }), false);
  assert.strictEqual(NurseConsult.isConfigured({ ai: { enabled: true } }), false);
});

test("consult-ai.js: isConfigured 有 API Key 时返回 true", () => {
  assert.strictEqual(
    NurseConsult.isConfigured({ ai: { enabled: true, apiKey: "sk-test" } }),
    true
  );
});

test("consult-ai.js: getConfig 返回正确配置", () => {
  const cfg = NurseConsult.getConfig({ ai: { enabled: true, apiKey: "sk-test", baseUrl: "https://api.example.com/v1/", model: "gpt-4o" } });
  assert.strictEqual(cfg.apiKey, "sk-test");
  assert.strictEqual(cfg.baseUrl, "https://api.example.com/v1");
  assert.strictEqual(cfg.model, "gpt-4o");
});
