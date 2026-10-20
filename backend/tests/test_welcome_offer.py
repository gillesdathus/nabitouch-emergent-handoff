"""First-booking welcome offer. History and identity decide eligibility. The browser total is not accepted."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests

from billing import lines_from_pricing
from pricing import identity_keys, launch_welcome_offer, promo_shows, quote, welcome_history_blocks
from rewards import preview_redemption


SERVICE = {"slug": "swedish", "prices": {"60": 120}, "taxable": True}
ZONE = {"fee": 0, "enabled": True}
SETTINGS = {"gst": 0.05, "addons": []}
ADDRESS = {
    "line": "10150 104 St NW, Edmonton, AB",
    "mapboxId": "local-downtown",
    "postal": "T5J 2R4",
    "clientConfirmed": True,
    "lat": 53.5461,
    "lng": -113.4938,
}


def _offer(**changes):
    promo = launch_welcome_offer()
    promo.update(changes)
    return promo


def _quote(history, promotions=None, client=None):
    person = {"id": "c-new", "email": "new.person@example.com", "phone": "780-555-0199", "_welcomeHistory": history}
    if client is not None:
        person = client
    return quote(
        service=SERVICE, duration=60, addons=[], zone=ZONE, client=person,
        promotions=promotions if promotions is not None else [_offer()],
        settings=SETTINGS, location_type="home", km=1,
    )


def test_swedish_welcome_total_is_100_80():
    priced = _quote([])
    assert priced["base"] == 120
    assert priced["discount"] == 24
    assert priced["travel"] == 0
    assert priced["tax"] == 4.8
    assert priced["total"] == 100.8


def test_welcome_offer_has_placements_and_edit_does_not_rewrite_invoice_lines():
    offer = launch_welcome_offer()
    assert "home" in offer["placements"] and "account" in offer["placements"] and "offers" in offer["placements"]
    assert offer["bannerHeadline"] == "Your First Massage, 20% Off."
    assert offer["ctaLabel"] == "Book my first massage"
    assert promo_shows(offer, "home") is True
    assert promo_shows(offer, "offers") is True
    assert promo_shows({**offer, "placements": ["account"]}, "offers") is False
    snapshot = {
        "base": 120, "addons": 0, "addonList": [], "discount": 24, "travel": 0, "tax": 4.8, "total": 100.8,
        "promoId": "promo-welcome", "promoName": "First-booking welcome offer", "promoCode": "WELCOME20",
        "welcomeOffer": True,
    }
    before = lines_from_pricing(snapshot)
    edited = _offer(value=30, maxDiscount=50, bannerHeadline="New headline")
    assert edited["value"] == 30
    after = lines_from_pricing(snapshot)
    assert before == after
    assert snapshot["promoName"] == "First-booking welcome offer"
    assert snapshot["welcomeOffer"] is True
    rows, net, tax, total = lines_from_pricing(snapshot)
    assert rows[0]["netCents"] == 12000
    assert rows[1]["description"] == "First-booking welcome offer"
    assert rows[1]["netCents"] == -2400
    assert net == 9600
    assert tax == 480
    assert total == 10080


@pytest.mark.parametrize("status", ["requested", "confirmed", "completed", "no_show"])
def test_live_history_blocks_the_welcome_offer(status):
    assert welcome_history_blocks([{"status": status, "pricing": {}}]) is True
    priced = _quote([{"status": status, "pricing": {}}])
    assert priced["discount"] == 0
    assert priced["welcomeOffer"] is False
    assert priced["total"] == 126


@pytest.mark.parametrize("status", ["cancelled", "refunded"])
def test_released_visit_blocks_only_when_the_welcome_benefit_was_claimed(status):
    assert welcome_history_blocks([{"status": status, "pricing": {}}]) is False
    assert _quote([{"status": status, "pricing": {}}])["discount"] == 24
    claimed = {"status": status, "paymentStatus": "refunded", "pricing": {"promoCode": "WELCOME20", "welcomeOffer": True}}
    assert welcome_history_blocks([claimed]) is True
    assert _quote([claimed])["discount"] == 0


def test_missing_history_and_a_new_flag_do_not_grant_the_offer():
    assert _quote(None, client=None)["discount"] == 0
    assert _quote(None, client={"onlineBookings": 0})["discount"] == 0
    priced = _quote([], client={"onlineBookings": 0, "welcomeEligible": True})
    assert priced["discount"] == 0


def test_same_phone_or_email_is_one_person_and_a_short_number_is_not():
    keys = identity_keys({"id": "c-1", "email": " A@Example.com ", "phone": "+1 (780) 555-0199"})
    assert keys == ["client:c-1", "email:a@example.com", "phone:7805550199"]
    assert "phone:555" not in identity_keys({"phone": "555"})
    assert identity_keys({"email": "", "phone": ""}) == []


def test_welcome_does_not_stack_and_a_disabled_offer_uses_the_regular_price():
    extra = {"id": "promo-stack", "code": "STACK", "name": "Extra", "type": "fixed", "value": 10, "eligibility": "birthday_month",
             "approval": "approved", "enabled": True, "stackable": True, "services": "all", "requiresMarketingConsent": False}
    person = {"id": "c-new", "email": "new.person@example.com", "dob": "1990-10-13", "marketingConsent": True, "_welcomeHistory": []}
    priced = quote(service=SERVICE, duration=60, addons=[], zone=ZONE, client=person, promotions=[_offer(), extra], settings=SETTINGS, location_type="home", km=1)
    assert priced["discount"] == 24
    assert priced["appliedPromoIds"] == ["promo-welcome"]
    blocked = preview_redemption(priced, 1000, {"stackWithPromotions": False, "pointsPerDollarValue": 100}, 0.05)
    assert blocked["ok"] is False
    disabled = _quote([], [_offer(enabled=False)])
    assert disabled["discount"] == 0
    assert disabled["total"] == 126
    pending = _quote([], [_offer(approval="pending")])
    assert pending["discount"] == 0


def _api():
    base = os.environ.get("REACT_APP_BACKEND_URL")
    if not base:
        pytest.skip("API fixture is not running")
    return base.rstrip("/") + "/api"


def _login(email, password):
    response = requests.post(f"{_api()}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def _book(email, phone, when, date="2027-08-18"):
    return requests.post(f"{_api()}/bookings", json={
        "source": "online",
        "client": {"firstName": "Welcome", "lastName": "Guest", "email": email, "phone": phone},
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": date, "time": when,
            "locationType": "home", "paymentMethod": "self",
            "pricing": {"total": 1, "discount": 99, "welcomeOffer": True},
            "address": ADDRESS,
        },
    }, timeout=30)


def test_quote_booking_and_invoice_show_the_same_welcome_total():
    api = _api()
    owner = _login(os.environ["OWNER_EMAIL"], os.environ["OWNER_PASSWORD"])
    phone = f"780555{uuid.uuid4().int % 10000:04d}"
    email = f"welcome{uuid.uuid4().hex[:8]}@example.com"
    body = {
        "source": "online",
        "client": {"firstName": "Welcome", "lastName": "Guest", "email": email, "phone": phone},
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": "2027-09-02", "time": "15:00",
            "locationType": "home", "paymentMethod": "self", "address": ADDRESS,
            "pricing": {"total": 50, "discount": 50},
        },
    }
    preview = requests.post(f"{api}/bookings/quote", json=body, timeout=30)
    assert preview.status_code == 200, preview.text
    assert preview.json()["provisional"] is True
    pricing = preview.json()["pricing"]
    assert pricing["base"] == 120
    assert pricing["discount"] == 24
    assert pricing["travel"] == 0
    assert pricing["tax"] == 4.8
    assert pricing["total"] == 100.8
    booked = requests.post(f"{api}/bookings", json=body, timeout=30)
    assert booked.status_code == 200, booked.text
    appointment = booked.json()["appointment"]
    assert appointment["pricing"]["total"] == pricing["total"]
    assert appointment["pricing"]["discount"] == 24
    assert appointment["pricing"]["welcomeOffer"] is True
    assert appointment["pricing"]["promoName"] == "First-booking welcome offer"
    invoice = requests.post(f"{api}/invoices/from-appointment/{appointment['id']}", headers=owner, timeout=30)
    assert invoice.status_code == 200, invoice.text
    view = invoice.json()
    assert view["tax"]["cents"] == 480
    assert view["total"]["cents"] == 10080
    discount_lines = [line for line in view["lines"] if line["netCents"] < 0]
    assert discount_lines[0]["description"] == "First-booking welcome offer"
    assert discount_lines[0]["netCents"] == -2400


def test_duplicate_profile_and_concurrent_claims_cannot_both_take_the_offer():
    phone = f"780556{uuid.uuid4().int % 10000:04d}"
    first = _book(f"first{uuid.uuid4().hex[:6]}@example.com", phone, "10:00", "2027-09-09")
    assert first.status_code == 200, first.text
    assert first.json()["appointment"]["pricing"]["discount"] == 24
    second = _book(f"second{uuid.uuid4().hex[:6]}@example.com", f"+1 ({phone[:3]}) {phone[3:6]}-{phone[6:]}", "11:00", "2027-09-09")
    assert second.status_code == 200, second.text
    assert second.json()["appointment"]["pricing"]["discount"] == 0
    assert second.json()["appointment"]["pricing"]["total"] == 126

    shared = f"780557{uuid.uuid4().int % 10000:04d}"

    def once(mark):
        return _book(f"race{mark}{uuid.uuid4().hex[:6]}@example.com", shared, f"1{mark}:00", "2027-09-16")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(once, (0, 1)))
    assert [item.status_code for item in results] == [200, 200], [item.text for item in results]
    discounts = sorted(item.json()["appointment"]["pricing"]["discount"] for item in results)
    assert discounts == [0, 24], discounts


def test_returning_client_and_a_disabled_offer_pay_the_regular_price_and_the_change_is_audited():
    api = _api()
    owner = _login(os.environ["OWNER_EMAIL"], os.environ["OWNER_PASSWORD"])
    sarah = _login("sarah.demo@example.com", os.environ["DEMO_PASSWORD"])
    desk = _login("reception.demo@example.com", os.environ["DEMO_PASSWORD"])
    denied = requests.patch(f"{api}/promotions/promo-welcome", headers=desk, json={"enabled": False}, timeout=20)
    assert denied.status_code == 403
    returning = requests.post(f"{api}/bookings", headers=sarah, json={
        "source": "online",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": "2027-09-23", "time": "16:00",
            "locationType": "home", "paymentMethod": "self", "address": ADDRESS,
            "pricing": {"total": 1, "discount": 24},
        },
    }, timeout=30)
    assert returning.status_code == 200, returning.text
    assert returning.json()["appointment"]["pricing"]["welcomeOffer"] is False
    assert returning.json()["appointment"]["pricing"]["promoCode"] != "WELCOME20"
    repeat = _book("sarah.demo@example.com", f"780559{uuid.uuid4().int % 10000:04d}", "16:30", "2027-09-23")
    assert repeat.status_code == 200, repeat.text
    assert repeat.json()["appointment"]["pricing"]["discount"] == 0
    assert repeat.json()["appointment"]["pricing"]["welcomeOffer"] is False
    assert repeat.json()["appointment"]["pricing"]["total"] == 126
    try:
        turned_off = requests.patch(
            f"{api}/promotions/promo-welcome", headers=owner,
            json={"enabled": False, "_actor": "Owner"}, timeout=20,
        )
        assert turned_off.status_code == 200, turned_off.text
        regular = _book(f"off{uuid.uuid4().hex[:6]}@example.com", f"780558{uuid.uuid4().int % 10000:04d}", "12:00", "2027-09-30")
        assert regular.status_code == 200, regular.text
        assert regular.json()["appointment"]["pricing"]["discount"] == 0
        assert regular.json()["appointment"]["pricing"]["total"] == 126
        state = requests.get(f"{api}/state", headers=owner, timeout=30)
        assert state.status_code == 200, state.text
        audits = state.json()["audit"]
        assert any("promo-welcome" in str(row.get("action") or "") or "WELCOME20" in str(row.get("action") or "") for row in audits)
        assert any("enabled=False" in str(row.get("action") or "") for row in audits)
    finally:
        restored = requests.patch(f"{api}/promotions/promo-welcome", headers=owner, json={"enabled": True, "approval": "approved"}, timeout=20)
        assert restored.status_code == 200, restored.text
