#!/usr/bin/env bash
# Hotfix: WELCOME20 on standalone manual invoices + void/discard claim release +
# client-address persistence for desk create/booking flows.
# Deploys API + FE. Does not touch Nginx, Mongo volumes, Redis, Stripe, or env flags.
# Does not reset or overwrite production data.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

HOTFIX_SHA="${HOTFIX_SHA:?Set HOTFIX_SHA to the manual-invoice-welcome20 commit to deploy}"
SHORT="$(printf '%s' "$HOTFIX_SHA" | cut -c1-7)"
BRANCH="hotfix/manual-invoice-welcome20-20261110"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-welcome20-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-welcome20-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-${SHORT}"
PREV_TAG="nt-next-api:pre-welcome20-${SHORT}-${STAMP}"
LIVE="/var/www/nabitouch-next"
ENV_FILE="/etc/nabitouch-next.env"
MONGO_BACKUP="${BACKUP_DIR}/mongo-before-welcome20-${STAMP}.archive.gz"

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

echo "=== backup Mongo (logical dump; does not reset data) ==="
# Prefer the compose Mongo service; fall back to named container if present.
MONGO_CID="$(docker compose -f "$COMPOSE" ps -q mongo 2>/dev/null || true)"
if [ -z "$MONGO_CID" ]; then
  MONGO_CID="$(docker ps -qf 'name=mongo' | head -1 || true)"
fi
if [ -z "$MONGO_CID" ]; then
  echo "Refusing: Mongo container not found for backup" >&2
  exit 2
fi
docker exec "$MONGO_CID" sh -c 'mongodump --archive --gzip' > "$MONGO_BACKUP"
chmod 600 "$MONGO_BACKUP"
sha256sum "$MONGO_BACKUP" | tee "${MONGO_BACKUP}.sha256"
chmod 600 "${MONGO_BACKUP}.sha256"
test -s "$MONGO_BACKUP"

echo "=== fetch hotfix source $HOTFIX_SHA ==="
rm -rf "$SRC"
git clone --filter=blob:none --no-checkout "$REPO" "$SRC"
cd "$SRC"
git fetch --depth 40 origin "$HOTFIX_SHA"
git checkout --detach "$HOTFIX_SHA"
test "$(git rev-parse HEAD)" = "$HOTFIX_SHA"
test -f backend/billing.py
test -f frontend/src/components/CreateInvoiceDialog.jsx
grep -q 'release_invoice_welcome' backend/billing.py
grep -q 'welcome_invoice_status\|discount_mode == "welcome20"' backend/billing.py
grep -q 'inv-welcome20-option\|discountMode === "welcome20"' frontend/src/components/CreateInvoiceDialog.jsx
grep -q 'clientConfirmed\|persistClientAddresses\|addresses' backend/client_admin.py frontend/src/components/clients/CreateClientDialog.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-welcome20-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"
chmod 600 "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=manual-invoice-welcome20" \
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
if ! grep -Rql "inv-welcome20-option\|WELCOME20\|First Booking" build/assets/*.js; then
  echo "Refusing: WELCOME20 invoice markers missing from build" >&2
  exit 2
fi

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-welcome20-${STAMP}.tar.gz"
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

echo "=== OpenAPI route smoke ==="
curl -fsS -m 15 http://127.0.0.1:8011/openapi.json -o /tmp/openapi-welcome20.json
python3 - <<'PY'
import json
paths = json.load(open("/tmp/openapi-welcome20.json", encoding="utf-8"))["paths"]
need = (
    "/api/invoices",
    "/api/invoices/welcome-eligibility",
    "/api/invoices/{iid}/void",
)
for path in need:
    assert path in paths, path
assert "get" in paths["/api/invoices/welcome-eligibility"]
assert "post" in paths["/api/invoices"]
print("openapi-welcome20-ok")
PY

cat > "${BACKUP_DIR}/MANUAL_INVOICE_WELCOME20_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=manual-invoice-welcome20
hotfix_sha=${HOTFIX_SHA}
branch=${BRANCH}
mongo_backup=$(basename "$MONGO_BACKUP")
frontend_backup=$(basename "$FE_TAR")
frontend_previous=$(basename "$STAGE_TAR")
frontend_bundle=${BUNDLE}
api_prev_tag=${PREV_TAG}
api_src_tag=${SRC_TAG}
api_new_id=${LIVE_API_ID}
api_prev_id=${RUNNING_ID}
rollback=docker tag ${PREV_TAG} nt-next-api:local && docker compose -f ${COMPOSE} up -d --no-deps api
EOF
chmod 600 "${BACKUP_DIR}/MANUAL_INVOICE_WELCOME20_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/MANUAL_INVOICE_WELCOME20_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP} sha=${HOTFIX_SHA} bundle=${BUNDLE}"
