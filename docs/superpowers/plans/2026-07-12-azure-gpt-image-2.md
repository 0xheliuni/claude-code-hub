# Azure OpenAI gpt-image-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `azure-openai` provider type that forwards OpenAI-style `/v1/images/generations` (JSON) and `/v1/images/edits` (multipart) to Azure OpenAI gpt-image-2, handling Azure path rewrite, per-endpoint api-version, and api-key auth.

**Architecture:** `azure-openai` is registered as a top-level provider type that behaves like `openai-compatible` everywhere except the forwarder. A pure-function adapter module (`azure-image-adapter.ts`) builds the Azure URL/api-version and headers; the forwarder standard-handling branch overrides `proxyUrl` and headers when the provider is `azure-openai` and the request hits an image endpoint. Body-param reconciliation reuses the existing `sanitizeGenerationsRequestForProvider` (generalized) plus request filters.

**Tech Stack:** Next.js 16 + Hono, Drizzle ORM (PostgreSQL), Vitest, Biome, tsgo, next-intl (5 locales), Bun.

## Global Constraints

- No emoji in any code, comment, or string literal.
- All user-facing strings via next-intl; 5 locales: zh-CN, zh-TW, en, ja, ru.
- New features need >= 80% unit test coverage.
- Never hand-write SQL migrations; run `bun run db:generate`.
- Never hand-edit `src/lib/api-client/v1/openapi-types.gen.ts`; regenerate via `bun run openapi:generate`.
- Pre-commit: `bun run build`, `bun run lint`, `bun run lint:fix`, `bun run typecheck`, `bun run test`.
- Biome: double quotes, trailing commas, 2-space indent, 100 char width. Path alias `@/` -> `./src/`.
- PR target branch: `dev`. Work on branch `feat/azure-gpt-image-2`.
- `provider_type` column is `varchar(20)`; `"azure-openai"` (12 chars) fits.

---

### Task 1: Azure image adapter (pure functions)

**Files:**
- Create: `src/app/v1/_lib/proxy/azure-image-adapter.ts`
- Test: `src/app/v1/_lib/proxy/azure-image-adapter.test.ts`

**Interfaces:**
- Consumes: `getOpenAIImageEndpoint` from `./openai-image-compat` (returns `"generations" | "edits" | "variations" | null`).
- Produces:
  - `AZURE_IMAGE_DEFAULT_API_VERSIONS: Record<"generations" | "edits", string>`
  - `resolveAzureImageApiVersion(endpoint: "generations" | "edits", overrides: Record<string, string> | null | undefined): string`
  - `resolveAzureDeployment(body: Record<string, unknown>): string | null`
  - `buildAzureImageProxyUrl(resourceBaseUrl: string, deployment: string, endpoint: "generations" | "edits", apiVersion: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  AZURE_IMAGE_DEFAULT_API_VERSIONS,
  buildAzureImageProxyUrl,
  resolveAzureDeployment,
  resolveAzureImageApiVersion,
} from "./azure-image-adapter";

describe("azure-image-adapter", () => {
  it("uses built-in default api-versions per endpoint", () => {
    expect(resolveAzureImageApiVersion("generations", null)).toBe(
      AZURE_IMAGE_DEFAULT_API_VERSIONS.generations
    );
    expect(resolveAzureImageApiVersion("edits", null)).toBe(
      AZURE_IMAGE_DEFAULT_API_VERSIONS.edits
    );
  });

  it("prefers provider overrides over defaults", () => {
    const overrides = { generations: "2099-01-01", edits: "2099-02-02" };
    expect(resolveAzureImageApiVersion("generations", overrides)).toBe("2099-01-01");
    expect(resolveAzureImageApiVersion("edits", overrides)).toBe("2099-02-02");
  });

  it("falls back to default when override missing or blank", () => {
    expect(resolveAzureImageApiVersion("generations", { edits: "x" })).toBe(
      AZURE_IMAGE_DEFAULT_API_VERSIONS.generations
    );
    expect(resolveAzureImageApiVersion("edits", { edits: "  " })).toBe(
      AZURE_IMAGE_DEFAULT_API_VERSIONS.edits
    );
  });

  it("resolves deployment from body.model", () => {
    expect(resolveAzureDeployment({ model: "gpt-image-2" })).toBe("gpt-image-2");
    expect(resolveAzureDeployment({})).toBeNull();
    expect(resolveAzureDeployment({ model: "  " })).toBeNull();
  });

  it("builds azure url with deployment path and api-version, dropping /v1", () => {
    const url = buildAzureImageProxyUrl(
      "https://res-001.openai.azure.com",
      "gpt-image-2",
      "generations",
      "2024-02-01"
    );
    expect(url).toBe(
      "https://res-001.openai.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01"
    );
  });

  it("tolerates trailing slash in resource base url", () => {
    const url = buildAzureImageProxyUrl(
      "https://res-001.openai.azure.com/",
      "gpt-image-2",
      "edits",
      "2025-04-01-preview"
    );
    expect(url).toBe(
      "https://res-001.openai.azure.com/openai/deployments/gpt-image-2/images/edits?api-version=2025-04-01-preview"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/app/v1/_lib/proxy/azure-image-adapter.test.ts`
