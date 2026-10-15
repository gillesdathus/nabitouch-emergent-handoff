#!/bin/bash
# Static and fixture tests. Does not source or run the backup or restore scripts.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=stage-c-checks.sh
source "$root/deploy/private-release/stage-c-checks.sh"

pass=0
expect_exit() {
  local want="$1"
  shift
  set +e
  ("$@") >/tmp/nt-stage-c-test.out 2>/tmp/nt-stage-c-test.err
  local got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "expected exit ${want}, got ${got}: $*" >&2
    cat /tmp/nt-stage-c-test.err >&2
    exit 1
  fi
  pass=$((pass + 1))
}

expect_exit 2 stage_c_require_confirm CONFIRM_PRODUCTION_BACKUP
expect_exit 2 stage_c_require_confirm CONFIRM_PRODUCTION_BACKUP ""
expect_exit 2 stage_c_require_confirm CONFIRM_PRODUCTION_BACKUP no
expect_exit 2 stage_c_require_confirm CONFIRM_ISOLATED_RESTORE YES
stage_c_require_confirm CONFIRM_PRODUCTION_BACKUP yes
pass=$((pass + 1))

expect_exit 2 stage_c_require_passphrase
expect_exit 2 stage_c_require_passphrase ""
stage_c_require_passphrase "fixture-only"
pass=$((pass + 1))

expect_exit 2 stage_c_validate_source_db
expect_exit 2 stage_c_validate_source_db nabitouch
expect_exit 2 stage_c_validate_source_db nabitouch_prod_restore_20261014T000000Z
stage_c_validate_source_db nabitouch_prod
pass=$((pass + 1))

good="/root/nabitouch-next-backups/nabitouch_prod_20261014T203000Z.archive.gz.aesgcm"
stage_c_validate_archive_pattern "$good"
pass=$((pass + 1))
expect_exit 2 stage_c_validate_archive_pattern "/tmp/nabitouch_prod_20261014T203000Z.archive.gz.aesgcm"
expect_exit 2 stage_c_validate_archive_pattern "/root/nabitouch-next-backups/nabitouch_prod_20261014T203000Z.archive.gz"
expect_exit 2 stage_c_validate_archive_pattern "/root/nabitouch-next-backups/nabitouch_prod-other.archive.gz.aesgcm"

expect_exit 2 stage_c_validate_restore_name nabitouch_prod
expect_exit 2 stage_c_validate_restore_name admin
expect_exit 2 stage_c_validate_restore_name local
expect_exit 2 stage_c_validate_restore_name config
expect_exit 2 stage_c_validate_restore_name nabitouch_prod_restore
stage_c_validate_restore_name nabitouch_prod_restore_20261014T203000Z
pass=$((pass + 1))
expect_exit 2 stage_c_reject_existing_target nabitouch_prod_restore_20261014T203000Z yes
stage_c_reject_existing_target nabitouch_prod_restore_20261014T203000Z no
pass=$((pass + 1))
expect_exit 2 stage_c_reject_existing_target nabitouch_prod no

mapped="$(stage_c_remap_namespace nabitouch_prod.nt_services nabitouch_prod_restore_20261014T203000Z)"
if [ "$mapped" != "nabitouch_prod_restore_20261014T203000Z.nt_services" ]; then
  echo "namespace remap failed: $mapped" >&2
  exit 1
fi
pass=$((pass + 1))
expect_exit 2 stage_c_remap_namespace admin.system.users nabitouch_prod_restore_20261014T203000Z
expect_exit 2 stage_c_remap_namespace nabitouch_prod.nt_services nabitouch_prod

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
printf 'synthetic' > "$fixture/archive.bin"
sha256sum "$fixture/archive.bin" | awk '{ print $1 }' > "$fixture/archive.bin.sha256"
stage_c_assert_checksum "$fixture/archive.bin" "$fixture/archive.bin.sha256"
pass=$((pass + 1))
printf 'different' > "$fixture/archive.bin.sha256"
expect_exit 4 stage_c_assert_checksum "$fixture/archive.bin" "$fixture/archive.bin.sha256"
: > "$fixture/empty.bin"
expect_exit 2 stage_c_assert_checksum "$fixture/empty.bin" "$fixture/archive.bin.sha256"
expect_exit 2 stage_c_assert_checksum "$fixture/missing.bin" "$fixture/archive.bin.sha256"
: > "$fixture/empty.sha256"
expect_exit 2 stage_c_assert_checksum "$fixture/archive.bin" "$fixture/empty.sha256"

