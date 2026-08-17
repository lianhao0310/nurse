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
  let homeExpandedSlot = currentSlot();
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
    $("#opt-med-min").value = Number(s.medReminderMinutes) >= 0 ? s.medReminderMinutes : 10;
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
      (d.variants || []).forEach((v) => {
        if (v.status === "out" || (v.status === "active" && v.threshold > 0 && v.qty <= v.threshold)) {
          items.push({
            out: v.status === "out",
            text: "💊 " + d.name + (v.manufacturer ? "（" + v.manufacturer + "）" : "") + (v.status === "out" ? "：已缺药" : "：库存不足（剩 " + v.qty + " " + v.unit + "）"),
          });
        }
      });
    }
    if (!items.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.innerHTML = items.map((i) => `<div class="alerts__item ${i.out ? "is-out" : "is-low"}">${esc(i.text)}，请及时补充。</div>`).join("");
    box.hidden = false;
  }

  // 用药提醒：按 早/中/晚 分组，当前时段展开，其余折叠显示数量
  function renderMedBlocks(done) {
    const box = $("#home-meds-blocks");
    if (!box) return;
    const drugs = (DATA.cabinet || []).filter((d) => (d.variants || []).some((v) => v.status === "active"));
    let total = 0;
    const html = SLOT_DEFS.map((slot) => {
      const inSlot = drugs.filter((d) => (d.timeSlots || []).includes(slot.key));
      const expanded = homeExpandedSlot === slot.key;
      const count = inSlot.length;
      total += count;
      const head = `<div class="med-block__head ${expanded ? "is-open" : ""}" data-slot="${slot.key}">
        <span>${slot.label}</span>
        <span class="med-block__count">${expanded ? "收起" : count + " 项 ▾"}</span>
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
    return (d.variants || []).length
      ? (d.variants || []).reduce((s, v) => s + (v.status === "active" ? Number(v.qty) || 0 : 0), 0)
      : 0;
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
    const diet = [], taboo = [], texts = [];
    for (const r of DATA.records || []) {
      if (r.aiAdvice) {
        (r.aiAdvice.diet || []).forEach((x) => diet.push(x));
        (r.aiAdvice.taboo || []).forEach((x) => taboo.push(x));
        if (r.aiAdvice.text) texts.push(r.aiAdvice.text);
      } else if (r.result && r.result.advice) {
        (r.result.advice.diet || []).forEach((x) => diet.push(x));
        (r.result.advice.taboo || []).forEach((x) => taboo.push(x));
      }
    }
    if (!diet.length && !taboo.length && !texts.length) {
      box.innerHTML = '<div class="empty-tip">还没有 AI 医嘱建议。在「问诊记录」详情中做「医嘱分析」后，这里会汇总生活 / 饮食医嘱。</div>';
      return;
    }
    let h = "";
    if (texts.length) h += `<div class="aidvice__summary">${esc(texts[texts.length - 1])}</div>`;
    if (diet.length) h += `<div class="aidvice__sec"><h4>🥗 饮食 / 生活建议</h4><ul>${diet.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    if (taboo.length) h += `<div class="aidvice__sec"><h4>⛔ 禁忌</h4><ul>${taboo.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    box.innerHTML = h;
  }

  async function toggleMed(id, slot) {
    const key = id + "@" + slot;
    const done = await NurseStorage.getDone(TODAY);
    const nowDone = !done.medDoses[key];
    await NurseStorage.setDone(TODAY, "medDoses", key, nowDone);
    await renderHome();
  }

  function scheduleNotifications(done) {
    if (!DATA.settings.notifications) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const 提前 = Number(DATA.settings.medReminderMinutes) || 0;
    const now = Date.now();
    for (const d of DATA.cabinet || []) {
      if (!(d.variants || []).some((v) => v.status === "active")) continue;
      for (const slot of d.timeSlots || []) {
        const key = d.id + "@" + slot;
        if (done.medDoses[key]) continue;
        const [hh, mm] = slotTime(slot).split(":").map(Number);
        const t = new Date();
        t.setHours(hh, mm - 提前, 0, 0);
        let diff = t.getTime() - now;
        if (diff < 0) diff += 24 * 3600 * 1000;
        if (diff > 12 * 3600 * 1000) continue;
        const dose = d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "";
        setTimeout(() => {
          try {
            new Notification("私人护士 · 用药提醒", { body: (dose ? dose + " " : "") + d.name });
          } catch (e) {}
        }, diff);
      }
    }
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
          return `<div class="rec-card" data-rec-id="${esc(rec.id)}">
            <div class="rec-card__top">
              <span class="rec-card__date">${esc(title)}</span>
              <span>${hasImg ? '<span class="rec-card__badge badge-img">📷</span>' : ""}</span>
            </div>
            <div class="rec-card__summary">👨‍⚕️ ${esc((rec.doctor || "未知医生") + "：" + summary)}</div>
          </div>`;
        })
        .join("");
    }

    // 检查结果子页签
    renderExamTrend($("#exam-trend"));
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
    showRecordView(rec, id ? "detail" : "edit");
  }

  function showRecordView(rec, mode) {
    recDraft = null;
    $$(".view").forEach((v) => (v.hidden = true));
    $$(".page").forEach((p) => (p.hidden = true));
    const view = $("#record-view");
    view.hidden = false;
    $("#record-view-title").textContent = mode === "edit" ? (rec ? "编辑问诊记录" : "新增问诊记录") : "问诊记录";
    $("#record-view-sub").textContent = mode === "edit" ? "" : (rec && rec.hospital ? rec.hospital : "");
    const body = $("#record-body");
    if (mode === "edit") body.innerHTML = renderRecordEdit(rec);
    else body.innerHTML = renderRecordDetail(rec);
    bindRecordView(rec, mode);
  }

  function renderRecordDetail(rec) {
    if (!rec) return "";
    let h = "";
    h += `<div class="rec-detail__bar">
      <button class="btn btn-ghost btn-sm" id="rec-edit-btn">✎ 编辑</button>
      <button class="btn btn-ghost btn-sm" id="rec-del-btn" style="color:var(--danger)">🗑 删除</button>
    </div>`;
    h += `<div class="rec-detail__meta">
      <div><span>医院</span><b>${esc(rec.hospital || "—")}</b></div>
      <div><span>就诊日期</span><b>${esc(rec.visitDate || "—")}</b></div>
      <div><span>医生</span><b>${esc(rec.doctor || "—")}</b></div>
    </div>`;

    // 医嘱
    h += `<div class="detail-sec"><h3>📝 医嘱</h3>`;
    if (rec.advice && rec.advice.text) h += `<p>${esc(rec.advice.text)}</p>`;
    if (rec.advice && rec.advice.audio) h += `<audio controls src="${rec.advice.audio.dataUrl}" style="width:100%;margin-top:6px"></audio>`;
    if (!rec.advice || (!rec.advice.text && !rec.advice.audio)) h += `<p class="cab-detail__empty">暂无医嘱</p>`;
    h += `</div>`;

    // 检查结果
    h += `<div class="detail-sec"><h3>🧪 检查结果${rec.examTable && rec.examTable.length ? "（" + rec.examTable.length + "）" : ""}</h3>`;
    if (rec.examTable && rec.examTable.length) {
      h += `<div class="table-wrap"><table class="view-table"><thead><tr><th>指标</th><th>数值</th><th>单位</th><th>参考</th><th>异常</th></tr></thead><tbody>${rec.examTable
        .map((e) => `<tr><td>${esc(e.name)}</td><td>${esc(e.value)}</td><td>${esc(e.unit)}</td><td>${esc(e.range)}</td><td>${e.abnormal ? "⚠️" : ""}</td></tr>`)
        .join("")}</tbody></table></div>`;
    } else h += `<p class="cab-detail__empty">暂无</p>`;
    if (rec.examImages && rec.examImages.length) {
      h += `<div class="thumb-grid">${rec.examImages.map((im) => `<div class="thumb"><img src="${im.dataUrl}"/></div>`).join("")}</div>`;
    }
    h += `</div>`;

    // 处方药
    h += `<div class="detail-sec"><h3>💊 处方药${rec.rxTable && rec.rxTable.length ? "（" + rec.rxTable.length + "）" : ""}</h3>`;
    if (rec.rxTable && rec.rxTable.length) {
      h += `<div class="table-wrap"><table class="view-table"><thead><tr><th>药名</th><th>规格</th><th>剂量</th><th>频次</th><th>时间</th></tr></thead><tbody>${rec.rxTable
        .map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.spec)}</td><td>${esc(m.dose)}</td><td>${esc(m.freq)}</td><td>${esc(m.time)}</td></tr>`)
        .join("")}</tbody></table></div>`;
    } else h += `<p class="cab-detail__empty">暂无</p>`;
    if (rec.rxImages && rec.rxImages.length) {
      h += `<div class="thumb-grid">${rec.rxImages.map((im) => `<div class="thumb"><img src="${im.dataUrl}"/></div>`).join("")}</div>`;
    }
    h += `</div>`;

    // 原始归档
    if (rec.transcript && !(rec.advice && rec.advice.text)) h += `<div class="detail-sec"><h3>原始内容</h3><div class="detail-transcript">${esc(rec.transcript)}</div></div>`;
    if (rec.images && rec.images.length) {
      h += `<div class="detail-sec"><h3>归档图片</h3>${rec.images.map((im) => `<img class="detail-img" src="${im.dataUrl}"/>`).join("")}</div>`;
    }

    // 底部操作：AI 开启时显示 AI分析 / 医嘱分析（无 修改/关闭）
    const aiOn = DATA.settings.ai.enabled && DATA.settings.ai.apiKey;
    if (aiOn) {
      h += `<div class="detail-actions">
        <button class="btn btn-primary block" id="rec-ai-analyze">🤖 AI 分析</button>
        <button class="btn btn-primary block" id="rec-advice-analyze">💡 医嘱分析</button>
      </div>`;
    }
    return h;
  }

  function bindRecordView(rec, mode) {
    if (mode === "edit") {
      bindRecordEdit(rec);
      return;
    }
    // 详情模式：编辑 / 删除入口 + AI 按钮
    const editBtn = $("#rec-edit-btn");
    if (editBtn) editBtn.onclick = () => showRecordView(rec, "edit");
    const delBtn = $("#rec-del-btn");
    if (delBtn)
      delBtn.onclick = async () => {
        if (confirm("确定删除这条问诊记录？此操作不可恢复。")) {
          await NurseStorage.deleteRecord(rec.id);
          DATA = await NurseStorage.load();
          closeView();
          renderRecords();
          renderHome();
          toast("已删除");
        }
      };
    const aiBtn = $("#rec-ai-analyze");
    if (aiBtn) aiBtn.onclick = () => runAIAnalyze(rec);
    const advBtn = $("#rec-advice-analyze");
    if (advBtn) advBtn.onclick = () => runAdviceAnalyze(rec);
  }

  // ---- 编辑表单 ----
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
          <div class="table-wrap" style="margin-top:8px"><table class="edit-table" id="rec-rx-table">
            <thead><tr><th>药名</th><th>规格</th><th>剂量</th><th>频次</th><th>时间</th><th></th></tr></thead>
            <tbody></tbody>
          </table></div>
          <button type="button" class="btn btn-ghost btn-sm" id="rec-rx-add">＋ 添加药品</button>
        </div>

        <div class="detail-actions">
          <button class="btn btn-primary block" id="rec-save">保存</button>
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
    renderRxRows();
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
    $$("#rec-exam-table .row-del").forEach((b) => (b.onclick = () => { recDraft.examTable.splice(+b.dataset.i, 1); renderExamRows(); }));
  }
  function renderRxRows() {
    const tb = $("#rec-rx-table tbody");
    if (!tb) return;
    tb.innerHTML = recDraft.rxTable
      .map(
        (m, i) => `<tr data-i="${i}">
        <td><input data-f="name" value="${esc(m.name)}"/></td>
        <td><input data-f="spec" value="${esc(m.spec)}"/></td>
        <td><input data-f="dose" value="${esc(m.dose)}"/></td>
        <td><input data-f="freq" value="${esc(m.freq)}"/></td>
        <td><input data-f="time" value="${esc(m.time)}"/></td>
        <td><button class="row-del" data-i="${i}">✕</button></td>
      </tr>`
      )
      .join("");
    $$("#rec-rx-table .row-del").forEach((b) => (b.onclick = () => { recDraft.rxTable.splice(+b.dataset.i, 1); renderRxRows(); }));
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
    $("#rec-rx-add").onclick = () => { recDraft.rxTable.push({ name: "", spec: "", dose: "", freq: "", time: "" }); renderRxRows(); };
    $("#rec-save").onclick = () => saveRecordEdit(rec);
    $("#rec-cancel").onclick = () => { if (currentRecordId) showRecordView(rec, "detail"); else goPage("records"); };
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

  async function saveRecordEdit(rec) {
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
    if (rec) {
      await NurseStorage.updateRecord(rec.id, payload);
    } else {
      await NurseStorage.appendRecord(Object.assign({ source: "text", transcript: payload.advice.text, images: [], manual: true, status: "done" }, payload));
    }
    DATA = await NurseStorage.load();
    closeView();
    renderRecords();
    renderHome();
    toast("已保存");
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
        spec: row.querySelector('[data-f="spec"]').value.trim(),
        dose: row.querySelector('[data-f="dose"]').value.trim(),
        freq: row.querySelector('[data-f="freq"]').value.trim(),
        time: row.querySelector('[data-f="time"]').value.trim(),
        note: "",
      }))
      .filter((x) => x.name);
    const adviceText = $("#ai-advice").value.trim();
    // 写回记录
    rec.advice = { text: adviceText, audio: rec.advice ? rec.advice.audio : null };
    rec.examTable = examResults;
    rec.rxTable = prescription;
    rec.result = rec.result || {};
    rec.result.medications = prescription.map((m) => ({ name: m.name, dose: m.dose || m.spec, freq: m.freq, time: m.time, note: m.note, disease: "" }));
    // 同步到全局检查结果
    if (examResults.length) {
      await NurseStorage.upsertExamEntry({ id: "ex_" + rec.id, recordId: rec.id, hospital: rec.hospital, date: rec.visitDate || TODAY, indicators: examResults });
    }
    // 同步处方药到药箱
    await syncRxToCabinet(prescription, rec);
    await NurseStorage.updateRecord(rec.id, { advice: rec.advice, examTable: rec.examTable, rxTable: rec.rxTable, result: rec.result });
    DATA = await NurseStorage.load();
    aiModalState = null;
    $("#ai-modal").hidden = true;
    closeView();
    renderRecords();
    renderHome();
    toast("已保存：医嘱 / 检查结果 / 药箱已同步");
  }
  async function syncRxToCabinet(rxList, rec) {
    for (const m of rxList) {
      if (!m.name) continue;
      const names = (DATA.cabinet || []).map((d) => ({ d, ns: NurseStorage.drugNames(d) }));
      const found = names.find((x) => x.ns.some((n) => n === m.name));
      const doseNum = parseFloat(m.dose);
      if (found) {
        await NurseStorage.upsertVariant(found.d.id, {
          id: found.d.variants[0] ? found.d.variants[0].id : undefined,
          manufacturer: found.d.variants[0] ? found.d.variants[0].manufacturer : "",
          spec: m.spec || (found.d.variants[0] ? found.d.variants[0].spec : ""),
          alias: found.d.variants[0] ? found.d.variants[0].alias : "",
          qty: found.d.variants[0] ? found.d.variants[0].qty : 0,
          unit: found.d.variants[0] ? found.d.variants[0].unit : "片",
          status: "active",
          dailyDose: found.d.variants[0] ? found.d.variants[0].dailyDose : 0,
          threshold: found.d.variants[0] ? found.d.variants[0].threshold : 7,
        });
        if (doseNum > 0) await NurseStorage.updateDrug(found.d.id, { doseAmount: doseNum, doseUnit: m.dose.replace(/^[0-9.]+/, "").trim() || found.d.doseUnit || "片", timeSlots: found.d.timeSlots && found.d.timeSlots.length ? found.d.timeSlots : ["morning"] });
      } else {
        await NurseStorage.upsertDrug({
          name: m.name,
          disease: "",
          doseAmount: doseNum > 0 ? doseNum : 0,
          doseUnit: m.dose.replace(/^[0-9.]+/, "").trim() || "片",
          timeSlots: ["morning"],
          meal: "any",
          intro: "",
          precautions: [],
          advice: "",
          note: rec && rec.hospital ? "来源：" + rec.hospital : "",
          variants: [{ manufacturer: "", spec: m.spec || "", alias: "", qty: 0, unit: "片", status: "active", dailyDose: 0, threshold: 7 }],
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
    const active = (DATA.cabinet || []).filter((d) => (d.variants || []).some((v) => v.status === "active"));
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
    rec.aiAdvice = { diet, taboo, text };
    await NurseStorage.updateRecord(rec.id, { aiAdvice: rec.aiAdvice });
    DATA = await NurseStorage.load();
    aiModalState = null;
    $("#ai-modal").hidden = true;
    closeView();
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
    el.innerHTML = series
      .map((s) => {
        const chart = s.points.length >= 2 ? svgLineChart(s) : singlePoint(s);
        const latest = s.points[s.points.length - 1];
        return `<div class="trend-card">
          <div class="trend-card__head"><b>${esc(s.name)}</b><span>${esc(latest.value + " " + (s.unit || ""))}${latest.abnormal ? " ⚠️" : ""}</span></div>
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
  function renderExamList(el) {
    if (!el) return;
    const entries = (DATA.examResults || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!entries.length) { el.innerHTML = ""; return; }
    el.innerHTML = entries
      .map(
        (e) => `<div class="exam-entry">
        <div class="exam-entry__head"><b>${esc(e.date || "")}</b>${e.hospital ? " · " + esc(e.hospital) : ""}</div>
        <div class="exam-entry__inds">${(e.indicators || []).map((i) => `<span class="exam-chip ${i.abnormal ? "is-bad" : ""}">${esc(i.name)} ${esc(i.value)}${esc(i.unit || "")}</span>`).join("")}</div>
      </div>`
      )
      .join("");
  }

  // ===================== 我的药箱 =====================
  function drugStatus(d) {
    const vs = d.variants || [];
    if (!vs.length) return "disabled";
    if (vs.every((v) => v.status === "disabled")) return "disabled";
    if (!vs.some((v) => v.status === "active" && v.qty > 0)) return "out";
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
        const stock = sumStock(d);
        const variants = (d.variants || []).map((v) => `${esc(v.manufacturer || "未填厂家")}${v.spec ? " · " + esc(v.spec) : ""}${v.alias && v.alias !== d.name ? "（别名 " + esc(v.alias) + "）" : ""}：余 ${v.qty}${esc(v.unit)}`).join("；");
        return `<div class="cab-item ${esc(drugStatus(d))}" data-cab-id="${esc(d.id)}">
          <div class="cab-item__top">
            <div>
              <div class="cab-item__name">${esc(d.name)}</div>
              ${d.disease ? `<div class="cab-item__disease">🩺 ${esc(d.disease)}</div>` : ""}
              <div class="cab-item__spec">单次 ${esc(d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "—")} · ${slotLabels(d.timeSlots)} · ${mealLabel(d.meal)}</div>
            </div>
            <span class="cab-status ${esc(drugStatus(d))}">${statusLabel(drugStatus(d))}</span>
          </div>
          <div class="cab-item__variants">${esc(variants)}</div>
        </div>`;
      })
      .join("");
  }

  function openCabinetDetail(id) {
    const d = (DATA.cabinet || []).find((x) => x.id === id);
    if (!d) return;
    currentCabId = id;
    const body = $("#cab-view-body");
    const variants = (d.variants || [])
      .map(
        (v) => `<div class="var-row view">
        <div class="var-row__head"><b>${esc(v.manufacturer || "未填厂家")}</b><span class="cab-status ${esc(v.status)}">${statusLabel(v.status)}</span></div>
        <div class="var-row__meta">规格 ${esc(v.spec || "—")}${v.alias && v.alias !== d.name ? " · 别名 " + esc(v.alias) : ""}</div>
        <div class="var-row__meta">数量 <b>${v.qty}</b> ${esc(v.unit)} · 每日消耗 ${v.dailyDose} · 阈值 ${v.threshold}</div>
      </div>`
      )
      .join("");
    body.innerHTML = `
      <div class="cab-detail__head"><div><div class="cab-detail__title">${esc(d.name)}</div>${d.disease ? `<div class="cab-detail__spec">🩺 ${esc(d.disease)}</div>` : ""}</div></div>
      <div class="cab-detail__sec"><h4>💊 用法</h4><p>单次 <b>${esc(d.doseAmount ? d.doseAmount + " " + (d.doseUnit || "") : "—")}</b> · 时段 ${slotLabels(d.timeSlots)} · ${mealLabel(d.meal)}</p></div>
      <div class="cab-detail__sec"><h4>🏭 厂家 / 规格（${d.variants.length}）</h4>${variants}</div>
      ${d.intro ? `<div class="cab-detail__sec"><h4>📖 药品介绍</h4><p>${esc(d.intro)}</p></div>` : ""}
      ${d.precautions && d.precautions.length ? `<div class="cab-detail__sec"><h4>⚠️ 注意事项</h4><ul>${d.precautions.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
      ${d.advice ? `<div class="cab-detail__sec"><h4>💡 个人用药建议</h4><p>${esc(d.advice)}</p></div>` : ""}
      ${d.note ? `<div class="cab-detail__sec"><h4>📝 备注</h4><p>${esc(d.note)}</p></div>` : ""}
      <div class="cab-detail__actions">
        <button class="btn btn-primary" id="cab-edit-btn">编辑</button>
        <button class="btn btn-primary" id="cab-var-btn">＋ 新增规格</button>
      </div>
      <button class="btn btn-primary block" id="cab-del-btn" style="background:var(--danger);margin-top:10px">删除药品</button>`;
    $("#cab-view-title").textContent = "药品详情";
    $$(".view").forEach((v) => (v.hidden = true));
    $$(".page").forEach((p) => (p.hidden = true));
    $("#cab-view").hidden = false;
    $("#cab-edit-btn").onclick = () => openCabinetEdit(id);
    $("#cab-var-btn").onclick = async () => {
      await NurseStorage.upsertVariant(id, { manufacturer: "", spec: "", alias: "", qty: 0, unit: "片", status: "active", dailyDose: 0, threshold: 7 });
      DATA = await NurseStorage.load();
      openCabinetDetail(id);
      renderCabinet();
      toast("已新增一个空规格，点「编辑」填写");
    };
    $("#cab-del-btn").onclick = async () => {
      if (confirm("确定从药箱删除该药品（含所有规格）？")) {
        await NurseStorage.deleteDrug(id);
        DATA = await NurseStorage.load();
        $("#cab-view").hidden = true;
        goPage("cabinet");
        renderCabinet();
        toast("已删除");
      }
    };
  }

  function openCabinetEdit(id) {
    const isNew = !id;
    const d = isNew ? { name: "", disease: "", doseAmount: 0, doseUnit: "片", timeSlots: ["morning"], meal: "any", intro: "", precautions: [], advice: "", note: "", variants: [] } : (DATA.cabinet || []).find((x) => x.id === id) || {};
    $("#cab-modal-title").textContent = isNew ? "添加药品" : "编辑药品";
    const precautions = (d.precautions || []).map((p, i) => `<span class="cab-edit__tag">${esc(p)} <button type="button" data-rm-prec="${i}">✕</button></span>`).join("");
    const variantRows = (d.variants || [])
      .map(
        (v, i) => `<div class="var-row edit" data-vi="${i}">
        <div class="var-row__grid">
          <label class="vf"><span>厂家</span><input value="${esc(v.manufacturer)}" data-f="manufacturer"/></label>
          <label class="vf"><span>规格</span><input value="${esc(v.spec)}" data-f="spec"/></label>
          <label class="vf"><span>别名</span><input value="${esc(v.alias)}" data-f="alias"/></label>
          <label class="vf"><span>数量</span><input type="number" value="${Number(v.qty) || 0}" data-f="qty"/></label>
          <label class="vf"><span>单位</span><input value="${esc(v.unit || "片")}" data-f="unit"/></label>
          <label class="vf"><span>状态</span><select data-f="status"><option value="active" ${v.status === "active" ? "selected" : ""}>使用中</option><option value="disabled" ${v.status === "disabled" ? "selected" : ""}>停用</option><option value="out" ${v.status === "out" ? "selected" : ""}>缺药</option></select></label>
          <label class="vf"><span>每日消耗</span><input type="number" value="${Number(v.dailyDose) || 0}" data-f="dailyDose"/></label>
          <label class="vf"><span>阈值</span><input type="number" value="${Number(v.threshold) || 0}" data-f="threshold"/></label>
        </div>
        <button type="button" class="row-del" data-vi="${i}">✕ 删除规格</button>
      </div>`
      )
      .join("");
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
      <div class="cab-edit__field"><span>药品介绍</span><textarea id="cab-f-intro" placeholder="简单介绍该药品作用">${esc(d.intro)}</textarea></div>
      <div class="cab-edit__field"><span>注意事项</span>
        <div class="cab-edit__tags" id="cab-f-prec-tags">${precautions}</div>
        <div style="display:flex;gap:8px;margin-top:6px"><input type="text" id="cab-f-prec-input" placeholder="输入后点击添加" style="flex:1"/><button type="button" class="btn btn-ghost" id="cab-f-prec-add">添加</button></div>
      </div>
      <div class="cab-edit__field"><span>针对个人用药建议</span><textarea id="cab-f-advice" placeholder="结合个人病情给出用药建议">${esc(d.advice)}</textarea></div>
      <div class="cab-edit__field"><span>备注</span><input type="text" id="cab-f-note" value="${esc(d.note)}" placeholder="其他备注"/></div>
      <div class="cab-edit__field"><span>厂家 / 规格（不同厂家不同库存）</span>
        <div id="cab-variants">${variantRows}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="cab-var-add">＋ 添加规格</button>
      </div>
      <button class="btn btn-primary block" id="cab-f-save">${isNew ? "添加" : "保存"}</button>`;
    $("#cab-modal").hidden = false;
    bindCabinetForm();
  }

  let formPrecautions = [];
  function bindCabinetForm() {
    formPrecautions = [];
    $$("#cab-f-prec-tags .cab-edit__tag").forEach((t) => { const x = t.textContent.replace(/✕\s*$/, "").trim(); if (x) formPrecautions.push(x); });
    const renderTags = () => {
      $("#cab-f-prec-tags").innerHTML = formPrecautions.map((p, i) => `<span class="cab-edit__tag">${esc(p)} <button type="button" data-rm-prec="${i}">✕</button></span>`).join("");
      $$("#cab-f-prec-tags [data-rm-prec]").forEach((b) => (b.onclick = () => { formPrecautions.splice(+b.dataset.rmPrec, 1); renderTags(); }));
    };
    renderTags();
    $("#cab-f-prec-add").onclick = () => { const i = $("#cab-f-prec-input"); if (i.value.trim()) { formPrecautions.push(i.value.trim()); i.value = ""; renderTags(); } };
    $("#cab-var-add").onclick = () => {
      const box = $("#cab-variants");
      const i = box.children.length;
      const div = document.createElement("div");
      div.className = "var-row edit";
      div.dataset.vi = i;
      div.innerHTML = `<div class="var-row__grid">
        <label class="vf"><span>厂家</span><input data-f="manufacturer"/></label>
        <label class="vf"><span>规格</span><input data-f="spec"/></label>
        <label class="vf"><span>别名</span><input data-f="alias"/></label>
        <label class="vf"><span>数量</span><input type="number" value="0" data-f="qty"/></label>
        <label class="vf"><span>单位</span><input value="片" data-f="unit"/></label>
        <label class="vf"><span>状态</span><select data-f="status"><option value="active">使用中</option><option value="disabled">停用</option><option value="out">缺药</option></select></label>
        <label class="vf"><span>每日消耗</span><input type="number" value="0" data-f="dailyDose"/></label>
        <label class="vf"><span>阈值</span><input type="number" value="7" data-f="threshold"/></label>
      </div>
      <button type="button" class="row-del" data-vi="${i}">✕ 删除规格</button>`;
      box.appendChild(div);
      div.querySelector(".row-del").onclick = () => div.remove();
    };
    $$("#cab-variants .row-del").forEach((b) => (b.onclick = () => b.closest(".var-row").remove()));
    $("#cab-f-save").onclick = saveCabinetDrug;
  }

  async function saveCabinetDrug() {
    const name = $("#cab-f-name").value.trim();
    if (!name) { toast("请填写药品名称"); return; }
    const variants = $$("#cab-variants .var-row").map((row) => ({
      manufacturer: row.querySelector('[data-f="manufacturer"]').value.trim(),
      spec: row.querySelector('[data-f="spec"]').value.trim(),
      alias: row.querySelector('[data-f="alias"]').value.trim(),
      qty: Number(row.querySelector('[data-f="qty"]').value) || 0,
      unit: row.querySelector('[data-f="unit"]').value.trim() || "片",
      status: row.querySelector('[data-f="status"]').value,
      dailyDose: Number(row.querySelector('[data-f="dailyDose"]').value) || 0,
      threshold: Number(row.querySelector('[data-f="threshold"]').value) || 0,
    }));
    if (!variants.length) { toast("请至少添加一个厂家规格"); return; }
    const item = {
      name,
      disease: $("#cab-f-disease").value.trim(),
      doseAmount: Number($("#cab-f-dose").value) || 0,
      doseUnit: $("#cab-f-doseunit").value.trim() || "片",
      timeSlots: $$(".cab-f-slot").filter((c) => c.checked).map((c) => c.value),
      meal: $("#cab-f-meal").value,
      intro: $("#cab-f-intro").value.trim(),
      precautions: formPrecautions,
      advice: $("#cab-f-advice").value.trim(),
      note: $("#cab-f-note").value.trim(),
      variants,
    };
    await NurseStorage.upsertDrug(item);
    DATA = await NurseStorage.load();
    $("#cab-modal").hidden = true;
    renderCabinet();
    if (currentCabId && !$("#cab-view").hidden) openCabinetDetail(currentCabId);
    toast("已保存");
  }

  // ===================== 每日扣减 =====================
  async function runDailyDecrement() {
    const today = dateKey(new Date());
    const data = await NurseStorage.load();
    if (data.lastDecrement === today) { DATA.lastDecrement = today; return; }
    let changed = false;
    for (const d of data.cabinet) {
      for (const v of d.variants || []) {
        if (v.status !== "active") continue;
        if (v.dailyDose > 0 && v.qty > 0) {
          v.qty = Math.max(0, Math.round((v.qty - v.dailyDose) * 100) / 100);
          if (v.qty <= 0) v.status = "out";
          changed = true;
        }
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
        <div class="reminder-row__meta">${esc(r.date)}${r.time ? " " + esc(r.time) : ""} · 提前 ${r.advanceDays} 天${r.enabled ? "" : " · 已停用"}</div></div>
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
    $("#rem-advance").value = r ? r.advanceDays : 3;
    $("#rem-enabled").checked = r ? r.enabled !== false : true;
    $("#reminder-modal").hidden = false;
  }
  async function saveReminder() {
    const title = $("#rem-title").value.trim();
    if (!title) { toast("请填写提醒名称"); return; }
    const data = await NurseStorage.load();
    const rems = data.settings.reminders || [];
    const payload = { title, type: $("#rem-type").value, date: $("#rem-date").value, time: $("#rem-time").value, advanceDays: Number($("#rem-advance").value) || 0, enabled: $("#rem-enabled").checked };
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
  async function saveReminderSettings() {
    await NurseStorage.updateSettings({ medReminderMinutes: Number($("#opt-med-min").value) || 0 });
    DATA = await NurseStorage.load();
    renderHome();
    toast("提醒设置已保存");
  }
  async function toggleNotify() {
    const on = $("#opt-notify").checked;
    if (on && "Notification" in window && Notification.permission === "default") {
      try { const p = await Notification.requestPermission(); if (p !== "granted") { $("#opt-notify").checked = false; toast("未授予通知权限"); return; } } catch (e) {}
    }
    await NurseStorage.updateSettings({ notifications: on });
    DATA = await NurseStorage.load();
    toast(on ? "已开启用药提醒通知" : "已关闭通知");
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

  // ===================== 事件绑定 =====================
  function bindEvents() {
    $$(".tabbar__btn").forEach((b) => (b.onclick = () => goPage(b.dataset.page)));
    $$("[data-close]").forEach((el) => (el.onclick = () => { const k = el.dataset.close; if (k === "ai") { aiModalState = null; } $("#" + k + "-modal").hidden = true; if (k === "cab") cabinetState.editing = null; }));

    // 首页页签
    $$(".home-tab").forEach((b) => (b.onclick = () => switchHomeTab(b.dataset.htab)));
    // 用药提醒时段折叠
    $("#home-meds-blocks").onclick = async (e) => {
      const head = e.target.closest(".med-block");
      if (head && head.dataset.slot) {
        const slot = head.dataset.slot;
        homeExpandedSlot = homeExpandedSlot === slot ? null : slot;
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

    // 药箱
    $$(".cab-filter").forEach((b) => (b.onclick = () => { cabinetState.filter = b.dataset.filter; $$(".cab-filter").forEach((x) => x.classList.toggle("is-active", x === b)); renderCabinet(); }));
    $("#btn-add-cab").onclick = () => openCabinetEdit(null);
    $("#cabinet-list").onclick = (e) => { const c = e.target.closest(".cab-item"); if (c) openCabinetDetail(c.dataset.cabId); };
    $("#cab-view-back").onclick = () => { $("#cab-view").hidden = true; goPage("cabinet"); };

    // 设置
    $("#ai-enabled").onchange = saveAISettings;
    ["#ai-baseurl", "#ai-model", "#ai-key"].forEach((s) => ($(s).onchange = saveAISettings));
    $("#opt-notify").onchange = toggleNotify;
    $("#opt-large").onchange = toggleLarge;
    $("#opt-med-min").onchange = saveReminderSettings;
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
