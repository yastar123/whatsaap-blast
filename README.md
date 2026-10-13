# Titipkirim — WA Campaign

Dashboard berbahasa Indonesia untuk mengelola kampanye WhatsApp, sesi pengirim, hasil, referral, dan penarikan. Pengiriman hanya mengambil kontak yang memiliki bukti consent aktif; 300 kontak seed adalah placeholder dan tidak dapat dikirimi pesan.

## Stack dan struktur

- Frontend: React, Vite, Wouter, TanStack Query, Tailwind CSS.
- Backend: Express, Socket.IO, JWT, Baileys.
- Database: PostgreSQL dengan Drizzle ORM.
- `artifacts/wa-campaign/` — frontend.
- `artifacts/api-server/` — API, sesi WhatsApp, worker blast, dan seed.
- `lib/db/src/schema/` — skema database.
- `lib/api-spec/openapi.yaml` — kontrak API; kode client/server dihasilkan dari sini.

## Menjalankan di Replit

1. Jalankan `pnpm install --frozen-lockfile`.
2. Siapkan skema development dengan `pnpm run db:push:backup` (membuat backup sebelum mengubah skema).
3. Buat akun demo dan 300 placeholder dengan `pnpm --filter @workspace/api-server run seed`.
4. Jalankan workflow `artifacts/api-server: API Server` dan `artifacts/wa-campaign: web`.
5. Buka preview web di `/`. Endpoint API dan Socket.IO tersedia melalui `/api`.

Replit mengatur port lokal setiap artifact secara otomatis dan meneruskan trafik melalui path di atas; nilai port lokal tidak harus `3000` dan `5000`. Untuk menjalankan layanan di luar Replit, API dapat memakai `PORT=5000` dan Vite `PORT=3000` serta `BASE_PATH=/`. Muat variabel dari `.env` ke shell sebelum menjalankan perintah. Vite di Replit menggunakan proxy path platform untuk mengakses API.

## Database, environment, dan seed

Replit menyediakan `DATABASE_URL` secara otomatis. `SESSION_SECRET` harus tersedia sebagai Replit Secret. Jangan commit `.env` atau isi folder `.wa-sessions`.

Untuk lingkungan lokal, salin `.env.example` ke `.env`, sesuaikan PostgreSQL dan rahasia lokal, lalu ekspor nilainya. Gunakan `pnpm run db:push:backup` sebelum perubahan skema; backup PostgreSQL tersimpan di `generated-artifacts/database-backups/`, yang diabaikan Git dan deployment:

```sh
cp .env.example .env
set -a
. ./.env
set +a
pnpm run db:push:backup
pnpm --filter @workspace/api-server run seed
```

Seed hanya boleh berjalan di development. Akun demo: `admin@demo.local` dan `customer@demo.local`; kata sandi default seed `DemoOnly2026!`, atau isi `SEED_DEMO_PASSWORD` sebelum menjalankan seed. Jangan gunakan akun demo atau kata sandi default di deployment.

Skema saat ini dikelola dengan Drizzle dan `drizzle-kit push` untuk database development. Tidak ada direktori migrasi SQL yang dilacak di repo ini.

## Menghubungkan WhatsApp

1. Daftar atau masuk sebagai customer.
2. Buka **WhatsApp**, tambah satu atau lebih sesi, lalu tautkan masing-masing dengan QR atau pairing code.
3. Tautkan perangkat dari WhatsApp pada ponsel pemilik nomor.
4. Admin harus membuat dan mengaktifkan kampanye serta mengimpor kontak yang telah memberi persetujuan.
5. Customer menghubungkan satu atau lebih sesi online, memilih jeda, lalu mulai blast. Semua sesi online menjadi pekerja paralel; status, QR, dan progres diperbarui melalui Socket.IO.

Jangan kirim ke nomor yang tidak memberi persetujuan. Hentikan pengiriman bila penerima meminta berhenti.

## Perintah pengembangan

```sh
pnpm run typecheck
pnpm run db:push:backup
pnpm run db:backup
pnpm --filter @workspace/api-server run seed
pnpm --filter @workspace/api-spec run codegen
```

Perubahan endpoint dimulai dari OpenAPI, lalu jalankan codegen sebelum memakai hook atau schema hasil generate. `drizzle-kit push` ditujukan untuk development; jangan jalankan seed pada production.
