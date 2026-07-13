import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const MODEL = Deno.env.get("AESTHETIC_EVALUATOR_MODEL") || "gpt-5.5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EVALUATOR_VERSION = "evaluator-v1";
const CANDIDATE_INTERVAL = 100;
const DEFAULT_DAILY_LIMIT = 1;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Content-Type": "application/json",
};

function clamp(value: unknown, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function cleanText(value: unknown, max = 1200): string {
  return String(value || "").trim().slice(0, max);
}

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function activeEmployee(username: string, store: string): Promise<boolean> {
  const query = "staff?select=username,store&username=eq." + encodeURIComponent(username) +
    "&active=eq.true&limit=1";
  const response = await rest(query);
  if (!response.ok) return false;
  const rows = await response.json();
  return Array.isArray(rows) && rows.some((row) => !store || !row.store || row.store === store);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function trainingEntitlement(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const username = cleanText(payload.username, 80);
  const store = cleanText(payload.store, 100);
  const businessDate = cleanText(payload.business_date, 10) || new Date().toISOString().slice(0, 10);
  const sessionId = cleanText(payload.session_id, 120);
  const policyResponse = await rest("aesthetic_training_policies?select=daily_limit,access_status,reason,disabled_until&username=eq." + encodeURIComponent(username) + "&limit=1");
  if (!policyResponse.ok) throw new Error("policy read " + policyResponse.status);
  const policy = (await policyResponse.json())[0] || {};
  let status = cleanText(policy.access_status, 20) || "enabled";
  if (status === "paused" && policy.disabled_until && new Date(String(policy.disabled_until)).getTime() <= Date.now()) status = "enabled";
  const dailyLimit = policy.daily_limit === undefined ? DEFAULT_DAILY_LIMIT : clamp(policy.daily_limit, 0, 20);
  const countResponse = await rest(
    "aesthetic_training_sessions?select=id,status&username=eq." + encodeURIComponent(username) +
    "&business_date=eq." + encodeURIComponent(businessDate) + "&status=in.(in_progress,completed)",
  );
  if (!countResponse.ok) throw new Error("session count " + countResponse.status);
  const sessions = await countResponse.json();
  const currentExists = sessionId && sessions.some((row: Record<string, unknown>) => row.id === sessionId);
  const used = sessions.length;
  const allowed = status === "enabled" && (currentExists || used < dailyLimit);
  return { allowed, status, reason: cleanText(policy.reason, 300), daily_limit: dailyLimit, used, remaining: Math.max(0, dailyLimit - used), store };
}

async function adminLogin(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const username = cleanText(payload.username, 80);
  const passwordHash = cleanText(payload.password_hash, 160);
  const response = await rest("staff?select=username,role,store,active,password_hash&username=eq." + encodeURIComponent(username) + "&role=in.(admin,store_admin)&limit=1");
  if (!response.ok) throw new Error("admin login " + response.status);
  const row = (await response.json())[0];
  if (!row || row.active === false || !passwordHash || String(row.password_hash || "") !== passwordHash || (row.role === "store_admin" && !row.store)) {
    throw new Error("invalid admin credentials");
  }
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const saved = await rest("aesthetic_training_admin_sessions", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ token_hash: tokenHash, username: row.username, role: row.role, store: row.store || "", expires_at: expiresAt }),
  });
  if (!saved.ok) throw new Error("admin session " + saved.status);
  return { token, expires_at: expiresAt, role: row.role, store: row.store || "" };
}

async function requireTrainingAdmin(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = cleanText(payload.admin_token, 200);
  if (!token) throw new Error("admin login required");
  const response = await rest("aesthetic_training_admin_sessions?select=username,role,store,expires_at&token_hash=eq." + encodeURIComponent(await sha256(token)) + "&expires_at=gt." + encodeURIComponent(new Date().toISOString()) + "&limit=1");
  if (!response.ok) throw new Error("admin session read " + response.status);
  const admin = (await response.json())[0];
  if (!admin) throw new Error("admin session expired");
  return admin;
}

function cleanList(value: unknown, maxItems = 12, maxText = 500): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, maxText)).filter(Boolean).slice(0, maxItems);
}

