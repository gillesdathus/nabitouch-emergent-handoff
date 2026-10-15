"""Throwaway sample data for the Emergent preview. Every record carries synthetic=True and is replaced on each run.

Run: cd /app/backend && python ../scripts/seed_sample.py
"""
import asyncio
import os
import random
import secrets
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from auth import hash_pw  # noqa: E402
from billing import lines_from_pricing, project  # noqa: E402
from seed import build_seed, demo_schedule  # noqa: E402

random.seed(42)
PHOTOS = {
    "p-maya": "https://images.unsplash.com/photo-1687293233752-ec42de2050db?crop=entropy&cs=srgb&fm=jpg&q=80&w=900",
    "p-liam": "https://images.unsplash.com/photo-1746813628081-0c8c1611aace?crop=entropy&cs=srgb&fm=jpg&q=80&w=900",
    "p-priya": "https://images.unsplash.com/photo-1756699197173-5ef672a423fa?crop=entropy&cs=srgb&fm=jpg&q=80&w=900",
    "p-jordan": "https://images.unsplash.com/photo-1578412004271-7e243181f657?crop=entropy&cs=srgb&fm=jpg&q=80&w=900",
}
DESIGNATION = {"p-maya": "Registered Massage Therapist", "p-liam": "Sports & Deep Tissue RMT", "p-priya": "Prenatal & Relaxation RMT", "p-jordan": "Senior Massage Therapist"}
SYN = {"synthetic": True}
TODAY = datetime.now(timezone.utc).date()


def iso_at(day, hhmm="12:00"):
    return f"{day}T{hhmm}:00-06:00"


def pid_name(pros, pid):
    return next((p["name"] for p in pros if p["id"] == pid), "")


async def purge(db):
    for name in ("nt_clients", "nt_appointments", "nt_practitioners", "nt_plans", "nt_invoices", "nt_ledger", "nt_claims", "nt_giftcards",
                 "nt_gc_ledger", "nt_gc_products", "nt_messages", "nt_trip_notices", "nt_consents", "nt_schedules", "nt_users", "nt_pay_statements"):
        await db[name].delete_many(SYN)


def history(clients, services, pros, n=120):
    svc = {s["slug"]: s for s in services}
    zfee = {"z-central": 0, "z-inner": 15, "z-outer": 30, None: 0}
    rows = []
    for i in range(n):
        c = random.choice(clients)
        slug = random.choice(list(svc))
        dur = random.choice([d for d in svc[slug]["prices"] if d in ("30", "60", "90")] or ["60"])
        day = (TODAY - timedelta(days=random.randint(2, 170))).isoformat()
        pid = random.choice(pros)["id"]
        promo = random.random() < 0.15
        base = float(svc[slug]["prices"][dur])
        disc = round(min(base * 0.2, 40), 2) if promo else 0
        travel = zfee[(c["addresses"][0] or {}).get("zoneId")]
        tax = round((base - disc + travel) * 0.05, 2)
        roll = random.random()
        status = "cancelled" if roll < 0.05 else "no_show" if roll < 0.08 else "closed"
        rows.append({"id": f"a-h{i:03d}", "ref": f"NT-{900 + i}", "clientId": c["id"], "serviceSlug": slug, "duration": int(dur), "date": day,
                     "time": random.choice(["09:00", "10:30", "13:00", "15:30", "17:00", "18:30"]), "practitionerId": pid, "status": status,
                     "locationType": random.choice(["home", "home", "office", "hotel"]), "address": {**c["addresses"][0], "notes": ""},
                     "events": [{"status": "requested", "at": iso_at(day, "08:00"), "actor": "seed"}, {"status": status, "at": iso_at(day, "19:00"), "actor": "seed"}],
                     "timestamps": {}, "pricing": {"base": base, "addons": 0, "addonList": [], "discount": disc, "promoId": "promo-welcome" if promo else None,
                                                   "travel": travel, "tax": tax, "total": round(base - disc + travel + tax, 2)},
                     "paymentMethod": "insurance" if c.get("insurance") and random.random() < 0.6 else "self", "paymentStatus": "paid",
                     "insuranceId": (c.get("insurance") or [{}])[0].get("id"), "preferences": {"goals": ["Relaxation"], "pressure": "Medium", "focus": [], "notes": ""},
                     "soapStatus": "signed" if status == "closed" else "none", "timer": {"pausedMs": 0}, "source": "online", "checkedIn": False, "feedback": None, **SYN})
    return rows


