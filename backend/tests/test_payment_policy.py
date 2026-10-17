import pytest

from availability import clinic_is_bookable, clinic_visit_address, gps_origin, merge_clinic, public_clinic, visit_navigation_point
from insurers import catalog, invoke
from billing import lines_from_pricing, project
from pricing import CLINIC_POINT, zone_for
from payment_policy import (
    allowed_online_amounts,
    authorized_checkout_cents,
    gift_redemption_cents,
    manual_settlement_cents,
    checkout_event_action,
    closed_policy,
    collection_status,
    due_after_payment,
    due_for_booking,
    review_after_expiry,
    deposit_cents,
    preview_policy,
    resolve_payment_policy,
    settlement,
)
from recovery import apply_campaign_price
from pricing import launch_welcome_offer, quote


def test_campaign_discount_is_included_before_the_deposit_is_calculated():
    policy = {"mode": "choice", "depositType": "percent", "depositPercent": 25, "depositCents": 0, "cashAccepted": True}
    fields = {"paymentMethod": "self", "payNow": "deposit"}
    before = due_for_booking(126, policy, fields)
    priced = apply_campaign_price({"base": 120, "addons": 0, "travel": 0, "discount": 0, "tax": 6, "total": 126}, 20, 0.05, False)
    after = due_for_booking(priced["total"], policy, fields)
    assert before["totalCents"] == 12600
    assert before["dueNowCents"] == 3150
    assert after["totalCents"] == 10080
    assert after["dueNowCents"] == 2520
    assert after["remainingCents"] == 7560
    assert due_for_booking(priced["total"], policy, {"paymentMethod": "insurance", "payNow": "deposit"}) is None


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


def _visit(pay_now, total_cents, due_now):
    return {"payNow": pay_now, "paymentDue": {"totalCents": total_cents, "dueNowCents": due_now, "remainingCents": total_cents, "paidCents": 0}}


def test_checkout_uses_the_saved_deposit_not_the_invoice_balance():
    visit = _visit("deposit", 10080, 2520)
    assert authorized_checkout_cents(visit, 10080, 0) == 2520
    assert authorized_checkout_cents(visit, 10080, 0, 2520) == 2520
    with pytest.raises(ValueError, match="not the amount due"):
        authorized_checkout_cents(visit, 10080, 0, 10080)
    full = _visit("full", 10080, 10080)
    assert authorized_checkout_cents(full, 10080, 0) == 10080
    assert authorized_checkout_cents(full, 10080, 0, 10080) == 10080


def test_gift_card_covers_only_the_deposit_then_leaves_the_invoice_balance():
    visit = _visit("deposit", 10080, 2520)
    assert gift_redemption_cents(visit, 10080, 0, 5000) == 2520
    with pytest.raises(ValueError, match="gift-card balance"):
        gift_redemption_cents(visit, 10080, 0, 5000, 10080)
    assert gift_redemption_cents(visit, 10080, 0, 1000) == 1000
    assert authorized_checkout_cents(visit, 9080, 1000) == 1520
    assert authorized_checkout_cents(visit, 7560, 2520) == 7560
    assert gift_redemption_cents(visit, 7560, 2520, 10000) == 7560


def test_staff_etransfer_cannot_confirm_more_than_the_amount_still_due():
    visit = _visit("deposit", 10080, 2520)
    assert manual_settlement_cents(visit, 10080, 0) == 2520
    assert manual_settlement_cents(visit, 10080, 0, 1000) == 1000
    with pytest.raises(ValueError, match="more than the amount due"):
        manual_settlement_cents(visit, 10080, 0, 10080)
    assert manual_settlement_cents(visit, 9080, 1000) == 1520
    with pytest.raises(ValueError, match="more than the amount due"):
        manual_settlement_cents(visit, 9080, 1000, 2520)
    assert manual_settlement_cents(visit, 7560, 2520) == 7560
    full = _visit("full", 10080, 10080)
    assert manual_settlement_cents(full, 10080, 0, 10080) == 10080
    with pytest.raises(ValueError, match="outstanding balance"):
        manual_settlement_cents(full, 7560, 2520, 10080)
    with pytest.raises(ValueError, match="positive"):
        manual_settlement_cents(full, 10080, 0, 0)
    with pytest.raises(ValueError, match="positive"):
        manual_settlement_cents(full, 10080, 0, -2520)


def test_gift_card_on_a_full_payment_cannot_exceed_the_invoice():
    visit = _visit("full", 10080, 10080)
    assert gift_redemption_cents(visit, 10080, 0, 20000) == 10080
    assert gift_redemption_cents(visit, 10080, 0, 4000, 4000) == 4000
    with pytest.raises(ValueError):
        gift_redemption_cents(visit, 10080, 0, 0)


