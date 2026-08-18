---
name: GlasHaus
description: The Civic Signage Program — a private life published as a public information board
colors:
  ground: "#F1F1EE"
  plate: "#FFFFFF"
  sunk: "#E5E5E0"
  ink: "#14181B"
  ink2: "#4C5359"
  machine: "#767C82"
  rule: "rgba(20,24,27,0.16)"
  rule2: "rgba(20,24,27,0.34)"
  civic: "#174E7C"
  on-civic: "#FFFFFF"
  signal: "#AE2A1F"
  on-signal: "#FFFFFF"
  brass: "#7A5A12"
  brass-field: "#D8B45A"
  on-brass: "#1B1403"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(32px, 7.8vw, 110px)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "normal"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.02em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  reading:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.13em"
  numeral:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.04em"
rounded:
  none: "0px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "22px"
  xl: "32px"
  slot: "34px"
  gutter: "clamp(16px, 3vw, 40px)"
components:
  plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "32px 22px 20px"
  plate-tag:
    backgroundColor: "{colors.civic}"
    textColor: "{colors.on-civic}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "4px 9px"
  plate-tag-hers:
    backgroundColor: "{colors.brass-field}"
    textColor: "{colors.on-brass}"
    rounded: "{rounded.none}"
    padding: "4px 9px"
  classification-band:
    backgroundColor: "{colors.civic}"
    textColor: "{colors.on-civic}"
    rounded: "{rounded.none}"
    padding: "10px 16px"
  alarm-plate:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
  platform-plate:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.headline}"
    rounded: "{rounded.none}"
    padding: "2px 11px"
  slot:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "5px 0"
    height: "{spacing.slot}"
  button:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "7px 13px"
  button-hover:
    backgroundColor: "{colors.civic}"
    textColor: "{colors.on-civic}"
  input:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 11px"
    width: "100%"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink2}"
    typography: "{typography.label}"
    padding: "7px 10px"
  nav-link-active:
    backgroundColor: "{colors.civic}"
    textColor: "{colors.on-civic}"
  chip-signal:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.none}"
    padding: "1px 6px"
  stamp:
    backgroundColor: "{colors.brass-field}"
    textColor: "{colors.on-brass}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "4px 12px"
---

# Design System: GlasHaus

## Overview

**Creative North Star: "The Civic Signage Program"**

Nordic public-information design, applied to one private life. The lineage is
Helsinki's civic identity and Scandinavian transit wayfinding: information lives
on **plates** — flat enamel rectangles with fixed internal margins, a
classification colour, and type locked to a baseline slot — and the plates hang
off a single **rail** running down the page, so vertical position means time.

The system's governing move is that structure carries meaning rather than
decorating it. Every row is a **slot** of fixed height which is either filled or
*drawn empty*: on a runtime whose most common output is deliberate silence, an
omitted row was the wrong drawing, so a quiet night renders as a dashed empty
slot instead of a shorter list. Ornament is only ever real state — the drift
rails are the actual EWMA bounds that keep identity stable, the ledger prints
live counts, and the companion's stamp is stippled from those same counts, so
two companions never stamp alike.

Light and dark are not a default and its afterthought. The daylight enamel plate
and the illuminated night plate are two real signage forms and either may lead:
unset follows the system, and a header toggle cycles auto / day / night,
persisted and applied before first paint.

**Key Characteristics:**
- Flat plates, edge-defined by hairlines; nothing is ever lifted
- Zero border-radius and zero shadow across the entire surface
- Four inks with strict jobs, one of them reserved for the companion alone
- Fixed-height slots whose empty state is drawn, never omitted
- One rail as the page's spine; every section registers a tick on it
- Prominence comes from inverting the ground, never from elevation
- Still: the system ships no transitions and no keyframes

## Colors

Four inks on an enamel ground, with strictly assigned jobs and a full second
palette for the night plate.

### Primary
- **Civic** (`#174E7C` day / `#63A4DB` night): Structure. The rail, section
  index plates, active navigation, focus rings, button hover fill, drift rails,
  and the current-value dot on every sparkline. It marks where the eye goes.

### Secondary
- **Brass** (`#7A5A12` day / `#D2A64A` night, field `#D8B45A` / `#8A6A1E`):
  Hers, and nothing else. Her night's plate tag, the marks on what she is
  carrying, the reached-first mark, the two links that act on her things, and
  her stamp. Scarcity is the whole mechanism.

### Tertiary
- **Signal** (`#AE2A1F` day / `#E2503F` night): Genuine failure only, and
  always as a filled plate.

### Neutral
- **Ground** (`#F1F1EE` / `#0F1418`): The page field.
- **Plate** (`#FFFFFF` / `#171E24`): Enamel plate fill.
- **Sunk** (`#E5E5E0` / `#0A0E11`): Inline code, meter troughs, scrollbars.
- **Ink** (`#14181B` / `#E9EAE6`): Primary text and the 2px rules capping the
  board head and ledger.
