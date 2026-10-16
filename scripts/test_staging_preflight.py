import base64
import importlib.util
from pathlib import Path
import secrets
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("preflight", ROOT / "deploy/staging/preflight.py")
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)


class StagingGuards(unittest.TestCase):
    def fixture(self):
        api = preflight.read_env(ROOT / "deploy/staging/api.env.example")
        frontend = preflight.read_env(ROOT / "deploy/staging/frontend.env.example")
        password = secrets.token_hex(24)
        api.update(APP_URL="https://staging.nabitouch.com", CORS_ORIGINS="https://staging.nabitouch.com",
            MONGO_URL=f"mongodb://staging_app:{password}@mongo:27017/nabitouch_staging?replicaSet=rs0&authSource=nabitouch_staging",
            REDIS_URL=f"rediss://:{password}@redis:6379/0?ssl_ca_certs=/certs/ca.crt",
            JWT_SECRET=secrets.token_hex(32), OWNER_PASSWORD=secrets.token_hex(32),
            FIELD_ENCRYPTION_KEY=base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(), MAPBOX_TOKEN="pk." + secrets.token_hex(24))
        frontend["REACT_APP_BACKEND_URL"] = api["APP_URL"]
        return api, frontend

    def test_valid_initial_guards(self):
        self.assertEqual(preflight.validate(*self.fixture()), [])

    def test_examples_cannot_pass_as_real_configuration(self):
        self.assertTrue(preflight.validate(preflight.read_env(ROOT / "deploy/staging/api.env.example"), preflight.read_env(ROOT / "deploy/staging/frontend.env.example")))

    def test_production_or_unencrypted_database_destination_is_refused(self):
        for key, value in (("DB_NAME", "nabitouch_prod"), ("MONGO_URL", "mongodb://production/db"), ("REDIS_URL", "redis://redis:6379")):
            with self.subTest(key=key):
                api, frontend = self.fixture()
                api[key] = value
                self.assertTrue(preflight.validate(api, frontend))

    def test_delivery_and_test_bypass_flags_are_refused(self):
        for key, value in (("PUSH_ENABLED", "true"), ("STRIPE_CARD_CHECKOUT_ENABLED", "true"), ("EMAIL_PROVIDER", "resend"), ("GEO_SAMPLE_CATALOG", "true")):
            with self.subTest(key=key):
                api, frontend = self.fixture()
                api[key] = value
                self.assertTrue(preflight.validate(api, frontend))

    def test_private_browser_token_and_wildcard_origin_are_refused(self):
        api, frontend = self.fixture()
        frontend["REACT_APP_MAPBOX_PUBLIC_TOKEN"] = "sk." + secrets.token_hex(24)
        api["CORS_ORIGINS"] = "*"
        self.assertTrue(preflight.validate(api, frontend))


if __name__ == "__main__":
    unittest.main()
