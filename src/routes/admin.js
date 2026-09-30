import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { one, query, tx } from "../db.js";
import { requireAdmin } from "../auth.js";
import { HttpError, parse } from "../lib/http.js";
import { rpToMilli } from "../lib/money.js";
import { listUpstreamModels } from "../proxy/router-client.js";
import { invalidateModelCache } from "../proxy/openai.js";

const r = Router();
r.use(requireAdmin);

r.get("/stats", async (_req, res) => {
  const s = await one(`
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT coalesce(sum(amount_rp), 0)::bigint FROM payments WHERE status = 'paid') AS revenue_rp,
      (SELECT coalesce(sum(amount_rp), 0)::bigint FROM payments WHERE status = 'paid' AND paid_at > now() - interval '30 days') AS revenue_30d_rp,
      (SELECT coalesce(sum(balance_milli), 0)::bigint FROM users) AS outstanding_milli,
      (SELECT coalesce(sum(cost_milli), 0)::bigint FROM usage_logs WHERE created_at > now() - interval '24 hours') AS usage_24h_milli,
      (SELECT coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint FROM usage_logs WHERE created_at > now() - interval '24 hours') AS tokens_24h,
      (SELECT count(*)::int FROM usage_logs WHERE created_at > now() - interval '24 hours') AS requests_24h,
      (SELECT count(*)::int FROM usage_logs WHERE created_at > now() - interval '24 hours' AND status >= 400) AS errors_24h
  `);
  const { rows: byModel } = await query(`
    SELECT model_id, count(*)::int AS requests, sum(prompt_tokens + completion_tokens)::bigint AS tokens,
           sum(cost_milli)::bigint AS cost_milli
      FROM usage_logs WHERE created_at > now() - interval '7 days'
     GROUP BY 1 ORDER BY cost_milli DESC`);
  res.json({ stats: s, byModel });
});

// ---------- Users ----------
r.get("/users", async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const { rows } = await query(
    `SELECT id, email, name, role, status, balance_milli, created_at,
            (SELECT max(created_at) FROM usage_logs WHERE user_id = users.id) AS last_used_at
       FROM users
      WHERE ($1 = '' OR lower(email) LIKE '%' || $1 || '%' OR lower(name) LIKE '%' || $1 || '%')
      ORDER BY created_at DESC LIMIT 100`,
    [q]
  );
  res.json({ users: rows });
});

r.post("/users/:id/adjust", async (req, res) => {
  const body = parse(z.object({
    amount_rp: z.coerce.number().refine((n) => n !== 0 && Number.isFinite(n), "Nominal tidak boleh 0"),
    note: z.string().trim().min(3, "Catatan wajib diisi (min. 3 huruf)").max(200),
  }), req.body);
  const milli = rpToMilli(body.amount_rp);
  const out = await tx(async (c) => {
    const u = await c.query(
      "UPDATE users SET balance_milli = balance_milli + $2 WHERE id = $1 RETURNING balance_milli",
      [Number(req.params.id), milli]
    );
    if (!u.rows[0]) throw new HttpError(404, "User tidak ditemukan");
    await c.query(
      `INSERT INTO ledger (user_id, kind, amount_milli, balance_after_milli, note, actor_id)
       VALUES ($1, 'adjustment', $2, $3, $4, $5)`,
      [Number(req.params.id), milli, u.rows[0].balance_milli, body.note, req.user.id]
    );
    return u.rows[0];
  });
  res.json({ balance_milli: out.balance_milli });
});

r.post("/users/:id/status", async (req, res) => {
  const body = parse(z.object({ status: z.enum(["active", "suspended"]) }), req.body);
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, "Tidak bisa mengubah status akun sendiri");
  const u = await one("UPDATE users SET status = $2 WHERE id = $1 RETURNING id", [Number(req.params.id), body.status]);
  if (!u) throw new HttpError(404, "User tidak ditemukan");
  if (body.status === "suspended") await query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
  res.json({ ok: true });
});

// ---------- Models ----------
const modelSchema = z.object({
  id: z.string().trim().regex(/^[a-zA-Z0-9._:\/-]{1,80}$/, "ID model hanya boleh huruf, angka, . _ : / -"),
  upstream_model: z.string().trim().min(1, "Model 9router wajib diisi").max(200),
  display_name: z.string().trim().min(1).max(80),
  vendor: z.string().trim().max(40).default(""),
  context_label: z.string().trim().max(20).default(""),
  input_price_rp: z.coerce.number().int().min(0),
  output_price_rp: z.coerce.number().int().min(0),
  tag: z.string().trim().max(20).default(""),
  active: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(100),
});

