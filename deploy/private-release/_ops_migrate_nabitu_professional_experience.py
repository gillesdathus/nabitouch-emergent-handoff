#!/usr/bin/env python3
"""Additive migration: persist Nabitu professional experience fields.

Recovered production baseline:
  historicalTreatmentCount = 1650 (contractor + mobile estimate, set 2026-10-31)

Owner confirmation (this change):
  +64 completed treatments since that baseline

Persisted career baseline after migration:
  historicalCompletedTreatments = 1714
  historicalCountAsOf = 2026-11-03

Does not touch credentials, weekly availability, or appointments.
Requires CONFIRM_MIGRATE_EXPERIENCE=yes and DB_NAME=nabitouch_prod.
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

PREVIOUS_BASELINE = 1650
OWNER_SINCE_LAST = 64
NEW_TOTAL = PREVIOUS_BASELINE + OWNER_SINCE_LAST  # 1714
AS_OF = "2026-11-03"
SOURCE = (
    "Owner-confirmed career total: production historicalTreatmentCount 1650 "
    "(contractor 200–305 clients × 5–6 visits + 57 mobile patients × 4–5 visits, "
    "rounded 2026-10-31) plus 64 treatments completed since that baseline."
)


async def main():
    if os.environ.get("CONFIRM_MIGRATE_EXPERIENCE") != "yes":
        raise SystemExit("Refusing. Set CONFIRM_MIGRATE_EXPERIENCE=yes")
    assert os.environ.get("DB_NAME") == "nabitouch_prod"
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    try:
        pract = await db.nt_practitioners.find_one(
            {"name": "Nabitu Kahindo"},
            {"_id": 0},
        )
        if not pract:
            raise SystemExit("Nabitu practitioner missing — abort")

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_dir = Path(os.environ.get("BACKUP_DIR") or "/root/nabitouch-next-backups")
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"nabitu-experience-backup-{stamp}.json"
        backup_path.write_text(json.dumps(pract, indent=2, default=str), encoding="utf-8")
        os.chmod(backup_path, 0o600)

        existing = pract.get("historicalCompletedTreatments")
        legacy = pract.get("historicalTreatmentCount")
        if existing is not None and existing != NEW_TOTAL and os.environ.get("FORCE_EXPERIENCE_OVERWRITE") != "yes":
            raise SystemExit(
                f"historicalCompletedTreatments already set to {existing}; "
                "refusing to overwrite without FORCE_EXPERIENCE_OVERWRITE=yes"
            )
        if legacy not in (None, PREVIOUS_BASELINE, NEW_TOTAL):
            if os.environ.get("FORCE_EXPERIENCE_OVERWRITE") != "yes":
                raise SystemExit(
                    f"Unexpected legacy historicalTreatmentCount={legacy}; "
                    f"expected {PREVIOUS_BASELINE} or {NEW_TOTAL}"
                )

        now = datetime.now(timezone.utc).isoformat()
        audit_entry = {
            "id": f"migrate-experience-{stamp}",
            "at": now,
            "actor": "ops-migrate",
            "actorId": "ops-migrate",
            "before": {
                "historicalCompletedTreatments": existing,
                "historicalTreatmentCount": legacy,
                "historicalCountAsOf": pract.get("historicalCountAsOf"),
                "historicalCountSource": pract.get("historicalCountSource"),
            },
            "after": {
                "historicalCompletedTreatments": NEW_TOTAL,
                "historicalCountAsOf": AS_OF,
                "historicalCountSource": SOURCE,
            },
            "note": "Additive migration from recovered 1650 + owner-confirmed +64",
        }
        updated = await db.nt_practitioners.find_one_and_update(
            {"id": pract["id"]},
            {
                "$set": {
                    "historicalCompletedTreatments": NEW_TOTAL,
                    "historicalTreatmentCount": NEW_TOTAL,
                    "historicalCountAsOf": AS_OF,
                    "historicalCountSource": SOURCE,
                    "historicalCountUpdatedAt": now,
                    "historicalCountUpdatedBy": {"id": "ops-migrate", "name": "ops-migrate"},
                    "updatedAt": now,
                },
                "$push": {
                    "historicalCountAudit": {
                        "$each": [audit_entry],
                        "$slice": -50,
                    }
                },
            },
            projection={
                "_id": 0,
                "id": 1,
                "name": 1,
                "historicalCompletedTreatments": 1,
                "historicalTreatmentCount": 1,
                "historicalCountAsOf": 1,
                "historicalCountSource": 1,
            },
            return_document=True,
        )
        report = {
            "backup": str(backup_path),
            "previous": {
                "historicalCompletedTreatments": existing,
                "historicalTreatmentCount": legacy,
            },
            "updated": updated,
            "math": {
                "previousBaseline": PREVIOUS_BASELINE,
                "ownerSinceLast": OWNER_SINCE_LAST,
                "newTotal": NEW_TOTAL,
                "asOf": AS_OF,
            },
        }
        print(json.dumps(report, indent=2))
        print("SET_OK", NEW_TOTAL)
    finally:
        client.close()


asyncio.run(main())
