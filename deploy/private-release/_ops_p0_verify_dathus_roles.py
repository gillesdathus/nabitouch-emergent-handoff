#!/usr/bin/env python3
"""Production acceptance for Hotfix A staff/practitioner separation."""
import asyncio
import json
import os
import urllib.request

from motor.motor_asyncio import AsyncIOMotorClient
from profiles import public_therapist_listing_eligible, profile_visibility
from staff_identity import account_is_bookable_therapist
from rbac import workspaces_for

DATHUS_USER_ID = "8dcf5a32-75eb-458f-b277-0bc7847f0114"
DATHUS_PRACTITIONER_ID = "p-40244477"
NABITU_PRACTITIONER_ID = "p-f3a4279b"
NABITU_USER_ID = "ffcbab9a-2fe9-4632-af89-a5291768fa51"


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    user = await db.nt_users.find_one({"id": DATHUS_USER_ID}, {"_id": 0, "password": 0, "passwordHash": 0, "password_hash": 0})
    person = await db.nt_practitioners.find_one({"id": DATHUS_PRACTITIONER_ID}, {"_id": 0})
    nabitu = await db.nt_practitioners.find_one({"id": NABITU_PRACTITIONER_ID}, {"_id": 0})
    nabitu_user = await db.nt_users.find_one({"id": NABITU_USER_ID}, {"_id": 0, "id": 1, "roles": 1, "subject": 1, "role": 1, "email": 1})

    print("DATHUS_USER", json.dumps({k: user.get(k) for k in ("id", "email", "role", "roles", "subject", "operationalDesignation", "status")}, default=str))
    print("DATHUS_PERSON", json.dumps({k: person.get(k) for k in ("id", "name", "available", "bookable", "onboardingStatus", "profileVisibility", "archivedReason", "listingEligible")}, default=str))
    print("DATHUS_VISIBILITY", profile_visibility(person))
    print("DATHUS_LISTING", public_therapist_listing_eligible(person))
    print("DATHUS_THERAPIST_ELIGIBLE", account_is_bookable_therapist(user, person))
    print("DATHUS_WORKSPACES", workspaces_for(user))
    print("NABITU_PERSON", json.dumps({k: nabitu.get(k) for k in ("id", "name", "available", "bookable", "onboardingStatus", "profileVisibility")}, default=str))
    print("NABITU_LISTING", public_therapist_listing_eligible(nabitu))
    print("NABITU_USER", json.dumps(nabitu_user, default=str))

    assert "practitioner" not in (user.get("roles") or [])
    assert not user.get("subject")
    assert account_is_bookable_therapist(user, person) is False
    assert "practitioner" not in workspaces_for(user)
    assert public_therapist_listing_eligible(person) is False
    assert public_therapist_listing_eligible(nabitu) is True
    assert nabitu_user.get("subject") == NABITU_PRACTITIONER_ID

    # Public state must not include Dathus practitioner id.
    with urllib.request.urlopen("https://nabitouch.com/api/state", timeout=30) as response:
        state = json.loads(response.read().decode())
    ids = [row.get("id") for row in state.get("practitioners") or []]
    names = [row.get("name") for row in state.get("practitioners") or []]
    print("PUBLIC_PRACTITIONER_IDS", ids)
    print("PUBLIC_PRACTITIONER_NAMES", names)
    assert DATHUS_PRACTITIONER_ID not in ids
    assert not any(str(n or "").lower() == "dathus gilles" for n in names)
    assert NABITU_PRACTITIONER_ID in ids or any("nabitu" in str(n or "").lower() for n in names)
    print("VERIFY_OK")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
