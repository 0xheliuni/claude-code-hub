import { describe, expect, it, vi, beforeEach } from "vitest";
import { getDefaultConfig } from "@/lib/patrol/config";

vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock("@/drizzle/schema", () => ({
  providers: { id: "id", isEnabled: "is_enabled" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ a, b })),
}));

vi.mock("@/repository/patrol-state", () => ({
  resetConsecutivePass: vi.fn().mockResolvedValue(undefined),
  getProviderState: vi.fn().mockResolvedValue(null),
  incrementConsecutivePass: vi.fn().mockResolvedValue(1),
  upsertProviderState: vi.fn().mockResolvedValue(undefined),
  clearPatrolDisabled: vi.fn().mockResolvedValue(undefined),
}));

describe("patrol actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens circuit on warning with default config", async () => {
    const { executeAction } = await import("@/lib/patrol/actions");
    const { recordFailure } = await import("@/lib/circuit-breaker");
    const config = getDefaultConfig();

    const action = await executeAction(1, "warning", config);
    expect(action).toBe("circuit_open");
    expect(recordFailure).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("disables provider on critical with default config", async () => {
    const { executeAction } = await import("@/lib/patrol/actions");
    const { db } = await import("@/drizzle/db");
    const config = getDefaultConfig();

    const action = await executeAction(2, "critical", config);
    expect(action).toBe("disable");
    expect(db.update).toHaveBeenCalled();
  });

  it("returns none on pass without recovery needed", async () => {
    const { executeAction } = await import("@/lib/patrol/actions");
    const config = getDefaultConfig();

    const action = await executeAction(1, "pass", config);
    expect(action).toBe("none");
  });

  it("returns none when action is none", async () => {
    const { executeAction } = await import("@/lib/patrol/actions");
    const config = { ...getDefaultConfig(), actionOnWarning: "none" as const };

    const action = await executeAction(1, "warning", config);
    expect(action).toBe("none");
  });
});
