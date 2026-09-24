#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(__dirname, 'zysyr-finance-test-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function validate() {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.steps) || manifest.steps.length === 0) {
    throw new Error('Finance test manifest has an unsupported or empty schema.');
  }
  const seen = new Set();
  for (const [index, step] of manifest.steps.entries()) {
    if (step.runtime === 'node') {
      if (typeof step.script !== 'string' || path.basename(step.script) !== step.script || !/^[\w.-]+\.(?:js|mjs)$/.test(step.script)) {
        throw new Error(`Invalid Node test entry at index ${index}.`);
      }
      const file = path.join(__dirname, step.script);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Missing finance test: ${step.script}`);
      if (seen.has(`node:${step.script}`)) throw new Error(`Duplicate finance test: ${step.script}`);
      seen.add(`node:${step.script}`);
    } else if (step.runtime === 'python') {
      if (!Array.isArray(step.args) || step.args.length < 3 || step.args[0] !== '-m' || step.args[1] !== 'unittest') {
        throw new Error(`Invalid Python unittest entry at index ${index}.`);
      }
      for (const testPath of step.args.slice(2)) {
        const absolute = path.resolve(root, testPath);
        if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute)) {
          throw new Error(`Missing or unsafe finance Python test: ${testPath}`);
        }
        if (seen.has(`python:${testPath}`)) throw new Error(`Duplicate finance test: ${testPath}`);
        seen.add(`python:${testPath}`);
      }
    } else {
      throw new Error(`Unsupported runtime at index ${index}.`);
    }
  }
  return seen.size;
}

try {
  const count = validate();
  if (process.argv.includes('--check')) {
    console.log(`ZYSYR finance test manifest valid: ${manifest.steps.length} commands, ${count} test files.`);
    process.exit(0);
  }
  for (const [index, step] of manifest.steps.entries()) {
    const command = step.runtime === 'node' ? process.execPath : (process.env.PYTHON || 'python3');
    const args = step.runtime === 'node'
      ? [path.join(__dirname, step.script)]
      : step.args;
    console.log(`[finance ${index + 1}/${manifest.steps.length}] ${step.runtime} ${step.script || step.args.join(' ')}`);
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.signal || result.status !== 0) {
      process.exitCode = result.status || 1;
      break;
    }
  }
} catch (error) {
  console.error(`ZYSYR finance test suite failed: ${error.message}`);
  process.exitCode = 1;
}
