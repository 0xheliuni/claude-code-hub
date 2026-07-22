import type { PatrolProbe } from "../types";
import { call, makeMessagesBody, readJson } from "./base";

export const responseShape: PatrolProbe = {
  name: "response_shape",
  label: "Response Shape",
  category: "structural",
  defaultWeight: 0.8,

  async run(ctx) {
    const body = makeMessagesBody(ctx, {
      max_tokens: 32,
      messages: [{ role: "user", content: "Hi" }],
    });

    const res = await call(ctx, "/v1/messages", { body });
    const json = readJson(res.body) as Record<string, unknown> | null;

    if (!res.ok || !json) {
      return {
        passed: false,
        score: 0,
        detail: `HTTP ${res.status}`,
        latencyMs: res.latencyMs,
      };
    }

    const requiredFields = ["id", "type", "role", "model", "content", "stop_reason", "usage"];
    const missing: string[] = [];
    for (const field of requiredFields) {
      if (!(field in json)) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      const score = 1 - missing.length / requiredFields.length;
      return {
        passed: false,
        score: Math.max(0, score),
        detail: `Missing fields: ${missing.join(", ")}`,
        latencyMs: res.latencyMs,
      };
    }

    if (json.type !== "message") {
      return {
        passed: false,
        score: 0.5,
        detail: `Unexpected type: ${json.type}`,
        latencyMs: res.latencyMs,
      };
    }

    const usage = json.usage as Record<string, unknown> | undefined;
    if (!usage || typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") {
      return {
        passed: false,
        score: 0.7,
        detail: "Usage object malformed",
        latencyMs: res.latencyMs,
      };
    }

    return {
      passed: true,
      score: 1,
      detail: "All fields present and valid",
      latencyMs: res.latencyMs,
    };
  },
};
