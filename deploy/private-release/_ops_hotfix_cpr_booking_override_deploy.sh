#!/bin/bash
# Hotfix: temporary CPR booking override + CPR credential kind lists on forms.
# Deploys API + FE static. Does not touch Nginx, Mongo volumes, Redis, or Stripe.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

HOTFIX_SHA="${HOTFIX_SHA:?Set HOTFIX_SHA to the CPR override commit to deploy}"
SHORT="$(printf '%s' "$HOTFIX_SHA" | cut -c1-7)"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-cpr-override-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-cpr-override-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-${SHORT}"
PREV_TAG="nt-next-api:pre-cpr-override-${SHORT}-${STAMP}"
LIVE="/var/www/nabitouch-next"
RURAL_SHA="9ded0fb3277e6f7bbf394f1fd198f475c1a136c2"

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
git fetch --depth 30 origin "$HOTFIX_SHA"
git checkout --detach "$HOTFIX_SHA"
GOT="$(git rev-parse HEAD)"
test "$GOT" = "$HOTFIX_SHA"
git merge-base --is-ancestor "$RURAL_SHA" HEAD
test -f deploy/Dockerfile.api
grep -q "active_credential_booking_override" backend/onboarding.py
grep -q "credential-booking-override" backend/availability.py
grep -q "overrideCleared" backend/clinical.py
grep -q '\["cpr", "CPR / First Aid"\]' frontend/src/pages/owner/Credentials.jsx
grep -q '\["cpr", "CPR / First Aid"\]' frontend/src/components/practitioner/ProfileParts.jsx
grep -q '\["cpr", "CPR / First Aid"\]' frontend/src/pages/practitioner/Profile.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-cpr-override-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"
chmod 600 "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=cpr-booking-override" \
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
if [ "$health_ok" != "1" ]; then
  rollback_api
  echo "API health failed; rolled back"
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

echo "=== assert CPR in built chunks ==="
python3 - <<'PY'
from pathlib import Path
assets = Path("build/assets")
owner = list(assets.glob("Credentials-*.js"))
assert owner and "CPR / First Aid" in owner[0].read_text(encoding="utf-8", errors="ignore")
assert '"cpr"' in owner[0].read_text(encoding="utf-8", errors="ignore")
hits = []
for path in assets.glob("*.js"):
    text = path.read_text(encoding="utf-8", errors="ignore")
    if '"cpr"' in text and "CPR / First Aid" in text and (
        "pr-cred-kind" in text or "credential-kind" in text or "pro-credential" in text
    ):
        hits.append(path.name)
print("owner_chunk", owner[0].name)
print("cpr_form_chunks", hits)
assert hits, "CPR kind missing from credential form chunks"
PY

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-cpr-override-${STAMP}.tar.gz"
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
curl -fsS -m 10 https://nabitouch.com/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mongo"]=="ok"; print(d)'
curl -fsS -m 10 -o /dev/null -w 'home=%{http_code}\n' https://nabitouch.com/
curl -fsS -m 10 "https://nabitouch.com${BUNDLE}" -o /dev/null -w 'bundle=%{http_code}\n'
python3 /tmp/_ops_p0_fe_cpr_scan.py

cat > "${BACKUP_DIR}/CPR_BOOKING_OVERRIDE_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=cpr-booking-override
source_sha=${HOTFIX_SHA}
api_prev=${PREV_TAG}
api_src=${SRC_TAG}
frontend_backup=$(basename "$FE_TAR")
frontend_previous=$(basename "$STAGE_TAR")
frontend_bundle=${BUNDLE}
note=Temporary CPR booking override API + CPR kind on owner/practitioner credential forms. Existing credential statuses unchanged.
EOF
chmod 600 "${BACKUP_DIR}/CPR_BOOKING_OVERRIDE_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/CPR_BOOKING_OVERRIDE_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP} sha=${HOTFIX_SHA} bundle=${BUNDLE}"
