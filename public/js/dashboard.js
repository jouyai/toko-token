import { $, $$, api, bindForm, compact, copy, dateTime, esc, num, rupiah, rupiahMilli, toast } from "./api.js";
import { createLCD } from "./lcd.js";

const params = new URLSearchParams(location.search);
const state = { user: null, cfg: null, models: [], rp: 0 };

// ---------- Sesi ----------
const { user } = await api("GET", "/auth/me");
if (!user) {
  location.replace(`/masuk?next=${encodeURIComponent(location.pathname + location.search)}`);
  throw new Error("belum masuk");
}
state.user = user;
$("#main").hidden = false;
$("#navEmail").textContent = user.email;
$("#hello").textContent = `Halo, ${user.name.split(" ")[0]}!`;
$("#adminLink").hidden = user.role !== "admin";
$("#logoutBtn").addEventListener("click", async () => {
  await api("POST", "/auth/logout").catch(() => {});
  location.href = "/";
});

const led = $("#led");
const lcd = createLCD($("#balanceDigits"), { slots: 9, onBusy: (b) => led.classList.toggle("is-busy", b) });

const [cfg, modelsRes] = await Promise.all([api("GET", "/public/config"), api("GET", "/public/models")]);
state.cfg = cfg;
state.models = modelsRes.models;

// ---------- Saldo ----------
function renderBalance(milli) {
  state.user.balance_milli = milli;
  lcd.set(Math.max(0, Math.floor(milli / 1000)));
  $("#balanceExact").textContent = rupiahMilli(milli, 2);
  const cheapest = state.models.reduce((a, m) => (m.input_price_rp > 0 && (!a || m.input_price_rp < a.input_price_rp) ? m : a), null);
  $("#balanceHint").textContent = cheapest && milli > 0
    ? `≈ ${compact((milli / 1000 / cheapest.input_price_rp) * 1e6)} token ${cheapest.display_name}`
    : milli < 0 ? "SALDO MINUS" : "SALDO KOSONG";
  $("#lowBalance").hidden = milli > 5_000_000;
}
renderBalance(user.balance_milli);

// ---------- Top up ----------
const keypad = $("#keypad");
keypad.innerHTML = cfg.topupPresetsRp
  .map((n) => `<button class="key" data-rp="${n}">${n >= 1_000_000 ? n / 1_000_000 + "jt" : n / 1000 + "rb"}<small>RUPIAH</small></button>`)
  .join("");
const custom = $("#customRp");
custom.placeholder = `min. ${num(cfg.minTopupRp)}`;

function setAmount(rp) {
  state.rp = rp;
  $$(".key", keypad).forEach((k) => k.classList.toggle("is-active", +k.dataset.rp === rp));
  const valid = rp >= cfg.minTopupRp && rp <= cfg.maxTopupRp;
  $("#payBtn").textContent = valid ? `Bayar ${rupiah(rp)} ↵` : `Min. ${rupiah(cfg.minTopupRp)} · maks. ${rupiah(cfg.maxTopupRp)}`;
  $("#payBtn").disabled = !valid;
}
keypad.addEventListener("click", (e) => {
  const k = e.target.closest(".key");
  if (!k) return;
  custom.value = "";
  setAmount(+k.dataset.rp);
});
custom.addEventListener("input", () => {
  const raw = +custom.value.replace(/\D/g, "");
  custom.value = raw ? num(raw) : "";
  setAmount(raw);
});
const preset = Number(params.get("topup"));
if (preset) {
  if (cfg.topupPresetsRp.includes(preset)) setAmount(preset);
  else { custom.value = num(preset); setAmount(preset); }
  $("#topup").scrollIntoView({ block: "center" });
} else setAmount(cfg.topupPresetsRp[1] ?? cfg.topupPresetsRp[0]);
if (cfg.paymentProvider === "mock") $("#payNote").textContent = "Mode development: pembayaran disimulasikan (PAYMENT_PROVIDER=mock)";

$("#payBtn").addEventListener("click", async () => {
  const btn = $("#payBtn");
  btn.disabled = true;
  btn.textContent = "Membuat pembayaran…";
  try {
    const { redirectUrl } = await api("POST", "/account/topup", { amount: state.rp });
    location.href = redirectUrl;
  } catch (err) {
    toast(err.message, "err");
    setAmount(state.rp);
  }
});

// ---------- Mulai cepat ----------
$("#baseUrl").textContent = cfg.apiBaseUrl;
$("#copyBase").addEventListener("click", (e) => copy(cfg.apiBaseUrl, e.currentTarget));
$("#modelRows").innerHTML = state.models.length
  ? state.models.map((m) => `<tr><td><b>${esc(m.display_name)}</b><br><code>${esc(m.id)}</code></td><td class="num">${rupiah(m.input_price_rp)}</td><td class="num">${rupiah(m.output_price_rp)}</td></tr>`).join("")
  : `<tr><td colspan="3" class="empty">Belum ada model.</td></tr>`;

