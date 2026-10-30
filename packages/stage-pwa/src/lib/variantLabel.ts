import i18n from '../i18n'
import type { VariantIssue } from './computeQueue'

/**
 * How a variant's name is shown on stage (status bar, Live-Queue, Next-Song). Variants created by
 * beat detection carry the algorithm in their name - "Auto: music-tempo (Beatroot, MIT)" - which
 * is useful in the editor's variant picker but noise in the show views (#377: it filled the status
 * bar and wrapped every queue row). There they read just "Auto".
 */
export function stageVariantLabel(label: string): string {
  return /^auto\s*:/i.test(label.trim()) ? 'Auto' : label
}

/** What stands where a song entry's variant is missing (computeQueue's VariantIssue) - in the
 * setlist, the queue and the status bar alike, never another variant's name. */
export const VARIANT_ISSUE_LABEL: Record<VariantIssue, string> = {
  get deleted() {
    return i18n.t('library:variant.deleted')
  },
  get 'no-default'() {
    return i18n.t('library:variant.noDefault')
  },
}
