"""Staff administrative client-profile create/edit helpers.

Reuses the existing clients collection. Does not invent a second client database.
Partial patches only touch supplied fields. Historical appointment addresses stay
on appointments — clearing a saved address never rewrites completed visits.
"""
from __future__ import annotations

import re
import uuid
from copy import deepcopy

from addresses import (
    is_po_box,
    normalize_destination_line,
    postal_code,
    verification_state_for,
)

# Contact / preference fields any authorized staff editor may change immediately.
CONTACT_FIELDS = frozenset({
    "preferredName", "phone", "altPhone", "email", "language", "contactMethod",
    "emergencyContact", "marketingConsent", "smsConsent", "paymentPreference",
    "preferredNavApp", "noInsurance", "photo", "favorites", "preferredPractitioners",
})
ADDRESS_FIELDS = frozenset({"addresses"})
INSURANCE_FIELDS = frozenset({"insurance", "noInsurance"})
# Legal identity — staff must record verification method + reason when changing these.
IDENTITY_FIELDS = frozenset({"firstName", "lastName", "dob"})
ALL_ADMIN_FIELDS = CONTACT_FIELDS | ADDRESS_FIELDS | INSURANCE_FIELDS | IDENTITY_FIELDS

RECEPTION_EDIT_PROFILE = "editClientProfile"
RECEPTION_EDIT_ADDRESSES = "editClientAddresses"
RECEPTION_EDIT_INSURANCE = "editClientInsurance"
RECEPTION_CORRECT_IDENTITY = "correctClientIdentity"

ADDRESS_PURPOSES = frozenset({"home", "mailing", "service", "office", "hotel", "other", "temporary"})
IDENTITY_METHODS = frozenset({
    "government_id_sighted",
    "verbal_confirmed",
    "prior_record_match",
    "guardian_confirmed",
    "other",
})

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def sanitize_email(value):
    text = str(value or "").strip().lower()
    if not text:
        return ""
    if not _EMAIL_RE.match(text):
        raise ValueError("Enter a valid email address, or leave it blank.")
    return text


def sanitize_phone(value):
    return str(value or "").strip()[:40]


