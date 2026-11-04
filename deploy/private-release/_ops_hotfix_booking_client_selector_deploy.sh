#!/bin/bash
# Hotfix: unified searchable Client Selector in phone/front-desk booking.
# Frontend static only. Does not rebuild API, Mongo, Redis, Nginx, or Stripe.
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
SRC="${RELEASE_ROOT}/nt-hotfix-booking-client-selector-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-booking-client-selector-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
LIVE="/var/www/nabitouch-next"
BASELINE_SHA="f3cca64"

mkdir -p "$RELEASE_ROOT" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "=== precheck live health ==="
LIVE_HEALTH="$(curl -fsS -m 5 http://127.0.0.1:8011/api/health)"
python3 - "$LIVE_HEALTH" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
assert data.get("status") == "ok" and data.get("mongo") == "ok" and data.get("redis") == "ok"
print("live-health-ok")
PY

echo "=== fetch hotfix source $HOTFIX_SHA ==="
rm -rf "$SRC"
git clone --filter=blob:none --no-checkout "$REPO" "$SRC"
cd "$SRC"
git fetch --depth 80 origin "$HOTFIX_SHA"
git checkout --detach "$HOTFIX_SHA"
test "$(git rev-parse HEAD)" = "$HOTFIX_SHA"
git merge-base --is-ancestor "$BASELINE_SHA" HEAD
grep -q "ClientSelector" frontend/src/components/NewBookingDialog.jsx
test -f frontend/src/components/clients/ClientSelector.jsx
grep -q "nb-client-selected\|testidPrefix" frontend/src/components/clients/ClientSelector.jsx
! grep -q "Or create a patient" frontend/src/components/NewBookingDialog.jsx
! grep -q 'data-testid="nb-client-select"' frontend/src/components/NewBookingDialog.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-booking-client-selector-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"

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
if ! grep -Rql "nb-client-selected\|ClientSelector\|Find client" build/assets/*.js; then
  echo "Refusing: client selector UI missing from build" >&2
  exit 2
fi
if grep -Rql "Or create a patient" build/assets/*.js; then
  echo "Refusing: legacy always-visible create patient form still in build" >&2
  exit 2
fi

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-booking-client-selector-${STAMP}.tar.gz"
tar -C /var/www -czf "$STAGE_TAR" nabitouch-next
chmod 600 "$STAGE_TAR"
rm -rf "$LIVE"
mkdir -p "$LIVE"
cp -a build/. "$LIVE/"
chmod -R a+rX "$LIVE"

curl -fsS -m 10 https://nabitouch.com/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mongo"]=="ok"; print(d)'
curl -fsS -m 10 -o /dev/null -w 'home=%{http_code}\n' https://nabitouch.com/
curl -fsS -m 10 "https://nabitouch.com${BUNDLE}" -o /dev/null -w 'bundle=%{http_code}\n'

cat > "${BACKUP_DIR}/BOOKING_CLIENT_SELECTOR_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=booking-client-selector
source_sha=${HOTFIX_SHA}
frontend_backup=$(basename "$FE_TAR")
frontend_previous=$(basename "$STAGE_TAR")
frontend_bundle=${BUNDLE}
note=Unified searchable ClientSelector in NewBookingDialog. Removed redundant dropdown and always-visible create form.
EOF
chmod 600 "${BACKUP_DIR}/BOOKING_CLIENT_SELECTOR_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/BOOKING_CLIENT_SELECTOR_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP} sha=${HOTFIX_SHA} bundle=${BUNDLE}"
