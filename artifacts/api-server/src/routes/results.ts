import { Router, type IRouter } from "express";
import ExcelJS from "exceljs";
import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import {
  ExportResultsQueryParams,
  GetResultsSummaryQueryParams,
  ListCampaignResultSummariesResponse,
  ListResultsQueryParams,
  ListResultsResponse,
} from "@workspace/api-zod";
import {
  blastJobsTable,
  campaignsTable,
  contactsTable,
  db,
  usersTable,
  waSessionsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();
router.use(requireAuth);

function resultFilters(
  user: { userId: string; role: "admin" | "customer" },
  filters: {
    campaignId?: string;
    status?: string;
    search?: string;
    userId?: string;
  },
): SQL[] {
  const conditions: SQL[] = [];
  if (filters.campaignId) conditions.push(eq(contactsTable.campaignId, filters.campaignId));
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(contactsTable.status, filters.status));
  }
  if (filters.search?.trim()) {
    conditions.push(ilike(contactsTable.phone, `%${filters.search.trim()}%`));
  }
  if (user.role === "customer") {
    conditions.push(eq(contactsTable.lockedByUserId, user.userId));
  } else if (filters.userId) {
    conditions.push(eq(contactsTable.lockedByUserId, filters.userId));
  }
  return conditions;
}

async function queryRows(
  user: { userId: string; role: "admin" | "customer" },
  filters: {
    campaignId?: string;
    status?: string;
    search?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  },
) {
  const conditions = resultFilters(user, filters);
  return db
    .select({
      id: contactsTable.id,
      phone: contactsTable.phone,
      campaignId: contactsTable.campaignId,
      campaignTitle: campaignsTable.title,
      userId: contactsTable.lockedByUserId,
      customerName: usersTable.name,
      status: contactsTable.status,
      errorReason: contactsTable.errorReason,
      senderPhone: waSessionsTable.phone,
      sentAt: contactsTable.sentAt,
    })
    .from(contactsTable)
    .innerJoin(campaignsTable, eq(contactsTable.campaignId, campaignsTable.id))
    .leftJoin(usersTable, eq(contactsTable.lockedByUserId, usersTable.id))
    .leftJoin(waSessionsTable, eq(contactsTable.waSessionId, waSessionsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(contactsTable.sentAt), desc(contactsTable.id))
    .limit(filters.limit ?? 100000)
    .offset(filters.offset ?? 0);
}

async function summaryFor(
  user: { userId: string; role: "admin" | "customer" },
  filters: { campaignId?: string; userId?: string },
) {
  const conditions = resultFilters(user, filters);
  const rows = await db
    .select({ status: contactsTable.status, value: count() })
    .from(contactsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(contactsTable.status);
  const totals = Object.fromEntries(rows.map((row) => [row.status, row.value])) as Record<string, number>;
  const sent = totals["sent"] ?? 0;
  const failed = totals["failed"] ?? 0;
  const processed = sent + failed;
  return {
    totalProcessed: processed,
    sent,
    failed,
    pending: totals["pending"] ?? 0,
    unsent: totals["unsent"] ?? 0,
    optedOut: totals["opted_out"] ?? 0,
    successRate: processed === 0 ? 0 : Math.round((sent / processed) * 10000) / 100,
  };
}

router.get("/results", async (req, res): Promise<void> => {
  const parsed = ListResultsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, pageSize = 20, ...filters } = parsed.data;
  const conditions = resultFilters(req.auth!, filters);
  const [total] = await db
    .select({ value: count() })
    .from(contactsTable)
    .where(conditions.length ? and(...conditions) : undefined);
  const items = await queryRows(req.auth!, {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  res.json(
    ListResultsResponse.parse({
      items,
      total: total?.value ?? 0,
      page,
      pageSize,
    }),
  );
});

router.get("/results/summary", async (req, res): Promise<void> => {
  const parsed = GetResultsSummaryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const requestedUserId =
    req.auth!.role === "admin" ? parsed.data.userId : req.auth!.userId;
  res.json(
    await summaryFor(req.auth!, {
      campaignId: parsed.data.campaignId,
      userId: requestedUserId,
    }),
  );
});

router.get("/results/campaigns", async (req, res): Promise<void> => {
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .orderBy(desc(campaignsTable.createdAt));
  const summaries = await Promise.all(
    campaigns.map(async (campaign) => ({
      campaign: {
        ...campaign,
        contactTotal: await db
          .select({ value: count() })
          .from(contactsTable)
          .where(eq(contactsTable.campaignId, campaign.id))
          .then((rows) => rows[0]?.value ?? 0),
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
      },
      summary: await summaryFor(req.auth!, {
        campaignId: campaign.id,
        userId: req.auth!.role === "admin" ? undefined : req.auth!.userId,
      }),
    })),
  );
  const visible = summaries.filter(
    (item) => req.auth!.role === "admin" || item.summary.totalProcessed > 0 || item.summary.pending > 0,
  );
  res.json(ListCampaignResultSummariesResponse.parse(visible));
});

router.get("/results/export", async (req, res): Promise<void> => {
  const parsed = ExportResultsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await queryRows(req.auth!, parsed.data);
  const exportRows = rows.map((row) => ({
    "Nomor tujuan": row.phone,
    Campaign: row.campaignTitle,
    Status: row.status,
    "Alasan gagal": row.errorReason ?? "",
    "WA pengirim": row.senderPhone ?? "",
    "Waktu kirim": row.sentAt?.toISOString() ?? "",
  }));
  if (parsed.data.format === "csv") {
    const headers = Object.keys(exportRows[0] ?? {
      "Nomor tujuan": "",
      Campaign: "",
      Status: "",
      "Alasan gagal": "",
      "WA pengirim": "",
      "Waktu kirim": "",
    });
    const escape = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [
      headers.map(escape).join(","),
      ...exportRows.map((row) => headers.map((header) => escape((row as Record<string, unknown>)[header])).join(",")),
    ].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="hasil-campaign.csv"');
    res.send(`\uFEFF${csv}`);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hasil");
  sheet.columns = [
    { header: "Nomor tujuan", key: "Nomor tujuan", width: 20 },
    { header: "Campaign", key: "Campaign", width: 28 },
    { header: "Status", key: "Status", width: 16 },
    { header: "Alasan gagal", key: "Alasan gagal", width: 42 },
    { header: "WA pengirim", key: "WA pengirim", width: 20 },
    { header: "Waktu kirim", key: "Waktu kirim", width: 26 },
  ];
  sheet.addRows(exportRows);
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", 'attachment; filename="hasil-campaign.xlsx"');
  res.send(Buffer.from(buffer));
});

export default router;
