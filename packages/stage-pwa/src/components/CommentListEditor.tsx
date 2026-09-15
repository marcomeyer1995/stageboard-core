import type { Profile } from 'shared-types'
import { formatCommentDirective, listCommentDirectives, type CommentDirectiveOccurrence } from '../lib/chordpro'
import { useProfilesStore } from '../store/useProfilesStore'

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
  const profiles = useProfilesStore((state) => state.profiles)
  const occurrences = listCommentDirectives(content)

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

  function toggleTarget(occurrence: CommentDirectiveOccurrence, profile: Profile) {
    const key = profile.name.trim().toLowerCase()
    const current = occurrence.targets ?? []
    const next = current.includes(key) ? current.filter((target) => target !== key) : [...current, key]
    // Written back out using the roster's own display-case names, not the lowercased tokens
    // `listCommentDirectives`/`parseCommentDirective` use for matching.
    const displayNames = profiles.filter((p) => next.includes(p.name.trim().toLowerCase())).map((p) => p.name)
    patchLine(occurrence.lineNumber, occurrence.text, displayNames.length > 0 ? displayNames : null)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">Kommentare</p>
      {occurrences.length === 0 ? (
        <p className="text-xs text-ink-faint">
          Noch keine Kommentare - "+ Kommentar" im ChordPro-Text fügt einen an der Cursorposition ein.
        </p>
      ) : (
        // Capped height, not open-ended - same reasoning as CueListEditor.tsx/BeatAnchorListEditor.tsx.
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {occurrences.map((occurrence) => (
            <div
              key={occurrence.lineNumber}
              className="flex flex-col gap-2 rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={occurrence.text}
                  onChange={(e) => patchLine(occurrence.lineNumber, e.target.value, occurrence.targets)}
                  className="flex-1 rounded-sb-sm bg-control-strong px-2 py-1 text-sm text-ink"
                />
                <button
                  type="button"
                  onClick={() => remove(occurrence.lineNumber)}
                  className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink-soft hover:bg-control-strong-hover"
                >
                  Entfernen
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-ink-faint">Sichtbar für:</span>
                {profiles.length === 0 ? (
                  <span className="text-ink-faint">alle (keine Bandmitglieder angelegt)</span>
                ) : (
                  <>
                    {profiles.map((profile) => {
                      const checked = occurrence.targets?.includes(profile.name.trim().toLowerCase()) ?? false
                      return (
                        <button
                          key={profile.id}
                          type="button"
                          onClick={() => toggleTarget(occurrence, profile)}
                          className={`rounded-sb-sm px-2 py-0.5 ${
                            checked
                              ? 'bg-accent text-accent-ink'
                              : 'bg-control-strong text-ink-soft hover:bg-control-strong-hover'
                          }`}
                        >
                          {profile.name}
                        </button>
                      )
                    })}
                    {occurrence.targets === null && <span className="text-ink-faint">(alle, da niemand ausgewählt)</span>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
