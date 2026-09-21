---
version: 1
slug: "app-web-updates-tsx"
primary_target: "app/web/Updates.tsx"
related_targets: []
---

# GlasHaus — owner-started updates

THESIS: Keep the companion cared for without making software maintenance a separate chore.

OWN-WORLD: Extend the approved Prism Settings page. Inherit carbon, bone, Archivo, Roboto Mono helpers, open sections, hairlines, and neutral buttons. No new imagery, token palette, cards, modal, or decorative update animation.

STORY: In Settings, check GitHub for a newer published v3 release, read the result, then explicitly confirm Update and restart. Show progress, reconnect after the service switch, and explain recovery when it fails. The same one-line installer handles existing background installs. No unattended updates are introduced.

FIRST VIEWPORT: The new section follows background startup, within the existing readable Settings column. At 390px it uses the existing 20px margins and stacked or wrapping controls. Its title is Updates, followed by the installed version and one clear next action. Existing Settings content and navigation remain unchanged.

FORM: This is a small extension of a shipped user-approved image-to-code design, not a new visual direction. Reuse settings-section, section-description, helper, inline-actions, button, and Notice. A confirmation replaces the check action inline; Cancel returns focus to Check for updates. Progress and errors are announced. Long local backup paths wrap without widening the viewport.

FINISH: Review desktop, mobile, and actual-width screenshots with the fresh Impeccable finish reviewer, test check/confirm/cancel/progress/error states, inspect detector JSON, and document the extension without rewriting unrelated design decisions.

IMPLEMENTED (2026-09-21): Updates follows background startup in Settings and reuses Prism sections, helpers, buttons, and notices. The owner checks for a release, opens inline confirmation, and chooses Update and restart. Cancel restores focus to Check for updates. Unsaved Settings fields or a pending settings action block installation; the editable form is disabled while update status loads and during restart. Progress, reconnecting, failures, and recovery guidance use the existing status and alert treatment. Private recovery-copy paths wrap and explain that saved keys are included.

VERIFIED: The finish review of implementation commit `172fd45` matched Prism at 390px, 1280px, and 1440px. Its requested unsaved-edit protection was resolved; the final verdict was pass with disposition ship. Browser coverage includes check failure/retry, confirmation/cancel and focus, the unsaved-edit guard, progress, disabled fields during restart, and rollback feedback. Full-page confirmation captures are in `.impeccable/review/alpha6-fixed/update-confirm-{mobile,desktop,user}.png`.

PRESERVED: No design-system changes, new tokens, or raster assets. `DESIGN.md` and `.impeccable/design.json` remain unchanged. Added CSS is limited to recovery-path wrapping and a neutral fieldset reset. The detector's 12 existing font-size advisories in `forms.css` remain outside this extension.
