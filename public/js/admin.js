import { $, $$, api, bindForm, compact, dateTime, esc, num, rupiah, rupiahMilli, toast } from "./api.js";

const { user } = await api("GET", "/auth/me");
if (!user || user.role !== "admin") {
  location.replace(user ? "/dashboard" : "/masuk?next=/admin");
  throw new Error("bukan admin");
}
$("#main").hidden = false;

// ---------- Tabs ----------
const loaders = { overview: loadOverview, models: loadModels, users: loadUsers, payments: loadPayments };
function openTab(name) {
  $$(".seg-tabs button").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  history.replaceState(null, "", "#" + name);
  loaders[name]().catch((err) => toast(err.message, "err"));
}
$$(".seg-tabs button").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab)));

// ---------- Ringkasan ----------
async function loadOverview() {
  const { stats: s, byModel } = await api("GET", "/admin/stats");
  const tiles = [
    ["User", num(s.users)],
    ["Pendapatan 30 hari", rupiah(s.revenue_30d_rp)],
    ["Total pendapatan", rupiah(s.revenue_rp)],
    ["Saldo user (utang layanan)", rupiahMilli(s.outstanding_milli)],
    ["Pemakaian 24 jam", rupiahMilli(s.usage_24h_milli)],
    ["Token 24 jam", compact(s.tokens_24h)],
    ["Request 24 jam", num(s.requests_24h)],
    ["Error 24 jam", num(s.errors_24h)],
  ];
  $("#stats").innerHTML = tiles.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
  $("#byModel").innerHTML = byModel.length
    ? byModel.map((m) => `<tr><td><code>${esc(m.model_id)}</code></td><td class="num">${num(m.requests)}</td><td class="num">${compact(m.tokens)}</td><td class="num">${rupiahMilli(m.cost_milli)}</td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">Belum ada pemakaian.</td></tr>`;
}

// ---------- Model ----------
let models = [];
let upstream = null;
async function loadModels() {
  const [m, u] = await Promise.all([
    api("GET", "/admin/models"),
    api("GET", "/admin/upstream-models").catch((err) => ({ error: err.message })),
  ]);
  models = m.models;
  if (u.error) {
    upstream = null;
    $("#routerStatus").textContent = "⚠ " + u.error;
  } else {
    upstream = new Set(u.models);
    $("#routerStatus").textContent = `✓ 9router tersambung · ${u.models.length} model tersedia`;
    $("#upstreamList").innerHTML = u.models.map((id) => `<option value="${esc(id)}"></option>`).join("");
  }
  $("#modelRows").innerHTML = models.length
    ? models.map((m, i) => `<tr>
        <td><b>${esc(m.display_name)}</b><br><code>${esc(m.id)}</code></td>
        <td><code>${esc(m.upstream_model)}</code>${upstream && !upstream.has(m.upstream_model) ? '<br><span class="warn">tidak ada di 9router</span>' : ""}</td>
        <td class="num">${rupiah(m.input_price_rp)}</td>
        <td class="num">${rupiah(m.output_price_rp)}</td>
        <td>${m.active ? '<span class="badge badge--active">Aktif</span>' : '<span class="badge">Nonaktif</span>'}</td>
        <td class="num"><button class="linkbtn" data-edit="${i}">Ubah</button></td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty">Belum ada model. Tambahkan di atas.</td></tr>`;
}
const mf = $("#modelForm");
$("#modelRows").addEventListener("click", (e) => {
  const b = e.target.closest("[data-edit]");
  if (!b) return;
  const m = models[b.dataset.edit];
  for (const [k, v] of Object.entries(m)) {
    const el = mf.elements[k];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  }
  mf.elements.id.readOnly = true;
  $("#modelFormTitle").textContent = `Ubah model ${m.id}`;
  mf.scrollIntoView({ behavior: "smooth", block: "start" });
});
function resetModelForm() {
  mf.reset();
  mf.elements.id.readOnly = false;
  $("#modelFormTitle").textContent = "Tambah model";
}
$("#modelReset").addEventListener("click", resetModelForm);
bindForm(mf, async (d) => {
  const id = d.id.trim();
  if (!id) throw new Error("ID publik wajib diisi");
  await api("PUT", `/admin/models/${encodeURIComponent(id)}`, {
    upstream_model: d.upstream_model, display_name: d.display_name, vendor: d.vendor, context_label: d.context_label,
    input_price_rp: Number(d.input_price_rp), output_price_rp: Number(d.output_price_rp), tag: d.tag,
    sort_order: Number(d.sort_order || 100), active: d.active === "1",
  });
  toast(`Model ${id} disimpan`);
  resetModelForm();
  loadModels();
});

// ---------- User ----------
async function loadUsers(q = "") {
  const { users } = await api("GET", `/admin/users?q=${encodeURIComponent(q)}`);
  $("#userRows").innerHTML = users.length
    ? users.map((u) => `<tr>
        <td><b>${esc(u.name)}</b> ${u.role === "admin" ? '<span class="badge badge--admin">admin</span>' : ""}<br><span class="small muted">${esc(u.email)}</span></td>
        <td class="small">${dateTime(u.created_at)}</td>
        <td class="small">${dateTime(u.last_used_at)}</td>
        <td class="num">${rupiahMilli(u.balance_milli)}</td>
        <td><span class="badge badge--${u.status}">${u.status === "active" ? "Aktif" : "Suspend"}</span></td>
        <td class="num">
          <button class="linkbtn" data-adjust="${u.id}" data-email="${esc(u.email)}">Saldo ±</button> ·
          <button class="linkbtn linkbtn--danger" data-status="${u.id}" data-to="${u.status === "active" ? "suspended" : "active"}" data-email="${esc(u.email)}">${u.status === "active" ? "Suspend" : "Aktifkan"}</button>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty">Tidak ada user.</td></tr>`;
}
bindForm($("#userSearch"), (d) => loadUsers(d.q));
$("#userRows").addEventListener("click", async (e) => {
  const adj = e.target.closest("[data-adjust]");
  const st = e.target.closest("[data-status]");
  try {
    if (adj) {
      const amount = prompt(`Koreksi saldo ${adj.dataset.email} (Rupiah, pakai minus untuk mengurangi):`, "10000");
      if (!amount) return;
      const note = prompt("Catatan (wajib, tercatat di riwayat):", "Kompensasi");
      if (!note) return;
      await api("POST", `/admin/users/${adj.dataset.adjust}/adjust`, { amount_rp: Number(amount.replace(/[^\d-]/g, "")), note });
      toast("Saldo diperbarui");
    } else if (st) {
      if (!confirm(`${st.dataset.to === "suspended" ? "Suspend" : "Aktifkan"} ${st.dataset.email}?`)) return;
      await api("POST", `/admin/users/${st.dataset.status}/status`, { status: st.dataset.to });
      toast("Status diperbarui");
    } else return;
    loadUsers($("#userSearch").elements.q.value);
  } catch (err) { toast(err.message, "err"); }
});

// ---------- Pembayaran ----------
const STATUS = { paid: "Lunas", pending: "Menunggu", failed: "Gagal", expired: "Kedaluwarsa" };
async function loadPayments() {
  const { payments } = await api("GET", "/admin/payments");
  $("#payRows").innerHTML = payments.length
    ? payments.map((p) => `<tr>
        <td class="mono small">${esc(p.order_id)}</td>
        <td class="small">${esc(p.email)}</td>
        <td class="small">${dateTime(p.created_at)}</td>
        <td class="small">${esc(p.method || "—")}</td>
        <td class="num">${rupiah(p.amount_rp)}</td>
        <td><span class="badge badge--${esc(p.status)}">${STATUS[p.status] || esc(p.status)}</span></td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty">Belum ada pembayaran.</td></tr>`;
}

openTab(loaders[location.hash.slice(1)] ? location.hash.slice(1) : "overview");
