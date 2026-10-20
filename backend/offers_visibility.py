"""Server-driven promotion visibility for identified clients.

Reuses existing identity keys, appointment history, welcome claims, and campaign
redemptions. Does not invent new matching policies or expose another person's data.
Anonymous visitors stay provisional (known=false) until identity is established.
"""
from pricing import client_matches_person, identity_keys, welcome_history_blocks
from trial import has_regular_treatment_history, is_trial_appointment

# Projection shared by pricing and visibility so trial markers are never dropped.
HISTORY_PROJECTION = {
    "_id": 0,
    "status": 1,
    "paymentStatus": 1,
    "appointmentKind": 1,
    "serviceSlug": 1,
    "pricing.promoId": 1,
    "pricing.promoCode": 1,
    "pricing.welcomeOffer": 1,
    "pricing.campaignOfferKind": 1,
}


def trial_history_blocks(appointments):
    """True when this person already has a live or completed free-trial visit."""
    for appt in appointments or []:
        if not is_trial_appointment(appt):
            continue
        status = str((appt or {}).get("status") or "")
        if not status or status in {"cancelled", "refunded"}:
            continue
        return True
    return False


def offer_eligibility_from_records(*, history, welcome_claimed=False, trial_reserved=0):
    """Booleans for personalized surfaces. known=true means identity was established."""
    welcome = (not welcome_history_blocks(history)) and (not welcome_claimed)
    trial = (
        (not has_regular_treatment_history(history))
        and (not trial_history_blocks(history))
        and int(trial_reserved or 0) <= 0
    )
    return {"known": True, "welcome": bool(welcome), "trial": bool(trial)}


def provisional_offer_eligibility():
    return {"known": False, "welcome": None, "trial": None}


async def matched_client_ids(db, person):
    """Client ids that share this person's approved identity keys (id, email, phone)."""
    person = person or {}
    matched = []
    async for row in db.nt_clients.find({}, {"_id": 0, "id": 1, "email": 1, "phone": 1}):
        if client_matches_person(row, person):
            matched.append(row["id"])
    if person.get("id") and person["id"] not in matched:
        matched.append(person["id"])
    return matched


async def load_person_appointment_history(db, client_ids):
    if not client_ids:
        return []
    return await db.nt_appointments.find(
        {"clientId": {"$in": list(client_ids)}},
        HISTORY_PROJECTION,
    ).to_list(500)


async def welcome_claim_exists(db, person):
    keys = identity_keys(person)
    if not keys:
        return False
    return bool(await db.nt_welcome_claims.find_one({"key": {"$in": keys}}, {"_id": 1}))


async def trial_redemption_count(db, client_ids):
    """Reserved or awarded trial seats across linked client ids (guest → account continuity)."""
    if not client_ids:
        return 0
    trial_ids = [
        row["id"]
        for row in await db.nt_campaigns.find({"offerKind": "trial"}, {"_id": 0, "id": 1}).to_list(50)
        if row.get("id")
    ]
    if not trial_ids:
        return 0
    return await db.nt_campaign_redemptions.count_documents({
        "campaignId": {"$in": trial_ids},
        "clientId": {"$in": list(client_ids)},
        "status": {"$in": ["reserved", "awarded"]},
    })


async def resolve_offer_eligibility(db, person):
    """Eligibility for the identified person only. Never lookup by bare email for strangers."""
    person = person or {}
    if not (person.get("id") or person.get("email") or person.get("phone")):
        return provisional_offer_eligibility()
    matched = await matched_client_ids(db, person)
    history = await load_person_appointment_history(db, matched)
    claimed = await welcome_claim_exists(db, person)
    reserved = await trial_redemption_count(db, matched)
    return offer_eligibility_from_records(
        history=history, welcome_claimed=claimed, trial_reserved=reserved,
    )
