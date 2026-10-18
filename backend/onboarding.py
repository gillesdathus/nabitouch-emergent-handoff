"""Practitioner onboarding gaps. Missing facts stay missing; placeholders are not credentials."""
from datetime import date, datetime

from availability import CANCELLATION_DRAFT, launch_clinic, launch_policy

BUSINESS_EMAIL = "info@nabitouch.com"
PLACEHOLDER_IDENTIFIERS = frozenset({
    "pending", "pending verification", "pending owner input", "tbd", "tba", "n/a", "na",
    "none", "unknown", "placeholder", "demo", "example", "test", "xxx", "to be supplied",
    "owner input", "000", "0000", "000000", "123456",
})


def acceptable_identifier(value):
    text = " ".join(str(value or "").split())
    if len(text) < 4:
        return False
    lowered = text.lower()
    if lowered in PLACEHOLDER_IDENTIFIERS:
        return False
    if "placeholder" in lowered or "to be supplied" in lowered or "pending" in lowered:
        return False
    return any(ch.isalnum() for ch in text)


def expiry_date(value):
    try:
        return datetime.strptime(str(value or ""), "%Y-%m-%d").date()
    except ValueError:
        return None


def acceptable_login(email, owner_email=""):
    text = (email or "").strip().lower()
    if text.count("@") != 1:
        return False
    local, domain = text.split("@")
    if not local or "." not in domain or " " in text:
        return False
    blocked = {BUSINESS_EMAIL, (owner_email or "").strip().lower()}
    if text in blocked:
        return False
    if domain in {"example.com", "example.org", "example.test"}:
        return False
    if local in {"pending", "placeholder", "test", "demo", "changeme"} or "pending" in local or "placeholder" in local:
        return False
    return True


def _current(credentials, kind, today):
    found = []
    for row in credentials or []:
        if row.get("kind") != kind or row.get("status") != "verified":
            continue
        if not acceptable_identifier(row.get("identifier")):
            continue
        expires = expiry_date(row.get("expiresOn"))
        if expires is None or expires < today:
            continue
        found.append(row)
    return found[-1] if found else None


TRACKED_STATUSES = ("invited", "draft", "pending", "approved")
# Hard stops for profile activation only. Credentials, MFA, services, and hours stay tracking gaps.
ACTIVATION_HARD_GAPS = frozenset({"login_email"})


def assignment_credential_problem(person, credentials, today=None):
    """Legacy demo profiles are unchanged. An approved profile needs current registration and insurance to take bookings."""
    status = (person or {}).get("onboardingStatus")
    if status in ("invited", "draft", "pending"):
        return "This practitioner profile is not active"
    if status != "approved":
        return None
    today = today or date.today()
    attested = (person or {}).get("credentialAttestations") or {}
    if not _current(credentials, "registration", today) and not attested.get("registration"):
        return "Registration is missing or expired"
    if not _current(credentials, "liability", today) and not attested.get("liability"):
        return "Liability insurance is missing or expired"
    return None


ATTESTABLE_KINDS = ("registration", "liability")


def activation_blockers(gaps):
    """Optional credentials and schedule do not block profile activation. Booking stays separately gated."""
    return [row for row in gaps or [] if row.get("id") in ACTIVATION_HARD_GAPS]


def onboarding_gaps(*, person, credentials, login_email, owner_email, schedule, mfa_enrolled, mfa_required, today=None):
    """Invited, draft, pending, and approved profiles report what is still missing."""
    if (person or {}).get("onboardingStatus") not in TRACKED_STATUSES:
        return []
    today = today or date.today()
    gaps = []
    if not login_email or not acceptable_login(login_email, owner_email):
        # Dual owner+practitioner accounts may legitimately share the business email when subject is linked.
        if not login_email:
            gaps.append({"id": "login_email", "label": "Staff login linked to this profile", "status": "pending owner input"})
        elif not acceptable_login(login_email, owner_email):
            # Still show as a tracking gap for invite-created practitioners, but only hard-block when no login at all.
            gaps.append({"id": "login_email_review", "label": "Practitioner login email review", "status": "pending owner input"})
    attested = (person or {}).get("credentialAttestations") or {}
    pending = "owner attested · document not on file"
    registration = _current(credentials, "registration", today)
    if not registration:
        state = pending if attested.get("registration") else "pending verification"
        gaps.append({"id": "registration", "label": "Professional registration number", "status": state})
        gaps.append({"id": "registration_expiry", "label": "Registration expiry", "status": state})
    liability = _current(credentials, "liability", today)
    if not liability:
        state = pending if attested.get("liability") else "pending verification"
        gaps.append({"id": "liability", "label": "Professional liability insurance", "status": state})
        gaps.append({"id": "insurance_expiry", "label": "Insurance expiry", "status": state})
    if mfa_required and not mfa_enrolled:
        gaps.append({"id": "mfa", "label": "Staff authenticator", "status": "pending enrollment"})
    if not (person or {}).get("specialties"):
        gaps.append({"id": "services", "label": "Services offered", "status": "pending owner approval"})
    weekly = (schedule or {}).get("weekly") or []
    if not weekly:
        gaps.append({"id": "weekly", "label": "Weekly availability", "status": "pending owner approval"})
    elif (schedule or {}).get("status") != "approved":
        gaps.append({"id": "schedule_approval", "label": "Weekly availability approval", "status": "pending owner approval"})
    elif (schedule or {}).get("acceptingBookings") is not True:
        gaps.append({"id": "bookings_paused", "label": "New bookings paused", "status": "owner control"})
    return gaps


