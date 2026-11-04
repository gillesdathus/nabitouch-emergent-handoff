#!/usr/bin/env python3
"""Hotfix A: remove incorrect practitioner classification for Dathus Gilles.

Resolved IDs (production nabitouch_prod) — do not match by name alone:
  staff user:        8dcf5a32-75eb-458f-b277-0bc7847f0114  gdathus@gmail.com
  practitioner row:  p-40244477
  client account:    affed7fb-d2fa-480b-88aa-60f027000d1e  (untouched)
  Nabitu user:       ffcbab9a-2fe9-4632-af89-a5291768fa51  (untouched)
  Nabitu profile:    p-f3a4279b                             (untouched)

Requires CONFIRM_P0_DATHUS_STAFF_FIX=yes.
Does not delete accounts or audit history.
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

DATHUS_USER_ID = "8dcf5a32-75eb-458f-b277-0bc7847f0114"
DATHUS_EMAIL = "gdathus@gmail.com"
DATHUS_PRACTITIONER_ID = "p-40244477"
NABITU_USER_ID = "ffcbab9a-2fe9-4632-af89-a5291768fa51"
NABITU_PRACTITIONER_ID = "p-f3a4279b"
TARGET_ROLES = ["owner", "manager", "desk"]


async def main():
    if os.environ.get("CONFIRM_P0_DATHUS_STAFF_FIX") != "yes":
        raise SystemExit("Refusing. Set CONFIRM_P0_DATHUS_STAFF_FIX=yes")

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    now = datetime.now(timezone.utc).isoformat()

    user = await db.nt_users.find_one({"id": DATHUS_USER_ID}, {"_id": 0, "password": 0, "passwordHash": 0, "password_hash": 0})
    person = await db.nt_practitioners.find_one({"id": DATHUS_PRACTITIONER_ID}, {"_id": 0})
    schedule = await db.nt_schedules.find_one({"practitionerId": DATHUS_PRACTITIONER_ID}, {"_id": 0})
    nabitu_user = await db.nt_users.find_one({"id": NABITU_USER_ID}, {"_id": 0, "id": 1, "email": 1, "roles": 1, "subject": 1, "role": 1})
    nabitu_person = await db.nt_practitioners.find_one(
        {"id": NABITU_PRACTITIONER_ID},
        {"_id": 0, "id": 1, "name": 1, "available": 1, "bookable": 1, "onboardingStatus": 1, "profileVisibility": 1},
    )

    if not user:
        raise SystemExit(f"User {DATHUS_USER_ID} not found")
    if (user.get("email") or "").strip().lower() != DATHUS_EMAIL:
        raise SystemExit(f"Email mismatch for {DATHUS_USER_ID}: {user.get('email')}")
    if not person:
        raise SystemExit(f"Practitioner {DATHUS_PRACTITIONER_ID} not found")
    if str(person.get("name") or "").strip().lower() != "dathus gilles":
        raise SystemExit(f"Practitioner name mismatch for {DATHUS_PRACTITIONER_ID}: {person.get('name')}")
    if user.get("subject") not in (None, DATHUS_PRACTITIONER_ID):
        raise SystemExit(f"Unexpected subject on Dathus user: {user.get('subject')}")
    if not nabitu_person or nabitu_person.get("id") != NABITU_PRACTITIONER_ID:
        raise SystemExit("Nabitu practitioner missing — abort")

    backup = {
        "at": now,
        "user": user,
        "person": person,
        "schedule": schedule,
        "nabitu_user": nabitu_user,
        "nabitu_person": nabitu_person,
    }
    backup_path = f"/tmp/p0_dathus_staff_fix_backup_{stamp}.json"
    with open(backup_path, "w", encoding="utf-8") as handle:
        json.dump(backup, handle, indent=2, default=str)
    os.chmod(backup_path, 0o600)
    print("BACKUP", backup_path)
    print("BEFORE_USER", json.dumps({k: user.get(k) for k in ("id", "email", "role", "roles", "subject", "operationalDesignation", "status")}, default=str))
    print("BEFORE_PERSON", json.dumps({k: person.get(k) for k in ("id", "name", "available", "bookable", "onboardingStatus", "profileVisibility")}, default=str))

    user_update = {
        "role": "owner",
        "roles": TARGET_ROLES,
        "operationalDesignation": "manager_receptionist",
        "preferredWorkspace": "owner",
        "status": user.get("status") or "active",
    }
    await db.nt_users.update_one(
        {"id": DATHUS_USER_ID, "email": DATHUS_EMAIL},
        {"$set": user_update, "$unset": {"subject": "", "practitionerId": ""}},
    )

    person_update = {
        "available": False,
        "bookable": False,
        "profileVisibility": "hidden",
        "onboardingStatus": "invited",
        "archivedReason": "incorrect-practitioner-classification",
        "archivedAt": now,
        "listingEligible": False,
    }
    await db.nt_practitioners.update_one({"id": DATHUS_PRACTITIONER_ID}, {"$set": person_update})

    if schedule is not None:
        await db.nt_schedules.update_one(
            {"practitionerId": DATHUS_PRACTITIONER_ID},
            {"$set": {"acceptingBookings": False, "status": schedule.get("status") or "draft"}},
        )

    await db.nt_audit.insert_one(
        {
            "id": f"audit-p0-dathus-staff-{stamp}",
            "at": now,
            "actor": "ops-p0-dathus-staff-fix",
            "actorId": "ops",
            "action": (
                f"Removed practitioner role/subject from staff {DATHUS_USER_ID}; "
                f"archived practitioner profile {DATHUS_PRACTITIONER_ID}; "
                f"roles set to {TARGET_ROLES}"
            ),
            "appointmentId": None,
        }
    )

    after_user = await db.nt_users.find_one({"id": DATHUS_USER_ID}, {"_id": 0, "id": 1, "email": 1, "role": 1, "roles": 1, "subject": 1, "operationalDesignation": 1, "status": 1, "preferredWorkspace": 1})
    after_person = await db.nt_practitioners.find_one(
        {"id": DATHUS_PRACTITIONER_ID},
        {"_id": 0, "id": 1, "name": 1, "available": 1, "bookable": 1, "onboardingStatus": 1, "profileVisibility": 1, "archivedReason": 1},
    )
    after_schedule = await db.nt_schedules.find_one(
        {"practitionerId": DATHUS_PRACTITIONER_ID},
        {"_id": 0, "practitionerId": 1, "status": 1, "acceptingBookings": 1},
    )
    after_nabitu = await db.nt_practitioners.find_one(
        {"id": NABITU_PRACTITIONER_ID},
        {"_id": 0, "id": 1, "name": 1, "available": 1, "bookable": 1, "onboardingStatus": 1, "profileVisibility": 1},
    )
    after_nabitu_user = await db.nt_users.find_one(
        {"id": NABITU_USER_ID},
        {"_id": 0, "id": 1, "email": 1, "roles": 1, "subject": 1, "role": 1},
    )

    print("AFTER_USER", json.dumps(after_user, default=str))
    print("AFTER_PERSON", json.dumps(after_person, default=str))
    print("AFTER_SCHEDULE", json.dumps(after_schedule, default=str))
    print("NABITU_PERSON", json.dumps(after_nabitu, default=str))
    print("NABITU_USER", json.dumps(after_nabitu_user, default=str))

    assert after_user.get("roles") == TARGET_ROLES
    assert after_user.get("subject") in (None, "")
    assert "practitioner" not in (after_user.get("roles") or [])
    assert after_person.get("profileVisibility") == "hidden"
    assert after_person.get("available") is False
    assert after_person.get("bookable") is False
    assert after_nabitu.get("available") is True
    assert after_nabitu.get("bookable") is True
    assert after_nabitu_user.get("subject") == NABITU_PRACTITIONER_ID
    print("HOTFIX_A_OK", stamp)
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
