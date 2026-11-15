/* Matching-only import UI. Scope is captured before every asynchronous step. */
(function () {
  'use strict';
  var pending = null, busy = false, sequence = 0;
  var fields = {transaction_date:'日期（完整年月日）',amount:'支出金额',summary:'摘要 / 说明',category:'科目',recipient:'领款人',voucher_number:'凭证编号'};
  var aliases = {transaction_date:/日期|date/i,amount:/支出|贷方|金额|amount/i,summary:/摘要|说明|用途|summary/i,category:/科目|分类|category/i,recipient:/领款|经办|recipient/i,voucher_number:/凭证|编号|number/i};
  function defaultColumn(headers, field) {
    var matches=headers.map(function(h,i){return {text:String(h).trim(),index:i};});
    if(field==='amount') {
      matches=matches.filter(function(h){return !/收入|借方|余额|合计|总计|income|balance|debit/i.test(h.text);});
      var explicit=matches.filter(function(h){return /支出|贷方|expense|credit/i.test(h.text);});
      matches=explicit.length?explicit:matches.filter(function(h){return /^(金额|amount)$/i.test(h.text);});
    } else matches=matches.filter(function(h){return aliases[field].test(h.text);});
    return matches.length===1?matches[0].index:-1;
  }
  window.ZysyrPettyScopeIdentity = function () {
    var claims={};try{claims=JSON.parse(atob(authAccessToken().split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch(_){}
    return JSON.stringify([state.session||'',claims.sub||(state.auth&&state.auth.user&&state.auth.user.id)||(state.user&&state.user.username)||'',claims.session_id||'']);
  };
  function scope() { return JSON.stringify([currentStore(),document.getElementById('month').value,window.ZysyrPettyScopeIdentity()]); }
  function current(p) { return pending===p && p.scope===scope() && document.getElementById('petty-detail-import-body'); }
  function status(text) { var e=document.getElementById('petty-detail-import-status');if(e)e.textContent=text; }
  async function request(p, mapping, confirm) {
    return api(confirm?'petty_detail_import_confirm':'petty_detail_import_preview',Object.assign({},p.payload,{mapping:mapping||{},sheet:p.sheet,header_row:p.header||0,preview_sha256:p.hash,selected_rows:p.selected||[]}));
  }
  function controls(p) {
    var body=document.getElementById('petty-detail-import-body'), headers=p.matrix[p.header||0]||[];
    body.innerHTML='<label>工作表<select id="petty-detail-sheet">'+(p.sheets.length?p.sheets:['CSV']).map(function(s){return '<option>'+esc(s)+'</option>';}).join('')+'</select></label> '
      +'<label>表头行<input id="petty-detail-header" type="number" min="1" max="50" value="'+((p.header||0)+1)+'"></label>'
      +'<div class="petty-batch-fields">'+Object.keys(fields).map(function(f){var column=defaultColumn(headers,f);return '<label>'+fields[f]+'<select data-detail-map="'+f+'"><option value="-1">不导入此列</option>'+headers.map(function(h,i){return '<option value="'+i+'" '+(i===column?'selected':'')+'>'+esc(String(i+1)+' · '+String(h||'空表头'))+'</option>';}).join('')+'</select></label>';}).join('')+'</div>'
      +'<button id="petty-detail-preview" type="button" class="secondary">检查映射并预览</button> <button id="petty-detail-cancel" type="button" class="ghost">取消</button><div id="petty-detail-preview-body"></div>';
    document.getElementById('petty-detail-sheet').value=p.sheet||p.sheets[0]||'CSV';
    document.getElementById('petty-detail-sheet').onchange=async function(){if(busy)return;var sheet=this.value;busy=true;try{p.sheet=sheet;var data=await request(p);if(!current(p))return;p.matrix=data.matrix;p.header=0;controls(p);}catch(e){if(current(p))status(e.message);}finally{busy=false;}};
    document.getElementById('petty-detail-header').onchange=function(){if(busy)return;p.header=Number(this.value)-1;if(p.header<0||p.header>=p.matrix.length){status('表头行超出预览范围');return;}controls(p);};
    body.querySelectorAll('[data-detail-map]').forEach(function(e){e.onchange=function(){var preview=document.getElementById('petty-detail-preview-body');if(preview)preview.innerHTML='';p.mapping=null;};});
    document.getElementById('petty-detail-cancel').onclick=function(){pending=null;sequence++;body.innerHTML='';status('已取消，未导入明细');};
    document.getElementById('petty-detail-preview').onclick=async function(){
      if(busy||!current(p))return;var mapping={};body.querySelectorAll('[data-detail-map]').forEach(function(e){mapping[e.dataset.detailMap]=Number(e.value);});
      busy=true;this.disabled=true;status('正在检查缺失值、当前月份及重复明细…');
      try {var data=await request(p,mapping);if(!current(p))return;p.mapping=mapping;p.hash=data.source_sha256;
        status('可选 '+data.accepted+' 笔；重复 '+data.duplicates+' 笔；无效 '+data.invalid+' 笔。无效和重复行不会导入。');
        document.getElementById('petty-detail-preview-body').innerHTML='<div class="archive-wrap"><table class="archive-table"><thead><tr><th>选择</th><th>原行</th><th>日期</th><th>金额</th><th>摘要</th><th>检查结果</th></tr></thead><tbody>'+data.rows.map(function(r){return '<tr><td><input type="checkbox" data-detail-row="'+r.source_row+'" '+(r.valid?'checked':'disabled')+'></td><td>'+r.source_row+'</td><td>'+esc(r.transaction_date||'未识别')+'</td><td>'+esc(r.amount==null?'未识别':r.amount)+'</td><td>'+esc(r.summary)+'</td><td>'+esc(r.duplicate?'重复，已排除':r.errors.join('；')||'可导入')+'</td></tr>';}).join('')+'</tbody></table></div><button id="petty-detail-confirm" class="primary" type="button">确认保存所选待核对明细</button><p class="help">只保存匹配草稿及原文件，不生成正式支出、不自动入账。需要修改时先修正原文件并重新预览。</p>';
        document.getElementById('petty-detail-confirm').onclick=function(){save(p);};
      }catch(e){if(current(p))status(e.message);}finally{busy=false;var b=document.getElementById('petty-detail-preview');if(b)b.disabled=false;}
    };
  }
  async function save(p) {
    if(busy||!current(p)||!p.mapping)return;
    var liveMapping={};document.querySelectorAll('[data-detail-map]').forEach(function(e){liveMapping[e.dataset.detailMap]=Number(e.value);});
    if(JSON.stringify(liveMapping)!==JSON.stringify(p.mapping)||Number(document.getElementById('petty-detail-header').value)!==(p.header||0)+1||document.getElementById('petty-detail-sheet').value!==(p.sheet||p.sheets[0]||'CSV')){status('映射、工作表或表头已改变，请重新预览');return;}
    p.selected=Array.from(document.querySelectorAll('[data-detail-row]:checked:not(:disabled)')).map(function(e){return Number(e.dataset.detailRow);});
    if(!p.selected.length){status('请至少选择一笔有效明细');return;}
    if(isLocalPreview()){status('本地预览不保存业务数据');return;}
    busy=true;var button=document.getElementById('petty-detail-confirm');button.disabled=true;
    try{var result=await request(p,p.mapping,true);if(!current(p))return;pending=null;document.getElementById('petty-detail-import-body').innerHTML='';status(result.saved.duplicate?'此文件已导入，请刷新核验已有明细':'已保存 '+result.saved.inserted+' 笔待核对明细，未入账');await window.ZysyrPettyReloadBatch();}
    catch(e){if(current(p))status('保存未确认：'+e.message+'。请先刷新核验；不要立即重复提交。');}
    finally{busy=false;if(button.isConnected)button.disabled=false;}
  }
  window.ZysyrPettyDetailImport = {
    mount:function(container){
      var panel=document.createElement('section');panel.className='panel petty-batch-panel';
      panel.innerHTML='<h3>备用金明细上传</h3><p class="help">当前门店、当前月份独立保存。支持 Excel（.xlsx）及 UTF-8 CSV；先预览、映射列和排除重复，再人工确认。</p><input id="petty-detail-file" type="file" accept=".xlsx,.csv"><p id="petty-detail-import-status" role="status"></p><div id="petty-detail-import-body"></div><div id="petty-detail-saved"></div>';
      container.insertBefore(panel,container.firstChild);
      if(pending&&pending.scope===scope())controls(pending);else pending=null;
      document.getElementById('petty-detail-file').onchange=async function(){
        var file=this.files[0];if(!file||busy)return;if(!/\.(xlsx|csv)$/i.test(file.name)||!file.size||file.size>10*1024*1024){status('请选择 10MB 以内的 XLSX 或 CSV');return;}
        var p={scope:scope(),payload:{store:currentStore(),month:document.getElementById('month').value,filename:file.name},matrix:[],sheets:[]};pending=p;busy=true;var generation=++sequence;
        status('正在读取原文件，尚未保存明细…');
        try{p.payload.base64=await fileBase64(file);if(!current(p)||generation!==sequence)return;var data=await request(p);if(!current(p))return;p.matrix=data.matrix;p.sheets=data.sheets;p.hash=data.source_sha256;controls(p);status('请选择工作表、表头及列映射。金额列应选择逐笔支出，不选余额或收入。');}
        catch(e){if(current(p))status(e.message);}finally{busy=false;}
      };
    },
    renderSaved:function(targets){var e=document.getElementById('petty-detail-saved');if(!e)return;var drafts=targets.filter(function(r){return r.target_kind==='draft';});e.innerHTML='<h4>已导入待核对明细（'+drafts.length+' 笔，未入账）</h4><div class="archive-wrap"><table class="archive-table"><thead><tr><th>日期</th><th>金额</th><th>摘要</th><th>原文件 / 行</th></tr></thead><tbody>'+drafts.map(function(r){return '<tr><td>'+esc(r.transaction_date)+'</td><td>'+esc(formatAmount(r.amount))+'</td><td>'+esc(r.summary)+'</td><td>'+esc((r.source&&r.source.source_filename)||'原文件')+' / '+Number(r.source_row)+'</td></tr>';}).join('')+'</tbody></table></div>';}
  };
})();
