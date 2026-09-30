import { Router } from "express";
import { config } from "../config.js";
import { query } from "../db.js";
import * as payments from "../payments/index.js";

const r = Router();

r.get("/public/models", async (_req, res) => {
  const { rows } = await query(
    `SELECT id, display_name, vendor, context_label, input_price_rp, output_price_rp, tag
       FROM models WHERE active ORDER BY sort_order, display_name`
  );
  res.set("Cache-Control", "public, max-age=60");
  res.json({ models: rows });
});

r.get("/public/config", (_req, res) => {
  res.json({
    appName: config.appName,
    apiBaseUrl: `${config.appUrl}/v1`,
    minTopupRp: config.billing.minTopupRp,
    maxTopupRp: config.billing.maxTopupRp,
    topupPresetsRp: config.billing.topupPresetsRp,
    paymentProvider: config.payment.provider,
    support: config.support,
  });
});

// Webhook Midtrans. Atur "Payment Notification URL" di dashboard Midtrans ke:
//   https://domain-kamu/api/payments/midtrans/notify
r.post("/payments/midtrans/notify", async (req, res) => {
  if (config.payment.provider !== "midtrans") return res.status(404).end();
  try {
    const out = await payments.handleMidtransNotification(req.body);
    res.status(out.status).json({ ok: out.ok });
  } catch (err) {
    // 5xx membuat Midtrans mengirim ulang notifikasi nanti.
    console.error("[midtrans notify]", err.message);
    res.status(500).json({ ok: false });
  }
});

export default r;
