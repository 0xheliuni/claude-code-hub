# image_url -> base64 Inline Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-level toggle `downloadImageUrlToBase64` that makes the proxy download any `image_url`/`image` remote URL in JSON image requests and inline it as a `data:<mime>;base64,...` URL before forwarding, so upstreams (Azure) never fetch remote URLs.

**Architecture:** A pure, injectable-fetch module `image-url-inliner.ts` performs SSRF-guarded downloads and body rewriting. The forwarder calls it in the JSON image branch (before validation) only when the provider toggle is on and the endpoint is `/v1/images/generations|edits`. Config is a boolean provider column (no providerType enum changes).

**Tech Stack:** Next.js 16 + Hono, Drizzle ORM (PostgreSQL), Vitest, Biome, tsgo, next-intl (5 locales), Bun, Node runtime (Buffer for base64).

## Global Constraints

- No emoji anywhere. i18n via next-intl, 5 locales: zh-CN, zh-TW, en, ja, ru. New features >= 80% unit coverage.
- Never hand-write SQL migrations (`bun run db:generate`). Never hand-edit `openapi-types.gen.ts` (`bun run openapi:generate`).
- Biome: double quotes, trailing commas, 2-space indent, 100 width. Path alias `@/` -> `./src/`.
- Local test run: prefix pure unit tests with `DSN= REDIS_URL=` to bypass the test-DB guard. Do NOT run `bun run lint:fix` repo-wide on Windows (CRLF churn); scope biome to changed files.
- Defaults: download timeout 10000ms, max size 20971520 bytes (20MB). Download failure -> `ProxyError(400)` (non-retryable).
- Branch: `feat/image-url-inline-base64`. PR target `dev`.

---

### Task 1: image-url-inliner module

**Files:**
- Create: `src/app/v1/_lib/proxy/image-url-inliner.ts`
- Test: `src/app/v1/_lib/proxy/image-url-inliner.test.ts`

**Interfaces:**
- Produces:
  - `type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchLikeResponse>`
  - `interface InlineOptions { fetchImpl?: FetchLike; timeoutMs?: number; maxBytes?: number }`
  - `fetchImageAsDataUrl(url: string, opts?: InlineOptions): Promise<string>`
  - `inlineImageUrlsInImageBody(body: Record<string, unknown>, opts?: InlineOptions): Promise<void>`
  - `class ImageInlineError extends Error` (carries a client-safe message)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  ImageInlineError,
  inlineImageUrlsInImageBody,
} from "./image-url-inliner";

function pngResponse(bytes = new Uint8Array([137, 80, 78, 71])) {
  return {
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
    arrayBuffer: async () => bytes.buffer.slice(0),
  };
}

const okFetch = async () => pngResponse();
const B64 = "iVBORw=="; // base64 of the 4 PNG signature bytes is "iVBORw==" -> assert via prefix instead

