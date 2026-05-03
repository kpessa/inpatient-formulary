#!/usr/bin/env bash
# Wrapper that launchd executes to run `pnpm dev`.
# Resolves pnpm at exec time so the plist doesn't have to know the path.
set -euo pipefail

# cd to the project root regardless of how launchd invokes us.
cd "$(dirname "$0")/../.."

# Volta-managed Node, if present. Volta shims (~/.volta/bin/{node,npm,pnpm})
# auto-resolve the version pinned in the project's package.json.
if [[ -d "$HOME/.volta/bin" ]]; then
  export VOLTA_HOME="$HOME/.volta"
  export PATH="$VOLTA_HOME/bin:$PATH"
fi

# Common Homebrew paths (Apple Silicon + Intel).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Find pnpm: command -v handles the resolved PATH. Fall back to common
# install locations if shell PATH is shorter than expected (launchd starts
# with a minimal env).
PNPM="$(command -v pnpm 2>/dev/null || true)"
if [[ -z "$PNPM" ]]; then
  for candidate in \
      "$HOME/.local/share/pnpm/pnpm" \
      "$HOME/Library/pnpm/pnpm" \
      /opt/homebrew/bin/pnpm \
      /usr/local/bin/pnpm; do
    if [[ -x "$candidate" ]]; then
      PNPM="$candidate"
      break
    fi
  done
fi
if [[ -z "$PNPM" || ! -x "$PNPM" ]]; then
  echo "ERROR: pnpm not found in PATH or known install locations" >&2
  echo "PATH was: $PATH" >&2
  exit 127
fi

# Touch a heartbeat so logs always start with a clear timestamp.
echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting next dev via $PNPM" >&2

# Exec replaces this shell so launchd sees the actual node/next process.
# next dev binds to PORT (default 3000); change here if Kurt wants a fixed port.
exec "$PNPM" dev
