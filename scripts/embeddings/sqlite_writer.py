"""
sqlite_writer.py — SQLite 数据库写入模块

按 design.md 的 schema 创建 knowledge_chunks 表并写入 chunk + 向量 BLOB。
向量以 Float32Array 的 ArrayBuffer 序列化存储（与前端 new Float32Array(blob) 对应）。
"""
import struct
import sqlite3
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


def _vector_to_blob(vector):
    """将 float 列表序列化为 Float32Array 的 ArrayBuffer（小端）。"""
    return struct.pack(f"<{len(vector)}f", *vector)


def write_db(db_path, chunks):
    """将 chunk 列表写入 SQLite 数据库。

    db_path: 输出数据库文件路径
    chunks: [{source_type, source_path, title, text, chunk_index, embedding}]
    """
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(SCHEMA)
        conn.execute("DELETE FROM knowledge_chunks")

        now = datetime.now(timezone.utc).isoformat()
        rows = []
        for c in chunks:
            vec = c["embedding"]
            rows.append((
                c["source_type"],
                c["source_path"],
                c["chunk_index"],
                c.get("title", ""),
                c["text"],
                _vector_to_blob(vec),
                len(vec),
                now,
            ))

        conn.executemany(
            """INSERT INTO knowledge_chunks
               (source_type, source_path, chunk_index, title, text, embedding, dim, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        conn.commit()

        count = conn.execute("SELECT COUNT(*) FROM knowledge_chunks").fetchone()[0]
        print(f"[sqlite_writer] 写入 {count} 条记录到 {db_path}")

        sample = conn.execute(
            "SELECT source_type, COUNT(*) FROM knowledge_chunks GROUP BY source_type"
        ).fetchall()
        for st, cnt in sample:
            print(f"[sqlite_writer]   {st}: {cnt} 条")
    finally:
        conn.close()
