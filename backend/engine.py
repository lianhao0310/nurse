# -*- coding: utf-8 -*-
"""
医嘱解析引擎（规则版）
输入：问诊录音转写文本
输出：四模块结构化结果
  - medications : 药物清单
  - tasks       : 行为代办清单（监测/复诊/生活）
  - advice      : Nurse叮嘱（饮食与禁忌）
  - risks       : 风险预警（异常处理）
  - reminders   : 由药物派生的用药提醒时间表（供前端展示）
设计继承自《Nurse：多病种医嘱解析引擎 v1.0》四模块规范。
"""
import re
import datetime as _dt
from knowledge import (
    MEDICATIONS, MED_MATCH_TERMS, ALIAS_TO_STD, DISEASE_KB,
    detect_diseases, disease_advice,
)

TODAY = _dt.date.today()

# --------------------------- 基础文本处理 ---------------------------
def _norm(text: str) -> str:
    text = text.replace(" ", "").replace("　", "")
    return text

# --------------------------- 剂量 / 频次 / 时间 ---------------------------
DOSE_RE = re.compile(
    r"(\d+(?:\.\d+)?\s*(?:毫克|mg|克|g|毫升|ml|片|粒|袋|支|单位|iu|iu|万单位))"
    r"|(\d+(?:\.\d+)?\s*[片粒袋支])"
    r"|(\d+\s*分之\s*\d+(?:\s*[片粒])?)",  # 如 "半片" "二分之一片"
    re.IGNORECASE,
)

FREQ_MAP = [
    (r"一天一次|每日一次|1次/?日|qd|一日一次|每天一次", "1次/日"),
    (r"一天两次|每日两次|2次/?日|bid|早晚各?一次|每天两次|一日两次", "2次/日"),
    (r"一天三次|每日三次|3次/?日|tid|每天三次|一日三次", "3次/日"),
    (r"一天四次|每日四次|4次/?日|qid", "4次/日"),
    (r"每周一次|1次/?周|一周一次", "1次/周"),
    (r"每周两次|2次/?周", "2次/周"),
    (r"隔日一次|每两日一次", "隔日1次"),
    (r"必要时|疼时|需要时", "必要时"),
]

TIME_KEYWORDS = {
    "晨起": "晨起", "早晨": "早晨", "早上": "早上", "清晨": "清晨",
    "早餐前": "早饭前", "早饭前": "早饭前", "空腹": "空腹",
    "早餐后": "早饭后", "早饭后": "早饭后", "早饭": "早饭",
    "午餐前": "午饭前", "午饭前": "午饭前", "中午": "中午",
    "午餐后": "午饭后", "午饭后": "午饭后", "午饭": "午饭",
    "晚餐前": "晚饭前", "晚饭前": "晚饭前",
    "晚餐后": "晚饭后", "晚饭后": "晚饭后", "晚饭": "晚饭", "晚上": "晚上",
    "睡前": "睡前", "睡觉前": "睡前", "临睡": "睡前",
    "饭后": "饭后", "餐前": "饭前", "饭前": "饭前", "餐中": "餐中", "饭中": "餐中",
}
OFFSET_RE = re.compile(r"(?:饭后|饭前|餐后|餐前)?\s*(\d+)\s*(分钟|小时|刻钟)")

NOTE_WORDS = ["加量", "减量", "停药", "停用", "加服", "减半", "加倍", "增到", "增至", "减到", "减至", "调高", "调低"]


def extract_dose(window: str):
    m = DOSE_RE.search(window)
    if m:
        return m.group(0).replace(" ", "")
    # 半片 / 二分之一 等
    if "半片" in window or "半粒" in window:
        return "半片"
    return ""


def extract_freq(window: str):
    for pat, label in FREQ_MAP:
        if re.search(pat, window, re.IGNORECASE):
            return label
    return ""


def extract_time(window: str):
    # 偏移（如 饭后20分钟）
    offset = ""
    om = OFFSET_RE.search(window)
    if om:
        offset = f"{om.group(1)}{om.group(2)}"
    # 关键词
    hit = ""
    for kw in TIME_KEYWORDS:
        if kw in window:
            hit = TIME_KEYWORDS[kw]
            break
    if offset and hit:
        return f"{hit}{offset}"
    if hit:
        return hit
    if offset:
        return f"饭后{offset}" if "饭后" in window or "餐后" in window else offset
    return ""


def extract_note(window: str):
    for w in NOTE_WORDS:
        if w in window:
            return w
    return ""


# --------------------------- 相对日期解析（复诊） ---------------------------
REL_DATE_RE = re.compile(
    r"(\d+)\s*(天|日|周|星期|个月|月|礼拜)后"
    r"|下\s*(周|星期|个月|月|礼拜)"
    r"|半\s*(个月|月|年)"
    r"|一\s*(周|星期|个月|月|礼拜)后"
    r"|两\s*(周|星期|个月|月|礼拜)后"
    r"|三\s*(周|星期|个月|月|礼拜)后"
    r"|四\s*(周|星期|个月|月|礼拜)后"
    r"|六\s*(个月|月)后"
)

