import { and, count, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateWaSessionBody,
  CreateWaSessionResponse,
  ConnectWaSessionBody,
  ConnectWaSessionParams,
  ConnectWaSessionResponse,
  DeleteWaSessionParams,
  DeleteWaSessionResponse,
  ListWaSessionsResponse,
} from "@workspace/api-zod";
import { db, waSessionsTable } from "@workspace/db";
import { requireAuth, requireCustomer } from "../lib/auth";
import {
  connectWaSession,
  disconnectWaSession,
} from "../lib/baileys-manager";

const router: IRouter = Router();
router.use(requireAuth, requireCustomer);

function toSessionDto(session: typeof waSessionsTable.$inferSelect) {
  return {
    id: session.id,
    label: session.label,
    phone: session.phone,
    status: session.status,
    lastConnectedAt: session.lastConnectedAt,
  };
}

router.get("/wa-sessions", async (req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(waSessionsTable)
    .where(eq(waSessionsTable.userId, req.auth!.userId))
    .orderBy(waSessionsTable.createdAt);
  res.json(ListWaSessionsResponse.parse(sessions.map(toSessionDto)));
});

router.post("/wa-sessions", async (req, res): Promise<void> => {
  const parsed = CreateWaSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select({ value: count() })
    .from(waSessionsTable)
    .where(eq(waSessionsTable.userId, req.auth!.userId));
  if ((existing?.value ?? 0) >= 5) {
    res.status(409).json({ error: "Maksimal lima sesi WhatsApp per akun." });
    return;
  }
  const [session] = await db
    .insert(waSessionsTable)
    .values({ userId: req.auth!.userId, label: parsed.data.label.trim() })
    .returning();
  if (!session) {
    res.status(500).json({ error: "Sesi WhatsApp tidak dapat dibuat." });
    return;
  }
  res.status(201).json(CreateWaSessionResponse.parse(toSessionDto(session)));
});

router.post(
  "/wa-sessions/:sessionId/connect",
  async (req, res): Promise<void> => {
    const params = ConnectWaSessionParams.safeParse(req.params);
    const parsed = ConnectWaSessionBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await connectWaSession(
        params.data.sessionId,
        req.auth!.userId,
        parsed.data.method,
        parsed.data.phone,
      );
      if (!result) {
        res.status(404).json({ error: "Sesi WhatsApp tidak ditemukan." });
        return;
      }
      res.json(
        ConnectWaSessionResponse.parse({
          session: {
            ...toSessionDto(result.session),
            status: "connecting",
          },
          qrDataUrl: result.qrDataUrl,
          pairingCode: result.pairingCode,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gagal memulai koneksi.";
      res.status(400).json({ error: message });
    }
  },
);

router.delete("/wa-sessions/:sessionId", async (req, res): Promise<void> => {
  const params = DeleteWaSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const removed = await disconnectWaSession(
    params.data.sessionId,
    req.auth!.userId,
    true,
  );
  if (!removed) {
    res.status(404).json({ error: "Sesi WhatsApp tidak ditemukan." });
    return;
  }
  res.json(
    DeleteWaSessionResponse.parse({
      success: true,
      message: "Sesi WhatsApp telah diputus dan dihapus.",
    }),
  );
});

export default router;
