# PRD: Titipkirim — WA Campaign

## 1. Ringkasan Produk

Titipkirim adalah platform dashboard berbasis web dan API untuk mengelola kampanye WhatsApp yang mematuhi prinsip persetujuan (consent), sesi pengirim, hasil pengiriman, referral, saldo, dan penarikan. Produk ini memiliki dua lingkungan utama:

- Portal customer: digunakan oleh pengguna yang memiliki nomor WhatsApp dan ingin menjalankan kampanye pengiriman pesan massal ke kontak yang sudah memberikan persetujuan.
- Panel administrator: digunakan oleh admin untuk mengelola campaign, contacts, customer, settings, pembayaran, serta monitoring sistem secara lintas akun.

Sistem ini dirancang untuk memastikan pengiriman hanya dilakukan kepada kontak yang valid, memiliki bukti consent, dan tidak termasuk nomor placeholder tanpa otorisasi. Pengiriman dijalankan melalui sesi WhatsApp customer yang online, dengan kontrol rate limiting, progress tracking real-time, keamanan otorisasi per role, serta integrasi ke database PostgreSQL dan worker background.

---

## 2. Latar Belakang dan Tujuan Bisnis

### 2.1 Latar Belakang

Bisnis WhatsApp marketing memerlukan proses yang aman dan terukur karena:

- pengiriman massal harus sesuai dengan persetujuan pelanggan yang telah diberikan;
- setiap kontak harus diverifikasi dan terdokumentasi dengan sumber consent dan timestamp;
- nomor yang tidak memenuhi syarat (placeholder, duplikat, atau tanpa consent) tidak boleh diproses;
- pengelolaan saldo, bukti transaksi, dan proses penarikan harus transparan dan terdokumentasi;
- sistem perlu menjalankan banyak sesi secara paralel tanpa tumpang tindih data atau pengambilan kontak yang sama.

### 2.2 Tujuan Produk

Tujuan utama produk:

1. Mengelola kampanye WhatsApp secara legal, aman, dan terkontrol.
2. Memberikan pengalaman jelas bagi customer dalam menghubungkan WhatsApp, memulai blast, memonitor progres, dan melihat hasil.
3. Menyediakan admin dengan kontrol penuh terhadap kampanye, kontak, pengguna, pengaturan tarif, serta proses pembayaran.
4. Menghindari pengiriman ke kontak tanpa consent aktif dan mematuhi kebijakan opt-out.
5. Menyediakan reputasi serta audit trail untuk setiap aktivitas pengiriman dan transaksi finansial.

### 2.3 Nilai yang Dihasilkan

- Efisiensi operasional dalam pengelolaan kampanye massal.
- Keamanan data dan kepatuhan terhadap consent.
- Transparansi hasil pengiriman dan saldo.
- Keandalan sistem dengan monitoring real-time dan arsitektur worker.

---

## 3. Pengguna dan Peran

### 3.1 Customer

Customer adalah pihak yang memiliki akun WhatsApp, mengelola WhatsApp session, menjalankan blast, dan memantau performa kampanye. Customer dapat:

- mendaftar dan login ke portal;
- mengelola hingga lima sesi WhatsApp per akun;
- menautkan perangkat melalui QR atau pairing code;
- melihat status sesi online/offline;
- menjalankan kampanye aktif dari naskah yang tersedia;
- melihat progres dan hasil pengiriman per sesi;
- melihat saldo, referral, dan riwayat transaksi;
- mengajukan penarikan dana.

### 3.2 Administrator

Admin memiliki akses penuh atas operasional platform. Admin dapat:

- membuat dan mengelola campaign;
- mengimpor dan membersihkan kontak serta bukti consent;
- mengaktifkan atau menonaktifkan akun customer;
- memantau sesi WhatsApp seluruh pengguna;
- mengatur tarif, bonus referral, minimum withdrawal, batas rate, dan kebijakan sistem;
- meninjau hasil pengiriman secara global;
- meninjau, menyetujui, membayar, atau menolak permintaan penarikan;
- mengelola akses serta kebijakan keamanan.

### 3.3 Sistem / Worker

Worker background bertanggung jawab untuk:

- memeriksa kuota dan consent sebelum membagikan kontak;
- mengunci kontak agar tidak diambil dua sesi sekaligus;
- mengirim pesan secara bertahap sesuai delay, rate limit, dan batas per jam;
- memperbarui status real-time melalui Socket.IO;
- menghitung pendapatan dan memindahkan saldo berjalan ke saldo utama.

