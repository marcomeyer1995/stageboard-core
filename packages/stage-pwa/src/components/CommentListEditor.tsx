import type { Profile } from 'shared-types'
import {
  formatCommentDirective,
  formatTabStartDirective,
  listCommentDirectives,
  listTabBlocks,
} from '../lib/chordpro'
import { useProfilesStore } from '../store/useProfilesStore'
import { INPUT_FREE } from './ui/styles'
import { ToggleChip, Button } from './ui'
import { useTranslation } from 'react-i18next'

interface CommentListEditorProps {
  content: string
  onChange: (content: string) => void
}

/**
 * Lists every `{comment:}`/`{c:}`/`{cc:}`/`{cc4...}` directive currently in a SongVariant's
 * ChordPro text (issue #215 follow-up) and lets you retarget, re-word, or remove it - who a
 * note is "for" (Marco: a guitarist's "start solo fret 7" isn't interesting to the singer)
 * without hand-writing the `cc4marco,jamie` comma syntax. A comment's *position* in the song
 * still comes from wherever its directive line sits in the text (the "+ Kommentar" button next
 * to +Verse/+Chorus/+Bridge inserts a blank one at the caret) - this tab only edits what
 * already exists there.
 *
 * No stable id backs a comment (Marco, explicit preference: readable names, not opaque ids) -
 * every edit here recomputes `listCommentDirectives(content)` fresh and patches the matching
 * line by its current line number, which is only meaningful for the instant it was read: fine,
 * since every handler below re-derives it from the latest `content` right before patching,
 * never a value held across a render.
 */
export function CommentListEditor({ content, onChange }: CommentListEditorProps) {
  const { t } = useTranslation('editor')
  const profiles = useProfilesStore((state) => state.profiles)
  const occurrences = listCommentDirectives(content)
  const tabBlocks = listTabBlocks(content)

  function patchLine(lineNumber: number, text: string, targets: string[] | null) {
    const lines = content.split('\n')
    lines[lineNumber] = formatCommentDirective(text, targets)
    onChange(lines.join('\n'))
  }

  function remove(lineNumber: number) {
    const lines = content.split('\n')
    lines.splice(lineNumber, 1)
    onChange(lines.join('\n'))
  }

  /** A tab block's visibility lives on its opening directive line only - the riff itself is
   * never touched. */
  function patchTabTargets(lineNumber: number, label: string | null, targets: string[] | null) {
    const lines = content.split('\n')
    lines[lineNumber] = formatTabStartDirective(label, targets)
    onChange(lines.join('\n'))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">{t('cm.comments')}</p>
      {occurrences.length === 0 ? (
        <p className="text-xs text-ink-faint">
          {t('cm.none')}
        </p>
      ) : (
        // Capped height, not open-ended - a long list must not push what follows it down.
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {occurrences.map((occurrence) => (
            <div
              key={occurrence.lineNumber}
              className="flex flex-col gap-2 rounded-control bg-control px-3 py-2 text-sm text-ink-soft"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={occurrence.text}
                  onChange={(e) => patchLine(occurrence.lineNumber, e.target.value, occurrence.targets)}
                  className={`min-h-form flex-1 min-w-0 px-3 text-base ${INPUT_FREE}`}
                />
                <Button onClick={() => remove(occurrence.lineNumber)}>
                  {t('remove')}
                </Button>
              </div>
              <TargetPicker
                profiles={profiles}
                targets={occurrence.targets}
                onChange={(targets) => patchLine(occurrence.lineNumber, occurrence.text, targets)}
              />
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-sm text-ink-muted">{t('cm.tabs')}</p>
      {tabBlocks.length === 0 ? (
        <p className="text-xs text-ink-faint">
          {t('cm.noTabs')}
        </p>
      ) : (
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {tabBlocks.map((block, index) => (
            <div
              key={block.lineNumber}
              className="flex flex-col gap-2 rounded-control bg-control px-3 py-2 text-sm text-ink-soft"
            >
              <span>
                {block.label ?? t('cm.tabN', { n: index + 1 })}{' '}
                <span className="text-xs text-ink-faint">{t('cm.lines', { count: block.lineCount })}</span>
              </span>
              <TargetPicker
                profiles={profiles}
                targets={block.targets}
                onChange={(targets) => patchTabTargets(block.lineNumber, block.label, targets)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** "Sichtbar für:" member toggles, shared by comments and tab blocks (here and in the timeline's
 * notes lane). `onChange` gets the roster's own display-case names (what gets written back into
 * the text), or null for "everyone" - `targets` in are the lowercased matching tokens the parser
 * produces. */
export function TargetPicker({
  profiles,
  targets,
  onChange,
}: {
  profiles: Profile[]
  targets: string[] | null
  onChange: (targets: string[] | null) => void
}) {
  const { t } = useTranslation('editor')
  function toggle(profile: Profile) {
    const key = profile.name.trim().toLowerCase()
    const current = targets ?? []
    const next = current.includes(key) ? current.filter((target) => target !== key) : [...current, key]
    const displayNames = profiles.filter((p) => next.includes(p.name.trim().toLowerCase())).map((p) => p.name)
    onChange(displayNames.length > 0 ? displayNames : null)
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-ink-faint">{t('cm.visible')}</span>
      {profiles.length === 0 ? (
        <span className="text-ink-faint">{t('cm.allNoMembers')}</span>
      ) : (
        <>
          {profiles.map((profile) => {
            const checked = targets?.includes(profile.name.trim().toLowerCase()) ?? false
            return (
              <ToggleChip key={profile.id} label={profile.name} selected={checked} onToggle={() => toggle(profile)} />
            )
          })}
          {targets === null && <span className="text-ink-faint">{t('cm.allNone')}</span>}
        </>
      )}
    </div>
  )
}
