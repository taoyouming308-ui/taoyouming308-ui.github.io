#!/usr/bin/env node
const fs = require('fs');

function fail(message) {
  console.error('APP UI SYSTEM TEST FAILED: ' + message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const app = fs.readFileSync('perm-app.html', 'utf8');
const styleStart = app.indexOf('<style id="app-minimal-system">');
const styleEnd = app.indexOf('</style>', styleStart);
const styles = app.slice(styleStart, styleEnd);

assert(styleStart >= 0 && styleEnd > styleStart, 'shared minimal design system is missing');
assert(app.includes('class="page-intro page-intro-light"') && app.includes('class="page-intro page-intro-dark"'), 'plan and showcase page headers are not unified');
assert(app.includes("openHomeDrawerFeature('showcase')"), 'showcase is missing from the main workbench menu');
assert(styles.includes('visibility:hidden') && styles.includes('pointer-events:none'), 'closed desktop drawer can remain visible or clickable');
assert(styles.includes('left:max(16px, calc(50% - 224px))'), 'fixed navigation is not aligned to the centered app shell');
assert(app.includes('class="identity-kicker"') && app.includes('identity-secondary'), 'login and registration hierarchy is not using the shared modal system');
assert(styles.includes('input:not([type=checkbox]):not([type=radio])'), 'registration checkboxes can inherit full-size text input styles');
assert(app.includes('class="hair-modal-shell"') && app.includes('class="hair-modal-footer"'), 'hair analysis shell and footer are not unified');
assert(app.includes('class="hair-archive-section"') && app.includes('class="profile-record"'), 'customer archive content is missing shared section styles');
assert(styles.includes('.hair-task-card') && styles.includes('.hair-local-record'), 'hair task and local record surfaces are not covered');
assert(styles.includes('.hair-analysis .chip.selected') && styles.includes('background:var(--ui-black)'), 'hair analysis controls are not using the monochrome selected state');

console.log('app UI system test ok');
