// Azure OpenAI image endpoint adapter.
//
// Pure functions that translate an OpenAI-style image request target into the
// Azure OpenAI shape: deployment-scoped path, per-endpoint api-version query,
// and api-key based authentication. Kept side-effect free so they can be unit
// tested in isolation and composed by the forwarder.

export type AzureImageEndpoint = "generations" | "edits";

// Built-in defaults. gpt-image-2 generations is GA on 2024-02-01; edits is only
// available on the 2025-04-01-preview surface. Overridable per provider.
export const AZURE_IMAGE_DEFAULT_API_VERSIONS: Record<AzureImageEndpoint, string> = {
  generations: "2024-02-01",
  edits: "2025-04-01-preview",
};

/**
 * Resolve the api-version for an Azure image endpoint.
 * Provider overrides win over built-in defaults; blank/missing overrides fall back.
 */
export function resolveAzureImageApiVersion(
  endpoint: AzureImageEndpoint,
  overrides: Record<string, string> | null | undefined
): string {
  const override = overrides?.[endpoint];
  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }
  return AZURE_IMAGE_DEFAULT_API_VERSIONS[endpoint];
}

/**
 * Azure requires a deployment name in the path. We map it from the request
 * body's `model` field (present in both JSON and multipart logical bodies).
 */
export function resolveAzureDeployment(body: Record<string, unknown>): string | null {
  const model = body.model;
  if (typeof model !== "string" || model.trim().length === 0) {
    return null;
  }
  return model.trim();
}

/**
 * Build the Azure OpenAI image endpoint URL. Drops any OpenAI `/v1` prefix and
 * appends the deployment path plus the required api-version query parameter.
 */
export function buildAzureImageProxyUrl(
  resourceBaseUrl: string,
  deployment: string,
  endpoint: AzureImageEndpoint,
  apiVersion: string
): string {
  const base = resourceBaseUrl.replace(/\/+$/, "");
  const path = `/openai/deployments/${encodeURIComponent(deployment)}/images/${endpoint}`;
  const search = `?api-version=${encodeURIComponent(apiVersion)}`;
  return `${base}${path}${search}`;
}

/**
 * Apply Azure key-based auth to outbound headers: set `api-key`, and remove any
 * OpenAI-style bearer/x-api-key so Azure does not receive conflicting credentials.
 */
export function applyAzureImageAuth(headers: Headers, apiKey: string): void {
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.set("api-key", apiKey);
}
