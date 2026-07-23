#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'perm-app.html'), 'utf8');
const required = [
  ['before photo state', 'window._hairServiceBeforePhoto'],
  ['after photo state', 'window._hairServiceAfterPhoto'],
  ['camera input', "'-camera\" accept=\"image/*\" capture=\"environment\""],
  ['album input', "'-album\" accept=\"image/*\""],
  ['image compression', "canvas.toDataURL('image/jpeg', quality)"],
  ['compressed payload limit', 'dataUrl.length > 120000'],
  ['before photo save', "serviceBeforePhoto: window._hairServiceBeforePhoto || ''"],
  ['after photo save', "serviceAfterPhoto: window._hairServiceAfterPhoto || ''"],
  ['photo restore', "window._hairServiceBeforePhoto = data.serviceBeforePhoto || ''"],
  ['photo preservation', "'serviceBeforePhoto','serviceAfterPhoto'"],
  ['customer archive before label', 'alt="服务前照片"'],
  ['customer archive after label', 'alt="服务后照片"'],
];

const failures = required
  .filter(([, marker]) => !source.includes(marker))
  .map(([label]) => `missing ${label}`);

const beforeSaveMatches = source.match(/serviceBeforePhoto: window\._hairServiceBeforePhoto \|\| ''/g) || [];
const afterSaveMatches = source.match(/serviceAfterPhoto: window\._hairServiceAfterPhoto \|\| ''/g) || [];
if (beforeSaveMatches.length < 2) failures.push('before photo must be saved by draft and archive paths');
if (afterSaveMatches.length < 2) failures.push('after photo must be saved by draft and archive paths');

if (failures.length) {
  console.error(`hair service photo test failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('hair service photo test passed');
