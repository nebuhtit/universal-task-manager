/** Keep an anchored panel usable when iOS pans the visual viewport for a keyboard. */
export function liveTextPanelPlacement(input: { top: number; bottom: number; viewportTop: number; viewportBottom: number; gap: number; accessory: number; minimum: number; preferBelow: boolean }) {
  const above = Math.max(0, input.top - input.viewportTop - input.gap);
  const below = Math.max(0, input.viewportBottom - input.accessory - input.gap - input.bottom);
  const preferred = input.preferBelow ? below : above;
  const alternate = input.preferBelow ? above : below;
  const flip = preferred < input.minimum && alternate > preferred;
  const placeBelow = flip ? !input.preferBelow : input.preferBelow;
  return { side: placeBelow ? 'below' : 'above', height: placeBelow ? below : above } as const;
}
