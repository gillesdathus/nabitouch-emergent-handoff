# Regression: finance reports, pay rules/statements, billing (checkout/tip/release/etransfer), gift cards
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

from t1_common import OWNER, SAMPLE_PW
CLIENT = ("sarah.demo@example.com", SAMPLE_PW)
PRO = ("maya.demo@example.com", SAMPLE_PW)
KINDS = ["revenue", "collections", "outstanding", "insurance", "giftcards", "earnings", "retention", "services", "refunds"]


def login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": creds[0], "password": creds[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {creds[0]}: {r.status_code} {r.text[:200]}")
    s.headers["X-CSRF-Token"] = s.cookies.get("csrf_token") or ""
    return s


@pytest.fixture(scope="module")
def owner():
    return login(OWNER)


@pytest.fixture(scope="module")
def client():
    return login(CLIENT)


@pytest.fixture(scope="module")
def pro():
    return login(PRO)


# --- Reports
class TestReports:
    def test_catalog_owner(self, owner):
        r = owner.get(f"{BASE_URL}/api/finance/reports")
        assert r.status_code == 200
        assert set(KINDS) <= {x["kind"] for x in r.json()}  # catalog grew (services, plans)

    def test_catalog_pro_earnings_only(self, pro):
        r = pro.get(f"{BASE_URL}/api/finance/reports")
        assert r.status_code == 200
        assert [x["kind"] for x in r.json()] == ["earnings"]

    def test_catalog_client_forbidden(self, client):
        assert client.get(f"{BASE_URL}/api/finance/reports").status_code == 403

    @pytest.mark.parametrize("kind", KINDS)
    def test_report_json_csv_pdf(self, owner, kind):
        q = "start=2025-01-01&end=2026-12-31"
        r = owner.get(f"{BASE_URL}/api/finance/reports/{kind}?{q}")
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["kind"] == kind and isinstance(d["kpis"], list) and isinstance(d["rows"], list)
        c = owner.get(f"{BASE_URL}/api/finance/reports/{kind}?{q}&format=csv")
        assert c.status_code == 200 and "text/csv" in c.headers["content-type"]
        p = owner.get(f"{BASE_URL}/api/finance/reports/{kind}?{q}&format=pdf")
        assert p.status_code == 200 and p.content[:4] == b"%PDF"

    def test_report_pagination(self, owner):
        r = owner.get(f"{BASE_URL}/api/finance/reports/revenue?start=2025-01-01&end=2026-12-31&limit=2&page=2")
        assert r.status_code == 200
        d = r.json()
        assert d["page"] == 2 and d["limit"] == 2 and len(d["rows"]) <= 2

    def test_report_bad_dates(self, owner):
        assert owner.get(f"{BASE_URL}/api/finance/reports/revenue?start=2026-05-01&end=2026-01-01").status_code == 400
        assert owner.get(f"{BASE_URL}/api/finance/reports/revenue?start=bad").status_code == 400
        assert owner.get(f"{BASE_URL}/api/finance/reports/nope").status_code == 404

    def test_pro_cannot_see_revenue(self, pro):
        assert pro.get(f"{BASE_URL}/api/finance/reports/revenue").status_code in (403, 404)


