---
name: "GlasHaus iOS — Terminal Pastoralism"
description: "A native field ledger in charcoal, quiet landscape, and warm paper."
colors:
  ink-dark: "rgb(91% 90% 86%)"
  ink-light: "rgb(10% 11% 10%)"
  secondary-ink-dark: "rgb(73% 73% 69%)"
  secondary-ink-light: "rgb(34% 35% 32%)"
  ground-dark: "rgb(7.5% 8% 7.5%)"
  ground-light: "rgb(94% 93% 90%)"
  paper: "rgb(90% 89% 84%)"
  charcoal: "rgb(10% 11% 10%)"
  rust: "rgb(57% 23% 16%)"
  surface-dark: "rgb(12% 13% 11.5%)"
  surface-light: "rgb(97.5% 97% 95%)"
  olive-dark: "rgb(70% 75% 57%)"
  olive-light: "rgb(31% 36% 23%)"
typography:
  title2:
    fontFamily: "System (San Francisco)"
  reminder-title:
    fontFamily: "System (San Francisco)"
    fontWeight: 600
  title2-medium:
    fontFamily: "System (San Francisco)"
    fontWeight: 500
  headline:
    fontFamily: "System (San Francisco)"
  body:
    fontFamily: "System (San Francisco)"
  subheadline:
    fontFamily: "System (San Francisco)"
  footnote:
    fontFamily: "System (San Francisco)"
  caption:
    fontFamily: "System (San Francisco)"
  status:
    fontFamily: "System (San Francisco)"
    fontWeight: 500
rounded:
  control: "8pt"
  surface: "12pt"
spacing:
  compact: "4pt"
  inset: "8pt"
  field-group: "10pt"
  related: "12pt"
  content: "16pt"
  page: "20pt"
  section: "24pt"
  conversation: "28pt"
components:
  reminder-card:
    textColor: "{colors.charcoal}"
    rounded: "{rounded.surface}"
    padding: "{spacing.page}"
  reminder-confirm:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
  primary-dark:
    backgroundColor: "{colors.ink-dark}"
    textColor: "{colors.ground-dark}"
  primary-light:
    backgroundColor: "{colors.ink-light}"
    textColor: "{colors.ground-light}"
  pairing-field:
    rounded: "{rounded.surface}"
    padding: "{spacing.related}"
  message-field:
    rounded: "{rounded.surface}"
  user-message:
    rounded: "{rounded.surface}"
    padding: "{spacing.content}"
---

# Design System: GlasHaus iOS

## Overview

**Creative North Star: "Terminal Pastoralism"**

The native app pairs full-page rural artwork and weathered infrastructure with warm paper and quiet reading surfaces. The contrast gives reminders a tangible place for review while conversation remains open and readable. The selected first expression is the Activity-led Field Ledger recorded in [the native direction contract](Design/direction.md) and [approved composition](Design/approved-activity.png).

Native iOS structure carries navigation, controls, typography, and transitions. Brand is expressed through the palette, imagery, spacing, and restrained metadata. The dark appearance has a warm light counterpart; the reminder paper remains light in both. The configurable companion name and saved conversation supply the content.

This file applies only to the SwiftUI iPhone app in `ios/Glashaus`. The repository-root [DESIGN.md](../DESIGN.md) and [.impeccable/design.json](../.impeccable/design.json) describe the incumbent Prism web system and remain separate. These tokens were updated from `FieldStyle` and the native view modifiers for the September 28 full-page artwork pass. Percentage RGB is a lossless portable representation of the source's normalized RGB components, not a CSS implementation. All dimensions here are iOS points. Dynamic Type roles, adaptive color bindings, assets, and native components live in the [schema-2 extension sidecar](.impeccable/design.json).

**Key Characteristics:**

- A full-page photographic ground with adaptive charcoal or warm-light washes.
- Real paper texture behind actionable reminder content.
- System typography with Dynamic Type and SF Symbols.
- Native tabs, navigation stacks, forms, sheets, and confirmation dialogs.
- Honest connection, saved-copy, pending-message, and reminder states.

## Colors

**The Adaptive Ground Rule.** Bind main text and tint to `FieldStyle.ink`, supporting text to `FieldStyle.secondaryInk`, reading surfaces to `FieldStyle.surface`, and page washes to `FieldStyle.ground`. Reserve `FieldStyle.olive` for connection indicators; each binding selects its light or dark variant at runtime.

