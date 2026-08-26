/** Within this many cents of dead-on, the indicator is strictly green - not just "close
 * enough to look green" on a continuous gradient. */
const GREEN_THRESHOLD_CENTS = 2
const MAX_CENTS = 50
const GREEN_HUE = 120
const ORANGE_HUE = 30
const RED_HUE = 0

/**
 * Maps a cents deviation to a color: strictly green within +/-2 cents, then a deliberate
 * jump straight to orange (not yellow) just past that, degrading further to red as the
 * deviation grows toward +/-50 cents. Two distinct regimes - "in tune" vs "how far off" -
 * not one smooth green-to-red gradient, since a smooth gradient would spend a lot of its
 * range looking "basically green" for a note that's actually already out of tune.
 */
export function centsToColor(cents: number): string {
  const abs = Math.min(MAX_CENTS, Math.abs(cents))
  if (abs <= GREEN_THRESHOLD_CENTS) return `hsl(${GREEN_HUE}, 85%, 50%)`
  const t = (abs - GREEN_THRESHOLD_CENTS) / (MAX_CENTS - GREEN_THRESHOLD_CENTS)
  const hue = ORANGE_HUE - t * (ORANGE_HUE - RED_HUE)
  return `hsl(${hue}, 85%, 50%)`
}
