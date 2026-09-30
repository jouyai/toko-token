# Toko Token

Landing page + kalkulator untuk jualan token AI model secara prabayar ("isi token AI kayak isi token listrik").

Konsep desain: meteran token dengan LCD 7-segmen, papan harga split-flap, dan struk kasir yang "tercetak" waktu checkout.

## Jalankan

Website statis, tanpa build step. Buka `index.html` langsung, atau:

```bash
npx serve .
```

## Ubah harga & model

Semua ada di `config.js`: daftar model, harga input/output per 1M token (Rupiah), nominal keypad, dan `apiBaseUrl`.

## Yang masih demo

Frontend ini belum terhubung ke backend. Untuk jualan beneran kamu masih butuh:

- **Payment gateway** (QRIS): mis. Midtrans / Xendit / Tripay. QR dan kode token di struk sekarang masih acak.
- **API gateway + metering** yang memotong saldo per token: mis. LiteLLM Proxy atau One API, di depan API key provider (Anthropic, dsb).
- **Akun & dashboard** untuk melihat saldo dan API key.
