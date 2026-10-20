#!/bin/bash
# Hotfix: practitioner Schedule workspace (Weekly Hours + Campaign Slots).
# Deploys FE static + recreates nt-next-api only. Does not touch Nginx, Mongo, Redis,
# Stripe settings, practitioner available/bookable flags, or campaign live status.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

# Tip of feature/practitioner-schedule-campaign-slots must include this ancestor.
REQUIRED_ANCESTOR="a656194"
BRANCH="feature/practitioner-schedule-campaign-slots"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-schedule-campaign-slots"
FE_BUILD="${RELEASE_ROOT}/fe-build-schedule-campaign-slots-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-schedule-campaign-slots-${STAMP}"
PREV_TAG="nt-next-api:pre-schedule-campaign-slots-${STAMP}"
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
RUNNING_BEFORE="$(docker inspect nt-next-api --format='{{.Image}}')"
echo "running=$RUNNING_BEFORE"
docker tag nt-next-api:local "$PREV_TAG"
docker image inspect "$PREV_TAG" --format='prev={{.Id}}'

echo "=== fetch hotfix source ==="
rm -rf "$SRC"
git clone --depth 40 --branch "$BRANCH" "$REPO" "$SRC"
cd "$SRC"
FULL_SHA="$(git rev-parse HEAD)"
echo "FULL_SHA=$FULL_SHA"
git merge-base --is-ancestor "$REQUIRED_ANCESTOR" HEAD || {
  echo "Refusing: tip $FULL_SHA does not contain schedule feature $REQUIRED_ANCESTOR"
  exit 2
}
grep -q "validate_campaign_blocks" backend/availability.py
grep -q "campaign-blocks" backend/availability.py
grep -q "CampaignSlotsEditor" frontend/src/pages/practitioner/Availability.jsx
grep -q "WeeklyHoursEditor" frontend/src/pages/practitioner/Availability.jsx
grep -q "saveCampaignBlocks" frontend/src/lib/api.js
grep -q "campaignId" frontend/src/pages/client/BookingSteps.jsx

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-schedule-campaign-slots-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"
chmod 600 "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$FULL_SHA" \
  --label "nabitouch.hotfix=schedule-campaign-slots" \
  .
NEW_BUILT="$(docker image inspect "$SRC_TAG" --format='{{.Id}}')"
docker tag "$SRC_TAG" nt-next-api:local

set -a
# shellcheck disable=SC1091
. /etc/nabitouch-next.env
set +a

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

health_ok=0
for _try in $(seq 1 40); do
  body="$(curl -fsS -m 5 http://127.0.0.1:8011/api/health || true)"
  echo "try=${_try} ${body}"
  if python3 -c 'import json,sys; d=json.loads(sys.argv[1] or "{}"); raise SystemExit(0 if d.get("status")=="ok" and d.get("mongo")=="ok" and d.get("redis")=="ok" and d.get("documentUploads") is False else 1)' "$body"; then
    health_ok=1
    break
  fi
  sleep 3
done
if [ "$health_ok" -ne 1 ]; then
  rollback_api
  exit 1
fi
NEW_ID="$(docker inspect nt-next-api --format='{{.Image}}')"

echo "=== verify campaign-block helpers in container (no flag flips) ==="
docker exec -i nt-next-api python - <<'PY'
from availability import (
    TRIAL_CAMPAIGN_ID,
    draft_schedule,
    interval_open,
    reserved_by_campaign,
    validate_campaign_blocks,
)
from pricing import minutes

blocks = validate_campaign_blocks([
    {
        "campaignId": TRIAL_CAMPAIGN_ID,
        "mode": "recurring",
        "weekdays": [5],
        "start": "10:00",
        "end": "14:00",
        "open": True,
    }
], practitioner_id="p-1")
assert len(blocks) == 1
sched = draft_schedule("p-1")
sched["weekly"] = [{"weekday": d, "start": "09:00", "end": "17:00"} for d in range(7)]
sched["campaignBlocks"] = blocks
assert interval_open(sched, "2026-06-20", minutes("10:00"), 10, campaign=True) is True
assert reserved_by_campaign(sched, "2026-06-20", minutes("10:00"), minutes("10:10")) is True
assert interval_open(sched, "2026-06-20", minutes("10:00"), 60) is False
print("api-campaign-slots-ok")
PY

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
if ! grep -Rql "weekly-hours-editor\|campaign-slots-editor\|Save Campaign Slots\|Save Schedule" build/assets/*.js; then
  echo "Refusing: schedule / campaign slots UI missing from build" >&2
  exit 2
fi
test -f build/sw.js

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-schedule-campaign-slots-${STAMP}.tar.gz"
tar -C /var/www -czf "$STAGE_TAR" nabitouch-next
chmod 600 "$STAGE_TAR"
sha256sum "$STAGE_TAR" | tee "${STAGE_TAR}.sha256"
chmod 600 "${STAGE_TAR}.sha256"
rm -rf "$LIVE"
mkdir -p "$LIVE"
cp -a build/. "$LIVE/"
chmod -R a+rX "$LIVE"

curl -fsS -m 10 https://nabitouch.com/api/health
echo
curl -fsS -m 10 -o /dev/null -w 'home=%{http_code}\n' https://nabitouch.com/
curl -fsS -m 10 "https://nabitouch.com${BUNDLE}" -o /dev/null -w 'bundle=%{http_code}\n'

echo "=== confirm Nabitu booking flags unchanged by this deploy script ==="
docker exec -i nt-next-api python - <<'PY'
import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME") or "nabitouch_prod"]
    person = await db.nt_practitioners.find_one({"id": "p-nabitu-kahindo"}, {"_id": 0, "available": 1, "bookable": 1, "onboardingStatus": 1})
    print("nabitu_flags", person)
    # Read-only assertion of presence; do not mutate.
    assert person is not None
    client.close()

asyncio.run(main())
PY

cat > "${BACKUP_DIR}/SCHEDULE_CAMPAIGN_SLOTS_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=practitioner-schedule-campaign-slots
hotfix_sha=${FULL_SHA}
required_ancestor=${REQUIRED_ANCESTOR}
frontend_previous=$(basename "$STAGE_TAR")
frontend_live_backup=$(basename "$FE_TAR")
frontend_bundle=${BUNDLE}
api_prev_tag=${PREV_TAG}
api_src_tag=${SRC_TAG}
api_new_id=${NEW_ID}
api_before_id=${RUNNING_BEFORE}
api_built_id=${NEW_BUILT}
EOF
chmod 600 "${BACKUP_DIR}/SCHEDULE_CAMPAIGN_SLOTS_${STAMP}.manifest"
cat "${BACKUP_DIR}/SCHEDULE_CAMPAIGN_SLOTS_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP}"
