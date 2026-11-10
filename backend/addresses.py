"""Canadian civic address checks for mobile visits.

Provider confidence and the client's confirmation are stored separately.
A moved arrival pin does not replace the civic address.

Alberta rural roads (Range Road / Township Road / RR) are first-class civic
forms — they do not require a cardinal city direction (NW/NE/…).
"""
import math
import re

DIRECTIONS = {"NW", "NE", "SW", "SE", "N", "S", "E", "W"}
POSTAL = re.compile(r"\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)\b", re.I)
STREET = re.compile(
    r"^\s*(\d+[A-Z]?)\s+(.+?)\s+(St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Way|Cres|Crescent|Lane|Ln|Trail|Tr|Close|Cl|Gate|Bay|Place|Pl)\.?\s+(NW|NE|SW|SE|N|S|E|W)\b",
    re.I,
)
# Civic number + rural road type + road number (no cardinal direction).
RURAL_ROAD = re.compile(
    r"^\s*(\d+[A-Z]?)\s+"
    r"(?:(Range|Rge)\s+(Road|Rd)|(Township|Twp)\s+(Road|Rd)|RR|Hwy|Highway)\.?\s*"
    r"(\d+[A-Z]?)\b",
    re.I,
)

_ABBREV = (
    (re.compile(r"\bRge\.?\s+Rd\.?\b", re.I), "Range Road"),
    (re.compile(r"\bRange\.?\s+Rd\.?\b", re.I), "Range Road"),
    (re.compile(r"\bTwp\.?\s+Rd\.?\b", re.I), "Township Road"),
    (re.compile(r"\bTownship\.?\s+Rd\.?\b", re.I), "Township Road"),
    # Civic + RR <n> is Alberta Range Road shorthand (not a postal rural-route box).
    (re.compile(r"^(\d+[A-Z]?)\s+RR\.?\s*(\d+[A-Z]?)\b", re.I), r"\1 Range Road \2"),
    (re.compile(r"\bHwy\.?\b", re.I), "Highway"),
)

# PO Box / General Delivery — valid mailing forms, not mobile service destinations.
_PO_BOX = re.compile(
    r"\b(?:P\.?\s*O\.?\s*Box|Post\s*Office\s*Box|POB)\s*#?\s*\d+\b|\bGeneral\s+Delivery\b",
    re.I,
)

# Explicit verification states shown to staff/clients. Distinct from provider confidence.
VERIFICATION_STATES = ("verified", "needs_confirmation", "manual_review", "invalid")

# Driving-distance threshold above which a mobile visit needs owner/practitioner approval.
MANUAL_APPROVAL_KM = 40.0


def is_po_box(line):
    return bool(_PO_BOX.search(str(line or "")))


def alberta_postal(postal):
    """Alberta forward sortation starts with T. Other Canadian FSAs are still valid mail."""
    code = postal_code(postal)
    return bool(code) and code[0] == "T"


def verification_state_for(*, confidence=None, client_confirmed=False, postal_status=None,
                           eligible=None, po_box=False, purpose="home"):
    """Map geocoder confidence + confirmation into an explicit verification state.

    Manual entry alone never yields verified. Provider confidence stays separate
    from client/staff confirmation (clientConfirmed).
    """
    conf = str(confidence or "").strip().lower()
    postal = str(postal_status or "").strip().lower()
    if conf in ("invalid",) or postal == "invalid":
        return "invalid"
    if po_box and purpose in ("service", "home", "temporary"):
        # A PO box may be stored as mailing; it is not a verified service destination.
        return "manual_review" if purpose != "mailing" else "needs_confirmation"
    if conf == "address" and client_confirmed and postal in ("", "match", "supplied", None):
        if eligible is False:
            return "manual_review"
        return "verified"
    if conf in ("review", "unresolved", "approximate") or postal in ("conflict", "missing"):
        return "manual_review" if conf in ("review", "unresolved") or postal == "conflict" else "needs_confirmation"
    if client_confirmed:
        return "needs_confirmation"
    return "needs_confirmation"


