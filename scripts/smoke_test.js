// 临时冒烟测试：用 jsdom 真实运行前端，验证四项改动关键路径（适配新 UI  redesign）
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("C:/Users/lianh/.workbuddy/binaries/node/workspace/node_modules/jsdom");

const ROOT = "D:/AI/projects/doctor chen/nurse/frontend";
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let html = read("index.html").replace(/<script[\s\S]*?<\/script>/g, ""); // 去掉外链脚本，手动注入

const virtualConsole = new VirtualConsole();
virtualConsole.on("error", (...a) => console.log("  [vc-error]", ...a));
virtualConsole.on("warn", (...a) => console.log("  [vc-warn]", ...a));
virtualConsole.on("jsdomError", (e) => console.log("  [jsdomError]", e.message));

const dom = new JSDOM(html, {
  url: "https://localhost/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
const { document } = window;

// 捕获运行时错误
const errors = [];
window.addEventListener("error", (e) => errors.push("error: " + (e.error && e.error.stack || e.message)));
window.addEventListener("unhandledrejection", (e) => errors.push("unhandledrejection: " + (e.reason && e.reason.stack || e.reason)));

// 注入脚本（顺序：storage -> engine -> ai -> app）
window.eval(read("storage.js"));
window.eval(read("engine.js"));
window.eval(read("ai.js"));

// 复写 AI/Engine 桩，避免真实网络/复杂规则
window.NurseAI = {
  parse: async () => {
    await new Promise((r) => setTimeout(r, 80)); // 模拟网络耗时，让“解析中”态可观察
    return {
      engine: "ai",
      diseases: ["高血压"],
      medications: [{ name: "络活喜", dose: "1片", freq: "每天", time: "08:00", note: "早饭后" }],
      tasks: [{ title: "复查血压", detail: "两周后", type: "revisit" }],
      advice: { taboo: [], diet: [] },
      risks: [],
      summary: "ok",
      disclaimer: "",
    };
  },
};
window.NurseEngine = {
  parse: async (t) => {
    await new Promise((r) => setTimeout(r, 80));
    return {
      engine: "rule",
      diseases: ["测试诊断"],
      medications: [{ name: "测试药", dose: "2片", freq: "每天", time: "09:00", note: "" }],
      tasks: [{ title: "测血糖", detail: "每日", type: "monitor" }],
      advice: { taboo: [], diet: [] },
      risks: [],
      summary: "ok",
      disclaimer: "",
    };
  },
  schedule_reminders: (meds) => (meds || []).map((m) => ({ med: m.name, dose: m.dose, time: m.time || "08:00", note: m.note })),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);

(async () => {
  // 注入 app.js（boot 会立即跑 init）
  window.eval(read("app.js"));
  // 等待 init 完成（renderHome 会把问候语改成含"照顾"）
  for (let i = 0; i < 100 && !/照顾/.test($("#greet-text").textContent || ""); i++) await sleep(20);
  console.log("  [diag] greet-text =", JSON.stringify($("#greet-text").textContent));
  const assert = (cond, msg) => { if (!cond) { errors.push("ASSERT FAIL: " + msg); console.log("  ✗ " + msg); } else console.log("  ✓ " + msg); };

  console.log("[Flow A] 后台解析 -> 解析中 -> 归档 + 同步药箱");
  console.log("  [diag] cap-parse.onclick =", typeof $("#cap-parse").onclick);
  $("#cap-text").value = "医生开了络活喜每天早上一片";
  $("#cap-parse").click();
  let sawParsing = false;
  for (let i = 0; i < 40; i++) {
    if (/解析中/.test($("#records-list").innerHTML)) { sawParsing = true; break; }
    if (i === 1 || i === 6) console.log("  [diag] t=" + i * 10 + "ms:", $("#records-list").innerHTML.replace(/\s+/g, " ").slice(0, 200));
    await sleep(10);
  }
  assert(sawParsing, "提交后出现过「解析中」记录");
  assert($("#capture-modal").hidden === true, "弹窗已收起");
  await sleep(500);
  const recsA = await window.NurseStorage.getRecords();
  console.log("  [diag] records:", recsA.length, recsA.map((r) => r.status));
  assert(recsA.length === 1 && recsA[0].status === "done", "解析完成记录已归档(done)");
  assert(/用药/.test($("#records-list").innerHTML), "列表显示用药计数");
  assert(!/解析中/.test($("#records-list").innerHTML), "解析中徽标已消失");
  const cabAfterA = await window.NurseStorage.getCabinet();
  assert(cabAfterA.some((c) => c.name === "测试药"), "解析用药已同步到药箱(测试药)");

  console.log("[Flow B] 修复：手动记录(result=null) 点击保存修改不崩溃");
  $("#cap-text").value = "手动记录一条";
  $("#cap-save-only").click();
  await sleep(120);
  const cards = document.querySelectorAll(".rec-card");
  const lastCard = cards[cards.length - 1];
  lastCard.click();
  await sleep(60);
  const saveBtn = $("#detail-save");
  assert(!!saveBtn, "手动记录详情有保存按钮");
  if (saveBtn) { saveBtn.click(); await sleep(120); }
  assert(errors.filter((e) => /rec\.result|null is not an object|not an object/.test(e)).length === 0, "保存修改未因 rec.result=null 崩溃");
  // 关闭详情
  const dc = $("#detail-close"); if (dc) dc.click();

  console.log("[Flow C] 我的药箱：添加 / 渲染 / 统计");
  $("#btn-add-cab").click();
  await sleep(40);
  assert(!!$("#cab-f-name"), "添加药品表单已出现");
  $("#cab-f-name").value = "阿司匹林";
  $("#cab-f-qty").value = "10";
  $("#cab-f-unit").value = "片";
  $("#cab-f-daily").value = "1";
  $("#cab-f-threshold").value = "3";
  $("#cab-f-status").value = "active";
  $("#cab-f-save").click();
  await sleep(100);
  document.querySelector('.tabbar__btn[data-page="cabinet"]').click();
  await sleep(60);
  assert(/阿司匹林/.test($("#cabinet-list").innerHTML), "药箱列表渲染出阿司匹林");
  assert(Number($("#cab-active-count").textContent) >= 1, "使用中计数正确");

  console.log("[Flow D] 首页告警（库存不足提醒）");
  // 把阿司匹林阈值调到 > 余量，触发低库存告警
  const item = document.querySelector(".cab-item");
  item.click();
  await sleep(40);
  assert(!!$("#cab-edit-btn"), "药品详情出现编辑按钮");
  $("#cab-edit-btn").click();
  await sleep(40);
  $("#cab-f-threshold").value = "20";
  $("#cab-f-save").click();
  await sleep(120);
  document.querySelector('.tabbar__btn[data-page="home"]').click();
  await sleep(80);
  assert(!$("#home-alerts").hidden, "首页出现药箱告警横幅");
  assert(/阿司匹林/.test($("#home-alerts").innerHTML), "告警提示阿司匹林库存不足");

  console.log("\n==== 运行时错误汇总 ====");
  if (errors.length) { errors.forEach((e) => console.log("  ! " + e)); console.log("RESULT: FAIL (" + errors.length + ")"); }
  else console.log("RESULT: PASS");
})();
