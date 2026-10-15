#!/bin/bash
# Pure checks for Stage C. Sourcing this file does not contact a database.

stage_c_reject() {
  echo "$1" >&2
  exit "${2:-2}"
}

stage_c_require_confirm() {
  local name="$1"
  local value="${2-}"
  if [ "$value" != "yes" ]; then
    stage_c_reject "Refusing to run. Set ${name}=yes." 2
  fi
}

stage_c_require_passphrase() {
  if [ -z "${1-}" ]; then
    stage_c_reject "Refusing: encryption passphrase is empty." 2
  fi
}

stage_c_validate_source_db() {
  if [ "${1-}" != "nabitouch_prod" ]; then
    stage_c_reject "Refusing: database identity is not nabitouch_prod." 2
  fi
}

stage_c_validate_archive_pattern() {
  case "${1-}" in
    /root/nabitouch-next-backups/nabitouch_prod_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.archive.gz.aesgcm)
      ;;
    *)
      stage_c_reject "Refusing: archive path is not an encrypted nabitouch_prod backup." 2
      ;;
  esac
}

stage_c_reject_symlink() {
  if [ -L "${1-}" ]; then
    stage_c_reject "Refusing: archive path is a symlink." 2
  fi
}

stage_c_validate_restore_name() {
  local name="${1-}"
  case "$name" in
    nabitouch_prod|admin|local|config|test)
      stage_c_reject "Refusing restore target ${name}." 2
      ;;
  esac
  case "$name" in
    nabitouch_prod_restore_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z)
      ;;
    *)
      stage_c_reject "Refusing: restore target must be a new timestamped validation database." 2
      ;;
  esac
}

stage_c_reject_existing_target() {
  local name="$1"
  local exists="${2-}"
  stage_c_validate_restore_name "$name"
  if [ "$exists" = "yes" ]; then
    stage_c_reject "Refusing: restore target ${name} already exists." 2
  fi
}

stage_c_remap_namespace() {
  local ns="${1-}"
  local restore="${2-}"
  stage_c_validate_restore_name "$restore"
  case "$ns" in
    nabitouch_prod.*)
      printf '%s\n' "${restore}.${ns#nabitouch_prod.}"
      ;;
    *)
      stage_c_reject "Refusing: namespace ${ns} is outside nabitouch_prod." 2
      ;;
  esac
}

stage_c_assert_checksum() {
  local file="${1-}"
  local sumfile="${2-}"
  if [ ! -s "$file" ]; then
    stage_c_reject "Refusing: archive missing or empty." 2
  fi
  if [ ! -s "$sumfile" ]; then
    stage_c_reject "Refusing: checksum missing or empty." 2
  fi
  local expected actual
  expected="$(awk 'NR==1 { print $1 }' "$sumfile")"
  actual="$(sha256sum "$file" | awk '{ print $1 }')"
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    stage_c_reject "Refusing: checksum mismatch." 4
  fi
}

stage_c_remove_partial() {
  local path="${1-}"
  if [ -n "$path" ]; then
    rm -f -- "$path"
  fi
}

stage_c_validate_consistency_mode() {
  case "${1-}" in
    oplog) ;;
    *) stage_c_reject "Refusing: consistency mode must be oplog." 2 ;;
  esac
}

stage_c_mongodump_version_number() {
  local line="${1-}"
  local version
  version="$(printf '%s\n' "$line" | awk 'match($0, /[0-9]+\.[0-9]+\.[0-9]+/) { print substr($0, RSTART, RLENGTH); exit }')"
  case "$version" in
    100.*) printf '%s\n' "$version" ;;
    *) stage_c_reject "Refusing: mongodump does not support an oplog archive." 2 ;;
  esac
}

stage_c_require_oplog_flag() {
  case "${1-}" in
    *--oplog*) ;;
    *) stage_c_reject "Refusing: mongodump has no oplog flag." 2 ;;
  esac
}

stage_c_validate_oplog_window() {
  local oldest="${1-}" newest="${2-}" minimum="${3-}"
  if [ -z "$oldest" ] || [ -z "$newest" ] || [ -z "$minimum" ]; then
    stage_c_reject "Refusing: oplog window is not numeric." 2
  fi
  case "${oldest}${newest}${minimum}" in
    *[!0-9]*) stage_c_reject "Refusing: oplog window is not numeric." 2 ;;
  esac
  if [ "$newest" -lt "$oldest" ]; then
    stage_c_reject "Refusing: oplog window is invalid." 2
  fi
  local span=$((newest - oldest))
  if [ "$span" -lt "$minimum" ]; then
    stage_c_reject "Refusing: oplog window is ${span}s, below ${minimum}s." 2
  fi
}

stage_c_validate_dump_databases() {
  local saw_app=0
  local name
  if [ "$#" -eq 0 ]; then
    stage_c_reject "Refusing: database list is empty." 2
  fi
  for name in "$@"; do
    case "$name" in
      admin|local|config) ;;
      nabitouch_prod) saw_app=1 ;;
      *) stage_c_reject "Refusing: unexpected database is present." 2 ;;
    esac
  done
  if [ "$saw_app" -ne 1 ]; then
    stage_c_reject "Refusing: nabitouch_prod is not on this replica set." 2
  fi
}

