# GlasHaus v3 · alpha

A local-first home for a continuing AI companion. Choose Ollama or Grok for inference. Web and Telegram share one conversation, with portable identity and memories you can inspect.

This is a **fresh alpha**, not a drop-in v2 upgrade. Existing v2 source is preserved in `legacy-v2/`; v3 never opens or changes a v2 database.

## Start the built app

Requires Node **24.14+ (24.x) or 26.x** and either an Ollama model or an xAI API key and Grok model ID. Extract the portable archive and run:

```sh
node bin/glashaus-v3.js
```

Open **http://127.0.0.1:7777** and confirm that you are 18 or older. GlasHaus records your confirmation in this companion home. Existing v3 homes will be asked once after upgrading. In **Settings → Model connection**, choose Ollama or Grok. For Ollama, keep the default address if it runs locally. For Grok, paste your xAI API key and click **Load models**. Pick a model from the list and click **Save model**. You can enter an exact model ID manually if needed. Choose **Write a prompt** to set a companion name, the name they call you, and one prompt of up to 4,000 characters. GlasHaus sends the prompt with each chat turn, alongside its chat rules and relevant context.

During setup you can choose **Run in the background and start at sign-in**. For manual start, keep the terminal running and use Ctrl+C to stop. Data survives restarts.

To try a preview alongside an existing installation, choose a separate data directory and port. You can transfer the companion with JSON export and restore.

The default home is `~/.glashaus-v3` on every OS. `GLASHAUS_HOME` selects another home, and `GLASHAUS_PORT` selects another port. One companion per home. The server binds to localhost only; remote web access is not included. Use Telegram when away from the computer.

## One-command installation

The included installers download the prebuilt `glashaus-v3.zip` asset from a GitHub release. They use your installed Node 24.14+ (24.x) or Node 26.x. Set up Ollama separately if you choose local inference. Sign-in startup is off unless you choose it in setup or Settings.

