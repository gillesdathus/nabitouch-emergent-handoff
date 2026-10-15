"""Isolated training workspace. Every read and write stays in the training database."""
import os
import uuid
import secrets
from datetime import datetime, timezone, timedelta

import jwt
from fastapi import APIRouter, Body, HTTPException, Request, Response

from auth import ALG, hash_pw, check_pw, _cookie_flags

FORBIDDEN_NAMES = {"nabitouch_prod", "nabitouch"}
PRESETS = {"24h": 1, "3d": 3, "7d": 7, "14d": 14, "30d": 30}
TASKS = {
    "practitioner": ["biography", "availability", "appointment", "soap"],
    "client": ["book", "invoice", "reschedule"],
    "desk": ["book", "checkin", "cash"],
    "owner": ["dashboard", "approve", "report"],
}


def _now():
    return datetime.now(timezone.utc)


def _iso(value=None):
    return (value or _now()).isoformat()


def training_database_name():
    operational = (os.environ.get("DB_NAME") or "").strip()
    if not operational or operational in FORBIDDEN_NAMES or "prod" in operational.lower():
        raise HTTPException(503, "Training is not available for this database")
    if os.environ.get("APP_ENV") == "production" and not os.environ.get("TRAINING_DB_NAME"):
        raise HTTPException(503, "Training is not configured for production")
    name = (os.environ.get("TRAINING_DB_NAME") or f"{operational}_training").strip()
    if name == operational or name in FORBIDDEN_NAMES or "prod" in name.lower():
        raise HTTPException(503, "Training database is not isolated")
    return name


def assert_training_database(database):
    name = getattr(database, "name", "")
    operational = (os.environ.get("DB_NAME") or "").strip()
    if not name or name == operational or name in FORBIDDEN_NAMES or "prod" in name.lower() or not name.endswith("_training"):
        raise HTTPException(503, "Refusing to use a database that is not a training database")
    return database


def _persona(scenario_id):
    return [
        {"id": f"{scenario_id}-avery", "role": "practitioner", "name": "Avery Quinn", "email": f"avery.quinn.{scenario_id[-6:]}@training.nabitouch.test", "subject": f"{scenario_id}-avery", "title": "Training massage therapist"},
        {"id": f"{scenario_id}-jordan", "role": "client", "name": "Jordan Hale", "email": f"jordan.hale.{scenario_id[-6:]}@training.nabitouch.test", "subject": f"{scenario_id}-jordan", "title": "Training client"},
        {"id": f"{scenario_id}-sam", "role": "desk", "name": "Sam Okonkwo", "email": f"sam.okonkwo.{scenario_id[-6:]}@training.nabitouch.test", "subject": f"{scenario_id}-sam", "title": "Training receptionist"},
        {"id": f"{scenario_id}-riley", "role": "owner", "name": "Riley Chen", "email": f"riley.chen.{scenario_id[-6:]}@training.nabitouch.test", "subject": f"{scenario_id}-riley", "title": "Training manager"},
    ]


