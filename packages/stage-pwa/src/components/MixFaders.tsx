import { useTranslation } from 'react-i18next'
import { MIX_LABELS, MIX_MAX, MIX_SOURCES, useAudioMixStore } from '../lib/audioMix'
import { Slider, ToggleChip, type ControlSize } from './ui'

const percent = (level: number) => Math.round(level * 100)

/**
 * "Mein Mix" (docs/21 §9.3): Track, Klick and Ansagen of this device, one slider and a mute chip
 * each. `vertical`: faders side by side for the dashboard widget; `horizontal`: one row per
 * source, for the Timeline's dialog.
 */
export function MixFaders({ orientation, fontSize, size = 'form' }: { orientation: 'vertical' | 'horizontal'; fontSize?: number; size?: ControlSize }) {
  const { t } = useTranslation('widgets')
  const mix = useAudioMixStore((state) => state.mix)
  const setLevel = useAudioMixStore((state) => state.setLevel)
  const setMuted = useAudioMixStore((state) => state.setMuted)

  if (orientation === 'horizontal') {
    return (
      <div className="flex flex-col gap-2">
        {MIX_SOURCES.map((source) => (
          <div key={source} className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <Slider
                label={MIX_LABELS[source]}
                valueLabel={mix[source].muted ? 'stumm' : `${percent(mix[source].level)} %`}
                min={0}
                max={percent(MIX_MAX[source])}
                step={5}
                value={percent(mix[source].level)}
                onChange={(value) => setLevel(source, value / 100)}
              />
            </div>
            <ToggleChip label={t('w.mute')} selected={mix[source].muted} onToggle={(muted) => setMuted(source, muted)} size={size} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-h-0 gap-4" style={{ fontSize }}>
      {MIX_SOURCES.map((source) => (
        <div key={source} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span className="block w-full truncate text-center uppercase tracking-wide text-ink-muted">{MIX_LABELS[source]}</span>
          <input
            type="range"
            aria-label={MIX_LABELS[source]}
            min={0}
            max={percent(MIX_MAX[source])}
            step={5}
            value={percent(mix[source].level)}
            onChange={(e) => setLevel(source, Number(e.target.value) / 100)}
            // Vertical faders as in the IEM widget: a rotated range input stays touch-draggable.
            style={{ accentColor: 'rgb(var(--sb-accent))' }}
            className={`h-full min-h-0 w-2 flex-1 appearance-none rounded-control bg-control-strong [writing-mode:vertical-lr] [direction:rtl] ${mix[source].muted ? 'opacity-40' : ''}`}
          />
          <span className="font-sb-mono text-ink">{mix[source].muted ? 'stumm' : `${percent(mix[source].level)} %`}</span>
          <ToggleChip label={t('w.mute')} selected={mix[source].muted} onToggle={(muted) => setMuted(source, muted)} size={size} />
        </div>
      ))}
    </div>
  )
}
