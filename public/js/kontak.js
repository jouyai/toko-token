import { $, api, esc } from "./api.js";

const cfg = await api("GET", "/public/config").catch(() => null);
const items = [];
if (cfg?.support?.email) items.push(`<li>Email: <a href="mailto:${esc(cfg.support.email)}">${esc(cfg.support.email)}</a></li>`);
if (cfg?.support?.whatsapp) {
  const wa = cfg.support.whatsapp.replace(/\D/g, "");
  items.push(`<li>WhatsApp: <a href="https://wa.me/${esc(wa)}" rel="noopener">+${esc(wa)}</a></li>`);
}
$("#contactList").innerHTML = items.join("") || "<li>Kontak belum diatur.</li>";
