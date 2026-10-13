import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const contactsTable = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull(),
    phone: text("phone").notNull(),
    status: text("status").notNull().default("unsent"),
    consentSource: text("consent_source"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentRevokedAt: timestamp("consent_revoked_at", { withTimezone: true }),
    lockedByUserId: uuid("locked_by_user_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    waSessionId: uuid("wa_session_id"),
    errorReason: text("error_reason"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    messageId: text("message_id"),
  },
  (table) => [
    uniqueIndex("contacts_campaign_phone_unique").on(table.campaignId, table.phone),
    index("contacts_campaign_status_idx").on(table.campaignId, table.status),
    index("contacts_phone_idx").on(table.phone),
  ],
);

export type Contact = typeof contactsTable.$inferSelect;