def normalize_address_row(raw, *, existing=None):
    """Normalize one saved address. Does not invent postal codes or coordinates."""
    src = raw if isinstance(raw, dict) else {}
    prior = existing if isinstance(existing, dict) else {}
    line = normalize_destination_line(src.get("line") or prior.get("line") or "") or str(src.get("line") or prior.get("line") or "").strip()
    if not line:
        raise ValueError("Address line is required")
    purpose = str(src.get("purpose") or prior.get("purpose") or "home").strip().lower()
    if purpose not in ADDRESS_PURPOSES:
        purpose = "home"
    label = str(src.get("label") or prior.get("label") or purpose.title()).strip()[:60] or purpose.title()
    unit = str(src.get("unit") if "unit" in src else prior.get("unit") or "").strip()[:40]
    access = str(src.get("access") if "access" in src else prior.get("access") or "").strip()[:240]
    notes = str(src.get("notes") if "notes" in src else prior.get("notes") or "").strip()[:240]
    postal = postal_code(src.get("postal") or prior.get("postal") or line)
    po_box = is_po_box(line) or bool(src.get("poBox") or prior.get("poBox"))
    if po_box and purpose == "service":
        purpose = "mailing"
    # Coordinates only when explicitly supplied — never fabricate.
    lat = src.get("lat") if "lat" in src else prior.get("lat")
    lng = src.get("lng") if "lng" in src else prior.get("lng")
    try:
        lat = float(lat) if lat is not None and lat != "" else None
        lng = float(lng) if lng is not None and lng != "" else None
    except (TypeError, ValueError):
        lat = lng = None
    confidence = src.get("confidence") if "confidence" in src else prior.get("confidence")
    client_confirmed = bool(src.get("clientConfirmed") if "clientConfirmed" in src else prior.get("clientConfirmed"))
    # Manual entry alone never counts as verified.
    if src.get("manualEntry") or (not src.get("mapboxId") and not prior.get("mapboxId") and not client_confirmed):
        if confidence in (None, "", "address") and not client_confirmed:
            confidence = "review"
    verification = verification_state_for(
        confidence=confidence,
        client_confirmed=client_confirmed,
        postal_status=src.get("postalStatus") or prior.get("postalStatus"),
        eligible=src.get("eligible") if "eligible" in src else prior.get("eligible"),
        po_box=po_box,
        purpose=purpose,
    )
    row = {
        "id": str(src.get("id") or prior.get("id") or f"ad-{uuid.uuid4().hex[:10]}"),
        "label": label,
        "purpose": purpose,
        "line": line,
        "unit": unit,
        "access": access,
        "notes": notes,
        "postal": postal or str(src.get("postal") or prior.get("postal") or "").strip()[:12],
        "poBox": po_box,
        "isDefault": bool(src.get("isDefault") if "isDefault" in src else prior.get("isDefault")),
        "verificationState": verification,
        "confidence": confidence or ("review" if verification != "verified" else "address"),
        "clientConfirmed": client_confirmed,
        "mapboxId": str(src.get("mapboxId") if "mapboxId" in src else prior.get("mapboxId") or "")[:120],
        "zoneId": src.get("zoneId") if "zoneId" in src else prior.get("zoneId"),
        "civic": src.get("civic") if "civic" in src else prior.get("civic"),
        "postalStatus": src.get("postalStatus") if "postalStatus" in src else prior.get("postalStatus"),
        "lat": lat,
        "lng": lng,
        "manualEntry": bool(src.get("manualEntry") or prior.get("manualEntry")),
        "arrival": src.get("arrival") if "arrival" in src else prior.get("arrival"),
    }
    if src.get("confirmedAt") or prior.get("confirmedAt"):
        row["confirmedAt"] = src.get("confirmedAt") or prior.get("confirmedAt")
    return row


def normalize_addresses(rows, *, existing=None):
    prior_by_id = {a.get("id"): a for a in (existing or []) if isinstance(a, dict) and a.get("id")}
    out = []
    seen = set()
    default_id = None
    for item in rows or []:
        if not isinstance(item, dict):
            continue
        # Soft-delete / remove from active book: omit from the list. Appointments keep snapshots.
        if item.get("_remove") or item.get("removed"):
            continue
        row = normalize_address_row(item, existing=prior_by_id.get(item.get("id")))
        if row["id"] in seen:
            continue
        seen.add(row["id"])
        if row["isDefault"]:
            default_id = row["id"]
        out.append(row)
    if out and not default_id:
        # Prefer a non-mailing physical address as default service location.
        physical = next((a for a in out if a["purpose"] != "mailing" and not a.get("poBox")), None)
        (physical or out[0])["isDefault"] = True
        default_id = (physical or out[0])["id"]
    if default_id:
        for row in out:
            row["isDefault"] = row["id"] == default_id
    return out


def dedupe_insurance(rows):
    """Prevent accidental duplicate insurer+memberId pairs while allowing primary/secondary."""
    out = []
    keys = set()
    for item in rows or []:
        if not isinstance(item, dict):
            continue
        insurer = str(item.get("insurer") or "").strip()
        member = str(item.get("memberId") or item.get("policy") or "").strip().upper()
        key = (insurer.casefold(), member)
        if insurer and member and key in keys:
            continue
        if insurer and member:
            keys.add(key)
        row = {
            "id": str(item.get("id") or f"ins-{uuid.uuid4().hex[:10]}"),
            "insurer": insurer,
            "policy": str(item.get("policy") or "").strip()[:80],
            "memberId": str(item.get("memberId") or "").strip()[:80],
            "groupNumber": str(item.get("groupNumber") or item.get("group") or "").strip()[:80],
            "holderName": str(item.get("holderName") or "").strip()[:120],
            "relationship": str(item.get("relationship") or "Self").strip()[:40],
            "holderDob": str(item.get("holderDob") or "").strip()[:12],
            "secondary": str(item.get("secondary") or "").strip()[:200],
            "extra": str(item.get("extra") or item.get("coverageDetails") or "").strip()[:400],
            "status": item.get("status") or "ready_for_verification",
            "primary": bool(item.get("primary", len(out) == 0)),
        }
        out.append(row)
    # Exactly one primary when any policies exist.
    if out:
        primaries = [i for i, r in enumerate(out) if r.get("primary")]
        if len(primaries) != 1:
            for i, r in enumerate(out):
                r["primary"] = i == (primaries[0] if primaries else 0)
    return out


