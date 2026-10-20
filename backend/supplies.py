"""Simple Team Connect supplies — no warehouse ERP.

Balances: main, practitioner, reserved/in_transit, dirty.
Handoffs use recipient confirmation with partial receipt support.
"""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from rbac import has_role, require_roles

UNITS = ("each", "set", "bottle", "pack")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _clean(text, limit=120):
    value = re.sub(r"\s+", " ", str(text or "").strip())
    if not value or len(value) > limit:
        raise HTTPException(400, "Invalid name")
    return value


async def ensure_supplies(db):
    await db.nt_supply_items.create_index("id", unique=True)
    await db.nt_supply_items.create_index("sku", unique=True, sparse=True)
    await db.nt_supply_balances.create_index([("itemId", 1), ("bucket", 1), ("ownerId", 1)], unique=True)
    await db.nt_supply_requests.create_index("id", unique=True)
    await db.nt_supply_requests.create_index("idempotencyKey", unique=True, sparse=True)
    await db.nt_supply_ledger.create_index("id", unique=True)


def build_supplies_router(db, coll, user_from, add_audit):
    router = APIRouter(prefix="/api/team/supplies", tags=["team-connect-supplies"])

    async def viewer(request: Request):
        user = await user_from(request)
        require_roles(user, "owner", "manager", "desk", "practitioner")
        return user

    def public_item(item, balances=None):
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "sku": item.get("sku"),
            "unit": item.get("unit") or "each",
            "balances": balances or [],
        }

    async def balances_for(item_id):
        rows = await db.nt_supply_balances.find({"itemId": item_id}, {"_id": 0}).to_list(50)
        return rows

    @router.get("/items")
    async def list_items(request: Request, q: str = ""):
        await viewer(request)
        query = {"archived": {"$ne": True}}
        rows = await db.nt_supply_items.find(query, {"_id": 0}).sort("name", 1).to_list(200)
        needle = (q or "").strip().lower()
        out = []
        for item in rows:
            if needle and needle not in f"{item.get('name')} {item.get('sku')}".lower():
                continue
            bals = await balances_for(item["id"])
            out.append(public_item(item, bals))
        return {"items": out}

    @router.post("/items")
    async def create_item(request: Request):
        user = await viewer(request)
        if not has_role(user, "owner", "manager"):
            raise HTTPException(403, "Only Owner or Manager may adjust catalogue stock items")
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid item")
        name = _clean(body.get("name"))
        unit = body.get("unit") if body.get("unit") in UNITS else "each"
        sku = re.sub(r"[^A-Za-z0-9\-]", "", str(body.get("sku") or ""))[:32] or None
        qty = int(body.get("mainQty") or 0)
        if qty < 0:
            raise HTTPException(400, "Quantity cannot be negative")
        stamp = _now()
        item = {
            "id": "sup-" + uuid.uuid4().hex[:12],
            "name": name,
            "sku": sku,
            "unit": unit,
            "createdAt": stamp,
            "archived": False,
        }
        await db.nt_supply_items.insert_one(dict(item))
        await db.nt_supply_balances.insert_one({
            "itemId": item["id"], "bucket": "main", "ownerId": "main", "qty": qty, "updatedAt": stamp,
        })
        if qty:
            await db.nt_supply_ledger.insert_one({
                "id": "slg-" + uuid.uuid4().hex[:12],
                "itemId": item["id"],
                "delta": qty,
                "bucket": "main",
                "reason": "initial",
                "actorId": user.get("id"),
                "at": stamp,
            })
        await add_audit(user.get("name") or "Owner", f"Supply item created · {name}", item["id"])
        return {"item": public_item(item, await balances_for(item["id"]))}

    @router.post("/requests")
    async def create_request(request: Request):
        user = await viewer(request)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid supply request")
        item_id = str(body.get("itemId") or "")
        item = await db.nt_supply_items.find_one({"id": item_id, "archived": {"$ne": True}}, {"_id": 0})
        if not item:
            raise HTTPException(404, "Supply item not found")
        try:
            qty = int(body.get("qty"))
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "Quantity must be a whole number") from exc
        if qty < 1 or qty > 500:
            raise HTTPException(400, "Choose a practical quantity")
        key = str(body.get("idempotencyKey") or "").strip()[:80] or None
        if key:
            key = f"{user.get('id')}:{key}"
            existing = await db.nt_supply_requests.find_one({"idempotencyKey": key}, {"_id": 0})
            if existing:
                return {"request": existing, "duplicate": True}
        fulfillment = body.get("fulfillment") or "manager_delivery"
        if fulfillment not in ("manager_delivery", "practitioner_pickup", "meeting_point", "appointment_area", "next_client"):
            raise HTTPException(400, "Choose a fulfillment option")
        stamp = _now()
        doc = {
            "id": "srq-" + uuid.uuid4().hex[:12],
            "idempotencyKey": key,
            "itemId": item_id,
            "itemName": item.get("name"),
            "unit": item.get("unit"),
            "qtyRequested": qty,
            "qtyPrepared": 0,
            "qtyReceived": 0,
            "qtyOutstanding": qty,
            "status": "new",
            "fulfillment": fulfillment,
            "handoffNote": (str(body.get("handoffNote") or "").strip())[:200],
            "appointmentId": body.get("appointmentId") or None,
            "requesterId": user.get("id"),
            "requesterName": user.get("name") or "Staff",
            "createdAt": stamp,
            "updatedAt": stamp,
            "confirmedAt": None,
        }
        if not key:
            doc.pop("idempotencyKey", None)
        try:
            await db.nt_supply_requests.insert_one(dict(doc))
        except DuplicateKeyError:
            existing = await db.nt_supply_requests.find_one({"idempotencyKey": key}, {"_id": 0}) if key else None
            if existing:
                return {"request": existing, "duplicate": True}
            raise
        doc.pop("_id", None)
        return {"request": doc, "duplicate": False}

    @router.get("/requests")
    async def list_requests(request: Request):
        user = await viewer(request)
        query = {} if has_role(user, "owner", "manager", "desk") else {"requesterId": user.get("id")}
        rows = await db.nt_supply_requests.find(query, {"_id": 0}).sort("createdAt", -1).to_list(100)
        return {"requests": rows}

    @router.post("/requests/{request_id}/prepare")
    async def prepare(request_id: str, request: Request):
        user = await viewer(request)
        if not has_role(user, "owner", "manager"):
            raise HTTPException(403, "Only Owner or Manager may prepare stock")
        body = await request.json()
        row = await db.nt_supply_requests.find_one({"id": request_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Supply request not found")
        try:
            prepared = int(body.get("qtyPrepared"))
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "Prepared quantity must be a whole number") from exc
        if prepared < 1 or prepared > row.get("qtyRequested", 0):
            raise HTTPException(400, "Prepared quantity must be within the request")
        # Move main → reserved transactionally-ish with balance checks.
        bal = await db.nt_supply_balances.find_one({"itemId": row["itemId"], "bucket": "main", "ownerId": "main"})
        available = int((bal or {}).get("qty") or 0)
        if available < prepared:
            raise HTTPException(409, "Not enough main stock")
        stamp = _now()
        await db.nt_supply_balances.update_one(
            {"itemId": row["itemId"], "bucket": "main", "ownerId": "main"},
            {"$inc": {"qty": -prepared}, "$set": {"updatedAt": stamp}},
        )
        await db.nt_supply_balances.update_one(
            {"itemId": row["itemId"], "bucket": "reserved", "ownerId": request_id},
            {"$inc": {"qty": prepared}, "$set": {"updatedAt": stamp}},
            upsert=True,
        )
        await db.nt_supply_requests.update_one(
            {"id": request_id},
            {"$set": {"qtyPrepared": prepared, "status": "prepared", "updatedAt": stamp, "fulfillment": body.get("fulfillment") or row.get("fulfillment")}},
        )
        await db.nt_supply_ledger.insert_one({
            "id": "slg-" + uuid.uuid4().hex[:12], "itemId": row["itemId"], "delta": -prepared,
            "bucket": "main", "reason": "reserve", "requestId": request_id, "actorId": user.get("id"), "at": stamp,
        })
        refreshed = await db.nt_supply_requests.find_one({"id": request_id}, {"_id": 0})
        return {"request": refreshed}

    @router.post("/requests/{request_id}/confirm")
    async def confirm_receipt(request_id: str, request: Request):
        user = await viewer(request)
        body = await request.json()
        row = await db.nt_supply_requests.find_one({"id": request_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Supply request not found")
        if row.get("requesterId") != user.get("id") and not has_role(user, "owner", "manager"):
            raise HTTPException(403, "Only the recipient confirms receipt")
        if row.get("status") == "received":
            return {"request": row, "duplicate": True}
        try:
            received = int(body.get("qtyReceived"))
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "Received quantity must be a whole number") from exc
        prepared = int(row.get("qtyPrepared") or 0)
        if prepared < 1:
            raise HTTPException(409, "Stock has not been prepared yet")
        if received < 0 or received > prepared:
            raise HTTPException(400, "Received quantity must be within what was prepared")
        outstanding = prepared - received
        stamp = _now()
        # reserved → practitioner stock for received; remainder returns to main
        await db.nt_supply_balances.update_one(
            {"itemId": row["itemId"], "bucket": "reserved", "ownerId": request_id},
            {"$inc": {"qty": -prepared}, "$set": {"updatedAt": stamp}},
        )
        if received:
            owner = row.get("requesterId")
            await db.nt_supply_balances.update_one(
                {"itemId": row["itemId"], "bucket": "practitioner", "ownerId": owner},
                {"$inc": {"qty": received}, "$set": {"updatedAt": stamp}},
                upsert=True,
            )
        if outstanding:
            await db.nt_supply_balances.update_one(
                {"itemId": row["itemId"], "bucket": "main", "ownerId": "main"},
                {"$inc": {"qty": outstanding}, "$set": {"updatedAt": stamp}},
            )
        await db.nt_supply_requests.update_one(
            {"id": request_id, "status": {"$ne": "received"}},
            {"$set": {
                "qtyReceived": received,
                "qtyOutstanding": int(row.get("qtyRequested") or 0) - received,
                "status": "received" if outstanding == 0 and received >= int(row.get("qtyRequested") or 0) else "partial",
                "confirmedAt": stamp,
                "updatedAt": stamp,
            }},
        )
        refreshed = await db.nt_supply_requests.find_one({"id": request_id}, {"_id": 0})
        await add_audit(user.get("name") or "Staff", f"Supply receipt · {row.get('itemName')} {received}", request_id)
        return {"request": refreshed, "duplicate": False}

    return router
