import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ROUTER_KEY, browser, fakeMidtrans, fakeRouter, startApp } from "./helpers.js";

const MT_KEY = "SB-Mid-server-test";
let router, midtrans, app, b, admin, apiKey;

before(async () => {
  router = await fakeRouter();
  midtrans = await fakeMidtrans();
  app = await startApp({
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:55432/toko_test?host=/tmp",
    ROUTER_BASE_URL: `${router.url}/v1`,
    ROUTER_API_KEY: ROUTER_KEY,
    PAYMENT_PROVIDER: "midtrans",
    MIDTRANS_SERVER_KEY: MT_KEY,
    MIDTRANS_SNAP_URL: midtrans.url,
    MIDTRANS_API_URL: midtrans.url,
    AUTH_PER_MINUTE_PER_IP: "1000",
  });
  b = browser(app.url);
  admin = browser(app.url);
});

after(async () => {
  app?.server.close();
  router?.server.close();
  midtrans?.server.close();
  await app?.pool.end();
});

const v1 = (path, body, key = apiKey) =>
  fetch(app.url + "/v1" + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const balance = async () => (await b("GET", "/api/auth/me")).json.user.balance_milli;

test("daftar, masuk, dan tolak request tanpa header CSRF", async () => {
  const r = await b("POST", "/api/auth/register", { name: "Budi", email: "Budi@Contoh.com", password: "rahasia123", agree: true });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.email, "budi@contoh.com");

  const dup = await b("POST", "/api/auth/register", { name: "B", email: "budi@contoh.com", password: "rahasia123", agree: true });
  assert.equal(dup.status, 409);

  const noCsrf = await fetch(app.url + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "budi@contoh.com", password: "rahasia123" }),
  });
  assert.equal(noCsrf.status, 403);

  const wrong = await browser(app.url)("POST", "/api/auth/login", { email: "budi@contoh.com", password: "salah12345" });
  assert.equal(wrong.status, 401);
});

test("admin mengatur model dan melihat daftar model 9router", async () => {
  await admin("POST", "/api/auth/register", { name: "Admin", email: "admin@contoh.com", password: "rahasia123", agree: true });
  assert.equal((await admin("GET", "/api/admin/models")).status, 404); // belum admin
  await app.pool.query("UPDATE users SET role = 'admin' WHERE email = 'admin@contoh.com'");

  const up = await admin("GET", "/api/admin/upstream-models");
  assert.deepEqual(up.json.models, ["cheap/model", "glm/glm-5.1"]);

  const put = (id, upstream, inp, out) => admin("PUT", `/api/admin/models/${id}`, {
    upstream_model: upstream, display_name: id, input_price_rp: inp, output_price_rp: out,
  });
  assert.equal((await put("glm-5.1", "glm/glm-5.1", 10000, 40000)).status, 200);
  await put("rusak", "broken/model", 1000, 1000);
  await put("tanpa-usage", "nousage/model", 3000, 3000);
  await put("mati", "down/model", 1000, 1000);

  const pub = await fetch(app.url + "/api/public/models").then((r) => r.json());
  assert.equal(pub.models.length, 4);
  assert.equal(pub.models[0].upstream_model, undefined, "upstream tidak boleh bocor ke publik");
});

test("API key: dibuat, ditolak kalau saldo 0", async () => {
  const k = await b("POST", "/api/account/keys", { name: "laptop" });
  assert.equal(k.status, 201);
  assert.match(k.json.key.secret, /^tt_live_/);
  apiKey = k.json.key.secret;

  const list = await b("GET", "/api/account/keys");
  assert.equal(list.json.keys[0].secret, undefined);

  assert.equal((await v1("/models", null, "tt_live_ngawur")).status, 401);
  const r = await v1("/chat/completions", { model: "glm-5.1", messages: [{ role: "user", content: "hai" }] });
  assert.equal(r.status, 402);
  assert.equal((await r.json()).error.type, "insufficient_quota");
});

