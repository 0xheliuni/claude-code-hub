import type { FingerprintStats } from "../types";

const DISTRIBUTION_SIZE = 355;

export function calculateDistribution(numbers: number[]): number[] {
  const counts = new Array(DISTRIBUTION_SIZE).fill(0);
  for (const n of numbers) {
    if (n >= 1 && n <= DISTRIBUTION_SIZE) {
      counts[n - 1]++;
    }
  }

  const total = numbers.length;
  if (total === 0) return counts;

  return counts.map((c) => c / total);
}

export function calculateStats(numbers: number[]): FingerprintStats {
  if (numbers.length === 0) {
    return {
      mean: 0,
      median: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      uniqueCount: 0,
      validSamples: 0,
      errorCount: 0,
    };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const uniqueCount = new Set(sorted).size;

  return {
    mean,
    median,
    stdDev,
    min: sorted[0],
    max: sorted[n - 1],
    uniqueCount,
    validSamples: n,
    errorCount: 0,
  };
}

export interface SimilarityResult {
  cosineSimilarity: number;
  jsDivergence: number;
  overallScore: number;
}

export function calculateSimilarity(dist1: number[], dist2: number[]): SimilarityResult {
  if (dist1.length !== dist2.length) {
    return { cosineSimilarity: 0, jsDivergence: 1, overallScore: 0 };
  }

  const cosineSimilarity = cosine(dist1, dist2);
  const jsDivergence = jensenShannonDivergence(dist1, dist2);
  const overallScore = cosineSimilarity * Math.exp(-jsDivergence);

  return { cosineSimilarity, jsDivergence, overallScore };
}

function cosine(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

function jensenShannonDivergence(p: number[], q: number[]): number {
  const m = p.map((pi, i) => (pi + q[i]) / 2);
  return (klDivergence(p, m) + klDivergence(q, m)) / 2;
}

function klDivergence(p: number[], q: number[]): number {
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] > 0 && q[i] > 0) {
      sum += p[i] * Math.log(p[i] / q[i]);
    }
  }
  return sum;
}
