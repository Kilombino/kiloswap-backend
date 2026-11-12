#!/usr/bin/env bash
# Starts Boltz's regtest (../regtest) on the BLAKE2b chain: builds the Knots
# and Core Lightning images if they are missing, then runs upstream's
# start.sh with docker-compose.blake2b.yml laid over its compose file.
#
#   regtest-blake2b/start.sh            as CI runs it
#   LOCAL=1 regtest-blake2b/start.sh    Postgres on 15432 (docker-compose.local.yml)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
regtest=${BOLTZ_REGTEST:-$here/../regtest}

image_or_build() {
	docker image inspect "$1" >/dev/null 2>&1 || docker build -q -t "$1" "$here/$2" >/dev/null
}
image_or_build "${BLAKE2B_KNOTS_IMAGE:-lfswap/regtest-knots:29.4.2}" knots
image_or_build "${BLAKE2B_CLN_IMAGE:-lfswap/regtest-cln:v26.06.10-blake2b.1}" cln

files="docker-compose.yml:$here/docker-compose.blake2b.yml"
if [ -n "${LOCAL:-}" ]; then
	files="$files:$here/docker-compose.local.yml"
fi
cd "$regtest"
COMPOSE_FILE=$files COMPOSE_PROFILES=${COMPOSE_PROFILES:-backend-dev} ./start.sh
