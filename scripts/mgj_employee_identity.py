"""Resolve MGJ bill allocations using the source employee namespace.

empfees.empid references empList.empId. Generic id/employeeId can be zero
placeholders; they are fallback aliases only when empId is absent.
"""


class EmployeeIdentityError(ValueError):
    pass


def employee_key(value):
    if isinstance(value, bool) or value is None:
        return None
    if not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
    return text if text and text != "0" else None


def employee_index(employees):
    if not isinstance(employees, list):
        raise EmployeeIdentityError("employee_list_missing")
    primary, fallback = {}, {}
    for row in employees:
        if not isinstance(row, dict):
            raise EmployeeIdentityError("invalid_employee_row")
        key = employee_key(row.get("empId"))
        if key:
            if key in primary and primary[key] != row:
                raise EmployeeIdentityError("employee_id_alias_conflict")
            primary[key] = row
            continue
        for field in ("id", "employeeId"):
            key = employee_key(row.get(field))
            if not key:
                continue
            if key in fallback and fallback[key] != row:
                raise EmployeeIdentityError("employee_id_alias_conflict")
            fallback[key] = row
    # A fallback cannot silently replace another employee's verified primary ID.
    for key, row in fallback.items():
        if key in primary and primary[key] != row:
            raise EmployeeIdentityError("employee_id_alias_conflict")
    return {**fallback, **primary}
