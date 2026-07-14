// Downloads remote image_url values in image request bodies and inlines them as
// base64 data URLs, so upstream providers (e.g. Azure OpenAI) never have to fetch
// remote URLs themselves. Gated by a provider toggle in the forwarder.
//
// Side-effect free except for the network fetch, which is injectable for tests.

import { isPrivateIp } from "@/lib/ip/private-ip";

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<FetchLikeResponse>;

export interface InlineOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

// Literal hosts we refuse to fetch. IP-literal private ranges are handled by isPrivateIp.
const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "0.0.0.0", "169.254.169.254"]);

export class ImageInlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageInlineError";
  }
}

function isRemoteHttpUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"));
}

function assertUrlNotSsrf(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageInlineError(`Invalid image_url: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImageInlineError(`Unsupported image_url protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new ImageInlineError(`Blocked image_url host: ${url.hostname}`);
  }
  // Block private IP literals (best-effort; no DNS resolution / rebinding protection).
  if (isPrivateIp(host)) {
    throw new ImageInlineError(`Blocked private image_url host: ${url.hostname}`);
  }
}

export async function fetchImageAsDataUrl(url: string, opts: InlineOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  assertUrlNotSsrf(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: FetchLikeResponse;
  try {
    res = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    throw new ImageInlineError(
      `Failed to download image_url ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ImageInlineError(`Failed to download image_url ${url}: HTTP ${res.status}`);
  }

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new ImageInlineError(
      `image_url ${url} did not return an image (content-type: ${contentType || "unknown"})`
    );
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new ImageInlineError(
      `image_url ${url} exceeds max size ${maxBytes} bytes (got ${buffer.byteLength})`
    );
  }

  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

async function maybeInline(value: unknown, opts: InlineOptions): Promise<unknown> {
  if (isRemoteHttpUrl(value)) {
    return fetchImageAsDataUrl(value, opts);
  }
  return value;
}

/**
 * In-place rewrite of any remote http(s) image_url/image fields in an OpenAI-style
 * image request body into base64 data URLs. Fields covered:
 * - generations: `image` (string | string[]), `image_url` (string)
 * - edits: `images[].image_url`, `mask.image_url`
 */
export async function inlineImageUrlsInImageBody(
  body: Record<string, unknown>,
  opts: InlineOptions = {}
): Promise<void> {
  if (Array.isArray(body.image)) {
    body.image = await Promise.all(body.image.map((item) => maybeInline(item, opts)));
  } else if (body.image !== undefined) {
    body.image = await maybeInline(body.image, opts);
  }

  if (body.image_url !== undefined) {
    body.image_url = await maybeInline(body.image_url, opts);
  }

  if (Array.isArray(body.images)) {
    for (const item of body.images) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        if (obj.image_url !== undefined) {
          obj.image_url = await maybeInline(obj.image_url, opts);
        }
      }
    }
  }

  if (body.mask && typeof body.mask === "object" && !Array.isArray(body.mask)) {
    const mask = body.mask as Record<string, unknown>;
    if (mask.image_url !== undefined) {
      mask.image_url = await maybeInline(mask.image_url, opts);
    }
  }
}
