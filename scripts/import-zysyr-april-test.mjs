#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const API = "https://pdssrmpeiuwvxzsgschm.supabase.co/functions/v1/operations-api";
const KEY = "sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t";
const DATA_ROOT = "/Users/a1/Desktop/ZYSYR_Codex_完整交付包_V2.0_含原始资料及4月验收样本/ZYSYR_Codex_完整交付包";
const DAILY_DIR = path.join(DATA_ROOT, "03_2026年4月真实数据验收样本_日报");
const STORE = process.env.ZYSYR_IMPORT_STORE || "自由手艺人";
const USERNAME = process.env.ZYSYR_IMPORT_USERNAME || "ZYSYR";
const PASSWORD = process.env.ZYSYR_IMPORT_PASSWORD || "";
const MODE = process.argv[2] || "plan";

const dailyFiles = {
  "2026-04-01": "35EF3220-1FAF-4E72-AD37-BCE9AA6573A3.jpeg",
  "2026-04-02": "D7BFC3D0-89F1-4C19-ABF5-D1ACD62F1FFC.jpeg",
  "2026-04-03": "9B425F56-92D3-48F0-A558-4864E6576A5D.jpeg",
  "2026-04-04": "616847F7-F089-4440-8105-08736D81A8D6.jpeg",
  "2026-04-05": "524445E3-BBCA-4431-B86F-7CE69560B084.jpeg",
  "2026-04-07": "D5266E93-346E-4298-A0BC-9941432F1D60.jpeg",
  "2026-04-08": "56A5E6F0-AF77-49AB-9213-C610C20E8EF2.jpeg",
  "2026-04-09": "0B4E4AFF-203C-46EA-8C1E-2C178AA528FD.jpeg",
  "2026-04-10": "0AE18E20-6AB6-44C3-9111-A6B23C8EBD8A.jpeg",
  "2026-04-11": "15C3BE94-6203-4C48-933B-71D10BDC4350.jpeg",
  "2026-04-12": "A6D82F55-2004-48ED-8181-84D56CF4DA5B.jpeg",
  "2026-04-14": "17C9B834-F467-4E22-9C91-F7960E3B65E1.jpeg",
  "2026-04-15": "3C0B9D23-BA29-4B46-8FD2-F1B878100B01.jpeg",
  "2026-04-16": "9CCC26A7-D74D-419A-AB99-D2C8F38909A2.jpeg",
  "2026-04-17": "FDC5A13F-2104-4446-8955-5B6397F6EE89.jpeg",
  "2026-04-18": "C8C1BDE9-3F07-4F4D-858D-F0C1BB784437.jpeg",
  "2026-04-19": "53F6FC07-3997-44BE-A2D1-A4EA811A9FFB.jpeg",
  "2026-04-21": "FA8E01A9-4651-408E-86FD-F79F2A74975E.jpeg",
  "2026-04-22": "CCF63135-81DC-4323-B354-DBC51AC26AAC.jpeg",
  "2026-04-23": "C0E4EB79-77DA-45CB-959E-6C5DFA0D3D53.jpeg",
  "2026-04-24": "D3284BA2-B4CE-48DD-82DA-ADFA15A266E5.jpeg",
  "2026-04-25": "14825419-B34D-413A-973C-521A119AFEF9.jpeg",
  "2026-04-26": "072EF5B0-3228-4D39-81EA-17130D61A74C.jpeg",
  "2026-04-28": "D780A7F4-6096-4A6D-BAE8-769B2DC619D1.jpeg",
  "2026-04-29": "FA607A32-D1F3-4FFF-BFDE-96DCC699815F.jpeg",
  "2026-04-30": "4F96B571-84A8-4C41-B4FD-C1FBD1F62B6C.jpeg",
};

function fail(message) {
  throw new Error(message);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) fail(result.error || result.message || String(response.status));
  return result;
}

