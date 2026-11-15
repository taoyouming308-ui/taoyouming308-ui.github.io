import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { recognizePettyVoucherOpenAI } from "../_shared/petty-voucher-openai.mjs";
import { candidates } from "../_shared/zysyr-ocr-candidates.mjs";
import { voucherCodexCandidates } from "../_shared/zysyr-voucher-codex.mjs";
import { parsePettyCashBatchNote } from "../_shared/petty-cash-batch.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WORKER_SECRET = Deno.env.get("ZYSYR_WORKER_SECRET") || "";
const SILICONFLOW_KEY = Deno.env.get("SILICONFLOW_API_KEY") || "";
const SILICONFLOW_BASE = (Deno.env.get("SILICONFLOW_BASE_URL") || "https://api.siliconflow.cn/v1").replace(/\/$/, "");
const OCR_MODEL = Deno.env.get("ZYSYR_OCR_MODEL") || "PaddlePaddle/PaddleOCR-VL-1.5";
const OCR_PROVIDER = "siliconflow-paddleocr";
const PROMPT_VERSION = "zysyr-voucher-v2-safe-structured";
const VOUCHER_BUCKET = "zysyr-vouchers";
const CODEX_URL = Deno.env.get("ZYSYR_DAILY_CODEX_BRIDGE_URL") || "";
const CODEX_TOKEN = Deno.env.get("ZYSYR_DAILY_CODEX_BRIDGE_TOKEN") || "";
const CODEX_MODEL = Deno.env.get("ZYSYR_VOUCHER_CODEX_MODEL") || "gpt-5.6-sol";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("ZYSYR_VOUCHER_OPENAI_MODEL") || "gpt-4.1-mini";
const CODEX_PROMPT_VERSION = "zysyr-voucher-codex-v1";

