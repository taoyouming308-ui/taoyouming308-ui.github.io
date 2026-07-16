export type AestheticOutputKind = "analysis" | "coach_turn" | "session_summary" | "stage_feedback";

export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };

const COACH_GOALS = new Set(["outline", "weight", "layers", "line_texture", "style", "suitability", "technique", "client_communication"]);
const CHECKPOINTS = new Set(["human_analysis", "style", "hair_anatomy", "suitability", "client_communication"]);
const RESPONSE_TYPES = new Set(["probe", "hint", "challenge", "explain", "transition", "wrap_up"]);

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max = 4000): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function stringArray(value: unknown, maxItems = 8): boolean {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => typeof item === "string");
}

export function validateAestheticOutput(kind: AestheticOutputKind, value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!object(value)) return { ok: false, errors: ["root must be an object"] };

  if (kind === "analysis") {
    if (!text(value.summary, 600)) errors.push("summary must be non-empty text");
    if (!text(value.fullAnalysis, 4000)) errors.push("fullAnalysis must be non-empty text");
    if (!object(value.modules)) errors.push("modules must be an object");
    else if (!object(value.modules.uncertainties)) errors.push("modules.uncertainties is required");
  }

  if (kind === "coach_turn") {
    if (!text(value.message, 600)) errors.push("message must be 1-600 characters");
    if (!RESPONSE_TYPES.has(String(value.response_type || ""))) errors.push("response_type is invalid");
    if (!COACH_GOALS.has(String(value.active_goal || ""))) errors.push("active_goal is invalid");
    if (!CHECKPOINTS.has(String(value.active_checkpoint || ""))) errors.push("active_checkpoint is invalid");
    if (!object(value.goal_states)) errors.push("goal_states must be an object");
    if (!object(value.checkpoint_states)) errors.push("checkpoint_states must be an object");
    if (!object(value.classification)) errors.push("classification must be an object");
    if (!object(value.checkpoint_evaluation)) errors.push("checkpoint_evaluation must be an object");
    else {
      if (!["mastered", "needs_evidence"].includes(String(value.checkpoint_evaluation.status || ""))) errors.push("checkpoint_evaluation.status is invalid");
      const evidenceCount = Number(value.checkpoint_evaluation.evidence_count);
      if (!Number.isFinite(evidenceCount) || evidenceCount < 0 || evidenceCount > 8) errors.push("checkpoint_evaluation.evidence_count must be 0-8");
    }
    if (!object(value.knowledge_seed)) errors.push("knowledge_seed must be an object");
  }

  if (kind === "session_summary") {
    for (const key of ["strengths", "missed_points", "misconception_patterns", "ability_changes"]) {
      if (!stringArray(value[key], 4)) errors.push(`${key} must be an array with at most 4 strings`);
    }
    if (!text(value.transferable_method, 1200)) errors.push("transferable_method must be non-empty text");
    if (!text(value.next_focus, 800)) errors.push("next_focus must be non-empty text");
    for (const key of ["new_knowledge", "observation_method", "communication_tip", "golden_insight", "today_breakthrough", "yesterday_comparison", "today_tag"]) {
      if (!text(value[key], 1200)) errors.push(`${key} must be non-empty text`);
    }
  }

  if (kind === "stage_feedback") {
    for (const key of ["score", "completion"]) {
      const number = Number(value[key]);
      if (!Number.isFinite(number) || number < 0 || number > 100) errors.push(`${key} must be 0-100`);
    }
    if (typeof value.ready !== "boolean") errors.push("ready must be boolean");
    if (!object(value.metrics)) errors.push("metrics must be an object");
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function outputRepairPrompt(kind: AestheticOutputKind, raw: string, errors: string[]): string {
  return `修复下面的模型JSON输出。只能修复结构和字段类型，不得添加图片中不存在的事实。\n输出类型：${kind}\n校验错误：${errors.join("; ")}\n原始输出：${raw.slice(0, 14000)}\n只输出修复后的JSON对象，不要解释。`;
}