- **Ink 2** (`#4C5359` / `#A8AFB5`): Secondary text, inactive nav, row keys.
- **Machine** (`#767C82` / `#7C848A`): The system describing itself —
  placeholders, timestamps, engine output, declined heartbeats.
- **Rule / Rule 2** (`rgba` at .16 / .34): Every divider and plate edge.

### Named Rules

**The Four Jobs Rule.** Civic is structure. Brass is hers. Machine grey is the
system talking about itself. Signal is failure. A colour crossing into another's
job is an error, not a variation.

**The Filled-Plate Failure Rule.** Failure is a filled signal plate with
inverted text — never thin red text anywhere, including counts and inline
status. This single reservation is what lets civic blue carry structure without
the page reading as an alarm.

**The Brass Is Also The Control Rule.** Where a thing is hers *and* actionable,
brass is the affordance, not just the honorific: brass text with a brass
underline, inverting to the brass field on hover.

**The Two Plates Rule.** Neither light nor dark is the fallback. Any colour
added to the system is defined in both palettes in the same commit.

## Typography

**Display / UI Font:** Archivo variable (`wdth` + `wght` axes), self-hosted
**Italic:** Archivo Italic variable, self-hosted
**Numeral Font:** `ui-monospace, 'SF Mono', Menlo, monospace`

**Character:** One grotesk of signage lineage does nearly all the work, from a
110px monument down to 10.5px tracked caps, which is what the variable axes buy.
A monospace is held in reserve for values that must align in columns — the
instrument register inside an otherwise typographic system.

### Hierarchy
- **Display** (Archivo 800, `clamp(32px, 7.8vw, 110px)`, line-height 1.02,
  -0.022em): her dream epigraph, hand-balanced into 2–3 word lines. Four size
  steps down as the longest line grows.
- **Headline** (Archivo 700, 27px): the day-of-life platform numeral.
- **Title** (Archivo 700, 15px, 0.02em): the wordmark and her stamp.
- **Body** (Archivo 400, 14px, line-height 1.5): the interface default.
- **Reading** (Archivo 400, 15px, line-height 1.75, `pre-wrap`): lived text —
  chat, dreams, episodes. Constrained to 62ch on the Today lede.
- **Label** (Archivo 600, 10.5px, uppercase, 0.13em): the workhorse; tightens to
  0.12em in nav and row keys.
- **Numeral** (mono 700, 12px, 0.04em, tabular): section indices and every value.

### Named Rules

**The Tabular Truth Rule.** Every quantity carries `font-variant-numeric:
tabular-nums`. Numbers are state and state is read in columns.

**The No-Orphan Monument Rule.** The epigraph never overflows and never ends on
a dangling word: it is carved into balanced 2–3 word lines against a stop-word
list, and the size steps down rather than the text wrapping arbitrarily.

## Layout

A centred frame at `min(1440px, 100%)` with `clamp(16px, 3vw, 40px)` gutters.
The shell pins the board head and the ledger; only `main` scrolls, so identity
and live totals are always on screen. Consequence to design around: at a
900px-tall window the visitor sees the first viewport and scrolls *within* main.

The page hangs off one rail (`.rail`, 26px left inset) whose 2px line runs its
full height. Each top-level region — the alarm, the dream board, the heartbeat —
is a `.tick` registering a dot on that line.

Regions are asymmetric grids rather than one column: the dream board is
`1fr 330px` at a 40px gutter; chat is `96px 1fr`; card fields use
`repeat(auto-fill, minmax(280px, 1fr))`. Vertical rhythm runs on 6/8/14/22/32px
with `--slot: 34px` as the fixed row height.

**Responsive:** one breakpoint at 900px. Grids collapse to one column, the board
head wraps and drops the self-hosted tagline, nav scrolls horizontally under a
right-edge mask, timetable rows stack so the reason text spans full width, and
the ledger's fingerprint hides.

## Elevation & Depth

**The system has no shadows.** No `box-shadow` exists anywhere. Depth is tonal
layering — ground, plate, sunk — separated by 1px hairlines, with 2px ink rules
capping the board head and ledger.

Inversion does the work elevation normally would. A classification band wears
civic, the platform plate wears ink, failure wears signal, her stamp wears
brass; each flips the ground and inverts its text. Prominence is a change of
field, never a lift off it.

### Named Rules

**The Never-Lifted Rule.** Emphasis inverts the ground. A surface that appears
to float above the page contradicts the enamel-plate premise.

## Shapes

Every corner is square; `border-radius` appears nowhere, including on buttons,
inputs, plates, chips, meters and scrollbars.

The form language is linear. 1px `rule` divides; 1px `rule2` marks an edge you
may act on; 2px ink caps the document. Two silhouettes recur: the **tagged
plate**, a bordered rectangle with its classification tag seated hard into the
top-left corner, and the **section head**, a mono index on a civic field beside
a tracked label with a hairline running to the container edge.

