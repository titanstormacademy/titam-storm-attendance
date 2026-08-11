import argparse
import copy
import hashlib
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from migrate_workbook import load_environment, request_json, transform

TABLES = [
    "branches",
    "students",
    "coaches",
    "classes",
    "sessions",
    "enrollments",
    "coach_payments",
    "payments",
    "attendance",
    "coach_attendance",
]
BACKUP_TABLES = [
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
PAGE_SIZE = 1000


def normalized(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    return str(value).strip()


def same(left, right, fields):
    return all(normalized(left.get(field)) == normalized(right.get(field)) for field in fields)


def fetch_all(base_url, secret, table):
    rows = []
    offset = 0
    while True:
        page = request_json(
            base_url,
            secret,
            "GET",
            f"/rest/v1/{quote(table)}?select=*",
            extra_headers={"Range-Unit": "items", "Range": f"{offset}-{offset + PAGE_SIZE - 1}"},
        ) or []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def insert_row(base_url, secret, table, row):
    result = request_json(
        base_url,
        secret,
        "POST",
        f"/rest/v1/{quote(table)}",
        row,
        extra_headers={"Prefer": "return=representation"},
    ) or []
    if not result:
        raise RuntimeError(f"No inserted row returned for {table}")
    return result[0]


def workbook_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup_live(base_url, secret, output_dir):
    payload = {table: fetch_all(base_url, secret, table) for table in BACKUP_TABLES}
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = output_dir / f"pre-append-{stamp}.json"
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return path


def clean_rows(result):
    tables = copy.deepcopy(result["tables"])
    for rows in tables.values():
        for row in rows:
            row.pop("_asset_url", None)
    return tables


class AppendPlan:
    def __init__(self, current, incoming):
        self.current = current
        self.incoming = incoming
        self.maps = {table: {} for table in TABLES}
        self.new = {table: [] for table in TABLES}
        self.existing = {table: [] for table in TABLES}
        self.differences = []
        self.id_collisions = []
        self.conflicts = []
        self.indexes = {
            table: {int(row["id"]): row for row in rows if row.get("id") is not None}
            for table, rows in current.items()
            if table not in {"attendance"}
        }

    def map_existing(self, table, source_id, target, source, fields):
        self.maps[table][int(source_id)] = int(target["id"])
        self.existing[table].append(source)
        changed = [field for field in fields if normalized(source.get(field)) != normalized(target.get(field))]
        if changed:
            self.differences.append({"table": table, "sourceId": source_id, "targetId": target["id"], "fields": changed})

    def plan_entity(self, table, identity_fields, compare_fields, natural_key=None, candidate_match=None):
        current_rows = self.current[table]
        natural = {}
        if natural_key:
            for row in current_rows:
                key = natural_key(row)
                if key is not None:
                    natural.setdefault(key, []).append(row)
        for source in self.incoming[table]:
            source_id = int(source["id"])
            candidate = self.indexes[table].get(source_id)
            if candidate and (same(source, candidate, identity_fields) or (candidate_match and candidate_match(source, candidate))):
                self.map_existing(table, source_id, candidate, source, compare_fields)
                continue
            matches = natural.get(natural_key(source), []) if natural_key else []
            match = matches[0] if len(matches) == 1 else self.disambiguate_student(source, matches) if table == "students" else None
            if match:
                self.map_existing(table, source_id, match, source, compare_fields)
                if candidate and int(candidate["id"]) != int(match["id"]):
                    self.id_collisions.append({"table": table, "sourceId": source_id, "matchedTargetId": match["id"], "occupiedTargetId": candidate["id"]})
                continue
            if len(matches) > 1:
                self.conflicts.append({"table": table, "sourceId": source_id, "reason": "natural identity matches multiple live records"})
                continue
            if candidate:
                self.id_collisions.append({"table": table, "sourceId": source_id, "reason": "source ID is occupied by a different live record; a generated ID will be used"})
            self.new[table].append(source)

    def mapped(self, table, source_id):
        return self.maps[table].get(int(source_id))

    def remap_parent(self, table, source_id):
        mapped = self.mapped(table, source_id)
        if mapped is not None:
            return mapped
        if any(int(row["id"]) == int(source_id) for row in self.new[table]):
            return None
        self.conflicts.append({"table": table, "sourceId": source_id, "reason": "referenced parent is neither existing nor insertable"})
        return None

    def plan(self):
        self.plan_entity("branches", ["name"], ["name", "subtitle", "status"], lambda row: normalized(row.get("name")).casefold())
        self.remap_branches()
        self.plan_entity("students", ["branch_id", "name"], ["branch_id", "name", "nric", "gender", "date_of_birth", "height", "school", "tshirt_size", "student_phone", "parent_name", "parent_contact", "email", "father_height", "mother_height", "monthly_fee", "level", "status"], self.student_key, self.student_candidate_match)
        self.plan_entity("coaches", ["branch_id", "name"], ["branch_id", "name", "phone", "coach_type", "hourly_rate", "status"], self.coach_key)
        self.remap_classes()
        self.plan_entity("classes", ["branch_id", "label", "day_of_week"], ["branch_id", "label", "day_of_week", "start_time", "end_time", "coach_id"], self.class_key)
        self.remap_sessions()
        self.plan_entity("sessions", ["class_id", "session_date"], ["branch_id", "class_id", "session_date", "notes", "coach_id"], self.session_key)
        self.plan_enrollments()
        self.remap_coach_payments()
        self.plan_entity("coach_payments", ["coach_id", "payout_type", "date_paid"], ["branch_id", "coach_id", "payout_type", "pay_month", "amount", "units", "rate", "students_count", "date_paid", "remarks"], self.coach_payment_key)
        self.remap_payments()
        self.plan_entity("payments", ["student_id", "fee_month", "amount", "status"], ["branch_id", "student_id", "fee_month", "amount", "method", "status", "date_received", "remarks", "reference_no", "coach_id", "commission_settled", "coach_payment_id"], self.payment_key)
        self.plan_attendance()
        self.plan_coach_attendance()
        return self

    @staticmethod
    def remember_remap(row, field, mapped):
        row.setdefault(f"_source_{field}", row[field])
        row[field] = mapped

    def remap_branches(self):
        for table in ["students", "coaches", "classes", "sessions", "enrollments", "coach_payments", "payments", "attendance", "coach_attendance"]:
            for row in self.incoming[table]:
                mapped = self.mapped("branches", row["branch_id"])
                if mapped is not None:
                    self.remember_remap(row, "branch_id", mapped)

    def student_key(self, row):
        return (row.get("branch_id"), self.name_key(row.get("name")))

    def student_candidate_match(self, source, target):
        if source.get("branch_id") != target.get("branch_id"):
            return False
        source_name = self.name_key(source.get("name"))
        target_name = self.name_key(target.get("name"))
        return min(len(source_name), len(target_name)) >= 4 and (source_name in target_name or target_name in source_name or self.edit_distance(source_name, target_name) <= 1)

    @staticmethod
    def disambiguate_student(source, matches):
        fields = ["nric", "student_phone", "parent_contact", "date_of_birth", "status"]
        scored = []
        for match in matches:
            score = sum(1 for field in fields if normalized(source.get(field)) not in {None, ""} and normalized(source.get(field)) == normalized(match.get(field)))
            mismatches = sum(1 for field in fields if normalized(source.get(field)) not in {None, ""} and normalized(match.get(field)) not in {None, ""} and normalized(source.get(field)) != normalized(match.get(field)))
            scored.append((score - mismatches, match))
        scored.sort(key=lambda item: item[0], reverse=True)
        return scored[0][1] if scored and (len(scored) == 1 or scored[0][0] > scored[1][0]) else None

    def coach_key(self, row):
        return (row.get("branch_id"), self.name_key(row.get("name")))

    @staticmethod
    def name_key(value):
        return "".join(character for character in normalized(value).casefold() if character.isalnum())

    @staticmethod
    def edit_distance(left, right):
        previous = list(range(len(right) + 1))
        for left_index, left_character in enumerate(left, start=1):
            current = [left_index]
            for right_index, right_character in enumerate(right, start=1):
                current.append(min(current[-1] + 1, previous[right_index] + 1, previous[right_index - 1] + (left_character != right_character)))
            previous = current
        return previous[-1]

    def class_key(self, row):
        return (row.get("branch_id"), normalized(row.get("label")).casefold(), row.get("day_of_week"), normalized(row.get("start_time")))

    def session_key(self, row):
        return (row.get("class_id"), row.get("session_date"))

    def coach_payment_key(self, row):
        return (row.get("coach_id"), row.get("payout_type"), row.get("pay_month"), row.get("date_paid"))

    def payment_key(self, row):
        return (row.get("student_id"), row.get("fee_month"), normalized(row.get("amount")), row.get("status"), normalized(row.get("reference_no")))

    def remap_classes(self):
        for row in self.incoming["classes"]:
            if row.get("coach_id") is not None:
                mapped = self.mapped("coaches", row["coach_id"])
                if mapped is not None:
                    self.remember_remap(row, "coach_id", mapped)

    def remap_sessions(self):
        for row in self.incoming["sessions"]:
            mapped_class = self.mapped("classes", row["class_id"])
            if mapped_class is not None:
                self.remember_remap(row, "class_id", mapped_class)
            if row.get("coach_id") is not None:
                mapped_coach = self.mapped("coaches", row["coach_id"])
                if mapped_coach is not None:
                    self.remember_remap(row, "coach_id", mapped_coach)

    def plan_enrollments(self):
        current_by_pair = {}
        for row in self.current["enrollments"]:
            current_by_pair.setdefault((row["student_id"], row["class_id"]), []).append(row)
        for source in self.incoming["enrollments"]:
            student_id = self.mapped("students", source["student_id"])
            class_id = self.mapped("classes", source["class_id"])
            if student_id is None or class_id is None:
                student_available = student_id is not None or any(int(row["id"]) == int(source["student_id"]) for row in self.new["students"])
                class_available = class_id is not None or any(int(row["id"]) == int(source["class_id"]) for row in self.new["classes"])
                if not student_available or not class_available:
                    self.conflicts.append({"table": "enrollments", "sourceId": source["id"], "reason": "student or class mapping is unresolved"})
                self.new["enrollments"].append(source)
                continue
            self.remember_remap(source, "student_id", student_id)
            self.remember_remap(source, "class_id", class_id)
            matches = current_by_pair.get((student_id, class_id), [])
            if matches:
                active = next((row for row in matches if row.get("end_date") is None), None)
                exact = next((row for row in matches if row.get("start_date") == source.get("start_date")), None)
                target = active or exact or matches[-1]
                self.maps["enrollments"][int(source["id"])] = int(target["id"])
                self.existing["enrollments"].append(source)
                if target.get("start_date") != source.get("start_date"):
                    self.differences.append({"table": "enrollments", "sourceId": source["id"], "targetId": target["id"], "fields": ["start_date"]})
            else:
                self.new["enrollments"].append(source)

    def remap_coach_payments(self):
        for row in self.incoming["coach_payments"]:
            mapped = self.mapped("coaches", row["coach_id"])
            if mapped is not None:
                self.remember_remap(row, "coach_id", mapped)

    def remap_payments(self):
        for row in self.incoming["payments"]:
            mapped_student = self.mapped("students", row["student_id"])
            if mapped_student is not None:
                self.remember_remap(row, "student_id", mapped_student)
            if row.get("coach_id") is not None:
                mapped_coach = self.mapped("coaches", row["coach_id"])
                if mapped_coach is not None:
                    self.remember_remap(row, "coach_id", mapped_coach)
            if row.get("coach_payment_id") is not None:
                mapped_payout = self.mapped("coach_payments", row["coach_payment_id"])
                if mapped_payout is not None:
                    self.remember_remap(row, "coach_payment_id", mapped_payout)

    def plan_attendance(self):
        current = {(row["student_id"], row["session_id"]): row for row in self.current["attendance"]}
        for source in self.incoming["attendance"]:
            student_id = self.mapped("students", source["student_id"])
            session_id = self.mapped("sessions", source["session_id"])
            if student_id is None or session_id is None:
                self.new["attendance"].append(source)
                continue
            self.remember_remap(source, "student_id", student_id)
            self.remember_remap(source, "session_id", session_id)
            target = current.get((student_id, session_id))
            if target:
                self.existing["attendance"].append(source)
                changed = [field for field in ["status", "remarks"] if normalized(source.get(field)) != normalized(target.get(field))]
                if changed:
                    self.differences.append({"table": "attendance", "sourceKey": f"{source['student_id']}:{source['session_id']}", "fields": changed})
            else:
                self.new["attendance"].append(source)

    def plan_coach_attendance(self):
        current = {(row["session_id"], row["coach_id"]): row for row in self.current["coach_attendance"]}
        for source in self.incoming["coach_attendance"]:
            session_id = self.mapped("sessions", source["session_id"])
            coach_id = self.mapped("coaches", source["coach_id"])
            if session_id is None or coach_id is None:
                self.new["coach_attendance"].append(source)
                continue
            self.remember_remap(source, "session_id", session_id)
            self.remember_remap(source, "coach_id", coach_id)
            target = current.get((session_id, coach_id))
            if target:
                self.maps["coach_attendance"][int(source["id"])] = int(target["id"])
                self.existing["coach_attendance"].append(source)
                if normalized(source.get("hours")) != normalized(target.get("hours")):
                    self.differences.append({"table": "coach_attendance", "sourceId": source["id"], "targetId": target["id"], "fields": ["hours"]})
            else:
                self.new["coach_attendance"].append(source)

    def report(self):
        return {
            "insert": {table: len(rows) for table, rows in self.new.items()},
            "preserveExisting": {table: len(rows) for table, rows in self.existing.items()},
            "preservedDifferences": self.differences,
            "idCollisionsHandled": self.id_collisions,
            "conflicts": self.conflicts,
        }


def remap_new_row(plan, table, source):
    row = copy.deepcopy(source)
    source_id = int(row.pop("id")) if row.get("id") is not None else None
    parent_fields = {
        "students": [("branch_id", "branches")],
        "coaches": [("branch_id", "branches")],
        "classes": [("branch_id", "branches"), ("coach_id", "coaches")],
        "sessions": [("branch_id", "branches"), ("class_id", "classes"), ("coach_id", "coaches")],
        "enrollments": [("branch_id", "branches"), ("student_id", "students"), ("class_id", "classes")],
        "coach_payments": [("branch_id", "branches"), ("coach_id", "coaches")],
        "payments": [("branch_id", "branches"), ("student_id", "students"), ("coach_id", "coaches"), ("coach_payment_id", "coach_payments")],
        "attendance": [("branch_id", "branches"), ("student_id", "students"), ("session_id", "sessions"), ("class_id", "classes")],
        "coach_attendance": [("branch_id", "branches"), ("session_id", "sessions"), ("class_id", "classes"), ("coach_id", "coaches")],
    }
    for field, parent in parent_fields.get(table, []):
        if row.get(field) is None:
            continue
        value = int(row.pop(f"_source_{field}", row[field]))
        mapped = plan.maps[parent].get(value)
        if mapped is None:
            raise RuntimeError(f"Cannot append {table} source {source_id}: {field} mapping is missing")
        row[field] = mapped
    for field in ["created_at"]:
        if row.get(field) is None:
            row.pop(field, None)
    for field in [name for name in row if name.startswith("_source_")]:
        row.pop(field)
    return source_id, row


def apply_plan(plan, base_url, secret):
    inserted = {table: 0 for table in TABLES}
    for table in TABLES:
        for source in plan.new[table]:
            source_id, row = remap_new_row(plan, table, source)
            inserted_row = insert_row(base_url, secret, table, row)
            if source_id is not None and inserted_row.get("id") is not None:
                plan.maps[table][source_id] = int(inserted_row["id"])
            inserted[table] += 1
    return inserted


def verify(plan, base_url, secret):
    failures = []
    for table, source_rows in plan.new.items():
        current = fetch_all(base_url, secret, table)
        if table == "attendance":
            keys = {(row["student_id"], row["session_id"]) for row in current}
            for source in source_rows:
                source_student_id = int(source.get("_source_student_id", source["student_id"]))
                source_session_id = int(source.get("_source_session_id", source["session_id"]))
                student_id = plan.maps["students"].get(source_student_id, source["student_id"])
                session_id = plan.maps["sessions"].get(source_session_id, source["session_id"])
                if (student_id, session_id) not in keys:
                    failures.append({"table": table, "sourceKey": f"{source['student_id']}:{source['session_id']}"})
        else:
            ids = {int(row["id"]) for row in current if row.get("id") is not None}
            for source in source_rows:
                source_id = int(source["id"])
                target_id = plan.maps[table].get(source_id)
                if target_id is not None and target_id not in ids:
                    failures.append({"table": table, "sourceId": source_id, "targetId": target_id})
    return failures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-append-only", action="store_true")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parents[1] / ".env.migration.local")
    parser.add_argument("--backup-dir", type=Path, default=Path(__file__).resolve().parents[1] / ".migration-backups")
    args = parser.parse_args()
    environment = {**load_environment(args.env_file), **os.environ}
    base_url = environment.get("SUPABASE_URL", "").strip()
    secret = environment.get("SUPABASE_SECRET_KEY", "").strip()
    if not base_url or not secret:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured")
    result = transform(args.workbook)
    if result["unresolved"]:
        raise RuntimeError(f"Workbook has unresolved transformations: {result['unresolved']}")
    incoming = clean_rows(result)
    current = {table: fetch_all(base_url, secret, table) for table in TABLES}
    plan = AppendPlan(current, incoming).plan()
    report = {
        "mode": "append-only",
        "workbook": args.workbook.name,
        "workbookSha256": workbook_hash(args.workbook),
        "liveBefore": {table: len(rows) for table, rows in current.items()},
        **plan.report(),
    }
    if not args.apply:
        output = report if not args.summary else {
            "mode": report["mode"],
            "workbookSha256": report["workbookSha256"],
            "liveBefore": report["liveBefore"],
            "insert": report["insert"],
            "preserveExisting": report["preserveExisting"],
            "preservedDifferenceCount": len(report["preservedDifferences"]),
            "newRecords": {
                "students": [{"sourceId": row["id"], "branchId": row["branch_id"], "name": row["name"]} for row in plan.new["students"]],
                "coaches": [{"sourceId": row["id"], "branchId": row["branch_id"], "name": row["name"]} for row in plan.new["coaches"]],
                "sessions": [{"sourceId": row["id"], "classId": row["class_id"], "date": row["session_date"]} for row in plan.new["sessions"]],
                "attendanceByDate": dict(sorted(Counter(row["attendance_date"] for row in plan.new["attendance"]).items())),
            },
            "idCollisionsHandled": report["idCollisionsHandled"],
            "conflicts": report["conflicts"],
        }
        print(json.dumps(output, indent=2, default=str))
        raise SystemExit(2 if report["conflicts"] else 0)
    if not args.confirm_append_only:
        raise RuntimeError("Applying requires --confirm-append-only")
    if report["conflicts"]:
        raise RuntimeError("Append blocked because identity conflicts were found")
    backup = backup_live(base_url, secret, args.backup_dir)
    inserted = apply_plan(plan, base_url, secret)
    verification_failures = verify(plan, base_url, secret)
    report["backup"] = str(backup)
    report["inserted"] = inserted
    report["verificationFailures"] = verification_failures
    report["completedAt"] = datetime.now(timezone.utc).isoformat()
    output = args.backup_dir / f"append-result-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"backup": str(backup), "result": str(output), "inserted": inserted, "verificationFailures": verification_failures}, indent=2))
    raise SystemExit(1 if verification_failures else 0)


if __name__ == "__main__":
    main()
