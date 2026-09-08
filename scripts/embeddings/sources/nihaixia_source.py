"""
nihaixia_source.py — 从 nihaixia GitHub 仓库或本地目录提取中医知识文本并分块

提取的文件（references/distilled/ 蒸馏速查层）:
- 01-six-meridian-formulas.md  六经辨证公式
- 02-acupuncture-quick-ref.md  针灸速查
- 03-clinical-experience.md    临床经验
- 05-clinical-dose-quickref.md 临床剂量速查
- 06-clinical-dose-c99.md      临床剂量c99
以及根目录 SKILL.md 角色规则
"""
import os
from pathlib import Path

import requests

from embeddings.chunker import chunk_markdown

DISTILLED_FILES = [
    "01-six-meridian-formulas.md",
    "02-acupuncture-quick-ref.md",
    "03-clinical-experience.md",
    "05-clinical-dose-quickref.md",
    "06-clinical-dose-c99.md",
]

SKILL_FILE = "SKILL.md"


def extract_nihaixia(repo_raw_base=None, local_dir=None):
    """从 nihaixia 仓库拉取 Markdown 并分块。

    repo_raw_base: raw.githubusercontent.com URL 前缀（远程模式）
    local_dir: 本地仓库根目录路径（本地模式，优先于远程）
    返回 chunk 列表: {source_type, source_path, title, text, chunk_index}
    """
    chunks = []

    if local_dir:
        local_dir = Path(local_dir)
        skill_path = local_dir / SKILL_FILE
        if skill_path.exists():
            md = skill_path.read_text(encoding="utf-8")
            skill_chunks = chunk_markdown(md, f"nihaixia/{SKILL_FILE}")
            for c in skill_chunks:
                c["source_type"] = "tcm"
            chunks.extend(skill_chunks)
        distilled_dir = local_dir / "references" / "distilled"
        for fname in DISTILLED_FILES:
            fpath = distilled_dir / fname
            if not fpath.exists():
                continue
            md = fpath.read_text(encoding="utf-8")
            file_chunks = chunk_markdown(md, f"nihaixia/references/distilled/{fname}")
            for c in file_chunks:
                c["source_type"] = "tcm"
            chunks.extend(file_chunks)
    elif repo_raw_base:
        skill_url = f"{repo_raw_base}/{SKILL_FILE}"
        md = _fetch(skill_url)
        if md:
            skill_chunks = chunk_markdown(md, f"nihaixia/{SKILL_FILE}")
            for c in skill_chunks:
                c["source_type"] = "tcm"
            chunks.extend(skill_chunks)
        for fname in DISTILLED_FILES:
            url = f"{repo_raw_base}/references/distilled/{fname}"
            md = _fetch(url)
            if not md:
                continue
            file_chunks = chunk_markdown(md, f"nihaixia/references/distilled/{fname}")
            for c in file_chunks:
                c["source_type"] = "tcm"
            chunks.extend(file_chunks)

    return chunks


def _fetch(url):
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"[nihaixia_source] 警告: 获取失败 {url}: {e}")
        return None
