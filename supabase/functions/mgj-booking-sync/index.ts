import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// The matching private key exists only in the local Hermes runtime (mode 0600).
const PUBLIC_KEY_BASE64 = "34z6MEMWkfaGzTXGG7YWZaW5UCdiIbU3IfyEsiyF5to=";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SHOP_NAMES: Record<string, string> = {
  "1009951": "自由手艺人",
  "1837032": "向里造型",
};
const FIELDS = new Set([
  "id", "shop_id", "shop_name", "barber_name", "barber_id", "customer_name",
  "customer_phone", "service_name", "notes", "reservation_time", "time_label",
  "date", "status", "updated_at",
]);
type Booking = Record<string, unknown>;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function authenticate(request: Request, body: Uint8Array): Promise<boolean> {
  const timestamp = request.headers.get("x-booking-sync-ts") || "";
  const signature = request.headers.get("x-booking-sync-signature") || "";
  if (!/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 120_000) return false;
  const key = await crypto.subtle.importKey("raw", decodeBase64(PUBLIC_KEY_BASE64), { name: "Ed25519" }, false, ["verify"]);
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  return crypto.subtle.verify({ name: "Ed25519" }, key, decodeBase64(signature), signed);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validate(payload: unknown): { shop_id: string; date: string; bookings: Booking[] } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("无效的同步请求");
  const candidate = payload as Booking;
  const shopId = candidate.shop_id;
  const date = candidate.date;
  const bookings = candidate.bookings;
  if (typeof shopId !== "string" || !SHOP_NAMES[shopId] || !validDate(date) || !Array.isArray(bookings) || bookings.length > 500) {
    throw new Error("门店、日期或记录数无效");
  }
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const lastDate = new Date(`${today}T00:00:00Z`);
  lastDate.setUTCDate(lastDate.getUTCDate() + 7);
  if (date < today || date > lastDate.toISOString().slice(0, 10)) throw new Error("同步日期超出允许范围");
  const ids = new Set<number>();
  for (const value of bookings) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("预约格式错误");
    const row = value as Booking;
    if (Object.keys(row).some((field) => !FIELDS.has(field)) ||
      typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id) ||
      row.shop_id !== shopId || row.shop_name !== SHOP_NAMES[shopId] || row.date !== date ||
      typeof row.status !== "number" || !Number.isSafeInteger(row.status) || ![0, 1, 3, 4].includes(row.status) ||
      typeof row.reservation_time !== "number" || !Number.isSafeInteger(row.reservation_time) || row.reservation_time < 0) {
      throw new Error("预约 ID、门店、日期或状态无效");
    }
    for (const field of ["barber_name", "barber_id", "customer_name", "customer_phone", "service_name", "notes", "time_label", "updated_at"]) {
      if (typeof row[field] !== "string" || String(row[field]).length > 2000) throw new Error(`预约字段 ${field} 无效`);
    }
    ids.add(row.id as number);
  }
  return { shop_id: shopId, date, bookings: bookings as Booking[] };
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`预约数据库请求失败 (${response.status})`);
  return response;
}

async function syncPair(payload: { shop_id: string; date: string; bookings: Booking[] }) {
  const { shop_id: shopId, date, bookings } = payload;
  if (bookings.length) {
    await rest("bookings?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(bookings),
    });
  }
  const response = await rest(`bookings?select=id&shop_id=eq.${shopId}&date=eq.${date}&limit=1000`);
  const existing = await response.json();
  if (!Array.isArray(existing) || existing.length >= 1000) throw new Error("预约读取不完整，已停止清理");
  const sourceIds = new Set(bookings.map((booking) => Number(booking.id)));
  const staleIds = existing.map((booking: Booking) => Number(booking.id)).filter((id: number) => Number.isSafeInteger(id) && !sourceIds.has(id));
  let deleted = 0;
  for (let offset = 0; offset < staleIds.length; offset += 100) {
    const batch = staleIds.slice(offset, offset + 100);
    await rest(`bookings?id=in.(${batch.join(",")})&shop_id=eq.${shopId}&date=eq.${date}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    deleted += batch.length;
  }
  return { shop_id: shopId, date, upserted: bookings.length, deleted };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "service_unavailable" }, 503);
  try {
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length > 1_000_000 || !await authenticate(request, body)) return json({ error: "unauthorized" }, 401);
    const payload = validate(JSON.parse(new TextDecoder().decode(body)));
    return json(await syncPair(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : "预约同步失败";
    if (message.startsWith("预约数据库请求失败") || message.startsWith("预约读取不完整")) {
      console.error(message);
      return json({ error: "database_unavailable" }, 502);
    }
    return json({ error: "invalid_request" }, 400);
  }
});