# --- Pay rules & statements
class TestPay:
    def test_pay_rules_default(self, owner):
        r = owner.get(f"{BASE_URL}/api/finance/pay-rules")
        assert r.status_code == 200
        assert r.json()["default"]["type"] in ("commission", "hourly")

    def test_pay_rules_roundtrip_and_validation(self, owner):
        cur = owner.get(f"{BASE_URL}/api/finance/pay-rules").json()
        bad = owner.put(f"{BASE_URL}/api/finance/pay-rules", json={"default": {"type": "commission", "practitionerPct": 150}})
        assert bad.status_code == 400
        ok = owner.put(f"{BASE_URL}/api/finance/pay-rules", json=cur)
        assert ok.status_code == 200
        assert owner.get(f"{BASE_URL}/api/finance/pay-rules").json()["default"] == cur["default"]

    def test_pay_rules_csrf_required(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login", json={"email": OWNER[0], "password": OWNER[1]})
        r = s.put(f"{BASE_URL}/api/finance/pay-rules", json={"default": {"type": "commission", "practitionerPct": 70}})
        assert r.status_code == 403

    def test_statement_generate_approve_pdf(self, owner, pro):
        r = owner.post(f"{BASE_URL}/api/finance/statements", json={"start": "2025-01-01", "end": "2026-12-31", "practitionerId": "p-maya"})
        assert r.status_code == 200, r.text[:200]
        st = r.json()[0]
        assert st["status"] == "draft"
        # pro cannot see draft
        assert pro.get(f"{BASE_URL}/api/finance/statements/{st['id']}/pdf").status_code == 404
        a = owner.post(f"{BASE_URL}/api/finance/statements/{st['id']}/approve")
        assert a.status_code == 200 and a.json()["status"] == "approved"
        assert owner.post(f"{BASE_URL}/api/finance/statements/{st['id']}/approve").status_code == 409
        lst = pro.get(f"{BASE_URL}/api/finance/statements").json()
        assert any(x["id"] == st["id"] for x in lst)
        assert all(x["status"] == "approved" for x in lst)
        p = pro.get(f"{BASE_URL}/api/finance/statements/{st['id']}/pdf")
        assert p.status_code == 200 and p.content[:4] == b"%PDF"

    def test_statement_draft_delete(self, owner):
        r = owner.post(f"{BASE_URL}/api/finance/statements", json={"start": "2025-01-01", "end": "2026-12-31", "practitionerId": "p-maya"})
        if r.status_code == 409:
            pytest.skip("period already covered by an approved statement from an earlier run (data-dependent)")
        sid = r.json()[0]["id"]
        assert owner.delete(f"{BASE_URL}/api/finance/statements/{sid}").status_code == 200
        assert owner.get(f"{BASE_URL}/api/finance/statements/{sid}/pdf").status_code == 404


# --- Billing
class TestBilling:
    def test_client_invoices_scoped(self, client):
        r = client.get(f"{BASE_URL}/api/invoices")
        assert r.status_code == 200
        items = r.json()["items"]
        assert items and all(i["clientId"] == "c-sarah" for i in items)

    def test_client_checkout_stripe_url(self, client):
        items = client.get(f"{BASE_URL}/api/invoices").json()["items"]
        due = [i for i in items if i["balance"]["cents"] > 0 and i["state"] not in ("draft", "voided")]
        if not due:
            pytest.skip("no open invoice")
        inv = due[0]
        r = client.post(f"{BASE_URL}/api/invoices/{inv['id']}/checkout", json={"tipCents": 0})
        # Launch keeps STRIPE_CARD_CHECKOUT_ENABLED=false → 503 is the intended gate.
        assert r.status_code in (200, 400, 503), r.text[:200]
        if r.status_code == 503:
            assert "turned off" in r.text.lower()
        elif r.status_code == 200:
            assert r.json()["url"].startswith("https://checkout.stripe.com")

    def test_tip_too_big(self, client):
        items = client.get(f"{BASE_URL}/api/invoices").json()["items"]
        due = [i for i in items if i["balance"]["cents"] > 0 and i["state"] not in ("draft", "voided")]
        if not due:
            pytest.skip("no open invoice")
        r = client.post(f"{BASE_URL}/api/invoices/{due[0]['id']}/checkout", json={"tipCents": 999999})
        assert r.status_code in (400, 503), r.text[:200]
        if r.status_code == 503:
            assert "turned off" in r.text.lower()

    def test_release_rules(self, owner, client):
        items = owner.get(f"{BASE_URL}/api/invoices").json()["items"]
        unpaid = [i for i in items if i["balance"]["cents"] > 0 and i["state"] not in ("draft", "voided")]
        if unpaid:
            assert owner.post(f"{BASE_URL}/api/invoices/{unpaid[0]['id']}/release").status_code == 409
        cl = client.get(f"{BASE_URL}/api/invoices").json()["items"]
        assert client.post(f"{BASE_URL}/api/invoices/{cl[0]['id']}/release").status_code == 403

    def test_tip_validation(self, owner):
        items = owner.get(f"{BASE_URL}/api/invoices").json()["items"]
        iid = next(i for i in items if i.get("state") not in ("draft", "voided"))["id"]  # tips need an issued invoice
        assert owner.post(f"{BASE_URL}/api/invoices/{iid}/tip", json={"amountCents": 500, "method": "stripe", "idempotencyKey": "x" * 10}).status_code == 400
        assert owner.post(f"{BASE_URL}/api/invoices/{iid}/tip", json={"amountCents": 0, "method": "cash", "idempotencyKey": "x" * 10}).status_code == 400

    def test_etransfer_read(self, client):
        r = client.get(f"{BASE_URL}/api/billing/etransfer")
        assert r.status_code == 200 and "recipientEmail" in r.json()

    def test_etransfer_client_cannot_save(self, client):
        r = client.put(f"{BASE_URL}/api/billing/etransfer", json={"recipientEmail": "a@b.c", "recipientName": "AB", "instructions": "xyz"})
        assert r.status_code == 403

    def test_etransfer_validation(self, owner):
        assert owner.put(f"{BASE_URL}/api/billing/etransfer", json={"recipientEmail": "bad"}).status_code == 400

    def test_client_cannot_view_other_invoice(self, owner, client):
        mine = {i["id"] for i in client.get(f"{BASE_URL}/api/invoices").json()["items"]}
        others = [i for i in owner.get(f"{BASE_URL}/api/invoices").json()["items"] if i["id"] not in mine]
        if not others:
            pytest.skip("no other invoices")
        assert client.get(f"{BASE_URL}/api/invoices/{others[0]['id']}").status_code in (403, 404)


# --- Gift cards
class TestGiftCards:
    def test_config_and_mine(self, client):
        assert client.get(f"{BASE_URL}/api/giftcards/config").status_code == 200
        r = client.get(f"{BASE_URL}/api/giftcards/mine")
        assert r.status_code == 200

    def test_purchase_disabled(self, client):
        r = client.post(f"{BASE_URL}/api/giftcards/purchase", json={"amountCents": 5000, "recipientName": "TEST_X", "recipientEmail": "t@example.com"})
        assert r.status_code in (403, 409, 503), r.text[:200]

    def test_owner_liability_and_list(self, owner):
        assert owner.get(f"{BASE_URL}/api/giftcards/liability").status_code == 200
        assert owner.get(f"{BASE_URL}/api/giftcards").status_code == 200
        assert owner.get(f"{BASE_URL}/api/giftcards/products").status_code == 200

    def test_client_cannot_list_all(self, client):
        assert client.get(f"{BASE_URL}/api/giftcards").status_code in (401, 403)
