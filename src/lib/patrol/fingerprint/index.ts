import type { PatrolProbeContext, FingerprintDetails } from "../types";
import { sampleProvider } from "./sampler";
import { calculateDistribution, calculateStats, calculateSimilarity } from "./analyzer";

export async function runFingerprint(
  providerId: number,
  ctx: PatrolProbeContext,
  sampleCount: number,
  signal: AbortSignal
): Promise<FingerprintDetails> {
  const { numbers, errorCount } = await sampleProvider(ctx, sampleCount, signal);
  const distribution = calculateDistribution(numbers);
  const stats = { ...calculateStats(numbers), errorCount };

  let matchResult = null;
  try {
    const { getBaselineByModel } = await import("@/repository/patrol-baselines");
    const baseline = await getBaselineByModel(ctx.model, ctx.providerType);
    if (baseline) {
      const similarity = calculateSimilarity(distribution, baseline.distribution as number[]);
      matchResult = {
        baselineId: baseline.id,
        baselineLabel: baseline.label ?? baseline.modelName,
        cosineSimilarity: similarity.cosineSimilarity,
        jsDivergence: similarity.jsDivergence,
        overallScore: similarity.overallScore,
      };
    }
  } catch {
    // baseline lookup failure is non-fatal
  }

  return {
    sampleCount: numbers.length,
    distribution,
    stats,
    matchResult,
  };
}

export { calculateDistribution, calculateStats, calculateSimilarity } from "./analyzer";
export { sampleProvider } from "./sampler";
