// Signed source snapshots only. This endpoint cannot confirm or post financial reports.
const PUBLIC_KEY_BASE64 = "34z6MEMWkfaGzTXGG7YWZaW5UCdiIbU3IfyEsiyF5to=";
const URL_ROOT = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const COMPANY = "02463a53-dfdb-4291-b04d-dd1d85f9d998";
const STORES: Record<string, { id: string; source: string }> = {
  "自由手艺人": { id: "ea7e281f-a254-4664-bb03-cf1acf48d79d", source: "1009951" },
  "向里造型": { id: "8d057980-ff8f-4b2c-9c7f-4dd23a568f35", source: "1837032" },
};
const SCOPES: Record<string, string[]> = {
  projects_daily_summary: ["1"], all_business_daily_summary: ["1", "2", "3", "4", "5"],
};
const MAX_BYTES = 65536;
type Row = Record<string, unknown>;
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_request");
  return value as Row;
}
function exactKeys(value: Row, keys: string[]) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error("invalid_request");
  }
}
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")), c => c.charCodeAt(0));
}
async function authenticated(request: Request, body: Uint8Array): Promise<boolean> {
  const ts = request.headers.get("x-daily-report-sync-ts") || "";
  const sig = request.headers.get("x-daily-report-sync-signature") || "";
  if (!/^\d{10}$/.test(ts) || !/^[\w-]{86}$/.test(sig)
    || Math.abs(Date.now() - Number(ts) * 1000) > 120000) return false;
  const key = await crypto.subtle.importKey("raw", bytes(PUBLIC_KEY_BASE64), { name: "Ed25519" }, false, ["verify"]);
  const prefix = new TextEncoder().encode(`mgj-daily-report-sync\n${ts}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix); signed.set(body, prefix.length);
  return crypto.subtle.verify("Ed25519", key, bytes(sig), signed);
}
async function boundedBody(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  const parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error("too_large"); }
      parts.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function validate(p: Row): Row {
  exactKeys(p, ["operation", "shop", "date", "source_scope", "fetched_at", "source"]);
  if (p.operation !== "source_append" || typeof p.shop !== "string"
    || !Object.prototype.hasOwnProperty.call(STORES, p.shop)
    || typeof p.source_scope !== "string" || !Object.prototype.hasOwnProperty.call(SCOPES, p.source_scope)) {
    throw new Error("invalid_request");
  }
  const store = STORES[p.shop];
  const day = p.date;
  if (typeof day !== "string" || !/^2026-\d{2}-\d{2}$/.test(day)) throw new Error("invalid_request");
  const parsed = new Date(`${day}T00:00:00Z`);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== day || day > today) throw new Error("invalid_request");
  if (typeof p.fetched_at !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/.test(p.fetched_at)) throw new Error("invalid_request");
  const fetched = Date.parse(p.fetched_at);
  if (!Number.isFinite(fetched) || fetched > Date.now() + 10000 || fetched < Date.now() - 120000) throw new Error("invalid_request");
  const source = object(p.source);
  exactKeys(source, ["shop_id", "business_date", "query", "content"]);
  if (source.shop_id !== store.source || source.business_date !== day) throw new Error("invalid_request");
  const query = object(source.query);
  exactKeys(query, ["parentShopId", "shopId", "shopIds", "period", "incomeType", "depcode"]);
  if (String(query.parentShopId) !== "1103470" || !["1103470", "1009951", "1837032"].includes(String(query.shopId))
    || JSON.stringify(query.shopIds) !== JSON.stringify([store.source])
    || query.period !== `${+parsed}_${+parsed}` || query.depcode !== "-1"
    || JSON.stringify(query.incomeType) !== JSON.stringify(SCOPES[p.source_scope])) throw new Error("invalid_request");
  const content = object(source.content);
  exactKeys(content, ["head", "headTop", "data", "columns", "config"]);
  // Full table/amount checks and candidate generation are authoritative inside the DB transaction.
  if (!Array.isArray(content.data) || content.data.length !== 1
    || !Array.isArray(content.data[0]) || content.data[0].length !== 24
    || content.data[0][0] !== day) throw new Error("invalid_request");
  return { p_company_id: COMPANY, p_store_id: store.id, p_business_date: day,
    p_source_scope: p.source_scope, p_fetched_at: p.fetched_at, p_source: source };
}
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!URL_ROOT || !SERVICE_KEY) return json({ error: "service_unavailable" }, 503);
  try {
    const raw = await boundedBody(request);
    if (!await authenticated(request, raw)) return json({ error: "unauthorized" }, 401);
    const payload = object(JSON.parse(new TextDecoder().decode(raw)));
    const params = validate(payload);
    // One allowlisted RPC: no user-provided table, path, query, role or reviewer.
    const response = await fetch(`${URL_ROOT}/rest/v1/rpc/zysyr_ingest_daily_electronic_source`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!response.ok) return json({ error: "source_not_accepted", outcome: "unconfirmed" }, response.status >= 500 ? 502 : 409);
    const receipt = object(await response.json());
    if (receipt.formal_ledger_amount_changed !== false || receipt.stage !== "source_only"
      || receipt.status !== "needs_review" || receipt.scope_verified !== false
      || receipt.source_scope !== payload.source_scope || !/^[a-f0-9]{64}$/.test(String(receipt.source_sha256))) {
      return json({ error: "invalid_receipt", outcome: "unconfirmed" }, 502);
    }
    return json(receipt);
  } catch (e) {
    if (e instanceof Error && e.message === "too_large") return json({ error: "too_large" }, 413);
    if (e instanceof Error && e.message === "invalid_request") return json({ error: "invalid_request" }, 400);
    // Transport may have failed after commit. Never advertise a safe automatic retry.
    return json({ error: "request_failed", outcome: "unconfirmed" }, 502);
  }
});
