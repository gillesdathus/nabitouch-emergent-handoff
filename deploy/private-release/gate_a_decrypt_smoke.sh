#!/usr/bin/env bash
# Isolated Gate A decrypt smoke. Never prints the passphrase or plaintext path contents.
# Usage (on recovery host or VPS):
#   CONFIRM_GATE_A_DECRYPT_SMOKE=yes bash deploy/private-release/gate_a_decrypt_smoke.sh
set -euo pipefail
umask 077

if [ "${CONFIRM_GATE_A_DECRYPT_SMOKE:-}" != "yes" ]; then
  echo "Refusing: set CONFIRM_GATE_A_DECRYPT_SMOKE=yes" >&2
  exit 2
fi

HELPER="${GATE_A_AESGCM_HELPER:-/root/gate-a-work/gate_a_aesgcm.py}"
PASSFILE="${GATE_A_PASSFILE:-/root/nabitouch-next-backups/GATE_A_PASSPHRASE_RECOVER_ONCE.txt}"
CIPHER="${GATE_A_SMOKE_CIPHER:-/root/nabitouch-next-backups/nabitouch_prod_20261017T085834Z.db.archive.gz.aesgcm}"
WORK="$(mktemp -d /tmp/gate_a_decrypt_smoke.XXXXXX)"
PLAIN="${WORK}/plain.bin"
cleanup() {
  unset BACKUP_PASSPHRASE || true
  if [ -f "$PLAIN" ]; then
    shred -u "$PLAIN" 2>/dev/null || rm -f -- "$PLAIN"
  fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT

command -v python3 >/dev/null
[ -f "$HELPER" ] || { echo "Refusing: helper missing: $HELPER" >&2; exit 2; }
[ -f "$CIPHER" ] || { echo "Refusing: ciphertext missing: $CIPHER" >&2; exit 2; }
[ -f "$PASSFILE" ] || { echo "Refusing: passfile missing (PM-only recovery not wired for this smoke)" >&2; exit 2; }

python3 -c "from cryptography.hazmat.primitives.ciphers.aead import AESGCM" \
  || { echo "Refusing: cryptography package missing (pip install 'cryptography>=41')" >&2; exit 1; }

# Synthetic round-trip (throwaway passphrase; proves helper+deps)
SYN_PASS='gate-a-smoke-only-not-for-production'
printf 'gate-a-smoke-payload' > "${WORK}/syn.in"
BACKUP_PASSPHRASE="$SYN_PASS" python3 "$HELPER" encrypt --in "${WORK}/syn.in" --out "${WORK}/syn.aes"
BACKUP_PASSPHRASE="$SYN_PASS" python3 "$HELPER" decrypt --in "${WORK}/syn.aes" --out "${WORK}/syn.out"
cmp -s "${WORK}/syn.in" "${WORK}/syn.out"
echo "SYNTHETIC_ROUNDTRIP=PASS"

# Real archive decrypt (A1 small DB dump) — passphrase via env from file; never echoed
BACKUP_PASSPHRASE="$(tr -d '\r\n' < "$PASSFILE")"
export BACKUP_PASSPHRASE
[ -n "$BACKUP_PASSPHRASE" ] || { echo "Refusing: empty passphrase" >&2; exit 1; }
python3 "$HELPER" decrypt --in "$CIPHER" --out "$PLAIN"
unset BACKUP_PASSPHRASE

bytes="$(stat -c%s "$PLAIN" 2>/dev/null || wc -c < "$PLAIN")"
if [ "$bytes" -lt 64 ]; then
  echo "Refusing: decrypted output too small ($bytes)" >&2
  exit 1
fi
# mongodump --gzip archive starts with gzip magic
magic="$(xxd -p -l 2 "$PLAIN" 2>/dev/null || od -An -tx1 -N 2 "$PLAIN" | tr -d ' \n')"
case "$magic" in
  1f8b|1F8B) echo "A1_DECRYPT_GZIP_MAGIC=PASS" ;;
  *) echo "A1_DECRYPT_GZIP_MAGIC=UNEXPECTED:$magic" >&2; exit 1 ;;
esac
echo "A1_DECRYPT_BYTES=$bytes"
echo "GATE_A_DECRYPT_SMOKE=PASS"
echo "HELPER=$HELPER"
echo "CIPHER=$(basename -- "$CIPHER")"
# cleanup trap shreds plaintext
