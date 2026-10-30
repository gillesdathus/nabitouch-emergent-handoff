# Reviews & feedback MVP: client private reviews, Google link config, owner feedback view, held invitations, practitioner client ratings
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import requests
from pymongo import MongoClient

from booking_fixtures import EDMONTON_HOME
from t1_common import API, BENV, MAYA, NABITU, OWNER, SAMPLE_PW, SARAH, login

DB = MongoClient(BENV["MONGO_URL"])[BENV["DB_NAME"]]
TZ = ZoneInfo("America/Edmonton")
GOOGLE = "https://g.page/r/CWre3DsJWCgxEAE/review"
ADDR = dict(EDMONTON_HOME)
REVIEWABLE = ["completed", "processing", "closed"]
S = {}


@pytest.fixture(scope="module")
def owner():
    return login(OWNER)


@pytest.fixture(scope="module")
def sarah():
    return login(SARAH)


@pytest.fixture(scope="module")
def maya():
    return login(MAYA)


@pytest.fixture(scope="module")
def nabitu():
    return login(NABITU)


@pytest.fixture(scope="module")
def other_client():
    email = f"test_rev_{uuid.uuid4().hex[:6]}@example.com"
    pw = SAMPLE_PW
    requests.post(f"{API}/auth/register", json={"email": email, "password": pw, "firstName": "TEST", "lastName": "Reviewer", "phone": "780-555-0145",
                                                "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True}, timeout=20)
    return login((email, pw))


def unreviewed_sarah(practitioner=None, n=0):
    reviewed = {r["appointmentId"] for r in DB.nt_reviews.find({}, {"appointmentId": 1})}
    q = {"clientId": "c-sarah", "status": {"$in": REVIEWABLE}}
    if practitioner:
        q["practitionerId"] = practitioner
    rows = [a for a in DB.nt_appointments.find(q, {"_id": 0, "id": 1, "practitionerId": 1}) if a["id"] not in reviewed]
    while len(rows) <= n:
        aid = "a-TEST-rev-" + uuid.uuid4().hex[:10]
        person = practitioner or "p-maya"
        DB.nt_appointments.insert_one({
            "id": aid, "clientId": "c-sarah", "practitionerId": person, "status": "completed",
            "serviceSlug": "swedish", "duration": 60, "date": "2024-03-03", "time": "15:00",
            "ref": "TEST-REV", "locationType": "home", "synthetic": True,
        })
        rows.append({"id": aid, "practitionerId": person})
    return rows[n]["id"]


# ---- Public config
class TestConfig:
    def test_config_public(self):
        r = requests.get(f"{API}/reviews/config", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["googleConfigured"] is True and d["googleReviewUrl"] == GOOGLE


# ---- Client reviews
class TestClientReviews:
    def test_me_client_only(self, sarah, maya, owner):
        assert maya.get(f"{API}/reviews/me", timeout=20).status_code == 403
        assert owner.get(f"{API}/reviews/me", timeout=20).status_code == 403
        assert requests.get(f"{API}/reviews/me", timeout=20).status_code == 401
        r = sarah.get(f"{API}/reviews/me", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["reviews"], list) and isinstance(d["eligible"], list) and d["googleConfigured"] is True
        reviewed = {x["appointmentId"] for x in d["reviews"]}
        assert not reviewed & {a["id"] for a in d["eligible"]}
        assert all("_id" not in x and "history" not in x for x in d["reviews"])
        st = {a["status"] for a in DB.nt_appointments.find({"id": {"$in": [a["id"] for a in d["eligible"]]}}, {"status": 1})}
        assert st <= set(REVIEWABLE), st

    def test_rating_validation(self, sarah):
        aid = unreviewed_sarah()
        assert aid
        for bad in (0, 6, "5", 3.5, True, None):
            r = sarah.post(f"{API}/reviews", json={"appointmentId": aid, "rating": bad}, timeout=20)
            assert r.status_code == 400, (bad, r.status_code, r.text[:200])

    def test_not_own_404_and_not_completed_409(self, sarah, other_client):
        aid = unreviewed_sarah()
        r = other_client.post(f"{API}/reviews", json={"appointmentId": aid, "rating": 5}, timeout=20)
        assert r.status_code == 404
        assert sarah.post(f"{API}/reviews", json={"appointmentId": "nope-xyz", "rating": 5}, timeout=20).status_code == 404
        pending = DB.nt_appointments.find_one({"clientId": "c-sarah", "status": {"$in": ["confirmed", "assigned", "requested", "cancelled"]}}, {"id": 1})
        if pending:
            r = sarah.post(f"{API}/reviews", json={"appointmentId": pending["id"], "rating": 5}, timeout=20)
            assert r.status_code == 409, r.text[:200]

    def test_create_then_duplicate_409(self, sarah):
        aid = unreviewed_sarah()
        r = sarah.post(f"{API}/reviews", json={"appointmentId": aid, "rating": 3, "comment": "TEST_ good but late"}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["rating"] == 3 and d["comment"] == "TEST_ good but late" and d["editable"] is True and d["editCount"] == 0
        S["rev"], S["rev_appt"] = d["id"], aid
        r2 = sarah.post(f"{API}/reviews", json={"appointmentId": aid, "rating": 5}, timeout=20)
        assert r2.status_code == 409
        me = sarah.get(f"{API}/reviews/me", timeout=20).json()
        assert any(x["id"] == d["id"] for x in me["reviews"])
        assert aid not in {a["id"] for a in me["eligible"]}

    def test_edit_once(self, sarah, other_client):
        rid = S["rev"]
        assert other_client.put(f"{API}/reviews/{rid}", json={"rating": 1}, timeout=20).status_code == 404
        assert sarah.put(f"{API}/reviews/{rid}", json={"rating": 9}, timeout=20).status_code == 400
        r = sarah.put(f"{API}/reviews/{rid}", json={"rating": 4, "comment": "TEST_ edited"}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["rating"] == 4 and d["editCount"] == 1 and d["editedAt"] and d["editable"] is False
        row = DB.nt_reviews.find_one({"id": rid})
        assert row["history"] and row["history"][0]["rating"] == 3 and row["history"][0]["comment"] == "TEST_ good but late"
        assert sarah.put(f"{API}/reviews/{rid}", json={"rating": 2}, timeout=20).status_code == 409

    def test_edit_window_expired(self, sarah):
        aid = unreviewed_sarah()
        r = sarah.post(f"{API}/reviews", json={"appointmentId": aid, "rating": 5, "comment": "TEST_ old"}, timeout=20)
        assert r.status_code == 200
        rid = r.json()["id"]
        DB.nt_reviews.update_one({"id": rid}, {"$set": {"at": (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()}})
        r = sarah.put(f"{API}/reviews/{rid}", json={"rating": 4}, timeout=20)
        assert r.status_code == 409
        S["old_rev"] = rid


# ---- Owner feedback view
class TestOwnerReviews:
    def test_owner_only(self, sarah, maya):
        assert sarah.get(f"{API}/owner/reviews", timeout=20).status_code == 403
        assert maya.get(f"{API}/owner/reviews", timeout=20).status_code == 403
        assert requests.get(f"{API}/owner/reviews", timeout=20).status_code == 403

    def test_desk_forbidden(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": "reception.demo@example.com", "password": BENV.get("DEMO_PASSWORD", "")}, timeout=20)
        if r.status_code != 200:
            pytest.skip("desk login unavailable")
        assert s.get(f"{API}/owner/reviews", timeout=20).status_code == 403

    def test_owner_list_fields_filter_sort(self, owner):
        r = owner.get(f"{API}/owner/reviews", timeout=20)
        assert r.status_code == 200
        d = r.json()
        # xdist loadscope may run classes on different workers, so fall back to any edited review
        row = next((x for x in d["reviews"] if x["id"] == S.get("rev")), None) or next(x for x in d["reviews"] if x.get("editCount"))
        for k in ("clientName", "apptDate", "serviceName", "rating", "comment", "at", "edited"):
            assert k in row, k
        assert row["edited"] is True and row["clientName"].startswith("Sarah")
        assert set(d["counts"]) == {"1", "2", "3", "4", "5"} and d["total"] == sum(d["counts"].values())
        assert isinstance(d["average"], float) or isinstance(d["average"], int)
        assert d["invites"]["sendingEnabled"] is False and {"prepared", "held", "sent"} <= set(d["invites"])
        f = owner.get(f"{API}/owner/reviews?rating=4", timeout=20).json()
        assert f["reviews"] and all(x["rating"] == 4 for x in f["reviews"])
        new = [x["at"] for x in owner.get(f"{API}/owner/reviews?sort=newest", timeout=20).json()["reviews"]]
        old = [x["at"] for x in owner.get(f"{API}/owner/reviews?sort=oldest", timeout=20).json()["reviews"]]
        assert new == sorted(new, reverse=True) and old == sorted(old)

    def test_bad_rating_param(self, owner):
        r = owner.get(f"{API}/owner/reviews?rating=abc", timeout=20)
        assert r.status_code in (400, 422)


# ---- Invitation held on completion
def book(owner):
    for d in range(30, 250, 3):
        day = (datetime.now(TZ).date() + timedelta(days=d)).isoformat()
        for t in ("08:00", "11:00", "17:00"):
            body = {"source": "reception", "practitionerId": "p-nabitu-kahindo", "client": {"id": "c-sarah"}, "idempotencyKey": "TEST_" + uuid.uuid4().hex[:10],
                    "appointment": {"serviceSlug": "swedish", "duration": 60, "date": day, "time": t, "locationType": "home", "paymentMethod": "self",
                                    "addressId": "ad-sarah", "address": ADDR}}
            b = owner.post(f"{API}/bookings", json=body, timeout=40)
            if b.status_code == 200:
                return b.json()["appointment"]
    pytest.fail("could not book")


class TestInvite:
    def test_completion_prepares_one_held_invite(self, owner):
        if DB.nt_appointments.find_one({"practitionerId": "p-nabitu-kahindo", "status": "in_session"}):
            pytest.skip("p-maya already in session")
        appt = book(owner)
        aid = appt["id"]
        S["inv_appt"] = aid
        status = DB.nt_appointments.find_one({"id": aid})["status"]
        path = (["assigned"] if status == "requested" else []) + ["en_route", "arrived", "in_session", "session_ended", "leaving", "completed"]
        before_mail = DB.nt_email_log.count_documents({}) if "nt_email_log" in DB.list_collection_names() else None
        for to in path:
            r = owner.post(f"{API}/appointments/{aid}/transition", json={"to": to}, timeout=30)
            assert r.status_code == 200, f"{to} {r.text[:200]}"
        assert DB.nt_appointments.find_one({"id": aid})["status"] in REVIEWABLE
        rows = list(DB.nt_review_invites.find({"appointmentId": aid}))
        assert len(rows) == 1 and rows[0]["status"] == "held_sending_disabled"
        assert "/me/reviews?appt=" + aid in rows[0]["link"]
        # processing -> closed must not duplicate
        r = owner.post(f"{API}/appointments/{aid}/transition", json={"to": "closed"}, timeout=30)
        print("closed", r.status_code)
        assert DB.nt_review_invites.count_documents({"appointmentId": aid}) == 1
        if before_mail is not None:
            assert DB.nt_email_log.count_documents({"appointmentId": aid, "kind": {"$regex": "review"}}) == 0

    def test_owner_counts_held(self, owner):
        inv = owner.get(f"{API}/owner/reviews", timeout=20).json()["invites"]
        assert inv["prepared"] >= 1 and inv["held"] >= 1 and inv["sent"] == 0 and inv["sendingEnabled"] is False


# ---- Practitioner ratings of clients
class TestClientRatings:
    def test_permissions(self, sarah, owner):
        assert sarah.get(f"{API}/practitioner/client-ratings", timeout=20).status_code == 403
        assert owner.get(f"{API}/practitioner/client-ratings", timeout=20).status_code == 403
        assert sarah.get(f"{API}/owner/client-ratings", timeout=20).status_code == 403
        assert requests.get(f"{API}/owner/client-ratings", timeout=20).status_code == 403

    def test_list_and_rate(self, nabitu):
        r = nabitu.get(f"{API}/practitioner/client-ratings", timeout=20)
        assert r.status_code == 200
        d = r.json()
        if not d["eligible"]:
            # Seed timeline still holds historical Maya visits; ensure one Nabitu completed visit for rating.
            aid = unreviewed_sarah(practitioner="p-nabitu-kahindo")
            r = nabitu.get(f"{API}/practitioner/client-ratings", timeout=20)
            assert r.status_code == 200
            d = r.json()
        assert d["eligible"], "nabitu has no eligible visits"
        aid = S.get("inv_appt") if S.get("inv_appt") in {a["id"] for a in d["eligible"]} else d["eligible"][0]["id"]
        assert nabitu.post(f"{API}/practitioner/client-ratings", json={"appointmentId": aid, "rating": 0}, timeout=20).status_code == 400
        r = nabitu.post(f"{API}/practitioner/client-ratings", json={"appointmentId": aid, "rating": 4, "comment": "TEST_ punctual"}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        S["crt"] = r.json()["id"]
        assert nabitu.post(f"{API}/practitioner/client-ratings", json={"appointmentId": aid, "rating": 5}, timeout=20).status_code == 409
        again = nabitu.get(f"{API}/practitioner/client-ratings", timeout=20).json()
        assert any(x["id"] == S["crt"] for x in again["ratings"]) and aid not in {a["id"] for a in again["eligible"]}

    def test_not_assigned_404_and_not_completed_409(self, maya, nabitu):
        # Mismatched practitioner (Maya) must not rate another therapist's visit.
        other = DB.nt_appointments.find_one(
            {"practitionerId": {"$nin": ["p-maya", None]}, "status": {"$in": REVIEWABLE}}, {"id": 1}
        )
        if other:
            assert maya.post(f"{API}/practitioner/client-ratings", json={"appointmentId": other["id"], "rating": 3}, timeout=20).status_code == 404
        # Treating practitioner rates own pending visit → not completed yet.
        pend = DB.nt_appointments.find_one({"practitionerId": "p-nabitu-kahindo", "status": {"$in": ["confirmed", "assigned"]}}, {"id": 1})
        if pend:
            assert nabitu.post(f"{API}/practitioner/client-ratings", json={"appointmentId": pend["id"], "rating": 3}, timeout=20).status_code == 409

    def test_edit_once(self, nabitu):
        rid = S["crt"]
        r = nabitu.put(f"{API}/practitioner/client-ratings/{rid}", json={"rating": 2, "comment": "TEST_ edited"}, timeout=20)
        assert r.status_code == 200 and r.json()["editCount"] == 1 and r.json()["rating"] == 2
        assert DB.nt_client_ratings.find_one({"id": rid})["history"][0]["rating"] == 4
        assert nabitu.put(f"{API}/practitioner/client-ratings/{rid}", json={"rating": 3}, timeout=20).status_code == 409
        assert nabitu.put(f"{API}/practitioner/client-ratings/crt-nope", json={"rating": 3}, timeout=20).status_code == 404

    def test_owner_sees_rating_client_does_not(self, owner, sarah):
        d = owner.get(f"{API}/owner/client-ratings", timeout=20).json()
        row = next(x for x in d["ratings"] if x["id"] == S["crt"])
        assert row["edited"] is True and row["practitionerName"] and row["clientName"] and row["serviceName"]
        assert all(x["rating"] == 2 for x in owner.get(f"{API}/owner/client-ratings?rating=2", timeout=20).json()["ratings"])
        me = sarah.get(f"{API}/reviews/me", timeout=20).text
        assert S["crt"] not in me and "TEST_ punctual" not in me
