(() => {
  const cfg = window.TOKO_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const rupiah = (n) => "Rp" + Math.round(n).toLocaleString("id-ID");
  const num = (n) => Math.round(n).toLocaleString("id-ID");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = { model: cfg.models[0], rp: cfg.nominals[0], shown: 0 };

  // ---------- Ticker ----------
  const tickerHTML = cfg.models
    .map((m) => `<span class="ticker__item">${m.name.toUpperCase()} <b>▲ ${rupiah(m.input)}</b> /1M</span>`)
    .join("");
  $("#ticker").innerHTML = tickerHTML.repeat(4);

  // ---------- 7-segment LCD ----------
  const H = (y) => `9,${y} 12,${y - 3} 28,${y - 3} 31,${y} 28,${y + 3} 12,${y + 3}`;
  const V = (x, y1, y2) => `${x},${y1} ${x + 3},${y1 + 3} ${x + 3},${y2 - 3} ${x},${y2} ${x - 3},${y2 - 3} ${x - 3},${y1 + 3}`;
  const SEGS = { a: H(4), b: V(34, 6, 34), c: V(34, 36, 64), d: H(66), e: V(6, 36, 64), f: V(6, 6, 34), g: H(35) };
  const DIGITS = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg", E: "afged", " ": "" };
  const SLOTS = 9;
  const lcd = $("#lcdDigits");
  const slotEls = [];
  const sepEls = [];
  for (let i = 0; i < SLOTS; i++) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 -1 40 72");
    svg.setAttribute("class", "seg");
    svg.innerHTML = `<g transform="skewX(-6) translate(4 0)">${Object.entries(SEGS)
      .map(([k, p]) => `<polygon data-s="${k}" points="${p}"/>`)
      .join("")}</g>`;
    lcd.appendChild(svg);
    slotEls.push(svg);
    if (i === 2 || i === 5) {
      const sep = document.createElement("span");
      sep.className = "seg-sep";
      lcd.appendChild(sep);
      sepEls.push(sep);
    }
  }
  function drawLCD(value) {
    let s = String(Math.round(value));
    if (s.length > SLOTS) s = "E".padStart(SLOTS, " ");
    s = s.padStart(SLOTS, " ");
    slotEls.forEach((svg, i) => {
      const on = DIGITS[s[i]] ?? "";
      svg.querySelectorAll("polygon").forEach((p) => p.classList.toggle("on", on.includes(p.dataset.s)));
    });
    // titik ribuan hanya muncul kalau ada angka di kiri
    sepEls[0].style.opacity = s[2] !== " " ? 1 : 0.1;
    sepEls[1].style.opacity = s[5] !== " " ? 1 : 0.1;
  }

  let raf;
  function animateTo(target) {
    cancelAnimationFrame(raf);
    const from = state.shown;
    const led = $("#led");
    if (reduceMotion) { state.shown = target; drawLCD(target); return; }
    led.classList.add("is-busy");
    const t0 = performance.now();
    const dur = 650;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      state.shown = from + (target - from) * e;
      drawLCD(state.shown);
      if (k < 1) raf = requestAnimationFrame(step);
      else led.classList.remove("is-busy");
    };
    raf = requestAnimationFrame(step);
  }

  const tokensFor = (rp, m) => (rp / m.input) * 1_000_000;

  function update() {
    const m = state.model;
    $("#lcdModel").textContent = m.name;
    $("#lcdRate").textContent = `${rupiah(m.input)}/1M`;
    $("#lcdRp").textContent = rupiah(state.rp);
    animateTo(tokensFor(state.rp, m));
    if (typeof showTab === "function") showTab(currentTab);
  }

  // ---------- Model select ----------
  const sel = $("#modelSelect");
  sel.innerHTML = cfg.models.map((m, i) => `<option value="${i}">${m.name} — ${m.vendor}</option>`).join("");
  sel.addEventListener("change", () => { state.model = cfg.models[sel.value]; update(); });

  // ---------- Keypad ----------
  const keypad = $("#keypad");
  keypad.innerHTML = cfg.nominals
    .map((n) => `<button class="key" data-rp="${n}">${n >= 1000 ? n / 1000 + "rb" : n}<small>RUPIAH</small></button>`)
    .join("");
  const setActiveKey = () =>
    keypad.querySelectorAll(".key").forEach((k) => k.classList.toggle("is-active", +k.dataset.rp === state.rp));
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
    if (raw >= cfg.minNominal) { state.rp = raw; setActiveKey(); update(); }
  });

  // ---------- Papan harga (split-flap) ----------
  const FLAP_CHARS = "0123456789";
  const flap = (text, label) =>
    `<span class="flap" data-label="${label}" data-final="${text}">${[...text]
      .map((c) => `<i class="${/\d/.test(c) ? "" : "sep"}">${c}</i>`)
      .join("")}</span>`;
  $("#boardRows").innerHTML = cfg.models
    .map(
      (m, i) => `
    <div class="board__row" role="row">
      <span class="m-name" role="cell">${m.name}${m.tag ? `<span class="m-tag">${m.tag}</span>` : ""}<span class="m-vendor">${m.vendor} · ${m.id}</span></span>
      <span class="m-ctx" role="cell">${m.ctx}</span>
      <span role="cell">${flap(num(m.input), "IN")}</span>
      <span role="cell">${flap(num(m.output), "OUT")}</span>
      <button class="pick" data-i="${i}">Pilih →</button>
    </div>`
    )
    .join("");

  function spinFlaps(root) {
    if (reduceMotion) return;
    root.querySelectorAll(".flap i:not(.sep)").forEach((cell, idx) => {
      const final = cell.textContent;
      let n = 0;
      const max = 8 + (idx % 7) * 2;
      const iv = setInterval(() => {
        cell.textContent = n++ >= max ? final : FLAP_CHARS[(Math.random() * 10) | 0];
        if (n > max) clearInterval(iv);
      }, 55);
    });
  }

  $("#boardRows").addEventListener("click", (e) => {
    const b = e.target.closest(".pick");
    if (!b) return;
    sel.value = b.dataset.i;
    state.model = cfg.models[b.dataset.i];
    update();
    $("#meter").scrollIntoView({ behavior: "smooth" });
  });

  // ---------- Kode developer ----------
  let currentTab = "curl";
  const snippets = () => ({
    curl: `<span class="c"># Cek sisa token di header: x-toko-saldo</span>
curl ${cfg.apiBaseUrl}/chat/completions \\
  -H <span class="s">"Authorization: Bearer $TOKO_KEY"</span> \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{
    "model": "${state.model.id}",
    "messages": [{"role": "user", "content": "Halo!"}]
  }'</span>`,
    py: `<span class="k">from</span> openai <span class="k">import</span> OpenAI

client = OpenAI(
    base_url=<span class="s">"${cfg.apiBaseUrl}"</span>,
    api_key=<span class="s">"tt_live_xxxxxxxx"</span>,
)

res = client.chat.completions.create(
    model=<span class="s">"${state.model.id}"</span>,
    messages=[{<span class="s">"role"</span>: <span class="s">"user"</span>, <span class="s">"content"</span>: <span class="s">"Halo!"</span>}],
)
print(res.choices[0].message.content)`,
    js: `<span class="k">import</span> OpenAI <span class="k">from</span> <span class="s">"openai"</span>;

<span class="k">const</span> client = <span class="k">new</span> OpenAI({
  baseURL: <span class="s">"${cfg.apiBaseUrl}"</span>,
  apiKey: process.env.TOKO_KEY,
});

<span class="k">const</span> res = <span class="k">await</span> client.chat.completions.create({
  model: <span class="s">"${state.model.id}"</span>,
  messages: [{ role: <span class="s">"user"</span>, content: <span class="s">"Halo!"</span> }],
});
console.log(res.choices[0].message.content);`,
  });
  const code = $("#code");
  function showTab(t) {
    currentTab = t;
    code.innerHTML = snippets()[t];
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === t));
  }
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  showTab("curl");

  // ---------- Struk / checkout (demo) ----------
  const overlay = $("#overlay");
  const randDigits = (n) => Array.from({ length: n }, () => (Math.random() * 10) | 0).join("");

  function drawQR(seed) {
    const N = 21;
    let x = [...seed].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const finder = (r, c) => {
      for (const [fr, fc] of [[0, 0], [0, N - 7], [N - 7, 0]]) {
        const rr = r - fr, cc = c - fc;
        if (rr >= 0 && rr < 7 && cc >= 0 && cc < 7) {
          const ring = Math.min(rr, cc, 6 - rr, 6 - cc);
          return ring !== 1;
        }
        if (rr >= -1 && rr <= 7 && cc >= -1 && cc <= 7) return false;
      }
      return null;
    };
    let html = "";
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const f = finder(r, c);
        html += `<i class="${(f ?? rnd() > 0.5) ? "" : "w"}"></i>`;
      }
    $("#qris").innerHTML = html;
  }

  let lastFocus;
  $("#buyBtn").addEventListener("click", () => {
    const m = state.model;
    const code = randDigits(20).replace(/(\d{4})(?=\d)/g, "$1 ");
    $("#rcDate").textContent = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) + " WIB";
    $("#rcModel").textContent = m.name;
    $("#rcRp").textContent = rupiah(state.rp);
    $("#rcRate").textContent = `${rupiah(m.input)}/1M`;
    $("#rcTokens").textContent = num(tokensFor(state.rp, m));
    $("#rcCode").textContent = code;
    drawQR(code);
    // restart animasi cetak
    const rc = $("#receipt");
    rc.style.animation = "none";
    void rc.offsetWidth;
    rc.style.animation = "";
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    $("#copyBtn").focus({ preventScroll: true });
  });

  const close = () => {
    overlay.hidden = true;
    document.body.style.overflow = "";
    lastFocus?.focus();
  };
  $("#closeBtn").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) close(); });
  $("#copyBtn").addEventListener("click", async () => {
    const btn = $("#copyBtn");
    try {
      await navigator.clipboard.writeText($("#rcCode").textContent.replace(/\s/g, ""));
      btn.textContent = "Tersalin ✓";
    } catch {
      btn.textContent = "Gagal menyalin";
    }
    setTimeout(() => (btn.textContent = "Salin Kode"), 1600);
  });

  // ---------- Reveal on scroll ----------
  const targets = document.querySelectorAll(".section-head, .step, .board, .code, .faq__list");
  targets.forEach((el) => el.classList.add("reveal"));
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-in");
        if (en.target.classList.contains("board")) spinFlaps(en.target);
        io.unobserve(en.target);
      }),
    { threshold: 0.15 }
  );
  targets.forEach((el) => io.observe(el));

  $("#year").textContent = new Date().getFullYear();
  setActiveKey();
  update();
})();
