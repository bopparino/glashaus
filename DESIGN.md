---
name: "GlasHaus v3 — Prism"
description: "A carbon and bone companion interface with one grainy optical arc."
colors:
  carbon: "#090a09"
  ink: "#e9e8e2"
  muted: "#a5a6a0"
  surface: "#141513"
  rule: "#353632"
  graphite: "#222321"
  primary-hover: "#ffffff"
  composer-fill: "#151613b8"
  composer-stroke: "#53544e"
  message-fill: "#141513a6"
  user-message-fill: "#22232180"
  message-stroke: "#3b3c36"
  notice-fill: "#171915"
  notice-stroke: "#6d7066"
  error-fill: "#231b18"
  error-stroke: "#996d61"
  error-text: "#f3cabb"
typography:
  display:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "clamp(56px, 5.2vw, 78px)"
    fontWeight: 200
    lineHeight: 1.13
    letterSpacing: "0.07em"
  title:
    fontFamily: "Archivo, sans-serif"
    fontSize: "clamp(42px, 4vw, 64px)"
    fontWeight: 300
    lineHeight: 1.07
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Archivo, sans-serif"
    fontSize: "16px"
    lineHeight: 1.7
  reading:
    fontFamily: "Archivo, sans-serif"
    fontSize: "17px"
    fontWeight: 300
    lineHeight: 1.65
    letterSpacing: "0.015em"
  label:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "14px"
    lineHeight: 1.5
  field:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "14px"
    lineHeight: 1.6
  button:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "13px"
    lineHeight: 1.5
  text-button:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "13px"
    lineHeight: 1.7
  navigation:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "11px"
    lineHeight: 1.5
    letterSpacing: "0.1em"
  action:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "11px"
    lineHeight: 1.6
    letterSpacing: "0.18em"
  composer:
    fontFamily: "Archivo, sans-serif"
    fontSize: "16px"
    fontWeight: 300
    lineHeight: 1.6
  helper:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "12px"
    lineHeight: 1.8
  metadata:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "10px"
    lineHeight: 1.7
rounded:
  small: "4px"
  control: "8px"
  panel: "12px"
  message: "15px"
  composer: "25px"
  composer-mobile: "24px"
  circle: "50%"
spacing:
  small: "8px"
  label-gap: "10px"
  compact: "12px"
  inset: "16px"
  medium: "20px"
  group: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.carbon}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-text:
    textColor: "{colors.muted}"
    typography: "{typography.text-button}"
    padding: "6px 0"
  button-send:
    textColor: "{colors.ink}"
    width: "44px"
    height: "40px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.field}"
    rounded: "{rounded.control}"
    padding: "13px 15px"
    width: "100%"
  navigation:
    textColor: "{colors.muted}"
    typography: "{typography.navigation}"
    padding: "12px 8px"
  action-row:
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    padding: "15px 6px"
    width: "100%"
  composer:
    backgroundColor: "{colors.composer-fill}"
    textColor: "{colors.ink}"
    typography: "{typography.composer}"
    rounded: "{rounded.composer}"
    padding: "10px 12px 10px 24px"
  companion-message:
    backgroundColor: "{colors.message-fill}"
    textColor: "{colors.ink}"
    typography: "{typography.reading}"
    rounded: "{rounded.message}"
    padding: "15px 19px"
  user-message:
    backgroundColor: "{colors.user-message-fill}"
    textColor: "{colors.ink}"
    typography: "{typography.reading}"
    rounded: "{rounded.message}"
    padding: "15px 19px"
  preview-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "28px"
  notice:
    backgroundColor: "{colors.notice-fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px 18px"
  notice-error:
    backgroundColor: "{colors.error-fill}"
    textColor: "{colors.error-text}"
---

# Design System: GlasHaus v3 — Prism

## Overview

**Creative North Star: "Prism"**

Prism is the owner's approved retro-futurist editorial minimalism: carbon, bone and graphite, generous space, fine rules, and one grainy optical arc. The arc carries presence while the controls remain quiet. This replaces the previous stone-and-coral world.

