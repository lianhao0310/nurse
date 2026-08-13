# -*- coding: utf-8 -*-
"""
可插拔大模型解析（OpenAI 兼容）
仅当环境变量配置后才启用；任何异常都回退到规则引擎，保证服务可用。
环境变量：
  OPENAI_API_KEY     必填
  OPENAI_BASE_URL    可选，默认 https://api.openai.com/v1
  OPENAI_MODEL       可选，默认 gpt-4o-mini
"""
import os
import json
import requests
from engine import parse_transcript

PROMPT = """你是拥有 20 年经验的高级私人护理专家，擅长从混乱的医患对话中精准提取核心医嘱，\
转化为患者（及子女）看得懂、能执行的标准化护理计划。

请对下面的【原始问诊录音（转写文本）】进行深度解析，严格输出 JSON，不要多余解释。
JSON 结构：
{
  "diseases": ["高血压"],
  "medications": [
    {"name":"药品全称(纠正同音字错别字)","dose":"单次剂量","freq":"每日频次(如1次/日)",
     "time":"具体服用时间(如饭后20分钟)","disease":"针对病种","note":"若提及加量/减量/停药则高亮，否则空"}
  ],
  "tasks": [
    {"type":"monitor|revisit|life","title":"任务名","detail":"说明","freq":"频次","due":"复诊日期ISO或空"}
  ],
  "advice": {"taboo":["禁忌..."], "diet":["饮食..."]},
  "risks": [{"disease":"病种","trigger":"异常场景","level":"green|yellow|red","action":"应对"}]
}
要求：识别所有药物并纠正同音错别字；提取所有非药物指令（监测/复诊/生活）；\
根据病种匹配权威中西医禁忌与饮食建议；给出异常处理预警。"""


def llm_available() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def parse_with_llm(text: str) -> dict | None:
    if not llm_available():
        return None
    try:
        base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        resp = requests.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
                     "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": PROMPT},
                    {"role": "user", "content": f"【原始问诊录音（转写文本）】\n{text}"},
                ],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            },
            timeout=60,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        data = json.loads(content)
        # 兜底补全字段，并生成提醒时间表
        data.setdefault("diseases", [])
        data.setdefault("medications", [])
        data.setdefault("tasks", [])
        data.setdefault("advice", {"taboo": [], "diet": []})
        data.setdefault("risks", [])
        data["engine"] = "llm " + model
        data["reminders"] = _reminders_from(data["medications"])
        data["disclaimer"] = "本结果由 AI 根据录音转写生成，仅供参考，具体以医生处方为准。"
        return data
    except Exception as e:  # 任何失败都回退
        print(f"[llm] parse failed, fallback to rule: {e}")
        return None


def _reminders_from(meds):
    # 复用规则引擎的调度逻辑
    return __import__("engine").schedule_reminders(meds)
