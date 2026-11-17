/** One bounded actual restricted issuer/source prerequisite probe. */
import assert from 'node:assert/strict';
import {createManagedImageLedgerFixture} from './fixtures/managed-image-ledger.mjs';
const f=await createManagedImageLedgerFixture();let count=0;try{
 await f.source();console.log(`ok ${++count} - actual restricted storage issuance, claim and quarantined source publication`);
 for(const length of [1,1024]){const intent=f.uploadIntent('boundary-'+length);intent.target.key='a'.repeat(length);await f.issuers.issueStorage({credential:f.credential,scope:f.scope,receiptId:'boundary-'+length,binding:intent,budget:f.cost,ttlMs:900000});console.log(`ok ${++count} - legal object key length ${length}`);}
 for(const [index,key]of ['a'.repeat(1025),'a/../b','a//b','a?b'].entries()){const intent=f.uploadIntent('invalid-'+index);intent.target.key=key;const c=f.clientForRole('design_managed_storage_issuer','managed-boundary');try{await c.query('BEGIN');await assert.rejects(c.query('SELECT design_managed_image.issue_receipt($1::text,$2::jsonb,$3::text,$4::text,$5::jsonb,$6::jsonb,$7::bigint) AS value',[f.credential,f.scope,'invalid-'+index,'storage',intent,f.cost,900000]),e=>e.code==='42501');await c.query('ROLLBACK');}finally{await c.release();}console.log(`ok ${++count} - restricted SQL rejects invalid key case ${index}`);}
 console.log(`PASS ${count} managed source boundary diagnostics`);
}finally{await f.cleanup();}
