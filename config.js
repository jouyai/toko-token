// ============================================================
//  KONFIGURASI TOKO — ubah harga & daftar model di sini aja.
//  Harga dalam Rupiah per 1 juta (1M) token.
// ============================================================
window.TOKO_CONFIG = {
  apiBaseUrl: "https://api.tokotoken.id/v1", // ganti dengan domain API kamu
  minNominal: 5000,
  nominals: [5000, 10000, 25000, 50000, 100000, 250000],

  models: [
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", vendor: "Anthropic", ctx: "200K", input: 45000, output: 225000, tag: "Populer" },
    { id: "claude-haiku-4-5",  name: "Claude Haiku 4.5",  vendor: "Anthropic", ctx: "200K", input: 15000, output: 75000,  tag: "Cepat" },
    { id: "deepseek-v3",       name: "DeepSeek V3",       vendor: "DeepSeek",  ctx: "128K", input: 5000,  output: 18000,  tag: "Hemat" },
    { id: "qwen-2.5-72b",      name: "Qwen 2.5 72B",      vendor: "Alibaba",   ctx: "128K", input: 6000,  output: 12000,  tag: "" },
    { id: "llama-3.3-70b",     name: "Llama 3.3 70B",     vendor: "Meta",      ctx: "128K", input: 7000,  output: 12000,  tag: "Open" },
  ],
};
