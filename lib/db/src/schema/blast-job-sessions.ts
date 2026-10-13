import {
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const blastJobSessionsTable = pgTable(
  "blast_job_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blastJobId: uuid("blast_job_id").notNull(),
    waSessionId: uuid("wa_session_id").notNull(),
    status: text("status").notNull().default("running"),
    sent: integer("sent").notNull().default(0),
    failed: integer("failed").notNull().default(0),
  },
  (table) => [
    uniqueIndex("blast_job_sessions_job_session_unique").on(
      table.blastJobId,
      table.waSessionId,
    ),
    index("blast_job_sessions_job_idx").on(table.blastJobId),
  ],
);

export type BlastJobSession = typeof blastJobSessionsTable.$inferSelect;
