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

describe("connectivity probe", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("passes when response has id and content", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "msg_abc123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "pong" }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
      })
    );

    const { connectivity } = await import("@/lib/patrol/probes/connectivity");
    const result = await connectivity.run(makeCtx());

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ type: "error", error: { type: "authentication_error" } }, 401)
    );

    const { connectivity } = await import("@/lib/patrol/probes/connectivity");
    const result = await connectivity.run(makeCtx());

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.detail).toContain("401");
  });

  it("fails when id format is wrong", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "invalid_id",
        type: "message",
        content: [{ type: "text", text: "pong" }],
      })
    );

    const { connectivity } = await import("@/lib/patrol/probes/connectivity");
    const result = await connectivity.run(makeCtx());

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.3);
  });
});
