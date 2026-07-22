# Provider Patrol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automated provider inspection system that periodically verifies providers via detection probes and statistical fingerprinting, with configurable scheduling, tiered remediation actions, and multi-channel notifications.

**Architecture:** A Bull queue-backed scheduler runs two inspection types (quick probe + deep fingerprint) on configurable cron schedules. A Redis distributed lock ensures single-instance execution across deployments. Results feed into an evaluator that triggers configurable actions (circuit breaker open, provider disable) and notifications via the existing webhook pipeline.

**Tech Stack:** Next.js 16 App Router, Hono REST API with `@hono/zod-openapi`, Drizzle ORM (PostgreSQL), Bull queue (Redis), ioredis, Vitest, React 19 + shadcn/ui + Recharts, next-intl (5 languages)

## Global Constraints

- No emoji in code, comments, or string literals
- All user-facing strings use i18n (zh-CN, zh-TW, en, ja, ru)
- Unit test coverage >= 80% for new code
- Path alias: `@/` maps to `./src/`
- Formatting: Biome (double quotes, trailing commas, 2-space indent, 100 char width)
- Named exports only (no default exports)
- Timestamps: always `withTimezone: true`
- Migration workflow: edit schema -> `bun run db:generate` -> review -> apply
- PR target branch: `dev`

---

## File Structure

```
src/
  drizzle/schema.ts                          -- ADD patrol tables + enum extension
  lib/patrol/
    types.ts                                  -- All interfaces and type definitions
    config.ts                                 -- Config resolution (global merge per-provider)
    scheduler.ts                              -- Bull queue + distributed lock
    probes/
      index.ts                                -- Probe registry
      base.ts                                 -- Shared HTTP helpers (call, readJson, readSse)
      connectivity.ts                         -- Probe: basic connectivity
      model-echo.ts                           -- Probe: model identity
      response-shape.ts                       -- Probe: schema compliance
      tool-use.ts                             -- Probe: tool calling
      streaming-shape.ts                      -- Probe: SSE events
      system-prompt-leak.ts                   -- Probe: hidden prompt injection
      consistency-check.ts                    -- Probe: anti-replay
    fingerprint/
      sampler.ts                              -- API sampling logic
      analyzer.ts                             -- Distribution + similarity math
      index.ts                                -- Orchestrate fingerprint run
    evaluator.ts                              -- Verdict determination + scoring
    actions.ts                                -- Execute remediation (circuit/disable/recover)
    notifier.ts                               -- Format + dispatch patrol alerts
    index.ts                                  -- Public API: startPatrol, stopPatrol
  repository/
    patrol-configs.ts                         -- Config CRUD
    patrol-results.ts                         -- Results CRUD + pagination
    patrol-baselines.ts                       -- Baselines CRUD
    patrol-state.ts                           -- Provider state tracking
  lib/api/v1/schemas/patrol.ts               -- Zod schemas for OpenAPI
  app/api/v1/resources/patrol/
    router.ts                                 -- Hono route definitions
    handlers.ts                               -- Request handlers
  actions/patrol.ts                           -- Server actions
  app/[locale]/dashboard/patrol/
    page.tsx                                  -- Overview page
    _components/
      patrol-overview.tsx                     -- Main client component
      patrol-config-panel.tsx                 -- Config UI
      patrol-result-detail.tsx                -- Inspection detail
      patrol-baseline-manager.tsx             -- Baseline calibration
      patrol-trend-chart.tsx                  -- Score trend chart
  instrumentation.ts                          -- ADD patrol scheduler init
messages/
  en/settings/patrol.json                     -- English i18n
  zh-CN/settings/patrol.json                  -- Chinese i18n
  zh-TW/settings/patrol.json                  -- Traditional Chinese
  ja/settings/patrol.json                     -- Japanese
  ru/settings/patrol.json                     -- Russian
tests/unit/
  lib/patrol/
    evaluator.test.ts
    config.test.ts
    probes/connectivity.test.ts
    probes/model-echo.test.ts
    probes/tool-use.test.ts
    fingerprint/analyzer.test.ts
    actions.test.ts
    scheduler.test.ts
```

---

### Task 1: Database Schema & Types

**Files:**
- Modify: `src/drizzle/schema.ts`
- Create: `src/lib/patrol/types.ts`
- Create: `src/lib/constants/patrol.constants.ts`
- Test: `tests/unit/lib/patrol/types.test.ts`

**Interfaces:**
- Produces: `PatrolConfig`, `PatrolResult`, `PatrolBaseline`, `PatrolProviderState`, `PatrolProbeResult`, `PatrolVerdict`, `PatrolAction`, `PatrolProbeContext`
- Produces: DB tables `patrolConfigs`, `patrolResults`, `patrolBaselines`, `patrolProviderState` in schema

- [ ] **Step 1: Add patrol enum extension and tables to schema.ts**

Add after the existing `notificationTypeEnum` (around line 35):