def desk_can_read_client_addresses(perms):
    """True when reception may see saved client addresses for booking / profile work.

    Matches the write allowlist for addresses. Appointment-stop privacy still uses
    viewAddresses separately — this only covers the client's address book.
    """
    perms = perms or {}
    return bool(
        perms.get(RECEPTION_EDIT_ADDRESSES)
        or perms.get("viewAddresses")
        or perms.get("createBooking")
    )


def desk_can_write_client_addresses(perms):
    """True when reception may attach or edit saved client addresses."""
    return desk_can_read_client_addresses(perms)


def staff_allowed_fields(role, perms, payload_keys):
    """Return the subset of payload keys this staff member may change."""
    keys = set(payload_keys)
    if role in ("owner", "manager"):
        return keys & ALL_ADMIN_FIELDS
    if role != "desk":
        return set()
    allowed = set()
    if perms.get(RECEPTION_EDIT_PROFILE) or perms.get("createBooking"):
        allowed |= CONTACT_FIELDS
    if desk_can_write_client_addresses(perms):
        allowed |= ADDRESS_FIELDS
    if perms.get(RECEPTION_EDIT_INSURANCE) or perms.get("viewInsuranceStatus"):
        allowed |= INSURANCE_FIELDS
    if perms.get(RECEPTION_CORRECT_IDENTITY):
        allowed |= IDENTITY_FIELDS
    return keys & allowed


def require_identity_verification(payload, target):
    """When legal name or DOB changes, require method + reason. Returns meta or None."""
    changing = []
    for field in IDENTITY_FIELDS:
        if field not in payload:
            continue
        new = str(payload.get(field) or "").strip()
        old = str(target.get(field) or "").strip()
        if new != old:
            changing.append(field)
    if not changing:
        return None
    meta = payload.get("_identityCorrection") if isinstance(payload.get("_identityCorrection"), dict) else {}
    method = str(meta.get("method") or "").strip()
    reason = str(meta.get("reason") or "").strip()
    if method not in IDENTITY_METHODS:
        raise ValueError(
            "Legal name and date of birth changes require a recorded identity verification method."
        )
    if len(reason) < 3:
        raise ValueError("Provide a short reason for the identity correction.")
    return {
        "fields": changing,
        "method": method,
        "reason": reason[:400],
        "previous": {f: target.get(f) for f in changing},
        "next": {f: payload.get(f) for f in changing},
    }


def profile_change_audit(*, actor, actor_id, client_id, changed, identity=None, note=None):
    """Build a protected audit row. Avoids logging full insurance member IDs."""
    safe_changed = []
    for key in sorted(changed):
        if key == "insurance":
            safe_changed.append("insurance")
        elif key == "addresses":
            safe_changed.append("addresses")
        elif key in IDENTITY_FIELDS:
            safe_changed.append(key)
        else:
            safe_changed.append(key)
    action = f"Client profile updated ({', '.join(safe_changed)})" if safe_changed else "Client profile updated"
    if identity:
        action = (
            f"Identity correction ({', '.join(identity['fields'])}) "
            f"via {identity['method']}: {identity['reason']}"
        )
    if note:
        action = f"{action} — {note}"
    doc = {
        "id": f"cpa-{uuid.uuid4().hex[:12]}",
        "kind": "client_profile",
        "clientId": client_id,
        "actor": actor,
        "actorId": actor_id,
        "fields": safe_changed,
        "identity": (
            {
                "fields": identity["fields"],
                "method": identity["method"],
                "reason": identity["reason"],
                "previous": identity["previous"],
            }
            if identity
            else None
        ),
    }
    return action, doc


