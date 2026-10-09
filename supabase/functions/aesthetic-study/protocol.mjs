export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateEvents(events,cases,now=Date.now()) {
 if(!Array.isArray(events)||events.length<1||events.length>60)throw new Error('invalid batch');
 return events.map(e=>{
  if(!e||!UUID.test(e.event_id)||!UUID.test(e.visit_id)||!['visit','time','answer_view','complete','uncomplete'].includes(e.kind))throw new Error('invalid event');
  if(!cases.some(c=>c.id===e.case_id&&c.version===e.content_version))throw new Error('unknown case version');
  const at=Date.parse(e.at);if(!Number.isFinite(at)||at>now+120000||at<now-604800000)throw new Error('invalid time');
  const clean={event_id:e.event_id,visit_id:e.visit_id,kind:e.kind,case_id:e.case_id,content_version:e.content_version,at:new Date(at).toISOString()};
  if(e.kind==='time'){
   if(!Number.isSafeInteger(e.start_ms)||!Number.isSafeInteger(e.end_ms)||e.end_ms<=e.start_ms||e.end_ms-e.start_ms>25000||Math.abs(e.end_ms-at)>1000||e.start_ms<now-604800000)throw new Error('invalid interval');
   const date=ms=>new Date(ms+28800000).toISOString().slice(0,10);
   if(date(e.start_ms)!==date(e.end_ms-1))throw new Error('split midnight interval');
   clean.start_ms=e.start_ms;clean.end_ms=e.end_ms;
  }
  return clean;
 });
}
export function allowedEmployee(person,session){return !!person&&person.active===true&&person.employment_status==='active'&&Number.isInteger(person.id)&&person.username===session.username&&!!person.store&&person.store===session.store;}
export function allowedAdmin(person,session){return !!person&&person.active===true&&person.role==='admin'&&session.role==='admin'&&person.username===session.username;}
