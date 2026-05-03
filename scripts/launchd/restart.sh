#!/usr/bin/env bash
# Kick the dev server: SIGTERM the running process, launchd brings it back up
# (because KeepAlive). Use this after env-var changes, next.config edits,
# or package installs — file edits are picked up by HMR without restart.
set -euo pipefail

LABEL="com.kurtpessa.inpatient-formulary.dev"
GUI_TARGET="gui/$(id -u)/$LABEL"

if ! launchctl print "$GUI_TARGET" >/dev/null 2>&1; then
  echo "Service not loaded. Run install.sh first."
  exit 1
fi

launchctl kickstart -k "$GUI_TARGET"
echo "Restarted $LABEL — give it ~5 seconds to be ready."
echo "Tail logs:  pnpm dev:logs"
