import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const activityTable = pgTable(
  "activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id"),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activity_created_idx").on(table.createdAt)],
);