| Role | Tokens | Implemented use |
| --- | --- | --- |
| Primary interaction | `ink-dark`, `ink-light` | Root tint, ordinary foreground, pairing and send button fill. Their contrasting button text uses the active ground. |
| Neutral ground | `ground-dark`, `ground-light` | Scroll and list page backgrounds. |
| Supporting text | `secondary-ink-dark`, `secondary-ink-light` | Captions, profile descriptions, and check-in metadata. |
| Reading surface | `surface-dark`, `surface-light` | Opaque surfaces behind user turns, pairing, offline notices, and Activity's conversation return. |
| Neutral paper content | `charcoal`, `paper` | Charcoal reminder text and action fill; paper-colored action text. The card background itself is the `ReminderPaper` image. |
| Status | `olive-dark`, `olive-light` | Connection symbol and connected value in Settings. Connection button text uses ordinary ink. |
| Attention | `rust` | Draft, paused, and due reminder labels and symbols on paper. |

`FieldStyle` supplies dynamic colors through `UIColor` appearance providers. Explicit supporting text uses the opaque adaptive secondary ink rather than translucency over the artwork. System form/list surfaces, destructive actions, progress indicators, and navigation materials retain platform semantics. The artwork wash strengthens to 0.97 when Increased Contrast or Reduce Transparency is enabled; controls keep native accessibility behavior.

The composer shares one opaque `FieldStyle.surface` behind input and send. The disabled send circle uses ink at 0.08; the pairing field uses ink at 0.07. The explicit message prompt uses ink at 0.72; the paper's “Not scheduled yet” text uses charcoal at 0.75. These are native opacity modifiers, documented in the sidecar rather than additional palette primitives.

## Typography

**The System Reading Rule.** Use SwiftUI text styles and their native Dynamic Type behavior; preserve system metrics instead of substituting fixed point sizes, custom fonts, or web type tokens.

| Role | Native style | Where it appears |
| --- | --- | --- |
| Navigation title | System navigation title | Activity, Settings, and pairing use the default top-level title behavior. Memories, Journal, and editor sheets use inline titles. Conversation hides its navigation bar to give history the space; native tabs remain. |
| `title2` | `.title2` | Empty and companion-setup states. |
| `reminder-title` | `.title2`, semibold | Reminder title; allows full vertical growth. |
| `title2-medium` | `.title2`, medium | Pairing introduction. |
| `headline` | `.headline` | Pairing field/step labels and offline notice heading. |
| `body` | `.body` or inherited system body | Conversation, reminder date/time, memory, journal, and explanatory prose. |
| `subheadline` | `.subheadline` | Time-zone identifier, connection guidance, sources, pending-message guidance, and supporting settings copy. |
| `footnote` | `.footnote` | Paired Mac address. |
| `caption` | `.caption` | Status details, sync time, field guidance, journal dates, and source labels. |
| `status` | `.caption`, medium | Reminder state label. |

The send symbol uses `.body` with semibold weight, capped at Dynamic Type `xxxLarge` so the glyph fits its compact circle. This cap applies only to the symbol; all message text follows the full Dynamic Type range. Icons are SF Symbols and retain native symbol rendering. No custom font assets or independent line-height scale are used. Frontmatter intentionally omits fixed `fontSize` and `lineHeight`; `extensions.typographyMeta` records the semantic styles.

Reminder titles use `fixedSize(horizontal: false, vertical: true)` and time-zone identifiers have no line limit. Activity's latest-reply preview is limited to three lines; the full saved text remains in Conversation. The message field grows from one to five lines, the pairing link from two to five, and the memory editor from three to ten. Scroll views and forms accommodate larger reading sizes; text is not shrunk to preserve the mock's composition.

## Layout

**The Native Frame Rule.** Let `TabView`, `NavigationStack`, system safe areas, and sheet presentation own the application frame; compose content within that frame.

The current target is iPhone (`TARGETED_DEVICE_FAMILY = 1`) with a minimum deployment target of iOS 26.0. No iPad layout, web breakpoint, or fixed device canvas is defined. `RootView` switches between pairing and the paired three-tab shell. Activity is the initial selected tab; Conversation and Settings remain equal top-level destinations.

