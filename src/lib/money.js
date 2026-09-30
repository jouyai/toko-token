// Uang internal = milli-rupiah (integer). Harga model = Rupiah per 1 juta token.

export const rpToMilli = (rp) => Math.round(rp * 1000);
export const milliToRp = (milli) => milli / 1000;

// Rp/1M token × token = milli-rupiah: (token × harga × 1000) / 1_000_000 = token × harga / 1000.
// Dibulatkan ke atas per komponen supaya tidak pernah menagih kurang.
export function costMilli(model, promptTokens, completionTokens) {
  const input = Math.ceil((promptTokens * model.input_price_rp) / 1000);
  const output = Math.ceil((completionTokens * model.output_price_rp) / 1000);
  return input + output;
}

// Berapa token output yang masih kebeli dengan sisa saldo.
export function affordableOutputTokens(model, balanceMilli) {
  if (model.output_price_rp <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.floor((balanceMilli * 1000) / model.output_price_rp);
}

// Estimasi kasar (dipakai hanya kalau 9router tidak mengirim `usage`).
// Pakai 3 karakter/token supaya cenderung sedikit lebih tinggi daripada aktual.
export const estimateTokens = (chars) => Math.ceil(chars / 3);

export const formatRp = (milli) =>
  "Rp" + (milli / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 });
