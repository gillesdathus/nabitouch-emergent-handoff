#!/bin/bash
set -euo pipefail
curl -fsS -m 10 https://nabitouch.com/api/health
echo
B="$(curl -fsS -m 10 https://nabitouch.com/ | grep -oE '/assets/index-[^"]+\.js' | head -1)"
echo "bundle=${B}"
ls /var/www/nabitouch-next/assets/ClientWorkspace-*.js /var/www/nabitouch-next/assets/ClientDirectory-*.js
grep -l 'cw-edit-profile\|create-client-dialog\|client-profile-editor' /var/www/nabitouch-next/assets/*.js | head -5
docker exec nt-next-api python -c 'import client_admin, addresses; print("api-modules-ok", addresses.MANUAL_APPROVAL_KM)'

set -a
# shellcheck disable=SC1091
. /etc/nabitouch-next.env
set +a
export REACT_APP_BACKEND_URL=https://nabitouch.com
python3 /tmp/_ops_p0_verify_client_mgmt.py