// ---------- API keys ----------
async function loadKeys() {
  const { keys } = await api("GET", "/account/keys");
  $("#keyRows").innerHTML = keys.length
    ? keys.map((k) => `<tr>
        <td>${esc(k.name)}</td>
        <td><code>${esc(k.prefix)}…</code></td>
        <td class="small muted">${k.last_used_at ? dateTime(k.last_used_at) : "Belum pernah"}</td>
        <td class="num"><button class="linkbtn linkbtn--danger" data-del="${k.id}" data-name="${esc(k.name)}">Hapus</button></td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="empty">Belum ada API key. Bikin satu di atas.</td></tr>`;
}
$("#keyRows").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-del]");
  if (!b) return;
  if (!confirm(`Hapus key "${b.dataset.name}"? Aplikasi yang memakai key ini akan langsung berhenti.`)) return;
  try {
    await api("DELETE", `/account/keys/${b.dataset.del}`);
    toast("API key dihapus");
    loadKeys();
  } catch (err) { toast(err.message, "err"); }
});
bindForm($("#keyForm"), async (data) => {
  const { key } = await api("POST", "/account/keys", { name: data.name });
  $("#secretValue").textContent = key.secret;
  $("#secretTest").textContent = `curl ${cfg.apiBaseUrl}/models -H "Authorization: Bearer ${key.secret}"`;
  $("#secretBox").hidden = false;
  $("#keyForm").reset();
  loadKeys();
});
$("#copySecret").addEventListener("click", (e) => copy($("#secretValue").textContent, e.currentTarget));
$("#copyTest").addEventListener("click", (e) => copy($("#secretTest").textContent, e.currentTarget));

// ---------- Pemakaian ----------
async function loadUsage() {
  const { recent, daily } = await api("GET", "/account/usage");
  // Isi 30 hari penuh (hari tanpa pemakaian = 0).
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const days = [];
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
  for (let i = 29; i >= 0; i--) {
    const key = fmt.format(new Date(Date.now() - i * 86_400_000));
    days.push(byDay.get(key) || { day: key, tokens: 0, cost_milli: 0, requests: 0 });
  }
  const max = Math.max(...days.map((d) => d.cost_milli), 1);
  const total = days.reduce((a, d) => a + d.cost_milli, 0);
  const totalTokens = days.reduce((a, d) => a + d.tokens, 0);
  $("#usageTotal").textContent = `${rupiahMilli(total)} · ${compact(totalTokens)} token`;
  const label = (d) => new Date(d.day + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  $("#chartPlot").innerHTML = days.map((d, i) => {
    const h = d.cost_milli ? Math.max(3, (d.cost_milli / max) * 100) : 2;
    return `<span class="chart__bar" tabindex="0" data-i="${i}" aria-label="${label(d)}: ${rupiahMilli(d.cost_milli)}"><i class="${d.cost_milli ? "" : "zero"}" data-h="${h}"></i></span>`;
  }).join("");
  // Tinggi batang lewat CSSOM (atribut style inline diblok CSP).
  $$("#chartPlot i").forEach((el) => (el.style.height = el.dataset.h + "%"));
  $("#chartStart").textContent = label(days[0]);
  $("#chartEnd").textContent = "Hari ini";

  const tip = $("#chartTip");
  const show = (bar) => {
    const d = days[bar.dataset.i];
    tip.textContent = `${label(d)} · ${rupiahMilli(d.cost_milli)} · ${num(d.tokens)} token · ${d.requests} req`;
    const chart = $("#chart").getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2 - chart.left, 90), chart.width - 90);
    tip.style.left = x + "px";
    tip.classList.add("is-show");
  };
  $$(".chart__bar").forEach((bar) => {
    bar.addEventListener("mouseenter", () => show(bar));
    bar.addEventListener("focus", () => show(bar));
    bar.addEventListener("mouseleave", () => tip.classList.remove("is-show"));
    bar.addEventListener("blur", () => tip.classList.remove("is-show"));
  });

  $("#usageRows").innerHTML = recent.length
    ? recent.map((u) => `<tr>
        <td class="small">${dateTime(u.created_at)}</td>
        <td><code>${esc(u.model_id)}</code>${u.stream ? ' <span class="badge">stream</span>' : ""}</td>
        <td class="small muted">${esc(u.key_name || "—")}</td>
        <td class="num">${num(u.prompt_tokens)}</td>
        <td class="num">${num(u.completion_tokens)}${u.estimated ? '<span title="Estimasi: server model tidak mengirim jumlah token"> ≈</span>' : ""}</td>
        <td class="num">${rupiahMilli(u.cost_milli, 2)}</td>
        <td>${u.status < 400 ? '<span class="badge badge--ok">OK</span>' : `<span class="badge badge--err">${u.status}</span>`}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty">Belum ada request. Coba panggil API pakai key kamu.</td></tr>`;
}

