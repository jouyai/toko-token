import { $, api, bindForm, me, safeNext } from "./api.js";

const page = document.body.dataset.page;
const params = new URLSearchParams(location.search);
const form = $("#form");

// Setelah masuk/daftar: lanjut ke halaman tujuan (mis. top up dari landing).
const topup = Number(params.get("topup")) || 0;
const next = safeNext(params.get("next"), topup ? `/dashboard?topup=${topup}` : "/dashboard");

// Bawa parameter yang sama saat pindah antara halaman masuk & daftar.
for (const id of ["toRegister", "toLogin"]) {
  const a = $("#" + id);
  if (a && location.search) a.href += location.search;
}

if (page === "login" || page === "register") {
  const user = await me();
  if (user) location.replace(next);
}

bindForm(form, async (data) => {
  if (page === "login") {
    await api("POST", "/auth/login", { email: data.email, password: data.password });
    location.href = next;
  } else if (page === "register") {
    await api("POST", "/auth/register", { name: data.name, email: data.email, password: data.password, agree: data.agree === "1" });
    location.href = next;
  } else if (page === "forgot") {
    await api("POST", "/auth/forgot", { email: data.email });
    form.hidden = true;
    $("#done").hidden = false;
  } else if (page === "reset") {
    if (data.password !== data.password2) throw new Error("Password tidak sama");
    const token = params.get("token");
    if (!token) throw new Error("Link reset tidak valid. Minta link baru.");
    await api("POST", "/auth/reset", { token, password: data.password });
    form.hidden = true;
    $("#done").hidden = false;
  }
});
