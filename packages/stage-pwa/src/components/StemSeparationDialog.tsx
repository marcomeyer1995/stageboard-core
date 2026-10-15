import { useState } from 'react'
import type { StemModel } from 'shared-types'
import { Button, Dialog, Segmented, Switch } from './ui'

/**
 * "Spuren trennen" (#9): which stems the Stage-Server splits a track into. Standard = drums, bass,
 * vocals, rest; Erweitert = also guitar and keys. Two main guitars panned left and right can come
 * out as two stems - Demucs itself can't tell two guitars apart, their stereo side can.
 */
export function StemSeparationDialog({
  trackLabel,
  hasStems,
  onStart,
  onClose,
}: {
  trackLabel: string
  /** The track was separated before - a new separation replaces those stems. */
  hasStems: boolean
  onStart: (options: { model: StemModel; splitGuitar: boolean }) => void
  onClose: () => void
}) {
  const [model, setModel] = useState<StemModel>('standard')
  const [splitGuitar, setSplitGuitar] = useState(false)
  return (
    <Dialog
      title={`Spuren trennen: ${trackLabel}`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => onStart({ model, splitGuitar: model === 'extended' && splitGuitar })}>
            Trennen
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label="Spuren"
          showLabel
          value={model}
          onChange={setModel}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'extended', label: 'Erweitert' },
          ]}
        />
        <p className="text-base text-ink">
          {model === 'standard' ? 'Schlagzeug, Bass, Gesang und Rest.' : 'Schlagzeug, Bass, Gesang, Gitarre, Keys/Piano und Rest. Keys sind weniger sauber getrennt.'}
        </p>
        {model === 'extended' && (
          <Switch
            label="Gitarre links/rechts aufteilen"
            description="Für zwei Gitarren, die links und rechts im Stereobild liegen - liegen beide in der Mitte, hilft es nicht."
            checked={splitGuitar}
            onChange={setSplitGuitar}
          />
        )}
        <p className="text-sm text-ink-muted">
          Läuft auf dem Stage-Server, etwa eine Minute je Song. Die Spuren erscheinen unter dem Track und lassen sich umbenennen.
          {hasStems ? ' Die bisherigen Spuren dieses Tracks werden ersetzt.' : ''}
        </p>
      </div>
    </Dialog>
  )
}
