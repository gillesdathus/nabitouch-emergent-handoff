#!/usr/bin/env python3
"""Post-deploy smoke for WELCOME20 on standalone manual invoices.

Runs on the Hostinger API host with Mongo + JWT_SECRET loaded from /etc/nabitouch-next.env.
Creates ephemeral probe clients, verifies eligibility/ineligibility, discount math, tax,
idempotent create, and claim release on discard. Deletes created drafts/clients afterward.
Does not modify real patient records.
"""
from __future__ import annotations

import json
import os
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from urllib import error, parse, request

import jwt
from pymongo import MongoClient

ALG = "HS256"
API = os.environ.get("VERIFY_API", "http://127.0.0.1:8011/api")
ENV_FILE = os.environ.get("NABITOUCH_ENV", "/etc/nabitouch-next.env")
PROBE_ENV = os.environ.get("PROBE_ENV_PATH", "/etc/nabitouch-next.probe.env")


def load_env(path: str) -> dict:
    out = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def mint(secret: str, uid: str, kind: str, sid: str, jti: str | None = None) -> str:
    exp = datetime.now(timezone.utc) + (
        timedelta(minutes=15) if kind == "access" else timedelta(days=1)
    )
    payload = {"sub": uid, "type": kind, "sid": sid, "exp": exp}
    if jti:
        payload["jti"] = jti
    return jwt.encode(payload, secret, algorithm=ALG)


def api(method: str, path: str, cookies: dict, csrf: str, body: dict | None = None):
    data = None
    headers = {"Accept": "application/json", "X-CSRF-Token": csrf}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = request.Request(API + path, data=data, headers=headers, method=method)
    cookie = "; ".join(f"{k}={v}" for k, v in cookies.items())
    req.add_header("Cookie", cookie)
    try:
        with request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            payload = json.loads(raw) if raw else {"detail": raw}
        except json.JSONDecodeError:
            payload = {"detail": raw}
        return exc.code, payload


