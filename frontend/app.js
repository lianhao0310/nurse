/*
 * 私人护士 · 前端交互逻辑
 * 三页 Tab：首页（今日看板）/ 问诊记录 / 我的
 * 录音/上传 -> AI 或本地引擎解析 -> 可编辑 -> 保存
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
    mode: "record", // record | upload
    images: [], // {name,type,dataUrl}
    parsed: null, // 解析结果（编辑前）
    editMeds: [],
    editTasks: [],
    recording: false,
    recognizer: null,
  };

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
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // ===================== 初始化 =====================
  async function init() {
    DATA = await NurseStorage.load();
    applySettingsUI();
    bindEvents();
    renderHome();
    renderRecords();
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
  }

  // ===================== 页面路由 =====================
  function goPage(page) {
    $$(".page").forEach((p) => (p.hidden = p.id !== "page-" + page));
    $$(".tabbar__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.page === page));
    if (page === "home") {
      setHeader("私人护士", "");
      renderHome();
    } else if (page === "records") {
      setHeader("问诊记录", "");
      renderRecords();
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

    scheduleNotifications(medItems, done);
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
    for (const m of medItems) {
      if (m.done) continue;
      const [hh, mm] = m.time.split(":").map(Number);
      const t = new Date();
      t.setHours(hh, mm, 0, 0);
      let diff = t.getTime() - now;
      if (diff < 0) diff += 24 * 3600 * 1000; // 次日
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
        const imgBadge = rec.images && rec.images.length ? `<span class="rec-card__badge badge-img">📷 ${rec.images.length}</span>` : "";
        const chips = diseases.map((d) => `<span class="chip">${esc(d)}</span>`).join("");
        return `<div class="rec-card" data-rec-id="${esc(rec.id)}">
          <div class="rec-card__top">
            <span class="rec-card__date">${esc(fmtDate(rec.createdAt))}</span>
            <span>${badge}${imgBadge}</span>
          </div>
          ${chips ? `<div class="rec-card__diseases">${chips}</div>` : ""}
          <div class="rec-card__stat">
            <span>💊 <b>${meds.length}</b> 用药</span>
            <span>✅ <b>${tasks.length}</b> 待办</span>
            <span>⚠️ <b>${(res.risks || []).length}</b> 风险</span>
          </div>
        </div>`;
      })
      .join("");
  }

  function openDetail(id) {
    const rec = DATA.records.find((r) => r.id === id);
    if (!rec) return;
    const res = rec.result || {};
    const body = $("#detail-body");
    let html = "";
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
      html += `<div class="detail-sec"><h3>用药</h3><ul>${meds
        .map((m) => `<li><b>${esc(m.name)}</b> ${esc(m.dose)} ${esc(m.freq)} ${esc(m.time)} ${m.note ? "· " + esc(m.note) : ""}</li>`)
        .join("")}</ul></div>`;
    }
    const tasks = res.tasks || [];
    if (tasks.length) {
      html += `<div class="detail-sec"><h3>待办 / 生活医嘱</h3><ul>${tasks
        .map((t) => `<li><b>${esc(t.title)}</b>：${esc(t.detail)}${t.due ? "（" + esc(t.due) + "）" : ""}</li>`)
        .join("")}</ul></div>`;
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

    html += `<div class="detail-actions">
      <button class="btn btn-ghost block" id="detail-close">关闭</button>
      <button class="btn btn-primary block" id="detail-del" data-rec-id="${esc(rec.id)}" style="background:var(--danger)">删除记录</button>
    </div>`;
    body.innerHTML = html;
    $("#detail-modal").hidden = false;
    $("#detail-close").onclick = closeModal;
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
  }

  function sourceLabel(s) {
    return s === "recording" ? "录音" : s === "upload" ? "上传归档" : "文字";
  }
  function levelLabel(l) {
    return l === "red" ? "紧急" : l === "yellow" ? "警惕" : "一般";
  }

  // ===================== 录音 / 上传 弹层 =====================
  function openCapture(mode) {
    capture.mode = mode;
    capture.images = [];
    capture.parsed = null;
    capture.editMeds = [];
    capture.editTasks = [];
    $("#capture-title").textContent = mode === "upload" ? "上传归档" : "录音问诊";
    $("#cap-text").value = "";
    $("#cap-preview").innerHTML = "";
    $("#cap-mic-status").textContent = "";
    $("#cap-result").hidden = true;
    $("#cap-text").disabled = false;
    $("#capture-modal").hidden = false;
  }

  function closeModal() {
    $$(".modal").forEach((m) => (m.hidden = true));
    stopRecording();
  }

  // 图片降采样后加入 state
  async function addImages(files) {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const dataUrl = await downscaleImage(f, 1280, 0.82);
      capture.images.push({ name: f.name, type: "image/jpeg", dataUrl });
    }
    renderPreview();
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

  // 语音输入（Web Speech API，尽力而为）
  function setupMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = $("#cap-mic");
    if (!SR) {
      mic.disabled = true;
      mic.style.opacity = 0.4;
      mic.title = "当前环境不支持语音，请手动输入";
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

  // 解析
  async function doParse() {
    const transcript = $("#cap-text").value.trim();
    if (!transcript && !capture.images.length) {
      toast("请先输入文字或添加图片");
      return;
    }
    const s = DATA.settings;
    let result = null;
    const useAI = s.ai.enabled && s.ai.apiKey;
    toast(useAI ? "AI 解析中…" : "本地解析中…");
    try {
      if (useAI) {
        result = await NurseAI.parse({ transcript, images: capture.images, settings: s });
      } else {
        result = NurseEngine.parse(transcript || "（仅图片，无文字）");
        if (!transcript) {
          // 仅图片无文字时，规则引擎无意义，给出空结构
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
      toast("解析失败：" + err.message);
      return;
    }
    capture.parsed = result;
    capture.editMeds = (result.medications || []).map((m) => Object.assign({}, m));
    capture.editTasks = (result.tasks || []).map((t) => Object.assign({}, t));
    renderEditResult();
    $("#cap-result").hidden = false;
    toast("解析完成，可手动调整后保存");
  }

  function renderEditResult() {
    const medBox = $("#edit-meds");
    medBox.innerHTML = capture.editMeds
      .map(
        (m, i) => `<div class="edit-row" data-i="${i}">
          <span class="edit-row__del" data-del-med="${i}">删除</span>
          <input data-f="name" value="${esc(m.name)}" placeholder="药名" />
          <div class="edit-row__cols">
            <input data-f="dose" value="${esc(m.dose)}" placeholder="剂量" />
            <input data-f="freq" value="${esc(m.freq)}" placeholder="频次" />
          </div>
          <div class="edit-row__cols">
            <input data-f="time" value="${esc(m.time)}" placeholder="时间" />
            <input data-f="note" value="${esc(m.note)}" placeholder="说明" />
          </div>
        </div>`
      )
      .join("");
    const taskBox = $("#edit-tasks");
    taskBox.innerHTML = capture.editTasks
      .map(
        (t, i) => `<div class="edit-row" data-i="${i}">
          <span class="edit-row__del" data-del-task="${i}">删除</span>
          <input data-f="title" value="${esc(t.title)}" placeholder="待办标题" />
          <input data-f="detail" value="${esc(t.detail)}" placeholder="说明" />
        </div>`
      )
      .join("");
    bindEditInputs();
  }
  function bindEditInputs() {
    $$("#edit-meds .edit-row").forEach((row) => {
      const i = +row.dataset.i;
      $$("input", row).forEach((inp) => {
        inp.oninput = () => (capture.editMeds[i][inp.dataset.f] = inp.value);
      });
      const del = row.querySelector("[data-del-med]");
      if (del) del.onclick = () => {
        capture.editMeds.splice(i, 1);
        renderEditResult();
      };
    });
    $$("#edit-tasks .edit-row").forEach((row) => {
      const i = +row.dataset.i;
      $$("input", row).forEach((inp) => {
        inp.oninput = () => (capture.editTasks[i][inp.dataset.f] = inp.value);
      });
      const del = row.querySelector("[data-del-task]");
      if (del) del.onclick = () => {
        capture.editTasks.splice(i, 1);
        renderEditResult();
      };
    });
  }

  function addMed() {
    capture.editMeds.push({ name: "", dose: "", freq: "", time: "", note: "", disease: "" });
    renderEditResult();
  }
  function addTask() {
    capture.editTasks.push({ type: "life", title: "", detail: "", freq: "", due: "" });
    renderEditResult();
  }

  // 保存：仅归档 / 解析后保存
  async function saveCapture(onlyArchive) {
    const transcript = $("#cap-text").value.trim();
    if (!onlyArchive && capture.parsed) {
      // 用编辑后的 meds/tasks 覆盖
      capture.parsed.medications = capture.editMeds.filter((m) => m.name && m.name.trim());
      capture.parsed.tasks = capture.editTasks.filter((t) => t.title && t.title.trim());
      // 重新计算提醒时间表
      try {
        capture.parsed.reminders = NurseEngine.schedule_reminders(capture.parsed.medications);
      } catch (e) {
        capture.parsed.reminders = [];
      }
    }
    if (onlyArchive && !transcript && !capture.images.length) {
      toast("没有可归档的内容");
      return;
    }
    const rec = {
      source: capture.mode === "upload" ? "upload" : transcript ? "recording" : "upload",
      transcript: transcript,
      images: capture.images,
      result: onlyArchive ? null : capture.parsed,
      manual: onlyArchive,
    };
    await NurseStorage.appendRecord(rec);
    DATA = await NurseStorage.load();
    closeModal();
    renderHome();
    renderRecords();
    toast(onlyArchive ? "已归档" : "已保存问诊");
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

    $("#cap-images").onchange = (e) => {
      if (e.target.files && e.target.files.length) addImages(e.target.files);
      e.target.value = "";
    };
    $("#cap-parse").onclick = doParse;
    $("#cap-save-only").onclick = () => saveCapture(true);
    $("#cap-confirm").onclick = () => saveCapture(false);
    $("#add-med").onclick = addMed;
    $("#add-task").onclick = addTask;

    // 首页勾选（事件委托）
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

    // 设置
    $("#ai-enabled").onchange = saveAISettings;
    ["#ai-baseurl", "#ai-model", "#ai-key"].forEach((s) => ($(s).onchange = saveAISettings));
    $("#opt-notify").onchange = toggleNotify;
    $("#opt-large").onchange = toggleLarge;
    $("#btn-export").onclick = exportData;
    $("#btn-import").onclick = () => $("#import-file").click();
    $("#import-file").onchange = (e) => {
      if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    };
  }

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init().then(setupMic));
  } else {
    init().then(setupMic);
  }
})();
