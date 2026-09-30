// Menyiapkan lingkungan tes: 9router tiruan, Midtrans tiruan, database bersih, dan app.
import http from "node:http";

export const ROUTER_KEY = "router-secret";

export function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

const readBody = (req) =>
  new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : null));
  });

// 9router tiruan: usage selalu 1000 prompt + 500 completion.
export async function fakeRouter() {
  const state = { lastBody: null, lastAuth: null };
  const srv = await listen(async (req, res) => {
    state.lastAuth = req.headers.authorization;
    if (req.headers.authorization !== `Bearer ${ROUTER_KEY}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "bad key" } }));
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "glm/glm-5.1" }, { id: "cheap/model" }] }));
    }
    const body = await readBody(req);
    state.lastBody = body;
    if (body.model === "broken/model") {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "context too long" } }));
    }
    if (body.model === "down/model") {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "provider-rahasia: quota exhausted" } }));
    }
    const usage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 };
    if (!body.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      const message = body.tools
        ? { role: "assistant", content: null, tool_calls: [{ id: "toolu_rahasia123", type: "function", function: { name: "cuaca", arguments: "{}" }, provider_meta: "x" }] }
        : { role: "assistant", content: "Halo juga!", provider_specific_fields: { a: 1 } };
      return res.end(JSON.stringify({
        id: "gen-upstream-xyz", object: "chat.completion", model: body.model, provider: "provider-rahasia",
        system_fingerprint: "fp_rahasia", created: 1700000000,
        choices: [{ index: 0, message, finish_reason: body.tools ? "tool_calls" : "stop" }],
        ...(body.model === "nousage/model" ? {} : { usage: { ...usage, cache_creation_input_tokens: 0 } }),
      }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    res.write(": OPENROUTER PROCESSING\n\n");
    chunk({ id: "gen-upstream-xyz", provider: "provider-rahasia", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "Ha" } }] });
    chunk({ id: "c1", model: body.model, choices: [{ index: 0, delta: { content: "lo!" } }] });
    if (body.stream_options?.include_usage) chunk({ id: "c1", model: body.model, choices: [], usage });
    res.end("data: [DONE]\n\n");
  });
  return { ...srv, state };
}

export async function fakeMidtrans() {
  const state = { status: {} };
  const srv = await listen(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && req.url === "/snap/v1/transactions") {
      const body = await readBody(req);
      state.lastCharge = body;
      return res.end(JSON.stringify({ token: "snap-token", redirect_url: `https://pay.example/${body.transaction_details.order_id}` }));
    }
    const m = req.url.match(/^\/v2\/([^/]+)\/status$/);
    if (m) {
      const s = state.status[decodeURIComponent(m[1])];
      return res.end(JSON.stringify(s || { status_code: "404" }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return { ...srv, state };
}

export async function startApp(env) {
  Object.assign(process.env, env);
  const { pool } = await import("../src/db.js");
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const { migrate } = await import("../src/migrate.js");
  await migrate({ log: () => {} });
  const { createApp } = await import("../src/server.js");
  const srv = await listen(createApp());
  return { ...srv, pool };
}

// Klien kecil yang menyimpan cookie sesi.
export function browser(base) {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "x-toko-csrf": "1", ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
}
