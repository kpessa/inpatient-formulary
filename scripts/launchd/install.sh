#!/usr/bin/env bash
# Install the dev-server launchd agent. Idempotent: re-running re-bootstraps
# with the latest plist so edits are picked up without manual bootout.
set -euo pipefail

LABEL="com.kurtpessa.inpatient-formulary.dev"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/$LABEL.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/InpatientFormulary"
RUNNER="$SCRIPT_DIR/run-dev.sh"

# Sanity checks
if [[ ! -f "$PLIST_SRC" ]]; then
  echo "ERROR: plist not found at $PLIST_SRC" >&2
  exit 1
fi
if [[ ! -x "$RUNNER" ]]; then
  echo "Marking $RUNNER executable…"
  chmod +x "$RUNNER"
fi

mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# If already loaded, bootout first so we can re-bootstrap with whatever the
# plist looks like *now* — equivalent to `launchctl reload`.
GUI_TARGET="gui/$(id -u)/$LABEL"
if launchctl print "$GUI_TARGET" >/dev/null 2>&1; then
  echo "Service already loaded — bootout first to refresh…"
  launchctl bootout "$GUI_TARGET" 2>/dev/null || true
  # tiny pause so launchd settles before bootstrap
  sleep 0.5
fi

# Symlink so future edits to the source plist are seen on next install/restart.
ln -sf "$PLIST_SRC" "$PLIST_DEST"

# Bootstrap into the GUI session. `gui/<uid>` is the user-graphical domain;
# launchd starts the agent now AND will re-launch it on every login.
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"

echo
echo "Installed: $LABEL"
echo "  plist:       $PLIST_DEST  →  $PLIST_SRC"
echo "  logs:        $LOG_DIR"
echo "  status:      launchctl print $GUI_TARGET"
echo "  restart:     bash $SCRIPT_DIR/restart.sh   (or: pnpm dev:restart)"
echo "  uninstall:   bash $SCRIPT_DIR/uninstall.sh (or: pnpm dev:uninstall)"
echo
echo "Next.js dev should be running on http://localhost:3000 within ~10 seconds."
echo "Tail logs to confirm:    pnpm dev:logs"
