"""Server-side booking quote. Mirrors frontend/src/lib/domain.js and ignores client totals."""
from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from zoneinfo import ZoneInfo

from municipalities import (
    municipality_selected,
    normalize_custom_municipalities,
    normalize_municipality_ids,
    resolve_municipality,
)

TZ = ZoneInfo("America/Edmonton")
CLINIC_POINT = {"lat": 53.5461, "lng": -113.4938}
BLOCKING_STATUSES = {
    "requested", "confirmed", "assigned", "preparing", "en_route", "arrived", "in_session",
    "session_ended", "soap_pending", "soap_completed", "leaving", "interrupted",
    "completed", "processing", "closed",
}


def money(value):
    """Currency amounts cross the legacy dollar fields only through integer cents."""
    from money import dollars, to_cents
    return dollars(to_cents(value))


def haversine_km(a, b):
    lat1, lng1, lat2, lng2 = map(radians, [a["lat"], a["lng"], b["lat"], b["lng"]])
    hav = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371 * asin(sqrt(hav))


def minutes(hhmm):
    hour, minute = str(hhmm).split(":")
    return int(hour) * 60 + int(minute)


def overlaps(start, duration, other_start, other_duration, buffer_min=30):
    return start < other_start + other_duration + buffer_min and other_start < start + duration + buffer_min


def zone_for(point, zones, center=None):
    center = center or CLINIC_POINT
    km = haversine_km(center, point)
    enabled = sorted((z for z in zones if z.get("enabled", True)), key=lambda z: float(z.get("radiusKm") or 0))
    for zone in enabled:
        if km <= float(zone.get("radiusKm") or 0):
            return zone, km
    return None, km


COVERAGE_MODES = ("open", "radius", "zones")
OPEN_ZONE = {"id": "z-open", "name": "Service area", "fee": 0, "perKm": 0, "enabled": True}


def launch_service_coverage():
    """Owner Booking → Service Coverage defaults. Open coverage; travel fees off."""
    return {
        "mode": "open",
        "radiusKm": 25,
        "travelFeesEnabled": False,
        "municipalityIds": [],
        "customMunicipalities": [],
    }


def service_coverage(settings):
    """Normalize coverage settings. Missing mode defaults to open; travel fees default off."""
    raw = (settings or {}).get("serviceCoverage")
    raw = raw if isinstance(raw, dict) else {}
    mode = raw.get("mode") if raw.get("mode") in COVERAGE_MODES else "open"
    try:
        radius = float(raw.get("radiusKm") if raw.get("radiusKm") is not None else 25)
    except (TypeError, ValueError):
        radius = 25.0
    if radius < 0:
        radius = 0.0
    if "travelFeesEnabled" in raw:
        fees_on = bool(raw.get("travelFeesEnabled"))
    else:
        fees_on = False
    return {
        "mode": mode,
        "radiusKm": radius,
        "travelFeesEnabled": fees_on,
        "municipalityIds": normalize_municipality_ids(raw.get("municipalityIds")),
        "customMunicipalities": normalize_custom_municipalities(raw.get("customMunicipalities")),
    }


def travel_fees_enabled(settings):
    return bool(service_coverage(settings)["travelFeesEnabled"])


def _municipality_zone(muni, matched):
    """Prefer a matching travel ring when fees apply; otherwise a named open zone."""
    if matched:
        out = dict(matched)
        if muni and muni.get("id"):
            out["municipalityId"] = muni.get("id")
        return out
    if not muni:
        return dict(OPEN_ZONE)
    return {
        "id": f"muni-{muni.get('id')}",
        "name": muni.get("name") or "Service area",
        "fee": 0,
        "perKm": 0,
        "enabled": True,
        "municipalityId": muni.get("id"),
    }


def assess_coverage(point, zones, settings, place_hint=""):
    """Return (zone, km, eligible) using the owner coverage mode.

    open — any geocoded point is eligible (named zone when inside a ring, else open zone).
    radius — eligible within settings.serviceCoverage.radiusKm of the service center.
    zones — eligible inside owner-selected municipalities when configured; otherwise
            inside an enabled custom/radius ring (legacy rings).
    """
    matched, km = zone_for(point, zones, (settings or {}).get("center"))
    cov = service_coverage(settings)
    mode = cov["mode"]
    if mode == "open":
        return (matched or dict(OPEN_ZONE)), km, True
    if mode == "radius":
        eligible = km <= float(cov["radiusKm"] or 0)
        if not eligible:
            return None, km, False
        return (matched or dict(OPEN_ZONE)), km, True
    selected = cov.get("municipalityIds") or []
    custom = cov.get("customMunicipalities") or []
    if selected or custom:
        muni = resolve_municipality(point, custom=custom, place_hint=place_hint)
        if not muni:
            return None, km, False
        if muni.get("match") == "custom_radius":
            return _municipality_zone(muni, matched), km, True
        if municipality_selected(muni, selected):
            return _municipality_zone(muni, matched), km, True
        return None, km, False
    # Legacy rings when the owner has not configured municipality coverage yet.
    return matched, km, bool(matched)


