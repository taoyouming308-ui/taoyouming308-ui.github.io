/** Pure fixed service-binding request contract. No credentials or I/O. */
export const SERVICE_BINDING_URL='https://pdssrmpeiuwvxzsgschm.supabase.co/functions/v1/design-service-bindings';
export const SERVICE_BINDING_APP='https://taoyouming308-ui.github.io';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const id=/^[1-9][0-9]{0,15}$/,staff=/^[1-9][0-9]{0,9}$/,sha=/^[a-f0-9]{64}$/;
const fields={choices:['action','profileId','date'],inspect:['action','visitKey','profileId','staffId'],confirm:['action','visitKey','profileId','staffId','expectedRevision','sourceSha','profileSha','staffSha','requestId','reason'],revoke:['action','visitKey','profileId','expectedRevision','requestId','reason'],status:['action','visitKey','profileId','requestId'],resolve:['action','visitKey','profileId','nonce']};
const archiveFields=['action','profileId','bookingId','date'];
fields.archive_inspect=archiveFields;
fields.archive_confirm=[...archiveFields,'expectedRevision','evidenceSha','requestId','reason'];
fields.archive_revoke=[...archiveFields,'expectedRevision','requestId','reason'];
fields.archive_status=[...archiveFields,'requestId'];
export const isServiceBindingMutation=action=>['confirm','revoke','archive_confirm','archive_revoke'].includes(action);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export function validateServiceBindingInput(v){
 const keys=plain(v)&&fields[v.action];
 if(!keys||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))throw Error('DESIGN_SERVICE_INVALID');
 if('profileId'in v&&(typeof v.profileId!=='string'||!id.test(v.profileId)||!Number.isSafeInteger(Number(v.profileId))))throw Error('DESIGN_SERVICE_INVALID');
 if('bookingId'in v&&(typeof v.bookingId!=='string'||!id.test(v.bookingId)||!Number.isSafeInteger(Number(v.bookingId))))throw Error('DESIGN_SERVICE_INVALID');
 if('staffId'in v&&(typeof v.staffId!=='string'||!staff.test(v.staffId)||Number(v.staffId)>2147483647))throw Error('DESIGN_SERVICE_INVALID');
 if('visitKey'in v&&(typeof v.visitKey!=='string'||!(/^booking:[1-9][0-9]{0,15}$/.test(v.visitKey)||v.visitKey.startsWith('frontdesk:')&&uuid.test(v.visitKey.slice(10)))))throw Error('DESIGN_SERVICE_INVALID');
 if('date'in v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||!Number.isFinite(Date.parse(v.date+'T00:00:00Z'))||new Date(v.date+'T00:00:00Z').toISOString().slice(0,10)!==v.date))throw Error('DESIGN_SERVICE_INVALID');
 if('expectedRevision'in v&&(!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0||v.expectedRevision>999999999))throw Error('DESIGN_SERVICE_INVALID');
 for(const k of ['requestId','nonce'])if(k in v&&(typeof v[k]!=='string'||!uuid.test(v[k])))throw Error('DESIGN_SERVICE_INVALID');
 for(const k of ['sourceSha','profileSha','staffSha','evidenceSha'])if(k in v&&(typeof v[k]!=='string'||!sha.test(v[k])))throw Error('DESIGN_SERVICE_INVALID');
 if('reason'in v&&(typeof v.reason!=='string'||v.reason!==v.reason.trim()||v.reason.length<1||v.reason.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.reason)))throw Error('DESIGN_SERVICE_INVALID');
 return v;
}
