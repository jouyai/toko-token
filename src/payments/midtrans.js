import crypto from "node:crypto";
import { config } from "../config.js";

// Integrasi Midtrans Snap: https://docs.midtrans.com/reference/snap-api
const mt = () => config.payment.midtrans;
const snapBase = () => mt().snapUrl || (mt().isProduction ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com");
const apiBase = () => mt().apiUrl || (mt().isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com");
const authHeader = () => "Basic " + Buffer.from(mt().serverKey + ":").toString("base64");

export async function createCharge({ orderId, amountRp, user }) {
  const res = await fetch(`${snapBase()}/snap/v1/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authHeader() },
    body: JSON.stringify({
      transaction_details: { order_id: orderId, gross_amount: amountRp },
      item_details: [{ id: "saldo", price: amountRp, quantity: 1, name: `Saldo ${config.appName}` }],
      customer_details: { first_name: user.name.slice(0, 50), email: user.email },
      enabled_payments: mt().enabledPayments,
      callbacks: { finish: `${config.appUrl}/dashboard?order=${encodeURIComponent(orderId)}` },
      expiry: { unit: "hours", duration: 24 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.redirect_url) {
    throw new Error(`Midtrans menolak transaksi (${res.status}): ${JSON.stringify(data.error_messages || data)}`);
  }
  return { redirectUrl: data.redirect_url };
}

// signature_key = SHA512(order_id + status_code + gross_amount + server_key)
export function verifySignature(n) {
  if (!n || typeof n.signature_key !== "string") return false;
  const expected = crypto
    .createHash("sha512")
    .update(`${n.order_id}${n.status_code}${n.gross_amount}${mt().serverKey}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(n.signature_key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Tanya langsung ke Midtrans; jangan percaya isi notifikasi mentah-mentah.
export async function fetchStatus(orderId) {
  const res = await fetch(`${apiBase()}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: { Accept: "application/json", Authorization: authHeader() },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gagal cek status Midtrans (${res.status})`);
  return data;
}

// Ubah status Midtrans ke status internal.
export function mapStatus(s) {
  const ts = s.transaction_status;
  if (ts === "settlement") return "paid";
  if (ts === "capture") return s.fraud_status === "accept" ? "paid" : "pending";
  if (ts === "expire") return "expired";
  if (["deny", "cancel", "failure"].includes(ts)) return "failed";
  return "pending";
}
