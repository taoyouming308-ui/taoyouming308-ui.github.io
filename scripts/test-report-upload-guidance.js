const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync('operations.html', 'utf8');
assert.match(page, /只有照片的 Word 凭证包不是月报数据/);
assert.match(page, /先点击下方月报对应开支的金额/);
assert.match(page, /原包留底不代表每张照片已精确对应/);
const start = page.indexOf("var uploadMessage=error.message;");
const end = page.indexOf("}finally{state.monthlyUploadBusy=false;button.disabled=false}", start);
assert.ok(start >= 0 && end > start);
const code = page.slice(start, end);
function message(isDocx, text) {
  const context = { isDocx, error: { message: text }, resultBox: {}, toast: () => {}, reportSaved: false, uploadScopeCurrent: () => true };
  vm.runInNewContext(code, context);
  return context.resultBox.textContent;
}
assert.match(message(true, 'Word 文档中没有表格；原始报错'), /选择已有批次和正确月份/);
assert.match(message(true, 'Word 文档中没有表格'), /不要反复提交/);
assert.equal(message(false, '网络错误'), '上传未完成：网络错误');
assert.equal(message(true, '网络错误'), '上传未完成：网络错误');
assert.doesNotMatch(code, /api\(|\.click\(|\.submit\(/);
console.log('Report upload guidance: no-table DOCX routing and unchanged unrelated failures passed');
