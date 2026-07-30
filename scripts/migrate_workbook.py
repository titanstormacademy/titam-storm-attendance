import argparse
import json
import mimetypes
import os
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

import openpyxl

from validate_workbook import clean, date_value, key, load_sheet, time_value

SHEETS = [
    "Config",
    "Branches",
    "Students",
    "Coaches",
    "Classes",
    "Sessions",
    "Enrollments",
    "Attendance",
    "Payments",
    "CoachPayments",
    "CoachAttendance",
]


def decimal_value(value, default=None):
    value = clean(value)
    if value == "":
        return default
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return default


def integer_value(value, default=None):
    value = key(value)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def timestamp_value(value):
    value = clean(value)
    if value == "":
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, time()).isoformat()
    return str(value).strip()


def month_value(value):
    normalized = date_value(value)
    if not normalized:
        return ""
    return f"{normalized[:7]}-01"


def repaired_class_times(row, duration_by_class):
    start = time_value(row.get("StartTime")) or None
    end = time_value(row.get("EndTime")) or None
    repaired = False
    if start and end and end <= start:
        duration = duration_by_class.get(integer_value(row.get("ID")))
        if duration and duration > 0:
            start_datetime = datetime.combine(date.today(), time.fromisoformat(start))
            end = (start_datetime + timedelta(hours=duration)).time().strftime("%H:%M:%S")
            repaired = True
    return start, end, repaired


def load_rows(path):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    missing = [sheet for sheet in SHEETS if sheet not in workbook.sheetnames]
    if missing:
        raise ValueError(f"Missing worksheets: {', '.join(missing)}")
    return {sheet: load_sheet(workbook, sheet) for sheet in SHEETS}


def infer_enrollment_maps(rows):
    branch_name_to_id = {}
    for row in rows["Branches"]:
        name = key(row.get("Name")).casefold()
        if name:
            branch_name_to_id[name] = integer_value(row.get("ID"))

    numeric_classes_by_student = defaultdict(set)
    students_by_legacy_class = defaultdict(set)
    for row in rows["Enrollments"]:
        student_id = integer_value(row.get("StudentID"))
        class_id = key(row.get("ClassID"))
        if not student_id or not class_id:
            continue
        if class_id.isdigit():
            numeric_classes_by_student[student_id].add(int(class_id))
        else:
            students_by_legacy_class[class_id].add(student_id)

    class_map = {}
    unresolved = []
    for legacy_class, student_ids in students_by_legacy_class.items():
        candidate_sets = [numeric_classes_by_student[student_id] for student_id in student_ids if numeric_classes_by_student[student_id]]
        candidates = set.intersection(*candidate_sets) if candidate_sets else set()
        if len(candidates) == 1:
            class_map[legacy_class] = next(iter(candidates))
        else:
            unresolved.append({"legacyClass": legacy_class, "candidateCount": len(candidates), "studentCount": len(student_ids)})

    branch_map = {}
    for row in rows["Enrollments"]:
        branch_id = key(row.get("BranchID"))
        if branch_id and not branch_id.isdigit():
            mapped = branch_name_to_id.get(key(row.get("BranchName")).casefold())
            if mapped:
                branch_map[branch_id] = mapped

    return class_map, branch_map, unresolved


