"""Validate production secret files without printing secret values.

Statuses are only PASS, FAIL, and PENDING. This script does not source the
environment file and does not print values, hashes, or prefixes.
"""
import base64
import os
import stat
import subprocess
import sys
from urllib.parse import unquote, urlparse

ENV_PATH = "/etc/nabitouch-next.env"
FRONTEND_PATH = "/etc/nabitouch-next.frontend.env"
RESEND_STATUS_PATH = "/etc/nabitouch-next.resend-status"
RECOVERY_PATH = "/etc/nabitouch-next.recovery-confirmed"

REQUIRED_NONEMPTY = (
    "APP_ENV", "APP_URL", "CORS_ORIGINS", "COOKIE_SECURE", "COOKIE_SAMESITE",
    "JWT_SECRET", "OWNER_EMAIL", "OWNER_PASSWORD", "MONGO_URL", "DB_NAME",
    "REDIS_PASSWORD", "REDIS_URL", "FIELD_ENCRYPTION_KEY", "EMAIL_FROM_NAME",
    "EMAIL_FROM", "EMAIL_PROVIDER", "HOSTING_STRATEGY",
)
FLAG_FALSE = (
    "DOCUMENT_UPLOADS_ENABLED",
    "STRIPE_CARD_CHECKOUT_ENABLED",
    "LEGACY_PATIENT_IMPORT_ENABLED",
)


def parse_env(text):
    data = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        data[key] = value
    return data


def _key_ok(value):
    if not value:
        return False
    try:
        decoded = base64.urlsafe_b64decode(value)
    except Exception:
        return False
    return len(decoded) == 32


def _token_kind(value):
    if not value:
        return "empty"
    if value.startswith("pk."):
        return "public"
    if value.startswith("sk."):
        return "secret"
    return "other"