def _today():
    return datetime.now(TZ)


def normalize_email(value):
    return str(value or "").strip().lower()


def phone_tail(value):
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else ""


def identity_keys(person):
    """Keys that tie the one welcome benefit to a person, not to a new login."""
    person = person or {}
    keys = []
    if person.get("id"):
        keys.append(f"client:{person['id']}")
    email = normalize_email(person.get("email"))
    if email:
        keys.append(f"email:{email}")
    tail = phone_tail(person.get("phone"))
    if tail:
        keys.append(f"phone:{tail}")
    return keys


def client_matches_person(row, person):
    """Match a stored client to the person booking. An empty email or phone matches nobody."""
    row = row or {}
    person = person or {}
    if person.get("id") and row.get("id") == person.get("id"):
        return True
    email = normalize_email(person.get("email"))
    row_email = normalize_email(row.get("email"))
    if email and row_email and email == row_email:
        return True
    tail = phone_tail(person.get("phone"))
    return bool(tail) and tail == phone_tail(row.get("phone"))


def welcome_claimed(appt):
    pricing = (appt or {}).get("pricing") or {}
    if pricing.get("welcomeOffer") is True:
        return True
    if str(pricing.get("promoCode") or "").upper() == "WELCOME20":
        return True
    return str(pricing.get("promoId") or "") == "promo-welcome"


def welcome_history_blocks(appointments):
    """One welcome benefit. Appointment history decides, not a browser flag or a new profile.

    Requested, confirmed, completed, and every other live status block another claim.
    A no-show blocks as well: the visit was not released.
    Cancelled and refunded appointments block only when that visit already received the welcome benefit.
    A cancelled or refunded visit that never received it leaves the person eligible.
    Free standalone trial appointments never consume first-regular-booking eligibility.
    """
    from trial import is_trial_appointment

    for appt in appointments or []:
        status = str((appt or {}).get("status") or "")
        if not status:
            continue
        if is_trial_appointment(appt):
            # Trial is lead acquisition only; welcome stays for the first regular booking.
            if welcome_claimed(appt):
                return True
            continue
        if welcome_claimed(appt):
            return True
        if status in {"cancelled", "refunded"}:
            continue
        return True
    return False


def launch_welcome_offer():
    """Owner-approved first-booking offer for the prepared launch seed. It is not written to production here."""
    return {
        "id": "promo-welcome",
        "code": "WELCOME20",
        "name": "Your First Massage, 20% Off.",
        "type": "percent",
        "value": 20,
        "maxDiscount": 40,
        "eligibility": "first_online",
        "start": None,
        "end": None,
        "services": "all",
        "stackable": False,
        "redemptionLimit": None,
        "redemptions": 0,
        "enabled": True,
        "approval": "approved",
        "appliesTo": "treatment",
        "requiresMarketingConsent": False,
        "placements": ["home", "account", "booking", "services", "offers"],
        "bannerHeadline": "Your First Massage, 20% Off.",
        "bannerBody": "Book your first eligible regular massage through the Nabitouch app and enjoy 20% off.",
        "ctaLabel": "Book my first massage",
    }


async def ensure_welcome_offer(db):
    """Idempotent upsert of WELCOME20 so Home/Offers can surface it without a manual seed."""
    row = launch_welcome_offer()
    existing = await db.nt_promotions.find_one({"id": "promo-welcome"}, {"_id": 0})
    if not existing:
        await db.nt_promotions.insert_one(dict(row))
        return row, True
    # Preserve owner toggles (enabled/approval/placements) while restoring missing public copy fields.
    patch = {}
    if not existing.get("bannerHeadline"):
        patch["bannerHeadline"] = row["bannerHeadline"]
    if not existing.get("bannerBody"):
        patch["bannerBody"] = row["bannerBody"]
    if not existing.get("ctaLabel"):
        patch["ctaLabel"] = row["ctaLabel"]
    places = existing.get("placements")
    if isinstance(places, list) and "offers" not in places:
        patch["placements"] = list(places) + ["offers"]
    if existing.get("name") in (None, "", "First-booking welcome offer"):
        patch["name"] = row["name"]
    if patch:
        await db.nt_promotions.update_one({"id": "promo-welcome"}, {"$set": patch})
        existing = {**existing, **patch}
    return existing, False