test("top up Midtrans: webhook palsu ditolak, webhook asli menambah saldo sekali saja", async () => {
  const t = await b("POST", "/api/account/topup", { amount: 50000 });
  assert.equal(t.status, 201);
  const orderId = t.json.orderId;
  assert.match(t.json.redirectUrl, /pay\.example/);
  assert.equal(midtrans.state.lastCharge.transaction_details.gross_amount, 50000);

  const sign = (n) => crypto.createHash("sha512").update(`${n.order_id}${n.status_code}${n.gross_amount}${MT_KEY}`).digest("hex");
  const notif = { order_id: orderId, status_code: "200", gross_amount: "50000.00", transaction_status: "settlement" };
  const post = (body) => fetch(app.url + "/api/payments/midtrans/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  assert.equal((await post({ ...notif, signature_key: "palsu" })).status, 403);
  assert.equal(await balance(), 0);

  // Signature benar tapi status di Midtrans masih pending -> saldo belum masuk.
  midtrans.state.status[orderId] = { order_id: orderId, status_code: "201", gross_amount: "50000.00", transaction_status: "pending" };
  assert.equal((await post({ ...notif, signature_key: sign(notif) })).status, 200);
  assert.equal(await balance(), 0);

  midtrans.state.status[orderId] = { order_id: orderId, status_code: "200", gross_amount: "50000.00", transaction_status: "settlement", payment_type: "qris" };
  await post({ ...notif, signature_key: sign(notif) });
  await post({ ...notif, signature_key: sign(notif) }); // dikirim ulang
  const s = await b("GET", `/api/account/payments/${orderId}`);
  assert.equal(s.json.payment.status, "paid");
  assert.equal(await balance(), 50_000_000);

  const ledger = await b("GET", "/api/account/ledger");
  assert.equal(ledger.json.ledger.length, 1);
});

test("chat non-streaming: model diganti, saldo dipotong sesuai usage", async () => {
  const before = await balance();
  const r = await v1("/chat/completions", { model: "glm-5.1", messages: [{ role: "user", content: "hai" }] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.model, "glm-5.1");
  assert.equal(router.state.lastBody.model, "glm/glm-5.1");
  assert.equal(router.state.lastAuth, `Bearer ${ROUTER_KEY}`);
  // 1000 × Rp10.000/1M + 500 × Rp40.000/1M = Rp10 + Rp20 = Rp30
  assert.equal(before - (await balance()), 30_000);
  assert.ok(r.headers.get("x-toko-balance-rp"));
});

test("chat streaming: usage dibuang kalau tidak diminta, tetap ditagih", async () => {
  const before = await balance();
  const r = await v1("/chat/completions", { model: "glm-5.1", stream: true, messages: [{ role: "user", content: "hai" }] });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.match(text, /"model":"glm-5.1"/);
  assert.doesNotMatch(text, /glm\/glm-5.1/);
  assert.doesNotMatch(text, /usage/);
  assert.match(text, /\[DONE\]/);
  assert.equal(router.state.lastBody.stream_options.include_usage, true);
  assert.equal(before - (await balance()), 30_000);

  const r2 = await v1("/chat/completions", { model: "glm-5.1", stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "hai" }] });
  assert.match(await r2.text(), /"usage"/);
});

test("tanpa usage dari 9router: ditagih pakai estimasi", async () => {
  const before = await balance();
  const r = await v1("/chat/completions", { model: "tanpa-usage", messages: [{ role: "user", content: "hai" }] });
  assert.equal(r.status, 200);
  assert.ok(before - (await balance()) > 0);
  const u = await b("GET", "/api/account/usage");
  assert.equal(u.json.recent[0].estimated, true);
});

test("error dari 9router tidak ditagih", async () => {
  const before = await balance();
  const r = await v1("/chat/completions", { model: "rusak", messages: [{ role: "user", content: "hai" }] });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.message, "context too long");
  assert.equal(await balance(), before);
});

test("error server model disamarkan & tidak ditagih", async () => {
  const before = await balance();
  const r = await v1("/chat/completions", { model: "mati", messages: [{ role: "user", content: "hai" }] });
  assert.equal(r.status, 502);
  assert.doesNotMatch(JSON.stringify(await r.json()), /provider-rahasia|down\/model/);
  assert.equal(await balance(), before);
});

test("body dibaca setelah API key dicek", async () => {
  const r = await v1("/chat/completions", { model: "glm-5.1", messages: [{ role: "user", content: "x".repeat(2_000_000) }] }, "tt_live_ngawur");
  assert.equal(r.status, 401);
});

test("model tidak dikenal & max_tokens dibatasi sesuai saldo", async () => {
  assert.equal((await v1("/chat/completions", { model: "gpt-9", messages: [] })).status, 404);

  // Sisakan saldo Rp1: cukup untuk ~25 token output di Rp40.000/1M.
  await app.pool.query("UPDATE users SET balance_milli = 1000 WHERE email = 'budi@contoh.com'");
  const r = await v1("/chat/completions", { model: "glm-5.1", max_tokens: 4000, messages: [{ role: "user", content: "hai" }] });
  assert.equal(r.status, 200);
  assert.ok(router.state.lastBody.max_tokens < 4000);
  assert.equal(r.headers.get("x-toko-max-tokens"), String(router.state.lastBody.max_tokens));
});

test("admin koreksi saldo tercatat di ledger", async () => {
  const { rows } = await app.pool.query("SELECT id FROM users WHERE email = 'budi@contoh.com'");
  const r = await admin("POST", `/api/admin/users/${rows[0].id}/adjust`, { amount_rp: 1000, note: "kompensasi" });
  assert.equal(r.status, 200);
  const l = await b("GET", "/api/account/ledger");
  assert.equal(l.json.ledger[0].kind, "adjustment");
  assert.equal((await b("GET", "/api/admin/stats")).status, 404, "user biasa tidak bisa lihat admin");
});

test("reset password lewat token", async () => {
  const r = await b("POST", "/api/auth/forgot", { email: "budi@contoh.com" });
  assert.equal(r.status, 200);
  const { rows } = await app.pool.query("SELECT count(*)::int AS n FROM password_resets");
  assert.equal(rows[0].n, 1);
  const bad = await b("POST", "/api/auth/reset", { token: "x".repeat(20), password: "passwordbaru" });
  assert.equal(bad.status, 400);
});
