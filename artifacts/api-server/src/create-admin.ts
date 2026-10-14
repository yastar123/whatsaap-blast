import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import { hashPassword } from "./lib/auth";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || "Administrator";

if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env or Replit Secrets.");
}
if (password.length < 12) {
  throw new Error("ADMIN_PASSWORD must be at least 12 characters long.");
}

try {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing && existing.role !== "admin") {
    throw new Error("ADMIN_EMAIL is already used by a non-admin account; choose another email.");
  }

  const passwordHash = await hashPassword(password);
  if (existing) {
    await db
      .update(usersTable)
      .set({ name, passwordHash, status: "active" })
      .where(eq(usersTable.id, existing.id));
    console.info(`Admin credentials updated for ${email}.`);
  } else {
    await db.insert(usersTable).values({
      name,
      email,
      passwordHash,
      role: "admin",
      referralCode: randomBytes(5).toString("hex").toUpperCase(),
    });
    console.info(`Admin account created for ${email}.`);
  }
} finally {
  await pool.end();
}
