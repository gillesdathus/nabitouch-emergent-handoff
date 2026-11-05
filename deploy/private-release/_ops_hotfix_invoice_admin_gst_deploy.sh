#!/usr/bin/env bash
# Hotfix: owner invoice void/waive/adjust/discard + optional GST on drafts.
# Deploys API + FE. Does not touch Nginx, Mongo volumes, Redis, Stripe, or env flags.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

HOTFIX_SHA="${HOTFIX_SHA:?Set HOTFIX_SHA to the invoice-admin-gst commit to deploy}"
SHORT="$(printf '%s' "$HOTFIX_SHA" | cut -c1-7)"
BRANCH="hotfix/invoice-admin-gst"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-invoice-admin-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-invoice-admin-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-${SHORT}"
PREV_TAG="nt-next-api:pre-invoice-admin-${SHORT}-${STAMP}"
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
test -f backend/billing.py
test -f frontend/src/components/billing/StaffInvoiceActions.jsx
test -f frontend/src/components/CreateInvoiceDialog.jsx
grep -q 'discard_draft_invoice\|@r.delete("/invoices/{iid}")' backend/billing.py
grep -q 'async def waive' backend/billing.py
grep -q 'chargeGst' backend/billing.py
grep -q 'voidInvoice\|waiveInvoice\|discardInvoice\|patchInvoice' frontend/src/lib/api.js
grep -q 'staff-void-open\|staff-waive-open\|staff-discard-draft-btn\|staff-draft-charge-gst' frontend/src/components/billing/StaffInvoiceActions.jsx
grep -q 'inv-charge-gst\|chargeGst' frontend/src/components/CreateInvoiceDialog.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-invoice-admin-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"
chmod 600 "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=invoice-admin-gst" \
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
if ! grep -Rql "staff-void-open\|staff-waive-open\|staff-discard-draft\|Charge GST\|inv-charge-gst" build/assets/*.js; then
  echo "Refusing: invoice admin / GST markers missing from build" >&2
  exit 2
fi

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-invoice-admin-${STAMP}.tar.gz"
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
curl -fsS -m 15 http://127.0.0.1:8011/openapi.json -o /tmp/openapi-invoice-admin.json
python3 - <<'PY'
import json
paths = json.load(open("/tmp/openapi-invoice-admin.json", encoding="utf-8"))["paths"]
need = (
    "/api/invoices/{iid}",
    "/api/invoices/{iid}/void",
    "/api/invoices/{iid}/waive",
    "/api/invoices/{iid}/adjustments",
)
for path in need:
    assert path in paths, path
methods = paths["/api/invoices/{iid}"]
assert "patch" in methods and "delete" in methods, list(methods)
assert "post" in paths["/api/invoices/{iid}/void"]
assert "post" in paths["/api/invoices/{iid}/waive"]
print("openapi-invoice-admin-ok")
PY

cat > "${BACKUP_DIR}/INVOICE_ADMIN_GST_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=invoice-admin-gst
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
chmod 600 "${BACKUP_DIR}/INVOICE_ADMIN_GST_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/INVOICE_ADMIN_GST_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP} sha=${HOTFIX_SHA} bundle=${BUNDLE}"
