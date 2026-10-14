(function(global){
  'use strict';
  function node(tag,text,cls){var el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el}
  function button(text,fn,secondary){var el=node('button',text,secondary?'review-secondary':'');el.type='button';el.onclick=fn;return el}
  function time(value){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):''}
  function column(index){var name='';for(var n=index+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name}
  function snapshotTable(snapshot,target){
    var display=snapshot.report.display_data,values=display.values||[],starts={},covered={},cells={};
    (display.merges||[]).forEach(function(m){starts[m.start_row+':'+m.start_col]=m;for(var r=m.start_row;r<=m.end_row;r++)for(var c=m.start_col;c<=m.end_col;c++)if(r!==m.start_row||c!==m.start_col)covered[r+':'+c]=true});
    var scroll=node('div',null,'monthly-review-scroll'),table=node('table',null,'monthly-review-table'),body=node('tbody');
    table.setAttribute('aria-label',snapshot.month+' 已提交月报快照');
    for(var r=0;r<Math.max(values.length,Number(display.rows)||0);r++){
      var tr=node('tr');for(var c=0;c<Math.max(Number(display.columns)||0,23);c++){
        if(covered[r+':'+c])continue;var value=values[r]&&values[r][c],td=node('td',value==null?'':value),m=starts[r+':'+c];
        if(m){td.rowSpan=m.end_row-m.start_row+1;td.colSpan=m.end_col-m.start_col+1}cells[column(c)+(r+1)]=td;tr.appendChild(td);
      }body.appendChild(tr);
    }
    table.appendChild(body);scroll.appendChild(table);target.appendChild(scroll);
    var coverage=node('div',null,'monthly-review-history');target.appendChild(coverage);
    if(global.ZysyrMonthlyDailyPerformance)global.ZysyrMonthlyDailyPerformance.renderIntoSheet({cells:cells,month:snapshot.month,performance:snapshot.daily_performance,completenessStatus:coverage});
  }
  function create(options){
    var generation=0,dialog=null,busy=false,bar=options.bar;
    function context(){return options.context()}
    function same(ctx){var now=context();return now&&now.key===ctx.key&&now.store===ctx.store&&now.month===ctx.month&&now.allowed}
    function close(){if(dialog){dialog.remove();dialog=null}busy=false}
    function reset(){generation++;close();bar.replaceChildren();bar.hidden=true}
    async function request(op,ctx,payload){if(!same(ctx))throw Error('门店、月份或登录已变化，请重新打开');return await options.api(op,Object.assign({store:ctx.store,month:ctx.month},payload||{}))}
    async function refresh(){
      var ctx=context(),run=++generation;close();bar.replaceChildren();bar.hidden=!ctx||!ctx.allowed;if(bar.hidden)return;
      if(ctx.preview){bar.appendChild(node('span','本地预览：月报确认不连接生产、不提交记录'));return}
      bar.appendChild(node('span','正在读取股东确认状态…'));bar.setAttribute('aria-live','polite');
      try{
        var result=await request('monthly_review_status',ctx);if(run!==generation||!same(ctx))return;
        bar.replaceChildren();var copy=node('div'),pub=result.publication,receipt=result.receipt;
        copy.appendChild(node('strong',result.finance?'月报 · 股东确认':receipt?'本月已确认，账目无异议':pub?'本月报表待核对确认':'等待财务提交月报'));
        copy.appendChild(node('small',receipt?'确认时间 '+time(receipt.confirmed_at)+' · v'+pub.version+'（本版本无需重复确认）':pub?'财务已提交 v'+pub.version+' · '+time(pub.published_at):'财务核对完成并提交后，股东才会收到待办。'));
        bar.appendChild(copy);
        if(result.finance){
          if(pub){var recipients=result.recipients||[],done=recipients.filter(function(r){return r.confirmed_at}).length;copy.appendChild(node('div',done+' / '+recipients.length+' 位股东已确认'));var list=node('details',null,'monthly-review-history');list.appendChild(node('summary','查看确认情况'));recipients.forEach(function(r){list.appendChild(node('div',r.display_name+'：'+(r.confirmed_at?'已确认 '+time(r.confirmed_at):r.access_active?'待确认':'后台权限已关闭')))});copy.appendChild(list)}
          bar.appendChild(button(pub?'预览并重新提交':'提交股东确认',function(){open(ctx,result,true)}));
        }else if(pub){bar.appendChild(button(receipt?'查看已确认版本':result.assigned?'核对并确认本月报表':'查看财务提交版本',function(){open(ctx,result,false)},!!receipt))}
        if((result.history||[]).length>1){var history=node('details',null,'monthly-review-history');history.appendChild(node('summary','历史版本记录'));result.history.forEach(function(h){history.appendChild(node('div','v'+h.version+' · 财务提交 '+time(h.published_at)+(h.my_confirmed_at?' · 已确认 '+time(h.my_confirmed_at):'')))});copy.appendChild(history)}
      }catch(error){if(run!==generation||!same(ctx))return;bar.replaceChildren(node('span',error.message,'monthly-review-message'),button('重新读取',refresh,true))}
    }
    async function open(ctx,status,finance){
      if(!same(ctx)||busy)return;if(options.dirty()){options.notify('请先保存本月修改，再预览提交');return}
      busy=true;var run=generation,preview;
      try{preview=finance?await request('monthly_review_preview',ctx):null;if(run!==generation||!same(ctx))return;
        close();dialog=node('section',null,'monthly-review-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','月报核对确认');
        var header=node('header'),title=node('h2',ctx.store+' · '+ctx.month+' · '+(finance?'财务提交预览':'已提交 v'+status.publication.version));
        header.append(title,button('关闭',close,true));dialog.appendChild(header);
        var content=node('div',null,'monthly-review-content');content.appendChild(node('p',finance?'请核对下方已保存的完整月报。提交只通知后台已授权股东，不会入账或改金额。':'以下为财务提交时的固定版本。确认表示已核对本月账目且无异议，不只是已打开。'));
        snapshotTable(finance?preview.snapshot:status.publication.snapshot,content);dialog.appendChild(content);
        var footer=node('footer'),message=node('div','', 'monthly-review-message');message.setAttribute('role','status');
        var canAct=finance||(!status.receipt&&status.assigned),submit,checkbox;
        if(canAct){var label=node('label',null,'monthly-review-consent');checkbox=node('input');checkbox.type='checkbox';label.append(checkbox,node('span',finance?'我已完整核对并保存本月报表，提交给已授权股东确认':'我已核对本月报表，账目无异议（本版本确认一次后不可撤销）'));footer.appendChild(label);
          submit=button(finance?'确认提交并提醒股东':'确认账目无异议',async function(){
            if(busy||!checkbox.checked||!same(ctx))return;if(options.dirty()){message.textContent='页面还有未保存修改，请关闭并保存后重新预览';return}
            busy=true;submit.disabled=true;checkbox.disabled=true;message.textContent='正在保存确认结果，请勿重复点击…';
            try{await request(finance?'monthly_review_publish':'monthly_review_confirm',ctx,finance?{preview_token:preview.preview_token,expected_publication_id:preview.expected_publication_id,reviewed_complete:true}:{publication_id:status.publication.id,content_hash:status.publication.content_hash,statement_code:'reviewed_no_objection_v1'});
              if(!same(ctx)||run!==generation)return;close();options.notify(finance?'已提交给后台授权股东，同内容不会重置已确认记录':'本版本已确认，账目无异议');await refresh();
              if(global.parent!==global)global.parent.postMessage({type:'zysyr-monthly-review-updated'},location.origin);
            }catch(error){if(!same(ctx)||run!==generation)return;message.textContent=error.message+'。请先重新读取状态核对结果，不要连续提交。';submit.remove();checkbox.disabled=true;footer.appendChild(button('重新读取确认状态',refresh,true));}
            finally{busy=false}
          });submit.disabled=true;checkbox.onchange=function(){submit.disabled=!checkbox.checked||busy};footer.appendChild(submit);
        }else{footer.appendChild(node('span',status.receipt?'已确认 '+time(status.receipt.confirmed_at)+'，本版本不能重复确认。':'请财务提交给当前后台已授权股东后再确认。'))}
        footer.appendChild(message);dialog.appendChild(footer);document.body.appendChild(dialog);header.querySelector('button').focus();
      }catch(error){options.notify(error.message)}finally{busy=false}
    }
    document.addEventListener('keydown',function(e){if(!dialog)return;if(e.key==='Escape'){close();return}if(e.key==='Tab'){var list=Array.from(dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')),first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
    return {refresh:refresh,reset:reset};
  }
  global.MonthlyReviewUI={create:create,snapshotTable:snapshotTable};
  if(!global.state||!global.api||!document.getElementById('monthly-sheet'))return;
  var bar=node('section',null,'monthly-review-bar');bar.id='monthly-review-bar';bar.hidden=true;document.getElementById('monthly-sheet').before(bar);
  var review=create({bar:bar,api:global.api,dirty:global.monthlyHasUnsaved,notify:global.toast,context:function(){var s=global.state,u=s.user;return {key:u?String(u.username)+':'+String(s.session)+':'+String(u.role):'',store:global.currentStore(),month:document.getElementById('month').value,allowed:!!u&&['finance','shareholder'].includes(u.role)&&s.view==='monthly'&&!(s.monthlySummary&&s.monthlySummary.active)&&s.monthlyOverviewReady!==false,preview:global.isLocalPreview()}}});
  var render=global.renderAll;global.renderAll=function(){var result=render.apply(this,arguments),old=document.getElementById('monthly-ack');if(old)old.remove();review.refresh();return result};
  var load=global.loadOverview;global.loadOverview=function(){review.reset();return load.apply(this,arguments)};
  ['showLogin','showView'].forEach(function(name){var fn=global[name];global[name]=function(){review.reset();return fn.apply(this,arguments)}});
  var initial=global.loadInitialView;global.loadInitialView=function(){var params=new URLSearchParams(location.search),store=params.get('review_store'),month=params.get('review_month'),select=document.getElementById('store-select');if(store&&Array.from(select.options).some(function(o){return o.value===store}))select.value=store;if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')){var months=document.getElementById('month');if(!Array.from(months.options).some(function(o){return o.value===month}))months.add(new Option(month,month));months.value=month}return initial.apply(this,arguments)};
  global.addEventListener('storage',function(e){if(e.key==='booking-session'||e.key==='zysyr-operations-session-v1')review.reset()});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)review.refresh()});
  Promise.resolve(global.initialSessionRestore).then(function(){review.refresh()}).catch(function(){review.reset()});
})(window);
