# GlasHaus for iPhone

<!-- impeccable:product-schema 1 -->

## Platform

Native SwiftUI app for iPhone, iOS 17.0 and later. The project targets device family 1; it does not target iPad or Mac Catalyst. The development SDK and simulator model do not change this deployment minimum.

## Users

The owner of an existing GlasHaus companion, continuing the same conversation away from their computer. The intended everyday host is Windows with Ollama. Initial physical-device testing uses a Mac host with Ollama and the user-approved Kimi cloud model.

## Product Purpose

Bring the owner's continuing companion, conversation, memory and everyday settings to an iPhone. The computer remains the host and runs inference through Ollama; the phone presents and edits the existing companion.

## Operating Context

This is a fresh native app. Its approved direction is minimal, text-first and ChatGPT-inspired, with native navigation and a complete phone Settings destination. The existing web application's Prism direction remains separately defined in the repository-root DESIGN.md.

The owner enters the host's private HTTPS address and a one-use code created in the computer's Settings → Your phone. Tailscale connects the phone and computer. The computer must remain awake with GlasHaus and Ollama running. The phone API is distinct from the computer's administration page.

## Capabilities and Constraints

- Chat streams replies, supports Stop and retry, restores an unfinished message from secure storage, and lets the owner continue without retrying after confirmation. A draft is limited to 16,000 UTF-16 code units.
- Memory combines searchable memories and the journal in one native destination. The owner can add, edit and forget memories, inspect their source, read reflections and request a reflection. Forgetting a memory retains the original conversation.
- Settings edits identity, relationship, personality, values, authored background, summary, voice, user context, shared language and dialogue examples. Model settings include the conversation model, optional utility model, context size and evening reflections.
- The app provides System/Light/Dark appearance, connection refresh, JSON backup export, remote device revocation and an offline option to forget the local connection. Export omits connection keys.
- Provider addresses, provider API keys, startup management and archive restore remain computer Settings tasks. The phone app does not establish a new companion or install Ollama.
- Credentials and the pending message use device-only Keychain storage available while unlocked. Requests require HTTPS; redirects are refused. Conversation snapshots are held in memory, so this implementation does not promise an offline conversation archive.
- Backgrounding stops an active stream. An inactive-scene cover hides the conversation with the app name.

## Stack

SwiftUI, Foundation URLSession and Security Keychain, with no third-party UI dependency. Shared Codable models communicate with the GlasHaus host's mobile endpoints. The Xcode project is the native app; the Swift package supplies connection-focused tests.

## Visual Direction

System SF typography, semantic light/dark colors, unframed assistant text, a softly filled user message and a compact rounded composer. Chat, Memory and Settings use a native tab bar and separate navigation stacks. Grouped forms and modal editors follow platform conventions. Functional SF Symbols identify navigation and actions; needless graphics and ornamental artwork are excluded from the in-app interface.

## Product Principles

1. Keep the conversation readable and make the next action clear.
2. Use native iPhone navigation, input, sheets, confirmation dialogs and sharing.
3. Keep memory inspectable, editable and portable across the existing host and phone.
4. Explain the host connection, pending replies and recovery actions in plain language.
5. Distinguish authored identity, sourced memory and the companion's interpretation.

## Evidence and Open Questions

Recorded from the implemented SwiftUI source and project settings on 2026-10-05. The user confirmed the native direction before implementation. The parent implementation pass reports a successful Xcode 27 build. This is compile evidence, not native visual approval.

A signed development build was installed on a physical iPhone on 2026-10-05. The tester confirmed pairing and chat with the Windows host while personal WARP and Tailscale were enabled. Build 2 adds whitespace-preserving inline Markdown and clears composer focus before sending; the tester confirmed action italics and that completed replies do not reopen the keyboard. All eight native package tests and the signed build pass. A source review found no material defect. The later host history-order fix has automated regression coverage; its live Windows/iPhone acceptance remains pending. Remaining device checks are recorded in docs/IPHONE-TODO.txt. Memory/settings flows, light appearance, Dynamic Type, VoiceOver, safe areas and long-content layouts still require a complete walkthrough. Do not describe the full native UI as visually reviewed or approved until that walkthrough is completed.
