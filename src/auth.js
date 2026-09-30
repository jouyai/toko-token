import { config } from "./config.js";
import { one, query } from "./db.js";
import { randomToken, sha256 } from "./lib/crypto.js";
import { HttpError } from "./lib/http.js";

const cookieOpts = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: "lax",
  path: "/",
  maxAge: config.session.ttlDays * 86_400_000,
});

export async function createSession(res, user, req) {
  const token = randomToken();
  await query(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [sha256(token), user.id, config.session.ttlDays, req.ip, String(req.get("user-agent") || "").slice(0, 300)]
  );
  res.cookie(config.session.cookieName, token, cookieOpts());
}

export async function destroySession(req, res) {
  const token = req.cookies?.[config.session.cookieName];
  if (token) await query("DELETE FROM sessions WHERE id = $1", [sha256(token)]);
  res.clearCookie(config.session.cookieName, { ...cookieOpts(), maxAge: undefined });
}

// Pasang req.user kalau cookie sesi valid.
export async function loadUser(req, _res, next) {
  const token = req.cookies?.[config.session.cookieName];
  if (!token) return next();
  try {
    req.user = await one(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.balance_milli, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > now()`,
      [sha256(token)]
    );
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "Silakan masuk dulu"));
  if (req.user.status !== "active") return next(new HttpError(403, "Akun kamu dinonaktifkan. Hubungi admin."));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== "admin") return next(new HttpError(404, "Tidak ditemukan"));
  next();
}

// Perlindungan CSRF: request yang mengubah data wajib membawa header khusus.
// Browser tidak bisa mengirim header custom lintas-origin tanpa preflight CORS,
// dan server ini tidak mengizinkan CORS untuk /api.
export function csrfGuard(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-toko-csrf") !== "1") return next(new HttpError(403, "Permintaan ditolak (CSRF)"));
  next();
}
