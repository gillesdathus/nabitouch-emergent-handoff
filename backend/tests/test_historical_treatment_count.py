"""Historical treatment count on public practitioner profiles."""
from profiles import (
    CONTRACTOR_CLIENTS_RANGE,
    CONTRACTOR_HISTORICAL_TREATMENT_COUNT,
    CONTRACTOR_TREATMENT_ESTIMATE_MID,
    CONTRACTOR_VISITS_PER_CLIENT_RANGE,
    MOBILE_MASSAGE_PATIENTS,
    MOBILE_TREATMENT_ESTIMATE_MID,
    MOBILE_VISITS_PER_CLIENT_RANGE,
    _changes,
    career_completed_treatments,
    count_eligible_completed_appointments,
    present_practitioner,
)


def test_combined_estimate_from_owner_ranges():
    assert CONTRACTOR_CLIENTS_RANGE == (200, 305)
    assert CONTRACTOR_VISITS_PER_CLIENT_RANGE == (5, 6)
    assert CONTRACTOR_TREATMENT_ESTIMATE_MID == 1389
    assert MOBILE_MASSAGE_PATIENTS == 57
    assert MOBILE_VISITS_PER_CLIENT_RANGE == (4, 5)
    assert MOBILE_TREATMENT_ESTIMATE_MID == 256
    assert CONTRACTOR_TREATMENT_ESTIMATE_MID + MOBILE_TREATMENT_ESTIMATE_MID == 1645
    assert CONTRACTOR_HISTORICAL_TREATMENT_COUNT == 1650


def test_present_includes_historical_and_career_counts():
    view = present_practitioner(
        {
            "id": "p-1",
            "name": "Nabitu",
            "historicalCompletedTreatments": 1714,
            "historicalCountAsOf": "2026-11-03",
            "onboardingStatus": "approved",
            "specialties": ["swedish", "deep-tissue"],
        },
        "client",
        appointments=[
            {"id": "a1", "practitionerId": "p-1", "status": "completed", "date": "2026-11-04"},
            {"id": "a2", "practitionerId": "p-1", "status": "cancelled", "date": "2026-11-05"},
        ],
    )
    assert view["historicalCompletedTreatments"] == 1714
    assert view["historicalTreatmentCount"] == 1714
    assert view["careerCompletedTreatments"] == 1715
    assert view["treatmentsOffered"] == 2
    assert "historicalCountAudit" not in view


def test_legacy_alias_resolves_without_inventing():
    view = present_practitioner(
        {"id": "p-1", "historicalTreatmentCount": 1650, "onboardingStatus": "approved"},
        "client",
    )
    assert view["historicalCompletedTreatments"] == 1650
    assert view["careerCompletedTreatments"] == 1650


def test_present_clears_invalid_count():
    view = present_practitioner({"id": "p-1", "historicalTreatmentCount": -3}, "client")
    assert view["historicalCompletedTreatments"] is None
    assert view["careerCompletedTreatments"] is None


def test_no_double_count_on_or_before_baseline():
    person = {
        "id": "p-1",
        "historicalCompletedTreatments": 1714,
        "historicalCountAsOf": "2026-11-03",
    }
    appointments = [
        {"id": "a0", "practitionerId": "p-1", "status": "completed", "date": "2026-11-03"},
        {"id": "a1", "practitionerId": "p-1", "status": "completed", "date": "2026-10-31"},
        {"id": "a2", "practitionerId": "p-1", "status": "completed", "date": "2026-11-04"},
        {"id": "a2", "practitionerId": "p-1", "status": "completed", "date": "2026-11-04"},
        {"id": "a3", "practitionerId": "p-1", "status": "cancelled", "date": "2026-11-06"},
        {"id": "a4", "practitionerId": "p-1", "status": "in_session", "date": "2026-11-06"},
    ]
    assert count_eligible_completed_appointments(appointments, "p-1", "2026-11-03") == 1
    assert career_completed_treatments(person, appointments) == 1715


def test_owner_can_set_historical_experience_fields():
    owner = {"role": "owner", "id": "u-1", "name": "Owner"}
    changes = _changes(
        owner,
        {"id": "p-1"},
        {
            "historicalCompletedTreatments": 1714,
            "historicalCountAsOf": "2026-11-03",
            "historicalCountSource": "1650 baseline + 64 since last time",
        },
        known_slugs=set(),
    )
    assert changes["historicalCompletedTreatments"] == 1714
    assert changes["historicalTreatmentCount"] == 1714
    assert changes["historicalCountAsOf"] == "2026-11-03"
    assert "64" in changes["historicalCountSource"]


def test_self_cannot_set_historical_count():
    from fastapi import HTTPException
    import pytest

    pract = {"role": "practitioner", "id": "u-2", "subject": "p-1", "name": "Nabitu"}
    with pytest.raises(HTTPException) as exc:
        _changes(
            pract,
            {"id": "p-1"},
            {"historicalCompletedTreatments": 1714},
            known_slugs=set(),
        )
    assert exc.value.status_code == 400
