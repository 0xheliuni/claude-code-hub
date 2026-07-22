# Provider Patrol - Automated Provider Inspection System

## Overview

An automated inspection system that periodically verifies provider channels using detection probes and statistical fingerprinting, with configurable scheduling, flexible probe selection, tiered response actions, and multi-channel notifications.

## Goals

1. Detect provider degradation, model substitution, or API counterfeiting automatically
2. Minimize manual intervention through configurable auto-remediation
3. Maintain service quality by removing unreliable providers from rotation
4. Provide full observability via dashboard, history, and alerting
5. Keep everything configurable at global and per-provider levels

## Non-Goals

- Cross-provider signature replay validation (deferred to a future phase)
- Real-time per-request validation (the existing circuit breaker handles this)
- Replacing the existing circuit breaker or smart probe system

---

## Architecture

```
                        ┌──────────────────────────────────┐
                        │       Patrol Scheduler           │
                        │  (Redis distributed lock + Bull) │
                        └──────────────┬───────────────────┘
                                       │
              ┌────────────────────────┬┴────────────────────────┐
              ▼                        ▼                         ▼
   ┌──────────────────┐    ┌────────────────────┐    ┌──────────────────┐
   │   Quick Probe    │    │ Deep Fingerprint   │    │  Manual Trigger  │
   │  (configurable   │    │ (configurable      │    │  (REST API /     │
   │   cron / probes) │    │  cron / samples)   │    │   Dashboard)     │
   └────────┬─────────┘    └─────────┬──────────┘    └────────┬─────────┘
            │                        │                         │
            └────────────────────────┼─────────────────────────┘
                                     ▼
                        ┌──────────────────────────────────┐
                        │       Verdict Evaluator          │
                        │  (configurable thresholds)       │
                        └──────────────┬───────────────────┘
                                       │
              ┌────────────────────────┬┴────────────────────────┐
              ▼                        ▼                         ▼
   ┌──────────────────┐    ┌────────────────────┐    ┌──────────────────┐
   │  Record Result   │    │  Execute Action    │    │ Send Notification│
   │  (patrol_results)│    │  (configurable     │    │ (configurable    │
   │                  │    │   per severity)    │    │  channels)       │
   └──────────────────┘    └────────────────────┘    └──────────────────┘
```

---

## Configuration Model

All behavior is configurable. There is a single global config and optional per-provider overrides. Any field left `null` in a per-provider override inherits from the global config.

### Global Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch for the entire patrol system |
| `quickProbeEnabled` | boolean | `true` | Enable/disable the quick probe inspection type |
| `quickProbeCron` | string | `"0 * * * *"` | Cron expression for quick probe schedule |
| `quickProbeTimeoutMs` | integer | `30000` | Timeout per probe run |
| `quickProbeProbes` | string[] | (see below) | List of probe names to run |
| `deepFingerprintEnabled` | boolean | `true` | Enable/disable the deep fingerprint inspection |
| `deepFingerprintCron` | string | `"0 4 * * *"` | Cron expression for deep fingerprint schedule |
| `deepFingerprintSamples` | integer | `100` | Number of samples per fingerprint run (50-500) |
| `deepFingerprintTimeoutMs` | integer | `300000` | Timeout for fingerprint run |
| `thresholdPass` | integer | `85` | Score >= this = pass |
| `thresholdWarning` | integer | `50` | Score >= this but < pass = warning |
| `thresholdCritical` | integer | `30` | Score < this = critical |
| `fingerprintMatchThreshold` | float | `0.3` | overallScore below this = counterfeit |
| `actionOnWarning` | enum | `"circuit_open"` | Action: `none`, `circuit_open`, `disable`, `notify_only` |
| `actionOnCritical` | enum | `"disable"` | Action: `none`, `circuit_open`, `disable`, `notify_only` |
| `actionOnCounterfeit` | enum | `"disable"` | Action: `none`, `circuit_open`, `disable`, `notify_only` |
| `autoRecoverEnabled` | boolean | `true` | Allow auto-recovery after consecutive passes |
| `autoRecoverPasses` | integer | `3` | Consecutive passes needed to auto-recover |
| `notifyOnWarning` | boolean | `true` | Send notification for warning level |
| `notifyOnCritical` | boolean | `true` | Send notification for critical level |
| `notifyOnCounterfeit` | boolean | `true` | Send notification for counterfeit detection |
| `notifyOnRecovery` | boolean | `true` | Send notification when provider recovers |
| `concurrencyLimit` | integer | `3` | Max providers inspected concurrently |
| `retryAttempts` | integer | `1` | Retries per failed probe before scoring |
| `cooldownMinutes` | integer | `5` | Min gap between notifications for the same provider |
| `probeWeights` | object | `null` | Override default probe weights. Map of probe name to integer weight (1-5). Null = use probe defaults |

