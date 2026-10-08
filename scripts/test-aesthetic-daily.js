const assert = require('node:assert/strict'), fs = require('node:fs');
const feed = JSON.parse(fs.readFileSync('docs/aesthetic-training/feed.v1.json'));
assert.equal(feed.schemaVersion, 1);
assert(Array.isArray(feed.items));
const ids = new Set();
for (const x of feed.items) {
  assert(!ids.has(x.id)); ids.add(x.id);
  assert.match(x.id, /^aesthetic-[a-z0-9-]+$/);
  assert.match(x.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(x.image, /^img\/aesthetic-training\/[a-z0-9._-]+\.(png|jpg|webp)$/);
  assert(fs.statSync(x.image).size > 0);
  assert(x.caption.includes('AI生成') && x.caption.includes('虚构'));
  assert(x.title && x.question && x.conditions.length >= 4);
  assert(x.answer.length >= 6 && x.answer.every(v => v.title && v.text));
  assert.deepEqual(x.recap.map(v => v.title), ['看对了什么','遗漏','误判','收获','下次重点']);
}
const html = fs.readFileSync('perm-app.html','utf8');
assert(html.includes('发型审美训练'));
assert(!html.includes('src="perm-academy.js'));
assert(html.includes('onclick="openHairCalculator()"'));
console.log('aesthetic training feed/assets/entry contract passed: '+feed.items.length+' case(s)');
