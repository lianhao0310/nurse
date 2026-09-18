/*
 * Nurse · 本地持久化存储（SQLite 版）
 * ------------------------------------------------------------------
 * 数据存储于 nurse.db（@capacitor-community/sqlite），图片存为文件（image-store.js）。
 * 对外 API 与旧版 JSON 存储保持一致，上层 app.js / consult-chat.js 无需改签名。
 * Web 预览（无 SQLite 插件）下使用内存模式，数据不持久化。
 *
 * 加载方式：<script src="db.js"><script src="image-store.js"><script src="storage.js">
 *           -> window.NurseStorage
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseStorage = api;
})(this, function () {
  "use strict";

  const DB = window.NurseDB;
  const IMG = window.NurseImageStore;
  const PAGE_SIZE = 20;

  function _uid(prefix) {
    return (prefix || "id_") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function _isMemory() { return DB ? DB.isMemoryMode() : true; }

  // ---------------- 空数据结构（内存模式 + 兼容上层） ----------------
  function _empty() {
    return {
      version: 3, updatedAt: null, lastDecrement: null,
      settings: {
        ai: { enabled: false, baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o" },
        notifications: false, largeFont: false,
        dailyDone: {}, reminders: [],
        reminderTimes: { morning: "08:00", noon: "12:30", evening: "19:00" },
      },
      records: [], orders: [], cabinet: [], reports: [], consultChats: [],
      indicatorMeta: {}, followedIndicators: [],
    };
  }

  let _mem = null;
  function _memData() { if (!_mem) _mem = _empty(); return _mem; }

  // ---------------- 归一化（轻量，保留兼容） ----------------
  const TIME_SLOTS = ["morning", "noon", "evening"];
  function _normTimeSlots(v) {
    if (Array.isArray(v)) { const a = v.filter((x) => TIME_SLOTS.includes(x)); if (a.length) return a; }
    return ["morning"];
  }
  function _normMeal(v) { return ["before", "after", "any"].includes(v) ? v : "any"; }
  function _normStatus(v) { return ["active", "disabled", "out"].includes(v) ? v : "active"; }

  function _normReminderTimes(v) {
    const t = v && typeof v === "object" ? v : {};
    const ok = (x, def) => (/^\d{1,2}:\d{2}$/.test(x) ? (String(x).length === 5 ? x : "0" + x) : def);
    return { morning: ok(t.morning, "08:00"), noon: ok(t.noon, "12:30"), evening: ok(t.evening, "19:00") };
  }

  // ---------------- 图片辅助 ----------------
  async function _saveImgsToTable(table, idCol, idVal, images) {
    if (!images || !images.length) return;
    const hasKind = table === "record_images";
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      if (!im || !im.dataUrl) continue;
      const saved = await IMG.saveImage(im.dataUrl);
      if (!saved.path) continue;
      if (hasKind) {
        await DB.run(
          `INSERT INTO ${table} (${idCol}, kind, path, name, type, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
          [idVal, im.kind || "image", saved.path, saved.name || im.name || "image", saved.type || im.type || "image/jpeg", i]
        );
      } else {
        await DB.run(
          `INSERT INTO ${table} (${idCol}, path, name, type, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [idVal, saved.path, saved.name || im.name || "image", saved.type || im.type || "image/jpeg", i]
        );
      }
    }
  }

  async function _saveMsgImgs(messageId, images) {
    if (!images || !images.length) return;
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      if (!im || !im.dataUrl) continue;
      const saved = await IMG.saveImage(im.dataUrl);
      if (!saved.path) continue;
      await DB.run(
        `INSERT INTO message_images (message_id, path, name, type, ocr_text, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
        [messageId, saved.path, saved.name || "image", saved.type || "image/jpeg", im.ocrText || "", i]
      );
    }
  }

  async function _readImgPaths(table, idCol, idVal) {
    return await DB.query(`SELECT path, name, type FROM ${table} WHERE ${idCol} = ? ORDER BY sort_order`, [idVal]);
  }

  async function _readImgDataUrls(table, idCol, idVal) {
    const rows = await _readImgPaths(table, idCol, idVal);
    const out = [];
    for (const r of rows) {
      const dataUrl = await IMG.readImage(r.path, r.type);
      out.push({ name: r.name, type: r.type, dataUrl });
    }
    return out;
  }

  async function _deleteImgsFromTable(table, idCol, idVal) {
    const rows = await _readImgPaths(table, idCol, idVal);
    await IMG.deleteImages(rows.map((r) => r.path));
    await DB.run(`DELETE FROM ${table} WHERE ${idCol} = ?`, [idVal]);
  }

  // 批量读取图片路径（避免 N+1）
  async function _batchReadImgPaths(table, idCol, ids) {
    if (!ids.length) return {};
    const ph = ids.map(() => "?").join(",");
    const rows = await DB.query(`SELECT ${idCol} AS pid, path, name, type FROM ${table} WHERE ${idCol} IN (${ph}) ORDER BY sort_order`, ids);
    const map = {};
    for (const r of rows) {
      if (!map[r.pid]) map[r.pid] = [];
      map[r.pid].push({ path: r.path, name: r.name, type: r.type });
    }
    return map;
  }

  // ---------------- result 组装/拆解 ----------------
  async function _saveResultSubTables(recordId, result) {
    if (!result) return;
    if (result.engine === "ai" || result.medications || result.tasks || result.risks) {
      const meds = result.medications || [];
      for (let i = 0; i < meds.length; i++) {
        const m = meds[i];
        await DB.run(`INSERT INTO record_medications (id, record_id, name, dose, freq, time, note, disease, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [m.id || _uid("med_"), recordId, m.name || "", m.dose || "", m.freq || "", m.time || "", m.note || "", m.disease || "", i]);
      }
      const tasks = result.tasks || [];
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        await DB.run(`INSERT INTO record_tasks (id, record_id, type, title, detail, freq, due, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.id || _uid("task_"), recordId, t.type || "life", t.title || "", t.detail || "", t.freq || "", t.due || "", i]);
      }
      const tags = [];
      (result.diseases || []).forEach((d) => tags.push({ kind: "disease", text: d }));
      if (result.advice && typeof result.advice === "object") {
        (result.advice.taboo || []).forEach((d) => tags.push({ kind: "taboo", text: d }));
        (result.advice.diet || []).forEach((d) => tags.push({ kind: "diet", text: d }));
      }
      for (let i = 0; i < tags.length; i++) {
        await DB.run(`INSERT INTO record_tags (record_id, kind, text, sort_order) VALUES (?, ?, ?, ?)`, [recordId, tags[i].kind, tags[i].text, i]);
      }
      const risks = result.risks || [];
      for (let i = 0; i < risks.length; i++) {
        const r = risks[i];
        await DB.run(`INSERT INTO record_risks (record_id, trigger, level, action, disease, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
          [recordId, r.trigger || "", r.level || "yellow", r.action || "", r.disease || "", i]);
      }
    }
    if (result.examResults || result.prescription) {
      const exams = result.examResults || [];
      for (let i = 0; i < exams.length; i++) {
        const e = exams[i];
        await DB.run(`INSERT INTO record_exam_results (record_id, name, value, unit, range, abnormal, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [recordId, e.name || "", e.value === 0 || e.value ? String(e.value) : "", e.unit || "", e.range || "", e.abnormal ? 1 : 0, i]);
      }
      const rx = result.prescription || [];
      for (let i = 0; i < rx.length; i++) {
        const p = rx[i];
        await DB.run(`INSERT INTO record_prescriptions (record_id, name, spec, pack_count, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [recordId, p.name || "", p.spec || "", Number(p.packCount) || 0, i]);
      }
    }
  }

  async function _readResult(recordId, row) {
    const hasAi = row.result_engine === "ai";
    if (hasAi) {
      const meds = await DB.query("SELECT id, name, dose, freq, time, note, disease FROM record_medications WHERE record_id = ? ORDER BY sort_order", [recordId]);
      const tasks = await DB.query("SELECT id, type, title, detail, freq, due FROM record_tasks WHERE record_id = ? ORDER BY sort_order", [recordId]);
      const tags = await DB.query("SELECT kind, text FROM record_tags WHERE record_id = ? ORDER BY sort_order", [recordId]);
      const risks = await DB.query("SELECT trigger, level, action, disease FROM record_risks WHERE record_id = ? ORDER BY sort_order", [recordId]);
      const diseases = tags.filter((t) => t.kind === "disease").map((t) => t.text);
      const taboo = tags.filter((t) => t.kind === "taboo").map((t) => t.text);
      const diet = tags.filter((t) => t.kind === "diet").map((t) => t.text);
      return {
        engine: "ai", diseases, medications: meds, tasks,
        advice: { taboo, diet }, risks,
        summary: row.result_summary || "", disclaimer: row.result_disclaimer || "",
      };
    }
    const exams = await DB.query("SELECT name, value, unit, range, abnormal FROM record_exam_results WHERE record_id = ? ORDER BY sort_order", [recordId]);
    const rx = await DB.query("SELECT name, spec, pack_count FROM record_prescriptions WHERE record_id = ? ORDER BY sort_order", [recordId]);
    const advice = row.result_advice || "";
    if (!advice && !exams.length && !rx.length) return null;
    return {
      advice,
      examResults: exams.map((e) => ({ ...e, abnormal: !!e.abnormal })),
      prescription: rx.map((p) => ({ ...p, packCount: p.pack_count })),
    };
  }

  async function _deleteResultSubTables(recordId) {
    for (const t of ["record_medications", "record_tasks", "record_tags", "record_risks", "record_exam_results", "record_prescriptions"]) {
      await DB.run(`DELETE FROM ${t} WHERE record_id = ?`, [recordId]);
    }
  }

  // ---------------- 记录组装 ----------------
  async function _rowToRecord(row, withDataUrls) {
    const allImgs = await DB.query("SELECT kind, path, name, type FROM record_images WHERE record_id = ? ORDER BY sort_order", [row.id]);
    const byKind = { image: [], rx: [], exam: [] };
    for (const im of allImgs) {
      if (!byKind[im.kind]) continue;
      if (withDataUrls) {
        const dataUrl = await IMG.readImage(im.path, im.type);
        byKind[im.kind].push({ name: im.name, type: im.type, dataUrl });
      } else {
        byKind[im.kind].push({ path: im.path, name: im.name, type: im.type });
      }
    }
    return {
      id: row.id, createdAt: row.created_at, visitDate: row.visit_date || "",
      hospital: row.hospital || "", doctor: row.doctor || "", source: row.source || "",
      transcript: row.transcript || "", images: byKind.image, rxImages: byKind.rx, examImages: byKind.exam,
      advice: { text: row.advice_text || "", audio: null },
      orderId: row.order_id || "", reportId: row.report_id || "",
      result: await _readResult(row.id, row),
      aiAnalysis: row.ai_analysis || null, aiAnalysisAt: row.ai_analysis_at || null,
      manual: !!row.manual, status: row.status || "done",
    };
  }

  // 批量组装记录（列表用，不含 dataUrl）
  async function _batchRowsToRecords(rows) {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];
    const ph = ids.map(() => "?").join(",");
    const [imgRows, medRows, taskRows, tagRows, riskRows, examRows, rxRows] = await Promise.all([
      DB.query(`SELECT record_id AS pid, kind, path, name, type FROM record_images WHERE record_id IN (${ph}) ORDER BY sort_order`, ids),
      DB.query(`SELECT record_id AS pid, id, name, dose, freq, time, note, disease FROM record_medications WHERE record_id IN (${ph}) ORDER BY sort_order`, ids),
      DB.query(`SELECT record_id AS pid, id, type, title, detail, freq, due FROM record_tasks WHERE record_id IN (${ph}) ORDER BY sort_order`, ids),
      DB.query(`SELECT record_id AS pid, kind, text FROM record_tags WHERE record_id IN (${ph}) ORDER BY sort_order`, ids),
      DB.query(`SELECT record_id AS pid, trigger, level, action, disease FROM record_risks WHERE record_id IN (${ph}) ORDER BY sort_order`, ids),
      DB.query(`SELECT record_id AS pid, name, value, unit, range, abnormal FROM record_exam_results WHERE record_id IN (${ph}) ORDER BY sort_order`, ids),
      DB.query(`SELECT record_id AS pid, name, spec, pack_count FROM record_prescriptions WHERE record_id IN (${ph}) ORDER BY sort_order`, ids),
    ]);
    const group = (rows, key) => {
      const m = {}; for (const r of rows) { if (!m[r.pid]) m[r.pid] = []; m[r.pid].push(r); } return m;
    };
    const imgMap = group(imgRows), medMap = group(medRows), taskMap = group(taskRows);
    const tagMap = group(tagRows), riskMap = group(riskRows), examMap = group(examRows), rxMap = group(rxRows);
    return rows.map((row) => {
      const imgs = (imgMap[row.id] || []);
      const byKind = { image: [], rx: [], exam: [] };
      for (const im of imgs) { if (byKind[im.kind]) byKind[im.kind].push({ path: im.path, name: im.name, type: im.type }); }
      const result = _assembleResult(row, medMap[row.id] || [], taskMap[row.id] || [], tagMap[row.id] || [], riskMap[row.id] || [], examMap[row.id] || [], rxMap[row.id] || []);
      return {
        id: row.id, createdAt: row.created_at, visitDate: row.visit_date || "",
        hospital: row.hospital || "", doctor: row.doctor || "", source: row.source || "",
        transcript: row.transcript || "", images: byKind.image, rxImages: byKind.rx, examImages: byKind.exam,
        advice: { text: row.advice_text || "", audio: null },
        orderId: row.order_id || "", reportId: row.report_id || "", result,
        aiAnalysis: row.ai_analysis || null, aiAnalysisAt: row.ai_analysis_at || null,
        manual: !!row.manual, status: row.status || "done",
      };
    });
  }

  function _assembleResult(row, meds, tasks, tags, risks, exams, rx) {
    if (row.result_engine === "ai") {
      return {
        engine: "ai",
        diseases: tags.filter((t) => t.kind === "disease").map((t) => t.text),
        medications: meds, tasks,
        advice: { taboo: tags.filter((t) => t.kind === "taboo").map((t) => t.text), diet: tags.filter((t) => t.kind === "diet").map((t) => t.text) },
        risks, summary: row.result_summary || "", disclaimer: row.result_disclaimer || "",
      };
    }
    const advice = row.result_advice || "";
    if (!advice && !exams.length && !rx.length) return null;
    return {
      advice,
      examResults: exams.map((e) => ({ ...e, abnormal: !!e.abnormal })),
      prescription: rx.map((p) => ({ ...p, packCount: p.pack_count })),
    };
  }

  // ---------------- load（只加载非列表数据） ----------------
  async function load() {
    if (_isMemory()) return _memData();
    if (!(DB && DB.isReady())) { const ok = await DB.init(); if (!ok) return _memData(); }

    const data = _empty();
    try {
      const aiRow = (await DB.query("SELECT enabled, base_url, api_key, model FROM ai_settings WHERE id = 1"))[0];
      if (aiRow) data.settings.ai = { enabled: !!aiRow.enabled, baseUrl: aiRow.base_url, apiKey: aiRow.api_key, model: aiRow.model };

      const settingsRows = await DB.query("SELECT key, value FROM app_settings");
      const sm = {};
      for (const r of settingsRows) sm[r.key] = r.value;
      data.settings.notifications = sm.notifications === "true" || sm.notifications === true;
      data.settings.largeFont = sm.largeFont === "true" || sm.largeFont === true;
      data.settings.reminderTimes = _normReminderTimes({ morning: sm.reminderTimes_morning, noon: sm.reminderTimes_noon, evening: sm.reminderTimes_evening });
      data.lastDecrement = sm.lastDecrement || null;

      data.settings.reminders = await DB.query("SELECT id, title, type, date, time, enabled, note FROM reminders");
      data.settings.reminders = data.settings.reminders.map((r) => ({ ...r, enabled: !!r.enabled }));

      const cabRows = await DB.query("SELECT id, name, manufacturer, alias, unit, spec, qty, dose_amount, dose_unit, meal, threshold, status, note, disease FROM cabinet_drugs");
      const cabIds = cabRows.map((r) => r.id);
      const tsMap = cabIds.length ? group(await DB.query(`SELECT drug_id AS pid, time FROM cabinet_time_slots WHERE drug_id IN (${cabIds.map(() => "?").join(",")}) ORDER BY sort_order`, cabIds)) : {};
      data.cabinet = cabRows.map((r) => ({
        id: r.id, name: r.name, manufacturer: r.manufacturer || "", alias: r.alias || "",
        unit: r.unit || "片", spec: r.spec || "", qty: Number(r.qty) || 0,
        doseAmount: Number(r.dose_amount) || 0, doseUnit: r.dose_unit || "片",
        timeSlots: (tsMap[r.id] || []).map((t) => t.time), meal: r.meal || "any",
        threshold: Number(r.threshold) || 0, status: r.status || "active", note: r.note || "", disease: r.disease || "",
      }));

      const metaRows = await DB.query("SELECT name, unit, range FROM indicator_meta");
      for (const r of metaRows) data.indicatorMeta[r.name] = { unit: r.unit || "", range: r.range || "" };

      data.followedIndicators = (await DB.query("SELECT name, unit, range FROM followed_indicators")).map((r) => ({ name: r.name, unit: r.unit || "", range: r.range || "" }));

      const doneRows = await DB.query("SELECT date, kind, ref_id, value FROM daily_done");
      for (const r of doneRows) {
        if (!data.settings.dailyDone[r.date]) data.settings.dailyDone[r.date] = { medDoses: {}, tasks: {} };
        if (r.kind === "med") data.settings.dailyDone[r.date].medDoses[r.ref_id] = true;
        else data.settings.dailyDone[r.date].tasks[r.ref_id] = true;
      }

      data.records = await getRecords();
      data.orders = await getOrders();
      data.reports = await getReports();
      data.consultChats = await getConsultChats();
    } catch (e) { console.warn("[NurseStorage] load 失败:", e.message); }
    return data;

    function group(rows) { const m = {}; for (const r of rows) { if (!m[r.pid]) m[r.pid] = []; m[r.pid].push(r); } return m; }
  }

  // ---------------- 问诊记录 CRUD ----------------
  async function appendRecord(record) {
    if (_isMemory()) {
      const d = _memData();
      const id = record.id || _uid("rec_");
      const existing = d.records.find((r) => r.id === id);
      if (!existing && record.hospital && record.visitDate) {
        const byKey = d.records.find((r) => r.hospital === record.hospital && r.visitDate === record.visitDate);
        if (byKey) {
          Object.assign(byKey, record, { id: byKey.id });
          return byKey;
        }
      }
      if (existing) { Object.assign(existing, record, { id: existing.id }); return existing; }
      const rec = {
        ...record, id,
        createdAt: record.createdAt || new Date().toISOString(),
        visitDate: record.visitDate || "", hospital: record.hospital || "", doctor: record.doctor || "",
        source: record.source || "text", transcript: record.transcript || "",
        orderId: record.orderId || "", reportId: record.reportId || "",
        status: record.status || "done", manual: !!record.manual,
      };
      d.records.unshift(rec); return rec;
    }
    const id = record.id || _uid("rec_");
    const existedById = (await DB.query("SELECT id FROM records WHERE id = ?", [id]))[0];
    if (!existedById && record.hospital && record.visitDate) {
      const byKey = (await DB.query("SELECT id FROM records WHERE hospital = ? AND visit_date = ?", [record.hospital, record.visitDate]))[0];
      if (byKey) return await updateRecord(byKey.id, record);
    }
    const now = new Date().toISOString();
    const r = record;
    await DB.run(`INSERT OR REPLACE INTO records (id, created_at, visit_date, hospital, doctor, source, transcript, order_id, report_id, advice_text, ai_analysis, ai_analysis_at, manual, status, result_engine, result_summary, result_disclaimer, result_advice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, r.createdAt || now, r.visitDate || "", r.hospital || "", r.doctor || "", r.source || "text", r.transcript || "", r.orderId || "", r.reportId || "",
       (r.advice && r.advice.text) || r.transcript || "", r.aiAnalysis || null, r.aiAnalysisAt || null, r.manual ? 1 : 0, r.status || "done",
       (r.result && r.result.engine) || null, (r.result && r.result.summary) || "", (r.result && r.result.disclaimer) || "",
       (r.result && typeof r.result.advice === "string") ? r.result.advice : ""]);
    await _deleteResultSubTables(id);
    await _saveResultSubTables(id, r.result);
    await _deleteImgsFromTable("record_images", "record_id", id);
    if (r.images && r.images.length) await _saveImgsToTable("record_images", "record_id", id, r.images.map((im) => ({ ...im, kind: "image" })).map((im) => im));
    if (r.rxImages && r.rxImages.length) await _saveImgsToTable("record_images", "record_id", id, r.rxImages.map((im) => ({ ...im, kind: "rx" })));
    if (r.examImages && r.examImages.length) await _saveImgsToTable("record_images", "record_id", id, r.examImages.map((im) => ({ ...im, kind: "exam" })));
    return await getRecord(id);
  }

  async function getRecords(withDataUrls) {
    if (_isMemory()) return _memData().records;
    const rows = await DB.query("SELECT * FROM records ORDER BY created_at DESC");
    return Promise.all(rows.map((r) => _rowToRecord(r, !!withDataUrls)));
  }

  async function getRecord(id) {
    if (_isMemory()) return _memData().records.find((r) => r.id === id) || null;
    const row = (await DB.query("SELECT * FROM records WHERE id = ?", [id]))[0];
    if (!row) return null;
    return await _rowToRecord(row, true);
  }

  async function updateRecord(id, patch) {
    if (_isMemory()) { const r = _memData().records.find((x) => x.id === id); if (r) Object.assign(r, patch); return r || null; }
    const row = (await DB.query("SELECT * FROM records WHERE id = ?", [id]))[0];
    if (!row) return null;
    const cur = await _rowToRecord(row, false);
    const merged = Object.assign({}, cur, patch);
    await DB.run(`UPDATE records SET visit_date=?, hospital=?, doctor=?, source=?, transcript=?, order_id=?, report_id=?, advice_text=?, ai_analysis=?, ai_analysis_at=?, manual=?, status=?, result_engine=?, result_summary=?, result_disclaimer=?, result_advice=? WHERE id=?`,
      [merged.visitDate || "", merged.hospital || "", merged.doctor || "", merged.source || "", merged.transcript || "", merged.orderId || "", merged.reportId || "",
       (merged.advice && merged.advice.text) || "", merged.aiAnalysis || null, merged.aiAnalysisAt || null, merged.manual ? 1 : 0, merged.status || "done",
       (merged.result && merged.result.engine) || null, (merged.result && merged.result.summary) || "", (merged.result && merged.result.disclaimer) || "",
       (merged.result && typeof merged.result.advice === "string") ? merged.result.advice : "", id]);
    if (patch.result !== undefined) { await _deleteResultSubTables(id); await _saveResultSubTables(id, merged.result); }
    if (patch.images) { await _deleteImgsFromTable("record_images", "record_id", id); if (patch.images.length) await _saveImgsToTable("record_images", "record_id", id, patch.images); }
    if (patch.rxImages) { await _deleteImgsFromTable("record_images", "record_id", id); if (patch.rxImages.length) await _saveImgsToTable("record_images", "record_id", id, patch.rxImages.map((im) => ({ ...im, kind: "rx" }))); }
    if (patch.examImages) { await _deleteImgsFromTable("record_images", "record_id", id); if (patch.examImages.length) await _saveImgsToTable("record_images", "record_id", id, patch.examImages.map((im) => ({ ...im, kind: "exam" }))); }
    return await getRecord(id);
  }

  async function deleteRecord(id) {
    if (_isMemory()) {
      const d = _memData();
      const rec = d.records.find((r) => r.id === id);
      const ordIds = new Set(d.orders.filter((o) => o.recordId === id).map((o) => o.id));
      const repIds = new Set(d.reports.filter((r) => r.recordId === id).map((r) => r.id));
      if (rec) {
        if (rec.orderId) ordIds.add(rec.orderId);
        if (rec.reportId) repIds.add(rec.reportId);
      }
      d.records = d.records.filter((r) => r.id !== id);
      for (const oid of ordIds) await deleteOrder(oid);
      for (const rid of repIds) await deleteReport(rid);
      return;
    }
    const recRow = (await DB.query("SELECT order_id, report_id FROM records WHERE id = ?", [id]))[0];
    await _deleteImgsFromTable("record_images", "record_id", id);
    await _deleteResultSubTables(id);
    await DB.run("DELETE FROM records WHERE id = ?", [id]);
    const ordIds = new Set();
    const repIds = new Set();
    if (recRow) {
      if (recRow.order_id) ordIds.add(recRow.order_id);
      if (recRow.report_id) repIds.add(recRow.report_id);
    }
    const orders = await DB.query("SELECT id FROM orders WHERE record_id = ?", [id]);
    for (const o of orders) ordIds.add(o.id);
    const reports = await DB.query("SELECT id FROM reports WHERE record_id = ?", [id]);
    for (const rp of reports) repIds.add(rp.id);
    for (const oid of ordIds) await deleteOrder(oid);
    for (const rid of repIds) await deleteReport(rid);
  }

  // ---------------- 药单 CRUD ----------------
  async function _rowToOrder(row, withDataUrls) {
    const meds = await DB.query("SELECT id, name, manufacturer, alias, spec, pack_count, qty, price FROM order_medicines WHERE order_id = ? ORDER BY sort_order", [row.id]);
    const images = withDataUrls ? await _readImgDataUrls("order_images", "order_id", row.id) : await _readImgPaths("order_images", "order_id", row.id);
    return {
      id: row.id, source: row.source, date: row.date || "", kind: row.kind || "custom",
      recordId: row.record_id || "", aiGenerated: !!row.ai_generated,
      medicines: meds.map((m) => ({ id: m.id, name: m.name, manufacturer: m.manufacturer || "", alias: m.alias || "", spec: m.spec || "", packCount: Number(m.pack_count) || 0, qty: Number(m.qty) || 0, price: Number(m.price) || 0 })),
      images,
    };
  }

  async function _saveOrderSubTables(orderId, item) {
    await DB.run("DELETE FROM order_medicines WHERE order_id = ?", [orderId]);
    const meds = item.medicines || [];
    for (let i = 0; i < meds.length; i++) {
      const m = meds[i]; if (!m || !m.name) continue;
      await DB.run(`INSERT INTO order_medicines (id, order_id, name, manufacturer, alias, spec, pack_count, qty, price, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [m.id || _uid("med_"), orderId, String(m.name).trim(), m.manufacturer || "", m.alias || "", m.spec || "", Number(m.packCount) || 0, Number(m.qty) || 0, Number(m.price) || 0, i]);
    }
    await _deleteImgsFromTable("order_images", "order_id", orderId);
    if (item.images && item.images.length) await _saveImgsToTable("order_images", "order_id", orderId, item.images);
  }

  async function _syncCabinetForNewOrder(meds) {
    for (const m of meds) {
      const name = String(m.name || "").trim();
      if (!name) continue;
      const qty = Number(m.qty) || 0;
      const row = (await DB.query("SELECT id, qty FROM cabinet_drugs WHERE name = ?", [name]))[0];
      if (row) { await DB.run("UPDATE cabinet_drugs SET qty = ? WHERE id = ?", [(Number(row.qty) || 0) + qty, row.id]); }
      else { await DB.run(`INSERT INTO cabinet_drugs (id, name, manufacturer, alias, unit, spec, qty, dose_amount, dose_unit, meal, threshold, status, note, disease) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [_uid("cab_"), name, "", "", "片", "", qty, 0, "片", "any", 0, "active", "", ""]); }
    }
  }

  async function _syncCabinetForUpdateOrder(oldMeds, newMeds) {
    for (const nm of newMeds) {
      const name = String(nm.name || "").trim();
      if (!name) continue;
      const newQty = Number(nm.qty) || 0;
      const oldMed = oldMeds.find((m) => String(m.name || "").trim() === name);
      const oldQty = oldMed ? (Number(oldMed.qty) || 0) : 0;
      const diff = newQty - oldQty;
      if (diff === 0) continue;
      const row = (await DB.query("SELECT id, qty FROM cabinet_drugs WHERE name = ?", [name]))[0];
      if (row) { await DB.run("UPDATE cabinet_drugs SET qty = ? WHERE id = ?", [(Number(row.qty) || 0) + diff, row.id]); }
      else if (newQty > 0) { await DB.run(`INSERT INTO cabinet_drugs (id, name, manufacturer, alias, unit, spec, qty, dose_amount, dose_unit, meal, threshold, status, note, disease) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [_uid("cab_"), name, "", "", "片", "", newQty, 0, "片", "any", 0, "active", "", ""]); }
    }
  }

  async function getOrders(withDataUrls) {
    if (_isMemory()) return _memData().orders;
    const rows = await DB.query("SELECT * FROM orders ORDER BY date DESC");
    return Promise.all(rows.map((r) => _rowToOrder(r, !!withDataUrls)));
  }
  async function getOrder(id) {
    if (_isMemory()) return _memData().orders.find((o) => o.id === id) || null;
    const row = (await DB.query("SELECT * FROM orders WHERE id = ?", [id]))[0];
    return row ? await _rowToOrder(row, true) : null;
  }
  async function upsertOrder(item) {
    if (_isMemory()) {
      const d = _memData();
      const source = String(item.source || "").trim();
      if (!source) return null;
      const id = item.id || _uid("ord_");
      const existing = d.orders.find((o) => o.id === id);
      const meds = (item.medicines || []).filter((m) => m && m.name);
      const it = {
        ...item, id, source,
        kind: item.kind === "hospital" ? "hospital" : "custom",
        recordId: item.recordId || "",
        medicines: meds.map((m) => ({ ...m, name: String(m.name).trim(), qty: Number(m.qty) || 0 })),
      };
      if (existing) {
        const oldMeds = (existing.medicines || []).filter((m) => m && m.name);
        Object.assign(existing, it);
        for (const nm of meds) {
          const name = String(nm.name).trim();
          const newQty = Number(nm.qty) || 0;
          const oldMed = oldMeds.find((m) => String(m.name || "").trim() === name);
          const oldQty = oldMed ? (Number(oldMed.qty) || 0) : 0;
          const diff = newQty - oldQty;
          if (diff === 0) continue;
          const cab = d.cabinet.find((c) => c.name === name);
          if (cab) { cab.qty = (Number(cab.qty) || 0) + diff; }
          else if (newQty > 0) { d.cabinet.unshift({ id: _uid("cab_"), name, qty: newQty, unit: "片", status: "active", doseAmount: 0, doseUnit: "片", timeSlots: [], meal: "any", threshold: 0 }); }
        }
      }
      else {
        d.orders.unshift(it);
        for (const m of meds) {
          const name = String(m.name).trim();
          const qty = Number(m.qty) || 0;
          const cab = d.cabinet.find((c) => c.name === name);
          if (cab) { cab.qty = (Number(cab.qty) || 0) + qty; }
          else { d.cabinet.unshift({ id: _uid("cab_"), name, qty, unit: "片", status: "active", doseAmount: 0, doseUnit: "片", timeSlots: [], meal: "any", threshold: 0 }); }
        }
      }
      return it;
    }
    const source = String(item.source || "").trim();
    if (!source) return null;
    const id = item.id || _uid("ord_");
    const existed = (await DB.query("SELECT id FROM orders WHERE id = ?", [id]))[0];
    let oldMeds = [];
    if (existed) {
      const oldOrder = await getOrder(id);
      oldMeds = ((oldOrder && oldOrder.medicines) || []).filter((m) => m && m.name);
    }
    await DB.run(`INSERT OR REPLACE INTO orders (id, source, date, kind, record_id, ai_generated) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, source, item.date || "", item.kind === "hospital" ? "hospital" : "custom", item.recordId || "", item.aiGenerated ? 1 : 0]);
    await _saveOrderSubTables(id, item);
    const newMeds = (item.medicines || []).filter((m) => m && m.name);
    if (!existed) await _syncCabinetForNewOrder(newMeds);
    else await _syncCabinetForUpdateOrder(oldMeds, newMeds);
    return await _rowToOrder((await DB.query("SELECT * FROM orders WHERE id = ?", [id]))[0], false);
  }
  async function updateOrder(id, patch) {
    if (_isMemory()) {
      const o = _memData().orders.find((x) => x.id === id);
      if (!o) return null;
      if (patch.medicines) {
        const d = _memData();
        const oldMeds = o.medicines || [];
        const newMeds = patch.medicines.filter((m) => m && m.name);
        for (const nm of newMeds) {
          const name = String(nm.name).trim();
          const newQty = Number(nm.qty) || 0;
          const oldMed = oldMeds.find((m) => String(m.name).trim() === name);
          const oldQty = oldMed ? (Number(oldMed.qty) || 0) : 0;
          const cab = d.cabinet.find((c) => c.name === name);
          if (cab) { cab.qty = (Number(cab.qty) || 0) + (newQty - oldQty); }
          else if (newQty > 0) { d.cabinet.unshift({ id: _uid("cab_"), name, qty: newQty, unit: "片", status: "active", doseAmount: 0, doseUnit: "片", timeSlots: [], meal: "any", threshold: 0 }); }
        }
      }
      Object.assign(o, patch);
      return o;
    }
    const cur = await getOrder(id); if (!cur) return null;
    const merged = Object.assign({}, cur, patch);
    await DB.run(`UPDATE orders SET source=?, date=?, kind=?, record_id=?, ai_generated=? WHERE id=?`,
      [merged.source, merged.date || "", merged.kind || "custom", merged.recordId || "", merged.aiGenerated ? 1 : 0, id]);
    await _saveOrderSubTables(id, merged);
    if (patch.medicines) await _syncCabinetForUpdateOrder(cur.medicines || [], (merged.medicines || []).filter((m) => m && m.name));
    return await _rowToOrder((await DB.query("SELECT * FROM orders WHERE id = ?", [id]))[0], false);
  }
  async function deleteOrder(id) {
    if (_isMemory()) {
      const d = _memData();
      d.orders = d.orders.filter((o) => o.id !== id);
      for (const r of d.records) { if (r.orderId === id) r.orderId = ""; }
      return;
    }
    await _deleteImgsFromTable("order_images", "order_id", id);
    await DB.run("DELETE FROM order_medicines WHERE order_id = ?", [id]);
    await DB.run("DELETE FROM orders WHERE id = ?", [id]);
    await DB.run("UPDATE records SET order_id = '' WHERE order_id = ?", [id]);
  }

  // ---------------- 药箱 CRUD ----------------
  async function _rowToCabinetDrug(row) {
    const ts = await DB.query("SELECT time FROM cabinet_time_slots WHERE drug_id = ? ORDER BY sort_order", [row.id]);
    return {
      id: row.id, name: row.name, manufacturer: row.manufacturer || "", alias: row.alias || "",
      unit: row.unit || "片", spec: row.spec || "", qty: Number(row.qty) || 0,
      doseAmount: Number(row.dose_amount) || 0, doseUnit: row.dose_unit || "片",
      timeSlots: ts.map((t) => t.time), meal: row.meal || "any",
      threshold: Number(row.threshold) || 0, status: row.status || "active", note: row.note || "", disease: row.disease || "",
    };
  }
  async function getCabinetDrugs() {
    if (_isMemory()) return _memData().cabinet;
    const rows = await DB.query("SELECT * FROM cabinet_drugs ORDER BY name ASC");
    return Promise.all(rows.map(_rowToCabinetDrug));
  }
  async function getCabinetDrug(id) {
    if (_isMemory()) return _memData().cabinet.find((c) => c.id === id) || null;
    const row = (await DB.query("SELECT * FROM cabinet_drugs WHERE id = ?", [id]))[0];
    return row ? await _rowToCabinetDrug(row) : null;
  }
  async function upsertCabinetDrug(item) {
    if (_isMemory()) {
      const d = _memData();
      const name = String(item.name || "").trim();
      if (!name) return null;
      const existing = d.cabinet.find((c) => c.name === name);
      const it = {
        ...item, name,
        id: item.id || (existing ? existing.id : _uid("cab_")),
        qty: Number(item.qty) || 0,
        unit: item.unit || "片", doseUnit: item.doseUnit || "片",
        timeSlots: _normTimeSlots(item.timeSlots),
        meal: _normMeal(item.meal), status: _normStatus(item.status),
        threshold: Number(item.threshold) || 0, doseAmount: Number(item.doseAmount) || 0,
      };
      if (existing) { Object.assign(existing, it); return existing; }
      d.cabinet.unshift(it); return it;
    }
    const name = String(item.name || "").trim();
    if (!name) return null;
    const existing = (await DB.query("SELECT id FROM cabinet_drugs WHERE name = ?", [name]))[0];
    const id = existing ? existing.id : (item.id || _uid("cab_"));
    const ts = _normTimeSlots(item.timeSlots);
    await DB.run(`INSERT OR REPLACE INTO cabinet_drugs (id, name, manufacturer, alias, unit, spec, qty, dose_amount, dose_unit, meal, threshold, status, note, disease) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, item.manufacturer || "", item.alias || "", item.unit || "片", item.spec || "", Number(item.qty) || 0, Number(item.doseAmount) || 0, item.doseUnit || "片", _normMeal(item.meal), Number(item.threshold) || 0, _normStatus(item.status), item.note || "", item.disease || ""]);
    await DB.run("DELETE FROM cabinet_time_slots WHERE drug_id = ?", [id]);
    for (let i = 0; i < ts.length; i++) await DB.run("INSERT INTO cabinet_time_slots (drug_id, time, sort_order) VALUES (?, ?, ?)", [id, ts[i], i]);
    return await getCabinetDrug(id);
  }
  async function updateCabinetDrug(id, patch) {
    if (_isMemory()) { const c = _memData().cabinet.find((x) => x.id === id); if (c) Object.assign(c, patch); return c || null; }
    const cur = await getCabinetDrug(id); if (!cur) return null;
    const merged = Object.assign({}, cur, patch);
    return await upsertCabinetDrug({ ...merged, id });
  }
  async function deleteCabinetDrug(id) {
    if (_isMemory()) {
      const d = _memData();
      const drug = d.cabinet.find((c) => c.id === id);
      const name = drug ? drug.name : null;
      d.cabinet = d.cabinet.filter((c) => c.id !== id);
      if (name) {
        for (const o of d.orders) {
          if (o.medicines) o.medicines = o.medicines.filter((m) => String(m.name).trim() !== name);
        }
      }
      return;
    }
    const drug = await getCabinetDrug(id);
    if (drug) await DB.run("DELETE FROM order_medicines WHERE name = ?", [drug.name]);
    await DB.run("DELETE FROM cabinet_time_slots WHERE drug_id = ?", [id]);
    await DB.run("DELETE FROM cabinet_drugs WHERE id = ?", [id]);
  }

  // ---------------- 检查报告 CRUD ----------------
  async function _rowToReport(row, withDataUrls) {
    const inds = await DB.query("SELECT name, value, unit, range, abnormal FROM report_indicators WHERE report_id = ? ORDER BY sort_order", [row.id]);
    const images = withDataUrls ? await _readImgDataUrls("report_images", "report_id", row.id) : await _readImgPaths("report_images", "report_id", row.id);
    return {
      id: row.id, title: row.title || "检查报告", date: row.date || "", kind: row.kind || "hospital",
      recordId: row.record_id || "", aiGenerated: !!row.ai_generated,
      indicators: inds.map((i) => ({ name: i.name, value: i.value, unit: i.unit, range: i.range, abnormal: !!i.abnormal })), images,
    };
  }
  async function _saveReportSubTables(reportId, item) {
    await DB.run("DELETE FROM report_indicators WHERE report_id = ?", [reportId]);
    const inds = item.indicators || [];
    for (let i = 0; i < inds.length; i++) { const x = inds[i]; if (!x || !x.name) continue;
      await DB.run("INSERT INTO report_indicators (report_id, name, value, unit, range, abnormal, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)", [reportId, String(x.name).trim(), x.value === 0 || x.value ? String(x.value) : "", x.unit || "", x.range || "", x.abnormal ? 1 : 0, i]); }
    await _deleteImgsFromTable("report_images", "report_id", reportId);
    if (item.images && item.images.length) await _saveImgsToTable("report_images", "report_id", reportId, item.images);
  }
  async function getReports(withDataUrls) {
    if (_isMemory()) return _memData().reports;
    const rows = await DB.query("SELECT * FROM reports ORDER BY date DESC");
    return Promise.all(rows.map((r) => _rowToReport(r, !!withDataUrls)));
  }
  async function getReport(id) {
    if (_isMemory()) return _memData().reports.find((r) => r.id === id) || null;
    const row = (await DB.query("SELECT * FROM reports WHERE id = ?", [id]))[0];
    return row ? await _rowToReport(row, true) : null;
  }
  async function upsertReport(item) {
    if (_isMemory()) {
      const d = _memData();
      const id = item.id || _uid("rep_");
      const existing = d.reports.find((r) => r.id === id);
      const inds = (item.indicators || []).filter((x) => x && x.name).map((x) => ({ ...x, name: String(x.name).trim() }));
      const it = {
        ...item, id,
        title: item.title || "检查报告",
        kind: item.kind === "self" ? "self" : "hospital",
        recordId: item.recordId || "",
        indicators: inds,
      };
      if (existing) { Object.assign(existing, it); return existing; }
      d.reports.unshift(it); return it;
    }
    const id = item.id || _uid("rep_");
    await DB.run(`INSERT OR REPLACE INTO reports (id, title, date, kind, record_id, ai_generated) VALUES (?, ?, ?, ?, ?, ?)`, [id, item.title || "检查报告", item.date || "", item.kind === "self" ? "self" : "hospital", item.recordId || "", item.aiGenerated ? 1 : 0]);
    await _saveReportSubTables(id, item);
    return await _rowToReport((await DB.query("SELECT * FROM reports WHERE id = ?", [id]))[0], false);
  }
  async function updateReport(id, patch) {
    if (_isMemory()) { const r = _memData().reports.find((x) => x.id === id); if (r) Object.assign(r, patch); return r || null; }
    const cur = await getReport(id); if (!cur) return null;
    const merged = Object.assign({}, cur, patch);
    await DB.run("UPDATE reports SET title=?, date=?, kind=?, record_id=?, ai_generated=? WHERE id=?", [merged.title, merged.date || "", merged.kind, merged.recordId || "", merged.aiGenerated ? 1 : 0, id]);
    await _saveReportSubTables(id, merged);
    return await _rowToReport((await DB.query("SELECT * FROM reports WHERE id = ?", [id]))[0], false);
  }
  async function deleteReport(id) {
    if (_isMemory()) {
      const d = _memData();
      d.reports = d.reports.filter((r) => r.id !== id);
      for (const r of d.records) { if (r.reportId === id) r.reportId = ""; }
      return;
    }
    await _deleteImgsFromTable("report_images", "report_id", id);
    await DB.run("DELETE FROM report_indicators WHERE report_id = ?", [id]);
    await DB.run("DELETE FROM reports WHERE id = ?", [id]);
    await DB.run("UPDATE records SET report_id = '' WHERE report_id = ?", [id]);
  }

  // ---------------- AI 聊天 CRUD ----------------
  async function _rowToChat(row, withDataUrls) {
    const msgs = await DB.query("SELECT id, role, content, ts FROM consult_messages WHERE chat_id = ? ORDER BY sort_order", [row.id]);
    const msgIds = msgs.map((m) => m.id);
    let imgMap = {};
    if (msgIds.length) {
      const ph = msgIds.map(() => "?").join(",");
      const imgRows = await DB.query(`SELECT message_id AS pid, path, name, type, ocr_text FROM message_images WHERE message_id IN (${ph}) ORDER BY sort_order`, msgIds);
      for (const r of imgRows) { if (!imgMap[r.pid]) imgMap[r.pid] = []; imgMap[r.pid].push(r); }
    }
    const out = {
      id: row.id, title: row.title || "新对话", createdAt: row.created_at, updatedAt: row.updated_at,
      messages: msgs.map((m) => {
        const msg = { role: m.role, content: m.content, ts: m.ts };
        const imgs = imgMap[m.id] || [];
        if (imgs.length) {
          if (withDataUrls) {
            msg._imagePaths = imgs.map((im) => ({ path: im.path, name: im.name, type: im.type, ocrText: im.ocr_text }));
          } else {
            msg.images = imgs.map((im) => ({ path: im.path, name: im.name, type: im.type, ocrText: im.ocr_text }));
          }
        }
        return msg;
      }),
    };
    if (withDataUrls) {
      for (const msg of out.messages) {
        if (msg._imagePaths) {
          msg.images = [];
          for (const im of msg._imagePaths) { const dataUrl = await IMG.readImage(im.path, im.type); msg.images.push({ dataUrl, ocrText: im.ocrText || "" }); }
          delete msg._imagePaths;
        }
      }
    }
    return out;
  }
  async function getConsultChats() {
    if (_isMemory()) return _memData().consultChats;
    const rows = await DB.query("SELECT * FROM consult_chats ORDER BY updated_at DESC");
    return Promise.all(rows.map((r) => _rowToChat(r, false)));
  }
  async function getConsultChat(id) {
    if (_isMemory()) return _memData().consultChats.find((c) => c.id === id) || null;
    const row = (await DB.query("SELECT * FROM consult_chats WHERE id = ?", [id]))[0];
    return row ? await _rowToChat(row, true) : null;
  }
  async function saveConsultChat(chat) {
    if (_isMemory()) { const d = _memData(); const now = new Date().toISOString(); const id = chat.id || _uid("chat_"); const existing = d.consultChats.find((c) => c.id === id); if (existing) { Object.assign(existing, chat, { id, updatedAt: now }); return existing; } const item = { ...chat, id, updatedAt: now }; d.consultChats.unshift(item); return item; }
    const id = chat.id || _uid("chat_");
    const now = new Date().toISOString();
    await DB.run(`INSERT OR REPLACE INTO consult_chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`, [id, chat.title || "新对话", chat.createdAt || now, now]);
    await DB.run("DELETE FROM consult_messages WHERE chat_id = ?", [id]);
    const msgs = chat.messages || [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]; if (!m || (!m.content && !(m.images && m.images.length))) continue;
      const msgId = _uid("msg_");
      await DB.run("INSERT INTO consult_messages (id, chat_id, role, content, ts, sort_order) VALUES (?, ?, ?, ?, ?, ?)", [msgId, id, m.role === "assistant" ? "assistant" : "user", String(m.content || ""), m.ts || now, i]);
      if (m.images && m.images.length) await _saveMsgImgs(msgId, m.images);
    }
    return await _rowToChat((await DB.query("SELECT * FROM consult_chats WHERE id = ?", [id]))[0], false);
  }
  async function deleteConsultChat(id) {
    if (_isMemory()) { const d = _memData(); d.consultChats = d.consultChats.filter((c) => c.id !== id); return; }
    const msgs = await DB.query("SELECT id FROM consult_messages WHERE chat_id = ?", [id]);
    for (const m of msgs) { await _deleteImgsFromTable("message_images", "message_id", m.id); }
    await DB.run("DELETE FROM consult_messages WHERE chat_id = ?", [id]);
    await DB.run("DELETE FROM consult_chats WHERE id = ?", [id]);
  }
  async function newConsultChat() {
    const now = new Date().toISOString();
    const item = { id: _uid("chat_"), title: "新对话", createdAt: now, updatedAt: now, messages: [] };
    if (_isMemory()) { _memData().consultChats.unshift(item); return item; }
    await DB.run("INSERT INTO consult_chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", [item.id, item.title, now, now]);
    return item;
  }

  // ---------------- 设置 ----------------
  async function updateSettings(patch) {
    if (_isMemory()) {
      const d = _memData();
      if (patch && patch.ai && typeof patch.ai === "object") {
        const ai = patch.ai;
        d.settings.ai = {
          enabled: ai.enabled !== undefined ? !!ai.enabled : d.settings.ai.enabled,
          baseUrl: ai.baseUrl || d.settings.ai.baseUrl || "https://api.openai.com/v1",
          apiKey: ai.apiKey || d.settings.ai.apiKey || "",
          model: ai.model || d.settings.ai.model || "gpt-4o",
        };
      }
      if (patch.notifications !== undefined) d.settings.notifications = patch.notifications;
      if (patch.largeFont !== undefined) d.settings.largeFont = patch.largeFont;
      if (patch.reminderTimes) d.settings.reminderTimes = _normReminderTimes(patch.reminderTimes);
      if (Array.isArray(patch.reminders)) d.settings.reminders = patch.reminders;
      return d.settings;
    }
    if (patch && patch.ai && typeof patch.ai === "object") {
      const ai = patch.ai;
      await DB.run("UPDATE ai_settings SET enabled=?, base_url=?, api_key=?, model=? WHERE id=1",
        [ai.enabled ? 1 : 0, ai.baseUrl || "https://api.openai.com/v1", ai.apiKey || "", ai.model || "gpt-4o"]);
    }
    const _set = async (k, v) => { await DB.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [k, String(v)]); };
    if (patch.notifications !== undefined) await _set("notifications", patch.notifications);
    if (patch.largeFont !== undefined) await _set("largeFont", patch.largeFont);
    if (patch.reminderTimes) {
      await _set("reminderTimes_morning", patch.reminderTimes.morning || "08:00");
      await _set("reminderTimes_noon", patch.reminderTimes.noon || "12:30");
      await _set("reminderTimes_evening", patch.reminderTimes.evening || "19:00");
    }
    if (Array.isArray(patch.reminders)) {
      await DB.run("DELETE FROM reminders");
      for (const r of patch.reminders) { if (!r || !r.title) continue;
        await DB.run("INSERT INTO reminders (id, title, type, date, time, enabled, note) VALUES (?, ?, ?, ?, ?, ?, ?)", [r.id || _uid("rem_"), r.title, r.type || "custom", r.date || "", r.time || "", r.enabled !== false ? 1 : 0, r.note || ""]); }
    }
    return (await load()).settings;
  }

  // ---------------- 今日打卡 ----------------
  async function getDone(dateKey) {
    if (_isMemory()) { const d = (_memData().settings.dailyDone[dateKey] || {}); return { medDoses: d.medDoses || {}, tasks: d.tasks || {} }; }
    const rows = await DB.query("SELECT kind, ref_id, value FROM daily_done WHERE date = ?", [dateKey]);
    const out = { medDoses: {}, tasks: {} };
    for (const r of rows) { if (r.kind === "med") out.medDoses[r.ref_id] = true; else out.tasks[r.ref_id] = true; }
    return out;
  }
  async function setDone(dateKey, kind, id, done) {
    if (_isMemory()) {
      const d = _memData();
      if (!d.settings.dailyDone[dateKey]) d.settings.dailyDone[dateKey] = { medDoses: {}, tasks: {} };
      const b = d.settings.dailyDone[dateKey][kind] || (d.settings.dailyDone[dateKey][kind] = {});
      if (done) b[id] = true; else delete b[id];
      const dates = Object.keys(d.settings.dailyDone).sort();
      while (dates.length > 7) { delete d.settings.dailyDone[dates.shift()]; }
      return;
    }
    const dbKind = kind === "medDoses" ? "med" : "task";
    await DB.run("DELETE FROM daily_done WHERE date = ? AND kind = ? AND ref_id = ?", [dateKey, dbKind, id]);
    if (done) await DB.run("INSERT INTO daily_done (date, kind, ref_id, value) VALUES (?, ?, ?, ?)", [dateKey, dbKind, id, String(done)]);
    const dates = (await DB.query("SELECT DISTINCT date FROM daily_done")).map((r) => r.date).sort();
    while (dates.length > 7) { await DB.run("DELETE FROM daily_done WHERE date = ?", [dates.shift()]); }
  }

  // ---------------- 关注指标 ----------------
  async function setFollowedIndicators(arr) {
    if (_isMemory()) {
      const out = [];
      for (const x of (arr || [])) {
        const name = typeof x === "string" ? x.trim() : (x && x.name ? String(x.name).trim() : "");
        if (!name) continue;
        out.push({ name, unit: (x && x.unit) || "", range: (x && x.range) || "" });
      }
      _memData().followedIndicators = out;
      return out;
    }
    await DB.run("DELETE FROM followed_indicators");
    const out = [];
    for (const x of (arr || [])) { const name = typeof x === "string" ? x.trim() : (x && x.name ? String(x.name).trim() : ""); if (!name) continue;
      await DB.run("INSERT INTO followed_indicators (name, unit, range) VALUES (?, ?, ?)", [name, (x && x.unit) || "", (x && x.range) || ""]);
      out.push({ name, unit: (x && x.unit) || "", range: (x && x.range) || "" }); }
    return out;
  }
  async function setIndicatorMeta(map) {
    if (_isMemory()) {
      const d = _memData();
      for (const k in (map || {})) {
        const v = map[k];
        if (!v || typeof v !== "object") continue;
        const cur = d.indicatorMeta[k] || { unit: "", range: "" };
        const unit = String(v.unit || "") || cur.unit;
        const range = String(v.range || "") || cur.range;
        if (!unit && !range) continue;
        d.indicatorMeta[k] = { unit, range };
      }
      return d.indicatorMeta;
    }
    for (const k in (map || {})) { const v = map[k]; if (!v || typeof v !== "object") continue;
      const cur = (await DB.query("SELECT unit, range FROM indicator_meta WHERE name = ?", [k]))[0] || { unit: "", range: "" };
      const unit = String(v.unit || "") || cur.unit, range = String(v.range || "") || cur.range;
      if (!unit && !range) continue;
      await DB.run("INSERT OR REPLACE INTO indicator_meta (name, unit, range) VALUES (?, ?, ?)", [k, unit, range]); }
    return (await load()).indicatorMeta;
  }
  async function setLastDecrement(dateKey) {
    if (_isMemory()) { _memData().lastDecrement = dateKey; return; }
    await DB.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["lastDecrement", dateKey]);
  }

  // ---------------- 分页查询 ----------------
  async function getRecordsPaged(keyword, page, pageSize) {
    if (_isMemory()) { return _pagedFilter(_memData().records, keyword, ["hospital", "doctor", "transcript"], page, pageSize, "createdAt"); }
    const ps = pageSize || PAGE_SIZE, off = (page - 1) * ps, kw = "%" + (keyword || "") + "%";
    const where = keyword ? "WHERE hospital LIKE ? OR doctor LIKE ? OR transcript LIKE ?" : "";
    const vals = keyword ? [kw, kw, kw] : [];
    const total = (await DB.query(`SELECT COUNT(*) AS c FROM records ${where}`, vals))[0].c;
    const rows = await DB.query(`SELECT * FROM records ${where} ORDER BY visit_date DESC LIMIT ? OFFSET ?`, [...vals, ps, off]);
    return { rows: await _batchRowsToRecords(rows), total, hasMore: page * ps < total };
  }
  async function getOrdersPaged(keyword, page, pageSize) {
    if (_isMemory()) { return _pagedFilter(_memData().orders, keyword, ["source"], page, pageSize, "date"); }
    const ps = pageSize || PAGE_SIZE, off = (page - 1) * ps, kw = "%" + (keyword || "") + "%";
    let sql, vals;
    if (keyword) {
      sql = `SELECT DISTINCT o.* FROM orders o LEFT JOIN order_medicines m ON m.order_id = o.id WHERE m.name LIKE ? OR o.source LIKE ? ORDER BY o.date DESC LIMIT ? OFFSET ?`;
      vals = [kw, kw, ps, off];
      const tc = (await DB.query("SELECT COUNT(DISTINCT o.id) AS c FROM orders o LEFT JOIN order_medicines m ON m.order_id = o.id WHERE m.name LIKE ? OR o.source LIKE ?", [kw, kw]))[0].c;
      const rows = await DB.query(sql, vals);
      return { rows: await Promise.all(rows.map((r) => _rowToOrder(r, false))), total: tc, hasMore: page * ps < tc };
    }
    const total = (await DB.query("SELECT COUNT(*) AS c FROM orders"))[0].c;
    const rows = await DB.query("SELECT * FROM orders ORDER BY date DESC LIMIT ? OFFSET ?", [ps, off]);
    return { rows: await Promise.all(rows.map((r) => _rowToOrder(r, false))), total, hasMore: page * ps < total };
  }
  async function getReportsPaged(keyword, page, pageSize) {
    if (_isMemory()) { return _pagedFilter(_memData().reports, keyword, ["title"], page, pageSize, "date"); }
    const ps = pageSize || PAGE_SIZE, off = (page - 1) * ps, kw = "%" + (keyword || "") + "%";
    const where = keyword ? "WHERE title LIKE ?" : "";
    const vals = keyword ? [kw] : [];
    const total = (await DB.query(`SELECT COUNT(*) AS c FROM reports ${where}`, vals))[0].c;
    const rows = await DB.query(`SELECT * FROM reports ${where} ORDER BY date DESC LIMIT ? OFFSET ?`, [...vals, ps, off]);
    return { rows: await Promise.all(rows.map((r) => _rowToReport(r, false))), total, hasMore: page * ps < total };
  }
  async function getConsultChatsPaged(keyword, page, pageSize) {
    if (_isMemory()) { return _pagedFilter(_memData().consultChats, keyword, ["title"], page, pageSize, "updatedAt"); }
    const ps = pageSize || PAGE_SIZE, off = (page - 1) * ps, kw = "%" + (keyword || "") + "%";
    const where = keyword ? "WHERE title LIKE ?" : "";
    const vals = keyword ? [kw] : [];
    const total = (await DB.query(`SELECT COUNT(*) AS c FROM consult_chats ${where}`, vals))[0].c;
    const rows = await DB.query(`SELECT * FROM consult_chats ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, [...vals, ps, off]);
    return { rows: await Promise.all(rows.map((r) => _rowToChat(r, false))), total, hasMore: page * ps < total };
  }
  async function getCabinetDrugsPaged(keyword, page, pageSize) {
    if (_isMemory()) { return _pagedFilter(_memData().cabinet, keyword, ["name", "alias", "manufacturer"], page, pageSize, "name"); }
    const ps = pageSize || PAGE_SIZE, off = (page - 1) * ps, kw = "%" + (keyword || "") + "%";
    const where = keyword ? "WHERE name LIKE ? OR alias LIKE ? OR manufacturer LIKE ?" : "";
    const vals = keyword ? [kw, kw, kw] : [];
    const total = (await DB.query(`SELECT COUNT(*) AS c FROM cabinet_drugs ${where}`, vals))[0].c;
    const rows = await DB.query(`SELECT * FROM cabinet_drugs ${where} ORDER BY name ASC LIMIT ? OFFSET ?`, [...vals, ps, off]);
    return { rows: await Promise.all(rows.map(_rowToCabinetDrug)), total, hasMore: page * ps < total };
  }

  function _pagedFilter(arr, keyword, fields, page, pageSize, sortField) {
    const ps = pageSize || PAGE_SIZE, off = (page - 1) * ps;
    let filtered = arr;
    if (keyword) { const kw = keyword.toLowerCase(); filtered = arr.filter((item) => fields.some((f) => String(item[f] || "").toLowerCase().includes(kw))); }
    filtered = filtered.slice().sort((a, b) => String(b[sortField] || "").localeCompare(String(a[sortField] || "")));
    const total = filtered.length;
    return { rows: filtered.slice(off, off + ps), total, hasMore: page * ps < total };
  }

  // ---------------- 导出/导入 ----------------
  async function exportJSON() {
    const data = _empty();
    const loaded = await load();
    Object.assign(data, loaded);
    data.records = await getRecords();
    data.orders = await getOrders();
    data.reports = await getReports();
    data.consultChats = await getConsultChats();
    return JSON.stringify(data, null, 2);
  }
  async function importJSON(jsonStr, selection) {
    const incoming = JSON.parse(jsonStr);
    const ok = (k) => !selection || selection[k] === true;
    const forceIds = new Set();
    if (ok("records") && Array.isArray(incoming.records)) {
      for (const r of incoming.records) {
        if (!r || !r.id) continue;
        await appendRecord(r);
        if (r.orderId) forceIds.add(r.orderId);
        if (r.reportId) forceIds.add(r.reportId);
      }
    }
    if ((ok("orders") || forceIds.size) && Array.isArray(incoming.orders)) {
      for (const o of incoming.orders) {
        if (!o || !o.source) continue;
        if (ok("orders") || forceIds.has(o.id)) await upsertOrder(o);
      }
    }
    if ((ok("reports") || forceIds.size) && Array.isArray(incoming.reports)) {
      for (const rp of incoming.reports) {
        if (!rp) continue;
        if (ok("reports") || forceIds.has(rp.id)) await upsertReport(rp);
      }
    }
    if (ok("cabinet") && Array.isArray(incoming.cabinet)) {
      for (const c of incoming.cabinet) { if (c && c.name) await upsertCabinetDrug(c); }
    }
    if (ok("settings") && incoming.settings) {
      const s = incoming.settings;
      const patch = {};
      if (s.ai && typeof s.ai === "object") {
        const hasContent = s.ai.baseUrl || s.ai.apiKey || s.ai.model;
        if (hasContent) {
          patch.ai = {};
          if (s.ai.enabled !== undefined) patch.ai.enabled = s.ai.enabled;
          if (s.ai.baseUrl) patch.ai.baseUrl = s.ai.baseUrl;
          if (s.ai.apiKey) patch.ai.apiKey = s.ai.apiKey;
          if (s.ai.model) patch.ai.model = s.ai.model;
        }
      }
      if (s.notifications !== undefined) patch.notifications = s.notifications;
      if (s.largeFont !== undefined) patch.largeFont = s.largeFont;
      if (s.reminderTimes) patch.reminderTimes = s.reminderTimes;
      if (Array.isArray(s.reminders)) patch.reminders = s.reminders;
      if (Object.keys(patch).length) await updateSettings(patch);
    }
    if (Array.isArray(incoming.followedIndicators)) {
      await setFollowedIndicators(incoming.followedIndicators);
    }
    if (incoming.indicatorMeta && typeof incoming.indicatorMeta === "object") {
      await setIndicatorMeta(incoming.indicatorMeta);
    }
    return await load();
  }

  // ---------------- 工具 ----------------
  function drugNames(med) {
    const names = [med.name];
    if (med.alias && String(med.alias).trim() && !names.includes(String(med.alias).trim())) names.push(String(med.alias).trim());
    return names;
  }
  function summarizeMedicines(orders) {
    const map = {};
    (orders || []).forEach((o) => { (o.medicines || []).forEach((m) => {
      const key = (m.name || "").trim(); if (!key) return;
      if (!map[key]) map[key] = { name: key, manufacturer: m.manufacturer || "", alias: m.alias || "", unit: "片", spec: m.spec || "", qty: 0, status: "active", doseAmount: 0, doseUnit: "片", timeSlots: [], meal: "any", threshold: 0, orderIds: [], occurrences: 0 };
      const s = map[key]; s.qty += Number(m.qty) || 0; s.occurrences++; if (s.orderIds.indexOf(o.id) < 0) s.orderIds.push(o.id);
    }); });
    return Object.values(map);
  }

  async function save(data) { return data; }

  function isNative() { return !_isMemory(); }

  async function _resetForTest() {
    _mem = null;
    if (!_isMemory() && DB && DB.isReady()) {
      const tables = ["record_images", "record_medications", "record_tasks", "record_tags", "record_risks", "record_exam_results", "record_prescriptions", "order_medicines", "order_images", "cabinet_time_slots", "report_indicators", "report_images", "consult_messages", "message_images", "reminders", "daily_done", "records", "orders", "cabinet_drugs", "reports", "consult_chats", "indicator_meta", "followed_indicators", "app_settings"];
      for (const t of tables) await DB.run(`DELETE FROM ${t}`, []);
      await DB.run("INSERT OR REPLACE INTO ai_settings (id, enabled, base_url, api_key, model) VALUES (1, 0, 'https://api.openai.com/v1', '', 'gpt-4o')", []);
    }
  }

  return {
    isNative, load, save,
    appendRecord, getRecords, getRecord, updateRecord, deleteRecord,
    getOrders, getOrder, upsertOrder, updateOrder, deleteOrder,
    getCabinetDrugs, getCabinetDrug, upsertCabinetDrug, updateCabinetDrug, deleteCabinetDrug,
    getReports, getReport, upsertReport, updateReport, deleteReport,
    summarizeMedicines, drugNames,
    updateSettings, getDone, setDone, setFollowedIndicators, setIndicatorMeta, setLastDecrement,
    exportJSON, importJSON,
    getConsultChats, getConsultChat, saveConsultChat, deleteConsultChat, newConsultChat,
    getRecordsPaged, getOrdersPaged, getReportsPaged, getConsultChatsPaged, getCabinetDrugsPaged,
    _resetForTest,
  };
});