type Json = Record<string, unknown>;
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

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
    const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
    const metadataResponse = await fetch(`${SUPABASE_URL}/rest/v1/zysyr_voucher_attachments?select=note,audit_status&id=eq.${task.voucher_id}&company_id=eq.${task.company_id}&store_id=eq.${task.store_id}`, { headers });
    if (!metadataResponse.ok) throw Object.assign(new Error("VOUCHER_SCOPE_READ_FAILED"), { retryable: true });
    const metadata = (await metadataResponse.json())[0];
    if (!metadata || metadata.audit_status !== "pending") throw new Error("VOUCHER_ALREADY_REVIEWED");
    const batch = parsePettyCashBatchNote(metadata.note);
    if (batch) {
      if (!OPENAI_KEY && (!CODEX_URL.startsWith("https://") || !CODEX_TOKEN)) throw new Error("CODEX_VOUCHER_NOT_CONFIGURED");
      const marked = await fetch(`${SUPABASE_URL}/rest/v1/zysyr_voucher_ocr_tasks?id=eq.${taskId}&lease_token=eq.${leaseToken}&status=eq.processing`, {
        method: "PATCH", headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ provider: OPENAI_KEY ? "openai-api" : "codex-local", model: OPENAI_KEY ? OPENAI_MODEL : CODEX_MODEL, prompt_version: OPENAI_KEY ? "expense-voucher-v2" : CODEX_PROMPT_VERSION }),
      });
      if (!marked.ok || (await marked.json()).length !== 1) throw new Error("OCR_TASK_LEASE_INVALID");
      const signed = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${VOUCHER_BUCKET}/${storagePath(objectPath)}`, {
        method: "POST", headers, body: JSON.stringify({ expiresIn: 300 }),
      });
      if (!signed.ok) throw Object.assign(new Error("CODEX_SOURCE_SIGN_FAILED"), { retryable: true });
      const signedData = await signed.json();
      const signedPath = String(signedData.signedURL || signedData.signedUrl || "");
      if (!signedPath.startsWith("/object/sign/")) throw new Error("CODEX_SOURCE_SIGN_INVALID");
      let raw: Json;
      if (OPENAI_KEY) raw = await recognizePettyVoucherOpenAI({key:OPENAI_KEY,model:OPENAI_MODEL,imageURL:`${SUPABASE_URL}/storage/v1${signedPath}`,month:batch.month});
      else {
      const ai = await fetch(CODEX_URL, { method: "POST", signal: AbortSignal.timeout(125000),
        headers: { Authorization: `Bearer ${CODEX_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ task_type: "expense_voucher", month: batch.month,
          image_url: `${SUPABASE_URL}/storage/v1${signedPath}` }),
      });
      if (!ai.ok) throw Object.assign(new Error(`CODEX_VOUCHER_${ai.status}`), { retryable: ai.status === 429 || ai.status >= 500 });
      raw = await ai.json();
      }
      const parsed = voucherCodexCandidates(raw, batch.month);
      await rpc("zysyr_complete_voucher_ocr_task", { p_task_id: taskId, p_lease_token: leaseToken, p_succeeded: true,
        p_retryable: false, p_raw_result: { provider_response: raw, prompt_version: OPENAI_KEY ? "expense-voucher-v2" : CODEX_PROMPT_VERSION },
        p_candidate_fields: parsed.fields, p_field_confidences: parsed.confidences, p_error_message: null });
      return;
    }
    if (!SILICONFLOW_KEY) throw new Error("OCR_PROVIDER_NOT_CONFIGURED");
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
    const retryable = Boolean((error as { retryable?: boolean }).retryable) || ["TimeoutError","AbortError","TypeError"].includes((error as Error).name);
    await rpc("zysyr_complete_voucher_ocr_task", { p_task_id: taskId, p_lease_token: leaseToken, p_succeeded: false,
      p_retryable: retryable, p_raw_result: { error_type: (error as Error).name }, p_candidate_fields: {}, p_field_confidences: {},
      p_error_message: String((error as Error).message || "OCR_FAILED").slice(0, 1000) });
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !WORKER_SECRET) return response({ error: "worker not configured" }, 503);
  if (request.headers.get("x-worker-secret") !== WORKER_SECRET) return response({ error: "forbidden" }, 403);
  const body = await request.json().catch(() => ({})) as Json;
  const rawRequested = Number(body.limit || 1), rawFollowUpDepth = Number(body.follow_up_depth ?? 2);
  const requested = Number.isFinite(rawRequested) ? Math.max(1, Math.min(5, Math.trunc(rawRequested))) : 1;
  const followUpDepth = Number.isFinite(rawFollowUpDepth) ? Math.max(0, Math.min(2, Math.trunc(rawFollowUpDepth))) : 2;
  // Bounded parallel images; no artificial per-image waiting or UI blocking.
  EdgeRuntime.waitUntil((async () => {
  let processed = 0;
  await Promise.all(Array.from({length:Math.min(3,requested)},async()=>{
    const claimed = await rpc("zysyr_claim_voucher_ocr_task", { p_provider: OCR_PROVIDER, p_model: OCR_MODEL,
      p_prompt_version: PROMPT_VERSION, p_lease_seconds: 180 }) as Json[];
    const task=Array.isArray(claimed)?claimed[0]:null;if(!task)return;
    await processTask(task);processed+=1;
  }));
  if (processed > 0 && followUpDepth > 0) {
    await (async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const followUp = await fetch(`${SUPABASE_URL}/functions/v1/voucher-ocr-worker`, {
        method: "POST",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", "x-worker-secret": WORKER_SECRET },
        body: JSON.stringify({ limit: requested, follow_up_depth: followUpDepth - 1 }),
      });
      if (!followUp.ok) console.error("voucher-ocr-worker follow-up failed", followUp.status);
    })();
  }
  })().catch(error => console.error("voucher-ocr-worker task failed", (error as Error).name)));
  return response({ accepted: true, candidate_only: true, human_review_required: true });
});
