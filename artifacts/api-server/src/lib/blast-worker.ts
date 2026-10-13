import { and, count, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, pool, campaignsTable, contactsTable, blastJobsTable, blastJobSessionsTable, transactionsTable, usersTable, waSessionsTable } from "@workspace/db";
import { logger } from "./logger";
import { publishUserEvent, sendWhatsAppMessage } from "./baileys-manager";
import { getAppSettings } from "./app-settings";

const activeRuns = new Map<
  string,
  { controller: AbortController; done: Promise<void> }
>();

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
          AND (
            status = 'unsent'
            OR (
              status = 'pending'
              AND message_id IS NULL
              AND locked_at < NOW() - INTERVAL '20 minutes'
            )
          )
          AND message_id IS NULL
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
        isNull(contactsTable.messageId),
      ),
    );
}

export async function getBlastJobProgress(jobId: string) {
  const [job] = await db
    .select()
    .from(blastJobsTable)
    .where(eq(blastJobsTable.id, jobId))
    .limit(1);
  if (!job) return null;
  const sessions = await db
    .select({
      waSessionId: blastJobSessionsTable.waSessionId,
      phone: waSessionsTable.phone,
      status: blastJobSessionsTable.status,
      sent: blastJobSessionsTable.sent,
      failed: blastJobSessionsTable.failed,
    })
    .from(blastJobSessionsTable)
    .leftJoin(
      waSessionsTable,
      eq(blastJobSessionsTable.waSessionId, waSessionsTable.id),
    )
    .where(eq(blastJobSessionsTable.blastJobId, jobId));
  return { ...job, sessions };
}

async function updateProgress(jobId: string, userId: string) {
  const job = await getBlastJobProgress(jobId);
  if (job) publishUserEvent(userId, "blast:progress", job);
}

async function settleRunningBalance(jobId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(blastJobsTable)
      .where(eq(blastJobsTable.id, jobId))
      .for("update")
      .limit(1);
    if (!job || job.settledAt) return;

    if (job.runningBalance > 0) {
      await tx
        .update(usersTable)
        .set({
          runningBalance: sql`GREATEST(${usersTable.runningBalance} - ${job.runningBalance}, 0)`,
          mainBalance: sql`${usersTable.mainBalance} + ${job.runningBalance}`,
        })
        .where(eq(usersTable.id, userId));
      await tx
        .update(transactionsTable)
        .set({ status: "main" })
        .where(
          and(
            eq(transactionsTable.refJobId, jobId),
            eq(transactionsTable.type, "earning"),
            eq(transactionsTable.status, "running"),
          ),
        );
    }
    await tx
      .update(blastJobsTable)
      .set({ runningBalance: 0, settledAt: new Date() })
      .where(and(eq(blastJobsTable.id, jobId), isNull(blastJobsTable.settledAt)));
  });
}

