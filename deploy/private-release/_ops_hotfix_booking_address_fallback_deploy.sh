#!/usr/bin/env bash
# Hotfix: Edmonton GIS fallback for Mapbox-missing civic addresses + address review path.
# Deploys API + FE. Does not touch Nginx, Mongo volumes, Redis, Stripe, or env flags.
# Smoke uses geo/suggest + geo/check + geo/confirm only — no paid appointments.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

HOTFIX_SHA="${HOTFIX_SHA:?Set HOTFIX_SHA to the booking-address-fallback commit to deploy}"
SHORT="$(printf '%s' "$HOTFIX_SHA" | cut -c1-7)"
BRANCH="fix/booking-address-fallback-20261105"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-address-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-address-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-${SHORT}"
PREV_TAG="nt-next-api:pre-address-${SHORT}-${STAMP}"
LIVE="/var/www/nabitouch-next"
ENV_FILE="/etc/nabitouch-next.env"

mkdir -p "$RELEASE_ROOT" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "=== precheck live health ==="
LIVE_HEALTH="$(curl -fsS -m 5 http://127.0.0.1:8011/api/health)"
python3 - "$LIVE_HEALTH" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
assert data.get("status") == "ok" and data.get("mongo") == "ok" and data.get("redis") == "ok"
assert data.get("documentUploads") is False
print("live-health-ok")
PY

echo "=== preserve current API image ==="
RUNNING_ID="$(docker inspect nt-next-api --format='{{.Image}}')"
docker tag nt-next-api:local "$PREV_TAG"
docker image inspect "$PREV_TAG" --format='prev={{.Id}}'

echo "=== fetch hotfix source $HOTFIX_SHA ==="
rm -rf "$SRC"
git clone --filter=blob:none --no-checkout "$REPO" "$SRC"
cd "$SRC"
git fetch --depth 40 origin "$HOTFIX_SHA"
git checkout --detach "$HOTFIX_SHA"
test "$(git rev-parse HEAD)" = "$HOTFIX_SHA"
test -f backend/edmonton_geo.py
test -f backend/addresses.py
test -f backend/geo.py
test -f frontend/src/components/AddressPicker.jsx
grep -q 'find_candidates' backend/edmonton_geo.py
grep -q 'edmonton_find\|EDMONTON_ID_PREFIX\|civic_suggestion_compatible' backend/geo.py
grep -q 'provider") in ("local", "mapbox", "edmonton")' backend/addresses.py
grep -q 'geo/address-review' backend/server.py
grep -q 'geoAddressReview' frontend/src/lib/api.js
grep -q 'Request Address Review' frontend/src/components/AddressPicker.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-address-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"
chmod 600 "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=booking-address-fallback" \
  .
NEW_ID="$(docker image inspect "$SRC_TAG" --format='{{.Id}}')"
echo "NEW_ID=$NEW_ID"
docker tag "$SRC_TAG" nt-next-api:local

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
  if python3 -c 'import json,sys; d=json.loads(sys.argv[1] or "{}"); raise SystemExit(0 if d.get("status")=="ok" and d.get("mongo")=="ok" and d.get("redis")=="ok" and d.get("documentUploads") is False else 1)' "$body"; then
    echo "health-ok try=$_try"
    health_ok=1
    break
  fi
  sleep 3
done
if [ "$health_ok" != "1" ]; then
  rollback_api
  echo "Health failed; rolled back"
  exit 1