def promo_shows(promo, placement):
    """Gate banner display by placement list. Missing placements default to home + account."""
    if not promo:
        return False
    places = promo.get("placements")
    if not isinstance(places, list) or not places:
        places = ["home", "account"]
    return placement in places


def promo_eligible(promo, client, slug, today=None):
    today = today or _today()
    day = today.date().isoformat()
    if promo.get("approval") != "approved":
        return False
    if not promo.get("enabled", True):
        return False
    if promo.get("start") and str(promo["start"]) > day:
        return False
    if promo.get("end") and str(promo["end"]) < day:
        return False
    services = promo.get("services", "all")
    if services != "all" and slug not in (services or []):
        return False
    limit = promo.get("redemptionLimit")
    if limit and int(promo.get("redemptions") or 0) >= int(limit):
        return False
    kind = promo.get("eligibility")
    if kind == "first_online":
        if client is None or "_welcomeHistory" not in client or client.get("_welcomeHistory") is None:
            return False
        if client.get("_profileComplete") is False:
            return False
        return not welcome_history_blocks(client.get("_welcomeHistory"))
    if kind == "birthday_month":
        dob = (client or {}).get("dob") or ""
        parts = str(dob).split("-")
        if client is None or len(parts) < 2:
            return False
        if promo.get("requiresMarketingConsent") and not client.get("marketingConsent"):
            return False
        try:
            return int(parts[1]) == today.month
        except ValueError:
            return False
    return False


def _calc(promo, base):
    if promo.get("type") == "percent":
        raw = base * float(promo.get("value") or 0) / 100
    else:
        raw = float(promo.get("value") or 0)
    cap = promo.get("maxDiscount")
    capped = raw if cap is None else min(raw, float(cap))
    return min(capped, base)


def zone_travel(zone, km, location_type, settings=None):
    """Flat zone fee, plus optional per-km amount when the owner sets one. Clinic visits stay free.

    Travel fees stay off unless settings.serviceCoverage.travelFeesEnabled is true.
    """
    if location_type == "clinic" or not zone:
        return 0.0
    if settings is not None and not travel_fees_enabled(settings):
        return 0.0
    if settings is None:
        # Callers that omit settings (legacy unit helpers) still compute the zone fee.
        pass
    return float(zone.get("fee") or 0) + float(zone.get("perKm") or 0) * float(km or 0)


def quote(*, service, duration, addons, zone, client, promotions, settings, location_type, today=None, km=0):
    prices = (service or {}).get("prices") or {}
    base = float(prices.get(str(duration)) or 0)
    catalog = settings.get("addons") or []
    chosen = [a for a in catalog if a.get("id") in set(addons or [])]
    addons_total = sum(float(a.get("price") or 0) for a in chosen)
    eligible = [p for p in promotions if service and promo_eligible(p, client, service.get("slug") or service.get("id"), today)]
    welcome = [p for p in eligible if p.get("eligibility") == "first_online"]
    if welcome:
        best = max(welcome, key=lambda p: _calc(p, base))
        applied = [best]
    else:
        ranked = sorted((p for p in eligible if not p.get("stackable")), key=lambda p: _calc(p, base), reverse=True)
        best = ranked[0] if ranked else None
        applied = ([best] if best else []) + [p for p in eligible if p.get("stackable")]
    discount = min(sum(_calc(p, base) for p in applied), base)
    travel = zone_travel(zone, km, location_type, settings)
    subtotal = base - discount + addons_total + travel
    if (service or {}).get("taxable") is False:
        tax = 0.0
    else:
        gst = float(settings.get("gst") if settings.get("gst") is not None else 0.05)
        tax = money(subtotal * gst)
    return {
        "base": money(base),
        "addons": money(addons_total),
        "addonList": [a.get("name") for a in chosen],
        "discount": money(discount),
        "promoId": (best or {}).get("id"),
        "promoName": "First-booking welcome offer" if (best or {}).get("eligibility") == "first_online" else (best or {}).get("name"),
        "promoCode": (best or {}).get("code"),
        "welcomeOffer": (best or {}).get("eligibility") == "first_online",
        "appliedPromoIds": [p.get("id") for p in applied if p],
        "travel": money(travel),
        "tax": tax,
        "total": money(subtotal + tax),
        "treatmentAfterDiscount": money(base - discount),
    }
