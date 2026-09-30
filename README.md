# Toko Token

Toko token AI prabayar: pembeli top up saldo Rupiah lewat QRIS, lalu memakai model AI lewat API yang kompatibel OpenAI. Saldo dipotong per request sesuai token yang benar-benar terpakai. Di belakangnya, semua request diteruskan ke **9router** milikmu.

```
Pembeli (SDK OpenAI)                           Kamu
        │  https://domain/v1  (API key tt_live_…)   │  /admin: model, harga, user
        ▼                                            ▼
┌──────────────────────── app (Node.js) ─────────────────────────┐
│  cek API key & saldo → ganti nama model → teruskan → hitung     │
│  token dari `usage` → potong saldo → catat pemakaian            │
└───────┬───────────────────────────────┬────────────────────────┘
        │ Bearer ROUTER_API_KEY          │
        ▼                                ▼
   9router :20128  ──► provider AI     Postgres        Midtrans (QRIS, e-wallet, VA)
```

## Fitur

- **Akun:** daftar, masuk, lupa/reset password lewat email, ganti password. Password di-hash (scrypt), sesi disimpan di cookie HttpOnly.
- **Saldo:** disimpan dalam milli-rupiah, jadi potongan pecahan Rupiah per token tetap akurat. Semua mutasi tercatat (ledger dan log pemakaian).
- **Top up:** lewat Midtrans Snap (QRIS, GoPay, ShopeePay, Virtual Account).
  - Webhook diverifikasi dengan signature, lalu statusnya dicek ulang langsung ke API Midtrans.
  - Saldo hanya bertambah sekali per order, walau notifikasi dikirim berkali-kali.
- **API `/v1`** kompatibel OpenAI: `POST /v1/chat/completions` (biasa dan streaming) serta `GET /v1/models`.
  - Nama model publik dipetakan ke model atau combo 9router, jadi nama provider tidak bocor ke pembeli.
  - Penagihan pakai `usage` dari 9router. Kalau `usage` tidak ada, dipakai estimasi dan request ditandai "≈".
  - Request yang error tidak ditagih.
  - `max_tokens` otomatis dibatasi sesuai sisa saldo, supaya saldo tidak jebol ke minus.
  - Ada batas request per menit per key dan batas request bersamaan per user.
- **Dashboard pembeli:** saldo di layar LCD, top up, API key (ditampilkan sekali saja), grafik pemakaian 30 hari, riwayat request, dan struk pembayaran.
- **Panel admin (`/admin`):**
  - Ringkasan pendapatan dan pemakaian.
  - Pengaturan model dan harga, dengan daftar model langsung dari 9router dan peringatan kalau mapping salah.
  - Kelola user: koreksi saldo dan suspend akun.
  - Daftar pembayaran.
- **Keamanan:** CSP ketat, proteksi CSRF, rate limit untuk login, cek konfigurasi wajib saat start di production, dan dashboard 9router yang tidak dibuka ke internet.

## Deploy ke VPS (Docker)

Kebutuhan: VPS Linux (minimal 1 vCPU / 1–2 GB RAM), Docker + Docker Compose, dan domain yang DNS-nya sudah mengarah ke IP VPS.

```bash
git clone https://github.com/jouyai/toko-token.git && cd toko-token
cp .env.example .env
nano .env            # isi DOMAIN, APP_URL, POSTGRES_PASSWORD, ROUTER_DASHBOARD_PASSWORD, dst.
docker compose up -d --build
```

### 1. Konfigurasi 9router

9router ikut jalan di `docker-compose.yml` dengan `REQUIRE_API_KEY=true`. Dashboard-nya **hanya** bisa dibuka dari server itu sendiri. Dari laptop, buka lewat SSH tunnel:

```bash
ssh -L 20128:127.0.0.1:20128 user@ip-server
# lalu buka http://localhost:20128/dashboard (password = ROUTER_DASHBOARD_PASSWORD)
```

