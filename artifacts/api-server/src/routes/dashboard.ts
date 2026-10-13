import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  GetActiveCampaignResponse,
  GetDashboardOverviewResponse,
  ListCampaignsResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  campaignsTable,
  contactsTable,
  db,
  transactionsTable,
  usersTable,
  waSessionsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();
router.use(requireAuth);

async function campaignDto(campaign: typeof campaignsTable.$inferSelect) {
  const [contactTotal] = await db
    .select({ value: count() })
    .from(contactsTable)
    .where(eq(contactsTable.campaignId, campaign.id));
  const [sentCount] = await db
    .select({ value: count() })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.campaignId, campaign.id),
        eq(contactsTable.status, "sent"),
      ),
    );
  const [failedCount] = await db
    .select({ value: count() })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.campaignId, campaign.id),
        eq(contactsTable.status, "failed"),
      ),
    );
  return {
    ...campaign,
    contactTotal: contactTotal?.value ?? 0,
    sentCount: sentCount?.value ?? 0,
    failedCount: failedCount?.value ?? 0,
  };
}

router.get("/campaigns/active", async (_req, res): Promise<void> => {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.isActive, true))
    .limit(1);
  res.json(
    GetActiveCampaignResponse.parse({
      campaign: campaign ? await campaignDto(campaign) : null,
    }),
  );
});

router.get("/admin/campaigns", async (req, res, next): Promise<void> => {
  if (req.auth!.role === "admin") {
    next();
    return;
  }
  const sentCampaigns = await db
    .selectDistinct({ campaignId: contactsTable.campaignId })
    .from(contactsTable)
    .where(eq(contactsTable.lockedByUserId, req.auth!.userId));
  if (sentCampaigns.length === 0) {
    res.json(ListCampaignsResponse.parse([]));
    return;
  }
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .where(inArray(campaignsTable.id, sentCampaigns.map((row) => row.campaignId)));
  res.json(
    ListCampaignsResponse.parse(
      await Promise.all(campaigns.map(campaignDto)),
    ),
  );
});

router.get("/dashboard/overview", async (req, res): Promise<void> => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.role === "admin";
  const [
    customerCount,
    onlineCount,
    sentCount,
    paid,
    sentByMe,
    failedByMe,
    currentUser,
    activeCampaign,
    recentActivity,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(usersTable)
      .where(eq(usersTable.role, "customer")),
    db
      .select({ value: count() })
      .from(waSessionsTable)
      .where(
        and(
          eq(waSessionsTable.status, "online"),
          isAdmin ? undefined : eq(waSessionsTable.userId, userId),
        ),
      ),
    db
      .select({ value: count() })
      .from(contactsTable)
      .where(eq(contactsTable.status, "sent")),
    db
      .select({ value: sql<number>`COALESCE(SUM(${transactionsTable.amount}), 0)` })
      .from(transactionsTable)
      .where(eq(transactionsTable.type, "earning")),
    db
      .select({ value: count() })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.status, "sent"),
          isAdmin ? undefined : eq(contactsTable.lockedByUserId, userId),
        ),
      ),
    db
      .select({ value: count() })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.status, "failed"),
          isAdmin ? undefined : eq(contactsTable.lockedByUserId, userId),
        ),
      ),
    db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1),
    db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.isActive, true))
      .limit(1),
    db.select().from(activityTable).orderBy(desc(activityTable.createdAt)).limit(8),
  ]);
  const customer = currentUser[0];
  const campaign = activeCampaign[0];
  const paidValue = Number(paid[0]?.value ?? 0);
  res.json(
    GetDashboardOverviewResponse.parse({
      role: isAdmin ? "admin" : "customer",
      totalCustomers: customerCount[0]?.value ?? 0,
      onlineSessions: onlineCount[0]?.value ?? 0,
      ...(campaign ? { activeCampaign: await campaignDto(campaign) } : {}),
      sentTotal: sentCount[0]?.value ?? 0,
      paidTotal: Number.isFinite(paidValue) ? paidValue : 0,
      sentByMe: sentByMe[0]?.value ?? 0,
      failedByMe: failedByMe[0]?.value ?? 0,
      pendingBalance: customer?.pendingBalance ?? 0,
      mainBalance: customer?.mainBalance ?? 0,
      recentActivity: recentActivity.map((event) => ({
        id: event.id,
        title: event.title,
        detail: event.detail,
        createdAt: event.createdAt,
      })),
    }),
  );
});

export default router;
