import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PatrolProbeContext } from "@/lib/patrol/types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeCtx(overrides: Partial<PatrolProbeContext> = {}): PatrolProbeContext {
  return {
    endpoint: "https://api.anthropic.com",
    apiKey: "sk-test-key",
    model: "claude-haiku-4-5-20251001",
    providerType: "claude",
    timeout: 10000,
    signal: AbortSignal.timeout(10000),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("tool-use probe", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("passes when tool is called correctly", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "msg_abc",
        type: "message",
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_xyz123",
            name: "get_weather",
            input: { location: "Tokyo" },
          },
        ],
        usage: { input_tokens: 30, output_tokens: 20 },
      })
    );

    const { toolUse } = await import("@/lib/patrol/probes/tool-use");
    const result = await toolUse.run(makeCtx());

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when stop_reason is not tool_use", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "msg_abc",
        type: "message",
        model: "claude-haiku-4-5-20251001",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I cannot get weather" }],
        usage: { input_tokens: 30, output_tokens: 20 },
      })
    );

    const { toolUse } = await import("@/lib/patrol/probes/tool-use");
    const result = await toolUse.run(makeCtx());

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.3);
  });

  it("fails when tool ID has wrong prefix", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "msg_abc",
        type: "message",
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "call_xyz123",
            name: "get_weather",
            input: { location: "Tokyo" },
          },
        ],
        usage: { input_tokens: 30, output_tokens: 20 },
      })
    );

    const { toolUse } = await import("@/lib/patrol/probes/tool-use");
    const result = await toolUse.run(makeCtx());

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.6);
    expect(result.detail).toContain("prefix");
  });

  it("fails on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "rate_limit" }, 429));

    const { toolUse } = await import("@/lib/patrol/probes/tool-use");
    const result = await toolUse.run(makeCtx());

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });
});
