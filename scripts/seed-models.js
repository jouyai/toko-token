// Isi tabel models dengan contoh awal (tidak menimpa model yang sudah ada).
// Setelah itu atur mapping & harga lewat halaman /admin — di sana ada daftar
// model yang benar-benar tersedia di 9router kamu.
import { pool } from "../src/db.js";
import { migrate } from "../src/migrate.js";

// upstream_model = nama model / combo persis seperti di dashboard 9router.
const models = [
  { id: "glm-5.1", upstream_model: "glm/glm-5.1", display_name: "GLM 5.1", vendor: "Zhipu", context_label: "128K", input_price_rp: 12000, output_price_rp: 40000, tag: "Populer", sort_order: 10 },
  { id: "deepseek-chat", upstream_model: "deepseek/deepseek-chat", display_name: "DeepSeek V3", vendor: "DeepSeek", context_label: "128K", input_price_rp: 5000, output_price_rp: 18000, tag: "Hemat", sort_order: 20 },
  { id: "kimi-k2", upstream_model: "kimi/kimi-k2", display_name: "Kimi K2", vendor: "Moonshot", context_label: "128K", input_price_rp: 10000, output_price_rp: 40000, tag: "", sort_order: 30 },
];

await migrate({ log: () => {} });
for (const m of models) {
  const { rowCount } = await pool.query(
    `INSERT INTO models (id, upstream_model, display_name, vendor, context_label, input_price_rp, output_price_rp, tag, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
    [m.id, m.upstream_model, m.display_name, m.vendor, m.context_label, m.input_price_rp, m.output_price_rp, m.tag, m.sort_order]
  );
  console.log(`${rowCount ? "ditambahkan" : "sudah ada "}  ${m.id} -> ${m.upstream_model}`);
}
await pool.end();
