# Elle: content and interface review

Historical content-pass snapshot, September 28, 2026. Current shipped capabilities and acceptance are in [COMPLETION.md](COMPLETION.md). Private development build, iPhone 17 / iOS 27 Simulator and the existing Mac browser app. Impeccable and Product Design guided this pass. The selected Activity-first Terminal Pastoralism design remains the native reference; the Mac app retains Prism.

## Result

The owner's supplied Elle foundation is saved as a new revision in the separate persistent development home. The companion ID and previous conversation remain. Private persona text is not committed. The phone can inspect the authored profile, create a reminder draft, control personal check-ins, and continue an initiated message in the same conversation. Native pairing can update a changed Mac address without first forgetting the old connection.

The initial screenshot review found missing phone entry points for profile inspection, manual reminder creation, and outreach preferences. These now have native navigation and controls. The Mac home initially placed a check-in below a large greeting; the check-in now takes that space so the composer remains easier to reach. Capability copy consistently distinguishes in-app reminders from Apple Calendar and closed-app notifications.

## Reviewed flow

Images below are unmodified screenshots of **synthetic test data**, saved locally under `.impeccable/review/content-final/accepted/`. That evidence folder is ignored by Git; rerunning XCTest produces fresh attachments. It is intentionally separate from personal conversation records.

1. **Profile — healthy.** Settings exposes the configurable identity, personality, voice description, authored background, values, and relationship. Empty fields disappear. Text grows and remains selectable. Editing stays in Mac Settings. The synthetic fixture is deliberately shorter than the owner's full profile; the latter still needs owner review on hardware.

2. **Outreach preferences — healthy.** Native controls show the allowed window, daily maximum, time zone, cadence, and in-app delivery. The form scrolls; Save preferences was reached and successfully submitted at an accessibility text size. Pausing is independently covered through the web and API tests. Requested reminders keep their own schedule.

3. **Manual reminder draft — healthy.** Activity's plus button opens a native sheet. Saving creates a draft, verified in the database, and does not schedule it. The review card includes year, offset, and time zone. Cancel/Save remain available with the keyboard open. At very large text the system navigation title abbreviates; the editable content grows rather than shrinking.

4. **Check-in in Activity — healthy for in-app delivery.** Its source is distinguishable from a reminder. Continue, Dismiss, and the reason disclosure are reachable; the two actions stack when width is limited. An exact supporting quote is available. The current build does not send lock-screen notifications.

5. **Continue conversation — healthy.** The check-in appears as an actual companion-initiated message with a date, alongside the prior exchange. No fake user turn is inserted. Conversation, Activity, Settings, and the composer remain available.

## Appearance and accessibility limits

Dark screens were inspected at the standard text size. The profile, preferences, manual draft, and check-in continuation passed in warm-light appearance with `accessibility-extra-large` text. A stable full-screen landscape capture was inspected after rejecting an earlier capture taken during rotation. Scrollable content naturally extends beyond the viewport; controls retain their native navigation and safe-area behavior.

Additional local evidence includes large profile, large draft, landscape conversation and Mac check-in captures. These synthetic review artifacts are not distributed. Browser tests found no horizontal overflow at 320, 390, or 1440 pixels.

This is visual and interaction evidence, not a complete accessibility certification. Full physical VoiceOver order, gestures, increased-contrast settings, and extended hardware use remain unverified. No new motion effects were added.

## Content and initiative evidence

- Six disposable Kimi scenarios sampled casual conversation without a productivity plan, simulated background, unavailable capabilities, reminder state, memory correction, and independent taste. The personality's register came through; no fixed response script was added.
- The reminder scenario exposed incorrect reference to the “Reminders app.” Fresh reminder records and explicit capability context now identify Glashaus Activity on iPhone and the Reminders page on Mac. The affected live case passed after the correction.
- A controlled-time live check-in used an actual source quote and a relevant previously discussed interest. Local time is supplied explicitly so UTC does not mislabel evening. A single successful example cannot establish long-term relevance or tone.
- The selected trial is enabled from 9 am to 9 pm, America/New_York, at most two daily. Implementation waits two hours after conversation and four hours between check-ins, with context expiring after 24 hours. It can choose silence. The owner should judge whether these gaps feel right through ordinary use.
- Unit tests cover quiet hours, local-day limits, DST, failed/invalid evidence, repeated evaluation, new chat/profile/pause/forgotten-source invalidation, archive restore, and deletion. Restore disables outreach and expires available check-ins. Credentials never enter portable archives.

Verification: 96 unit/API tests passed, TypeScript and production build passed, both browser suites passed (the action suite was rerun after fixing its Settings-navigation selector), and all five distinct native scenarios have passed across the dark suite and targeted large-text connection runs. Device signing and installation passed. The owner confirmed that the updated phone reconnects and shows Elle and the requested check-in preferences. Extended personality review and physical accessibility testing remain separate from that confirmation.

## Remaining at the time of this historical pass

APNs delivery and real closed-app testing, natural voice, iCloud mail and calendar integration, recurring schedules, remote access, and routine host operation remain. The in-app initiative increment does not complete Stage 3. Voice-provider selection, hosted audio consent, and budget should be decided before private audio trials. No membership or service purchase was made.
