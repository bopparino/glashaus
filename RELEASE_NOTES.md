# GlasHaus v3.0.0-alpha.4

A fresh Ollama companion app with a shared web and Telegram conversation, inspectable memory, and portable identity.

Alpha.4 adds optional background startup during setup, restore, and in Settings. Windows uses a per-user scheduled task, macOS uses a LaunchAgent, and Linux uses a systemd user service. It switches the current session into the background without running two Telegram pollers. Manual start remains the default. There is no new database migration.

## Install

Install Node.js 24.14 or newer in the Node 24 line and Ollama first. Start Ollama and pull or select a model. Then run one command:

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/bopparino/glashaus/main/install.ps1 | iex
```

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/bopparino/glashaus/main/install.sh | sh
```

The installers check the ZIP's SHA-256 before running it. To inspect first, download and read the script instead of piping it. macOS/Linux also need curl and unzip.

Open http://127.0.0.1:7777, set your Ollama model, and create or restore a companion. Choose **Run in the background and start at sign-in** if you want to close the terminal. Leave it unchecked for manual start. Your companion's data lives separately in `~/.glashaus-v3`.

Background startup runs as your own user, not as an administrator. Your PC must be awake and Ollama available. Linux needs a working systemd user session; running before sign-in needs separately configured lingering. Turn off sign-in startup in Settings, or use `node bin/glashaus-v3.js service disable` from the install folder. Use `service stop` to stop a background session, and `service status` to find its log. Before moving or replacing an installation, disable and stop its service first.

You can also extract `glashaus-v3.zip` and run `node bin/glashaus-v3.js` without installing app dependencies.

## In this build

- Authored, grow, and backup-based setup; character research from public sources using an Ollama API key.
- A carbon-and-bone web interface for desktop and phones, with streamed conversation and editable conversation starters.
- Telegram owner pairing, shared conversation, reconnects, rate-limit handling, and delivery recovery.
- Evidence-backed memory and opinions, manual corrections, forgetting, reflection, and JSON backup/restore.
- Separate conversation and utility models; local models or Ollama cloud models.

## Read before upgrading

This is an alpha, not feature parity with v2. The full Git history and `legacy-v2/` remain available. V3 never opens the v2 database. Export a v2 soul capsule to carry supported identity and memories into v3; full v2 chat migration is not included.

Back up existing v3 data before upgrading. Alpha.2 adds schema-2 memory correction tables. Do not run alpha.1 against an upgraded database.

Voice, photos, scheduled outreach, and full v2 conversation migration are not included. Forgetting excludes a memory and its source exchange from later recall, but does not securely erase the private archive. Memory extraction can be wrong. An ambiguous Telegram network failure can cause a duplicate delivery.

The release workflow requires Windows, macOS, and Linux checks, including a real background-service lifecycle on each disposable runner, before publishing these assets. Live Kimi K2.6 cloud tests and a real Telegram pairing/reply were also verified during development.
