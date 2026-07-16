# images/edits JSON -> multipart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a provider toggle `convertImageJsonToMultipart` that converts an incoming `application/json` `/v1/images/edits` request into `multipart/form-data` (file field `image[]`) before forwarding, for vendors that only accept multipart.

**Architecture:** Extract the SSRF-guarded downloader into a shared `image-fetch.ts`. A new `image-json-to-multipart.ts` builds an `OpenAIImageRequestMetadata` (multipart) from the JSON body and reuses the existing `serializeOpenAIImageMultipartRequest`. The forwarder, in the JSON edits branch, overrides body + content-type when the toggle is on. Config is a boolean provider column (no providerType enum change).

**Tech Stack:** Next.js 16 + Hono, Drizzle ORM (PostgreSQL), Vitest, Biome, tsgo, next-intl (5 locales), Bun, Node runtime (global `File`/`Buffer`).

## Global Constraints

- No emoji. i18n via next-intl, 5 locales. New code >= 80% coverage.
- Never hand-write migrations (`bun run db:generate`); never hand-edit `openapi-types.gen.ts` (`bun run openapi:generate`).
- Biome: double quotes, trailing commas, 2-space indent, 100 width. `@/` -> `./src/`.
- Local tests: `DSN= REDIS_URL= bunx vitest run <file>`. Do NOT run repo-wide `bun run lint:fix` (Windows CRLF churn); scope biome to changed files. Filter typecheck: `grep -vE "\.next[\\/]"`.
- Provider SELECT lists in `src/repository/provider.ts` exist at BOTH 6-space and 8-space indentation; a boolean/field addition must reach ALL of them or it won't load (past bug).
- Download defaults: 10000ms timeout, 20971520 bytes (20MB). Failure -> `ProxyError(400)`.
- Branch `feat/image-json-to-multipart`. PR target `dev`.

---

### Task 1: Extract shared `image-fetch.ts` and refactor the inliner

**Files:**
- Create: `src/app/v1/_lib/proxy/image-fetch.ts`
- Test: `src/app/v1/_lib/proxy/image-fetch.test.ts`
- Modify: `src/app/v1/_lib/proxy/image-url-inliner.ts` (use the shared module; keep public API + tests unchanged)

**Interfaces:**
- Produces:
  - `class ImageFetchError extends Error`
  - `type FetchLike`, `interface FetchLikeResponse`, `interface ImageFetchOptions { fetchImpl?: FetchLike; timeoutMs?: number; maxBytes?: number }`
  - `isRemoteHttpUrl(v: unknown): v is string`
  - `assertUrlNotSsrf(raw: string): void`
  - `decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string }`
  - `fetchImageBytes(url: string, opts?: ImageFetchOptions): Promise<{ bytes: Uint8Array; mime: string }>`
  - `fetchImageAsDataUrl(url: string, opts?: ImageFetchOptions): Promise<string>`

- [ ] **Step 1: Write `image-fetch.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  decodeDataUrl,
  fetchImageBytes,
  ImageFetchError,
  isRemoteHttpUrl,
} from "./image-fetch";

const okPng = () => ({
  ok: true,
  status: 200,
  headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
  arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
});

describe("image-fetch", () => {
  it("isRemoteHttpUrl", () => {
    expect(isRemoteHttpUrl("https://x/a.png")).toBe(true);
    expect(isRemoteHttpUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isRemoteHttpUrl(123)).toBe(false);
  });

  it("decodeDataUrl parses mime and bytes", () => {
    const { bytes, mime } = decodeDataUrl("data:image/png;base64,iVBORw==");
    expect(mime).toBe("image/png");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("decodeDataUrl throws on non-data url", () => {
    expect(() => decodeDataUrl("https://x/a.png")).toThrow(ImageFetchError);
  });

  it("fetchImageBytes returns bytes + mime", async () => {
    const { bytes, mime } = await fetchImageBytes("https://x/a.png", { fetchImpl: okPng });
    expect(mime).toBe("image/png");
    expect(Array.from(bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });

  it("fetchImageBytes rejects non-image", async () => {
    const html = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    await expect(fetchImageBytes("https://x/a.png", { fetchImpl: html })).rejects.toBeInstanceOf(
      ImageFetchError
    );
  });

  it("fetchImageBytes enforces maxBytes", async () => {
    const big = async () => ({
      ok: true,
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
      arrayBuffer: async () => new Uint8Array(50).buffer,
    });
    await expect(
      fetchImageBytes("https://x/a.png", { fetchImpl: big, maxBytes: 10 })
    ).rejects.toBeInstanceOf(ImageFetchError);
  });

  it("fetchImageBytes blocks SSRF hosts", async () => {
    for (const u of ["http://127.0.0.1/a.png", "http://169.254.169.254/a.png", "http://localhost/a.png"]) {
      await expect(fetchImageBytes(u, { fetchImpl: okPng })).rejects.toBeInstanceOf(ImageFetchError);
    }
  });
});
```

