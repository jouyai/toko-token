import { config } from "../config.js";

const headers = () => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  ...(config.router.apiKey ? { Authorization: `Bearer ${config.router.apiKey}` } : {}),
});

export function chatCompletions(body, signal) {
  return fetch(`${config.router.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
}

export async function listUpstreamModels() {
  const res = await fetch(`${config.router.baseUrl}/models`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m) => m.id).sort();
}
