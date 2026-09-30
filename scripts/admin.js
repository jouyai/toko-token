// CLI admin.
//   npm run admin -- promote email@contoh.com        jadikan admin
//   npm run admin -- credit email@contoh.com 50000 "catatan"   tambah saldo (Rp)
import { pool, tx, one } from "../src/db.js";
import { rpToMilli } from "../src/lib/money.js";

const [cmd, email, ...rest] = process.argv.slice(2);

async function run() {
  if (cmd === "promote" && email) {
    const u = await one("UPDATE users SET role = 'admin' WHERE lower(email) = lower($1) RETURNING email", [email]);
    if (!u) throw new Error(`User ${email} belum terdaftar. Daftar dulu lewat website.`);
    console.log(`${u.email} sekarang admin.`);
  } else if (cmd === "credit" && email && rest[0]) {
    const milli = rpToMilli(Number(rest[0]));
    if (!Number.isFinite(milli) || milli === 0) throw new Error("Nominal tidak valid");
    const bal = await tx(async (c) => {
      const u = await c.query("UPDATE users SET balance_milli = balance_milli + $2 WHERE lower(email) = lower($1) RETURNING id, balance_milli", [email, milli]);
      if (!u.rows[0]) throw new Error(`User ${email} tidak ditemukan`);
      await c.query(
        "INSERT INTO ledger (user_id, kind, amount_milli, balance_after_milli, note) VALUES ($1, 'adjustment', $2, $3, $4)",
        [u.rows[0].id, milli, u.rows[0].balance_milli, rest[1] || "Kredit manual (CLI)"]
      );
      return u.rows[0].balance_milli;
    });
    console.log(`Saldo ${email} sekarang Rp${(bal / 1000).toLocaleString("id-ID")}`);
  } else {
    console.log('Pemakaian:\n  npm run admin -- promote <email>\n  npm run admin -- credit <email> <rupiah> ["catatan"]');
    process.exitCode = 1;
  }
}

run()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