---

## 4. Fungsi Utama Produk

### 4.1 Portal Customer

### Dashboard

Customer melihat:

- jumlah pesan berhasil/gagal;
- saldo utama dan saldo berjalan;
- kampanye aktif;
- sesi WhatsApp yang sedang online;
- aktivitas terbaru dan ringkasan performa.

### WhatsApp Session Management

Fitur ini mencakup:

- membuat hingga 5 sesi per akun;
- menyambungkan perangkat dengan QR atau pairing code;
- mengecek status koneksi; 
- menghapus sesi milik sendiri;
- memastikan pemilik nomor menyetujui penautan di aplikasi WhatsApp.

### Blast Campaign

Customer dapat:

- melihat naskah dan campaign yang tersedia dari admin;
- memilih delay pengiriman: 1, 5, 15, atau 30 detik;
- memulai blast;
- membatalkan blast yang sedang berjalan;
- melihat progress per sesi dan status akhir.

Semua sesi WhatsApp customer yang online diperlakukan sebagai pekerja paralel. Kecepatan pengiriman dibatasi oleh delay yang dipilih dan quota per sesi per jam yang ditetapkan admin.

### Result Management

Customer dapat:

- menelusuri hasil pengiriman;
- memfilter berdasarkan campaign dan status; 
- mencari nomor penerima;
- membuka ringkasan pengiriman; 
- mengunduh file CSV/XLSX hasil.

### Wallet & Referral

Customer dapat:

- melihat saldo utama;
- melihat saldo berjalan dan tertunda;
- menilai pendapatan dari setiap pesan;
- melihat komisi referral; 
- melihat riwayat transaksi;
- menyalin link atau kode referral untuk downline.

### Withdrawal

Customer dapat:

- mengajukan penarikan ke rekening bank atau dompet digital;
- melihat status pengajuan;
- melihat rekening yang disamarkan; 
- melihat riwayat status `pending`, `approved`, `paid`, atau `rejected`.

---

## 4.2 Panel Administrator

### Dashboard Admin

Admin melihat:

- jumlah customer aktif;
- jumlah sesi online;
- total pesan terkirim;
- pendapatan dibayarkan secara agregat.

### Campaign Management

Admin dapat:

- membuat dan mengubah campaign;
- memasukkan naskah pesan;
- mengaktifkan campaign yang memenuhi syarat;
- menonaktifkan atau menghapus campaign.

### Contacts & Consent Management

Admin dapat:

- mengimpor kontak dalam format `nomor, sumber consent, waktu ISO`;
- memvalidasi nomor dan tanggal;
- melihat status contact;
- melihat bukti consent;
- melihat data duplikat dan duplicate handling;
- menghapus contact sesuai kebijakan.

### User Management

Admin dapat:

- mencari customer; 
- menonaktifkan atau memblokir akun; 
- mengaktifkan kembali akun yang diblokir.

### Session Control

Admin dapat:

- melihat semua sesi customer; 
- memutus koneksi sesi WhatsApp;
- memantau status online/offline dan health masing-masing session.

### Settings

Admin dapat mengubah:

- tarif per pesan; 
- bonus referral; 
- minimum penarikan; 
- jam tunggu pelepasan saldo; 
- batas pesan per sesi per jam; 
- masa idle sesi; 
- kebijakan antre ulang saat sesi terputus; 
- perilaku sistem secara umum untuk rate limiting dan orchestration.

### Withdrawal Review

Admin dapat:

- melihat semua request withdrawal lintas customer; 
- meninjau detail rekening; 
- menyetujui, menolak, atau menandai sebagai dibayar; 
- menambahkan alasan penolakan; 
- menyesuaikan saldo apabila perlu.

---

## 5. Alur Bisnis dan Flow

### 5.1 Flow Pendaftaran dan Login

1. User masuk ke `/register`.
2. Sistem membuat akun dengan role customer atau admin sesuai akses.
3. User login melalui `/login` dengan JWT.
4. Server memeriksa authorization dan memastikan role sesuai route.
5. Token dipakai untuk seluruh call API yang butuh autentikasi.

### 5.2 Flow Penautan WhatsApp

