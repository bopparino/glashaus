#!/bin/sh
# GlasHaus installer.
#   curl -fsSL https://raw.githubusercontent.com/bopparino/glashaus/main/install.sh | sh
# Prefer to inspect first? Same file, two steps:
#   curl -fsSLO https://raw.githubusercontent.com/bopparino/glashaus/main/install.sh && sh install.sh
#
# What it does (and nothing else): checks Node >= 20 and Ollama, installs the
# `glashaus` package globally with npm, then hands off to `glashaus setup`.
# Re-running is safe — it upgrades the package and re-opens setup.
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

  # -- ollama (informational only — never installed on your behalf) ----------
  OLLAMA_URL="${OLLAMA_HOST:-http://127.0.0.1:11434}"
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
    say "Ollama running at $OLLAMA_URL ✓"
  else
    say "Ollama not detected — that's fine, setup will walk you through it."
    say "  (install: https://ollama.com/download · then: ollama serve)"
  fi

  # -- install ----------------------------------------------------------------
  say "Installing glashaus (npm -g)…"
  npm install -g glashaus >/dev/null 2>&1 \
    || npm install -g github:bopparino/glashaus >/dev/null 2>&1 \
    || fail "npm install failed. Try manually: npm install -g glashaus
  (If it's a permissions error, fix npm's prefix: https://docs.npmjs.com/resolving-eacces-permissions-errors)"
  say "glashaus $(glashaus --help 2>/dev/null | head -1 >/dev/null && npm ls -g glashaus --depth=0 2>/dev/null | grep -o 'glashaus@[0-9.]*' || echo installed) ✓"

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
