import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const MODEL = Deno.env.get("AESTHETIC_COACH_MODEL") || "gpt-5.5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://pdssrmpeiuwvxzsgschm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t";

const STAGE_RULES: Record<string, string> = {
  observe: "DSS visual scan. Evaluate only directly visible facts: length, outline, line direction, weight location, layers, texture, curl and color. Flag style labels, suitability claims and technical guesses at this stage.",
  analyze: "DSS structure. Check relationships among top, sides, back and face-frame: support, connection, weight, focus, stable areas and moving areas. Do not accept a repeated list of surface observations as analysis.",
  judge: "DSS nine-style synthesis. The only base styles are natural, french, korean, japanese, urban, minimal, sweet, androgynous and avant-garde. Require one primary, at most one secondary, at least three visual evidence points and one counter-signal.",
  design: "DSS technical translation. Start from visual results that must be preserved, then test outline, layers, weight, face-frame, texture and styling hypotheses. Require explicit unknowns; never present a finished photo as proof of exact cutting angles or tools.",
  review: "DSS person adaptation. Check what to keep, adjust or abandon for the person's target, head/face proportions, real hair properties, context and maintenance capacity. Avoid stereotypes; require trade-offs and an alternative plan.",
};

const STAGE_MODULES: Record<string, string[]> = {
  observe: ["style", "outline", "layers", "bangs", "texture", "color", "uncertainties"],
  analyze: ["outline", "layers", "bangs", "texture", "curlStyling", "cuttingLogic", "uncertainties"],
  judge: ["style", "outline", "layers", "texture", "curlStyling", "color", "uncertainties"],
  design: ["outline", "layers", "bangs", "texture", "curlStyling", "color", "cuttingLogic", "maintenance", "uncertainties"],
  review: ["style", "outline", "layers", "suitability", "cuttingLogic", "maintenance", "uncertainties"],
};

const DSS_STYLES = ["natural", "french", "korean", "japanese", "urban", "minimal", "sweet", "androgynous", "avant_garde"];

function buildAnalysisPrompt(caseData: Record<string, unknown>, extraFacts = "", previousModules: Record<string, unknown> = {}): string {
  return `你是遵循 DSS V1.0 的资深发型设计教育导师。请先观察事实，再归纳风格。只根据图片可见证据建立该图片专属分析底稿；看不清或无法确认的内容必须放入 uncertainties，不得把推测写成事实。
案例：${String(caseData.title || "").slice(0, 120)}；分类：${String(caseData.category || "").slice(0, 80)}
已知限制：${String(caseData.limitations || "").slice(0, 500)}
用户补充的真实信息：${extraFacts || "无"}
已有模块（修订时只更新受新增信息影响的模块）：${JSON.stringify(previousModules).slice(0, 9000) || "无"}
输出严格 JSON：{
 "fullAnalysis":"不超过650字的完整专业分析，覆盖所有模块",
 "summary":"不超过120字精简摘要",
 "modules":{"style|outline|layers|bangs|texture|curlStyling|color|suitability|cuttingLogic|maintenance|uncertainties":{
  "conclusion":"模块结论","observations":["图片直接可见事实"],"inferences":["明确标记的专业推测"],"evidence":["支持结论的视觉证据"],"conflicts":["冲突信号"],"confidence":0到100,"requestedInputs":["提高置信度所需信息"]
 }},"affectedModules":["本次实际修改的模块名"]}。每个模块文字合计不超过150字；observations/evidence最多3条，inferences/conflicts/requestedInputs最多2条。首次分析11个模块必须存在；修订时 modules 只返回受影响模块。低于60分置信度只能写成推测。中文输出。`;
}

