#!/usr/bin/env node
// Local reviewed-content staging only; no scheduler, network, AI, Git or business writes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const categories = ['热烫原理','烫发设计','排杠技法','中发方案库','顾客沟通','科研与验证'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const text = value => typeof value === 'string' && value.trim();
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validDate(value.slice(0,10)) || !Number.isFinite(Date.parse(value))) throw Error('Timestamp with explicit timezone required');
  return new Date(value);
}
function shanghaiDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(timestamp(value));
  return ['year','month','day'].map(key => parts.find(p => p.type === key).value).join('-');
}
function canonicalUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Public HTTPS source required');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || /^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
function contentFingerprint(x) {
  // Cosmetic title, collection/review timestamps and reviewer labels do not create new lessons.
  const source = {...x.source}; delete source.verifiedAt; delete source.verifiedOn; delete source.dateNote;
  return hash(JSON.stringify([source,x.category,x.coreKnowledge,x.evidence,x.shopApplication,x.openQuestions,[...x.tags].sort(),x.isExample,x.isRealCase,x.authorization]));
}
function validate(x, options = {}) {
  const pending = x?.reviewStatus === 'pending' && options.allowPending === true;
  if (!x || (x.reviewStatus !== 'approved' && !pending) || !validDate(x.batchDate) || !categories.includes(x.category)) throw Error('Only approved, dated category records are publishable');
  for (const key of ['title','coreKnowledge','shopApplication','openQuestions',...(pending ? [] : ['reviewedBy','reviewedAt'])]) if (!text(x[key])) throw Error('Missing '+key);
  if (!x.evidence || !['强','中','弱'].includes(x.evidence.level) || !text(x.evidence.basis)) throw Error('Evidence required');
  if (!text(x.source?.author) || !Object.hasOwn(x.source,'publishedAt') || (x.source.publishedAt !== null && !validDate(x.source.publishedAt))) throw Error('Source author/publication date required (null if unknown)');
  if (!Array.isArray(x.tags) || x.tags.some(t => !text(t))) throw Error('Tags required');
  if (typeof x.isRealCase !== 'boolean' || typeof x.isExample !== 'boolean') throw Error('Case/example classification required');
  if (x.isRealCase && x.isExample) throw Error('Real case and teaching example cannot both be true');
  if (x.isRealCase && x.authorization !== 'granted') throw Error('Real case authorization required');
  if (!x.isRealCase && x.authorization !== 'not_applicable') throw Error('Non-case authorization must be not_applicable');
  if (x.isExample && x.evidence.level !== '弱') throw Error('Example cannot claim strong scientific evidence');
  if (pending) {
    if (x.reviewedBy !== null || x.reviewedAt !== null) throw Error('Pending candidates must not claim approval identity or timestamp');
  } else timestamp(x.reviewedAt);
  const fields = ['title','category','batchDate','coreKnowledge','shopApplication','openQuestions','reviewStatus','reviewedBy','reviewedAt','isExample','isRealCase','authorization'];
  const safe = Object.fromEntries(fields.map(key => [key, typeof x[key] === 'string' ? x[key].trim() : x[key]]));
  safe.source = { url:canonicalUrl(x.source.url), author:x.source.author.trim(), publishedAt:x.source.publishedAt };
  for (const key of ['updatedAt','onlinePublishedAt']) if (x.source[key] !== undefined) {
    if (x.source[key] !== null && !validDate(x.source[key])) throw Error('Invalid source '+key);
    safe.source[key] = x.source[key];
  }
  if (x.source.verifiedOn !== undefined) { if (!validDate(x.source.verifiedOn)) throw Error('Invalid verification date'); safe.source.verifiedOn = x.source.verifiedOn; }
  if (x.source.verifiedAt !== undefined) { timestamp(x.source.verifiedAt); safe.source.verifiedAt = x.source.verifiedAt; }
  if (x.source.dateNote !== undefined) { if (!text(x.source.dateNote)) throw Error('Invalid source dateNote'); safe.source.dateNote = x.source.dateNote.trim(); }
  safe.evidence = { level:x.evidence.level, basis:x.evidence.basis.trim() };
  if (x.evidence.parts !== undefined) {
    if (!Array.isArray(x.evidence.parts) || !x.evidence.parts.length) throw Error('Evidence parts required');
    safe.evidence.parts = x.evidence.parts.map(part => {
      if (!text(part.type) || !['强','中','弱'].includes(part.level) || !text(part.basis)) throw Error('Invalid evidence part');
      return { type:part.type.trim(),level:part.level,basis:part.basis.trim() };
    });
  }
  safe.tags = [...new Set(x.tags.map(t => t.trim()))].sort();
  safe.id = hash(safe.source.url+'\n'+safe.title).slice(0,24);
  safe.contentFingerprint = contentFingerprint(safe);
  if (x.contentFingerprint && x.contentFingerprint !== safe.contentFingerprint) throw Error('Content fingerprint mismatch');
  return safe;
}
function parseBatch(input) {
  if (Array.isArray(input)) return { items:input, batch:null }; // Legacy reviewed arrays remain compatible.
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.items) || input.batch?.timezone !== 'Asia/Shanghai') throw Error('Invalid reviewed batch envelope');
  const day = shanghaiDate(input.batch.producedAt);
  if (input.batch.id !== 'perm-'+day) throw Error('Batch ID must match Shanghai production date');
  const items = input.items.map(x => {
    if (x.batchDate !== undefined && x.batchDate !== day) throw Error('Item batchDate differs from Shanghai batch');
    return { ...x, batchDate:day };
  });
  const batch = { id:input.batch.id, producedAt:input.batch.producedAt, timezone:'Asia/Shanghai' };
  for (const key of ['label','dailySummary','lowRiskPractice']) if (input.batch[key] !== undefined) {
    if (!text(input.batch[key])) throw Error('Invalid batch '+key);
    batch[key] = input.batch[key].trim();
  }
  return { items, batch };
}
function preflightBatch(input) {
  const { items, batch } = parseBatch(input);
  return { schemaVersion:1, batch, preflightOnly:true, approvalRequired:true, items:items.map(x => validate(x,{allowPending:true})) };
}
function previousFeed(input) {
  if (Array.isArray(input)) return { schemaVersion:1, timezone:'Asia/Shanghai', updatedAt:null, items:input };
  if (!input || input.schemaVersion !== 1 || input.timezone !== 'Asia/Shanghai' || !Array.isArray(input.items)) throw Error('Invalid existing feed');
  return input;
}
function build(previous, incoming, options = {}) {
  const oldFeed = previousFeed(previous), { items, batch } = parseBatch(incoming);
  const map = new Map(), fingerprints = new Map(), aliases = new Map();
  for (const raw of oldFeed.items) {
    const normalized = validate(raw);
    const id = raw.id || normalized.id; // Retain legacy IDs and browser learning records.
    if (map.has(id)) throw Error('Duplicate ID in existing feed');
    map.set(id, { raw, normalized }); aliases.set(normalized.id,id); fingerprints.set(normalized.contentFingerprint,id);
  }
  let changed = false;
  for (const raw of items) {
    const x = validate(raw), duplicateId = fingerprints.get(x.contentFingerprint);
    if (duplicateId) continue;
    const old = map.get(aliases.get(x.id) || x.id);
    if (old) {
      const order = Date.parse(x.reviewedAt)-Date.parse(old.normalized.reviewedAt);
      if (order < 0) continue;
      if (order === 0) throw Error('Conflicting content with same approval timestamp');
      x.id = old.raw.id || old.normalized.id;
      x.batchDate = old.raw.batchDate;
      fingerprints.delete(old.normalized.contentFingerprint);
    }
    map.set(x.id,{ raw:x, normalized:x }); aliases.set(validate(x).id,x.id); fingerprints.set(x.contentFingerprint,x.id); changed = true;
  }
  if (!changed) return oldFeed;
  const result = { schemaVersion:1, timezone:'Asia/Shanghai', updatedAt:options.now || new Date().toISOString(), items:[...map.values()].map(x => x.raw).sort((a,b) => b.batchDate.localeCompare(a.batchDate) || a.id.localeCompare(b.id)) };
  if (batch) result.lastBatch = batch; else if (oldFeed.lastBatch) result.lastBatch = oldFeed.lastBatch;
  return result;
}
async function retryTransient(operation, options = {}) {
  const attempts = options.attempts ?? 3, delayMs = options.delayMs ?? 100;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3 || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > 1000) throw Error('Retry budget must be 1–3 attempts, delay 0–1000ms');
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve,ms)));
  for (let i=0; i<attempts; i++) {
    try { return await operation(); } catch (error) {
      if (!['EBUSY','EAGAIN','ETIMEDOUT'].includes(error.code) || i === attempts-1) throw error;
      await sleep(Math.min(delayMs * 2**i,1000));
    }
  }
}
async function withLock(output, action) {
  const lock = output+'.lock', token = crypto.randomUUID();
  const fd = fs.openSync(lock,'wx',0o600); // Existing locks fail closed; never auto-steal a stale lock.
  try {
    fs.writeFileSync(fd,JSON.stringify({ token, pid:process.pid, host:os.hostname(), startedAt:new Date().toISOString() }));
    return await action();
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    if (fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock,'utf8')).token === token) fs.unlinkSync(lock);
  }
}
function readOutput(output) {
  if (!fs.existsSync(output)) return null;
  if (fs.lstatSync(output).isSymbolicLink()) throw Error('Output symlinks are not allowed');
  return fs.readFileSync(output);
}
function recoverySnapshot(raw, options) {
  if (raw === null) return null;
  const dir = path.resolve(options.recoveryDir || path.join(os.tmpdir(),'perm-academy-recovery'));
  fs.mkdirSync(dir,{ recursive:true, mode:0o700 });
  const file = path.join(dir,hash(raw)+'.json');
  try { fs.writeFileSync(file,raw,{ flag:'wx', mode:0o600 }); } catch (error) {
    if (error.code !== 'EEXIST' || !fs.readFileSync(file).equals(raw)) throw error;
  }
  return file;
}
async function atomicReplace(output, bytes, before, options) {
  const snapshot = recoverySnapshot(before,options);
  const temp = path.join(path.dirname(output),'.'+path.basename(output)+'.'+crypto.randomUUID()+'.tmp');
  try {
    const fd = fs.openSync(temp,'wx',0o600);
    try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    await retryTransient(() => {
      const current = readOutput(output);
      if ((current === null) !== (before === null) || (current && !current.equals(before))) throw Error('Output changed outside publication lock; refusing overwrite');
      return (options.rename || fs.renameSync)(temp,output);
    },options.retry);
    return snapshot;
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
async function importFeed(inputPath, outputPath, options = {}) {
  const input = path.resolve(inputPath), output = path.resolve(outputPath);
  if (input === output) throw Error('Input and output must differ');
  return withLock(output,async () => {
    const before = readOutput(output);
    const previous = before ? JSON.parse(before.toString('utf8')) : { schemaVersion:1,timezone:'Asia/Shanghai',updatedAt:null,items:[] };
    const incoming = JSON.parse(fs.readFileSync(input,'utf8'));
    const feed = build(previous,incoming,options);
    if (feed === previous) return { changed:false, count:feed.items.length, sha256:before ? hash(before) : null, recovery:null };
    const bytes = Buffer.from(JSON.stringify(feed,null,2)+'\n');
    const recovery = await atomicReplace(output,bytes,before,options);
    return { changed:true, count:feed.items.length, sha256:hash(bytes), recovery };
  });
}
async function restoreFeed(snapshotPath, outputPath, expectedCurrentHash, options = {}) {
  if (!/^[a-f0-9]{64}$/.test(expectedCurrentHash || '')) throw Error('Rollback requires expected current SHA-256');
  const output = path.resolve(outputPath);
  return withLock(output,async () => {
    const current = readOutput(output);
    if (!current || hash(current) !== expectedCurrentHash) throw Error('Rollback conflict: current file changed');
    const saved = fs.readFileSync(path.resolve(snapshotPath));
    const feed = previousFeed(JSON.parse(saved.toString('utf8'))); feed.items.forEach(validate);
    if (saved.equals(current)) return { changed:false, sha256:hash(current), recovery:null };
    const recovery = await atomicReplace(output,saved,current,options);
    return { changed:true, sha256:hash(saved), recovery };
  });
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const run = args[0] === '--preflight'
    ? Promise.resolve().then(() => preflightBatch(JSON.parse(fs.readFileSync(path.resolve(args[1]),'utf8'))))
    : args[0] === '--restore'
    ? restoreFeed(args[1],args[2],args[3],{ recoveryDir:args[4] })
    : args.length >= 2 ? importFeed(args[0],args[1],{ recoveryDir:args[2] }) : Promise.reject(Error('Usage: build-perm-academy-feed.js reviewed.json staged-feed.json [private-recovery-dir]; --restore snapshot staged-feed expected-sha [private-recovery-dir]'));
  run.then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode=1; });
}
module.exports = { build, validate, parseBatch, shanghaiDate, retryTransient, importFeed, restoreFeed, preflightBatch };
