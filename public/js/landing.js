import { $, $$, api, esc, me, num, rupiah } from "./api.js";
import { createLCD } from "./lcd.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const led = $("#led");
const lcd = createLCD($("#lcdDigits"), { onBusy: (b) => led.classList.toggle("is-busy", b) });
const state = { models: [], model: null, rp: 0, cfg: null, user: null, tab: "curl" };

$("#year").textContent = new Date().getFullYear();

const [modelsRes, cfg, user] = await Promise.all([
  api("GET", "/public/models").catch(() => ({ models: [] })),
  api("GET", "/public/config").catch(() => null),
  me(),
]);
state.models = modelsRes.models;
state.cfg = cfg || { apiBaseUrl: location.origin + "/v1", topupPresetsRp: [10000, 25000, 50000, 100000, 250000, 500000], minTopupRp: 10000 };
state.user = user;
state.model = state.models[0] || null;
state.rp = state.cfg.topupPresetsRp[0];

// ---------- Nav ----------
if (user) {
  $("#navCta").innerHTML = `<a href="/dashboard" class="btn btn--ink">Dashboard</a>`;
}
if (!cfg?.support?.email && !cfg?.support?.whatsapp) $("#footContact")?.remove();

// ---------- Ticker ----------
if (state.models.length) {
  const items = state.models
    .map((m) => `<span class="ticker__item">${esc(m.display_name.toUpperCase())} <b>▲ ${rupiah(m.input_price_rp)}</b> /1M</span>`)
    .join("");
  $("#ticker").innerHTML = items.repeat(Math.max(2, Math.ceil(12 / state.models.length)) * 2);
  const cheapest = Math.min(...state.models.map((m) => m.input_price_rp));
  $("#factMin").textContent = "mulai " + rupiah(cheapest);
} else {
  $("#factMin").textContent = "—";
}

// ---------- Meteran ----------
const tokensFor = (rp, m) => (m && m.input_price_rp > 0 ? (rp / m.input_price_rp) * 1_000_000 : 0);

function update() {
  const m = state.model;
  $("#lcdModel").textContent = m ? m.display_name : "Belum ada model";
  $("#lcdRate").textContent = m ? `${rupiah(m.input_price_rp)}/1M` : "—";
  $("#lcdRp").textContent = rupiah(state.rp);
  lcd.set(tokensFor(state.rp, m));
  showTab(state.tab);
}

const sel = $("#modelSelect");
sel.innerHTML = state.models.map((m, i) => `<option value="${i}">${esc(m.display_name)}${m.vendor ? " — " + esc(m.vendor) : ""}</option>`).join("");
sel.addEventListener("change", () => { state.model = state.models[sel.value]; update(); });

const keypad = $("#keypad");
keypad.innerHTML = state.cfg.topupPresetsRp
  .map((n) => `<button class="key" data-rp="${n}">${n >= 1_000_000 ? n / 1_000_000 + "jt" : n / 1000 + "rb"}<small>RUPIAH</small></button>`)
  .join("");
const setActiveKey = () => $$(".key", keypad).forEach((k) => k.classList.toggle("is-active", +k.dataset.rp === state.rp));
keypad.addEventListener("click", (e) => {
  const k = e.target.closest(".key");
  if (!k) return;
  state.rp = +k.dataset.rp;
  $("#customRp").value = "";
  setActiveKey();
  update();
});
const custom = $("#customRp");
custom.addEventListener("input", () => {
  const raw = +custom.value.replace(/\D/g, "");
  custom.value = raw ? num(raw) : "";
  if (raw >= state.cfg.minTopupRp) { state.rp = raw; setActiveKey(); update(); }
});

$("#buyBtn").addEventListener("click", () => {
  const rp = Math.max(state.rp, state.cfg.minTopupRp);
  location.href = state.user ? `/dashboard?topup=${rp}` : `/daftar?topup=${rp}`;
});

// ---------- Papan harga ----------
const flap = (text, label) =>
  `<span class="flap" data-label="${label}">${[...text].map((c) => `<i class="${/\d/.test(c) ? "" : "sep"}">${esc(c)}</i>`).join("")}</span>`;