1. Customer membuka halaman WhatsApp.
2. Sistem menampilkan QR atau pairing code.
3. Customer membuka WhatsApp di ponsel dan memindai QR / memasukkan pairing code.
4. Sistem menyimpan sesi dan menunggu status online.
5. Server memvalidasi bahwa pemilik nomor menyetujui pair pada device yang relevan.

### 5.3 Flow Import Contact dan Consent

1. Admin mengupload data CSV/worksheet.
2. Sistem memvalidasi setiap record.
3. Nomor di-normalisasi ke format numerik.
4. Waktu consent harus valid dan tidak di masa depan.
5. Duplicate kontak yang sama pada campaign yang sama tidak masuk lagi.
6. Contact disimpan dengan metadata bukti consent dan sumber consent.

### 5.4 Flow Blast Campaign

1. Admin menyiapkan campaign dan status aktif.
2. Customer membuka halaman blast dan memilih campaign yang tersedia.
3. Customer menyiapkan delay pengiriman.
4. Sistem memastikan customer memiliki sesi WhatsApp online.
5. Worker memeriksa consent, status campaign, dan scheduling.
6. Worker mengunci kontak satu per satu untuk mencegah overlap.
7. Pesan dikirim sesuai jalur queue dan rate limiter.
8. Progres dipublikasikan ke frontend secara real-time via Socket.IO.
9. Setelah selesai atau dibatalkan, saldo berjalan dipindahkan ke saldo utama.

### 5.5 Flow Withdrawal

1. Customer mengajukan withdrawal dengan jumlah minimal.
2. Sistem menahan saldo utama secara transaksional.
3. Admin meninjau pengajuan.
4. Status berubah `pending -> approved -> paid` atau `rejected`.
5. Jika rejected, saldo dikembalikan; jika paid, status final.

### 5.6 Flow Referral

1. Customer mendapatkan kode atau link referral.
2. Downline yang mendaftar menggunakan kode tersebut terhubung.
3. Sistem menghitung bonus atas pesan yang dihasilkan.
4. Bonus masuk ke saldo utama customer.

---

## 6. Aturan Operasional dan Business Rules

1. Hanya kontak dengan consent aktif yang boleh dijadikan target pengiriman.
2. Data consent harus menyertakan sumber dan waktu ISO.
3. Waktu consent tidak boleh berada di masa depan.
4. Hanya kontak dengan consent aktif yang memenuhi syarat.
5. Nomor duplikat dalam campaign yang sama tidak dimasukkan ulang.
6. Customer harus punya sesi WhatsApp online untuk menjalankan blast.
7. Sesi online dapat berjalan paralel, tapi dibatasi oleh delay pilihan dan quota per sesi per jam.
8. Pekerja blast harus memeriksa ulang bahwa consent masih valid sebelum tiap pengiriman.
9. Pengambilan kontak harus didukung dengan locking database agar tidak double-pick.
10. Semua status progress dan hasil pesan dipublikasikan melalui Socket.IO.
11. Saldo berjalan berfungsi sebagai saldo tertunda untuk pekerjaan aktif. Setelah selesai atau dibatalkan, saldo masuk ke saldo utama.
12. Referral bonus masuk langsung ke saldo utama.
13. Withdrawal menahan dana secara transaksional hingga diproses.
14. Admin dapat memblokir customer; akses dibatasi sampai diaktifkan ulang.
15. Aksi `reject` hanya dapat dilakukan pada request `pending`; setelah `paid` tidak bisa diubah.

---

## 7. Data Model dan Entitas Utama

### 7.1 User

Representasi akun platform.

Atribut utama:

- id
- email
- password hash
- role (`customer` / `admin`)
- status (`active` / `blocked`)
- createdAt
- updatedAt

### 7.2 WA Session

Sesi koneksi WhatsApp per pengguna.

Atribut utama:

- id
- userId
- sessionName
- status (`online`, `offline`, `connecting`, `disconnected`)
- device info / pairing metadata
- lastSeen
- createdAt
- updatedAt

### 7.3 Campaign

Campaign adalah template pengiriman aktif untuk customer.

Atribut utama:

- id
- adminId atau sistem owner
- title
- message text
- status (`draft`, `active`, `inactive`, `deleted`)
- createdAt
- updatedAt

### 7.4 Contact

Kontak target yang memiliki consent.

Atribut utama:

- id
- campaignId
- normalizedPhone
- sourceConsent
- consentAt
- status (`valid`, `invalid`, `blocked`, `opted_out`)
- proof metadata
- createdAt

