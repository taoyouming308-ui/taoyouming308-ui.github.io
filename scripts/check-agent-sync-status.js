#!/usr/bin/env node
const fs = require('fs');

function fail(message) {
  console.error('AGENT SYNC CHECK FAILED: ' + message);
  process.exit(1);
}

function read(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (err) {
    fail(`cannot read ${path}: ${err.message}`);
  }
}

const statusPath = 'AGENT_SYNC_STATUS.md';
const status = read(statusPath);
const version = read('version.txt').trim();

if (!/^# Agent Sync Status/m.test(status)) {
  fail(`${statusPath} is missing the required title`);
}

const requiredPhrases = [
  `App version: v${version}`,
  'Last synchronized base checked',
  'Current owner',
  'Last Completed Work',
  'Open Work For Next Agent',
  'Required Checks Before Editing',
  'Required Checks Before Publishing',
  'Handoff Rule',
  'git fetch github main',
  'git fetch origin master',
  'node scripts/check-version-sync.js',
  'node scripts/smoke-test-app.js'
];

for (const phrase of requiredPhrases) {
  if (!status.includes(phrase)) {
    fail(`${statusPath} must include: ${phrase}`);
  }
}

console.log(`agent sync status ok: v${version}`);
