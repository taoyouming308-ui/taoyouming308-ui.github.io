// Canonical prompt implementations live with the deployable Supabase shared bundle.
// Re-exporting keeps package consumers and the deployed Edge Function on one source.
export { buildAnalysisPrompt, ANALYSIS_PROMPT_VERSION } from "../../../supabase/functions/_shared/prompts/analysis.ts";
export { buildCoachTurnPrompt, buildSessionSummaryPrompt, COACH_PROMPT_VERSION } from "../../../supabase/functions/_shared/prompts/coach.ts";
export { AESTHETIC_SAFETY_RULES } from "../../../supabase/functions/_shared/prompts/safety-rules.ts";
export { buildStageFeedbackPrompt, EVALUATION_PROMPT_VERSION } from "../../../supabase/functions/_shared/prompts/evaluation.ts";
