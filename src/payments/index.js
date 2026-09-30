import { config } from "../config.js";
import { one, tx } from "../db.js";
import { newOrderId } from "../lib/crypto.js";
import { rpToMilli } from "../lib/money.js";
import * as midtrans from "./midtrans.js";

export async function startTopup(user, amountRp) {
  const orderId = newOrderId();
  const provider = config.payment.provider;
  await one(
    "INSERT INTO payments (order_id, user_id, provider, amount_rp) VALUES ($1, $2, $3, $4)",
    [orderId, user.id, provider, amountRp]
  );
  let redirectUrl;
  try {
    if (provider === "midtrans") {
      ({ redirectUrl } = await midtrans.createCharge({ orderId, amountRp, user }));
    } else if (provider === "mock") {
      redirectUrl = `/dashboard?order=${orderId}&mock=1`;
    } else {
      throw new Error(`PAYMENT_PROVIDER tidak dikenal: ${provider}`);
    }
  } catch (err) {
    await one("UPDATE payments SET status = 'failed', raw = $2 WHERE order_id = $1", [orderId, { error: err.message }]);
    throw err;
  }
  await one("UPDATE payments SET redirect_url = $2 WHERE order_id = $1", [orderId, redirectUrl]);
  return { orderId, redirectUrl };
}

// Terapkan status terbaru sebuah order. Aman dipanggil berkali-kali (idempotent):
// saldo hanya bertambah sekali, saat status berubah dari belum-paid ke paid.
export async function applyStatus(orderId, { status, grossAmount, method, raw }) {
  return tx(async (c) => {
    const { rows } = await c.query("SELECT * FROM payments WHERE order_id = $1 FOR UPDATE", [orderId]);
    const p = rows[0];
    if (!p) return null; // mis. notifikasi tes dari dashboard Midtrans
    if (p.status === "paid") return p;

    if (status === "paid") {
      if (grossAmount !== undefined && Math.round(Number(grossAmount)) !== p.amount_rp) {
        throw new Error(`Nominal order ${orderId} tidak cocok: ${grossAmount} vs ${p.amount_rp}`);
      }
      const milli = rpToMilli(p.amount_rp);
      const u = await c.query(
        "UPDATE users SET balance_milli = balance_milli + $2 WHERE id = $1 RETURNING balance_milli",
        [p.user_id, milli]
      );
      await c.query(
        `INSERT INTO ledger (user_id, kind, amount_milli, balance_after_milli, ref, note)
         VALUES ($1, 'topup', $2, $3, $4, $5)`,
        [p.user_id, milli, u.rows[0].balance_milli, orderId, `Top up via ${p.provider}${method ? ` (${method})` : ""}`]
      );
      const done = await c.query(
        "UPDATE payments SET status = 'paid', paid_at = now(), method = $2, raw = $3 WHERE order_id = $1 RETURNING *",
        [orderId, method ?? null, raw ?? null]
      );
      return done.rows[0];
    }
    // Status lain: jangan turunkan order yang sudah final.
    const upd = await c.query(
      "UPDATE payments SET status = $2, method = COALESCE($3, method), raw = COALESCE($4, raw) WHERE order_id = $1 RETURNING *",
      [orderId, status, method ?? null, raw ?? null]
    );
    return upd.rows[0];
  });
}

// Cek ulang ke Midtrans (dipakai saat user kembali dari halaman pembayaran).
export async function syncOrder(p) {
  if (p.status !== "pending" || p.provider !== "midtrans") return p;
  try {
    const s = await midtrans.fetchStatus(p.order_id);
    if (s.status_code === "404") return p; // belum pilih metode bayar
    return await applyStatus(p.order_id, {
      status: midtrans.mapStatus(s), grossAmount: s.gross_amount, method: s.payment_type, raw: s,
    });
  } catch (err) {
    console.error("[payments] sync gagal:", err.message);
    return p;
  }
}

export async function handleMidtransNotification(body) {
  if (!midtrans.verifySignature(body)) return { ok: false, status: 403 };
  const s = await midtrans.fetchStatus(body.order_id);
  await applyStatus(s.order_id, {
    status: midtrans.mapStatus(s), grossAmount: s.gross_amount, method: s.payment_type, raw: s,
  });
  return { ok: true, status: 200 };
}
