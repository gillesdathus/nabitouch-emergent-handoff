"""Standalone "10 Minutes. On Us." trial booking helpers.

Trial visits are free lead-acquisition appointments. They are not flash discounts,
package credits, gift-card redemptions, or first-regular-booking welcome offers.
"""

TRIAL_SERVICE_SLUG = "ten-minutes-on-us"
TRIAL_DURATION_MIN = 10
TRIAL_TREATMENT_SCOPE = "neck_shoulders"
TRIAL_CAMPAIGN_CODE = "TENMIN"
DEFAULT_TRIAL_PRACTITIONER_ID = "p-nabitu-kahindo"


def launch_trial_service():
    """Catalogue row for the free standalone neck-and-shoulder trial."""
    return {
        "id": TRIAL_SERVICE_SLUG,
        "slug": TRIAL_SERVICE_SLUG,
        "name": "10 Minutes. On Us.",
        "short": "Free 10-minute neck-and-shoulder massage.",
        "description": "Meet your massage therapist and experience Nabitouch. Neck and shoulders only.",
        "benefits": [
            "Introduce yourself to Nabitu Kahindo",
            "Experience Nabitouch before a full session",
            "Neck and shoulders only",
        ],
        "goals": ["Lead acquisition", "Meet your therapist", "Neck & shoulder relief"],
        "prices": {str(TRIAL_DURATION_MIN): 0},
        "img": "/img/swedish.jpg",
        "mobile": False,
        "clinic": True,
        "enabled": True,
        "taxable": False,
        "kind": "trial",
        "treatmentScope": TRIAL_TREATMENT_SCOPE,
        "category": "specialty",
        "publication": "published",
        "prep": [
            "This is a free 10-minute trial focused on neck and shoulders only.",
            "Wear comfortable clothing; full undressing is not required.",
            "After your trial you can book a regular massage. Any eligible first-booking welcome offer is preserved.",
        ],
    }


def is_trial_service(service):
    if not service:
        return False
    if service.get("kind") == "trial":
        return True
    return service.get("slug") == TRIAL_SERVICE_SLUG


def is_trial_offer(offer):
    if not offer:
        return False
    kind = offer.get("offerKind") or offer.get("campaignOfferKind")
    if kind == "trial":
        return True
    if kind == "complimentary" and int(offer.get("complimentaryMinutes") or 0) == TRIAL_DURATION_MIN:
        # Legacy template rows treated as trial when they match the acquisition campaign.
        return (offer.get("code") or "").upper() == TRIAL_CAMPAIGN_CODE or offer.get("id") == "cmp-ten-minutes-on-us"
    return False


def is_trial_appointment(appt):
    """True when the visit is the free standalone trial, not a regular paid service."""
    if not appt:
        return False
    if appt.get("appointmentKind") == "trial":
        return True
    pricing = appt.get("pricing") or {}
    if pricing.get("campaignOfferKind") == "trial":
        return True
    if appt.get("serviceSlug") == TRIAL_SERVICE_SLUG:
        return True
    return False


def trial_duration_ok(duration):
    try:
        return int(duration) == TRIAL_DURATION_MIN
    except (TypeError, ValueError):
        return False


async def ensure_trial_service(db):
    """Upsert the trial catalogue row without changing unrelated services."""
    row = launch_trial_service()
    existing = await db.nt_services.find_one({"slug": TRIAL_SERVICE_SLUG}, {"_id": 0, "id": 1})
    if existing:
        await db.nt_services.update_one(
            {"slug": TRIAL_SERVICE_SLUG},
            {"$set": {
                "name": row["name"],
                "short": row["short"],
                "description": row["description"],
                "prices": row["prices"],
                "taxable": False,
                "kind": "trial",
                "treatmentScope": TRIAL_TREATMENT_SCOPE,
                "clinic": True,
                "mobile": False,
                "enabled": True,
                "publication": "published",
                "prep": row["prep"],
            }},
        )
        return
    await db.nt_services.insert_one(dict(row))