def transform_enrollments(rows, class_map, branch_map):
    students = {integer_value(row.get("ID")): integer_value(row.get("BranchID")) for row in rows["Students"]}
    classes = {integer_value(row.get("ID")): integer_value(row.get("BranchID")) for row in rows["Classes"]}
    deduplicated = {}
    repairs = {"classIdsRemapped": 0, "branchIdsRemapped": 0, "duplicatesRemoved": 0, "idsRegenerated": 0}
    errors = []

    for row in rows["Enrollments"]:
        student_id = integer_value(row.get("StudentID"))
        raw_class = key(row.get("ClassID"))
        class_id = int(raw_class) if raw_class.isdigit() else class_map.get(raw_class)
        raw_branch = key(row.get("BranchID"))
        branch_id = int(raw_branch) if raw_branch.isdigit() else branch_map.get(raw_branch)
        if raw_class and not raw_class.isdigit() and class_id:
            repairs["classIdsRemapped"] += 1
        if raw_branch and not raw_branch.isdigit() and branch_id:
            repairs["branchIdsRemapped"] += 1
        if not student_id or student_id not in students:
            errors.append({"row": row["_row"], "detail": "StudentID cannot be resolved"})
            continue
        if not class_id or class_id not in classes:
            errors.append({"row": row["_row"], "detail": "ClassID cannot be resolved"})
            continue
        expected_branch = students[student_id]
        if classes[class_id] != expected_branch:
            errors.append({"row": row["_row"], "detail": "Student and class belong to different branches"})
            continue
        if branch_id and branch_id != expected_branch:
            repairs["branchIdsRemapped"] += 1
        pair = (student_id, class_id)
        start_date = date_value(row.get("StartDate")) or date.today().isoformat()
        if pair in deduplicated:
            repairs["duplicatesRemoved"] += 1
            if start_date < deduplicated[pair]["start_date"]:
                deduplicated[pair]["start_date"] = start_date
            continue
        deduplicated[pair] = {
            "student_id": student_id,
            "class_id": class_id,
            "branch_id": expected_branch,
            "start_date": start_date,
        }

    transformed = []
    for new_id, item in enumerate(deduplicated.values(), start=1):
        transformed.append({"id": new_id, **item})
    repairs["idsRegenerated"] = len(transformed)
    return transformed, repairs, errors


