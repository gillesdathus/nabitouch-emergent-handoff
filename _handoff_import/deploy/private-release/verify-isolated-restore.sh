#!/bin/bash
# Exits 2 unless CONFIRM_ISOLATED_RESTORE=yes. Never restores into nabitouch_prod.
# Refuses an oplog archive. Oplog replay belongs on a separate MongoDB instance.
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=stage-c-checks.sh
source "$root/deploy/private-release/stage-c-checks.sh"
stage_c_require_confirm CONFIRM_ISOLATED_RESTORE "${CONFIRM_ISOLATED_RESTORE-}"

cipher="${1-}"
stage_c_validate_archive_pattern "$cipher"
stage_c_reject_symlink "$cipher"
stage_c_assert_checksum "$cipher" "${cipher}.sha256"
stage_c_reject_live_oplog_restore "${cipher}.manifest"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
restore="nabitouch_prod_restore_${stamp}"
stage_c_validate_restore_name "$restore"
plain=""
cfg=""
urlfile=""
remote_cfg="/tmp/nt-stage-c-${stamp}.yaml"
remote_archive="/tmp/nt-stage-c-${stamp}.archive.gz"
remote_url="/tmp/nt-stage-c-${stamp}.url"

cleanup() {
  unset BACKUP_PASSPHRASE || true
  if [ -n "$plain" ]; then
    shred -u "$plain" 2>/dev/null || rm -f -- "$plain"
  fi
  if [ -n "$cfg" ]; then
    shred -u "$cfg" 2>/dev/null || rm -f -- "$cfg"
  fi
  if [ -n "$urlfile" ]; then
    shred -u "$urlfile" 2>/dev/null || rm -f -- "$urlfile"
  fi
  docker exec nt-next-mongo rm -f "$remote_cfg" "$remote_archive" >/dev/null 2>&1 || true
  docker exec nt-next-api rm -f "$remote_url" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ -d /dev/shm ]; then
  plain="$(mktemp /dev/shm/nt-stage-c.XXXXXX.gz)"
else
  plain="$(mktemp /tmp/nt-stage-c.XXXXXX.gz)"
fi
chmod 600 "$plain"
cfg="$(mktemp "${TMPDIR:-/tmp}/nt-stage-c.XXXXXX.yaml")"
urlfile="$(mktemp "${TMPDIR:-/tmp}/nt-stage-c.XXXXXX.url")"
chmod 600 "$cfg" "$urlfile"
python3 - "$cfg" "$urlfile" <<'PY'
import json, sys
config_path, url_path = sys.argv[1], sys.argv[2]
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
with open(config_path, "w", encoding="utf-8") as handle:
    handle.write("uri: " + json.dumps(data["MONGO_URL"]) + "\n")
with open(url_path, "w", encoding="utf-8") as handle:
    handle.write(data["MONGO_URL"])
PY

docker cp "$cfg" "nt-next-mongo:${remote_cfg}"
docker cp "$urlfile" "nt-next-api:${remote_url}"
shred -u "$cfg" 2>/dev/null || rm -f -- "$cfg"
cfg=""
shred -u "$urlfile" 2>/dev/null || rm -f -- "$urlfile"
urlfile=""

docker exec -e RESTORE_DB="$restore" nt-next-api python - "$remote_url" <<'PY'
import sys
from pymongo import MongoClient
url_path = sys.argv[1]
name = __import__("os").environ["RESTORE_DB"]
if name in {"nabitouch_prod", "admin", "local", "config", "test"} or not name.startswith("nabitouch_prod_restore_"):
    raise SystemExit("Refusing restore target.")
url = open(url_path, encoding="utf-8").read().strip()
try:
    client = MongoClient(url, serverSelectionTimeoutMS=8000)
    names = set(client.list_database_names())
except Exception:
    raise SystemExit("Refusing: could not read database names.") from None
if name in names:
    raise SystemExit("Refusing: restore target already exists.")
print("restore-target-absent")
PY

read -rsp "Backup passphrase: " BACKUP_PASSPHRASE
echo
stage_c_require_passphrase "$BACKUP_PASSPHRASE"
export BACKUP_PASSPHRASE
openssl enc -d -aes-256-gcm -pbkdf2 -iter 200000 \
  -in "$cipher" -out "$plain" -pass env:BACKUP_PASSPHRASE
unset BACKUP_PASSPHRASE
if [ ! -s "$plain" ]; then
  echo "Refusing: decrypted archive is empty." >&2
  exit 1
fi

docker cp "$plain" "nt-next-mongo:${remote_archive}"
shred -u "$plain" 2>/dev/null || rm -f -- "$plain"
plain=""
docker exec nt-next-mongo mongorestore \
  --config="$remote_cfg" \
  --nsFrom="nabitouch_prod.*" \
  --nsTo="${restore}.*" \
  --archive="$remote_archive" \
  --gzip
docker exec nt-next-mongo rm -f "$remote_archive"

set +e
docker exec -e RESTORE_DB="$restore" nt-next-api python - "$remote_url" <<'PY'
import json, os, sys
from pymongo import MongoClient
url = open(sys.argv[1], encoding="utf-8").read().strip()
source_name = "nabitouch_prod"
restore_name = os.environ["RESTORE_DB"]
if restore_name == source_name or not restore_name.startswith("nabitouch_prod_restore_"):
    raise SystemExit("Refusing restore comparison.")
client = None
try:
    client = MongoClient(url, serverSelectionTimeoutMS=8000)
    source = client[source_name]
    restored = client[restore_name]
    names = ["nt_services", "nt_practitioners", "nt_media", "nt_appointments", "nt_invoices", "nt_files", "nt_users", "nt_mfa", "nt_settings"]
    present_s = set(source.list_collection_names())
    present_r = set(restored.list_collection_names())
    counts = {}
    mismatch = False
    for name in names:
        left = source[name].count_documents({}, maxTimeMS=8000) if name in present_s else None
        right = restored[name].count_documents({}, maxTimeMS=8000) if name in present_r else None
        counts[name] = {"source": left, "restore": right}
        mismatch = mismatch or left != right

    def indexes(db, present, name):
        if name not in present:
            return []
        return [idx.get("name") for idx in db[name].list_indexes()]

    print(json.dumps({
        "restore": restore_name,
        "counts": counts,
        "mismatch": mismatch,
        "indexes": {
            "services": indexes(restored, present_r, "nt_services"),
            "practitioners": indexes(restored, present_r, "nt_practitioners"),
            "media": indexes(restored, present_r, "nt_media"),
        },
    }))
except Exception:
    raise SystemExit("Refusing: could not compare the isolated database.") from None
if mismatch:
    raise SystemExit(3)
PY
compare_status=$?
set -e
if [ "$compare_status" -ne 0 ]; then
  echo "Restore comparison failed. ${restore} was left in place." >&2
  exit "$compare_status"
fi
echo "Comparison matched. ${restore} is still present. Cleanup is a separate command and was not run."
exit 0