Di dashboard 9router:
1. Sambungkan provider (pakai **API key** provider; lihat catatan penting di bawah).
2. Kalau mau, buat *combo* untuk fallback antar-provider.
3. Buka menu API Keys, buat satu key untuk toko ini, lalu isi ke `ROUTER_API_KEY` di `.env`.
4. Terapkan perubahan dengan `docker compose up -d app`.

Kalau 9router sudah jalan di server lain, hapus service `9router` dari `docker-compose.yml`, lalu isi `ROUTER_BASE_URL=https://alamat-9router/v1` di `.env`.

### 2. Jadikan akunmu admin & atur model

1. Daftar lewat website (`https://domainmu/daftar`).
2. Jadikan akunmu admin:
   ```bash
   docker compose exec app npm run admin -- promote emailkamu@contoh.com
   ```
3. Buka `https://domainmu/admin` → **Model & Harga**.
   - Kolom "Model di 9router" punya dropdown berisi model dan combo yang benar-benar tersedia di 9router kamu.
   - **ID publik** adalah nama yang dipakai pembeli di parameter `model`.
   - Harga diisi dalam Rupiah per 1 juta token, terpisah untuk input dan output.
   - **Impor dari 9router:** tombol ini menambahkan sekaligus semua model 9router yang belum dijual, dengan harga default. Nama publiknya otomatis tanpa prefix router/provider (`cc/claude-x` jadi `claude-x`). Model hasil impor nonaktif dulu sampai kamu cek harganya, kecuali kamu centang "Langsung aktifkan".
   - Opsional: `docker compose exec app npm run seed` mengisi 3 contoh model. Sesuaikan mapping-nya dengan 9router kamu.

### 3. Midtrans

