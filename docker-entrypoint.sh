#!/bin/sh
set -e
# Ensure bind-mounted data dir is writable by the node user when started as root.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R node:node /data 2>/dev/null || true
  exec gosu node "$@"
fi
exec "$@"
