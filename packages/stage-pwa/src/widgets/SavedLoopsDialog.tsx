import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { ActionMenu, Button, Dialog, Field, ListRow } from '../components/ui'
import type { ClickTimeline } from '../lib/beatGrid'
import { formatLoopPoint } from '../lib/loopSnap'
import { randomId } from '../lib/id'
import { loopChanged, type SavedLoop } from '../lib/savedLoops'
import type { LoopTrainerConfig } from '../store/useLoopTrainerStore'
import { useSavedLoopsStore } from '../store/useSavedLoopsStore'

/**
 * The variant's saved loops (#683 step 3): recall one, save the current setting as a new one, or
 * save changes to the recalled one - for the whole band, there are no personal copies.
 */
export function SavedLoopsDialog({
  variantId,
  settings,
  timeline,
  onLoad,
  onClose,
}: {
  variantId: string
  settings: LoopTrainerConfig
  timeline: ClickTimeline | null
  onLoad: (loop: SavedLoop) => void
  onClose: () => void
}) {
  const { t } = useTranslation('widgets')
  const { t: tc } = useTranslation('common')
  const all = useSavedLoopsStore((state) => state.loops)
  const save = useSavedLoopsStore((state) => state.save)
  const remove = useSavedLoopsStore((state) => state.remove)
  const loops = all.filter((loop) => loop.variantId === variantId)
  const loaded = loops.find((loop) => loop.id === settings.savedLoopId) ?? null
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<SavedLoop | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [deleting, setDeleting] = useState<SavedLoop | null>(null)

  const range = (loop: SavedLoop) => {
    const at = (ms: number) => formatLoopPoint(timeline, ms, timeline ? loop.snap : 'free')
    const span = loop.snap === 'free' || !timeline ? `${at(loop.startMs)}–${at(loop.endMs)}` : t('loop.barRange', { from: at(loop.startMs), to: at(loop.endMs) })
    const tempo = loop.trainerEnabled ? t('loop.tempoRange', { from: loop.startPercent, to: loop.targetPercent }) : t('loop.tempo', { pct: loop.startPercent })
    return `${span} · ${tempo}`
  }
  const current = (): Omit<SavedLoop, 'id' | 'variantId' | 'name'> | null => {
    const { startMs, endMs, snap, startPercent, trainerEnabled, targetPercent, stepPercent } = settings
    if (startMs === null || endMs === null || endMs <= startMs) return null
    return { startMs, endMs, snap, startPercent, trainerEnabled, targetPercent, stepPercent }
  }

  const saveNew = () => {
    const fields = current()
    const trimmed = name.trim()
    if (!fields || !trimmed) return
    const loop: SavedLoop = { ...fields, id: randomId(), variantId, name: trimmed }
    void save(loop)
    onLoad(loop)
    setName('')
  }
  const saveChanges = () => {
    const fields = current()
    if (!loaded || !fields) return
    void save({ ...loaded, ...fields })
  }

  return (
    <>
      <Dialog title={t('loop.savedTitle')} onClose={onClose}>
        <div className="flex flex-col gap-3">
          {loops.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('loop.savedEmpty')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {loops.map((loop) => (
                <ListRow
                  key={loop.id}
                  title={loop.name}
                  subtitle={range(loop)}
                  selected={loop.id === loaded?.id}
                  onClick={() => {
                    onLoad(loop)
                    onClose()
                  }}
                  trailing={
                    <ActionMenu
                      title={loop.name}
                      actions={[
                        { icon: 'rename', label: t('loop.rename'), onClick: () => (setRenaming(loop), setRenameTo(loop.name)) },
                        { icon: 'delete', label: t('loop.delete'), danger: true, onClick: () => setDeleting(loop) },
                      ]}
                    />
                  }
                />
              ))}
            </div>
          )}

          {loaded && loopChanged(settings, loaded) && (
            <div className="flex flex-col gap-1">
              <Button variant="primary" icon="save" disabled={current() === null} onClick={saveChanges}>
                {t('loop.saveChanges', { name: loaded.name })}
              </Button>
              <p className="text-xs text-ink-faint">{t('loop.forEveryone')}</p>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <Field label={t('loop.newName')} placeholder={t('loop.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
            <Button icon="save" disabled={current() === null || name.trim() === ''} onClick={saveNew}>
              {t('loop.saveNew')}
            </Button>
          </div>
        </div>
      </Dialog>

      {renaming && (
        <Dialog
          title={t('loop.rename')}
          onClose={() => setRenaming(null)}
          actions={
            <>
              <Button onClick={() => setRenaming(null)}>{tc('actions.cancel')}</Button>
              <Button
                variant="primary"
                disabled={renameTo.trim() === ''}
                onClick={() => {
                  void save({ ...renaming, name: renameTo.trim() })
                  setRenaming(null)
                }}
              >
                {tc('dialog.save')}
              </Button>
            </>
          }
        >
          <Field label={t('loop.newName')} value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
        </Dialog>
      )}

      {deleting && (
        <Dialog
          title={t('loop.deleteTitle', { name: deleting.name })}
          onClose={() => setDeleting(null)}
          actions={
            <>
              <Button onClick={() => setDeleting(null)}>{tc('actions.cancel')}</Button>
              <Button
                variant="danger"
                icon="delete"
                onClick={() => {
                  void remove(deleting.id)
                  setDeleting(null)
                }}
              >
                {t('loop.delete')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-soft">{t('loop.deleteText')}</p>
        </Dialog>
      )}
    </>
  )
}
