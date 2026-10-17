#!/bin/bash
# Exits 2 unless CONFIRM_PRIVATE_DEPLOY=yes. Does not change Nginx, DNS, or business data.
# Reads deploy/private-release/release-pin.conf for the frozen application SHA and image digests.
set -euo pipefail
umask 077

if [ "${CONFIRM_PRIVATE_DEPLOY:-}" != "yes" ]; then
  echo "Refusing to run. Set CONFIRM_PRIVATE_DEPLOY=yes from a checkout of the pinned source."
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
case "$root" in
  /opt/nt-next|/opt/nt-next/*) echo "Refusing to build from /opt/nt-next."; exit 2 ;;
esac
cd "$root"

pin="$root/deploy/private-release/release-pin.conf"
if [ ! -f "$pin" ]; then
  echo "Refusing: missing release-pin.conf."
  exit 2
fi
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|\#*) continue ;;
  esac
  case "$line" in
    [A-Z0-9_]*=*)
      key="${line%%=*}"
      value="${line#*=}"
      printf -v "$key" '%s' "$value"
      export "$key"
      ;;
  esac
done < "$pin"

frozen="${APPLICATION_SHA:?missing APPLICATION_SHA in release-pin.conf}"
short="${APPLICATION_SHORT:?missing APPLICATION_SHORT in release-pin.conf}"
expected_current="${PRE_DEPLOY_LOCAL_DIGEST:?missing PRE_DEPLOY_LOCAL_DIGEST in release-pin.conf}"
expected_rollback="${ROLLBACK_DIGEST:?missing ROLLBACK_DIGEST in release-pin.conf}"
previous_tag="${PREVIOUS_GOOD_TAG:?missing PREVIOUS_GOOD_TAG in release-pin.conf}"
rollback_tag="${ROLLBACK_TAG:?missing ROLLBACK_TAG in release-pin.conf}"

case "$frozen" in
  0a0d8c74336299bce9958bd39ede2769201a4fd5) ;;
  *)
    echo "Refusing: APPLICATION_SHA in release-pin.conf is not the reviewed RC 0a0d8c7."
    exit 2
    ;;
esac
if [ "$short" != "0a0d8c7" ]; then
  echo "Refusing: APPLICATION_SHORT must be 0a0d8c7 for this pin."
  exit 2
fi

if [ "$(git rev-parse HEAD)" != "$frozen" ]; then
  git diff --quiet "$frozen" -- backend frontend \
    || { echo "Refusing: backend or frontend differs from the pinned checkout $frozen."; exit 2; }
fi

current="$(docker image inspect nt-next-api:local --format '{{.Id}}')"
rollback="$(docker image inspect "$rollback_tag" --format '{{.Id}}')"
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

src_tag="nt-next-api:src-${short}"
docker build -f deploy/Dockerfile.api -t "$src_tag" .
docker tag "$src_tag" nt-next-api:local
if ! docker compose -f deploy/docker-compose.hostinger.yml up -d --no-deps api; then
  docker tag "$previous_tag" nt-next-api:local
  docker compose -f deploy/docker-compose.hostinger.yml up -d --no-deps api
  unset REDIS_PASSWORD
  echo "Compose failed. Previous API image restored."
  exit 1
fi

rollback_api() {
  docker tag "$previous_tag" nt-next-api:local
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

new_id="$(docker image inspect nt-next-api:local --format '{{.Id}}')"
echo "Private API restarted from ${src_tag}. Public Nginx was not changed."
echo "Record POST_BUILD_DIGEST=${new_id} in deploy/private-release/release-pin.conf after owner review."