```typescript
// In the notificationTypeEnum, add 'patrol_alert' to the array:
export const notificationTypeEnum = pgEnum('notification_type', [
  'circuit_breaker',
  'daily_leaderboard',
  'cost_alert',
  'cache_hit_rate_alert',
  'patrol_alert',
]);

export const patrolVerdictEnum = pgEnum('patrol_verdict', [
  'pass',
  'warning',
  'critical',
  'counterfeit',
]);

export const patrolInspectionTypeEnum = pgEnum('patrol_inspection_type', [
  'quick_probe',
  'deep_fingerprint',
]);

export const patrolActionEnum = pgEnum('patrol_action', [
  'none',
  'circuit_open',
  'disable',
  'notify_only',
  'recovered',
]);
```

Add new tables after the existing `notificationTargetBindings` table:

```typescript
export const patrolConfigs = pgTable(
  'patrol_configs',
  {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id').references(() => providers.id, { onDelete: 'cascade' }),

    enabled: boolean('enabled'),
    quickProbeEnabled: boolean('quick_probe_enabled'),
    quickProbeCron: varchar('quick_probe_cron', { length: 100 }),
    quickProbeTimeoutMs: integer('quick_probe_timeout_ms'),
    quickProbeProbes: jsonb('quick_probe_probes').$type<string[] | null>(),
    deepFingerprintEnabled: boolean('deep_fingerprint_enabled'),
    deepFingerprintCron: varchar('deep_fingerprint_cron', { length: 100 }),
    deepFingerprintSamples: integer('deep_fingerprint_samples'),
    deepFingerprintTimeoutMs: integer('deep_fingerprint_timeout_ms'),

    thresholdPass: integer('threshold_pass'),
    thresholdWarning: integer('threshold_warning'),
    thresholdCritical: integer('threshold_critical'),
    fingerprintMatchThreshold: numeric('fingerprint_match_threshold', { precision: 4, scale: 3 }),

    actionOnWarning: varchar('action_on_warning', { length: 20 }),
    actionOnCritical: varchar('action_on_critical', { length: 20 }),
    actionOnCounterfeit: varchar('action_on_counterfeit', { length: 20 }),

    autoRecoverEnabled: boolean('auto_recover_enabled'),
    autoRecoverPasses: integer('auto_recover_passes'),
    autoRecoverCounterfeit: boolean('auto_recover_counterfeit'),

    notifyOnWarning: boolean('notify_on_warning'),
    notifyOnCritical: boolean('notify_on_critical'),
    notifyOnCounterfeit: boolean('notify_on_counterfeit'),
    notifyOnRecovery: boolean('notify_on_recovery'),

    concurrencyLimit: integer('concurrency_limit'),
    retryAttempts: integer('retry_attempts'),
    cooldownMinutes: integer('cooldown_minutes'),
    probeWeights: jsonb('probe_weights').$type<Record<string, number> | null>(),

    skipPatrol: boolean('skip_patrol').notNull().default(false),
    expectedChannel: varchar('expected_channel', { length: 20 }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    patrolConfigsProviderIdx: uniqueIndex('idx_patrol_configs_provider').on(table.providerId),
  })
);

export const patrolResults = pgTable(
  'patrol_results',
  {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    inspectionType: patrolInspectionTypeEnum('inspection_type').notNull(),
    score: integer('score').notNull(),
    verdict: patrolVerdictEnum('verdict').notNull(),
    probeDetails: jsonb('probe_details').notNull().$type<PatrolProbeResult[]>(),
    fingerprintDetails: jsonb('fingerprint_details').$type<FingerprintDetails | null>(),
    actionTaken: patrolActionEnum('action_taken'),
    latencyMs: integer('latency_ms'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    patrolResultsProviderTimeIdx: index('idx_patrol_results_provider_time').on(
      table.providerId,
      table.createdAt
    ),
    patrolResultsVerdictIdx: index('idx_patrol_results_verdict').on(
      table.verdict,
      table.createdAt
    ),
  })
);

export const patrolBaselines = pgTable(
  'patrol_baselines',
  {
    id: serial('id').primaryKey(),
    modelName: varchar('model_name', { length: 100 }).notNull(),
    label: varchar('label', { length: 200 }),
    providerType: varchar('provider_type', { length: 20 }).notNull(),
    sampleCount: integer('sample_count').notNull(),
    distribution: jsonb('distribution').notNull().$type<number[]>(),
    stats: jsonb('stats').notNull().$type<FingerprintStats>(),
    calibratedAt: timestamp('calibrated_at', { withTimezone: true }).defaultNow(),
    calibratedBy: varchar('calibrated_by', { length: 100 }),
    notes: text('notes'),
  },
  (table) => ({
    patrolBaselinesModelIdx: uniqueIndex('idx_patrol_baselines_model').on(
      table.modelName,
      table.providerType
    ),
  })
);

export const patrolProviderState = pgTable('patrol_provider_state', {
  providerId: integer('provider_id')
    .primaryKey()
    .references(() => providers.id, { onDelete: 'cascade' }),
  consecutivePassCount: integer('consecutive_pass_count').notNull().default(0),
  lastVerdict: patrolVerdictEnum('last_verdict'),
  lastScore: integer('last_score'),
  lastInspectedAt: timestamp('last_inspected_at', { withTimezone: true }),
  patrolDisabledReason: text('patrol_disabled_reason'),
  patrolDisabledAt: timestamp('patrol_disabled_at', { withTimezone: true }),
});
```