def seed_documents(scenario_id, expires_at):
    """Fictional records. Nothing here is a patient, a certificate, or a payment."""
    people = _persona(scenario_id)
    avery, jordan, sam, riley = people
    services = [
        {"id": f"{scenario_id}-relax", "slug": "trn-relax", "name": "Training Relaxation", "category": "relaxation", "duration": 60, "prices": {"60": 100}, "published": True, "enabled": True, "img": "", "benefits": ["Practice booking"], "goals": ["Training"], "prep": ["No real preparation"], "training": True, "scenarioId": scenario_id},
        {"id": f"{scenario_id}-therapy", "slug": "trn-therapy", "name": "Training Therapeutic", "category": "therapeutic", "duration": 75, "prices": {"75": 130}, "published": True, "enabled": True, "img": "", "benefits": ["Practice notes"], "goals": ["Training"], "prep": ["No real preparation"], "training": True, "scenarioId": scenario_id},
    ]
    practitioners = [{
        "id": avery["id"], "name": avery["name"], "initials": "AQ", "color": "#0E7490", "bio": "Fictional practitioner for Nabitouch training.",
        "available": True, "bookable": True, "onboardingStatus": "approved", "specialties": ["trn-relax", "trn-therapy"],
        "licenseExpiry": "2099-01-01", "insuranceExpiry": "2099-01-01", "training": True, "scenarioId": scenario_id,
        "publicBio": "TRAINING — NOT VALID",
    }, {
        "id": f"{scenario_id}-noah", "name": "Noah Blake", "initials": "NB", "color": "#155E75", "bio": "Fictional practitioner waiting for training approval.",
        "available": False, "bookable": False, "onboardingStatus": "pending", "specialties": ["trn-relax"],
        "licenseExpiry": "2099-06-01", "insuranceExpiry": "2099-06-01", "training": True, "scenarioId": scenario_id,
        "publicBio": "TRAINING — NOT VALID",
    }]
    clients = [{
        "id": jordan["id"], "firstName": "Jordan", "lastName": "Hale", "email": jordan["email"], "phone": "780-555-0199",
        "addresses": [{"id": "addr-training", "label": "Training home", "line": "100 Training Lane, Edmonton", "clientConfirmed": True, "zoneId": "local-training"}],
        "training": True, "scenarioId": scenario_id,
    }]
    visits = [
        {"id": f"{scenario_id}-visit-open", "ref": "TRN-1001", "clientId": jordan["id"], "practitionerId": avery["id"], "serviceSlug": "trn-relax", "date": _now().date().isoformat(), "time": "10:00", "duration": 60, "status": "confirmed", "paymentStatus": "unpaid", "locationType": "home", "address": {"line": "100 Training Lane, Edmonton"}, "pricing": {"base": 100, "discount": 0, "travel": 0, "tax": 5, "total": 105}, "settle": {"clientPaid": 0, "refunded": 0, "balance": 105, "insuranceConfirmed": 0}, "payments": [], "invoiceBanner": "TRAINING ONLY — NOT A VALID INVOICE", "training": True, "scenarioId": scenario_id},
        {"id": f"{scenario_id}-visit-part", "ref": "TRN-1002", "clientId": jordan["id"], "practitionerId": avery["id"], "serviceSlug": "trn-therapy", "date": _now().date().isoformat(), "time": "13:00", "duration": 75, "status": "completed", "paymentStatus": "partial", "locationType": "home", "address": {"line": "100 Training Lane, Edmonton"}, "pricing": {"base": 130, "discount": 0, "travel": 0, "tax": 6.5, "total": 136.5}, "settle": {"clientPaid": 50, "refunded": 0, "balance": 86.5, "insuranceConfirmed": 0}, "payments": [{"id": "pay-trn-part", "provider": "training-cash", "status": "succeeded", "amount": 50, "training": True}], "invoiceBanner": "TRAINING ONLY — NOT A VALID INVOICE", "training": True, "scenarioId": scenario_id},
        {"id": f"{scenario_id}-visit-paid", "ref": "TRN-1003", "clientId": jordan["id"], "practitionerId": avery["id"], "serviceSlug": "trn-relax", "date": (_now().date()).isoformat(), "time": "16:00", "duration": 60, "status": "closed", "paymentStatus": "paid", "locationType": "home", "address": {"line": "100 Training Lane, Edmonton"}, "pricing": {"base": 100, "discount": 10, "travel": 0, "tax": 4.5, "total": 94.5}, "settle": {"clientPaid": 94.5, "refunded": 0, "balance": 0, "insuranceConfirmed": 0}, "payments": [{"id": "pay-trn-full", "provider": "training-cash", "status": "succeeded", "amount": 94.5, "training": True}], "invoiceBanner": "TRAINING ONLY — NOT A VALID INVOICE", "training": True, "scenarioId": scenario_id},
    ]
    settings = [{"id": "app", "gst": 0.05, "cashEnabled": True, "trainingMode": True, "training": True, "scenarioId": scenario_id, "receptionPerms": {"createBooking": True, "managePayments": True, "viewAddresses": True, "viewHistory": True, "assign": True, "clinical": False}, "scheduling": {"setupMin": 10, "cleanupMin": 10, "travelBufferMin": 15}, "addons": []}]
    promotion = [{"id": f"{scenario_id}-promo", "name": "Training welcome", "code": "TRAINING10", "type": "percent", "value": 10, "enabled": False, "approval": "pending", "eligibility": "referral", "services": "all", "redemptions": 0, "stackable": False, "training": True, "scenarioId": scenario_id}]
    report = [{"id": f"{scenario_id}-report", "practitionerId": avery["id"], "status": "approved", "period": "Training period", "text": "TRAINING — NOT VALID. This report is not payroll or a tax filing.", "training": True, "scenarioId": scenario_id}]
    credential = [{"id": f"{scenario_id}-cred", "practitionerId": avery["id"], "kind": "registration", "identifier": "TRAINING — NOT VALID", "status": "pending", "expiresOn": "2099-01-01", "training": True, "scenarioId": scenario_id}]
    schedule = [{"id": f"{scenario_id}-hours", "practitionerId": avery["id"], "status": "approved", "acceptingBookings": True, "weekly": [{"weekday": 0, "start": "09:00", "end": "17:00"}], "exceptions": [], "training": True, "scenarioId": scenario_id}]
    users = []
    secrets_out = []
    for person in people:
        password = secrets.token_urlsafe(9)
        users.append({"id": person["id"], "email": person["email"], "name": person["name"], "role": person["role"], "subject": person["subject"], "password_hash": hash_pw(password), "training": True, "scenarioId": scenario_id, "title": person["title"]})
        secrets_out.append({"email": person["email"], "role": person["role"], "name": person["name"], "password": password})
    return {
        "collections": {
            "services": services, "practitioners": practitioners, "clients": clients, "appointments": visits,
            "settings": settings, "promotions": promotion, "reports": report, "credentials": credential, "schedules": schedule,
        },
        "users": users,
        "passwords": secrets_out,
        "participants": [{"userId": person["id"], "role": person["role"], "name": person["name"], "email": person["email"]} for person in people],
        "expiresAt": expires_at,
    }


