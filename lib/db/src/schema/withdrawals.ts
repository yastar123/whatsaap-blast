import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const withdrawalsTable = pgTable(
  "withdrawals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    amount: integer("amount").notNull(),
    method: text("method").notNull(),
    accountName: text("account_name").notNull(),
    accountNumber: text("account_number").notNull(),
    status: text("status").notNull().default("pending"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [index("withdrawals_user_created_idx").on(table.userId, table.createdAt)],
);

export type Withdrawal = typeof withdrawalsTable.$inferSelect;
