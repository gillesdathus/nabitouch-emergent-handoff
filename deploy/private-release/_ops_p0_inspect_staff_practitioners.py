#!/usr/bin/env python3
"""Read-only: resolve staff users and practitioner profiles by ID (not name alone)."""
import asyncio
import json
import os
import re

from motor.motor_asyncio import AsyncIOMotorClient

NAME_RE = re.compile(r"dathus|gilles|nabitu|kahindo", re.I)


def slim_user(row):
    return {
        "id": row.get("id"),
        "email": row.get("email"),
        "name": row.get("name"),
        "role": row.get("role"),
        "roles": row.get("roles"),
        "status": row.get("status"),
        "subject": row.get("subject"),
        "mfa": bool(row.get("mfaEnabled") or row.get("totpEnabled")),
        "createdAt": row.get("createdAt") or row.get("at"),
    }


def slim_person(row):
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "slug": row.get("slug"),
        "available": row.get("available"),
        "bookable": row.get("bookable"),
        "onboardingStatus": row.get("onboardingStatus"),
        "profileVisibility": row.get("profileVisibility"),
        "displayOrder": row.get("displayOrder"),
        "specialties": row.get("specialties"),
        "activatedAt": row.get("activatedAt"),
        "linkedUserId": row.get("linkedUserId") or row.get("userId"),
        "email": row.get("email"),
        "designation": row.get("designation"),
    }


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    print("DB", os.environ["DB_NAME"])

    users = await db.nt_users.find({}, {"_id": 0, "password": 0, "passwordHash": 0, "password_hash": 0}).to_list(200)
    people = await db.nt_practitioners.find({}, {"_id": 0, "bio": 0, "password_hash": 0}).to_list(100)
    schedules = await db.nt_schedules.find({}, {"_id": 0}).to_list(100)
    appt_counts = {}
    async for row in db.nt_appointments.aggregate(
        [{"$group": {"_id": "$practitionerId", "n": {"$sum": 1}}}]
    ):
        appt_counts[row["_id"]] = row["n"]

    print("USERS_TOTAL", len(users))
    for row in users:
        blob = json.dumps(row, default=str)
        if NAME_RE.search(blob) or row.get("role") in ("owner", "manager", "desk", "receptionist", "practitioner") or "owner" in (row.get("roles") or []):
            print("USER", json.dumps(slim_user(row), default=str))

    print("PRACTITIONERS_TOTAL", len(people))
    for row in people:
        blob = json.dumps(row, default=str)
        mark = "MATCH" if NAME_RE.search(blob) else "ALL"
        print(
            "PERSON",
            mark,
            json.dumps(
                {
                    **slim_person(row),
                    "appointments": appt_counts.get(row.get("id"), 0),
                    "hasSchedule": any(s.get("practitionerId") == row.get("id") for s in schedules),
                },
                default=str,
            ),
        )

    # Cross-links: users.subject -> practitioner id
    print("LINKS")
    by_id = {p.get("id"): p for p in people}
    for row in users:
        subject = row.get("subject")
        if subject:
            print(
                "LINK",
                json.dumps(
                    {
                        "userId": row.get("id"),
                        "userName": row.get("name"),
                        "email": row.get("email"),
                        "role": row.get("role"),
                        "roles": row.get("roles"),
                        "subject": subject,
                        "subjectPerson": slim_person(by_id[subject]) if subject in by_id else None,
                    },
                    default=str,
                ),
            )

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
