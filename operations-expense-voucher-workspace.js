/* All expense evidence shares the existing upload panel and current store/month. */
(function(root){
  'use strict';
  var attempted=new Map(),monthlyCache=null,lastMonthlyCells=null,lastMonthlyScope=null,pettyViewGeneration=0;
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
  function pettySummary(target){return target&&target.target_kind==='monthly_source'&&/(^|\/)备用金$/.test(String(target.summary||'').replace(/\s/g,'').replace(/[／·]/g,'/'));}
  async function rankLibrary(items,target,month){
    if(root.ZysyrVoucherCombinationUI&&root.ZysyrVoucherCombinationUI.rank)return root.ZysyrVoucherCombinationUI.rank(items,target,month);
    return items.map(function(item,index){var fields=Object.assign({},item.candidate_fields||{},item.corrected_fields||{}),n=fields.amount==null?NaN:Number(fields.amount),amount=Number.isFinite(n)&&n>0?Math.round(n*100):null;
      return {item:item,index:index,recommendation:{amount_cents:amount},difference:amount===null?Infinity:Math.abs(amount-Math.round(Number(target.amount)*100))};}).sort(function(a,b){return a.difference-b.difference||a.index-b.index;});
  }
  function recommendationLabel(row){var hint=row.recommendation;return hint.amount_cents===null?'金额待核对':(hint.document_only?hint.amount_label+' ':'')+formatAmount(hint.amount_cents/100)+(hint.payment_unconfirmed?' · 付款待核对':'');}
  function cellLibrary(data,key){
    if(data.historical||data.item_category!=='expense'||!data.can_upload_vouchers||!data.target||!data.target.id)return data;
    return Object.assign({},data,{expense_library:{direct:true,key:key,target:{summary:data.target.label,amount:data.target.numeric_value}}});
  }
  function mountCellLibrary(host,data,address,context,preview){
    var library=data.expense_library,section=document.createElement('section');section.className='monthly-library';
    section.innerHTML='<button type="button" class="secondary" data-library-open>从凭证上传库选择</button><div data-library-panel hidden></div>';host.appendChild(section);
    var payload={store:context.store,month:context.month,report_id:data.report.id,cell_id:data.target.id},loading=false;
    function active(){return section.isConnected&&library.key===scopeKey()&&voucherContextCurrent(context)&&state.trace.address===address;}
    section.querySelector('[data-library-open]').onclick=async function(){
      if(loading||!active())return;var panel=section.querySelector('[data-library-panel]');panel.hidden=!panel.hidden;if(panel.hidden)return;
      loading=true;panel.textContent='正在读取已上传凭证…';
      try{
        var result=await api('monthly_voucher_library',Object.assign({},payload,{action:'list'}));if(!active())return;
        var ranked=await rankLibrary(result.items||[],library.target,context.month);if(!active())return;
        panel.innerHTML='<h4>选择已上传凭证</h4><div class="help">'+esc(context.month+' · '+library.target.summary)+'。核对原图后补充凭证，金额保持不变。</div>'
          +'<input type="search" data-library-search aria-label="搜索凭证" placeholder="搜索文件名、商户、金额"><div data-library-list></div><div data-library-selected></div>'
          +(result.truncated?'<div class="candidate-warning">当前显示最近 2000 份凭证；更早原件请到凭证库核对。</div>':'');
        var search=panel.querySelector('[data-library-search]'),list=panel.querySelector('[data-library-list]'),selected=panel.querySelector('[data-library-selected]'),generation=0;
        function render(){list.innerHTML='';var query=search.value.trim().toLowerCase();ranked.filter(function(row){var item=row.item,f=item.candidate_fields||{};return [item.original_filename,f.counterparty,f.summary,f.amount,recommendationLabel(row),(row.recommendation.dates||[]).map(function(d){return d.date;}).join(' '),(item.recognized_amounts||[]).join(' '),f.document_date,f.period_month].join(' ').toLowerCase().includes(query);}).forEach(function(row){
          var item=row.item,f=item.candidate_fields||{},button=document.createElement('button');button.type='button';button.className='ghost monthly-library-item';
          button.textContent=(item.original_filename||'凭证')+' · '+recommendationLabel(row)
            +(Number.isFinite(row.difference)?row.difference===0?' · 金额一致':' · 相差 '+formatAmount(row.difference/100):'')+(item.already_linked?' · 已关联当前金额':'');
          button.onclick=function(){if(active())choose(item);};list.appendChild(button);
        });if(!list.children.length)list.textContent='没有找到相符的凭证。';}
        async function choose(item){
          var request=++generation;selected.innerHTML='<div data-library-preview>正在读取原图…</div><div data-library-fields></div>';
          var picture=selected.querySelector('[data-library-preview]'),form=selected.querySelector('[data-library-fields]');
          form.innerHTML=item.already_linked?'<div class="help">这份原图已关联当前金额。</div>':'<label class="simple-voucher-rule"><input type="checkbox" data-library-attest> 已核对原图，确认对应当前月报明细</label><button type="button" class="primary" data-library-confirm>确认关联这份凭证</button><div role="status" data-library-status></div>';
          if(!item.already_linked)form.querySelector('[data-library-confirm]').onclick=async function(){
            if(!active()||request!==generation)return;var status=form.querySelector('[data-library-status]'),button=form.querySelector('[data-library-confirm]');
            var image=picture.querySelector('img'),readable=image&&image.complete&&image.naturalWidth>0||picture.querySelector('iframe');
            if(!readable||!form.querySelector('[data-library-attest]').checked){status.textContent='请先读取并核对原图，再勾选确认。';return;}
            button.disabled=true;
            try{
              var saved=await api('monthly_voucher_library',Object.assign({},payload,{action:'attach',voucher_id:item.id,confirmed:true,reason:'人工核对并补充月报凭证：'+library.target.summary+' · '+item.original_filename}));
              if(!active()||request!==generation)return;if(!saved.cell_linked){status.textContent='关联未确认，请重新读取后核对。';return;}
              toast('凭证已关联，原金额未修改');await openCellTrace(address);
            }catch(error){if(active()&&request===generation)status.textContent='关联未确认：'+error.message;}
            finally{if(button.isConnected)button.disabled=false;}
          };
          try{var file=await api('voucher_url',{store:context.store,voucher_id:item.id});if(active()&&request===generation)preview(Object.assign({},item,{file_url:file.url,filename:file.filename}),picture,function(){choose(item);});}
          catch(error){if(active()&&request===generation)picture.textContent='原图读取失败：'+error.message;}
        }
        search.oninput=render;render();
        if(root.ZysyrVoucherCombinationUI)root.ZysyrVoucherCombinationUI.mount(panel,{items:result.items,target:library.target,month:context.month,legacy:false,active:active,escape:esc,amount:formatAmount,preview:preview,
          load:async function(item){var file=await api('voucher_url',{store:context.store,voucher_id:item.id});return {file_url:file.url,filename:file.filename};},
          save:function(rows){return api('monthly_voucher_library',Object.assign({},payload,{action:'attach_combination',confirmed:true,items:rows.map(function(row){return {voucher_id:row.item.id,amount:row.fields.amount};})}));},
          success:toast,reopen:function(){return openCellTrace(address);}});
      }catch(error){if(active())panel.textContent='凭证库读取失败：'+error.message+'。请收起后重新打开重试。';}
      finally{loading=false;}
    };
  }
  function pettyFiles(data,target){
    var files=(data.items||[]).filter(function(i){return i.confirmed_target_kind===target.target_kind&&i.confirmed_target_id===target.id;}).map(function(i){return Object.assign({},i,{id:i.source_voucher_id||i.id,evidence_source:'voucher_attachment'});});
    var legacy=state.pettyCash&&state.pettyCash.data||{},history=target.target_kind==='history';
    var row=(history?legacy.history_records||[]:target.target_kind==='formal'?legacy.records||[]:[]).find(function(r){return r.id===target.id&&r.transaction_date===target.transaction_date&&Number(r.amount)===Number(target.amount);});
    if(row&&history&&row.import_row_id){
      var links=(legacy.history_evidence_links||[]).filter(function(l){return l.import_row_id===row.import_row_id&&l.link_level!=='bundle_only';});
      (legacy.history_evidence||[]).forEach(function(file){var exact=links.filter(function(l){return l.evidence_id===file.id;});if(exact.length)files.push(Object.assign({},file,{evidence_source:'history_evidence',trace_link_level:'page_confirmed',trace_source_locator:exact[0].source_locator,trace_source_locators:exact.map(function(l){return l.source_locator;}).filter(Boolean)}));});
    }else if(row&&!history){
      var ids=new Set((legacy.voucher_links||[]).filter(function(l){return l.business_type==='petty_cash_record'&&l.business_id===row.id;}).map(function(l){return l.voucher_id;}));
      (legacy.vouchers||[]).forEach(function(file){if(ids.has(file.id))files.push(Object.assign({},file,{evidence_source:'voucher_attachment'}));});
    }
    var seen=new Set();return files.filter(function(file){var key=file.evidence_source+':'+file.id;if(seen.has(key))return false;seen.add(key);return true;});
  }
  root.ZysyrExpenseVoucherWorkspace={
    forCell:async function(data,address,context){
      if(isLocalPreview()||!state.user||state.user.role!=='finance')return data;
      if(['income','salary','total','fixed','purchase_summary','petty_cash_summary'].includes(data.item_category))return data;
      var key=scopeKey();if(!state.user.can_match_expense_vouchers||!state.user.can_manage_finance_workbench)return cellLibrary(data,key);
      var workspace;try{workspace=await root.ZysyrExpenseVoucherWorkspace.read({store:context.store,month:context.month});}
      catch(error){var fallback=cellLibrary(data,key);if(fallback.expense_library)return fallback;throw error;}
      if(key!==scopeKey()||!voucherContextCurrent(context))return data;
      var report=state.data.monthly_report,source=workspace.source_selection||{};
      var target=(workspace.targets||[]).find(function(t){return t.target_kind==='monthly_source'&&t.source_locator===address
        &&(report.sha256&&report.sha256===source.sha256||t.electronic_cell&&t.electronic_cell.report_id===report.id);});
      if(!target)return cellLibrary(data,key);if(pettySummary(target))return Object.assign({},data,{item_category:'petty_cash_summary'});
      var items=(workspace.items||[]).filter(function(item){return item.confirmed_target_id&&(item.confirmed_target_kind==='monthly_source'&&item.confirmed_target_id===target.id
        ||/备用金/.test(target.summary)&&['formal','history','draft','source_petty'].includes(item.confirmed_target_kind));});
      var files=items.map(function(item){return {id:item.source_voucher_id||item.id,original_filename:item.original_filename,mime_type:item.mime_type,
        evidence_source:'voucher_attachment',trace_link_level:'page_confirmed',trace_source_locator:'manual-upload:expense-association'};});
      var enriched=Object.assign({},data,{expense_library:{workspace:workspace,target:target,key:key},evidence:(data.evidence||[]).concat(files)});
      return data.voucher_library_source==='store_uploads'?cellLibrary(enriched,key):enriched;
    },
    mountLibrary:function(host,data,address,context,preview){
      if(!data.expense_library||!data.can_upload_vouchers)return;
      if(data.expense_library.direct){mountCellLibrary(host,data,address,context,preview);return;}
      var library=data.expense_library,target=library.target,workspace=library.workspace;
      var section=document.createElement('section');section.className='monthly-library';
      section.innerHTML='<button type="button" class="secondary" data-library-open>从凭证上传库选择</button><div data-library-panel hidden></div>';
      host.appendChild(section);
      function active(){return section.isConnected&&library.key===scopeKey()&&voucherContextCurrent(context)&&state.trace.address===address;}
      var libraryGeneration=0;
      section.querySelector('[data-library-open]').onclick=async function(){
        var request=++libraryGeneration;
        var panel=section.querySelector('[data-library-panel]');panel.hidden=!panel.hidden;if(panel.hidden)return;
        panel.textContent='正在整理凭证推荐…';var ranked=await rankLibrary(workspace.items||[],target,context.month);if(!active()||request!==libraryGeneration||panel.hidden)return;
        panel.innerHTML='<h4>选择已上传凭证</h4><div class="help">'+esc(context.month+' · '+target.summary)+'。先核对原图，再确认关联。</div>'
          +'<input type="search" data-library-search aria-label="搜索凭证" placeholder="搜索文件名、商户、金额"><div data-library-list></div><div data-library-selected></div>';
        var search=panel.querySelector('[data-library-search]'),list=panel.querySelector('[data-library-list]'),selected=panel.querySelector('[data-library-selected]');
        function renderList(){var query=search.value.trim().toLowerCase();list.innerHTML='';
          ranked.filter(function(row){var item=row.item,fields=Object.assign({},item.candidate_fields||{},item.corrected_fields||{});return [item.original_filename,fields.counterparty,fields.amount,recommendationLabel(row),(row.recommendation.dates||[]).map(function(d){return d.date;}).join(' '),fields.expense_category,fields.document_date,fields.period_month,fields.summary].join(' ').toLowerCase().includes(query);}).forEach(function(row){
            var item=row.item,fields=Object.assign({},item.candidate_fields||{},item.corrected_fields||{}),linked=Boolean(item.confirmed_target_id||item.expense_association),button=document.createElement('button');
            button.type='button';button.className='ghost monthly-library-item';button.textContent=(item.original_filename||'凭证')+(item.component_count>1?' · 第 '+(item.component_index+1)+' 笔':'')
              +' · '+recommendationLabel(row)+(Number.isFinite(row.difference)?row.difference===0?' · 金额一致':' · 相差 '+formatAmount(row.difference/100):'')+(linked?' · 已关联':'');
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
            if(target.target_kind!=='monthly_source')kind.querySelector('[value="monthly_summary"]').remove();
            kind.value=target.target_kind==='monthly_source'&&fields.evidence_kind==='monthly_summary'?'monthly_summary':'transaction';date.value=fields.document_date||'';month.value=fields.period_month||'';amount.value=fields.amount==null?'':fields.amount;
            if(!target.aggregate)form.querySelector('[data-library-attest]').parentElement.lastChild.textContent=' 已核对原图，确认对应当前这一笔备用金明细';
            kind.onchange=function(){var summary=kind.value==='monthly_summary';date.closest('.field').hidden=summary;form.querySelector('[data-library-month-field]').hidden=!summary;};kind.onchange();
            if(target.target_kind!=='monthly_source'&&fields.evidence_kind==='monthly_summary'){form.querySelector('[data-library-confirm]').disabled=true;form.querySelector('[data-library-status]').textContent='月度汇总佐证不能直接对应单笔明细，请选择该笔的付款凭证。';}
            form.querySelector('[data-library-confirm]').onclick=async function(){
              if(!active())return;var status=form.querySelector('[data-library-status]'),button=form.querySelector('[data-library-confirm]');
              if(!picture.querySelector('img,iframe')){status.textContent='请先读取并核对原图，再确认关联。';return;}
              if(!form.querySelector('[data-library-attest]').checked){status.textContent='请先核对原图并勾选确认。';return;}
              var summary=kind.value==='monthly_summary',period=summary&&root.ZysyrVoucherCombinationUI?await root.ZysyrVoucherCombinationUI.period(month.value,context.month):summary?month.value:date.value.slice(0,7);
              if(period!==context.month||!(Number(amount.value)>0)||!summary&&!date.value){status.textContent='请核对凭证日期或所属月份、金额。缺少的日期不可猜填。';return;}
              if((Math.abs(Number(amount.value)-Number(target.amount))>.01||!target.aggregate&&target.transaction_date!==date.value)&&!window.confirm('凭证日期或金额与所选明细不同。已核对原图，确认仍对应当前这一笔吗？'))return;
              button.disabled=true;
              try{
                var result=await root.ZysyrExpenseVoucherWorkspace.confirm(item,{corrected_fields:Object.assign({},fields,{evidence_kind:kind.value,document_date:summary?null:date.value,period_month:period,amount:amount.value})},target,{store:context.store,month:context.month});
                if(!active())return;
                if(!result.saved||!Number(result.saved.inserted)){status.textContent='关联未新增，凭证状态可能已变化。请关闭后重新打开核对。';return;}
                toast('凭证已关联，原金额未修改');await (library.reopen||openCellTrace)(address);
              }catch(error){if(active())status.textContent='关联未确认：'+error.message;}
              finally{if(button.isConnected)button.disabled=false;}
            };
          }
          try{var file=await api('voucher_url',{store:context.store,voucher_id:item.source_voucher_id||item.id});
            if(active()&&Number(selected.dataset.request)===generation)preview(Object.assign({},item,{file_url:file.url,filename:file.filename}),picture,function(){choose(item,linked);});
          }catch(error){if(active()&&Number(selected.dataset.request)===generation)picture.textContent='原图读取失败：'+error.message;}
        }
        search.oninput=renderList;renderList();
        if(root.ZysyrVoucherCombinationUI)root.ZysyrVoucherCombinationUI.mount(panel,{items:workspace.items,target:target,month:context.month,legacy:true,active:active,escape:esc,amount:formatAmount,preview:preview,
          load:async function(item){var file=await api('voucher_url',{store:context.store,voucher_id:item.source_voucher_id||item.id});return {file_url:file.url,filename:file.filename};},
          save:function(rows){return root.ZysyrExpenseVoucherWorkspace.confirmCombination(rows,target,{store:context.store,month:context.month});},
          success:toast,reopen:function(){return (library.reopen||openCellTrace)(address);}});
      };
    },
    renderPettyDetails:function(data,key){
      key=key||scopeKey();var container=document.getElementById('petty-cash-report-table');if(!container||key!==scopeKey()||state.view!=='finance-workbench'||data.month!==document.getElementById('month').value)return;
      var old=document.getElementById('petty-detail-sheet');if(old)old.remove();
      var rows=(data.targets||[]).filter(function(t){return ['source_petty','draft','formal','history'].includes(t.target_kind)&&!t.aggregate;});
      var panel=document.createElement('section');panel.id='petty-detail-sheet';panel.className='panel';
      var whole=(data.items||[]).filter(function(i){return pettySummary((data.targets||[]).find(function(t){return t.target_kind===i.confirmed_target_kind&&t.id===i.confirmed_target_id;}));});
      panel.innerHTML='<h3>'+esc(data.month)+' 备用金明细单</h3><p class="help">先核对每笔明细，再为该笔查看或选择凭证；金额保持原样，未入账明细仍为待核对。</p>'
        +(whole.length?'<p class="candidate-warning">另有 '+whole.length+' 份凭证保留在整月备用金汇总下，尚未对应到某一笔；不计入下方逐笔凭证。</p>':'')
        +'<div class="archive-wrap"><table class="archive-table"><thead><tr><th>日期</th><th>摘要</th><th>金额</th><th>来源</th><th>本笔凭证</th></tr></thead><tbody>'
        +rows.map(function(t,index){var count=pettyFiles(data,t).length;
          return '<tr><td>'+esc(t.transaction_date||'日期待核对')+'</td><td>'+esc(t.summary)+'</td><td>'+esc(formatAmount(t.amount))+'</td><td>'+esc({draft:'待核对明细（未入账）',source_petty:'原件明细',formal:'正式记录',history:'历史记录'}[t.target_kind])+'</td><td><button type="button" class="'+(count?'primary':'secondary')+'" data-petty-detail-open="'+index+'">'+(count?'查看本笔凭证（'+count+'）':'从凭证库匹配本笔')+'</button></td></tr>';
        }).join('')+'</tbody></table></div>'+(rows.length?'':'<p class="help">本月尚未读到逐笔备用金明细，请先核对明细原件；不会把整月汇总金额当成一笔支出。</p>');
      container.prepend(panel);
      if(state.pettyCash&&state.pettyCash.focusDetailsScope===JSON.stringify([currentStore(),document.getElementById('month').value])){state.pettyCash.focusDetailsScope=null;panel.scrollIntoView({block:'start'});}
      panel.querySelectorAll('[data-petty-detail-open]').forEach(function(button){button.onclick=function(){if(key===scopeKey()){var t=rows[Number(button.dataset.pettyDetailOpen)];root.ZysyrExpenseVoucherWorkspace.openPettyDetail(t.target_kind,t.id);}};});
    },
    openPettyDetail:async function(kind,id){
      if(!state.user||state.user.role!=='finance'||!state.user.can_match_expense_vouchers||!state.user.can_manage_finance_workbench)return;
      var generation=++pettyViewGeneration,key=scopeKey(),context=voucherContext(),address='petty:'+kind+':'+id,drawer=document.getElementById('view-cell-trace'),body=document.getElementById('cell-trace-body');
      closeMonthlyWorkbench();drawer.classList.remove('hidden');drawer.setAttribute('aria-hidden','false');state.trace.address=address;
      document.getElementById('cell-trace-page-title').textContent='备用金明细 · 本笔凭证';
      document.getElementById('cell-trace-page-title').nextElementSibling.textContent='逐笔核对原图并确认关联，原金额和入账状态保持不变。';
      document.getElementById('cell-trace-upload-voucher').classList.add('hidden');document.getElementById('cell-trace-edit-entry').classList.add('hidden');
      body.innerHTML='<p class="help">正在读取这一笔明细与凭证…</p>';
      function active(){return generation===pettyViewGeneration&&key===scopeKey()&&voucherContextCurrent(context)&&state.trace.address===address&&state.view==='finance-workbench';}
      try{
        var data=await root.ZysyrExpenseVoucherWorkspace.read({store:context.store,month:context.month});if(!active())return;if(data.month!==context.month)throw Error('月份已变化，请重新打开明细单');
        var target=(data.targets||[]).find(function(t){return t.target_kind===kind&&t.id===id&&!t.aggregate;});if(!target)throw Error('这笔明细已变化，请返回明细单重新选择');
        if(['formal','history'].includes(kind)){var legacy=await api('petty_cash_report',{store:context.store,month:context.month});if(!active())return;state.pettyCash.data=legacy;root.ZysyrExpenseVoucherWorkspace.renderPettyDetails(data,key);}
        var items=pettyFiles(data,target);
        body.innerHTML='<section class="trace-card"><h4>'+esc((target.transaction_date||'日期待核对')+' · '+target.summary)+'</h4><strong>'+esc(formatAmount(target.amount))+'</strong><p class="help">'+(items.length?'以下只展示已对应当前这一笔的凭证。':'这笔明细尚未对应凭证，可从上传库选择。')+'</p></section><div data-petty-detail-images></div>';
        var library={workspace:data,target:target,key:key,reopen:function(){return root.ZysyrExpenseVoucherWorkspace.openPettyDetail(kind,id);}};
        root.ZysyrExpenseVoucherWorkspace.mountLibrary(body,{expense_library:library,can_upload_vouchers:true},address,context,monthlyVoucherView.fileView);
        var images=body.querySelector('[data-petty-detail-images]');
        items.forEach(function(item){var host=document.createElement('section');host.className='trace-card voucher-file-preview';images.appendChild(host);
          async function load(){host.textContent='正在读取本笔原图…';try{var historical=item.evidence_source==='history_evidence';var file=historical?await loadHistoricalEvidenceImages(item,context):await api('voucher_url',{store:context.store,voucher_id:item.id});if(active())monthlyVoucherView.fileView(historical?file:Object.assign({},item,{file_url:file.url,filename:file.filename}),host,load,null,historical?function(source,imageFilename){return loadHistoricalEvidenceImages(item,context,imageFilename);}:undefined);}
            catch(error){if(active()){host.textContent='原图读取失败：'+error.message;var retry=document.createElement('button');retry.textContent='重新读取原图';retry.onclick=load;host.appendChild(retry);}}}load();
        });
        drawer.querySelector('.monthly-workbench').scrollTop=0;
      }catch(error){if(active())body.textContent=error.message;}
    },
    read:async function(payload){var key=scopeKey(),data=await api('expense_voucher_workspace',payload);if(data&&data.month===payload.month&&key===scopeKey()){
      monthlyCache={key:key,data:monthlyData(data)};
      if(lastMonthlyCells&&lastMonthlyScope===key)decorate(lastMonthlyCells,monthlyCache.data,key);
      if(state.view==='finance-workbench')root.ZysyrExpenseVoucherWorkspace.renderPettyDetails(data,key);
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
        var rows=targets.filter(function(t){return t.target_kind===group[0]&&!pettySummary(t);});
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
    confirm:async function(item,draft,target,scope){var fields=Object.assign({},draft.corrected_fields);if(fields.evidence_kind==='monthly_summary'&&root.ZysyrVoucherCombinationUI)fields.period_month=await root.ZysyrVoucherCombinationUI.period(fields.period_month,scope.month);var result=await api('expense_voucher_match_apply',Object.assign({},scope,{mode:'manual',items:[request(item,target,fields)]}));monthlyCache=null;return result;},
    confirmCombination:async function(rows,target,scope){var result=await api('expense_voucher_combination_apply',Object.assign({},scope,{mode:'manual',combination:true,confirmed:true,items:rows.map(function(row){return request(row.item,target,row.fields);})}));monthlyCache=null;return result;},
    autoMatch:async function(data,scope,isCurrent,isDirty,includeExisting){
      var items=(data.items||[]).filter(function(item){return !item.confirmed_target_id&&item.match&&item.match.auto_eligible&&!pettySummary((data.targets||[]).find(function(t){return t.target_kind===item.match.target_kind&&t.id===item.match.target_id;}))
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
