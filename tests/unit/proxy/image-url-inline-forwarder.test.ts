import { describe, expect, it } from "vitest";
import { inlineImageUrlsInImageBody } from "@/app/v1/_lib/proxy/image-url-inliner";

// Contract: with the toggle on, an https image_url becomes a data URL that
// validateOpenAIImageRequest accepts (isOpenAIImageUrl allows data: URLs).
describe("image inline forwarder contract", () => {
  it("produces a data url that looks valid for the edits schema", async () => {
    const body: Record<string, unknown> = {
      model: "gpt-image-2",
      prompt: "x",
      images: [{ image_url: "https://example.com/a.png" }],
    };
    await inlineImageUrlsInImageBody(body, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
      }),
    });
    const url = (body.images as Array<{ image_url: string }>)[0].image_url;
    expect(url.startsWith("data:")).toBe(true);
  });
});