### Default Quick Probe Set

```typescript
const DEFAULT_PROBES = [
  "connectivity",       // Basic connectivity and auth
  "model_echo",         // Model identity matches request
  "response_shape",     // Response schema compliance
  "tool_use",           // Tool calling capability
  "streaming_shape",    // SSE event sequence correctness
  "system_prompt_leak", // Hidden prompt injection detection
  "consistency_check",  // Anti-replay / token injection
];
```

Administrators can add or remove probes from the available set:

```typescript
const ALL_AVAILABLE_PROBES = [
  "connectivity",
  "model_echo",
  "response_shape",
  "count_tokens_match",
  "system_adherence",
  "stop_sequence",
  "max_tokens",
  "tool_use",
  "multi_turn",
  "streaming_shape",
  "error_shape",
  "self_identification",
  "reasoning_fingerprint",
  "multimodal",
  "document_input",
  "cache_behavior",
  "system_prompt_leak",
  "consistency_check",
  "header_fingerprint",
];
```

### Per-Provider Override

Each provider can override any global field. A `null` value means "inherit from global". Additional per-provider fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `skipPatrol` | boolean | `false` | Completely skip this provider from patrol |
| `expectedChannel` | enum | `null` | Expected channel type: `anthropic`, `subscription`, `cloud`, `proxy`, `reverse-proxy`. If set, verdict considers channel mismatch as additional penalty (score -10 for mismatch) |
| `customProbes` | string[] | `null` | Override probe set for this specific provider |
| `customCron` | string | `null` | Override schedule for this provider |

---

## Inspection Engine

### Quick Probe

Each probe is adapted from the claude-detector reference implementation:

```typescript
interface PatrolProbe {
  name: string;
  label: string;           // i18n key
  category: ProbeCategory;
  weight: number;          // Scoring weight (configurable per-probe)
  defaultEnabled: boolean;
  run(ctx: PatrolProbeContext): Promise<PatrolProbeResult>;
}

interface PatrolProbeContext {
  endpoint: string;    // Provider's base URL
  apiKey: string;      // Provider's API key
  model: string;       // Model to test (from provider config)
  timeout: number;     // From config
  signal: AbortSignal;
}

interface PatrolProbeResult {
  passed: boolean;
  score: number;    // 0.0 - 1.0
  detail: string;   // Human-readable explanation
  latencyMs: number;
}
```

**Scoring**: Weighted average of all enabled probes, normalized to 0-100. Each probe has a default weight (1-3) that can be overridden in config via a `probeWeights` JSON object mapping probe name to weight. Example: `{"connectivity": 3, "tool_use": 3, "model_echo": 2}`. Unspecified probes keep their default weight.

### Deep Fingerprint

Adapted from hlwy-ai-checker's algorithm:

```typescript
interface FingerprintRun {
  providerId: number;
  model: string;
  sampleCount: number;     // From config (50-500)
  distribution: number[];  // 355-element normalized array
  stats: FingerprintStats;
  matchResult: {
    baselineId: number;
    cosineSimilarity: number;
    jsDivergence: number;
    overallScore: number;   // cos * exp(-jsDiv)
  } | null;
}

interface FingerprintStats {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  uniqueCount: number;
  validSamples: number;
  errorCount: number;
}
```