### 7.5 Blast Job

Pekerjaan pengiriman aktif.

Atribut utama:

- id
- customerId
- campaignId
- sessionId
- delaySeconds
- status (`queued`, `running`, `paused`, `cancelled`, `completed`, `failed`)
- totalQueued
- totalSent
- totalFailed
- startedAt
- finishedAt

### 7.6 Result / Message Log

Catatan hasil pengiriman per nomor.

Atribut utama:

- id
- blastJobId
- contactId
- phone
- status (`sent`, `failed`, `blocked`, `opted_out`, `pending`)
- messageId / delivery info
- errorMessage
- sentAt

### 7.7 Wallet

Saldo pengguna.

Atribut utama:

- userId
- mainBalance
- pendingBalance
- totalRevenue
- referralBonus
- updatedAt

### 7.8 Withdrawal

Permintaan tarik dana.

Atribut utama:

- id
- userId
- amount
- method (`bank`, `e-wallet`)
- account detail (terenkripsi / disamarkan)
- status (`pending`, `approved`, `paid`, `rejected`)
- rejectionReason
- createdAt
- processedAt

### 7.9 Referral

Atribut utama:

- id
- referrerUserId
- referredUserId
- code atau link
- bonusAmount
- createdAt

### 7.10 Settings

Pengaturan sistem dan rate policy.

Nilai awal yang tertanam di aplikasi:

- tarif per pesan: Rp1.100
- bonus referral: Rp60 per pesan
- minimum penarikan: Rp15.000
- hold saldo: 24 jam
- max pesan per sesi per jam: 30
- idle session timeout: 10 menit
- retry queue saat sesi terputus: aktif

---

## 8. Persyaratan Fungsional

### 8.1 Autentikasi dan Otorisasi

- User dapat registrasi dan login.
- Password disimpan aman (hashing + salting).
- API semua route menggunakan `Authorization` header.
- Route memeriksa peran dan akses server-side.
- Akses customer di blokir jika status akun `blocked`.

### 8.2 Dashboard

- Customer dan admin dapat melihat ringkasan sesuai konteks mereka.
- Dashboard menampilkan data real-time yang di-refresh melalui API dan Socket.IO.

### 8.3 Campaign Management

- Admin dapat membuat campaign baru.
- Admin dapat mengubah isi pesan dan metadata.
- Campaign dapat diaktifkan dan dinonaktifkan.
- Campaign yang tidak valid atau tidak aktif tidak dapat diproses oleh customer.

### 8.4 Contact Import and Validation

- Admin dapat mengimpor data kontak dari CSV/Excel.
- Sistem memvalidasi format nomor dan tanggal consent.
- Duplicate nomor dalam campaign yang sama dihapus.
- Semua kontak harus memiliki proof of consent.

### 8.5 Blast Execution

- Customer hanya dapat menjalankan campaign yang valid dan aktif.
- Sistem memastikan sesi WhatsApp online.
- Delay dapat dipilih menurut konfigurasi.
- Blast dapat dibatalkan.
- Status progress and result tersedia real-time.

### 8.6 Results and Export

- Sistem menghasilkan hasil per nomor, per sesi, per campaign.
- Customer dapat memfilter dan mencari hasil.
- Customer dapat men-download export CSV/XLSX.

### 8.7 Wallet and Payment

- Pendapatan pengiriman masuk ke saldo berjalan.
- Saat selesai atau dibatalkan, saldo berjalan dipindahkan ke saldo utama.
- Admin dapat memproses withdrawal.
- Semua transaksi harus terdokumentasi dan auditable.

### 8.8 Referral

- Referral link atau code tersedia untuk customer.
- Customer dapat melihat downline dan bonus.
- Bonus dihitung berdasarkan aktivitas referral.

---

## 9. Arsitektur Sistem

### 9.1 Stack Teknologi

- Web: React + Vite + Wouter + TanStack Query + Tailwind CSS + Radix UI
- API: Express 5 + Socket.IO + JWT + Baileys + ExcelJS
- Database: PostgreSQL
- ORM: Drizzle
- Validasi: Zod
- API Contract: OpenAPI specification (`lib/api-spec/openapi.yaml`)
- Client Codegen: React Query dan Zod schema generation

### 9.2 Struktur Repository

