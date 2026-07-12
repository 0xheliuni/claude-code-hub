import { describe, expect, it } from "vitest";
import {
  buildAzureImageProxyUrl,
  resolveAzureImageApiVersion,
} from "@/app/v1/_lib/proxy/azure-image-adapter";

// Contract test: locks the exact upstream URL the forwarder's azure-openai branch
// produces for each image endpoint using the built-in default api-versions.
describe("azure-openai forwarder url contract", () => {
  it("generations uses 2024-02-01 by default", () => {
    const v = resolveAzureImageApiVersion("generations", null);
    expect(
      buildAzureImageProxyUrl("https://r.openai.azure.com", "gpt-image-2", "generations", v)
    ).toBe(
      "https://r.openai.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01"
    );
  });

  it("edits uses 2025-04-01-preview by default", () => {
    const v = resolveAzureImageApiVersion("edits", null);
    expect(buildAzureImageProxyUrl("https://r.openai.azure.com", "gpt-image-2", "edits", v)).toBe(
      "https://r.openai.azure.com/openai/deployments/gpt-image-2/images/edits?api-version=2025-04-01-preview"
    );
  });
});