async function requireKnowledgeAdmin(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const admin = await requireTrainingAdmin(payload);
  if (admin.role !== "admin") throw new Error("knowledge governance requires super admin");
  return admin;
}

async function adminKnowledgeOverview(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  await requireKnowledgeAdmin(payload);
  const response = await rest("aesthetic_knowledge_candidates?select=*&order=created_at.desc&limit=300");
  if (!response.ok) throw new Error("knowledge candidates " + response.status);
  const rows = await response.json();
  return {
    rows,
    counts: rows.reduce((result: Record<string, number>, row: Record<string, unknown>) => {
      const status = cleanText(row.status, 40) || "unknown";
      result[status] = (result[status] || 0) + 1;
      return result;
    }, {}),
  };
}

async function adminCreateKnowledgeCandidate(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const admin = await requireKnowledgeAdmin(payload);
  const title = cleanText(payload.title, 240);
  const summary = cleanText(payload.summary || payload.note, 2000);
  const layer = ["standard", "internal", "trend"].includes(String(payload.layer)) ? String(payload.layer) : "trend";
  const sourceUrl = cleanText(payload.source_url || payload.url, 1000);
  if (!title || summary.length < 8) throw new Error("title and summary are required");
  if (sourceUrl && !sourceUrl.startsWith("https://")) throw new Error("source URL must use HTTPS");
  const row = {
    layer,
    title,
    source_url: sourceUrl,
    summary,
    observation_facts: cleanList(payload.observation_facts),
    proposed_judgment: cleanText(payload.proposed_judgment, 1600),
    reasoning: cleanText(payload.reasoning, 2400),
    applicable_conditions: cleanList(payload.applicable_conditions),
    unsuitable_conditions: cleanList(payload.unsuitable_conditions),
    positive_examples: cleanList(payload.positive_examples),
    counter_examples: cleanList(payload.counter_examples),
    related_styles: cleanList(payload.related_styles, 9, 80),
    copyright_status: ["unverified", "public_reference", "licensed", "internal_original", "restricted"].includes(String(payload.copyright_status)) ? payload.copyright_status : "unverified",
    confidence: clamp(payload.confidence),
    status: "pending_review",
    submitted_by: admin.username,
  };
  const saved = await rest("aesthetic_knowledge_candidates", {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row),
  });
  if (!saved.ok) throw new Error("knowledge candidate create " + saved.status + ": " + await saved.text());
  return { saved: true, candidate: (await saved.json())[0] };
}

async function adminReviewKnowledgeCandidate(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const admin = await requireKnowledgeAdmin(payload);
  const candidateId = cleanText(payload.candidate_id, 80);
  const decision = ["needs_revision", "approved_for_trial", "rejected"].includes(String(payload.decision)) ? String(payload.decision) : "";
  const reason = cleanText(payload.reason, 1600);
  const professionalAccuracy = clamp(payload.professional_accuracy);
  const evidenceQuality = clamp(payload.evidence_quality);
  const copyrightClear = payload.copyright_clear === true;
  const safetyClear = payload.safety_clear === true;
  if (!candidateId || !decision || reason.length < 8) throw new Error("candidate, decision and review reason are required");
  if (decision === "approved_for_trial" && (!copyrightClear || !safetyClear || professionalAccuracy < 80 || evidenceQuality < 70)) {
    throw new Error("approval requires copyright and safety clearance, accuracy >= 80 and evidence >= 70");
  }
  const current = await rest("aesthetic_knowledge_candidates?select=*&id=eq." + encodeURIComponent(candidateId) + "&limit=1");
  const candidate = current.ok ? (await current.json())[0] : null;
  if (!candidate) throw new Error("knowledge candidate not found");
  const review = await rest("aesthetic_knowledge_reviews", {
    method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      candidate_id: candidateId, reviewer: admin.username, decision,
      professional_accuracy: professionalAccuracy, evidence_quality: evidenceQuality,
      copyright_clear: copyrightClear, safety_clear: safetyClear, reason, snapshot: candidate,
    }),
  });
  if (!review.ok) throw new Error("knowledge review " + review.status);
  const updated = await rest("aesthetic_knowledge_candidates?id=eq." + encodeURIComponent(candidateId), {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({
      status: decision, reviewed_by: admin.username, reviewed_at: new Date().toISOString(),
      review_reason: reason, version: Number(candidate.version || 1) + 1, updated_at: new Date().toISOString(),
    }),
  });
  if (!updated.ok) throw new Error("knowledge candidate update " + updated.status);
  return { saved: true, candidate: (await updated.json())[0] };
}

