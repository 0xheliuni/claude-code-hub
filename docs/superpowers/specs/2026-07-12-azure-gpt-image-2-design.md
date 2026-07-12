# Azure OpenAI gpt-image-2 接入设计

- 日期: 2026-07-12
- 目标分支: `dev`
- 状态: 设计已批准, 待编写实现计划

## 1. 背景与目标

claude-code-hub 作为代理, 需要新增对 Azure OpenAI 的 gpt-image-2 图像能力的支持,
覆盖两个端点:

- 生图: `POST .../images/generations`
- 改图: `POST .../images/edits`

客户端(调用方)发给 claude-code-hub 的请求是**标准 OpenAI 格式**(仅少量参数与 Azure 不同),
使用 `Authorization: Bearer` 鉴权, 请求路径为 `/v1/images/generations` 与 `/v1/images/edits`。

上游 Azure 的目标格式(示例):

```
POST https://<resource>.openai.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01
Content-Type: application/json
api-key: <AZURE_KEY>
{"prompt":"...","size":"1024x1024","quality":"low","output_compression":100,"output_format":"png","n":1}
```

```
POST https://<resource>.openai.azure.com/openai/deployments/gpt-image-2/images/edits?api-version=2025-04-01-preview
api-key: <AZURE_KEY>
(multipart/form-data: image, prompt, size, n)
```

### 与现有 openai-compatible 通道的硬性不兼容

| 维度 | Azure 要求 | 现状 | 过滤器能否解决 |
|---|---|---|---|
| 路径 | `/openai/deployments/{deployment}/images/{endpoint}` (无 `/v1`) | `buildProxyUrl` 拼 `/v1/images/...` | 否(过滤器不碰 URL) |
| api-version | 必填 query, 且生图/改图版本不同 | `buildProxyUrl` 用请求 query 覆盖 baseUrl query | 否(过滤器不碰 query) |
| 鉴权 | `api-key` 头, 不用 Bearer | openai-compatible 强制 `Authorization: Bearer` (forwarder.ts:5044) | 部分 |
| body 参数 | 生图不支持 `response_format` 等 | gpt-image-2 校验被短路放行 | 是 |

结论: 路径 / api-version / 鉴权三项过滤引擎无法处理(其算子仅作用于 body 与 header),
必须以代码适配 Azure 协议; body 参数调和可结合请求过滤。

## 2. 方案: 新增 `azure-openai` provider 类型(适配器方案)

选定方向 A: 将 Azure 作为一等 provider 类型接入, 在 forwarder 中走专门分支
(参照现有 gemini / codex 适配器的组织方式)。

### 2.1 provider 配置语义

- **URL**: Azure 资源根, 例如 `https://wutaoimage03-001.openai.azure.com`
  (不含 `/openai/deployments/...`, 完整路径由适配器拼接)。
- **Key**: Azure 的 api-key, 复用现有 `provider.key` 字段。
- **api-version**: 采用"内置默认表 + provider 可选覆盖":
  - 内置默认: `generations -> 2024-02-01`, `edits -> 2025-04-01-preview`
  - provider 可选覆盖字段(JSON): 例如 `{"generations":"...","edits":"..."}`
  - 解析优先级: provider 覆盖 > 内置默认
- **鉴权兜底**: 默认纯 `api-key`; 保留现有 provider `customHeaders` 能力,
  供极少数也接受 Bearer / 需要额外头的网关兜底(注意 `authorization`/`x-api-key` 属受保护名, 不能经 customHeaders 注入)。

### 2.2 deployment 解析

- deployment 名取自请求体的 `model` 字段。
  - generations: JSON body 的 `model`
  - edits: multipart 的 `model` 表单字段
- 若缺失 `model` -> 无法确定 deployment -> 返回 400。

## 3. 数据流(转发)

```
客户端 POST /v1/images/generations (OpenAI 风格, Bearer)
  -> guard 链(鉴权/敏感词/请求过滤等, 保持不变)
  -> forwarder: providerType === "azure-openai" 分支
       endpoint   = 由 pathname 判定 generations | edits
       deployment = body.model (edits 取 multipart model 字段)
       apiVersion = resolveAzureApiVersion(provider, endpoint)
       proxyUrl   = {URL}/openai/deployments/{deployment}/images/{endpoint}?api-version={apiVersion}
       headers    = buildAzureImageHeaders(): 设 api-key, 删 authorization, 改写 host, 合并 customHeaders
       body       = 复用现有 JSON / multipart 序列化 (openai-image-compat.ts)
  -> 发往 Azure -> 响应原样回传
```

