import { describe, expect, it } from "vitest";
import { sanitizeGenerationsRequestForProvider } from "@/app/v1/_lib/proxy/openai-image-compat";
import type { Provider } from "@/types/provider";

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    name: "any",
    url: "https://example.com",
    providerType: "openai-compatible",
    ...overrides,
  } as Provider;
}

describe("sanitizeGenerationsRequestForProvider azure-openai", () => {
  it("strips response_format for azure-openai provider type", () => {
    const body: Record<string, unknown> = { model: "gpt-image-2", response_format: "url" };
    const changed = sanitizeGenerationsRequestForProvider(
      body,
      makeProvider({ providerType: "azure-openai", url: "https://res.openai.azure.com" })
    );
    expect(changed).toBe(true);
    expect(body.response_format).toBeUndefined();
  });

  it("does not touch response_format for plain openai-compatible", () => {
    const body: Record<string, unknown> = { model: "gpt-image-2", response_format: "url" };
    const changed = sanitizeGenerationsRequestForProvider(
      body,
      makeProvider({ providerType: "openai-compatible", url: "https://api.openai.com" })
    );
    expect(changed).toBe(false);
    expect(body.response_format).toBe("url");
  });

  it("is a no-op when response_format is absent", () => {
    const body: Record<string, unknown> = { model: "gpt-image-2" };
    const changed = sanitizeGenerationsRequestForProvider(
      body,
      makeProvider({ providerType: "azure-openai" })
    );
    expect(changed).toBe(false);
  });
});
