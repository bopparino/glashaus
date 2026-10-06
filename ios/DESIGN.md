---
name: "GlasHaus for iPhone"
description: "A minimal, text-first native companion app."
typography:
  large-title:
    fontFamily: "SF Pro"
    fontWeight: 600
  title:
    fontFamily: "SF Pro"
    fontWeight: 600
  body:
    fontFamily: "SF Pro"
  callout:
    fontFamily: "SF Pro"
  footnote:
    fontFamily: "SF Pro"
  caption:
    fontFamily: "SF Pro"
rounded:
  user-message: "20pt"
  composer: "24pt"
spacing:
  compact: "8pt"
  control-gap: "10pt"
  small: "12pt"
  inset: "16pt"
  page: "20pt"
  message: "24pt"
  turn: "28pt"
components:
  composer-field:
    typography: "{typography.body}"
    rounded: "{rounded.composer}"
    padding: "12pt 16pt"
  user-message:
    typography: "{typography.body}"
    rounded: "{rounded.user-message}"
    padding: "12pt 16pt"
  send-stop:
    width: "46pt"
    height: "46pt"
  latest-message:
    width: "44pt"
    height: "44pt"
---

# Design System: GlasHaus for iPhone

## Overview

**Creative North Star: "Minimal, text-first native conversation"**

The user's approved direction is a fresh native iPhone app, inspired by ChatGPT's quiet conversational structure. The conversation carries the experience. Navigation, forms and editors use familiar platform controls, with functional symbols and no needless graphics.

This document records the implemented native source. It applies only to `ios/`; the web app retains the repository-root Prism system. Eight Swift tests and a signed physical-device build passed. The tester confirmed Windows pairing, live action italics and normal keyboard dismissal/reopening on the iPhone. **Native visual walkthrough remains incomplete.** A source review found no material defect; the tester's interaction reports do not establish complete visual or accessibility approval.

**Key Characteristics:**

- System typography and semantic colors adapt to appearance and text preferences.
- Chat, Memory and Settings use native tabs and navigation stacks.
- Assistant replies remain unframed; user messages use a quiet tonal fill.
- Grouped forms, search, modal editors and confirmation dialogs use platform behavior.
- Custom conversation controls use explicit touch areas of at least 44 points.

Source: `GlasHaus/GlasHausApp.swift`, `ChatView.swift`, `MemoryView.swift`, `SettingsView.swift` and `Shared/MessageFormatting.swift`. Tokens describe current implementation, not a screenshot approval. Native semantic color bindings and text-style metadata live in `.impeccable/design.json`: the portable frontmatter cannot encode UIKit dynamic colors without inventing CSS equivalents.

## Colors

### Primary

SwiftUI `.primary` supplies ordinary text, navigation tint and the send/stop fill. The send/stop symbol uses `Color(uiColor: .systemBackground)` for contrast. Disabled send/stop fill reduces primary opacity to (0.3).

### Neutral

SwiftUI `.secondary` supplies supporting text and metadata. UIKit `.systemBackground` supplies the inactive-scene cover and inverse action symbol; `.secondarySystemBackground` fills the composer field and user message. Native `Form`, `List`, bars and sheets resolve their own platform surfaces.

SwiftUI `.red` identifies errors and over-limit text. Destructive actions use the native `.destructive` role. No fixed hex palette is authored in the app.

**The Semantic Appearance Rule.** Preserve native semantic colors and the System/Light/Dark preference; do not freeze their resolved colors into a single appearance.

## Typography

SF is selected through SwiftUI system text styles, not a bundled font. The frontmatter records family and explicit weights only; sizes and line metrics remain dynamic. The sidecar maps each role to its actual SwiftUI text style.

Large-title semibold introduces pairing. Title2 semibold introduces empty conversation states; title2 medium labels the inactive-scene cover. Body handles conversation and ordinary controls, headline labels empty memory states, callout handles errors and evidence, footnote carries helpers/status, and caption labels memory metadata. Pairing codes use the system monospaced modifier. Assistant reply text adds (4pt) line spacing and supports text selection.

**The Native Type Rule.** Keep native text styles and their scaling behavior. No custom display face, tracked label system or fixed text-size ramp is defined for this app.

