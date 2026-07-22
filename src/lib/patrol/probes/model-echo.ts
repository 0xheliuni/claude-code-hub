import type { PatrolProbe } from "../types";
import { call, makeMessagesBody, readJson } from "./base";

export const modelEcho: PatrolProbe = {
  name: "model_echo",
  label: "Model Echo",
  category: "structural",
  defaultWeight: 1.0,

  async run(ctx) {
    const body = makeMessagesBody(ctx, {
      max_tokens: 16,
      messages: [{ role: "user", content: "Say hello" }],
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

    const responseModel = json.model as string | undefined;
    if (!responseModel) {
      return {
        passed: false,
        score: 0.2,
        detail: "Response missing model field",
        latencyMs: res.latencyMs,
      };
    }

    const requestedBase = ctx.model.replace(/-\d{8}$/, "");
    const responseBase = responseModel.replace(/-\d{8}$/, "");
    const matches = responseBase.startsWith(requestedBase) || requestedBase.startsWith(responseBase);

    if (!matches) {
      return {
        passed: false,
        score: 0.1,
        detail: `Model mismatch: requested=${ctx.model}, got=${responseModel}`,
        latencyMs: res.latencyMs,
      };
    }

    return {
      passed: true,
      score: 1,
      detail: `Model confirmed: ${responseModel}`,
      latencyMs: res.latencyMs,
    };
  },
};
