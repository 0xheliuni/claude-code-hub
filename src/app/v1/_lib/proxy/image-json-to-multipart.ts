// Converts an OpenAI-style JSON /v1/images/edits body into a multipart/form-data
// request (file field `image[]`), for vendors that only accept multipart.
// Reuses the shared image-fetch downloader and the existing multipart serializer.

import {
  decodeDataUrl,
  fetchImageBytes,
  ImageFetchError,
  type ImageFetchOptions,
  isRemoteHttpUrl,
} from "./image-fetch";
import {
  type OpenAIImageMultipartPart,
  type OpenAIImageRequestMetadata,
  serializeOpenAIImageMultipartRequest,
} from "./openai-image-compat";

const SCALAR_FIELDS = [
  "model",
  "prompt",
  "size",
  "quality",
  "output_format",
  "output_compression",
  "background",
  "input_fidelity",
  "n",
  "user",
] as const;

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function resolveImageBytes(
  value: unknown,
  opts: ImageFetchOptions
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.startsWith("data:")) return decodeDataUrl(value);
  if (isRemoteHttpUrl(value)) return fetchImageBytes(value, opts);
  return null;
}

function toFilePart(
  name: string,
  index: number,
  bytes: Uint8Array,
  mime: string
): OpenAIImageMultipartPart {
  const ext = MIME_EXT[mime] ?? "png";
  const file = new File([bytes as unknown as BlobPart], `image_${index}.${ext}`, { type: mime });
  return { name, kind: "file", value: file };
}

/**
 * Build a multipart/form-data body from a JSON images/edits request.
 * Scalars become text parts; image_url values (data URL or http) become `image[]`
 * file parts; mask.image_url becomes a `mask` file part. Throws ImageFetchError
 * when no usable image is present or a download/decoding fails.
 */
export async function buildImageEditsMultipart(
  body: Record<string, unknown>,
  opts: ImageFetchOptions = {}
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const parts: OpenAIImageMultipartPart[] = [];

  for (const field of SCALAR_FIELDS) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    parts.push({ name: field, kind: "text", value: String(v) });
  }

  const imageSources: unknown[] = [];
  if (Array.isArray(body.images)) {
    for (const item of body.images) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        imageSources.push((item as Record<string, unknown>).image_url);
      }
    }
  }
  if (Array.isArray(body.image)) {
    imageSources.push(...body.image);
  } else if (typeof body.image === "string") {
    imageSources.push(body.image);
  }

  let index = 0;
  for (const src of imageSources) {
    const resolved = await resolveImageBytes(src, opts);
    if (!resolved) continue;
    parts.push(toFilePart("image[]", index, resolved.bytes, resolved.mime));
    index += 1;
  }

  if (index === 0) {
    throw new ImageFetchError(
      "images/edits multipart conversion requires at least one image_url."
    );
  }

  if (body.mask && typeof body.mask === "object" && !Array.isArray(body.mask)) {
    const maskUrl = (body.mask as Record<string, unknown>).image_url;
    const resolvedMask = await resolveImageBytes(maskUrl, opts);
    if (resolvedMask) {
      parts.push(toFilePart("mask", 0, resolvedMask.bytes, resolvedMask.mime));
    }
  }

  const metadata: OpenAIImageRequestMetadata = {
    endpoint: "edits",
    bodyKind: "multipart",
    contentType: null,
    model: typeof body.model === "string" ? body.model : null,
    parts,
  };

  const serialized = await serializeOpenAIImageMultipartRequest(metadata);
  if (!serialized.contentType) {
    throw new ImageFetchError("Failed to build multipart content-type.");
  }
  return { body: serialized.body, contentType: serialized.contentType };
}
