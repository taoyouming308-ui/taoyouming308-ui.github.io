"""Pure, private business-detail contract shared by frontdesk and daily reports.

No network, database writes, revenue classification or financial confirmation.
The output contains employee identifiers and must only enter private storage.
Unknown monetary fields remain null; allocations are never added to revenue.
"""
import hashlib
import json
from decimal import Decimal, InvalidOperation

try:
    from scripts import audit_mgj_daily_report_source as audit
    from scripts.mgj_employee_identity import employee_index, employee_key
except ModuleNotFoundError:
    import audit_mgj_daily_report_source as audit
    from mgj_employee_identity import employee_index, employee_key

CONTRACT_VERSION = "mgj-business-detail-v1"
EXCLUDED_REPORT_FIELDS = ["payment.public_card", "payment.public_qr",
                          "payment.private_card", "payment.private_qr"]


def money_cents(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError("invalid_money")
    try:
        amount = Decimal(str(value)) * 100
    except InvalidOperation:
        raise ValueError("invalid_money") from None
    if not amount.is_finite() or amount != amount.to_integral_value() or abs(amount) > 9007199254740991:
        raise ValueError("invalid_money")
    return int(amount)


def text(value):
    return value.strip()[:200] if isinstance(value, str) else ""


def rows(content, field, gaps):
    value = content.get(field)
    if value is None:
        gaps.add(field + "_missing")
        return []
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ValueError("invalid_" + field)
    return value


def normalize_bill(content, *, bill_id, shop, day):
    """Validate source scope and return independent payments/items/allocations.

    Source status/type remain raw: their finality and financial classifications
    need a verified, versioned mapping before this can fill a report.
    """
    shop = audit.validate_shop(shop)
    day = audit.validate_day(day)
    if not isinstance(content, dict):
        raise ValueError("invalid_bill")
    audit.verify_bill_scope(content, bill_id, shop, day)
    gaps = {"report_category_mapping_pending", "bill_status_mapping_pending",
            "payment_classification_pending", "full_business_scope_pending"}
    staff = employee_index(rows(content, "empList", gaps))
    items, item_ids = [], set()
    for row in rows(content, "details", gaps):
        key = employee_key(row.get("id"))
        if not key or key in item_ids:
            raise ValueError("invalid_or_duplicate_item_id")
        item_ids.add(key)
        items.append({"source_item_id": key, "item_code": text(row.get("itemno")),
                      "item_name": text(row.get("itemname")),
                      "source_category_code": text(row.get("depcode")),
                      "source_category_name": text(row.get("depcodename")),
                      "source_type": audit.safe_scalar(row.get("type")),
                      "quantity": audit.safe_amount(row.get("num")),
                      "amount_cents": money_cents(row.get("money")),
                      "unit_price_cents": money_cents(row.get("price"))})
    allocations, allocation_ids = [], set()
    for row in rows(content, "empfees", gaps):
        key = employee_key(row.get("id"))
        if not key or key in allocation_ids:
            raise ValueError("invalid_or_duplicate_allocation_id")
        allocation_ids.add(key)
        empid = employee_key(row.get("empid"))
        item_id = employee_key(row.get("detailId"))
        employee = staff.get(empid)
        if employee is None:
            gaps.add("unresolved_employee")
        if item_id not in item_ids:
            gaps.add("unresolved_allocation_item")
        allocations.append({
            "source_allocation_id": key, "employee_id": empid, "source_item_id": item_id,
            "employee_name": text(row.get("empname")),
            "source_role": text((employee or {}).get("dutyname")),
            "performance_cents": money_cents(row.get("fee")),
            "cash_performance_cents": money_cents(row.get("cashFee")),
            "card_performance_cents": money_cents(row.get("cardFee")),
            "other_performance_cents": money_cents(row.get("otherFee")),
            "source_project_count": audit.safe_amount(row.get("projectCount")),
            "source_person_count": audit.safe_amount(row.get("personCount")),
        })
    paydetail = content.get("paydetail")
    if not isinstance(paydetail, dict):
        gaps.add("paydetail_missing")
        paydetail = {}
    configs = {}
    for row in rows(content, "payConfigs", gaps):
        key = text(row.get("field")).lower()
        label = text(row.get("fieldName"))
        if key in configs and configs[key] != label:
            raise ValueError("payment_config_conflict")
        configs[key] = label
    payments = []
    for field in sorted(audit.PAYDETAIL_NUMERIC_FIELDS):
        value = money_cents(paydetail.get(field))
        payments.append({"source_field": field, "source_label": configs.get(field.lower(), ""),
                         "amount_cents": value, "known": value is not None})
    if any(row["amount_cents"] is None for row in payments):
        gaps.add("payment_fields_missing")
    # New source fields cannot disappear silently after an upstream change.
    if set(paydetail) - audit.PAYDETAIL_NUMERIC_FIELDS:
        gaps.add("unrecognized_payment_fields")
    for group in (items, allocations, payments):
        if any(v < 0 for row in group for k, v in row.items()
               if k.endswith("_cents") and isinstance(v, int)):
            gaps.add("signed_adjustment_requires_review")
    if any(row["amount_cents"] is None for row in items):
        gaps.add("item_amount_missing")
    if any(row["performance_cents"] is None for row in allocations):
        gaps.add("employee_performance_missing")
    posted_amount = money_cents(content.get("eafee"))
    bill_amount = money_cents(content.get("money"))
    if posted_amount is None:
        gaps.add("posted_amount_missing")
    if any(value is not None and value < 0 for value in (posted_amount, bill_amount)):
        gaps.add("signed_adjustment_requires_review")
    result = {
        "contract_version": CONTRACT_VERSION, "shop_id": shop, "business_date": day,
        "source_bill_id": str(bill_id), "source_scope_verified": True,
        "source_type": audit.safe_scalar(content.get("type")),
        "source_status": audit.safe_scalar(content.get("status")),
        "source_posted_amount_cents": posted_amount,
        "source_bill_amount_cents": bill_amount,
        "items": sorted(items, key=lambda r: r["source_item_id"]),
        "payments": payments,
        "employee_allocations": sorted(allocations, key=lambda r: r["source_allocation_id"]),
        "gaps": sorted(gaps), "report_ready": False,
        "not_applicable_report_fields": EXCLUDED_REPORT_FIELDS[:],
    }
    encoded = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    # Hash is over this normalized projection, NOT a claim of a full raw snapshot.
    result["normalized_sha256"] = hashlib.sha256(encoded.encode()).hexdigest()
    return result


def inspection_summary(bill):
    """Safe for operator logs: no names, employee IDs, amounts or raw payload."""
    return {"contract_version": bill["contract_version"],
            "source_scope_verified": bill["source_scope_verified"],
            "item_count": len(bill["items"]),
            "employee_allocation_count": len(bill["employee_allocations"]),
            "resolved_employee_count": sum(bool(r["source_role"]) for r in bill["employee_allocations"]),
            "known_payment_field_count": sum(r["known"] for r in bill["payments"]),
            "gaps": bill["gaps"], "report_ready": bill["report_ready"]}


def known_sum(values):
    return None if any(value is None for value in values) else sum(values)


def build_day(bills, *, shop, day, expected_bill_ids):
    """Internal projection from a fully verified project-consumption ID list.

    The caller must supply IDs from the complete paginated source list, not
    infer that list from the detail responses. Missing detail remains a gap.
    Empty verified source lists may produce zero; missing pages may not call
    this function. It is not an unauthenticated ingestion/validation boundary.
    """
    shop = audit.validate_shop(shop)
    day = audit.validate_day(day)
    expected = [str(value) for value in expected_bill_ids]
    if len(set(expected)) != len(expected) or any(not value.isdigit() for value in expected):
        raise ValueError("invalid_expected_bill_ids")
    seen, gaps, employees, payments = set(), set(), {}, {}
    for bill in bills:
        if (bill.get("contract_version") != CONTRACT_VERSION or bill.get("shop_id") != shop
                or bill.get("business_date") != day or bill.get("source_scope_verified") is not True):
            raise ValueError("bill_scope_mismatch")
        key = bill["source_bill_id"]
        if key in seen or key not in expected:
            raise ValueError("duplicate_or_unexpected_bill")
        seen.add(key)
        gaps.update(bill["gaps"])
        for row in bill["employee_allocations"]:
            if row["employee_id"] is None:
                continue
            group_key = (row["employee_id"], row["source_role"])
            group = employees.setdefault(group_key, {"employee_id": row["employee_id"],
                                                     "source_role": row["source_role"],
                                                     "amounts": [], "allocation_count": 0})
            group["amounts"].append(row["performance_cents"])
            group["allocation_count"] += 1
        for row in bill["payments"]:
            group = payments.setdefault(row["source_field"], {"source_field": row["source_field"],
                                                               "labels": set(), "amounts": []})
            if row["source_label"]:
                group["labels"].add(row["source_label"])
            group["amounts"].append(row["amount_cents"])
    complete = seen == set(expected)
    if not complete:
        gaps.add("bill_details_incomplete")
    employee_rows = []
    for key in sorted(employees):
        group = employees[key]
        employee_rows.append({"employee_id": group["employee_id"], "source_role": group["source_role"],
                              "allocation_count": group["allocation_count"],
                              "observed_performance_cents": known_sum(group["amounts"])})
    payment_rows = []
    for key in sorted(payments):
        group = payments[key]
        if len(group["labels"]) > 1:
            gaps.add("payment_label_changed")
        payment_rows.append({"source_field": key, "source_labels": sorted(group["labels"]),
                             "observed_amount_cents": known_sum(group["amounts"])})
    # Project-consumption scope never claims complete retail/top-up/card-sales revenue.
    gaps.add("full_business_scope_pending")
    return {"contract_version": CONTRACT_VERSION, "shop_id": shop, "business_date": day,
            "source_scope": "project_consumption", "expected_bill_count": len(expected),
            "loaded_bill_count": len(seen), "details_complete": complete,
            "missing_bill_ids": sorted(set(expected) - seen),
            "source_posted_amount_cents": known_sum([b["source_posted_amount_cents"] for b in bills]) if complete else None,
            "employees": employee_rows, "payments": payment_rows,
            "report_ready": False, "gaps": sorted(gaps)}