- [ ] **Step 2: Run -> FAIL**

Run: `DSN= REDIS_URL= bunx vitest run src/app/v1/_lib/proxy/image-fetch.test.ts` -> module missing.

- [ ] **Step 3: Write `image-fetch.ts`**

```ts
import { isPrivateIp } from "@/lib/ip/private-ip";

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<FetchLikeResponse>;

export interface ImageFetchOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "0.0.0.0", "169.254.169.254"]);

export class ImageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageFetchError";
  }
}

export function isRemoteHttpUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"));
}

export function assertUrlNotSsrf(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageFetchError(`Invalid image url: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImageFetchError(`Unsupported image url protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new ImageFetchError(`Blocked image url host: ${url.hostname}`);
  }
  if (isPrivateIp(host)) {
    throw new ImageFetchError(`Blocked private image url host: ${url.hostname}`);
  }
}

export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new ImageFetchError("Invalid data URL");
  }
  const mime = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const data = match[3];
  const bytes = isBase64
    ? new Uint8Array(Buffer.from(data, "base64"))
    : new Uint8Array(Buffer.from(decodeURIComponent(data), "utf-8"));
  return { bytes, mime };
}

export async function fetchImageBytes(
  url: string,
  opts: ImageFetchOptions = {}
): Promise<{ bytes: Uint8Array; mime: string }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  assertUrlNotSsrf(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: FetchLikeResponse;
  try {
    res = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    throw new ImageFetchError(
      `Failed to download ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ImageFetchError(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) {
    throw new ImageFetchError(`${url} did not return an image (content-type: ${mime || "unknown"})`);
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new ImageFetchError(`${url} exceeds max size ${maxBytes} bytes (got ${buffer.byteLength})`);
  }
  return { bytes: new Uint8Array(buffer), mime };
}

export async function fetchImageAsDataUrl(url: string, opts: ImageFetchOptions = {}): Promise<string> {
  const { bytes, mime } = await fetchImageBytes(url, opts);
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
```

- [ ] **Step 4: Refactor `image-url-inliner.ts` to use it.** Replace the file's SSRF/fetch internals with imports from `./image-fetch`, keeping the public API. New content:

```ts
import {
  fetchImageAsDataUrl,
  ImageFetchError,
  isRemoteHttpUrl,
  type ImageFetchOptions,
} from "./image-fetch";

export { ImageFetchError as ImageInlineError } from "./image-fetch";
export type InlineOptions = ImageFetchOptions;

async function maybeInline(value: unknown, opts: InlineOptions): Promise<unknown> {
  if (isRemoteHttpUrl(value)) {
    return fetchImageAsDataUrl(value, opts);
  }
  return value;
}

export async function inlineImageUrlsInImageBody(
  body: Record<string, unknown>,
  opts: InlineOptions = {}
): Promise<void> {
  if (Array.isArray(body.image)) {
    body.image = await Promise.all(body.image.map((item) => maybeInline(item, opts)));
  } else if (body.image !== undefined) {
    body.image = await maybeInline(body.image, opts);
  }
  if (body.image_url !== undefined) {
    body.image_url = await maybeInline(body.image_url, opts);
  }
  if (Array.isArray(body.images)) {
    for (const item of body.images) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        if (obj.image_url !== undefined) {
          obj.image_url = await maybeInline(obj.image_url, opts);
        }
      }
    }
  }
  if (body.mask && typeof body.mask === "object" && !Array.isArray(body.mask)) {
    const mask = body.mask as Record<string, unknown>;
    if (mask.image_url !== undefined) {
      mask.image_url = await maybeInline(mask.image_url, opts);
    }
  }
}