def requires_manual_travel_approval(km):
    """Destinations beyond MANUAL_APPROVAL_KM need owner/practitioner approval before confirm."""
    try:
        distance = float(km)
    except (TypeError, ValueError):
        return True  # Unknown distance → require review rather than fabricate.
    return distance > MANUAL_APPROVAL_KM


def postal_code(value):
    match = POSTAL.search(str(value or "").upper())
    if not match:
        return ""
    return f"{match.group(1)} {match.group(2)}"


def postal_fsa(value):
    code = postal_code(value)
    if code:
        return code[:3]
    # Nearby reverse hints may only carry the forward sortation area.
    text = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if len(text) >= 3 and text[0].isalpha() and text[1].isdigit() and text[2].isalpha():
        return text[:3]
    return ""


def postal_field_is_clean(value):
    """True when a dedicated postal field is empty or only a Canadian postal code.

    Address lines may embed a postal among city/province text — use postal_code()
    for those. The booking postal input must not accept surrounding junk.
    """
    raw = " ".join(str(value or "").split())
    if not raw:
        return True
    code = postal_code(raw)
    if not code:
        return False
    compact_raw = re.sub(r"[^A-Z0-9]", "", raw.upper())
    compact_code = re.sub(r"[^A-Z0-9]", "", code)
    return compact_raw == compact_code


def prefer_requested_civic_casing(hit_line, requested_line):
    """Keep the client's alphanumeric street casing (176A) when the geocoder lowercases it."""
    hit_text = " ".join(str(hit_line or "").split())
    req_text = " ".join(str(requested_line or "").split())
    if not hit_text or not req_text:
        return hit_text
    hit = parse_civic(hit_text)
    req = parse_civic(normalize_rural_query(req_text))
    if not (hit.get("number") and req.get("number") and hit["number"].casefold() == req["number"].casefold()):
        return hit_text
    if not (hit.get("street") and req.get("street")):
        return hit_text
    if re.sub(r"[^a-z0-9]", "", hit["street"].casefold()) != re.sub(r"[^a-z0-9]", "", req["street"].casefold()):
        return hit_text
    # Rebuild the street head from the client's casing; keep locality from the geocoder.
    street_type = req.get("type") or hit.get("type") or ""
    direction = req.get("direction") or hit.get("direction") or ""
    head = " ".join(part for part in (req["number"], req["street"], street_type, direction) if part)
    tail = hit_text.split(",", 1)[1].strip() if "," in hit_text else ""
    return f"{head}, {tail}" if tail else head


def normalize_rural_query(line):
    """Expand common Alberta rural abbreviations for geocoding and display."""
    text = " ".join(str(line or "").split())
    if not text:
        return ""
    for pattern, replacement in _ABBREV:
        text = pattern.sub(replacement, text)
    text = re.sub(r"\bAlberta\b", "AB", text, flags=re.I)
    text = re.sub(r",\s*AB\b", ", AB", text, flags=re.I)
    return " ".join(text.split())


def normalize_destination_line(line):
    """Canonical storage/display form for a confirmed rural or city destination."""
    text = normalize_rural_query(line)
    if not text:
        return ""
    # Prefer compact province token when Mapbox returns the full name mid-line.
    text = re.sub(r",\s*Alberta\b", ", AB", text, flags=re.I)
    text = re.sub(r"\s+,", ",", text)
    return " ".join(text.split())


