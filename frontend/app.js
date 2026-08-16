/*
 * 私人护士 · 前端交互逻辑（v2  redesign）
 * 四页 Tab：首页 / 问诊记录 / 我的药箱 / 我的
 * 录音/上传 -> AI 或本地引擎解析 -> 可编辑 -> 保存 -> 同步药箱
 */
(function () {
  "use strict";

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  // 当前数据（内存缓存，操作时从 storage 重新加载）
  let DATA = null;
  let TODAY = dateKey(new Date());

  // 录音/上传弹层状态
  const capture = {
    mode: "record",
    images: [],
    recording: false,
    recognizer: null,
  };

  // 药箱状态
  const cabinetState = {
    filter: "all", // all | active | disabled | out
    editing: null, // 当前编辑的药箱条目 id（null 为新增）
  };

  // 首页「提醒 / 待办」页签状态
  let homeTab = "remind";

  // ===================== 工具 =====================
  function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms || 2200);
  }

  // 全局错误捕获
  window.addEventListener("error", (e) => {
    const msg = (e.error && e.error.message) || e.message || String(e);
    toast("出错：" + msg);
    console.error("[nurse] error:", e.error || e);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = (e.reason && e.reason.message) || String(e.reason);
    toast("出错：" + msg);
    console.error("[nurse] unhandledrejection:", e.reason);
  });

  // ===================== 初始化 =====================
  async function init() {
    DATA = await NurseStorage.load();
    DATA.cabinet = DATA.cabinet || [];
    // 把上次遗留的「解析中」标记为失败（进程被中断 / App 被杀后不会自动完成）
    if (DATA.records.some((r) => r.status === "parsing")) {
      DATA.records.forEach((r) => {
        if (r.status === "parsing") r.status = "failed";
      });
      await NurseStorage.save(DATA);
    }
    applySettingsUI();
    bindEvents();
    await runDailyDecrement(); // 每日药箱自动扣减（每天最多一次）
    renderHome();
    renderRecords();
    renderCabinet();
    setHeader("私人护士", "");
  }

  function setHeader(title, sub) {
    $("#header-title").textContent = title;
    $("#header-sub").textContent = sub || "";
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

    // 提醒设置
    $("#opt-med-min").value = Number(s.medReminderMinutes) >= 0 ? s.medReminderMinutes : 10;
    renderAISummary();
    renderRemindersList();
  }

  // ===================== 页面路由 =====================
  function goPage(page) {
    $$(".page").forEach((p) => (p.hidden = p.id !== "page-" + page));
    $$(".tabbar__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.page === page));
    // 录音 / 上传操作条只在首页常驻
    const ab = $(".actionbar");
    if (ab) ab.style.display = page === "home" ? "" : "none";
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

  // ===================== 首页：今日看板 =====================
  async function renderHome() {
    const now = new Date();
    TODAY = dateKey(now);
    const h = now.getHours();
    const greet = h < 6 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
    $("#greet-text").textContent = greet + "，今天也要好好照顾自己";
    $("#today-date").textContent = fmtDate(now).slice(0, 10) + " " + ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];

    const done = await NurseStorage.getDone(TODAY);

    // 下次就诊提醒横幅
    renderVisitBanner();

    // 用药：聚合所有记录的药品 -> 提醒时间
    const medItems = [];
    for (const rec of DATA.records) {
      const meds = (rec.result && rec.result.medications) || [];
      if (!meds.length) continue;
      let reminders = [];
      try {
        reminders = NurseEngine.schedule_reminders(meds);
      } catch (e) {
        reminders = meds.map((m) => ({ med: m.name, dose: m.dose, time: "12:00", note: m.note }));
      }
      for (const r of reminders) {
        const med = meds.find((m) => m.name === r.med) || {};
        medItems.push({
          id: med.id || r.med,
          name: r.med,
          dose: r.dose || med.dose || "",
          time: r.time || "12:00",
          note: r.note || med.note || "",
          done: !!done.meds[med.id || r.med + "@" + (r.time || "12:00")],
        });
      }
    }
    medItems.sort((a, b) => a.time.localeCompare(b.time));
    const medBox = $("#home-meds");
    if (!medItems.length) {
      medBox.innerHTML = '<div class="empty-tip">还没有用药提醒。点下方「录音」记录门诊，或「上传归档」处方照片。</div>';
      $("#home-meds-count").textContent = "";
    } else {
      medBox.innerHTML = medItems
        .map(
          (m) => `<div class="med ${m.done ? "done" : ""}" data-med-id="${esc(m.id)}" data-time="${esc(m.time)}">
            <div class="med__check">${m.done ? "✓" : ""}</div>
            <div class="med__main">
              <div class="med__name">${esc(m.name)}</div>
              <div class="med__meta">${esc(m.dose)}${m.note ? " · " + esc(m.note) : ""}</div>
            </div>
            <div class="med__time">${esc(m.time)}</div>
          </div>`
        )
        .join("");
      $("#home-meds-count").textContent = medItems.length + " 项";
    }

    // 待办
    const taskItems = [];
    for (const rec of DATA.records) {
      const tasks = (rec.result && rec.result.tasks) || [];
      for (const t of tasks) {
        taskItems.push({ id: t.id, title: t.title, detail: t.detail, type: t.type, done: !!done.tasks[t.id] });
      }
    }
    const taskBox = $("#home-tasks");
    if (!taskItems.length) {
      taskBox.innerHTML = '<div class="empty-tip">暂无待办事项。</div>';
      $("#home-tasks-count").textContent = "";
    } else {
      const tagMap = { monitor: "监测", revisit: "复诊", life: "生活" };
      taskBox.innerHTML = taskItems
        .map(
          (t) => `<div class="task ${t.done ? "done" : ""}" data-task-id="${esc(t.id)}">
            <div class="task__check">${t.done ? "✓" : ""}</div>
            <div class="task__main">
              <div class="task__title">${esc(t.title)}<span class="task__tag">${tagMap[t.type] || "待办"}</span></div>
              <div class="task__detail">${esc(t.detail)}</div>
            </div>
          </div>`
        )
        .join("");
      $("#home-tasks-count").textContent = taskItems.length + " 项";
    }

    renderPersonalReminders();
    scheduleNotifications(medItems, done);
    renderHomeAlerts();
  }

  // 首页药箱告警（缺药 / 库存不足）
  function renderHomeAlerts() {
    const box = $("#home-alerts");
    if (!box) return;
    const items = [];
    for (const it of DATA.cabinet || []) {
      if (it.status === "out") {
        items.push({ level: "out", text: "💊 " + it.name + "：已缺药，请及时补充。" });
      } else if (it.status === "active" && it.threshold > 0 && it.qty <= it.threshold) {
        items.push({ level: "low", text: "💊 " + it.name + "：库存不足（剩 " + it.qty + " " + it.unit + "），建议尽快补药。" });
      }
    }
    if (!items.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.innerHTML = items
      .map((i) => `<div class="alerts__item ${i.level === "out" ? "is-out" : "is-low"}">${esc(i.text)}</div>`)
      .join("");
    box.hidden = false;
  }

  function renderVisitBanner() {
    const banner = $("#home-visit-banner");
    if (!banner) return;
    const rems = (DATA.settings.reminders || []).filter((r) => r.enabled && r.date);
    if (!rems.length) {
      banner.hidden = true;
      return;
    }
    const today = new Date(TODAY + "T00:00:00");
    let nearest = null;
    let nd = Infinity;
    for (const r of rems) {
      const d = new Date(r.date + "T00:00:00");
      const diff = Math.round((d - today) / (24 * 3600 * 1000));
      if (diff < nd) {
        nd = diff;
        nearest = r;
      }
    }
    if (!nearest) {
      banner.hidden = true;
      return;
    }
    let label = "";
    if (nd < 0) label = `已逾期 ${Math.abs(nd)} 天，请尽快处理`;
    else if (nd === 0) label = "就是今天：" + nearest.title;
    else if (nd <= 3) label = `${nearest.title} 还有 ${nd} 天，请提前准备`;
    else label = `${nearest.title}：${nearest.date}（还有 ${nd} 天）`;
    $("#home-visit-text").textContent = label;
    const titleEl = banner.querySelector(".visit-banner__title");
    if (titleEl) titleEl.textContent = nearest.type === "visit" ? "下次就诊" : "提醒";
    const iconEl = banner.querySelector(".visit-banner__icon");
    if (iconEl) iconEl.textContent = nearest.type === "visit" ? "🏥" : "📌";
    banner.hidden = false;
  }

  // 首页勾选
  async function toggleMed(id, time) {
    const key = id + "@" + time;
    const done = await NurseStorage.getDone(TODAY);
    const nowDone = !done.meds[key];
    await NurseStorage.setDone(TODAY, "meds", key, nowDone);
    await renderHome();
  }
  async function toggleTask(id) {
    const done = await NurseStorage.getDone(TODAY);
    const nowDone = !done.tasks[id];
    await NurseStorage.setDone(TODAY, "tasks", id, nowDone);
    await renderHome();
  }

  // ===================== 通知 =====================
  function scheduleNotifications(medItems, done) {
    if (!DATA.settings.notifications) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const now = Date.now();
    const提前 = Number(DATA.settings.medReminderMinutes) || 0;
    for (const m of medItems) {
      if (m.done) continue;
      const [hh, mm] = m.time.split(":").map(Number);
      const t = new Date();
      t.setHours(hh, mm - 提前, 0, 0);
      let diff = t.getTime() - now;
      if (diff < 0) diff += 24 * 3600 * 1000;
      if (diff > 12 * 3600 * 1000) continue;
      const name = m.name;
      setTimeout(() => {
        try {
          new Notification("私人护士 · 用药提醒", { body: (m.dose ? m.dose + " " : "") + name + (m.note ? "（" + m.note + "）" : "") });
        } catch (e) {}
      }, diff);
    }
  }

  // ===================== 问诊记录 =====================
  function renderRecords() {
    const list = $("#records-list");
    const empty = $("#records-empty");
    if (!DATA.records.length) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = DATA.records
      .map((rec) => {
        const res = rec.result || {};
        const meds = res.medications || [];
        const tasks = res.tasks || [];
        const diseases = res.diseases || [];
        const badge = rec.manual
          ? '<span class="rec-card__badge badge-rule">手动</span>'
          : res.engine === "ai"
          ? '<span class="rec-card__badge badge-ai">AI</span>'
          : '<span class="rec-card__badge badge-rule">本地</span>';
        const statusBadge =
          rec.status === "parsing"
            ? '<span class="rec-card__badge badge-parsing">⏳ 解析中</span>'
            : rec.status === "failed"
            ? '<span class="rec-card__badge badge-failed">⚠️ 失败</span>'
            : "";
        const imgBadge = rec.images && rec.images.length ? `<span class="rec-card__badge badge-img">📷 ${rec.images.length}</span>` : "";
        const chips = diseases.map((d) => `<span class="chip">${esc(d)}</span>`).join("");
        const statHtml =
          rec.status === "done"
            ? `<div class="rec-card__stat">
                <span>💊 <b>${meds.length}</b> 用药</span>
                <span>✅ <b>${tasks.length}</b> 待办</span>
                <span>⚠️ <b>${(res.risks || []).length}</b> 风险</span>
              </div>`
            : `<div class="rec-card__stat rec-card__stat--hint">${
                rec.status === "parsing" ? "⏳ 正在后台解析…" : "⚠️ 解析未完成，点开处理"
              }</div>`;
        return `<div class="rec-card" data-rec-id="${esc(rec.id)}">
          <div class="rec-card__top">
            <span class="rec-card__date">${esc(fmtDate(rec.createdAt))}</span>
            <span>${badge}${statusBadge}${imgBadge}</span>
          </div>
          ${chips ? `<div class="rec-card__diseases">${chips}</div>` : ""}
          ${statHtml}
        </div>`;
      })
      .join("");
  }

  function openDetail(id) {
    const rec = DATA.records.find((r) => r.id === id);
    if (!rec) return;

    // 解析中：等待后台完成
    if (rec.status === "parsing") {
      const body = $("#detail-body");
      body.innerHTML = `<div class="detail-sec"><h3>⏳ 正在解析</h3><p>这条问诊记录正在后台解析，请稍候片刻。你可以关闭弹窗，稍后回到「问诊记录」刷新查看结果。</p></div>
        <div class="detail-actions"><button class="btn btn-ghost block" id="detail-close">关闭</button></div>`;
      $("#detail-modal").hidden = false;
      $("#detail-close").onclick = closeModal;
      return;
    }

    // 解析失败：展示原始内容，支持重试 / 仅归档 / 删除
    if (rec.status === "failed") {
      const body = $("#detail-body");
      let html = `<div class="detail-sec"><h3>⚠️ 解析失败</h3><p>该记录未能完成智能解析。你可以重试解析，或转为纯归档（保留文字与图片，不做智能整理），也可直接删除。</p></div>`;
      html += `<div class="detail-sec"><h3>基本信息</h3><p>时间：${esc(fmtDate(rec.createdAt))}　来源：${esc(sourceLabel(rec.source))}</p></div>`;
      if (rec.transcript) html += `<div class="detail-sec"><h3>原始内容</h3><div class="detail-transcript">${esc(rec.transcript)}</div></div>`;
      if (rec.images && rec.images.length) {
        html += `<div class="detail-sec"><h3>归档图片（${rec.images.length}）</h3>`;
        rec.images.forEach((im) => (html += `<img class="detail-img" src="${im.dataUrl}" alt="${esc(im.name)}" />`));
        html += `</div>`;
      }
      html += `<div class="detail-actions">
        <button class="btn btn-primary block" id="detail-retry">重试解析</button>
        <button class="btn btn-ghost block" id="detail-archive">仅归档（放弃解析）</button>
        <button class="btn btn-primary block" id="detail-del" data-rec-id="${esc(rec.id)}" style="background:var(--danger)">删除记录</button>
        <button class="btn btn-ghost block" id="detail-close">关闭</button>
      </div>`;
      body.innerHTML = html;
      $("#detail-modal").hidden = false;
      $("#detail-close").onclick = closeModal;
      $("#detail-retry").onclick = async () => {
        await NurseStorage.updateRecord(rec.id, { status: "parsing" });
        DATA = await NurseStorage.load();
        closeModal();
        renderRecords();
        runParse(rec.id);
      };
      $("#detail-archive").onclick = async () => {
        await NurseStorage.updateRecord(rec.id, { status: "done", manual: true, result: null });
        DATA = await NurseStorage.load();
        closeModal();
        renderRecords();
        renderHome();
        toast("已转为纯归档");
      };
      $("#detail-del").onclick = async (e) => {
        if (confirm("确定删除这条问诊记录？此操作不可恢复。")) {
          await NurseStorage.deleteRecord(e.currentTarget.dataset.recId);
          DATA = await NurseStorage.load();
          closeModal();
          renderRecords();
          renderHome();
          toast("已删除");
        }
      };
      return;
    }

    const res = rec.result || {};
    const body = $("#detail-body");
    let html = "";
    if (!rec.result) {
      html += `<div class="detail-sec"><h3>📝 说明</h3><p class="hint">这是纯归档记录（未做智能解析）。你可以直接在下方表格手动补充用药与待办，保存后会同步到药箱。</p></div>`;
    }
    html += `<div class="detail-sec"><h3>基本信息</h3>
      <p>时间：${esc(fmtDate(rec.createdAt))}　来源：${esc(sourceLabel(rec.source))}${rec.manual ? "（手动录入）" : ""}</p></div>`;
    if (rec.images && rec.images.length) {
      html += `<div class="detail-sec"><h3>归档图片（${rec.images.length}）</h3>`;
      rec.images.forEach((im) => (html += `<img class="detail-img" src="${im.dataUrl}" alt="${esc(im.name)}" />`));
      html += `</div>`;
    }
    if (rec.transcript) {
      html += `<div class="detail-sec"><h3>原始内容</h3><div class="detail-transcript">${esc(rec.transcript)}</div></div>`;
    }
    const diseases = res.diseases || [];
    if (diseases.length) {
      html += `<div class="detail-sec"><h3>相关诊断</h3><div class="rec-card__diseases">${diseases.map((d) => `<span class="chip">${esc(d)}</span>`).join("")}</div></div>`;
    }
    const meds = res.medications || [];
    if (meds.length) {
      html += `<div class="detail-sec"><h3>💊 用药（可编辑）</h3>
        <div class="table-wrap"><table class="view-table">
          <thead><tr><th>药名</th><th>剂量</th><th>频次</th><th>时间</th><th>说明</th></tr></thead>
          <tbody>${meds
            .map(
              (m, i) => `<tr data-kind="med" data-i="${i}">
                <td><input data-f="name" value="${esc(m.name)}" /></td>
                <td><input data-f="dose" value="${esc(m.dose)}" /></td>
                <td><input data-f="freq" value="${esc(m.freq)}" /></td>
                <td><input data-f="time" value="${esc(m.time)}" /></td>
                <td><input data-f="note" value="${esc(m.note)}" /></td>
              </tr>`
            )
            .join("")}</tbody>
        </table></div></div>`;
    }
    const tasks = res.tasks || [];
    if (tasks.length) {
      html += `<div class="detail-sec"><h3>✅ 待办 / 生活医嘱（可编辑）</h3>
        <div class="table-wrap"><table class="view-table">
          <thead><tr><th>待办标题</th><th>说明</th></tr></thead>
          <tbody>${tasks
            .map(
              (t, i) => `<tr data-kind="task" data-i="${i}">
                <td><input data-f="title" value="${esc(t.title)}" /></td>
                <td><input data-f="detail" value="${esc(t.detail)}" /></td>
              </tr>`
            )
            .join("")}</tbody>
        </table></div></div>`;
    }
    const taboo = (res.advice && res.advice.taboo) || [];
    const diet = (res.advice && res.advice.diet) || [];
    if (taboo.length || diet.length) {
      html += `<div class="detail-sec"><h3>生活 / 饮食医嘱</h3>`;
      if (diet.length) html += `<p>🥗 ${diet.map(esc).join("；")}</p>`;
      if (taboo.length) html += `<p>⛔ ${taboo.map(esc).join("；")}</p>`;
      html += `</div>`;
    }
    const risks = res.risks || [];
    if (risks.length) {
      html += `<div class="detail-sec"><h3>风险提醒</h3>`;
      risks.forEach((r) => {
        html += `<div class="risk ${esc(r.level)}"><b>${esc(r.trigger)}</b>（${levelLabel(r.level)}）<br/>${esc(r.action)}</div>`;
      });
      html += `</div>`;
    }
    if (res.summary) html += `<div class="detail-sec"><h3>一句话总结</h3><p>${esc(res.summary)}</p></div>`;
    if (res.disclaimer) html += `<p class="hint">${esc(res.disclaimer)}</p>`;

    // 问诊记录详情增加「同步到药箱」按钮
    if (meds.length) {
      html += `<button class="btn btn-ghost block" id="detail-sync-cab" data-rec-id="${esc(rec.id)}">💊 将用药同步到药箱</button>`;
    }

    html += `<div class="detail-actions">
      <button class="btn btn-primary block" id="detail-save">保存修改</button>
      <button class="btn btn-ghost block" id="detail-close">关闭</button>
      <button class="btn btn-primary block" id="detail-del" data-rec-id="${esc(rec.id)}" style="background:var(--danger)">删除记录</button>
    </div>`;
    body.innerHTML = html;
    $("#detail-modal").hidden = false;
    $("#detail-close").onclick = closeModal;
    $("#detail-save").onclick = () => saveDetailEdit(rec, res);
    $("#detail-del").onclick = async (e) => {
      if (confirm("确定删除这条问诊记录？此操作不可恢复。")) {
        await NurseStorage.deleteRecord(e.currentTarget.dataset.recId);
        DATA = await NurseStorage.load();
        closeModal();
        renderRecords();
        renderHome();
        toast("已删除");
      }
    };
    const syncBtn = $("#detail-sync-cab");
    if (syncBtn) syncBtn.onclick = () => syncRecordMedsToCabinet(rec);
  }

  function sourceLabel(s) {
    return s === "recording" ? "录音" : s === "upload" ? "上传归档" : "文字";
  }

  async function saveDetailEdit(rec, res) {
    // 修复：手动归档/解析失败等场景下 rec.result 可能为 null，先兜底为对象
    if (!rec.result) {
      rec.result = {
        engine: "manual",
        diseases: [],
        medications: [],
        tasks: [],
        advice: { taboo: [], diet: [] },
        risks: [],
        summary: "",
        disclaimer: "",
      };
    }
    const meds = $$('#detail-body tr[data-kind="med"]')
      .map((row, i) => {
        const base = (res.medications && res.medications[i]) || {};
        const get = (f) => row.querySelector('[data-f="' + f + '"]').value;
        return Object.assign({}, base, {
          name: get("name"),
          dose: get("dose"),
          freq: get("freq"),
          time: get("time"),
          note: get("note"),
        });
      })
      .filter((m) => m.name && m.name.trim());
    const tasks = $$('#detail-body tr[data-kind="task"]')
      .map((row, i) => {
        const base = (res.tasks && res.tasks[i]) || {};
        const get = (f) => row.querySelector('[data-f="' + f + '"]').value;
        return Object.assign({}, base, { title: get("title"), detail: get("detail") });
      })
      .filter((t) => t.title && t.title.trim());
    rec.result.medications = meds;
    rec.result.tasks = tasks;
    try {
      rec.result.reminders = NurseEngine.schedule_reminders(meds);
    } catch (e) {
      rec.result.reminders = [];
    }
    await NurseStorage.updateRecord(rec.id, { result: rec.result });
    DATA = await NurseStorage.load();
    renderHome();
    renderRecords();
    toast("已保存修改");
  }
  function levelLabel(l) {
    return l === "red" ? "紧急" : l === "yellow" ? "警惕" : "一般";
  }

  // ===================== 录音 / 上传 弹层 =====================
  function openCapture(mode) {
    capture.mode = mode;
    capture.images = [];
    $("#capture-title").textContent = mode === "upload" ? "上传归档" : "录音问诊";
    $("#cap-text").value = "";
    $("#cap-preview").innerHTML = "";
    $("#cap-mic-status").textContent = "";
    $("#cap-text").disabled = false;
    $("#capture-modal").hidden = false;
  }

  function closeModal() {
    $$(".modal").forEach((m) => (m.hidden = true));
    stopRecording();
    cabinetState.editing = null;
  }

  async function addImages(files) {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const dataUrl = await downscaleImage(f, 1280, 0.82);
      capture.images.push({ name: f.name, type: "image/jpeg", dataUrl });
    }
    renderPreview();
  }

  async function pickNativeImages() {
    try {
      if (!window.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.Camera) {
        $("#cap-images").click();
        return;
      }
      const { Camera } = Capacitor.Plugins;
      const res = await Camera.pickImages({ quality: 80, limit: 6, correctOrientation: true });
      const photos = (res && res.photos) || [];
      for (const ph of photos) {
        let file = null;
        if (ph.webPath) {
          const blob = await (await fetch(ph.webPath)).blob();
          file = new File([blob], "image.jpg", { type: blob.type || "image/jpeg" });
        } else if (ph.path) {
          const b64 = await Capacitor.Plugins.Filesystem.readFile({ path: ph.path });
          const mime = ph.mimeType || "image/jpeg";
          file = await (await fetch("data:" + mime + ";base64," + b64.data)).blob().then(
            (b) => new File([b], "image.jpg", { type: mime })
          );
        }
        if (file) await addImages([file]);
      }
      renderPreview();
    } catch (e) {
      if (e && e.message && /cancel/i.test(e.message)) return;
      toast("选图失败：" + (e && e.message ? e.message : e));
    }
  }
  function downscaleImage(file, maxDim, quality) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const cv = document.createElement("canvas");
          cv.width = width;
          cv.height = height;
          cv.getContext("2d").drawImage(img, 0, 0, width, height);
          try {
            resolve(cv.toDataURL("image/jpeg", quality));
          } catch (e) {
            resolve(reader.result);
          }
        };
        img.onerror = () => resolve(reader.result);
        img.src = reader.result;
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }
  function renderPreview() {
    const box = $("#cap-preview");
    box.innerHTML = capture.images
      .map(
        (im, i) => `<div class="thumb"><img src="${im.dataUrl}"/><button class="thumb__del" data-idx="${i}">✕</button></div>`
      )
      .join("");
    $$(".thumb__del", box).forEach((b) => {
      b.onclick = () => {
        capture.images.splice(+b.dataset.idx, 1);
        renderPreview();
      };
    });
  }

  function setupMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = $("#cap-mic");
    if (!SR) {
      mic.disabled = false;
      mic.style.opacity = 0.55;
      mic.title = "当前设备（iOS WebView）不支持语音输入";
      mic.onclick = () => toast("当前设备不支持语音输入，请直接输入文字，或点「＋添加图片」上传报告/处方照片");
      return;
    }
    mic.onclick = () => {
      if (capture.recording) {
        stopRecording();
        return;
      }
      const rec = new SR();
      rec.lang = "zh-CN";
      rec.interimResults = true;
      rec.continuous = true;
      capture.recognizer = rec;
      capture.recording = true;
      mic.classList.add("recording");
      $("#cap-mic-status").textContent = "正在聆听…（再次点击结束）";
      rec.onresult = (e) => {
        let txt = "";
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        const ta = $("#cap-text");
        ta.value = txt;
      };
      rec.onerror = (e) => {
        $("#cap-mic-status").textContent = "语音识别出错：" + e.error + "（可手动输入）";
        stopRecording();
      };
      rec.onend = () => stopRecording();
      try {
        rec.start();
      } catch (e) {
        stopRecording();
      }
    };
  }
  function stopRecording() {
    capture.recording = false;
    if (capture.recognizer) {
      try {
        capture.recognizer.stop();
      } catch (e) {}
      capture.recognizer = null;
    }
    const mic = $("#cap-mic");
    if (mic) mic.classList.remove("recording");
    const st = $("#cap-mic-status");
    if (st && st.textContent.indexOf("正在聆听") >= 0) st.textContent = "已停止，可补充或修改文字后解析。";
  }

  // 智能解析并归档：先写「解析中」记录 + 收起弹窗，后台解析完成后自动归档
  async function startParse() {
    const transcript = $("#cap-text").value.trim();
    if (!transcript && !capture.images.length) {
      toast("请先输入文字或添加图片");
      return;
    }
    const rec = await NurseStorage.appendRecord({
      source: capture.mode === "upload" ? "upload" : transcript ? "recording" : "upload",
      transcript: transcript,
      images: capture.images,
      result: null,
      manual: false,
      status: "parsing",
    });
    DATA = await NurseStorage.load();
    closeModal();
    renderRecords();
    renderHome();
    toast("已提交，正在后台解析…");
    runParse(rec.id);
  }

  // 后台执行解析：成功 -> status=done + 同步药箱；失败 -> status=failed
  async function runParse(id) {
    const rec = await NurseStorage.getRecord(id);
    if (!rec || rec.status !== "parsing") return;
    const transcript = rec.transcript || "";
    const images = rec.images || [];
    const s = DATA.settings;
    let result = null;
    try {
      if (s.ai.enabled && s.ai.apiKey) {
        result = await NurseAI.parse({ transcript, images, settings: s });
      } else {
        result = NurseEngine.parse(transcript || "（仅图片，无文字）");
        if (!transcript) {
          result = {
            engine: "rule",
            diseases: [],
            medications: [],
            tasks: [],
            advice: { taboo: [], diet: [] },
            risks: [],
            summary: "",
            disclaimer: "未提供文字，本地引擎无法解析，建议开启 AI 以识别图片。",
          };
        }
      }
    } catch (err) {
      await NurseStorage.updateRecord(id, { status: "failed", result: null });
      DATA = await NurseStorage.load();
      renderRecords();
      renderHome();
      toast("解析失败：" + (err && err.message ? err.message : err));
      return;
    }
    await NurseStorage.updateRecord(id, { status: "done", result: result });
    let added = 0;
    if (result && result.medications && result.medications.length) {
      const diseases = result.diseases || [];
      added = await syncMedsToCabinet(result.medications, diseases);
    }
    DATA = await NurseStorage.load();
    renderRecords();
    renderHome();
    if (added > 0) toast(`解析完成，并同步 ${added} 种药品到药箱`);
    else toast("解析完成，已自动归档");
  }

  // 仅归档（不解析）：保存纯文本/图片记录，status=done、result=null
  async function saveCapture() {
    const transcript = $("#cap-text").value.trim();
    if (!transcript && !capture.images.length) {
      toast("没有可归档的内容");
      return;
    }
    await NurseStorage.appendRecord({
      source: capture.mode === "upload" ? "upload" : transcript ? "recording" : "upload",
      transcript: transcript,
      images: capture.images,
      result: null,
      manual: true,
      status: "done",
    });
    DATA = await NurseStorage.load();
    closeModal();
    renderRecords();
    renderHome();
    toast("已归档");
  }

  // 每日药箱自动扣减：按 dailyDose 减少余量，每天最多执行一次
  async function runDailyDecrement() {
    const today = dateKey(new Date());
    const data = await NurseStorage.load();
    if (data.lastDecrement === today) {
      DATA.lastDecrement = today;
      return;
    }
    let changed = false;
    for (const it of data.cabinet) {
      if (it.status !== "active") continue;
      if (it.dailyDose > 0 && it.qty > 0) {
        it.qty = Math.max(0, Math.round((it.qty - it.dailyDose) * 100) / 100);
        if (it.qty <= 0) it.status = "out";
        changed = true;
      }
    }
    if (changed) {
      data.lastDecrement = today;
      await NurseStorage.save(data);
      DATA = data;
    } else {
      await NurseStorage.setLastDecrement(today);
      DATA.lastDecrement = today;
    }
  }

  // ===================== 我的药箱 =====================
  function statusLabel(s) {
    return s === "active" ? "使用中" : s === "disabled" ? "停用" : s === "out" ? "缺药" : "使用中";
  }

  function buildCabinetMeta(name, disease) {
    const intro = `【${name}】请按医生医嘱规律服用，不要自行增减剂量、停药或更换药品。若出现皮疹、胃肠不适、头晕等异常反应，请及时就诊。`;
    const kb = disease && NurseEngine.DISEASE_KB && NurseEngine.DISEASE_KB[disease];
    let precautions = [];
    let advice = "";
    if (kb) {
      precautions = (kb.taboo || []).slice(0, 3);
      advice = `您本次关联的病种为「${disease}」。${kb.diet && kb.diet[0] ? kb.diet[0] + "；" : ""}服药期间请遵医嘱复查，记录血压/血糖等指标变化，若出现不适及时就诊。`;
    }
    if (!precautions.length) {
      precautions = ["遵医嘱用药，不自行调整剂量", "用药期间注意监测身体反应", "定期复诊并携带当前用药清单"];
    }
    if (!advice) {
      advice = "请按医嘱规律服药，定期复诊，带上当前所有药品清单供医生核对。";
    }
    return { intro, precautions, advice };
  }

  async function syncMedsToCabinet(meds, diseases) {
    DATA = await NurseStorage.load();
    let added = 0;
    for (const m of meds) {
      if (!m.name || !m.name.trim()) continue;
      const exists = (DATA.cabinet || []).find((c) => c.name === m.name.trim());
      if (exists) continue;
      const disease = m.disease || (diseases && diseases[0]) || "";
      const meta = buildCabinetMeta(m.name, disease);
      await NurseStorage.upsertCabinetItem({
        name: m.name,
        spec: m.dose || "",
        qty: 0,
        unit: "片",
        dailyDose: 1,
        threshold: 7,
        status: "active",
        intro: meta.intro,
        precautions: meta.precautions,
        advice: meta.advice,
        note: m.note || "",
      });
      added++;
    }
    return added;
  }

  async function syncRecordMedsToCabinet(rec) {
    if (!rec || !rec.result || !rec.result.medications) return;
    const added = await syncMedsToCabinet(rec.result.medications, rec.result.diseases || []);
    DATA = await NurseStorage.load();
    toast(added > 0 ? `已同步 ${added} 种药品到药箱` : "药箱中已有这些药品");
    closeModal();
    goPage("cabinet");
  }

  function renderCabinet() {
    const listBox = $("#cabinet-list");
    const empty = $("#cabinet-empty");
    const items = DATA.cabinet || [];

    // 统计
    const counts = { active: 0, disabled: 0, out: 0 };
    items.forEach((it) => {
      if (counts[it.status] !== undefined) counts[it.status]++;
    });
    $("#cab-active-count").textContent = counts.active;
    $("#cab-disabled-count").textContent = counts.disabled;
    $("#cab-out-count").textContent = counts.out;

    // 过滤
    const filtered = cabinetState.filter === "all" ? items : items.filter((it) => it.status === cabinetState.filter);

    if (!filtered.length) {
      listBox.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    listBox.innerHTML = filtered
      .map((it) => {
        const ratio = it.dailyDose > 0 ? Math.min(1, Math.max(0, it.qty / Math.max(it.threshold * 2, it.dailyDose * 14))) : it.qty > 0 ? 1 : 0;
        const fillClass = it.qty <= 0 ? "empty" : it.qty <= it.threshold ? "low" : "";
        const hint = it.qty <= 0 ? `<div class="cab-item__hint">⚠️ 已缺药，请及时补充</div>` : it.qty <= it.threshold ? `<div class="cab-item__hint">⚠️ 库存不足，建议补药</div>` : "";
        return `<div class="cab-item ${esc(it.status)}" data-cab-id="${esc(it.id)}">
          <div class="cab-item__top">
            <div>
              <div class="cab-item__name">${esc(it.name)}</div>
              ${it.spec ? `<div class="cab-item__spec">${esc(it.spec)}</div>` : ""}
            </div>
            <span class="cab-status ${esc(it.status)}">${statusLabel(it.status)}</span>
          </div>
          <div class="cab-item__stock">
            <span>余量</span>
            <div class="cab-stock__bar"><div class="cab-stock__fill ${fillClass}" style="width:${Math.round(ratio * 100)}%"></div></div>
            <span><b>${it.qty}</b> ${esc(it.unit)}</span>
          </div>
          ${hint}
        </div>`;
      })
      .join("");
  }

  function openCabinetDetail(id) {
    const it = (DATA.cabinet || []).find((c) => c.id === id);
    if (!it) return;
    $("#cab-modal-title").textContent = "药品详情";
    const body = $("#cab-body");
    body.innerHTML = `
      <div class="cab-detail__head">
        <div>
          <div class="cab-detail__title">${esc(it.name)}</div>
          ${it.spec ? `<div class="cab-detail__spec">${esc(it.spec)}</div>` : ""}
        </div>
        <span class="cab-status ${esc(it.status)}">${statusLabel(it.status)}</span>
      </div>

      ${it.disease ? `<div class="cab-detail__sec"><h4>🩺 针对病症</h4><p>${esc(it.disease)}</p></div>` : ""}

      <div class="cab-detail__sec">
        <h4>📦 库存</h4>
        <p>剩余 <b>${it.qty}</b> ${esc(it.unit)}，每日消耗 ${it.dailyDose} ${esc(it.unit)}，低于 ${it.threshold} ${esc(it.unit)} 时提醒补药。</p>
      </div>

      <div class="cab-detail__sec">
        <h4>📖 药品介绍</h4>
        <p>${it.intro ? esc(it.intro) : '<span class="cab-detail__empty">暂无介绍</span>'}</p>
      </div>

      <div class="cab-detail__sec">
        <h4>⚠️ 注意事项</h4>
        ${it.precautions && it.precautions.length ? `<ul>${it.precautions.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : '<p class="cab-detail__empty">暂无注意事项</p>'}
      </div>

      <div class="cab-detail__sec">
        <h4>💡 针对个人用药建议</h4>
        <p>${it.advice ? esc(it.advice) : '<span class="cab-detail__empty">暂无建议</span>'}</p>
      </div>

      ${it.note ? `<div class="cab-detail__sec"><h4>📝 备注</h4><p>${esc(it.note)}</p></div>` : ""}

      <div class="cab-detail__actions">
        <button class="btn btn-primary" id="cab-edit-btn">编辑</button>
        <button class="btn btn-ghost" id="cab-status-btn">${it.status === "active" ? "停用" : "启用"}</button>
      </div>
      <button class="btn btn-primary block" id="cab-del-btn" style="background:var(--danger);margin-top:10px">删除药品</button>
    `;
    $("#cab-modal").hidden = false;
    $("#cab-edit-btn").onclick = () => openCabinetEdit(id);
    $("#cab-status-btn").onclick = () => toggleCabinetStatus(id);
    $("#cab-del-btn").onclick = () => deleteCabinetItem(id);
  }

  function openCabinetEdit(id) {
    const isNew = !id;
    const it = isNew ? { name: "", spec: "", qty: 0, unit: "片", dailyDose: 1, threshold: 7, status: "active", intro: "", precautions: [], advice: "", note: "" } : (DATA.cabinet || []).find((c) => c.id === id) || {};
    cabinetState.editing = isNew ? null : id;
    $("#cab-modal-title").textContent = isNew ? "添加药品" : "编辑药品";
    $("#cab-body").innerHTML = renderCabinetForm(it, isNew);
    $("#cab-modal").hidden = false;
    bindCabinetForm();
  }

  function renderCabinetForm(it, isNew) {
    const precautions = (it.precautions || []).map((p, i) => `<span class="cab-edit__tag">${esc(p)} <button type="button" data-rm-prec="${i}">✕</button></span>`).join("");
    return `
      <div class="cab-edit__field">
        <span>药品名称 *</span>
        <input type="text" id="cab-f-name" value="${esc(it.name)}" placeholder="如：苯磺酸氨氯地平片" />
      </div>
      <div class="cab-edit__row">
        <div class="cab-edit__field">
          <span>规格</span>
          <input type="text" id="cab-f-spec" value="${esc(it.spec)}" placeholder="如 5mg/片" />
        </div>
        <div class="cab-edit__field">
          <span>单位</span>
          <input type="text" id="cab-f-unit" value="${esc(it.unit || "片")}" placeholder="片/粒/支" />
        </div>
      </div>
      <div class="cab-edit__row">
        <div class="cab-edit__field">
          <span>当前余量</span>
          <input type="number" id="cab-f-qty" value="${Number(it.qty) || 0}" min="0" />
        </div>
        <div class="cab-edit__field">
          <span>每日消耗</span>
          <input type="number" id="cab-f-daily" value="${Number(it.dailyDose) || 0}" min="0" step="0.5" />
        </div>
        <div class="cab-edit__field">
          <span>库存阈值</span>
          <input type="number" id="cab-f-threshold" value="${Number(it.threshold) || 0}" min="0" />
        </div>
      </div>
      <div class="cab-edit__field">
        <span>状态</span>
        <select id="cab-f-status">
          <option value="active" ${it.status === "active" ? "selected" : ""}>使用中</option>
          <option value="disabled" ${it.status === "disabled" ? "selected" : ""}>停用</option>
          <option value="out" ${it.status === "out" ? "selected" : ""}>缺药</option>
        </select>
      </div>
      <div class="cab-edit__field">
        <span>针对病症</span>
        <input type="text" id="cab-f-disease" value="${esc(it.disease)}" placeholder="如：高血压、糖尿病（逗号分隔）" />
      </div>
      <div class="cab-edit__field">
        <span>药品介绍</span>
        <textarea id="cab-f-intro" placeholder="简单介绍该药品作用">${esc(it.intro)}</textarea>
      </div>
      <div class="cab-edit__field">
        <span>注意事项</span>
        <div class="cab-edit__tags" id="cab-f-prec-tags">${precautions}</div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <input type="text" id="cab-f-prec-input" placeholder="输入后点击添加" style="flex:1" />
          <button type="button" class="btn btn-ghost" id="cab-f-prec-add">添加</button>
        </div>
      </div>
      <div class="cab-edit__field">
        <span>针对个人用药建议</span>
        <textarea id="cab-f-advice" placeholder="结合个人病情给出用药建议">${esc(it.advice)}</textarea>
      </div>
      <div class="cab-edit__field">
        <span>备注</span>
        <input type="text" id="cab-f-note" value="${esc(it.note)}" placeholder="其他备注" />
      </div>
      <button class="btn btn-primary block" id="cab-f-save">${isNew ? "添加" : "保存"}</button>
    `;
  }

  let formPrecautions = [];
  function bindCabinetForm() {
    formPrecautions = [];
    // 从现有标签收集
    $$("#cab-f-prec-tags .cab-edit__tag").forEach((tag) => {
      const txt = tag.textContent.replace(/✕\s*$/, "").trim();
      if (txt) formPrecautions.push(txt);
    });

    const renderTags = () => {
      $("#cab-f-prec-tags").innerHTML = formPrecautions
        .map((p, i) => `<span class="cab-edit__tag">${esc(p)} <button type="button" data-rm-prec="${i}">✕</button></span>`)
        .join("");
      $$("#cab-f-prec-tags [data-rm-prec]").forEach((b) => {
        b.onclick = () => {
          formPrecautions.splice(+b.dataset.rmPrec, 1);
          renderTags();
        };
      });
    };
    renderTags();

    $("#cab-f-prec-add").onclick = () => {
      const input = $("#cab-f-prec-input");
      const val = input.value.trim();
      if (!val) return;
      formPrecautions.push(val);
      input.value = "";
      renderTags();
    };

    $("#cab-f-save").onclick = saveCabinetItem;
  }

  async function saveCabinetItem() {
    const name = $("#cab-f-name").value.trim();
    if (!name) {
      toast("请填写药品名称");
      return;
    }
    const item = {
      id: cabinetState.editing,
      name,
      spec: $("#cab-f-spec").value.trim(),
      qty: Number($("#cab-f-qty").value) || 0,
      unit: $("#cab-f-unit").value.trim() || "片",
      dailyDose: Number($("#cab-f-daily").value) || 0,
      threshold: Number($("#cab-f-threshold").value) || 0,
      status: $("#cab-f-status").value,
      disease: $("#cab-f-disease").value.trim(),
      intro: $("#cab-f-intro").value.trim(),
      precautions: formPrecautions,
      advice: $("#cab-f-advice").value.trim(),
      note: $("#cab-f-note").value.trim(),
    };
    await NurseStorage.upsertCabinetItem(item);
    DATA = await NurseStorage.load();
    closeModal();
    renderCabinet();
    toast(cabinetState.editing ? "已保存" : "已添加");
  }

  async function toggleCabinetStatus(id) {
    const it = (DATA.cabinet || []).find((c) => c.id === id);
    if (!it) return;
    const next = it.status === "active" ? "disabled" : "active";
    await NurseStorage.updateCabinetItem(id, { status: next });
    DATA = await NurseStorage.load();
    openCabinetDetail(id);
    renderCabinet();
    toast(next === "active" ? "已启用" : "已停用");
  }

  async function deleteCabinetItem(id) {
    if (!confirm("确定从药箱删除这条药品？")) return;
    await NurseStorage.deleteCabinetItem(id);
    DATA = await NurseStorage.load();
    closeModal();
    renderCabinet();
    toast("已删除");
  }

  // ===================== 首页「提醒 / 待办」页签 =====================
  function applyHomeTab() {
    $$(".home-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.htab === homeTab));
    const remind = $("#htab-remind");
    const todo = $("#htab-todo");
    if (remind) remind.hidden = homeTab !== "remind";
    if (todo) todo.hidden = homeTab !== "todo";
  }
  function switchHomeTab(tab) {
    homeTab = tab;
    applyHomeTab();
  }

  // 首页「个人提醒」列表（来自 settings.reminders）
  function renderPersonalReminders() {
    const box = $("#home-reminders");
    if (!box) return;
    const rems = (DATA.settings.reminders || []).filter((r) => r.enabled && r.date);
    if (!rems.length) {
      box.innerHTML = '<div class="empty-tip">还没有个人提醒。去「我的 → 提醒设置」添加就诊、复诊、复查等。</div>';
      const c = $("#home-reminders-count");
      if (c) c.textContent = "";
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
            <div class="reminder-item__meta">${esc(r.date)}${r.time ? " " + esc(r.time) : ""} · 提前 ${r.advanceDays} 天提醒</div>
          </div>
          <div class="reminder-item__left">${left}</div>
        </div>`;
      })
      .join("");
    const c = $("#home-reminders-count");
    if (c) c.textContent = rems.length + " 项";
  }

  // ===================== 个人提醒管理（我的 → 提醒设置） =====================
  function renderRemindersList() {
    const box = $("#reminders-list");
    if (!box) return;
    const rems = DATA.settings.reminders || [];
    const sub = $("#reminders-sub");
    if (sub) sub.textContent = rems.length ? rems.length + " 个" : "";
    if (!rems.length) {
      box.innerHTML = '<div class="empty-tip">还没有个人提醒。点「＋ 新增」添加就诊、复诊、复查等。</div>';
      return;
    }
    box.innerHTML = rems
      .map((r) => {
        const icon = r.type === "visit" ? "🏥" : "📌";
        return `<div class="reminder-row ${r.enabled ? "" : "is-off"}" data-rem-id="${esc(r.id)}">
          <div class="reminder-row__main">
            <div class="reminder-row__title">${icon} ${esc(r.title)}</div>
            <div class="reminder-row__meta">${esc(r.date)}${r.time ? " " + esc(r.time) : ""} · 提前 ${r.advanceDays} 天${r.enabled ? "" : " · 已停用"}</div>
          </div>
          <div class="reminder-row__ops">
            <button class="icon-btn" data-rem-edit="${esc(r.id)}" title="编辑">✎</button>
            <button class="icon-btn icon-btn--danger" data-rem-del="${esc(r.id)}" title="删除">🗑</button>
          </div>
        </div>`;
      })
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
    if (!title) {
      toast("请填写提醒名称");
      return;
    }
    const data = await NurseStorage.load();
    const rems = data.settings.reminders || [];
    const payload = {
      title,
      type: $("#rem-type").value,
      date: $("#rem-date").value,
      time: $("#rem-time").value,
      advanceDays: Number($("#rem-advance").value) || 0,
      enabled: $("#rem-enabled").checked,
    };
    if (editingReminderId) {
      const idx = rems.findIndex((x) => x.id === editingReminderId);
      if (idx >= 0) rems[idx] = Object.assign({}, rems[idx], payload);
    } else {
      rems.unshift(
        Object.assign({ id: "rem_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }, payload)
      );
    }
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

  // ===================== AI 设置：折叠 / 展开 =====================
  function renderAISummary() {
    const s = DATA.settings;
    const txt = $("#ai-summary-text");
    if (!txt) return;
    if (s.ai.enabled) {
      txt.textContent = "已开启 · " + (s.ai.model || "gpt-4o");
      txt.classList.add("on");
    } else {
      txt.textContent = "未开启（使用本地引擎）";
      txt.classList.remove("on");
    }
  }
  function openAIEdit() {
    $("#ai-summary").hidden = true;
    $("#ai-edit").hidden = false;
    $("#ai-enabled").checked = !!DATA.settings.ai.enabled;
    $("#ai-baseurl").value = DATA.settings.ai.baseUrl || "https://api.openai.com/v1";
    $("#ai-model").value = DATA.settings.ai.model || "gpt-4o";
    $("#ai-key").value = DATA.settings.ai.apiKey || "";
    $("#ai-fields").hidden = !DATA.settings.ai.enabled;
  }
  function closeAIEdit() {
    $("#ai-edit").hidden = true;
    $("#ai-summary").hidden = false;
    renderAISummary();
  }

  // ===================== 设置 =====================
  async function saveAISettings() {
    await NurseStorage.updateSettings({
      ai: {
        enabled: $("#ai-enabled").checked,
        baseUrl: $("#ai-baseurl").value.trim(),
        apiKey: $("#ai-key").value.trim(),
        model: $("#ai-model").value.trim() || "gpt-4o",
      },
    });
    DATA = await NurseStorage.load();
    $("#ai-fields").hidden = !DATA.settings.ai.enabled;
    toast("AI 设置已保存");
  }

  async function saveReminderSettings() {
    await NurseStorage.updateSettings({
      medReminderMinutes: Number($("#opt-med-min").value) || 0,
    });
    DATA = await NurseStorage.load();
    renderHome();
    toast("提醒设置已保存");
  }

  async function toggleNotify() {
    const on = $("#opt-notify").checked;
    if (on && "Notification" in window && Notification.permission === "default") {
      try {
        const p = await Notification.requestPermission();
        if (p !== "granted") {
          $("#opt-notify").checked = false;
          toast("未授予通知权限");
          return;
        }
      } catch (e) {}
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
    // iOS：优先走系统原生分享（可直接存到「文件」/iCloud/微信，避免卸载丢失）
    if (navigator.share) {
      try {
        const file = new File([json], "nurse-data-" + TODAY + ".json", { type: "application/json" });
        await navigator.share({
          title: "私人护士 · 健康档案备份",
          text: "点「存储到文件」即可保存到 iCloud/本机，避免卸载丢失历史记录。",
          files: [file],
        });
        toast("已调起分享，请选择「存储到文件」");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // 用户取消，不提示
        // 不支持文件分享时回退到下载
      }
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
    } catch (e) {
      toast("导入失败：文件格式不正确");
    }
  }

  // ===================== 事件绑定 =====================
  function bindEvents() {
    $$(".tabbar__btn").forEach((b) => (b.onclick = () => goPage(b.dataset.page)));
    $("#btn-record").onclick = () => openCapture("record");
    $("#btn-upload").onclick = () => openCapture("upload");

    $$("[data-close]").forEach((el) => (el.onclick = closeModal));

    $("#cap-add-image").onclick = pickNativeImages;
    $("#cap-images").onchange = (e) => {
      if (e.target.files && e.target.files.length) addImages(e.target.files);
      e.target.value = "";
    };
    $("#cap-parse").onclick = startParse;
    $("#cap-save-only").onclick = () => saveCapture();

    // 首页勾选
    $("#home-meds").onclick = (e) => {
      const card = e.target.closest(".med");
      if (card) toggleMed(card.dataset.medId, card.dataset.time);
    };
    $("#home-tasks").onclick = (e) => {
      const card = e.target.closest(".task");
      if (card) toggleTask(card.dataset.taskId);
    };

    // 记录列表 -> 详情
    $("#records-list").onclick = (e) => {
      const card = e.target.closest(".rec-card");
      if (card) openDetail(card.dataset.recId);
    };

    // 药箱
    $$(".cab-filter").forEach((b) => {
      b.onclick = () => {
        cabinetState.filter = b.dataset.filter;
        $$(".cab-filter").forEach((x) => x.classList.toggle("is-active", x === b));
        renderCabinet();
      };
    });
    $("#btn-add-cab").onclick = () => openCabinetEdit(null);
    $("#cabinet-list").onclick = (e) => {
      const card = e.target.closest(".cab-item");
      if (card) openCabinetDetail(card.dataset.cabId);
    };

    // 设置
    $("#ai-enabled").onchange = saveAISettings;
    ["#ai-baseurl", "#ai-model", "#ai-key"].forEach((s) => ($(s).onchange = saveAISettings));
    $("#opt-notify").onchange = toggleNotify;
    $("#opt-large").onchange = toggleLarge;
    ["#opt-med-min"].forEach((s) => ($(s).onchange = saveReminderSettings));

    // 首页「提醒 / 待办」页签切换
    $$(".home-tab").forEach((b) => (b.onclick = () => switchHomeTab(b.dataset.htab)));
    // AI 设置折叠 / 展开
    $("#ai-edit-btn").onclick = openAIEdit;
    $("#ai-done-btn").onclick = () => {
      saveAISettings();
      closeAIEdit();
    };
    // 个人提醒：新增 / 编辑 / 删除
    $("#btn-add-reminder").onclick = () => openReminderModal(null);
    $("#reminders-list").onclick = (e) => {
      const ed = e.target.closest("[data-rem-edit]");
      const del = e.target.closest("[data-rem-del]");
      if (ed) openReminderModal(ed.dataset.remEdit);
      else if (del) deleteReminder(del.dataset.remDel);
    };
    $("#rem-save").onclick = saveReminder;
    $("#rem-cancel").onclick = () => ($("#reminder-modal").hidden = true);
    $("#btn-export").onclick = exportData;
    $("#btn-import").onclick = () => $("#import-file").click();
    $("#import-file").onchange = (e) => {
      if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    };
  }

  // 启动
  const boot = () =>
    init()
      .then(setupMic)
      .catch((e) => {
        toast("初始化失败：" + ((e && e.message) || e));
        console.error("[nurse] init failed:", e);
      });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