def transform(path):
    rows = load_rows(path)
    class_map, branch_map, unresolved = infer_enrollment_maps(rows)
    enrollments, enrollment_repairs, enrollment_errors = transform_enrollments(rows, class_map, branch_map)
    coaches_by_id = {integer_value(row.get("ID")): key(row.get("CoachType")) or "Head" for row in rows["Coaches"]}
    durations = defaultdict(list)
    for row in rows["CoachAttendance"]:
        class_id = integer_value(row.get("ClassID"))
        hours = decimal_value(row.get("Hours"))
        if class_id and hours and hours > 0:
            durations[class_id].append(hours)
    duration_by_class = {class_id: Counter(values).most_common(1)[0][0] for class_id, values in durations.items()}
    transformed_classes = []
    class_time_repairs = 0
    for row in rows["Classes"]:
        start_time, end_time, repaired = repaired_class_times(row, duration_by_class)
        class_time_repairs += int(repaired)
        transformed_classes.append({
            "id": integer_value(row.get("ID")),
            "branch_id": integer_value(row.get("BranchID")),
            "label": key(row.get("Label")),
            "day_of_week": key(row.get("DayOfWeek")),
            "start_time": start_time,
            "end_time": end_time,
            "coach_id": integer_value(row.get("CoachID")),
        })

    tables = {
        "branches": [{
            "id": integer_value(row.get("ID")),
            "name": key(row.get("Name")),
            "subtitle": key(row.get("Subtitle")),
            "status": key(row.get("Status")) or "Active",
            "created_at": timestamp_value(row.get("CreatedAt")),
        } for row in rows["Branches"]],
        "students": [{
            "id": integer_value(row.get("ID")),
            "branch_id": integer_value(row.get("BranchID")),
            "name": key(row.get("Name")),
            "nric": key(row.get("NRIC")),
            "gender": key(row.get("Gender")),
            "date_of_birth": date_value(row.get("DOB")) or None,
            "height": key(row.get("Height")),
            "school": key(row.get("School")),
            "tshirt_size": key(row.get("TShirtSize")),
            "student_phone": key(row.get("StudentPhone")),
            "parent_name": key(row.get("ParentName")),
            "parent_contact": key(row.get("ParentContact")),
            "email": key(row.get("Email")),
            "father_height": key(row.get("FatherHeight")),
            "mother_height": key(row.get("MotherHeight")),
            "monthly_fee": decimal_value(row.get("MonthlyFee")),
            "level": key(row.get("Level")),
            "status": key(row.get("Status")) or "Active",
            "photo_path": None,
            "created_at": timestamp_value(row.get("CreatedAt")),
            "_asset_url": key(row.get("PhotoURL")),
        } for row in rows["Students"]],
        "coaches": [{
            "id": integer_value(row.get("ID")),
            "branch_id": integer_value(row.get("BranchID")),
            "name": key(row.get("Name")),
            "phone": key(row.get("Phone")),
            "coach_type": key(row.get("CoachType")) or "Head",
            "hourly_rate": decimal_value(row.get("HourlyRate"), 0),
            "status": key(row.get("Status")) or "Active",
            "photo_path": None,
            "created_at": timestamp_value(row.get("CreatedAt")),
            "_asset_url": key(row.get("PhotoURL")),
        } for row in rows["Coaches"]],
        "classes": transformed_classes,
        "sessions": [{
            "id": integer_value(row.get("ID")),
            "branch_id": integer_value(row.get("BranchID")),
            "class_id": integer_value(row.get("ClassID")),
            "session_date": date_value(row.get("Date")),
            "notes": key(row.get("Notes")),
            "coach_id": integer_value(row.get("CoachID")),
        } for row in rows["Sessions"]],
        "enrollments": enrollments,
        "attendance": [{
            "student_id": integer_value(row.get("StudentID")),
            "session_id": integer_value(row.get("SessionID")),
            "class_id": integer_value(row.get("ClassID")),
            "branch_id": integer_value(row.get("BranchID")),
            "attendance_date": date_value(row.get("Date")),
            "status": "Present" if key(row.get("Status")) == "Present" else "",
            "remarks": key(row.get("Remarks")),
        } for row in rows["Attendance"]],
        "coach_payments": [{
            "id": integer_value(row.get("ID")),
            "branch_id": integer_value(row.get("BranchID")),
            "coach_id": integer_value(row.get("CoachID")),
            "payout_type": coaches_by_id.get(integer_value(row.get("CoachID")), "Head"),
            "amount": decimal_value(row.get("Amount"), 0),
            "units": decimal_value(row.get("Units"), 0),
            "rate": decimal_value(row.get("Rate"), 0),
            "students_count": integer_value(row.get("StudentsCount"), 0),
            "date_paid": date_value(row.get("DatePaid")),
            "remarks": key(row.get("Remarks")),
        } for row in rows["CoachPayments"]],
        "payments": [{
            "id": integer_value(row.get("ID")),
            "branch_id": integer_value(row.get("BranchID")),
            "student_id": integer_value(row.get("StudentID")),
            "fee_month": month_value(row.get("FeeMonth")),
            "amount": decimal_value(row.get("Amount"), 0),
            "method": key(row.get("Method")) or None,
            "status": key(row.get("Status")) or "Paid",
            "date_received": date_value(row.get("DateReceived")) or None,
            "remarks": key(row.get("Remarks")),
            "reference_no": key(row.get("ReferenceNo")),
            "coach_id": integer_value(row.get("CoachID")),
            "commission_settled": key(row.get("CommissionSettled")).casefold() == "yes",
            "coach_payment_id": integer_value(row.get("CoachPaymentID")),
            "receipt_path": None,
            "_asset_url": key(row.get("ReceiptURL")),
        } for row in rows["Payments"]],
        "coach_attendance": [{
            "id": integer_value(row.get("ID")),
            "branch_id": integer_value(row.get("BranchID")),
            "session_id": integer_value(row.get("SessionID")),
            "class_id": integer_value(row.get("ClassID")),
            "attendance_date": date_value(row.get("Date")),
            "coach_id": integer_value(row.get("CoachID")),
            "hours": decimal_value(row.get("Hours"), 0),
        } for row in rows["CoachAttendance"]],
    }

    config = {key(row.get("Key")): row.get("Value") for row in rows["Config"]}
    rates = []
    if config.get("HeadCoachRates"):
        try:
            parsed = json.loads(str(config["HeadCoachRates"]))
            rates = [{
                "min_students": integer_value(item.get("minStudents"), 0),
                "max_students": integer_value(item.get("maxStudents"), 0),
                "min_fee": decimal_value(item.get("minFee"), 0),
                "max_fee": decimal_value(item.get("maxFee"), 0),
                "payout": decimal_value(item.get("payout"), 0),
            } for item in parsed]
        except (TypeError, ValueError, json.JSONDecodeError):
            pass

    settings = {
        "academy_name": "Titan Storm Basketball Academy",
        "default_branch_id": integer_value(config.get("DefaultBranchID"), 1),
        "logo_path": None,
        "_asset_url": key(config.get("LogoURL")),
    }

    return {
        "tables": tables,
        "rates": rates,
        "settings": settings,
        "sourceCounts": {name: len(sheet_rows) for name, sheet_rows in rows.items()},
        "targetCounts": {name: len(table_rows) for name, table_rows in tables.items()},
        "repairs": {
            "legacyClassMappings": len(class_map),
            "legacyBranchMappings": len(branch_map),
            "classTimesRepaired": class_time_repairs,
            **enrollment_repairs,
        },
        "unresolved": unresolved + enrollment_errors,
        "warnings": [
            warning for warning in [
                "Payments worksheet is empty" if not rows["Payments"] else "",
                "CoachPayments worksheet is empty" if not rows["CoachPayments"] else "",
                "AdminPassword is intentionally excluded" if config.get("AdminPassword") else "",
            ] if warning
        ],
    }


