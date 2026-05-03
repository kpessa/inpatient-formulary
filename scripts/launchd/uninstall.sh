#!/usr/bin/env bash
# Stop the agent and remove its LaunchAgents entry.
set -euo pipefail

LABEL="com.kurtpessa.inpatient-formulary.dev"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
GUI_TARGET="gui/$(id -u)/$LABEL"

if launchctl print "$GUI_TARGET" >/dev/null 2>&1; then
  launchctl bootout "$GUI_TARGET" || true
fi
rm -f "$PLIST_DEST"

echo "Uninstalled. Logs preserved at ~/Library/Logs/InpatientFormulary/."
echo "Run scripts/launchd/install.sh to reinstall."