def build_training_router(mongo, require):
    router = APIRouter(prefix="/api/training")

    def database():
        return assert_training_database(mongo[training_database_name()])

    async def scenario_or_404(db, scenario_id):
        row = await db.nt_scenarios.find_one({"id": scenario_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Training scenario not found")
        return row

    def expired(row):
        try:
            return datetime.fromisoformat(row["expiresAt"]) <= _now()
        except (TypeError, ValueError):
            return True

    async def owner(request: Request):
        return await require(request, "owner")

    async def training_user(request: Request, write=False):
        token = request.cookies.get("nt_training")
        if not token:
            raise HTTPException(401, "Training session required")
        try:
            payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[ALG], audience="training")
        except jwt.InvalidTokenError:
            raise HTTPException(401, "Training session required")
        db = database()
        session = await db.nt_sessions.find_one({"sid": payload.get("sid"), "revoked": False}, {"_id": 0})
        scenario = await scenario_or_404(db, payload.get("scenarioId"))
        if not session or session.get("scenarioId") != scenario["id"]:
            raise HTTPException(401, "Training session required")
        if scenario.get("status") != "active" or expired(scenario):
            raise HTTPException(401, "This training scenario has ended")
        if write and scenario.get("status") != "active":
            raise HTTPException(401, "This training scenario has ended")
        user = await db.nt_users.find_one({"id": payload.get("sub"), "scenarioId": scenario["id"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(401, "Training session required")
        user["scenarioId"] = scenario["id"]
        user["sid"] = payload.get("sid")
        return db, scenario, user

    async def mark(db, scenario_id, user_id, task):
        await db.nt_progress.update_one(
            {"scenarioId": scenario_id, "userId": user_id, "task": task},
            {"$set": {"scenarioId": scenario_id, "userId": user_id, "task": task, "at": _iso(), "training": True}},
            upsert=True,
        )

    async def write_seed(db, scenario_id, expires_at):
        seeded = seed_documents(scenario_id, expires_at)
        for name, rows in seeded["collections"].items():
            if rows:
                await db[f"nt_{name}"].insert_many([dict(row) for row in rows])
        await db.nt_users.insert_many([dict(row) for row in seeded["users"]])
        return seeded

    async def purge_scenario(db, scenario_id):
        assert_training_database(db)
        names = await db.list_collection_names()
        for name in names:
            await db[name].delete_many({"scenarioId": scenario_id})
        await db.nt_scenarios.delete_one({"id": scenario_id})

    @router.get("/scenarios")
    async def list_scenarios(request: Request):
        await owner(request)
        db = database()
        await purge_expired(db)
        rows = await db.nt_scenarios.find({}, {"_id": 0}).sort("createdAt", -1).to_list(50)
        return {"scenarios": [_public_scenario(row) for row in rows]}

    @router.post("/scenarios")
    async def create_scenario(request: Request, payload: dict = Body(default={})):
        user = await owner(request)
        days = PRESETS.get(payload.get("preset") or "7d", None)
        if payload.get("days"):
            days = int(payload["days"])
        if not days or days < 1 or days > 90:
            raise HTTPException(400, "Choose a training duration between 1 and 90 days")
        db = database()
        scenario_id = "trn-" + uuid.uuid4().hex[:10]
        expires_at = _iso(_now() + timedelta(days=days))
        seeded = await write_seed(db, scenario_id, expires_at)
        row = {
            "id": scenario_id, "status": "active", "title": "Nabitouch training", "createdAt": _iso(), "expiresAt": expires_at,
            "createdBy": user.get("id"), "participants": seeded["participants"], "mapboxQuota": int(payload.get("mapboxQuota") or 20),
            "mapboxUsed": 0, "training": True, "scenarioId": scenario_id,
        }
        await db.nt_scenarios.insert_one(dict(row))
        await db.nt_audit.insert_one({"id": uuid.uuid4().hex, "scenarioId": scenario_id, "at": _iso(), "actor": user.get("name"), "action": "Training scenario created", "training": True})
        row.pop("_id", None)
        return {"scenario": _public_scenario(row), "temporaryPasswords": seeded["passwords"]}

    @router.post("/scenarios/{scenario_id}/reset")
    async def reset_scenario(scenario_id: str, request: Request):
        user = await owner(request)
        db = database()
        row = await scenario_or_404(db, scenario_id)
        await purge_scenario(db, scenario_id)
        seeded = await write_seed(db, scenario_id, row["expiresAt"])
        saved = {**row, "status": "active", "participants": seeded["participants"], "scenarioId": scenario_id}
        await db.nt_scenarios.insert_one(saved)
        await db.nt_audit.insert_one({"id": uuid.uuid4().hex, "scenarioId": scenario_id, "at": _iso(), "actor": user.get("name"), "action": "Training scenario reset", "training": True})
        return {"scenario": _public_scenario(saved), "temporaryPasswords": seeded["passwords"]}

    @router.post("/scenarios/{scenario_id}/extend")
    async def extend_scenario(scenario_id: str, request: Request, payload: dict = Body(...)):
        user = await owner(request)
        days = int(payload.get("days") or 0)
        if days < 1 or days > 90:
            raise HTTPException(400, "Choose a training duration between 1 and 90 days")
        db = database()
        row = await scenario_or_404(db, scenario_id)
        expires_at = _iso(_now() + timedelta(days=days))
        await db.nt_scenarios.update_one({"id": scenario_id}, {"$set": {"expiresAt": expires_at, "status": "active"}})
        await db.nt_audit.insert_one({"id": uuid.uuid4().hex, "scenarioId": scenario_id, "at": _iso(), "actor": user.get("name"), "action": "Training expiration extended", "training": True})
        row["expiresAt"] = expires_at
        row["status"] = "active"
        return {"scenario": _public_scenario(row)}

    @router.post("/scenarios/{scenario_id}/end")
    async def end_scenario(scenario_id: str, request: Request):
        user = await owner(request)
        db = database()
        await scenario_or_404(db, scenario_id)
        await db.nt_scenarios.update_one({"id": scenario_id}, {"$set": {"status": "ended", "expiresAt": _iso()}})
        await db.nt_sessions.update_many({"scenarioId": scenario_id}, {"$set": {"revoked": True}})
        await db.nt_audit.insert_one({"id": uuid.uuid4().hex, "scenarioId": scenario_id, "at": _iso(), "actor": user.get("name"), "action": "Training scenario ended", "training": True})
        return {"ended": scenario_id}

    @router.delete("/scenarios/{scenario_id}")
    async def delete_scenario(scenario_id: str, request: Request):
        user = await owner(request)
        db = database()
        await scenario_or_404(db, scenario_id)
        await purge_scenario(db, scenario_id)
        await db.nt_audit.insert_one({"id": uuid.uuid4().hex, "scenarioId": scenario_id, "at": _iso(), "actor": user.get("name"), "action": "Training scenario deleted", "training": True})
        return {"deleted": scenario_id}

    @router.post("/scenarios/{scenario_id}/preview")
    async def preview_role(scenario_id: str, request: Request, response: Response, payload: dict = Body(...)):
        user = await owner(request)
        role = payload.get("role")
        if role not in TASKS:
            raise HTTPException(400, "Choose a training role")
        db = database()
        row = await scenario_or_404(db, scenario_id)
        if row.get("status") != "active" or expired(row):
            raise HTTPException(401, "This training scenario has ended")
        trainee = await db.nt_users.find_one({"scenarioId": scenario_id, "role": role}, {"_id": 0, "password_hash": 0})
        if not trainee:
            raise HTTPException(404, "That training role is not in this scenario")
        await _open_training_session(db, response, trainee, row)
        await db.nt_audit.insert_one({"id": uuid.uuid4().hex, "scenarioId": scenario_id, "at": _iso(), "actor": user.get("name"), "action": f"Owner previewed training role {role}", "training": True})
        return {"role": role, "name": trainee["name"], "scenarioId": scenario_id}

    @router.post("/login")
    async def login(response: Response, payload: dict = Body(...)):
        db = database()
        email = str(payload.get("email") or "").lower()
        user = await db.nt_users.find_one({"email": email, "training": True}, {"_id": 0})
        if not user or not check_pw(str(payload.get("password") or ""), user.get("password_hash") or ""):
            raise HTTPException(401, "Invalid email or password")
        row = await scenario_or_404(db, user["scenarioId"])
        if row.get("status") != "active" or expired(row):
            raise HTTPException(401, "This training scenario has ended")
        await _open_training_session(db, response, user, row)
        return {"role": user["role"], "name": user["name"], "training": True}

    @router.post("/logout")
    async def logout(request: Request, response: Response):
        token = request.cookies.get("nt_training")
        if token:
            try:
                payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[ALG], audience="training")
                await database().nt_sessions.update_one({"sid": payload.get("sid")}, {"$set": {"revoked": True}})
            except jwt.InvalidTokenError:
                pass
        _clear_training_cookie(response)
        return {"ok": True}

    @router.get("/me")
    async def me(request: Request):
        _db, scenario, user = await training_user(request)
        progress = await _db.nt_progress.find({"scenarioId": scenario["id"], "userId": user["id"]}, {"_id": 0}).to_list(20)
        return {"user": user, "scenario": _public_scenario(scenario), "tasks": TASKS.get(user["role"], []), "done": [row["task"] for row in progress]}

    @router.get("/state")
    async def state(request: Request):
        db, scenario, user = await training_user(request)
        if user["role"] == "owner":
            await mark(db, scenario["id"], user["id"], "dashboard")
        return await _state(db, scenario, user)

    @router.post("/bookings")
    async def book(request: Request, payload: dict = Body(...)):
        db, scenario, user = await training_user(request, write=True)
        if user["role"] not in ("desk", "owner", "client"):
            raise HTTPException(403, "This training role cannot create a booking")
        appointment = payload.get("appointment") or {}
        client_id = (payload.get("client") or {}).get("id") or (user["subject"] if user["role"] == "client" else None)
        if not client_id or not appointment.get("date") or not appointment.get("time"):
            raise HTTPException(400, "A training booking needs a client, date, and time")
        clash = await db.nt_appointments.find_one({"scenarioId": scenario["id"], "practitionerId": payload.get("practitionerId"), "date": appointment["date"], "time": appointment["time"], "status": {"$nin": ["cancelled", "no_show"]}}, {"_id": 0, "id": 1})
        if clash:
            raise HTTPException(409, "That training time is already booked")
        row = {
            "id": "trn-visit-" + uuid.uuid4().hex[:8], "ref": "TRN-" + uuid.uuid4().hex[:4].upper(), "scenarioId": scenario["id"], "training": True,
            "clientId": client_id, "practitionerId": payload.get("practitionerId"), "serviceSlug": appointment.get("serviceSlug"),
            "date": appointment["date"], "time": appointment["time"], "duration": int(appointment.get("duration") or 60),
            "status": "confirmed", "paymentStatus": "unpaid", "locationType": "home",
            "address": {"line": "100 Training Lane, Edmonton"},
            "pricing": appointment.get("pricing") or {"total": 0}, "settle": {"clientPaid": 0, "refunded": 0, "balance": (appointment.get("pricing") or {}).get("total") or 0, "insuranceConfirmed": 0},
            "payments": [], "invoiceBanner": "TRAINING ONLY — NOT A VALID INVOICE",
        }
        await db.nt_appointments.insert_one(dict(row))
        await db.nt_notifications.insert_one({"id": uuid.uuid4().hex, "scenarioId": scenario["id"], "training": True, "at": _iso(), "text": f"Training booking {row['ref']} saved in the training inbox only."})
        await mark(db, scenario["id"], user["id"], "book")
        row.pop("_id", None)
        return row

    @router.post("/appointments/{appointment_id}/transition")
    async def transition(appointment_id: str, request: Request, payload: dict = Body(...)):
        db, scenario, user = await training_user(request, write=True)
        if user["role"] == "client" and payload.get("to") not in ("cancelled",):
            raise HTTPException(403, "This training role cannot change that status")
        saved = await db.nt_appointments.find_one_and_update(
            {"id": appointment_id, "scenarioId": scenario["id"]},
            {"$set": {"status": payload.get("to"), "checkedIn": payload.get("to") == "arrived"}},
            return_document=True,
        )
        if not saved:
            raise HTTPException(404, "Training appointment not found")
        if payload.get("to") in ("arrived", "in_session"):
            await mark(db, scenario["id"], user["id"], "checkin")
        if user["role"] == "practitioner":
            await mark(db, scenario["id"], user["id"], "appointment")
        if payload.get("to") == "cancelled" and user["role"] == "client":
            await mark(db, scenario["id"], user["id"], "reschedule")
        saved.pop("_id", None)
        return saved

    @router.post("/appointments/{appointment_id}/reschedule")
    async def reschedule(appointment_id: str, request: Request, payload: dict = Body(...)):
        db, scenario, user = await training_user(request, write=True)
        saved = await db.nt_appointments.find_one_and_update(
            {"id": appointment_id, "scenarioId": scenario["id"]},
            {"$set": {"date": payload.get("date"), "time": payload.get("time"), "status": "confirmed"}},
            return_document=True,
        )
        if not saved:
            raise HTTPException(404, "Training appointment not found")
        await mark(db, scenario["id"], user["id"], "reschedule")
        saved.pop("_id", None)
        return saved

    @router.post("/appointments/{appointment_id}/cash")
    async def cash(appointment_id: str, request: Request, payload: dict = Body(default={})):
        db, scenario, user = await training_user(request, write=True)
        if user["role"] not in ("desk", "owner"):
            raise HTTPException(403, "This training role cannot record a payment")
        visit = await db.nt_appointments.find_one({"id": appointment_id, "scenarioId": scenario["id"]}, {"_id": 0})
        if not visit:
            raise HTTPException(404, "Training appointment not found")
        amount = float(payload.get("amount") or (visit.get("settle") or {}).get("balance") or 0)
        payment = {"id": "pay-" + uuid.uuid4().hex[:8], "provider": "training-cash", "status": "succeeded", "amount": amount, "training": True, "note": "TRAINING ONLY — NOT A VALID PAYMENT"}
        paid = float((visit.get("settle") or {}).get("clientPaid") or 0) + amount
        total = float((visit.get("pricing") or {}).get("total") or 0)
        balance = max(0, round(total - paid, 2))
        await db.nt_appointments.update_one({"id": appointment_id, "scenarioId": scenario["id"]}, {"$push": {"payments": payment}, "$set": {"settle.clientPaid": paid, "settle.balance": balance, "paymentStatus": "paid" if balance == 0 else "partial", "invoiceBanner": "TRAINING ONLY — NOT A VALID INVOICE"}})
        await mark(db, scenario["id"], user["id"], "cash")
        return {"payment": payment, "balance": balance, "training": True}

    @router.put("/soap/{appointment_id}")
    async def soap(appointment_id: str, request: Request, payload: dict = Body(...)):
        db, scenario, user = await training_user(request, write=True)
        if user["role"] != "practitioner":
            raise HTTPException(403, "Only the training practitioner can write this note")
        row = {"id": f"soap-{appointment_id}", "appointmentId": appointment_id, "practitionerId": user["subject"], "scenarioId": scenario["id"], "training": True, "status": "signed", "note": "TRAINING — NOT VALID", "sections": payload.get("sections") or {}, "signedAt": _iso()}
        await db.nt_soap.replace_one({"id": row["id"]}, row, upsert=True)
        await mark(db, scenario["id"], user["id"], "soap")
        return row

    @router.put("/profile")
    async def profile(request: Request, payload: dict = Body(...)):
        db, scenario, user = await training_user(request, write=True)
        if user["role"] != "practitioner":
            raise HTTPException(403, "Only the training practitioner can edit this profile")
        bio = str(payload.get("bio") or "")[:500]
        await db.nt_practitioners.update_one({"id": user["subject"], "scenarioId": scenario["id"]}, {"$set": {"bio": bio}})
        await mark(db, scenario["id"], user["id"], "biography")
        return {"bio": bio, "training": True}

    @router.post("/availability")
    async def availability(request: Request, payload: dict = Body(...)):
        db, scenario, user = await training_user(request, write=True)
        if user["role"] not in ("practitioner", "owner"):
            raise HTTPException(403, "This training role cannot change availability")
        person_id = user["subject"] if user["role"] == "practitioner" else payload.get("practitionerId")
        await db.nt_schedules.update_one({"practitionerId": person_id, "scenarioId": scenario["id"]}, {"$set": {"weekly": payload.get("weekly") or [], "exceptions": payload.get("exceptions") or []}})
        await mark(db, scenario["id"], user["id"], "availability")
        return {"saved": True, "training": True}

    @router.post("/reports")
    async def report(request: Request):
        db, scenario, user = await training_user(request, write=True)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the training manager can generate a report")
        row = {"id": "rpt-" + uuid.uuid4().hex[:8], "scenarioId": scenario["id"], "training": True, "status": "approved", "period": "Training period", "text": "TRAINING — NOT VALID. This is not a payroll or tax filing.", "createdAt": _iso()}
        await db.nt_reports.insert_one(dict(row))
        await mark(db, scenario["id"], user["id"], "report")
        row.pop("_id", None)
        return row

    @router.post("/practitioners/{person_id}/approve")
    async def approve(person_id: str, request: Request):
        db, scenario, user = await training_user(request, write=True)
        if user["role"] != "owner":
            raise HTTPException(403, "A training practitioner cannot approve credentials")
        saved = await db.nt_practitioners.find_one_and_update({"id": person_id, "scenarioId": scenario["id"]}, {"$set": {"onboardingStatus": "approved", "bookable": True}}, return_document=True)
        if not saved:
            raise HTTPException(404, "Training practitioner not found")
        await db.nt_credentials.update_many({"practitionerId": person_id, "scenarioId": scenario["id"]}, {"$set": {"status": "verified", "identifier": "TRAINING — NOT VALID"}})
        await mark(db, scenario["id"], user["id"], "approve")
        saved.pop("_id", None)
        return saved

    @router.get("/notifications")
    async def notifications(request: Request):
        db, scenario, _user = await training_user(request)
        rows = await db.nt_notifications.find({"scenarioId": scenario["id"]}, {"_id": 0}).sort("at", -1).to_list(30)
        return {"notifications": rows, "training": True}

    @router.post("/progress/{task}")
    async def progress(task: str, request: Request):
        db, scenario, user = await training_user(request, write=True)
        if task not in TASKS.get(user["role"], []):
            raise HTTPException(400, "That task is not part of this training role")
        await mark(db, scenario["id"], user["id"], task)
        return {"task": task, "done": True}

    @router.get("/route")
    async def route(request: Request):
        db, scenario, user = await training_user(request)
        visits = await db.nt_appointments.find({"scenarioId": scenario["id"], "practitionerId": user["subject"] if user["role"] == "practitioner" else {"$exists": True}}, {"_id": 0, "address": 1, "time": 1, "ref": 1}).to_list(20)
        configured = bool(os.environ.get("MAPBOX_TOKEN"))
        detail = "Training route estimate. No operational practitioner is dispatched and no live location is used."
        if not configured:
            detail = "Address search needs a Mapbox token. Add MAPBOX_TOKEN to this environment. Sample addresses are not offered. " + detail
        elif scenario.get("mapboxUsed", 0) >= scenario.get("mapboxQuota", 0):
            raise HTTPException(429, "The training map quota is used")
        return {"training": True, "label": "Training route estimate", "configured": configured, "detail": detail, "stops": visits}

    return router


def _public_scenario(row):
    remaining = None
    try:
        remaining = max(0, int((datetime.fromisoformat(row["expiresAt"]) - _now()).total_seconds()))
    except (TypeError, ValueError, KeyError):
        remaining = 0
    return {
        "id": row.get("id"), "title": row.get("title"), "status": row.get("status"), "createdAt": row.get("createdAt"),
        "expiresAt": row.get("expiresAt"), "remainingSeconds": remaining, "participants": row.get("participants") or [],
        "mapboxQuota": row.get("mapboxQuota"), "mapboxUsed": row.get("mapboxUsed") or 0,
    }


async def _open_training_session(db, response, user, scenario):
    sid = secrets.token_urlsafe(24)
    expires = datetime.fromisoformat(scenario["expiresAt"])
    await db.nt_sessions.insert_one({"sid": sid, "userId": user["id"], "scenarioId": scenario["id"], "revoked": False, "createdAt": _iso(), "training": True})
    token = jwt.encode({"sub": user["id"], "aud": "training", "sid": sid, "scenarioId": scenario["id"], "role": user["role"], "exp": expires}, os.environ["JWT_SECRET"], algorithm=ALG)
    secure, samesite = _cookie_flags()
    response.set_cookie("nt_training", token, httponly=True, secure=secure, samesite=samesite, path="/", max_age=int((expires - _now()).total_seconds()))


def _clear_training_cookie(response):
    secure, samesite = _cookie_flags()
    response.delete_cookie("nt_training", path="/", secure=secure, samesite=samesite)


async def _state(db, scenario, user):
    role = user["role"]
    out = {}
    for name in ("services", "practitioners", "clients", "appointments", "soap", "promotions", "settings", "reports", "credentials", "schedules", "audit"):
        out[name] = await db[f"nt_{name}"].find({"scenarioId": scenario["id"]}, {"_id": 0}).to_list(200)
    if role == "client":
        out["appointments"] = [row for row in out["appointments"] if row.get("clientId") == user["subject"]]
        out["clients"] = [row for row in out["clients"] if row.get("id") == user["subject"]]
        out["soap"] = []
        out["reports"] = []
        out["credentials"] = []
    elif role == "practitioner":
        out["appointments"] = [row for row in out["appointments"] if row.get("practitionerId") == user["subject"]]
        ids = {row.get("clientId") for row in out["appointments"]}
        out["clients"] = [row for row in out["clients"] if row.get("id") in ids]
        out["soap"] = [row for row in out["soap"] if row.get("practitionerId") == user["subject"]]
        out["reports"] = [row for row in out["reports"] if row.get("practitionerId") == user["subject"] or row.get("status") == "approved"]
    elif role == "desk":
        out["soap"] = []
        out["reports"] = []
        out["credentials"] = []
    out["mailOps"] = {"attention": []}
    out["zones"] = []
    out["giftcards"] = []
    out["templates"] = []
    out["plans"] = []
    out["training"] = True
    out["scenarioId"] = scenario["id"]
    return out


async def purge_expired(db):
    assert_training_database(db)
    now = _iso()
    rows = await db.nt_scenarios.find({"$or": [{"expiresAt": {"$lte": now}}, {"status": "ended"}]}, {"_id": 0, "id": 1, "status": 1, "expiresAt": 1}).to_list(200)
    for row in rows:
        if row.get("status") == "active":
            await db.nt_scenarios.update_one({"id": row["id"]}, {"$set": {"status": "expired"}})
            await db.nt_sessions.update_many({"scenarioId": row["id"]}, {"$set": {"revoked": True}})
            await db.nt_audit.insert_one({"id": uuid.uuid4().hex, "scenarioId": row["id"], "at": _iso(), "actor": "training-cleanup", "action": "Training scenario expired", "training": True})
    return {"seen": len(rows)}
