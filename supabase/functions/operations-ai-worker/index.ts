const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WORKER_SECRET = Deno.env.get("ZYSYR_WORKER_SECRET") || "";
const AI_KEY = Deno.env.get("ZYSYR_AI_API_KEY") || Deno.env.get("DEEPSEEK_API_KEY") || "";
const AI_BASE = (
  Deno.env.get("ZYSYR_AI_BASE_URL") ||
  Deno.env.get("DEEPSEEK_BASE_URL") ||
  "https://api.siliconflow.cn/v1"
).replace(/\/$/, "");
const AI_MODEL = Deno.env.get("ZYSYR_AI_MODEL") || "Qwen/Qwen3-30B-A3B-Instruct-2507";
const PROVIDER = Deno.env.get("ZYSYR_AI_PROVIDER") || "openai-compatible";
const PROMPT_VERSION = "zysyr-monthly-analysis-v1";

type Json = Record<string, unknown>;

function response(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function rpc(name: string, body: Json): Promise<unknown> {
  const result = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(`${name}:${result.status}:${String((data as Json).message || (data as Json).code || "RPC_FAILED")}`);
  return data;
}

function parseObject(value: unknown): Json | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  const cleaned = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { const parsed = JSON.parse(cleaned); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : null; } catch { return null; }
}

function contentText(raw: unknown): unknown {
  const root = raw && typeof raw === "object" ? raw as Json : {};
  const choices = Array.isArray(root.choices) ? root.choices as Json[] : [];
  const message = choices[0]?.message && typeof choices[0].message === "object" ? choices[0].message as Json : {};
  return message.content;
}

function validateOutput(output: Json): Json {
  const citations = Array.isArray(output.citations) ? output.citations as Json[] : [];
  if (!citations.length || citations.some((item) => !item || typeof item !== "object"
    || !String(item.metric_line_id || "") || !String(item.metric_code || "") || !Number.isFinite(Number(item.amount)))) {
    throw Object.assign(new Error("AI_OUTPUT_CITATIONS_REQUIRED"), { retryable: false });
  }
  return { summary: String(output.summary || "").slice(0, 4000),
    findings: Array.isArray(output.findings) ? output.findings.slice(0, 30) : [],
    anomalies: Array.isArray(output.anomalies) ? output.anomalies.slice(0, 30) : [],
    suggestions: Array.isArray(output.suggestions) ? output.suggestions.slice(0, 30) : [],
    citations: citations.slice(0, 100).map((item) => ({ metric_line_id: String(item.metric_line_id), metric_code: String(item.metric_code), amount: Number(item.amount) })) };
}

async function processRun(run: Json): Promise<void> {
  const runId = String(run.id || ""), leaseToken = String(run.lease_token || "");
  try {
    const prompt = `你是经营数据核对助手。只能依据 evidence_snapshot 分析，不得补充外部数字，不得写入业务记录。只输出 JSON 对象：summary、findings、anomalies、suggestions、citations。citations 必须逐条包含 evidence_snapshot.metrics 中原样的 metric_line_id、metric_code、amount；每个结论涉及的数字都必须引用。证据快照：${JSON.stringify(run.evidence_snapshot)}`;
    const ai = await fetch(`${AI_BASE}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${AI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: AI_MODEL, messages: [{ role: "user", content: prompt }], temperature: 0, max_tokens: 4000, response_format: { type: "json_object" } }) });
    const raw = await ai.json().catch(() => ({}));
    if (!ai.ok) throw Object.assign(new Error(`AI_PROVIDER_${ai.status}`), { retryable: ai.status === 429 || ai.status >= 500 });
    const parsed = parseObject(contentText(raw)); if (!parsed) throw Object.assign(new Error("AI_OUTPUT_NOT_JSON"), { retryable: true });
    const output = validateOutput(parsed);
    await rpc("zysyr_complete_ai_analysis", { p_run_id: runId, p_lease_token: leaseToken, p_succeeded: true, p_retryable: false, p_output_json: output, p_error_message: null });
  } catch (error) {
    await rpc("zysyr_complete_ai_analysis", { p_run_id: runId, p_lease_token: leaseToken, p_succeeded: false,
      p_retryable: Boolean((error as { retryable?: boolean }).retryable), p_output_json: {}, p_error_message: String((error as Error).message || "AI_FAILED").slice(0, 1000) });
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !WORKER_SECRET || !AI_KEY) return response({ error: "worker not configured" }, 503);
  if (request.headers.get("x-worker-secret") !== WORKER_SECRET) return response({ error: "forbidden" }, 403);
  const body = await request.json().catch(() => ({})) as Json;
  const requested = Math.max(1, Math.min(5, Number(body.limit || 1))); let processed = 0;
  for (let index = 0; index < requested; index += 1) {
    const claimed = await rpc("zysyr_claim_ai_analysis", { p_provider: PROVIDER, p_model: AI_MODEL, p_prompt_version: PROMPT_VERSION, p_lease_seconds: 240 });
    const run = Array.isArray(claimed) ? claimed[0] as Json : claimed as Json | null; if (!run || !run.id) break;
    await processRun(run); processed += 1;
  }
  return response({ processed, provider: PROVIDER, model: AI_MODEL, read_only: true, citations_required: true });
});
