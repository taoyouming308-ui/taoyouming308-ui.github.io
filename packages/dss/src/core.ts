export const DSS_STYLES = [
  "natural", "french", "korean", "japanese", "urban", "minimal", "sweet", "androgynous", "avant_garde",
] as const;

export const STYLE_TYPE_SYSTEMS = {
  dssNine: { id: "SCH.DSS.NINE.HAIR", status: "published", role: "hair_style_synthesis" },
  cnEight: { id: "SCH.CN.EIGHT.BASELINE", status: "sourced_reference", role: "personal_image_reference" },
  cnNine: { id: "SCH.CN.NINE.PROVISIONAL", status: "provisional", role: "school_specific_mapping" },
} as const;

export const STYLE_AESTHETIC_DOMAINS = ["VIS", "PER", "STY", "DES", "HAI", "TRN", "SCR"] as const;

export const COACH_GOALS = [
  "outline", "weight", "layers", "line_texture", "style", "suitability", "technique", "client_communication",
] as const;

export const HAIR_VISION_CHECKPOINTS = [
  "human_analysis", "style", "hair_anatomy", "suitability", "client_communication",
] as const;

export const HAIR_VISION_TIMING = {
  targetSeconds: 300,
  closingSeconds: 270,
  hardStopSeconds: 360,
} as const;

export const STAGE_RULES: Record<string, string> = {
  observe: "DSS visual scan. Evaluate only directly visible facts: length, outline, line direction, weight location, layers, texture, curl and color. Flag style labels, suitability claims and technical guesses at this stage.",
  analyze: "DSS structure. Check relationships among top, sides, back and face-frame: support, connection, weight, focus, stable areas and moving areas. Do not accept a repeated list of surface observations as analysis.",
  judge: "DSS nine-style synthesis. Require one primary, at most one secondary, at least three visual evidence points and one counter-signal.",
  design: "DSS technical translation. Start from visual results that must be preserved, then test outline, layers, weight, face-frame, texture and styling hypotheses. Require explicit unknowns.",
  review: "DSS person adaptation. Check what to keep, adjust or abandon for the person's target, head/face proportions, real hair properties, context and maintenance capacity. Require trade-offs and an alternative plan.",
};

export const STAGE_MODULES: Record<string, string[]> = {
  observe: ["style", "outline", "layers", "bangs", "texture", "color", "uncertainties"],
  analyze: ["outline", "layers", "bangs", "texture", "curlStyling", "cuttingLogic", "uncertainties"],
  judge: ["style", "outline", "layers", "texture", "curlStyling", "color", "uncertainties"],
  design: ["outline", "layers", "bangs", "texture", "curlStyling", "color", "cuttingLogic", "maintenance", "uncertainties"],
  review: ["style", "outline", "layers", "suitability", "cuttingLogic", "maintenance", "uncertainties"],
};
