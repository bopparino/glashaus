# GlasHaus v3 · alpha

A local-first home for a continuing AI companion. Built around Ollama, with a new web interface, character research, portable identity, shared Telegram conversations, and memories you can inspect.

This is a **fresh alpha**, not a drop-in v2 upgrade. Existing v2 source is preserved in `legacy-v2/`; v3 never opens or changes a v2 database.

## Start the built app

Requires Node **24.14 or newer within the 24.x line**, and Ollama with a model available. Extract the portable release archive, then:

```sh
node bin/glashaus-v3.js
```

Open **http://127.0.0.1:7777**. In Settings, check the Ollama address and choose a model. Then create a companion. Keep the terminal running; Ctrl+C stops the app. Data survives restarts.

The default home is `~/.glashaus-v3` on every OS. `GLASHAUS_HOME` selects another home, and `GLASHAUS_PORT` selects another port. One companion per home. The server binds to localhost only; remote web access is not included. Use Telegram when away from the computer.

## One-command installation

The included installers download the prebuilt `glashaus-v3.zip` asset from a GitHub release. They require Node 24 and do not install Ollama, download a model, change your PATH, start at login, or modify v2 data.

The commands below install **v3.0.0-alpha.2**. They require its [published release assets](https://github.com/bopparino/glashaus/releases/tag/v3.0.0-alpha.2); a pending or failed release check will not publish an unverified app.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/bopparino/glashaus/main/install.ps1 | iex
```

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/bopparino/glashaus/main/install.sh | sh
```

For safer inspection, download the script, read it, then execute it. Set `GLASHAUS_RELEASE_TAG` to select a different v3 release. The default is pinned to the version above so GitHub's stable-release listing cannot accidentally select v2. Installs use separate unique directories under `~/.local/share/glashaus`; the companion data directory is separate. Retired app versions are not deleted automatically.

## What works in this alpha

- **Character absorption:** provide a name, originating work, and optional scope. Ollama web search/fetch retrieves public sources; the local/configured utility model writes an editable foundation. Sources, claims, and uncertainty are visible. Saved research resumes after interruption.
- **Authored / grow / restore:** write a persona, start with a name and minimal foundation, restore a v3 JSON archive, or import a v2 soul capsule. Set your relationship separately and preview their voice before saving.
- **Conversation:** streamed replies, stop/retry, persistent history, context budgeting, and separate conversation/utility models. Duplicate request IDs do not generate duplicate replies.
- **Memory:** supported details and explicit companion opinions are extracted after replies, with exact-quote evidence. Explicit corrections can supersede old memories and opinions; manual edits are protected from automatic replacement. Inspect, edit, add, search, filter, or forget. Extraction can be wrong; it is not a fact checker.
- **Journal:** on-demand reflections and optional daily reflection after 9pm while running. A minimal grow persona can form conversational preferences; autonomous identity rewriting is not included yet.
- **Telegram:** private text chats, owner-only pairing, initial-connect retries, rate-limit backoff, clear polling/webhook conflict errors, typing/draft updates where supported, long-message splitting, shared memory and history, `/status` and `/memory`. Do not run v2 and v3 with the same bot token at once. Delivery retry is at-least-once; an ambiguous network failure may duplicate a delivered message.
- **Backup:** v3 archive export/restore includes identity revisions, conversations, active and forgotten memories, reflections, and character research. Credentials and machine settings are excluded. Restore requires an empty home and is atomic.

## Privacy and limitations

Model inference follows your Ollama configuration. `:cloud` models use hosted inference, even when Ollama itself runs locally. A remote Ollama address sends context to that server. Character search sends the character name, work, and scope to Ollama's hosted search; it does not send your relationship or chat history. Telegram uses Telegram's servers.

Saved credentials and conversations are **not encrypted at rest**. They are in your v3 SQLite file and should be protected with your OS account and disk encryption. The web API uses loopback Host/Origin checks and a per-process mutation token, not remote-user authentication. Do not expose this service through a public proxy.

Forgetting removes a memory from recall; it is not a secure wipe. Original chats, revisions, and forgotten records remain in exports. Imported archive extension fields are retained for recovery. Treat every backup as private.

Not yet included: full v2 database migration, embeddings, automatic backup rotation, proactive outreach, voice/photos, autonomous self-authorship, remote web authentication, and a background OS service. A v2 soul capsule is identity transfer, not full conversation restoration. v2 commands are not available through the v3 CLI.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm start
```

Use Node 24 and pnpm 11. Browser tests use existing Chrome on Windows, or Playwright Chromium (`pnpm exec playwright install chromium`). The normal core and browser tests use temporary homes and a deterministic test model, never your real companion or credentials. `pnpm dev` watches the backend; after frontend edits rebuild with `pnpm build`. Production serves the frontend and API from one origin.

An **opt-in live integration test** is separate from the normal test suite:

```sh
node tests/live-ollama.ts --run <existing-glashaus-home>
```

It reads that home's saved Ollama settings using a read-only database connection. It sends synthetic conversation and public character-research requests through the selected models and saved search key, so it may consume your hosted-model/search allowance. Companion, conversation, and research test records stay in an isolated in-memory database; it does not modify the existing home, persist the copied key, or contact Telegram. The output contains synthetic replies, public source URLs, and timing, never credentials. It checks streaming, source-linked research, voice preview, memory extraction, correction, history-free and long-history recall, reflection, and backup/restore. Model-dependent content assertions can fail even when transport works.

On September 20, 2026, this live path passed with `kimi-k2.6:cloud` for conversation and utilities, plus authenticated Ollama web search. This is a point-in-time integration check, not a guarantee of character accuracy or model style: the current concise voice preview and corrected long-history recall passed; ongoing conversations still depend on model behavior.

The CI matrix covers Windows, macOS, and Linux, and is not evidence of a pass until it actually runs. The local Windows tests cover persistence, restart recovery, CSRF/origin checks, streaming, source validation, resumable research, archive round-trips, interruption priority, Telegram Unicode splitting, and the browser setup-to-chat journey.

## Code map

`app/server` — storage, model adapter, companion services, HTTP API, Telegram.

`app/web` — React screens and the prism visual system: carbon, bone, restrained typography and one optical arc.

`app/shared` — shared types. `tests` — v3 tests. `legacy-v2` — read-only historical reference, excluded from packages.

No telemetry. MIT license. Fonts include their OFL licenses. The background image is generated from the owner-approved visual direction; its prompt provenance is embedded in the PNG.
