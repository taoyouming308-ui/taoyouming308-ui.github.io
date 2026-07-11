export const AESTHETIC_OPERATIONS = ["analyze_image", "feedback", "revise_analysis", "coach_turn", "summarize_session"] as const;

export type AestheticOperation = typeof AESTHETIC_OPERATIONS[number];

export function isAestheticOperation(value: string): value is AestheticOperation {
  return AESTHETIC_OPERATIONS.includes(value as AestheticOperation);
}
