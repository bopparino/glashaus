# Local state DB backup setup

The thing that killed OpenMantis was silent loss of project state. We
treat `~/.glashaus/state.db` as load-bearing the moment it exists.

This guide installs the launchd job that takes a consistent SQLite
snapshot of the state DB every day at 04:17 local time and retains the
last 30 snapshots in `~/.glashaus/backups/`.

The same machinery is invoked synchronously before any schema migration
(see [`scripts/pre_migration_snapshot.sh`](../scripts/pre_migration_snapshot.sh)).

---

## Why `sqlite3 .backup` and not `cp`

`cp` of a live SQLite file can produce a torn copy that fails
`PRAGMA integrity_check`. `sqlite3 .backup` uses the online backup API,
takes the right locks, and produces a guaranteed-consistent snapshot
even with concurrent writers. The script verifies integrity before
trusting the output.

---

## Installation

### 1. Edit the plist with your repo path

The plist ships with `__GLASHAUS_REPO__` placeholders. Substitute the
absolute path:

```bash
cd /path/to/GlasHaus
sed "s|__GLASHAUS_REPO__|$(pwd)|g" scripts/com.glashaus.backup.plist \
    > ~/Library/LaunchAgents/com.glashaus.backup.plist
```

### 2. Load the job

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.glashaus.backup.plist
launchctl enable gui/$(id -u)/com.glashaus.backup
```

### 3. Verify it's registered

```bash
launchctl print gui/$(id -u)/com.glashaus.backup
```

You should see a `state = waiting` block and the `StartCalendarInterval`
entry.

### 4. Smoke-test it now

This forces a run immediately so you don't have to wait until 04:17 to
know whether you wired it correctly:

```bash
launchctl kickstart -k gui/$(id -u)/com.glashaus.backup
```

Then check:

```bash
ls -la ~/.glashaus/backups/
```

In Phase 0, the state DB doesn't exist yet — the script writes a
`.no-db-yet-*` marker file instead. That's the expected output until
Phase 1 lands the storage layer.

---

## Inspecting backup logs

```bash
tail -F ~/.glashaus/logs/backup.out.log
tail -F ~/.glashaus/logs/backup.err.log
```

---

## Restoring from a snapshot

If `state.db` is lost or corrupted:

```bash
glashaus stop                          # Phase 1+; until then, kill the daemon
cd ~/.glashaus
mv state.db state.db.broken            # keep the corpse for forensics
cp backups/state-20260518T041700Z.db state.db
glashaus start                         # Phase 1+
```

Snapshots are plain SQLite files — `sqlite3 state.db ".tables"` works on
any of them.

---

## Uninstall

```bash
launchctl bootout gui/$(id -u)/com.glashaus.backup
rm ~/Library/LaunchAgents/com.glashaus.backup.plist
```
