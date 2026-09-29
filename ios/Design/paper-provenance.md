# Reminder paper

- Asset: `../Glashaus/Assets.xcassets/ReminderPaper.imageset/paper.png`
- Generation: built-in `image_gen.imagegen`, 2026-09-28, opaque PNG.
- Exact generation prompt: `paper.prompt.txt`; also embedded into the PNG with Impeccable `embed-prompt`.
- Requested dimensions: 1024 × 1024 pixels; native tool output retained at 1254 × 1254 pixels.
- Original generated output: `local-generation/01a0e93d-db37-7380-a3f2-c3a12a1d40bc/exec-90a42e40-ce39-431c-9035-80bc8f4019a0.png`.
- Visual reference: the reminder card surface in selected Terminal Pastoralism option 1, recorded in `approved-activity.png`. Target background color approximately `#e7e2d7`.
- Intended usage: subtle resizable SwiftUI `ReminderCard` background.
- Verification: visually inspected square output; subtle warm off-white paper grain, no text, stains, borders, vignette, or objects. Read-only PNG statistics: mean RGB `(229.30, 223.85, 211.41)`; standard deviation `(2.73, 3.03, 3.12)` on an 8-bit scale. Low variation keeps the texture quiet behind card content.
