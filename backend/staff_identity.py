"""Canonical practitioner identity and clinical care vs business-admin separation.

Checkpoint B helpers only. Automatic booking assignment belongs to Checkpoint C.
"""
from __future__ import annotations

from rbac import effective_roles, has_strict_role

# Sole designated massage therapist for NabiTouch launch operations.
CANONICAL_PRACTITIONER_ID = "p-nabitu-kahindo"
CANONICAL_PRACTITIONER_NAME = "Nabitu Kahindo"

# Configuration references only — not proof of production linkage.
NABITU_LOGIN_REFERENCE = "kahindonabitu@outlook.com"
OWNER_LOGIN_REFERENCE = "info@nabitouch.com"

DESIGNATION_MANAGER_RECEPTIONIST = "manager_receptionist"
DESIGNATION_PRACTITIONER = "practitioner"
DESIGNATION_OWNER = "owner"
DESIGNATION_DESK = "desk"
DESIGNATION_CLIENT = "client"

VALID_DESIGNATIONS = frozenset({
    DESIGNATION_MANAGER_RECEPTIONIST,
    DESIGNATION_PRACTITIONER,
    DESIGNATION_OWNER,
    DESIGNATION_DESK,
    DESIGNATION_CLIENT,
})


def normalize_designation(value, roles=None, primary=None):
    text = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "manager": DESIGNATION_MANAGER_RECEPTIONIST,
        "receptionist": DESIGNATION_MANAGER_RECEPTIONIST,
        "reception": DESIGNATION_MANAGER_RECEPTIONIST,
        "manager_receptionist": DESIGNATION_MANAGER_RECEPTIONIST,
        "manager/receptionist": DESIGNATION_MANAGER_RECEPTIONIST,
    }
    text = aliases.get(text, text)
    if text in VALID_DESIGNATIONS:
        return text
    role_list = list(roles or [])
    if primary and primary not in role_list:
        role_list = [primary] + role_list
    if "practitioner" in role_list and "owner" not in role_list and "manager" not in role_list:
        return DESIGNATION_PRACTITIONER
    if "owner" in role_list or "manager" in role_list:
        return DESIGNATION_MANAGER_RECEPTIONIST if ("manager" in role_list or "desk" in role_list) else DESIGNATION_OWNER
    if "desk" in role_list:
        return DESIGNATION_DESK
    if "client" in role_list:
        return DESIGNATION_CLIENT
    return DESIGNATION_OWNER


def is_canonical_practitioner(person_or_id):
    if isinstance(person_or_id, dict):
        return person_or_id.get("id") == CANONICAL_PRACTITIONER_ID
    return person_or_id == CANONICAL_PRACTITIONER_ID


def practitioner_ids(people):
    return [person.get("id") for person in (people or []) if person and person.get("id")]


def duplicate_canonical_profiles(people):
    """Return every profile that reuses Nabitu's canonical id or exact launch name incorrectly."""
    matches = []
    for person in people or []:
        if not person:
            continue
        if person.get("id") == CANONICAL_PRACTITIONER_ID:
            matches.append(person)
        elif (
            str(person.get("name") or "").strip().lower() == CANONICAL_PRACTITIONER_NAME.lower()
            and person.get("id") != CANONICAL_PRACTITIONER_ID
        ):
            matches.append(person)
    return matches


def sole_canonical_ok(people):
    matches = [person for person in (people or []) if person and person.get("id") == CANONICAL_PRACTITIONER_ID]
    aliases = [
        person for person in (people or [])
        if person and person.get("id") != CANONICAL_PRACTITIONER_ID
        and str(person.get("name") or "").strip().lower() == CANONICAL_PRACTITIONER_NAME.lower()
    ]
    return len(matches) == 1 and not aliases


def account_may_link_practitioner(roles, practitioner_id):
    """Administrative roles alone must not receive a therapist subject link."""
    role_list = list(roles or [])
    if "practitioner" not in role_list:
        return False, "Only a practitioner role may link to a therapist profile"
    if not practitioner_id:
        return False, "Choose the practitioner profile to link"
    return True, None


def account_is_bookable_therapist(user, person=None):
    """True only when the account holds the practitioner role and a linked profile.

    Bookability of the profile itself still goes through onboarding and scheduling gates.
    Owner / manager / desk privileges never make an account a therapist.
    """
    if not user or not has_strict_role(user, "practitioner"):
        return False
    subject = user.get("subject")
    if not subject:
        return False
    if person is not None and person.get("id") != subject:
        return False
    return True


def is_treating_clinician(user, appointment):
    """SOAP and full clinical notes require the treating practitioner relationship.

    Business ownership, manager, and reception roles are not care relationships.
    Dual-role accounts (owner + practitioner) qualify only via their practitioner subject.
    """
    if not user or not appointment:
        return False
    if not has_strict_role(user, "practitioner"):
        return False
    subject = user.get("subject")
    return bool(subject) and subject == appointment.get("practitionerId")


def can_review_clinical_compliance(user):
    """Owner-only export and access-log review. Not routine SOAP browsing."""
    return bool(user) and has_strict_role(user, "owner")


def can_administer_credentials(user):
    """Credential verification remains a business-administration privilege."""
    if not user:
        return False
    return has_strict_role(user, "owner") or (
        has_strict_role(user, "practitioner") and bool(user.get("subject"))
    )


def resolve_staff_subject(roles, practitioner_id, *, clear_when_not_practitioner=True):
    """Decide the user.subject value for a staff account update."""
    role_list = list(roles or [])
    if "practitioner" not in role_list:
        return None if clear_when_not_practitioner else practitioner_id
    return practitioner_id or None


def activation_summary(*, person, credentials, login_email, owner_email, schedule, mfa_enrolled, mfa_required, today=None):
    """Report onboarding and booking blockers without inventing credentials."""
    from onboarding import activation_blockers, onboarding_gaps
    from profiles import person_booking_block

    gaps = onboarding_gaps(
        person=person,
        credentials=credentials,
        login_email=login_email,
        owner_email=owner_email,
        schedule=schedule,
        mfa_enrolled=mfa_enrolled,
        mfa_required=mfa_required,
        today=today,
    )
    booking_block = person_booking_block(person, service=None, credentials=credentials)
    return {
        "practitionerId": (person or {}).get("id"),
        "canonical": is_canonical_practitioner(person or {}),
        "onboardingStatus": (person or {}).get("onboardingStatus"),
        "available": (person or {}).get("available") is True,
        "bookable": (person or {}).get("bookable") is True,
        "acceptingBookings": (schedule or {}).get("acceptingBookings") is True,
        "scheduleStatus": (schedule or {}).get("status"),
        "gaps": gaps,
        "activationBlockers": activation_blockers(gaps),
        "bookingBlock": booking_block,
        "bookableNow": booking_block is None and (person or {}).get("available") is not False,
    }


def staff_session_fields(user):
    roles = effective_roles(user)
    designation = normalize_designation(user.get("operationalDesignation"), roles, user.get("role"))
    return {
        "operationalDesignation": designation,
        "canonicalPractitionerId": CANONICAL_PRACTITIONER_ID,
        "therapistEligible": account_is_bookable_therapist(user),
    }
