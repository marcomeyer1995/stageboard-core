import { DEFAULT_COMMENT_TEMPLATES } from 'shared-types'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { AddRow, IconButton } from './ui'

/** The band's comment templates (#608), or the defaults while the band has none of its own. */
export function useCommentTemplates(): readonly string[] {
  return useBandSettingsStore((state) => state.settings.commentTemplates) ?? DEFAULT_COMMENT_TEMPLATES
}

/**
 * System → Band: the texts "+ Kommentar" offers in the song editor (#608) - one list for the whole
 * band, so "Solo 8 Takte" reads the same on every Prompter. Band settings are admin-only (server
 * rule), like "Geprobt".
 */
export function CommentTemplatesSettings() {
  const settings = useBandSettingsStore((state) => state.settings)
  const save = useBandSettingsStore((state) => state.save)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false)
  const promptText = useDialogStore((state) => state.promptText)
  const templates = useCommentTemplates()
  const store = (next: string[]) => void save({ ...settings, commentTemplates: next })

  return (
    <section aria-label="Kommentar-Vorlagen" className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">Kommentar-Vorlagen</h2>
      <p className="text-sm text-ink-faint">
        {isAdmin ? 'Im Song-Editor bei „+ Kommentar“ zum Antippen - für alle Geräte der Band.' : 'Nur der Band-Admin kann die Vorlagen ändern.'}
      </p>
      <ul className="flex flex-col gap-1">
        {templates.map((template) => (
          <li key={template} className="flex min-h-form items-center gap-2 rounded-control bg-control pl-4 pr-1 text-base text-ink">
            <span className="min-w-0 flex-1 truncate">{template}</span>
            {isAdmin && (
              <IconButton icon="delete" label={`Vorlage „${template}“ löschen`} variant="quiet" onClick={() => store(templates.filter((t) => t !== template))} />
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <AddRow
          label="Neue Vorlage"
          onClick={async () => {
            const text = (await promptText('Neue Vorlage', { label: 'Text des Kommentars' }))?.trim()
            if (text && !templates.includes(text)) store([...templates, text])
          }}
        />
      )}
    </section>
  )
}
