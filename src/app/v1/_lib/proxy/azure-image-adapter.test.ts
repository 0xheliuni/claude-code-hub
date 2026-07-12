import { describe, expect, it } from "vitest";
import {
  applyAzureImageAuth,
  AZURE_IMAGE_DEFAULT_API_VERSIONS,
  buildAzureImageProxyUrl,
  resolveAzureDeployment,
  resolveAzureImageApiVersion,
} from "./azure-image-adapter";

describe("azure-image-adapter", () => {
  it("uses built-in default api-versions per endpoint", () => {
    expect(resolveAzureImageApiVersion("generations", null)).toBe(
      AZURE_IMAGE_DEFAULT_API_VERSIONS.generations
    );
    expect(resolveAzureImageApiVersion("edits", null)).toBe(AZURE_IMAGE_DEFAULT_API_VERSIONS.edits);
  });

  it("prefers provider overrides over defaults", () => {
    const overrides = { generations: "2099-01-01", edits: "2099-02-02" };
    expect(resolveAzureImageApiVersion("generations", overrides)).toBe("2099-01-01");
    expect(resolveAzureImageApiVersion("edits", overrides)).toBe("2099-02-02");
  });

  it("falls back to default when override missing or blank", () => {
    expect(resolveAzureImageApiVersion("generations", { edits: "x" })).toBe(
      AZURE_IMAGE_DEFAULT_API_VERSIONS.generations
    );
    expect(resolveAzureImageApiVersion("edits", { edits: "  " })).toBe(
      AZURE_IMAGE_DEFAULT_API_VERSIONS.edits
    );
  });

  it("resolves deployment from body.model", () => {
    expect(resolveAzureDeployment({ model: "gpt-image-2" })).toBe("gpt-image-2");
    expect(resolveAzureDeployment({})).toBeNull();
    expect(resolveAzureDeployment({ model: "  " })).toBeNull();
  });

  it("builds azure url with deployment path and api-version, dropping /v1", () => {
    const url = buildAzureImageProxyUrl(
      "https://res-001.openai.azure.com",
      "gpt-image-2",
      "generations",
      "2024-02-01"
    );
    expect(url).toBe(
      "https://res-001.openai.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01"
    );
  });

  it("tolerates trailing slash in resource base url", () => {
    const url = buildAzureImageProxyUrl(
      "https://res-001.openai.azure.com/",
      "gpt-image-2",
      "edits",
      "2025-04-01-preview"
    );
    expect(url).toBe(
      "https://res-001.openai.azure.com/openai/deployments/gpt-image-2/images/edits?api-version=2025-04-01-preview"
    );
  });
});

describe("applyAzureImageAuth", () => {
  it("sets api-key and removes bearer/x-api-key", () => {
    const h = new Headers({ authorization: "Bearer sk-x", "x-api-key": "y", host: "z" });
    applyAzureImageAuth(h, "AZURE_KEY");
    expect(h.get("api-key")).toBe("AZURE_KEY");
    expect(h.get("authorization")).toBeNull();
    expect(h.get("x-api-key")).toBeNull();
    expect(h.get("host")).toBe("z");
  });
});
