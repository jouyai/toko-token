import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { one, query } from "../db.js";
import { requireUser } from "../auth.js";
import { newApiKey } from "../lib/crypto.js";
import { HttpError, parse } from "../lib/http.js";
import { RateLimiter } from "../lib/ratelimit.js";
import * as payments from "../payments/index.js";

const r = Router();
r.use(requireUser);

// ---------- API keys ----------
r.get("/keys", async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, prefix, created_at, last_used_at FROM api_keys
      WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ keys: rows });
});

r.post("/keys", async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(1, "Nama key wajib diisi").max(60) }), req.body);
  const { n } = await one("SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL", [req.user.id]);
  if (n >= 20) throw new HttpError(400, "Maksimal 20 API key aktif. Hapus yang tidak dipakai dulu.");
  const k = newApiKey();
  const row = await one(
    "INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, prefix, created_at",
    [req.user.id, body.name, k.prefix, k.hash]
  );
  // Key lengkap hanya dikirim sekali ini.
  res.status(201).json({ key: { ...row, secret: k.key } });
});

r.delete("/keys/:id", async (req, res) => {
  const row = await one(
    "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id",
    [Number(req.params.id) || 0, req.user.id]
  );
  if (!row) throw new HttpError(404, "API key tidak ditemukan");
  res.json({ ok: true });
});

// ---------- Pemakaian ----------
r.get("/usage", async (req, res) => {
  const [recent, daily] = await Promise.all([
    query(
      `SELECT u.created_at, u.model_id, u.prompt_tokens, u.completion_tokens, u.cost_milli, u.estimated,
              u.status, u.stream, u.latency_ms, k.name AS key_name
         FROM usage_logs u LEFT JOIN api_keys k ON k.id = u.api_key_id
        WHERE u.user_id = $1 ORDER BY u.created_at DESC LIMIT 100`,
      [req.user.id]
    ),
    query(
      `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS day,
              sum(prompt_tokens + completion_tokens)::bigint AS tokens,
              sum(cost_milli)::bigint AS cost_milli, count(*)::int AS requests
         FROM usage_logs
        WHERE user_id = $1 AND created_at > now() - interval '30 days'
        GROUP BY 1 ORDER BY 1`,
      [req.user.id]
    ),
  ]);
  res.json({ recent: recent.rows, daily: daily.rows });
});

r.get("/ledger", async (req, res) => {
  const { rows } = await query(
    `SELECT created_at, kind, amount_milli, balance_after_milli, ref, note
       FROM ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json({ ledger: rows });
});

// ---------- Top up ----------
const topupLimiter = new RateLimiter({ limit: 10, windowMs: 10 * 60_000 });

r.get("/payments", async (req, res) => {
  const { rows } = await query(
    `SELECT order_id, amount_rp, status, method, redirect_url, created_at, paid_at
       FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({ payments: rows });
});

r.post("/topup", async (req, res) => {
  const { minTopupRp, maxTopupRp } = config.billing;
  const body = parse(z.object({
    amount: z.coerce.number().int("Nominal harus bilangan bulat")
      .min(minTopupRp, `Minimal top up Rp${minTopupRp.toLocaleString("id-ID")}`)
      .max(maxTopupRp, `Maksimal top up Rp${maxTopupRp.toLocaleString("id-ID")}`),
  }), req.body);
  if (!topupLimiter.take(`u${req.user.id}`).ok) throw new HttpError(429, "Terlalu banyak permintaan top up. Coba lagi nanti.");
  try {
    const out = await payments.startTopup(req.user, body.amount);
    res.status(201).json(out);
  } catch (err) {
    console.error("[topup]", err.message);
    throw new HttpError(502, "Gagal membuat pembayaran. Coba lagi sebentar lagi.");
  }
});

r.get("/payments/:orderId", async (req, res) => {
  let p = await one("SELECT * FROM payments WHERE order_id = $1 AND user_id = $2", [req.params.orderId, req.user.id]);
  if (!p) throw new HttpError(404, "Order tidak ditemukan");
  p = await payments.syncOrder(p);
  const u = await one("SELECT balance_milli FROM users WHERE id = $1", [req.user.id]);
  res.json({
    payment: { order_id: p.order_id, amount_rp: p.amount_rp, status: p.status, method: p.method, created_at: p.created_at, paid_at: p.paid_at, redirect_url: p.redirect_url },
    balance_milli: u.balance_milli,
  });
});

// Hanya untuk development: tandai order mock sebagai lunas.
r.post("/payments/:orderId/mock-pay", async (req, res) => {
  if (config.isProd || config.payment.provider !== "mock") throw new HttpError(404, "Tidak ditemukan");
  const p = await one("SELECT * FROM payments WHERE order_id = $1 AND user_id = $2", [req.params.orderId, req.user.id]);
  if (!p) throw new HttpError(404, "Order tidak ditemukan");
  await payments.applyStatus(p.order_id, { status: "paid", grossAmount: p.amount_rp, method: "mock" });
  res.json({ ok: true });
});

export default r;
