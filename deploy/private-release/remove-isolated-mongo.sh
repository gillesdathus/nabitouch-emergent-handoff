#!/bin/bash
# Exits 2 unless CONFIRM_REMOVE_ISOLATED_INSTANCE=yes.
# Removes only a throwaway nt-restore-* MongoDB container and its matching volume.
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=stage-c-checks.sh
source "$root/deploy/private-release/stage-c-checks.sh"
stage_c_require_confirm CONFIRM_REMOVE_ISOLATED_INSTANCE "${CONFIRM_REMOVE_ISOLATED_INSTANCE-}"

name="${1-}"
stage_c_validate_isolated_container "$name"
command -v docker >/dev/null
network="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$name")"
ports="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$name")"
mounts="$(docker inspect --format '{{range .Mounts}}{{.Name}} {{.Source}}{{"\n"}}{{end}}' "$name")"
stage_c_validate_isolated_boundary "$network" "$ports" "$mounts"
docker rm -f "$name" >/dev/null
if docker volume inspect "$name" >/dev/null 2>&1; then
  docker volume rm "$name" >/dev/null
fi
echo "removed ${name}"