async function adminTrainingOverview(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const admin = await requireTrainingAdmin(payload);
  const scope = admin.role === "store_admin" ? "&store=eq." + encodeURIComponent(admin.store) : "";
  const staffResponse = await rest("staff?select=username,store,position&active=eq.true&role=eq.staff" + scope + "&order=username.asc");
  if (!staffResponse.ok) throw new Error("staff overview " + staffResponse.status);
  const staff = await staffResponse.json();
  const names = staff.map((row: Record<string, unknown>) => cleanText(row.username, 80)).filter(Boolean);
  if (!names.length) return { rows: [] };
  const encodedNames = names.map((name: string) => encodeURIComponent(name)).join(",");
  const today = cleanText(payload.business_date, 10) || new Date().toISOString().slice(0, 10);
  const [policiesResponse, sessionsResponse] = await Promise.all([
    rest("aesthetic_training_policies?select=username,daily_limit,access_status,reason,disabled_until,updated_at&username=in.(" + encodedNames + ")"),
    rest("aesthetic_training_sessions?select=id,username,status,case_title,turn_count,started_at,completed_at,summary,goal_states&username=in.(" + encodedNames + ")&business_date=eq." + encodeURIComponent(today) + "&order=started_at.desc"),
  ]);
  if (!policiesResponse.ok || !sessionsResponse.ok) throw new Error("training overview unavailable");
  const policies = await policiesResponse.json();
  const sessions = await sessionsResponse.json();
  return { rows: staff.map((person: Record<string, unknown>) => {
    const policy = policies.find((row: Record<string, unknown>) => row.username === person.username) || {};
    const own = sessions.filter((row: Record<string, unknown>) => row.username === person.username);
    return { ...person, daily_limit: policy.daily_limit === undefined ? DEFAULT_DAILY_LIMIT : policy.daily_limit, access_status: policy.access_status || "enabled", reason: policy.reason || "", disabled_until: policy.disabled_until || null, today_sessions: own };
  }) };
}

async function adminUpdateTrainingPolicy(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const admin = await requireTrainingAdmin(payload);
  const username = cleanText(payload.target_username, 80);
  const staffResponse = await rest("staff?select=username,store&username=eq." + encodeURIComponent(username) + "&active=eq.true&role=eq.staff&limit=1");
  const person = staffResponse.ok ? (await staffResponse.json())[0] : null;
  if (!person || (admin.role === "store_admin" && person.store !== admin.store)) throw new Error("staff outside admin scope");
  const currentResponse = await rest("aesthetic_training_policies?select=*&username=eq." + encodeURIComponent(username) + "&limit=1");
  const before = currentResponse.ok ? (await currentResponse.json())[0] || {} : {};
  const row = {
    username, store: person.store || "", daily_limit: clamp(payload.daily_limit, 0, 20),
    access_status: ["enabled", "paused", "disabled"].includes(String(payload.access_status)) ? payload.access_status : "enabled",
    reason: cleanText(payload.reason, 300), disabled_until: payload.disabled_until || null,
    updated_by: admin.username, updated_at: new Date().toISOString(),
  };
  const saved = await rest("aesthetic_training_policies?on_conflict=username", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row) });
  if (!saved.ok) throw new Error("policy update " + saved.status + ": " + await saved.text());
  await rest("aesthetic_training_admin_audit", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ operator: admin.username, operator_role: admin.role, operator_store: admin.store || "", username, action: "update_training_policy", before_value: before, after_value: row, reason: row.reason }) });
  return { saved: true, policy: (await saved.json())[0] };
}

async function openAI(prompt: string): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + OPENAI_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 2200,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) throw new Error("OpenAI " + response.status + ": " + await response.text());
  const body = await response.json();
  const raw = body.choices?.[0]?.message?.content || "{}";
  return JSON.parse(raw.replace(/```json\n?|```/g, ""));
}

