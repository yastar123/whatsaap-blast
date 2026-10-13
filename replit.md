# Titipkirim — WA Campaign

Dashboard pengelolaan kampanye WhatsApp dengan role admin/customer, sesi Baileys, hasil pengiriman, referral, dan saldo.

## Run & Operate

- Start the managed workflows `artifacts/wa-campaign: web` and `artifacts/api-server: API Server`. The preview routes the web app at `/` and the API at `/api`; Replit supplies each service's `PORT`.
- First-time database setup: `pnpm run db:push:backup`, then `pnpm --filter @workspace/api-server run seed`. The wrapper backs up PostgreSQL before applying schema changes.
- Blast startup uses every online WhatsApp session owned by the customer. Each blast's earnings are held in its running balance and moved to the main balance once the job finishes or is cancelled; referrals credit the referrer's main balance immediately.
- Withdrawal requests reserve the main balance transactionally. Admin review follows `pending → approved → paid` or `pending/approved → rejected`; rejection refunds once and requires a reason.
- `pnpm run typecheck` — typecheck all workspace packages.
- `pnpm --filter @workspace/api-server run dev` — build and run the API (requires `PORT`, `DATABASE_URL`, and `SESSION_SECRET`).
- `pnpm --filter @workspace/wa-campaign run dev` — run Vite (requires `PORT` and `BASE_PATH`).
- `pnpm --filter @workspace/api-spec run codegen` — regenerate typed API clients after editing `lib/api-spec/openapi.yaml`.
- Development demo accounts: `admin@demo.local` and `customer@demo.local`; the seed's default password is `DemoOnly2026!`. Do not use these credentials outside local development.
- `pnpm run db:backup` writes a custom-format PostgreSQL dump to `generated-artifacts/database-backups/`; that directory is excluded from Git and deployment packaging.

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9, React/Vite.
- API: Express 5, Socket.IO, JWT access and refresh tokens, Baileys.
- Database: PostgreSQL + Drizzle ORM; development schema is applied with `drizzle-kit push`.
- API contracts: OpenAPI, Orval, and generated Zod validation.

## Where things live

- `artifacts/wa-campaign` — React/Vite admin and customer dashboard.
- `artifacts/api-server` — Express routes, blast worker, Baileys sessions, and seed.
- `lib/db/src/schema` — source-of-truth database tables.
- `lib/api-spec/openapi.yaml` — API contract source of truth.
- `artifacts/api-server/.wa-sessions` — local Baileys auth state; ignored by Git and deployment packaging.
- Demo contacts intentionally have no consent record, so they cannot enter the blast queue. Import only contacts with recorded permission.

## Pointers

- See `README.md` for first-time setup and local development.
- `DATABASE_URL` is provided by Replit's database; `SESSION_SECRET` is stored as a Replit secret.
