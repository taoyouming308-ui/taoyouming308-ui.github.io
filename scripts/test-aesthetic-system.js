const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'aesthetic-knowledge.v1.js'), 'utf8');
const hairVisionSource = fs.readFileSync(path.join(root, 'hair-vision-training.v1.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'perm-app.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const coachEdge = fs.readFileSync(path.join(root, 'supabase/functions/aesthetic-coach/index.ts'), 'utf8');
const learningEdge = fs.readFileSync(path.join(root, 'supabase/functions/aesthetic-learning/index.ts'), 'utf8');
const learningMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260711090000_aesthetic_learning_loop.sql'), 'utf8');
const managementMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260712090000_aesthetic_training_management.sql'), 'utf8');
const schemaMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260713140000_aesthetic_schema_state_machine.sql'), 'utf8');
const knowledgeMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260713170000_aesthetic_knowledge_acquisition.sql'), 'utf8');
const starterKnowledgeMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260713190000_seed_aesthetic_starter_candidates.sql'), 'utf8');
const outputSchema = fs.readFileSync(path.join(root, 'supabase/functions/_shared/aesthetic-output-schema.ts'), 'utf8');
const analysisPrompt = fs.readFileSync(path.join(root, 'supabase/functions/_shared/prompts/analysis.ts'), 'utf8');
const coachPrompt = fs.readFileSync(path.join(root, 'supabase/functions/_shared/prompts/coach.ts'), 'utf8');
const evaluationPrompt = fs.readFileSync(path.join(root, 'supabase/functions/_shared/prompts/evaluation.ts'), 'utf8');
const context = { window: {} };

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

vm.createContext(context);
vm.runInContext(source, context);
vm.runInContext(hairVisionSource, context);

const data = context.window.AESTHETIC_KNOWLEDGE_V1;
const hairVision = context.window.HAIR_VISION_TRAINING_V1;
assert(data, 'knowledge catalog did not initialize');
assert(hairVision, 'Hair Vision runtime did not initialize');
assert(hairVision.targetMs === 300000, 'Hair Vision training target must be 5 minutes');
assert(hairVision.closingMs === 270000, 'Hair Vision must start closing at 4:30');
assert(hairVision.hardStopMs === 900000, 'Hair Vision hard stop must be 15 minutes');
assert(JSON.stringify(hairVision.checkpoints.map(row => row.id)) === JSON.stringify(['human_analysis', 'style', 'hair_anatomy', 'suitability', 'client_communication']), 'five hidden checkpoints are required');

const phaseAt = milliseconds => hairVision.timeStateFromElapsed(milliseconds).phase;
assert(phaseAt(269999) === 'active', 'before 4:30 must remain active');
assert(phaseAt(270000) === 'closing', '4:30 must start closing');
assert(phaseAt(300000) === 'extended', '5:00 must allow continued training');
assert(phaseAt(899999) === 'extended', 'training must remain available before 15:00');
assert(phaseAt(900000) === 'overtime', '15:00 must safely finish');
assert(hairVision.normalizeSessionState('paused') === 'paused', 'paused sessions must be resumable');
assert(hairVision.normalizeSessionState('unknown') === 'created', 'unknown session states must safely normalize');
assert(hairVision.stateForCheckpoint('client_communication', false, false) === 'communication_started', 'communication checkpoint must map to state machine');
assert(hairVision.stateForCheckpoint('style', false, true) === 'finished', 'completed sessions must map to finished');

const repeatedPlans = Array.from({ length: 6 }, (_, exposureCount) => hairVision.buildPlan({ identity: '测试员工', caseKey: 'CASE-001:image-hash', exposureCount }));
assert(new Set(repeatedPlans.map(plan => plan.variantId)).size === 6, 'repeat sessions need unique variants');
assert(new Set(repeatedPlans.map(plan => plan.lessonSignature)).size === 6, 'repeat sessions need unique lesson signatures');
assert(new Set(repeatedPlans.slice(0, 5).map(plan => plan.deepFocus)).size === 5, 'first five repeats must rotate every deep focus');
assert(new Set(repeatedPlans.map(plan => plan.styleContrast.id)).size === 6, 'style contrasts must rotate before repeating');
assert(new Set(repeatedPlans.slice(0, 5).map(plan => plan.humanLens)).size === 5, 'human lenses must rotate');
assert(new Set(repeatedPlans.map(plan => plan.anatomyLens)).size === 6, 'anatomy lenses must rotate');
assert(new Set(repeatedPlans.map(plan => plan.adaptationScenario)).size === 6, 'adaptation scenarios must rotate');
assert(new Set(repeatedPlans.map(plan => plan.clientScenario)).size === 6, 'client scenarios must rotate');
assert(hairVision.openingQuestion(repeatedPlans[0]) !== hairVision.openingQuestion(repeatedPlans[1]), 'repeat sessions need different openings');
assert(hairVision.openingQuestion(repeatedPlans[1]).includes('第2次训练'), 'repeat opening must explain its new entry point');
assert(coachEdge.includes('const shouldAutoFinish = allCovered || timePhase === "overtime";'), 'coach must not auto-finish merely because five minutes or five turns elapsed');
assert(!coachEdge.includes('["grace", "overtime"].includes(timePhase)'), 'legacy five-minute auto-finish rule must stay removed');
assert(/^\d+\.\d+\.\d+$/.test(data.version), 'knowledge version must use semantic versioning');
assert(data.status === 'published', 'knowledge catalog must declare published status');
assert(Array.isArray(data.modules) && data.modules.length >= 9, 'nine curriculum modules are required');
assert(Array.isArray(data.sources) && data.sources.length >= 10, 'source catalog is incomplete');
assert(Array.isArray(data.questions) && data.questions.length >= 15, 'training question bank is too small');
assert(Array.isArray(data.capabilities) && data.capabilities.length === 5, 'five core capabilities are required');
assert(Array.isArray(data.trainingFlow) && data.trainingFlow.length === 5, 'five-stage guided flow is required');
assert(data.guidedConversation && data.guidedConversation.mode === 'hidden-goal-chat', 'guided conversation mode is required');
assert(Array.isArray(data.guidedConversation.goals) && data.guidedConversation.goals.length >= 8, 'guided conversation goals are incomplete');
assert(data.guidedConversation.goals.some(row => row.id === 'client_communication'), 'client communication goal is required');
assert(Array.isArray(data.trainingCases) && data.trainingCases.length >= 5, 'guided training cases are incomplete');
assert(Array.isArray(data.rubric) && data.rubric.reduce((sum, row) => sum + row.weight, 0) === 100, 'rubric weights must total 100');
assert(data.hairVision && data.hairVision.systems.length === 4, 'four Hair Vision systems are required');
assert(data.hairVision.styleDNA.length === 9, 'nine style DNA records are required');
data.hairVision.styleDNA.forEach(style => {
  ['coreFeeling', 'outline', 'weight', 'layers', 'line', 'texture', 'neighborDifference', 'transformation', 'counterSignal'].forEach(field => assert(style[field], `style ${style.id} is missing ${field}`));
});
['outer_outline', 'inner_outline', 'length', 'weight', 'layers', 'bangs', 'ends', 'debulking', 'texture', 'color', 'tool_marks', 'blow_dry'].forEach(id => assert(data.hairVision.anatomy.some(row => row.id === id), `hair anatomy is missing ${id}`));
assert(JSON.stringify(data.hairVision.styleDNA.map(row => row.id)) === JSON.stringify(data.styleLibrary.map(row => row.id)), 'style DNA and style library ids must remain aligned');

const sourceIds = new Set(data.sources.map(row => row.id));
const moduleIds = new Set(data.modules.map(row => row.id));
const capabilityIds = new Set(data.capabilities.map(row => row.id));
const stageIds = new Set(data.trainingFlow.map(row => row.id));
assert(sourceIds.size === data.sources.length, 'source ids must be unique');
assert(moduleIds.size === data.modules.length, 'module ids must be unique');
assert(new Set(data.questions.map(row => row.id)).size === data.questions.length, 'question ids must be unique');

data.sources.forEach(row => {
  assert(row.layer && row.type && row.title && row.publisher, `source ${row.id} is missing required metadata`);
  assert(row.rights && row.reviewStatus && row.reviewedAt, `source ${row.id} is missing governance metadata`);
  assert(!row.url || /^https:\/\//.test(row.url), `source ${row.id} must use an HTTPS URL`);
});

data.modules.forEach(row => {
  assert(Array.isArray(row.sourceIds) && row.sourceIds.length > 0, `module ${row.id} has no sources`);
  row.sourceIds.forEach(id => assert(sourceIds.has(id), `module ${row.id} references unknown source ${id}`));
});

data.questions.forEach(row => {
  assert(moduleIds.has(row.moduleId), `question ${row.id} references unknown module`);
  assert(Array.isArray(row.options) && row.options.length >= 3, `question ${row.id} needs at least three options`);
  assert(Number.isInteger(row.answer) && row.answer >= 0 && row.answer < row.options.length, `question ${row.id} answer is invalid`);
  assert(row.explanation && row.dimension, `question ${row.id} is missing explanation or scoring dimension`);
  assert(capabilityIds.has(row.dimension), `question ${row.id} uses unknown capability ${row.dimension}`);
  row.sourceIds.forEach(id => assert(sourceIds.has(id), `question ${row.id} references unknown source ${id}`));
});

data.trainingFlow.forEach(row => {
  assert(capabilityIds.has(row.capabilityId), `stage ${row.id} references unknown capability`);
  assert(row.question && row.rule && row.coachAction, `stage ${row.id} lacks guided training copy`);
});

data.trainingCases.forEach(row => {
  assert(row.estimatedMinutes === 5, `case ${row.id} must be a five-minute mission`);
  assert(/^https:\/\/taoyouming308-ui\.github\.io\/img\//.test(row.imageUrl), `case ${row.id} image is outside the approved training host`);
  assert(row.limitations, `case ${row.id} must state image limitations`);
  stageIds.forEach(id => {
    assert(row.guides && row.guides[id], `case ${row.id} lacks ${id} guidance`);
    assert(row.guides[id].prompts.length >= 3 && row.guides[id].master, `case ${row.id} ${id} guidance is incomplete`);
  });
});

[
  "openHomeDrawerFeature('aesthetic')",
  'id="tab-aesthetic"',
  'startAestheticTraining()',
  'sendAestheticChatMessage()',
  'finishAestheticConversation()',
  'showAestheticProgressiveHint()',
  'id="ae-chat-messages"',
  'id="ae-chat-input"',
  "operation: 'coach_turn'",
  "operation: 'summarize_session'",
  'showAestheticMaster()',
  'aestheticLowQualityReason(',
  'aestheticCoachImageUrl(',
  'feedback.ready !== false',
  "base + '/api/aesthetic-coach'",
  '/functions\\/v1\\/aesthetic-coach',
  '当前状态为“等待点评”，不是“未通过”',
  'AESTHETIC_MAX_SUPPLEMENTS = 3',
  'AESTHETIC_MAX_REVIEWS = 1 + AESTHETIC_MAX_SUPPLEMENTS',
  "feedback.ready !== false || reachedReviewLimit",
  '3次补充点评已完成，现在可以进入下一步',
  '补充后再评（还可',
  "aestheticTrainingState.submissions[flow.id] = requestedReview",
  "operation: 'analyze_image'",
  "operation: 'feedback'",
  "operation: 'revise_analysis'",
  'hair_aesthetic_analysis_v1:',
  'analysis_modules: record.current.modules',
  'answer_history: aestheticTrainingState.answerHistory[flow.id]',
  'feedback_history: aestheticTrainingState.feedbackHistory[flow.id]',
  '图片专属完整分析底稿',
  'hair_aesthetic_ability_v1:',
  'observed_points',
  'misconceptions',
  '当前观察完整度',
  'showAestheticStageAnalysis()',
  'final_request: finalRequest === true',
  "coachHeaders.Authorization = 'Bearer ' + SUPABASE_KEY",
  'hair_aesthetic_progress_v1:',
  'hair_aesthetic_session_v1:',
  'function saveAestheticSession()',
  'function loadAestheticSession()',
  'currentStep: aestheticTrainingState.activeGoal',
  'status: \'in_progress\'',
  'oninput="saveAestheticDraft()"',
  '继续今日训练',
  'id="ae-kpi-points"',
  'id="ae-kpi-rate"',
  'id="ae-kpi-streak"',
  'points: points',
  'AESTHETIC_LEARNING_ENDPOINT',
  "postAestheticLearning('sync_session')",
  "postAestheticLearning('complete_session')",
  'strategy_instructions: aestheticTrainingState.strategyInstructions',
  'hair-vision-training.v1.js?v=378',
  'runtime.openingQuestion(aestheticTrainingState.trainingPlan',
  'hair_vision: aestheticHairVisionContext()',
  'prior_case_history: aestheticPriorCaseHistory(item)',
  'active_checkpoint:',
  'checkpoint_states:',
  'stopAestheticTrainingTimer()',
  'completionCommitted',
  'caseKey: aestheticTrainingCaseKey',
  'elapsedSeconds: currentAestheticTimeState().elapsedSeconds',
  'unique_takeaway',
  'difference_from_previous',
  'aesthetic-knowledge.v1.js'
].forEach(marker => assert(app.includes(marker), `App is missing marker: ${marker}`));

[
  'data-tab="aesthetic"',
  'data-tab="training"',
  'id="tab-training"',
  'loadTrainingManagement()',
  "trainingAdminRequest('admin_update_policy'",
  'id="tab-aesthetic"',
  'openAestheticCandidateModal()',
  'loadAestheticAdmin()',
  'AESTHETIC_CANDIDATE_KEY',
  'aesthetic-knowledge.v1.js'
].forEach(marker => assert(admin.includes(marker), `Admin is missing marker: ${marker}`));

['daily_limit integer not null default 1', 'access_status', 'aesthetic_training_admin_audit', 'drop constraint if exists aesthetic_training_sessions_username_business_date_key'].forEach(marker => assert(managementMigration.includes(marker), `Training management migration is missing marker: ${marker}`));
['DEFAULT_DAILY_LIMIT = 1', 'training_entitlement', 'admin_overview', 'admin_update_policy', 'admin_login'].forEach(marker => assert(learningEdge.includes(marker), `Learning edge is missing training management marker: ${marker}`));
['admin_knowledge_overview', 'admin_create_knowledge_candidate', 'admin_review_knowledge_candidate', 'approval requires copyright and safety clearance'].forEach(marker => assert(learningEdge.includes(marker), `Learning edge is missing knowledge governance marker: ${marker}`));
['session_state', 'resume_payload', 'aesthetic_model_outputs', 'aesthetic_ability_history'].forEach(marker => assert(schemaMigration.includes(marker), `Schema/state migration is missing marker: ${marker}`));
['aesthetic_knowledge_sources', 'aesthetic_knowledge_candidates', 'aesthetic_knowledge_reviews', 'aesthetic_case_evidence', 'enable row level security', 'revoke all'].forEach(marker => assert(knowledgeMigration.includes(marker), `Knowledge migration is missing marker: ${marker}`));
assert((starterKnowledgeMigration.match(/^  \('/gm) || []).length === 30, 'starter knowledge pack must contain exactly 30 review candidates');
assert(starterKnowledgeMigration.includes("'pending_review', 'system-starter-v1'"), 'starter knowledge must remain pending expert review');
assert(!starterKnowledgeMigration.includes("'published', 'system-starter-v1'"), 'starter knowledge must never auto-publish');
['validateAestheticOutput', 'outputRepairPrompt', 'coach_turn', 'session_summary'].forEach(marker => assert(outputSchema.includes(marker), `Output schema is missing marker: ${marker}`));
assert(coachEdge.includes('model output schema invalid after repair'), 'coach must fail safely after one unsuccessful repair');
assert(coachEdge.includes('repaired: true'), 'coach must annotate automatically repaired output');

assert(!app.includes('id="ae-review-photo"'), 'guided daily training must not upload customer photos');
assert(!app.includes('id="ae-upload-category"'), 'personal training uploads must not show a manual category selector');
assert(app.includes("var category = '发型作品';"), 'personal training uploads must keep a neutral compatibility category');
assert(data.governance.aiRule.includes('不得'), 'AI publishing boundary must be explicit');
assert(data.governance.privacyRule.includes('不进入公共知识库'), 'customer photo privacy rule must be explicit');

[
  'analyze_image',
  'revise_analysis',
  'STAGE_MODULES',
  'answer_history',
  'feedback_history',
  'analysis_modules',
  'const imageUrl = ""',
  'analysis structure incomplete'
  ,'COACH_GOALS'
  ,'buildCoachTurnPrompt'
  ,'buildSessionSummaryPrompt'
  ,'coach_turn'
  ,'summarize_session'
  ,'HAIR_VISION_CHECKPOINTS'
  ,'checkpoint_states'
  ,'should_auto_finish'
].forEach(marker => assert(coachEdge.includes(marker), `Coach Edge Function is missing marker: ${marker}`));

['affectedModules'].forEach(marker => assert(analysisPrompt.includes(marker), `Analysis Prompt is missing marker: ${marker}`));
['prior_case_history', 'unique_takeaway', 'checkpoint_states'].forEach(marker => assert(coachPrompt.includes(marker), `Coach Prompt is missing marker: ${marker}`));
['observedPoints', 'missedPoints', 'misconceptions', 'finalAnalysis', 'factInference'].forEach(marker => assert(evaluationPrompt.includes(marker), `Evaluation Prompt is missing marker: ${marker}`));

[
  'EVALUATOR_VERSION = "evaluator-v1"',
  'CANDIDATE_INTERVAL = 100',
  'evaluateSession',
  'maybeGenerateCandidate',
  'assignStrategy',
  'reconcileExperiment',
  'experiment_percent: 10',
  'status: passed ? "active" : "rejected"',
  'professional_accuracy',
  'safety_score',
  'experiment_percent',
  'EdgeRuntime.waitUntil'
].forEach(marker => assert(learningEdge.includes(marker), `Learning Edge Function is missing marker: ${marker}`));

[
  'aesthetic_training_sessions',
  'aesthetic_training_turns',
  'aesthetic_training_evaluations',
  'aesthetic_coach_strategies',
  'aesthetic_strategy_experiments',
  'enable row level security',
  'revoke all',
  'grant all'
].forEach(marker => assert(learningMigration.includes(marker), `Learning migration is missing marker: ${marker}`));

assert(!/STEP 1 \/ 5/.test(app.slice(app.indexOf('id="ae-trainer"'), app.indexOf('id="ae-master"'))), 'chat trainer must not expose the old five-step UI');
assert(!/提交给 AI 导师/.test(app.slice(app.indexOf('id="ae-trainer"'), app.indexOf('id="ae-master"'))), 'chat trainer must use send-message interaction');

console.log(`aesthetic system ok: v${data.version}, ${data.trainingCases.length} cases, ${data.capabilities.length} capabilities, ${data.sources.length} sources`);
