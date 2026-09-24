/* 护理月报：品牌独立汇总，保留门店、发型师与产品明细。 */
(function(root) {
  'use strict';
  var BRANDS = ['欧拉裴', '歌薇酸性护理', '歌薇上色水'];
  function label(value, fallback) { return String(value || '').trim() || fallback; }
  function amount(value) { return (value / 1000).toFixed(3).replace(/\.?0+$/, ''); }
  function escape(value) {
    return String(value).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function build(products, rows, store) {
    var brands = new Map();
    var people = new Map();
    BRANDS.forEach(function(brand) { brands.set(brand, { name: brand, products: new Set(), total: 0 }); });
    function brandGroup(name) {
      if (!brands.has(name)) brands.set(name, { name: name, products: new Set(), total: 0 });
      return brands.get(name);
    }
    products.forEach(function(p) {
      brandGroup(label(p.brand, '未标记品牌')).products.add(label(p.product_name, '未标记产品'));
    });
    var count = 0, total = 0;
    rows.forEach(function(row) {
      var shop = String(row.shop_name || '');
      if (store && shop !== store) return;
      var brand = label(row.brand, '未标记品牌');
      var product = label(row.product, '未标记产品');
      var barber = label(row.barber, '未知');
      var grams = Number(row.grams);
      if (!Number.isFinite(grams)) throw new Error('护理记录存在无效用量，请先核对明细');
      var units = Math.round(grams * 1000);
      var key = JSON.stringify([shop, barber]);
      if (!people.has(key)) people.set(key, { store: shop, barber: barber, brands: new Map() });
      var person = people.get(key);
      if (!person.brands.has(brand)) person.brands.set(brand, { total: 0, products: new Map() });
      var usage = person.brands.get(brand);
      usage.total += units;
      usage.products.set(product, (usage.products.get(product) || 0) + units);
      var group = brandGroup(brand);
      group.products.add(product);
      group.total += units;
      count++;
      total += units;
    });
    return {
      brands: Array.from(brands.values()),
      people: Array.from(people.values()).sort(function(a, b) {
        return a.store.localeCompare(b.store, 'zh-CN') || a.barber.localeCompare(b.barber, 'zh-CN');
      }),
      count: count, total: total
    };
  }
  function render(report) {
    var header = '<tr><th>门店</th><th>发型师</th>';
    report.brands.forEach(function(brand) { header += '<th style="white-space:nowrap;text-align:right;">' + escape(brand.name) + '（g）</th>'; });
    header += '<th>操作</th></tr>';
    var body = report.people.map(function(person, index) {
      var row = '<tr><td>' + escape(person.store || '—') + '</td><td>' + escape(person.barber) + '</td>';
      report.brands.forEach(function(brand) {
        var usage = person.brands.get(brand.name);
        row += '<td style="text-align:right;font-weight:600;">' + amount(usage ? usage.total : 0) + '</td>';
      });
      return row + '<td><button type="button" class="btn-edit" data-care-person="' + index + '" style="white-space:nowrap;">编辑用量</button></td></tr>';
    }).join('');
    if (!report.count) body = '<tr><td colspan="' + (report.brands.length + 3) + '" style="text-align:center;padding:20px;">该月暂无护理记录</td></tr>';
    body += '<tr style="font-weight:700;"><td colspan="2">当月合计</td>';
    report.brands.forEach(function(brand) { body += '<td style="text-align:right;">' + amount(brand.total) + '</td>'; });
    body += '<td></td></tr>';
    var details = report.brands.map(function(brand) {
      var products = Array.from(brand.products).sort(function(a, b) { return a.localeCompare(b, 'zh-CN', { numeric: true }); });
      var html = '<section style="margin-top:20px;" data-care-brand="' + escape(brand.name) + '"><h3 style="font-size:14px;">' + escape(brand.name) + ' · 月用量 ' + amount(brand.total) + 'g</h3>';
      var people = report.people.filter(function(person) { return person.brands.has(brand.name); });
      if (!people.length) return html + '<div style="color:var(--muted);">该月暂无该品牌用量</div></section>';
      html += '<div style="overflow-x:auto;"><table style="font-size:12px;"><thead><tr><th>门店</th><th>发型师</th>';
      products.forEach(function(product) { html += '<th style="white-space:nowrap;text-align:right;">' + escape(product) + '</th>'; });
      html += '<th style="white-space:nowrap;">品牌小计(g)</th></tr></thead><tbody>';
      var totals = new Map();
      people.forEach(function(person) {
        var usage = person.brands.get(brand.name);
        html += '<tr><td>' + escape(person.store || '—') + '</td><td>' + escape(person.barber) + '</td>';
        products.forEach(function(product) {
          var value = usage.products.get(product) || 0;
          totals.set(product, (totals.get(product) || 0) + value);
          html += '<td style="text-align:right;">' + (value ? amount(value) : '—') + '</td>';
        });
        html += '<td style="text-align:right;font-weight:600;">' + amount(usage.total) + '</td></tr>';
      });
      html += '<tr style="font-weight:700;"><td colspan="2">当月合计</td>';
      products.forEach(function(product) { html += '<td style="text-align:right;">' + amount(totals.get(product) || 0) + '</td>'; });
      return html + '<td style="text-align:right;">' + amount(brand.total) + '</td></tr></tbody></table></div></section>';
    }).join('');
    return { header: header, body: body, details: details };
  }
  // 按稳定 ID 分页，读取至空页；服务端行数上限低于请求值时也不会提前结束。
  async function fetchRows(fetcher, url, headers) {
    var rows = [], seen = new Set(), offset = 0;
    while (true) {
      var response = await fetcher(url + '&order=id.asc&limit=500&offset=' + offset, { headers: headers });
      if (!response.ok) throw new Error('加载护理记录失败（HTTP ' + response.status + '）');
      var page = await response.json();
      if (!Array.isArray(page)) throw new Error('护理记录返回格式异常');
      if (!page.length) return rows;
      page.forEach(function(row) {
        if (row.id == null || seen.has(String(row.id))) throw new Error('护理记录分页发生变化，请重新查询');
        seen.add(String(row.id));
        rows.push(row);
      });
      offset += page.length;
    }
  }
  var api = { build: build, render: render, fetchRows: fetchRows, amount: amount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CareMonthly = api;
})(typeof window === 'object' ? window : globalThis);
