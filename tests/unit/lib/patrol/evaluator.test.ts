import { describe, expect, it } from "vitest";
import { calculateScore, determineVerdict } from "@/lib/patrol/evaluator";
import { getDefaultConfig } from "@/lib/patrol/config";
import type { PatrolProbeResult } from "@/lib/patrol/types";

function makeResult(overrides: Partial<PatrolProbeResult> = {}): PatrolProbeResult {
  return {
    name: "test_probe",
    label: "Test Probe",
    category: "structural",
    weight: 1.0,
    passed: true,
    score: 1,
    detail: "OK",
    latencyMs: 100,
    ...overrides,
  };
}

describe("patrol evaluator", () => {
  describe("calculateScore", () => {
    it("returns 0 for empty results", () => {
      expect(calculateScore([], null)).toBe(0);
    });

    it("returns 100 when all probes pass with score 1", () => {
      const results = [
        makeResult({ name: "a", score: 1, weight: 1 }),
        makeResult({ name: "b", score: 1, weight: 1 }),
      ];
      expect(calculateScore(results, null)).toBe(100);
    });

    it("returns 50 when half probes fail", () => {
      const results = [
        makeResult({ name: "a", score: 1, weight: 1 }),
        makeResult({ name: "b", score: 0, weight: 1 }),
      ];
      expect(calculateScore(results, null)).toBe(50);
    });

    it("applies custom probe weights", () => {
      const results = [
        makeResult({ name: "a", score: 1, weight: 1 }),
        makeResult({ name: "b", score: 0, weight: 1 }),
      ];
      const weights = { a: 3, b: 1 };
      expect(calculateScore(results, weights)).toBe(75);
    });

    it("handles partial scores", () => {
      const results = [
        makeResult({ name: "a", score: 0.5, weight: 1 }),
        makeResult({ name: "b", score: 0.5, weight: 1 }),
      ];
      expect(calculateScore(results, null)).toBe(50);
    });
  });

  describe("determineVerdict", () => {
    const config = getDefaultConfig();

    it("returns pass when score >= thresholdPass", () => {
      expect(determineVerdict(85, null, config)).toBe("pass");
      expect(determineVerdict(100, null, config)).toBe("pass");
    });

    it("returns warning when score between critical and pass", () => {
      expect(determineVerdict(50, null, config)).toBe("warning");
      expect(determineVerdict(84, null, config)).toBe("warning");
    });

    it("returns critical when score < thresholdCritical", () => {
      expect(determineVerdict(29, null, config)).toBe("critical");
      expect(determineVerdict(0, null, config)).toBe("critical");
    });

    it("returns counterfeit when fingerprint below threshold", () => {
      expect(determineVerdict(90, 0.2, config)).toBe("counterfeit");
      expect(determineVerdict(90, 0.29, config)).toBe("counterfeit");
    });

    it("fingerprint check takes priority over score", () => {
      expect(determineVerdict(100, 0.1, config)).toBe("counterfeit");
    });

    it("fingerprint above threshold does not affect verdict", () => {
      expect(determineVerdict(90, 0.5, config)).toBe("pass");
      expect(determineVerdict(50, 0.5, config)).toBe("warning");
    });
  });
});
