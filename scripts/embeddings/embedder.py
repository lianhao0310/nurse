"""
embedder.py — 向量化模块

使用 sentence-transformers 加载 bge-small-zh-v1.5 模型，
对 chunk 文本生成 512 维向量。
"""
_model_cache = {}


def _get_model(model_name):
    import numpy as np
    from sentence_transformers import SentenceTransformer
    if model_name not in _model_cache:
        print(f"[embedder] 加载模型: {model_name}")
        _model_cache[model_name] = SentenceTransformer(model_name)
    return _model_cache[model_name]


def embed_chunks(chunks, model_name="BAAI/bge-small-zh-v1.5"):
    """对 chunk 列表批量生成向量。

    chunks: [{title, text, ...}]
    返回: [{..., embedding: [float, ...]}]
    """
    model = _get_model(model_name)
    texts = [f"{c['title']}\n{c['text']}" if c.get("title") else c["text"] for c in chunks]
    print(f"[embedder] 向量化 {len(texts)} 条文本...")
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=True)

    for chunk, vec in zip(chunks, vectors):
        chunk["embedding"] = vec.tolist()

    import numpy as np
    dim = len(chunks[0]["embedding"])
    norms = [float(np.linalg.norm(v)) for v in vectors[:3]]
    print(f"[embedder] 向量维度: {dim}, 样本范数: {[f'{n:.4f}' for n in norms]}")
    return chunks


def embed_query(text, model_name="BAAI/bge-small-zh-v1.5"):
    """对单条查询文本生成向量。"""
    model = _get_model(model_name)
    vec = model.encode([text], normalize_embeddings=True)[0]
    return vec.tolist()
