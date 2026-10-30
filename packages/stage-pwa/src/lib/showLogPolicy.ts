import { showLogCategory, type ShowLogEvent } from 'shared-types'

/**
 * What the band does not record in its Nachbericht (#673, BandSettings.showLogOff) - mirrored here
 * by the band settings store, so the show log can check it without loading that store (and its
 * database) itself.
 */
let off: readonly string[] = []

export function setShowLogOff(categories: readonly string[] | undefined): void {
  off = categories ?? []
}

/** Whether an event of this type is recorded: all are, unless an admin switched its category off. */
export function isShowLogTypeRecorded(type: ShowLogEvent['type']): boolean {
  const category = showLogCategory({ type })
  return category === null || !off.includes(category)
}
