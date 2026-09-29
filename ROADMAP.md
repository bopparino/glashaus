# Glashaus delivery roadmap

September 28, 2026 · Core non-notification scope implemented; hardware acceptance recorded · Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)

## Current delivery scope

The owner approved completing the remaining assistant work **except native push notifications**. Cloud voice is budgeted at up to $25/month; inbox/calendar reads are allowed, and every send or calendar change requires review. Remote access uses a private Tailscale connection with WARP kept on. The accepted compact native design now includes Home and selectable backgrounds. Clear chat view is local to the iPhone and preserves shared history/memory.

Implemented: recurring reminders; ElevenLabs voice conversation; iCloud inbox reading and reviewed send proposals; EventKit reads and reviewed event proposals; scoped MCP tools; hero Home/presets; sign-in startup, diagnostics and verified backup/restore. The owner confirmed live inbox/calendar reading, Read with Elle and the created Elle voice preview. Model calendar-proposal regression passes after fixing stale capability guidance.

The owner confirmed private-address chat with WARP, two spoken turns and interruption, local chat clearing, an approved calendar event read back from EventKit, and an approved email arriving in their inbox. Fresh installation and background restart were tested in an isolated home. Broader network transitions, power-cycle recovery and physical accessibility remain separately scoped trials. The [completion ledger](docs/COMPLETION.md) is the current source of truth; [operations](docs/OPERATIONS.md) explains the running setup and recovery.

The stages below retain the broader acceptance horizon. Native push is expressly deferred; a future mini migration, longer personal trial, complete VoiceOver review and machine reboot/sleep trials remain distinct from simulator and isolated restore evidence.

## Stage 0 — Establish the development baseline

**Outcome:** a reproducible Glashaus development copy, isolated from the real companion's data.

- Work from the actual Glashaus repository and account for any existing local changes before choosing a branch/worktree.
- Run the repository's appropriate baseline checks and a setup/chat/memory regression path with a disposable home.
- Record the existing companion behavior that must survive: tone, memory correction, continuity, web/Telegram sharing, stop/retry, backup/restore, and deletion behavior.
- Native toolchain verified after installation: Xcode 27.0 (27A266a), iOS 27.0 SDK/runtime, and an iPhone 17 simulator. Free-account Personal Team signing, physical-phone installation, and first launch have passed.
- Implementation now lives in this Glashaus checkout, prepared for the `full-companion` branch, based on `c50e1dc5d0b6c84a3c36d6d6b3be69ae86ba6faa`. `pnpm assistant` uses an isolated development home.

**Exit evidence:** baseline results, a documented start command, a disposable data directory, and a known source revision. No live credentials are copied into test fixtures.

## Stage 1 — Useful actions and dependable commitments

**Outcome:** the existing companion can search during conversation and reliably track a requested reminder.

Build the action registry, permission checks, bounded tool loop, durable task records, and due-job scheduling. Reuse Ollama search/fetch. Add message/action records and migrations without losing existing history. Provide a small inspect/edit/cancel view for tasks in the current client.

**Acceptance scenarios:**

1. Ask for a French dinner idea. The companion retrieves sources, cites what it used, and continues in its existing voice.
2. Ask for a reminder at a specific local time. It saves a draft and displays the exact time/timezone; only the user's one-tap confirmation schedules it. Editing requires confirmation again.
3. Stop and restart the service. The task remains scheduled and creates one logical due event.
4. Cancel or reschedule it. The old occurrence cannot later fire.
5. Simulate an unavailable provider, a rate limit, a malformed tool call, and a lost connection. The companion reports the actual state and does not invent completion.
6. Test ambiguous dates, timezone changes, daylight-saving transitions, and sleep past a due time using a controlled clock.
7. Put instruction-like text into a search result. It cannot grant tool permissions, confirm a reminder, send mail, or change a schedule. Any model-proposed reminder remains an unconfirmed draft.

**Exit evidence:** repeatable tests for those failures plus a real Ollama/search run authorized for the selected provider. An in-app due message proves scheduling; it does not yet prove closed-app phone notification delivery.

## Stage 2 — A private native iPhone client

**Outcome:** converse with the same companion and manage its commitments from a real iPhone.

Before UI code, review native visual directions grounded in the selected Terminal Pastoralism references, using Impeccable and Product Design. Confirm the native stack and exact device OS/SDK combination for the iPhone 17. Build pairing, authenticated transport, shared-history synchronization, streamed text, stop/retry, task controls, memory access, connection status, and offline/reconnect behavior.