async def invoice_for(db, appt, client, pros, services, counter):
    rows, _net, tax, total = lines_from_pricing(appt["pricing"])
    service = next((s for s in services if s["slug"] == appt["serviceSlug"]), {})
    issued = iso_at(appt["date"], "19:30")
    due = (date.fromisoformat(appt["date"]) + timedelta(days=14)).isoformat()
    inv = {"id": "inv-s" + uuid.uuid4().hex[:10], "number": f"NT-INV-{counter:05d}", "appointmentId": appt["id"], "clientId": appt["clientId"],
           "practitionerId": appt["practitionerId"], "clientName": f"{client['firstName']} {client['lastName']}", "practitionerName": pid_name(pros, appt["practitionerId"]),
           "service": service.get("name") or appt["serviceSlug"], "duration": appt["duration"], "serviceDate": appt["date"], "issueDate": issued, "dueDate": due,
           "currency": "CAD", "state": "issued", "version": 1, "origin": "appointment", "countsAsRevenue": True, "lines": rows, "taxCents": tax, "totalCents": total,
           "expectedInsuranceCents": 0, "createdAt": issued, **SYN}
    ledger, claims = [], []

    def line(kind, amount, method, at, **kw):
        ledger.append({"id": "led-s" + uuid.uuid4().hex[:10], "invoiceId": inv["id"], "type": kind, "method": method, "amountCents": int(amount), "at": at,
                       "idempotencyKey": "seed-" + uuid.uuid4().hex, "actorName": "Sample data", **kw, **SYN})

    line("issue", 0, None, issued)
    paid_at = iso_at((date.fromisoformat(appt["date"]) + timedelta(days=random.randint(0, 6))).isoformat(), "20:00")
    recent = (TODAY - date.fromisoformat(appt["date"])).days < 25
    if appt["paymentMethod"] == "insurance" and client.get("insurance"):
        claimed = round(total * 0.8)
        claim = {"id": "clm-s" + uuid.uuid4().hex[:10], "invoiceId": inv["id"], "provider": client["insurance"][0]["insurer"], "reference": f"CLM-{random.randint(10000, 99999)}",
                 "claimedCents": claimed, "approvedCents": 0, "status": "submitted", "history": [{"status": "submitted", "at": issued}], "notes": "", **SYN}
        if recent and random.random() < 0.6:
            claim["approvedCents"] = claimed if random.random() < 0.5 else 0
            claim["status"] = "approved" if claim["approvedCents"] else "submitted"
            inv["expectedInsuranceCents"] = claimed
        else:
            claim.update(approvedCents=claimed, status="paid")
            line("insurance_receipt", claimed, "insurance", paid_at, claimId=claim["id"], reference=claim["reference"])
            if random.random() < 0.85:
                line("client_payment", total - claimed, random.choice(["cash", "etransfer", "stripe"]), paid_at, reference="RCPT-" + secrets.token_hex(3).upper())
        claims.append(claim)
    else:
        roll = random.random()
        if not (recent and roll < 0.35):
            if roll < 0.08:
                line("client_payment", round(total / 2), "etransfer", paid_at, reference="RCPT-" + secrets.token_hex(3).upper())
            else:
                line("client_payment", total, random.choice(["cash", "etransfer", "stripe", "stripe"]), paid_at, reference="RCPT-" + secrets.token_hex(3).upper())
                if random.random() < 0.04:
                    line("refund", round(total * 0.25), "stripe", paid_at, reference="Goodwill refund")
    received, balance, state, _ = project(inv, ledger)
    inv.update(state=state, receivedCents=received, balanceCents=balance)
    return inv, ledger, claims


