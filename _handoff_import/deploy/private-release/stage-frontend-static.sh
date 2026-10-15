#!/bin/bash
# Exits 2 unless CONFIRM_FRONTEND_STAGE=yes. Does not edit or reload Nginx.
set -euo pipefail
umask 077

if [ "${CONFIRM_FRONTEND_STAGE:-}" != "yes" ]; then
  echo "Refusing to run. Set CONFIRM_FRONTEND_STAGE=yes with the previous tree and the new build."
  exit 2
fi

previous="${1:-}"
build="${2:-}"
case "$previous" in
  /|/var/www|/usr|/root) echo "Refusing previous path."; exit 2 ;;
esac
[ -f "${build}/index.html" ]
[ -d "${build}/assets" ]
grep -q '/assets/index-' "${build}/index.html"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="/root/nabitouch-next-backups/frontend-previous-${stamp}.tar.gz"
mkdir -p /root/nabitouch-next-backups
chmod 700 /root/nabitouch-next-backups
if [ -e "$archive" ]; then
  echo "Refusing: archive already exists."
  exit 2
fi
if [ -d "$previous" ]; then
  tar -C "$(dirname "$previous")" -czf "$archive" "$(basename "$previous")"
  chmod 600 "$archive"
  sha256sum "$archive" > "${archive}.sha256"
  chmod 600 "${archive}.sha256"
else
  echo "No previous tree. Recording that absence."
  printf 'absent %s\n' "$previous" > "${archive}.absent"
  chmod 600 "${archive}.absent"
fi

rm -rf /var/www/nabitouch-next
mkdir -p /var/www/nabitouch-next
cp -a "${build}/." /var/www/nabitouch-next/
echo "Staged /var/www/nabitouch-next. Nginx was not changed."