async function api(operation, payload = {}, auth = {}) {
  const headers = { "Content-Type": "application/json", apikey: KEY };
  if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
  const response = await fetch(API, {
    method: "POST",
    headers,
    body: JSON.stringify({ operation, session_token: auth.sessionToken || "", ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) fail(`${operation}: ${result.error || response.status}`);
  return result;
}

async function login() {
  if (!PASSWORD) fail("请通过隐藏环境变量 ZYSYR_IMPORT_PASSWORD 提供财务密码");
  let auth;
  try {
    const legacy = await api("login", { username: USERNAME, password: PASSWORD });
    auth = { sessionToken: legacy.session_token, accessToken: "", user: legacy.user };
  } catch (_) {
    const migrated = await requestJson("https://pdssrmpeiuwvxzsgschm.supabase.co/functions/v1/operations-auth-migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: KEY },
      body: JSON.stringify({ action: "password_login", username: USERNAME, password: PASSWORD }),
    });
    auth = { sessionToken: "", accessToken: migrated.access_token, user: null };
    auth.user = (await api("session", {}, auth)).user;
  }
  if (auth.user?.role !== "finance") fail(`账号角色必须是财务，当前为 ${auth.user?.role || "未知"}`);
  if (!Array.isArray(auth.user?.stores) || !auth.user.stores.includes(STORE)) fail(`财务账号无权访问门店：${STORE}`);
  return auth;
}

async function plan() {
  const entries = Object.entries(dailyFiles).sort(([a], [b]) => a.localeCompare(b));
  const mondays = ["2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27"];
  for (const [date, filename] of entries) {
    const file = path.join(DAILY_DIR, filename);
    const stat = await fs.stat(file);
    const digest = crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
    console.log(`${date}\t${filename}\t${stat.size}\t${digest}`);
  }
  console.log(JSON.stringify({ store: STORE, daily_count: entries.length, closed_mondays: mondays, mode: "manual-entry-only" }));
}

async function uploadDailies(auth) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  let center = await api("voucher_center", { store: STORE, month: currentMonth }, auth);
  const byHash = new Map((center.vouchers || []).map((voucher) => [voucher.sha256, voucher]));
  const results = [];
  for (const [date, sourceName] of Object.entries(dailyFiles).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.join(DAILY_DIR, sourceName);
    const bytes = await fs.readFile(file);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    let voucher = byHash.get(digest);
    if (!voucher) {
      const uploaded = await api("voucher_upload", {
        store: STORE,
        record_type: "unassigned",
        record_id: "",
        filename: `${date}_自由手艺人日报原图.jpeg`,
        mime_type: "image/jpeg",
        skip_ocr: true,
        base64: bytes.toString("base64"),
        note: `2026年4月逻辑验收 · ${date} 日报纸质原件 · SHA256 ${digest}`,
      }, auth);
      voucher = uploaded.saved;
      byHash.set(digest, voucher);
    }
    if (voucher.audit_status !== "approved" || voucher.document_type !== "daily_report") {
      await api("voucher_review", {
        store: STORE,
        voucher_id: voucher.id,
        decision: "approved",
        document_type: "daily_report",
        corrected_fields: { document_date: date, source_filename: sourceName, test_period: "2026-04" },
        field_confidences: {},
        report_ids: [],
        reason: "4月逻辑验收：已人工核对原图抬头与日期；金额暂不作为审核结论，电子表仍需人工逐格填写。",
      }, auth);
    }
    const sheet = await api("daily_sheet_create", {
      store: STORE,
      report_date: date,
      voucher_id: voucher.id,
      reason: "4月真实资料逻辑验收：按原图建立同版人工电子日报草稿，暂不确认金额。",
    }, auth);
    results.push({ date, voucher_id: voucher.id, draft_id: sheet.draft?.id, draft_status: sheet.draft?.status, cell_count: sheet.cells?.length || 0 });
    console.log(JSON.stringify(results.at(-1)));
  }
  return results;
}

if (MODE === "plan") {
  await plan();
} else {
  const loginResult = await login();
  console.log(JSON.stringify({ login: "ok", role: loginResult.user.role, stores: loginResult.user.stores }));
  if (MODE === "inspect") {
    const overview = await api("overview", { store: STORE, month: "2026-04" }, loginResult);
    console.log(JSON.stringify({ store: overview.store, april_reports: overview.reports?.length || 0, has_monthly_report: Boolean(overview.monthly_report) }));
  } else if (MODE === "upload-dailies") {
    const results = await uploadDailies(loginResult);
    console.log(JSON.stringify({ completed: true, daily_count: results.length, drafts: results }));
  } else {
    fail(`未知模式：${MODE}`);
  }
}
