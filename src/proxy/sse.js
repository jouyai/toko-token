// Mengolah stream SSE dari 9router baris per baris:
//  - mengganti nama model upstream dengan nama model publik,
//  - mengambil `usage` untuk penagihan,
//  - menghitung panjang teks keluaran sebagai cadangan estimasi,
//  - membuang data usage kalau pembeli tidak memintanya (perilaku standar OpenAI).
export class SseTransformer {
  constructor({ publicModel, clientWantsUsage }) {
    this.publicModel = publicModel;
    this.clientWantsUsage = clientWantsUsage;
    this.buffer = "";
    this.usage = null;
    this.outputChars = 0;
  }

  // Terima potongan teks, kembalikan teks yang siap diteruskan ke pembeli.
  push(text) {
    this.buffer += text;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop();
    return lines.map((l) => this.line(l)).filter((l) => l !== null).map((l) => l + "\n").join("");
  }

  flush() {
    const rest = this.buffer;
    this.buffer = "";
    if (!rest) return "";
    const out = this.line(rest);
    return out === null ? "" : out;
  }

  line(raw) {
    const l = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!l.startsWith("data:")) return l;
    const payload = l.slice(5).trimStart();
    if (payload === "[DONE]") return l;
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      return l;
    }
    if (obj && typeof obj === "object") {
      if (obj.usage) this.usage = obj.usage;
      for (const ch of obj.choices || []) {
        const d = ch.delta || {};
        if (typeof d.content === "string") this.outputChars += d.content.length;
        if (typeof d.reasoning_content === "string") this.outputChars += d.reasoning_content.length;
        for (const tc of d.tool_calls || []) this.outputChars += (tc.function?.arguments || "").length + (tc.function?.name || "").length;
      }
      if ("model" in obj) obj.model = this.publicModel;
      if (!this.clientWantsUsage) {
        if (Array.isArray(obj.choices) && obj.choices.length === 0 && obj.usage) return null;
        delete obj.usage;
      }
    }
    return "data: " + JSON.stringify(obj);
  }
}

// Panjang teks keluaran dari respons non-streaming (untuk estimasi cadangan).
export function outputCharsOf(json) {
  let n = 0;
  for (const ch of json?.choices || []) {
    const m = ch.message || {};
    if (typeof m.content === "string") n += m.content.length;
    if (typeof m.reasoning_content === "string") n += m.reasoning_content.length;
    for (const tc of m.tool_calls || []) n += (tc.function?.arguments || "").length;
  }
  return n;
}
