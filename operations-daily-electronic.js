/* Finance-only source comparison. Never copies values into the report or confirms it. */
(function () {
  'use strict';
  var generation = 0;
  var accountLabels = { public_card: '公-刷卡', public_qr: '公-支微', private_card: '私-刷卡', private_qr: '私-支微' };
  var groupLabels = { source_cash: '现金类', source_card: '划卡类', source_noncash: '其他非现金类' };
  var names = { projects_daily_summary: '项目消费汇总', operating_daily_summary: '项目及零售实际收款（不含充值售卡）', card_sales_daily_summary: '充值、套餐及年卡新收款（不计实做）', all_business_daily_summary: '全部业务收款汇总（含售卡充值范围）' };
  var gaps = {
    source_shop_not_echoed: '源汇总未回显门店，仍需明细交叉核验',
    employee_detail_unavailable: '员工明细尚未补齐', project_mapping_unavailable: '项目与日报栏目映射尚未完成',
    financial_review_required: '仍需财务审核', source_group_mismatch: '源分组合计存在差额',
    source_fields_unknown: '部分源金额为空，未按零处理',
    all_business_total_is_not_cash_performance: '全业务收款不能直接作为现金业绩入账'
  };
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function money(cents) {
    return cents == null || !Number.isSafeInteger(Number(cents)) ? '未取得' : (Number(cents) / 100).toFixed(2) + ' 元';
  }
  function scope() {
    var sheet = state.imports.sheet;
    return sheet && sheet.draft && { store: currentStore(), id: String(sheet.draft.id), date: String(sheet.draft.report_date) };
  }
  function sameScope(ctx, token) {
    var now = scope();
    return generation === token && state.user && state.user.role === 'finance' && now
      && now.id === ctx.id && now.date === ctx.date && now.store === ctx.store;
  }
  function drawDetails(container, item) {
    container.replaceChildren();
    container.appendChild(el('p', '版本 ' + item.version + ' · 原始快照 SHA-256：' + item.source_sha256, 'help'));
    var table = el('table', null, 'voucher-table');
    var body = el('tbody');
    var cells = (item.candidate_payload || {}).cells || [];
    cells.forEach(function (cell) {
      var row = el('tr');
      row.appendChild(el('td', (groupLabels[cell.section_code] ? groupLabels[cell.section_code] + ' · ' : '')
        + (cell.label || accountLabels[cell.column_code] || cell.column_code)));
      row.appendChild(el('td', cell.status === 'not_applicable' ? '留空（无需填写）' : money(cell.value_cents)));
      body.appendChild(row);
    });
    table.appendChild(body); container.appendChild(table);
    container.appendChild(el('p', '以上仅为来源参考，不会改动原日报、原图或已入账金额。', 'help'));
  }
  function drawList(container, data, ctx, token) {
    container.replaceChildren();
    if (!data || data.stage !== 'source_only' || data.formal_ledger_amount_changed !== false || !Array.isArray(data.items)) {
      throw new Error('电子来源返回格式异常，请重新读取');
    }
    if (!data.items.length) {
      container.appendChild(el('p', '该日期尚无已留存电子来源，不代表营业额为零。', 'help'));
      return;
    }
    data.items.forEach(function (item) {
      if (item.business_date !== ctx.date || !names[item.source_scope]) throw new Error('电子来源日期或范围不一致');
      var row = el('section', null, 'daily-readonly-note');
      row.style.marginTop = '8px';
      row.appendChild(el('strong', names[item.source_scope]));
      row.appendChild(el('p', '源现金类合计参考：' + money(item.cash_total_reference_cents)));
      var list = el('ul');
      (item.gaps || []).forEach(function (gap) { list.appendChild(el('li', gaps[gap.code] || '存在待核对项')); });
      row.appendChild(list);
      var button = el('button', '查看来源数值与版本', 'secondary'); button.type = 'button';
      var detail = el('div'); detail.style.overflowWrap = 'anywhere';
      button.onclick = async function () {
        if (!sameScope(ctx, token) || button.disabled) return;
        button.disabled = true; detail.textContent = '正在读取…';
        try {
          var result = await api('daily_electronic_sources', { store: ctx.store, start_date: ctx.date, end_date: ctx.date,
            source_scope: item.source_scope, candidate_id: item.candidate_id });
          if (!sameScope(ctx, token)) return;
          var selected = (result.items || []).find(function (value) { return value.candidate_id === item.candidate_id
            && value.business_date === ctx.date && value.source_sha256 === item.source_sha256; });
          if (!selected) throw new Error('来源版本已变化，请重新读取核对');
          drawDetails(detail, selected);
        } catch (error) { if (sameScope(ctx, token)) detail.textContent = error.message; }
        finally { if (sameScope(ctx, token)) button.disabled = false; }
      };
      row.appendChild(button); row.appendChild(detail); container.appendChild(row);
    });
  }
  var originalRender = renderDailySheetDetail;
  renderDailySheetDetail = function () {
    originalRender.apply(this, arguments);
    generation += 1;
    var old = document.getElementById('daily-electronic-source-reference'); if (old) old.remove();
    var ctx = scope(), grid = document.getElementById('daily-detail-grid');
    if (!grid || !ctx || !state.user || state.user.role !== 'finance') return;
    var token = generation, panel = el('details', null, 'daily-more-options');
    panel.id = 'daily-electronic-source-reference';
    panel.appendChild(el('summary', '电子来源核对（只读，不自动入账）'));
    panel.appendChild(el('p', '公-刷卡、公-支微、私-刷卡、私-支微按你的要求留空；其他缺失数据不当作零。', 'help'));
    var button = el('button', '读取当天电子来源', 'secondary'); button.type = 'button';
    var content = el('div'); content.setAttribute('aria-live', 'polite');
    button.onclick = async function () {
      if (!sameScope(ctx, token) || button.disabled) return;
      button.disabled = true; content.textContent = '正在读取已留存来源，不会请求美管加…';
      try {
        var data = await api('daily_electronic_sources', { store: ctx.store, start_date: ctx.date, end_date: ctx.date });
        if (sameScope(ctx, token)) drawList(content, data, ctx, token);
      } catch (error) { if (sameScope(ctx, token)) content.textContent = error.message; }
      finally { if (sameScope(ctx, token)) button.disabled = false; }
    };
    panel.appendChild(button); panel.appendChild(content); grid.insertAdjacentElement('afterend', panel);
    var businessButton = el('button','读取收银员工与付款明细','secondary'); businessButton.type='button';
    businessButton.style.marginLeft='8px';
    businessButton.onclick=async function(){
      if(!sameScope(ctx,token)||businessButton.disabled)return;
      businessButton.disabled=true;content.textContent='正在读取收银共用明细…';
      try{
        var data=await api('daily_business_details',{store:ctx.store,date:ctx.date});
        if(!sameScope(ctx,token))return;
        if(data.shop!==ctx.store||data.date!==ctx.date||data.automatic_posting_enabled!==false||data.readonly!==true)throw new Error('收银明细范围校验失败');
        content.replaceChildren();
        if(!data.available){content.appendChild(el('p','本店该日收银明细尚未补齐。','help'));return;}
        content.appendChild(el('p','已读取 '+data.source_count+' 张项目消费单'+(data.source_list_changed?'；源单据已更新，等待重新同步。':'。'),'help'));
        var table=el('table',null,'voucher-table'),body=el('tbody');
        (data.employees||[]).forEach(function(row){var tr=el('tr');tr.appendChild(el('td',(row.employee_names||[]).join(' / ')+' · '+row.source_role));var counts=row.service_counts||{};var metric=row.metric_kind==='service_count'?'烫 '+(counts.perm==null?'待核对':counts.perm)+' · 染 '+(counts.dye==null?'待核对':counts.dye)+' · 护 '+(counts.care==null?'待核对':counts.care)+(counts.review?' · 待分类 '+counts.review:''):money(row.performance_cents);tr.appendChild(el('td',metric));body.appendChild(tr);});
        (data.payments||[]).filter(function(row){return row.amount_cents!==0;}).forEach(function(row){var tr=el('tr');tr.appendChild(el('td',(row.source_labels||[]).join(' / ')||row.source_field));tr.appendChild(el('td',money(row.amount_cents)));body.appendChild(tr);});
        table.appendChild(body);content.appendChild(table);
        content.appendChild(el('p','发型师金额、技师烫染护个数与付款分别核对。当前来源为项目消费；日报逐列映射及零售、售卡充值仍待补齐。','help'));
      }catch(error){if(sameScope(ctx,token))content.textContent=error.message;}
      finally{if(sameScope(ctx,token))businessButton.disabled=false;}
    };
    button.insertAdjacentElement('afterend',businessButton);
  };
})();
