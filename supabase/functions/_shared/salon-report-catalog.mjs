// Observed store+item-code+name routes. Unknown/renamed products need review.
// No customer/employee data; keep the SQL catalog regression in sync.
export const REPORT_MAPPING_VERSION = 'frontdesk-autofill-v2';
export const REPORT_PROJECT_ROUTES_V2 = [
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
export const REPORT_PROJECT_ROUTES_V5 = [
  ...REPORT_PROJECT_ROUTES_V2,
  ['1837032','511','歌薇酸护480','treatment'],
  ['1009951','307','烫发1380','perm'],
  ['1009951','410','健康染中发','color'],
  ['1009951','411','健康染长发','color'],
  ['1009951','416','基础染短发','color'],
];
export const REPORT_PROJECT_ROUTES_V7 = [
  ...REPORT_PROJECT_ROUTES_V5,
  ['1009951','523','歌薇酸护（盖白发）880','treatment'],
];
export const REPORT_PROJECT_ROUTES = [
  ...REPORT_PROJECT_ROUTES_V7,
  ['1009951','513','歌薇酸护880','treatment'],
  ['1837032','314','健康烫发1380元','perm'],
  ['1837032','417','基础染中发','color'],
  ['1837032','442','健康染发880','color'],
  ['1837032','431','漂发1200','color'],
  ['1009951','409','健康染短发','color'],
  ['1009951','428','健康染长发1460','color'],
  ['1009951','436','健康染长发14603次','color'],
];
// Approved service family only: excludes retail goods and unverified mixed packages.
export const APPROVED_ACID_CARE_PATTERN='^歌薇酸护(（盖白发）)?([0-9]+(元)?)?$';
export function reportProjectCategory(shopId, item) {
  if (!['1009951','1837032'].includes(String(shopId))) return null;
  // Explicit user decision: bleaching is dye, for both stores.
  if (item?.item_name === '褪色') return 'color';
  if (new RegExp(APPROVED_ACID_CARE_PATTERN).test(item?.item_name || '')) return 'treatment';
  return REPORT_PROJECT_ROUTES.find(([shop,code,name]) => shop === String(shopId)
    && code === String(item?.item_code) && name === item?.item_name)?.[3] ?? null;
}
