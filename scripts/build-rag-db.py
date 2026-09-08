#!/usr/bin/env python3
"""
build-rag-db.py — 端侧 RAG 向量知识库构建脚本（开发阶段）

从配置的知识源（nihaixia GitHub 仓库、engine.js 知识库）提取文本，
分块、用 bge-small-zh-v1.5 模型生成 512 维向量，写入标准 SQLite 数据库。

用法:
    python scripts/build-rag-db.py --source all
    python scripts/build-rag-db.py --source nihaixia
    python scripts/build-rag-db.py --source engine
    python scripts/build-rag-db.py --source all --output frontend/assets/databases/rag-knowledge.db
"""
import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from embeddings.sources.nihaixia_source import extract_nihaixia
from embeddings.sources.engine_source import extract_engine
from embeddings.embedder import embed_chunks
from embeddings.sqlite_writer import write_db

DEFAULT_OUTPUT = PROJECT_ROOT / "frontend" / "assets" / "databases" / "rag-knowledge.db"


def main():
    parser = argparse.ArgumentParser(
        description="构建端侧 RAG 向量知识库 SQLite 数据库",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
知识源选项:
  all       从 nihaixia 仓库 + engine.js 知识库构建（默认）
  nihaixia  仅从 nihaixia GitHub 仓库构建
  engine    仅从 frontend/engine.js 知识库构建

示例:
  python scripts/build-rag-db.py --source all
  python scripts/build-rag-db.py --source nihaixia --output ./test.db
        """,
    )
    parser.add_argument(
        "--source",
        choices=["all", "nihaixia", "engine"],
        default="all",
        help="知识源选择（默认: all）",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"输出数据库路径（默认: {DEFAULT_OUTPUT}）",
    )
    parser.add_argument(
        "--model",
        default="BAAI/bge-small-zh-v1.5",
        help="嵌入模型（默认: BAAI/bge-small-zh-v1.5）",
    )
    parser.add_argument(
        "--nihaixia-repo",
        default="https://raw.githubusercontent.com/jangviktor-web/nihaixia/main",
        help="nihaixia 仓库 raw URL 前缀",
    )
    parser.add_argument(
        "--nihaixia-local",
        type=Path,
        default=None,
        help="nihaixia 本地仓库目录（优先于远程）",
    )
    args = parser.parse_args()

    print(f"[build-rag-db] 知识源: {args.source}")
    print(f"[build-rag-db] 输出路径: {args.output}")
    print(f"[build-rag-db] 嵌入模型: {args.model}")

    chunks = []

    if args.source in ("all", "nihaixia"):
        print("[build-rag-db] 提取 nihaixia 仓库知识...")
        tcm_chunks = extract_nihaixia(
            repo_raw_base=args.nihaixia_repo if not args.nihaixia_local else None,
            local_dir=args.nihaixia_local,
        )
        print(f"[build-rag-db] nihaixia 产出 {len(tcm_chunks)} 个 chunk")
        chunks.extend(tcm_chunks)

    if args.source in ("all", "engine"):
        print("[build-rag-db] 提取 engine.js 知识库...")
        engine_path = PROJECT_ROOT / "frontend" / "engine.js"
        engine_chunks = extract_engine(engine_path)
        print(f"[build-rag-db] engine.js 产出 {len(engine_chunks)} 个 chunk")
        chunks.extend(engine_chunks)

    if not chunks:
        print("[build-rag-db] 错误: 未提取到任何 chunk", file=sys.stderr)
        sys.exit(1)

    print(f"[build-rag-db] 总计 {len(chunks)} 个 chunk，开始向量化...")
    chunks_with_vectors = embed_chunks(chunks, args.model)
    print(f"[build-rag-db] 向量化完成，维度: {len(chunks_with_vectors[0]['embedding'])}")

    print(f"[build-rag-db] 写入 SQLite 数据库...")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_db(args.output, chunks_with_vectors)
    print(f"[build-rag-db] 完成！数据库已写入: {args.output}")
    print(f"[build-rag-db] 文件大小: {args.output.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