- [ ] **Step 2: Create types.ts**

```typescript
// src/lib/patrol/types.ts
import type { ProviderType } from "@/types/provider";

export interface PatrolProbeContext {
  endpoint: string;
  apiKey: string;
  model: string;
  providerType: ProviderType;
  timeout: number;
  signal: AbortSignal;
}

export interface PatrolProbeResult {
  name: string;
  label: string;
  category: string;
  weight: number;
  passed: boolean;
  score: number;
  detail: string;
  latencyMs: number;
}

export type PatrolVerdict = "pass" | "warning" | "critical" | "counterfeit";
export type PatrolActionType = "none" | "circuit_open" | "disable" | "notify_only";

export interface PatrolConfig {
  enabled: boolean;
  quickProbeEnabled: boolean;
  quickProbeCron: string;
  quickProbeTimeoutMs: number;
  quickProbeProbes: string[];
  deepFingerprintEnabled: boolean;
  deepFingerprintCron: string;
  deepFingerprintSamples: number;
  deepFingerprintTimeoutMs: number;
  thresholdPass: number;
  thresholdWarning: number;
  thresholdCritical: number;
  fingerprintMatchThreshold: number;
  actionOnWarning: PatrolActionType;
  actionOnCritical: PatrolActionType;
  actionOnCounterfeit: PatrolActionType;
  autoRecoverEnabled: boolean;
  autoRecoverPasses: number;
  autoRecoverCounterfeit: boolean;
  notifyOnWarning: boolean;
  notifyOnCritical: boolean;
  notifyOnCounterfeit: boolean;
  notifyOnRecovery: boolean;
  concurrencyLimit: number;
  retryAttempts: number;
  cooldownMinutes: number;
  probeWeights: Record<string, number> | null;
  skipPatrol: boolean;
  expectedChannel: string | null;
}

export interface FingerprintStats {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  uniqueCount: number;
  validSamples: number;
  errorCount: number;
}

export interface FingerprintMatchResult {
  baselineId: number;
  baselineLabel: string;
  cosineSimilarity: number;
  jsDivergence: number;
  overallScore: number;
}

export interface FingerprintDetails {
  sampleCount: number;
  distribution: number[];
  stats: FingerprintStats;
  matchResult: FingerprintMatchResult | null;
}

export interface PatrolProviderTarget {
  id: number;
  name: string;
  url: string;
  key: string;
  providerType: ProviderType;
  model?: string;
}

export interface PatrolProbe {
  name: string;
  label: string;
  category: string;
  defaultWeight: number;
  run(ctx: PatrolProbeContext): Promise<Omit<PatrolProbeResult, "name" | "label" | "category" | "weight">>;
}
```

- [ ] **Step 3: Create constants file**

```typescript
// src/lib/constants/patrol.constants.ts
export const DEFAULT_PATROL_CONFIG = {
  enabled: true,
  quickProbeEnabled: true,
  quickProbeCron: "0 * * * *",
  quickProbeTimeoutMs: 30000,
  quickProbeProbes: [
    "connectivity",
    "model_echo",
    "response_shape",
    "tool_use",
    "streaming_shape",
    "system_prompt_leak",
    "consistency_check",
  ],
  deepFingerprintEnabled: true,
  deepFingerprintCron: "0 4 * * *",
  deepFingerprintSamples: 100,
  deepFingerprintTimeoutMs: 300000,
  thresholdPass: 85,
  thresholdWarning: 50,
  thresholdCritical: 30,
  fingerprintMatchThreshold: 0.3,
  actionOnWarning: "circuit_open" as const,
  actionOnCritical: "disable" as const,
  actionOnCounterfeit: "disable" as const,
  autoRecoverEnabled: true,
  autoRecoverPasses: 3,
  autoRecoverCounterfeit: false,
  notifyOnWarning: true,
  notifyOnCritical: true,
  notifyOnCounterfeit: true,
  notifyOnRecovery: true,
  concurrencyLimit: 3,
  retryAttempts: 1,
  cooldownMinutes: 5,
  probeWeights: null,
  skipPatrol: false,
  expectedChannel: null,
} as const;

export const PATROL_QUEUE_NAME = "patrol";
export const PATROL_LOCK_KEY = "cch:patrol:scheduler:lock";
export const PATROL_LOCK_TTL_MS = 120_000;

export const ALL_PATROL_PROBES = [
  "connectivity",
  "model_echo",
  "response_shape",
  "tool_use",
  "streaming_shape",
  "system_prompt_leak",
  "consistency_check",
  "self_identification",
  "reasoning_fingerprint",
  "multimodal",
  "cache_behavior",
  "header_fingerprint",
  "stop_sequence",
  "max_tokens",
  "multi_turn",
  "error_shape",
  "system_adherence",
  "count_tokens_match",
  "document_input",
] as const;

export type PatrolProbeName = (typeof ALL_PATROL_PROBES)[number];
```

