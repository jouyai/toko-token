// Layar LCD 7-segmen (SVG) dengan animasi hitung.
const H = (y) => `9,${y} 12,${y - 3} 28,${y - 3} 31,${y} 28,${y + 3} 12,${y + 3}`;
const V = (x, y1, y2) => `${x},${y1} ${x + 3},${y1 + 3} ${x + 3},${y2 - 3} ${x},${y2} ${x - 3},${y2 - 3} ${x - 3},${y1 + 3}`;
const SEGS = { a: H(4), b: V(34, 6, 34), c: V(34, 36, 64), d: H(66), e: V(6, 36, 64), f: V(6, 6, 34), g: H(35) };
const DIGITS = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg", E: "afged", "-": "g", " ": "" };
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createLCD(container, { slots = 9, onBusy } = {}) {
  const slotEls = [];
  const seps = [];
  container.textContent = "";
  for (let i = 0; i < slots; i++) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 -1 40 72");
    svg.setAttribute("class", "seg");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = `<g transform="skewX(-6) translate(4 0)">${Object.entries(SEGS)
      .map(([k, p]) => `<polygon data-s="${k}" points="${p}"/>`)
      .join("")}</g>`;
    container.appendChild(svg);
    slotEls.push(svg);
    // Titik ribuan setiap 3 digit dari kanan.
    const fromRight = slots - 1 - i;
    if (fromRight > 0 && fromRight % 3 === 0) {
      const sep = document.createElement("span");
      sep.className = "seg-sep";
      container.appendChild(sep);
      seps.push({ el: sep, index: i });
    }
  }

  let shown = 0;
  let raf;

  function draw(value) {
    let s = String(Math.round(value));
    if (s.length > slots) s = "E".padStart(slots, " ");
    s = s.padStart(slots, " ");
    slotEls.forEach((svg, i) => {
      const on = DIGITS[s[i]] ?? "";
      svg.querySelectorAll("polygon").forEach((p) => p.classList.toggle("on", on.includes(p.dataset.s)));
    });
    seps.forEach(({ el, index }) => (el.style.opacity = s[index] !== " " && s[index] !== "-" ? 1 : 0.1));
    container.setAttribute("aria-label", Math.round(value).toLocaleString("id-ID"));
  }

  function set(target) {
    cancelAnimationFrame(raf);
    if (reduceMotion) {
      shown = target;
      return draw(target);
    }
    const from = shown;
    const t0 = performance.now();
    onBusy?.(true);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 650);
      shown = from + (target - from) * (1 - Math.pow(1 - k, 3));
      draw(shown);
      if (k < 1) raf = requestAnimationFrame(step);
      else onBusy?.(false);
    };
    raf = requestAnimationFrame(step);
  }

  draw(0);
  return { set };
}
