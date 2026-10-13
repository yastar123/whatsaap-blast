import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("customer"),
    referralCode: text("referral_code").notNull(),
    referredBy: uuid("referred_by"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    mainBalance: integer("main_balance").notNull().default(0),
    runningBalance: integer("running_balance").notNull().default(0),
    pendingBalance: integer("pending_balance").notNull().default(0),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_referral_code_unique").on(table.referralCode),
  ],
);

export type User = typeof usersTable.$inferSelect;
