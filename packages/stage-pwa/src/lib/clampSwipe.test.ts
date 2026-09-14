import { describe, expect, it } from 'vitest'
import type { ClientRect } from '@dnd-kit/core'
import { clampSwipe } from './clampSwipe'

/** Feeds `clampSwipe` a minimal stand-in for dnd-kit's own Modifier args - only `transform.x`
 * and `draggingNodeRect.width` are ever read, so everything else is a throwaway null/empty
 * value rather than a full drag simulation (dnd-kit's real pointer-sensor pipeline isn't
 * exercised anywhere in this project's test suite - swipe/drag gestures are verified live on a
 * real device instead). */
function callClampSwipe(x: number, draggingNodeRectWidth: number | null) {
  return clampSwipe({
    transform: { x, y: 0, scaleX: 1, scaleY: 1 },
    draggingNodeRect: draggingNodeRectWidth === null ? null : ({ width: draggingNodeRectWidth } as ClientRect),
    activatorEvent: null,
    active: null,
    activeNodeRect: null,
    containerNodeRect: null,
    over: null,
    overlayNodeRect: null,
    scrollableAncestors: [],
    scrollableAncestorRects: [],
    windowRect: null,
  })
}

describe('clampSwipe', () => {
  it('disallows sliding left entirely (Marco, explicit request)', () => {
    expect(callClampSwipe(-40, 400).x).toBe(0)
  })

  it("clamps sliding right at half the dragged row's own width", () => {
    expect(callClampSwipe(500, 400).x).toBe(200)
  })

  it('passes an in-range x through unchanged', () => {
    expect(callClampSwipe(120, 400).x).toBe(120)
  })

  it('still disallows left with no measured row width yet', () => {
    expect(callClampSwipe(-40, null).x).toBe(0)
  })
})
