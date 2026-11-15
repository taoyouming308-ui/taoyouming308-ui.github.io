// Compatibility copies exist only in memory. Archive/hash the caller's original bytes.
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XML_TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:"[^"]*"|'[^']*'|[^'">])*>/g;
const ATTR = /([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/g;

function spreadsheetXml(xml) {
  if (!/xmlns:[\w.-]+\s*=\s*["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/.test(xml) && !/\bt\s*=\s*["']d["']/.test(xml)) return xml;
  if (/<!DOCTYPE/i.test(xml)) throw new Error('不支持含 DTD 的 Excel XML');
  const stack = [{ namespaces: {}, name: '', outputName: '' }];
  return xml.replace(XML_TAG, tag => {
    if (/^<(!|\?)/.test(tag)) return tag;
    const end = /^<\//.test(tag), name = tag.match(/^<\/?([^\s/>]+)/)?.[1];
    if (!name) return tag;
    if (end) {
      const frame = stack.pop();
      if (!frame || stack.length === 0 || frame.name !== name) throw new Error('Excel XML 标签不完整');
      return tag.replace(name, frame.outputName);
    }
    const namespaces = { ...stack[stack.length - 1].namespaces };
    for (const [, key, quoted] of tag.matchAll(ATTR)) {
      if (key === 'xmlns') namespaces[''] = quoted.slice(1, -1);
      else if (key.startsWith('xmlns:')) namespaces[key.slice(6)] = quoted.slice(1, -1);
    }
    const colon = name.indexOf(':'), prefix = colon < 0 ? '' : name.slice(0, colon);
    const namespace = namespaces[prefix] || '';
    const outputName = namespace === MAIN ? name.slice(colon + 1) : name;
    let output = tag.replace(name, outputName);
    // ExcelJS 4 parses t="d" as a numeric serial (2026-... becomes 2026).
    // Preserve the explicit ISO text instead; strict date validation runs later.
    if (namespace === MAIN && outputName === 'c') output = output.replace(/(\st\s*=\s*)(["'])d\2/, '$1$2str$2');
    // Preserve namespace semantics for foreign/unqualified descendants as well.
    // Keep prefix declarations and all qualified attributes unchanged.
    if (!outputName.includes(':')) {
      if (/\sxmlns\s*=/.test(output)) output = output.replace(/(\sxmlns\s*=\s*)("[^"]*"|'[^']*')/, '$1"' + namespace + '"');
      else output = output.replace(/\/?\s*>$/, ending => ' xmlns="' + namespace + '"' + ending);
    }
    if (!/\/\s*>$/.test(tag)) stack.push({ namespaces, name, outputName });
    return output;
  });
}

function relativeTarget(relsName, target) {
  if (!target.startsWith('/') || target.startsWith('//') || /[&#?\\]/.test(target)) return target;
  const destination = target.slice(1).split('/');
  if (destination.some(p => !p || p === '.' || p === '..')) return target;
  const base = relsName.split('/').slice(0, -2);
  while (base.length && destination.length && base[0] === destination[0]) { base.shift(); destination.shift(); }
  return [...base.map(() => '..'), ...destination].join('/');
}

export async function compatiblePettyXlsxBytes(bytes, JSZip) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('文件内容不是 XLSX 工作簿；旧版 XLS 或加密文件请另存为未加密的 XLSX');
  }
  let zip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new Error('无法解压 Excel 文件，请确认文件已完整下载且未加密'); }
  if (!zip.file('xl/workbook.xml') || !zip.file('[Content_Types].xml')) throw new Error('文件缺少 XLSX 工作簿结构，请确认上传的是 Excel 工作簿');
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (entries.length > 2000 || entries.reduce((n, entry) => n + (entry._data?.uncompressedSize || 0), 0) > 64 * 1024 * 1024) throw new Error('Excel 解压后过大，请拆分为较小的明细工作簿');
  try { await JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch { throw new Error('Excel 压缩内容校验失败，请重新下载完整原文件'); }
  let changed = false;
  for (const entry of entries) {
    if (!/\.(xml|rels)$/i.test(entry.name)) continue;
    const xml = await entry.async('string');
    let next = xml;
    if (/\.xml$/i.test(entry.name)) next = spreadsheetXml(xml);
    else next = xml.replace(XML_TAG, tag => {
      if (!/^<(?:[\w.-]+:)?Relationship\s/.test(tag) || /\bTargetMode\s*=\s*['"]External['"]/i.test(tag)) return tag;
      return tag.replace(/(\bTarget\s*=\s*)(['"])([^'"]*)\2/, (_, start, quote, target) => start + quote + relativeTarget(entry.name, target) + quote);
    });
    if (next !== xml) { zip.file(entry.name, next); changed = true; }
  }
  return changed ? await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) : bytes;
}

export async function loadPettyDetailWorkbook(bytes, ExcelJS, JSZip) {
  const compatible = await compatiblePettyXlsxBytes(bytes, JSZip);
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(compatible.buffer.slice(compatible.byteOffset, compatible.byteOffset + compatible.byteLength)); }
  catch { throw new Error('Excel 结构暂无法读取，请保留原文件并联系维护人员检查兼容性'); }
  return book;
}