def test_checkout_after_a_deposit_collects_only_the_remaining_balance():
    visit = _visit("deposit", 10080, 2520)
    assert authorized_checkout_cents(visit, 7560, 2520) == 7560
    with pytest.raises(ValueError, match="not the amount due"):
        authorized_checkout_cents(visit, 7560, 2520, 2520)
    refunded = authorized_checkout_cents(visit, 10080, 0, 2520)
    assert refunded == 2520


def test_fixed_deposit_and_rounding_stay_on_the_saved_cents():
    fixed = _visit("deposit", 10080, 2000)
    assert authorized_checkout_cents(fixed, 10080, 0, 2000) == 2000
    rounded = _visit("deposit", 10081, 2520)
    assert authorized_checkout_cents(rounded, 10081, 0) == 2520


def test_travel_and_tax_stay_outside_the_treatment_discount_and_match_checkout():
    priced = apply_campaign_price({"base": 120, "addons": 0, "travel": 15, "discount": 0, "tax": 6.75, "total": 141.75}, 20, 0.05, False)
    rows, _net, tax, total = lines_from_pricing(priced)
    assert priced["discount"] == 24
    assert priced["travel"] == 15
    assert any(row["description"] == "Travel" and row["netCents"] == 1500 for row in rows)
    assert tax == 555
    assert total == 11655
    due = due_for_booking(priced["total"], {**preview_policy(), "depositType": "percent", "depositPercent": 25}, {"payNow": "deposit"})
    visit = {"payNow": "deposit", "paymentDue": due}
    assert authorized_checkout_cents(visit, total, 0) == due["dueNowCents"]
    assert due["dueNowCents"] == 2914


def test_a_visit_without_a_saved_choice_can_still_charge_a_requested_amount():
    assert authorized_checkout_cents({}, 10080, 0, 2500) == 2500
    with pytest.raises(ValueError, match="outstanding balance"):
        authorized_checkout_cents({}, 10080, 0, 10081)


def test_duplicate_checkout_authorization_is_the_same_cents():
    visit = _visit("deposit", 10080, 2520)
    first = authorized_checkout_cents(visit, 10080, 0)
    second = authorized_checkout_cents(visit, 10080, 0, first)
    assert first == second == 2520
    assert checkout_event_action("pending", first, first) == "settle"
    assert checkout_event_action("paid", first, first) == "duplicate"
    assert checkout_event_action("expired", first, first) == "settle"
    assert checkout_event_action("pending", 10080, first) == "reject"


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
    assert booked["navigation"] == "unavailable"
    assert "lat" not in booked and "lng" not in booked
    stale = clinic_visit_address({**saved, "enabled": True, "lat": 53.5461, "lng": -113.4938})
    assert "lat" not in stale
    pinned = clinic_visit_address({**saved, "enabled": True, "lat": 53.5225, "lng": -113.6235, "coordinatesVerified": True})
    assert (pinned["lat"], pinned["lng"]) == (53.5225, -113.6235)
    assert pinned["navigation"] == "ready"
    with pytest.raises(ValueError, match="not available"):
        clinic_visit_address(saved)


def test_clinic_street_change_drops_the_previous_pin():
    current = {"enabled": True, "address": "10150 104 St NW, Edmonton, AB", "lat": 53.5435, "lng": -113.499, "mapboxId": "local-downtown", "coordinatesVerified": True}
    changed = merge_clinic(current, {"address": "8882 170 St NW, Edmonton, AB", "lat": 53.5461, "lng": -113.4938})
    assert changed["address"] == "8882 170 St NW, Edmonton, AB"
    assert "lat" not in changed and "lng" not in changed
    assert changed["coordinatesVerified"] is False
    assert changed["navigation"] == "unavailable"


def test_confirmed_clinic_resolution_stores_provider_coordinates():
    saved = merge_clinic(
        {"enabled": False, "address": "", "mobileEnabled": True},
        {"address": "typed downtown", "lat": 53.5461, "lng": -113.4938, "confirmation": {"clientConfirmed": True, "mapboxId": "local-west"}},
        {"line": "8882 170 St NW, Edmonton, AB", "lat": 53.5225, "lng": -113.6235, "mapboxId": "local-west", "confidence": "address"},
    )
    assert (saved["lat"], saved["lng"]) == (53.5225, -113.6235)
    assert saved["address"] == "8882 170 St NW, Edmonton, AB"
    assert saved["coordinatesVerified"] is True
    visit = clinic_visit_address({**saved, "enabled": True})
    assert (visit["lat"], visit["lng"]) == (53.5225, -113.6235)


def test_ambiguous_clinic_confirmation_does_not_save_coordinates():
    with pytest.raises(ValueError, match="needs review"):
        merge_clinic(
            {"address": "10150 104 St NW, Edmonton, AB"},
            {"address": "somewhere", "confirmation": {"clientConfirmed": True, "mapboxId": "ambiguous"}},
            {"line": "somewhere", "lat": 53.5461, "lng": -113.4938, "mapboxId": "ambiguous", "confidence": "review"},
        )


