import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const campaignsTable = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  messageText: text("message_text").notNull(),
  imageUrl: text("image_url"),
  ctaText: text("cta_text"),
  ctaUrl: text("cta_url"),
  status: text("status").notNull().default("draft"),
  isActive: boolean("is_active").notNull().default(false),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
});

export type Campaign = typeof campaignsTable.$inferSelect;
