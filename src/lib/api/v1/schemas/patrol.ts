import { z } from "@hono/zod-openapi";

export const PatrolVerdictSchema = z.enum(["pass", "warning", "critical", "counterfeit"]);
export const PatrolActionSchema = z.enum([
  "none",
  "circuit_open",
  "disable",
  "notify_only",
  "recovered",
]);
export const PatrolInspectionTypeSchema = z.enum(["quick_probe", "deep_fingerprint"]);

export const PatrolProbeResultSchema = z.object({
  name: z.string(),
  label: z.string(),
  category: z.string(),
  weight: z.number(),
  passed: z.boolean(),
  score: z.number(),
  detail: z.string(),
  latencyMs: z.number(),
});

export const PatrolResultSchema = z.object({
  id: z.number().int(),
  providerId: z.number().int(),
  inspectionType: PatrolInspectionTypeSchema,
  score: z.number().int(),
  verdict: PatrolVerdictSchema,
  probeDetails: z.array(PatrolProbeResultSchema),
  actionTaken: PatrolActionSchema.nullable(),
  latencyMs: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().nullable(),
});

export const PatrolConfigSchema = z.object({
  enabled: z.boolean().optional(),
  quickProbeEnabled: z.boolean().optional(),
  quickProbeCron: z.string().max(100).optional(),
  quickProbeTimeoutMs: z.number().int().positive().optional(),
  quickProbeProbes: z.array(z.string()).optional(),
  deepFingerprintEnabled: z.boolean().optional(),
  deepFingerprintCron: z.string().max(100).optional(),
  deepFingerprintSamples: z.number().int().positive().optional(),
  deepFingerprintTimeoutMs: z.number().int().positive().optional(),
  thresholdPass: z.number().int().min(0).max(100).optional(),
  thresholdWarning: z.number().int().min(0).max(100).optional(),
  thresholdCritical: z.number().int().min(0).max(100).optional(),
  fingerprintMatchThreshold: z.number().min(0).max(1).optional(),
  actionOnWarning: z.string().optional(),
  actionOnCritical: z.string().optional(),
  actionOnCounterfeit: z.string().optional(),
  autoRecoverEnabled: z.boolean().optional(),
  autoRecoverPasses: z.number().int().positive().optional(),
  autoRecoverCounterfeit: z.boolean().optional(),
  notifyOnWarning: z.boolean().optional(),
  notifyOnCritical: z.boolean().optional(),
  notifyOnCounterfeit: z.boolean().optional(),
  notifyOnRecovery: z.boolean().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
  retryAttempts: z.number().int().min(0).optional(),
  cooldownMinutes: z.number().int().positive().optional(),
  probeWeights: z.record(z.string(), z.number()).nullable().optional(),
  skipPatrol: z.boolean().optional(),
  expectedChannel: z.string().nullable().optional(),
});

export const PatrolBaselineSchema = z.object({
  id: z.number().int(),
  modelName: z.string(),
  label: z.string().nullable(),
  providerType: z.string(),
  sampleCount: z.number().int(),
  calibratedAt: z.string().nullable(),
  calibratedBy: z.string().nullable(),
  notes: z.string().nullable(),
});

export const PatrolStatusSchema = z.object({
  enabled: z.boolean(),
  providerCount: z.number().int(),
  lastRunAt: z.string().nullable(),
  recentResults: z.array(PatrolResultSchema),
});

export const PatrolTriggerRequestSchema = z.object({
  providerId: z.number().int().optional(),
  inspectionType: PatrolInspectionTypeSchema.optional(),
});

export const PatrolProbeInfoSchema = z.object({
  name: z.string(),
  label: z.string(),
  category: z.string(),
  defaultWeight: z.number(),
});
