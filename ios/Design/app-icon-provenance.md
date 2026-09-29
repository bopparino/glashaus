# Glashaus app icon

- Asset: `../Glashaus/Assets.xcassets/AppIcon.appiconset/AppIcon.png`
- Generation: built-in `image_gen.imagegen`, 2026-09-28.
- Exact generation prompt: `app-icon.prompt.txt`; also embedded into the shipping PNG with Impeccable `embed-prompt`.
- Original generated output: `local-generation/01a0e93d-db37-7380-a3f2-c3a12a1d40bc/exec-34a42a68-562b-4b4e-a741-6225c95773aa.png`.
- Native generated dimensions: 1254 × 1254 pixels. Shipping icon resampled with macOS `sips` to the required 1024 × 1024 pixels, without changing artwork or aspect ratio.
- Visual reference: the previously inspected approved Terminal Pastoralism composition in `approved-activity.png` and the generated pastoral landscape in `../Glashaus/Assets.xcassets/PastoralLandscape.imageset/landscape.png`. The icon simplifies their enormous weathered sphere and subdued countryside into one focal shape, pale stone on charcoal.
- Asset catalog: universal iOS 1024 × 1024 app icon entry in `AppIcon.appiconset/Contents.json`.
- Verification: visually inspected final shipping PNG. Single prominent complete sphere, narrow subtle pastoral foreground, no text, UI, device frame, border, or rounded-corner mask. `sips` confirms 1024 × 1024 pixels and `hasAlpha: no`.
