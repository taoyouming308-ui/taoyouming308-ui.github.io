import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { candidates } from "../_shared/zysyr-ocr-candidates.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WORKER_SECRET = Deno.env.get("ZYSYR_WORKER_SECRET") || "";
const SILICONFLOW_KEY = Deno.env.get("SILICONFLOW_API_KEY") || "";
const SILICONFLOW_BASE = (Deno.env.get("SILICONFLOW_BASE_URL") || "https://api.siliconflow.cn/v1").replace(/\/$/, "");
const OCR_MODEL = Deno.env.get("ZYSYR_OCR_MODEL") || "PaddlePaddle/PaddleOCR-VL-1.5";
const OCR_PROVIDER = "siliconflow-paddleocr";
const PROMPT_VERSION = "zysyr-voucher-v2-safe-structured";
const VOUCHER_BUCKET = "zysyr-vouchers";

type Json = Record<string, unknown>;

function response(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function storagePath(path: string): string { return path.split("/").map(encodeURIComponent).join("/"); }

async function rpc(name: string, body: Json): Promise<unknown> {
  const result = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(`${name}:${result.status}:${String((data as Json).message || (data as Json).code || "RPC_FAILED")}`);
  return data;
}

function base64(bytes: Uint8Array): string {
  let binary = ""; const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  return btoa(binary);
}

function contentText(raw: unknown): string {
  const root = raw && typeof raw === "object" ? raw as Json : {};
  const choices = Array.isArray(root.choices) ? root.choices as Json[] : [];
  const message = choices[0]?.message && typeof choices[0].message === "object" ? choices[0].message as Json : {};
  return String(message.content || "").slice(0, 120000);
}

async function processTask(task: Json): Promise<void> {
  const taskId = String(task.task_id || ""), leaseToken = String(task.lease_token || "");
  try {
    const mime = String(task.mime_type || "");
    if (!mime.startsWith("image/")) throw Object.assign(new Error("PDF_REQUIRES_MANUAL_REVIEW"), { retryable: false });
    const objectPath = String(task.object_path || "");
    const file = await fetch(`${SUPABASE_URL}/storage/v1/object/${VOUCHER_BUCKET}/${storagePath(objectPath)}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!file.ok) throw Object.assign(new Error(`STORAGE_DOWNLOAD_${file.status}`), { retryable: file.status >= 500 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Object.assign(new Error("IMAGE_SIZE_INVALID"), { retryable: false });
    const prompt = "请识别原始财务凭证。只输出一个合法JSON对象，不要Markdown代码块，不要LOC坐标标记：full_text（全部可辨文字）、regions（文字与坐标数组）、document_date（YYYY-MM-DD或null）、amount（总金额数字或null）、counterparty（供应商/收付款方或null）、document_number（单据号或null）。不要推测看不清的字段；手写日报的小计、总计和日期不确定时必须填null。";
    const ai = await fetch(`${SILICONFLOW_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SILICONFLOW_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: OCR_MODEL, messages: [{ role: "user", content: [
        { type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${base64(bytes)}` } },
      ] }], max_tokens: 4000, temperature: 0 }),
    });
    const raw = await ai.json().catch(() => ({}));
    if (!ai.ok) throw Object.assign(new Error(`OCR_PROVIDER_${ai.status}`), { retryable: ai.status === 429 || ai.status >= 500, raw });
    const text = contentText(raw); if (!text) throw Object.assign(new Error("OCR_EMPTY_RESULT"), { retryable: true });
    const parsed = candidates(text);
    await rpc("zysyr_complete_voucher_ocr_task", { p_task_id: taskId, p_lease_token: leaseToken, p_succeeded: true,
      p_retryable: false, p_raw_result: { provider_response: raw, parsed: parsed.structured, prompt_version: PROMPT_VERSION },
      p_candidate_fields: parsed.fields, p_field_confidences: parsed.confidences, p_error_message: null });
  } catch (error) {
    const retryable = Boolean((error as { retryable?: boolean }).retryable);
    await rpc("zysyr_complete_voucher_ocr_task", { p_task_id: taskId, p_lease_token: leaseToken, p_succeeded: false,
      p_retryable: retryable, p_raw_result: { error_type: (error as Error).name }, p_candidate_fields: {}, p_field_confidences: {},
      p_error_message: String((error as Error).message || "OCR_FAILED").slice(0, 1000) });
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !WORKER_SECRET || !SILICONFLOW_KEY) return response({ error: "worker not configured" }, 503);
  if (request.headers.get("x-worker-secret") !== WORKER_SECRET) return response({ error: "forbidden" }, 403);
  const body = await request.json().catch(() => ({})) as Json;
  const rawRequested = Number(body.limit || 1), rawFollowUpDepth = Number(body.follow_up_depth ?? 2);
  const requested = Number.isFinite(rawRequested) ? Math.max(1, Math.min(5, Math.trunc(rawRequested))) : 1;
  const followUpDepth = Number.isFinite(rawFollowUpDepth) ? Math.max(0, Math.min(2, Math.trunc(rawFollowUpDepth))) : 2;
  let processed = 0;
  for (let index = 0; index < requested; index += 1) {
    const claimed = await rpc("zysyr_claim_voucher_ocr_task", { p_provider: OCR_PROVIDER, p_model: OCR_MODEL,
      p_prompt_version: PROMPT_VERSION, p_lease_seconds: 180 }) as Json[];
    const task = Array.isArray(claimed) ? claimed[0] : null; if (!task) break;
    await processTask(task); processed += 1;
  }
  if (processed > 0 && followUpDepth > 0) {
    EdgeRuntime.waitUntil((async () => {
      await new Promise((resolve) => setTimeout(resolve, 35000));
      const followUp = await fetch(`${SUPABASE_URL}/functions/v1/voucher-ocr-worker`, {
        method: "POST",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", "x-worker-secret": WORKER_SECRET },
        body: JSON.stringify({ limit: requested, follow_up_depth: followUpDepth - 1 }),
      });
      if (!followUp.ok) console.error("voucher-ocr-worker follow-up failed", followUp.status);
    })());
  }
  return response({ processed, provider: OCR_PROVIDER, model: OCR_MODEL, candidate_only: true, human_review_required: true });
});