describe("inlineImageUrlsInImageBody", () => {
  it("replaces edits images[].image_url http url with data url", async () => {
    const body: Record<string, unknown> = {
      model: "gpt-image-2",
      images: [{ image_url: "https://example.com/a.png" }],
    };
    await inlineImageUrlsInImageBody(body, { fetchImpl: okFetch });
    const url = (body.images as Array<{ image_url: string }>)[0].image_url;
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("replaces mask.image_url", async () => {
    const body: Record<string, unknown> = { mask: { image_url: "https://x/m.png" } };
    await inlineImageUrlsInImageBody(body, { fetchImpl: okFetch });
    expect((body.mask as { image_url: string }).image_url.startsWith("data:image/png;base64,")).toBe(
      true
    );
  });

  it("replaces generations image string and string array, leaving non-http untouched", async () => {
    const body: Record<string, unknown> = {
      image: ["https://x/1.png", "iVBORAlreadyBase64=="],
      image_url: "https://x/2.png",
    };
    await inlineImageUrlsInImageBody(body, { fetchImpl: okFetch });
    const arr = body.image as string[];
    expect(arr[0].startsWith("data:image/png;base64,")).toBe(true);
    expect(arr[1]).toBe("iVBORAlreadyBase64==");
    expect((body.image_url as string).startsWith("data:image/png;base64,")).toBe(true);
  });

  it("leaves existing data: urls untouched (no fetch)", async () => {
    let called = 0;
    const body: Record<string, unknown> = { images: [{ image_url: "data:image/png;base64,AAAA" }] };
    await inlineImageUrlsInImageBody(body, {
      fetchImpl: async () => {
        called += 1;
        return pngResponse();
      },
    });
    expect(called).toBe(0);
    expect((body.images as Array<{ image_url: string }>)[0].image_url).toBe("data:image/png;base64,AAAA");
  });

  it("throws on non-image content-type", async () => {
    const htmlFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    const body: Record<string, unknown> = { images: [{ image_url: "https://x/a.png" }] };
    await expect(inlineImageUrlsInImageBody(body, { fetchImpl: htmlFetch })).rejects.toBeInstanceOf(
      ImageInlineError
    );
  });

  it("throws on oversize download", async () => {
    const bigFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
      arrayBuffer: async () => new Uint8Array(30).buffer,
    });
    const body: Record<string, unknown> = { images: [{ image_url: "https://x/a.png" }] };
    await expect(
      inlineImageUrlsInImageBody(body, { fetchImpl: bigFetch, maxBytes: 10 })
    ).rejects.toBeInstanceOf(ImageInlineError);
  });

  it("throws (SSRF) on private / metadata hosts", async () => {
    for (const u of ["http://127.0.0.1/a.png", "http://169.254.169.254/a.png", "http://localhost/a.png"]) {
      const body: Record<string, unknown> = { image_url: u };
      await expect(
        inlineImageUrlsInImageBody(body, { fetchImpl: okFetch })
      ).rejects.toBeInstanceOf(ImageInlineError);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DSN= REDIS_URL= bunx vitest run src/app/v1/_lib/proxy/image-url-inliner.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the implementation**

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

export interface InlineOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "0.0.0.0", "169.254.169.254"]);

export class ImageInlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageInlineError";
  }
}

function isRemoteHttpUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"));
}

function assertUrlNotSsrf(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageInlineError(`Invalid image_url: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImageInlineError(`Unsupported image_url protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new ImageInlineError(`Blocked image_url host: ${url.hostname}`);
  }
  // Block private IP literals (best-effort; no DNS resolution / rebinding protection).
  if (isPrivateIp(host)) {
    throw new ImageInlineError(`Blocked private image_url host: ${url.hostname}`);
  }
  return url;
}

