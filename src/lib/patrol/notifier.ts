import { logger } from "@/lib/logger";
import type { PatrolActionType, PatrolConfig, PatrolProbeResult, PatrolVerdict } from "./types";

export interface PatrolAlertData {
  providerId: number;
  providerName: string;
  score: number;
  verdict: PatrolVerdict;
  actionTaken: PatrolActionType;
  failedProbes: string[];
  inspectionType: "quick_probe" | "deep_fingerprint";
  timestamp: string;
}

export function shouldNotify(
  verdict: PatrolVerdict,
  actionTaken: PatrolActionType,
  config: PatrolConfig
): boolean {
  if (actionTaken === "recovered" && config.notifyOnRecovery) return true;
  if (verdict === "warning" && config.notifyOnWarning) return true;
  if (verdict === "critical" && config.notifyOnCritical) return true;
  if (verdict === "counterfeit" && config.notifyOnCounterfeit) return true;
  return false;
}

export function buildAlertData(
  providerId: number,
  providerName: string,
  score: number,
  verdict: PatrolVerdict,
  actionTaken: PatrolActionType,
  probeResults: PatrolProbeResult[],
  inspectionType: "quick_probe" | "deep_fingerprint"
): PatrolAlertData {
  return {
    providerId,
    providerName,
    score,
    verdict,
    actionTaken,
    failedProbes: probeResults.filter((p) => !p.passed).map((p) => p.label),
    inspectionType,
    timestamp: new Date().toISOString(),
  };
}

export async function sendPatrolAlert(
  alertData: PatrolAlertData,
  config: PatrolConfig
): Promise<void> {
  if (!shouldNotify(alertData.verdict, alertData.actionTaken, config)) {
    return;
  }

  try {
    const { getRedisClient } = await import("@/lib/redis/client");
    const redis = getRedisClient();

    if (redis) {
      const dedupKey = `cch:patrol:alert:dedup:${alertData.providerId}:${alertData.verdict}`;
      const exists = await redis.get(dedupKey);
      if (exists) {
        logger.info({
          action: "patrol_alert_dedup",
          providerId: alertData.providerId,
          verdict: alertData.verdict,
        });
        return;
      }
      await redis.set(dedupKey, "1", "EX", config.cooldownMinutes * 60);
    }

    const { getEnabledBindingsByType } = await import("@/repository/notification-bindings");
    const bindings = await getEnabledBindingsByType("patrol_alert");

    if (bindings.length === 0) {
      logger.info({
        action: "patrol_alert_skipped",
        providerId: alertData.providerId,
        reason: "no_bindings",
      });
      return;
    }

    const { addNotificationJobForTarget } = await import("@/lib/notification/notification-queue");
    for (const binding of bindings) {
      await addNotificationJobForTarget("patrol-alert", binding.targetId, binding.id, alertData);
    }

    logger.info({
      action: "patrol_alert_sent",
      providerId: alertData.providerId,
      verdict: alertData.verdict,
      targets: bindings.length,
    });
  } catch (error) {
    logger.error({
      action: "patrol_alert_error",
      providerId: alertData.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
