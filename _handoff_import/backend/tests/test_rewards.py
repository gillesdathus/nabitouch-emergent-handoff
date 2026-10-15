"""Rewards ledger rules. No Mongo, Mapbox, or live awards."""
import pytest

from recovery import FEE_TEXT, launch_fee, validate_fee
from rewards import (
    apply_balance, attribute, badge_earned, can_configure, claim_key, default_badges, earn_points,
    eligible_spend_cents, launch_rewards, ledger_balance, preview_redemption, product_intent,
    reversal_points, rewards_from_client, safe_entry, validate_rewards,
)

RULES = {**launch_rewards()["rules"], "stackWithPromotions": False}


def quote(base=120, travel=30, discount=0, addons=0):
    return {"base": base, "discount": discount, "addons": addons, "travel": travel, "tax": 0, "total": base - discount + addons + travel}


def test_referral_abuse_and_one_first_visit_bonus():
    referrer = {"id": "c-a", "email": "a@example.com"}
    client = {"id": "c-b", "email": "b@example.com"}
    assert attribute(referrer, client, None, False) == "ok"
    assert attribute(client, client, None, False) == "self"
    assert attribute(referrer, {**client, "email": "a@example.com"}, None, False) == "self"
    assert attribute({"id": "c-a", "referredBy": "c-b"}, client, None, False) == "cycle"
    assert attribute(referrer, client, "c-a", False) == "already"
    assert attribute(referrer, client, None, True) == "too_late"
    seen = set()
    assert claim_key(seen, "welcome:c-b") is True
    assert claim_key(seen, "welcome:c-b") is False
    assert claim_key(seen, "referral:c-b") is True
    assert claim_key(seen, "referral:c-b") is False


def test_balance_reversal_and_concurrent_redemption():
    entries = [{"points": 200, "state": "posted"}, {"points": -50, "state": "posted"}, {"points": 20, "state": "reversed"}]
    assert ledger_balance(entries) == 150
    assert apply_balance(150, -80) == 70
    assert apply_balance(70, -80) is None
    seen = set()
    assert claim_key(seen, "redeem:a-1") is True
    assert claim_key(seen, "redeem:a-1") is False
    assert reversal_points(119, 12000, 12000) == 119
    assert reversal_points(100, 3000, 12000) == 25
    assert earn_points(199, RULES) == 1
    assert earn_points(eligible_spend_cents({"base": 120, "discount": 20, "loyaltyService": 0, "travel": 15, "loyaltyTravel": 0}), RULES) == 115


def test_stacking_travel_tax_and_rounding():
    blocked = preview_redemption(quote(discount=24), 1000, RULES, 0.05)
    assert blocked["ok"] is False and blocked["reason"] == "stacking"
    travel_only = preview_redemption(quote(), 3000, {**RULES, "serviceRedeemable": False}, 0.05)
    assert travel_only["ok"] is True
    assert travel_only["loyaltyService"] == 0
    assert travel_only["loyaltyTravel"] == 30
    priced = preview_redemption(quote(base=100, travel=0), 100, RULES, 0.05)
    assert priced["loyaltyService"] == 1
    assert priced["tax"] == 4.95
    assert priced["total"] == 103.95
    capped = preview_redemption(quote(base=120, travel=0), 100000, RULES, 0.05)
    assert capped["loyaltyService"] == 50
    assert capped["points"] == 5000


def test_badges_consent_boundary_and_flags():
    stats = {"completedVisits": 12, "qualifiedReferrals": 3}
    assert all(badge_earned(badge, stats) is False for badge in default_badges())
    gold = {**default_badges()[2], "active": True}
    assert badge_earned(gold, stats) is True
    assert badge_earned(gold, {"completedVisits": 11, "qualifiedReferrals": 3}) is False
    hidden = safe_entry({"id": "pts-1", "kind": "referral", "points": 200, "at": "t", "meta": {"email": "a@example.com", "soap": "private", "otherClientId": "c-b"}})
    assert "email" not in hidden["label"] and hidden["label"] == "Referral bonus"
    assert can_configure("owner") is True
    assert can_configure("practitioner") is False
    flags = launch_rewards()
    assert flags["enabled"] is False and flags["nabidermEnabled"] is False and flags["stackWithPromotions"] is False
    with pytest.raises(ValueError):
        validate_rewards({**flags, "earningEnabled": True})
    with pytest.raises(ValueError):
        validate_rewards({**flags, "nabidermEnabled": True}, authorize=True, tax_confirmed=True)
    with pytest.raises(ValueError):
        rewards_from_client({**flags, "enabled": True, "earningEnabled": True, "activationAuthorized": True, "taxTreatmentConfirmed": True})
    assert product_intent({"productId": "p", "sku": "sku", "orderId": "o", "paidCents": 2000, "status": "paid"}, flags)["reason"] == "disabled"
    fee = launch_fee()
    assert fee["enabled"] is False and fee["text"] == FEE_TEXT
    with pytest.raises(ValueError):
        validate_fee({**fee, "automaticCollection": True})
