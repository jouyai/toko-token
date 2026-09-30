// Entry point untuk Vercel: seluruh /api, /v1, dan /healthz dilayani oleh app Express ini
// (lihat rewrites di vercel.json). File statis di public/ dilayani langsung oleh CDN Vercel.
import { assertProductionConfig } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/server.js";

const app = createApp();

// Dijalankan sekali per instance saat cold start.
let ready;
const init = () =>
  (ready ??= (async () => {
    assertProductionConfig();
    try {
      if (process.env.AUTO_MIGRATE !== "false") await migrate({ log: () => {} });
    } catch (err) {
      const e = new Error(`Database tidak bisa diakses atau migrasi gagal: ${err.code || ""} ${err.message}`.trim());
      e.problems = [`Database: ${err.code ? err.code + " — " : ""}${String(err.message).slice(0, 160)}`];
      throw e;
    }
  })().catch((err) => {
    ready = undefined; // coba lagi di request berikutnya
    throw err;
  }));

export default async function handler(req, res) {
  try {
    await init();
  } catch (err) {
    console.error("[init]", err.message);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    // Rincian (nama variable yang kurang, tanpa nilainya) hanya ditampilkan di /healthz.
    const body = req.url.startsWith("/healthz")
      ? { ok: false, error: "Konfigurasi belum lengkap", problems: err.problems || [err.message] }
      : { error: "Server belum siap. Buka /healthz untuk melihat penyebabnya." };
    return res.end(JSON.stringify(body, null, 2));
  }
  return app(req, res);
}
