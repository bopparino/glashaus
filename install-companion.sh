#!/bin/bash
set -euo pipefail
# Downloads only the dedicated full-companion branch. No sudo or shell profile edits.
[[ "$(uname -s)" == Darwin ]] || { echo 'The full-companion installer currently supports macOS.' >&2; exit 1; }
/usr/bin/xcode-select -p >/dev/null 2>&1 || { echo 'Install Xcode from the Mac App Store, open it once, then run this command again.' >&2; exit 1; }
glashaus_install="${GLASHAUS_INSTALL_ROOT:-$HOME/Applications/Glashaus}"
if [[ -e "$glashaus_install" ]]; then
  printf 'A folder already exists at %s. It was left unchanged.\nTo rebuild that installation, run its Setup Glashaus.command. See docs/SETUP.md for updates.\n' "$glashaus_install" >&2
  exit 1
fi
mkdir -p "$(dirname "$glashaus_install")"
git clone --branch full-companion --single-branch https://github.com/bopparino/glashaus.git "$glashaus_install"
exec /bin/bash "$glashaus_install/Setup Glashaus.command" "$@"
