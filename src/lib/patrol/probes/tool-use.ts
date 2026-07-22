import type { PatrolProbe } from "../types";
import { call, makeMessagesBody, readJson } from "./base";

export const toolUse: PatrolProbe = {
  name: "tool_use",
  label: "Tool Use",
  category: "behavioral",
  defaultWeight: 1.0,

  async run(ctx) {
    const body = makeMessagesBody(ctx, {
      max_tokens: 256,
      messages: [{ role: "user", content: "What is the current temperature in Tokyo?" }],
      tools: [
        {
          name: "get_weather",
          description: "Get the current weather for a given location.",
          input_schema: {
            type: "object",
            properties: {
              location: { type: "string", description: "City name" },
            },
            required: ["location"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "get_weather" },
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

    const stopReason = json.stop_reason as string | undefined;
    if (stopReason !== "tool_use") {
      return {
        passed: false,
        score: 0.3,
        detail: `Expected stop_reason=tool_use, got=${stopReason}`,
        latencyMs: res.latencyMs,
      };
    }

    const content = json.content as Array<Record<string, unknown>> | undefined;
    const toolBlock = content?.find((b) => b.type === "tool_use");
    if (!toolBlock) {
      return {
        passed: false,
        score: 0.4,
        detail: "No tool_use block in content",
        latencyMs: res.latencyMs,
      };
    }

    const toolId = toolBlock.id as string | undefined;
    if (!toolId || !toolId.startsWith("toolu_")) {
      return {
        passed: false,
        score: 0.6,
        detail: `Invalid tool ID prefix: ${toolId}`,
        latencyMs: res.latencyMs,
      };
    }

    const toolName = toolBlock.name as string | undefined;
    if (toolName !== "get_weather") {
      return {
        passed: false,
        score: 0.7,
        detail: `Wrong tool name: ${toolName}`,
        latencyMs: res.latencyMs,
      };
    }

    const input = toolBlock.input as Record<string, unknown> | undefined;
    if (!input || typeof input.location !== "string") {
      return {
        passed: false,
        score: 0.8,
        detail: "Tool input missing location field",
        latencyMs: res.latencyMs,
      };
    }

    return {
      passed: true,
      score: 1,
      detail: `Tool call OK: ${toolName}(${JSON.stringify(input)})`,
      latencyMs: res.latencyMs,
    };
  },
};
