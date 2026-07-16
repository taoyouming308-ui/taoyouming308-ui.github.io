import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { outputRepairPrompt, validateAestheticOutput, type AestheticOutputKind } from "../_shared/aesthetic-output-schema.ts";
import { buildAnalysisPrompt } from "../_shared/prompts/analysis.ts";
import { buildCoachTurnPrompt, buildSessionSummaryPrompt } from "../_shared/prompts/coach.ts";

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
const COACH_GOALS = ["outline", "weight", "layers", "line_texture", "style", "suitability", "technique", "client_communication"];
const HAIR_VISION_CHECKPOINTS = ["human_analysis", "style", "hair_anatomy", "suitability", "client_communication"];

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

async function requestOpenAI(prompt: string, imageUrl: string): Promise<string> {
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
  return data.choices?.[0]?.message?.content || "{}";
}

function parseModelJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/```json\n?|```/g, "")); }
}

async function callOpenAI(prompt: string, imageUrl: string, kind: AestheticOutputKind): Promise<Record<string, unknown>> {
  const raw = await requestOpenAI(prompt, imageUrl);
  let parsed: unknown;
  try { parsed = parseModelJson(raw); } catch { parsed = null; }
  const first = validateAestheticOutput(kind, parsed);
  if (first.ok) return { ...first.value, _validation: { schema: kind, repaired: false } };

  const repairedRaw = await requestOpenAI(outputRepairPrompt(kind, raw, first.errors), "");
  let repaired: unknown;
  try { repaired = parseModelJson(repairedRaw); } catch { repaired = null; }
  const second = validateAestheticOutput(kind, repaired);
  if (!second.ok) throw new Error("model output schema invalid after repair: " + second.errors.join("; "));
  return { ...second.value, _validation: { schema: kind, repaired: true, initial_errors: first.errors } };
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

  if (!username || !["analyze_image", "feedback", "revise_analysis", "coach_turn", "summarize_session"].includes(operation)) {
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
      const analysis = await callOpenAI(prompt, operation === "analyze_image" ? imageUrl : "", "analysis");
      if (!analysis || typeof analysis.modules !== "object" || !analysis.modules || !String(analysis.summary || "").trim()) {
        throw new Error("analysis structure incomplete");
      }
      return new Response(JSON.stringify({ analysis, model: MODEL }), { headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (operation === "coach_turn") {
      if (answer.length < 1) return new Response(JSON.stringify({ error: "answer required" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
      const prompt = buildCoachTurnPrompt(payload, analysisModules);
      const turn = await callOpenAI(prompt, "", "coach_turn");
      const fallbackGoal = COACH_GOALS.includes(String(payload.active_goal || "")) ? String(payload.active_goal) : "outline";
      const goal = COACH_GOALS.includes(String(turn.active_goal || "")) ? String(turn.active_goal) : fallbackGoal;
      const currentCheckpoint = HAIR_VISION_CHECKPOINTS.includes(String(payload.active_checkpoint || "")) ? String(payload.active_checkpoint) : "human_analysis";
      const checkpointSource = (typeof payload.checkpoint_states === "object" && payload.checkpoint_states) ? payload.checkpoint_states as Record<string, unknown> : {};
      const checkpointStates: Record<string, string> = {};
      for (const checkpoint of HAIR_VISION_CHECKPOINTS) {
        const incoming = typeof checkpointSource[checkpoint] === "string"
          ? String(checkpointSource[checkpoint])
          : String((checkpointSource[checkpoint] as Record<string, unknown>)?.status || "unseen");
        checkpointStates[checkpoint] = ["unseen", "asked", "answered", "demonstrated", "mastered", "incomplete"].includes(incoming) ? incoming : "unseen";
      }
      const rawEvaluation = (typeof turn.checkpoint_evaluation === "object" && turn.checkpoint_evaluation) ? turn.checkpoint_evaluation as Record<string, unknown> : {};
      const evidenceCount = Math.max(0, Math.min(8, Number(rawEvaluation.evidence_count) || 0));
      const classification = (typeof turn.classification === "object" && turn.classification) ? turn.classification as Record<string, unknown> : {};
      const supportedCount = (Array.isArray(classification.observed_facts) ? classification.observed_facts.length : 0) +
        (Array.isArray(classification.reasonable_inferences) ? classification.reasonable_inferences.length : 0);
      const unsupportedCount = Array.isArray(classification.unsupported_claims) ? classification.unsupported_claims.length : 0;
      const masteryPassed = String(rawEvaluation.status || "") === "mastered" && evidenceCount >= 2 && answer.length >= 28 && supportedCount >= 2 && unsupportedCount <= supportedCount;
      checkpointStates[currentCheckpoint] = masteryPassed ? "mastered" : "incomplete";
      const nextCheckpoint = HAIR_VISION_CHECKPOINTS.find((checkpoint) => !["answered", "demonstrated", "mastered"].includes(checkpointStates[checkpoint])) || "client_communication";
      if (nextCheckpoint !== currentCheckpoint && checkpointStates[nextCheckpoint] === "unseen") checkpointStates[nextCheckpoint] = "asked";
      const timePhase = String(payload.time_phase || "active");
      const allCovered = HAIR_VISION_CHECKPOINTS.every((checkpoint) => ["answered", "demonstrated", "mastered"].includes(checkpointStates[checkpoint]));
      const shouldAutoFinish = allCovered || timePhase === "overtime";
      const checkpointEvaluation = {
        status: masteryPassed ? "mastered" : "needs_evidence",
        evidence_count: evidenceCount,
        reason: String(rawEvaluation.reason || "").slice(0, 240),
        missing_evidence: masteryPassed ? "" : String(rawEvaluation.missing_evidence || "需要至少两个位置明确的证据，并说明它们如何支持判断。 ").slice(0, 240),
      };
      const result = {
        message: String(turn.message || "我们先缩小范围，只说一个你能确认的画面事实。你最先看到哪里？").slice(0, 600),
        response_type: String(turn.response_type || "probe").slice(0, 30),
        active_goal: goal,
        active_checkpoint: shouldAutoFinish ? currentCheckpoint : (masteryPassed ? nextCheckpoint : currentCheckpoint),
        checkpoint_states: checkpointStates,
        goal_states: typeof turn.goal_states === "object" && turn.goal_states ? turn.goal_states : payload.goal_states || {},
        classification,
        checkpoint_evaluation: checkpointEvaluation,
        knowledge_seed: typeof turn.knowledge_seed === "object" && turn.knowledge_seed ? turn.knowledge_seed : { type: "none", content: "" },
        repeated_pattern: String(turn.repeated_pattern || "").slice(0, 180),
        difficulty: Math.max(1, Math.min(3, Number(turn.difficulty) || 1)),
        ability_updates: typeof turn.ability_updates === "object" && turn.ability_updates ? turn.ability_updates : {},
        should_offer_summary: shouldAutoFinish || turn.should_offer_summary === true,
        should_auto_finish: shouldAutoFinish,
        model: MODEL,
      };
      return new Response(JSON.stringify(result), { headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (operation === "summarize_session") {
      const summary = await callOpenAI(buildSessionSummaryPrompt(payload), "", "session_summary");
      return new Response(JSON.stringify({ summary, model: MODEL }), { headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (!["observe", "analyze", "judge", "design", "review"].includes(stage) || answer.length < 16) {
      return new Response(JSON.stringify({ error: "invalid params" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }
    const selected: Record<string, unknown> = {};
    for (const key of STAGE_MODULES[stage] || []) if (key in analysisModules) selected[key] = analysisModules[key];
    const prompt = buildPrompt(stage, caseData, answer, answerHistory, feedbackHistory, selected, finalRequest);
    const imageUrl = "";
    const fb = await callOpenAI(prompt, imageUrl, "stage_feedback");
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
