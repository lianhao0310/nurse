"""
chunker.py — 文本分块策略

按 Markdown 语义边界分块：
- 以 ## 二级标题为分块边界
- 单块超过 500 字时按段落二次切分
- 保留标题作为 title 字段
"""
import re

MAX_CHUNK_CHARS = 500


def chunk_markdown(md_text, source_path):
    """按 ## 标题分块 Markdown 文本，返回 chunk 列表。

    每个 chunk: {title, text, source_path, chunk_index}
    """
    lines = md_text.split("\n")
    chunks = []
    current_title = ""
    current_lines = []
    chunk_index = 0

    def flush():
        nonlocal chunk_index
        if not current_lines:
            return
        body = "\n".join(current_lines).strip()
        if not body:
            return
        if len(body) <= MAX_CHUNK_CHARS:
            chunks.append({
                "title": current_title,
                "text": body,
                "source_path": source_path,
                "chunk_index": chunk_index,
            })
            chunk_index += 1
        else:
            for sub in _split_by_paragraph(body):
                chunks.append({
                    "title": current_title,
                    "text": sub,
                    "source_path": source_path,
                    "chunk_index": chunk_index,
                })
                chunk_index += 1

    for line in lines:
        if line.startswith("## "):
            flush()
            current_title = line[3:].strip()
            current_lines = []
        elif line.startswith("# ") and not current_title:
            current_title = line[2:].strip()
        else:
            current_lines.append(line)
    flush()
    return chunks


def _split_by_paragraph(text):
    """按空行分段切分超长块，仍超长则硬切。"""
    paragraphs = re.split(r"\n\s*\n", text)
    result = []
    buf = ""
    for para in paragraphs:
        if len(buf) + len(para) + 2 <= MAX_CHUNK_CHARS:
            buf = (buf + "\n\n" + para) if buf else para
        else:
            if buf:
                result.append(buf)
            if len(para) <= MAX_CHUNK_CHARS:
                buf = para
            else:
                for i in range(0, len(para), MAX_CHUNK_CHARS):
                    result.append(para[i:i + MAX_CHUNK_CHARS])
                buf = ""
    if buf:
        result.append(buf)
    return result
