import { test } from "node:test";
import assert from "node:assert/strict";
import { SseTransformer } from "../src/proxy/sse.js";
import { decodeToolId, encodeToolId } from "../src/proxy/sanitize.js";
import { publicIdFor } from "../src/routes/admin.js";
import { affordableOutputTokens, costMilli } from "../src/lib/money.js";

test("costMilli membulatkan ke atas dan tidak pernah kurang", () => {
  const m = { input_price_rp: 5000, output_price_rp: 18000 };
  assert.equal(costMilli(m, 1_000_000, 0), 5_000_000); // Rp5.000
  assert.equal(costMilli(m, 1, 0), 5); // Rp0,005
  assert.equal(costMilli(m, 0, 1), 18);
  assert.equal(costMilli({ input_price_rp: 3333, output_price_rp: 0 }, 1, 0), 4); // 3,333 -> 4
});

test("affordableOutputTokens", () => {
  assert.equal(affordableOutputTokens({ output_price_rp: 40000 }, 1000), 25); // Rp1 / Rp0,04
});

test("SseTransformer: potongan terbelah, ganti model, ambil usage", () => {
  const t = new SseTransformer({ id: "chatcmpl-x", publicModel: "pub", clientWantsUsage: false });
  const ev = (o) => `data: ${JSON.stringify(o)}\n\n`;
  const all =
    ev({ model: "up/x", choices: [{ delta: { content: "Halo" } }] }) +
    ev({ model: "up/x", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }) +
    "data: [DONE]\n\n";
  let out = "";
  for (let i = 0; i < all.length; i += 7) out += t.push(all.slice(i, i + 7));
  out += t.flush();
  assert.equal(t.usage.prompt_tokens, 3);
  assert.equal(t.outputChars, 4);
  assert.match(out, /"model":"pub"/);
  assert.doesNotMatch(out, /up\/x|usage/);
  assert.match(out, /\[DONE\]/);
});

test("id tool call bisa bolak-balik dan tidak menampakkan aslinya", () => {
  const enc = encodeToolId("toolu_01ABC");
  assert.match(enc, /^call_tt/);
  assert.doesNotMatch(enc, /toolu/);
  assert.equal(decodeToolId(enc), "toolu_01ABC");
  assert.equal(encodeToolId("toolu_01ABC"), enc); // deterministik
  assert.equal(decodeToolId("call_biasa"), "call_biasa");
});

test("publicIdFor membuang prefix router/provider", () => {
  assert.equal(publicIdFor("cc/claude-sonnet-4.5"), "claude-sonnet-4.5");
  assert.equal(publicIdFor("openrouter/meta-llama/Llama 3.3 70B"), "llama-3.3-70b");
  assert.equal(publicIdFor("combo-hemat"), "combo-hemat");
});
