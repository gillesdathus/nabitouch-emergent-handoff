"""Canadian insurer catalog and eClaims portal helpers. Nothing here submits a claim."""

# Claim-submission platforms (pathways). Distinct from the patient's insurer/carrier.
PLATFORMS = (
    {
        "id": "telus-eclaims",
        "name": "TELUS Health eClaims",
        "kind": "platform",
        "url": "https://www.providerconnect.ca/",
        "notes": "Vendor/PMS certification required. Opening this portal does not submit a Nabitouch claim.",
    },
    {
        "id": "providerconnect",
        "name": "providerConnect",
        "kind": "platform",
        "url": "https://www.providerconnect.ca/",
        "notes": "TELUS Health provider pathway. Keep insurer selection separate from this platform.",
    },
)

# Carrier / provider portals used when the insurer is billed through its own site.
CARRIER_PORTALS = (
    {
        "id": "alberta-blue-cross",
        "name": "Alberta Blue Cross",
        "kind": "carrier_portal",
        "url": "https://provider.ab.bluecross.ca/",
        "notes": "Health Provider portal. Predetermination and claim results are recorded manually in Nabitouch.",
    },
    {
        "id": "pacific-blue-cross",
        "name": "Pacific Blue Cross",
        "kind": "carrier_portal",
        "url": "https://www.pac.bluecross.ca/provider/",
        "notes": "Provider portal. Opening the site does not submit a claim from Nabitouch.",
    },
    {
        "id": "medavie-blue-cross",
        "name": "Medavie Blue Cross",
        "kind": "carrier_portal",
        "url": "https://www.medaviebc.ca/en/providers",
        "notes": "Provider resources and portal entry. Record outcomes on the invoice ledger.",
    },
    {
        "id": "sun-life",
        "name": "Sun Life",
        "kind": "carrier_portal",
        "url": "https://www.sunlife.ca/sl/provider/en/",
        "notes": "Sun Life Connect only since 2022. Third-party eClaims gateways are not used for Sun Life.",
    },
)

# Legacy adapter list used by /billing/insurers (API connectivity status).
PROVIDERS = (
    {"id": "telus-eclaims", "name": "TELUS Health eClaims"},
    {"id": "alberta-blue-cross", "name": "Alberta Blue Cross"},
    {"id": "pacific-blue-cross", "name": "Pacific Blue Cross"},
    {"id": "medavie-blue-cross", "name": "Medavie Blue Cross"},
    {"id": "sun-life", "name": "Sun Life"},
    {"id": "providerconnect", "name": "providerConnect"},
    {"id": "canada-life", "name": "Canada Life"},
)

OPERATIONS = (
    "credential_validation",
    "eligibility",
    "coverage",
    "submit_claim",
    "claim_status",
    "reconcile",
    "reverse",
)

CLAIM_STATES = (
    "not_submitted",
    "awaiting_integration",
    "submitted",
    "pending_insurer",
    "approved",
    "partially_approved",
    "denied",
    "paid",
    "reversed",
)

ECLAIMS_ACTIONS = ("view", "submit", "reconcile", "manage", "view_sensitive", "manage_permissions")

# Dedicated reception/desk flags — never reuse managePayments / viewInsuranceStatus for eClaims.
ECLAIMS_DESK_FLAGS = {
    "view": ("eclaimsView", "eclaimsSubmit", "eclaimsManage"),
    "view_sensitive": ("eclaimsViewSensitive", "eclaimsManage"),
    "submit": ("eclaimsSubmit", "eclaimsManage"),
    "reconcile": ("eclaimsReconcile", "eclaimsManage"),
    "manage": ("eclaimsManage",),
    "manage_permissions": (),  # Owner-only
}


def _as_grant_set(raw):
    if isinstance(raw, dict):
        return {str(key) for key, on in raw.items() if on}
    return {str(item) for item in (raw or [])}


