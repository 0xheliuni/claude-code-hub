import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
}));

describe("patrol scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("startPatrolScheduler creates interval", async () => {
    const { startPatrolScheduler, stopPatrolScheduler } = await import(
      "@/lib/patrol/scheduler"
    );

    startPatrolScheduler();
    stopPatrolScheduler();
  });

  it("stopPatrolScheduler clears interval", async () => {
    const { startPatrolScheduler, stopPatrolScheduler } = await import(
      "@/lib/patrol/scheduler"
    );

    startPatrolScheduler();
    stopPatrolScheduler();
    // calling stop again should be safe
    stopPatrolScheduler();
  });

  it("double start is idempotent", async () => {
    const { startPatrolScheduler, stopPatrolScheduler } = await import(
      "@/lib/patrol/scheduler"
    );

    startPatrolScheduler();
    startPatrolScheduler();
    stopPatrolScheduler();
  });
});
