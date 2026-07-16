# images/edits JSON -> multipart 转换 (provider 开关) 设计

- 日期: 2026-07-15
- 目标分支: `dev`
- 状态: 设计已批准, 待编写实现计划

## 1. 背景与目标

部分供应商(如 cloudwise: `POST https://api.cloudwise.ai/api/v1/images/edits`)的 gpt-image-2 改图接口
**只接受 `multipart/form-data`**(文件字段 `image[]`),不接受 JSON + base64 的 `image_url`。

目标: 新增 **provider 级开关**,开启后把上游发来的 **`application/json`** 的 `/v1/images/edits` 请求
**转换成 `multipart/form-data`** 再发给供应商,做接口兼容。

与既有 `downloadImageUrlToBase64`(内联 base64 仍走 JSON, 面向 Azure)是**并列的两条路径**,按 provider 各自选择。

## 2. 方案总览

- **开关**: provider 级布尔 `convertImageJsonToMultipart`(DB 列 `convert_image_json_to_multipart`, 默认 false)。
  不涉及 providerType 枚举。
- **生效条件**: `provider.convertImageJsonToMultipart === true` 且路径 `/v1/images/edits` 且入站为 JSON。
  - 入站已是 multipart -> 透传, 不处理。
  - generations 不处理(本期范围)。
- **文件字段名**: `image[]`(按 cloudwise 文档, 支持重复以传多图)。

## 3. 转换规则(新模块 `image-json-to-multipart.ts`)

输入: 解析后的 JSON body(Record)。输出: multipart part 列表(复用现有 `OpenAIImageRequestMetadata` 形状),
再交给现有 `serializeOpenAIImageMultipartRequest` 生成 FormData 与带 boundary 的 Content-Type。

- 标量 -> 文本 part: `model`、`prompt`、`size`、`quality`、`output_format`、`output_compression`、
  `background`、`input_fidelity`、`n`、`user`(仅当存在且非空)。
- 图片 -> `image[]` 文件 part(可多次):
  - 来源: `images[].image_url`(数组, 每个对象取 image_url); 兼容 `image`(字符串或字符串数组)。
  - `data:<mime>;base64,<...>` -> 直接解码为字节。
  - `http(s)://...` -> 用共享安全下载器下载为字节。
  - 文件名 `image_<index>.<ext>`(ext 由 mime 推导, 默认 png), Content-Type 用解析到的 mime。
- `mask.image_url` -> `mask` 文件 part(同上解码/下载)。
- 丢弃上游不支持字段(如 `response_format`)。

约束/错误:
- 至少要有一张 `image[]`; 否则 -> `ProxyError(400)`。
- 单张图片无效/下载失败/超限/非 image -> `ProxyError(400)`(不重试, 不计熔断)。

## 4. 共享下载器(重构)

将 `image-url-inliner.ts` 内部的下载与安全逻辑抽到新模块 `image-fetch.ts`:

- `class ImageFetchError extends Error`
- `isRemoteHttpUrl(v): v is string`
- `assertUrlNotSsrf(url: string): void`(私网/`localhost`/`169.254.169.254` 拦截, 复用 `isPrivateIp`)
- `decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string }`(解析 `data:<mime>;base64,<...>`)
- `fetchImageBytes(url, opts): Promise<{ bytes: Uint8Array; mime: string }>`(SSRF + 10s 超时 + 20MB 上限 + `image/*` 校验)
- `fetchImageAsDataUrl(url, opts)` 基于 `fetchImageBytes` 实现

`image-url-inliner.ts` 改为从 `image-fetch.ts` 引入这些, 保持其对外 API (`inlineImageUrlsInImageBody`/
`fetchImageAsDataUrl`/`ImageInlineError`) 不变, 现有测试全绿。`ImageInlineError` 可保留为 `ImageFetchError` 的别名或继续存在。

## 5. forwarder 集成

在 JSON 图像分支、序列化(`JSON.stringify(messageToSend)`)之前:

```
if provider.convertImageJsonToMultipart && requestPath === "/v1/images/edits":
    构造 multipart(await buildImageEditsMultipart(messageToSend))
    requestBody = multipart.body; processedHeaders.set("content-type", multipart.contentType)
    isStreaming = false
    跳过 JSON.stringify 分支
else if provider.downloadImageUrlToBase64 && 图像端点:
    (既有) 内联 base64
```

即"转 multipart"优先于"内联 base64";两者都开时走 multipart。鉴权保持 Bearer(openai-compatible 默认)。

## 6. 组件边界

- `image-fetch.ts`(新): 下载/SSRF/data URL 解码的纯函数, 注入 `fetchImpl` 便于测试。
- `image-json-to-multipart.ts`(新): `buildImageEditsMultipart(body, opts): Promise<{ body: ArrayBuffer|Buffer; contentType: string }>`,
  内部用 `image-fetch` + 现有 `serializeOpenAIImageMultipartRequest`。
- forwarder: 组合调用, 不含下载/编码细节。

## 7. 集成点(逐一, 吸取上次 SELECT 漏选教训)

- `src/drizzle/schema.ts`: providers 加 `convert_image_json_to_multipart` boolean 默认 false; `bun run db:generate`。
- `src/types/provider.ts`: 运行时 `Provider` 与 `ProviderDisplay` 各加 `convertImageJsonToMultipart?: boolean`;
  `CreateProviderData`/`UpdateProviderData` 加 `convert_image_json_to_multipart?: boolean`。
- `src/repository/_shared/transformers.ts`: 映射新列(默认 false)。
- `src/repository/provider.ts`: **全部 5 个 provider SELECT 列表**(6 空格与 8 空格缩进都要)+ insert + update 映射。
- `src/actions/providers.ts`: `getProviders` 的 ProviderDisplay 映射加该字段。
- `src/lib/validation/schemas.ts`: 创建/更新 schema 加 `convert_image_json_to_multipart`。
- `src/lib/api/v1/schemas/providers.ts`: 响应(ProviderSummary)+ 请求(ProviderCreate)加该字段。
- `src/app/api/v1/resources/providers/handlers.ts`: 响应序列化加该字段。
- provider 表单(types/context/reducer/payload/options-section)+ 5 语言 i18n。
- `bun run openapi:generate`。

## 8. 测试(>= 80%)

- `image-fetch.test.ts`: `decodeDataUrl` 正确解 mime/字节; `fetchImageBytes` 的 mime/size/SSRF/超时; data URL 不触发 fetch。
- `image-json-to-multipart.test.ts`(注入 fetchImpl mock):
  - `images[].image_url` 为 data URL -> 生成 `image[]` 文件 part(多图各一个)。
  - `images[].image_url` 为 http -> 触发下载 -> 文件 part。
  - `mask.image_url` -> `mask` 文件 part。
  - 标量字段映射为文本 part; `response_format` 被丢弃。
  - 缺图 -> 抛错(400 由 forwarder 包装)。
  - 生成的 Content-Type 以 `multipart/form-data; boundary=` 开头。
- 既有 `image-url-inliner` 测试保持全绿(重构后)。

## 9. 范围与非目标(YAGNI)

- 仅 `/v1/images/edits`; generations 不做。
- 文件字段固定 `image[]`。
- 不做缓存/去重; 不做完整 DNS-rebinding 防护。
- 不改 azure-openai / downloadImageUrlToBase64 既有行为。

## 10. 已确认默认值

- 端点: 仅 edits。
- 文件字段名: `image[]`。
- 独立新开关 `convertImageJsonToMultipart`; 与 base64 开关并列, 两者都开时 multipart 优先。
- 下载超时 10s、上限 20MB、失败即 400。
