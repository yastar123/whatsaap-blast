import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, refreshTokensTable, usersTable, type User } from "@workspace/db";

const authSecret = process.env["SESSION_SECRET"];
if (!authSecret) {
  throw new Error("SESSION_SECRET must be configured before the API starts.");
}

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "customer";
  status: "active" | "blocked";
  referralCode: string;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role === "admin" ? "admin" : "customer",
    status: user.status === "blocked" ? "blocked" : "active",
    referralCode: user.referralCode,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function issueTokens(user: User) {
  const accessToken = jwt.sign(
    { role: user.role },
    authSecret!,
    { subject: user.id, expiresIn: "15m" },
  );
  const refreshToken = randomBytes(48).toString("base64url");
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return { user: toPublicUser(user), accessToken, refreshToken };
}

export async function rotateRefreshToken(token: string) {
  const tokenHash = hashToken(token);
  const [saved] = await db
    .select()
    .from(refreshTokensTable)
    .where(
      and(
        eq(refreshTokensTable.tokenHash, tokenHash),
        isNull(refreshTokensTable.revokedAt),
        gt(refreshTokensTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!saved) return null;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, saved.userId), eq(usersTable.status, "active")))
    .limit(1);
  if (!user) return null;

  await db
    .update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokensTable.id, saved.id));

  return issueTokens(user);
}

export async function revokeRefreshToken(token: string) {
  await db
    .update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokensTable.tokenHash, hashToken(token)),
        isNull(refreshTokensTable.revokedAt),
      ),
    );
}

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; role: "admin" | "customer" };
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token) {
    res.status(401).json({ error: "Silakan masuk untuk melanjutkan." });
    return;
  }
  try {
    const payload = jwt.verify(token, authSecret!);
    if (typeof payload === "string" || !payload.sub) {
      res.status(401).json({ error: "Sesi tidak valid." });
      return;
    }
    const [user] = await db
      .select({ id: usersTable.id, role: usersTable.role, status: usersTable.status })
      .from(usersTable)
      .where(eq(usersTable.id, payload.sub))
      .limit(1);
    if (!user || user.status !== "active") {
      res.status(403).json({ error: "Akun tidak aktif." });
      return;
    }
    req.auth = {
      userId: user.id,
      role: user.role === "admin" ? "admin" : "customer",
    };
    next();
  } catch {
    res.status(401).json({ error: "Sesi kedaluwarsa. Silakan masuk kembali." });
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.auth?.role !== "admin") {
    res.status(403).json({ error: "Akses khusus admin." });
    return;
  }
  next();
}
