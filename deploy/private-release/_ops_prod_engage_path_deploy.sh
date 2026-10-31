#!/usr/bin/env bash
# Production Engage path launch: API + static frontend for https://nabitouch.com/engage
# Forces ENGAGE_WRITES_ENABLED=false. Leaves ENGAGE_PUBLIC_ENABLED=false until checklist step 2.
# No DNS for engage.nabitouch.com. No invites, Stripe flips, or data imports.
set -euo pipefail
if [ "${CONFIRM_PROD_ENGAGE_PATH_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_PROD_ENGAGE_PATH_DEPLOY=yes"
  exit 2
fi

CAND="${ENGAGE_SHA:-}"
if [ -z "$CAND" ]; then
  echo "Set ENGAGE_SHA to the merged commit on main"
  exit 2
fi
SHORT="$(printf '%s' "$CAND" | cut -c1-7)"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-engage-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-engage-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-engage-${SHORT}"
PREV_TAG="nt-next-api:pre-engage-${STAMP}"
LIVE="/var/www/nabitouch-next"
ENV_FILE="/etc/nabitouch-next.env"
MANIFEST="${BACKUP_DIR}/ENGAGE_PATH_${STAMP}.manifest"

mkdir -p "$RELEASE_ROOT" "$BACKUP_DIR"

echo "=== 0. Preflight health ==="
python3 - <<'PY'
import json, urllib.request
prod = json.load(urllib.request.urlopen("http://127.0.0.1:8011/api/health", timeout=15))
assert prod.get("status") == "ok" and prod.get("mongo") == "ok" and prod.get("redis") == "ok"
assert prod.get("documentUploads") is False
print("prod_pre_ok", {k: prod.get(k) for k in ("status", "mongo", "redis", "documentUploads", "cardCheckout")})
PY

echo "=== 1. Checkout ${SHORT} ==="
rm -rf "$SRC"
git clone --filter=blob:none --no-checkout "$REPO" "$SRC"
cd "$SRC"
git fetch --depth 1 origin "$CAND"
git checkout --detach "$CAND"
got="$(git rev-parse HEAD)"
echo "HEAD=${got}"
test "$got" = "$CAND"
test -f backend/engage.py
test -f frontend/src/pages/engage/EngageApp.jsx
grep -q 'build_engage_router' backend/server.py
grep -q '/engage' frontend/src/App.js

echo "=== 2. Env backup + writes forced off ==="
cp -a "$ENV_FILE" "${BACKUP_DIR}/nabitouch-next.env.pre-engage-${STAMP}"
chmod 600 "${BACKUP_DIR}/nabitouch-next.env.pre-engage-${STAMP}"
python3 - <<'PY'
from pathlib import Path
path = Path("/etc/nabitouch-next.env")
required = {
    "ENGAGE_WRITES_ENABLED": "false",
}
text = path.read_text(encoding="utf-8")
lines = text.splitlines()
keys = set()
out = []
for line in lines:
    if not line or line.lstrip().startswith("#") or "=" not in line:
        out.append(line)
        continue
    key, _, val = line.partition("=")
    if key in required:
        out.append(f"{key}={required[key]}")
        keys.add(key)
    else:
        out.append(line)
        keys.add(key)
for key, value in required.items():
    if key not in keys:
        out.append(f"{key}={value}")
if "ENGAGE_PUBLIC_ENABLED" not in keys:
    out.append("ENGAGE_PUBLIC_ENABLED=false")
path.write_text("\n".join(out) + "\n", encoding="utf-8")
for key in ("ENGAGE_PUBLIC_ENABLED", "ENGAGE_WRITES_ENABLED"):
    hit = next((l for l in path.read_text(encoding="utf-8").splitlines() if l.startswith(key + "=")), f"{key}=missing")
    print(hit)
PY

echo "=== 3. Preserve running API image ==="
docker tag nt-next-api:local "$PREV_TAG"
echo "PREV_TAG=${PREV_TAG}"

echo "=== 4. Build + restart API ==="
cd "$SRC"
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=${CAND}" \
  --label "nabitouch.feature=engage-path-launch" \
  .
docker tag "$SRC_TAG" nt-next-api:local

set -a
# shellcheck disable=SC1091
. "$ENV_FILE"
set +a

rollback_api() {
  echo "Rolling back API to ${PREV_TAG}"
  docker tag "$PREV_TAG" nt-next-api:local
  set -a
  # shellcheck disable=SC1091
  . "$ENV_FILE"
  set +a
  docker compose -f "$COMPOSE" up -d --no-deps api || true
  cp -a "${BACKUP_DIR}/nabitouch-next.env.pre-engage-${STAMP}" "$ENV_FILE" || true
}

if ! docker compose -f "$COMPOSE" up -d --no-deps api; then
  rollback_api
  exit 1
fi

health_ok=0
for _try in $(seq 1 40); do
  body="$(curl -fsS -m 5 http://127.0.0.1:8011/api/health || true)"
  if python3 -c 'import json,sys; d=json.loads(sys.argv[1] or "{}"); raise SystemExit(0 if d.get("status")=="ok" and d.get("mongo")=="ok" and d.get("redis")=="ok" and d.get("documentUploads") is False else 1)' "$body"; then
    health_ok=1
    echo "api_health_ok try=${_try}"
    break
  fi
  sleep 3
done
if [ "$health_ok" -ne 1 ]; then
  rollback_api
  exit 1
fi
docker exec nt-next-api python -c "import engage; print('engage_module_ok', engage.WORKPLACE_CHAIR_SLUG)"
eng="$(curl -fsS -m 5 http://127.0.0.1:8011/api/engage/status)"
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d.get("writesEnabled") is False; print("engage_status", {k:d.get(k) for k in ("publicEnabled","writesEnabled","serviceReady","eventCount","blockers")})' "$eng"

echo "=== 5. Build frontend ==="
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

echo "=== 6. Backup + stage frontend ==="
ARCHIVE="${BACKUP_DIR}/frontend-previous-engage-${STAMP}.tar.gz"
if [ -e "$ARCHIVE" ]; then echo "Refusing: archive exists"; exit 2; fi
tar -C "$(dirname "$LIVE")" -czf "$ARCHIVE" "$(basename "$LIVE")"
chmod 600 "$ARCHIVE"
sha256sum "$ARCHIVE" > "${ARCHIVE}.sha256"
chmod 600 "${ARCHIVE}.sha256"
PREV_INDEX="$(grep -oE '/assets/index-[^"]+\.js' "$LIVE/index.html" 2>/dev/null | head -1 || true)"
{
  echo "timestamp_utc=${STAMP}"
  echo "merged_sha=${CAND}"
  echo "short=${SHORT}"
  echo "api_tag=${SRC_TAG}"
  echo "api_prev_tag=${PREV_TAG}"
  echo "frontend_previous=$(basename "$ARCHIVE")"
  echo "previous_index_bundle=${PREV_INDEX}"
  echo "new_index_bundle=${BUNDLE}"
} > "$MANIFEST"
chmod 600 "$MANIFEST"
cat "$MANIFEST"

