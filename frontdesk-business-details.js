(function () {
  'use strict';
  var helpers;
  var pending = 0;
  var renderedScope = null;
  var renderedHTML = null;
  var box = document.getElementById('business-details');
  var content = document.getElementById('business-details-content');
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function money(cents) { return cents == null ? '待补齐' : '¥'+(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function count(value) { return value == null ? '待核对' : value+' 个'; }
  function technicianSummary(row) { var c=row.service_counts||{};return '烫 '+count(c.perm)+' · 染 '+count(c.dye)+' · 护 '+count(c.care)+(c.review?' · 待分类 '+count(c.review):''); }
  function scopeKey(scope) { return JSON.stringify([scope.session,scope.store,scope.date]); }
  function replaceContent(html) {
    if (html === renderedHTML) return;
    var expanded = Array.from(content.querySelectorAll('details[open][data-employee-key]')).map(function(el){return el.dataset.employeeKey;});
    var scrolls = Array.from(content.querySelectorAll('[data-employee-key]')).map(function(el){var table=el.querySelector('.business-table-scroll');return [el.dataset.employeeKey,table?table.scrollLeft:0];});
    content.innerHTML=html;
    content.querySelectorAll('[data-employee-key]').forEach(function(el){el.open=expanded.indexOf(el.dataset.employeeKey)>=0;var saved=scrolls.find(function(row){return row[0]===el.dataset.employeeKey;});if(saved)el.querySelector('.business-table-scroll').scrollLeft=saved[1];});
    renderedHTML=html;
  }
  function render(data) {
    if (!data.available) { replaceContent('<p class="sub">本店这一天的付款和员工业绩明细尚未同步。</p>'); return; }
    var notice = data.source_list_changed ? '消费单已有更新，以下是上次明细，请等待同步后核对。' : '已核对 '+data.source_count+' 张项目消费单。发型师看金额，技师看烫染护个数。';
    var staff = data.employees.map(function(row){
      var name=row.employee_names.join(' / ')||'员工编号 '+(row.employee_id||'待匹配');
      if(row.metric_kind==='service_count')return '<details><summary>'+esc(name)+' · '+esc(row.source_role||'技师')+' <b>'+esc(technicianSummary(row))+'</b></summary><div class="business-table-scroll"><table><thead><tr><th>单号</th><th>项目</th><th>项目次数</th><th>归类</th></tr></thead><tbody>'+row.lines.map(function(line){var labels={perm:'烫',dye:'染',care:'护',other:'其他不计',review:'待分类'};return '<tr><td>'+esc(line.source_bill_id)+'</td><td>'+esc(line.item&&line.item.item_name||'项目待匹配')+'</td><td>'+esc(line.source_project_count==null?'待核对':line.source_project_count)+'</td><td>'+esc(labels[line.service_category]||'待分类')+'</td></tr>';}).join('')+'</tbody></table></div></details>';
      return '<details><summary>'+esc(name)+' · '+esc(row.source_role||'岗位待匹配')+' <b>'+esc(money(row.performance_cents))+'</b></summary><div class="business-table-scroll"><table><thead><tr><th>单号</th><th>项目</th><th>源项目次数</th><th>分配业绩</th><th>现金业绩</th><th>卡金业绩</th></tr></thead><tbody>'+row.lines.map(function(line){return '<tr><td>'+esc(line.source_bill_id)+'</td><td>'+esc(line.item&&line.item.item_name||'项目待匹配')+'</td><td>'+esc(line.source_project_count==null?'待补齐':line.source_project_count)+'</td><td>'+esc(money(line.performance_cents))+'</td><td>'+esc(money(line.cash_performance_cents))+'</td><td>'+esc(money(line.card_performance_cents))+'</td></tr>';}).join('')+'</tbody></table></div></details>';
    }).join('')||'<p class="sub">没有员工分配记录。</p>';
    var labels={cash:'现金',weixin:'微信',pay:'支付宝',cardfee:'扣卡本金',presentfee:'扣卡赠送金'};
    var payments=data.payments.filter(function(row){return row.amount_cents!==0;}).map(function(row){return '<tr><td>'+esc(row.source_labels.join(' / ')||labels[row.source_field]||row.source_field)+'</td><td>'+esc(money(row.amount_cents))+'</td></tr>';}).join('')||'<tr><td colspan="2">本批项目单各付款字段均为 0</td></tr>';
    var index=0;staff=staff.replace(/<details>/g,function(){var row=data.employees[index++];return '<details data-employee-key="'+esc(JSON.stringify([row.employee_id,row.source_role]))+'">';});
    replaceContent('<p class="sub" role="status">'+esc(notice)+'</p><div class="business-columns"><section><h3>员工项目统计</h3>'+staff+'</section><section><h3>项目单付款明细</h3><table><thead><tr><th>来源</th><th>源金额</th></tr></thead><tbody>'+payments+'</tbody></table><p class="sub">扣卡、优惠与实收分别展示；充值售卡、零售尚未纳入本区域。</p></section></div>');
  }
  async function load() {
    var ticket=++pending;
    if (!helpers) return;
    var scope=helpers.scope();
    var key=scopeKey(scope),keep=renderedScope===key;
    if (!keep) { content.innerHTML='';renderedHTML=null;renderedScope=null; }
    if (!scope.session || !scope.store || !box.open) return;
    if (!keep) content.innerHTML='<p class="sub">正在读取本店营业明细…</p>';
    try {
      var data=await helpers.api('business_details',{store:scope.store,date:scope.date});
      var current=helpers.scope();
      if(ticket!==pending)return;
      if(scopeKey(current)!==key){content.innerHTML='';renderedScope=null;renderedHTML=null;return;}
      render(data);
      renderedScope=key;
    } catch(error) {
      if(ticket!==pending)return;
      if(scopeKey(helpers.scope())!==key){content.innerHTML='';renderedScope=null;renderedHTML=null;return;}
      if(keep){var note=content.querySelector('[role="status"]');if(note)note.textContent='更新暂未完成，当前保留上次明细，请稍后核对。';renderedHTML=null;}
      else content.innerHTML='<p class="sub">'+esc(error.message)+'</p>';
    }
  }
  box.addEventListener('toggle',function(){if(box.open)load();});
  window.FrontdeskBusinessDetails={init:function(value){helpers=value;},refresh:load,clear:function(){++pending;renderedScope=null;renderedHTML=null;content.innerHTML='';box.open=false;}};
})();
