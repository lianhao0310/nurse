# -*- coding: utf-8 -*-
"""私人护士 App —— 后端服务
- /api/health  健康检查
- /api/parse   POST {transcript} -> 四模块结构化结果（LLM 优先，规则兜底）
- /           托管前端静态文件（移动端风格 SPA）
"""
import os
import sys
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, os.path.dirname(__file__))
from engine import parse_transcript
from llm import llm_available, parse_with_llm

app = FastAPI(title="私人护士 App 后端", version="1.0")

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
FRONTEND_DIR = os.path.abspath(FRONTEND_DIR)


@app.get("/api/health")
def health():
    return {"status": "ok", "llm": llm_available(),
            "engine": "llm + rule-based fallback"}


@app.post("/api/parse")
async def parse(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)
    transcript = (body.get("transcript") or "").strip()
    if not transcript:
        return JSONResponse({"error": "transcript is empty"}, status_code=400)
    # 优先 LLM，失败回退规则
    result = parse_with_llm(transcript)
    if result is None:
        result = parse_transcript(transcript)
    result["llm_enabled"] = llm_available()
    return result


# 托管前端（显式路由优先于挂载，确保 /api 不被静态文件拦截）
@app.get("/")
def index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static_all")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
