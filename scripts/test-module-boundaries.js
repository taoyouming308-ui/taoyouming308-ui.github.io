const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { console.error('FAIL:', message); process.exit(1); };
const requireMarker = (source, marker, file) => {
  if (!source.includes(marker)) fail(`${file} is missing ${marker}`);
};

const dss = read('packages/dss/src/core.ts');
const prompts = read('packages/prompts/src/aesthetic-coach.ts');
const contracts = read('packages/analysis-engine/src/contracts.ts');
const architecture = read('ARCHITECTURE.md');

['DSS_STYLES', 'STAGE_RULES', 'STAGE_MODULES', 'COACH_GOALS'].forEach((marker) => requireMarker(dss, marker, 'packages/dss/src/core.ts'));
['buildCoachTurnPrompt', 'buildSessionSummaryPrompt', 'buildAnalysisPrompt', 'buildStageFeedbackPrompt'].forEach((marker) => requireMarker(prompts, marker, 'packages/prompts/src/aesthetic-coach.ts'));
['AESTHETIC_OPERATIONS', 'isAestheticOperation'].forEach((marker) => requireMarker(contracts, marker, 'packages/analysis-engine/src/contracts.ts'));
['Prompt', 'DSS', 'Supabase', '上下文'].forEach((marker) => requireMarker(architecture, marker, 'ARCHITECTURE.md'));

const pagePromptPatterns = [/你是遵循 DSS V1\.0 的资深/, /You are a DSS V1\.0 hair design mentor/];
for (const page of ['perm-app.html', 'admin.html']) {
  const source = read(page);
  for (const pattern of pagePromptPatterns) if (pattern.test(source)) fail(`${page} contains a server model prompt`);
}

console.log('module boundary test ok');