async def giftcards(db, invoices):
    products = [
        {"id": "gcp-lagoon", "name": "Lagoon", "description": "Our signature calm", "design": "lagoon", "amountsCents": [5000, 10000, 15000], "active": True, "order": 1},
        {"id": "gcp-tide", "name": "Deep Tide", "description": "For long sessions", "design": "tide", "amountsCents": [12000, 18000, 25000], "active": True, "order": 2},
        {"id": "gcp-meadow", "name": "Meadow", "description": "A fresh-start gift", "design": "meadow", "amountsCents": [7500, 10000], "active": True, "order": 3},
    ]
    for p in products:
        await db.nt_gc_products.insert_one({**p, **SYN, "createdAt": datetime.now(timezone.utc).isoformat()})
    specs = [("c-sarah", "Sarah Thompson", "Emma Thompson", 10000, 10000, "active", "lagoon"), (None, "Walk-in", "Sarah Thompson", 15000, 6000, "active", "tide"),
             (None, "Corporate order", "David Okoro", 7500, 0, "redeemed", "meadow"), ("c-aisha", "Aisha Rahman", "Mom", 12000, 0, "pending_payment", "tide"),
             (None, "Holiday event", "Noah Martin", 5000, 5000, "active", "coral"), (None, "Walk-in", "Elena Petrova", 10000, 0, "voided", "lagoon")]
    for i, (buyer, bname, recipient, amount, balance, status, design) in enumerate(specs):
        cid = f"gc-s{i}"
        at = (datetime.now(timezone.utc) - timedelta(days=60 - i * 9)).isoformat()
        code = f"NABI-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
        await db.nt_giftcards.insert_one({"id": cid, "idempotencyKey": f"seed-{cid}", "code": code, "status": status, "origin": "purchase" if buyer else "paid", "design": design,
                                          "productName": design.title(), "amountCents": amount, "balanceCents": balance, "version": 1, "purchaserId": buyer, "purchaserName": bname,
                                          "recipientName": recipient, "recipientEmail": "", "message": "Enjoy a moment of calm.", "createdAt": at,
                                          "activatedAt": at if status != "pending_payment" else None, "delivery": {"channel": "email", "status": "not_sent"}, **SYN})
        if status != "pending_payment":
            await db.nt_gc_ledger.insert_one({"id": f"gct-s{i}a", "cardId": cid, "type": "issue", "amountCents": amount, "status": "completed", "method": "cash", "reference": "Sample sale",
                                              "idempotencyKey": f"seed-{cid}-issue", "at": at, "actorName": "Sample data", **SYN})
        used = amount - balance if status in ("active", "redeemed") else 0
        if used:
            await db.nt_gc_ledger.insert_one({"id": f"gct-s{i}b", "cardId": cid, "type": "redemption", "amountCents": used, "status": "completed", "reference": invoices[i]["id"],
                                              "idempotencyKey": f"seed-{cid}-redeem", "at": at, "actorName": "Sample data", "balanceAfterCents": balance, **SYN})
        if status == "voided":
            await db.nt_gc_ledger.insert_one({"id": f"gct-s{i}c", "cardId": cid, "type": "void", "amountCents": amount, "status": "completed", "reference": "Duplicate sale",
                                              "idempotencyKey": f"seed-{cid}-void", "at": at, "actorName": "Sample data", **SYN})


