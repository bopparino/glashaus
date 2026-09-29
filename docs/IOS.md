# Private iPhone app

The SwiftUI app is `ios/Glashaus.xcodeproj`. It targets iPhone with iOS 26 minimum; this work used iPhone 17, Xcode 27 and iOS 27. It is privately installed through the owner's Personal Team, not submitted to the App Store. Push notifications remain deferred.

## Run or update

If the Mac sign-in service is running, open `http://127.0.0.1:7783`. Otherwise run `pnpm assistant` from the repository root. In a second terminal, `pnpm ios:run` builds and launches the simulator. Set `GLASHAUS_SIMULATOR_UDID` to select another installed simulator.

For hardware, open the existing Xcode project, retain the selected Personal Team, select the trusted/unlocked iPhone and Run. Free signing requires periodic renewal. Do not regenerate the project for a routine build. Simulator ad-hoc signing is required for Keychain; do not set `CODE_SIGNING_ALLOWED=NO`.

## Pair once

1. In the Mac app, open **Settings → Your iPhone** and choose the correct private address. Simulator uses loopback; hardware uses Wi-Fi or the private Tailscale endpoint described in [OPERATIONS.md](OPERATIONS.md).
2. Create a pairing link and transfer it privately to the iPhone. Paste it in Glashaus and choose **Connect to Mac**. The link expires after five minutes and works once. Do not share it in messages or public logs.
3. Allow iPhone Local Network access and the Mac's incoming connection prompt when applicable. No router forwarding is needed.

The phone API uses authenticated HTTPS on 7784; web admin remains loopback-only on 7783. The pairing pins the exact certificate and stores the token in Keychain. Phone cache/pending-message files use complete file protection and are excluded from backups. Phone provider credentials are never stored in this app.

## Everyday navigation

- **Home:** date/greeting, message/talk actions, check-ins and pending work, then Reminders, Calendar and Inbox. External proposals have a dedicated review screen before confirmation.
- **Conversation:** shared history, live replies, cited sources, compact composer, voice entry, Stop and preserved retries. **⋯ → Clear chat view** beside the voice button (also in Settings → Shared history) hides earlier messages only on this phone. **Show earlier messages** restores them. Shared history and memories stay saved; new messages remain visible.
- **Settings:** identity, check-in preferences, memory/journal, background presets, custom voice, account connections and Mac maintenance. The background choices are Far field, Field quiet, Night relay and Plain.

Reminders are internal Glashaus records. Calendar events require a Calendar proposal. Saving/editing a reminder draft never schedules it; its exact revision must be confirmed. Repeat choices are daily, weekdays, weekly and monthly. Check-ins follow the owner's 9 am–9 pm, at-most-two cadence and appear inside the app. Closed-app delivery is not implemented.

Voice uses on-device speech recognition plus the chosen ElevenLabs voice. Pauses submit speech; Interrupt stops generation/playback, End stops capture, and leaving the app or losing the audio route stops listening. Missing voice configuration leads to Voice settings. The owner has verified custom Elle playback, two spoken turns and interruption.

## Recover a changed address

Under **Settings → Mac connection → Wi-Fi or Tailscale**, enter the new HTTPS address and tap **Use this Mac address**. The app authenticates the existing pin and checks the same companion before saving. A pending failed message is preserved and can be retried after reconnection; an active reply can be stopped first. A genuinely different Mac identity requires a new pairing link after resolving any pending message.

Cached views are labeled offline and changes are disabled while unavailable. Revocation interrupts streams and clears the phone after it observes the revoked credential; it cannot erase an offline phone remotely. Forget this Mac removes only the local pairing/cache; revoking access on the Mac is a separate action.

The owner's WARP must stay on. A dedicated userspace Tailscale node and documented relay workaround provide the private address; the regular Mac Tailscale menu-bar state is not that service's status. The owner confirmed address save/chat through the dedicated node. See the operations guide for the current address and start/stop/status commands.

## Verification and remaining trials

Physical checks have confirmed Personal Team install/trust, pairing, shared chat, reminder confirmation, Elle's profile/cadence preferences, iCloud reads, custom voice preview, spoken turns and interruption. The [completion ledger](COMPLETION.md) records confirmed calendar/mail writes, remaining network-transition trials, and native suite results.

Dark default-text and light Accessibility Extra Large screenshots cover Home, chat, presets, exact email review, connections and configured/unconfigured voice. Dedicated regression tests cover local clear-view persistence, preserved pending-message address recovery and revocation. Current software-keyboard geometry, full VoiceOver navigation, headphones/incoming-call interruption, prolonged voice latency and sleep/wake still require separate acceptance; a successful screenshot does not prove those behaviors.
