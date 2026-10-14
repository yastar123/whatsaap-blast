# Titipkirim — WA Campaign

Dashboard pengelolaan kampanye WhatsApp dengan role admin/customer, sesi Baileys, hasil pengiriman, referral, dan saldo.

## Run & Operate

- Start the managed workflows `artifacts/wa-campaign: web` and `artifacts/api-server: API Server`. The preview routes the web app at `/` and the API at `/api`; Replit supplies each service's `PORT`.
- First-time database setup: configure `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Replit Secrets (or root `.env` for local development), run `pnpm run db:push:backup`, then `pnpm --filter @workspace/api-server run create-admin`. Schema setup backs up PostgreSQL first.
- Blast startup uses every online WhatsApp session owned by the customer. Each blast's earnings are held in its running balance and moved to the main balance once the job finishes or is cancelled; referrals credit the referrer's main balance immediately.
- Withdrawal requests reserve the main balance transactionally. Admin review follows `pending → approved → paid` or `pending/approved → rejected`; rejection refunds once and requires a reason.
- `pnpm run typecheck` — typecheck all workspace packages.
- `pnpm --filter @workspace/api-server run dev` — build and run the API (requires `PORT`, `DATABASE_URL`, and `SESSION_SECRET`).
- `pnpm --filter @workspace/wa-campaign run dev` — run Vite (requires `PORT` and `BASE_PATH`).
- `pnpm --filter @workspace/api-spec run codegen` — regenerate typed API clients after editing `lib/api-spec/openapi.yaml`.
- `pnpm run db:backup` writes a custom-format PostgreSQL dump to `generated-artifacts/database-backups/`; that directory is excluded from Git and deployment packaging.

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9, React/Vite.
- API: Express 5, Socket.IO, JWT access and refresh tokens, Baileys.
- Database: PostgreSQL + Drizzle ORM; development schema is applied with `drizzle-kit push`.
- API contracts: OpenAPI, Orval, and generated Zod validation.

## Where things live

- `artifacts/wa-campaign` — React/Vite admin and customer dashboard.
- `artifacts/api-server` — Express routes, blast worker, Baileys sessions, and admin bootstrap command.
- `lib/db/src/schema` — source-of-truth database tables.
- `lib/api-spec/openapi.yaml` — API contract source of truth.
- `artifacts/api-server/.wa-sessions` — local Baileys auth state; ignored by Git and deployment packaging.
- No demo data is seeded. Import only contacts with recorded consent; dashboard data is read from the configured PostgreSQL database.

## Pointers

- See `README.md` for first-time setup and local development.
- `DATABASE_URL` is provided by Replit's database; `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` belong in Replit Secrets. Local development can use a root `.env` file, which is ignored by Git.
