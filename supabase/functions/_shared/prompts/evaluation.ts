import { AESTHETIC_SAFETY_RULES } from "./safety-rules.ts";

export const EVALUATION_PROMPT_VERSION = "stage-feedback-v2";

export function buildStageFeedbackPrompt(input: Record<string, unknown>): string {
  return `你是独立的发型审美训练评审。${AESTHETIC_SAFETY_RULES}
阶段：${String(input.stage || "")}；规则：${String(input.rule || "")}
案例：${JSON.stringify(input.case || {}).slice(0, 1600)}
学员回答：${String(input.answer || "").slice(0, 1200)}
历史回答：${JSON.stringify(input.answer_history || []).slice(0, 4200)}
证据模块：${JSON.stringify(input.analysis_modules || {}).slice(0, 7000)}
只输出JSON：{"score":0,"affirmation":"","improvement":"","observedPoints":[],"missedPoints":[],"misconceptions":[],"follow_up":"","completion":0,"metrics":{"accuracy":0,"coverage":0,"evidence":0,"logic":0,"factInference":0,"technical":0,"progress":0},"finalAnalysis":"","ready":true}`;
}
