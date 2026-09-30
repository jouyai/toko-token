// Helper bersama untuk semua halaman.

export async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "x-toko-csrf": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Terjadi kesalahan (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Selalu escape data dari server/user sebelum masuk innerHTML.
export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const rupiah = (rp) => "Rp" + Math.round(rp).toLocaleString("id-ID");
export const rupiahMilli = (milli, digits = 0) =>
  (milli < 0 ? "-" : "") + "Rp" + (Math.abs(milli) / 1000).toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) });
export const num = (n) => Math.round(n).toLocaleString("id-ID");
export const compact = (n) => new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const dateTime = (d) => (d ? new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—");

export const me = () => api("GET", "/auth/me").then((d) => d.user).catch(() => null);

export async function copy(text, btn) {
  const old = btn?.textContent;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) btn.textContent = "Tersalin ✓";
  } catch {
    if (btn) btn.textContent = "Gagal menyalin";
  }
  if (btn) setTimeout(() => (btn.textContent = old), 1500);
}

export function toast(msg, kind = "ok") {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast toast--${kind} is-show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("is-show"), 3200);
}

// Form helper: kirim data, tampilkan error di elemen .form-error.
export function bindForm(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const errEl = form.querySelector(".form-error");
    if (errEl) errEl.textContent = "";
    btn && (btn.disabled = true);
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      else toast(err.message, "err");
    } finally {
      btn && (btn.disabled = false);
    }
  });
}

// Hanya izinkan redirect ke path lokal.
export const safeNext = (v, fallback = "/dashboard") => (v && /^\/(?!\/)/.test(v) ? v : fallback);
