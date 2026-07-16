// Downloads remote image_url values in image request bodies and inlines them as
// base64 data URLs, so upstream providers (e.g. Azure OpenAI) never have to fetch
// remote URLs themselves. Gated by a provider toggle in the forwarder.
//
// Download/SSRF/data-url logic lives in ./image-fetch and is shared with the
// JSON -> multipart converter.

import { fetchImageAsDataUrl, type ImageFetchOptions, isRemoteHttpUrl } from "./image-fetch";

export { ImageFetchError as ImageInlineError, fetchImageAsDataUrl } from "./image-fetch";
export type InlineOptions = ImageFetchOptions;

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