r.get("/models", async (_req, res) => {
  const { rows } = await query("SELECT * FROM models ORDER BY sort_order, display_name");
  res.json({ models: rows });
});

r.put("/models/:id", async (req, res) => {
  const m = parse(modelSchema, { ...req.body, id: req.params.id });
  const row = await one(
    `INSERT INTO models (id, upstream_model, display_name, vendor, context_label, input_price_rp, output_price_rp, tag, active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       upstream_model = EXCLUDED.upstream_model, display_name = EXCLUDED.display_name, vendor = EXCLUDED.vendor,
       context_label = EXCLUDED.context_label, input_price_rp = EXCLUDED.input_price_rp,
       output_price_rp = EXCLUDED.output_price_rp, tag = EXCLUDED.tag, active = EXCLUDED.active,
       sort_order = EXCLUDED.sort_order, updated_at = now()
     RETURNING *`,
    [m.id, m.upstream_model, m.display_name, m.vendor, m.context_label, m.input_price_rp, m.output_price_rp, m.tag, m.active, m.sort_order]
  );
  invalidateModelCache();
  res.json({ model: row });
});

r.delete("/models/:id", async (req, res) => {
  // Model tidak dihapus permanen supaya riwayat pemakaian tetap terbaca; cukup dinonaktifkan.
  const row = await one("UPDATE models SET active = false, updated_at = now() WHERE id = $1 RETURNING id", [req.params.id]);
  if (!row) throw new HttpError(404, "Model tidak ditemukan");
  invalidateModelCache();
  res.json({ ok: true });
});

// Nama publik tanpa prefix router/provider, mis. "cc/claude-sonnet-4.5" -> "claude-sonnet-4.5".
export function publicIdFor(upstream) {
  return (
    String(upstream).split("/").pop().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "model"
  );
}
const prettyName = (id) =>
  id.split(/[-_]/).filter(Boolean).map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");

// Impor semua model 9router yang belum dijual, dengan harga default.
r.post("/models/import", async (req, res) => {
  const body = parse(z.object({
    input_price_rp: z.coerce.number().int().min(1, "Harga input minimal Rp1"),
    output_price_rp: z.coerce.number().int().min(1, "Harga output minimal Rp1"),
    active: z.boolean().default(false),
    only: z.array(z.string()).optional(),
  }), req.body);
  let upstream;
  try {
    upstream = await listUpstreamModels();
  } catch (err) {
    throw new HttpError(502, `Tidak bisa menghubungi 9router: ${err.message}`);
  }
  if (body.only) upstream = upstream.filter((u) => body.only.includes(u));
  const { rows } = await query("SELECT id, upstream_model FROM models");
  const mapped = new Set(rows.map((r) => r.upstream_model));
  const taken = new Set(rows.map((r) => r.id));
  const added = [];
  for (const up of upstream) {
    if (mapped.has(up)) continue;
    let id = publicIdFor(up);
    for (let n = 2; taken.has(id); n++) id = `${publicIdFor(up)}-${n}`;
    taken.add(id);
    await query(
      `INSERT INTO models (id, upstream_model, display_name, input_price_rp, output_price_rp, active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, 500)`,
      [id, up, prettyName(id), body.input_price_rp, body.output_price_rp, body.active]
    );
    added.push({ id, upstream_model: up });
  }
  invalidateModelCache();
  res.json({ added, skipped: upstream.length - added.length });
});

// Daftar model yang tersedia di 9router, untuk memudahkan mapping.
r.get("/upstream-models", async (_req, res) => {
  try {
    res.json({ models: await listUpstreamModels(), routerBaseUrl: config.router.baseUrl });
  } catch (err) {
    throw new HttpError(502, `Tidak bisa menghubungi 9router di ${config.router.baseUrl}: ${err.message}`);
  }
});

// ---------- Payments ----------
r.get("/payments", async (_req, res) => {
  const { rows } = await query(
    `SELECT p.order_id, p.amount_rp, p.status, p.method, p.provider, p.created_at, p.paid_at, u.email
       FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 100`
  );
  res.json({ payments: rows });
});

export default r;
