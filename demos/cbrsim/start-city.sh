#!/usr/bin/env bash
# Serve the Canberra Visions prototype (no build step).
# Usage: ./start-city.sh            -> http://127.0.0.1:8125
#        PORT=9000 ./start-city.sh
#        HOST=0.0.0.0 ./start-city.sh   (reach it from a tablet on the LAN)
set -euo pipefail

PORT="${PORT:-8125}"
HOST="${HOST:-127.0.0.1}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/prototype" && pwd)"

echo "Serving $DIR at http://$HOST:$PORT  (Ctrl-C to stop)"
exec python3 -m http.server "$PORT" --bind "$HOST" --directory "$DIR"
