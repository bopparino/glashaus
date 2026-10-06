# iPhone companion and Windows host

This branch adds a native iPhone client to the v3 host. It shares the same identity, recent conversation, memories, and journal as the web and Telegram clients. The model runs through the host’s existing Ollama configuration. Use the exact Kimi model name from your installation; there is no hard-coded model alias.

## Start this version on Windows

Use this checkout, not the public one-line installer: these changes have not been released upstream. Keep a backup of your existing companion before opening it with this branch. The SQLite schema moves from 2 to 3; the old executable cannot open the upgraded database. Full JSON archives remain portable.

With Node 24 and pnpm 11.19.0 installed, run from the repository:

```powershell
pnpm install --frozen-lockfile
pnpm build
node bin/glashaus-v3.js
```

Open `http://127.0.0.1:7777` on the computer. Create or restore the companion, set the Ollama address and model, and test a message. Background startup can be enabled in Settings. Keep the computer awake while using the phone.

Two listeners bind to the computer’s loopback interface:

| Default port | Purpose |
| --- | --- |
| 7777 | Local web administration, protected by the existing Host/Origin/CSRF checks |
| 7778 | Pairing and the authenticated phone API only |

Changing `GLASHAUS_PORT` changes the phone port to the next port (65534 when the main port is 65535). Both ports must be free. Settings → Your phone shows the actual phone port.

## Give the phone a private HTTPS address

Connect the computer and iPhone to your Tailscale network. Check `tailscale serve status` first so an existing service is not accidentally replaced. For an unused default HTTPS listener:

```powershell
tailscale serve --bg http://127.0.0.1:7778
```

Use the HTTPS address Tailscale prints in the iPhone app. Serve can provide private HTTPS and run persistently; see the [official Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve). Forward the **phone port**. Keep access limited to your devices in your tailnet policy. Do not forward the administration port or expose either port through public router forwarding.

In the computer’s Settings → Your phone, create a pairing code. Enter the address and code in the app. Codes expire after five minutes, work once, and are invalidated after five incorrect attempts or a host restart. Creating another code replaces the previous one.

## Build the iPhone app

Open `ios/GlasHaus.xcodeproj` in Xcode. Select the GlasHaus scheme and your iPhone, then select your signing team and a bundle identifier you control. Run the app. A simulator build does not require an Apple signing team:

```sh
xcodebuild -project ios/GlasHaus.xcodeproj -scheme GlasHaus \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
swift test --package-path ios
```

For a local signing configuration that stays out of source control, create `ios/Signing.local.xcconfig` with `DEVELOPMENT_TEAM = YOUR_TEAM_ID`. The project loads it optionally for both build configurations. Simulator builds work without this file. A development installation expires on the date in its provisioning profile and must then be rebuilt/reinstalled; it is not an App Store distribution.

The deployment target is iOS 17. The client uses SwiftUI and system controls with light, dark, and system appearance. It has three tabs:

- **Chat:** recent shared history, streaming replies, stop, and a saved retry that reuses its original message ID after a connection failure or app restart.
- **Memory:** search, add, correct, and forget memories; inspect evidence; read and request journal reflections.
- **Settings:** identity, relationship, voice, continuity documents, conversation/utility models, context size, evening reflections, appearance, connection, backup export, and device disconnection.

The host’s startup, provider addresses and credentials, full data deletion, and archive restore stay in the computer’s Settings. The phone shows the latest 200 turns in the order they entered the conversation, regardless of differences between host clocks; the complete history remains in the host and exported backup. Refresh the screen to pick up edits from another client. The app cancels an active reply when backgrounded and retains its retry. It does not implement notifications, offline model inference, or voice calling.

## Updating a phone-enabled host

Keep using the same `GLASHAUS_HOME` and `GLASHAUS_PORT`. Let any reply finish, stop the old process, rebuild this checkout, and start the updated host. The existing conversation and paired-device credentials stay in that home; the phone does not need to pair again for an ordinary host update. Do not import an older snapshot over an existing home.

