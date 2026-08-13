# nurse — 私人护士 App（Web 原型 + iOS 移动端 v1.0）

> 项目目录：`/workspace/nurse/`

基于《私人护士：多病种医嘱解析引擎（v1.0）》设计稿实现的端到端可演示项目。
患者用 App 开启录音记录医患对话 → 自动转写 → 解析引擎生成**医嘱 / 用药提醒 / 护理任务 / 饮食禁忌 / 风险预警**。

- **Web 原型**：浏览器直接打开，同源后端 `/api/parse` 可选（演示用）。
- **iOS / 移动端**：用 Capacitor 把同一套前端封装成原生 App，解析引擎在手机本地运行（离线、零后端），个人数据存手机文件系统。

## 功能
- 🎙️ **录音转写**：Web Speech API（中文 zh-CN）实时转写，医生-患者对话一键记录
- 💊 **药物清单**：从对话抽取药名（含同音纠错）、剂量、频次、时间、病种；「加量/减量/停药」高亮
- 🔔 **用药提醒**：由药物自动生成定时提醒，可开启系统通知
- 📋 **护理任务**：监测项 / 复诊（自动算日期）/ 生活任务，可打卡
- 🥗 **护士叮嘱**：按病种匹配权威饮食宜忌
- ⚠️ **风险预警**：分级（绿/黄/红）异常处理建议
- 📁 **健康档案**：**落盘到手机文件系统**（Capacitor Filesystem 写入 App 的 Documents 目录），非电容环境回退 localStorage；支持**导出 / 导入单个 JSON**，换机可完整迁移历史

## 架构
```
┌─ 移动端（Capacitor iOS / Android）──────────────────────┐
│  WKWebView 运行 frontend/（纯静态）                       │
│   · engine.js   本地规则解析引擎（离线，零后端）          │
│   · storage.js  持久化：手机文件系统 JSON（Documents）     │
│   · app.js      交互 / 渲染 / 提醒 / 档案                  │
└───────────────────────────────────────────────────────────┘
        ↑ 同一套 frontend/ 也由后端静态托管（Web 演示）
┌─ Web 演示（可选，FastAPI）───────────────────────────────┐
│  GET /  ·  POST /api/parse（LLM 插件 或 规则引擎兜底）    │
└───────────────────────────────────────────────────────────┘
```

## 本地 Web 演示运行
```bash
cd /workspace/nurse/backend
../.venv/bin/python main.py        # 已内置虚拟环境，免安装
# 浏览器打开 http://localhost:8000  （Chrome/Edge 支持语音识别）
```
> 前端默认使用内置**本地引擎**（`frontend/engine.js`），无需后端即可解析；
> 仅在引擎缺失时回退到 `/api/parse`。

### 可选：后端接入大模型（更准的解析）
```bash
export OPENAI_API_KEY=sk-xxx
export OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，兼容端点
export OPENAI_MODEL=gpt-4o-mini                  # 可选
python3 main.py
```
未配置时自动使用规则引擎，功能完整可用。

## 移动端 / iOS 构建
App 用 [Capacitor](https://capacitorjs.com/) 封装，解析与存储全部在手机本地完成。

```bash
# 前置：Node 20+ ，macOS + Xcode（仅构建 .ipa 时需要）
cd /workspace/nurse
npm install                 # 安装 Capacitor 依赖
npx cap sync ios           # 复制前端资源 + pod install（需 CocoaPods）
npx cap open ios           # 用 Xcode 打开，连接真机/模拟器运行
```
- 数据：每次解析自动写入手机 `Documents/nurse-data.json`（iOS「文件」App 可见）；
  在 App 内点「导出」可生成 JSON 用 AirDrop / 网盘迁移，点「导入」合并历史。
- 解析：完全本地 `engine.js`，无网络依赖，保护隐私。

### 用 GitHub Actions 自动出包（推荐）
本仓库已配置两条 GitHub Actions（见 `.github/workflows/`）：
- `sync-from-gitee.yml`：定时把 Gitee 仓库（源码真源 `lianhao0310/nurse`）镜像到 GitHub。
- `build-ios.yml`：在 GitHub macOS runner 上 `cap sync ios` → `xcodebuild` 产出 `.ipa` 并作为产物上传。

**首次使用需在你 GitHub 仓库 Settings → Secrets 配置：**
| Secret | 说明 |
|---|---|
| `GITEE_TOKEN` | Gitee 私人令牌（供同步拉取） |
| `IOS_CERTIFICATE` | 打包证书 `.p12` 的 **base64**（开发/分发证书） |
| `IOS_CERTIFICATE_PASSWORD` | `.p12` 密码 |
| `IOS_PROVISIONING_PROFILE` | `.mobileprovision` 的 **base64** |
| `APPLE_TEAM_ID` | Apple 开发者团队 ID |
| `IOS_EXPORT_METHOD` | 可选，默认 `ad-hoc`（亦可 `app-store`/`development`） |

> 未配置签名密钥时，`build-ios.yml` 仍会运行并产出**未签名 xcarchive** 供检视（无法安装到设备）；
> 配置上述密钥后重新运行即可获得可安装的 `.ipa`。

## 接口（仅 Web 演示后端）
- `GET  /api/health` → 健康检查（含 llm 开关）
- `POST /api/parse`  body: `{"transcript": "问诊转写文本"}`
  → 返回 `{diseases, medications, tasks, advice, risks, reminders, disclaimer}`

## 目录
```
nurse/
├── backend/        FastAPI 演示后端（可选）
├── frontend/       Web 静态前端 + 本地引擎（engine.js）+ 存储（storage.js）
├── ios/            Capacitor 生成的 iOS 原生工程（cap add ios）
├── .github/        GitHub Actions 工作流（build-ios / sync-from-gitee）
├── package.json    Capacitor 配置与依赖
└── README.md
```

## 说明
- 本原型为演示用途，**不替代医生诊断**，所有结果仅供患者执行参考。
- Web Speech API 依赖浏览器与网络，建议在 Chrome/Edge、localhost 或 HTTPS 下使用；
  不支持时可改用「粘贴文本」入口。
- 后续可增强：端侧录音上传、云端 ASR（角色分离）、用药冲突检测、家属协同后端、医疗合规与加密、本地 SQLite 索引。