Pairing and Activity use vertically stacked, leading-aligned scroll content with page insets and section spacing from the frontmatter. The landscape banner has been removed. `PastoralBackground` fills the viewport, including beneath system chrome, while controls respect safe areas. Activity has an 8-point top inset and section-sized bottom padding. Reminder cards use page-sized internal padding, content-sized major gaps, and inset-sized date-detail gaps.

Conversation uses a lazy stack with conversation-sized gaps and page padding. Each user turn uses content-sized padding. Its navigation bar is hidden: the tab and named composer identify the conversation, while Memories stays in Settings. The composer sits in a bottom `safeAreaInset` with zero inset spacing, above the system keyboard and tab treatment. One shared surface contains the input and send action: 16-point outer horizontal padding, 6-point outer vertical padding, a 44-point minimum row, 12-point input leading padding, 8-point input vertical padding, and a 4-point trailing inset. The visible send circle is 32 points inside a 44-by-44-point touch target; it uses a plain button style to avoid extra system button padding. History anchors at the newest message, scrolls to the bottom when sending starts, and supports interactive keyboard dismissal.

Settings, Memories, and Journal use native `List`; reminder and memory editors use native `Form` within sheet navigation stacks. The app does not set a custom sheet detent or disable the native back gesture. Custom icon actions explicitly use 44-by-44-point frames; many text actions use a 44-point minimum content height. Keep these native frames when extending controls; the source does not implement a separate universal hit-target wrapper.

## Elevation & Depth

**The Material Restraint Rule.** Keep app content flat and let the landscape, real paper grain, tonal fills, and system materials establish depth.

No custom shadows, blur effects, gradients, or elevation scale are defined in the SwiftUI views. Navigation and tab chrome are rendered by iOS. The composer uses the native `.bar` background; forms, sheets, lists, menus, and alerts keep native presentation behavior.

The current material assets are opaque raster images, not screenshots of controls:

- `PastoralBackdrop` is a resizable, fill-cropped portrait behind each screen. It ignores safe areas and hit testing, and is hidden from accessibility. Dark/light ground washes are 0.58/0.78 for Activity and pairing, and 0.86/0.90 for reading surfaces. The new composition and actual dimensions are documented in [backdrop provenance](Design/backdrop-provenance.md). The previous panoramic image is retained only as design history and is not shipped in the asset catalog.
- `ReminderPaper` is a resizable, fill-cropped square texture behind the whole `ReminderCard`, then clipped to the card shape. Text, icons, and controls remain live SwiftUI. Its low-variation warm grain is documented in [paper provenance](Design/paper-provenance.md).

The approved composition is a design reference only. Neither the rasterized reference controls nor its decorative slogans are shipped as interface content. The [app icon provenance](Design/app-icon-provenance.md) records the separate home-screen asset.

No custom animation durations or easing curves exist. Navigation pushes, sheets, dialogs, controls, refresh indicators, and progress indicators use system behavior. There is no app-authored parallax or looping decorative motion and no custom Reduce Motion branch to document.

## Shapes

The `FieldStyle.surface` adaptive color provides opaque warm-light/charcoal reading areas for pairing, offline notices, user messages, check-ins, and Activity's conversation return.

Soft rectangular containers use the surface radius for paper reminders, user messages, reading surfaces, pairing fields, and the composer field. The reminder's confirm button explicitly uses the smaller control radius. Other prominent buttons retain the system button shape; do not infer their radius from a screenshot. The full-page image reaches every edge; cropping is handled by its view bounds.

The app does not draw a custom card border or custom chip system. Connection status is an ordinary Settings row; there is no healthy-connection toolbar pill. Offline notices remain visible in Activity and Conversation.

## Components

**The Explicit State Rule.** Every action uses current model state; status text and symbols explain whether the Mac is reachable and whether a reminder is actually scheduled.

