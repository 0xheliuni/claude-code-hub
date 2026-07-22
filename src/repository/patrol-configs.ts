"use server";

import { eq, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { patrolConfigs } from "@/drizzle/schema";

type PatrolConfigRow = typeof patrolConfigs.$inferSelect;

export async function getGlobalPatrolConfig(): Promise<PatrolConfigRow | null> {
  const [row] = await db
    .select()
    .from(patrolConfigs)
    .where(isNull(patrolConfigs.providerId))
    .limit(1);
  return row ?? null;
}

export async function getPatrolConfigByProvider(
  providerId: number
): Promise<PatrolConfigRow | null> {
  const [row] = await db
    .select()
    .from(patrolConfigs)
    .where(eq(patrolConfigs.providerId, providerId))
    .limit(1);
  return row ?? null;
}

export async function upsertGlobalPatrolConfig(
  data: Partial<Omit<PatrolConfigRow, "id" | "providerId" | "createdAt" | "updatedAt">>
): Promise<PatrolConfigRow> {
  const existing = await getGlobalPatrolConfig();
  const now = new Date();

  if (existing) {
    const [updated] = await db
      .update(patrolConfigs)
      .set({ ...data, updatedAt: now })
      .where(eq(patrolConfigs.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(patrolConfigs)
    .values({ ...data, providerId: null, updatedAt: now })
    .returning();
  return created!;
}

export async function upsertProviderPatrolConfig(
  providerId: number,
  data: Partial<Omit<PatrolConfigRow, "id" | "providerId" | "createdAt" | "updatedAt">>
): Promise<PatrolConfigRow> {
  const existing = await getPatrolConfigByProvider(providerId);
  const now = new Date();

  if (existing) {
    const [updated] = await db
      .update(patrolConfigs)
      .set({ ...data, updatedAt: now })
      .where(eq(patrolConfigs.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(patrolConfigs)
    .values({ ...data, providerId, updatedAt: now })
    .returning();
  return created!;
}

export async function deleteProviderPatrolConfig(providerId: number): Promise<boolean> {
  const result = await db
    .delete(patrolConfigs)
    .where(eq(patrolConfigs.providerId, providerId))
    .returning();
  return result.length > 0;
}
