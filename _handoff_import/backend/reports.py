"""Financial period snapshots. An approved report keeps the numbers it was approved with."""
import uuid
from calendar import monthrange
from datetime import date


def period_bounds(year, month, half):
    """Half 1 is the 1st through the 15th. Half 2 runs through the real last day."""
    year, month, half = int(year), int(month), int(half)
    if month < 1 or month > 12:
        raise ValueError("Choose a month from 1 to 12")
    if half not in (1, 2):
        raise ValueError("Choose the first or second half of the month")
    last = monthrange(year, month)[1]
    start_day, end_day = (1, 15) if half == 1 else (16, last)
    start = date(year, month, start_day).isoformat()
    end = date(year, month, end_day).isoformat()
    return start, end


def _money(value):
    return round(float(value or 0), 2)


def snapshot_lines(appointments, start, end, practitioner_id=""):
    """Cash collections come from recorded payments. A claim is not treated as paid."""
    rows = []
    for appointment in appointments or []:
        if appointment.get("status") in ("cancelled", "no_show"):
            continue
        day = str(appointment.get("date") or "")
        if day < start or day > end:
            continue
        if practitioner_id and appointment.get("practitionerId") != practitioner_id:
            continue
        pricing = appointment.get("pricing") or {}
        settle = appointment.get("settle") or {}
        rows.append({
            "id": appointment.get("id"),
            "ref": appointment.get("ref"),
            "date": day,
            "serviceSlug": appointment.get("serviceSlug"),
            "practitionerId": appointment.get("practitionerId"),
            "base": _money(pricing.get("base")),
            "discount": _money(pricing.get("discount")),
            "travel": _money(pricing.get("travel")),
            "tax": _money(pricing.get("tax")),
            "invoiced": _money(pricing.get("total")),
            "collected": _money((settle.get("clientPaid") or 0) - (settle.get("refunded") or 0)),
            "insuranceReceived": _money(settle.get("insuranceConfirmed")),
            "insurancePending": _money(settle.get("insurancePending")),
            "outstanding": _money(settle.get("balance")),
            "payNow": appointment.get("payNow") or "",
        })
    def total(key):
        return round(sum(row[key] for row in rows), 2)
    return {
        "basis": "Appointment date. Invoiced amounts and recorded collections are listed separately.",
        "start": start,
        "end": end,
        "count": len(rows),
        "rows": rows,
        "grossTreatment": total("base"),
        "discounts": total("discount"),
        "travel": total("travel"),
        "gst": total("tax"),
        "invoiced": total("invoiced"),
        "collected": total("collected"),
        "insuranceReceived": total("insuranceReceived"),
        "insurancePending": total("insurancePending"),
        "outstanding": total("outstanding"),
    }


def _escape(text):
    return str(text).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")[:120]


def text_pdf(title, lines):
    commands = ["BT", "/F1 12 Tf", "48 750 Td", "16 TL", f"({_escape(title)}) Tj"]
    for line in lines:
        commands.append(f"T* ({_escape(line)}) Tj")
    commands.append("ET")
    stream = ("\n".join(commands) + "\n").encode("latin-1", "replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return bytes(out)


def new_report(snapshot, practitioner_id, actor):
    return {
        "id": f"rpt-{uuid.uuid4().hex[:10]}",
        "practitionerId": practitioner_id or "",
        "status": "draft",
        "snapshot": snapshot,
        "createdBy": actor,
        "approvedBy": "",
        "publishedAt": "",
    }
