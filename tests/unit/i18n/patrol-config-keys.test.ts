import { describe, expect, it } from "vitest";

import enDashboard from "../../../messages/en/dashboard.json";
import jaDashboard from "../../../messages/ja/dashboard.json";
import ruDashboard from "../../../messages/ru/dashboard.json";
import zhCNDashboard from "../../../messages/zh-CN/dashboard.json";
import zhTWDashboard from "../../../messages/zh-TW/dashboard.json";

/**
 * Recursively extract all dot-separated key paths from a nested object.
 * e.g. { a: { b: 1, c: 2 } } -> ["a.b", "a.c"]
 */
function extractKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...extractKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

function patrolConfig(data: Record<string, unknown>): Record<string, unknown> {
  const patrol = data.patrol as Record<string, unknown> | undefined;
  const config = patrol?.config as Record<string, unknown> | undefined;
  return config ?? {};
}

const locales: Record<string, Record<string, unknown>> = {
  en: enDashboard,
  "zh-CN": zhCNDashboard,
  "zh-TW": zhTWDashboard,
  ja: jaDashboard,
  ru: ruDashboard,
};

const baselineKeys = extractKeys(patrolConfig(locales.en));

describe("dashboard.patrol.config locale key parity", () => {
  it("English baseline contains the expected field and probe keys", () => {
    expect(baselineKeys).toContain("fields.thresholdPass.label");
    expect(baselineKeys).toContain("fields.expectedChannel.desc");
    expect(baselineKeys).toContain("probeNames.connectivity");
    expect(baselineKeys).toContain("probeNames.document_input");
    // 25 top-level config keys, 29 fields (x2 label/desc = 58), 19 probeNames = many leaves.
    expect(baselineKeys.length).toBeGreaterThan(80);
  });

  for (const [locale, data] of Object.entries(locales)) {
    if (locale === "en") continue;

    it(`${locale} has all patrol.config keys present in English baseline`, () => {
      const localeKeys = extractKeys(patrolConfig(data));
      const missing = baselineKeys.filter((k) => !localeKeys.includes(k));
      expect(missing, `${locale} is missing keys: ${missing.join(", ")}`).toEqual([]);
    });

    it(`${locale} has no extra patrol.config keys beyond English baseline`, () => {
      const localeKeys = extractKeys(patrolConfig(data));
      const extra = localeKeys.filter((k) => !baselineKeys.includes(k));
      expect(extra, `${locale} has extra keys: ${extra.join(", ")}`).toEqual([]);
    });
  }

  it("all 5 locales have identical patrol.config key sets", () => {
    for (const [locale, data] of Object.entries(locales)) {
      const localeKeys = extractKeys(patrolConfig(data));
      expect(localeKeys, `${locale} key mismatch`).toEqual(baselineKeys);
    }
  });
});
