import type { PatrolActionType } from "@/lib/patrol/types";

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
  actionOnWarning: "circuit_open" as PatrolActionType,
  actionOnCritical: "disable" as PatrolActionType,
  actionOnCounterfeit: "disable" as PatrolActionType,
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
