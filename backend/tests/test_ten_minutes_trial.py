"""Standalone "10 Minutes. On Us." trial — not flash, gift, package, or first-booking welcome."""
from datetime import datetime, timedelta, timezone

import pytest
import requests

from pricing import launch_welcome_offer, quote, welcome_history_blocks
from catalog import booking_block_reason
from recovery import (
    apply_campaign_price,
    audience_ok,
    campaign_fits,
    campaign_live,
    has_regular_treatment_history,
    launch_ten_minutes_on_us,
    parse_campaign_fields,
    public_campaign,
    reserve_decision,
)
from trial import (
    TRIAL_DURATION_MIN,
    TRIAL_LOCATION_TYPES,
    TRIAL_SERVICE_SLUG,
    is_trial_appointment,
    is_trial_offer,
    is_trial_service,
    launch_trial_service,
    trial_duration_ok,
    trial_locations_need_home_fix,
)

BASE = "http://127.0.0.1:8001/api"
AT = datetime.now(timezone.utc)


def test_trial_service_is_exactly_ten_minutes_at_zero():
    service = launch_trial_service()
    assert service["slug"] == TRIAL_SERVICE_SLUG
    assert service["kind"] == "trial"
    assert service["treatmentScope"] == "neck_shoulders"
    assert service["prices"] == {"10": 0}
    assert service["taxable"] is False
    assert service["mobile"] is True
    assert service["clinic"] is True
    assert is_trial_service(service) is True
    assert trial_duration_ok(10) is True
    assert trial_duration_ok(60) is False
    assert booking_block_reason(service, 10, "home") is None
    assert booking_block_reason(service, 10, "office") is None
    assert booking_block_reason({**service, "mobile": False}, 10, "home") == "This service is not offered at home"


def test_trial_quote_is_zero_and_never_takes_welcome():
    service = launch_trial_service()
    person = {"id": "c-lead", "email": "lead@example.com", "phone": "7805550100", "_welcomeHistory": [], "_profileComplete": True}
    priced = quote(
        service=service, duration=10, addons=[], zone=None, client=person,
        promotions=[launch_welcome_offer()], settings={"gst": 0.05, "addons": []}, location_type="clinic", km=0,
    )
    assert priced["base"] == 0
    assert priced["total"] == 0
    # Welcome may appear on a $0 base as 0 discount; campaign binding clears it at booking time.
    free = apply_campaign_price(priced, {"offerKind": "trial", "title": "10 Minutes. On Us.", "complimentaryMinutes": 10}, 0.05)
    assert free["total"] == 0
    assert free["welcomeOffer"] is False
    assert free["campaignOfferKind"] == "trial"
    assert free.get("paymentRequired") is None
    mobile = quote(
        service=service, duration=10, addons=[], zone={"fee": 15, "perKm": 1}, client=person,
        promotions=[launch_welcome_offer()], settings={"gst": 0.05, "addons": []}, location_type="home", km=8,
    )
    home_free = apply_campaign_price(mobile, {"offerKind": "trial", "title": "10 Minutes. On Us.", "complimentaryMinutes": 10}, 0.05)
    assert home_free["travel"] == 0
    assert home_free["total"] == 0
    assert home_free["welcomeOffer"] is False


def test_trial_appointments_preserve_first_regular_booking_eligibility():
    trial = {
        "status": "completed",
        "appointmentKind": "trial",
        "serviceSlug": TRIAL_SERVICE_SLUG,
        "pricing": {"campaignOfferKind": "trial", "total": 0, "welcomeOffer": False},
    }
    assert is_trial_appointment(trial) is True
    assert welcome_history_blocks([trial]) is False
    assert welcome_history_blocks([trial, {"status": "cancelled", "pricing": {}}]) is False
    assert welcome_history_blocks([trial, {"status": "completed", "pricing": {}}]) is True