**Algorithm**:
1. Send `sampleCount` requests asking model to pick a random number 1-355
2. Build frequency distribution
3. Compare against stored baseline via cosine similarity + JS divergence
4. `overallScore = cosineSimilarity * exp(-jsDivergence)`
5. Score below `fingerprintMatchThreshold` = counterfeit verdict

---

## Verdict & Action System

### Verdict Determination

```typescript
type PatrolVerdict = "pass" | "warning" | "critical" | "counterfeit";

function determineVerdict(
  probeScore: number,
  fingerprintScore: number | null,
  config: PatrolConfig,
): PatrolVerdict {
  // Fingerprint mismatch takes highest priority
  if (fingerprintScore !== null && fingerprintScore < config.fingerprintMatchThreshold) {
    return "counterfeit";
  }
  // Score ranges: [0, thresholdCritical) = critical, [thresholdCritical, thresholdPass) = warning, [thresholdPass, 100] = pass
  if (probeScore < config.thresholdCritical) return "critical";
  if (probeScore < config.thresholdPass) return "warning";
  return "pass";
}
```

### Action Execution

Each verdict level maps to a configurable action:

| Verdict | Default Action | Description |
|---------|---------------|-------------|
| `pass` | `none` | Record result, update consecutive pass counter |
| `warning` | `circuit_open` | Trigger circuit breaker open (auto-recoverable) |
| `critical` | `disable` | Set `isEnabled=false` + record reason |
| `counterfeit` | `disable` | Set `isEnabled=false` + mark `patrolDisabledReason` |

Actions are configurable per verdict level to any of: `none`, `circuit_open`, `disable`, `notify_only`.

### Auto-Recovery

When `autoRecoverEnabled` is true:
1. Each patrol pass increments `consecutivePassCount` for that provider
2. When count reaches `autoRecoverPasses`, the system:
   - Re-enables the provider (`isEnabled=true`, clear `patrolDisabledReason`)
   - Or closes the circuit breaker
   - Sends a recovery notification
3. Any failure resets `consecutivePassCount` to 0

Providers disabled with verdict `counterfeit` do NOT auto-recover (require manual intervention) unless the admin enables `autoRecoverCounterfeit` in config.

---

## Data Model

### New Tables

```sql
-- patrol_configs: global + per-provider configuration
CREATE TABLE patrol_configs (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
  -- NULL provider_id = global config (exactly one row with NULL)
  
  enabled BOOLEAN,
  quick_probe_enabled BOOLEAN,
  quick_probe_cron VARCHAR(100),
  quick_probe_timeout_ms INTEGER,
  quick_probe_probes JSONB,           -- string[]
  deep_fingerprint_enabled BOOLEAN,
  deep_fingerprint_cron VARCHAR(100),
  deep_fingerprint_samples INTEGER,
  deep_fingerprint_timeout_ms INTEGER,
  
  threshold_pass INTEGER,
  threshold_warning INTEGER,
  threshold_critical INTEGER,
  fingerprint_match_threshold NUMERIC(4,3),
  
  action_on_warning VARCHAR(20),
  action_on_critical VARCHAR(20),
  action_on_counterfeit VARCHAR(20),
  
  auto_recover_enabled BOOLEAN,
  auto_recover_passes INTEGER,
  auto_recover_counterfeit BOOLEAN DEFAULT false,
  
  notify_on_warning BOOLEAN,
  notify_on_critical BOOLEAN,
  notify_on_counterfeit BOOLEAN,
  notify_on_recovery BOOLEAN,
  
  concurrency_limit INTEGER,
  retry_attempts INTEGER,
  cooldown_minutes INTEGER,
  probe_weights JSONB,                    -- { "probe_name": weight } overrides
  
  skip_patrol BOOLEAN DEFAULT false,
  expected_channel VARCHAR(20),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(provider_id)  -- at most one override per provider
);

-- patrol_results: inspection history
CREATE TABLE patrol_results (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  inspection_type VARCHAR(20) NOT NULL,  -- 'quick_probe' | 'deep_fingerprint'
  score INTEGER NOT NULL,                -- 0-100
  verdict VARCHAR(20) NOT NULL,          -- 'pass' | 'warning' | 'critical' | 'counterfeit'
  probe_details JSONB NOT NULL,          -- per-probe results
  fingerprint_details JSONB,             -- fingerprint comparison if applicable
  action_taken VARCHAR(30),              -- 'none' | 'circuit_open' | 'disabled' | 'recovered'
  latency_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- patrol_baselines: fingerprint calibration data
CREATE TABLE patrol_baselines (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR(100) NOT NULL,
  label VARCHAR(200),                    -- User-friendly name
  provider_type VARCHAR(20) NOT NULL,
  sample_count INTEGER NOT NULL,
  distribution JSONB NOT NULL,           -- number[355]
  stats JSONB NOT NULL,                  -- { mean, median, stdDev, min, max, uniqueCount }
  calibrated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  calibrated_by VARCHAR(100),
  notes TEXT,
  UNIQUE(model_name, provider_type)
);

-- patrol_provider_state: runtime state per provider
CREATE TABLE patrol_provider_state (
  provider_id INTEGER PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  consecutive_pass_count INTEGER DEFAULT 0,
  last_verdict VARCHAR(20),
  last_score INTEGER,
  last_inspected_at TIMESTAMP WITH TIME ZONE,
  patrol_disabled_reason TEXT,           -- Set when patrol disables the provider
  patrol_disabled_at TIMESTAMP WITH TIME ZONE
);
```