async function finishBlast(
  jobId: string,
  userId: string,
  controller: AbortController,
): Promise<void> {
  const workerRows = await db
    .select()
    .from(blastJobSessionsTable)
    .where(eq(blastJobSessionsTable.blastJobId, jobId));
  const nextStatus = controller.signal.aborted
    ? "cancelled"
    : workerRows.every((worker) => worker.status === "failed") &&
        workerRows.length > 0
      ? "failed"
      : "completed";
  await db
    .update(blastJobsTable)
    .set({
      status: nextStatus,
      finishedAt: new Date(),
      cancelledAt: nextStatus === "cancelled" ? new Date() : null,
    })
    .where(and(eq(blastJobsTable.id, jobId), eq(blastJobsTable.status, "running")));
  await settleRunningBalance(jobId, userId);
  activeRuns.delete(jobId);
  await updateProgress(jobId, userId);
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
  let sessionStatus = "completed";
  let emptyClaimAttempts = 0;

  try {
    while (!controller.signal.aborted) {
      const [job] = await db
        .select()
        .from(blastJobsTable)
        .where(eq(blastJobsTable.id, jobId))
        .limit(1);
      if (!job || job.status !== "running") break;

      const [session] = await db
        .select({ status: waSessionsTable.status, phone: waSessionsTable.phone })
        .from(waSessionsTable)
        .where(and(eq(waSessionsTable.id, sessionId), eq(waSessionsTable.userId, userId)))
        .limit(1);
      if (!session || session.status !== "online") {
        if (settings.allowDisconnectRequeue) {
          await releaseLocks(userId, sessionId);
        }
        sessionStatus = settings.allowDisconnectRequeue ? "offline" : "failed";
        break;
      }

      if (await countSentLastHour(sessionId) >= settings.maxMessagesPerSessionPerHour) {
        await releaseLocks(userId, sessionId);
        sessionStatus = "paused";
        break;
      }

      const contact = await claimNextContact(campaignId, userId, sessionId);
      if (!contact) {
        if (emptyClaimAttempts < 3) {
          emptyClaimAttempts += 1;
          await delay(700 + Math.floor(Math.random() * 350), controller.signal);
          continue;
        }
        break;
      }
      emptyClaimAttempts = 0;

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
        sessionStatus = "paused";
        break;
      }

      let messageId: string | null;
      try {
        messageId = await sendWhatsAppMessage(
          sessionId,
          userId,
          session.phone ?? "",
          contact.phone,
          {
          text: campaign.messageText,
          imageUrl: campaign.imageUrl,
          ctaUrl: campaign.ctaUrl,
          },
        );
        if (!messageId) throw new Error("WhatsApp tidak mengembalikan ID pesan.");
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
          await tx
            .update(blastJobSessionsTable)
            .set({ failed: sql`${blastJobSessionsTable.failed} + 1` })
            .where(
              and(
                eq(blastJobSessionsTable.blastJobId, jobId),
                eq(blastJobSessionsTable.waSessionId, sessionId),
              ),
            );
        });
        await updateProgress(jobId, userId);
        if (!controller.signal.aborted) {
          await delay(
            delaySeconds * 1000 + Math.floor(Math.random() * 350),
            controller.signal,
          );
        }
        continue;
      }

      await db
        .update(contactsTable)
        .set({ messageId })
        .where(
          and(
            eq(contactsTable.id, contact.id),
            eq(contactsTable.status, "pending"),
            isNull(contactsTable.messageId),
          ),
        );

      await db.transaction(async (tx) => {
        const [claimedContact] = await tx
          .update(contactsTable)
          .set({
            status: "sent",
            sentAt: new Date(),
            waSenderPhone: session.phone,
            errorReason: null,
            lockedByUserId: null,
            lockedAt: null,
          })
          .where(
            and(
              eq(contactsTable.id, contact.id),
              eq(contactsTable.status, "pending"),
              eq(contactsTable.messageId, messageId),
            ),
          )
          .returning({ id: contactsTable.id });
        if (!claimedContact) return;

        const [earning] = await tx
          .insert(transactionsTable)
          .values({
            userId,
            type: "earning",
            amount: settings.perMessage,
            status: "running",
            refId: contact.id,
            refJobId: jobId,
            description: "Penghasilan pesan kampanye yang berhasil dikirim.",
          })
          .onConflictDoNothing()
          .returning({ id: transactionsTable.id });

        if (earning) {
          await tx
            .update(usersTable)
            .set({
              runningBalance: sql`${usersTable.runningBalance} + ${settings.perMessage}`,
            })
            .where(eq(usersTable.id, userId));
          await tx
            .update(blastJobsTable)
            .set({
              runningBalance: sql`${blastJobsTable.runningBalance} + ${settings.perMessage}`,
            })
            .where(eq(blastJobsTable.id, jobId));
        }

        const [sender] = await tx
          .select({ referredBy: usersTable.referredBy })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (sender?.referredBy) {
          const [bonus] = await tx
            .insert(transactionsTable)
            .values({
              userId: sender.referredBy,
              type: "referral",
              amount: settings.referralBonus,
              status: "main",
              refId: contact.id,
              refJobId: jobId,
              description: "Bonus referral langsung dari pesan yang berhasil dikirim.",
            })
            .onConflictDoNothing()
            .returning({ id: transactionsTable.id });
          if (bonus) {
            await tx
              .update(usersTable)
              .set({
                mainBalance: sql`${usersTable.mainBalance} + ${settings.referralBonus}`,
              })
              .where(eq(usersTable.id, sender.referredBy));
          }
        }

        await tx
          .update(campaignsTable)
          .set({ sentCount: sql`${campaignsTable.sentCount} + 1` })
          .where(eq(campaignsTable.id, campaignId));
        await tx
          .update(blastJobsTable)
          .set({
            sent: sql`${blastJobsTable.sent} + 1`,
            pending: sql`GREATEST(${blastJobsTable.pending} - 1, 0)`,
          })
          .where(eq(blastJobsTable.id, jobId));
        await tx
          .update(blastJobSessionsTable)
          .set({ sent: sql`${blastJobSessionsTable.sent} + 1` })
          .where(
            and(
              eq(blastJobSessionsTable.blastJobId, jobId),
              eq(blastJobSessionsTable.waSessionId, sessionId),
            ),
          );
      });

      await updateProgress(jobId, userId);
      if (!controller.signal.aborted) {
        await delay(
          delaySeconds * 1000 + Math.floor(Math.random() * 350),
          controller.signal,
        );
      }
    }
  } catch (error) {
    logger.error({ jobId, error }, "Blast worker failed");
    sessionStatus = "failed";
  } finally {
    if (controller.signal.aborted) {
      await releaseLocks(userId, sessionId);
      sessionStatus = "cancelled";
    }
    await db
      .update(blastJobSessionsTable)
      .set({ status: sessionStatus })
      .where(
        and(
          eq(blastJobSessionsTable.blastJobId, jobId),
          eq(blastJobSessionsTable.waSessionId, sessionId),
        ),
      );
    await updateProgress(jobId, userId);
  }
}

