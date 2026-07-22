"use server";

import { eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { patrolBaselines } from "@/drizzle/schema";
import type { FingerprintStats } from "@/lib/patrol/types";

type PatrolBaselineRow = typeof patrolBaselines.$inferSelect;

export interface PatrolBaselineInsert {
  modelName: string;
  providerType: string;
  label?: string;
  sampleCount: number;
  distribution: number[];
  stats: FingerprintStats;
  calibratedBy?: string;
  notes?: string;
}

export async function getAllBaselines(): Promise<PatrolBaselineRow[]> {
  return db.select().from(patrolBaselines);
}

export async function getBaselineByModel(
  modelName: string,
  providerType: string
): Promise<PatrolBaselineRow | null> {
  const [row] = await db
    .select()
    .from(patrolBaselines)
    .where(eq(patrolBaselines.modelName, modelName))
    .limit(1);

  if (row && row.providerType === providerType) return row;
  if (row) return row;
  return null;
}

export async function upsertBaseline(data: PatrolBaselineInsert): Promise<PatrolBaselineRow> {
  const existing = await getBaselineByModel(data.modelName, data.providerType);
  const now = new Date();

  if (existing) {
    const [updated] = await db
      .update(patrolBaselines)
      .set({
        label: data.label ?? existing.label,
        sampleCount: data.sampleCount,
        distribution: data.distribution,
        stats: data.stats,
        calibratedAt: now,
        calibratedBy: data.calibratedBy ?? existing.calibratedBy,
        notes: data.notes ?? existing.notes,
      })
      .where(eq(patrolBaselines.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(patrolBaselines)
    .values({
      modelName: data.modelName,
      providerType: data.providerType,
      label: data.label ?? null,
      sampleCount: data.sampleCount,
      distribution: data.distribution,
      stats: data.stats,
      calibratedAt: now,
      calibratedBy: data.calibratedBy ?? null,
      notes: data.notes ?? null,
    })
    .returning();
  return created!;
}

export async function deleteBaseline(id: number): Promise<boolean> {
  const result = await db
    .delete(patrolBaselines)
    .where(eq(patrolBaselines.id, id))
    .returning();
  return result.length > 0;
}