def launch_readiness(stored):
    """Compare stored settings with the approved launch values. This does not write them."""
    prepared_clinic = launch_clinic()
    prepared_policy = launch_policy()
    stored = stored or {}
    clinic = stored.get("clinic") or {}
    policy = stored.get("cancellationPolicy") or {}
    fee = stored.get("cancellationFee") or {}
    rewards = stored.get("rewards") or {}
    published = (
        clinic.get("phoneTel") == prepared_clinic["phoneTel"]
        and clinic.get("phoneDisplay") == prepared_clinic["phoneDisplay"]
        and clinic.get("email") == prepared_clinic["email"]
        and clinic.get("hours") == prepared_clinic["hours"]
        and clinic.get("mobileEnabled") is True
        and clinic.get("enabled") is False
        and not str(clinic.get("address") or "").strip()
        and policy.get("status") == "approved"
        and policy.get("automaticFee") is False
        and policy.get("text") == CANCELLATION_DRAFT
        and fee.get("enabled") is not True
        and fee.get("noShowEnabled") is not True
        and rewards.get("enabled") is not True
        and rewards.get("nabidermEnabled") is not True
    )
    return {
        "published": published,
        "apply": "not authorized",
        "prepared": {
            "phoneDisplay": prepared_clinic["phoneDisplay"],
            "phoneTel": prepared_clinic["phoneTel"],
            "email": prepared_clinic["email"],
            "hours": prepared_clinic["hours"],
            "mobileEnabled": True,
            "clinicEnabled": False,
            "address": "",
            "policyStatus": prepared_policy["status"],
            "policyText": prepared_policy["text"],
            "automaticFee": False,
            "gst": 0.05,
            "documentUploads": False,
            "cardCheckout": False,
            "rewards": False,
            "referrals": False,
            "nabiderm": False,
            "promotionalSending": False,
            "cancellationFee": False,
            "noShowFee": False,
            "welcomeOffer": True,
            "welcomePercent": 20,
            "welcomeLabel": "First-booking welcome offer",
        },
    }


async def load_practitioner_onboarding(db, coll, practitioner_id):
    person = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0})
    if not person:
        return None
    credentials = await db.nt_credentials.find({"practitionerId": practitioner_id}, {"_id": 0}).to_list(50)
    # Dual-role owner accounts keep primary role=owner while subject points at the practitioner profile.
    account = await db.nt_users.find_one(
        {"subject": practitioner_id, "$or": [{"role": "practitioner"}, {"roles": "practitioner"}]},
        {"_id": 0, "id": 1, "email": 1, "role": 1, "roles": 1, "status": 1},
    )
    if not account:
        account = await db.nt_users.find_one({"role": "practitioner", "subject": practitioner_id}, {"_id": 0, "id": 1, "email": 1, "status": 1})
    owner = await db.nt_users.find_one({"role": "owner"}, {"_id": 0, "email": 1})
    schedule = await db.nt_schedules.find_one({"practitionerId": practitioner_id}, {"_id": 0})
    settings = await coll("settings").find_one({"id": "app"}, {"_id": 0, "mfaEnforcePrivileged": 1, "scheduling": 1, "clinic": 1, "cancellationPolicy": 1, "cancellationFee": 1, "rewards": 1, "gst": 1}) or {}
    enrolled = False
    if account:
        enrolled = bool(await db.nt_mfa.find_one({"userId": account["id"], "enabled": True}, {"_id": 1}))
    gaps = onboarding_gaps(
        person=person,
        credentials=credentials,
        login_email=(account or {}).get("email"),
        owner_email=(owner or {}).get("email"),
        schedule=schedule,
        mfa_enrolled=enrolled,
        mfa_required=bool(settings.get("mfaEnforcePrivileged")),
    )
    return {"person": person, "schedule": schedule, "settings": settings, "gaps": gaps, "account": account}