The commands below install **v3.0.0-alpha.9**. They require its [published release assets](https://github.com/bopparino/glashaus/releases/tag/v3.0.0-alpha.9); a pending or failed release check will not publish an unverified app.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/bopparino/glashaus/main/install.ps1 | iex
```

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/bopparino/glashaus/main/install.sh | sh
```

For safer inspection, download the script, read it, then execute it. Set `GLASHAUS_RELEASE_TAG` to select a different v3 release. The default is pinned to the version above so GitHub's stable-release listing cannot accidentally select v2. Installs use separate unique directories under `~/.local/share/glashaus`; the companion data directory is separate. Retired app versions are not deleted automatically.

## Background startup

Choose the optional checkbox at the last setup step, or before selecting a restore file. Settings also has an **Enable background startup** button. GlasHaus registers a service under your own account, switches from the terminal to that service, and reconnects the page. Your companion is saved first; if registration fails, you can retry or continue manually.

- **Windows:** a Task Scheduler task at sign-in, with a hidden process and your normal account permissions. No saved Windows password or administrator service.
- **macOS:** a per-user LaunchAgent at sign-in. macOS may show it in Login Items; allow it there if your system blocks it.
- **Linux:** a `systemd --user` service. A working systemd user session is required. On a headless server, an administrator can separately enable lingering for your account if you want it to run before sign-in or after logout. GlasHaus never changes that setting or runs `sudo` itself.

Keep the installed app folder and Node executable in place. The service uses their absolute paths. Each companion home gets its own service name.

### Stay reachable when your PC sleeps

Run GlasHaus on a separate always-on computer or a private server. On that host, select Grok or run Ollama on an always-on machine reachable by GlasHaus. If Ollama runs on the sleeping PC, inference pauses with it.

1. Start the portable build on the always-on host. On a remote machine, open the local web app from your PC with an SSH tunnel such as `ssh -N -L 7777:127.0.0.1:7777 user@host`, then visit `http://127.0.0.1:7777`.
2. For an existing companion, export from the old installation and choose **Someone you remember** in setup on the new one. Save your model credentials again. Stop the old process before moving its Telegram bot, then add the bot token and pair on the new host.
3. Enable background startup. On an unattended systemd host, enable user lingering if GlasHaus needs to start before login. Send a test message from Telegram with the old PC asleep.

On a single PC, GlasHaus reconnects after the process resumes. It saves received owner messages locally and retries temporary model and Telegram outages. Messages that only reached Telegram expire after [24 hours](https://core.telegram.org/bots/api#getting-updates).

**Turn off sign-in startup** in Settings prevents future sign-in launches and leaves the current session open. From the installation folder you can also run:

```sh
node bin/glashaus-v3.js service status
node bin/glashaus-v3.js service enable
node bin/glashaus-v3.js service disable
node bin/glashaus-v3.js service stop
```

`stop` ends the current background session without erasing data. `disable` turns off sign-in startup; use both to turn it off and stop it now. These commands respect `GLASHAUS_HOME` and `GLASHAUS_PORT`. `status` shows the native service name and log location. Logs live in `<companion-home>/startup/background.log`; startup records contain paths and port numbers, not API keys, and are excluded from JSON companion backups. Disabled service registrations are retained so they can be re-enabled.

Before moving Node or manually moving an app folder, disable and stop its service first. For normal upgrades, use the update flow below. Do not run two different ports against the same companion home.

## Updating an existing v3 install

**Rerun the same one-line installer.** From alpha.6 onward, the installer downloads and checks the new release, stops an existing background app, makes a local database backup, switches the service to the new folder, and checks that it restarted. Chats, identity, memories, keys, Telegram pairing, and the sign-in preference stay in place. A running alpha.4 or alpha.5 background install can use this installer too; you do not need to disable its service first. An already-current running install is left alone.

Or use **Settings → Updates → Check for updates → Update GlasHaus → Update and restart**. This checks published v3 releases, including newer alphas when you are on an alpha. A stable v3 install checks stable releases only. Updates are started by you, never silently scheduled. The Settings button requires a background session; enable it in the section above if needed.

For a manual terminal session, press Ctrl+C before rerunning the installer. Manual offline installs start in the terminal again. Keep `GLASHAUS_HOME` set if you use a custom companion home; the installer reads its registered port unless `GLASHAUS_PORT` is specified. Extracted portable archives can use `node bin/glashaus-v3.js install` for the same handoff. `git pull` by itself only changes source files; it does not build or replace a running installed app.

Let a reply or research finish before updating. Download or checksum failures leave the running app unchanged. If the new background app fails its startup check, GlasHaus attempts to restore the previous database and app. Both app folders and the recovery copy are retained. Backups live in `<companion-home>/backups/update-<id>/`; **these private SQLite copies include saved keys**, unlike exported JSON backups. They are not uploaded or automatically deleted.

If a power loss or failed rollback leaves the app offline, run `node bin/glashaus-v3.js recover` from the downloaded app folder, using the same companion home. It refuses to restore over a running updater or a process that may still own the database. Keep the old app, new app, and companion folder until recovery succeeds. Recovery is not a substitute for your own backups.

## What works in this alpha

- **Character absorption:** provide a name, originating work, and optional scope. Ollama web search/fetch retrieves public sources; the local/configured utility model writes an editable foundation. Sources, claims, and uncertainty are visible. Saved research resumes after interruption.
- **Authored / grow / restore:** write a persona, start with a name and minimal foundation, restore a v3 JSON archive, or import a v2 soul capsule. Set your relationship separately and preview their voice before saving.
- **Conversation:** Ollama replies stream. Grok returns each reply when it is ready. The companion defaults to conversational replies and can go into detail when asked. Duplicate request IDs reuse a completed reply.
- **Memory:** lasting interests, preferences, and milestones can be captured as quotes from their original speaker. SQLite full-text search ranks active memories across the full collection. Model-selected quotes and generated replies can still misread context. Use Memory to inspect, edit, add, or forget saved details. Use `/note your text` in Telegram to save a note verbatim without a model call.
- **Journal:** on-demand reflections and optional daily reflection after 9pm while running. A minimal grow persona can form conversational preferences; autonomous identity rewriting is not included yet.
- **Telegram:** private text chats, owner-only pairing, initial-connect retries, rate-limit backoff, clear polling/webhook conflict errors, typing/draft updates where supported, long-message splitting, shared memory and history, `/status` and `/memory`. Do not run v2 and v3 with the same bot token at once. Delivery retry is at-least-once; an ambiguous network failure may duplicate a delivered message.
- **Backup:** v3 archive export/restore includes identity revisions, conversations, active and forgotten memories, reflections, and character research. Credentials and machine settings are excluded. Restore requires an empty home and is atomic.

## Delete a companion or purge this home

Open **Settings → Start over**. A data folder holds one companion; deleting them returns it to setup so you can create or restore another.

- **Delete companion** removes identity and revisions, all conversations, memories and opinions (including forgotten items), journal entries, character research, imported originals, and queued work from the current database. Model settings, saved keys, Telegram pairing, and existing recovery copies stay. Those copies can still contain the deleted companion.
- **Purge local data** also resets saved settings and pairing, and removes known GlasHaus update recovery databases (including failed-candidate copies) and background logs inside this home. The app and startup preference stay installed.

Both actions require the exact typed phrase and an acknowledgement. Save settings edits first and let replies, research, and background memory work finish. Cleanup and updates share an exclusive lock. Deletion never creates a backup for you; export one beforehand only if you want to keep a copy. Cancel changes nothing. After successful cleanup the page reloads into setup.

Purge does not touch Ollama or its models, Telegram's own message history, downloaded exports, files in other companion homes, unrelated files, or external/OS/cloud backups. It refuses linked data paths and unfamiliar files inside managed recovery folders. Partial file-cleanup failures are shown as incomplete; retry Purge after resolving the file-access problem. If an interrupted cleanup leaves a lock, stop the app and run `node bin/glashaus-v3.js recover` from the installed app folder with the same `GLASHAUS_HOME`. This clears only the interrupted cleanup lock; it does not restore deleted data.

The app clears SQLite rows, compacts the database and truncates its write-ahead log. This is **not secure disk erasure** and cannot erase SSD remnants or filesystem snapshots. See SQLite's [secure-delete](https://www.sqlite.org/pragma.html#pragma_secure_delete) and [VACUUM](https://www.sqlite.org/lang_vacuum.html) documentation for the database-level behavior.

## Privacy and limitations

Grok sends the prompt, relevant conversation context, and memory processing requests to xAI using the [Responses API](https://docs.x.ai/developers/rest-api-reference/inference/responses). GlasHaus requests `store: false`. Ollama inference follows your Ollama configuration. `:cloud` models use hosted inference, even when Ollama itself runs locally. A remote Ollama address sends context to that server. Character search sends the character name, work, and scope to Ollama's hosted search; it does not send your relationship or chat history. Telegram uses Telegram's servers.

Saved credentials and conversations are **not encrypted at rest**. They are in your v3 SQLite file and should be protected with your OS account and disk encryption. The web API uses loopback Host/Origin checks and a per-process mutation token, not remote-user authentication. Do not expose this service through a public proxy.

Forgetting removes a memory from recall; it is not a secure wipe. Original chats, revisions, and forgotten records remain in exports. Imported archive extension fields are retained for recovery. Treat every backup as private.

Not yet included: full v2 database migration, embeddings, automatic backup rotation, proactive outreach, voice/photos, autonomous self-authorship, and remote web authentication. A v2 soul capsule is identity transfer, not full conversation restoration. v2 commands are not available through the v3 CLI.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm start
```

Use Node 24.14+ (24.x) or Node 26.x and pnpm 11. Browser tests use existing Chrome on Windows, or Playwright Chromium (`pnpm exec playwright install chromium`). The normal core and browser tests use temporary homes and a deterministic test model, never your real companion or credentials. `pnpm dev` watches the backend; after frontend edits rebuild with `pnpm build`. Production serves the frontend and API from one origin.

An **opt-in live integration test** is separate from the normal test suite:

```sh
node tests/live-ollama.ts --run <existing-glashaus-home>
```

It reads that home's saved Ollama settings using a read-only database connection. It sends synthetic conversation and public character-research requests through the selected models and saved search key, so it may consume your hosted-model/search allowance. Companion, conversation, and research test records stay in an isolated in-memory database; it does not modify the existing home, persist the copied key, or contact Telegram. The output contains synthetic replies, public source URLs, and timing, never credentials. It checks streaming, source-linked research, voice preview, memory extraction, correction, history-free and long-history recall, reflection, and backup/restore. Model-dependent content assertions can fail even when transport works.

On September 20, 2026, this live path passed with `kimi-k2.6:cloud` for conversation and utilities, plus authenticated Ollama web search. This is a point-in-time integration check, not a guarantee of character accuracy or model style: the current concise voice preview and corrected long-history recall passed; ongoing conversations still depend on model behavior.

The CI matrix covers Windows, macOS, and Linux, and is not evidence of a pass until it actually runs. The local Windows tests cover persistence, restart recovery, CSRF/origin checks, streaming, source validation, resumable research, archive round-trips, interruption priority, Telegram Unicode splitting, and the browser setup-to-chat journey.

## Code map

`app/server` — storage, model adapters, companion services, HTTP API, Telegram.

`app/web` — React screens and the prism visual system: carbon, bone, restrained typography and one optical arc.

`app/shared` — shared types. `tests` — v3 tests. `legacy-v2` — read-only historical reference, excluded from packages.

No telemetry. MIT license. Fonts include their OFL licenses. The background image is generated from the owner-approved visual direction; its prompt provenance is embedded in the PNG.
