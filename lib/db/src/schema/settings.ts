import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const settingsTable = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().$type<unknown>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
