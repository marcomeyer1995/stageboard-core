import type { Modifier } from '@dnd-kit/core'

/**
 * Clamps a dnd-kit drag transform (Marco, explicit request, for LibraryView's swipe-to-add
 * song row): left is disallowed entirely - there's nothing to reveal that direction, only the
 * "+ Zur aktiven Setlist" reveal to the right - and right stops at half the dragged row's own
 * width, so a row can never slide far enough to fully vacate its own space or overlap the row
 * below it. Meant as a DndContext-level `modifiers` entry (not a per-row style clamp): only
 * there is `draggingNodeRect` - the actual dragged row's measured width - available at all.
 */
export const clampSwipe: Modifier = ({ transform, draggingNodeRect }) => ({
  ...transform,
  x: draggingNodeRect ? Math.min(Math.max(transform.x, 0), draggingNodeRect.width / 2) : Math.max(transform.x, 0),
})