export async function fetchImageAsDataUrl(url: string, opts: InlineOptions = {}): Promise<string> {
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
    throw new ImageInlineError(
      `Failed to download image_url ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ImageInlineError(`Failed to download image_url ${url}: HTTP ${res.status}`);
  }

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new ImageInlineError(
      `image_url ${url} did not return an image (content-type: ${contentType || "unknown"})`
    );
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new ImageInlineError(
      `image_url ${url} exceeds max size ${maxBytes} bytes (got ${buffer.byteLength})`
    );
  }

  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

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
  // generations: top-level image (string | string[]) and image_url (string)
  if (Array.isArray(body.image)) {
    body.image = await Promise.all(body.image.map((item) => maybeInline(item, opts)));
  } else if (body.image !== undefined) {
    body.image = await maybeInline(body.image, opts);
  }
  if (body.image_url !== undefined) {
    body.image_url = await maybeInline(body.image_url, opts);
  }

  // edits: images[].image_url
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

  // edits: mask.image_url
  if (body.mask && typeof body.mask === "object" && !Array.isArray(body.mask)) {
    const mask = body.mask as Record<string, unknown>;
    if (mask.image_url !== undefined) {
      mask.image_url = await maybeInline(mask.image_url, opts);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DSN= REDIS_URL= bunx vitest run src/app/v1/_lib/proxy/image-url-inliner.test.ts`
Expected: PASS (all cases). Note: base64 of the 4 PNG signature bytes is checked only via the `data:image/png;base64,` prefix, so no exact-encoding assumption.

- [ ] **Step 5: Commit**

```bash
git add src/app/v1/_lib/proxy/image-url-inliner.ts src/app/v1/_lib/proxy/image-url-inliner.test.ts
git commit -m "feat(proxy): add image_url -> base64 inliner with SSRF guard"
```

---

### Task 2: Provider config field + migration

**Files:**
- Modify: `src/types/provider.ts` (add `downloadImageUrlToBase64?: boolean` near `azureImageApiVersions`)
- Modify: `src/drizzle/schema.ts` (providers table, after `azureImageApiVersions`)
- Modify: `src/repository/_shared/transformers.ts` (map new column)
- Modify: `src/lib/validation/schemas.ts` (provider create + update schemas)

**Interfaces:**
- Produces: `Provider.downloadImageUrlToBase64?: boolean`; DB column `download_image_url_to_base64 boolean default false`.

- [ ] **Step 1: Add the type field**

In `src/types/provider.ts`, right after the `azureImageApiVersions?: ...` line in the runtime `Provider` interface:
```ts
  // 开启后, 代理会把图像请求体里的 image_url 远程 URL 下载并内联为 base64(仅 JSON 图像端点)
  downloadImageUrlToBase64?: boolean;
```

- [ ] **Step 2: Add the DB column**

In `src/drizzle/schema.ts`, immediately after the `azureImageApiVersions` column:
```ts
  downloadImageUrlToBase64: boolean('download_image_url_to_base64').notNull().default(false),
```
Ensure `boolean` is imported from `drizzle-orm/pg-core` (it already is; other boolean columns exist).

- [ ] **Step 3: Map in transformer**

In `src/repository/_shared/transformers.ts`, right after the `azureImageApiVersions` mapping:
```ts
    downloadImageUrlToBase64: dbProvider?.downloadImageUrlToBase64 ?? false,
```

- [ ] **Step 4: Add to validation schemas**

In `src/lib/validation/schemas.ts`, in BOTH the provider create and update object schemas (near `custom_headers` / provider fields), add:
```ts
    download_image_url_to_base64: z.boolean().optional(),
```
And ensure the create/update action maps `download_image_url_to_base64` -> `downloadImageUrlToBase64` where provider input is normalized (follow the existing `custom_headers` -> `customHeaders` mapping pattern in `src/repository/provider.ts` / actions).

- [ ] **Step 5: Generate migration**

Run: `bun run db:generate`
Expected: new file under `drizzle/` adding `download_image_url_to_base64`. Review it (single ADD COLUMN).

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck 2>&1 | grep -vE "\.next[\\/]" | grep -iE "error TS"`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add src/types/provider.ts src/drizzle/schema.ts drizzle/ src/repository/_shared/transformers.ts src/repository/provider.ts src/lib/validation/schemas.ts
git commit -m "feat(provider): add downloadImageUrlToBase64 config column"
```

---

### Task 3: Forwarder integration

**Files:**
- Modify: `src/app/v1/_lib/proxy/forwarder.ts` (JSON image branch, before `validateOpenAIImageRequest`)
- Test: `tests/unit/proxy/image-url-inline-forwarder.test.ts`

**Interfaces:**
- Consumes: `inlineImageUrlsInImageBody`, `getOpenAIImageEndpoint`, `provider.downloadImageUrlToBase64`.

- [ ] **Step 1: Add import** near the other `./openai-image-compat` / adapter imports:

```ts
import { inlineImageUrlsInImageBody } from "./image-url-inliner";
```

- [ ] **Step 2: Call the inliner in the JSON image branch.**

In `forwarder.ts`, in the non-multipart JSON path, immediately BEFORE the `const validation = await validateOpenAIImageRequest({ pathname: requestPath, body: messageToSend, ... })` call (the one around the `sanitizeGenerationsRequestForProvider(messageToSend, provider)` region), insert:

```ts
          if (
            provider.downloadImageUrlToBase64 &&
            getOpenAIImageEndpoint(requestPath) !== null
          ) {
            try {
              await inlineImageUrlsInImageBody(messageToSend);
            } catch (error) {
              throw new ProxyError(
                error instanceof Error ? error.message : "Failed to inline image_url.",
                400
              );
            }
          }
```

(Place it after `sanitizeGenerationsRequestForProvider(...)` and before `validateOpenAIImageRequest(...)` so the resulting data URLs are validated.)

- [ ] **Step 3: Write a focused test**

```ts
import { describe, expect, it } from "vitest";
import { inlineImageUrlsInImageBody } from "@/app/v1/_lib/proxy/image-url-inliner";

// Contract: with the toggle on, an https image_url becomes a data URL that
// validateOpenAIImageRequest accepts (isOpenAIImageUrl allows data: URLs).
describe("image inline forwarder contract", () => {
  it("produces a data url that looks valid for the edits schema", async () => {
    const body: Record<string, unknown> = {
      model: "gpt-image-2",
      prompt: "x",
      images: [{ image_url: "https://example.com/a.png" }],
    };
    await inlineImageUrlsInImageBody(body, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
      }),
    });
    const url = (body.images as Array<{ image_url: string }>)[0].image_url;
    expect(url.startsWith("data:")).toBe(true);
  });
});
```

- [ ] **Step 4: Typecheck + run test**

Run: `bun run typecheck 2>&1 | grep -vE "\.next[\\/]" | grep -iE "error TS"; DSN= REDIS_URL= bunx vitest run tests/unit/proxy/image-url-inline-forwarder.test.ts`
Expected: clean typecheck, test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/v1/_lib/proxy/forwarder.ts tests/unit/proxy/image-url-inline-forwarder.test.ts
git commit -m "feat(proxy): inline image_url to base64 in forwarder when toggle enabled"
```

---

### Task 4: UI + i18n

**Files:**
- Modify: provider form (add a checkbox bound to `downloadImageUrlToBase64` in the provider-form state/section; follow the existing boolean toggle pattern such as `preserveClientIp`/`disableSessionReuse`).
- Modify i18n label + description in 5 locales under the provider form section (same file group as other provider-form section labels).

- [ ] **Step 1: Locate the boolean-toggle pattern.**

Run: `grep -rn "preserveClientIp\|disableSessionReuse" src/app/[locale]/settings/providers/_components/forms/provider-form 2>/dev/null | head`
Use the same reducer action + `ToggleRow` component to add a `downloadImageUrlToBase64` toggle in the appropriate section (routing or an advanced section).

- [ ] **Step 2: Add the toggle UI** mirroring the located boolean toggle (state field, dispatch action, `ToggleRow` with `t("...downloadImageUrlToBase64.label")` and description). Ensure the provider-form state, its initializer from `provider`, and the submit payload all include `downloadImageUrlToBase64` (map to `download_image_url_to_base64` in the API payload following the existing snake_case mapping).

- [ ] **Step 3: Add i18n keys** in all 5 locales (`messages/{en,zh-CN,zh-TW,ja,ru}/settings/providers/form/sections.json` under the section that holds the other toggles), no emoji. English: label "Download image_url to base64", description "When on, the proxy downloads remote image_url values and sends them inline as base64 (JSON image requests only)."; provide equivalent translations for the other 4 locales.

- [ ] **Step 4: Verify**

Run: `bun run i18n:audit-messages-no-emoji:fail; DSN= REDIS_URL= bunx vitest run tests/unit/i18n; bun run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add downloadImageUrlToBase64 provider toggle and i18n"
```

---

### Task 5: OpenAPI regen + full verification

- [ ] **Step 1: Regenerate types**

Run: `bun run openapi:generate`
Expected: `download_image_url_to_base64` appears in generated provider schemas.

- [ ] **Step 2: Quality gate (DB-independent parts)**

Run: `bun run typecheck 2>&1 | grep -vE "\.next[\\/]" | grep -iE "error TS"; DSN= REDIS_URL= bunx vitest run src/app/v1/_lib/proxy/image-url-inliner.test.ts tests/unit/proxy/image-url-inline-forwarder.test.ts tests/unit/i18n; bun run build`
Expected: clean typecheck, tests PASS, build PASS. (Full `bun run test` requires a test DB; run in CI.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(api): regenerate openapi types for downloadImageUrlToBase64"
```

---

## Self-Review Notes

- Spec 2 (toggle) -> Task 2. Spec 3 (fields) -> Task 1 `inlineImageUrlsInImageBody`. Spec 4 (safety/limits) -> Task 1 `fetchImageAsDataUrl` + `assertUrlNotSsrf`. Spec 5 (module) -> Task 1. Spec 6 (data flow) -> Task 3. Spec 7 (error 400) -> Task 3 try/catch. Spec 8 (tests) -> Tasks 1, 3. Spec 9 (integration) -> Tasks 2, 3, 4, 5.
- Type consistency: `inlineImageUrlsInImageBody(body, opts?)`, `fetchImageAsDataUrl(url, opts?)`, `ImageInlineError`, `downloadImageUrlToBase64` used identically across tasks.
