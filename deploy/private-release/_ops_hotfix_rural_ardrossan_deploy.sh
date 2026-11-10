#!/bin/bash
# Hotfix: accept verified rural Ardrossan Range Road destination under radius coverage.
# Deploys API (+ FE static for Zones exception preservation). Does not touch Nginx, Mongo schema, Redis, or Stripe.
# Does not create paid appointments. Smoke uses geo/check + geo/confirm only.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

HOTFIX_SHA="${HOTFIX_SHA:?Set HOTFIX_SHA to the rural Ardrossan commit to deploy}"
SHORT="$(printf '%s' "$HOTFIX_SHA" | cut -c1-7)"
BRANCH="hotfix/rural-ardrossan-address"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-rural-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-rural-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-${SHORT}"
PREV_TAG="nt-next-api:pre-rural-${SHORT}-${STAMP}"
LIVE="/var/www/nabitouch-next"

mkdir -p "$RELEASE_ROOT" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "=== precheck live health ==="
LIVE_HEALTH="$(curl -fsS -m 5 http://127.0.0.1:8011/api/health)"
python3 - "$LIVE_HEALTH" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
assert data.get("status") == "ok" and data.get("mongo") == "ok" and data.get("redis") == "ok"
assert data.get("documentUploads") is False
print("live-health-ok cardCheckout=", data.get("cardCheckout"))
PY

echo "=== preserve current API image ==="
RUNNING_ID="$(docker inspect nt-next-api --format='{{.Image}}')"
echo "running=$RUNNING_ID"
docker tag nt-next-api:local "$PREV_TAG"
docker image inspect "$PREV_TAG" --format='prev={{.Id}}'

echo "=== fetch hotfix source $HOTFIX_SHA ==="
rm -rf "$SRC"
git clone --filter=blob:none --no-checkout "$REPO" "$SRC"
cd "$SRC"
git fetch --depth 1 origin "$HOTFIX_SHA"
git checkout --detach "$HOTFIX_SHA"
GOT="$(git rev-parse HEAD)"
test "$GOT" = "$HOTFIX_SHA"
test -f deploy/Dockerfile.api
test -f backend/addresses.py
test -f backend/pricing.py
grep -q "VERIFIED_DESTINATION_EXCEPTIONS" backend/pricing.py
grep -q "normalize_rural_query" backend/addresses.py
grep -q "destinationExceptions" frontend/src/pages/owner/Zones.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-rural-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"
chmod 600 "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=rural-ardrossan-address" \
  .
NEW_ID="$(docker image inspect "$SRC_TAG" --format='{{.Id}}')"
echo "NEW_ID=$NEW_ID"
docker tag "$SRC_TAG" nt-next-api:local

ENV_FILE="/etc/nabitouch-next.env"
set -a
# shellcheck disable=SC1091
. "$ENV_FILE"
set +a

rollback_api() {
  echo "Rolling back API to $PREV_TAG"
  docker tag "$PREV_TAG" nt-next-api:local
  set -a
  # shellcheck disable=SC1091
  . "$ENV_FILE"
  set +a
  docker compose -f "$COMPOSE" up -d --no-deps api
}

echo "=== recreate API only ==="
if ! docker compose -f "$COMPOSE" up -d --no-deps api; then
  rollback_api
  echo "Compose failed; rolled back"
  exit 1
fi

echo "=== API health retries ==="
health_ok=0
for _try in $(seq 1 40); do
  body="$(curl -fsS -m 5 http://127.0.0.1:8011/api/health || true)"
  if python3 - "$body" <<'PY'
import json, sys
data = json.loads(sys.argv[1] or "{}")
ok = (
    data.get("status") == "ok"
    and data.get("mongo") == "ok"
    and data.get("redis") == "ok"
    and data.get("documentUploads") is False
)
raise SystemExit(0 if ok else 1)
PY
  then
    echo "health-ok try=$_try body=$body"
    health_ok=1
    break
  fi
  sleep 3
done
if [ "$health_ok" -ne 1 ]; then
  rollback_api
  echo "Health failed; rolled back"
  exit 1
fi

echo "=== build frontend ==="
rm -rf "$FE_BUILD"
mkdir -p "$FE_BUILD"
cp -a "$SRC/frontend/." "$FE_BUILD/"
cd "$FE_BUILD"
set -a
# shellcheck disable=SC1091
. /etc/nabitouch-next.frontend.env
set +a
export REACT_APP_BACKEND_URL="${REACT_APP_BACKEND_URL:-https://nabitouch.com}"
export REACT_APP_TRACKING_MODE="${REACT_APP_TRACKING_MODE:-simulated}"
case "${REACT_APP_MAPBOX_PUBLIC_TOKEN:-}" in
  pk.*) ;;
  *) echo "Refusing Mapbox token" >&2; exit 2 ;;
