import { describe, expect, it } from "vitest";
import { ImageInlineError, inlineImageUrlsInImageBody } from "./image-url-inliner";

function pngResponse(bytes = new Uint8Array([137, 80, 78, 71])) {
  return {
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
    arrayBuffer: async () => bytes.buffer.slice(0),
  };
}

const okFetch = async () => pngResponse();

describe("inlineImageUrlsInImageBody", () => {
  it("replaces edits images[].image_url http url with data url", async () => {
    const body: Record<string, unknown> = {
      model: "gpt-image-2",
      images: [{ image_url: "https://example.com/a.png" }],
    };
    await inlineImageUrlsInImageBody(body, { fetchImpl: okFetch });
    const url = (body.images as Array<{ image_url: string }>)[0].image_url;
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("replaces mask.image_url", async () => {
    const body: Record<string, unknown> = { mask: { image_url: "https://x/m.png" } };
    await inlineImageUrlsInImageBody(body, { fetchImpl: okFetch });
    expect(
      (body.mask as { image_url: string }).image_url.startsWith("data:image/png;base64,")
    ).toBe(true);
  });

  it("replaces generations image string and string array, leaving non-http untouched", async () => {
    const body: Record<string, unknown> = {
      image: ["https://x/1.png", "iVBORAlreadyBase64=="],
      image_url: "https://x/2.png",
    };
    await inlineImageUrlsInImageBody(body, { fetchImpl: okFetch });
    const arr = body.image as string[];
    expect(arr[0].startsWith("data:image/png;base64,")).toBe(true);
    expect(arr[1]).toBe("iVBORAlreadyBase64==");
    expect((body.image_url as string).startsWith("data:image/png;base64,")).toBe(true);
  });

  it("leaves existing data: urls untouched (no fetch)", async () => {
    let called = 0;
    const body: Record<string, unknown> = {
      images: [{ image_url: "data:image/png;base64,AAAA" }],
    };
    await inlineImageUrlsInImageBody(body, {
      fetchImpl: async () => {
        called += 1;
        return pngResponse();
      },
    });
    expect(called).toBe(0);
    expect((body.images as Array<{ image_url: string }>)[0].image_url).toBe(
      "data:image/png;base64,AAAA"
    );
  });

  it("throws on non-image content-type", async () => {
    const htmlFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    const body: Record<string, unknown> = { images: [{ image_url: "https://x/a.png" }] };
    await expect(
      inlineImageUrlsInImageBody(body, { fetchImpl: htmlFetch })
    ).rejects.toBeInstanceOf(ImageInlineError);
  });

  it("throws on oversize download", async () => {
    const bigFetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null),
      },
      arrayBuffer: async () => new Uint8Array(30).buffer,
    });
    const body: Record<string, unknown> = { images: [{ image_url: "https://x/a.png" }] };
    await expect(
      inlineImageUrlsInImageBody(body, { fetchImpl: bigFetch, maxBytes: 10 })
    ).rejects.toBeInstanceOf(ImageInlineError);
  });

  it("throws (SSRF) on private / metadata hosts", async () => {
    for (const u of [
      "http://127.0.0.1/a.png",
      "http://169.254.169.254/a.png",
      "http://localhost/a.png",
    ]) {
      const body: Record<string, unknown> = { image_url: u };
      await expect(
        inlineImageUrlsInImageBody(body, { fetchImpl: okFetch })
      ).rejects.toBeInstanceOf(ImageInlineError);
    }
  });
});
