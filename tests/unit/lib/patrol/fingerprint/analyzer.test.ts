import { describe, expect, it } from "vitest";
import {
  calculateDistribution,
  calculateStats,
  calculateSimilarity,
} from "@/lib/patrol/fingerprint/analyzer";

describe("fingerprint analyzer", () => {
  describe("calculateDistribution", () => {
    it("returns all zeros for empty input", () => {
      const dist = calculateDistribution([]);
      expect(dist.length).toBe(355);
      expect(dist.every((v) => v === 0)).toBe(true);
    });

    it("creates normalized frequency distribution", () => {
      const numbers = [1, 1, 2, 3];
      const dist = calculateDistribution(numbers);
      expect(dist[0]).toBeCloseTo(0.5); // 1 appears 2/4 times
      expect(dist[1]).toBeCloseTo(0.25); // 2 appears 1/4 times
      expect(dist[2]).toBeCloseTo(0.25); // 3 appears 1/4 times
      expect(dist[3]).toBe(0); // 4 never appears
    });

    it("ignores out-of-range values", () => {
      const numbers = [0, 356, -1, 500];
      const dist = calculateDistribution(numbers);
      expect(dist.every((v) => v === 0)).toBe(true);
    });

    it("handles single value", () => {
      const numbers = [178];
      const dist = calculateDistribution(numbers);
      expect(dist[177]).toBe(1);
      expect(dist.filter((v) => v > 0).length).toBe(1);
    });
  });

  describe("calculateStats", () => {
    it("returns zeros for empty input", () => {
      const stats = calculateStats([]);
      expect(stats.mean).toBe(0);
      expect(stats.median).toBe(0);
      expect(stats.validSamples).toBe(0);
    });

    it("calculates correct statistics", () => {
      const numbers = [1, 2, 3, 4, 5];
      const stats = calculateStats(numbers);
      expect(stats.mean).toBe(3);
      expect(stats.median).toBe(3);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(5);
      expect(stats.uniqueCount).toBe(5);
      expect(stats.validSamples).toBe(5);
      expect(stats.stdDev).toBeCloseTo(Math.sqrt(2), 5);
    });

    it("handles even-length array for median", () => {
      const numbers = [1, 2, 3, 4];
      const stats = calculateStats(numbers);
      expect(stats.median).toBe(2.5);
    });
  });

  describe("calculateSimilarity", () => {
    it("returns perfect similarity for identical distributions", () => {
      const dist = new Array(355).fill(1 / 355);
      const result = calculateSimilarity(dist, dist);
      expect(result.cosineSimilarity).toBeCloseTo(1, 5);
      expect(result.jsDivergence).toBeCloseTo(0, 5);
      expect(result.overallScore).toBeCloseTo(1, 5);
    });

    it("returns low similarity for completely different distributions", () => {
      const dist1 = new Array(355).fill(0);
      dist1[0] = 1;
      const dist2 = new Array(355).fill(0);
      dist2[354] = 1;
      const result = calculateSimilarity(dist1, dist2);
      expect(result.cosineSimilarity).toBe(0);
      expect(result.overallScore).toBe(0);
    });

    it("handles zero distributions", () => {
      const dist1 = new Array(355).fill(0);
      const dist2 = new Array(355).fill(0);
      const result = calculateSimilarity(dist1, dist2);
      expect(result.cosineSimilarity).toBe(0);
      expect(result.overallScore).toBe(0);
    });

    it("returns 0 for mismatched lengths", () => {
      const result = calculateSimilarity([1, 0], [1, 0, 0]);
      expect(result.overallScore).toBe(0);
    });

    it("partially overlapping distributions give intermediate score", () => {
      const dist1 = new Array(355).fill(0);
      const dist2 = new Array(355).fill(0);
      for (let i = 0; i < 100; i++) {
        dist1[i] = 1 / 100;
        dist2[i] = 0.5 / 100;
        dist2[i + 100] = 0.5 / 100;
      }
      const result = calculateSimilarity(dist1, dist2);
      expect(result.cosineSimilarity).toBeGreaterThan(0.5);
      expect(result.cosineSimilarity).toBeLessThan(1);
      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.overallScore).toBeLessThan(1);
    });
  });
});