def test_mapbox_outage_keeps_the_street_and_clears_navigation():
    saved = merge_clinic(
        {"address": "10150 104 St NW, Edmonton, AB", "lat": 53.5435, "lng": -113.499, "coordinatesVerified": True},
        {"address": "8882 170 St NW, Edmonton, AB", "confirmation": {"clientConfirmed": True, "mapboxId": "local-west"}},
        provider_down=True,
    )
    assert saved["address"] == "8882 170 St NW, Edmonton, AB"
    assert "lat" not in saved
    assert saved["navigation"] == "unavailable"
    visit = clinic_visit_address({**saved, "enabled": True})
    assert visit["navigation"] == "unavailable"
    assert "lat" not in visit


def test_unchanged_verified_clinic_keeps_its_pin_when_other_settings_change():
    current = {"address": "10150 104 St NW, Edmonton, AB", "lat": 53.5435, "lng": -113.499, "mapboxId": "local-downtown", "coordinatesVerified": True, "mobileEnabled": True}
    saved = merge_clinic(current, {"mobileEnabled": False, "lat": 53.5461, "lng": -113.4938})
    assert (saved["lat"], saved["lng"]) == (53.5435, -113.499)
    assert saved["navigation"] == "ready"


def _gps(lat, lng, age_s=0, accuracy=12):
    from datetime import datetime, timedelta, timezone
    stamp = datetime.now(timezone.utc) - timedelta(seconds=age_s)
    return {"lat": lat, "lng": lng, "accuracy": accuracy, "recordedAt": stamp.isoformat()}


def test_trip_start_uses_current_gps_and_never_a_saved_or_downtown_origin():
    import asyncio
    import server
    from fastapi import HTTPException

    class _Coll:
        async def find_one(self, *_args, **_kwargs):
            return {"id": "p-1", "base": {"lat": 53.5, "lng": -113.4}}

    clinic = {
        "practitionerId": "p-1",
        "locationType": "clinic",
        "address": {"line": "8882 170 St NW, Edmonton, AB", "lat": 53.5225, "lng": -113.6235, "navigation": "ready"},
    }
    mobile = {
        "practitionerId": "p-1",
        "locationType": "home",
        "address": {"line": "123 Client St", "lat": 53.54, "lng": -113.5, "arrival": {"lat": 53.55, "lng": -113.51}},
    }
    original = server.coll
    server.coll = lambda _name: _Coll()
    downtown = {"lat": 53.5461, "lng": -113.4938}
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(server.start_trip({
                **clinic,
                "address": {**clinic["address"], "navigation": "unavailable", "lat": 53.5461, "lng": -113.4938},
            }, "2026-10-16T00:00:00Z", _gps(53.48, -113.55)))
        assert exc.value.status_code == 409
        assert exc.value.detail == "This visit has no map coordinates yet."
        with pytest.raises(HTTPException) as missing:
            asyncio.run(server.start_trip({
                "locationType": "home", "address": {"line": "123 Client St"},
            }, "2026-10-16T00:00:00Z", _gps(53.48, -113.55)))
        assert missing.value.status_code == 409
        assert missing.value.detail == "This visit has no map coordinates yet."
    finally:
        server.coll = original
    started = asyncio.run(server.start_trip(clinic, "2026-10-16T00:00:00Z", _gps(53.48, -113.55)))
    assert started["to"] == {"lat": 53.5225, "lng": -113.6235}
    assert started["from"] == {"lat": 53.48, "lng": -113.55}
    assert started["location"] == "gps"
    assert started["from"] != downtown
    assert started["from"] != {"lat": 53.5, "lng": -113.4}
    assert "km" in started and "driveMin" in started
    mobile_trip = asyncio.run(server.start_trip(mobile, "2026-10-16T00:00:00Z", _gps(53.48, -113.55)))
    assert mobile_trip["to"] == {"lat": 53.55, "lng": -113.51}
    assert mobile_trip["from"] == {"lat": 53.48, "lng": -113.55}
    without_gps = asyncio.run(server.start_trip(clinic, "2026-10-16T00:00:00Z", None))
    assert without_gps["location"] == "unavailable"
    assert "from" not in without_gps
    assert "km" not in without_gps and "driveMin" not in without_gps
    assert without_gps["to"] == started["to"]
    stale = asyncio.run(server.start_trip(clinic, "2026-10-16T00:00:00Z", _gps(53.5461, -113.4938, age_s=120)))
    assert stale["location"] == "unavailable" and "from" not in stale
    invalid = asyncio.run(server.start_trip(clinic, "2026-10-16T00:00:00Z", {"lat": 91, "lng": 0, "recordedAt": _gps(0, 0)["recordedAt"]}))
    assert invalid["location"] == "unavailable" and "from" not in invalid
    hidden = server.hide_practitioner_home({"trip": without_gps})
    assert "from" not in hidden["trip"]
    asyncio.run(server.authorize_transition({"role": "practitioner", "subject": "p-1"}, clinic, "en_route"))
    with pytest.raises(HTTPException) as denied:
        asyncio.run(server.authorize_transition({"role": "practitioner", "subject": "other"}, clinic, "en_route"))
    assert denied.value.status_code == 403
    assert gps_origin(None) is None
    assert gps_origin(_gps(53.48, -113.55, accuracy=400)) is None
    zone, _km = zone_for({"lat": 53.6015, "lng": -113.4135}, [{"id": "inner", "enabled": True, "radiusKm": 15}])
    assert CLINIC_POINT == {"lat": 53.5461, "lng": -113.4938}
    assert zone["id"] == "inner"