def summary(result, workbook):
    return {
        "workbook": workbook.name,
        "sourceCounts": result["sourceCounts"],
        "targetCounts": result["targetCounts"],
        "repairs": result["repairs"],
        "unresolved": result["unresolved"],
        "warnings": result["warnings"],
        "ready": not result["unresolved"],
    }


def load_environment(path):
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            name, value = stripped.split("=", 1)
            values[name.strip()] = value.strip().strip('"').strip("'")
    return values


def request_json(base_url, secret, method, endpoint, payload=None, extra_headers=None):
    headers = {
        "apikey": secret,
        "Authorization": f"Bearer {secret}",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    body = None
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(f"{base_url.rstrip('/')}{endpoint}", data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=180) as response:
            content = response.read()
            return json.loads(content) if content else None
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"Supabase request failed ({error.code}) for {endpoint}: {detail}") from error


def require_import_rpc(base_url, secret):
    spec = request_json(base_url, secret, "GET", "/rest/v1/", extra_headers={"Accept": "application/openapi+json"})
    if "/rpc/replace_legacy_data" not in (spec or {}).get("paths", {}):
        raise RuntimeError("Required RPC is missing. Run supabase/migrations/202607300003_legacy_import.sql first.")


def backup_live_data(base_url, secret, output_dir):
    tables = [
        "branches",
        "academy_settings",
        "head_coach_rates",
        "students",
        "coaches",
        "classes",
        "sessions",
        "enrollments",
        "attendance",
        "payments",
        "coach_payments",
        "coach_payment_lines",
        "coach_attendance",
    ]
    backup = {}
    for table in tables:
        backup[table] = request_json(base_url, secret, "GET", f"/rest/v1/{table}?select=*") or []
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = output_dir / f"pre-import-{stamp}.json"
    path.write_text(json.dumps(backup, indent=2, default=str), encoding="utf-8")
    return path


def asset_extension(content_type, source_url):
    content_type = (content_type or "").split(";", 1)[0].lower()
    known = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
    return known.get(content_type) or mimetypes.guess_extension(content_type) or Path(source_url.split("?", 1)[0]).suffix or ".jpg"


