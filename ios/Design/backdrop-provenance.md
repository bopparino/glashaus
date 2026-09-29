# Full-page pastoral backdrop

- Created: 2026-09-28.
- Generation: built-in `image_gen` tool, one new opaque portrait artwork. No CLI fallback, crop, upscaling, compositing, or other pixel edits.
- Original generated file: `local-generation/01a0ea2d-e3c7-7511-9c25-21b7fb0dee38/exec-27dd9aad-46d4-4010-836c-f9bcc29cb098.png`.
- Project asset: `ios/Glashaus/Assets.xcassets/PastoralBackdrop.imageset/backdrop.png`.
- Requested dimensions: 1200 × 2608 pixels.
- Actual delivered dimensions: 851 × 1849 pixels; opaque PNG without alpha. The requested portrait aspect ratio is retained, but the built-in tool delivered a smaller raster.
- Exact prompt: `ios/Design/backdrop.prompt.txt`.
- Reference grounding: the user selected new artwork derived from the Terminal Pastoralism moodboards. Both `docs/visual-references/terminal-pastoralism-interface.png` and `docs/visual-references/terminal-pastoralism-world.png` were visually inspected, along with the existing `PastoralLandscape.imageset/landscape.png`. Their aesthetic was translated into the generation prompt; no reference pixels were reused. The tool call generated a brand-new image without an edit target.
- Visual inspection: a mist-softened industrial sphere sits toward the upper-right and middle, with a small farmhouse and track below. Quiet sky and atmospheric layers leave room for interface overlays. Muted stone, charcoal, and olive retain the chosen visual language. No text, UI, borders, or watermarks are visible.

Native code is responsible for layout, contrast surfaces, and responsive image framing. This file records the unmodified generated source.
