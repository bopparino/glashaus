# GlasHaus · Full Companion

A continuing AI companion with a practical life: shared conversation and memory, natural voice, web search, reminders, personal check-ins, and reviewed email and calendar actions. A Mac hosts the companion; a native iPhone app keeps everything together.

This is the **`full-companion` branch**. The existing web alpha and its release installers remain separate. Your character, conversations, credentials and device pairings are private data, never part of this repository.

## Install on Mac

Install [Xcode](https://developer.apple.com/xcode/) and open it once. Then run:

```sh
curl -fsSL https://raw.githubusercontent.com/bopparino/glashaus/full-companion/install-companion.sh -o /tmp/glashaus-install.sh && bash /tmp/glashaus-install.sh
```

Or download this branch, extract it somewhere permanent, and double-click **Setup Glashaus.command**. macOS may require right-click → Open for a downloaded script. You can inspect either script before running it.

Setup installs a checksum-verified private Node runtime and package manager, builds the host and Calendar helper, starts a service under your Mac account, and opens guided setup at **http://127.0.0.1:7783**. It also creates **Applications → Glashaus.command** for reopening the app. No Homebrew, sudo, shell-profile edits, or system Node replacement.

Choose an [Ollama](https://ollama.com/download) model and create your own companion. Pair the iPhone from Mac Settings. The phone app needs a one-time Xcode build with your Apple Account; free Personal Team signing works, with periodic renewal. See **[the complete setup guide](docs/SETUP.md)** for the steps Apple requires, optional voice/mail/calendar connections, and updates.

## What’s here

- Text and voice share one conversation, personality and inspectable memory. Custom ElevenLabs voices, on-device transcription and interruption are supported.
- Sourced web search, daily/weekly/monthly reminders and contextual check-ins. Reminder times are reviewed before scheduling.
- iCloud inbox reading and email drafts; selected Mac calendars with event previews and conflict information. **Every send and calendar change requires confirmation.**
- Selected MCP tools with explicit read permissions and reviewed changes.
- Home for pending work, compact chat, four background presets, and reversible **Clear chat view** on this iPhone.
- HTTPS with certificate pinning, same-Wi-Fi pairing, optional private Tailscale access, sign-in startup, diagnostics, export and restore.

The Mac must stay awake and signed in. Native push notifications are deferred; reminders/check-ins appear in the app, not as guaranteed closed-app delivery. Voice requires an ElevenLabs account; live search requires an Ollama API key. Credentials stay in app settings, not chat. Invites and repeating/all-day calendar edits remain in Apple Calendar.

[Setup](docs/SETUP.md) · [iPhone guide](docs/IOS.md) · [Operations and recovery](docs/OPERATIONS.md) · [Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Verification and limits](docs/COMPLETION.md)

## Development

Use Node 24.14+ within the 24.x line and pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm assistant
```

This developer command uses a separate `.glashaus-v3` home in the checkout. Run `pnpm ios:run` for Simulator or open `ios/Glashaus.xcodeproj` for hardware. Do not start a second process against a home already managed by the background service.

```sh
pnpm typecheck
pnpm test
pnpm build
```

Native UI tests use the disposable `pnpm ios:fixture` host. [Implementation and test details](docs/IMPLEMENTATION.md) distinguish automatic checks from live-device acceptance. Historical web-alpha instructions are preserved in [WEB_ALPHA.md](docs/WEB_ALPHA.md); its published-release installer does not install this branch.
