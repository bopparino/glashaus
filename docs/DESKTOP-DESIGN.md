---
name: "Glashaus Mac — Shared table"
description: "The native Terminal Pastoralism world extended to conversation and local files on Mac."
colors:
  ground: "rgb(10% 11% 10%)"
  bone: "rgb(91% 90% 86%)"
  rust: "rgb(57% 23% 16%)"
  paper: "rgb(90% 89% 84%)"
typography:
  body:
    fontFamily: "System (San Francisco)"
    fontSize: "14pt"
  title2:
    fontFamily: "System (San Francisco)"
  headline:
    fontFamily: "System (San Francisco)"
  caption:
    fontFamily: "System (San Francisco)"
rounded:
  attachment: "8pt"
  composer: "10pt"
spacing:
  control: "12pt"
  sidebar: "16pt"
  composer-bottom: "18pt"
  page: "20pt"
  reading: "24pt"
  conversation: "28pt"
  home: "32pt"
components:
  action-dark:
    textColor: "{colors.bone}"
  send:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.ground}"
  preview:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ground}"
---

# Glashaus Mac — Shared table

## Overview

**Creative North Star: "Terminal Pastoralism"**

Shared table is the Mac workspace expression of the incumbent [native iPhone world](../ios/DESIGN.md). Austin selected concept 1 on September 29, 2026 and explicitly required existing system typography in place of the mock's editorial serif. The selected [build reference](../.impeccable/mocks/shared-table.png) and [decision image](../.impeccable/mocks/decision/shared-table.png) describe the same composition: quiet navigation, a continuing conversation, and a useful document alongside it.

This is an extension, not a replacement identity. The repository-root [DESIGN.md](../DESIGN.md) and [.impeccable/design.json](../.impeccable/design.json) remain the Prism web system; `ios/DESIGN.md` remains the iPhone system. This document records actual `macos/Glashaus.swift` implementation and the first iPhone file/photo routes. The iPhone remains the primary daily experience. A configurable companion name, real history, and persisted files supply the content; mock pantry imagery and document prose are not permanent application chrome.

**Key Characteristics:**

- Native macOS navigation, resizing, menus, dialogs, and preview controls.
- Charcoal conversation, warm bone actions, and a light document surface.
- Existing pastoral artwork confined to the Mac sidebar.
- System sans serif throughout application chrome; sans-serif generated documents.
- Actual task states, recoverable errors, and explicit file actions.

## Colors

Frontmatter percentages preserve the normalized RGB constants in Swift without conversion loss. Ground matches the iPhone charcoal token, bone its dark ink, and paper its paper color. Rust appears as a 0.3-opacity error-strip fill. Dark-surface actions use warm bone; the light preview overrides foreground and tint to ground. The composer uses bone at 0.06 opacity, and sidebar footer text uses bone at 0.8.

The Mac requests a dark appearance; it does not implement the iPhone's adaptive light/dark palette. Secondary text, selection, disabled controls, and system materials retain platform rendering. The blue selected sidebar row visible in captures is native macOS selection, not a new brand accent. No separate olive control token is implemented on Mac.

## Typography

Use system sans serif and SF Symbols. The root has a 14-point system font; headings and supporting text use native `.title2`, `.largeTitle`, `.headline`, `.callout`, and `.caption` roles. The sidebar wordmark and Home greeting use medium weight; the send glyph is 16 points, semibold. Message text and task errors support native selection; reply Markdown renders as native text.

The Mac does not inherit the iPhone's full Dynamic Type contract; its fixed body size should not be described as Dynamic Type. Preserve native metrics. Do not import Archivo, Roboto Mono, serif mock headings, or tracked web labels. PDF and DOCX use sans-serif document styles, while file contents remain user data.

## Layout

All dimensions are macOS points. The default window is 1440 × 940; the minimum is 900 × 600. `NavigationSplitView` owns the sidebar and standard collapse control. Its width spans 160–250 points, with 205 ideal. Destinations are Home, Conversation, Library, Tasks, and Settings.

An open preview responds to the **available detail width**, not total window width:

- At 850 points or wider, a native `HSplitView` places the main pane beside the preview. The main pane has a 360-point minimum, 520 ideal, and 720 maximum; the preview has a 320-point minimum and 700 ideal. Users can resize the divider.
- Below 850 points, the preview occupies the detail area alone. Its toolbar retains Save As, Share, and a back arrow labeled “Back to conversation.” Closing it restores the underlying destination. This is the captured behavior at both 1024- and 900-point window widths with the sidebar visible.
- With no selected file, the main pane remains visible. Changing sidebar destination clears the preview and its URL so the newly selected destination appears immediately.

Conversation uses a scrolling lazy stack with 28-point turn spacing, 24-point content padding, and a 720-point maximum reading width. It scrolls on new reply text and history changes. The composer stays below history with 20-point horizontal and 18-point bottom margins, a 12-point inset and gap, and a one-to-five-line field. Attachment previews fit within 200 points vertically. Home uses 32-point padding and 24-point section gaps.

