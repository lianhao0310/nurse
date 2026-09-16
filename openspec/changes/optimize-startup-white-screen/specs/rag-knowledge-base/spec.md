## MODIFIED Requirements

### Requirement: 端侧向量嵌入
系统 SHALL 集成 Transformers.js 加载 `bge-small-zh-v1.5` 模型，在前端实时将用户问题文本转换为 512 维向量。Transformers.js 库及其 wasm 依赖 SHALL 随包发布到 `frontend/vendor/` 目录，运行时从本地加载，不依赖 CDN 网络。系统 SHALL 在用户首次发起问诊时按需动态注入 Transformers.js 脚本，不在 App 启动时加载。

#### Scenario: 首次嵌入加载模型
- **WHEN** 用户首次发起中医问诊提问
- **THEN** 系统从本地 `vendor/transformers.min.js` 动态注入 Transformers.js 库，加载 `bge-small-zh-v1.5` 模型，将用户问题转换为 512 维浮点向量，全程不发起 CDN 网络请求

#### Scenario: 后续嵌入复用模型
- **WHEN** 模型已加载后用户再次提问
- **THEN** 系统复用已加载模型实例，直接将问题转换为 512 维向量，不重复加载

#### Scenario: 嵌入失败降级
- **WHEN** 模型加载或向量计算失败
- **THEN** 系统记录错误，中医问诊降级为仅使用精简核心规则 prompt，不中断用户提问

#### Scenario: 启动时不加载 Transformers.js
- **WHEN** App 启动执行 init 流程
- **THEN** Transformers.js 不被加载或执行，不阻塞首屏渲染
