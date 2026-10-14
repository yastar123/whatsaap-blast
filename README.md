# Titipkirim — WA Campaign

Titipkirim adalah dashboard berbahasa Indonesia untuk mengelola kampanye WhatsApp berbasis persetujuan (consent), sesi pengirim, hasil pesan, referral, saldo, dan penarikan. Produk memiliki portal customer dan panel administrator.

> **Penting:** kirim pesan hanya kepada penerima yang memberikan persetujuan aktif. Impor hanya nomor dengan bukti consent yang valid, dan hormati permintaan berhenti (opt-out).

## Isi aplikasi

### Portal customer

- **Ringkasan** — jumlah pesan berhasil/gagal, saldo utama dan saldo berjalan, kampanye aktif, sesi WhatsApp, serta aktivitas terkini.
- **WhatsApp** — membuat hingga lima sesi per akun, menautkan perangkat dengan QR atau pairing code, melihat status, dan menghapus sesi milik sendiri. Pemilik nomor harus menyetujui penautan pada aplikasi WhatsApp di ponselnya.
- **Kirim kampanye** — melihat naskah dan kampanye yang dipilih admin, memilih jeda 1, 5, 15, atau 30 detik, memulai/membatalkan blast, dan melihat progres serta hasil per sesi. Semua sesi online customer menjadi pekerja paralel.
- **Hasil pengiriman** — menelusuri status, memfilter kampanye/status, mencari nomor, membuka ringkasan, dan mengunduh CSV atau XLSX.
- **Dompet** — melihat saldo utama, saldo berjalan/tertunda, pendapatan pesan dan referral, serta riwayat transaksi.
- **Referral** — menyalin tautan/kode undangan, melihat downline, dan melihat bonus.
- **Penarikan** — mengajukan pencairan ke rekening bank atau dompet digital dan memantau status. Nomor rekening customer ditampilkan tersamarkan.

### Panel administrator

- **Ringkasan** — metrik customer, sesi online, jumlah pesan terkirim, dan nilai pendapatan yang dibayarkan.
- **Kampanye** — membuat, mengubah, mengaktifkan, dan menghapus kampanye yang memenuhi syarat; gambar bisa dipilih dari perangkat (JPG, PNG, WebP, atau GIF, maksimal 25 MB) atau menggunakan URL.
- **Kontak & consent** — mengimpor satu nomor telepon per baris atau mengunggah CSV/XLSX satu kolom dari template yang tersedia di halaman, mencari/memfilter kontak, melihat catatan konfirmasi consent, dan menghapus kontak.
- **Akun pengirim** — mencari customer dan mengaktifkan atau memblokir akunnya.
- **Sesi semua pengirim** — memantau dan memutus sesi WhatsApp milik customer.
- **Pengaturan** — mengubah tarif per pesan, bonus referral, minimum penarikan, jam tunggu pelepasan saldo, batas pesan per sesi per jam, masa idle sesi, dan kebijakan antrekan ulang setelah sesi terputus.
- **Hasil pengiriman dan penarikan** — melihat hasil lintas customer; meninjau, menyetujui, membayar, atau menolak permintaan penarikan dengan alasan.

Halaman terdaftar: `/`, `/login`, `/register`, `/whatsapp`, `/blast`, `/results`, `/wallet`, `/referrals`, `/withdrawals`, `/campaigns`, `/contacts`, `/customers`, `/admin/sessions`, dan `/settings`. Menu dibatasi menurut peran; API memeriksa otorisasi yang sama di server. Login, register, dan API memerlukan koneksi server/database.

## Aturan operasional

1. Admin membuat kampanye, memasukkan naskah, mengimpor nomor, lalu mengaktifkan kampanye.
2. Impor kontak meminta admin mengonfirmasi bahwa setiap nomor sudah menyetujui pesan WhatsApp. Konfirmasi dan waktunya dicatat sebagai sumber consent; format kontak hanya memerlukan nomor telepon. Template CSV/XLSX satu kolom dapat diunduh dari halaman Kontak. Nomor dinormalisasi ke angka; nomor duplikat di kampanye yang sama tidak dimasukkan ulang.
3. Pekerja blast memeriksa ulang bahwa sumber dan waktu consent ada serta consent belum dicabut sebelum mengklaim kontak. Klaim menggunakan penguncian database agar sesi paralel tidak mengambil kontak yang sama.
4. Customer harus mempunyai sesi WhatsApp **online** untuk memulai blast. Sesi yang sudah online berjalan paralel; laju tetap dibatasi oleh jeda pilihan dan batas per jam pada pengaturan.
5. Progres dan status sesi/pesan dipublikasikan melalui Socket.IO. Hasil juga tersimpan di database dan dapat diekspor.
6. Pendapatan selama blast masuk ke saldo berjalan. Saat pekerjaan selesai atau dibatalkan, saldo berjalan dipindahkan ke saldo utama. Bonus referral masuk ke saldo utama.
7. Permintaan penarikan menahan saldo utama secara transaksional. Admin memproses status `pending → approved → paid`, atau menolak dengan alasan. Penolakan mengembalikan saldo sekali saja; permintaan yang sudah dibayar tidak dapat diubah.
8. Admin dapat memblokir customer; akses customer yang diblokir ditolak sampai diaktifkan kembali.

