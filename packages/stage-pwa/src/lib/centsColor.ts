/**
 * Maps a cents deviation to a red -> yellow -> green traffic-light color, via HSL hue
 * (120° green at 0 cents, sliding down to 0° red at ±50 cents) rather than a straight RGB
 * interpolation, which would pass through a dull, hard-to-read olive/brown in the middle
 * of the range instead of a natural-looking gradient.
 */
export function centsToColor(cents: number): string {
  const clamped = Math.min(50, Math.abs(cents))
  const hue = 120 - (clamped / 50) * 120
  return `hsl(${hue}, 85%, 50%)`
}
