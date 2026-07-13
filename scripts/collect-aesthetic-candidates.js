#!/usr/bin/env node
/*
 * DSS 候选知识收集器（V1）
 *
 * 目的：抓取“已明确允许”的公开 URL，生成待人工审核的候选知识。
 * 重要边界：本脚本绝不修改 aesthetic-knowledge.v1.js，也不会自动发布知识。
 * DeepSeek API key 只从 DEEPSEEK_API_KEY 环境变量读取。
 *
 * 用法：
 *   DEEPSEEK_API_KEY=... node scripts/collect-aesthetic-candidates.js \
 *     --sources scripts/aesthetic-sources.json
 *   node scripts/collect-aesthetic-candidates.js --url https://example.com --no-ai
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'knowledge-candidates', 'pending');
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_ENDPOINT = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '') + '/chat/completions';

function fail(message) {
  console.error('COLLECT FAILED: ' + message);
  process.exitCode = 1;
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function hasArg(args, name) {
  return args.includes(name);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeFilePart(value) {
  return String(value || 'candidate').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-').slice(0, 48);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html, url) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match ? match[1] : '') || new URL(url).hostname;
}

function validateUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('只允许 HTTPS 来源：' + raw);
  return url.toString();
}

function loadSources(args) {
  const direct = argValue(args, '--url');
  if (direct) return [{ name: direct, url: validateUrl(direct), allowed: true }];
  const file = argValue(args, '--sources');
  if (!file) throw new Error('请提供 --url 或 --sources');
  const sources = readJson(path.resolve(file));
  if (!Array.isArray(sources)) throw new Error('来源配置必须是数组');
  return sources.filter((item) => item && item.allowed === true).map((item) => ({
    name: String(item.name || item.url),
    url: validateUrl(item.url),
    notes: String(item.notes || '')
  }));
}

function candidateExists(outputDir, contentHash, sourceUrl) {
  if (!fs.existsSync(outputDir)) return false;
  return fs.readdirSync(outputDir).some((file) => {
    if (!file.endsWith('.json')) return false;
    try {
      const candidate = readJson(path.join(outputDir, file));
      return candidate.content_hash === contentHash || candidate.source?.url === sourceUrl;
    } catch (_) { return false; }
  });
}

async function fetchSource(source) {
  const response = await fetch(source.url, { headers: { 'User-Agent': 'DSS-CandidateCollector/1.0' } });
  if (!response.ok) throw new Error('来源返回 HTTP ' + response.status);
  const html = await response.text();
  const text = stripHtml(html).slice(0, 18000);
  if (text.length < 80) throw new Error('来源正文过短或无法提取');
  return { title: extractTitle(html, source.url), text };
}

async function summarizeWithDeepSeek(source, page) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('未设置 DEEPSEEK_API_KEY；可使用 --no-ai 先保存原始候选');
  const body = {
    model: DEFAULT_MODEL,
    thinking: { type: 'enabled' },
    messages: [
      {
        role: 'system',
        content: '你是 DSS 发型设计风格美学知识编辑。只做原创摘要和分类，不复制来源原文，不把单一来源观点写成正式标准。输出严格 JSON。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '将公开来源整理为待审核候选知识',
          source: { name: source.name, url: source.url, notes: source.notes },
          title: page.title,
          content: page.text,
          output_schema: {
            summary: '不超过180字的原创中文摘要',
            topics: ['shape', 'line', 'weight', 'layer', 'texture', 'curl', 'color', 'style', 'suitability', 'teaching'],
            related_styles: ['natural', 'french', 'korean', 'japanese', 'urban', 'minimal', 'sweet', 'androgynous', 'avant_garde'],
            evidence_type: 'public_reference|editorial|trend_candidate|unknown',
            copyright_risk: 'low|medium|high',
            review_questions: ['审核人需要核对的问题'],
            proposed_use: '建议用于观察训练、案例讨论或待审核标准'
          }
        })
      }
    ],
    response_format: { type: 'json_object' },
    stream: false,
    max_tokens: 900
  };
  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'DeepSeek HTTP ' + response.status);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek 没有返回摘要');
  return JSON.parse(content);
}

async function main() {
  const args = process.argv.slice(2);
  if (hasArg(args, '--help')) {
    console.log('用法：DEEPSEEK_API_KEY=... node scripts/collect-aesthetic-candidates.js --sources scripts/aesthetic-sources.json');
    console.log('选项：--url URL、--sources FILE、--output DIR、--no-ai');
    return;
  }
  const sources = loadSources(args);
  const outputDir = path.resolve(argValue(args, '--output') || DEFAULT_OUTPUT);
  const noAi = hasArg(args, '--no-ai');
  fs.mkdirSync(outputDir, { recursive: true });
  if (!sources.length) throw new Error('没有 allowed=true 的来源；请先完成来源与版权核验');

  let saved = 0;
  for (const source of sources) {
    try {
      const page = await fetchSource(source);
      const contentHash = sha256(source.url + '\n' + page.text);
      if (candidateExists(outputDir, contentHash, source.url)) {
        console.log('skip duplicate: ' + source.url);
        continue;
      }
      let editorial = {
        summary: '', topics: [], related_styles: [], evidence_type: 'unknown',
        copyright_risk: 'medium', review_questions: ['核对原始来源、版权和专业适用范围'], proposed_use: '待审核候选'
      };
      if (!noAi) editorial = await summarizeWithDeepSeek(source, page);
      const now = new Date().toISOString();
      const candidate = {
        id: 'candidate-' + now.slice(0, 10).replace(/-/g, '') + '-' + contentHash.slice(0, 10),
        status: 'pending_review',
        collected_at: now,
        source: { name: source.name, url: source.url, title: page.title, notes: source.notes },
        content_hash: contentHash,
        raw_excerpt: page.text.slice(0, 4000),
        editorial,
        review: { reviewer: '', reviewed_at: '', decision: '', reason: '' }
      };
      const file = path.join(outputDir, safeFilePart(candidate.id) + '.json');
      fs.writeFileSync(file, JSON.stringify(candidate, null, 2) + '\n');
      console.log('saved: ' + path.relative(ROOT, file));
      saved += 1;
    } catch (error) {
      console.error('source failed: ' + source.url + ' — ' + error.message);
    }
  }
  console.log('candidate collection complete: ' + saved + ' saved, pending review only');
}

main().catch((error) => fail(error.message));
