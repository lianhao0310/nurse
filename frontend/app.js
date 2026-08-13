// 私人护士 App 前端逻辑
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let currentResult = null;     // 当前解析结果
let recState = { rec: null, timer: null, secs: 0, finalText: "", interim: "" };

// ------------------------- 示例文本 -------------------------
const SAMPLE = `医生：您这次主要是高血压和糖尿病，我给您调整一下用药。降压药继续吃苯磺酸氨氯地平片，每天一次，5毫克，早起空腹吃。二甲双胍缓释片加到0.5克，每天两次，早晚饭后20分钟吃，一周后加量到1克。另外加一个阿托伐他汀钙片，每天一次，10毫克，睡前吃。平时要清淡饮食，少吃盐，每天散步30分钟。回去每天早晚测血压，餐后测血糖。下个月来复诊。要是出现头晕或者心慌手抖出冷汗，赶紧吃点糖，严重的马上去医院。`;

// ------------------------- 录音（Web Speech API） -------------------------
function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("#micBtn").disabled = true;
    $("#recState").textContent = "当前浏览器不支持语音识别，请用「粘贴文本」";
    return null;
  }
  const rec = new SR();
  rec.lang = "zh-CN";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) recState.finalText += t;
      else interim += t;
    }
    $("#transcript").textContent = recState.finalText + interim;
  };
  rec.onerror = (e) => {
    $("#recState").textContent = "识别出错：" + e.error + "（可改用粘贴文本）";
    stopRec();
  };
  rec.onend = () => { if (recState.rec && recState.rec._active) try { rec.start(); } catch (_) {} };
  return rec;
}

function startRec() {
  if (!recState.rec) recState.rec = setupSpeech();
  if (!recState.rec) return;
  recState.rec._active = true;
  recState.finalText = "";
  recState.secs = 0;
  $("#transcript").textContent = "";
  try { recState.rec.start(); } catch (_) {}
  $("#micBtn").classList.add("recording");
  $("#stopBtn").disabled = false;
  $("#recState").textContent = "正在录音…（医生与您对话中）";
  recState.timer = setInterval(() => {
    recState.secs++;
    const m = String(Math.floor(recState.secs / 60)).padStart(2, "0");
    const s = String(recState.secs % 60).padStart(2, "0");
    $("#timer").textContent = `${m}:${s}`;
  }, 1000);
}

function stopRec() {
  if (recState.rec) { recState.rec._active = false; try { recState.rec.stop(); } catch (_) {} }
  clearInterval(recState.timer);
  $("#micBtn").classList.remove("recording");
  $("#stopBtn").disabled = true;
  $("#recState").textContent = "录音结束，正在解析…";
  const text = (recState.finalText + ($("#transcript").textContent || "")).trim();
  if (text) doParse(text);
  else $("#recState").textContent = "未识别到内容，请重试或粘贴文本";
}

// ------------------------- 解析（本地引擎，零后端） -------------------------
async function doParse(text) {
  if (!text.trim()) { alert("请先录音或粘贴文本"); return; }
  $("#loading").classList.remove("hidden");
  $("#result").classList.add("hidden");
  try {
    // 优先使用内置本地引擎（iOS / 浏览器均可离线运行）；
    // 仅在引擎缺失时回退到后端 /api/parse（本地 Web 演示用）
    let data;
    if (window.NurseEngine && typeof window.NurseEngine.parse === "function") {
      data = window.NurseEngine.parse(text);
    } else {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      data = await res.json();
      if (data.error) throw new Error(data.error);
    }
    currentResult = data;
    render(data);
    $("#result").classList.remove("hidden");
    // 自动持久化到手机文件系统（换机可导出迁移）
    await NurseStorage.appendRecord({ transcript: text, result: data });
    renderArchive();
  } catch (err) {
    alert("解析失败：" + err.message);
  } finally {
    $("#loading").classList.add("hidden");
    $("#recState").textContent = "点击开始录音（医生问诊时）";
  }
}

// ------------------------- 渲染 -------------------------
function render(d) {
  // 病种
  $("#diseaseChips").innerHTML = (d.diseases || [])
    .map((x) => `<span class="chip">${x}</span>`).join("");

  renderMeds(d.medications || []);
  renderReminders(d.reminders || []);
  renderTasks(d.tasks || []);
  renderAdvice(d.advice || {});
  renderRisks(d.risks || []);
  switchTab("med");
}

