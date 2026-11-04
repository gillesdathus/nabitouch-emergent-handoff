#!/usr/bin/env python3
"""Read-only: Nabitu credentials + live FE CPR kind presence."""
import asyncio
import json
import os
from datetime import date
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient
from onboarding import (
    assignment_credential_problem,
    credential_grace_deadline,
    missing_required_credentials,
    within_credential_grace,
)


async def dump_db():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    person = await db.nt_practitioners.find_one(
        {"id": "p-f3a4279b"},
        {
            "_id": 0,
            "activatedAt": 1,
            "onboardingStatus": 1,
            "name": 1,
            "available": 1,
            "bookable": 1,
            "credentialAttestations": 1,
            "credentialBookingOverrides": 1,
        },
    )
    credentials = await db.nt_credentials.find(
        {"practitionerId": "p-f3a4279b"}, {"_id": 0}
    ).to_list(40)
    print("PERSON", json.dumps(person, default=str))
    print(
        "GRACE",
        credential_grace_deadline(person).isoformat(),
        "WITHIN",
        within_credential_grace(person),
        "TODAY",
        date.today().isoformat(),
    )
    print("MISSING", missing_required_credentials(credentials))
    print("PROBLEM", assignment_credential_problem(person, credentials))
    for row in credentials:
        print(
            "CRED",
            json.dumps(
                {
                    "id": row.get("id"),
                    "kind": row.get("kind"),
                    "status": row.get("status"),
                    "expiresOn": row.get("expiresOn"),
                    "identifierLen": len(str(row.get("identifier") or "")),
                    "verifiedAt": row.get("verifiedAt"),
                    "verifiedBy": row.get("verifiedBy"),
                },
                default=str,
            ),
        )
    client.close()


def dump_fe():
    assets = Path("/var/www/nabitouch-next/assets")
    if not assets.exists():
        print("FE_ASSETS missing")
        return
    for path in sorted(assets.glob("Credentials-*.js")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        print(
            "OWNER_CHUNK",
            path.name,
            "CPR_LABEL",
            "CPR / First Aid" in text,
            "QUOTED_CPR",
            '"cpr"' in text,
        )
    hits = []
    for path in assets.glob("*.js"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "CPR / First Aid" in text and '"cpr"' in text:
            hits.append(path.name)
    print("CPR_CHUNKS", hits)


if __name__ == "__main__":
    if os.environ.get("MONGO_URL"):
        asyncio.run(dump_db())
    else:
        print("NO_MONGO_ENV")
    dump_fe()
