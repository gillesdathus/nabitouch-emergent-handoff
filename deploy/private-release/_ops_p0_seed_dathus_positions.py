#!/usr/bin/env python3
"""Set display positions for Dathus Gilles staff account without changing roles."""
import asyncio
import json
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

DATHUS_USER_ID = "8dcf5a32-75eb-458f-b277-0bc7847f0114"
DATHUS_EMAIL = "gdathus@gmail.com"
POSITIONS = ["owner", "general_manager", "receptionist"]


async def main():
    if os.environ.get("CONFIRM_P0_DATHUS_POSITIONS") != "yes":
        raise SystemExit("Refusing. Set CONFIRM_P0_DATHUS_POSITIONS=yes")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    user = await db.nt_users.find_one({"id": DATHUS_USER_ID}, {"_id": 0, "password_hash": 0})
    if not user or (user.get("email") or "").lower() != DATHUS_EMAIL:
        raise SystemExit("Dathus staff user not found")
    if "practitioner" in (user.get("roles") or []):
        raise SystemExit("Refusing: practitioner role still present on Dathus account")
    await db.nt_users.update_one(
        {"id": DATHUS_USER_ID, "email": DATHUS_EMAIL},
        {"$set": {"positions": POSITIONS, "customPositionTitle": ""}},
    )
    await db.nt_staff_role_history.insert_one(
        {
            "id": f"srh-seed-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
            "at": datetime.now(timezone.utc).isoformat(),
            "actorId": "ops",
            "actorName": "ops-p0-seed-positions",
            "targetId": DATHUS_USER_ID,
            "targetEmail": DATHUS_EMAIL,
            "targetName": user.get("name"),
            "beforeRoles": user.get("roles") or [],
            "afterRoles": user.get("roles") or [],
            "beforePositions": user.get("positions") or [],
            "afterPositions": POSITIONS,
            "note": "Seed display positions for Owner / General Manager / Receptionist",
        }
    )
    updated = await db.nt_users.find_one(
        {"id": DATHUS_USER_ID},
        {"_id": 0, "id": 1, "email": 1, "roles": 1, "subject": 1, "positions": 1, "status": 1},
    )
    print("SEEDED", json.dumps(updated, default=str))
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