- [ ] **Step 4: Generate migration**

Run: `bun run db:generate`

Review the generated SQL file in `drizzle/` directory. It should contain CREATE TABLE statements for the 4 new tables, the new enums, and ALTER for the notification_type enum.

- [ ] **Step 5: Write basic type test**

```typescript
// tests/unit/lib/patrol/types.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PATROL_CONFIG, ALL_PATROL_PROBES } from "@/lib/constants/patrol.constants";

describe("patrol constants", () => {
  it("default config has all required fields", () => {
    expect(DEFAULT_PATROL_CONFIG.quickProbeProbes.length).toBeGreaterThan(0);
    expect(DEFAULT_PATROL_CONFIG.thresholdPass).toBeGreaterThan(DEFAULT_PATROL_CONFIG.thresholdCritical);
    expect(DEFAULT_PATROL_CONFIG.thresholdWarning).toBeLessThan(DEFAULT_PATROL_CONFIG.thresholdPass);
  });

  it("all default probes are in ALL_PATROL_PROBES", () => {
    for (const probe of DEFAULT_PATROL_CONFIG.quickProbeProbes) {
      expect(ALL_PATROL_PROBES).toContain(probe);
    }
  });

  it("ALL_PATROL_PROBES has no duplicates", () => {
    const unique = new Set(ALL_PATROL_PROBES);
    expect(unique.size).toBe(ALL_PATROL_PROBES.length);
  });
});
```

- [ ] **Step 6: Run test and commit**

Run: `bunx vitest run tests/unit/lib/patrol/types.test.ts`
Expected: PASS

```bash
git add src/drizzle/schema.ts src/lib/patrol/types.ts src/lib/constants/patrol.constants.ts tests/unit/lib/patrol/types.test.ts drizzle/
git commit -m "feat(patrol): add database schema, types, and constants"
```

---

### Task 2: Probe Engine (Core Probes)

**Files:**
- Create: `src/lib/patrol/probes/base.ts`
- Create: `src/lib/patrol/probes/connectivity.ts`
- Create: `src/lib/patrol/probes/model-echo.ts`
- Create: `src/lib/patrol/probes/response-shape.ts`
- Create: `src/lib/patrol/probes/tool-use.ts`
- Create: `src/lib/patrol/probes/streaming-shape.ts`
- Create: `src/lib/patrol/probes/system-prompt-leak.ts`
- Create: `src/lib/patrol/probes/consistency-check.ts`
- Create: `src/lib/patrol/probes/index.ts`
- Test: `tests/unit/lib/patrol/probes/connectivity.test.ts`
- Test: `tests/unit/lib/patrol/probes/model-echo.test.ts`
- Test: `tests/unit/lib/patrol/probes/tool-use.test.ts`

**Interfaces:**
- Consumes: `PatrolProbe`, `PatrolProbeContext`, `PatrolProbeResult` from Task 1
- Produces: `getProbeByName(name: string): PatrolProbe | undefined`, `getAllProbes(): PatrolProbe[]`, `runProbeWithRetry(probe, ctx, retries): Promise<PatrolProbeResult>`

**Implementation notes:**
- `base.ts` provides HTTP helpers adapted from the claude-detector reference: `call()`, `readJson()`, `readSseEvents()`
- Each probe file exports a single `PatrolProbe` object
- `index.ts` collects all probes into a registry map
- Probes use Anthropic Messages API format (same as the existing `executeProviderTest` but with richer validation)
- The test files mock `fetch()` globally via `vi.fn()` to simulate API responses

- [ ] **Step 1: Write base.ts with HTTP helpers**

Adapt from the claude-detector reference (`自动巡检/claude-detector/src/lib/anthropic.ts`) but simplified. Use native `fetch()` with AbortSignal for timeout. Include SSE event reader for streaming probes.

- [ ] **Step 2: Write connectivity probe with test**

The simplest probe: sends `{model, max_tokens: 16, messages: [{role: "user", content: "ping"}]}`, checks HTTP 200 + response has `id` and `content` fields.

- [ ] **Step 3: Write model-echo probe with test**

Sends a request, verifies `response.model` starts with the requested model (ignoring date suffixes like `-20251001`).

- [ ] **Step 4: Write remaining 5 probes**

Each follows the same pattern from the claude-detector reference (response-shape, tool-use, streaming-shape, system-prompt-leak, consistency-check). Tool-use probe uses forced `tool_choice` and validates `toolu_` ID prefix + `stop_reason: "tool_use"`.

- [ ] **Step 5: Write probe registry index.ts**

