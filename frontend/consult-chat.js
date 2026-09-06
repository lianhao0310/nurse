/*
 * Nurse · AI 问诊聊天（倪师中医）
 * ------------------------------------------------------------------
 * 依赖：tcm-ai.js (window.NurseTCM) + storage.js (window.NurseStorage)
 * 加载方式：<script src="consult-chat.js"> -> window.NurseConsultChat
 */
(function () {
  "use strict";

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const AVATAR_SVG = '<svg viewBox="0 0 64 64" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">'
    + '<circle cx="32" cy="32" r="31" fill="#e8f5e9"/>'
    + '<path d="M14 24 Q32 10 50 24 L50 27 Q32 19 14 27 Z" fill="#2d6a4f"/>'
    + '<ellipse cx="32" cy="33" rx="13" ry="15" fill="#f5deb3"/>'
    + '<circle cx="26" cy="30" r="1.5" fill="#333"/>'
    + '<circle cx="38" cy="30" r="1.5" fill="#333"/>'
    + '<path d="M24 36 Q32 54 40 36 Q37 48 32 54 Q27 48 24 36 Z" fill="#c0c0c0"/>'
    + '</svg>';

  let currentChat = null;
  let isSending = false;
  let recognition = null;
  let isRecording = false;
  let toastTimer = null;

  const EMERGENCY_KEYS = [
    "胸痛", "胸闷持续", "昏迷", "晕厥", "大出血", "吐血", "便血",
    "呼吸困难", "喘不上气", "剧烈头痛", "头痛欲裂", "休克",
    "高热不退", "抽搐", "意识不清", "说不出话", "肢体麻木",
    "半身不遂", "心悸持续", "持续腹痛",
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function toast(msg, ms) {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms || 2400);
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
    return d.getMonth() + 1 + "月" + d.getDate() + "日";
  }

  function isAvailable() {
    return !!(window.NurseTCM && window.NurseStorage);
  }

  // ---------------- 渲染 ----------------
  function renderMessages() {
    const list = $("#chat-list");
    const empty = $("#chat-empty");
    if (!list || !empty) return;
    const msgs = (currentChat && currentChat.messages) || [];
    if (!msgs.length) {
      list.hidden = true;
      empty.hidden = false;
      list.innerHTML = "";
      return;
    }
    list.hidden = false;
    empty.hidden = true;
    list.innerHTML = msgs.map((m) => {
      if (m.role === "user") {
        return '<div class="chat-msg chat-msg--user"><div class="chat-bubble chat-bubble--user">' + esc(m.content) + "</div></div>";
      }
      return '<div class="chat-msg chat-msg--ai"><div class="chat-avatar">' + AVATAR_SVG + '</div><div class="chat-bubble chat-bubble--ai">' + esc(m.content).replace(/\n/g, "<br>") + "</div></div>";
    }).join("");
    scrollBottom();
  }

  function scrollBottom() {
    const body = $("#consult-body");
    if (body) body.scrollTop = body.scrollHeight;
  }

  function renderSending() {
    const list = $("#chat-list");
    if (!list) return;
    const div = document.createElement("div");
    div.className = "chat-msg chat-msg--ai chat-msg--loading";
    div.id = "chat-loading";
    div.innerHTML = '<div class="chat-avatar">' + AVATAR_SVG + '</div><div class="chat-bubble chat-bubble--ai"><span class="chat-typing">思考中<span class="dot">·</span><span class="dot">·</span><span class="dot">·</span></span></div>';
    list.appendChild(div);
    scrollBottom();
  }

  function updateLoadingText(text) {
    const el = $("#chat-loading");
    if (!el) return;
    const bubble = el.querySelector(".chat-bubble");
    if (!bubble) return;
    bubble.innerHTML = esc(text).replace(/\n/g, "<br>");
  }

  function removeLoading() {
    const el = $("#chat-loading");
    if (el) el.remove();
  }

  // ---------------- 历史列表 ----------------
  async function renderHistoryList() {
    const chats = await NurseStorage.getConsultChats();
    const listEl = $("#consult-history-list");
    const emptyEl = $("#consult-history-empty");
    if (!listEl) return;
    if (!chats.length) {
      listEl.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = chats.map((c) => {
      const msgCount = (c.messages || []).length;
      return '<div class="consult-history-item" data-id="' + c.id + '">'
        + '<div class="consult-history-item__main">'
        + '<div class="consult-history-item__title">' + esc(c.title) + "</div>"
        + '<div class="consult-history-item__meta">' + fmtTime(c.updatedAt) + " · " + msgCount + " 条</div>"
        + "</div>"
        + '<button class="consult-history-item__del" data-del="' + c.id + '" type="button">✕</button>'
        + "</div>";
    }).join("");
  }

  // ---------------- 对话操作 ----------------
  async function open() {
    if (!isAvailable()) {
      toast("模块未加载");
      return;
    }
    const data = await NurseStorage.load();
    if (!window.NurseTCM.isConfigured(data.settings)) {
      toast("需联网并配置 AI 后使用");
      return;
    }
    $$(".view").forEach((v) => (v.hidden = true));
    $$(".page").forEach((p) => (p.hidden = true));
    const view = $("#consult-view");
    if (view) view.hidden = false;
    const chats = await NurseStorage.getConsultChats();
    if (chats.length) {
      currentChat = chats[0];
    } else {
      currentChat = await NurseStorage.newConsultChat();
    }
    renderMessages();
    updateTitle();
  }

  function close() {
    const view = $("#consult-view");
    if (view) view.hidden = true;
    if (isRecording) stopVoice();
    $$(".page").forEach((p) => (p.hidden = p.id !== "page-home"));
    $$(".tabbar__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.page === "home"));
  }

  function updateTitle() {
    const el = $("#consult-title");
    if (!el) return;
    el.textContent = currentChat && currentChat.title ? currentChat.title : "问 AI · 倪师中医";
  }

  async function newChat() {
    if (isSending) return;
    currentChat = await NurseStorage.newConsultChat();
    renderMessages();
    updateTitle();
    toast("已新建对话");
  }

  async function loadChat(id) {
    if (isSending) return;
    const chat = await NurseStorage.getConsultChat(id);
    if (!chat) return;
    currentChat = chat;
    renderMessages();
    updateTitle();
    const modal = $("#consult-history-modal");
    if (modal) modal.hidden = true;
  }

  async function deleteChat(id) {
    if (isSending) return;
    await NurseStorage.deleteConsultChat(id);
    if (currentChat && currentChat.id === id) {
      const chats = await NurseStorage.getConsultChats();
      currentChat = chats.length ? chats[0] : await NurseStorage.newConsultChat();
      renderMessages();
      updateTitle();
    }
    renderHistoryList();
    toast("已删除");
  }

  function checkEmergency(text) {
    const t = text.toLowerCase();
    return EMERGENCY_KEYS.some((k) => t.indexOf(k.toLowerCase()) >= 0);
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text || isSending) return;
    if (!currentChat) currentChat = await NurseStorage.newConsultChat();

    if (checkEmergency(text)) {
      if (!confirm("⚠️ 检测到可能为急危重症描述。\n\n中医辨证不能替代急诊。如出现胸痛持续、昏迷、大出血、呼吸困难等，请立即拨打 120 或前往急诊。\n\n是否仍要继续提问？")) {
        return;
      }
    }

    isSending = true;

    const userMsg = { role: "user", content: text, ts: new Date().toISOString() };
    currentChat.messages.push(userMsg);
    if (currentChat.title === "新对话" || !currentChat.title) {
      currentChat.title = text.slice(0, 20);
      updateTitle();
    }
    renderMessages();
    await saveCurrent();

    renderSending();

    const data = await NurseStorage.load();
    try {
      const history = currentChat.messages.map((m) => ({ role: m.role, content: m.content }));
      const full = await window.NurseTCM.chat(history, data.settings, (partial) => {
        updateLoadingText(partial);
      });
      removeLoading();
      const aiMsg = { role: "assistant", content: full || "（回复为空）", ts: new Date().toISOString() };
      currentChat.messages.push(aiMsg);
      renderMessages();
      await saveCurrent();
    } catch (e) {
      removeLoading();
      const errMsg = { role: "assistant", content: "⚠️ " + (e.message || "请求失败"), ts: new Date().toISOString() };
      currentChat.messages.push(errMsg);
      renderMessages();
      await saveCurrent();
    } finally {
      isSending = false;
    }
  }

  async function saveCurrent() {
    if (!currentChat) return;
    currentChat = await NurseStorage.saveConsultChat(currentChat);
  }

  // ---------------- 语音输入 ----------------
  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = $("#chat-voice");
    if (!btn) return;
    if (!SR) {
      btn.hidden = true;
      return;
    }
    btn.onclick = () => {
      if (isRecording) stopVoice();
      else startVoice();
    };
  }

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || isRecording) return;
    recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    const input = $("#chat-input");
    let baseText = input ? input.value : "";
    recognition.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (input) input.value = baseText + final + interim;
      autoResize();
    };
    recognition.onend = () => {
      isRecording = false;
      const btn = $("#chat-voice");
      if (btn) { btn.textContent = "🎤"; btn.classList.remove("is-recording"); }
      const input = $("#chat-input");
      if (input && input.value.trim()) {
        const text = input.value;
        input.value = "";
        autoResize();
        send(text);
      }
    };
    recognition.onerror = () => {
      isRecording = false;
      const btn = $("#chat-voice");
      if (btn) { btn.textContent = "🎤"; btn.classList.remove("is-recording"); }
    };
    try {
      recognition.start();
      isRecording = true;
      const btn = $("#chat-voice");
      if (btn) { btn.textContent = "⏹"; btn.classList.add("is-recording"); }
    } catch (e) {
      isRecording = false;
    }
  }

  function stopVoice() {
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
    }
  }

  // ---------------- 输入框自适应 ----------------
  function autoResize() {
    const input = $("#chat-input");
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }

  // ---------------- 初始化 ----------------
  function init() {
    const back = $("#consult-back");
    if (back) back.onclick = close;
    const newBtn = $("#consult-new");
    if (newBtn) newBtn.onclick = newChat;
    const histBtn = $("#consult-history");
    if (histBtn) histBtn.onclick = async () => { await renderHistoryList(); const m = $("#consult-history-modal"); if (m) m.hidden = false; };

    const input = $("#chat-input");
    if (input) {
      input.addEventListener("input", autoResize);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const text = input.value;
          input.value = "";
          autoResize();
          send(text);
        }
      });
    }

    const empty = $("#chat-empty");
    if (empty) {
      empty.addEventListener("click", (e) => {
        const btn = e.target.closest(".chat-suggest");
        if (btn && btn.dataset.q) send(btn.dataset.q);
      });
    }

    const histList = $("#consult-history-list");
    if (histList) {
      histList.addEventListener("click", (e) => {
        const del = e.target.closest("[data-del]");
        if (del) { deleteChat(del.dataset.del); return; }
        const item = e.target.closest("[data-id]");
        if (item) loadChat(item.dataset.id);
      });
    }

    initVoice();
  }

  window.NurseConsultChat = { init, open, close, isAvailable, send };
})();
