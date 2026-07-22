import type { PatrolProbeContext } from "../types";

export interface CallOptions {
  method?: "POST" | "GET";
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface CallResult {
  ok: boolean;
  status: number;
  headers: Headers;
  body: string;
  latencyMs: number;
}

export async function call(
  ctx: PatrolProbeContext,
  path: string,
  options: CallOptions = {}
): Promise<CallResult> {
  const url = ctx.endpoint.replace(/\/$/, "") + path;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": ctx.apiKey,
    ...options.headers,
  };

  const start = performance.now();
  const res = await fetch(url, {
    method: options.method ?? "POST",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: ctx.signal,
  });
  const body = await res.text();
  const latencyMs = Math.round(performance.now() - start);

  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    body,
    latencyMs,
  };
}

export function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export interface SseEvent {
  event: string;
  data: string;
}

export function readSseEvents(body: string): SseEvent[] {
  const events: SseEvent[] = [];
  let currentEvent = "";
  let currentData = "";

  for (const line of body.split("\n")) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6);
    } else if (line === "" && (currentEvent || currentData)) {
      events.push({ event: currentEvent, data: currentData });
      currentEvent = "";
      currentData = "";
    }
  }

  if (currentEvent || currentData) {
    events.push({ event: currentEvent, data: currentData });
  }

  return events;
}

export function makeMessagesBody(
  ctx: PatrolProbeContext,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    model: ctx.model,
    max_tokens: 64,
    messages: [{ role: "user", content: "ping" }],
    ...overrides,
  };
}
