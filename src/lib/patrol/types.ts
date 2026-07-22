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
export type PatrolActionType =
  | "none"
  | "circuit_open"
  | "disable"
  | "notify_only"
  | "recovered";

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
  run(
    ctx: PatrolProbeContext
  ): Promise<Omit<PatrolProbeResult, "name" | "label" | "category" | "weight">>;
}
