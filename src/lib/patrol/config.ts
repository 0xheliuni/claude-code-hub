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

export function getDefaultConfig(): PatrolConfig {
  return {
    enabled: DEFAULT_PATROL_CONFIG.enabled,
    quickProbeEnabled: DEFAULT_PATROL_CONFIG.quickProbeEnabled,
    quickProbeCron: DEFAULT_PATROL_CONFIG.quickProbeCron,
    quickProbeTimeoutMs: DEFAULT_PATROL_CONFIG.quickProbeTimeoutMs,
    quickProbeProbes: [...DEFAULT_PATROL_CONFIG.quickProbeProbes],
    deepFingerprintEnabled: DEFAULT_PATROL_CONFIG.deepFingerprintEnabled,
    deepFingerprintCron: DEFAULT_PATROL_CONFIG.deepFingerprintCron,
    deepFingerprintSamples: DEFAULT_PATROL_CONFIG.deepFingerprintSamples,
    deepFingerprintTimeoutMs: DEFAULT_PATROL_CONFIG.deepFingerprintTimeoutMs,
    thresholdPass: DEFAULT_PATROL_CONFIG.thresholdPass,
    thresholdWarning: DEFAULT_PATROL_CONFIG.thresholdWarning,
    thresholdCritical: DEFAULT_PATROL_CONFIG.thresholdCritical,
    fingerprintMatchThreshold: DEFAULT_PATROL_CONFIG.fingerprintMatchThreshold,
    actionOnWarning: DEFAULT_PATROL_CONFIG.actionOnWarning,
    actionOnCritical: DEFAULT_PATROL_CONFIG.actionOnCritical,
    actionOnCounterfeit: DEFAULT_PATROL_CONFIG.actionOnCounterfeit,
    autoRecoverEnabled: DEFAULT_PATROL_CONFIG.autoRecoverEnabled,
    autoRecoverPasses: DEFAULT_PATROL_CONFIG.autoRecoverPasses,
    autoRecoverCounterfeit: DEFAULT_PATROL_CONFIG.autoRecoverCounterfeit,
    notifyOnWarning: DEFAULT_PATROL_CONFIG.notifyOnWarning,
    notifyOnCritical: DEFAULT_PATROL_CONFIG.notifyOnCritical,
    notifyOnCounterfeit: DEFAULT_PATROL_CONFIG.notifyOnCounterfeit,
    notifyOnRecovery: DEFAULT_PATROL_CONFIG.notifyOnRecovery,
    concurrencyLimit: DEFAULT_PATROL_CONFIG.concurrencyLimit,
    retryAttempts: DEFAULT_PATROL_CONFIG.retryAttempts,
    cooldownMinutes: DEFAULT_PATROL_CONFIG.cooldownMinutes,
    probeWeights: DEFAULT_PATROL_CONFIG.probeWeights,
    skipPatrol: DEFAULT_PATROL_CONFIG.skipPatrol,
    expectedChannel: DEFAULT_PATROL_CONFIG.expectedChannel,
  };
}

export function dbRowToConfigPartial(
  row: Record<string, unknown> | null
): Partial<PatrolConfig> | null {
  if (!row) return null;
  const partial: Partial<PatrolConfig> = {};

  const stringFields: (keyof PatrolConfig)[] = [
    "quickProbeCron",
    "deepFingerprintCron",
    "expectedChannel",
  ];
  const numberFields: (keyof PatrolConfig)[] = [
    "quickProbeTimeoutMs",
    "deepFingerprintSamples",
    "deepFingerprintTimeoutMs",
    "thresholdPass",
    "thresholdWarning",
    "thresholdCritical",
    "autoRecoverPasses",
    "concurrencyLimit",
    "retryAttempts",
    "cooldownMinutes",
  ];
  const booleanFields: (keyof PatrolConfig)[] = [
    "enabled",
    "quickProbeEnabled",
    "deepFingerprintEnabled",
    "autoRecoverEnabled",
    "autoRecoverCounterfeit",
    "notifyOnWarning",
    "notifyOnCritical",
    "notifyOnCounterfeit",
    "notifyOnRecovery",
    "skipPatrol",
  ];
  const actionFields: (keyof PatrolConfig)[] = [
    "actionOnWarning",
    "actionOnCritical",
    "actionOnCounterfeit",
  ];

  for (const f of stringFields) {
    if (row[f] !== null && row[f] !== undefined) {
      (partial as Record<string, unknown>)[f] = row[f];
    }
  }
  for (const f of numberFields) {
    if (row[f] !== null && row[f] !== undefined) {
      (partial as Record<string, unknown>)[f] = Number(row[f]);
    }
  }
  for (const f of booleanFields) {
    if (row[f] !== null && row[f] !== undefined) {
      (partial as Record<string, unknown>)[f] = row[f];
    }
  }
  for (const f of actionFields) {
    if (row[f] !== null && row[f] !== undefined) {
      (partial as Record<string, unknown>)[f] = row[f] as PatrolActionType;
    }
  }

  if (row.fingerprintMatchThreshold !== null && row.fingerprintMatchThreshold !== undefined) {
    partial.fingerprintMatchThreshold = Number(row.fingerprintMatchThreshold);
  }
  if (row.quickProbeProbes !== null && row.quickProbeProbes !== undefined) {
    partial.quickProbeProbes = row.quickProbeProbes as string[];
  }
  if (row.probeWeights !== null && row.probeWeights !== undefined) {
    partial.probeWeights = row.probeWeights as Record<string, number>;
  }

  return Object.keys(partial).length > 0 ? partial : null;
}

export async function resolveConfig(providerId: number | null): Promise<PatrolConfig> {
  const { getGlobalPatrolConfig, getPatrolConfigByProvider } = await import(
    "@/repository/patrol-configs"
  );
  const base = getDefaultConfig();
  const globalRow = await getGlobalPatrolConfig();
  const globalMerged = mergeConfig(base, dbRowToConfigPartial(globalRow));
  if (providerId === null) return globalMerged;
  const providerRow = await getPatrolConfigByProvider(providerId);
  return mergeConfig(globalMerged, dbRowToConfigPartial(providerRow));
}
