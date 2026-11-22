/** Test-only fixed-enum metrics. No SQL, parameters, results, identity or Error text. */
const phases=new Set(['lease_spawn','lease_first_frame','query_frame','result_parse','query_total','workflow_history_scan','lease_closed','lease_total']);
const commands=new Set(['SELECT','WITH','INSERT','UPDATE','BEGIN','SET','COMMIT','ROLLBACK']);
const outcomes=new Set(['success','error']);
const errors=new Set(['none','server_error','frame_invalid','result_invalid','connection_closed','query_timeout','transport_error','unknown']);
export function fixtureErrorKind(error){
 const sentinel={SYNTHETIC_ERROR_FRAME_INVALID:'frame_invalid',INVALID_SYNTHETIC_CLIENT_RESULT:'result_invalid',SYNTHETIC_CONNECTION_CLOSED:'connection_closed',SYNTHETIC_QUERY_TIMEOUT:'query_timeout'};
 if(Object.hasOwn(sentinel,error?.message))return sentinel[error.message];
 return typeof error?.code==='string'&&/^[A-Z0-9]{5}$/.test(error.code)?'server_error':'unknown';
}
export function createPostgresFixtureTiming(observer){
 const enabled=typeof observer==='function';
 return Object.freeze({enabled,now:()=>enabled?performance.now():0,emit(phase,details){
  if(!enabled||!phases.has(phase)||!details||!Number.isFinite(details.durationMs)||details.durationMs<0||!outcomes.has(details.outcome)||!errors.has(details.errorKind))return;
  if(Object.hasOwn(details,'command')&&!commands.has(details.command))return;
  const event=Object.freeze({phase,durationMs:details.durationMs,outcome:details.outcome,errorKind:details.errorKind,...(details.command?{command:details.command}:{})});
  try{Promise.resolve(observer(event)).catch(()=>{});}catch{/* Diagnostic delivery never changes query outcomes. */}
 }});
}
