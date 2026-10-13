import { and, count, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, pool, campaignsTable, contactsTable, blastJobsTable, transactionsTable, usersTable, waSessionsTable } from "@workspace/db";
import { logger } from "./logger";
import { publishUserEvent, sendWhatsAppMessage } from "./baileys-manager";
import { getAppSettings } from "./app-settings";

const activeRuns = new Map<string, AbortController>();

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function claimNextContact(
  campaignId: string,
  userId: string,
  sessionId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<{ id: string }>(
      `SELECT id
       FROM contacts
       WHERE campaign_id = $1
         AND status = 'unsent'
         AND consent_source IS NOT NULL
         AND consent_at IS NOT NULL
         AND consent_revoked_at IS NULL
         AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '20 minutes')
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [campaignId],
    );
    const contactId = selected.rows[0]?.id;
    if (!contactId) {
      await client.query("COMMIT");
      return null;
    }
    const updated = await client.query(
      `UPDATE contacts
       SET status = 'pending', locked_by_user_id = $2, locked_at = NOW(), wa_session_id = $3
       WHERE id = $1
       RETURNING id, phone`,
      [contactId, userId, sessionId],
    );
    await client.query("COMMIT");
    return updated.rows[0] as { id: string; phone: string } | undefined;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function countSentLastHour(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.waSessionId, sessionId),
        eq(contactsTable.status, "sent"),
        gte(contactsTable.sentAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  return row?.value ?? 0;
}

async function releaseLocks(userId: string, sessionId: string): Promise<void> {
  await db
    .update(contactsTable)
    .set({
      status: "unsent",
      lockedByUserId: null,
      lockedAt: null,
      waSessionId: null,
    })
    .where(
      and(
        eq(contactsTable.lockedByUserId, userId),
        eq(contactsTable.waSessionId, sessionId),
        eq(contactsTable.status, "pending"),
      ),
    );
}

async function recordEarning(
  userId: string,
  contactId: string,
  settings: Awaited<ReturnType<typeof getAppSettings>>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [sender] = await tx
      .select({ referredBy: usersTable.referredBy })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    await tx
      .update(usersTable)
      .set({ pendingBalance: sql`${usersTable.pendingBalance} + ${settings.perMessage}` })
      .where(eq(usersTable.id, userId));
    await tx.insert(transactionsTable).values({
      userId,
      type: "earning",
      amount: settings.perMessage,
      status: "pending",
      refId: contactId,
      description: "Pesan kampanye berhasil dikirim ke kontak yang menyetujui.",
    });

    if (sender?.referredBy) {
      await tx
        .update(usersTable)
        .set({ pendingBalance: sql`${usersTable.pendingBalance} + ${settings.referralBonus}` })
        .where(eq(usersTable.id, sender.referredBy));
      await tx.insert(transactionsTable).values({
        userId: sender.referredBy,
        type: "referral",
        amount: settings.referralBonus,
        status: "pending",
        refId: contactId,
        description: "Bonus referral dari pesan berizin yang berhasil dikirim.",
      });
    }
  });
}

async function updateProgress(jobId: string, userId: string) {
  const [job] = await db
    .select()
    .from(blastJobsTable)
    .where(eq(blastJobsTable.id, jobId))
    .limit(1);
  if (job) publishUserEvent(userId, "blast:progress", job);
}

async function runBlast(
  jobId: string,
  userId: string,
  campaignId: string,
  sessionId: string,
  delaySeconds: number,
  controller: AbortController,
): Promise<void> {
  const settings = await getAppSettings();
  let processedThisRun = 0;

  try {
    while (!controller.signal.aborted) {
      const [job] = await db
        .select()
        .from(blastJobsTable)
        .where(eq(blastJobsTable.id, jobId))
        .limit(1);
      if (!job || job.status !== "running") break;

      const [session] = await db
        .select({ status: waSessionsTable.status })
        .from(waSessionsTable)
        .where(and(eq(waSessionsTable.id, sessionId), eq(waSessionsTable.userId, userId)))
        .limit(1);
      if (!session || session.status !== "online") {
        if (settings.allowDisconnectRequeue) {
          await releaseLocks(userId, sessionId);
          await db
            .update(blastJobsTable)
            .set({ status: "completed", finishedAt: new Date() })
            .where(eq(blastJobsTable.id, jobId));
        } else {
          await db
            .update(blastJobsTable)
            .set({ status: "failed", finishedAt: new Date() })
            .where(eq(blastJobsTable.id, jobId));
        }
        break;
      }

      if (await countSentLastHour(sessionId) >= settings.maxMessagesPerSessionPerHour) {
        await releaseLocks(userId, sessionId);
        await db
          .update(blastJobsTable)
          .set({ status: "completed", finishedAt: new Date() })
          .where(eq(blastJobsTable.id, jobId));
        break;
      }

      const contact = await claimNextContact(campaignId, userId, sessionId);
      if (!contact) {
        await db
          .update(blastJobsTable)
          .set({ status: "completed", pending: 0, finishedAt: new Date() })
          .where(eq(blastJobsTable.id, jobId));
        break;
      }

      const [eligibility] = await db
        .select({
          consentAt: contactsTable.consentAt,
          consentSource: contactsTable.consentSource,
          consentRevokedAt: contactsTable.consentRevokedAt,
        })
        .from(contactsTable)
        .where(eq(contactsTable.id, contact.id))
        .limit(1);
      if (!eligibility?.consentAt || !eligibility.consentSource || eligibility.consentRevokedAt) {
        await db
          .update(contactsTable)
          .set({
            status: eligibility?.consentRevokedAt ? "opted_out" : "unsent",
            lockedByUserId: null,
            lockedAt: null,
            waSessionId: null,
          })
          .where(eq(contactsTable.id, contact.id));
        continue;
      }

      const [campaign] = await db
        .select()
        .from(campaignsTable)
        .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.isActive, true)))
        .limit(1);
      if (!campaign) {
        await db
          .update(contactsTable)
          .set({ status: "unsent", lockedByUserId: null, lockedAt: null, waSessionId: null })
          .where(eq(contactsTable.id, contact.id));
        await db
          .update(blastJobsTable)
          .set({ status: "completed", finishedAt: new Date() })
          .where(eq(blastJobsTable.id, jobId));
        break;
      }

      try {
        const messageId = await sendWhatsAppMessage(sessionId, userId, contact.phone, {
          text: campaign.messageText,
          imageUrl: campaign.imageUrl,
          ctaUrl: campaign.ctaUrl,
        });
        await db.transaction(async (tx) => {
          await tx
            .update(contactsTable)
            .set({
              status: "sent",
              sentAt: new Date(),
              messageId,
              errorReason: null,
              lockedByUserId: null,
              lockedAt: null,
            })
            .where(eq(contactsTable.id, contact.id));
          await tx
            .update(campaignsTable)
            .set({ sentCount: sql`${campaignsTable.sentCount} + 1` })
            .where(eq(campaignsTable.id, campaignId));
        });
        await recordEarning(userId, contact.id, settings);
        await db
          .update(blastJobsTable)
          .set({
            sent: sql`${blastJobsTable.sent} + 1`,
            pending: sql`GREATEST(${blastJobsTable.pending} - 1, 0)`,
          })
          .where(eq(blastJobsTable.id, jobId));
      } catch (error) {
        const message =
          error instanceof Error ? error.message.slice(0, 240) : "Pengiriman gagal.";
        await db.transaction(async (tx) => {
          await tx
            .update(contactsTable)
            .set({
              status: "failed",
              errorReason: message,
              lockedByUserId: null,
              lockedAt: null,
            })
            .where(eq(contactsTable.id, contact.id));
          await tx
            .update(campaignsTable)
            .set({ failedCount: sql`${campaignsTable.failedCount} + 1` })
            .where(eq(campaignsTable.id, campaignId));
          await tx
            .update(blastJobsTable)
            .set({
              failed: sql`${blastJobsTable.failed} + 1`,
              pending: sql`GREATEST(${blastJobsTable.pending} - 1, 0)`,
            })
            .where(eq(blastJobsTable.id, jobId));
        });
      }

      processedThisRun += 1;
      await updateProgress(jobId, userId);
      if (processedThisRun > 0 && !controller.signal.aborted) {
        await delay(delaySeconds * 1000, controller.signal);
      }
    }
  } catch (error) {
    logger.error({ jobId, error }, "Blast worker failed");
    await db
      .update(blastJobsTable)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(blastJobsTable.id, jobId));
  } finally {
    if (controller.signal.aborted) {
      await releaseLocks(userId, sessionId);
    }
    activeRuns.delete(jobId);
    await updateProgress(jobId, userId);
  }
}

export async function startBlast(
  userId: string,
  sessionId: string,
  delaySeconds: number,
) {
  const [activeCampaign] = await db
    .select()
    .from(campaignsTable)
    .where(and(eq(campaignsTable.isActive, true), eq(campaignsTable.status, "active")))
    .limit(1);
  if (!activeCampaign) throw new Error("Admin belum memilih campaign aktif.");

  const [session] = await db
    .select()
    .from(waSessionsTable)
    .where(
      and(
        eq(waSessionsTable.id, sessionId),
        eq(waSessionsTable.userId, userId),
        eq(waSessionsTable.status, "online"),
      ),
    )
    .limit(1);
  if (!session) throw new Error("Pilih sesi WhatsApp yang sedang online.");

  const [current] = await db
    .select({ id: blastJobsTable.id })
    .from(blastJobsTable)
    .where(and(eq(blastJobsTable.userId, userId), eq(blastJobsTable.status, "running")))
    .limit(1);
  if (current) throw new Error("Blast lain masih berjalan.");

  const [eligible] = await db
    .select({ value: count() })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.campaignId, activeCampaign.id),
        eq(contactsTable.status, "unsent"),
        isNotNull(contactsTable.consentAt),
        isNotNull(contactsTable.consentSource),
        isNull(contactsTable.consentRevokedAt),
        sql`(${contactsTable.lockedAt} IS NULL OR ${contactsTable.lockedAt} < NOW() - INTERVAL '20 minutes')`,
      ),
    );
  const total = eligible?.value ?? 0;
  const [job] = await db
    .insert(blastJobsTable)
    .values({
      userId,
      campaignId: activeCampaign.id,
      waSessionId: session.id,
      delaySeconds,
      total,
      pending: total,
      status: total > 0 ? "running" : "completed",
      finishedAt: total > 0 ? null : new Date(),
    })
    .returning();
  if (!job) throw new Error("Blast tidak dapat dibuat.");

  if (total > 0) {
    const controller = new AbortController();
    activeRuns.set(job.id, controller);
    void runBlast(job.id, userId, activeCampaign.id, session.id, delaySeconds, controller);
  }
  return job;
}

export async function cancelCurrentBlast(userId: string) {
  const [job] = await db
    .select()
    .from(blastJobsTable)
    .where(and(eq(blastJobsTable.userId, userId), eq(blastJobsTable.status, "running")))
    .limit(1);
  if (!job) return null;
  activeRuns.get(job.id)?.abort();
  await releaseLocks(userId, job.waSessionId);
  const [cancelled] = await db
    .update(blastJobsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), finishedAt: new Date() })
    .where(eq(blastJobsTable.id, job.id))
    .returning();
  return cancelled ?? null;
}
