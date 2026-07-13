import { AESTHETIC_SAFETY_RULES } from "./safety-rules.ts";

export const ANALYSIS_PROMPT_VERSION = "analysis-v2";

export function buildAnalysisPrompt(caseData: Record<string, unknown>, extraFacts = "", previousModules: Record<string, unknown> = {}): string {
  return `你是遵循 DSS V1.0 的资深发型设计教育导师。先观察人物与图片事实，再归纳风格和结构。${AESTHETIC_SAFETY_RULES}
案例：${String(caseData.title || "").slice(0, 120)}；分类：${String(caseData.category || "").slice(0, 80)}
限制：${String(caseData.limitations || "").slice(0, 500)}；用户补充：${extraFacts || "无"}
已有模块：${JSON.stringify(previousModules).slice(0, 9000) || "无"}
只输出JSON：{"fullAnalysis":"不超过650字","summary":"不超过120字","modules":{"style|outline|layers|bangs|texture|curlStyling|color|suitability|cuttingLogic|maintenance|uncertainties":{"conclusion":"","observations":[],"inferences":[],"evidence":[],"conflicts":[],"confidence":0,"requestedInputs":[]}},"affectedModules":[]}。首次分析11个模块必须存在；修订只返回受影响模块；低于60置信度只能写成推测。`;
}
