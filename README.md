# nurse — 私人护士 App（Web 可运行原型 v1.0）

> 项目目录：`/workspace/nurse/`

基于《私人护士：多病种医嘱解析引擎（v1.0）》设计稿实现的端到端可演示原型。
患者用 App 开启录音记录医患对话 → 自动转写 → 解析引擎生成**医嘱 / 用药提醒 / 护理任务 / 饮食禁忌 / 风险预警**。

## 功能
- 🎙️ **录音转写**：浏览器 Web Speech API（中文 zh-CN）实时转写，医生-患者对话一键记录
- 💊 **药物清单**：从对话抽取药名（含同音纠错）、剂量、频次、时间、病种；「加量/减量/停药」高亮
- 🔔 **用药提醒**：由药物自动生成定时提醒，可开启浏览器通知
- 📋 **护理任务**：监测项 / 复诊（自动算日期）/ 生活任务，可打卡
- 🥗 **护士叮嘱**：按病种匹配权威饮食宜忌
- ⚠️ **风险预警**：分级（绿/黄/红）异常处理建议
- 📁 **健康档案**：本机 localStorage 保存历次问诊

## 架构
```
浏览器(SPA)  ──转录文本──▶  FastAPI(/api/parse)
                               ├─ LLM 插件(有 OPENAI_API_KEY 则优先)
                               └─ 规则解析引擎(兜底，零依赖可跑)
```
- 前端：原生 HTML/CSS/JS，移动端风格，适老化大按钮
- 后端：FastAPI + 规则引擎（药物词典 / 病种知识库 / 相对日期解析）

## 运行
```bash
cd /workspace/nurse/backend
../.venv/bin/python main.py        # 已内置虚拟环境，免安装
# 或： pip3 install -r ../requirements.txt && python3 main.py
# 浏览器打开 http://localhost:8000  （Chrome/Edge 支持语音识别）
```

### 可选：接入大模型（更准的解析）
```bash
export OPENAI_API_KEY=sk-xxx
export OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，兼容端点
export OPENAI_MODEL=gpt-4o-mini                  # 可选
python3 main.py
```
未配置时自动使用规则引擎，功能完整可用。

## 接口
- `GET  /api/health` → 健康检查（含 llm 开关）
- `POST /api/parse`  body: `{"transcript": "问诊转写文本"}`
  → 返回 `{diseases, medications, tasks, advice, risks, reminders, disclaimer}`

## 说明
- 本原型为演示用途，**不替代医生诊断**，所有结果仅供患者执行参考。
- Web Speech API 依赖浏览器与网络，建议在 Chrome/Edge、localhost 或 HTTPS 下使用；
  不支持时可改用「粘贴文本」入口。
- 真实产品还需：端侧录音上传、云端 ASR（角色分离）、用药冲突检测、家属协同后端、医疗合规与加密。
