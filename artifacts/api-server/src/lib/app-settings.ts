import { db, settingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export type AppSettings = {
  perMessage: number;
  referralBonus: number;
  minimumWithdrawal: number;
  pendingReleaseHours: number;
  maxMessagesPerSessionPerHour: number;
  allowDisconnectRequeue: boolean;
};

export const defaultSettings: AppSettings = {
  perMessage: 1100,
  referralBonus: 60,
  minimumWithdrawal: 15000,
  pendingReleaseHours: 24,
  maxMessagesPerSessionPerHour: 30,
  allowDisconnectRequeue: true,
};

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settingsTable);
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Partial<AppSettings>;
  return { ...defaultSettings, ...values };
}

export async function saveAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings();
  const next = { ...current, ...patch };
  await db
    .insert(settingsTable)
    .values(
      Object.entries(next).map(([key, value]) => ({
        key,
        value,
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: sql`excluded.value`, updatedAt: new Date() },
    });
  return next;
}
