# Glashaus mobile density QA — September 28, 2026

final result: passed

disposition: ship

Scope: the owner's mobile-first refinement of connection status, the conversation header, composer, send button, and everyday roadmap copy. The full-page artwork and native tab structure remain the visual foundation. The Mac web interface is outside this pass.

## Findings

- **[P2] Send symbol overflow at accessibility text sizes — resolved.** Initial light/accessibility-extra-large evidence showed the arrow extending beyond its 32-point circle. Dynamic Type is now capped at `xxxLarge` for that symbol only. Message text retains the full range and the send target remains 44 × 44 points. The initial and corrected multiline captures were opened together; the final arrow fits with visible inset, and the enabled/disabled variants retain their meaning. No blocking regression was observed in the bounded confirmation pass.
- The requested simplifications are visible: Activity has no healthy-connection pill; Conversation has no duplicate title/book bar; one compact surface contains text input and send; routine upcoming-feature text is removed. Connection status remains under Settings → Mac connection, Memories remains under Settings, and offline recovery stays in context.

## Source and rendered evidence

Source visual truth: `.impeccable/review/compact-mobile/before/activity-dark.png` and `before/conversation-dark.png`, together with the owner's explicit critique. These are the previous installed design, not a new mock to clone. The requested changes intentionally reduce its chrome while preserving palette, materials, and native interaction structure. `ios/Design/direction.md` records the updated authority.

Implementation evidence is under `.impeccable/review/compact-mobile/`:

- `dark/screens/`: initial Activity, Conversation, Settings, editor, landscape, and actual keyboard-open single/multiline states.
- `light-large/screens/`: initial light/accessibility-extra-large states; `composer-multiline.png` records the icon overflow.
- `light-final/`: corrected light/accessibility-extra-large states. The multiline keyboard capture and landscape capture were opened for the final check.
- `dark-final/`: corrected standard-text dark states. Conversation and focused input with enabled send were reopened. The final file named `composer-keyboard.png` shows focus with the software keyboard absent; keyboard-open dark evidence is the initial `dark/screens/composer-keyboard.png`.

Before/after Conversation and before/after Activity were each opened in the same comparison input. Initial/corrected large-type multiline captures were likewise opened together. The final Conversation was again compared with the original screenshot. Control details are legible in those full-resolution inputs, so additional cropped images were not necessary.

Viewport: iPhone 17 / iOS 27 Simulator, 402 × 874 points, density 3×. Portrait captures are 1206 × 2622 pixels. Landscape is 874 × 402 points; the captured PNGs retain a 1206 × 2622 raster with orientation metadata, rendered as landscape by the image viewer. No web/CSS viewport applies, and no resampling was used. Both comparisons use the same device/density. Fixture history and scroll position differ between runs because functional tests add sample turns; those differences are not design drift or evidence of duplicate delivery. All capture content is synthetic.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts and typography | Native SF semantic body styles remain. The composer text scales through accessibility sizes, wraps, and scrolls after five lines. Only the send symbol has a size ceiling to fit its compact control. |
| Spacing and layout | The navigation bar is hidden only in Conversation. Input and send share a 44-point minimum row with 6-point outer vertical padding. The visible send circle is 32 points with a 44-point target. Keyboard-open and landscape views retain accessible input; native tabs and other navigation stacks remain. |
| Colors and tokens | Existing adaptive charcoal, warm light, ink, and olive remain. The composer uses the opaque reading surface. Enabled send uses ink/ground contrast; disabled send uses secondary ink with a low-opacity fill. This was a visual review, not a new measured contrast-ratio audit. |
| Image quality | The accepted full-page artwork, reading washes, and paper asset are unchanged. Native clipping and safe areas remain; no rasterized controls or replacement illustration were introduced. |
| Copy and app content | The exact quoted roadmap sentence was absent from current source and built web assets. Equivalent upcoming-feature text was removed from Activity and simplified in check-in preferences. Action-specific draft/confirmation and calendar-scope guidance remains in the reminder editor. Settings still provides memory and connection access. |

## Interaction verification

- `ios/build/CompactMobileDark.xcresult`: three selected scenarios passed, zero failures. They exercise pairing, one-tap confirmation, sending, relaunch, memory editing through Settings, interrupted-message recovery without duplicate submission, revocation, and visual states.
- `ios/build/CompactMobileLightLarge.xcresult`: visual scenario passed at accessibility-extra-large text in light appearance, including multiline input and sending.
- `ios/build/CompactMobileLightFinal.xcresult` and `CompactMobileDarkFinal.xcresult`: visual scenarios passed after the symbol-only correction. Rendered evidence was opened; compilation alone was not used as visual proof.
- The final signed build succeeded and was installed on the owner's iPhone 17. Existing pairing and companion data were preserved. Hardware launch status is recorded separately in the delivery note below.

No backend or browser logic changed. The live Mac service and personal development home were left running; native tests use a disposable fixture. Full physical VoiceOver/gesture verification is outside this refinement.

## Comparison history and checklist

1. The first batched round confirmed the requested density changes and identified one P2 icon-scaling defect.
2. One correction batch capped the symbol's Dynamic Type range. The final dark and light/large-text comparisons confirmed the correction without changing text scaling or the touch target. No further polish loop was performed.

- [x] Remove the healthy-connection toolbar pill and duplicate chat header/book shortcut.
- [x] Keep Memories and Mac connection reachable through Settings.
- [x] Compact the composer and send control without shrinking its hit target.
- [x] Review normal, large-text, keyboard, multiline, and landscape evidence.
- [x] Remove routine roadmap copy while keeping current-action guidance.
- [x] Install the signed build on the owner's phone.

No additional P3 polish is requested. Owner review of the new density remains the final subjective assessment.

Delivery note: `devicectl` confirmed successful launch of `net.glashaus.companion` on the physical iPhone after installation. This proves startup, not a new owner interaction or VoiceOver review.

## Native completion extension — September 28, 2026

The later completion pass retains the compact Terminal Pastoralism system and extends it with Home, three artwork presets plus Plain, voice, account connections and exact proposals, and reversible iPhone-only chat-view clearing. Authority and scope are recorded in `.impeccable/review/completion/brief.md`; its Home change supersedes historical Activity tab naming.

The fresh finish reviewer identified three material issues: Home/Voice reading contrast and Voice tint, an unconfigured Voice state that still claimed Ready, and discretionary hyphens in exact email addresses at large text sizes. The recapture verdict in `.impeccable/review/completion/verdict.md` marks all three resolved and gives a bounded **ship** disposition. It also checked the additional clear-view menu and cleared-state captures. That verdict is for the scored fixes, not a new full-surface or live-account review.

The fresh documenter compared the native source, incumbent system files, current dark/default and light/accessibility-extra-large evidence, and accepted compact-mobile Conversation/Settings references. Palette primitives, native semantic type, reading washes, paper, surface geometry, and compact composer metrics remain consistent. `ios/DESIGN.md` and `ios/.impeccable/design.json` were preserved. The precise source and screenshot sample, system summary, authorized extensions, and unrefreshed historical documentation are recorded in `.impeccable/review/completion/documenter.md`.

Evidence limits remain explicit: no web detector ran, this documentation pass added no automated or hardware tests, and final composer captures prove focus with the simulator hardware keyboard rather than current software-keyboard avoidance. The user confirmed installed chat clearing, two voice turns plus interruption, a real Calendar write, and an email send in the parent task; these are owner acceptance reports, separate from the screenshot review. No additional design-system rewrite or polish loop was performed.