def parse_civic(line):
    text = " ".join(str(line or "").split())
    parts = [part.strip() for part in text.split(",")]
    head = parts[0] if parts else ""
    city = parts[1] if len(parts) > 1 else ""
    province = ""
    if len(parts) > 2:
        province = parts[2].split()[0].upper()
        if province == "ALBERTA":
            province = "AB"
    number, name, street_type, direction = "", head, "", ""
    match = STREET.match(head)
    if match:
        number, name, street_type, direction = match.group(1), match.group(2), match.group(3), match.group(4).upper()
    else:
        rural = RURAL_ROAD.match(normalize_rural_query(head))
        if rural:
            number = rural.group(1)
            road_num = rural.group(6)
            if rural.group(2):  # Range / Rge
                name, street_type = f"Range Road {road_num}", "Road"
            elif rural.group(4):  # Township / Twp
                name, street_type = f"Township Road {road_num}", "Road"
            elif re.match(r"^\s*\d+[A-Z]?\s+(Hwy|Highway)\b", normalize_rural_query(head), re.I):
                name, street_type = f"Highway {road_num}", "Highway"
            else:  # RR
                name, street_type = f"Range Road {road_num}", "Road"
        else:
            tokens = head.split()
            if tokens and tokens[-1].upper() in DIRECTIONS:
                direction = tokens[-1].upper()
            if tokens and tokens[0][:1].isdigit():
                number = tokens[0]
    return {
        "number": number,
        "street": name,
        "type": street_type,
        "direction": direction,
        "unit": "",
        "city": city,
        "province": province,
        "postal": postal_code(text),
        "country": "CA",
        "line": text,
    }


def _km(a, b):
    lat1, lng1, lat2, lng2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    dlat, dlng = lat2 - lat1, lng2 - lng1
    hav = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(hav))


