(function(){
 'use strict';
 const host=document.getElementById('aesthetic-study-admin');if(!host)return;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let rows=[],employees=[],cases=[],feed=[],view='overview',search='',failed='',loading=false;
 async function api(operation,extra={}){
  const s=getAdminSession();const r=await fetch(SUPABASE_URL+'/functions/v1/aesthetic-study',{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_KEY},body:JSON.stringify({operation,admin_token:s.trainingToken||'',...extra}),signal:AbortSignal.timeout(12000)});
  const data=await r.json();if(!r.ok)throw Error(data.error||'加载失败');return data;
 }
 const date=x=>x?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
 function render(){
  let body='';
  if(loading)body='<p>正在读取学习记录…</p>';
  else if(failed)body='<p role="alert">'+esc(failed)+'；请确认后台登录有效后重试。</p><button data-retry class="btn-edit">重新读取</button>';
  else if(view==='overview'){
   const read=new Set(rows.filter(x=>x.visits>0).map(x=>x.employee_id)),done=rows.filter(x=>x.self_completed).length;
   body='<div class="stats-grid"><div class="stat-card"><div class="stat-value">'+read.size+'</div><div class="stat-label">有浏览记录员工</div></div><div class="stat-card"><div class="stat-value">'+employees.filter(x=>!read.has(x.id)).length+'</div><div class="stat-label">尚无浏览记录员工</div></div><div class="stat-card"><div class="stat-value">'+done+'</div><div class="stat-label">自主学完案例记录</div></div></div><p class="page-desc">只统计本功能上线后的记录；无记录不等于没有学习。有效停留为估算，自主学完不代表已掌握。历史浏览器标记不追溯归属。</p><div class="action-list">'+employees.map(e=>'<div class="action-card"><strong>'+esc(e.username)+' · '+esc(e.store)+'</strong><span>'+(read.has(e.id)?'已有浏览记录':'尚无浏览记录')+'</span></div>').join('')+'</div>';
  }else if(view==='records'){
   const filtered=rows.filter(r=>[r.username,r.store,cases.find(c=>c.id===r.case_id)?.title||r.case_id].join(' ').includes(search));
   const cards=filtered.map(r=>'<article class="study-record-card"><strong>'+esc(r.username)+' · '+esc(r.store)+'</strong><p>'+esc(cases.find(c=>c.id===r.case_id)?.title||r.case_id)+'</p><p>浏览 '+r.visits+' 次 · 有效停留（估算） <b>'+Math.floor(r.active_ms/60000)+'分'+Math.floor(r.active_ms/1000%60)+'秒</b></p><p>'+ (r.answer_viewed_at?'<span>区域显示过</span>':'<span>答案暂无记录</span>')+' · '+(r.self_completed?'<span>已自主标记</span>':'<span>未标记学完</span>')+'</p><p class="page-desc">首次 '+esc(date(r.first_view_at))+'<br>最近 '+esc(date(r.last_view_at))+'<br>内容版本 '+esc(r.content_version.slice(0,8))+'</p></article>').join('');
   body='<label>检索员工、门店或案例 <input data-search value="'+esc(search)+'" placeholder="输入名称"></label><div class="study-record-cards">'+cards+'</div><div class="admin-table-wrap study-records-table"><table><thead><tr><th>员工 / 门店</th><th>案例 / 版本</th><th>首次 / 最近浏览</th><th>次数</th><th>有效停留（估算）</th><th>答案区域</th><th>自主学完</th></tr></thead><tbody>'+filtered.map(r=>'<tr><td>'+esc(r.username)+'<br>'+esc(r.store)+'</td><td>'+esc(cases.find(c=>c.id===r.case_id)?.title||r.case_id)+'<br><small>'+esc(r.content_version.slice(0,8))+'</small></td><td>'+esc(date(r.first_view_at))+'<br>'+esc(date(r.last_view_at))+'</td><td>'+r.visits+'</td><td>'+Math.floor(r.active_ms/60000)+'分'+Math.floor(r.active_ms/1000%60)+'秒</td><td>'+(r.answer_viewed_at?'区域显示过':'暂无记录')+'</td><td>'+(r.self_completed?'已自主标记':'未标记')+'</td></tr>').join('')+'</tbody></table></div>'+(!filtered.length?'<p>暂无符合条件的学习记录。</p>':'')+'<p class="page-desc">当前未提供答题提交；答案区域显示不等于读懂或作答。重叠停留只计一次，按首次入库案例归属。</p>';
  }else{
   body='<p class="page-desc">查看员工端已发布图文案例。内容继续按现有审核与Git发布流程更新，此处不自动发布旧知识候选。</p>'+feed.map(x=>'<details class="panel"><summary>'+esc(x.date+' · '+x.title)+'</summary><img style="max-width:100%;height:auto" src="'+esc(x.image)+'" alt="'+esc(x.caption)+'"><p>'+esc(x.caption)+'</p><p>'+esc(x.question)+'</p>'+x.answer.map(a=>'<p><strong>'+esc(a.title)+'</strong><br>'+esc(a.text)+'</p>').join('')+'</details>').join('');
  }
  host.innerHTML='<nav class="aesthetic-workflow-nav">'+[['overview','学习概览'],['records','员工记录'],['cases','案例查看管理']].map(([k,title])=>'<button class="'+(view===k?'active':'')+'" data-view="'+k+'">'+title+'</button>').join('')+'<button data-retry>刷新记录</button></nav><div class="panel">'+body+'</div>';
 }
 async function load(){
  if(loading)return;loading=true;failed='';render();
  try{
   const all=[];let offset=0,data;
   do{data=await api('admin_overview',{offset});all.push(...data.rows);offset+=data.rows.length;}while(data.rows.length===500);
   rows=all;employees=data.employees;cases=data.cases;
   const r=await fetch('docs/aesthetic-training/feed.v1.json',{cache:'no-cache',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('案例读取失败');
   const f=await r.json();feed=(f.items||[]).filter(x=>/^img\/aesthetic-training\/[a-z0-9._-]+\.(png|jpg|webp)$/.test(x.image));
   await archives();
  }catch(e){failed=e.message;}finally{loading=false;render();}
 }
 async function archives(){
  const target=document.getElementById('aesthetic-study-archives');if(!target)return;
  const data=await api('admin_archives');
  target.innerHTML='<p class="page-desc">已退出工作区的旧待审资料，可按原状态恢复。已发布知识、来源和员工数据不受影响。</p>'+data.rows.map(r=>'<p>'+esc(r.candidate_id)+' · '+esc(date(r.archived_at))+' '+(r.restored_at?'已恢复':'<button class="btn-edit" data-restore="'+esc(r.candidate_id)+'">恢复到旧审核区</button>')+'</p>').join('');
 }
 host.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.view){view=b.dataset.view;render();}if(b.hasAttribute('data-retry'))load();});
 host.addEventListener('change',e=>{if(e.target.hasAttribute('data-search')){search=e.target.value;render();}});
 document.getElementById('aesthetic-study-archives')?.addEventListener('click',async e=>{const b=e.target.closest('[data-restore]');if(!b)return;b.disabled=true;try{await api('admin_restore',{candidate_id:b.dataset.restore});aestheticCloudCandidates=null;await archives();}catch(err){b.disabled=false;toast(err.message,'err');}});
 const original=window.loadAestheticAdmin;
 window.loadAestheticAdmin=function(){original();if(!loading)load();};
 if(document.getElementById('tab-aesthetic')?.classList.contains('active'))load();
})();
