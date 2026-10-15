"""Historical CSV and XLSX import. Imported payments are not new revenue and do not charge a card."""
import hashlib
import io
import re
import uuid

import pandas as pd
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pymongo.errors import DuplicateKeyError

from billing import PROVIDERS, now_iso
from fieldcrypto import seal

CENTS = re.compile(r"^\d+$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FIELDS = (
    "source_id", "first_name", "last_name", "email", "service_date", "service", "practitioner",
    "invoice_total_cents", "payment_cents", "payment_date", "claim_provider",
    "claimed_cents", "approved_cents", "received_cents", "soap_note",
)


def _cell(row, name):
    value = row.get(name)
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _cents(text, label, errors, row_number):
    if text == "":
        return 0
    if not CENTS.match(text):
        errors.append({"row": row_number, "message": f"{label} must be whole cents"})
        return 0
    return int(text)


def parse_upload(filename, payload):
    name = (filename or "").lower()
    try:
        if name.endswith(".csv"):
            frame = pd.read_csv(io.BytesIO(payload), dtype=str).fillna("")
        elif name.endswith(".xlsx"):
            frame = pd.read_excel(io.BytesIO(payload), dtype=str).fillna("")
        else:
            raise HTTPException(400, "Upload a CSV or XLSX file")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "The file could not be read")
    missing = [field for field in ("source_id", "invoice_total_cents") if field not in frame.columns]
    if missing:
        raise HTTPException(400, "Missing columns: " + ", ".join(missing))
    records = []
    errors = []
    seen = set()
    for offset, (_index, raw) in enumerate(frame.reset_index(drop=True).iterrows()):
        row_number = offset + 2
        row = {field: _cell(raw, field) for field in FIELDS}
        if not row["source_id"]:
            errors.append({"row": row_number, "message": "source_id is required"})
            continue
        if row["source_id"] in seen:
            errors.append({"row": row_number, "message": "Duplicate source_id in this file"})
        seen.add(row["source_id"])
        total = _cents(row["invoice_total_cents"], "invoice_total_cents", errors, row_number)
        payment = _cents(row["payment_cents"], "payment_cents", errors, row_number)
        claimed = _cents(row["claimed_cents"], "claimed_cents", errors, row_number)
        approved = _cents(row["approved_cents"], "approved_cents", errors, row_number)
        received = _cents(row["received_cents"], "received_cents", errors, row_number)
        if row["service_date"] and not DATE.match(row["service_date"]):
            errors.append({"row": row_number, "message": "service_date must be YYYY-MM-DD"})
        if row["payment_date"] and not DATE.match(row["payment_date"]):
            errors.append({"row": row_number, "message": "payment_date must be YYYY-MM-DD"})
        if row["email"] and "@" not in row["email"]:
            errors.append({"row": row_number, "message": "email is not valid"})
        if row["claim_provider"] and row["claim_provider"] not in PROVIDERS:
            errors.append({"row": row_number, "message": "claim_provider is not configured"})
        if payment > total or received > total or approved > max(claimed, total):
            errors.append({"row": row_number, "message": "Amounts cannot exceed the invoice"})
        if received > approved and approved:
            errors.append({"row": row_number, "message": "Insurance received cannot exceed the approved amount"})
        records.append({
            "row": row_number, "sourceId": row["source_id"][:80], "firstName": row["first_name"][:80],
            "lastName": row["last_name"][:80], "email": row["email"].lower()[:120],
            "serviceDate": row["service_date"], "service": row["service"][:120] or "Historical service",
            "practitioner": row["practitioner"][:120], "totalCents": total, "paymentCents": payment,
            "paymentDate": row["payment_date"] or row["service_date"], "provider": row["claim_provider"],
            "claimedCents": claimed, "approvedCents": approved, "receivedCents": received,
            "soap": row["soap_note"][:4000],
        })
    return records, errors


async def ensure_imports(db):
    await db.nt_import_batches.create_index("id", unique=True)
    await db.nt_import_batches.create_index("sha256", unique=True)
    await db.nt_import_rows.create_index("sourceId", unique=True)
    await db.nt_import_rows.create_index("batchId")


async def clear_imports(db):
    await db.nt_import_batches.delete_many({})
    await db.nt_import_rows.delete_many({})


