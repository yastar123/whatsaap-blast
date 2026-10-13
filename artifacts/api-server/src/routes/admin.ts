import { Router, type IRouter } from "express";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import {
  ActivateCampaignParams,
  ActivateCampaignResponse,
  CreateCampaignBody,
  CreateCampaignResponse,
  DeleteCampaignParams,
  DeleteCampaignResponse,
  DeleteContactParams,
  DeleteContactResponse,
  ImportContactsBody,
  ImportContactsResponse,
  ListCampaignsResponse,
  ListContactsQueryParams,
  ListContactsResponse,
  ListUsersQueryParams,
  ListUsersResponse,
  UpdateCampaignBody,
  UpdateCampaignParams,
  UpdateCampaignResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
  UpdateUserStatusBody,
  UpdateUserStatusParams,
  UpdateUserStatusResponse,
} from "@workspace/api-zod";
import {
  blastJobsTable,
  campaignsTable,
  contactsTable,
  db,
  usersTable,
  waSessionsTable,
} from "@workspace/db";
import { getAppSettings, saveAppSettings } from "../lib/app-settings";
import { requireAdmin, requireAuth } from "../lib/auth";

const router: IRouter = Router();
router.use("/admin", requireAuth, requireAdmin);

async function campaignDto(campaign: typeof campaignsTable.$inferSelect) {
  const [counts] = await db
    .select({
      total: count(),
    })
    .from(contactsTable)
    .where(eq(contactsTable.campaignId, campaign.id));
  const [sent] = await db
    .select({ value: count() })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.campaignId, campaign.id),
        eq(contactsTable.status, "sent"),
      ),
    );
  const [failed] = await db
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
    contactTotal: counts?.total ?? 0,
    sentCount: sent?.value ?? 0,
    failedCount: failed?.value ?? 0,
  };
}

function normalizePhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

router.get("/admin/campaigns", async (_req, res): Promise<void> => {
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .orderBy(desc(campaignsTable.createdAt));
  const results = await Promise.all(campaigns.map(campaignDto));
  res.json(ListCampaignsResponse.parse(results));
});

router.post("/admin/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      ...parsed.data,
      createdBy: req.auth!.userId,
      status: "draft",
    })
    .returning();
  if (!campaign) {
    res.status(500).json({ error: "Campaign tidak dapat dibuat." });
    return;
  }
  res.status(201).json(
    CreateCampaignResponse.parse(await campaignDto(campaign)),
  );
});

router.patch("/admin/campaigns/:campaignId", async (req, res): Promise<void> => {
  const params = UpdateCampaignParams.safeParse(req.params);
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [campaign] = await db
    .update(campaignsTable)
    .set(parsed.data)
    .where(eq(campaignsTable.id, params.data.campaignId))
    .returning();
  if (!campaign) {
    res.status(404).json({ error: "Campaign tidak ditemukan." });
    return;
  }
  res.json(UpdateCampaignResponse.parse(await campaignDto(campaign)));
});

router.delete("/admin/campaigns/:campaignId", async (req, res): Promise<void> => {
  const params = DeleteCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, params.data.campaignId))
    .limit(1);
  if (!campaign) {
    res.status(404).json({ error: "Campaign tidak ditemukan." });
    return;
  }
  if (campaign.sentCount > 0 || campaign.isActive) {
    res.status(409).json({ error: "Campaign aktif atau yang sudah mengirim tidak dapat dihapus." });
    return;
  }
  const [running] = await db
    .select({ id: blastJobsTable.id })
    .from(blastJobsTable)
    .where(and(eq(blastJobsTable.campaignId, campaign.id), eq(blastJobsTable.status, "running")))
    .limit(1);
  if (running) {
    res.status(409).json({ error: "Hentikan blast sebelum menghapus campaign." });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(contactsTable).where(eq(contactsTable.campaignId, campaign.id));
    await tx.delete(campaignsTable).where(eq(campaignsTable.id, campaign.id));
  });
  res.json(DeleteCampaignResponse.parse({ success: true, message: "Campaign dihapus." }));
});

router.post("/admin/campaigns/:campaignId/activate", async (req, res): Promise<void> => {
  const params = ActivateCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [target] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, params.data.campaignId))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Campaign tidak ditemukan." });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(campaignsTable)
      .set({ isActive: false, status: "paused" })
      .where(eq(campaignsTable.isActive, true));
    await tx
      .update(campaignsTable)
      .set({ isActive: true, status: "active" })
      .where(eq(campaignsTable.id, target.id));
  });
  const [activated] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, target.id))
    .limit(1);
  res.json(
    ActivateCampaignResponse.parse(
      activated ? await campaignDto(activated) : null,
    ),
  );
});

