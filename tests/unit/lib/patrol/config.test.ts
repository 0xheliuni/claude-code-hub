import { describe, expect, it } from "vitest";
import { mergeConfig, getDefaultConfig, dbRowToConfigPartial } from "@/lib/patrol/config";
import type { PatrolConfig } from "@/lib/patrol/types";

describe("patrol config", () => {
  describe("mergeConfig", () => {
    it("returns base when override is null", () => {
      const base = getDefaultConfig();
      const result = mergeConfig(base, null);
      expect(result).toEqual(base);
    });

    it("overrides non-null fields", () => {
      const base = getDefaultConfig();
      const result = mergeConfig(base, {
        quickProbeCron: "*/30 * * * *",
        thresholdPass: 90,
      } as Partial<Record<keyof PatrolConfig, unknown>>);
      expect(result.quickProbeCron).toBe("*/30 * * * *");
      expect(result.thresholdPass).toBe(90);
      expect(result.thresholdCritical).toBe(base.thresholdCritical);
    });

    it("does not override with null values", () => {
      const base = getDefaultConfig();
      const result = mergeConfig(base, {
        quickProbeCron: null,
        thresholdPass: undefined,
      } as unknown as Partial<Record<keyof PatrolConfig, unknown>>);
      expect(result.quickProbeCron).toBe(base.quickProbeCron);
      expect(result.thresholdPass).toBe(base.thresholdPass);
    });
  });

  describe("getDefaultConfig", () => {
    it("returns a valid config with all fields", () => {
      const config = getDefaultConfig();
      expect(config.enabled).toBe(true);
      expect(config.quickProbeProbes.length).toBeGreaterThan(0);
      expect(config.thresholdPass).toBeGreaterThan(config.thresholdCritical);
    });
  });

  describe("dbRowToConfigPartial", () => {
    it("returns null for null input", () => {
      expect(dbRowToConfigPartial(null)).toBeNull();
    });

    it("extracts non-null fields from row", () => {
      const row = {
        enabled: true,
        quickProbeCron: "*/15 * * * *",
        thresholdPass: 90,
        fingerprintMatchThreshold: "0.500",
        quickProbeProbes: ["connectivity", "model_echo"],
      };
      const result = dbRowToConfigPartial(row as Record<string, unknown>);
      expect(result).not.toBeNull();
      expect(result!.enabled).toBe(true);
      expect(result!.quickProbeCron).toBe("*/15 * * * *");
      expect(result!.thresholdPass).toBe(90);
      expect(result!.fingerprintMatchThreshold).toBe(0.5);
      expect(result!.quickProbeProbes).toEqual(["connectivity", "model_echo"]);
    });

    it("returns null for empty object (all null values)", () => {
      const row = {
        enabled: null,
        quickProbeCron: null,
        thresholdPass: null,
      };
      const result = dbRowToConfigPartial(row as Record<string, unknown>);
      expect(result).toBeNull();
    });
  });
});
