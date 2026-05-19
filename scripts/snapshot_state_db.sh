#!/usr/bin/env bash
#
# Snapshot ~/.glashaus/state.db safely and retain the last 30.
#
# Why `sqlite3 .backup` and not `cp`:
#   - cp on a live, writing SQLite file can produce a torn/corrupt copy.
#   - The .backup API holds the right locks and produces a guaranteed-
#     consistent file even with concurrent writers.
#
# Invoke manually:
#   bash scripts/snapshot_state_db.sh
#
# Or schedule via launchd — see docs/SETUP_BACKUPS.md.

set -euo pipefail

STATE_DIR="${GLASHAUS_STATE_DIR:-$HOME/.glashaus}"
DB_PATH="$STATE_DIR/state.db"
BACKUP_DIR="$STATE_DIR/backups"
RETAIN="${GLASHAUS_BACKUP_RETAIN:-30}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/state-$ts.db"

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_PATH" ]]; then
    # Phase 0 reality: the DB doesn't exist yet. Emit a marker file so the
    # launchd job has visible output and we can prove the schedule is
    # firing before there's anything to back up.
    marker="$BACKUP_DIR/.no-db-yet-$ts"
    : > "$marker"
    echo "no DB at $DB_PATH yet — wrote marker $marker"
    exit 0
fi

# .backup is atomic from the reader's perspective and survives a writer.
sqlite3 "$DB_PATH" ".backup '$out'"

# Verify the snapshot is a valid SQLite database before we trust it.
if ! sqlite3 "$out" "PRAGMA integrity_check;" | grep -q '^ok$'; then
    echo "FATAL: integrity_check failed on $out" >&2
    rm -f "$out"
    exit 1
fi

echo "snapshot ok: $out"

# Retention: keep the newest $RETAIN snapshots, prune the rest.
# `ls -t` orders newest-first; tail drops everything past the limit.
# shellcheck disable=SC2012
ls -t "$BACKUP_DIR"/state-*.db 2>/dev/null \
    | tail -n +"$((RETAIN + 1))" \
    | xargs -r rm -v -- || true