Expected: FAIL (module not found / exports undefined).

- [ ] **Step 3: Write minimal implementation**

```ts
export type AzureImageEndpoint = "generations" | "edits";

export const AZURE_IMAGE_DEFAULT_API_VERSIONS: Record<AzureImageEndpoint, string> = {
  generations: "2024-02-01",
  edits: "2025-04-01-preview",
};

export function resolveAzureImageApiVersion(
  endpoint: AzureImageEndpoint,
  overrides: Record<string, string> | null | undefined
): string {
  const override = overrides?.[endpoint];
  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }
  return AZURE_IMAGE_DEFAULT_API_VERSIONS[endpoint];
}

export function resolveAzureDeployment(body: Record<string, unknown>): string | null {
  const model = body.model;
  if (typeof model !== "string" || model.trim().length === 0) {
    return null;
  }
  return model.trim();
}

export function buildAzureImageProxyUrl(
  resourceBaseUrl: string,
  deployment: string,
  endpoint: AzureImageEndpoint,
  apiVersion: string
): string {
  const base = resourceBaseUrl.replace(/\/+$/, "");
  const path = `/openai/deployments/${encodeURIComponent(deployment)}/images/${endpoint}`;
  const search = `?api-version=${encodeURIComponent(apiVersion)}`;
  return `${base}${path}${search}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/app/v1/_lib/proxy/azure-image-adapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/v1/_lib/proxy/azure-image-adapter.ts src/app/v1/_lib/proxy/azure-image-adapter.test.ts
git commit -m "feat(proxy): add azure image adapter pure functions"
```

---

### Task 2: `buildAzureImageHeaders` (api-key auth, drop Authorization)

**Files:**
- Modify: `src/app/v1/_lib/proxy/azure-image-adapter.ts`
- Test: `src/app/v1/_lib/proxy/azure-image-adapter.test.ts`

**Interfaces:**
- Consumes: `applyProviderCustomHeaders` semantics (custom headers merged, protected auth names stripped). Since `applyProviderCustomHeaders` is module-private in `forwarder.ts`, this adapter takes an already-built `Headers` and mutates auth only.
- Produces: `applyAzureImageAuth(headers: Headers, apiKey: string): void` — sets `api-key`, deletes `authorization` and `x-api-key`.

- [ ] **Step 1: Write the failing test**

```ts
import { applyAzureImageAuth } from "./azure-image-adapter";

