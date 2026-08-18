// 启动 + 功能冒烟测试：jsdom 加载真实 index.html，验证本轮重构（新数据模型）
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("C:/Users/lianh/.workbuddy/binaries/node/workspace/node_modules/jsdom");

const FRONTEND = path.resolve(__dirname, "..", "frontend");
const html = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf-8");

const seed = {
  version: 3,
  cabinet: [
    {
      id: "d1", name: "氨氯地平", disease: "高血压", doseAmount: 1, doseUnit: "片",
      timeSlots: ["morning"], meal: "any", intro: "降压", precautions: [], advice: "", note: "",
      manufacturer: "厂家A", alias: "络活喜", qty: 10, unit: "片", status: "active", dailyDose: 1, threshold: 7,
      history: [{ id: "h1", manufacturer: "厂家B", spec: "5mg", alias: "", qty: 3, unit: "片", status: "disabled", threshold: 5, note: "旧厂" }],
    },
  ],
  records: [
    { id: "r1", hospital: "市医院", visitDate: "2026-08-17", doctor: "王医生", source: "text", transcript: "",
      advice: { text: "按时服药", audio: null }, examImages: [], examTable: [{ name: "血压", value: "120", unit: "mmHg", range: "90-140", abnormal: false }], rxImages: [], rxTable: [{ name: "氨氯地平", spec: "5mg", dose: "1片", freq: "qd", time: "早" }],
      result: null, aiAdvice: { diet: ["低盐"], taboo: ["烟酒"], text: "控盐控油", createdAt: "2026-08-17T08:00:00Z" }, manual: true, status: "done", createdAt: "2026-08-17T08:00:00Z" },
  ],
  examResults: [
    { id: "ex_r1", recordId: "r1", hospital: "市医院", date: "2026-08-17", indicators: [{ name: "血压", value: "120", unit: "mmHg", range: "90-140", abnormal: false }] },
    { id: "ex2", recordId: "r1", hospital: "市医院", date: "2026-08-10", indicators: [{ name: "血压", value: "130", unit: "mmHg", range: "90-140", abnormal: false }] },
  ],
  followedIndicators: ["血压"],
};

const errors = [];
const store = { "nurse-data": JSON.stringify(seed) };
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "file://" + FRONTEND + "/",
  pretendToBeVisual: true,
  beforeParse(window) {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { for (const k in store) delete store[k]; },
        key: (i) => Object.keys(store)[i] || null,
        get length() { return Object.keys(store).length; },
      },
    });
    window.addEventListener("error", (e) => errors.push("window.error: " + (e.error && e.error.stack ? e.error.stack : e.message)));
    const oe = window.console.error;
    window.console.error = (...a) => { errors.push("console.error: " + a.map(String).join(" ")); oe.apply(window.console, a); };
    if (!window.navigator.share) window.navigator.share = () => Promise.resolve();
  },
});

const { window } = dom;
const { document } = window;
const $ = (s) => document.querySelector(s);
const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra ? "  -> " + extra : ""));
  cond ? pass++ : fail++;
  return cond;
}

