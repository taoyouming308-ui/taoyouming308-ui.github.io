(function(root){
  'use strict';
  var corePromise;
  function loadCore(){return corePromise=corePromise||import('./voucher-combination-core.js?v='+document.documentElement.dataset.version).catch(function(error){corePromise=null;throw error;});}
  root.ZysyrVoucherCombinationUI={rank:async function(items,target,month){return (await loadCore()).rankVoucherLibrary(items,target,month);},period:async function(value,contextMonth){return (await loadCore()).normalizeVoucherPeriod(value,contextMonth);},mount:async function(host,options){
    var section=document.createElement('section');section.className='voucher-combinations';
    section.innerHTML='<h4>组合凭证</h4><p class="help">几张凭证可共同对应这一笔。核对每张原图的日期、用途和金额后确认。</p><div data-combination-recommendations>正在计算金额一致的组合…</div><details><summary>手动选择多张凭证</summary><input type="search" aria-label="组合凭证搜索" placeholder="搜索文件名、商户、金额"><div data-combination-options></div><div data-combination-selection></div><button type="button" class="secondary" data-combination-review>核对已选凭证</button></details><div data-combination-review-panel></div>';
    host.appendChild(section);
    function active(){return section.isConnected&&options.active();}
    try{
      var core=await loadCore();if(!active())return;if(core.voucherCents(options.target.amount)===null){section.textContent='当前开支金额待核对，暂不能计算组合。';return;}
      var selected=new Map(),generation=0,esc=options.escape,money=options.amount,target=options.target,items=options.items||[],pending=false;
      var recommendations=section.querySelector('[data-combination-recommendations]'),list=section.querySelector('[data-combination-options]'),search=section.querySelector('input[type=search]'),review=section.querySelector('[data-combination-review-panel]');
      var result=core.recommendVoucherCombinations(items,target,options.month);
      function blocked(item){if(!options.legacy)return false;var f=core.voucherFields(item);return f.evidence_kind==='monthly_summary'||['bank_summary','multiple_transactions','monthly_summary'].includes(f.document_kind)||Boolean(item.confirmed_target_id||item.expense_association)&&!core.sameVoucherTarget(item,target);}
      function linked(item){return options.legacy?core.sameVoucherTarget(item,target):Boolean(item.already_linked);}
      function description(item){var f=core.voucherFields(item),hint=core.voucherRecommendation(item,target,options.month);return (item.original_filename||'凭证')+' · '+(hint.amount_cents===null?'金额待核对':(hint.document_only?hint.amount_label+' ':'')+money(hint.amount_cents/100))+(hint.payment_unconfirmed?' · 付款待核对':'')+' · '+(f.document_date||'付款日期待核对')+(linked(item)?' · 已关联本笔':'');}
      recommendations.innerHTML=result.groups.length?'':'<p class="help">暂未找到合计一致的组合，可在下方手动勾选并核对金额。</p>';
      result.groups.forEach(function(group){var button=document.createElement('button');button.type='button';button.className='secondary';button.dataset.combinationRecommend='';
        button.textContent=group.items.map(function(item){return money(core.voucherRecommendation(item,target,options.month).amount_cents/100);}).join(' + ')+' = '+money(group.total_cents/100)+'（'+group.items.length+' 张）'
          +(group.items.some(function(item){return core.voucherRecommendation(item,target,options.month).payment_unconfirmed;})?' · 含原文金额，付款待核对':'');
        button.onclick=function(){if(active()&&!pending){selected.clear();group.items.forEach(function(item){selected.set(core.voucherPartKey(item),item);});renderOptions();openReview();}};recommendations.appendChild(button);
      });
      if(result.limited)recommendations.insertAdjacentHTML('beforeend','<p class="help">当前展示部分组合，也可搜索并手动选择其他凭证。</p>');
      function updateSelection(){
        var chosen=Array.from(selected.values()),total=core.combinationTotal(chosen);
        section.querySelector('[data-combination-selection]').textContent='已选 '+chosen.length+' 张'+(chosen.length>=2?(total===null?' · 金额待核对':' · 合计 '+money(total/100)):'');
        section.querySelector('[data-combination-review]').disabled=chosen.length<2||chosen.length>20;
      }
      function renderOptions(){
        list.innerHTML='';var query=search.value.trim().toLowerCase();core.rankVoucherLibrary(items,target,options.month).map(function(row){return row.item;}).filter(function(item){var f=core.voucherFields(item),hint=core.voucherRecommendation(item,target,options.month);return [description(item),f.summary,f.expense_category,f.counterparty,f.evidence&&f.evidence.expense_category,hint.dates.map(function(d){return d.date;}).join(' ')].join(' ').toLowerCase().includes(query);}).forEach(function(item){
          var label=document.createElement('label');label.className='simple-voucher-rule';var checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.combinationPick=core.voucherPartKey(item);checkbox.checked=selected.has(core.voucherPartKey(item));
          checkbox.disabled=blocked(item);var span=document.createElement('span');span.textContent=description(item)+(blocked(item)?' · 需先核对类型或既有关联，可在上方查看原图':'');label.appendChild(checkbox);label.appendChild(span);list.appendChild(label);
          checkbox.onchange=function(){if(!active()||pending)return;if(checkbox.checked){if(selected.size>=20){checkbox.checked=false;return;}Array.from(selected.entries()).forEach(function(entry){if(core.voucherIdentity(entry[1])===core.voucherIdentity(item))selected.delete(entry[0]);});selected.set(core.voucherPartKey(item),item);}else selected.delete(core.voucherPartKey(item));generation++;review.innerHTML='';renderOptions();};
        });updateSelection();
      }
      function openReview(){
        if(!active()||pending)return;var request=++generation,chosen=Array.from(selected.values());if(chosen.length<2)return;
        review.innerHTML='<h4>逐张核对组合原图</h4><div data-combination-cards></div><strong data-combination-total></strong><p class="help">合计须与当前金额一致，每张都要预览并勾选核对。</p><button type="button" class="primary" data-combination-save>确认关联整组凭证</button><div data-combination-status role="status"></div>';
        var rows=[],cards=review.querySelector('[data-combination-cards]'),save=review.querySelector('[data-combination-save]'),status=review.querySelector('[data-combination-status]');
        function current(){return active()&&request===generation;}
        function update(){
          var total=core.combinationTotal(rows.map(function(row){return Object.assign({},row.item,{corrected_fields:{amount:row.amount.value}});})),goal=core.voucherCents(target.amount);
          review.querySelector('[data-combination-total]').textContent=total===null?'组合合计：金额待核对':'组合合计 '+money(total/100)+' · 当前开支 '+money(target.amount)+' · 相差 '+money((goal-total)/100);
          save.disabled=pending||total===null||total!==goal||rows.some(function(row){return !row.checked.checked||!row.loaded||options.legacy&&(!/^\d{4}-\d{2}-\d{2}$/.test(row.date.value)||row.date.value.slice(0,7)!==options.month);});
        }
        chosen.forEach(function(item){
          var f=core.voucherFields(item),hint=core.voucherRecommendation(item,target,options.month),card=document.createElement('section');card.className='trace-card';
          card.innerHTML='<h4>'+esc(item.original_filename||'凭证')+'</h4>'+(hint.document_only?'<p class="help">'+esc(hint.amount_label+' '+money(hint.amount_cents/100))+' · 付款待核对。请核对原图后填写本次采用的金额及日期。</p>':'')+'<button type="button" class="secondary" data-combination-preview>预览这张原图</button><div data-combination-image></div><label class="field">本张凭证金额<input type="number" step="0.01" min="0.01" aria-label="组合凭证金额"></label>'
            +(options.legacy?'<label class="field">凭证日期<input type="date" aria-label="组合凭证日期"></label>':'')+'<label class="simple-voucher-rule"><input type="checkbox" data-combination-attest disabled> 已核对这张原图，确认对应当前开支</label>';
          cards.appendChild(card);var amount=card.querySelector('input[type=number]'),date=card.querySelector('input[type=date]'),checked=card.querySelector('[data-combination-attest]'),picture=card.querySelector('[data-combination-image]');
          var known=core.voucherAmount(item);amount.value=known==null?'':known;amount.readOnly=options.legacy&&linked(item);if(date){date.value=f.document_date||'';date.readOnly=linked(item);}
          var row={item:item,amount:amount,date:date,checked:checked,loaded:false};rows.push(row);
          amount.oninput=function(){checked.checked=false;update();};if(date)date.oninput=function(){checked.checked=false;update();};checked.onchange=update;
          async function load(){
            if(!current())return;row.loaded=false;checked.checked=false;checked.disabled=true;picture.textContent='正在读取原图…';update();
            try{
              var file=await options.load(item);if(!current())return;options.preview(Object.assign({},item,file),picture,load);
              var image=picture.querySelector('img'),frame=picture.querySelector('iframe');
              function ready(){if(current()){row.loaded=true;checked.disabled=false;update();}}
              if(image){if(image.complete&&image.naturalWidth>0)ready();else image.addEventListener('load',ready,{once:true});}
              else if(frame)ready();
            }catch(error){if(current())picture.textContent='原图读取失败：'+error.message;}
          }
          card.querySelector('[data-combination-preview]').onclick=load;
        });
        save.onclick=async function(){
          if(!current()||pending)return;update();if(save.disabled)return;
          pending=true;section.querySelectorAll('button,input').forEach(function(node){node.disabled=true;});
          try{
            var payload=rows.map(function(row){return {item:row.item,fields:Object.assign({},core.voucherFields(row.item),{evidence_kind:'transaction',amount:Number(row.amount.value),document_date:row.date?row.date.value:core.voucherFields(row.item).document_date})};});
            var saved=await options.save(payload);if(!current())return;if(!saved.combination_saved)throw Error('组合未完整确认，请重新读取核对');
            options.success('组合凭证已关联，合计 '+money(core.combinationTotal(payload.map(function(row){return Object.assign({},row.item,{corrected_fields:row.fields});}))/100));await options.reopen();
          }catch(error){if(current())status.textContent='整组未确认：'+error.message;}
          finally{pending=false;if(current()){section.querySelectorAll('button,input').forEach(function(node){node.disabled=false;});rows.forEach(function(row){row.checked.disabled=!row.loaded;});renderOptions();update();}}
        };
        update();review.scrollIntoView({block:'nearest'});
      }
      search.oninput=renderOptions;section.querySelector('[data-combination-review]').onclick=openReview;renderOptions();
    }catch(error){if(active())section.querySelector('[data-combination-recommendations]').textContent='组合推荐暂不可读：'+error.message;}
  }};
})(window);