A migration from a computer with a faster clock can give imported messages timestamps later than newly written replies. History now follows append order rather than wall-clock timestamps, so refresh and restart keep new exchanges at the end. Backups preserve that order and original timestamps. A retry updates its existing exchange without moving it.

For a host that also runs personal Cloudflare WARP, see [WARP and Tailscale](WARP-TAILSCALE.md). The read-only diagnostic script reports connection health without changing either VPN.

## Connection and data behavior

The iPhone requires HTTPS with a certificate trusted by iOS and rejects redirects. Its connection token and pending retry use device-only Keychain entries accessible while unlocked. It does not persist the conversation transcript or the Ollama API key. The host stores only a hash of each device token. Device credentials are excluded from backups.

Disconnect revokes the phone’s key on the host and cancels its active requests. Forget connection works offline and removes the local key; revoke that device on the host separately. Full host purge removes paired devices. Companion-only deletion retains connection settings; paired phones will see the next companion created in that home. Treat pairing as permission to access the whole companion home.

## Voice consistency

The shared prompt requests direct unquoted dialogue and first-person self-actions when roleplay is appropriate. Streaming holds a potentially drifting suffix for one contextual utility-model review before displaying or saving it. Genuine quotes, other people’s pronouns, code, and explicitly requested narration remain valid. Already displayed text cannot be rewritten by the check.

Malformed or interrupted reviews produce a retryable error and do not persist the withheld draft. Ordinary replies without risk markers do not need a second model call. This is a bounded style check, not a guarantee of perfect behavior: the utility model can still misclassify intent. Check real Kimi replies before moving your everyday companion over.

## Soul capsules

Use the continuity interview in `docs/capsule-interview.txt`, then review the answers against the original conversation export. Preserve the export separately. A capsule carries authored persona and selected memories; it does not transfer ChatGPT’s model or automatically reproduce every detail of its behavior.

The importer accepts `glashaus-soul-capsule` version 1. Optional top-level `userName` and `pronouns` preserve the user’s preferred address and companion pronouns. Documents map to these runtime fields:

| Document | Runtime use | Character limit |
| --- | --- | --- |
| SOUL | Personality | 8,000 |
| IDENTITY | Relationship | 6,000 |
| VOICE | Voice | 5,000 |
| USER | User context | 4,000 |
| LEXICON | Shared vocabulary | 4,000 |
| DIALOGUE | Labeled voice examples | 6,000 |

These are upper bounds, not targets. Their combined size must also fit the configured model context. Long sections are shortened for runtime use with an import warning; the entire original packet remains in the backup. Examples stay separate from actual turns. `identity_facts` can carry category `user`, `companion`, or `relationship`, plus an `evidence` field. Include only reviewed, supported facts there; keep authored fiction, inferences, and unresolved questions labeled in the documents. Retrieval passes the evidence label to the model so imported reports are distinguishable from directly recorded conversation. This is provenance context, not automatic fact verification.

## Release checks

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:browser`, and `node tests/portable-smoke.cjs .`. The browser suite uses a synthetic model. The native connection contract tests run with `swift test --package-path ios`; CI also compiles the iPhone app.

Before everyday use, verify on the actual Windows/iPhone pair: HTTPS pairing; reconnect after phone and host restart; stop and retry without duplication; revoke while streaming; large-text and dark-mode screens; identity edit conflicts; memory corrections; backup restore into a separate empty home; and Kimi’s behavior on a small set of reviewed examples of the intended voice and perspective drift. Simulator results do not establish Windows service behavior, cellular/Tailscale reliability, or live-model quality.

### Initial live-provider check (2026-10-05)

Eight isolated non-graphic checks completed with `kimi-k2.6:cloud` through Ollama 0.35.1 at context 16,384. First-person scene actions, legitimate quotations, unsupported-memory rejection, demonstration provenance, candidate preferences, practical help and a quiet-conversation request were exercised. No trial turn was saved in the actual companion home. A malformed voice-review decision/reason combination found during the first run was addressed with explicit branch instructions and regression coverage. Voice quality still varies; a short sample is not proof of long-term persona consistency.