_CN_NUM = {"一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "半": 0.5}


def parse_relative_date(text: str):
    """返回 (iso_date, 原文描述) 或 (None, 原文)"""
    m = REL_DATE_RE.search(text)
    if not m:
        return None, ""
    raw = m.group(0)
    # 数字+单位
    num_unit = re.search(r"(\d+|[一二两三四五六半])\s*(天|日|周|星期|个月|月|礼拜|年)", raw)
    if num_unit:
        num_token, unit = num_unit.group(1), num_unit.group(2)
        num = int(num_token) if num_token.isdigit() else _CN_NUM.get(num_token, 1)
        days = _unit_to_days(unit, num)
        d = TODAY + _dt.timedelta(days=days)
        return d.isoformat(), raw
    if raw.startswith("下"):
        unit = raw[1:]
        days = _unit_to_days(unit, 1)
        d = TODAY + _dt.timedelta(days=days)
        return d.isoformat(), raw
    return None, raw


def _revisit_date_near(text: str):
    """在「复诊/复查」词附近抽取相对日期，避免取到别处的日期"""
    m = re.search(r"复诊|复查|回访|随诊", text)
    if not m:
        return parse_relative_date(text)
    i = m.start()
    window = text[max(0, i - 12): i + 30]
    return parse_relative_date(window)


def _unit_to_days(unit, num):
    if unit in ("天", "日"):
        return num
    if unit in ("周", "星期", "礼拜"):
        return int(num * 7)
    if unit in ("个月", "月"):
        return int(num * 30)
    if unit == "年":
        return int(num * 365)
    return int(num)


# --------------------------- 药物抽取 ---------------------------
def extract_medications(text: str, diseases):
    # 1) 收集所有药物命中跨度（长词优先，避免子串重复）
    spans = []
    for term in MED_MATCH_TERMS:
        start = 0
        while True:
            idx = text.find(term, start)
            if idx == -1:
                break
            if any(s <= idx < e for s, e, _ in spans):
                start = idx + 1
                continue
            end = idx + len(term)
            spans.append((idx, end, term))
            start = end
    spans.sort()
    # 2) 每个药物只在其「所属句子范围」内抽取属性，避免跨药污染
    n = len(spans)
    meds = []
    for i, (s, e, term) in enumerate(spans):
        nxt = spans[i + 1][0] if i + 1 < n else len(text)
        sent_end = nxt
        for j in range(e, nxt):
            if text[j] in "。！？\n":
                sent_end = j + 1
                break
        scope = text[s:sent_end]
        std = ALIAS_TO_STD.get(term, term)
        kb_disease = next((m["disease"] for m in MEDICATIONS if m["name"] == std), "")
        disease = kb_disease or (diseases[0][0] if diseases else "")
        meds.append({
            "name": std,
            "dose": extract_dose(scope),
            "freq": extract_freq(scope),
            "time": extract_time(scope),
            "disease": disease,
            "note": extract_note(scope),
            "raw": scope,
        })
    # 3) 同名合并，补全更丰富的字段
    merged = {}
    for m in meds:
        if m["name"] not in merged:
            merged[m["name"]] = m
        else:
            for f in ("dose", "freq", "time", "note", "disease"):
                if not merged[m["name"]][f] and m[f]:
                    merged[m["name"]][f] = m[f]
    return list(merged.values())


# --------------------------- 任务抽取 ---------------------------
MONITOR_PATTERNS = [
    ("血压", r"测血压|量血压|量一下血压|测一下血压|监测血压|量血圧|测血圧"),
    ("血糖", r"测血糖|量血糖|监测血糖|测一下血糖|空腹血糖|餐后血糖"),
    ("心率", r"测心率|量心率|监测心率"),
    ("血氧", r"测血氧|量血氧|监测血氧"),
    ("体重", r"称体重|测体重|监测体重"),
]

LIFE_PATTERNS = [
    ("每日步行30分钟", r"步行|散步|走路|多走"),
    ("清淡饮食/低盐", r"低盐|清淡|少盐|控盐|吃得淡"),
    ("戒烟", r"戒烟"),
    ("限酒", r"限酒|少喝酒|戒酒"),
    ("控制体重", r"减肥|控制体重|减重|瘦下来"),
    ("规律作息/休息", r"多休息|静坐休息|规律作息|别熬夜|早休息|充足睡眠"),
    ("适量运动", r"运动|锻炼|活动"),
]


def extract_tasks(text: str):
    tasks = []

    # 监测项
    for label, pat in MONITOR_PATTERNS:
        if re.search(pat, text):
            freq = "每日" if re.search(r"早晚|每天|每日|一天", text) else "按医嘱"
            if "早晚" in text and label in ("血压", "血糖"):
                freq = "早晚各1次"
            tasks.append({
                "type": "monitor",
                "title": f"监测{label}",
                "detail": f"{freq}测量并记录{label}",
                "freq": freq,
                "due": "",
            })

    # 复诊（相对日期仅在「复诊」词附近抽取，避免串味）
    if re.search(r"复诊|复查|下次|回访|随诊|再来看", text):
        iso, raw = _revisit_date_near(text)
        detail = "按时复诊，携带既往病历与检查单"
        if iso:
            detail += f"；建议日期：{iso}（{raw}）"
            due = iso
        else:
            detail += "；请遵医嘱确定复诊时间"
            due = ""
        tasks.append({
            "type": "revisit",
            "title": "复诊/复查",
            "detail": detail,
            "freq": "单次",
            "due": due,
        })

    # 生活项
    for label, pat in LIFE_PATTERNS:
        if re.search(pat, text):
            tasks.append({
                "type": "life",
                "title": label,
                "detail": f"遵医嘱执行：{label}",
                "freq": "每日" if label not in ("戒烟", "限酒") else "长期",
                "due": "",
            })
    return tasks


# --------------------------- 叮嘱与风险 ---------------------------
def build_advice(diseases):
    taboo, diet = [], []
    for d, _ in diseases:
        info = disease_advice(d)
        for t in info_get(info, "taboo"):
            taboo.append({"disease": d, "text": t})
        for t in info_get(info, "diet"):
            diet.append({"disease": d, "text": t})
    return taboo, diet


def info_get(info, key):
    return info.get(key, [])


def build_risks(diseases, text):
    risks = []
    for d, _ in diseases:
        for r in disease_advice(d).get("risk", []):
            risks.append({"disease": d, **r})
    return risks


# --------------------------- 提醒时间表（由药物派生） ---------------------------
BASE_TIME = {
    "晨起": "07:00", "早晨": "07:00", "早上": "07:00", "清晨": "07:00",
    "早饭前": "07:00", "空腹": "07:00",
    "早饭后": "08:00", "早饭": "08:00",
    "中午": "12:00", "午饭前": "12:00", "午饭": "12:00",
    "午饭后": "13:00",
    "晚饭前": "18:00",
    "晚饭后": "19:00", "晚饭": "19:00", "晚上": "19:00",
    "睡前": "21:30",
    "饭后": "12:00", "饭前": "12:00", "餐中": "12:30", "餐前": "12:00",
}


def schedule_reminders(meds):
    reminders = []
    for m in meds:
        times = _calc_times(m.get("freq", ""), m.get("time", ""))
        for t in times:
            reminders.append({
                "med": m["name"],
                "dose": m.get("dose", ""),
                "time": t,
                "note": m.get("note", ""),
            })
    return reminders


def _calc_times(freq, tdesc):
    base = "12:00"
    for kw, bt in BASE_TIME.items():
        if kw in tdesc:
            base = bt
            break
    # 偏移（饭后20分钟）
    offset_min = 0
    om = re.search(r"(\d+)\s*(分钟|小时)", tdesc)
    if om:
        v = int(om.group(1))
        offset_min = v * 60 if om.group(2) == "小时" else v
    # 频次 -> 次数与基准点
    points = ["12:00"]
    if freq in ("1次/日", "qd", "隔日1次"):
        points = [base]
    elif freq in ("2次/日", "bid"):
        points = ["07:00", "19:00"] if "早" in tdesc or "晚" in tdesc or not tdesc else [base, _shift(base, 12 * 60)]
    elif freq in ("3次/日", "tid"):
        points = ["07:00", "12:00", "19:00"]
    elif freq in ("4次/日", "qid"):
        points = ["07:00", "11:00", "15:00", "19:00"]
    else:
        points = [base]
    out = []
    for p in points:
        out.append(_shift(p, offset_min))
    return out


def _shift(hhmm, add_min):
    h, m = map(int, hhmm.split(":"))
    total = h * 60 + m + add_min
    total %= 1440
    return f"{total // 60:02d}:{total % 60:02d}"


# --------------------------- 主入口 ---------------------------
def parse_transcript(text: str) -> dict:
    text = _norm(text)
    diseases = detect_diseases(text)
    meds = extract_medications(text, diseases)
    tasks = extract_tasks(text)
    taboo, diet = build_advice(diseases)
    risks = build_risks(diseases, text)
    reminders = schedule_reminders(meds)

    return {
        "engine": "rule-based v1.0",
        "diseases": [d for d, _ in diseases],
        "medications": meds,
        "tasks": tasks,
        "advice": {"taboo": taboo, "diet": diet},
        "risks": risks,
        "reminders": reminders,
        "disclaimer": "本结果由 AI 根据录音转写生成，仅供参考，具体以医生处方为准。",
    }
