import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [algo, n, r, p, saltB64, hashB64] = String(stored).split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

// Dipakai supaya waktu respons login sama walau email tidak terdaftar.
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(12).toString("hex"));

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

export function newApiKey() {
  const key = "tt_live_" + crypto.randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, 12), hash: sha256(key) };
}

export function newOrderId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `TT-${d}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}
