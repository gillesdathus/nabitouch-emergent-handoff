"""Checkpoint E — authorized staging import runner.

Hard guards:
- DB_NAME must be exactly nabitouch_staging
- MONGO_URL path / authSource must target nabitouch_staging
- Refuses prod / qa / demo database names
- Default is dry-run; pass --execute only after backup acknowledgment

Usage (on the staging host, with staging api.env loaded):
  python scripts/run_checkpoint_e_staging_import.py --csv-dir /path/to/private_imports/nabitouch_history
  python scripts/run_checkpoint_e_staging_import.py --csv-dir ... --execute --backup-sha256 <hex>
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FORBIDDEN_DB_FRAGMENTS = ("prod", "production", "qa", "demo", "live")
REQUIRED_DB = "nabitouch_staging"


def _refuse(msg: str) -> None:
    raise SystemExit(f"REFUSED: {msg}")


def assert_staging_only() -> dict:
    db_name = (os.environ.get("DB_NAME") or "").strip()
    mongo = os.environ.get("MONGO_URL") or ""
    if db_name != REQUIRED_DB:
        _refuse(f"DB_NAME must be {REQUIRED_DB!r}, got {db_name!r}")
    if not mongo:
        _refuse("MONGO_URL is required")
    uri = urlparse(mongo)
    path = (uri.path or "").lstrip("/")
    if path and path != REQUIRED_DB:
        _refuse(f"MONGO_URL path must be /{REQUIRED_DB}, got /{path}")
    auth_source = (parse_qs(uri.query).get("authSource") or [None])[0]
    if auth_source and auth_source != REQUIRED_DB:
        _refuse(f"authSource must be {REQUIRED_DB}, got {auth_source!r}")
    lowered = f"{db_name} {path} {mongo}".lower()
    for frag in FORBIDDEN_DB_FRAGMENTS:
        if frag in lowered and REQUIRED_DB not in lowered:
            _refuse(f"forbidden database fragment {frag!r} in connection target")
    if not os.environ.get("LEGACY_PATIENT_IMPORT_ENABLED", "").lower() in ("1", "true", "yes"):
        _refuse("LEGACY_PATIENT_IMPORT_ENABLED must be true on staging for this run")
    for flag in (
        "EMAIL_REMINDERS_ENABLED",
        "INVOICE_EMAIL_ENABLED",
        "REVIEW_INVITES_ENABLED",
        "SMS_ENABLED",
        "NOTIFICATION_WORKER_ENABLED",
    ):
        if os.environ.get(flag, "false").lower() in ("1", "true", "yes"):
            _refuse(f"{flag} must stay disabled during Checkpoint E import")
    return {"dbName": db_name, "mongoHost": uri.hostname, "path": path or REQUIRED_DB}


def load_csvs(csv_dir: Path) -> tuple[str, str, str]:
    pe = csv_dir / "patient_export.csv"
    pw = csv_dir / "patients_without_appointments.csv"
    sales = csv_dir / "practitioner_sales_report.csv"
    for path in (pe, pw, sales):
        if not path.is_file():
            _refuse(f"missing CSV: {path}")
    return (
        pe.read_text(encoding="utf-8-sig"),
        pw.read_text(encoding="utf-8-sig"),
        sales.read_text(encoding="utf-8-sig"),
    )


async def run(csv_dir: Path, *, execute: bool, backup_sha256: str | None) -> dict:
    from motor.motor_asyncio import AsyncIOMotorClient
    from nabitouch_csv_import import build_migration_preview, public_preview
    from nabitouch_staging_plan import FINANCIAL_GATES, build_checkpoint_e_prep_report
    from legacy import _prepare

    target = assert_staging_only()
    pe, pw, sales = load_csvs(csv_dir)
    preview = build_migration_preview(
        patient_export_csv=pe,
        secondary_csv=pw,
        sales_csv=sales,
        existing_clients=[],
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
    db = client[REQUIRED_DB]
    try:
        pre = {
            "nt_legacy_patients": await db.nt_legacy_patients.count_documents({}),
            "nt_legacy_invoices": await db.nt_legacy_invoices.count_documents({}),
            "nt_ledger": await db.nt_ledger.count_documents({}),
            "nt_appointments": await db.nt_appointments.count_documents({}),
            "nt_clients": await db.nt_clients.count_documents({}),
            "nt_legacy_invitations": await db.nt_legacy_invitations.count_documents({}),
        }
        dry = await _prepare(db, records, invoices, dry=True, actor="checkpoint-e-dry")
        if dry.get("ledgerPostings"):
            _refuse("dry-run reported ledger postings; aborting")

        result = {
            "status": "dry_run_only",
            "target": target,
            "preCounts": pre,
            "dryRun": dry,
            "patientRecords": len(records),
            "invoicesLinked": len(invoices),
            "invoicesDroppedAmbiguousName": dropped,
            "financialValidation": fin,
            "overlappingCategoryCounts": (public.get("patientReconciliation") or {}).get("overlappingCategoryCounts"),
            "invitationReadinessCounts": (public.get("patientReconciliation") or {}).get("invitationReadinessCounts"),
            "plan": build_checkpoint_e_prep_report(
                patient_record_count=len(records),
                invoice_record_count=len(invoices),
            ),
            "financialGates": FINANCIAL_GATES,
        }

        if not execute:
            return result

        if not backup_sha256 or len(backup_sha256) < 32:
            _refuse("--execute requires --backup-sha256 from deploy/staging/backup.py")

        written = await _prepare(db, records, invoices, dry=False, actor="checkpoint-e-import")
        post = {
            "nt_legacy_patients": await db.nt_legacy_patients.count_documents({}),
            "nt_legacy_invoices": await db.nt_legacy_invoices.count_documents({}),
            "nt_ledger": await db.nt_ledger.count_documents({}),
            "nt_appointments": await db.nt_appointments.count_documents({}),
            "nt_clients": await db.nt_clients.count_documents({}),
            "nt_legacy_invitations": await db.nt_legacy_invitations.count_documents({}),
        }
        if post["nt_ledger"] != pre["nt_ledger"]:
            _refuse("nt_ledger count changed after import — investigate before continuing")
        if post["nt_appointments"] != pre["nt_appointments"]:
            _refuse("nt_appointments count changed after import")
        if post["nt_clients"] != pre["nt_clients"]:
            _refuse("nt_clients count changed after import")
        if post["nt_legacy_invitations"] != pre["nt_legacy_invitations"]:
            _refuse("nt_legacy_invitations count changed after import")

        # Idempotency: second dry-run should skip all sourceKeys.
        again = await _prepare(db, records, invoices, dry=True, actor="checkpoint-e-idempotency")
        result.update({
            "status": "executed",
            "backupSha256": backup_sha256,
            "writeResult": written,
            "postCounts": post,
            "idempotencyDryRun": again,
            "noInvitations": True,
            "noClinicalAppointments": True,
        })
        return result
    finally:
        client.close()


def main():
    parser = argparse.ArgumentParser(description="Checkpoint E staging import (guarded)")
    parser.add_argument("--csv-dir", required=True, type=Path)
    parser.add_argument("--execute", action="store_true", help="Perform write (default: dry-run)")
    parser.add_argument("--backup-sha256", default=None, help="Required with --execute")
    parser.add_argument("--out", type=Path, default=None, help="Write JSON report path")
    args = parser.parse_args()
    report = asyncio.run(run(args.csv_dir, execute=args.execute, backup_sha256=args.backup_sha256))
    text = json.dumps(report, indent=2, default=str)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)
    if report.get("status") != "executed" and args.execute:
        sys.exit(2)


if __name__ == "__main__":
    main()
