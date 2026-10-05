import { useEffect, useState } from 'react'

/** Id of the element App renders in the status bar's place while a dashboard is being edited. */
export const EDIT_BAR_SLOT_ID = 'dashboard-edit-bar-slot'

/** The edit bar's slot (components/EditBarSlot.tsx) once it is in the document - null outside
 * edit mode. Looked up after each change of `editing`: App renders the slot in the same commit. */
export function useEditBarSlot(editing: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setSlot(editing ? document.getElementById(EDIT_BAR_SLOT_ID) : null)
  }, [editing])
  return slot
}
