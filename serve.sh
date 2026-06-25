#!/usr/bin/env bash
set -euo pipefail

host="${HOST:-127.0.0.1}"
port="${PORT:-8123}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Serving ${root}"
echo "Open http://${host}:${port}/"
exec python3 -m http.server --bind "${host}" --directory "${root}" "${port}"