- `artifacts/wa-campaign/` — frontend React/Vite dan dashboard web
- `artifacts/api-server/src/routes/` — route API
- `artifacts/api-server/src/lib/` — auth, Baileys pairing, blast worker, wallet, settings
- `artifacts/api-server/src/create-admin.ts` — bootstrap akun admin dari environment
- `artifacts/api-server/src/smoke-test.mjs` — smoke test API dan halaman
- `lib/api-spec/openapi.yaml` — sumber kontrak endpoint
- `lib/api-client-react/` — client generated
- `lib/api-zod/` — schema generated untuk validasi
- `lib/db/src/schema/` — schema PostgreSQL
- `scripts/` — backup dan update database schema

### 9.3 API Exposure

Semua API berada di prefix `/api`.

Endpoint utama:

- Status: `GET /healthz`
- Auth: `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`
- Overview: `/dashboard/overview`, `/campaigns/active`
- WA Session: `/wa-sessions`, `/wa-sessions/{sessionId}/connect`, `/wa-sessions/{sessionId}`
- Admin Sessions: `/admin/wa-sessions`, `/admin/wa-sessions/{sessionId}`
- Campaign: `/admin/campaigns`, `/admin/campaigns/{campaignId}`
- Contacts: `/admin/contacts`
- Customers: `/admin/users`, `/admin/users/{userId}/status`
- Blast: `/blast/start`, `/blast/cancel`, `/blast/current`
- Results: `/results`, `/results/summary`, `/results/campaigns`, `/results/export`
- Wallet & Referral: `/wallet`, `/referrals`
- Withdrawal: `/withdrawals`, `/admin/withdrawals/{withdrawalId}`
- Settings: `/admin/settings`
- Realtime: Socket.IO pada `/api/socket.io`

---

## 10. Kebijakan Keamanan dan Kepatuhan

### 10.1 Consent-Based Messaging

Platform ini memprioritaskan prinsip consent-first. Pengiriman tidak dilakukan jika:

- consent tidak ada;
- sumber consent tidak valid;
- consent expired atau dicabut;
- nomor placeholder atau data dummy.

### 10.2 Authorization and Access Control

- Semua route protected memerlukan JWT.
- Hak akses dibatasi berdasarkan role.
- Validasi juga dilakukan di server-side agar client tidak bisa memanipulasi aturan.

### 10.3 Data Protection

- Data rekening customer disimpan aman dan terenkripsi.
- Session secret wajib di-provide melalui environment variable `SESSION_SECRET`.
- API dan web service harus dijalankan hanya dengan koneksi server/database yang valid.

### 10.4 Operational Safety

- Worker menghindari double-claim kontak dengan database lock.
- Rate limit diatur agar tidak melebihi ambang yang ditetapkan.
- Semua tindakan kritikal dihasilkan bersama audit log dan state transaksi.

---

## 11. Non-Functional Requirements

### 11.1 Kinerja

- Frontend harus merespons cepat dan mampu menampilkan dashboard real-time.
- Pengiriman massal harus berjalan secara paralel sesuai jumlah sesi online customer.
- API harus menanggapi request utama dalam waktu yang dapat diterima untuk dashboard berbasis data.

### 11.2 Reliabilitas

- Sistem harus menangani proses blast dan session disconnect dengan recovery strategy.
- Status pekerjaan harus tetap konsisten bahkan saat sesi down atau reconnect.
- Worker harus mampu melanjutkan atau menghentikan proses dengan mekanisme persisten state.

### 11.3 Skalabilitas

- Platform harus support multiple customer accounts dan multiple WA sessions per account.
- Worker dapat menambah kapasitas tanpa mengubah flow pengguna utama.

### 11.4 Observability

- Sistem harus menyediakan endpoint status, logging, dan status proses.
- Progress dan error harus dapat dilihat dari dashboard serta event realtime.

---

## 12. Kondisi Deployment dan Runtime

Project memiliki dua workflow utama yang harus dijalankan secara terpisah:

- `artifacts/api-server` — server API, Socket.IO, worker, dan backend logic.
- `artifacts/wa-campaign` — frontend React app.

Pada Replit, path dan port diberikan secara otomatis. Buka preview web di `/`, bukan berdasarkan port lokal.

### Setup Awal

```sh
pnpm install --frozen-lockfile
pnpm run db:push:backup
pnpm --filter @workspace/api-server run create-admin
```

