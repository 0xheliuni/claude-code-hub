import type { PatrolProbe } from "../types";
import { call, makeMessagesBody, readJson } from "./base";

export const connectivity: PatrolProbe = {
  name: "connectivity",
  label: "Connectivity",
  category: "structural",
  defaultWeight: 1.0,

  async run(ctx) {
    const body = makeMessagesBody(ctx, {
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
    });

    const res = await call(ctx, "/v1/messages", { body });
    const json = readJson(res.body) as Record<string, unknown> | null;

    if (!res.ok) {
      return {
        passed: false,
        score: 0,
        detail: `HTTP ${res.status}: ${json ? JSON.stringify(json).slice(0, 200) : res.body.slice(0, 200)}`,
        latencyMs: res.latencyMs,
      };
    }

    const hasId = json && typeof json.id === "string" && json.id.startsWith("msg_");
    const hasContent = json && Array.isArray(json.content) && json.content.length > 0;

    if (!hasId || !hasContent) {
      return {
        passed: false,
        score: 0.3,
        detail: `Response missing expected fields: id=${!!hasId}, content=${!!hasContent}`,
        latencyMs: res.latencyMs,
      };
    }

    return {
      passed: true,
      score: 1,
      detail: `OK (${res.latencyMs}ms)`,
      latencyMs: res.latencyMs,
    };
  },
};
