import { EDIT_BAR_SLOT_ID } from '../lib/useEditBarSlot'

/**
 * The status bar's place while editing (#370, Marco's choice A): the dashboard's edit bar is
 * rendered into it, so the grid below keeps exactly the area it has on stage - true size, no
 * scrolling. Same height as the status bar (h-14).
 */
export function EditBarSlot() {
  return <div id={EDIT_BAR_SLOT_ID} className="flex h-14 flex-shrink-0 border-b border-line bg-surface" />
}
