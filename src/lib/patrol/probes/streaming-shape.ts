import type { PatrolProbe } from "../types";
import { call, makeMessagesBody, readSseEvents } from "./base";

export const streamingShape: PatrolProbe = {
  name: "streaming_shape",
  label: "Streaming Shape",
  category: "structural",
  defaultWeight: 0.8,

  async run(ctx) {
    const body = makeMessagesBody(ctx, {
      max_tokens: 32,
      stream: true,
      messages: [{ role: "user", content: "Say hi" }],
    });

    const res = await call(ctx, "/v1/messages", { body });

    if (!res.ok) {
      return {
        passed: false,
        score: 0,
        detail: `HTTP ${res.status}`,
        latencyMs: res.latencyMs,
      };
    }

    const events = readSseEvents(res.body);
    if (events.length === 0) {
      return {
        passed: false,
        score: 0.1,
        detail: "No SSE events in response",
        latencyMs: res.latencyMs,
      };
    }

    const eventTypes = events.map((e) => e.event);
    const hasMessageStart = eventTypes.includes("message_start");
    const hasContentBlockStart = eventTypes.includes("content_block_start");
    const hasContentBlockDelta = eventTypes.includes("content_block_delta");
    const hasMessageDelta = eventTypes.includes("message_delta");
    const hasMessageStop = eventTypes.includes("message_stop");

    const checks = [
      hasMessageStart,
      hasContentBlockStart,
      hasContentBlockDelta,
      hasMessageDelta,
      hasMessageStop,
    ];
    const passedCount = checks.filter(Boolean).length;
    const score = passedCount / checks.length;

    if (passedCount < checks.length) {
      const missing: string[] = [];
      if (!hasMessageStart) missing.push("message_start");
      if (!hasContentBlockStart) missing.push("content_block_start");
      if (!hasContentBlockDelta) missing.push("content_block_delta");
      if (!hasMessageDelta) missing.push("message_delta");
      if (!hasMessageStop) missing.push("message_stop");

      return {
        passed: false,
        score,
        detail: `Missing SSE events: ${missing.join(", ")}`,
        latencyMs: res.latencyMs,
      };
    }

    const firstEvent = events[0];
    if (firstEvent.event !== "message_start") {
      return {
        passed: false,
        score: 0.8,
        detail: `First event should be message_start, got ${firstEvent.event}`,
        latencyMs: res.latencyMs,
      };
    }

    return {
      passed: true,
      score: 1,
      detail: `${events.length} SSE events, all expected types present`,
      latencyMs: res.latencyMs,
    };
  },
};