partial="$fixture/partial.bin"
kept="$fixture/kept.bin"
printf 'partial' > "$partial"
printf 'kept' > "$kept"
stage_c_remove_partial "$partial"
if [ -e "$partial" ] || [ ! -s "$kept" ]; then
  echo "partial cleanup removed the wrong file" >&2
  exit 1
fi
pass=$((pass + 1))

assert_confirm_before_side_effects() {
  local file="$1"
  local confirm_line side_line
  confirm_line="$(grep -n 'stage_c_require_confirm ' "$file" | head -n 1 | cut -d: -f1)"
  side_line="$(grep -nE 'docker |mongodump|mongorestore|openssl |drop_database|mkdir |mktemp |ssh |scp ' "$file" | head -n 1 | cut -d: -f1)"
  if [ -z "$confirm_line" ] || [ -z "$side_line" ] || [ "$confirm_line" -ge "$side_line" ]; then
    echo "confirmation is not before side effects in $file" >&2
    exit 1
  fi
  if grep -nE -- '--drop|--uri' "$file"; then
    echo "unsafe mongotool flag in $file" >&2
    exit 1
  fi
  if grep -n '/root/nabitouch-next-backups/.*archive\.gz"' "$file" | grep -v 'aesgcm'; then
    echo "plaintext archive path in $file" >&2
    exit 1
  fi
}
assert_confirm_before_side_effects "$root/deploy/private-release/backup-encrypted.sh"
assert_confirm_before_side_effects "$root/deploy/private-release/verify-isolated-restore.sh"
assert_confirm_before_side_effects "$root/deploy/private-release/drop-isolated-restore.sh"
assert_confirm_before_side_effects "$root/deploy/private-release/transfer-encrypted-backup.sh"
assert_confirm_before_side_effects "$root/deploy/private-release/restore-oplog-isolated.sh"
assert_confirm_before_side_effects "$root/deploy/private-release/remove-isolated-mongo.sh"
pass=$((pass + 1))

if grep -nE -- '--db|docker stop|docker pause' "$root/deploy/private-release/backup-encrypted.sh"; then
  echo "backup is not a single-database or quiesced dump" >&2
  exit 1
fi
if ! grep -q -- '--oplog' "$root/deploy/private-release/backup-encrypted.sh"; then
  echo "backup is missing oplog mode" >&2
  exit 1
fi
if grep -nE -- '--nsFrom|nt-next-mongo' "$root/deploy/private-release/restore-oplog-isolated.sh"; then
  echo "oplog restore can reach the live replica set" >&2
  exit 1
fi
if ! grep -q -- '--oplogReplay' "$root/deploy/private-release/restore-oplog-isolated.sh"; then
  echo "oplog restore does not replay" >&2
  exit 1
fi
if grep -n 'openssl ' "$root/deploy/private-release/transfer-encrypted-backup.sh"; then
  echo "transfer must not decrypt" >&2
  exit 1
fi
pass=$((pass + 1))

expect_exit 2 stage_c_validate_consistency_mode
expect_exit 2 stage_c_validate_consistency_mode quiesce
expect_exit 2 stage_c_validate_consistency_mode db
stage_c_validate_consistency_mode oplog
pass=$((pass + 1))

expect_exit 2 stage_c_mongodump_version_number "mongodump version: 4.4.29"
got_version="$(stage_c_mongodump_version_number "mongodump version: 100.9.4")"
if [ "$got_version" != "100.9.4" ]; then
  echo "mongodump version parse failed: $got_version" >&2
  exit 1
