import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const waSessionsTable = pgTable(
  "wa_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    phone: text("phone"),
    label: text("label").notNull(),
    status: text("status").notNull().default("offline"),
    authState: jsonb("auth_state").$type<Record<string, unknown>>(),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("wa_sessions_user_idx").on(table.userId)],
);

export const waSessionKeysTable = pgTable(
  "wa_session_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),
    keyType: text("key_type").notNull(),
    keyId: text("key_id").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index("wa_session_keys_lookup_idx").on(table.sessionId, table.keyType, table.keyId)],
);

export type WaSession = typeof waSessionsTable.$inferSelect;
