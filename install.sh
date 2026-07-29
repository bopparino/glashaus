#!/bin/sh
# GlasHaus installer.
#   curl -fsSL https://raw.githubusercontent.com/bopparino/glashaus/main/install.sh | sh
# Prefer to inspect first? Same file, two steps:
#   curl -fsSLO https://raw.githubusercontent.com/bopparino/glashaus/main/install.sh && sh install.sh
#
# What it does (and nothing else): checks Node >= 20 and Ollama, installs the
# `glashaus` package globally with npm — from this GitHub repo, the source of
# truth — then hands off to `glashaus setup`. Re-running is safe: it upgrades
# the package and re-opens setup. Leaving is one command too: glashaus uninstall
set -eu

say()  { printf '>>> %s\n' "$1"; }
fail() { printf '!!! %s\n' "$1" >&2; exit 1; }

main() {
  # -- node ------------------------------------------------------------------
  if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is required (>= 20). Install it first:
    macOS:  brew install node
    Linux:  https://nodejs.org/en/download/package-manager
  then re-run this installer."
  fi
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" -ge 20 ] || fail "Node $(node -v) found, but GlasHaus needs >= 20. Please upgrade."
  say "Node $(node -v) ✓"

  command -v npm >/dev/null 2>&1 || fail "npm not found (it normally ships with Node)."
  # GitHub installs are git clones under the hood.
  command -v git >/dev/null 2>&1 || fail "git is required (npm installs GlasHaus from GitHub). Install git, then re-run."

  # -- ollama (informational only — never installed on your behalf) ----------
  OLLAMA_URL="${OLLAMA_HOST:-http://127.0.0.1:11434}"
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
    say "Ollama running at $OLLAMA_URL ✓"
  else
    say "Ollama not detected — that's fine, setup will walk you through it."
    say "  (install: https://ollama.com/download · then: ollama serve)"
  fi

  # -- install ----------------------------------------------------------------
  # GitHub is the source of truth (the registry package is unpublished, so it
  # is only a fallback in case that ever changes). Failures are SHOWN — an
  # installer that eats its own error output turns every failure into a
  # mystery, and we have been there.
  LOG="$(mktemp "${TMPDIR:-/tmp}/glashaus-install.XXXXXX")"
  say "Installing glashaus (npm -g, from github:bopparino/glashaus)…"
  if npm install -g github:bopparino/glashaus >"$LOG" 2>&1 \
     || npm install -g glashaus >"$LOG" 2>&1; then
    VERSION="$(npm ls -g glashaus --depth=0 2>/dev/null | grep -o 'glashaus@[0-9][0-9.]*' || echo glashaus)"
    say "$VERSION ✓"
    rm -f "$LOG"
  else
    printf '\n--- npm said: ------------------------------------------------\n' >&2
    tail -25 "$LOG" >&2
    printf -- '---------------------------------------------------------------\n\n' >&2
    fail "npm install failed (full log: $LOG). The usual suspects:
    · permissions (EACCES): fix npm's prefix — https://docs.npmjs.com/resolving-eacces-permissions-errors
      (never sudo npm; it is how root-owned files end up haunting you)
    · better-sqlite3 compiling from source: install build tools
      (macOS: xcode-select --install · Debian/Ubuntu: apt install build-essential python3)
    · then try manually, with full output: npm install -g github:bopparino/glashaus"
  fi

  # -- hand off to the wizard --------------------------------------------------
  # stdin is the pipe when run via `curl | sh`; reconnect the wizard to the
  # terminal so it can actually ask questions (rustup's lesson).
  if [ -t 0 ]; then
    exec glashaus setup
  elif [ -e /dev/tty ]; then
    say "Starting setup…"
    exec glashaus setup < /dev/tty
  else
    say "No terminal available — run \`glashaus setup\` yourself to finish."
  fi
}

main "$@"