def classify(hit, requested_line, requested_postal, arrival=None, *, service_region="AB"):
    """Classify a geocode hit.

    Canadian postal codes outside Alberta are valid mailing addresses. The
    Alberta (T*) service-region check only affects mobile-visit confidence when
    service_region is AB — it does not mark an out-of-province mailing address
    invalid.
    """
    civic = parse_civic(hit.get("line") or "")
    civic["postal"] = postal_code(hit.get("postal")) or civic["postal"]
    supplied = postal_code(requested_postal)
    civic_postal = civic.get("postal") or ""
    precise = bool(civic.get("number") or is_po_box(hit.get("line") or requested_line)) and hit.get("provider") in ("local", "mapbox", "edmonton")
    # PO boxes are precise enough to store as mailing, but never as a service pin.
    if is_po_box(hit.get("line") or requested_line):
        precise = hit.get("provider") in ("local", "mapbox", "edmonton", "manual") or bool(supplied or civic_postal)
    confidence = "address" if precise else "approximate"
    raw_postal = str(requested_postal or "").strip()
    line_postal = postal_code(requested_line)
    fsa_hint = postal_fsa(hit.get("postalFsa") or "")
    if requested_postal and raw_postal and not postal_field_is_clean(raw_postal):
        # Dedicated postal field with surrounding junk (e.g. "junk T5J 2R4").
        confidence = "review"
        postal_status = "invalid"
        supplied = ""
    elif requested_postal and not supplied and raw_postal:
        # Genuinely malformed postal text.
        confidence = "review"
        postal_status = "invalid"
    elif civic_postal and supplied and civic_postal != supplied:
        confidence = "review"
        postal_status = "conflict"
    elif requested_postal and not supplied:
        confidence = "review"
        postal_status = "invalid"
    elif not supplied and not civic_postal:
        confidence = "review"
        postal_status = "missing"
    elif supplied and not civic_postal:
        # City GIS often omits postcodes. Prefer consistency with the typed line
        # postal and, when available, a nearby FSA hint from reverse geocoding.
        if line_postal and line_postal != supplied:
            confidence = "review"
            postal_status = "conflict"
        elif fsa_hint and postal_fsa(supplied) != fsa_hint:
            confidence = "review"
            postal_status = "conflict"
        else:
            postal_status = "supplied"
    else:
        postal_status = "match"
    # Outside the Alberta mobile region: keep the address valid; flag service use for review.
    if supplied and service_region == "AB" and not alberta_postal(supplied) and not is_po_box(requested_line):
        # Valid Canadian mail — not an automatic service destination.
        if confidence == "address":
            confidence = "approximate"
    requested = parse_civic(normalize_rural_query(requested_line))
    if requested.get("number") and civic.get("number") and requested["number"].casefold() != civic["number"].casefold():
        confidence = "review"
    # A geocoder can return the correct civic number but a different street.
    # Never treat that as a verified destination solely because the numbers match.
    def street_key(value):
        return re.sub(r"[^a-z0-9]", "", str(value or "").casefold())
    if requested.get("street") and civic.get("street") and requested.get("type") and civic.get("type"):
        if street_key(requested["street"]) != street_key(civic["street"]):
            confidence = "review"
    def city_key(value):
        return " ".join(str(value or "").casefold().replace(".", "").split())
    if requested.get("city") and civic.get("city") and city_key(requested["city"]) != city_key(civic["city"]):
        confidence = "review"
    if requested.get("direction") and civic.get("direction") and requested["direction"] != civic["direction"]:
        confidence = "review"
    if requested.get("type") and civic.get("type") and requested["type"].lower()[:2] != civic["type"].lower()[:2]:
        confidence = "review"
    po_box = is_po_box(hit.get("line") or requested_line)
    if not civic.get("number") and not po_box:
        confidence = "review"
    if hit.get("matchConfidence") in ("low", "medium"):
        confidence = "review"
    if hit.get("provider") == "device":
        confidence = "approximate"
    discrepancy = False
    if arrival and arrival.get("lat") is not None and arrival.get("lng") is not None:
        discrepancy = _km({"lat": hit["lat"], "lng": hit["lng"]}, arrival) > 0.15
        if discrepancy:
            confidence = "review"
    state = verification_state_for(
        confidence=confidence,
        client_confirmed=False,
        postal_status=postal_status,
        po_box=po_box,
        purpose="mailing" if po_box else "home",
    )
    review_reason = ""
    if confidence == "review":
        if postal_status == "conflict":
            review_reason = "postal_conflict"
        elif postal_status in ("invalid", "missing"):
            review_reason = f"postal_{postal_status}"
        elif requested.get("number") and civic.get("number") and requested["number"].casefold() != civic["number"].casefold():
            review_reason = "civic_number_mismatch"
        elif requested.get("street") and civic.get("street") and street_key(requested["street"]) != street_key(civic["street"]):
            review_reason = "street_mismatch"
        elif discrepancy:
            review_reason = "arrival_pin"
        elif hit.get("matchConfidence") in ("low", "medium"):
            review_reason = "provider_approximate"
        else:
            review_reason = "needs_review"
    elif confidence == "approximate":
        review_reason = "approximate"
    elif confidence == "unresolved":
        review_reason = "unresolved"
    return {
        "civic": civic,
        "confidence": confidence,
        "provider": hit.get("provider") or "",
        "providerConfidence": hit.get("matchConfidence") or hit.get("provider") or "",
        "postalStatus": postal_status,
        "arrivalDiscrepancy": discrepancy,
        "clientConfirmed": False,
        "verificationState": state,
        "poBox": po_box,
        "mailingOnly": po_box,
        "reviewReason": review_reason,
    }


def client_address_message(assessed):
    """Plain-language copy for booking clients. Never expose raw confidence tokens."""
    confidence = str((assessed or {}).get("confidence") or "")
    reason = str((assessed or {}).get("reviewReason") or "")
    postal = str((assessed or {}).get("postalStatus") or "")
    if assessed and assessed.get("accepted"):
        return "Please confirm this is the correct location."
    if postal == "conflict" or reason == "postal_conflict":
        return "The postal code does not match this street address. Check the code or request a review."
    if reason in ("street_mismatch", "civic_number_mismatch"):
        return "We couldn't find an exact match for that street address. Check the number and street, or request a review."
    if reason == "provider_approximate" or confidence == "approximate":
        return "We couldn't find an exact match. Check your address or request a review."
    if confidence in ("review", "unresolved") or reason:
        return "This location requires confirmation from NabiTouch before we can finalize your appointment."
    return "Please confirm this is the correct location."