Nilai awal pengaturan: Rp1.100 per pesan berhasil, bonus referral Rp60 per pesan, minimum penarikan Rp15.000, pelepasan saldo tertunda 24 jam, maksimal 30 pesan per sesi per jam, masa idle 10 menit, dan antre ulang saat sesi terputus aktif.

## Teknologi dan struktur

- **Workspace:** pnpm workspaces, TypeScript.
- **Web:** React, Vite, Wouter, TanStack Query, Tailwind CSS, komponen Radix UI.
- **API:** Express 5, Socket.IO, JWT, Baileys, ExcelJS.
- **Data:** PostgreSQL, Drizzle ORM; validasi kontrak Zod.
- **Kontrak API:** `lib/api-spec/openapi.yaml` adalah sumber spesifikasi; client React Query dan schema Zod digenerate.

| Lokasi | Isi |
| --- | --- |
| `artifacts/wa-campaign/` | Frontend React/Vite dan halaman dashboard |
| `artifacts/api-server/src/routes/` | Route API |
| `artifacts/api-server/src/lib/` | Auth, pairing Baileys, worker blast, saldo, dan pengaturan |
| `artifacts/api-server/src/create-admin.ts` | Membuat atau memperbarui akun admin dari environment |
| `artifacts/api-server/src/smoke-test.mjs` | Tes integrasi API dan halaman |
| `lib/api-spec/openapi.yaml` | Kontrak endpoint |
| `lib/api-client-react/`, `lib/api-zod/` | Client dan validasi hasil codegen |
| `lib/db/src/schema/` | Skema PostgreSQL |
| `scripts/` | Backup dan pembaruan skema database |

## API

Semua route HTTP tersedia dengan prefiks `/api`; dokumentasi request/response lengkap ada di `lib/api-spec/openapi.yaml`. Route yang memerlukan login memakai `Authorization: Bearer <accessToken>`.

| Area | Endpoint |
| --- | --- |
| Status | `GET /healthz` |
| Akun | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Ringkasan | `GET /dashboard/overview`, `GET /campaigns/active` |
| Sesi customer | `GET/POST /wa-sessions`, `POST /wa-sessions/{sessionId}/connect`, `DELETE /wa-sessions/{sessionId}` |
| Sesi admin | `GET /admin/wa-sessions`, `DELETE /admin/wa-sessions/{sessionId}` |
| Kampanye | `GET/POST /admin/campaigns`, `PATCH/DELETE /admin/campaigns/{campaignId}`, `POST /admin/campaigns/{campaignId}/activate`, `POST /admin/campaign-images` (upload gambar, maksimal 25 MB) |
| Kontak | `GET/POST /admin/contacts`, `GET /admin/contacts/template/{csv|xlsx}`, `POST /admin/contacts/import-file`, `DELETE /admin/contacts/{contactId}` |
| Customer | `GET /admin/users`, `PATCH /admin/users/{userId}/status` |
| Blast | `POST /blast/start`, `POST /blast/cancel`, `GET /blast/current` |
| Hasil | `GET /results`, `/results/summary`, `/results/campaigns`, `/results/export` |
| Dompet dan referral | `GET /wallet`, `GET /referrals` |
| Penarikan | `GET/POST /withdrawals`, `PATCH /admin/withdrawals/{withdrawalId}` |
| Pengaturan | `GET/PATCH /admin/settings` |
| Realtime | Socket.IO pada `/api/socket.io` |

## Menjalankan di Replit

Project memiliki dua workflow artifact terkelola; gunakan keduanya dan jangan membuat workflow duplikat:

- `artifacts/api-server: API Server` — Express, Socket.IO, worker dan API pada `/api`.
- `artifacts/wa-campaign: web` — frontend pada `/`.

Replit meneruskan path dan memberikan `PORT`/`BASE_PATH` kepada tiap layanan. Buka preview web di `/`; jangan mengasumsikan port lokal tertentu.

Setup pertama:

