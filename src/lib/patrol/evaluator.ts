import type { PatrolConfig, PatrolProbeResult, PatrolVerdict } from "./types";

export function calculateScore(
  results: PatrolProbeResult[],
  probeWeights: Record<string, number> | null
): number {
  if (results.length === 0) return 0;

  let weightTotal = 0;
  let weightedSum = 0;
  for (const r of results) {
    const weight = probeWeights?.[r.name] ?? r.weight;
    weightTotal += weight;
    weightedSum += r.score * weight;
  }
  if (weightTotal === 0) return 0;
  return Math.round((weightedSum / weightTotal) * 100);
}

export function determineVerdict(
  probeScore: number,
  fingerprintScore: number | null,
  config: PatrolConfig
): PatrolVerdict {
  if (
    fingerprintScore !== null &&
    fingerprintScore < config.fingerprintMatchThreshold
  ) {
    return "counterfeit";
  }
  if (probeScore < config.thresholdCritical) return "critical";
  if (probeScore < config.thresholdPass) return "warning";
  return "pass";
}
