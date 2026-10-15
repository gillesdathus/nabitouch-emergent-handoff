#!/bin/bash
# Exits 2 unless CONFIRM_OFFHOST_TRANSFER=yes.
# Copies ciphertext, the SHA-256 file, and the manifest. Does not copy a passphrase or a plaintext archive.
# Does not delete the local backup.
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=stage-c-checks.sh
source "$root/deploy/private-release/stage-c-checks.sh"
stage_c_require_confirm CONFIRM_OFFHOST_TRANSFER "${CONFIRM_OFFHOST_TRANSFER-}"

cipher="${1-}"
dest="${OFFHOST_DESTINATION-}"
stage_c_require_offhost_destination "$dest"
stage_c_validate_recovery_archive "$cipher"
stage_c_reject_symlink "$cipher"
stage_c_assert_checksum "$cipher" "${cipher}.sha256"
stage_c_require_oplog_manifest "${cipher}.manifest"

command -v ssh >/dev/null
command -v scp >/dev/null
ssh_target="${dest%%:*}"
remote_dir="${dest#*:}"
remote_dir="${remote_dir%/}"
base="$(basename -- "$cipher")"
remote_final="${remote_dir}/${base}"
remote_partial="${remote_final}.partial"
remote_sum="${remote_final}.sha256"
remote_sum_partial="${remote_sum}.partial"
remote_manifest="${remote_final}.manifest"
remote_manifest_partial="${remote_manifest}.partial"

if ! ssh -o BatchMode=yes "$ssh_target" "test -d '$remote_dir'"; then
  echo "Refusing: destination directory is missing or SSH failed." >&2
  exit 2
fi
exists=no
if ssh -o BatchMode=yes "$ssh_target" "test -e '$remote_final' || test -e '$remote_sum' || test -e '$remote_manifest'"; then
  exists=yes
fi
stage_c_reject_existing_remote "$exists"

scp -o BatchMode=yes "$cipher" "${ssh_target}:${remote_partial}"
scp -o BatchMode=yes "${cipher}.sha256" "${ssh_target}:${remote_sum_partial}"
scp -o BatchMode=yes "${cipher}.manifest" "${ssh_target}:${remote_manifest_partial}"

source_bytes="$(stat -c%s "$cipher")"
dest_bytes="$(ssh -o BatchMode=yes "$ssh_target" "stat -c%s '$remote_partial'")"
stage_c_reject_incomplete_transfer "$source_bytes" "$dest_bytes"
expected="$(awk 'NR==1 { print $1 }' "${cipher}.sha256")"
actual="$(ssh -o BatchMode=yes "$ssh_target" "sha256sum '$remote_partial'" | awk 'NR==1 { print $1 }')"
stage_c_compare_digest "$expected" "$actual"

sum_expected="$(sha256sum "${cipher}.sha256" | awk 'NR==1 { print $1 }')"
sum_actual="$(ssh -o BatchMode=yes "$ssh_target" "sha256sum '$remote_sum_partial'" | awk 'NR==1 { print $1 }')"
stage_c_compare_digest "$sum_expected" "$sum_actual"
manifest_expected="$(sha256sum "${cipher}.manifest" | awk 'NR==1 { print $1 }')"
manifest_actual="$(ssh -o BatchMode=yes "$ssh_target" "sha256sum '$remote_manifest_partial'" | awk 'NR==1 { print $1 }')"
stage_c_compare_digest "$manifest_expected" "$manifest_actual"

ssh -o BatchMode=yes "$ssh_target" "mv '$remote_partial' '$remote_final' && mv '$remote_sum_partial' '$remote_sum' && mv '$remote_manifest_partial' '$remote_manifest' && chmod 700 '$remote_dir' && chmod 600 '$remote_final' '$remote_sum' '$remote_manifest'"
echo "Off-host ciphertext stored: ${ssh_target}:${remote_final}"
