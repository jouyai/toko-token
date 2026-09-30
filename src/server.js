import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertProductionConfig, config } from "./config.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { csrfGuard, loadUser } from "./auth.js";
import { HttpError } from "./lib/http.js";
import authRoutes from "./routes/auth.js";
import accountRoutes from "./routes/account.js";
import adminRoutes from "./routes/admin.js";
import publicRoutes from "./routes/public.js";
import proxy from "./proxy/openai.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    next();
  });

  app.get("/healthz", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // API untuk pembeli (format OpenAI), dilayani dari domain yang sama: https://domain/v1
  app.use("/v1", proxy);

  // API untuk website/dashboard
  const api = express.Router();
  api.use(express.json({ limit: "100kb" }));
  api.use(cookieParser());
  api.use(publicRoutes); // termasuk webhook Midtrans (tanpa CSRF & tanpa sesi)
  api.use(csrfGuard);
  api.use(loadUser);
  api.use("/auth", authRoutes);
  api.use("/account", accountRoutes);
  api.use("/admin", adminRoutes);
  api.use((_req, _res, next) => next(new HttpError(404, "Tidak ditemukan")));
  api.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Body bukan JSON yang valid" });
    const status = err.status || 500;
    if (status >= 500) console.error("[api]", err);
    res.status(status).json({ error: status >= 500 ? "Terjadi kesalahan di server" : err.message });
  });
  app.use("/api", api);

  // Halaman website
  app.use((_req, res, next) => {
    res.set("Content-Security-Policy", CSP);
    next();
  });
  app.use(express.static(publicDir, { extensions: ["html"], index: "index.html", maxAge: config.isProd ? "1h" : 0 }));
  app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, "404.html")));
  return app;
}

async function main() {
  assertProductionConfig();
  if (process.env.AUTO_MIGRATE !== "false") await migrate();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`${config.appName} jalan di port ${config.port} (${config.isProd ? "production" : "development"})`);
    console.log(`9router: ${config.router.baseUrl} · pembayaran: ${config.payment.provider}`);
  });
  // Stream LLM bisa lama; jangan diputus oleh timeout bawaan Node.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000;

  const shutdown = (sig) => {
    console.log(`${sig} diterima, menutup server...`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 30_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