def build_import_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api")

    async def owner(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can import historical records")
        return user

    async def report_for(records, errors):
        existing = []
        for record in records:
            if await db.nt_import_rows.find_one({"sourceId": record["sourceId"]}, {"_id": 0, "sourceId": 1}):
                existing.append(record["sourceId"])
        return {
            "rows": len(records),
            "errors": errors,
            "duplicates": existing,
            "ready": not errors,
            "sourceCompatibility": "unverified",
            "expectedColumns": list(FIELDS),
            "note": "No authentic Noterro export was available. This map is the Nabitouch column list only.",
        }

    @r.post("/billing/imports/preview")
    async def preview(request: Request, upload: UploadFile = File(...)):
        from config import legacy_patient_import_enabled
        if not legacy_patient_import_enabled():
            raise HTTPException(403, "Patient import is turned off")
        await owner(request)
        payload = await upload.read()
        if len(payload) > 8 * 1024 * 1024:
            raise HTTPException(413, "File is too large")
        records, errors = parse_upload(upload.filename, payload)
        return await report_for(records, errors)

    async def client_for(record):
        if record["email"]:
            found = await coll("clients").find_one({"email": record["email"]}, {"_id": 0, "id": 1})
            if found:
                return found["id"]
        client_id = "c-" + uuid.uuid4().hex[:8]
        await coll("clients").insert_one({
            "id": client_id, "firstName": record["firstName"] or "Historical", "lastName": record["lastName"],
            "email": record["email"], "phone": "", "addresses": [], "insurance": [], "favorites": [],
            "preferredPractitioners": [], "loyaltyPoints": 0, "onlineBookings": 0, "hasProfile": False,
            "createdAt": now_iso(), "origin": "historical",
        })
        return client_id

    async def write_invoice(record, client_id, batch_id):
        received = record["paymentCents"] + record["receivedCents"]
        total = record["totalCents"]
        state = "paid" if received >= total and total else "partially_paid" if received else "issued"
        invoice_id = "inv-" + uuid.uuid4().hex[:12]
        expected = max(0, record["approvedCents"] - record["receivedCents"]) if record["approvedCents"] else 0
        invoice = {
            "id": invoice_id, "number": "NT-HIST-" + record["sourceId"][:24], "appointmentId": None,
            "clientId": client_id, "clientName": (record["firstName"] + " " + record["lastName"]).strip(),
            "practitionerId": None, "practitionerName": record["practitioner"],
            "service": record["service"], "duration": None, "serviceDate": record["serviceDate"],
            "issueDate": record["serviceDate"] or now_iso()[:10], "dueDate": record["serviceDate"] or now_iso()[:10],
            "state": state, "version": 1, "origin": "historical", "countsAsRevenue": False,
            "lines": [{"description": record["service"], "quantity": 1, "netCents": total, "taxCode": "historical"}],
            "taxCents": 0, "totalCents": total, "expectedInsuranceCents": min(expected, max(0, total - received)),
            "sourceId": record["sourceId"], "batchId": batch_id, "currency": "CAD",
        }
        await db.nt_invoices.insert_one(dict(invoice))
        if record["paymentCents"]:
            await db.nt_ledger.insert_one({
                "id": "led-" + uuid.uuid4().hex[:12], "invoiceId": invoice_id, "type": "client_payment",
                "method": "historical", "amountCents": record["paymentCents"], "reference": record["sourceId"],
                "idempotencyKey": "hist-pay-" + record["sourceId"], "actorName": "Import", "at": record["paymentDate"] or now_iso(),
                "countsAsRevenue": False,
            })
        if record["provider"]:
            claim_id = "clm-" + uuid.uuid4().hex[:12]
            status = "approved" if record["approvedCents"] and record["approvedCents"] >= record["claimedCents"] else "partially_approved" if record["approvedCents"] else "submitted"
            await db.nt_claims.insert_one({
                "id": claim_id, "invoiceId": invoice_id, "provider": record["provider"], "reference": record["sourceId"],
                "status": status, "claimedCents": record["claimedCents"], "approvedCents": record["approvedCents"],
                "notes": "", "createdAt": now_iso(), "by": "Import", "history": [{"status": status, "at": now_iso()}],
            })
            if record["receivedCents"]:
                await db.nt_ledger.insert_one({
                    "id": "led-" + uuid.uuid4().hex[:12], "invoiceId": invoice_id, "type": "insurance_receipt",
                    "method": "insurance", "amountCents": record["receivedCents"], "reference": "hist-" + record["sourceId"],
                    "claimId": claim_id, "idempotencyKey": "hist-ins-" + record["sourceId"], "actorName": "Import",
                    "at": record["paymentDate"] or now_iso(), "countsAsRevenue": False,
                })
        await db.nt_import_rows.insert_one({
            "id": "imp-" + uuid.uuid4().hex[:12], "batchId": batch_id, "sourceId": record["sourceId"],
            "invoiceId": invoice_id, "clientId": client_id, "soap": seal(record["soap"]), "signed": False,
            "provenance": "upload",
        })
        return invoice_id

    @r.post("/billing/imports")
    async def execute(request: Request, upload: UploadFile = File(...)):
        from config import legacy_patient_import_enabled
        if not legacy_patient_import_enabled():
            raise HTTPException(403, "Patient import is turned off")
        user = await owner(request)
        payload = await upload.read()
        if len(payload) > 8 * 1024 * 1024:
            raise HTTPException(413, "File is too large")
        digest = hashlib.sha256(payload).hexdigest()
        prior = await db.nt_import_batches.find_one({"sha256": digest}, {"_id": 0})
        if prior and prior.get("status") in ("completed", "rolled_back"):
            return {**prior.get("report", {}), "batchId": prior["id"], "repeated": True}
        records, errors = parse_upload(upload.filename, payload)
        preview = await report_for(records, errors)
        if errors:
            raise HTTPException(422, preview)
        batch_id = "batch-" + uuid.uuid4().hex[:12]
        created = []
        for record in records:
            if record["sourceId"] in preview["duplicates"]:
                continue
            client_id = await client_for(record)
            created.append(await write_invoice(record, client_id, batch_id))
        result = {**preview, "created": len(created), "batchId": batch_id, "repeated": False, "countsAsRevenue": False}
        try:
            await db.nt_import_batches.insert_one({
                "id": batch_id, "sha256": digest, "filename": (upload.filename or "import")[:120],
                "status": "completed", "at": now_iso(), "by": user.get("name"), "report": result,
            })
        except DuplicateKeyError:
            stored = await db.nt_import_batches.find_one({"sha256": digest}, {"_id": 0})
            return {**stored.get("report", {}), "batchId": stored["id"], "repeated": True}
        await add_audit(user.get("name") or "owner", f"Historical import {batch_id}", None)
        return result

    @r.get("/billing/imports/{batch_id}")
    async def batch_status(batch_id: str, request: Request):
        await owner(request)
        batch = await db.nt_import_batches.find_one({"id": batch_id}, {"_id": 0, "sha256": 0})
        if not batch:
            raise HTTPException(404, "Import batch not found")
        rows = await db.nt_import_rows.find({"batchId": batch_id}, {"_id": 0, "soap": 0}).to_list(500)
        for row in rows:
            stored = await db.nt_import_rows.find_one({"id": row["id"]}, {"_id": 0, "soap": 1, "signed": 1})
            row["soapRecorded"] = bool(stored and stored.get("soap"))
            row["signed"] = False
        return {"id": batch["id"], "status": batch.get("status"), "report": batch.get("report"), "rows": rows}

    @r.post("/billing/imports/{batch_id}/rollback")
    async def rollback(batch_id: str, request: Request):
        user = await owner(request)
        batch = await db.nt_import_batches.find_one({"id": batch_id})
        if not batch:
            raise HTTPException(404, "Import batch not found")
        if batch.get("status") == "rolled_back":
            return {"batchId": batch_id, "reversed": 0, "repeated": True}
        rows = await db.nt_import_rows.find({"batchId": batch_id}, {"_id": 0}).to_list(500)
        reversed_count = 0
        for row in rows:
            lines = await db.nt_ledger.find({"invoiceId": row["invoiceId"], "type": {"$in": ["client_payment", "insurance_receipt"]}}, {"_id": 0}).to_list(20)
            for line in lines:
                key = "hist-reverse-" + line["id"]
                if await db.nt_ledger.find_one({"idempotencyKey": key}):
                    continue
                await db.nt_ledger.insert_one({
                    "id": "led-" + uuid.uuid4().hex[:12], "invoiceId": row["invoiceId"], "type": "reversal",
                    "method": line.get("method"), "amountCents": line["amountCents"], "reference": line["id"],
                    "idempotencyKey": key, "actorName": user.get("name") or "owner", "at": now_iso(),
                    "countsAsRevenue": False,
                })
                reversed_count += 1
            await db.nt_invoices.update_one({"id": row["invoiceId"]}, {"$set": {"state": "issued", "expectedInsuranceCents": 0}, "$inc": {"version": 1}})
        await db.nt_import_batches.update_one({"id": batch_id}, {"$set": {"status": "rolled_back"}})
        await add_audit(user.get("name") or "owner", f"Historical import rollback {batch_id}", None)
        return {"batchId": batch_id, "reversed": reversed_count, "repeated": False}

    return r
