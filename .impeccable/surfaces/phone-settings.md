---
version: 1
slug: "phone-settings"
primary_target: "app/web/Mobile.tsx"
related_targets: ["app/web/Settings.tsx", "app/web/forms.css", "ios/GlasHaus/GlasHausApp.swift"]
---

# Settings: Your phone

Mode: Operate. A narrow extension of the existing web Settings page; the native phone app has its own system in `ios/DESIGN.md`.

THESIS: Connect the owner's iPhone to the continuing companion and make connected-device access easy to understand and revoke.

OWN-WORLD: Inherit Prism's open Settings sections, Archivo copy, compact mono helpers, neutral buttons and existing error notice. No replacement palette, artwork or web navigation.

STORY: Check phone-connection availability, create a one-use code, copy it into the native app alongside the host's private HTTPS address, then inspect or disconnect paired devices. Expanded setup guidance explains the private Tailscale route and the awake-host requirement.

FIRST VIEWPORT: The existing Settings hierarchy remains. Your phone contains a heading, short explanation and code action. Checking, unavailable-host and failure states occupy this same section. A created code appears with remaining time and copy feedback; expired codes become a plain status. Connected devices use open rows with last-connected metadata and a Disconnect action. Setup details stay collapsible.

FORM: Extend the confirmed Prism implementation. Pairing output uses monospace at (1.5rem), tracking (0.04em), and a (20px) block margin. Device rows use (16px) gaps/insets, a (24px) list margin and the incumbent rule border. Host command text wraps and supports selection. These are surface-specific facts, not a new global token system.

## Implementation and verification

The section reports initial checking, exposes Refresh connections after failure, disables code creation when the listener is unavailable, counts down expiry, labels the code for assistive technology and refreshes the device list while a code remains active. Each Disconnect control includes its device name in its accessible text.

The parent Impeccable pass reviewed the web pairing section and reported both of its two state findings resolved. The resolved findings were a stale connected-device list after pairing and ambiguous initial-load/failure messaging. The section now polls during an active pairing code and distinguishes checking, recoverable failure and confirmed unavailability. That review applies to this web extension only. Root `DESIGN.md` and `.impeccable/design.json` were not changed by the documentation pass.

The native app compiled with Xcode 27, but its visual walkthrough remains **incomplete because simulator control was blocked**. The user's approved native direction and successful compilation must not be described as native rendered approval. Native design and product scope are recorded under `ios/`.
