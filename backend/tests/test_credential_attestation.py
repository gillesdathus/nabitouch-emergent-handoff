from datetime import date, timedelta

from onboarding import CREDENTIAL_GRACE_DAYS, assignment_credential_problem, onboarding_gaps


TODAY = date(2026, 10, 18)


def test_attestation_alone_does_not_open_booking_past_grace():
    past = TODAY - timedelta(days=CREDENTIAL_GRACE_DAYS + 1)
    person = {
        "onboardingStatus": "approved",
        "activatedAt": past.isoformat() + "T12:00:00+00:00",
        "credentialAttestations": {"registration": {"by": "Owner"}, "liability": {"by": "Owner"}},
    }
    problem = assignment_credential_problem(person, [], TODAY)
    assert problem and "Association license number" in problem


def test_attestation_does_not_matter_during_grace():
    person = {
        "onboardingStatus": "approved",
        "activatedAt": TODAY.isoformat() + "T12:00:00+00:00",
        "credentialAttestations": {},
    }
    assert assignment_credential_problem(person, [], TODAY) is None


def test_gaps_no_longer_use_owner_attested_status():
    person = {
        "onboardingStatus": "approved",
        "activatedAt": TODAY.isoformat() + "T12:00:00+00:00",
        "credentialAttestations": {"registration": {"by": "Owner"}, "liability": {"by": "Owner"}},
    }
    gaps = onboarding_gaps(
        person=person,
        credentials=[],
        login_email="a@b.ca",
        owner_email="o@b.ca",
        schedule={},
        mfa_enrolled=True,
        mfa_required=False,
        today=TODAY,
    )
    assoc = next(g for g in gaps if g["id"] == "association")
    assert "grace" in assoc["status"]
    assert "owner attested" not in assoc["status"]
