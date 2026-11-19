// Keyboard model for a WAI-ARIA radio group with a roving tab index.

/**
 * Maps a key press to the option a radio group should move to.
 *
 * Arrows move linearly and wrap at both ends (Right/Down forward, Left/Up
 * back); Home and End jump to the first and last option. `current = -1`
 * means nothing is selected, so forward lands on the first option and back on
 * the last. Returns `null` for keys the group does not handle, and for an
 * empty group.
 */
export function nextRadioIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
