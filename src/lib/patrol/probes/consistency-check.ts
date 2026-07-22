import type { PatrolProbe } from "../types";
import { call, makeMessagesBody, readJson } from "./base";

export const consistencyCheck: PatrolProbe = {
  name: "consistency_check",
  label: "Consistency Check",
  category: "behavioral",
  defaultWeight: 0.7,

  async run(ctx) {
    const body = makeMessagesBody(ctx, {
      max_tokens: 8,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: "Output ONLY the number 42. Nothing else. No explanation.",
        },
      ],
    });

    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await call(ctx, "/v1/messages", { body });
      const json = readJson(res.body) as Record<string, unknown> | null;

      if (!res.ok || !json) {
        return {
          passed: false,
          score: 0,
          detail: `Request ${i + 1} failed: HTTP ${res.status}`,
          latencyMs: res.latencyMs,
        };
      }

      const content = json.content as Array<Record<string, unknown>> | undefined;
      const textBlock = content?.find((b) => b.type === "text");
      const text = ((textBlock?.text as string) ?? "").trim();
      results.push(text);
    }

    const totalLatencyMs = 0;
    const allMatch = results.every((r) => r === results[0]);
    const contains42 = results.every((r) => r.includes("42"));

    if (!contains42) {
      return {
        passed: false,
        score: 0.3,
        detail: `Expected "42" in all responses, got: ${results.map((r) => JSON.stringify(r)).join(", ")}`,
        latencyMs: totalLatencyMs,
      };
    }

    if (!allMatch) {
      return {
        passed: false,
        score: 0.7,
        detail: `Inconsistent responses at temperature=0: ${results.map((r) => JSON.stringify(r)).join(", ")}`,
        latencyMs: totalLatencyMs,
      };
    }

    return {
      passed: true,
      score: 1,
      detail: `Consistent: ${JSON.stringify(results[0])} (3/3)`,
      latencyMs: totalLatencyMs,
    };
  },
};