### Variabel Penting

- `DATABASE_URL` — database PostgreSQL yang dipakai project.
- `SESSION_SECRET` — secret untuk JWT, rekening terenkripsi, dan bentuk sesi Baileys.
- `ADMIN_EMAIL` dan `ADMIN_PASSWORD` — kredensial bootstrap admin; sandi minimal 12 karakter.
- Tidak ada data demo yang dibuat otomatis. Untuk lokal, API dan Drizzle membaca `.env` di root workspace; di Replit, `DATABASE_URL` berasal dari database terkelola dan kredensial admin disimpan di Secrets.

---

## 13. Acceptance Criteria

### 13.1 Customer Functional Acceptance

- Customer dapat mendaftar dan login.
- Customer dapat menautkan dan melihat sesi WhatsApp.
- Customer dapat memilih campaign dan menjalankan blast jika session online.
- Customer dapat memfilter dan mengunduh hasil campaign.
- Customer dapat melihat saldo, referral, dan riwayat transaksi.
- Customer dapat mengajukan withdrawal dengan saldo yang valid.

### 13.2 Admin Functional Acceptance

- Admin dapat membuat dan mengaktifkan campaign.
- Admin dapat mengimpor contact yang valid dan menolak data yang tidak valid.
- Admin dapat melihat semua customer dan sesi WA.
- Admin dapat memblokir customer dan memutus sesi.
- Admin dapat mengatur semua parameter sistem.
- Admin dapat memproses withdrawal dengan status yang konsisten.

### 13.3 Safety Acceptance

- Tidak ada pengiriman ke nomor tanpa consent.
- Tidak ada data placeholder dan no seed contact yang masuk ke queue blasting.
- Duplicate contact tidak diproses ganda pada campaign yang sama.
- Worker tidak mengambil kontak yang sama dari dua session concurrently.

### 13.4 System Acceptance

- Progres blast muncul secara real-time.
- Socket.IO merespons perubahan status dalam waktu nyata.
- Database transaksi untuk wallet dan withdrawal konsisten.
- Job dapat dibatalkan dengan status yang benar.

---

## 14. Risiko, Batasan, dan Catatan Implementasi

### 14.1 Risiko Utama

- Validasi consent yang salah dapat menimbulkan masalah legal dan reputasi.
- Overlap pengiriman antar session dapat menyebabkan duplicate send.
- Sesi WhatsApp offline dapat menghentikan atau membatasi pengiriman.
- Data saldo dan withdrawal harus dijaga konsistensinya agar tidak terjadi kesalahan pembayaran.

### 14.2 Batasan

- Produk menuntut lingkungan backend dan database yang stabil.
- Fungsionalitas WhatsApp bergantung pada koneksi perangkat dan status online channel.
- Pengiriman massal harus dibatasi sesuai kebijakan, rate, dan konsent dari admin.

### 14.3 Asumsi

- Semua customer dan admin memiliki akses internet, serta memiliki akun WhatsApp yang valid.
- Database PostgreSQL tersedia dan dikelola dengan backup otomatis.
- Admin memantau dan mengelola campaign serta rate-limiter secara berkala.

---

## 15. Kesimpulan

Titipkirim adalah sistem manajemen kampanye WhatsApp yang menggabungkan aspek bisnis, keamanan, operasi, dan monitoring dalam satu platform. Produk ini tidak hanya berfokus pada blast massal, tetapi juga pada integritas data, kepatuhan consent, akuntabilitas saldo, dan kontrol admin yang ketat.

Dengan pendekatan consent-first, session-level parallelism, real-time monitoring, dan arsitektur API berbasis PostgreSQL, sistem ini dirancang agar aman digunakan dalam skenario bisnis WhatsApp marketing yang terukur dan terkontrol.

---

## 16. Lampiran: Ringkasan Menu Aplikasi

Halaman yang tersedia:

- `/`
- `/login`
- `/register`
- `/whatsapp`
- `/blast`
- `/results`
- `/wallet`
- `/referrals`
- `/withdrawals`
- `/campaigns`
- `/contacts`
- `/customers`
- `/admin/sessions`
- `/settings`

Menu diatur menurut peran, dengan otorisasi yang juga diterapkan di server.

---

## 17. Riwayat Versi

- Versi 1.0 — PRD awal berdasarkan dokumentasi produk dan spesifikasi sistem Titipkirim.
