import { logger } from "@/lib/logger";
import type {
  PatrolConfig,
  PatrolProbeContext,
  PatrolProbeResult,
  PatrolProviderTarget,
  PatrolVerdict,
  PatrolActionType,
} from "./types";
import { PATROL_LOCK_KEY, PATROL_LOCK_TTL_MS } from "@/lib/constants/patrol.constants";

let _schedulerInterval: ReturnType<typeof setInterval> | null = null;
let _running = false;

export function startPatrolScheduler(): void {
  if (_schedulerInterval) return;

  const intervalMs = 60_000;
  _schedulerInterval = setInterval(() => {
    void runSchedulerTick();
  }, intervalMs);

  logger.info({ action: "patrol_scheduler_started", intervalMs });
}

export function stopPatrolScheduler(): void {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
    logger.info({ action: "patrol_scheduler_stopped" });
  }
}

export async function triggerPatrolRun(
  providerId?: number,
  inspectionType?: "quick_probe" | "deep_fingerprint"
): Promise<void> {
  const { resolveConfig } = await import("./config");
  const config = await resolveConfig(providerId ?? null);

  if (providerId) {
    await inspectProvider(providerId, config, inspectionType ?? "quick_probe");
  } else {
    await runFullPatrol(config, inspectionType ?? "quick_probe");
  }
}

async function runSchedulerTick(): Promise<void> {
  if (_running) return;

  const lock = await acquireLock();
  if (!lock) return;

  try {
    _running = true;
    const { resolveConfig } = await import("./config");
    const config = await resolveConfig(null);

    if (!config.enabled) return;

    const now = new Date();
    const shouldRunQuick = config.quickProbeEnabled && shouldRunCron(config.quickProbeCron, now);
    const shouldRunDeep =
      config.deepFingerprintEnabled && shouldRunCron(config.deepFingerprintCron, now);

    if (shouldRunQuick) {
      await runFullPatrol(config, "quick_probe");
    }
    if (shouldRunDeep) {
      await runFullPatrol(config, "deep_fingerprint");
    }
  } catch (error) {
    logger.error({
      action: "patrol_scheduler_tick_error",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    _running = false;
    await releaseLock();
  }
}

async function runFullPatrol(
  globalConfig: PatrolConfig,
  inspectionType: "quick_probe" | "deep_fingerprint"
): Promise<void> {
  const targets = await getEligibleProviders(globalConfig);
  if (targets.length === 0) return;

  logger.info({
    action: "patrol_run_start",
    inspectionType,
    providerCount: targets.length,
  });

  const batchSize = globalConfig.concurrencyLimit;
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map((target) => inspectProviderTarget(target, globalConfig, inspectionType))
    );
  }

  logger.info({ action: "patrol_run_complete", inspectionType });
}

async function inspectProvider(
  providerId: number,
  config: PatrolConfig,
  inspectionType: "quick_probe" | "deep_fingerprint"
): Promise<void> {
  const target = await getProviderTarget(providerId);
  if (!target) return;
  await inspectProviderTarget(target, config, inspectionType);
}

