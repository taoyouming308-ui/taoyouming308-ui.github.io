(function (root) {
  'use strict';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function result(value) { return value && ['matched', 'mismatch', 'needs_review'].indexOf(value.status) >= 0 ? value : { status: 'needs_review', issues: [{ message: '此版本没有自动核对记录，请人工核对原件' }] }; }
  function summary(value) {
    var v = result(value);
    if (v.status === 'matched') return '原件核对一致（' + Number(v.checked_cells || 0) + ' 个数值 / ' + Number(v.checked_formulas || 0) + ' 个公式）';
    if (v.status === 'mismatch') return '发现 ' + Number(v.issue_count || 1) + ' 处差异，请核对原件';
    return '原件待核对：' + ((v.issues || [])[0] || {}).message;
  }
  function details(value) {
    var v = result(value);
    return (v.issues || []).slice(0, 40).map(function (issue) {
      var pair = Object.prototype.hasOwnProperty.call(issue, 'expected') ? ' · 原件：' + (issue.expected == null ? '无数值' : issue.expected) + '；保存：' + (issue.actual == null ? '无数值' : issue.actual) : '';
      return (issue.address ? issue.address + '：' : '') + issue.message + pair;
    });
  }
  function receipt(value) { return '草稿已保存 · ' + summary(value) + '。未自动入账。' + (result(value).status === 'matched' ? '' : '\n' + details(value).join('\n')); }
  function render(node, report) {
    if (!node) return;
    if (!report || report.historical) { node.hidden = true; node.innerHTML = ''; return; }
    var v = result(report.upload_verification), lines = details(v);
    node.hidden = false; node.dataset.status = v.status;
    node.setAttribute('role', v.status === 'matched' ? 'status' : 'alert');
    node.innerHTML = '<strong>上传时原件核对 · ' + esc(summary(v)) + '</strong><div class="help">自动核对仅检查导入是否与原件一致，不代表原件账目已审核。上传仅保存草稿，核对结果不会自动入账。</div>'
      + (lines.length ? '<details open><summary>核对明细</summary><ul>' + lines.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul>'
        + (Number(v.issue_count || 0) > lines.length ? '<p>共 ' + Number(v.issue_count) + ' 处，显示前 40 处。</p>' : '') + '</details>' : '');
  }
  root.MonthlyUploadVerification = { summary: summary, receipt: receipt, render: render };
})(typeof window === 'undefined' ? globalThis : window);