describe("applyAzureImageAuth", () => {
  it("sets api-key and removes bearer/x-api-key", () => {
    const h = new Headers({ authorization: "Bearer sk-x", "x-api-key": "y", host: "z" });
    applyAzureImageAuth(h, "AZURE_KEY");
    expect(h.get("api-key")).toBe("AZURE_KEY");
    expect(h.get("authorization")).toBeNull();
    expect(h.get("x-api-key")).toBeNull();
    expect(h.get("host")).toBe("z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/app/v1/_lib/proxy/azure-image-adapter.test.ts -t "applyAzureImageAuth"`
Expected: FAIL (`applyAzureImageAuth` not exported).

- [ ] **Step 3: Write minimal implementation** (append to adapter)

```ts
export function applyAzureImageAuth(headers: Headers, apiKey: string): void {
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.set("api-key", apiKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/app/v1/_lib/proxy/azure-image-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/v1/_lib/proxy/azure-image-adapter.ts src/app/v1/_lib/proxy/azure-image-adapter.test.ts
git commit -m "feat(proxy): add azure image api-key auth helper"
```

---

### Task 3: Register `azure-openai` in type + provider config field

**Files:**
- Modify: `src/types/provider.ts:5-11` (enum), and the 3 provider interfaces (`Provider`, DB row mapping struct, API struct) to add `azureImageApiVersions`.
- Modify: `src/drizzle/schema.ts` providers table (~line 291, next to `customHeaders`).
- Test: `bun run typecheck` (type-level), plus repository transformer default.

**Interfaces:**
- Produces: `ProviderType` now includes `"azure-openai"`; `Provider.azureImageApiVersions: Record<string, string> | null`.

- [ ] **Step 1: Extend the enum**

In `src/types/provider.ts`:
```ts
export type ProviderType =
  | "claude"
  | "claude-auth"
  | "codex"
  | "gemini"
  | "gemini-cli"
  | "openai-compatible"
  | "azure-openai";
```

- [ ] **Step 2: Add config field to Provider interfaces**

In `src/types/provider.ts`, in the runtime `Provider` interface (near `customHeaders: ProviderCustomHeaders | null;` at line ~391) add:
```ts
  azureImageApiVersions: Record<string, string> | null;
```
Add the same field to the DB-facing interface (near line ~495 `customHeaders`) and, in the snake_case API input struct (near lines ~613/698 `custom_headers`), add:
```ts
  azure_image_api_versions?: Record<string, string> | null;
```

- [ ] **Step 3: Add DB column**

In `src/drizzle/schema.ts`, in `providers` table right after the `customHeaders` line (~291):
```ts
  azureImageApiVersions: jsonb('azure_image_api_versions').$type<Record<string, string> | null>().default(null),
```

- [ ] **Step 4: Map the column in the repository transformer**

In `src/repository/_shared/transformers.ts` (near `customHeaders: dbProvider?.customHeaders ?? null,` ~line 135) add:
```ts
    azureImageApiVersions: dbProvider?.azureImageApiVersions ?? null,
```
Also add mapping in `src/repository/provider.ts` where `customHeaders` is read (near lines 237/322/411/500), following the identical pattern for the new column.

- [ ] **Step 5: Generate migration**

Run: `bun run db:generate`
Expected: a new file under `drizzle/` adding `azure_image_api_versions` column. Review it; do not hand-edit unless the generated SQL is wrong.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: FAILS listing exhaustive `Record<ProviderType, ...>` and `switch` sites that don't handle `azure-openai` (fixed in Task 4). This confirms the compiler has found every site.

- [ ] **Step 7: Commit**

```bash
git add src/types/provider.ts src/drizzle/schema.ts drizzle/ src/repository/_shared/transformers.ts src/repository/provider.ts
git commit -m "feat(provider): register azure-openai type and api-version config column"
```

---

### Task 4: Wire `azure-openai` to behave as `openai-compatible` (server-side)

**Files (each: add `azure-openai` alongside `openai-compatible`):**
- `src/app/v1/_lib/models/available-models.ts:296` -> add `"azure-openai": UPSTREAM_CONFIGS.openai,` to the `configMap`; line 325 `return ["codex", "openai-compatible"];` -> `return ["codex", "openai-compatible", "azure-openai"];`; line 536 array -> add `"azure-openai"`.
- `src/app/v1/_lib/proxy/actual-response-model.ts:54` -> add `case "azure-openai":` above `case "openai-compatible":`.
- `src/app/v1/_lib/proxy/openai-chat-usage-options.ts:1` -> `new Set(["openai-compatible", "azure-openai"])`.
- `src/app/v1/_lib/proxy/response-handler.ts:3847` -> `new Set<string>(["codex", "openai-compatible", "azure-openai"])`.
- `src/repository/cache-hit-rate-alert.ts:88` -> add `"azure-openai": 600,`.
- `src/app/v1/_lib/proxy/provider-selector.ts:119` -> `return providerType === "openai-compatible" || providerType === "azure-openai";`; lines 735/742/1238 (targetType inference) -> return `"openai-compatible"` for `azure-openai` too (add `|| providerType === "azure-openai"` to the branch that returns `"openai-compatible"`).
- `src/lib/utils/provider-text-parser.ts` -> leave detection as-is (azure providers are configured explicitly, not text-parsed). No change.
- Provider-testing (`src/lib/provider-testing/presets.ts:184`, `test-service.ts:149`, `utils/test-prompts.ts:16/115/124/133/153/194`, `parsers/index.ts:30`) -> add `azure-openai` entries mirroring `openai-compatible` values so provider tests work.

**Zod enum sites (add `"azure-openai"` to each `.enum([...])`):**
- `src/actions/provider-endpoints.ts:58`
- `src/lib/validation/schemas.ts:489` and `:738`
- `src/lib/api/v1/_shared/constants.ts:12`
- `src/app/api/actions/[...route]/route.ts:636`
- `src/app/api/availability/endpoints/route.ts:12`
- `src/app/api/leaderboard/route.ts:26`
- `src/lib/public-status/config.ts:11`

- [ ] **Step 1: Apply all edits above.** Each is a literal addition of `"azure-openai"` to a Set/Record/switch/enum; no logic change.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (all exhaustive sites now handle `azure-openai`).

- [ ] **Step 3: Run existing suites for touched areas**

Run: `bunx vitest run src/lib/provider-testing`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(provider): treat azure-openai as openai-compatible across server behavior"
```

---

### Task 5: Generalize `sanitizeGenerationsRequestForProvider` for azure-openai

**Files:**
- Modify: `src/app/v1/_lib/proxy/openai-image-compat.ts:980-1000`
- Test: `tests/unit/proxy/openai-image-compat.test.ts` (add cases)

**Interfaces:**
- Consumes: `Provider.providerType`.
- Produces: same signature; now strips `response_format` when `provider.providerType === "azure-openai"` (in addition to the existing yunai-azure name/url heuristic).

- [ ] **Step 1: Write the failing test**

```ts
import { sanitizeGenerationsRequestForProvider } from "@/app/v1/_lib/proxy/openai-image-compat";

it("strips response_format for azure-openai provider type", () => {
  const body: Record<string, unknown> = { model: "gpt-image-2", response_format: "url" };
  const changed = sanitizeGenerationsRequestForProvider(body, {
    name: "any", url: "https://res.openai.azure.com", providerType: "azure-openai",
  } as never);
  expect(changed).toBe(true);
  expect(body.response_format).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/proxy/openai-image-compat.test.ts -t "azure-openai provider type"`
Expected: FAIL (`changed` is false; `response_format` still present).

- [ ] **Step 3: Implement**

In `sanitizeGenerationsRequestForProvider`, replace the `looksLikeYunAiAzure` gate so it also returns true when `provider.providerType === "azure-openai"`:
```ts
  const isAzureOpenAI = provider.providerType === "azure-openai";
  const providerName = provider.name.toLowerCase();
  const providerUrl = provider.url.toLowerCase();
  const looksLikeYunAiAzure =
    (providerName.includes("yunai") && providerName.includes("azure")) ||
    (providerUrl.includes("yunai") && providerUrl.includes("azure"));

  if (!isAzureOpenAI && !looksLikeYunAiAzure) {
    return false;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/proxy/openai-image-compat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/v1/_lib/proxy/openai-image-compat.ts tests/unit/proxy/openai-image-compat.test.ts
git commit -m "feat(proxy): strip response_format for azure-openai image generations"
```

---

### Task 6: Forwarder azure-openai image branch

**Files:**
- Modify: `src/app/v1/_lib/proxy/forwarder.ts` (standard-handling branch, insert after line 2734 `processedHeaders.set("host", actualHost);`)
- Test: `tests/unit/proxy/azure-openai-forwarder.test.ts` (new)

**Interfaces:**
- Consumes: `getOpenAIImageEndpoint`, `buildAzureImageProxyUrl`, `resolveAzureImageApiVersion`, `resolveAzureDeployment`, `applyAzureImageAuth`.
- Behavior: when `provider.providerType === "azure-openai"` and `getOpenAIImageEndpoint(requestPath)` is `"generations"` or `"edits"`, recompute `proxyUrl` and mutate `processedHeaders` for Azure; when deployment missing, throw `ProxyError(400)`; when endpoint unsupported for azure (e.g. variations), throw `ProxyError(400)`.

- [ ] **Step 1: Add imports** at top of `forwarder.ts` (with the other `./openai-image-compat` / adapter imports):

```ts
import {
  applyAzureImageAuth,
  buildAzureImageProxyUrl,
  resolveAzureDeployment,
  resolveAzureImageApiVersion,
  type AzureImageEndpoint,
} from "./azure-image-adapter";
```

- [ ] **Step 2: Insert the override block** immediately after `forwarder.ts:2734` (`processedHeaders.set("host", actualHost);`):

```ts
      if (provider.providerType === "azure-openai") {
        const azureEndpoint = getOpenAIImageEndpoint(requestPath);
        if (azureEndpoint !== "generations" && azureEndpoint !== "edits") {
          throw new ProxyError(
            "Invalid request: azure-openai provider only supports /v1/images/generations and /v1/images/edits.",
            400
          );
        }
        const azureBody = (session.request.message ?? {}) as Record<string, unknown>;
        const deployment = resolveAzureDeployment(azureBody);
        if (!deployment) {
          throw new ProxyError(
            "Missing required parameter: model (Azure deployment name).",
            400
          );
        }
        const apiVersion = resolveAzureImageApiVersion(
          azureEndpoint as AzureImageEndpoint,
          provider.azureImageApiVersions
        );
        proxyUrl = buildAzureImageProxyUrl(
          effectiveBaseUrl,
          deployment,
          azureEndpoint as AzureImageEndpoint,
          apiVersion
        );
        applyAzureImageAuth(processedHeaders, provider.key);
        processedHeaders.set("host", HeaderProcessor.extractHost(proxyUrl));
      }
```

Note: `requestPath` is already in scope in this function (used at line 2863). For multipart edits, `session.request.message` holds the logical body (model field parsed by `openai-image-compat`), so `resolveAzureDeployment` works for both JSON and multipart.

- [ ] **Step 3: Write the integration test**

```ts
import { describe, expect, it } from "vitest";
import {
  buildAzureImageProxyUrl,
  resolveAzureImageApiVersion,
} from "@/app/v1/_lib/proxy/azure-image-adapter";

// Focused contract test for the URL/version the forwarder will produce.
describe("azure-openai forwarder url contract", () => {
  it("generations uses 2024-02-01 by default", () => {
    const v = resolveAzureImageApiVersion("generations", null);
    expect(buildAzureImageProxyUrl("https://r.openai.azure.com", "gpt-image-2", "generations", v)).toBe(
      "https://r.openai.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01"
    );
  });
  it("edits uses 2025-04-01-preview by default", () => {
    const v = resolveAzureImageApiVersion("edits", null);
    expect(buildAzureImageProxyUrl("https://r.openai.azure.com", "gpt-image-2", "edits", v)).toBe(
      "https://r.openai.azure.com/openai/deployments/gpt-image-2/images/edits?api-version=2025-04-01-preview"
    );
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bunx vitest run tests/unit/proxy/azure-openai-forwarder.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/v1/_lib/proxy/forwarder.ts tests/unit/proxy/azure-openai-forwarder.test.ts
git commit -m "feat(proxy): forward azure-openai image requests to Azure endpoints"
```

---

### Task 7: UI + i18n for `azure-openai`

**Files:**
- Modify: `src/lib/provider-type-utils.tsx:47` — add `"azure-openai"` entry to `PROVIDER_TYPE_CONFIG` (icon `OpenAI`, `iconColor: "text-sky-600"`, `bgColor: "bg-sky-500/15"`).
- Modify: `src/app/[locale]/settings/providers/_components/forms/provider-form/sections/routing-section.tsx` — add `case "azure-openai": return t("providerTypes.azureOpenai");` in `renderProviderTypeLabel` (line ~63) and add `"azure-openai"` to `providerTypes` array (line 79).
- Modify: `src/app/[locale]/settings/providers/_components/vendor-keys-compact-list.tsx:92` — add `"azure-openai"` to `vendorAllowedTypes`.
- Modify: `src/app/[locale]/settings/providers/_components/forms/api-test-button.tsx:37` — add `"azure-openai": "gpt-image-2",` to the model map.
- Modify i18n (add `azureOpenai` label, no emoji) in all 5 locales:
  - `messages/{en,zh-CN,zh-TW,ja,ru}/settings/providers/form/providerTypes.json` (key `azureOpenai`)
  - `messages/{en,zh-CN,zh-TW,ja,ru}/settings/providers/types.json`
  - `messages/{en,zh-CN,zh-TW,ja,ru}/providers.json`
  - `messages/{en,zh-CN,zh-TW,ja,ru}/settings/statusPage.json`

- [ ] **Step 1: Apply UI edits and add i18n keys.** English label: `"Azure OpenAI"`; zh-CN: `"Azure OpenAI"`; zh-TW: `"Azure OpenAI"`; ja: `"Azure OpenAI"`; ru: `"Azure OpenAI"` (brand name kept in Latin per existing `openaiCompatible` convention).

- [ ] **Step 2: Verify no emoji + placeholders**

Run: `bun run i18n:audit-messages-no-emoji:fail`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: PASS (type-safe locale keys resolve).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): expose azure-openai provider type in provider form and i18n"
```

---

### Task 8: Regenerate OpenAPI types + full verification

**Files:**
- Modify (generated): `src/lib/api-client/v1/openapi-types.gen.ts`

- [ ] **Step 1: Regenerate types**

Run: `bun run openapi:generate`
Expected: `azure-openai` now appears in generated provider_type unions.

- [ ] **Step 2: Full pre-commit gate**

Run: `bun run lint:fix && bun run lint && bun run typecheck && bun run test && bun run build`
Expected: all PASS. Fix any failures before committing.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(api): regenerate openapi types for azure-openai"
```

---

## Self-Review Notes

- Spec section 2.1 (config semantics: URL=resource root, key=api-key, api-version defaults+override) -> Tasks 1, 3, 6.
- Spec 2.2 (deployment from model) -> Task 1 `resolveAzureDeployment` + Task 6.
- Spec 3 (data flow) -> Task 6.
- Spec 4 (param reconciliation) -> Task 5 (structural) + request filters (existing feature, no code).
- Spec 5 (error handling: missing model 400, unsupported endpoint 400) -> Task 6.
- Spec 6 (component boundaries) -> Task 1/2 pure functions, Task 6 forwarder composition.
- Spec 7 (integration points) -> Tasks 3, 4, 7, 8.
- Spec 8 (tests >=80%) -> Tasks 1, 2, 5, 6.
- Spec 9 (scope: images only) -> Task 6 rejects non-image endpoints.
