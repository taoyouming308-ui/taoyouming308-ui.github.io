/** Optional server diagnostics. Never accepts data, SQL, identifiers or Error objects. */
const phases=Object.freeze({
  employee:new Set(['session_read','session_validate','staff_read','staff_validate','assignment_read','assignment_validate','binding_read','binding_validate','profile_read','profile_validate','context_rpc','context_validate']),
  access_gate:new Set(['authenticate','assignment','customer_visit','final_expiry']),
  visit_binding:new Set(['history','assignment','lifecycle','profile_context','final_consistency','transaction']),
  postgres:new Set(['acquire','begin','transaction_setup','callback','guard','commit','rollback','release']),
});
const outcomes=new Set(['start','success','failure']);
const failures=new Set(['none','dependency','missing','ambiguous','invalid_shape','invalid_value','expired','inactive','mismatch','not_configured','unknown']);
export function createDesignDiagnostics(observer,component){
  if(typeof observer!=='function'||typeof component!=='string'||!Object.hasOwn(phases,component))return ()=>{};
  return (phase,outcome,failureKind='none')=>{
    if(!phases[component].has(phase)||!outcomes.has(outcome)||!failures.has(failureKind))return;
    const event=Object.freeze({component,phase,outcome,failureKind});
    try{
      const result=observer(event);
      // Never await diagnostic delivery or let a rejected observer alter access.
      Promise.resolve(result).catch(()=>{});
    }catch{/* Diagnostics cannot change a successful or rejected operation. */}
  };
}
