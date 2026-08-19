/*
 * 私人护士 · 前端交互逻辑（v3 redesign）
 * 四页 Tab：首页 / 问诊记录 / 我的药箱 / 我的
 * 药箱管理「药品（药款）+ 多厂家规格变体」；首页用药提醒按 早/中/晚 分组；
 * 问诊记录支持医院/医生/医嘱(录音)/检查结果/处方药，AI 分析与医嘱分析。
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
  let editingDrugId = null;
  let recDraft = null; // 编辑问诊记录时的草稿
  let currentRecordId = null;
  let currentCabId = null;
  let aiModalState = null; // { rec, data, type }

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

  // ===================== 初始化 =====================
  async function init() {
    DATA = await NurseStorage.load();
    DATA.cabinet = DATA.cabinet || [];
    DATA.records = DATA.records || [];
    DATA.examResults = DATA.examResults || [];
    applySettingsUI();
    bindEvents();
    setupSwipeBack();
    await runDailyDecrement();
    renderHome();
    renderRecords();
    renderCabinet();
    setHeader("私人护士", "");
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
    const rt = s.reminderTimes || {};
    const bt = $("#btn-times");
    if (bt) bt.textContent = "早 " + (rt.morning || "08:00") + " · 中 " + (rt.noon || "12:30") + " · 晚 " + (rt.evening || "19:00");
    renderAISummary();
    renderRemindersList();
  }

  // ===================== 页面路由 =====================
  function goPage(page) {
    $$(".page").forEach((p) => (p.hidden = p.id !== "page-" + page));
    $$(".tabbar__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.page === page));
    $$(".view").forEach((v) => (v.hidden = true));
    if (page === "home") {
      setHeader("私人护士", "");
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

  // 药箱告警（缺药 / 库存不足）
  function renderHomeAlerts() {
    const box = $("#home-alerts");
    if (!box) return;
    const items = [];
    for (const d of DATA.cabinet || []) {
      if (d.status === "out" || (d.status === "active" && d.threshold > 0 && Number(d.qty) <= d.threshold)) {
        items.push({
          out: d.status === "out",
          text: "💊 " + d.name + (d.manufacturer ? "（" + d.manufacturer + "）" : "") + (d.status === "out" ? "：已缺药" : "：库存不足（剩 " + d.qty + " " + d.unit + "）"),
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

  // 用药提醒：按 早/中/晚 分组，各时段可独立点击展开/收起
  function renderMedBlocks(done) {
    const box = $("#home-meds-blocks");
    if (!box) return;
    const drugs = (DATA.cabinet || []).filter((d) => d.status === "active");
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
          const stock = sumStock(d);
          return `<div class="med ${isDone ? "done" : ""}" data-med-id="${esc(d.id)}" data-slot="${slot.key}">
            <div class="med__check">${isDone ? "✓" : ""}</div>
            <div class="med__main">
              <div class="med__name">${esc(d.name)}</div>
              <div class="med__meta">${esc(d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "")}${d.meal !== "any" ? " · " + mealLabel(d.meal) : ""} · 余 ${stock}</div>
            </div>
          </div>`;
        })
        .join("");
      return `<div class="med-block">${head}<div class="med-block__body">${rows}</div></div>`;
    }).join("");
    box.innerHTML = html;
    $("#home-meds-count").textContent = total + " 项";
  }
  function sumStock(d) {
    return Number(d.qty) || 0;
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

  // 首页 AI 医嘱页签：一次问诊记录对应一次医嘱分析（按记录展示，可点击打开）
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

  // 用药提醒通知：按设置好的早/中/晚时间排程（去重，避免重复通知）
  let notifTimers = [];
  function clearNotifTimers() {
    notifTimers.forEach((t) => clearTimeout(t));
    notifTimers = [];
  }
  function scheduleNotifications(done) {
    clearNotifTimers();
    if (!DATA.settings.notifications) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const now = Date.now();
    for (const d of DATA.cabinet || []) {
      if (d.status !== "active") continue;
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
            try {
              new Notification("私人护士 · 用药提醒", { body: (dose ? dose + " " : "") + d.name });
            } catch (e) {}
          }, diff)
        );
      }
    }
  }
  // 立即发送一条通知（开启提醒时确认链路已通）
  function notifyNow(times) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("私人护士 · 用药提醒已开启", {
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
          const hasImg = (rec.examImages && rec.examImages.length) || (rec.rxImages && rec.rxImages.length) || (rec.images && rec.images.length);
          const badges = (rec.archived ? '<span class="rec-card__badge badge-arch">已归档</span>' : '<span class="rec-card__badge badge-unarch">未归档</span>') + (hasImg ? '<span class="rec-card__badge badge-img">📷</span>' : "");
          return `<div class="rec-card swipe-item" data-rec-id="${esc(rec.id)}" data-swipe>
            <div class="swipe-content">
              <div class="rec-card__top">
                <span class="rec-card__date">${esc(title)}</span>
                <span>${badges}</span>
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
    renderExamFollow($("#exam-follow"));
    renderExamList($("#exam-list"));
    examEmpty.hidden = (DATA.examResults || []).length > 0;
    applyRecordsTab();
  }

  // 跟随当前激活的子页签，统一控制「列表 / 检查结果面板 / 新增按钮」的显隐
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

  // 问诊详情 = 可编辑视图（点击列表直接进入，无需编辑按钮）
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

  // ---- 编辑表单（即问诊详情：直接可编辑） ----
  function renderRecordEdit(rec) {
    recDraft = {
      adviceText: (rec && rec.advice && rec.advice.text) || "",
      audio: (rec && rec.advice && rec.advice.audio) || null,
      examImages: (rec && rec.examImages ? rec.examImages.slice() : []),
      examTable: (rec && rec.examTable ? rec.examTable.slice() : []),
      rxImages: (rec && rec.rxImages ? rec.rxImages.slice() : []),
      rxTable: (rec && rec.rxTable ? rec.rxTable.slice() : []),
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
            <button type="button" class="btn btn-ghost" id="rec-mic">🎙 录音</button>
            <button type="button" class="btn btn-ghost" id="rec-audio-file">📁 上传录音</button>
            <input type="file" id="rec-audio-input" accept="audio/*" hidden />
          </div>
          <div id="rec-audio-preview"></div>
        </div>

        <div class="detail-sec"><h3>🧪 检查结果</h3>
          <button type="button" class="btn btn-ghost" id="rec-exam-img">📷 导入图片</button>
          <input type="file" id="rec-exam-input" accept="image/*" multiple hidden />
          <div id="rec-exam-thumbs" class="thumb-grid"></div>
          <div class="table-wrap" style="margin-top:8px"><table class="edit-table" id="rec-exam-table">
            <thead><tr><th>指标</th><th>数值</th><th>单位</th><th>参考</th><th>异常</th><th></th></tr></thead>
            <tbody></tbody>
          </table></div>
          <button type="button" class="btn btn-ghost btn-sm" id="rec-exam-add">＋ 添加指标</button>
        </div>

        <div class="detail-sec"><h3>💊 处方药</h3>
          <button type="button" class="btn btn-ghost" id="rec-rx-img">📷 导入图片</button>
          <input type="file" id="rec-rx-input" accept="image/*" multiple hidden />
          <div id="rec-rx-thumbs" class="thumb-grid"></div>
          <div id="rec-rx-list" class="rx-list"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="rec-rx-add">＋ 添加药品</button>
        </div>

        <div class="arch-status ${r.archived ? "is-on" : ""}">${r.archived ? "✅ 已归档：检查结果已计入趋势与明细" : "⚪ 未归档：点下方「归档」后，检查结果才会计入趋势与明细"}</div>
        <div class="detail-actions">
          <button class="btn btn-primary block" id="rec-save">💾 保存</button>
          <button class="btn btn-primary block" id="rec-archive">📦 归档（更新检查趋势）</button>
          ${aiOn ? `<button class="btn btn-ghost block" id="rec-ai-analyze">🤖 AI 分析</button><button class="btn btn-ghost block" id="rec-advice-analyze">💡 医嘱分析</button>` : ""}
          <button class="btn btn-ghost block" id="rec-cancel">返回</button>
        </div>
      </div>`;
  }

  function renderDraftThumbs() {
    $("#rec-exam-thumbs").innerHTML = recDraft.examImages.map((im, i) => `<div class="thumb"><img src="${im.dataUrl}"/><button class="thumb__del" data-kind="exam" data-idx="${i}">✕</button></div>`).join("");
    $("#rec-rx-thumbs").innerHTML = recDraft.rxImages.map((im, i) => `<div class="thumb"><img src="${im.dataUrl}"/><button class="thumb__del" data-kind="rx" data-idx="${i}">✕</button></div>`).join("");
    const ap = $("#rec-audio-preview");
    if (ap) ap.innerHTML = recDraft.audio ? `<div class="audio-card">🎵 ${esc(recDraft.audio.name)} <button class="thumb__del" id="rec-audio-del">✕</button><br/><audio controls src="${recDraft.audio.dataUrl}" style="width:100%"></audio></div>` : "";
    $$("#rec-exam-thumbs .thumb__del").forEach((b) => (b.onclick = () => { recDraft.examImages.splice(+b.dataset.idx, 1); renderDraftThumbs(); }));
    $$("#rec-rx-thumbs .thumb__del").forEach((b) => (b.onclick = () => { recDraft.rxImages.splice(+b.dataset.idx, 1); renderDraftThumbs(); }));
    const adel = $("#rec-audio-del");
    if (adel) adel.onclick = () => { recDraft.audio = null; renderDraftThumbs(); };
    renderExamRows();
    renderRxCards();
  }
  function renderExamRows() {
    const tb = $("#rec-exam-table tbody");
    if (!tb) return;
    tb.innerHTML = recDraft.examTable
      .map(
        (e, i) => `<tr data-i="${i}">
        <td><input data-f="name" value="${esc(e.name)}"/></td>
        <td><input data-f="value" value="${esc(e.value)}"/></td>
        <td><input data-f="unit" value="${esc(e.unit)}"/></td>
        <td><input data-f="range" value="${esc(e.range)}"/></td>
        <td><input type="checkbox" data-f="abnormal" ${e.abnormal ? "checked" : ""}/></td>
        <td><button class="row-del" data-i="${i}">✕</button></td>
      </tr>`
      )
      .join("");
    $$("#rec-exam-table tbody tr").forEach((tr) => {
      const i = +tr.dataset.i;
      $$('[data-f]', tr).forEach((inp) => {
        const f = inp.dataset.f;
        if (inp.type === "checkbox") inp.onchange = () => (recDraft.examTable[i][f] = inp.checked);
        else inp.oninput = () => (recDraft.examTable[i][f] = inp.value);
      });
    });
    $$("#rec-exam-table .row-del").forEach((b) => (b.onclick = () => { recDraft.examTable.splice(+b.dataset.i, 1); renderExamRows(); }));
  }
  // 处方药：卡片列表（点卡片编辑，✕ 删除）
  function renderRxCards() {
    const box = $("#rec-rx-list");
    if (!box) return;
    if (!recDraft.rxTable.length) {
      box.innerHTML = '<div class="empty-tip" style="padding:4px 0">暂无处方药，点下方「＋ 添加药品」录入</div>';
      return;
    }
    box.innerHTML = recDraft.rxTable
      .map((m, i) => {
        const meta = [
          m.manufacturer ? "厂家 " + m.manufacturer : "",
          m.alias && m.alias !== m.name ? "别名 " + m.alias : "",
          m.spec ? "规格 " + m.spec : "",
          m.dose,
          m.freq,
          m.time,
        ].filter(Boolean).join(" · ");
        return `<div class="rx-card" data-rx-idx="${i}">
          <div class="rx-card__main">
            <div class="rx-card__name">${esc(m.name)}</div>
            ${meta ? `<div class="rx-card__meta">${esc(meta)}</div>` : ""}
          </div>
          <button type="button" class="rx-card__del" data-rx-del="${i}">✕</button>
        </div>`;
      })
      .join("");
    $$("#rec-rx-list .rx-card").forEach((c) => (c.onclick = (e) => { if (e.target.closest("[data-rx-del]")) return; openRxModal(+c.dataset.rxIdx); }));
    $$("#rec-rx-list [data-rx-del]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); recDraft.rxTable.splice(+b.dataset.rxDel, 1); renderRxCards(); }));
  }

  // 处方药 添加/编辑 弹窗（药名/厂家/别名/规格/剂量/频次/时间）
  const RX_FIELDS = ["name", "manufacturer", "alias", "spec", "dose", "freq", "time"];
  let rxEditIdx = -1;
  function openRxModal(idx) {
    if (!recDraft) return;
    rxEditIdx = typeof idx === "number" ? idx : -1;
    const m = rxEditIdx >= 0 ? recDraft.rxTable[rxEditIdx] || {} : {};
    $("#rx-modal-title").textContent = rxEditIdx >= 0 ? "编辑药品" : "添加药品";
    RX_FIELDS.forEach((k) => ($("#rx-f-" + k).value = m[k] || ""));
    $("#rx-modal").hidden = false;
    setTimeout(() => $("#rx-f-name").focus(), 50);
  }
  function closeRxModal() {
    $("#rx-modal").hidden = true;
    rxEditIdx = -1;
  }
  function saveRxModal() {
    if (!recDraft) return;
    const name = $("#rx-f-name").value.trim();
    if (!name) { toast("请填写药名"); return; }
    const item = { name, note: "" };
    RX_FIELDS.filter((k) => k !== "name").forEach((k) => (item[k] = $("#rx-f-" + k).value.trim()));
    if (rxEditIdx >= 0) recDraft.rxTable[rxEditIdx] = item;
    else recDraft.rxTable.push(item);
    closeRxModal();
    renderRxCards();
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
    $("#rec-exam-img").onclick = () => $("#rec-exam-input").click();
    $("#rec-exam-input").onchange = (e) => { if (e.target.files) addImagesToDraft(e.target.files, "exam"); e.target.value = ""; };
    $("#rec-rx-img").onclick = () => $("#rec-rx-input").click();
    $("#rec-rx-input").onchange = (e) => { if (e.target.files) addImagesToDraft(e.target.files, "rx"); e.target.value = ""; };
    $("#rec-exam-add").onclick = () => { recDraft.examTable.push({ name: "", value: "", unit: "", range: "", abnormal: false }); renderExamRows(); };
    $("#rec-rx-add").onclick = () => openRxModal(-1);
    $("#rec-save").onclick = () => saveRecordEdit(rec);
    $("#rec-cancel").onclick = () => closeView();
    // 归档：先保存，再把检查结果并入全局趋势/明细
    $("#rec-archive").onclick = () => archiveRecordFlow(rec);
    // AI 分析 / 医嘱分析：先静默保存当前编辑，再基于最新数据分析
    const aiBtn = $("#rec-ai-analyze");
    if (aiBtn) aiBtn.onclick = async () => { const saved = await saveRecordEdit(rec, { silent: true }); if (saved) runAIAnalyze(saved); };
    const advBtn = $("#rec-advice-analyze");
    if (advBtn) advBtn.onclick = async () => { const saved = await saveRecordEdit(rec, { silent: true }); if (saved) runAdviceAnalyze(saved); };
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
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const d = await downscaleImage(f, 1280, 0.82);
      (kind === "exam" ? recDraft.examImages : recDraft.rxImages).push({ name: f.name, type: "image/jpeg", dataUrl: d });
    }
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

  let recMic = null, recMicOn = false;
  function startRecMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("当前设备不支持语音输入，请直接输入文字或上传录音文件"); return; }
    const btn = $("#rec-mic");
    if (recMicOn) { try { recMic.stop(); } catch (e) {} return; }
    const r = new SR();
    r.lang = "zh-CN"; r.interimResults = true; r.continuous = true;
    recMic = r; recMicOn = true; btn.classList.add("recording");
    r.onresult = (e) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; const ta = $("#rec-f-advice"); ta.value = (recDraft.adviceText ? recDraft.adviceText + " " : "") + t; recDraft.adviceText = ta.value; };
    r.onend = () => { recMicOn = false; btn.classList.remove("recording"); };
    r.onerror = () => { recMicOn = false; btn.classList.remove("recording"); };
    try { r.start(); } catch (e) { recMicOn = false; btn.classList.remove("recording"); }
  }

  // 保存（silent=true 时不关闭视图、不提示，用于归档/AI 分析前的暂存）
  async function saveRecordEdit(rec, opts) {
    opts = opts || {};
    const payload = {
      hospital: $("#rec-f-hospital").value.trim(),
      visitDate: $("#rec-f-date").value,
      doctor: $("#rec-f-doctor").value.trim(),
      advice: { text: recDraft.adviceText.trim(), audio: recDraft.audio },
      examImages: recDraft.examImages,
      examTable: recDraft.examTable.filter((e) => e.name && e.name.trim()),
      rxImages: recDraft.rxImages,
      rxTable: recDraft.rxTable.filter((m) => m.name && m.name.trim()),
    };
    let saved;
    if (rec) {
      saved = await NurseStorage.updateRecord(rec.id, payload);
    } else {
      saved = await NurseStorage.appendRecord(Object.assign({ source: "text", transcript: payload.advice.text, images: [], manual: true, status: "done" }, payload));
      currentRecordId = saved.id;
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

  // 归档：保存本次编辑，并把检查结果并入全局「检查结果」趋势与明细
  async function archiveRecordFlow(rec) {
    const saved = await saveRecordEdit(rec, { silent: true });
    if (!saved) return;
    const inds = (saved.examTable || []).filter((e) => e.name && String(e.name).trim());
    if (inds.length) {
      await NurseStorage.upsertExamEntry({ id: "ex_" + saved.id, recordId: saved.id, hospital: saved.hospital, date: saved.visitDate || TODAY, indicators: inds });
    } else {
      // 本次无检查指标：移除该记录旧归档数据，避免趋势残留
      await NurseStorage.deleteExamEntry("ex_" + saved.id);
    }
    await NurseStorage.updateRecord(saved.id, { archived: true });
    DATA = await NurseStorage.load();
    closeView();
    renderRecords();
    renderHome();
    toast(inds.length ? "已归档：检查结果已更新到趋势与明细" : "已归档（本次无检查指标，未生成趋势数据）");
  }

  // ---- AI 分析 ----
  async function runAIAnalyze(rec) {
    toast("AI 分析中…");
    try {
      const res = await NurseAI.analyzeConsult({
        settings: DATA.settings,
        adviceText: rec.advice && rec.advice.text,
        examImages: rec.examImages || [],
        rxImages: rec.rxImages || [],
      });
      aiModalState = { rec, data: res, type: "consult" };
      openAIModal();
    } catch (e) {
      toast("AI 分析失败：" + (e && e.message ? e.message : e));
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
        <div class="table-wrap"><table class="edit-table" id="ai-rx-t"><thead><tr><th>药名</th><th>规格</th><th>剂量</th><th>频次</th><th>时间</th><th></th></tr></thead><tbody></tbody></table></div>
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
      { cell: (r) => `<input data-f="dose" value="${esc(r.dose)}"/>` },
      { cell: (r) => `<input data-f="freq" value="${esc(r.freq)}"/>` },
      { cell: (r) => `<input data-f="time" value="${esc(r.time)}"/>` },
    ];
    renderT("#ai-exam-t", data.examResults, examFields);
    renderT("#ai-rx-t", data.prescription, rxFields);
    $("#ai-exam-add").onclick = () => { data.examResults.push({ name: "", value: "", unit: "", range: "", abnormal: false }); renderT("#ai-exam-t", data.examResults, examFields); };
    $("#ai-rx-add").onclick = () => { data.prescription.push({ name: "", spec: "", dose: "", freq: "", time: "" }); renderT("#ai-rx-t", data.prescription, rxFields); };
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
        dose: row.querySelector('[data-f="dose"]').value.trim(),
        freq: row.querySelector('[data-f="freq"]').value.trim(),
        time: row.querySelector('[data-f="time"]').value.trim(),
        note: "",
      }))
      .filter((x) => x.name);
    const adviceText = $("#ai-advice").value.trim();
    // 写回记录（检查结果不自动归档，由用户点「归档」更新趋势/明细）
    rec.advice = { text: adviceText, audio: rec.advice ? rec.advice.audio : null };
    rec.examTable = examResults;
    rec.rxTable = prescription;
    rec.result = rec.result || {};
    rec.result.medications = prescription.map((m) => ({ name: m.name, dose: m.dose || m.spec, freq: m.freq, time: m.time, note: m.note, disease: "" }));
    // 同步处方药到药箱
    await syncRxToCabinet(prescription, rec);
    await NurseStorage.updateRecord(rec.id, { advice: rec.advice, examTable: rec.examTable, rxTable: rec.rxTable, result: rec.result });
    DATA = await NurseStorage.load();
    aiModalState = null;
    $("#ai-modal").hidden = true;
    // 留在可编辑详情，便于继续点「归档」更新检查趋势
    const latest = (DATA.records || []).find((r) => r.id === rec.id);
    if (latest) showRecordView(latest);
    else closeView();
    renderRecords();
    renderHome();
    toast("已保存：医嘱 / 处方药 / 药箱已同步（点「归档」可更新检查趋势）");
  }
  async function syncRxToCabinet(rxList, rec) {
    for (const m of rxList) {
      if (!m.name) continue;
      const names = (DATA.cabinet || []).map((d) => ({ d, ns: NurseStorage.drugNames(d) }));
      const found = names.find((x) => x.ns.some((n) => n === m.name));
      const doseNum = parseFloat(m.dose);
      if (found) {
        // 仅更新用法，不影响厂家 / 库存 / 状态等直接属性
        await NurseStorage.updateDrug(found.d.id, {
          doseAmount: doseNum > 0 ? doseNum : found.d.doseAmount,
          doseUnit: m.dose.replace(/^[0-9.]+/, "").trim() || found.d.doseUnit || "片",
          timeSlots: found.d.timeSlots && found.d.timeSlots.length ? found.d.timeSlots : ["morning"],
          status: "active",
        });
      } else {
        await NurseStorage.upsertDrug({
          name: m.name,
          disease: "",
          doseAmount: doseNum > 0 ? doseNum : 0,
          doseUnit: m.dose.replace(/^[0-9.]+/, "").trim() || "片",
          timeSlots: ["morning"],
          meal: "any",
          manufacturer: m.manufacturer || "",
          alias: m.alias || "",
          qty: 0,
          unit: "片",
          status: "active",
          dailyDose: 0,
          threshold: 7,
          intro: "",
          precautions: [],
          advice: "",
          note: rec && rec.hospital ? "来源：" + rec.hospital : "",
          history: [],
        });
      }
    }
  }

  // ---- 医嘱分析 ----
  async function runAdviceAnalyze(rec) {
    toast("医嘱分析中…");
    const ctx = buildAdviceContext(rec);
    try {
      const res = await NurseAI.analyzeAdvice({ settings: DATA.settings, context: ctx });
      aiModalState = { rec, data: res, type: "advice" };
      openAdviceModal();
    } catch (e) {
      toast("医嘱分析失败：" + (e && e.message ? e.message : e));
    }
  }
  function buildAdviceContext(rec) {
    let s = "【本次医生医嘱】\n";
    s += rec.advice && rec.advice.text ? rec.advice.text + "\n" : "（无文字医嘱）\n";
    if (rec.rxTable && rec.rxTable.length) s += "处方药：" + rec.rxTable.map((m) => m.name + (m.dose ? " " + m.dose : "") + (m.time ? " " + m.time : "")).join("；") + "\n";
    if (rec.examTable && rec.examTable.length) s += "本次检查：" + rec.examTable.map((e) => e.name + " " + e.value + e.unit + (e.abnormal ? "(异常)" : "")).join("；") + "\n";
    s += "\n【历次检查指标趋势】\n";
    const map = {};
    (DATA.examResults || []).forEach((e) => (e.indicators || []).forEach((ind) => { (map[ind.name] = map[ind.name] || []).push({ date: e.date, value: ind.value, unit: ind.unit, abnormal: ind.abnormal }); }));
    const keys = Object.keys(map);
    if (!keys.length) s += "（暂无历史检查数据）\n";
    else
      keys.slice(0, 10).forEach((k) => {
        const pts = map[k].sort((a, b) => (a.date < b.date ? -1 : 1));
        s += k + "：" + pts.map((p) => p.date + " " + p.value + (p.abnormal ? "↑" : "")).join(" → ") + "\n";
      });
    s += "\n【当前用药】\n";
    const active = (DATA.cabinet || []).filter((d) => d.status === "active");
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

  function closeView() {
    $$(".view").forEach((v) => (v.hidden = true));
    goPage("records");
  }

  // ===================== 检查结果趋势 =====================
  function collectSeries() {
    const map = {};
    (DATA.examResults || []).forEach((e) => {
      (e.indicators || []).forEach((ind) => {
        const v = parseFloat(ind.value);
        if (isNaN(v)) return;
        (map[ind.name] = map[ind.name] || []).push({ date: e.date || "", value: v, unit: ind.unit, abnormal: ind.abnormal });
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
    const series = collectSeries();
    if (!series.length) {
      el.innerHTML = '<div class="empty-tip">暂无趋势数据。</div>';
      return;
    }
    const followed = DATA.followedIndicators || [];
    // 关注指标排前面
    series.sort((a, b) => {
      const fa = followed.includes(a.name) ? 0 : 1;
      const fb = followed.includes(b.name) ? 0 : 1;
      return fa - fb;
    });
    el.innerHTML = series
      .map((s) => {
        const isF = followed.includes(s.name);
        const chart = s.points.length >= 2 ? svgLineChart(s) : singlePoint(s);
        const latest = s.points[s.points.length - 1];
        return `<div class="trend-card ${isF ? "is-followed" : ""}">
          <div class="trend-card__head"><b>${esc(s.name)}</b>
            <button class="trend-follow ${isF ? "is-on" : ""}" data-ind="${esc(s.name)}">${isF ? "★ 已关注" : "☆ 关注"}</button>
          </div>
          <div class="trend-card__val"><span>${esc(latest.value + " " + (s.unit || ""))}</span>${latest.abnormal ? " ⚠️" : ""}<span class="trend-card__date">${esc((latest.date || "").slice(5))}</span></div>
          ${chart}
        </div>`;
      })
      .join("");
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
  function renderExamFollow(el) {
    if (!el) return;
    const followed = DATA.followedIndicators || [];
    if (!followed.length) {
      el.innerHTML = '<div class="empty-tip">还没有关注指标。在上方趋势图中点击「☆ 关注」即可将指标置顶，并显示其最新检查结果。</div>';
      return;
    }
    const series = collectSeries();
    const byName = {};
    series.forEach((s) => (byName[s.name] = s));
    el.innerHTML = followed
      .map((name) => {
        const s = byName[name];
        if (!s) return `<div class="follow-chip"><span class="follow-chip__name">${esc(name)}</span><span class="follow-chip__val">暂无数据</span></div>`;
        const latest = s.points[s.points.length - 1];
        return `<div class="follow-chip">
          <span class="follow-chip__name">${esc(name)}</span>
          <span class="follow-chip__val"><b>${esc(latest.value + " " + (s.unit || ""))}</b>${latest.abnormal ? " ⚠️" : ""}</span>
          <span class="follow-chip__date">${esc(latest.date || "")}</span>
        </div>`;
      })
      .join("");
  }
  function renderExamList(el) {
    if (!el) return;
    const entries = (DATA.examResults || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!entries.length) { el.innerHTML = ""; return; }
    el.innerHTML = entries
      .map((e) => `<div class="exam-entry swipe-item" data-exam-id="${esc(e.id)}" data-swipe>
        <div class="swipe-content">
          <div class="exam-entry__head"><b>${esc(e.date || "")}</b>${e.hospital ? " · " + esc(e.hospital) : ""}</div>
          <div class="exam-entry__inds">${(e.indicators || []).map((i) => `<span class="exam-chip ${i.abnormal ? "is-bad" : ""}">${esc(i.name)} ${esc(i.value)}${esc(i.unit || "")}</span>`).join("")}</div>
        </div>
        <button class="swipe-del" data-swipe-del>删除</button>
      </div>`)
      .join("");
  }

  // ===================== 我的药箱 =====================
  function drugStatus(d) {
    if (d.status === "disabled") return "disabled";
    if (d.status === "out" || Number(d.qty) <= 0) return "out";
    return "active";
  }
  function statusLabel(s) {
    return s === "active" ? "使用中" : s === "disabled" ? "停用" : "缺药";
  }

  function renderCabinet() {
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
        const meta = [
          d.manufacturer ? "厂家 " + d.manufacturer : "",
          d.alias && d.alias !== d.name ? "别名 " + d.alias : "",
          "库存 " + (Number(d.qty) || 0) + " " + (d.unit || "片"),
          "阈值 " + (Number(d.threshold) || 0),
        ].filter(Boolean).join(" · ");
        return `<div class="cab-item ${esc(drugStatus(d))} swipe-item" data-cab-id="${esc(d.id)}" data-swipe>
          <div class="swipe-content">
            <div class="cab-item__top">
              <div>
                <div class="cab-item__name">${esc(d.name)}</div>
                ${d.disease ? `<div class="cab-item__disease">🩺 ${esc(d.disease)}</div>` : ""}
                <div class="cab-item__spec">单次 ${esc(d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "—")} · ${slotLabels(d.timeSlots)} · ${mealLabel(d.meal)}</div>
                <div class="cab-item__meta2">${esc(meta)}</div>
              </div>
              <span class="cab-status ${esc(drugStatus(d))}">${statusLabel(drugStatus(d))}</span>
            </div>
            ${(d.history && d.history.length) ? `<div class="cab-item__history">📚 历史 ${d.history.length} 条（曾用其他厂家）</div>` : ""}
          </div>
          <button class="swipe-del" data-swipe-del>删除</button>
        </div>`;
      })
      .join("");
  }

  function openCabinetDetail(id) {
    const d = (DATA.cabinet || []).find((x) => x.id === id);
    if (!d) return;
    currentCabId = id;
    const body = $("#cab-view-body");
    const historyHtml = d.history && d.history.length
      ? `<div class="cab-detail__sec"><h4>📚 历史药品（曾用其他厂家）</h4>${d.history
          .map(
            (h) => `<div class="history-row">
          <div class="history-row__head"><b>${esc(h.manufacturer || "未填厂家")}</b>${h.spec ? `<span>规格 ${esc(h.spec)}</span>` : ""}${h.alias && h.alias !== d.name ? `<span>别名 ${esc(h.alias)}</span>` : ""}</div>
          <div class="history-row__meta">${h.doseUnit ? "单位剂量 " + esc(h.doseUnit) : ""}${h.note ? (h.doseUnit ? " · " : "") + esc(h.note) : ""}</div>
        </div>`
          )
          .join("")}</div>`
      : "";
    body.innerHTML = `
      <div class="cab-detail__head"><div><div class="cab-detail__title">${esc(d.name)}</div>${d.disease ? `<div class="cab-detail__spec">🩺 ${esc(d.disease)}</div>` : ""}</div></div>
      <div class="cab-detail__sec"><h4>💊 用法</h4><p>单次 <b>${esc(d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "—")}</b> · 时段 ${slotLabels(d.timeSlots)} · ${mealLabel(d.meal)}</p></div>
      <div class="cab-detail__sec"><h4>🏭 厂家 / 别名</h4><p>${esc(d.manufacturer || "未填厂家")}${d.alias && d.alias !== d.name ? " · 别名 " + esc(d.alias) : ""}</p></div>
      <div class="cab-detail__sec"><h4>📦 库存 / 状态</h4><p>库存 <b>${esc((Number(d.qty) || 0) + " " + (d.unit || "片"))}</b> · 状态 ${statusLabel(d.status)} · 每日消耗 ${Number(d.dailyDose) || 0} · 阈值 ${Number(d.threshold) || 0}</p></div>
      ${d.intro ? `<div class="cab-detail__sec"><h4>📖 药品介绍</h4><p>${esc(d.intro)}</p></div>` : ""}
      ${d.precautions && d.precautions.length ? `<div class="cab-detail__sec"><h4>⚠️ 注意事项</h4><ul>${d.precautions.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
      ${d.advice ? `<div class="cab-detail__sec"><h4>💡 个人用药建议</h4><p>${esc(d.advice)}</p></div>` : ""}
      ${d.note ? `<div class="cab-detail__sec"><h4>📝 备注</h4><p>${esc(d.note)}</p></div>` : ""}
      ${historyHtml}
      <div class="cab-detail__actions">
        <button class="btn btn-primary" id="cab-edit-btn">编辑</button>
      </div>`;
    $("#cab-view-title").textContent = "药品详情";
    $$(".view").forEach((v) => (v.hidden = true));
    $$(".page").forEach((p) => (p.hidden = true));
    $("#cab-view").hidden = false;
    $("#cab-edit-btn").onclick = () => openCabinetEdit(id);
    // 删除统一走列表左滑确认
  }

  function openCabinetEdit(id) {
    const isNew = !id;
    editingDrugId = id || null;
    const d = isNew ? { name: "", disease: "", doseAmount: 0, doseUnit: "片", timeSlots: ["morning"], meal: "any", manufacturer: "", alias: "", qty: 0, unit: "片", status: "active", dailyDose: 0, threshold: 7, intro: "", precautions: [], advice: "", note: "", history: [] } : (DATA.cabinet || []).find((x) => x.id === id) || {};
    formHistory = (d.history || []).map((h) => ({ manufacturer: (h.manufacturer || ""), spec: (h.spec || ""), alias: (h.alias || ""), doseUnit: (h.doseUnit || "片"), note: (h.note || "") }));
    $("#cab-modal-title").textContent = isNew ? "添加药品" : "编辑药品";
    const precautions = (d.precautions || []).map((p, i) => `<span class="cab-edit__tag">${esc(p)} <button type="button" data-rm-prec="${i}">✕</button></span>`).join("");
    // 历史药品改为弹窗录入（见 formHistory / hist-modal）
    $("#cab-body").innerHTML = `
      <div class="cab-edit__field"><span>药品名称 *</span><input type="text" id="cab-f-name" value="${esc(d.name)}" placeholder="如：苯磺酸氨氯地平片"/></div>
      <div class="cab-edit__field"><span>针对病症</span><input type="text" id="cab-f-disease" placeholder="如：高血压、糖尿病（逗号分隔）" value="${esc(d.disease)}"/></div>
      <div class="cab-edit__row">
        <div class="cab-edit__field"><span>单次用量</span><input type="number" id="cab-f-dose" value="${Number(d.doseAmount) || 0}" step="0.5"/></div>
        <div class="cab-edit__field"><span>单位</span><input type="text" id="cab-f-doseunit" value="${esc(d.doseUnit || "片")}"/></div>
      </div>
      <div class="cab-edit__field"><span>服用时段</span>
        <div class="chk-row">
          <label><input type="checkbox" class="cab-f-slot" value="morning" ${(d.timeSlots || []).includes("morning") ? "checked" : ""}/> 早</label>
          <label><input type="checkbox" class="cab-f-slot" value="noon" ${(d.timeSlots || []).includes("noon") ? "checked" : ""}/> 中</label>
          <label><input type="checkbox" class="cab-f-slot" value="evening" ${(d.timeSlots || []).includes("evening") ? "checked" : ""}/> 晚</label>
        </div>
      </div>
      <div class="cab-edit__field"><span>餐次</span>
        <select id="cab-f-meal"><option value="any" ${d.meal === "any" ? "selected" : ""}>不限</option><option value="before" ${d.meal === "before" ? "selected" : ""}>餐前</option><option value="after" ${d.meal === "after" ? "selected" : ""}>餐后</option></select>
      </div>
      <div class="cab-edit__field"><span>厂家</span><input type="text" id="cab-f-manufacturer" value="${esc(d.manufacturer)}" placeholder="如：辉瑞"/></div>
      <div class="cab-edit__field"><span>别名 / 俗称</span><input type="text" id="cab-f-alias" value="${esc(d.alias)}" placeholder="如：络活喜"/></div>
      <div class="cab-edit__row">
        <div class="cab-edit__field"><span>当前库存</span><input type="number" id="cab-f-qty" value="${Number(d.qty) || 0}"/></div>
        <div class="cab-edit__field"><span>单位剂量</span><input type="text" id="cab-f-unit" value="${esc(d.unit || "片")}"/></div>
      </div>
      <div class="cab-edit__field"><span>状态</span>
        <select id="cab-f-status"><option value="active" ${d.status === "active" ? "selected" : ""}>使用中</option><option value="disabled" ${d.status === "disabled" ? "selected" : ""}>停用</option><option value="out" ${d.status === "out" ? "selected" : ""}>缺药</option></select>
      </div>
      <div class="cab-edit__row">
        <div class="cab-edit__field"><span>每日消耗</span><input type="number" id="cab-f-dailydose" value="${Number(d.dailyDose) || 0}" step="0.5"/></div>
        <div class="cab-edit__field"><span>库存阈值</span><input type="number" id="cab-f-threshold" value="${Number(d.threshold) || 0}"/></div>
      </div>
      <div class="cab-edit__field"><span>药品介绍</span><textarea id="cab-f-intro" placeholder="简单介绍该药品作用">${esc(d.intro)}</textarea></div>
      <div class="cab-edit__field"><span>注意事项</span>
        <div class="cab-edit__tags" id="cab-f-prec-tags">${precautions}</div>
        <div style="display:flex;gap:8px;margin-top:6px"><input type="text" id="cab-f-prec-input" placeholder="输入后点击添加" style="flex:1"/><button type="button" class="btn btn-ghost" id="cab-f-prec-add">添加</button></div>
      </div>
      <div class="cab-edit__field"><span>针对个人用药建议</span><textarea id="cab-f-advice" placeholder="结合个人病情给出用药建议">${esc(d.advice)}</textarea></div>
      <div class="cab-edit__field"><span>备注</span><input type="text" id="cab-f-note" value="${esc(d.note)}" placeholder="其他备注"/></div>
      <div class="cab-edit__field"><span>历史药品（曾用其他厂家，可选）</span>
        <div id="cab-history" class="cab-history-chips"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="cab-history-add">＋ 添加历史药品</button>
      </div>
      <button class="btn btn-primary block" id="cab-f-save">${isNew ? "添加" : "保存"}</button>`;
    $("#cab-modal").hidden = false;
    renderHistoryChips();
    bindCabinetForm();
  }

  let formPrecautions = [];
  let formHistory = [];
  function bindCabinetForm() {
    formPrecautions = [];
    $$("#cab-f-prec-tags .cab-edit__tag").forEach((t) => { const x = t.textContent.replace(/✕\s*$/, "").trim(); if (x) formPrecautions.push(x); });
    const renderTags = () => {
      $("#cab-f-prec-tags").innerHTML = formPrecautions.map((p, i) => `<span class="cab-edit__tag">${esc(p)} <button type="button" data-rm-prec="${i}">✕</button></span>`).join("");
      $$("#cab-f-prec-tags [data-rm-prec]").forEach((b) => (b.onclick = () => { formPrecautions.splice(+b.dataset.rmPrec, 1); renderTags(); }));
    };
    renderTags();
    $("#cab-f-prec-add").onclick = () => { const i = $("#cab-f-prec-input"); if (i.value.trim()) { formPrecautions.push(i.value.trim()); i.value = ""; renderTags(); } };
    $("#cab-history-add").onclick = () => openHistModal();
    $("#hist-save").onclick = () => {
      formHistory.push({
        manufacturer: $("#hist-f-manufacturer").value.trim(),
        spec: $("#hist-f-spec").value.trim(),
        alias: $("#hist-f-alias").value.trim(),
        doseUnit: $("#hist-f-doseunit").value.trim() || "片",
        note: $("#hist-f-note").value.trim(),
      });
      renderHistoryChips();
      closeHistModal();
    };
    $("#hist-cancel").onclick = closeHistModal;
    $("#cab-f-save").onclick = saveCabinetDrug;
  }

  async function saveCabinetDrug() {
    const name = $("#cab-f-name").value.trim();
    if (!name) { toast("请填写药品名称"); return; }
    const prev = editingDrugId ? (DATA.cabinet || []).find((x) => x.id === editingDrugId) : null;
    const newManufacturer = $("#cab-f-manufacturer").value.trim();
    const history = formHistory.map((h) => ({
      manufacturer: h.manufacturer,
      spec: h.spec,
      alias: h.alias,
      doseUnit: h.doseUnit,
      note: h.note,
    }));
    // 编辑时若更换厂家，将原厂家自动归入历史药品
    if (prev) {
      const oldM = (prev.manufacturer || "").trim();
      if (oldM && oldM !== newManufacturer) {
        history.unshift({
          manufacturer: oldM,
          spec: prev.spec || "",
          alias: prev.alias || "",
          doseUnit: prev.unit || "片",
          note: "由编辑更换厂家自动归档",
        });
      }
    }
    const item = {
      id: editingDrugId || undefined,
      name,
      disease: $("#cab-f-disease").value.trim(),
      doseAmount: Number($("#cab-f-dose").value) || 0,
      doseUnit: $("#cab-f-doseunit").value.trim() || "片",
      timeSlots: $$(".cab-f-slot").filter((c) => c.checked).map((c) => c.value),
      meal: $("#cab-f-meal").value,
      manufacturer: newManufacturer,
      alias: $("#cab-f-alias").value.trim(),
      qty: Number($("#cab-f-qty").value) || 0,
      unit: $("#cab-f-unit").value.trim() || "片",
      status: $("#cab-f-status").value,
      dailyDose: Number($("#cab-f-dailydose").value) || 0,
      threshold: Number($("#cab-f-threshold").value) || 0,
      intro: $("#cab-f-intro").value.trim(),
      precautions: formPrecautions,
      advice: $("#cab-f-advice").value.trim(),
      note: $("#cab-f-note").value.trim(),
      history,
    };
    await NurseStorage.upsertDrug(item);
    DATA = await NurseStorage.load();
    $("#cab-modal").hidden = true;
    renderCabinet();
    if (currentCabId && !$("#cab-view").hidden) openCabinetDetail(currentCabId);
    toast(editingDrugId ? "已保存" : "已添加");
    editingDrugId = null;
  }

  function renderHistoryChips() {
    const box = $("#cab-history");
    if (!box) return;
    if (!formHistory.length) { box.innerHTML = '<div class="empty-tip" style="padding:4px 0">暂无历史药品</div>'; return; }
    box.innerHTML = formHistory
      .map((h, i) => `<div class="cab-history-chip"><span>${esc((h.manufacturer || "未填厂家") + (h.alias && h.alias !== h.manufacturer ? "（" + h.alias + "）" : "") + (h.doseUnit ? " · " + h.doseUnit : ""))}</span><button type="button" class="cab-history-chip__del" data-hi="${i}">✕</button></div>`)
      .join("");
    $$("#cab-history .cab-history-chip__del").forEach((b) => (b.onclick = () => { formHistory.splice(+b.dataset.hi, 1); renderHistoryChips(); }));
  }
  function openHistModal() {
    $("#hist-f-manufacturer").value = "";
    $("#hist-f-spec").value = "";
    $("#hist-f-alias").value = "";
    $("#hist-f-doseunit").value = "片";
    $("#hist-f-note").value = "";
    $("#hist-modal").hidden = false;
    $("#hist-f-manufacturer").focus();
  }
  function closeHistModal() { $("#hist-modal").hidden = true; }

  // ===================== 每日扣减 =====================
  async function runDailyDecrement() {
    const today = dateKey(new Date());
    const data = await NurseStorage.load();
    if (data.lastDecrement === today) { DATA.lastDecrement = today; return; }
    let changed = false;
    for (const d of data.cabinet) {
      if (d.status !== "active") continue;
      if (d.dailyDose > 0 && Number(d.qty) > 0) {
        d.qty = Math.max(0, Math.round((Number(d.qty) - d.dailyDose) * 100) / 100);
        if (Number(d.qty) <= 0) d.status = "out";
        changed = true;
      }
    }
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
  // ---- 用药提醒时间（早/中/晚）弹窗 ----
  let timesModalStart = false; // true=从「开启提醒」进入（保存即开始并立即通知）
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
    // 「开始提醒」流程中取消：开关回退，不开启
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
      if ("Notification" in window && Notification.permission === "default") {
        try {
          const p = await Notification.requestPermission();
          if (p !== "granted") { $("#opt-notify").checked = false; toast("未授予通知权限"); return; }
        } catch (e) {}
      }
      // 开启后弹窗设置 早/中/晚 提醒时间，点「开始提醒」即开启并立即通知
      openTimesModal(true);
    } else {
      await NurseStorage.updateSettings({ notifications: false });
      DATA = await NurseStorage.load();
      clearNotifTimers();
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
        await navigator.share({ title: "私人护士 · 健康档案备份", text: "存储到文件即可保存到 iCloud/本机。", files: [file] });
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
  async function deleteCabinetSwipe(item) {
    const id = item.dataset.cabId;
    if (!id) return;
    if (confirm("确定删除该药品（含历史药品）？")) {
      await NurseStorage.deleteDrug(id);
      DATA = await NurseStorage.load();
      renderCabinet();
      toast("已删除");
    }
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
  async function deleteExamSwipe(item) {
    const id = item.dataset.examId;
    if (!id) return;
    if (confirm("确定删除这条检查结果？")) {
      await NurseStorage.deleteExamEntry(id);
      DATA = await NurseStorage.load();
      renderRecords();
      toast("已删除");
    }
  }

  // ===================== 右滑返回 / 关闭弹窗 =====================
  // 屏幕右滑：优先关闭最上层弹窗，其次返回上一视图
  function swipeBackAction() {
    // 1. 最上层弹窗
    const modals = ["ai-modal", "times-modal", "rx-modal", "hist-modal", "cab-modal", "reminder-modal"];
    for (const id of modals) {
      const m = document.getElementById(id);
      if (m && !m.hidden) {
        if (id === "ai-modal") aiModalState = null;
        if (id === "times-modal") closeTimesModal();
        else m.hidden = true;
        return;
      }
    }
    // 2. 整页视图 → 返回
    if (!$("#record-view").hidden) { closeView(); return; }
    if (!$("#exam-view").hidden) { $("#exam-view").hidden = true; goPage("records"); return; }
    if (!$("#cab-view").hidden) { $("#cab-view").hidden = true; goPage("cabinet"); return; }
  }
  function setupSwipeBack() {
    let sx = 0, sy = 0, tracking = false;
    document.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
        const t = e.target;
        // 输入控件 / 横向滚动区内不触发，避免干扰输入与左右滑动切换
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
    $$("[data-close]").forEach((el) => (el.onclick = () => { const k = el.dataset.close; if (k === "ai") { aiModalState = null; } $("#" + k + "-modal").hidden = true; if (k === "cab") cabinetState.editing = null; }));

    // 首页页签
    $$(".home-tab").forEach((b) => (b.onclick = () => switchHomeTab(b.dataset.htab)));
    // 首页 AI 医嘱卡片 -> 打开对应问诊记录
    $("#home-aidvice").onclick = (e) => { const c = e.target.closest(".aidvice-card"); if (c) openRecord(c.dataset.recId); };
    // 用药提醒时段折叠（各时段独立展开/收起）
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
    $$(".records-subtabs .home-tab").forEach((b) => (b.onclick = () => {
      $$(".records-subtabs .home-tab").forEach((x) => x.classList.toggle("is-active", x === b));
      renderRecords();
    }));
    $("#records-list").onclick = (e) => { const c = e.target.closest(".rec-card"); if (c) openRecord(c.dataset.recId); };
    $("#record-back").onclick = () => closeView();
    $("#exam-back").onclick = () => { $$(".view").forEach((v) => (v.hidden = true)); goPage("records"); };
    // 检查结果趋势：关注 / 取消关注
    $("#exam-trend").addEventListener("click", async (e) => {
      const btn = e.target.closest(".trend-follow");
      if (!btn) return;
      const name = btn.dataset.ind;
      const set = new Set(DATA.followedIndicators || []);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      DATA.followedIndicators = Array.from(set);
      await NurseStorage.setFollowedIndicators(DATA.followedIndicators);
      renderExamTrend($("#exam-trend"));
      renderExamFollow($("#exam-follow"));
    });

    // 药箱
    $$(".cab-filter").forEach((b) => (b.onclick = () => { cabinetState.filter = b.dataset.filter; $$(".cab-filter").forEach((x) => x.classList.toggle("is-active", x === b)); renderCabinet(); }));
    $("#btn-add-cab").onclick = () => openCabinetEdit(null);
    $("#cabinet-list").onclick = (e) => { const c = e.target.closest(".cab-item"); if (c) openCabinetEdit(c.dataset.cabId); };
    attachSwipe($("#cabinet-list"), deleteCabinetSwipe);
    attachSwipe($("#records-list"), deleteRecordSwipe);
    attachSwipe($("#home-aidvice"), deleteAdviceSwipe);
    attachSwipe($("#exam-list"), deleteExamSwipe);
    $("#cab-view-back").onclick = () => { $("#cab-view").hidden = true; goPage("cabinet"); };

    // 设置
    $("#ai-enabled").onchange = saveAISettings;
    ["#ai-baseurl", "#ai-model", "#ai-key"].forEach((s) => ($(s).onchange = saveAISettings));
    $("#opt-notify").onchange = toggleNotify;
    $("#opt-large").onchange = toggleLarge;
    $("#btn-times").onclick = () => openTimesModal(false);
    $("#times-save").onclick = saveTimesModal;
    $("#times-cancel").onclick = closeTimesModal;
    $$("#times-modal [data-close-times]").forEach((el) => (el.onclick = closeTimesModal));
    // 处方药 添加/编辑 弹窗
    $("#rx-save").onclick = saveRxModal;
    $("#rx-cancel").onclick = closeRxModal;
    $("#rx-modal").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") saveRxModal(); });
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

  // 启动
  const boot = () => init().catch((e) => { toast("初始化失败：" + ((e && e.message) || e)); console.error("[nurse] init failed:", e); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