function renderMeds(meds) {
  const tb = $("#medBody");
  if (!meds.length) { tb.innerHTML = `<tr><td colspan="5" style="color:#9aa6b2">未识别到药物</td></tr>`; return; }
  tb.innerHTML = meds.map((m) => {
    const note = m.note ? `<span class="note-hl">${m.note}</span>` : "—";
    return `<tr>
      <td><b>${m.name}</b>${m.note ? "<br>" + note : ""}</td>
      <td>${m.dose || "—"}</td>
      <td>${m.freq || "—"}</td>
      <td>${m.time || "—"}</td>
      <td>${m.disease || "—"}</td>
    </tr>`;
  }).join("");
}

function renderReminders(rem) {
  const ul = $("#reminderList");
  if (!rem.length) { ul.innerHTML = `<li><span class="rm">暂无用药提醒</span></li>`; return; }
  ul.innerHTML = rem.map((r) => `
    <li>
      <span class="rt">${r.time}</span>
      <span class="rm">${r.med} ${r.dose ? "· " + r.dose : ""}</span>
      ${r.note ? `<span class="rn">${r.note}</span>` : ""}
    </li>`).join("");
}

function renderTasks(tasks) {
  const groups = { monitor: [], revisit: [], life: [] };
  tasks.forEach((t) => { (groups[t.type] || groups.life).push(t); });
  const titles = { monitor: "📈 监测项", revisit: "🗓️ 复诊", life: "🌿 生活任务" };
  let html = "";
  for (const k of ["monitor", "revisit", "life"]) {
    if (!groups[k].length) continue;
    html += `<div class="task-sub">${titles[k]}</div>`;
    groups[k].forEach((t, i) => {
      html += `<label class="task-item" data-type="${k}" data-i="${i}">
        <input type="checkbox" />
        <span><span class="t-title">${t.title}</span>
        <span class="t-detail">${t.detail}</span></span>
      </label>`;
    });
  }
  if (!html) html = `<div class="task-item"><span class="t-detail">未识别到非药物指令</span></div>`;
  $("#taskList").innerHTML = html;
  $$("#taskList input").forEach((cb) => cb.addEventListener("change", (e) => {
    e.target.closest(".task-item").classList.toggle("done", e.target.checked);
  }));
}

function renderAdvice(adv) {
  const taboo = adv.taboo || [], diet = adv.diet || [];
  $("#tabooList").innerHTML = taboo.length
    ? taboo.map((t) => `<li><b>${t.disease}：</b>${t.text}</li>`).join("")
    : `<li>暂无</li>`;
  $("#dietList").innerHTML = diet.length
    ? diet.map((t) => `<li><b>${t.disease}：</b>${t.text}</li>`).join("")
    : `<li>暂无</li>`;
}

function renderRisks(risks) {
  const wrap = $("#riskList");
  if (!risks.length) { wrap.innerHTML = `<div class="risk-card"><div class="r-trigger">暂无特定风险预警</div></div>`; return; }
  const lvText = { green: "居家观察", yellow: "加强监测", red: "立即就医" };
  wrap.innerHTML = risks.map((r) => `
    <div class="risk-card ${r.level}">
      <span class="r-level">${lvText[r.level] || r.level}</span>
      <div class="r-disease">${r.disease}</div>
      <div class="r-trigger">⚠️ ${r.trigger}</div>
      <div class="r-action">${r.action}</div>
    </div>`).join("");
}