export { fetchImageAsDataUrl } from "./image-fetch";
```

Note: `image-url-inliner.test.ts` imports `ImageInlineError`, `inlineImageUrlsInImageBody` — both still exported. Its `fetchImpl`-injection tests still pass because `fetchImageAsDataUrl` forwards opts.

- [ ] **Step 5: Run both suites -> PASS**

Run: `DSN= REDIS_URL= bunx vitest run src/app/v1/_lib/proxy/image-fetch.test.ts src/app/v1/_lib/proxy/image-url-inliner.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/v1/_lib/proxy/image-fetch.ts src/app/v1/_lib/proxy/image-fetch.test.ts src/app/v1/_lib/proxy/image-url-inliner.ts
git commit -m "refactor(proxy): extract shared image-fetch (download/ssrf/data-url)"
```

---

### Task 2: `image-json-to-multipart.ts`

**Files:**
- Create: `src/app/v1/_lib/proxy/image-json-to-multipart.ts`
- Test: `src/app/v1/_lib/proxy/image-json-to-multipart.test.ts`

**Interfaces:**
- Consumes: `fetchImageBytes`, `decodeDataUrl`, `isRemoteHttpUrl`, `ImageFetchError` from `./image-fetch`; `serializeOpenAIImageMultipartRequest`, `OpenAIImageRequestMetadata` from `./openai-image-compat`.
- Produces: `buildImageEditsMultipart(body: Record<string, unknown>, opts?: ImageFetchOptions): Promise<{ body: ArrayBuffer; contentType: string }>`

Scalar fields copied as text parts: `model, prompt, size, quality, output_format, output_compression, background, input_fidelity, n, user`. Image sources: `images[].image_url`, `image` (string|string[]) -> repeated `image[]` file parts; `mask.image_url` -> `mask` file part.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { ImageFetchError } from "./image-fetch";
import { buildImageEditsMultipart } from "./image-json-to-multipart";

const okJpeg = async () => ({
  ok: true,
  status: 200,
  headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/jpeg" : null) },
  arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer,
});

async function parseParts(body: ArrayBuffer, contentType: string) {
  const req = new Request("https://x/u", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
  const form = await req.formData();
  return form;
}

describe("buildImageEditsMultipart", () => {
  it("maps scalars to text and data-url images to image[] files", async () => {
    const { body, contentType } = await buildImageEditsMultipart({
      model: "gpt-image-2",
      prompt: "hi",
      size: "1024x1024",
      response_format: "b64_json",
      images: [{ image_url: "data:image/png;base64,iVBORw==" }],
    });
    expect(contentType.startsWith("multipart/form-data; boundary=")).toBe(true);
    const form = await parseParts(body, contentType);
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("prompt")).toBe("hi");
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("response_format")).toBeNull(); // dropped
    const files = form.getAll("image[]");
    expect(files.length).toBe(1);
    expect(files[0] instanceof File).toBe(true);
  });

  it("downloads http image_url and supports multiple images + mask", async () => {
    const { body, contentType } = await buildImageEditsMultipart(
      {
        model: "gpt-image-2",
        prompt: "hi",
        images: [{ image_url: "https://x/a.png" }, { image_url: "https://x/b.png" }],
        mask: { image_url: "https://x/m.png" },
      },
      { fetchImpl: okJpeg }
    );
    const form = await parseParts(body, contentType);
    expect(form.getAll("image[]").length).toBe(2);
    expect(form.get("mask") instanceof File).toBe(true);
  });

  it("throws when no image provided", async () => {
    await expect(buildImageEditsMultipart({ model: "gpt-image-2", prompt: "x" })).rejects.toBeInstanceOf(
      ImageFetchError
    );
  });
});
```

