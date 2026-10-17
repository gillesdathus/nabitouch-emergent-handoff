import pytest

from availability import clinic_is_bookable, clinic_visit_address, public_clinic
from insurers import catalog, invoke
from payment_policy import (
    allowed_online_amounts,
    checkout_event_action,
    closed_policy,
    collection_status,
    due_after_payment,
    review_after_expiry,
    deposit_cents,
    preview_policy,
    resolve_payment_policy,
    settlement,
)
from pricing import launch_welcome_offer, quote


def test_missing_production_policy_does_not_assume_a_deposit_or_cash():
    policy = resolve_payment_policy(None, production=True)
    assert policy == closed_policy()
    assert policy["cashAccepted"] is False
    assert policy["depositPercent"] == 0


def test_preview_proposal_is_customer_choice_with_a_quarter_deposit():
    policy = resolve_payment_policy({}, production=False)
    assert policy == preview_policy()


def test_swedish_welcome_offer_deposit_is_a_quarter_of_the_server_total():
    policy = preview_policy()
    due = settlement(100.80, policy, "deposit")
    assert due["totalCents"] == 10080
    assert due["dueNowCents"] == 2520
    assert due["remainingCents"] == 7560
    assert due["status"] == "deposit_pending"
    assert due["prepaid"] is False


def test_full_payment_takes_the_whole_total():
    due = settlement(100.80, {**preview_policy(), "mode": "full"}, "full")
    assert due["dueNowCents"] == 10080
    assert due["remainingCents"] == 0
    assert due["status"] == "payment_required"


def test_customer_can_choose_full_payment_or_the_deposit():
    policy = preview_policy()
    assert settlement(100.80, policy, "full")["dueNowCents"] == 10080
    assert settlement(100.80, policy, "deposit")["dueNowCents"] == 2520


def test_cash_booking_is_unpaid_and_not_prepaid():
    due = settlement(100.80, preview_policy(), "cash")
    assert due["dueNowCents"] == 0
    assert due["remainingCents"] == 10080
    assert due["status"] == "unpaid"
    assert due["prepaid"] is False


def test_cash_is_refused_when_the_owner_turns_it_off():
    with pytest.raises(ValueError):
        settlement(100.80, {**preview_policy(), "cashAccepted": False}, "cash")


def test_fixed_deposit_and_a_deposit_above_the_total():
    policy = {**preview_policy(), "depositType": "fixed", "depositCents": 2000}
    assert deposit_cents(10080, policy) == 2000
    with pytest.raises(ValueError):
        deposit_cents(1500, policy)


def test_percent_deposit_rounds_half_up():
    policy = {**preview_policy(), "depositPercent": 25}
    assert deposit_cents(10081, policy) == 2520


def test_partial_payment_then_the_remaining_balance():
    policy = preview_policy()
    assert allowed_online_amounts(10080, policy, 0) == {2520, 10080}
    assert allowed_online_amounts(7560, policy, 2520) == {7560}
    assert 10081 not in allowed_online_amounts(10080, policy, 0)


def test_duplicate_and_late_webhook_actions():
    assert checkout_event_action("pending", 2520, 2520) == "settle"
    assert checkout_event_action("paid", 2520, 2520) == "duplicate"
    assert checkout_event_action("expired", 2520, 2520) == "settle"
    assert checkout_event_action("pending", 100, 2520) == "reject"


def test_saved_policy_rejects_an_invalid_percent():
    with pytest.raises(ValueError):
        resolve_payment_policy({"mode": "deposit", "depositPercent": 140, "cashAccepted": True}, production=True, explicit=True)


def test_discount_and_gst_are_in_the_total_before_the_deposit():
    priced = quote(
        service={"slug": "swedish", "prices": {"60": 120}, "taxable": True},
        duration=60, addons=[], zone={"fee": 0, "enabled": True},
        client={"id": "c-new", "email": "new.person@example.com", "phone": "780-555-0199", "_welcomeHistory": []},
        promotions=[launch_welcome_offer()], settings={"gst": 0.05, "addons": []}, location_type="home", km=1,
    )
    assert priced["discount"] == 24
    assert priced["tax"] == 4.8
    assert priced["total"] == 100.8
    due = settlement(priced["total"], preview_policy(), "deposit")
    assert (due["totalCents"], due["dueNowCents"], due["remainingCents"]) == (10080, 2520, 7560)


def test_expired_card_checkout_stays_for_owner_review():
    assert review_after_expiry("deposit", 0) == "payment_failed"
    assert review_after_expiry("full", 0) == "payment_failed"
    assert review_after_expiry("cash", 0) is None
    assert review_after_expiry("deposit", 2520) is None


def test_collected_money_cannot_leave_a_negative_balance():
    settled = due_after_payment(10080, 2520)
    assert settled == {"paidCents": 2520, "remainingCents": 7560, "refundedCents": 0, "status": "partially_paid", "prepaid": False}
    assert due_after_payment(10080, 10080)["status"] == "paid"
    assert due_after_payment(10080, 12000)["remainingCents"] == 0
    assert due_after_payment(10080, 0, 10080)["status"] == "refunded"


def test_refunds_reduce_the_collected_status():
    assert collection_status(10080, 2520, 0) == "partially_paid"
    assert collection_status(10080, 10080, 0) == "paid"
    assert collection_status(10080, 0, 0) == "unpaid"
    assert collection_status(10080, 7560, 2520) == "partially_refunded"
    assert collection_status(10080, 0, 10080) == "refunded"


def test_placeholder_clinic_is_hidden_and_not_bookable():
    clinic = {"enabled": True, "address": "[Clinic address — to be supplied]", "mobileEnabled": True}
    assert clinic_is_bookable(clinic) is False
    public = public_clinic(clinic)
    assert public["enabled"] is False
    assert public["address"] == ""
    assert public["mobileEnabled"] is True
    saved = {"enabled": False, "address": "10150 104 St NW, Edmonton, AB", "mobileEnabled": True}
    assert clinic_is_bookable(saved) is False
    assert clinic_is_bookable({**saved, "enabled": True}) is True
    booked = clinic_visit_address({**saved, "enabled": True}, "side door")
    assert booked["line"] == saved["address"]
    assert booked["notes"] == "side door"
    assert "lat" not in booked and "lng" not in booked
    pinned = clinic_visit_address({**saved, "enabled": True, "lat": 53.5225, "lng": -113.6235})
    assert (pinned["lat"], pinned["lng"]) == (53.5225, -113.6235)
    with pytest.raises(ValueError, match="not available"):
        clinic_visit_address(saved)


def test_insurer_catalog_is_inactive_and_operations_are_unavailable():
    rows = catalog()
    assert rows and all(row["active"] is False and row["credentialsConfigured"] is False for row in rows)
    assert "awaiting insurer API" in rows[0]["message"]
    refused = invoke("sun-life", "submit_claim")
    assert refused["available"] is False
    assert invoke("sun-life", "invented")["available"] is False
