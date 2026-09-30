// Rate limiter sliding-window di memori. Cukup untuk satu instance aplikasi;
// kalau nanti jalan lebih dari satu instance, ganti dengan Redis.
export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), windowMs).unref();
  }

  // Mengembalikan { ok, retryAfterSec }.
  take(key) {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return { ok: false, retryAfterSec: Math.ceil((this.windowMs - (now - arr[0])) / 1000) };
    }
    arr.push(now);
    this.hits.set(key, arr);
    return { ok: true, retryAfterSec: 0 };
  }

  sweep() {
    const now = Date.now();
    for (const [k, arr] of this.hits) {
      if (!arr.length || now - arr[arr.length - 1] >= this.windowMs) this.hits.delete(k);
    }
  }
}

export function limitByIp(limiter) {
  return (req, res, next) => {
    const r = limiter.take(req.ip);
    if (r.ok) return next();
    res.set("Retry-After", String(r.retryAfterSec));
    res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi sebentar lagi." });
  };
}
