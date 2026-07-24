import type { Context } from "hono";
import { createProblemResponse } from "@/lib/api/v1/_shared/error-envelope";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";

export async function getPatrolStatus(_c: Context): Promise<Response> {
  const { resolveConfig } = await import("@/lib/patrol/config");
  const { getPatrolResults } = await import("@/repository/patrol-results");

  const config = await resolveConfig(null);
  const recentResults = await getPatrolResults({ limit: 20 });

  return jsonResponse({
    enabled: config.enabled,
    providerCount: 0,
    lastRunAt: recentResults[0]?.createdAt?.toISOString() ?? null,
    recentResults: recentResults.map(formatResult),
  });
}

export async function getPatrolResults(c: Context): Promise<Response> {
  const { getPatrolResults: queryResults, getPatrolResultCount } = await import(
    "@/repository/patrol-results"
  );

  const url = new URL(c.req.url);
  const providerId = url.searchParams.get("providerId");
  const verdict = url.searchParams.get("verdict");
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const query = {
    providerId: providerId ? parseInt(providerId, 10) : undefined,
    verdict: verdict as "pass" | "warning" | "critical" | "counterfeit" | undefined,
    limit,
    offset,
  };

  const [results, total] = await Promise.all([queryResults(query), getPatrolResultCount(query)]);

  return jsonResponse({
    results: results.map(formatResult),
    total,
    limit,
    offset,
  });
}

export async function triggerPatrol(c: Context): Promise<Response> {
  const body = await c.req.json();
  const { triggerPatrolRun } = await import("@/lib/patrol");

  await triggerPatrolRun(body.providerId, body.inspectionType);
  return jsonResponse({ triggered: true });
}

export async function getGlobalConfig(_c: Context): Promise<Response> {
  const { resolveConfig } = await import("@/lib/patrol/config");
  const config = await resolveConfig(null);
  return jsonResponse(config);
}

export async function updateGlobalConfig(c: Context): Promise<Response> {
  const body = await c.req.json();
  const { upsertGlobalPatrolConfig } = await import("@/repository/patrol-configs");
  await upsertGlobalPatrolConfig(body);
  const { resolveConfig } = await import("@/lib/patrol/config");
  const updated = await resolveConfig(null);
  return jsonResponse(updated);
}

export async function getProviderConfig(c: Context): Promise<Response> {
  const providerId = parseInt(c.req.param("providerId") ?? "0", 10);
  const { getPatrolConfigByProvider } = await import("@/repository/patrol-configs");
  const { dbRowToConfigPartial } = await import("@/lib/patrol/config");
  const row = await getPatrolConfigByProvider(providerId);
  return jsonResponse(dbRowToConfigPartial(row) ?? {});
}

export async function updateProviderConfig(c: Context): Promise<Response> {
  const providerId = parseInt(c.req.param("providerId") ?? "0", 10);
  const body = await c.req.json();
  const { upsertProviderPatrolConfig } = await import("@/repository/patrol-configs");
  await upsertProviderPatrolConfig(providerId, body);
  const { resolveConfig } = await import("@/lib/patrol/config");
  const updated = await resolveConfig(providerId);
  return jsonResponse(updated);
}

export async function deleteProviderConfig(c: Context): Promise<Response> {
  const providerId = parseInt(c.req.param("providerId") ?? "0", 10);
  const { deleteProviderPatrolConfig } = await import("@/repository/patrol-configs");
  await deleteProviderPatrolConfig(providerId);
  return jsonResponse({ deleted: true });
}

export async function listBaselines(_c: Context): Promise<Response> {
  const { getAllBaselines } = await import("@/repository/patrol-baselines");
  const baselines = await getAllBaselines();
  return jsonResponse(
    baselines.map((b) => ({
      id: b.id,
      modelName: b.modelName,
      label: b.label,
      providerType: b.providerType,
      sampleCount: b.sampleCount,
      calibratedAt: b.calibratedAt?.toISOString() ?? null,
      calibratedBy: b.calibratedBy,
      notes: b.notes,
    }))
  );
}

export async function deleteBaseline(c: Context): Promise<Response> {
  const id = parseInt(c.req.param("id") ?? "0", 10);
  const { deleteBaseline: delFn } = await import("@/repository/patrol-baselines");
  const ok = await delFn(id);
  if (!ok)
    return createProblemResponse({
      status: 404,
      instance: "/patrol/baselines",
      errorCode: "patrol.baseline_not_found",
      detail: "Baseline not found",
    });
  return jsonResponse({ deleted: true });
}

export async function recoverProvider(c: Context): Promise<Response> {
  const providerId = parseInt(c.req.param("providerId") ?? "0", 10);
  const { db } = await import("@/drizzle/db");
  const { providers } = await import("@/drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { clearPatrolDisabled } = await import("@/repository/patrol-state");

  await db.update(providers).set({ isEnabled: true }).where(eq(providers.id, providerId));
  await clearPatrolDisabled(providerId);
  return jsonResponse({ recovered: true, providerId });
}

export async function listProbes(_c: Context): Promise<Response> {
  const { getAllProbes } = await import("@/lib/patrol/probes");
  const probes = getAllProbes();
  return jsonResponse(
    probes.map((p) => ({
      name: p.name,
      label: p.label,
      category: p.category,
      defaultWeight: p.defaultWeight,
    }))
  );
}

function formatResult(row: Record<string, unknown>) {
  return {
    id: row.id,
    providerId: row.providerId,
    inspectionType: row.inspectionType,
    score: row.score,
    verdict: row.verdict,
    probeDetails: row.probeDetails,
    actionTaken: row.actionTaken ?? null,
    latencyMs: row.latencyMs ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : (row.createdAt ?? null),
  };
}
