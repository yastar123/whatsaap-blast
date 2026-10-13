import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const transactionsTable = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    type: text("type").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("pending"),
    refId: text("ref_id"),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("transactions_user_created_idx").on(table.userId, table.createdAt)],
);

export type Transaction = typeof transactionsTable.$inferSelect;
