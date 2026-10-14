// Monthly review is an attestation, not an accounting write. Dependencies are
// injected so the actual authenticated adapter can be tested without live data.
export const MONTHLY_REVIEW_OPERATIONS = new Set([
  'monthly_review_status', 'monthly_review_inbox', 'monthly_review_preview',
  'monthly_review_publish', 'monthly_review_confirm',
]);
export const REVIEW_STATEMENT = 'reviewed_no_objection_v1';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function canonicalReview(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalReview).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalReview(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function monthlyReviewSnapshot(data, store, month) {
  const report = record(data.monthly_report), display = record(report.display_data);
  if (!Array.isArray(display.values) || !display.values.length) throw Error('请先完成并保存本月月报，再提交股东确认');
  // Whitelist presentation fields. No signed URLs, sessions, raw vouchers,
  // uploader identities or runtime timestamps become confirmation content.
  const cleanDisplay = {};
  for (const key of ['values', 'merges', 'rows', 'columns', 'column_widths', 'row_heights', 'cell_styles']) {
    if (display[key] !== undefined) cleanDisplay[key] = display[key];
  }
  const fields = ['date', 'labor_performance', 'cash_performance', 'card_amount', 'group_buy', 'alipay', 'wechat', 'douyin', 'missing_fields'];
  const rows = (data.monthly_daily_performance?.rows || []).map(row => Object.fromEntries(fields.map(key => [key, row[key] ?? null])))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  return JSON.parse(JSON.stringify({schema_version:1, store_id:store.id, store_name:store.name, month,
    report:{source_id:report.id || null, historical:report.historical === true, display_data:cleanDisplay},
    daily_performance:{rows}}));
}
export function monthlyReviewError(code) {
  const errors = {
    MONTHLY_REVIEW_SOURCE_CHANGED:'月报来源刚发生变化，请重新核对预览后提交；未覆盖任何金额',
    MONTHLY_REVIEW_VERSION_CHANGED:'已有新版本，请重新打开本月报表核对，不能确认旧版本',
    MONTHLY_REVIEW_CONTENT_CHANGED:'确认内容与所查看版本不一致，请重新打开报表',
    MONTHLY_REVIEW_REPUBLICATION_REQUIRED:'月报金额或内容已变化，请财务重新提交新版本后再确认',
    MONTHLY_REVIEW_NO_RECIPIENTS:'尚未在后台给股东开通此门店权限，请先由管理员授权',
    MONTHLY_REVIEW_RECIPIENT_REQUIRED:'尚未收到本版本的确认待办，请财务重新提交给当前已授权股东',
    MONTHLY_REVIEW_REPORT_MISSING:'本月尚无已保存月报，不能提交股东确认',
    MONTHLY_REVIEW_PUBLICATION_NOT_FOUND:'待确认版本不存在，请重新读取',
    MONTHLY_REVIEW_CONSENT_REQUIRED:'请明确确认已核对报表且账目无异议',
    MONTHLY_REVIEW_FINANCE_REQUIRED:'只有已授权财务可以提交月报',
    FINANCE_SCOPE_FORBIDDEN:'没有此门店的财务提交权限',
  };
  if (errors[code]) return errors[code];
  if (/MONTHLY_REVIEW_(?:STAFF_DENIED|ACCOUNT_DENIED|STORE_DENIED|IDENTITY_INVALID)/.test(code)) return '没有此门店的月报确认权限，请联系后台管理员';
  return '月报确认服务暂时未完成请求，请重新读取状态后再操作';
}
export async function monthlyReviewRequest(payload, session, deps) {
  const op = payload.operation;
  if (!MONTHLY_REVIEW_OPERATIONS.has(op)) throw Error('不支持的月报确认操作');
  const staff = session.staff_report_readonly === true;
  const actor = staff ? {p_user_account_id:null,p_staff_id:Number(session.auth_staff_id)}
    : {p_user_account_id:session.auth_account_id,p_staff_id:null};
  if (staff ? !Number.isSafeInteger(actor.p_staff_id) || actor.p_staff_id < 1 : !uuid(actor.p_user_account_id)) {
    throw Error('请从已验证的账号入口重新登录后查看月报确认');
  }
  const finance = !staff && session.operations_role === 'finance';
  if (!finance && session.operations_role !== 'shareholder') throw Error('没有月报确认权限');
  if (op === 'monthly_review_preview' || op === 'monthly_review_publish') deps.requireFinance(session);
  if (op === 'monthly_review_inbox') {
    if (finance) return {pending:[],count:0};
    const stores = Array.isArray(session.auth_store_records) ? session.auth_store_records : [];
    if (!stores.length) throw Error('尚未开通股东报表权限，请联系管理员');
    // At most one light RPC per already-authorized store, never per month.
    const pending = [];
    for (const store of stores) {
      const inbox = await deps.rpc('zysyr_monthly_review_inbox',{p_company_id:store.company_id || session.auth_company_id,p_store_id:store.id,...actor});
      pending.push(...(inbox.pending || []).map(item => ({...item,store:store.name,store_id:store.id})));
    }
    return {pending,count:pending.length};
  }
  const month = String(payload.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('请选择正确月份');
  const store = await deps.selectedStore(session,payload);
  const scope = {p_company_id:store.company_id,p_store_id:store.id,p_period_month:month+'-01'};
  const status = () => deps.rpc('zysyr_monthly_review_status',{...scope,...actor,p_as_finance:finance});
  if (op === 'monthly_review_status') return {...await status(),finance};
  const current = async () => {
    const before = await deps.rpc('zysyr_monthly_review_source_token',scope);
    const snapshot = monthlyReviewSnapshot(await deps.overview({store:store.name,month},session),store,month);
    const after = await deps.rpc('zysyr_monthly_review_source_token',scope);
    if (!digest(before) || before !== after) throw Error(monthlyReviewError('MONTHLY_REVIEW_SOURCE_CHANGED'));
    return {snapshot,source_token:after,preview_token:await deps.hash(canonicalReview(snapshot)+':'+after)};
  };
  if (op === 'monthly_review_preview') {
    const state = await status(), live = await current();
    return {snapshot:live.snapshot,preview_token:live.preview_token,expected_publication_id:state.publication?.id || null,
      changed:!state.publication || canonicalReview(state.publication.snapshot)!==canonicalReview(live.snapshot)};
  }
  if (op === 'monthly_review_publish') {
    if (payload.reviewed_complete !== true || !digest(payload.preview_token)) throw Error('请先核对提交预览，并确认财务已完成本月报表');
    if (payload.expected_publication_id != null && !uuid(payload.expected_publication_id)) throw Error('月报版本无效，请重新预览');
    const live = await current();
    if (payload.preview_token !== live.preview_token) throw Error('预览后月报已变化，请重新预览；不会提交未核对的内容');
    return await deps.rpc('zysyr_publish_monthly_review',{...scope,p_actor_user_id:actor.p_user_account_id,
      p_snapshot:live.snapshot,p_source_token:live.source_token,p_expected_publication_id:payload.expected_publication_id || null});
  }
  if (finance) throw Error('请从股东账号入口明确确认，财务提交不代表股东确认');
  if (!uuid(payload.publication_id) || !digest(payload.content_hash) || payload.statement_code !== REVIEW_STATEMENT) throw Error('请核对当前版本，并明确确认账目无异议');
  // The database enforces the identity, hash, scope and duplicate contract.
  const live = await current();
  return await deps.rpc('zysyr_confirm_monthly_review',{p_company_id:store.company_id,p_store_id:store.id,...actor,
    p_publication_id:payload.publication_id,p_content_hash:payload.content_hash,p_statement_code:REVIEW_STATEMENT,
    p_current_snapshot:live.snapshot,p_source_token:live.source_token});
}