```typescript
// src/lib/patrol/probes/index.ts
import type { PatrolProbe, PatrolProbeContext, PatrolProbeResult } from "../types";
import { connectivity } from "./connectivity";
import { modelEcho } from "./model-echo";
import { responseShape } from "./response-shape";
import { toolUse } from "./tool-use";
import { streamingShape } from "./streaming-shape";
import { systemPromptLeak } from "./system-prompt-leak";
import { consistencyCheck } from "./consistency-check";

const PROBE_REGISTRY = new Map<string, PatrolProbe>([
  ["connectivity", connectivity],
  ["model_echo", modelEcho],
  ["response_shape", responseShape],
  ["tool_use", toolUse],
  ["streaming_shape", streamingShape],
  ["system_prompt_leak", systemPromptLeak],
  ["consistency_check", consistencyCheck],
]);

export function getProbeByName(name: string): PatrolProbe | undefined {
  return PROBE_REGISTRY.get(name);
}

export function getAllProbes(): PatrolProbe[] {
  return [...PROBE_REGISTRY.values()];
}

export async function runProbeWithRetry(
  probe: PatrolProbe,
  ctx: PatrolProbeContext,
  retries: number
): Promise<PatrolProbeResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await probe.run(ctx);
      return {
        name: probe.name,
        label: probe.label,
        category: probe.category,
        weight: probe.defaultWeight,
        ...result,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof Error && err.name === "AbortError") break;
    }
  }
  return {
    name: probe.name,
    label: probe.label,
    category: probe.category,
    weight: probe.defaultWeight,
    passed: false,
    score: 0,
    detail: `exception: ${lastError?.message ?? "unknown"}`,
    latencyMs: 0,
  };
}
```

- [ ] **Step 6: Run all probe tests and commit**

Run: `bunx vitest run tests/unit/lib/patrol/probes/`
Expected: All PASS

```bash
git add src/lib/patrol/probes/ tests/unit/lib/patrol/probes/
git commit -m "feat(patrol): implement core detection probes"
```

---

### Task 3: Config Resolution & Repository Layer

**Files:**
- Create: `src/lib/patrol/config.ts`
- Create: `src/repository/patrol-configs.ts`
- Create: `src/repository/patrol-results.ts`
- Create: `src/repository/patrol-baselines.ts`
- Create: `src/repository/patrol-state.ts`
- Test: `tests/unit/lib/patrol/config.test.ts`

**Interfaces:**
- Consumes: `PatrolConfig`, `DEFAULT_PATROL_CONFIG` from Task 1
- Produces: `resolveConfig(providerId: number): Promise<PatrolConfig>`, `getGlobalConfig(): Promise<PatrolConfig>`, repository CRUD functions

**Implementation notes:**
- `config.ts` merges global defaults -> DB global row -> DB per-provider row (null fields inherit from previous layer)
- Repository files follow the existing `"use server"` + `db` import pattern from `src/repository/webhook-targets.ts`

- [ ] **Step 1: Write config.ts with merge logic and test**

```typescript
// src/lib/patrol/config.ts
import { DEFAULT_PATROL_CONFIG } from "@/lib/constants/patrol.constants";
import type { PatrolConfig, PatrolActionType } from "./types";

export function mergeConfig(
  base: PatrolConfig,
  override: Partial<Record<keyof PatrolConfig, unknown>> | null
): PatrolConfig {
  if (!override) return base;
  const merged = { ...base };
  for (const key of Object.keys(override) as (keyof PatrolConfig)[]) {
    const val = override[key];
    if (val !== null && val !== undefined) {
      (merged as Record<string, unknown>)[key] = val;
    }
  }
  return merged;
}

export async function resolveConfig(providerId: number | null): Promise<PatrolConfig> {
  const { getPatrolConfigByProvider, getGlobalPatrolConfig } = await import(
    "@/repository/patrol-configs"
  );
  const globalRow = await getGlobalPatrolConfig();
  const base = mergeConfig(DEFAULT_PATROL_CONFIG as unknown as PatrolConfig, globalRow);
  if (providerId === null) return base;
  const providerRow = await getPatrolConfigByProvider(providerId);
  return mergeConfig(base, providerRow);
}
```

- [ ] **Step 2: Write repository files**

Follow the exact pattern from `src/repository/webhook-targets.ts`: `"use server"` directive, import `db` from `@/drizzle/db`, import tables from `@/drizzle/schema`, typed return values, `toXxx(row)` transformer.

- [ ] **Step 3: Run tests and commit**

Run: `bunx vitest run tests/unit/lib/patrol/config.test.ts`
Expected: PASS

```bash
git add src/lib/patrol/config.ts src/repository/patrol-configs.ts src/repository/patrol-results.ts src/repository/patrol-baselines.ts src/repository/patrol-state.ts tests/unit/lib/patrol/config.test.ts
git commit -m "feat(patrol): add config resolution and repository layer"
```

---

### Task 4: Evaluator & Actions

