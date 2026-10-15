#!/bin/bash
# Exits 2 unless CONFIRM_PRIVATE_DEPLOY=yes. Does not change Nginx, DNS, or business data.
set -euo pipefail
umask 077

if [ "${CONFIRM_PRIVATE_DEPLOY:-}" != "yes" ]; then
  echo "Refusing to run. Set CONFIRM_PRIVATE_DEPLOY=yes from a checkout of the frozen source."
  exit 2
fi

frozen="6f67bcd23767d366942b2d3848a1f336f1fd06a8"
expected_current="sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465"
expected_rollback="sha256:0081eac25d1edc251fb45d46ac8351008fffad0afbe5fe87eb9882f59745f7b6"
root="$(git rev-parse --show-toplevel)"
case "$root" in
  /opt/nt-next|/opt/nt-next/*) echo "Refusing to build from /opt/nt-next."; exit 2 ;;
esac
cd "$root"
if [ "$(git rev-parse HEAD)" != "$frozen" ]; then
  git diff --quiet "$frozen" -- backend frontend \
    || { echo "Refusing: backend or frontend differs from the frozen checkout."; exit 2; }
fi

current="$(docker image inspect nt-next-api:local --format '{{.Id}}')"
rollback="$(docker image inspect nt-next-api:rollback-0081eac25d1e --format '{{.Id}}')"
running="$(docker inspect nt-next-api --format '{{.Image}}')"
[ "$current" = "$expected_current" ]
[ "$rollback" = "$expected_rollback" ]
[ "$running" = "$expected_current" ]

python3 - <<'PY'
import subprocess
text = subprocess.check_output(["nginx", "-T"], stderr=subprocess.DEVNULL, text=True, errors="replace")
blocks = [block for block in text.split("server {") if "server_name nabitouch.com" in block and "listen 443" in block]
if len(blocks) != 1:
    raise SystemExit("Refusing: expected one public nabitouch.com server.")
public = [line.strip() for line in blocks[0].splitlines() if "proxy_pass" in line]
if "proxy_pass http://127.0.0.1:8080;" not in public:
    raise SystemExit("Refusing: public site is not on 127.0.0.1:8080.")
if public.count("proxy_pass http://127.0.0.1:8011;") != 1:
    raise SystemExit("Refusing: private API proxy is not limited to one location.")
PY

eval "$(python3 - <<'PY'
import shlex
data = {}
with open("/etc/nabitouch-next.env", encoding="utf-8") as handle:
    for line in handle:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
required = {
    "APP_ENV": "production",
    "DEMO_MODE": "false",
    "DB_NAME": "nabitouch_prod",
    "DOCUMENT_UPLOADS_ENABLED": "false",
    "STRIPE_CARD_CHECKOUT_ENABLED": "false",
    "LEGACY_PATIENT_IMPORT_ENABLED": "false",
}
for key, value in required.items():
    if data.get(key) != value:
        raise SystemExit("Refusing: required environment value is not the private-release setting.")
if not (data.get("REDIS_URL") or "").startswith("rediss://"):
    raise SystemExit("Refusing: Redis is not using rediss.")
if not (data.get("MAPBOX_TOKEN") or "").startswith("pk."):
    raise SystemExit("Refusing: Mapbox token is not a pk. token.")
if not data.get("REDIS_PASSWORD"):
    raise SystemExit("Refusing: Redis password is unset.")
print("export REDIS_PASSWORD=" + shlex.quote(data["REDIS_PASSWORD"]))
print("export MONGO_URL=" + shlex.quote(data["MONGO_URL"]))
PY
)"

docker exec -e MONGO_URL nt-next-api python - <<'PY'
import os
from pymongo import MongoClient
client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=8000)
db = client["nabitouch_prod"]
if db.nt_services.estimated_document_count() > 5000:
    raise SystemExit("Refusing: service collection is larger than the bounded check.")
for field in ("id", "slug"):
    rows = list(db.nt_services.aggregate([
        {"$group": {"_id": f"${field}", "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
        {"$count": "groups"},
    ], maxTimeMS=8000))
    if rows:
        raise SystemExit("Refusing: duplicate service keys exist.")
missing = db.nt_services.count_documents({"$or": [{"slug": {"$exists": False}}, {"slug": None}, {"slug": ""}]}, maxTimeMS=8000)
if missing > 1:
    raise SystemExit("Refusing: more than one service has no slug.")
print("index-preflight-ok", missing)
PY
unset MONGO_URL

docker build -f deploy/Dockerfile.api -t nt-next-api:src-6f67bcd23767 .
docker tag nt-next-api:src-6f67bcd23767 nt-next-api:local
if ! docker compose -f deploy/docker-compose.hostinger.yml up -d --no-deps api; then
  docker tag nt-next-api:9aca5eccdc3c nt-next-api:local
  docker compose -f deploy/docker-compose.hostinger.yml up -d --no-deps api
  unset REDIS_PASSWORD
  echo "Compose failed. Previous API image restored."
  exit 1
fi

rollback_api() {
  docker tag nt-next-api:9aca5eccdc3c nt-next-api:local
  docker compose -f deploy/docker-compose.hostinger.yml up -d --no-deps api
}

body="$(curl -fsS -m 10 http://127.0.0.1:8011/api/health || true)"
if ! python3 - "$body" <<'PY'
import json, sys
data = json.loads(sys.argv[1] or "{}")
ok = data.get("mongo") == "ok" and data.get("redis") == "ok" and data.get("documentUploads") is False and data.get("cardCheckout") is False
if not ok:
    raise SystemExit(1)
print("health-ok")
PY
then
  rollback_api
  unset REDIS_PASSWORD
  echo "Health check failed. Previous API image restored."
  exit 1
fi
unset REDIS_PASSWORD

python3 - <<'PY'
import subprocess
text = subprocess.check_output(["nginx", "-T"], stderr=subprocess.DEVNULL, text=True, errors="replace")
if "proxy_pass http://127.0.0.1:8080;" not in text:
    raise SystemExit("Public proxy changed.")
PY
echo "Private API restarted from nt-next-api:src-6f67bcd23767. Public Nginx was not changed."
