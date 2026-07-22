"use server";

import { eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { patrolProviderState } from "@/drizzle/schema";
import type { PatrolVerdict } from "@/lib/patrol/types";

type PatrolStateRow = typeof patrolProviderState.$inferSelect;

export async function getProviderState(providerId: number): Promise<PatrolStateRow | null> {
  const [row] = await db
    .select()
    .from(patrolProviderState)
    .where(eq(patrolProviderState.providerId, providerId))
    .limit(1);
  return row ?? null;
}

export async function upsertProviderState(
  providerId: number,
  data: {
    lastVerdict: PatrolVerdict;
    lastScore: number;
    consecutivePassCount?: number;
    patrolDisabledReason?: string | null;
    patrolDisabledAt?: Date | null;
  }
): Promise<PatrolStateRow> {
  const existing = await getProviderState(providerId);
  const now = new Date();

  if (existing) {
    const [updated] = await db
      .update(patrolProviderState)
      .set({
        lastVerdict: data.lastVerdict,
        lastScore: data.lastScore,
        lastInspectedAt: now,
        consecutivePassCount: data.consecutivePassCount ?? existing.consecutivePassCount,
        patrolDisabledReason: data.patrolDisabledReason ?? existing.patrolDisabledReason,
        patrolDisabledAt: data.patrolDisabledAt ?? existing.patrolDisabledAt,
      })
      .where(eq(patrolProviderState.providerId, providerId))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(patrolProviderState)
    .values({
      providerId,
      lastVerdict: data.lastVerdict,
      lastScore: data.lastScore,
      lastInspectedAt: now,
      consecutivePassCount: data.consecutivePassCount ?? 0,
      patrolDisabledReason: data.patrolDisabledReason ?? null,
      patrolDisabledAt: data.patrolDisabledAt ?? null,
    })
    .returning();
  return created!;
}

export async function incrementConsecutivePass(providerId: number): Promise<number> {
  const state = await getProviderState(providerId);
  const newCount = (state?.consecutivePassCount ?? 0) + 1;

  if (state) {
    await db
      .update(patrolProviderState)
      .set({ consecutivePassCount: newCount, lastInspectedAt: new Date() })
      .where(eq(patrolProviderState.providerId, providerId));
  } else {
    await db.insert(patrolProviderState).values({
      providerId,
      consecutivePassCount: newCount,
      lastInspectedAt: new Date(),
    });
  }

  return newCount;
}

export async function resetConsecutivePass(providerId: number): Promise<void> {
  const state = await getProviderState(providerId);
  if (state) {
    await db
      .update(patrolProviderState)
      .set({ consecutivePassCount: 0 })
      .where(eq(patrolProviderState.providerId, providerId));
  }
}

export async function clearPatrolDisabled(providerId: number): Promise<void> {
  const state = await getProviderState(providerId);
  if (state) {
    await db
      .update(patrolProviderState)
      .set({ patrolDisabledReason: null, patrolDisabledAt: null })
      .where(eq(patrolProviderState.providerId, providerId));
  }
}