def eclaims_allowed(
    roles,
    *,
    action,
    desk_perms=None,
    practitioner_grants=None,
    practitioner_subject=None,
    treating_practitioner_id=None,
):
    """Pure permission check for eClaims workspace access.

    Owner and manager: full access (except only owner may manage_permissions).
    Desk/receptionist: dedicated eclaims* flags only.
    Practitioner: explicit grant required; own treatments unless grant includes "all".
    """
    if action not in ECLAIMS_ACTIONS:
        return False
    role_set = set(roles or [])
    if "owner" in role_set:
        return True
    if "manager" in role_set:
        return action != "manage_permissions"
    if "desk" in role_set:
        flags = ECLAIMS_DESK_FLAGS.get(action) or ()
        perms = desk_perms or {}
        return any(bool(perms.get(flag)) for flag in flags)
    if "practitioner" in role_set:
        allowed = _as_grant_set(practitioner_grants)
        if action == "view" and ({"view", "submit", "manage", "reconcile"} & allowed):
            pass
        elif action == "view_sensitive" and ({"view_sensitive", "manage"} & allowed):
            pass
        elif action not in allowed:
            return False
        if "all" in allowed:
            return True
        if not practitioner_subject or not treating_practitioner_id:
            return False
        return practitioner_subject == treating_practitioner_id
    return False


def catalog():
    return [{
        "id": item["id"],
        "name": item["name"],
        "status": "not_connected",
        "message": "Not connected — awaiting insurer API access and credentials.",
        "credentialsConfigured": False,
        "capabilities": [],
        "lastConnectionTest": None,
        "active": False,
    } for item in PROVIDERS]


def eclaims_pathways():
    """Verified, configurable portal entry points. Opening a portal never submits a claim."""
    rows = []
    for item in (*PLATFORMS, *CARRIER_PORTALS):
        rows.append({
            "id": item["id"],
            "name": item["name"],
            "kind": item["kind"],
            "url": item["url"],
            "notes": item.get("notes") or "",
            "submitsFromApp": False,
        })
    return rows


def invoke(provider_id, operation):
    known = {item["id"] for item in PROVIDERS}
    if provider_id not in known or operation not in OPERATIONS:
        return {"ok": False, "available": False, "reason": "That insurer operation is not available"}
    return {
        "ok": False,
        "available": False,
        "provider": provider_id,
        "operation": operation,
        "reason": "Not connected — awaiting insurer API access and credentials.",
    }


def _text(value):
    return str(value or "").strip()


def copyable_claim_fields(*, patient, policy, invoice, practitioner, registration_number=""):
    """Build individually copyable claim fields. Missing values stay empty — never invented."""
    name = " ".join(part for part in [
        _text(patient.get("preferredName") or patient.get("firstName")),
        _text(patient.get("lastName")),
    ] if part).strip() or _text(invoice.get("clientName"))
    fee = invoice.get("total") if isinstance(invoice.get("total"), dict) else None
    fee_display = (fee or {}).get("display") or ""
    if not fee_display and isinstance(invoice.get("totalCents"), int):
        cents = invoice["totalCents"]
        fee_display = f"${cents // 100}.{cents % 100:02d}"
    treatment = _text(invoice.get("service"))
    if invoice.get("duration"):
        treatment = f"{treatment} · {invoice['duration']} min".strip(" ·")
    return [
        {"id": "patientName", "label": "Patient name", "value": name},
        {"id": "dateOfBirth", "label": "Date of birth", "value": _text(patient.get("dob"))},
        {"id": "insuranceCarrier", "label": "Insurance carrier", "value": _text(policy.get("insurer"))},
        {"id": "policyNumber", "label": "Policy or group number", "value": _text(policy.get("policy"))},
        {"id": "memberId", "label": "Member or certificate ID", "value": _text(policy.get("memberId"))},
        {"id": "serviceDate", "label": "Service date", "value": _text(invoice.get("serviceDate"))},
        {"id": "treatment", "label": "Treatment description", "value": treatment},
        {"id": "treatmentFee", "label": "Treatment fee", "value": fee_display},
        {"id": "practitionerName", "label": "Practitioner name", "value": _text(practitioner.get("name") or invoice.get("practitionerName"))},
        {"id": "practitionerRegistration", "label": "Practitioner registration number", "value": _text(registration_number)},
    ]


def insurance_profile_complete(policy):
    return bool(_text(policy.get("insurer")) and _text(policy.get("policy")) and _text(policy.get("memberId")))


SENSITIVE_FIELD_IDS = frozenset({"policyNumber", "memberId"})


def redact_eclaims_sensitive(fields, policies):
    """Hide policy/member identifiers unless eclaims.view_sensitive (or manage) is granted."""
    safe_fields = [
        {**item, "value": "", "sensitiveRedacted": True} if item.get("id") in SENSITIVE_FIELD_IDS else dict(item)
        for item in (fields or [])
    ]
    safe_policies = []
    for row in policies or []:
        safe_policies.append({
            **row,
            "policy": "",
            "memberId": "",
            "sensitiveRedacted": True,
        })
    return safe_fields, safe_policies
