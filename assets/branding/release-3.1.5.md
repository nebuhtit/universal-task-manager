# 3.1.5 icon sources

Created with built-in imagegen. Selected sources are `clock-light-source.png`
and `clock-dark-source.png`; `generate-ios-icon.mjs` applies the user-approved
rounded mask for web exports and creates opaque iOS appearance assets. A neutral
color-range mask flattens near-white paper grain to #ffffff and near-black grain
to #141414, retaining the colored glass hands and contrasting markers.
Older glass source is retained for provenance, not consumed by the generator.
The web favicon follows the system color scheme. Installed web app icon theme
switching is browser-controlled; its manifest retains the default light icon.

Light prompt:

> Edit app icon. Output FULLY OPAQUE square PNG. NO transparency anywhere, all background solid #ffffff including all corners, outer casing, and clock face. Pure uniform paper white with NO gray shading, NO face reflections, NO gradients, NO shadows behind hands. Preserve subtle blue/lavender glass hands and amber seconds hand, gray slim hour marks and small glass pivot in their exact positions from input. Only a very thin neutral circle outlines the dial. Hands/pivot can have glossy material, but everywhere else must be solid white. Flat white square canvas full bleed. No text. Do not remove white background.

Dark prompt:

> Create the dark appearance variant of this EXACT clock app icon. Change only palette: all white background/casing/dial becomes perfectly uniform flat very dark charcoal #141414. Hour ticks and very thin circular outline become light silver gray. Keep exact same clock geometry, size, hand positions, understated glass blue/lavender hour/minute hands, amber seconds hand, small glass pivot. Hands may be slightly brighter for contrast. NO gradients or reflections on the background, NO shadows behind hands, no plastic casing, no bevel. Full bleed OPAQUE square PNG, including all corners. No transparency, no text.
