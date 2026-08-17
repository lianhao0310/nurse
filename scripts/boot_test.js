// 启动 + 功能冒烟测试：jsdom 加载真实 index.html，验证 4 个修复
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
      timeSlots: ["morning"], meal: "any", intro: "", precautions: [], advice: "", note: "",
      variants: [{ id: "v1", manufacturer: "厂家A", spec: "5mg*7片", alias: "", qty: 10, unit: "片", status: "active", dailyDose: 1, threshold: 7 }],
    },
  ],
  records: [
    { id: "r1", hospital: "市医院", visitDate: "2026-08-17", doctor: "王医生", source: "text", transcript: "",
      advice: { text: "按时服药", audio: null }, examImages: [], examTable: [], rxImages: [], rxTable: [],
      result: null, aiAdvice: null, manual: true, status: "done", createdAt: "2026-08-17T08:00:00Z" },
  ],
};

const errors = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "file://" + FRONTEND + "/",
  pretendToBeVisual: true,
  beforeParse(window) {
    const store = { "nurse-data": JSON.stringify(seed) };
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

function assert(name, cond, extra) {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra ? "  -> " + extra : ""));
  return cond;
}

setTimeout(() => {
  console.log("=== init errors:", errors.length, "===");
  errors.slice(0, 10).forEach((e) => console.log("  • " + e.slice(0, 200)));

  // Bug1: 新增按钮在子页签下方（同 .records-bar 内，且在 .records-subtabs 之后）
  const addBtn = $("#btn-add-record");
  const bar = addBtn && addBtn.parentElement;
  const subtabs = $(".records-subtabs");
  const orderOk = bar && bar.classList.contains("records-bar") && subtabs && bar.contains(subtabs) && bar.contains(addBtn) &&
    Array.from(bar.children).indexOf(subtabs) < Array.from(bar.children).indexOf(addBtn);
  assert("Bug1 新增按钮在子页签下方", !!orderOk, addBtn && addBtn.textContent.trim());

  // Bug4: 点击药箱条目 -> #cab-view 显示且内容含厂家；返回后隐藏
  const cabItem = $(".cab-item");
  assert("Bug4 药箱列表已渲染条目", !!cabItem);
  click(cabItem);
  const cabView = $("#cab-view");
  const bodyText = ($("#cab-view-body") || {}).innerHTML || "";
  assert("Bug4 点击后药品详情视图显示", cabView && !cabView.hidden);
  assert("Bug4 详情含厂家变体", bodyText.includes("厂家A"), bodyText.slice(0, 40).replace(/\n/g, " "));
  click($("#cab-view-back"));
  assert("Bug4 返回后详情视图隐藏", cabView && cabView.hidden);
  assert("Bug4 返回后药箱页可见", $("#page-cabinet") && !$("#page-cabinet").hidden);

  // Bug2: 点击问诊记录 -> #record-view 显示
  const recCard = $(".rec-card");
  assert("Bug2 问诊记录列表已渲染", !!recCard);
  click(recCard);
  const recView = $("#record-view");
  assert("Bug2 点击后问诊详情视图显示", recView && !recView.hidden, recView && recView.querySelector("#record-view-title") && recView.querySelector("#record-view-title").textContent);

  // Bug3: 打开药品编辑 -> 规格表单为带标签的清晰布局
  click($("#cab-edit-btn"));
  const modal = $("#cab-modal");
  const editHtml = ($("#cab-body") || {}).innerHTML || "";
  assert("Bug3 编辑弹层显示", modal && !modal.hidden);
  assert("Bug3 规格表单含「厂家/规格/别名/数量」标签", editHtml.includes("<span>厂家</span>") && editHtml.includes("<span>规格</span>") && editHtml.includes("<span>别名</span>") && editHtml.includes("<span>数量</span>"));

  process.exit(0);
}, 1300);
