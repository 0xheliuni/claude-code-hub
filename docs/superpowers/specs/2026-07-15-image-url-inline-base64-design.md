# image_url 下载内联为 base64 (provider 开关) 设计

- 日期: 2026-07-15
- 目标分支: `dev`
- 状态: 设计已批准, 待编写实现计划

## 1. 背景与目标

Azure OpenAI 的 `/images/edits`(以及 gpt-image-2 生图带参考图)在收到 `image_url` 为远程 URL 时,
由 **Azure 服务器自行去下载该 URL**。实测两类失败:

- URL 返回非图片(HTML) -> `invalid_image_file` / "Invalid image data."
- URL 公网可达但 Azure 区域下载超时 -> `invalid_request_error` / "Unable to download content from the provided URL before the timeout."

目标: 在 claude-code-hub 侧新增一个 **provider 级开关**,开启后代理会把请求体里的 `image_url`
远程 URL **自己下载并内联成 `data:<mime>;base64,<...>`**,这样上游(Azure)无需再去抓取远程地址。

## 2. 方案总览

- **开关**: provider 级布尔字段 `downloadImageUrlToBase64`(DB 列 `download_image_url_to_base64`, 默认 `false`)。
  不涉及 `providerType` 枚举, 改动面小。
- **生效条件**: `provider.downloadImageUrlToBase64 === true` 且命中 `/v1/images/generations|edits`
  且请求体为 **JSON**(multipart 已携带文件字节, 跳过)。
- **转换**: 遍历已知字段, 将 `http(s)://` 的 URL 下载后替换为 data URL; `data:` 或裸 base64 原样保留。
- **格式**: base64 data URL, 仍走 JSON(最小改动)。

## 3. 覆盖字段

JSON 请求体中处理以下位置:

- edits: `images[].image_url`、`mask.image_url`
- generations: `image`(字符串或字符串数组)、`image_url`(字符串)

规则: 仅当值是 `http://` 或 `https://` 开头时下载; 值为 `data:` 前缀或其它(裸 base64)时不处理。

## 4. 下载安全与限制

- 仅允许 `http` / `https` 协议。
- SSRF 防护: 解析 URL host, 若为 IP 且命中 `isPrivateIp`(复用 `@/lib/ip/private-ip`), 或 host 为
  `localhost` / `169.254.169.254`(云元数据) 等, 直接拒绝(抛 400)。
  说明: 不做完整 DNS-rebinding 防护(超出本期范围), 仅做字面/IP 字面量层面的基础拦截。
- 超时: 默认 10s(`timeoutMs`)。
- 大小上限: 默认 20MB(`maxBytes`, 与现有 `validateDallEUrlField` 的 20971520 一致)。
- 响应 `Content-Type` 必须为 `image/*`, 据此确定 data URL 的 mime; 否则拒绝。
- 失败策略: 任一 `image_url` 下载失败/超时/超限/非图片 -> 抛 `ProxyError(400)`, 语义清晰,
  不重试、不计熔断(与"参数错误"同类的客户端错误)。

## 5. 组件边界

- 新增 `src/app/v1/_lib/proxy/image-url-inliner.ts`:
  - `fetchImageAsDataUrl(url: string, opts: { fetchImpl?: FetchLike; timeoutMs: number; maxBytes: number }): Promise<string>`
    - 下载单个 URL 并返回 `data:<mime>;base64,<...>`; 违反安全/限制时 throw。
  - `inlineImageUrlsInImageBody(body: Record<string, unknown>, opts: InlineOptions): Promise<void>`
    - 原地遍历并替换 body 中的 image_url/image 字段; `fetchImpl` 可注入以便单测。
  - `isRemoteHttpUrl(value: unknown): value is string`、`assertUrlNotSsrf(url: URL): void` 等内部辅助。
- forwarder: 在 JSON 图像分支、`validateOpenAIImageRequest` 之前, 当开关开启且为图像端点时调用
  `inlineImageUrlsInImageBody`。

## 6. 数据流

```
客户端 POST /v1/images/edits (JSON, images[].image_url = https://...)
  -> guard 链
  -> forwarder JSON 图像分支:
       if provider.downloadImageUrlToBase64 && 是图像端点:
         await inlineImageUrlsInImageBody(messageToSend, { timeoutMs:10000, maxBytes:20MB })
           -> 逐个下载 http(s) 图片 -> 校验 mime/大小 -> 替换为 data URL
       validateOpenAIImageRequest(...)   // data URL 通过 isOpenAIImageUrl 校验
       (azure 分支照旧改写 URL/api-version/api-key)
  -> 发往 Azure(body 内已是 base64, 上游无需下载)
```

## 7. 错误处理

- 下载失败/超时/超 20MB/非 image 类型/SSRF 命中 -> `ProxyError(400)`, message 说明具体 URL 与原因。
- 开关关闭时: 完全不介入, 保持现状(上游自行处理 URL)。

## 8. 测试(覆盖率 >= 80%)

针对 `image-url-inliner.ts`(注入 `fetchImpl` mock, 不真实联网):

- http(s) 的 `images[].image_url` 被替换为 `data:image/png;base64,...`。
- `mask.image_url` 被替换。
- generations 的 `image` 字符串、字符串数组分别被替换; 数组中已是 base64 的元素不变。
- `data:` 前缀值不处理; 裸 base64 不处理。
- 非 `image/*` Content-Type -> 抛错。
- 超过 `maxBytes` -> 抛错。
- 私网 IP host(如 `http://127.0.0.1/x.png`、`http://169.254.169.254/...`)-> 抛错。
- 下载超时 -> 抛错。
- 开关关闭路径: forwarder 不调用内联(通过单测或契约测试体现)。

## 9. 集成点

- `src/drizzle/schema.ts`: providers 表加 `download_image_url_to_base64` boolean 列, 默认 false;
  `bun run db:generate` 生成迁移。
- `src/types/provider.ts`: `Provider` 加可选字段 `downloadImageUrlToBase64?: boolean`。
- `src/repository/_shared/transformers.ts`(及 provider 仓储读取处): 映射新列, 默认 false。
- `src/lib/validation/schemas.ts`: provider 创建/更新 schema 加 `download_image_url_to_base64: z.boolean().optional()`。
- forwarder: JSON 图像分支调用内联器。
- provider 表单: 新增 checkbox + 5 语言 i18n 文案(无 emoji)。
- `bun run openapi:generate` 重新生成类型。

## 10. 范围与非目标(YAGNI)

- 仅处理 JSON 图像请求; multipart 不处理。
- 不做下载缓存/去重(同一 URL 每次重新下载)。
- 不做完整 DNS-rebinding SSRF 防护。
- 不改动上一功能(azure-openai)的既有行为。

## 11. 已确认默认值

- 超时 10s、大小上限 20MB。
- 下载失败即整体 400(不降级为"保留原 URL 继续发送")。