def assess(env_text, frontend_text=None, resend_status=None, recovery_attested=False, file_mode=None, file_owner="root", file_group="root", git_ok=True):
    """Return ordered (name, status) pairs. Status is PASS, FAIL, or PENDING."""
    rows = []
    if env_text is None:
        rows.append(("environment file", "FAIL"))
        for name in (
            "ownership", "mode", "application secrets", "field encryption key",
            "mapbox backend token", "mapbox public token", "resend api key",
            "resend webhook", "resend domain", "document uploads", "card checkout",
            "legacy import", "recovery copy", "git",
        ):
            rows.append((name, "PENDING"))
        return rows

    env = parse_env(env_text)
    rows.append(("environment file", "PASS"))
    rows.append(("ownership", "PASS" if file_owner == "root" and file_group == "root" else "FAIL"))
    rows.append(("mode", "PASS" if file_mode == 0o600 else "FAIL"))

    missing = [name for name in REQUIRED_NONEMPTY if not (env.get(name) or "").strip()]
    weak_jwt = len(env.get("JWT_SECRET") or "") < 16
    rows.append(("application secrets", "FAIL" if missing or weak_jwt else "PASS"))

    rows.append(("field encryption key", "PASS" if _key_ok(env.get("FIELD_ENCRYPTION_KEY") or "") else "FAIL"))
    previous = env.get("FIELD_ENCRYPTION_KEY_PREVIOUS") or ""
    if previous and not _key_ok(previous):
        rows.append(("previous encryption key", "FAIL"))

    mongo = env.get("MONGO_URL") or ""
    parsed_mongo = urlparse(mongo)
    mongo_ok = (
        parsed_mongo.scheme == "mongodb"
        and parsed_mongo.username == "ntnext"
        and bool(parsed_mongo.password)
        and parsed_mongo.password != "replace-me"
        and "replicaSet=rs0" in mongo
        and "authSource=admin" in mongo
        and parsed_mongo.path == "/nabitouch_prod"
    )
    rows.append(("mongodb url", "PASS" if mongo_ok else "FAIL"))

    redis_url = env.get("REDIS_URL") or ""
    parsed_redis = urlparse(redis_url)
    redis_password = env.get("REDIS_PASSWORD") or ""
    redis_ok = (
        parsed_redis.scheme == "rediss"
        and bool(parsed_redis.password)
        and unquote(parsed_redis.password) == redis_password
        and redis_password != "replace-me"
    )
    rows.append(("redis", "PASS" if redis_ok else "FAIL"))

    distinct = {
        env.get("JWT_SECRET") or "",
        env.get("OWNER_PASSWORD") or "",
        unquote(parsed_mongo.password or ""),
        redis_password,
        env.get("FIELD_ENCRYPTION_KEY") or "",
    }
    rows.append(("secret independence", "PASS" if "" not in distinct and len(distinct) == 5 else "FAIL"))

    frontend = parse_env(frontend_text or "")
    backend_value = env.get("MAPBOX_TOKEN") or ""
    public_value = frontend.get("REACT_APP_MAPBOX_PUBLIC_TOKEN") or ""
    backend_ok = (backend_value.startswith("pk.") or backend_value.startswith("sk.")) and len(backend_value) >= 20
    if not backend_value:
        rows.append(("mapbox backend token", "PENDING"))
    elif backend_ok and backend_value != public_value:
        rows.append(("mapbox backend token", "PASS"))
    else:
        rows.append(("mapbox backend token", "FAIL"))

    if "REACT_APP_MAPBOX_PUBLIC_TOKEN" in env:
        rows.append(("mapbox public token location", "FAIL"))
    public = _token_kind(public_value)
    if frontend_text is None or public == "empty":
        rows.append(("mapbox public token", "PENDING"))
    elif public == "public" and len(frontend.get("REACT_APP_MAPBOX_PUBLIC_TOKEN") or "") >= 20 and frontend.get("REACT_APP_MAPBOX_PUBLIC_TOKEN") != env.get("MAPBOX_TOKEN"):
        rows.append(("mapbox public token", "PASS"))
    else:
        rows.append(("mapbox public token", "FAIL"))

    resend_key = (env.get("RESEND_API_KEY") or "").strip()
    if not resend_key:
        rows.append(("resend api key", "PENDING"))
    elif resend_key.startswith("re_") and not resend_key.startswith("re_test") and "placeholder" not in resend_key and len(resend_key) >= 12:
        rows.append(("resend api key", "PASS"))
    else:
        rows.append(("resend api key", "FAIL"))

    webhook = (env.get("RESEND_WEBHOOK_SECRET") or "").strip()
    if not webhook:
        rows.append(("resend webhook", "PENDING"))
    elif webhook.startswith("whsec_") and len(webhook) >= 12:
        rows.append(("resend webhook", "PASS"))
    else:
        rows.append(("resend webhook", "FAIL"))

    domain = (resend_status or "").strip().upper()
    if domain == "VERIFIED":
        rows.append(("resend domain", "PASS"))
    elif domain in ("", "PENDING"):
        rows.append(("resend domain", "PENDING"))
    else:
        rows.append(("resend domain", "FAIL"))

    sender = env.get("EMAIL_FROM") or ""
    address = sender[sender.rfind("<") + 1:-1].strip() if "<" in sender and sender.endswith(">") else sender
    rows.append(("resend sender", "PASS" if address.lower().endswith("@nabitouch.com") and env.get("EMAIL_PROVIDER") == "resend" else "FAIL"))

    for name, label in (
        ("DOCUMENT_UPLOADS_ENABLED", "document uploads"),
        ("STRIPE_CARD_CHECKOUT_ENABLED", "card checkout"),
        ("LEGACY_PATIENT_IMPORT_ENABLED", "legacy import"),
    ):
        rows.append((label, "PASS" if (env.get(name) or "").strip().lower() == "false" else "FAIL"))
    rows.append(("clamav", "PASS" if not (env.get("CLAMAV_HOST") or "").strip() and env.get("HOSTING_STRATEGY") == "shared-vps" else "FAIL"))
    stripe = (env.get("STRIPE_SECRET_KEY") or "").strip()
    rows.append(("stripe secret", "FAIL" if stripe.startswith("sk_live_") or stripe.startswith("sk_test_") else "PASS"))
    rows.append(("recovery copy", "PASS" if recovery_attested else "PENDING"))
    rows.append(("git", "PASS" if git_ok else "FAIL"))
    return rows