The preview toolbar uses small native controls and 12-point padding. Long filenames yield space before actions and truncate to one line. Embedded file views accept the proposed layout size. PDF pages refit when width changes and preserve the current destination; other formats use Quick Look.

## Elevation & Depth

Landscape texture, tonal surfaces, and native window/material rendering establish depth. There is no custom shadow scale. The sidebar scales the selected raster to fill, clips it, and overlays ground at 0.72 opacity. Conversation has an opaque ground; the preview has an opaque paper surround and native file rendering.

The desktop build copies existing `PastoralBackdrop`, `FieldQuiet`, and `NightRelay` rasters from `ios/Glashaus/Assets.xcassets`, as recorded in `scripts/desktop-build.ts`. No new desktop raster was generated. Keep [backdrop provenance](../ios/Design/backdrop-provenance.md), its [prompt](../ios/Design/backdrop.prompt.txt), and [preset provenance](../ios/Design/presets-provenance.md) with these assets. Native code controls crop and wash; the artwork contains no interface text. The iPhone reminder paper remains separate; the Mac preview surround is a flat color, not that paper texture.

## Shapes

The composer uses a 10-point rounded rectangle; attachment images use an 8-point radius. Native buttons, selection rows, menus, confirmation dialogs, file panels, and window corners retain platform shapes. Do not reproduce oversized mock bubbles or create a parallel custom control system.

## Components

- **Navigation and background.** The sidebar uses SF Symbols and standard selection. Settings offers Pastoral, Field quiet, Night relay, and Plain charcoal. Its footer names the companion or says Connecting. Window title reflects the destination or companion.
- **Conversation and composer.** The plus menu offers Attach image and Clear chat view. The field submits natively; Command-Return also sends. Command-N selects Conversation; Command-Shift-O attaches an image. Send has an accessible label and disables during upload, generation, or empty input. Progress offers Stop; an unsent saved message offers Retry and Edit. Clear chat view confirms that history and memories remain saved and the iPhone is unchanged.
- **Tasks and receipts.** Rows show saved status, stage, active progress, and readable errors. Active jobs can be cancelled; unsuccessful inactive jobs can be explicitly retried. Completed files open from receipts or Library. No live home is populated with demo files.
- **Library and preview.** Rows show names and sizes. Preview provides Save As through a native file panel, Share through native sharing, and labeled Close or Back. Save and Share disable while loading. Removing a file requires confirmation describing its effect on the shared library.
- **Errors and settings.** A readable dismissible error strip uses rust. Setup and reconnection use native empty-state actions. Settings includes the service connection, tool preparation and status, and a link to the existing shared browser settings. Native voice, account editors, computer control, and public signed distribution are outside this slice; see [workspace scope](DESKTOP-WORKSPACE.md).
- **iPhone extension.** Home → Files and tasks opens a native list of actual files and tasks; Conversation's menu provides the same route plus Attach photos and Clear chat view. Files open with Quick Look. Existing `FieldStyle`, pastoral reading backgrounds, native tabs, system text, and platform menus remain authoritative. The phone does not adopt a desktop split layout.

### Evidence and scope

Checked captures: [1440-point shared table](../.impeccable/review/desktop-workspace/desktop-final.png), [1024-point preview](../.impeccable/review/desktop-workspace/desktop-compact.png), [900-point preview](../.impeccable/review/desktop-workspace/desktop-minimum.png), [iPhone Files and tasks](../.impeccable/review/desktop-workspace/phone/1894EDC9-8621-4896-BFC4-39132210CEB4.png), and [iPhone Conversation menu](../.impeccable/review/desktop-workspace/phone/7C81A3E1-D22A-4660-9356-7661C928F062.png). The [final reviewer verdict](../.impeccable/review/desktop-workspace/finish-verdict-final.md) clears compact layout, action contrast, and evidence/scope honesty. It is not whole-product or physical-device certification.

The [native completion record](../.impeccable/review/desktop-workspace/native-completion.md) is the acceptance record. The HTML/CSS hero comparison gate remains open; no numerical pixel-fidelity pass is claimed. Source inspection substantiates navigation reset and keyboard behavior; screenshots alone cannot prove interactions or every accessibility state.

Existing documentation drift is preserved rather than silently rewriting other systems: `ios/DESIGN.md` still describes Activity as the initial tab, whereas current phone code and captures show Home; earlier sections of `PRODUCT.md` retain historical exclusions and undecided status for capabilities subsequently added. This document does not reconcile those historical records. Mac's fixed dark appearance, 14-point body, and sidebar-only artwork are explicit platform adaptations, not claims that it exactly matches the iPhone's adaptive implementation.

## Do's and Don'ts

- Do extend the incumbent native palette, raster provenance, and system typography.
- Do preserve native resizing, keyboard access, labeled actions, selectable text, and file dialogs.
- Do keep preview actions visible when detail width is constrained, and clear preview on destination changes.
- Do distinguish task completion, model-reply errors, tool readiness, and connection state with actual saved state.
- Don't turn mock copy, attached photographs, or document titles into application identity.
- Don't add editorial serif, decorative taglines, web navigation, or unsupported capability controls.
- Don't claim a completed numerical comparison gate or broader platform certification from these captures.
