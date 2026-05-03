#!/usr/bin/env bash
# Rebuild the dev server's embedded-replica file from scratch.
#
# Use this after a bulk Multum/formulary reload — pushing a large amount of
# data to remote Turso forces the running replica to do a long catch-up sync,
# which is the dangerous window where corruption tends to happen. A clean
# stop → delete → start sequence avoids that: the new replica file is built
# in one initial sync from a known-good remote.
#
# Idempotent. Safe to run when the agent isn't loaded (skips bootout).
set -euo pipefail

LABEL="com.kurtpessa.inpatient-formulary.dev"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
GUI_TARGET="gui/$(id -u)/$LABEL"
REPLICA_DIR="$HOME/Library/Caches/inpatient-formulary"
REPLICA_FILE="$REPLICA_DIR/replica.db"

# 1. Stop the agent if it's loaded -- need the replica file unlocked
#    before we can delete it.
if launchctl print "$GUI_TARGET" >/dev/null 2>&1; then
  echo "Booting out ${LABEL}..."
  launchctl bootout "$GUI_TARGET" || true
  # Brief pause so the kernel releases the file lock before rm.
  sleep 0.5
else
  echo "Agent not loaded -- skipping bootout."
fi

# 2. Delete the replica + its WAL sidecars. -f so missing files aren't fatal.
if [[ -f "$REPLICA_FILE" ]]; then
  size_mb=$(du -m "$REPLICA_FILE" | awk '{print $1}')
  echo "Removing replica (~${size_mb} MB) and WAL/SHM sidecars..."
else
  echo "Replica file did not exist -- nothing to delete."
fi
rm -f "$REPLICA_FILE" "${REPLICA_FILE}-wal" "${REPLICA_FILE}-shm"

# 3. Bootstrap the agent again. The plist symlink already points at the source
#    plist (set up by install.sh), so we don't need to re-symlink. If the plist
#    is missing (uninstalled), fall back to running install.sh.
if [[ ! -f "$PLIST_DEST" ]]; then
  echo "LaunchAgents plist missing -- running install.sh to set up from scratch..."
  exec bash "$SCRIPT_DIR/install.sh"
fi

mkdir -p "$REPLICA_DIR"
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"

echo
echo "Replica rebuilt."
echo "  Next request triggers a fresh full sync from Turso (30-90s for ~50-400 MB)."
echo "  Tail logs:   pnpm dev:logs"
echo "  Status:      pnpm dev:status"
