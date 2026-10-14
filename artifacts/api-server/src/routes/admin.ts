import { Router, type IRouter } from "express";
import { open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import multer, { MulterError } from "multer";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  and,
  asc,
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
  DisconnectAdminWaSessionParams,
  DisconnectAdminWaSessionResponse,
  CreateCampaignBody,
  CreateCampaignResponse,
  DeleteCampaignContactsBody,
  DeleteCampaignContactsParams,
  DeleteCampaignParams,
  DeleteCampaignResponse,
  DeleteContactParams,
  DeleteContactResponse,
  ImportContactsBody,
  ImportContactsResponse,
  ListAdminWaSessionsResponse,
  ListAdminBlastsResponse,
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
import { disconnectWaSession } from "../lib/baileys-manager";
import { getBlastJobProgress } from "../lib/blast-worker";
import { campaignImageDirectory } from "../lib/campaign-image-storage";

const router: IRouter = Router();
router.use("/admin", requireAuth, requireAdmin);

const maxCampaignImageSize = 25 * 1024 * 1024;
const campaignImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

const campaignImageUpload = multer({
  storage: multer.diskStorage({
    destination: campaignImageDirectory,
    filename: (_req, file, callback) => {
      const extension = campaignImageTypes.get(file.mimetype);
      if (!extension) {
        callback(new Error("Pilih gambar JPG, PNG, WebP, atau GIF."), "");
        return;
      }
      callback(null, `${randomUUID()}.${extension}`);
    },
  }),
  limits: {
    fileSize: maxCampaignImageSize,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!campaignImageTypes.has(file.mimetype)) {
      callback(new Error("Pilih gambar JPG, PNG, WebP, atau GIF."));
      return;
    }
    callback(null, true);
  },
});

const contactFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 2,
    parts: 3,
  },
});

async function hasValidImageSignature(file: Express.Multer.File): Promise<boolean> {
  const handle = await open(file.path, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    switch (file.mimetype) {
      case "image/jpeg":
        return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      case "image/png":
        return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      case "image/webp":
        return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
      case "image/gif":
        return bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a";
      default:
        return false;
    }
  } finally {
    await handle.close();
  }
}

router.post(
  "/admin/campaign-images",
  (req, res, next): void => {
    campaignImageUpload.single("image")(req, res, (error: unknown) => {
      if (error instanceof MulterError) {
        const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({
          error: error.code === "LIMIT_FILE_SIZE"
            ? "Ukuran gambar maksimal 25 MB."
            : "File gambar tidak valid.",
        });
        return;
      }
      if (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : "Gambar tidak dapat diunggah.",
        });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Pilih gambar untuk diunggah." });
      return;
    }
    if (!(await hasValidImageSignature(file))) {
      await unlink(file.path);
      res.status(400).json({ error: "Isi file tidak sesuai dengan format gambar." });
      return;
    }
    res.status(201).json({
      imageUrl: `${req.protocol}://${req.get("host")}/api/uploads/${path.basename(file.filename)}`,
    });
  },
);

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
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

type ContactImportItem = {
  phone: string;
  consentSource?: string;
  consentAt?: Date;
};