- [ ] **Step 2: Run -> FAIL**

Run: `DSN= REDIS_URL= bunx vitest run src/app/v1/_lib/proxy/image-json-to-multipart.test.ts`

- [ ] **Step 3: Write the implementation**

```ts
import {
  decodeDataUrl,
  fetchImageBytes,
  ImageFetchError,
  type ImageFetchOptions,
  isRemoteHttpUrl,
} from "./image-fetch";
import {
  type OpenAIImageMultipartPart,
  type OpenAIImageRequestMetadata,
  serializeOpenAIImageMultipartRequest,
} from "./openai-image-compat";

const SCALAR_FIELDS = [
  "model",
  "prompt",
  "size",
  "quality",
  "output_format",
  "output_compression",
  "background",
  "input_fidelity",
  "n",
  "user",
] as const;

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function resolveImageBytes(
  value: unknown,
  opts: ImageFetchOptions
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.startsWith("data:")) return decodeDataUrl(value);
  if (isRemoteHttpUrl(value)) return fetchImageBytes(value, opts);
  return null;
}

function toFilePart(
  name: string,
  index: number,
  bytes: Uint8Array,
  mime: string
): OpenAIImageMultipartPart {
  const ext = MIME_EXT[mime] ?? "png";
  const file = new File([bytes], `image_${index}.${ext}`, { type: mime });
  return { name, kind: "file", value: file };
}

export async function buildImageEditsMultipart(
  body: Record<string, unknown>,
  opts: ImageFetchOptions = {}
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const parts: OpenAIImageMultipartPart[] = [];

  for (const field of SCALAR_FIELDS) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    parts.push({ name: field, kind: "text", value: String(v) });
  }

  const imageSources: unknown[] = [];
  if (Array.isArray(body.images)) {
    for (const item of body.images) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        imageSources.push((item as Record<string, unknown>).image_url);
      }
    }
  }
  if (Array.isArray(body.image)) {
    imageSources.push(...body.image);
  } else if (typeof body.image === "string") {
    imageSources.push(body.image);
  }

  let index = 0;
  for (const src of imageSources) {
    const resolved = await resolveImageBytes(src, opts);
    if (!resolved) continue;
    parts.push(toFilePart("image[]", index, resolved.bytes, resolved.mime));
    index += 1;
  }

  if (index === 0) {
    throw new ImageFetchError("images/edits multipart conversion requires at least one image_url.");
  }

  if (body.mask && typeof body.mask === "object" && !Array.isArray(body.mask)) {
    const maskUrl = (body.mask as Record<string, unknown>).image_url;
    const resolvedMask = await resolveImageBytes(maskUrl, opts);
    if (resolvedMask) {
      parts.push(toFilePart("mask", 0, resolvedMask.bytes, resolvedMask.mime));
    }
  }

  const metadata: OpenAIImageRequestMetadata = {
    endpoint: "edits",
    bodyKind: "multipart",
    contentType: null,
    model: typeof body.model === "string" ? body.model : null,
    parts,
  };

  const serialized = await serializeOpenAIImageMultipartRequest(metadata);
  if (!serialized.contentType) {
    throw new ImageFetchError("Failed to build multipart content-type.");
  }
  return { body: serialized.body, contentType: serialized.contentType };
}
```

- [ ] **Step 4: Run -> PASS**

Run: `DSN= REDIS_URL= bunx vitest run src/app/v1/_lib/proxy/image-json-to-multipart.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/v1/_lib/proxy/image-json-to-multipart.ts src/app/v1/_lib/proxy/image-json-to-multipart.test.ts
git commit -m "feat(proxy): add images/edits JSON -> multipart builder"
```

---

### Task 3: Provider config `convertImageJsonToMultipart` (full plumbing + migration)

