import { describe, expect, it } from "vitest";
import { buildImageEditsMultipart } from "@/app/v1/_lib/proxy/image-json-to-multipart";

// Contract used by the forwarder's convertImageJsonToMultipart branch: a JSON edits
// body becomes a multipart body + boundary content-type.
describe("forwarder multipart conversion contract", () => {
  it("builds multipart body + content-type from a JSON edits body", async () => {
    const { body, contentType } = await buildImageEditsMultipart({
      model: "gpt-image-2",
      prompt: "x",
      images: [{ image_url: "data:image/png;base64,iVBORw==" }],
    });
    expect(contentType.startsWith("multipart/form-data; boundary=")).toBe(true);
    expect(body.byteLength).toBeGreaterThan(0);
  });
});
