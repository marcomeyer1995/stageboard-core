import { useState } from 'react'
import { formatCommentDirective, formatTabStartDirective } from '../lib/chordpro'
import { useProfilesStore } from '../store/useProfilesStore'
import { TargetPicker } from './CommentListEditor'
import { useCommentTemplates } from './CommentTemplatesSettings'
import { Button, Dialog, Field, Section } from './ui'

/** Six strings, high to low, with room for a riff - what a hand-typed tab always started with. */
export const TAB_SKELETON = ['e', 'B', 'G', 'D', 'A', 'E'].map((string) => `${string}|----------------|`).join('\n')

/** The ChordPro lines of a tab block for `targets` (null = everyone): `{sot4marco}` + skeleton + `{eot}`. */
export function tabBlockLines(targets: string[] | null): string {
  return `${formatTabStartDirective(null, targets)}\n${TAB_SKELETON}\n{end_of_tab}`
}

/** Lowercased tokens for TargetPicker, which matches the way the parser does. */
const tokens = (names: string[] | null) => names?.map((name) => name.trim().toLowerCase()) ?? null

/**
 * "+ Kommentar" (#608): the text - typed or one of the band's templates - and who sees it, written
 * as exactly the `{cc4marco,jamie: …}` syntax lib/chordpro.ts parses, instead of typed from memory.
 */
export function InsertCommentDialog({ onInsert, onClose }: { onInsert: (line: string) => void; onClose: () => void }) {
  const profiles = useProfilesStore((state) => state.profiles)
  const templates = useCommentTemplates()
  const [text, setText] = useState('')
  const [targets, setTargets] = useState<string[] | null>(null)
  const insert = () => {
    if (!text.trim()) return
    onInsert(formatCommentDirective(text.trim(), targets))
    onClose()
  }
  return (
    <Dialog
      title="Kommentar einfügen"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={insert}>
            Einfügen
          </Button>
        </>
      }
    >
      <Field
        label="Text"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') insert()
        }}
      />
      {templates.length > 0 && (
        <Section title="Vorlagen">
          <div className="flex flex-wrap gap-2">
            {/* Tapping one fills in the text (an action, not a ✓-choice - docs/15). */}
            {templates.map((template) => (
              <Button key={template} onClick={() => setText(template)}>
                {template}
              </Button>
            ))}
          </div>
        </Section>
      )}
      <TargetPicker profiles={profiles} targets={tokens(targets)} onChange={setTargets} />
    </Dialog>
  )
}

/** "+ Tab" (#608): a six-string skeleton inside `{start_of_tab}` … `{end_of_tab}`, for everyone or a few. */
export function InsertTabDialog({ onInsert, onClose }: { onInsert: (lines: string) => void; onClose: () => void }) {
  const profiles = useProfilesStore((state) => state.profiles)
  const [targets, setTargets] = useState<string[] | null>(null)
  return (
    <Dialog
      title="Tab einfügen"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            onClick={() => {
              onInsert(tabBlockLines(targets))
              onClose()
            }}
          >
            Einfügen
          </Button>
        </>
      }
    >
      <pre className="overflow-x-auto rounded-control bg-control p-3 font-sb-mono text-sm text-ink-soft">{TAB_SKELETON}</pre>
      <TargetPicker profiles={profiles} targets={tokens(targets)} onChange={setTargets} />
    </Dialog>
  )
}