The reference governs atmosphere and visual language. The owner approved working-app adaptations: real setup, conversation, memory, journal and settings retain their function. The companion name is configurable; the greeting follows local time.

**Key Characteristics:**

- One optical plate dissolving into a carbon field.
- Roboto Mono at weight 200 for the greeting; Archivo for conversation and body text.
- Small tracked mono controls, open action rows, and fine neutral borders.
- A pill composer, outlined message bubbles, and restrained document forms.
- State-based optical movement and one conversation entrance, with reduced-motion support.

Extracted from `app/web/App.tsx`, `Icon.tsx`, `Forms.tsx`, and the loaded stylesheets in order: `styles.css`, `motion.css`, `forms.css`. Product truth remains in `PRODUCT.md`; surface intent remains in `.impeccable/surfaces/app-web-app-tsx.md`. This is a source-based record, not a visual-review verdict.

## Colors

The UI uses warm near-black surfaces and pale neutral text. Frontmatter values are normative; the optical spectrum is artwork, not a control palette.

### Primary

Bone (`ink`) marks primary buttons, selected navigation, field focus and keyboard outlines. Its white hover value is reserved for the implemented primary-button state.

### Neutral

Carbon grounds the page. Surface and graphite support fields and message fills; muted carries labels, helpers and metadata; rule separates open rows. Composer and message alpha fills allow the optical field to remain faintly visible.

Warm error fill, stroke and text identify failed actions. They are a semantic exception to the neutral controls.

**The Singular Arc Rule.** Keep spectral color in the optical artwork; use neutral controls and the existing warm error treatment.

## Typography

**Display Font:** Roboto Mono, with a monospace fallback. The shipped variable face supports weights 100–700.

**Body Font:** Archivo, with a sans-serif fallback, locally served at weights 100–900.

**Label/Mono Font:** Roboto Mono for controls, navigation, helpers and metadata.

The greeting is airy and evenly spaced. Archivo gives longer conversation and document text a softer reading rhythm. Saira is not loaded.

- **Display:** The greeting uses the frontmatter role. On phones it becomes (43px), line-height (1.06), tracking (0.045em). Short desktop viewports use (60px).
- **Title:** Document headings use the title role; phones use (40px/1.13) with tracking (-0.02em). Section headings use Archivo (27px), weight (300).
- **Reading:** Message paragraphs use the reading role; phones use (16px/1.6). Document descriptions use body text with a maximum of (65ch).
- **Labels:** Compact mono roles distinguish navigation, action rows, fields and metadata. Uppercase and tracking apply to the wordmark, navigation, home motto and action labels; helper sentences retain normal case.
- **Long text:** Memory entries use Archivo (20px/1.6), becoming (18px) on phones. Journal text uses (19px/1.85). Page introductions use mono (15px/1.7), capped at (57ch).

**The Thin Greeting Rule.** Use Roboto Mono at weight 200 for the greeting, Archivo for reading, and compact mono labels for controls.

## Layout

The centered desktop shell is capped at (1600px), with (6vw) side padding and a (132px) masthead. Home uses a left column of (min(560px, 52%)); conversation centers an (800px) column; documents cap at (760px). The desktop header places the name left and four text destinations right.

At (760px) and below, side margins become (20px), the masthead becomes (74px), home takes full width, and the four destinations move to a fixed bottom bar. Conversation hides that bar, keeping a back action in the masthead. Document fields stack, and memory tools wrap.

Home's phone composition starts with (130px) top padding and leaves (58px) between motto and composer. The stage can grow and scroll. Active conversation uses viewport height minus the masthead, with an independently scrolling message region and a composer below it. Safe-area spacing protects the lower controls. The minimum page width is (320px).

At desktop widths above (760px) and heights at or below (850px), home top padding, greeting size, composer gap and action-row height tighten. Exact breakpoints and motion values live in the sidecar.

## Elevation & Depth

No box shadows or backdrop-blur surfaces are implemented. Depth comes from one generated optical plate, dark translucent message surfaces, and fine borders. The image uses `mix-blend-mode: lighten` so its black perimeter merges into carbon.

