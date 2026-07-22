import { describe, expect, it } from "vitest";
import {
  DEFAULT_PATROL_CONFIG,
  ALL_PATROL_PROBES,
} from "@/lib/constants/patrol.constants";

describe("patrol constants", () => {
  it("default config has all required fields", () => {
    expect(DEFAULT_PATROL_CONFIG.quickProbeProbes.length).toBeGreaterThan(0);
    expect(DEFAULT_PATROL_CONFIG.thresholdPass).toBeGreaterThan(
      DEFAULT_PATROL_CONFIG.thresholdCritical
    );
    expect(DEFAULT_PATROL_CONFIG.thresholdWarning).toBeLessThan(
      DEFAULT_PATROL_CONFIG.thresholdPass
    );
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

  it("threshold ordering is valid: critical < warning < pass", () => {
    expect(DEFAULT_PATROL_CONFIG.thresholdCritical).toBeLessThan(
      DEFAULT_PATROL_CONFIG.thresholdWarning
    );
    expect(DEFAULT_PATROL_CONFIG.thresholdWarning).toBeLessThan(
      DEFAULT_PATROL_CONFIG.thresholdPass
    );
  });
});