## Layout

The app targets iPhone on iOS 17.0 and later. After pairing, a three-item `TabView` hosts a `NavigationStack` per destination. Conversation uses a scroll view with the `page` horizontal inset, `turn` spacing and a (720pt) maximum content width. The composer is inserted above the bottom safe area, with `inset` horizontal and `small` vertical padding. Native keyboard avoidance and interactive scroll dismissal remain active.

Within each exchange, a filled user message aligns right with a minimum leading gap equal to `turn`; the assistant reply fills the available width below it. Message and turn spacing use the frontmatter tokens. New reply content follows the latest message until the owner drags the conversation; a circular control restores following.

Memory uses a native list, search and a segmented Memories/Journal picker. Settings and pairing use native forms. Editors open in sheets with their own navigation stack. Long identity editors have a (130pt) minimum text area; memory editing uses (160pt).

Custom send/stop and latest-message dimensions are tokenized above. Pairing and empty-state connection actions explicitly set a minimum height of (44pt). Other controls rely on native control sizing; their actual hit areas and large-text layouts remain part of the pending native walkthrough.

## Elevation & Depth

No custom shadow or decorative background is authored. Grouped forms, navigation bars and sheets receive system depth. The composer uses `.bar` material; the latest-message action uses `.regularMaterial`. These are native materials, so the system determines their rendering. No custom animation or timing scale is defined.

## Shapes

The composer field and user message use the rounded tokens. Send/stop and latest-message actions are circles. Forms, lists, segmented controls, sheets and dialogs retain their native geometry. Functional icons use SF Symbols through `Image(systemName:)` and `Label`; icon-only actions carry accessibility labels.

## Components

### Conversation and composer

Assistant replies are selectable body text without a bubble. Live and saved replies share inline Markdown formatting with whitespace and line breaks preserved. Asterisk-delimited actions render in italics; escaping and inline code preserve literal markers. Unfinished streamed emphasis remains readable, and parsing failure falls back to the original text. Spoken reply labels use the formatted characters so emphasis markers are not read aloud. User text remains selectable inside the secondary-system-background shape.

The composer grows from one to six lines. Its trailing control changes between Send and Stop, with an accessible label matching the action. Empty or over-limit drafts disable Send. Sending explicitly clears composer focus before the field is disabled, and a newly pending message clears it again. The tester confirmed that the keyboard stays dismissed through reply completion and reopens when the composer is tapped. Pending replies lock the field and expose Retry reply plus a confirmed Continue without retrying path.

### Navigation

Tabs are Chat (`bubble.left`), Memory (`book.closed`) and Settings (`slider.horizontal.3`). Chat uses an inline companion title and a labeled connection/refresh toolbar action. Memory and Settings use standard navigation titles. No custom tab bar or device chrome is added.

### Forms and modal editors

Section headers identify groups; footers explain consequences, limits and host dependencies. Editors use labeled native fields, pickers, toggles and text editors, with Cancel and Save in the navigation toolbar. Saving disables competing edits, exposes progress in the action label and keeps errors in the form. Identity/settings editors protect unsaved work with an explicit discard dialog; memory editors disable interactive dismissal when text is changed or saving.

### Feedback and recovery

Errors combine red callout text with an exclamation symbol and a descriptive accessibility label. Loading uses `ProgressView` and meaningful status text. Empty lists and unavailable connections have short textual explanations. Destructive memory and connection actions use native confirmations with a concrete consequence. Background/inactive display is covered by the app name on system background.

## Do's and Don'ts

### Do:

- Do use native semantic colors and SF text styles.
- Do preserve readable conversation spacing, safe-area placement and explicit touch areas for custom controls.
- Do use native tabs, navigation stacks, forms, sheets and accessible functional SF Symbols.
- Do describe loading, errors, pending replies and destructive consequences with plain text.
- Do complete the native visual walkthrough before claiming rendered approval.

### Don't:

- Don't import the web Prism artwork, fixed palette or typography into the native app.
- Don't add needless graphics or decorative conversation chrome.
- Don't replace dynamic colors or text styles with fixed screenshot values.
- Don't present a successful build as native visual or accessibility verification.
