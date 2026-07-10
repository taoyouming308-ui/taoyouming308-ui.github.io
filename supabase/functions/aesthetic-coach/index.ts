import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const MODEL = Deno.env.get("AESTHETIC_COACH_MODEL") || "gpt-5.5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://pdssrmpeiuwvxzsgschm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t";

const STAGE_RULES: Record<string, string> = {
  observe: "Evaluate whether the student accurately describes visual facts: outline, length proportions, layers, weight, bangs, face-framing, lines, texture, hair color, gloss. Flag subjective words like 'high-end, slim, gentle'.",
  analyze: "Check if the student explains causal links between design actions and visual results, not just repeating observations. Push on why outline, layers, weight, length are arranged this way.",
  judge: "Check if they say who it suits/doesn't suit, provide reasons, note hair quality and maintenance. Don't assume face shape or hair quality from one photo.",
  design: "Check if the plan covers outline, length, layers, weight, face-framing, texture, and technical steps. Point out the key gap between design language and execution.",
  review: "Check if the student extracts transferable principles of proportion, space, focus, style, color or texture, distinguishing cut, style, model and photography.",
};

function buildPrompt(stage: string, caseData: Record<string, unknown>, answer: string, prevAnswers: Record<string, string>): string {
  const rule = STAGE_RULES[stage] || "";
  const priorLines: string[] = [];
  for (const [key, val] of Object.entries(prevAnswers || {})) {
    if (key === stage) continue;
    const v = String(val || "").slice(0, 700);
    if (v) priorLines.push("- " + key + ": " + v);
  }
  const priorText = priorLines.join("\n").slice(0, 3600) || "None";
  return "You are a hair design mentor. Train students to observe, analyze, judge, design independently.\n\n" +
    "Stage: " + stage + " | Rule: " + rule + "\n\n" +
    "Case: " + String(caseData.title || "").slice(0, 120) + " (" + String(caseData.category || "").slice(0, 80) + ")\n" +
    "Focus: " + String(caseData.focus || "").slice(0, 200) + " | Limits: " + String(caseData.limitations || "").slice(0, 500) + "\n\n" +
    "Student answer: " + answer + "\n\n" +
    "Previous answers: " + priorText + "\n\n" +
    "Reference: " + String(caseData.reference || "").slice(0, 1000) + "\n\n" +
    "Requirements:\n" +
    "1. Affirm one specific thing done right.\n" +
    "2. Point out 1-3 most critical missing points.\n" +
    "3. Ask one follow-up question.\n" +
    "4. Score 0-100 based on evidence, logic, completeness.\n" +
    "5. Short professional Chinese, under 260 chars.\n" +
    "6. Output ONLY valid JSON: {\"score\":0,\"affirmation\":\"...\",\"omissions\":[\"...\"],\"follow_up\":\"...\",\"ready\":true}";
}

async function callOpenAI(prompt: string, imageUrl: string): Promise<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  if (imageUrl && (imageUrl.startsWith("https://") || imageUrl.startsWith("data:image/"))) {
    content.push({ type: "image_url", image_url: { url: imageUrl } });
  }
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + OPENAI_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content }],
      max_completion_tokens: 700,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error("OpenAI " + resp.status + ": " + await resp.text());
  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw); } catch { parsed = JSON.parse(raw.replace(/```json\n?|```/g, "")); }
  return parsed;
}

async function employeeIsActive(username: string): Promise<boolean> {
  const url = SUPABASE_URL + "/rest/v1/staff?select=username&username=eq." + encodeURIComponent(username) + "&active=eq.true&limit=1";
  const resp = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } });
  if (!resp.ok) return false;
  const data = await resp.json();
  return Array.isArray(data) && data.length > 0;
}

Deno.serve(async (req: Request) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: { ...headers, "Content-Type": "application/json" } });

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } }); }

  const username = String(payload.username || "").trim().slice(0, 80);
  const stage = String(payload.stage || "").trim().slice(0, 20);
  const answer = String(payload.answer || "").trim().slice(0, 1200);
  const caseData = (typeof payload.case === "object" && payload.case) ? payload.case as Record<string, unknown> : {};
  const prevAnswers = (typeof payload.previous_answers === "object" && payload.previous_answers) ? payload.previous_answers as Record<string, string> : {};

  if (!username || !["observe", "analyze", "judge", "design", "review"].includes(stage) || answer.length < 16) {
    return new Response(JSON.stringify({ error: "invalid params" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  if (!OPENAI_KEY) return new Response(JSON.stringify({ error: "not configured" }), { status: 503, headers: { ...headers, "Content-Type": "application/json" } });
  if (!(await employeeIsActive(username))) {
    return new Response(JSON.stringify({ error: "inactive staff" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
  }

  try {
    const prompt = buildPrompt(stage, caseData, answer, prevAnswers);
    const imageUrl = String(caseData.image_url || "");
    const fb = await callOpenAI(prompt, imageUrl);
    const omissions = Array.isArray(fb.omissions) ? fb.omissions.slice(0, 3).map((v: unknown) => String(v).slice(0, 120)) : [];
    const result = {
      score: Math.max(0, Math.min(100, Number(fb.score) || 0)),
      affirmation: String(fb.affirmation || "Done. Here is your feedback.").slice(0, 180),
      omissions,
      follow_up: String(fb.follow_up || "Can you point to one more visual clue?").slice(0, 180),
      ready: fb.ready !== false,
      model: MODEL,
    };
    return new Response(JSON.stringify(result), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: "AI error: " + (e as Error).message }), { status: 502, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