```sh
pnpm install --frozen-lockfile
pnpm run db:push:backup
pnpm --filter @workspace/api-server run create-admin
```

Sebelum perintah tersebut, atur `ADMIN_EMAIL` dan `ADMIN_PASSWORD` di Replit Secrets, atau isi variabelnya pada `.env` lokal. `ADMIN_PASSWORD` harus minimal 12 karakter. Perintah `create-admin` membuat akun admin bila belum ada, atau memperbarui sandi akun admin dengan email yang sama; email yang sudah dipakai akun customer akan ditolak. `DATABASE_URL` disediakan otomatis oleh database Replit; untuk PostgreSQL lokal, isi di `.env`. API dan Drizzle membaca `.env` dari root workspace. `SESSION_SECRET` juga harus tersedia sebagai Replit Secret atau di `.env` lokal.

Tidak ada akun, kampanye, kontak, atau data demo yang dibuat otomatis. Data dashboard dibaca dari database yang ditentukan oleh `DATABASE_URL`.

### Lingkungan lokal

Salin `.env.example` ke `.env`, lalu isi URL PostgreSQL lokal serta `SESSION_SECRET`, `ADMIN_EMAIL`, dan `ADMIN_PASSWORD`. File `.env` diabaikan Git. Jangan gunakan database production untuk uji coba.

```sh
cp .env.example .env
pnpm run db:push:backup
pnpm --filter @workspace/api-server run create-admin
```

API memuat `.env` saat dijalankan. Web di luar Replit memakai `PORT` dan `BASE_PATH` (umumnya `PORT=3000`, `BASE_PATH=/`); API memakai `PORT` (contoh `5000`). Jangan menaruh secret di Git. Direktori `.wa-sessions/` dan `.env` tidak untuk di-commit.

Gambar kampanye disimpan di direktori `uploads` pada working directory API. Atur `CAMPAIGN_UPLOAD_DIR` ke direktori persisten yang dapat ditulis jika deployment menggunakan filesystem sementara; file tersedia secara publik di `/api/uploads/` agar dapat diambil oleh WhatsApp.

## Pengembangan dan pengujian

```sh
pnpm run typecheck
pnpm --filter @workspace/wa-campaign run typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test:smoke
pnpm run db:backup
pnpm run db:push:backup
pnpm --filter @workspace/api-server run create-admin
pnpm --filter @workspace/api-spec run codegen
```

Smoke test memeriksa route HTML, endpoint kesehatan, login/register dan rotasi token, pemisahan hak akses, CRUD kampanye, validasi impor/consent, sesi tanpa pairing, hasil/ekspor, saldo dan transisi/refund penarikan. Test menulis data QA sementara ke **database development** lalu membersihkannya. Jalankan hanya ketika kedua workflow aktif, skema database development sudah diterapkan, dan kredensial admin tersedia; test menolak mode production. Test tidak memindai QR, memasangkan nomor sungguhan, maupun mengirim pesan WhatsApp.

Untuk mengubah API: edit OpenAPI terlebih dahulu, jalankan codegen, lalu sesuaikan route dan client. Skema dikembangkan dengan Drizzle `push`; repo ini tidak menyimpan direktori migrasi SQL. Sebelum perubahan skema, gunakan `pnpm run db:push:backup`. Backup custom-format tersimpan di `generated-artifacts/database-backups/` (diabaikan Git/deployment); untuk memulihkan, gunakan alat PostgreSQL seperti `pg_restore` dengan database target yang benar.

## Keamanan dan batas pengujian

- Kata sandi di-hash dengan bcrypt. Access token berlaku 15 menit; refresh token acak berlaku tujuh hari, disimpan sebagai hash dan diputar saat refresh.
- Nilai rekening dienkripsi dengan AES-256-GCM menggunakan kunci turunan `SESSION_SECRET`; respons customer menyamarkan nomor rekening, sedangkan admin yang berwenang dapat melihat detail untuk transfer manual.
- Smoke test hanya untuk development. Jangan menjalankan test terhadap production atau mengirim broadcast selama pengujian.
- Pengiriman WhatsApp nyata memerlukan perangkat/nomor customer yang ditautkan, sesi online, kampanye aktif, dan kontak yang benar-benar memberi consent. Perilaku pairing jaringan dan pengiriman end-to-end perlu diuji menggunakan nomor uji yang dikendalikan pemiliknya; smoke test otomatis tidak mengirim pesan.
- Pengelola sesi mengikuti protokol Baileys tidak resmi. Perubahan/ketidaktersediaan WhatsApp dapat memengaruhi pairing atau pengiriman dan tidak dapat disimulasikan oleh tes lokal.