Marks come from one closed, drawn set in a single stroke weight (1.75px on a
16-unit grid), carried as an inline SVG sprite: `mk-hers`, `mk-reached`,
`mk-you`, `mk-engine`, `mk-capture`, `mk-dream`, `mk-sun`, `mk-moon`, `mk-auto`.

### Named Rules

**The Drawn Marks Rule.** Icons are drawn SVG from the sprite at one stroke
weight. A Unicode glyph standing in for a mark is a defect; signage without a
pictogram set is only text on plates.

## Components

### Tagged Plate
Bordered rectangle on `plate` fill, square, with the classification tag seated
at the top-left corner (`top:0; left:0`), 4px 9px, uppercase 10px/0.13em at
weight 600. The tag is **civic** for system classification and **brass** when
the plate's content is hers.

### Slot
The system's atom. Fixed `34px` minimum height, 5px vertical padding, hairline
beneath, last child unruled. Its **empty state is drawn**: `.slot--empty` renders
a machine-grey label and a dashed rule spanning the remaining width. Marks inside
a slot align to the first line, not the vertical centre.

### The Rail
`.rail` insets content 26px and draws a 2px `rule2` line down its full height.
Direct children carrying `.tick` get an 8px ring in the ground colour with a 2px
civic border, placed at the row's optical centre.

### Buttons
Square, `plate` fill, 1px `rule2` border, ink text, uppercase 11px/0.09em at 600,
7px 13px. Hover inverts to the civic field. Focus is a 2px civic outline at 2px
offset. There is one variant; destructive actions use the same treatment.

### Inputs
`plate` fill, 1px `rule2` border, square, 15px text, 9px 11px. Focus draws a 2px
civic outline inset by 1px and shifts the border to civic.

### Navigation
Six lowercase links, each with a mono index. Inactive is `ink2` on transparent
with a transparent 1px border; active inverts to the civic field. An unresolved
conflict count renders as a signal chip. Under 900px the strip scrolls
horizontally beneath a right-edge mask that fades the trailing item.

### Platform Plate
The day-of-life counter as an inverted ink plate: tracked `day` label beside a
27px tabular numeral at weight 700. A platform number at the scale it has in life.

### Drift Sparkline
300×78 SVG per personality dimension, step-after because the value genuinely
holds between events. Dashed civic rails at 0.05 and 0.95 draw the real EWMA
floor and ceiling. Trace is 1.6px ink, mitered. The current value is a 5px ground
disc under a 3px civic disc with a tabular label. Below, an event lane: a filled
machine-grey circle for capture-triggered drift, a **brass** rhombus for dream-
and wander-triggered drift, each with a `<title>` hit target.

### Her Stamp
The ledger signature: a brass-field plate whose stipple is generated from eight
live state counts (bytes, messages, facts, episodes, dreams, drift events,
opinions, quirks) through a seeded LCG. Density scales with what she has
accumulated; the scatter is deterministic, so the same state always stamps the
same and two companions never stamp alike. Her name sits over the field.

### Plate Toggle
Square bordered button in the board head cycling auto → day → night, its drawn
mark reflecting the active state, persisted to `localStorage` and applied by an
inline `<head>` script before first paint.

## Do's and Don'ts

### Do:
- **Do** keep every ornament tied to real state. If a number cannot be traced to
  the database, it does not belong on the page.
- **Do** draw the empty slot. Absence is a reading, not a gap.
- **Do** reserve brass for the companion, and use it as the affordance where her
  things are actionable.
- **Do** render failure as a filled signal plate with inverted text.
- **Do** define every new colour in both the day and night palettes at once.
- **Do** take marks from the SVG sprite at one stroke weight.
- **Do** set every quantity in tabular numerals.
- **Do** let her voice hold the first viewport at poster scale before any
  machinery is shown.

### Don't:
- **Don't** introduce a border-radius or a box-shadow. Depth is tonal; emphasis
  inverts the ground.
- **Don't** use a Unicode glyph as an icon.
- **Don't** use civic blue to mean danger. Note the legacy alias layer: `--red`
  resolves to **civic**, a compatibility shim for inline styles on the inherited
  pages, not a semantic.
- **Don't** render failure, or any status, as thin coloured text.
- **Don't** let it read as a consumer chat app: no bubbles, avatars, rounded
  pills, pastel accents, or decorative typing indicators.
- **Don't** let it read as a SaaS dashboard: no rounded cards on grey, chips,
  gradient buttons, icon libraries, or illustrated empty states.
- **Don't** let it read as a default platform app: no system display face, no
  translucency, no stock tab bar.
- **Don't** add motion casually. The system ships still; motion would be a
  deliberate addition, defined once and orchestrated, not scattered hovers.