def build_staff_client(body, *, user):
    """Create payload for POST /clients. Email optional; no online account required."""
    first = str(body.get("firstName") or "").strip()
    last = str(body.get("lastName") or "").strip()
    if not first or not last:
        raise ValueError("First and last name are required")
    email = sanitize_email(body.get("email"))
    addresses = normalize_addresses(body.get("addresses") or [])
    insurance = dedupe_insurance(body.get("insurance") or [])
    return {
        "id": "c-" + uuid.uuid4().hex[:10],
        "firstName": first,
        "lastName": last,
        "preferredName": str(body.get("preferredName") or "").strip()[:80],
        "email": email,
        "phone": sanitize_phone(body.get("phone")),
        "altPhone": sanitize_phone(body.get("altPhone")),
        "dob": str(body.get("dob") or "").strip()[:12],
        "language": str(body.get("language") or "English").strip()[:40] or "English",
        "contactMethod": str(body.get("contactMethod") or "Text").strip()[:40] or "Text",
        "emergencyContact": str(body.get("emergencyContact") or "").strip()[:120],
        "marketingConsent": bool(body.get("marketingConsent")),
        "smsConsent": bool(body.get("smsConsent")),
        "addresses": addresses,
        "insurance": insurance,
        "noInsurance": bool(body.get("noInsurance")) if "noInsurance" in body else (len(insurance) == 0 and bool(body.get("noInsurance"))),
        "favorites": [],
        "preferredPractitioners": [],
        "loyaltyPoints": 0,
        "onlineBookings": 0,
        "hasProfile": False,
        "createdBy": user.get("id"),
    }


def merge_client_patch(target, payload, *, role, perms):
    """Apply a partial administrative patch. Returns (set_doc, identity_meta, changed_keys)."""
    identity_meta_raw = payload.get("_identityCorrection") if isinstance(payload, dict) else None
    # Strip control keys before field allowlisting.
    working = {k: v for k, v in payload.items() if not str(k).startswith("_")}
    if identity_meta_raw is not None:
        working["_identityCorrection"] = identity_meta_raw
    allowed = staff_allowed_fields(role, perms, {k for k in working if not str(k).startswith("_")})
    if not allowed:
        raise PermissionError("Not permitted")
    identity = None
    if allowed & IDENTITY_FIELDS:
        identity = require_identity_verification(working, target)
    elif working.keys() & IDENTITY_FIELDS:
        raise PermissionError("Identity correction is not permitted for your role")
    working.pop("_identityCorrection", None)

    doc = {}
    for key in allowed:
        if key == "addresses":
            doc["addresses"] = normalize_addresses(working.get("addresses") or [], existing=target.get("addresses"))
        elif key == "insurance":
            doc["insurance"] = dedupe_insurance(working.get("insurance") or [])
        elif key == "email":
            doc["email"] = sanitize_email(working.get("email"))
        elif key in ("phone", "altPhone"):
            doc[key] = sanitize_phone(working.get(key))
        elif key in ("marketingConsent", "smsConsent", "noInsurance"):
            doc[key] = bool(working.get(key))
        elif key in IDENTITY_FIELDS:
            doc[key] = str(working.get(key) or "").strip()[:80 if key != "dob" else 12]
        else:
            doc[key] = working.get(key)
    # Contact email on the client record does not change login credentials.
    # Preserve any linked account email ownership separately.
    if "email" in doc and doc["email"] != (target.get("email") or ""):
        doc["emailPendingVerification"] = False  # staff contact correction is immediate on the record
        doc["loginEmailUnchanged"] = True
    return doc, identity, sorted(doc.keys())


def snapshot_prior(target, keys):
    snap = {}
    for key in keys:
        if key in ("insurance", "addresses"):
            snap[key] = deepcopy(target.get(key) or [])
        else:
            snap[key] = target.get(key)
    return snap
