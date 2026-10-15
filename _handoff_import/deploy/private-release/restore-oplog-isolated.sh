#!/bin/bash
# Exits 2 unless CONFIRM_ISOLATED_RESTORE=yes.
# Replays an oplog archive onto a separate mongod. Does not contact the production replica set.
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=stage-c-checks.sh
source "$root/deploy/private-release/stage-c-checks.sh"
stage_c_require_confirm CONFIRM_ISOLATED_RESTORE "${CONFIRM_ISOLATED_RESTORE-}"

cipher="${1-}"
container="${2-}"
stage_c_validate_recovery_archive "$cipher"
stage_c_reject_symlink "$cipher"
stage_c_assert_checksum "$cipher" "${cipher}.sha256"
stage_c_require_oplog_manifest "${cipher}.manifest"
stage_c_validate_isolated_container "$container"

command -v openssl >/dev/null
command -v docker >/dev/null
network="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")"
ports="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$container")"
mounts="$(docker inspect --format '{{range .Mounts}}{{.Name}} {{.Source}}{{"\n"}}{{end}}' "$container")"
running="$(docker inspect --format '{{.State.Running}}' "$container")"
stage_c_validate_isolated_inspect "$network" "$ports" "$mounts" "$running"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
plain=""
js=""
remote_js="/tmp/nt-stage-c-${stamp}.js"
remote_archive="/tmp/nt-stage-c-${stamp}.archive.gz"
cleanup() {
  unset BACKUP_PASSPHRASE || true
  if [ -n "$plain" ]; then
    shred -u "$plain" 2>/dev/null || rm -f -- "$plain"
  fi
  if [ -n "$js" ]; then
    rm -f -- "$js"
  fi
  docker exec "$container" rm -f "$remote_js" "$remote_archive" >/dev/null 2>&1 || true
}
trap cleanup EXIT

js="$(mktemp "${TMPDIR:-/tmp}/nt-stage-c.XXXXXX.js")"
cat > "$js" <<'EOF'
const names = db.adminCommand({ listDatabases: 1 }).databases.map((row) => row.name)
const extra = names.filter((name) => !["admin", "local", "config"].includes(name))
if (extra.length) {
  print("Refusing: isolated target is not empty")
  quit(2)
}
const users = db.getSiblingDB("admin").getCollection("system.users").countDocuments({})
if (users > 0) {
  print("Refusing: isolated target already has users")
  quit(2)
}
print("isolated-target-empty")
EOF
docker cp "$js" "${container}:${remote_js}"
docker exec "$container" mongosh --quiet --file "$remote_js"
rm -f -- "$js"
js=""

if [ -d /dev/shm ]; then
  plain="$(mktemp /dev/shm/nt-stage-c.XXXXXX.gz)"
else
  plain="$(mktemp /tmp/nt-stage-c.XXXXXX.gz)"
fi
chmod 600 "$plain"
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
docker cp "$plain" "${container}:${remote_archive}"
shred -u "$plain" 2>/dev/null || rm -f -- "$plain"
plain=""

docker exec "$container" mongorestore --archive="$remote_archive" --gzip --oplogReplay
docker exec "$container" rm -f "$remote_archive"

docker exec "$container" mongosh --quiet --eval 'const names = db.getSiblingDB("nabitouch_prod").getCollectionNames(); if (!names.length) { quit(3) } print(JSON.stringify({ database: "nabitouch_prod", collections: names.length }))'
echo "Oplog replay finished on ${container}. The instance is still present. Removal is a separate command."
