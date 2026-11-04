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


def postal_code(value):
    match = POSTAL.search(str(value or "").upper())
    if not match:
        return ""
    return f"{match.group(1)} {match.group(2)}"


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


def classify(hit, requested_line, requested_postal, arrival=None):
    civic = parse_civic(hit.get("line") or "")
    civic["postal"] = postal_code(hit.get("postal")) or civic["postal"]
    supplied = postal_code(requested_postal)
    civic_postal = civic.get("postal") or ""
    precise = bool(civic.get("number")) and hit.get("provider") in ("local", "mapbox")
    confidence = "address" if precise else "approximate"
    if requested_postal and (not POSTAL.fullmatch(str(requested_postal).strip()) or not supplied.startswith("T")):
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
        postal_status = "supplied"
    else:
        postal_status = "match"
    requested = parse_civic(normalize_rural_query(requested_line))
    if requested.get("number") and civic.get("number") and requested["number"].casefold() != civic["number"].casefold():
        confidence = "review"
    def city_key(value):
        return " ".join(str(value or "").casefold().replace(".", "").split())
    if requested.get("city") and civic.get("city") and city_key(requested["city"]) != city_key(civic["city"]):
        confidence = "review"
    if requested.get("direction") and civic.get("direction") and requested["direction"] != civic["direction"]:
        confidence = "review"
    if requested.get("type") and civic.get("type") and requested["type"].lower()[:2] != civic["type"].lower()[:2]:
        confidence = "review"
    if not civic.get("number"):
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
    return {
        "civic": civic,
        "confidence": confidence,
        "provider": hit.get("provider") or "",
        "providerConfidence": hit.get("provider") or "",
        "postalStatus": postal_status,
        "arrivalDiscrepancy": discrepancy,
        "clientConfirmed": False,
    }
