// 启动 + 功能冒烟测试：jsdom 加载真实 index.html，验证本轮改动
// （药箱点按直接编辑 / 列表左滑删除 / 检查结果明细 / 单位剂量 / 历史药品弹窗）
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
      manufacturer: "厂家A", alias: "络活喜", qty: 10, unit: "片", status: "active", threshold: 7,
      history: [{ id: "h1", manufacturer: "厂家B", spec: "5mg", alias: "", doseUnit: "片", note: "旧厂" }],
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
    window.confirm = () => true; // 自动确认删除
  },
});

const { window } = dom;
const { document } = window;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
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

  // --- 记录图片字段持久化（不影响现有测试的独立校验）---
  const img1 = { name: "rx.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,AAAA" };
  const img2 = { name: "ex.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,BBBB" };
  const rec2 = await window.NurseStorage.appendRecord({
    source: "text", transcript: "图片测试", hospital: "测试医院",
    advice: { text: "图片测试", audio: null },
    rxImages: [img1], examImages: [img2],
  });
  const loaded2 = await window.NurseStorage.load();
  const lr = loaded2.records.find((x) => x.id === rec2.id);
  assert("记录保存后保留药单图片(rxImages)", lr && lr.rxImages && lr.rxImages.length === 1);
  assert("记录保存后保留报告图片(examImages)", lr && lr.examImages && lr.examImages.length === 1);

  // --- 子页签隔离（需求 #4：检查子页签不显示问诊记录）---
  assert("问诊子页签: 列表可见", $("#records-list") && !$("#records-list").hidden);
  assert("问诊子页签: 检查结果面板隐藏", $("#exam-pane") && $("#exam-pane").hidden);
  click(rtab("exam"));
  assert("检查子页签: 列表隐藏(不再残留问诊记录)", $("#records-list") && $("#records-list").hidden);
  assert("检查子页签: 检查结果面板可见", $("#exam-pane") && !$("#exam-pane").hidden);
  // 关注指标 + 趋势
  const followHtml = ($("#exam-follow") || {}).innerHTML || "";
  assert("检查子页签: 关注指标模块含『血压』", followHtml.includes("血压"));
  const trendHtml = ($("#exam-trend") || {}).innerHTML || "";
  assert("检查子页签: 趋势图含指标与关注按钮", trendHtml.includes("血压") && trendHtml.includes("trend-follow"));
  // 检查结果明细列表（需求 #3 左滑删除对象）
  const examListItems = $$("#exam-list .exam-entry");
  assert("检查子页签: 检查结果明细列表已渲染(2 条)", examListItems.length === 2, "n=" + examListItems.length);
  assert("检查子页签: 明细项含滑动删除按钮", examListItems.length > 0 && !!examListItems[0].querySelector(".swipe-del"));

  click(rtab("list"));
  assert("切回问诊: 列表可见", $("#records-list") && !$("#records-list").hidden);

  // --- 问诊记录列表（需求 #3：左滑删除）---
  const recCard = $(".rec-card");
  assert("问诊记录列表已渲染", !!recCard);
  assert("问诊卡片含滑动删除按钮(data-swipe)", !!recCard.querySelector(".swipe-del") && recCard.hasAttribute("data-swipe"));

  // --- 首页 AI 医嘱（需求 #3：左滑删除）---
  const homeTabBtn = [...document.querySelectorAll(".home-tab")].find((b) => b.dataset.htab === "aidvice");
  click(homeTabBtn);
  const aidv = ($("#home-aidvice") || {}).innerHTML || "";
  assert("AI医嘱页签渲染卡片(市医院)", aidv.includes("市医院") && aidv.includes("aidvice-card"));
  const aidCard = $(".aidvice-card");
  assert("AI医嘱卡片含滑动删除按钮", !!aidCard.querySelector(".swipe-del"));

  // --- 药箱：点按直接打开编辑（需求 #1），不经详情页 ---
  click([...document.querySelectorAll(".tabbar__btn")].find((b) => b.dataset.page === "cabinet"));
  const cabItem = $(".cab-item");
  assert("药箱列表已渲染条目", !!cabItem);
  assert("药品项含滑动删除按钮(data-swipe)", !!cabItem.querySelector(".swipe-del") && cabItem.hasAttribute("data-swipe"));
  click(cabItem);
  const modal = $("#cab-modal");
  assert("点按药品→直接打开编辑弹窗(#1)", modal && !modal.hidden);
  assert("点按药品不再打开详情页(cab-view 仍隐藏)", $("#cab-view") && $("#cab-view").hidden);
  const editHtml = ($("#cab-body") || {}).innerHTML || "";
  assert("编辑表单含『单位剂量』标签(#5)", editHtml.includes("单位剂量"));
  assert("编辑表单不再含『库存单位』(#5)", !editHtml.includes("库存单位"));
  assert("编辑表单含历史药品区", editHtml.includes("历史药品"));

  // --- 历史药品弹窗（需求 #5）---
  click($("#cab-history-add"));
  assert("点击添加历史药品→弹窗出现", $("#hist-modal") && !$("#hist-modal").hidden);
  $("#hist-f-manufacturer").value = "厂家C";
  $("#hist-f-doseunit").value = "10mg";
  click($("#hist-save"));
  assert("保存历史后弹窗关闭", $("#hist-modal") && $("#hist-modal").hidden);
  const chips = $$("#cab-history .cab-history-chip");
  assert("历史 chips 已渲染(原1+新1=2)", chips.length === 2, "n=" + chips.length);

  // --- 关键 Bug：编辑保存不新建重复（且历史含 doseUnit）---
  $("#cab-f-name").value = "氨氯地平X";
  click($("#cab-f-save"));
  await wait(250);
  const after = JSON.parse(store["nurse-data"]);
  assert("保存后药箱条目数仍为 1（无重复）", after.cabinet.length === 1, "count=" + after.cabinet.length);
  assert("保存后名称已更新", after.cabinet[0] && after.cabinet[0].name === "氨氯地平X");
  assert("保存后历史药品含 2 条", after.cabinet[0] && after.cabinet[0].history && after.cabinet[0].history.length === 2, after.cabinet[0] && after.cabinet[0].history && after.cabinet[0].history.length);
  const newHist = after.cabinet[0].history.find((h) => h.manufacturer === "厂家C");
  assert("历史药品已记录『单位剂量』(10mg)", newHist && newHist.doseUnit === "10mg", newHist && newHist.doseUnit);
  assert("历史药品不再含 qty/status/threshold(#5)", newHist && !("qty" in newHist) && !("status" in newHist) && !("threshold" in newHist));

  // --- 滑动删除：药品列表左滑确认后删除（需求 #2）---
  const beforeCount = after.cabinet.length;
  const delItem = $(".cab-item");
  delItem.classList.add("is-swiped");
  const delBtn = delItem.querySelector(".swipe-del");
  click(delBtn);
  await wait(250);
  const afterDel = JSON.parse(store["nurse-data"]);
  assert("左滑删除后药品数 -1", afterDel.cabinet.length === beforeCount - 1, beforeCount + "->" + afterDel.cabinet.length);

  console.log(`\n=== RESULT: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})();
