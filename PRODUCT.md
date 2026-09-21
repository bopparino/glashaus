# GlasHaus v3

<!-- impeccable:product-schema 1 -->

## Platform

web

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
