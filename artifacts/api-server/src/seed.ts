import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  activityTable,
  campaignsTable,
  contactsTable,
  db,
  pool,
  settingsTable,
  usersTable,
} from "@workspace/db";

if (process.env["NODE_ENV"] === "production") {
  throw new Error("The demo seed is disabled in production.");
}

const demoPassword = process.env["SEED_DEMO_PASSWORD"] ?? "DemoOnly2026!";
const passwordHash = await bcrypt.hash(demoPassword, 12);
const settings = [
  ["perMessage", 1100],
  ["referralBonus", 50],
  ["minimumWithdrawal", 15000],
  ["pendingReleaseHours", 24],
  ["maxMessagesPerSessionPerHour", 30],
  ["allowDisconnectRequeue", true],
] as const;

try {
  let [admin] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, "admin@demo.local"))
    .limit(1);
  if (!admin) {
    [admin] = await db
      .insert(usersTable)
      .values({
        name: "Administrator Demo",
        email: "admin@demo.local",
        passwordHash,
        role: "admin",
        referralCode: "ADMINDEMO1",
      })
      .returning();
  }
  if (!admin) throw new Error("Could not create the demo admin.");

  let [customer] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, "customer@demo.local"))
    .limit(1);
  if (!customer) {
    [customer] = await db
      .insert(usersTable)
      .values({
        name: "Customer Demo",
        email: "customer@demo.local",
        passwordHash,
        referralCode: "CUSTOMER01",
        referredBy: admin.id,
      })
      .returning();
  }

  let [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.title, "Kampanye contoh — belum aktif"))
    .limit(1);
  if (!campaign) {
    [campaign] = await db
      .insert(campaignsTable)
      .values({
        title: "Kampanye contoh — belum aktif",
        messageText: "Contoh naskah untuk preview. Ganti dengan pesan yang disetujui penerima.",
        status: "draft",
        isActive: false,
        createdBy: admin.id,
      })
      .returning();
  }
  if (!campaign) throw new Error("Could not create the demo campaign.");

  for (const [key, value] of settings) {
    await db.insert(settingsTable).values({ key, value }).onConflictDoNothing();
  }

  const demoContacts = Array.from({ length: 300 }, (_, index) => ({
    campaignId: campaign.id,
    phone: `628000000${String(index + 1).padStart(5, "0")}`,
    status: "unsent",
    // These are fictitious, unconsented placeholders and cannot enter the blast queue.
    consentSource: null,
    consentAt: null,
  }));
  await db.insert(contactsTable).values(demoContacts).onConflictDoNothing();

  await db
    .insert(activityTable)
    .values({
      userId: admin.id,
      title: "Workspace contoh disiapkan",
      detail: "Akun demo, campaign draf, dan 300 placeholder tanpa consent telah dibuat.",
    });

  console.info("Development seed complete.");
  console.info("Demo accounts: admin@demo.local and customer@demo.local");
} finally {
  await pool.end();
}
