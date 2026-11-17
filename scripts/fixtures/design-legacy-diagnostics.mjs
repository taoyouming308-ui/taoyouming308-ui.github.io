/** Synthetic-test diagnostics only. No SQL, values, identifiers or error messages. */
const phases=new Set(['query_start','query_success','query_failure','error_frame','invalid_frame','timeout','process_error','process_close']);
const states=new Set(['00000','22012','22023','22P02','23505','40001','40P01','42501','55P03','57014','08006','57P01']);
export function createLegacyQueryDiagnostics({now=()=>performance.now(),limit=256}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>1024)throw Error('DIAGNOSTIC_LIMIT');
 let lease=0,query=0,last=0;const ring=[],tokens=new WeakSet();
 function clock(){let n;try{n=now();}catch{} if(typeof n!=='number'||!Number.isFinite(n)||n<last)return last;return last=n;}
 return Object.freeze({
  lease(){return ++lease;},
  begin(leaseId){if(!Number.isSafeInteger(leaseId)||leaseId<1||leaseId>lease)throw Error('DIAGNOSTIC_LEASE');const t=Object.freeze({leaseId,queryId:++query});tokens.add(t);return t;},
  emit(token,phase,sqlstate){if(!tokens.has(token)||!phases.has(phase))return;ring.push(Object.freeze({...token,phase,monotonicMs:clock(),sqlstate:states.has(sqlstate)?sqlstate:'other'}));if(ring.length>limit)ring.shift();},
  snapshot(){return Object.freeze(ring.slice());},
 });
}