def main() -> int:
    env = load_env(ENV_FILE)
    probe = load_env(PROBE_ENV)
    secret = env.get("JWT_SECRET") or os.environ.get("JWT_SECRET")
    mongo_url = env.get("MONGO_URL") or os.environ["MONGO_URL"]
    db_name = env.get("DB_NAME") or os.environ["DB_NAME"]
    if not secret:
        print("missing JWT_SECRET", file=sys.stderr)
        return 2
    owner_id = probe.get("OWNER_PROBE_USER_ID")
    if not owner_id:
        print("missing OWNER_PROBE_USER_ID", file=sys.stderr)
        return 2

    db = MongoClient(mongo_url)[db_name]
    owner = db.nt_users.find_one({"id": owner_id, "opsProbe": True, "active": True})
    if not owner:
        print("probe owner missing", file=sys.stderr)
        return 2

    sid, csrf, jti = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)
    db.nt_sessions.insert_one({
        "sid": sid, "userId": owner_id, "csrf": csrf, "mfaAt": now.isoformat(),
        "createdAt": now.isoformat(), "expiresAt": (now + timedelta(hours=1)).isoformat(),
        "opsProbe": True,
    })
    access = mint(secret, owner_id, "access", sid, jti)
    cookies = {"nt_access": access, "nt_csrf": csrf}

    stamp = uuid.uuid4().hex[:8]
    eligible_id = f"ops-w20-el-{stamp}"
    ineligible_id = f"ops-w20-in-{stamp}"
    created_invoices = []
    try:
        swedish = db.nt_services.find_one({"slug": "swedish"}, {"_id": 0, "prices": 1, "slug": 1, "name": 1})
        if not swedish or not (swedish.get("prices") or {}).get("60"):
            print("swedish 60m service missing", file=sys.stderr)
            return 2
        unit = float(swedish["prices"]["60"])

        db.nt_clients.insert_one({
            "id": eligible_id, "firstName": "Ops", "lastName": f"WelcomeEl{stamp}",
            "email": f"ops.welcome.el.{stamp}@example.invalid", "phone": f"780555{stamp[:4]}",
            "createdAt": now.isoformat(), "opsProbe": True,
        })
        db.nt_clients.insert_one({
            "id": ineligible_id, "firstName": "Ops", "lastName": f"WelcomeIn{stamp}",
            "email": f"ops.welcome.in.{stamp}@example.invalid", "phone": f"780556{stamp[:4]}",
            "createdAt": now.isoformat(), "opsProbe": True,
        })
        db.nt_appointments.insert_one({
            "id": f"ops-w20-appt-{stamp}", "clientId": ineligible_id, "status": "completed",
            "serviceSlug": "swedish", "duration": 60, "date": now.date().isoformat(),
            "opsProbe": True,
        })

        q = parse.urlencode({"clientId": eligible_id, "serviceSlug": "swedish"})
        status, elig = api("GET", f"/invoices/welcome-eligibility?{q}", cookies, csrf)
        assert status == 200 and elig.get("eligible") is True, elig
        assert float(elig.get("percentage") or 0) == 20, elig
        assert float(elig.get("maxDiscount") or 0) == 40, elig

        q2 = parse.urlencode({"clientId": ineligible_id, "serviceSlug": "swedish"})
        status, inelig = api("GET", f"/invoices/welcome-eligibility?{q2}", cookies, csrf)
        assert status == 200 and inelig.get("eligible") is False, inelig

        idem = f"ops-w20-{stamp}"
        body = {
            "clientId": eligible_id,
            "serviceDate": now.date().isoformat(),
            "lines": [{"serviceSlug": "swedish", "duration": 60, "quantity": 1}],
            "discountMode": "welcome20",
            "chargeGst": True,
            "idempotencyKey": idem,
        }
        status, inv = api("POST", "/invoices", cookies, csrf, body)
        assert status == 200, inv
        created_invoices.append(inv["id"])
        base_cents = int(round(unit * 100))
        discount = min(int((Decimal(base_cents) * Decimal("20") / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)), 4000)
        net = base_cents - discount
        tax = int((Decimal(net) * Decimal("0.05")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        assert inv.get("discountCents") == discount, inv
        assert inv.get("taxCents") == tax, inv
        assert inv.get("totalCents") == net + tax, inv
        assert inv.get("promotionCode") == "WELCOME20", inv

        status, again = api("POST", "/invoices", cookies, csrf, body)
        assert status == 200 and again.get("id") == inv["id"], again

        status, blocked = api("POST", "/invoices", cookies, csrf, {
            **body, "idempotencyKey": f"{idem}-dup",
        })
        assert status == 409, blocked

        status, discarded = api("DELETE", f"/invoices/{inv['id']}", cookies, csrf)
        assert status == 200 and discarded.get("discarded") is True, discarded
        created_invoices.remove(inv["id"])

        status, elig2 = api("GET", f"/invoices/welcome-eligibility?{q}", cookies, csrf)
        assert status == 200 and elig2.get("eligible") is True, elig2

        print(json.dumps({
            "ok": True,
            "eligibleClient": eligible_id,
            "ineligibleClient": ineligible_id,
            "discountCents": discount,
            "taxCents": tax,
            "totalCents": net + tax,
            "idempotent": True,
            "claimReleasedOnDiscard": True,
        }))
        return 0
    finally:
        for iid in created_invoices:
            db.nt_ledger.delete_many({"invoiceId": iid})
            db.nt_invoices.delete_one({"id": iid})
            db.nt_welcome_claims.delete_many({"token": iid})
        db.nt_appointments.delete_many({"opsProbe": True, "clientId": {"$in": [eligible_id, ineligible_id]}})
        db.nt_clients.delete_many({"id": {"$in": [eligible_id, ineligible_id]}, "opsProbe": True})
        db.nt_welcome_claims.delete_many({"key": {"$in": [f"client:{eligible_id}", f"client:{ineligible_id}"]}})
        db.nt_sessions.delete_one({"sid": sid})


if __name__ == "__main__":
    sys.exit(main())
