/* All expense evidence shares the existing upload panel and current store/month. */
(function(root){
  'use strict';
  var attempted=new Map(),monthlyCache=null,lastMonthlyCells=null,lastMonthlyScope=null;
  function scopeKey(){return JSON.stringify([currentStore(),document.getElementById('month').value,root.ZysyrPettyScopeIdentity?root.ZysyrPettyScopeIdentity():state.session]);}
  function monthlyData(data){return {source:data.source_selection,expense_voucher_targets:data.targets||[],expense_voucher_matches:(data.items||[]).filter(function(i){return i.confirmed_target_id;}).map(function(i){return {voucher_id:i.source_voucher_id||i.id,filename:i.original_filename,mode:i.expense_association&&i.expense_association.mode||'manual',target:(data.targets||[]).find(function(t){return t.id===i.confirmed_target_id&&t.target_kind===i.confirmed_target_kind;})};})};}
  function decorate(cells,data,key){
    var report=state.data&&state.data.monthly_report;
    if(key!==scopeKey()||!report)return;
    (data.expense_voucher_targets||[]).filter(function(t){return t.target_kind==='monthly_source';}).forEach(function(target){
      if(report.sha256!==(data.source||{}).sha256&&(!target.electronic_cell||target.electronic_cell.report_id!==report.id))return;
      var cell=cells[target.source_locator];if(!cell||!cell.isConnected)return;
      cell.querySelectorAll('[data-expense-cell-vouchers]').forEach(function(b){b.remove();});
      var files=[];(data.expense_voucher_matches||[]).forEach(function(link){var t=link.target||{};
        if((t.target_kind==='monthly_source'&&t.id===target.id||/备用金/.test(target.summary)&&['formal','history','draft','source_petty'].includes(t.target_kind))&&!files.some(function(f){return f.voucher_id===link.voucher_id;}))files.push(link);});
      if(!files.length)return;
      var button=document.createElement('button');button.type='button';button.className='ghost';button.dataset.expenseCellVouchers=target.id;button.textContent='凭证 '+files.length+' 份';button.style.cssText='display:block;font-size:10px;min-height:24px;margin-top:2px';
      button.onclick=function(event){event.stopPropagation();if(key!==scopeKey())return;
        var backdrop=document.getElementById('trace-backdrop'),host=document.getElementById('trace-content');if(!backdrop||!host)return;
        backdrop.classList.remove('hidden');backdrop.setAttribute('aria-hidden','false');host.innerHTML='<section class="trace-card"><h4>'+esc(target.summary)+' · 对应凭证</h4><p class="help">原件 '+esc(target.source_locator)+'；凭证对应不代表财务审批或入账。</p>'+files.map(function(f){return '<button type="button" class="secondary" data-expense-open="'+esc(f.voucher_id)+'">'+esc(f.filename||'查看原图')+' · '+(f.mode==='auto'?'AI匹配':'人工匹配')+'</button>';}).join('')+'</section>';
        host.querySelectorAll('[data-expense-open]').forEach(function(b){b.onclick=function(){if(key===scopeKey())openPrivate('voucher_url',{voucher_id:b.dataset.expenseOpen});};});
      };cell.appendChild(button);
    });
  }
  function request(item,target,fields){return {voucher_id:item.source_voucher_id||item.id,component_index:item.component_index||0,
    task_id:item.latest_ocr_task&&item.latest_ocr_task.id,target_kind:target.target_kind,target_id:target.id,
    corrected_fields:fields,reason:'人工核对开支凭证：'+item.original_filename+' → '+target.summary};}
  root.ZysyrExpenseVoucherWorkspace={
    read:async function(payload){var key=scopeKey(),data=await api('expense_voucher_workspace',payload);if(data&&data.month===payload.month&&key===scopeKey()){
      monthlyCache={key:key,data:monthlyData(data)};
      if(lastMonthlyCells&&lastMonthlyScope===key)decorate(lastMonthlyCells,monthlyCache.data,key);
    }return data;},
    decorateMonthly:async function(cells){
      await Promise.resolve();
      if(isLocalPreview()||!state.user||state.user.can_match_expense_vouchers!==true||state.user.role!=='finance'||state.user.can_manage_finance_workbench!==true||!state.data||!state.data.monthly_report)return;
      var key=scopeKey();lastMonthlyCells=cells;lastMonthlyScope=key;try{
        if(monthlyCache&&monthlyCache.key===key){decorate(cells,monthlyCache.data,key);return;}
        var data=await api('report_source_review',{store:currentStore(),month:document.getElementById('month').value,kind:'expenses',include_expense_matches:true});
        if(key!==scopeKey())return;monthlyCache={key:key,data:data};decorate(cells,data,key);
      }catch(_){/* Existing monthly data and trace actions remain available. */}
    },
    options:function(targets,selected,suggestions){
      return [['monthly_source','月报全部开支栏目'],['source_petty','原件备用金逐笔明细']].map(function(group){
        var rows=targets.filter(function(t){return t.target_kind===group[0];});
        return rows.length?'<optgroup label="'+group[1]+'">'+rows.map(function(t){
          var value=t.target_kind+':'+t.id,match=(suggestions||[]).find(function(m){return m.target_kind===t.target_kind&&m.target_id===t.id;});
          return '<option value="'+esc(value)+'" '+(value===selected?'selected':'')+'>'+esc((match?'推荐（'+match.reason+'）· ':'')+(t.transaction_date||t.period_month)+' · '+t.summary+' · '+(t.amount==null?'原件金额空白':'¥'+formatAmount(t.amount))+' · '+(t.source_locator||''))+'</option>';
        }).join('')+'</optgroup>':'';
      }).join('');
    },
    label:function(item){var names={payment:'支付凭证',invoice:'发票',receipt:'收据',payroll:'工资表',bank_statement:'银行流水',chat_transfers:'聊天转账',advertising_report:'广告报表',recharge_list:'充值列表',order:'订单',other:'其他凭证',unknown:'类型待识别'};
      var fields=item.candidate_fields||{},category=item.match&&item.match.expense_category;
      return (names[fields.document_type]||'类型待识别')+' · '+(fields.expense_category||(category&&category.label)||'费用待分类')
        +(fields.evidence_kind==='monthly_summary'?' · 月度汇总佐证':item.component_count>1?' · 第 '+(item.component_index+1)+' / '+item.component_count+' 笔':'');},
    confirm:async function(item,draft,target,scope){var result=await api('expense_voucher_match_apply',Object.assign({},scope,{mode:'manual',items:[request(item,target,draft.corrected_fields)]}));monthlyCache=null;return result;},
    autoMatch:async function(data,scope,isCurrent,isDirty,includeExisting){
      var items=(data.items||[]).filter(function(item){return !item.confirmed_target_id&&item.match&&item.match.auto_eligible
        && (includeExisting||item.automate_on_read)&&!isDirty(item.id);}).slice(0,20);
      var selected=items.filter(function(item){var key=JSON.stringify([scope,item.source_voucher_id||item.id,item.component_index||0,item.latest_ocr_task&&item.latest_ocr_task.id,item.match.target_kind,item.match.target_id]);
        if(!includeExisting&&attempted.has(key))return false;attempted.set(key,Date.now());return true;});
      if(!selected.length||!isCurrent())return 0;
      var result=await api('expense_voucher_match_apply',Object.assign({},scope,{mode:'auto',items:selected.map(function(item){return request(item,{target_kind:item.match.target_kind,id:item.match.target_id});})}));
      monthlyCache=null;
      return Number(result.saved&&result.saved.inserted||0);
    },
    retryFailures:async function(data,scope){var ids=Array.from(new Set((data.items||[]).filter(function(item){return !item.confirmed_target_id&&['failed','dead_letter'].includes(item.task_status);}).map(function(item){return item.source_voucher_id||item.id;}))).slice(0,30);
      if(!ids.length)return {queued:0};return api('expense_voucher_failures_retry',Object.assign({},scope,{voucher_ids:ids}));}
  };
})(window);