function buildPrompt(stage: string, caseData: Record<string, unknown>, answer: string, answerHistory: string[], feedbackHistory: unknown[], modules: Record<string, unknown>, finalRequest: boolean): string {
  const rule = STAGE_RULES[stage] || "";
  const priorLines: string[] = [];
  answerHistory.slice(-4).forEach((val, index) => priorLines.push(`- 回答${index + 1}: ${String(val).slice(0, 900)}`));
  const priorText = priorLines.join("\n").slice(0, 4200) || "None";
  const priorFeedback = JSON.stringify(feedbackHistory.slice(-3)).slice(0, 3600) || "[]";
  const moduleText = JSON.stringify(modules).slice(0, 7000);
  return "You are a DSS V1.0 hair design mentor. Train students through visual scan, structure, style synthesis, technical translation and person adaptation.\n\n" +
    "Stage: " + stage + " | Rule: " + rule + "\n\n" +
    "Case: " + String(caseData.title || "").slice(0, 120) + " (" + String(caseData.category || "").slice(0, 80) + ")\n" +
    "Focus: " + String(caseData.focus || "").slice(0, 200) + " | Limits: " + String(caseData.limitations || "").slice(0, 500) + "\n\n" +
    "Student answer: " + answer + "\n\n" +
    "Current-stage answer history: " + priorText + "\n\n" +
    "Previous AI feedback: " + priorFeedback + "\n\n" +
    "Relevant image-analysis modules (authoritative evidence base): " + moduleText + "\n\n" +
    "Requirements:\n" +
    "1. Compare all answers, identify newly added valid observations and improvement from prior rounds.\n" +
    "2. Separate observedPoints, missedPoints and misconceptions; never praise unsupported claims.\n" +
    "3. Ask one guiding question without exposing the whole answer before the final round. For style synthesis, only use these nine base styles: " + DSS_STYLES.join(", ") + ".\n" +
    "4. Return completion 0-100 and explainable metrics: accuracy, coverage, evidence, logic, factInference, technical, progress.\n" +
    (finalRequest ? "5. This is the final round: include finalAnalysis for the current stage based on the selected modules and all answers.\n" : "5. finalAnalysis must be empty before the final round.\n") +
    "6. Output ONLY JSON: {\"score\":0,\"affirmation\":\"\",\"improvement\":\"\",\"observedPoints\":[],\"missedPoints\":[],\"misconceptions\":[],\"follow_up\":\"\",\"completion\":0,\"metrics\":{\"accuracy\":0,\"coverage\":0,\"evidence\":0,\"logic\":0,\"factInference\":0,\"technical\":0,\"progress\":0},\"finalAnalysis\":\"\",\"ready\":true}";
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
      max_completion_tokens: imageUrl ? 3000 : 1600,
      reasoning_effort: imageUrl ? "none" : "low",
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
  const operation = String(payload.operation || "feedback").trim().slice(0, 30);
  const stage = String(payload.stage || "").trim().slice(0, 20);
  const answer = String(payload.answer || "").trim().slice(0, 1200);
  const caseData = (typeof payload.case === "object" && payload.case) ? payload.case as Record<string, unknown> : {};
  const answerHistory = Array.isArray(payload.answer_history) ? payload.answer_history.map((v) => String(v).slice(0, 1200)).slice(-4) : [];
  const feedbackHistory = Array.isArray(payload.feedback_history) ? payload.feedback_history.slice(-3) : [];
  const analysisModules = (typeof payload.analysis_modules === "object" && payload.analysis_modules) ? payload.analysis_modules as Record<string, unknown> : {};
  const finalRequest = payload.final_request === true;

  if (!username || !["analyze_image", "feedback", "revise_analysis"].includes(operation)) {
    return new Response(JSON.stringify({ error: "invalid params" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  if (!OPENAI_KEY) return new Response(JSON.stringify({ error: "not configured" }), { status: 503, headers: { ...headers, "Content-Type": "application/json" } });
  if (!(await employeeIsActive(username))) {
    return new Response(JSON.stringify({ error: "inactive staff" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
  }

  try {
    if (operation === "analyze_image" || operation === "revise_analysis") {
      const extraFacts = String(payload.extra_facts || "").slice(0, 1600);
      const prompt = buildAnalysisPrompt(caseData, extraFacts, operation === "revise_analysis" ? analysisModules : {});
      const imageUrl = String(caseData.image_url || "");
      if (operation === "analyze_image" && !imageUrl) throw new Error("image required");
      const analysis = await callOpenAI(prompt, operation === "analyze_image" ? imageUrl : "");
      if (!analysis || typeof analysis.modules !== "object" || !analysis.modules || !String(analysis.summary || "").trim()) {
        throw new Error("analysis structure incomplete");
      }
      return new Response(JSON.stringify({ analysis, model: MODEL }), { headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (!["observe", "analyze", "judge", "design", "review"].includes(stage) || answer.length < 16) {
      return new Response(JSON.stringify({ error: "invalid params" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }
    const selected: Record<string, unknown> = {};
    for (const key of STAGE_MODULES[stage] || []) if (key in analysisModules) selected[key] = analysisModules[key];
    const prompt = buildPrompt(stage, caseData, answer, answerHistory, feedbackHistory, selected, finalRequest);
    const imageUrl = "";
    const fb = await callOpenAI(prompt, imageUrl);
    const omissions = Array.isArray(fb.omissions) ? fb.omissions.slice(0, 3).map((v: unknown) => String(v).slice(0, 120)) : [];
    const observedPoints = Array.isArray(fb.observedPoints) ? fb.observedPoints.slice(0, 8).map((v: unknown) => String(v).slice(0, 100)) : [];
    const missedPoints = Array.isArray(fb.missedPoints) ? fb.missedPoints.slice(0, 8).map((v: unknown) => String(v).slice(0, 100)) : omissions;
    const misconceptions = Array.isArray(fb.misconceptions) ? fb.misconceptions.slice(0, 6).map((v: unknown) => String(v).slice(0, 120)) : [];
    const metricSource = (typeof fb.metrics === "object" && fb.metrics) ? fb.metrics as Record<string, unknown> : {};
    const metrics: Record<string, number> = {};
    for (const key of ["accuracy", "coverage", "evidence", "logic", "factInference", "technical", "progress"]) metrics[key] = Math.max(0, Math.min(100, Number(metricSource[key]) || 0));
    const result = {
      score: Math.max(0, Math.min(100, Number(fb.score) || 0)),
      affirmation: String(fb.affirmation || "Done. Here is your feedback.").slice(0, 180),
      omissions: missedPoints,
      observed_points: observedPoints,
      missed_points: missedPoints,
      misconceptions,
      improvement: String(fb.improvement || "").slice(0, 220),
      completion: Math.max(0, Math.min(100, Number(fb.completion) || Number(fb.score) || 0)),
      metrics,
      final_analysis: finalRequest ? String(fb.finalAnalysis || "").slice(0, 1800) : "",
      follow_up: String(fb.follow_up || "Can you point to one more visual clue?").slice(0, 180),
      ready: fb.ready !== false,
      model: MODEL,
    };
    return new Response(JSON.stringify(result), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: "AI error: " + (e as Error).message }), { status: 502, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
