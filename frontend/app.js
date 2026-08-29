/*
 * Nurse · 前端交互逻辑（v3 · 药单/检查报告架构）
 * 四页 Tab：首页 / 问诊记录 / 我的药箱 / 我的
 * 药箱页 =「药箱（按药名合并汇总只读）+ 药单（自建/医院药单）」
 * 首页用药提醒 = 汇总所有药单在用药品
 * 检查结果 = 检查报告（自测/医院）实体 + 关注指标管理 + 左右滑动趋势
 * 问诊记录 = 关联药单/检查报告，不再内嵌表格，取消归档
 */
(function () {
  "use strict";

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  let DATA = null;
  let TODAY = dateKey(new Date());

  const cabinetState = { filter: "all" };
  let homeTab = "remind";
  let homeExpandedSlots = new Set([currentSlot()]);
  let recDraft = null; // 编辑问诊记录时的草稿
  let currentRecordId = null;
  let aiModalState = null; // { rec, data, type }
  let followEditing = null; // 关注指标编辑态：正在编辑的指标名

  // 药单 / 药品条目 / 检查报告 / 关注指标 编辑态
  let editingOrderId = null;      // order-modal 当前编辑的药单
  let orderDraft = null;          // { source, date, medicines:[] }
  let editingMedIdx = -1;         // med-item-modal 编辑的药品条目下标
  let editingReportId = null;     // report-modal 当前编辑的报告
  let reportDraft = null;         // { title, date, indicators:[] }

  // ===================== 工具 =====================
  function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms || 2400);
  }
  window.addEventListener("error", (e) => {
    console.error("[nurse] error:", e.error || e);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[nurse] unhandledrejection:", e.reason);
  });

  const SLOT_DEFS = [
    { key: "morning", label: "🌅 早上", short: "早上", time: "08:00" },
    { key: "noon", label: "☀️ 中午", short: "中午", time: "12:30" },
    { key: "evening", label: "🌙 晚上", short: "晚上", time: "19:00" },
  ];
  function currentSlot() {
    const h = new Date().getHours();
    if (h < 11) return "morning";
    if (h < 16) return "noon";
    return "evening";
  }
  function slotTime(key) {
    const t = (DATA.settings && DATA.settings.reminderTimes) || {};
    if (t[key] && /^\d{1,2}:\d{2}$/.test(t[key])) return t[key];
    return (SLOT_DEFS.find((s) => s.key === key) || {}).time || "12:00";
  }
  function mealLabel(m) {
    return m === "before" ? "餐前" : m === "after" ? "餐后" : "不限餐";
  }
  function slotLabels(keys) {
    const map = { morning: "早", noon: "中", evening: "晚" };
    return (keys || []).map((k) => map[k] || k).join("/");
  }

  // ===================== 数据聚合工具 =====================
  // 汇总所有药单在用药品（首页用药提醒数据源）
  // 在用药品（数据源=药箱 cabinet 主档）
  function activeMedicines() {
    return (DATA.cabinet || []).filter((m) => m.status !== "disabled" && m.status !== "out");
  }

  // ===================== 初始化 =====================
  async function init() {
    DATA = await NurseStorage.load();
    DATA.records = DATA.records || [];
    DATA.orders = DATA.orders || [];
    DATA.reports = DATA.reports || [];
    DATA.followedIndicators = DATA.followedIndicators || [];
    applySettingsUI();
    bindEvents();
    setupSwipeBack();
    setupModalSwipeDown();
    await runDailyDecrement();
    renderHome();
    renderRecords();
    renderCabinet();
    setHeader("Nurse", "");
  }

  function setHeader(title, sub) {
    const t = $("#header-title");
    const s = $("#header-sub");
    if (t) t.textContent = title;
    if (s) s.textContent = sub || "";
  }

  function applySettingsUI() {
    const s = DATA.settings;
    $("#ai-enabled").checked = !!s.ai.enabled;
    $("#ai-baseurl").value = s.ai.baseUrl || "https://api.openai.com/v1";
    $("#ai-model").value = s.ai.model || "gpt-4o";
    $("#ai-key").value = s.ai.apiKey || "";
    $("#ai-fields").hidden = !s.ai.enabled;
    $("#opt-notify").checked = !!s.notifications;
    $("#opt-large").checked = !!s.largeFont;
    document.body.classList.toggle("large-font", !!s.largeFont);
    renderAISummary();
    renderRemindersList();
    renderFollowListMe();
  }

  // ===================== 页面路由 =====================
  function goPage(page) {
    $$(".page").forEach((p) => (p.hidden = p.id !== "page-" + page));
    $$(".tabbar__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.page === page));
    $$(".view").forEach((v) => (v.hidden = true));
    if (page === "home") {
      setHeader("Nurse", "");
      applyHomeTab();
      renderHome();
    } else if (page === "records") {
      setHeader("问诊记录", "");
      renderRecords();
    } else if (page === "cabinet") {
      setHeader("我的药箱", "");
      renderCabinet();
    } else if (page === "me") {
      setHeader("我的", "");
    }
  }

  // ===================== 首页 =====================
  async function renderHome() {
    const now = new Date();
    TODAY = dateKey(now);
    const h = now.getHours();
    const greet = h < 6 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
    $("#greet-text").textContent = greet + "，今天也要好好照顾自己";
    $("#today-date").textContent = fmtDate(now).slice(0, 10) + " " + ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];

    const done = await NurseStorage.getDone(TODAY);
    renderHomeAlerts();
    renderMedBlocks(done);
    renderPersonalReminders();
    renderAISummaryHome();
    scheduleNotifications(done);
  }

  // 药箱告警（缺药 / 库存不足）——基于药单汇总
  function renderHomeAlerts() {
    const box = $("#home-alerts");
    if (!box) return;
    const items = [];
    for (const m of activeMedicines()) {
      if (m.status === "out" || (m.threshold > 0 && Number(m.qty) <= Number(m.threshold))) {
        items.push({
          out: m.status === "out",
          text: "💊 " + m.name + (m.manufacturer ? "（" + m.manufacturer + "）" : "") + (m.status === "out" ? "：已缺药" : "：库存不足（剩 " + m.qty + " " + (m.unit || "片") + "）"),
        });
      }
    }
    if (!items.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.innerHTML = items.map((i) => `<div class="alerts__item ${i.out ? "is-out" : "is-low"}">${esc(i.text)}，请及时补充。</div>`).join("");
    box.hidden = false;
  }

  // 用药提醒：按 早/中/晚 分组，各时段可独立点击展开/收起（数据源=所有药单在用药品）
  function renderMedBlocks(done) {
    const box = $("#home-meds-blocks");
    if (!box) return;
    const drugs = activeMedicines();
    let total = 0;
    const html = SLOT_DEFS.map((slot) => {
      const inSlot = drugs.filter((d) => (d.timeSlots || []).includes(slot.key));
      const expanded = homeExpandedSlots.has(slot.key);
      const count = inSlot.length;
      total += count;
      const head = `<div class="med-block__head ${expanded ? "is-open" : ""}" data-slot="${slot.key}">
        <span>${slot.label}<span class="med-block__time">${esc(slotTime(slot.key))}</span></span>
        <span class="med-block__count">${expanded ? "收起 ▴" : count + " 项 ▾"}</span>
      </div>`;
      if (!expanded) return `<div class="med-block">${head}</div>`;
      if (!count) {
        return `<div class="med-block">${head}<div class="med-block__body empty-tip">该时段暂无用药</div></div>`;
      }
      const rows = inSlot
        .map((d) => {
          const key = d.id + "@" + slot.key;
          const isDone = !!done.medDoses[key];
          return `<div class="med ${isDone ? "done" : ""}" data-med-id="${esc(d.id)}" data-slot="${slot.key}">
            <div class="med__check">${isDone ? "✓" : ""}</div>
            <div class="med__main">
              <div class="med__name">${esc(d.name)}</div>
              <div class="med__meta">${esc(d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "")}${d.meal !== "any" ? " · " + mealLabel(d.meal) : ""}${d.spec ? " · " + esc(d.spec) : ""} · 余 ${esc(Number(d.qty) || 0)}${d.unit ? " " + d.unit : ""}</div>
            </div>
          </div>`;
        })
        .join("");
      return `<div class="med-block">${head}<div class="med-block__body">${rows}</div></div>`;
    }).join("");
    box.innerHTML = html;
    $("#home-meds-count").textContent = total + " 项";
  }

  // 个人提醒（来自 settings.reminders）
  function renderPersonalReminders() {
    const box = $("#home-reminders");
    if (!box) return;
    const rems = (DATA.settings.reminders || []).filter((r) => r.enabled && r.date);
    if (!rems.length) {
      box.innerHTML = '<div class="empty-tip">还没有个人提醒。去「我的 → 提醒设置」添加就诊、复诊、复查等。</div>';
      $("#home-reminders-count").textContent = "";
      return;
    }
    const today = new Date(TODAY + "T00:00:00");
    box.innerHTML = rems
      .map((r) => {
        const d = new Date(r.date + "T00:00:00");
        const diff = Math.round((d - today) / (24 * 3600 * 1000));
        const left = diff < 0 ? `已逾期 ${Math.abs(diff)} 天` : diff === 0 ? "就是今天" : `还有 ${diff} 天`;
        return `<div class="reminder-item">
          <div class="reminder-item__icon">${r.type === "visit" ? "🏥" : "📌"}</div>
          <div class="reminder-item__main">
            <div class="reminder-item__title">${esc(r.title)}</div>
            <div class="reminder-item__meta">${esc(r.date)}${r.time ? " " + esc(r.time) : ""}</div>
          </div>
          <div class="reminder-item__left">${left}</div>
        </div>`;
      })
      .join("");
    $("#home-reminders-count").textContent = rems.length + " 项";
  }

  // 首页 AI 医嘱页签
  function renderAISummaryHome() {
    const box = $("#home-aidvice");
    if (!box) return;
    const advices = (DATA.records || [])
      .filter((r) => r.aiAdvice && ((r.aiAdvice.diet && r.aiAdvice.diet.length) || (r.aiAdvice.taboo && r.aiAdvice.taboo.length) || r.aiAdvice.text))
      .map((r) => ({ rec: r, a: r.aiAdvice }));
    if (!advices.length) {
      box.innerHTML = '<div class="empty-tip">还没有 AI 医嘱建议。在「问诊记录」详情中做「医嘱分析」后，这里会按每次问诊生成一条生活 / 饮食医嘱。</div>';
      return;
    }
    box.innerHTML = advices
      .map(({ rec, a }) => {
        const head = (rec.hospital || "问诊记录") + (rec.visitDate ? " · " + rec.visitDate : "");
        const tags = []
          .concat((a.diet || []).map((x) => `<span class="tag">${esc(x)}</span>`))
          .concat((a.taboo || []).map((x) => `<span class="tag tag--bad">${esc(x)}</span>`))
          .join("");
        return `<div class="aidvice-card swipe-item" data-rec-id="${esc(rec.id)}" data-swipe>
          <div class="swipe-content">
            <div class="aidvice-card__head"><b>${esc(head)}</b>${a.createdAt ? `<span class="aidvice-card__date">${esc(a.createdAt.slice(0, 10))}</span>` : ""}</div>
            ${a.text ? `<div class="aidvice-card__summary">${esc(a.text)}</div>` : ""}
            ${tags ? `<div class="aidvice-card__tags">${tags}</div>` : ""}
          </div>
          <button class="swipe-del" data-swipe-del>删除</button>
        </div>`;
      })
      .join("");
  }

  async function toggleMed(id, slot) {
    const key = id + "@" + slot;
    const done = await NurseStorage.getDone(TODAY);
    const nowDone = !done.medDoses[key];
    await NurseStorage.setDone(TODAY, "medDoses", key, nowDone);
    await renderHome();
  }

  // 用药提醒通知（数据源=所有药单在用药品）
  // 优先使用 Capacitor Local Notifications（iOS 原生，app 关闭后也能提醒）；
  // 降级到浏览器 Notification + setTimeout（仅开发调试用）
  let notifTimers = [];
  let _notifIds = [];
  function getLocalNotif() {
    if (typeof Capacitor !== "undefined" && Capacitor.Plugins && Capacitor.Plugins.LocalNotifications) {
      return Capacitor.Plugins.LocalNotifications;
    }
    return null;
  }
  function clearNotifTimers() {
    notifTimers.forEach((t) => clearTimeout(t));
    notifTimers = [];
  }
  async function clearNotifScheduled() {
    const LN = getLocalNotif();
    if (LN && _notifIds.length) {
      try { await LN.cancel({ notifications: _notifIds.map((id) => ({ id })) }); } catch (e) {}
    }
    _notifIds = [];
  }
  async function scheduleNotifications(done) {
    clearNotifTimers();
    await clearNotifScheduled();
    if (!DATA.settings.notifications) return;
    const meds = activeMedicines();
    const LN = getLocalNotif();
    if (LN) {
      const notifs = [];
      let id = 1;
      for (const d of meds) {
        for (const slot of d.timeSlots || []) {
          const key = d.id + "@" + slot;
          if (done.medDoses[key]) continue;
          const [hh, mm] = slotTime(slot).split(":").map(Number);
          const at = new Date();
          at.setHours(hh, mm, 0, 0);
          if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
          const dose = d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "";
          notifs.push({
            id: id++,
            title: "Nurse · 用药提醒",
            body: (dose ? dose + " " : "") + d.name,
            schedule: { at, every: "day" },
          });
        }
      }
      _notifIds = notifs.map((n) => n.id);
      if (notifs.length) { try { await LN.schedule({ notifications: notifs }); } catch (e) {} }
      return;
    }
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const now = Date.now();
    for (const d of meds) {
      for (const slot of d.timeSlots || []) {
        const key = d.id + "@" + slot;
        if (done.medDoses[key]) continue;
        const [hh, mm] = slotTime(slot).split(":").map(Number);
        const t = new Date();
        t.setHours(hh, mm, 0, 0);
        let diff = t.getTime() - now;
        if (diff < 0) diff += 24 * 3600 * 1000;
        if (diff > 12 * 3600 * 1000) continue;
        const dose = d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "";
        notifTimers.push(
          setTimeout(() => {
            try { new Notification("Nurse · 用药提醒", { body: (dose ? dose + " " : "") + d.name }); } catch (e) {}
          }, diff)
        );
      }
    }
  }
  async function notifyNow(times) {
    const LN = getLocalNotif();
    if (LN) {
      try {
        await LN.schedule({
          notifications: [{
            id: 99999,
            title: "Nurse · 用药提醒已开启",
            body: "将每天按时提醒您用药：早 " + times.morning + " · 中 " + times.noon + " · 晚 " + times.evening,
            schedule: { at: new Date(Date.now() + 1000) },
          }],
        });
      } catch (e) {}
      return;
    }
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Nurse · 用药提醒已开启", {
          body: "将每天按时提醒您用药：早 " + times.morning + " · 中 " + times.noon + " · 晚 " + times.evening,
        });
      }
    } catch (e) {}
  }

  // ===================== 问诊记录 =====================
  function renderRecords() {
    const list = $("#records-list");
    const empty = $("#records-empty");
    const examEmpty = $("#exam-empty");
    if (!DATA.records.length) {
      list.innerHTML = "";
      empty.hidden = false;
    } else {
      empty.hidden = true;
      list.innerHTML = DATA.records
        .map((rec) => {
          const summary = rec.advice && rec.advice.text ? rec.advice.text : rec.result && rec.result.summary ? rec.result.summary : rec.transcript || "（无医嘱文字）";
          const title = (rec.hospital || "未填医院") + (rec.visitDate ? " · " + rec.visitDate : "");
          return `<div class="rec-card swipe-item" data-rec-id="${esc(rec.id)}" data-swipe>
            <div class="swipe-content">
              <div class="rec-card__top">
                <span class="rec-card__date">${esc(title)}</span>
              </div>
              <div class="rec-card__summary">👨‍⚕️ ${esc((rec.doctor || "未知医生") + "：" + summary)}</div>
            </div>
            <button class="swipe-del" data-swipe-del>删除</button>
          </div>`;
        })
        .join("");
    }

    // 检查结果子页签
    renderExamTrend($("#exam-trend"));
    renderExamList($("#exam-list"));
    examEmpty.hidden = (DATA.reports || []).length > 0;
    applyRecordsTab();
  }

  function applyRecordsTab() {
    const active = document.querySelector(".records-subtabs .home-tab.is-active");
    const isExam = !!(active && active.dataset.rtab === "exam");
    $("#records-list").hidden = isExam;
    $("#exam-pane").hidden = !isExam;
    $("#btn-add-record").hidden = isExam;
    const empty = $("#records-empty");
    if (empty) empty.hidden = isExam || (DATA.records || []).length > 0;
  }

  function openRecord(id) {
    currentRecordId = id || null;
    const rec = id ? (DATA.records || []).find((r) => r.id === id) : null;
    showRecordView(rec);
  }

  function showRecordView(rec) {
    recDraft = null;
    $$(".view").forEach((v) => (v.hidden = true));
    $$(".page").forEach((p) => (p.hidden = true));
    const view = $("#record-view");
    view.hidden = false;
    const isNew = !rec;
    $("#record-view-title").textContent = isNew ? "新增问诊记录" : "问诊记录";
    $("#record-view-sub").textContent = isNew ? "" : rec.hospital || "";
    $("#record-body").innerHTML = renderRecordEdit(rec);
    bindRecordEdit(rec);
  }

  // 关联药单/报告 摘要渲染（与药箱/检查明细卡片同构：点击进编辑，左滑删除）
  function renderRelatedOrder(rec) {
    if (!rec || !rec.orderId) return "";
    const o = (DATA.orders || []).find((x) => x.id === rec.orderId);
    if (!o) return "";
    const count = (o.medicines || []).length;
    const kindTag = o.kind === "hospital" ? `<span class="order-tag">医院</span>` : `<span class="order-tag order-tag--self">自建</span>`;
    return `<div class="order-card swipe-item" data-rel="order" data-id="${esc(o.id)}" data-swipe>
      <div class="swipe-content">
        <div class="order-card__head">
          <div class="order-card__title"><b>${esc(o.source || "未填来源")}</b>${kindTag}${o.aiGenerated ? '<span class="ai-badge">AI</span>' : ''}</div>
          <span class="order-card__date">${esc(o.date || "无日期")}</span>
        </div>
        <div class="order-card__meta">共 ${count} 种药品</div>
        ${count ? `<div class="order-card__meds">${o.medicines.slice(0, 3).map((m) => `<span class="order-chip">${esc(m.name)}</span>`).join("")}${count > 3 ? `<span class="order-chip">+${count - 3}</span>` : ""}</div>` : ""}
      </div>
      <button class="swipe-del" data-swipe-del>删除</button>
    </div>`;
  }
  function renderRelatedReport(rec) {
    if (!rec || !rec.reportId) return "";
    const rp = (DATA.reports || []).find((x) => x.id === rec.reportId);
    if (!rp) return "";
    return `<div class="exam-entry swipe-item" data-rel="report" data-id="${esc(rp.id)}" data-swipe>
      <div class="swipe-content">
        <div class="exam-entry__head"><b>${esc(rp.date || "")}</b>${rp.title ? " · " + esc(rp.title) : ""}<span class="exam-entry__tag">${rp.kind === "self" ? "自测" : "医院"}</span>${rp.aiGenerated ? '<span class="ai-badge">AI</span>' : ''}</div>
        <div class="exam-entry__inds">${(rp.indicators || []).map((i) => `<span class="exam-chip ${i.abnormal ? "is-bad" : ""}">${esc(i.name)} ${esc(i.value)}${esc(i.unit || "")}</span>`).join("")}</div>
      </div>
      <button class="swipe-del" data-swipe-del>删除</button>
    </div>`;
  }

  // ---- 编辑表单（即问诊详情：直接可编辑） ----
  function renderRecordEdit(rec) {
    const linkedOrder = rec && rec.orderId ? (DATA.orders || []).find((o) => o.id === rec.orderId) : null;
    const linkedReport = rec && rec.reportId ? (DATA.reports || []).find((rp) => rp.id === rec.reportId) : null;
    recDraft = {
      adviceText: (rec && rec.advice && rec.advice.text) || "",
      audio: (rec && rec.advice && rec.advice.audio) || null,
      orderImages: (rec && rec.rxImages && rec.rxImages.length) ? rec.rxImages.slice() : (linkedOrder ? (linkedOrder.images || []).slice() : []),
      reportImages: (rec && rec.examImages && rec.examImages.length) ? rec.examImages.slice() : (linkedReport ? (linkedReport.images || []).slice() : []),
    };
    const r = rec || {};
    const aiOn = DATA.settings.ai.enabled && DATA.settings.ai.apiKey;
    return `
      <div class="rec-edit">
        <div class="field"><span>医院</span><input type="text" id="rec-f-hospital" value="${esc(r.hospital || "")}" placeholder="如 市第一人民医院" /></div>
        <div class="field"><span>就诊日期</span><input type="date" id="rec-f-date" value="${esc(r.visitDate || TODAY)}" /></div>
        <div class="field"><span>医生</span><input type="text" id="rec-f-doctor" value="${esc(r.doctor || "")}" placeholder="接诊医生" /></div>

        <div class="detail-sec"><h3>📝 医嘱</h3>
          <div class="textarea-wrap">
            <textarea id="rec-f-advice" rows="4" placeholder="本次医生医嘱 / 录音转写文字">${esc(recDraft.adviceText)}</textarea>
          </div>
          <div class="rec-edit__row">
            <button type="button" class="btn btn-ghost btn-compact" id="rec-mic">🎙录音</button>
            <button type="button" class="btn btn-ghost btn-compact" id="rec-audio-file">📁上传</button>
            <input type="file" id="rec-audio-input" accept="audio/*" hidden />
            ${aiOn ? `<button type="button" class="btn btn-ghost btn-compact ai-sec-btn" id="rec-ai-advice" disabled>🤖分析</button>` : ""}
          </div>
          <div id="rec-audio-preview"></div>
        </div>

        <div class="detail-sec"><h3>💊 药单</h3>
          <div id="rec-order-link">${renderRelatedOrder(rec)}</div>
          <div class="rec-edit__row">
            ${!(rec && rec.orderId) ? `<button type="button" class="btn btn-ghost btn-compact" id="rec-order-add">＋药单</button>` : ""}
            <button type="button" class="btn btn-ghost btn-compact" id="rec-order-img">📷拍照</button>
            <button type="button" class="btn btn-ghost btn-compact" id="rec-order-copy">📋复制</button>
            <input type="file" id="rec-order-img-input" accept="image/*" multiple hidden />
            ${aiOn ? `<button type="button" class="btn btn-ghost btn-compact ai-sec-btn" id="rec-ai-order" disabled>🤖分析</button>` : ""}
          </div>
          <div id="rec-order-thumbs" class="thumb-grid"></div>
        </div>

        <div class="detail-sec"><h3>🧪 检查报告</h3>
          <div id="rec-report-link">${renderRelatedReport(rec)}</div>
          <div class="rec-edit__row">
            ${!(rec && rec.reportId) ? `<button type="button" class="btn btn-ghost btn-compact" id="rec-report-add">＋报告</button>` : ""}
            <button type="button" class="btn btn-ghost btn-compact" id="rec-report-img">📷拍照</button>
            <button type="button" class="btn btn-ghost btn-compact" id="rec-report-copy">📋复制</button>
            <input type="file" id="rec-report-img-input" accept="image/*" multiple hidden />
            ${aiOn ? `<button type="button" class="btn btn-ghost btn-compact ai-sec-btn" id="rec-ai-report" disabled>🤖分析</button>` : ""}
          </div>
          <div id="rec-report-thumbs" class="thumb-grid"></div>
        </div>

        <div class="detail-actions">
          ${aiOn ? `<button class="btn btn-ghost block" id="rec-advice-analyze">💡 医嘱分析</button>` : ""}
          <div class="rec-autosave-hint">修改自动保存 · 右滑返回</div>
        </div>
      </div>`;
  }

  function openLightbox(src) {
    $("#img-lightbox-img").src = src;
    $("#img-lightbox").hidden = false;
  }
  function closeLightbox() {
    $("#img-lightbox").hidden = true;
    $("#img-lightbox-img").src = "";
  }
  let _recAutoSaveTimer = null;
  let _recAutoSaveDirty = false;
  let _editingRec = null;
  let _recAutoSaveTrigger = null;
  let _updateAIBtnStates = null;
  function renderDraftThumbs() {
    $("#rec-order-thumbs").innerHTML = recDraft.orderImages.map((im, i) => `<div class="thumb"><img src="${im.dataUrl}"/><button class="thumb__del" data-kind="order" data-idx="${i}">✕</button></div>`).join("");
    $("#rec-report-thumbs").innerHTML = recDraft.reportImages.map((im, i) => `<div class="thumb"><img src="${im.dataUrl}"/><button class="thumb__del" data-kind="report" data-idx="${i}">✕</button></div>`).join("");
    $$("#rec-order-thumbs .thumb__del").forEach((b) => (b.onclick = () => { recDraft.orderImages.splice(+b.dataset.idx, 1); renderDraftThumbs(); }));
    $$("#rec-report-thumbs .thumb__del").forEach((b) => (b.onclick = () => { recDraft.reportImages.splice(+b.dataset.idx, 1); renderDraftThumbs(); }));
    $$("#rec-order-thumbs .thumb img, #rec-report-thumbs .thumb img").forEach((img) => (img.onclick = () => openLightbox(img.src)));
    const ap = $("#rec-audio-preview");
    if (ap) ap.innerHTML = recDraft.audio ? `<div class="audio-card">🎵 ${esc(recDraft.audio.name)} <button class="thumb__del" id="rec-audio-del">✕</button><br/><audio controls src="${recDraft.audio.dataUrl}" style="width:100%"></audio></div>` : "";
    const adel = $("#rec-audio-del");
    if (adel) adel.onclick = () => { recDraft.audio = null; renderDraftThumbs(); };
    if (_recAutoSaveTrigger) _recAutoSaveTrigger();
    if (_updateAIBtnStates) _updateAIBtnStates();
  }

  function bindRecordEdit(rec) {
    renderDraftThumbs();
    $("#rec-f-advice").oninput = (e) => (recDraft.adviceText = e.target.value);
    $("#rec-mic").onclick = startRecMic;
    $("#rec-audio-file").onclick = () => $("#rec-audio-input").click();
    $("#rec-audio-input").onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) readFileAsDataURL(f).then((d) => { recDraft.audio = { name: f.name, type: f.type || "audio/mpeg", dataUrl: d }; renderDraftThumbs(); });
      e.target.value = "";
    };
    $("#rec-order-img").onclick = () => $("#rec-order-img-input").click();
    $("#rec-order-img-input").onchange = (e) => { const fs = NurseImgUpload.snapshotAndReset(e.target); if (fs.length) addImagesToDraft(fs, "order"); };
    $("#rec-report-img").onclick = () => $("#rec-report-img-input").click();
    $("#rec-report-img-input").onchange = (e) => { const fs = NurseImgUpload.snapshotAndReset(e.target); if (fs.length) addImagesToDraft(fs, "report"); };
    const orderCopyBtn = $("#rec-order-copy");
    if (orderCopyBtn) orderCopyBtn.onclick = () => openCopyPicker("order");
    const reportCopyBtn = $("#rec-report-copy");
    if (reportCopyBtn) reportCopyBtn.onclick = () => openCopyPicker("report");
    // 关联药单 / 检查报告：点卡片进编辑，左滑删除
    $("#rec-order-link").onclick = (e) => { const c = e.target.closest("[data-rel='order']"); if (c) openOrderModal(c.dataset.id); };
    $("#rec-report-link").onclick = (e) => { const c = e.target.closest("[data-rel='report']"); if (c) openReportModal(c.dataset.id); };
    attachSwipe($("#rec-order-link"), deleteOrderSwipe);
    attachSwipe($("#rec-report-link"), deleteReportSwipe);
    // 「添加药单 / 添加检查报告」：直接打开新建编辑弹窗，保存后自动关联
    const addOrderBtn = $("#rec-order-add");
    if (addOrderBtn) addOrderBtn.onclick = () => addOrderForRecord(rec);
    const addReportBtn = $("#rec-report-add");
    if (addReportBtn) addReportBtn.onclick = () => addReportForRecord(rec);
    // AI 分析按钮（分区域）：默认置灰，有录音/图片后可用
    function updateAIBtnStates() {
      const adviceBtn = $("#rec-ai-advice");
      if (adviceBtn) adviceBtn.disabled = !recDraft.audio;
      const orderBtn = $("#rec-ai-order");
      if (orderBtn) orderBtn.disabled = !((recDraft.orderImages || []).length > 0);
      const reportBtn = $("#rec-ai-report");
      if (reportBtn) reportBtn.disabled = !((recDraft.reportImages || []).length > 0);
    }
    _updateAIBtnStates = updateAIBtnStates;
    updateAIBtnStates();
    const aiAdviceBtn = $("#rec-ai-advice");
    if (aiAdviceBtn) aiAdviceBtn.onclick = async () => { const saved = await saveRecordEdit(rec, { silent: true }); if (saved) runAIAnalyze(saved); };
    const aiOrderBtn = $("#rec-ai-order");
    if (aiOrderBtn) aiOrderBtn.onclick = async () => { const saved = await saveRecordEdit(rec, { silent: true }); if (saved) runOrderAIAnalyze(saved); };
    const aiReportBtn = $("#rec-ai-report");
    if (aiReportBtn) aiReportBtn.onclick = async () => { const saved = await saveRecordEdit(rec, { silent: true }); if (saved) runReportAIAnalyze(saved); };
    const advBtn = $("#rec-advice-analyze");
    if (advBtn) advBtn.onclick = async () => { const saved = await saveRecordEdit(rec, { silent: true }); if (saved) runAdviceAnalyze(saved); };

    // 自动保存：修改后 debounce 静默保存
    _editingRec = rec;
    _recAutoSaveDirty = false;
    _recAutoSaveTrigger = () => {
      _recAutoSaveDirty = true;
      if (_recAutoSaveTimer) clearTimeout(_recAutoSaveTimer);
      _recAutoSaveTimer = setTimeout(async () => {
        _recAutoSaveTimer = null;
        if (!_recAutoSaveDirty) return;
        _recAutoSaveDirty = false;
        const saved = await saveRecordEdit(_editingRec, { silent: true });
        if (saved) _editingRec = saved;
        renderRecords();
        renderHome();
      }, 800);
    };
    ["#rec-f-hospital", "#rec-f-date", "#rec-f-doctor", "#rec-f-advice"].forEach((s) => { const el = $(s); if (el) el.addEventListener("input", _recAutoSaveTrigger); });
  }

  function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }
  async function addImagesToDraft(files, kind) {
    const bucket = kind === "report" ? recDraft.reportImages : recDraft.orderImages;
    const imgs = await NurseImgUpload.collectImages(files, (f) => downscaleImage(f, 1280, 0.82));
    for (const im of imgs) bucket.push(im);
    renderDraftThumbs();
  }
  function downscaleImage(file, maxDim, quality) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
            else { width = Math.round((width * maxDim) / height); height = maxDim; }
          }
          const cv = document.createElement("canvas");
          cv.width = width; cv.height = height;
          cv.getContext("2d").drawImage(img, 0, 0, width, height);
          try { resolve(cv.toDataURL("image/jpeg", quality)); } catch (e) { resolve(reader.result); }
        };
        img.onerror = () => resolve(reader.result);
        img.src = reader.result;
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }

  let _mediaRec = null, _mediaChunks = [], _mediaRecOn = false;
  function startRecMic() {
    const btn = $("#rec-mic");
    if (_mediaRecOn) { try { _mediaRec.stop(); } catch (e) {} return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("当前设备不支持录音，请上传录音文件"); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        _mediaChunks = [];
        _mediaRec = new MediaRecorder(stream);
        _mediaRecOn = true;
        btn.classList.add("recording");
        btn.textContent = "⏹ 停止录音";
        _mediaRec.ondataavailable = (e) => { if (e.data.size > 0) _mediaChunks.push(e.data); };
        _mediaRec.onstop = () => {
          _mediaRecOn = false;
          btn.classList.remove("recording");
          btn.textContent = "🎙 录音";
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(_mediaChunks, { type: _mediaRec.mimeType || "audio/mp4" });
          const reader = new FileReader();
          reader.onload = () => {
            const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("webm") ? "webm" : "mp3";
            recDraft.audio = { name: "录音." + ext, type: blob.type, dataUrl: reader.result };
            renderDraftThumbs();
            toast("录音已保存");
          };
          reader.readAsDataURL(blob);
        };
        _mediaRec.start();
      })
      .catch(() => {
        _mediaRecOn = false;
        btn.classList.remove("recording");
        btn.textContent = "🎙 录音";
        toast("无法访问麦克风，请检查权限");
      });
  }

  // 保存
  async function saveRecordEdit(rec, opts) {
    opts = opts || {};
    const payload = {
      hospital: $("#rec-f-hospital").value.trim(),
      visitDate: $("#rec-f-date").value,
      doctor: $("#rec-f-doctor").value.trim(),
      advice: { text: recDraft.adviceText.trim(), audio: recDraft.audio },
      rxImages: recDraft.orderImages,
      examImages: recDraft.reportImages,
    };
    let saved;
    if (rec) {
      saved = await NurseStorage.updateRecord(rec.id, payload);
    } else {
      saved = await NurseStorage.appendRecord(Object.assign({ source: "text", transcript: payload.advice.text, manual: true, status: "done" }, payload));
      currentRecordId = saved.id;
    }
    // 同步药单 / 检查报告的图片到关联实体（空数组也写入以覆盖删除）
    if (saved.orderId) {
      const o = (DATA.orders || []).find((x) => x.id === saved.orderId);
      const oPatch = { images: recDraft.orderImages };
      // 医院药单：来源/日期随问诊记录同步
      if (o && o.kind === "hospital") { oPatch.source = payload.hospital || o.source; oPatch.date = payload.visitDate || o.date; }
      await NurseStorage.updateOrder(saved.orderId, oPatch);
    }
    if (saved.reportId) {
      const rp = (DATA.reports || []).find((x) => x.id === saved.reportId);
      const rPatch = { images: recDraft.reportImages };
      // 医院报告：标题/日期随问诊记录同步
      if (rp && rp.kind === "hospital") { rPatch.title = payload.hospital || rp.title; rPatch.date = payload.visitDate || rp.date; }
      await NurseStorage.updateReport(saved.reportId, rPatch);
    }
    DATA = await NurseStorage.load();
    if (!opts.silent) {
      closeView();
      renderRecords();
      renderHome();
      toast("已保存");
    }
    return (DATA.records || []).find((r) => r.id === saved.id) || saved;
  }

  // ---- AI 分析 ----
  function showAIProgress(title) {
    const body = $("#ai-modal-body");
    body.innerHTML = `<div class="ai-progress">
      <div class="ai-progress__spinner"></div>
      <div class="ai-progress__title">${esc(title)}</div>
      <pre class="ai-progress__output" id="ai-progress-output"></pre>
    </div>`;
    $("#ai-modal").hidden = false;
  }
  function updateAIProgress(text) {
    const out = $("#ai-progress-output");
    if (out) out.textContent = text;
  }
  function showAIError(title, msg) {
    const body = $("#ai-modal-body");
    body.innerHTML = `<div class="ai-error">
      <div class="ai-error__icon">⚠️</div>
      <div class="ai-error__title">${esc(title)}</div>
      <div class="ai-error__msg">${esc(msg)}</div>
      <button class="btn btn-ghost block" id="ai-error-close">关闭</button>
    </div>`;
    $("#ai-error-close").onclick = () => { $("#ai-modal").hidden = true; };
  }
  async function runAIAnalyze(rec) {
    showAIProgress("🤖 AI 分析中…");
    try {
      const linkedReport = rec.reportId ? (DATA.reports || []).find((rp) => rp.id === rec.reportId) : null;
      const linkedOrder = rec.orderId ? (DATA.orders || []).find((o) => o.id === rec.orderId) : null;
      let adviceText = (rec.advice && rec.advice.text) || "";
      const audio = rec.advice && rec.advice.audio;
      if (audio && audio.dataUrl && !adviceText) {
        updateAIProgress("正在转写录音…");
        try {
          adviceText = await NurseAI.transcribeAudio({ settings: DATA.settings, audio });
          const ta = $("#rec-f-advice");
          if (ta) { ta.value = adviceText; recDraft.adviceText = adviceText; }
          await saveRecordEdit(rec, { silent: true });
          DATA = await NurseStorage.load();
          rec = (DATA.records || []).find((r) => r.id === rec.id) || rec;
        } catch (e) {
          showAIError("录音转写失败", e && e.message ? e.message : String(e));
          return;
        }
      }
      const res = await NurseAI.analyzeConsult({
        settings: DATA.settings,
        adviceText,
        examImages: (rec && rec.examImages && rec.examImages.length) ? rec.examImages : ((linkedReport && linkedReport.images) || []),
        rxImages: (rec && rec.rxImages && rec.rxImages.length) ? rec.rxImages : ((linkedOrder && linkedOrder.images) || []),
        onChunk: updateAIProgress,
      });
      aiModalState = { rec, data: res, type: "consult" };
      openAIModal();
    } catch (e) {
      showAIError("AI 分析失败", e && e.message ? e.message : String(e));
    }
  }
  async function runOrderAIAnalyze(rec) {
    showAIProgress("🤖 AI 分析药单中…");
    try {
      const linkedOrder = rec.orderId ? (DATA.orders || []).find((o) => o.id === rec.orderId) : null;
      const rxImages = (rec.rxImages && rec.rxImages.length) ? rec.rxImages : ((linkedOrder && linkedOrder.images) || []);
      if (!rxImages.length) { showAIError("无药单图片", "请先导入药单图片"); return; }
      const res = await NurseAI.analyzePrescription({ settings: DATA.settings, rxImages, onChunk: updateAIProgress });
      const prescription = res.prescription || [];
      if (!prescription.length) { showAIError("AI 未能识别", "未能从药单图片中识别出药品信息"); return; }
      const existOrder = rec.orderId ? (DATA.orders || []).find((o) => o.id === rec.orderId) : null;
      const oldMeds = existOrder ? (existOrder.medicines || []) : [];
      const full = {};
      const medicines = prescription.map((m) => {
        const same = oldMeds.find((om) => om.name === m.name);
        const fullData = { spec: parseSpecUnit(m.spec), doseAmount: 0, doseUnit: "片", timeSlots: ["morning"], meal: "any" };
        if (!same) full[m.name] = fullData;
        const aiQty = parseSpecQty(m.spec) * (m.packCount || 0);
        return { id: same ? same.id : undefined, name: m.name, manufacturer: "", alias: "", spec: m.spec || "", packCount: m.packCount || 0, qty: same ? same.qty : aiQty, price: same ? same.price : 0 };
      });
      if (existOrder) {
        await NurseStorage.updateOrder(rec.orderId, { medicines, _full: full, aiGenerated: true });
      } else {
        const o = await NurseStorage.upsertOrder({ source: rec.hospital || "药单", date: rec.visitDate || TODAY, kind: "hospital", recordId: rec.id, medicines, _full: full, aiGenerated: true });
        await NurseStorage.updateRecord(rec.id, { orderId: o.id });
      }
      DATA = await NurseStorage.load();
      $("#ai-modal").hidden = true;
      const latest = (DATA.records || []).find((r) => r.id === rec.id);
      if (latest && !$("#record-view").hidden) showRecordView(latest);
      renderRecords(); renderCabinet(); renderHome();
      toast("药单 AI 分析已保存");
    } catch (e) {
      showAIError("AI 分析药单失败", e && e.message ? e.message : String(e));
    }
  }
  async function runReportAIAnalyze(rec) {
    showAIProgress("🤖 AI 分析检查报告中…");
    try {
      const linkedReport = rec.reportId ? (DATA.reports || []).find((rp) => rp.id === rec.reportId) : null;
      const examImages = (rec.examImages && rec.examImages.length) ? rec.examImages : ((linkedReport && linkedReport.images) || []);
      if (!examImages.length) { showAIError("无报告图片", "请先导入检查报告图片"); return; }
      const followedIndicators = DATA.followedIndicators || [];
      if (!followedIndicators.length) { showAIError("未配置关注指标", "请先在「我的 → 关注指标」中添加关注指标"); return; }
      const res = await NurseAI.analyzeReport({ settings: DATA.settings, examImages, followedIndicators, onChunk: updateAIProgress });
      const indicators = res.examResults || [];
      if (!indicators.length) { showAIError("AI 未能识别", "未能从报告中识别出关注指标数据"); return; }
      if (rec.reportId) {
        const exist = (DATA.reports || []).find((rp) => rp.id === rec.reportId);
        await NurseStorage.updateReport(rec.reportId, { indicators, title: (exist && exist.title) || "检查报告", date: rec.visitDate || TODAY, kind: "hospital", aiGenerated: true });
      } else {
        const rp = await NurseStorage.upsertReport({ title: rec.hospital || "检查报告", date: rec.visitDate || TODAY, kind: "hospital", recordId: rec.id, indicators, aiGenerated: true });
        await NurseStorage.updateRecord(rec.id, { reportId: rp.id });
      }
      DATA = await NurseStorage.load();
      $("#ai-modal").hidden = true;
      const latest = (DATA.records || []).find((r) => r.id === rec.id);
      if (latest && !$("#record-view").hidden) showRecordView(latest);
      renderRecords(); renderHome();
      toast("检查报告 AI 分析已保存");
    } catch (e) {
      showAIError("AI 分析检查报告失败", e && e.message ? e.message : String(e));
    }
  }
  function openAIModal() {
    const { data } = aiModalState;
    const body = $("#ai-modal-body");
    body.innerHTML = `
      <div class="field"><span>本次医生医嘱（文字，可修改）</span><textarea id="ai-advice" rows="4">${esc(data.advice)}</textarea></div>
      <div class="detail-sec"><h4>🧪 检查结果</h4>
        <div class="table-wrap"><table class="edit-table" id="ai-exam-t"><thead><tr><th>指标</th><th>数值</th><th>单位</th><th>参考</th><th>异常</th><th></th></tr></thead><tbody></tbody></table></div>
        <button type="button" class="btn btn-ghost btn-sm" id="ai-exam-add">＋ 添加指标</button>
      </div>
      <div class="detail-sec"><h4>💊 处方药</h4>
        <div class="table-wrap"><table class="edit-table" id="ai-rx-t"><thead><tr><th>药名</th><th>规格</th><th>数量</th><th></th></tr></thead><tbody></tbody></table></div>
        <button type="button" class="btn btn-ghost btn-sm" id="ai-rx-add">＋ 添加药品</button>
      </div>
      <div class="capture-actions">
        <button class="btn btn-primary block" id="ai-save">保存并确定</button>
        <button class="btn btn-ghost block" id="ai-cancel">取消</button>
      </div>`;
    const renderT = (sel, rows, fields) => {
      const tb = $(sel + " tbody");
      tb.innerHTML = rows.map((r, i) => `<tr data-i="${i}">${fields.map((f) => `<td>${f.cell(r)}</td>`).join("")}<td><button class="row-del" data-i="${i}">✕</button></td></tr>`).join("");
      $$(sel + " .row-del").forEach((b) => (b.onclick = () => { rows.splice(+b.dataset.i, 1); renderT(sel, rows, fields); }));
    };
    const examFields = [
      { cell: (r) => `<input data-f="name" value="${esc(r.name)}"/>` },
      { cell: (r) => `<input data-f="value" value="${esc(r.value)}"/>` },
      { cell: (r) => `<input data-f="unit" value="${esc(r.unit)}"/>` },
      { cell: (r) => `<input data-f="range" value="${esc(r.range)}"/>` },
      { cell: (r) => `<input type="checkbox" data-f="abnormal" ${r.abnormal ? "checked" : ""}/>` },
    ];
    const rxFields = [
      { cell: (r) => `<input data-f="name" value="${esc(r.name)}"/>` },
      { cell: (r) => `<input data-f="spec" value="${esc(r.spec)}"/>` },
      { cell: (r) => `<input type="number" data-f="packCount" value="${esc(r.packCount || 0)}"/>` },
    ];
    renderT("#ai-exam-t", data.examResults, examFields);
    renderT("#ai-rx-t", data.prescription, rxFields);
    $("#ai-exam-add").onclick = () => { data.examResults.push({ name: "", value: "", unit: "", range: "", abnormal: false }); renderT("#ai-exam-t", data.examResults, examFields); };
    $("#ai-rx-add").onclick = () => { data.prescription.push({ name: "", spec: "", packCount: 0 }); renderT("#ai-rx-t", data.prescription, rxFields); };
    $("#ai-save").onclick = saveAIModal;
    $("#ai-cancel").onclick = () => { aiModalState = null; $("#ai-modal").hidden = true; };
    $("#ai-modal").hidden = false;
  }
  async function saveAIModal() {
    const { rec, data } = aiModalState;
    const examResults = $$("#ai-exam-t tr[data-i]")
      .map((row) => ({
        name: row.querySelector('[data-f="name"]').value.trim(),
        value: row.querySelector('[data-f="value"]').value.trim(),
        unit: row.querySelector('[data-f="unit"]').value.trim(),
        range: row.querySelector('[data-f="range"]').value.trim(),
        abnormal: row.querySelector('[data-f="abnormal"]').checked,
      }))
      .filter((x) => x.name);
    const prescription = $$("#ai-rx-t tr[data-i]")
      .map((row) => ({
        name: row.querySelector('[data-f="name"]').value.trim(),
        manufacturer: "",
        alias: "",
        spec: row.querySelector('[data-f="spec"]').value.trim(),
        packCount: Number(row.querySelector('[data-f="packCount"]').value) || 0,
      }))
      .filter((x) => x.name);
    const adviceText = $("#ai-advice").value.trim();
    // 1. 保存医嘱文字与解析结果到记录
    rec.advice = { text: adviceText, audio: rec.advice ? rec.advice.audio : null };
    rec.result = rec.result || {};
    rec.result.medications = prescription.map((m) => ({ name: m.name, spec: m.spec, packCount: m.packCount, disease: "" }));
    await NurseStorage.updateRecord(rec.id, { advice: rec.advice, result: rec.result });
    DATA = await NurseStorage.load();
    const latest0 = (DATA.records || []).find((r) => r.id === rec.id) || rec;

    // 2. 检查报告：已关联则覆盖指标，否则新建并关联
    if (examResults.length) {
      const indicators = examResults.map((e) => ({ name: e.name, value: e.value, unit: e.unit, range: e.range, abnormal: e.abnormal }));
      if (latest0.reportId) {
        const exist = (DATA.reports || []).find((rp) => rp.id === latest0.reportId);
        await NurseStorage.updateReport(latest0.reportId, { indicators, title: (exist && exist.title) || "检查报告", date: latest0.visitDate || TODAY, kind: "hospital", aiGenerated: true });
      } else {
        const rp = await NurseStorage.upsertReport({ title: latest0.hospital || "检查报告", date: latest0.visitDate || TODAY, kind: "hospital", recordId: latest0.id, indicators, aiGenerated: true });
        await NurseStorage.updateRecord(latest0.id, { reportId: rp.id });
      }
    }
    // 3. 药单：已关联则覆盖药品，否则新建并关联（同名药继承原条目 id/qty，库存不受影响）
    if (prescription.length) {
      const existOrder = latest0.orderId ? (DATA.orders || []).find((o) => o.id === latest0.orderId) : null;
      const oldMeds = existOrder ? (existOrder.medicines || []) : [];
      const full = {};
      const medicines = prescription.map((m) => {
        const same = oldMeds.find((om) => om.name === m.name);
        const fullData = {
          spec: parseSpecUnit(m.spec),
          doseAmount: 0,
          doseUnit: "片",
          timeSlots: ["morning"],
          meal: "any",
        };
        if (!same) full[m.name] = fullData; // 新药 → 建档药箱（主属性取 AI 解析结果）
        const aiQty = parseSpecQty(m.spec) * (m.packCount || 0);
        return {
          id: same ? same.id : undefined,
          name: m.name, manufacturer: m.manufacturer || "", alias: m.alias || "",
          spec: m.spec || "",
          packCount: m.packCount || 0,
          qty: same ? same.qty : aiQty,
          price: same ? same.price : 0,
        };
      });
      if (existOrder) {
        await NurseStorage.updateOrder(latest0.orderId, { medicines, _full: full, source: existOrder.source || latest0.hospital || "药单", date: latest0.visitDate || TODAY, kind: "hospital", aiGenerated: true });
      } else {
        const o = await NurseStorage.upsertOrder({ source: latest0.hospital || "药单", date: latest0.visitDate || TODAY, kind: "hospital", recordId: latest0.id, medicines, _full: full, aiGenerated: true });
        await NurseStorage.updateRecord(latest0.id, { orderId: o.id });
      }
    }
    DATA = await NurseStorage.load();
    aiModalState = null;
    $("#ai-modal").hidden = true;
    const latest = (DATA.records || []).find((r) => r.id === rec.id);
    if (latest) showRecordView(latest);
    else closeView();
    renderRecords();
    renderCabinet();
    renderHome();
    const didOverwrite = (examResults.length && latest0.reportId) || (prescription.length && latest0.orderId);
    toast(didOverwrite ? "已保存并覆盖已关联的检查报告 / 药单" : "已保存（检查报告 / 药单已自动关联）");
  }

  // ---- 医嘱分析 ----
  async function runAdviceAnalyze(rec) {
    showAIProgress("💡 医嘱分析中…");
    const ctx = buildAdviceContext(rec);
    try {
      const res = await NurseAI.analyzeAdvice({ settings: DATA.settings, context: ctx, onChunk: updateAIProgress });
      aiModalState = { rec, data: res, type: "advice" };
      openAdviceModal();
    } catch (e) {
      showAIError("医嘱分析失败", e && e.message ? e.message : String(e));
    }
  }
  function buildAdviceContext(rec) {
    let s = "【本次医生医嘱】\n";
    s += rec.advice && rec.advice.text ? rec.advice.text + "\n" : "（无文字医嘱）\n";
    // 关联药单药品（主属性从药箱 cabinet 取）
    const order = (DATA.orders || []).find((o) => o.id === rec.orderId);
    if (order && order.medicines && order.medicines.length) {
      const cabOf = (name) => (DATA.cabinet || []).find((c) => c.name === name) || null;
      s += "本次处方药：" + order.medicines.map((m) => {
        const cab = cabOf(m.name);
        return m.name + (cab && cab.doseAmount ? " " + cab.doseAmount + (cab.doseUnit || "") : "") + (cab ? " " + slotLabels(cab.timeSlots) : "");
      }).join("；") + "\n";
    }
    // 关联检查报告
    const report = (DATA.reports || []).find((rp) => rp.id === rec.reportId);
    if (report && report.indicators && report.indicators.length) {
      s += "本次检查：" + report.indicators.map((e) => e.name + " " + e.value + (e.unit || "") + (e.abnormal ? "(异常)" : "")).join("；") + "\n";
    }
    s += "\n【历次检查指标趋势】\n";
    const map = {};
    (DATA.reports || []).forEach((rp) => (rp.indicators || []).forEach((ind) => { (map[ind.name] = map[ind.name] || []).push({ date: rp.date, value: ind.value, unit: ind.unit, abnormal: ind.abnormal }); }));
    const keys = Object.keys(map);
    if (!keys.length) s += "（暂无历史检查数据）\n";
    else
      keys.slice(0, 10).forEach((k) => {
        const pts = map[k].sort((a, b) => (a.date < b.date ? -1 : 1));
        s += k + "：" + pts.map((p) => p.date + " " + p.value + (p.abnormal ? "↑" : "")).join(" → ") + "\n";
      });
    s += "\n【当前用药】\n";
    const active = activeMedicines();
    if (!active.length) s += "（暂无在用药品）\n";
    else s += active.map((d) => d.name + (d.doseAmount ? " " + d.doseAmount + d.doseUnit : "") + " " + slotLabels(d.timeSlots) + " " + mealLabel(d.meal)).join("；") + "\n";
    return s;
  }
  function openAdviceModal() {
    const { data } = aiModalState;
    const body = $("#ai-modal-body");
    body.innerHTML = `
      <div class="detail-sec"><h4>🥗 饮食 / 生活建议（可修改）</h4>
        <div id="adv-diet">${data.diet.map((x) => `<div class="adv-row"><input value="${esc(x)}"/></div>`).join("") || '<div class="adv-row"><input placeholder="建议…"/></div>'}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="adv-diet-add">＋ 添加</button>
      </div>
      <div class="detail-sec"><h4>⛔ 禁忌（可修改）</h4>
        <div id="adv-taboo">${data.taboo.map((x) => `<div class="adv-row"><input value="${esc(x)}"/></div>`).join("") || '<div class="adv-row"><input placeholder="禁忌…"/></div>'}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="adv-taboo-add">＋ 添加</button>
      </div>
      <div class="field"><span>一句话总结（可修改）</span><input id="adv-text" value="${esc(data.text)}"/></div>
      <div class="capture-actions">
        <button class="btn btn-primary block" id="ai-save">保存并更新首页</button>
        <button class="btn btn-ghost block" id="ai-cancel">取消</button>
      </div>`;
    const addRow = (id, btn) => {
      $(btn).onclick = () => { const d = $(id); d.insertAdjacentHTML("beforeend", '<div class="adv-row"><input placeholder="…"/></div>'); };
    };
    addRow("#adv-diet", "#adv-diet-add");
    addRow("#adv-taboo", "#adv-taboo-add");
    $("#ai-save").onclick = saveAdviceModal;
    $("#ai-cancel").onclick = () => { aiModalState = null; $("#ai-modal").hidden = true; };
    $("#ai-modal").hidden = false;
  }
  async function saveAdviceModal() {
    const { rec } = aiModalState;
    const diet = $$("#adv-diet input").map((i) => i.value.trim()).filter(Boolean);
    const taboo = $$("#adv-taboo input").map((i) => i.value.trim()).filter(Boolean);
    const text = $("#adv-text").value.trim();
    rec.aiAdvice = { diet, taboo, text, createdAt: new Date().toISOString() };
    await NurseStorage.updateRecord(rec.id, { aiAdvice: rec.aiAdvice });
    DATA = await NurseStorage.load();
    aiModalState = null;
    $("#ai-modal").hidden = true;
    const latest = (DATA.records || []).find((r) => r.id === rec.id);
    if (latest) showRecordView(latest);
    else closeView();
    renderHome();
    toast("已更新首页 AI 医嘱");
  }

  async function closeView() {
    closeLightbox();
    if (!$("#record-view").hidden) {
      if (_recAutoSaveTimer) { clearTimeout(_recAutoSaveTimer); _recAutoSaveTimer = null; }
      if (_recAutoSaveDirty && _editingRec) {
        _recAutoSaveDirty = false;
        const saved = await saveRecordEdit(_editingRec, { silent: true });
        if (saved) _editingRec = saved;
        renderRecords();
        renderHome();
      }
    }
    _recAutoSaveDirty = false;
    _recAutoSaveTrigger = null;
    currentRecordId = null; // 离开详情页清空，避免污染后续新建（药单/报告）的关联判断
    $$(".view").forEach((v) => (v.hidden = true));
    goPage("records");
  }

  // ===================== 问诊记录：新建/编辑药单与检查报告并关联 =====================
  // 「添加药单 / 更换药单」：无关联则直接打开新建药单弹窗（保存后自动关联），
  // 已有关联则直接打开该药单的编辑弹窗
  async function addOrderForRecord(rec) {
    // 新记录先静默保存，获得 id 供关联；showRecordView 会重新绑定按钮
    if (!rec || !rec.id) {
      const saved = await saveRecordEdit(rec, { silent: true });
      if (!saved || !saved.id) { toast("请先填写问诊记录基本信息"); return; }
      currentRecordId = saved.id;
      showRecordView((DATA.records || []).find((r) => r.id === saved.id));
      const ai = $("#ai-modal"); if (ai) ai.hidden = true;
    } else {
      currentRecordId = rec.id;
    }
    // 已有关联药单 → 直接编辑该药单；否则新建
    if (rec && rec.orderId) openOrderModal(rec.orderId, true);
    else openOrderModal(null, true);
  }
  // 「添加检查报告 / 更换检查报告」：逻辑同上
  async function addReportForRecord(rec) {
    if (!rec || !rec.id) {
      const saved = await saveRecordEdit(rec, { silent: true });
      if (!saved || !saved.id) { toast("请先填写问诊记录基本信息"); return; }
      currentRecordId = saved.id;
      showRecordView((DATA.records || []).find((r) => r.id === saved.id));
      const ai = $("#ai-modal"); if (ai) ai.hidden = true;
    } else {
      currentRecordId = rec.id;
    }
    if (rec && rec.reportId) openReportModal(rec.reportId, true);
    else openReportModal(null, true);
  }

  // ===================== 问诊记录：复制已有 药单/检查报告 =====================
  // 从历史药单/报告中选一个，复制内容（药品/指标 + 图片）创建新副本并关联到当前问诊记录；
  // 若当前记录已有关联，先解除旧关联（保留旧实体），再关联新副本。
  let copyPickKind = null;
  function openCopyPicker(kind) {
    copyPickKind = kind;
    const isOrder = kind === "order";
    const rec = currentRecordId ? findRecord(currentRecordId) : null;
    const curId = isOrder ? (rec && rec.orderId) : (rec && rec.reportId);
    const list = isOrder ? (DATA.orders || []) : (DATA.reports || []);
    const candidates = list.filter((x) => x.id !== curId && (isOrder ? ((x.medicines || []).length || (x.images || []).length) : ((x.indicators || []).length || (x.images || []).length)));
    $("#copy-pick-title").textContent = isOrder ? "复制已有药单" : "复制已有检查报告";
    if (!candidates.length) {
      $("#copy-pick-list").innerHTML = '<div class="empty-tip" style="padding:18px;text-align:center">暂无可复制的' + (isOrder ? "药单" : "检查报告") + "</div>";
    } else {
      $("#copy-pick-list").innerHTML = candidates.map((x) => {
        if (isOrder) {
          const cnt = (x.medicines || []).length;
          const imgCnt = (x.images || []).length;
          return `<div class="copy-pick-item" data-id="${esc(x.id)}">
            <div class="copy-pick__title"><b>${esc(x.source || "未填来源")}</b><span class="copy-pick__date">${esc(x.date || "")}</span></div>
            <div class="copy-pick__meta">共 ${cnt} 种药品${imgCnt ? " · " + imgCnt + " 张图" : ""}</div>
            ${cnt ? `<div class="copy-pick__chips">${x.medicines.slice(0, 5).map((m) => `<span class="order-chip">${esc(m.name)}</span>`).join("")}${cnt > 5 ? `<span class="order-chip">+${cnt - 5}</span>` : ""}</div>` : ""}
          </div>`;
        }
        const inds = x.indicators || [];
        const imgCnt = (x.images || []).length;
        return `<div class="copy-pick-item" data-id="${esc(x.id)}">
          <div class="copy-pick__title"><b>${esc(x.date || "")}</b>${x.title ? `<span class="copy-pick__date">${esc(x.title)}</span>` : ""}</div>
          <div class="copy-pick__meta">${inds.length} 项指标${imgCnt ? " · " + imgCnt + " 张图" : ""}</div>
          ${inds.length ? `<div class="copy-pick__chips">${inds.slice(0, 6).map((i) => `<span class="exam-chip ${i.abnormal ? "is-bad" : ""}">${esc(i.name)} ${esc(i.value)}${esc(i.unit || "")}</span>`).join("")}</div>` : ""}
        </div>`;
      }).join("");
      $$("#copy-pick-list .copy-pick-item").forEach((el) => (el.onclick = () => applyCopy(el.dataset.id)));
    }
    $("#copy-pick-modal").hidden = false;
  }
  async function applyCopy(sourceId) {
    $("#copy-pick-modal").hidden = true;
    const isOrder = copyPickKind === "order";
    let recId = currentRecordId;
    let rec = recId ? findRecord(recId) : null;
    if (!rec || !recId) {
      const cur = recId ? rec : null;
      const saved = await saveRecordEdit(cur, { silent: true });
      if (!saved || !saved.id) { toast("请先填写问诊记录基本信息"); return; }
      recId = saved.id; currentRecordId = recId;
      rec = findRecord(recId);
    }
    if (!rec) { toast("当前问诊记录不存在"); return; }
    const src = (isOrder ? (DATA.orders || []) : (DATA.reports || [])).find((x) => x.id === sourceId);
    if (!src) { toast("源数据不存在"); return; }
    const srcImages = (src.images || []).map((im) => ({ name: im.name, type: im.type, dataUrl: im.dataUrl }));
    if (isOrder) {
      if (rec.orderId && rec.orderId !== sourceId) {
        const old = (DATA.orders || []).find((o) => o.id === rec.orderId);
        if (old) await NurseStorage.updateOrder(old.id, { recordId: "" });
      }
      const newItem = {
        source: rec.hospital || src.source || "药单",
        date: rec.visitDate || src.date || TODAY,
        kind: "hospital",
        recordId: recId,
        medicines: (src.medicines || []).map((m) => ({ name: m.name, manufacturer: m.manufacturer, alias: m.alias, spec: m.spec, packCount: m.packCount, qty: m.qty, price: m.price })),
        images: srcImages,
      };
      const savedOrder = await NurseStorage.upsertOrder(newItem);
      if (savedOrder && savedOrder.id) {
        await NurseStorage.updateRecord(recId, { orderId: savedOrder.id, rxImages: srcImages });
      }
      DATA = await NurseStorage.load();
      const latest = findRecord(recId);
      if (latest && !$("#record-view").hidden) showRecordView(latest);
      renderCabinet(); renderHome(); renderRecords();
      toast("已复制药单到本次问诊");
    } else {
      if (rec.reportId && rec.reportId !== sourceId) {
        const old = (DATA.reports || []).find((r) => r.id === rec.reportId);
        if (old) await NurseStorage.updateReport(old.id, { recordId: "" });
      }
      const newItem = {
        title: rec.hospital || src.title || "检查报告",
        date: rec.visitDate || src.date || TODAY,
        kind: "hospital",
        recordId: recId,
        indicators: (src.indicators || []).map((x) => ({ name: x.name, value: x.value, unit: x.unit, range: x.range, abnormal: x.abnormal })),
        images: srcImages,
      };
      const savedReport = await NurseStorage.upsertReport(newItem);
      if (savedReport && savedReport.id) {
        await NurseStorage.updateRecord(recId, { reportId: savedReport.id, examImages: srcImages });
      }
      DATA = await NurseStorage.load();
      const latest = findRecord(recId);
      if (latest && !$("#record-view").hidden) showRecordView(latest);
      renderRecords(); renderHome();
      toast("已复制检查报告到本次问诊");
    }
  }

  // ===================== 检查结果趋势 / 明细 =====================
  function collectSeries() {
    const map = {};
    (DATA.reports || []).forEach((rp) => {
      (rp.indicators || []).forEach((ind) => {
        const v = parseFloat(ind.value);
        if (isNaN(v)) return;
        (map[ind.name] = map[ind.name] || []).push({ date: rp.date || "", value: v, unit: ind.unit, abnormal: ind.abnormal });
      });
    });
    const out = [];
    for (const name in map) {
      const pts = map[name].sort((a, b) => (a.date < b.date ? -1 : 1));
      out.push({ name, unit: pts[pts.length - 1].unit, points: pts });
    }
    return out;
  }
  function renderExamTrend(el) {
    if (!el) return;
    const followed = (DATA.followedIndicators || []).map((f) => typeof f === "string" ? f : f.name);
    const series = collectSeries().filter((s) => followed.includes(s.name));
    if (!series.length) {
      el.innerHTML = followed.length ? '<div class="empty-tip">关注的指标暂无趋势数据。</div>' : '<div class="empty-tip">请先在「我的 → 关注指标」中添加需要跟踪的指标。</div>';
      return;
    }
    series.sort((a, b) => {
      const fa = followed.indexOf(a.name);
      const fb = followed.indexOf(b.name);
      return (fa < 0 ? 999 : fa) - (fb < 0 ? 999 : fb);
    });
    el.innerHTML = series.map((s, i) => {
      const chart = s.points.length >= 2 ? svgLineChart(s) : singlePoint(s);
      const latest = s.points[s.points.length - 1];
      return `<div class="trend-card is-followed" data-trend-detail="${i}">
        <div class="trend-card__head"><b>${esc(s.name)}</b><span class="trend-star">⭐</span></div>
        <div class="trend-card__val"><span>${esc(latest.value + " " + (s.unit || ""))}</span>${latest.abnormal ? " ⚠️" : ""}<span class="trend-card__date">${esc((latest.date || "").slice(5))}</span></div>
        ${chart}
      </div>`;
    }).join("");
    $$("[data-trend-detail]").forEach((card) => (card.onclick = () => openExamView(+card.dataset.trendDetail)));
  }
  function singlePoint(s) {
    const p = s.points[0];
    return `<div class="trend-single">仅一次记录：${esc(p.date || "")} ${esc(p.value + " " + (s.unit || ""))}</div>`;
  }
  function svgLineChart(s) {
    const W = 320, H = 160, P = 26;
    const vals = s.points.map((p) => p.value);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;
    const n = s.points.length;
    const xStep = (W - 2 * P) / (n - 1);
    const xy = s.points.map((p, i) => ({ x: P + i * xStep, y: P + (1 - (p.value - min) / range) * (H - 2 * P), p }));
    const line = xy.map((d) => d.x.toFixed(1) + "," + d.y.toFixed(1)).join(" ");
    const dots = xy.map((d) => `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="3" fill="${d.p.abnormal ? "#e74c3c" : "#2bb673"}"/>`).join("");
    const xlabels = xy.map((d) => `<text x="${d.x.toFixed(1)}" y="${H - 8}" font-size="9" fill="#888" text-anchor="middle">${esc((d.p.date || "").slice(5))}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
      <line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="#ddd"/>
      <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#ddd"/>
      <text x="${P}" y="${P - 8}" font-size="9" fill="#888">${esc(String(max))}</text>
      <text x="${P}" y="${H - P + 14}" font-size="9" fill="#888">${esc(String(min))}</text>
      <polyline points="${line}" fill="none" stroke="#2bb673" stroke-width="2"/>
      ${dots}${xlabels}
    </svg>`;
  }

  // 关注指标区（"我的"页面）：显示指标名+单位+参考值+最新值
  function renderFollowListMe() {
    const el = $("#follow-list-me");
    if (!el) return;
    const followed = DATA.followedIndicators || [];
    const sub = $("#follow-sub");
    if (sub) sub.textContent = followed.length ? followed.length + " 项" : "";
    if (!followed.length) {
      el.innerHTML = '<div class="empty-tip">还没有关注指标，点「新增」添加。</div>';
      return;
    }
    const series = collectSeries();
    const byName = {};
    series.forEach((s) => (byName[s.name] = s));
    el.innerHTML = followed.map((f) => {
      const name = typeof f === "string" ? f : f.name;
      const unit = typeof f === "string" ? "" : (f.unit || "");
      const range = typeof f === "string" ? "" : (f.range || "");
      return `<div class="follow-mgr-row swipe-item" data-swipe data-follow-edit="${esc(name)}">
        <div class="swipe-content follow-mgr-row__info">
          <span class="follow-mgr-row__name">${esc(name)}</span>
          ${range ? '<span class="follow-mgr-row__range">' + esc(range) + '</span>' : ""}
          ${unit ? '<span class="follow-mgr-row__unit">' + esc(unit) + '</span>' : ""}
        </div>
        <button class="swipe-del" data-swipe-del>删除</button>
      </div>`;
    }).join("");
  }

  // 关注指标 管理弹窗
  function openFollowModal(editName) {
    const editing = editName && (DATA.followedIndicators || []).find((f) => (typeof f === "string" ? f : f.name) === editName);
    followEditing = editing ? editName : null;
    $("#follow-input").value = editing ? (typeof editing === "string" ? editing : editing.name) : "";
    $("#follow-unit").value = editing && typeof editing === "object" ? (editing.unit || "") : "";
    $("#follow-range").value = editing && typeof editing === "object" ? (editing.range || "") : "";
    $("#follow-add").textContent = editing ? "保存修改" : "＋ 添加关注";
    const allNames = collectSeries().map((s) => s.name);
    const followed = new Set((DATA.followedIndicators || []).map((f) => typeof f === "string" ? f : f.name));
    if (editing) followed.delete(editName);
    const dl = $("#follow-suggestions");
    if (dl) dl.innerHTML = allNames.filter((n) => !followed.has(n)).map((n) => `<option value="${esc(n)}">`).join("");
    renderFollowList();
    $("#follow-modal").hidden = false;
  }
  function renderFollowList() {
    const box = $("#follow-list");
    if (!box) return;
    const followed = DATA.followedIndicators || [];
    if (!followed.length) { box.innerHTML = '<div class="empty-tip" style="padding:4px 0">还没有关注指标</div>'; return; }
    box.innerHTML = followed.map((f) => {
      const name = typeof f === "string" ? f : f.name;
      const unit = typeof f === "string" ? "" : (f.unit || "");
      const range = typeof f === "string" ? "" : (f.range || "");
      return `<div class="follow-mgr-row">
        <div class="follow-mgr-row__info">
          <span class="follow-mgr-row__name">${esc(name)}</span>
          ${unit ? '<span class="follow-mgr-row__unit">' + esc(unit) + '</span>' : ""}
          ${range ? '<span class="follow-mgr-row__range">参考 ' + esc(range) + '</span>' : ""}
        </div>
        <button class="icon-btn icon-btn--danger" data-follow-del="${esc(name)}">✕</button>
      </div>`;
    }).join("");
    $$("[data-follow-del]").forEach((b) => (b.onclick = async () => {
      DATA.followedIndicators = (DATA.followedIndicators || []).filter((f) => (typeof f === "string" ? f : f.name) !== b.dataset.followDel);
      await NurseStorage.setFollowedIndicators(DATA.followedIndicators);
      renderFollowList();
    }));
  }
  async function addFollowIndicator() {
    const v = $("#follow-input").value.trim();
    if (!v) { toast("请输入指标名"); return; }
    const unit = $("#follow-unit").value.trim();
    const range = $("#follow-range").value.trim();
    if (followEditing) {
      const existing = (DATA.followedIndicators || []).filter((f) => (typeof f === "string" ? f : f.name) !== followEditing);
      DATA.followedIndicators = [...existing, { name: v, unit, range }];
      await NurseStorage.setFollowedIndicators(DATA.followedIndicators);
      followEditing = null;
      $("#follow-input").value = "";
      $("#follow-unit").value = "";
      $("#follow-range").value = "";
      $("#follow-add").textContent = "＋ 添加关注";
      renderFollowList();
      toast("已修改：" + v);
    } else {
      const existing = (DATA.followedIndicators || []).filter((f) => (typeof f === "string" ? f : f.name) !== v);
      DATA.followedIndicators = [...existing, { name: v, unit, range }];
      await NurseStorage.setFollowedIndicators(DATA.followedIndicators);
      $("#follow-input").value = "";
      $("#follow-unit").value = "";
      $("#follow-range").value = "";
      renderFollowList();
      toast("已添加关注：" + v);
    }
  }

  // 检查报告 明细列表
  function renderExamList(el) {
    if (!el) return;
    const entries = (DATA.reports || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!entries.length) { el.innerHTML = ""; return; }
    el.innerHTML = entries
      .map((rp) => `<div class="exam-entry swipe-item" data-report-id="${esc(rp.id)}" data-swipe>
        <div class="swipe-content">
          <div class="exam-entry__head"><b>${esc(rp.date || "")}</b>${rp.title ? " · " + esc(rp.title) : ""}<span class="exam-entry__tag">${rp.kind === "self" ? "自测" : "医院"}</span>${rp.aiGenerated ? '<span class="ai-badge">AI</span>' : ''}</div>
          <div class="exam-entry__inds">${(rp.indicators || []).map((i) => `<span class="exam-chip ${i.abnormal ? "is-bad" : ""}">${esc(i.name)} ${esc(i.value)}${esc(i.unit || "")}</span>`).join("")}</div>
        </div>
        <button class="swipe-del" data-swipe-del>删除</button>
      </div>`)
      .join("");
  }

  // ===================== 我的药箱：药箱（汇总只读）/ 药单 =====================
  function drugStatus(m) {
    if (m.status === "disabled") return "disabled";
    if (m.status === "out" || Number(m.qty) <= 0) return "out";
    return "active";
  }
  function statusLabel(s) {
    return s === "active" ? "使用中" : s === "disabled" ? "停用" : "缺药";
  }

  function renderCabinet() {
    renderCabinetSummary();
    renderOrders();
  }

  // 药箱页签：药箱药品主档（cabinet），点击进编辑，左滑删除
  function latestMedInfo(name) {
    const orders = (DATA.orders || []).slice().sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1));
    for (const o of orders) {
      const m = (o.medicines || []).find((mm) => mm.name === name);
      if (m) return { manufacturer: m.manufacturer || "", alias: m.alias || "", spec: m.spec || "", price: Number(m.price) || 0 };
    }
    return { manufacturer: "", alias: "", spec: "", price: 0 };
  }
  function renderCabinetSummary() {
    const listBox = $("#cabinet-list");
    const empty = $("#cabinet-empty");
    const items = DATA.cabinet || [];
    const counts = { active: 0, disabled: 0, out: 0 };
    items.forEach((d) => { const s = drugStatus(d); if (counts[s] !== undefined) counts[s]++; });
    $("#cab-active-count").textContent = counts.active;
    $("#cab-disabled-count").textContent = counts.disabled;
    $("#cab-out-count").textContent = counts.out;
    const filtered = cabinetState.filter === "all" ? items : items.filter((d) => drugStatus(d) === cabinetState.filter);
    if (!filtered.length) { listBox.innerHTML = ""; empty.hidden = false; return; }
    empty.hidden = true;
    listBox.innerHTML = filtered
      .map((d) => {
        const orderCnt = (DATA.orders || []).filter((o) => (o.medicines || []).some((m) => m.name === d.name)).length;
        const info = latestMedInfo(d.name);
        const meta = [
          info.manufacturer ? "厂家 " + info.manufacturer : "",
          info.alias && info.alias !== d.name ? "别名 " + info.alias : "",
          info.spec ? "规格 " + info.spec : "",
          info.price ? "价格 ¥" + info.price : "",
          d.disease ? "针对 " + d.disease : "",
          "库存 " + (Number(d.qty) || 0) + " " + (d.unit || "片"),
          "阈值 " + (Number(d.threshold) || 0),
          orderCnt ? "来自 " + orderCnt + " 个药单" : "",
        ].filter(Boolean).join(" · ");
        return `<div class="cab-item swipe-item ${esc(drugStatus(d))}" data-cab-id="${esc(d.id)}" data-swipe>
          <div class="swipe-content">
            <div class="cab-item__top">
              <div>
                <div class="cab-item__name">${esc(d.name)}</div>
                <div class="cab-item__spec">单次 ${esc(d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "—")} · ${slotLabels(d.timeSlots)} · ${mealLabel(d.meal)}</div>
                <div class="cab-item__meta2">${esc(meta)}</div>
              </div>
              <span class="cab-status ${esc(drugStatus(d))}">${statusLabel(drugStatus(d))}</span>
            </div>
          </div>
          <button class="swipe-del" data-swipe-del>删除</button>
        </div>`;
      })
      .join("");
  }

  // 药单页签：药单列表（点卡片进编辑，左滑删除）
  function renderOrders() {
    const listBox = $("#orders-list");
    const empty = $("#orders-empty");
    const orders = (DATA.orders || []).slice().sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1));
    if (!orders.length) { listBox.innerHTML = ""; empty.hidden = false; return; }
    empty.hidden = true;
    listBox.innerHTML = orders
      .map((o) => {
        const kindTag = o.kind === "hospital" ? `<span class="order-tag">医院</span>` : `<span class="order-tag order-tag--self">自建</span>`;
        const count = (o.medicines || []).length;
        return `<div class="order-card swipe-item" data-order-id="${esc(o.id)}" data-swipe>
          <div class="swipe-content">
            <div class="order-card__head">
              <div class="order-card__title"><b>${esc(o.source || "未填来源")}</b>${kindTag}${o.aiGenerated ? '<span class="ai-badge">AI</span>' : ''}</div>
              <span class="order-card__date">${esc(o.date || "无日期")}</span>
            </div>
            <div class="order-card__meta">共 ${count} 种药品</div>
            ${count ? `<div class="order-card__meds">${o.medicines.slice(0, 3).map((m) => `<span class="order-chip">${esc(m.name)}</span>`).join("")}${count > 3 ? `<span class="order-chip">+${count - 3}</span>` : ""}</div>` : ""}
          </div>
          <button class="swipe-del" data-swipe-del>删除</button>
        </div>`;
      })
      .join("");
  }

  // ===================== 药箱药品 编辑弹窗（全属性，药名只读） =====================
  let editingCabId = null;
  function openCabinetModal(id) {
    const c = (DATA.cabinet || []).find((x) => x.id === id);
    if (!c) return;
    editingCabId = id;
    $("#cabitem-title").textContent = "编辑药箱药品";
    $("#cabitem-f-name").value = c.name;
    $("#cabitem-f-name").disabled = true; // 药名是药单关联键，创建后不可修改
    $("#cabitem-f-disease").value = c.disease || "";
    $("#cabitem-f-unit").value = c.unit || "片";
    $("#cabitem-f-spec").value = c.spec || "";
    $("#cabitem-f-qty").value = Number(c.qty) || 0;
    $("#cabitem-f-dose").value = Number(c.doseAmount) || 0;
    $("#cabitem-f-doseunit").value = c.doseUnit || "片";
    $$(".cabitem-f-slot").forEach((ch) => (ch.checked = (c.timeSlots || ["morning"]).includes(ch.value)));
    $("#cabitem-f-meal").value = c.meal || "any";
    $("#cabitem-f-status").value = c.status || "active";
    $("#cabitem-f-threshold").value = Number(c.threshold) || 0;
    $("#cabitem-f-note").value = c.note || "";
    $("#cabinet-modal").hidden = false;
  }
  async function saveCabinetDrug() {
    if (!editingCabId) { $("#cabinet-modal").hidden = true; return; }
    const id = editingCabId;
    editingCabId = null;
    $("#cabinet-modal").hidden = true;
    const slots = $$(".cabitem-f-slot").filter((ch) => ch.checked).map((ch) => ch.value);
    const patch = {
      unit: $("#cabitem-f-unit").value.trim() || "片",
      spec: $("#cabitem-f-spec").value.trim(),
      qty: Number($("#cabitem-f-qty").value) || 0,
      doseAmount: Number($("#cabitem-f-dose").value) || 0,
      doseUnit: $("#cabitem-f-doseunit").value.trim() || "片",
      timeSlots: slots.length ? slots : ["morning"],
      meal: $("#cabitem-f-meal").value,
      status: $("#cabitem-f-status").value,
      threshold: Number($("#cabitem-f-threshold").value) || 0,
      note: $("#cabitem-f-note").value.trim(),
      disease: $("#cabitem-f-disease").value.trim(),
    };
    await NurseStorage.updateCabinetDrug(id, patch);
    DATA = await NurseStorage.load();
    renderCabinet();
    renderHome();
  }

  // ===================== 药单 弹窗 =====================
  function openOrderModal(id, fromRecord) {
    editingOrderId = id || null;
    if (id) {
      const o = (DATA.orders || []).find((x) => x.id === id);
      if (!o) return;
      orderDraft = {
        source: o.source, date: o.date, kind: o.kind, recordId: o.recordId || "",
        fromRecord: !!fromRecord,
        medicines: (o.medicines || []).map((m) => ({ id: m.id, name: m.name, manufacturer: m.manufacturer, alias: m.alias, spec: m.spec, packCount: m.packCount, qty: m.qty, price: m.price, _full: null })),
      };
    } else {
      // 自建药单：若从问诊记录进入，自动关联
      orderDraft = {
        source: fromRecord && currentRecordId ? (findRecord(currentRecordId) || {}).hospital || "" : "",
        date: fromRecord && currentRecordId ? (findRecord(currentRecordId) || {}).visitDate || TODAY : TODAY,
        kind: fromRecord ? "hospital" : "custom",
        recordId: "",
        fromRecord: !!fromRecord,
        medicines: [],
      };
    }
    $("#order-modal-title").textContent = editingOrderId ? "编辑药单" : (fromRecord ? "添加药单（关联问诊）" : "自建药单");
    $("#order-f-source").value = orderDraft.source;
    $("#order-f-date").value = orderDraft.date;
    // 医院药单：来源与日期锁定（随问诊记录同步）；自建可改
    const locked = orderDraft.kind === "hospital";
    $("#order-f-source").disabled = locked;
    $("#order-f-date").disabled = locked;
    $("#order-hint").innerHTML = locked
      ? `<span class="hint">属性：来源 <b>${esc(orderDraft.source || "未填医院")}</b> · 日期 ${esc(orderDraft.date || TODAY)}（医院药单，随问诊记录自动同步）</span>`
      : "";
    renderOrderMeds();
    $("#order-modal").hidden = false;
    if (!locked) setTimeout(() => $("#order-f-source").focus(), 50);
  }
  function findRecord(id) {
    return (DATA.records || []).find((r) => r.id === id) || null;
  }
  function deleteMedSwipe(item) {
    const idx = +item.dataset.medIdx;
    if (isNaN(idx)) return;
    orderDraft.medicines.splice(idx, 1);
    renderOrderMeds();
    persistOrder();
  }
  function renderOrderMeds() {
    const box = $("#order-meds");
    if (!box) return;
    if (!orderDraft.medicines.length) {
      box.innerHTML = '<div class="empty-tip" style="padding:4px 0">暂无药品，点下方「＋ 添加药品」录入</div>';
      return;
    }
    const cabOf = (name) => (DATA.cabinet || []).find((c) => c.name === name) || null;
    box.innerHTML = orderDraft.medicines
      .map((m, i) => {
        const cab = cabOf(m.name);
        const meta = [
          m.manufacturer ? "厂家 " + m.manufacturer : "",
          m.alias && m.alias !== m.name ? "别名 " + m.alias : "",
          m.spec ? "规格 " + m.spec : "",
          m.packCount > 0 ? "药品数 " + m.packCount : "",
          "数量 " + (Number(m.qty) || 0),
          Number(m.price) > 0 ? "单价 " + m.price + " 元" : "",
          cab && cab.spec ? "单位规格 " + cab.spec : "",
          cab && cab.disease ? "针对 " + cab.disease : "",
          cab && cab.doseAmount ? "单次 " + cab.doseAmount + " " + (cab.doseUnit || "") : "",
          cab ? slotLabels(cab.timeSlots) : "",
        ].filter(Boolean).join(" · ");
        const st = cab ? drugStatus(cab) : "active";
        return `<div class="order-med swipe-item" data-med-idx="${i}" data-swipe>
          <div class="swipe-content order-med__main">
            <div class="order-med__name">${esc(m.name)} <span class="cab-status ${esc(st)}">${statusLabel(st)}</span></div>
            ${meta ? `<div class="order-med__meta">${esc(meta)}</div>` : ""}
          </div>
          <button class="swipe-del" data-swipe-del>删除</button>
        </div>`;
      })
      .join("");
    $$("#order-meds .order-med__main").forEach((el) => (el.onclick = () => openMedItemModal(+el.closest("[data-med-idx]").dataset.medIdx)));
  }
  async function persistOrder() {
    if (!orderDraft) return false;
    const source = $("#order-f-source").value.trim();
    if (!source) return false;
    const date = $("#order-f-date").value;
    const medicines = orderDraft.medicines.map((m) => ({ id: m.id, name: m.name, manufacturer: m.manufacturer, alias: m.alias, spec: m.spec, packCount: m.packCount, qty: m.qty, price: m.price }));
    const full = {};
    orderDraft.medicines.forEach((m) => { if (m._full) full[m.name] = m._full; });
    let recordId = orderDraft.recordId || "";
    let kind = orderDraft.kind;
    if (!editingOrderId && orderDraft.fromRecord && currentRecordId) {
      recordId = currentRecordId;
      kind = "hospital";
    }
    const item = { id: editingOrderId || undefined, source, date, kind, recordId, medicines, _full: full };
    const savedOrder = await NurseStorage.upsertOrder(item);
    if (!editingOrderId && savedOrder) editingOrderId = savedOrder.id;
    DATA = await NurseStorage.load();
    if (recordId && savedOrder && savedOrder.id) {
      const rec = (DATA.records || []).find((r) => r.id === recordId);
      if (rec && !rec.orderId) await NurseStorage.updateRecord(recordId, { orderId: savedOrder.id });
      DATA = await NurseStorage.load();
    }
    renderCabinet();
    renderHome();
    const latest = recordId ? (DATA.records || []).find((r) => r.id === recordId) : null;
    if (latest && !$("#record-view").hidden) showRecordView(latest);
    return true;
  }
  async function closeOrderModal() {
    const hasContent = !!orderDraft && ($("#order-f-source").value.trim() || orderDraft.medicines.length);
    $("#order-modal").hidden = true;
    if (hasContent) await persistOrder();
    editingOrderId = null;
  }

  // 药单内 药品条目 弹窗（药单只记 药名/厂家/别名/数量；新药可填全属性建档药箱）
  const MED_PICK_NEW = "__new__";
  function medPickOptions() {
    const map = {};
    (DATA.cabinet || []).forEach((c) => { if (c.name) map[c.name] = { name: c.name }; });
    (DATA.orders || []).forEach((o) => (o.medicines || []).forEach((m) => { if (m.name) map[m.name] = { name: m.name }; }));
    return Object.values(map);
  }
  let medItemMode = "pick"; // pick=选择/输入（4 字段） new=新药全属性 edit=编辑条目
  function setMedItemFull(visible) {
    const box = $("#meditem-full");
    if (box) box.hidden = !visible;
  }
  function parseSpecQty(spec) {
    if (!spec) return 0;
    const m = String(spec).match(/\*(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function parseSpecUnit(spec) {
    if (!spec) return "";
    return String(spec).split("*")[0].trim();
  }
  function openMedItemModal(idx) {
    editingMedIdx = idx;
    const m = idx >= 0 ? orderDraft.medicines[idx] || {} : {};
    const mIsNew = idx < 0;
    medItemMode = mIsNew ? "pick" : "edit";
    const opts = medPickOptions();
    $("#meditem-title").textContent = mIsNew ? "添加药品" : "编辑药品";
    $("#meditem-pick").hidden = !mIsNew;
    $("#meditem-pick").innerHTML =
      `<option value="">— 选择药箱已有药品 —</option>` +
      (mIsNew ? `<option value="${MED_PICK_NEW}">＋ 新药（完善药箱信息）</option>` : "") +
      opts.map((o) => `<option value="${esc(o.name)}">${esc(o.name)}${o.spec ? " " + esc(o.spec) : ""}</option>`).join("");
    $("#meditem-f-name").value = m.name || "";
    $("#meditem-f-name").disabled = !mIsNew; // 药名创建后不可修改
    $("#meditem-f-manufacturer").value = m.manufacturer || "";
    $("#meditem-f-alias").value = m.alias || "";
    $("#meditem-f-packspec").value = m.spec || "";
    $("#meditem-f-packcount").value = Number(m.packCount) || 0;
    $("#meditem-f-qty").value = Number(m.qty) || 0;
    $("#meditem-f-price").value = Number(m.price) || 0;
    // 全属性区（仅新药展开）
    if (mIsNew) {
      $("#meditem-f-unit").value = "片";
      $("#meditem-f-spec").value = "";
      $("#meditem-f-dose").value = 0;
      $("#meditem-f-doseunit").value = "片";
      $$(".meditem-f-slot").forEach((c) => (c.checked = c.value === "morning"));
      $("#meditem-f-meal").value = "any";
      $("#meditem-f-status").value = "active";
      $("#meditem-f-threshold").value = 7;
      $("#meditem-f-note").value = "";
      $("#meditem-f-disease").value = "";
    }
    setMedItemFull(mIsNew && $("#meditem-pick").value === MED_PICK_NEW);
    $("#med-item-modal").hidden = false;
    // 选择药品：已有药 → 4 字段引用；新药 → 展开全属性
    $("#meditem-pick").onchange = () => {
      const v = $("#meditem-pick").value;
      if (v === MED_PICK_NEW) {
        medItemMode = "new";
        $("#meditem-f-name").value = "";
        $("#meditem-f-name").disabled = false;
        $("#meditem-f-manufacturer").value = "";
        $("#meditem-f-alias").value = "";
        setMedItemFull(true);
        setTimeout(() => $("#meditem-f-name").focus(), 50);
        return;
      }
      medItemMode = "pick";
      setMedItemFull(false);
      if (!v) { $("#meditem-f-name").disabled = false; return; }
      const found = medPickOptions().find((o) => o.name === v);
      if (!found) return;
      const info = latestMedInfo(v);
      $("#meditem-f-name").value = found.name;
      $("#meditem-f-name").disabled = true;
      $("#meditem-f-manufacturer").value = info.manufacturer || "";
      $("#meditem-f-alias").value = info.alias || "";
      $("#meditem-f-packspec").value = info.spec || "";
      $("#meditem-f-packcount").value = 0;
      $("#meditem-f-qty").value = 0;
      $("#meditem-f-price").value = info.price || 0;
    };
    const updateQtyFromSpec = () => {
      const per = parseSpecQty($("#meditem-f-packspec").value.trim());
      const pc = Number($("#meditem-f-packcount").value) || 0;
      if (per > 0 && pc > 0) $("#meditem-f-qty").value = per * pc;
    };
    $("#meditem-f-packspec").oninput = updateQtyFromSpec;
    $("#meditem-f-packcount").oninput = updateQtyFromSpec;
    if (!$("#meditem-f-name").disabled) setTimeout(() => $("#meditem-f-name").focus(), 50);
  }
  function saveMedItem() {
    const name = $("#meditem-f-name").value.trim();
    if (!name) { toast("请填写药名"); return; }
    const packSpec = $("#meditem-f-packspec").value.trim();
    const packCount = Number($("#meditem-f-packcount").value) || 0;
    const per = parseSpecQty(packSpec);
    const item = {
      name,
      manufacturer: $("#meditem-f-manufacturer").value.trim(),
      alias: $("#meditem-f-alias").value.trim(),
      spec: packSpec,
      packCount,
      qty: (per > 0 && packCount > 0) ? per * packCount : (Number($("#meditem-f-qty").value) || 0),
      price: Number($("#meditem-f-price").value) || 0,
    };
    // 新药：收集药箱主属性
    if (medItemMode === "new") {
      const slots = $$(".meditem-f-slot").filter((c) => c.checked).map((c) => c.value);
      const fullSpec = $("#meditem-f-spec").value.trim() || parseSpecUnit(packSpec);
      item._full = {
        unit: $("#meditem-f-unit").value.trim() || "片",
        spec: fullSpec,
        doseAmount: Number($("#meditem-f-dose").value) || 0,
        doseUnit: $("#meditem-f-doseunit").value.trim() || "片",
        timeSlots: slots.length ? slots : ["morning"],
        meal: $("#meditem-f-meal").value,
        threshold: Number($("#meditem-f-threshold").value) || 7,
        status: $("#meditem-f-status").value,
        note: $("#meditem-f-note").value.trim(),
        disease: $("#meditem-f-disease").value.trim(),
      };
    }
    if (editingMedIdx >= 0) {
      const old = orderDraft.medicines[editingMedIdx] || {};
      item.id = old.id; // 保持条目 id（库存 diff 依据）
      orderDraft.medicines[editingMedIdx] = item;
    } else {
      orderDraft.medicines.push(item);
    }
    $("#med-item-modal").hidden = true;
    editingMedIdx = -1;
    medItemMode = "pick";
    renderOrderMeds();
    persistOrder();
  }
  function closeMedItemModal() {
    const name = $("#meditem-f-name").value.trim();
    if (name) { saveMedItem(); return; }
    $("#med-item-modal").hidden = true;
    editingMedIdx = -1;
    medItemMode = "pick";
  }

  // ===================== 检查报告 弹窗 =====================
  function openReportModal(id, fromRecord) {
    editingReportId = id || null;
    if (id) {
      const rp = (DATA.reports || []).find((x) => x.id === id);
      if (!rp) return;
      reportDraft = { title: rp.title, date: rp.date, kind: rp.kind, recordId: rp.recordId || "", fromRecord: !!fromRecord, indicators: (rp.indicators || []).map((x) => Object.assign({}, x)) };
    } else {
      reportDraft = {
        title: fromRecord && currentRecordId ? (findRecord(currentRecordId) || {}).hospital || "" : "自测",
        date: fromRecord && currentRecordId ? (findRecord(currentRecordId) || {}).visitDate || TODAY : TODAY,
        kind: fromRecord ? "hospital" : "self",
        recordId: "",
        fromRecord: !!fromRecord,
        indicators: [],
      };
    }
    $("#report-modal-title").textContent = editingReportId ? "编辑检查报告" : (fromRecord ? "添加检查报告（关联问诊）" : "添加自测报告");
    $("#report-f-title").value = reportDraft.title;
    $("#report-f-date").value = reportDraft.date;
    // 医院报告：标题与日期锁定（随问诊记录同步）；自测可改
    const locked = reportDraft.kind === "hospital";
    $("#report-f-title").disabled = locked;
    $("#report-f-date").disabled = locked;
    $("#report-hint").innerHTML = locked
      ? `<span class="hint">属性：标题 <b>${esc(reportDraft.title || "未填医院")}</b> · 日期 ${esc(reportDraft.date || TODAY)}（医院报告，随问诊记录自动同步）</span>`
      : "";
    renderReportIndicators();
    $("#report-modal").hidden = false;
    if (!locked) setTimeout(() => $("#report-f-title").focus(), 50);
  }
  function renderReportIndicators() {
    const tb = $("#report-table tbody");
    if (!tb) return;
    const meta = DATA.indicatorMeta || {};
    const allNames = new Set();
    (DATA.reports || []).forEach((rp) => (rp.indicators || []).forEach((ind) => { if (ind.name) allNames.add(ind.name); }));
    (DATA.followedIndicators || []).forEach((f) => { const n = typeof f === "string" ? f : f.name; if (n) allNames.add(n); });
    const dl = $("#report-ind-suggestions");
    if (dl) dl.innerHTML = Array.from(allNames).map((n) => `<option value="${esc(n)}">`).join("");
    tb.innerHTML = reportDraft.indicators
      .map((ind, i) => `<tr data-i="${i}">
        <td><input data-f="name" value="${esc(ind.name)}" placeholder="如：血糖" list="report-ind-suggestions"/></td>
        <td><input data-f="value" value="${esc(ind.value)}" placeholder="数值"/></td>
        <td><input data-f="unit" value="${esc(ind.unit)}" placeholder="如：mmol/L"/></td>
        <td><input data-f="range" value="${esc(ind.range)}" placeholder="参考范围"/></td>
        <td><input type="checkbox" data-f="abnormal" ${ind.abnormal ? "checked" : ""} title="异常"/></td>
        <td><button class="row-del" data-i="${i}">✕</button></td>
      </tr>`)
      .join("");
    // 同步表格内同名指标的单位/参考（修改一处 → 全部同步并记忆）
    const syncByName = (name, field, val) => {
      if (!name) return;
      $$("#report-table tbody tr").forEach((tr) => {
        const nameInp = tr.querySelector('[data-f="name"]');
        if (!nameInp || nameInp.value.trim() !== name) return;
        const target = tr.querySelector('[data-f="' + field + '"]');
        if (target && target.value !== val) target.value = val;
        const di = +tr.dataset.i;
        if (reportDraft.indicators[di]) reportDraft.indicators[di][field] = val;
      });
    };
    $$("#report-table tbody tr").forEach((tr) => {
      const i = +tr.dataset.i;
      $$('[data-f]', tr).forEach((inp) => {
        const f = inp.dataset.f;
        if (inp.type === "checkbox") {
          inp.onchange = () => (reportDraft.indicators[i][f] = inp.checked);
          return;
        }
        inp.oninput = () => {
          reportDraft.indicators[i][f] = inp.value;
          if (f === "name") {
            // 填过相同指标 → 直接填充单位与参考
            const m = meta[inp.value.trim()];
            if (m && (m.unit || m.range)) {
              if (m.unit) { inp.closest("tr").querySelector('[data-f="unit"]').value = m.unit; reportDraft.indicators[i].unit = m.unit; }
              if (m.range) { inp.closest("tr").querySelector('[data-f="range"]').value = m.range; reportDraft.indicators[i].range = m.range; }
            }
          }
          if (f === "unit" || f === "range") {
            // 修改任一指标单位/参考 → 同名指标全部同步
            const nm = tr.querySelector('[data-f="name"]').value.trim();
            syncByName(nm, f, inp.value);
          }
        };
      });
    });
    $$("#report-table .row-del").forEach((b) => (b.onclick = () => { reportDraft.indicators.splice(+b.dataset.i, 1); renderReportIndicators(); }));
  }
  async function saveReport() {
    const title = $("#report-f-title").value.trim();
    const date = $("#report-f-date").value;
    const indicators = reportDraft.indicators.filter((x) => x.name && String(x.name).trim());
    // 关联与属性：编辑保留原 recordId；新建时仅「从问诊记录进入」才关联（自测入口固定 self）
    let recordId = reportDraft.recordId || "";
    let kind = reportDraft.kind;
    if (!editingReportId && reportDraft.fromRecord && currentRecordId) {
      recordId = currentRecordId;
      kind = "hospital";
    }
    const item = { id: editingReportId || undefined, title: title || "检查报告", date, kind, recordId, indicators };
    const wasEdit = !!editingReportId;
    const savedReport = await NurseStorage.upsertReport(item);
    // 记忆指标单位/参考值（隐式维护；同名多行时非空优先，避免空值覆盖）
    const metaPatch = {};
    indicators.forEach((x) => {
      const nm = String(x.name).trim();
      if (!nm) return;
      const prev = metaPatch[nm] || { unit: "", range: "" };
      if (x.unit) prev.unit = x.unit;
      if (x.range) prev.range = x.range;
      if (prev.unit || prev.range) metaPatch[nm] = prev;
    });
    if (Object.keys(metaPatch).length) await NurseStorage.setIndicatorMeta(metaPatch);
    DATA = await NurseStorage.load();
    $("#report-modal").hidden = true;
    editingReportId = null;
    if (recordId && savedReport && savedReport.id) {
      const rec = (DATA.records || []).find((r) => r.id === recordId);
      if (rec && !rec.reportId) await NurseStorage.updateRecord(recordId, { reportId: savedReport.id });
      DATA = await NurseStorage.load();
      const latest = (DATA.records || []).find((r) => r.id === recordId);
      if (latest && !$("#record-view").hidden) showRecordView(latest);
    }
    renderRecords();
    renderCabinet();
    renderHome();
    toast(wasEdit ? "已保存检查报告" : "已添加检查报告并关联到问诊记录");
  }

  // ===================== 每日扣减（对药箱 cabinet 药品扣减） =====================
  async function runDailyDecrement() {
    const today = dateKey(new Date());
    const data = await NurseStorage.load();
    if (data.lastDecrement === today) { DATA.lastDecrement = today; return; }
    let changed = false;
    (data.cabinet || []).forEach((c) => {
      if (c.status !== "active") return;
      const dayDose = Number(c.doseAmount || 0) * (c.timeSlots || []).length;
      if (dayDose > 0 && Number(c.qty) > 0) {
        c.qty = Math.max(0, Math.round((Number(c.qty) - dayDose) * 100) / 100);
        if (Number(c.qty) <= 0) c.status = "out";
        changed = true;
      }
    });
    if (changed) { data.lastDecrement = today; await NurseStorage.save(data); DATA = data; }
    else { await NurseStorage.setLastDecrement(today); DATA.lastDecrement = today; }
  }

  // ===================== 提醒 / 设置 =====================
  function applyHomeTab() {
    $$(".home-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.htab === homeTab));
    $("#htab-remind").hidden = homeTab !== "remind";
    $("#htab-aidvice").hidden = homeTab !== "aidvice";
  }
  function switchHomeTab(tab) { homeTab = tab; applyHomeTab(); }

  function renderRemindersList() {
    const box = $("#reminders-list");
    if (!box) return;
    const rems = DATA.settings.reminders || [];
    $("#reminders-sub").textContent = rems.length ? rems.length + " 个" : "";
    if (!rems.length) { box.innerHTML = '<div class="empty-tip">还没有个人提醒。点「＋ 新增」添加就诊、复诊、复查等。</div>'; return; }
    box.innerHTML = rems
      .map((r) => `<div class="reminder-row ${r.enabled ? "" : "is-off"}" data-rem-id="${esc(r.id)}">
        <div class="reminder-row__main"><div class="reminder-row__title">${r.type === "visit" ? "🏥" : "📌"} ${esc(r.title)}</div>
        <div class="reminder-row__meta">${esc(r.date)}${r.time ? " " + esc(r.time) : ""}${r.enabled ? "" : " · 已停用"}</div></div>
        <div class="reminder-row__ops"><button class="icon-btn" data-rem-edit="${esc(r.id)}">✎</button><button class="icon-btn icon-btn--danger" data-rem-del="${esc(r.id)}">🗑</button></div>
      </div>`)
      .join("");
  }
  let editingReminderId = null;
  function openReminderModal(id) {
    editingReminderId = id || null;
    const r = id ? (DATA.settings.reminders || []).find((x) => x.id === id) : null;
    $("#reminder-modal-title").textContent = id ? "编辑提醒" : "新增提醒";
    $("#rem-title").value = r ? r.title : "";
    $("#rem-type").value = r ? r.type : "custom";
    $("#rem-date").value = r ? r.date : "";
    $("#rem-time").value = r ? r.time : "";
    $("#rem-enabled").checked = r ? r.enabled !== false : true;
    $("#reminder-modal").hidden = false;
  }
  async function saveReminder() {
    const title = $("#rem-title").value.trim();
    if (!title) { toast("请填写提醒名称"); return; }
    const data = await NurseStorage.load();
    const rems = data.settings.reminders || [];
    const payload = { title, type: $("#rem-type").value, date: $("#rem-date").value, time: $("#rem-time").value, enabled: $("#rem-enabled").checked };
    if (editingReminderId) { const i = rems.findIndex((x) => x.id === editingReminderId); if (i >= 0) rems[i] = Object.assign({}, rems[i], payload); }
    else rems.unshift(Object.assign({ id: "rem_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }, payload));
    await NurseStorage.updateSettings({ reminders: rems });
    DATA = await NurseStorage.load();
    $("#reminder-modal").hidden = true;
    renderRemindersList();
    renderHome();
    toast("已保存提醒");
  }
  async function deleteReminder(id) {
    if (!confirm("确定删除这条提醒？")) return;
    const data = await NurseStorage.load();
    data.settings.reminders = (data.settings.reminders || []).filter((x) => x.id !== id);
    await NurseStorage.save(data);
    DATA = await NurseStorage.load();
    renderRemindersList();
    renderHome();
    toast("已删除");
  }

  function renderAISummary() {
    const txt = $("#ai-summary-text");
    if (!txt) return;
    if (DATA.settings.ai.enabled) { txt.textContent = "已开启 · " + (DATA.settings.ai.model || "gpt-4o"); txt.classList.add("on"); }
    else { txt.textContent = "未开启（使用本地引擎）"; txt.classList.remove("on"); }
  }
  function openAIEdit() { $("#ai-summary").hidden = true; $("#ai-edit").hidden = false; }
  function closeAIEdit() { $("#ai-edit").hidden = true; $("#ai-summary").hidden = false; renderAISummary(); }
  async function saveAISettings() {
    await NurseStorage.updateSettings({ ai: { enabled: $("#ai-enabled").checked, baseUrl: $("#ai-baseurl").value.trim(), apiKey: $("#ai-key").value.trim(), model: $("#ai-model").value.trim() || "gpt-4o" } });
    DATA = await NurseStorage.load();
    $("#ai-fields").hidden = !DATA.settings.ai.enabled;
    toast("AI 设置已保存");
  }
  let timesModalStart = false;
  function openTimesModal(isStart) {
    timesModalStart = !!isStart;
    const rt = (DATA.settings && DATA.settings.reminderTimes) || {};
    $("#time-morning").value = rt.morning || "08:00";
    $("#time-noon").value = rt.noon || "12:30";
    $("#time-evening").value = rt.evening || "19:00";
    $("#times-modal-title").textContent = timesModalStart ? "开启用药提醒" : "用药提醒时间";
    $("#times-save").textContent = timesModalStart ? "开始提醒" : "保存";
    $("#times-modal").hidden = false;
  }
  function closeTimesModal() {
    $("#times-modal").hidden = true;
    if (timesModalStart) $("#opt-notify").checked = false;
    timesModalStart = false;
  }
  async function saveTimesModal() {
    const times = {
      morning: $("#time-morning").value || "08:00",
      noon: $("#time-noon").value || "12:30",
      evening: $("#time-evening").value || "19:00",
    };
    const patch = { reminderTimes: times };
    if (timesModalStart) patch.notifications = true;
    await NurseStorage.updateSettings(patch);
    DATA = await NurseStorage.load();
    $("#times-modal").hidden = true;
    timesModalStart = false;
    $("#opt-notify").checked = !!DATA.settings.notifications;
    applySettingsUI();
    renderHome();
    if (patch.notifications) {
      notifyNow(times);
      toast("用药提醒已开始");
    } else {
      toast("提醒时间已保存");
    }
  }
  async function toggleNotify() {
    const on = $("#opt-notify").checked;
    if (on) {
      const LN = getLocalNotif();
      if (LN) {
        try {
          const perm = await LN.requestPermissions();
          if (perm.display !== "granted") { $("#opt-notify").checked = false; toast("未授予通知权限，请在系统设置中开启"); return; }
        } catch (e) {}
      } else if ("Notification" in window && Notification.permission === "default") {
        try {
          const p = await Notification.requestPermission();
          if (p !== "granted") { $("#opt-notify").checked = false; toast("未授予通知权限"); return; }
        } catch (e) {}
      }
      openTimesModal(true);
    } else {
      await NurseStorage.updateSettings({ notifications: false });
      DATA = await NurseStorage.load();
      clearNotifTimers();
      await clearNotifScheduled();
      toast("已关闭通知");
    }
  }
  async function toggleLarge() {
    const on = $("#opt-large").checked;
    await NurseStorage.updateSettings({ largeFont: on });
    DATA = await NurseStorage.load();
    document.body.classList.toggle("large-font", on);
  }
  async function exportData() {
    const json = await NurseStorage.exportJSON();
    if (navigator.share) {
      try {
        const file = new File([json], "nurse-data-" + TODAY + ".json", { type: "application/json" });
        await navigator.share({ title: "Nurse · 健康档案备份", text: "存储到文件即可保存到 iCloud/本机。", files: [file] });
        toast("已调起分享，请选择「存储到文件」");
        return;
      } catch (e) { if (e && e.name === "AbortError") return; }
    }
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nurse-data-" + TODAY + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("已导出备份");
  }
  async function importData(file) {
    try {
      const text = await file.text();
      await NurseStorage.importJSON(text);
      DATA = await NurseStorage.load();
      applySettingsUI();
      renderHome();
      renderRecords();
      renderCabinet();
      toast("已导入并恢复");
    } catch (e) { toast("导入失败：文件格式不正确"); }
  }

  // ===================== 滑动删除（通用） =====================
  function attachSwipe(listEl, onDelete) {
    if (!listEl) return;
    const W = 76;
    let openItem = null;
    listEl.addEventListener("touchstart", (e) => {
      const item = e.target.closest("[data-swipe]");
      if (openItem && openItem !== item) { openItem.classList.remove("is-swiped"); openItem = null; }
      if (!item) return;
      item._sx = e.touches[0].clientX;
      item._sy = e.touches[0].clientY;
      item._dragging = false;
      item._swiped = item.classList.contains("is-swiped");
    }, { passive: true });
    listEl.addEventListener("touchmove", (e) => {
      const item = e.target.closest("[data-swipe]");
      if (!item) return;
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      const dx = x - item._sx, dy = y - item._sy;
      if (!item._dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) item._dragging = true;
      if (item._dragging) {
        if (e.cancelable) e.preventDefault();
        const cur = item._swiped ? -W + dx : dx;
        const t = Math.max(-W, Math.min(0, cur));
        const c = item.querySelector(".swipe-content");
        if (c) c.style.transform = "translateX(" + t + "px)";
      }
    }, { passive: false });
    listEl.addEventListener("touchend", (e) => {
      const item = e.target.closest("[data-swipe]");
      if (!item || !item._dragging) return;
      const dx = e.changedTouches ? e.changedTouches[0].clientX - item._sx : 0;
      if (dx <= -W / 2) { item.classList.add("is-swiped"); openItem = item; }
      else { item.classList.remove("is-swiped"); openItem = null; }
      const c = item.querySelector(".swipe-content");
      if (c) c.style.transform = "";
      item._dragging = false;
      item._suppress = true;
      setTimeout(() => { item._suppress = false; }, 350);
    });
    listEl.addEventListener("click", (e) => {
      const del = e.target.closest("[data-swipe-del]");
      const item = e.target.closest("[data-swipe]");
      if (del && item) { e.stopPropagation(); e.preventDefault(); onDelete(item); return; }
      if (item && item._suppress) { item._suppress = false; e.stopPropagation(); return; }
      if (item && item.classList.contains("is-swiped")) { item.classList.remove("is-swiped"); if (openItem === item) openItem = null; e.stopPropagation(); return; }
    }, true);
  }
  async function deleteRecordSwipe(item) {
    const id = item.dataset.recId;
    if (!id) return;
    if (confirm("确定删除这条问诊记录？此操作不可恢复。")) {
      await NurseStorage.deleteRecord(id);
      DATA = await NurseStorage.load();
      renderRecords();
      renderHome();
      toast("已删除");
    }
  }
  async function deleteAdviceSwipe(item) {
    const id = item.dataset.recId;
    if (!id) return;
    if (confirm("确定删除该 AI 医嘱？")) {
      const rec = (DATA.records || []).find((r) => r.id === id);
      if (rec) { rec.aiAdvice = null; await NurseStorage.updateRecord(id, { aiAdvice: null }); }
      DATA = await NurseStorage.load();
      renderHome();
      toast("已删除 AI 医嘱");
    }
  }
  async function deleteReportSwipe(item) {
    const id = item.dataset.reportId || item.dataset.id;
    if (!id) return;
    if (confirm("确定删除这条检查报告？")) {
      await NurseStorage.deleteReport(id);
      DATA = await NurseStorage.load();
      renderRecords();
      // 问诊详情页删除 → 刷新详情视图
      if (!$("#record-view").hidden && currentRecordId) {
        const latest = findRecord(currentRecordId);
        if (latest) showRecordView(latest);
      }
      toast("已删除");
    }
  }
  // 药单删除（药单列表 / 问诊详情页）：级联回退药箱库存并清理无引用药品
  async function deleteOrderSwipe(item) {
    const id = item.dataset.orderId || item.dataset.id;
    if (!id) return;
    if (confirm("确定删除这张药单？将同步回退药箱库存，无其他药单引用的药品会一并删除。")) {
      await NurseStorage.deleteOrder(id);
      DATA = await NurseStorage.load();
      renderCabinet();
      renderHome();
      if (!$("#record-view").hidden && currentRecordId) {
        const latest = findRecord(currentRecordId);
        if (latest) showRecordView(latest);
      }
      toast("已删除药单");
    }
  }
  // 药箱药品删除：库存不为 0 不能删除
  async function deleteCabinetSwipe(item) {
    const id = item.dataset.cabId;
    if (!id) return;
    const cab = (DATA.cabinet || []).find((c) => c.id === id);
    if (!cab) return;
    if (Number(cab.qty) > 0) { toast("库存不为 0，不能删除（请先清空库存）"); item.classList.remove("is-swiped"); return; }
    if (confirm("确定删除药箱药品「" + cab.name + "」？")) {
      await NurseStorage.deleteCabinetDrug(id);
      DATA = await NurseStorage.load();
      renderCabinet();
      renderHome();
      toast("已删除");
    }
  }

  async function deleteFollowSwipe(item) {
    const name = item.dataset.followEdit;
    if (!name) return;
    if (confirm("确定删除关注指标「" + name + "」？")) {
      DATA.followedIndicators = (DATA.followedIndicators || []).filter((f) => (typeof f === "string" ? f : f.name) !== name);
      await NurseStorage.setFollowedIndicators(DATA.followedIndicators);
      renderFollowListMe();
      renderExamTrend($("#exam-trend"));
      toast("已删除");
    }
  }

  // ===================== 子页签切换 + 左右滑动 =====================
  function switchRecordsTab(tab) {
    $$(".records-subtabs .home-tab").forEach((x) => x.classList.toggle("is-active", x.dataset.rtab === tab));
    renderRecords();
  }
  function switchCabinetTab(tab) {
    $$(".cab-subtabs .home-tab").forEach((x) => x.classList.toggle("is-active", x.dataset.ctab === tab));
    $("#cab-tab").hidden = tab !== "cab";
    $("#orders-tab").hidden = tab !== "orders";
    renderCabinet();
  }
  // 子页签区域左右滑动切换：容器内水平滑动 >60px 切上/下页签，stopPropagation 避免触发全局右滑返回
  function bindPaneSwipe(el, tabs) {
    if (!el) return;
    let sx = 0, sy = 0, tracking = false;
    el.addEventListener("touchstart", (e) => {
      if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
      const t = e.target;
      if (t.closest && t.closest("input, textarea, select, [data-swipe], .swipe-item, .table-wrap, .modal, .img-lightbox, .thumb")) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    el.addEventListener("touchend", (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = (e.changedTouches ? e.changedTouches[0].clientX : 0) - sx;
      const dy = (e.changedTouches ? e.changedTouches[0].clientY : 0) - sy;
      if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;
      const idx = tabs.findIndex((t) => t.isActive());
      if (idx < 0) return;
      const next = dx < 0 ? idx + 1 : idx - 1;
      if (next < 0 || next >= tabs.length) return;
      tabs[next].activate();
      e.stopPropagation();
    }, { passive: true });
  }
  function activeTabData(sel, attr) {
    const b = $(sel);
    return b ? b.dataset[attr] : "";
  }

  // ===================== 右滑返回 / 关闭弹窗 =====================
  const MODAL_IDS = ["ai-modal", "times-modal", "order-modal", "med-item-modal", "report-modal", "copy-pick-modal", "follow-modal", "reminder-modal", "cabinet-modal"];
  function closeTopModal() {
    for (let i = MODAL_IDS.length - 1; i >= 0; i--) {
      const id = MODAL_IDS[i];
      const m = document.getElementById(id);
      if (m && !m.hidden) {
        if (id === "ai-modal") { aiModalState = null; m.hidden = true; }
        else if (id === "times-modal") closeTimesModal();
        else if (id === "order-modal") closeOrderModal();
        else if (id === "med-item-modal") closeMedItemModal();
        else if (id === "cabinet-modal") saveCabinetDrug();
        else m.hidden = true;
        return true;
      }
    }
    return false;
  }
  function swipeBackAction() {
    if (!$("#img-lightbox").hidden) { closeLightbox(); return; }
    if (closeTopModal()) return;
    if (!$("#record-view").hidden) { closeView(); return; }
    if (!$("#exam-view").hidden) { $("#exam-view").hidden = true; goPage("records"); return; }
  }
  // 向下滑动关闭弹窗（所有底部弹窗通用）
  function setupModalSwipeDown() {
    MODAL_IDS.forEach((id) => {
      const modal = document.getElementById(id);
      if (!modal) return;
      const panel = modal.querySelector(".modal__panel");
      if (!panel) return;
      let sy = 0, dragging = false;
      panel.addEventListener("touchstart", (e) => {
        if (modal.hidden || e.touches.length !== 1) { dragging = false; return; }
        sy = e.touches[0].clientY;
        dragging = false;
      }, { passive: true });
      panel.addEventListener("touchmove", (e) => {
        if (modal.hidden) return;
        const dy = e.touches[0].clientY - sy;
        if (!dragging && dy > 8) {
          const body = panel.querySelector(".modal__body");
          if (!body || body.scrollTop === 0) dragging = true;
        }
        if (dragging) {
          if (e.cancelable) e.preventDefault();
          panel.style.transition = "none";
          panel.style.transform = "translateY(" + Math.max(0, dy) + "px)";
        }
      }, { passive: false });
      panel.addEventListener("touchend", (e) => {
        if (!dragging) return;
        const dy = (e.changedTouches ? e.changedTouches[0].clientY : 0) - sy;
        dragging = false;
        if (dy > 100) {
          panel.style.transition = "transform 0.18s ease";
          panel.style.transform = "translateY(110%)";
          setTimeout(() => { panel.style.transform = ""; panel.style.transition = ""; closeTopModal(); }, 180);
        } else {
          panel.style.transition = "transform 0.18s ease";
          panel.style.transform = "translateY(0)";
          setTimeout(() => { panel.style.transform = ""; panel.style.transition = ""; }, 200);
        }
      });
    });
  }
  function setupSwipeBack() {
    let sx = 0, sy = 0, tracking = false;
    document.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
        const t = e.target;
        if (t.closest && t.closest("input, textarea, select, .swipe, .table-wrap")) { tracking = false; return; }
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        tracking = true;
      },
      { passive: true }
    );
    document.addEventListener(
      "touchend",
      (e) => {
        if (!tracking) return;
        tracking = false;
        const dx = (e.changedTouches ? e.changedTouches[0].clientX : 0) - sx;
        const dy = (e.changedTouches ? e.changedTouches[0].clientY : 0) - sy;
        if (dx > 80 && Math.abs(dy) < 60) swipeBackAction();
      },
      { passive: true }
    );
  }

  // ===================== 事件绑定 =====================
  function bindEvents() {
    $$(".tabbar__btn").forEach((b) => (b.onclick = () => goPage(b.dataset.page)));
    $$("[data-close]").forEach((el) => (el.onclick = () => closeTopModal()));

    // 首页页签
    $$(".home-tab").forEach((b) => (b.onclick = () => switchHomeTab(b.dataset.htab)));
    $("#home-aidvice").onclick = (e) => { const c = e.target.closest(".aidvice-card"); if (c) openRecord(c.dataset.recId); };
    $("#home-meds-blocks").onclick = async (e) => {
      const head = e.target.closest(".med-block__head");
      if (head && head.dataset.slot) {
        const slot = head.dataset.slot;
        if (homeExpandedSlots.has(slot)) homeExpandedSlots.delete(slot);
        else homeExpandedSlots.add(slot);
        const done = await NurseStorage.getDone(TODAY);
        renderMedBlocks(done);
        return;
      }
      const med = e.target.closest(".med");
      if (med) toggleMed(med.dataset.medId, med.dataset.slot);
    };

    // 问诊记录
    $("#btn-add-record").onclick = () => openRecord(null);
    $$(".records-subtabs .home-tab").forEach((b) => (b.onclick = () => switchRecordsTab(b.dataset.rtab)));
    $("#records-list").onclick = (e) => { const c = e.target.closest(".rec-card"); if (c) openRecord(c.dataset.recId); };
    $("#record-back").onclick = () => closeView();
    $("#exam-back").onclick = () => { $$(".view").forEach((v) => (v.hidden = true)); goPage("records"); };

    // 检查结果：添加自测报告 / 关注
    $("#btn-add-report").onclick = () => openReportModal(null);
    $("#exam-list").addEventListener("click", (e) => {
      const c = e.target.closest(".exam-entry");
      if (c) openReportModal(c.dataset.reportId);
    });


    // 关注指标 管理（标题右侧齿轮）
    $("#follow-manage-btn").onclick = () => openFollowModal();
    $("#follow-add").onclick = addFollowIndicator;
    $("#follow-done").onclick = () => { $("#follow-modal").hidden = true; followEditing = null; renderFollowListMe(); renderExamTrend($("#exam-trend")); };
    $("#follow-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addFollowIndicator(); });
    attachSwipe($("#follow-list-me"), deleteFollowSwipe);
    $("#follow-list-me").addEventListener("click", (e) => {
      const item = e.target.closest("[data-follow-edit]");
      if (item) openFollowModal(item.dataset.followEdit);
    });

    // 药箱 / 药单
    $$(".cab-subtabs .home-tab").forEach((b) => (b.onclick = () => switchCabinetTab(b.dataset.ctab)));
    // 子页签左右滑动切换（首页/问诊/药箱）
    bindPaneSwipe($("#home-tabs"), [
      { isActive: () => homeTab === "remind", activate: () => switchHomeTab("remind") },
      { isActive: () => homeTab === "aidvice", activate: () => switchHomeTab("aidvice") },
    ]);
    bindPaneSwipe($("#page-records"), [
      { isActive: () => activeTabData(".records-subtabs .home-tab.is-active", "rtab") === "list", activate: () => switchRecordsTab("list") },
      { isActive: () => activeTabData(".records-subtabs .home-tab.is-active", "rtab") === "exam", activate: () => switchRecordsTab("exam") },
    ]);
    bindPaneSwipe($("#page-cabinet"), [
      { isActive: () => activeTabData(".cab-subtabs .home-tab.is-active", "ctab") === "cab", activate: () => switchCabinetTab("cab") },
      { isActive: () => activeTabData(".cab-subtabs .home-tab.is-active", "ctab") === "orders", activate: () => switchCabinetTab("orders") },
    ]);
    $$(".cab-filter").forEach((b) => (b.onclick = () => { cabinetState.filter = b.dataset.filter; $$(".cab-filter").forEach((x) => x.classList.toggle("is-active", x === b)); renderCabinetSummary(); }));
    $("#btn-add-order").onclick = () => openOrderModal(null);
    // 药箱药品：点击进编辑
    $("#cabinet-list").addEventListener("click", (e) => {
      const c = e.target.closest(".cab-item");
      if (c) openCabinetModal(c.dataset.cabId);
    });
    // 药单卡片：点击进编辑
    $("#orders-list").addEventListener("click", (e) => {
      const c = e.target.closest(".order-card");
      if (c) openOrderModal(c.dataset.orderId);
    });

    // 药单弹窗
    $("#order-med-add").onclick = () => openMedItemModal(-1);
    $("#order-f-source").onchange = () => persistOrder();
    $("#order-f-date").onchange = () => persistOrder();

    // 药品条目弹窗
    $("#meditem-save").onclick = saveMedItem;
    $("#img-lightbox").addEventListener("click", closeLightbox);
    $("#med-item-modal").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") saveMedItem(); });

    // 检查报告弹窗
    $("#report-ind-add").onclick = () => { reportDraft.indicators.push({ name: "", value: "", unit: "", range: "", abnormal: false }); renderReportIndicators(); };
    $("#report-save").onclick = saveReport;
    $("#report-cancel").onclick = () => { $("#report-modal").hidden = true; editingReportId = null; };

    // 列表滑动删除
    attachSwipe($("#records-list"), deleteRecordSwipe);
    attachSwipe($("#home-aidvice"), deleteAdviceSwipe);
    attachSwipe($("#exam-list"), deleteReportSwipe);
    attachSwipe($("#orders-list"), deleteOrderSwipe);
    attachSwipe($("#cabinet-list"), deleteCabinetSwipe);
    attachSwipe($("#order-meds"), deleteMedSwipe);

    // 设置
    $("#ai-enabled").onchange = saveAISettings;
    ["#ai-baseurl", "#ai-model", "#ai-key"].forEach((s) => ($(s).onchange = saveAISettings));
    $("#opt-notify").onchange = toggleNotify;
    $("#opt-large").onchange = toggleLarge;
    $("#times-save").onclick = saveTimesModal;
    $("#times-cancel").onclick = closeTimesModal;
    $$("#times-modal [data-close-times]").forEach((el) => (el.onclick = closeTimesModal));
    $("#ai-edit-btn").onclick = openAIEdit;
    $("#ai-done-btn").onclick = () => { saveAISettings(); closeAIEdit(); };
    $("#btn-add-reminder").onclick = () => openReminderModal(null);
    $("#reminders-list").onclick = (e) => { const ed = e.target.closest("[data-rem-edit]"); const del = e.target.closest("[data-rem-del]"); if (ed) openReminderModal(ed.dataset.remEdit); else if (del) deleteReminder(del.dataset.remDel); };
    $("#rem-save").onclick = saveReminder;
    $("#rem-cancel").onclick = () => ($("#reminder-modal").hidden = true);
    $("#btn-export").onclick = exportData;
    $("#btn-import").onclick = () => $("#import-file").click();
    $("#import-file").onchange = (e) => { if (e.target.files && e.target.files[0]) importData(e.target.files[0]); e.target.value = ""; };
  }

  // ===================== 检查结果 整页趋势视图 =====================
  let examViewIndex = 0;
  let examViewSeries = [];
  let trendTabIndex = 0;
  function openExamView(idx) {
    const followed = (DATA.followedIndicators || []).map((f) => typeof f === "string" ? f : f.name);
    examViewSeries = collectSeries().filter((s) => followed.includes(s.name));
    examViewSeries.sort((a, b) => {
      const fa = followed.indexOf(a.name);
      const fb = followed.indexOf(b.name);
      return (fa < 0 ? 999 : fa) - (fb < 0 ? 999 : fb);
    });
    examViewIndex = (typeof idx === "number" && idx >= 0 && idx < examViewSeries.length) ? idx : 0;
    $$(".view").forEach((v) => (v.hidden = true));
    $$(".page").forEach((p) => (p.hidden = true));
    $("#exam-view").hidden = false;
    renderExamView();
  }
  function renderExamView() {
    if (!examViewSeries.length) { $("#exam-view").hidden = true; goPage("records"); return; }
    const s = examViewSeries[examViewIndex];
    const chart = s.points.length >= 2 ? svgLineChart(s) : singlePoint(s);
    const latest = s.points[s.points.length - 1];
    $("#exam-view .view-header__sub").textContent = s.name;
    $("#exam-trend-full").innerHTML = `<div class="trend-card is-followed">
      <div class="trend-card__head"><b>${esc(s.name)}</b><span class="trend-star">⭐</span></div>
      <div class="trend-card__val"><span>${esc(latest.value + " " + (s.unit || ""))}</span>${latest.abnormal ? " ⚠️" : ""}<span class="trend-card__date">${esc((latest.date || "").slice(5))}</span></div>
      ${chart}
    </div>`;
    $("#exam-list-full").innerHTML = `<div class="exam-view-swipe">${s.points.map((p) => `<div class="exam-pt ${p.abnormal ? "is-bad" : ""}"><div class="exam-pt__date">${esc(p.date || "")}</div><div class="exam-pt__val">${esc(p.value + " " + (s.unit || ""))}</div>${p.abnormal ? '<span class="tag tag--bad">异常</span>' : ""}</div>`).join("")}</div>`;
  }
  function renderExamTrendFull() {
    if (!$("#exam-view").hidden) renderExamView();
  }

  // 启动
  const boot = () => init().catch((e) => { toast("初始化失败：" + ((e && e.message) || e)); console.error("[nurse] init failed:", e); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
