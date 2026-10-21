"""Nabitouch Rewards — prepaid package program settings and pricing helpers.

Reuses Wellness Plan products/credits. Does not invent a second ledger.
Legacy points rewards (settings.rewards) stay separate and launch-gated.
"""
from __future__ import annotations

# Catalogue slugs that participate in Rewards packages (60/90 where offered).
# Specialty-priced treatments (hot-stone, hand-arm, scalp, foot-reflexology, trial) stay out.
DEFAULT_ELIGIBLE_SLUGS = (
    "swedish",       # also covers "relaxation" positioning in the catalogue
    "deep-tissue",
    "sports",
    "prenatal",
    "senior",
)

# Fixed per-session discounts (CAD cents) for approved package sizes.
PACKAGE_TIERS = (
    {"sessions": 2, "discountCents": 500},
    {"sessions": 4, "discountCents": 750},
    {"sessions": 6, "discountCents": 1000},
    {"sessions": 8, "discountCents": 1200},
    {"sessions": 12, "discountCents": 1500},
)

ELIGIBLE_DURATIONS = (60, 90)


def launch_package_program():
    """Defaults: sales paused until owner enables; no auto-expiry on new Rewards packs."""
    return {
        "salesEnabled": False,
        "paygEnrolmentEnabled": False,
        "referralCashEnabled": False,
        "eligibleServiceSlugs": list(DEFAULT_ELIGIBLE_SLUGS),
        "eligibleDurations": list(ELIGIBLE_DURATIONS),
        "packageTiers": [dict(row) for row in PACKAGE_TIERS],
        "noExpiryAtLaunch": True,
        "referencePricingSlug": "swedish",
    }


def validate_package_program(incoming, *, services=None):
    """Normalize owner edits. Unknown slugs are dropped when a service list is provided."""
    current = launch_package_program()
    raw = incoming if isinstance(incoming, dict) else {}
    slugs = raw.get("eligibleServiceSlugs")
    if not isinstance(slugs, list) or not slugs:
        slugs = current["eligibleServiceSlugs"]
    clean_slugs = []
    allowed = None
    if services is not None:
        allowed = {s.get("slug") for s in services if s and s.get("slug")}
    for slug in slugs:
        value = str(slug or "").strip()[:80]
        if not value or value in clean_slugs:
            continue
        if allowed is not None and value not in allowed:
            continue
        clean_slugs.append(value)
    if not clean_slugs:
        clean_slugs = list(DEFAULT_ELIGIBLE_SLUGS)

    durations = raw.get("eligibleDurations")
    if not isinstance(durations, list) or not durations:
        durations = current["eligibleDurations"]
    clean_durations = sorted({int(d) for d in durations if str(d).isdigit() and int(d) in (30, 45, 60, 75, 90, 120)})
    if not clean_durations:
        clean_durations = list(ELIGIBLE_DURATIONS)

    tiers_in = raw.get("packageTiers")
    if not isinstance(tiers_in, list) or not tiers_in:
        tiers_in = current["packageTiers"]
    tiers = []
    for row in tiers_in:
        if not isinstance(row, dict):
            continue
        sessions = int(row.get("sessions") or 0)
        discount = int(row.get("discountCents") or 0)
        if sessions < 1 or sessions > 24:
            continue
        if discount < 0 or discount > 50_000:
            continue
        tiers.append({"sessions": sessions, "discountCents": discount})
    if not tiers:
        tiers = [dict(row) for row in PACKAGE_TIERS]

    ref = str(raw.get("referencePricingSlug") or current["referencePricingSlug"] or "swedish").strip()[:80]
    if ref not in clean_slugs:
        ref = clean_slugs[0]

    return {
        "salesEnabled": bool(raw["salesEnabled"]) if "salesEnabled" in raw else bool(current["salesEnabled"]),
        "paygEnrolmentEnabled": bool(raw["paygEnrolmentEnabled"]) if "paygEnrolmentEnabled" in raw else bool(current["paygEnrolmentEnabled"]),
        "referralCashEnabled": bool(raw["referralCashEnabled"]) if "referralCashEnabled" in raw else bool(current["referralCashEnabled"]),
        "eligibleServiceSlugs": clean_slugs,
        "eligibleDurations": clean_durations,
        "packageTiers": tiers,
        "noExpiryAtLaunch": bool(raw["noExpiryAtLaunch"]) if "noExpiryAtLaunch" in raw else bool(current["noExpiryAtLaunch"]),
        "referencePricingSlug": ref,
    }


def service_price_cents(service, duration):
    """List price in cents from the live catalogue row. Does not invent prices."""
    if not service:
        return None
    prices = service.get("prices") or {}
    raw = prices.get(str(duration))
    if raw is None:
        return None
    try:
        dollars = float(raw)
    except (TypeError, ValueError):
        return None
    if dollars < 0:
        return None
    return int(round(dollars * 100))


def package_unit_and_total_cents(list_cents, sessions, discount_cents):
    """Per-session prepaid unit and package pre-tax total from list price − approved discount."""
    list_cents = int(list_cents)
    sessions = int(sessions)
    discount_cents = int(discount_cents)
    if sessions < 1:
        raise ValueError("Package needs at least one session")
    if discount_cents < 0 or discount_cents >= list_cents:
        raise ValueError("Package discount must be less than the treatment list price")
    unit = list_cents - discount_cents
    return unit, unit * sessions


def credit_matches_treatment(credit, slug, duration):
    """Exact historical credits or flexible Rewards credits with eligibleSlugs."""
    if not credit or int(credit.get("duration") or 0) != int(duration):
        return False
    if credit.get("serviceSlug") == slug:
        return True
    eligible = credit.get("eligibleSlugs") or []
    return isinstance(eligible, list) and slug in eligible


def eligible_slugs_for_duration(program, services, duration):
    """Slugs that are program-eligible and offer the duration in the catalogue."""
    program = program or launch_package_program()
    wanted = set(program.get("eligibleServiceSlugs") or [])
    out = []
    for service in services or []:
        slug = service.get("slug")
        if slug not in wanted:
            continue
        if service_price_cents(service, duration) is None:
            continue
        out.append(slug)
    return out


def build_tier_product(*, duration, sessions, discount_cents, service, eligible_slugs, no_expiry, order=0):
    """Draft package product priced from the given catalogue service row."""
    list_cents = service_price_cents(service, duration)
    if list_cents is None:
        raise ValueError(f"{service.get('slug')} has no {duration}-minute price")
    unit, total = package_unit_and_total_cents(list_cents, sessions, discount_cents)
    slug = service["slug"]
    name = f"{duration}-min Rewards {sessions}-pack"
    return {
        "kind": "package",
        "name": name,
        "description": (
            f"{sessions} prepaid {duration}-minute visits. "
            f"${discount_cents / 100:.2f} off each session vs list price. "
            "Redeem on eligible standard treatments of this length."
        ),
        "serviceSlug": slug,
        "serviceName": service.get("name") or slug,
        "duration": int(duration),
        "credits": int(sessions),
        "priceCents": int(total),
        "regularCents": int(list_cents) * int(sessions),
        "discountPerSessionCents": int(discount_cents),
        "unitCents": int(unit),
        "eligibleSlugs": list(eligible_slugs),
        "validityDays": None if no_expiry else 365,
        "noExpiry": bool(no_expiry),
        "rewardsPackage": True,
        "order": int(order),
        "status": "draft",
    }


def tier_product_id(duration, sessions):
    return f"plp-rewards-{duration}-{sessions}"