### Indexes

```sql
CREATE INDEX idx_patrol_results_provider_time ON patrol_results(provider_id, created_at DESC);
CREATE INDEX idx_patrol_results_verdict ON patrol_results(verdict, created_at DESC);
CREATE INDEX idx_patrol_configs_provider ON patrol_configs(provider_id);
```

---

## Backend Module Structure

```
src/lib/patrol/
├── index.ts                  -- Public API: start(), stop(), getStatus()
├── types.ts                  -- All type definitions
├── config.ts                 -- Config resolution (global + per-provider merge)
├── scheduler.ts              -- Bull queue registration, distributed lock
├── probes/
│   ├── index.ts              -- Probe registry, dynamic selection
│   ├── base.ts               -- Shared helpers (call, readJson, etc.)
│   ├── connectivity.ts
│   ├── model-echo.ts
│   ├── response-shape.ts
│   ├── tool-use.ts
│   ├── streaming-shape.ts
│   ├── system-prompt-leak.ts
│   ├── consistency-check.ts
│   ├── self-identification.ts
│   ├── reasoning-fingerprint.ts
│   ├── multimodal.ts
│   ├── document-input.ts
│   ├── cache-behavior.ts
│   ├── header-fingerprint.ts
│   ├── stop-sequence.ts
│   ├── max-tokens.ts
│   ├── multi-turn.ts
│   ├── error-shape.ts
│   ├── system-adherence.ts
│   └── count-tokens-match.ts
├── fingerprint/
│   ├── index.ts              -- Orchestrate fingerprint run
│   ├── sampler.ts            -- API sampling logic
│   ├── analyzer.ts           -- Distribution calculation + similarity
│   └── baseline.ts           -- Baseline CRUD
├── evaluator.ts              -- Verdict determination
├── actions.ts                -- Execute remediation actions
└── notifier.ts               -- Patrol-specific notification formatting
```

### Repository Layer

```
src/repository/
├── patrol-configs.ts         -- Config CRUD
├── patrol-results.ts         -- Results CRUD + query (pagination, filtering)
├── patrol-baselines.ts       -- Baselines CRUD
└── patrol-state.ts           -- Provider state tracking
```

---

## REST API Endpoints

