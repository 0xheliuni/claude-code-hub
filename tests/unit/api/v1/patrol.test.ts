import { describe, expect, test } from "vitest";
import {
  PatrolConfigSchema,
  PatrolResultSchema,
  PatrolStatusSchema,
  PatrolTriggerRequestSchema,
  PatrolVerdictSchema,
  PatrolActionSchema,
  PatrolInspectionTypeSchema,
  PatrolProbeInfoSchema,
  PatrolBaselineSchema,
} from "@/lib/api/v1/schemas/patrol";

describe("patrol API schemas", () => {
  test("PatrolVerdictSchema validates correct values", () => {
    expect(PatrolVerdictSchema.safeParse("pass").success).toBe(true);
    expect(PatrolVerdictSchema.safeParse("warning").success).toBe(true);
    expect(PatrolVerdictSchema.safeParse("critical").success).toBe(true);
    expect(PatrolVerdictSchema.safeParse("counterfeit").success).toBe(true);
    expect(PatrolVerdictSchema.safeParse("invalid").success).toBe(false);
  });

  test("PatrolActionSchema validates correct values", () => {
    expect(PatrolActionSchema.safeParse("none").success).toBe(true);
    expect(PatrolActionSchema.safeParse("circuit_open").success).toBe(true);
    expect(PatrolActionSchema.safeParse("disable").success).toBe(true);
    expect(PatrolActionSchema.safeParse("notify_only").success).toBe(true);
    expect(PatrolActionSchema.safeParse("recovered").success).toBe(true);
    expect(PatrolActionSchema.safeParse("explode").success).toBe(false);
  });

  test("PatrolInspectionTypeSchema validates", () => {
    expect(PatrolInspectionTypeSchema.safeParse("quick_probe").success).toBe(true);
    expect(PatrolInspectionTypeSchema.safeParse("deep_fingerprint").success).toBe(true);
    expect(PatrolInspectionTypeSchema.safeParse("other").success).toBe(false);
  });

  test("PatrolConfigSchema accepts partial config", () => {
    const result = PatrolConfigSchema.safeParse({
      enabled: true,
      thresholdPass: 80,
    });
    expect(result.success).toBe(true);
  });

  test("PatrolConfigSchema rejects invalid threshold", () => {
    const result = PatrolConfigSchema.safeParse({
      thresholdPass: 200,
    });
    expect(result.success).toBe(false);
  });

  test("PatrolConfigSchema accepts probeWeights as record", () => {
    const result = PatrolConfigSchema.safeParse({
      probeWeights: { connectivity: 1.5, model_echo: 0.8 },
    });
    expect(result.success).toBe(true);
  });

  test("PatrolTriggerRequestSchema accepts empty body", () => {
    const result = PatrolTriggerRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("PatrolTriggerRequestSchema accepts providerId and type", () => {
    const result = PatrolTriggerRequestSchema.safeParse({
      providerId: 5,
      inspectionType: "deep_fingerprint",
    });
    expect(result.success).toBe(true);
  });

  test("PatrolResultSchema validates full result", () => {
    const result = PatrolResultSchema.safeParse({
      id: 1,
      providerId: 2,
      inspectionType: "quick_probe",
      score: 95,
      verdict: "pass",
      probeDetails: [
        {
          name: "connectivity",
          label: "Connectivity",
          category: "network",
          weight: 1,
          passed: true,
          score: 1,
          detail: "OK",
          latencyMs: 100,
        },
      ],
      actionTaken: "none",
      latencyMs: 500,
      errorMessage: null,
      createdAt: "2026-07-22T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  test("PatrolStatusSchema validates status response", () => {
    const result = PatrolStatusSchema.safeParse({
      enabled: true,
      providerCount: 3,
      lastRunAt: "2026-07-22T00:00:00Z",
      recentResults: [],
    });
    expect(result.success).toBe(true);
  });

  test("PatrolProbeInfoSchema validates probe info", () => {
    const result = PatrolProbeInfoSchema.safeParse({
      name: "connectivity",
      label: "Connectivity",
      category: "network",
      defaultWeight: 1.0,
    });
    expect(result.success).toBe(true);
  });

  test("PatrolBaselineSchema validates baseline", () => {
    const result = PatrolBaselineSchema.safeParse({
      id: 1,
      modelName: "claude-haiku-4-5-20251001",
      label: "Default haiku",
      providerType: "claude",
      sampleCount: 50,
      calibratedAt: "2026-07-22T00:00:00Z",
      calibratedBy: "admin",
      notes: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("patrol router registration", () => {
  test("patrol routes are registered in root app", async () => {
    const { app } = await import("@/app/api/v1/_root/app");
    const routes = app.routes;
    const patrolPaths = routes.map((r) => r.path).filter((p) => p.includes("/patrol"));

    expect(patrolPaths.length).toBeGreaterThan(0);
    expect(patrolPaths).toContain("/api/v1/patrol/status");
    expect(patrolPaths).toContain("/api/v1/patrol/results");
    expect(patrolPaths).toContain("/api/v1/patrol/trigger");
    expect(patrolPaths).toContain("/api/v1/patrol/config/global");
    expect(patrolPaths).toContain("/api/v1/patrol/baselines");
    expect(patrolPaths).toContain("/api/v1/patrol/probes");
    expect(patrolPaths).toContain("/api/v1/patrol/recover/:providerId");
  });
});
