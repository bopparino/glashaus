# Non-notification completion ledger

Owner scope, September 28, 2026: finish the remaining roadmap end to end, excluding paid native push notifications. Keep the accepted compact iPhone interface and Terminal Pastoralism direction.

Confirmed choices: cloud voice with a $25/month budget; iCloud inbox and upcoming calendars, with review before every send/change; private Tailscale access. Secrets belong in settings, not chat. Account subscriptions and provider overages are never enabled automatically.

| Workstream | Implementation | Verification / remaining acceptance |
| --- | --- | --- |
| Recurring reminders | Daily, weekdays, weekly and monthly; DST-aware anchors, pause and revision-bound approval | Backend recurrence tests pass; native controls built. |
| Natural voice conversation | ElevenLabs custom voices, local transcription, shared chat, silence submission, interruption and usage ceiling | Owner confirmed custom Elle preview, two spoken turns and interruption on iPhone. Extended latency, headphones and incoming-call trials remain. |
| iCloud mail | Read-only inbox/message access, model reading and immutable reviewed send proposals | Owner confirmed inbox reading, Read with Elle, and a reviewed test email arriving in their own inbox. |
| Calendar | EventKit selected calendars, read, verified create/update/delete proposals, conflict and before-state preview | Owner confirmed a reviewed Buy Kale event; read-back from EventKit verified it. Fixed background-service permission attribution using LaunchServices; permission and selected calendars survived a host restart. Multiple writable calendars require a destination choice. |
| Scoped MCP tools | Streamable HTTP discovery, explicit selected tools/read access, reviewed changes | Real SDK local transport and permission tests pass; no external production MCP account connected. |
| Remote connection | Private userspace Tailscale service coexists with WARP; same-certificate address recovery | Dedicated node online; streamed TLS regression reproduced and fixed. Owner confirmed address save and chat with WARP on through the encrypted-relay configuration. Extended cellular/Wi-Fi transition trials remain. |
| Home and background presets | Hero Home, compact chat, three landscape choices plus Plain, voice and connection settings | Dark/light/large-text recaptures passed the independent verdict on all three material fixes. Documentation pass preserved the incumbent design system. |
| Local chat view | Reversible Clear chat view on this iPhone; shared history/memory preserved | Native persistence, restore-earlier and new-message checks passed. Owner confirmed clearing and new messages on the installed phone. Available in Conversation’s ⋯ menu and Settings. |
| Host reliability and migration | Mac sign-in service, phone port preserved, diagnostics, verified export/isolated restore, operations guide | Managed background handoff and network service restart verified. Reboot/sleep-wake, off-machine backup and actual mini migration remain. |
| Companion evaluation | Fresh local-time and service capability guidance; existing profile/check-in cadence preserved | Calendar live model regression passed, further daily-use feedback remains. |
| Hardware and accessibility | Native Dynamic Type, dark/light themes and offline/pending states | Installed on iPhone 17 and launched. Voice, chat clearing and account writes confirmed. Full VoiceOver and extended hardware audio/network trials remain. |
| Native push notifications | Deferred by owner | Not part of this completion pass. |

Do not label account setup, real-device checks, actual Mac mini migration, or elapsed real-use trials complete on the strength of mocks or unit tests.

Latest native verification: all six XCUITest scenarios passed in one fresh-fixture run (ReleaseNativeSuite), plus the light accessibility-size visual scenario. Both browser suites passed again. Latest backend verification: 108 tests, TypeScript checks and production build pass. Browser suites passed in the prior completion batch. Native transport regression: 48 valid-pin fetch/stream requests passed and an incorrect pin was rejected; the iOS simulator stream failure also passed after explicitly applying the trust delegate to async requests. These tests supplement the owner’s private-address chat confirmation; they do not certify every radio/VPN transition.

Operational setup, recovery commands, credential handling and mini migration are documented in [OPERATIONS.md](OPERATIONS.md). This ledger intentionally separates working implementation from hardware acceptance.

## Distribution acceptance

The full-companion Mac installer was executed in a separate temporary home: pinned Node/pnpm downloads verified, frozen dependency install and production build completed, Calendar helper compiled/signed, and a managed host started with its phone listener. Clean onboarding and protection against the web-alpha update channel passed. Rerunning setup preserved the custom home/ports and restarted only that matching service. Test services were then disabled/stopped. Existing companion data was unchanged. Native signing choices, credentials, databases, backups and private reference media are excluded from the branch.

The current iPhone build was installed and launched after the final native changes. The running Mac service was restarted onto the current host code; database, model configuration, storage, certificate, startup, Calendar, voice and mail diagnostics all passed. Calendar permission remained valid after restart. A fresh verified export restored 32 messages and five memories into an isolated home.
