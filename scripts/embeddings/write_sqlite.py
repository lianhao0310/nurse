"""write_sqlite.py — 从 JSON 读取 chunks 写入 SQLite 数据库"""
import json
import sqlite3
import struct
import os
import sys
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  dim INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_type ON knowledge_chunks(source_type);
CREATE INDEX IF NOT EXISTS idx_source_path ON knowledge_chunks(source_path);
"""

def main():
    json_path = sys.argv[1]
    db_path = sys.argv[2]

    with open(json_path, encoding="utf-8") as f:
        chunks = json.load(f)

    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    conn.execute("DELETE FROM knowledge_chunks")

    now = datetime.now(timezone.utc).isoformat()
    for c in chunks:
        vec = c["embedding"]
        blob = struct.pack(f"<{len(vec)}f", *vec)
        conn.execute(
            "INSERT INTO knowledge_chunks (source_type, source_path, chunk_index, title, text, embedding, dim, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (c["source_type"], c["source_path"], c["chunk_index"], c.get("title", ""), c["text"], blob, len(vec), now),
        )
    conn.commit()

    count = conn.execute("SELECT COUNT(*) FROM knowledge_chunks").fetchone()[0]
    print(f"[write_sqlite] 写入 {count} 条记录到 {db_path}")
    for st, cnt in conn.execute("SELECT source_type, COUNT(*) FROM knowledge_chunks GROUP BY source_type").fetchall():
        print(f"[write_sqlite]   {st}: {cnt} 条")
    conn.close()
    os.remove(json_path)

if __name__ == "__main__":
    main()