def test_ledger_stays_consistent_across_card_gift_transfer_cash_and_refund():
    visit = _visit("deposit", 10080, 2520)
    lines = []
    gift = gift_redemption_cents(visit, 10080, 0, 1000)
    lines.append({"type": "client_payment", "method": "giftcard", "amountCents": gift})
    received, balance, state, _overdue = project({"totalCents": 10080, "state": "issued", "dueDate": "2099-01-01"}, lines)
    transfer = manual_settlement_cents(visit, balance, received)
    assert (gift, transfer, received, balance) == (1000, 1520, 1000, 9080)
    with pytest.raises(ValueError, match="more than the amount due"):
        manual_settlement_cents(visit, balance, received, 2000)
    lines.append({"type": "client_payment", "method": "etransfer", "amountCents": transfer})
    received, balance, state, _overdue = project({"totalCents": 10080, "state": "issued", "dueDate": "2099-01-01"}, lines)
    card = authorized_checkout_cents(visit, balance, received)
    assert (received, balance, card, state) == (2520, 7560, 7560, "partially_paid")
    assert checkout_event_action("pending", card, card) == "settle"
    assert checkout_event_action("paid", card, card) == "duplicate"
    with pytest.raises(ValueError, match="outstanding balance"):
        manual_settlement_cents(visit, balance, received, balance + 1)
    lines.append({"type": "client_payment", "method": "card", "amountCents": card})
    received, balance, state, _overdue = project({"totalCents": 10080, "state": "issued", "dueDate": "2099-01-01"}, lines)
    assert (received, balance, state) == (10080, 0, "paid")
    lines.append({"type": "refund", "method": "card", "amountCents": card})
    received, balance, state, _overdue = project({"totalCents": 10080, "state": "issued", "dueDate": "2099-01-01"}, lines)
    assert (received, balance, state) == (2520, 7560, "partially_paid")
    cash = manual_settlement_cents(visit, balance, received)
    assert cash == 7560
    assert sum(line["amountCents"] if line["type"] == "client_payment" else -line["amountCents"] for line in lines) == received


def test_visit_navigation_uses_only_verified_coordinates():
    verified = clinic_visit_address(
        {"enabled": True, "address": "8882 170 St NW, Edmonton, AB", "lat": 53.5225, "lng": -113.6235, "coordinatesVerified": True},
    )
    assert visit_navigation_point(verified, "clinic") == {"lat": 53.5225, "lng": -113.6235}
    stale = {"line": "8882 170 St NW, Edmonton, AB", "lat": 53.5461, "lng": -113.4938, "navigation": "unavailable"}
    assert visit_navigation_point(stale, "clinic") is None
    missing = clinic_visit_address({"enabled": True, "address": "10150 104 St NW, Edmonton, AB"})
    assert visit_navigation_point(missing, "clinic") is None
    assert visit_navigation_point({"line": "client home", "lat": "nope", "lng": None}, "home") is None
    assert visit_navigation_point({"line": "client home", "lat": 53.6, "lng": -113.5, "arrival": {"lat": 91, "lng": 0}}, "home") == {"lat": 53.6, "lng": -113.5}
    mobile = {"line": "client home", "lat": 53.54, "lng": -113.5, "arrival": {"lat": 53.55, "lng": -113.51}}
    assert visit_navigation_point(mobile, "home") == {"lat": 53.55, "lng": -113.51}


def test_insurer_catalog_is_inactive_and_operations_are_unavailable():
    rows = catalog()
    assert rows and all(row["active"] is False and row["credentialsConfigured"] is False for row in rows)
    assert "awaiting insurer API" in rows[0]["message"]
    refused = invoke("sun-life", "submit_claim")
    assert refused["available"] is False
    assert invoke("sun-life", "invented")["available"] is False
