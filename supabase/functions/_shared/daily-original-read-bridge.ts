// Display references only. Never feed these into financial evidence or recognition.
type Row = Record<string, any>;
type Deps = {
 selectedStore:(session:Row,payload:Row)=>Promise<Row>;
 hasCapability:(session:Row,capability:string)=>boolean;
 rpc:(args:Row)=>Promise<Row>;
 sign:(path:string)=>Promise<string>;
};
const unavailable = () => ({state:"unavailable",count:null});
export function dailyOriginalReadUnavailable(mode:string,data:Row):Row {
 return mode==="month" ? {...data,days:(data.days||[]).map((day:Row)=>({...day,original_archive:unavailable()}))}
  : {...data,original_archive:unavailable(),archived_originals:[]};
}
export async function dailyOriginalReadBridge(mode:"month"|"detail",payload:Row,session:Row,data:Row,deps:Deps):Promise<Row> {
 try {
  if(!deps.hasCapability(session,"voucher.read")&&!deps.hasCapability(session,"daily_report.write"))throw Error("read scope required");
  const store=await deps.selectedStore(session,payload);
  const staff=session.staff_report_readonly===true;
  const actor=staff?null:String(session.auth_account_id||"");
  const staffId=staff?Number(session.auth_staff_id):null;
  if((staff&&(!Number.isSafeInteger(staffId)||Number(staffId)<=0))||(!staff&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(actor))))throw Error("read identity required");
  const date=mode==="detail"?String(data.draft?.report_date||""):String(data.month||"")+"-01";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error("read date invalid");
  const end=new Date(date+"T00:00:00Z");if(mode==="detail")end.setUTCDate(end.getUTCDate()+1);else end.setUTCMonth(end.getUTCMonth()+1);
  const result=await deps.rpc({p_actor_user_id:actor,p_staff_id:staffId,p_company_id:store.company_id,p_store_id:store.id,
   p_start_date:date,p_end_date:end.toISOString().slice(0,10),p_detail:mode==="detail"});
  if(!Array.isArray(result.days)||!Array.isArray(result.archives))throw Error("read receipt invalid");
  const counts=new Map<string,number>();
  for(const row of result.days){if(typeof row.report_date!=="string"||row.report_date<date||row.report_date>=end.toISOString().slice(0,10)
    ||!Number.isSafeInteger(row.count)||row.count<=0||counts.has(row.report_date))throw Error("read counts invalid");counts.set(row.report_date,row.count);}
  const state=(day:string)=>({state:counts.has(day)?"archived":"none",count:counts.get(day)||0});
  if(mode==="month")return {...data,days:(data.days||[]).map((day:Row)=>({...day,original_archive:state(String(day.report_date))}))};
  if(result.archives.length!==(counts.get(date)||0))throw Error("read detail incomplete");
  const seen=new Set<string>();
  const originals=result.archives.map((row:Row)=>{
   if(row.report_date!==date||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(row.request_id))||seen.has(row.request_id)
    ||row.object_path!==String(store.company_id)+"/"+String(store.id)+"/daily-originals/"+date.slice(0,7)+"/"+date+"/"+row.request_id
    ||!["image/jpeg","image/png"].includes(row.mime_type)||!Number.isSafeInteger(row.size_bytes)||row.size_bytes<=0||row.size_bytes>10485760
    ||!/^[a-f0-9]{64}$/.test(row.sha256)||typeof row.original_filename!=="string")throw Error("read original invalid");
   seen.add(row.request_id);
   return {request_id:row.request_id,report_date:row.report_date,original_filename:row.original_filename,mime_type:row.mime_type,
    size_bytes:row.size_bytes,sha256:row.sha256,completed_at:row.completed_at,review_status:"unreviewed",private_url:null,url_expires_in:300} as Row;
  });
  // Bound simultaneous signing; a failed link never erases a completed original.
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,originals.length)},async()=>{
   while(cursor<originals.length){const i=cursor++;try{const url=await deps.sign(result.archives[i].object_path);
     if(new URL(url).protocol!=="https:")throw Error("invalid signed URL");originals[i].private_url=url;
    }catch{originals[i].url_unavailable=true;}}
  }));
  return {...data,original_archive:state(date),archived_originals:originals};
 } catch { return dailyOriginalReadUnavailable(mode,data); }
}