$("#boardRows").innerHTML = state.models.length
  ? state.models.map((m, i) => `
    <div class="board__row" role="row">
      <span class="m-name" role="cell">${esc(m.display_name)}${m.tag ? `<span class="m-tag">${esc(m.tag)}</span>` : ""}<span class="m-vendor">${esc(m.vendor)}${m.vendor ? " · " : ""}${esc(m.id)}</span></span>
      <span class="m-ctx" role="cell">${esc(m.context_label)}</span>
      <span role="cell">${flap(num(m.input_price_rp), "IN")}</span>
      <span role="cell">${flap(num(m.output_price_rp), "OUT")}</span>
      <button class="pick" data-i="${i}">Pilih →</button>
    </div>`).join("")
  : `<p class="board__empty">Belum ada model yang dijual.</p>`;

$("#boardRows").addEventListener("click", (e) => {
  const b = e.target.closest(".pick");
  if (!b) return;
  sel.value = b.dataset.i;
  state.model = state.models[b.dataset.i];
  update();
  $("#meter").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
});

function spinFlaps(root) {
  if (reduceMotion) return;
  $$(".flap i:not(.sep)", root).forEach((cell, idx) => {
    const final = cell.textContent;
    let n = 0;
    const max = 8 + (idx % 7) * 2;
    const iv = setInterval(() => {
      cell.textContent = n++ >= max ? final : String((Math.random() * 10) | 0);
      if (n > max) clearInterval(iv);
    }, 55);
  });
}

// ---------- Contoh kode ----------
const S = (s) => `<span class="s">${esc(s)}</span>`;
const K = (s) => `<span class="k">${s}</span>`;
function snippets() {
  const base = esc(state.cfg.apiBaseUrl);
  return {
    curl: `<span class="c"># Sisa saldo ada di header respons: x-toko-balance-rp</span>
curl ${base}/chat/completions \\
  -H ${S('"Authorization: Bearer $TOKO_KEY"')} \\
  -H ${S('"Content-Type: application/json"')} \\
  -d ${S(`'{
    "model": "${state.model?.id || "nama-model"}",
    "messages": [{"role": "user", "content": "Halo!"}]
  }'`)}`,
    py: `${K("from")} openai ${K("import")} OpenAI

client = OpenAI(
    base_url=${S(`"${state.cfg.apiBaseUrl}"`)},
    api_key=${S('"tt_live_..."')},
)

res = client.chat.completions.create(
    model=${S(`"${state.model?.id || "nama-model"}"`)},
    messages=[{${S('"role"')}: ${S('"user"')}, ${S('"content"')}: ${S('"Halo!"')}}],
)
print(res.choices[0].message.content)`,
    js: `${K("import")} OpenAI ${K("from")} ${S('"openai"')};

${K("const")} client = ${K("new")} OpenAI({
  baseURL: ${S(`"${state.cfg.apiBaseUrl}"`)},
  apiKey: process.env.TOKO_KEY,
});

${K("const")} res = ${K("await")} client.chat.completions.create({
  model: ${S(`"${state.model?.id || "nama-model"}"`)},
  messages: [{ role: ${S('"user"')}, content: ${S('"Halo!"')} }],
});
console.log(res.choices[0].message.content);`,
  };
}
function showTab(t) {
  state.tab = t;
  $("#code").innerHTML = snippets()[t];
  $$(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === t));
}
$$(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

// ---------- Reveal ----------
const targets = $$(".section-head, .step, .board, .code, .faq__list");
targets.forEach((el) => el.classList.add("reveal"));
const io = new IntersectionObserver((entries) => entries.forEach((en) => {
  if (!en.isIntersecting) return;
  en.target.classList.add("is-in");
  if (en.target.classList.contains("board")) spinFlaps(en.target);
  io.unobserve(en.target);
}), { threshold: 0.15 });
targets.forEach((el) => io.observe(el));

setActiveKey();
update();