**Files:** `src/types/provider.ts`, `src/drizzle/schema.ts`, `src/repository/_shared/transformers.ts`, `src/repository/provider.ts`, `src/actions/providers.ts`, `src/lib/validation/schemas.ts`, `src/lib/api/v1/schemas/providers.ts`, `src/app/api/v1/resources/providers/handlers.ts`

- [ ] **Step 1: Type.** In `src/types/provider.ts`, after each `downloadImageUrlToBase64?: boolean;` (runtime `Provider` AND `ProviderDisplay`) add:
```ts
  convertImageJsonToMultipart?: boolean;
```
After each `download_image_url_to_base64?: boolean;` (CreateProviderData + UpdateProviderData) add:
```ts
  convert_image_json_to_multipart?: boolean;
```

- [ ] **Step 2: Schema.** In `src/drizzle/schema.ts`, after the `downloadImageUrlToBase64` column:
```ts
  convertImageJsonToMultipart: boolean('convert_image_json_to_multipart').notNull().default(false),
```

- [ ] **Step 3: Transformer.** In `src/repository/_shared/transformers.ts`, after the `downloadImageUrlToBase64` mapping:
```ts
    convertImageJsonToMultipart: dbProvider?.convertImageJsonToMultipart ?? false,
```

- [ ] **Step 4: Repository (ALL 5 SELECTs + insert + update).**
  - The 5 SELECT lists: each currently has a line `downloadImageUrlToBase64: providers.downloadImageUrlToBase64,` (at both 6-space and 8-space indent). For EACH, add on the next line, matching that line's indentation:
    ```ts
    convertImageJsonToMultipart: providers.convertImageJsonToMultipart,
    ```
    Do this via two `Edit` calls with `replace_all: true` — one for the 8-space variant, one for the 6-space variant — to avoid the substring-overlap bug (the 6-space string is a substring of the 8-space line, so run the 8-space replacement FIRST and verify counts, or match with the trailing newline + next unique field). After editing, `grep -c "convertImageJsonToMultipart: providers.convertImageJsonToMultipart" src/repository/provider.ts` MUST equal 5.
  - insert map (after `downloadImageUrlToBase64: providerData.download_image_url_to_base64 ?? false,`):
    ```ts
    convertImageJsonToMultipart: providerData.convert_image_json_to_multipart ?? false,
    ```
  - update map (after the `if (providerData.download_image_url_to_base64 !== undefined) ...` block):
    ```ts
    if (providerData.convert_image_json_to_multipart !== undefined)
      dbData.convertImageJsonToMultipart = providerData.convert_image_json_to_multipart;
    ```

- [ ] **Step 5: getProviders display map.** In `src/actions/providers.ts`, after `downloadImageUrlToBase64: provider.downloadImageUrlToBase64,`:
```ts
        convertImageJsonToMultipart: provider.convertImageJsonToMultipart,
```

- [ ] **Step 6: Legacy validation schemas.** In `src/lib/validation/schemas.ts`, after each `download_image_url_to_base64: z.boolean().optional(),` (create + update):
```ts
    convert_image_json_to_multipart: z.boolean().optional(),
```

- [ ] **Step 7: v1 schemas.** In `src/lib/api/v1/schemas/providers.ts`:
  - Response (ProviderSummarySchema) after the `downloadImageUrlToBase64: z.boolean()...` entry:
    ```ts
    convertImageJsonToMultipart: z
      .boolean()
      .describe("Whether the proxy converts JSON image/edits to multipart."),
    ```
  - Request (ProviderCreateSchema) after the `download_image_url_to_base64: z.boolean().optional()...` entry:
    ```ts
    convert_image_json_to_multipart: z
      .boolean()
      .optional()
      .describe("Whether the proxy converts JSON image/edits to multipart."),
    ```

- [ ] **Step 8: v1 handler serializer.** In `src/app/api/v1/resources/providers/handlers.ts`, after `downloadImageUrlToBase64: provider.downloadImageUrlToBase64 ?? false,`:
```ts
    convertImageJsonToMultipart: provider.convertImageJsonToMultipart ?? false,
```