All under `/api/v1/patrol/`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Overview: per-provider latest verdict, score, lastInspectedAt |
| `GET` | `/results` | Paginated history with filters (providerId, type, verdict, dateRange) |
| `GET` | `/results/:id` | Single inspection detail |
| `POST` | `/trigger` | Manual trigger. Body: `{ providerId?: number, type?: "quick_probe" \| "deep_fingerprint" \| "all" }` |
| `GET` | `/config` | Get resolved config (global + all overrides) |
| `PUT` | `/config/global` | Update global config |
| `PUT` | `/config/provider/:id` | Set/update per-provider override |
| `DELETE` | `/config/provider/:id` | Remove per-provider override (revert to global) |
| `GET` | `/baselines` | List all calibration baselines |
| `POST` | `/baselines/calibrate` | Trigger calibration. Body: `{ model, providerType, endpoint, apiKey, sampleCount?, label? }` |
| `DELETE` | `/baselines/:id` | Delete a baseline |
| `POST` | `/recover/:providerId` | Manually recover a patrol-disabled provider |
| `GET` | `/probes` | List all available probes with metadata |

---

## Frontend Dashboard

### Page: `/dashboard/patrol` (Patrol Overview)

**Top Stats Row:**
- Total providers under patrol
- Passing / Warning / Critical / Disabled counts
- Next scheduled run countdown

**Provider Table:**
- Columns: Provider Name, Type, Last Score (with color badge), Verdict, Last Checked, Consecutive Passes, Actions
- Actions column: [Trigger Now] [View History] [Configure] [Recover] (contextual)
- Filterable by: verdict, provider type, provider group
- Sortable by: score, last checked time, name

**Trend Chart:**
- Line chart showing scores over time for selected providers (last 24h / 7d / 30d toggle)
- Clickable points open the detail view

### Page: `/dashboard/patrol/config` (Configuration)

**Global Settings Card:**
- Toggle switches: system enabled, quick probe enabled, deep fingerprint enabled
- Cron expression inputs with human-readable preview (e.g., "Every hour at :00")
- Threshold sliders (pass/warning/critical) with visual indicator
- Action dropdowns per severity level
- Auto-recovery toggle + passes count
- Notification toggles per event type
- Concurrency limit, retry attempts, cooldown minutes
- Probe selector: checkboxes for all 19 probes with descriptions

**Per-Provider Overrides Table:**
- List of providers with custom configs
- Inline editing or modal for each
- "Reset to global" button per provider

### Page: `/dashboard/patrol/baselines` (Fingerprint Baselines)

**Baseline List:**
- Model name, provider type, sample count, calibrated date, calibrated by
- Distribution preview (mini sparkline chart)
- Actions: [View Details] [Recalibrate] [Delete]

**Calibration Form:**
- Model selector, provider type, endpoint URL, API key, sample count slider
- Start calibration button with progress indicator
- Live progress: samples collected / errors / estimated time remaining

### Page: `/dashboard/patrol/results/:id` (Inspection Detail)

**Summary Card:**
- Provider name, inspection type, overall score, verdict badge, timestamp, action taken

**Probe Results Grid (for quick probe):**
- Card per probe: name, passed/failed icon, score bar, detail text, latency

**Fingerprint Comparison (for deep fingerprint):**
- Side-by-side distribution bar charts (baseline vs measured)
- Similarity metrics: cosine, JS divergence, overall score
- Statistical comparison: mean, median, stdDev differences

---

## Notification Integration

### New Notification Type

Add `patrol_alert` to the existing notification type enum in the schema.

### Notification Bindings

Patrol alerts use the existing `notification_target_bindings` table. Admins bind `patrol_alert` to their preferred webhook targets (Feishu, DingTalk, Telegram, WeChat, custom).

### Message Templates

Templates are structured messages adapted per platform:

**Warning:**
```
[Patrol Warning] Provider "{name}" scored {score}/100
Verdict: {verdict}
Failed probes: {failedProbes}
Action: Circuit breaker opened (auto-recoverable)
Time: {timestamp}
```

**Critical:**
```
[Patrol Critical] Provider "{name}" scored {score}/100
Verdict: {verdict}
Failed probes: {failedProbes}
Action: Provider disabled
Time: {timestamp}
Dashboard: {dashboardUrl}
```