async function inspectProviderTarget(
  target: PatrolProviderTarget,
  globalConfig: PatrolConfig,
  inspectionType: "quick_probe" | "deep_fingerprint"
): Promise<void> {
  const { resolveConfig } = await import("./config");
  const config = await resolveConfig(target.id);

  if (config.skipPatrol) return;

  const timeoutMs =
    inspectionType === "quick_probe" ? config.quickProbeTimeoutMs : config.deepFingerprintTimeoutMs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const ctx: PatrolProbeContext = {
    endpoint: target.url,
    apiKey: target.key,
    model: target.model ?? "claude-haiku-4-5-20251001",
    providerType: target.providerType,
    timeout: timeoutMs,
    signal: controller.signal,
  };

  try {
    const start = performance.now();
    let probeResults: PatrolProbeResult[] = [];
    let fingerprintScore: number | null = null;

    if (inspectionType === "quick_probe") {
      probeResults = await runProbes(ctx, config);
    }

    if (inspectionType === "deep_fingerprint") {
      const { runFingerprint } = await import("./fingerprint");
      const fpResult = await runFingerprint(
        target.id,
        ctx,
        config.deepFingerprintSamples,
        controller.signal
      );
      fingerprintScore = fpResult.matchResult?.overallScore ?? null;
    }

    const { calculateScore, determineVerdict } = await import("./evaluator");
    const score = probeResults.length > 0 ? calculateScore(probeResults, config.probeWeights) : 85;
    const verdict = determineVerdict(score, fingerprintScore, config);

    const { executeAction } = await import("./actions");
    const actionTaken = await executeAction(target.id, verdict, config);

    await recordResult(target.id, inspectionType, score, verdict, probeResults, actionTaken, start);

    const { sendPatrolAlert, buildAlertData } = await import("./notifier");
    const alertData = buildAlertData(
      target.id,
      target.name,
      score,
      verdict,
      actionTaken,
      probeResults,
      inspectionType
    );
    await sendPatrolAlert(alertData, config);
  } catch (error) {
    logger.error({
      action: "patrol_inspect_error",
      providerId: target.id,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function runProbes(
  ctx: PatrolProbeContext,
  config: PatrolConfig
): Promise<PatrolProbeResult[]> {
  const { getProbeByName, runProbeWithRetry } = await import("./probes");
  const results: PatrolProbeResult[] = [];

  for (const probeName of config.quickProbeProbes) {
    const probe = getProbeByName(probeName);
    if (!probe) continue;
    const result = await runProbeWithRetry(probe, ctx, config.retryAttempts);
    results.push(result);
  }

  return results;
}

async function recordResult(
  providerId: number,
  inspectionType: "quick_probe" | "deep_fingerprint",
  score: number,
  verdict: PatrolVerdict,
  probeResults: PatrolProbeResult[],
  actionTaken: PatrolActionType,
  startTime: number
): Promise<void> {
  try {
    const { insertPatrolResult } = await import("@/repository/patrol-results");
    const { upsertProviderState } = await import("@/repository/patrol-state");
    const latencyMs = Math.round(performance.now() - startTime);

    await insertPatrolResult({
      providerId,
      inspectionType,
      score,
      verdict,
      probeDetails: probeResults,
      actionTaken,
      latencyMs,
    });

    await upsertProviderState(providerId, {
      lastVerdict: verdict,
      lastScore: score,
    });
  } catch (error) {
    logger.error({
      action: "patrol_record_error",
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getEligibleProviders(config: PatrolConfig): Promise<PatrolProviderTarget[]> {
  try {
    const { db } = await import("@/drizzle/db");
    const { providers } = await import("@/drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const rows = await db
      .select({
        id: providers.id,
        name: providers.name,
        url: providers.url,
        key: providers.key,
        providerType: providers.providerType,
      })
      .from(providers)
      .where(eq(providers.isEnabled, true));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      key: r.key,
      providerType: r.providerType,
    }));
  } catch (error) {
    logger.error({
      action: "patrol_get_providers_error",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function getProviderTarget(providerId: number): Promise<PatrolProviderTarget | null> {
  try {
    const { db } = await import("@/drizzle/db");
    const { providers } = await import("@/drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const [row] = await db
      .select({
        id: providers.id,
        name: providers.name,
        url: providers.url,
        key: providers.key,
        providerType: providers.providerType,
      })
      .from(providers)
      .where(eq(providers.id, providerId))
      .limit(1);

    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      key: row.key,
      providerType: row.providerType,
    };
  } catch {
    return null;
  }
}

function shouldRunCron(cronExpr: string, now: Date): boolean {
  const minute = now.getMinutes();
  const hour = now.getHours();
  const parts = cronExpr.split(" ");
  if (parts.length < 5) return false;

  const [cronMin, cronHour] = parts;
  const minuteMatch = matchCronField(cronMin, minute);
  const hourMatch = matchCronField(cronHour, hour);

  return minuteMatch && hourMatch;
}

function matchCronField(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return value % step === 0;
  }
  return parseInt(field, 10) === value;
}

async function acquireLock(): Promise<boolean> {
  try {
    const { getRedisClient } = await import("@/lib/redis/client");
    const redis = getRedisClient();
    if (!redis) return true;

    const result = await redis.set(PATROL_LOCK_KEY, "1", "PX", PATROL_LOCK_TTL_MS, "NX");
    return result === "OK";
  } catch {
    return true;
  }
}

async function releaseLock(): Promise<void> {
  try {
    const { getRedisClient } = await import("@/lib/redis/client");
    const redis = getRedisClient();
    if (redis) {
      await redis.del(PATROL_LOCK_KEY);
    }
  } catch {
    // non-fatal
  }
}
