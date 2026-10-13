import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  GetReferralsResponse,
  GetWalletResponse,
  ListWithdrawalsResponse,
  RequestWithdrawalBody,
  RequestWithdrawalResponse,
  UpdateWithdrawalBody,
  UpdateWithdrawalParams,
  UpdateWithdrawalResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  db,
  transactionsTable,
  usersTable,
  withdrawalsTable,
} from "@workspace/db";
import { getAppSettings } from "../lib/app-settings";
import { requireAdmin, requireAuth } from "../lib/auth";
import {
  decryptPrivateValue,
  encryptPrivateValue,
  maskAccountNumber,
} from "../lib/secure-fields";

const router: IRouter = Router();
router.use(requireAuth);

function withdrawalDto(
  item: typeof withdrawalsTable.$inferSelect,
  includeFullAccount = false,
) {
  const accountNumber = decryptPrivateValue(item.accountNumber);
  return {
    id: item.id,
    amount: item.amount,
    method: item.method,
    accountName: item.accountName,
    accountNumberMasked: maskAccountNumber(accountNumber),
    ...(includeFullAccount ? { accountNumber } : {}),
    status: item.status,
    note: item.note,
    createdAt: item.createdAt,
  };
}

router.get("/wallet", async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.auth!.userId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "Akun tidak ditemukan." });
    return;
  }
  const transactions = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, user.id))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(30);
  const [lifetime] = await db
    .select({ value: sql<number>`COALESCE(SUM(${transactionsTable.amount}), 0)` })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.userId, user.id),
        eq(transactionsTable.type, "earning"),
      ),
    );
  const [referrals] = await db
    .select({ value: sql<number>`COALESCE(SUM(${transactionsTable.amount}), 0)` })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.userId, user.id),
        eq(transactionsTable.type, "referral"),
      ),
    );
  const settings = await getAppSettings();
  res.json(
    GetWalletResponse.parse({
      mainBalance: user.mainBalance,
      pendingBalance: user.pendingBalance,
      runningBalance: user.runningBalance,
      lifetimeEarnings: Number(lifetime?.value ?? 0),
      referralEarnings: Number(referrals?.value ?? 0),
      perMessage: settings.perMessage,
      minimumWithdrawal: settings.minimumWithdrawal,
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        description: transaction.description,
        createdAt: transaction.createdAt,
      })),
    }),
  );
});

router.get("/referrals", async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.auth!.userId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "Akun tidak ditemukan." });
    return;
  }
  const downlines = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.referredBy, user.id))
    .orderBy(desc(usersTable.createdAt))
    .limit(100);
  const downlineDtos = await Promise.all(
    downlines.map(async (downline) => {
      const [sent] = await db
        .select({ value: count() })
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.userId, downline.id),
            eq(transactionsTable.type, "earning"),
          ),
        );
      const [earned] = await db
        .select({ value: sql<number>`COALESCE(SUM(${transactionsTable.amount}), 0)` })
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.userId, downline.id),
            eq(transactionsTable.type, "earning"),
          ),
        );
      return {
        name: downline.name,
        joinedAt: downline.createdAt,
        sentCount: sent?.value ?? 0,
        earnings: Number(earned?.value ?? 0),
      };
    }),
  );
  const [earned] = await db
    .select({ value: sql<number>`COALESCE(SUM(${transactionsTable.amount}), 0)` })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.userId, user.id),
        eq(transactionsTable.type, "referral"),
      ),
    );
  const settings = await getAppSettings();
  res.json(
    GetReferralsResponse.parse({
      code: user.referralCode,
      downlineCount: downlines.length,
      totalEarnings: Number(earned?.value ?? 0),
      bonusPerMessage: settings.referralBonus,
      downlines: downlineDtos,
    }),
  );
});

router.get("/withdrawals", async (req, res): Promise<void> => {
  const items = await db
    .select()
    .from(withdrawalsTable)
    .where(
      req.auth!.role === "admin"
        ? undefined
        : eq(withdrawalsTable.userId, req.auth!.userId),
    )
    .orderBy(desc(withdrawalsTable.createdAt));
  res.json(
    ListWithdrawalsResponse.parse(
      items.map((item) => withdrawalDto(item, req.auth!.role === "admin")),
    ),
  );
});