- [ ] **Step 9: Generate + apply migration**

Run: `bun run db:generate` (review: single ADD COLUMN `convert_image_json_to_multipart`), then `bun run db:migrate`.
Verify: `docker compose -f docker-compose.dev.yaml exec -T postgres psql -U postgres -d claude_code_hub -c "\d providers" | grep convert_image_json`.

- [ ] **Step 10: Typecheck + repo select count**

Run: `grep -c "convertImageJsonToMultipart: providers.convertImageJsonToMultipart" src/repository/provider.ts` (== 5); `bun run typecheck 2>&1 | grep -vE "\.next[\\/]" | grep -iE "error TS"` (empty).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(provider): add convertImageJsonToMultipart config column and full plumbing"
```

---

### Task 4: Forwarder integration

**Files:** `src/app/v1/_lib/proxy/forwarder.ts`; Test: `tests/unit/proxy/image-json-multipart-forwarder.test.ts`

- [ ] **Step 1: Import** near the other proxy imports:
```ts
import { buildImageEditsMultipart } from "./image-json-to-multipart";
```

- [ ] **Step 2: Branch in the JSON image path.** In the JSON (non-multipart) branch, the code builds `messageToSend`, then (after the base64 inliner block and validate) does `const bodyString = JSON.stringify(messageToSend); requestBody = bodyString; ...`. Wrap the serialization so multipart wins:

Replace the base64-inline block's sibling serialization region so that, immediately after `validateOpenAIImageRequest(...)` succeeds, we branch:
```ts
          if (
            provider.convertImageJsonToMultipart &&
            requestPath === "/v1/images/edits"
          ) {
            try {
              const multipart = await buildImageEditsMultipart(messageToSend);
              requestBody = multipart.body;
              processedHeaders.set("content-type", multipart.contentType);
              session.forwardedRequestBody = "[multipart/form-data converted from JSON]";
              isStreaming = false;
            } catch (error) {
              throw new ProxyError(
                error instanceof Error ? error.message : "Failed to convert image request to multipart.",
                400
              );
            }
          } else {
            const bodyString = JSON.stringify(messageToSend);
            requestBody = bodyString;
            session.forwardedRequestBody = bodyString;
            try {
              const parsed = JSON.parse(bodyString);
              isStreaming = parsed.stream === true;
            } catch {
              isStreaming = false;
            }
          }
```
(Adapt to the exact existing lines: replace the current `const bodyString = JSON.stringify(messageToSend);` block with the if/else above. Read the surrounding lines first to match precisely.)

Also gate the existing base64 inliner so multipart takes precedence: change its condition to
`if (!provider.convertImageJsonToMultipart && provider.downloadImageUrlToBase64 && getOpenAIImageEndpoint(requestPath) !== null)`.

- [ ] **Step 3: Test (builder contract used by forwarder)**

```ts
import { describe, expect, it } from "vitest";
import { buildImageEditsMultipart } from "@/app/v1/_lib/proxy/image-json-to-multipart";