function evaluationPrompt(session: Record<string, unknown>, turns: unknown[]): string {
  return `你是独立的发型审美训练质量评审AI，不是原训练导师。请评价训练是否真正帮助员工自己产生了更具体、更有证据、可迁移的判断。

评审原则：
1. 不因文字长或表达华丽给高分，表达能力与审美观察能力分开。
2. 检查首次回答到最终回答是否增加了图片证据、结构因果、取舍与顾客沟通能力。
3. 检查导师是否一次只推进一个关键点，是否重复、泄露答案、过度推断图片不可见信息。
4. 专业准确性与安全性是硬门槛。员工原话不能成为专业知识标准。
5. improvement_score 可为负数；没有真实改善不得判为有效。
6. 检查人物、风格、发型解剖、适配、客户沟通五项是否真实经过；未回答不能算掌握。
7. 如果是同款重复训练，必须判断本次 unique_takeaway 是否区别于 prior_case_history；换句话重复旧结论应降低有效性。

Session：${JSON.stringify(session).slice(0, 5000)}
完整轮次：${JSON.stringify(turns).slice(0, 18000)}

只输出JSON：
{"problem_tags":[],"strategy_tags":[],"initial_quality":0,"final_quality":0,"improvement_score":0,
"professional_accuracy":0,"guidance_quality":0,"evidence_growth":0,"safety_score":0,
"effective":false,"failure_reason":"","recommended_strategy":"","evaluator_notes":""}`;
}

