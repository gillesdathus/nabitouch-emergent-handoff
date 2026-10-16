"""Private client feedback (one per completed visit, one edit within 7 days) plus a configurable Google review link."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo.errors import DuplicateKeyError

REVIEWABLE = ("completed", "processing", "closed")
EDIT_WINDOW = timedelta(days=7)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def google_review_url():
    url = (os.environ.get("GOOGLE_REVIEW_URL") or "").strip()
    return url if url.startswith("https://") else None


def invites_enabled():
    return os.environ.get("REVIEW_INVITES_ENABLED", "false").strip().lower() == "true"


async def ensure_reviews(db):
    await db.nt_reviews.create_index("id", unique=True)
    await db.nt_reviews.create_index("appointmentId", unique=True)
    await db.nt_reviews.create_index([("clientId", 1), ("at", -1)])
    await db.nt_review_invites.create_index("appointmentId", unique=True)
    await db.nt_client_ratings.create_index("id", unique=True)
    await db.nt_client_ratings.create_index("appointmentId", unique=True)


async def clear_reviews(db):
    await db.nt_reviews.delete_many({})
    await db.nt_review_invites.delete_many({})
    await db.nt_client_ratings.delete_many({})


async def prepare_review_invite(db, coll, appt):
    """One invitation per completed visit. Held unless REVIEW_INVITES_ENABLED=true is authorized."""
    client = await coll("clients").find_one({"id": appt.get("clientId")}, {"_id": 0, "email": 1, "firstName": 1}) or {}
    row = {
        "id": "rvi-" + uuid.uuid4().hex[:12], "appointmentId": appt["id"], "clientId": appt.get("clientId"), "at": now_iso(),
        "channel": "email", "to": client.get("email"), "status": "held_sending_disabled",
        "subject": "How was your Nabitouch visit?",
        "link": f"{(os.environ.get('APP_URL') or '').rstrip('/')}/me/reviews?appt={appt['id']}",
    }
    try:
        await db.nt_review_invites.insert_one(dict(row))
    except DuplicateKeyError:
        return None
    if invites_enabled() and row["to"]:
        from emailer import send_email
        html = (f"<p>Hi {client.get('firstName') or 'there'},</p><p>Thank you for visiting Nabitouch. "
                f"We would value your private feedback on your visit.</p><p><a href=\"{row['link']}\">Share feedback</a></p>")
        try:
            provider_id = await send_email(to=row["to"], subject=row["subject"], html=html, idempotency_key=f"review-invite-{appt['id']}")
            await db.nt_review_invites.update_one({"id": row["id"]}, {"$set": {"status": "sent", "providerId": provider_id, "sentAt": now_iso()}})
        except Exception:
            await db.nt_review_invites.update_one({"id": row["id"]}, {"$set": {"status": "failed"}})
    return row


def _public(row):
    row = {k: v for k, v in row.items() if k != "_id"}
    at = datetime.fromisoformat(row["at"])
    row["editable"] = int(row.get("editCount") or 0) < 1 and datetime.now(timezone.utc) - at <= EDIT_WINDOW
    row["editableUntil"] = (at + EDIT_WINDOW).isoformat()
    return row


async def _body(request):
    try:
        body = await request.json()
    except ValueError as exc:
        raise HTTPException(400, "Send a JSON object") from exc
    if not isinstance(body, dict):
        raise HTTPException(400, "Send a JSON object")
    return body


def _clean(body):
    rating = body.get("rating")
    if not isinstance(rating, int) or isinstance(rating, bool) or not 1 <= rating <= 5:
        raise HTTPException(400, "Choose a rating from 1 to 5 stars")
    return rating, str(body.get("comment") or "").strip()[:1500]


def build_reviews_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api")

    async def client_user(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if user["role"] != "client":
            raise HTTPException(403, "Only clients leave feedback")
        return user

    @r.get("/reviews/config")
    async def config():
        url = google_review_url()
        return {"googleReviewUrl": url, "googleConfigured": bool(url)}

    @r.get("/reviews/me")
    async def mine(request: Request):
        user = await client_user(request)
        rows = await db.nt_reviews.find({"clientId": user["subject"]}, {"_id": 0, "history": 0}).sort("at", -1).to_list(500)
        reviewed = {row["appointmentId"] for row in rows}
        appts = await coll("appointments").find({"clientId": user["subject"], "status": {"$in": list(REVIEWABLE)}},
                                                {"_id": 0, "id": 1, "ref": 1, "date": 1, "time": 1, "serviceSlug": 1, "practitionerId": 1, "duration": 1}).to_list(500)
        appts.sort(key=lambda a: f"{a.get('date')}{a.get('time')}", reverse=True)
        url = google_review_url()
        eligible = [a for a in appts if a["id"] not in reviewed]
        return {"reviews": [_public(row) for row in rows], "eligible": eligible[:20], "eligibleTotal": len(eligible),
                "googleReviewUrl": url, "googleConfigured": bool(url)}

    @r.post("/reviews")
    async def create(request: Request):
        user = await client_user(request)
        body = await _body(request)
        rating, comment = _clean(body)
        appt = await coll("appointments").find_one({"id": str(body.get("appointmentId") or "")}, {"_id": 0})
        if not appt or appt.get("clientId") != user["subject"]:
            raise HTTPException(404, "Appointment not found")
        if appt.get("status") not in REVIEWABLE:
            raise HTTPException(409, "Feedback opens once the visit is completed")
        row = {"id": "rev-" + uuid.uuid4().hex[:12], "appointmentId": appt["id"], "clientId": user["subject"],
               "practitionerId": appt.get("practitionerId"), "serviceSlug": appt.get("serviceSlug"), "apptDate": appt.get("date"),
               "ref": appt.get("ref"), "rating": rating, "comment": comment, "at": now_iso(), "editedAt": None, "editCount": 0, "history": []}
        try:
            await db.nt_reviews.insert_one(dict(row))
        except DuplicateKeyError as exc:
            raise HTTPException(409, "You already left feedback for this visit") from exc
        await add_audit(user.get("name") or "client", f"{appt.get('ref')} private feedback {rating}★", appt["id"], actor_id=user.get("id"))
        row.pop("history")
        return _public(row)

    @r.put("/reviews/{review_id}")
    async def edit(review_id: str, request: Request):
        user = await client_user(request)
        rating, comment = _clean(await _body(request))
        row = await db.nt_reviews.find_one({"id": review_id, "clientId": user["subject"]}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Feedback not found")
        if not _public(row)["editable"]:
            raise HTTPException(409, "Feedback can be edited once, within 7 days of submitting")
        snapshot = {"rating": row["rating"], "comment": row["comment"], "at": row.get("editedAt") or row["at"]}
        done = await db.nt_reviews.find_one_and_update(
            {"id": review_id, "editCount": 0},
            {"$set": {"rating": rating, "comment": comment, "editedAt": now_iso()}, "$inc": {"editCount": 1}, "$push": {"history": snapshot}},
            projection={"_id": 0, "history": 0}, return_document=True)
        if not done:
            raise HTTPException(409, "Feedback can be edited once, within 7 days of submitting")
        await add_audit(user.get("name") or "client", f"{row.get('ref')} private feedback edited {row['rating']}★ → {rating}★", row["appointmentId"], actor_id=user.get("id"))
        return _public(done)

    @r.get("/owner/reviews")
    async def owner_list(request: Request, rating: int = 0, sort: str = "newest"):
        user = await user_from(request)
        if not user or user["role"] != "owner":
            raise HTTPException(403, "Only the owner can read private client feedback")
        query = {"rating": rating} if 1 <= rating <= 5 else {}
        rows = await db.nt_reviews.find(query, {"_id": 0}).sort("at", 1 if sort == "oldest" else -1).to_list(1000)
        clients = {c["id"]: c for c in await coll("clients").find({"id": {"$in": list({row["clientId"] for row in rows})}},
                                                                   {"_id": 0, "id": 1, "firstName": 1, "lastName": 1}).to_list(1000)}
        services = {s["slug"]: s.get("name") for s in await coll("services").find({}, {"_id": 0, "slug": 1, "name": 1}).to_list(200)}
        all_rows = await db.nt_reviews.find({}, {"_id": 0, "rating": 1}).to_list(5000)
        counts = {str(n): sum(1 for row in all_rows if row["rating"] == n) for n in range(1, 6)}
        invites = await db.nt_review_invites.find({}, {"_id": 0, "status": 1}).to_list(5000)
        out = [{**row, "clientName": " ".join(filter(None, [clients.get(row["clientId"], {}).get("firstName"), clients.get(row["clientId"], {}).get("lastName")])) or row["clientId"],
                "serviceName": services.get(row.get("serviceSlug"), row.get("serviceSlug")), "edited": bool(row.get("editCount"))} for row in rows]
        return {
            "reviews": out, "counts": counts, "total": len(all_rows),
            "average": round(sum(row["rating"] for row in all_rows) / len(all_rows), 2) if all_rows else None,
            "invites": {"prepared": len(invites), "held": sum(1 for i in invites if i["status"] == "held_sending_disabled"),
                        "sent": sum(1 for i in invites if i["status"] == "sent"), "sendingEnabled": invites_enabled()},
            "googleConfigured": bool(google_review_url()),
        }

    async def practitioner_user(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if user["role"] != "practitioner":
            raise HTTPException(403, "Only the treating practitioner rates a client visit")
        return user

    @r.get("/practitioner/client-ratings")
    async def my_ratings(request: Request):
        user = await practitioner_user(request)
        rows = await db.nt_client_ratings.find({"practitionerId": user["subject"]}, {"_id": 0, "history": 0}).sort("at", -1).to_list(500)
        rated = {row["appointmentId"] for row in rows}
        appts = await coll("appointments").find({"practitionerId": user["subject"], "status": {"$in": list(REVIEWABLE)}},
                                                {"_id": 0, "id": 1, "ref": 1, "date": 1, "time": 1, "serviceSlug": 1, "clientId": 1}).to_list(500)
        appts.sort(key=lambda a: f"{a.get('date')}{a.get('time')}", reverse=True)
        return {"ratings": [_public(row) for row in rows], "eligible": [a for a in appts if a["id"] not in rated][:50]}

    @r.post("/practitioner/client-ratings")
    async def rate_client(request: Request):
        user = await practitioner_user(request)
        body = await _body(request)
        rating, comment = _clean(body)
        appt = await coll("appointments").find_one({"id": str(body.get("appointmentId") or "")}, {"_id": 0})
        if not appt or appt.get("practitionerId") != user["subject"]:
            raise HTTPException(404, "Appointment not found")
        if appt.get("status") not in REVIEWABLE:
            raise HTTPException(409, "Client ratings open once the visit is completed")
        row = {"id": "crt-" + uuid.uuid4().hex[:12], "appointmentId": appt["id"], "clientId": appt.get("clientId"),
               "practitionerId": user["subject"], "serviceSlug": appt.get("serviceSlug"), "apptDate": appt.get("date"), "ref": appt.get("ref"),
               "rating": rating, "comment": comment, "at": now_iso(), "editedAt": None, "editCount": 0, "history": []}
        try:
            await db.nt_client_ratings.insert_one(dict(row))
        except DuplicateKeyError as exc:
            raise HTTPException(409, "You already rated this visit") from exc
        await add_audit(user.get("name") or "practitioner", f"{appt.get('ref')} client visit rated {rating}★", appt["id"], actor_id=user.get("id"))
        row.pop("history")
        return _public(row)

    @r.put("/practitioner/client-ratings/{rating_id}")
    async def edit_client_rating(rating_id: str, request: Request):
        user = await practitioner_user(request)
        rating, comment = _clean(await _body(request))
        row = await db.nt_client_ratings.find_one({"id": rating_id, "practitionerId": user["subject"]}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Rating not found")
        if not _public(row)["editable"]:
            raise HTTPException(409, "A rating can be edited once, within 7 days")
        snapshot = {"rating": row["rating"], "comment": row["comment"], "at": row["at"]}
        done = await db.nt_client_ratings.find_one_and_update(
            {"id": rating_id, "editCount": 0},
            {"$set": {"rating": rating, "comment": comment, "editedAt": now_iso()}, "$inc": {"editCount": 1}, "$push": {"history": snapshot}},
            projection={"_id": 0, "history": 0}, return_document=True)
        if not done:
            raise HTTPException(409, "A rating can be edited once, within 7 days")
        return _public(done)

    @r.get("/owner/client-ratings")
    async def owner_client_ratings(request: Request, rating: int = 0, sort: str = "newest"):
        user = await user_from(request)
        if not user or user["role"] != "owner":
            raise HTTPException(403, "Only the owner can read practitioner ratings of clients")
        query = {"rating": rating} if 1 <= rating <= 5 else {}
        rows = await db.nt_client_ratings.find(query, {"_id": 0}).sort("at", 1 if sort == "oldest" else -1).to_list(1000)
        clients = {c["id"]: c for c in await coll("clients").find({"id": {"$in": list({row["clientId"] for row in rows})}},
                                                                   {"_id": 0, "id": 1, "firstName": 1, "lastName": 1}).to_list(1000)}
        people = {p["id"]: p.get("name") for p in await coll("practitioners").find({}, {"_id": 0, "id": 1, "name": 1}).to_list(200)}
        services = {s["slug"]: s.get("name") for s in await coll("services").find({}, {"_id": 0, "slug": 1, "name": 1}).to_list(200)}
        return {"ratings": [{**row, "clientName": " ".join(filter(None, [clients.get(row["clientId"], {}).get("firstName"), clients.get(row["clientId"], {}).get("lastName")])) or row["clientId"],
                             "practitionerName": people.get(row["practitionerId"]), "serviceName": services.get(row.get("serviceSlug")), "edited": bool(row.get("editCount"))} for row in rows]}

    return r
