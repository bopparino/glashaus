# GlasHaus v3

<!-- impeccable:product-schema 1 -->

## Platform

ios

## Users

The owner is the primary user. Setup, daily conversation, repair, and memory correction should be easy without reading source code. One companion and one person per data directory.

## Product Purpose

A continuing AI companion on Ollama, with portable identity, memories, opinions, and a user-defined relationship. Samantha from *Her* is the experiential reference, not a promise of consciousness or a requirement for voice.

## Operating Context

A fresh implementation in the existing bopparino/glashaus repository. Web and a BotFather-created Telegram bot share identity and history. The user approved replacing the old application; alpha.3 has been published. v2 code is preserved under legacy-v2 for migration reference and in Git history, not used by the v3 entry point.

## Capabilities and Constraints

- Creation paths: researched character, authored identity, minimal grow foundation, v3 archive restore, v2 soul capsule import.
- Character research uses public sources through Ollama web search and web fetch with the owner's API key. Source material is untrusted data. Sourced claims, interpretations, and uncertainty are distinct. The relationship is authored separately.
- Ollama provides model inference; locally installed and cloud models must be distinguished accurately. SQLite state is stored locally. Telegram and public web research require network services.
- Conversation, supported memories, stated opinions, and opt-in journal reflections persist. Model behavior and quality vary; persistence does not promise identical behavior across model changes.
- The alpha implements inspect/edit/forget memory controls. Forgetting is not permanent erasure: original conversations and tombstones remain in backups, but the source exchange is excluded from future recall and extraction.
- Windows, macOS, and Linux one-command installation remains a release requirement. Node 24.14+ in the 24.x line is required. Alpha.3 passed the cross-OS CI matrix and a real Windows network-install check.
- Alpha.4 adds opt-in background startup in setup/restore and Settings: per-user Task Scheduler on Windows, LaunchAgent on macOS, and systemd user service on Linux. Manual mode stays the default. No automatic privilege elevation, Linux lingering changes, or Ollama service installation. Native service lifecycle tests are a publication gate; developer previews only simulate OS registration.
- Owner-started updates: rerunning the one-line installer can update an existing background installation; Settings also offers a release check and explicit Update and restart confirmation. The updater downloads and verifies the release before stopping the service, keeps the previous app and a private local recovery copy, then restarts and checks health. Failed startup attempts restore the previous app and database; uncertain shutdown requires explicit recovery. Recovery copies include saved keys. Unsaved Settings edits block installation, and the form is disabled during restart. Updates are never unattended.
- Settings offers Delete companion and Purge local data, each with an exact typed phrase and separate acknowledgment. Delete clears companion records while keeping connection settings, keys, Telegram pairing and existing backups. Purge also clears those connections and known managed recovery copies and background logs in that home. Both offer export first and require saved Settings; neither removes the app, startup preference, Ollama, models, external exports or Telegram history, or promises secure disk erasure.
- Full v2 SQLite migration, autonomous self-authorship, scheduled outreach, voice, and photos are outside the first alpha slice. Preserve old data; do not imply feature parity.

## Stack

TypeScript, Node 24 built-in SQLite, React, and Vite. Server code uses Node APIs and has no runtime package dependencies; React is bundled into the prebuilt web assets. Release archives can run with Node without installing dependencies. A separate ~/.glashaus-v3 home prevents accidental changes to an existing v2 companion.

## Visual Direction

The user's new two-phone reference replaces the previous stone-and-coral design: retro-futurist editorial minimalism, carbon, bone and graphite, one grainy spectral arc, thin human type and small tracked mono controls. Mobile-first composition carries through desktop, chat, setup and settings. Music and voice controls in the reference do not add unimplemented features. The companion name stays configurable.

## Product Principles

1. Fit one person's daily use, including setup and recovery.
2. Separate researched character history, authored relationship context, and actual shared memories.
3. Keep identity and memory inspectable and portable.
4. Allow honest, evidence-based opinions without a pressure-to-agree mechanism.
5. Keep web and Telegram part of one continuing conversation.
6. Describe implemented capabilities and privacy boundaries plainly.

## Evidence and Open Questions

Source baseline: v2.15.1, commit 0c5dbe1. Core and real-browser tests use deterministic test providers; live Kimi K2.6 cloud research, streaming, concise preview, memory correction and long-history recall passed on 2026-09-20. The owner confirmed Telegram pairing and a reply. Primary hardware capacity and preferred local model are not established. Native iOS and scratchpad privacy behavior remain undecided.

## Companion assistant expansion — September 28, 2026

The owner approved the architecture and staged roadmap in ARCHITECTURE.md and ROADMAP.md and authorized starting implementation. Develop on the MacBook; a private native iPhone app and an optional later Mac mini host are planned. The Apple account is currently free; paid membership may be considered for native push, with no App Store release.

Terminal Pastoralism is the selected finished visual direction, based on the user-supplied moodboards and MP4. docs/VISUAL-HORIZON.md records their interpretation and saved paths. It supersedes Prism as the future direction; DESIGN.md describes the current web implementation. Current web functional additions inherit that implementation. The owner selected native option 1: an Activity-first field ledger with a landscape band, paper reminder approval, and Conversation / Activity / Settings tabs. The approved composition is ios/Design/approved-activity.png. Native UI uses SwiftUI, SF Symbols, Dynamic Type and system navigation.

Phone connectivity starts on the same Wi-Fi; remote access is deferred. The Xcode 27.0 toolchain and iPhone 17 / iOS 27 simulator are installed. The native deployment minimum is iOS 26.0. Personal Team signing, private hardware installation, pairing, reminder confirmation, and chat have been verified on the owner's iPhone 17.

The target phone is iPhone 17 running the latest public iOS. Kimi K2.6 is selected for initial live tests. Conversational reminders must show one-tap confirmation before scheduling; edits invalidate the previous approval. The first development slice adds opt-in conversation tools, cited web search/fetch, and a Reminders view with drafts, confirmation, edit, cancel, completion, and durable in-app due states. This is not yet native push or Apple Reminders synchronization. Scheduled reminders imported from an archive pause for review. See docs/IMPLEMENTATION.md for current evidence and startup.

The separate test companion now uses the owner's authored Elle foundation. The profile stays editable and private; no persona is built into the product. The owner selected personal outreach from 9 am to 9 pm, at most twice daily depending on conversation cadence. The foreground implementation uses fresh conversation evidence, a two-hour conversation gap, a four-hour check-in gap, dismissal, and pause. It may choose silence. Profile language never bypasses explicit reminder confirmation or claims a connector exists. Synthesized voice, iCloud, and lock-screen delivery remain upcoming capabilities.

For the native UI pass the owner requested a full-page image in place of the banner, with new artwork from the original moodboards. The updated iPhone treatment uses a single portrait landscape behind live native controls, stronger reading overlays, compact paper commitments, and a Settings hierarchy that moves Mac maintenance into its own destination. This replaces the native banner composition while preserving its Terminal Pastoralism direction.

The owner explicitly reaffirmed mobile-first product design: the native iPhone app is the primary daily experience; the Mac hosts the companion and its existing web administration. Keep persistent chrome compact. Conversation has no duplicate title or memory shortcut above the history; Memories remains in Settings. Use a single compact composer with a smaller visible send control and a full touch target. Healthy connection status belongs in Settings, while an offline notice appears where it affects use. Development-roadmap copy belongs in documentation, not in the everyday interface; keep only action-specific capability guidance.