export async function startBlast(
  userId: string,
  delaySeconds: number,
) {
  const [activeCampaign] = await db
    .select()
    .from(campaignsTable)
    .where(and(eq(campaignsTable.isActive, true), eq(campaignsTable.status, "active")))
    .limit(1);
  if (!activeCampaign) throw new Error("Admin belum memilih campaign aktif.");

  const sessions = await db
    .select()
    .from(waSessionsTable)
    .where(and(eq(waSessionsTable.userId, userId), eq(waSessionsTable.status, "online")));
  if (sessions.length === 0) {
    throw new Error("Hubungkan setidaknya satu sesi WhatsApp sebelum memulai blast.");
  }

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
        sql`(
          ${contactsTable.status} = 'unsent'
          OR (
            ${contactsTable.status} = 'pending'
            AND ${contactsTable.messageId} IS NULL
            AND ${contactsTable.lockedAt} < NOW() - INTERVAL '20 minutes'
          )
        )`,
        isNotNull(contactsTable.consentAt),
        isNotNull(contactsTable.consentSource),
        isNull(contactsTable.consentRevokedAt),
        sql`(${contactsTable.lockedAt} IS NULL OR ${contactsTable.lockedAt} < NOW() - INTERVAL '20 minutes')`,
      ),
    );
  const total = eligible?.value ?? 0;
  const job = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update")
      .limit(1);
    if (!user) throw new Error("Akun tidak ditemukan.");
    const [current] = await tx
      .select({ id: blastJobsTable.id })
      .from(blastJobsTable)
      .where(and(eq(blastJobsTable.userId, userId), eq(blastJobsTable.status, "running")))
      .for("update")
      .limit(1);
    if (current) throw new Error("Blast lain masih berjalan.");

    const [created] = await tx
      .insert(blastJobsTable)
      .values({
        userId,
        campaignId: activeCampaign.id,
        waSessionId: sessions[0]!.id,
        delaySeconds,
        total,
        pending: total,
        runningBalance: 0,
        settledAt: total > 0 ? null : new Date(),
        status: total > 0 ? "running" : "completed",
        finishedAt: total > 0 ? null : new Date(),
      })
      .returning();
    if (!created) throw new Error("Blast tidak dapat dibuat.");
    await tx.insert(blastJobSessionsTable).values(
      sessions.map((session) => ({
        blastJobId: created.id,
        waSessionId: session.id,
        status: total > 0 ? "running" : "completed",
      })),
    );
    return created;
  });
  if (!job) throw new Error("Blast tidak dapat dibuat.");

  if (total > 0) {
    const controller = new AbortController();
    const done = Promise.all(
      sessions.map((session) =>
        runBlast(
          job.id,
          userId,
          activeCampaign.id,
          session.id,
          delaySeconds,
          controller,
        ),
      ),
    ).then(() => finishBlast(job.id, userId, controller));
    activeRuns.set(job.id, { controller, done });
    void done.catch((error: unknown) => {
      logger.error({ jobId: job.id, error }, "Could not finalize blast");
    });
  }
  return (await getBlastJobProgress(job.id)) ?? job;
}

export async function cancelCurrentBlast(userId: string) {
  const [job] = await db
    .select()
    .from(blastJobsTable)
    .where(and(eq(blastJobsTable.userId, userId), eq(blastJobsTable.status, "running")))
    .limit(1);
  if (!job) return null;
  const active = activeRuns.get(job.id);
  if (active) {
    active.controller.abort();
    await active.done;
  } else {
    const sessions = await db
      .select({ waSessionId: blastJobSessionsTable.waSessionId })
      .from(blastJobSessionsTable)
      .where(eq(blastJobSessionsTable.blastJobId, job.id));
    await Promise.all(
      sessions.map((session) => releaseLocks(userId, session.waSessionId)),
    );
    await db
      .update(blastJobsTable)
      .set({ status: "cancelled", cancelledAt: new Date(), finishedAt: new Date() })
      .where(and(eq(blastJobsTable.id, job.id), eq(blastJobsTable.status, "running")));
    await settleRunningBalance(job.id, userId);
  }
  return getBlastJobProgress(job.id);
}