stage_c_validate_recovery_archive() {
  local path="${1-}"
  local base
  base="$(basename -- "$path")"
  case "$path" in
    /*) ;;
    *) stage_c_reject "Refusing: archive path must be absolute." 2 ;;
  esac
  case "$base" in
    nabitouch_prod_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.archive.gz.aesgcm) ;;
    *) stage_c_reject "Refusing: archive path is not an encrypted nabitouch_prod backup." 2 ;;
  esac
}

stage_c_require_oplog_manifest() {
  local manifest="${1-}"
  if [ ! -s "$manifest" ]; then
    stage_c_reject "Refusing: oplog manifest is missing." 2
  fi
  if grep -Eiq 'passphrase|password|mongodb://|MONGO_URL|BACKUP_PASSPHRASE' "$manifest"; then
    stage_c_reject "Refusing: manifest contains a secret." 2
  fi
  if ! grep -qx 'consistency=oplog' "$manifest"; then
    stage_c_reject "Refusing: manifest is not an oplog backup." 2
  fi
}

stage_c_reject_live_oplog_restore() {
  local manifest="${1-}"
  if [ -f "$manifest" ] && grep -qx 'consistency=oplog' "$manifest"; then
    stage_c_reject "Refusing: oplog backups cannot be restored onto the live replica set." 2
  fi
}

stage_c_validate_isolated_container() {
  local name="${1-}"
  case "$name" in
    nt-next-mongo|nabitouch_mongo|nt-next-api|nt-next-redis|nt-next-enroll|nt-next-clamav|nabitouch_backend|nabitouch_frontend|nabitouch_prod)
      stage_c_reject "Refusing: ${name} is a production target." 2
      ;;
    nt-restore-[A-Za-z0-9]*) ;;
    *) stage_c_reject "Refusing: isolated MongoDB name must start with nt-restore-." 2 ;;
  esac
}

stage_c_validate_isolated_boundary() {
  local network="${1-}" ports="${2-}" mounts="${3-}"
  if [ "$network" != "none" ]; then
    stage_c_reject "Refusing: isolated MongoDB must use network none." 2
  fi
  case "$ports" in
    ""|"{}"|"null"|"<no value>") ;;
    *) stage_c_reject "Refusing: isolated MongoDB publishes a port." 2 ;;
  esac
  case "$mounts" in
    *nt-next-mongo*|*nabitouch_mongo*|*nabitouch-rmt*)
      stage_c_reject "Refusing: isolated MongoDB mounts production data." 2
      ;;
  esac
}

stage_c_validate_isolated_inspect() {
  stage_c_validate_isolated_boundary "$1" "$2" "$3"
  if [ "${4-}" != "true" ]; then
    stage_c_reject "Refusing: isolated MongoDB is not running." 2
  fi
}

stage_c_require_offhost_destination() {
  local dest="${1-}"
  local host path
  if [ -z "$dest" ]; then
    stage_c_reject "Off-host transfer is BLOCKED: OFFHOST_DESTINATION is not set." 2
  fi
  case "$dest" in
    *BACKUP_PASSPHRASE*|*passphrase*|*password*|*MONGO_URL*|*mongodb://*)
      stage_c_reject "Refusing: destination contains a secret." 2
      ;;
  esac
  case "$dest" in
    [A-Za-z0-9._-]*@[A-Za-z0-9.-]*:/*) ;;
    *) stage_c_reject "Refusing: OFFHOST_DESTINATION must be user@host:/absolute/path." 2 ;;
  esac
  host="${dest#*@}"
  host="${host%%:*}"
  path="${dest#*:}"
  case "$host" in
    localhost|127.0.0.1|::1|srv1393944|srv1393944.*)
      stage_c_reject "Refusing: destination host is not an off-host copy." 2
      ;;
  esac
  case "$path" in
    *..*|*[!A-Za-z0-9._/-]*)
      stage_c_reject "Refusing: destination path is not a plain absolute directory." 2
      ;;
    /root/nabitouch-next-backups|/root/nabitouch-next-backups/*)
      stage_c_reject "Refusing: destination is the local backup directory." 2
      ;;
  esac
}

stage_c_reject_existing_remote() {
  if [ "${1-}" = "yes" ]; then
    stage_c_reject "Refusing: destination archive already exists." 2
  fi
}

stage_c_reject_incomplete_transfer() {
  local source_bytes="${1-}" dest_bytes="${2-}"
  case "${source_bytes}${dest_bytes}" in
    ""|*[!0-9]*) stage_c_reject "Refusing: transfer size is not numeric." 1 ;;
  esac
  if [ "$source_bytes" -le 0 ] || [ "$dest_bytes" -ne "$source_bytes" ]; then
    stage_c_reject "Refusing: transfer is incomplete." 1
  fi
}

stage_c_compare_digest() {
  local expected="${1-}" actual="${2-}"
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    stage_c_reject "Refusing: destination checksum mismatch." 4
  fi
}

stage_c_validate_recovery_record() {
  local file="${1-}" archive checksum location
  if [ ! -s "$file" ]; then
    stage_c_reject "Refusing: recovery record is missing." 2
  fi
  if grep -Eiq 'passphrase|password|mongodb://|MONGO_URL|BACKUP_PASSPHRASE' "$file"; then
    stage_c_reject "Refusing: recovery record contains a secret." 2
  fi
  archive="$(awk -F= '$1=="archive" { print $2; exit }' "$file")"
  checksum="$(awk -F= '$1=="checksum" { print $2; exit }' "$file")"
  location="$(awk -F= '$1=="location" { print $2; exit }' "$file")"
  case "$archive" in
    nabitouch_prod_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.archive.gz.aesgcm) ;;
    *) stage_c_reject "Refusing: recovery record has no archive identifier." 2 ;;
  esac
  if [ "${#checksum}" -ne 64 ] || [[ ! "$checksum" =~ ^[0-9a-f]{64}$ ]]; then
    stage_c_reject "Refusing: recovery record has no checksum." 2
  fi
  if [ -z "$location" ]; then
    stage_c_reject "Refusing: recovery record has no backup location." 2
  fi
}