- **Root navigation.** Native tabs use `bubble.left`, `calendar`, and `gearshape`. Activity's badge counts drafts, paused reminders, due reminders, and available check-ins. Its trailing plus button opens manual reminder creation. Unpaired users see pairing instead of tabs. Memories and Journal are reachable from Settings.
- **Connection status and offline notice.** Settings → Mac connection holds a plain status button using an olive symbol with “Mac connected,” or an ordinary ink symbol with “Mac offline” and `wifi.slash`; text always uses ordinary ink. Tapping refreshes the connection. Offline content in Activity and Conversation says it is the last saved copy, supplies a sync time when available, and offers Reconnect. Revoked credentials clear the local pairing and return to pairing with an error alert. A cached view is never labeled live.
- **Pairing.** A vertical native text field accepts a private pairing link, with native Paste and a prominent Connect to Mac action. Capitalization and autocorrection are disabled for the link. The action is disabled for an empty link or a pending request and changes its label to “Connecting…”. Setup instructions and the five-minute expiry are visible text.
- **Reminder card.** Paper carries state, title, weekday/date, time with UTC offset, and the stored time-zone identifier. Draft and paused states explicitly say “Not scheduled yet” and offer Confirm reminder plus Edit. Due items offer Mark done. An ellipsis menu offers Edit and destructive Cancel for non-closed items. Scheduled, completed, and cancelled states keep readable labels; closed items are hidden until the native toggle reveals them. Mutations are disabled while offline, working, or missing a companion.
- **Reminder editor.** A native sheet form has a title field and date/time picker using the reminder's stored time zone, or the home's zone for a new draft. Cancel dismisses; Save draft creates or updates a draft. The footer explains the confirmation step and distinguishes Glashaus reminders from Apple Calendar events. Blank titles and unavailable actions disable saving.
- **Conversation and composer.** User messages sit on adaptive opaque reading surfaces; companion replies stay on the open ground. Saved replies support native Markdown rendering and selectable text; streamed text is shown while it arrives. Sources are underlined native links. The adaptive prompt names the companion. The labeled arrow button sends; it is disabled for empty text, unavailable connection, active generation, or a pending retry. Sending shows progress and Stop reply. Interrupted work offers Retry message and Set aside, with a confirmation dialog explaining local removal.
- **Settings, memory, and journal.** Native lists lead with companion preferences and shared history. A Mac connection destination holds addresses, recovery, and destructive pairing controls. Memory rows open an editor with editable text, evidence, Save, and a destructive Forget confirmation. Journal entries are dated, selectable reading content. Empty collections use `ContentUnavailableView`. Unpair and Forget this Mac use separate destructive confirmations with different consequences described in the UI.
- **Errors and recovery.** A system alert displays the model's error. Native disabled states prevent unavailable actions. There is no custom toast, browser hover treatment, or custom focus ring. Send, Memories, reminder actions, and connection refresh have explicit accessibility labels or hints; decorative landscape is hidden while textual status remains readable.
- **Profile and initiative.** Settings exposes authored profile sections as selectable, expanding native list text, with empty fields omitted and authored background explicitly named. Personal check-ins uses native toggle, hour pickers, stepper, timezone, and a saved-state confirmation. An Activity check-in uses ordinary reading text, a disclosure for its reason and exact source quote, and Continue/Dismiss actions that stack when needed. Continuing moves the actual check-in into the conversation timeline, clearly labeled as initiated by the companion. No simulated user message is inserted.
- **Update connection.** Settings → Mac connection can present the pairing sheet without discarding the current connection. Cancel returns to the paired app; pending replies must be resolved before replacement. This uses the existing pairing components and material rather than adding a new visual system.

## Do's and Don'ts

### Do:

- Do use the adaptive native palette and semantic system text styles.
- Do retain real landscape and paper assets with their provenance.
- Do preserve native tabs, navigation stacks, forms, menus, sheets, and safe-area behavior.
- Do allow reminder titles and stored time zones to grow with Dynamic Type.
- Do pair status color with readable text and native symbols.
- Do keep reminder confirmation explicit and edits subject to fresh approval.
- Do distinguish a saved offline copy from current Mac state.
- Do keep the native design documentation scoped to `ios` while Prism remains the web system.

### Don't:

- Don't replace native typography or navigation with the web app's fonts or controls.
- Don't rasterize text, controls, system chrome, or decorative slogans from the approved mock.
- Don't replace `ReminderPaper` with a flat color and describe it as the same material.
- Don't freeze text to a screenshot's point sizes or shrink it to retain a fixed card height.
- Don't add voice, phone notifications, Apple Reminders sync, or other capability controls before they exist.
- Don't present illustrative conversation, dates, or connection telemetry as saved user data.