describe("forwarder multipart conversion contract", () => {
  it("builds multipart body + content-type from a JSON edits body", async () => {
    const { body, contentType } = await buildImageEditsMultipart(
      { model: "gpt-image-2", prompt: "x", images: [{ image_url: "data:image/png;base64,iVBORw==" }] },
    );
    expect(contentType.startsWith("multipart/form-data; boundary=")).toBe(true);
    expect(body.byteLength).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Typecheck + tests**

Run: `bun run typecheck 2>&1 | grep -vE "\.next[\\/]" | grep -iE "error TS"; DSN= REDIS_URL= bunx vitest run tests/unit/proxy/image-json-multipart-forwarder.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/v1/_lib/proxy/forwarder.ts tests/unit/proxy/image-json-multipart-forwarder.test.ts
git commit -m "feat(proxy): convert JSON images/edits to multipart when toggle enabled"
```

---

### Task 5: UI + i18n

**Files:** provider-form `provider-form-types.ts`, `provider-form-context.tsx`, `index.tsx`, `sections/options-section.tsx`; `messages/{en,zh-CN,zh-TW,ja,ru}/settings/providers/form/sections.json`

- [ ] **Step 1: Mirror the `downloadImageUrlToBase64` toggle exactly** for `convertImageJsonToMultipart`:
  - `provider-form-types.ts`: add `convertImageJsonToMultipart: boolean;` to `RoutingState` (after `downloadImageUrlToBase64`); add action `| { type: "SET_CONVERT_IMAGE_JSON_TO_MULTIPART"; payload: boolean }`.
  - `provider-form-context.tsx`: add `SET_CONVERT_IMAGE_JSON_TO_MULTIPART: "routing.convertImageJsonToMultipart",` to ACTION map; add `convertImageJsonToMultipart: false` to the batch-init and empty-default routing objects; add `convertImageJsonToMultipart: sourceProvider?.convertImageJsonToMultipart ?? false,` to the source-provider init; add the reducer case.
  - `index.tsx`: add `convert_image_json_to_multipart: state.routing.convertImageJsonToMultipart,` to the submit payload (after `download_image_url_to_base64`).
  - `options-section.tsx`: add a `ToggleRow` after the `downloadImageUrlToBase64` one, bound to `SET_CONVERT_IMAGE_JSON_TO_MULTIPART` / `state.routing.convertImageJsonToMultipart`, labels `t("sections.routing.convertImageJsonToMultipart.label"|".desc")`.

- [ ] **Step 2: i18n (5 locales)** in `sections.json`, add before `"disableSessionReuse": {` (unique anchor), no emoji. English: label "Convert JSON image edits to multipart", desc "When on, JSON /v1/images/edits requests are converted to multipart/form-data (image[] files) before forwarding. For vendors that only accept multipart." Provide equivalents in zh-CN/zh-TW/ja/ru.

- [ ] **Step 3: Verify**

Run: `bun run i18n:audit-messages-no-emoji:fail; bun run typecheck 2>&1 | grep -vE "\.next[\\/]" | grep -iE "error TS"; DSN= REDIS_URL= bunx vitest run tests/unit/i18n; bun run build`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): add convertImageJsonToMultipart provider toggle and i18n"
```

---

### Task 6: OpenAPI regen + full verification

- [ ] **Step 1:** `bun run openapi:generate`; confirm `convert_image_json_to_multipart` / `convertImageJsonToMultipart` appear (`git diff --ignore-all-space src/lib/api-client/v1/openapi-types.gen.ts | grep -i convert`).
- [ ] **Step 2:** `bun run typecheck 2>&1 | grep -vE "\.next[\\/]" | grep -iE "error TS"`; `DSN= REDIS_URL= bunx vitest run src/app/v1/_lib/proxy/image-fetch.test.ts src/app/v1/_lib/proxy/image-url-inliner.test.ts src/app/v1/_lib/proxy/image-json-to-multipart.test.ts tests/unit/proxy tests/unit/i18n`; `bun run build`. All must pass. (Full `bun run test` needs a test DB -> CI.)
- [ ] **Step 3:** `git add -A && git commit -m "chore(api): regenerate openapi types for convertImageJsonToMultipart"`

---

## Self-Review Notes

- Spec 3 (rules) -> Task 2. Spec 4 (shared fetch) -> Task 1. Spec 5 (forwarder) -> Task 4. Spec 7 (integration) -> Tasks 3, 5, 6. Spec 8 (tests) -> Tasks 1, 2, 4.
- Read-back path explicitly covered: repository 5 SELECTs (Task 3.4), getProviders map (Task 3.5), v1 response schema + handler (Task 3.7/3.8), ProviderDisplay type (Task 3.1) — the exact chain that broke last feature.
- Type/name consistency: `convertImageJsonToMultipart` (camel) / `convert_image_json_to_multipart` (snake) / `buildImageEditsMultipart` / `image-fetch.ts` exports used identically across tasks.
