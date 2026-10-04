#!/bin/sh
# Dev only: runs the PHP API against the LOCAL database from .env.dev.local.
cd "$(dirname "$0")/.." || exit 1
if [ ! -f .env.dev.local ]; then
  echo "Missing .env.dev.local — copy .env.dev.local.example and fill it in." >&2
  exit 1
fi
set -a
. ./.env.dev.local
set +a
exec php -S 127.0.0.1:8080 -t public