async function upsertSession(payload: Record<string, unknown>): Promise<void> {
  const goalStates = typeof payload.goal_states === "object" && payload.goal_states ? payload.goal_states as Record<string, unknown> : {};
  const allowedStates = new Set([
    "created", "image_uploaded", "observation_started", "observation_completed",
    "person_analysis_started", "person_analysis_completed", "style_analysis_started",
    "style_analysis_completed", "structure_analysis_started", "structure_analysis_completed",
    "design_started", "design_completed", "communication_started", "communication_completed",
    "evaluation_started", "evaluation_completed", "paused", "finished", "failed",
  ]);
  const requestedState = cleanText(payload.session_state, 40);
  const sessionState = payload.status === "completed" ? "finished" : (allowedStates.has(requestedState) ? requestedState : "observation_started");
  const row = {
    id: cleanText(payload.session_id, 120),
    username: cleanText(payload.username, 80),
    store: cleanText(payload.store, 100),
    business_date: cleanText(payload.business_date, 10),
    case_id: cleanText(payload.case_id, 120),
    case_title: cleanText(payload.case_title, 180),
    status: payload.status === "completed" ? "completed" : "in_progress",
    current_goal: cleanText(payload.current_goal, 40) || "outline",
    turn_count: clamp(payload.turn_count, 0, 100),
    prompt_version: cleanText(payload.prompt_version, 60) || "coach-v1",
    strategy_version: cleanText(payload.strategy_version, 60) || "control-v1",
    model_version: cleanText(payload.model_version, 80),
    session_state: sessionState,
    state_version: clamp(payload.state_version, 1, 1000000),
    last_saved_at: new Date().toISOString(),
    paused_at: sessionState === "paused" ? new Date().toISOString() : null,
    resume_payload: typeof payload.resume_payload === "object" && payload.resume_payload ? payload.resume_payload : {},
    goal_states: {
      ...goalStates,
      _hairVision: {
        active_checkpoint: cleanText(payload.active_checkpoint, 40),
        checkpoint_states: typeof payload.checkpoint_states === "object" && payload.checkpoint_states ? payload.checkpoint_states : {},
        training_plan: typeof payload.training_plan === "object" && payload.training_plan ? payload.training_plan : {},
        elapsed_seconds: clamp(payload.elapsed_seconds, 0, 3600),
        time_phase: cleanText(payload.time_phase, 20),
      },
    },
    summary: typeof payload.summary === "object" && payload.summary ? payload.summary : {},
    updated_at: new Date().toISOString(),
    completed_at: payload.status === "completed" ? new Date().toISOString() : null,
  };
  const response = await rest("aesthetic_training_sessions?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error("session write " + response.status + ": " + await response.text());
}

async function upsertTurns(payload: Record<string, unknown>): Promise<unknown[]> {
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-40) as Record<string, unknown>[] : [];
  const rows: Record<string, unknown>[] = [];
  let employeeAnswer = "";
  let index = 0;
  for (const message of messages) {
    if (message.role === "user") {
      employeeAnswer = cleanText(message.content, 1200);
      continue;
    }
    if (message.role === "assistant" && employeeAnswer) {
      index += 1;
      rows.push({
        session_id: cleanText(payload.session_id, 120),
        turn_index: index,
        employee_answer: employeeAnswer,
        coach_message: cleanText(message.content, 1200),
        active_goal: cleanText((message.meta as Record<string, unknown>)?.goal || payload.current_goal, 40) || "outline",
        response_type: cleanText((message.meta as Record<string, unknown>)?.response_type, 40),
        classification: (message.meta as Record<string, unknown>)?.classification || {},
        repeated_pattern: cleanText((message.meta as Record<string, unknown>)?.repeated_pattern, 180),
        strategy_version: cleanText(payload.strategy_version, 60) || "control-v1",
        model_version: cleanText(payload.model_version, 80),
      });
      employeeAnswer = "";
    }
  }
  if (employeeAnswer) {
    index += 1;
    rows.push({
      session_id: cleanText(payload.session_id, 120),
      turn_index: index,
      employee_answer: employeeAnswer,
      coach_message: "",
      active_goal: cleanText(payload.current_goal, 40) || "outline",
      strategy_version: cleanText(payload.strategy_version, 60) || "control-v1",
      model_version: cleanText(payload.model_version, 80),
    });
  }
  if (rows.length) {
    const response = await rest("aesthetic_training_turns?on_conflict=session_id,turn_index", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error("turn write " + response.status + ": " + await response.text());
  }
  return rows;
}

async function evaluateSession(payload: Record<string, unknown>, turns: unknown[]): Promise<void> {
  const sessionId = cleanText(payload.session_id, 120);
  const result = await openAI(evaluationPrompt(payload, turns));
  const row = {
    session_id: sessionId,
    evaluator_version: EVALUATOR_VERSION,
    evaluator_model: MODEL,
    problem_tags: Array.isArray(result.problem_tags) ? result.problem_tags.slice(0, 12) : [],
    strategy_tags: Array.isArray(result.strategy_tags) ? result.strategy_tags.slice(0, 12) : [],
    initial_quality: clamp(result.initial_quality),
    final_quality: clamp(result.final_quality),
    improvement_score: clamp(result.improvement_score, -100, 100),
    professional_accuracy: clamp(result.professional_accuracy),
    guidance_quality: clamp(result.guidance_quality),
    evidence_growth: clamp(result.evidence_growth),
    safety_score: clamp(result.safety_score),
    effective: result.effective === true && clamp(result.professional_accuracy) >= 80 && clamp(result.safety_score) >= 90,
    failure_reason: cleanText(result.failure_reason, 500),
    recommended_strategy: cleanText(result.recommended_strategy, 1000),
    evaluator_notes: cleanText(result.evaluator_notes, 1200),
    raw_result: result,
  };
  const response = await rest("aesthetic_training_evaluations?on_conflict=session_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error("evaluation write " + response.status + ": " + await response.text());
  await updateExperiment(sessionId, row);
  await maybeGenerateCandidate();
  await reconcileExperiment();
}

async function updateExperiment(sessionId: string, evaluation: Record<string, unknown>): Promise<void> {
  const response = await rest("aesthetic_strategy_experiments?session_id=eq." + encodeURIComponent(sessionId), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      completed: true,
      improvement_score: evaluation.improvement_score,
      professional_accuracy: evaluation.professional_accuracy,
      safety_score: evaluation.safety_score,
    }),
  });
  if (!response.ok) throw new Error("experiment update " + response.status);
}

