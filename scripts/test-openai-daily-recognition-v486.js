const fs = require('fs');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const page = fs.readFileSync('operations.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260912103006_codex_local_daily_recognition_candidates.sql',
  'utf8'
);
const bridge = fs.readFileSync('scripts/zysyr_daily_codex_bridge.py', 'utf8');
const recognizeStart = api.indexOf('async function recognizeDailySheet(');
const recognizeEnd = api.indexOf('async function getDailySheetDraft(', recognizeStart);
const recognize = api.slice(recognizeStart, recognizeEnd);

expect(recognizeStart >= 0 && recognizeEnd > recognizeStart, 'daily recognition function missing');
expect(recognize.includes('Deno.env.get("ZYSYR_DAILY_CODEX_BRIDGE_URL")'), 'Codex bridge URL must be server-side');
expect(recognize.includes('Deno.env.get("ZYSYR_DAILY_CODEX_BRIDGE_TOKEN")'), 'Codex bridge token must be server-side');
expect(recognize.includes('Authorization:`Bearer ${bridgeToken}`'), 'authenticated bridge request missing');
expect(!recognize.includes('api.openai.com'), 'daily recognition must not call the direct OpenAI API');
expect(!/MOONSHOT_API_KEY|api\.moonshot\.cn|kimi-k2\.6/.test(recognize), 'Kimi must not receive daily images');
expect(bridge.includes('hmac.compare_digest'), 'bridge token comparison must be timing-safe');
expect(bridge.includes('/storage/v1/object/sign/'), 'bridge must only accept signed storage images');
expect(bridge.includes('DEFAULT_ALLOWED_HOST'), 'bridge Supabase host allowlist missing');
expect(bridge.includes('--sandbox", "read-only"') && bridge.includes('--ephemeral'), 'Codex bridge must be read-only and ephemeral');
expect(bridge.includes('--output-schema'), 'structured Codex output missing');
expect(bridge.includes('threading.BoundedSemaphore(1)'), 'local Codex concurrency guard missing');
expect(bridge.includes('/usr/local/bin:/opt/homebrew/bin:'), 'launchd Node PATH repair missing');
expect(migration.includes('codex_local_candidate'), 'local Codex candidate source missing');
expect(migration.includes("ocr_provider=''codex-local''"), 'local Codex provider audit missing');
expect(page.includes("['codex_local_candidate','openai_vision_candidate','kimi_vision_candidate']"), 'candidate review highlighting missing');
expect(page.includes("daily_grid_model:'gpt-5.6-luna'"), 'preview provider label is stale');
expect(page.includes('本机 Codex 只把原图数字填成待审核候选'), 'candidate-only finance guidance missing');

console.log('Local Codex daily recognition static checks passed');
