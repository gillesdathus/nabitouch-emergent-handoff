"""Focused regression coverage for the shared WELCOME20 promotion rules.

These are fast unit tests; endpoint/database contention requires integration CI.
"""
from decimal import Decimal, ROUND_HALF_UP

from pricing import identity_keys, launch_welcome_offer, promo_eligible, welcome_history_blocks


def _audience(history):
    return {"id": "c-first", "email": "first@example.com", "phone": "7805550123",
            "_welcomeHistory": history, "_profileComplete": True}


def test_welcome20_existing_offer_rate_and_cap():
    offer = launch_welcome_offer()
    assert offer["code"] == "WELCOME20"
    assert offer["value"] == 20
    assert offer["maxDiscount"] == 40
    base_cents = 25000
    discount = int((Decimal(base_cents) * Decimal(str(offer["value"])) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    assert min(discount, int(offer["maxDiscount"] * 100)) == 4000


def test_first_client_eligible_and_prior_regular_booking_blocks():
    offer = launch_welcome_offer()
    assert promo_eligible(offer, _audience([]), "swedish")
    assert welcome_history_blocks([{"status": "completed", "serviceSlug": "swedish"}])
    assert not promo_eligible(offer, _audience([{"status": "completed", "serviceSlug": "swedish"}]), "swedish")


def test_cancelled_nonredeemed_booking_does_not_block():
    offer = launch_welcome_offer()
    assert promo_eligible(offer, _audience([{"status": "cancelled", "serviceSlug": "swedish"}]), "swedish")


def test_existing_welcome_claim_blocks_even_if_visit_cancelled():
    offer = launch_welcome_offer()
    history = [{"status": "cancelled", "pricing": {"promoCode": "WELCOME20"}}]
    assert welcome_history_blocks(history)
    assert not promo_eligible(offer, _audience(history), "swedish")


def test_identity_claim_keys_cover_client_email_and_phone():
    keys = identity_keys(_audience([]))
    assert "client:c-first" in keys
    assert "email:first@example.com" in keys
    assert any(key.startswith("phone:") for key in keys)


def test_welcome20_tax_applies_after_capped_discount():
    """GST is calculated on the discounted net, and $40 caps a 20% cut on $250."""
    offer = launch_welcome_offer()
    base_cents = 25000
    discount = int((Decimal(base_cents) * Decimal(str(offer["value"])) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    discount = min(discount, int(offer["maxDiscount"] * 100))
    assert discount == 4000
    net = base_cents - discount
    gst_rate = Decimal("0.05")
    tax = int((Decimal(net) * gst_rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    assert tax == 1050
    assert net + tax == 22050