fi
LIVE_API_ID="$(docker inspect nt-next-api --format='{{.Image}}')"
LIVE_SHA="$(docker inspect nt-next-api --format='{{index .Config.Labels "nabitouch.source_sha"}}')"
test "$LIVE_SHA" = "$HOTFIX_SHA"

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
if ! grep -Rql "Request Address Review\|geo/address-review\|address-review" build/assets/*.js; then
  echo "Refusing: address review markers missing from build" >&2
  exit 2
fi

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-address-${STAMP}.tar.gz"
tar -C /var/www -czf "$STAGE_TAR" nabitouch-next
chmod 600 "$STAGE_TAR"
sha256sum "$STAGE_TAR" | tee "${STAGE_TAR}.sha256"
chmod 600 "${STAGE_TAR}.sha256"
rm -rf "$LIVE"
mkdir -p "$LIVE"
cp -a build/. "$LIVE/"
chmod -R a+rX "$LIVE"
PUB_BUNDLE="$(grep -oE '/assets/index-[^\" ]+\.js' "$LIVE/index.html" | head -1)"
test "$PUB_BUNDLE" = "$BUNDLE"

echo "=== public smoke ==="
curl -fsS -m 10 https://nabitouch.com/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mongo"]=="ok" and d["documentUploads"] is False; print(d)'
curl -fsS -m 10 -o /dev/null -w 'home=%{http_code}\n' https://nabitouch.com/
curl -fsS -m 10 "https://nabitouch.com${BUNDLE}" -o /dev/null -w 'bundle=%{http_code}\n'

echo "=== address smoke (no booking) ==="
SMOKE_Q="$(python3 -c 'import urllib.parse; print(urllib.parse.quote("6805 176A Avenue NW, Edmonton"))')"
SMOKE_SUGGEST="$(curl -fsS -m 25 "https://nabitouch.com/api/geo/suggest?q=${SMOKE_Q}")"
SMOKE_CHECK="$(curl -fsS -m 25 -X POST https://nabitouch.com/api/geo/check -H 'Content-Type: application/json' -d '{"line":"6805 176A Avenue NW, Edmonton, AB T5Z 0Y2"}')"
SMOKE_RURAL="$(curl -fsS -m 25 -X POST https://nabitouch.com/api/geo/check -H 'Content-Type: application/json' -d '{"line":"53337 Rge Rd 215"}')"
SMOKE_YEG="$(curl -fsS -m 25 -X POST https://nabitouch.com/api/geo/check -H 'Content-Type: application/json' -d '{"line":"10150 104 St NW, Edmonton, AB"}')"
python3 - "$SMOKE_SUGGEST" "$SMOKE_CHECK" "$SMOKE_RURAL" "$SMOKE_YEG" <<'PY'
import json, sys, urllib.request
suggest, check, rural, yeg = (json.loads(sys.argv[i]) for i in (1, 2, 3, 4))
rows = suggest.get("suggestions") or []
assert rows, suggest
assert any("6805" in (row.get("label") or "") and "176a" in (row.get("label") or "").casefold() for row in rows), rows
assert not any("winfield" in (row.get("label") or "").casefold() for row in rows), rows
assert check.get("eligible") is True, check
assert "6805" in (check.get("line") or "")
assert "176a" in (check.get("line") or "").casefold()
assert abs(float(check["lat"]) - 53.63966) < 0.01
assert abs(float(check["lng"]) + 113.44484) < 0.01
assert rural.get("eligible") is True, rural
assert yeg.get("eligible") is True, yeg
confirm = {
    "line": check["line"],
    "mapboxId": check.get("mapboxId") or "",
    "postal": "T5Z 0Y2",
    "clientConfirmed": True,
}
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
assert body.get("postalStatus") in ("match", "supplied"), body
print("geo-suggest-176a-ok", rows[0].get("label"))
print("geo-check-176a-ok", check.get("km"), check.get("travel"), check.get("mapboxId"))
print("geo-confirm-176a-ok", body.get("line"), body.get("provider"))
print("geo-check-rural-ok", rural.get("line"))
print("geo-check-downtown-ok", yeg.get("line"))
PY

# OpenAPI includes address-review; do not create a live inquiry during deploy.
curl -fsS -m 15 http://127.0.0.1:8011/openapi.json -o /tmp/openapi-address.json
python3 - <<'PY'
import json
paths = json.load(open("/tmp/openapi-address.json", encoding="utf-8"))["paths"]
assert "/api/geo/address-review" in paths, sorted(k for k in paths if "geo" in k)
assert "post" in paths["/api/geo/address-review"]
print("openapi-address-review-ok")
PY

cat > "${BACKUP_DIR}/BOOKING_ADDRESS_FALLBACK_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=booking-address-fallback
hotfix_sha=${HOTFIX_SHA}
branch=${BRANCH}
frontend_backup=$(basename "$FE_TAR")
frontend_previous=$(basename "$STAGE_TAR")
frontend_bundle=${BUNDLE}
api_prev_tag=${PREV_TAG}
api_src_tag=${SRC_TAG}
api_new_id=${LIVE_API_ID}
api_prev_id=${RUNNING_ID}
rollback=docker tag ${PREV_TAG} nt-next-api:local && docker compose -f ${COMPOSE} up -d --no-deps api
EOF
chmod 600 "${BACKUP_DIR}/BOOKING_ADDRESS_FALLBACK_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/BOOKING_ADDRESS_FALLBACK_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP} sha=${HOTFIX_SHA} bundle=${BUNDLE}"
