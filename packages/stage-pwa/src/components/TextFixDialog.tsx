import { useState } from 'react'
import type { TextFixOffer } from '../lib/variantTextFix'
import { Button, CheckRow, Dialog } from './ui'

/** A picked place: which offer, which target in it. */
export type TextFixPick = { offer: number; target: number }

const key = (pick: TextFixPick) => `${pick.offer}:${pick.target}`

/**
 * On save (#600): the lines just changed, each with the other variants that still have the old
 * line - tick where the fix should go too. Nothing is ticked at first (Marco, 2026-10-22: each
 * variant gets the fix only by choice). "Speichern" saves this variant and the ticked fixes;
 * "Abbrechen" goes back to the editor with nothing saved (D6).
 */
export function TextFixDialog({ offers, onSave, onCancel }: { offers: TextFixOffer[]; onSave: (picks: TextFixPick[]) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const toggle = (pick: TextFixPick) =>
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(key(pick))) next.add(key(pick))
      return next
    })
  const all = offers.flatMap((offer, o) => offer.targets.map((_, t) => ({ offer: o, target: t })))
  const picks = all.filter((pick) => picked.has(key(pick)))
  const allPicked = all.length > 0 && picks.length === all.length

  return (
    <Dialog
      title="Auch in anderen Varianten ändern?"
      onClose={onCancel}
      closeOnBackdrop={false}
      actions={
        <>
          <Button onClick={onCancel}>Abbrechen</Button>
          <Button variant="primary" onClick={() => onSave(picks)}>
            {picks.length > 0 ? `Speichern + ${picks.length} ${picks.length === 1 ? 'Änderung' : 'Änderungen'}` : 'Speichern'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {all.length > 1 && (
          // All at once (Marco, 2026-10-28) - still nothing ticked until asked for. Set apart by a
          // line, so it reads as an option over the list, not one more line of it, and stays at the
          // top while the lines scroll under it (over the dialog body's padding too).
          <div className="sticky -top-4 z-10 -mt-4 border-b border-line bg-surface pb-4 pt-4">
            <CheckRow checked={allPicked} onToggle={() => setPicked(allPicked ? new Set() : new Set(all.map(key)))}>
              <span className="font-semibold">Alle auswählen ({all.length})</span>
            </CheckRow>
          </div>
        )}
        {offers.map((offer, o) => (
          <section key={o} className="flex flex-col gap-2">
            <div className="flex flex-col gap-1 rounded-control bg-control px-3 py-2 font-sb-mono text-base">
              <span className="text-ink-faint line-through">{offer.before}</span>
              <span className="text-ink">{offer.after}</span>
            </div>
            {offer.targets.map((target, t) => (
              <CheckRow key={target.variantId} checked={picked.has(key({ offer: o, target: t }))} onToggle={() => toggle({ offer: o, target: t })}>
                {target.variantLabel} · Zeile {target.lineIndex + 1}
              </CheckRow>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  )
}
