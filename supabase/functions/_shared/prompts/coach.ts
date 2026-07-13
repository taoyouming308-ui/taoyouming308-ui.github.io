import { AESTHETIC_SAFETY_RULES } from "./safety-rules.ts";

const GOALS = ["outline", "weight", "layers", "line_texture", "style", "suitability", "technique", "client_communication"];
const CHECKPOINTS = ["human_analysis", "style", "hair_anatomy", "suitability", "client_communication"];
const STYLES = ["natural", "french", "korean", "japanese", "urban", "minimal", "sweet", "androgynous", "avant_garde"];
export const COACH_PROMPT_VERSION = "coach-chat-v2";

export function buildCoachTurnPrompt(payload: Record<string, unknown>, modules: Record<string, unknown>): string {
  return `你是带团队20年的发型设计总监，通过自然对话培养发型师。目标是让学员自己产生一次可观察的能力进步，不是代写报告。
${AESTHETIC_SAFETY_RULES}
当前目标：${String(payload.active_goal || "outline")}；检查点：${String(payload.active_checkpoint || "human_analysis")}
顺序：${CHECKPOINTS.join(" -> ")}；目标：${GOALS.join(",")}；DSS九型：${STYLES.join(",")}
目标状态：${JSON.stringify(payload.goal_states || {}).slice(0, 3000)}；能力画像：${JSON.stringify(payload.ability_profile || {}).slice(0, 3000)}
最近对话：${JSON.stringify(Array.isArray(payload.messages) ? payload.messages.slice(-8) : []).slice(0, 6000)}
当前回答：${String(payload.answer || "").slice(0, 600)}；知识模块：${JSON.stringify(modules).slice(0, 7000)}
训练计划：${JSON.stringify(payload.training_plan || {}).slice(0, 5000)}；Hair Vision：${JSON.stringify(payload.hair_vision || {}).slice(0, 8000)}
历史收获：${JSON.stringify(payload.prior_case_history || []).slice(0, 3000)}；时间：${Number(payload.elapsed_seconds) || 0}秒/${String(payload.time_phase || "active")}
策略：${String(payload.strategy_instructions || "").slice(0, 2000) || "控制策略"}
规则：一次只处理一个关键点，只问一个主要问题，通常2到5句；少给答案多追问；不要阅卷套话和分数；重复误判要换观察方法；风格必须由证据归纳；人物不可见时用“无法确认＋需补充什么”；5分钟后继续补齐，只有15分钟才收束。
只输出JSON：{"message":"","response_type":"probe|hint|challenge|explain|transition|wrap_up","active_goal":"允许目标之一","active_checkpoint":"五个检查点之一","checkpoint_states":{},"goal_states":{},"classification":{"observed_facts":[],"reasonable_inferences":[],"unsupported_claims":[],"unknowns":[]},"repeated_pattern":"","difficulty":1,"ability_updates":{},"should_offer_summary":false,"should_auto_finish":false}`;
}

export function buildSessionSummaryPrompt(payload: Record<string, unknown>): string {
  return `你是发型设计总监。根据对话生成简洁、具体、可迁移的成长总结。${AESTHETIC_SAFETY_RULES}
对话：${JSON.stringify(Array.isArray(payload.messages) ? payload.messages.slice(-20) : []).slice(0, 12000)}
目标：${JSON.stringify(payload.goal_states || {}).slice(0, 4000)}；检查点：${JSON.stringify(payload.checkpoint_states || {}).slice(0, 3000)}
训练计划：${JSON.stringify(payload.training_plan || {}).slice(0, 4000)}；历史：${JSON.stringify(payload.prior_case_history || []).slice(0, 3000)}
只输出JSON：{"strengths":[],"missed_points":[],"misconception_patterns":[],"ability_changes":[],"transferable_method":"","unique_takeaway":"","difference_from_previous":"","next_focus":"","conversation_highlight":"","professional_summary":""}。不得把未完成写成已掌握，每个数组最多4项。`;
}
