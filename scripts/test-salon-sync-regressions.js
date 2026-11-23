'use strict';
// One shared CI/pre-push entry. Fixtures are local and no write API is used.
const {spawnSync}=require('node:child_process'), path=require('node:path');
for(const f of ['test-scoped-read-integrity.cjs','test-employee-booking-read-sync.js',
  'test-frontdesk-scoped-read-sync.cjs','test-operations-scoped-read-sync.cjs',
  'test-scoped-read-browser.cjs','test-employee-booking-sync-browser.cjs',
  'test-frontdesk-session-boundary-browser.cjs','test-hair-seq-projection.cjs',
  'test-chat-append-read.cjs','test-stylist-secondary-reads.cjs','test-frontdesk-secondary-reads.cjs',
  'test-report-secondary-reads.cjs','test-frontdesk-archive-projection.cjs']){
  const r=spawnSync(process.execPath,[path.join(__dirname,f)],{cwd:path.resolve(__dirname,'..'),stdio:'inherit'});
  if(r.error)throw r.error;
  if(r.status!==0)process.exit(r.status||1);
}
