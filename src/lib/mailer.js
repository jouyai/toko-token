import nodemailer from "nodemailer";
import { config } from "../config.js";

let transport;
function getTransport() {
  if (!config.mail.smtpUrl) return null;
  transport ??= nodemailer.createTransport(config.mail.smtpUrl);
  return transport;
}

export async function sendMail({ to, subject, text }) {
  const t = getTransport();
  if (!t) {
    // Tanpa SMTP (development): tulis ke log supaya link tetap bisa dipakai.
    console.log(`[mail] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  await t.sendMail({ from: config.mail.from, to, subject, text });
}