def _mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


def _owner_names(path):
    info = os.stat(path)
    try:
        import pwd
        import grp
        return pwd.getpwuid(info.st_uid).pw_name, grp.getgrgid(info.st_gid).gr_name
    except Exception:
        return str(info.st_uid), str(info.st_gid)


def git_is_clean(repo):
    if not os.path.isdir(os.path.join(repo, ".git")):
        return True
    try:
        tracked = subprocess.check_output(["git", "ls-files"], cwd=repo, text=True, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.CalledProcessError):
        return False
    names = tracked.splitlines()
    if any(os.path.basename(name) == "nabitouch-next.env" for name in names):
        return False
    try:
        blob = subprocess.check_output(
            ["git", "grep", "-I", "-n", "-e", "pk.eyJ", "-e", "sk.eyJ", "-e", "mongodb://ntnext:"],
            cwd=repo, text=True, stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError as exc:
        blob = "" if exc.returncode == 1 else None
    except OSError:
        return False
    if blob is None:
        return False
    allowed = ("replace-me", "{mongo}", "mongo-password-value", '"mongodb://ntnext:"')
    for line in blob.splitlines():
        if any(marker in line for marker in allowed):
            continue
        return False
    placeholders = {"", "replace-me", "replace-with-at-least-16-characters"}
    secret_names = ("JWT_SECRET", "OWNER_PASSWORD", "FIELD_ENCRYPTION_KEY", "RESEND_API_KEY", "MAPBOX_TOKEN", "REDIS_PASSWORD", "RESEND_WEBHOOK_SECRET")
    for name in names:
        if not name.endswith(("env.example", "env.hostinger.example")):
            continue
        with open(os.path.join(repo, name), encoding="utf-8") as handle:
            sample = parse_env(handle.read())
        for key in secret_names:
            if (sample.get(key) or "").strip() not in placeholders:
                return False
    return True


def main(argv):
    env_path = argv[1] if len(argv) > 1 else ENV_PATH
    repo = argv[2] if len(argv) > 2 else ""
    if not os.path.isfile(env_path):
        rows = assess(None, git_ok=git_is_clean(repo) if repo else True)
    else:
        with open(env_path, "r", encoding="utf-8") as handle:
            env_text = handle.read()
        frontend_text = None
        if os.path.isfile(FRONTEND_PATH):
            with open(FRONTEND_PATH, "r", encoding="utf-8") as handle:
                frontend_text = handle.read()
        resend_status = ""
        if os.path.isfile(RESEND_STATUS_PATH):
            with open(RESEND_STATUS_PATH, "r", encoding="utf-8") as handle:
                resend_status = handle.read().strip()
        owner, group = _owner_names(env_path)
        rows = assess(
            env_text,
            frontend_text=frontend_text,
            resend_status=resend_status,
            recovery_attested=os.path.isfile(RECOVERY_PATH),
            file_mode=_mode(env_path),
            file_owner=owner,
            file_group=group,
            git_ok=git_is_clean(repo) if repo else True,
        )
        if os.path.isfile(FRONTEND_PATH):
            front_owner, front_group = _owner_names(FRONTEND_PATH)
            front_ok = _mode(FRONTEND_PATH) == 0o600 and front_owner == "root" and front_group == "root"
            rows.append(("frontend file", "PASS" if front_ok else "FAIL"))
        else:
            rows.append(("frontend file", "PENDING"))
    for name, status in rows:
        print(f"{name}: {status}")
    return 0 if all(status != "FAIL" for _, status in rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
