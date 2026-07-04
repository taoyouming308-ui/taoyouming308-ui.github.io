const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'aesthetic-knowledge.v1.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'perm-app.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const context = { window: {} };

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

vm.createContext(context);
vm.runInContext(source, context);

const data = context.window.AESTHETIC_KNOWLEDGE_V1;
assert(data, 'knowledge catalog did not initialize');
assert(/^\d+\.\d+\.\d+$/.test(data.version), 'knowledge version must use semantic versioning');
assert(data.status === 'published', 'knowledge catalog must declare published status');
assert(Array.isArray(data.modules) && data.modules.length >= 9, 'nine curriculum modules are required');
assert(Array.isArray(data.sources) && data.sources.length >= 10, 'source catalog is incomplete');
assert(Array.isArray(data.questions) && data.questions.length >= 15, 'training question bank is too small');
assert(Array.isArray(data.rubric) && data.rubric.reduce((sum, row) => sum + row.weight, 0) === 100, 'rubric weights must total 100');

const sourceIds = new Set(data.sources.map(row => row.id));
const moduleIds = new Set(data.modules.map(row => row.id));
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
  row.sourceIds.forEach(id => assert(sourceIds.has(id), `question ${row.id} references unknown source ${id}`));
});

[
  "openHomeDrawerFeature('aesthetic')",
  'id="tab-aesthetic"',
  'startAestheticTraining()',
  'saveAestheticReview()',
  'hair_aesthetic_progress_v1:',
  'aesthetic-knowledge.v1.js'
].forEach(marker => assert(app.includes(marker), `App is missing marker: ${marker}`));

[
  'data-tab="aesthetic"',
  'id="tab-aesthetic"',
  'openAestheticCandidateModal()',
  'loadAestheticAdmin()',
  'AESTHETIC_CANDIDATE_KEY',
  'aesthetic-knowledge.v1.js'
].forEach(marker => assert(admin.includes(marker), `Admin is missing marker: ${marker}`));

assert(!app.includes('photoStored: true'), 'customer review photos must not be persisted');
assert(data.governance.aiRule.includes('不得'), 'AI publishing boundary must be explicit');
assert(data.governance.privacyRule.includes('不进入公共知识库'), 'customer photo privacy rule must be explicit');

console.log(`aesthetic system ok: v${data.version}, ${data.sources.length} sources, ${data.modules.length} modules, ${data.questions.length} questions`);
