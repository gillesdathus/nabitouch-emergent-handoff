"""Production-directed legacy CSV import runner. Default is dry-run only.

Hard guards:
- Requires explicit --i-authorize-production-write for any write
- Refuses DEMO_MODE=true and obvious QA/demo DB names
- Requires LEGACY_PATIENT_IMPORT_ENABLED=true
- Requires --backup-sha256 on write
- Never sends invitations

Usage:
  python scripts/run_production_legacy_import.py --csv-dir ../private_imports/nabitouch_history
  python scripts/run_production_legacy_import.py --csv-dir ... --i-authorize-production-write --backup-sha256 <hex>
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FORBIDDEN_DB_FRAGMENTS = ("qa_isolated", "demo", "test_only")


def _refuse(msg: str) -> None:
    raise SystemExit(f"REFUSED: {msg}")


def assert_import_env(*, allow_write: bool) -> dict:
    db_name = (os.environ.get("DB_NAME") or "").strip()
    mongo = os.environ.get("MONGO_URL") or ""
    if not db_name or not mongo:
        _refuse("DB_NAME and MONGO_URL are required")
    lowered = db_name.lower()
    for frag in FORBIDDEN_DB_FRAGMENTS:
        if frag in lowered:
            _refuse(f"DB_NAME {db_name!r} looks non-production / forbidden for this runner")
    if (os.environ.get("DEMO_MODE") or "").lower() in ("1", "true", "yes"):
        _refuse("DEMO_MODE must be false for production-directed import")
    if (os.environ.get("LEGACY_PATIENT_IMPORT_ENABLED") or "").lower() not in ("1", "true", "yes"):
        _refuse("LEGACY_PATIENT_IMPORT_ENABLED must be true for the migration window")
    if allow_write and (os.environ.get("APP_ENV") or "").lower() != "production":
        _refuse("Writes require APP_ENV=production (use dry-run otherwise)")
    uri = urlparse(mongo)
    return {"dbName": db_name, "mongoHost": uri.hostname, "writes": allow_write}


def load_csvs(csv_dir: Path):
    pe = csv_dir / "patient_export.csv"
    pw = csv_dir / "patients_without_appointments.csv"
    sales = csv_dir / "practitioner_sales_report.csv"
    for path in (pe, pw, sales):
        if not path.is_file():
            _refuse(f"missing CSV: {path}")
    return pe.read_text(encoding="utf-8-sig"), pw.read_text(encoding="utf-8-sig"), sales.read_text(encoding="utf-8-sig")


async def run(csv_dir: Path, *, authorize_write: bool, backup_sha256: str | None) -> dict:
    from motor.motor_asyncio import AsyncIOMotorClient
    from nabitouch_csv_import import build_migration_preview, public_preview
    from nabitouch_production_plan import FINANCIAL_GATES, build_production_readiness_skeleton
    from legacy import _prepare

    target = assert_import_env(allow_write=authorize_write)
    pe, pw, sales = load_csvs(csv_dir)
    preview = build_migration_preview(
        patient_export_csv=pe, secondary_csv=pw, sales_csv=sales, existing_clients=[],
    )
    public = public_preview(preview)
    fin = public.get("financialValidation") or {}
    mismatches = [k for k, ok in (fin.get("matchesVerifiedTargets") or {}).items() if not ok]
    if mismatches:
        _refuse(f"financial gates failed: {mismatches}")

    records = preview["_internal"]["legacyRecords"]
    invoices = [inv for inv in preview["_internal"]["legacyInvoices"] if inv.get("sourcePatientId")]
    dropped = sum(1 for inv in preview["_internal"]["legacyInvoices"] if not inv.get("sourcePatientId"))

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[target["dbName"]]
    try:
        pre = {
            "nt_legacy_patients": await db.nt_legacy_patients.count_documents({}),
            "nt_legacy_invoices": await db.nt_legacy_invoices.count_documents({}),
            "nt_ledger": await db.nt_ledger.count_documents({}),
            "nt_appointments": await db.nt_appointments.count_documents({}),
            "nt_clients": await db.nt_clients.count_documents({}),
            "nt_legacy_invitations": await db.nt_legacy_invitations.count_documents({}),
        }
        dry = await _prepare(db, records, invoices, dry=True, actor="prod-dry-run")
        if dry.get("ledgerPostings"):
            _refuse("dry-run reported ledger postings")
        result = {
            "status": "dry_run_only",
            "liveActionsAuthorized": False,
            "target": target,
            "preCounts": pre,
            "dryRun": {k: v for k, v in dry.items() if k != "message" or v},
            "patientRecords": len(records),
            "invoicesLinked": len(invoices),
            "invoicesDroppedAmbiguousName": dropped,
            "financialValidation": fin,
            "patientReconciliation": public.get("patientReconciliation"),
            "plan": build_production_readiness_skeleton(
                patient_record_count=len(records), invoice_record_count=len(invoices),
            ),
            "financialGates": FINANCIAL_GATES,
            "autoSendInvitations": False,
        }
        if not authorize_write:
            return result
        if not backup_sha256 or len(backup_sha256) < 32:
            _refuse("--i-authorize-production-write requires --backup-sha256")
        written = await _prepare(db, records, invoices, dry=False, actor="prod-import")
        post = {
            "nt_legacy_patients": await db.nt_legacy_patients.count_documents({}),
            "nt_legacy_invoices": await db.nt_legacy_invoices.count_documents({}),
            "nt_ledger": await db.nt_ledger.count_documents({}),
            "nt_appointments": await db.nt_appointments.count_documents({}),
            "nt_clients": await db.nt_clients.count_documents({}),
            "nt_legacy_invitations": await db.nt_legacy_invitations.count_documents({}),
        }
        for key in ("nt_ledger", "nt_appointments", "nt_clients", "nt_legacy_invitations"):
            if post[key] != pre[key]:
                _refuse(f"{key} changed after import")
        again = await _prepare(db, records, invoices, dry=True, actor="prod-idempotency")
        result.update({
            "status": "executed",
            "liveActionsAuthorized": True,
            "backupSha256": backup_sha256,
            "writeResult": written,
            "postCounts": post,
            "idempotencyDryRun": again,
        })
        return result
    finally:
        client.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv-dir", required=True, type=Path)
    parser.add_argument("--i-authorize-production-write", action="store_true")
    parser.add_argument("--backup-sha256", default=None)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    report = asyncio.run(run(
        args.csv_dir,
        authorize_write=args.i_authorize_production_write,
        backup_sha256=args.backup_sha256,
    ))
    text = json.dumps(report, indent=2, default=str)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