esac
corepack yarn install --frozen-lockfile
corepack yarn build
BUNDLE="$(grep -oE '/assets/index-[^\" ]+\.js' build/index.html | head -1)"
test -n "$BUNDLE"
test -f "build${BUNDLE}"

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-rural-${STAMP}.tar.gz"
tar -C /var/www -czf "$STAGE_TAR" nabitouch-next
chmod 600 "$STAGE_TAR"
sha256sum "$STAGE_TAR" > "${STAGE_TAR}.sha256"
chmod 600 "${STAGE_TAR}.sha256"
rm -rf "$LIVE"
mkdir -p "$LIVE"
cp -a build/. "$LIVE/"
chmod -R a+rX "$LIVE"
PUB_BUNDLE="$(grep -oE '/assets/index-[^\" ]+\.js' "$LIVE/index.html" | head -1)"
test "$PUB_BUNDLE" = "$BUNDLE"

echo "=== public smoke (no paid booking) ==="
curl -fsS -m 10 https://nabitouch.com/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mongo"]=="ok" and d["documentUploads"] is False; print(d)'
curl -fsS -m 10 -o /dev/null -w 'home=%{http_code}\n' https://nabitouch.com/
curl -fsS -m 10 "https://nabitouch.com${BUNDLE}" -o /dev/null -w 'bundle=%{http_code}\n'

SMOKE_ABBREV="$(curl -fsS -m 25 -X POST https://nabitouch.com/api/geo/check -H 'Content-Type: application/json' -d '{"line":"53337 Rge Rd 215"}')"
SMOKE_FULL="$(curl -fsS -m 25 -X POST https://nabitouch.com/api/geo/check -H 'Content-Type: application/json' -d '{"line":"53337 Range Road 215, Ardrossan, AB T8E 2B2, Canada"}')"
SMOKE_YEG="$(curl -fsS -m 25 -X POST https://nabitouch.com/api/geo/check -H 'Content-Type: application/json' -d '{"line":"10150 104 St NW, Edmonton, AB"}')"
python3 - "$SMOKE_ABBREV" "$SMOKE_FULL" "$SMOKE_YEG" <<'PY'
import json, sys
abbrev, full, yeg = (json.loads(sys.argv[i]) for i in (1, 2, 3))
assert abbrev.get("eligible") is True, abbrev
assert full.get("eligible") is True, full
assert yeg.get("eligible") is True, yeg
assert "Range Road 215" in (abbrev.get("line") or "")
assert "Ardrossan" in (abbrev.get("line") or "")
assert abbrev.get("municipality", {}).get("name") == "Strathcona County"
confirm = {
    "line": abbrev["line"],
    "mapboxId": abbrev["mapboxId"],
    "postal": "T8E 2B2",
    "clientConfirmed": True,
}
print("geo-check-rural-ok", abbrev.get("km"), abbrev.get("coverageMode"), abbrev.get("travel"))
print("geo-check-edmonton-ok", yeg.get("km"), (yeg.get("zone") or {}).get("id"))
import urllib.request
req = urllib.request.Request(
    "https://nabitouch.com/api/geo/confirm",
    data=json.dumps(confirm).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=25) as resp:
    body = json.loads(resp.read().decode())
assert body.get("accepted") is True and body.get("eligible") is True, body
assert body.get("confidence") == "address", body
print("geo-confirm-rural-ok", body.get("line"))
PY

cat > "${BACKUP_DIR}/RURAL_ARDROSSAN_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=rural-ardrossan-address
hotfix_sha=${HOTFIX_SHA}
branch=${BRANCH}
frontend_backup=$(basename "$FE_TAR")
frontend_previous=$(basename "$STAGE_TAR")
frontend_bundle=${BUNDLE}
api_prev_tag=${PREV_TAG}
api_src_tag=${SRC_TAG}
api_new_id=${NEW_ID}
api_prev_id=${RUNNING_ID}
rollback=docker tag ${PREV_TAG} nt-next-api:local && docker compose -f ${COMPOSE} up -d --no-deps api
EOF
chmod 600 "${BACKUP_DIR}/RURAL_ARDROSSAN_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/RURAL_ARDROSSAN_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP}"
