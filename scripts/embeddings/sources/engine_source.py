"""
engine_source.py — 从 frontend/engine.js 提取病种与药物知识并分块

通过 Node.js 子进程执行 engine.js 并提取 DISEASE_KB / MEDICATIONS，
按病种/药物结构化分块：
- 每个病种一个 chunk，text 含 keywords/taboo/diet/monitor/risk
- 每种药物一个 chunk，text 含名称/别名/对应病种
"""
import json
import os
import subprocess
from pathlib import Path

NODE_EXTRACT_SCRIPT = r"""
const fs = require('fs');
const src = fs.readFileSync(process.env.ENGINE_JS_PATH, 'utf8');

function extractVar(startMarker) {
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) return null;
  let depth = 0, end = startIdx;
  for (let i = src.indexOf('{', startIdx); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(startIdx, end);
}

const diseaseSrc = extractVar('const DISEASE_KB = ');
const medSrc = src.match(/const MEDICATIONS\s*=\s*\[([\s\S]*?)\];/);
const DISEASE_KB = diseaseSrc ? eval('(' + diseaseSrc.replace('const DISEASE_KB = ', '') + ')') : {};
const MEDICATIONS = medSrc ? eval('[' + medSrc[1] + ']') : [];
console.log(JSON.stringify({ DISEASE_KB, MEDICATIONS }));
"""


def extract_engine(engine_path):
    """从 engine.js 提取病种与药物知识，返回 chunk 列表。

    engine_path: engine.js 文件路径
    返回: [{source_type, source_path, title, text, chunk_index}]
    """
    engine_path = str(Path(engine_path).resolve())
    env = dict(os.environ, ENGINE_JS_PATH=engine_path)
    result = subprocess.run(
        ["node", "-e", NODE_EXTRACT_SCRIPT],
        capture_output=True, text=True, timeout=10, env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Node.js 解析 engine.js 失败: {result.stderr}")

    data = json.loads(result.stdout)
    chunks = []
    chunk_index = 0

    for disease_name, info in data["DISEASE_KB"].items():
        parts = [f"病种: {disease_name}"]
        if info.get("keywords"):
            parts.append(f"关键词: {', '.join(info['keywords'])}")
        if info.get("taboo"):
            parts.append("禁忌:\n" + "\n".join(f"  - {t}" for t in info["taboo"]))
        if info.get("diet"):
            parts.append("饮食:\n" + "\n".join(f"  - {d}" for d in info["diet"]))
        if info.get("monitor"):
            parts.append("监测: " + ", ".join(info["monitor"]))
        if info.get("risk"):
            risk_lines = []
            for r in info["risk"]:
                risk_lines.append(f"  - [{r.get('level', '?')}] {r.get('trigger', '')}: {r.get('action', '')}")
            parts.append("风险:\n" + "\n".join(risk_lines))
        chunks.append({
            "source_type": "disease",
            "source_path": "engine.js/DISEASE_KB",
            "title": disease_name,
            "text": "\n\n".join(parts),
            "chunk_index": chunk_index,
        })
        chunk_index += 1

    for med in data["MEDICATIONS"]:
        parts = [f"药品: {med['name']}"]
        if med.get("aliases"):
            parts.append(f"别名: {', '.join(med['aliases'])}")
        if med.get("disease"):
            parts.append(f"对应病种: {med['disease']}")
        chunks.append({
            "source_type": "medication",
            "source_path": "engine.js/MEDICATIONS",
            "title": med["name"],
            "text": "\n".join(parts),
            "chunk_index": chunk_index,
        })
        chunk_index += 1

    return chunks
