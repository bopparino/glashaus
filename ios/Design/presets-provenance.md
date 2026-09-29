# Background preset provenance

Created 2026-09-28 for GlasHaus iOS using the built-in `image_gen.imagegen` tool. Each backdrop was generated in a separate call. No CLI/API fallback was used.

## Visual references

These existing images were inspected before generation for palette, material, atmosphere, and density:

- `ios/Glashaus/Assets.xcassets/PastoralBackdrop.imageset/backdrop.png`
- User-supplied Terminal Pastoralism moodboard: `/var/folders/74/pwsqbqzs4rl7q7sbgdb4lf2m0000gn/T/codex-clipboard-1a259d89-d0d6-4f3a-83e9-6974899ab0ed.png`

Both new scenes inherit the established direction: desaturated rural land, weathered infrastructure, atmosphere, natural textures, and native UI reading space. References informed the prompts; these are newly generated scenery assets, not edits to the reference images.

## Field Quiet

- Asset: `ios/Glashaus/Assets.xcassets/FieldQuiet.imageset/backdrop.png`
- Built-in output: `local-generation/01a0ea7e-6bf7-7182-9886-5974f75ed8cd/exec-58bdb59e-1e8f-44f0-9255-20c6a66dc5a8.png`
- Actual dimensions: **851 × 1849 pixels**.
- SHA-256: `10cdfc68086dc72f0a3dffee42a8e5b2d02c6adb557ec7b37692b0856be4f47e`.
- Inspected: the upper area is quiet pale sky; the lower landscape has natural olive grass, mist, and a small distant weathered relay. No text, UI, people, or dominant futuristic object is present.

Exact generation prompt:

```text
Use case: stylized-concept
Asset type: finished full-bleed portrait iPhone background image, backdrop only.
Primary request: "Field Quiet" — a quiet misty rural horizon with distant weathered infrastructure and natural grass, in the Terminal Pastoralism aesthetic.
Scene/backdrop: a damp olive-grass field in a remote rural valley; layered low hills fade into pale overcast mist; a modest weathered concrete relay structure sits far away near the horizon, integrated into the landscape. The landscape feels lived-in and quietly reclaimed by nature. No dominant futuristic object.
Style/medium: cinematic naturalistic environmental artwork with believable photographed textures, subtle analog grain, subdued detail, worn materials, soft atmospheric depth, no illustration outlines.
Composition/framing: very tall portrait canvas, requested size 1206 × 2622 pixels (or closest available aspect ratio approximately 0.46 width to height); full bleed edge to edge. Keep the upper 55 percent calm: a simple desaturated gray-beige sky and light mist with very low visual contrast and no objects. Place the rural horizon and small subtle infrastructure focal point in the lower half. Natural foreground grass occupies the bottom; distant weathered infrastructure is secondary to the landscape and small in the frame. This image must work beneath actual native app controls, so avoid busy detail and hard contrast in the upper and central reading areas.
Lighting/mood: quiet overcast morning, gentle diffused daylight, contemplative and grounded.
Color palette: desaturated olive grass, warm gray mist, bone sky, charcoal distant materials, restrained earthy brown.
Constraints: create only scenery, with no text, no letters, no glyphs, no logos, no watermarks, no UI, no controls, no interface framing, no device, no people, no animals, no giant sphere, no neon, no cyberpunk, no glossy science-fiction object, no border. Opaque background.
```

## Night Relay

- Asset: `ios/Glashaus/Assets.xcassets/NightRelay.imageset/backdrop.png`
- Built-in output: `local-generation/01a0ea7e-6bf7-7182-9886-5974f75ed8cd/exec-25f31051-961a-4a16-9e34-626af7e12940.png`
- Actual dimensions: **851 × 1849 pixels**.
- SHA-256: `9ccbe05898d2db178c015913f46ede49fbf9ec69fc0139260d22a25023fe49e2`.
- Inspected: the upper area is cool dark sky; the lower landscape contains a distant relay, visible pasture detail, and a small amber farmhouse window. No text, UI, people, or neon styling is present.

Exact generation prompt:

```text
Use case: stylized-concept
Asset type: finished full-bleed portrait iPhone background image, backdrop only.
Primary request: "Night Relay" — a blue-charcoal rural landscape at dusk with a distant weathered radio relay and one small warm farmhouse light, in the Terminal Pastoralism aesthetic.
Scene/backdrop: a remote grassy valley and low rolling hills at the last blue light of evening. A modest old radio relay mast and weathered utility structure stand far away near the low horizon. Nearby, one small stone farmhouse has a single softly glowing amber window. Thin valley mist softens the distance. Human scale and natural reclamation dominate the scene; technology is quiet, worn, and far away.
Style/medium: cinematic naturalistic environmental artwork with believable photographed textures, subtle analog grain, soft atmospheric depth, quiet detailed grass, aged concrete, stone, and metal. Grounded and contemplative.
Composition/framing: very tall portrait canvas, requested size 1206 × 2622 pixels (or closest available aspect ratio approximately 0.46 width to height), full bleed edge to edge. Keep the upper 55 percent calm dark blue-gray evening sky with soft low-contrast clouds and no prominent objects. Place the horizon, distant relay, and tiny warm farmhouse light in the lower half. The radio mast must remain a small distant silhouette entirely below the upper reading space. Foreground pasture occupies the bottom. Image is placed behind actual native app controls, so keep the upper and central reading areas simple with low contrast. Retain visible landscape detail and atmospheric separation instead of crushing the entire scene to black.
Lighting/mood: dusk after sunset, muted twilight, quiet and reassuring, a small trace of domestic warmth in a broad cool landscape.
Color palette: desaturated blue-charcoal, slate, deep muted olive grass, cool gray mist, one tiny warm amber window light.
Constraints: create only scenery, with no text, no letters, no glyphs, no logos, no watermarks, no UI, no controls, no interface framing, no device, no people, no animals, no giant sphere, no neon, no cyberpunk, no light beams, no glowing antenna, no glossy science-fiction object, no border. Opaque background.
```

## Delivery and limits

The prompt requested 1206 × 2622 pixels or the closest available portrait ratio. The built-in tool returned 851 × 1849 for both (width-to-height ratio 0.4602), closely matching the requested ratio but at lower pixel dimensions. Both outputs were copied byte for byte into their Xcode image sets without cropping, retouching, resizing, or conversion; the generated originals remain in place. Each `Contents.json` declares a universal image named `backdrop.png`.

Visual inspection covers the generated artwork only. Live native controls, reading-overlay contrast, and device rendering must be checked by the implementation task.
