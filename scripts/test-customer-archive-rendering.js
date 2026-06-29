#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'perm-app.html'), 'utf8');
const required = [
  ["latest visits use newest-first data", "visitHistory.slice(0, showCount)"],
  ["bill identity deduplication", "sourceId ? 'id:' + sourceId"],
  ["bill item detail rendering", "var projectText = h.items && h.items.length ? h.items.join('、') : '消费记录';"],
  ["bill staff detail rendering", "h.staff && h.staff.length ? h.staff.join('、') : h.barber"],
  ["package expiry rendering", "pkg.expireDate ? '有效期至' + pkg.expireDate : ''"],
  ["perm note input", 'id="hair-form-perm-notes"'],
  ["perm note save", "permNotes: F['hair-form-perm-notes'] || ''"],
  ["perm note restore", "setVal('hair-form-perm-notes', data.permNotes)"],
];

const forbidden = [
  ["oldest-three visit regression", "visitHistory.slice(visitHistory.length - showCount)"],
  ["hard-coded twelve-row history truncation", "history.slice(0, 12).forEach"],
];

const failures = [];
for (const [label, marker] of required) {
  if (!source.includes(marker)) failures.push(`missing ${label}`);
}
for (const [label, marker] of forbidden) {
  if (source.includes(marker)) failures.push(`found ${label}`);
}
const saveMatches = source.match(/permNotes: F\['hair-form-perm-notes'\] \|\| ''/g) || [];
if (saveMatches.length < 2) failures.push('perm notes must be saved by draft and archive paths');

if (failures.length) {
  console.error(`customer archive regression test failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('customer archive regression test passed');
