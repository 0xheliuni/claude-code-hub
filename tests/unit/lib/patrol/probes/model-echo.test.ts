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

describe("model-echo probe", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("passes when response model matches requested", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "msg_abc",
        type: "message",
        model: "claude-haiku-4-5-20251001",
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
      })
    );

    const { modelEcho } = await import("@/lib/patrol/probes/model-echo");
    const result = await modelEcho.run(makeCtx());

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("passes when base model matches ignoring date suffix", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "msg_abc",
        type: "message",
        model: "claude-haiku-4-5-20260101",
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
      })
    );

    const { modelEcho } = await import("@/lib/patrol/probes/model-echo");
    const result = await modelEcho.run(makeCtx());

    expect(result.passed).toBe(true);
  });

  it("fails when model is completely different", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "msg_abc",
        type: "message",
        model: "gpt-4o",
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
      })
    );

    const { modelEcho } = await import("@/lib/patrol/probes/model-echo");
    const result = await modelEcho.run(makeCtx());

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.1);
    expect(result.detail).toContain("mismatch");
  });

  it("fails when model field is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "msg_abc",
        type: "message",
        content: [{ type: "text", text: "hello" }],
      })
    );

    const { modelEcho } = await import("@/lib/patrol/probes/model-echo");
    const result = await modelEcho.run(makeCtx());

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.2);
  });
});
