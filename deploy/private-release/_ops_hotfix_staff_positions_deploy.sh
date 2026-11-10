#!/bin/bash
# Feature B: Owner Staff Management — roles vs positions + privilege safeguards.
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
SRC="${RELEASE_ROOT}/nt-hotfix-staff-positions-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-staff-positions-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-${SHORT}"
PREV_TAG="nt-next-api:pre-staff-positions-${SHORT}-${STAMP}"
LIVE="/var/www/nabitouch-next"
STAFF_HOTFIX_SHA="a451ab5"

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

echo "=== fetch Feature B source $HOTFIX_SHA ==="
rm -rf "$SRC"
git clone --filter=blob:none --no-checkout "$REPO" "$SRC"
cd "$SRC"
git fetch --depth 60 origin "$HOTFIX_SHA"
git checkout --detach "$HOTFIX_SHA"
test "$(git rev-parse HEAD)" = "$HOTFIX_SHA"
git merge-base --is-ancestor "$STAFF_HOTFIX_SHA" HEAD || true
test -f backend/staff_positions.py
grep -q "validate_role_assignment" backend/staff_positions.py
grep -q "staff/role-history" backend/auth.py
grep -q "Positions (display titles only)" frontend/src/pages/owner/Permissions.jsx
grep -q "staffRoleHistory" frontend/src/lib/api.js
grep -q 'form.kind !== "cpr"' frontend/src/pages/owner/Credentials.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-staff-positions-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=staff-positions" \
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

echo "=== seed Dathus display positions (roles unchanged) ==="
docker cp "$SRC/deploy/private-release/_ops_p0_seed_dathus_positions.py" nt-next-api:/tmp/_ops_p0_seed_dathus_positions.py
docker exec -e CONFIRM_P0_DATHUS_POSITIONS=yes nt-next-api python /tmp/_ops_p0_seed_dathus_positions.py

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
test -f build/index.html
grep -q "Staff & access\|Staff accounts\|display titles" build/assets/*.js || true

echo "=== publish frontend atomically ==="
STAGE="${LIVE}.stage-staff-positions-${STAMP}"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -a build/. "$STAGE/"
PREV_LIVE="${LIVE}.prev-staff-positions-${STAMP}"
rm -rf "$PREV_LIVE"
if [ -d "$LIVE" ]; then
  mv "$LIVE" "$PREV_LIVE"
fi
mv "$STAGE" "$LIVE"

echo "=== postchecks ==="
curl -fsS -m 5 http://127.0.0.1:8011/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"]=="ok"; print("api-health-ok")'
docker exec nt-next-api python -c 'import staff_positions; print("staff_positions-ok", staff_positions.POSITION_IDS)'
echo "DEPLOY_OK sha=$HOTFIX_SHA prev_api=$PREV_TAG fe_backup=$FE_TAR prev_fe=$PREV_LIVE"
echo "Rollback API: docker tag $PREV_TAG nt-next-api:local && docker compose -f $COMPOSE up -d --no-deps api"
echo "Rollback FE: rm -rf $LIVE && mv $PREV_LIVE $LIVE"
