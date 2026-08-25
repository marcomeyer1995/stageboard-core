/**
 * Keeps the PWA pinned at 100 % zoom. The viewport meta tag alone is not enough:
 * iOS Safari ignores `user-scalable=no`, and desktop browsers zoom on ctrl+wheel and
 * ctrl+plus regardless. On stage a zoomed or panned view means a musician stares at
 * half a widget, so every zoom path gets closed explicitly.
 */
export function lockViewport(): void {
  // Safari's pinch gesture events (non-standard, iOS/macOS only).
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false })
  }

  // Trackpad pinch and ctrl+wheel arrive as a wheel event with ctrlKey set.
  document.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) event.preventDefault()
    },
    { passive: false },
  )

  // Ctrl/Cmd +, -, 0.
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (['+', '-', '=', '0'].includes(event.key)) event.preventDefault()
  })
}
