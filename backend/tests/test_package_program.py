"""Nabitouch Rewards package program — pricing, eligibility, no-expiry credits."""
from datetime import datetime, timedelta, timezone

import pytest

from package_program import (
    PACKAGE_TIERS,
    build_tier_product,
    credit_matches_treatment,
    eligible_slugs_for_duration,
    launch_package_program,
    package_unit_and_total_cents,
    service_price_cents,
    tier_product_id,
    validate_package_program,
)
from plans import _credit_expiry, credit_quote, issue_credits


SWEDISH = {"slug": "swedish", "name": "Swedish Massage", "prices": {"30": 70, "60": 120, "90": 165}}
DEEP = {"slug": "deep-tissue", "name": "Deep Tissue Massage", "prices": {"60": 130, "90": 180}}
HOT = {"slug": "hot-stone", "name": "Hot Stone Massage", "prices": {"60": 140, "90": 190}}
SENIOR = {"slug": "senior", "name": "Senior / Elderly Massage", "prices": {"30": 65, "60": 115}}
SERVICES = [SWEDISH, DEEP, HOT, SENIOR]


def test_launch_defaults_pause_sales_and_list_eligible_slugs():
    program = launch_package_program()
    assert program["salesEnabled"] is False
    assert program["paygEnrolmentEnabled"] is False
    assert program["noExpiryAtLaunch"] is True
    assert "swedish" in program["eligibleServiceSlugs"]
    assert "hot-stone" not in program["eligibleServiceSlugs"]
    assert [t["sessions"] for t in program["packageTiers"]] == [2, 4, 6, 8, 12]


def test_package_totals_from_catalogue_price_and_approved_discounts():
    # Spec example using proposed $110 / $155 would apply the same formula to live catalogue rows.
    list_60 = service_price_cents(SWEDISH, 60)
    assert list_60 == 12000
    for tier in PACKAGE_TIERS:
        unit, total = package_unit_and_total_cents(list_60, tier["sessions"], tier["discountCents"])
        assert unit == list_60 - tier["discountCents"]
        assert total == unit * tier["sessions"]
    unit4, total4 = package_unit_and_total_cents(12000, 4, 750)
    assert unit4 == 11250
    assert total4 == 45000


def test_package_discount_cannot_meet_or_exceed_list_price():
    with pytest.raises(ValueError):
        package_unit_and_total_cents(12000, 2, 12000)


def test_eligible_slugs_exclude_specialty_and_missing_duration():
    program = launch_package_program()
    at_60 = eligible_slugs_for_duration(program, SERVICES, 60)
    at_90 = eligible_slugs_for_duration(program, SERVICES, 90)
    assert "swedish" in at_60 and "deep-tissue" in at_60 and "senior" in at_60
    assert "hot-stone" not in at_60
    assert "senior" not in at_90  # catalogue has no 90-minute senior price
    assert "swedish" in at_90


def test_build_tier_product_is_draft_no_expiry_and_flexible():
    program = launch_package_program()
    eligible = eligible_slugs_for_duration(program, SERVICES, 60)
    product = build_tier_product(
        duration=60, sessions=4, discount_cents=750, service=SWEDISH,
        eligible_slugs=eligible, no_expiry=True, order=1,
    )
    assert product["status"] == "draft"
    assert product["rewardsPackage"] is True
    assert product["noExpiry"] is True
    assert product["validityDays"] is None
    assert product["priceCents"] == 45000
    assert product["regularCents"] == 48000
    assert product["eligibleSlugs"] == eligible
    assert tier_product_id(60, 4) == "plp-rewards-60-4"


def test_credit_match_exact_and_flexible():
    exact = {"serviceSlug": "swedish", "duration": 60, "eligibleSlugs": ["swedish"]}
    flex = {"serviceSlug": "swedish", "duration": 60, "eligibleSlugs": ["swedish", "deep-tissue", "sports"]}
    assert credit_matches_treatment(exact, "swedish", 60) is True
    assert credit_matches_treatment(exact, "deep-tissue", 60) is False
    assert credit_matches_treatment(flex, "deep-tissue", 60) is True
    assert credit_matches_treatment(flex, "deep-tissue", 90) is False


def test_credit_expiry_none_when_no_expiry_flag():
    assert _credit_expiry({"noExpiry": True, "validityDays": None}) is None
    assert _credit_expiry({"validityDays": 0}) is None
    stamped = _credit_expiry({"validityDays": 365})
    assert stamped and stamped > datetime.now(timezone.utc).isoformat()


def test_credit_quote_still_covers_treatment_only():
    quoted = {"base": 120, "addons": 15, "travel": 20, "discount": 0}
    priced = credit_quote(quoted, 11250, 0.05, {"taxable": True})
    assert priced["packageCredit"] is True
    assert priced["discount"] == 120
    assert priced["treatmentAfterDiscount"] == 0
    assert priced["total"] == round(15 + 20 + (15 + 20) * 0.05, 2)


def test_validate_package_program_drops_unknown_slugs():
    cleaned = validate_package_program(
        {"eligibleServiceSlugs": ["swedish", "not-a-service", "hot-stone"], "salesEnabled": True},
        services=SERVICES,
    )
    assert cleaned["salesEnabled"] is True
    assert "swedish" in cleaned["eligibleServiceSlugs"]
    assert "not-a-service" not in cleaned["eligibleServiceSlugs"]
    # hot-stone is in the catalogue but owner may still select it; eligibility policy is enforced at seed/defaults
    assert "hot-stone" in cleaned["eligibleServiceSlugs"]


def test_issue_credits_no_expiry_and_eligible_slugs():
    import asyncio

    stored = []

    class FakeCredits:
        async def insert_one(self, doc):
            stored.append(doc)

    class FakeLedger:
        async def insert_one(self, doc):
            return None

    class FakeDb:
        nt_credits = FakeCredits()
        nt_credit_ledger = FakeLedger()

    purchase = {
        "id": "pp-testpack01",
        "productId": "plp-rewards-60-2",
        "clientId": "c-1",
        "kind": "package",
        "serviceSlug": "swedish",
        "eligibleSlugs": ["swedish", "deep-tissue"],
        "duration": 60,
        "credits": 2,
        "unitCents": 11500,
        "noExpiry": True,
        "validityDays": None,
    }
    asyncio.run(issue_credits(FakeDb(), purchase))
    assert len(stored) == 2
    assert all(row["expiresAt"] is None and row["noExpiry"] is True for row in stored)
    assert all(row["eligibleSlugs"] == ["swedish", "deep-tissue"] for row in stored)
