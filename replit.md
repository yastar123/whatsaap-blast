# Titipkirim — WA Campaign

Dashboard pengelolaan kampanye WhatsApp dengan role admin/customer, sesi Baileys, hasil pengiriman, referral, dan saldo.

## Run & Operate

- Start the managed workflows `artifacts/wa-campaign: web` and `artifacts/api-server: API Server`. The preview routes the web app at `/` and the API at `/api`; Replit supplies each service's `PORT`.
- First-time database setup: `pnpm --filter @workspace/db run push`, then `pnpm --filter @workspace/api-server run seed`.
- `pnpm run typecheck` — typecheck all workspace packages.
- `pnpm --filter @workspace/api-server run dev` — build and run the API (requires `PORT`, `DATABASE_URL`, and `SESSION_SECRET`).
- `pnpm --filter @workspace/wa-campaign run dev` — run Vite (requires `PORT` and `BASE_PATH`).
- `pnpm --filter @workspace/api-spec run codegen` — regenerate typed API clients after editing `lib/api-spec/openapi.yaml`.
- Development demo accounts: `admin@demo.local` and `customer@demo.local`; the seed's default password is `DemoOnly2026!`. Do not use these credentials outside local development.

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
