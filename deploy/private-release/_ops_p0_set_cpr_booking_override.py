#!/usr/bin/env python3
"""Apply a temporary CPR booking override for Nabitu Kahindo only (p-f3a4279b).

Does not modify nt_credentials verification statuses. Writes an audit row and a
backup snapshot under /tmp. Requires CONFIRM_P0_CPR_OVERRIDE=yes.
"""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from onboarding import (
    DEFAULT_CREDENTIAL_OVERRIDE_HOURS,
    assignment_credential_problem,
    missing_required_credentials,
)

PID = "p-f3a4279b"
KIND = "cpr"
HOURS = int(os.environ.get("P0_OVERRIDE_HOURS") or DEFAULT_CREDENTIAL_OVERRIDE_HOURS)


async def main():
    if os.environ.get("CONFIRM_P0_CPR_OVERRIDE") != "yes":
        raise SystemExit("Refusing. Set CONFIRM_P0_CPR_OVERRIDE=yes")
    if HOURS < 1 or HOURS > 72:
        raise SystemExit("P0_OVERRIDE_HOURS must be 1..72")

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    person = await db.nt_practitioners.find_one({"id": PID}, {"_id": 0})
    if not person:
        raise SystemExit(f"Practitioner {PID} not found")
    credentials = await db.nt_credentials.find({"practitionerId": PID}, {"_id": 0}).to_list(50)
    before = {
        "person": {
            "id": person.get("id"),
            "name": person.get("name"),
            "onboardingStatus": person.get("onboardingStatus"),
            "activatedAt": person.get("activatedAt"),
            "credentialBookingOverrides": person.get("credentialBookingOverrides"),
        },
        "missing": missing_required_credentials(credentials, person=person),
        "problem": assignment_credential_problem(person, credentials),
        "credentials": [
            {
                "id": row.get("id"),
                "kind": row.get("kind"),
                "status": row.get("status"),
                "expiresOn": row.get("expiresOn"),
            }
            for row in credentials
        ],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = f"/tmp/p0_cpr_override_backup_{PID}_{stamp}.json"
    with open(backup_path, "w", encoding="utf-8") as handle:
        json.dump(before, handle, indent=2, default=str)
    os.chmod(backup_path, 0o600)
    print("BACKUP", backup_path)
    print("BEFORE_PROBLEM", before["problem"])
    print("BEFORE_MISSING", before["missing"])

    created = datetime.now(timezone.utc)
    expires = created + timedelta(hours=HOURS)
    row = {
        "kind": KIND,
        "createdAt": created.isoformat(),
        "expiresAt": expires.isoformat(),
        "hours": HOURS,
        "by": "ops-p0-cpr-override",
        "byId": "ops",
        "note": "Owner-confirmed CPR / First Aid certificate on file; temporary booking recovery",
        "reason": "temporary-booking-recovery",
        "practitionerId": PID,
    }
    await db.nt_practitioners.update_one(
        {"id": PID},
        {"$set": {f"credentialBookingOverrides.{KIND}": row}},
    )
    await db.nt_audit.insert_one(
        {
            "id": f"audit-p0-cpr-{stamp}",
            "at": created.isoformat(),
            "actor": "ops-p0-cpr-override",
            "action": (
                f"Temporary {KIND} booking override for {PID} "
                f"until {expires.isoformat()} ({HOURS}h)"
            ),
            "appointmentId": None,
            "actorId": "ops",
        }
    )

    updated = await db.nt_practitioners.find_one(
        {"id": PID}, {"_id": 0, "credentialBookingOverrides": 1, "name": 1, "onboardingStatus": 1, "activatedAt": 1}
    )
    after_problem = assignment_credential_problem(updated, credentials)
    after_missing = missing_required_credentials(credentials, person=updated)
    # Prove credential rows unchanged.
    after_creds = await db.nt_credentials.find({"practitionerId": PID}, {"_id": 0, "id": 1, "kind": 1, "status": 1}).to_list(50)
    print("OVERRIDE", json.dumps(row, default=str))
    print("AFTER_PROBLEM", after_problem)
    print("AFTER_MISSING", after_missing)
    print("CRED_STATUSES", json.dumps(after_creds, default=str))
    print("EXPIRES_AT", expires.isoformat())
    if after_problem:
        raise SystemExit(f"Override did not clear booking gate: {after_problem}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
