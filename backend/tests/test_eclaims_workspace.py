"""eClaims portal helpers — copyable fields and pathways; no claim submission."""
from insurers import copyable_claim_fields, eclaims_allowed, eclaims_pathways, insurance_profile_complete


def test_owner_and_manager_eclaims_access():
    assert eclaims_allowed(["owner"], action="view")
    assert eclaims_allowed(["owner"], action="manage_permissions")
    assert eclaims_allowed(["manager"], action="submit")
    assert eclaims_allowed(["manager"], action="manage_permissions") is False


def test_receptionist_requires_dedicated_eclaims_flags_not_payment_perms():
    pay_only = {"managePayments": True, "viewInsuranceStatus": True}
    assert eclaims_allowed(["desk"], action="view", desk_perms=pay_only) is False
    assert eclaims_allowed(["desk"], action="submit", desk_perms=pay_only) is False
    assert eclaims_allowed(["desk"], action="view", desk_perms={"eclaimsView": True}) is True
    assert eclaims_allowed(["desk"], action="submit", desk_perms={"eclaimsView": True}) is False
    assert eclaims_allowed(["desk"], action="submit", desk_perms={"eclaimsSubmit": True}) is True
    assert eclaims_allowed(["desk"], action="view_sensitive", desk_perms={"eclaimsView": True}) is False
    assert eclaims_allowed(["desk"], action="view_sensitive", desk_perms={"eclaimsViewSensitive": True}) is True


def test_practitioner_needs_grant_and_defaults_to_own_treatments():
    assert eclaims_allowed(
        ["practitioner"], action="view", practitioner_grants=[], practitioner_subject="p-1", treating_practitioner_id="p-1",
    ) is False
    assert eclaims_allowed(
        ["practitioner"], action="view", practitioner_grants=["view"], practitioner_subject="p-1", treating_practitioner_id="p-2",
    ) is False
    assert eclaims_allowed(
        ["practitioner"], action="view", practitioner_grants=["view"], practitioner_subject="p-1", treating_practitioner_id="p-1",
    ) is True
    assert eclaims_allowed(
        ["practitioner"], action="submit", practitioner_grants=["view"], practitioner_subject="p-1", treating_practitioner_id="p-1",
    ) is False
    assert eclaims_allowed(
        ["practitioner"], action="view", practitioner_grants=["view", "all"], practitioner_subject="p-1", treating_practitioner_id="p-2",
    ) is True


def test_eclaims_pathways_include_required_portals_and_never_submit():
    ids = {row["id"] for row in eclaims_pathways()}
    for needed in (
        "telus-eclaims",
        "alberta-blue-cross",
        "pacific-blue-cross",
        "medavie-blue-cross",
        "sun-life",
        "providerconnect",
    ):
        assert needed in ids
    for row in eclaims_pathways():
        assert row["url"].startswith("https://")
        assert row["submitsFromApp"] is False


def test_copyable_fields_leave_missing_values_blank():
    fields = copyable_claim_fields(
        patient={"firstName": "Sarah", "lastName": "Thompson", "dob": ""},
        policy={"insurer": "Alberta Blue Cross", "policy": "", "memberId": "M-1"},
        invoice={
            "clientName": "Sarah Thompson",
            "service": "Swedish massage",
            "duration": 60,
            "serviceDate": "2026-10-12",
            "total": {"display": "$100.00"},
            "practitionerName": "Nabitu Kahindo",
        },
        practitioner={"name": "Nabitu Kahindo"},
        registration_number="",
    )
    by_id = {row["id"]: row["value"] for row in fields}
    assert by_id["patientName"] == "Sarah Thompson"
    assert by_id["insuranceCarrier"] == "Alberta Blue Cross"
    assert by_id["policyNumber"] == ""
    assert by_id["memberId"] == "M-1"
    assert by_id["treatment"] == "Swedish massage · 60 min"
    assert by_id["treatmentFee"] == "$100.00"
    assert by_id["practitionerRegistration"] == ""
    assert insurance_profile_complete({"insurer": "X", "policy": "P", "memberId": "M"}) is True
    assert insurance_profile_complete({"insurer": "X", "policy": "", "memberId": "M"}) is False


def test_platforms_are_marked_separately_from_carrier_portals():
    kinds = {row["id"]: row["kind"] for row in eclaims_pathways()}
    assert kinds["telus-eclaims"] == "platform"
    assert kinds["providerconnect"] == "platform"
    assert kinds["alberta-blue-cross"] == "carrier_portal"
    assert kinds["sun-life"] == "carrier_portal"
