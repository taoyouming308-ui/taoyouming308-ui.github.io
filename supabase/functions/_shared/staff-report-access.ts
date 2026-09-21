// Employee report access is a separate read-only boundary. Never use client roles.
type Row = Record<string, unknown>;
type Rows = (path: string) => Promise<Row[]>;
export const STAFF_REPORT_OPERATIONS = new Set([
  "session", "overview", "monthly_summary", "report_cells", "report_lineage", "cell_trace", "report_url",
  "daily_sheet_month", "daily_sheet_read", "salary_sheet_read", "payroll_center",
  "petty_cash_report", "voucher_url", "history_evidence_images", "history_import_file_url",
]);
export const STAFF_REPORT_CAPABILITIES = ["dashboard.store.read", "voucher.read", "salary.read"];
export async function staffReportIdentity(token: unknown, rows: Rows, hash: (v: string) => Promise<string>) {
  if (typeof token !== "string" || !/^[a-f0-9-]{72}$/i.test(token)) throw new Error("员工登录已失效，请返回 App 重新登录");
  const sessions = await rows(`employee_booking_sessions?select=username,store,expires_at&token_hash=eq.${await hash(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  const session = sessions[0];
  if (!session) throw new Error("员工登录已失效，请返回 App 重新登录");
  const staff = (await rows(`staff?select=id,username,store,active,employment_status&username=eq.${encodeURIComponent(String(session.username))}&limit=1`))[0];
  if (!staff || staff.active !== true || staff.employment_status !== "active" || staff.store !== session.store) throw new Error("员工账号已停用或门店变化，请重新登录");
  const grants = await rows(`staff_report_grants?select=store_id&staff_id=eq.${Number(staff.id)}&limit=50`);
  const ids = grants.map(r => String(r.store_id)).filter(v => /^[0-9a-f-]{36}$/i.test(v));
  const stores = ids.length ? await rows(`zysyr_stores?select=id,company_id,name,status&id=in.(${ids.join(",")})&status=eq.active&order=name.asc&limit=50`) : [];
  return { staff, stores };
}
export async function staffReportSession(payload: Row, rows: Rows, hash: (v: string) => Promise<string>): Promise<Row> {
  if (!STAFF_REPORT_OPERATIONS.has(String(payload.operation))) throw new Error("股东仅有查看报表权限，不能修改或入账");
  const {staff, stores} = await staffReportIdentity(payload.employee_session_token, rows, hash);
  if (!stores.length) throw new Error("尚未开通股东报表权限，请联系管理员");
  if (payload.store && !stores.some(s => s.name === payload.store)) throw new Error("无权查看该门店报表");
  return { username: staff.username, role: "staff_report_reader", position: "股东（只读）",
    operations_role: "shareholder", store: stores[0].name, staff_report_readonly: true,
    auth_scope_type: "assigned_stores", auth_stores: stores.map(s=>s.name), auth_store_records: stores,
    auth_capabilities: STAFF_REPORT_CAPABILITIES, auth_account_id: "" };
}
