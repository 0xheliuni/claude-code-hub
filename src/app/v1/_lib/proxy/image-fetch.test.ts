import { describe, expect, it } from "vitest";
import { decodeDataUrl, fetchImageBytes, ImageFetchError, isRemoteHttpUrl } from "./image-fetch";

const okPng = async () => ({
  ok: true,
  status: 200,
  headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
  arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
});

describe("image-fetch", () => {
  it("isRemoteHttpUrl", () => {
    expect(isRemoteHttpUrl("https://x/a.png")).toBe(true);
    expect(isRemoteHttpUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isRemoteHttpUrl(123)).toBe(false);
  });

  it("decodeDataUrl parses mime and bytes", () => {
    const { bytes, mime } = decodeDataUrl("data:image/png;base64,iVBORw==");
    expect(mime).toBe("image/png");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("decodeDataUrl throws on non-data url", () => {
    expect(() => decodeDataUrl("https://x/a.png")).toThrow(ImageFetchError);
  });

  it("fetchImageBytes returns bytes + mime", async () => {
    const { bytes, mime } = await fetchImageBytes("https://x/a.png", { fetchImpl: okPng });
    expect(mime).toBe("image/png");
    expect(Array.from(bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });

  it("fetchImageBytes rejects non-image", async () => {
    const html = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    await expect(fetchImageBytes("https://x/a.png", { fetchImpl: html })).rejects.toBeInstanceOf(
      ImageFetchError
    );
  });

  it("fetchImageBytes enforces maxBytes", async () => {
    const big = async () => ({
      ok: true,
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
      arrayBuffer: async () => new Uint8Array(50).buffer,
    });
    await expect(
      fetchImageBytes("https://x/a.png", { fetchImpl: big, maxBytes: 10 })
    ).rejects.toBeInstanceOf(ImageFetchError);
  });

  it("fetchImageBytes blocks SSRF hosts", async () => {
    for (const u of [
      "http://127.0.0.1/a.png",
      "http://169.254.169.254/a.png",
      "http://localhost/a.png",
    ]) {
      await expect(fetchImageBytes(u, { fetchImpl: okPng })).rejects.toBeInstanceOf(ImageFetchError);
    }
  });
});