router.get("/admin/contacts", async (req, res): Promise<void> => {
  const parsed = ListContactsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { campaignId, search, page = 1, pageSize = 20 } = parsed.data;
  const filters = [];
  if (campaignId) filters.push(eq(contactsTable.campaignId, campaignId));
  if (search?.trim()) filters.push(ilike(contactsTable.phone, `%${search.trim()}%`));
  const condition = filters.length ? and(...filters) : undefined;
  const [total] = await db
    .select({ value: count() })
    .from(contactsTable)
    .where(condition);
  const items = await db
    .select()
    .from(contactsTable)
    .where(condition)
    .orderBy(desc(contactsTable.sentAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const rows = await Promise.all(
    items.map(async (contact) => {
      const [session] = contact.waSessionId
        ? await db
            .select({ phone: waSessionsTable.phone })
            .from(waSessionsTable)
            .where(eq(waSessionsTable.id, contact.waSessionId))
            .limit(1)
        : [];
      return { ...contact, senderPhone: session?.phone ?? null };
    }),
  );
  res.json(
    ListContactsResponse.parse({
      items: rows,
      total: total?.value ?? 0,
      page,
      pageSize,
    }),
  );
});

router.post("/admin/contacts", async (req, res): Promise<void> => {
  const parsed = ImportContactsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [campaign] = await db
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, parsed.data.campaignId))
    .limit(1);
  if (!campaign) {
    res.status(404).json({ error: "Campaign tidak ditemukan." });
    return;
  }
  const eligible = [];
  let invalid = 0;
  let consentMissing = 0;
  for (const item of parsed.data.contacts) {
    const phone = normalizePhone(item.phone);
    const consentSource = item.consentSource.trim();
    const consentAt = new Date(item.consentAt);
    if (!phone) {
      invalid += 1;
      continue;
    }
    if (!consentSource || Number.isNaN(consentAt.getTime()) || consentAt > new Date()) {
      consentMissing += 1;
      continue;
    }
    eligible.push({
      campaignId: campaign.id,
      phone,
      status: "unsent",
      consentSource,
      consentAt,
    });
  }
  const inserted = eligible.length
    ? await db
        .insert(contactsTable)
        .values(eligible)
        .onConflictDoNothing()
        .returning({ id: contactsTable.id })
    : [];
  res.status(201).json(
    ImportContactsResponse.parse({
      added: inserted.length,
      duplicates: eligible.length - inserted.length,
      invalid,
      consentMissing,
    }),
  );
});

router.delete("/admin/contacts/:contactId", async (req, res): Promise<void> => {
  const params = DeleteContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [contact] = await db
    .delete(contactsTable)
    .where(eq(contactsTable.id, params.data.contactId))
    .returning({ id: contactsTable.id });
  if (!contact) {
    res.status(404).json({ error: "Kontak tidak ditemukan." });
    return;
  }
  res.json(DeleteContactResponse.parse({ success: true, message: "Kontak dihapus." }));
});

router.get("/admin/users", async (req, res): Promise<void> => {
  const parsed = ListUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search?.trim();
  const users = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "customer"),
        search
          ? or(ilike(usersTable.name, `%${search}%`), ilike(usersTable.email, `%${search}%`))
          : undefined,
      ),
    )
    .orderBy(desc(usersTable.createdAt));
  const summaries = await Promise.all(
    users.map(async (user) => {
      const [sent] = await db
        .select({ value: count() })
        .from(contactsTable)
        .where(
          and(
            eq(contactsTable.lockedByUserId, user.id),
            eq(contactsTable.status, "sent"),
          ),
        );
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        referralCode: user.referralCode,
        createdAt: user.createdAt,
        sentCount: sent?.value ?? 0,
      };
    }),
  );
  res.json(ListUsersResponse.parse(summaries));
});

router.patch("/admin/users/:userId/status", async (req, res): Promise<void> => {
  const params = UpdateUserStatusParams.safeParse(req.params);
  const parsed = UpdateUserStatusBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (params.data.userId === req.auth!.userId) {
    res.status(400).json({ error: "Admin tidak dapat menonaktifkan akunnya sendiri." });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set({ status: parsed.data.status })
    .where(and(eq(usersTable.id, params.data.userId), eq(usersTable.role, "customer")))
    .returning();
  if (!user) {
    res.status(404).json({ error: "Pelanggan tidak ditemukan." });
    return;
  }
  res.json(
    UpdateUserStatusResponse.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      referralCode: user.referralCode,
      createdAt: user.createdAt,
      sentCount: 0,
    }),
  );
});

router.get("/admin/settings", async (_req, res): Promise<void> => {
  res.json(await getAppSettings());
});

router.patch("/admin/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const settings = await saveAppSettings(parsed.data);
  res.json(UpdateSettingsResponse.parse(settings));
});

export default router;
