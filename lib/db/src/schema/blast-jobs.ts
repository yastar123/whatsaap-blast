import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const blastJobsTable = pgTable(
  "blast_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    waSessionId: uuid("wa_session_id").notNull(),
    delaySeconds: integer("delay_seconds").notNull(),
    status: text("status").notNull().default("running"),
    total: integer("total").notNull().default(0),
    sent: integer("sent").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    pending: integer("pending").notNull().default(0),
    runningBalance: integer("running_balance").notNull().default(0),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [index("blast_jobs_user_status_idx").on(table.userId, table.status)],
);

export type BlastJob = typeof blastJobsTable.$inferSelect;
