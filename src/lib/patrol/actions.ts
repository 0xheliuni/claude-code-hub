import type { PatrolActionType, PatrolConfig, PatrolVerdict } from "./types";

export async function executeAction(
  providerId: number,
  verdict: PatrolVerdict,
  config: PatrolConfig
): Promise<PatrolActionType> {
  if (verdict === "pass") {
    return handleRecovery(providerId, config);
  }

  const actionMap: Record<string, PatrolActionType> = {
    warning: config.actionOnWarning,
    critical: config.actionOnCritical,
    counterfeit: config.actionOnCounterfeit,
  };

  const action = actionMap[verdict] ?? "none";

  switch (action) {
    case "circuit_open":
      await openCircuit(providerId, verdict);
      break;
    case "disable":
      await disableProvider(providerId, verdict);
      break;
    case "notify_only":
    case "none":
      break;
  }

  const { resetConsecutivePass } = await import("@/repository/patrol-state");
  await resetConsecutivePass(providerId);

  return action;
}

async function openCircuit(providerId: number, verdict: PatrolVerdict): Promise<void> {
  const { recordFailure } = await import("@/lib/circuit-breaker");
  await recordFailure(
    providerId,
    new Error(`Patrol ${verdict}: circuit opened by patrol inspection`)
  );
}

async function disableProvider(providerId: number, verdict: PatrolVerdict): Promise<void> {
  const { db } = await import("@/drizzle/db");
  const { providers } = await import("@/drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { upsertProviderState } = await import("@/repository/patrol-state");

  await db.update(providers).set({ isEnabled: false }).where(eq(providers.id, providerId));

  await upsertProviderState(providerId, {
    lastVerdict: verdict,
    lastScore: 0,
    consecutivePassCount: 0,
    patrolDisabledReason: `Patrol verdict: ${verdict}`,
    patrolDisabledAt: new Date(),
  });
}

async function handleRecovery(providerId: number, config: PatrolConfig): Promise<PatrolActionType> {
  if (!config.autoRecoverEnabled) return "none";

  const { getProviderState, incrementConsecutivePass, clearPatrolDisabled } = await import(
    "@/repository/patrol-state"
  );

  const state = await getProviderState(providerId);
  if (!state?.patrolDisabledReason) {
    await incrementConsecutivePass(providerId);
    return "none";
  }

  const isCounterfeit = state.lastVerdict === "counterfeit";
  if (isCounterfeit && !config.autoRecoverCounterfeit) return "none";

  const newCount = await incrementConsecutivePass(providerId);
  if (newCount >= config.autoRecoverPasses) {
    const { db } = await import("@/drizzle/db");
    const { providers } = await import("@/drizzle/schema");
    const { eq } = await import("drizzle-orm");

    await db.update(providers).set({ isEnabled: true }).where(eq(providers.id, providerId));

    await clearPatrolDisabled(providerId);
    return "recovered";
  }

  return "none";
}
