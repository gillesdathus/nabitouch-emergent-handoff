"""NabiTouch Noterro-style CSV adapters for Checkpoint D dry-run migration previews.

Parses the three historical exports, reconciles patients and finances, and builds
payloads compatible with legacy staging. Preview mode never writes operational
collections. Raw source files stay outside git (private_imports/).
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation

from staff_identity import CANONICAL_PRACTITIONER_ID, CANONICAL_PRACTITIONER_NAME

# Preliminary figures from the Phase 1 brief — compared, never forced.
PRELIMINARY = {
    "main_patient_export": 25,
    "secondary_patient_export": 23,
    "distinct_patient_names": 27,
    "unique_invoice_numbers": 51,
    "billed_massage_service_units": 57,
    "associated_treatment_duration_hours": 59,
    "billed_total_cad": Decimal("6657.50"),
    "outstanding_balance_cad": Decimal("457.55"),
}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clip(value, limit=240):
    return str(value or "").strip()[:limit]


def _norm_space(value):
    return re.sub(r"\s+", " ", str(value or "").strip())


def _norm_name(value):
    return _norm_space(value).casefold()


def _norm_email(value):
    text = _clip(value, 120).lower()
    return text if EMAIL_RE.match(text) else ""


def _phone_digits(value):
    return re.sub(r"\D", "", str(value or ""))


def _phone_ok(value):
    return len(_phone_digits(value)) >= 10


def _money_cents(value):
    text = str(value or "").strip().replace("$", "").replace(",", "")
    if not text or text in {"-", "—", "–"}:
        return 0
    try:
        return int((Decimal(text) * 100).quantize(Decimal("1")))
    except (InvalidOperation, ValueError):
        return None


def _duration_minutes(value):
    try:
        return int(Decimal(str(value or "0")))
    except (InvalidOperation, ValueError):
        return 0


def _quantity(value):
    try:
        return float(Decimal(str(value or "0")))
    except (InvalidOperation, ValueError):
        return 0.0


def _digest(*parts):
    raw = "|".join(_norm_name(part) for part in parts if _norm_space(part))
    if not raw:
        return None
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _source_key(*, email="", phone="", first="", last="", dob="", label=""):
    if email:
        return "email:" + _digest(email)
    if phone and _phone_ok(phone):
        return "phone:" + hashlib.sha256(_phone_digits(phone).encode()).hexdigest()
    if first and last and dob:
        return "namedob:" + _digest(first, last, dob)
    if label:
        return "name:" + _digest(label)
    if first or last:
        return "name:" + _digest(first, last)
    return "anon:" + hashlib.sha256(repr((first, last, dob, email, phone)).encode()).hexdigest()


def _read_csv(payload, filename="upload.csv"):
    if isinstance(payload, (bytes, bytearray)):
        text = payload.decode("utf-8-sig")
    else:
        text = str(payload)
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError(f"{filename} has no header row")
    rows = []
    for offset, raw in enumerate(reader, start=2):
        rows.append({(k or "").strip(): (v if v is not None else "") for k, v in raw.items()})
        rows[-1]["_row"] = offset
    return list(reader.fieldnames or []), rows


def parse_patient_export(payload):
    """Main Noterro-style patient export."""
    cols, rows = _read_csv(payload, "patient_export.csv")
    required = {"first_name", "last_name"}
    missing = [name for name in required if name not in cols]
    patients = []
    errors = []
    if missing:
        errors.append({"file": "patient_export", "message": "Missing columns: " + ", ".join(missing)})
    for raw in rows:
        first = _clip(raw.get("first_name"), 80)
        last = _clip(raw.get("last_name"), 80)
        email = _norm_email(raw.get("email"))
        phone = _clip(raw.get("cell_phone") or raw.get("home_phone") or raw.get("work_phone"), 40)
        dob = _clip(raw.get("date_of_birth"), 20)
        address_parts = [
            _clip(raw.get("address1"), 120),
            _clip(raw.get("city"), 80),
            _clip(raw.get("prov_state"), 40),
            _clip(raw.get("postal_zip_code"), 20),
        ]
        address = ", ".join(part for part in address_parts if part)
        display = f"{first} {last}".strip()
        source_id = _source_key(email=email, phone=phone, first=first, last=last, dob=dob, label=display)
        patients.append({
            "sourceFile": "patient_export",
            "sourceId": source_id,
            "firstName": first,
            "lastName": last,
            "displayName": display,
            "email": email,
            "phone": phone if _phone_ok(phone) else "",
            "dateOfBirth": dob,
            "gender": _clip(raw.get("gender"), 40),
            "address": address,
            "emergencyName": _clip(raw.get("emergency_contact_name"), 80),
            "emergencyPhone": _clip(raw.get("emergency_contact_phone"), 40),
            "referredBy": _clip(raw.get("source_of_referral"), 120),
            "lastAppointmentAt": _clip(raw.get("last_appointment_date (GMT+0)") or raw.get("last_appointment_date"), 40),
            "hasEmail": bool(email),
            "hasPhone": _phone_ok(phone),
            "row": raw.get("_row"),
        })
    return {"columns": cols, "patients": patients, "errors": errors, "rowCount": len(rows)}


def parse_patients_without_appointments(payload):
    """Secondary patient list (often incomplete contact)."""
    cols, rows = _read_csv(payload, "patients_without_appointments.csv")
    patients = []
    errors = []
    if "Patient" not in cols:
        errors.append({"file": "patients_without_appointments", "message": "Missing Patient column"})
    for raw in rows:
        display = _clip(raw.get("Patient"), 120)
        if not display:
            continue
        parts = display.split(None, 1)
        first = parts[0] if parts else ""
        last = parts[1] if len(parts) > 1 else ""
        email = _norm_email(raw.get("Patient Email"))
        phone = _clip(raw.get("Mobile Phone") or raw.get("Home Phone"), 40)
        source_id = _source_key(email=email, phone=phone, first=first, last=last, label=display)
        patients.append({
            "sourceFile": "patients_without_appointments",
            "sourceId": source_id,
            "firstName": first,
            "lastName": last,
            "displayName": display,
            "email": email,
            "phone": phone if _phone_ok(phone) else "",
            "dateOfBirth": "",
            "gender": "",
            "address": "",
            "emergencyName": "",
            "emergencyPhone": "",
            "referredBy": "",
            "lastAppointmentAt": _clip(raw.get("Last Appointment Date"), 40),
            "hasEmail": bool(email),
            "hasPhone": _phone_ok(phone),
            "row": raw.get("_row"),
        })
    return {"columns": cols, "patients": patients, "errors": errors, "rowCount": len(rows)}


def parse_sales_report(payload):
    """Practitioner sales / invoice lines. Lines are billed services, not verified appointments."""
    cols, rows = _read_csv(payload, "practitioner_sales_report.csv")
    required = {"INV-#", "Service", "Patient", "Total"}
    errors = []
    missing = [name for name in required if name not in cols]
    if missing:
        errors.append({"file": "sales", "message": "Missing columns: " + ", ".join(missing)})
    lines = []
    for raw in rows:
        inv = _clip(raw.get("INV-#"), 40)
        # Trailing Sub-total / Taxes / Total summary rows have no invoice number.
        if not inv:
            label = _clip(raw.get("Tax Amount") or raw.get("Total") or raw.get("Balance"), 40).casefold()
            if label in {"sub-total", "taxes", "total"} or not any(raw.get(k) for k in ("Service", "Patient", "Price")):
                continue
        total = _money_cents(raw.get("Total"))
        price = _money_cents(raw.get("Price"))
        tax = _money_cents(raw.get("Tax Amount"))
        adj = _money_cents(raw.get("Adj."))
        balance = _money_cents(raw.get("Balance"))
        if not inv:
            errors.append({"file": "sales", "row": raw.get("_row"), "message": "Missing invoice number"})
            continue
        if total is None or price is None:
            errors.append({"file": "sales", "row": raw.get("_row"), "message": "Unreadable money field"})
            continue
        patient = _clip(raw.get("Patient"), 120)
        practitioner = _clip(raw.get("Practitioner"), 120)
        payment = _clip(raw.get("Payments"), 40) or "-"
        duration = _duration_minutes(raw.get("Duration"))
        qty = _quantity(raw.get("Quantity"))
        lines.append({
            "sourceFile": "practitioner_sales_report",
            "invoiceNumber": inv,
            "service": _clip(raw.get("Service"), 120),
            "durationMin": duration,
            "category": _clip(raw.get("Service Category"), 80),
            "serviceDate": _clip(raw.get("Tx Date"), 40),
            "patientName": patient,
            "practitionerName": practitioner,
            "paymentMethod": payment,
            "priceCents": price or 0,
            "adjustmentCents": adj or 0,
            "quantity": qty,
            "taxName": _clip(raw.get("Tax Name"), 80),
            "taxRate": _clip(raw.get("Tax Rate"), 40),
            "taxCents": tax or 0,
            "totalCents": total or 0,
            "balanceCents": balance if balance is not None else 0,
            "row": raw.get("_row"),
            "classification": "historical_billed_service",
            "verifiedAppointment": False,
            "countsAsCollectedRevenue": False,
        })
    return {"columns": cols, "lines": lines, "errors": errors, "rowCount": len(rows)}


def _merge_patient_identity(a, b):
    """Prefer populated fields; never invent values."""
    out = dict(a)
    for key in ("firstName", "lastName", "displayName", "email", "phone", "dateOfBirth", "gender",
                "address", "emergencyName", "emergencyPhone", "referredBy", "lastAppointmentAt"):
        if not out.get(key) and b.get(key):
            out[key] = b[key]
    out["hasEmail"] = bool(out.get("email"))
    out["hasPhone"] = bool(out.get("phone") and _phone_ok(out["phone"]))
    sources = list(dict.fromkeys((a.get("sourceFiles") or [a.get("sourceFile")]) + (b.get("sourceFiles") or [b.get("sourceFile")])))
    out["sourceFiles"] = [s for s in sources if s]
    out["sourceIds"] = list(dict.fromkeys((a.get("sourceIds") or [a.get("sourceId")]) + (b.get("sourceIds") or [b.get("sourceId")])))
    return out


def reconcile_patients(patient_export, secondary_export, sales_lines, existing_clients=None):
    """Classify incoming patients. Name-only matches are review, never auto-merge."""
    existing_clients = existing_clients or []
    by_email = {_norm_email(c.get("email")): c for c in existing_clients if _norm_email(c.get("email"))}
    by_phone = {_phone_digits(c.get("phone")): c for c in existing_clients if _phone_ok(c.get("phone"))}

    incoming = []
    for row in patient_export:
        incoming.append({**row, "sourceFiles": [row["sourceFile"]], "sourceIds": [row["sourceId"]]})
    for row in secondary_export:
        incoming.append({**row, "sourceFiles": [row["sourceFile"]], "sourceIds": [row["sourceId"]]})

    # Stable identity buckets: email, then phone, else keep separate (name-only is review).
    buckets = {}
    order = []
    for row in incoming:
        key = None
        if row.get("email"):
            key = "e:" + row["email"]
        elif row.get("phone"):
            key = "p:" + _phone_digits(row["phone"])
        else:
            key = "solo:" + row["sourceId"]
        if key in buckets:
            buckets[key] = _merge_patient_identity(buckets[key], row)
        else:
            buckets[key] = row
            order.append(key)

    # Sales-only names (no patient file row with same normalized display name).
    known_names = {_norm_name(buckets[k].get("displayName")) for k in order}
    sales_names = sorted({_norm_name(line.get("patientName")) for line in sales_lines if line.get("patientName")})
    missing_from_exports = []
    for name in sales_names:
        if name and name not in known_names:
            parts = name.split(None, 1)
            stub = {
                "sourceFile": "practitioner_sales_report",
                "sourceFiles": ["practitioner_sales_report"],
                "sourceId": _source_key(label=name),
                "sourceIds": [_source_key(label=name)],
                "firstName": parts[0].title() if parts else "",
                "lastName": parts[1].title() if len(parts) > 1 else "",
                "displayName": name.title(),
                "email": "",
                "phone": "",
                "dateOfBirth": "",
                "hasEmail": False,
                "hasPhone": False,
                "fromSalesOnly": True,
            }
            missing_from_exports.append(stub)
            key = "solo:" + stub["sourceId"]
            buckets[key] = stub
            order.append(key)

    # Name collisions across unresolved rows (same display, different contact keys).
    name_index = defaultdict(list)
    for key in order:
        name_index[_norm_name(buckets[key].get("displayName"))].append(key)

    classifications = []
    for key in order:
        row = buckets[key]
        name_peers = name_index[_norm_name(row.get("displayName"))]
        potential_dup = len(name_peers) > 1
        matched = None
        if row.get("email") and row["email"] in by_email:
            matched = by_email[row["email"]]
        elif row.get("phone") and _phone_digits(row["phone"]) in by_phone:
            matched = by_phone[_phone_digits(row["phone"])]

        if matched:
            status = "existing_matched"
        elif not row.get("email") and not row.get("phone"):
            status = "missing_contact"
        elif potential_dup:
            status = "potential_duplicate"
        elif row.get("fromSalesOnly"):
            status = "requires_manual_review"
        else:
            status = "new_patient"

        if potential_dup and status == "new_patient":
            status = "potential_duplicate"

        classifications.append({
            "status": status,
            "sourceId": row["sourceId"],
            "sourceFiles": row.get("sourceFiles") or [],
            "displayNameHash": _digest(row.get("displayName"))[:12],
            "hasEmail": row.get("hasEmail"),
            "hasPhone": row.get("hasPhone"),
            "fromSalesOnly": bool(row.get("fromSalesOnly")),
            "existingClientId": (matched or {}).get("id"),
            "patient": row,
        })

    counts = Counter(item["status"] for item in classifications)
    return {
        "patients": classifications,
        "counts": dict(counts),
        "distinctIncoming": len(classifications),
        "salesPatientsMissingFromExports": len(missing_from_exports),
        "note": "Name-only overlaps are potential_duplicate / requires_manual_review — never auto-merged.",
    }


def reconcile_finances(sales_lines):
    by_invoice = defaultdict(list)
    for line in sales_lines:
        by_invoice[line["invoiceNumber"]].append(line)

    invoices = []
    outstanding = 0
    billed_line_total = 0
    tax_total = 0
    adj_total = 0
    duration_min = 0
    qty_total = 0.0
    for inv, lines in sorted(by_invoice.items()):
        line_sum = sum(item["totalCents"] for item in lines)
        billed_line_total += line_sum
        tax_total += sum(item["taxCents"] for item in lines)
        adj_total += sum(item["adjustmentCents"] for item in lines)
        duration_min += sum(item["durationMin"] for item in lines)
        qty_total += sum(item["quantity"] for item in lines)
        balance = lines[-1]["balanceCents"]
        outstanding += balance
        payments = sorted({item["paymentMethod"] for item in lines})
        # Collected is unknown unless payment method and zero balance imply settlement.
        implied_paid = balance == 0 and any(p not in {"-", ""} for p in payments)
        invoices.append({
            "invoiceNumber": inv,
            "sourceId": f"noterro:{inv}",
            "lineCount": len(lines),
            "totalCents": line_sum,
            "balanceCents": balance,
            "taxCents": sum(item["taxCents"] for item in lines),
            "adjustmentCents": sum(item["adjustmentCents"] for item in lines),
            "patientNameHash": _digest(lines[0].get("patientName"))[:12],
            "practitionerName": lines[0].get("practitionerName"),
            "paymentMethods": payments,
            "serviceDates": sorted({item["serviceDate"] for item in lines if item["serviceDate"]}),
            "classification": "historical_invoice",
            "verifiedAppointment": False,
            "paymentConfirmed": implied_paid,
            "outstanding": balance > 0,
            "lines": lines,
        })

    non_nabitu = [
        inv for inv in invoices
        if inv.get("practitionerName") and _norm_name(inv["practitionerName"]) != _norm_name(CANONICAL_PRACTITIONER_NAME)
    ]
    massage_lines = [
        line for line in sales_lines
        if _norm_name(line.get("category")) == "massage"
    ]
    travel_lines = [
        line for line in sales_lines
        if "travel" in _norm_name(line.get("category")) or "travel" in _norm_name(line.get("service"))
    ]
    massage_qty = sum(line["quantity"] for line in massage_lines)
    massage_duration = sum(line["durationMin"] for line in massage_lines)
    return {
        "invoiceCount": len(invoices),
        "lineCount": len(sales_lines),
        "billedServiceUnits": qty_total,
        "massageServiceUnits": massage_qty,
        "travelFeeUnits": sum(line["quantity"] for line in travel_lines),
        "durationMinutes": duration_min,
        "durationHours": round(duration_min / 60, 2),
        "massageDurationHours": round(massage_duration / 60, 2),
        "billedTotalCents": billed_line_total,
        "billedTotalCad": billed_line_total / 100,
        "massageBilledCad": sum(line["totalCents"] for line in massage_lines) / 100,
        "travelBilledCad": sum(line["totalCents"] for line in travel_lines) / 100,
        "taxCents": tax_total,
        "adjustmentCents": adj_total,
        "outstandingBalanceCents": outstanding,
        "outstandingBalanceCad": outstanding / 100,
        "invoices": invoices,
        "nonNabituInvoices": len(non_nabitu),
        "paymentMethodCounts": dict(Counter(line["paymentMethod"] for line in sales_lines)),
        "serviceCounts": dict(Counter(line["service"] for line in sales_lines)),
        "note": (
            "Line Total amounts are billed figures. Balance is taken once per invoice "
            "(last row). Payments are not treated as verified collected revenue unless "
            "balance is zero and a payment method other than '-' is present. "
            "massageServiceUnits counts Service Category=Massage only; billedServiceUnits "
            "includes travel-fee lines."
        ),
    }


def compare_preliminary(verified):
    prelim = PRELIMINARY
    return {
        "main_patient_export": {"preliminary": prelim["main_patient_export"], "verified": verified["mainPatientExportRows"]},
        "secondary_patient_export": {"preliminary": prelim["secondary_patient_export"], "verified": verified["secondaryPatientExportRows"]},
        "distinct_patient_names": {"preliminary": prelim["distinct_patient_names"], "verified": verified["distinctDisplayNames"]},
        "unique_invoice_numbers": {"preliminary": prelim["unique_invoice_numbers"], "verified": verified["finances"]["invoiceCount"]},
        "billed_massage_service_units": {
            "preliminary": prelim["billed_massage_service_units"],
            "verified": verified["finances"]["massageServiceUnits"],
            "all_line_units_including_travel": verified["finances"]["billedServiceUnits"],
        },
        "associated_treatment_duration_hours": {
            "preliminary": float(prelim["associated_treatment_duration_hours"]),
            "verified": verified["finances"]["massageDurationHours"],
            "all_duration_hours_including_travel_rows": verified["finances"]["durationHours"],
            "explanation": "Verified hours are sum(Duration minutes)/60 for Massage category lines.",
        },
        "billed_total_cad": {
            "preliminary": float(prelim["billed_total_cad"]),
            "verified": verified["finances"]["billedTotalCad"],
        },
        "outstanding_balance_cad": {
            "preliminary": float(prelim["outstanding_balance_cad"]),
            "verified": verified["finances"]["outstandingBalanceCad"],
        },
    }


def to_legacy_records(patient_rows):
    """Map reconciled patients into legacy.import record shape (for future Checkpoint E)."""
    records = []
    for item in patient_rows:
        p = item["patient"]
        records.append({
            "id": p["sourceId"],
            "first_name": p.get("firstName") or "",
            "last_name": p.get("lastName") or "",
            "email": p.get("email") or "",
            "phone": p.get("phone") or "",
            "address": p.get("address") or "",
            "date_of_birth": p.get("dateOfBirth") or "",
            "gender": p.get("gender") or "",
            "emergency_contact_name": p.get("emergencyName") or "",
            "emergency_contact_phone": p.get("emergencyPhone") or "",
            "referred_by": p.get("referredBy") or "",
            "source": "nabitouch_history_csv",
            "noterro_id": p.get("sourceId") or "",
        })
    return records


def to_legacy_invoices(finance):
    """Map invoices for legacy staging. Does not create appointments or ledger postings."""
    invoices = []
    for inv in finance["invoices"]:
        invoices.append({
            "sourceId": inv["sourceId"],
            "sourcePatientId": None,
            "number": inv["invoiceNumber"],
            "issuedOn": (inv["serviceDates"][0] if inv["serviceDates"] else ""),
            "totalCents": inv["totalCents"],
            "currency": "CAD",
            "state": "issued" if inv["outstanding"] else "paid",
            "service": "; ".join(sorted({line["service"] for line in inv["lines"]}))[:120],
            "practitionerId": CANONICAL_PRACTITIONER_ID if _norm_name(inv.get("practitionerName")) == _norm_name(CANONICAL_PRACTITIONER_NAME) else None,
            "countsAsRevenue": False,
            "ledgerPosted": False,
            "balanceCents": inv["balanceCents"],
            "classification": "historical_billed_service",
            "verifiedAppointment": False,
        })
    return invoices


def build_migration_preview(*, patient_export_csv, secondary_csv, sales_csv, existing_clients=None):
    """Full Checkpoint D dry-run report. No database writes."""
    pe = parse_patient_export(patient_export_csv)
    pw = parse_patients_without_appointments(secondary_csv)
    sales = parse_sales_report(sales_csv)
    finances = reconcile_finances(sales["lines"])
    patients = reconcile_patients(pe["patients"], pw["patients"], sales["lines"], existing_clients=existing_clients)

    display_names = {
        _norm_name(item["patient"].get("displayName"))
        for item in patients["patients"]
        if item["patient"].get("displayName")
    }
    verified = {
        "mainPatientExportRows": pe["rowCount"],
        "secondaryPatientExportRows": pw["rowCount"],
        "distinctDisplayNames": len(display_names),
        "patientsWithEmail": sum(1 for item in patients["patients"] if item["hasEmail"]),
        "patientsWithPhone": sum(1 for item in patients["patients"] if item["hasPhone"]),
        "patientsNeedingContactReview": sum(
            1 for item in patients["patients"] if item["status"] in ("missing_contact", "requires_manual_review")
        ),
        "finances": {
            "invoiceCount": finances["invoiceCount"],
            "billedServiceUnits": finances["billedServiceUnits"],
            "massageServiceUnits": finances["massageServiceUnits"],
            "travelFeeUnits": finances["travelFeeUnits"],
            "durationHours": finances["durationHours"],
            "massageDurationHours": finances["massageDurationHours"],
            "billedTotalCad": finances["billedTotalCad"],
            "massageBilledCad": finances["massageBilledCad"],
            "travelBilledCad": finances["travelBilledCad"],
            "outstandingBalanceCad": finances["outstandingBalanceCad"],
        },
    }
    comparison = compare_preliminary(verified)
    discrepancies = []
    for key, pair in comparison.items():
        if pair["preliminary"] != pair["verified"]:
            discrepancies.append({
                "metric": key,
                "preliminary": pair["preliminary"],
                "verified": pair["verified"],
                "delta": (pair["verified"] - pair["preliminary"]) if isinstance(pair["verified"], (int, float)) else None,
                "detail": {k: v for k, v in pair.items() if k not in ("preliminary", "verified")},
            })

    # Public preview strips raw PII; keep hashed labels and counts.
    public_patients = [
        {
            "status": item["status"],
            "sourceId": item["sourceId"],
            "sourceFiles": item["sourceFiles"],
            "displayNameHash": item["displayNameHash"],
            "hasEmail": item["hasEmail"],
            "hasPhone": item["hasPhone"],
            "fromSalesOnly": item["fromSalesOnly"],
            "existingClientId": item["existingClientId"],
        }
        for item in patients["patients"]
    ]
    public_invoices = [
        {
            "invoiceNumber": inv["invoiceNumber"],
            "sourceId": inv["sourceId"],
            "lineCount": inv["lineCount"],
            "totalCents": inv["totalCents"],
            "balanceCents": inv["balanceCents"],
            "taxCents": inv["taxCents"],
            "paymentMethods": inv["paymentMethods"],
            "paymentConfirmed": inv["paymentConfirmed"],
            "outstanding": inv["outstanding"],
            "verifiedAppointment": False,
            "classification": "historical_billed_service",
            "patientNameHash": inv["patientNameHash"],
            "practitionerName": inv["practitionerName"],
        }
        for inv in finances["invoices"]
    ]

    return {
        "dryRun": True,
        "writesOperationalData": False,
        "canonicalPractitionerId": CANONICAL_PRACTITIONER_ID,
        "summary": {
            **verified,
            "patientClassificationCounts": patients["counts"],
            "salesPatientsMissingFromExports": patients["salesPatientsMissingFromExports"],
            "taxCents": finances["taxCents"],
            "adjustmentCents": finances["adjustmentCents"],
            "paymentMethodCounts": finances["paymentMethodCounts"],
            "serviceCounts": finances["serviceCounts"],
            "nonNabituInvoices": finances["nonNabituInvoices"],
        },
        "preliminaryComparison": comparison,
        "discrepancies": discrepancies,
        "patientPreview": public_patients,
        "invoicePreview": public_invoices,
        "historicalServiceClassification": {
            "verifiedHistoricalAppointment": 0,
            "historicalBilledService": finances["lineCount"],
            "estimatedTreatmentCount": None,
            "note": "Sales lines are historical billed services only. No fabricated appointments.",
        },
        "fieldMappings": {
            "patient_export": {
                "first_name": "firstName", "last_name": "lastName", "email": "email",
                "cell_phone|home_phone|work_phone": "phone", "date_of_birth": "dateOfBirth",
                "address1+city+prov_state+postal_zip_code": "address",
            },
            "patients_without_appointments": {
                "Patient": "displayName", "Patient Email": "email",
                "Mobile Phone|Home Phone": "phone", "Last Appointment Date": "lastAppointmentAt",
            },
            "practitioner_sales_report": {
                "INV-#": "invoiceNumber", "Service": "service", "Duration": "durationMin",
                "Tx Date": "serviceDate", "Patient": "patientName", "Practitioner": "practitionerName",
                "Price/Adj./Tax Amount/Total/Balance": "cents fields", "Payments": "paymentMethod",
            },
        },
        "legacyPayloadReady": {
            "patientRecords": len(to_legacy_records(patients["patients"])),
            "invoiceRecords": len(to_legacy_invoices(finances)),
        },
        "errors": pe["errors"] + pw["errors"] + sales["errors"],
        "approvalRequiredForCheckpointE": [
            "Owner reviews patient classification and contact gaps",
            "Owner accepts financial totals and outstanding balance method",
            "Verified staging database backup",
            "LEGACY_PATIENT_IMPORT_ENABLED only on staging",
            "No production import in Checkpoint E without separate approval",
        ],
        "notes": [
            finances["note"],
            patients["note"],
            "Raw CSV contents are not embedded in this preview.",
        ],
        # Internal full rows for Checkpoint E adapters — not for logging.
        "_internal": {
            "patients": patients["patients"],
            "finances": finances,
            "legacyRecords": to_legacy_records(patients["patients"]),
            "legacyInvoices": to_legacy_invoices(finances),
        },
    }


def public_preview(report):
    """Drop internal PII-bearing structures before API/log responses."""
    return {key: value for key, value in report.items() if key != "_internal"}