router.post("/withdrawals", async (req, res): Promise<void> => {
  const parsed = RequestWithdrawalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const settings = await getAppSettings();
  if (parsed.data.amount < settings.minimumWithdrawal) {
    res.status(400).json({
      error: `Penarikan minimum Rp${settings.minimumWithdrawal.toLocaleString("id-ID")}.`,
    });
    return;
  }
  let created: typeof withdrawalsTable.$inferSelect | undefined;
  try {
    created = await db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, req.auth!.userId))
        .for("update")
        .limit(1);
      if (!user || user.mainBalance < parsed.data.amount) {
        throw new Error("Saldo utama tidak mencukupi.");
      }
      await tx
        .update(usersTable)
        .set({ mainBalance: sql`${usersTable.mainBalance} - ${parsed.data.amount}` })
        .where(eq(usersTable.id, user.id));
      const [withdrawal] = await tx
        .insert(withdrawalsTable)
        .values({
          userId: user.id,
          amount: parsed.data.amount,
          method: parsed.data.method,
          accountName: parsed.data.accountName.trim(),
          accountNumber: encryptPrivateValue(parsed.data.accountNumber.trim()),
        })
        .returning();
      if (!withdrawal) throw new Error("Permintaan penarikan tidak tersimpan.");
      await tx.insert(transactionsTable).values({
        userId: user.id,
        type: "withdrawal",
        amount: withdrawal.amount,
        status: "pending",
        refId: withdrawal.id,
        description: `Penarikan ${withdrawal.method} — ${withdrawal.accountName}`,
      });
      await tx.insert(activityTable).values({
        userId: user.id,
        title: "Permintaan penarikan dibuat",
        detail: `Permintaan ${withdrawal.id} sebesar Rp${withdrawal.amount.toLocaleString("id-ID")} diajukan.`,
      });
      return withdrawal;
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Permintaan penarikan gagal.",
    });
    return;
  }
  res.status(201).json(
    RequestWithdrawalResponse.parse(withdrawalDto(created)),
  );
});

router.patch(
  "/admin/withdrawals/:withdrawalId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateWithdrawalParams.safeParse(req.params);
    const parsed = UpdateWithdrawalBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const [result] = await db.transaction(async (tx) => {
        const [withdrawal] = await tx
          .select()
          .from(withdrawalsTable)
          .where(eq(withdrawalsTable.id, params.data.withdrawalId))
          .for("update")
          .limit(1);
        if (!withdrawal) throw new Error("Permintaan tidak ditemukan.");
        const nextStatus = parsed.data.status;
        const allowed =
          (withdrawal.status === "pending" &&
            (nextStatus === "approved" || nextStatus === "rejected")) ||
          (withdrawal.status === "approved" &&
            (nextStatus === "paid" || nextStatus === "rejected"));
        if (!allowed) {
          throw new Error("Perubahan status tidak sesuai alur penarikan.");
        }
        if (nextStatus === "rejected" && !parsed.data.note?.trim()) {
          throw new Error("Alasan penolakan wajib diisi.");
        }
        const [updated] = await tx
          .update(withdrawalsTable)
          .set({
            status: nextStatus,
            note: parsed.data.note ?? null,
            processedAt: new Date(),
          })
          .where(eq(withdrawalsTable.id, withdrawal.id))
          .returning();
        if (!updated) throw new Error("Status permintaan tidak dapat diubah.");

        const [transaction] = await tx
          .select()
          .from(transactionsTable)
          .where(
            and(
              eq(transactionsTable.userId, withdrawal.userId),
              eq(transactionsTable.refId, withdrawal.id),
              eq(transactionsTable.type, "withdrawal"),
            ),
          )
          .limit(1);
        if (transaction) {
          await tx
            .update(transactionsTable)
            .set({
              status:
                nextStatus === "paid"
                  ? "completed"
                  : nextStatus === "rejected"
                    ? "rejected"
                    : "pending",
            })
            .where(eq(transactionsTable.id, transaction.id));
        }
        if (nextStatus === "rejected") {
          const [refund] = await tx
            .insert(transactionsTable)
            .values({
              userId: withdrawal.userId,
              type: "withdraw_refund",
              amount: withdrawal.amount,
              status: "main",
              refId: withdrawal.id,
              description: `Pengembalian dana untuk penarikan ${withdrawal.id}.`,
            })
            .onConflictDoNothing()
            .returning({ id: transactionsTable.id });
          if (!refund) {
            throw new Error("Pengembalian dana untuk permintaan ini sudah tercatat.");
          }
          await tx
            .update(usersTable)
            .set({ mainBalance: sql`${usersTable.mainBalance} + ${withdrawal.amount}` })
            .where(eq(usersTable.id, withdrawal.userId));
        }
        await tx.insert(activityTable).values({
          userId: withdrawal.userId,
          title:
            nextStatus === "approved"
              ? "Penarikan mulai diproses"
              : nextStatus === "paid"
                ? "Penarikan ditandai berhasil"
                : "Permintaan penarikan ditolak",
          detail: `Admin ${req.auth!.userId} mengubah permintaan ${withdrawal.id} dari ${withdrawal.status} menjadi ${nextStatus} (Rp${withdrawal.amount.toLocaleString("id-ID")}).${parsed.data.note ? ` Catatan: ${parsed.data.note}` : ""}`,
        });
        return [updated];
      });
      res.json(
        UpdateWithdrawalResponse.parse(
          withdrawalDto(result, true),
        ),
      );
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Status tidak dapat diubah.",
      });
    }
  },
);

export default router;
