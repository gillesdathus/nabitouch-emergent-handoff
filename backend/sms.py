"""Operational SMS through Twilio Programmable Messaging (Messaging Service + API key).

Hard gates: SMS_ENABLED=false by default, explicit smsConsent per client, fixed server templates,
a unique key per text, and SMS_TEST_RECIPIENT redirection while testing. Webhooks verify X-Twilio-Signature."""
import base64
import hashlib
import hmac
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request, Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from config import _flag
from fieldcrypto import open_text, seal

log = logging.getLogger(__name__)
TZ = ZoneInfo("America/Edmonton")
DISABLED = "disabled"
STOP_WORDS = {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ARRET", "ARRÊT"}
START_WORDS = {"START", "UNSTOP", "YES"}
HELP_WORDS = {"HELP", "INFO", "AIDE"}
FOOTER = " Reply STOP to opt out."
TEMPLATES = {
    "reminder_24h": "Nabitouch: reminder, your visit {ref} is tomorrow at {time}. Details in the app.",
    "reminder_2h": "Nabitouch: your visit {ref} starts at {time} today. Please have the space ready.",
    "on_the_way": "Nabitouch: your practitioner is on the way for visit {ref}. Track the trip in the app.",
    "running_late": "Nabitouch: your practitioner is running about {minutes} min late for visit {ref}. Sorry for the wait.",
    "booking_confirmed": "Nabitouch: visit {ref} is confirmed for {date} at {time}. Manage it in the app.",
    "booking_changed": "Nabitouch: visit {ref} is now {date} at {time}. Manage it in the app.",
}
HELP_REPLY = "Nabitouch visit texts. Manage visits and messages in the Nabitouch app or call us. Reply STOP to opt out."
AUTO_REPLY = "Nabitouch: this number does not read replies. Please message your practitioner in the Nabitouch app."
STOP_REPLY = "Nabitouch: you will no longer receive texts. Reply START to opt back in."
START_REPLY = "Nabitouch: visit texts are back on. Reply STOP to opt out."


def normalize_phone(raw):
    """Return E.164 for a Canadian or NANP number, or None when it cannot be used."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01":
        return None
    return "+1" + digits


def mask(number):
    return f"+1•••••{number[-4:]}" if number else ""


def consent_allows(purpose, client):
    """Operational texts need explicit smsConsent. Marketing also needs the offer opt-in."""
    if not client:
        return False
    if purpose == "marketing":
        return bool(client.get("marketingConsent")) and bool(client.get("smsConsent"))
    if purpose == "operational":
        return bool(client.get("smsConsent"))
    return False


def _creds():
    keys = ("TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_MESSAGING_SERVICE_SID")
    vals = {k: (os.environ.get(k) or "").strip() for k in keys}
    ok = vals["TWILIO_ACCOUNT_SID"].startswith("AC") and vals["TWILIO_API_KEY_SID"].startswith("SK") and vals["TWILIO_API_KEY_SECRET"] and vals["TWILIO_MESSAGING_SERVICE_SID"].startswith("MG")
    return vals if ok else None


def provider_name():
    return "twilio" if _creds() else DISABLED


def sending_enabled():
    return _flag("SMS_ENABLED", False) and bool(_creds())


def test_recipient():
    return normalize_phone(os.environ.get("SMS_TEST_RECIPIENT"))


def readiness():
    return {"channel": "sms", "provider": provider_name(), "status": "enabled" if sending_enabled() else "disabled", "sending": sending_enabled(),
            "flag": _flag("SMS_ENABLED", False), "credentials": bool(_creds()), "webhookSecret": bool((os.environ.get("TWILIO_AUTH_TOKEN") or "").strip()),
            "testRecipient": mask(test_recipient()) if test_recipient() else None, "country": "CA", "kinds": list(TEMPLATES),
            "consent": "Texts go only to clients with smsConsent. STOP/START/HELP replies are honoured."}


def signature_valid(url, params, header, token):
    """Twilio: base64(HMAC-SHA1(token, url + sorted key+value pairs))."""
    if not token or not header:
        return False
    data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    digest = base64.b64encode(hmac.new(token.encode(), data.encode(), hashlib.sha1).digest()).decode()
    return hmac.compare_digest(digest, header)


def _public_url(request):
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}{request.url.path}" + (f"?{request.url.query}" if request.url.query else "")


async def ensure_sms(db):
    await db.nt_sms_outbox.create_index("id", unique=True)
    await db.nt_sms_outbox.create_index("dedupeKey", unique=True)
    await db.nt_sms_outbox.create_index("sid", sparse=True)
    await db.nt_sms_outbox.create_index([("status", 1), ("at", 1)])
    await db.nt_sms_optouts.create_index("phoneHash", unique=True)
    await db.nt_sms_inbound.create_index("sid", unique=True)


def phone_hash(number):
    return hashlib.sha256(number.encode()).hexdigest()


def _local(appt):
    try:
        start = datetime.fromisoformat(f"{appt['date']}T{appt['time']}").replace(tzinfo=TZ)
    except (KeyError, ValueError):
        return "", ""
    return start.strftime("%a %b %-d"), start.strftime("%-I:%M %p")


async def queue_sms(db, coll, kind, appt, dedupe, **fields):
    """One text per (kind, dedupe). Held while SMS is off; never sent without consent and a valid number."""
    client = await coll("clients").find_one({"id": appt.get("clientId")}, {"_id": 0}) if appt.get("clientId") else None
    number = normalize_phone((client or {}).get("phone"))
    if not number or not consent_allows("operational", client):
        return None
    if await db.nt_sms_optouts.find_one({"phoneHash": phone_hash(number)}):
        return None
    date_s, time_s = _local(appt)
    body = TEMPLATES[kind].format(ref=appt.get("ref") or "", date=date_s, time=time_s, minutes=fields.get("minutes") or "")[:300] + FOOTER
    row = {"id": "sms-" + uuid.uuid4().hex[:12], "dedupeKey": f"{kind}:{dedupe}", "kind": kind, "appointmentId": appt.get("id"), "clientId": client["id"],
           "toSealed": seal(number), "toMasked": mask(number), "toHash": phone_hash(number), "body": body, "status": "queued" if sending_enabled() else "held", "attempts": 0, "at": datetime.now(timezone.utc).isoformat()}
    try:
        await db.nt_sms_outbox.insert_one(dict(row))
    except DuplicateKeyError:
        return None
    if row["status"] == "queued":
        await send_row(db, row)
    return row["id"]


async def send_row(db, row, base_url=None):
    creds = _creds()
    claimed = await db.nt_sms_outbox.find_one_and_update({"id": row["id"], "status": {"$in": ["queued", "retry"]}}, {"$set": {"status": "sending", "claimedAt": datetime.now(timezone.utc).isoformat()},
                                                                                                               "$inc": {"attempts": 1}}, return_document=ReturnDocument.AFTER)
    if not claimed or not creds or not sending_enabled():
        return
    to = test_recipient() or open_text(claimed["toSealed"])
    form = {"To": to, "MessagingServiceSid": creds["TWILIO_MESSAGING_SERVICE_SID"], "Body": claimed["body"]}
    base = (base_url or os.environ.get("APP_URL") or "").rstrip("/")
    if base.startswith("https://") and (os.environ.get("TWILIO_AUTH_TOKEN") or "").strip():
        form["StatusCallback"] = f"{base}/api/sms/status"
    import httpx
    url = f"https://api.twilio.com/2010-04-01/Accounts/{creds['TWILIO_ACCOUNT_SID']}/Messages.json"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, auth=(creds["TWILIO_API_KEY_SID"], creds["TWILIO_API_KEY_SECRET"]), data=form)
        data = resp.json() if resp.content else {}
    except Exception:
        await db.nt_sms_outbox.update_one({"id": claimed["id"]}, {"$set": {"status": "retry" if claimed["attempts"] < 3 else "failed", "error": "network"}})
        return
    if resp.status_code < 300 and data.get("sid"):
        await db.nt_sms_outbox.update_one({"id": claimed["id"]}, {"$set": {"status": "sent", "sid": data["sid"], "sentAt": datetime.now(timezone.utc).isoformat(), "redirected": bool(test_recipient()), "error": None}})
    else:
        code = str(data.get("code") or resp.status_code)
        final = resp.status_code in (400, 401, 403, 404) or claimed["attempts"] >= 3
        await db.nt_sms_outbox.update_one({"id": claimed["id"]}, {"$set": {"status": "failed" if final else "retry", "error": code}})
        log.warning("Twilio rejected a text: %s", code)


async def due_reminders(db, coll):
    """24 h and 2 h reminders, evaluated every 15 minutes. The dedupe key makes each one send at most once."""
    now = datetime.now(TZ)
    days = [(now + timedelta(days=d)).date().isoformat() for d in (0, 1, 2)]
    appts = await coll("appointments").find({"date": {"$in": days}, "status": {"$in": ["confirmed", "assigned", "preparing"]}}, {"_id": 0}).to_list(2000)
    queued = 0
    for a in appts:
        try:
            start = datetime.fromisoformat(f"{a['date']}T{a['time']}").replace(tzinfo=TZ)
        except (KeyError, ValueError):
            continue
        ahead = start - now
        if timedelta(hours=22) < ahead <= timedelta(hours=24):
            queued += bool(await queue_sms(db, coll, "reminder_24h", a, f"{a['id']}:{a['date']}:{a['time']}"))
        elif timedelta(minutes=60) < ahead <= timedelta(hours=2):
            queued += bool(await queue_sms(db, coll, "reminder_2h", a, f"{a['id']}:{a['date']}:{a['time']}"))
    if sending_enabled():
        for row in await db.nt_sms_outbox.find({"status": "retry"}, {"_id": 0}).to_list(100):
            await send_row(db, row)
    return queued


def _twiml(text):
    from html import escape
    body = f"<Message>{escape(text)}</Message>" if text else ""
    return Response(f'<?xml version="1.0" encoding="UTF-8"?><Response>{body}</Response>', media_type="application/xml")


def build_sms_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api/sms")

    async def verified_form(request):
        form = dict((await request.form()).items())
        token = (os.environ.get("TWILIO_AUTH_TOKEN") or "").strip()
        if not token:
            raise HTTPException(503, "Twilio webhook verification is not configured")
        if not signature_valid(_public_url(request), form, request.headers.get("x-twilio-signature", ""), token):
            raise HTTPException(403, "Invalid signature")
        return form

    @r.post("/status")
    async def status(request: Request):
        form = await verified_form(request)
        sid, state = form.get("MessageSid"), form.get("MessageStatus")
        rank = {"queued": 1, "sending": 1, "sent": 2, "delivered": 3, "undelivered": 3, "failed": 3, "read": 4}
        if sid and state in rank:
            # Twilio callbacks can arrive out of order; never move a text back to an earlier state.
            lower = [k for k, v in rank.items() if v < rank[state]]
            await db.nt_sms_outbox.update_one({"sid": sid, "status": {"$in": lower}}, {"$set": {"status": state, "providerStatusAt": datetime.now(timezone.utc).isoformat(), "errorCode": form.get("ErrorCode")}})
        return Response(status_code=204)

    @r.post("/inbound")
    async def inbound(request: Request):
        form = await verified_form(request)
        sid = form.get("MessageSid") or uuid.uuid4().hex
        number = normalize_phone(form.get("From"))
        word = re.sub(r"[^A-ZÀ-Ü]", "", (form.get("Body") or "").strip().upper().split(" ")[0] if form.get("Body") else "")
        try:
            await db.nt_sms_inbound.insert_one({"sid": sid, "fromMasked": mask(number), "keyword": word if word in STOP_WORDS | START_WORDS | HELP_WORDS else "other", "at": datetime.now(timezone.utc).isoformat()})
        except DuplicateKeyError:
            return _twiml("")
        if not number:
            return _twiml("")
        digest = phone_hash(number)
        own = not _flag("TWILIO_ADVANCED_OPT_OUT", True)
        if word in STOP_WORDS:
            await db.nt_sms_optouts.update_one({"phoneHash": digest}, {"$set": {"phoneHash": digest, "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
            await db.nt_sms_outbox.update_many({"status": {"$in": ["held", "queued", "retry"]}, "toHash": digest}, {"$set": {"status": "blocked"}})
            await add_audit("Twilio", f"SMS opt-out received ({mask(number)})")
            return _twiml(STOP_REPLY if own else "")  # With Advanced Opt-Out on, Twilio sends the compliant reply itself.
        if word in START_WORDS:
            await db.nt_sms_optouts.delete_one({"phoneHash": digest})
            await add_audit("Twilio", f"SMS opt-in received ({mask(number)})")
            return _twiml(START_REPLY if own else "")
        if word in HELP_WORDS:
            return _twiml(HELP_REPLY if own else "")
        return _twiml(AUTO_REPLY)

    async def owner(request):
        user = await user_from(request)
        if not user or user["role"] != "owner":
            raise HTTPException(403, "Only the owner can manage SMS")
        return user

    @r.get("/status-summary")
    async def summary(request: Request):
        await owner(request)
        counts = {k: await db.nt_sms_outbox.count_documents({"status": k}) for k in ("held", "queued", "sending", "retry", "sent", "delivered", "undelivered", "failed", "blocked")}
        rows = await db.nt_sms_outbox.find({}, {"_id": 0, "toSealed": 0}).sort("at", -1).to_list(30)
        return {**readiness(), "outbox": counts, "recent": rows, "optOuts": await db.nt_sms_optouts.count_documents({})}

    @r.post("/test")
    async def test_send(request: Request):
        """Sends one fixed text to SMS_TEST_RECIPIENT only. Refused while SMS is off."""
        user = await owner(request)
        number = test_recipient()
        if not number:
            raise HTTPException(409, "Set SMS_TEST_RECIPIENT first")
        if not sending_enabled():
            raise HTTPException(409, "SMS is turned off (SMS_ENABLED=false)")
        row = {"id": "sms-" + uuid.uuid4().hex[:12], "dedupeKey": f"test:{uuid.uuid4().hex}", "kind": "test", "toSealed": seal(number), "toMasked": mask(number),
               "body": "Nabitouch: test text from your app settings." + FOOTER, "status": "queued", "attempts": 0, "at": datetime.now(timezone.utc).isoformat()}
        await db.nt_sms_outbox.insert_one(dict(row))
        await send_row(db, row)
        await add_audit(user.get("name") or "owner", "SMS test sent")
        return await db.nt_sms_outbox.find_one({"id": row["id"]}, {"_id": 0, "toSealed": 0})

    return r