def migrate_asset(base_url, secret, bucket, path_prefix, source_url):
    source_request = Request(source_url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(source_request, timeout=60) as response:
        content = response.read(5_242_881)
        content_type = response.headers.get_content_type()
    if len(content) > 5_242_880:
        raise RuntimeError("asset exceeds the 5 MB storage limit")
    if not content_type.startswith("image/"):
        raise RuntimeError(f"asset returned unsupported content type {content_type}")
    extension = asset_extension(content_type, source_url)
    object_path = f"{path_prefix}/legacy{extension}"
    endpoint = f"/storage/v1/object/{quote(bucket, safe='')}/{quote(object_path, safe='/')}"
    request = Request(
        f"{base_url.rstrip('/')}{endpoint}",
        data=content,
        headers={
            "apikey": secret,
            "Authorization": f"Bearer {secret}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=120):
            return object_path
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"storage upload failed ({error.code}): {detail}") from error


def migrate_assets(result, base_url, secret):
    failures = []
    migrated = {"studentPhotos": 0, "coachPhotos": 0, "academyLogo": 0}
    for student in result["tables"]["students"]:
        source_url = student.pop("_asset_url", "")
        if not source_url:
            continue
        try:
            student["photo_path"] = migrate_asset(base_url, secret, "student-photos", f"{student['branch_id']}/{student['id']}", source_url)
            migrated["studentPhotos"] += 1
        except Exception as error:
            failures.append({"entity": "student", "id": student["id"], "error": str(error)})
    for coach in result["tables"]["coaches"]:
        source_url = coach.pop("_asset_url", "")
        if not source_url:
            continue
        try:
            coach["photo_path"] = migrate_asset(base_url, secret, "coach-photos", f"{coach['branch_id']}/{coach['id']}", source_url)
            migrated["coachPhotos"] += 1
        except Exception as error:
            failures.append({"entity": "coach", "id": coach["id"], "error": str(error)})
    for payment in result["tables"]["payments"]:
        payment.pop("_asset_url", None)
    logo_url = result["settings"].pop("_asset_url", "")
    if logo_url:
        try:
            result["settings"]["logo_path"] = migrate_asset(base_url, secret, "academy-assets", "legacy", logo_url)
            migrated["academyLogo"] = 1
        except Exception as error:
            failures.append({"entity": "academyLogo", "id": 0, "error": str(error)})
    return migrated, failures


def import_payload(result):
    payload = {name: rows for name, rows in result["tables"].items()}
    payload["branch_ids"] = [row["id"] for row in result["tables"]["branches"]]
    payload["head_coach_rates"] = result["rates"]
    payload["settings"] = result["settings"]
    return payload


def apply_import(result, env_path, backup_dir, migrate_photos):
    environment = {**load_environment(env_path), **os.environ}
    base_url = environment.get("SUPABASE_URL", "").strip()
    secret = environment.get("SUPABASE_SECRET_KEY", "").strip()
    if not base_url or not secret:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured in the migration environment file")
    if "sb_publishable_" in secret:
        raise RuntimeError("A Supabase secret key is required; the publishable key cannot replace live data")
    require_import_rpc(base_url, secret)
    backup_path = backup_live_data(base_url, secret, backup_dir)
    asset_result = {"studentPhotos": 0, "coachPhotos": 0, "academyLogo": 0}
    asset_failures = []
    if migrate_photos:
        asset_result, asset_failures = migrate_assets(result, base_url, secret)
    else:
        for rows in result["tables"].values():
            for row in rows:
                row.pop("_asset_url", None)
        result["settings"].pop("_asset_url", None)
    database_result = request_json(base_url, secret, "POST", "/rest/v1/rpc/replace_legacy_data", {"p_payload": import_payload(result)})
    return {
        "backup": str(backup_path),
        "database": database_result,
        "assets": asset_result,
        "assetFailures": asset_failures,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-replace-operational-data", action="store_true")
    parser.add_argument("--migrate-photos", action="store_true")
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parents[1] / ".env.migration.local")
    parser.add_argument("--backup-dir", type=Path, default=Path(__file__).resolve().parents[1] / ".migration-backups")
    args = parser.parse_args()
    result = transform(args.workbook)
    report = summary(result, args.workbook)
    if args.apply:
        if not report["ready"]:
            raise RuntimeError("The transformed workbook still has unresolved issues")
        if not args.confirm_replace_operational_data:
            raise RuntimeError("Live replacement requires --confirm-replace-operational-data")
        applied = apply_import(result, args.env_file, args.backup_dir, args.migrate_photos)
        print(json.dumps(applied, indent=2, default=str))
        raise SystemExit(0)
    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        print(f"Workbook: {report['workbook']}")
        print("Target rows:")
        for table, count in report["targetCounts"].items():
            print(f"  {table}: {count}")
        print("Automatic repairs:")
        for name, count in report["repairs"].items():
            print(f"  {name}: {count}")
        print(f"Unresolved issues: {len(report['unresolved'])}")
        for issue in report["unresolved"]:
            print(f"  {issue}")
        for warning in report["warnings"]:
            print(f"Warning: {warning}")
        print(f"Ready for import confirmation: {'yes' if report['ready'] else 'no'}")
    raise SystemExit(0 if report["ready"] else 1)


if __name__ == "__main__":
    main()
