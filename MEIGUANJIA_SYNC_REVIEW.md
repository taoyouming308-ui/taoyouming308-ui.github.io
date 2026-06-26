# Meiguanjia Sync Review

This is the handoff checklist for Hermes and Codex when improving Meiguanjia appointment/customer sync.

## Current Sync Surfaces

1. `bookings`
   - Used by the appointment page.
   - Key fields consumed by the app: `id`, `date`, `shop_name`, `barber_name`, `customer_name`, `customer_phone`, `time_label`, `reservation_time`, `service_name`, `notes`, `status`.

2. `customer_profiles`
   - Used by plan modal, customer archive, backend customer list, follow-up list.
   - Key fields consumed by the app: `phone`, `name`, `shop_name`, `barber_name`, `total_visits`, `total_consumption`, `last_visit_date`, `card_packages`, `service_history`, `notes`.

3. Local realtime plan API
   - The app tries `/api/plan?phone=...` first when opening a plan modal.
   - If that fails, it falls back to `customer_profiles`.

4. Hair/customer archive bridge
   - `hair_records` and `customer_profiles` are merged by normalized phone first, then name fallback.

## Read-Only Audit

Run:

```sh
node scripts/audit-meiguanjia-sync.js
```

Current audit findings from sample data:

- `customer_profiles` has many rows with `total_visits` or `total_consumption` but empty `service_history`.
- Some `last_visit_date` values are relative text like `8小时前` instead of stable ISO dates.
- Some bookings have no `service_name`; if Meiguanjia has the project name, the sync should write it.
- Some bookings have empty `time_label`; the app can use `reservation_time`, but `time_label` should still be normalized for display.

## Optimization Priority

1. Normalize dates at sync time.
   - Store `last_visit_date` as `YYYY-MM-DD` or `YYYY-MM-DD HH:mm`.
   - If Meiguanjia only displays relative text, convert it during sync and optionally store the original in `last_visit_label`.

2. Fill `service_history`.
   - For each customer, store recent visit/consumption rows, not only totals.
   - Recommended shape:

```json
{
  "date": "2026-06-26",
  "time": "14:30",
  "shop": "自由手艺人",
  "barber": "无名",
  "service": "剪发/护理",
  "amount": 380,
  "order_id": "source-id"
}
```

3. Improve package/card sync.
   - `card_packages` should include active packages even when card balance is zero.
   - Recommended shape:

```json
{
  "id": "source-package-id",
  "name": "健康染套餐三次",
  "left": 2,
  "total": 3,
  "used": 1,
  "shop": "自由手艺人",
  "expire_date": "2026-12-31",
  "status": "active"
}
```

4. Improve booking sync quality.
   - Always write normalized phone when available.
   - Always write `reservation_time` and derive `time_label`.
   - Map Meiguanjia status numbers to a readable status label in an additional field, while preserving original status.
   - Keep stable Meiguanjia appointment id as `id` to avoid duplicate rows.

5. Add sync metadata.
   - Add or preserve fields such as `last_updated`, `source`, `source_id`, `sync_error`, `raw_hash`.
   - Do not delete old useful data during partial sync. If one Meiguanjia endpoint fails, keep existing `card_packages` and `service_history`.

## Frontend Changes Already Made

- v316: booking cache is now separated by shop, date, and barber.
- v316: booking DOM refresh signature includes phone and reservation time.
- v316: customer archive loads up to 1000 `customer_profiles` rows instead of 500 to reduce missing package data.

## Do Not Do

- Do not guess endpoint fields without checking the logged-in Meiguanjia Network requests.
- Do not overwrite `card_packages` with `[]` just because one fetch failed.
- Do not store relative times as the only visit date.
- Do not publish without `node scripts/check-version-sync.js` and `node scripts/smoke-test-app.js`.
