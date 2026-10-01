#!/usr/bin/env bash
# Runs on the VPS as the deploy user, from a release the deploy workflow just unpacked into
# /srv/market-jury/releases/<id>: install dependencies, point "current" at it, restart the app
# (which applies any new migrations on start), check it answers, and roll back if it doesn't.
set -euo pipefail

ROOT=/srv/market-jury
KEEP=5
release=$(cd "$(dirname "$0")/.." && pwd)

healthy() {
  for _ in $(seq 1 20); do
    curl -fs -o /dev/null http://127.0.0.1:3000/api/health && return 0
    sleep 1
  done
  return 1
}

switch_to() {
  ln -sfn "$1" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
  sudo /usr/bin/systemctl restart market-jury.service
}

cd "$release"
bun install --frozen-lockfile --production

previous=$(readlink -f "$ROOT/current" || true)
switch_to "$release"

if ! healthy; then
  echo "The new release did not answer its health check."
  if [[ -n "$previous" && -d "$previous" ]]; then
    echo "Going back to $(basename "$previous")."
    switch_to "$previous"
    healthy || echo "The previous release is not answering either: check  journalctl -u market-jury"
  fi
  exit 1
fi
echo "Live: $(basename "$release")"

# Keep the newest few releases for rollback; release names start with a UTC timestamp.
find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d | sort | head -n -"$KEEP" | xargs -r rm -rf
