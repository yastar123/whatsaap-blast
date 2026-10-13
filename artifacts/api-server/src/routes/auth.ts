import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { rateLimit } from "express-rate-limit";
import {
  db,
  refreshTokensTable,
  usersTable,
} from "@workspace/db";
import {
  LoginBody,
  LoginResponse,
  RefreshSessionBody,
  RefreshSessionResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import {
  checkPassword,
  hashPassword,
  issueTokens,
  requireAuth,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../lib/auth";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

function createReferralCode(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
}

router.post("/auth/register", loginLimiter, async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Email sudah terdaftar." });
    return;
  }

  let referredBy: string | null = null;
  if (parsed.data.referralCode?.trim()) {
    const [referrer] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.referralCode, parsed.data.referralCode.trim().toUpperCase()),
          eq(usersTable.status, "active"),
        ),
      )
      .limit(1);
    if (!referrer) {
      res.status(400).json({ error: "Kode referral tidak ditemukan." });
      return;
    }
    referredBy = referrer.id;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      name: parsed.data.name.trim(),
      email,
      passwordHash: await hashPassword(parsed.data.password),
      referralCode: createReferralCode(),
      referredBy,
    })
    .returning();
  if (!user) {
    res.status(500).json({ error: "Akun tidak dapat dibuat." });
    return;
  }
  res.status(201).json(RegisterResponse.parse(await issueTokens(user)));
});

router.post("/auth/login", loginLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (!user || user.status !== "active" || !(await checkPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Email atau kata sandi tidak cocok." });
    return;
  }
  res.json(LoginResponse.parse(await issueTokens(user)));
});

router.post("/auth/refresh", async (req, res): Promise<void> => {
  const parsed = RefreshSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const tokens = await rotateRefreshToken(parsed.data.refreshToken);
  if (!tokens) {
    res.status(401).json({ error: "Sesi tidak valid. Silakan masuk kembali." });
    return;
  }
  res.json(RefreshSessionResponse.parse(tokens));
});

router.post("/auth/logout", requireAuth, async (req, res): Promise<void> => {
  await db
    .update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokensTable.userId, req.auth!.userId), isNull(refreshTokensTable.revokedAt)));
  const header = req.header("authorization");
  const currentToken = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (currentToken.length > 20) await revokeRefreshToken(currentToken);
  res.json({ success: true, message: "Anda telah keluar." });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.auth!.userId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "Akun tidak ditemukan." });
    return;
  }
  const { passwordHash: _passwordHash, ...publicFields } = user;
  void _passwordHash;
  const response = {
    id: publicFields.id,
    name: publicFields.name,
    email: publicFields.email,
    role: publicFields.role,
    status: publicFields.status,
    referralCode: publicFields.referralCode,
  };
  res.json(response);
});

export default router;
