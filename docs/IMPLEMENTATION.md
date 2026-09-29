# Assistant development handoff

Branch `codex/companion-actions`; local unpublished changes. The existing installed companion is separate from this checkout's `.glashaus-v3` development home. No Git push, package release or App Store publication has been performed.

## Start and maintain

Use Node 24 and `pnpm install --frozen-lockfile`. For a new/manual home, `pnpm assistant` builds and runs web admin on localhost 7783 and the pinned phone API on 7784. The current owner's home is already running under launchd; open its existing Mac page instead of starting a duplicate. See [OPERATIONS.md](OPERATIONS.md) for private networking, startup, backup and mini migration.

The owner's private home uses Elle, Kimi `kimi-k2.6:cloud`, a 16,384-token context and America/New_York. Identity/credentials are private runtime data, never product defaults. Fresh checkout setup remains normal. Kimi cloud inference and requested source content leave the Mac; Ollama's API provides web search. ElevenLabs synthesizes reply text, while on-device recognition runs on the iPhone.

## Module map

| Area | Source | Behavior |
| --- | --- | --- |
| Companion | `app/server/companion.ts`, `ollama.ts` | Same persona/memory across text and voice; fresh local time and connected capabilities; bounded tool rounds. |
| Search/actions | `app/server/actions.ts` | Public search/fetch receipts; configured source reads; proposal preparation, never model confirmation. |
| Commitments | `app/server/reminders.ts`, `recurrence.ts` | Durable exact-time reminders, owner confirmation, repeat rules and wall-clock anchors. |
| Initiative | `app/server/check-ins.ts` | Grounded in-app follow-ups, provenance, stale-work invalidation, cadence/quiet-hour policy. |
| Accounts | `integration-settings.ts`, `integrations.ts`, `mail.ts`, `calendar.ts`, `connectors.ts` | Private configuration, revision-bound proposals, reviewed sends/changes and uncertain-outcome recovery. |
| Mac calendar | `scripts/GlashausCalendar.swift`, `calendar-install.ts` | EventKit permission/read/preview/write helper; no invitations or recurring/all-day edits. |
| Voice | `app/server/voice.ts`, `ios/Glashaus/VoiceView.swift` | Custom ElevenLabs voices, usage reservations, on-device recognition, playback and interruption. |
| iPhone transport | `app/server/mobile.ts`, `ios/Glashaus/Connection.swift` | Single-use pairing, hashed credentials, exact pin, same-companion address verification, explicit async trust delegation. |
| Native app | `ios/Glashaus/*.swift` | Home, compact shared chat, reminders, presets, account review/settings, reversible local clear view. |
| Operations | `startup.ts`, `background.ts`, `diagnostics.ts`, `scripts/assistant-*.ts` | Managed handoff, phone listener at sign-in, diagnostics, verified backup/restore, private network service controls. |

Schema 7 and archive schema 6 include the new records. Archives omit provider/device credentials, pause schedules, disable outreach and cancel outstanding unapproved external proposals on restore. Existing purge/update/rollback behavior was covered by the full backend suite. A lost external-write result becomes unknown and cannot automatically retry.

## Verification commands

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm assistant:backup
pnpm assistant:network status
```

The current backend suite has 108 passing tests, covering calendar preview/configuration races, immutable approvals, uncertain outcomes/restart, credential omission, live local MCP transport, voice quota/custom-rate rejection and recurrence/DST cases alongside existing regressions. Browser suites passed before the later native-only work.

Native tests run against `pnpm ios:fixture`, a disposable synthetic server on 17983/17984. They must never use the private home. Use `ios/Glashaus.xcodeproj` and the `Glashaus` scheme with simulator ad-hoc signing (`CODE_SIGN_IDENTITY=-`), not disabled signing, so Keychain remains available. The suite covers pairing, reminders, chat/memory, pending retry/revocation, connection replacement, local clear-view persistence and visual states. Current run outcomes are tracked in [COMPLETION.md](COMPLETION.md).

`tests/native-transport.swift` compiles with Models, IntegrationModels and Connection. It uses public certificate pins and deliberately no phone credential: HTTP 401 proves an authenticated TLS handshake without reading conversation data. Its latest 48 valid-pin fetch/stream requests passed and the wrong pin was rejected. An actual iOS simulator `/chat` certificate regression was separately reproduced and fixed by supplying the task trust delegate to async data/byte APIs. Tailscale IP access also has a scoped ATS exception; the transport still rejects HTTP and wrong pins.

A disposable live Kimi test, seeded with an older incorrect “only internal reminders” answer, successfully called the synthetic calendar tools and prepared a correctly dated calendar proposal without executing a write. This is stronger evidence for the capability fix than checking prompt text, but it is not a real EventKit write.

## Acceptance boundaries

The owner confirmed live inbox/calendar reading, Read with Elle, the selected Elle preview, private-address chat with WARP on, and two spoken turns plus voice interruption. The owner also confirmed a reviewed real calendar write and a reviewed email to their own inbox. Broader physical accessibility, extended everyday use, machine reboot/sleep-wake and actual mini migration are separate acceptance work. Consult the live ledger rather than treating compilation or screenshots as evidence for them.
