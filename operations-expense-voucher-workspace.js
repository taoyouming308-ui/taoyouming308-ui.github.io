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
        openCellTrace(target.source_locator);
      };cell.appendChild(button);
    });
  }
  function request(item,target,fields){return {voucher_id:item.source_voucher_id||item.id,component_index:item.component_index||0,
    task_id:item.latest_ocr_task&&item.latest_ocr_task.id,target_kind:target.target_kind,target_id:target.id,
    corrected_fields:fields,reason:'人工核对开支凭证：'+item.original_filename+' → '+target.summary};}
  root.ZysyrExpenseVoucherWorkspace={
    forCell:async function(data,address,context){
      if(isLocalPreview()||!state.user||state.user.role!=='finance'||!state.user.can_match_expense_vouchers||!state.user.can_manage_finance_workbench)return data;
      if(['income','salary','total','fixed','purchase_summary'].includes(data.item_category))return data;
      var key=scopeKey(),workspace=await root.ZysyrExpenseVoucherWorkspace.read({store:context.store,month:context.month});
      if(key!==scopeKey()||!voucherContextCurrent(context))return data;
      var report=state.data.monthly_report,source=workspace.source_selection||{};
      var target=(workspace.targets||[]).find(function(t){return t.target_kind==='monthly_source'&&t.source_locator===address
        &&(report.sha256&&report.sha256===source.sha256||t.electronic_cell&&t.electronic_cell.report_id===report.id);});
      if(!target)return data;
      var items=(workspace.items||[]).filter(function(item){return item.confirmed_target_id&&(item.confirmed_target_kind==='monthly_source'&&item.confirmed_target_id===target.id
        ||/备用金/.test(target.summary)&&['formal','history','draft','source_petty'].includes(item.confirmed_target_kind));});
      var files=items.map(function(item){return {id:item.source_voucher_id||item.id,original_filename:item.original_filename,mime_type:item.mime_type,
        evidence_source:'voucher_attachment',trace_link_level:'page_confirmed',trace_source_locator:'manual-upload:expense-association'};});
      return Object.assign({},data,{expense_library:{workspace:workspace,target:target,key:key},evidence:(data.evidence||[]).concat(files),
        item_category:data.item_category==='petty_cash_summary'?'expense':data.item_category});
    },
    mountLibrary:function(host,data,address,context,preview){
      if(!data.expense_library||!data.can_upload_vouchers)return;
      var library=data.expense_library,target=library.target,workspace=library.workspace;
      var section=document.createElement('section');section.className='monthly-library';
      section.innerHTML='<button type="button" class="secondary" data-library-open>从凭证上传库选择</button><div data-library-panel hidden></div>';
      host.appendChild(section);
      function active(){return section.isConnected&&library.key===scopeKey()&&voucherContextCurrent(context)&&state.trace.address===address;}
      section.querySelector('[data-library-open]').onclick=function(){
        var panel=section.querySelector('[data-library-panel]');panel.hidden=!panel.hidden;if(panel.hidden)return;
        panel.innerHTML='<h4>选择已上传凭证</h4><div class="help">'+esc(context.month+' · '+target.summary)+'。先核对原图，再确认关联。</div>'
          +'<input type="search" data-library-search aria-label="搜索凭证" placeholder="搜索文件名、商户、金额"><div data-library-list></div><div data-library-selected></div>';
        var search=panel.querySelector('[data-library-search]'),list=panel.querySelector('[data-library-list]'),selected=panel.querySelector('[data-library-selected]');
        function amountCents(value){return value!=null&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>0?Math.round(Number(value)*100):null;}
        var targetCents=amountCents(target.amount);
        var ranked=(workspace.items||[]).map(function(item,index){
          var fields=Object.assign({},item.candidate_fields||{},item.corrected_fields||{}),cents=amountCents(fields.amount);
          return {item:item,index:index,difference:targetCents===null||cents===null?Infinity:Math.abs(cents-targetCents)};
        }).sort(function(a,b){return a.difference-b.difference||Number(Boolean(a.item.confirmed_target_id||a.item.expense_association))-Number(Boolean(b.item.confirmed_target_id||b.item.expense_association))||a.index-b.index;});
        function renderList(){var query=search.value.trim().toLowerCase();list.innerHTML='';
          ranked.filter(function(row){var item=row.item,fields=Object.assign({},item.candidate_fields||{},item.corrected_fields||{});return [item.original_filename,fields.counterparty,fields.amount,fields.expense_category,fields.document_date,fields.period_month,fields.summary].join(' ').toLowerCase().includes(query);}).forEach(function(row){
            var item=row.item,fields=Object.assign({},item.candidate_fields||{},item.corrected_fields||{}),linked=Boolean(item.confirmed_target_id||item.expense_association),button=document.createElement('button');
            button.type='button';button.className='ghost monthly-library-item';button.textContent=(item.original_filename||'凭证')+(item.component_count>1?' · 第 '+(item.component_index+1)+' 笔':'')
              +' · '+(fields.amount==null?'金额待核对':formatAmount(fields.amount))+(Number.isFinite(row.difference)?row.difference===0?' · 金额一致':' · 相差 '+formatAmount(row.difference/100):'')+(linked?' · 已关联':'');
            button.onclick=function(){if(active())choose(item,linked);};list.appendChild(button);
          });if(!list.children.length)list.textContent='没有找到相符的凭证。';
        }
        async function choose(item,linked){
          var fields=item.candidate_fields||{},generation=Number(selected.dataset.request||0)+1;selected.dataset.request=generation;
          selected.innerHTML='<div data-library-preview>正在读取原图…</div><div data-library-fields></div>';
          var picture=selected.querySelector('[data-library-preview]'),form=selected.querySelector('[data-library-fields]');
          form.innerHTML=linked?'<div class="help">此凭证已有对应关系，请保留原关联；如需更改，请到凭证库核对原记录。</div>':
            '<div class="field"><label>凭证用途</label><select data-library-kind><option value="transaction">单笔付款凭证</option><option value="monthly_summary">本月汇总佐证（不确认单笔付款）</option></select></div>'
            +'<div class="field"><label>凭证日期</label><input type="date" data-library-date aria-label="凭证日期"></div>'
            +'<div class="field" data-library-month-field hidden><label>凭证所属月份（人工核对）</label><input type="month" data-library-month aria-label="凭证所属月份"></div>'
            +'<div class="field"><label>凭证金额</label><input type="number" step="0.01" min="0.01" data-library-amount aria-label="凭证金额"></div>'
            +'<label class="simple-voucher-rule"><input type="checkbox" data-library-attest> 已核对原图，确认对应当前月报栏目</label>'
            +'<button type="button" class="primary" data-library-confirm>确认关联这份凭证</button><div role="status" data-library-status></div>';
          if(!linked){
            var kind=form.querySelector('[data-library-kind]'),date=form.querySelector('[data-library-date]'),month=form.querySelector('[data-library-month]'),amount=form.querySelector('[data-library-amount]');
            kind.value=fields.evidence_kind==='monthly_summary'?'monthly_summary':'transaction';date.value=fields.document_date||'';month.value=fields.period_month||'';amount.value=fields.amount==null?'':fields.amount;
            kind.onchange=function(){var summary=kind.value==='monthly_summary';date.closest('.field').hidden=summary;form.querySelector('[data-library-month-field]').hidden=!summary;};kind.onchange();
            form.querySelector('[data-library-confirm]').onclick=async function(){
              if(!active())return;var status=form.querySelector('[data-library-status]'),button=form.querySelector('[data-library-confirm]');
              if(!picture.querySelector('img,iframe')){status.textContent='请先读取并核对原图，再确认关联。';return;}
              if(!form.querySelector('[data-library-attest]').checked){status.textContent='请先核对原图并勾选确认。';return;}
              var summary=kind.value==='monthly_summary',period=summary?month.value:date.value.slice(0,7);
              if(period!==context.month||!(Number(amount.value)>0)||!summary&&!date.value){status.textContent='请核对凭证日期或所属月份、金额。缺少的日期不可猜填。';return;}
              if(Math.abs(Number(amount.value)-Number(target.amount))>.01&&!window.confirm('凭证金额与月报栏目金额不同。已核对这份凭证确实是该栏目的组成凭证吗？'))return;
              button.disabled=true;
              try{
                var result=await root.ZysyrExpenseVoucherWorkspace.confirm(item,{corrected_fields:Object.assign({},fields,{evidence_kind:kind.value,document_date:summary?null:date.value,period_month:period,amount:amount.value})},target,{store:context.store,month:context.month});
                if(!active())return;
                if(!result.saved||!Number(result.saved.inserted)){status.textContent='关联未新增，凭证状态可能已变化。请关闭后重新打开核对。';return;}
                toast('凭证已关联，月报金额未修改');await openCellTrace(address);
              }catch(error){if(active())status.textContent='关联未确认：'+error.message;}
              finally{if(button.isConnected)button.disabled=false;}
            };
          }
          try{var file=await api('voucher_url',{store:context.store,voucher_id:item.source_voucher_id||item.id});
            if(active()&&Number(selected.dataset.request)===generation)preview(Object.assign({},item,{file_url:file.url,filename:file.filename}),picture,function(){choose(item,linked);});
          }catch(error){if(active()&&Number(selected.dataset.request)===generation)picture.textContent='原图读取失败：'+error.message;}
        }
        search.oninput=renderList;renderList();
      };
    },
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
    reanalyze:async function(data,scope){var ids=Array.from(new Set((data.items||[]).filter(function(item){return !item.confirmed_target_id&&!item.expense_association&&!item.latest_review&&!['queued','processing'].includes(item.task_status)&&!(data.expense_links||[]).some(function(link){return link.voucher_id===(item.source_voucher_id||item.id);});}).map(function(item){return item.source_voucher_id||item.id;}))).slice(0,30);
      if(!ids.length)return {queued:0};return api('expense_voucher_reanalyze',Object.assign({},scope,{voucher_ids:ids}));},
    retryFailures:async function(data,scope){var ids=Array.from(new Set((data.items||[]).filter(function(item){return !item.confirmed_target_id&&['failed','dead_letter'].includes(item.task_status);}).map(function(item){return item.source_voucher_id||item.id;}))).slice(0,30);
      if(!ids.length)return {queued:0};return api('expense_voucher_failures_retry',Object.assign({},scope,{voucher_ids:ids}));}
  };
})(window);