CONFIRM_FRONTEND_STAGE=yes bash "$SRC/deploy/private-release/stage-frontend-static.sh" "$LIVE" "$FE_BUILD/build"
if ! grep -Rql 'Engage\|engage-shell\|/engage' "$LIVE/assets"; then
  echo "Engage markers missing — restore frontend archive ${ARCHIVE}"
  exit 3
fi

echo "=== 7. Smoke ==="
curl -sS -o /dev/null -w 'engage_spa=%{http_code}\n' https://nabitouch.com/engage
curl -sS -o /dev/null -w 'engage_event=%{http_code}\n' https://nabitouch.com/engage/aurora-chair-day
curl -sS -o /dev/null -w 'home=%{http_code}\n' https://nabitouch.com/
curl -sS -o /dev/null -w 'wellness=%{http_code}\n' https://nabitouch.com/owner/wellness-studio/events
curl -sS http://127.0.0.1:8011/api/engage/status; echo
curl -sS http://127.0.0.1:8011/api/health; echo
echo "DONE engage path ${SHORT}"
echo "Rollback FE: tar -C /var/www -xzf ${ARCHIVE}"
echo "Rollback API: docker tag ${PREV_TAG} nt-next-api:local && docker compose -f ${COMPOSE} up -d --no-deps api"
echo "Next: ENGAGE_PUBLIC_ENABLED=true after UI smoke (writes stay false)."