fi
pass=$((pass + 1))
expect_exit 2 stage_c_require_oplog_flag "usage: mongodump"
stage_c_require_oplog_flag "--oplog"
pass=$((pass + 1))

expect_exit 2 stage_c_validate_oplog_window 100 1000 3600
expect_exit 2 stage_c_validate_oplog_window 5000 1000 3600
expect_exit 2 stage_c_validate_oplog_window "" 7200 3600
stage_c_validate_oplog_window 1000 5000 3600
pass=$((pass + 1))

expect_exit 2 stage_c_validate_dump_databases
expect_exit 2 stage_c_validate_dump_databases admin local
expect_exit 2 stage_c_validate_dump_databases admin nabitouch_prod otherdb
stage_c_validate_dump_databases admin local config nabitouch_prod
pass=$((pass + 1))

expect_exit 2 stage_c_require_offhost_destination
expect_exit 2 stage_c_require_offhost_destination "user@localhost:/backups"
expect_exit 2 stage_c_require_offhost_destination "user@srv1393944:/backups"
expect_exit 2 stage_c_require_offhost_destination "user@backup.example:/root/nabitouch-next-backups"
expect_exit 2 stage_c_require_offhost_destination "user@backup.example:/backups/passphrase"
stage_c_require_offhost_destination "user@backup.example:/backups"
pass=$((pass + 1))

expect_exit 1 stage_c_reject_incomplete_transfer 100 0
expect_exit 1 stage_c_reject_incomplete_transfer 100 40
stage_c_reject_incomplete_transfer 100 100
pass=$((pass + 1))
expect_exit 2 stage_c_reject_existing_remote yes
stage_c_reject_existing_remote no
pass=$((pass + 1))
expect_exit 4 stage_c_compare_digest abc def
stage_c_compare_digest abc abc
pass=$((pass + 1))

expect_exit 2 stage_c_validate_isolated_container nt-next-mongo
expect_exit 2 stage_c_validate_isolated_container nabitouch_prod
expect_exit 2 stage_c_validate_isolated_container nt-restore-
stage_c_validate_isolated_container nt-restore-20261014T203000Z
pass=$((pass + 1))
expect_exit 2 stage_c_validate_isolated_inspect bridge '{}' '' true
expect_exit 2 stage_c_validate_isolated_inspect none '{"27017/tcp":[{"HostIp":"127.0.0.1"}]}' '' true
expect_exit 2 stage_c_validate_isolated_inspect none '{}' 'nt-next-mongo' true
expect_exit 2 stage_c_validate_isolated_inspect none '{}' '' false
stage_c_validate_isolated_inspect none '{}' 'nt-restore-20261014T203000Z' true
pass=$((pass + 1))

printf 'consistency=oplog\nreplicaSet=rs0\n' > "$fixture/manifest"
expect_exit 2 stage_c_reject_live_oplog_restore "$fixture/manifest"
stage_c_require_oplog_manifest "$fixture/manifest"
pass=$((pass + 1))
printf 'consistency=oplog\npassphrase=secret\n' > "$fixture/manifest-secret"
expect_exit 2 stage_c_require_oplog_manifest "$fixture/manifest-secret"
expect_exit 2 stage_c_validate_recovery_archive "/secure/nabitouch_prod_20261014T203000Z.archive.gz"
stage_c_validate_recovery_archive "/secure/nabitouch_prod_20261014T203000Z.archive.gz.aesgcm"
pass=$((pass + 1))

: > "$fixture/record"
expect_exit 2 stage_c_validate_recovery_record "$fixture/missing-record"
expect_exit 2 stage_c_validate_recovery_record "$fixture/record"
checksum="$(printf '%064d' 0)"
printf 'archive=nabitouch_prod_20261014T203000Z.archive.gz.aesgcm\nchecksum=%s\nlocation=user@backup.example:/backups\n' "$checksum" > "$fixture/record"
stage_c_validate_recovery_record "$fixture/record"
pass=$((pass + 1))
printf 'passphrase=secret\n' >> "$fixture/record"
expect_exit 2 stage_c_validate_recovery_record "$fixture/record"

echo "stage-c-checks: ${pass} passed"
