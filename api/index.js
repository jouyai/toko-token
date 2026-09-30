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
    if (process.env.AUTO_MIGRATE !== "false") await migrate({ log: () => {} });
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
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Server belum siap. Cek konfigurasi environment variable." }));
  }
  return app(req, res);
}
