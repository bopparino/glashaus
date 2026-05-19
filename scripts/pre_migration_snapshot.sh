#!/usr/bin/env bash
#
# Take a labeled pre-migration snapshot. Called from the migration runner
# (Phase 1+) before any schema change touches state.db. Plan §11 mandates
# this — every migration is preceded by a snapshot tagged with the
# migration's target version, so rollback is one cp away.
#
# Usage:
#   bash scripts/pre_migration_snapshot.sh <target_version>

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "usage: $0 <target_version>" >&2
    exit 2
fi

target="$1"
STATE_DIR="${GLASHAUS_STATE_DIR:-$HOME/.glashaus}"
DB_PATH="$STATE_DIR/state.db"
BACKUP_DIR="$STATE_DIR/backups"

mkdir -p "$BACKUP_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/pre-migration-v${target}-$ts.db"

if [[ ! -f "$DB_PATH" ]]; then
    echo "no DB to snapshot at $DB_PATH (first-run migration?)"
    exit 0
fi

sqlite3 "$DB_PATH" ".backup '$out'"

if ! sqlite3 "$out" "PRAGMA integrity_check;" | grep -q '^ok$'; then
    echo "FATAL: integrity_check failed on $out" >&2
    rm -f "$out"
    exit 1
fi

echo "pre-migration snapshot ok: $out"