async function maybeGenerateCandidate(): Promise<void> {
  const countResponse = await rest("aesthetic_training_evaluations?select=id", {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  const total = Number((countResponse.headers.get("content-range") || "/0").split("/")[1]) || 0;
  if (total < CANDIDATE_INTERVAL || total % CANDIDATE_INTERVAL !== 0) return;
  const existing = await rest("aesthetic_coach_strategies?select=id&source_evaluation_count=eq." + total + "&limit=1");
  if (existing.ok && (await existing.json()).length) return;
  const sampleResponse = await rest("aesthetic_training_evaluations?select=problem_tags,strategy_tags,improvement_score,professional_accuracy,guidance_quality,evidence_growth,safety_score,effective,failure_reason,recommended_strategy&order=created_at.desc&limit=100");
  if (!sampleResponse.ok) return;
  const sample = await sampleResponse.json();
  const proposal = await openAI(`你是训练策略优化AI。根据100次独立评审，生成一个仅优化“如何追问”的候选策略，不修改专业知识标准，不改变现有自由聊天体验。
数据：${JSON.stringify(sample).slice(0, 24000)}
只输出JSON：{"instructions":"不超过800字、可直接追加给训练导师的规则","predicted_improvement":0,"professional_risk":0,"safety_risk":0,"rationale":""}`);
  if (clamp(proposal.professional_risk) > 10 || clamp(proposal.safety_risk) > 5 || clamp(proposal.predicted_improvement) < 5) return;
  const version = "candidate-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + total;
  await rest("aesthetic_coach_strategies", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      version,
      status: "experiment",
      instructions: cleanText(proposal.instructions, 2000),
      source_evaluation_count: total,
      validation_score: clamp(proposal.predicted_improvement),
      experiment_percent: 10,
      parent_version: "control-v1",
      metrics: proposal,
      activated_at: new Date().toISOString(),
    }),
  });
}

async function reconcileExperiment(): Promise<void> {
  const strategyResponse = await rest("aesthetic_coach_strategies?select=version,minimum_samples,minimum_accuracy,minimum_safety,minimum_improvement&status=eq.experiment&order=activated_at.desc&limit=1");
  if (!strategyResponse.ok) return;
  const strategies = await strategyResponse.json();
  const strategy = strategies[0];
  if (!strategy) return;
  const resultResponse = await rest(
    "aesthetic_strategy_experiments?select=improvement_score,professional_accuracy,safety_score&strategy_version=eq." +
    encodeURIComponent(strategy.version) + "&completed=eq.true&limit=1000",
  );
  if (!resultResponse.ok) return;
  const results = await resultResponse.json();
  if (results.length < Number(strategy.minimum_samples || 100)) return;
  const average = (key: string) => results.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row[key] || 0), 0) / results.length;
  const metrics = {
    samples: results.length,
    improvement: average("improvement_score"),
    professional_accuracy: average("professional_accuracy"),
    safety: average("safety_score"),
  };
  const passed = metrics.improvement >= Number(strategy.minimum_improvement || 5) &&
    metrics.professional_accuracy >= Number(strategy.minimum_accuracy || 90) &&
    metrics.safety >= Number(strategy.minimum_safety || 95);
  const response = await rest("aesthetic_coach_strategies?version=eq." + encodeURIComponent(strategy.version), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: passed ? "active" : "rejected",
      experiment_percent: passed ? 100 : 0,
      metrics,
      activated_at: passed ? new Date().toISOString() : null,
    }),
  });
  if (!response.ok) throw new Error("strategy reconcile " + response.status);
}

function stableBucket(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  return Math.abs(hash) % 100;
}

async function assignStrategy(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sessionId = cleanText(payload.session_id, 120);
  const response = await rest("aesthetic_coach_strategies?select=version,status,instructions,experiment_percent&status=in.(experiment,active,control)&order=activated_at.desc.nullslast,created_at.desc");
  if (!response.ok) return { version: "control-v1", instructions: "" };
  const strategies = await response.json();
  const experiment = strategies.find((row: Record<string, unknown>) => row.status === "experiment");
  const active = strategies.find((row: Record<string, unknown>) => row.status === "active") ||
    strategies.find((row: Record<string, unknown>) => row.status === "control");
  const selected = experiment && stableBucket(sessionId) < Number(experiment.experiment_percent || 0) ? experiment : active;
  const cohort = selected?.status === "experiment" ? "experiment" : "control";
  await rest("aesthetic_strategy_experiments?on_conflict=session_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ session_id: sessionId, strategy_version: selected?.version || "control-v1", cohort }),
  });
  return { version: selected?.version || "control-v1", instructions: cleanText(selected?.instructions, 2000), cohort };
}

