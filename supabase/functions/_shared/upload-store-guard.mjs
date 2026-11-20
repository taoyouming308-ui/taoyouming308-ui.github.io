const salonNames = ['自由手艺人', '向里造型'];

function normalizedName(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/gu, '') : '';
}

function namedStores(text, names) {
  const normalized = normalizedName(text);
  return names.filter(name => normalized.includes(name));
}

function reject(message) {
  throw Object.assign(new Error(message), { code: 'UPLOAD_SOURCE_STORE_REJECTED' });
}

/** Validate declared ownership and any contradictory original labels before writing. */
export function assertUploadSourceStore(destination, declared, filename, header) {
  const target = normalizedName(destination);
  if (!target) reject('请先选择要上传到的门店');
  // Existing clients may omit the declaration. A supplied value must match exactly.
  if (declared != null && normalizedName(declared) !== target) {
    reject('原件所属门店与当前门店不一致，请切换到原件所属门店后上传');
  }
  const names = [...new Set([...salonNames, target])];
  const printed = namedStores(header, names);
  const matches = printed.length ? printed : namedStores(filename, names);
  if (matches.length > 1) reject('原件表头或文件名标有多个门店，请按门店拆分并核对原件');
  if (matches.length === 1 && matches[0] !== target) {
    reject('原件标注的门店与当前门店不一致，请切换门店后上传');
  }
}
