#!/bin/bash
# Hotfix: record completed treatments (historical / on-the-spot) without prior booking.
# Deploys API + FE. Does not touch Nginx, Mongo volumes, Redis, Stripe, or travel fees.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

HOTFIX_SHA="${HOTFIX_SHA:?Set HOTFIX_SHA}"
SHORT="$(printf '%s' "$HOTFIX_SHA" | cut -c1-7)"
BRANCH="hotfix/dathus-staff-roles"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-completed-tx-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-completed-tx-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-${SHORT}"
PREV_TAG="nt-next-api:pre-completed-tx-${SHORT}-${STAMP}"
LIVE="/var/www/nabitouch-next"

mkdir -p "$RELEASE_ROOT" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "=== precheck live health ==="
LIVE_HEALTH="$(curl -fsS -m 5 http://127.0.0.1:8011/api/health)"
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d.get("status")=="ok" and d.get("mongo")=="ok" and d.get("redis")=="ok" and d.get("documentUploads") is False; print("live-health-ok")' "$LIVE_HEALTH"

echo "=== preserve current API image ==="
RUNNING_ID="$(docker inspect nt-next-api --format='{{.Image}}')"
docker tag nt-next-api:local "$PREV_TAG"

echo "=== fetch hotfix source $HOTFIX_SHA ==="
rm -rf "$SRC"
git clone --filter=blob:none --no-checkout "$REPO" "$SRC"
cd "$SRC"
git fetch --depth 40 origin "$HOTFIX_SHA"
git checkout --detach "$HOTFIX_SHA"
test "$(git rev-parse HEAD)" = "$HOTFIX_SHA"
test -f backend/historical_treatment.py
grep -q 'treatments/completed' backend/server.py
grep -q 'RecordCompletedTreatmentDialog' frontend/src/pages/owner/Dashboard.jsx
grep -q 'recordCompletedTreatment' frontend/src/lib/api.js

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-completed-tx-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=completed-treatment-record" \
  .
docker tag "$SRC_TAG" nt-next-api:local

ENV_FILE="/etc/nabitouch-next.env"
set -a
# shellcheck disable=SC1091
. "$ENV_FILE"
set +a

rollback_api() {
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
  exit 1
fi

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
  exit 1
fi
LIVE_API_ID="$(docker inspect nt-next-api --format='{{.Image}}')"

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
if ! grep -Rql 'record-completed-treatment-dialog\|rct-step-client\|rct-save' build/assets/*.js; then
  echo "Refusing: completed-treatment UI markers missing" >&2
  exit 2
fi

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-completed-tx-${STAMP}.tar.gz"
tar -C /var/www -czf "$STAGE_TAR" nabitouch-next
chmod 600 "$STAGE_TAR"
rm -rf "$LIVE"
mkdir -p "$LIVE"
cp -a build/. "$LIVE/"
chmod -R a+rX "$LIVE"

curl -fsS -m 10 https://nabitouch.com/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mongo"]=="ok"; print(d)'
curl -fsS -m 10 -o /dev/null -w 'home=%{http_code}\n' https://nabitouch.com/
curl -fsS -m 10 "https://nabitouch.com${BUNDLE}" -o /dev/null -w 'bundle=%{http_code}\n'

# Module import smoke inside the API container
docker exec nt-next-api python -c 'import historical_treatment; from rbac import is_completed_treatment_source; assert is_completed_treatment_source("historical_manual"); print("module-ok")'

cat > "${BACKUP_DIR}/COMPLETED_TREATMENT_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=completed-treatment-record
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
chmod 600 "${BACKUP_DIR}/COMPLETED_TREATMENT_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/COMPLETED_TREATMENT_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP} sha=${HOTFIX_SHA} bundle=${BUNDLE}"
