"use server";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { patrolResults } from "@/drizzle/schema";
import type { PatrolProbeResult, FingerprintDetails, PatrolVerdict } from "@/lib/patrol/types";

type PatrolResultRow = typeof patrolResults.$inferSelect;

export interface PatrolResultInsert {
  providerId: number;
  inspectionType: "quick_probe" | "deep_fingerprint";
  score: number;
  verdict: PatrolVerdict;
  probeDetails: PatrolProbeResult[];
  fingerprintDetails?: FingerprintDetails | null;
  actionTaken?: "none" | "circuit_open" | "disable" | "notify_only" | "recovered" | null;
  latencyMs?: number;
  errorMessage?: string | null;
}

export async function insertPatrolResult(data: PatrolResultInsert): Promise<PatrolResultRow> {
  const [created] = await db
    .insert(patrolResults)
    .values({
      providerId: data.providerId,
      inspectionType: data.inspectionType,
      score: data.score,
      verdict: data.verdict,
      probeDetails: data.probeDetails,
      fingerprintDetails: data.fingerprintDetails ?? null,
      actionTaken: data.actionTaken ?? null,
      latencyMs: data.latencyMs ?? null,
      errorMessage: data.errorMessage ?? null,
    })
    .returning();
  return created!;
}

export interface PatrolResultQuery {
  providerId?: number;
  verdict?: PatrolVerdict;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export async function getPatrolResults(query: PatrolResultQuery): Promise<PatrolResultRow[]> {
  const conditions = [];

  if (query.providerId !== undefined) {
    conditions.push(eq(patrolResults.providerId, query.providerId));
  }
  if (query.verdict) {
    conditions.push(eq(patrolResults.verdict, query.verdict));
  }
  if (query.startDate) {
    conditions.push(gte(patrolResults.createdAt, query.startDate));
  }
  if (query.endDate) {
    conditions.push(lte(patrolResults.createdAt, query.endDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(patrolResults)
    .where(whereClause)
    .orderBy(desc(patrolResults.createdAt))
    .limit(query.limit ?? 50)
    .offset(query.offset ?? 0);
}

export async function getLatestResultByProvider(
  providerId: number
): Promise<PatrolResultRow | null> {
  const [row] = await db
    .select()
    .from(patrolResults)
    .where(eq(patrolResults.providerId, providerId))
    .orderBy(desc(patrolResults.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getPatrolResultCount(query: PatrolResultQuery): Promise<number> {
  const conditions = [];
  if (query.providerId !== undefined) {
    conditions.push(eq(patrolResults.providerId, query.providerId));
  }
  if (query.verdict) {
    conditions.push(eq(patrolResults.verdict, query.verdict));
  }
  if (query.startDate) {
    conditions.push(gte(patrolResults.createdAt, query.startDate));
  }
  if (query.endDate) {
    conditions.push(lte(patrolResults.createdAt, query.endDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(patrolResults)
    .where(whereClause);
  return Number(result?.count ?? 0);
}
