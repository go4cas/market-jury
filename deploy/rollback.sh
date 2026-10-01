#!/usr/bin/env bash
# Go back to the release before the current one and restart the app.
# Run on the VPS:  sudo -u deploy /srv/market-jury/current/deploy/rollback.sh
# Database changes are not undone; the older code runs against the current database.
set -euo pipefail

ROOT=/srv/market-jury
current=$(readlink -f "$ROOT/current")
previous=$(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d | sort | awk -v c="$current" '$0 == c { print prev; exit } { prev = $0 }')

if [[ -z "$previous" ]]; then
  echo "There is no older release on the server to go back to."
  exit 1
fi
ln -sfn "$previous" "$ROOT/current.new"
mv -T "$ROOT/current.new" "$ROOT/current"
sudo /usr/bin/systemctl restart market-jury.service
echo "Rolled back from $(basename "$current") to $(basename "$previous")."
