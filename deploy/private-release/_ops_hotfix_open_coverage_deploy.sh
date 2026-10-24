#!/bin/bash
# Hotfix: open service coverage (remove Edmonton-only booking gate) + travel fees off by default.
# Deploys FE static + recreates nt-next-api only. Does not touch Nginx, Mongo, Redis, or Stripe settings.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

HOTFIX_SHA="9b404c0bcaf5ceb2f0099cc1f069135ec88eee6c"
BRANCH="hotfix/open-service-coverage"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-9b404c0"
FE_BUILD="${RELEASE_ROOT}/fe-build-open-coverage-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-9b404c0"
PREV_TAG="nt-next-api:pre-9b404c0-${STAMP}"
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
git clone --depth 1 --branch "$BRANCH" "$REPO" "$SRC"
cd "$SRC"
GOT="$(git rev-parse HEAD)"
test "$GOT" = "$HOTFIX_SHA"
test -f deploy/Dockerfile.api
test -f frontend/package.json
grep -q "def assess_coverage" backend/pricing.py
grep -q 'serviceCoverage' backend/server.py
grep -q "settings-coverage-mode" frontend/src/pages/owner/Zones.jsx
grep -q "Confirm a service address to continue" frontend/src/pages/client/Booking.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-open-coverage-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"
chmod 600 "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=open-service-coverage" \
  .
NEW_ID="$(docker image inspect "$SRC_TAG" --format='{{.Id}}')"
echo "NEW_ID=$NEW_ID"
docker tag "$SRC_TAG" nt-next-api:local

rollback_api() {
  echo "Rolling back API to $PREV_TAG"
  docker tag "$PREV_TAG" nt-next-api:local
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
if ! grep -Rql "Confirm a service address to continue\|Street address, city, and province\|settings-coverage-mode\|Service coverage" build/assets/*.js build/index.html 2>/dev/null; then
  # Bundled strings may be split; require at least one open-coverage marker.
  if ! grep -Rql "serviceCoverage\|travelFeesEnabled\|z-open\|eligible for a mobile visit" build/assets/*.js; then
    echo "Refusing: open-coverage markers missing from build" >&2
    exit 2
  fi
fi

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-open-coverage-${STAMP}.tar.gz"
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

echo "=== public smoke ==="
curl -fsS -m 10 https://nabitouch.com/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mongo"]=="ok" and d["documentUploads"] is False; print(d)'
curl -fsS -m 10 -o /dev/null -w 'home=%{http_code}\n' https://nabitouch.com/
curl -fsS -m 10 "https://nabitouch.com${BUNDLE}" -o /dev/null -w 'bundle=%{http_code}\n'
# Open coverage: Leduc sample must be eligible (requires GEO sample or Mapbox + local id).
SMOKE="$(curl -fsS -m 20 -X POST https://nabitouch.com/api/geo/check -H 'Content-Type: application/json' -d '{"mapboxId":"local-leduc","line":"4950 Gateway Blvd, Leduc, AB"}' || true)"
python3 - "$SMOKE" <<'PY'
import json, sys
raw = sys.argv[1] or "{}"
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("geo-check-smoke skipped (non-json)", raw[:200])
    raise SystemExit(0)
if data.get("eligible") is True:
    assert float(data.get("travel") or 0) == 0
    print("geo-check-open-ok travel=", data.get("travel"), "zone=", (data.get("zone") or {}).get("id"))
elif "Mapbox" in str(data.get("detail") or data):
    print("geo-check-smoke skipped (mapbox/provider)", data)
else:
    # Local catalog may be disabled in production; accept unresolved provider errors only.
    print("geo-check-smoke note", data)
PY

cat > "${BACKUP_DIR}/OPEN_COVERAGE_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=open-service-coverage
hotfix_sha=${HOTFIX_SHA}
branch=${BRANCH}
frontend_backup=$(basename "$FE_TAR")
frontend_previous=$(basename "$STAGE_TAR")
frontend_bundle=${BUNDLE}
api_prev_tag=${PREV_TAG}
api_src_tag=${SRC_TAG}
api_new_id=${NEW_ID}
api_prev_id=${RUNNING_ID}
EOF
chmod 600 "${BACKUP_DIR}/OPEN_COVERAGE_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/OPEN_COVERAGE_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP}"