async function insertContacts(
  campaignId: string,
  items: ContactImportItem[],
  consentConfirmed: boolean,
) {
  const eligible = [];
  let invalid = 0;
  let consentMissing = 0;
  for (const item of items) {
    const phone = normalizePhone(item.phone);
    if (!phone) {
      invalid += 1;
      continue;
    }
    const consentSource = item.consentSource?.trim();
    const hasConsentDetails = Boolean(consentSource || item.consentAt);
    const consentAt = item.consentAt ?? new Date();
    if (hasConsentDetails && (
      !consentSource ||
      !item.consentAt ||
      Number.isNaN(consentAt.getTime()) ||
      consentAt > new Date()
    )) {
      consentMissing += 1;
      continue;
    }
    if (!hasConsentDetails && !consentConfirmed) {
      consentMissing += 1;
      continue;
    }
    eligible.push({
      campaignId,
      phone,
      status: "unsent",
      consentSource: consentSource || "Konfirmasi admin saat impor",
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
  return {
    added: inserted.length,
    duplicates: eligible.length - inserted.length,
    invalid,
    consentMissing,
  };
}

function getPhoneRows(worksheet: ExcelJS.Worksheet): string[] {
  const rows = worksheet.getSheetValues().slice(1) as unknown[][];
  const first = rows[0] ?? [];
  const firstValue = first.find((value) => value !== null && value !== undefined);
  const firstText = String(firstValue ?? "").trim().toLowerCase();
  const hasHeader = ["nomor", "nomor telepon", "phone", "telephone"].includes(firstText);
  const values = hasHeader ? rows.slice(1) : rows;
  const phones = values
    .map((row) => {
      if (row.length > 2 && row.slice(2).some((value) => value !== null && value !== undefined && value !== "")) {
        throw new Error("Template hanya boleh berisi satu kolom nomor telepon.");
      }
      const value = row[1];
      if (value === null || value === undefined) return "";
      if (typeof value === "string" || typeof value === "number") return String(value).trim();
      if (typeof value === "object" && "text" in value && typeof value.text === "string") {
        return value.text.trim();
      }
      return "";
    })
    .filter(Boolean);
  if (phones.length > 1000) {
    throw new Error("Maksimal 1.000 nomor telepon per impor.");
  }
  return phones;
}

router.get("/admin/contacts/template/:format", async (req, res): Promise<void> => {
  const format = req.params.format;
  if (format !== "csv" && format !== "xlsx") {
    res.status(400).json({ error: "Format template harus csv atau xlsx." });
    return;
  }
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Kontak");
  worksheet.columns = [{ header: "nomor", key: "nomor", width: 24, style: { numFmt: "@" } }];
  worksheet.getRow(1).font = { bold: true };
  const filename = `template-kontak.${format}`;
  res.setHeader(
    "Content-Type",
    format === "csv"
      ? "text/csv; charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  if (format === "csv") {
    const buffer = await workbook.csv.writeBuffer();
    res.send(Buffer.concat([Buffer.from("\uFEFF"), Buffer.from(buffer)]));
    return;
  }
  const buffer = await workbook.xlsx.writeBuffer();
  res.send(Buffer.from(buffer));
});

router.post(
  "/admin/contacts/import-file",
  (req, res, next): void => {
    contactFileUpload.single("file")(req, res, (error: unknown) => {
      if (error instanceof MulterError) {
        const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({
          error: error.code === "LIMIT_FILE_SIZE"
            ? "Ukuran file maksimal 5 MB."
            : "File impor tidak valid.",
        });
        return;
      }
      if (error) {
        res.status(400).json({ error: "File impor tidak dapat dibaca." });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    if (req.body["consentConfirmed"] !== "true") {
      res.status(400).json({ error: "Konfirmasi persetujuan kontak wajib dicentang." });
      return;
    }
    const campaignId = req.body["campaignId"];
    if (typeof campaignId !== "string" || !campaignId.trim()) {
      res.status(400).json({ error: "Pilih kampanye tujuan." });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Pilih file CSV atau Excel." });
      return;
    }
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension !== ".csv" && extension !== ".xlsx") {
      res.status(400).json({ error: "Format file harus CSV atau XLSX." });
      return;
    }
    const [campaign] = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId))
      .limit(1);
    if (!campaign) {
      res.status(404).json({ error: "Campaign tidak ditemukan." });
      return;
    }
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = extension === ".csv"
        ? await workbook.csv.read(Readable.from([file.buffer]), {
            map: (value) => value === "" ? null : value,
          })
        : (await workbook.xlsx.read(Readable.from([file.buffer])), workbook.worksheets[0]);
      if (!worksheet) {
        res.status(400).json({ error: "File tidak memiliki sheet kontak." });
        return;
      }
      const phones = getPhoneRows(worksheet);
      if (phones.length === 0) {
        res.status(400).json({ error: "File tidak berisi nomor telepon." });
        return;
      }
      res.status(201).json(
        ImportContactsResponse.parse(
          await insertContacts(
            campaign.id,
            phones.map((phone) => ({ phone })),
            true,
          ),
        ),
      );
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "File impor tidak valid.",
      });
    }
  },
);

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
    .orderBy(desc(contactsTable.sentAt), asc(contactsTable.id))
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
      return {
        ...contact,
        senderPhone: contact.waSenderPhone ?? session?.phone ?? null,
      };
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
  res.status(201).json(
    ImportContactsResponse.parse(
      await insertContacts(
        campaign.id,
        parsed.data.contacts.map((item) => ({
          phone: item.phone,
          consentSource: item.consentSource,
          consentAt: item.consentAt ? new Date(item.consentAt) : undefined,
        })),
        parsed.data.consentConfirmed ?? false,
      ),
    ),
  );
});