// ---------- Riwayat top up ----------
const STATUS = { paid: "Lunas", pending: "Menunggu", failed: "Gagal", expired: "Kedaluwarsa" };
async function loadPayments() {
  const { payments } = await api("GET", "/account/payments");
  $("#payRows").innerHTML = payments.length
    ? payments.map((p) => `<tr>
        <td><button class="linkbtn mono small" data-order="${esc(p.order_id)}">${esc(p.order_id)}</button></td>
        <td class="small">${dateTime(p.created_at)}</td>
        <td class="num">${rupiah(p.amount_rp)}</td>
        <td><span class="badge badge--${esc(p.status)}">${STATUS[p.status] || esc(p.status)}</span></td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="empty">Belum ada top up.</td></tr>`;
}
$("#payRows").addEventListener("click", (e) => {
  const b = e.target.closest("[data-order]");
  if (b) openReceipt(b.dataset.order);
});

// ---------- Struk ----------
const overlay = $("#overlay");
let pollTimer;
async function openReceipt(orderId, { poll = false } = {}) {
  let data;
  try {
    data = await api("GET", `/account/payments/${encodeURIComponent(orderId)}`);
  } catch (err) {
    return toast(err.message, "err");
  }
  fillReceipt(data);
  if (overlay.hidden) {
    const rc = $("#receipt");
    rc.style.animation = "none";
    void rc.offsetWidth;
    rc.style.animation = "";
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    $("#closeReceipt").focus({ preventScroll: true });
  }
  // Setelah kembali dari halaman pembayaran, cek status berkala sampai lunas (maks. ±3 menit).
  clearTimeout(pollTimer);
  if (poll && data.payment.status === "pending") {
    let n = 0;
    const tick = async () => {
      if (overlay.hidden || n++ > 60) return;
      const d = await api("GET", `/account/payments/${encodeURIComponent(orderId)}`).catch(() => null);
      if (d) fillReceipt(d);
      if (d?.payment.status === "pending") pollTimer = setTimeout(tick, 3000);
      else refresh();
    };
    pollTimer = setTimeout(tick, 3000);
  }
}
function fillReceipt({ payment: p, balance_milli }) {
  $("#rcDate").textContent = dateTime(p.paid_at || p.created_at) + " WIB";
  $("#rcOrder").textContent = p.order_id;
  $("#rcMethod").textContent = (p.method || "—").replace(/_/g, " ").toUpperCase();
  $("#rcAmount").textContent = rupiah(p.amount_rp);
  $("#rcStatus").textContent = { paid: "✓ LUNAS", pending: "MENUNGGU BAYAR", failed: "GAGAL", expired: "KEDALUWARSA" }[p.status] || p.status;
  $("#rcSub").textContent = p.status === "paid" ? "Saldo sudah masuk ke akun kamu" : p.status === "pending" ? "Halaman ini otomatis update setelah pembayaran terkonfirmasi" : "Silakan buat top up baru";
  $("#rcBalance").textContent = rupiahMilli(balance_milli);
  $("#mockPay").hidden = !(p.status === "pending" && cfg.paymentProvider === "mock");
  $("#mockPay").dataset.order = p.order_id;
  const cont = $("#continuePay");
  cont.hidden = !(p.status === "pending" && p.redirect_url && cfg.paymentProvider !== "mock");
  if (p.redirect_url) cont.href = p.redirect_url;
  if (p.status === "paid") renderBalance(balance_milli);
}
function closeReceipt() {
  overlay.hidden = true;
  document.body.style.overflow = "";
  clearTimeout(pollTimer);
  if (params.has("order")) history.replaceState(null, "", "/dashboard");
}
$("#closeReceipt").addEventListener("click", closeReceipt);
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeReceipt(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeReceipt(); });
$("#mockPay").addEventListener("click", async (e) => {
  const id = e.currentTarget.dataset.order;
  await api("POST", `/account/payments/${encodeURIComponent(id)}/mock-pay`);
  fillReceipt(await api("GET", `/account/payments/${encodeURIComponent(id)}`));
  refresh();
});

// ---------- Ganti password ----------
bindForm($("#pwForm"), async (data) => {
  await api("POST", "/auth/change-password", { current: data.current, password: data.password });
  $("#pwForm").reset();
  toast("Password diganti. Sesi di perangkat lain sudah dikeluarkan.");
});

async function refresh() {
  const [{ user: u }] = await Promise.all([api("GET", "/auth/me"), loadPayments(), loadUsage(), loadKeys()]);
  if (u) renderBalance(u.balance_milli);
}
await refresh();
if (params.get("order")) openReceipt(params.get("order"), { poll: true });
