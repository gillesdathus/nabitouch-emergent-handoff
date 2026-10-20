"""Server-driven promo visibility: trial does not consume welcome; redeemed offers hide."""
from offers_visibility import offer_eligibility_from_records, provisional_offer_eligibility, trial_history_blocks
from pricing import welcome_history_blocks
from trial import TRIAL_SERVICE_SLUG


def test_provisional_eligibility_for_anonymous_visitors():
    row = provisional_offer_eligibility()
    assert row["known"] is False
    assert row["welcome"] is None
    assert row["trial"] is None


def test_completed_trial_preserves_welcome_and_blocks_another_trial():
    trial = {
        "status": "completed",
        "appointmentKind": "trial",
        "serviceSlug": TRIAL_SERVICE_SLUG,
        "pricing": {"campaignOfferKind": "trial", "welcomeOffer": False},
    }
    assert trial_history_blocks([trial]) is True
    assert welcome_history_blocks([trial]) is False
    elig = offer_eligibility_from_records(history=[trial], welcome_claimed=False, trial_reserved=0)
    assert elig == {"known": True, "welcome": True, "trial": False}


def test_redeemed_welcome_hides_welcome_and_keeps_trial_if_unused():
    welcome = {
        "status": "completed",
        "pricing": {"welcomeOffer": True, "promoCode": "WELCOME20", "promoId": "promo-welcome"},
    }
    assert welcome_history_blocks([welcome]) is True
    elig = offer_eligibility_from_records(history=[welcome], welcome_claimed=False, trial_reserved=0)
    assert elig["welcome"] is False
    assert elig["trial"] is False  # regular history blocks new-audience trial


def test_welcome_claim_alone_hides_welcome_without_appointment_row():
    elig = offer_eligibility_from_records(history=[], welcome_claimed=True, trial_reserved=0)
    assert elig["welcome"] is False
    assert elig["trial"] is True


def test_both_redeemed_hides_both():
    trial = {
        "status": "completed",
        "appointmentKind": "trial",
        "serviceSlug": TRIAL_SERVICE_SLUG,
        "pricing": {"campaignOfferKind": "trial"},
    }
    welcome = {
        "status": "completed",
        "pricing": {"welcomeOffer": True, "promoCode": "WELCOME20"},
    }
    elig = offer_eligibility_from_records(history=[trial, welcome], welcome_claimed=False, trial_reserved=0)
    assert elig["welcome"] is False
    assert elig["trial"] is False


def test_cancelled_trial_without_claim_stays_eligible():
    trial = {
        "status": "cancelled",
        "appointmentKind": "trial",
        "serviceSlug": TRIAL_SERVICE_SLUG,
        "pricing": {"campaignOfferKind": "trial"},
    }
    assert trial_history_blocks([trial]) is False
    elig = offer_eligibility_from_records(history=[trial], welcome_claimed=False, trial_reserved=0)
    assert elig["welcome"] is True
    assert elig["trial"] is True


def test_reserved_trial_seat_blocks_another_claim():
    elig = offer_eligibility_from_records(history=[], welcome_claimed=False, trial_reserved=1)
    assert elig["trial"] is False
    assert elig["welcome"] is True
