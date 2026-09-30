// Semua konfigurasi dibaca dari environment variable. Lihat .env.example.
const env = process.env;

const int = (v, d) => (v === undefined || v === "" ? d : Number.parseInt(v, 10));
const bool = (v, d = false) => (v === undefined || v === "" ? d : ["1", "true", "yes"].includes(v.toLowerCase()));
const list = (v, d) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);

const isProd = env.NODE_ENV === "production";

export const config = {
  isProd,
  port: int(env.PORT, 3000),
  // Di Vercel, kalau APP_URL kosong dipakai domain production project-nya.
  appUrl: (env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, ""),
  appName: env.APP_NAME || "Toko Token",
  trustProxy: int(env.TRUST_PROXY, 1),
  // Integrasi Neon/Vercel Postgres bisa memberi nama variable berbeda.
  databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || env.DATABASE_URL_UNPOOLED || "postgres://toko:toko@localhost:5432/toko",

  // ---- 9router ----
  router: {
    baseUrl: (env.ROUTER_BASE_URL || "http://localhost:20128/v1").replace(/\/$/, ""),
    apiKey: env.ROUTER_API_KEY || "",
    timeoutMs: int(env.ROUTER_TIMEOUT_MS, 600_000),
  },

  // ---- Penagihan ----
  billing: {
    minTopupRp: int(env.MIN_TOPUP_RP, 10_000),
    maxTopupRp: int(env.MAX_TOPUP_RP, 5_000_000),
    topupPresetsRp: list(env.TOPUP_PRESETS_RP, ["10000", "25000", "50000", "100000", "250000", "500000"]).map(Number),
    // Batas output kalau user tidak kirim max_tokens dan saldonya pas-pasan.
    defaultMaxOutputTokens: int(env.DEFAULT_MAX_OUTPUT_TOKENS, 8192),
  },

  // ---- Pembayaran ----
  payment: {
    provider: env.PAYMENT_PROVIDER || (isProd ? "midtrans" : "mock"),
    midtrans: {
      serverKey: env.MIDTRANS_SERVER_KEY || "",
      isProduction: bool(env.MIDTRANS_IS_PRODUCTION),
      enabledPayments: list(env.MIDTRANS_ENABLED_PAYMENTS, ["other_qris", "gopay", "shopeepay", "bca_va", "bni_va", "bri_va", "permata_va", "other_va"]),
      // Bisa di-override untuk testing.
      snapUrl: env.MIDTRANS_SNAP_URL || "",
      apiUrl: env.MIDTRANS_API_URL || "",
    },
  },

  // ---- Batas pemakaian ----
  limits: {
    apiRpmPerKey: int(env.API_RPM_PER_KEY, 60),
    maxConcurrentPerUser: int(env.MAX_CONCURRENT_PER_USER, 4),
    authPerMinutePerIp: int(env.AUTH_PER_MINUTE_PER_IP, 10),
    maxBodyMb: int(env.MAX_BODY_MB, 20),
  },

  // Kunci untuk menyamarkan id tool call. Default: turunan dari ROUTER_API_KEY.
  idSecret: env.ID_SECRET || env.ROUTER_API_KEY || "",

  session: {
    cookieName: "tt_sess",
    ttlDays: int(env.SESSION_TTL_DAYS, 30),
  },

  mail: {
    smtpUrl: env.SMTP_URL || "",
    from: env.MAIL_FROM || "Toko Token <no-reply@localhost>",
  },

  support: {
    email: env.SUPPORT_EMAIL || "",
    whatsapp: env.SUPPORT_WHATSAPP || "",
  },
};

// Daftar masalah konfigurasi production (hanya nama variable, tanpa nilai rahasia).
export function configProblems() {
  if (!isProd) return [];
  const problems = [];
  if (!env.DATABASE_URL && !env.POSTGRES_URL && !env.DATABASE_URL_UNPOOLED) problems.push("DATABASE_URL wajib diisi (connection string Postgres, mis. dari Neon)");
  if (!config.appUrl.startsWith("https://")) problems.push("APP_URL harus diisi dengan https://domain-kamu");
  if (!env.ROUTER_BASE_URL) problems.push("ROUTER_BASE_URL wajib diisi (alamat publik 9router, diakhiri /v1)");
  else if (/localhost|127\.0\.0\.1/.test(config.router.baseUrl) && env.VERCEL) problems.push("ROUTER_BASE_URL tidak boleh localhost di Vercel; 9router harus bisa diakses dari internet");
  if (!config.router.apiKey) problems.push("ROUTER_API_KEY wajib diisi (aktifkan REQUIRE_API_KEY=true di 9router)");
  if (config.payment.provider === "mock") problems.push("PAYMENT_PROVIDER=mock tidak boleh dipakai di production");
  if (config.payment.provider === "midtrans" && !config.payment.midtrans.serverKey) problems.push("MIDTRANS_SERVER_KEY wajib diisi");
  if (!config.mail.smtpUrl) problems.push("SMTP_URL wajib diisi (untuk reset password)");
  return problems;
}

export function assertProductionConfig() {
  const problems = configProblems();
  if (problems.length) {
    const err = new Error("Konfigurasi production belum lengkap:\n - " + problems.join("\n - "));
    err.problems = problems;
    throw err;
  }
}