**Files:**
- Create: `src/lib/patrol/evaluator.ts`
- Create: `src/lib/patrol/actions.ts`
- Create: `src/lib/patrol/notifier.ts`
- Test: `tests/unit/lib/patrol/evaluator.test.ts`
- Test: `tests/unit/lib/patrol/actions.test.ts`

**Interfaces:**
- Consumes: `PatrolConfig`, `PatrolProbeResult`, `PatrolVerdict`, `PatrolActionType` from Task 1; `recordFailure`, `forceCloseCircuitState` from `@/lib/circuit-breaker`; `sendPatrolAlert` (new, from notifier)
- Produces: `evaluate(probeResults, fingerprintScore, config): {score, verdict}`, `executeAction(providerId, verdict, config): Promise<PatrolActionType>`, `sendPatrolAlert(data): Promise<void>`

- [ ] **Step 1: Write evaluator.ts with test**

```typescript
// src/lib/patrol/evaluator.ts
import type { PatrolConfig, PatrolProbeResult, PatrolVerdict } from "./types";

export function calculateScore(
  results: PatrolProbeResult[],
  probeWeights: Record<string, number> | null
): number {
  let weightTotal = 0;
  let weightedSum = 0;
  for (const r of results) {
    const weight = probeWeights?.[r.name] ?? r.weight;
    weightTotal += weight;
    weightedSum += r.score * weight;
  }
  if (weightTotal === 0) return 0;
  return Math.round((weightedSum / weightTotal) * 100);
}

export function determineVerdict(
  probeScore: number,
  fingerprintScore: number | null,
  config: PatrolConfig
): PatrolVerdict {
  if (
    fingerprintScore !== null &&
    fingerprintScore < config.fingerprintMatchThreshold
  ) {
    return "counterfeit";
  }
  if (probeScore < config.thresholdCritical) return "critical";
  if (probeScore < config.thresholdPass) return "warning";
  return "pass";
}
```

- [ ] **Step 2: Write actions.ts**

Implements `executeAction()` which:
- On `"circuit_open"`: calls `recordFailure()` from circuit-breaker with a synthetic error
- On `"disable"`: updates provider `isEnabled = false` via repository + records reason in `patrolProviderState`
- On `"none"` / `"notify_only"`: no-op / only sends notification
- Auto-recovery: increments `consecutivePassCount`, re-enables when threshold met

- [ ] **Step 3: Write notifier.ts**

Follows the pattern of `src/lib/notification/notifier.ts`:
- Checks notification settings enabled
- Redis dedup with configurable cooldown
- Enqueues via `addNotificationJobForTarget` for all `patrol_alert` bindings
- Builds `StructuredMessage` with sections for provider name, score, verdict, failed probes, action taken

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run tests/unit/lib/patrol/evaluator.test.ts tests/unit/lib/patrol/actions.test.ts`
Expected: All PASS

```bash
git add src/lib/patrol/evaluator.ts src/lib/patrol/actions.ts src/lib/patrol/notifier.ts tests/unit/lib/patrol/
git commit -m "feat(patrol): add evaluator, actions, and notification dispatch"
```

---

### Task 5: Fingerprint Engine

**Files:**
- Create: `src/lib/patrol/fingerprint/sampler.ts`
- Create: `src/lib/patrol/fingerprint/analyzer.ts`
- Create: `src/lib/patrol/fingerprint/index.ts`
- Test: `tests/unit/lib/patrol/fingerprint/analyzer.test.ts`

**Interfaces:**
- Consumes: `PatrolProbeContext`, `FingerprintStats`, `FingerprintDetails`, `FingerprintMatchResult` from Task 1; `getBaselineByModel` from Task 3
- Produces: `sampleProvider(ctx, sampleCount, signal): Promise<{numbers, errorCount}>`, `calculateDistribution(numbers): number[]`, `calculateSimilarity(dist1, dist2): {cosineSimilarity, jsDivergence, overallScore}`, `runFingerprint(providerId, ctx, config): Promise<FingerprintDetails>`

- [ ] **Step 1: Write analyzer.ts with pure math functions and test**

Port the `calculateDistribution`, `calculateStats`, `calculateSimilarity` functions from `自动巡检/hlwy-ai-checker/hlwy-ai-checker.html` (lines 1204-1237).

- [ ] **Step 2: Write sampler.ts**

Makes N API calls asking the model to pick a random number 1-355. Uses both Anthropic and OpenAI format based on `providerType`. Handles errors gracefully (counts them but continues).

- [ ] **Step 3: Write fingerprint/index.ts orchestrator**

Orchestrates: sample -> calculate distribution -> compare against baseline from DB -> return `FingerprintDetails`.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run tests/unit/lib/patrol/fingerprint/`
Expected: PASS

```bash
git add src/lib/patrol/fingerprint/ tests/unit/lib/patrol/fingerprint/
git commit -m "feat(patrol): implement statistical fingerprint engine"
```

---

### Task 6: Scheduler & Orchestrator

