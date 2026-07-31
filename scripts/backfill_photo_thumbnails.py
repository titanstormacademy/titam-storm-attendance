import argparse
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote

import requests
import truststore
from PIL import Image, ImageOps

truststore.inject_into_ssl()

sys.path.insert(0, str(Path(__file__).resolve().parent))
from migrate_workbook import load_environment


def thumbnail_path(path):
    slash = path.rfind("/")
    dot = path.rfind(".")
    stem = path[:dot] if dot > slash else path
    return f"{stem}.thumb.webp"


def api_rows(base_url, secret, table):
    response = requests.get(
        f"{base_url}/rest/v1/{table}",
        params={"select": "id,photo_path", "photo_path": "not.is.null"},
        headers={"apikey": secret, "Authorization": f"Bearer {secret}"},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def create_thumbnail(content):
    with Image.open(io.BytesIO(content)) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image = ImageOps.fit(image, (256, 256), method=Image.Resampling.LANCZOS, centering=(0.5, 0.42))
        output = io.BytesIO()
        image.save(output, format="WEBP", quality=78, method=6)
        return output.getvalue()


def process(base_url, secret, bucket, record):
    path = record["photo_path"]
    original_url = f"{base_url}/storage/v1/object/public/{quote(bucket, safe='')}/{quote(path, safe='/')}"
    last_error = None
    for attempt in range(4):
        try:
            original = requests.get(original_url, timeout=90)
            original.raise_for_status()
            thumbnail = create_thumbnail(original.content)
            target = thumbnail_path(path)
            uploaded = requests.post(
                f"{base_url}/storage/v1/object/{quote(bucket, safe='')}/{quote(target, safe='/')}",
                data=thumbnail,
                headers={
                    "apikey": secret,
                    "Authorization": f"Bearer {secret}",
                    "Content-Type": "image/webp",
                    "x-upsert": "true",
                    "cache-control": "max-age=31536000",
                },
                timeout=90,
            )
            uploaded.raise_for_status()
            return {"originalBytes": len(original.content), "thumbnailBytes": len(thumbnail)}
        except requests.RequestException as error:
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise last_error or RuntimeError("thumbnail request failed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parents[1] / ".env.migration.local")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    environment = load_environment(args.env_file)
    base_url = environment.get("SUPABASE_URL", "").rstrip("/")
    secret = environment.get("SUPABASE_SECRET_KEY", "")
    if not base_url or not secret:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")

    jobs = []
    for bucket, table in [("student-photos", "students"), ("coach-photos", "coaches")]:
        jobs.extend((bucket, record) for record in api_rows(base_url, secret, table))

    succeeded = []
    failures = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process, base_url, secret, bucket, record): (bucket, record["id"]) for bucket, record in jobs}
        for future in as_completed(futures):
            bucket, record_id = futures[future]
            try:
                succeeded.append(future.result())
            except Exception as error:
                failures.append({"bucket": bucket, "id": record_id, "error": str(error)})

    original_bytes = sum(item["originalBytes"] for item in succeeded)
    thumbnail_bytes = sum(item["thumbnailBytes"] for item in succeeded)
    report = {
        "requested": len(jobs),
        "created": len(succeeded),
        "failed": len(failures),
        "originalBytes": original_bytes,
        "thumbnailBytes": thumbnail_bytes,
        "averageOriginalBytes": round(original_bytes / len(succeeded)) if succeeded else 0,
        "averageThumbnailBytes": round(thumbnail_bytes / len(succeeded)) if succeeded else 0,
        "reductionPercent": round((1 - thumbnail_bytes / original_bytes) * 100, 1) if original_bytes else 0,
        "failures": failures,
    }
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if not failures else 1)


if __name__ == "__main__":
    main()
