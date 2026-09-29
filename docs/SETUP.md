# Full companion setup

Start with this branch's installer or **Setup Glashaus.command**. It builds the Mac host, creates the native Calendar helper, enables a per-user sign-in service and opens the setup page. Allow several minutes for the first download and build. This is a source distribution, not a notarized Mac/iPhone App Store package.

## 1. Prepare the Mac

Install Xcode from the Mac App Store and open it once to finish its components/license prompts. Full Xcode is required for the iPhone build; the host's Calendar helper needs Swift tools. Use an Xcode version with an iOS SDK supporting the project's iOS 26 minimum.

Install [Ollama](https://ollama.com/download), open it, and make a model available. For Ollama cloud models, sign into Ollama and choose an available cloud model; local models need enough memory on your Mac. The installer does not download a large model or enroll you in paid accounts.

Run the README installer. The default locations are:

| Item | Location |
| --- | --- |
| Source/build | `~/Applications/Glashaus` when installed by terminal |
| Companion and settings | `~/Library/Application Support/Glashaus/Companion` |
| Private Node/pnpm | `~/Library/Application Support/Glashaus/Runtime` |
| Open shortcut | `~/Applications/Glashaus.command` |
| Mac setup page | `http://127.0.0.1:7783` |
| Private phone API | HTTPS port `7784` |

Keep the source folder and runtime in place; the service records their paths. `GLASHAUS_INSTALL_ROOT`, `GLASHAUS_HOME`, `GLASHAUS_PORT` and `GLASHAUS_MOBILE_PORT` select alternate folders/ports. An occupied port owned by another companion stops setup without replacing that service. `--check` checks prerequisites; `--no-start` downloads/builds without starting a service. Existing web-alpha data is not imported automatically.

## 2. Create your companion

Open the Mac page, check the Ollama address, select a model and complete the identity setup. Use your own name, companion name, description and relationship preferences. Start with a brief greeting to verify the model.

In Mac Settings, enable assistant tools and enter an Ollama API key if you want web search. Never paste credentials into conversation. Set the correct time zone. Choose the check-in window and frequency you want; the check-ins stay inside Glashaus while native push remains deferred.

## 3. Put Glashaus on your iPhone

1. Open `ios/Glashaus.xcodeproj` in the installed folder. Do not regenerate the project.
2. Add your Apple Account in **Xcode → Settings → Accounts**. Select the **Glashaus** target, **Signing & Capabilities**, and your Personal Team. If Xcode says the bundle identifier is unavailable, choose a unique identifier for your own build.
3. Connect and unlock the iPhone, trust the Mac, enable Developer Mode if requested, select the phone as the Run destination and press Run.
4. Follow the phone's developer-trust prompt if needed. A free Personal Team installation expires periodically; use Run in Xcode to renew it. Installing a new build with the same identity preserves pairing and data. Do not delete the app to update it.
5. In the Mac page, open **Settings → Your iPhone** and create a pairing link for the Mac's Wi-Fi address. Transfer it privately to the phone, paste it into Glashaus and tap **Connect to Mac**. Allow Local Network access.

The link expires after five minutes and is single-use. It establishes the certificate pin and a device credential. The Mac admin page remains local-only. No router port forwarding is required.

For a simulator, run `pnpm ios:run` from a development checkout, or use Xcode's iPhone simulator destination, then pair with the loopback address supplied in Mac Settings. A simulator does not establish physical-device audio, privacy or network behavior.

## 4. Connect the optional services

In the iPhone app, open **Settings**:

- **Voice:** enter your ElevenLabs API key, load voices, select a voice you created or an included voice, save and preview. Use the provider's included-credit plan within your budget, keep overage billing off, and set Glashaus's monthly character ceiling. The app excludes custom-rate voices and checks available credits; other apps using the same account also consume its allowance.
- **Connections → iCloud Mail:** enter your email and an [Apple app-specific password](https://support.apple.com/102654), enable access, save, and test the inbox. Never use your Apple Account password here. Reads do not mark mail read or fetch remote images. A send requires your review in Home.
- **Connections → Calendar:** first enable the account in Apple Calendar on the Mac. Tap **Connect Calendar**, then allow **Glashaus Calendar** in the **Mac's** permission prompt. Select calendars and save. If a prompt was declined, use **Open Calendar permissions on Mac**, enable the helper in Privacy & Security → Calendars, then connect again. Permissions do not appear on the phone. When several writable calendars exist, specify which one and an end time/duration. Calendar events and internal reminders are separate.
- **Connections → Tool servers:** add a trusted Streamable HTTP MCP endpoint and select allowed tools. Read execution needs an explicit read grant. Other changes are proposed for review. OAuth and local stdio servers are not implemented.

Mail/calendar content you ask the companion to read enters the configured model's conversation. Speech transcription runs on device where supported; reply text goes to ElevenLabs. Provider credentials live in the Mac's private database, excluded from companion exports. The database fields are protected by filesystem permissions, not separately encrypted in Keychain.

## 5. Daily use and remote access

Use Home for pending reminders, external proposals, inbox and calendar. Conversation's **⋯ → Clear chat view** hides earlier messages only on that iPhone; **Show earlier messages** restores them. Memory and shared history remain saved.

The Mac must be awake, signed in and connected. The installer does not disable sleep. After a reboot, sign in/unlock FileVault before expecting the service. Keep the Mac plugged in for unattended use and choose suitable power settings yourself.

For private remote access, install [Tailscale](https://tailscale.com/download) on Mac and iPhone, sign into the same account, and put the Mac's Tailscale IPv4 HTTPS address in **Settings → Mac connection**. Keep the same certificate pairing. Test a message with iPhone Wi-Fi off before relying on remote access. Some VPNs conflict; [OPERATIONS.md](OPERATIONS.md) documents the tested userspace/relay arrangement for WARP. The installer does not change VPN settings or expose a public endpoint.

## Update, stop, and recover

Export a backup in Mac Settings before updating. Keep any local Xcode signing choice in ignored `ios/Local.xcconfig` (`DEVELOPMENT_TEAM = your-team-id`) if you want it to survive a clean Git update.

For a Git installation with no local source changes:

```sh
cd ~/Applications/Glashaus
git pull --ff-only origin full-companion
./Setup\ Glashaus.command
```

The installer rebuilds first, then restarts its matching background host. It refuses to replace another companion's service. Update the iPhone with Run in Xcode after an iOS source change. The Mac and phone do not silently install each other's updates. The web alpha's automatic updater is disabled for this branch installation.

The private Node path is in the locally generated `full-companion-install.json`; the `Glashaus.command` shortcut uses it automatically. With Node 24 on PATH, these commands work from the installed folder:

```sh
node bin/glashaus-full.js service status
node bin/glashaus-full.js service disable
node bin/glashaus-full.js service stop
node bin/glashaus-full.js open
node bin/glashaus-full.js backup
node bin/glashaus-full.js iphone
```

Disable stops future sign-in launches; stop ends the current service; open starts it again if absent. Neither removes companion data. A failed account write is marked uncertain if its response was lost; check Calendar or sent mail before preparing another proposal. See [OPERATIONS.md](OPERATIONS.md) for backups and migration.
