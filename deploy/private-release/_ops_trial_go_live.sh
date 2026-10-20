#!/bin/bash
# Set "10 Minutes. On Us." campaign live. Does not enable promotional sending.
# Does not change practitioner availability flags.
set -euo pipefail

docker exec -i nt-next-api python - <<'PY'
import asyncio, os
from datetime import datetime, timedelta, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from recovery import campaign_live, public_campaign, campaign_fits

CID = "cmp-7a98afbe"
PID = "p-f3a4279b"

async def main():
    uri = os.environ["MONGO_URL"]
    dbn = os.environ.get("DB_NAME") or "nabitouch_prod"
    client = AsyncIOMotorClient(uri)
    db = client[dbn]
    now = datetime.now(timezone.utc)

    before = await db.nt_campaigns.find_one({"id": CID}, {"_id": 0})
    if not before:
        raise SystemExit("campaign missing")
    print("BEFORE", {k: before.get(k) for k in (
        "id", "title", "status", "offerKind", "serviceSlug", "public", "sendingEnabled",
        "expiresAt", "publishAt", "bookingStart", "bookingEnd", "windowStart", "windowEnd",
        "practitionerId", "locationTypes", "maxRedemptions", "redemptions", "complimentaryMinutes",
    )})

    prac = await db.nt_practitioners.find_one({"id": PID}, {"_id": 0, "available": 1, "name": 1})
    avail_before = prac.get("available") if prac else None
    print("NABITU_AVAILABLE_BEFORE", avail_before)

    updates = {
        "status": "live",
        "public": True,
        "sendingEnabled": False,  # no outbound marketing blast
        "offerKind": "trial",
        "serviceSlug": "ten-minutes-on-us",
        "durationMinutes": 10,
        "complimentaryMinutes": 10,
        "treatmentScope": "neck_shoulders",
        "practitionerId": PID,
        "minDuration": 10,
        "stackable": False,
        "locationTypes": [loc for loc in (before.get("locationTypes") or ["home", "office", "hotel", "event"]) if loc != "clinic"] or ["home", "office", "hotel", "event"],
        "bookingChannels": before.get("bookingChannels") or ["app"],
        "windowStart": before.get("windowStart") or "09:00",
        "windowEnd": before.get("windowEnd") or "20:00",
        "bookingStart": before.get("bookingStart") or now.date().isoformat(),
        "bookingEnd": before.get("bookingEnd") or (now + timedelta(days=365)).date().isoformat(),
        "publishAt": now.isoformat(),
        "expiresAt": before.get("expiresAt") if before.get("expiresAt") and before.get("expiresAt") > now.isoformat()
            else (now + timedelta(days=365)).isoformat(),
        "maxRedemptions": int(before.get("maxRedemptions") or 30),
        "perClientLimit": int(before.get("perClientLimit") or 1),
        "updatedAt": now.isoformat(),
        "wentLiveAt": now.isoformat(),
        "wentLiveBy": "ops-owner-approved-0c99ada",
    }
    if before.get("redemptions") is None:
        updates["redemptions"] = 0

    await db.nt_campaigns.update_one({"id": CID}, {"$set": updates})
    after = await db.nt_campaigns.find_one({"id": CID}, {"_id": 0})

    # availability must be untouched
    prac2 = await db.nt_practitioners.find_one({"id": PID}, {"_id": 0, "available": 1})
    print("NABITU_AVAILABLE_AFTER", prac2.get("available"))
    assert prac2.get("available") == avail_before, "availability changed — abort condition"

    stamp = now
    live_ok = campaign_live(after, stamp)
    pub = public_campaign(after, stamp)
    fits = campaign_fits(after, stamp.date().isoformat(), "10:00", 10, "ten-minutes-on-us", "clinic")
    print("AFTER", {k: after.get(k) for k in (
        "id", "title", "status", "offerKind", "serviceSlug", "public", "sendingEnabled",
        "expiresAt", "publishAt", "practitionerId", "locationTypes", "treatmentScope",
        "durationMinutes", "maxRedemptions", "redemptions",
    )})
    print("campaign_live", live_ok)
    print("public_campaign_ok", bool(pub), "remaining", (pub or {}).get("remaining"), "headline", (pub or {}).get("headline"))
    print("campaign_fits_clinic_10", fits)

    await db.nt_audit.insert_one({
        "id": "aud-trial-live-" + now.strftime("%Y%m%d%H%M%S"),
        "at": now.isoformat(),
        "actor": "ops",
        "action": f"Campaign {CID} live (10 Minutes. On Us. trial)",
        "appointmentId": None,
    })
    print("GO_LIVE_OK", CID)
    client.close()

asyncio.run(main())
PY
