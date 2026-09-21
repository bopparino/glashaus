---
version: 1
slug: "app-web-datacontrols-tsx"
primary_target: "app/web/DataControls.tsx"
related_targets: []
---

# Settings: companion deletion and purge

Mode: Operate. Extend the shipped Prism Settings page; no new visual world.

## Direction contract

THESIS: Let the owner start over with an exact, understandable boundary. Keep destructive actions separate from ordinary saves and updates.

OWN-WORLD: Inherit Prism's open Settings sections, bone and carbon controls, existing warm error notice, Archivo copy and compact mono helpers. No new artwork or tokens.

STORY: Review Delete companion or Purge local data, read what stays, optionally export first, type the explicit confirmation, then return to setup. Cancellation preserves everything and restores focus. Errors leave a clear retry path; partial cleanup is never called a complete purge.

FIRST VIEWPORT: Existing Settings stays unchanged. The new Start over section follows Keep a copy, before the version footer. Actions wrap at phone width; confirmation expands inline with a heading, scope text, real label/input, Cancel and an explicit final action.

FORM: Narrow extension of the owner-approved working app. No concept seed applies. New purpose and states are implemented directly inside the incumbent system. Save-first protection and pending-state locking prevent surprise loss of edits.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Boundaries: one companion per home. Delete clears the current database's identity/history/memory/research/imports/jobs, keeping connection settings and existing external recovery copies. Purge also resets settings/pairing and removes only known GlasHaus-managed recovery database files and local background logs. App/service registration, Ollama, models, external exports and Telegram's own history stay. No secure disk erasure claim. All tests use synthetic homes.

## Implementation and verification

IMPLEMENTED: `app/web/DataControls.tsx` adds Start over below the existing Settings controls. Delete companion and Purge local data expand inline. Each uses an exact typed phrase (`DELETE <companion name>` or `PURGE ALL`), a separate acknowledgment, an export link when a companion exists, and an explicit final action. Opening focuses the confirmation field; Cancel restores focus to its trigger. Completion reloads into setup, clearing browser drafts and cached companion state.

SCOPE: One companion per home. Both actions clear identity and revisions, conversations, memories and opinions including forgotten items, journal entries, research, imported originals and queued jobs. Delete keeps provider settings, saved keys, Telegram pairing and existing backups; those backups can still contain the deleted companion. Purge also clears settings, keys and pairing, plus only the exact managed recovery SQLite copies and background logs in that home. Neither creates a new recovery copy. App files, service registration and startup preference, Ollama, models, external exports and backups, and Telegram's own history remain. This is not secure disk erasure.

GUARDS: Unsaved Settings, other Settings work and Updates block cleanup with a reason. Pending cleanup disables competing Settings actions and confirmation controls and announces progress. Server idle, worker-drain and CSRF checks guard the operation. A partial cleanup displays its warning and a retry path; it never reports a complete purge.

VERIFIED: The finish reviewer opened all eight delete/purge confirmation captures in `.impeccable/review/alpha7` at original detail, covering widths of 390, 1280, 1440 and 1934 pixels. Tokens, copy, wrapping, labels, focus and busy states fit Prism. Final disposition: ship, with no P0–P2 findings in this Settings extension. Implementation commit `6d9305e5` passed 76/76 tests locally. CI run `35663167831` completed successfully on Windows, macOS and Linux, including browser deletion, cancellation, focus, save-first, pending and purge coverage, plus native service handoff, restart, Settings update, worker survival, rollback, deletion, replacement and purge checks. All checks used synthetic data and disposable test homes; the owner's real companion was untouched.

PRESERVED: This is an ordinary Settings extension with no new tokens, artwork or visual direction. It uses Prism's existing open sections, neutral buttons, warm error notice, fields and type. Added styling is limited to data-control wrapping and spacing; the neutral fieldset reset supports pending-state locking. `DESIGN.md` and `.impeccable/design.json` remain byte-for-byte unchanged. The detector's 12 pre-existing advisory font-size findings in `app/web/forms.css` remain untouched, with no new findings reported. No separate artifact-drift report was available.

RELEASE LIMIT: The ship disposition covers this reviewed and tested implementation. Release publication and the owner's real-PC upgrade were still pending when these notes were recorded.
