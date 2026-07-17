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

export interface ImageFetchOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "0.0.0.0", "169.254.169.254"]);

export class ImageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageFetchError";
  }
}

export function isRemoteHttpUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"));
}

export function assertUrlNotSsrf(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageFetchError(`Invalid image url: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImageFetchError(`Unsupported image url protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new ImageFetchError(`Blocked image url host: ${url.hostname}`);
  }
  if (isPrivateIp(host)) {
    throw new ImageFetchError(`Blocked private image url host: ${url.hostname}`);
  }
}

export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) {
    throw new ImageFetchError("Invalid data URL");
  }
  const mime = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const data = match[3];
  const bytes = isBase64
    ? new Uint8Array(Buffer.from(data, "base64"))
    : new Uint8Array(Buffer.from(decodeURIComponent(data), "utf-8"));
  return { bytes, mime };
}

export async function fetchImageBytes(
  url: string,
  opts: ImageFetchOptions = {}
): Promise<{ bytes: Uint8Array; mime: string }> {
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
    throw new ImageFetchError(
      `Failed to download ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ImageFetchError(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) {
    throw new ImageFetchError(
      `${url} did not return an image (content-type: ${mime || "unknown"})`
    );
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new ImageFetchError(
      `${url} exceeds max size ${maxBytes} bytes (got ${buffer.byteLength})`
    );
  }
  return { bytes: new Uint8Array(buffer), mime };
}

export async function fetchImageAsDataUrl(
  url: string,
  opts: ImageFetchOptions = {}
): Promise<string> {
  const { bytes, mime } = await fetchImageBytes(url, opts);
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
