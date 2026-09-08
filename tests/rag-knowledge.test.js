const { test } = require("node:test");
const assert = require("node:assert");

const NurseRag = require("../frontend/rag-db.js");
const corePrompt = require("../frontend/tcm-skill.js");
const fullPrompt = require("../frontend/tcm-skill-full.js");

test("rag-db.js: buildSystemPrompt 无 chunk 时返回核心规则", () => {
  const result = NurseRag.buildSystemPrompt(corePrompt, []);
  assert.strictEqual(result, corePrompt);
});

test("rag-db.js: buildSystemPrompt 无 chunk 参数时返回核心规则", () => {
  const result = NurseRag.buildSystemPrompt(corePrompt, null);
  assert.strictEqual(result, corePrompt);
});

test("rag-db.js: buildSystemPrompt 拼接核心规则 + 检索片段", () => {
  const chunks = [
    { sourceType: "tcm", sourcePath: "nihaixia/SKILL.md", text: "太阳病：脉浮+恶寒" },
    { sourceType: "disease", sourcePath: "engine.js/DISEASE_KB", text: "病种: 高血压" },
  ];
  const result = NurseRag.buildSystemPrompt(corePrompt, chunks);
  assert.ok(result.includes(corePrompt), "应包含核心规则");
  assert.ok(result.includes("【相关知识】"), "应包含相关知识标题");
  assert.ok(result.includes("[1] (来源: nihaixia/SKILL.md) 太阳病"), "应包含第1条片段");
  assert.ok(result.includes("[2] (来源: engine.js/DISEASE_KB) 病种: 高血压"), "应包含第2条片段");
});

test("rag-db.js: EMBEDDING_DIM 为 512", () => {
  assert.strictEqual(NurseRag.EMBEDDING_DIM, 512);
});

test("rag-db.js: isReady 初始为 false", async () => {
  const ready = await NurseRag.isReady();
  assert.strictEqual(ready, false);
});

test("tcm-skill.js: 精简 prompt 存在且非空", () => {
  assert.ok(corePrompt && corePrompt.length > 0, "精简 prompt 应非空");
  assert.ok(corePrompt.includes("六经辨证"), "应包含六经辨证");
  assert.ok(corePrompt.includes("倪氏六健康标准"), "应包含倪氏六健康标准");
  assert.ok(corePrompt.includes("回复要求"), "应包含回复要求");
});

test("tcm-skill-full.js: 完整 prompt 存在且比精简版长", () => {
  assert.ok(fullPrompt && fullPrompt.length > 0, "完整 prompt 应非空");
  assert.ok(fullPrompt.length > corePrompt.length, "完整 prompt 应比精简版长");
  assert.ok(fullPrompt.includes("感冒六大经方"), "完整版应包含感冒六大经方");
  assert.ok(fullPrompt.includes("脉诊速查"), "完整版应包含脉诊速查");
  assert.ok(fullPrompt.includes("临床心法"), "完整版应包含临床心法");
});

test("tcm-skill.js: 精简版去除了细节知识", () => {
  assert.ok(!corePrompt.includes("感冒六大经方"), "精简版不应包含感冒六大经方详细");
  assert.ok(!corePrompt.includes("脉诊速查"), "精简版不应包含脉诊速查");
  assert.ok(!corePrompt.includes("七步走辨证"), "精简版不应包含七步走辨证");
});