关键点: Azure 分支自行构建 `proxyUrl`(不经 `buildProxyUrl` 的通用拼接), 从而正确注入
api-version 并省去 `/v1` 前缀。

## 4. body 参数调和(两层)

- **结构性不兼容(代码层)**: 将现有 `sanitizeGenerationsRequestForProvider`
  (`openai-image-compat.ts:980`, 目前仅识别 name/url 含 yunai+azure 的 provider)
  推广到 `providerType === "azure-openai"`, 自动删除 Azure 生图不支持的 `response_format` 等。
- **用户自定义微调(配置层)**: 仍走请求过滤(final 阶段, body scope), 删/改个别字段, 不写死。

## 5. 错误处理

- 缺 `model`(无法定 deployment): 返回 400, 明确提示。
- 命中非 `/images/generations|edits` 的端点: 本期不支持, 返回清晰 400(结构上预留后续扩展)。
- 鉴权失败 / 上游 4xx-5xx: 原样透传 Azure 的错误响应体与状态码。
- 适配器解析异常(如 URL 非法): fail-closed 返回 502/500 并记录日志, 不静默透传错误目标。

## 6. 组件边界

- `azure-image-adapter`(新增, `src/app/v1/_lib/proxy/` 下): 纯函数集合
  - `resolveAzureImageEndpoint(pathname)`: 复用 `getOpenAIImageEndpoint`
  - `resolveAzureApiVersion(provider, endpoint)`: 版本解析
  - `buildAzureImageProxyUrl(baseUrl, deployment, endpoint, apiVersion)`: URL 构建
  - `buildAzureImageHeaders(session, provider, baseUrl)`: 头构建(api-key/删 authorization/host)
  - 每个函数可独立测试, 不依赖 forwarder 内部状态。
- `forwarder.ts`: 新增 `providerType === "azure-openai"` 分支, 组合上述纯函数。
- `openai-image-compat.ts`: `sanitizeGenerationsRequestForProvider` 增加 azure-openai 识别。

## 7. 集成点清单(实现计划将逐一展开)

- `src/types/provider.ts`: 枚举新增 `azure-openai`; provider 类型上新增 api-version 覆盖字段。
- provider 相关 zod 校验(如 `src/actions/provider-endpoints.ts:58`)与其他重复枚举处同步。
- `src/drizzle/schema.ts`: 如需持久化 api-version 覆盖, 新增列, 经 `bun run db:generate` 生成迁移。
- forwarder 转发分支与 header 构建。
- UI: provider 表单支持选择 azure-openai 并填写 api-version 覆盖。
- i18n: 5 语言(zh-CN/zh-TW/en/ja/ru)补充文案, 无 emoji。
- model 目录 / provider 选择: 使 azure-openai provider 可被 `gpt-image-2` 命中。

## 8. 测试(覆盖率 >= 80%)

- URL 构建: 两个端点各自的 api-version 与路径拼接正确, 省去 `/v1` 前缀。
- `resolveAzureApiVersion`: 默认表 + provider 覆盖优先级。
- `buildAzureImageHeaders`: 存在 `api-key`; `authorization` 被删除; host 改写; customHeaders 合并且受保护名被剥离。
- deployment 解析: JSON 与 multipart 两种取值; 缺 model 返回 400。
- param sanitizer: azure-openai 生图删除 `response_format`。
- 端到端(集成): generations(JSON) 与 edits(multipart) 转发目标 URL/头/体符合预期。

## 9. 范围与非目标(YAGNI)

- 本期仅: Azure gpt-image-2 的 generations 与 edits。
- 非目标: Azure chat/completions、embeddings、variations、AAD(Entra ID)令牌鉴权、流式生图。

## 10. 开放项(默认取值)

1. api-version 粒度: 采用内置默认表 + provider 可选覆盖(已确认)。
2. Bearer 兜底: 默认纯 api-key, 保留 customHeaders 兜底能力(已确认)。
