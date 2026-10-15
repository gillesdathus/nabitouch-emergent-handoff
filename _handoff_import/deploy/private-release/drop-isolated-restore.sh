#!/bin/bash
# Exits 2 unless CONFIRM_DROP_RESTORE=yes. Drops only a timestamped validation database.
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=stage-c-checks.sh
source "$root/deploy/private-release/stage-c-checks.sh"
stage_c_require_confirm CONFIRM_DROP_RESTORE "${CONFIRM_DROP_RESTORE-}"

name="${1-}"
stage_c_validate_restore_name "$name"
urlfile="$(mktemp "${TMPDIR:-/tmp}/nt-stage-c.XXXXXX.url")"
remote_url="/tmp/nt-stage-c-drop.url"
chmod 600 "$urlfile"
cleanup() {
  if [ -n "${urlfile-}" ]; then
    shred -u "$urlfile" 2>/dev/null || rm -f -- "$urlfile"
  fi
  docker exec nt-next-api rm -f "$remote_url" >/dev/null 2>&1 || true
}
trap cleanup EXIT

python3 - "$urlfile" <<'PY'
import sys
data = {}
with open("/etc/nabitouch-next.env", encoding="utf-8") as handle:
    for line in handle:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
if data.get("DB_NAME") != "nabitouch_prod" or not data.get("MONGO_URL"):
    raise SystemExit("Refusing: database identity is not nabitouch_prod.")
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    handle.write(data["MONGO_URL"])
PY
docker cp "$urlfile" "nt-next-api:${remote_url}"
shred -u "$urlfile" 2>/dev/null || rm -f -- "$urlfile"
urlfile=""

docker exec -e RESTORE_DB="$name" nt-next-api python - "$remote_url" <<'PY'
import os, sys
from pymongo import MongoClient
name = os.environ["RESTORE_DB"]
if name == "nabitouch_prod" or not name.startswith("nabitouch_prod_restore_"):
    raise SystemExit("Refusing to drop this database.")
url = open(sys.argv[1], encoding="utf-8").read().strip()
try:
    MongoClient(url, serverSelectionTimeoutMS=8000).drop_database(name)
except Exception:
    raise SystemExit("Refusing: could not drop the validation database.") from None
print("dropped", name)
PY