1. Daftar di [dashboard.midtrans.com](https://dashboard.midtrans.com). Mulai dari mode **Sandbox**.
2. Buka Settings → Access Keys, salin **Server Key** ke `MIDTRANS_SERVER_KEY`.
3. Buka Settings → Payment → Notification URL, isi dengan:
   `https://domainmu/api/payments/midtrans/notify`
4. Tes top up di sandbox pakai [simulator Midtrans](https://simulator.sandbox.midtrans.com).
5. Setelah akun production disetujui, ganti Server Key production dan set `MIDTRANS_IS_PRODUCTION=true`.

Midtrans biasanya minta website punya halaman Syarat & Ketentuan, Kebijakan Privasi (termasuk refund), dan Kontak. Ketiganya sudah ada di `public/syarat.html`, `public/privasi.html`, dan `/kontak`. **Isi bagian `[NAMA USAHA]` dan `[TANGGAL]`, lalu tinjau isinya.**

### 4. Email

Isi `SMTP_URL`, misalnya Brevo, Mailgun, Zoho, atau Gmail App Password. Tanpa email, user tidak bisa reset password, dan aplikasi menolak start di production.

## Pembeli hanya melihat Toko Token

Setiap respons API dibersihkan sebelum dikirim ke pembeli:

- `id` respons diganti dengan id buatan kita, dan `model` diganti dengan nama publik.
- Field non-standar dari provider/router dibuang, misalnya `provider`, `system_fingerprint`, dan detail usage khusus provider.
- ID tool call dari provider (misalnya `toolu_…`) dienkripsi jadi `call_tt…`. ID ini otomatis dikembalikan ke bentuk aslinya waktu pembeli mengirim hasil tool.
- Pesan error dari provider tidak pernah diteruskan. Pembeli hanya menerima pesan umum, dan detail aslinya dicatat di log server.
- Komentar SSE dari upstream dibuang dari stream.

Di website, nama router dan payment gateway tidak disebut di halaman promosi. Nama payment gateway tetap tercantum di halaman Privasi dan Syarat, karena UU PDP mewajibkan pihak pemroses data disebutkan.

## API key per user

Setiap akun membuat API key sendiri di dashboard. Satu akun boleh punya banyak key, misalnya satu per aplikasi. Key hanya ditampilkan sekali saat dibuat, dan di database hanya disimpan hash-nya. Pembeli bisa:

```bash
curl https://domainmu/v1/models -H "Authorization: Bearer tt_live_..."             # daftar model
curl https://domainmu/v1/chat/completions -H "Authorization: Bearer tt_live_..." ...  # pakai model
```

Semua key milik satu akun memotong saldo akun itu. Kalau key bocor, pembeli cukup menghapusnya di dashboard, dan key itu langsung berhenti bekerja.

## Menentukan harga

Rumus biaya yang dipotong dari pembeli:

```
biaya = token_input × harga_input/1.000.000 + token_output × harga_output/1.000.000
```

Supaya untung, set harga jual di atas biaya asli provider (kurs Rupiah + fee Midtrans ±0,7% untuk QRIS). Contoh: kalau provider menagih $0,50/1M token input dan kurs Rp16.500, modalnya Rp8.250/1M. Harga jual Rp10.000–12.000/1M memberi margin yang aman.

Menu **Ringkasan** di admin menunjukkan "Saldo user (utang layanan)": saldo yang sudah dibayar pembeli tapi belum terpakai. Pastikan saldo/kuota di provider cukup untuk menutupinya.

## ⚠️ Penting: provider yang dipakai di 9router

9router bisa menyambungkan akun **langganan pribadi** lewat OAuth, seperti Claude Code/Claude Pro, ChatGPT/Codex, GitHub Copilot, dan Cursor. Syarat layanan provider-provider itu **melarang** akun langganan dijual kembali atau dibagikan ke orang lain. Akun bisa diblokir, dan pembelimu ikut kena.

Untuk jualan, pakai provider berbasis **API key** yang memang mengizinkan pemakaian komersial, misalnya Anthropic API, OpenAI API, OpenRouter, DeepSeek, GLM, Kimi, atau Gemini API. Cek juga ketentuan masing-masing soal *reselling*.

## Operasional

| Kebutuhan | Perintah |
|---|---|
| Lihat log | `docker compose logs -f app` |
| Tambah saldo manual | `docker compose exec app npm run admin -- credit email@x.com 50000 "bonus"` |
| Backup database | `docker compose exec db pg_dump -U toko toko > backup-$(date +%F).sql` |
| Update aplikasi | `git pull && docker compose up -d --build app` |
| Update 9router | `docker compose pull 9router && docker compose up -d 9router` |

Backup juga volume `router-data`, karena di situ tersimpan koneksi provider dan combo 9router.

Rate limit disimpan di memori, jadi aplikasi ini dirancang untuk **satu instance** app. Itu cukup untuk ribuan user. Kalau nanti perlu lebih dari satu instance, pindahkan rate limit ke Redis.

## Pengembangan lokal

```bash
npm install
# Postgres lokal, 9router lokal (npx 9router) atau server tiruan
export DATABASE_URL=postgres://user:pass@localhost:5432/toko
export ROUTER_BASE_URL=http://localhost:20128/v1 ROUTER_API_KEY=...
npm run seed     # migrasi + contoh model
npm run dev      # http://localhost:3000
```

Di luar production, `PAYMENT_PROVIDER` default-nya `mock`. Top up bisa "dibayar" lewat tombol simulasi di struk.

Tes (butuh Postgres; database tes dikosongkan tiap kali jalan):

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/toko_test npm test
```

## Struktur

```
src/server.js          bootstrap Express, security header, static files
src/proxy/             /v1 (proxy ke 9router, metering, SSE)
src/routes/            API website: auth, account, admin, public (+ webhook Midtrans)
src/payments/          Midtrans Snap & logika kredit saldo
migrations/            skema database
public/                landing, dashboard, admin, halaman legal
scripts/               CLI admin & seed model
test/                  tes integrasi (9router & Midtrans tiruan)
```
