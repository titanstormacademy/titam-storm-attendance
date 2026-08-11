import json
import os
from collections import Counter, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

from migrate_workbook import load_environment, request_json

PAGE_SIZE = 1000
TABLES = [
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


def list_objects(base_url, secret, bucket):
    objects = []
    folders = deque([""])
    visited = set()
    while folders:
        prefix = folders.popleft()
        if prefix in visited:
            continue
        visited.add(prefix)
        offset = 0
        while True:
            rows = request_json(
                base_url,
                secret,
                "POST",
                f"/storage/v1/object/list/{quote(bucket, safe='')}",
                {"prefix": prefix, "limit": PAGE_SIZE, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
            ) or []
            for row in rows:
                path = f"{prefix}/{row['name']}" if prefix else row["name"]
                if row.get("metadata") is None:
                    folders.append(path)
                else:
                    objects.append({"path": path, **row})
            if len(rows) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
    return objects


def timestamp(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def main():
    root = Path(__file__).resolve().parents[1]
    environment = {**load_environment(root / ".env.migration.local"), **os.environ}
    base_url = environment.get("SUPABASE_URL", "").strip()
    secret = environment.get("SUPABASE_SECRET_KEY", "").strip()
    if not base_url or not secret:
        raise RuntimeError("Migration credentials are not configured")
    tables = {table: fetch_all(base_url, secret, table) for table in TABLES}
    buckets = request_json(base_url, secret, "GET", "/storage/v1/bucket") or []
    referenced = {
        "student-photos": {row["photo_path"] for row in tables["students"] if row.get("photo_path")},
        "coach-photos": {row["photo_path"] for row in tables["coaches"] if row.get("photo_path")},
        "academy-assets": {row["logo_path"] for row in tables["academy_settings"] if row.get("logo_path")},
        "payment-receipts": {row["receipt_path"] for row in tables["payments"] if row.get("receipt_path")},
    }
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    storage = {}
    for bucket in buckets:
        name = bucket["name"]
        objects = list_objects(base_url, secret, name)
        paths = {row["path"] for row in objects}
        expected = referenced.get(name, set())
        referenced_paths = set(expected)
        if name in {"student-photos", "coach-photos"}:
            referenced_paths |= {f"{path.rsplit('.', 1)[0]}.thumb.webp" if "." in path else f"{path}.thumb.webp" for path in expected}
        recent = [row for row in objects if timestamp(row.get("created_at")) and timestamp(row.get("created_at")) >= cutoff]
        storage[name] = {
            "objects": len(objects),
            "bytes": sum(int((row.get("metadata") or {}).get("size") or 0) for row in objects),
            "recent30DayBytes": sum(int((row.get("metadata") or {}).get("size") or 0) for row in recent),
            "referencedObjects": len(paths & referenced_paths),
            "orphanObjects": len(paths - referenced_paths),
            "orphanBytes": sum(int((row.get("metadata") or {}).get("size") or 0) for row in objects if row["path"] not in referenced_paths),
        }
    database_json_bytes = {table: len(json.dumps(rows, separators=(",", ":"), default=str).encode("utf-8")) for table, rows in tables.items()}
    attendance_dates = Counter(row.get("attendance_date", "")[:7] for row in tables["attendance"] if row.get("attendance_date"))
    output = {
        "storage": storage,
        "storageTotalBytes": sum(item["bytes"] for item in storage.values()),
        "storageRecent30DayBytes": sum(item["recent30DayBytes"] for item in storage.values()),
        "rows": {table: len(rows) for table, rows in tables.items()},
        "databaseJsonPayloadBytes": database_json_bytes,
        "databaseJsonPayloadTotalBytes": sum(database_json_bytes.values()),
        "attendanceByMonth": dict(sorted(attendance_dates.items())),
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
