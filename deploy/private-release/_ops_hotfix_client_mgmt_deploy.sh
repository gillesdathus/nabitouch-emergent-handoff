#!/bin/bash
# Hotfix: Client Management 2.0 — staff create/edit profile, addresses, insurance.
# Deploys API + FE. Does not touch Nginx, Mongo volumes, Redis, Stripe, or travel-fee settings.
# Does not reseed. Smoke creates a synthetic staff client then cleans contact fields only.
set -euo pipefail

if [ "${CONFIRM_HOTFIX_DEPLOY:-}" != "yes" ]; then
  echo "Refusing. Set CONFIRM_HOTFIX_DEPLOY=yes"
  exit 2
fi

HOTFIX_SHA="${HOTFIX_SHA:?Set HOTFIX_SHA to the client-mgmt commit to deploy}"
SHORT="$(printf '%s' "$HOTFIX_SHA" | cut -c1-7)"
BRANCH="hotfix/dathus-staff-roles"
REPO="https://github.com/gillesdathus/nabitouch-emergent-handoff.git"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ROOT="/root/nt-release"
SRC="${RELEASE_ROOT}/nt-hotfix-client-mgmt-${SHORT}"
FE_BUILD="${RELEASE_ROOT}/fe-build-client-mgmt-${STAMP}"
BACKUP_DIR="/root/nabitouch-next-backups"
COMPOSE="/opt/nt-next/deploy/docker-compose.hostinger.yml"
SRC_TAG="nt-next-api:src-${SHORT}"
PREV_TAG="nt-next-api:pre-client-mgmt-${SHORT}-${STAMP}"
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
test -f backend/client_admin.py
test -f frontend/src/components/clients/ClientProfileEditor.jsx
test -f frontend/src/components/clients/CreateClientDialog.jsx
grep -q "merge_client_patch" backend/server.py
grep -q "verification_state_for" backend/addresses.py
grep -q "editClientProfile" frontend/src/lib/domain.js
grep -q "cw-edit-profile" frontend/src/pages/staff/ClientWorkspace.jsx
grep -q "hasStaffRole" frontend/src/lib/staffRoles.js

echo "=== backup live frontend ==="
FE_TAR="${BACKUP_DIR}/frontend-live-before-client-mgmt-${STAMP}.tar.gz"
tar -C /var/www -czf "$FE_TAR" nabitouch-next
chmod 600 "$FE_TAR"
sha256sum "$FE_TAR" | tee "${FE_TAR}.sha256"
chmod 600 "${FE_TAR}.sha256"

echo "=== build API image ==="
docker build -f deploy/Dockerfile.api -t "$SRC_TAG" \
  --label "nabitouch.source_sha=$HOTFIX_SHA" \
  --label "nabitouch.hotfix=client-management-2" \
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
if ! grep -Rql "cw-edit-profile\|client-profile-editor\|create-client-dialog" build/assets/*.js; then
  echo "Refusing: client admin UI markers missing from build" >&2
  exit 2
fi

echo "=== publish frontend ==="
STAGE_TAR="${BACKUP_DIR}/frontend-previous-client-mgmt-${STAMP}.tar.gz"
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

# Rural + out-of-province mailing geo checks (no booking).
SMOKE_ABBREV="$(curl -fsS -m 25 -X POST https://nabitouch.com/api/geo/check -H 'Content-Type: application/json' -d '{"line":"53337 Rge Rd 215"}')"
SMOKE_YEG="$(curl -fsS -m 25 -X POST https://nabitouch.com/api/geo/check -H 'Content-Type: application/json' -d '{"line":"10150 104 St NW, Edmonton, AB"}')"
python3 - "$SMOKE_ABBREV" "$SMOKE_YEG" <<'PY'
import json, sys
abbrev, yeg = json.loads(sys.argv[1]), json.loads(sys.argv[2])
assert abbrev.get("eligible") is True, abbrev
assert "Range Road 215" in (abbrev.get("line") or "")
assert yeg.get("eligible") is True, yeg
print("geo-check-ok", abbrev.get("requiresManualApproval"), abbrev.get("km"))
PY

if [ -n "${OWNER_EMAIL:-}" ] && [ -n "${OWNER_PASSWORD:-}" ]; then
  echo "=== authenticated client create/edit smoke ==="
  set +e
  python3 - <<'PY'
import json, os, uuid, urllib.request, http.cookiejar

api = "https://nabitouch.com/api"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(api + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    csrf = next((c.value for c in jar if c.name == "csrf_token"), None)
    if csrf and method in ("POST", "PATCH", "PUT", "DELETE"):
        req.add_header("X-CSRF-Token", csrf)
    with opener.open(req, timeout=30) as resp:
        return json.loads(resp.read().decode())

call("POST", "/auth/login", {"email": os.environ["OWNER_EMAIL"], "password": os.environ["OWNER_PASSWORD"]})
token = uuid.uuid4().hex[:8]
created = call("POST", "/clients", {
    "firstName": "Synth",
    "lastName": f"Mgmt{token}",
    "phone": f"780555{token[:4]}",
    "addresses": [{"line": "53337 Rge Rd 215, Ardrossan, AB T8E 2B2", "label": "Home", "purpose": "home", "postal": "T8E 2B2"}],
})
assert created.get("email") == ""
assert "Range Road 215" in created["addresses"][0]["line"], created
cid = created["id"]
patched = call("PATCH", f"/clients/{cid}", {"preferredName": "Syn", "phone": "780-555-4242", "altPhone": "780-555-0002"})
assert patched["preferredName"] == "Syn" and patched["altPhone"] == "780-555-0002"
ws = call("GET", f"/clients/{cid}/workspace")
assert ws["access"]["editProfile"] is True
assert ws["client"]["phone"] == "780-555-4242"
identity = call("PATCH", f"/clients/{cid}", {
    "firstName": "Synthetic",
    "_identityCorrection": {"method": "verbal_confirmed", "reason": "Deploy smoke spelling check"},
})
assert identity["firstName"] == "Synthetic"
hist = call("GET", f"/clients/{cid}/profile-history")
assert any(row.get("identity") for row in hist.get("history") or [])
print("client-mgmt-smoke-ok", cid)
PY
  smoke_rc=$?
  set -e
  if [ "$smoke_rc" -ne 0 ]; then
    echo "WARN: authenticated smoke failed (rc=${smoke_rc}); API/FE already published — verify owner credentials and re-run _ops_p0_verify_client_mgmt.py"
  fi
else
  echo "Skipping authenticated smoke (OWNER_EMAIL / OWNER_PASSWORD not set in deploy env)"
fi

cat > "${BACKUP_DIR}/CLIENT_MGMT_HOTFIX_${STAMP}.manifest" <<EOF
timestamp_utc=${STAMP}
change=client-management-2
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
chmod 600 "${BACKUP_DIR}/CLIENT_MGMT_HOTFIX_${STAMP}.manifest"
cat "${BACKUP_DIR}/CLIENT_MGMT_HOTFIX_${STAMP}.manifest"
echo "DEPLOY_OK ${STAMP} sha=${HOTFIX_SHA} bundle=${BUNDLE}"
