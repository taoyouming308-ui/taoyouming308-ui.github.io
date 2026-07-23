#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'perm-app.html'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'customer-plan-url.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) {
    console.error('ai codex route test failed:', message);
    process.exit(1);
  }
}

assert(/^https:\/\//.test(config.url || ''), 'customer plan URL must use HTTPS');
assert(/\/api\/codex-plan$/.test(config.url || ''), 'customer plan URL must target /api/codex-plan');
assert(!/aesthetic-coach/.test(config.url || ''), 'customer plan URL must not reuse the aesthetic coach endpoint');
assert(html.includes("fetch('customer-plan-url.json?_t='"), 'app must load the dedicated customer plan config');
assert(!html.includes("192.168.3.250:8890/api/codex-plan"), 'app must not use the stale LAN address');
assert(!html.includes("AI_TUNNEL_URL"), 'customer analysis must not reuse the aesthetic coach tunnel variable');
assert(html.includes("xhr.open('GET', url, true)"), 'customer analysis must keep the plan server GET contract');
assert(html.includes("box.querySelectorAll('.ai-result.error')"), 'old AI errors must be cleared before a retry');
assert(html.includes("data-ai-requesting"), 'duplicate AI requests must be guarded');

console.log('ai codex route test ok');