**The Unframed Light Rule.** The optical plate must dissolve into the page without an image-shaped box, border, or card.

The only shipping raster is `app/web/public/art/prism-soft.png` (1024 × 1536). The final edit softened only the perimeter of the existing crescent. Its exact prompt is stored in `.impeccable/prism-soft-prompt.txt` and embedded in the PNG. The approved mock remains a reference, not shipping artwork.

The fixed plate sits behind the shell and ignores pointer input. Reading lowers its opacity and moves it down; conversation settles it near the lower edge. Desktop generation raises its opacity. The current phone cascade retains the conversation opacity during generation. Reduced motion removes transitions and animation while retaining the static state placement.

## Shapes

Open rows and fine rules establish structure. Fields and form buttons use the control radius, preview panels and notices the panel radius, message bubbles the message radius, and the composer the larger pill radius. The current-page dot is circular. Borders are generally (1px); selected memory tabs use a (2px) underline.

Icons come from Phosphor with `weight="thin"`, normally (18–25px). Decorative SVGs are hidden from assistive technology; icon-only buttons retain accessible names.

## Components

### Buttons

Primary actions use bone on carbon; secondary actions use surface with a rule border; text actions are underlined. Form buttons have a minimum height of (46px). Hover changes the primary fill to white, the secondary border to muted, and text-action color to ink. Keyboard focus is a (2px) ink outline offset by (5px). Disabled buttons use opacity (0.45) and a not-allowed cursor. No extra pressed animation is implemented.

### Cards / Containers

Home actions are full-width open rows with a supporting line and trailing arrow. Hover adds a faint bone wash. They prepare editable conversation starters. The optional continuation row reopens saved conversation.

Memory, journal and settings rely on separators and space. A preview reply is a surface panel with the panel radius. Inline edit and confirmation containers use the same restrained fills and borders.

### Inputs / Fields

Fields use surface, rule borders and muted text; focus changes the border to ink. Real labels connect to controls, and helper text connects through `aria-describedby`. Document textareas use Archivo and resize vertically. Phone inputs and selects use (16px) text.

Notices use a status role, or an alert role for errors. Loading, empty, retry and interrupted states use the existing text roles and actions.

### Navigation

Home, Memory, Journal and Settings use tracked uppercase mono labels. Current and hovered items turn ink; the current item adds a small dot. The phone bar moves to the bottom and disappears during active conversation. Setup progress uses thin rules; memory tabs use a selected underline.

### Composer and Conversation

The composer is a bordered pill with an Archivo textarea and a thin arrow action separated by a vertical rule. Focus lightens its border. The textarea grows to (150px); Enter sends and Shift+Enter makes a new line. Send becomes Stop during generation.

User bubbles align right; companion bubbles align left. Desktop maximum widths are (72%) and (82%); phone widths are (80%) and (88%). Both use fine borders and rounded corners, with a graphite alpha fill for the user. Mono metadata identifies speaker, time and Telegram origin when present.

Conversation enters once on mount over (450ms), settling from a small downward offset, blur and lower opacity. Streaming tokens do not restart it. Model location appears in a small footer; the home footer is hidden on phones.

## Do's and Don'ts

### Do:

- Do carry the carbon, bone and graphite world through home, conversation and documents.
- Do use the actual Roboto Mono greeting and Archivo reading roles.
- Do keep the optical plate singular, grainy and unframed.
- Do preserve keyboard focus, real labels, working controls and reduced-motion behavior.
- Do keep the companion name configurable and model-location copy tied to real configuration.
- Do preserve shipping artwork provenance and local font licenses.

### Don't:

- Don't restore the retired stone, coral controls or desktop side rails.
- Don't turn the spectral arc into repeated gradients, cards or decorative widgets.
- Don't substitute Saira for the shipped Roboto Mono display face.
- Don't add voice, music or attachment controls that the application does not implement.
- Don't present demo copy as actual memory, conversation or capability status.
