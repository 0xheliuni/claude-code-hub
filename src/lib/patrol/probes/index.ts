import type { PatrolProbe, PatrolProbeContext, PatrolProbeResult } from "../types";
import { connectivity } from "./connectivity";
import { modelEcho } from "./model-echo";
import { responseShape } from "./response-shape";
import { toolUse } from "./tool-use";
import { streamingShape } from "./streaming-shape";
import { systemPromptLeak } from "./system-prompt-leak";
import { consistencyCheck } from "./consistency-check";

const PROBE_REGISTRY = new Map<string, PatrolProbe>([
  ["connectivity", connectivity],
  ["model_echo", modelEcho],
  ["response_shape", responseShape],
  ["tool_use", toolUse],
  ["streaming_shape", streamingShape],
  ["system_prompt_leak", systemPromptLeak],
  ["consistency_check", consistencyCheck],
]);

export function getProbeByName(name: string): PatrolProbe | undefined {
  return PROBE_REGISTRY.get(name);
}

export function getAllProbes(): PatrolProbe[] {
  return [...PROBE_REGISTRY.values()];
}

export async function runProbeWithRetry(
  probe: PatrolProbe,
  ctx: PatrolProbeContext,
  retries: number
): Promise<PatrolProbeResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await probe.run(ctx);
      return {
        name: probe.name,
        label: probe.label,
        category: probe.category,
        weight: probe.defaultWeight,
        ...result,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof Error && err.name === "AbortError") break;
    }
  }
  return {
    name: probe.name,
    label: probe.label,
    category: probe.category,
    weight: probe.defaultWeight,
    passed: false,
    score: 0,
    detail: `exception: ${lastError?.message ?? "unknown"}`,
    latencyMs: 0,
  };
}
