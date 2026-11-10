#!/bin/bash
# Hotfix A: staff vs practitioner separation + Dathus role correction support.
# Deploys API + FE. Does not touch Nginx, Mongo volumes, Redis, or Stripe.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

HOTFIX_SHA="${HOTFIX_SHA:?Set HOTFIX_SHA}"
SHORT="$(printf '%s' "$HOTFIX_SHA" | cut -c1-7)"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-dathus-roles-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-dathus-roles-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-${SHORT}"
PREV_TAG="nt-next-api:pre-dathus-roles-${SHORT}-${STAMP}"
LIVE="/var/www/nabitouch-next"
CPR_SHA="d295914d0178b4451803f95ba986bf99fa78745e"

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
docker tag nt-next-api:local "$PREV_TAG"
docker image inspect "$PREV_TAG" --format='prev={{.Id}}'

echo "=== fetch hotfix source $HOTFIX_SHA ==="
rm -rf "$SRC"
git clone --filter=blob:none --no-checkout "$REPO" "$SRC"
cd "$SRC"
git fetch --depth 40 origin "$HOTFIX_SHA"
git checkout --detach "$HOTFIX_SHA"
test "$(git rev-parse HEAD)" = "$HOTFIX_SHA"
git merge-base --is-ancestor "$CPR_SHA" HEAD
grep -q "public_therapist_listing_eligible" backend/profiles.py
grep -q 'onboardingStatus === "invited"' frontend/src/lib/domain.js
grep -q "publiclyBookable" frontend/src/pages/client/Practitioners.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-dathus-roles-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=dathus-staff-roles" \
  .
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

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-dathus-roles-${STAMP}.tar.gz"
tar -C /var/www -czf "$STAGE_TAR" nabitouch-next
chmod 600 "$STAGE_TAR"
rm -rf "$LIVE"
mkdir -p "$LIVE"
cp -a build/. "$LIVE/"
chmod -R a+rX "$LIVE"

curl -fsS -m 10 https://nabitouch.com/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mongo"]=="ok"; print(d)'
curl -fsS -m 10 -o /dev/null -w 'home=%{http_code}\n' https://nabitouch.com/

cat > "${BACKUP_DIR}/DATHUS_STAFF_ROLES_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=dathus-staff-roles
source_sha=${HOTFIX_SHA}
api_prev=${PREV_TAG}
api_src=${SRC_TAG}
frontend_backup=$(basename "$FE_TAR")
frontend_previous=$(basename "$STAGE_TAR")
frontend_bundle=${BUNDLE}
note=Public therapist listing eligibility + invited/orphan visibility fix. Apply data script separately.
EOF
chmod 600 "${BACKUP_DIR}/DATHUS_STAFF_ROLES_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/DATHUS_STAFF_ROLES_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP} sha=${HOTFIX_SHA} bundle=${BUNDLE}"