The free Apple account supports this initial testing stage, with periodic reinstall/reprovisioning. Apple currently documents a seven-day provisioning lifetime. [Personal-device testing](https://developer.apple.com/help/account/basics/about-your-developer-account).

**Acceptance scenarios:**

1. Pair the phone and hold a conversation; switch to the existing client and continue with the same history.
2. Revoke the phone. Every protected endpoint rejects its credentials.
3. Disconnect during a message, reconnect, and retry. There is one logical submission and no silently lost message.
4. Close and reopen the app. It synchronizes missed events without inventing a second conversation.
5. Inspect, edit, and cancel a commitment from the phone. Memory correction remains reachable.
6. Verify VoiceOver labels, large Dynamic Type, reduced motion, keyboard behavior, back gestures, safe areas, and the chosen appearance behavior on simulator and hardware.

**Connection decision:** same Wi-Fi first, selected by the user; remote access comes later. Implement an authenticated device API with pairing/revocation without exposing the incumbent local browser API. Sleep or loss of network must produce a clear offline state. Simulator success cannot be reported as real-device or remote success. A later stationary mini would need remote access for use while away.

**Exit evidence:** a private installed app, a documented rebuild path, device screenshots, and actual cross-client/reconnect results. No App Store listing is required.

## Stage 3 — Proactive presence and native push

**Outcome:** the companion can initiate a worthwhile message while the iPhone app is closed and continue naturally when you reply.

Build follow-up candidates with provenance, event-driven evaluation, separate reminder/check-in policies, expiry, a transactional outbox, and APNs delivery. Choose quiet hours, timezone behavior, outreach categories, rate limits, and pause controls with the user. Make “why this appeared” accessible from Activity without cluttering the conversation.

**Implemented first increment:** in-app check-ins use eligible context from the last 24 hours, wait at least two hours after conversation and four hours between check-ins, and respect the selected daily maximum and local-time window. A reserved attempt prevents repeated generation for the same exchange. Active conversation, changed identity, pause, forgotten evidence, and expired context invalidate an obsolete draft. The model can choose silence. Restore disables outreach for review. Requested reminders retain their own schedule. Remaining here: APNs outbox/delivery, real closed-app testing, and agreement on the duration and evaluation of the personal trial.

**Membership gate:** paid Apple Developer Program membership is required for native push capability; the app can remain privately installed. Purchase is not authorized by this plan. If upgrade is deferred, evaluate initiative through the foreground app or an explicitly chosen existing delivery channel, and leave the native-push stage incomplete. [Apple capability availability](https://developer.apple.com/help/account/reference/supported-capabilities-ios).

**Acceptance scenarios:**

1. A requested reminder reaches the closed app and opens the relevant conversation.
2. A permitted personal follow-up refers to something actually discussed; replying feels like continuing that exchange.
3. Quiet hours, pause, dismissal, and per-category limits are respected. Silence and stale context can cause no message to be sent.
4. A conversation or cancellation arriving while outreach is being drafted invalidates an obsolete draft before delivery.
5. Restart before and after outbox creation; simulate an ambiguous provider response. Preserve one logical message and report delivery uncertainty honestly.
6. Rotate a device token; disable notification permission; let the Mac sleep. Recover without a burst of expired alerts.
7. If away-from-home use is chosen, test on cellular with the app closed, then open it and reply. Test push receipt and API reachability independently.

**Exit evidence:** real-device APNs results plus a proposed one-week personal trial. Record relevance, dismissals, missed commitments, repeats, and whether check-ins feel welcome. Trial duration and outreach settings require the user's agreement.

## Stage 4 — Voice that is worth spending an evening with

**Outcome:** speak with this companion in the native app, including useful actions, with acceptable pacing and sound.

Audition candidate voices early, alongside Stage 2 if desired. Implement push-to-talk first, then streamed recognition/synthesis, interruption handling, and turn detection. Keep provider credentials on the service and use the same identity, history, and action controls as text.

**Acceptance scenarios:** a short factual query, a tool-backed search, a long personal conversation, an interruption halfway through a reply, a correction to a recognized name/time, headphones disconnecting, an incoming audio interruption, and a network outage.

Measure time from end of speech to audible response, interruption-to-silence delay, transcription errors, disconnects, and actual usage/cost for a representative extended session. The user selects acceptable voice quality and latency from those trials; no provider marketing figure substitutes for them. Spoken destructive or third-party actions follow the same policy as text.

**Exit evidence:** a real-phone session the user finds comfortable, a visible microphone state, correct treatment of interrupted/unheard speech, and a known usage budget. Audio retention and hosted processing must be decided before private conversation tests.

## Stage 5 — iCloud assistance, delivered in two increments

**5A: mail awareness.** Connect the intended iCloud account through its supported mail protocols. Begin with selected-folder reads, incremental sync, summaries, source references, and actionable-message suggestions. Add reply drafts and only then sending under the chosen policy. [Apple mail settings](https://support.apple.com/en-us/102525).

**5B: calendar follow-through.** Validate the integration route before committing to it. Given the MacBook and possible Mac mini hosts, evaluate a Mac EventKit bridge first and compare server-side CalDAV if needed for portability. Start with one selected calendar, timezone-aware conflict checks, and event creation/update. Do not add attendees or send invitations as an incidental effect. Apple Reminders is a separate capability unless tested explicitly.

**Acceptance scenarios:**

- Reconnect after losing mail connectivity; no repeated ingestion or alert for the same message.
- An email proposes an appointment. Glashaus produces a sourced suggestion, checks the chosen calendar, and executes only within the granted authority.
- Change recipient, body, or event details after review. Any earlier approval no longer authorizes the changed operation.
- Revoke credentials, inject instructions into email content, and simulate an uncertain send/write outcome. No privilege expansion or blind duplicate send occurs.
- Move or cancel an event after it was discussed. The next response uses fresh connector data and outstanding follow-ups are reconsidered.

**Exit evidence:** private account integration tests, secure credential storage, chosen retention boundaries, and accurate reporting of uncertain operations. A Mac EventKit result is not evidence that the same connector works on Linux.

## Stage 6 — Extensibility and routine operation

**Outcome:** add an approved connector or move the service without losing the companion or duplicating its actions.

Add an MCP adapter only when a selected integration benefits from it. Complete archive/export migrations, startup health checks, diagnostics, and a documented MacBook-to-Mac-mini handoff. Keep one active primary host. Defer Windows/Linux-specific adapter work until one is selected; retain the core's portable boundaries.

**Exit evidence:** restore to an isolated home, inspect pending work before enabling external actions, migrate the chosen host, re-establish host credentials and Apple permissions, point/re-pair the phone to the new primary, and prove no duplicate scheduler or delivery remains active. The same companion, history, and tasks remain intact; the MacBook can become a client of the mini. Update rollback and purge cover new records. Native app installation/update instructions remain private and reproducible. Hardware purchase follows measured model/voice workloads and is not required to begin.

On the selected Mac host, also test reboot, sign-in, screen lock, sleep/wake, and network recovery. Document when the background service, iCloud session, and secret store are actually available; a plugged-in computer alone does not prove unattended recovery.

## Release standard throughout

- Preserve companion tone, corrections, and conversational continuity with regression examples and user review.
- Do not claim success before the database/provider confirms it; distinguish failure from uncertainty.
- Test real failure boundaries: time, restarts, retries, interrupted audio, expired permissions, and disconnected devices.
- Use synthetic/private test data appropriately; keep secrets and message bodies out of routine logs.
- Show implemented capabilities and truthful empty/offline/error states. A disconnected connector never appears ready.
- Expand backup, restore, update recovery, and deletion support when each new data type lands.
- Keep setup understandable: service start, phone pairing, visible connection health, and one place to pause initiative.

## Current acceptance sequence

Finish WARP-compatible cellular access, then use the selected Elle voice for a real conversation, confirm a calendar proposal and a self-addressed email draft after owner review. Complete native recovery/clear-view checks and the bounded design review. Follow with the owner's everyday-use and accessibility feedback. No provider purchase, outgoing message, calendar write or hardware migration is inferred from a mock test.

## Finished visual design horizon — Terminal Pastoralism

**September 28 native increment delivered:** the owner's full-page artwork request is implemented with a newly generated portrait, stronger reading washes, compact Activity, and simplified Settings. Five native scenarios passed, plus light/large-text and final visual checks. The signed app is installed on the iPhone; the owner can open it after unlocking to review the new appearance. The [scoped design QA](design-qa.md) records evidence and remaining accessibility limits. This is historical evidence for the earlier visual increment. Current Home/voice/connector evidence is tracked in the completion ledger; notifications remain deferred.

The subsequent density pass removed the connection pill and duplicate chat header, compacted the composer, and preserved a full send touch target. The owner approved the result. Their next visual request is a hero Home and background presets; the current landscape remains provisional rather than the final mandatory artwork.

The user selected Terminal Pastoralism and supplied two moodboards plus a UI motion video. [The visual horizon](docs/VISUAL-HORIZON.md) records the sources, native translation, and completion criteria. This is a cross-stage design track: preserve references now, select native screen concepts before Stage 2 UI implementation, and verify the complete visual system against working states as features land. The final interface should combine quiet, weathered rural atmosphere with precise machine feedback and comfortable long-form conversation.
