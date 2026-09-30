import express, { Router } from "express";
import { config } from "../config.js";
import { one, query, tx } from "../db.js";
import { sha256 } from "../lib/crypto.js";
import { affordableOutputTokens, costMilli, estimateTokens } from "../lib/money.js";
import { RateLimiter } from "../lib/ratelimit.js";
import { chatCompletions } from "./router-client.js";
import { SseTransformer, outputCharsOf } from "./sse.js";
import { cleanCompletion, newCompletionId, publicErrorMessage, restoreToolIds } from "./sanitize.js";

const r = Router();

// Format error mengikuti OpenAI supaya SDK klien menampilkan pesan dengan benar.
const fail = (res, status, message, type = "invalid_request_error", code = null) =>
  res.status(status).json({ error: { message, type, code } });

const jsonBody = express.json({ limit: `${config.limits.maxBodyMb}mb` });

// ---------- Model (cache 30 detik) ----------
let modelCache = { at: 0, map: new Map() };
export function invalidateModelCache() {
  modelCache.at = 0;
}
async function getModels() {
  if (Date.now() - modelCache.at < 30_000) return modelCache.map;
  const { rows } = await query("SELECT * FROM models WHERE active ORDER BY sort_order, display_name");
  modelCache = { at: Date.now(), map: new Map(rows.map((m) => [m.id, m])) };
  return modelCache.map;
}

// ---------- Autentikasi API key ----------
const rpm = new RateLimiter({ limit: config.limits.apiRpmPerKey, windowMs: 60_000 });
const inFlight = new Map();

async function authKey(req, res, next) {
  const auth = req.get("authorization") || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : (req.get("x-api-key") || "").trim();
  if (!key) return fail(res, 401, "API key tidak ada. Kirim header 'Authorization: Bearer tt_live_...'", "authentication_error", "missing_api_key");
  const row = await one(
    `SELECT k.id AS key_id, u.id, u.status, u.balance_milli
       FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [sha256(key)]
  );
  if (!row) return fail(res, 401, "API key tidak valid atau sudah dihapus", "authentication_error", "invalid_api_key");
  if (row.status !== "active") return fail(res, 403, "Akun dinonaktifkan", "permission_error", "account_suspended");
  const rl = rpm.take(`k${row.key_id}`);
  if (!rl.ok) {
    res.set("Retry-After", String(rl.retryAfterSec));
    return fail(res, 429, `Batas ${config.limits.apiRpmPerKey} request/menit per key terlampaui`, "rate_limit_error", "rate_limit_exceeded");
  }
  req.account = row;
  next();
}

// ---------- Penagihan ----------
async function charge({ account, model, promptTokens, completionTokens, estimated, stream, status, latencyMs }) {
  const cost = status < 400 ? costMilli(model, promptTokens, completionTokens) : 0;
  return tx(async (c) => {
    const u = await c.query(
      "UPDATE users SET balance_milli = balance_milli - $2 WHERE id = $1 RETURNING balance_milli",
      [account.id, cost]
    );
    await c.query(
      `INSERT INTO usage_logs (user_id, api_key_id, model_id, upstream_model, prompt_tokens, completion_tokens,
                               cost_milli, estimated, stream, status, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [account.id, account.key_id, model.id, model.upstream_model, promptTokens, completionTokens,
       cost, estimated, stream, status, latencyMs]
    );
    await c.query(
      "UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
      [account.key_id]
    );
    return u.rows[0].balance_milli;
  });
}

// ---------- Endpoint ----------
r.get("/models", authKey, async (_req, res) => {
  const models = await getModels();
  res.json({
    object: "list",
    data: [...models.values()].map((m) => ({
      id: m.id, object: "model", created: Math.floor(new Date(m.created_at).getTime() / 1000), owned_by: m.vendor || "toko-token",
    })),
  });
});

