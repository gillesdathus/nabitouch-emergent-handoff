from onboarding import assignment_credential_problem, onboarding_gaps


def test_owner_attestation_opens_booking_but_keeps_gap():
    person = {"onboardingStatus": "approved", "credentialAttestations": {"registration": {"by": "Owner"}, "liability": {"by": "Owner"}}}
    assert assignment_credential_problem(person, []) is None
    gaps = onboarding_gaps(person=person, credentials=[], login_email="a@b.ca", owner_email="o@b.ca", schedule={}, mfa_enrolled=True, mfa_required=False)
    reg = next(g for g in gaps if g["id"] == "registration")
    assert reg["status"] == "owner attested · document not on file"


def test_without_attestation_booking_stays_blocked():
    assert assignment_credential_problem({"onboardingStatus": "approved"}, []) == "Registration is missing or expired"
    partial = {"onboardingStatus": "approved", "credentialAttestations": {"registration": {"by": "Owner"}}}
    assert assignment_credential_problem(partial, []) == "Liability insurance is missing or expired"
