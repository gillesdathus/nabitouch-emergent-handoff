"""Canadian insurer catalog and eClaims portal helpers. Nothing here submits a claim."""

# Claim-submission platforms (pathways). Distinct from the patient's insurer/carrier.
# TELUS Health eClaims launches from the TELUS Health Provider Portal (docs:
# https://plus.telushealth.co/page/eclaims/help/learningcorner/Logging_into_eClaims_from_the_Provider_Portal.htm).
# providerConnect is a separate multi-carrier portal at providerconnect.ca.
PLATFORMS = (
    {
        "id": "telus-eclaims",
        "name": "TELUS Health eClaims",
        "kind": "platform",
        "url": "https://providerportal.telushealth.com/",
        "notes": "TELUS Health Provider Portal → eClaims. Distinct from providerConnect. Opening this portal does not submit a Nabitouch claim.",
    },
    {
        "id": "providerconnect",
        "name": "providerConnect",
        "kind": "platform",
        "url": "https://www.providerconnect.ca/",
        "notes": "Separate multi-carrier provider portal (not the TELUS eClaims Provider Portal). Keep insurer selection separate from this platform.",
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


# Practitioner grants Owners manage in Permissions. reconcile/manage stay server-capable but are not primary UI toggles.
ECLAIMS_PRACTITIONER_GRANT_ORDER = ("view", "submit", "view_sensitive", "reconcile", "manage", "all")
ECLAIMS_PRACTITIONER_VIEW_DEPENDENTS = frozenset({"submit", "view_sensitive", "reconcile", "manage", "all"})


def normalize_eclaims_practitioner_grants(raw):
    """Normalize practitioner eClaims grants for durable storage.

    - Explicit view:false (dict) clears every grant so dependents cannot linger.
    - Enabling submit / view_sensitive / reconcile / manage / all implies view.
    - Without view, no other grant remains stored.
    """
    if isinstance(raw, dict):
        aliases = {
            "view": "view",
            "submit": "submit",
            "view_sensitive": "view_sensitive",
            "viewSensitive": "view_sensitive",
            "reconcile": "reconcile",
            "manage": "manage",
            "all": "all",
            "allTreatments": "all",
        }
        if "view" in raw and not raw.get("view"):
            return []
        mapped = {}
        for key, value in raw.items():
            token = aliases.get(key)
            if token:
                mapped[token] = bool(value)
        raw = mapped
    grants = _as_grant_set(raw) & set(ECLAIMS_PRACTITIONER_GRANT_ORDER)
    if grants & ECLAIMS_PRACTITIONER_VIEW_DEPENDENTS:
        grants.add("view")
    if "view" not in grants:
        return []
    return [name for name in ECLAIMS_PRACTITIONER_GRANT_ORDER if name in grants]


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


# Normalized insurer name → pathway id. Only entries with a reliable public mapping.
# Prefer dedicated carrier portals when the carrier is billed on its own site;
# otherwise map known TELUS eClaims / providerConnect participants.
_CARRIER_PATHWAY_ALIASES = {
    "alberta blue cross": "alberta-blue-cross",
    "abc": "alberta-blue-cross",
    "pacific blue cross": "pacific-blue-cross",
    "pbc": "pacific-blue-cross",
    "medavie blue cross": "medavie-blue-cross",
    "medavie": "medavie-blue-cross",
    "sun life": "sun-life",
    "sunlife": "sun-life",
    "sun life financial": "sun-life",
}

_PROVIDERCONNECT_ALIASES = {
    "green shield",
    "green shield canada",
    "greenshield",
    "greenshield canada",
    "gsc",
}

# TELUS Health eClaims participating insurers (public FAQ / register lists).
# Do not invent mappings for free-text "Other" or demo sample names.
_TELUS_ECLAIMS_ALIASES = {
    "aga financial",
    "aga financial group",
    "alberta blue cross",  # also has carrier portal; carrier wins via _CARRIER_PATHWAY_ALIASES
    "beneva",
    "bpa",
    "canada life",
    "canada life pshcp",
    "canada life - pshcp",
    "claimsecure",
    "desjardins",
    "desjardins insurance",
    "equitable",
    "grouphealth",
    "groupsource",
    "industrial alliance",
    "ia financial",
    "johnson",
    "johnson inc",
    "belairdirect",
    "johnston group",
    "manion",
    "manulife",
    "manulife financial",
    "maximum benefit",
    "pacific blue cross",
    "people corporation",
    "rwam",
    "simply benefits",
    "telus adjudicare",
    "uv insurance",
}


def _normalize_insurer(name):
    text = _text(name).lower()
    for ch in (",", ".", "/", "(", ")", "-", "_"):
        text = text.replace(ch, " ")
    return " ".join(text.split())


def suggest_pathway_id(insurer_name):
    """Return a pathway id when the saved insurer maps reliably; otherwise None."""
    key = _normalize_insurer(insurer_name)
    if not key or key in {"other", "unknown", "n a", "na", "none"}:
        return None
    if key in _CARRIER_PATHWAY_ALIASES:
        return _CARRIER_PATHWAY_ALIASES[key]
    if key in _PROVIDERCONNECT_ALIASES or "green shield" in key or key.startswith("greenshield"):
        return "providerconnect"
    if key in _TELUS_ECLAIMS_ALIASES:
        return "telus-eclaims"
    # Partial contains checks for common catalog labels (e.g. "Canada Life — PSHCP").
    if "sun life" in key:
        return "sun-life"
    if "alberta blue cross" in key:
        return "alberta-blue-cross"
    if "pacific blue cross" in key:
        return "pacific-blue-cross"
    if "medavie" in key:
        return "medavie-blue-cross"
    if "green shield" in key or "greenshield" in key:
        return "providerconnect"
    if any(token in key for token in ("canada life", "manulife", "desjardins", "beneva", "claimsecure")):
        return "telus-eclaims"
    return None


def eclaims_pathways(*, insurer=None):
    """Verified, configurable portal entry points. Opening a portal never submits a claim."""
    suggested = suggest_pathway_id(insurer)
    rows = []
    for item in (*PLATFORMS, *CARRIER_PORTALS):
        rows.append({
            "id": item["id"],
            "name": item["name"],
            "kind": item["kind"],
            "url": item["url"],
            "notes": item.get("notes") or "",
            "submitsFromApp": False,
            "suggested": bool(suggested and item["id"] == suggested),
        })
    if suggested:
        rows.sort(key=lambda row: (0 if row["id"] == suggested else 1, row["name"]))
    return rows


def eclaims_pathway_suggestion(insurer=None):
    """Convenience: pathways list plus suggestedPathwayId for API responses."""
    pathways = eclaims_pathways(insurer=insurer)
    suggested = next((row["id"] for row in pathways if row.get("suggested")), None)
    return pathways, suggested


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
