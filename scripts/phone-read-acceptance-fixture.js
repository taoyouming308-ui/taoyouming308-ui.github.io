// Injected ONLY by the loopback QA server, before loading an actual App shell.
(() => {
  'use strict';
  if(location.hostname!=='127.0.0.1'||!document.querySelector('meta[name="phone-fixture"]'))return;
  const area=location.pathname,secret='fixture-session-not-valid-at-any-service-0001',shop='验收专用门店';
  const user={username:'演示发型师',display_name:'演示发型师',role:'staff',position:'发型师',store:shop,stores:[shop],can_import:false};
  const finance={...user,username:'测试只读财务',display_name:'测试只读财务',role:'shareholder',can_read_daily_reports:true,can_read_salary:true,can_read_petty_cash_reports:true};
  if(area==='/perm-app.html')localStorage.setItem('booking-session',JSON.stringify({...user,session_token:secret,loggedAt:Date.now()}));
  if(area==='/frontdesk.html')localStorage.setItem('zysyr-frontdesk-session-v1',JSON.stringify({session_token:secret,user}));
  if(area==='/operations.html')localStorage.setItem('zysyr-operations-session-v1',secret);
  const phone='55500011199',name='演示顾客甲';
  const customer={name,customer_name:name,phone,customer_phone:phone,profile_id:'qa-profile-1',id:'qa-profile-1',store:shop,store_name:shop,visit_count:2};
  const ok=(v,code=200)=>new Response(JSON.stringify(v),{status:code,headers:{'content-type':'application/json'}});
  const calls=window.__phoneFixtureCalls=[];
  window.fetch=async(input,options={})=>{
    const mode=sessionStorage.getItem('test-network');await new Promise(r=>setTimeout(r,mode==='slow'?1200:35));
    if(mode==='offline')throw TypeError('模拟接口断网（只读验收）');
    const raw=typeof input==='string'?input:input.url||String(input),url=new URL(raw,location.href);
    const method=(options.method||input.method||'GET').toUpperCase();
    // Read-only fixture. No calls, auth headers, keys or private data are ever forwarded.
    if(method==='GET'||method==='HEAD'){
      if(url.pathname.startsWith('/rest/v1/'))return ok([]);
      if(url.pathname.endsWith('version.json'))return ok({version:document.documentElement.dataset.version});
      return ok({error:'该资源不在只读演示范围'},404);
    }
    let b;try{b=JSON.parse(options.body||'{}')}catch{return ok({error:'仅接受已知的只读请求'},405)}
    const op=b.operation;calls.push(op||'unsupported');if(calls.length>100)calls.shift();
    const day=b.date||b.business_date||new Date().toISOString().slice(0,10),month=b.month||day.slice(0,7);
    const row={id:'qa-booking-1',date:day,store:shop,customer_name:name,customer_phone:phone,barber_name:user.username,time_label:'09:00',service_name:'演示剪发',source:'frontdesk'};
    let result;
    switch(op){
      case 'session':result={user:area==='/operations.html'?finance:user};break;
      case 'registration_options':result={stores:[shop]};break;
      case 'report_access':case 'bootstrap':result={enabled:false};break;
      case 'today_bookings':result={store:shop,date:day,barber:user.username,rows:[row]};break;
      case 'dashboard':result={store:shop,date:day,bookings:[row],barbers:[user.username]};break;
      case 'ledger_records':result={store:shop,business_date:day,rows:[{...row,row_type:'today',amount:100}]};break;
      case 'business_details':result={available:false,store:shop,date:day};break;
      case 'customer_search':result={store:shop,customer_scope:b.customer_scope||'store',results:[customer]};break;
      case 'customer_detail':result={store:shop,customer_scope:b.customer_scope||'store',customer,summary:{visit_count:2},packages:[],timeline:[{date:day,service_name:'演示剪发'}]};break;
      case 'customer_profiles':result={profiles:[customer],rows:[customer]};break;
      case 'customer_hair_records':case 'customer_history':result={rows:[],records:[]};break;
      case 'customer_design_photo_urls':result={urls:[]};break;
      case 'overview':result={store:shop,month,reports:[],monthly_report:null,monthly_unlock_requests:[],monthly_editable_cells:[],daily_reports:[]};break;
      case 'daily_sheet_month':result={store:shop,month,days:[{report_date:month+'-01',draft_id:'qa-day-1',status:'confirmed',grand_total:100,edit_revision:1,original_count:0,missing_original:true,has_anomaly:false}],permissions:{read:true}};break;
      case 'daily_sheet_read':result=typeof window.previewDailySheetData==='function'?window.previewDailySheetData():{rows:[]};break;
      case 'salary_sheet_read':result={permissions:{},sheet:null,rows:[]};break;
      case 'payroll_center':result={permissions:{},employees:[],salary_reports:[]};break;
      case 'petty_cash_report':result={records:[],opening_balance:0,permissions:{}};break;
      case 'voucher_center':result={vouchers:[],permissions:{}};break;
      default:return ok({error:'验收只读：不支持 '+(op||'此操作')+'，未发送或保存。'},405);
    }
    if(b.read_sync&&window.ZysyrReadCodec)result=await window.ZysyrReadCodec.encode(b.read_sync,result);
    return ok(result);
  };
  // The header CSP is the actual network boundary, not this JavaScript shim.
  window.open=()=>null;
  document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href]');if(a&&new URL(a.href,location.href).origin!==location.origin)e.preventDefault()},true);
})();
