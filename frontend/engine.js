/*
 * Nurse · 医嘱解析引擎（客户端规则版）
 * 移植自 backend/engine.py + knowledge.py
 * 完全在浏览器 / iOS WebView 本地运行，零后端依赖。
 *
 * 输出结构（与 Python 版一致）：
 *   { engine, diseases, medications, tasks, advice:{taboo,diet}, risks, reminders, disclaimer }
 *
 * 兼容两种加载方式：
 *   - 浏览器 <script src="engine.js">  ->  window.NurseEngine
 *   - Node 测试                         ->  module.exports
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseEngine = api;
})(this, function () {
  "use strict";

  const TODAY = new Date();

  // ------------------------------------------------------------------
  // 1. 病种知识库
  // ------------------------------------------------------------------
  const DISEASE_KB = {
    高血压: {
      keywords: ["高血压", "血压高", "降压", "收缩压", "舒张压", "高压", "低压"],
      taboo: [
        "忌食腌制食品（咸菜、腊肉、酱菜），每日食盐摄入 < 5g",
        "避免剧烈起身，晨起/起立时动作放缓，防体位性低血压",
        "戒烟限酒，避免情绪激动与熬夜",
        "慎用偏方与不明成分保健品，避免与降压药冲突",
      ],
      diet: [
        "推荐：芹菜、海带、木耳、香蕉（补钾）、深色蔬菜",
        "主食可部分替换为燕麦、糙米等全谷物",
        "每日饮水 1500~2000ml（心功能正常者）",
      ],
      monitor: ["晨起空腹血压", "睡前血压", "必要时午后血压"],
      risk: [
        { trigger: "头晕、视物旋转、站立不稳", level: "yellow", action: "立即坐下/平卧休息，复测血压；若血压明显偏低或持续不缓解，联系家属并就医。" },
        { trigger: "血压 ≥ 180/120mmHg 伴头痛/胸闷", level: "red", action: "疑似高血压急症，立即拨打 120 或前往急诊，避免自行加药。" },
        { trigger: "漏服降压药", level: "green", action: "若想起时距下次服药 >12h 可补服；否则跳过本次，切勿加倍服用。" },
      ],
    },
    "2型糖尿病": {
      keywords: ["糖尿病", "血糖高", "降糖", "空腹血糖", "餐后血糖", "糖化血红蛋白", "胰岛素"],
      taboo: [
        "忌食高糖食物（奶茶、糕点、含糖饮料），控制精制碳水",
        "避免暴饮暴食，做到定时定量进餐",
        "忌空腹饮酒，易诱发低血糖",
        "足部避免受伤感染，每日检查双足",
      ],
      diet: [
        "推荐：绿叶蔬菜、粗粮（荞麦、藜麦）、豆制品、低升糖水果（苹果、草莓）",
        "主食粗细搭配，每餐约一拳头量",
        "优质蛋白：鱼、鸡胸肉、鸡蛋",
      ],
      monitor: ["空腹/餐前血糖", "餐后2小时血糖", "睡前血糖（用胰岛素者）"],
      risk: [
        { trigger: "心慌、手抖、出冷汗、饥饿感（疑似低血糖）", level: "red", action: "立即进食 15g 糖（半杯果汁/3块方糖），15分钟后复测；无改善重复并就医。" },
        { trigger: "血糖 ≥ 16.7mmol/L 伴口渴多尿乏力", level: "yellow", action: "多饮水、复测；若伴恶心腹痛呼吸深快，警惕酮症，尽快就医。" },
        { trigger: "漏服降糖药", level: "green", action: "短效药漏服可餐后补；磺脲类/胰岛素漏服勿随意加倍，遵医嘱。" },
      ],
    },
    冠心病: {
      keywords: ["冠心病", "心绞痛", "胸闷", "心肌缺血", "支架", "冠脉"],
      taboo: ["避免剧烈运动与重体力负荷", "忌饱餐、寒冷刺激与情绪激动", "戒烟，限制高脂高盐饮食"],
      diet: ["推荐：深海鱼（omega-3）、燕麦、坚果（适量）、蔬菜", "烹调以蒸煮为主，少油少盐"],
      monitor: ["静息心率", "运动后胸闷情况", "血压"],
      risk: [
        { trigger: "胸痛持续 >15 分钟、放射至左臂/下颌、伴冷汗", level: "red", action: "高度疑似急性心肌梗死，立即舌下含服硝酸甘油（医嘱）并拨打 120。" },
        { trigger: "活动后胸闷气短加重", level: "yellow", action: "暂停活动、休息；频繁发作需及时复诊调整用药。" },
      ],
    },
    高血脂: {
      keywords: ["高血脂", "高脂血症", "胆固醇", "甘油三酯", "血脂"],
      taboo: ["限制动物内脏、肥肉、油炸食品", "戒烟限酒，减少精制糖摄入"],
      diet: ["推荐：燕麦、豆类、深海鱼、蔬菜瓜果", "增加膳食纤维，控制总热量"],
      monitor: ["血脂四项（3~6个月复查）", "肝功能（服他汀者）"],
      risk: [{ trigger: "服他汀后肌肉酸痛、乏力", level: "yellow", action: "警惕肌病，尽快查肌酸激酶并复诊，勿自行停药。" }],
    },
    慢阻肺: {
      keywords: ["慢阻肺", "COPD", "肺气肿", "慢性支气管炎", "咳喘"],
      taboo: ["严格戒烟并远离二手烟/油烟", "避免受凉感冒与空气污染暴露"],
      diet: ["推荐：高蛋白（蛋奶鱼）、易消化、富含维生素的食物", "少量多餐，保证热量"],
      monitor: ["呼吸频率", "血氧饱和度（指夹式）", "咳痰情况"],
      risk: [{ trigger: "气促明显加重、口唇发绀、血氧 < 90%", level: "red", action: "疑似急性加重，立即吸氧并就医。" }],
    },
    痛风: {
      keywords: ["痛风", "尿酸高", "高尿酸", "痛风石"],
      taboo: ["忌海鲜、动物内脏、浓肉汤、啤酒", "多饮水，避免剧烈运动与受凉"],
      diet: ["推荐：碱性蔬菜、低脂奶、樱桃", "每日饮水 2000ml 以上促尿酸排泄"],
      monitor: ["血尿酸", "发作关节情况"],
      risk: [{ trigger: "关节红肿热痛急性发作", level: "yellow", action: "休息、多饮水、抬高患肢，按医嘱用抗炎药，避免自行用降尿酸药。" }],
    },
  };

  // ------------------------------------------------------------------
  // 2. 药物词典
  // ------------------------------------------------------------------
  const MEDICATIONS = [
    { name: "苯磺酸氨氯地平片", aliases: ["氨氯地平", "络活喜", "安氯地平", "氨氯滴平", "氨录地平"], disease: "高血压" },
    { name: "缬沙坦胶囊", aliases: ["缬沙坦", "代文", "泄沙坦", "歇沙坦"], disease: "高血压" },
    { name: "硝苯地平控释片", aliases: ["硝苯地平", "拜新同", "硝苯滴平", "消苯地平"], disease: "高血压" },
    { name: "美托洛尔缓释片", aliases: ["美托洛尔", "倍他乐克", "美托洛儿", "倍他洛克"], disease: "冠心病" },
    { name: "二甲双胍缓释片", aliases: ["二甲双胍", "盐酸二甲双胍片", "格华止", "二甲双瓜", "二钾双胍", "双甲胍"], disease: "2型糖尿病" },
    { name: "阿卡波糖片", aliases: ["阿卡波糖", "拜糖平", "拜糖苹", "阿卡波塘"], disease: "2型糖尿病" },
    { name: "格列美脲片", aliases: ["格列美脲", "亚莫利", "格列美尿"], disease: "2型糖尿病" },
    { name: "胰岛素注射液", aliases: ["胰岛素", "夷岛素", "姨岛素", "门冬胰岛素", "甘精胰岛素"], disease: "2型糖尿病" },
    { name: "阿托伐他汀钙片", aliases: ["阿托伐他汀", "立普妥", "阿托伐他丁", "阿拖伐他汀"], disease: "高血脂" },
    { name: "瑞舒伐他汀钙片", aliases: ["瑞舒伐他汀", "可定", "瑞舒伐他丁"], disease: "高血脂" },
    { name: "阿司匹林肠溶片", aliases: ["阿司匹林", "拜阿司匹林", "阿思匹林", "阿斯匹林"], disease: "冠心病" },
    { name: "非布司他片", aliases: ["非布司他", "菲布力", "非布司它"], disease: "痛风" },
    { name: "通心络胶囊", aliases: ["通心络"], disease: "冠心病" },
    { name: "复方丹参滴丸", aliases: ["复方丹参", "丹参滴丸"], disease: "冠心病" },
  ];

  const ALIAS_TO_STD = {};
  MEDICATIONS.forEach((m) => {
    ALIAS_TO_STD[m.name] = m.name;
    m.aliases.forEach((a) => {
      if (!(a in ALIAS_TO_STD)) ALIAS_TO_STD[a] = m.name;
    });
  });
  const MED_MATCH_TERMS = Object.keys(ALIAS_TO_STD).sort((a, b) => b.length - a.length);

  function detect_diseases(text) {
    const found = [];
    for (const disease in DISEASE_KB) {
      for (const kw of DISEASE_KB[disease].keywords) {
        if (text.indexOf(kw) !== -1) {
          found.push([disease, kw]);
          break;
        }
      }
    }
    return found;
  }
  function disease_advice(disease) {
    return DISEASE_KB[disease] || {};
  }

  // ------------------------------------------------------------------
  // 3. 基础文本处理
  // ------------------------------------------------------------------
  function _norm(text) {
    return (text || "").replace(/[ 　]/g, "");
  }

  // ------------------------------------------------------------------
  // 4. 剂量 / 频次 / 时间
  // ------------------------------------------------------------------
  const DOSE_RE = /(\d+(?:\.\d+)?\s*(?:毫克|mg|克|g|毫升|ml|片|粒|袋|支|单位|iu|万单位))|(\d+(?:\.\d+)?\s*[片粒袋支])|(\d+\s*分之\s*\d+(?:\s*[片粒])?)/i;
  const FREQ_MAP = [
    [/一天一次|每日一次|1次\/?日|qd|一日一次|每天一次/i, "1次/日"],
    [/一天两次|每日两次|2次\/?日|bid|早晚各?一次|每天两次|一日两次/i, "2次/日"],
    [/一天三次|每日三次|3次\/?日|tid|每天三次|一日三次/i, "3次/日"],
    [/一天四次|每日四次|4次\/?日|qid/i, "4次/日"],
    [/每周一次|1次\/?周|一周一次/i, "1次/周"],
    [/每周两次|2次\/?周/i, "2次/周"],
    [/隔日一次|每两日一次/i, "隔日1次"],
    [/必要时|疼时|需要时/i, "必要时"],
  ];
  const TIME_KEYWORDS = {
    晨起: "晨起", 早晨: "早晨", 早上: "早上", 清晨: "清晨",
    早餐前: "早饭前", 早饭前: "早饭前", 空腹: "空腹",
    早餐后: "早饭后", 早饭后: "早饭后", 早饭: "早饭",
    午餐前: "午饭前", 午饭前: "午饭前", 中午: "中午",
    午餐后: "午饭后", 午饭后: "午饭后", 午饭: "午饭",
    晚餐前: "晚饭前", 晚饭前: "晚饭前",
    晚餐后: "晚饭后", 晚饭后: "晚饭后", 晚饭: "晚饭", 晚上: "晚上",
    睡前: "睡前", 睡觉前: "睡前", 临睡: "睡前",
    饭后: "饭后", 餐前: "饭前", 饭前: "饭前", 餐中: "餐中", 饭中: "餐中",
  };
  const OFFSET_RE = /(?:饭后|饭前|餐后|餐前)?\s*(\d+)\s*(分钟|小时|刻钟)/;
  const NOTE_WORDS = ["加量", "减量", "停药", "停用", "加服", "减半", "加倍", "增到", "增至", "减到", "减至", "调高", "调低"];

  function extract_dose(window) {
    const m = DOSE_RE.exec(window);
    if (m) return m[0].replace(/\s+/g, "");
    if (window.indexOf("半片") !== -1 || window.indexOf("半粒") !== -1) return "半片";
    return "";
  }
  function extract_freq(window) {
    for (const [pat, label] of FREQ_MAP) if (pat.test(window)) return label;
    return "";
  }
  function extract_time(window) {
    let offset = "";
    const om = OFFSET_RE.exec(window);
    if (om) offset = om[1] + om[2];
    let hit = "";
    for (const kw in TIME_KEYWORDS) {
      if (window.indexOf(kw) !== -1) {
        hit = TIME_KEYWORDS[kw];
        break;
      }
    }
    if (offset && hit) return hit + offset;
    if (hit) return hit;
    if (offset) return ("饭后" in window || window.indexOf("饭后") !== -1 || window.indexOf("餐后") !== -1) ? "饭后" + offset : offset;
    return "";
  }
  function extract_note(window) {
    for (const w of NOTE_WORDS) if (window.indexOf(w) !== -1) return w;
    return "";
  }

  // ------------------------------------------------------------------
  // 5. 相对日期（复诊）
  // ------------------------------------------------------------------
  const REL_DATE_RE = /(\d+)\s*(天|日|周|星期|个月|月|礼拜)后|下\s*(周|星期|个月|月|礼拜)|半\s*(个月|月|年)|一\s*(周|星期|个月|月|礼拜)后|两\s*(周|星期|个月|月|礼拜)后|三\s*(周|星期|个月|月|礼拜)后|四\s*(周|星期|个月|月|礼拜)后|六\s*(个月|月)后/;
  const _CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 半: 0.5 };

  function _unit_to_days(unit, num) {
    if (unit === "天" || unit === "日") return num;
    if (unit === "周" || unit === "星期" || unit === "礼拜") return Math.round(num * 7);
    if (unit === "个月" || unit === "月") return Math.round(num * 30);
    if (unit === "年") return Math.round(num * 365);
    return num;
  }
  function parse_relative_date(text) {
    const m = REL_DATE_RE.exec(text);
    if (!m) return [null, ""];
    const raw = m[0];
    const num_unit = /(\d+|[一二两三四五六半])\s*(天|日|周|星期|个月|月|礼拜|年)/.exec(raw);
    if (num_unit) {
      const token = num_unit[1];
      const unit = num_unit[2];
      const num = /^\d+$/.test(token) ? parseInt(token, 10) : (_CN_NUM[token] || 1);
      const d = new Date(TODAY.getTime() + _unit_to_days(unit, num) * 86400000);
      return [d.toISOString().slice(0, 10), raw];
    }
    if (raw.indexOf("下") === 0) {
      const unit = raw.slice(1);
      const d = new Date(TODAY.getTime() + _unit_to_days(unit, 1) * 86400000);
      return [d.toISOString().slice(0, 10), raw];
    }
    return [null, raw];
  }
  function _revisit_date_near(text) {
    const m = /复诊|复查|回访|随诊/.exec(text);
    if (!m) return parse_relative_date(text);
    const i = m.index;
    const window = text.slice(Math.max(0, i - 12), i + 30);
    return parse_relative_date(window);
  }

  // ------------------------------------------------------------------
  // 6. 药物抽取
  // ------------------------------------------------------------------
  function extract_medications(text, diseases) {
    const spans = [];
    for (const term of MED_MATCH_TERMS) {
      let start = 0;
      while (true) {
        const idx = text.indexOf(term, start);
        if (idx === -1) break;
        if (spans.some(([s, e]) => s <= idx && idx < e)) {
          start = idx + 1;
          continue;
        }
        spans.push([idx, idx + term.length, term]);
        start = idx + term.length;
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    const n = spans.length;
    const meds = [];
    for (let i = 0; i < n; i++) {
      const [s, e, term] = spans[i];
      const nxt = i + 1 < n ? spans[i + 1][0] : text.length;
      let sent_end = nxt;
      for (let j = e; j < nxt; j++) {
        if ("。！？\n".indexOf(text[j]) !== -1) {
          sent_end = j + 1;
          break;
        }
      }
      const scope = text.slice(s, sent_end);
      const std = ALIAS_TO_STD[term] || term;
      const kb_disease = (MEDICATIONS.find((m) => m.name === std) || {}).disease || "";
      const disease = kb_disease || (diseases.length ? diseases[0][0] : "");
      meds.push({
        name: std,
        dose: extract_dose(scope),
        freq: extract_freq(scope),
        time: extract_time(scope),
        disease: disease,
        note: extract_note(scope),
        raw: scope,
      });
    }
    const merged = {};
    for (const m of meds) {
      if (!(m.name in merged)) merged[m.name] = m;
      else {
        for (const f of ["dose", "freq", "time", "note", "disease"]) {
          if (!merged[m.name][f] && m[f]) merged[m.name][f] = m[f];
        }
      }
    }
    return Object.values(merged);
  }

  // ------------------------------------------------------------------
  // 7. 任务抽取
  // ------------------------------------------------------------------
  const MONITOR_PATTERNS = [
    ["血压", /测血压|量血压|量一下血压|测一下血压|监测血压|量血圧|测血圧/],
    ["血糖", /测血糖|量血糖|监测血糖|测一下血糖|空腹血糖|餐后血糖/],
    ["心率", /测心率|量心率|监测心率/],
    ["血氧", /测血氧|量血氧|监测血氧/],
    ["体重", /称体重|测体重|监测体重/],
  ];
  const LIFE_PATTERNS = [
    ["每日步行30分钟", /步行|散步|走路|多走/],
    ["清淡饮食/低盐", /低盐|清淡|少盐|控盐|吃得淡/],
    ["戒烟", /戒烟/],
    ["限酒", /限酒|少喝酒|戒酒/],
    ["控制体重", /减肥|控制体重|减重|瘦下来/],
    ["规律作息/休息", /多休息|静坐休息|规律作息|别熬夜|早休息|充足睡眠/],
    ["适量运动", /运动|锻炼|活动/],
  ];
  function extract_tasks(text) {
    const tasks = [];
    for (const [label, pat] of MONITOR_PATTERNS) {
      if (pat.test(text)) {
        let freq = /早晚|每天|每日|一天/.test(text) ? "每日" : "按医嘱";
        if (text.indexOf("早晚") !== -1 && (label === "血压" || label === "血糖")) freq = "早晚各1次";
        tasks.push({ type: "monitor", title: "监测" + label, detail: freq + "测量并记录" + label, freq, due: "" });
      }
    }
    if (/复诊|复查|下次|回访|随诊|再来看/.test(text)) {
      const [iso, raw] = _revisit_date_near(text);
      let detail = "按时复诊，携带既往病历与检查单";
      let due = "";
      if (iso) {
        detail += "；建议日期：" + iso + "（" + raw + "）";
        due = iso;
      } else {
        detail += "；请遵医嘱确定复诊时间";
      }
      tasks.push({ type: "revisit", title: "复诊/复查", detail, freq: "单次", due });
    }
    for (const [label, pat] of LIFE_PATTERNS) {
      if (pat.test(text)) {
        tasks.push({
          type: "life",
          title: label,
          detail: "遵医嘱执行：" + label,
          freq: label === "戒烟" || label === "限酒" ? "长期" : "每日",
          due: "",
        });
      }
    }
    return tasks;
  }

  // ------------------------------------------------------------------
  // 8. 叮嘱与风险
  // ------------------------------------------------------------------
  function build_advice(diseases) {
    const taboo = [];
    const diet = [];
    for (const [d] of diseases) {
      const info = disease_advice(d);
      (info.taboo || []).forEach((t) => taboo.push({ disease: d, text: t }));
      (info.diet || []).forEach((t) => diet.push({ disease: d, text: t }));
    }
    return [taboo, diet];
  }
  function build_risks(diseases) {
    const risks = [];
    for (const [d] of diseases) {
      (disease_advice(d).risk || []).forEach((r) => risks.push(Object.assign({ disease: d }, r)));
    }
    return risks;
  }

  // ------------------------------------------------------------------
  // 9. 提醒时间表（由药物派生）
  // ------------------------------------------------------------------
  const BASE_TIME = {
    晨起: "07:00", 早晨: "07:00", 早上: "07:00", 清晨: "07:00",
    早饭前: "07:00", 空腹: "07:00",
    早饭后: "08:00", 早饭: "08:00",
    中午: "12:00", 午饭前: "12:00", 午饭: "12:00",
    午饭后: "13:00",
    晚饭前: "18:00",
    晚饭后: "19:00", 晚饭: "19:00", 晚上: "19:00",
    睡前: "21:30",
    饭后: "12:00", 饭前: "12:00", 餐中: "12:30", 餐前: "12:00",
  };
  function _shift(hhmm, add_min) {
    const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
    let total = (h * 60 + m + add_min) % 1440;
    if (total < 0) total += 1440;
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }
  function _calc_times(freq, tdesc) {
    let base = "12:00";
    for (const kw in BASE_TIME) {
      if (tdesc.indexOf(kw) !== -1) {
        base = BASE_TIME[kw];
        break;
      }
    }
    let offset_min = 0;
    const om = /(\d+)\s*(分钟|小时)/.exec(tdesc);
    if (om) offset_min = om[2] === "小时" ? parseInt(om[1], 10) * 60 : parseInt(om[1], 10);
    let points = ["12:00"];
    if (freq === "1次/日" || freq === "qd" || freq === "隔日1次") points = [base];
    else if (freq === "2次/日" || freq === "bid") points = /早/.test(tdesc) || /晚/.test(tdesc) || !tdesc ? ["07:00", "19:00"] : [base, _shift(base, 12 * 60)];
    else if (freq === "3次/日" || freq === "tid") points = ["07:00", "12:00", "19:00"];
    else if (freq === "4次/日" || freq === "qid") points = ["07:00", "11:00", "15:00", "19:00"];
    else points = [base];
    return points.map((p) => _shift(p, offset_min));
  }
  function schedule_reminders(meds) {
    const reminders = [];
    for (const m of meds) {
      const times = _calc_times(m.freq || "", m.time || "");
      for (const t of times) {
        reminders.push({ med: m.name, dose: m.dose || "", time: t, note: m.note || "" });
      }
    }
    return reminders;
  }

  // ------------------------------------------------------------------
  // 10. 主入口
  // ------------------------------------------------------------------
  function parse_transcript(text) {
    text = _norm(text);
    const diseases = detect_diseases(text);
    const meds = extract_medications(text, diseases);
    const tasks = extract_tasks(text);
    const [taboo, diet] = build_advice(diseases);
    const risks = build_risks(diseases);
    const reminders = schedule_reminders(meds);
    return {
      engine: "rule-based v1.0 (client)",
      diseases: diseases.map((d) => d[0]),
      medications: meds,
      tasks,
      advice: { taboo, diet },
      risks,
      reminders,
      disclaimer: "本结果由 AI 根据录音转写生成，仅供参考，具体以医生处方为准。",
    };
  }

  return {
    parse: parse_transcript,
    DISEASE_KB,
    MEDICATIONS,
    ALIAS_TO_STD,
    detect_diseases,
    extract_medications,
    extract_tasks,
    schedule_reminders,
  };
});