**Files:**
- Create: `src/lib/patrol/scheduler.ts`
- Create: `src/lib/patrol/index.ts`
- Modify: `src/instrumentation.ts` (add patrol scheduler init)
- Test: `tests/unit/lib/patrol/scheduler.test.ts`

**Interfaces:**
- Consumes: `resolveConfig` from Task 3; probe registry from Task 2; evaluator/actions from Task 4; fingerprint from Task 5; `getRedisClient` from `@/lib/redis/client`; `buildRedisQueueOptions` from `@/lib/redis/bull-queue-options`
- Produces: `startPatrolScheduler(): void`, `stopPatrolScheduler(): void`, `triggerPatrolRun(providerId?: number, type?: string): Promise<void>`

- [ ] **Step 1: Write scheduler.ts**

Pattern follows `src/lib/circuit-breaker-probe.ts` for setInterval-based scheduling + `src/lib/notification/notification-queue.ts` for Bull queue setup. Uses Redis `SET NX PX` for distributed lock.

Key flow:
1. Bull queue created with `buildRedisQueueOptions`
2. Repeatable jobs registered from global config cron
3. Processor acquires distributed lock -> loads eligible providers -> runs inspections in batches of `concurrencyLimit` -> evaluates -> acts

- [ ] **Step 2: Write index.ts public API**

```typescript
// src/lib/patrol/index.ts
export { startPatrolScheduler, stopPatrolScheduler, triggerPatrolRun } from "./scheduler";
export { resolveConfig } from "./config";
export { getAllProbes } from "./probes";
```

- [ ] **Step 3: Add to instrumentation.ts**

Add after the smart probing init block (around line 440):

