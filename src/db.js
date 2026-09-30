import pg from "pg";
import { config } from "./config.js";

// BIGINT (int8) dikembalikan sebagai Number. Aman karena saldo dalam milli-rupiah
// masih jauh di bawah Number.MAX_SAFE_INTEGER (~9 kuadriliun).
pg.types.setTypeParser(20, (v) => Number(v));

// Di Vercel (serverless) tiap instance cukup beberapa koneksi, dan koneksi idle cepat ditutup.
// Pakai connection string "pooled" dari Neon/Supabase.
const serverless = !!process.env.VERCEL;
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX || (serverless ? 3 : 10)),
  idleTimeoutMillis: serverless ? 5_000 : 30_000,
  connectionTimeoutMillis: 10_000,
});
pool.on("error", (err) => console.error("[db] koneksi idle error:", err.message));

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