router.delete(
  "/admin/campaigns/:campaignId/contacts",
  async (req, res): Promise<void> => {
    const params = DeleteCampaignContactsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsedBody = DeleteCampaignContactsBody.safeParse(
      req.body === undefined ? {} : req.body,
    );
    if (!parsedBody.success) {
      res.status(400).json({ error: parsedBody.error.message });
      return;
    }
    const { fromIndex, toIndex } = parsedBody.data;
    const hasRange = fromIndex !== undefined || toIndex !== undefined;
    const range =
      typeof fromIndex === "number" && typeof toIndex === "number"
        ? { fromIndex, toIndex }
        : null;
    if (
      hasRange &&
      (!range ||
        !Number.isSafeInteger(range.fromIndex) ||
        !Number.isSafeInteger(range.toIndex) ||
        range.fromIndex < 1 ||
        range.toIndex < range.fromIndex)
    ) {
      res.status(400).json({
        error: "Rentang harus berisi nomor urut awal dan akhir yang valid.",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [campaign] = await tx
        .select({ id: campaignsTable.id })
        .from(campaignsTable)
        .where(eq(campaignsTable.id, params.data.campaignId))
        .for("update")
        .limit(1);
      if (!campaign) return { kind: "missing" as const };

      const [running] = await tx
        .select({ id: blastJobsTable.id })
        .from(blastJobsTable)
        .where(
          and(
            eq(blastJobsTable.campaignId, campaign.id),
            eq(blastJobsTable.status, "running"),
          ),
        )
        .limit(1);
      if (running) return { kind: "running" as const };

      if (!range) {
        const deleted = await tx
          .delete(contactsTable)
          .where(eq(contactsTable.campaignId, campaign.id))
          .returning({ id: contactsTable.id });
        return { kind: "deleted" as const, deletedCount: deleted.length };
      }

      const targetContacts = await tx
        .select({ id: contactsTable.id })
        .from(contactsTable)
        .where(eq(contactsTable.campaignId, campaign.id))
        .orderBy(desc(contactsTable.sentAt), asc(contactsTable.id))
        .offset(range.fromIndex - 1)
        .limit(range.toIndex - range.fromIndex + 1)
        .for("update");
      if (!targetContacts.length) {
        return { kind: "deleted" as const, deletedCount: 0 };
      }

      const deleted = await tx
        .delete(contactsTable)
        .where(
          inArray(
            contactsTable.id,
            targetContacts.map((contact) => contact.id),
          ),
        )
        .returning({ id: contactsTable.id });
      return { kind: "deleted" as const, deletedCount: deleted.length };
    });

    if (result.kind === "missing") {
      res.status(404).json({ error: "Campaign tidak ditemukan." });
      return;
    }
    if (result.kind === "running") {
      res.status(409).json({
        error: "Hentikan blast kampanye sebelum menghapus kontak.",
      });
      return;
    }
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} kontak dihapus.`,
    });
  },
);

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
    res.json(
      DeleteContactResponse.parse({
        success: true,
        message: "Kontak sudah tidak tersedia.",
      }),
    );
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

router.get("/admin/blasts", async (_req, res): Promise<void> => {
  const latestJobs = await db
    .selectDistinctOn([blastJobsTable.userId], {
      ownerId: usersTable.id,
      ownerName: usersTable.name,
      ownerEmail: usersTable.email,
      campaignTitle: campaignsTable.title,
      jobId: blastJobsTable.id,
    })
    .from(blastJobsTable)
    .innerJoin(usersTable, eq(blastJobsTable.userId, usersTable.id))
    .leftJoin(campaignsTable, eq(blastJobsTable.campaignId, campaignsTable.id))
    .where(eq(usersTable.role, "customer"))
    .orderBy(blastJobsTable.userId, desc(blastJobsTable.startedAt));

  const progressItems = await Promise.all(
    latestJobs.map(async (item) => {
      const job = await getBlastJobProgress(item.jobId);
      if (!job) return null;
      return {
        ownerId: item.ownerId,
        ownerName: item.ownerName,
        ownerEmail: item.ownerEmail,
        campaignTitle: item.campaignTitle ?? "Kampanye dihapus",
        job,
      };
    }),
  );
  res.json(
    ListAdminBlastsResponse.parse(
      progressItems.filter((item) => item !== null),
    ),
  );
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

router.get("/admin/wa-sessions", async (_req, res): Promise<void> => {
  const sessions = await db
    .select({
      id: waSessionsTable.id,
      ownerId: usersTable.id,
      ownerName: usersTable.name,
      ownerEmail: usersTable.email,
      label: waSessionsTable.label,
      phone: waSessionsTable.phone,
      status: waSessionsTable.status,
      lastConnectedAt: waSessionsTable.lastConnectedAt,
    })
    .from(waSessionsTable)
    .innerJoin(usersTable, eq(waSessionsTable.userId, usersTable.id))
    .orderBy(desc(waSessionsTable.createdAt));
  res.json(ListAdminWaSessionsResponse.parse(sessions));
});

router.delete(
  "/admin/wa-sessions/:sessionId",
  async (req, res): Promise<void> => {
    const params = DisconnectAdminWaSessionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [session] = await db
      .select({ id: waSessionsTable.id, userId: waSessionsTable.userId })
      .from(waSessionsTable)
      .where(eq(waSessionsTable.id, params.data.sessionId))
      .limit(1);
    if (!session) {
      res.status(404).json({ error: "Sesi WhatsApp tidak ditemukan." });
      return;
    }
    const disconnected = await disconnectWaSession(
      session.id,
      session.userId,
    );
    if (!disconnected) {
      res.status(404).json({ error: "Sesi WhatsApp tidak ditemukan." });
      return;
    }
    res.json(
      DisconnectAdminWaSessionResponse.parse({
        success: true,
        message: "Sesi WhatsApp berhasil diputus.",
      }),
    );
  },
);

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