```typescript
// Initialize patrol scheduler
try {
  const { startPatrolScheduler } = await import("@/lib/patrol");
  startPatrolScheduler();
  logger.info("[Instrumentation] Patrol scheduler started");
} catch (error) {
  logger.warn("[Instrumentation] Failed to start patrol scheduler", {
    error: error instanceof Error ? error.message : String(error),
  });
}
```

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run tests/unit/lib/patrol/scheduler.test.ts`
Expected: PASS

```bash
git add src/lib/patrol/scheduler.ts src/lib/patrol/index.ts src/instrumentation.ts tests/unit/lib/patrol/scheduler.test.ts
git commit -m "feat(patrol): add Bull queue scheduler with distributed lock"
```

---

### Task 7: REST API Endpoints

**Files:**
- Create: `src/lib/api/v1/schemas/patrol.ts`
- Create: `src/app/api/v1/resources/patrol/router.ts`
- Create: `src/app/api/v1/resources/patrol/handlers.ts`
- Modify: `src/app/api/v1/_root/app.ts` (mount patrol router)
- Create: `src/actions/patrol.ts`
- Test: `tests/unit/api/v1/patrol.test.ts`

**Interfaces:**
- Consumes: Repository functions from Task 3; `triggerPatrolRun` from Task 6; `resolveConfig` from Task 3
- Produces: REST endpoints: `GET /patrol/status`, `GET /patrol/results`, `POST /patrol/trigger`, `GET/PUT /patrol/config/global`, `PUT/DELETE /patrol/config/provider/:id`, `GET/POST/DELETE /patrol/baselines`, `POST /patrol/recover/:providerId`, `GET /patrol/probes`

- [ ] **Step 1: Create Zod schemas**

Define request/response schemas in `src/lib/api/v1/schemas/patrol.ts` using `z` from `@hono/zod-openapi`. Follow patterns from existing schema files.

- [ ] **Step 2: Create router.ts with route definitions**

Follow the exact pattern from `src/app/api/v1/resources/notifications/router.ts`:
- `new OpenAPIHono()` with `defaultHook` for validation errors
- `createRoute()` for each endpoint with middleware, tags, security, responses
- `requireAuth("admin")` for all endpoints

- [ ] **Step 3: Create handlers.ts**

Each handler calls into server actions or repository layer, returns `jsonResponse(data)` for success, `createProblemResponse()` for errors.

- [ ] **Step 4: Create server actions file**

`src/actions/patrol.ts` with `"use server"` directive. Functions return `ActionResult<T>`. Auth check with `getSession()`.

- [ ] **Step 5: Mount router in app.ts**

Add import and `app.route("/", patrolRouter)` in `src/app/api/v1/_root/app.ts`.

- [ ] **Step 6: Run tests and commit**

Run: `bunx vitest run tests/unit/api/v1/patrol.test.ts`
Expected: PASS

```bash
git add src/lib/api/v1/schemas/patrol.ts src/app/api/v1/resources/patrol/ src/app/api/v1/_root/app.ts src/actions/patrol.ts tests/unit/api/v1/patrol.test.ts
git commit -m "feat(patrol): add REST API endpoints with OpenAPI docs"
```

---

### Task 8: Dashboard UI

**Files:**
- Create: `src/app/[locale]/dashboard/patrol/page.tsx`
- Create: `src/app/[locale]/dashboard/patrol/_components/patrol-overview.tsx`
- Create: `src/app/[locale]/dashboard/patrol/_components/patrol-config-panel.tsx`
- Create: `src/app/[locale]/dashboard/patrol/_components/patrol-result-detail.tsx`
- Create: `src/app/[locale]/dashboard/patrol/_components/patrol-baseline-manager.tsx`
- Create: `src/app/[locale]/dashboard/patrol/_components/patrol-trend-chart.tsx`
- Create: `messages/en/settings/patrol.json`
- Create: `messages/zh-CN/settings/patrol.json`
- Create: `messages/zh-TW/settings/patrol.json`
- Create: `messages/ja/settings/patrol.json`
- Create: `messages/ru/settings/patrol.json`
- Modify: `messages/en/index.ts` (add patrol namespace)
- Modify: `messages/zh-CN/index.ts`
- Modify: `messages/zh-TW/index.ts`
- Modify: `messages/ja/index.ts`
- Modify: `messages/ru/index.ts`

**Interfaces:**
- Consumes: REST API from Task 7
- Produces: Full dashboard pages for patrol management

**Implementation notes:**
- Page is a server component with `export const dynamic = "force-dynamic"`
- Client components fetch from `/api/v1/patrol/*` using `fetch()` + `useState` pattern
- UI uses shadcn/ui: Card, Table, Badge, Button, Select, Tabs, Switch, Slider
- Charts use Recharts (LineChart for trend, BarChart for fingerprint distribution)
- i18n via `useTranslations("settings.patrol")`

- [ ] **Step 1: Create i18n message files**

Create all 5 language files with keys for: title, description, status badges (pass/warning/critical/counterfeit), config labels, action labels, probe names/descriptions, chart labels.

- [ ] **Step 2: Create page.tsx (server component)**

```typescript
// src/app/[locale]/dashboard/patrol/page.tsx
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { Suspense } from "react";
import { PatrolOverview } from "./_components/patrol-overview";

export const dynamic = "force-dynamic";

export default async function PatrolPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings.patrol" });
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return null;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("description")}</p>
      </div>
      <Suspense fallback={<div className="animate-pulse h-96 bg-muted rounded-lg" />}>
        <PatrolOverview />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 3: Create client components**

`patrol-overview.tsx`: Fetches `/api/v1/patrol/status`, displays stat cards + provider status table with actions (Trigger, Recover, View Detail). Tabs for Overview / Config / Baselines.

`patrol-config-panel.tsx`: Form with switches, cron inputs, sliders for thresholds, probe checkboxes. Saves via PUT to `/api/v1/patrol/config/global`.

`patrol-result-detail.tsx`: Displays per-probe results as colored cards. Shows fingerprint comparison chart when applicable.

`patrol-baseline-manager.tsx`: Lists baselines, calibration trigger form with progress indicator.

`patrol-trend-chart.tsx`: Recharts LineChart showing score over time for selected providers.

- [ ] **Step 4: Add navigation link**

Add patrol to the dashboard sidebar navigation (look for existing nav config and add entry).

- [ ] **Step 5: Build and lint**

Run: `bun run build && bun run lint && bun run typecheck`
Expected: No errors

```bash
git add src/app/\[locale\]/dashboard/patrol/ messages/ src/app/\[locale\]/dashboard/_components/
git commit -m "feat(patrol): add dashboard UI with i18n support"
```

---

### Task 9: Integration Testing & Polish

**Files:**
- Modify: Various files for edge cases
- Test: `tests/unit/lib/patrol/integration.test.ts`

**Interfaces:**
- Consumes: All previous tasks
- Produces: Complete integration test covering scheduler -> probe -> evaluate -> act -> notify flow

- [ ] **Step 1: Write integration test**

Mock the Bull queue and Redis, simulate a full patrol cycle: config resolution -> probe execution -> score calculation -> verdict -> action -> notification dispatch. Verify the entire pipeline end-to-end.

- [ ] **Step 2: Add notification queue processor for patrol_alert**

Update `src/lib/notification/notification-queue.ts` to handle `"patrol-alert"` job type in the processor switch statement. Build a `StructuredMessage` with header (warning/error level based on verdict), sections for provider info, score, failed probes, action taken.

- [ ] **Step 3: Add patrol_alert to notification constants**

Update `src/lib/constants/notification.constants.ts` to include `"patrol-alert"` in `NOTIFICATION_JOB_TYPES`.

- [ ] **Step 4: Run full test suite**

Run: `bun run test`
Expected: All tests pass

Run: `bun run build && bun run lint && bun run typecheck`
Expected: No errors

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(patrol): integration tests and notification queue handler"
```

---

## Verification Checklist

After all tasks complete, verify:

1. `bun run build` succeeds
2. `bun run lint` passes (no Biome errors)
3. `bun run typecheck` passes (tsgo --noEmit)
4. `bun run test` passes (all unit tests)
5. `bun run db:generate` produces no additional diff (schema matches migrations)
6. No emoji in any source file
7. All user-facing strings use i18n keys
8. All 5 language message files have matching key structures