r.post("/chat/completions", authKey, jsonBody, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || typeof body.model !== "string" || !Array.isArray(body.messages)) {
    return fail(res, 400, "Body harus JSON berisi 'model' dan 'messages'");
  }
  const model = (await getModels()).get(body.model);
  if (!model) return fail(res, 404, `Model '${body.model}' tidak tersedia. Lihat GET /v1/models`, "invalid_request_error", "model_not_found");

  const account = req.account;
  const estPrompt = estimateTokens(JSON.stringify(body.messages).length + JSON.stringify(body.tools || []).length);
  const inputCost = costMilli(model, estPrompt, 0);
  const affordable = affordableOutputTokens(model, account.balance_milli - inputCost);
  if (account.balance_milli <= 0 || account.balance_milli < inputCost || affordable < 16) {
    return fail(res, 402, "Saldo tidak cukup. Silakan top up di dashboard.", "insufficient_quota", "insufficient_balance");
  }

  // Batasi panjang output sesuai sisa saldo supaya saldo tidak jebol jauh ke minus.
  const upstreamBody = { ...body, model: model.upstream_model, messages: restoreToolIds(body.messages) };
  const field = body.max_completion_tokens != null ? "max_completion_tokens" : "max_tokens";
  const requested = body[field] ?? null;
  const limit = requested ?? config.billing.defaultMaxOutputTokens;
  if (affordable < limit) {
    upstreamBody[field] = affordable;
    res.set("x-toko-max-tokens", String(affordable));
  }
  const stream = body.stream === true;
  const clientWantsUsage = body.stream_options?.include_usage === true;
  if (stream) upstreamBody.stream_options = { ...(body.stream_options || {}), include_usage: true };

  // Batas request bersamaan per user.
  const active = inFlight.get(account.id) || 0;
  if (active >= config.limits.maxConcurrentPerUser) {
    return fail(res, 429, `Maksimal ${config.limits.maxConcurrentPerUser} request bersamaan`, "rate_limit_error", "too_many_concurrent_requests");
  }
  inFlight.set(account.id, active + 1);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.router.timeoutMs);
  res.on("close", () => { if (!res.writableFinished) controller.abort(); });
  const log = (status, promptTokens, completionTokens, estimated) =>
    charge({ account, model, promptTokens, completionTokens, estimated, stream, status, latencyMs: Date.now() - started });

  try {
    let upstream;
    try {
      upstream = await chatCompletions(upstreamBody, controller.signal);
    } catch (err) {
      await log(502, 0, 0, false);
      if (res.headersSent || res.destroyed) return;
      return fail(res, 502, "Tidak bisa menghubungi server model. Coba lagi sebentar lagi.", "api_error", "upstream_unreachable");
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      let message = text.slice(0, 500);
      try { message = JSON.parse(text).error?.message || message; } catch {}
      await log(upstream.status, 0, 0, false);
      console.warn(`[proxy] upstream ${upstream.status} model=${model.upstream_model}: ${message}`);
      // Pesan asli tidak pernah diteruskan (bisa menyebut nama provider/router); cukup dicatat di log.
      if ([400, 413, 422].includes(upstream.status)) {
        return fail(res, upstream.status, publicErrorMessage(upstream.status, message));
      }
      if (upstream.status === 429) {
        return fail(res, 429, "Server model sedang sibuk. Coba lagi sebentar lagi.", "rate_limit_error", "upstream_busy");
      }
      return fail(res, 502, "Server model sedang bermasalah. Coba lagi sebentar lagi.", "api_error", "upstream_error");
    }

    // ----- Non-streaming -----
    if (!stream) {
      const json = await upstream.json();
      const u = json.usage;
      const estimated = !(u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens));
      const pt = estimated ? estPrompt : u.prompt_tokens;
      const ct = estimated ? estimateTokens(outputCharsOf(json)) : u.completion_tokens;
      const balance = await log(200, pt, ct, estimated);
      res.set("x-toko-balance-rp", (balance / 1000).toFixed(3));
      return res.json(cleanCompletion(json, { id: newCompletionId(), model: model.id, keepUsage: true }));
    }

    // ----- Streaming (SSE) -----
    res.status(200);
    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const t = new SseTransformer({ id: newCompletionId(), publicModel: model.id, clientWantsUsage });
    const decoder = new TextDecoder();
    try {
      for await (const chunk of upstream.body) {
        const out = t.push(decoder.decode(chunk, { stream: true }));
        if (out && !res.destroyed) res.write(out);
      }
      const tail = t.flush();
      if (tail && !res.destroyed) res.write(tail + "\n");
    } catch (err) {
      if (!controller.signal.aborted) console.warn("[proxy] stream terputus:", err.message);
    }
    const u = t.usage;
    const estimated = !(u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens));
    await log(200, estimated ? estPrompt : u.prompt_tokens, estimated ? estimateTokens(t.outputChars) : u.completion_tokens, estimated);
    if (!res.destroyed) res.end();
  } finally {
    clearTimeout(timer);
    const n = (inFlight.get(account.id) || 1) - 1;
    if (n <= 0) inFlight.delete(account.id);
    else inFlight.set(account.id, n);
  }
});

r.use((req, res) => fail(res, 404, `Endpoint ${req.method} ${req.originalUrl} tidak tersedia`, "invalid_request_error", "not_found"));

// Error JSON rusak / body terlalu besar dari express.json.
r.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") return fail(res, 400, "Body bukan JSON yang valid");
  if (err.type === "entity.too.large") return fail(res, 413, `Body terlalu besar (maks. ${config.limits.maxBodyMb} MB)`);
  console.error("[proxy]", err);
  if (res.headersSent) return res.end();
  fail(res, 500, "Terjadi kesalahan internal", "api_error");
});

export default r;
