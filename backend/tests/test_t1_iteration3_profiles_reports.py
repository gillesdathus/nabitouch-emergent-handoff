# Iteration 3: owner credential attestation, onboarding fields, profile hiding, branded report PDFs
import pytest
from t1_common import API, OWNER, login

PRACT = ("qa.practitioner@qa.nabitouch.com", "QaPract-2026!x")
CLIENT = ("qa.client@qa.nabitouch.com", "QaClient-2026!x")
NABITU = "p-nabitu-kahindo"
QA_P = "p-b6fb28"


@pytest.fixture(scope="module")
def owner():
    s = login(OWNER)
    yield s
    # cleanup: always revoke attestations on Nabitu
    for kind in ("registration", "liability"):
        s.delete(f"{API}/practitioners/{NABITU}/credential-attestation/{kind}", timeout=20)


@pytest.fixture(scope="module")
def pract():
    return login(PRACT)


@pytest.fixture(scope="module")
def client():
    return login(CLIENT)


# Attestation RBAC + validation
class TestAttestation:
    def test_practitioner_forbidden(self, pract):
        r = pract.post(f"{API}/practitioners/{NABITU}/credential-attestation", json={"kind": "registration", "confirm": True}, timeout=20)
        assert r.status_code == 403, r.text

    def test_client_forbidden(self, client):
        r = client.post(f"{API}/practitioners/{NABITU}/credential-attestation", json={"kind": "registration", "confirm": True}, timeout=20)
        assert r.status_code == 403, r.text

    def test_invalid_kind(self, owner):
        r = owner.post(f"{API}/practitioners/{NABITU}/credential-attestation", json={"kind": "association", "confirm": True}, timeout=20)
        assert r.status_code == 400

    def test_missing_confirm(self, owner):
        r = owner.post(f"{API}/practitioners/{NABITU}/credential-attestation", json={"kind": "registration"}, timeout=20)
        assert r.status_code == 400

    def test_unknown_practitioner(self, owner):
        r = owner.post(f"{API}/practitioners/p-does-not-exist/credential-attestation", json={"kind": "registration", "confirm": True}, timeout=20)
        assert r.status_code == 404

    def test_attest_then_onboarding_then_revoke(self, owner):
        r = owner.post(f"{API}/practitioners/{NABITU}/credential-attestation", json={"kind": "registration", "confirm": True, "note": "TEST_ seen original"}, timeout=20)
        assert r.status_code == 200, r.text
        att = r.json()["credentialAttestations"]["registration"]
        assert att["note"] == "TEST_ seen original" and att["by"] and att["at"]
        b = owner.get(f"{API}/onboarding", timeout=20).json()
        row = next(p for p in b["practitioners"] if p["practitionerId"] == NABITU)
        assert "activatedAt" in row
        assert "registration" in row["credentialAttestations"]
        gap = next((g for g in row["gaps"] if g["id"] == "registration"), None)
        assert gap and gap["status"] == "owner attested · document not on file"
        d = owner.delete(f"{API}/practitioners/{NABITU}/credential-attestation/registration", timeout=20)
        assert d.status_code == 200
        assert "registration" not in d.json()["credentialAttestations"]
        row = next(p for p in owner.get(f"{API}/onboarding", timeout=20).json()["practitioners"] if p["practitionerId"] == NABITU)
        assert "registration" not in row["credentialAttestations"]
        gap = next((g for g in row["gaps"] if g["id"] == "registration"), None)
        assert gap and gap["status"] == "pending verification"

    def test_revoke_invalid_kind(self, owner):
        r = owner.delete(f"{API}/practitioners/{NABITU}/credential-attestation/bogus", timeout=20)
        assert r.status_code == 400

    def test_revoke_forbidden_for_practitioner(self, pract):
        r = pract.delete(f"{API}/practitioners/{NABITU}/credential-attestation/registration", timeout=20)
        assert r.status_code == 403

    def test_onboarding_forbidden_for_practitioner(self, pract):
        assert pract.get(f"{API}/onboarding", timeout=20).status_code in (401, 403)

    def test_attestations_hidden_from_non_owner(self, owner, pract, client):
        owner.post(f"{API}/practitioners/{NABITU}/credential-attestation", json={"kind": "liability", "confirm": True, "note": "TEST_"}, timeout=20)
        try:
            for s in (pract, client):
                r = s.get(f"{API}/state", timeout=30)
                if r.status_code != 200:
                    continue
                for p in r.json().get("practitioners", []):
                    assert "credentialAttestations" not in p, f"leaked to non-owner: {p['id']}"
        finally:
            owner.delete(f"{API}/practitioners/{NABITU}/credential-attestation/liability", timeout=20)


# Branded finance PDFs + CSV
class TestReportPdfs:
    @pytest.mark.parametrize("kind", ["revenue", "collections", "outstanding", "earnings", "insurance", "giftcards"])
    def test_finance_pdf(self, owner, kind):
        r = owner.get(f"{API}/finance/reports/{kind}", params={"start": "2026-10-01", "end": "2026-10-31", "format": "pdf"}, timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_finance_csv(self, owner):
        r = owner.get(f"{API}/finance/reports/revenue", params={"start": "2026-01-01", "end": "2026-01-31", "format": "csv"}, timeout=30)
        assert r.status_code == 200
        assert "csv" in r.headers["content-type"]

    def test_finance_json_with_practitioner(self, owner):
        r = owner.get(f"{API}/finance/reports/revenue", params={"start": "2026-01-01", "end": "2026-01-31", "practitionerId": QA_P, "page": 1, "limit": 25}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["kind"] == "revenue" and isinstance(d["kpis"], list) and "headers" in d

    def test_finance_pdf_forbidden_for_client(self, client):
        r = client.get(f"{API}/finance/reports/revenue", params={"start": "2026-01-01", "end": "2026-01-31", "format": "pdf"}, timeout=30)
        assert r.status_code in (401, 403)

    def test_snapshot_report_pdf_branded(self, owner):
        r = owner.post(f"{API}/reports", json={"start": "2026-01-01", "end": "2026-01-31"}, timeout=60)
        assert r.status_code in (200, 201), r.text[:300]
        rid = r.json().get("id") or r.json().get("report", {}).get("id")
        assert rid
        p = owner.get(f"{API}/reports/{rid}/pdf", timeout=60)
        assert p.status_code == 200
        assert p.headers["content-type"].startswith("application/pdf")
        assert p.content[:4] == b"%PDF"
        assert len(p.content) > 1500  # branded, not trivial text
