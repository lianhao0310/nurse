# nurse — 私人护士 App（Web 原型 + iOS 移动端）

> 项目目录：`/workspace/nurse-code/`

基于《私人护士：多病种医嘱解析引擎》设计稿实现的端到端可演示项目。
患者用 App 开启录音记录医患对话 → 自动转写 → 解析引擎生成**医嘱 / 用药提醒 / 护理任务 / 饮食禁忌 / 风险预警**；并可沉淀**药单 / 检查报告**两大健康档案实体。

- **Web 原型**：浏览器直接打开，同源后端 `/api/parse` 可选（演示用）。
- **iOS / 移动端**：用 Capacitor 把同一套前端封装成原生 App，解析引擎在手机本地运行（离线、零后端），个人数据存手机文件系统。

## 功能
- 🎙️ **录音转写**：Web Speech API（中文 zh-CN）实时转写，医生-患者对话一键记录；支持粘贴文本 / 上传录音
- 🤖 **AI 智能解析**：集成智谱 GLM（`glm-4.7-flash`，纯文本）等 OpenAI 兼容模型，自动整理医嘱 / 检查结果 / 处方药；未配置密钥时回退本地规则引擎
- 💊 **药箱 / 药单**：**药箱为药品主档**（cabinet，按药名唯一）：厂家 / 别名 / 规格 / 库存 / 单次用量 / 时段 / 餐次 / 阈值 / 状态 / 备注，点击进编辑、左滑删除（库存不为 0 不能删）；**药单条目只记 药名 / 厂家 / 别名 / 数量**（药名创建后不可改），保存时自动同步药箱库存（新药单入库、编辑按差额调整、删除回退，无引用药品自动清理）；药单内添加**新药**可展开全属性一次建档
- 🔔 **用药提醒**：按药箱在用药品，按早 / 中 / 晚自动排程并推送系统通知；每日自动按「单次用量 × 时段数」扣减药箱库存、低于阈值自动标记缺药
- 🧪 **检查报告**：自测 / 医院检查报告实体（标题 / 日期 / 多项指标含参考范围与异常标记）；**指标单位 / 参考值自动记忆**——填过相同指标直接填充，修改任一处同名指标同步全部；**关注指标**通过标题右侧 ⚙ 管理，小卡片自带删除按钮，趋势图支持左右滑动切换
- 📋 **问诊记录**：关联「医院 + 就诊日期 + 医生 + 医嘱」；详情页内嵌**与药箱 / 检查明细同构的药单与报告卡片**——点击进编辑、左滑删除（级联回退药箱库存）；医院药单 / 报告的标题与日期随问诊记录自动同步，自建 / 自测可自由修改；支持 AI 分析与医嘱分析
- 📁 **健康档案**：**落盘到手机文件系统**（Capacitor Filesystem 写入 App 的 Documents 目录），非电容环境回退 localStorage；支持**导出 / 导入单个 JSON**，换机可完整迁移历史

## 架构
```
┌─ 移动端（Capacitor iOS / Android）──────────────────────┐
│  WKWebView 运行 frontend/（纯静态）                       │
│   · engine.js   本地规则解析引擎（离线，零后端）          │
│   · storage.js  持久化：手机文件系统 JSON（Documents）     │
│   · app.js      交互 / 渲染 / 提醒 / 档案                  │
│   · ai.js       OpenAI 兼容模型调用（GLM 等）             │
└───────────────────────────────────────────────────────────┘
        ↑ 同一套 frontend/ 也由后端静态托管（Web 演示）
┌─ Web 演示（可选，FastAPI）───────────────────────────────┐
│  GET /  ·  POST /api/parse（LLM 插件 或 规则引擎兜底）    │
└───────────────────────────────────────────────────────────┘
```

### 数据模型（`frontend/storage.js`，单文件 `nurse-data.json`）
- **records**（问诊记录）：医院 / 就诊日期 / 医生 / 医嘱 / 录音 / 资料照片；`orderId`、`reportId` 关联下方两大实体
- **orders**（药单）：来源 / 日期 / 属性（`custom` 自建 / `hospital` 医院）；`medicines[]` 只记 药名 / 厂家 / 别名 / 数量，通过药名关联药箱
- **cabinet**（药箱药品主档）：按药名唯一，承载规格 / 库存 / 用法 / 阈值 / 状态等全部主属性；每日消耗由「单次用量 × 时段数」自动计算，不再手动录入；旧数据（药品属性嵌在药单条目上）首次加载自动迁移
- **reports**（检查报告）：标题 / 日期 / 属性（`self` 自测 / `hospital` 医院）；`indicators[]` 含指标名 / 数值 / 单位 / 参考范围 / 异常标记
- **indicatorMeta**（指标记忆）：指标名 → { 单位, 参考范围 }，隐式维护不展示，用于自动填充与同名同步
- **followedIndicators**（关注指标）：按指标名记录，用于置顶与最新值展示
- 库存同步规则：药单保存 / 删除 / 条目增删均自动 diff 同步药箱库存；删除后无任何药单引用的药品自动清理

## 本地 Web 演示运行
```bash
cd /workspace/nurse-code/backend
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
cd /workspace/nurse-code
npm install                 # 安装 Capacitor 依赖
npx cap sync ios           # 复制前端资源 + pod install（需 CocoaPods）
npx cap open ios           # 用 Xcode 打开，连接真机/模拟器运行
```
- 数据：每次解析自动写入手机 `Documents/nurse-data.json`（iOS「文件」App 可见）；
  在 App 内点「导出」可生成 JSON 用 AirDrop / 网盘迁移，点「导入」合并历史。
- 解析：完全本地 `engine.js`，无网络依赖，保护隐私；配置 AI Key 后可调用大模型提升解析准确度。

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
nurse-code/
├── backend/        FastAPI 演示后端（可选）
├── frontend/       Web 静态前端 + 本地引擎（engine.js）+ 存储（storage.js）+ AI 调用（ai.js）
├── ios/            Capacitor 生成的 iOS 原生工程（cap add ios）
├── .github/        GitHub Actions 工作流（build-ios / sync-from-gitee）
├── package.json    Capacitor 配置与依赖
└── README.md
```

## 说明
- 本原型为演示用途，**不替代医生诊断**，所有结果仅供患者执行参考。
- Web Speech API 依赖浏览器与网络，建议在 Chrome/Edge、localhost 或 HTTPS 下使用；
  不支持时可改用「粘贴文本」入口。
- AI 解析使用 OpenAI 兼容接口（如智谱 GLM `glm-4.7-flash`），密钥仅保存在本机；未配置时自动回退本地规则引擎。
- 后续可增强：端侧录音上传、云端 ASR（角色分离）、用药冲突检测、家属协同后端、医疗合规与加密、本地 SQLite 索引。
