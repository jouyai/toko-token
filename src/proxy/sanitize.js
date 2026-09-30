// Membersihkan respons dari 9router sebelum dikirim ke pembeli, supaya pembeli
// hanya melihat "Toko Token": field non-standar dibuang, id diganti id kita,
// dan id tool call dari provider disamarkan (bisa dibalik saat dikirim lagi).
import crypto from "node:crypto";
import { config } from "../config.js";

export const newCompletionId = () => "chatcmpl-" + crypto.randomBytes(12).toString("base64url");

// ---------- Id tool call ----------
// Dienkripsi (AES-256-CTR) supaya format id provider tidak terlihat, tapi tetap bisa
// dikembalikan ketika pembeli mengirim hasil tool di request berikutnya.
const key = crypto.createHash("sha256").update("tool-id:" + (config.idSecret || "dev-secret")).digest();
const PREFIX = "call_tt";

export function encodeToolId(id) {
  if (typeof id !== "string" || !id || id.startsWith(PREFIX)) return id;
  const iv = crypto.createHash("sha256").update(id).digest().subarray(0, 16); // deterministik
  const c = crypto.createCipheriv("aes-256-ctr", key, iv);
  return PREFIX + Buffer.concat([iv, c.update(id, "utf8"), c.final()]).toString("base64url");
}

export function decodeToolId(id) {
  if (typeof id !== "string" || !id.startsWith(PREFIX)) return id;
  try {
    const buf = Buffer.from(id.slice(PREFIX.length), "base64url");
    const d = crypto.createDecipheriv("aes-256-ctr", key, buf.subarray(0, 16));
    return Buffer.concat([d.update(buf.subarray(16)), d.final()]).toString("utf8");
  } catch {
    return id;
  }
}

// Kembalikan id tool call di request pembeli ke bentuk aslinya sebelum diteruskan.
export function restoreToolIds(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (!m || typeof m !== "object") return m;
    const out = { ...m };
    if (typeof out.tool_call_id === "string") out.tool_call_id = decodeToolId(out.tool_call_id);
    if (Array.isArray(out.tool_calls)) out.tool_calls = out.tool_calls.map((tc) => (tc && tc.id ? { ...tc, id: decodeToolId(tc.id) } : tc));
    return out;
  });
}

// ---------- Whitelist field format OpenAI ----------
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

function cleanToolCalls(list) {
  if (!Array.isArray(list)) return undefined;
  return list.map((tc) => {
    const t = pick(tc || {}, ["index", "id", "type", "function"]);
    if (t.id) t.id = encodeToolId(t.id);
    if (t.function) t.function = pick(t.function, ["name", "arguments"]);
    return t;
  });
}

function cleanMessage(m) {
  if (!m || typeof m !== "object") return m;
  const out = pick(m, ["role", "content", "refusal", "reasoning_content", "function_call"]);
  const tc = cleanToolCalls(m.tool_calls);
  if (tc) out.tool_calls = tc;
  return out;
}

export const cleanUsage = (u) =>
  u && typeof u === "object" ? pick(u, ["prompt_tokens", "completion_tokens", "total_tokens"]) : undefined;

// Satu objek completion (non-stream) atau chunk (stream).
export function cleanCompletion(obj, { id, model, keepUsage }) {
  const out = {
    id,
    object: obj.object || (obj.choices?.[0]?.delta ? "chat.completion.chunk" : "chat.completion"),
    created: Number.isFinite(obj.created) ? obj.created : Math.floor(Date.now() / 1000),
    model,
    choices: (obj.choices || []).map((c) => {
      const ch = pick(c || {}, ["index", "finish_reason", "logprobs"]);
      if (c?.message) ch.message = cleanMessage(c.message);
      if (c?.delta) ch.delta = cleanMessage(c.delta);
      return ch;
    }),
  };
  if (keepUsage && obj.usage) out.usage = cleanUsage(obj.usage);
  return out;
}

// Pesan error dari server model bisa menyebut nama provider/router; ganti dengan pesan kita.
export function publicErrorMessage(status, upstreamMessage = "") {
  const m = upstreamMessage.toLowerCase();
  if (/context|too long|maximum.*(length|tokens)|token limit|exceeds/.test(m)) {
    return "Input terlalu panjang untuk model ini. Kurangi panjang pesan atau max_tokens.";
  }
  if (/image|vision|multimodal/.test(m)) return "Model ini tidak mendukung input gambar.";
  if (/tool|function/.test(m)) return "Format tools/function tidak valid untuk model ini.";
  if (status === 413) return "Request terlalu besar.";
  return "Request ditolak oleh model. Periksa format messages dan parameter yang dikirim.";
}