def test_campaign_template_is_standalone_trial_not_flash_addon():
    row = launch_ten_minutes_on_us()
    assert row["offerKind"] == "trial"
    assert is_trial_offer(row) is True
    assert row["serviceSlug"] == TRIAL_SERVICE_SLUG
    assert row["complimentaryMinutes"] == TRIAL_DURATION_MIN
    assert row["status"] == "draft"
    assert row["followUp"]["enabled"] is False
    assert row["showHome"] is True
    assert row["showOffers"] is True
    assert campaign_live(row, AT) is False
    at = datetime.now(timezone.utc)
    live = {
        **row,
        "status": "live",
        "publishAt": (at - timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
        "expiresAt": (at + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
    }
    assert campaign_live(live, at) is True
    assert "home" in row["locationTypes"]
    assert campaign_fits(live, live["bookingStart"], "10:00", 10, TRIAL_SERVICE_SLUG, "clinic") is True
    assert campaign_fits(live, live["bookingStart"], "10:00", 10, TRIAL_SERVICE_SLUG, "home") is True
    assert campaign_fits(live, live["bookingStart"], "10:00", 10, "swedish", "clinic") is False
    assert campaign_fits(live, live["bookingStart"], "10:00", 60, TRIAL_SERVICE_SLUG, "clinic") is False
    assert reserve_decision({**live, "status": "paused"}, {}, at, 0) != "reserved"
    pub = public_campaign({**live, "public": True}, at)
    assert pub is not None
    assert pub["headline"].startswith("Try Nabitouch")
    assert pub["ctaLabel"] == "Claim my free 10 minutes"
    assert pub["showHome"] is True
    assert pub["showOffers"] is True
    hidden = public_campaign({**live, "public": True, "showHome": False, "showOffers": False}, at)
    assert hidden is not None
    assert hidden["showHome"] is False
    assert hidden["showOffers"] is False


def test_trial_audience_uses_regular_treatment_history_not_registration():
    campaign = {**launch_ten_minutes_on_us(), "audience": "new"}
    trial_only = [{"status": "completed", "appointmentKind": "trial", "serviceSlug": TRIAL_SERVICE_SLUG}]
    assert has_regular_treatment_history(trial_only) is False
    assert audience_ok(campaign, {"onlineBookings": 1, "_welcomeHistory": trial_only}) is True
    assert has_regular_treatment_history([{"status": "completed", "serviceSlug": "swedish"}]) is True
    assert audience_ok(campaign, {"onlineBookings": 0, "_welcomeHistory": [{"status": "completed", "serviceSlug": "swedish"}]}) is False
    fields = parse_campaign_fields({
        "title": "Trial", "offerKind": "trial", "bookingStart": "2030-01-15", "windowStart": "10:00",
        "windowEnd": "12:00", "expiresAt": "2030-01-20T00:00:00+00:00", "publishAt": "2030-01-01T00:00:00+00:00",
        "showHome": False, "showOffers": True, "maxRedemptions": 5,
    })
    assert fields["showHome"] is False
    assert fields["showOffers"] is True
    assert fields["offerKind"] == "trial"
    assert "home" in fields["locationTypes"]
    clinic_only = parse_campaign_fields({
        "title": "Trial", "offerKind": "trial", "bookingStart": "2030-01-15", "windowStart": "10:00",
        "windowEnd": "12:00", "expiresAt": "2030-01-20T00:00:00+00:00", "publishAt": "2030-01-01T00:00:00+00:00",
        "locationTypes": ["clinic"], "maxRedemptions": 5,
    })
    assert clinic_only["locationTypes"] == list(TRIAL_LOCATION_TYPES)
    assert trial_locations_need_home_fix(["clinic"]) is True
    assert trial_locations_need_home_fix(["home", "clinic"]) is False


def test_disabled_or_expired_campaign_is_not_bookable():
    row = launch_ten_minutes_on_us()
    now = datetime.now(timezone.utc)
    published = (now - timedelta(hours=1)).isoformat()
    expires = (now + timedelta(days=1)).isoformat()
    expired = {**row, "status": "live", "publishAt": published, "expiresAt": (now - timedelta(hours=1)).isoformat()}
    assert campaign_live(expired, now) is False
    assert reserve_decision(expired, {}, now, 0) == "expired"
    paused = {**row, "status": "paused", "publishAt": published, "expiresAt": expires}
    assert reserve_decision(paused, {}, now, 0) in ("closed", "expired")
    sold = {**row, "status": "live", "publishAt": published, "expiresAt": expires, "redemptions": 30, "maxRedemptions": 30}
    assert reserve_decision(sold, {}, now, 0) == "sold_out"
    limited = {**row, "status": "live", "publishAt": published, "expiresAt": expires, "perClientLimit": 1}
    assert reserve_decision(limited, {}, now, 1) == "limit"


def _session():
    return requests.Session()


def _owner():
    s = _session()
    r = s.post(f"{BASE}/auth/login", json={"email": "owner@nabitouch.com", "password": "demo"}, timeout=20)
    if r.status_code != 200:
        pytest.skip("API not available for integration trial tests")
    return s


def _client_fresh(owner):
    email = f"trial-{datetime.now(timezone.utc).timestamp():.0f}@example.com"
    r = owner.post(f"{BASE}/auth/register", json={
        "email": email, "password": "TrialPass1!", "firstName": "Trial", "lastName": "Lead", "role": "client",
    }, timeout=20)
    if r.status_code not in (200, 201):
        # Fallback: use demo client login when register is closed.
        s = _session()
        login = s.post(f"{BASE}/auth/login", json={"email": "sarah@example.com", "password": "demo"}, timeout=20)
        if login.status_code != 200:
            pytest.skip("client auth unavailable")
        return s, login.json().get("user", {}).get("subject") or "c-sarah"
    s = _session()
    login = s.post(f"{BASE}/auth/login", json={"email": email, "password": "TrialPass1!"}, timeout=20)
    assert login.status_code == 200, login.text
    return s, login.json()["user"]["subject"]


@pytest.mark.integration
def test_trial_booking_flow_zero_payment_and_welcome_preserved():
    owner = _owner()
    # Ensure trial service exists.
    services = owner.get(f"{BASE}/state", timeout=30).json().get("services") or []
    if not any(row.get("slug") == TRIAL_SERVICE_SLUG for row in services):
        pytest.skip("trial service not seeded in this environment")

    draft = owner.post(f"{BASE}/campaigns/templates/ten-minutes", json={}, timeout=20)
    assert draft.status_code == 200, draft.text
    campaign = draft.json()
    assert campaign["offerKind"] == "trial"
    assert campaign["status"] == "draft"

    # Disabled/draft cannot book.
    client, client_id = _client_fresh(owner)
    day = (datetime.now(timezone.utc) + timedelta(days=5)).date().isoformat()
    body = {
        "source": "online",
        "campaignId": campaign["id"],
        "practitionerId": campaign.get("practitionerId") or "p-nabitu-kahindo",
        "idempotencyKey": f"trial-disabled-{campaign['id']}",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": day, "time": "10:00",
            "locationType": "clinic", "paymentMethod": "self", "payNow": "full",
        },
    }
    blocked = client.post(f"{BASE}/bookings", json=body, timeout=30)
    assert blocked.status_code in (400, 409), blocked.text

    # Practitioner unavailable (paused production default) must not silently book.
    live = owner.post(f"{BASE}/campaigns/{campaign['id']}/status", json={"status": "live"}, timeout=20)
    assert live.status_code == 200, live.text
    unavailable = client.post(f"{BASE}/bookings", json={**body, "idempotencyKey": f"trial-unavail-{campaign['id']}"}, timeout=30)
    assert unavailable.status_code == 409
    assert "not available" in unavailable.text.lower() or "available" in unavailable.text.lower()

    # Activate practitioner only inside this test DB — never production.
    people = owner.get(f"{BASE}/state", timeout=30).json().get("practitioners") or []
    nabitu = next((p for p in people if p.get("id") == "p-nabitu-kahindo"), None)
    if not nabitu:
        pytest.skip("Nabitu not present")
    owner.patch(f"{BASE}/practitioners/{nabitu['id']}", json={"available": True, "bookable": True, "onboardingStatus": "approved", "clinic": True}, timeout=20)

    # Clinic must be bookable for trial location.
    settings = owner.get(f"{BASE}/state", timeout=30).json().get("settings") or {}
    clinic = dict((settings.get("clinic") or {}))
    clinic.update({"enabled": True, "address": clinic.get("address") or "10150 104 St NW, Edmonton, AB"})
    owner.patch(f"{BASE}/settings/app", json={"clinic": clinic}, timeout=20)

    booked = None
    for offset in range(3, 21):
        day = (datetime.now(timezone.utc) + timedelta(days=offset)).date().isoformat()
        for time in ("10:00", "11:00", "14:00", "15:00"):
            attempt = {
                **body,
                "idempotencyKey": f"trial-ok-{campaign['id']}-{day}-{time}",
                "appointment": {
                    "serviceSlug": TRIAL_SERVICE_SLUG, "duration": 10, "date": day, "time": time,
                    "locationType": "clinic", "paymentMethod": "self",
                },
            }
            quote = client.post(f"{BASE}/bookings/quote", json=attempt, timeout=20)
            if quote.status_code != 200:
                continue
            assert quote.json()["pricing"]["total"] == 0
            assert quote.json().get("paymentRequired") is False
            booked = client.post(f"{BASE}/bookings", json=attempt, timeout=30)
            if booked.status_code == 200:
                break
        if booked is not None and booked.status_code == 200:
            break
    assert booked is not None and booked.status_code == 200, getattr(booked, "text", "no slot")
    appt = booked.json()["appointment"]
    assert appt["duration"] == 10
    assert appt["serviceSlug"] == TRIAL_SERVICE_SLUG
    assert appt.get("appointmentKind") == "trial"
    assert appt["pricing"]["total"] == 0
    assert appt["pricing"].get("campaignOfferKind") == "trial"
    assert appt["pricing"].get("welcomeOffer") is False
    assert not appt.get("paymentDue") or appt["paymentDue"].get("dueNowCents", 0) == 0
    assert appt.get("treatmentScope") == "neck_shoulders"

    # First-regular-booking eligibility preserved.
    history = welcome_history_blocks([appt])
    assert history is False

    # Overlap rejected.
    overlap = client.post(f"{BASE}/bookings", json={
        **body,
        "idempotencyKey": f"trial-overlap-{appt['id']}",
        "appointment": {
            "serviceSlug": TRIAL_SERVICE_SLUG, "duration": 10, "date": appt["date"], "time": appt["time"],
            "locationType": "clinic", "paymentMethod": "self",
        },
    }, timeout=30)
    assert overlap.status_code == 409

    # Cancel releases seat for repeat-trial eligibility (perClientLimit still applies while awarded).
    cancel = owner.post(f"{BASE}/appointments/{appt['id']}/transition", json={"to": "cancelled"}, timeout=20)
    assert cancel.status_code == 200, cancel.text

    # Campaign expired/disabled after pause.
    owner.post(f"{BASE}/campaigns/{campaign['id']}/status", json={"status": "paused"}, timeout=20)
    paused_book = client.post(f"{BASE}/bookings", json={
        **body,
        "idempotencyKey": f"trial-paused-{campaign['id']}",
        "appointment": {
            "serviceSlug": TRIAL_SERVICE_SLUG, "duration": 10,
            "date": (datetime.now(timezone.utc) + timedelta(days=12)).date().isoformat(),
            "time": "13:00", "locationType": "clinic", "paymentMethod": "self",
        },
    }, timeout=30)
    assert paused_book.status_code == 409
