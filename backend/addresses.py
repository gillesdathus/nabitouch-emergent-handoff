"""Canadian civic address checks for mobile visits.

Provider confidence and the client's confirmation are stored separately.
A moved arrival pin does not replace the civic address.
"""
import math
import re

DIRECTIONS = {"NW", "NE", "SW", "SE", "N", "S", "E", "W"}
POSTAL = re.compile(r"\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)\b", re.I)
STREET = re.compile(
    r"^\s*(\d+[A-Z]?)\s+(.+?)\s+(St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Way|Cres|Crescent|Lane|Ln|Trail|Tr|Close|Cl|Gate|Bay|Place|Pl)\.?\s+(NW|NE|SW|SE|N|S|E|W)\b",
    re.I,
)


def postal_code(value):
    match = POSTAL.search(str(value or "").upper())
    if not match:
        return ""
    return f"{match.group(1)} {match.group(2)}"


def parse_civic(line):
    text = " ".join(str(line or "").split())
    parts = [part.strip() for part in text.split(",")]
    head = parts[0] if parts else ""
    city = parts[1] if len(parts) > 1 else ""
    province = ""
    if len(parts) > 2:
        province = parts[2].split()[0].upper()
    match = STREET.match(head)
    number, name, street_type, direction = "", head, "", ""
    if match:
        number, name, street_type, direction = match.group(1), match.group(2), match.group(3), match.group(4).upper()
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


def classify(hit, requested_line, requested_postal, arrival=None):
    civic = parse_civic(hit.get("line") or "")
    supplied = postal_code(requested_postal)
    civic_postal = civic.get("postal") or ""
    precise = bool(civic.get("number")) and hit.get("provider") in ("local", "mapbox")
    confidence = "address" if precise else "approximate"
    if civic_postal and supplied and civic_postal != supplied:
        confidence = "review"
        postal_status = "conflict"
    elif requested_postal and not supplied:
        confidence = "review"
        postal_status = "invalid"
    elif not supplied and not civic_postal:
        confidence = "review"
        postal_status = "missing"
    elif supplied and not civic_postal:
        postal_status = "supplied"
    else:
        postal_status = "match"
    requested = parse_civic(requested_line)
    if requested.get("direction") and civic.get("direction") and requested["direction"] != civic["direction"]:
        confidence = "review"
    if requested.get("type") and civic.get("type") and requested["type"].lower()[:2] != civic["type"].lower()[:2]:
        confidence = "review"
    if not civic.get("number"):
        confidence = "review"
    if hit.get("provider") == "device":
        confidence = "approximate"
    discrepancy = False
    if arrival and arrival.get("lat") is not None and arrival.get("lng") is not None:
        discrepancy = _km({"lat": hit["lat"], "lng": hit["lng"]}, arrival) > 0.15
        if discrepancy:
            confidence = "review"
    return {
        "civic": civic,
        "confidence": confidence,
        "provider": hit.get("provider") or "",
        "providerConfidence": hit.get("provider") or "",
        "postalStatus": postal_status,
        "arrivalDiscrepancy": discrepancy,
        "clientConfirmed": False,
    }
