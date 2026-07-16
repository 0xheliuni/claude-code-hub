import { describe, expect, it } from "vitest";
import { ImageFetchError } from "./image-fetch";
import { buildImageEditsMultipart } from "./image-json-to-multipart";

const okJpeg = async () => ({
  ok: true,
  status: 200,
  headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/jpeg" : null) },
  arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer,
});

async function parseParts(body: ArrayBuffer, contentType: string) {
  const req = new Request("https://x/u", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
  return req.formData();
}

describe("buildImageEditsMultipart", () => {
  it("maps scalars to text and data-url images to image[] files", async () => {
    const { body, contentType } = await buildImageEditsMultipart({
      model: "gpt-image-2",
      prompt: "hi",
      size: "1024x1024",
      response_format: "b64_json",
      images: [{ image_url: "data:image/png;base64,iVBORw==" }],
    });
    expect(contentType.startsWith("multipart/form-data; boundary=")).toBe(true);
    const form = await parseParts(body, contentType);
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("prompt")).toBe("hi");
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("response_format")).toBeNull();
    const files = form.getAll("image[]");
    expect(files.length).toBe(1);
    expect(files[0] instanceof File).toBe(true);
  });

  it("downloads http image_url and supports multiple images + mask", async () => {
    const { body, contentType } = await buildImageEditsMultipart(
      {
        model: "gpt-image-2",
        prompt: "hi",
        images: [{ image_url: "https://x/a.png" }, { image_url: "https://x/b.png" }],
        mask: { image_url: "https://x/m.png" },
      },
      { fetchImpl: okJpeg }
    );
    const form = await parseParts(body, contentType);
    expect(form.getAll("image[]").length).toBe(2);
    expect(form.get("mask") instanceof File).toBe(true);
  });

  it("throws when no image provided", async () => {
    await expect(
      buildImageEditsMultipart({ model: "gpt-image-2", prompt: "x" })
    ).rejects.toBeInstanceOf(ImageFetchError);
  });
});
