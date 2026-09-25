# App icon (3.1.2)

`clock-cutout.png` is the transparent master, edited with the built-in imagegen
tool from the user's supplied clock image. The follow-up request changed the
casing to white and made the dial more restrained, retaining subtle color and glass. Web/native exports are regenerated with
`node scripts/generate-ios-icon.mjs`; this resizes without a new generation.

Final user-approved processing: deterministic circular mask retains only the
glass dial from `clock-glass-source.png`. The casing is a solid #ffffff rounded
square with no bevel, gradient or shadow; exterior corners are transparent.
The generator writes `clock-cutout.png` plus all platform exports and checks
transparent corners and a pure-white casing pixel. No further AI edit is used.

Initial redesign prompt:

> Edit the supplied clock app icon. User revision: make the casing simply pure white and the clock dial less childish. Retain the rounded-square casing and centered analog clock composition. Replace rainbow iridescence and colorful jelly/plastic detailing with restrained premium minimal industrial design: pure matte white casing, white dial, thin precise charcoal hour ticks, slim dark graphite hour and minute hands in the same approximate positions, a very fine subdued orange seconds hand and small understated central pivot. No numerals, no text, no rainbow, no bubbly markers, no oversized glossy hands. Subtle realistic depth and gentle shadows only; clean legibility as a small iOS/web app icon. Remove only the external background: genuinely transparent alpha outside the white rounded-square casing, clean antialiased edges without fringe. The white casing and dial must remain opaque. Entire icon visible centered on square canvas, minimal padding.

Final revision prompt (built-in imagegen):

> Edit target: this minimalist white clock app icon. Refine per user: retain a LITTLE color and glass quality. Keep the pure white rounded-square casing and white dial, restrained thin hour markers and simple analog composition. Add elegant clear-glass surface sheen and subtle beveled glass edges, delicate reflections, NOT rainbow casing. Hour hand muted translucent ice blue, minute hand muted translucent lavender-blue, seconds hand subtle warm amber. Small restrained glass central pivot. Hour markers remain slim neutral gray, perhaps extremely faint cool tint. Mature premium minimal design, not toy-like, no bright rainbow, no bubbly or thick jelly parts. Preserve layout and approximate hand positions. Entire icon centered, fully visible. Clean transparent background outside the rounded-square casing, no exterior shadow, no white residue, no rough fringe. White dial and casing are opaque.
