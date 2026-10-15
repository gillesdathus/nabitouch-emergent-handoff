"""Prospective Canadian insurer adapters. Nothing here submits a claim."""

PROVIDERS = (
    {"id": "telus-eclaims", "name": "TELUS Health eClaims"},
    {"id": "alberta-blue-cross", "name": "Alberta Blue Cross"},
    {"id": "sun-life", "name": "Sun Life"},
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