// ------------------------- Tab 切换 -------------------------
function switchTab(name) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
}
$$(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

// ------------------------- 提醒通知 -------------------------
function enableNotif() {
  if (!("Notification" in window)) { alert("当前环境不支持系统通知"); return; }
  Notification.requestPermission().then((p) => {
    if (p === "granted") {
      alert("已开启。将在设定的用药时间弹出提醒（演示：仅本次会话有效）。");
      scheduleDemoNotif();
    } else alert("未授权通知");
  });
}
function scheduleDemoNotif() {
  const now = new Date();
  (currentResult?.reminders || []).slice(0, 4).forEach((r) => {
    const [h, m] = r.time.split(":").map(Number);
    let fire = new Date(now); fire.setHours(h, m, 0, 0);
    if (fire <= now) fire.setDate(fire.getDate() + 1);
    const delay = fire - now;
    setTimeout(() => {
      new Notification("私人护士 · 用药提醒", {
        body: `${r.med} ${r.dose ? "· " + r.dose : ""}${r.note ? "（" + r.note + "）" : ""}`,
      });
    }, Math.min(delay, 60000)); // 演示上限 60s
  });
}

// ------------------------- 健康档案（手机文件系统持久化） -------------------------
async function saveArchive() {
  if (!currentResult) return;
  await NurseStorage.appendRecord({ transcript: $("#transcript").textContent || "", result: currentResult });
  renderArchive();
  alert("已存入本机（手机文件）健康档案");
}
async function renderArchive() {
  const list = await NurseStorage.getRecords();
  const ul = $("#archiveList");
  if (!list.length) { ul.innerHTML = `<li class="a-empty">暂无档案，解析后可自动存入</li>`; return; }
  ul.innerHTML = list.map((a) => {
    const d = (a.result && a.result.diseases) || [];
    const date = new Date(a.createdAt).toLocaleString("zh-CN");
    const preview = (a.transcript || "").slice(0, 24).replace(/\n/g, " ");
    return `
    <li data-id="${a.id}">
      <span>📝 ${d.join("、") || "问诊记录"}<br>
      <span class="a-date">${date} · ${preview || "（无转写文本）"}</span></span>
      <span class="a-ops">
        <button class="a-del" data-del="${a.id}" aria-label="删除">✕</button>
        查看 ›
      </span>
    </li>`;
  }).join("");
  $$("#archiveList li[data-id]").forEach((li) => li.addEventListener("click", (e) => {
    if (e.target.closest(".a-del")) return; // 删除按钮单独处理
    const item = list.find((x) => String(x.id) === li.dataset.id);
    if (item && item.result) {
      currentResult = item.result;
      render(item.result);
      $("#result").classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }));
  $$("#archiveList .a-del").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (confirm("删除这条档案？")) { await NurseStorage.deleteRecord(b.dataset.del); renderArchive(); }
  }));
}

// ------------------------- 导出 / 导入（换机迁移） -------------------------
async function exportData() {
  const json = await NurseStorage.exportJSON();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nurse-archive-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  // 原生环境（iOS）额外尝试系统分享，便于 AirDrop / 网盘迁移
  try {
    const cap = window.Capacitor;
    const Share = cap && cap.Plugins && cap.Plugins.Share;
    if (Share && typeof Share.share === "function") {
      await Share.share({ title: "私人护士档案", text: json, dialogTitle: "导出健康档案" });
    }
  } catch (_) {}
}
async function importData(file) {
  try {
    const text = await file.text();
    await NurseStorage.importJSON(text);
    renderArchive();
    alert("导入成功，历史档案已合并");
  } catch (e) {
    alert("导入失败：文件格式不正确");
  }
}

// ------------------------- 事件绑定 -------------------------
$("#micBtn").addEventListener("click", startRec);
$("#stopBtn").addEventListener("click", stopRec);
$("#sampleBtn").addEventListener("click", () => {
  $("#transcript").textContent = SAMPLE;
  doParse(SAMPLE);
});
$("#parseBtn").addEventListener("click", () => {
  const t = $("#manualText").value.trim();
  if (t) doParse(t);
});
$("#enableNotif").addEventListener("click", enableNotif);
$("#saveBtn").addEventListener("click", saveArchive);
$("#exportBtn").addEventListener("click", exportData);
$("#importBtn").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) importData(f);
  e.target.value = "";
});
$("#newBtn").addEventListener("click", () => {
  currentResult = null;
  $("#result").classList.add("hidden");
  $("#transcript").textContent = "";
  recState.finalText = "";
  $("#recState").textContent = "点击开始录音（医生问诊时）";
});
$("#clearArchive").addEventListener("click", async () => {
  if (confirm("确认清空本机健康档案？此操作不可恢复")) {
    const recs = await NurseStorage.getRecords();
    for (const r of recs.slice()) await NurseStorage.deleteRecord(r.id);
    renderArchive();
  }
});

renderArchive();
