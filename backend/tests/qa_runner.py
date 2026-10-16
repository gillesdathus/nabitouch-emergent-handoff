"""Disposable local QA: fresh database, synthetic providers, no external delivery.

Run from backend: python tests/qa_runner.py [pytest targets...]
Requires an isolated Mongo replica set at mongo:27017 on a private Docker network.
Every invocation retains a uniquely named synthetic database for investigation.
"""
import os
import base64
from pathlib import Path
import secrets
import subprocess
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def configure():
    # Deliberately ignore inherited integration credentials and database settings.
    for key in list(os.environ):
        if key.startswith(("STRIPE_", "RESEND_", "FIREBASE_", "TWILIO_", "LEGACY_")):
            os.environ.pop(key)
    os.environ.update({
        "PYTHON_DOTENV_DISABLED": "1", "QA_ETA_FAILURE": "false",
        "APP_ENV": "development", "DEMO_MODE": "true",
        "MONGO_URL": "mongodb://mongo:27017/?replicaSet=rs0",
        "REPLICA_MONGO_URL": "mongodb://mongo:27017/?replicaSet=rs0",
        "DB_NAME": "nabitouch_qa_codex_" + uuid.uuid4().hex,
        "JWT_SECRET": secrets.token_urlsafe(32),
        "OWNER_EMAIL": "owner@nabitouch.test",
        "OWNER_PASSWORD": secrets.token_urlsafe(24),
        "DEMO_PASSWORD": secrets.token_urlsafe(24),
        "EMAIL_FROM_NAME": "Nabitouch QA", "EMAIL_PROVIDER": "mock",
        "EMAIL_LIFECYCLE_ENABLED": "false", "PUSH_ENABLED": "false",
        "EMAIL_REMINDERS_ENABLED": "false", "EMAIL_ACCEPTANCE_MODE": "false",
        "EMAIL_ALLOWED_RECIPIENTS": "", "EMAIL_APPROVED_SENDERS": "", "NOTIFICATION_WORKER_ENABLED": "true",
        "PUSH_DRY_RUN": "true", "PAYMENT_MODE": "simulated",
        "STRIPE_CARD_CHECKOUT_ENABLED": "false", "DOCUMENT_UPLOADS_ENABLED": "false",
        "LEGACY_PATIENT_IMPORT_ENABLED": "false", "COOKIE_SECURE": "false",
        "COOKIE_SAMESITE": "lax", "CORS_ORIGINS": "http://localhost:3000",
        "APP_URL": "https://qa.nabitouch.example", "REACT_APP_BACKEND_URL": "http://127.0.0.1:8000",
        "MAPBOX_TOKEN": "pk.synthetic-qa-not-a-real-token", "MAPBOX_FIXTURE_MODE": "",
        "MAPBOX_PERMANENT_GEOCODING": "true",  # Synthetic transport only; no paid provider call.
        "FIELD_ENCRYPTION_KEY": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(), "FIELD_ENCRYPTION_KEY_PREVIOUS": "",
        "REDIS_URL": "redis://redis:6379/0", "REACT_APP_MAPBOX_PUBLIC_TOKEN": "",
        "GOOGLE_REVIEW_URL": "https://g.page/r/CWre3DsJWCgxEAE/review",
        "REVIEW_INVITES_ENABLED": "false",
        "STRIPE_WEBHOOK_SECRET": "whsec_" + secrets.token_urlsafe(24),
        "TWILIO_AUTH_TOKEN": secrets.token_urlsafe(24),
        "WEBHOOK_CRON_SECRET": secrets.token_urlsafe(24),
        "GEO_SAMPLE_CATALOG": "false", "GIFTCARDS_ENABLED": "false",
        "INVOICE_EMAIL_ENABLED": "false", "STATEMENT_EMAIL_ENABLED": "false",
        "API_URL": "http://127.0.0.1:8000",
    })


def serve():
    if not os.environ.get("DB_NAME", "").startswith("nabitouch_qa_codex_"):
        raise RuntimeError("QA server requires a disposable QA database")
    from geo import GEO, LOCAL, GeocodeError
    from tracking import DIRECTIONS
    import uvicorn

    async def geocode(url, params):
        query = str(params.get("q", "")).lower()
        hits = [row for row in LOCAL if query and (query in row["line"].lower() or row["line"].lower() in query or query == row["id"])]
        if not hits:
            raise GeocodeError("Synthetic address not in QA fixture catalogue")
        return {"features": [{"geometry": {"coordinates": [row["lng"], row["lat"]]},
            "properties": {"full_address": row["line"], "mapbox_id": row["id"],
                           "context": {"place": {"name": row["area"]}}}} for row in hits]}

    async def directions(profile, origin, dest, token):
        if os.environ.get("QA_ETA_FAILURE") == "true":
            raise RuntimeError("Synthetic Mapbox outage")
        return {"distance": 6000, "duration": 720, "geometry": {"type": "LineString", "coordinates": []}}

    GEO.fetch = geocode
    DIRECTIONS._fetch = directions
    uvicorn.run("server:app", host="0.0.0.0", port=8000, access_log=False, log_level="warning")


def main():
    import requests
    configure()
    if "--browser" in sys.argv:
        os.environ["CORS_ORIGINS"] = "http://localhost:3025"
        serve()
        return 0
    if "--eta-failure" in sys.argv:
        sys.argv.remove("--eta-failure")
        os.environ["QA_ETA_FAILURE"] = "true"
    print("Synthetic QA database:", os.environ["DB_NAME"], flush=True)
    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    reports = root.parent / "test_reports"
    reports.mkdir(exist_ok=True)
    run_id = os.environ["DB_NAME"][-8:]
    with (reports / f"qa-api-{run_id}.log").open("w") as log:
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--serve"], stdout=log, stderr=log)
        try:
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError(f"QA API failed to start; inspect test_reports/qa-api-{run_id}.log")
                try:
                    if requests.get("http://127.0.0.1:8000/api/", timeout=1).status_code == 200:
                        break
                except requests.RequestException:
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError("QA API startup timed out")
            targets = sys.argv[1:] or [line.strip() for line in (root / "tests/critical_qa.txt").read_text().splitlines()
                                      if line.strip() and not line.startswith("#")]
            return subprocess.call([sys.executable, "-m", "pytest", "-n", "0", "-q", "--tb=short",
                                    "--junitxml=" + str(reports / f"qa-results-{run_id}.xml"), *targets])
        finally:
            process.terminate()
            process.wait(timeout=20)


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        serve()
    else:
        sys.exit(main())