(async () => {
  await wait(1400);
  console.log("=== init errors:", errors.length, "===");
  errors.slice(0, 10).forEach((e) => console.log("  • " + e.slice(0, 220)));

  const rtab = (name) => [...document.querySelectorAll(".records-subtabs .home-tab")].find((b) => b.dataset.rtab === name);

  // --- 子页签隔离 ---
  assert("问诊子页签: 列表可见", $("#records-list") && !$("#records-list").hidden);
  assert("问诊子页签: 检查结果面板隐藏", $("#exam-pane") && $("#exam-pane").hidden);
  assert("问诊子页签: 新增按钮可见", $("#btn-add-record") && !$("#btn-add-record").hidden);

  click(rtab("exam"));
  assert("检查子页签: 列表隐藏", $("#records-list") && $("#records-list").hidden);
  assert("检查子页签: 检查结果面板可见", $("#exam-pane") && !$("#exam-pane").hidden);
  assert("检查子页签: 新增按钮隐藏", $("#btn-add-record") && $("#btn-add-record").hidden);
  // 关注指标模块 + 趋势
  const followHtml = ($("#exam-follow") || {}).innerHTML || "";
  assert("检查子页签: 关注指标模块含『血压』", followHtml.includes("血压"), followHtml.slice(0, 40).replace(/\n/g, " "));
  const trendHtml = ($("#exam-trend") || {}).innerHTML || "";
  assert("检查子页签: 趋势图含指标与关注按钮", trendHtml.includes("血压") && trendHtml.includes("trend-follow"));

  click(rtab("list"));
  assert("切回问诊: 列表可见", $("#records-list") && !$("#records-list").hidden);
  assert("切回问诊: 新增按钮可见", $("#btn-add-record") && !$("#btn-add-record").hidden);

  // --- 问诊记录返回 ---
  const recCard = $(".rec-card");
  assert("问诊记录列表已渲染", !!recCard);
  click(recCard);
  const recView = $("#record-view");
  assert("点击后问诊详情视图显示", recView && !recView.hidden);
  click($("#record-back"));
  assert("返回后详情视图隐藏", recView && recView.hidden);
  assert("返回后问诊页可见", $("#page-records") && !$("#page-records").hidden);

  // --- 药箱：详情直接展示（厂家/别名/库存/历史） ---
  const cabItem = $(".cab-item");
  assert("药箱列表已渲染条目", !!cabItem);
  click(cabItem);
  const cabView = $("#cab-view");
  const bodyText = ($("#cab-view-body") || {}).innerHTML || "";
  assert("点击后药品详情视图显示", cabView && !cabView.hidden);
  assert("详情含当前厂家(厂家A)", bodyText.includes("厂家A"));
  assert("详情含别名(络活喜)", bodyText.includes("络活喜"));
  assert("详情含历史药品(厂家B)", bodyText.includes("历史药品") && bodyText.includes("厂家B"));
  click($("#cab-view-back"));
  assert("返回后详情视图隐藏", cabView && cabView.hidden);

  // --- 编辑表单：厂家/别名/库存/状态 为直接属性，无多厂家规格表 ---
  click($("#cab-edit-btn"));
  const modal = $("#cab-modal");
  const editHtml = ($("#cab-body") || {}).innerHTML || "";
  assert("编辑弹层显示", modal && !modal.hidden);
  assert("编辑表单含『厂家』字段", editHtml.includes("<span>厂家</span>"));
  assert("编辑表单含『别名』字段", editHtml.includes("别名"));
  assert("编辑表单含『当前库存』字段", editHtml.includes("当前库存"));
  assert("编辑表单含『状态』字段", editHtml.includes("<span>状态</span>"));
  assert("编辑表单不再含『添加规格』(取消多厂家)", !editHtml.includes("添加规格"));
  assert("编辑表单含历史药品区", editHtml.includes("历史药品"));

  // --- 关键 Bug：编辑保存不应新建重复数据 ---
  $("#cab-f-name").value = "氨氯地平X";
  click($("#cab-f-save"));
  await wait(250);
  const after = JSON.parse(store["nurse-data"]);
  assert("保存后药箱条目数仍为 1（无重复）", after.cabinet.length === 1, "count=" + after.cabinet.length);
  assert("保存后名称已更新", after.cabinet[0] && after.cabinet[0].name === "氨氯地平X", after.cabinet[0] && after.cabinet[0].name);
  assert("保存后历史药品保留", after.cabinet[0] && after.cabinet[0].history && after.cabinet[0].history.length === 1);

  // --- 首页 AI 医嘱：每条记录一张卡片（含 createdAt） ---
  const homeTabBtn = [...document.querySelectorAll(".home-tab")].find((b) => b.dataset.htab === "aidvice");
  click(homeTabBtn);
  const aidv = ($("#home-aidvice") || {}).innerHTML || "";
  assert("AI医嘱页签渲染卡片(市医院)", aidv.includes("市医院") && aidv.includes("aidvice-card"));
  assert("AI医嘱卡片含医嘱文字(控盐控油)", aidv.includes("控盐控油"));
  assert("AI医嘱卡片含日期(createdAt)", aidv.includes("2026-08-17"));

  console.log(`\n=== RESULT: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})();
