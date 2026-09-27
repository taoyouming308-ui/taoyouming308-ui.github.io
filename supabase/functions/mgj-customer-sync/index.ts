// Private Hermes integration. No caller-supplied REST paths, SQL, or table names.
const PUBLIC_KEY_BASE64 = "34z6MEMWkfaGzTXGG7YWZaW5UCdiIbU3IfyEsiyF5to=";
const URL_ROOT = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SHOPS = ["自由手艺人", "向里造型"];
const PROFILE_FIELDS = ["phone", "name", "shop_name", "barber_name", "total_visits", "total_consumption", "last_visit_date", "card_packages", "service_history", "notes", "last_updated"];
const PROFILE_SELECT = "id," + PROFILE_FIELDS.join(",");
type Row = Record<string, unknown>;
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), c => c.charCodeAt(0));
}
async function authenticated(request: Request, body: Uint8Array): Promise<boolean> {
  const ts = request.headers.get("x-customer-sync-ts") || "";
  const sig = request.headers.get("x-customer-sync-signature") || "";
  if (!/^\d{10}$/.test(ts) || !/^[\w-]{86}$/.test(sig) || Math.abs(Date.now() - Number(ts) * 1000) > 120_000) return false;
  const key = await crypto.subtle.importKey("raw", bytes(PUBLIC_KEY_BASE64), { name: "Ed25519" }, false, ["verify"]);
  const prefix = new TextEncoder().encode(`mgj-customer-sync\n${ts}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix); signed.set(body, prefix.length);
  return crypto.subtle.verify("Ed25519", key, bytes(sig), signed);
}
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_request");
  return value as Row;
}
function phone(value: unknown): string {
  if (typeof value !== "string" || !/^\+?\d{7,20}$/.test(value)) throw new Error("invalid_phone");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("invalid_number");
  return value;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid_date");
  const d = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value) throw new Error("invalid_date");
  return value;
}
function fields(p: Row, allowed: string[]) {
  if (Object.keys(p).some(k => !allowed.includes(k))) throw new Error("invalid_field");
}
const profileScope = 'or=(shop_name.in.("自由手艺人","向里造型"),shop_name.is.null,shop_name.eq.)';
async function rest(path: string, init: RequestInit = {}) {
  const result = await fetch(`${URL_ROOT}/rest/v1/${path}`, {
    ...init, signal: AbortSignal.timeout(20_000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!result.ok) throw new Error("database_unavailable");
  return result;
}
function validateProfile(value: unknown): Row {
  const row = object(value); fields(row, PROFILE_FIELDS);
  phone(row.phone);
  if (!SHOPS.includes(String(row.shop_name))) throw new Error("invalid_shop");
  for (const k of ["name", "barber_name", "notes", "last_updated"]) {
    if (typeof row[k] !== "string" || String(row[k]).length > 20_000) throw new Error("invalid_profile");
  }
  if (row.last_visit_date !== null && (typeof row.last_visit_date !== "string" || row.last_visit_date.length > 30)) throw new Error("invalid_profile");
  integer(row.total_visits, 0, 10_000_000);
  if (typeof row.total_consumption !== "number" || !Number.isFinite(row.total_consumption) || row.total_consumption < 0) throw new Error("invalid_profile");
  for (const k of ["card_packages", "service_history"]) {
    if (!Array.isArray(row[k]) || row[k].length > 1000) throw new Error("invalid_profile");
    for (const item of row[k]) object(item);
  }
  return row;
}
async function handle(p: Row) {
  switch (p.operation) {
    case "booking_phones": {
      fields(p, ["operation", "start", "end", "end_inclusive", "limit"]);
      const start = date(p.start), end = date(p.end);
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const offset = (d: string) => (+new Date(d) - +new Date(today)) / 86400_000;
      if (start > end || offset(start) < -90 || offset(end) > 7 || typeof p.end_inclusive !== "boolean") throw new Error("invalid_date_range");
      const limit = integer(p.limit, 1, 1000);
      const r = await rest(`bookings?select=customer_phone&shop_id=in.(1009951,1837032)&date=gte.${start}&date=${p.end_inclusive ? "lte" : "lt"}.${end}&order=id.asc&limit=${limit}`);
      return { rows: await r.json() };
    }
    case "profile_read": {
      fields(p, ["operation", "phone"]);
      const r = await rest(`customer_profiles?select=${PROFILE_SELECT}&phone=eq.${encodeURIComponent(phone(p.phone))}&${profileScope}&limit=1`);
      return { rows: await r.json() };
    }
    case "profile_scan": {
      fields(p, ["operation", "cursor", "limit"]);
      const cursor = integer(p.cursor, 0, Number.MAX_SAFE_INTEGER), limit = integer(p.limit, 1, 500);
      const r = await rest(`customer_profiles?select=${PROFILE_SELECT}&id=gt.${cursor}&${profileScope}&order=id.asc&limit=${limit}`);
      return { rows: await r.json() };
    }
    case "profile_write": {
      fields(p, ["operation", "phone", "profile", "create"]);
      const key = phone(p.phone), row = validateProfile(p.profile);
      if (row.phone !== key || typeof p.create !== "boolean") throw new Error("invalid_profile_identity");
      // Exact phone writes only; never update another store's existing master.
      const existing = await (await rest(`customer_profiles?select=shop_name&phone=eq.${encodeURIComponent(key)}&limit=2`)).json();
      if (!Array.isArray(existing) || existing.length > 1 || existing.some((r: Row) => r.shop_name && !SHOPS.includes(String(r.shop_name)))) throw new Error("invalid_profile_scope");
      if (p.create && existing.length) throw new Error("profile_changed");
      if (!p.create && existing.length !== 1) throw new Error("profile_changed");
      const r = p.create
        ? await rest("customer_profiles", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) })
        : await rest(`customer_profiles?phone=eq.${encodeURIComponent(key)}&${profileScope}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
      const written = await r.json();
      if (!Array.isArray(written) || written.length !== 1 || written[0].phone !== key) throw new Error("database_unavailable");
      return { written: 1 };
    }
    default: throw new Error("invalid_operation");
  }
}
Deno.serve(async request => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!URL_ROOT || !SERVICE_KEY) return json({ error: "service_unavailable" }, 503);
  try {
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length > 2_000_000 || !await authenticated(request, body)) return json({ error: "unauthorized" }, 401);
    return json(await handle(object(JSON.parse(new TextDecoder().decode(body)))));
  } catch (e) {
    const message = e instanceof Error ? e.message : "invalid_request";
    if (message === "profile_changed") return json({ error: message }, 409);
    if (message === "database_unavailable" || e instanceof DOMException) return json({ error: "database_unavailable" }, 502);
    return json({ error: "invalid_request" }, 400);
  }
});
