# Running the private Mac companion

For new installations, use [SETUP.md](SETUP.md). This guide also covers a source checkout with a separate development home. Native push remains deferred. See [completion evidence](COMPLETION.md) for what has and has not been tested on hardware.

## Daily use

The installer runs Glashaus as a macOS sign-in service. The native app uses the same companion, settings and conversation as the Mac page at `http://127.0.0.1:7783`. Keep the installed source folder and companion home in place while that service is registered. Installer data lives in `~/Library/Application Support/Glashaus/Companion`; development data uses `.glashaus-v3`. Do not start a second copy against the same home.

- Open the Mac page to manage the model, export data or change startup.
- Use **Settings → Mac connection → Mac diagnostics** on iPhone to check data integrity, storage, certificate expiry and configuration.
- The Mac must be awake, signed in, and connected. Closing the lid or sleeping it can interrupt service; this build does not override macOS power settings. Screen lock alone does not stop the process. FileVault still requires an interactive unlock after reboot.
- A free Personal Team iPhone build needs periodic re-signing in Xcode. Open `ios/Glashaus.xcodeproj`, retain the selected team, and Run on the phone. Do not regenerate the project for routine builds.

The main service's current identifier is returned by `GET /api/startup`. It restarts after failure through launchd. Its private registration and startup log are in `.glashaus-v3/startup/`. The successful handoff was verified with `enabled=true` and `managed=true`; a full machine reboot was not performed during this work.

If no service is running, `pnpm assistant` builds and opens the manual host on the same development ports. To hand it back to launchd, enable background startup in the Mac Settings page. An already occupied port is a reason to open the existing host, not start another database process.

## Private access while WARP stays on

In the verified setup, WARP was required for reliable internet. The normal Tailscale network extension could not reach its control plane alongside WARP, so that Mac uses a separate **userspace** Tailscale node named `glashaus-host`. It adds no VPN tunnel and does not take over DNS or the default internet route. The iPhone uses its normal Tailscale app and the same account.

The network service is stored in `~/Library/Application Support/Glashaus/Network` and starts at sign-in through `~/Library/LaunchAgents/net.glashaus.private-network.plist`. Its Tailscale state is private and is not a companion backup. A temporary `TS_DEBUG_ALWAYS_USE_DERP=true` diagnostic currently forces encrypted relay traffic because the direct WARP path was unstable. This is a debug setting, not a promised stable Tailscale interface; recheck it on upgrades. The owner confirmed address save and chat with WARP enabled; extended network-transition trials remain. Only TCP port 7784 is forwarded to Glashaus's existing pinned HTTPS listener. The browser admin port is not exposed. Tailscale Funnel is not enabled.

```sh
pnpm assistant:network status
pnpm assistant:network stop
pnpm assistant:network start
```

`status` prints the current iPhone address. In the iPhone app, paste that address under **Settings → Mac connection → Wi-Fi or Tailscale**, then choose **Use this Mac address**. A failed/pending message stays saved for retry. Stop an actively waiting reply before switching. Address updates must authenticate the already paired certificate and the same companion before saving; a new Mac identity requires a fresh pairing link.

Use the current HTTPS IPv4 address printed by `pnpm assistant:network status`, with port 7784. Old addresses stop working after a new node is enrolled. A dedicated userspace service need not appear connected in the Mac Tailscale menu-bar app.

The service uses Tailscale 1.102.4, obtained from the official Homebrew formula's macOS ARM64 bottle, verified against its SHA-256 and installed without Homebrew. Its `provenance.json` records the source and checksum. The app and certificate still enforce HTTPS and exact certificate pinning. The iOS ATS exception is limited to Tailscale's `100.64.0.0/10` range to permit private trust anchors; global arbitrary network loads remain disabled. Async data and streaming requests explicitly use the same trust delegate.

For installation on another Mac, prefer the standard Tailscale app if it coexists with that machine's VPN. Where userspace mode is needed, follow [Tailscale's macOS daemon instructions](https://github.com/tailscale/tailscale/wiki/Tailscaled-on-macOS) and [userspace networking](https://tailscale.com/docs/concepts/userspace-networking). Run a current trusted binary as your user with `--tun=userspace-networking`, a private state directory and a Unix socket. Sign in interactively, use `--accept-dns=false`, then configure private `tailscale serve --bg --tcp=7784 tcp://127.0.0.1:7784`. Do not copy another machine's Tailscale state or expose a public Funnel as a shortcut.

## Voice and account connections

Choose your created or included voice under **Settings → Voice → Save key and load voices**, save and preview it. Voice Design voices are supported. Voice listing excludes custom-rate voices; speech rechecks voice availability and included credits before reserving local usage. The local monthly ceiling includes attempted/interrupted synthesis. Keep provider overage billing off; concurrent use of the same ElevenLabs account outside Glashaus can consume its shared allowance.

Speech recognition runs on the iPhone when on-device recognition is supported. Reply text is sent to ElevenLabs to synthesize audio. Text/voice share conversation history and the chosen Ollama model. Glashaus does not retain audio files. Pauses submit speech; **Interrupt** stops playback/current generation; **End**, leaving the app, or losing the audio route stops the microphone. Provider processing and retention follow the provider account's settings.

iCloud Mail uses IMAP for inbox reads and SMTP for reviewed sends with an Apple app-specific password. Inbox reads do not mark mail read or fetch remote images. Calendar uses the Mac’s EventKit account and selected calendars. Its helper launches through LaunchServices with its own permission identity; it does not inherit the terminal’s or Node’s consent. Connect Calendar opens the permission request on the Mac. A denied request needs System Settings → Privacy & Security → Calendars; the phone includes a button to open that panel. The helper uses an available signing certificate to preserve consent across rebuilds, with ad-hoc signing as a fallback. New events, supported edits/deletions, email sends and connector writes become exact proposals in Home. The owner must confirm each one. Calendar proposals include the actual destination and available conflict information. Invitations, all-day and recurring event edits are managed in Apple Calendar.

Provider credentials stay in the private Mac database, not on the iPhone or in exports. File permissions protect the home; these database fields are not separately encrypted in Keychain. Keep the home on a protected user account/FileVault volume. A provider response lost during a write produces **unknown**, not a blind retry: check the destination before making another proposal.

## Backups and a future Mac mini

```sh
pnpm assistant:backup
```

This exports the running service, restores it to a separate temporary home, checks database integrity, then saves a private archive under `.glashaus-backups/`. It excludes credentials. A restored home pauses scheduled reminders, disables outreach and cancels unapproved external proposals; review them before re-enabling activity. Copy selected verified archives to a backup destination you control. Automatic off-machine backup is not configured.

For a Mac mini migration:

1. Create and retain a verified export; keep the old Mac as the sole primary until the new home is reviewed.
2. Install Node 24, the project dependencies and Ollama/model access on the mini. Build the host and run `pnpm calendar:install` on that Mac.
3. Start a separate home, import the archive, reconnect voice/mail credentials and approve the mini's Calendar permission. Confirm history, memory, reminders and proposal outcomes before enabling any schedule.
4. Stop the old primary service and its network forwarding before enabling schedules/outreach on the mini. Never leave two active schedulers for the same companion.
5. Sign the mini into Tailscale as a new node. Create a fresh phone pairing link from the new host; do not assume the old certificate pin applies.
6. Review paused reminders and outreach preferences, enable sign-in startup, and test a chat, a reviewed calendar event and cellular access. Keep the old home as a rollback copy until these checks pass.

The isolated archive/restore drill has passed. Actual hardware migration, power-cycle recovery, and a longer unattended trial remain physical acceptance work.
