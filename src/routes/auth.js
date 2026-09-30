import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { one, query, tx } from "../db.js";
import { createSession, destroySession, requireUser } from "../auth.js";
import { DUMMY_HASH, hashPassword, randomToken, sha256, verifyPassword } from "../lib/crypto.js";
import { HttpError, parse } from "../lib/http.js";
import { RateLimiter, limitByIp } from "../lib/ratelimit.js";
import { sendMail } from "../lib/mailer.js";

const r = Router();
const authLimit = limitByIp(new RateLimiter({ limit: config.limits.authPerMinutePerIp, windowMs: 60_000 }));

const email = z.string().trim().toLowerCase().email("Email tidak valid").max(254);
const password = z.string().min(8, "Password minimal 8 karakter").max(200);

export const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, balance_milli: u.balance_milli, created_at: u.created_at,
});

r.post("/register", authLimit, async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(1, "Nama wajib diisi").max(80),
    email,
    password,
    agree: z.literal(true, { error: "Kamu perlu menyetujui Syarat & Ketentuan" }),
  }), req.body);
  const hash = await hashPassword(body.password);
  let user;
  try {
    user = await one(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *",
      [body.email, body.name, hash]
    );
  } catch (err) {
    if (err.code === "23505") throw new HttpError(409, "Email sudah terdaftar. Silakan masuk.");
    throw err;
  }
  await createSession(res, user, req);
  res.status(201).json({ user: publicUser(user) });
});

r.post("/login", authLimit, async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
  const user = await one("SELECT * FROM users WHERE lower(email) = $1", [body.email]);
  const ok = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, "Email atau password salah");
  if (user.status !== "active") throw new HttpError(403, "Akun kamu dinonaktifkan. Hubungi admin.");
  await createSession(res, user, req);
  res.json({ user: publicUser(user) });
});

r.post("/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

r.get("/me", (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

r.post("/forgot", authLimit, async (req, res) => {
  const body = parse(z.object({ email }), req.body);
  const user = await one("SELECT id, email FROM users WHERE lower(email) = $1 AND status = 'active'", [body.email]);
  if (user) {
    const token = randomToken();
    await query(
      "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [sha256(token), user.id]
    );
    const link = `${config.appUrl}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: `Reset password ${config.appName}`,
      text: `Halo,\n\nKlik link berikut untuk membuat password baru (berlaku 1 jam):\n${link}\n\nKalau kamu tidak meminta reset password, abaikan email ini.\n\n— ${config.appName}`,
    });
  }
  // Jawaban selalu sama supaya tidak bisa dipakai menebak email yang terdaftar.
  res.json({ ok: true });
});

r.post("/reset", authLimit, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
  const hash = await hashPassword(body.password);
  await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE password_resets SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(body.token)]
    );
    if (!rows[0]) throw new HttpError(400, "Link reset tidak valid atau sudah kedaluwarsa");
    await c.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, rows[0].user_id]);
    // Keluarkan semua sesi lama.
    await c.query("DELETE FROM sessions WHERE user_id = $1", [rows[0].user_id]);
  });
  res.json({ ok: true });
});

r.post("/change-password", requireUser, async (req, res) => {
  const body = parse(z.object({ current: z.string().min(1).max(200), password }), req.body);
  const u = await one("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
  if (!(await verifyPassword(body.current, u.password_hash))) throw new HttpError(400, "Password lama salah");
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [await hashPassword(body.password), req.user.id]);
  const current = sha256(req.cookies[config.session.cookieName]);
  await query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [req.user.id, current]);
  res.json({ ok: true });
});

export default r;
