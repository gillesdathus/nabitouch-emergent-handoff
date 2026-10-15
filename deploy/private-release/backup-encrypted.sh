#!/bin/bash
# Exits 2 unless CONFIRM_PRODUCTION_BACKUP=yes.
# Streams an oplog archive into AES-256-GCM. Writes only ciphertext, a SHA-256 file, and a secret-free manifest.
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=stage-c-checks.sh
source "$root/deploy/private-release/stage-c-checks.sh"
stage_c_require_confirm CONFIRM_PRODUCTION_BACKUP "${CONFIRM_PRODUCTION_BACKUP-}"
stage_c_validate_consistency_mode "${CONSISTENCY_MODE:-oplog}"

command -v openssl >/dev/null
command -v docker >/dev/null
command -v python3 >/dev/null
mkdir -p /root/nabitouch-next-backups
chmod 700 /root/nabitouch-next-backups

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
cipher="/root/nabitouch-next-backups/nabitouch_prod_${stamp}.archive.gz.aesgcm"
partial="${cipher}.partial"
manifest="${cipher}.manifest"
cfg=""
urlfile=""
remote_cfg="/tmp/nt-stage-c-${stamp}.yaml"
remote_url="/tmp/nt-stage-c-${stamp}.url"
stage_c_validate_archive_pattern "$cipher"
if [ -e "$cipher" ] || [ -e "${cipher}.sha256" ] || [ -e "$manifest" ] || [ -e "$partial" ]; then
  echo "Refusing: output already exists." >&2
  exit 2
fi

cleanup() {
  unset BACKUP_PASSPHRASE || true
  stage_c_remove_partial "$partial"
  if [ -n "$cfg" ]; then
    shred -u "$cfg" 2>/dev/null || rm -f -- "$cfg"
  fi
  if [ -n "$urlfile" ]; then
    shred -u "$urlfile" 2>/dev/null || rm -f -- "$urlfile"
  fi
  docker exec nt-next-mongo rm -f "$remote_cfg" >/dev/null 2>&1 || true
  docker exec nt-next-api rm -f "$remote_url" >/dev/null 2>&1 || true
}
trap cleanup EXIT

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

version_text="$(docker exec nt-next-mongo mongodump --version)"
version_line="$(printf '%s\n' "$version_text" | awk 'NR==1 { print; exit }')"
version_number="$(stage_c_mongodump_version_number "$version_line")"
help_text="$(docker exec nt-next-mongo mongodump --help 2>&1 || true)"
stage_c_require_oplog_flag "$help_text"

preflight="$(docker exec -i nt-next-api python - "$remote_url" <<'PY'
import sys
from pymongo import MongoClient
url = open(sys.argv[1], encoding="utf-8").read().strip()
allowed = {"admin", "local", "config", "nabitouch_prod"}
try:
    client = MongoClient(url, serverSelectionTimeoutMS=8000)
    names = set(client.list_database_names())
    oplog = client.local.oplog.rs
    oldest = oplog.find_one(sort=[("$natural", 1)])
    newest = oplog.find_one(sort=[("$natural", -1)])
except Exception:
    raise SystemExit("Refusing: this database user cannot read the oplog. An oplog backup is blocked until a backup role is authorized.") from None
if "nabitouch_prod" not in names or not names.issubset(allowed):
    raise SystemExit("Refusing: replica set database list is not the expected set.")
if not oldest or not newest or "ts" not in oldest or "ts" not in newest:
    raise SystemExit("Refusing: oplog window is missing.")
print(f"WINDOW {int(oldest['ts'].time)} {int(newest['ts'].time)}")
print("DATABASES " + ",".join(sorted(names)))
PY
)"
window_oldest="$(printf '%s\n' "$preflight" | awk '$1=="WINDOW" { print $2 }')"
window_newest="$(printf '%s\n' "$preflight" | awk '$1=="WINDOW" { print $3 }')"
db_csv="$(printf '%s\n' "$preflight" | awk '$1=="DATABASES" { print $2 }')"
stage_c_validate_oplog_window "$window_oldest" "$window_newest" 3600
IFS=',' read -r -a db_names <<< "$db_csv"
stage_c_validate_dump_databases "${db_names[@]}"
oplog_span=$((window_newest - window_oldest))
dumped=""
for name in "${db_names[@]}"; do
  if [ "$name" != "local" ]; then
    dumped="${dumped:+${dumped},}${name}"
  fi
done

read -rsp "Backup passphrase: " BACKUP_PASSPHRASE
echo
stage_c_require_passphrase "$BACKUP_PASSPHRASE"
export BACKUP_PASSPHRASE

docker exec nt-next-mongo mongodump --config="$remote_cfg" --oplog --archive --gzip \
  | openssl enc -aes-256-gcm -pbkdf2 -iter 200000 -salt -out "$partial" -pass env:BACKUP_PASSPHRASE
unset BACKUP_PASSPHRASE

bytes="$(stat -c%s "$partial")"
if [ "$bytes" -lt 128 ]; then
  echo "Refusing: encrypted output is too small to be a dump." >&2
  exit 1
fi
mv "$partial" "$cipher"
partial=""
sha256sum "$cipher" | awk '{ print $1 }' > "${cipher}.sha256"
chmod 600 "$cipher" "${cipher}.sha256"
if [ ! -s "${cipher}.sha256" ]; then
  rm -f -- "$cipher" "${cipher}.sha256"
  echo "Refusing: checksum was not written." >&2
  exit 1
fi
cat > "$manifest" <<EOF
consistency=oplog
replicaSet=rs0
sourceDatabase=nabitouch_prod
archive=$(basename -- "$cipher")
checksumFile=$(basename -- "${cipher}.sha256")
databases=${dumped}
oplogWindowSeconds=${oplog_span}
mongodumpVersion=${version_number}
EOF
chmod 600 "$manifest"
echo "Encrypted backup written. Checksum file: ${cipher}.sha256"
