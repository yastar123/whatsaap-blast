import { and, eq, lt, inArray, sql } from "drizzle-orm";
import {
  activityTable,
  db,
  transactionsTable,
  usersTable,
} from "@workspace/db";
import { getAppSettings } from "./app-settings";
import { logger } from "./logger";

let releaseTimer: NodeJS.Timeout | undefined;

export async function releaseMatureBalances(): Promise<number> {
  const settings = await getAppSettings();
  if (settings.pendingReleaseHours <= 0) return 0;
  const cutoff = new Date(
    Date.now() - settings.pendingReleaseHours * 60 * 60 * 1000,
  );
  return db.transaction(async (tx) => {
    const released = await tx
      .update(transactionsTable)
      .set({ status: "main" })
      .where(
        and(
          eq(transactionsTable.status, "pending"),
          inArray(transactionsTable.type, ["earning", "referral"]),
          lt(transactionsTable.createdAt, cutoff),
        ),
      )
      .returning({
        userId: transactionsTable.userId,
        amount: transactionsTable.amount,
      });
    const totals = new Map<string, number>();
    for (const item of released) {
      totals.set(item.userId, (totals.get(item.userId) ?? 0) + item.amount);
    }
    for (const [userId, amount] of totals) {
      await tx
        .update(usersTable)
        .set({
          pendingBalance: sql`GREATEST(${usersTable.pendingBalance} - ${amount}, 0)`,
          mainBalance: sql`${usersTable.mainBalance} + ${amount}`,
        })
        .where(eq(usersTable.id, userId));
    }
    if (released.length > 0) {
      await tx.insert(activityTable).values({
        title: "Saldo tertunda dicairkan",
        detail: `${released.length} transaksi masuk ke saldo utama secara otomatis.`,
      });
    }
    return released.length;
  });
}

export function startBalanceReleaseWorker(): void {
  if (releaseTimer) return;
  const run = () => {
    void releaseMatureBalances().catch((error: unknown) => {
      logger.error({ error }, "Could not release mature balances");
    });
  };
  run();
  releaseTimer = setInterval(run, 60_000);
  releaseTimer.unref();
}

export function stopBalanceReleaseWorker(): void {
  if (releaseTimer) clearInterval(releaseTimer);
  releaseTimer = undefined;
}
