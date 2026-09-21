# GlasHaus v3.0.0-alpha.7

## Start over, on your terms

Settings now offers **Delete companion** and **Purge local data**. Each requires a typed phrase and a separate acknowledgement, with Cancel and an optional export before you commit.

Delete clears the current companion's identity, all chats, memories/opinions, journal, research, imported originals and queued work, then returns to setup. It keeps saved connections and existing recovery copies. Purge also clears saved keys/settings/Telegram pairing and removes managed update recovery databases and background logs from that home. No backup is created by either action.

Ollama, models, startup preference, Telegram's own messages, downloaded exports, other homes and outside backups remain untouched. Purge is not secure disk erasure. Linked data paths and unexpected files in managed recovery folders are refused before deletion; partial cleanup is reported as incomplete and can be retried.

Active replies, research, memory work and updates block deletion. The Telegram poller is drained before clearing data; a new companion does not receive queued messages timestamped before its creation. Old browser tokens are invalidated. Unsaved settings edits block cleanup and controls are disabled while it runs.

This release adds isolated database, filesystem, HTTP and Telegram tests, browser confirmation/cancel/retry coverage, and native background-service delete → replace → purge checks on Windows, macOS and Linux. No real companion is deleted while testing or installing this update.

## Updating remains one command

Updating takes the same command as installing.

Rerun the one-line installer to download and verify the release, stop the existing background app, back up your companion, and restart on the new version. A running alpha.4 or alpha.5 background install can take this update directly. The old app folder is kept, and an already-current running app is left alone.

There is also **Settings → Updates**: check for a release, then confirm **Update and restart**. Updates happen only when you ask. This alpha includes newer published v3 alpha releases in the check; stable v3 installations check stable releases only.

## Install or update

Requires Node 24.14 or newer within Node 24, plus Ollama and your chosen model. Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/bopparino/glashaus/main/install.ps1 | iex
```

macOS / Linux, with curl and unzip:

```sh
curl -fsSL https://raw.githubusercontent.com/bopparino/glashaus/main/install.sh | sh
```

Download and read the script first if you prefer to inspect it. Installers check the ZIP's SHA-256 before running downloaded code. They do not update Ollama or download models.

Your identity, history, memories, keys, Telegram pairing, and sign-in preference stay in the same companion home. You do not need to absorb a character again. No database schema change is included.

## What to expect

- Downloads happen before downtime. An active reply or research blocks the service switch; let it finish and retry.
- Failed candidate startup triggers an attempt to restore the old database and app. The previous app, downloaded app, and local backup are kept.
- Recovery backups include saved keys and private conversations. They live in `<companion-home>/backups/update-<id>/` and are not uploaded or rotated automatically.
- A Settings update needs a background session. For manual start, stop the terminal with Ctrl+C and rerun the installer. Fresh installs still default to manual mode unless you opt into background startup.
- Keep `GLASHAUS_HOME` set for a custom data home. The installer reuses its registered port. A raw `git pull` changes source only; use the installer to update a running installation.

If the updater is interrupted or recovery cannot finish, keep all app/data folders and run `node bin/glashaus-v3.js recover` from the downloaded app folder. It will not replace the database while a process may still own it. Use your normal backups as well.

## Still here

First-person companion replies from alpha.5; authored, grow, researched-character and backup setup; shared web/Telegram conversation; inspectable memory and opinions; corrections, forgetting, reflections and JSON exports. Model compliance is not guaranteed, and the previously observed Kimi drafting-text issue is not changed by this release.

This is a v3 alpha, not full v2 feature parity. `legacy-v2/` and Git history remain intact; v3 does not open the v2 database. Voice/photos, scheduled outreach, and full v2 conversation migration are not included.

Publication requires the Windows, macOS, and Linux test matrix, including actual native-service update and failed-release rollback on disposable runners. No real companion data is used in these checks.
