const fs = require('fs');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const page = fs.readFileSync('operations.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260912084504_openai_daily_recognition_candidates.sql',
  'utf8'
);
const recognizeStart = api.indexOf('async function recognizeDailySheet(');
const recognizeEnd = api.indexOf('async function getDailySheetDraft(', recognizeStart);
const recognize = api.slice(recognizeStart, recognizeEnd);

expect(recognizeStart >= 0 && recognizeEnd > recognizeStart, 'daily recognition function missing');
expect(recognize.includes('Deno.env.get("OPENAI_API_KEY")'), 'OpenAI secret is not server-side');
expect(recognize.includes('https://api.openai.com/v1/responses'), 'OpenAI Responses endpoint missing');
expect(recognize.includes('"gpt-5.6-sol"'), 'Codex/OpenAI daily model default missing');
expect(recognize.includes('store:false'), 'financial image response storage must be disabled');
expect(recognize.includes('type:"input_image"') && recognize.includes('detail:"high"'), 'high-detail image input missing');
expect(!/MOONSHOT_API_KEY|api\.moonshot\.cn|kimi-k2\.6/.test(recognize), 'Kimi must not receive daily images');
expect(migration.includes("source_method='openai_vision_candidate'"), 'OpenAI candidate source missing');
expect(migration.includes("ocr_provider='openai'"), 'OpenAI provider audit missing');
expect(migration.includes("assert_finance_scope") && migration.includes("DAILY_VOUCHER_NOT_LINKED"), 'finance/store/voucher guards missing');
expect(page.includes("['openai_vision_candidate','kimi_vision_candidate']"), 'candidate review highlighting missing');
expect(page.includes("daily_grid_model:'gpt-5.6-sol'"), 'preview provider label is stale');

console.log('OpenAI daily recognition v486 static checks passed');