async function caseHistory(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const username = cleanText(payload.username, 80);
  const caseId = cleanText(payload.case_id, 120);
  const response = await rest(
    "aesthetic_training_sessions?select=summary,goal_states,completed_at&username=eq." + encodeURIComponent(username) +
    "&case_id=eq." + encodeURIComponent(caseId) + "&status=eq.completed&order=completed_at.desc&limit=20",
    { headers: { Prefer: "count=exact", Range: "0-19" } },
  );
  if (!response.ok) throw new Error("case history " + response.status);
  const rows = await response.json();
  return {
    completed_count: Number((response.headers.get("content-range") || "/" + rows.length).split("/")[1]) || rows.length,
    prior_takeaways: rows.slice(0, 5).map((row: Record<string, unknown>) => ({
      unique_takeaway: cleanText((row.summary as Record<string, unknown>)?.unique_takeaway || (row.summary as Record<string, unknown>)?.transferable_method, 600),
      training_plan: (row.goal_states as Record<string, unknown>)?._hairVision && ((row.goal_states as Record<string, unknown>)._hairVision as Record<string, unknown>).training_plan || {},
      completed_at: row.completed_at,
    })),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: cors });
  if (!SERVICE_KEY || !OPENAI_KEY) return new Response(JSON.stringify({ error: "service not configured" }), { status: 503, headers: cors });
  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: cors }); }
  const username = cleanText(payload.username, 80);
  const store = cleanText(payload.store, 100);
  const operation = cleanText(payload.operation, 40);
  try {
    if (operation === "admin_login") return new Response(JSON.stringify(await adminLogin(payload)), { headers: cors });
    if (operation === "admin_overview") return new Response(JSON.stringify(await adminTrainingOverview(payload)), { headers: cors });
    if (operation === "admin_update_policy") return new Response(JSON.stringify(await adminUpdateTrainingPolicy(payload)), { headers: cors });
    if (operation === "admin_knowledge_overview") return new Response(JSON.stringify(await adminKnowledgeOverview(payload)), { headers: cors });
    if (operation === "admin_create_knowledge_candidate") return new Response(JSON.stringify(await adminCreateKnowledgeCandidate(payload)), { headers: cors });
    if (operation === "admin_review_knowledge_candidate") return new Response(JSON.stringify(await adminReviewKnowledgeCandidate(payload)), { headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 403, headers: cors });
  }
  if (!username || !(await activeEmployee(username, store))) return new Response(JSON.stringify({ error: "inactive staff" }), { status: 403, headers: cors });
  try {
    if (operation === "training_entitlement") {
      return new Response(JSON.stringify(await trainingEntitlement(payload)), { headers: cors });
    }
    if (operation === "assign_strategy") {
      const assigned = await assignStrategy(payload);
      return new Response(JSON.stringify(assigned), { headers: cors });
    }
    if (operation === "case_history") {
      const history = await caseHistory(payload);
      return new Response(JSON.stringify(history), { headers: cors });
    }
    if (!["sync_session", "complete_session"].includes(operation)) return new Response(JSON.stringify({ error: "invalid operation" }), { status: 400, headers: cors });
    const entitlement = await trainingEntitlement(payload);
    if (!entitlement.allowed) return new Response(JSON.stringify({ error: "training unavailable", entitlement }), { status: 429, headers: cors });
    await upsertSession({ ...payload, status: operation === "complete_session" ? "completed" : "in_progress" });
    const turns = await upsertTurns(payload);
    if (operation === "complete_session") {
      EdgeRuntime.waitUntil(evaluateSession(payload, turns));
      return new Response(JSON.stringify({ saved: true, evaluation: "queued", evaluator_version: EVALUATOR_VERSION }), { status: 202, headers: cors });
    }
    return new Response(JSON.stringify({ saved: true }), { headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 502, headers: cors });
  }
});
