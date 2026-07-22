import type { PatrolProbeContext } from "../types";
import { call, readJson } from "../probes/base";

export interface SampleResult {
  numbers: number[];
  errorCount: number;
}

export async function sampleProvider(
  ctx: PatrolProbeContext,
  sampleCount: number,
  signal: AbortSignal
): Promise<SampleResult> {
  const numbers: number[] = [];
  let errorCount = 0;

  for (let i = 0; i < sampleCount; i++) {
    if (signal.aborted) break;

    try {
      const num = await singleSample(ctx);
      if (num !== null && num >= 1 && num <= 355) {
        numbers.push(num);
      } else {
        errorCount++;
      }
    } catch {
      errorCount++;
    }
  }

  return { numbers, errorCount };
}

async function singleSample(ctx: PatrolProbeContext): Promise<number | null> {
  const body = {
    model: ctx.model,
    max_tokens: 8,
    temperature: 1,
    messages: [
      {
        role: "user",
        content:
          "Pick a random integer between 1 and 355 (inclusive). Output ONLY the number, nothing else.",
      },
    ],
  };

  const res = await call(ctx, "/v1/messages", { body });
  if (!res.ok) return null;

  const json = readJson(res.body) as Record<string, unknown> | null;
  if (!json) return null;

  const content = json.content as Array<Record<string, unknown>> | undefined;
  const textBlock = content?.find((b) => b.type === "text");
  const text = ((textBlock?.text as string) ?? "").trim();

  const num = parseInt(text, 10);
  if (isNaN(num)) return null;
  return num;
}
