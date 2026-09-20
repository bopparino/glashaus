# Prism interface verification

final result: passed for the reviewed fixes and owner-approved visual direction

## Visual truth and scope

Source: the owner's two-phone reference, copied as a content-only normalized home target at `.impeccable/mocks/prism-home-reference.png` (390×826). Its source crop was 498×1055, excluding the phone bezel, status bar, and home indicator. The full original reference remains a user attachment, not a shipping app asset.

The owner explicitly selected **Keep the working-app adaptations (Recommended)** when asked whether to use visual direction or pixel-for-pixel recreation. Journal/Settings, a working send button, local-time greeting, Continue conversation, and omission of unavailable music/voice controls are accepted product translations. Rendering defects are not waived.

Implementation: synthetic in-memory previews at `http://127.0.0.1:7781/` and `:7782/`, with no real credentials or companion history. Real app runs separately at `:7777/`.

## Evidence

Native in-app browser viewport exports, inspected after capture:

- `.impeccable/review/mobile.png` and `desktop.png`: home, CSS 390×826 and 1440×1000.
- `.impeccable/review/user-1934.png`: home, CSS 1934×1216.
- `.impeccable/review/conversation-mobile.png` and `conversation-desktop.png`: two synthetic exchanges.
- `.impeccable/review/setup-mobile.png` and `setup-desktop.png`: first setup step.
- `.impeccable/review/settings-mobile.png` and `settings-desktop.png`: first settings viewport; form continues below the fold.

The native export is sometimes 380×805 for CSS 390×826, or 1430×993 for CSS 1440×1000. This is the browser capture scale, not horizontal overflow. The mobile image was normalized to 390×826 in `hero-repro.png` for comparison. Raw screenshots are retained. Full-page exports from this browser distorted responsive styling and were rejected; the final evidence uses native viewport captures only.

Full-view and focused paired comparisons: `.impeccable/review/diff/prism-cleanup/side-by-side.png` and `regions/` (greeting, masthead, annotation, composer, action rows, navigation, prism). These put source and implementation in the same image. The clock-dependent greeting differs from the source's evening wording; it is not a literal-content comparison. An earlier 380×214 capture was invalid and is not acceptance evidence. All nine screenshots above were refreshed for the final cleanup and opened by both the main agent and the independent reviewer.

## Required fidelity surfaces

- **Typography:** thin, rounded Roboto Mono 200 display replaces the squared Saira trial. Archivo remains the human conversation/form face; compact mono annotations and self-hosted fonts retain the reference's early-digital character. The reviewer resolved the greeting lettering and masthead alignment findings.
- **Spacing:** 20px mobile margins, two-line greeting, pill composer, four rule-separated home rows, and bottom navigation. Desktop uses a wide optical field and readable central conversation column. No horizontal overflow at 390, 1440, or 1934 CSS pixels. Long forms scroll with bottom clearance.
- **Colors:** carbon `#090a09`, bone `#e9e8e2`, graphite `#222321`, muted `#a5a6a0`. The optical spectrum is raster imagery, not a control accent. Final unboxed desktop navigation has at least 8.56:1 calculated contrast across the underlying source-image region at both tested desktop widths.
- **Images:** one generated 1024×1536 grainy optical arc, with exact prompt embedded. No mockup pixels or device chrome ship. The final `prism-soft.png` edit fades its perimeter below the carbon background; all four outer edge maxima are at most 2/255. The independent reviewer confirmed no exposed rectangular boundary in the nine final captures.
- **Copy:** real companion name, local-time greeting, truthful model-routing label, actual destinations and controls. Home actions prefill editable drafts. No invented integrations or fake music/voice player.

## Interaction checks

The in-app browser verified home navigation, editable Plan prefill, opening/backing out of a continuing chat, streamed synthetic reply, memory empty state, setup entry, settings connection state, and desktop/mobile layouts. Browser error/warning logs were empty. Static code and core tests cover focus, loading, disabled controls, stop/retry, reduced motion, persistence, and errors. This is not a full accessibility audit.

The separate headless setup-to-journal regression was not rerun in this pass while its explicit browser permission remained unanswered. Its fixtures are isolated from the owner's data, and its captures use a separate directory.

## Comparison history

1. Initial build inspection corrected arc shape, responsive height, and capture failures. A fresh reviewer identified P1 squared greeting lettering and P2 raster boundaries, desktop navigation contrast, and masthead alignment.
2. Correction round one switched to the thin rounded face, aligned the masthead, and applied image blending. Greeting/masthead resolved; home seams improved, but desktop reading screens retained a hard image top. Navigation contrast resolved but introduced visible per-label black boxes.
3. Correction round two removed the boxes and positioned the image from its top. Open navigation and contrast resolved. The cropped bright horizontal edge was replaced by a visible left perimeter/corner. Reviewer scored optical boundaries partial. Two correction rounds are complete; the owner was asked to choose one bounded image cleanup or retain the known defect.
4. The owner requested **one final cleanup pass**. A built-in image edit softened only the optical plate's perimeter, preserving the C-shaped arc, position, spectrum and grain. The new asset replaced the old image path; no CSS, layout or behavior changed in this pass. A single fresh capture batch covered all nine views. The independent reviewer marked the remaining perimeter finding resolved and returned `disposition: ship` in `.impeccable/review/prism-finish-review.md`.

## Resolved final finding

**P2 — Exposed optical raster perimeter: resolved.** The former straight left edge and corners are absent from desktop home, conversation, setup and settings, including the wide viewport. Mobile retains the arc and its grain. No listed material finding remains. This is a bounded confirmation of the reviewed fixes, not a new whole-app audit.

## Measured workflow

The stale gate input was replaced with valid evidence (72.71% at the earlier hero comparison). Its navigation classifier incorrectly reported a visibly present navigation region as missing. Hero and responsive phases were advanced with a recorded override quoting the owner's explicit acceptance of visual-direction adaptations. The final direct comparison is 71.40%, categorized as drift, with no missing regions. These are **not numerical fidelity passes**. Acceptance rests on the approved visual-direction scope and the independent resolved-fix verdict, not pixel parity.

`DESIGN.md` and `.impeccable/design.json` now record the shipping fonts, colors, components, responsive behavior and image provenance. Earlier design documents and the old plate were preserved outside the shipping app in `work/retired-assets/`.

The frontend build, both TypeScript checks and all 30 automated tests passed after the asset change. The actual exported alpha.2 runtime ZIP was extracted into a new directory and passed startup, UI serving, identity save and separate-process restart checks without dependencies or external API calls. Mac/Linux execution and the GitHub release remain pending.

## Acceptance checklist

- [x] Valid source and live browser screenshots, inspected and paired.
- [x] Required typography, layout, color, image, and copy checks.
- [x] Functional product adaptations explicitly accepted by owner.
- [x] Greeting, masthead, navigation contrast, and unboxed navigation resolved by fresh reviewer.
- [x] Optical perimeter resolved by the owner-authorized final image cleanup.
- [x] Independent final correction verdict and updated design-system documentation.