**Counterfeit:**
```
[Counterfeit Detected] Provider "{name}" - Model substitution suspected
Fingerprint similarity: {score}
Expected model: {model}
Action: Provider permanently disabled
Time: {timestamp}
Dashboard: {dashboardUrl}
MANUAL REVIEW REQUIRED
```

**Recovery:**
```
[Patrol Recovery] Provider "{name}" has recovered
Consecutive passes: {count}
Current score: {score}/100
Action: Re-enabled
Time: {timestamp}
```

### Deduplication

Reuse existing Redis-based cooldown (configurable `cooldownMinutes`). Same provider + same verdict level = suppressed within cooldown window.

---

## Scheduling & Distributed Execution

### Redis Distributed Lock

```typescript
// Only one instance executes patrol at a time
const LOCK_KEY = "cch:patrol:scheduler:lock";
const LOCK_TTL_MS = 60_000; // 1 minute lock, renewed during execution

async function acquirePatrolLock(): Promise<boolean> {
  const result = await redis.set(LOCK_KEY, instanceId, "PX", LOCK_TTL_MS, "NX");
  return result === "OK";
}
```

### Bull Queue Jobs

Two repeatable jobs registered on application startup:

```typescript
// Quick probe job
patrolQueue.add("quick-probe", {}, {
  repeat: { cron: config.quickProbeCron },
  jobId: "patrol-quick-probe",
});

// Deep fingerprint job
patrolQueue.add("deep-fingerprint", {}, {
  repeat: { cron: config.deepFingerprintCron },
  jobId: "patrol-deep-fingerprint",
});
```

When config changes, remove old repeatable jobs and re-register with new cron expressions.

### Execution Flow

1. Bull fires the job
2. Worker acquires distributed lock
3. Load all providers eligible for patrol:
   - `isEnabled=true` AND `skipPatrol=false` (normal active providers)
   - OR `isEnabled=false` AND `patrol_disabled_reason IS NOT NULL` AND `autoRecoverEnabled=true` (patrol-disabled providers needing recovery checks)
4. Run inspections in batches of `concurrencyLimit`
5. For each provider: resolve config (merge global + override), select probes, execute, evaluate, act
6. Release lock

---

## Edge Cases & Safety

1. **API key exposure**: Provider API keys are already stored encrypted in DB; patrol reads them via the same secure path
2. **Cost control**: Quick probe ~280 tokens/provider/run; fingerprint ~1000 tokens. At 50 providers hourly = ~14k tokens/hour (~$0.05/hour)
3. **Timeout handling**: Each probe has individual timeout; overall run has a global timeout. Timeout = probe scored as 0
4. **Network failures**: Distinguished from genuine failures. A network timeout gets `retryAttempts` retries before counting as failure
5. **Cold start**: On first deployment, no baselines exist. Deep fingerprint gracefully skips comparison and just records the distribution (admin must calibrate first)
6. **Provider with no API key**: Some providers may not have testable credentials (e.g., credential-forwarding types). These are auto-skipped with `skipPatrol=true`
7. **Race with circuit breaker**: If circuit breaker opens between patrol scheduling and execution, skip that provider (already degraded)

---

## Implementation Phases

### Phase 1: Core Engine + Quick Probe
- Database schema + migration
- Patrol config management (global CRUD)
- Quick probe engine (7 default probes)
- Evaluator + action system
- Scheduler with Redis lock
- Integration with existing circuit breaker and notification system
- Basic REST API endpoints

### Phase 2: Deep Fingerprint
- Baseline calibration flow
- Fingerprint sampler + analyzer
- Fingerprint comparison logic
- Calibration API endpoints

### Phase 3: Dashboard UI
- Patrol overview page with status table
- Configuration management UI
- Inspection history + detail views
- Baseline management + calibration UI
- Trend charts

### Phase 4: Polish
- Per-provider config overrides
- Auto-recovery logic
- i18n for all user-facing strings (5 languages)
- Unit tests (>80% coverage)
- OpenAPI documentation for new endpoints
