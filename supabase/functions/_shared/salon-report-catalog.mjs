// Observed store+item-code+name routes. Unknown/renamed products need review.
// No customer/employee data; keep the SQL catalog regression in sync.
export const REPORT_MAPPING_VERSION = 'frontdesk-autofill-v2';
export const REPORT_PROJECT_ROUTES = [
  ['1837032','101','洗吹98元','makeup_styling'],
  ['1837032','103','洗发15分钟','wash_cut_blow'],
  ['1837032','104','洗发15分钟内','wash_cut_blow'],
  ['1837032','201','剪发120','wash_cut_blow'],
  ['1837032','202','剪发180','wash_cut_blow'],
  ['1837032','203','剪发280','wash_cut_blow'],
  ['1837032','205','剪发79','wash_cut_blow'],
  ['1837032','311','烫刘海400','perm'],
  ['1837032','323','质感烫发699','perm'],
  ['1837032','324','健康烫发980','perm'],
  ['1837032','427','褪色','color'],
  ['1837032','439','健康染699','color'],
  ['1009951','101','洗吹98元','makeup_styling'],
  ['1009951','103','洗发15分钟','wash_cut_blow'],
  ['1009951','104','洗发15分钟内','wash_cut_blow'],
  ['1009951','201','剪发120','wash_cut_blow'],
  ['1009951','202','剪发180','wash_cut_blow'],
  ['1009951','203','剪发280','wash_cut_blow'],
  ['1009951','204','剪发380','wash_cut_blow'],
  ['1009951','308','烫发1780','perm'],
  ['1009951','316','烫发980','perm'],
  ['1009951','417','基础染中发','color'],
  ['1009951','434','基础染长发1060','color'],
  ['1009951','501','护理400','treatment'],
  ['1009951','512','歌薇酸护680','treatment'],
];
export function reportProjectCategory(shopId, item) {
  if (!['1009951','1837032'].includes(String(shopId))) return null;
  // Explicit user decision: bleaching is dye, for both stores.
  if (item?.item_name === '褪色') return 'color';
  return REPORT_PROJECT_ROUTES.find(([shop,code,name]) => shop === String(shopId)
    && code === String(item?.item_code) && name === item?.item_name)?.[3] ?? null;
}
