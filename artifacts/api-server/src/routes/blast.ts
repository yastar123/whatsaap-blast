import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CancelBlastResponse,
  GetCurrentBlastResponse,
  StartBlastBody,
  StartBlastResponse,
} from "@workspace/api-zod";
import { db, blastJobsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { cancelCurrentBlast, startBlast } from "../lib/blast-worker";

const router: IRouter = Router();
router.use(requireAuth);

router.post("/blast/start", async (req, res): Promise<void> => {
  const parsed = StartBlastBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const job = await startBlast(
      req.auth!.userId,
      parsed.data.sessionId,
      parsed.data.delaySeconds,
    );
    res.status(201).json(StartBlastResponse.parse(job));
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : "Blast tidak dapat dimulai.",
    });
  }
});

router.post("/blast/cancel", async (req, res): Promise<void> => {
  const job = await cancelCurrentBlast(req.auth!.userId);
  res.json(
    CancelBlastResponse.parse({
      success: true,
      message: job ? "Blast dihentikan. Pesan yang sedang dikirim akan diselesaikan." : "Tidak ada blast yang berjalan.",
    }),
  );
});

router.get("/blast/current", async (req, res): Promise<void> => {
  const [job] = await db
    .select()
    .from(blastJobsTable)
    .where(eq(blastJobsTable.userId, req.auth!.userId))
    .orderBy(desc(blastJobsTable.startedAt))
    .limit(1);
  res.json(GetCurrentBlastResponse.parse({ job: job ?? null }));
});

export default router;