async def conversations(db, appts):
    live = [a for a in appts if a["status"] in ("en_route", "assigned", "in_session")][:3]
    now = datetime.now(timezone.utc)
    for n, a in enumerate(live):
        script = [("practitioner", "Practitioner", "Hi! Looking forward to our session today."), ("client", "Client", "Thank you! Please use the side entrance."),
                  ("practitioner", "Practitioner", "I'm on my way.")]
        for k, (role, label, body) in enumerate(script):
            stamp = (now - timedelta(minutes=40 - k * 12 - n)).isoformat()
            await db.nt_messages.insert_one({"id": f"msg-s{n}{k}", "idempotencyKey": f"seed-msg-{n}-{k}", "appointmentId": a["id"], "clientId": a["clientId"], "practitionerId": a["practitionerId"],
                                             "authorId": None, "authorRole": role, "authorLabel": label, "body": body, "presetId": None, "channel": "in_app", "kind": "chat",
                                             "createdAt": stamp, "deliveredAt": stamp, "readBy": {role: stamp}, "sms": False, "email": False, **SYN})
        if a["status"] == "en_route":
            stamp = (now - timedelta(minutes=10)).isoformat()
            await db.nt_trip_notices.insert_one({"id": f"ntc-s{n}", "dedupeKey": f"seed-ntc-{n}", "appointmentId": a["id"], "clientId": a["clientId"], "practitionerId": a["practitionerId"],
                                                 "event": "en_route", "body": "Your practitioner has started the trip.", "channel": "in_app", "chat": False, "sms": False, "email": False,
                                                 "delayMin": None, "at": stamp, **SYN})


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    if os.environ.get("APP_ENV") == "production":
        raise SystemExit("Refusing to seed sample data in production")
    await purge(db)
    data = build_seed()
    services = await db.nt_services.find({}, {"_id": 0}).to_list(50) or data["services"]
    pros = [{**p, "photo": PHOTOS.get(p["id"]), "designation": DESIGNATION.get(p["id"]), "profileVisibility": "published", "onboardingStatus": "approved",
             "available": True, "bookable": True, "isOwner": False, **SYN} for p in data["practitioners"]]
    for p in pros:
        await db.nt_practitioners.insert_one(dict(p))
        await db.nt_schedules.insert_one({**demo_schedule(p["id"]), **SYN})
    clients = [{**c, **SYN} for c in data["clients"]]
    for c in clients:
        await db.nt_clients.insert_one(dict(c))
    appts = [{**a, **SYN} for a in data["appointments"]] + history(clients, services, pros)
    for a in appts:
        await db.nt_appointments.insert_one(dict(a))
    for plan in data.get("plans") or []:
        await db.nt_plans.insert_one({**plan, **SYN})
    by_client = {c["id"]: c for c in clients}
    counter = 9000
    invoices = []
    for a in sorted(appts, key=lambda x: x["date"]):
        if a["status"] not in ("closed", "completed", "processing"):
            continue
        counter += 1
        inv, ledger, claims = await invoice_for(db, a, by_client[a["clientId"]], pros, services, counter)
        await db.nt_invoices.insert_one(inv)
        if ledger:
            await db.nt_ledger.insert_many(ledger)
        if claims:
            await db.nt_claims.insert_many(claims)
        invoices.append(inv)
    await giftcards(db, invoices)
    await conversations(db, appts)
    for c in clients:
        await db.nt_consents.insert_one({"id": f"cns-{c['id']}", "clientId": c["id"], "kind": "treatment_consent", "purpose": "Massage treatment", "version": "2026.1",
                                         "at": datetime.now(timezone.utc).isoformat(), "withdrawnAt": None, "status": "active", **SYN})
    password = "Sample-" + secrets.token_urlsafe(9)
    accounts = [("sarah.demo@example.com", "Sarah Thompson", "client", "c-sarah"), ("maya.demo@example.com", "Maya Chen", "practitioner", "p-maya")]
    for email, name, role, subject in accounts:
        await db.nt_users.insert_one({"id": str(uuid.uuid4()), "email": email, "password_hash": hash_pw(password), "name": name, "role": role, "subject": subject,
                                      "demo": False, "createdAt": datetime.now(timezone.utc).isoformat(), **SYN})
    await db.nt_counters.update_one({"id": "invoice"}, {"$max": {"n": counter}}, upsert=True)
    print(f"Seeded {len(pros)} practitioners, {len(clients)} clients, {len(appts)} visits, {len(invoices)} invoices.")
    print(f"Sample client: sarah.demo@example.com / {password}")
    print(f"Sample practitioner: maya.demo@example.com / {password}")


asyncio.run(main())
